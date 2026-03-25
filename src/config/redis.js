import IoRedis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Track Redis connection state
let _redisConnected = false;
let _redisConnectAttempts = 0;
const MAX_CONNECT_ATTEMPTS = 10;

// In-memory fallback storage (graceful degradation)
const memoryStore = new Map();
const memoryExpiry = new Map();

// ─── 1. BullMQ TCP Client (ioredis) ──────────────────────────────────
// BullMQ STRICTLY requires an ioredis TCP connection.
const bullmqRedis = new IoRedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ to allow infinite retries without crashing the Node process
  enableReadyCheck: false,    // Strongly recommended by Upstash to avoid connection stall checks
  family: 0,                  // CRITICAL: Required for Railway IPv6 routing to Upstash
  tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times) => {
    _redisConnectAttempts = times;
    
    if (times > MAX_CONNECT_ATTEMPTS) {
      console.warn(JSON.stringify({
        level: 'warn',
        msg: 'Redis connection failed after multiple attempts - using in-memory fallback',
        attempts: times,
      }));
      return null; // Stop retrying
    }
    
    // Exponential backoff: max 30s
    return Math.min(times * 200, 30000);
  },
});

bullmqRedis.on('error', (err) => {
  _redisConnected = false;
  
  // Suppress verbose reconnect errors from standard drops
  if (err.message && !err.message.includes('ECONNREFUSED')) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'Redis connection error - falling back to in-memory storage',
      error: err.message,
    }));
  }
});

bullmqRedis.on('connect', () => {
  _redisConnected = true;
  _redisConnectAttempts = 0;
  console.log(JSON.stringify({ level: 'info', msg: 'BullMQ TCP connected' }));
});

bullmqRedis.on('close', () => {
  _redisConnected = false;
  console.warn(JSON.stringify({
    level: 'warn',
    msg: 'Redis connection closed - using in-memory fallback',
  }));
});

// ─── 2. Standard REST Client (@upstash/redis) ───────────────────────
// Bypasses TCP/SNI routing issues on Railway by using HTTP requests.
let restRedis = null;

if (REDIS_URL.includes('upstash.io')) {
  let restUrl = process.env.UPSTASH_REDIS_REST_URL;
  let restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Auto-parse Upstash credentials from REDIS_URL if missing
  if (!restUrl || !restToken) {
    try {
      const urlObj = new URL(REDIS_URL);
      restUrl = `https://${urlObj.hostname}`;
      restToken = urlObj.password;
    } catch (err) {
      console.warn('Failed to parse Upstash credentials from REDIS_URL');
    }
  }

  if (restUrl && restToken) {
    restRedis = new UpstashRedis({ url: restUrl, token: restToken });
    console.log(JSON.stringify({ level: 'info', msg: 'Upstash REST HTTP Client initialized' }));
  }
}

const primaryClient = restRedis || bullmqRedis;

// ─── In-Memory Fallback Functions ────────────────────────────────────

/**
 * Clean up expired in-memory keys.
 */
function cleanupMemoryStore() {
  const now = Date.now();
  for (const [key, expiry] of memoryExpiry.entries()) {
    if (expiry && expiry < now) {
      memoryStore.delete(key);
      memoryExpiry.delete(key);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupMemoryStore, 60000);

/**
 * Check if Redis is available.
 * @returns {boolean}
 */
export function isRedisAvailable() {
  return _redisConnected || (restRedis !== null);
}

/**
 * Get Redis connection status.
 * @returns {{ connected: boolean, attempts: number, usingFallback: boolean }}
 */
export function getRedisStatus() {
  return {
    connected: _redisConnected,
    attempts: _redisConnectAttempts,
    usingFallback: !_redisConnected,
  };
}

// ─── Eviction Policy Check ───────────────────────────────────────────
/**
 * Verify Redis eviction policy is set to 'noeviction' to prevent
 * BullMQ jobs from being dropped when memory limits are reached.
 * Returns true if policy is correct or if using Upstash (which handles this automatically).
 */
export async function checkEvictionPolicy() {
  // Skip check for Upstash (managed service handles eviction internally)
  if (REDIS_URL.includes('upstash.io')) {
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Using Upstash managed Redis - eviction policy check skipped',
    }));
    return true;
  }

  try {
    const { getClient } = await import('./redis.js');
    const client = getClient();
    const config = await client.config('GET', 'maxmemory-policy');
    const policy = config?.[1] || config?.maxmemory_policy || 'unknown';

    if (policy === 'noeviction') {
      console.log(JSON.stringify({
        level: 'info',
        msg: 'Redis eviction policy verified: noeviction (correct for BullMQ)',
      }));
      return true;
    } else {
      console.error(JSON.stringify({
        level: 'fatal',
        msg: 'REDIS EVICTION POLICY WARNING: BullMQ jobs may be lost!',
        current_policy: policy,
        required_policy: 'noeviction',
        fix: 'Run: redis-cli CONFIG SET maxmemory-policy noeviction',
      }));
      return false;
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Failed to check Redis eviction policy',
      error: err.message,
    }));
    return false;
  }
}

