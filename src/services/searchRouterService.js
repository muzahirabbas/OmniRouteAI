import { getSearchProviders } from '../config/searchProviders.js';
import { get, setex, incrWithTTL } from '../config/redis.js';
import {
  getLeastUsedSearchKey,
  getLeastUsedSearchKeyExcluding,
  recordSearchKeyFailure,
  getSearchKeyMetadata,
} from './searchKeyService.js';
import { getCached, setCached } from './cacheService.js';
import { trackSearchRequest, trackSearchError } from './statsService.js';
import { logRequest } from './loggingService.js';

const SEARCH_CACHE_TTL = parseInt(process.env.SEARCH_CACHE_TTL, 10) || 1800; // 30 min default

const SEARCH_CIRCUIT_BREAKER_THRESHOLD = parseFloat(process.env.SEARCH_CIRCUIT_BREAKER_THRESHOLD) || 0.5;
const SEARCH_CIRCUIT_BREAKER_TTL = parseInt(process.env.SEARCH_CIRCUIT_BREAKER_TTL, 10) || 300;
const MIN_SAMPLES = 5;

const adapterCache = {};

function standardizeSearchResult(adapterResult, providerName, query) {
  const { results, answer, tokens } = adapterResult;

  return {
    results: (results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.snippet || r.content || r.description || r.text || '',
      score: typeof r.score === 'number' ? r.score : 0,
    })),
    answer: answer || '',
    query,
    provider: providerName,
    tokens: tokens || { input: 0, output: 0 },
  };
}

export async function getSearchAdapter(providerName) {
  if (adapterCache[providerName]) return adapterCache[providerName];

  let adapter;
  switch (providerName) {
    case 'tavily': {
      const mod = await import('../adapters/tavilyAdapter.js');
      adapter = new mod.TavilyAdapter();
      break;
    }
    case 'brave': {
      const mod = await import('../adapters/braveSearchAdapter.js');
      adapter = new mod.BraveSearchAdapter();
      break;
    }
    case 'serper': {
      const mod = await import('../adapters/serperAdapter.js');
      adapter = new mod.SerperAdapter();
      break;
    }
    case 'exa': {
      const mod = await import('../adapters/exaAdapter.js');
      adapter = new mod.ExaAdapter();
      break;
    }
    case 'firecrawl': {
      const mod = await import('../adapters/firecrawlAdapter.js');
      adapter = new mod.FirecrawlAdapter();
      break;
    }
    case 'duckduckgo': {
      const mod = await import('../adapters/duckduckgoAdapter.js');
      adapter = new mod.DuckDuckGoAdapter();
      break;
    }
    case 'searchapi': {
      const mod = await import('../adapters/searchapiAdapter.js');
      adapter = new mod.SearchApiAdapter();
      break;
    }
    case 'google-pse': {
      const mod = await import('../adapters/googlePseAdapter.js');
      adapter = new mod.GooglePSEAdapter();
      break;
    }
    default:
      throw new Error(`No adapter found for search provider: ${providerName}`);
  }

  adapterCache[providerName] = adapter;
  return adapter;
}

export async function getActiveSearchProviders() {
  const allProviders = await getSearchProviders();

  const activeResults = await Promise.all(
    allProviders.map(async (p) => {
      if (p.status !== 'active') return null;
      const disabled = await isSearchProviderDisabled(p.name);
      return disabled ? null : p;
    })
  );

  const active = activeResults.filter(p => p !== null);

  if (active.length === 0) return [];

  const tiers = {};
  for (const provider of active) {
    const p = provider.priority ?? 99;
    if (!tiers[p]) tiers[p] = [];
    tiers[p].push(provider);
  }

  const result = [];
  const sortedPriorities = Object.keys(tiers).map(Number).sort((a, b) => a - b);

  for (const priority of sortedPriorities) {
    const tierProviders = tiers[priority];
    const ordered = weightedShuffle(tierProviders);
    result.push(...ordered);
  }

  return result;
}

function weightedShuffle(providers) {
  if (providers.length === 0) return [];
  if (providers.length === 1) return [...providers];

  const result = [];
  const remaining = [...providers];
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, p) => sum + (p.weight || 1), 0);
    let rand = Math.random() * totalWeight;

    let selectedIdx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      rand -= (remaining[i].weight || 1);
      if (rand <= 0) {
        selectedIdx = i;
        break;
      }
    }

    result.push(remaining[selectedIdx]);
    remaining.splice(selectedIdx, 1);
  }

  return result;
}

export async function disableSearchProvider(name, ttl = SEARCH_CIRCUIT_BREAKER_TTL) {
  await setex(`search:provider:disabled:${name}`, ttl, '1');
}

export async function isSearchProviderDisabled(name) {
  const val = await get(`search:provider:disabled:${name}`);
  return val !== null;
}

