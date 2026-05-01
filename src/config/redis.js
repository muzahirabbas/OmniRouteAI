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
  connectTimeout: 10000,       // 10s connection timeout
  enableOfflineQueue: true,    // Queue commands while offline
  keepAlive: 300000,          // 5min TCP keep-alive
  noDelay: true,              // Disable Nagle's algorithm
  socketIdleTimeout: 300000,   // 5min before idle socket close
  retryStrategy: (times) => {
    _redisConnectAttempts = times;
    
    // For initial connection, stop after MAX_CONNECT_ATTEMPTS
    // But allow background reconnection attempts indefinitely
    if (times > MAX_CONNECT_ATTEMPTS && times <= 15) {
      console.warn(JSON.stringify({
        level: 'warn',
        msg: 'Redis connection failed after multiple attempts - using in-memory fallback, will continue retrying in background',
        attempts: times,
      }));
    }
    
    // Exponential backoff with jitter: max 30s
    const jitter = Math.random() * 1000;
    return Math.min(times * 200 + jitter, 30000);
  },
  // Automatically retry on connection errors
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
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

let _isClosing = false;

bullmqRedis.on('close', () => {
  _redisConnected = false;
  if (!_isClosing) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'Redis connection closed - using in-memory fallback until reconnected',
    }));
  }
});

// ─── Connection Health Monitoring ───────────────────────────────────
let _healthCheckInterval = null;

export function startHealthCheck(intervalMs = 30000) {
  if (_healthCheckInterval) return;
  
  _healthCheckInterval = setInterval(async () => {
    try {
      if (_redisConnected) {
        const result = await bullmqRedis.ping();
        if (result !== 'PONG') {
          console.warn(JSON.stringify({
            level: 'warn',
            msg: 'Redis health check failed - ping did not return PONG',
          }));
        }
      }
    } catch (err) {
      console.warn(JSON.stringify({
        level: 'warn',
        msg: 'Redis health check failed',
        error: err.message,
      }));
    }
  }, intervalMs);
}

export function stopHealthCheck() {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}

/**
 * Gracefully close Redis connections on shutdown.
 */
export async function closeRedis() {
  _isClosing = true;
  try {
    await bullmqRedis.quit();
    console.log(JSON.stringify({ level: 'info', msg: 'Redis TCP connection closed' }));
  } catch (err) {
    console.warn(`Error closing Redis: ${err.message}`);
  }
}

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

/**
 * Helper to wrap a promise with a timeout.
 * @param {Promise} promise 
 * @param {number} timeoutMs 
 * @param {string} errorMsg 
 */
async function withTimeout(promise, timeoutMs = 10000, errorMsg = 'Redis operation timed out') {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

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
    const client = bullmqRedis;
    const config = await withTimeout(client.config('GET', 'maxmemory-policy'), 5000);
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
    if (err.message.includes('unknown command') || err.message.includes('config')) {
      console.log(JSON.stringify({
        level: 'info',
        msg: 'Redis CONFIG command restricted by provider - eviction policy check skipped',
        detail: 'Cloud-managed Redis typically manages eviction internally.',
      }));
      return true;
    }
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
    const client = bullmqRedis;
    const info = await withTimeout(client.info('memory'), 5000);
    
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

const REDIS_OP_TIMEOUT = 8000; // 8s timeout for data ops

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
  try {
    return await withTimeout(primaryClient.get(key), REDIS_OP_TIMEOUT);
  } catch (err) {
    console.warn(`Redis GET failed (${err.message}). Using memory fallback for ${key}`);
    const value = memoryStore.get(key);
    return value || null;
  }
}

/**
 * Fetch multiple keys at once.
 * 
 * @param {string[]} keysToFetch 
 * @returns {Promise<string[]>}
 */
