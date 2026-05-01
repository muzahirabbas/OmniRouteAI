import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Cerebras Cloud Adapter
 * OpenAI-compatible format.
 */
export class CerebrasAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('cerebras', 'https://api.cerebras.ai/v1/chat/completions');
  }

  buildBody(prompt, model, stream = false, options = {}) {
    const body = super.buildBody(prompt, model, stream, options);
    
    // Cerebras returns 400 if unknown fields like 'metadata' or 'prediction' are present
    delete body.metadata;
    delete body.prediction;
    
    return body;
  }
}
