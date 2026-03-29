import { getDb } from '../config/firestore.js';
import { getClient, get, keys, del, zadd, zrange } from '../config/redis.js';
import { getProviders, STATIC_PROVIDERS } from '../config/providers.js';
import {
  getActiveProviders,
  isProviderDisabled,
  disableProvider,
  getErrorRate,
  getProviderHealth,
  resetProviderCircuitBreaker,
} from '../services/providerService.js';
import { registerKeys, isKeyDisabled, disableKey, resetProviderKeys } from '../services/keyService.js';
import { getStats, aggregateDaily } from '../services/statsService.js';
import { flushLogs } from '../services/loggingService.js';
import { createRateLimiter } from '../utils/rateLimiter.js';

// Rate limiter for admin endpoints: 10 requests per minute per IP
const adminRateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 10,
  keyPrefix: 'ratelimit:admin:',
});

/**
 * Admin API routes.
 * All routes are under /api/admin/*
 *
 * Added routes (new):
 *   POST /api/admin/providers/refresh         — reload from Firestore → Redis
 *   GET  /api/admin/providers/:name/health    — per-provider circuit breaker health
 *   GET  /api/admin/keys/:provider/status     — all keys: usage, rpm, disabled
 *   GET  /api/admin/rpm/:provider             — current RPM counters per key
 *   GET  /api/admin/logs                      — with pagination (cursor support)
 */
