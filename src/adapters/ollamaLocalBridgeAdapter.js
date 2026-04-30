import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Ollama Local Bridge adapter.
 * Tunnels requests through the OmniRouteAI-Local daemon to reach a machine's local Ollama.
 */
export class OllamaLocalBridgeAdapter extends BaseAdapter {
  constructor() {
    super('ollama_local_bridge');
    // The daemon URL (usually localhost:5059 or a tunneled endpoint)
    this.daemonUrl = process.env.LOCAL_DAEMON_URL || 'http://localhost:5059';
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const url = `${this.daemonUrl}/ollama`;
    const controller = this.createTimeout();

    try {
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

      const response = await fetch(url, {
        method:  'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Local-Token': process.env.LOCAL_DAEMON_TOKEN || '',
        },
        body: JSON.stringify(requestBody),
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
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    // Current bridge implementation is non-streaming for simplicity
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