/**
 * Check Redis memory usage and warn if approaching limit.
 */
export async function checkMemoryUsage() {
  try {
    const { getClient } = await import('./redis.js');
    const client = getClient();
    const info = await client.info('memory');
    
    // Parse memory info (format varies between ioredis and raw INFO output)
    const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0', 10);
    const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || '0', 10);
    
    if (maxMemory > 0) {
      const usagePercent = ((usedMemory / maxMemory) * 100).toFixed(2);
      if (parseFloat(usagePercent) > 80) {
        console.warn(JSON.stringify({
          level: 'warn',
          msg: 'Redis memory usage is high',
          used_memory_bytes: usedMemory,
          max_memory_bytes: maxMemory,
          usage_percent: usagePercent,
        }));
      }
    }
    
    return { usedMemory, maxMemory };
  } catch (err) {
    // Silently fail - memory check is informational only
    return { usedMemory: 0, maxMemory: 0 };
  }
}

// ─── Helper functions with in-memory fallback ────────────────────────

export async function get(key) {
  if (!isRedisAvailable()) {
    const value = memoryStore.get(key);
    const expiry = memoryExpiry.get(key);
    if (expiry && expiry < Date.now()) {
      memoryStore.delete(key);
      memoryExpiry.delete(key);
      return null;
    }
    return value || null;
  }
  return primaryClient.get(key);
}

export async function set(key, value) {
  if (!isRedisAvailable()) {
    memoryStore.set(key, value);
    memoryExpiry.delete(key); // No expiry
    return 'OK';
  }
  return primaryClient.set(key, value);
}

export async function setex(key, ttl, value) {
  if (!isRedisAvailable()) {
    memoryStore.set(key, value);
    memoryExpiry.set(key, Date.now() + (ttl * 1000));
    return 'OK';
  }
  
  if (restRedis) {
    return restRedis.set(key, value, { ex: ttl });
  }
  return bullmqRedis.setex(key, ttl, value);
}

export async function del(key) {
  if (!isRedisAvailable()) {
    memoryStore.delete(key);
    memoryExpiry.delete(key);
    return 1;
  }
  return primaryClient.del(key);
}

export async function incr(key) {
  if (!isRedisAvailable()) {
    const current = parseInt(memoryStore.get(key) || '0', 10);
    const newValue = current + 1;
    memoryStore.set(key, String(newValue));
    return newValue;
  }
  return primaryClient.incr(key);
}

export async function incrWithTTL(key, ttl) {
  if (!isRedisAvailable()) {
    const current = parseInt(memoryStore.get(key) || '0', 10);
    const newValue = current + 1;
    memoryStore.set(key, String(newValue));
    memoryExpiry.set(key, Date.now() + (ttl * 1000));
    return newValue;
  }
  
  if (restRedis) {
    const pipeline = restRedis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttl);
    const results = await pipeline.exec();
    return results[0];
  }
  
  const pipeline = bullmqRedis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, ttl);
  const results = await pipeline.exec();
  return results[0][1];
}

export async function expire(key, seconds) {
  if (!isRedisAvailable()) {
    memoryExpiry.set(key, Date.now() + (seconds * 1000));
    return 1;
  }
  return primaryClient.expire(key, seconds);
}

