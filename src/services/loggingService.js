import { getDb } from '../config/firestore.js';
import { evalLua, get, del, getClient } from '../config/redis.js';

/**
 * Logging service.
 *
 * Strategy: Async, non-blocking.
 * - Push log entries to a Redis list (log_buffer)
 * - Background flush batches them into Firestore `logs` collection
 * - Circular buffer with max size to prevent overflow
 * - Oldest entries are dropped when buffer is full
 */

const BUFFER_KEY = 'log_buffer';
const MAX_BUFFER_SIZE = 1000; // Maximum entries in Redis buffer
const BATCH_SIZE = 50;
let flushTimer = null;

/**
 * Log a request (non-blocking).
 * Pushes to Redis buffer; Firestore write happens async.
 * Implements circular buffer: oldest entries are dropped when full.
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

  // Push to Redis buffer with circular buffer protection
  try {
    const client = getClient();
    
    // Use Lua script for atomic circular buffer operation:
    // 1. Trim buffer to max size - 1 (make room)
    // 2. Push new entry
    // This ensures we never exceed MAX_BUFFER_SIZE
    const luaScript = `
      redis.call('LTRIM', KEYS[1], 0, ARGV[1] - 2);
      redis.call('RPUSH', KEYS[1], ARGV[2]);
      return redis.call('LLEN', KEYS[1]);
    `;
    
    const currentSize = await evalLua(
      luaScript,
      1,
      BUFFER_KEY,
      String(MAX_BUFFER_SIZE),
      JSON.stringify(logEntry)
    );
    
    // Warn if buffer is getting full
    if (currentSize > MAX_BUFFER_SIZE * 0.8) {
      console.warn(JSON.stringify({
        level: 'warn',
        msg: 'Log buffer approaching capacity',
        current_size: currentSize,
        max_size: MAX_BUFFER_SIZE,
      }));
      
      // Trigger immediate flush if >90% full
      if (currentSize > MAX_BUFFER_SIZE * 0.9) {
        scheduleImmediateFlush();
      }
    }
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
    
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Flushed logs to Firestore',
      count: entries.length,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Failed to flush logs to Firestore',
      error: err.message,
    }));
  }
}

/**
 * Get current buffer size for monitoring.
 * @returns {Promise<number>}
 */
export async function getBufferSize() {
  try {
    const client = getClient();
    return await client.llen(BUFFER_KEY);
  } catch {
    return 0;
  }
}

/**
 * Get buffer status for health monitoring.
 * @returns {Promise<{size: number, max: number, usagePercent: number}>}
 */
export async function getBufferStatus() {
  const size = await getBufferSize();
  return {
    size,
    max: MAX_BUFFER_SIZE,
    usagePercent: ((size / MAX_BUFFER_SIZE) * 100).toFixed(1),
  };
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
 * Schedule an immediate flush (for high-load situations).
 */
function scheduleImmediateFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushLogs();
  }, 1000); // Flush in 1 second
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
