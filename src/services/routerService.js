import { classify } from '../utils/classifier.js';
import { getActiveProviders, recordProviderResult } from './providerService.js';
import { getLeastUsedKey, getLeastUsedKeyExcluding, recordKeyFailure } from './keyService.js';
import { estimateTokens } from './statsService.js';
import { AllProvidersExhaustedError, ProviderError } from '../utils/errors.js';

/**
 * Router service — provider selection, adapter dispatch, retry/failover.
 *
 * Retry policy (STRICT — 3 total attempts max):
 *   Attempt 1: Provider A, Key 1 → fail
 *   Attempt 2: Provider A, Key 2 (different key) → fail
 *   Attempt 3: Provider B (next provider), Key 1 → fail → throw
 *
 * Rules enforced:
 * - NEVER retry the same key twice (usedKeys exclusion set)
 * - After 2 failures on Provider A → mark Provider A as failed → next provider
 * - MAX 3 total attempts regardless of key/provider availability
 * - routerService is the SINGLE source of retry truth — workers do NOT retry
 *
 * Pre-request token estimation:
 * - Input tokens are estimated BEFORE the request using estimateTokens(prompt)
 * - This is passed into the result for quota accounting even if provider tokens are missing
 */

// ─── Adapter registry — lazy loaded ──────────────────────────────────
const adapterCache = {};

async function getAdapter(providerName, providerConfig = null) {
  const cacheKey = providerConfig?.type === 'local_http'
    ? `local_http:${providerConfig.endpoint}`
    : providerName;

  if (adapterCache[cacheKey]) return adapterCache[cacheKey];

  let adapter;
  switch (providerName) {
    case 'groq': {
      const mod = await import('../adapters/groqAdapter.js');
      adapter = new mod.GroqAdapter();
      break;
    }
    case 'google':
    case 'gemini': {
      const mod = await import('../adapters/geminiAdapter.js');
      adapter = new mod.GeminiAdapter();
      break;
    }
    case 'cloudflare': {
      const mod = await import('../adapters/cloudflareAdapter.js');
      adapter = new mod.CloudflareAdapter();
      break;
    }
    case 'openai': {
      const mod = await import('../adapters/openaiAdapter.js');
      adapter = new mod.OpenAIAdapter();
      break;
    }
    case 'anthropic': {
      const mod = await import('../adapters/anthropicAdapter.js');
      adapter = new mod.AnthropicAdapter();
      break;
    }
    case 'xai': {
      const mod = await import('../adapters/xaiAdapter.js');
      adapter = new mod.XAIAdapter();
      break;
    }
    case 'alibaba': {
      const mod = await import('../adapters/alibabaAdapter.js');
      adapter = new mod.AlibabaAdapter();
      break;
    }
    case 'ollama': {
      const mod = await import('../adapters/ollamaAdapter.js');
      adapter = new mod.OllamaAdapter();
      break;
    }
    case 'openrouter': {
      const mod = await import('../adapters/openrouterAdapter.js');
      adapter = new mod.OpenRouterAdapter();
      break;
    }
    case 'deepseek': {
      const mod = await import('../adapters/deepseekAdapter.js');
      adapter = new mod.DeepSeekAdapter();
      break;
    }
    case 'moonshot': {
      const mod = await import('../adapters/moonshotAdapter.js');
      adapter = new mod.MoonshotAdapter();
      break;
    }
    case 'together': {
      const mod = await import('../adapters/togetherAdapter.js');
      adapter = new mod.TogetherAdapter();
      break;
    }
    case 'nvidia': {
      const mod = await import('../adapters/nvidiaAdapter.js');
      adapter = new mod.NvidiaAdapter();
      break;
    }
    case 'inception': {
      const mod = await import('../adapters/inceptionAdapter.js');
      adapter = new mod.InceptionAdapter();
      break;
    }
    case 'xiaomi': {
      const mod = await import('../adapters/xiaomiAdapter.js');
      adapter = new mod.XiaomiAdapter();
      break;
    }
    case 'sambanova': {
      const mod = await import('../adapters/sambanovaAdapter.js');
      adapter = new mod.SambaNovaAdapter();
      break;
    }
    case 'cerebras': {
      const mod = await import('../adapters/cerebrasAdapter.js');
      adapter = new mod.CerebrasAdapter();
      break;
    }
    case 'huggingface': {
      const mod = await import('../adapters/huggingfaceAdapter.js');
      adapter = new mod.HuggingFaceAdapter();
      break;
    }
    case 'cohere': {
      const mod = await import('../adapters/cohereAdapter.js');
      adapter = new mod.CohereAdapter();
      break;
    }
    default: {
      // Support local_http provider type generically
      if (providerConfig?.type === 'local_http') {
        const mod = await import('../adapters/localHttpAdapter.js');
        adapter = new mod.LocalHttpAdapter(providerName, providerConfig.endpoint);
        adapterCache[cacheKey] = adapter;
        return adapter;
      }
      throw new ProviderError(providerName, `No adapter found for provider: ${providerName}`);
    }
  }

  adapterCache[cacheKey] = adapter;
  return adapter;
}

/**
 * Route a request to the best available provider+key.
 * Applies priority-then-weighted-random provider selection.
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string}   [opts.model]            - preferred model
 * @param {string}   [opts.taskType]         - override classifier
 * @param {string[]} [opts.excludeProviders] - providers to skip entirely
 * @param {string[]} [opts.excludeKeys]      - keys to skip (retry exclusion)
 * @returns {Promise<{provider, model, apiKey, taskType}>}
 */
