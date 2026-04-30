/**
 * Tavily Search API adapter.
 * https://docs.tavily.com/documentation/api-reference/endpoint/search
 *
 * Free tier: 1000 queries/month
 */
import { BaseAdapter } from './baseAdapter.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

export class TavilyAdapter extends BaseAdapter {
  constructor() {
    super('tavily');
  }

  async search(query, apiKey, options = {}) {
    const {
      maxResults = 5,
      searchDepth = 'basic',
      includeAnswer = true,
      includeRawContent = false,
      signal,
    } = options;

    const body = {
      query,
      api_key: apiKey,
      max_results: maxResults,
      search_depth: searchDepth,
      include_answer: includeAnswer,
      include_raw_content: includeRawContent,
    };

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`Tavily API error ${res.status}: ${errText}`);
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
      snippet: r.content || '',
      score: r.score || 0,
    }));

    return {
      results,
      answer: raw.answer || '',
      query,
      provider: 'tavily',
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
      options.onChunk({ content: result.answer || '', provider: 'tavily' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }
}
