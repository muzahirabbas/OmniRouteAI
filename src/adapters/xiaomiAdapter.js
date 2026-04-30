import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Xiaomi MiMo Adapter
 * OpenAI-compatible format.
 */
export class XiaomiAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('xiaomi', 'https://api.xiaomimimo.com/v1/chat/completions');
  }
}
