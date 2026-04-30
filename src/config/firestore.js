import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

let db;
let _isMockDb = false;

/**
 * Check if the current Firestore instance is a mock.
 * @returns {boolean}
 */
export function isMockDb() {
  return _isMockDb;
}

/**
 * Initialize Firestore.
 * Uses GOOGLE_APPLICATION_CREDENTIALS env var to locate the service account JSON.
 */
function initFirestore() {
  if (db) return db;

  try {
    if (getApps().length === 0) {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

      if (!credPath) {
        console.warn(JSON.stringify({ level: 'warn', msg: 'GOOGLE_APPLICATION_CREDENTIALS is not defined. Firestore is running in mock/degraded mode.' }));
        // Do not crash the server if DB is entirely missing!
        _isMockDb = true;
        return createMockDb();
      }

      let serviceAccount;
      try {
        let cleanedCreds = credPath.trim();
        // Remove rogue quotes if user pasted them into Railway
        if (cleanedCreds.startsWith("'") && cleanedCreds.endsWith("'")) cleanedCreds = cleanedCreds.slice(1, -1);
        if (cleanedCreds.startsWith('"') && cleanedCreds.endsWith('"')) cleanedCreds = cleanedCreds.slice(1, -1);

        serviceAccount = JSON.parse(cleanedCreds);
      } catch (e) {
        // Fallback to file execution if explicit path
        serviceAccount = JSON.parse(readFileSync(credPath, 'utf-8'));
      }

      initializeApp({ credential: cert(serviceAccount) });
    }

    db = getFirestore();
    db.settings({ ignoreUndefinedProperties: true });

    console.log(JSON.stringify({ level: 'info', msg: 'Firestore initialized successfully' }));
    _isMockDb = false;
    return db;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Firestore init failed', error: err.message }));
    // Return a mock database so our endpoints don't inherently crash with HTTP 500s
    _isMockDb = true;
    return createMockDb();
  }
}

function createMockDb() {
  const collectionMock = {
    doc: () => ({
      get: async () => ({ exists: false, data: () => ({}) }),
      set: async () => {},
      update: async () => {},
    }),
    add: async () => {},
    // Generic .get() for the collection itself (e.g. .collection('providers').get())
    get: async () => ({
      empty: true,
      docs: [],
      forEach: () => {},
    }),
    where: () => collectionMock,
    orderBy: () => collectionMock,
    limit: () => collectionMock,
  };

  db = {
    collection: () => collectionMock
  };
  return db;
}

/**
 * Get the Firestore instance (lazy init).
 * @returns {FirebaseFirestore.Firestore}
 */
export function getDb() {
  if (!db) {
    initFirestore();
  }
  return db;
}

/**
 * Test Firestore connectivity by attempting a simple read operation.
 * @returns {Promise<{connected: boolean, error?: string}>}
 */
export async function testFirestoreConnectivity() {
  try {
    const testDb = getDb();
    
    // Check if using mock database
    if (_isMockDb) {
      return {
        connected: false,
        error: 'Firestore is running in mock mode (GOOGLE_APPLICATION_CREDENTIALS not set or invalid)',
      };
    }
    
    // Attempt a simple read - list collections or read a non-existent doc
    const testRef = testDb.collection('providers').limit(1);
    const snapshot = await testRef.get();
    
    return {
      connected: true,
      error: null,
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
    };
  }
}

export default { getDb };
