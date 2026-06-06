import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { estimateTokens } from '../services/statsService.js';

/**
 * Google Vertex AI Adapter.
 *
 * Authentication modes (auto-detected):
 *
 * 1. SERVICE ACCOUNT JSON (recommended for production):
 *    - Store the full service account JSON as the API key value.
 *    - The adapter parses it, signs a JWT, and exchanges it for a short-lived OAuth2 access token.
 *    - Metadata needs: projectId, region (or uses SA JSON's project_id field)
 *
 * 2. PRE-ISSUED OAUTH2 TOKEN:
 *    - Store a `ya29.*` access token directly as the API key.
 *    - Short-lived (1h). Use for dev/testing only.
 *    - Metadata needs: projectId, region
 *
 * 3. STANDARD GOOGLE API KEY (fallback):
 *    - Vertex AI's aiplatform.googleapis.com does NOT accept plain API keys.
 *    - When a plain key is detected, the adapter falls back to the standard
 *      Gemini `generativelanguage.googleapis.com` endpoint that DOES accept API keys.
 *    - This allows basic Gemini 1.5 usage through the vertex provider slot.
 *
 * All methods return normalized: { output: string, tokens: { input, output }, raw: object }
 */
export class VertexAdapter extends BaseAdapter {
  constructor(region = 'us-central1') {
    super('vertex');
    this.region = region;
  }

  /**
   * Detect auth type from the stored key value.
   */
  _detectAuthType(apiKey) {
    if (!apiKey) return 'none';
    if (apiKey.startsWith('{')) return 'service_account'; // JSON service account
    if (apiKey.startsWith('ya29.')) return 'oauth2_token';  // Pre-issued token
    return 'api_key'; // Plain Google API key (fallback)
  }

