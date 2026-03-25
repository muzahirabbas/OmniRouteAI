
import { getDb } from './src/config/firestore.js';
import { del } from './src/config/redis.js';

async function setupTestEnvironment() {
  console.log('--- 🤖 OmniRouteAI Automated CLI Test ---');
  console.log('[1/4] Connecting to Firestore...');
  const db = getDb();
  
  console.log('[2/4] Fetching all providers...');
  const snapshot = await db.collection('providers').get();
  
  const batch = db.batch();
  let count = 0;
  
  snapshot.forEach((doc) => {
    const docRef = db.collection('providers').doc(doc.id);
    if (doc.id === 'qwen_cli_local') {
      batch.update(docRef, { status: 'active' });
      console.log('      -> Set qwen_cli_local to ACTIVE');
    } else {
      batch.update(docRef, { status: 'inactive' });
    }
    count++;
  });
  
  console.log(`[3/4] Disabling ${count - 1} remote providers in Firestore...`);
  await batch.commit();
  
  console.log('[4/4] Clearing Redis cache to force router reload...');
  await del('providers:list');
  
  console.log('\n✅ Setup Complete! All providers are now disabled EXCEPT Qwen CLI.');
  process.exit(0);
}

setupTestEnvironment().catch(console.error);
