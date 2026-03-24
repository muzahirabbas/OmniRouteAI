import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * OpenAI adapter.
 * Endpoint: https://api.openai.com/v1/chat/completions
 * Auth: Bearer token
 * Format: Standard OpenAI
 */
export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('openai', 'https://api.openai.com/v1/chat/completions');
  }
}