export async function mget(keysToFetch) {
  if (!keysToFetch || keysToFetch.length === 0) return [];
  
  if (!isRedisAvailable()) {
    return keysToFetch.map(k => {
      const val = memoryStore.get(k);
      const exp = memoryExpiry.get(k);
      if (exp && exp < Date.now()) return null;
      return val || null;
    });
  }
  
  try {
    return await withTimeout(primaryClient.mget(...keysToFetch), REDIS_OP_TIMEOUT);
  } catch (err) {
    console.warn(`Redis MGET failed (${err.message}). Using partial memory fallback.`);
    return keysToFetch.map(k => memoryStore.get(k) || null);
  }
}

export async function set(key, value) {
  if (!isRedisAvailable()) {
    memoryStore.set(key, value);
    memoryExpiry.delete(key); // No expiry
    return 'OK';
  }
  try {
    return await withTimeout(primaryClient.set(key, value), REDIS_OP_TIMEOUT);
  } catch (err) {
    console.warn(`Redis SET failed (${err.message}). Safeguarding in memory for ${key}`);
    memoryStore.set(key, value);
    return 'OK';
  }
}

export async function setex(key, ttl, value) {
  if (!isRedisAvailable()) {
    memoryStore.set(key, value);
    memoryExpiry.set(key, Date.now() + (ttl * 1000));
    return 'OK';
  }
  
  try {
    if (restRedis) {
      return await withTimeout(restRedis.set(key, value, { ex: ttl }), REDIS_OP_TIMEOUT);
    }
    return await withTimeout(bullmqRedis.setex(key, ttl, value), REDIS_OP_TIMEOUT);
  } catch (err) {
    console.warn(`Redis SETEX failed (${err.message}). Using memory fallback.`);
    memoryStore.set(key, value);
    memoryExpiry.set(key, Date.now() + (ttl * 1000));
    return 'OK';
  }
}

export async function del(key) {
  if (!isRedisAvailable()) {
    memoryStore.delete(key);
    memoryExpiry.delete(key);
    return 1;
  }
  try {
    return await withTimeout(primaryClient.del(key), REDIS_OP_TIMEOUT);
  } catch (err) {
    memoryStore.delete(key);
    memoryExpiry.delete(key);
    return 1;
  }
}

export async function incr(key) {
  if (!isRedisAvailable()) {
    const current = parseInt(memoryStore.get(key) || '0', 10);
    const newValue = current + 1;
    memoryStore.set(key, String(newValue));
    return newValue;
  }
  try {
    return await withTimeout(primaryClient.incr(key), REDIS_OP_TIMEOUT);
  } catch (err) {
    const current = parseInt(memoryStore.get(key) || '0', 10);
    const newValue = current + 1;
    memoryStore.set(key, String(newValue));
    return newValue;
  }
}

export async function incrWithTTL(key, ttl) {
  if (!isRedisAvailable()) {
    const current = parseInt(memoryStore.get(key) || '0', 10);
    const newValue = current + 1;
    memoryStore.set(key, String(newValue));
    memoryExpiry.set(key, Date.now() + (ttl * 1000));
    return newValue;
  }
  
  try {
    if (restRedis) {
      const pipeline = restRedis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, ttl);
      const results = await withTimeout(pipeline.exec(), REDIS_OP_TIMEOUT);
      return results[0];
    }
    
    const pipeline = bullmqRedis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttl);
    const results = await withTimeout(pipeline.exec(), REDIS_OP_TIMEOUT);
    return results[0][1];
  } catch (err) {
    const current = parseInt(memoryStore.get(key) || '0', 10);
    const newValue = current + 1;
    memoryStore.set(key, String(newValue));
    memoryExpiry.set(key, Date.now() + (ttl * 1000));
    return newValue;
  }
}

