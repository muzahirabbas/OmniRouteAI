/**
 * Webhook service with retry logic.
 * Dispatches event notifications via HTTP POST to WEBHOOK_URL.
 * Implements exponential backoff retry for failed deliveries.
 *
 * Events:
 * - provider_disabled
 * - key_disabled
 * - high_error_rate
 */

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const MAX_RETRIES = parseInt(process.env.WEBHOOK_MAX_RETRIES, 10) || 3;
const BASE_DELAY_MS = parseInt(process.env.WEBHOOK_BASE_DELAY_MS, 10) || 1000;

/**
 * @typedef {'provider_disabled' | 'key_disabled' | 'high_error_rate'} WebhookEvent
 */

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter.
 * @param {number} attempt - Current attempt number (0-based)
 * @param {number} baseDelay - Base delay in ms
 * @returns {number} Delay in ms with jitter
 */
function calculateBackoff(attempt, baseDelay = BASE_DELAY_MS) {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  // Add jitter: ±25% randomization
  const jitter = (Math.random() - 0.5) * 0.5 * exponentialDelay;
  return Math.max(0, exponentialDelay + jitter);
}

/**
 * Send a webhook event with retry logic.
 * Implements exponential backoff with jitter for failed deliveries.
 * 
 * @param {WebhookEvent} event
 * @param {object} data - event payload
 * @param {number} [maxRetries] - Override default max retries
 * @returns {Promise<{success: boolean, attempts: number, error?: string}>}
 */
export async function sendWebhook(event, data = {}, maxRetries = MAX_RETRIES) {
  if (!WEBHOOK_URL) {
    return { success: false, attempts: 0, error: 'WEBHOOK_URL not configured' };
  }

  const payload = {
    event,
    data,
    timestamp: new Date().toISOString(),
  };

  let lastError = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000), // 5s timeout for webhooks
      });

      if (response.ok) {
        if (attempt > 0) {
          console.log(JSON.stringify({
            level: 'info',
            msg: 'Webhook delivered successfully after retries',
            event,
            attempts,
          }));
        }
        return { success: true, attempts };
      }

      // Non-OK response - log and potentially retry
      lastError = `HTTP ${response.status}`;
      console.error(JSON.stringify({
        level: 'warn',
        msg: 'Webhook delivery failed',
        event,
        attempt: attempts,
        maxRetries,
        status: response.status,
      }));

    } catch (err) {
      lastError = err.message;
      console.error(JSON.stringify({
        level: 'warn',
        msg: 'Webhook delivery error',
        event,
        attempt: attempts,
        maxRetries,
        error: err.message,
      }));
    }

    // If not the last attempt, wait with exponential backoff
    if (attempt < maxRetries) {
      const delay = calculateBackoff(attempt);
      await sleep(delay);
    }
  }

  // All retries exhausted
  console.error(JSON.stringify({
    level: 'error',
    msg: 'Webhook delivery failed after all retries',
    event,
    attempts,
    error: lastError,
  }));

  return { success: false, attempts, error: lastError };
}

/**
 * Notify that a provider was disabled (circuit breaker tripped).
 *
 * @param {string} providerName
 * @param {number} errorRate
 */
export async function notifyProviderDisabled(providerName, errorRate) {
  return sendWebhook('provider_disabled', { provider: providerName, errorRate });
}

/**
 * Notify that a key was disabled.
 *
 * @param {string} providerName
 * @param {string} key - masked key
 */
export async function notifyKeyDisabled(providerName, key) {
  const maskedKey = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '***';
  return sendWebhook('key_disabled', { provider: providerName, key: maskedKey });
}

/**
 * Notify that a high error rate was detected.
 *
 * @param {string} providerName
 * @param {number} errorRate
 */
export async function notifyHighErrorRate(providerName, errorRate) {
  return sendWebhook('high_error_rate', { provider: providerName, errorRate });
}

/**
 * Queue for batch webhook processing (optional enhancement).
 * Collects webhooks and sends them in batches to reduce API calls.
 */
const webhookQueue = [];
let flushTimer = null;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Queue a webhook for batch sending.
 * @param {WebhookEvent} event
 * @param {object} data
 */
export function queueWebhook(event, data) {
  webhookQueue.push({ event, data, timestamp: Date.now() });

  // Schedule flush if not already scheduled
  if (!flushTimer) {
    flushTimer = setTimeout(flushWebhookQueue, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush queued webhooks as a batch.
 */
async function flushWebhookQueue() {
  flushTimer = null;

  if (webhookQueue.length === 0) return;

  const batch = [...webhookQueue];
  webhookQueue.length = 0;

  // Send batch as single webhook with array of events
  await sendWebhook('batch', { events: batch });
}
