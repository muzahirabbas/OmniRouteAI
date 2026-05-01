import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { estimateTokens, extractTokens } from '../services/statsService.js';

/**
 * Anthropic (Claude) adapter.
 *
 * Format:
 *   POST https://api.anthropic.com/v1/messages
 *   Headers: x-api-key, anthropic-version
 *   Body:    { model, messages, system?, max_tokens, stream? }
 *   Non-stream response: { content: [{type, text}], usage: {input_tokens, output_tokens} }
 *   Stream events:
 *     message_start → usage.input_tokens
 *     content_block_delta → delta.text  (streaming text)
 *     message_delta → usage.output_tokens
 *
 * All methods return normalized: { output: string, tokens: { input, output }, raw: object }
 */
export class AnthropicAdapter extends BaseAdapter {
  constructor(providerName = 'anthropic', endpoint) {
    // Backwards compatibility for cases where only endpoint was passed
    if (providerName && providerName.startsWith('http') && !endpoint) {
      endpoint = providerName;
      providerName = 'anthropic';
    }
    super(providerName);
    this.endpoint   = endpoint || 'https://api.anthropic.com/v1/messages';
    this.apiVersion = '2023-06-01';
  }

  buildHeaders(apiKey, options = {}) {
    const headers = {
      'Content-Type':    'application/json',
      'x-api-key':       apiKey,
      'anthropic-version': this.apiVersion,
    };
    
    // Propagate request ID for tracing
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }
    
