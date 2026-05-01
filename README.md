# 🛰️ OmniRouteAI — The Ultimate AI Routing Gateway

<p align="center">
  <img src="https://img.shields.io/badge/Version-2.8-brightgreen?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-teal?style=for-the-badge" alt="License">
</p>

**OmniRouteAI** (v2.8) is a production-grade AI inference engine and router that unifies **50+ AI providers** and **8 web search providers** into a single, resilient API. It provides intelligent failover, multimodal support (including audio transcription), web search, semantic caching, and zero vendor lock-in.

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/muzahirabbas/OmniRouteAI.git
cd OmniRouteAI

# Install dependencies
npm install

# Start the server
npm start

# Test the API
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello, world!"}'
```

---

## ✨ Key Features

### 🌀 Intelligent Routing & Failover
- **Priority-Based Routing**: Requests are routed based on provider priority (1 = highest)
- **Weighted Random**: When priorities are equal, weighted random selection distributes load
- **Automatic Failover**: If a provider fails (500, 429, timeout), instantly switches to the next healthy provider
- **Key Rotation**: Automatically rotates through multiple API keys for the same provider to avoid rate limits

### 🔍 Unified Web Search (NEW!)
- **8 Search Providers**: Tavily, Brave, Serper, Exa, Firecrawl, DuckDuckGo, SearchAPI, Google PSE
- **Priority-Based Routing**: Same intelligent routing as LLM providers
- **Key Rotation**: Multiple API keys per search provider with automatic rotation
- **No-Key Required**: DuckDuckGo works without any API keys!
- **OpenClaw Ready**: Use `/v1/tools` endpoint to get `web_search` tool definition for AI agents

```bash
# Search the web
curl -X POST https://your-backend.com/v1/search \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the capital of France?", "max_results": 5}'

# Force specific search provider
curl -X POST https://your-backend.com/tavily/v1/search \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "Latest AI news"}'
```

### 🗝️ API Key Management
- **Multi-Key Support**: Add multiple API keys per provider
- **Automatic Key Rotation**: The router automatically uses the least-used key
- **Key Health Tracking**: Tracks failures per key and auto-disables problematic keys
- **Key Failure Threshold**: Configurable thresholds for automatic key disable

### 🧠 Thinking & Reasoning Support
- **Thinking Content**: Display reasoning from Claude, Gemini, Grok, and other providers
- **Streaming Reasoning**: See thinking in real-time as tokens are generated
- **Toggle View**: Show/hide thinking content in playground and responses
- **OpenRouter Reasoning**: Full support for OpenRouter's reasoning models

### 🧰 Tool Calling
- **OpenAI Tool Calling**: Pass `tools` and `tool_choice` in requests
- **Auto-Failover**: If tool execution fails, automatically retry with different provider
- **OpenClaw Integration**: Works seamlessly with OpenClaw AI agent

### 🎙️ Audio Transcription (NEW!)
- **Universal Transcription**: Support for `/v1/audio/transcriptions` across multiple providers.
- **OpenAI-Compatible Bridge**: Unified support for **Groq** (Whisper-large-v3), **OpenAI** (Whisper-1), and **Cloudflare** (Whisper).
- **Auto-Routing**: Request `whisper-1` and the system automatically finds the best available transcription provider.

### 📦 Additional Features
| Feature | Description |
|---------|-------------|
| **50+ LLM Providers** | OpenAI, Anthropic, Gemini, Groq, DeepSeek, Ollama, and many more |
| **8 Search Providers** | Tavily, Brave, Serper, Exa, Firecrawl, DuckDuckGo, SearchAPI, Google PSE |
| **Multimodal Support** | Vision, Audio, and Video input support |
| **Local CLI Bridge** | Use Claude CLI, Gemini CLI, OpenCode, Kimi, Qwen, Kiro, and 10+ local AI tools |
| **Custom Providers** | Add your own OpenAI/Anthropic-compatible endpoints |
| **Semantic Caching** | Redis-powered prompt caching to reduce costs |
| **Real-time Stats** | Request tracking, token usage, and cost estimation |
| **Dashboard** | Full-featured web UI for management and testing |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    OmniRouteAI Architecture                         │
└─────────────────────────────────────────────────────────────────────────────────────┘

                             ┌─────────────────────────────┐
                             │      Client Requests       │
                             │  (cURL, Python, JS, n8n)   │
                             └─────────────┬─────────────┘
                                           │ HTTPS
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   BACKEND SERVER                                      │
│                              (Fastify on Railway/Render)                              │
│  ┌─────────────────────────────────────────────────────────────────────────────┐      │
│  │                          ROUTER SERVICE                                      │      │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐   │      │
│  │  │ Classifier  │─▶│  Provider    │─▶│  Key        │─▶│  Request    │   │      │
│  │  │ (Task Type) │  │  Selector    │  │  Rotator    │  │  Executor   │   │      │
│  │  │             │  │  (Priority)  │  │  (Least-Used│  │             │   │      │
│  │  └─────────────┘  └──────────────┘  └─────────────┘  └──────────────┘   │      │
│  └─────────────────────────────────────────────────────────────────────────────┘      │
│                                          │                                            │
│                    ┌─────────────────────┼─────────────────────┐                      │
│                    ▼                     ▼                     ▼                      │
│           ┌──────────────┐      ┌──────────────┐      ┌──────────────┐              │
│           │   Redis      │      │  Firestore    │      │    Local     │              │
│           │              │      │              │      │   Daemon     │              │
│           │  • Cache     │      │  • Providers │      │              │              │
│           │  • Queue     │      │  • API Keys  │      │  • Claude    │              │
│           │  • Key Stats │      │  • Search    │      │  • Gemini    │              │
│           │  • RPM      │      │  • Logs      │      │  • OpenCode  │              │
│           │  • Search   │      │  • Stats     │      │  • Kiro      │              │
│           └──────────────┘      └──────────────┘      │  • Qwen      │              │
│                                                       │  • Ollama    │              │
│                                                       │  • Kimi      │              │
│                                                       └──────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────────┘
                   │                      │                      │
                   ▼                      ▼                      ▼
         ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
         │  Cloud LLM      │   │  Web Search     │   │  Local CLI      │
         │  Providers      │   │  Providers      │   │  Tools          │
         │                 │   │                 │   │                 │
         │  • OpenAI       │   │  • Tavily       │   │  • Claude Code  │
         │  • Anthropic    │   │  • Brave        │   │  • Gemini CLI   │
         │  • Gemini       │   │  • Serper       │   │  • OpenCode     │
         │  • Groq         │   │  • Exa          │   │  • Cline        │
         │  • DeepSeek     │   │  • DuckDuckGo   │   │  • Qwen CLI     │
         │  • Ollama Cloud │   │  • Firecrawl    │   │  • Kimi CLI     │
         └─────────────────┘   └─────────────────┘   └─────────────────┘
```

