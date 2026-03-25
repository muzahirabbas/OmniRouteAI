import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { loadToken, validateToken, getTokenFilePath } from './token.js';
import { log, getLogPath } from './logger.js';

// ─── Route plugins ────────────────────────────────────────────────────
import { claudeRoutes }      from './routes/claude.js';
import { geminiRoutes }      from './routes/gemini.js';
import { qwenRoutes }        from './routes/qwen.js';
import { antigravityRoutes } from './routes/antigravity.js';
import { kiloRoutes }        from './routes/kilo.js';
import { opencodeRoutes }    from './routes/opencode.js';
import { codexRoutes }       from './routes/codex.js';
import { kiroRoutes }        from './routes/kiro.js';
import { grokRoutes }        from './routes/grok.js';
import { zaiRoutes }         from './routes/zai.js';
import { clineRoutes }       from './routes/cline.js';
import { kimiRoutes }        from './routes/kimi.js';
import { ollamaRoutes }      from './routes/ollama.js';
import { copilotRoutes }     from './routes/copilot.js';
import { customRoutes }      from './routes/custom.js';
import { authRoutes }        from './routes/auth.js';

/**
 * OmniRouteAI Local CLI Daemon
 *
 * Exposes AI CLI tools (Claude, Gemini, Qwen, etc.) via HTTP on localhost:5059.
 * Each tool endpoint accepts: { prompt, model, stream, args }
 * Returns normalized: { output, raw, provider, model, tokens }
 *
 * Security:
 * - Only binds to 127.0.0.1 (never 0.0.0.0)
 * - All requests authenticated via X-Local-Token header
 * - Token auto-generated on first run, stored in ~/.omniroute/local-cli/token.txt
 */
async function startDaemon() {
  // Load config and token first
  const config = await loadConfig();
  const token  = await loadToken();

  const app = Fastify({
    logger: false, // We use our own JSON logger
    bodyLimit: 10 * 1024 * 1024, // 10MB body limit
  });

  // ─── Security: Token auth hook ───────────────────────────────────
  // Skip token check only for /health (so OmniRouteAI can probe without token setup)
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/') return;

    const tokenHeader = request.headers['x-local-token'];
    const isValid     = await validateToken(tokenHeader);

    if (!isValid) {
      return reply.code(401).send({
        error:   'Unauthorized',
        message: 'Missing or invalid X-Local-Token header',
        hint:    `Token is stored at: ${getTokenFilePath()}`,
      });
    }
  });

  // ─── Content-type parsing ────────────────────────────────────────
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, JSON.parse(body)); }
    catch (err) { done(new Error('Invalid JSON'), undefined); }
  });

  // ─── CORS (localhost only) ───────────────────────────────────────
  app.addHook('onSend', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin',  'http://localhost:3000');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, X-Local-Token');
  });

  app.options('*', async (request, reply) => {
    reply.code(204).send();
  });

  // ─── Health check (no auth required) ────────────────────────────
  app.get('/health', async () => ({
    status:    'healthy',
    service:   'omniroute-local-daemon',
    version:   '1.0.0',
    port:      config.port,
    timestamp: new Date().toISOString(),
  }));

  app.get('/', async () => ({
    service: 'OmniRouteAI Local CLI Daemon',
    version: '1.0.0',
    endpoints: [
      'POST /claude',
      'POST /gemini',
      'POST /qwen',
      'POST /antigravity',
      'POST /kilo',
      'POST /opencode',
      'POST /kiro',
      'POST /grok',
      'POST /zai',
      'POST /cline',
      'POST /kimi',
      'POST /ollama',
      'POST /copilot',
      'POST /custom',
      'GET  /auth/status',
      'GET  /auth/status/:tool',
      'POST /auth/login/:tool',
      'GET  /health',
      'GET  /config',
      'GET  /logs',
    ],
  }));

  // ─── Config viewer ───────────────────────────────────────────────
  app.get('/config', async () => {
    const cfg = await loadConfig();
    // Mask env vars (may contain secrets)
    const safe = JSON.parse(JSON.stringify(cfg));
    for (const tool of Object.values(safe.tools || {})) {
      if (tool.env && Object.keys(tool.env).length > 0) {
        tool.env = Object.fromEntries(
          Object.keys(tool.env).map(k => [k, '***masked***'])
        );
      }
    }
    return { config: safe, configPath: getTokenFilePath().replace('token.txt', 'config.json') };
  });

  // ─── Log viewer (last 100 lines) ─────────────────────────────────
  app.get('/logs', async (request, reply) => {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const logPath = getLogPath();

    if (!existsSync(logPath)) {
      return { logs: [], message: 'No logs yet' };
    }

    const raw   = await readFile(logPath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const last  = parseInt(request.query?.limit || '100', 10);
    const recent = lines.slice(-last).map(l => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });

    return { logs: recent, total: lines.length, logPath };
  });

  // ─── Environment Diagnostics ─────────────────────────────────────
  app.get('/v1/env', async () => {
    return {
      cwd:  process.cwd(),
      port: config.port,
      path: process.env.PATH,
      platform: process.platform,
      nodeVersion: process.version,
    };
  });

  // ─── Register all tool routes ────────────────────────────────────
  await app.register(claudeRoutes);
  await app.register(geminiRoutes);
  await app.register(qwenRoutes);
  await app.register(antigravityRoutes);
  await app.register(kiloRoutes);
  await app.register(opencodeRoutes);
  await app.register(codexRoutes);
  await app.register(kiroRoutes);
  await app.register(grokRoutes);
  await app.register(zaiRoutes);
  await app.register(clineRoutes);
  await app.register(kimiRoutes);
  await app.register(ollamaRoutes);
  await app.register(copilotRoutes);
  await app.register(customRoutes);
  await app.register(authRoutes);

  // ─── Start server ────────────────────────────────────────────────
  const port = config.port || 5059;
  const host = config.host || '127.0.0.1'; // ALWAYS localhost only

  try {
    await app.listen({ port, host });

    const startMsg = `OmniRouteAI Local Daemon running on http://${host}:${port}`;
    console.log(startMsg);
    log.info(startMsg, { port, host, logPath: getLogPath(), tokenPath: getTokenFilePath() });

    console.log(`\n  Token file : ${getTokenFilePath()}`);
    console.log(`  Log file   : ${getLogPath()}`);
    console.log(`  Config     : ${getTokenFilePath().replace('token.txt', 'config.json')}`);
    console.log(`\n  Set in main .env: LOCAL_DAEMON_TOKEN=${token}\n`);
  } catch (err) {
    console.error(`Failed to start daemon: ${err.message}`);
    log.error('Daemon start failed', { error: err.message });
    process.exit(1);
  }

  // ─── Graceful shutdown ────────────────────────────────────────────
  const shutdown = async (signal) => {
    log.info(`Received ${signal}, shutting down gracefully`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

startDaemon().catch((err) => {
  console.error('Fatal error starting daemon:', err);
  process.exit(1);
});
