import { classify, classifySync } from '../utils/classifier.js';
import { getActiveProviders, recordProviderResult, weightedShuffle } from './providerService.js';
import { getLeastUsedKey, getLeastUsedKeyExcluding, recordKeyFailure, getKeyMetadata } from './keyService.js';
import { estimateTokens } from './statsService.js';
import { AllProvidersExhaustedError, ProviderError } from '../utils/errors.js';

// Providers whose API keys carry per-key metadata required to build a
// request URL (e.g., Cloudflare Account ID, Vertex project/region).
// Single source of truth — do not hardcode the list inline at call sites.
const PROVIDERS_REQUIRING_KEY_METADATA = new Set(['cloudflare', 'vertex', 'google_pse']);

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

/**
 * Invalidate adapter cache for a specific provider or all providers.
 * Called when provider configuration changes (e.g., endpoint URL changes).
 * 
 * @param {string} [providerName] - Specific provider to invalidate, or 'all' for full cache clear
 */
export function invalidateAdapterCache(providerName) {
  if (providerName === 'all' || !providerName) {
    Object.keys(adapterCache).forEach(key => {
      delete adapterCache[key];
    });
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Adapter cache fully invalidated',
    }));
  } else {
    // Invalidate specific provider
    const cacheKey = adapterCache[providerName] ? providerName : null;
    
    // Also check for local_http cache keys
    for (const key of Object.keys(adapterCache)) {
      if (key.startsWith(`local_http:`) && key.includes(providerName)) {
        delete adapterCache[key];
      }
    }
    
    if (adapterCache[providerName]) {
      delete adapterCache[providerName];
      console.log(JSON.stringify({
        level: 'info',
        msg: `Adapter cache invalidated for provider: ${providerName}`,
      }));
    }
  }
}

/**
 * Get adapter cache info for monitoring.
 * @returns {{ size: number, keys: string[] }}
 */
export function getAdapterCacheInfo() {
  return {
    size: Object.keys(adapterCache).length,
    keys: Object.keys(adapterCache),
  };
}

