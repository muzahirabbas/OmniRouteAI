import IoRedis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ─── 1. BullMQ TCP Client (ioredis) ──────────────────────────────────
// BullMQ STRICTLY requires an ioredis TCP connection.
const bullmqRedis = new IoRedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ to allow infinite retries without crashing the Node process
  enableReadyCheck: false,    // Strongly recommended by Upstash to avoid connection stall checks
  family: 0,                  // CRITICAL: Required for Railway IPv6 routing to Upstash
  tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

bullmqRedis.on('error', (err) => {
  // Suppress verbose reconnect errors from standard drops
  if (err.message && !err.message.includes('ECONNREFUSED')) {
    // console.error(JSON.stringify({ level: 'error', msg: 'BullMQ TCP connection error expected drop', error: err.message }));
  }
});
bullmqRedis.on('connect', () => {
  console.log(JSON.stringify({ level: 'info', msg: 'BullMQ TCP connected' }));
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

// ─── Helper functions ────────────────────────────────────────────────

export async function get(key) {
  return primaryClient.get(key);
}

export async function set(key, value) {
  return primaryClient.set(key, value);
}

export async function setex(key, ttl, value) {
  return primaryClient.setex(key, ttl, value);
}

export async function del(key) {
  return primaryClient.del(key);
}

export async function incr(key) {
  return primaryClient.incr(key);
}

export async function incrWithTTL(key, ttl) {
  const pipeline = primaryClient.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, ttl);
  const results = await pipeline.exec();
  
  // Upstash returns plain results array. ioredis returns array of [err, result] tuples.
  return restRedis ? results[0] : results[0][1];
}

export async function expire(key, seconds) {
  return primaryClient.expire(key, seconds);
}

export async function zadd(key, score, member) {
  return primaryClient.zadd(key, { score, member });
}

export async function zincrby(key, increment, member) {
  // ioredis uses (key, increment, member), @upstash uses (key, increment, member) as well
  return primaryClient.zincrby(key, increment, member);
}

export async function zrangeByScore(key, min, max, withScores = false) {
  if (restRedis) {
    return restRedis.zrangebyscore(key, min, max, withScores ? { withScores: true } : undefined);
  } else {
    return bullmqRedis.zrangebyscore(key, min, max, withScores ? 'WITHSCORES' : undefined);
  }
}

export async function zrange(key, start, stop, withScores = false) {
  if (restRedis) {
    return restRedis.zrange(key, start, stop, withScores ? { withScores: true } : undefined);
  } else {
    // ioredis optionally takes 'WITHSCORES' as a variadic string argument
    if (withScores) {
      return bullmqRedis.zrange(key, start, stop, 'WITHSCORES');
    }
    return bullmqRedis.zrange(key, start, stop);
  }
}

export async function zrem(key, member) {
  return primaryClient.zrem(key, member);
}

export async function keys(pattern) {
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
