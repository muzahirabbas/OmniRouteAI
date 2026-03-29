import { getDb } from '../src/config/firestore.js';

async function listAllKeys() {
  const db = getDb();
  console.log('--- STORED API KEYS ---');
  const snapshot = await db.collection('api_keys').get();
  if (snapshot.empty) {
    console.log('No keys found in Firestore.');
    return;
  }
  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`Provider: ${data.provider}, Masked: ${data.key.substring(0,6)}...${data.key.slice(-4)}, Disabled: ${data.is_disabled || false}`);
  });
}

listAllKeys().then(() => process.exit(0)).catch(console.error);
