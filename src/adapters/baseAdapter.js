/**
 * Base adapter — abstract class for all provider adapters.
 *
 * All adapters must:
 * - Extend this class
 * - Implement sendRequest(), sendStreamRequest(), normalizeResponse(), handleError()
 * - Enforce AbortController timeout (default 20s)
 * - Return normalized format: { output: string, tokens: { input, output }, raw: object }
 */

const DEFAULT_TIMEOUT = parseInt(process.env.PROVIDER_TIMEOUT_MS, 10) || 60000; // 60s

export class BaseAdapter {
  constructor(providerName) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract — cannot be instantiated directly');
    }
    this.providerName = providerName;
    this.timeout = DEFAULT_TIMEOUT;
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
   * @returns {Promise<{ output: string, tokens: { input: number, output: number }, raw: object }>}
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