export async function getAdapter(providerName, providerConfig = null) {
  const cacheKey = providerConfig?.type === 'local_http'
    ? `local_http:${providerConfig.endpoint}`
    : providerName;

  if (adapterCache[cacheKey]) return adapterCache[cacheKey];

  let adapter;
  switch (providerName) {
    case 'groq': {
      // Use model from providerConfig (passed from transcribe function)
      const modelToCheck = providerConfig?.model;
      // Only use Whisper adapter if EXACT model name matches whisper-large-v3
      const isWhisperModel = modelToCheck === 'whisper-large-v3';
      if (isWhisperModel) {
        const mod = await import('../adapters/groqWhisperAdapter.js');
        adapter = new mod.GroqWhisperAdapter();
      } else {
        const mod = await import('../adapters/openaiCompatibleAdapter.js');
        adapter = new mod.OpenAICompatibleAdapter('groq', 'https://api.groq.com/openai/v1/chat/completions');
      }
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
      // Use model from providerConfig (passed from transcribe function)
      const modelToCheck = providerConfig?.model;
      // Only use Whisper adapter if EXACT model name matches whisper-1
      const isWhisperModel = modelToCheck === 'whisper-1';
      if (isWhisperModel) {
        const mod = await import('../adapters/openaiWhisperAdapter.js');
        adapter = new mod.OpenAIWhisperAdapter();
      } else {
        const mod = await import('../adapters/openaiAdapter.js');
        adapter = new mod.OpenAIAdapter();
      }
      break;
    }
    case 'glm': {
      // ZhipuAI GLM — OpenAI-compatible but different endpoint
      const mod = await import('../adapters/inferenceAdapter.js');
      adapter = new mod.InferenceAdapter('glm', 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
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
    case 'mistral': {
      const mod = await import('../adapters/mistralAdapter.js');
      adapter = new mod.MistralAdapter();
      break;
    }
    case 'perplexity': {
      const mod = await import('../adapters/perplexityAdapter.js');
      adapter = new mod.PerplexityAdapter();
      break;
    }
    case 'minimax': {
      const mod = await import('../adapters/minimaxAdapter.js');
      adapter = new mod.MinimaxAdapter();
      break;
    }
    case 'github-models': {
      // GitHub Models rejects `metadata` unless `store=true`; GithubModelsAdapter strips it.
      const ghMod = await import('../adapters/githubModelsAdapter.js');
      adapter = new ghMod.GithubModelsAdapter();
      break;
    }
    case 'fireworks':
    case 'nebius':
    case 'siliconflow':
    case 'hyperbolic':
    case 'chutes':
    case 'nanobanana':
    case 'opencode_zen':
    case 'modelscope':
    case 'kilo':
    case 'vercel-ai-gateway':
    case 'ovhcloud':
    case 'nscale':
    case 'aion-labs':
    case 'llm7':
    case 'ai21': {
      // OpenAI-compatible chat completions inference providers
      const mod = await import('../adapters/inferenceAdapter.js');
      const endpoints = {
        fireworks:   'https://api.fireworks.ai/inference/v1/chat/completions',
        nebius:      'https://api.studio.nebius.ai/v1/chat/completions',
        siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
        hyperbolic:  'https://api.hyperbolic.xyz/v1/chat/completions',
        chutes:      'https://llm.chutes.ai/v1/chat/completions',
        nanobanana:  'https://api.nanobananaapi.ai/v1/chat/completions',
        opencode_zen: 'https://opencode.ai/zen/v1/chat/completions',
        modelscope:  'https://api-inference.modelscope.ai/v1/chat/completions',
        kilo:        'https://api.kilo.ai/api/gateway/chat/completions',
        'vercel-ai-gateway': 'https://ai-gateway.vercel.sh/v1/chat/completions',
        ovhcloud:    'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
        nscale:      'https://inference.api.nscale.com/v1/chat/completions',
        'aion-labs': 'https://api.aionlabs.ai/v1/chat/completions',
        llm7:        'https://api.llm7.io/v1/chat/completions',
        ai21:        'https://api.ai21.com/studio/v1/chat/completions',
        nous:        'https://inference-api.nousresearch.com/v1/chat/completions',
      };
      adapter = new mod.InferenceAdapter(providerName, endpoints[providerName]);
      break;
    }
    case 'deepgram': {
      const mod = await import('../adapters/deepgramAdapter.js');
      adapter = new mod.DeepgramAdapter();
      break;
    }
    case 'assemblyai': {
      const mod = await import('../adapters/assemblyaiAdapter.js');
      adapter = new mod.AssemblyAIAdapter();
      break;
    }
    case 'vertex': {
      const mod = await import('../adapters/vertexAdapter.js');
      adapter = new mod.VertexAdapter();
      break;
    }
    case 'ollama-cloud': {
      const mod = await import('../adapters/ollamaCloudAdapter.js');
      adapter = new mod.OllamaCloudAdapter();
      break;
    }
    case 'cline_api': {
      const mod = await import('../adapters/clineAdapter.js');
      adapter = new mod.ClineApiAdapter();
      break;
    }
    case 'ollama_local_bridge': {
      const mod = await import('../adapters/ollamaLocalBridgeAdapter.js');
      adapter = new mod.OllamaLocalBridgeAdapter();
      break;
    }
    case 'zai_cli_local':
    case 'cline_cli_local':
    case 'kimi_cli_local':
    case 'claude_cli_local':
    case 'gemini_cli_local':
    case 'qwen_cli_local':
    case 'antigravity_cli_local':
    case 'kilo_cli_local':
    case 'opencode_cli_local':
    case 'codex_cli_local':
    case 'kiro_cli_local':
    case 'grok_cli_local':
    case 'copilot_cli_local':
    case 'qoder_cli_local':
    case 'cursor_cli_local': {
      const mod = await import('../adapters/localHttpAdapter.js');
      const toolName = providerName.split('_')[0]; // zai, cline, kimi, claude, etc.
      const daemonUrl = process.env.LOCAL_DAEMON_URL || 'http://localhost:5059';
      adapter = new mod.LocalHttpAdapter(providerName, `${daemonUrl}/${toolName}`);
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

      // Custom OpenAI-compatible provider
      if (providerConfig?.type === 'custom_openai') {
        const mod = await import('../adapters/openaiCompatibleAdapter.js');
        adapter = new mod.OpenAICompatibleAdapter(providerName, providerConfig.endpoint);
        adapterCache[cacheKey] = adapter;
        return adapter;
      }

      // Custom Anthropic-compatible provider
      if (providerConfig?.type === 'custom_anthropic') {
        const mod = await import('../adapters/anthropicAdapter.js');
        adapter = new mod.AnthropicAdapter(providerName, providerConfig.endpoint);
        adapterCache[cacheKey] = adapter;
        return adapter;
      }

      throw new ProviderError(providerName, `No adapter found for provider: ${providerName}`, 502, 'N/A');
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
  // Use sync classify for performance (keywords cached in memory)
  const taskType        = opts.taskType || classifySync(prompt);
  const excludeProviders = opts.excludeProviders || [];
  const excludeKeys      = opts.excludeKeys      || [];
  const providerOverride = opts.provider;

  // getActiveProviders() returns providers ordered by priority-tier weighted random
  const activeProviders = await getActiveProviders();

  // ─── Validate model exists in ANY active provider BEFORE routing ───
  let searchList;
  if (opts.model && opts.model !== 'auto') {
    // For audio transcription, we should allow any model since Whisper adapters
    // handle the model validation. Skip this check for audio_transcription.
    const isAudioTranscription = taskType === 'audio_transcription' || 
                                  (opts.model && opts.model.toLowerCase().includes('whisper'));
    
    if (!isAudioTranscription) {
      const availableModels = new Set(activeProviders.flatMap(p => p.models || []));
      
      if (!availableModels.has(opts.model)) {
        // Find similar model suggestions
        const modelSuggestions = [...availableModels]
          .filter(m => m.toLowerCase().includes(opts.model.toLowerCase().slice(0, 4)))
          .slice(0, 5);
        
        throw new Error(
          `Model '${opts.model}' not found in any active provider. ` +
          `Did you mean: ${modelSuggestions.join(', ') || 'none'}? ` +
          `Available: ${[...availableModels].slice(0, 20).join(', ')}...`
        );
      }
    }
    
    // ─── PRIORITIZE providers that have the requested model ───
    let providersWithModel = activeProviders.filter(p => p.models?.includes(opts.model));
    let providersWithoutModel = activeProviders.filter(p => !p.models?.includes(opts.model));
    
    // If provider is explicitly specified, filter both lists to only that provider
    if (providerOverride && providerOverride !== 'auto') {
      providersWithModel = providersWithModel.filter(p => p.name === providerOverride);
      providersWithoutModel = providersWithoutModel.filter(p => p.name === providerOverride);
    }
    
    // Weighted random within each group, then merge: providers WITH model first
    const shuffle = arr => arr.sort(() => Math.random() - 0.5);
    searchList = [...shuffle(providersWithModel), ...shuffle(providersWithoutModel)];
  } else if (providerOverride && providerOverride !== 'auto') {
    const target = activeProviders.find(p => p.name === providerOverride);
    searchList = target ? [target] : [];
  } else {
    // Standard mode: prioritized weighted random shuffle
    searchList = [...activeProviders];
  }

  // ─── Detect if multimodal (vision, audio, video) is required ──────
  // Check both the raw prompt AND the messages array (where coding agents embed images)
  const multimodalParts = Array.isArray(prompt) ? prompt.filter(p => typeof p === 'object') : [];
  let isVision = multimodalParts.some(p => p.type === 'image_url' || p.type === 'image');
  let isAudio  = multimodalParts.some(p => p.type === 'audio');
  const isVideo  = multimodalParts.some(p => p.type === 'video');

  // For audio transcription, we also need audio-capable providers
  if (taskType === 'audio_transcription') {
    isAudio = true;
  }

  // Scan messages array for embedded image content (OpenAI Chat Completions format)
  if (!isVision && opts.messages && Array.isArray(opts.messages)) {
    for (const msg of opts.messages) {
      if (Array.isArray(msg.content)) {
        if (msg.content.some(part => part.type === 'image_url' || part.type === 'image')) {
          isVision = true;
          break;
        }
      }
    }
  }

  for (const provider of searchList) {
    if (excludeProviders.includes(provider.name)) continue;

    // Filter by capabilities at provider level
    if (isVision && (!provider.features || !provider.features.includes('vision'))) continue;
    if (isAudio  && (!provider.features || !provider.features.includes('audio'))) continue;
    if (isVideo  && (!provider.features || !provider.features.includes('video'))) continue;

// For audio transcription, only use providers that have transcription adapters
    // Only these providers have transcribe() methods implemented and working:
    // openai (whisper-1), groq (whisper-large-v3), assemblyai, cloudflare, deepgram
    if (taskType === 'audio_transcription' || (opts.model && opts.model.toLowerCase().includes('whisper'))) {
      const transcriptionProviders = ['openai', 'groq', 'assemblyai', 'cloudflare', 'deepgram'];
      if (!transcriptionProviders.includes(provider.name)) {
        continue;
      }
    }

    // Model selection: ONLY use providers that have the requested model in their models list
    const isWhisperModel = opts.model && opts.model.toLowerCase().includes('whisper');
    const knownTranscriptionProviders = ['openai', 'groq', 'assemblyai', 'cloudflare', 'deepgram'];
    const isKnownTranscriptionProvider = knownTranscriptionProviders.includes(provider.name);
    
    let model = null;
    const isAutoRequest = !opts.model || opts.model === 'auto' || opts.model === 'default';

    if (isWhisperModel && isKnownTranscriptionProvider) {
      // For known transcription providers with whisper model, always use the requested whisper model
      model = opts.model;
    } else if (opts.model && provider.models?.includes(opts.model)) {
      model = opts.model;
    } else if (isAutoRequest) {
      // Handle 'auto' or 'default' by picking provider's default model
      model = provider.default_model || provider.models?.[0] || 'default';
    } else {
      // Model requested but not in this provider's models list - SKIP this provider
      continue;
    }
    
    // ─── Vision-aware model selection ─────────────────────────────────
    // If request contains images AND this provider has a vision_models list,
    // ensure the selected model is vision-capable. If not, swap to one that is.
    if (isVision && provider.vision_models && provider.vision_models.length > 0) {
      if (!provider.vision_models.includes(model)) {
        // The selected model doesn't support vision — try to swap
        const visionModel = provider.vision_models[0]; // Pick the first vision-capable model
        if (visionModel) {
          console.log(JSON.stringify({
            level: 'info',
            msg: `Vision fallback: swapping model ${model} → ${visionModel} (provider: ${provider.name})`,
          }));
          model = visionModel;
        } else {
          // No vision models available in this provider — skip it
          continue;
        }
      }
    }

    // ─── Key Selection ───────────────────────────────────────────────
    let apiKey;

    if (provider.type === 'local_http') {
      // Local CLI tools use session auth handled by the daemon.
      // Each provider gets its OWN unique session key so retry exclusion
      // only blocks THIS provider, not all other local providers.
      apiKey = `local-cli-session:${provider.name}`;
    } else {
      // Atomic key selection (Lua): skips disabled + RPM-exceeded keys
      apiKey = excludeKeys.length > 0
        ? await getLeastUsedKeyExcluding(provider.name, excludeKeys)
        : await getLeastUsedKey(provider.name);
    }

    // Skip if no key available (always skip for local_http if already in excludeKeys)
    if (!apiKey || excludeKeys.includes(apiKey)) {
      continue;
    }

    return { provider, model, apiKey, taskType };
  }

  // Check if it was a vision request that failed
  if (isVision) {
    const activeProviders = await getActiveProviders();
    const visionProviders = activeProviders.filter(p =>
      p.features && p.features.includes('vision')
    );

    if (visionProviders.length === 0) {
      throw new Error(
        `No vision-capable providers are active. ` +
        `Please enable a provider with 'vision' feature (e.g., gemini, openai, anthropic). ` +
        `See /admin for provider status.`
      );
    }

    console.log(JSON.stringify({
      level: 'warn',
      msg: 'Vision request but all vision providers may be at RPM limit or disabled',
      visionProviders: visionProviders.map(p => p.name),
    }));
  }

  throw new AllProvidersExhaustedError(providerOverride || 'omniroute', opts.model || 'unknown');
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
  const MAX_ATTEMPTS = parseInt(process.env.ROUTER_MAX_ATTEMPTS, 10) || 3;

  // Track keys used across ALL attempts — NEVER reuse the same key
  const usedKeys = [];

  // Track per-provider failure counts to decide when to escalate
  const providerFailCount  = {};
  const failedProviders    = [];
  let lastError;

  // Pre-estimate input tokens BEFORE first request — for quota accounting
  const estimatedInputTokens = await estimateTokens(prompt);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let routeResult;

    try {
      routeResult = await route(prompt, {
        model:            opts.model,
        provider:         opts.provider,
        taskType:         opts.taskType,
        excludeProviders: failedProviders,
        excludeKeys:      usedKeys,
        messages:         opts.messages,  // Pass for vision detection in messages
      });
    } catch (err) {
      // No providers/keys available — preserve the error so the caller can
      // see the real reason (e.g. unknown provider override) instead of a
      // generic "All providers exhausted".
      lastError = err;
      break;
    }

    const { provider, model, apiKey, taskType } = routeResult;
    usedKeys.push(apiKey); // Prevent this key from being selected again

    try {
      const adapter = await getAdapter(provider.name, provider);
      const metadata = PROVIDERS_REQUIRING_KEY_METADATA.has(provider.name)
        ? await getKeyMetadata(provider.name, apiKey)
        : null;

      if (opts.stream) {
        // ── Streaming path ─────────────────────────────────────────
        let result;
        let streamFallbacked = false;

        try {
          result = await adapter.sendStreamRequest(prompt, model, apiKey, {
            requestId:    opts.requestId,
            taskType,
            systemPrompt: opts.systemPrompt,
            noContext:    opts.noContext,
            onChunk:      opts.onChunk,
            abortSignal:  opts.abortSignal,
            metadata:     metadata || {},
            temperature:     opts.temperature,
            top_p:          opts.top_p,
            max_tokens:     opts.max_tokens,
            response_format: opts.response_format,
            tools:          opts.tools,
            tool_choice:    opts.tool_choice,
            reasoningEffort: opts.reasoningEffort,
          });
        } catch (streamErr) {
          // Only retry as non-streaming when the provider clearly rejected
          // streaming. A bare 400 should NOT trigger a fallback (most 400s
          // are real client errors — model not found, bad params, etc.).
          const statusCode = streamErr.statusCode || streamErr.status;
          const errLower = (streamErr.message || '').toLowerCase();
          const isStreamNotSupported =
            statusCode === 501 ||
            (statusCode === 400 && (
              errLower.includes('streaming') ||
              errLower.includes('not supported') ||
              errLower.includes('not allowed')
            ));

          if (isStreamNotSupported && !opts._streamRetryAttempt) {
            // Fallback to non-streaming
            streamFallbacked = true;
            const fallbackRaw = await adapter.sendRequest(prompt, model, apiKey, {
              requestId:    opts.requestId,
              taskType,
              systemPrompt: opts.systemPrompt,
              noContext:    opts.noContext,
              metadata:     metadata || {},
              temperature:     opts.temperature,
              top_p:          opts.top_p,
              max_tokens:     opts.max_tokens,
              response_format: opts.response_format,
              tools:          opts.tools,
              tool_choice:    opts.tool_choice,
              reasoningEffort: opts.reasoningEffort,
            });
            const fallbackNormalized = await adapter.normalizeResponse(fallbackRaw);
            if (opts.onChunk) {
              if (fallbackNormalized.thinking) opts.onChunk({ reasoning: fallbackNormalized.thinking, provider: provider.name, model });
              if (fallbackNormalized.output) opts.onChunk({ content: fallbackNormalized.output, provider: provider.name, model });
              // Emit tool calls as OpenAI streaming deltas (one chunk per tool,
              // each carrying the full tool call as a single delta entry). This
              // matches OpenAI's streaming tool-call format expected by clients.
              if (fallbackNormalized.tool_calls && fallbackNormalized.tool_calls.length > 0) {
                fallbackNormalized.tool_calls.forEach((tc, idx) => {
                  opts.onChunk({
                    tool_calls: [{
                      index: idx,
                      id: tc.id,
                      type: tc.type,
                      function: { name: tc.function.name, arguments: tc.function.arguments },
                    }],
                    provider: provider.name,
                    model,
                  });
                });
              }
            }
            result = fallbackNormalized;
          } else {
            throw streamErr;
          }
        }

        await recordProviderResult(provider.name, true);

        const tokens = result.tokens || {};
        if (!tokens.input || tokens.input === 0) {
          tokens.input = estimatedInputTokens;
        }

        const finalResult = {
          output:   result?.output ?? '',
          thinking: result?.thinking || null,
          tool_calls: result?.tool_calls || [],
          finish_reason: result?.finish_reason || 'stop',
          provider: provider.name,
          model,
          keyUsed:  apiKey,
          tokens,
          streamFallbacked: streamFallbacked || result?.raw?.streaming === false,
        };

        if (opts.onDone) opts.onDone(finalResult);
        return finalResult;
      }

      // ── Non-streaming path ────────────────────────────────────────
      const rawResponse = await adapter.sendRequest(prompt, model, apiKey, {
        requestId:    opts.requestId,
        taskType,
        systemPrompt: opts.systemPrompt,
        noContext:    opts.noContext,
        metadata:     metadata || {},
        // Pass through additional OpenAI options
        temperature:     opts.temperature,
        top_p:          opts.top_p,
        max_tokens:     opts.max_tokens,
        response_format: opts.response_format,
        tools:          opts.tools,
        tool_choice:    opts.tool_choice,
        reasoningEffort: opts.reasoningEffort,
      });

      if (!rawResponse) {
        throw new ProviderError(provider.name, 'Empty response from provider', 502, model);
      }

      const normalized = await adapter.normalizeResponse(rawResponse);
      
      if (!normalized) {
        throw new ProviderError(provider.name, 'Failed to normalize provider response', 502, model);
      }

      await recordProviderResult(provider.name, true);



      const tokens = normalized.tokens || {};
      if (!tokens.input || tokens.input === 0) {
        tokens.input = estimatedInputTokens;
      }

      let finalOutput = normalized.output || '';
      
      // Fallback to stderr for successful but silent CLI responses
      if (!finalOutput && rawResponse.stderr) {
        finalOutput = rawResponse.stderr;
      }

      return {
        output:   finalOutput,
        thinking: normalized?.thinking || null,
        tool_calls: normalized?.tool_calls || [],
        finish_reason: normalized?.finish_reason || 'stop',
        provider: provider.name,
        model,
        tokens,
        keyUsed:  apiKey,
      };

    } catch (err) {
      // Ensure the error carries provider/model metadata for the background worker
      // even if it was thrown by a generic adapter or with incorrect model info
      if (err instanceof ProviderError) {
        err.provider = provider.name;
        err.model = model;
        // Re-construct the message to ensure prefix includes the resolved model
        const originalMessage = err.message.includes('] ') ? err.message.split('] ')[1] : err.message;
        err.message = `[${provider.name}|${model}] ${originalMessage}`;
        lastError = err;
      } else {
        lastError = new ProviderError(provider.name, err.message, err.statusCode || 500, model, err);
      }

      // DEBUG: log original error so it's visible in Railway logs and persists
      // even when the final "all providers exhausted" error replaces it.
      console.log(JSON.stringify({
        level: 'error',
        msg: 'nous-debug: original adapter error',
        provider: provider.name,
        model,
        errMessage: err.message,
        errStatus: err.status || err.statusCode,
        errName: err.name,
        errCode: err.code,
        errCause: err.cause?.message || err.cause?.code || null,
        attempt,
      }));

      // Record key failure (may auto-disable key if threshold exceeded)
      // Skip for local_http providers — their "key" is a virtual session identifier,
      // not a real Redis-tracked key. Calling recordKeyFailure on it pollutes the sorted set.
      if (provider.type !== 'local_http') {
        await recordKeyFailure(provider.name, apiKey).catch(() => {});
      }

      // Record provider failure (may trip circuit breaker)
      await recordProviderResult(provider.name, false).catch(() => {});

      // ─── Vision-specific error: skip provider immediately ──────────
      // Vision/image capability errors are model-level, not key-level.
      // Retrying the same provider with a different key will never work.
      // Use a word-boundary regex on 'vision' so we don't false-positive on
      // 'supervision', 'division', 'television', 'revision', etc.
      const errMsg = (lastError?.message || '').toLowerCase();
      const isVisionError = (
        errMsg.includes('image content is not supported') ||
        errMsg.includes('image input') ||
        errMsg.includes('does not support image') ||
        errMsg.includes('no endpoints found that support image') ||
        /\bvision\b/.test(errMsg)
      );
      if (isVisionError) {
        if (!failedProviders.includes(provider.name)) {
          failedProviders.push(provider.name);
        }
        console.log(JSON.stringify({
          level: 'warn',
          msg: `Vision error detected — skipping provider ${provider.name} immediately`,
          error: errMsg.substring(0, 200),
        }));
        continue; // Skip the normal failure count logic
      }

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
   let finalErr = lastError || new AllProvidersExhaustedError(opts.provider || 'omniroute', opts.model || 'unknown');

   // Preserve the original error message in the final error so the caller can see
   // what actually went wrong (e.g. network failure, 4xx from provider) instead of
   // the generic "all providers exhausted" message.
   if (lastError && lastError.message && !finalErr.message.includes(lastError.message)) {
     finalErr = new AllProvidersExhaustedError(opts.provider || 'omniroute', opts.model || 'unknown');
     finalErr.message = `${finalErr.message} (last: ${lastError.message})`;
     finalErr.lastErrorMessage = lastError.message;
   }

   if (opts.stream && opts.onError) {
     opts.onError(finalErr);
     return;
   }

   throw finalErr;
}

/**
 * Route, transcribe, and handle retries/failover for audio transcription.
 *
 * @param {Buffer} fileBuffer - Audio file buffer
 * @param {object} opts
 * @param {string}   [opts.model] - Model to use (e.g., 'whisper-1', 'nova-2')
 * @param {string}   [opts.provider] - Preferred provider
 * @param {string}   [opts.language] - Language code
 * @param {string}   [opts.response_format] - Response format
 * @param {string[]} [opts.timestamp_granularities] - Timestamp granularities
 * @param {string}   [opts.requestId] - Request ID for logging
 * @returns {Promise<{text, duration, words?, language, provider, model, tokens, keyUsed}>}
 */
export async function transcribe(fileBuffer, opts = {}) {
  const MAX_ATTEMPTS = 3;
  const TRANSCRIPTION_TIMEOUT = 45000; // 45s internal timeout (shorter than 60s client timeout)
  
  const usedKeys = [];
  const providerFailCount = {};
  const failedProviders = [];
  let lastError;

  const estimatedInputTokens = Math.ceil(fileBuffer.length / 1024);
  


  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let routeResult;



    try {
      routeResult = await route('', {
        model: opts.model,
        provider: opts.provider,
        taskType: 'audio_transcription',
        excludeProviders: failedProviders,
        excludeKeys: usedKeys,
      });
      console.log(JSON.stringify({
        level: 'info',
        msg: 'Route returned successfully',
        requestId: opts.requestId,
        provider: routeResult?.provider?.name,
        model: routeResult?.model,
        hasApiKey: !!routeResult?.apiKey,
      }));
    } catch (err) {
      // FIX: Save the error to lastError before breaking
      lastError = err;
      console.log(JSON.stringify({
        level: 'error',
        msg: 'Route failed',
        requestId: opts.requestId,
        error: err.message,
        stack: err.stack,
      }));
      break;
    }

    if (!routeResult || !routeResult.provider) {
      console.log(JSON.stringify({
        level: 'error',
        msg: 'Route returned null provider',
        requestId: opts.requestId,
        routeResult,
      }));
      lastError = new Error('No provider returned from route');
      break;
    }

    const { provider, model, apiKey, taskType } = routeResult;
    
    if (!apiKey) {
      console.log(JSON.stringify({
        level: 'warn',
        msg: 'No API key for provider, adding to failed',
        requestId: opts.requestId,
        provider: provider.name,
      }));
      failedProviders.push(provider.name);
      continue;
    }
    
    usedKeys.push(apiKey);

    console.log(JSON.stringify({
      level: 'info',
      msg: 'Route selected provider for transcription',
      requestId: opts.requestId,
      providerName: provider.name,
      providerType: provider.type,
      model,
      hasApiKey: !!apiKey,
      attempt: attempt + 1,
    }));

    try {
      // Log starting transcription
      console.log(JSON.stringify({
        level: 'info',
        msg: 'Starting transcription',
        requestId: opts.requestId,
        provider: provider.name,
        model,
        attempt: attempt + 1,
      }));
      
      // For openai provider with whisper-1 model, pass model in config to get correct adapter
      // For groq provider with whisper-large-v3 model, pass model in config to get correct adapter
      // For assemblyai and cloudflare, always pass model as they use different adapters
      const shouldPassModel = 
        (provider.name === 'openai' && model === 'whisper-1') ||
        (provider.name === 'groq' && model === 'whisper-large-v3') ||
        (provider.name === 'assemblyai') ||
        (provider.name === 'cloudflare');
      const providerConfigForAdapter = { ...provider, model: shouldPassModel ? model : undefined };
      const adapter = await getAdapter(provider.name, providerConfigForAdapter);
      const transcriptionMetadata = PROVIDERS_REQUIRING_KEY_METADATA.has(provider.name)
        ? (await getKeyMetadata(provider.name, apiKey)) || {}
        : {};

      // Wrap transcription in timeout
      const transcriptionPromise = adapter.transcribe(fileBuffer, model, {
        ...opts,
        apiKey,
        requestId: opts.requestId,
        mimeType: opts.mimeType,
        filename: opts.filename,
        metadata: transcriptionMetadata,
      });

      const transcriptionResult = await Promise.race([
        transcriptionPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new ProviderError(
            provider.name, 
            `Transcription timed out after ${TRANSCRIPTION_TIMEOUT}ms`, 
            504, 
            model
          )), TRANSCRIPTION_TIMEOUT)
        ),
      ]);

      // Log transcription completed
      console.log(JSON.stringify({
        level: 'info',
        msg: 'Transcription completed',
        requestId: opts.requestId,
        provider: provider.name,
        model,
        textLength: transcriptionResult.text?.length || 0,
        duration: transcriptionResult.duration,
      }));

      await recordProviderResult(provider.name, true);

      const tokens = {
        input: transcriptionResult.duration ? Math.ceil(transcriptionResult.duration / 0.1) : estimatedInputTokens,
        output: typeof transcriptionResult.text === 'string' ? transcriptionResult.text.split(' ').length : 0,
      };

      return {
        ...transcriptionResult,
        provider: provider.name,
        model,
        tokens,
        keyUsed: apiKey,
      };

    } catch (err) {
      if (err instanceof ProviderError) {
        err.provider = provider.name;
        err.model = model;
        const originalMessage = err.message.includes('] ') ? err.message.split('] ')[1] : err.message;
        err.message = `[${provider.name}|${model}] ${originalMessage}`;
        lastError = err;
      } else {
        lastError = new ProviderError(provider.name, err.message, err.statusCode || 500, model, err);
      }

      // Log transcription failed
      console.log(JSON.stringify({
        level: 'warn',
        msg: 'Transcription failed',
        requestId: opts.requestId,
        provider: provider.name,
        model,
        error: lastError.message,
        attempt: attempt + 1,
      }));

      if (provider.type !== 'local_http') {
        await recordKeyFailure(provider.name, apiKey).catch(() => {});
      }

      await recordProviderResult(provider.name, false).catch(() => {});

      providerFailCount[provider.name] = (providerFailCount[provider.name] || 0) + 1;

      if (providerFailCount[provider.name] >= 2) {
        if (!failedProviders.includes(provider.name)) {
          failedProviders.push(provider.name);
        }
      }
    }
  }

  console.log(JSON.stringify({
    level: 'error',
    msg: 'All transcription attempts failed',
    requestId: opts.requestId,
    error: lastError?.message,
    attempts: MAX_ATTEMPTS,
    failedProviders: failedProviders,
    usedKeysCount: usedKeys.length,
  }));
  
  // FIX: Add audio-specific error context
  if (opts.taskType === 'audio_transcription' || (opts.model && opts.model.includes('whisper'))) {
    const { getActiveProviders } = await import('./providerService.js');
    try {
      const activeProviders = await getActiveProviders();
      const audioProviders = activeProviders.filter(p => p.features && p.features.includes('audio'));
      
      if (audioProviders.length === 0) {
        throw new Error(
          `No audio-capable providers are active. ` +
          `Please enable a provider with 'audio' feature (e.g., openai, deepgram, assemblyai, groq). ` +
          `Check /api/admin/providers for status.`
        );
      }
      
      console.log(JSON.stringify({
        level: 'warn',
        msg: 'Audio transcription failed - audio providers available but all failed',
        requestId: opts.requestId,
        audioProviders: audioProviders.map(p => p.name),
      }));
    } catch (providerErr) {
      // If it's the "no audio providers" error, rethrow it
      if (providerErr.message.includes('No audio-capable providers')) {
        throw providerErr;
      }
      // Other errors from getActiveProviders - log but continue
      console.log(JSON.stringify({
        level: 'error',
        msg: 'Failed to check audio providers',
        requestId: opts.requestId,
        error: providerErr.message,
      }));
    }
  }
  
  throw lastError || new AllProvidersExhaustedError(opts.provider || 'omniroute', opts.model || 'unknown');
}
