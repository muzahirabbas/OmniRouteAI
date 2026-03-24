import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Cerebras Cloud Adapter
 * OpenAI-compatible format.
 */
export class CerebrasAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('cerebras', 'https://api.cerebras.ai/v1/chat/completions');
  }
}
