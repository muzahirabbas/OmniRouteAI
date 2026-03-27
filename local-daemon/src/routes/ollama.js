import { getToolConfig } from '../config.js';
import { log } from '../logger.js';

const OLLAMA_BASE = 'http://127.0.0.1:11434';

export async function ollamaRoutes(app) {

  // ─── Health check: probe Ollama at 11434 ──────────────────────────
  app.get('/ollama/health', async () => {
    const start = Date.now();
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        return { status: 'error', ollama: 'unreachable', error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      log.info('Ollama health OK', { models: models.length, duration: Date.now() - start });
      return { status: 'running', models, duration: Date.now() - start };
    } catch (err) {
      log.warn('Ollama health FAIL', { error: err.message, duration: Date.now() - start });
      return { status: 'offline', error: err.message, hint: 'Make sure Ollama is running: ollama serve' };
    }
  });

  // ─── Model list: returns installed model names ────────────────────
  app.get('/ollama/models', async () => {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        return { models: [], error: `Ollama returned HTTP ${res.status}` };
      }
      const data = await res.json();
      const models = (data.models || []).map(m => ({
        name:      m.name,
        size:      m.size,
        modified:  m.modified_at,
      }));
      return { models };
    } catch (err) {
      return { models: [], error: err.message, hint: 'Make sure Ollama is running: ollama serve' };
    }
  });

  // ─── Chat bridge: POST /ollama ──────────────────────────────────────
  app.post('/ollama', async (request, reply) => {
    const toolConfig = await getToolConfig('ollama_local');
    if (!toolConfig?.enabled) {
      return reply.code(503).send({ error: 'Ollama local bridge is disabled' });
    }

    const { prompt, model, stream = false } = request.body;
    const ollamaUrl = `${OLLAMA_BASE}/api/chat`;
    const start = Date.now();

    try {
      const response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    model || 'llama3',
          messages: [{ role: 'user', content: prompt }],
          stream:   !!stream,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        log.request({ tool: 'ollama', command: 'POST /ollama', prompt, duration: Date.now() - start, exitCode: response.status, success: false, error: errText });
        return reply.code(502).send({ error: `Ollama error: ${errText}`, provider: 'ollama_local' });
      }

      // ── Streaming: Ollama sends NDJSON lines ───────────────────────────────
      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection':    'keep-alive',
          'X-Tool':        'ollama',
        });

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';
        let inputTokens = 0, outputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete last line

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              const text  = chunk.message?.content || '';
              if (text) {
                reply.raw.write(`data: ${JSON.stringify({ content: text, provider: 'ollama_local' })}\n\n`);
              }
              if (chunk.done) {
                inputTokens  = chunk.prompt_eval_count  || 0;
                outputTokens = chunk.eval_count          || 0;
              }
            } catch { /* skip non-JSON lines */ }
          }
        }

        const duration = Date.now() - start;
        log.request({ tool: 'ollama', command: 'POST /ollama (stream)', prompt, duration, exitCode: 0, success: true });

        reply.raw.write(`data: ${JSON.stringify({
          done:     true,
          provider: 'ollama_local',
          model:    model || 'llama3',
          tokens:   { input: inputTokens, output: outputTokens },
          success:  true,
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }

      // ── Non-streaming ──────────────────────────────────────────────────
      const data = await response.json();
      const duration = Date.now() - start;

      log.request({ tool: 'ollama', command: 'POST /ollama', prompt, duration, exitCode: 0, success: true });

      return {
        output:   data.message?.content || '',
        provider: 'ollama_local',
        model:    data.model,
        tokens: {
          input:  data.prompt_eval_count || 0,
          output: data.eval_count || 0,
        },
        success:  true,
      };
    } catch (err) {
      const duration = Date.now() - start;
      log.request({ tool: 'ollama', command: 'POST /ollama', prompt, duration, exitCode: 1, success: false, error: err.message });
      return reply.code(504).send({
        error: `Failed to reach local Ollama: ${err.message}`,
        hint:  'Make sure Ollama is running: ollama serve',
        provider: 'ollama_local',
      });
    }
  });
}
