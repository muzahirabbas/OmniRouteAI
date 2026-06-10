# OmniRouteAI — The Ultimate AI Routing Gateway

<p align="center">
  <img src="https://img.shields.io/badge/Version-2.9-brightgreen?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-teal?style=for-the-badge" alt="License">
  <img src="https://img.shields.io/badge/Providers-50%2B-blue?style=for-the-badge" alt="Providers">
  <img src="https://img.shields.io/badge/Search-8%20Providers-orange?style=for-the-badge" alt="Search">
</p>

**OmniRouteAI** is a production-grade AI inference engine and router that unifies **50+ AI providers**, **8 web search providers**, and **16+ local CLI tools** into a single OpenAI-compatible API. It provides intelligent priority-tier routing with weighted random selection, automatic failover with key rotation, circuit breakers, multimodal support, audio transcription, streaming, thinking/reasoning display, semantic caching, and a full-featured web dashboard.

```
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"omniauto","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [Key Features](#key-features)
- [Routing System](#routing-system)
- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Usage Examples](#usage-examples)
- [Supported Providers](#supported-providers)
- [Model Weighting System](#model-weighting-system)
- [Adapter System](#adapter-system)
- [Error Handling & Retry Policy](#error-handling--retry-policy)
- [Web Dashboard](#web-dashboard)
- [Local CLI Daemon](#local-cli-daemon)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

---

## Quick Start

```bash
# Clone
git clone https://github.com/muzahirabbas/OmniRouteAI.git
cd OmniRouteAI

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API_KEY, Redis URL, Firestore credentials

# Start
npm start

# Test
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"omniauto","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Key Features

### Routing & Intelligent Failover
- **Auto Routing** (`omniauto`): Routes to the best provider using priority-tier weighted-random selection with each provider's default model
- **Provider:Model Format** (`openai:gpt-4o`): Explicit provider prefix — splits on first colon only, supports model names with colons
- **Weight Sentinels** (`omnilowest`–`omnihighest`): Filter models by weight (1-5) for cost/quality-based auto-routing
- **Priority Tiers**: Providers grouped by priority (0 = highest, 4 = lowest), sampled tier-by-tier
- **Weighted Random Selection**: Within each tier, providers picked randomly proportional to their weight
- **3-Attempt Strict Retry**: Key 1 → Key 2 (same provider) → provider failover → throw
- **Circuit Breaker**: ≥50% error rate with ≥5 samples trips provider for 5 minutes (30s for local tools)
- **Vision/Audio/Video Capability Filtering**: Automatically skips providers without required features
- **Vision-Aware Model Swap**: Swaps to first vision-capable model when images are detected

### Key Management & Rotation
- **Multi-Key Support**: Unlimited API keys per provider
- **Atomic Least-Used Key Selection**: Lua scripts guarantee race-free key selection under high concurrency
- **Auto-Disable**: Keys auto-disabled after 3 failures in 60s window
- **RPM Tracking**: Per-key requests-per-minute tracking with automatic avoidance of exhausted keys
- **Key Metadata**: Account IDs and project regions stored per-key for Cloudflare, Vertex AI, and Google PSE

### Multimodal Support
- **Vision**: Image input via URL, base64, or upload (playground)
- **Audio**: Audio file input for supported providers
- **Video**: Video file input for Gemini and Google Vertex
- **Paste Support**: Paste images directly into playground

### Audio Transcription
- **5 Providers**: OpenAI Whisper, Groq Whisper, AssemblyAI, Cloudflare Whisper, Deepgram
- **Unified Endpoint**: `/v1/audio/transcriptions` auto-routes to best available provider
- **Auto-Routing**: Request `whisper-1` and system finds best transcription provider automatically

### Web Search (8 Providers)
| Provider | Free Tier | API Key |
|---|---|---|
| Tavily | 1000 queries/mo | Required |
| Brave Search | 2000 queries/mo | Required |
| Serper | 1000 queries/mo | Required |
| Exa | 100k chars/mo | Required |
| Firecrawl | 500 pages/mo | Required |
| **DuckDuckGo** | **Unlimited** | **None!** |
| SearchAPI | 100 on signup | Required |
| Google PSE | 100/day | Required |

### Streaming & Real-Time
- **Server-Sent Events (SSE)**: Full streaming support with `text/event-stream`
- **Thinking/Reasoning**: Real-time reasoning tokens from Claude, Gemini, Grok, DeepSeek R1
- **Stream Fallback**: Auto-fallback to non-streaming when provider doesn't support streaming
- **Client Disconnect Handling**: Aborts on client disconnect

