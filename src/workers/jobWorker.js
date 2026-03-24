import { Worker } from 'bullmq';
import { createDuplicate } from '../config/redis.js';
import { routeAndExecute } from '../services/routerService.js';

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

export default worker;
