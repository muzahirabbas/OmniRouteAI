# 🛰️ OmniRouteAI — The Ultimate Multimodal AI Router

[![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.io/)
[![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Firebase](https://img.shields.io/badge/firebase-%23039BE5.svg?style=for-the-badge&logo=firebase)](https://firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg?style=for-the-badge)](LICENSE)

**OmniRouteAI** (v2.6 Multimodal) is a high-availability, production-grade AI inference engine and router. It unifies **46+ AI providers** and thousands of models—including native support for **Vision, Audio, and Video**—into a single, resilient API.

## 🌟 Why OmniRouteAI?

OmniRouteAI is built for developers who demand **zero downtime**, **cost-efficiency**, and **absolute hardware freedom**. By abstracting 40+ different APIs and multiple data modalities, it allows you to build rich, multimodal applications while the router handles failovers, media-aware routing, and intelligent caching.

---

## ⚡ Core Features

*   **🥘 Native Multimodal Support**: Seamlessly send **Images**, **Audio** (.mp3/.wav), and **Video** (.mp4) to capable models.
*   **🎯 Capability-Aware Routing**: The engine detects required media types and automatically filters out text-only models to prevent routing errors.
*   **🛡️ Enterprise-Grade Failover**: Instantly switches to the next healthy provider/key if a failure occurs (500s, 429s, or Timeouts).
*   **🌉 Unified Auth Hub (Daemon v2)**: Standardized auth for 14+ CLI tools via **OAuth2/PKCE**, **Device Flow**, and **SQLite Harvesting (Cursor)**.
*   **💾 Multi-Layer Semantic Caching**: Shared **Redis** caching for identical prompts, reducing latency for repeated queries.
*   **📊 Media Token Heuristics**: Advanced size-based token estimation for Audio/Video to ensure accurate quota tracking before provider callbacks.

---

## 🏛️ Comprehensive Ecosystem (46+ Providers)

OmniRouteAI supports an exhaustive list of providers across three strategic layers:

### 1. Global Cloud Agents (API-Direct)
Used for standard high-concurrency production tasks:
- **Multimodal Icons**: OpenAI (GPT-4o), Anthropic (Claude 3.5), Google Gemini (1.5 Pro/Flash), Vertex AI.
- **Major**: OpenAI (o3/o1), Anthropic (Claude 3.7/4.5), Google Gemini (2.5), xAI (Grok-2), DeepSeek (V3/R1).
- **Specialized**: **GLM (Zhipu AI)**, **Moonshot (Kimi)**, Mistral, Perplexity.
- **Hardware-Accelerated**: **SambaNova**, **Cerebras**, Groq, NVIDIA NIM.

### 2. Multi-Tool Private Bridge (The Daemon)
Access these private agents on your local hardware via the **OmniRouteAI-Local Daemon**:
- **OAuth/PKCE**: Claude Code, Gemini CLI, Antigravity, iFlow, Cline.
- **Device Flow**: GitHub Copilot, Qwen Code, AWS Kiro, Kilo AI, Kimi Coding.
- **Harvested/SQLite**: **Cursor IDE (v0.48+)**, OpenCode, Codex, Zai CLI.

---

## 🕹️ Dashboard & Multimodal Playground

The OmniRouteAI Dashboard (v2.6) features a built-in sandbox for multimodal testing:

- **🖼️ Media Upload & Paste**: Upload images, audio, or video, or **Directly Paste** screenshots from your clipboard (Ctrl+V).
- **🧠 Smart Media Renderer**: AI responses are no longer just text. The Playground automatically detects and renders:
    - **Images**: Markdown image links become viewable images.
    - **Audio Players**: Response links are converted into interactive HTML5 audio players.
    - **Video Players**: Embedded video players for generated or linked visual content.
- **📝 Audit Logs**: Inspect raw multimodal payloads, JSON responses, exact latencies, and token counts.
- **🔌 Provider Management**: Enable/Disable providers and update priority tags (Vision/Audio/Video).

---

## 🚀 Deployment Guide

### 1. Cloud Backend (Railway / Vercel)
OmniRouteAI is optimized for low-latency cloud deployments:
1.  **Repo Setup**: Connect this repository to **Railway**.
2.  **Database**: 
    - **Firestore**: Set `GOOGLE_APPLICATION_CREDENTIALS` to your Service Account JSON.
    - **Redis (Aiven)**: Use **Aiven for Redis** for high performance.
3.  **Services**:
    - **API Node**: Defaults to `npm start`.
    - **Inference Worker**: Command: `npm run worker`.

### 2. Local Bridge (The Daemon)
To use local agents (Claude/Antigravity) on a cloud backend:
1.  Navigate to `local-daemon/`.
2.  Build: `npm run build:win` for `OmniRouteAI-Local.exe`.
3.  **Authentication**: Run the executable and use the "Local Auth" tab in the dashboard.
4.  **Security**: Copy the daemon's token to your cloud env as `LOCAL_DAEMON_TOKEN`.

---

## 📑 Roadmap
- [x] **Milestone 1**: Consolidated OAuth Hub for 14 local agents.
- [x] **Milestone 2**: Full Multimodal Support (Vision/Audio/Video Input & Rendering).
- [ ] **Milestone 3**: Semantic Guardrails & Real-time PII masking.
- [ ] **Milestone 4**: Usage-based Billing & Stripe integration.

---

## 📜 License & Community

Licensed under the **MIT License**. We aim to build the most flexible AI routing gateway—free from vendor lock-in.

---
*Built with ❤️ for the AI Community. Let's Route the Future.*
