import cron from 'node-cron';
import { aggregateDaily, resetCounters } from '../services/statsService.js';
import { flushLogs } from '../services/loggingService.js';

/**
 * Daily cron job — runs at midnight.
 *
 * 1. Flush remaining buffered logs to Firestore
 * 2. Aggregate daily stats → Firestore `daily_stats` collection
 * 3. Reset Redis counters for the new day
 */

// Schedule: every day at midnight (00:00)
const dailyResetJob = cron.schedule('0 0 * * *', async () => {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'Daily reset cron job started',
    timestamp: new Date().toISOString(),
  }));

  try {
    // 1. Flush remaining logs
    await flushLogs();
    console.log(JSON.stringify({ level: 'info', msg: 'Logs flushed to Firestore' }));

    // 2. Aggregate stats
    const stats = await aggregateDaily();
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Daily stats aggregated',
      stats,
    }));

    // 3. Reset counters
    await resetCounters();
    console.log(JSON.stringify({ level: 'info', msg: 'Redis counters reset' }));

  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Daily reset cron job failed',
      error: err.message,
      stack: err.stack,
    }));
  }
}, {
  scheduled: true,
  timezone: 'UTC',
});

console.log(JSON.stringify({
  level: 'info',
  msg: 'Daily reset cron job scheduled',
  schedule: '0 0 * * * (midnight UTC)',
}));

export default dailyResetJob;
