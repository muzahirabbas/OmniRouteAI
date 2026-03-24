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
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
        }),
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
    // TODO: Implement Cohere SSE streaming
    // For now, fallback to non-streaming
    const result = await this.sendRequest(prompt, model, apiKey, options);
    const text = result.message?.content?.[0]?.text || '';
    
    if (options.onChunk && text) {
      options.onChunk({ content: text, provider: this.providerName, model });
    }

    return {
      output: text,
      tokens: extractTokens(result.usage, text, prompt),
    };
  }

  normalizeResponse(rawResponse) {
    // Cohere V2 format: { message: { content: [{ type: 'text', text: "..." }] }, usage: { ... } }
    const output = rawResponse.message?.content?.[0]?.text || '';
    const tokens = {
      prompt: rawResponse.usage?.tokens?.input_tokens || 0,
      completion: rawResponse.usage?.tokens?.output_tokens || 0,
      total: rawResponse.usage?.tokens?.total_tokens || 0,
    };
    return { output, tokens, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
