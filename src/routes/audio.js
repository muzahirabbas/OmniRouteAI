import { transcribe } from '../services/routerService.js';
import { logRequest } from '../services/loggingService.js';
import { trackRequest } from '../services/statsService.js';
import { ProviderError } from '../utils/errors.js';

export async function audioRoutes(app) {
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

  // POST /v1/audio/transcriptions - Speech to Text
  app.post('/v1/audio/transcriptions', async (request, reply) => {
    const startTime = Date.now();

    try {
      const parts = {};

      for await (const part of request.parts()) {
        if (part.fieldname === 'file') {
          parts.file = part;
        } else {
          parts[part.fieldname] = part.value;
        }
      }

      if (!parts.file) {
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

      const fileBuffer = await parts.file.toBuffer();
      const mimeType = parts.file.mimetype || 'audio/wav';
      const filename = parts.file.filename || 'audio.wav';

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Transcription request received',
        requestId: request.requestId,
        fileSize: fileBuffer.length,
        mimeType,
        model: parts.model,
        provider: parts.provider,
      }));

      const result = await transcribe(fileBuffer, {
        model: parts.model,
        language: parts.language,
        response_format: parts.response_format,
        timestamp_granularities: parts.timestamp_granularities,
        mimeType,
        filename,
        requestId: request.requestId,
        provider: parts.provider,
      });

      const latency = Date.now() - startTime;

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

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Transcription request completed',
        requestId: request.requestId,
        latency,
        provider: result.provider,
      }));

      return reply.send({
        text: result.text,
        duration: result.duration,
        words: result.words || [],
        language: result.language,
      });

    } catch (err) {
      const latency = Date.now() - startTime;

      if (err instanceof ProviderError) {
        await logRequest({
          request_id: request.requestId,
          provider: err.provider || 'unknown',
          model: err.model || 'unknown',
          key: 'unknown',
          latency,
          tokens: { input: 0, output: 0 },
          status: 'error',
          error: err.message,
        });

        return reply.code(err.statusCode || 502).send({
          error: {
            message: err.message,
            type: 'server_error',
            code: err.statusCode?.toString() || '502'
          }
        });
      }

      await logRequest({
        request_id: request.requestId,
        provider: 'unknown',
        model: 'unknown',
        key: 'unknown',
        latency,
        tokens: { input: 0, output: 0 },
        status: 'error',
        error: err.message,
      });

      return reply.code(500).send({
        error: {
          message: err.message || 'Internal server error',
          type: 'server_error'
        }
      });
    }
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