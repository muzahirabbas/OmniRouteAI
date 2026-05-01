import { evalLua, get, setex, incrWithTTL, del } from '../config/redis.js';
import { getDefaultRpmLimit } from '../config/providers.js';

/**
 * Key rotation service with atomic selection, RPM enforcement, and auto-disable.
 *
 * CRITICAL: Key selection uses a Redis Lua script to atomically:
 * 1. Read the sorted set (least-used first)
 * 2. Skip disabled keys (key:disabled:{provider}:{key} exists)
 * 3. Skip keys exceeding RPM limit (rpm:{provider}:{key} >= rpmLimit)
 * 4. Increment usage score + RPM counter (TTL 60s)
 * 5. Return the selected key
 *
 * All of this is ONE atomic Lua transaction — safe for high concurrency.
 *
 * RPM key format: rpm:{provider}:{apiKey}
 * Disabled key format: key:disabled:{provider}:{apiKey}
 */

// ─── Lua script: atomic least-used key selection ──────────────────────
// KEYS[1] = sorted set key          e.g. "provider:groq:keys"
// ARGV[1] = disabled key prefix     e.g. "key:disabled:groq:"
// ARGV[2] = RPM key prefix          e.g. "rpm:groq:"
// ARGV[3] = RPM limit               e.g. "30"
// Returns: the selected API key string, or false/nil if none available
const LUA_GET_LEAST_USED_KEY = `
  local members = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
  if #members == 0 then return false end

  local rpmLimit = tonumber(ARGV[3])
  local candidates = {}
  local minScore = nil

  for i = 1, #members, 2 do
    local apiKey = members[i]
    local score  = tonumber(members[i+1])

    -- Once score exceeds minScore, all remaining keys are worse — stop scanning
    if minScore ~= nil and score > minScore then break end

    local disabledK = ARGV[1] .. apiKey
    local rpmK      = ARGV[2] .. apiKey

    if redis.call('EXISTS', disabledK) == 0 then
      local rpmRaw = redis.call('GET', rpmK)
      local currentRpm = rpmRaw and tonumber(rpmRaw) or 0

      if currentRpm < rpmLimit then
        -- This key is eligible: track it as a candidate
        if minScore == nil then minScore = score end
        table.insert(candidates, apiKey)
      end
    end
  end

  if #candidates == 0 then return false end

  -- Pick one at random from all tied best-score candidates (eliminates alphabetical bias)
  local selectedKey = candidates[math.random(#candidates)]

  -- Atomically increment usage score
  redis.call('ZINCRBY', KEYS[1], 1, selectedKey)

  -- Increment RPM counter with rolling 60s window
  local rpmK = ARGV[2] .. selectedKey
  local newRpm = redis.call('INCR', rpmK)
  if newRpm == 1 then
    redis.call('EXPIRE', rpmK, 60)
  end

  return selectedKey
`;

// ─── Lua script: same as above but with an exclude list ──────────────
// KEYS[1]   = sorted set key
// ARGV[1]   = disabled key prefix
// ARGV[2]   = RPM key prefix
// ARGV[3]   = RPM limit (string)
// ARGV[4]   = number of excluded keys (count)
// ARGV[5..] = excluded key values
const LUA_GET_LEAST_USED_KEY_EXCLUDING = `
  local members = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
  if #members == 0 then return false end

  local rpmLimit     = tonumber(ARGV[3])
  local excludeCount = tonumber(ARGV[4])

  local excludeSet = {}
  for i = 1, excludeCount do
    excludeSet[ARGV[4 + i]] = true
  end

  local candidates = {}
  local minScore = nil

  for i = 1, #members, 2 do
    local apiKey = members[i]
    local score  = tonumber(members[i+1])

    -- Once score exceeds minScore, stop scanning
    if minScore ~= nil and score > minScore then break end

    if not excludeSet[apiKey] then
      local disabledK = ARGV[1] .. apiKey
      local rpmK      = ARGV[2] .. apiKey

      if redis.call('EXISTS', disabledK) == 0 then
        local rpmRaw = redis.call('GET', rpmK)
        local currentRpm = rpmRaw and tonumber(rpmRaw) or 0

        if currentRpm < rpmLimit then
          if minScore == nil then minScore = score end
          table.insert(candidates, apiKey)
        end
      end
    end
  end

  if #candidates == 0 then return false end

  local selectedKey = candidates[math.random(#candidates)]

  redis.call('ZINCRBY', KEYS[1], 1, selectedKey)

  local rpmK = ARGV[2] .. selectedKey
  local newRpm = redis.call('INCR', rpmK)
  if newRpm == 1 then
    redis.call('EXPIRE', rpmK, 60)
  end

  return selectedKey
`;

