import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Cloudflare Workers AI adapter.
 * Endpoint: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
 * Requires CF_ACCOUNT_ID env var.
 */
export class CloudflareAdapter extends BaseAdapter {
  constructor() {
    super('cloudflare');
    this.accountId = process.env.CF_ACCOUNT_ID;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run`;
  }

  /**
   * Send a non-streaming request to Cloudflare Workers AI.
   */
  async sendRequest(prompt, model, apiKey, options = {}) {
    if (!this.accountId) {
      throw new ProviderError(this.providerName, 'CF_ACCOUNT_ID not configured');
    }

    const url = `${this.baseUrl}/${model}`;
    const controller = this.createTimeout();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
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
   * Send a streaming request to Cloudflare Workers AI.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    if (!this.accountId) {
      throw new ProviderError(this.providerName, 'CF_ACCOUNT_ID not configured');
    }

    const url = `${this.baseUrl}/${model}`;
    const controller = this.createTimeout();
    let fullOutput = '';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          stream: true,
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
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.response;
            if (content) {
              fullOutput += content;
              if (options.onChunk) {
                options.onChunk({ content, provider: this.providerName, model });
              }
            }
          } catch {
            // Skip unparseable
          }
        }
      }

      return {
        output: fullOutput,
        tokens: await extractTokens(null, fullOutput, prompt),
        raw:    { streaming: true, provider: this.providerName, model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize Cloudflare Workers AI response.
   */
  async normalizeResponse(rawResponse) {
    // Cloudflare format: { result: { response: "text" }, success: true }
    const output = rawResponse.result?.response || '';
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