---

## 📚 API Endpoints

### LLM Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/v1/chat/completions` | Send chat request (main API) |
| `POST` | `/v1/responses` | OpenAI Responses API |
| `GET` | `/v1/models` | List available models |
| `GET` | `/:provider/v1/models` | List models for specific provider |
| `POST` | `/:provider/v1/chat/completions` | Force specific provider |
| `POST` | `/v1/audio/transcriptions` | Global transcription (auto-routes) |
| `POST` | `/:provider/v1/audio/transcriptions` | Force transcription provider |

### Search Endpoints (NEW!)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/search` | Global search (auto-routes) |
| `POST` | `/:provider/v1/search` | Force specific search provider |
| `GET` | `/v1/search/models` | List available search providers |
| `GET` | `/v1/tools` | Get tool definitions (for OpenClaw) |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/providers` | List all LLM providers |
| `POST` | `/api/admin/seed-providers` | Seed default providers |
| `GET` | `/api/admin/search-providers` | List all search providers |
| `POST` | `/api/admin/search-providers/seed` | Seed default search providers |
| `POST` | `/api/admin/providers/:name/toggle` | Enable/disable provider |
| `GET` | `/api/admin/keys/:provider` | List API keys |
| `POST` | `/api/admin/keys/:provider` | Add API key |
| `GET` | `/api/admin/search-keys/:provider` | List search API keys |
| `POST` | `/api/admin/search-keys/:provider` | Add search API key |
| `GET` | `/api/admin/stats` | Get usage statistics |
| `GET` | `/api/admin/logs` | Get request logs |

### Local Daemon Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/claude` | Claude Code bridge |
| `GET` | `/gemini` | Gemini CLI bridge |
| `GET` | `/opencode` | OpenCode bridge |
| `GET` | `/qwen` | Qwen CLI bridge |
| `GET` | `/kimi` | Kimi CLI bridge |
| `GET` | `/kiro` | Kiro CLI bridge |
| `GET` | `/antigravity` | Antigravity bridge |
| `GET` | `/ollama` | Ollama local bridge |

