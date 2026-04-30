import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

const DEFAULT_TIMEOUT = 120000;
const ASSEMBLYAI_TRANSCRIPT_ENDPOINT = 'https://api.assemblyai.com/v2/transcript';
const POLL_INTERVAL = 1000;
const MAX_POLL_TIME = 30000;

export class AssemblyAIAdapter extends BaseAdapter {
  constructor() {
    super('assemblyai');
  }

  buildHeaders(apiKey, options = {}) {
    return {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    };
  }

  async transcribe(fileBuffer, model, options = {}) {
    const controller = this.createTimeout(DEFAULT_TIMEOUT);

    try {
      let audioUrl;

      const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: { Authorization: options.apiKey },
        body: fileBuffer,
        signal: controller.signal,
      });

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text().catch(() => '');
        throw new ProviderError('assemblyai', `Upload failed HTTP ${uploadResponse.status}: ${errorBody}`, uploadResponse.status);
      }

      const uploadData = await uploadResponse.json();
      audioUrl = uploadData.upload_url;

      const transcriptResponse = await fetch(ASSEMBLYAI_TRANSCRIPT_ENDPOINT, {
        method: 'POST',
        headers: this.buildHeaders(options.apiKey, options),
        body: JSON.stringify({
          audio_url: audioUrl,
          language_detection: options.language ? false : true,
          language_code: options.language || undefined,
        }),
        signal: controller.signal,
      });

      if (!transcriptResponse.ok) {
        const errorBody = await transcriptResponse.text().catch(() => '');
        throw new ProviderError('assemblyai', `Transcription request failed HTTP ${transcriptResponse.status}: ${errorBody}`, transcriptResponse.status);
      }

      const transcriptData = await transcriptResponse.json();
      const transcriptId = transcriptData.id;

      return await this.pollForResult(transcriptId, options.apiKey, controller);
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async pollForResult(transcriptId, apiKey, controller) {
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_POLL_TIME) {
      const response = await fetch(`${ASSEMBLYAI_TRANSCRIPT_ENDPOINT}/${transcriptId}`, {
        method: 'GET',
        headers: { Authorization: apiKey },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError('assemblyai', `Polling failed HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const data = await response.json();

      if (data.status === 'completed') {
        const words = data.words?.map(w => ({
          word: w.text,
          start: w.start / 1000,
          end: w.end / 1000,
        })) || [];

        return {
          text: data.text || '',
          duration: (data.audio_duration || 0) / 1000,
          words: words.length > 0 ? words : null,
          language: data.language_code || null,
        };
      }

      if (data.status === 'error') {
        throw new ProviderError('assemblyai', `Transcription error: ${data.error || 'Unknown error'}`, 500);
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new ProviderError('assemblyai', 'Transcription timed out', 504);
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}