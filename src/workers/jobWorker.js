import { Worker } from 'bullmq';
import { createDuplicate } from '../config/redis.js';
import { routeAndExecute } from '../services/routerService.js';
import http from 'http';

/**
 * BullMQ worker for `chat-completions` queue.
 * Processes non-streaming chat completion jobs.
 *
 * Each job contains: { prompt, model, taskType, requestId }
 * Returns: { output, provider, model, tokens, keyUsed }
 */

const worker = new Worker(
  'chat-completions',
  async (job) => {
    const { prompt, model, taskType, requestId } = job.data;

    console.log(JSON.stringify({
      level: 'info',
      msg: 'Processing job',
      jobId: job.id,
      requestId,
    }));

    try {
      const result = await routeAndExecute(prompt, {
        model,
        taskType,
        requestId,
        stream: false,
      });

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Job completed',
        jobId: job.id,
        requestId,
        provider: result.provider,
        model: result.model,
      }));

      return result;
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'Job failed',
        jobId: job.id,
        requestId,
        error: err.message,
      }));
      throw err;
    }
  },
  {
    connection: createDuplicate(),
    concurrency: 5, // Process up to 5 jobs in parallel
    limiter: {
      max: 50,
      duration: 60000, // Max 50 jobs per minute
    },
  },
);

worker.on('failed', (job, err) => {
  console.error(JSON.stringify({
    level: 'error',
    msg: 'Worker job failed',
    jobId: job?.id,
    error: err.message,
  }));
});

worker.on('error', (err) => {
  console.error(JSON.stringify({
    level: 'error',
    msg: 'Worker error',
    error: err.message,
  }));
});

console.log(JSON.stringify({
  level: 'info',
  msg: 'BullMQ worker started',
  queue: 'chat-completions',
  concurrency: 5,
}));

// ─── Railway Health Check Server ───────────────────────────────────
// Railway requires containers to bind to $PORT to pass health checks.
// If the worker doesn't open an HTTP port, Railway assumes it crashed
// and aggressively sends SIGTERM to restart the container constantly.
const PORT = parseInt(process.env.PORT, 10) || 8081; // Using 8081 fallback for local so it doesn't clash with main app
const HOST = process.env.HOST || '0.0.0.0';

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', service: 'bullmq-worker' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: 'info',
    msg: `Worker health-check server listening on ${HOST}:${PORT}`,
  }));
});

export default worker;
