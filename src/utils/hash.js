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
