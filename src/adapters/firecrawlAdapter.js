/**
 * Firecrawl Search API adapter.
 * https://docs.firecrawl.dev/api-reference/endpoint/search
 *
 * Free tier: 500 pages/month
 */
import { BaseAdapter } from './baseAdapter.js';

const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v1/search';

export class FirecrawlAdapter extends BaseAdapter {
  constructor() {
    super('firecrawl');
  }

  async search(query, apiKey, options = {}) {
    const {
      maxResults = 5,
      signal,
    } = options;

    const body = {
      query,
      limit: maxResults,
      lang: 'en',
      country: 'us',
    };

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(FIRECRAWL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`Firecrawl API error ${res.status}: ${errText}`);
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
    const results = (raw.data || []).map(r => ({
      title: r.title || r.metadata?.title || '',
      url: r.url || r.metadata?.sourceURL || '',
      snippet: r.description || r.metadata?.description || '',
      score: r.score || 0,
    }));

    return {
      results,
      answer: '',
      query,
      provider: 'firecrawl',
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
      options.onChunk({ content: '', provider: 'firecrawl' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }
}
