import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * OpenRouter adapter.
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Auth: Bearer token
 * Format: OpenAI-compatible + HTTP-Referer and X-Title headers
 */
export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('openrouter', 'https://openrouter.ai/api/v1/chat/completions');
  }

  /**
   * OpenRouter requires HTTP-Referer and X-Title headers for ranking/tracking.
   */
  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://omnirouteai.app',
      'X-Title': 'OmniRouteAI',
    };
  }
}
