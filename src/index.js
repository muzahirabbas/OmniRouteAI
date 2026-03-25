import { buildServer } from './server.js';
import './cron/dailyReset.js'; // Start cron job on boot

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
        await app.close();
        app.log.info('Server closed successfully');
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
