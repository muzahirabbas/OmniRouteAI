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

  // ─── Chat bridge: POST /ollama ────────────────────────────────────
  app.post('/ollama', async (request, reply) => {
    const toolConfig = await getToolConfig('ollama_local');
    if (!toolConfig?.enabled) {
      return reply.code(503).send({ error: 'Ollama local bridge is disabled' });
    }

    const { prompt, model, stream } = request.body;
    const ollamaUrl = `${OLLAMA_BASE}/api/chat`;
    const start = Date.now();

    try {
      const response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama3',
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        log.request({ tool: 'ollama', command: 'POST /ollama', prompt, duration: Date.now() - start, exitCode: response.status, success: false, error: errText });
        return reply.code(502).send({ error: `Ollama error: ${errText}`, provider: 'ollama_local' });
      }

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
