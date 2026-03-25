import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens, estimateTokens } from '../services/statsService.js';

/**
 * OpenAI-compatible adapter base.
 *
 * Used by: OpenAI, xAI, Ollama, Alibaba, OpenRouter, Groq, DeepSeek,
 *          Moonshot, Together AI, NVIDIA, Inception, Xiaomi, SambaNova, Cerebras
 *
 * Normalized return format (ALL methods):
 *   { output: string, tokens: { input: number, output: number }, raw: object }
 */
export class OpenAICompatibleAdapter extends BaseAdapter {
  constructor(providerName, endpoint) {
    super(providerName);
    this.endpoint = endpoint;
  }

  buildHeaders(apiKey, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${apiKey}`,
    };
    
    // Propagate request ID for tracing across provider logs
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }
    
    return headers;
  }

  buildBody(prompt, model, stream = false, options = {}) {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream,
    };
    if (options.systemPrompt) {
      body.messages.unshift({ role: 'system', content: options.systemPrompt });
    }
    return body;
  }

  /**
   * Non-streaming request.
   *
   * @returns {Promise<object>} raw provider response
   */
  async sendRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();

    try {
      const response = await fetch(this.endpoint, {
        method:  'POST',
        headers: this.buildHeaders(apiKey, options),
        body:    JSON.stringify(this.buildBody(prompt, model, false, options)),
        signal:  controller.signal,
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
   *
   * Returns normalized: { output: string, tokens: { input, output }, raw: object }
   * No buffering — chunks are forwarded to options.onChunk immediately.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();
    let fullOutput   = '';

    try {
      const response = await fetch(this.endpoint, {
        method:  'POST',
        headers: this.buildHeaders(apiKey, options),
        body:    JSON.stringify(this.buildBody(prompt, model, true, options)),
        signal:  controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      // Capture the last usage chunk (some providers send it in the final event)
      let usageFromStream = null;

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

            // Capture usage if provided in stream (e.g. OpenAI stream_options)
            if (parsed.usage) usageFromStream = parsed.usage;

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

      // Build normalized token counts — prefer stream-provided usage
      const tokens = usageFromStream
        ? await extractTokens({ usage: usageFromStream }, fullOutput, prompt)
        : {
            input:  await estimateTokens(prompt),
            output: await estimateTokens(fullOutput),
          };

      return {
        output: fullOutput,
        tokens,
        raw: { streaming: true, provider: this.providerName, model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize a non-streaming OpenAI-compatible response.
   * Returns: { output: string, tokens: { input, output }, raw: object }
   */
  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0 }, raw: {} };
    const output = rawResponse.choices?.[0]?.message?.content || '';
    const tokens = await extractTokens(rawResponse, output);
    return { output, tokens, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
