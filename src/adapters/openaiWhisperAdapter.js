import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

const DEFAULT_TIMEOUT = 60000;
const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

export class OpenAIWhisperAdapter extends BaseAdapter {
  constructor() {
    super('openai-whisper');
    this.endpoint = WHISPER_ENDPOINT;
  }

  buildHeaders(apiKey, options = {}) {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
    };

    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }

    return headers;
  }

  async transcribe(fileBuffer, model, options = {}) {
    const controller = this.createTimeout(DEFAULT_TIMEOUT);

    try {
      const formData = new FormData();
      const filename = options.filename || 'audio.wav';
      const mimeType = options.mimeType || 'audio/wav';

      formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
      formData.append('model', model || 'whisper-1');

      if (options.language) {
        formData.append('language', options.language);
      }

      if (options.prompt) {
        formData.append('prompt', options.prompt);
      }

      if (options.temperature !== undefined) {
        formData.append('temperature', String(options.temperature));
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(options.apiKey, options),
        body: formData,
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError('openai', `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const data = await response.json();

      return {
        text: data.text || '',
        duration: data.duration || null,
        words: data.words || null,
        language: data.language || null,
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