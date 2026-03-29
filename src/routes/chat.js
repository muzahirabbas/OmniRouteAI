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

  // ─── Standard OpenAI Model Discovery ─────────────────────────────────
  app.get('/v1/models', async () => {
    const { getProviders } = await import('../config/providers.js');
    const allProviders = await getProviders();
    const models = [];
    const seen = new Set();
    
    allProviders.forEach(p => {
      if (p.models) {
        p.models.forEach(m => {
          if (!seen.has(m)) {
            seen.add(m);
            models.push({
              id:       m,
              object:   'model',
              created:  Math.floor(Date.now() / 1000),
              owned_by: p.name,
              features: p.features || []
            });
          }
        });
      }
    });

    return { object: 'list', data: models };
  });

  // ─── Chat completions ────────────────────────────────────────────────
  app.post('/v1/chat/completions', {
    schema: {
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { 
            oneOf: [
              { type: 'string', minLength: 1, maxLength: 100000 },
              { type: 'array' }
            ]
          },
          model:         { type: 'string' },
          provider:      { type: 'string' },
          task_type:     { type: 'string' },
          system_prompt: { type: 'string', maxLength: 4000 },
          stream:        { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const {
      prompt,
      model,
      provider:      providerOverride,
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

    // ── Input validation ───────────────────────────────────────────────
    // Helper to get total text length for multimodal or standard prompt
    const getPromptTextLength = (p) => {
      if (typeof p === 'string') return p.length;
      if (Array.isArray(p)) {
        return p.reduce((acc, part) => acc + (part.text ? part.text.length : 0), 0);
      }
      return 0;
    };

    const promptLength = getPromptTextLength(prompt);

    if (systemPrompt && systemPrompt.length > 4000) {
      const err = new Error('system_prompt exceeds maximum length of 4000 characters');
      err.statusCode = 400;
      err.name = 'ValidationError';
      reply.code(400).send({
        error: 'ValidationError',
        message: err.message,
        requestId,
      });
      return;
    }

    if (promptLength > 100000) {
      const err = new Error('prompt exceeds maximum length of 100000 characters');
      err.statusCode = 400;
      err.name = 'ValidationError';
      reply.code(400).send({
        error: 'ValidationError',
        message: err.message,
        requestId,
      });
      return;
    }

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
          provider:     providerOverride,
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

            // Log streaming error
            const latency = Date.now() - startTime;
            logRequest({
              request_id: requestId,
              provider:   err.provider || providerOverride || 'unknown',
              model:      err.model || model || 'unknown',
              key:        'unknown',
              latency,
              tokens:     { input: 0, output: 0 },
              status:     'error',
              error:      err.message,
            }).catch(() => {});
          },
        });
      } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        reply.raw.end();
        
        // Log top-level streaming catch error
        const latency = Date.now() - startTime;
        logRequest({
          request_id: requestId,
          provider:   err.provider || providerOverride || 'unknown',
          model:      err.model || model || 'unknown',
          key:        'unknown',
          latency,
          tokens:     { input: 0, output: 0 },
          status:     'error',
          error:      err.message,
        }).catch(() => {});
      }

      return; // Response already sent via raw stream
    }

    // ── 3. Non-streaming → use BullMQ queue ────────────────────────────
    try {
      const jobId  = await enqueue({
        prompt,
        model,
        provider: providerOverride,
        taskType,
        systemPrompt,
        requestId
      });
      const result = await waitForResult(jobId, 120000); // 120s timeout for CLI tools
      if (!result) throw new Error('No result returned from background worker');

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
        provider:   err.provider || providerOverride || 'unknown',
        model:      err.model || model || 'unknown',
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
        provider:   err.provider || 'unknown',
        model:      err.model || model || 'unknown',
        request_id: requestId,
      });
    }
  });
}
