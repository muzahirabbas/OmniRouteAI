import { buildArgs, spawnCLI, getExecutable } from '../spawner.js';
import { getToolConfig } from '../config.js';
import { log } from '../logger.js';
import { tryDirectFetch } from '../oauth/directFetch.js';

/**
 * Factory: creates a standardized Fastify route handler for a given CLI tool.
 *
 * All CLI routes share the same protocol:
 *
 * Request body:
 *   { prompt: string, model?: string, args?: object, stream?: boolean }
 *
 * Non-streaming response:
 *   { output, provider, model, tokens: { input, output }, raw, success }
 *
 * Streaming response (SSE — text/event-stream):
 *   data: <raw stdout chunk>\n\n
 *   data: [DONE]\n\n
 *
 * @param {string} toolName   - e.g. 'claude'
 * @param {string} providerName - e.g. 'claude_cli_local' (for OmniRoute compatibility)
 */
export function createToolRoute(toolName, providerName) {
  return async function toolRouteHandler(request, reply) {
    const toolConfig = await getToolConfig(toolName);

    if (!toolConfig) {
      return reply.code(404).send({ error: `Tool '${toolName}' not configured` });
    }
    if (!toolConfig.enabled) {
      return reply.code(503).send({ error: `Tool '${toolName}' is disabled in config` });
    }

    const {
      prompt,
      model,
      args: extraArgs = {},
      stream = false,
      system_prompt,
    } = request.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return reply.code(400).send({ error: 'prompt is required and must be a non-empty string' });
    }

    // ── DIRECT OAUTH FETCH ATTEMPT ─────────────────────────────────────
    // If we have an OAuth session, try calling the API directly first.
    // This is faster and supports native streaming.
    if (toolName === 'claude' || toolName === 'gemini') {
      const directResult = await tryDirectFetch(toolName, { prompt, model, stream, system_prompt }, (chunk) => {
        if (stream) {
          reply.raw.write(`data: ${JSON.stringify({ content: chunk, provider: providerName })}\n\n`);
        }
      });

      if (directResult) {
        if (stream) {
          reply.raw.write(`data: ${JSON.stringify({
            done: true,
            provider: providerName,
            model: model || 'default',
            success: true
          })}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return;
        }
        return {
          output: directResult.output,
          provider: providerName,
          model: model || 'default',
          tokens: directResult.tokens || { input: 0, output: 0 },
          success: true,
          method: 'direct-oauth'
        };
      }
    }

    // ── CLI FALLBACK ──────────────────────────────────────────────────
    if (!toolConfig.command) {
      return reply.code(503).send({ error: `Tool '${toolName}' has no command configured and OAuth direct fetch failed.` });
    }

    const cliArgs = buildArgs(toolName, prompt.trim(), model, extraArgs);
    
    // Phase 13: Force at least 5 minutes to override any faulty config.json defaults
    const timeout = Math.max(toolConfig.timeout || 300000, 300000);
    const command = getExecutable(toolName, toolConfig.command);
    const env     = toolConfig.env || {};

    // ── STREAMING ─────────────────────────────────────────────────────
    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Tool':        toolName,
      });

      let hasWritten = false;

      await spawnCLI({
        tool:    toolName,
        command,
        args:    cliArgs,
        env,
        timeout,
        stream:  true,

        onChunk: (text) => {
          hasWritten = true;
          // Stream raw chunks: SSE format
          reply.raw.write(`data: ${JSON.stringify({ content: text, provider: providerName })}\n\n`);
        },

        onDone: (result) => {
          if (!hasWritten && result.output) {
            // Flush if onChunk was never called (some CLIs buffer until exit)
            reply.raw.write(`data: ${JSON.stringify({ content: result.output, provider: providerName })}\n\n`);
          }
          reply.raw.write(`data: ${JSON.stringify({
            done:     true,
            provider: providerName,
            model:    model || 'default',
            tokens:   result.tokens,
            success:  result.success,
            ...(result.error ? { error: result.error } : {}),
          })}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
        },

        onError: (err) => {
          reply.raw.write(`data: ${JSON.stringify({ error: err.message, provider: providerName })}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
        },
      });

      return; // Reply sent via raw
    }

    // ── NON-STREAMING ─────────────────────────────────────────────────
    const result = await spawnCLI({
      tool:    toolName,
      command,
      args:    cliArgs,
      env,
      timeout,
      stream:  false,
    });

    if (!result.success) {
      return reply.code(502).send({
        error:    result.error || 'CLI execution failed',
        provider: providerName,
        exitCode: result.exitCode,
        stderr:   result.stderr,
      });
    }

    return {
      output:   result.output,
      raw:      result.raw,
      provider: providerName,
      model:    model || 'default',
      tokens:   result.tokens,
      success:  true,
      // Include stderr even on success if output is empty to help debug headless CLI hangs/silent failures
      ...(result.output ? {} : { stderr: result.stderr }),
    };
  };
}
