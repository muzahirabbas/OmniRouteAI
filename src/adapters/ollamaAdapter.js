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

  // Ollama doesn't require auth
  buildHeaders(apiKey) {
    return { 'Content-Type': 'application/json' };
  }
}
