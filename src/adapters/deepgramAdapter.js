import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

const DEFAULT_TIMEOUT = 60000;
const DEEPGRAM_ENDPOINT = 'https://api.deepgram.com/v1/listen';

export class DeepgramAdapter extends BaseAdapter {
  constructor() {
    super('deepgram');
    this.endpoint = DEEPGRAM_ENDPOINT;
  }

  buildHeaders(apiKey, options = {}) {
    return {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async transcribe(fileBuffer, model, options = {}) {
    const controller = this.createTimeout(DEFAULT_TIMEOUT);

    try {
      const params = new URLSearchParams();
      params.append('model', model || 'nova-2');
      params.append('punctuate', 'true');
      params.append('diarize', 'false');

      if (options.language) {
        params.append('language', options.language);
      }

      const response = await fetch(`${this.endpoint}?${params.toString()}`, {
        method: 'POST',
        headers: this.buildHeaders(options.apiKey, options),
        body: fileBuffer,
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError('deepgram', `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const data = await response.json();
      const result = data.results?.channels?.[0]?.alternatives?.[0];
      const words = result?.words?.map(w => ({
        word: w.word,
        start: w.start,
        end: w.end,
      })) || [];

      return {
        text: result?.transcript || '',
        duration: result?.duration || null,
        words: words.length > 0 ? words : null,
        language: result?.language || null,
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}