import { getDb } from './src/config/firestore.js';
import { del } from './src/config/redis.js';

const RAILWAY_URL = 'https://glistening-stillness-production-6724.up.railway.app/v1/chat/completions';
const ADMIN_KEY = process.env.ADMIN_API_KEY || process.env.VITE_API_KEY || process.env.API_KEY || 'MISSING_KEY';

async function testCloudRouter() {
  console.log('--- 🤖 OmniRouteAI Cloud Router Test ---');
  
  if (ADMIN_KEY === 'MISSING_KEY') {
    console.error("❌ Could not find an admin API key in your .env");
    process.exit(1);
  }

  // 1. Enable all providers in Firestore
  console.log('\n[1/3] Enabling ALL 30 Providers in Firestore...');
  const db = getDb();
  const snapshot = await db.collection('providers').get();
  const batch = db.batch();
  snapshot.forEach((doc) => {
    batch.update(doc.ref, { status: 'active' });
  });
  await batch.commit();

  console.log('[2/3] Invalidating Redis Cache so Railway picks it up...');
  await del('providers:list');

  // Give Railway 2 seconds to reload memory
  await new Promise(r => setTimeout(r, 2000));

  // 3. Send 3 simulated requests to Railway
  console.log('\n[3/3] Sending 3 rapid requests to Railway to test routing rotation...');
  console.log(`Using Admin Key: ${ADMIN_KEY.substring(0, 4)}...`);
  console.log('Target:', RAILWAY_URL);

  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- Request #${i} ---`);
    try {
      const response = await fetch(RAILWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ADMIN_KEY}`
        },
        body: JSON.stringify({
          model: 'auto',
          prompt: `Test prompt ${i} - prove you are routing.`
        })
      });

      const data = await response.json().catch(() => ({}));

      // Because there are no keys, the router will cycle through failover and eventually either:
      // A) Return the upstream cloud error to the user (e.g. "No API Key provided")
      // B) Completely fail over to local_http (like Qwen) and succeed!
      // C) Trip a 500 error if it completely exhausts all 30 providers.
      
      console.log(`HTTP Status: ${response.status}`);
      if (response.headers.get('x-provider')) {
        console.log(`Routed by: ${response.headers.get('x-provider')}`);
      }
      
      console.log('JSON Payload returned:');
      console.log(JSON.stringify(data, null, 2));

    } catch (err) {
      console.error(`Request #${i} completely failed network layer:`, err.message);
    }
  }

  console.log('\n✅ Test complete. Check your frontend dashboard to see the stats increment!');
  process.exit(0);
}

testCloudRouter().catch(console.error);
