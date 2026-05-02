import { buildServer } from './server.js';
import { closeRedis } from './config/redis.js';
import './cron/dailyReset.js'; // Start cron job on boot
import './cron/syncJob.js'; // Start sync cron job on boot

// FIX: Add unhandled rejection handler to prevent silent failures
process.on('unhandledRejection', (reason, promise) => {
  console.error(JSON.stringify({
    level: 'fatal',
    msg: 'Unhandled Promise Rejection',
    error: reason?.message || String(reason),
    stack: reason?.stack,
  }));
});

// FIX: Add uncaught exception handler
process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({
    level: 'fatal',
    msg: 'Uncaught Exception',
    error: err.message,
    stack: err.stack,
  }));
  process.exit(1);
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    const app = await buildServer();

    await app.listen({ port: PORT, host: HOST });
    app.log.info(`OmniRouteAI server listening on ${HOST}:${PORT}`);

    // ─── Graceful Shutdown ───────────────────────────────────────────
    const shutdown = async (signal) => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      try {
        const { flushWebhookQueue } = await import('./services/webhookService.js');
        await flushWebhookQueue();

        const { flushLogs } = await import('./services/loggingService.js');
        await flushLogs();

        await app.close();
        await closeRedis();
        app.log.info('Server and dependencies closed successfully');
        process.exit(0);
      } catch (err) {
        app.log.error(`Error during shutdown: ${err.message}`);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error(JSON.stringify({
      level: 'fatal',
      msg: 'Failed to start server',
      error: err.message,
      stack: err.stack,
    }));
    process.exit(1);
  }
}

start();
