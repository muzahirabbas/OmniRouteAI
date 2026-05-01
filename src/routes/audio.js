import { transcribe } from '../services/routerService.js';
import { logRequest } from '../services/loggingService.js';
import { trackRequest } from '../services/statsService.js';
import { ProviderError } from '../utils/errors.js';
import { rateLimiters } from '../utils/rateLimiter.js';

export async function audioRoutes(app) {
  // Rate limiting for audio endpoints
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.includes('/audio/')) {
      return rateLimiters.chat(request, reply);
    }
  });

  // POST /v1/audio/speech - Text to Speech
  app.post('/v1/audio/speech', {
    schema: {
      body: {
        type: 'object',
        required: ['model', 'input', 'voice'],
        properties: {
          model: { type: 'string' },
          input: { type: 'string' },
          voice: { type: 'string', enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] },
          response_format: { type: 'string', enum: ['mp3', 'opus', 'aac', 'flac'], default: 'mp3' },
          speed: { type: 'number', minimum: 0.25, maximum: 4.0, default: 1.0 }
        }
      }
    }
  }, async (request, reply) => {
    return reply.code(501).send({
      error: {
        message: 'Audio speech endpoint not yet implemented',
        type: 'not_implemented_error',
        code: 'not_implemented'
      }
    });
  });

  // ─── Common transcription handler ───────────────────────────────────
  const handleTranscription = async (request, reply, providerOverride = null) => {
    const startTime = Date.now();

    console.log(JSON.stringify({
      level: 'info',
      msg: 'HANDLER_ENTERED - Audio transcription',
      requestId: request.requestId,
      contentType: request.headers['content-type'],
      providerOverride,
    }));

    let fileBuffer = null;
    let parts = {};

    try {
      // FIX: Consume file stream in loop to prevent hang + add timeout
      const MULTIPART_TIMEOUT = 30000; // 30s timeout for multipart parsing

      const partsPromise = (async () => {
        for await (const part of request.parts()) {
          if (part.fieldname === 'file') {
            parts.file = part;
            // CRITICAL: Must consume stream here to prevent busboy hang
            fileBuffer = await part.toBuffer();
          } else {
            parts[part.fieldname] = part.value;
          }
        }
        return fileBuffer;
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Multipart parsing timeout after 30s')), MULTIPART_TIMEOUT)
      );

      try {
        fileBuffer = await Promise.race([partsPromise, timeoutPromise]);
      } catch (parseErr) {
        console.log(JSON.stringify({
          level: 'error',
          msg: 'Multipart parsing failed',
          requestId: request.requestId,
          error: parseErr.message,
        }));
        return reply.code(408).send({
          error: {
            message: 'Request timeout during file upload',
            type: 'timeout_error'
          }
        });
      }

      console.log(JSON.stringify({
        level: 'info',
        msg: 'MULTIPART_PARSE_COMPLETE',
        requestId: request.requestId,
        hasFile: !!parts.file,
        fileSize: fileBuffer?.length,
      }));

      if (!parts.file || !fileBuffer) {
        return reply.code(400).send({
          error: {
            message: 'Missing required field: file',
            type: 'invalid_request_error',
            code: 'missing_file'
          }
        });
      }

      if (!parts.model) {
        return reply.code(400).send({
          error: {
            message: 'Missing required field: model',
            type: 'invalid_request_error',
            code: 'missing_model'
          }
        });
      }

      const mimeType = parts.file.mimetype || 'audio/wav';
      const fileSize = fileBuffer.length;

      const ALLOWED_MIME_TYPES = [
        'audio/mpeg',    // mp3
        'audio/mp4',     // m4a
        'audio/wav',     // wav
        'audio/x-wav',   // wav variant
        'audio/webm',    // webm
        'audio/ogg',     // ogg
        'audio/flac',    // flac
        'audio/aac',     // aac
        'audio/x-m4a',   // m4a variant
      ];

      const cleanMimeType = mimeType.split(';')[0].trim().toLowerCase();
      if (!ALLOWED_MIME_TYPES.includes(cleanMimeType)) {
        return reply.code(415).send({
          error: {
            message: `Unsupported file type: ${mimeType}. Allowed types: mp3, mp4, wav, webm, ogg, flac, aac`,
            type: 'invalid_request_error',
            code: 'unsupported_file_type'
          }
        });
      }

      const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
      if (fileSize > MAX_FILE_SIZE) {
        return reply.code(413).send({
          error: {
            message: `File too large: ${fileSize} bytes. Maximum allowed: ${MAX_FILE_SIZE} bytes`,
            type: 'invalid_request_error',
            code: 'file_too_large'
          }
        });
      }

      // Use providerOverride from URL param, or body field
      const effectiveProvider = providerOverride || parts.provider || undefined;

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Transcription request received',
        requestId: request.requestId,
        fileSize: fileBuffer.length,
        mimeType,
        model: parts.model,
        provider: effectiveProvider,
      }));

      const result = await transcribe(fileBuffer, {
        model: parts.model,
        language: parts.language,
        response_format: parts.response_format,
        timestamp_granularities: parts.timestamp_granularities,
        mimeType,
        filename: parts.file.filename || 'audio.wav',
        requestId: request.requestId,
        provider: effectiveProvider,
      });

      const latency = Date.now() - startTime;

      console.log(JSON.stringify({
        level: 'info',
        msg: 'TRANSCRIPTION_COMPLETE - Sending response',
        requestId: request.requestId,
        provider: result.provider,
        latency,
      }));

      // FIX: Schedule async logging BEFORE the return statement (was dead code after return)
      setImmediate(async () => {
        try {
          await logRequest({
            request_id: request.requestId,
            provider: result.provider,
            model: result.model,
            key: result.keyUsed,
            latency,
            tokens: result.tokens,
            status: 'success',
          });
          await trackRequest(result.provider, result.keyUsed, {
            input: result.tokens.input,
            output: result.tokens.output,
          });
        } catch (logErr) {
          console.error(JSON.stringify({
            level: 'error',
            msg: 'Background logging failed',
            requestId: request.requestId,
            error: logErr.message,
          }));
        }
      });

      return reply.send({
        text: result.text,
        duration: result.duration,
        words: result.words || [],
        language: result.language,
      });

    } catch (err) {
      const latency = Date.now() - startTime;
      const errorMsg = err.message || 'Unknown error';
      const errorCode = err.statusCode || 502;

      console.log(JSON.stringify({
        level: 'error',
        msg: 'Transcription error',
        requestId: request.requestId,
        error: errorMsg,
        errorCode,
      }));

      // FIX: Schedule async error logging BEFORE the return statement (was dead code after return)
      setImmediate(async () => {
        try {
          await logRequest({
            request_id: request.requestId,
            provider: err.provider || 'unknown',
            model: err.model || 'unknown',
            key: 'unknown',
            latency,
            tokens: { input: 0, output: 0 },
            status: 'error',
            error: errorMsg,
          });
        } catch (logErr) {
          console.error(JSON.stringify({
            level: 'error',
            msg: 'Error logging failed',
            requestId: request.requestId,
            error: logErr.message,
          }));
        }
      });

      const errorResponse = (err instanceof ProviderError)
        ? { error: { message: errorMsg, type: 'server_error', code: String(errorCode) } }
        : { error: { message: errorMsg, type: 'server_error' } };

      return reply.code(err instanceof ProviderError ? errorCode : 500).send(errorResponse);
    }
  };

  // POST /v1/audio/transcriptions - Speech to Text
  app.post('/v1/audio/transcriptions', async (request, reply) => {
    return handleTranscription(request, reply);
  });

  // POST /:provider/v1/audio/transcriptions - Provider-specific Speech to Text
  app.post('/:provider/v1/audio/transcriptions', async (request, reply) => {
    const providerName = request.params.provider;
    return handleTranscription(request, reply, providerName);
  });

  // CORS Preflight for audio endpoints
  app.options('/v1/audio/transcriptions', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    reply.raw.end();
  });

  app.options('/:provider/v1/audio/transcriptions', async (request, reply) => {
    reply.raw.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    reply.raw.end();
  });

  // POST /v1/audio/translations - Translation
  app.post('/v1/audio/translations', {
    schema: {
      body: {
        type: 'object',
        required: ['file', 'model'],
        properties: {
          file: { type: 'string' },
          model: { type: 'string' },
          prompt: { type: 'string' },
          response_format: { type: 'string' },
          temperature: { type: 'number', minimum: 0, maximum: 2 }
        }
      }
    }
  }, async (request, reply) => {
    return reply.code(501).send({
      error: {
        message: 'Audio translations endpoint not yet implemented',
        type: 'not_implemented_error',
        code: 'not_implemented'
      }
    });
  });
}