# 🛰️ OmniRouteAI — The Ultimate Multi-Provider AI Router

[![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.io/)
[![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Firebase](https://img.shields.io/badge/firebase-%23039BE5.svg?style=for-the-badge&logo=firebase)](https://firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg?style=for-the-badge)](LICENSE)

**OmniRouteAI** (v2.5) is a high-availability, production-grade AI inference engine and router. It unifies **46+ AI providers** and thousands of models—from global cloud giants to your private CLI-based agents—into a single, resilient API.

## 🌟 Why OmniRouteAI?

OmniRouteAI is built for developers who demand **zero downtime**, **cost-efficiency**, and **absolute hardware freedom**. By abstracting 40+ different APIs, it allows you to focus on building features while the router handles failovers, rate limits, and intelligent caching.

---

## ⚡ Core Features

*   **🛡️ Enterprise-Grade Failover**: Instantly switches to the next available healthy provider/key if a failure occurs (500s, 429s, or Timeouts).
*   **🌉 Unified Auth Hub (Daemon v2)**: Standardized authentication for 14+ CLI tools via **OAuth2/PKCE**, **Device Flow (GitHub/AWS)**, and **SQLite Credential Harvesting (Cursor)**.
*   **🔑 Dynamic Key Rotation**: Cycle through an unlimited pool of API keys to bypass provider rate limits and maximize throughput.
*   **💾 Multi-Layer Semantic Caching**: Shared **Redis** caching for identical prompts, reducing latency to <30ms for repeated queries.
*   **📊 Real-time Observability**: A sleek, real-time dashboard with auditing logs, token economy analytics, and provider health grids.
*   **🧪 No Vendor Lock-in**: Swap between GPT-4o, Claude 3.7, Gemini 3.0, or DeepSeek R1 globally via the dashboard—no code changes required.

---

## 🏛️ Comprehensive Ecosystem (46+ Providers)

OmniRouteAI supports an exhaustive list of providers across three strategic layers:

### 1. Global Cloud Agents (API-Direct)
Used for standard high-concurrency production tasks:
- **Major**: OpenAI (o3/o1), Anthropic (Claude 3.7/4.5), Google Gemini (3.0/2.5), xAI (Grok-4), DeepSeek (V3/R1).
- **Specialized**: **GLM (Zhipu AI)**, **Vertex AI**, Moonshot (Kimi), Minimax, Mistral, Perplexity.
- **Hardware-Accelerated**: **SambaNova**, **Cerebras**, Groq, NVIDIA NIM.
- **Niche/Inference**: SiliconFlow, Hyperbolic, Nebius, Fireworks, Chutes, Inception Labs, Xiaomi (MiMo).

### 2. Multi-Tool Private Bridge (The Daemon)
Access these private agents on your local hardware via the **OmniRouteAI-Local Daemon**:
- **OAuth/PKCE**: Claude Code, Gemini CLI, Antigravity, iFlow, Cline.
- **Device Flow**: GitHub Copilot, Qwen Code, AWS Kiro, Kilo AI, Kimi Coding.
- **Harvested/SQLite**: **Cursor IDE (v0.48+)**, OpenCode, Codex, Zai CLI.
- **Local Engines**: Ollama (Direct Local) and Ollama Bridge.

---

## 🚀 Deployment Guide

### 1. Cloud Backend (Railway / Vercel)
OmniRouteAI is optimized for low-latency cloud deployments:
1.  **Repo Setup**: Connect this repository to **Railway**.
2.  **Database**: 
    - **Firestore**: Set `GOOGLE_APPLICATION_CREDENTIALS` to your Service Account JSON.
    - **Redis (Aiven)**: Use **Aiven for Redis** for high performance. 
      > **Pro Tip**: If using Aiven, append `?family=0` to your connection string in `REDIS_URL` to ensure IPv4 compatibility on cloud runners.
3.  **Services**:
    - **API Node**: Defaults to `npm start`.
    - **Inference Worker**: Command: `npm run worker`.

### 2. Local Bridge (The Daemon)
To use local agents (Claude/Antigravity) on a cloud backend:
1.  Navigate to `local-daemon/`.
2.  Build: `npm run build:win` to generate `OmniRouteAI-Local.exe`.
3.  **Authentication**: Run the `.exe`, navigate to the dashboard's "Local Auth" tab, and click **Login** for your desired tool. The daemon handles the OAuth/Device handshake automatically.
4.  **Security**: Copy the daemon's token to the cloud backend's `.env` as `LOCAL_DAEMON_TOKEN`.

---

## 🕹️ Dashboard Breakdown

- **📊 Overview**: Live heartbeat monitoring, provider health indicators, and RPM/Token usage cards.
- **🔌 Provider Management**: Enable/Disable providers, update priority, and set default models.
- **🔐 Multi-Tool Auth**: One-click login for all 14+ CLI agents using the new Local Daemon v2.
- **📝 Audit Logs**: Inspect raw prompts, JSON responses, exact latencies, and token counts.
- **🎮 Playground**: A sandbox to test 40+ models side-by-side with model overrides.

---

## 📑 Roadmap
- [x] **Consolidated OAuth Hub**: Unified auth for 14 local agents.
- [x] **Cloud Parity Audit**: 100% consistency with 9router provider standards.
- [ ] **Semantic Guardrails**: Real-time prompt validation and PII masking.
- [ ] **Usage-based Billing**: Stripe integration for commercial routing.

---

## 📜 License & Community

Licensed under the **MIT License**. We aim to build the most flexible AI routing gateway—free from vendor lock-in and corporate proprietary barriers.

---
*Built with ❤️ for the AI Community. Let's Route the Future.*
