import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

const DEFAULT_TIMEOUT = 120000;
const ASSEMBLYAI_TRANSCRIPT_ENDPOINT = 'https://api.assemblyai.com/v2/transcript';
const POLL_INTERVAL = 1000;
const MAX_POLL_TIME = 30000;

export class AssemblyAIAdapter extends BaseAdapter {
  constructor() {
    super('assemblyai');
    this.providerName = 'assemblyai';
  }

  buildHeaders(apiKey, options = {}) {
    return {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    };
  }

  async transcribe(fileBuffer, model, options = {}) {
    const requestId = options.requestId || 'unknown';
    const controller = this.createTimeout(DEFAULT_TIMEOUT);

    console.log(JSON.stringify({
      level: 'info',
      msg: 'Starting AssemblyAI transcription',
      requestId,
      fileSize: fileBuffer.length,
      model: model || 'best',
    }));

    try {
      let audioUrl;

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Uploading audio to AssemblyAI',
        requestId,
      }));

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

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Audio uploaded, starting transcription',
        requestId,
        audioUrl: audioUrl.substring(0, 50) + '...',
      }));

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

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Transcription job created, polling for result',
        requestId,
        transcriptId,
      }));

      return await this.pollForResult(transcriptId, options.apiKey, controller, requestId);
    } catch (err) {
      this.clearTimeout(controller);
      console.log(JSON.stringify({
        level: 'error',
        msg: 'AssemblyAI transcription failed',
        requestId,
        error: err.message,
      }));
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async pollForResult(transcriptId, apiKey, controller, requestId = 'unknown') {
    const startTime = Date.now();

    console.log(JSON.stringify({
      level: 'info',
      msg: 'Polling AssemblyAI for transcription result',
      requestId,
      transcriptId,
    }));

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

      console.log(JSON.stringify({
        level: 'debug',
        msg: 'AssemblyAI poll response',
        requestId,
        status: data.status,
      }));

      if (data.status === 'completed') {
        this.clearTimeout(controller);
        
        const words = data.words?.map(w => ({
          word: w.text,
          start: w.start / 1000,
          end: w.end / 1000,
        })) || [];

        console.log(JSON.stringify({
          level: 'info',
          msg: 'AssemblyAI transcription completed',
          requestId,
          textLength: data.text?.length || 0,
          duration: (data.audio_duration || 0) / 1000,
          language: data.language_code,
        }));

        return {
          text: data.text || '',
          duration: (data.audio_duration || 0) / 1000,
          words: words.length > 0 ? words : null,
          language: data.language_code || null,
        };
      }

      if (data.status === 'error') {
        this.clearTimeout(controller);
        throw new ProviderError('assemblyai', `Transcription error: ${data.error || 'Unknown error'}`, 500);
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    this.clearTimeout(controller);
    throw new ProviderError('assemblyai', 'Transcription timed out', 504);
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}