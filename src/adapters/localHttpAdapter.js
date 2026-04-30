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
        ...(options.noContext ? { noContext: true } : {}),
        ...(options.messages ? { messages: options.messages } : {}),
        ...(options.tools ? { 
          tools: options.tools.map(t => {
            if (t.type === 'function' && t.function && t.function.parameters) {
              return { ...t, function: { ...t.function, parameters: this.cleanSchema(t.function.parameters) } };
            }
            return t;
          }) 
        } : {}),
        ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
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
        
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errJson = JSON.parse(errText);
          errorMessage += `: ${errJson.error || errJson.message || errText}`;
        } catch {
          errorMessage += `: ${errText.substring(0, 200)}`;
        }
        
        throw new ProviderError(this.providerName, errorMessage, response.status);
      }

      // Safer JSON parsing
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        throw new ProviderError(
          this.providerName, 
          `Invalid JSON response from daemon: ${text.substring(0, 200)}`, 
          502
        );
      }
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      
      // Enhance error message for connection failures
      if (err.cause?.code === 'ECONNREFUSED') {
        throw new ProviderError(
          this.providerName,
          `Cannot connect to local daemon at ${this.endpoint}. Is the daemon running?`,
          503
        );
      }
      
      throw this.handleError(err);
    }
  }

  /**
   * Streaming request.
   */
  async sendStreamRequest(prompt, model, _apiKey, options = {}) {
    const controller = this.createTimeout(300000); 
    const signal = options.abortSignal 
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;
    let fullOutput   = '';

    try {
      const body = {
        prompt,
        model,
        stream: true,
        ...(options.systemPrompt ? { system_prompt: options.systemPrompt } : {}),
        ...(options.noContext ? { noContext: true } : {}),
        ...(options.messages ? { messages: options.messages } : {}),
        ...(options.tools ? { 
          tools: options.tools.map(t => {
            if (t.type === 'function' && t.function && t.function.parameters) {
              return { ...t, function: { ...t.function, parameters: this.cleanSchema(t.function.parameters) } };
            }
            return t;
          }) 
        } : {}),
        ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
      };

      const response = await fetch(this.endpoint, {
        method:  'POST',
        headers: this.buildHeaders(),
        body:    JSON.stringify(body),
        signal,
      });

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
            const deltaContent = parsed.choices?.[0]?.delta?.content || parsed.output || '';
            if (deltaContent) {
              fullOutput += deltaContent;
              if (options.onChunk) {
                options.onChunk({ content: deltaContent, provider: this.providerName, model });
              }
            }
          } catch (e) {}
        }
      }

      this.clearTimeout(controller);
      const tokens = await estimateTokens(fullOutput); 

      return {
        output: fullOutput,
        tokens: { input: 0, output: tokens },
        raw:    { streaming: true, provider: this.providerName, model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0 }, raw: {} };
    const output = rawResponse.output || rawResponse.choices?.[0]?.message?.content || '';
    const tokens = rawResponse.tokens || { input: 0, output: await estimateTokens(output) };
    return { 
      output, 
      tokens, 
      thinking: null, 
      tool_calls: rawResponse.tool_calls || [], 
      finish_reason: 'stop', 
      raw: rawResponse 
    };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
