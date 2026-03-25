/**
 * Rule-based prompt classifier with configurable keywords.
 *
 * Keywords can be overridden via Firestore collection `config/classifier_keywords`.
 * This allows runtime customization without code changes.
 *
 * Returns: 'coding' | 'fast' | 'fast_loop' | 'general'
 */

import { getDb } from '../config/firestore.js';
import { get, setex, del } from '../config/redis.js';

// Default keywords (fallback if Firestore is unavailable)
const DEFAULT_CODING_KEYWORDS = [
  'error', 'fix', 'bug', 'debug', 'code', 'function', 'class',
  'compile', 'syntax', 'exception', 'stack trace', 'implement',
  'refactor', 'typescript', 'javascript', 'python', 'java', 'rust',
  'api', 'endpoint', 'database', 'sql', 'query', 'regex'
];

const DEFAULT_FAST_LOOP_KEYWORDS = [
  'step', 'loop', 'iterate', 'repeat', 'cycle', 'batch',
  'for each', 'foreach', 'while', 'sequence', 'pipeline'
];

const CACHE_KEY = 'config:classifier_keywords';
const CACHE_TTL = 300; // 5 minutes

/**
 * Load classifier keywords from Firestore cache.
 * @returns {Promise<{coding: string[], fastLoop: string[]}>}
 */
async function loadKeywords() {
  try {
    // Try Redis cache first
    const cached = await get(CACHE_KEY);
    if (cached) {
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }

    // Load from Firestore
    const db = getDb();
    const docRef = db.collection('config').doc('classifier_keywords');
    const doc = await docRef.get();

    let keywords = {
      coding: DEFAULT_CODING_KEYWORDS,
      fastLoop: DEFAULT_FAST_LOOP_KEYWORDS,
    };

    if (doc.exists) {
      const data = doc.data();
      if (data.coding_keywords && Array.isArray(data.coding_keywords)) {
        keywords.coding = data.coding_keywords;
      }
      if (data.fast_loop_keywords && Array.isArray(data.fast_loop_keywords)) {
        keywords.fastLoop = data.fast_loop_keywords;
      }
    }

    // Cache in Redis
    await setex(CACHE_KEY, CACHE_TTL, JSON.stringify(keywords));

    return keywords;
  } catch (err) {
    // Fallback to defaults on error
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'Failed to load classifier keywords from Firestore, using defaults',
      error: err.message,
    }));

    return {
      coding: DEFAULT_CODING_KEYWORDS,
      fastLoop: DEFAULT_FAST_LOOP_KEYWORDS,
    };
  }
}

/**
 * Invalidate the classifier keywords cache.
 * Call this when updating keywords in Firestore.
 */
export async function invalidateKeywordsCache() {
  try {
    await del(CACHE_KEY);
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Classifier keywords cache invalidated',
    }));
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'Failed to invalidate classifier keywords cache',
      error: err.message,
    }));
  }
}

/**
 * Update classifier keywords in Firestore.
 * @param {object} keywords - { coding: string[], fastLoop: string[] }
 */
export async function updateKeywords(keywords) {
  try {
    const db = getDb();
    await db.collection('config').doc('classifier_keywords').set({
      coding_keywords: keywords.coding || DEFAULT_CODING_KEYWORDS,
      fast_loop_keywords: keywords.fastLoop || DEFAULT_FAST_LOOP_KEYWORDS,
      updated_at: new Date().toISOString(),
    }, { merge: true });

    // Invalidate cache
    await invalidateKeywordsCache();

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get current classifier keywords.
 * @returns {Promise<{coding: string[], fastLoop: string[]}>}
 */
export async function getKeywords() {
  return loadKeywords();
}

/**
 * Classify a prompt into a task type.
 * Uses configurable keywords from Firestore with local cache.
 *
 * @param {string} prompt
 * @returns {'coding' | 'fast' | 'fast_loop' | 'general'}
 */
export async function classify(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'general';

  const { coding, fastLoop } = await loadKeywords();
  const lower = prompt.toLowerCase();

  // Check coding keywords
  for (const kw of coding) {
    if (lower.includes(kw)) return 'coding';
  }

  // Check fast_loop keywords
  for (const kw of fastLoop) {
    if (lower.includes(kw)) return 'fast_loop';
  }

  // Short prompts → fast
  if (prompt.length < 100) return 'fast';

  return 'general';
}

// Sync wrapper for backward compatibility (uses cached keywords)
let cachedKeywords = null;
let cacheTime = 0;
const SYNC_CACHE_TTL = 60000; // 1 minute

function getSyncKeywords() {
  const now = Date.now();
  if (cachedKeywords && now - cacheTime < SYNC_CACHE_TTL) {
    return cachedKeywords;
  }

  // Load synchronously from memory (async load happens in background)
  cachedKeywords = {
    coding: DEFAULT_CODING_KEYWORDS,
    fastLoop: DEFAULT_FAST_LOOP_KEYWORDS,
  };
  cacheTime = now;

  // Trigger async refresh (non-blocking)
  loadKeywords().then(keywords => {
    cachedKeywords = keywords;
    cacheTime = Date.now();
  }).catch(() => {});

  return cachedKeywords;
}

/**
 * Synchronous classify function (for performance-critical paths).
 * Uses locally cached keywords (may be up to 1 minute stale).
 *
 * @param {string} prompt
 * @returns {'coding' | 'fast' | 'fast_loop' | 'general'}
 */
export function classifySync(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'general';

  const { coding, fastLoop } = getSyncKeywords();
  const lower = prompt.toLowerCase();

  // Check coding keywords
  for (const kw of coding) {
    if (lower.includes(kw)) return 'coding';
  }

  // Check fast_loop keywords
  for (const kw of fastLoop) {
    if (lower.includes(kw)) return 'fast_loop';
  }

  // Short prompts → fast
  if (prompt.length < 100) return 'fast';

  return 'general';
}
