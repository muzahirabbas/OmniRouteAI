import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Alibaba DashScope adapter (Qwen models).
 * Endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
 * Auth: Bearer token (DashScope API key)
 * Format: OpenAI-compatible
 */
export class AlibabaAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('alibaba', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  }
}
