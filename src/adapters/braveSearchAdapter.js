/**
 * Brave Search API adapter.
 * https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 *
 * Free tier: 2000 queries/month
 */
import { BaseAdapter } from './baseAdapter.js';

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export class BraveSearchAdapter extends BaseAdapter {
  constructor() {
    super('brave');
  }

  async search(query, apiKey, options = {}) {
    const {
      maxResults = 5,
      country = 'US',
      searchLang = 'en',
      signal,
    } = options;

    const params = new URLSearchParams({
      q: query,
      count: String(maxResults),
      country,
      search_lang: searchLang,
    });

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(`${BRAVE_ENDPOINT}?${params}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`Brave Search API error ${res.status}: ${errText}`);
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
    const webResults = raw.web?.results || [];
    const results = webResults.map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      score: 0,
    }));

    return {
      results,
      answer: '',
      query,
      provider: 'brave',
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
      options.onChunk({ content: '', provider: 'brave' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }
}
