import { getClient } from '../config/redis.js';

async function testLuaDirect(fastify) {
  fastify.get('/debug/test-lua', async () => {
    const client = getClient();
    const results = [];
    const providers = ['google', 'cerebras'];
    
    for (const provider of providers) {
      const setKey = `provider:${provider}:keys`;
      const disabledPrefix = `key:disabled:${provider}:`;
      const rpmPrefix = `rpm:${provider}:`;
      const rpmLimit = 50;
      
      // Run Lua inline
      const luaScript = `
        local members = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
        if #members == 0 then return {error='no members'} end
        
        local candidates = {}
        local minScore = nil
        
        for i = 1, #members, 2 do
          local apiKey = members[i]
          local score = tonumber(members[i+1])
          
          if minScore ~= nil and score > minScore then break end
          
          local disabledK = ARGV[1] .. apiKey
          local rpmK = ARGV[2] .. apiKey
          
          if redis.call('EXISTS', disabledK) == 0 then
            local rpmRaw = redis.call('GET', rpmK)
            local currentRpm = rpmRaw and tonumber(rpmRaw) or 0
            
            if currentRpm < tonumber(ARGV[3]) then
              if minScore == nil then minScore = score end
              table.insert(candidates, apiKey)
            end
          end
        end
        
        if #candidates == 0 then return {error='no candidates', membersCount=#members/2} end
        
        local selectedKey = candidates[math.random(#candidates)]
        redis.call('ZINCRBY', KEYS[1], 1, selectedKey)
        
        return {success=true, key=selectedKey, candidatesCount=#candidates}
      `;
      
      try {
        const result = await client.eval(luaScript, 1, setKey, disabledPrefix, rpmPrefix, String(rpmLimit));
        results.push({ provider, luaResult: result });
      } catch (err) {
        results.push({ provider, error: err.message });
      }
    }
    
    return results;
  });
}

export { testLuaDirect as debugTestLuaRoutes };