### Advanced Features
- **OpenAI Responses API**: `/v1/responses` with conversation threading and `previous_response_id`
- **Tool Calling**: OpenAI-compatible `tools` and `tool_choice`, auto-failover on tool errors
- **Task Classification**: Auto-classifies prompts as `coding`, `fast`, `fast_loop`, or `general`
- **Semantic Caching**: Redis-powered prompt+model response caching (default 1h TTL)
- **Request Queue**: BullMQ-backed queue for non-streaming requests with priority levels
- **Custom Providers**: Add any OpenAI/Anthropic-compatible endpoint
- **Batch Processing**: `/v1/batches` endpoint for parallel requests (max 100)
- **Rate Limiting**: Sliding-window per-IP and per-key rate limits

### Local CLI Bridge
Connect local AI tools through the daemon:
- Claude Code, Gemini CLI, OpenCode, Cline, Qwen CLI, Kimi CLI, Kiro CLI, Antigravity, Kilo AI, Zai CLI, Codex CLI, Copilot CLI, Grok CLI, Qoder CLI, Ollama

---

## Routing System

### Routing Modes

| Mode | Example | Behavior |
|---|---|---|
| **Auto** | `"model": "omniauto"` | Auto-route across all active providers using priority-tier weighted selection |
| **Provider:Model** | `"model": "openai:gpt-4o"` | Route to a specific provider + model (split on first colon only) |
| **Weight Sentinel** | `"model": "omnihigh"` | Auto-route filtered by model weight tier (see below) |
| **Explicit Provider** | `"provider": "anthropic"` | Route only to the named provider (any of its models) |
| **URL Path** | `POST /groq/v1/chat/completions` | Provider from URL path takes priority |

### Model Weighting System

Each model can be assigned a weight from 1 (basic) to 5 (premium). Default is 3 (medium). Six synthetic models use these weights for weight-filtered auto-routing:

| Model | Weight Range | Use Case |
|---|---|---|
| `omnilowest` | exactly 1 | Cheapest — transcription, embeddings, safety filters |
| `omnilow` | 1 – 2 | Low cost — small/older models |
| `omnimedium` | 2 – 4 | General purpose — default range |
| `omnihigh` | 4 – 5 | High quality — strong models |
| `omnihighest` | exactly 5 | Premium — frontier models |

Set weights via the **Models** tab in the dashboard or the admin API:
```bash
curl -X PUT https://your-backend.com/api/admin/providers/openai/model-weight \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "weight": 4}'
```

### Retry Policy (Strict — 3 Attempts Max)

```
Attempt 0: Provider A, Key 1    → fail
Attempt 1: Provider A, Key 2    → fail (same provider, different key)
Attempt 2: Provider B, any key  → fail (failover to next provider)
                                → throw AllProvidersExhaustedError
```

- Keys are NEVER reused within the same request
- Providers are skipped after 2 consecutive failures
- Vision-related errors skip the provider immediately

### Provider Selection Algorithm

