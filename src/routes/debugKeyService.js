import { getLeastUsedKey } from '../services/keyService.js';

async function testKeyService(fastify) {
  fastify.get('/debug/test-key-service', async () => {
    const results = [];
    const providers = ['google', 'cerebras', 'openrouter', 'groq', 'sambanova'];
    
    for (const provider of providers) {
      try {
        const key = await getLeastUsedKey(provider);
        results.push({ provider, key: key ? key.substring(0, 12) + '...' : 'NULL' });
      } catch (err) {
        results.push({ provider, error: err.message, stack: err.stack });
      }
    }
    
    return results;
  });
}

export { testKeyService as debugKeyServiceRoutes };