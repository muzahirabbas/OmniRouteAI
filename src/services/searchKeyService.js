import { evalLua, get, setex, incrWithTTL, del } from '../config/redis.js';
import { getDefaultSearchRpmLimit } from '../config/searchProviders.js';

const LUA_GET_LEAST_USED_KEY = `
  local members = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
  if #members == 0 then return false end

  local rpmLimit = tonumber(ARGV[3])
  local candidates = {}
  local minScore = nil

  for i = 1, #members, 2 do
    local apiKey = members[i]
    local score  = tonumber(members[i+1])

    if minScore ~= nil and score > minScore then break end

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

export async function getLeastUsedSearchKey(provider) {
  const sortedSetKey = `search:${provider}:keys`;
  const disabledPrefix = `search:key:disabled:${provider}:`;
  const rpmPrefix = `search:rpm:${provider}:`;
  const rpmLimit = getDefaultSearchRpmLimit(provider);

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

export async function getLeastUsedSearchKeyExcluding(provider, excludeKeys = []) {
  const sortedSetKey = `search:${provider}:keys`;
  const disabledPrefix = `search:key:disabled:${provider}:`;
  const rpmPrefix = `search:rpm:${provider}:`;
  const rpmLimit = getDefaultSearchRpmLimit(provider);

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

export async function recordSearchKeyFailure(provider, key) {
  const failKey = `search:key:fail:${provider}:${key}`;
  const threshold = parseInt(process.env.SEARCH_KEY_FAILURE_THRESHOLD, 10) || 3;
  const window = parseInt(process.env.SEARCH_KEY_FAILURE_WINDOW, 10) || 60;
  const disableTTL = parseInt(process.env.SEARCH_KEY_DISABLE_TTL, 10) || 300;

  const count = await incrWithTTL(failKey, window);

  if (count >= threshold) {
    await disableSearchKey(provider, key, disableTTL);
    await del(failKey);
    return true;
  }

  return false;
}

export async function disableSearchKey(provider, key, ttl = 300) {
  const disabledKey = `search:key:disabled:${provider}:${key}`;
  await setex(disabledKey, ttl, '1');
}

export async function isSearchKeyDisabled(provider, key) {
  const disabledKey = `search:key:disabled:${provider}:${key}`;
  const val = await get(disabledKey);
  return val !== null;
}

export async function registerSearchKeys(provider, keysToRegister) {
  const { getClient } = await import('../config/redis.js');
  const client = getClient();
  const sortedSetKey = `search:${provider}:keys`;

  for (const key of keysToRegister) {
    await client.zadd(sortedSetKey, 'NX', 0, key);
  }
}

export async function setSearchKeyMetadata(provider, key, metadata) {
  if (!metadata || Object.keys(metadata).length === 0) return;
  await setex(`search:key:metadata:${provider}:${key}`, 31536000, JSON.stringify(metadata));
}

export async function getSearchKeyMetadata(provider, key) {
  const data = await get(`search:key:metadata:${provider}:${key}`);
  return data ? JSON.parse(data) : null;
}

export async function resetSearchProviderKeys(provider) {
  const { getClient, keys: redisKeys, del: redisDel } = await import('../config/redis.js');
  const client = getClient();

  const sortedSetKey = `search:${provider}:keys`;
  const members = await client.zrange(sortedSetKey, 0, -1);

  if (members.length === 0) return;

  const pipeline = client.pipeline();
  for (const member of members) {
    pipeline.zadd(sortedSetKey, 'XX', 0, member);
    pipeline.del(`search:key:disabled:${provider}:${member}`);
    pipeline.del(`search:key:fail:${provider}:${member}`);
    pipeline.del(`search:rpm:${provider}:${member}`);
  }
  await pipeline.exec();
}