```
getProviders() → merge Firestore + static config → sort by priority ASC, weight DESC
       ↓
getActiveProviders() → filter: status=active AND NOT circuit-broken
       ↓
Group by priority tier (0 = highest)
       ↓
Within lowest remaining tier: weighted random shuffle (cumulative weight sampling)
       ↓
Iterate providers: check capabilities → select model → select key → execute
       ↓
On failure: escalate to next key, then next tier, then throw
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OmniRouteAI Architecture                        │
└─────────────────────────────────────────────────────────────────────────────┘

                           ┌─────────────────────────────┐
                           │      Client Requests        │
                           │  (cURL, Python, JS, n8n)   │
                           └─────────────┬─────────────┘
                                         │ HTTPS
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               BACKEND SERVER                                 │
│                          (Fastify on Railway/Render)                         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          ROUTER SERVICE                             │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐ │   │
│  │  │ Classifier  │─▶│  Provider    │─▶│  Key        │─▶│  Adapter │ │   │
│  │  │ (Task Type) │  │  Selector    │  │  Rotator    │  │  Dispatch│ │   │
│  │  │             │  │  (Priority)  │  │  (Least-Used│  │          │ │   │
│  │  └─────────────┘  └──────────────┘  └─────────────┘  └──────────┘ │   │
│  │                                                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ Search Router│  │ Circuit      │  │ Response     │              │   │
│  │  │ (8 providers)│  │ Breaker      │  │ Cache (SHA256│              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          QUEUE / WORKER                             │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                   │   │
│  │  │  BullMQ (Redis)     │  │  Job Worker          │                   │   │
│  │  │  chat-completions   │─▶│  (non-streaming      │                   │   │
│  │  │  priority: low/high │  │   + queue fallback)  │                   │   │
│  │  └─────────────────────┘  └─────────────────────┘                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                     │
│                    ┌─────────────────┼─────────────────┐                   │
│                    ▼                 ▼                  ▼                   │
│           ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│           │   Redis      │  │  Firestore   │  │   Local      │           │
│           │              │  │              │  │   Daemon     │           │
│           │ • Cache      │  │ • Providers  │  │              │           │
│           │ • Queue      │  │ • API Keys   │  │ • Claude     │           │
│           │ • Key Stats  │  │ • Search     │  │ • Gemini     │           │
│           │ • RPM        │  │ • Logs       │  │ • OpenCode   │           │
│           │ • Search     │  │ • Stats      │  │ • Kiro       │           │
│           │ • Circuit    │  │ • Config     │  │ • Qwen       │           │
│           └──────────────┘  └──────────────┘  │ • Kimi       │           │
│                                                │ • Ollama     │           │
│                                                │ • Cline      │           │
│                                                │ • Codex      │           │
│                                                │ +12 more     │           │
│                                                └──────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
                   │                      │                      │
                   ▼                      ▼                      ▼
         ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
         │  Cloud LLM      │  │  Web Search     │  │  Local CLI      │
         │  Providers      │  │  Providers      │  │  Tools          │
         │                 │  │                 │  │                 │
         │  • OpenAI       │  │  • Tavily       │  │  • Claude Code  │
         │  • Anthropic    │  │  • Brave        │  │  • Gemini CLI   │
         │  • Gemini       │  │  • Serper       │  │  • OpenCode     │
         │  • Groq         │  │  • Exa          │  │  • Cline        │
         │  • DeepSeek     │  │  • DuckDuckGo   │  │  • Qwen CLI     │
         │  • 45+ more     │  │  • Firecrawl    │  │  • 16+ CLI tools│
         └─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Data Flow for a Chat Request

```
1. Client sends { model:"omniauto", messages:[...] }
       ↓
2. Rate limiter checks (per-IP + per-key sliding windows)
       ↓
3. Input normalization (handles prompt/messages/images formats)
       ↓
4. Task classification (coding | fast | fast_loop | general)
       ↓
5. For streaming: routeAndExecute() directly
   For non-streaming: enqueue to BullMQ → worker calls routeAndExecute()
       ↓
6. route() selects provider:
   a. getActiveProviders() → filter by status + circuit breaker
   b. Group by priority tier → weighted random shuffle
   c. Filter by capabilities (vision/audio/video)
   d. Select model (auto → defaultModel, weight sentinel → weight-filtered)
   e. Atomic least-used key selection (Lua script)
   f. Return { provider, model, apiKey }
       ↓
7. Adapter dispatch → sendRequest() or sendStreamRequest()
       ↓
8. Token counting + stats recording
       ↓
9. On success: return response (cache if non-streaming)
   On failure: retry with next key → next provider → throw
```

### Adapter System

43 adapter files bridge each provider's native protocol to a unified interface:

```
BaseAdapter (abstract class)
├── OpenAI-Compatible (20+ providers)
│   ├── openaiAdapter.js (native OpenAI)
│   ├── openaiCompatibleAdapter.js (generic)
│   ├── deepseekAdapter.js, xaiAdapter.js, mistralAdapter.js
│   ├── togetherAdapter.js, nvidiaAdapter.js, sambanovaAdapter.js
│   ├── githubModelsAdapter.js, ollamaCloudAdapter.js
│   ├── clineAdapter.js, openrouterAdapter.js
│   └── inferenceAdapter.js (shared: fireworks, nebius, siliconflow,
│       hyperbolic, chutes, nanobanana, opencode_zen, modelscope,
│       kilo, vercel-ai-gateway, ovhcloud, nscale, aion-labs, llm7,
│       ai21, nous)
├── Native Protocol
│   ├── anthropicAdapter.js
│   ├── geminiAdapter.js (vision, audio, video)
│   ├── vertexAdapter.js (requires projectId/region)
│   ├── cohereAdapter.js
│   └── cloudflareAdapter.js (requires accountId)
├── Audio Transcription
│   ├── openaiWhisperAdapter.js
│   ├── groqWhisperAdapter.js
│   ├── deepgramAdapter.js
│   ├── assemblyaiAdapter.js
│   └── cloudflareAdapter.js (whisper)
└── Local HTTP
    └── localHttpAdapter.js (all 16 CLI providers)
