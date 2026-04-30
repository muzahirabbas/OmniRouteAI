import { getProvider } from './registry.js';
import { spawnCLI } from './spawner.js';
import { log } from './logger.js';
import { refreshTokenIfNeeded } from '../auth/refreshService.js';
import { getStoredToken } from '../auth/tokenStore.js';
import { randomUUID } from 'node:crypto';

/**
 * Helper to wrap any promise with a timeout.
 */
function withTimeout(promise, ms, label = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

export async function handleToolRequest(toolName, body, options = {}) {
  const { stream = false, onChunk, onDone, onError, noContext } = options;
  const requestId = randomUUID();

  const provider = getProvider(toolName);
  if (!provider) {
    return { error: `Unknown tool: ${toolName}`, success: false, provider: toolName };
  }

  if (provider.isHttp) {
    return handleHttpProvider(provider, body, { ...options, requestId });
  }

  const { prompt, model, images, system_prompt } = body;
  
  if (!prompt || (typeof prompt !== 'string' && !Array.isArray(prompt))) {
    return { error: 'prompt is required and must be a string or array', success: false, provider: toolName };
  }

  const env = {};
  
  if (provider.envKey && provider.apiProxy) {
    try {
      const token = await withTimeout(refreshTokenIfNeeded(toolName), 15000, `Token refresh for ${toolName}`);
      if (token) {
        env[provider.envKey] = token;
      }
    } catch (err) {
      log.warn(`Continuing without fresh token for ${toolName}: ${err.message}`);
    }
  }

  if (provider.command) {
    try {
      // For harvested tools, we only want to sync if we actually improved/refreshed the token.
      // If refreshTokenIfNeeded returns the SAME token we just harvested, skip the redundant write.
      const existingToken = await getStoredToken(toolName);
      const token = await withTimeout(refreshTokenIfNeeded(toolName), 15000, `Token sync for ${toolName}`);
      
      if (token && (provider.authMethod !== 'harvested' || token !== existingToken?.accessToken)) {
        const { syncTokenToCLI } = await import('../auth/sync.js');
        const tokenData = { 
          accessToken: token,
          refreshToken: (await getStoredToken(toolName))?.refreshToken,
          idToken: (await getStoredToken(toolName))?.idToken
        };
        await withTimeout(syncTokenToCLI(toolName, tokenData), 10000, `CLI token sync for ${toolName}`);
      }
    } catch (err) {
      log.warn(`CLI Token sync failed for ${toolName}: ${err.message}`);
    }
    
    if (toolName === 'gemini' || toolName === 'antigravity') {
      env.GOOGLE_GENAI_USE_GCA = 'true';
    }
  }

  if (provider.apiProxy) {
    const directResult = await tryDirectApi(provider, { prompt, model, images, system_prompt, stream, requestId }, onChunk);
    if (directResult) {
      if (stream && onDone) {
        onDone(directResult);
      }
      return directResult;
    }
    if (!provider.command) {
      const token = await refreshTokenIfNeeded(toolName);
      if (!token) {
        return { error: 'Session required - no active token found. Please login first.', success: false, provider: toolName, model: model || 'default' };
      }
      return { error: `API proxy failed for ${toolName} and no CLI command available`, success: false, provider: toolName, model: model || 'default' };
    }
  }

  if (!provider.command) {
    log.error(`Tool '${toolName}' has no command configured for fallback`);
    return { error: `Tool '${toolName}' has no command configured`, success: false, provider: toolName };
  }

  log.info(`Using CLI bridge fallback for ${toolName}...`);
  const cliArgs = provider.buildArgs(prompt.trim(), model);
  const timeout = Math.max(provider.timeout || 300000, 300000);

  if (stream) {
    const chunks = [];
    return spawnCLI({
      tool: toolName,
      command: provider.command,
      wslCommand: provider.wslCommand,
      args: cliArgs,
      env,
      timeout,
      noContext,
      stream: true,
      onChunk: (text) => {
        chunks.push(text);
        if (onChunk) onChunk(text);
      },
      onDone: (result) => {
        if (onDone) {
          onDone({
            output: result.output,
            provider: toolName,
            model: model || 'default',
            tokens: result.tokens,
            success: result.success,
            request_id: requestId,
            ...(result.error ? { error: result.error } : {})
          });
        }
      },
      onError: (err) => {
        if (onError) onError(err);
      }
    });
  }

  const result = await spawnCLI({
    tool: toolName,
    command: provider.command,
    wslCommand: provider.wslCommand,
    args: cliArgs,
    env,
    timeout,
    noContext,
    stream: false
  });

  if (!result.success) {
    const errorMsg = result.error || result.stderr || 'CLI execution failed';
    log.error(`Both Direct API and CLI bridge failed for ${toolName}: ${errorMsg}`);
    return { 
      error: `Service Unavailable: ${errorMsg}`, 
      success: false,
      provider: toolName,
      model: model || 'default',
      request_id: requestId
    };
  }

  return {
    output: result.output,
    raw: result.raw,
    provider: toolName,
    model: model || 'default',
    tokens: result.tokens,
    success: true,
    request_id: requestId,
    ...(result.stderr && !result.output ? { stderr: result.stderr } : {})
  };
}

async function handleHttpProvider(provider, body, options) {
  const { prompt, model, images, stream = false } = body;
  const { onChunk, requestId } = options;
  
  // Helper to normalize model name - map 'default'/'auto' to actual model
  const normalizeModel = (m, fallback = 'llama3.3') => 
    (m && m !== 'default' && m !== 'auto') ? m : fallback;
  
  const baseUrl = provider.command;
  const endpoint = `${baseUrl}/api/generate`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: normalizeModel(model),
          prompt,
          stream: stream || false,
          ...(images ? { images } : {})
        }),
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        return { 
          error: `Ollama error: ${response.status}`, 
          success: false, 
          provider: 'ollama', 
          model: normalizeModel(model),
          request_id: requestId
        };
      }

      if (stream || options.stream) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let output = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value, { stream: true });
          output += text;
          if (options.onChunk) options.onChunk(text);
        }

        return { output, provider: 'ollama', model: normalizeModel(model), success: true, request_id: requestId };
      }

      const data = await response.json();
      return { 
        output: data.response || data.message?.content || '', 
        provider: 'ollama', 
        model: normalizeModel(model, data.model || 'llama3.3'), 
        tokens: { input: 0, output: 0 }, 
        success: true,
        request_id: requestId
      };
  } catch (err) {
    log.error(`Ollama request failed: ${err.message}`);
    return { 
      error: err.message, 
      success: false, 
      provider: 'ollama', 
      model: normalizeModel(model),
      request_id: requestId
    };
  }
}

