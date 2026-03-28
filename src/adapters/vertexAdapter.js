import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { estimateTokens } from '../services/statsService.js';

/**
 * Google Vertex AI Adapter.
 *
 * Note: Vertex AI uses a different auth and URL structure than Standard Gemini.
 * It requires a Google Cloud Access Token (not an API key) — provided by the
 * local-daemon's OAuth/Harvester service.
 *
 * All methods return normalized: { output: string, tokens: { input, output }, raw: object }
 */
export class VertexAdapter extends BaseAdapter {
  constructor(region = 'us-central1') {
    super('vertex');
    this.region = region;
  }

  buildUrl(projectId, model, stream = false) {
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    return `https://${this.region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${this.region}/publishers/google/models/${model}:${method}`;
  }

  buildHeaders(apiKey, options = {}) {
    const headers = {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }
    return headers;
  }

  buildBody(prompt, options = {}) {
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    if (options.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }
    return body;
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const projectId = options.projectId || process.env.GOOGLE_PROJECT_ID;
    const url = this.buildUrl(projectId, model, false);
    const controller = this.createTimeout();

    try {
      const response = await fetch(url, {
        method:  'POST',
        headers: this.buildHeaders(apiKey, options),
        body:    JSON.stringify(this.buildBody(prompt, options)),
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
   * Streaming request — reads Vertex SSE events (same format as Gemini).
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const projectId = options.projectId || process.env.GOOGLE_PROJECT_ID;
    // ?alt=sse forces SSE streaming (same as Gemini streamGenerateContent)
    const url = `${this.buildUrl(projectId, model, true)}?alt=sse`;
    const controller = this.createTimeout();
    let fullOutput = '';
    let lastRaw = null;

    try {
      const response = await fetch(url, {
        method:  'POST',
        headers: this.buildHeaders(apiKey, options),
        body:    JSON.stringify(this.buildBody(prompt, options)),
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

      // Vertex includes usageMetadata in the final chunk (same as Gemini)
      const tokens = lastRaw?.usageMetadata
        ? {
            input:  lastRaw.usageMetadata.promptTokenCount     || 0,
            output: lastRaw.usageMetadata.candidatesTokenCount || 0,
          }
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
   * Normalize Vertex non-streaming response (same shape as Gemini).
   */
  async normalizeResponse(raw) {
    if (!raw) return { output: '', tokens: { input: 0, output: 0 }, raw: {} };
    const output = raw.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const tokens = raw.usageMetadata
      ? {
          input:  raw.usageMetadata.promptTokenCount     || 0,
          output: raw.usageMetadata.candidatesTokenCount || 0,
        }
      : {
          input:  0,
          output: await estimateTokens(output),
        };

    return { output, tokens, raw };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