export async function recordSearchProviderResult(name, success) {
  const successKey = `search:provider:${name}:success`;
  const failKey = `search:provider:${name}:fail`;

  if (success) {
    await incrWithTTL(successKey, SEARCH_CIRCUIT_BREAKER_TTL);
  } else {
    await incrWithTTL(failKey, SEARCH_CIRCUIT_BREAKER_TTL);
  }

  if (success) return;

  try {
    const sVal = await get(successKey);
    const fVal = await get(failKey);
    const successCount = sVal ? parseInt(sVal, 10) : 0;
    const failCount = fVal ? parseInt(fVal, 10) : 0;
    const total = successCount + failCount;

    if (total >= MIN_SAMPLES) {
      const errorRate = failCount / total;
      if (errorRate >= SEARCH_CIRCUIT_BREAKER_THRESHOLD) {
        await disableSearchProvider(name);
      }
    }
  } catch (err) {
    console.warn('Failed to check search circuit breaker:', err.message);
  }
}

export async function getSearchProviderHealth(name) {
  const successKey = `search:provider:${name}:success`;
  const failKey = `search:provider:${name}:fail`;

  const sVal = await get(successKey);
  const fVal = await get(failKey);

  const success = sVal ? parseInt(sVal, 10) : 0;
  const fail = fVal ? parseInt(fVal, 10) : 0;
  const total = success + fail;

  return {
    success,
    fail,
    total,
    errorRate: total > 0 ? fail / total : 0,
  };
}

export async function routeSearch(query, opts = {}) {
  const excludeProviders = opts.excludeProviders || [];
  const excludeKeys = opts.excludeKeys || [];
  const providerOverride = opts.provider;

  const activeProviders = await getActiveSearchProviders();

  let searchList;
  if (providerOverride) {
    const target = activeProviders.find(p => p.name === providerOverride);
    searchList = target ? [target] : [];
  } else {
    searchList = [...activeProviders];
  }

  for (const provider of searchList) {
    if (excludeProviders.includes(provider.name)) continue;

    let apiKey;
    if (provider.noApiKey) {
      apiKey = 'no-key-required';
    } else {
      apiKey = excludeKeys.length > 0
        ? await getLeastUsedSearchKeyExcluding(provider.name, excludeKeys)
        : await getLeastUsedSearchKey(provider.name);
    }

    if (!apiKey || excludeKeys.includes(apiKey)) continue;

    return { provider, apiKey };
  }

  throw new Error('All search providers exhausted');
}

export async function executeSearch(query, opts = {}) {
  const MAX_ATTEMPTS = 3;
  const usedKeys = [];
  const providerFailCount = {};
  const failedProviders = [];
  let lastError;
  const startTime = Date.now();

  // Check cache first
  if (!opts.stream) {
    try {
      const cacheKey = `search:${Buffer.from(query).toString('base64').substring(0, 50)}:${opts.provider || 'auto'}:${opts.maxResults || 5}`;
      const cached = await getCached(cacheKey, 'search', '', '');
      if (cached) {
        return { ...cached, cached: true };
      }
    } catch {
      // Cache read error - continue with normal flow
    }
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let routeResult;

    try {
      routeResult = await routeSearch(query, {
        provider: opts.provider,
        excludeProviders: failedProviders,
        excludeKeys: usedKeys,
      });
    } catch {
      break;
    }

    const { provider, apiKey } = routeResult;
    usedKeys.push(apiKey);

    try {
      const adapter = await getSearchAdapter(provider.name);
      const metadata = provider.noApiKey ? {} : await getSearchKeyMetadata(provider.name, apiKey);

      const result = await adapter.sendRequest(query, null, apiKey, {
        maxResults: opts.maxResults || 5,
        ...metadata,
        signal: opts.abortSignal,
      });

      await recordSearchProviderResult(provider.name, true);

      const { trackSearchRequest } = await import('./statsService.js');
      await trackSearchRequest(provider.name, apiKey, result.tokens).catch(() => {});

      const standardizedResult = standardizeSearchResult(result, provider.name, query);

      if (!opts.stream) {
        try {
          const cacheKey = `search:${Buffer.from(query).toString('base64').substring(0, 50)}:${opts.provider || 'auto'}:${opts.maxResults || 5}`;
          await setCached(cacheKey, 'search', '', '', standardizedResult);
        } catch {
        }
      }

      return standardizedResult;
    } catch (err) {
      if (!provider.noApiKey) {
        await recordSearchKeyFailure(provider.name, apiKey).catch(() => {});
      }
      await recordSearchProviderResult(provider.name, false);

      providerFailCount[provider.name] = (providerFailCount[provider.name] || 0) + 1;

      if (providerFailCount[provider.name] >= 2) {
        if (!failedProviders.includes(provider.name)) {
          failedProviders.push(provider.name);
        }
      }

      lastError = err;

      const { trackSearchError } = await import('./statsService.js');
      await trackSearchError(provider.name).catch(() => {});
    }
  }

  throw lastError || new Error('All search providers exhausted');
}
