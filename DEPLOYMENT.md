# 🚀 OmniRouteAI — Complete Deployment Guide

This guide covers deploying the entire OmniRouteAI system **for free** using free-tier services.

---

## 📋 Prerequisites

| Requirement | Purpose | Cost |
|-------------|---------|------|
| [Node.js 20+](https://nodejs.org/) | Backend runtime | Free |
| [Redis](https://redis.io/) or [Upstash](https://upstash.com/) | Cache, queue, state | Free tier |
| [Firebase](https://firebase.google.com/) | Firestore database | Free (Spark plan) |
| [Cloudflare Pages](https://pages.cloudflare.com/) | Frontend hosting | Free |
| Backend host (Railway / Render / VPS) | Backend server | Free tier available |

---

## 1️⃣ FIREBASE SETUP

### 1.1 Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Create a project"**
3. Name it (e.g., `omniroute-ai`)
4. Disable Google Analytics (optional)
5. Click **"Create project"**

### 1.2 Enable Firestore

1. In your project, go to **Build → Firestore Database**
2. Click **"Create database"**
3. Select **"Start in production mode"**
4. Choose your preferred region
5. Click **"Enable"**

### 1.3 Generate Service Account Key

1. Go to **Project Settings → Service Accounts**
2. Click **"Generate new private key"**
3. Save the JSON file as `serviceAccountKey.json`
4. Place it in the root of your `OmniRouteAI/` project directory

### 1.4 Create Firestore Indexes (Optional)

The `logs` collection queries use `timestamp` + `provider` + `status` filters. If you see index errors, Firebase will give you a link to create the required composite index.

---

## 2️⃣ REDIS SETUP

### Option A: Local Redis (Development)

```bash
# Windows (WSL or Docker)
docker run -d --name redis -p 6379:6379 redis:alpine

# Linux/Mac
sudo apt install redis-server   # or brew install redis
redis-server
```

### Option B: Upstash (Production — Free Tier)

1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new **Redis database**
3. Select **Free tier** (10,000 commands/day)
4. Copy the **Redis URL** (starts with `rediss://`)

> ⚠️ For BullMQ with Upstash, you need the `ioredis`-compatible URL (the TLS one).

---

## 3️⃣ BACKEND DEPLOYMENT

### 3.1 Environment Variables

Create a `.env` file in the project root:

```env
# Server
NODE_ENV=production
PORT=3000

# Auth — set YOUR custom API key for the router
API_KEY=your-secure-api-key-here

# Redis
REDIS_URL=redis://localhost:6379
# For Upstash: REDIS_URL=rediss://default:XXXX@XXXX.upstash.io:6379

# Firebase
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json

# Cloudflare Workers AI (optional)
CF_ACCOUNT_ID=your-cloudflare-account-id

# Webhook (optional)
WEBHOOK_URL=

# Timeouts and limits
PROVIDER_TIMEOUT_MS=20000
CIRCUIT_BREAKER_THRESHOLD=0.5
CIRCUIT_BREAKER_TTL=300
KEY_FAILURE_THRESHOLD=3
KEY_FAILURE_WINDOW=60
KEY_DISABLE_TTL=300
CACHE_TTL=3600
```

### 3.2 Install & Start Locally

```bash
cd OmniRouteAI
npm install

# Terminal 1: Start server
npm start

# Terminal 2: Start BullMQ worker
npm run worker
```

Verify:
```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"..."}
```

### 3.3 Deploy to Railway (The "Fast & Free" Way) 🚀

Railway is the best hosting choice because it automatically configures SSL, domains, and health checks for you.

#### **Step 1: Prep your GitHub Repo**
Make sure your project is committed and pushed to a GitHub repository.

#### **Step 2: Start the Project in Railway**
1. Log in to [Railway](https://railway.app/).
2. Click **"+ New Project"** and select **"Deploy from GitHub repo"**.
3. Choose your `OmniRouteAI` repository.
4. Click **"Deploy Now"**. (It will initially fail because you haven't added variables yet — this is normal!).

#### **Step 3: Add Environment Variables (IMPORTANT)**
1. Go to your new service and click the **"Variables"** tab.
2. Click **"Bulk Import"** and paste the content of your local `.env`.
3. **CRITICAL (Firebase)**: Railway doesn't let you easily upload files. Instead:
   - Copy the **entire contents** of your `serviceAccountKey.json`.
   - In Railway, set the variable `GOOGLE_APPLICATION_CREDENTIALS` to that **raw JSON text**.
   - My code is already updated to detect if it's a file path or a JSON string!
4. **Networking**: 
   - Add a variable `PORT=3000`.
   - Go to **Settings** → **Networking** and click **"Generate Domain"**. This is your public AI router URL!

#### **Step 4: Create the Worker Service**
OmniRouteAI needs a separate process to handle the queue.
1. In the same Railway project, click **"+ New"** → **"GitHub Repo"** → Select same repo again.
2. Go to **Settings** → **Deploy** → **Start Command**.
3. Set the start command to: `npm run worker`.
4. Go to **Variables** → **Reference variables**:
   - You don't need a public URL for the worker. 
   - Just point the variables to your main service so they stay in sync.

#### **Step 5: Verify Deployment**
Open your public Railway URL (e.g., `https://something.up.railway.app/health`). If it returns `{"status":"healthy"}`, you are officially live!

### 3.4 Deploy to Render (Alternative)

1. Go to [Render](https://render.com/) → New Web Service
2. Connect GitHub repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables
6. For the worker: create a separate **Background Worker** service with start command: `npm run worker`

### 3.5 Deploy to VPS (Full Control)

```bash
# On your VPS
git clone <your-repo> && cd OmniRouteAI
npm install

# Install PM2 for process management
npm install -g pm2

# Start server
pm2 start src/index.js --name omniroute-server

# Start worker
pm2 start src/workers/jobWorker.js --name omniroute-worker

# Auto-restart on reboot
pm2 startup
pm2 save
```

---

## 4️⃣ FRONTEND DEPLOYMENT (Cloudflare Pages)

### 4.1 Push Frontend to GitHub

The `frontend/` directory is a static site. You can either:

**A) Keep it in the same repo** (recommended):
- Cloudflare Pages will deploy from the `frontend/` directory

**B) Create a separate repo**:
```bash
cd frontend
git init
git add .
git commit -m "OmniRouteAI Dashboard"
git branch -M main
git remote add origin <your-frontend-repo>
git push -u origin main
```

### 4.2 Deploy to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**
2. Click **"Create"** → **"Pages"** → **"Connect to Git"**
3. Select your repository
4. Configure build settings:
   - **Build output directory**: `frontend` (if same repo) or `/` (if separate)
   - **Build command**: *leave empty* (static site, no build needed)
5. Click **"Save and Deploy"**

### 4.3 Configure the Dashboard

1. Open your deployed dashboard URL
2. Go to **Settings** page
3. Set **Backend API URL** to your backend URL (e.g., `https://omniroute.up.railway.app`)
4. Set **Router API Key** to the `API_KEY` from your `.env`
5. Click **Save Settings**
6. Click **Test Connection** — should show "healthy"

---

## 5️⃣ INITIAL SETUP (First Run)

After deploying both backend and frontend:

### 5.1 Seed Default Providers

```bash
# Via API
curl -X POST https://your-backend.com/api/admin/seed-providers \
  -H "Authorization: Bearer YOUR_API_KEY"

# Or via Dashboard → Settings → "Seed Default Providers"
```

### 5.2 Add API Keys for Providers

**Via Dashboard** (recommended):
1. Go to **API Keys** page
2. Select provider (Groq, Gemini, Cloudflare)
3. Paste your API key → Click **Add Key**

**Via API:**
```bash
# Add Groq key
curl -X POST https://your-backend.com/api/admin/keys/groq \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"gsk_XXXXX"}'

# Add Gemini key
curl -X POST https://your-backend.com/api/admin/keys/gemini \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"AIzaSyXXXX"}'
```

### 5.3 Get Your Free API Keys

| Provider | Free Tier | Get Key |
|----------|-----------|---------|
| **Groq** | 30 RPM, 14,400 req/day | [console.groq.com](https://console.groq.com/) |
| **Google Gemini** | 15 RPM, 1,500 req/day | [aistudio.google.com](https://aistudio.google.com/apikey) |
| **Cloudflare Workers AI** | 10,000 neurons/day | [dash.cloudflare.com](https://dash.cloudflare.com/) |

### 5.4 Test Everything

```bash
# Health check
curl https://your-backend.com/health

# Send a chat request
curl -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is the meaning of life?"}'

# Expected response:
# {
#   "output": "The meaning of life is...",
#   "provider": "groq",
#   "model": "llama-3.3-70b-versatile",
#   "request_id": "uuid-here"
# }

# Test streaming
curl -N -X POST https://your-backend.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Tell me a short joke","stream":true}'
```

---

## 6️⃣ FIRESTORE COLLECTIONS (Auto-Created)

These collections are created automatically as the system runs:

| Collection | Purpose | Created When |
|-----------|---------|-------------|
| `providers` | Provider configs | On "Seed Defaults" |
| `api_keys` | Stored API keys | On key add |
| `logs` | Request logs | On log flush |
| `daily_stats` | Aggregated stats | On daily cron / manual aggregate |

---

## 7️⃣ ARCHITECTURE OVERVIEW

```
┌─────────────────────┐
│  Cloudflare Pages    │     (Frontend Dashboard)
│  frontend/           │
└────────┬────────────┘
         │ HTTPS
┌────────▼────────────┐
│  Backend Server      │     (Fastify on Railway/Render/VPS)
│  POST /v1/chat/...   │
│  GET  /api/admin/... │
└──┬─────────┬────────┘
   │         │
┌──▼──┐  ┌──▼───────┐
│Redis│  │Firestore  │
│     │  │           │
│Queue│  │ providers │
│Cache│  │ api_keys  │
│Keys │  │ logs      │
│Stats│  │ daily_stats│
└─────┘  └──────────┘
   │
┌──▼──────────────────┐
│  BullMQ Worker       │     (Separate process)
│  Processes queue     │
│  Calls AI providers  │
└──────────────────────┘
    │
    ├──→ Groq API
    ├──→ Gemini API
    └──→ Cloudflare Workers AI
```

---

## ❓ TROUBLESHOOTING

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED` on Redis | Start Redis or check `REDIS_URL` |
| Firestore permission denied | Check `serviceAccountKey.json` path |
| 401 on API calls | Verify `API_KEY` matches `.env` |
| Frontend can't connect | Check CORS and backend URL in Settings |
| All providers exhausted | Add API keys via dashboard |
| BullMQ jobs stuck | Ensure worker process is running (`npm run worker`) |
| Upstash rate limit | Upgrade plan or reduce request volume |
