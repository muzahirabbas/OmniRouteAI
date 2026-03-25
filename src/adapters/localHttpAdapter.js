import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens, estimateTokens } from '../services/statsService.js';

/**
 * LocalHttpAdapter — for `type: "local_http"` providers.
 *
 * Supports locally-running CLI proxy servers, e.g.:
 *   http://localhost:5059/claude
 *   http://localhost:5059/gemini
 *
 * Protocol:
 *   POST {endpoint}
 *   Body: { prompt, model, stream, system_prompt? }
 *   Response (non-stream): { output, tokens?: { input, output } }
 *   Response (stream): Server-Sent Events (SSE) — same format as OpenAI
 *
 * Normalized return: { output: string, tokens: { input, output }, raw: object }
 */
export class LocalHttpAdapter extends BaseAdapter {
  /**
   * @param {string} providerName - e.g. 'local_claude'
   * @param {string} endpoint     - e.g. 'http://localhost:5059/claude'
   */
  constructor(providerName, endpoint) {
    super(providerName);
    this.endpoint = endpoint;
  }

  buildHeaders() {
    const headers = { 
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true' // Bypass ngrok free tier HTML warning
    };
    // Automatically attach daemon auth token when talking to the local daemon
    if (process.env.LOCAL_DAEMON_TOKEN) {
      headers['X-Local-Token'] = process.env.LOCAL_DAEMON_TOKEN;
    }
    return headers;
  }

  /**
   * Non-streaming request.
   */
  async sendRequest(prompt, model, _apiKey, options = {}) {
    const controller = this.createTimeout();

    try {
      const body = {
        prompt,
        model,
        stream: false,
        ...(options.systemPrompt ? { system_prompt: options.systemPrompt } : {}),
      };

      const response = await fetch(this.endpoint, {
        method:  'POST',
        headers: this.buildHeaders(),
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errText}`, response.status);
      }

      return await response.json();
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Streaming request — expects SSE chunks compatible with OpenAI format:
   *   data: {"choices":[{"delta":{"content":"..."}}]}
   *
   * Falls back to plain text SSE if `data.output` is present in chunk.
   */
  async sendStreamRequest(prompt, model, _apiKey, options = {}) {
    const controller = this.createTimeout(60000);
    let fullOutput   = '';

    try {
      const body = {
        prompt,
        model,
        stream: true,
        ...(options.systemPrompt ? { system_prompt: options.systemPrompt } : {}),
      };

      const response = await fetch(this.endpoint, {
        method:  'POST',
        headers: this.buildHeaders(),
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errText}`, response.status);
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
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // OpenAI-compatible delta format
            const deltaContent = parsed.choices?.[0]?.delta?.content;
            // Simple { output: "..." } format
            const simpleOutput = parsed.output;

            const content = deltaContent ?? simpleOutput;
            if (content) {
              fullOutput += content;
              if (options.onChunk) {
                options.onChunk({ content, provider: this.providerName, model });
              }
            }
          } catch { /* skip unparseable chunk */ }
        }
      }

      return {
        output: fullOutput,
        tokens: {
          input:  estimateTokens(prompt),
          output: estimateTokens(fullOutput),
        },
        raw: { streaming: true, provider: this.providerName },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize a non-streaming response.
   * Expected format: { output: string, tokens?: { input, output } }
   */
  normalizeResponse(rawResponse) {
    if (!rawResponse) rawResponse = {};
    const output = rawResponse.output || rawResponse.choices?.[0]?.message?.content || '';
    const tokens = extractTokens(rawResponse, output);

    // Prefer explicit token fields from the local server if present
    if (rawResponse.tokens?.input !== undefined) {
      tokens.input  = rawResponse.tokens.input;
      tokens.output = rawResponse.tokens.output;
    }

    return { output, tokens, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Local HTTP request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
