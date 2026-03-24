import { getDb } from '../config/firestore.js';
import { evalLua, get, del } from '../config/redis.js';

/**
 * Logging service.
 *
 * Strategy: Async, non-blocking.
 * - Push log entries to a Redis list (log_buffer)
 * - Background flush batches them into Firestore `logs` collection
 * - Never blocks HTTP response
 */

const BUFFER_KEY = 'log_buffer';
const BATCH_SIZE = 50;
let flushTimer = null;

/**
 * Log a request (non-blocking).
 * Pushes to Redis buffer; Firestore write happens async.
 *
 * @param {object} entry
 * @param {string} entry.request_id
 * @param {string} entry.provider
 * @param {string} entry.model
 * @param {string} entry.key - API key (masked for security)
 * @param {number} entry.latency - ms
 * @param {object} entry.tokens - { input, output }
 * @param {string} entry.status - 'success' | 'error' | 'cache_hit'
 * @param {string} [entry.error] - error message if status is error
 */
export async function logRequest(entry) {
  const logEntry = {
    ...entry,
    key: maskKey(entry.key),
    timestamp: new Date().toISOString(),
  };

  // Push to Redis buffer (async, non-blocking)
  try {
    const { getClient } = await import('../config/redis.js');
    await getClient().rpush(BUFFER_KEY, JSON.stringify(logEntry));
  } catch (err) {
    // If Redis fails, log to stdout as fallback
    console.error(JSON.stringify({ level: 'error', msg: 'Failed to buffer log', error: err.message }));
    console.log(JSON.stringify({ level: 'info', msg: 'request_log', ...logEntry }));
  }

  // Schedule flush if not already scheduled
  scheduleFlush();
}

/**
 * Flush buffered logs to Firestore in batches.
 */
export async function flushLogs() {
  try {
    const { getClient } = await import('../config/redis.js');
    const client = getClient();

    // Atomically pop up to BATCH_SIZE entries
    const entries = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const entry = await client.lpop(BUFFER_KEY);
      if (!entry) break;
      entries.push(JSON.parse(entry));
    }

    if (entries.length === 0) return;

    // Batch write to Firestore
    const db = getDb();
    const batch = db.batch();
    const logsRef = db.collection('logs');

    for (const entry of entries) {
      const docRef = logsRef.doc(entry.request_id || `log_${Date.now()}_${Math.random()}`);
      batch.set(docRef, entry);
    }

    await batch.commit();
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Failed to flush logs to Firestore',
      error: err.message,
    }));
  }
}

/**
 * Schedule a flush after a short delay (debounced).
 */
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushLogs();
  }, 5000); // Flush every 5 seconds
}

/**
 * Mask an API key for safe logging.
 * Shows first 4 and last 4 characters.
 *
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key || key.length < 10) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
