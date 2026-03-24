import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Inception Labs Adapter (Mercury models)
 * OpenAI-compatible format.
 */
export class InceptionAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('inception', 'https://api.inceptionlabs.ai/v1/chat/completions');
  }
}
