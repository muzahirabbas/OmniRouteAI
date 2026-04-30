import { getClient } from '../config/redis.js';

async function debugRedis(fastify) {
  fastify.get('/debug/redis-keys', async () => {
    const client = getClient();
    const providers = ['google', 'cerebras', 'openrouter', 'groq', 'sambanova'];
    const results = [];
    
    for (const provider of providers) {
      const key = `provider:${provider}:keys`;
      const members = await client.zrange(key, 0, -1, 'WITHSCORES');
      
      let firstKeyInfo = null;
      if (members.length > 0) {
        const firstKey = members[0];
        const disabledK = `key:disabled:${provider}:${firstKey}`;
        const rpmK = `rpm:${provider}:${firstKey}`;
        
        firstKeyInfo = {
          firstKey: firstKey.substring(0, 8) + '...',
          score: members[1],
          disabled: await client.exists(disabledK),
          rpm: await client.get(rpmK)
        };
      }
      
      results.push({
        provider,
        keyCount: members.length / 2,
        firstKey: firstKeyInfo
      });
    }
    
    return results;
  });
}

export { debugRedis as debugRedisRoutes };