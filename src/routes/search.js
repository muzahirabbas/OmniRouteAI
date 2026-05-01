/**
 * Search routes - provides web search functionality via unified API.
 *
 * Routes:
 *   POST /v1/search         — global search (auto-routes to best provider)
 *   POST /:provider/v1/search — forced provider search
 *   GET  /v1/search/models  — list available search providers
 *   GET  /v1/tools         — tool definitions (for OpenClaw)
 */

import { v4 as uuidv4 } from 'uuid';
import { executeSearch, getSearchAdapter, getSearchProviderHealth } from '../services/searchRouterService.js';
import { getSearchProviders } from '../config/searchProviders.js';
import { rateLimiters } from '../utils/rateLimiter.js';

export async function searchRoutes(app) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.includes('/search') && request.method !== 'OPTIONS') {
      return rateLimiters.search(request, reply);
    }
  });
  // Tool definitions for OpenClaw integration
  app.get('/v1/tools', async () => {
    return {
      object: 'list',
      data: [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web for current information. Use this when you need up-to-date information or facts that may not be in your training data.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query. Be specific and include relevant keywords.'
                },
                max_results: {
                  type: 'integer',
                  description: 'Maximum number of results to return (default: 5)',
                  default: 5
                }
              },
              required: ['query']
            }
          }
        }
      ]
    };
  });

  app.get('/v1/search/models', async () => {
    const { getSearchProviders } = await import('../config/searchProviders.js');
    const allProviders = await getSearchProviders();
    const models = [];

    for (const p of allProviders) {
      models.push({
        id: p.name,
        object: 'search_provider',
        created: Math.floor(Date.now() / 1000),
        owned_by: p.name,
        features: p.features || [],
        free_tier: p.freeTier || '',
        rpm_limit: p.rpmLimit || 30,
      });
    }

    return { object: 'list', data: models };
  });

  app.get('/:provider/v1/search/models', async (request) => {
    const { getSearchProviders } = await import('../config/searchProviders.js');
    const allProviders = await getSearchProviders();
    const providerName = request.params.provider;
    const provider = allProviders.find(p => p.name === providerName);

    if (!provider) {
      return { error: 'Provider not found', available: allProviders.filter(p => p.status === 'active').map(p => p.name) };
    }

    return {
      object: 'list',
      data: [{
        id: provider.name,
        object: 'search_provider',
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.name,
        features: provider.features || [],
        free_tier: provider.freeTier || '',
        rpm_limit: provider.rpmLimit || 30,
      }],
    };
  });

  app.options('/v1/search', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
    });
    reply.raw.end();
  });

  app.options('/:provider/v1/search', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
    });
    reply.raw.end();
  });

  const normalizeQuery = (query) => {
    if (!query || typeof query !== 'string') return '';
    
    return query
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  };

  const normalizeSearchInput = (body, urlProvider = null) => {
    return {
      query: normalizeQuery(body.query || body.q || ''),
      provider: urlProvider || body.provider || null,
      maxResults: body.max_results || body.maxResults || body.limit || 5,
    };
  };

  const toSearchResponse = (result, requestId) => {
    return {
      id: `search_${uuidv4().slice(0, 24)}`,
      object: 'search_result',
      created: Math.floor(Date.now() / 1000),
      query: result.query,
      provider: result.provider,
      results: result.results,
      answer: result.answer || '',
      tokens: result.tokens,
    };
  };

  app.post('/v1/search', async (request, reply) => {
    const requestId = request.requestId;
    const startTime = Date.now();

    const normalized = normalizeSearchInput(request.body);
    const { query, provider: providerOverride, maxResults } = normalized;

    if (!query || query.trim().length === 0) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Query is required. Provide "query" or "q" field.',
        requestId,
      });
    }

    try {
      const result = await executeSearch(query, {
        provider: providerOverride,
        maxResults,
      });

      return toSearchResponse({ ...result, query }, requestId);
    } catch (err) {
      request.log.error(err, 'Search request failed');
      return reply.code(502).send({
        error: 'SearchError',
        message: err.message,
        requestId,
      });
    }
  });

  app.post('/:provider/v1/search', async (request, reply) => {
    const requestId = request.requestId;
    const providerName = request.params.provider;

    const { getSearchProviders } = await import('../config/searchProviders.js');
    const allProviders = await getSearchProviders();
    const provider = allProviders.find(p => p.name === providerName);

    if (!provider) {
      return reply.code(404).send({
        error: 'Provider not found',
        message: `Search provider '${providerName}' not found`,
        available: allProviders.filter(p => p.status === 'active').map(p => p.name),
        requestId,
      });
    }

    const normalized = normalizeSearchInput(request.body, providerName);
    const { query, maxResults } = normalized;

    if (!query || query.trim().length === 0) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Query is required. Provide "query" or "q" field.',
        requestId,
      });
    }

    try {
      const result = await executeSearch(query, {
        provider: providerName,
        maxResults,
      });

      return toSearchResponse({ ...result, query }, requestId);
    } catch (err) {
      request.log.error(err, `Search request failed for provider: ${providerName}`);
      return reply.code(502).send({
        error: 'SearchError',
        message: err.message,
        provider: providerName,
        requestId,
      });
    }
  });
}
