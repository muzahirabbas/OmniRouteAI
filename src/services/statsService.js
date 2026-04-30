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
 * Track a request's usage stats in Redis.
 *
 * @param {string} provider  - provider name (e.g. 'openai', 'anthropic')
 * @param {string} key     - API key
 * @param {object} [tokens] - { input, output, reasoning }
 */
export async function trackRequest(provider, key, tokens = { input: 0, output: 0, reasoning: 0 }) {
  const today = getDateKey();
  const inp = tokens?.input  || 0;
  const out = tokens?.output || 0;
  const reason = tokens?.reasoning || 0;

  const { getClient } = await import('../config/redis.js');
  const client = getClient();
  const p = client.pipeline();

  // Request counts
  p.incr(`stats:${today}:requests:${provider}`);
  p.expire(`stats:${today}:requests:${provider}`, DAY_TTL);
  p.incr(`stats:${today}:requests:total`);
  p.expire(`stats:${today}:requests:total`, DAY_TTL);

  // Token counts
  if (inp > 0) {
    p.incrby(`stats:${today}:tokens:input:${provider}`, inp);
    p.expire(`stats:${today}:tokens:input:${provider}`, DAY_TTL);
    p.incrby(`stats:${today}:key:${provider}:${key}:tokens:input`, inp);
    p.expire(`stats:${today}:key:${provider}:${key}:tokens:input`, DAY_TTL);
  }
  if (out > 0) {
    p.incrby(`stats:${today}:tokens:output:${provider}`, out);
    p.expire(`stats:${today}:tokens:output:${provider}`, DAY_TTL);
    p.incrby(`stats:${today}:key:${provider}:${key}:tokens:output`, out);
    p.expire(`stats:${today}:key:${provider}:${key}:tokens:output`, DAY_TTL);
  }
  
  // Reasoning token counts (for reasoning/thinking models)
  if (reason > 0) {
    p.incrby(`stats:${today}:tokens:reasoning:${provider}`, reason);
    p.expire(`stats:${today}:tokens:reasoning:${provider}`, DAY_TTL);
    p.incrby(`stats:${today}:key:${provider}:${key}:tokens:reasoning`, reason);
    p.expire(`stats:${today}:key:${provider}:${key}:tokens:reasoning`, DAY_TTL);
  }

  // Per-key tracking (include provider in key for uniqueness)
  p.incr(`stats:${today}:key:${provider}:${key}:requests`);
  p.expire(`stats:${today}:key:${provider}:${key}:requests`, DAY_TTL);

  await p.exec().catch(err => {
    console.warn(`Stats pipeline failed: ${err.message}`);
  });
}

/**
 * Track a search request's usage stats in Redis.
 */
export async function trackSearchRequest(provider, key, tokens = { input: 0, output: 0 }) {
  const today = getDateKey();
  const inp = tokens?.input || 0;
  const out = tokens?.output || 0;
  
  const { getClient } = await import('../config/redis.js');
  const client = getClient();
  const p = client.pipeline();
  
  // Search request counts
  p.incr(`search_stats:${today}:requests:${provider}`);
  p.expire(`search_stats:${today}:requests:${provider}`, DAY_TTL);
  p.incr(`search_stats:${today}:requests:total`);
  p.expire(`search_stats:${today}:requests:total`, DAY_TTL);
  
  // Per-key tracking
  p.incr(`search_stats:${today}:key:${provider}:${key}:requests`);
  p.expire(`search_stats:${today}:key:${provider}:${key}:requests`, DAY_TTL);
  
  await p.exec().catch(err => {
    console.warn(`Search stats pipeline failed: ${err.message}`);
  });
}

/**
 * Track a search error in Redis.
 */
