# OmniRouteAI Local CLI Daemon

A standalone, ultra-fast proxy server that bridges raw terminal AI CLI tools with HTTP REST formats, capable of streaming local outputs directly to the central OmniRouteAI router.

## Features
- **Zero Config Routing:** Automatically turns local executables into standard HTTP endpoints.
- **SSE Streaming:** Wraps terminal stdout into Server-Sent Events (SSE).
- **Secure Token Auth:** Only accepts requests carrying an auto-generated `X-Local-Token`.
- **Cross-Platform:** Bundles into `.exe`, macOS bin, and Linux binaries.

---

## Getting Started

### 1. Installation & Building
You can clone this directory and install dependencies natively:
```bash
cd local-daemon
npm install
```

If you wish to compile it to a standalone executable (so you don't need Node.js installed to run it in the future):
```bash
npm run build:win   # Windows (.exe)
npm run build:mac   # macOS
npm run build:linux # Linux
npm run build:all   # All of the above
```
Compiled binaries will be located in the `dist/` directory.

### 2. Running the Daemon
To run it via Node.js natively:
```bash
npm start
```
To run the compiled Windows version:
```bash
./dist/OmniRouteAI-Local.exe
```
**Default Port:** `5059`

---

## Integration with OmniRouteAI Router

Because the Daemon exposes local tools, your central router needs to know how to authenticate with it. 

### Accessing your Secret Token
The very first time you start the daemon, it auto-generates a highly secure token and saves it to a configuration directory on your machine.
- **Windows:** `%USERPROFILE%\.omniroute\local-cli\token.txt`
- **Mac/Linux:** `~/.omniroute/local-cli/token.txt`

### Configuring the Router
Add these two variables to your central OmniRouteAI `.env` file (or Railway variables):
```env
# If you are testing locally:
LOCAL_DAEMON_URL=http://localhost:5059

# If your router is on Railway, use ngrok to expose your local port:
# LOCAL_DAEMON_URL=https://your-ngrok-url.app

# Paste the content of token.txt here:
LOCAL_DAEMON_TOKEN=abc123xyz890...
```

---

## Supported Tools

The endpoint structure maps identically to the tools registered in the main dashboard:
- `POST /claude` (Claude Code)
- `POST /gemini` (Gemini CLI)
- `POST /qwen` (Qwen Code CLI)
- `POST /grok` (Grok CLI)
- `POST /copilot` (GitHub Copilot CLI)
- etc...

### Customizing Tools
You can edit the Local Daemon's routing rules and auto-timeout constraints via:
`~/.omniroute/local-cli/config.json`
