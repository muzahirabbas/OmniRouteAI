import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * SambaNova Cloud Adapter
 * OpenAI-compatible format.
 */
export class SambaNovaAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('sambanova', 'https://api.sambanova.ai/v1/chat/completions');
  }
}
