import { classify } from '../utils/classifier.js';
import { getActiveProviders, recordProviderResult, getProviderConfig } from './providerService.js';
import { getLeastUsedKey, getLeastUsedKeyExcluding, recordKeyFailure } from './keyService.js';
import { AllProvidersExhaustedError, ProviderError } from '../utils/errors.js';

// Adapter registry — lazy loaded
const adapterCache = {};

async function getAdapter(providerName) {
  if (adapterCache[providerName]) return adapterCache[providerName];

  let AdapterClass;
  switch (providerName) {
    case 'groq': {
      const mod = await import('../adapters/groqAdapter.js');
      AdapterClass = mod.GroqAdapter;
      break;
    }
    case 'google':
    case 'gemini': {
      const mod = await import('../adapters/geminiAdapter.js');
      AdapterClass = mod.GeminiAdapter;
      break;
    }
    case 'cloudflare': {
      const mod = await import('../adapters/cloudflareAdapter.js');
      AdapterClass = mod.CloudflareAdapter;
      break;
    }
    case 'openai': {
      const mod = await import('../adapters/openaiAdapter.js');
      AdapterClass = mod.OpenAIAdapter;
      break;
    }
    case 'anthropic': {
      const mod = await import('../adapters/anthropicAdapter.js');
      AdapterClass = mod.AnthropicAdapter;
      break;
    }
    case 'xai': {
      const mod = await import('../adapters/xaiAdapter.js');
      AdapterClass = mod.XAIAdapter;
      break;
    }
    case 'alibaba': {
      const mod = await import('../adapters/alibabaAdapter.js');
      AdapterClass = mod.AlibabaAdapter;
      break;
    }
    case 'ollama': {
      const mod = await import('../adapters/ollamaAdapter.js');
      AdapterClass = mod.OllamaAdapter;
      break;
    }
    case 'openrouter': {
      const mod = await import('../adapters/openrouterAdapter.js');
      AdapterClass = mod.OpenRouterAdapter;
      break;
    }
    case 'deepseek': {
      const mod = await import('../adapters/deepseekAdapter.js');
      AdapterClass = mod.DeepSeekAdapter;
      break;
    }
    case 'moonshot': {
      const mod = await import('../adapters/moonshotAdapter.js');
      AdapterClass = mod.MoonshotAdapter;
      break;
    }
    case 'together': {
      const mod = await import('../adapters/togetherAdapter.js');
      AdapterClass = mod.TogetherAdapter;
      break;
    }
    case 'nvidia': {
      const mod = await import('../adapters/nvidiaAdapter.js');
      AdapterClass = mod.NvidiaAdapter;
      break;
    }
    case 'inception': {
      const mod = await import('../adapters/inceptionAdapter.js');
      AdapterClass = mod.InceptionAdapter;
      break;
    }
    case 'xiaomi': {
      const mod = await import('../adapters/xiaomiAdapter.js');
      AdapterClass = mod.XiaomiAdapter;
      break;
    }
    case 'sambanova': {
      const mod = await import('../adapters/sambanovaAdapter.js');
      AdapterClass = mod.SambaNovaAdapter;
      break;
    }
    case 'cerebras': {
      const mod = await import('../adapters/cerebrasAdapter.js');
      AdapterClass = mod.CerebrasAdapter;
      break;
    }
    case 'huggingface': {
      const mod = await import('../adapters/huggingfaceAdapter.js');
      AdapterClass = mod.HuggingFaceAdapter;
      break;
    }
    case 'cohere': {
      const mod = await import('../adapters/cohereAdapter.js');
      AdapterClass = mod.CohereAdapter;
      break;
    }
    default:
      throw new ProviderError(providerName, `No adapter found for provider: ${providerName}`);
  }

  adapterCache[providerName] = new AdapterClass();
  return adapterCache[providerName];
}

