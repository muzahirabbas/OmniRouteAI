import { incrWithTTL, get, keys, del } from '../config/redis.js';
import { getDb } from '../config/firestore.js';

/**
 * Stats service.
 *
 * Token tracking:
 * - Extract from provider response when available
 * - Fallback heuristic: Math.ceil(text.length / 4)
 *
 * Real-time counters in Redis.
 * Daily aggregation → Firestore `daily_stats` collection.
 */

const DAY_TTL = 86400; // 24 hours

/**
 * Track a request's stats in Redis.
 *
 * @param {string} provider
 * @param {string} key - API key
 * @param {object} [tokens] - { input, output }
 */
export async function trackRequest(provider, key, tokens = { input: 0, output: 0 }) {
  const today = getDateKey();

  // Request count
  await incrWithTTL(`stats:${today}:requests:${provider}`, DAY_TTL);
  await incrWithTTL(`stats:${today}:requests:total`, DAY_TTL);

  // Token counts
  if (tokens.input > 0) {
    await incrByWithTTL(`stats:${today}:tokens:input:${provider}`, tokens.input, DAY_TTL);
  }
  if (tokens.output > 0) {
    await incrByWithTTL(`stats:${today}:tokens:output:${provider}`, tokens.output, DAY_TTL);
  }

  // Per-key tracking
  await incrWithTTL(`stats:${today}:key:${key}:requests`, DAY_TTL);
}

/**
 * Estimate tokens from text when provider doesn't return token counts.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Extract tokens from a provider response, with fallback estimation.
 *
 * @param {object} rawResponse - raw provider response
 * @param {string} outputText - the generated text (for fallback estimation)
 * @param {string} inputText - the prompt text (for fallback estimation)
 * @returns {{ input: number, output: number }}
 */
export function extractTokens(rawResponse, outputText = '', inputText = '') {
  // Try OpenAI-compatible format (Groq uses this)
  if (rawResponse?.usage) {
    return {
      input: rawResponse.usage.prompt_tokens || 0,
      output: rawResponse.usage.completion_tokens || 0,
    };
  }

  // Try Gemini format
  if (rawResponse?.usageMetadata) {
    return {
      input: rawResponse.usageMetadata.promptTokenCount || 0,
      output: rawResponse.usageMetadata.candidatesTokenCount || 0,
    };
  }

  // Fallback: heuristic
  return {
    input: estimateTokens(inputText),
    output: estimateTokens(outputText),
  };
}

/**
 * Get current stats snapshot.
 *
 * @returns {Promise<object>}
 */
export async function getStats() {
  const today = getDateKey();

  const totalRequests = parseInt(await get(`stats:${today}:requests:total`) || '0', 10);

  return {
    date: today,
    totalRequests,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Aggregate today's stats and write to Firestore `daily_stats`.
 */
export async function aggregateDaily() {
  const today = getDateKey();

  try {
    // Collect all stats keys for today
    const statsKeys = await keys(`stats:${today}:*`);
    const stats = {};

    for (const key of statsKeys) {
      const value = await get(key);
      // Extract the stat name from the key
      const statName = key.replace(`stats:${today}:`, '');
      stats[statName] = parseInt(value, 10) || 0;
    }

    // Write to Firestore
    const db = getDb();
    await db.collection('daily_stats').doc(today).set({
      ...stats,
      date: today,
      aggregated_at: new Date().toISOString(),
    }, { merge: true });

    return stats;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Failed to aggregate daily stats',
      error: err.message,
    }));
    throw err;
  }
}

/**
 * Reset Redis counters for today.
 */
export async function resetCounters() {
  const today = getDateKey();
  const statsKeys = await keys(`stats:${today}:*`);

  for (const key of statsKeys) {
    await del(key);
  }
}

// ─── Helpers ──────────────────────────────────────────────────

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
