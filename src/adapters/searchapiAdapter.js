/**
 * SearchAPI.io adapter.
 * https://www.searchapi.io/docs/google
 *
 * Free tier: 100 free searches on signup
 */
import { BaseAdapter } from './baseAdapter.js';

const SEARCHAPI_ENDPOINT = 'https://searchapi.io/api/v1/search';

export class SearchApiAdapter extends BaseAdapter {
  constructor() {
    super('searchapi');
  }

  async search(query, apiKey, options = {}) {
    const {
      maxResults = 5,
      country = 'us',
      searchLang = 'en',
      signal,
    } = options;

    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      num: String(maxResults),
      gl: country,
      hl: searchLang,
      api_key: apiKey,
    });

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(`${SEARCHAPI_ENDPOINT}?${params}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`SearchAPI error ${res.status}: ${errText}`);
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
    const organicResults = raw.organic_results || [];
    const results = organicResults.map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      score: 0,
    }));

    return {
      results,
      answer: raw.answer_box?.snippet || raw.knowledge_graph?.description || '',
      query,
      provider: 'searchapi',
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
      options.onChunk({ content: result.answer || '', provider: 'searchapi' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }
}