---

## 🎯 How Routing Works

### Request Flow

```
1. Client sends prompt → OmniRouteAI
          ↓
2. Classify prompt (coding, vision, general)
          ↓
3. Filter providers by capability (vision → providers with vision)
          ↓
4. Sort by priority (ascending) → weight (descending)
          ↓
5. Select provider + least-used API key
          ↓
6. Send request to provider
          ↓
7. Success? → Return response
   Failure? → Retry with next key/provider
```

---

## 💻 Usage Examples

### 1. Basic Chat

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Write a Python function to reverse a string"}'
```

### 2. Web Search

```bash
# Global search (auto-routes to best provider)
curl -X POST https://your-backend.com/v1/search \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "Latest AI news", "max_results": 5}'

# Force specific search provider
curl -X POST https://your-backend.com/tavily/v1/search \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?"}'
```

### 3. Tool Calling (for AI Agents)

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the weather in Paris?",
    "tools": [
      {
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
      }
    ]
  }'
```

### 4. Streaming Response

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Count from 1 to 5", "stream": true}'
```

### 5. Multimodal (Image)

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is in this image?",
    "images": ["https://example.com/image.jpg"]
  }'
```

### 6. Force Specific Provider

```bash
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello", "provider": "groq"}'
```

---

## 🌐 Supported Providers

### LLM Providers (50+)

| Provider | Models | Free Tier |
|----------|--------|-----------|
| `openai` | gpt-4o, o1, o1-mini | Paid |
| `anthropic` | claude-3-7-sonnet, claude-3-5-haiku | $5 credit |
| `google` / `gemini` | gemini-2.5-pro, gemini-1.5-flash | 15 RPM |
| `groq` | llama-3.3-70b, mixtral-8x7b | 30 RPM |
| `deepseek` | deepseek-chat, deepseek-coder | 200K tokens/day |
| `openrouter` | gpt-4o, claude-3-opus | Paid |
| `together` | llama-3.3-70b-instruct | Paid |
| `xai` | grok-2, grok-2-vision | Paid |
| `moonshot` | kimi-k2.5 | Paid |
| `cloudflare` | @cf/meta/llama-3.1-8b-instruct | 10K requests/day |
| `ollama-cloud` | llama3.2:1b | Free |
| `deepseek` | deepseek-chat | Free |

### Search Providers (NEW!)

| Provider | Free Tier | API Key Required |
|----------|-----------|------------------|
| `tavily` | 1000 queries/month | Yes |
| `brave` | 2000 queries/month | Yes |
| `serper` | 1000 queries/month | Yes |
| `exa` | 100k characters/month | Yes |
| `firecrawl` | 500 pages/month | Yes |
| `duckduckgo` | Unlimited | No! |
| `searchapi` | 100 on signup | Yes |
| `google-pse` | 100/day | Yes (needs API key + Search Engine ID) |

**Get Search API Keys:**
- Tavily: https://tavily.com/
- Brave: https://brave.com/search/api/
- Serper: https://serper.dev/
- Exa: https://exa.ai/
- Firecrawl: https://firecrawl.dev/
- SearchAPI: https://searchapi.io/
- Google PSE: https://console.cloud.google.com/apis/credentials + https://programmablesearchengine.google.com/

### Local CLI Providers (via Daemon)

| Provider | CLI Tool | Auth Method |
|----------|----------|-------------|
| `claude_cli_local` | Claude Code | OAuth/PKCE |
| `gemini_cli_local` | Gemini CLI | OAuth/PKCE |
| `antigravity_cli_local` | Antigravity | OAuth/PKCE |
| `qwen_cli_local` | Qwen CLI | Device Flow |
| `kimi_cli_local` | Kimi CLI | OAuth |
| `kiro_cli_local` | Kiro CLI | OAuth |
| `opencode_cli_local` | OpenCode | Direct CLI |
| `zai_cli_local` | Zai CLI | OAuth |
| `kilo_cli_local` | Kilo AI | Device Flow |
| `cline_cli_local` | Cline | Direct CLI |
| `ollama_local_bridge` | Ollama | Direct |

---

## 🖥️ Dashboard

The OmniRouteAI dashboard provides:

