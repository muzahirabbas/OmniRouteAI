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
 * Implements dual timeout protection:
 * 1. User-specified timeout (default 30s)
 * 2. Maximum poll duration (timeout + 50% buffer, max 60s)
 *
 * @param {string} jobId
 * @param {number} [timeout=30000] - ms
 * @returns {Promise<object>} job result
 */
export async function waitForResult(jobId, timeout = 30000) {
  const startTime = Date.now();
  const pollInterval = 100; // ms
  
  // Maximum poll duration: timeout + 50% buffer, capped at 60s
  const maxPollDuration = Math.min(timeout * 1.5, 60000);
  
  // Track consecutive failures to detect stuck jobs
  let consecutiveNullResponses = 0;
  const MAX_NULL_RESPONSES = 50; // ~5 seconds of null responses

  while (Date.now() - startTime < timeout) {
    // Check max poll duration
    if (Date.now() - startTime > maxPollDuration) {
      const timeoutErr = new Error(`Job ${jobId} exceeded maximum poll duration of ${maxPollDuration}ms`);
      timeoutErr.statusCode = 504;
      timeoutErr.name = 'PollTimeoutError';
      throw timeoutErr;
    }

    const job = await getQueue().getJob(jobId);

    // Detect stuck job (job disappeared from queue)
    if (!job) {
      consecutiveNullResponses++;
      
      if (consecutiveNullResponses >= MAX_NULL_RESPONSES) {
        const err = new Error(`Job ${jobId} disappeared from queue after ${consecutiveNullResponses} attempts`);
        err.statusCode = 500;
        err.name = 'JobLostError';
        throw err;
      }
      
      await sleep(pollInterval);
      continue;
    }
    
    // Reset null counter if job exists
    consecutiveNullResponses = 0;

    const state = await job.getState();

    if (state === 'completed') {
      return job.returnvalue;
    }

    if (state === 'failed') {
      const reason = job.failedReason || 'Job failed';
      const err = new Error(reason);

      // Reconstruct known error types for correct HTTP status mapping in API
      if (reason.includes('All providers and keys exhausted')) {
        err.name = 'AllProvidersExhaustedError';
        err.statusCode = 503;
      } else if (reason.includes('timed out')) {
        err.name = 'TimeoutError';
        err.statusCode = 504;
      } else if (reason.includes('HTTP')) {
        err.name = 'ProviderError';
        err.statusCode = 502;
      }

      throw err;
    }

    // Check if job is stuck in active state for too long
    if (state === 'active') {
      const jobInfo = await job.getInfo();
      const processingTime = Date.now() - (jobInfo?.processedOn || startTime);
      
      // If processing for more than 2x timeout, consider it stuck
      if (processingTime > timeout * 2) {
        console.warn(JSON.stringify({
          level: 'warn',
          msg: 'Job stuck in active state',
          jobId,
          processingTime,
          timeout,
        }));
      }
    }

    await sleep(pollInterval);
  }

  const timeoutErr = new Error(`Job ${jobId} timed out after ${timeout}ms`);
  timeoutErr.statusCode = 504;
  timeoutErr.name = 'JobTimeoutError';
  throw timeoutErr;
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