    return headers;
  }

  buildBody(prompt, model, stream = false, options = {}) {
    let messages = [];

    if (options.messages && options.messages.length > 0) {
      messages = [...options.messages];
      // Anthropic does not support standard OpenAI system messages inside the messages array.
      messages = messages.filter(m => m.role !== 'system');
    } else {
      let content = prompt;

      // Handle multimodal array
      if (Array.isArray(prompt)) {
        content = prompt
          .filter(p => typeof p === 'string' || p.type === 'text' || p.type === 'image')
          .map(p => {
            if (typeof p === 'string') return { type: 'text', text: p };
            if (p.type === 'text') return p;
            if (p.type === 'image') {
              return {
                type: 'image',
                source: { 
                  type: 'base64', 
                  media_type: this.sanitizeMimeType(p.media_type), 
                  data: p.data 
                }
              };
            }
            return p;
          });
      }
      messages = [{ role: 'user', content }];
    }

    const body = {
      model,
      messages,
      max_tokens: options.max_tokens || 8192,
      stream,
      ...(options.thinkingBudget ? { thinking: { type: 'enabled', budget_tokens: options.thinkingBudget } } : {}),
      // Anthropic supports temperature and top_p
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.top_p !== undefined ? { top_p: options.top_p } : {}),
    };

    // Add tools for function calling (Anthropic mapping)
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => {
        if (!t.function) return null;
        return {
          name: t.function.name,
          description: t.function.description || '',
          input_schema: t.function.parameters ? this.cleanSchema(t.function.parameters) : { type: 'object', properties: {} }
        };
      }).filter(Boolean);

      if (options.tool_choice) {
        if (typeof options.tool_choice === 'string') {
          if (options.tool_choice === 'required') body.tool_choice = { type: 'any' };
          else if (options.tool_choice === 'none') delete body.tools;
          else body.tool_choice = { type: 'auto' };
        } else if (options.tool_choice.type === 'function') {
          body.tool_choice = { type: 'tool', name: options.tool_choice.function.name };
        } else {
          body.tool_choice = options.tool_choice;
        }
      }
    }

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }
    return body;
  }

  async sendRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();

    try {
      const response = await fetch(this.endpoint, {
        method:  'POST',
        headers: this.buildHeaders(apiKey, options),
        body:    JSON.stringify(this.buildBody(prompt, model, false, options)),
        signal:  controller.signal,
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

  /**
   * Streaming request — reads Anthropic SSE events.
   *
   * Anthropic stream event types:
   *   message_start       → { message: { usage: { input_tokens } } }
   *   content_block_delta → { delta: { type: "text_delta", text: "..." } }
   *   message_delta       → { usage: { output_tokens } }
   *   message_stop        → end of stream
   *
   * Captures real token counts from events when available.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout();
    const signal = options.abortSignal 
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;
    let fullOutput   = '';
    let fullThinking = ''; // Accumulate thinking content during stream
    let inputTokens  = 0;
    let outputTokens = 0;
    let streamedToolCalls = []; // Accumulate tool calls during stream
    let currentToolCall = null; // Track the tool call being built
    let streamFinishReason = 'stop';

    try {
      const response = await fetch(this.endpoint, {
        method:  'POST',
        headers: this.buildHeaders(apiKey, options),
        body:    JSON.stringify(this.buildBody(prompt, model, true, options)),
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
          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data);

            // ── message_start: input tokens ─────────────────────────
            if (parsed.type === 'message_start' && parsed.message?.usage?.input_tokens) {
              inputTokens = parsed.message.usage.input_tokens;
            }

            // ── content_block_start: new content block ──────────────
            if (parsed.type === 'content_block_start') {
              if (parsed.content_block?.type === 'tool_use') {
                // Start of a new tool call block
                currentToolCall = {
                  id: parsed.content_block.id,
                  type: 'function',
                  function: {
                    name: parsed.content_block.name,
                    arguments: '',
                  },
                };
              }
            }

            // ── content_block_delta: thinking chunks ───────────────
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta') {
              const thinking = parsed.delta.thinking;
              if (thinking) {
                fullThinking += thinking;
                // Emit thinking chunk to callback if provided
                if (options.onChunk) {
                  options.onChunk({ thinking: thinking, provider: this.providerName, model });
                }
              }
            }

            // ── content_block_delta: actual text chunks ─────────────
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              const text = parsed.delta.text;
              if (text) {
                fullOutput += text;
                if (options.onChunk) {
                  options.onChunk({ content: text, provider: this.providerName, model });
                }
              }
            }

            // ── content_block_delta: tool input JSON chunks ──────────
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
              if (currentToolCall && parsed.delta.partial_json) {
                currentToolCall.function.arguments += parsed.delta.partial_json;
              }
            }

            // ── content_block_stop: finalize current tool call ───────
            if (parsed.type === 'content_block_stop') {
              if (currentToolCall) {
                streamedToolCalls.push(currentToolCall);
                currentToolCall = null;
              }
            }

            // ── message_delta: output tokens + stop reason ──────────
            if (parsed.type === 'message_delta') {
              if (parsed.usage?.output_tokens) {
                outputTokens = parsed.usage.output_tokens;
              }
              if (parsed.delta?.stop_reason) {
                streamFinishReason = parsed.delta.stop_reason === 'tool_use' 
                  ? 'tool_calls' 
                  : parsed.delta.stop_reason;
              }
            }
          } catch { /* skip unparseable */ }
        }
      }

      this.clearTimeout(controller);

      // Determine finish reason
      const finishReason = streamedToolCalls.length > 0 
        ? 'tool_calls' 
        : streamFinishReason;

      // Fall back to estimation if provider didn't return token counts
      return {
        output: fullOutput,
        thinking: fullThinking || null,
        tool_calls: streamedToolCalls,
        finish_reason: finishReason,
        tokens: {
          input:  inputTokens  || await estimateTokens(prompt),
          output: outputTokens || await estimateTokens(fullOutput),
        },
        raw: { streaming: true, provider: 'anthropic', model },
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  /**
   * Normalize Anthropic non-streaming response.
   * Format: { content: [{type, text, thinking}], usage: {input_tokens, output_tokens, thinking_tokens} }
   */
  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0, reasoning: 0 }, thinking: null, tool_calls: [], finish_reason: 'stop', raw: {} };
    
    // Extract thinking content if present (for Claude 3.7+ with thinking mode)
    let thinkingContent = '';
    const output = rawResponse.content
      ?.filter((c) => c.type === 'text')
      .map((c) => {
        if (c.thinking) thinkingContent = c.thinking;
        return c.text;
      })
      .join('') || '';

    // Extract tool calls if present
    const toolCalls = rawResponse.content
      ?.filter((c) => c.type === 'tool_use')
      .map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.input || {}),
        },
      })) || [];

    // Determine finish reason
    const finishReason = rawResponse.stop_reason || 'stop';

    // Use extractTokens to get reasoning tokens properly
    const tokens = await extractTokens(rawResponse, output);

    return { 
      output, 
      tokens, 
      thinking: thinkingContent || null,
      tool_calls: toolCalls,
      finish_reason: finishReason,
      raw: rawResponse 
    };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
