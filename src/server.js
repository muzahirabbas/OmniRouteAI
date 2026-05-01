import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { v4 as uuidv4 } from 'uuid';
import { chatRoutes } from './routes/chat.js';
import { searchRoutes } from './routes/search.js';
import { adminRoutes } from './routes/admin.js';
import { debugRedisRoutes } from './routes/debugRedis.js';
import { debugKeysRoutes } from './routes/debugKeys.js';
import { debugTestLuaRoutes } from './routes/debugTestLua.js';
import { debugTestSelectRoutes } from './routes/debugTestSelect.js';
import { debugKeyFlowRoutes } from './routes/debugKeyFlow.js';
import { debugTestProvidersRoutes } from './routes/debugTestProviders.js';
import { debugKeyServiceRoutes } from './routes/debugKeyService.js';
import { debugTestAdapterRoutes } from './routes/debugTestAdapter.js';
import { audioRoutes } from './routes/audio.js';
import { embeddingRoutes } from './routes/embeddings.js';

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
    // FIX: Railway timeout safety - set less than Railway's 60s (hobby) or 300s (pro)
    // Railway hobby = 60s timeout, Pro = 300s. Set to 55s for hobby to fail gracefully.
    requestTimeout: process.env.RAILWAY_STATIC_URL ? 55000 : 290000,
    bodyLimit: 20971520, // 20MB for multimodal payloads
    ...opts,
  });

// ─── CORS ──────────────────────────────────────────────────────────
   await app.register(cors, {
     origin: '*',
     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
     allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
     exposedHeaders: ['Content-Type', 'X-Request-Id'],
     credentials: true,
   });

   // ─── Multipart for audio transcription ─────────────────────────────
   await app.register(multipart, {
     limits: {
       fileSize: 20971520, // 20MB max
       files: 1,
     },
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
      return;
    }

    // ─── KEY BOOTSTRAP ────────────────────────────────────────────────
    // Redis is ephemeral — on every restart, provider:{name}:keys sorted sets
    // are wiped. Firestore is the source of truth for API keys.
    // This bootstrap re-populates Redis from Firestore so ALL cloud providers
    // (Groq, OpenRouter, Google, Cerebras, etc.) have their keys available
    // immediately after startup without needing a manual refresh call.
    try {
      const { registerKeys, disableKey, setKeyMetadata } = await import('./services/keyService.js');
      const { registerSearchKeys, disableSearchKey, setSearchKeyMetadata } = await import('./services/searchKeyService.js');
      const { getDb: getFirestoreDb } = await import('./config/firestore.js');
      const db = getFirestoreDb();

      // Bootstrap LLM keys
      const keysSnapshot = await db.collection('api_keys').get();
      const keysByProvider = {};
      const disabledEntries = [];
      const metadataOps = [];

      keysSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(JSON.stringify({
          level: 'debug',
          msg: 'Key document from Firestore',
          docId: doc.id,
          provider: data.provider,
          hasKey: !!data.key,
          isDisabled: data.is_disabled,
        }));
        if (data.provider && data.key) {
          if (!keysByProvider[data.provider]) keysByProvider[data.provider] = [];
          keysByProvider[data.provider].push(data.key);
          if (data.is_disabled) disabledEntries.push({ provider: data.provider, key: data.key });
          if (data.metadata) metadataOps.push(setKeyMetadata(data.provider, data.key, data.metadata));
        }
      });

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Keys loaded from Firestore by provider',
        providers: Object.keys(keysByProvider),
        keysPerProvider: Object.fromEntries(Object.entries(keysByProvider).map(([k, v]) => [k, v.length])),
      }));

      await Promise.all([
        // NX flag: only adds keys not already in Redis, preserves usage scores
        ...Object.entries(keysByProvider).map(([pName, pKeys]) => registerKeys(pName, pKeys)),
        ...disabledEntries.map(dk => disableKey(dk.provider, dk.key, 31536000)),
        ...metadataOps,
      ]);

      const totalKeys = Object.values(keysByProvider).reduce((s, ks) => s + ks.length, 0);
      console.log(JSON.stringify({
        level: 'info',
        msg: `LLM key bootstrap complete`,
        totalKeys,
        providers: Object.keys(keysByProvider),
      }));

      // Bootstrap search API keys
      const searchKeysSnapshot = await db.collection('search_api_keys').get();
      const searchKeysByProvider = {};
      const searchDisabledEntries = [];
      const searchMetadataOps = [];

      searchKeysSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.provider && data.key) {
          if (!searchKeysByProvider[data.provider]) searchKeysByProvider[data.provider] = [];
          searchKeysByProvider[data.provider].push(data.key);
          if (data.is_disabled) searchDisabledEntries.push({ provider: data.provider, key: data.key });
          if (data.metadata) searchMetadataOps.push(setSearchKeyMetadata(data.provider, data.key, data.metadata));
        }
      });

      await Promise.all([
        ...Object.entries(searchKeysByProvider).map(([pName, pKeys]) => registerSearchKeys(pName, pKeys)),
        ...searchDisabledEntries.map(dk => disableSearchKey(dk.provider, dk.key, 31536000)),
        ...searchMetadataOps,
      ]);

      const totalSearchKeys = Object.values(searchKeysByProvider).reduce((s, ks) => s + ks.length, 0);
      console.log(JSON.stringify({
        level: 'info',
        msg: `Search key bootstrap complete`,
        totalSearchKeys,
        providers: Object.keys(searchKeysByProvider),
      }));
    } catch (bootstrapErr) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'Key bootstrap failed — some providers may have no keys in Redis',
        error: bootstrapErr.message,
      }));
    }
  }, 2000);


  // ─── Routes ─────────────────────────────────────────────────────────
  await app.register(chatRoutes);
  await app.register(searchRoutes);
  await app.register(adminRoutes);
  await app.register(debugRedisRoutes);
  await app.register(debugKeysRoutes);
  await app.register(debugTestLuaRoutes);
  await app.register(debugTestSelectRoutes);
  await app.register(debugKeyFlowRoutes);
  await app.register(debugTestProvidersRoutes);
  await app.register(debugKeyServiceRoutes);
  await app.register(debugTestAdapterRoutes);
  await app.register(audioRoutes);
  await app.register(embeddingRoutes);
  // await app.register(debugSimpleKeysRoutes);  // Commented out - cause issues

  // ─── Global error handler ──────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    
    app.log.error({
      err: error,
      requestId: request.requestId,
      url: request.url,
    });

    // Map error types
    let errorType = 'internal_error';
    if (statusCode === 400) errorType = 'invalid_request_error';
    else if (statusCode === 401) errorType = 'authentication_error';
    else if (statusCode === 403) errorType = 'permission_error';
    else if (statusCode === 404) errorType = 'invalid_request_error';
    else if (statusCode === 429) errorType = 'rate_limit_error';
    else if (statusCode >= 500) errorType = 'server_error';
    
    reply.code(statusCode).send({
      error: {
        message: error.message,
        type: errorType,
        param: error.param || null,
        code: error.code || null,
      }
    });
  });

  return app;
}
