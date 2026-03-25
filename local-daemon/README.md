# OmniRouteAI Local CLI Daemon

A local HTTP daemon that exposes AI CLI tools (Claude Code, Gemini CLI, Qwen Code, Antigravity, Kilo, OpenCode) via HTTP endpoints on **localhost:5059**, integrating seamlessly with the main OmniRouteAI router as `type: local_http` providers.

---

## Directory Structure

```
local-daemon/
├── package.json
└── src/
    ├── main.js          # Fastify server entry point
    ├── config.js        # ~/.omniroute/local-cli/config.json manager
    ├── token.js         # X-Local-Token auth manager
    ├── logger.js        # JSON file logger (~/.omniroute/local-cli/daemon.log)
    ├── spawner.js       # CLI child_process spawner + streaming
    └── routes/
        ├── handler.js   # Shared route handler factory
        ├── claude.js    # POST /claude
        ├── gemini.js    # POST /gemini
        ├── qwen.js      # POST /qwen
        ├── antigravity.js  # POST /antigravity
        ├── kilo.js      # POST /kilo
        ├── opencode.js  # POST /opencode
        ├── custom.js    # POST /custom
        └── auth.js      # GET/POST /auth/*
```

---

## Quick Start

```bash
cd local-daemon
npm install
npm start
```

On first run, the daemon:
1. Generates a random auth token → saved to `~/.omniroute/local-cli/token.txt`
2. Creates default config → `~/.omniroute/local-cli/config.json`
3. Starts listening on `http://127.0.0.1:5059`

**Copy the printed token into your main OmniRouteAI `.env`:**
```env
LOCAL_DAEMON_TOKEN=<token printed at startup>
LOCAL_DAEMON_URL=http://localhost:5059
```

---

## API Endpoints

All endpoints require the `X-Local-Token` header (except `/health`).

### Tool Endpoints

| Method | Path | CLI Tool |
|--------|------|----------|
| `POST` | `/claude` | Claude Code CLI |
| `POST` | `/gemini` | Gemini CLI |
| `POST` | `/qwen` | Qwen Code CLI |
| `POST` | `/antigravity` | Antigravity CLI |
| `POST` | `/kilo` | Kilo AI CLI |
| `POST` | `/opencode` | OpenCode CLI |
| `POST` | `/custom` | User-defined CLI |

**Request body:**
```json
{
  "prompt": "Explain async/await in JavaScript",
  "model": "claude-3-5-sonnet",
  "stream": true,
  "args": {}
}
```

**Non-streaming response:**
```json
{
  "output": "Async/await is...",
  "raw": "full stdout",
  "provider": "claude_cli_local",
  "model": "claude-3-5-sonnet",
  "tokens": { "input": 12, "output": 84 },
  "success": true
}
```

**Streaming response (SSE):**
```
data: {"content": "Async/", "provider": "claude_cli_local"}
data: {"content": "await is...", "provider": "claude_cli_local"}
data: {"done": true, "provider": "claude_cli_local", "tokens": {...}}
data: [DONE]
```

### Auth Endpoints

```
GET  /auth/status         → status of all tools
GET  /auth/status/:tool   → status of specific tool
POST /auth/login/:tool    → trigger CLI login flow
```

### System Endpoints

```
GET /health    → no auth required
GET /config    → masked config view
GET /logs      → last 100 log lines
```

---

## Testing

```bash
# Health (no token needed)
curl http://localhost:5059/health

# Non-streaming claude
curl -X POST http://localhost:5059/claude \
  -H "Content-Type: application/json" \
  -H "X-Local-Token: <your-token>" \
  -d '{"prompt": "Say hello in JSON", "stream": false}'

# Streaming gemini
curl -N -X POST http://localhost:5059/gemini \
  -H "Content-Type: application/json" \
  -H "X-Local-Token: <your-token>" \
  -d '{"prompt": "Write a haiku", "stream": true}'

# Auth status
curl http://localhost:5059/auth/status \
  -H "X-Local-Token: <your-token>"
```

---

## Config: Per-Tool Customization

Edit `~/.omniroute/local-cli/config.json`:

```json
{
  "port": 5059,
  "tools": {
    "claude": {
      "enabled": true,
      "command": "claude",
      "args": [],
      "timeout": 60000,
      "env": { "ANTHROPIC_API_KEY": "sk-..." },
      "authCmd": "claude auth"
    },
    "gemini": {
      "enabled": true,
      "command": "gemini",
      "timeout": 60000
    },
    "custom": {
      "enabled": true,
      "command": "/path/to/my-tool",
      "args": ["--flag"],
      "timeout": 30000
    }
  }
}
```

---

## Building the Executable

Install `pkg` globally:
```bash
npm install -g pkg
```

Build for all platforms:
```bash
npm run build:all
```

Output files in `dist/`:
- `dist/OmniRouteAI-Local.exe` (Windows)
- `dist/OmniRouteAI-Local` (Linux)
- `dist/OmniRouteAI-Local-mac` (macOS)

---

## Auto-Start on Windows

Create a scheduled task or use [NSSM](https://nssm.cc/) to run the `.exe` at login:

```powershell
# With NSSM
nssm install OmniRouteAIDaemon "C:\path\to\OmniRouteAI-Local.exe"
nssm set OmniRouteAIDaemon AppNoConsole 1
nssm start OmniRouteAIDaemon
```

Or add a shortcut to `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`.

---

## OmniRouteAI Integration

Enable CLI providers in Firestore (via Admin UI or API):

```bash
curl -X PUT http://localhost:3000/api/admin/providers/claude_cli_local \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

Then refresh the provider pool:
```bash
curl -X POST http://localhost:3000/api/admin/providers/refresh
```

The main `localHttpAdapter.js` will automatically send `X-Local-Token` if `LOCAL_DAEMON_TOKEN` is set in the main app's environment.

### Provider Config (in `providers.js`)
```js
{
  name:     'claude_cli_local',
  type:     'local_http',
  priority: 0,      // Takes precedence over all remote providers
  weight:   30,
  status:   'inactive',  // Set to 'active' in Firestore to enable
  endpoint: 'http://localhost:5059/claude',
  models:   ['claude-opus-4.5', 'claude-sonnet-4.5', 'default'],
  rpmLimit: 999999
}
```

---

## Security

- Daemon **only binds to `127.0.0.1`** — never to `0.0.0.0`
- Every request validated via `X-Local-Token` header
- Token stored locally in `~/.omniroute/local-cli/token.txt`
- Env vars with secrets are masked in `/config` endpoint