// ─── Lua script: atomic failure counting + key disable ───────────────────
// KEYS[1] = fail key              e.g. "key:fail:groq:xxx"
// KEYS[2] = disabled key         e.g. "key:disabled:groq:xxx"
// ARGV[1] = threshold            e.g. "3"
// ARGV[2] = window (seconds)     e.g. "60"
// ARGV[3] = disableTTL (seconds)  e.g. "300"
// Returns: 1 if key was disabled, 0 otherwise
const LUA_RECORD_FAILURE = `
  local failKey = KEYS[1]
  local threshold = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local disabledKey = KEYS[2]
  local disableTTL = tonumber(ARGV[3])

  local count = redis.call('INCR', failKey)
  redis.call('EXPIRE', failKey, window)

  if count >= threshold then
    redis.call('SETEX', disabledKey, disableTTL, '1')
    redis.call('DEL', failKey)
    return 1
  end

  return 0
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
  const rpmPrefix = `rpm:${provider}:`;
  const rpmLimit = getDefaultRpmLimit(provider);

  const result = await evalLua(
    LUA_GET_LEAST_USED_KEY,
    1,
    sortedSetKey,
    disabledPrefix,
    rpmPrefix,
    String(rpmLimit),
  );

  return result || null;
}

/**
 * Get the least-used key, atomically excluding specific keys (for retries).
 * Maintains same atomic RPM + disabled guarantees.
 *
 * @param {string} provider
 * @param {string[]} excludeKeys - keys to skip
 * @returns {Promise<string|null>}
 */
export async function getLeastUsedKeyExcluding(provider, excludeKeys = []) {
  const sortedSetKey   = `provider:${provider}:keys`;
  const disabledPrefix = `key:disabled:${provider}:`;
  const rpmPrefix      = `rpm:${provider}:`;
  const rpmLimit       = getDefaultRpmLimit(provider);

  // Debug: check if keys exist in Redis
  const { getClient, get } = await import('../config/redis.js');
  const client = getClient();
  const keysInSet = await client.zrange(sortedSetKey, 0, -1);
  console.log(JSON.stringify({
    level: 'debug',
    msg: 'Key selection debug',
    provider,
    keysInRedisSet: keysInSet,
    excludeKeys,
  }));

  const result = await evalLua(
    LUA_GET_LEAST_USED_KEY_EXCLUDING,
    1,
    sortedSetKey,
    disabledPrefix,
    rpmPrefix,
    String(rpmLimit),
    String(excludeKeys.length),
    ...excludeKeys,
  );

  return result || null;
}

/**
 * Record a key failure.
 * If threshold reached in rolling window → auto-disable for 5 minutes.
 *
 * Policy: 3 failures within 60 seconds → disable for 300 seconds.
 *
 * @param {string} provider
 * @param {string} key
 * @returns {Promise<boolean>} true if key was disabled
 */
export async function recordKeyFailure(provider, key) {
  const failKey = `key:fail:${provider}:${key}`;
  const disabledKey = `key:disabled:${provider}:${key}`;
  const threshold = parseInt(process.env.KEY_FAILURE_THRESHOLD, 10) || 3;
  const window = parseInt(process.env.KEY_FAILURE_WINDOW, 10) || 60;
  const disableTTL = parseInt(process.env.KEY_DISABLE_TTL, 10) || 300;

  const result = await evalLua(
    LUA_RECORD_FAILURE,
    2,
    failKey,
    disabledKey,
    String(threshold),
    String(window),
    String(disableTTL)
  );

  return result === 1;
}

/**
 * Disable a key for a given duration.
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
 * Uses NX flag: only adds the key if it does NOT already exist in the set,
 * preserving the usage score of existing keys.
 *
 * @param {string} provider
 * @param {string[]} keysToRegister
 */
export async function registerKeys(provider, keysToRegister) {
  const { getClient } = await import('../config/redis.js');
  const client       = getClient();
  const sortedSetKey = `provider:${provider}:keys`;

  // ioredis zadd signature: zadd(key, 'NX', score, member)
  for (const key of keysToRegister) {
    await client.zadd(sortedSetKey, 'NX', 0, key);
  }
}

/**
 * Store metadata (e.g., Account ID, Project ID) for a specific API key.
 *
 * @param {string} provider
 * @param {string} key
 * @param {object} metadata
 */
export async function setKeyMetadata(provider, key, metadata) {
  if (!metadata || Object.keys(metadata).length === 0) return;
  await setex(`key:metadata:${provider}:${key}`, 31536000, JSON.stringify(metadata)); // 1 year TTL
}

/**
 * Retrieve metadata for a specific API key.
 *
 * @param {string} provider
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function getKeyMetadata(provider, key) {
  const data = await get(`key:metadata:${provider}:${key}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Reset all key scores for a provider to 0 and clear all disabled flags.
 * Used by the provider refresh endpoint.
 *
 * @param {string} provider
 */
export async function resetProviderKeys(provider) {
  const { getClient, keys: redisKeys, del: redisDel } = await import('../config/redis.js');
  const client = getClient();

  const sortedSetKey = `provider:${provider}:keys`;

  // Get all keys in the sorted set
  const members = await client.zrange(sortedSetKey, 0, -1);

  if (members.length === 0) return;

  // Reset all scores to 0 atomically via pipeline
  const pipeline = client.pipeline();
  for (const member of members) {
    pipeline.zadd(sortedSetKey, 'XX', 0, member); // XX = only update existing, don't add
    pipeline.del(`key:disabled:${provider}:${member}`);
    pipeline.del(`key:fail:${provider}:${member}`);
    pipeline.del(`rpm:${provider}:${member}`);
  }
  await pipeline.exec();
}
