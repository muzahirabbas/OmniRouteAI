import { getDb, testFirestoreConnectivity } from '../config/firestore.js';
import { getClient, get, keys, del, zadd, zrange, mget, zrem } from '../config/redis.js';
import { getProviders, STATIC_PROVIDERS } from '../config/providers.js';
import {
  getActiveProviders,
  isProviderDisabled,
  disableProvider,
  getProviderHealth,
  resetProviderCircuitBreaker,
} from '../services/providerService.js';
import { 
  registerKeys, 
  isKeyDisabled, 
  disableKey, 
  resetProviderKeys, 
  getKeyMetadata, 
  setKeyMetadata 
} from '../services/keyService.js';
import {
  registerSearchKeys,
  isSearchKeyDisabled,
  disableSearchKey,
  resetSearchProviderKeys,
  getSearchKeyMetadata,
  setSearchKeyMetadata,
} from '../services/searchKeyService.js';
import { getStats, aggregateDaily, getKeyStatsHistory } from '../services/statsService.js';
import { flushLogs } from '../services/loggingService.js';
import { createRateLimiter } from '../utils/rateLimiter.js';
import { invalidateAdapterCache } from '../services/routerService.js';
import { disableSearchProvider } from '../services/searchRouterService.js';

/**
 * Mask an API key for safe logging.
 * Shows first 6 and last 4 characters.
 */
function maskKey(key) {
  if (!key || key.length < 10) return '***';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

// Rate limiter for admin endpoints: 10 requests per minute per IP
const adminRateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 10,
  keyPrefix: 'ratelimit:admin:',
});

/**
 * Admin API routes.
 */
