import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Groq adapter.
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 * Auth: Bearer token
 * Format: OpenAI-compatible
 */
export class GroqAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('groq', 'https://api.groq.com/openai/v1/chat/completions');
  }
}
