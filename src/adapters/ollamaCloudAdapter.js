import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Ollama Cloud adapter.
 * Used for hosted Ollama services (e.g. on OpenRouter, Groq, or dedicated hosts).
 * Endpoint: Provided via config (default: https://ollama.com/api)
 */
export class OllamaCloudAdapter extends OpenAICompatibleAdapter {
  constructor() {
    // Default to a placeholder, usually configured via PROVIDER_OLLAMA_CLOUD_ENDPOINT
    super('ollama-cloud', process.env.PROVIDER_OLLAMA_CLOUD_ENDPOINT || 'https://ollama.com/api');
  }
}
