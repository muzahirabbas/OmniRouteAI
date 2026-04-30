import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Mistral AI Adapter.
 *
 * Base URL: https://api.mistral.ai/v1/chat/completions
 */
export class MistralAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('mistral', 'https://api.mistral.ai/v1/chat/completions');
  }
}