```

---

## API Endpoints

### LLM Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/v1/chat/completions` | Chat completions (OpenAI-compatible) |
| `POST` | `/v1/responses` | OpenAI Responses API with conversation threading |
| `POST` | `/v1/batches` | Batch chat completions (max 100) |
| `GET` | `/v1/models` | List all models (incl. synthetic router models) |
| `GET` | `/v1/models/:model` | Single model details |
| `GET` | `/:provider/v1/models` | Models for a specific provider |
| `POST` | `/:provider/v1/chat/completions` | Force route to a specific provider |
| `POST` | `/:provider/v1/responses` | Responses API for a specific provider |
| `POST` | `/v1/audio/transcriptions` | Transcribe audio (auto-routes) |
| `POST` | `/:provider/v1/audio/transcriptions` | Force transcription provider |

### Search Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/search` | Global web search (auto-routes) |
| `POST` | `/:provider/v1/search` | Force specific search provider |
| `GET` | `/v1/search/models` | List available search providers |
| `GET` | `/v1/tools` | Get `web_search` tool definition for agents |

### Admin Endpoints

#### Providers
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/providers` | List all providers with health + key counts |
| `PUT` | `/api/admin/providers/:name` | Update provider config |
| `POST` | `/api/admin/providers` | Create custom provider |
| `DELETE` | `/api/admin/providers/:name` | Delete provider and all its keys |
| `POST` | `/api/admin/providers/:name/toggle` | Enable/disable provider |
| `POST` | `/api/admin/providers/refresh` | Full Firestore sync (keys, circuit breakers) |
| `POST` | `/api/admin/providers/fetch-models` | Auto-discover models from provider API |
| `POST` | `/api/admin/seed-providers` | Seed all static providers to Firestore |
| `GET` | `/api/admin/providers/:name/health` | Circuit breaker health for one provider |
| `GET` | `/api/admin/providers/:name/models` | Models for one provider |

#### Models & Weights
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/models` | List all models as `provider:model` |
| `PUT` | `/api/admin/providers/:name/model-weight` | Set one model's weight (1-5) |
| `PUT` | `/api/admin/providers/:name/model-weights` | Batch set all weights for a provider |

#### API Keys
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/keys/:provider` | List keys with usage, RPM, tokens |
| `GET` | `/api/admin/keys/:provider/status` | Key availability status |
| `GET` | `/api/admin/keys/:provider/history` | Historical per-key stats (up to 30 days) |
| `GET` | `/api/admin/rpm/:provider` | RPM status per key |
| `POST` | `/api/admin/keys/:provider` | Add a key |
| `DELETE` | `/api/admin/keys/:provider/:id` | Remove a key |
| `POST` | `/api/admin/keys/:provider/:id/toggle` | Enable/disable a key |

#### Search
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/search-providers` | List search providers |
| `PUT` | `/api/admin/search-providers/:name` | Update search provider |
| `POST` | `/api/admin/search-providers/:name/toggle` | Enable/disable |
| `POST` | `/api/admin/search-providers/seed` | Seed search providers |
| `GET` | `/api/admin/search-keys/:provider` | List search API keys |
| `POST` | `/api/admin/search-keys/:provider` | Add search API key |
| `DELETE` | `/api/admin/search-keys/:provider/:key` | Remove search key |
| `POST` | `/api/admin/search-keys/:provider/:key/toggle` | Enable/disable search key |

#### System
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/health` | System health (Redis + Firestore) |
| `GET` | `/api/admin/overview` | Dashboard overview with provider health |
| `GET` | `/api/admin/simulate-rotation` | Dry-run provider selection test |
| `GET` | `/api/admin/stats` | Today's usage statistics |
| `GET` | `/api/admin/stats/history` | Stats history (7-90 days) |
| `POST` | `/api/admin/stats/aggregate` | Aggregate daily stats to Firestore |
| `GET` | `/api/admin/logs` | Query request logs (cursor-paginated) |
| `POST` | `/api/admin/logs/flush` | Flush in-memory log buffer |
| `POST` | `/api/admin/clear-cache` | Flush entire Redis cache |
| `POST` | `/api/admin/test/simulate-error` | Inject failures to trip circuit breaker |
| `POST` | `/api/admin/test/recover-provider` | Reset circuit breaker |

---

## Usage Examples

### 1. Auto Routing (Recommended)

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "omniauto",
    "messages": [{"role": "user", "content": "Write a Python function to reverse a string"}]
  }'
```

### 2. Specific Provider:Model

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai:gpt-4o",
    "messages": [{"role": "user", "content": "Explain quantum computing"}]
  }'
```

### 3. Weight-Filtered Routing

```bash
# Only use premium models (weight 5)
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "omnihighest",
    "messages": [{"role": "user", "content": "Write a complex algorithm"}]
  }'

# Only use budget models (weight 1-2)
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "omnilow",
    "messages": [{"role": "user", "content": "Summarize this text"}]
  }'
```

### 4. Streaming

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "groq:llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Count from 1 to 10"}],
    "stream": true
  }'
```