  /**
   * Exchange a service account JSON for a short-lived OAuth2 access token.
   * Uses the Google OAuth2 JWT grant flow.
   */
  async _getAccessToken(serviceAccountJson) {
    let sa;
    try {
      sa = JSON.parse(serviceAccountJson);
    } catch {
      throw new ProviderError(this.providerName, 'Invalid service account JSON format', 401);
    }

    if (!sa.private_key || !sa.client_email) {
      throw new ProviderError(this.providerName, 'Service account JSON missing private_key or client_email', 401);
    }

    const scope = 'https://www.googleapis.com/auth/cloud-platform';
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;

    // Build JWT header + payload
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      exp,
      iat,
    })).toString('base64url');

    const signingInput = `${header}.${payload}`;

    let createSign;
    try {
      const crypto = await import('node:crypto').catch(() => null);
      if (!crypto || !crypto.createSign) {
        throw new ProviderError(this.providerName, 'Crypto module not available for JWT signing', 500);
      }
      createSign = crypto.createSign;
    } catch (importErr) {
      throw new ProviderError(this.providerName, `Failed to import crypto module: ${importErr.message}`, 500);
    }

    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(sa.private_key, 'base64url');

    const jwt = `${signingInput}.${signature}`;

    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      throw new ProviderError(this.providerName, `OAuth2 token exchange failed: ${errText}`, 401);
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token;
  }

  /**
   * Get a usable bearer token from the stored key value.
   * Returns { token, mode } where mode is 'vertex' (aiplatform) or 'gemini' (generativelanguage).
   */
  async _resolveAuth(apiKey) {
    const authType = this._detectAuthType(apiKey);

    if (authType === 'service_account') {
      const token = await this._getAccessToken(apiKey);
      return { token, mode: 'vertex' };
    }
    if (authType === 'oauth2_token') {
      return { token: apiKey, mode: 'vertex' };
    }
    // Plain API key → use Gemini generativelanguage endpoint
    return { token: apiKey, mode: 'gemini' };
  }

  /**
   * Build the request URL based on auth mode.
   */
  _buildUrl(mode, projectId, model, region, stream = false) {
    if (mode === 'gemini') {
      // Standard Gemini API — accepts API keys via ?key= param
      const method = stream ? 'streamGenerateContent' : 'generateContent';
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
    }
    // Vertex AI aiplatform — requires OAuth2
    const r = region || this.region;
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    return `https://${r}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${r}/publishers/google/models/${model}:${method}`;
  }

  buildHeaders(token, mode, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
    };
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }
    return headers;
  }

  buildBody(prompt, options = {}) {
    let contents = [];

    if (options.messages && options.messages.length > 0) {
      contents = options.messages.map(m => {
        if (m.role === 'tool') {
           return {
             role: 'user',
             parts: [{
               functionResponse: {
                 name: m.name || 'tool_call',
                 response: { content: m.content }
               }
             }]
           };
        }
        
        let role = m.role === 'assistant' ? 'model' : 'user';
        let parts = [];
        
        if (m.tool_calls && m.tool_calls.length > 0) {
           parts = m.tool_calls.map(tc => {
             let args = {};
             try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
             return {
               functionCall: {
                 name: tc.function.name,
                 args
               }
             };
           });
        } else if (typeof m.content === 'string') {
           parts = [{ text: m.content }];
        } else if (Array.isArray(m.content)) {
           parts = m.content.map(p => {
              if (p.type === 'text') return { text: p.text };
              if (p.type === 'image_url') {
                 const url = p.image_url.url || '';
                 if (url.startsWith('data:')) {
                   return {
                     inlineData: {
                       mimeType: this.sanitizeMimeType(url.split(';')[0].split(':')[1]),
                       data: url.split(',')[1]
                     }
                   };
                 }
              }
              return null;
           }).filter(Boolean);
        }
        
        if (parts.length === 0) parts = [{ text: '' }];
        return { role, parts };
      });
      contents = contents.filter(c => c.role !== 'system');
    } else {
      let parts = [];
      if (typeof prompt === 'string') {
        parts = [{ text: prompt }];
      } else if (Array.isArray(prompt)) {
        parts = prompt.map(p => {
          if (typeof p === 'string') return { text: p };
          if (p.type === 'text') return { text: p.text };
          if (p.type === 'image' || p.type === 'audio' || p.type === 'video') {
            return {
              inlineData: {
                mimeType: this.sanitizeMimeType(p.media_type),
                data: p.data
              }
            };
          }
          return p;
        }).filter(Boolean);
      }
      contents = [{ role: 'user', parts }];
    }

    const body = { contents };

    if (options.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }
    
    if (options.tools && options.tools.length > 0) {
      body.tools = [{
        functionDeclarations: options.tools.map(t => {
          if (!t.function) return null;
          return {
            name: t.function.name,
            description: t.function.description || '',
            ...(t.function.parameters ? { parameters: this.cleanSchema(t.function.parameters) } : {})
          };
        }).filter(Boolean)
      }];
      if (options.tool_choice) {
         if (options.tool_choice === 'auto') {
           body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
         } else if (options.tool_choice === 'required') {
           body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
         } else if (options.tool_choice === 'none') {
           body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
         } else if (options.tool_choice.type === 'function') {
           body.toolConfig = { 
             functionCallingConfig: { 
               mode: 'ANY', 
               allowedFunctionNames: [options.tool_choice.function.name] 
             } 
           };
         }
      }
    }

    return body;
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const { token, mode } = await this._resolveAuth(apiKey);
    const projectId = options.metadata?.projectId || options.projectId || process.env.GOOGLE_PROJECT_ID;
    const region    = options.metadata?.region    || this.region;

    let url = this._buildUrl(mode, projectId, model, region, false);
    // Gemini mode uses ?key= query param (not Bearer header)
    if (mode === 'gemini') url += `?key=${token}`;

    const controller = this.createTimeout();
    const signal = options.abortSignal
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;

    try {
      const headers = mode === 'gemini'
        ? { 'Content-Type': 'application/json', ...(options.requestId ? { 'X-Request-ID': options.requestId } : {}) }
        : this.buildHeaders(token, mode, options);

      const response = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify(this.buildBody(prompt, options)),
        signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      return await response.json();
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const { token, mode } = await this._resolveAuth(apiKey);
    const projectId = options.metadata?.projectId || options.projectId || process.env.GOOGLE_PROJECT_ID;
    const region    = options.metadata?.region    || this.region;

    let url = this._buildUrl(mode, projectId, model, region, true);
    if (mode === 'gemini') {
      url += `?alt=sse&key=${token}`;
    } else {
      url += '?alt=sse';
    }

     const controller = this.createTimeout();
     const signal = options.abortSignal 
       ? AbortSignal.any([controller.signal, options.abortSignal])
       : controller.signal;
     let fullOutput   = '';
     let lastRaw      = null;
     let toolCalls    = [];

    try {
      const headers = mode === 'gemini'
        ? { 'Content-Type': 'application/json', ...(options.requestId ? { 'X-Request-ID': options.requestId } : {}) }
        : this.buildHeaders(token, mode, options);

      const response = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify(this.buildBody(prompt, options)),
        signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

         for (const line of lines) {
           const trimmed = line.trim();
           if (!trimmed || !trimmed.startsWith('data: ')) continue;

           try {
             const parsed = JSON.parse(trimmed.slice(6));
             lastRaw = parsed;

             // Handle tool calls
             const parts = parsed.candidates?.[0]?.content?.parts || [];
             for (const part of parts) {
               if (part.functionCall) {
                 const tc = {
                   id: `call_${Math.random().toString(36).substring(2, 10)}`,
                   type: 'function',
                   function: {
                     name: part.functionCall.name,
                     arguments: JSON.stringify(part.functionCall.args || {})
                   }
                 };
                 toolCalls.push(tc);
                 if (options.onChunk) {
                   options.onChunk({ tool_calls: [tc], provider: this.providerName, model });
                 }
               }
             }

              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                // Check for THOUGHT: prefix (Google API bug) - filter before sending to frontend
                if (text.toLowerCase().includes('thought:')) {
                  const idx = text.toLowerCase().indexOf('thought:');
                  const cleanContent = text.substring(0, idx);
                  if (cleanContent && options.onChunk) {
                    options.onChunk({ content: cleanContent, provider: this.providerName, model });
                  }
                } else if (options.onChunk) {
                  options.onChunk({ content: text, provider: this.providerName, model });
                }
                fullOutput += text;
              }
           } catch { /* skip unparseable */ }
         }
      }

      this.clearTimeout(controller);

      const tokens = lastRaw?.usageMetadata
        ? {
            input:  lastRaw.usageMetadata.promptTokenCount     || 0,
            output: lastRaw.usageMetadata.candidatesTokenCount || 0,
          }
        : {
            input:  await estimateTokens(prompt),
            output: await estimateTokens(fullOutput),
          };

       // Known Google API bug: thinking appears with "THOUGHT:" prefix in text field
      // Extract thinking from fullOutput (final pass, ensures consistency)
      let thinking = null;
      if (fullOutput.toLowerCase().includes('thought:')) {
        const idx = fullOutput.toLowerCase().indexOf('thought:');
        thinking = fullOutput.substring(idx);
        fullOutput = fullOutput.substring(0, idx).trim();
      }
      
      const finishReason = toolCalls.length > 0 ? 'tool_calls' : (lastRaw?.candidates?.[0]?.finishReason || 'stop');
      
      return {
        output: fullOutput.trim(),
        thinking,
        tool_calls: toolCalls,
        finish_reason: finishReason,
        tokens,
        raw: { streaming: true, provider: this.providerName, model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  async normalizeResponse(raw) {
    if (!raw) return { output: '', tokens: { input: 0, output: 0 }, thinking: null, tool_calls: [], finish_reason: 'stop', raw: {} };
    
    let output = '';
    const toolCalls = [];
    
    const parts = raw.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.text) {
        output += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 10)}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
          }
        });
      }
    }
    
    // Known Google API bug: thinking appears with "THOUGHT:" prefix in text field
    // Must filter manually (confirmed by Google GitHub issue #2121)
    let thinking = null;
    if (output.includes('THOUGHT:')) {
      const idx = output.indexOf('THOUGHT:');
      thinking = output.substring(idx);
      output = output.substring(0, idx).trim();
    }
    
    const tokens = raw.usageMetadata
      ? {
          input:  raw.usageMetadata.promptTokenCount     || 0,
          output: raw.usageMetadata.candidatesTokenCount || 0,
        }
      : {
          input:  0,
          output: await estimateTokens(output),
        };
    const finishReason = toolCalls.length > 0 ? 'tool_calls' : (raw.candidates?.[0]?.finishReason || 'stop');
    return { output: output.trim(), tokens, thinking, tool_calls: toolCalls, finish_reason: finishReason, raw };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
