import { getDb } from '../config/firestore.js';
import { getClient, get, keys, del, zadd, zrange } from '../config/redis.js';
import { getProviders } from '../config/providers.js';
import { getActiveProviders, isProviderDisabled, disableProvider, getErrorRate } from '../services/providerService.js';
import { registerKeys, isKeyDisabled, disableKey } from '../services/keyService.js';
import { getStats, aggregateDaily } from '../services/statsService.js';
import { flushLogs } from '../services/loggingService.js';

/**
 * Admin API routes for the frontend dashboard.
 * All routes are under /api/admin/*
 */
export async function adminRoutes(app) {

  // ─── System Health ─────────────────────────────────────────────────
  app.get('/api/admin/health', async (request, reply) => {
    let redisOk = false;
    let firestoreOk = false;

    try {
      await getClient().ping();
      redisOk = true;
    } catch {}

    try {
      const db = getDb();
      await db.collection('providers').limit(1).get();
      firestoreOk = true;
    } catch {}

    return {
      status: redisOk && firestoreOk ? 'healthy' : 'degraded',
      redis: redisOk ? 'connected' : 'disconnected',
      firestore: firestoreOk ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  // ─── Overview Stats ────────────────────────────────────────────────
  app.get('/api/admin/overview', async (request, reply) => {
    const stats = await getStats();
    const providers = await getActiveProviders();

    // Get all provider error rates
    const providerHealth = [];
    const allProviders = await getProviders();
    for (const p of allProviders) {
      const disabled = await isProviderDisabled(p.name);
      const errorRate = await getErrorRate(p.name);
      providerHealth.push({
        name: p.name,
        status: disabled ? 'disabled' : 'active',
        errorRate: Math.round(errorRate * 100),
        models: p.models,
        priority: p.priority,
        weight: p.weight,
      });
    }

    return {
      stats,
      activeProviders: providers.length,
      totalProviders: allProviders.length,
      providerHealth,
    };
  });

  // ─── Providers ─────────────────────────────────────────────────────

  // List all providers
  app.get('/api/admin/providers', async () => {
    const allProviders = await getProviders();
    const result = [];

    for (const p of allProviders) {
      const disabled = await isProviderDisabled(p.name);
      const errorRate = await getErrorRate(p.name);

      // Count registered keys
      const keysList = await zrange(`provider:${p.name}:keys`, 0, -1, true);
      const keyCount = keysList.length / 2; // WITHSCORES returns pairs

      result.push({
        ...p,
        disabled,
        errorRate: Math.round(errorRate * 100),
        keyCount,
      });
    }

    return { providers: result };
  });

  // Update provider in Firestore
  app.put('/api/admin/providers/:name', async (request, reply) => {
    const { name } = request.params;
    const updates = request.body;

    try {
      const db = getDb();
      const providerRef = db.collection('providers').doc(name);
      const doc = await providerRef.get();

      if (doc.exists) {
        await providerRef.update(updates);
      } else {
        await providerRef.set({ name, ...updates });
      }

      // Invalidate provider cache
      await del('providers:list');

      return { success: true, provider: name };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // Disable/enable a provider manually
  app.post('/api/admin/providers/:name/toggle', async (request, reply) => {
    const { name } = request.params;
    const { disabled, ttl } = request.body || {};

    if (disabled) {
      await disableProvider(name, ttl || 3600);
      return { success: true, provider: name, status: 'disabled' };
    } else {
      await del(`provider:disabled:${name}`);
      return { success: true, provider: name, status: 'active' };
    }
  });

  // ─── API Keys ──────────────────────────────────────────────────────

  // List keys for a provider (masked)
  app.get('/api/admin/keys/:provider', async (request, reply) => {
    const { provider } = request.params;
    const keysList = await zrange(`provider:${provider}:keys`, 0, -1, true);

    const result = [];
    for (let i = 0; i < keysList.length; i += 2) {
      const key = keysList[i];
      const usage = parseInt(keysList[i + 1], 10);
      const disabled = await isKeyDisabled(provider, key);
      const rpmRaw = await get(`rpm:${key}`);

      result.push({
        key: maskKey(key),
        fullKey: key, // Frontend will mask this client-side for display
        usage,
        rpm: parseInt(rpmRaw || '0', 10),
        disabled,
      });
    }

    return { provider, keys: result };
  });

  // Add a key for a provider
  app.post('/api/admin/keys/:provider', async (request, reply) => {
    const { provider } = request.params;
    const { key } = request.body;

    if (!key) {
      return reply.code(400).send({ error: 'key is required' });
    }

    await registerKeys(provider, [key]);

    // Also store in Firestore for persistence
    try {
      const db = getDb();
      await db.collection('api_keys').add({
        provider,
        key,
        usage_today: 0,
        tokens_today: 0,
        created_at: new Date().toISOString(),
      });
    } catch {}

    return { success: true, provider };
  });

  // Remove a key
  app.delete('/api/admin/keys/:provider/:key', async (request, reply) => {
    const { provider, key } = request.params;

    // Remove from Redis sorted set
    const { zrem } = await import('../config/redis.js');
    await zrem(`provider:${provider}:keys`, key);

    // Remove from Firestore
    try {
      const db = getDb();
      const snapshot = await db.collection('api_keys')
        .where('provider', '==', provider)
        .where('key', '==', key)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        await snapshot.docs[0].ref.delete();
      }
    } catch {}

    return { success: true, provider };
  });

  // Disable/enable a key
  app.post('/api/admin/keys/:provider/:key/toggle', async (request, reply) => {
    const { provider, key } = request.params;
    const { disabled } = request.body || {};

    if (disabled) {
      await disableKey(provider, key, 3600);
    } else {
      await del(`key:disabled:${provider}:${key}`);
    }

    return { success: true, provider, key: maskKey(key), disabled };
  });

  // ─── Logs ──────────────────────────────────────────────────────────

  // Get recent logs from Firestore
  app.get('/api/admin/logs', async (request, reply) => {
    const { limit: queryLimit = 50, provider, status } = request.query;
    const limitNum = Math.min(parseInt(queryLimit, 10) || 50, 200);

    try {
      const db = getDb();
      let query = db.collection('logs').orderBy('timestamp', 'desc').limit(limitNum);

      if (provider) query = query.where('provider', '==', provider);
      if (status) query = query.where('status', '==', status);

      const snapshot = await query.get();
      const logs = [];
      snapshot.forEach((doc) => logs.push({ id: doc.id, ...doc.data() }));

      return { logs, count: logs.length };
    } catch (err) {
      // If Firestore query fails (e.g., missing index), return empty
      return { logs: [], count: 0, error: err.message };
    }
  });

  // Flush pending logs now
  app.post('/api/admin/logs/flush', async () => {
    await flushLogs();
    return { success: true };
  });

  // ─── Stats ─────────────────────────────────────────────────────────

  // Current day stats
  app.get('/api/admin/stats', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const statsKeys = await keys(`stats:${today}:*`);

    const stats = {};
    for (const key of statsKeys) {
      const value = await get(key);
      const statName = key.replace(`stats:${today}:`, '');
      stats[statName] = parseInt(value, 10) || 0;
    }

    return { date: today, stats };
  });

  // Historical stats from Firestore
  app.get('/api/admin/stats/history', async (request, reply) => {
    const { days = 7 } = request.query;
    const daysNum = Math.min(parseInt(days, 10) || 7, 90);

    try {
      const db = getDb();
      const snapshot = await db.collection('daily_stats')
        .orderBy('date', 'desc')
        .limit(daysNum)
        .get();

      const history = [];
      snapshot.forEach((doc) => history.push({ id: doc.id, ...doc.data() }));

      return { history, count: history.length };
    } catch (err) {
      return { history: [], count: 0, error: err.message };
    }
  });

  // Trigger manual aggregation
  app.post('/api/admin/stats/aggregate', async () => {
    const result = await aggregateDaily();
    return { success: true, stats: result };
  });

  // ─── Settings ──────────────────────────────────────────────────────

  // Seed providers to Firestore
  app.post('/api/admin/seed-providers', async () => {
    const { STATIC_PROVIDERS } = await import('../config/providers.js');
    const db = getDb();

    for (const provider of STATIC_PROVIDERS) {
      await db.collection('providers').doc(provider.name).set(provider, { merge: true });
    }

    // Invalidate cache
    await del('providers:list');

    return { success: true, seeded: STATIC_PROVIDERS.length };
  });
}

function maskKey(key) {
  if (!key || key.length < 10) return '***';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