export async function adminRoutes(app) {
  // Apply rate limiting to all admin routes EXCEPT diagnostic simulations
  app.addHook('onRequest', (request, reply, done) => {
    if (request.url.includes('/simulate-rotation') || request.url.includes('/test/')) {
      return done();
    }
    return adminRateLimiter(request, reply, done);
  });

  // ─── System Health ────────────────────────────────────────────────────
  app.get('/api/admin/health', async () => {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
    
    const [redisRes, firestoreRes] = await Promise.allSettled([
      Promise.race([getClient().ping(), timeout(3000)]),
      Promise.race([testFirestoreConnectivity(), timeout(5000)])
    ]);

    const redisOk = redisRes.status === 'fulfilled';
    const firestoreOk = firestoreRes.status === 'fulfilled' && firestoreRes.value.connected;
    const firestoreError = firestoreRes.status === 'rejected' ? firestoreRes.reason.message : (firestoreRes.value?.error || null);

    return {
      status:          redisOk && firestoreOk ? 'healthy' : 'degraded',
      redis:           redisOk     ? 'connected' : 'disconnected',
      firestore:       firestoreOk ? 'connected' : 'disconnected',
      firestore_error: firestoreError,
      is_mock_db:      !firestoreOk,
      uptime:          process.uptime(),
      timestamp:       new Date().toISOString(),
    };
  });

  // ─── Overview Stats ───────────────────────────────────────────────────
  app.get('/api/admin/overview', async () => {
    try {
      const [stats, providers, allProviders] = await Promise.all([
        getStats(),
        getActiveProviders(),
        getProviders()
      ]);

      const providerHealth = await Promise.all(allProviders.map(async (p) => {
        try {
          const health = await getProviderHealth(p.name);
          const isEffectiveDisabled = p.status !== 'active' || health.disabled;
          
          return {
            name:      p.name,
            status:    isEffectiveDisabled ? 'disabled' : 'active',
            errorRate: Math.round(health.errorRate * 100),
            success:   health.success,
            fail:      health.fail,
            total:     health.total,
            models:    p.models,
            priority:  p.priority,
            weight:    p.weight,
          };
        } catch (innerErr) {
          console.warn(`Overview: Failed to get health for ${p.name}`);
          return { 
            name: p.name, 
            status: 'degraded',
            error: innerErr.message
          };
        }
      }));

      return {
        stats,
        activeProviders: providers.length,
        totalProviders:  allProviders.length,
        providerHealth,
      };
    } catch (err) {
      return { 
        success: false, 
        error: "System overview failed", 
        message: err.message,
        stats: {},
        providerHealth: []
      };
    }
  });

  // ─── Simulation & Testing ─────────────────────────────────────────────
  app.get('/api/admin/simulate-rotation', async (req) => {
    const { route } = await import('../services/routerService.js');
    const { model, taskType, provider: providerOverride } = req.query;
    const prompt = req.query.prompt || 'Hello, this is a dry-run rotation test.';

    try {
      const selection = await route(prompt, {
        model,
        taskType,
        provider: providerOverride
      });

      return {
        success:  true,
        selected: {
          provider: selection.provider.name,
          model:    selection.model,
          apiKey:   maskKey(selection.apiKey),
          tier:     selection.provider.priority ?? 99,
          weight:   selection.provider.weight ?? 1,
          type:     selection.provider.type || 'cloud'
        },
        taskType: selection.taskType,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error:   err.message,
        code:    err.code || 500
      };
    }
  });

  // Trip a circuit breaker for a provider (Simulate 5 failures)
  app.post('/api/admin/test/simulate-error', async (req, reply) => {
    const { name } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'Missing provider name' });

    const { recordProviderResult } = await import('../services/providerService.js');
    
    // Threshold is 50% on 5 samples. We send 6 failures to be 100% sure it trips.
    for (let i = 0; i < 6; i++) {
      await recordProviderResult(name, false);
    }

    return { success: true, tripped: name, reason: 'Manual error injection (6 fails)' };
  });

  // Re-close the circuit (Recover)
  app.post('/api/admin/test/recover-provider', async (req, reply) => {
    const { name } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'Missing provider name' });

    const { resetProviderCircuitBreaker } = await import('../services/providerService.js');
    await resetProviderCircuitBreaker(name);

    return { success: true, recovered: name };
  });

  // ─── Providers ────────────────────────────────────────────────────────
  app.get('/api/admin/providers', async () => {
    try {
      const allProviders = await getProviders();

      const providerPromises = allProviders.map(async (p) => {
        try {
          const [health, keysList] = await Promise.all([
            getProviderHealth(p.name),
            zrange(`provider:${p.name}:keys`, 0, -1, true)
          ]);
          
          const keyCount = (keysList?.length || 0) / 2;
          const isEffectiveDisabled = p.status !== 'active' || health.disabled;
          
          return {
            ...p,
            disabled:  isEffectiveDisabled,
            errorRate: Math.round(health.errorRate * 100),
            success:   health.success,
            fail:      health.fail,
            total:     health.total,
            keyCount
          };
        } catch (err) {
          console.warn(`Failed to fetch health for ${p.name}: ${err.message}`);
          return { 
            ...p, 
            disabled: true, 
            keyCount: 0,
            error: err.message 
          };
        }
      });

      const result = await Promise.all(providerPromises);
      return { success: true, providers: result };
    } catch (err) {
      return { success: false, error: err.message, providers: [] };
    }
  });

  app.get('/api/admin/models', async () => {
    const allProviders = await getProviders();
    const uniqueModels = new Set();
    allProviders.forEach(p => {
      if (p.models) p.models.forEach(m => uniqueModels.add(m));
    });
    return { models: Array.from(uniqueModels).sort() };
  });

  app.get('/api/admin/providers/:name/models', async (request, reply) => {
    const { name } = request.params;
    const allProviders = await getProviders();
    const provider = allProviders.find(p => p.name === name);
    if (!provider) return reply.code(404).send({ error: `Provider "${name}" not found.` });
    return { 
      provider: name, 
      models: provider.models || [],
      features: provider.features || []
    };
  });

  app.put('/api/admin/providers/:name', async (request, reply) => {
    const { name }  = request.params;
    const updates   = request.body;

    try {
      const db          = getDb();
      const providerRef = db.collection('providers').doc(name);
      await providerRef.set({ name, ...updates }, { merge: true });
      await del('providers:list');
      invalidateAdapterCache(name);
      return { success: true, provider: name };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  app.post('/api/admin/providers/:name/toggle', async (request) => {
    const { name }          = request.params;
    const { disabled, ttl } = request.body || {};
    const newStatus         = disabled ? 'inactive' : 'active';

    try {
      const db = getDb();
      await db.collection('providers').doc(name).set({ status: newStatus }, { merge: true });
      await del('providers:list');
      if (disabled) {
        await disableProvider(name, ttl || 3600);
      } else {
        await del(`provider:disabled:${name}`);
      }
      return { success: true, provider: name, status: newStatus };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  app.get('/api/admin/providers/:name/health', async (request) => {
    const { name } = request.params;
    const health = await getProviderHealth(name);
    return {
      provider:  name,
      disabled:  health.disabled,
      errorRate: Math.round(health.errorRate * 100),
      success:   health.success,
      fail:      health.fail,
      total:     health.total,
      status:    health.disabled ? 'circuit_open' : 'healthy',
      threshold: `${Math.round(parseFloat(process.env.CIRCUIT_BREAKER_THRESHOLD || '0.5') * 100)}%`,
    };
  });

  app.post('/api/admin/providers/refresh', async (request, reply) => {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore operation timed out')), ms));
    try {
      const db = getDb();
      const snapshot = await Promise.race([db.collection('providers').get(), timeout(10000)]);
      const providers = [];
      snapshot.forEach(doc => providers.push(doc.data()));

      await Promise.all([
        del('providers:list'),
        del('search:providers:list')
      ]);

      // Refresh Search Providers from Firestore
      const searchSnapshot = await Promise.race([db.collection('search_providers').get(), timeout(10000)]);
      const searchProviders = [];
      searchSnapshot.forEach(doc => searchProviders.push(doc.data()));

      await Promise.all(searchProviders.map(async (sp) => {
        if (!sp.name) return;
        await resetSearchProviderKeys(sp.name);
        if (sp.status === 'inactive') {
          await disableSearchProvider(sp.name, 3600 * 24);
        }
      }));

      await Promise.all(providers.map(async (provider) => {
        if (!provider.name) return;
        await Promise.all([
          resetProviderKeys(provider.name),
          resetProviderCircuitBreaker(provider.name)
        ]);
        if (provider.status === 'inactive') {
          await disableProvider(provider.name, 3600 * 24);
        }
      }));

      const keysSnapshot = await Promise.race([db.collection('api_keys').get(), timeout(10000)]);
      const keysByProvider = {};
      const disabledKeys = [];
      const metadataPromises = [];

      keysSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.provider && data.key) {
          if (!keysByProvider[data.provider]) keysByProvider[data.provider] = [];
          keysByProvider[data.provider].push(data.key);
          if (data.is_disabled) {
            disabledKeys.push({ provider: data.provider, key: data.key });
          }
          if (data.metadata) {
            metadataPromises.push(setKeyMetadata(data.provider, data.key, data.metadata));
          }
        }
      });

      await Promise.all([
        ...Object.entries(keysByProvider).map(([pName, pKeys]) => registerKeys(pName, pKeys)),
        ...disabledKeys.map(dk => disableKey(dk.provider, dk.key, 31536000)),
        ...metadataPromises
      ]);

      // Sync Search API Keys
      const searchKeysSnapshot = await Promise.race([db.collection('search_api_keys').get(), timeout(10000)]);
      const searchKeysByProvider = {};
      const disabledSearchKeys = [];
      const searchMetadataPromises = [];

      searchKeysSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.provider && data.key) {
          if (!searchKeysByProvider[data.provider]) searchKeysByProvider[data.provider] = [];
          searchKeysByProvider[data.provider].push(data.key);
          if (data.is_disabled) {
            disabledSearchKeys.push({ provider: data.provider, key: data.key });
          }
          if (data.metadata) {
            searchMetadataPromises.push(setSearchKeyMetadata(data.provider, data.key, data.metadata));
          }
        }
      });

      await Promise.all([
        ...Object.entries(searchKeysByProvider).map(([pName, pKeys]) => registerSearchKeys(pName, pKeys)),
        ...disabledSearchKeys.map(dk => disableSearchKey(dk.provider, dk.key, 31536000)),
        ...searchMetadataPromises
      ]);

      invalidateAdapterCache('all');

      return {
        success: true,
        providersRefreshed: providers.length + searchProviders.length,
        keysReloaded: Object.values(keysByProvider).reduce((sum, ks) => sum + ks.length, 0) + 
                      Object.values(searchKeysByProvider).reduce((sum, ks) => sum + ks.length, 0),
        adaptersInvalidated: true,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      reply.code(500).send({ error: 'Provider refresh failed', message: err.message });
    }
  });

  // ─── API Keys ─────────────────────────────────────────────────────────
  app.get('/api/admin/keys/:provider', async (request) => {
    const { provider } = request.params;
    const keysList     = await zrange(`provider:${provider}:keys`, 0, -1, true);

    const keyPromises = [];
    for (let i = 0; i < keysList.length; i += 2) {
      const key   = keysList[i];
      const usage = parseInt(keysList[i+1], 10);
      keyPromises.push((async () => {
        const today = new Date().toISOString().slice(0, 10);
        const [disabled, rpmRaw, tokensIn, tokensOut, metadata] = await Promise.all([
          isKeyDisabled(provider, key),
          get(`rpm:${provider}:${key}`),
          get(`stats:${today}:key:${provider}:${key}:tokens:input`),
          get(`stats:${today}:key:${provider}:${key}:tokens:output`),
          getKeyMetadata(provider, key)
        ]);
        return {
          key: maskKey(key),
          usage,
          rpm: parseInt(rpmRaw || '0', 10),
          tokensIn: parseInt(tokensIn || '0', 10),
          tokensOut: parseInt(tokensOut || '0', 10),
          disabled,
          metadata: metadata || {},
        };
      })());
    }
    return { provider, keys: await Promise.all(keyPromises) };
  });

  app.get('/api/admin/keys/:provider/status', async (request) => {
    const { provider } = request.params;
    const [keysList, allProviders] = await Promise.all([
      zrange(`provider:${provider}:keys`, 0, -1, true),
      getProviders()
    ]);
    const rpmLimit = allProviders.find(p => p.name === provider)?.rpmLimit || 30;

    const keyPromises = [];
    for (let i = 0; i < keysList.length; i += 2) {
      const key = keysList[i];
      const usage = parseInt(keysList[i+1], 10);
      keyPromises.push((async () => {
        const today = new Date().toISOString().slice(0, 10);
        const [disabled, rpmRaw, tokensIn, tokensOut] = await Promise.all([
          isKeyDisabled(provider, key),
          get(`rpm:${provider}:${key}`),
          get(`stats:${today}:key:${provider}:${key}:tokens:input`),
          get(`stats:${today}:key:${provider}:${key}:tokens:output`)
        ]);
        const rpm = parseInt(rpmRaw || '0', 10);
        return {
          key: maskKey(key),
          usage,
          rpm,
          rpmLimit,
          rpmAvailable: rpmLimit - rpm,
          tokensIn: parseInt(tokensIn || '0', 10),
          tokensOut: parseInt(tokensOut || '0', 10),
          disabled,
          status: disabled ? 'disabled' : rpm >= rpmLimit ? 'rpm_exceeded' : 'available',
        };
      })());
    }

    const result = await Promise.all(keyPromises);
    return {
      provider,
      keys: result,
      total: result.length,
      available: result.filter(k => k.status === 'available').length,
      disabled: result.filter(k => k.status === 'disabled').length,
      rpmExceeded: result.filter(k => k.status === 'rpm_exceeded').length,
    };
  });

  app.get('/api/admin/rpm/:provider', async (request) => {
    const { provider } = request.params;
    const [keysList, allProviders] = await Promise.all([
      zrange(`provider:${provider}:keys`, 0, -1),
      getProviders()
    ]);
    const rpmLimit = allProviders.find(p => p.name === provider)?.rpmLimit || 30;

    const result = await Promise.all(keysList.map(async (key) => {
      const rpmRaw = await get(`rpm:${provider}:${key}`);
      const rpm = parseInt(rpmRaw || '0', 10);
      return {
        key: maskKey(key),
        rpm,
        rpmLimit,
        exceeded: rpm >= rpmLimit,
      };
    }));

    return {
      provider,
      rpmLimit,
      keys: result,
      totalKeys: result.length,
      keysAvailable: result.filter(k => !k.exceeded).length,
    };
  });

  app.post('/api/admin/keys/:provider', async (request, reply) => {
    const { provider } = request.params;
    const { key, metadata } = request.body;
    if (!key) return reply.code(400).send({ error: 'key is required' });

    await registerKeys(provider, [key]);
    if (metadata) await setKeyMetadata(provider, key, metadata);

    try {
      await getDb().collection('api_keys').add({
        provider,
        key,
        metadata: metadata || {},
        usage_today: 0,
        tokens_today: 0,
        created_at: new Date().toISOString(),
      });
    } catch {}
    return { success: true, provider };
  });

  app.delete('/api/admin/keys/:provider/:key', async (request) => {
    const { provider, key } = request.params;
    await zrem(`provider:${provider}:keys`, key);
    try {
      const db = getDb();
      const snapshot = await db.collection('api_keys').where('provider', '==', provider).where('key', '==', key).limit(1).get();
      if (!snapshot.empty) await snapshot.docs[0].ref.delete();
    } catch {}
    return { success: true, provider };
  });

  app.post('/api/admin/keys/:provider/:key/toggle', async (request) => {
    const { provider, key } = request.params;
    const { disabled } = request.body || {};
    try {
      const db = getDb();
      const snapshot = await db.collection('api_keys').where('provider', '==', provider).where('key', '==', key).limit(1).get();
      if (!snapshot.empty) await snapshot.docs[0].ref.update({ is_disabled: disabled });
      if (disabled) {
        await disableKey(provider, key, 31536000);
      } else {
        await del(`key:disabled:${provider}:${key}`);
      }
      return { success: true, provider, key: maskKey(key), disabled };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Logs ─────────────────────────────────────────────────────────────
  app.get('/api/admin/logs', async (request) => {
    const { limit = 50, provider, status, cursor } = request.query;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
    try {
      const db = getDb();
      let query = db.collection('logs').orderBy('timestamp', 'desc').limit(limitNum);
      if (provider) query = query.where('provider', '==', provider);
      if (status) query = query.where('status', '==', status);
      if (cursor) {
        const cursorDoc = await db.collection('logs').doc(cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }
      const snapshot = await query.get();
      const logs = [];
      snapshot.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));
      const nextCursor = logs.length === limitNum ? logs[logs.length - 1]?.id : null;
      return { logs, count: logs.length, next_cursor: nextCursor, has_more: !!nextCursor };
    } catch (err) {
      return { logs: [], count: 0, error: err.message };
    }
  });

  app.post('/api/admin/logs/flush', async () => {
    await flushLogs();
    return { success: true };
  });

  // ─── Stats ────────────────────────────────────────────────────────────
  app.get('/api/admin/stats', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const statsKeys = await keys(`stats:${today}:*`);
    if (statsKeys.length === 0) return { date: today, stats: {} };
    const values = await mget(statsKeys);
    const stats = {};
    statsKeys.forEach((key, i) => {
      const statName = key.replace(`stats:${today}:`, '');
      stats[statName] = parseInt(values[i], 10) || 0;
    });
    return { date: today, stats };
  });

  app.get('/api/admin/stats/history', async (request) => {
    const { days = 7, startDate, endDate, provider, format } = request.query;
    let limit = Math.min(parseInt(days, 10) || 7, 90);
    
    let start, end;
    
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
      limit = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    } else {
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - limit);
    }

    try {
      const snapshot = await getDb().collection('daily_stats')
        .where('date', '>=', start.toISOString().slice(0, 10))
        .where('date', '<=', end.toISOString().slice(0, 10))
        .orderBy('date', 'asc')
        .limit(limit)
        .get();
      
      const history = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        
        if (format === 'simple') {
          let tokensIn = 0, tokensOut = 0, tokensTotal = 0;
          
          if (provider && provider !== 'all') {
            const inKey = `tokens:input:${provider}`;
            const outKey = `tokens:output:${provider}`;
            tokensIn = data[inKey] || 0;
            tokensOut = data[outKey] || 0;
          } else {
            tokensIn = data['tokens:input:total'] || 0;
            tokensOut = data['tokens:output:total'] || 0;
          }
          
          tokensTotal = tokensIn + tokensOut;
          
          history.push({
            id: doc.id,
            date: data.date,
            tokensIn,
            tokensOut,
            tokensTotal,
            requests: data['requests:total'] || 0,
          });
        } else {
          history.push({ id: doc.id, ...data });
        }
      });
      
      return { history, count: history.length };
    } catch (err) {
      return { history: [], count: 0, error: err.message };
    }
  });

  app.post('/api/admin/stats/aggregate', async () => {
    const result = await aggregateDaily();
    return { success: true, stats: result };
  });

  app.get('/api/admin/keys/:provider/history', async (request) => {
    const { provider } = request.params;
    const { days = 7 } = request.query;
    const daysNum = Math.min(parseInt(days, 10) || 7, 30);
    
    try {
      const history = await getKeyStatsHistory(provider, daysNum);
      return { 
        success: true, 
        provider, 
        history 
      };
    } catch (err) {
      return { success: false, error: err.message, history: [] };
    }
  });

  app.post('/api/admin/clear-cache', async (request, reply) => {
    try {
      const allKeys = await keys('*');
      if (allKeys.length === 0) return { success: true, message: 'Cache already empty' };
      const p = getClient().pipeline();
      allKeys.forEach(k => p.del(k));
      await p.exec();
      return { success: true, message: `Cleared ${allKeys.length} cached entries` };
    } catch (err) {
      reply.code(500).send({ success: false, error: 'Cache clearing failed', message: err.message });
    }
  });

  // ─── Settings ─────────────────────────────────────────────────────────
  app.post('/api/admin/seed-providers', async () => {
    const db = getDb();
    const staticProviderNames = STATIC_PROVIDERS.map(p => p.name);
    try {
      const snapshot = await db.collection('providers').get();
      const existingProviders = new Map();
      snapshot.docs.forEach(doc => existingProviders.set(doc.id, doc.data()));

      const batch = db.batch();
      let seeded = 0;
      let preserved = 0;
      let added = 0;

      for (const staticP of STATIC_PROVIDERS) {
        const existing = existingProviders.get(staticP.name);
        
        if (existing) {
          // Preserve existing values while adding new fields from static config
          batch.set(db.collection('providers').doc(staticP.name), {
            // Preserve all existing fields
            ...existing,
            // Add/update fields that don't exist in existing (like new reasoning features)
            priority: existing.priority ?? staticP.priority,
            weight: existing.weight ?? staticP.weight,
            status: existing.status ?? staticP.status,
            endpoint: existing.endpoint ?? staticP.endpoint,
            rpmLimit: existing.rpmLimit ?? staticP.rpmLimit,
            features: existing.features ?? staticP.features,
            // Keep existing models if any - don't overwrite custom model lists
            models: existing.models && existing.models.length > 0 
              ? existing.models 
              : staticP.models,
            // Add new reasoning fields if not present
            supports_reasoning: existing.supports_reasoning ?? staticP.supports_reasoning ?? false,
            reasoning_effort_default: existing.reasoning_effort_default ?? staticP.reasoning_effort_default ?? 'medium',
            thinking_budget_default: existing.thinking_budget_default ?? staticP.thinking_budget_default ?? 0,
          }, { merge: true });
          preserved++;
        } else {
          // New provider - use static config
          batch.set(db.collection('providers').doc(staticP.name), staticP, { merge: true });
          added++;
        }
        seeded++;
      }

      // Handle providers that exist in DB but not in static config - keep them but don't delete
      // This preserves custom providers user may have added

      await batch.commit();
      await del('providers:list');
      return { 
        success: true, 
        seeded, 
        added,
        preserved,
        message: `${added} new providers added, ${preserved} existing providers preserved (models & settings kept)`
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  app.delete('/api/admin/providers/:name', async (request) => {
    const { name } = request.params;
    const db = getDb();
    const docRef = db.collection('providers').doc(name);
    const doc = await docRef.get();
    if (!doc.exists) throw new Error(`Provider ${name} not found`);
    await docRef.delete();
    const keysSnapshot = await db.collection('api_keys').where('provider', '==', name).get();
    if (!keysSnapshot.empty) {
      const batch = db.batch();
      keysSnapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await del('providers:list');
    return { success: true, message: `Provider ${name} deleted` };
  });

  app.post('/api/admin/providers', async (request) => {
    const { name, type, endpoint, apiKey, models, priority, weight } = request.body;
    if (!name || !endpoint) throw new Error('Name and endpoint required');
    const providerData = { name, type, endpoint, priority: priority || 50, weight: weight || 10, status: 'active', models: models || [], rpmLimit: 50, isCustom: true };
    await getDb().collection('providers').doc(name).set(providerData, { merge: true });
    if (apiKey) {
      await getDb().collection('api_keys').add({ provider: name, key: apiKey, is_disabled: false, created_at: new Date(), metadata: { isCustomProvider: true } });
    }
    await del('providers:list');
    return { success: true, provider: providerData };
  });

  app.post('/api/admin/providers/fetch-models', async (request, reply) => {
    try {
      const { providerName } = request.body;
      const db = getDb();
      const providerDoc = await db.collection('providers').doc(providerName).get();
      let provider = providerDoc.exists ? providerDoc.data() : STATIC_PROVIDERS.find(p => p.name === providerName);
      if (!provider) throw new Error(`Provider ${providerName} not found`);

      const isLocal = provider.type === 'local_http' || provider.authMethod === 'none';
      let apiKey;
      if (!isLocal) {
        const keysSnapshot = await db.collection('api_keys').where('provider', '==', providerName).where('is_disabled', '!=', true).limit(1).get();
        apiKey = keysSnapshot.empty ? (await db.collection('api_keys').where('provider', '==', providerName).limit(1).get()).docs[0]?.data()?.key : keysSnapshot.docs[0].data().key;
        if (!apiKey) throw new Error(`No API key for ${providerName}`);
      }

      const HARDCODED = {
        'anthropic': ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
        'minimax': ['abab7-chat', 'abab6.5-chat', 'abab6.5s-chat'],
        'xiaomi': ['mimo-v2-pro', 'mimo-v2-flash', 'mimo-v2-omni'],
        'cloudflare': ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct'],
        'vertex': ['gemini-1.5-pro', 'gemini-1.5-flash']
      };

      if (HARDCODED[providerName] && !['cloudflare', 'vertex'].includes(providerName)) {
        return { success: true, provider: providerName, models: HARDCODED[providerName], count: HARDCODED[providerName].length };
      }

      let modelsUrl = provider.endpoint || '';
      if (providerName === 'google') modelsUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
      else if (providerName === 'huggingface') modelsUrl = 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=50&filter=text-generation';
      else if (providerName === 'ollama-cloud') modelsUrl = 'https://ollama.com/api/tags';
      else if (modelsUrl.includes('/chat/completions')) modelsUrl = modelsUrl.replace('/chat/completions', '/models');

      if (!modelsUrl && providerName !== 'ollama_local_bridge') throw new Error(`URL mystery for ${providerName}`);

      let data;
      if (providerName === 'ollama_local_bridge') {
        const daemonUrl = provider.endpoint || 'http://localhost:5059';
        const res = await fetch(daemonUrl.replace(/\/$/, '') + '/models', { headers: process.env.LOCAL_DAEMON_TOKEN ? { 'X-Local-Token': process.env.LOCAL_DAEMON_TOKEN } : {}, signal: AbortSignal.timeout(8000) });
        data = await res.json();
        return { success: true, provider: providerName, models: data.models?.map(m => m.name).filter(Boolean).sort() || [], count: data.models?.length || 0 };
      }

      const res = await fetch(providerName === 'google' ? `${modelsUrl}?key=${apiKey}` : modelsUrl, { headers: (providerName === 'google' || providerName === 'huggingface') ? {} : { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) });
      data = await res.json();
      
      let ids = [];
      if (Array.isArray(data.result)) ids = data.result.map(m => m.name || m.id).filter(id => id.startsWith('@cf/'));
      else if (Array.isArray(data.data)) ids = data.data.map(m => m.id || m.name);
      else if (Array.isArray(data.models)) ids = data.models.map(m => (m.name || m.id || '').split('/').pop()).filter(id => id && id.length > 2);
      else if (Array.isArray(data) && providerName === 'huggingface') ids = data.map(m => m.id);

      return { success: true, provider: providerName, models: ids.sort(), count: ids.length };
    } catch (err) {
      return reply.code(400).send({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEARCH PROVIDERS (mirrors LLM provider management)
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/api/admin/search-providers', async () => {
    try {
      const { getSearchProviders } = await import('../config/searchProviders.js');
      const { getSearchProviderHealth } = await import('../services/searchRouterService.js');
      const allProviders = await getSearchProviders();

      const providerPromises = allProviders.map(async (p) => {
        try {
          const health = await getSearchProviderHealth(p.name);
          const keysList = await zrange(`search:${p.name}:keys`, 0, -1, true);
          const keyCount = (keysList?.length || 0) / 2;
          const isEffectiveDisabled = p.status !== 'active';

          return {
            ...p,
            disabled: isEffectiveDisabled,
            errorRate: Math.round(health.errorRate * 100),
            success: health.success,
            fail: health.fail,
            total: health.total,
            keyCount,
          };
        } catch (err) {
          return {
            ...p,
            disabled: true,
            keyCount: 0,
            error: err.message,
          };
        }
      });

      const result = await Promise.all(providerPromises);
      return { success: true, providers: result };
    } catch (err) {
      return { success: false, error: err.message, providers: [] };
    }
  });

  app.put('/api/admin/search-providers/:name', async (request, reply) => {
    const { name } = request.params;
    const updates = request.body;

    try {
      const db = getDb();
      const providerRef = db.collection('search_providers').doc(name);
      await providerRef.set({ name, ...updates }, { merge: true });
      await del('search:providers:list');
      return { success: true, provider: name };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  app.post('/api/admin/search-providers/:name/toggle', async (request) => {
    const { name } = request.params;
    const { disabled, ttl } = request.body || {};
    const newStatus = disabled ? 'inactive' : 'active';

    try {
      const db = getDb();
      await db.collection('search_providers').doc(name).set({ status: newStatus }, { merge: true });
      await del('search:providers:list');
      if (disabled) {
        const { disableSearchProvider } = await import('../services/searchRouterService.js');
        await disableSearchProvider(name, ttl || 3600);
      } else {
        await del(`search:provider:disabled:${name}`);
      }
      return { success: true, provider: name, status: newStatus };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  app.get('/api/admin/search-providers/:name/health', async (request) => {
    const { name } = request.params;
    const { getSearchProviderHealth } = await import('../services/searchRouterService.js');
    const health = await getSearchProviderHealth(name);
    return {
      provider: name,
      errorRate: Math.round(health.errorRate * 100),
      success: health.success,
      fail: health.fail,
      total: health.total,
    };
  });

  app.post('/api/admin/search-providers/seed', async () => {
    try {
      const { STATIC_SEARCH_PROVIDERS } = await import('../config/searchProviders.js');
      const db = getDb();

      for (const provider of STATIC_SEARCH_PROVIDERS) {
        await db.collection('search_providers').doc(provider.name).set(provider, { merge: true });
      }

      await del('search:providers:list');
      return { success: true, providersSeeded: STATIC_SEARCH_PROVIDERS.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEARCH API KEYS (mirrors LLM key management)
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/api/admin/search-keys/:provider', async (request) => {
    const { provider } = request.params;
    const keysList = await zrange(`search:${provider}:keys`, 0, -1, true);

    const keyPromises = [];
    for (let i = 0; i < keysList.length; i += 2) {
      const key = keysList[i];
      const usage = parseInt(keysList[i + 1], 10);
      keyPromises.push((async () => {
        const [disabled, rpmRaw, metadata] = await Promise.all([
          isSearchKeyDisabled(provider, key),
          get(`search:rpm:${provider}:${key}`),
          getSearchKeyMetadata(provider, key),
        ]);
        return {
          key: maskKey(key),
          fullKey: key,
          usage,
          rpm: parseInt(rpmRaw || '0', 10),
          disabled,
          metadata: metadata || {},
        };
      })());
    }
    return { provider, keys: await Promise.all(keyPromises) };
  });

  app.post('/api/admin/search-keys/:provider', async (request, reply) => {
    const { provider } = request.params;
    const { key, metadata } = request.body;
    if (!key) return reply.code(400).send({ error: 'key is required' });

    await registerSearchKeys(provider, [key]);
    if (metadata) await setSearchKeyMetadata(provider, key, metadata);

    try {
      await getDb().collection('search_api_keys').add({
        provider,
        key,
        metadata: metadata || {},
        usage_today: 0,
        created_at: new Date().toISOString(),
      });
    } catch {}
    return { success: true, provider };
  });

  app.delete('/api/admin/search-keys/:provider/:key', async (request) => {
    const { provider, key } = request.params;
    await zrem(`search:${provider}:keys`, key);
    try {
      const db = getDb();
      const snapshot = await db.collection('search_api_keys').where('provider', '==', provider).where('key', '==', key).limit(1).get();
      if (!snapshot.empty) await snapshot.docs[0].ref.delete();
    } catch {}
    return { success: true, provider };
  });

  app.post('/api/admin/search-keys/:provider/:key/toggle', async (request) => {
    const { provider, key } = request.params;
    const { disabled } = request.body || {};
    try {
      const db = getDb();
      const snapshot = await db.collection('search_api_keys').where('provider', '==', provider).where('key', '==', key).limit(1).get();
      if (!snapshot.empty) await snapshot.docs[0].ref.update({ is_disabled: disabled });
      if (disabled) {
        await disableSearchKey(provider, key, 31536000);
      } else {
        await del(`search:key:disabled:${provider}:${key}`);
      }
      return { success: true, provider, key: maskKey(key), disabled };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
