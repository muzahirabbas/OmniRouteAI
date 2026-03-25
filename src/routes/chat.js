import { v4 as uuidv4 } from 'uuid';

/**
 * Chat completions route plugin.
 *
 * Routes:
 *   POST /v1/chat/completions  — main endpoint
 *   GET  /health               — health check
 *
 * Key behaviors:
 * - stream=true  → BYPASSES BullMQ queue entirely → streams directly via adapter
 * - stream=false → enqueues to BullMQ worker → waits for result
 * - Cache key includes systemPrompt to avoid cross-instruction collisions
 */
export async function chatRoutes(app) {

  // ─── Health check ────────────────────────────────────────────────────
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // ─── Chat completions ────────────────────────────────────────────────
  app.post('/v1/chat/completions', {
    schema: {
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt:        { type: 'string', minLength: 1 },
          model:         { type: 'string' },
          task_type:     { type: 'string' },
          system_prompt: { type: 'string' },
          stream:        { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const {
      prompt,
      model,
      task_type:     taskType,
      system_prompt: systemPrompt,
      stream,
    } = request.body;

    const requestId = request.requestId;
    const startTime = Date.now();

    // Late-import to avoid circular dependency at module load
    const { getCached, setCached }       = await import('../services/cacheService.js');
    const { routeAndExecute }            = await import('../services/routerService.js');
    const { enqueue, waitForResult }     = await import('../services/queueService.js');
    const { logRequest }                 = await import('../services/loggingService.js');
    const { trackRequest }               = await import('../services/statsService.js');

    // ── 1. Check cache ─────────────────────────────────────────────────
    // Cache is SKIPPED for streaming (SSE responses are not cacheable)
    if (!stream) {
      try {
        const cached = await getCached(prompt, model, taskType, systemPrompt);
        if (cached) {
          const latency = Date.now() - startTime;

          logRequest({
            request_id: requestId,
            provider:   cached.provider,
            model:      cached.model,
            key:        'cache-hit',
            latency,
            tokens:     cached.tokens || { input: 0, output: 0 },
            status:     'cache_hit',
          }).catch(() => {});

          return {
            output:     cached.output,
            provider:   cached.provider,
            model:      cached.model,
            cached:     true,
            request_id: requestId,
          };
        }
      } catch {
        // Cache read error → continue normally
      }
    }

    // ── 2. Streaming → BYPASS QUEUE, pipe directly to client ─────────
    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Request-Id':  requestId,
      });

      try {
        await routeAndExecute(prompt, {
          model,
          taskType,
          systemPrompt,
          requestId,
          stream: true,
          onChunk: (chunk) => {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          },
          onDone: (result) => {
            reply.raw.write(`data: ${JSON.stringify({ done: true, provider: result.provider, model: result.model })}\n\n`);
            reply.raw.end();

            const latency = Date.now() - startTime;
            logRequest({
              request_id: requestId,
              provider:   result.provider,
              model:      result.model,
              key:        result.keyUsed,
              latency,
              tokens:     result.tokens || { input: 0, output: 0 },
              status:     'success',
            }).catch(() => {});
            trackRequest(result.provider, result.keyUsed, result.tokens).catch(() => {});
          },
          onError: (err) => {
            reply.raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            reply.raw.end();
          },
        });
      } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        reply.raw.end();
      }

      return; // Response already sent via raw stream
    }

    // ── 3. Non-streaming → use BullMQ queue ────────────────────────────
    try {
      const jobId  = await enqueue({ prompt, model, taskType, systemPrompt, requestId });
      const result = await waitForResult(jobId, 30000);

      const latency = Date.now() - startTime;

      // Cache the response (fire-and-forget)
      setCached(prompt, model, taskType, systemPrompt, {
        output:   result.output,
        provider: result.provider,
        model:    result.model,
        tokens:   result.tokens,
      }).catch(() => {});

      // Log (fire-and-forget)
      logRequest({
        request_id: requestId,
        provider:   result.provider,
        model:      result.model,
        key:        result.keyUsed,
        latency,
        tokens:     result.tokens || { input: 0, output: 0 },
        status:     'success',
      }).catch(() => {});

      // Track stats (fire-and-forget)
      trackRequest(result.provider, result.keyUsed, result.tokens).catch(() => {});

      return {
        output:     result.output,
        provider:   result.provider,
        model:      result.model,
        request_id: requestId,
      };
    } catch (err) {
      const latency = Date.now() - startTime;

      logRequest({
        request_id: requestId,
        provider:   'unknown',
        model:      model || 'unknown',
        key:        'unknown',
        latency,
        tokens:     { input: 0, output: 0 },
        status:     'error',
        error:      err.message,
      }).catch(() => {});

      const statusCode = err.statusCode || 500;
      reply.code(statusCode).send({
        error:      err.name || 'InternalError',
        message:    err.message,
        request_id: requestId,
      });
    }
  });
}
