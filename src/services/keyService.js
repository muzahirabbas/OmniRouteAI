import { evalLua, get, setex, incrWithTTL, del } from '../config/redis.js';
import { getDefaultRpmLimit } from '../config/providers.js';

/**
 * Key rotation service with atomic selection, RPM enforcement, and auto-disable.
 *
 * CRITICAL: Key selection uses a Redis Lua script to atomically:
 * 1. Find the least-used key (lowest score in sorted set)
 * 2. Skip disabled keys and RPM-exceeded keys
 * 3. Increment usage counter
 * 4. Return the selected key
 */

// ─── Lua script: atomic least-used key selection ──────────────────────
// KEYS[1] = sorted set key (e.g., "provider:groq:keys")
// ARGV[1] = disabled key prefix (e.g., "key:disabled:groq:")
// ARGV[2] = RPM key prefix (e.g., "rpm:")
// ARGV[3] = RPM limit
// Returns: the selected key or nil
const LUA_GET_LEAST_USED_KEY = `
  local keys = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
  if #keys == 0 then return nil end

  for i = 1, #keys, 2 do
    local apiKey = keys[i]
    local disabledFlag = ARGV[1] .. apiKey
    local rpmKey = ARGV[2] .. apiKey
    local rpmLimit = tonumber(ARGV[3])

    -- Check if key is disabled
    local isDisabled = redis.call('EXISTS', disabledFlag)
    if isDisabled == 0 then
      -- Check RPM limit
      local currentRpm = tonumber(redis.call('GET', rpmKey) or '0')
      if currentRpm == nil then currentRpm = 0 end

      if currentRpm < rpmLimit then
        -- Atomically increment usage score
        redis.call('ZINCRBY', KEYS[1], 1, apiKey)
        -- Increment RPM with 60s TTL
        redis.call('INCR', rpmKey)
        redis.call('EXPIRE', rpmKey, 60)
        return apiKey
      end
    end
  end

  return nil
`;

/**
 * Get the least-used, non-disabled, RPM-available key for a provider.
 * Uses atomic Lua script — safe for concurrent requests.
 *
 * @param {string} provider - provider name (e.g., 'groq')
 * @returns {Promise<string|null>} API key or null if all exhausted
 */
export async function getLeastUsedKey(provider) {
  const sortedSetKey = `provider:${provider}:keys`;
  const disabledPrefix = `key:disabled:${provider}:`;
  const rpmPrefix = 'rpm:';
  const rpmLimit = getDefaultRpmLimit(provider);

  const key = await evalLua(
    LUA_GET_LEAST_USED_KEY,
    1,
    sortedSetKey,
    disabledPrefix,
    rpmPrefix,
    rpmLimit,
  );

  return key;
}

/**
 * Get the least-used key, excluding specific keys (for retries).
 *
 * @param {string} provider
 * @param {string[]} excludeKeys - keys to skip
 * @returns {Promise<string|null>}
 */
export async function getLeastUsedKeyExcluding(provider, excludeKeys = []) {
  const sortedSetKey = `provider:${provider}:keys`;
  const disabledPrefix = `key:disabled:${provider}:`;
  const rpmPrefix = 'rpm:';
  const rpmLimit = getDefaultRpmLimit(provider);

  // Extended Lua with exclude list
  const luaWithExclude = `
    local keys = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
    if #keys == 0 then return nil end

    local excludeCount = tonumber(ARGV[4])
    local excludeSet = {}
    for i = 1, excludeCount do
      excludeSet[ARGV[4 + i]] = true
    end

    for i = 1, #keys, 2 do
      local apiKey = keys[i]

      -- Check exclude list
      if not excludeSet[apiKey] then
        local disabledFlag = ARGV[1] .. apiKey
        local rpmKey = ARGV[2] .. apiKey
        local rpmLimit = tonumber(ARGV[3])

        local isDisabled = redis.call('EXISTS', disabledFlag)
        if isDisabled == 0 then
          local currentRpm = tonumber(redis.call('GET', rpmKey) or '0')
          if currentRpm == nil then currentRpm = 0 end

          if currentRpm < rpmLimit then
            redis.call('ZINCRBY', KEYS[1], 1, apiKey)
            redis.call('INCR', rpmKey)
            redis.call('EXPIRE', rpmKey, 60)
            return apiKey
          end
        end
      end
    end

    return nil
  `;

  const args = [
    1,
    sortedSetKey,
    disabledPrefix,
    rpmPrefix,
    rpmLimit,
    excludeKeys.length,
    ...excludeKeys,
  ];

  const key = await evalLua(luaWithExclude, ...args);
  return key;
}

/**
 * Record a key failure. If threshold exceeded in window → auto-disable.
 *
 * @param {string} provider
 * @param {string} key
 */
export async function recordKeyFailure(provider, key) {
  const failCounterKey = `key:fail:${provider}:${key}`;
  const threshold = parseInt(process.env.KEY_FAILURE_THRESHOLD, 10) || 3;
  const window = parseInt(process.env.KEY_FAILURE_WINDOW, 10) || 60;
  const disableTTL = parseInt(process.env.KEY_DISABLE_TTL, 10) || 300;

  const count = await incrWithTTL(failCounterKey, window);

  if (count >= threshold) {
    await disableKey(provider, key, disableTTL);
    // Clean up failure counter
    await del(failCounterKey);
    return true; // Key was disabled
  }

  return false;
}

/**
 * Disable a key for a duration.
 *
 * @param {string} provider
 * @param {string} key
 * @param {number} [ttl=300] - seconds
 */
export async function disableKey(provider, key, ttl = 300) {
  const disabledKey = `key:disabled:${provider}:${key}`;
  await setex(disabledKey, ttl, '1');
}

/**
 * Check if a key is disabled.
 *
 * @param {string} provider
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function isKeyDisabled(provider, key) {
  const disabledKey = `key:disabled:${provider}:${key}`;
  const val = await get(disabledKey);
  return val !== null;
}

/**
 * Register API keys for a provider in the sorted set.
 *
 * @param {string} provider
 * @param {string[]} keys
 */
export async function registerKeys(provider, keys) {
  const { zadd } = await import('../config/redis.js');
  const sortedSetKey = `provider:${provider}:keys`;
  for (const key of keys) {
    await zadd(sortedSetKey, 0, key);
  }
}