export async function adminRoutes(app) {
  // Apply rate limiting to all admin routes
  app.addHook('onRequest', adminRateLimiter);

  // ─── System Health ────────────────────────────────────────────────────
  app.get('/api/admin/health', async () => {
    let redisOk = false;
    let firestoreOk = false;
    let firestoreError = null;

    try { await getClient().ping(); redisOk = true; } catch {}
    
    try {
      const { testFirestoreConnectivity, isMockDb } = await import('../config/firestore.js');
      const result = await testFirestoreConnectivity();
      firestoreOk = result.connected;
      firestoreError = result.error;
    } catch (err) {
      firestoreOk = false;
      firestoreError = err.message;
    }

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
    const stats        = await getStats();
    const providers    = await getActiveProviders();
    const allProviders = await getProviders();

    const providerHealth = [];
    for (const p of allProviders) {
      const health = await getProviderHealth(p.name);
      providerHealth.push({
        name:      p.name,
        status:    health.disabled ? 'disabled' : 'active',
        errorRate: Math.round(health.errorRate * 100),
        success:   health.success,
        fail:      health.fail,
        total:     health.total,
        models:    p.models,
        priority:  p.priority,
        weight:    p.weight,
      });
    }

    return {
      stats,
      activeProviders: providers.length,
      totalProviders:  allProviders.length,
      providerHealth,
    };
  });

  // ─── Providers ────────────────────────────────────────────────────────

  // List all providers with key counts and health
  app.get('/api/admin/providers', async () => {
    const allProviders = await getProviders();
    const result = [];

    for (const p of allProviders) {
      const health   = await getProviderHealth(p.name);
      const keysList = await zrange(`provider:${p.name}:keys`, 0, -1, true);
      const keyCount = keysList.length / 2; // WITHSCORES returns pairs

      result.push({
        ...p,
        disabled:  health.disabled,
        errorRate: Math.round(health.errorRate * 100),
        success:   health.success,
        fail:      health.fail,
        keyCount,
      });
    }

    return { providers: result };
  });

  // Update provider in Firestore
  app.put('/api/admin/providers/:name', async (request, reply) => {
    const { name }  = request.params;
    const updates   = request.body;

    try {
      const db          = getDb();
      const providerRef = db.collection('providers').doc(name);
      const doc         = await providerRef.get();

      if (doc.exists) {
        await providerRef.update(updates);
      } else {
        await providerRef.set({ name, ...updates }, { merge: true });
      }

      await del('providers:list'); // Invalidate provider list cache
      
      // Also invalidate router adapter cache so the routing engine sees the new models
      const { invalidateAdapterCache } = await import('../services/routerService.js');
      invalidateAdapterCache(name);

      return { success: true, provider: name };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // Disable/enable a provider manually
  app.post('/api/admin/providers/:name/toggle', async (request) => {
    const { name }          = request.params;
    const { disabled, ttl } = request.body || {};
    const newStatus         = disabled ? 'inactive' : 'active';

    try {
      const db = getDb();
      const providerRef = db.collection('providers').doc(name);
      const doc = await providerRef.get();

      if (doc.exists) {
        await providerRef.update({ status: newStatus });
      } else {
        await providerRef.set({ name, status: newStatus });
      }

      await del('providers:list'); // Invalidate cache

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

  // ┌─────────────────────────────────────────────────────────────────────
  // │ NEW: Provider health inspection
  // └─────────────────────────────────────────────────────────────────────
  app.get('/api/admin/providers/:name/health', async (request, reply) => {
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

  // ┌─────────────────────────────────────────────────────────────────────
  // │ NEW: Provider pool refresh — reload Firestore → Redis
  // │
  // │ This endpoint:
  // │  1. Reads all providers from Firestore
  // │  2. Invalidates the Redis providers:list cache
  // │  3. Reloads API keys from Firestore api_keys collection
  // │  4. Resets all key scores to 0 (usage counter reset)
  // │  5. Clears key disabled flags + key failure counters
  // │  6. Resets provider-level circuit breaker flags + health counters
  // └─────────────────────────────────────────────────────────────────────
  app.post('/api/admin/providers/refresh', async (request, reply) => {
    try {
      const db = getDb();

      // 1. Fetch all providers from Firestore
      const snapshot = await db.collection('providers').get();
      const providers = [];
      snapshot.forEach(doc => providers.push(doc.data()));

      // 2. Invalidate Redis providers cache
      await del('providers:list');

      // 3. For each provider: reset keys + circuit breaker
      for (const provider of providers) {
        if (!provider.name) continue;

        // Reset key scores to 0, clear disabled/fail/rpm flags
        await resetProviderKeys(provider.name);

        // Reset circuit breaker counters and disabled flag
        await resetProviderCircuitBreaker(provider.name);
      }

      // 4. Reload API keys from Firestore into Redis sorted sets
      const keysSnapshot = await db.collection('api_keys').get();
      const keysByProvider = {};
      const disabledKeys = [];

      keysSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.provider && data.key) {
          if (!keysByProvider[data.provider]) keysByProvider[data.provider] = [];
          keysByProvider[data.provider].push(data.key);

          if (data.is_disabled) {
            disabledKeys.push({ provider: data.provider, key: data.key });
          }
        }
      });

      // Register keys with NX (only add if not already in set, preserve no-score on existing)
      for (const [providerName, providerKeys] of Object.entries(keysByProvider)) {
        await registerKeys(providerName, providerKeys);
      }

      // Re-apply permanently disabled status in Redis
      for (const dk of disabledKeys) {
        await disableKey(dk.provider, dk.key, 31536000); // 1 year
      }

      // 5. Invalidate adapter cache (for endpoint URL changes)
      const { invalidateAdapterCache } = await import('../services/routerService.js');
      invalidateAdapterCache('all');

      return {
        success:           true,
        providersRefreshed: providers.length,
        keysReloaded:      Object.values(keysByProvider).reduce((sum, ks) => sum + ks.length, 0),
        adaptersInvalidated: true,
        timestamp:         new Date().toISOString(),
      };
    } catch (err) {
      reply.code(500).send({ error: 'Provider refresh failed', message: err.message });
    }
  });

  // ─── API Keys ─────────────────────────────────────────────────────────

  // List keys for a provider (masked), with usage + rpm + disabled status
  app.get('/api/admin/keys/:provider', async (request) => {
    const { provider } = request.params;
    const keysList     = await zrange(`provider:${provider}:keys`, 0, -1, true);

    const result = [];
    for (let i = 0; i < keysList.length; i += 2) {
      const key      = keysList[i];
      const usage    = parseInt(keysList[i + 1], 10);
      const disabled = await isKeyDisabled(provider, key);
      const rpmRaw   = await get(`rpm:${provider}:${key}`);
      
      const today    = new Date().toISOString().slice(0, 10);
      const tokensIn = parseInt((await get(`stats:${today}:key:${key}:tokens:input`)) || '0', 10);
      const tokensOut = parseInt((await get(`stats:${today}:key:${key}:tokens:output`)) || '0', 10);

      result.push({
        key:      maskKey(key),
        fullKey:  key,
        usage,
        rpm:      parseInt(rpmRaw || '0', 10),
        tokensIn,
        tokensOut,
        disabled,
      });
    }

    return { provider, keys: result };
  });

  // ┌─────────────────────────────────────────────────────────────────────
  // │ NEW: Key status route — detailed view per key
  // └─────────────────────────────────────────────────────────────────────
  app.get('/api/admin/keys/:provider/status', async (request) => {
    const { provider } = request.params;
    const keysList     = await zrange(`provider:${provider}:keys`, 0, -1, true);
    const rpmLimit     = (await getProviders()).find(p => p.name === provider)?.rpmLimit || 30;

    const result = [];
    for (let i = 0; i < keysList.length; i += 2) {
      const key      = keysList[i];
      const usage    = parseInt(keysList[i + 1], 10);
      const disabled = await isKeyDisabled(provider, key);
      const rpmRaw   = await get(`rpm:${provider}:${key}`);
      const rpm      = parseInt(rpmRaw || '0', 10);

      const today    = new Date().toISOString().slice(0, 10);
      const tokensIn = parseInt((await get(`stats:${today}:key:${key}:tokens:input`)) || '0', 10);
      const tokensOut = parseInt((await get(`stats:${today}:key:${key}:tokens:output`)) || '0', 10);

      result.push({
        key:          maskKey(key),
        usage,
        rpm,
        rpmLimit,
        rpmAvailable: rpmLimit - rpm,
        tokensIn,
        tokensOut,
        disabled,
        status:       disabled ? 'disabled' : rpm >= rpmLimit ? 'rpm_exceeded' : 'available',
      });
    }

    return {
      provider,
      keys:     result,
      total:    result.length,
      available: result.filter(k => k.status === 'available').length,
      disabled:  result.filter(k => k.status === 'disabled').length,
      rpmExceeded: result.filter(k => k.status === 'rpm_exceeded').length,
    };
  });

  // ┌─────────────────────────────────────────────────────────────────────
  // │ NEW: RPM monitor route
  // └─────────────────────────────────────────────────────────────────────
  app.get('/api/admin/rpm/:provider', async (request) => {
    const { provider } = request.params;
    const keysList     = await zrange(`provider:${provider}:keys`, 0, -1);
    const providers    = await getProviders();
    const rpmLimit     = providers.find(p => p.name === provider)?.rpmLimit || 30;

    const result = [];
    for (const key of keysList) {
      const rpmRaw = await get(`rpm:${provider}:${key}`);
      const rpm    = parseInt(rpmRaw || '0', 10);
      result.push({
        key:     maskKey(key),
        rpm,
        rpmLimit,
        exceeded: rpm >= rpmLimit,
      });
    }

    return {
      provider,
      rpmLimit,
      keys:    result,
      totalKeys:    result.length,
      keysAvailable: result.filter(k => !k.exceeded).length,
    };
  });

  // Add a key for a provider
  app.post('/api/admin/keys/:provider', async (request, reply) => {
    const { provider } = request.params;
    const { key }      = request.body;

    if (!key) return reply.code(400).send({ error: 'key is required' });

    await registerKeys(provider, [key]);

    try {
      const db = getDb();
      await db.collection('api_keys').add({
        provider,
        key,
        usage_today:  0,
        tokens_today: 0,
        created_at:   new Date().toISOString(),
      });
    } catch {}

    return { success: true, provider };
  });

  // Remove a key
  app.delete('/api/admin/keys/:provider/:key', async (request) => {
    const { provider, key } = request.params;

    const { zrem } = await import('../config/redis.js');
    await zrem(`provider:${provider}:keys`, key);

    try {
      const db       = getDb();
      const snapshot = await db.collection('api_keys')
        .where('provider', '==', provider)
        .where('key',      '==', key)
        .limit(1)
        .get();

      if (!snapshot.empty) await snapshot.docs[0].ref.delete();
    } catch {}

    return { success: true, provider };
  });

  // Disable/enable a key
  app.post('/api/admin/keys/:provider/:key/toggle', async (request) => {
    const { provider, key } = request.params;
    const { disabled }      = request.body || {};

    try {
      const db = getDb();
      const snapshot = await db.collection('api_keys')
        .where('provider', '==', provider)
        .where('key',      '==', key)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        await snapshot.docs[0].ref.update({ is_disabled: disabled });
      }

      if (disabled) {
        await disableKey(provider, key, 31536000); // 1 year TTL
      } else {
        await del(`key:disabled:${provider}:${key}`);
      }

      return { success: true, provider, key: maskKey(key), disabled };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Logs ─────────────────────────────────────────────────────────────

  // Get recent logs from Firestore with cursor-based pagination
  // Query params: limit, provider, status, cursor (last document ID for pagination)
  app.get('/api/admin/logs', async (request, reply) => {
    const {
      limit:    queryLimit = 50,
      provider,
      status,
      cursor, // last document ID from previous page
    } = request.query;

    const limitNum = Math.min(parseInt(queryLimit, 10) || 50, 200);

    try {
      const db = getDb();
      let query = db.collection('logs').orderBy('timestamp', 'desc').limit(limitNum);

      if (provider) query = query.where('provider', '==', provider);
      if (status)   query = query.where('status',   '==', status);

      // Cursor-based pagination: start after the last seen document
      if (cursor) {
        const cursorDoc = await db.collection('logs').doc(cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const logs     = [];
      snapshot.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));

      // next_cursor is the ID of the last document in this page
      const nextCursor = logs.length === limitNum ? logs[logs.length - 1]?.id : null;

      return {
        logs,
        count:       logs.length,
        next_cursor: nextCursor,
        has_more:    nextCursor !== null,
      };
    } catch (err) {
      return { logs: [], count: 0, error: err.message };
    }
  });

  // Flush pending logs now
  app.post('/api/admin/logs/flush', async () => {
    await flushLogs();
    return { success: true };
  });

  // ─── Stats ────────────────────────────────────────────────────────────

  app.get('/api/admin/stats', async () => {
    const today    = new Date().toISOString().slice(0, 10);
    const statsKeys = await keys(`stats:${today}:*`);

    const stats = {};
    for (const key of statsKeys) {
      const value    = await get(key);
      const statName = key.replace(`stats:${today}:`, '');
      stats[statName] = parseInt(value, 10) || 0;
    }

    return { date: today, stats };
  });

  app.get('/api/admin/stats/history', async (request) => {
    const { days = 7 } = request.query;
    const daysNum = Math.min(parseInt(days, 10) || 7, 90);

    try {
      const db       = getDb();
      const snapshot = await db.collection('daily_stats')
        .orderBy('date', 'desc')
        .limit(daysNum)
        .get();

      const history = [];
      snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));

      return { history, count: history.length };
    } catch (err) {
      return { history: [], count: 0, error: err.message };
    }
  });

  app.post('/api/admin/stats/aggregate', async () => {
    const result = await aggregateDaily();
    return { success: true, stats: result };
  });

  // ─── Settings ─────────────────────────────────────────────────────────

  // Seed static providers to Firestore
  app.post('/api/admin/seed-providers', async () => {
    const db = getDb();
    const staticProviderNames = STATIC_PROVIDERS.map(p => p.name);

    // 1. Fetch current providers from DB
    const snapshot = await db.collection('providers').get();
    const dbProviderNames = snapshot.docs.map(doc => doc.id);

    // 2. Identify and delete stale providers (in DB but not in Static)
    const toDelete = dbProviderNames.filter(name => !staticProviderNames.includes(name));
    for (const name of toDelete) {
      await db.collection('providers').doc(name).delete();
      console.log(`Deleted stale provider: ${name}`);

      // Optional: Cleanup associated API keys
      const keysSnapshot = await db.collection('api_keys').where('provider', '==', name).get();
      if (!keysSnapshot.empty) {
        const batch = db.batch();
        keysSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Cleaned up keys for provider: ${name}`);
      }
    }

    // 3. Upsert current static providers
    for (const provider of STATIC_PROVIDERS) {
      await db.collection('providers').doc(provider.name).set(provider, { merge: true });
    }

    // 4. Invalidate cache
    await del('providers:list');

    return {
      success: true,
      seeded: STATIC_PROVIDERS.length,
      deleted: toDelete.length
    };
  });

  // Fetch available models from a provider's official endpoint
  app.post('/api/admin/providers/fetch-models', async (request, reply) => {
    try {
      const { providerName } = request.body;
      if (!providerName) throw new Error('Provider name is required');

      const db = getDb();
      
      // 1. Get Provider config
      const providerDoc = await db.collection('providers').doc(providerName).get();
      let provider = providerDoc.exists ? providerDoc.data() : STATIC_PROVIDERS.find(p => p.name === providerName);
      if (!provider) throw new Error(`Provider ${providerName} not found`);

      // 2. Get API Key (get first non-disabled key)
      let apiKey;
      const keysSnapshot = await db.collection('api_keys')
        .where('provider', '==', providerName)
        .where('is_disabled', '!=', true)
        .limit(1)
        .get();
      
      if (keysSnapshot.empty) {
        // Try fallback: maybe keys don't have is_disabled field at all
        const fallbackSnapshot = await db.collection('api_keys')
          .where('provider', '==', providerName)
          .limit(1)
          .get();
          
        if (fallbackSnapshot.empty) throw new Error(`No API key found for ${providerName}`);
        apiKey = fallbackSnapshot.docs[0].data().key;
      } else {
        apiKey = keysSnapshot.docs[0].data().key;
      }

      // 3. Determine Models URL
      // Pattern: Replace /chat/completions or /messages with /models
      let modelsUrl = provider.endpoint || '';
      if (modelsUrl.includes('/chat/completions')) {
        modelsUrl = modelsUrl.replace('/chat/completions', '/models');
      } else if (modelsUrl.includes('/messages')) {
        modelsUrl = modelsUrl.replace('/messages', '/models');
      } else {
        const parts = modelsUrl.split('/');
        if (parts.length > 3) {
           parts.pop(); 
           modelsUrl = parts.join('/') + '/models';
        }
      }

      // Special cases & Hardcoded Fallbacks:
      if (providerName === 'google') modelsUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
      if (providerName === 'huggingface') {
        modelsUrl = 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=50&filter=text-generation';
      }

      // 3.5 Anthropic/Minimax/Cloudflare don't have public discovery APIs. 
      // We return their static model lists immediately.
      const HARDCODED_MODELS = {
        'anthropic': ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
        'cloudflare': ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-405b', '@cf/mistral/mistral-7b-instruct-v0.1'],
        'minimax': ['abab7-chat', 'abab6.5-chat', 'abab6.5s-chat'],
        'vertex': ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
        'xiaomi': ['mimo-v2-pro', 'mimo-v2-flash', 'mimo-v2-omni', 'MiMo-V2-Flash']
      };

      if (HARDCODED_MODELS[providerName]) {
        console.log(`Returning hardcoded models for ${providerName}`);
        return {
          success: true,
          provider: providerName,
          models: HARDCODED_MODELS[providerName],
          count: HARDCODED_MODELS[providerName].length,
          note: 'Hardcoded list (Provider does not support API discovery)'
        };
      }

      if (!modelsUrl) throw new Error(`Could not determine models list URL for ${providerName}`);
      console.log(`Harvesting models for ${providerName} from ${modelsUrl}`);

      // 4. Fetch
      const headers = { 'Authorization': `Bearer ${apiKey}` };
      // Google AI Studio uses ?key= API key
      const finalUrl = providerName === 'google' ? `${modelsUrl}?key=${apiKey}` : modelsUrl;
      if (providerName === 'google') delete headers.Authorization;
      if (providerName === 'huggingface') delete headers.Authorization;

      const response = await fetch(finalUrl, { headers });
      if (!response.ok) {
        const errText = await response.text().catch(() => 'No detail');
        throw new Error(`Provider Error (${response.status}): ${errText.substring(0, 100)}`);
      }

      const data = await response.json();
      
      // 5. Extract model IDs (standard OpenAI format is data: [{ id: "...", ... }])
      let modelIds = [];
      if (Array.isArray(data.data)) {
        modelIds = data.data.map(m => m.id || m.name);
      } else if (Array.isArray(data.models)) {
        // Handle Ollama tags format or Google format
        modelIds = data.models.map(m => (m.name || m.id).replace('models/', ''));
      } else if (Array.isArray(data) && providerName === 'huggingface') {
        modelIds = data.map(m => m.id);
      }

      return { 
        success: true, 
        provider: providerName, 
        models: modelIds.sort(),
        count: modelIds.length 
      };
    } catch (err) {
      console.error(`Harvest error for ${request.body?.providerName}:`, err.message);
      return reply.code(400).send({
        success: false,
        error:   err.message,
        hint:    'Verify your API key is correct and valid for this provider.'
      });
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function maskKey(key) {
  if (!key || key.length < 10) return '***';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
