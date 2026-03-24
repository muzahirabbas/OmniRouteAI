/**
 * Rule-based prompt classifier.
 *
 * Returns: 'coding' | 'fast' | 'fast_loop' | 'general'
 */

const CODING_KEYWORDS = [
  'error', 'fix', 'bug', 'debug', 'code', 'function', 'class',
  'compile', 'syntax', 'exception', 'stack trace', 'implement',
  'refactor', 'typescript', 'javascript', 'python', 'java', 'rust',
  'api', 'endpoint', 'database', 'sql', 'query', 'regex'
];

const FAST_LOOP_KEYWORDS = [
  'step', 'loop', 'iterate', 'repeat', 'cycle', 'batch',
  'for each', 'foreach', 'while', 'sequence', 'pipeline'
];

/**
 * Classify a prompt into a task type.
 * @param {string} prompt
 * @returns {'coding' | 'fast' | 'fast_loop' | 'general'}
 */
export function classify(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'general';

  const lower = prompt.toLowerCase();

  // Check coding keywords
  for (const kw of CODING_KEYWORDS) {
    if (lower.includes(kw)) return 'coding';
  }

  // Check fast_loop keywords
  for (const kw of FAST_LOOP_KEYWORDS) {
    if (lower.includes(kw)) return 'fast_loop';
  }

  // Short prompts → fast
  if (prompt.length < 100) return 'fast';

  return 'general';
}