export async function expire(key, seconds) {
  if (!isRedisAvailable()) {
    memoryExpiry.set(key, Date.now() + (seconds * 1000));
    return 1;
  }
  try {
    return await withTimeout(primaryClient.expire(key, seconds), REDIS_OP_TIMEOUT);
  } catch (err) {
    memoryExpiry.set(key, Date.now() + (seconds * 1000));
    return 1;
  }
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
  try {
    return await withTimeout(primaryClient.zadd(key, score, member), REDIS_OP_TIMEOUT);
  } catch (err) {
    let set = memoryStore.get(key) || {};
    if (typeof set === 'string') try { set = JSON.parse(set); } catch { set = {}; }
    set[member] = score;
    memoryStore.set(key, JSON.stringify(set));
    return 1;
  }
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
  try {
    return await withTimeout(primaryClient.zincrby(key, increment, member), REDIS_OP_TIMEOUT);
  } catch (err) {
    let set = memoryStore.get(key) || {};
    if (typeof set === 'string') try { set = JSON.parse(set); } catch { set = {}; }
    const current = parseInt(set[member] || '0', 10);
    set[member] = current + increment;
    memoryStore.set(key, JSON.stringify(set));
    return set[member];
  }
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
  
  try {
    if (restRedis) {
      return await withTimeout(restRedis.zrangebyscore(key, min, max, withScores ? { withScores: true } : undefined), REDIS_OP_TIMEOUT);
    }
    return await withTimeout(bullmqRedis.zrangebyscore(key, min, max, withScores ? 'WITHSCORES' : undefined), REDIS_OP_TIMEOUT);
  } catch (err) {
    return [];
  }
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
  
  try {
    if (restRedis) {
      return await withTimeout(restRedis.zrange(key, start, stop, withScores ? { withScores: true } : undefined), REDIS_OP_TIMEOUT);
    }
    
    if (withScores) {
      return await withTimeout(bullmqRedis.zrange(key, start, stop, 'WITHSCORES'), REDIS_OP_TIMEOUT);
    }
    return await withTimeout(bullmqRedis.zrange(key, start, stop), REDIS_OP_TIMEOUT);
  } catch (err) {
    return [];
  }
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
  try {
    return await withTimeout(primaryClient.zrem(key, member), REDIS_OP_TIMEOUT);
  } catch (err) {
    return 0;
  }
}

export async function keys(pattern) {
  if (!isRedisAvailable()) {
    // Simple pattern matching for in-memory store
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(memoryStore.keys()).filter(k => regex.test(k));
  }
  try {
     return await withTimeout(primaryClient.keys(pattern), REDIS_OP_TIMEOUT);
  } catch (err) {
     return [];
  }
}

/**
 * Execute a Lua script atomically.
 * Adapts between ioredis and @upstash/redis signatures.
 */
export async function evalLua(script, numkeys, ...args) {
  // Check if Redis is available
  if (!isRedisAvailable()) {
    throw new Error(
      'Redis is unavailable and Lua script execution cannot be emulated. ' +
      'Key selection is disabled. Please check Redis connection.'
    );
  }
  
  try {
    if (restRedis) {
      const keysArray = args.slice(0, numkeys);
      const argsArray = args.slice(numkeys);
      return await withTimeout(restRedis.eval(script, keysArray, argsArray), REDIS_OP_TIMEOUT);
    } else {
      return await withTimeout(bullmqRedis.eval(script, numkeys, ...args), REDIS_OP_TIMEOUT);
    }
  } catch (err) {
    throw err;
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
 * Includes enhanced keep-alive and reconnection settings.
 */
export function createDuplicate() {
  return bullmqRedis.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 0,
    tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10000,
    enableOfflineQueue: true,
    keepAlive: 300000,
    noDelay: true,
    socketIdleTimeout: 300000,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
  });
}

/**
 * Create a worker-optimized connection with BullMQ-specific settings.
 * Use this for BullMQ workers to ensure proper stalled job handling.
 */
export function createWorkerConnection() {
  return bullmqRedis.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 0,
    tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10000,
    enableOfflineQueue: true,
    keepAlive: 300000,
    noDelay: true,
    socketIdleTimeout: 300000,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,
  });
}

export default bullmqRedis;
