/**
 * DuckDuckGo Search adapter (no API key required).
 * Scrapes DuckDuckGo HTML results page.
 *
 * Free tier: Unlimited (rate-limited)
 */
import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

const DUCKDUCKGO_ENDPOINT = 'https://html.duckduckgo.com/html/';

export class DuckDuckGoAdapter extends BaseAdapter {
  constructor() {
    super('duckduckgo');
  }

  async search(query, _apiKey, options = {}) {
    const {
      maxResults = 5,
      signal,
    } = options;

    const params = new URLSearchParams({ q: query });

    const controller = this.createTimeout(30000);
    const finalSignal = signal || controller.signal;

    try {
      const res = await fetch(`${DUCKDUCKGO_ENDPOINT}?${params}`, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: finalSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new ProviderError('duckduckgo', `Search error HTTP ${res.status}: ${errText}`, res.status);
      }

      const html = await res.text();
      const results = this.parseHtmlResults(html, maxResults);
      return this.normalizeResponse({ results, query }, query);
    } finally {
      this.clearTimeout(controller);
    }
  }

  parseHtmlResults(html, maxResults) {
    const results = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      let url = match[1];
      const title = match[2].replace(/<[^>]*>/g, '').trim();
      const snippet = match[3].replace(/<[^>]*>/g, '').trim();

      // DuckDuckGo wraps URLs in a redirect — extract the real URL
      const realUrlMatch = url.match(/uddg=([^&]+)/);
      if (realUrlMatch) {
        url = decodeURIComponent(realUrlMatch[1]);
      }

      if (title && snippet) {
        results.push({ title, url, snippet, score: 0 });
      }
    }

    return results;
  }

  normalizeResponse(raw, query) {
    return {
      results: raw.results || [],
      answer: '',
      query,
      provider: 'duckduckgo',
      tokens: { input: query.length, output: (raw.results || []).reduce((sum, r) => sum + r.title.length + r.snippet.length, 0) },
      raw,
    };
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    return this.search(prompt, apiKey, options);
  }

  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const result = await this.search(prompt, apiKey, options);
    if (options.onChunk) {
      options.onChunk({ content: '', provider: 'duckduckgo' });
    }
    return result;
  }

  async normalizeResponseWrapper(rawResponse) {
    return this.normalizeResponse(rawResponse, rawResponse.query || '');
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