export async function route(prompt, opts = {}) {
  const taskType        = opts.taskType || classify(prompt);
  const excludeProviders = opts.excludeProviders || [];
  const excludeKeys      = opts.excludeKeys      || [];

  // getActiveProviders() returns providers ordered by priority-tier weighted random
  const activeProviders = await getActiveProviders();

  for (const provider of activeProviders) {
    if (excludeProviders.includes(provider.name)) continue;

    // Model selection: requested model → provider default → first model in list
    let model = opts.model && provider.models?.includes(opts.model) ? opts.model : null;
    if (!model) {
      model = (provider.default_model && provider.models?.includes(provider.default_model))
        ? provider.default_model
        : provider.models?.[0] || 'default';
    }

    // ─── Key Selection ───────────────────────────────────────────────
    let apiKey;

    if (provider.type === 'local_http') {
      // Local CLI tools use session auth handled by the daemon.
      // We use a constant identifier to satisfy the rotation logic.
      apiKey = 'local-cli-session';
    } else {
      // Atomic key selection (Lua): skips disabled + RPM-exceeded keys
      apiKey = excludeKeys.length > 0
        ? await getLeastUsedKeyExcluding(provider.name, excludeKeys)
        : await getLeastUsedKey(provider.name);
    }

    // Skip if no key available (always skip for local_http if already in excludeKeys)
    if (!apiKey || excludeKeys.includes(apiKey)) continue;

    return { provider, model, apiKey, taskType };
  }

  throw new AllProvidersExhaustedError();
}

/**
 * Route, execute, and handle retries/failover.
 *
 * STRICT RETRY POLICY (3 total attempts):
 *   Attempt 0 (1st): Provider A, Key 1
 *   Attempt 1 (2nd): Provider A, Key 2  ← same provider, different key
 *   Attempt 2 (3rd): Provider B, any key ← failover to next provider
 *   → Throw if all fail
 *
 * The caller (jobWorker) MUST NOT attempt additional retries.
 * routerService is the single source of retry truth.
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string}   [opts.model]
 * @param {string}   [opts.taskType]
 * @param {string}   [opts.systemPrompt]
 * @param {string}   [opts.requestId]
 * @param {boolean}  [opts.stream]
 * @param {Function} [opts.onChunk]
 * @param {Function} [opts.onDone]
 * @param {Function} [opts.onError]
 * @returns {Promise<{output, provider, model, tokens, keyUsed}>}
 */
export async function routeAndExecute(prompt, opts = {}) {
  const MAX_ATTEMPTS = 3;

  // Track keys used across ALL attempts — NEVER reuse the same key
  const usedKeys = [];

  // Track per-provider failure counts to decide when to escalate
  const providerFailCount  = {};
  const failedProviders    = [];
  let lastError;

  // Pre-estimate input tokens BEFORE first request — for quota accounting
  const estimatedInputTokens = estimateTokens(prompt);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let routeResult;

    try {
      routeResult = await route(prompt, {
        model:            opts.model,
        taskType:         opts.taskType,
        excludeProviders: failedProviders,
        excludeKeys:      usedKeys,
      });
    } catch {
      // No providers/keys available
      break;
    }

    const { provider, model, apiKey, taskType } = routeResult;
    usedKeys.push(apiKey); // Prevent this key from being selected again

    try {
      const adapter = await getAdapter(provider.name, provider);

      if (opts.stream) {
        // ── Streaming path ─────────────────────────────────────────
        const result = await adapter.sendStreamRequest(prompt, model, apiKey, {
          requestId:    opts.requestId,
          taskType,
          systemPrompt: opts.systemPrompt,
          onChunk:      opts.onChunk,
        });

        await recordProviderResult(provider.name, true);

        const tokens = result.tokens || {};
        // Prefer provider-returned input tokens; fall back to pre-estimate
        if (!tokens.input || tokens.input === 0) {
          tokens.input = estimatedInputTokens;
        }

        const finalResult = {
          output:   result.output || '',
          provider: provider.name,
          model,
          keyUsed:  apiKey,
          tokens,
        };

        if (opts.onDone) opts.onDone(finalResult);
        return finalResult;
      }

      // ── Non-streaming path ────────────────────────────────────────
      const rawResponse = await adapter.sendRequest(prompt, model, apiKey, {
        requestId:    opts.requestId,
        taskType,
        systemPrompt: opts.systemPrompt,
      });

      const normalized = adapter.normalizeResponse(rawResponse);
      await recordProviderResult(provider.name, true);

      const tokens = normalized.tokens || {};
      if (!tokens.input || tokens.input === 0) {
        tokens.input = estimatedInputTokens;
      }

      return {
        output:   normalized.output,
        provider: provider.name,
        model,
        tokens,
        keyUsed:  apiKey,
      };

    } catch (err) {
      lastError = err;

      // Record key failure (may auto-disable key if threshold exceeded)
      await recordKeyFailure(provider.name, apiKey).catch(() => {});

      // Record provider failure (may trip circuit breaker)
      await recordProviderResult(provider.name, false).catch(() => {});

      // Track per-provider failure count
      providerFailCount[provider.name] = (providerFailCount[provider.name] || 0) + 1;

      // After 2 failures on the same provider → escalate to next provider
      // Attempt 0 → fail → attempt 1 (same provider, new key)
      // Attempt 1 → fail → attempt 2 MUST use a different provider
      if (providerFailCount[provider.name] >= 2) {
        if (!failedProviders.includes(provider.name)) {
          failedProviders.push(provider.name);
        }
      }
    }
  }

  // All attempts exhausted
  const finalErr = lastError || new AllProvidersExhaustedError();

  if (opts.stream && opts.onError) {
    opts.onError(finalErr);
    return;
  }

  throw finalErr;
}
