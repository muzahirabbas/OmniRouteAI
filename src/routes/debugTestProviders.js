import { getActiveProviders } from '../services/providerService.js';

async function testProviders(fastify) {
  fastify.get('/debug/test-providers', async () => {
    const active = await getActiveProviders();
    return {
      count: active.length,
      providers: active.map(p => ({name: p.name, status: p.status, type: p.type, priority: p.priority}))
    };
  });
}

export { testProviders as debugTestProvidersRoutes };