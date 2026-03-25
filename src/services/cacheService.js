import { get, setex } from '../config/redis.js';
import { hashPrompt } from '../utils/hash.js';

/**
 * Redis-based exact-match cache service.
 *
 * Cache key = sha256(prompt + model + taskType + systemPrompt)
 * This ensures that identical prompts with different system instructions
 * or different task classification never collide in cache.
 */

const DEFAULT_TTL = parseInt(process.env.CACHE_TTL, 10) || 3600; // 1 hour
const KEY_PREFIX  = 'cache:';

/**
 * Check cache for a prompt/model/taskType/systemPrompt combination.
 *
 * @param {string} prompt
 * @param {string} [model='']
 * @param {string} [taskType='']
 * @param {string} [systemPrompt='']
 * @returns {Promise<object|null>} cached response or null
 */
export async function getCached(prompt, model = '', taskType = '', systemPrompt = '') {
  const key    = KEY_PREFIX + hashPrompt(prompt, model, taskType, systemPrompt);
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
 * @param {string} [systemPrompt='']
 * @param {object} response - { output, provider, model, tokens }
 * @param {number} [ttl]    - TTL in seconds (default 1 hour)
 */
export async function setCached(
  prompt,
  model        = '',
  taskType     = '',
  systemPrompt = '',
  response,
  ttl          = DEFAULT_TTL,
) {
  const key = KEY_PREFIX + hashPrompt(prompt, model, taskType, systemPrompt);
  await setex(key, ttl, JSON.stringify(response));
}
