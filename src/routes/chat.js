import { v4 as uuidv4 } from 'uuid';
import { rateLimiters } from '../utils/rateLimiter.js';

/**
 * Chat completions route plugin.
 *
 * Routes:
 *   POST /v1/chat/completions  — main endpoint (custom prompt format)
 *   POST /v1/responses        — OpenAI Responses API format (hybrid)
 *   GET  /health              — health check
 *   GET  /v1/models           — model discovery
 *
 * Key behaviors:
 * - stream=true  → BYPASSES BullMQ queue entirely → streams directly via adapter
 * - stream=false → enqueues to BullMQ worker → waits for result
 * - Cache key includes systemPrompt to avoid cross-instruction collisions
 * - Supports both custom 'prompt' and OpenAI 'messages'/'input' formats
 */

// Helper to retrieve previous response for conversation threading
async function getPreviousResponse(previousResponseId) {
  if (!previousResponseId) return null;
  
  try {
    const { get } = await import('../config/redis.js');
    const key = `response:${previousResponseId}`;
    const cached = await get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn('Failed to get previous response:', err.message);
  }
  return null;
}

// Helper to store response for later retrieval
async function storeResponse(responseId, response) {
  try {
    const { setex } = await import('../config/redis.js');
    const key = `response:${responseId}`;
    await setex(key, 86400, JSON.stringify(response));
  } catch (err) {
    console.warn('Failed to store response:', err.message);
  }
}