async function tryDirectApi(provider, body, onChunk) {
  const { prompt, model, images, stream, system_prompt, requestId } = body;
  
  if (!provider.apiProxy) return null;

  let token;
  try {
    token = await withTimeout(refreshTokenIfNeeded(provider.id), 12000, `API token for ${provider.id}`);
    if (!token && provider.id === 'antigravity') {
      log.info(`No token for antigravity, trying gemini token...`);
      token = await withTimeout(refreshTokenIfNeeded('gemini'), 12000, `API token for gemini fallback`);
    }
  } catch (err) {
    log.warn(`Token acquisition failed for ${provider.id}: ${err.message}`);
  }

  if (!token) {
    log.info(`No token for ${provider.id}, falling back to CLI...`);
    return null;
  }

  log.info(`Attempting direct API for ${provider.id}...`);

  try {
    const config = provider.apiProxy;
    const headers = {
      ...config.headers(token),
      'Content-Type': 'application/json'
    };

    let requestBody;
    
    if (config.format === 'claude') {
      const content = Array.isArray(prompt) ? prompt.map(p => 
        typeof p === 'string' ? { type: 'text', text: p } : p
      ) : [{ type: 'text', text: prompt }];

      requestBody = {
        model: model || 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content }],
        system: system_prompt || '',
        stream: !!stream,
        max_tokens: 4096
      };
    } else if (config.format === 'gemini' || config.format === 'antigravity') {
      const parts = Array.isArray(prompt) ? prompt.map(p => 
        typeof p === 'string' ? { text: p } : p
      ) : [{ text: prompt }];

      requestBody = { contents: [{ parts }] };
    } else {
      const content = Array.isArray(prompt) ? prompt : [{ type: 'text', text: prompt }];
      requestBody = {
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content }],
        stream: !!stream
      };
    }

      const effectiveModel = model && model !== 'default' ? model : 'gemini-1.5-flash';
      const url = (config.format === 'gemini' || config.format === 'antigravity')
        ? (config.baseUrl.includes('cloudcode-pa')
            ? `${config.baseUrl}/v1internal:generateContent?model=${effectiveModel}`
            : `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`)
        : config.baseUrl;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      log.warn(`Direct API for ${provider.id} failed (${response.status}): ${errText.slice(0, 100)}`);
      return null;
    }

    if (stream) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullOutput = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const buffer = decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          try {
            const data = JSON.parse(payload);
            const text = parseStreamChunk(provider.id, config.format, data);
            if (text) {
              fullOutput += text;
              if (onChunk) onChunk(text);
            }
          } catch {}
        }
      }

      return { output: fullOutput, success: true, tokens: { input: 0, output: 0 } };
    }

    const data = await response.json();
    const output = parseResponse(provider.id, config.format, data);

    if (!output) {
      log.warn(`Direct API for ${provider.id} returned empty content`);
      return null;
    }

    return {
      output,
      success: true,
      tokens: { input: 0, output: 0 },
      method: 'direct-api',
      request_id: requestId
    };

  } catch (err) {
    log.error(`Direct API error for ${provider.id}: ${err.message}`);
    return null;
  }
}

function parseStreamChunk(providerId, format, data) {
  if (format === 'claude') return data.delta?.text;
  if (format === 'gemini' || format === 'antigravity') return data.candidates?.[0]?.content?.parts?.[0]?.text;
  return data.choices?.[0]?.delta?.content;
}

function parseResponse(providerId, format, data) {
  if (format === 'claude') return data.content?.[0]?.text;
  if (format === 'gemini' || format === 'antigravity') return data.candidates?.[0]?.content?.parts?.[0]?.text;
  return data.choices?.[0]?.message?.content;
}