export async function trackSearchError(provider) {
  const today = getDateKey();
  const { getClient } = await import('../config/redis.js');
  const client = getClient();
  
  await client.incr(`search_stats:${today}:errors:${provider}`).catch(() => {});
  await client.expire(`search_stats:${today}:errors:${provider}`, DAY_TTL).catch(() => {});
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
 * @returns {Promise<{ input: number, output: number, reasoning?: number }>}
 */
export async function extractTokens(rawResponse, outputText = '', inputText = '', model = 'gpt-3.5-turbo') {
  const tokens = { input: 0, output: 0, reasoning: 0 };

  if (rawResponse) {
    // ── OpenAI-compatible (Groq, OpenAI, xAI, DeepSeek, etc.) ──────
    if (rawResponse.usage?.prompt_tokens !== undefined) {
      tokens.input  = rawResponse.usage.prompt_tokens      || 0;
      tokens.output = rawResponse.usage.completion_tokens  || 0;
      // Extract reasoning tokens (OpenAI o1/o3, GPT-5)
      if (rawResponse.usage?.output_tokens_details?.reasoning_tokens !== undefined) {
        tokens.reasoning = rawResponse.usage.output_tokens_details.reasoning_tokens || 0;
      }
      return tokens;
    }

    // ── Anthropic ────────────────────────────────────────────────────
    if (rawResponse.usage?.input_tokens !== undefined) {
      tokens.input  = rawResponse.usage.input_tokens  || 0;
      tokens.output = rawResponse.usage.output_tokens || 0;
      // Extract thinking tokens (Claude 3.7+ with thinking mode)
      if (rawResponse.usage?.thinking_tokens !== undefined) {
        tokens.reasoning = rawResponse.usage.thinking_tokens || 0;
      }
      return tokens;
    }

    // ── Gemini 2.0+ (thinking tokens) ────────────────────────────────
    if (rawResponse.usageMetadata) {
      tokens.input  = rawResponse.usageMetadata.promptTokenCount      || 0;
      tokens.output = rawResponse.usageMetadata.candidatesTokenCount  || 0;
      // Extract thinking tokens from Gemini's tokenMetadata
      if (rawResponse.usageMetadata?.tokenMetadata?.outputTokenDetails?.thinkingTokens !== undefined) {
        tokens.reasoning = rawResponse.usageMetadata.tokenMetadata.outputTokenDetails.thinkingTokens || 0;
      }
      return tokens;
    }

    // ── Cohere V2 ─────────────────────────────────────────────────────
    if (rawResponse.usage?.tokens) {
      tokens.input  = rawResponse.usage.tokens.input_tokens  || 0;
      tokens.output = rawResponse.usage.tokens.output_tokens || 0;
      return tokens;
    }

    // ── Cohere V1 (legacy) ───────────────────────────────────────────
    if (rawResponse.meta?.tokens) {
      tokens.input  = rawResponse.meta.tokens.input_tokens  || 0;
      tokens.output = rawResponse.meta.tokens.output_tokens || 0;
      return tokens;
    }

    // ── Generic catch-all ────────────────────────────────────────────
    if (rawResponse.inputTokens !== undefined || rawResponse.outputTokens !== undefined) {
      tokens.input  = rawResponse.inputTokens  || 0;
      tokens.output = rawResponse.outputTokens || 0;
      return tokens;
    }
  }

  // ── Fallback: tiktoken or heuristic estimation ─────────────────────
  const [input, output] = await Promise.all([
    estimateTokens(inputText, model),
    estimateTokens(outputText, model),
  ]);
  
  tokens.input = input;
  tokens.output = output;
  
  return tokens;
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
 * Aggregate stats and persist to Firestore `daily_stats`.
 * Also persists per-key stats to `daily_stats/{date}/keys/{key}` subcollection.
 * 
 * @param {string} [dateKey] - YYYY-MM-DD (defaults to today)
 */
export async function aggregateDaily(dateKey = null) {
  const targetDate = dateKey || getDateKey();

  try {
    const statsKeys = await keys(`stats:${targetDate}:*`);
    const stats     = {};
    const keyStats  = {}; // Map: key -> { tokensIn, tokensOut, tokensReasoning, requests }

    // First pass: collect all stats
    for (const key of statsKeys) {
      const value    = await get(key);
      const statName = key.replace(`stats:${targetDate}:`, '');

      // Check if this is a per-key stat: key:{apiKey}:tokens:input|output|reasoning|requests
      const keyMatch = statName.match(/^key:(.+):(tokens:(?:input|output|reasoning)|requests)$/);
      if (keyMatch) {
        const apiKey = keyMatch[1];
        const statType = keyMatch[2];
        if (!keyStats[apiKey]) keyStats[apiKey] = { tokensIn: 0, tokensOut: 0, tokensReasoning: 0, requests: 0 };
        
        if (statType === 'tokens:input') keyStats[apiKey].tokensIn = parseInt(value, 10) || 0;
        else if (statType === 'tokens:output') keyStats[apiKey].tokensOut = parseInt(value, 10) || 0;
        else if (statType === 'tokens:reasoning') keyStats[apiKey].tokensReasoning = parseInt(value, 10) || 0;
        else if (statType === 'requests') keyStats[apiKey].requests = parseInt(value, 10) || 0;
      } else {
        stats[statName] = parseInt(value, 10) || 0;
      }
    }

    // Calculate total input/output/reasoning tokens from provider-specific values
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalReasoningTokens = 0;

    for (const [key, value] of Object.entries(stats)) {
      if (key.startsWith('tokens:input:') && !key.includes('total')) {
        totalInputTokens += value;
      }
      if (key.startsWith('tokens:output:') && !key.includes('total')) {
        totalOutputTokens += value;
      }
      if (key.startsWith('tokens:reasoning:') && !key.includes('total')) {
        totalReasoningTokens += value;
      }
    }

    // Add totals to stats
    stats['tokens:input:total'] = totalInputTokens;
    stats['tokens:output:total'] = totalOutputTokens;
    stats['tokens:reasoning:total'] = totalReasoningTokens;

    const db = getDb();
    
    // Write daily aggregate
    await db.collection('daily_stats').doc(targetDate).set({
      ...stats,
      date:          targetDate,
      aggregated_at: new Date().toISOString(),
      total_keys:    Object.keys(keyStats).length,
    }, { merge: true });

    // Write per-key stats as subcollection
    const keyBatch = db.batch();
    for (const [apiKey, data] of Object.entries(keyStats)) {
      // Create a safe document ID from the API key (Firestore document IDs have restrictions)
      const docId = Buffer.from(apiKey).toString('base64url').slice(0, 100);
      const keyRef = db.collection('daily_stats').doc(targetDate).collection('keys').doc(docId);
      keyBatch.set(keyRef, {
        api_key:          apiKey,
        tokens_in:        data.tokensIn,
        tokens_out:       data.tokensOut,
        tokens_reasoning: data.tokensReasoning,
        requests:         data.requests,
        aggregated_at: new Date().toISOString(),
      });
    }

    if (Object.keys(keyStats).length > 0) {
      await keyBatch.commit();
    }

    return stats;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: `Failed to aggregate daily stats for ${targetDate}`, error: err.message }));
    throw err;
  }
}

