import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { estimateTokens } from '../services/statsService.js';

/**
 * Google Vertex AI Adapter.
 * 
 * Note: Vertex AI uses a different auth and URL structure than Standard Gemini.
 * It requires Google Cloud Service Account credentials.
 */
export class VertexAdapter extends BaseAdapter {
  constructor(region = 'us-central1') {
    super('vertex');
    this.region = region;
  }

  // Vertex requires a different URL structure based on project/location
  buildUrl(projectId, model) {
    return `https://${this.region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${this.region}/publishers/google/models/${model}:streamGenerateContent`;
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    // This expects apiKey to be a Google Cloud Access Token (not an API Key)
    // The local-daemon's Harvester/OAuth service will provide this.
    const projectId = options.projectId || process.env.GOOGLE_PROJECT_ID;
    const url = this.buildUrl(projectId, model);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ProviderError('vertex', `Vertex API Error: ${err}`, response.status);
    }

    return await response.json();
  }

  async normalizeResponse(raw) {
    const output = raw.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      output,
      tokens: {
        input: await estimateTokens(''),
        output: await estimateTokens(output)
      },
      raw
    };
  }
}
