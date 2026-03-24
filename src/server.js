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
    // Skip auth for health check
    if (request.url === '/health') return;

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
    }
  });

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
