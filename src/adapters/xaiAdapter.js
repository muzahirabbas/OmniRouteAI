import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * xAI (Grok) adapter.
 * Endpoint: https://api.x.ai/v1/chat/completions
 * Auth: Bearer token
 * Format: OpenAI-compatible
 */
export class XAIAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('xai', 'https://api.x.ai/v1/chat/completions');
  }
}
