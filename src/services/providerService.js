import { get, setex, incrWithTTL, del } from '../config/redis.js';
import { getProviders } from '../config/providers.js';

/**
 * Provider state management: active providers, weighted selection, circuit breaker.
 *
 * Provider selection algorithm:
 * 1. Filter: status=active AND NOT circuit-broken
 * 2. Group by priority (ascending — lower number = higher priority)
 * 3. Within the LOWEST priority number group, do TRUE weighted random sampling
 * 4. On failure → escalate to next priority group
 *
 * Circuit breaker (rolling window):
 * - Redis keys: provider:{name}:success / provider:{name}:fail
 * - TTL = 5 minutes (rolling window — not lifetime stats)
 * - errorRate = fails / (success + fail)
 * - Trips at ≥ 50% error rate with minimum 5 samples in the window
 * - Disabled for 5 minutes (CIRCUIT_BREAKER_TTL)
 * - On provider refresh: counters are reset
 */

const CIRCUIT_BREAKER_THRESHOLD = parseFloat(process.env.CIRCUIT_BREAKER_THRESHOLD) || 0.5;
const CIRCUIT_BREAKER_TTL       = parseInt(process.env.CIRCUIT_BREAKER_TTL, 10) || 300;
const HEALTH_WINDOW_TTL         = 300; // 5-minute rolling window
const MIN_SAMPLES               = 5;   // Minimum requests before circuit breaker can trip

/**
 * Get sorted active providers using weighted random selection per priority tier.
 *
 * Selection rules (MANDATORY):
 *   - PRIORITY FIRST: only sample from the lowest priority number (highest priority) tier
 *   - WEIGHT SECOND: within that tier, use true weighted random sampling
 *   - If provider from that tier fails, the caller escalates by passing excludeProviders
 *     → this function will then reach into the next priority tier
 *
 * This produces a deterministic ordered list per request:
 *   [weighted-selected from tier 1] → [weighted-selected from tier 2] → ...
 *
 * @returns {Promise<Array>} sorted active providers
 */
export async function getActiveProviders() {
  const allProviders = await getProviders();

  // Step 1: filter to active + not circuit-broken
  const active = [];
  for (const provider of allProviders) {
    if (provider.status !== 'active') continue;
    const disabled = await isProviderDisabled(provider.name);
    if (disabled) continue;
    active.push(provider);
  }

  if (active.length === 0) return [];

  // Step 2: group by priority tier (e.g. {1: [...], 2: [...], 3: [...]})
  const tiers = {};
  for (const provider of active) {
    const p = provider.priority ?? 99;
    if (!tiers[p]) tiers[p] = [];
    tiers[p].push(provider);
  }

  // Step 3: for each priority tier (ascending), do weighted random sampling
  // Build result: within each tier, providers are randomly ordered by weight
  const result = [];
  const sortedPriorities = Object.keys(tiers).map(Number).sort((a, b) => a - b);

  for (const priority of sortedPriorities) {
    const tierProviders = tiers[priority];

    // Perform weighted random sampling without replacement — one tier at a time
    const ordered = weightedShuffle(tierProviders);
    result.push(...ordered);
  }

  return result;
}

/**
 * Weighted shuffle: order providers by weighted random selection (without replacement).
 * This ensures higher-weight providers are more likely to be chosen first,
 * but any provider can be selected.
 *
 * @param {Array} providers - providers in a single priority tier
 * @returns {Array} shuffled providers ordered by weighted probability
 */
function weightedShuffle(providers) {
  if (providers.length === 0) return [];
  if (providers.length === 1) return [...providers];

  const result    = [];
  const remaining = [...providers];

  while (remaining.length > 0) {
    // Build cumulative weight vector
    const totalWeight = remaining.reduce((sum, p) => sum + (p.weight || 1), 0);
    let rand = Math.random() * totalWeight;

    let selectedIdx = remaining.length - 1; // fallback to last
    for (let i = 0; i < remaining.length; i++) {
      rand -= (remaining[i].weight || 1);
      if (rand <= 0) {
        selectedIdx = i;
        break;
      }
    }

    result.push(remaining[selectedIdx]);
    remaining.splice(selectedIdx, 1);
  }

  return result;
}

/**
 * Disable a provider via circuit breaker.
 *
 * @param {string} name
 * @param {number} [ttl] - seconds (default: CIRCUIT_BREAKER_TTL = 5 min)
 */
export async function disableProvider(name, ttl = CIRCUIT_BREAKER_TTL) {
  await setex(`provider:disabled:${name}`, ttl, '1');
}

/**
 * Check if provider is circuit-broken (disabled).
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
 * Uses rolling window (TTL-based counters in Redis).
 * Automatically checks if circuit breaker should trip.
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

  // Auto circuit-breaker check (non-blocking, errors silently ignored)
  await checkCircuitBreaker(name).catch(() => {});
}

/**
 * Get error rate for a provider in the rolling window.
 *
 * @param {string} name
 * @returns {Promise<number>} error rate (0.0–1.0)
 */
export async function getErrorRate(name) {
  const successCount = parseInt((await get(`provider:${name}:success`)) || '0', 10);
  const failCount    = parseInt((await get(`provider:${name}:fail`))    || '0', 10);
  const total        = successCount + failCount;

  if (total === 0) return 0;
  return failCount / total;
}

/**
 * Get raw health counters for a provider.
 *
 * @param {string} name
 * @returns {Promise<{success: number, fail: number, total: number, errorRate: number}>}
 */
export async function getProviderHealth(name) {
  const success  = parseInt((await get(`provider:${name}:success`)) || '0', 10);
  const fail     = parseInt((await get(`provider:${name}:fail`))    || '0', 10);
  const total    = success + fail;
  const errorRate = total === 0 ? 0 : fail / total;
  const disabled  = await isProviderDisabled(name);

  return { success, fail, total, errorRate, disabled };
}

/**
 * Check if circuit breaker should trip for a provider.
 *
 * Rules:
 * - Must have at least MIN_SAMPLES (5) requests in the rolling window
 * - Error rate must be >= CIRCUIT_BREAKER_THRESHOLD (50%)
 * - Resets health counters on disable (fresh start when circuit re-closes)
 *
 * @param {string} name
 */
async function checkCircuitBreaker(name) {
  const successCount = parseInt((await get(`provider:${name}:success`)) || '0', 10);
  const failCount    = parseInt((await get(`provider:${name}:fail`))    || '0', 10);
  const total        = successCount + failCount;

  // Require minimum sample size before tripping
  if (total < MIN_SAMPLES) return;

  const errorRate = failCount / total;
  if (errorRate >= CIRCUIT_BREAKER_THRESHOLD) {
    await disableProvider(name);
    // Reset health counters so they start fresh when circuit re-closes
    await del(`provider:${name}:success`);
    await del(`provider:${name}:fail`);
  }
}

/**
 * Reset the circuit breaker counters for a provider.
 * Called from provider refresh endpoint.
 *
 * @param {string} name
 */
export async function resetProviderCircuitBreaker(name) {
  await del(`provider:${name}:success`);
  await del(`provider:${name}:fail`);
  await del(`provider:disabled:${name}`);
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
