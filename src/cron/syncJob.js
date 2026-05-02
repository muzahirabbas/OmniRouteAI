import cron from 'node-cron';

// Default schedule: Midnight and Mid-day (12:00 PM)
const CRON_SCHEDULE = process.env.CRON_SYNC_SCHEDULE || '0 0,12 * * *';
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'UTC';

const syncJob = cron.schedule(CRON_SCHEDULE, async () => {
  try {
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '127.0.0.1';
    const apiKey = process.env.API_KEY;
    
    // For localhost, prefer 127.0.0.1. If HOST is 0.0.0.0, use 127.0.0.1 for local call.
    const fetchHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    
    if (!apiKey) {
      console.warn(JSON.stringify({
        level: 'warn',
        msg: 'API_KEY missing, skipping automated full sync',
      }));
      return;
    }
    
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Running automated full sync from Firestore (cron)',
    }));
    
    const res = await fetch(`http://${fetchHost}:${port}/api/admin/providers/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }
    
    const data = await res.json();
    
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Automated full sync successful',
      stats: {
        providersRefreshed: data.providersRefreshed,
        keysReloaded: data.keysReloaded
      }
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Automated full sync failed',
      error: err.message,
    }));
  }
}, {
  scheduled: true,
  timezone: CRON_TIMEZONE,
});

console.log(JSON.stringify({
  level: 'info',
  msg: 'Full sync cron job scheduled',
  schedule: CRON_SCHEDULE,
  timezone: CRON_TIMEZONE,
}));

export default syncJob;
