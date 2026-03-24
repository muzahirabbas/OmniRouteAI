import { Queue } from 'bullmq';
import { createDuplicate } from '../config/redis.js';

/**
 * BullMQ queue for non-streaming chat completions.
 * Streaming requests bypass this entirely.
 */

let queue;

function getQueue() {
  if (!queue) {
    queue = new Queue('chat-completions', {
      connection: createDuplicate(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
        attempts: 1, // Retries are handled at the router level, not queue level
      },
    });
  }
  return queue;
}
/**
 * Enqueue a chat completion job.
 *
 * @param {object} data - { prompt, model, taskType, requestId }
 * @returns {Promise<string>} job ID
 */
export async function enqueue(data) {
  const job = await getQueue().add('chat-completion', data, {
    jobId: data.requestId, // Use request ID as job ID for easy lookup
  });
  return job.id;
}

/**
 * Wait for a job result with timeout.
 * Polls job state until completed or failed.
 *
 * @param {string} jobId
 * @param {number} [timeout=30000] - ms
 * @returns {Promise<object>} job result
 */
export async function waitForResult(jobId, timeout = 30000) {
  const startTime = Date.now();
  const pollInterval = 100; // ms

  while (Date.now() - startTime < timeout) {
    const job = await getQueue().getJob(jobId);

    if (!job) {
      await sleep(pollInterval);
      continue;
    }

    const state = await job.getState();

    if (state === 'completed') {
      return job.returnvalue;
    }

    if (state === 'failed') {
      throw new Error(job.failedReason || 'Job failed');
    }

    await sleep(pollInterval);
  }

  throw new Error(`Job ${jobId} timed out after ${timeout}ms`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get queue instance (for monitoring).
 */
export function getQueueInstance() {
  return getQueue();
}
