import { log } from './core/logger.js';
import { loadConfig, getConfigPath } from './core/config.js';
import { getLogPath } from './core/logger.js';
import { getTokenFilePath } from './core/token.js';
import { getAllProviders, getProviderIds } from './core/registry.js';
import { handleToolRequest } from './core/handler.js';
import { registerAuthRoutes } from './auth/routes.js';

export async function registerRoutes(app) {
  app.get('/health', async () => ({
    status: 'healthy',
    service: 'omniroute-local-daemon',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/', async () => {
    const providers = getProviderIds();
    return {
      service: 'OmniRouteAI Local CLI Daemon',
      version: '2.0.0',
      endpoints: [
        'POST /cli/:tool - Generic CLI endpoint',
        'POST /auth/harvest',
        'GET /auth/oauth-status',
        'POST /auth/:tool/login',
        'GET /auth/:tool/poll',
        'DELETE /auth/:tool',
        'GET /health',
        'GET /logs',
      ],
      tools: providers,
    };
  });

  app.get('/config', async () => {
    const cfg = await loadConfig();
    return { config: cfg, configPath: getConfigPath() };
  });

  app.get('/logs', async (request) => {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const logPath = getLogPath();

    if (!existsSync(logPath)) {
      return { logs: [], message: 'No logs yet' };
    }

    const raw = await readFile(logPath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const limit = parseInt(request.query?.limit || '100', 10);
    const recent = lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });

    return { logs: recent, total: lines.length, logPath };
  });

  app.get('/v1/env', async () => {
    const { loadConfig } = await import('./core/config.js');
    const cfg = await loadConfig();
    return {
      cwd: process.cwd(),
      port: cfg.port,
      platform: process.platform,
      nodeVersion: process.version,
    };
  });

  await registerAuthRoutes(app);

  // ===== Ollama Bridge Routes =====
  app.get('/ollama/health', async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        return { status: 'healthy', provider: 'ollama' };
      }
      return { status: 'unhealthy', error: 'Ollama not responding' };
    } catch (err) {
      return { status: 'unreachable', error: err.message };
    }
  });

  app.get('/ollama/models', async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      const data = await response.json();
      return { models: data.models || [], source: 'local' };
    } catch (err) {
      return { models: [], error: err.message };
    }
  });

  app.post('/ollama', async (request, reply) => {
    const { prompt, model, images, stream, ...extra } = request.body || {};
    
    const ollamaUrl = `http://localhost:11434/api/chat`;
    
    // Normalize model: map 'default'/'auto' to actual model
    let selectedModel = model;
    if (!selectedModel || selectedModel === 'default' || selectedModel === 'auto') {
      try {
        const tagsRes = await fetch('http://localhost:11434/api/tags');
        const tagsData = await tagsRes.json();
        const availableNames = tagsData.models?.map(m => m.name) || [];
        
        // Priority order for auto-selection
        const priorities = ['llama3.3', 'llama3.2', 'llama3.1', 'llama3', 'llama2', 'mistral', 'phi3'];
        selectedModel = priorities.find(p => availableNames.includes(p)) || availableNames[0] || 'llama3.3';
        log.info(`Ollama auto-selected model: ${selectedModel}`);
      } catch (err) {
        selectedModel = 'llama3.3';
      }
    }
    
    const payload = {
      model: selectedModel,
      messages: [{ role: 'user', content: prompt }],
      stream: !!stream,
      ...extra
    };
    
    if (images?.length) {
      payload.messages[0].images = images;
    }
    
    try {
      const response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error || `Ollama error: ${response.status}`;
        
        let hint = '';
        if (response.status === 404) {
          hint = `Model "${selectedModel}" not found. Try running "ollama pull ${selectedModel}" on your PC.`;
        } else if (errMsg.toLowerCase().includes('architecture')) {
          hint = `Your Ollama version might be too old for this model architecture. Try updating Ollama to the latest version.`;
        } else if (errMsg.toLowerCase().includes('unable to load model') || errMsg.toLowerCase().includes('manifest')) {
          hint = `Ollama could not load the model files. The model might be corrupted or missing blobs. Try "ollama rm ${selectedModel}" and "ollama pull ${selectedModel}".`;
        }

        return { 
          error: errMsg, 
          hint, 
          success: false, 
          provider: 'ollama',
          model: selectedModel 
        };
      }

      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(value);
        }
        reply.raw.end();
        return;
      }
      
      const data = await response.json();
      const output = data.message?.content || '';
      
      return {
        output: output,
        provider: 'ollama',
        model: data.model || selectedModel,
        tokens: {
          input: data.prompt_eval_count || 0,
          output: data.eval_count || 0
        },
        success: true
      };
    } catch (err) {
      return { 
        error: err.message, 
        hint: 'Check if Ollama is running (ollama serve).',
        success: false, 
        provider: 'ollama' 
      };
    }
  });

  const providerIds = getProviderIds();

  app.post('/:tool', async (request, reply) => {
    const { tool } = request.params;
    const body = request.body || {};
    
    // Map 'default' model alias to real provider-specific models
    let effectiveModel = body.model === 'default' ? null : body.model;
    if (!effectiveModel) {
      if (tool === 'gemini') effectiveModel = 'gemini-1.5-flash';
      else if (tool === 'antigravity') effectiveModel = 'claude-sonnet-4-6';
      else if (tool === 'claude') effectiveModel = 'claude-3-5-sonnet-20241022';
      else if (['zai', 'opencode'].includes(tool)) effectiveModel = 'default';
      else effectiveModel = body.model || 'default';
    }

    log.info(`Incoming tool request (${tool}): model=${effectiveModel}, noContext=${!!body.noContext}`);
    
    if (!providerIds.includes(tool)) {
      return reply.code(404).send({ error: `Unknown tool: ${tool}`, provider: tool });
    }

    const result = await handleToolRequest(tool, { ...body, model: effectiveModel }, { noContext: body.noContext });
    if (result.error && !result.success) {
      return reply.code(502).send(result);
    }
    return result;
  });

  app.post('/cli/:tool', async (request, reply) => {
    const { tool } = request.params;
    const body = request.body || {};
    
    // Reuse same model mapping logic
    let effectiveModel = body.model === 'default' ? null : body.model;
    if (!effectiveModel) {
      if (tool === 'gemini') effectiveModel = 'gemini-1.5-flash';
      else if (tool === 'antigravity') effectiveModel = 'claude-sonnet-4-6';
      else if (tool === 'claude') effectiveModel = 'claude-3-5-sonnet-20241022';
      else effectiveModel = body.model || 'default';
    }

    log.info(`Incoming tool request (cli): ${tool}`, { model: effectiveModel, noContext: !!body.noContext });
    
    if (!providerIds.includes(tool)) {
      return reply.code(404).send({ error: `Unknown tool: ${tool}`, provider: tool });
    }

    const result = await handleToolRequest(tool, { ...body, model: effectiveModel }, { noContext: body.noContext });
    if (result.error && !result.success) {
      return reply.code(502).send(result);
    }
    return result;
  });

  app.post('/v1/chat/completions', async (request, reply) => {
    const { model, messages, stream, ...extra } = request.body;
    log.info(`Incoming chat completions request (OpenAI-compatible)`, { model });
    
    const prompt = messages?.map(m => m.content).join('\n') || '';
    
    const result = await handleToolRequest('claude', {
      prompt,
      model,
      ...extra
    });

    if (result.error && !result.success) {
      return reply.code(502).send({
        error: { message: result.error },
        provider: result.provider || 'claude',
        model: result.model || model || 'default'
      });
    }

    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const chunks = (result.output || '').split('');
      for (const chunk of chunks) {
        reply.raw.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    return {
      id: 'chatcmpl-' + Math.random().toString(36).slice(2),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || 'default',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: result.output || '' },
        finish_reason: 'stop'
      }]
    };
  });
}
