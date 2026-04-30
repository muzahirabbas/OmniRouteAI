/**
 * Base adapter — abstract class for all provider adapters.
 *
 * All adapters must:
 * - Extend this class
 * - Implement sendRequest(), sendStreamRequest(), normalizeResponse(), handleError()
 * - Enforce AbortController timeout (default 20s)
 * - Return normalized format: { output: string, tokens: { input, output }, raw: object }
 */

const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT = parseInt(process.env.PROVIDER_TIMEOUT_MS, 10) || 60000; // 60s

// Connection pooling for better performance
const KEEP_ALIVE_CONFIG = {
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
};

const sharedHttpAgent = new http.Agent(KEEP_ALIVE_CONFIG);
const sharedHttpsAgent = new https.Agent(KEEP_ALIVE_CONFIG);

function getAgent(url) {
  return url.startsWith('https') ? sharedHttpsAgent : sharedHttpAgent;
}

export class BaseAdapter {
  constructor(providerName) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract — cannot be instantiated directly');
    }
    this.providerName = providerName;
    this.timeout = DEFAULT_TIMEOUT;
  }

  /**
   * Sanitizes a MIME type by removing parameters (like ;codecs=opus).
   * Most AI providers (Gemini, Anthropic) are strict and reject MIME types with parameters.
   * 
   * @param {string} mimeType 
   * @returns {string} - Cleaned MIME type (e.g., 'audio/webm')
   */
  sanitizeMimeType(mimeType) {
    if (!mimeType) return 'application/octet-stream';
    // Remove everything after the first semicolon
    return mimeType.split(';')[0].trim().toLowerCase();
  }

  /**
   * Basic validation for supported multimodal MIME types.
   * Useful for early filtering of obscure formats that cause 400 errors.
   */
  isMimeSupported(mimeType) {
    const clean = this.sanitizeMimeType(mimeType);
    const supportedPrefixes = ['image/', 'audio/', 'video/', 'application/pdf', 'text/plain'];
    return supportedPrefixes.some(prefix => clean.startsWith(prefix));
  }

  /**
   * Recursively strips unsupported properties from JSON schemas (parameters).
   * Many providers (Gemini, Anthropic, DeepSeek, etc.) have strict schema validations
   * and reject non-standard keys like '$schema' or 'additionalProperties'.
   * 
   * @param {object} schema - The JSON schema to clean
   * @param {boolean} [isPropertiesMap] - Internal flag for properties container
   * @returns {object} - The cleaned schema
   */
  cleanSchema(schema, isPropertiesMap = false) {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(s => this.cleanSchema(s));
    
    const cleaned = {};

    // If this is a properties map (e.g. { "propName": { schema } }), 
    // we must preserve the keys as they are property names, not schema keywords.
    if (isPropertiesMap) {
      for (const [k, v] of Object.entries(schema)) {
        cleaned[k] = this.cleanSchema(v);
      }
      return cleaned;
    }

    // Whitelist of standard keys supported by most restrictive providers
    const allowedKeys = ['type', 'format', 'description', 'nullable', 'enum', 'items', 'properties', 'required'];
    
    for (const [k, v] of Object.entries(schema)) {
      if (allowedKeys.includes(k)) {
        if (k === 'properties') {
          cleaned[k] = this.cleanSchema(v, true);
        } else if (k === 'items') {
          cleaned[k] = this.cleanSchema(v);
        } else {
          cleaned[k] = v;
        }
      }
    }

    // Ensure the 'required' array only contains properties that actually exist 
    // in the 'properties' map after cleaning.
    if (cleaned.required && Array.isArray(cleaned.required) && cleaned.properties) {
      cleaned.required = cleaned.required.filter(prop => !!cleaned.properties[prop]);
      if (cleaned.required.length === 0) delete cleaned.required;
    }

    return cleaned;
  }

  async makeRequest(url, options = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const maxRetries = options.retries ?? 3;
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          agent: getAgent(url),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (err) {
        lastError = err;
        const isLastAttempt = attempt === maxRetries;
        const isRetryable = err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.message.includes('timeout');
        
        if (isLastAttempt || !isRetryable) {
          clearTimeout(timeoutId);
          throw err;
        }
        
        const delay = 1_000 * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    clearTimeout(timeoutId);
    throw lastError;
  }

  /**
   * Create an AbortController with timeout.
   * @param {number} [ms] - timeout in milliseconds
   * @returns {{ controller: AbortController, signal: AbortSignal }}
   */
  createTimeout(ms = this.timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    // Attach cleanup
    controller._timer = timer;
    return controller;
  }

  /**
   * Clean up the abort controller timer.
   * @param {AbortController} controller
   */
  clearTimeout(controller) {
    if (controller?._timer) {
      clearTimeout(controller._timer);
    }
  }

  /**
   * Send a non-streaming request to the provider.
   * MUST be implemented by subclasses.
   *
   * @param {string} prompt
   * @param {string} model
   * @param {string} apiKey
   * @param {object} [options] - { requestId, taskType }
   * @returns {Promise<object>} raw provider response
   */
  async sendRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout(options.timeout || 60000);
    throw new Error(`sendRequest() not implemented for ${this.providerName}`);
  }

  /**
   * Send a streaming request to the provider.
   * MUST be implemented by subclasses.
   *
   * @param {string} prompt
   * @param {string} model
   * @param {string} apiKey
   * @param {object} [options] - { requestId, taskType, onChunk }
   * @returns {Promise<{ output: string, tokens: { input: number, output: number } }>}
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    throw new Error(`sendStreamRequest() not implemented for ${this.providerName}`);
  }

  /**
   * Normalize a raw provider response into the standard format.
   * MUST be implemented by subclasses.
   *
   * @param {object} rawResponse
   * @returns {Promise<{ output: string, tokens: { input: number, output: number, reasoning?: number }, thinking?: string|null, tool_calls?: array, finish_reason?: string, raw: object }>}
   */
  async normalizeResponse(rawResponse) {
    throw new Error(`normalizeResponse() not implemented for ${this.providerName}`);
  }

  /**
   * Handle a provider-specific error.
   * Can be overridden by subclasses for custom error mapping.
   *
   * @param {Error} err
   * @returns {Error}
   */
  handleError(err) {
    // Note: subclasses should override this and import ProviderError directly.
    // This base implementation provides a generic Error wrapper.
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`[${this.providerName}] Request timed out`);
      timeoutErr.statusCode = 504;
      timeoutErr.cause = err;
      return timeoutErr;
    }

    const statusCode = err.status || err.statusCode || 502;
    const wrappedErr = new Error(`[${this.providerName}] ${err.message}`);
    wrappedErr.statusCode = statusCode;
    wrappedErr.cause = err;
    return wrappedErr;
  }
}
