/**
 * Webhook notification service.
 * Uses Redis list for persistence across restarts.
 */

const WEBHOOK_QUEUE_KEY = 'webhook_queue';
const FLUSH_INTERVAL_MS = parseInt(process.env.WEBHOOK_FLUSH_INTERVAL_MS, 10) || 5000;
const MAX_BATCH_SIZE = parseInt(process.env.WEBHOOK_MAX_BATCH_SIZE, 10) || 50;
const MAX_RETRIES = parseInt(process.env.WEBHOOK_MAX_RETRIES, 10) || 3;

let flushTimer = null;

/**
 * Queue a webhook for batch sending - PERSISTENT in Redis
 */
export async function queueWebhook(event, data) {
  const payload = JSON.stringify({
    event,
    data,
    timestamp: Date.now(),
    attempt: 0,
  });

  try {
    const { getClient } = await import('../config/redis.js');
    const client = getClient();
    await client.rpush(WEBHOOK_QUEUE_KEY, payload);
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Failed to queue webhook to Redis',
      error: err.message,
      event,
    }));
  }

  if (!flushTimer) {
    flushTimer = setTimeout(flushWebhookQueue, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush queued webhooks - Read from Redis
 */
async function flushWebhookQueue() {
  flushTimer = null;

  try {
    const { getClient } = await import('../config/redis.js');
    const client = getClient();

    // Read up to 50 webhooks from queue
    const results = [];
    for (let i = 0; i < MAX_BATCH_SIZE; i++) {
      const item = await client.lpop(WEBHOOK_QUEUE_KEY);
      if (!item) break;
      results.push(JSON.parse(item));
    }

    if (results.length === 0) return;

    // Process each webhook with retry
    for (const item of results) {
      const success = await sendWebhook(item.event, item.data);
      if (!success && item.attempt < MAX_RETRIES) {
        item.attempt = (item.attempt || 0) + 1;
        await client.rpush(WEBHOOK_QUEUE_KEY, JSON.stringify(item));
      }
    }

    const remaining = await client.llen(WEBHOOK_QUEUE_KEY);
    if (remaining > 0) {
      flushTimer = setTimeout(flushWebhookQueue, FLUSH_INTERVAL_MS);
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Failed to flush webhook queue',
      error: err.message,
    }));
  }
}

/**
 * Send a single webhook notification.
 */
async function sendWebhook(event, data) {
  const webhooks = (process.env.WEBHOOK_URLS || '').split(',').filter(Boolean);
  if (webhooks.length === 0) return true; // No webhooks configured

  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

  let anySuccess = false;
  for (const url of webhooks) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(url.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.ok) {
        anySuccess = true;
      }
    } catch (err) {
      console.error(JSON.stringify({
        level: 'warn',
        msg: 'Webhook delivery failed',
        url: url.trim(),
        event,
        error: err.message,
      }));
    }
  }

  return anySuccess;
}

/**
 * Flush any remaining webhooks (for graceful shutdown).
 */
export async function flushAllWebhooks() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushWebhookQueue();
}