### 5. Thinking/Reasoning

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic:claude-sonnet-4-6-thinking",
    "messages": [{"role": "user", "content": "Solve a complex math problem"}],
    "thinking": true
  }'
```

### 6. Multimodal (Image)

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}}
      ]}
    ]
  }'
```

### 7. Audio Transcription

```bash
curl -X POST https://your-backend.com/v1/audio/transcriptions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@recording.mp3" \
  -F "model=whisper-1"
```

### 8. Web Search

```bash
# Auto-routed
curl -X POST https://your-backend.com/v1/search \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "Latest AI news", "max_results": 5}'

# Force provider
curl -X POST https://your-backend.com/tavily/v1/search \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?"}'
```

### 9. Tool Calling (AI Agents)

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
```

### 10. OpenAI Responses API

```bash
curl -X POST https://your-backend.com/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai:gpt-4o",
    "input": "What is the capital of France?",
    "previous_response_id": "prev_resp_id_here"
  }'
```

---

## Supported Providers

### LLM Providers (50+)

| Provider | Key Models | Priority | Vision | Audio | Free Tier |
|---|---|---|---|---|---|
| `openai` | gpt-4o, gpt-4o-mini, o1 | 1 | Yes | No | No |
| `anthropic` | claude-sonnet-4-6, claude-haiku-4.5 | 1 | Yes | No | $5 credit |
| `google` | gemini-2.0-flash, gemma-4-31b-it | 1 | Yes | Yes | 15 RPM |
| `groq` | llama-3.3-70b, whisper-large-v3 | 1 | Yes | No | 30 RPM |
| `deepseek` | deepseek-v4-pro, deepseek-v4-flash | 2 | No | No | Limited free |
| `openrouter` | 200+ models from all providers | 1 | Yes | No | Paid |
| `sambanova` | DeepSeek-R1-0528, Llama-4-Maverick, Qwen3-235B | 1 | No | No | Paid |
| `cerebras` | llama3.1-70b, qwen-3-235b | 1 | No | No | Paid |
| `xai` (Grok) | grok-2, grok-2-vision | 2 | Yes | No | Paid |
| `together` | Llama-4-Maverick, Qwen3.5-397B | 3 | Yes | No | Paid |
| `nvidia` | nemotron-3-ultra-550b, deepseek-v4-pro, kimi-k2.6 | 3 | Yes | No | Paid |
| `mistral` | mistral-large, codestral, ministral | 3 | Yes | No | Paid |
| `cohere` | command-a-vision, command-r-plus | 2 | Yes | No | Paid |
| `perplexity` | sonar-pro, sonar-deep-research | 3 | No | No | Paid |
| `fireworks` | deepseek-v4-pro, glm-5.1, kimi-k2.6 | 3 | Yes | No | Paid |
| `hyperbolic` | Qwen3-235B, DeepSeek-V3.2 | 3 | Yes | No | Paid |
| `chutes` | MiniMax-M2.5-TEE, DeepSeek-V3.2-TEE | 3 | Yes | No | Paid |
| `alibaba` (Qwen) | qwen3-235b-a22b, qwen-max | 3 | Yes | No | Paid |
| `moonshot` | kimi-k2.5, moonshot-v1 | 3 | Yes | No | Paid |
| `ollama-cloud` | qwen3.5:397b, nemotron-3-ultra, minimax-m3 | 3 | No | No | Free tier |
| `github-models` | gpt-4.1, gpt-5-mini, codestral, phi-4 | 1 | Yes | No | Paid |
| `cloudflare` | whisper, glm-4.7, nemotron-3 | 4 | Yes | Yes | 10k req/day |
| `huggingface` | DeepSeek-V4-Pro, Phi-3.5-vision | 4 | Yes | Yes | Free |
| `vertex` | gemini-1.5-pro, gemini-2.5-flash-lite | 3 | Yes | Yes | Paid |
| `opencode_zen` | deepseek-v4-flash-free, nemotron-3-ultra-free, minimax-m3-free | 1 | No | No | **Free** |
| `vercel-ai-gateway` | gpt-5.5, claude-opus-4.7, grok-4.3 | 1 | Yes | No | Paid |
| `ovhcloud` | Llama-3.3-70B, Qwen3-32B | 1 | No | No | Paid |
| `nscale` | Llama-3.3-70B, Kimi-K2.5, Qwen3-32B | 2 | No | No | Paid |
| `xai` | grok-2, grok-beta | 2 | Yes | No | Paid |
| `inception` | mercury-2, mercury-coder | 3 | No | No | Paid |
| `deepgram` | nova-2, nova-3 (transcription) | 1 | No | Yes | Paid |
| `assemblyai` | best, nano (transcription) | 1 | No | Yes | Paid |
| `llm7` | deepseek-r1-0528, gpt-4o-mini | 3 | Yes | No | Paid |
| `ai21` | jamba-large-1.7, jamba-mini-2 | 4 | No | No | Paid |
| `xiaomi` | mimo-v2-pro, mimo-v2.5 | 3 | No | No | Paid |
| `glm` | glm-4-plus, glm-4-flash | 3 | Yes | No | Paid |
| `minimax` | abab7-chat, abab6.5 | 3 | No | No | Paid |
| `siliconflow` | deepseek-v3, deepseek-r1 | 2 | No | No | Paid |
| `modelscope` | Qwen2.5-72B, DeepSeek-V3 | 2 | No | No | Paid |
| `nebius` | Llama-3.1-405B | 2 | No | No | Paid |
| `kilo` | nemotron-3-ultra-free, step-3.7-flash:free | 1 | Yes | No | **Free** |
| `nous` | hermes-4-70b, hermes-4-405b | 1 | No | No | **Free** |
| `aion-labs` | aion-2.0, aion-1.0 | 3 | No | No | Paid |
| `nanobanana` | (custom) | 3 | No | No | Paid |

### Local CLI Providers (via Daemon)

| Provider | CLI Tool | Priority | Auth Method |
|---|---|---|---|
| `claude_cli_local` | Claude Code | 0 | OAuth/PKCE |
| `gemini_cli_local` | Gemini CLI | 0 | OAuth/PKCE |
| `opencode_cli_local` | OpenCode | 0 | Direct CLI |
| `antigravity_cli_local` | Antigravity | 0 | OAuth/PKCE |
| `kiro_cli_local` | Kiro CLI | 0 | OAuth |
| `kilo_cli_local` | Kilo AI | 0 | Device Flow |
| `kimi_cli_local` | Kimi CLI | 0 | OAuth |
| `qwen_cli_local` | Qwen CLI | 0 | Device Flow |
| `zai_cli_local` | Zai CLI | 0 | OAuth |
| `codex_cli_local` | Codex CLI | 0 | Direct |
| `copilot_cli_local` | Copilot CLI | 0 | Direct |
| `grok_cli_local` | Grok CLI | 0 | Direct |
| `qoder_cli_local` | Qoder CLI | 0 | Direct |
| `cline_cli_local` | Cline | 0 | Direct CLI |
| `cursor_cli_local` | Cursor | 0 | Direct |
| `ollama_local_bridge` | Ollama | 0 | Direct |

### Search Providers (8)

| Provider | Free Tier | API Key |
|---|---|---|
| `tavily` | 1000 queries/mo | Required |
| `brave` | 2000 queries/mo | Required |
| `serper` | 1000 queries/mo | Required |
| `exa` | 100k chars/mo | Required |
| `firecrawl` | 500 pages/mo | Required |
| `duckduckgo` | **Unlimited** | **Not required** |
| `searchapi` | 100 on signup | Required |
| `google-pse` | 100/day | Required (API key + Search Engine ID) |

### Provider Features Matrix

| Feature | Providers |
|---|---|
| **Vision** | openai, anthropic, google, xai, openrouter, groq, together, fireworks, nvidia, cloudflare, vertex, mistral, hyperblic, chutes, huggingface, glm, kilo, vercel-ai-gateway, github-models, ovhcloud, llm7, all local CLI |
| **Audio** | google, cloudflare, vertex, deepgram, assemblyai, gemini_cli_local, qwen_cli_local, antigravity_cli_local |
| **Video** | google, vertex, gemini_cli_local, qwen_cli_local, antigravity_cli_local |
| **Transcription** | groq, cloudflare, huggingface, deepgram, assemblyai |
| **Reasoning** | openai, anthropic, google, xai |

---

## Error Handling & Retry Policy

### Error Classes

| Error | HTTP Status | Trigger |
|---|---|---|
| `ProviderError` | 502 | Provider returned error, bad gateway |
| `KeyExhaustedError` | 503 | All API keys exhausted for a provider |
| `CircuitOpenError` | 503 | Circuit breaker open, provider temporarily disabled |
| `AllProvidersExhaustedError` | 503 | All providers and keys exhausted after max retries |
| `CacheError` | N/A | Cache read/write failure |

### Circuit Breaker

```
Threshold:   >= 50% error rate
Samples:     >= 5 requests
Window:      300s (5 min) rolling
Disable TTL: 300s (5 min), 30s for local_http providers
Reset:       Automatic after TTL expires, or manual via admin API
```

### Key Auto-Disable

```
Threshold: 3 failures in 60s window
Disable TTL: 300s (5 min)
RPM limit: Per-provider configurable (default varies)
```

### Queue System

- Non-streaming requests go through BullMQ (Redis-backed)
- Priority levels: `low` (10), `normal` (5), `high` (2), `critical` (1)
- Queue fallback: direct execution if queue unavailable
- Worker timeout: configurable per request (default 30s)
- Stuck job detection: 50 consecutive null responses (~5s)

---

## Web Dashboard

The dashboard is a full-featured vanilla JS SPA with 11 tabs.

| Tab | Features |
|---|---|
| **Overview** | System health, active/total providers, request count, uptime, provider health table |
| **Providers** | Grid view, filter by type (CLI/Cloud), hide disabled, edit priority/weight/models, add custom, seed defaults |
| **Models** | Weight management (1-5 per model), active-only toggle, filter by provider, auto-save on change |
| **API Keys** | Add/remove/toggle keys per provider, view usage and RPM per key, key masking, key metadata |
| **Logs** | Cursor-paginated request logs, filter by provider and status |
| **Playground** | Full AI chat UI with streaming, thinking display, multimodal (image/audio/video upload, paste, voice recording), model search, provider selector, reasoning effort control |
| **Ollama** | Local Ollama playground with daemon status, model selector, daemon logs |
| **Stats** | Usage statistics, token history graph (Chart.js), provider breakdown, daily history, custom date range |
| **Search Providers** | Search provider management with keys |
| **Settings** | Backend URL, API key (with AES-GCM encryption), daemon settings, quick actions, connection test |
| **Local Auth** | OAuth device flow, token harvesting from local CLI configs, MITM proxy status |

### Dashboard Security

- API key can be stored with AES-GCM encryption using a user-provided passphrase
- Passphrase-derived key uses PBKDF2 with 100,000 iterations
- Key can be re-entered each session for maximum security
- Bearer token authentication for all API requests

---

## Local CLI Daemon

The `local-daemon/` directory contains a standalone Node.js server that bridges local CLI tools to OmniRouteAI.

### Features

- **OAuth/PKCE Flow**: Authenticate Claude Code, Gemini CLI, and other local tools
- **Device Flow**: Connect Qwen CLI, Kilo AI via device codes
- **Token Harvesting**: Automatically discovers sessions from `~/.claude`, `~/.cursor`, `~/.config/gh`, and other config files
- **SQLite Import**: Import Cursor sessions directly
- **MITM Proxy Mode**: Optional proxy for capturing tokens from keychain-managed tools
- **Ollama Bridge**: Connect local Ollama instance

### Supported Local Tools

| Tool | Auth | Harvested Config |
|---|---|---|
| Claude Code | OAuth/PKCE | `~/.claude/sessions.json` |
| Gemini CLI | OAuth/PKCE | `~/.gemini/credentials.json` |
| Cursor | Device Flow | `~/.cursor/sessions.db` |
| OpenCode | Direct CLI | `~/.opencode/auth.json` |
| Cline | Direct CLI | `~/.cline/sessions.json` |
| Qwen CLI | Device Flow | `~/.qwen/auth.json` |
| Kimi CLI | OAuth | `~/.kimi/credentials.json` |
| Kiro CLI | OAuth | `~/.kiro/auth.json` |
| Kilo AI | Device Flow | `~/.kilo/config.json` |
| Antigravity | OAuth/PKCE | `~/.antigravity/sessions.json` |
| Ollama | Direct | Local socket |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | — | Admin API key (required) |
| `REDIS_URL` | — | Redis connection string |
| `UPSTASH_REDIS_REST_URL` | — | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | — | Upstash Redis REST token |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Firestore service account JSON path or inline |
| `ROUTER_MAX_ATTEMPTS` | `3` | Max retry attempts |
| `CIRCUIT_BREAKER_THRESHOLD` | `0.5` | Error rate threshold (50%) |
| `CIRCUIT_BREAKER_TTL` | `300` | Circuit breaker disable duration (s) |
| `KEY_FAILURE_THRESHOLD` | `3` | Failures to auto-disable key |
| `KEY_FAILURE_WINDOW` | `60` | Key failure counting window (s) |
| `KEY_DISABLE_TTL` | `300` | Key auto-disable duration (s) |
| `PROVIDER_TIMEOUT_MS` | `60000` | Per-provider request timeout (ms) |
| `CACHE_TTL` | `3600` | Response cache TTL (s) |
| `SEARCH_CACHE_TTL` | `1800` | Search cache TTL (s) |
| `LOCAL_DAEMON_URL` | `http://localhost:5059` | URL for local CLI daemon |
| `LOCAL_DAEMON_TOKEN` | — | Auth token for local daemon |

