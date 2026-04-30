import { getClient } from '../config/redis.js';

export async function debugRedisKeys() {
  const client = getClient();
  
  const providers = ['google', 'cerebras', 'openrouter', 'groq', 'sambanova'];
  
  console.log('=== DEBUG: Redis Keys ===\n');
  
  for (const provider of providers) {
    const key = `provider:${provider}:keys`;
    
    // Get all keys with scores
    const members = await client.zrange(key, 0, -1, 'WITHSCORES');
    
    console.log(`Provider: ${provider}`);
    console.log(`  Total keys in sorted set: ${members.length / 2}`);
    
    if (members.length > 0) {
      console.log(`  First 3 keys with scores:`);
      for (let i = 0; i < Math.min(6, members.length); i += 2) {
        console.log(`    [${i/2 + 1}] "${members[i].substring(0, 12)}..." -> score: ${members[i+1]}`);
      }
      
      // Check if disabled
      const firstKey = members[0];
      const disabledKey = `key:disabled:${provider}:${firstKey}`;
      const isDisabled = await client.exists(disabledKey);
      console.log(`  First key disabled: ${isDisabled ? 'YES' : 'NO'}`);
      
      // Check RPM
      const rpmKey = `rpm:${provider}:${firstKey}`;
      const rpm = await client.get(rpmKey);
      console.log(`  First key RPM: ${rpm || '0'}`);
    }
    console.log('');
  }
  
  // Try getLeastUsedKey directly
  const { getLeastUsedKey } = await import('./keyService.js');
  console.log('=== Testing getLeastUsedKey() directly ===\n');
  
  for (const provider of providers) {
    const key = await getLeastUsedKey(provider);
    console.log(`  ${provider}: ${key ? key.substring(0, 12) + '...' : 'NULL (failed!)'}`);
  }
}