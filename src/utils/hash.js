import { createHash } from 'node:crypto';

/**
 * Generate a SHA-256 hash for cache keying.
 *
 * Cache key includes:
 *   - prompt (the user message)
 *   - model  (the requested model)
 *   - taskType (classified or provided task type)
 *   - systemPrompt (system instruction, if any)
 *
 * Formula: sha256(prompt + "|" + model + "|" + taskType + "|" + systemPrompt)
 *
 * @param {string} prompt
 * @param {string} [model='']
 * @param {string} [taskType='']
 * @param {string} [systemPrompt='']
 * @returns {string} hex digest
 */
export function hashPrompt(prompt, model = '', taskType = '', systemPrompt = '') {
  // If prompt is multimodal (array/object), stringify it for a unique hash
  const promptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
  const input = `${promptStr}|${model}|${taskType}|${systemPrompt}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable, opaque identifier for a provider API key. Safe to send to clients.
 *
 * Derived from a SHA-256 of the full key; first 12 hex chars (48 bits of
 * entropy) is more than enough to avoid collisions for any realistic key
 * count. Deterministic, so the same id is derivable in GET, DELETE,
 * toggle, and history handlers without ever sending the secret to the
 * frontend.
 *
 * @param {string} key
 * @returns {string} 12-char hex id, or '' if key is empty
 */
export function keyId(key) {
  if (!key) return '';
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}
