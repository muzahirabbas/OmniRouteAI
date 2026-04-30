import { getClient } from '../config/redis.js';

async function testSimpleKeys(fastify) {
  fastify.get('/debug/simple-keys', async () => {
    const client = getClient();
    const results = [];
    const providers = ['google', 'cerebras'];
    
    for (const provider of providers) {
      const setKey = `provider:${provider}:keys`;
      
      // Simple ZRANGE to get all keys
      const allKeys = await client.zrange(setKey, 0, -1);
      
      // Get first key's score
      const firstKey = allKeys[0];
      const firstScore = await client.zscore(setKey, firstKey);
      
      // Check if disabled
      const disabledK = `key:disabled:${provider}:${firstKey}`;
      const isDisabled = await client.exists(disabledK);
      
      // Check RPM
      const rpmK = `rpm:${provider}:${firstKey}`;
      const rpm = await client.get(rpmK);
      
      results.push({
        provider,
        allKeysCount: allKeys.length,
        firstKey: firstKey?.substring(0, 10) + '...',
        firstScore,
        firstDisabled: isDisabled ? 'YES' : 'NO',
        firstRPM: rpm || '0'
      });
    }
    
    return results;
  });
}

export { testSimpleKeys as debugSimpleKeysRoutes };