import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Cohere V2 Chat Adapter.
 * Endpoint: https://api.cohere.ai/v2/chat
 */
export class CohereAdapter extends BaseAdapter {
  constructor() {
    super('cohere');
    this.endpoint = 'https://api.cohere.ai/v2/chat';
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();

    try {
      let messages = [];
      if (options.messages && options.messages.length > 0) {
        messages = options.messages.filter(m => m.role !== 'system');
      } else {
        let messagesContent;
        if (Array.isArray(prompt)) {
          messagesContent = prompt.map(p => {
            if (typeof p === 'string') return { type: 'text', text: p };
            if (p.type === 'text') return p;
            if (p.type === 'image') {
              return {
                type: 'image_url',
                image_url: { url: `data:${this.sanitizeMimeType(p.media_type)};base64,${p.data}` }
              };
            }
            return null;
          }).filter(Boolean);
        } else {
          messagesContent = [{ type: 'text', text: prompt }];
        }
        messages = [{ role: 'user', content: messagesContent }];
      }

      const body = {
        model,
        messages,
      };

      if (options.tools && options.tools.length > 0) {
        body.tools = options.tools.map(t => {
          if (!t.function) return t;
          return {
            ...t,
            function: {
              ...t.function,
              parameters: t.function.parameters ? this.cleanSchema(t.function.parameters) : t.function.parameters
            }
          };
        });
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
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
    // Cohere V2 streaming — events are SSE with explicit `event:` lines:
    //   event: stream-start        → { type: "stream-start" }
    //   event: text-generation     → { delta: { message: { content: { text } } } }
    //   event: tool-calls-generation → { delta: { message: { tool_calls: { plan, parts? } } } }
    //   event: stream-end          → { type: "stream-end", response: { finish_reason, usage } }
    const controller = this.createTimeout(this.streamTimeout);
    const signal = options.abortSignal
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;
    let fullOutput   = '';
    let inputTokens  = 0;
    let outputTokens = 0;
    let finishReason = 'stop';
    const toolCalls  = [];
    let pendingToolCall = null;

    try {
      const body = this._buildStreamBody(prompt, model, options);
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = '';
            continue;
          }
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (currentEvent === 'text-generation' && parsed.delta?.message?.content?.text) {
              const text = parsed.delta.message.content.text;
              fullOutput += text;
              if (options.onChunk) {
                options.onChunk({ content: text, provider: this.providerName, model });
              }
            }

            if (currentEvent === 'tool-calls-generation' && parsed.delta?.message?.tool_calls) {
              const tcDelta = parsed.delta.message.tool_calls;
              if (tcDelta.parts) {
                // Append to the arguments buffer for the active tool call
                if (pendingToolCall) {
                  for (const part of tcDelta.parts) {
                    if (typeof part.text === 'string') {
                      pendingToolCall._argsBuffer = (pendingToolCall._argsBuffer || '') + part.text;
                    }
                  }
                }
              } else if (tcDelta.plan) {
                // First event for a new tool call — record the name and start
                const planEntry = tcDelta.plan?.[0] || {};
                pendingToolCall = {
                  id: `call_${Math.random().toString(36).slice(2, 10)}`,
                  type: 'function',
                  function: {
                    name: planEntry.function?.name || '',
                    arguments: '',
                  },
                  _argsBuffer: '',
                };
              }
            }

            if (currentEvent === 'tool-calls-end' && pendingToolCall) {
              pendingToolCall.function.arguments = pendingToolCall._argsBuffer || pendingToolCall.function.arguments;
              delete pendingToolCall._argsBuffer;
              if (pendingToolCall.function.name) {
                toolCalls.push({
                  id: pendingToolCall.id,
                  type: pendingToolCall.type,
                  function: pendingToolCall.function,
                });
              }
              pendingToolCall = null;
            }

            if (currentEvent === 'stream-end' && parsed.response) {
              if (parsed.response.finish_reason) {
                finishReason = parsed.response.finish_reason === 'tool_use'
                  ? 'tool_calls'
                  : parsed.response.finish_reason;
              }
              const usageTokens = parsed.response.usage?.tokens;
              if (usageTokens) {
                inputTokens  = usageTokens.input_tokens  || inputTokens;
                outputTokens = usageTokens.output_tokens || outputTokens;
              }
            }
          } catch { /* skip unparseable */ }
        }
      }

      this.clearTimeout(controller);

      return {
        output: fullOutput,
        thinking: null,
        tool_calls: toolCalls,
        finish_reason: finishReason,
        tokens: {
          input:  inputTokens  || await estimateTokens(prompt),
          output: outputTokens || await estimateTokens(fullOutput),
        },
        raw: { streaming: true, provider: this.providerName, model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  _buildStreamBody(prompt, model, options) {
    // Reuse sendRequest's body construction but force stream=true
    const body = this.buildBody ? null : null; // sentinel — unused; we mirror sendRequest shape
    // Build a minimal body that mirrors sendRequest's send body, with stream flag
    let messages = [];
    if (options.messages && options.messages.length > 0) {
      messages = options.messages.filter(m => m.role !== 'system');
    } else if (Array.isArray(prompt)) {
      const text = prompt.filter(p => typeof p === 'string' || p.type === 'text')
        .map(p => typeof p === 'string' ? p : p.text)
        .join(' ');
      messages = [{ role: 'user', content: [{ type: 'text', text }] }];
    } else {
      messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
    }
    const streamBody = {
      model,
      messages,
      stream: true,
    };
    if (options.tools && options.tools.length > 0) {
      streamBody.tools = options.tools.map(t => {
        if (!t.function) return t;
        return {
          ...t,
          function: {
            ...t.function,
            parameters: t.function.parameters ? this.cleanSchema(t.function.parameters) : t.function.parameters,
          },
        };
      });
    }
    return streamBody;
  }

  async normalizeResponse(rawResponse) {
    // Cohere V2 format: { message: { content: [{type, text}] }, usage: { tokens: { input_tokens, output_tokens } } }
    const textBlocks = rawResponse.message?.content?.filter(c => c.type === 'text') || [];
    const output = textBlocks.map(c => c.text).join('') || '';
    const tokens = {
      input:  rawResponse.usage?.tokens?.input_tokens  || 0,
      output: rawResponse.usage?.tokens?.output_tokens || 0,
    };
    return { output, tokens, thinking: null, tool_calls: [], finish_reason: 'stop', raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
