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

      if (credPath) {
        let serviceAccount;
        try {
          // 1. Try to parse as raw JSON first (for Cloud env vars)
          serviceAccount = JSON.parse(credPath);
        } catch {
          // 2. If not JSON, it's a file path
          serviceAccount = JSON.parse(readFileSync(credPath, 'utf-8'));
        }
        initializeApp({ credential: cert(serviceAccount) });
      } else {
        // In environments like Cloud Run, default credentials work
        initializeApp();
      }
    }

    db = getFirestore();

    // Use settings for better performance
    db.settings({ ignoreUndefinedProperties: true });

    console.log(JSON.stringify({ level: 'info', msg: 'Firestore initialized' }));
    return db;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Firestore init failed', error: err.message }));
    throw err;
  }
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