- **Overview**: System health and quick stats
- **Providers**: View, edit, delete, add LLM providers
- **API Keys**: Manage API keys for each LLM provider
- **Search Providers** (NEW!): Manage search providers and API keys
- **Playground**: Test AI with text, images, audio, video
- **Stats**: View usage statistics and daily history
- **Logs**: Inspect request logs
- **Settings**: Configure API URL, encryption, and more

---

## 🔧 Configuration

### Search Provider Setup

```bash
# 1. Go to Dashboard → Search Providers
# 2. Click "Seed Defaults" to add all search providers
# 3. Add API keys for each provider

# For Google PSE, you'll need:
# - API Key: https://console.cloud.google.com/apis/credentials
# - Search Engine ID: https://programmablesearchengine.google.com/controlpanel/create
```

### Key Rotation Configuration

```env
# Key failure threshold (default: 3)
KEY_FAILURE_THRESHOLD=3

# Time window for tracking failures in seconds (default: 60)
KEY_FAILURE_WINDOW=60

# How long to keep a key disabled in seconds (default: 300)
KEY_DISABLE_TTL=300
```

---

## 📊 Request/Response Format

### LLM Request

```json
{
  "prompt": "Your message here",
  "model": "optional-model-name",
  "provider": "optional-provider-override",
  "stream": false,
  "system_prompt": "optional-system-instructions",
  "tools": [],
  "tool_choice": "auto"
}
```

### LLM Response

```json
{
  "output": "AI response here...",
  "thinking": "Reasoning content...",
  "provider": "groq",
  "model": "llama-3.3-70b-versatile",
  "tokens": {
    "input": 10,
    "output": 25,
    "reasoning": 5
  },
  "request_id": "uuid-here",
  "cached": false
}
```

### Search Request

```json
{
  "query": "Your search query",
  "max_results": 5
}
```

### Search Response

```json
{
  "id": "search_...",
  "object": "search_result",
  "query": "Your search query",
  "provider": "tavily",
  "results": [
    {
      "title": "Result Title",
      "url": "https://...",
      "snippet": "Result description..."
    }
  ],
  "answer": "Direct answer if available",
  "tokens": {
    "input": 10,
    "output": 500
  }
}
```

---

## 🛠️ Development

### Local Development

```bash
# Install dependencies
npm install

# Start server
npm start

# Start worker (separate terminal)
npm run worker

# Start local daemon (for CLI tools)
cd local-daemon
npm install
node src/main.js
```

### Testing

```bash
# Test LLM providers
node test/system.js

# Test search providers
BACKEND_URL=https://your-backend.com API_KEY=your-key node test/search.js
```

---

## 🛤️ Roadmap

### Completed (v2.8)

- [x] 🎙️ Audio Transcription Support (Groq, OpenAI, Cloudflare)
- [x] 🛰️ Improved 'auto' Routing for Cloud Providers
- [x] 📊 Added 'provider' Metadata to API Responses
- [x] 50+ LLM Provider Support
- [x] 8 Web Search Providers
- [x] Intelligent Priority-Based Routing
- [x] Automatic Key Rotation
- [x] Multimodal Support (Vision, Audio, Video)
- [x] Local CLI Bridge (Claude, Gemini, OpenCode, Kiro, Qwen, Kimi, etc.)
- [x] Custom Providers (OpenAI/Anthropic-compatible)
- [x] Redis Semantic Caching
- [x] Real-time Statistics
- [x] Web Dashboard
- [x] API Key Management
- [x] Automatic Failover
- [x] Streaming Responses
- [x] Thinking/Reasoning Display
- [x] Tool Calling
- [x] OpenAI Responses API
- [x] OpenClaw Integration (via /v1/tools)

---

## 📜 License

MIT License — See [LICENSE](./LICENSE) for details.

---

## 🙏 Acknowledgments

- **AI Providers**: OpenAI, Anthropic, Google, Groq, DeepSeek, xAI, Moonshot, GLM, and all other providers
- **Search Providers**: Tavily, Brave, Exa, Serper, Firecrawl, DuckDuckGo
- **Infrastructure**: Fastify, BullMQ, Redis, Firebase, Cloudflare
- **Local Tools**: Claude Code, Gemini CLI, OpenCode, Cline, Qwen, Kimi, Kiro, and all CLI tool developers
- **Community**: All contributors and users who help improve OmniRouteAI

---

*Built with ❤️ for the AI Community. Let's Route the Future.*
