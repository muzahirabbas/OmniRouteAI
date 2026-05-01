import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

const DEFAULT_TIMEOUT = 45000; // 45s - shorter than client timeout
const GROQ_WHISPER_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export class GroqWhisperAdapter extends BaseAdapter {
  constructor() {
    super('groq-whisper');
    this.endpoint = GROQ_WHISPER_ENDPOINT;
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
    const requestId = options.requestId || 'unknown';
    
    // Log starting API request
    console.log(JSON.stringify({
      level: 'info',
      msg: 'Sending to Groq Whisper API',
      requestId,
      model: model || 'whisper-large-v3',
      fileSize: fileBuffer.length,
    }));

    try {
      const formData = new FormData();
      const filename = options.filename || 'audio.wav';
      const mimeType = this.sanitizeMimeType(options.mimeType || 'audio/wav');

      formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
      formData.append('model', model || 'whisper-large-v3');

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
        throw new ProviderError('groq', `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const data = await response.json();
      
      // Log API response received
      console.log(JSON.stringify({
        level: 'info',
        msg: 'Groq Whisper API response received',
        requestId,
        textLength: data.text?.length || 0,
        duration: data.duration,
        language: data.language,
      }));

      return {
        text: data.text || '',
        duration: data.duration || null,
        words: data.words || null,
        language: data.language || null,
      };
    } catch (err) {
      this.clearTimeout(controller);
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