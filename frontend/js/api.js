/**
 * OmniRouteAI Dashboard — API Client
 *
 * Handles all communication with the backend admin API.
 * Settings (API URL, key) are stored in localStorage.
 * 
 * SECURITY: API key can be stored encrypted using Web Crypto API.
 * Encryption key is derived from a user-provided passphrase (not stored).
 * For maximum security, users should re-enter passphrase each session.
 */

// ─── Crypto Utilities ──────────────────────────────────────────────────

const CRYPTO_ENABLED = typeof crypto !== 'undefined' && crypto.subtle;

/**
 * Derive an encryption key from a passphrase using PBKDF2.
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with a passphrase.
 * @param {string} data - String to encrypt
 * @param {string} passphrase
 * @returns {Promise<string>} Base64-encoded encrypted data with salt
 */
async function encryptData(data, passphrase) {
  if (!CRYPTO_ENABLED) return btoa(data); // Fallback to base64
  
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encoded = new TextEncoder().encode(data);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  
  // Combine salt + iv + encrypted data
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data with a passphrase.
 * @param {string} encryptedDataBase64
 * @param {string} passphrase
 * @returns {Promise<string>}
 */
async function decryptData(encryptedDataBase64, passphrase) {
  if (!CRYPTO_ENABLED) return atob(encryptedDataBase64); // Fallback
  
  try {
    const combined = Uint8Array.from(atob(encryptedDataBase64), c => c.charCodeAt(0));
    
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);
    
    const key = await deriveKey(passphrase, salt);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    throw new Error('Decryption failed. Check your passphrase.');
  }
}

// ─── API Client ────────────────────────────────────────────────────────

const API = {
  /**
   * Get the configured backend URL.
   */
  getBaseUrl() {
    return localStorage.getItem('omniroute_api_url') || 'http://localhost:3000';
  },

  /**
   * Get the configured API key.
   * If encrypted, prompts for passphrase (optional based on settings).
   */
  async getApiKey() {
    const encryptedKey = localStorage.getItem('omniroute_api_key_encrypted');
    const plainKey = localStorage.getItem('omniroute_api_key');
    
    // If we have an encrypted key, decrypt it
    if (encryptedKey) {
      const useEncryption = localStorage.getItem('omniroute_use_encryption') === 'true';
      if (useEncryption) {
        // Check if passphrase is cached for this session
        let passphrase = sessionStorage.getItem('omniroute_passphrase_cache');
        
        if (!passphrase) {
          // Prompt user for passphrase
          passphrase = prompt('Enter your passphrase to decrypt the API key:');
          if (!passphrase) return plainKey || '';
          
          // Cache passphrase for this session only
          sessionStorage.setItem('omniroute_passphrase_cache', passphrase);
        }
        
        try {
          return await decryptData(encryptedKey, passphrase);
        } catch (err) {
          console.error('Failed to decrypt API key:', err);
          sessionStorage.removeItem('omniroute_passphrase_cache');
          return plainKey || '';
        }
      }
    }
    
    return plainKey || '';
  },

  /**
   * Save settings to localStorage.
   * @param {string} url
   * @param {string} apiKey
   * @param {object} options - { useEncryption, passphrase }
   */
  async saveSettings(url, apiKey, options = {}) {
    const { useEncryption = false, passphrase } = options;
    
    if (url) {
      let finalUrl = url.trim().replace(/\/$/, '');
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = `https://${finalUrl}`;
      }
      localStorage.setItem('omniroute_api_url', finalUrl);
    }
    
    if (apiKey) {
      if (useEncryption && passphrase && CRYPTO_ENABLED) {
        // Store encrypted key
        const encrypted = await encryptData(apiKey, passphrase);
        localStorage.setItem('omniroute_api_key_encrypted', encrypted);
        localStorage.removeItem('omniroute_api_key');
        localStorage.setItem('omniroute_use_encryption', 'true');
      } else {
        // Store plain key
        localStorage.setItem('omniroute_api_key', apiKey);
        localStorage.removeItem('omniroute_api_key_encrypted');
        localStorage.removeItem('omniroute_use_encryption');
      }
    }
  },

  /**
   * Check if encryption is enabled.
   * @returns {boolean}
   */
  isEncryptionEnabled() {
    return localStorage.getItem('omniroute_use_encryption') === 'true';
  },

  /**
   * Clear stored credentials.
   */
  clearCredentials() {
    localStorage.removeItem('omniroute_api_key');
    localStorage.removeItem('omniroute_api_key_encrypted');
    localStorage.removeItem('omniroute_use_encryption');
    localStorage.removeItem('omniroute_api_url');
    sessionStorage.removeItem('omniroute_passphrase_cache');
  },

  /**
   * Make an authenticated request to the backend.
   */
  async request(path, options = {}) {
    const base = this.getBaseUrl();
    const apiKey = await this.getApiKey();

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

  // ─── Local Daemon (direct localhost calls) ──────────────────────────

  getDaemonUrl() {
    return localStorage.getItem('daemonUrl') || 'http://localhost:5059';
  },

  getDaemonToken() {
    return localStorage.getItem('daemonToken') || '';
  },

  /**
   * Make a request directly to the local daemon (bypasses cloud backend).
   * Uses X-Local-Token header for auth.
   */
  async daemonRequest(path, options = {}) {
    const base = this.getDaemonUrl();
    const token = this.getDaemonToken();

    const headers = {
      ...options.headers,
    };

    if (options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers['X-Local-Token'] = token;
    }

    const url = `${base}${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Cannot connect to local daemon. Is it running on port 5059?');
      }
      throw err;
    }
  },
};

// Export for module environments, or set globally
if (typeof window !== 'undefined') {
  window.API = API;
}
