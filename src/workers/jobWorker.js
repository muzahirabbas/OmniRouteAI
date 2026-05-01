import { Worker } from 'bullmq';
import { createDuplicate, closeRedis, startHealthCheck, stopHealthCheck } from '../config/redis.js';
import { routeAndExecute } from '../services/routerService.js';
import http from 'http';

// Worker configuration with better stall handling
const WORKER_OPTIONS = {
  connection: createDuplicate(),
  concurrency: parseInt(process.env.WORKER_CONCURRENCY, 10) || 50,
  limiter: {
    max: parseInt(process.env.WORKER_MAX_JOBS_PER_MIN, 10) || 1000,
    duration: 60000,
  },
  // BullMQ stall handling - prevent jobs from getting stuck
  stalledInterval: 30000,      // Check for stalled jobs every 30s
  lockDuration: 120000,        // 2min lock duration (must exceed max job duration)
  maxStalledCount: 2,          // Max stall attempts before job moves to failed
};

const worker = new Worker(
  'chat-completions',
  async (job) => {
    const { 
      prompt, 
      model, 
      provider, 
      taskType, 
      systemPrompt, 
      noContext, 
      requestId,
      temperature,
      top_p,
      max_tokens,
      response_format,
      tools,
      tool_choice,
      reasoningEffort,
    } = job.data;

    console.log(JSON.stringify({
      level:     'info',
      msg:       'Processing job',
      jobId:     job.id,
      requestId,
      attempt:   job.attemptsMade,
    }));

    // Single call — routeAndExecute handles all retry/failover internally
    const result = await routeAndExecute(prompt, {
      model,
      provider,
      taskType,
      systemPrompt,
      noContext,
      requestId,
      stream: false,
      // Pass through additional OpenAI options
      temperature,
      top_p,
      max_tokens,
      response_format,
      tools,
      tool_choice,
      reasoningEffort,
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
  WORKER_OPTIONS,
);

// ─── Enhanced Worker Event Handlers ──────────────────────────────────
worker.on('failed', (job, err) => {
  console.error(JSON.stringify({
    level: 'error',
    msg:   'Worker job failed',
    jobId: job?.id,
    attempt: job?.attemptsMade,
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

worker.on('stalled', (jobId) => {
  console.warn(JSON.stringify({
    level: 'warn',
    msg:   'Worker job stalled',
    jobId,
  }));
});

worker.on('active', (job) => {
  console.log(JSON.stringify({
    level: 'info',
    msg:   'Worker job active',
    jobId: job.id,
    requestId: job.data?.requestId,
  }));
});

// Handle Redis connection issues
worker.on('closing', (msg) => {
  console.log(JSON.stringify({
    level: 'info',
    msg:   'Worker closing',
    details: msg,
  }));
});

console.log(JSON.stringify({
  level:       'info',
  msg:         'BullMQ worker started',
  queue:       'chat-completions',
  concurrency: 50,
  retryPolicy: 'handled by routerService (max 3 attempts)',
  stallHandling: 'enabled (30s interval, 120s lock)',
}));

// Start Redis health check
startHealthCheck(30000);

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
    // 1. Stop health check interval
    stopHealthCheck();
    // 2. Close health server
    healthServer.close();
    // 3. Stop accepting new jobs and wait for current ones (up to 30s)
    await worker.close();
    // 4. Close the global Redis connections
    await closeRedis();
    console.log(JSON.stringify({ level: 'info', msg: 'Worker and Redis closed successfully' }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Error during shutdown', error: err.message }));
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default worker;
