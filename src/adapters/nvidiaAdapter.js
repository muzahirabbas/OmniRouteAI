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

  buildBody(prompt, model, stream = false, options = {}) {
    const body = super.buildBody(prompt, model, stream, options);
    
    // NVIDIA NIM returns 400 if unknown fields like 'metadata' or 'prediction' are present
    delete body.metadata;
    delete body.prediction;
    
    return body;
  }
}
