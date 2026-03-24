import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens, estimateTokens } from '../services/statsService.js';

/**
 * Anthropic (Claude) adapter.
 *
 * DIFFERENT format from OpenAI:
 *   POST https://api.anthropic.com/v1/messages
 *   Headers: x-api-key, anthropic-version
 *   Body: { model, messages: [{role, content}], max_tokens }
 *   Response: { content: [{type, text}], usage: {input_tokens, output_tokens} }
 */
export class AnthropicAdapter extends BaseAdapter {
  constructor() {
    super('anthropic');
    this.endpoint = 'https://api.anthropic.com/v1/messages';
    this.apiVersion = '2023-06-01';
  }

  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': this.apiVersion,
    };
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 8192,
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
    const controller = this.createTimeout(60000);
    let fullOutput = '';

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 8192,
          stream: true,
        }),
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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

          try {
            const parsed = JSON.parse(data);

            // Anthropic streaming events:
            // content_block_delta → { delta: { type: "text_delta", text: "..." } }
            if (parsed.type === 'content_block_delta') {
              const text = parsed.delta?.text;
              if (text) {
                fullOutput += text;
                if (options.onChunk) {
                  options.onChunk({ content: text, provider: this.providerName, model });
                }
              }
            }
          } catch { /* skip */ }
        }
      }

      return {
        output: fullOutput,
        tokens: {
          input: estimateTokens(prompt),
          output: estimateTokens(fullOutput),
        },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize Anthropic response.
   * Format: { content: [{ type: "text", text: "..." }], usage: { input_tokens, output_tokens } }
   */
  normalizeResponse(rawResponse) {
    const output = rawResponse.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('') || '';

    const tokens = {
      input: rawResponse.usage?.input_tokens || 0,
      output: rawResponse.usage?.output_tokens || 0,
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
