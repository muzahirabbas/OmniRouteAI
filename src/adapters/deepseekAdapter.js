import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * DeepSeek adapter.
 * Endpoint: https://api.deepseek.com/v1/chat/completions
 * Auth: Bearer token
 * Format: OpenAI-compatible
 */
export class DeepSeekAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('deepseek', 'https://api.deepseek.com/v1/chat/completions');
  }
}
