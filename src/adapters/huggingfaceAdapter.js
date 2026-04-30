import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Hugging Face Serverless Inference API Adapter (OpenAI Compatible)
 * Endpoint: https://router.huggingface.co/v1/chat/completions
 */
export class HuggingFaceAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('huggingface', 'https://router.huggingface.co/v1/chat/completions');
  }
}
