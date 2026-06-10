import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';
import { loadDaemonPool } from '../utils/daemonPool.js';

const MAX_RETRIES = 3;

export class OllamaLocalBridgeAdapter extends BaseAdapter {
  constructor(daemonPool) {
    super('ollama_local_bridge');
    this.daemonPool = daemonPool || loadDaemonPool();
  }

  async _fetchWithFailover(url, body, options = {}) {
    const poolSize = this.daemonPool.getAllDaemons().length;
    const maxAttempts = Math.min(poolSize, MAX_RETRIES);
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const daemon = this.daemonPool.getRandomDaemon();
      const endpoint = `${daemon.url}/ollama`;
      const controller = this.createTimeout();

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Local-Token': daemon.token || '',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        this.clearTimeout(controller);

        if (!response.ok) {
          const errText = await response.text();
          throw new ProviderError(this.providerName, `Daemon Bridge Error: ${errText}`, response.status);
        }

        return await response.json();
      } catch (err) {
        this.clearTimeout(controller);
        lastError = err;
        if (err instanceof ProviderError) {
          const sc = err.statusCode || 0;
          if (sc === 503 || sc === 504 || sc === 502 || sc === 0) {
            this.daemonPool.markFailed(daemon.url);
            continue;
          }
        }
        if (err.cause?.code === 'ECONNREFUSED' || err.name === 'AbortError') {
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

  async sendRequest(prompt, model, apiKey, options = {}) {
    let requestBody = { model, stream: false };

    if (options.messages && options.messages.length > 0) {
      requestBody.messages = options.messages.filter(m => m.role !== 'system');
    } else if (Array.isArray(prompt)) {
      const textPart = prompt.find(p => typeof p === 'string' || p.type === 'text');
      const imageParts = prompt.filter(p => p.type === 'image');

      requestBody.prompt = typeof textPart === 'string' ? textPart : (textPart?.text || '');
      if (imageParts.length > 0) {
        requestBody.images = imageParts.map(p => p.data);
      }
    } else {
      requestBody.prompt = prompt;
    }

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(t => {
        if (t.type === 'function' && t.function && t.function.parameters) {
          return {
            ...t,
            function: {
              ...t.function,
              parameters: this.cleanSchema(t.function.parameters)
            }
          };
        }
        return t;
      });
    }
    if (options.tool_choice) {
      requestBody.tool_choice = options.tool_choice;
    }

    return this._fetchWithFailover('/ollama', requestBody, options);
  }

  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const result = await this.sendRequest(prompt, model, apiKey, options);
    if (options.onChunk && result.output) {
      options.onChunk({ content: result.output, provider: this.providerName, model });
    }
    return result;
  }

  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0 }, thinking: null, tool_calls: [], finish_reason: 'stop', raw: {} };
    const output = rawResponse.output || rawResponse.choices?.[0]?.message?.content || '';
    const tokens = await extractTokens(rawResponse, output);
    const toolCalls = rawResponse.choices?.[0]?.message?.tool_calls || [];
    const finishReason = rawResponse.choices?.[0]?.finish_reason || 'stop';
    return { output, tokens, thinking: null, tool_calls: toolCalls, finish_reason: finishReason, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Bridge request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
