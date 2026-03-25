import { incrWithTTL, get, keys, del } from '../config/redis.js';
import { getDb } from '../config/firestore.js';
import { estimateTokens as estimateTokensFallback } from './tokenService.js';

/**
 * Stats service.
 *
 * Token tracking strategy:
 * 1. Prefer provider-returned token fields (most accurate)
 * 2. Fallback: tiktoken estimation (if installed)
 * 3. Last resort: heuristic estimation (chars / 4)
 *
 * Token field detection covers:
 * - OpenAI-compatible: usage.prompt_tokens / usage.completion_tokens
 * - Anthropic:         usage.input_tokens  / usage.output_tokens
 * - Gemini:            usageMetadata.promptTokenCount / candidatesTokenCount
 * - Cohere:            meta.tokens.input_tokens / output_tokens
 * - Generic:           inputTokens / outputTokens  (catch-all)
 *
 * Real-time counters in Redis (24h TTL).
 * Daily aggregation → Firestore `daily_stats`.
 */

const DAY_TTL = 86400; // 24 hours

/**
 * Track a request's stats in Redis.
 *
 * @param {string} provider
 * @param {string} key     - API key
 * @param {object} [tokens] - { input, output }
 */
export async function trackRequest(provider, key, tokens = { input: 0, output: 0 }) {
  const today = getDateKey();

  // Request count
  await incrWithTTL(`stats:${today}:requests:${provider}`, DAY_TTL);
  await incrWithTTL(`stats:${today}:requests:total`,       DAY_TTL);

  // Token counts
  const inp = tokens?.input  || 0;
  const out = tokens?.output || 0;

  if (inp > 0) await incrByWithTTL(`stats:${today}:tokens:input:${provider}`,  inp, DAY_TTL);
  if (out > 0) await incrByWithTTL(`stats:${today}:tokens:output:${provider}`, out, DAY_TTL);

  // Per-key tracking
  await incrWithTTL(`stats:${today}:key:${key}:requests`, DAY_TTL);
}

/**
 * Estimate tokens from text when provider doesn't return token counts.
 * Uses tiktoken if available, falls back to character-based estimation.
 *
 * @param {string} text
 * @param {string} [model] - Optional model for tiktoken
 * @returns {Promise<number>}
 */
export async function estimateTokens(text, model) {
  if (!text) return 0;
  
  // Try to use tiktoken-based estimation from tokenService
  try {
    const { countTokens } = await import('./tokenService.js');
    return await countTokens(text, model);
  } catch {
    // Fallback to simple character-based estimation
    return estimateTokensFallback(text);
  }
}

/**
 * Estimate input tokens BEFORE sending a request.
 * This is called by routerService before the request to ensure
 * input token counts are always available for quota accounting.
 *
 * @param {string} prompt
 * @param {string} [systemPrompt='']
 * @param {string} [model='gpt-3.5-turbo']
 * @returns {Promise<number>}
 */
export async function estimateInputTokens(prompt, systemPrompt = '', model = 'gpt-3.5-turbo') {
  const { estimateInputTokens: estimateWithTiktoken } = await import('./tokenService.js');
  return estimateWithTiktoken(prompt, systemPrompt, model);
}

/**
 * Extract tokens from a provider response, with fallback estimation.
 * Checks all known provider formats in priority order.
 *
 * @param {object} rawResponse   - raw provider response (may be null for streaming)
 * @param {string} outputText    - generated text (for fallback estimation)
 * @param {string} [inputText=''] - prompt text (for fallback estimation)
 * @param {string} [model='gpt-3.5-turbo'] - model for tiktoken fallback
 * @returns {Promise<{ input: number, output: number }>}
 */
export async function extractTokens(rawResponse, outputText = '', inputText = '', model = 'gpt-3.5-turbo') {
  if (rawResponse) {
    // ── OpenAI-compatible (Groq, OpenAI, xAI, DeepSeek, etc.) ──────
    if (rawResponse.usage?.prompt_tokens !== undefined) {
      return {
        input:  rawResponse.usage.prompt_tokens      || 0,
        output: rawResponse.usage.completion_tokens  || 0,
      };
    }

    // ── Anthropic ────────────────────────────────────────────────────
    if (rawResponse.usage?.input_tokens !== undefined) {
      return {
        input:  rawResponse.usage.input_tokens  || 0,
        output: rawResponse.usage.output_tokens || 0,
      };
    }

    // ── Gemini ───────────────────────────────────────────────────────
    if (rawResponse.usageMetadata) {
      return {
        input:  rawResponse.usageMetadata.promptTokenCount      || 0,
        output: rawResponse.usageMetadata.candidatesTokenCount  || 0,
      };
    }

    // ── Cohere ───────────────────────────────────────────────────────
    if (rawResponse.meta?.tokens) {
      return {
        input:  rawResponse.meta.tokens.input_tokens  || 0,
        output: rawResponse.meta.tokens.output_tokens || 0,
      };
    }

    // ── Generic catch-all ────────────────────────────────────────────
    if (rawResponse.inputTokens !== undefined || rawResponse.outputTokens !== undefined) {
      return {
        input:  rawResponse.inputTokens  || 0,
        output: rawResponse.outputTokens || 0,
      };
    }
  }

  // ── Fallback: tiktoken or heuristic estimation ─────────────────────
  const [input, output] = await Promise.all([
    estimateTokens(inputText, model),
    estimateTokens(outputText, model),
  ]);
  
  return { input, output };
}

/**
 * Get current stats snapshot.
 *
 * @returns {Promise<object>}
 */
export async function getStats() {
  const today         = getDateKey();
  const totalRequests = parseInt((await get(`stats:${today}:requests:total`)) || '0', 10);

  return {
    date:          today,
    totalRequests,
    timestamp:     new Date().toISOString(),
  };
}

/**
 * Aggregate today's stats and persist to Firestore `daily_stats`.
 */
export async function aggregateDaily() {
  const today = getDateKey();

  try {
    const statsKeys = await keys(`stats:${today}:*`);
    const stats     = {};

    for (const key of statsKeys) {
      const value    = await get(key);
      const statName = key.replace(`stats:${today}:`, '');
      stats[statName] = parseInt(value, 10) || 0;
    }

    const db = getDb();
    await db.collection('daily_stats').doc(today).set({
      ...stats,
      date:          today,
      aggregated_at: new Date().toISOString(),
    }, { merge: true });

    return stats;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Failed to aggregate daily stats', error: err.message }));
    throw err;
  }
}

/**
 * Reset Redis counters for today.
 */
export async function resetCounters() {
  const today     = getDateKey();
  const statsKeys = await keys(`stats:${today}:*`);
  for (const key of statsKeys) {
    await del(key);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getDateKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function incrByWithTTL(key, amount, ttl) {
  const { getClient } = await import('../config/redis.js');
  const client = getClient();
  const pipeline = client.pipeline();
  pipeline.incrby(key, amount);
  pipeline.expire(key, ttl);
  await pipeline.exec();
}
