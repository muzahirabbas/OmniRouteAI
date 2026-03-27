import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * Generic Inference Adapter for OpenAI-compatible providers.
 *
 * Supported providers: 
 * - Fireworks: https://api.fireworks.ai/inference/v1/chat/completions
 * - Nebius: https://api.studio.nebius.ai/v1/chat/completions
 * - SiliconFlow: https://api.siliconflow.cn/v1/chat/completions
 * - Hyperbolic: https://api.hyperbolic.xyz/v1/chat/completions
 * - Chutes: https://llm.chutes.ai/v1/chat/completions
 * - Nanobanana: https://api.nanobananaapi.ai/v1/chat/completions
 */
export class InferenceAdapter extends OpenAICompatibleAdapter {
  constructor(providerName, endpoint) {
    super(providerName, endpoint);
  }
}
