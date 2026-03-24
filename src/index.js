import { buildServer } from './server.js';
import './cron/dailyReset.js'; // Start cron job on boot

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    const app = await buildServer();

    await app.listen({ port: PORT, host: HOST });
    app.log.info(`OmniRouteAI server listening on ${HOST}:${PORT}`);
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
