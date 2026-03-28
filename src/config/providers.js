/**
 * Static provider configuration with full model lists.
 * This acts as a fallback if Firestore is empty and as the source for seeding.
 */
import { getDb } from './firestore.js';
import { get, set, setex } from './redis.js';

export const STATIC_PROVIDERS = [
  {
    name: 'openai',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      'gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'
    ],
    rpmLimit: 50
  },
  {
    name: 'anthropic',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: [
      'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'
    ],
    rpmLimit: 50
  },
  {
    name: 'google',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: [
      'gemini-2.0-flash-001', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemma-2-27b-it'
    ],
    rpmLimit: 15
  },
  {
    name: 'xai',
    priority: 2,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    models: [
      'grok-4.20-reasoning', 'grok-4.1-fast-reasoning', 'grok-2'
    ],
    rpmLimit: 20
  },
  {
    name: 'openrouter',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'mistralai/mistral-small-24b-instruct-2501:free',
      'google/gemini-2.0-pro-exp-02-05:free',
      'microsoft/phi-4:free',
      'openrouter/auto'
    ],
    rpmLimit: 100
  },
  {
    name: 'groq',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'
    ],
    rpmLimit: 30
  },
  {
    name: 'deepseek',
    priority: 2,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    models: [
      'deepseek-chat', 'deepseek-reasoner'
    ],
    rpmLimit: 20
  },
  {
    name: 'moonshot',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    models: [
      'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'
    ],
    rpmLimit: 20
  },
  {
    name: 'together',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'
    ],
    rpmLimit: 50
  },
  {
    name: 'fireworks',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
    models: [
      'f1-preview', 'accounts/fireworks/models/llama-v3p3-70b-instruct'
    ],
    rpmLimit: 30
  },
  {
    name: 'hyperbolic',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.hyperbolic.xyz/v1/chat/completions',
    models: [
      'meta-llama/Llama-3.2-3B-Instruct', 'deepseek-ai/DeepSeek-V3'
    ],
    rpmLimit: 50
  },
  {
    name: 'chutes',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://llm.chutes.ai/v1/chat/completions',
    models: [
      'llama-3.1-8b', 'meta-llama-3.1-8b-instruct'
    ],
    rpmLimit: 30
  },
  {
    name: 'inception',
    priority: 2,
    weight: 8,
    status: 'active',
    endpoint: 'https://api.inceptionlabs.ai/v1/chat/completions',
    models: [
      'mercury-2', 'mercury-coder', 'mercury-small'
    ],
    rpmLimit: 60
  },
  {
    name: 'xiaomi',
    priority: 3,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.mimo.xiaomi.com/v1/chat/completions',
    models: [
      'mimo-v2-pro', 'MiMo-V2-Flash', 'mimo-v2-omni'
    ],
    rpmLimit: 50
  },
  {
    name: 'ollama-cloud',
    priority: 3,
    weight: 10,
    status: 'active',
    endpoint: 'https://ollama.com/api',
    models: [
      'llama3.2:1b', 'qwen2.5:cloud', 'llama3.2:3b'
    ],
    rpmLimit: 50
  },
  {
    name: 'vertex',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://us-central1-aiplatform.googleapis.com/v1/projects/',
    models: [
      'gemini-1.5-pro', 'gemini-1.5-flash'
    ],
    rpmLimit: 20
  },
  {
    name: 'glm',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: [
      'glm-4-plus', 'glm-4-flash'
    ],
    rpmLimit: 30
  },
  {
    name: 'minimax',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.minimax.chat/v1/text_chat',
    models: [
      'abab7-chat', 'abab6.5-chat'
    ],
    rpmLimit: 20
  },
  {
    name: 'ollama',
    priority: 5,
    weight: 1,
    status: 'active',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    models: [
      'llama3.2', 'qwen2.5-coder', 'phi4', 'gemma2'
    ],
    rpmLimit: 100
  },
  // ─── Local CLI Daemon providers (type: local_http) ───────────────
  // Served by OmniRouteAI-Local daemon on http://localhost:5059
  // Enable via Firestore by setting status: 'active'
  // Daemon must be running: cd local-daemon && node src/main.js
  {
    name: 'claude_cli_local',
    type: 'local_http',
    priority: 0,      // Highest priority when enabled
    weight: 30,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/claude`
      : 'http://localhost:5059/claude',
    models: ['claude-opus-4.5', 'claude-sonnet-4.5', 'claude-3-5-sonnet', 'default'],
    rpmLimit: 999999
  },
  {
    name: 'gemini_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 30,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/gemini`
      : 'http://localhost:5059/gemini',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'default'],
    rpmLimit: 999999
  },
  {
    name: 'qwen_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 25,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/qwen`
      : 'http://localhost:5059/qwen',
    models: ['qwen3-235b-a22b', 'default'],
    rpmLimit: 999999
  },
  {
    name: 'antigravity_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 25,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/antigravity`
      : 'http://localhost:5059/antigravity',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'kilo_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/kilo`
      : 'http://localhost:5059/kilo',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'opencode_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/opencode`
      : 'http://localhost:5059/opencode',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'zai_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/zai`
      : 'http://localhost:5059/zai',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'cline_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/cline`
      : 'http://localhost:5059/cline',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'kimi_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/kimi`
      : 'http://localhost:5059/kimi',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'ollama_local_bridge',
    type: 'local_http',
    priority: 0,
    weight: 25,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/ollama`
      : 'http://localhost:5059/ollama',
    models: ['llama3.3', 'qwen2.5-coder', 'deepseek-r1', 'default'],
    rpmLimit: 999999
  },
  {
    name: 'codex_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/codex`
      : 'http://localhost:5059/codex',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'kiro_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/kiro`
      : 'http://localhost:5059/kiro',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'grok_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/grok`
      : 'http://localhost:5059/grok',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'copilot_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/copilot`
      : 'http://localhost:5059/copilot',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'iflow_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 15,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/iflow`
      : 'http://localhost:5059/iflow',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'cursor_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 25,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/cursor`
      : 'http://localhost:5059/cursor',
    models: ['default'],
    rpmLimit: 999999
  }
];


/**
 * Fetch active providers from Firestore, with local fallback and Redis caching.
 */
export async function getProviders() {
  const cacheKey = 'providers:list';

  try {
    // 1. Try Redis cache
    const cached = await get(cacheKey);
    if (cached) {
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }

    // 2. Load from source (Firestore or Static base)
    const db = getDb();
    const snapshot = await db.collection('providers').get();

    // Strategy: Start with STATIC_PROVIDERS as the base (always includes local CLI)
    // Then merge/overwrite with any data found in Firestore
    const providersMap = {};
    STATIC_PROVIDERS.forEach(p => { providersMap[p.name] = { ...p }; });

    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name) {
          providersMap[data.name] = { ...providersMap[data.name], ...data };
        }
      });
    }

    const providers = Object.values(providersMap);

    // Sort by priority (ascending) and then weight (descending)
    providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || (b.weight ?? 0) - (a.weight ?? 0));

    // Cache in Redis for 60 seconds
    await setex(cacheKey, 60, JSON.stringify(providers));

    return providers;
  } catch (err) {
    console.warn('Failed to fetch providers from DB/Cache, using static fallback:', err.message);
    return [...STATIC_PROVIDERS];
  }

}

/**
 * Get the default RPM limit for a provider from static config.
 *
 * @param {string} providerName
 * @returns {number}
 */
export function getDefaultRpmLimit(providerName) {
  const provider = STATIC_PROVIDERS.find((p) => p.name === providerName);
  return provider ? provider.rpmLimit : 30; // 30 is fallback
}
