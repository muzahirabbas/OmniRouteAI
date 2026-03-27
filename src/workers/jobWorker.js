import { Worker } from 'bullmq';
import { createDuplicate } from '../config/redis.js';
import { routeAndExecute } from '../services/routerService.js';
import http from 'http';

/**
 * BullMQ worker for `chat-completions` queue.
 * Processes NON-STREAMING chat completion jobs.
 *
 * Each job contains: { prompt, model, taskType, systemPrompt, requestId }
 * Returns:           { output, provider, model, tokens, keyUsed }
 *
 * IMPORTANT: This worker does NOT implement custom retry logic.
 * routerService.routeAndExecute() is the SINGLE source of retry truth:
 *   - It handles up to 3 attempts internally
 *   - It does key rotation, provider failover, and circuit breaker logic
 *   - Workers must call it once and trust the result (or the thrown error)
 *
 * BullMQ's own retry (attempts) is set to 1 — no BullMQ-level retries.
 */
const worker = new Worker(
  'chat-completions',
  async (job) => {
    const { prompt, model, provider, taskType, systemPrompt, requestId } = job.data;

    console.log(JSON.stringify({
      level:     'info',
      msg:       'Processing job',
      jobId:     job.id,
      requestId,
    }));

    // Single call — routeAndExecute handles all retry/failover internally
    const result = await routeAndExecute(prompt, {
      model,
      provider,
      taskType,
      systemPrompt,
      requestId,
      stream: false,
    });

    console.log(JSON.stringify({
      level:    'info',
      msg:      'Job completed',
      jobId:    job.id,
      requestId,
      provider: result?.provider,
      model:    result?.model,
    }));

    if (!result) {
      console.warn(JSON.stringify({
        level: 'warn',
        msg:   'routeAndExecute returned null/undefined',
        jobId: job.id,
      }));
      throw new Error('No result returned from routeAndExecute — provider may have failed');
    }

    return result;
  },
  {
    connection: createDuplicate(),
    concurrency: 5,
    limiter: {
      max:      50,
      duration: 60000, // Max 50 jobs per minute
    },
  },
);

worker.on('failed', (job, err) => {
  console.error(JSON.stringify({
    level: 'error',
    msg:   'Worker job failed',
    jobId: job?.id,
    error: err.message,
  }));
});

worker.on('error', (err) => {
  console.error(JSON.stringify({
    level: 'error',
    msg:   'Worker error',
    error: err.message,
  }));
});

console.log(JSON.stringify({
  level:       'info',
  msg:         'BullMQ worker started',
  queue:       'chat-completions',
  concurrency: 5,
  retryPolicy: 'handled by routerService (max 3 attempts)',
}));

// ─── Railway Health Check Server ──────────────────────────────────────
// Railway requires containers to bind to $PORT to pass health checks.
// If PORT is explicitly set, we use it. If not, we use 8081 for the worker.
const PORT = parseInt(process.env.PORT, 10) || 8081;
const HOST = process.env.HOST || '0.0.0.0';

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'healthy', service: 'bullmq-worker' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: 'info',
    msg:   `Worker health-check server listening on ${HOST}:${PORT}`,
  }));
});

// ─── Graceful Shutdown ───────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(JSON.stringify({
    level: 'info',
    msg:   `Received ${signal}, shutting down gracefully...`,
  }));

  try {
    // 1. Close health server
    healthServer.close();
    // 2. Stop accepting new jobs and wait for current ones (up to 30s)
    await worker.close();
    console.log(JSON.stringify({ level: 'info', msg: 'Worker closed successfully' }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Error during shutdown', error: err.message }));
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default worker;
