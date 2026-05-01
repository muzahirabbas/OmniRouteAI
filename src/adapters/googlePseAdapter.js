/**
 * Google Programmable Search Engine (PSE) adapter.
 * https://developers.google.com/custom-search/v1/overview
 *
 * Free tier: 100 queries/day
 * Requires: API key + Search Engine ID (cx)
 */
import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

const GOOGLE_PSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

export class GooglePSEAdapter extends BaseAdapter {
  constructor() {
    super('google-pse');
  }

  async search(query, apiKey, options = {}) {
    const {
      maxResults = 5,
      cx,
      country = 'us',
      searchLang = 'en',
      signal,
    } = options;

    if (!cx) {
      throw new ProviderError('google-pse', 'Google PSE requires a Search Engine ID (cx). Set it in key metadata.', 400);
    }

    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: query,
      num: String(Math.min(maxResults, 10)),
      gl: country,
      lr: `lang_${searchLang}`,
    });

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(`${GOOGLE_PSE_ENDPOINT}?${params}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`Google PSE error ${res.status}: ${errText}`);
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
    const items = raw.items || [];
    const results = items.map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      score: 0,
    }));

    return {
      results,
      answer: '',
      query,
      provider: 'google-pse',
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
      options.onChunk({ content: '', provider: 'google-pse' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }
}