---

## Deployment

### Railway

```bash
# 1. Push to GitHub
# 2. Connect repository to Railway
# 3. Add environment variables:
#    - API_KEY
#    - REDIS_URL (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
#    - GOOGLE_APPLICATION_CREDENTIALS (Firebase service account JSON)
# 4. Deploy
```

### Render

```bash
# 1. Push to GitHub
# 2. Create new Web Service on Render
# 3. Build command: npm install
# 4. Start command: npm start
# 5. Add environment variables (same as above)
# 6. Deploy
```

### Local Daemon

```bash
cd local-daemon
cp .env.example .env
# Edit .env with your QODER_PERSONAL_ACCESS_TOKEN
npm install
node src/main.js
```

---

## Development

```bash
# Install
npm install

# Start server
npm start

# Dev mode (with --watch)
npm run dev

# Start worker (separate terminal for queue processing)
npm run worker

# Start local daemon
cd local-daemon
npm install
node src/main.js
```

### Firestore Collections Used

| Collection | Purpose |
|---|---|
| `providers` | Provider configurations |
| `api_keys` | API keys per provider |
| `config/classifier_keywords` | Overridable classifier keywords |
| `logs` | Request logs (cursor-paginated) |
| `daily_stats` | Daily aggregated statistics |
| `search_providers` | Search provider configs |
| `search_api_keys` | Search API keys |

