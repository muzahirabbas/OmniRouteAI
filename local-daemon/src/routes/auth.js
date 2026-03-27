import { log } from '../logger.js';
import { getTools, getToolConfig, loadConfig } from '../config.js';
import { loadTokens, saveTokens } from '../oauth/tokenStorage.js';
import { startDeviceFlow, pollDeviceFlow } from '../oauth/deviceFlow.js';
import { openOAuthBrowser, handleOAuthCallback } from '../oauth/oauthFlow.js';
import { importCursorToken } from '../oauth/cursorImport.js';
import { harvestTokens } from '../oauth/harvester.js';
import { spawnCLI } from '../spawner.js';

export async function authRoutes(app) {

  // ─── POST /auth/harvest ──────────────────────────────────────────
  app.post('/auth/harvest', async (request, reply) => {
    const results = await harvestTokens();
    return { success: true, sessions: results, timestamp: new Date().toISOString() };
  });

  // ─── GET /auth/oauth-status ──────────────────────────────────────
  app.get('/auth/oauth-status', async () => {
    const tokens = await loadTokens();
    const config = await loadConfig();
    const tools = config.tools || {};
    
    // Define method mapping based on 9router research classification
    const METHOD_MAP = {
      'claude': 'oauth', 'gemini': 'oauth', 'antigravity': 'oauth', 'codex': 'oauth', 'cline': 'oauth', 'iflow': 'oauth',
      'copilot': 'device-flow', 'qwen': 'device-flow', 'kiro': 'device-flow', 'kilo': 'device-flow', 'kimi': 'device-flow',
      'cursor': 'sqlite-import',
      'zai': 'harvested', 'opencode': 'harvested',
    };

    const status = {};
    for (const id of Object.keys(tools)) {
      const tokenData = tokens[id];
      const method = METHOD_MAP[id] || 'cli-bridge';
      
      status[id] = {
        name:     tools[id]?.name || id,
        active:   !!tokenData,
        source:   tokenData?.source || 'none',
        expires:  tokenData?.expiresAt || null,
        method:   method
      };
    }
    return { providers: status };
  });

  // ─── POST /auth/:tool/login (Trigger OAuth/Device/SQLite) ─────────
  app.post('/auth/:tool/login', async (request, reply) => {
    const { tool } = request.params;
    const body = request.body || {};
    
    // SQLite Import (Cursor)
    if (tool === 'cursor') {
      try {
        const result = await importCursorToken();
        return { method: 'sqlite-import', ...result };
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    }

    // Device Flow
    if (['copilot', 'qwen', 'kiro', 'kilo', 'kimi'].includes(tool)) {
      try {
        const flow = await startDeviceFlow(tool);
        return { method: 'device-flow', ...flow };
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    }

    // Standard OAuth PKCE/AuthCode
    if (['claude', 'gemini', 'antigravity', 'iflow', 'cline'].includes(tool)) {
      try {
        // Use provided callback URI from frontend, or default to daemon
        const redirectUri = body.redirectUri || 'http://127.0.0.1:5059/auth/callback';
        const flow = await openOAuthBrowser(tool, redirectUri);
        return { method: 'oauth', ...flow };
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    }

    // Codex has special port
    if (tool === 'codex') {
      try {
        const redirectUri = 'http://127.0.0.1:1455/auth/callback';
        const flow = await openOAuthBrowser(tool, redirectUri);
        return { method: 'oauth', ...flow };
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    }

    return reply.code(400).send({ error: `Tool ${tool} does not support web login` });
  });

  // ─── GET /auth/:tool/poll (Check Device Flow Status) ──────────────
  app.get('/auth/:tool/poll', async (request) => {
    return await pollDeviceFlow(request.params.tool);
  });

  // ─── GET /auth/callback (Handle OAuth Redirects) ──────────────────
  app.get('/auth/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query;
    if (error) {
      return reply.type('text/html').send(`<h2>OAuth Failed</h2><p>${error_description || error}</p>`);
    }
    if (!code || !state) {
      return reply.type('text/html').send(`<h2>Invalid Request</h2><p>Missing code or state.</p>`);
    }

    try {
      const result = await handleOAuthCallback(code, state);
      // Close window script on success
      return reply.type('text/html').send(`
        <html><body>
          <h2>Login Successful!</h2>
          <p>You can close this window now and return to OmniRouteAI dashboard.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body></html>
      `);
    } catch (err) {
      return reply.type('text/html').send(`<h2>OAuth Failed</h2><p>${err.message}</p>`);
    }
  });

  // ─── DELETE /auth/:tool (Revoke Session) ──────────────────────────
  app.delete('/auth/:tool', async (request) => {
    const { tool } = request.params;
    const tokens = await loadTokens();
    if (tokens[tool]) {
      delete tokens[tool];
      await saveTokens(tokens);
      log.info(`Revoked active session for ${tool}`);
    }
    return { success: true };
  });

}