/**
 * Get historical per-key stats for a provider from Firestore.
 * 
 * @param {string} provider - Provider name
 * @param {number} days - Number of days to retrieve
 * @returns {Promise<object[]>} Array of { date, keys: [{ apiKey, tokensIn, tokensOut, requests }] }
 */
export async function getKeyStatsHistory(provider, days = 7) {
  const db = getDb();
  const results = [];
  
  // Get all daily_stats docs for the date range
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startKey = startDate.toISOString().slice(0, 10);
  
  try {
    const snapshot = await db.collection('daily_stats')
      .orderBy('__name__')
      .startAt(startKey)
      .get();
    
    for (const doc of snapshot.docs) {
      const date = doc.id;
      const data = doc.data();
      
      // Get keys subcollection for this date
      const keysSnapshot = await db.collection('daily_stats').doc(date).collection('keys').get();
      
      // Filter to only keys belonging to this provider
      // We need to look up the provider from the api_keys collection or track it in daily_stats
      // For now, return all keys - the caller can filter
      const keys = [];
      keysSnapshot.forEach(keyDoc => {
        const kd = keyDoc.data();
        keys.push({
          apiKey:          kd.api_key,
          tokensIn:        kd.tokens_in || 0,
          tokensOut:       kd.tokens_out || 0,
          tokensReasoning: kd.tokens_reasoning || 0,
          requests:        kd.requests || 0,
        });
      });
      
      if (keys.length > 0) {
        results.push({ date, keys });
      }
    }
  } catch (err) {
    console.warn(`Failed to get key stats history: ${err.message}`);
  }
  
  return results;
}

/**
 * Reset Redis counters for a specific day.
 * 
 * @param {string} [dateKey] - YYYY-MM-DD (defaults to today)
 */
export async function resetCounters(dateKey = null) {
  const targetDate = dateKey || getDateKey();
  const statsKeys  = await keys(`stats:${targetDate}:*`);
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
