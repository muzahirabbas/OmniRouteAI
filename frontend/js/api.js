/**
 * OmniRouteAI Dashboard — API Client
 *
 * Handles all communication with the backend admin API.
 * Settings (API URL, key) are stored in localStorage.
 */

const API = {
  /**
   * Get the configured backend URL.
   */
  getBaseUrl() {
    return localStorage.getItem('omniroute_api_url') || 'http://localhost:3000';
  },

  /**
   * Get the configured API key.
   */
  getApiKey() {
    return localStorage.getItem('omniroute_api_key') || '';
  },

  /**
   * Save settings to localStorage.
   */
  saveSettings(url, apiKey) {
    if (url) {
      let finalUrl = url.trim().replace(/\/$/, '');
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = `https://${finalUrl}`;
      }
      localStorage.setItem('omniroute_api_url', finalUrl);
    }
    if (apiKey) localStorage.setItem('omniroute_api_key', apiKey);
  },

  /**
   * Make an authenticated request to the backend.
   */
  async request(path, options = {}) {
    const base = this.getBaseUrl();
    const apiKey = this.getApiKey();

    const headers = {
      ...options.headers,
    };

    // Only set Content-Type to JSON if we are actually sending a body
    if (options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const url = `${base}${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Cannot connect to backend. Check your API URL in Settings.');
      }
      throw err;
    }
  },

  // ─── Health & Overview ─────────────────────────────────────────────

  async getHealth() {
    return this.request('/api/admin/health');
  },

  async getOverview() {
    return this.request('/api/admin/overview');
  },

  // ─── Providers ─────────────────────────────────────────────────────

  async getProviders() {
    return this.request('/api/admin/providers');
  },

  async updateProvider(name, data) {
    return this.request(`/api/admin/providers/${name}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async toggleProvider(name, disabled, ttl) {
    return this.request(`/api/admin/providers/${name}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ disabled, ttl }),
    });
  },

  async seedProviders() {
    return this.request('/api/admin/seed-providers', { method: 'POST' });
  },

  // ─── API Keys ──────────────────────────────────────────────────────

  async getKeys(provider) {
    return this.request(`/api/admin/keys/${provider}`);
  },

  async addKey(provider, key) {
    return this.request(`/api/admin/keys/${provider}`, {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
  },

  async removeKey(provider, key) {
    return this.request(`/api/admin/keys/${encodeURIComponent(provider)}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  },

  async toggleKey(provider, key, disabled) {
    return this.request(`/api/admin/keys/${encodeURIComponent(provider)}/${encodeURIComponent(key)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ disabled }),
    });
  },

  // ─── Logs ──────────────────────────────────────────────────────────

  async getLogs(opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', opts.limit);
    if (opts.provider) params.set('provider', opts.provider);
    if (opts.status) params.set('status', opts.status);

    return this.request(`/api/admin/logs?${params.toString()}`);
  },

  async flushLogs() {
    return this.request('/api/admin/logs/flush', { method: 'POST' });
  },

  // ─── Stats ─────────────────────────────────────────────────────────

  async getStats() {
    return this.request('/api/admin/stats');
  },

  async getStatsHistory(days = 7) {
    return this.request(`/api/admin/stats/history?days=${days}`);
  },

  async aggregateStats() {
    return this.request('/api/admin/stats/aggregate', { method: 'POST' });
  },
};

// Export for module environments, or set globally
if (typeof window !== 'undefined') {
  window.API = API;
}
