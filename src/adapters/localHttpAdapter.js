import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens, estimateTokens } from '../services/statsService.js';
import { loadDaemonPool } from '../utils/daemonPool.js';

const MAX_RETRIES = 3;

export class LocalHttpAdapter extends BaseAdapter {
  constructor(providerName, endpointOrPool, toolName) {
    super(providerName);
    if (endpointOrPool && typeof endpointOrPool === 'object' && endpointOrPool.getRandomDaemon) {
      this.daemonPool = endpointOrPool;
      this.toolName = toolName || '';
      this.endpoint = null;
    } else {
      this.daemonPool = null;
      this.endpoint = endpointOrPool;
      this.toolName = '';
    }
  }

  _getSelectedDaemon() {
    if (this.daemonPool) {
      return this.daemonPool.getRandomDaemon();
    }
    return null;
  }

  _buildEndpoint(daemon) {
    return this.toolName ? `${daemon.url}/${this.toolName}` : daemon.url;
  }

  buildHeaders(token) {
    const headers = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'
    };
    const t = token || (this.daemonPool ? '' : process.env.LOCAL_DAEMON_TOKEN);
    if (t) {
      headers['X-Local-Token'] = t;
    }
    return headers;
  }

  async _requestWithFailover(body, stream, options = {}) {
    if (!this.daemonPool) {
      return this._sendSingle(this.endpoint, body, stream, options);
    }

    const poolSize = this.daemonPool.getAllDaemons().length;
    const maxAttempts = Math.min(poolSize, MAX_RETRIES);
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const daemon = this._getSelectedDaemon();
      const endpoint = this._buildEndpoint(daemon);

      try {
        return await this._sendSingle(endpoint, body, stream, { ...options, _daemonToken: daemon.token });
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderError && err.statusCode === 503) {
          this.daemonPool.markFailed(daemon.url);
          continue;
        }
        if (err instanceof ProviderError && err.statusCode === 504) {
          this.daemonPool.markFailed(daemon.url);
          continue;
        }
        if (err instanceof ProviderError && err.statusCode === 502) {
          this.daemonPool.markFailed(daemon.url);
          continue;
        }
        throw err;
      }
    }

    throw new ProviderError(
      this.providerName,
      `All ${maxAttempts} daemon(s) failed. Last error: ${lastError.message}`,
      503
    );
  }

  async _sendSingle(endpoint, body, stream, options = {}) {
    const token = options._daemonToken || process.env.LOCAL_DAEMON_TOKEN || '';
    const timeoutMs = stream ? 300000 : undefined;
    const controller = this.createTimeout(timeoutMs);
    const signal = options.abortSignal && stream
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify(body),
        signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errJson = JSON.parse(errText);
          errorMessage += `: ${errJson.error || errJson.message || errText}`;
        } catch {
          errorMessage += `: ${errText.substring(0, 200)}`;
        }
        throw new ProviderError(this.providerName, errorMessage, response.status);
      }

      if (stream) {
        return this._handleStreamResponse(response, options);
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        throw new ProviderError(
          this.providerName,
          `Invalid JSON response from daemon: ${text.substring(0, 200)}`,
          502
        );
      }
    } catch (err) {
      this.clearTimeout(controller);
      this._rethrowEnhanced(err, endpoint);
    }
  }

  _handleStreamResponse(response, options) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullOutput = '';
    const { onChunk, provider, model } = options;

    return new Promise((resolve, reject) => {
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                if (delta) {
                  if (delta.role && onChunk) {
                    onChunk({ role: delta.role, provider: provider || this.providerName, model });
                  }
                  if (delta.tool_calls && delta.tool_calls.length > 0 && onChunk) {
                    onChunk({ tool_calls: delta.tool_calls, provider: provider || this.providerName, model });
                  }
                  if (delta.reasoning && onChunk) {
                    onChunk({ reasoning: delta.reasoning, provider: provider || this.providerName, model });
                  }
                  const deltaContent = delta.content || parsed.output || '';
                  if (deltaContent) {
                    fullOutput += deltaContent;
                    if (onChunk) {
                      onChunk({ content: deltaContent, provider: provider || this.providerName, model });
                    }
                  }
                } else {
                  const deltaContent = parsed.output || '';
                  if (deltaContent) {
                    fullOutput += deltaContent;
                    if (onChunk) {
                      onChunk({ content: deltaContent, provider: provider || this.providerName, model });
                    }
                  }
                }
              } catch (e) {}
            }
          }

          const tokens = await estimateTokens(fullOutput);
          resolve({
            output: fullOutput,
            tokens: { input: 0, output: tokens },
            raw: { streaming: true, provider: this.providerName, model },
          });
        } catch (err) {
          reject(err);
        }
      };
      pump();
    });
  }

  _rethrowEnhanced(err, endpoint) {
    if (err instanceof ProviderError) throw err;

    if (err.name === 'AbortError') {
      throw new ProviderError(this.providerName, 'Request timed out', 504, err);
    }

    if (err.cause?.code === 'ECONNREFUSED') {
      throw new ProviderError(
        this.providerName,
        `Cannot connect to local daemon at ${endpoint}. Is the daemon running?`,
        503
      );
    }

    throw new ProviderError(this.providerName, err.message, err.status || 502, err);
  }

  async sendRequest(prompt, model, _apiKey, options = {}) {
    const body = {
      prompt,
      model,
      stream: false,
      ...(options.systemPrompt ? { system_prompt: options.systemPrompt } : {}),
      ...(options.noContext ? { noContext: true } : {}),
      ...(options.messages ? { messages: options.messages } : {}),
      ...(options.tools ? {
        tools: options.tools.map(t => {
          if (t.type === 'function' && t.function && t.function.parameters) {
            return { ...t, function: { ...t.function, parameters: this.cleanSchema(t.function.parameters) } };
          }
          return t;
        })
      } : {}),
      ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
    };

    return this._requestWithFailover(body, false, options);
  }

  async sendStreamRequest(prompt, model, _apiKey, options = {}) {
    const body = {
      prompt,
      model,
      stream: true,
      ...(options.systemPrompt ? { system_prompt: options.systemPrompt } : {}),
      ...(options.noContext ? { noContext: true } : {}),
      ...(options.messages ? { messages: options.messages } : {}),
      ...(options.tools ? {
        tools: options.tools.map(t => {
          if (t.type === 'function' && t.function && t.function.parameters) {
            return { ...t, function: { ...t.function, parameters: this.cleanSchema(t.function.parameters) } };
          }
          return t;
        })
      } : {}),
      ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
    };

    return this._requestWithFailover(body, true, options);
  }

  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0 }, raw: {} };
    const output = rawResponse.output || rawResponse.choices?.[0]?.message?.content || '';
    const tokens = rawResponse.tokens || { input: 0, output: await estimateTokens(output) };
    return {
      output,
      tokens,
      thinking: null,
      tool_calls: rawResponse.tool_calls || [],
      finish_reason: 'stop',
      raw: rawResponse
    };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
