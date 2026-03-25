import Fastify from 'fastify';
import cors from '@fastify/cors';
import { v4 as uuidv4 } from 'uuid';
import { chatRoutes } from './routes/chat.js';
import { adminRoutes } from './routes/admin.js';

/**
 * Build and configure the Fastify server.
 * @param {object} [opts={}]
 * @returns {import('fastify').FastifyInstance}
 */
export async function buildServer(opts = {}) {
  const app = Fastify({
    logger: {
      level: opts.logLevel || 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    genReqId: () => uuidv4(),
    requestTimeout: 60000,
    ...opts,
  });

  // ─── CORS ──────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ─── Request ID decoration ──────────────────────────────────────────
  app.decorateRequest('requestId', null);
  app.addHook('onRequest', async (request) => {
    request.requestId = request.id;
  });

  // ─── Auth middleware ────────────────────────────────────────────────
  const API_KEY = process.env.API_KEY;

  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for health checks (both root and admin endpoints) and CORS preflight OPTIONS requests
    if (request.url === '/' || request.url.includes('/health') || request.method === 'OPTIONS') return;

    if (!API_KEY) {
      app.log.warn('API_KEY not set — auth disabled');
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <key>',
      });
      return;
    }

    const token = authHeader.slice(7);
    if (token !== API_KEY) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
      return;
    }
  });

  // ─── Root Level Health Check (Railway requirement) ──────────────────
  app.get('/', async () => {
    return { name: 'OmniRouteAI', status: 'online' };
  });

  // ─── Redis Health Check ─────────────────────────────────────────────
  // Run eviction policy check on startup (non-blocking)
  const { checkEvictionPolicy, checkMemoryUsage } = await import('./config/redis.js');
  const { testFirestoreConnectivity, isMockDb } = await import('./config/firestore.js');
  
  // Check eviction policy after a short delay (allow Redis to fully connect)
  setTimeout(async () => {
    await checkEvictionPolicy();
    await checkMemoryUsage();
    
    // Check Firestore connectivity
    const firestoreResult = await testFirestoreConnectivity();
    if (!firestoreResult.connected) {
      console.error(JSON.stringify({
        level: 'fatal',
        msg: 'FIRESTORE NOT CONNECTED - Running in degraded mode',
        error: firestoreResult.error,
        impact: 'Logs, stats, and provider configs will not persist',
        fix: 'Set GOOGLE_APPLICATION_CREDENTIALS environment variable',
      }));
    }
  }, 2000);


  // ─── Routes ─────────────────────────────────────────────────────────
  await app.register(chatRoutes);
  await app.register(adminRoutes);

  // ─── Global error handler ──────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    app.log.error({
      requestId: request.requestId,
      error: error.message,
      stack: error.stack,
      statusCode,
    });

    reply.code(statusCode).send({
      error: error.name || 'InternalError',
      message: error.message,
      requestId: request.requestId,
    });
  });

  return app;
}
