import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * NVIDIA NIM adapter.
 * Endpoint: https://integrate.api.nvidia.com/v1/chat/completions
 * Auth: Bearer token (NVIDIA API key)
 * Format: OpenAI-compatible
 */
export class NvidiaAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions');
  }
}
