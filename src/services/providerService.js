import { get, setex, incrWithTTL, del } from '../config/redis.js';
import { getProviders } from '../config/providers.js';

/**
 * Provider state management: active providers, circuit breaker, rolling health window.
 *
 * Health tracking uses rolling window (5-min TTL on success/fail counters)
 * rather than lifetime stats to avoid stale data.
 */

const CIRCUIT_BREAKER_THRESHOLD = parseFloat(process.env.CIRCUIT_BREAKER_THRESHOLD) || 0.5;
const CIRCUIT_BREAKER_TTL = parseInt(process.env.CIRCUIT_BREAKER_TTL, 10) || 300; // 5 min
const HEALTH_WINDOW_TTL = 300; // 5 min rolling window

/**
 * Get active providers, sorted by priority (asc) then weight (desc).
 * Filters out Firestore-disabled and circuit-broken providers.
 *
 * @returns {Promise<Array>} sorted active providers
 */
export async function getActiveProviders() {
  const allProviders = await getProviders();

  const active = [];
  for (const provider of allProviders) {
    if (provider.status !== 'active') continue;

    const disabled = await isProviderDisabled(provider.name);
    if (disabled) continue;

    active.push(provider);
  }

  // Sort: priority ascending, then weight descending
  active.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.weight - a.weight;
  });

  return active;
}

/**
 * Disable a provider via circuit breaker.
 *
 * @param {string} name
 * @param {number} [ttl] - seconds (default: CIRCUIT_BREAKER_TTL)
 */
export async function disableProvider(name, ttl = CIRCUIT_BREAKER_TTL) {
  await setex(`provider:disabled:${name}`, ttl, '1');
}

/**
 * Check if provider is disabled (circuit open).
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function isProviderDisabled(name) {
  const val = await get(`provider:disabled:${name}`);
  return val !== null;
}

/**
 * Record a success or failure for provider health tracking.
 * Uses rolling window (TTL-based counters).
 *
 * @param {string} name
 * @param {boolean} success
 */
export async function recordProviderResult(name, success) {
  if (success) {
    await incrWithTTL(`provider:${name}:success`, HEALTH_WINDOW_TTL);
  } else {
    await incrWithTTL(`provider:${name}:fail`, HEALTH_WINDOW_TTL);
  }

  // Auto circuit-breaker check
  await checkCircuitBreaker(name);
}

/**
 * Get error rate for a provider in the rolling window.
 *
 * @param {string} name
 * @returns {Promise<number>} error rate (0-1)
 */
export async function getErrorRate(name) {
  const successCount = parseInt(await get(`provider:${name}:success`) || '0', 10);
  const failCount = parseInt(await get(`provider:${name}:fail`) || '0', 10);
  const total = successCount + failCount;

  if (total === 0) return 0;
  return failCount / total;
}

/**
 * Check if circuit breaker should trip for a provider.
 * Needs at least 5 requests in the window to make a judgment.
 *
 * @param {string} name
 */
async function checkCircuitBreaker(name) {
  const successCount = parseInt(await get(`provider:${name}:success`) || '0', 10);
  const failCount = parseInt(await get(`provider:${name}:fail`) || '0', 10);
  const total = successCount + failCount;

  // Need minimum sample size
  if (total < 5) return;

  const errorRate = failCount / total;
  if (errorRate > CIRCUIT_BREAKER_THRESHOLD) {
    await disableProvider(name);
    // Reset health counters so they start fresh when circuit re-closes
    await del(`provider:${name}:success`);
    await del(`provider:${name}:fail`);
  }
}

/**
 * Get a specific provider config by name.
 *
 * @param {string} name
 * @returns {Promise<object|null>}
 */
export async function getProviderConfig(name) {
  const allProviders = await getProviders();
  return allProviders.find((p) => p.name === name) || null;
}
