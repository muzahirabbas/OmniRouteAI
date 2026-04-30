import { getClient } from '../config/redis.js';

async function testKeyFlow(fastify) {
  fastify.get('/debug/test-key-flow', async () => {
    const client = getClient();
    const results = [];
    const providers = ['google', 'cerebras'];
    
    for (const provider of providers) {
      const setKey = `provider:${provider}:keys`;
      
      // 1. Check if keys exist in sorted set
      const allKeys = await client.zrange(setKey, 0, -1);
      
      if (allKeys.length === 0) {
        results.push({ provider, error: 'No keys in sorted set' });
        continue;
      }
      
      // 2. Get first key and check its score
      const firstKey = allKeys[0];
      const score = await client.zscore(setKey, firstKey);
      
      // 3. Check if disabled
      const disabledKey = `key:disabled:${provider}:${firstKey}`;
      const isDisabled = await client.exists(disabledKey);
      
      // 4. Try to SELECT via fallback logic (direct zincrby)
      if (!isDisabled) {
        await client.zincrby(setKey, 1, firstKey);
        const newScore = await client.zscore(setKey, firstKey);
        
        results.push({
          provider,
          keyFound: true,
          firstKeyPreview: firstKey.substring(0, 10),
          scoreBefore: score,
          newScoreAfterSelection: newScore,
          isDisabled
        });
      } else {
        results.push({ provider, error: 'First key is disabled', isDisabled: true });
      }
    }
    
    return results;
  });
}

export { testKeyFlow as debugKeyFlowRoutes };