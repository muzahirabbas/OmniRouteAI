import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Xiaomi MiMo Adapter
 * OpenAI-compatible format.
 */
export class XiaomiAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('xiaomi', 'https://api.mimo.xiaomi.com/v1/chat/completions');
  }
}
