/**
 * Serper (Google SERP) API adapter.
 * https://serper.dev/playground
 *
 * Free tier: 1000 queries/month
 */
import { BaseAdapter } from './baseAdapter.js';

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export class SerperAdapter extends BaseAdapter {
  constructor() {
    super('serper');
  }

  async search(query, apiKey, options = {}) {
    const {
      maxResults = 5,
      country = 'us',
      searchLang = 'en',
      signal,
    } = options;

    const body = {
      q: query,
      num: maxResults,
      gl: country,
      hl: searchLang,
    };

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(SERPER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
        },
        body: JSON.stringify(body),
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`Serper API error ${res.status}: ${errText}`);
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
    const organicResults = raw.organic || [];
    const results = organicResults.map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      score: 0,
    }));

    return {
      results,
      answer: raw.answerBox?.snippet || raw.knowledgeGraph?.description || '',
      query,
      provider: 'serper',
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
      options.onChunk({ content: result.answer || '', provider: 'serper' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }
}
