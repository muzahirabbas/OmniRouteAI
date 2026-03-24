import { get, setex } from '../config/redis.js';
import { hashPrompt } from '../utils/hash.js';

/**
 * Redis-based exact-match cache service.
 * Key = hash(prompt + model + taskType)
 */

const DEFAULT_TTL = parseInt(process.env.CACHE_TTL, 10) || 3600; // 1 hour
const KEY_PREFIX = 'cache:';

/**
 * Check cache for a prompt/model/taskType combination.
 *
 * @param {string} prompt
 * @param {string} [model='']
 * @param {string} [taskType='']
 * @returns {Promise<object|null>} cached response or null
 */
export async function getCached(prompt, model = '', taskType = '') {
  const key = KEY_PREFIX + hashPrompt(prompt, model, taskType);
  const cached = await get(key);

  if (cached) {
    if (typeof cached !== 'string') return cached;
    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Store a response in cache.
 *
 * @param {string} prompt
 * @param {string} [model='']
 * @param {string} [taskType='']
 * @param {object} response - { output, provider, model, tokens }
 * @param {number} [ttl] - TTL in seconds
 */
export async function setCached(prompt, model = '', taskType = '', response, ttl = DEFAULT_TTL) {
  const key = KEY_PREFIX + hashPrompt(prompt, model, taskType);
  await setex(key, ttl, JSON.stringify(response));
}