export async function chatRoutes(app) {

  // Apply rate limiting to chat endpoints
  app.addHook('onRequest', async (request, reply) => {
    if ((request.url.includes('/chat/completions') || request.url.includes('/responses') || request.url.includes('/v1/chat')) 
        && request.method !== 'OPTIONS') {
      return rateLimiters.chat(request, reply);
    }
  });

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

  // ─── Specific Model Details ─────────────────────────────────────────────
  app.get('/v1/models/:model', async (request, reply) => {
    const { model } = request.params;

    const { getProviders } = await import('../config/providers.js');
    const providers = await getProviders();

    for (const provider of providers) {
      const models = provider.models || [];
      if (models.includes(model)) {
        return {
          id: model,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.name,
          provider: provider.name,
          features: provider.features || [],
        };
      }
    }

    return reply.code(404).send({
      error: {
        message: `Model '${model}' not found`,
        type: 'invalid_request_error',
        param: 'model',
        code: 'model_not_found'
      }
    });
  });

  // ─── Provider-Optional Model Discovery ─────────────────────────────────
  app.get('/:provider/v1/models', async (request, reply) => {
    const { getProviders } = await import('../config/providers.js');
    const allProviders = await getProviders();
    
    const providerName = request.params.provider;
    const provider = allProviders.find(p => p.name === providerName);
    
    if (!provider) {
      return reply.code(404).send({
        error: 'Provider not found',
        message: `Provider '${providerName}' is not available`,
        available_providers: allProviders.filter(p => p.status === 'active').map(p => p.name)
      });
    }
    
    const models = (provider.models || []).map(m => ({
      id:       m,
      object:   'model',
      created:  Math.floor(Date.now() / 1000),
      owned_by: provider.name,
      features: provider.features || []
    }));
    
    return { object: 'list', data: models };
  });

  // ─── CORS Preflight for SSE ─────────────────────────────────────────
  app.options('/v1/chat/completions', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    reply.raw.end();
  });

  app.options('/v1/responses', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    reply.raw.end();
  });

  // ─── CORS Preflight for Path-Based Provider Endpoints ───────────────────
  app.options('/:provider/v1/chat/completions', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    reply.raw.end();
  });

  app.options('/:provider/v1/responses', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    reply.raw.end();
  });

  app.options('/:provider/v1/models', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    reply.raw.end();
  });

  // ─── Helper: Normalize OpenAI input to internal format ────────────────
  const normalizeInput = (body, urlProvider = null) => {
    const normalized = {
      prompt: null,
      model: body.model || null,
      // URL provider takes priority over body provider
      provider: urlProvider || body.provider || null,
      task_type: body.task_type || null,
      system_prompt: body.system_prompt || null,
      stream: body.stream || false,
      noContext: body.no_context || body.noContext || false,
      // OpenAI standard fields
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_tokens,
      max_completion_tokens: body.max_completion_tokens,
      stop: body.stop || null,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      logit_bias: body.logit_bias,
      user: body.user || null,
      seed: body.seed,
      // Response control
      response_format: body.response_format,
      // Tools
      tools: body.tools,
      tool_choice: body.tool_choice,
       // Reasoning
       reasoning_effort: body.reasoning_effort || body.thinking?.effort,
       include_reasoning: body.include_reasoning,
       // Additional OpenAI fields
       previous_response_id: body.previous_response_id,
       prediction: body.prediction,
       store: body.store,
       metadata: body.metadata,
       priority: body.priority || 'normal',
    };

    // Handle different input formats
    if (body.messages) {
      // OpenAI Chat Completions format
      const messages = body.messages;
      const systemMsg = messages.find(m => m.role === 'system');
      const userMsgs = messages.filter(m => m.role === 'user');
      
      if (systemMsg && !normalized.system_prompt) {
        normalized.system_prompt = systemMsg.content;
      }
      
      // Save the full conversation messages array
      normalized.messages = messages.filter(m => m.role !== 'system');
      
      // Combine all user messages as the fallback prompt
      normalized.prompt = userMsgs.map(m => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.content)) {
          // Handle multimodal content array
          return m.content.map(c => {
            if (c.type === 'text') return c.text;
            if (c.type === 'image_url') {
              const url = c.image_url?.url || '';
              if (url.startsWith('data:')) return { type: 'image', data: url.split(',')[1], media_type: url.split(';')[0].split(':')[1] };
              return { type: 'image', data: url, media_type: 'image/png' };
            }
            return null;
          }).filter(Boolean);
        }
        return null;
      }).filter(Boolean).flat();
      
      // Flatten if all strings
      if (normalized.prompt.every(p => typeof p === 'string')) {
        normalized.prompt = normalized.prompt.join('\n');
      }
    } else if (body.input) {
      // OpenAI Responses API format - input can be string or array
      normalized.prompt = body.input;
    } else if (body.prompt !== undefined) {
      // Custom OmniRouteAI format
      normalized.prompt = body.prompt;
    }

    return normalized;
  };

  // ─── Helper: Transform response to OpenAI format ──────────────────────
   const toOpenAIResponse = (result, requestId, include_reasoning, stream = false) => {
    const responseId = `chatcmpl-${uuidv4().slice(0, 8)}`;
    const created = Math.floor(Date.now() / 1000);
    
    if (stream) {
      // Streaming response - format handled in stream callback
      return result;
    }

    // Non-streaming OpenAI Responses API format
    const choices = [{
      index: 0,
      message: {
        role: 'assistant',
        content: result.output || '',
        ...(result.thinking && include_reasoning !== false ? { reasoning: result.thinking } : {}),
        ...(result.tool_calls && result.tool_calls.length > 0 ? { tool_calls: result.tool_calls } : {}),
      },
      finish_reason: result.finish_reason || 'stop',
    }];

    const inputTokens = result.tokens?.input || 0;
    const outputTokens = result.tokens?.output || 0;
    const reasoningTokens = result.tokens?.reasoning || 0;

    return {
      id: responseId,
      object: 'chat.completion',
      created,
      model: result.model,
      choices,
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        ...(reasoningTokens ? { output_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
      },
      system_fingerprint: `fp_${uuidv4().slice(0, 8)}`,
    };
  };

  // ─── Helper: Transform to Responses API format ─────────────────────────
   const toResponsesAPIFormat = (result, requestId, include_reasoning) => {
    const responseId = `resp_${uuidv4().slice(0, 24)}`;
    const messageId = `msg_${uuidv4().slice(0, 24)}`;
    const created = Math.floor(Date.now() / 1000);

    // Build content array
    const content = [];
    if (result.output) {
      content.push({
        type: 'output_text',
        text: result.output,
        annotations: [],
      });
    }

    // Build output array
    const output = [];
    
    // Add tool calls if present
    if (result.tool_calls && result.tool_calls.length > 0) {
      result.tool_calls.forEach(tc => {
        output.push({
          type: 'tool_call',
          id: tc.id || `tool_${uuidv4().slice(0, 8)}`,
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        });
      });
    }

    // Add message
    if (content.length > 0 || result.thinking) {
      output.push({
        type: 'message',
        id: messageId,
        status: 'completed',
        role: 'assistant',
        content,
        ...(result.thinking && include_reasoning !== false ? { reasoning: result.thinking } : {}),
      });
    }

    return {
      id: responseId,
      object: 'response',
      created_at: created,
      status: 'completed',
      model: result.model,
      output,
      usage: {
        input_tokens: result.tokens?.input || 0,
        output_tokens: result.tokens?.output || 0,
        total_tokens: (result.tokens?.input || 0) + (result.tokens?.output || 0),
        ...(result.tokens?.reasoning ? { output_tokens_details: { reasoning_tokens: result.tokens.reasoning } } : {}),
      },
      service_tier: 'standard',
      metadata: {},
    };
  };

  // ─── Common request handler ──────────────────────────────────────────
  const handleChatRequest = async (request, reply, isResponsesAPI = false) => {
    const requestId = request.requestId;
    const startTime = Date.now();

    // Normalize input based on format - pass URL provider param
    const urlProvider = request.params?.provider || null;
    const input = normalizeInput(request.body, urlProvider);
    const { prompt, messages, model, provider: providerOverride, task_type, system_prompt, stream, noContext, priority, previous_response_id, store, include_reasoning } = input;
    const requestPriority = priority || 'normal';
    
    // Handle "auto" provider - treat as no override to enable auto-selection
    const effectiveProvider = (providerOverride === 'auto' || !providerOverride) ? null : providerOverride;
    
    // Additional OpenAI options
    const options = {
      messages: messages,
      temperature: input.temperature,
      top_p: input.top_p,
      max_tokens: input.max_tokens,
      max_completion_tokens: input.max_completion_tokens,
      stop: input.stop,
      presence_penalty: input.presence_penalty,
      frequency_penalty: input.frequency_penalty,
      logit_bias: input.logit_bias,
      user: input.user,
      seed: input.seed,
      response_format: input.response_format,
      tools: input.tools,
      tool_choice: input.tool_choice,
      reasoningEffort: input.reasoning_effort,
      prediction: input.prediction,
      metadata: input.metadata,
    };

    // Late-import to avoid circular dependency at module load
    const { getCached, setCached }       = await import('../services/cacheService.js');
    const { routeAndExecute }            = await import('../services/routerService.js');
    const { enqueue, waitForResult }     = await import('../services/queueService.js');
    const { logRequest }                 = await import('../services/loggingService.js');
    const { trackRequest }               = await import('../services/statsService.js');

    // ── Input validation ───────────────────────────────────────────────
    const getPromptTextLength = (p) => {
      if (typeof p === 'string') return p.length;
      if (Array.isArray(p)) {
        return p.reduce((acc, part) => acc + (part.text ? part.text.length : (typeof part === 'string' ? part.length : 0)), 0);
      }
      return 0;
    };

    const promptLength = getPromptTextLength(prompt);

    // Validate prompt is not empty (must have prompt, messages, or input)
    if (promptLength === 0 && (!messages || messages.length === 0)) {
      reply.code(400).send({
        error: {
          message: 'No input provided. Include "messages", "prompt", or "input" in the request body.',
          type: 'invalid_request_error',
          code: 'missing_input',
        },
      });
      return;
    }

    if (promptLength > 100000) {
      console.error(`[VALIDATION] prompt too long: ${promptLength} chars`);
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

    // ── Conversation threading: prepend previous conversation ───────────
    let processedPrompt = prompt;
    if (isResponsesAPI && previous_response_id) {
      const prevResponse = await getPreviousResponse(previous_response_id);
      if (prevResponse && prevResponse.output) {
        const prevText = Array.isArray(prevResponse.output)
          ? prevResponse.output.map(o => o.text || o.content || '').join('\n')
          : prevResponse.output;
        if (typeof processedPrompt === 'string') {
          processedPrompt = `Previous conversation:\n${prevText}\n\nCurrent input:\n${processedPrompt}`;
        } else if (Array.isArray(processedPrompt)) {
          processedPrompt = [{ type: 'text', text: `Previous conversation:\n${prevText}\n\nCurrent input:` }, ...processedPrompt];
        }
      }
    }

    // ── 1. Check cache ─────────────────────────────────────────────────
    if (!stream) {
      try {
        const cached = await getCached(processedPrompt, model, task_type, system_prompt);
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

          // Return in requested format
          if (isResponsesAPI) {
             const responseObj = toResponsesAPIFormat({ ...cached, model: cached.model }, requestId, include_reasoning);
            if (store) {
              const responseId = responseObj.id;
              await storeResponse(responseId, { output: cached.output, model: cached.model, tokens: cached.tokens });
            }
            return responseObj;
          }
           return toOpenAIResponse({ ...cached, model: cached.model }, requestId, include_reasoning, false);
        }
      } catch {
        // Cache read error → continue normally
      }
    }

    // ── 2. Streaming → BYPASS QUEUE, pipe directly to client ─────────
    if (stream) {
      const abortController = new AbortController();
      request.raw.on('close', () => {
        if (!reply.raw.writableEnded) {
          abortController.abort();
        }
      });

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Request-Id':  requestId,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Type, X-Request-Id',
      });

      try {
        await routeAndExecute(processedPrompt, {
          model,
          provider:     effectiveProvider,
          taskType:     task_type,
          systemPrompt: system_prompt,
          noContext,
          requestId,
          stream: true,
          abortSignal: abortController.signal,
          ...options,
          onChunk: (chunk) => {
            // Transform chunk to OpenAI format
            const chunkId = `chatcmpl-${uuidv4().slice(0, 8)}`;
            const delta = { role: 'assistant' };
            if (chunk.content) delta.content = chunk.content;
            if (chunk.reasoning) delta.reasoning = chunk.reasoning;
            if (chunk.tool_calls) delta.tool_calls = chunk.tool_calls;

            const streamChunk = {
              id: chunkId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: chunk.model || model,
              choices: [{
                index: 0,
                delta,
                finish_reason: null,
              }],
              system_fingerprint: `fp_${uuidv4().slice(0, 8)}`,
            };
            reply.raw.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
          },
          onDone: (result) => {
            const finalChunkId = `chatcmpl-${uuidv4().slice(0, 8)}`;
            const finalChunk = {
              id: finalChunkId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: result.model,
              choices: [{
                index: 0,
                delta: {
                  role: 'assistant',
                  ...(result.thinking && include_reasoning !== false ? { reasoning: result.thinking } : {}),
                },
                finish_reason: result.finish_reason || 'stop',
              }],
              system_fingerprint: `fp_${uuidv4().slice(0, 8)}`,
            };
            reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            reply.raw.write('data: [DONE]\n\n');
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
            const errorChunk = {
              error: {
                message: err.message,
                type: 'invalid_request_error',
                code: err.statusCode || 500,
              },
            };
            reply.raw.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
            reply.raw.end();

            const latency = Date.now() - startTime;
            logRequest({
              request_id: requestId,
              provider:   err.provider || providerOverride || 'omniroute',
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
        const errorChunk = {
          error: {
            message: err.message,
            type: 'invalid_request_error',
            code: err.statusCode || 500,
          },
        };
        reply.raw.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        reply.raw.end();
        
        const latency = Date.now() - startTime;
        logRequest({
          request_id: requestId,
          provider:   err.provider || providerOverride || 'omniroute',
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

    // ── 3. Non-streaming → enqueue to BullMQ worker ────────────────────
    const timeout = input.timeout ? parseInt(input.timeout, 10) : 30000;

    const priorityMap = { low: 10, normal: 5, high: 2, critical: 1 };
    const bullPriority = priorityMap[requestPriority] || 5;

    try {
      const jobId = await enqueue({
        prompt: processedPrompt,
        model,
        provider: effectiveProvider,
        task_type,
        system_prompt,
        noContext,
        requestId,
        ...options,
      }, { priority: bullPriority });

      const result = await waitForResult(jobId, timeout);

      if (!result) throw new Error('No result returned from provider');

      const latency = Date.now() - startTime;

      setCached(prompt, model, task_type, system_prompt, {
        output:   result.output,
        provider: result.provider,
        model:    result.model,
        tokens:   result.tokens,
      }).catch(() => {});

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

      if (isResponsesAPI) {
        const responseObj = toResponsesAPIFormat(result, requestId);
        if (store) {
          const responseId = responseObj.id;
          await storeResponse(responseId, { output: result.output, model: result.model, tokens: result.tokens });
        }
        return responseObj;
      }
      
      return toOpenAIResponse(result, requestId, include_reasoning, false);
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        msg:   'Queue execution failed, falling back to direct',
        error: err.message,
        requestId,
      }));

      try {
        const abortController = new AbortController();
        request.raw.on('close', () => {
          abortController.abort();
        });

        const result = await routeAndExecute(processedPrompt, {
          model,
          provider:     effectiveProvider,
          taskType:     task_type,
          systemPrompt: system_prompt,
          noContext,
          requestId,
          stream: false,
          abortSignal: abortController.signal,
          ...options,
        });

        if (!result) throw new Error('No result returned from provider');

        const latency = Date.now() - startTime;

setCached(processedPrompt, model, task_type, system_prompt, {
          output:   result.output,
          provider: result.provider,
          model:    result.model,
          tokens:   result.tokens,
        }).catch(() => {});

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

        if (isResponsesAPI) {
          const responseObj = toResponsesAPIFormat(result, requestId, include_reasoning);
          if (store) {
            const responseId = responseObj.id;
            await storeResponse(responseId, { output: result.output, model: result.model, tokens: result.tokens });
          }
          return responseObj;
        }
        
        return toOpenAIResponse(result, requestId, include_reasoning, false);
      } catch (fallbackErr) {
        const latency = Date.now() - startTime;

        logRequest({
          request_id: requestId,
          provider:   fallbackErr.provider || providerOverride || 'omniroute',
          model:      fallbackErr.model || model || 'unknown',
          key:        'unknown',
          latency,
          tokens:     { input: 0, output: 0 },
          status:     'error',
          error:      fallbackErr.message,
        }).catch(() => {});

        const statusCode = fallbackErr.statusCode || 500;
        reply.code(statusCode).send({
          error:      fallbackErr.name || 'InternalError',
          message:    fallbackErr.message,
          provider:   fallbackErr.provider || providerOverride || 'unknown',
          model:      fallbackErr.model || model || 'unknown',
          request_id: requestId,
        });
      }
    }
  };

  // ─── Chat completions (OpenAI spec + custom prompt format) ───────────
  app.post('/v1/chat/completions', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                content: {},
                name: { type: 'string' },
                tool_call_id: { type: 'string' },
                tool_calls: { type: 'array' }
              }
            }
          },
          prompt: {
            anyOf: [
              { type: 'string', minLength: 1, maxLength: 100000 },
              {
                type: 'array',
                minItems: 1,
                items: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      required: ['type'],
                      properties: {
                        type:       { type: 'string', enum: ['text', 'image', 'audio', 'video'] },
                        text:       { type: 'string' },
                        data:       { type: 'string' },
                        media_type: { type: 'string' }
                      }
                    }
                  ]
                }
              }
            ]
          },
          model:                  { type: 'string' },
          provider:                { type: 'string' },
          task_type:               { type: 'string' },
          system_prompt:           { type: 'string', maxLength: 4000 },
          stream:                  { type: 'boolean', default: false },
          noContext:               { type: 'boolean', default: false },
          no_context:              { type: 'boolean', default: false },
          temperature:             { type: 'number', minimum: 0, maximum: 2 },
          top_p:                   { type: 'number', minimum: 0, maximum: 1 },
          max_tokens:              { type: 'integer', minimum: 1 },
          max_completion_tokens:   { type: 'integer', minimum: 1 },
          stop:                    { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          presence_penalty:        { type: 'number', minimum: -2, maximum: 2 },
          frequency_penalty:      { type: 'number', minimum: -2, maximum: 2 },
          logit_bias:              { type: 'object' },
          user:                    { type: 'string' },
          seed:                    { type: 'integer' },
          response_format:        { type: 'object' },
          tools:                   { type: 'array' },
          tool_choice:             { anyOf: [{ type: 'string' }, { type: 'object' }] },
          prediction:             { type: 'object' },
          store:                   { type: 'boolean' },
          metadata:                { type: 'object' },
priority:               { type: 'string', enum: ['low', 'normal', 'high', 'critical'], default: 'normal' },
          include_reasoning:    { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    return handleChatRequest(request, reply, false);
  });

  // ─── OpenAI Responses API ────────────────────────────────────────────
  app.post('/v1/responses', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        required: ['model'],
        properties: {
          model:                  { type: 'string' },
          input:                  { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                content: {},
                name: { type: 'string' },
                tool_call_id: { type: 'string' },
                tool_calls: { type: 'array' }
              }
            }
          },
          prompt:                  { type: 'string' },
          provider:                { type: 'string' },
          task_type:               { type: 'string' },
          system_prompt:           { type: 'string', maxLength: 4000 },
          stream:                  { type: 'boolean', default: false },
          no_context:              { type: 'boolean', default: false },
          temperature:             { type: 'number', minimum: 0, maximum: 2 },
          top_p:                   { type: 'number', minimum: 0, maximum: 1 },
          max_tokens:              { type: 'integer', minimum: 1 },
          max_completion_tokens:   { type: 'integer', minimum: 1 },
          stop:                    { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          presence_penalty:       { type: 'number', minimum: -2, maximum: 2 },
          frequency_penalty:      { type: 'number', minimum: -2, maximum: 2 },
          logit_bias:              { type: 'object' },
          user:                   { type: 'string' },
          seed:                    { type: 'integer' },
          response_format:        { type: 'object' },
          tools:                   { type: 'array' },
          tool_choice:             { anyOf: [{ type: 'string' }, { type: 'object' }] },
          reasoning_effort:        { type: 'string', enum: ['low', 'medium', 'high'] },
          thinking:                { type: 'object', properties: { effort: { type: 'string' } } },
          previous_response_id:    { type: 'string' },
          prediction:              { type: 'object' },
          store:                   { type: 'boolean' },
          metadata:                { type: 'object' },
          include:                 { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    return handleChatRequest(request, reply, true);
  });

  // ─── Provider-Specific Chat Completions ────────────────────────────────
  app.post('/:provider/v1/chat/completions', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                content: {},
                name: { type: 'string' },
                tool_call_id: { type: 'string' },
                tool_calls: { type: 'array' }
              }
            }
          },
          prompt: {
            anyOf: [
              { type: 'string', minLength: 1, maxLength: 100000 },
              {
                type: 'array',
                minItems: 1,
                items: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      required: ['type'],
                      properties: {
                        type:       { type: 'string', enum: ['text', 'image', 'audio', 'video'] },
                        text:       { type: 'string' },
                        data:       { type: 'string' },
                        media_type: { type: 'string' }
                      }
                    }
                  ]
                }
              }
            ]
          },
          model:                  { type: 'string' },
          task_type:               { type: 'string' },
          system_prompt:           { type: 'string', maxLength: 4000 },
          stream:                  { type: 'boolean', default: false },
          noContext:               { type: 'boolean', default: false },
          no_context:              { type: 'boolean', default: false },
          temperature:             { type: 'number', minimum: 0, maximum: 2 },
          top_p:                   { type: 'number', minimum: 0, maximum: 1 },
          max_tokens:              { type: 'integer', minimum: 1 },
          max_completion_tokens:   { type: 'integer', minimum: 1 },
          stop:                    { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          presence_penalty:        { type: 'number', minimum: -2, maximum: 2 },
          frequency_penalty:      { type: 'number', minimum: -2, maximum: 2 },
          logit_bias:              { type: 'object' },
          user:                    { type: 'string' },
          seed:                    { type: 'integer' },
          response_format:        { type: 'object' },
          tools:                   { type: 'array' },
          tool_choice:             { anyOf: [{ type: 'string' }, { type: 'object' }] },
          prediction:              { type: 'object' },
          store:                   { type: 'boolean' },
          metadata:                { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    return handleChatRequest(request, reply, false);
  });

  // ─── Provider-Specific OpenAI Responses API ───────────────────────────
  app.post('/:provider/v1/responses', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          model:         { type: 'string' },
          input:         { type: 'string' },
          messages:      { type: 'array' },
          prompt:        { type: 'string' },
          task_type:     { type: 'string' },
          system_prompt: { type: 'string', maxLength: 4000 },
          stream:        { type: 'boolean', default: false },
          no_context:   { type: 'boolean', default: false },
          temperature:   { type: 'number', minimum: 0, maximum: 2 },
          top_p:         { type: 'number', minimum: 0, maximum: 1 },
          max_tokens:    { type: 'integer', minimum: 1 },
          response_format: { type: 'object' },
          tools:         { type: 'array' },
          tool_choice:   { anyOf: [{ type: 'string' }, { type: 'object' }] },
          reasoning_effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          thinking:      { type: 'object', properties: { effort: { type: 'string' } } },
          previous_response_id: { type: 'string' },
          include:       { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    return handleChatRequest(request, reply, true);
  });

  // ─── Batch Chat Completions ─────────────────────────────────────────────
  app.post('/v1/batches', {
    schema: {
      body: {
        type: 'object',
        required: ['requests'],
        properties: {
          requests: {
            type: 'array',
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                custom_id: { type: 'string' },
                method: { type: 'string', enum: ['POST'] },
                url: { type: 'string' },
                body: { type: 'object' }
              }
            }
          },
          timeout: { type: 'integer', minimum: 1000, default: 30000 }
        }
      }
    }
  }, async (request, reply) => {
    const { requests, timeout } = request.body;
    const { routeAndExecute } = await import('../services/routerService.js');

    const results = await Promise.allSettled(
      requests.map(async (req, idx) => {
        try {
          // Normalize each sub-request through the same input pipeline
          const subInput = normalizeInput(req.body || {});
          const subPrompt = subInput.prompt;
          const subMessages = subInput.messages;
          const subOptions = {
            messages: subMessages,
            temperature: subInput.temperature,
            top_p: subInput.top_p,
            max_tokens: subInput.max_tokens,
            max_completion_tokens: subInput.max_completion_tokens,
            response_format: subInput.response_format,
            tools: subInput.tools,
            tool_choice: subInput.tool_choice,
            reasoningEffort: subInput.reasoning_effort,
          };

          const result = await routeAndExecute(subPrompt, {
            model: subInput.model,
            provider: subInput.provider === 'auto' ? null : subInput.provider,
            taskType: subInput.task_type,
            systemPrompt: subInput.system_prompt,
            noContext: subInput.noContext,
            stream: false,
            requestId: `${request.requestId}-batch-${idx}`,
            ...subOptions,
          });
          return { custom_id: req.custom_id, response: toOpenAIResponse(result, `${request.requestId}-batch-${idx}`, false, false), error: null };
        } catch (err) {
          return { custom_id: req.custom_id, response: null, error: err.message };
        }
      })
    );

    return {
      object: 'batch',
      data: results.map(r => r.value || r.reason),
    };
  });
}