import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';
import { ProviderError } from '../utils/errors.js';

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
 * - Kilo: https://api.kilo.ai/api/gateway/chat/completions
 * - OpenCode Zen: https://opencode.ai/zen/v1/chat/completions
 * - Vercel AI Gateway: https://ai-gateway.vercel.sh/v1/chat/completions
 * - ModelScope: https://api-inference.modelscope.ai/v1/chat/completions
 * - OVHcloud, Nscale, Aion-Labs, LLM7, AI21, etc.
 */
export class InferenceAdapter extends OpenAICompatibleAdapter {
  constructor(providerName, endpoint) {
    if (!endpoint) {
      throw new ProviderError(providerName, `No endpoint configured for provider '${providerName}'`, 502, 'unknown');
    }
    super(providerName, endpoint);
  }
}
