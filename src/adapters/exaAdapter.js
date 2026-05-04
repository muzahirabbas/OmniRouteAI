/**
 * Exa (neural/semantic search) API adapter.
 * https://docs.exa.ai/reference/search
 *
 * Free tier: 100k characters/month
 */
import { BaseAdapter } from './baseAdapter.js';

const EXA_ENDPOINT = 'https://api.exa.ai/search';

export class ExaAdapter extends BaseAdapter {
  constructor() {
    super('exa');
  }

  async search(query, apiKey, options = {}) {
    const {
      maxResults = 5,
      useAutoprompt = true,
      type = 'neural',
      includeText = true,
      includeHighlights = false,
      signal,
    } = options;

    const body = {
      query,
      numResults: maxResults,
      use_autoprompt: useAutoprompt,
      type,
    };
    
    if (includeText || includeHighlights) {
      body.contents = {
        text: includeText ? { maxCharacters: 4000 } : undefined,
        highlights: includeHighlights ? { numSentences: 3 } : undefined,
      };
    }

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(EXA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`Exa API error ${res.status}: ${errText}`);
        err.statusCode = res.status;
        throw err;
      }

      const data = await res.json();
      return this.normalizeResponse(data, query);
    } finally {
      this.clearTimeout(controller);
    }
  }

  normalizeResponse(raw, query) {
    const results = (raw.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.text || '',
      score: r.score || 0,
    }));

    return {
      results,
      answer: '',
      query,
      provider: 'exa',
      tokens: { input: query.length, output: results.reduce((sum, r) => sum + r.title.length + r.snippet.length, 0) },
      raw,
    };
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    return this.search(prompt, apiKey, options);
  }

  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const result = await this.search(prompt, apiKey, options);
    if (options.onChunk) {
      options.onChunk({ content: '', provider: 'exa' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }
}
