import { refreshIfNeeded } from './refreshService.js';
import { log } from '../logger.js';

const PROVIDERS = {
  claude: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    headers: (token) => ({
      'x-api-key':         token,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'claude-code-20250219',
      'User-Agent':        'claude-cli/2.1.63',
      'Content-Type':      'application/json',
    }),
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: (token) => ({
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    }),
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    headers: (token) => ({
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    }),
  },
  zai: {
    baseUrl: 'https://api.z.ai/api/chat/completions',
    headers: (token) => ({
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    }),
  },
  copilot: {
    baseUrl: 'https://api.githubcopilot.com/chat/completions',
    headers: (token) => ({
      'Authorization':           `Bearer ${token}`,
      'Copilot-Integration-Id':  'vscode-chat',
      'Content-Type':            'application/json',
    }),
  },
};

/**
 * Attempt to call provider API directly using OAuth/Harvested tokens.
 * Falls back to CLI if tokens are missing or the API call fails.
 */
export async function tryDirectFetch(toolName, body, onChunk) {
  const config = PROVIDERS[toolName];
  if (!config) return null;

  const token = await refreshIfNeeded(toolName);
  if (!token) {
    log.info(`No active token for ${toolName}, falling back to CLI.`);
    return null;
  }

  try {
    const { prompt, model, stream, system_prompt } = body;

    // Default to OpenAI-compatible body (most common for modern AI APIs)
    let providerBody = {
      model:    model || getDefaultModel(toolName),
      messages: [{ role: 'user', content: prompt }],
      stream:   !!stream,
    };
    if (system_prompt) providerBody.messages.unshift({ role: 'system', content: system_prompt });

    // Handle Provider overrides (Claude and Gemini use proprietary layouts)
    if (toolName === 'claude') {
      providerBody = {
        model:      model || 'claude-3-5-sonnet-20241022',
        messages:   [{ role: 'user', content: prompt }],
        system:     system_prompt || '',
        stream:     !!stream,
        max_tokens: 4096,
      };
    } else if (toolName === 'gemini') {
      providerBody = {
        contents: [{ parts: [{ text: prompt }] }],
      };
    }

    const endpoint = toolName === 'gemini'
      ? `${config.baseUrl}/${model || 'gemini-1.5-pro'}:generateContent`
      : config.baseUrl;

    const response = await fetch(endpoint, {
      method:  'POST',
      headers: config.headers(token),
      body:    JSON.stringify(providerBody),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      log.warn(`Direct fetch for ${toolName} failed (${response.status}): ${errText.slice(0,100)} — falling back to CLI.`);
      return null;
    }

    if (stream) {
      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let fullOutput = '';
      let streamEnded = false;
      let buffer = '';

      while (!streamEnded) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6).trim();
          if (payload === '[DONE]') { streamEnded = true; break; }

          try {
            const data = JSON.parse(payload);
            const text = parseStreamChunk(toolName, data);
            if (text) {
              fullOutput += text;
              if (typeof onChunk === 'function') onChunk(text);
            }
          } catch { /* skip unparseable lines */ }
        }
      }

      return { output: fullOutput, success: true, tokens: { input: 0, output: 0 } };
    }

    // ── Non-streaming ────────────────────────────────────────────────
    const data = await response.json();
    const output = parseResponse(toolName, data);

    if (!output) {
      log.warn(`Direct fetch for ${toolName} returned empty content, falling back to CLI.`);
      return null;
    }

    const usage = data.usage || data.usageMetadata || {};
    return {
      output,
      success: true,
      tokens: { 
        input:  usage.input_tokens  || usage.promptTokenCount     || 0, 
        output: usage.output_tokens || usage.candidatesTokenCount || 0 
      },
    };

  } catch (err) {
    log.error(`Direct fetch error for ${toolName}: ${err.message}`);
    return null;
  }
}

function getDefaultModel(tool) {
  const defaults = {
    qwen:    'qwen-max',
    zai:     'z1-mini',
    copilot: 'gpt-4o',
    claude:  'claude-3-5-sonnet-20241022',
  };
  return defaults[tool] || 'default';
}

function parseStreamChunk(tool, data) {
  if (tool === 'claude') return data.delta?.text;
  if (tool === 'gemini') return data.candidates?.[0]?.content?.parts?.[0]?.text;
  // OpenAI-compatible
  return data.choices?.[0]?.delta?.content;
}

function parseResponse(tool, data) {
  if (tool === 'claude') return data.content?.[0]?.text;
  if (tool === 'gemini') return data.candidates?.[0]?.content?.parts?.[0]?.text;
  // OpenAI-compatible
  return data.choices?.[0]?.message?.content;
}
