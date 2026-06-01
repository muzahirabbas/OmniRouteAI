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
      'gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'gpt-5-nano', 'gpt-5-mini', 'gpt-5.4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'whisper-1'
    ],
    rpmLimit: 50,
    features: ['vision', 'audio', 'tool-calling'],
    supports_reasoning: true,
    reasoning_effort_default: 'none',
  },
  {
    name: 'anthropic',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: [
      'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-sonnet-4-6-20250514', 'claude-opus-4-6-20250514'
    ],
    rpmLimit: 50,
    features: ['vision', 'tool-calling'],
    supports_reasoning: true,
    thinking_budget_default: 0,
  },
  {
    name: 'google',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: [
      'gemini-2.0-flash-001', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemma-2-27b-it', 'gemma-4-31b-it', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-pro-preview-06-05'
    ],
    rpmLimit: 15,
    features: ['vision', 'audio', 'video', 'tool-calling'],
    supports_reasoning: true,
    thinking_budget_default: 0,
  },
  {
    name: 'xai',
    priority: 2,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    models: [
      'grok-4.20-reasoning', 'grok-4.1-fast-reasoning', 'grok-2', 'grok-3', 'grok-3-mini'
    ],
    rpmLimit: 20,
    features: ['vision', 'tool-calling'],
    supports_reasoning: true,
    reasoning_effort_default: 'medium',
  },
  {
    name: 'alibaba',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: [
      'qwen3-235b-a22b', 'qwen2.5-turbo', 'qwen2.5-plus', 'qwen-max', 'qwen-plus', 'qwen-turbo'
    ],
    rpmLimit: 30,
    features: ['vision', 'tool-calling']
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
    rpmLimit: 100,
    features: ['vision', 'tool-calling']
  },
  {
    name: 'groq',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      'llama-3.3-70b-versatile', 'llama-3.2-90b-vision-preview', 'llama-3.2-11b-vision-preview', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'whisper-large-v3'
    ],
    rpmLimit: 30,
    features: ['vision', 'tool-calling', 'transcription'],
    vision_models: ['llama-3.2-90b-vision-preview', 'llama-3.2-11b-vision-preview']
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
    rpmLimit: 20,
    features: ['tool-calling']
  },
  {
    name: 'moonshot',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.moonshot.ai/v1/chat/completions',
    models: [
      'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'
    ],
    rpmLimit: 20,
    features: ['vision', 'tool-calling']
  },
  {
    name: 'together',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    models: [
      "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
      "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen3.5-397B-A17B",
      "deepseek-ai/DeepSeek-V3.1",
      "mistralai/Mistral-Small-24B-Instruct-2501",
      "Qwen/Qwen2.5-7B-Instruct-Turbo",
      "google/gemma-3n-E4B-it"
    ],
    rpmLimit: 50,
    features: ['vision', 'tool-calling'],
    vision_models: ['meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8']
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
    rpmLimit: 30,
    features: ['vision', 'tool-calling']
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
    rpmLimit: 50,
    features: ['vision', 'tool-calling']
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
    rpmLimit: 30,
    features: ['vision', 'tool-calling']
  },
  {
    name: 'mistral',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: [
      'pixtral-12b-2409', 'mistral-large-latest', 'mistral-small-latest', 'codestral-latest'
    ],
    rpmLimit: 30,
    features: ['vision', 'tool-calling']
  },
  {
    name: 'perplexity',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    models: [
      'sonar-deep-research', 'sonar-pro', 'sonar'
    ],
    rpmLimit: 50,
    features: ['tool-calling']
  },
  {
    name: 'nvidia',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: [
      'meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia/llama-3.2-nv-90b-instruct'
    ],
    rpmLimit: 50,
    vision_models: ['nvidia/llama-3.2-nv-90b-instruct'],
    features: ['vision', 'tool-calling']
  },
  {
    name: 'cloudflare',
    priority: 4,
    weight: 2,
    status: 'active',
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/',
    models: [
      '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct', '@cf/llava-1.5-7b-hf', '@cf/openai/whisper', '@cf/facebook/seamless-ml'
    ],
    rpmLimit: 100,
    features: ['vision', 'audio', 'transcription'],
  },
  {
    name: 'huggingface',
    priority: 4,
    weight: 5,
    status: 'active',
    endpoint: 'https://router.huggingface.co/v1/chat/completions',
    models: [
      'meta-llama/Llama-3.1-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3'
    ],
    rpmLimit: 20,
    features: ['vision', 'transcription', 'tool-calling']
  },
  {
    name: 'sambanova',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://api.sambanova.ai/v1/chat/completions',
    models: [
      'Meta-Llama-3.3-70B-Instruct', 'DeepSeek-V3'
    ],
    rpmLimit: 100,
    features: ['tool-calling']
  },
  {
    name: 'modelscope',
    priority: 2,
    weight: 10,
    status: 'active',
    endpoint: 'https://api-inference.modelscope.cn/v1',
    models: [
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'Qwen/Qwen2.5-Math-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'ZhipuAI/GLM-4-9B-Chat',
      '01ai/Yi-1.5-34B-Chat'
    ],
    rpmLimit: 20,
    features: ['tool-calling']
  },
  {
    name: 'cerebras',
    priority: 1,
    weight: 20,
    status: 'active',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    models: [
      'llama3.1-8b', 'llama3.1-70b'
    ],
    rpmLimit: 100,
    features: ['tool-calling']
  },
  {
    name: 'cohere',
    priority: 2,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.cohere.ai/v2/chat',
    models: [
      'command-a-vision-07-2025', 'command-r-08-2024', 'command-r-plus-08-2024'
    ],
    rpmLimit: 40,
    features: ['tool-calling'],
    vision_models: ['command-a-vision-07-2025']
  },
  {
    name: 'nebius',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.studio.nebius.ai/v1/chat/completions',
    models: [
      'meta-llama/Meta-Llama-3.1-405B-Instruct'
    ],
    rpmLimit: 50,
    features: ['tool-calling']
  },
  {
    name: 'siliconflow',
    priority: 2,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    models: [
      'deepseek-v3', 'deepseek-r1'
    ],
    rpmLimit: 100,
    features: ['tool-calling']
  },
  {
    name: 'nanobanana',
    priority: 4,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.nanobananaapi.ai/v1/chat/completions',
    models: [
      'default'
    ],
    rpmLimit: 50,
    features: ['tool-calling']
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
    rpmLimit: 60,
    features: ['tool-calling']
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
    rpmLimit: 50,
    features: ['tool-calling']
  },
  {
    name: 'ollama-cloud',
    priority: 3,
    weight: 10,
    status: 'active',
    endpoint: 'https://ollama.com/v1/chat/completions',
    models: [
      'llama3.2:1b', 'qwen2.5:cloud', 'llama3.2:3b'
    ],
    rpmLimit: 50,
    features: ['tool-calling']
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
    rpmLimit: 20,
    features: ['vision', 'audio', 'video', 'tool-calling']
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
    rpmLimit: 30,
    features: ['vision', 'tool-calling']
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
    rpmLimit: 20,
    features: ['tool-calling']
  },
  {
    name: 'kilo',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://api.kilo.ai/api/gateway/chat/completions',
    models: [
      'anthropic/claude-3-5-sonnet',
      'anthropic/claude-3-7-sonnet',
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'google/gemini-1.5-pro',
      'google/gemini-2.0-flash',
      'meta-llama/llama-3.3-70b-instruct'
    ],
    rpmLimit: 100,
    features: ['vision', 'tool-calling'],
    vision_models: [
      'anthropic/claude-3-5-sonnet',
      'anthropic/claude-3-7-sonnet',
      'openai/gpt-4o',
      'google/gemini-1.5-pro'
    ]
  },

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
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
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
    rpmLimit: 999999,
    features: ['vision', 'audio', 'video', 'tool-calling']
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
    rpmLimit: 999999,
    features: ['vision', 'audio', 'video', 'tool-calling']
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
    models: [
      'claude-opus-4-6-thinking',
      'claude-sonnet-4-6-thinking',
      'claude-sonnet-4-6',
      'gemini-3-flash',
      'gemini-3.1-pro-low',
      'gemini-3.1-pro-high',
      'default'
    ],
    rpmLimit: 999999,
    features: ['vision', 'audio', 'video', 'tool-calling']
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
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-3-5-sonnet', 'default'],
    rpmLimit: 999999,
    features: ['vision', 'audio', 'video', 'tool-calling']
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
    models: [
      // Free models (Zen - OpenCode's model gateway)
      'minimax-m2.5-free',
      'mimo-v2-pro-free',
      'mimo-v2-omni-free',
      'qwen3.6-plus-free',
      'nemotron-3-super-free',
      'big-pickle',
      'gpt-5.4-nano',
      // Paid models
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'claude-opus-4.6',
      'claude-sonnet-4.6',
      'claude-haiku-4.5',
      'gemini-3.1-pro',
      'gemini-3-flash',
      'kimi-k2.5',
      'glm-5',
      'default'
    ],
    defaultModel: 'minimax-m2.5-free',
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
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
    models: ['glm-4-flash', 'glm-4', 'glm-3-turbo', 'default'],
    defaultModel: 'glm-4-flash',
    rpmLimit: 999999,
    features: ['tool-calling']
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
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
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
    models: ['kimi-k2.5', 'kimi-k1.5', 'default'],
    defaultModel: 'kimi-k1.5',
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
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
    models: [
      'llama3.3', 'deepseek-r1', 'lfm', 'gemma2', 'phi4', 'phi-4:latest', 'qwen2.5-coder', 'llava', 'moondream', 'default'
    ],
    modelFetchEndpoint: '/ollama/models',
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
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
    models: ['gpt-5.2-codex', 'gpt-5.1-codex-max', 'default'],
    rpmLimit: 999999,
    features: ['vision', 'audio', 'video', 'tool-calling']
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
    models: ['claude-haiku-4.5', 'claude-sonnet-4.5', 'claude-opus-4.5', 'deepseek-3.2', 'minimax-m2.1', 'minimax-m2.5', 'qwen3-coder-next', 'auto', 'default'],
    defaultModel: 'claude-haiku-4.5',
    rpmLimit: 999999,
    features: ['vision', 'audio', 'video', 'tool-calling']
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
    models: ['grok-2', 'grok-2-vision-12-19', 'grok-beta', 'default'],
    defaultModel: 'grok-2',
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
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
    models: ['claude-sonnet-4-5', 'gpt-4o', 'gpt-4o-mini', 'default'],
    defaultModel: 'default',
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
  },
  {
    name: 'qoder_cli_local',
    type: 'local_http',
    priority: 0,
    weight: 15,
    status: 'active',
    endpoint: process.env.LOCAL_DAEMON_URL
      ? `${process.env.LOCAL_DAEMON_URL}/qoder`
      : 'http://localhost:5059/qoder',
    models: ['lite', 'efficient', 'auto', 'performance', 'ultimate'],
    defaultModel: 'lite',
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
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
    rpmLimit: 999999,
    features: ['vision', 'tool-calling']
  },
  // OpenCode Zen - Direct API access (no CLI required)
  // Get API key from https://opencode.ai/zen
  {
    name: 'opencode_zen',
    priority: 1,
    weight: 20,
    status: 'active',
    endpoint: 'https://opencode.ai/zen/v1/chat/completions',
    models: [
      // Free models (limited time)
      'minimax-m2.5-free',
      'mimo-v2-pro-free',
      'mimo-v2-omni-free',
      'qwen3.6-plus-free',
      'nemotron-3-super-free',
      'big-pickle',
      'gpt-5.4-nano',
      // Paid models
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'claude-opus-4.6',
      'claude-sonnet-4.6',
      'claude-haiku-4.5',
      'gemini-3.1-pro',
      'gemini-3-flash',
      'kimi-k2.5',
      'glm-5'
    ],
    defaultModel: 'minimax-m2.5-free',
    rpmLimit: 100,
    requiresAuth: true,
    authEnvVar: 'OPENCODE_ZEN_API_KEY',
    features: ['vision', 'tool-calling']
  },

  // Audio transcription providers
  {
    name: 'deepgram',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.deepgram.com/v1/listen',
    models: ['nova-2', 'nova-3', 'whisper', 'base', 'enhanced'],
    rpmLimit: 50,
    features: ['audio', 'transcription'],
  },
  {
    name: 'assemblyai',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.assemblyai.com/v2/transcript',
    models: ['best', 'nano'],
    rpmLimit: 50,
    features: ['audio', 'transcription'],
  },
  {
    name: 'vercel-ai-gateway',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://ai-gateway.vercel.sh/v1/chat/completions',
    models: [
      'openai/gpt-5.5',
      'anthropic/claude-opus-4.7',
      'xai/grok-4.3',
      'google/gemini-3.1-pro-preview',
      'meta-llama/llama-4-maverick',
      'deepseek-ai/deepseek-r1',
      'qwen/qwen3-coder-480b-a35b',
      'mistralai/mistral-large-3',
    ],
    rpmLimit: 100,
    requiresAuth: true,
    authEnvVar: 'VERCEL_AI_GATEWAY_API_KEY',
    features: ['vision', 'tool-calling'],
  },
  {
    name: 'github-models',
    priority: 2,
    weight: 8,
    status: 'active',
    endpoint: 'https://models.github.ai/inference/chat/completions',
    models: [
      'gpt-5',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4o',
      'o4-mini',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek-r1',
      'mistralai/mistral-small-3.1-24b-instruct',
    ],
    rpmLimit: 50,
    requiresAuth: true,
    authEnvVar: 'GITHUB_TOKEN',
    features: ['vision', 'tool-calling'],
  },
  {
    name: 'ovhcloud',
    priority: 2,
    weight: 5,
    status: 'active',
    endpoint: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
    models: [
      'Meta-Llama-3_3-70B-Instruct',
      'Meta-Llama-3_1-8B-Instruct',
      'DeepSeek-R1-Distill-Llama-70B',
      'Qwen3-32B',
      'Qwen3-Coder-30B-A3B-Instruct',
      'Qwen2.5-VL-72B-Instruct',
      'Mixtral-8x7B-Instruct-v0.1',
      'Mistral-Nemo-Instruct-2407',
    ],
    rpmLimit: 400,
    requiresAuth: true,
    authEnvVar: 'OVH_AI_ENDPOINTS_TOKEN',
    features: ['vision', 'tool-calling'],
  },
  {
    name: 'nscale',
    priority: 2,
    weight: 5,
    status: 'active',
    endpoint: 'https://inference.api.nscale.com/v1/chat/completions',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct',
      'Qwen3-Coder-30B-A3B-Instruct',
      'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
      'openai/gpt-oss-120b',
      'Qwen3-32B',
    ],
    rpmLimit: 30,
    requiresAuth: true,
    authEnvVar: 'NSCALE_API_KEY',
    features: ['tool-calling'],
  },
  {
    name: 'aion-labs',
    priority: 3,
    weight: 3,
    status: 'active',
    endpoint: 'https://api.aionlabs.ai/v1/chat/completions',
    models: [
      'aion-2.0',
      'aion-1.0',
      'aion-1.0-mini',
    ],
    rpmLimit: 20,
    requiresAuth: true,
    authEnvVar: 'AION_LABS_API_KEY',
    features: [],
  },
  {
    name: 'llm7',
    priority: 3,
    weight: 3,
    status: 'active',
    endpoint: 'https://api.llm7.io/v1/chat/completions',
    models: [
      'deepseek-r1-0528',
      'deepseek-v3-0324',
      'gemini-2.5-flash-lite',
      'gpt-4o-mini',
      'mistral-small-3.1-24b',
      'qwen2.5-coder-32b',
    ],
    rpmLimit: 30,
    requiresAuth: true,
    authEnvVar: 'LLM7_API_KEY',
    features: ['vision', 'tool-calling'],
  },
  {
    name: 'ai21',
    priority: 4,
    weight: 2,
    status: 'active',
    endpoint: 'https://api.ai21.com/studio/v1/chat/completions',
    models: [
      'jamba-large-1.7',
      'jamba-mini-2',
    ],
    rpmLimit: 200,
    requiresAuth: true,
    authEnvVar: 'AI21_API_KEY',
    features: ['tool-calling'],
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
    
    // Hardening: Firestore can sometimes hang during cold starts or network congestion.
    // We race it against a 10s timeout to ensure the app doesn't freeze.
    const firestorePromise = db.collection('providers').get();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firestore operation timed out')), 10000)
    );
    
    const snapshot = await Promise.race([firestorePromise, timeoutPromise]);

    // Strategy: Start with STATIC_PROVIDERS as the base (always includes local CLI)
    // Then merge/overwrite with any data found in Firestore
    const providersMap = {};
    STATIC_PROVIDERS.forEach(p => { providersMap[p.name] = { ...p }; });

    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name) {
          const staticBase = providersMap[data.name] || {};
          // Preserve static features - only use Firestore features if static has none
          const features = staticBase.features?.length > 0 ? staticBase.features : data.features;
          providersMap[data.name] = {
            ...staticBase,
            ...data,
            // Preserve static features to ensure audio/vision capabilities aren't lost
            features: features || staticBase.features,
            // Static type is authoritative
            type: staticBase.type || data.type,
          };
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
