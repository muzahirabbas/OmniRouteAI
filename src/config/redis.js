import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Redis client singleton with auto-reconnect.
 */
const redis = new Redis(REDIS_URL, {
  family: 0, // Enable dual-stack (IPv4 & IPv6) resolution for cloud platforms like Railway
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Redis connection error', error: err.message }));
});

redis.on('connect', () => {
  console.log(JSON.stringify({ level: 'info', msg: 'Redis connected', url: REDIS_URL }));
});

// ─── Helper functions ────────────────────────────────────────────────

export async function get(key) {
  return redis.get(key);
}

export async function set(key, value) {
  return redis.set(key, value);
}

export async function setex(key, ttl, value) {
  return redis.setex(key, ttl, value);
}

export async function del(key) {
  return redis.del(key);
}

export async function incr(key) {
  return redis.incr(key);
}

export async function incrWithTTL(key, ttl) {
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, ttl);
  const results = await pipeline.exec();
  return results[0][1]; // incr result
}

export async function expire(key, seconds) {
  return redis.expire(key, seconds);
}

export async function zadd(key, score, member) {
  return redis.zadd(key, score, member);
}

export async function zincrby(key, increment, member) {
  return redis.zincrby(key, increment, member);
}

export async function zrangeByScore(key, min, max, withScores = false) {
  if (withScores) {
    return redis.zrangebyscore(key, min, max, 'WITHSCORES');
  }
  return redis.zrangebyscore(key, min, max);
}

export async function zrange(key, start, stop, withScores = false) {
  if (withScores) {
    return redis.zrange(key, start, stop, 'WITHSCORES');
  }
  return redis.zrange(key, start, stop);
}

export async function zrem(key, member) {
  return redis.zrem(key, member);
}

export async function keys(pattern) {
  return redis.keys(pattern);
}

/**
 * Execute a Lua script atomically.
 * @param {string} script - Lua source
 * @param {number} numkeys - number of KEYS args
 * @param  {...any} args - KEYS and ARGV values
 */
export async function evalLua(script, numkeys, ...args) {
  return redis.eval(script, numkeys, ...args);
}

/**
 * Get the raw ioredis client for BullMQ or other advanced use.
 */
export function getClient() {
  return redis;
}

/**
 * Create a duplicate connection (needed for BullMQ worker).
 * BullMQ requires maxRetriesPerRequest to be null.
 */
export function createDuplicate() {
  return redis.duplicate({ maxRetriesPerRequest: null });
}

export default redis;
