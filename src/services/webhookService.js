/**
 * Webhook service.
 * Dispatches event notifications via HTTP POST to WEBHOOK_URL.
 * Non-blocking — fire-and-forget.
 *
 * Events:
 * - provider_disabled
 * - key_disabled
 * - high_error_rate
 */

const WEBHOOK_URL = process.env.WEBHOOK_URL;

/**
 * @typedef {'provider_disabled' | 'key_disabled' | 'high_error_rate'} WebhookEvent
 */

/**
 * Send a webhook event. Non-blocking — failures are logged but don't throw.
 *
 * @param {WebhookEvent} event
 * @param {object} data - event payload
 */
export async function sendWebhook(event, data = {}) {
  if (!WEBHOOK_URL) return;

  const payload = {
    event,
    data,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5s timeout for webhooks
    });

    if (!response.ok) {
      console.error(JSON.stringify({
        level: 'warn',
        msg: 'Webhook delivery failed',
        event,
        status: response.status,
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: 'warn',
      msg: 'Webhook delivery error',
      event,
      error: err.message,
    }));
  }
}

/**
 * Notify that a provider was disabled (circuit breaker tripped).
 *
 * @param {string} providerName
 * @param {number} errorRate
 */
export async function notifyProviderDisabled(providerName, errorRate) {
  await sendWebhook('provider_disabled', { provider: providerName, errorRate });
}

/**
 * Notify that a key was disabled.
 *
 * @param {string} providerName
 * @param {string} key - masked key
 */
export async function notifyKeyDisabled(providerName, key) {
  const maskedKey = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '***';
  await sendWebhook('key_disabled', { provider: providerName, key: maskedKey });
}

/**
 * Notify that a high error rate was detected.
 *
 * @param {string} providerName
 * @param {number} errorRate
 */
export async function notifyHighErrorRate(providerName, errorRate) {
  await sendWebhook('high_error_rate', { provider: providerName, errorRate });
}
