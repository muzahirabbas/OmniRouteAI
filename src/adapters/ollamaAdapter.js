import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Ollama adapter (local inference).
 * Endpoint: http://localhost:11434/v1/chat/completions
 * Auth: No auth required (local)
 * Format: OpenAI-compatible
 */
export class OllamaAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('ollama', process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions');
  }

  // Ollama doesn't require auth but forwards requestId for tracing
  buildHeaders(apiKey, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }
    return headers;
  }
}
