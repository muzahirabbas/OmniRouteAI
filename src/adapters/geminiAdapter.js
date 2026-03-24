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
  async sendRequest(prompt, model, apiKey, options = {}) {
    const url = `${this.baseUrl}/${model}:generateContent?key=${apiKey}`;
    const controller = this.createTimeout();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 8192,
          },
        }),
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(
          this.providerName,
          `HTTP ${response.status}: ${errorBody}`,
          response.status,
        );
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
    const controller = this.createTimeout(60000);
    let fullOutput = '';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 8192,
          },
        }),
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(
          this.providerName,
          `HTTP ${response.status}: ${errorBody}`,
          response.status,
        );
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
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullOutput += text;
              if (options.onChunk) {
                options.onChunk({ content: text, provider: this.providerName, model });
              }
            }
          } catch {
            // Skip unparseable lines
          }
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
   * Normalize Gemini response.
   */
  normalizeResponse(rawResponse) {
    const output = rawResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