/**
 * Route a request: classify → select provider → select model → select key.
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.model] - preferred model
 * @param {string} [opts.taskType] - override classifier
 * @param {string[]} [opts.excludeProviders] - providers to skip
 * @returns {Promise<{provider: object, model: string, apiKey: string, taskType: string}>}
 */
export async function route(prompt, opts = {}) {
  const taskType = opts.taskType || classify(prompt);
  const excludeProviders = opts.excludeProviders || [];
  const excludeKeys = opts.excludeKeys || [];

  const activeProviders = await getActiveProviders();

  for (const provider of activeProviders) {
    if (excludeProviders.includes(provider.name)) continue;

    // Select model
    const model = opts.model && provider.models.includes(opts.model)
      ? opts.model
      : provider.models[0]; // Default to first model

    // Get key (atomic, RPM-checked)
    const apiKey = excludeKeys.length > 0
      ? await getLeastUsedKeyExcluding(provider.name, excludeKeys)
      : await getLeastUsedKey(provider.name);

    if (!apiKey) continue; // All keys exhausted or RPM exceeded for this provider

    return { provider, model, apiKey, taskType };
  }

  throw new AllProvidersExhaustedError();
}

/**
 * Route, execute, and handle retries/failover.
 *
 * Retry order:
 * 1. Same provider → different key
 * 2. Same provider → another different key
 * 3. Next provider
 *
 * Max 3 total attempts. Never reuses the same key.
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.model]
 * @param {string} [opts.taskType]
 * @param {string} [opts.requestId]
 * @param {boolean} [opts.stream]
 * @param {Function} [opts.onChunk] - streaming callback
 * @param {Function} [opts.onDone] - streaming done callback
 * @param {Function} [opts.onError] - streaming error callback
 * @returns {Promise<{output: string, provider: string, model: string, tokens: object, keyUsed: string}>}
 */
export async function routeAndExecute(prompt, opts = {}) {
  const MAX_ATTEMPTS = 3;
  const usedKeys = [];
  const failedProviders = [];
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let routeResult;

    try {
      routeResult = await route(prompt, {
        model: opts.model,
        taskType: opts.taskType,
        excludeProviders: failedProviders,
        excludeKeys: usedKeys,
      });
    } catch (err) {
      // No providers/keys available at all
      throw err;
    }

    const { provider, model, apiKey, taskType } = routeResult;
    usedKeys.push(apiKey);

    try {
      const adapter = await getAdapter(provider.name);

      if (opts.stream) {
        // Streaming execution
        const result = await adapter.sendStreamRequest(prompt, model, apiKey, {
          requestId: opts.requestId,
          taskType,
          onChunk: opts.onChunk,
        });

        await recordProviderResult(provider.name, true);

        const finalResult = {
          provider: provider.name,
          model,
          keyUsed: apiKey,
          tokens: result.tokens,
          output: result.output || '',
        };

        if (opts.onDone) opts.onDone(finalResult);
        return finalResult;
      }

      // Non-streaming execution
      const rawResponse = await adapter.sendRequest(prompt, model, apiKey, {
        requestId: opts.requestId,
        taskType,
      });

      const normalized = adapter.normalizeResponse(rawResponse);
      await recordProviderResult(provider.name, true);

      return {
        output: normalized.output,
        provider: provider.name,
        model,
        tokens: normalized.tokens,
        keyUsed: apiKey,
      };

    } catch (err) {
      lastError = err;

      // Record failure
      await recordKeyFailure(provider.name, apiKey);
      await recordProviderResult(provider.name, false);

      // Decide if we should try a different provider on next attempt
      // After 2 same-provider failures, switch provider
      const sameProviderAttempts = usedKeys.filter((k) =>
        k !== apiKey // we already added current key
      ).length;

      if (attempt >= 1 && sameProviderAttempts >= 1) {
        failedProviders.push(provider.name);
      }
    }
  }

  // All attempts exhausted
  if (opts.stream && opts.onError) {
    opts.onError(lastError || new AllProvidersExhaustedError());
    return;
  }

  throw lastError || new AllProvidersExhaustedError();
}
