/**
 * Rate limiter utility using Redis.
 * Uses sliding window algorithm for accurate rate limiting.
 */

import { get, setex, incrWithTTL } from '../config/redis.js';

const DEFAULT_WINDOW_MS = 60000; // 1 minute
const DEFAULT_MAX_REQUESTS = 10;

/**
 * Rate limiter middleware factory.
 * 
 * @param {object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.maxRequests - Max requests per window (default: 10)
 * @param {string} options.keyPrefix - Redis key prefix (default: 'ratelimit:')
 * @param {Function} options.getKey - Function to extract rate limit key from request (default: IP address)
 * @returns {Function} Fastify onRequest hook
 */
export function createRateLimiter(options = {}) {
  const {
    windowMs = DEFAULT_WINDOW_MS,
    maxRequests = DEFAULT_MAX_REQUESTS,
    keyPrefix = 'ratelimit:',
    getKey = (request) => request.ip || request.headers['x-forwarded-for'] || 'unknown',
  } = options;

  const windowSec = Math.ceil(windowMs / 1000);

  return async function rateLimitHook(request, reply) {
    // Skip rate limiting for health checks
    if (request.url.includes('/health')) return;

    const identifier = getKey(request);
    const key = `${keyPrefix}${identifier}`;

    try {
      // Atomically increment counter with TTL
      const current = await incrWithTTL(key, windowSec);

      if (current > maxRequests) {
        // Get TTL for retry-after header
        const ttl = await get(`${key}:ttl`);
        const retryAfter = ttl || windowSec;

        reply.header('X-RateLimit-Limit', maxRequests);
        reply.header('X-RateLimit-Remaining', 0);
        reply.header('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + retryAfter);
        reply.header('Retry-After', retryAfter);

        reply.code(429).send({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowSec} seconds.`,
          retryAfter,
        });
        
        // Halt request processing
        return reply;
      }

      // Set headers for successful requests
      reply.header('X-RateLimit-Limit', maxRequests);
      reply.header('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
      reply.header('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + windowSec);

    } catch (err) {
      // If Redis fails, allow the request but log the error
      console.error(JSON.stringify({
        level: 'error',
        msg: 'Rate limiter Redis error - allowing request',
        error: err.message,
      }));
    }
  };
}

/**
 * Pre-configured rate limiters for different use cases.
 */
export const rateLimiters = {
  // Strict rate limit for admin endpoints (10 req/min)
  admin: createRateLimiter({
    windowMs: 60000,
    maxRequests: 10,
    keyPrefix: 'ratelimit:admin:',
  }),

  // Moderate rate limit for API endpoints (30 req/min)
  api: createRateLimiter({
    windowMs: 60000,
    maxRequests: 30,
    keyPrefix: 'ratelimit:api:',
  }),

  // Lenient rate limit for chat completions (60 req/min)
  chat: createRateLimiter({
    windowMs: 60000,
    maxRequests: 60,
    keyPrefix: 'ratelimit:chat:',
  }),

  // Per-key rate limiting (for API key-based rate limiting)
  perKey: (apiKey) => createRateLimiter({
    windowMs: 60000,
    maxRequests: 100,
    keyPrefix: `ratelimit:key:${apiKey}:`,
    getKey: () => apiKey,
  }),
};

/**
 * Check rate limit without sending response.
 * Returns rate limit info for monitoring/headers.
 * 
 * @param {string} identifier - Unique identifier (IP, user ID, API key)
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowSec - Window in seconds
 * @returns {Promise<{current: number, remaining: number, reset: number, exceeded: boolean}>}
 */
export async function checkRateLimit(identifier, maxRequests = DEFAULT_MAX_REQUESTS, windowSec = 60) {
  const key = `ratelimit:${identifier}`;
  
  try {
    const current = parseInt((await get(key)) || '0', 10);
    const ttl = parseInt((await get(`${key}:ttl`)) || String(windowSec), 10);
    
    return {
      current,
      remaining: Math.max(0, maxRequests - current),
      reset: Math.floor(Date.now() / 1000) + ttl,
      exceeded: current >= maxRequests,
    };
  } catch {
    return {
      current: 0,
      remaining: maxRequests,
      reset: Math.floor(Date.now() / 1000) + windowSec,
      exceeded: false,
    };
  }
}