export async function zadd(key, score, member) {
  if (!isRedisAvailable()) {
    // Simple in-memory sorted set simulation
    let set = memoryStore.get(key);
    if (!set) {
      set = {};
      memoryStore.set(key, set);
    }
    if (typeof set === 'string') {
      try { set = JSON.parse(set); } catch { set = {}; }
    }
    set[member] = score;
    memoryStore.set(key, JSON.stringify(set));
    return 1;
  }
  return primaryClient.zadd(key, score, member);
}

export async function zincrby(key, increment, member) {
  if (!isRedisAvailable()) {
    let set = memoryStore.get(key);
    if (!set) {
      set = {};
      memoryStore.set(key, set);
    }
    if (typeof set === 'string') {
      try { set = JSON.parse(set); } catch { set = {}; }
    }
    const current = parseInt(set[member] || '0', 10);
    set[member] = current + increment;
    memoryStore.set(key, JSON.stringify(set));
    return set[member];
  }
  return primaryClient.zincrby(key, increment, member);
}

export async function zrangeByScore(key, min, max, withScores = false) {
  if (!isRedisAvailable()) {
    let set = memoryStore.get(key);
    if (!set) return [];
    if (typeof set === 'string') {
      try { set = JSON.parse(set); } catch { return []; }
    }
    
    const results = [];
    for (const [member, score] of Object.entries(set)) {
      if (score >= min && score <= max) {
        results.push(member);
        if (withScores) results.push(String(score));
      }
    }
    return results;
  }
  
  if (restRedis) {
    return restRedis.zrangebyscore(key, min, max, withScores ? { withScores: true } : undefined);
  }
  return bullmqRedis.zrangebyscore(key, min, max, withScores ? 'WITHSCORES' : undefined);
}

export async function zrange(key, start, stop, withScores = false) {
  if (!isRedisAvailable()) {
    let set = memoryStore.get(key);
    if (!set) return [];
    if (typeof set === 'string') {
      try { set = JSON.parse(set); } catch { return []; }
    }
    
    // Sort by score and return range
    const sorted = Object.entries(set).sort((a, b) => a[1] - b[1]);
    const results = [];
    for (let i = start; i <= stop && i < sorted.length; i++) {
      results.push(sorted[i][0]);
      if (withScores) results.push(String(sorted[i][1]));
    }
    return results;
  }
  
  if (restRedis) {
    return restRedis.zrange(key, start, stop, withScores ? { withScores: true } : undefined);
  }
  
  if (withScores) {
    return bullmqRedis.zrange(key, start, stop, 'WITHSCORES');
  }
  return bullmqRedis.zrange(key, start, stop);
}

export async function zrem(key, member) {
  if (!isRedisAvailable()) {
    let set = memoryStore.get(key);
    if (!set) return 0;
    if (typeof set === 'string') {
      try { set = JSON.parse(set); } catch { return 0; }
    }
    delete set[member];
    memoryStore.set(key, JSON.stringify(set));
    return 1;
  }
  return primaryClient.zrem(key, member);
}

export async function keys(pattern) {
  if (!isRedisAvailable()) {
    // Simple pattern matching for in-memory store
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(memoryStore.keys()).filter(k => regex.test(k));
  }
  return primaryClient.keys(pattern);
}

/**
 * Execute a Lua script atomically.
 * Adapts between ioredis and @upstash/redis signatures.
 */
export async function evalLua(script, numkeys, ...args) {
  if (restRedis) {
    const keysArray = args.slice(0, numkeys);
    const argsArray = args.slice(numkeys);
    return restRedis.eval(script, keysArray, argsArray);
  } else {
    return bullmqRedis.eval(script, numkeys, ...args);
  }
}

/**
 * Get the raw ioredis client for BullMQ or other advanced use.
 */
export function getClient() {
  return bullmqRedis;
}

/**
 * Create a duplicate connection (needed for BullMQ worker).
 * BullMQ requires maxRetriesPerRequest to be null.
 */
export function createDuplicate() {
  return bullmqRedis.duplicate({ maxRetriesPerRequest: null });
}

export default bullmqRedis;
