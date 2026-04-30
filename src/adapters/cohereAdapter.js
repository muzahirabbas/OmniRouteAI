import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Cohere V2 Chat Adapter.
 * Endpoint: https://api.cohere.ai/v2/chat
 */
export class CohereAdapter extends BaseAdapter {
  constructor() {
    super('cohere');
    this.endpoint = 'https://api.cohere.ai/v2/chat';
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();

    try {
      let messages = [];
      if (options.messages && options.messages.length > 0) {
        messages = options.messages.filter(m => m.role !== 'system');
      } else {
        let messagesContent;
        if (Array.isArray(prompt)) {
          messagesContent = prompt.map(p => {
            if (typeof p === 'string') return { type: 'text', text: p };
            if (p.type === 'text') return p;
            if (p.type === 'image') {
              return {
                type: 'image_url',
                image_url: { url: `data:${this.sanitizeMimeType(p.media_type)};base64,${p.data}` }
              };
            }
            return null;
          }).filter(Boolean);
        } else {
          messagesContent = [{ type: 'text', text: prompt }];
        }
        messages = [{ role: 'user', content: messagesContent }];
      }

      const body = {
        model,
        messages,
      };

      if (options.tools && options.tools.length > 0) {
        body.tools = options.tools.map(t => {
          if (!t.function) return t;
          return {
            ...t,
            function: {
              ...t.function,
              parameters: t.function.parameters ? this.cleanSchema(t.function.parameters) : t.function.parameters
            }
          };
        });
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      return await response.json();
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    // Cohere streaming: fallback to non-streaming and emit as single chunk
    const result = await this.sendRequest(prompt, model, apiKey, options);
    const normalized = await this.normalizeResponse(result);

    if (options.onChunk && normalized.output) {
      options.onChunk({ content: normalized.output, provider: this.providerName, model });
    }

    return {
      output: normalized.output,
      tokens: normalized.tokens,
      raw:    { streaming: false, provider: 'cohere', model },
    };
  }

  async normalizeResponse(rawResponse) {
    // Cohere V2 format: { message: { content: [{type, text}] }, usage: { tokens: { input_tokens, output_tokens } } }
    const textBlocks = rawResponse.message?.content?.filter(c => c.type === 'text') || [];
    const output = textBlocks.map(c => c.text).join('') || '';
    const tokens = {
      input:  rawResponse.usage?.tokens?.input_tokens  || 0,
      output: rawResponse.usage?.tokens?.output_tokens || 0,
    };
    return { output, tokens, thinking: null, tool_calls: [], finish_reason: 'stop', raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
