import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Hugging Face Inference API Adapter.
 * Endpoint: https://api-inference.huggingface.co/models/{model_id}
 */
export class HuggingFaceAdapter extends BaseAdapter {
  constructor() {
    super('huggingface');
    this.baseUrl = 'https://api-inference.huggingface.co/models';
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
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
          inputs: prompt,
          parameters: { return_full_text: false },
        }),
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

  // Hugging Face streaming is specific, but many models now support OpenAI-compatible endpoints.
  // For simplicity, we'll implement a basic non-streaming for now or use the OpenAI-compatible route if available.
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    // Falling back to non-streaming for HF direct for now
    const result = await this.sendRequest(prompt, model, apiKey, options);
    const text = Array.isArray(result) ? result[0]?.generated_text : result.generated_text;
    
    if (options.onChunk && text) {
      options.onChunk({ content: text, provider: this.providerName, model });
    }

    return {
      output: text || '',
      tokens: await extractTokens(null, text || '', prompt),
    };
  }

  async normalizeResponse(rawResponse) {
    // HF format: [{ generated_text: "..." }]
    const output = Array.isArray(rawResponse) ? rawResponse[0]?.generated_text : rawResponse.generated_text;
    const tokens = await extractTokens(null, output || '');
    return { output: output || '', tokens, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
