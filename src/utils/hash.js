import { createHash } from 'node:crypto';

/**
 * Generate a SHA-256 hash of prompt + model + taskType for cache keying.
 * @param {string} prompt
 * @param {string} [model='']
 * @param {string} [taskType='']
 * @returns {string} hex digest
 */
export function hashPrompt(prompt, model = '', taskType = '') {
  const input = `${prompt}|${model}|${taskType}`;
  return createHash('sha256').update(input).digest('hex');
}
