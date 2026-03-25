import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { estimateTokens } from '../services/statsService.js';

/**
 * Anthropic (Claude) adapter.
 *
 * Format:
 *   POST https://api.anthropic.com/v1/messages
 *   Headers: x-api-key, anthropic-version
 *   Body:    { model, messages, system?, max_tokens, stream? }
 *   Non-stream response: { content: [{type, text}], usage: {input_tokens, output_tokens} }
 *   Stream events:
 *     message_start → usage.input_tokens
 *     content_block_delta → delta.text  (streaming text)
 *     message_delta → usage.output_tokens
 *
 * All methods return normalized: { output: string, tokens: { input, output }, raw: object }
 */
export class AnthropicAdapter extends BaseAdapter {
  constructor() {
    super('anthropic');
    this.endpoint   = 'https://api.anthropic.com/v1/messages';
    this.apiVersion = '2023-06-01';
  }

  buildHeaders(apiKey, options = {}) {
    const headers = {
      'Content-Type':    'application/json',
      'x-api-key':       apiKey,
      'anthropic-version': this.apiVersion,
    };
    
    // Propagate request ID for tracing
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }
    
    return headers;
  }

  buildBody(prompt, model, stream = false, options = {}) {
    const body = {
      model,
      messages:   [{ role: 'user', content: prompt }],
      max_tokens: 8192,
      stream,
    };
    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }
    return body;
  }

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
   * Streaming request — reads Anthropic SSE events.
   *
   * Anthropic stream event types:
   *   message_start       → { message: { usage: { input_tokens } } }
   *   content_block_delta → { delta: { type: "text_delta", text: "..." } }
   *   message_delta       → { usage: { output_tokens } }
   *   message_stop        → end of stream
   *
   * Captures real token counts from events when available.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout(60000);
    let fullOutput   = '';
    let inputTokens  = 0;
    let outputTokens = 0;

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

            // ── message_start: input tokens ─────────────────────────
            if (parsed.type === 'message_start' && parsed.message?.usage?.input_tokens) {
              inputTokens = parsed.message.usage.input_tokens;
            }

            // ── content_block_delta: actual text chunks ─────────────
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              const text = parsed.delta.text;
              if (text) {
                fullOutput += text;
                if (options.onChunk) {
                  options.onChunk({ content: text, provider: this.providerName, model });
                }
              }
            }

            // ── message_delta: output tokens ────────────────────────
            if (parsed.type === 'message_delta' && parsed.usage?.output_tokens) {
              outputTokens = parsed.usage.output_tokens;
            }
          } catch { /* skip unparseable */ }
        }
      }

      // Fall back to estimation if provider didn't return token counts
      return {
        output: fullOutput,
        tokens: {
          input:  inputTokens  || estimateTokens(prompt),
          output: outputTokens || estimateTokens(fullOutput),
        },
        raw: { streaming: true, provider: 'anthropic', model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize Anthropic non-streaming response.
   * Format: { content: [{type, text}], usage: {input_tokens, output_tokens} }
   */
  normalizeResponse(rawResponse) {
    const output = rawResponse.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('') || '';

    const tokens = {
      input:  rawResponse.usage?.input_tokens  || estimateTokens(''),
      output: rawResponse.usage?.output_tokens || estimateTokens(output),
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
