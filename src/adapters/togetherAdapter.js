import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Together AI adapter.
 * Endpoint: https://api.together.xyz/v1/chat/completions
 * Auth: Bearer token
 * Format: OpenAI-compatible
 */
export class TogetherAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('together', 'https://api.together.xyz/v1/chat/completions');
  }
}
