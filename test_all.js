import { getDb } from './src/config/firestore.js';
import { del } from './src/config/redis.js';

const RAILWAY_URL = 'https://glistening-stillness-production-6724.up.railway.app/v1/chat/completions';
const ADMIN_KEY = process.env.ADMIN_API_KEY || process.env.VITE_API_KEY || process.env.API_KEY || 'MISSING_KEY';

async function testAllProviders() {
  console.log('--- 🤖 OmniRouteAI Exhaustive 30-Provider Deep Test ---');
  console.log(`Target: ${RAILWAY_URL}`);
  
  if (ADMIN_KEY === 'MISSING_KEY') {
    console.error("❌ Could not find an admin API key in your .env");
    process.exit(1);
  }

  const db = getDb();
  console.log('\n[1/3] Fetching all registered providers from database...');
  const snapshot = await db.collection('providers').get();
  
  const providers = [];
  snapshot.forEach((doc) => providers.push(doc.id));
  
  console.log(`Found ${providers.length} total providers. Beginning sequential deep test...\n`);

  // We will isolate each provider by turning it ON and all others OFF.
  // Then we hit the router so it has 0% chance of routing anywhere else.
  for (const targetProvider of providers) {
    console.log(`====================================================`);
    console.log(`🧪 Testing: [${targetProvider}]`);
    
    // 1. Isolate Database
    const isolateBatch = db.batch();
    snapshot.forEach((doc) => {
      const status = (doc.id === targetProvider) ? 'active' : 'inactive';
      isolateBatch.update(doc.ref, { status });
    });
    await isolateBatch.commit();
    
    // 2. Invalidate Redis
    await del('providers:list');
    
    // Wait for Railway sync
    await new Promise(r => setTimeout(r, 1000));
    
    // 3. Send Request
    try {
      const startTime = Date.now();
      const response = await fetch(RAILWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ADMIN_KEY}`
        },
        body: JSON.stringify({
          model: 'auto',
          prompt: `Test prompt for ${targetProvider} - just reply 'success'`
        })
      });

      const latency = Date.now() - startTime;
      const data = await response.json().catch(() => ({}));

      console.log(`HTTP Status: ${response.status} (${latency}ms)`);
      
      // If it returned 200, it actually succeeded! (Like qwen)
      if (response.status === 200) {
        console.log(`✅ SUCCESS Response from ${targetProvider}!`);
        console.log(`Model Used: ${data.model || 'unknown'}`);
        console.log(`Output: ${data.output}`);
      } 
      // If 500 or 400 with 'Job failed', it means the provider's upstream rejected it (e.g. no api key)
      else if (response.status === 500 && data.message && data.message.includes('fetch failed')) {
        console.log(`❌ FAILED: Container could not reach daemon. (Missing Ngrok header or URL)`);
      }
      else {
        // Output the raw provider trace array if it exists
        const errorMsg = data.message || JSON.stringify(data);
        console.log(`⚠️ PROVIDER REJECTED: ${errorMsg}`);
      }
    } catch (err) {
      console.log(`🚨 CRITICAL NETWORK ERROR: ${err.message}`);
    }
  }

  console.log('\n✅ Exhaustive Test Complete!');
  console.log('Restoring defaults...');
  
  // Turn them all back to active
  const restoreBatch = db.batch();
  snapshot.forEach((doc) => restoreBatch.update(doc.ref, { status: 'active' }));
  await restoreBatch.commit();
  await del('providers:list');
  console.log('Restoration Complete. Exiting.');
  process.exit(0);
}

testAllProviders().catch(console.error);
