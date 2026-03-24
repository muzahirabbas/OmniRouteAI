import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Moonshot (Kimi) adapter.
 * Endpoint: https://api.moonshot.cn/v1/chat/completions
 * Auth: Bearer token
 * Format: OpenAI-compatible
 */
export class MoonshotAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('moonshot', 'https://api.moonshot.cn/v1/chat/completions');
  }
}
