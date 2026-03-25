/**
 * Static provider configuration with full model lists.
 * This acts as a fallback if Firestore is empty and as the source for seeding.
 */
import { getDb } from './firestore.js';
import { get, set } from './redis.js';

export const STATIC_PROVIDERS = [
  {
    name: 'openai',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.2', 'gpt-5.1', 'gpt-5-mini', 'gpt-5-nano',
      'o3-mini', 'gpt-4.5-turbo', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
      'gpt-4o-mini', 'o1', 'o1-mini'
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
      'claude-opus-4.5', 'claude-sonnet-4.5', 'claude-4.6-opus-20260205', 'claude-4.6-sonnet-20260217',
      'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus-20240229'
    ],
    rpmLimit: 50
  },
  {
    name: 'google',
    priority: 2,
    weight: 8,
    status: 'active',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: [
      'gemini-3.1-flash-lite', 'gemini-3-flash', 'gemini-3-pro-preview', 'gemini-2.5-pro',
      'gemini-2.5-flash', 'gemini-2.0-flash-001', 'gemma-3-12b-it', 'gemma-2-27b-it', 'gemma-3n-e2b-it'
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
      'grok-4-0709', 'grok-4-1-fast', 'grok-code-fast-1', 'grok-3', 'grok-2', 'grok-2-mini', 'grok-1.5'
    ],
    rpmLimit: 20
  },
  {
    name: 'alibaba',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: [
      'qwen3-235b-a22b', 'qwen3-30b-a3b', 'qwen2.5-turbo', 'qwen2.5-plus', 'qwen2.5-omni-7b',
      'qwen-coder-32b-instruct', 'qwen-max-2025-01-25', 'qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-coder'
    ],
    rpmLimit: 30
  },
  {
    name: 'ollama',
    priority: 5,
    weight: 1,
    status: 'active',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    models: [
      'llama3.3', 'llama3.2', 'qwen2.5-coder', 'phi4', 'gemma2', 'mistral', 'deepseek-coder', 'starcoder2'
    ],
    rpmLimit: 100
  },
  {
    name: 'openrouter',
    priority: 4,
    weight: 5,
    status: 'active',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      'openai/gpt-5.4', 'anthropic/claude-opus-4.5', 'anthropic/claude-4.6-opus-20260205',
      'google/gemini-2.5-flash', 'google/gemini-3-flash', 'xai/grok-4-0709', 'openrouter/deepseek-v3',
      'openrouter/meta-llama-3.3-70b-instruct', 'openrouter/qwen3-30b-a3b', 'google/gemma-3-27b-it',
      'deepseek/deepseek-chat', 'groq/llama-3.3-70b-versatile', 'moonshotai/kimi-k2.5', 'mistralai/mistral-large'
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
      'deepseek-v3', 'deepseek-r1', 'deepseek-chat', 'deepseek-reasoning-r1', 'deepseek-coder'
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
      'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2', 'kimi-k2.5'
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
      'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'
    ],
    rpmLimit: 50
  },
  {
    name: 'nvidia',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: [
      'meta/llama-3.2-11b-vision-instruct', 'meta/llama-3.2-3b-instruct', 'meta/llama3-8b-instruct',
      'mistralai/mistral-7b-instruct-v0.3', 'google/gemma-3-12b-it', 'google/gemma-3-27b-it',
      'google/gemma-2-9b-it', 'phi-4-mini-instruct', 'phi-3.5-mini-instruct',
      'granite-3.3-8b-instruct', 'granite-34b-code-instruct', 'granite-3.0-8b-instruct',
      'granite-3.0-3b-a800m-instruct', 'nemotron-mini-4b-instruct', 'jamba-1.5-mini-instruct',
      'breeze-7b-instruct', 'solar-10.7b-instruct'
    ],
    rpmLimit: 50
  },
  {
    name: 'cloudflare',
    priority: 4,
    weight: 2,
    status: 'active',
    models: [
      '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.1', '@cf/google/gemma-7b-it',
      '@cf/qwen/qwen1.5-7b-chat-awq', '@cf/tinyllama/tinyllama-1.1b-chat-v1.0',
      '@cf/microsoft/phi-2', '@cf/deepseek/deepseek-math-7b-instruct',
      'llama3-8b', 'mistral-7b', 'phi-2'
    ],
    rpmLimit: 100
  },
  {
    name: 'inception',
    priority: 2,
    weight: 8,
    status: 'active',
    endpoint: 'https://api.inceptionlabs.ai/v1/chat/completions',
    models: ['inception/mercury-2', 'inception/mercury-coder'],
    rpmLimit: 60
  },
  {
    name: 'xiaomi',
    priority: 3,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.mimo.xiaomi.com/v1/chat/completions',
    models: ['mi-mimo-v2-pro', 'mi-mimo-v2-omni', 'mi-mimo-v2-flash'],
    rpmLimit: 50
  },
  {
    name: 'huggingface',
    priority: 4,
    weight: 5,
    status: 'active',
    endpoint: 'https://api-inference.huggingface.co/models/',
    models: [
      'meta-llama/Llama-3.1-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3',
      'google/gemma-2-9b', 'HuggingFaceH4/zephyr-7b-beta'
    ],
    rpmLimit: 20
  },
  {
    name: 'sambanova',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://api.sambanova.ai/v1/chat/completions',
    models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-V3', 'Qwen3-235B'],
    rpmLimit: 100
  },
  {
    name: 'cerebras',
    priority: 1,
    weight: 20,
    status: 'active',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    models: ['llama3.1-8b', 'llama3.1-70b'],
    rpmLimit: 100
  },
  {
    name: 'cohere',
    priority: 2,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.cohere.ai/v2/chat',
    models: ['command-r-08-2024', 'command-r-plus-08-2024'],
    rpmLimit: 40
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
    status: 'inactive',
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
    status: 'inactive',
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
    status: 'inactive',
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
    status: 'inactive',
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
    status: 'inactive',
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
    status: 'inactive',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/opencode`
      : 'http://localhost:5059/opencode',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'qodo_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'inactive',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/qodo`
      : 'http://localhost:5059/qodo',
    models: ['default'],
    rpmLimit: 999999
  },
  {
    name: 'codex_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 20,
    status: 'inactive',
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
    status: 'inactive',
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
    status: 'inactive',
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
    status: 'inactive',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/copilot`
      : 'http://localhost:5059/copilot',
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

    // 2. Try Firestore
    const db = getDb();
    const snapshot = await db.collection('providers').where('status', '==', 'active').get();

    let providers = [];
    if (!snapshot.empty) {
      snapshot.forEach(doc => providers.push(doc.data()));
    } else {
      // 3. Fallback to static config
      providers = STATIC_PROVIDERS.filter(p => p.status === 'active');
    }

    // Sort by priority (ascending) and then weight (descending)
    providers.sort((a, b) => a.priority - b.priority || b.weight - a.weight);

    // Cache in Redis for 60 seconds
    await set(cacheKey, JSON.stringify(providers), 'EX', 60);

    return providers;
  } catch (err) {
    console.warn('Failed to fetch providers from DB/Cache, using static fallback:', err.message);
    return STATIC_PROVIDERS.filter(p => p.status === 'active');
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
