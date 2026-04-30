import { getClient } from '../config/redis.js';

async function testLuaSelection(fastify) {
  fastify.get('/debug/test-select', async () => {
    const client = getClient();
    const results = [];
    const providers = ['google', 'cerebras'];
    
    for (const provider of providers) {
      const setKey = `provider:${provider}:keys`;
      const disabledPrefix = `key:disabled:${provider}:`;
      const rpmPrefix = `rpm:${provider}:`;
      
      // Get all keys first
      const allKeys = await client.zrange(setKey, 0, -1);
      
      // Try to select FIRST key manually
      const firstKey = allKeys[0];
      
      // Check its status
      const disabledK = disabledPrefix + firstKey;
      const rpmK = rpmPrefix + firstKey;
      const isDisabled = await client.exists(disabledK);
      const rpm = await client.get(rpmK);
      
      // Try selecting it (simulate Lua)
      if (!isDisabled && (!rpm || parseInt(rpm) < 50)) {
        // Eligible - select it
        await client.zincrby(setKey, 1, firstKey);
        const newScore = await client.zscore(setKey, firstKey);
        
        results.push({ 
          provider, 
          selected: firstKey?.substring(0,10) + '...',
          wasDisabled: isDisabled,
          oldRPM: rpm,
          newScore 
        });
      } else {
        results.push({ provider, error: 'First key not eligible', isDisabled, rpm });
      }
    }
    
    return results;
  });
}

export { testLuaSelection as debugTestSelectRoutes };