### Redis Key Patterns

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `providers:list` | String | 60s | Provider list cache |
| `provider:{name}:keys` | Sorted Set | — | API keys with usage scores |
| `provider:{name}:success` | Counter | 300s | Rolling success count |
| `provider:{name}:fail` | Counter | 300s | Rolling failure count |
| `provider:disabled:{name}` | Flag | 300s | Circuit breaker |
| `key:disabled:{p}:{k}` | Flag | 300s-1yr | Key disabled flag |
| `key:fail:{p}:{k}` | Counter | 60s | Key failure count |
| `key:metadata:{p}:{k}` | JSON | 1yr | Key metadata |
| `rpm:{p}:{k}` | Counter | 60s | RPM tracking |
| `cache:{hash}` | JSON | 3600s | Response cache |
| `stats:{date}:*` | Counter | 86400s | Daily stats |

---

## Roadmap

### v2.9 (Current)

- [x] Model Weighting System (1-5 scale, weight sentinels)
- [x] Active-only model filter in dashboard
- [x] Remove deprecated models from provider edit modal
- [x] Provider:Model format routing (split on first colon)
- [x] Models management tab in dashboard
- [x] OAuth device flow for CLI tools
- [x] Token harvesting from local config files
- [x] MITM proxy mode for keychain-managed tools

