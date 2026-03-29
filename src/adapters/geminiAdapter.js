import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Gemini adapter.
 * Maps prompt → contents[{parts}], extracts candidates[0].
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 */
export class GeminiAdapter extends BaseAdapter {
  constructor(providerName = 'google') {
    super(providerName);
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  /**
   * Send a non-streaming request to Gemini.
   */
  buildBody(prompt, options = {}) {
    let parts = [];

    if (Array.isArray(prompt)) {
      parts = prompt.map(p => {
        if (typeof p === 'string') return { text: p };
        if (p.type === 'text') return { text: p.text };
        if (p.type === 'image' || p.type === 'audio' || p.type === 'video') {
          return {
            inlineData: {
              mimeType: p.media_type,
              data: p.data
            }
          };
        }
        return p;
      });
    } else {
      parts = [{ text: prompt }];
    }

    const body = {
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 8192 },
    };
    if (options.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }
    return body;
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const url = `${this.baseUrl}/${model}:generateContent?key=${apiKey}`;
    const controller = this.createTimeout();

    try {
      const reqHeaders = { 'Content-Type': 'application/json' };
      if (options.requestId) {
        reqHeaders['X-Request-ID'] = options.requestId;
        reqHeaders['X-OmniRoute-Request-ID'] = options.requestId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(this.buildBody(prompt, options)),
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
   * Send a streaming request to Gemini.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const url = `${this.baseUrl}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const controller = this.createTimeout();
    let fullOutput = '';
    let lastRaw = null; // capture last parsed chunk for usageMetadata

    try {
      const reqHeaders = { 'Content-Type': 'application/json' };
      if (options.requestId) {
        reqHeaders['X-Request-ID'] = options.requestId;
        reqHeaders['X-OmniRoute-Request-ID'] = options.requestId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(this.buildBody(prompt, options)),
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

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            lastRaw = parsed;
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullOutput += text;
              if (options.onChunk) {
                options.onChunk({ content: text, provider: this.providerName, model });
              }
            }
          } catch { /* skip unparseable */ }
        }
      }

      // Gemini includes usageMetadata in final chunk
      const tokens = await extractTokens(lastRaw, fullOutput, prompt);

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
   * Normalize Gemini response.
   */
  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0 }, raw: {} };
    const output = rawResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
