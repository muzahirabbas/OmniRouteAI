/**
 * Static search provider configuration with full model lists.
 * Acts as a fallback if Firestore is empty and as the source for seeding.
 *
 * Mirrors the structure of providers.js but for web search APIs.
 */
import { getDb } from './firestore.js';
import { get, setex } from './redis.js';

export const STATIC_SEARCH_PROVIDERS = [
  {
    name: 'tavily',
    priority: 1,
    weight: 15,
    status: 'active',
    endpoint: 'https://api.tavily.com/search',
    type: 'tavily',
    features: ['web-search', 'research', 'news'],
    rpmLimit: 60,
    freeTier: '1000 queries/month',
  },
  {
    name: 'brave',
    priority: 1,
    weight: 10,
    status: 'active',
    endpoint: 'https://api.search.brave.com/res/v1/web/search',
    type: 'brave',
    features: ['web-search', 'news', 'images', 'videos'],
    rpmLimit: 60,
    freeTier: '2000 queries/month',
  },
  {
    name: 'serper',
    priority: 2,
    weight: 10,
    status: 'active',
    endpoint: 'https://google.serper.dev/search',
    type: 'serper',
    features: ['web-search', 'news', 'places', 'images'],
    rpmLimit: 60,
    freeTier: '1000 queries/month',
  },
  {
    name: 'exa',
    priority: 2,
    weight: 8,
    status: 'active',
    endpoint: 'https://api.exa.ai/search',
    type: 'exa',
    features: ['neural-search', 'semantic', 'research'],
    rpmLimit: 30,
    freeTier: '100k characters/month',
  },
  {
    name: 'firecrawl',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://api.firecrawl.dev/v1/search',
    type: 'firecrawl',
    features: ['web-search', 'crawl', 'scrape'],
    rpmLimit: 30,
    freeTier: '500 pages/month',
  },
  {
    name: 'duckduckgo',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://html.duckduckgo.com/html/',
    type: 'duckduckgo',
    features: ['web-search'],
    rpmLimit: 30,
    freeTier: 'Unlimited (rate-limited)',
    noApiKey: true,
  },
  {
    name: 'searchapi',
    priority: 3,
    weight: 5,
    status: 'active',
    endpoint: 'https://searchapi.io/api/v1/search',
    type: 'searchapi',
    features: ['web-search', 'news', 'places'],
    rpmLimit: 60,
    freeTier: '100 free searches on signup',
  },
  {
    name: 'google-pse',
    priority: 4,
    weight: 5,
    status: 'active',
    endpoint: 'https://www.googleapis.com/customsearch/v1',
    type: 'google-pse',
    features: ['web-search'],
    rpmLimit: 100,
    freeTier: '100 queries/day',
  },
];

/**
 * Fetch active search providers from Firestore, with static fallback and Redis caching.
 * Mirrors getProviders() from providers.js
 */
export async function getSearchProviders() {
  const cacheKey = 'search:providers:list';

  try {
    // 1. Try Redis cache
    const cached = await get(cacheKey);
    if (cached) {
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }

    // 2. Load from source (Firestore or Static base)
    const db = getDb();
    const firestorePromise = db.collection('search_providers').get();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore operation timed out')), 10000)
    );

    const snapshot = await Promise.race([firestorePromise, timeoutPromise]);

    // Start with STATIC_SEARCH_PROVIDERS as base, merge Firestore data
    const providersMap = {};
    STATIC_SEARCH_PROVIDERS.forEach(p => { providersMap[p.name] = { ...p }; });

    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name) {
          const staticBase = providersMap[data.name] || {};
          providersMap[data.name] = {
            ...staticBase,
            ...data,
            type: staticBase.type || data.type,
          };
        }
      });
    }

    const providers = Object.values(providersMap);

    // Sort by priority (ascending) then weight (descending)
    providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || (b.weight ?? 0) - (a.weight ?? 0));

    // Cache in Redis for 60 seconds
    await setex(cacheKey, 60, JSON.stringify(providers));

    return providers;
  } catch (err) {
    console.warn('Failed to fetch search providers from DB/Cache, using static fallback:', err.message);
    return [...STATIC_SEARCH_PROVIDERS];
  }
}

/**
 * Get the default RPM limit for a search provider from static config.
 */
export function getDefaultSearchRpmLimit(providerName) {
  const provider = STATIC_SEARCH_PROVIDERS.find((p) => p.name === providerName);
  return provider ? provider.rpmLimit : 30;
}
