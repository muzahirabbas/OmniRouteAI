import { AnthropicAdapter } from './anthropicAdapter.js';

/**
 * Minimax AI Adapter.
 *
 * Uses Anthropic-compatible format.
 * Base URL: https://api.minimax.io/anthropic/v1/messages
 */
export class MinimaxAdapter extends AnthropicAdapter {
  constructor() {
    super();
    this.providerName = 'minimax';
    this.endpoint = 'https://api.minimax.io/anthropic/v1/messages';
  }

  buildHeaders(apiKey, options = {}) {
    const headers = {
      'Content-Type':      'application/json',
      'Authorization':     `Bearer ${apiKey}`,
      'anthropic-version': this.apiVersion, // Required by Minimax's Anthropic-compatible endpoint
    };

    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }

    return headers;
  }
}
