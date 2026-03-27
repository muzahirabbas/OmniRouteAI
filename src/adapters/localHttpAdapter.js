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
 *
 * ─── SECURITY CONSIDERATIONS ───────────────────────────────────────────
 *
 * 1. NGROK HEADER BYPASS:
 *    The 'ngrok-skip-browser-warning' header is added to bypass ngrok's
 *    free-tier HTML warning page. This is ONLY needed when:
 *    - The local daemon is exposed via ngrok free tier
 *    - ngrok intercepts HTTP requests with browser detection
 *
 *    SECURITY RISK: If the daemon is exposed to the public internet via
 *    ngrok, this header alone does NOT provide security. Always use:
 *    - LOCAL_DAEMON_TOKEN for authentication (see buildHeaders below)
 *    - ngrok authentication middleware (ngrok basic auth)
 *    - Or better: use ngrok paid tier with custom domains + TLS
 *
 *    RECOMMENDATION: Never expose the local daemon publicly without
 *    proper authentication. The LOCAL_DAEMON_TOKEN env var provides
 *    token-based auth that is validated by the daemon.
 *
 * 2. LOCALHOST-ONLY BINDING:
 *    The local daemon binds to 127.0.0.1 by default (NOT 0.0.0.0).
 *    This prevents external access unless explicitly configured.
 *
 * 3. TOKEN AUTHENTICATION:
 *    When LOCAL_DAEMON_TOKEN is set, all requests include the
 *    'X-Local-Token' header. The daemon validates this token on
 *    every request (except /health).
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
    const controller = this.createTimeout(300000); // Match daemon CLI timeout (5 min)
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
            // OmniRoute local daemon SSE format: { content: "..." }
            const daemonContent = parsed.content;

            const content = deltaContent ?? simpleOutput ?? daemonContent;
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
          input:  await estimateTokens(prompt),
          output: await estimateTokens(fullOutput),
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
  async normalizeResponse(rawResponse) {
    // Defensive check for null/undefined response
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0 }, raw: {} };

    const output = rawResponse.output || rawResponse.choices?.[0]?.message?.content || rawResponse.choices?.[0]?.text || rawResponse.stderr || '';
    const tokens = await extractTokens(rawResponse, output);

    // Prefer explicit token fields from the local server if present
    if (rawResponse.tokens?.input !== undefined) {
      tokens.input  = rawResponse.tokens.input;
      tokens.output = rawResponse.tokens.output;
    }

    return { output, tokens: tokens || { input: 0, output: 0 }, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Local HTTP request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
