import cron from 'node-cron';
import { aggregateDaily, resetCounters } from '../services/statsService.js';
import { flushLogs } from '../services/loggingService.js';

let isRunning = false;

const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'UTC';
const CRON_SCHEDULE = process.env.CRON_DAILY_RESET_SCHEDULE || '0 0 * * *';

function validateTimezone(tz) {
  try {
    new Date().toLocaleString('en-US', { timeZone: tz });
    return tz;
  } catch {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: `Invalid timezone: ${tz}, falling back to UTC`,
    }));
    return 'UTC';
  }
}

const validatedTimezone = validateTimezone(CRON_TIMEZONE);

async function withRetry(fn, options = {}) {
  const { maxRetries = 3, baseDelayMs = 1000, operationName = 'operation' } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;

      console.error(JSON.stringify({
        level: 'warn',
        msg: `${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1})`,
        error: err.message,
        isLastAttempt,
      }));

      if (isLastAttempt) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

const CRON_STATUS_KEY = 'cron:daily_reset:status';
const CRON_METRICS_KEY = 'cron:daily_reset:metrics';

async function recordExecution(status, details = {}) {
  const { get } = await import('../config/redis.js');
  const statusPayload = {
    lastRun: new Date().toISOString(),
    status,
    ...details,
  };

  await get().setex(CRON_STATUS_KEY, 604800, JSON.stringify(statusPayload)).catch(() => {});
}

async function recordMetrics(metrics) {
  const { getClient } = await import('../config/redis.js');
  const client = getClient();

  const entry = {
    timestamp: new Date().toISOString(),
    ...metrics,
  };

  await client.lpush(CRON_METRICS_KEY, JSON.stringify(entry));
  await client.ltrim(CRON_METRICS_KEY, 0, 29).catch(() => {});
}

/**
 * Daily cron job — runs at midnight.
 *
 * 1. Flush remaining buffered logs to Firestore
 * 2. Aggregate daily stats → Firestore `daily_stats` collection
 * 3. Reset Redis counters for the new day
 */

// Schedule: every day at midnight (00:00)
const dailyResetJob = cron.schedule(CRON_SCHEDULE, async () => {
  if (isRunning) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'Daily reset job already running, skipping this invocation',
    }));
    return;
  }

  isRunning = true;
  try {
    const startTime = Date.now();
    const steps = {};
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const now = new Date().toISOString();

    console.log(JSON.stringify({
      level: 'info',
      msg: 'Daily reset cron job started',
      targetDate: yesterday,
      timestamp: now,
    }));

    try {
      // 1. Flush logs with timing
      const flushStart = Date.now();
      await withRetry(() => flushLogs(), { maxRetries: 3, operationName: 'flushLogs' });
      steps.flushLogs = { durationMs: Date.now() - flushStart, status: 'success' };
      console.log(JSON.stringify({ level: 'info', msg: 'Logs flushed to Firestore' }));

      // 2. Aggregate daily stats with timing
      const aggregateStart = Date.now();
      const stats = await withRetry(() => aggregateDaily(yesterday), { maxRetries: 3, operationName: 'aggregateDaily' });
      steps.aggregateDaily = { durationMs: Date.now() - aggregateStart, status: 'success' };
      console.log(JSON.stringify({
        level: 'info',
        msg: `Daily stats aggregated for ${yesterday}`,
        stats,
      }));

      // 3. Reset counters with timing
      const resetStart = Date.now();
      await withRetry(() => resetCounters(yesterday), { maxRetries: 3, operationName: 'resetCounters' });
      steps.resetCounters = { durationMs: Date.now() - resetStart, status: 'success' };
      console.log(JSON.stringify({ level: 'info', msg: `Redis counters reset for ${yesterday}` }));

      const totalDuration = Date.now() - startTime;
      await recordExecution('success', { durationMs: totalDuration, steps });
      await recordMetrics({ status: 'success', durationMs: totalDuration, steps });

    } catch (err) {
      const totalDuration = Date.now() - startTime;
      await recordExecution('failed', { error: err.message, durationMs: totalDuration, steps });
      await recordMetrics({ status: 'failed', error: err.message, durationMs: totalDuration });
      console.error(JSON.stringify({
        level: 'error',
        msg: 'Daily reset cron job failed',
        error: err.message,
        stack: err.stack,
      }));
    }
  } finally {
    isRunning = false;
  }
}, {
  scheduled: true,
  timezone: validatedTimezone,
});

console.log(JSON.stringify({
  level: 'info',
  msg: 'Daily reset cron job scheduled',
  schedule: CRON_SCHEDULE,
  timezone: validatedTimezone,
}));

export default dailyResetJob;
