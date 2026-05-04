import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Cloudflare Workers AI adapter.
 * Endpoint: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
 * Requires CF_ACCOUNT_ID env var.
 */
export class CloudflareAdapter extends BaseAdapter {
  constructor() {
    super('cloudflare');
    this.accountId = process.env.CF_ACCOUNT_ID;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run`;
  }

  /**
   * Helper to build the request body for Cloudflare.
   * Handles multimodal (image) conversion for models like @cf/llava-1.5-7b-hf.
   */
  buildBody(prompt, stream = false, options = {}) {
    if (options.messages && options.messages.length > 0) {
      return {
        messages: options.messages.filter(m => m.role !== 'system'),
        stream: !!stream,
        ...(options.tools ? { tools: options.tools.map(t => {
          if (t.type === 'function' && t.function && t.function.parameters) {
            return { ...t, function: { ...t.function, parameters: this.cleanSchema(t.function.parameters) } };
          }
          return t;
        }) } : {}),
      };
    }

    if (Array.isArray(prompt)) {
      const imagePart = prompt.find(p => p.type === 'image');
      const textPart  = prompt.find(p => typeof p === 'string' || p.type === 'text');
      const text = typeof textPart === 'string' ? textPart : (textPart?.text || '');

      if (imagePart && imagePart.data) {
        try {
          // Node.js Buffer-based base64 → byte array (atob is browser-only)
          const bytes = Buffer.from(imagePart.data, 'base64');
          return {
            image: Array.from(bytes),
            prompt: text,
            max_tokens: 1024,
            stream: !!stream
          };
        } catch (err) {
          console.error('[CloudflareAdapter] Image conversion failed:', err);
        }
      }
      return {
        messages: [{ role: 'user', content: text }],
        stream: !!stream
      };
    }
    return {
      messages: [{ role: 'user', content: prompt }],
      stream: !!stream
    };
  }

  /**
   * Send a non-streaming request to Cloudflare Workers AI.
   */
  async sendRequest(prompt, model, apiKey, options = {}) {
    const accountId = options.metadata?.accountId || this.accountId;
    if (!accountId) {
      throw new ProviderError(this.providerName, 'CF_ACCOUNT_ID not configured');
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const controller = this.createTimeout();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(this.buildBody(prompt, false, options)),
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(
          this.providerName,
          `HTTP ${response.status}: ${errorBody}`,
          response.status,
        );
      }

      return await response.json();
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Send a streaming request to Cloudflare Workers AI.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const accountId = options.metadata?.accountId || this.accountId;
    if (!accountId) {
      throw new ProviderError(this.providerName, 'CF_ACCOUNT_ID not configured');
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const controller = this.createTimeout();
    const signal = options.abortSignal 
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;
    let fullOutput = '';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(this.buildBody(prompt, true, options)),
        signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(
          this.providerName,
          `HTTP ${response.status}: ${errorBody}`,
          response.status,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.response || parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              fullOutput += content;
              if (options.onChunk) {
                options.onChunk({ content, provider: this.providerName, model });
              }
            }
          } catch {
            // Skip unparseable
          }
        }
      }

      this.clearTimeout(controller);

      return {
        output: fullOutput,
        thinking: null,
        tool_calls: [],
        finish_reason: 'stop',
        tokens: await extractTokens(null, fullOutput, prompt),
        raw:    { streaming: true, provider: this.providerName, model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize Cloudflare Workers AI response.
   */
  async normalizeResponse(rawResponse) {
    const result = rawResponse.result || {};
    // Extract output from simple format (response) or OpenAI format (choices)
    const output = result.response || result.choices?.[0]?.message?.content || '';

    // Pass 'result' to extractTokens to correctly detect 'usage' field
    const tokens = await extractTokens(result, output);

    return { output, tokens, thinking: null, tool_calls: [], finish_reason: 'stop', raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }

  /**
   * Transcribe audio using Cloudflare Workers AI Whisper.
   * Model: @cf/openai/whisper
   */
  async transcribe(fileBuffer, model, options = {}) {
    const accountId = options.metadata?.accountId || this.accountId;
    if (!accountId) {
      throw new ProviderError(this.providerName, 'CF_ACCOUNT_ID not configured');
    }

    const requestId = options.requestId || 'unknown';
    const controller = this.createTimeout(45000); // 45s - aligned with other audio adapters

    console.log(JSON.stringify({
      level: 'info',
      msg: 'Sending to Cloudflare Workers AI',
      requestId,
      model: model || '@cf/openai/whisper',
      fileSize: fileBuffer.length,
      accountIdPreview: accountId ? accountId.substring(0, 8) + '...' : 'MISSING',
      hasApiKey: !!options.apiKey,
    }));

    try {
      // Map generic Whisper model names to Cloudflare's specific model
      const cfModel = (model && (model.includes('whisper') || model === 'auto'))
        ? '@cf/openai/whisper'
        : (model || '@cf/openai/whisper');

      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cfModel}`;

      // CRITICAL FIX: Cloudflare expects BASE64-encoded audio, not an array of bytes
      const audioBase64 = fileBuffer.toString('base64');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ audio: audioBase64 }),
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        
        // Enhance 401 logging with specific permission hints
        if (response.status === 401) {
          console.log(JSON.stringify({
            level: 'error',
            msg: 'Cloudflare Authentication Failed (401)',
            requestId,
            hint: 'Verify API Token has "Workers AI: Read/Edit" permissions and Account ID is correct.',
            accountId: accountId.substring(0, 8) + '...',
          }));
        }

        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const data = await response.json();

      console.log(JSON.stringify({
        level: 'info',
        msg: 'Cloudflare Workers AI response received',
        requestId,
        textLength: data.result?.text?.length || 0,
        language: data.result?.language,
      }));

      return {
        text: data.result?.text || '',
        duration: null,
        words: null,
        language: data.result?.language || null,
      };
    } catch (err) {
      this.clearTimeout(controller);
      console.log(JSON.stringify({
        level: 'error',
        msg: 'Cloudflare transcription failed',
        requestId,
        error: err.message,
      }));
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }
}
