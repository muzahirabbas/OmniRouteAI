import { getLeastUsedKey } from '../services/keyService.js';

async function testKeys(fastify) {
  fastify.get('/debug/test-keys', async () => {
    const results = [];
    const providers = ['google', 'cerebras', 'openrouter', 'groq', 'sambanova'];
    
    for (const provider of providers) {
      try {
        const key = await getLeastUsedKey(provider);
        results.push({ provider, key: key ? key.substring(0, 12) + '...' : 'NULL' });
      } catch (err) {
        results.push({ provider, error: err.message });
      }
    }
    
    return results;
  });
}

export { testKeys as debugKeysRoutes };