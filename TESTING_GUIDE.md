# OmniRouteAI System Testing Guide

This guide provides a comprehensive checklist to verify that all components of the OmniRouteAI architecture are communicating, routing correctly, and preserving state.

## Step 1: Core Services & Databases

### 1.1 Verify Upstash Redis
1. Open the [Upstash Console](https://console.upstash.com/).
2. Select your OmniRouteAI Redis database.
3. **CRITICAL:** Go to **Configuration** -> **Eviction Policy** and ensure it is set to `noeviction`. This protects your BullMQ background workers from dropping jobs when memory gets full.

### 1.2 Verify Railway Deployments
1. Go to your Railway dashboard.
2. Ensure both the **Main API Server** and **Background Worker** services show green/healthy.
3. Check the **Deployment Logs** for both:
   - You should see `OmniRouteAI server listening on 0.0.0.0:8080`.
   - You should see `Worker health-check server listening`.
   - You should **not** see immediate "error signal SIGTERM" logs (thanks to the graceful shutdown fix).

---

## Step 2: Local CLI Daemon Configuration

### 2.1 Build the Daemon
1. Open your terminal in the OmniRouteAI repository root.
2. Run `cd local-daemon`
3. Run `npm install`
4. Run `npm run build:win` (or `build:all` to compile for Mac/Linux as well).
5. The executable will be generated at `dist/OmniRouteAI-Local.exe`.

### 2.2 Run & Authenticate
1. Launch the daemon: `./dist/OmniRouteAI-Local.exe` (or `npm start`).
2. You should see `LOCAL DAEMON STARTING ON PORT 5059`.
3. Open the file located at `%USERPROFILE%\.omniroute\local-cli\token.txt` (Windows) or `~/.omniroute/local-cli/token.txt` (Mac/Linux).
4. Copy the secure 64-character token.

### 2.3 Connect the Router
1. In your Railway dashboard for the main app, go to **Variables**.
2. Add or update the following environment variables:
   - `LOCAL_DAEMON_URL=http://<YOUR_LOCAL_IP>:5059` *(If testing from Railway, you must expose your local daemon via a utility like ngrok, e.g., `ngrok http 5059`, and use that URL).*
   - `LOCAL_DAEMON_TOKEN=<paste the token from step 2.2>`
3. Restart the Railway app to load the new config.

---

## Step 3: Frontend Dashboard Verification

### 3.1 Initial Setup
1. Open your hosted dashboard URL in the browser.
2. Go to **Settings** and ensure your Base URL and Admin API Key are correctly configured. Click **Test API Connection** to verify health.

### 3.2 Verify State Persistence
1. Navigate to the **Providers** tab.
2. Click **"🌱 Seed Defaults"**. You should see a success message.
3. Locate one of the local daemons (e.g., `grok_cli_local`).
4. Click **"✅ Enable"** or **"🚫 Disable"**. 
5. Refresh the browser entirely and navigate back to Providers. Verify that the provider remembered its disabled/enabled state.
6. Navigate to the **API Keys** tab. Add a fake key to Google, then click **Disable** on it. Refresh the page to ensure the key is still disabled.

---

## Step 4: Routing & Failover Flow Testing

### 4.1 Basic Tool Completion Test
You can test the actual routing engine using a standard HTTP client (Postman, cURL, etc.) against your Railway URL.

```bash
curl -X POST https://your-railway-url.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <Your_Admin_Key>" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
```
*Because `model` is "auto", the system should pick your active Provider with Priority 1 and the highest Weight.*

### 4.2 Local CLI Fallback / Overtake Test
1. In your dashboard, **Disable** all priority 1 and priority 2 remote cloud providers (OpenAI, Anthropic, Google, xAI, etc.).
2. Send the exact same `curl` request as above.
3. The router should now detect the higher priority providers are disabled, iterate down to Priority 0/3, and select your Local Daemon.
4. Watch the terminal where your Local Daemon is running; you should see it spin up a child process for the required CLI and stream the output back down the pipeline.

### 4.3 Streaming Test
Add `"stream": true` to your `curl` payload or test it via an LLM client interface. The backend adapter handles full chunked transfers directly to the client.

---

## Step 5: Background Tasks & Observability

### 5.1 Request Logs Migration
1. Send 5 test completions.
2. Go to the **Logs** tab in the dashboard.
3. Verify the requests show up instantly (pulled from Redis).
4. Wait 60 seconds. The background worker should automatically flush these from Redis into Firestore. Refresh the Logs page to see they are still there but loaded from persistent storage.

### 5.2 Stats Aggregation
1. Go to the **Stats** tab.
2. Verify "Today's Requests" incremented.
3. Click "Aggregate Now".
4. The history table below will be permanently written to Firestore via the background BullMQ worker.
