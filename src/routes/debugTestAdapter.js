import { getAdapter } from '../services/routerService.js';
import { getProviders } from '../config/providers.js';

async function testAdapter(fastify) {
  fastify.get('/debug/test-adapter', async () => {
    const providers = await getProviders();
    const google = providers.find(p => p.name === 'google');
    
    if (!google) return { error: 'Google provider not found' };
    
    try {
      const adapter = await getAdapter('google', google);
      return { 
        provider: 'google', 
        adapter: adapter?.constructor?.name || 'NO ADAPTER',
        baseUrl: adapter?.baseUrl || 'N/A'
      };
    } catch (err) {
      return { error: err.message, stack: err.stack };
    }
  });
}

export { testAdapter as debugTestAdapterRoutes };