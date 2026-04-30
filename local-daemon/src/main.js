import Fastify from 'fastify';
import { loadConfig } from './core/config.js';
import { loadToken, validateToken, getTokenFilePath } from './core/token.js';
import { log, getLogPath } from './core/logger.js';
import { harvestTokens, watchTokenFiles, stopWatching } from './auth/harvester.js';
import { registerRoutes } from './routes.js';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('Loaded .env file from', envPath);
}

process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
  log.error('Uncaught Exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
  log.error('Unhandled Rejection', { reason: reason?.message || reason });
});

async function startDaemon() {
  const config = await loadConfig();
  const token = await loadToken();

  log.info('OmniRouteAI Local Daemon starting...');

  harvestTokens()
    .then(() => log.info('Initial token harvest complete'))
    .catch(err => log.error(`Initial harvest failed: ${err.message}`));

  watchTokenFiles();

  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
  });

  const corsMod = await import('@fastify/cors');
  await app.register(corsMod.default, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin', 'Content-Type', 'Accept', 'X-Local-Token',
      'Authorization', 'ngrok-skip-browser-warning', 'x-requested-with'
    ],
    exposedHeaders: ['ngrok-skip-browser-warning', 'Access-Control-Allow-Origin'],
    maxAge: 86400,
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
  });

  app.setErrorHandler(async (error, request, reply) => {
    // Ensure CORS headers and ngrok-skip-browser-warning are on ALL error responses
    reply
      .header('Access-Control-Allow-Origin', request.headers.origin || '*')
      .header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-Local-Token, Authorization, ngrok-skip-browser-warning, x-requested-with')
      .header('ngrok-skip-browser-warning', 'true');

    if (error.validation) {
      return reply.status(400).send({ error: 'Bad Request', message: error.message });
    }
    
    log.error('Request error:', { path: request.url, error: error.message, stack: error.stack });
    return reply.status(error.statusCode || 500).send({ 
      error: error.name || 'Internal Server Error',
      message: error.message 
    });
  });

  // Manual hooks removed in favor of @fastify/cors plugin which handles these automatically
  // and ngrok-skip-browser-warning header already included in allowedHeaders.

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;

    const path = request.url.split('?')[0];
    if (path === '/health' || path === '/' || path === '/logs' || path.startsWith('/auth/callback')) {
      return;
    }

    const tokenHeader = request.headers['x-local-token'];
    const isValid = await validateToken(tokenHeader);

    if (!isValid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid X-Local-Token header',
        hint: `Token is stored at: ${getTokenFilePath()}`,
      });
    }
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, JSON.parse(body)); }
    catch (err) { done(new Error('Invalid JSON'), undefined); }
  });

  await registerRoutes(app);

  const port = config.port || 5059;
  const host = '::'; // Listen on all interfaces (IPv4 and IPv6) to allow localhost resolution with ngrok

  try {
    await app.listen({ port, host });

    const startMsg = `OmniRouteAI Local Daemon v2.0.0 running on http://${host}:${port}`;
    console.log('\n' + startMsg);
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

  const shutdown = async (signal) => {
    log.info(`Received ${signal}, shutting down gracefully`);
    stopWatching();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startDaemon().catch((err) => {
  console.error('Fatal error starting daemon:', err);
  process.exit(1);
});
