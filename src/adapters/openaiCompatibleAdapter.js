import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * OpenAI-compatible adapter base.
 *
 * Used by: OpenAI, xAI, Ollama, Alibaba, OpenRouter, Groq, DeepSeek,
 *          Moonshot, Together AI, NVIDIA
 *
 * All these providers share the same request/response format:
 *   POST /v1/chat/completions
 *   { model, messages: [{role, content}], stream }
 *   → { choices: [{message: {content}}], usage: {prompt_tokens, completion_tokens} }
 *
 * Subclasses only need to override constructor to set provider name, endpoint,
 * and optionally buildHeaders() for provider-specific auth headers.
 */
export class OpenAICompatibleAdapter extends BaseAdapter {
  constructor(providerName, endpoint) {
    super(providerName);
    this.endpoint = endpoint;
  }

  /**
   * Build request headers. Override in subclasses for custom auth.
   * Default: Bearer token authorization.
   */
  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  /**
   * Build request body. Override in subclasses if format differs.
   */
  buildBody(prompt, model, stream = false) {
    return {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream,
    };
  }

  /**
   * Non-streaming request.
   */
  async sendRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(this.buildBody(prompt, model, false)),
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

  /**
   * Streaming request (SSE).
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout(60000);
    let fullOutput = '';

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(this.buildBody(prompt, model, true)),
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
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullOutput += content;
              if (options.onChunk) {
                options.onChunk({ content, provider: this.providerName, model });
              }
            }
          } catch { /* skip unparseable */ }
        }
      }

      return {
        output: fullOutput,
        tokens: extractTokens(null, fullOutput, prompt),
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize OpenAI-compatible response.
   */
  normalizeResponse(rawResponse) {
    const output = rawResponse.choices?.[0]?.message?.content || '';
    const tokens = extractTokens(rawResponse, output);
    return { output, tokens, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
