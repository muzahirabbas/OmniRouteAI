import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

let db;

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
    return db;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Firestore init failed', error: err.message }));
    // Return a mock database so our endpoints don't inherently crash with HTTP 500s
    return createMockDb();
  }
}

function createMockDb() {
  db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async () => {},
        update: async () => {},
      }),
      add: async () => {},
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
    })
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

export default { getDb };
