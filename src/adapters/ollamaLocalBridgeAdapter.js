import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';

/**
 * Ollama Local Bridge adapter.
 * Tunnels requests through the OmniRouteAI-Local daemon to reach a machine's local Ollama.
 */
export class OllamaLocalBridgeAdapter extends BaseAdapter {
  constructor() {
    super('ollama_local_bridge');
    // The daemon URL (usually localhost:5059 or a tunneled endpoint)
    this.daemonUrl = process.env.LOCAL_DAEMON_URL || 'http://localhost:5059';
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const url = `${this.daemonUrl}/ollama`;
    const controller = this.createTimeout();

    try {
      const response = await fetch(url, {
        method:  'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Local-Token': process.env.LOCAL_DAEMON_TOKEN || '',
        },
        body: JSON.stringify({ prompt, model, stream: false }),
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errText = await response.text();
        throw new ProviderError(this.providerName, `Daemon Bridge Error: ${errText}`, response.status);
      }

      return await response.json();
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    // Current bridge implementation is non-streaming for simplicity
    const result = await this.sendRequest(prompt, model, apiKey, options);
    if (options.onChunk && result.output) {
      options.onChunk({ content: result.output, provider: this.providerName, model });
    }
    return result;
  }

  async normalizeResponse(rawResponse) {
    // Daemon already returns normalized format
    return rawResponse;
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Bridge request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
