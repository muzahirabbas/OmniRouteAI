import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Perplexity AI Adapter.
 *
 * Base URL: https://api.perplexity.ai/chat/completions
 */
export class PerplexityAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('perplexity', 'https://api.perplexity.ai/chat/completions');
  }
}