### v2.8

- [x] Audio Transcription (Groq, OpenAI, Cloudflare, Deepgram, AssemblyAI)
- [x] Improved `auto` routing for cloud providers
- [x] `provider` metadata in API responses
- [x] OpenAI Responses API
- [x] BullMQ job queue with priorities
- [x] OpenClaw integration (`/v1/tools`)
- [x] Search provider circuit breakers

### v2.7

- [x] 50+ LLM Provider support
- [x] 8 Web Search providers
- [x] Priority-tiered weighted routing
- [x] Automatic key rotation (atomic Lua scripts)
- [x] Multimodal support (vision, audio, video)
- [x] Local CLI bridge (16+ tools)
- [x] Custom providers
- [x] Semantic caching (Redis)
- [x] Real-time statistics
- [x] Web dashboard
- [x] API key management
- [x] Automatic failover
- [x] Streaming responses
- [x] Thinking/reasoning display
- [x] Tool calling

---

## License

MIT License — See [LICENSE](./LICENSE) for details.

---

## Acknowledgments

- **AI Providers**: OpenAI, Anthropic, Google, Groq, DeepSeek, xAI, Moonshot, GLM, NVIDIA, Mistral, Cohere, together.ai, Fireworks, SambaNova, Cerebras, Perplexity, Alibaba Cloud, Xiaomi, and every provider
- **Search Providers**: Tavily, Brave, Exa, Serper, Firecrawl, DuckDuckGo, SearchAPI, Google
- **Infrastructure**: Fastify, BullMQ, Redis, Firebase, Cloudflare, Upstash, Railway
- **Local Tools**: Claude Code, Gemini CLI, OpenCode, Cline, Qwen CLI, Kimi CLI, Kiro CLI, Antigravity, Kilo AI, Codex CLI, Copilot CLI, Grok CLI, Qoder CLI, Cursor, Ollama
- **Community**: All contributors and users

---

*Built with ❤️ for the AI Community. Let's Route the Future.*
