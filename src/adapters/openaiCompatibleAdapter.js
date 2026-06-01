import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens, estimateTokens } from '../services/statsService.js';

/**
 * OpenAI-compatible adapter base.
 *
 * Used by: OpenAI, xAI, Ollama, Alibaba, OpenRouter, Groq, DeepSeek,
 *          Moonshot, Together AI, NVIDIA, Inception, Xiaomi, SambaNova, Cerebras
 *
 * Normalized return format (ALL methods):
 *   { output: string, tokens: { input: number, output: number }, raw: object }
 */
export class OpenAICompatibleAdapter extends BaseAdapter {
  constructor(providerName, endpoint) {
    super(providerName);
    this.endpoint = endpoint;
  }

  buildHeaders(apiKey, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${apiKey}`,
    };
    
    // Propagate request ID for tracing across provider logs
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
      headers['X-OmniRoute-Request-ID'] = options.requestId;
    }
    
    return headers;
  }

  buildBody(prompt, model, stream = false, options = {}) {
    let messages = [];

    // Prioritize full messages array if provided
    if (options.messages && options.messages.length > 0) {
      messages = [...options.messages];
    } else {
      let content = prompt;

      // Handle multimodal array
      if (Array.isArray(prompt)) {
        const isNativeOpenAI = this.providerName === 'openai';
        const hasAudio = prompt.some(p => p.type === 'audio');
        
        content = prompt.map(p => {
          if (typeof p === 'string') return { type: 'text', text: p };
          if (p.type === 'text') return p;
          if (p.type === 'image') {
            return {
              type: 'image_url',
              image_url: { url: `data:${this.sanitizeMimeType(p.media_type)};base64,${p.data}` }
            };
          }
          if (p.type === 'audio' && isNativeOpenAI) {
            const cleanMime = this.sanitizeMimeType(p.media_type); // e.g. 'audio/webm'
            let format = cleanMime.split('/')[1] || 'wav'; // simple format inference
            
            // OpenAI input_audio supports: wav, mp3, flac, opus, pcm16
            // Browsers record as audio/webm;codecs=opus, so map webm to opus.
            if (format === 'webm') format = 'opus';
            
            return {
              type: 'input_audio',
              input_audio: { data: p.data, format }
            };
          }
          // Filter out unsupported multimodal parts (audio/video for non-OpenAI)
          return null;
        }).filter(Boolean);

        // If everything was filtered out, fallback to text
        if (content.length === 0) {
          const textPart = prompt.find(p => typeof p === 'string' || p.type === 'text');
          content = textPart ? (typeof textPart === 'string' ? textPart : textPart.text) : prompt.toString();
        }

        if (hasAudio && isNativeOpenAI) {
          // If audio is present in GPT-4o-audio-preview, we must specify modalities
          options.modalities = ['text', 'audio'];
          // Default to alloy voice for responses if audio output is enabled (though our bridge focus is input)
          options.audio = { voice: 'alloy', format: 'wav' };
        }
      }
      
      messages = [{ role: 'user', content }];
    }

    const isStrictProvider = ['nvidia', 'fireworks', 'nebius', 'siliconflow', 'hyperbolic', 'chutes', 'nanobanana', 'opencode_zen', 'cerebras', 'sambanova', 'huggingface', 'mistral', 'cohere', 'perplexity', 'deepgram', 'assemblyai'].includes(this.providerName);
    const supportsAdvancedOpenAI = !isStrictProvider;

    const body = {
      model,
      messages,
      stream,
    };

    if (supportsAdvancedOpenAI) {
      if (options.modalities) body.modalities = options.modalities;
      if (options.audio) body.audio = options.audio;
      if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort;
    }

    // Add temperature if provided
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    // Add top_p if provided
    if (options.top_p !== undefined) {
      body.top_p = options.top_p;
    }

    // Add max_tokens if provided
    if (options.max_tokens !== undefined) {
      body.max_tokens = options.max_tokens;
    }

    // Add response_format (json_object, json_schema)
    if (options.response_format) {
      const format = { ...options.response_format };
      // Force strict mode for JSON schemas
      if (format.type === 'json_schema' && format.json_schema) {
        format.json_schema.strict = true;
      }
      body.response_format = format;
    }

    // Add tools for function calling
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => {
        if (t.type === 'function' && t.function && t.function.parameters) {
          return {
            ...t,
            function: {
              ...t.function,
              strict: true,
              parameters: this.cleanSchema(t.function.parameters)
            }
          };
        }
        return t;
      });

      // Add tool_choice if provided
      if (options.tool_choice) {
        body.tool_choice = options.tool_choice;
      }
    }

    // Add stop sequences
    if (options.stop) {
      body.stop = options.stop;
    }

    // Add presence_penalty
    if (options.presence_penalty !== undefined) {
      body.presence_penalty = options.presence_penalty;
    }

    // Add frequency_penalty
    if (options.frequency_penalty !== undefined) {
      body.frequency_penalty = options.frequency_penalty;
    }

    // Add logit_bias
    if (options.logit_bias) {
      body.logit_bias = options.logit_bias;
    }

    // Add user identifier
    if (options.user) {
      body.user = options.user;
    }

    // Add seed for reproducibility
    if (options.seed !== undefined) {
      body.seed = options.seed;
    }

    if (supportsAdvancedOpenAI) {
      // Add max_completion_tokens (for o1/o3 models)
      if (options.max_completion_tokens !== undefined) {
        body.max_completion_tokens = options.max_completion_tokens;
      }

      // Add prediction
      if (options.prediction) {
        body.prediction = options.prediction;
      }
    }
    
    // Add metadata
    if (options.metadata) {
      body.metadata = options.metadata;
    }

    if (options.systemPrompt) {
      body.messages.unshift({ role: 'system', content: options.systemPrompt });
    }
    return body;
  }

  /**
   * Non-streaming request.
   *
   * @returns {Promise<object>} raw provider response
   */
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
   * Streaming request (SSE).
   *
   * Returns normalized: { output: string, tokens: { input, output }, raw: object }
   * No buffering — chunks are forwarded to options.onChunk immediately.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const controller = this.createTimeout(this.streamTimeout);
    const signal = options.abortSignal 
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;
    let fullOutput   = '';
    let fullReasoning = ''; // Capture reasoning content during stream

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

      // Capture the last usage chunk (some providers send it in the final event)
      let usageFromStream = null;
      let toolCallMap = {}; // Accumulate tool calls by index for proper assembly

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

            // Capture usage if provided in stream (e.g. OpenAI stream_options)
            if (parsed.usage) usageFromStream = parsed.usage;

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullOutput += content;
              if (options.onChunk) {
                options.onChunk({ content, provider: this.providerName, model });
              }
            }
            
            // Capture reasoning content from streaming response
            const reasoning = parsed.choices?.[0]?.delta?.reasoning;
            if (reasoning) {
              fullReasoning += reasoning;
              if (options.onChunk) {
                options.onChunk({ reasoning, provider: this.providerName, model });
              }
            }

            // Capture tool calls from streaming response — merge by index
            // OpenAI streams tool calls as incremental deltas:
            //   {index: 0, id: "call_abc", type: "function", function: {name: "foo", arguments: ""}}
            //   {index: 0, function: {arguments: '{"ba'}}
            //   {index: 0, function: {arguments: 'r": 1}'}}
            //   {index: 1, id: "call_def", type: "function", function: {name: "baz", arguments: ""}}
            const deltaToolCalls = parsed.choices?.[0]?.delta?.tool_calls;
            if (deltaToolCalls && deltaToolCalls.length > 0) {
              for (const delta of deltaToolCalls) {
                const idx = delta.index ?? 0;
                if (!toolCallMap[idx]) {
                  // First delta for this index — initialize the tool call
                  toolCallMap[idx] = {
                    id: delta.id || `call_${Math.random().toString(36).substring(2, 10)}`,
                    type: delta.type || 'function',
                    function: {
                      name: delta.function?.name || '',
                      arguments: delta.function?.arguments || '',
                    },
                  };
                } else {
                  // Subsequent delta — append arguments
                  if (delta.function?.name) {
                    toolCallMap[idx].function.name += delta.function.name;
                  }
                  if (delta.function?.arguments) {
                    toolCallMap[idx].function.arguments += delta.function.arguments;
                  }
                }
              }
              // Forward raw deltas to chunk callback for real-time streaming
              if (options.onChunk) {
                options.onChunk({ tool_calls: deltaToolCalls, provider: this.providerName, model });
              }
            }

            // Capture finish_reason from stream
            const streamFinishReason = parsed.choices?.[0]?.finish_reason;
            if (streamFinishReason) {
              usageFromStream = usageFromStream || {};
              usageFromStream._finish_reason = streamFinishReason;
            }
          } catch { /* skip unparseable */ }
        }
      }

      this.clearTimeout(controller);

      // Assemble final tool calls from the map
      const assembledToolCalls = Object.values(toolCallMap);

      // Validate each tool call
      for (const tc of assembledToolCalls) {
        if (!tc.function?.name) {
          console.warn('Invalid tool call: missing function name', tc);
          continue;
        }
        
        // Try to parse arguments as JSON to validate
        if (tc.function.arguments) {
          try {
            JSON.parse(tc.function.arguments);
          } catch (e) {
            console.warn('Tool call has invalid JSON arguments', { 
              id: tc.id, 
              name: tc.function.name,
              args: tc.function.arguments.substring(0, 100) 
            });
          }
        }
      }

      // Determine finish reason — prefer stream-provided, then infer from tool calls
      const finishReason = usageFromStream?._finish_reason 
        || (assembledToolCalls.length > 0 ? 'tool_calls' : 'stop');

      // Build normalized token counts — prefer stream-provided usage
      const tokens = usageFromStream
        ? await extractTokens({ usage: usageFromStream }, fullOutput, prompt)
        : {
            input:  await estimateTokens(prompt),
            output: await estimateTokens(fullOutput),
          };

      return {
        output: fullOutput,
        thinking: fullReasoning || null, // Include reasoning content
        tool_calls: assembledToolCalls,
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

  /**
   * Normalize a non-streaming OpenAI-compatible response.
   * Returns: { output: string, tokens: { input, output }, thinking: string|null, tool_calls: array, finish_reason: string, raw: object }
   */
  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0, reasoning: 0 }, thinking: null, tool_calls: [], finish_reason: 'stop', raw: {} };
    const output = rawResponse.choices?.[0]?.message?.content || '';
    // Extract reasoning content from OpenRouter/OpenAI-compatible responses
    const reasoning = rawResponse.choices?.[0]?.message?.reasoning || null;
    // Extract tool calls
    const toolCalls = rawResponse.choices?.[0]?.message?.tool_calls || [];
    // Extract finish reason
    const finishReason = rawResponse.choices?.[0]?.finish_reason || 'stop';
    const tokens = await extractTokens(rawResponse, output);
    return { output, tokens, thinking: reasoning, tool_calls: toolCalls, finish_reason: finishReason, raw: rawResponse };
  }

  /**
   * Transcribe audio using OpenAI-compatible Whisper API.
   * Derives /v1/audio/transcriptions from the base endpoint.
   */
  async transcribe(fileBuffer, model, options = {}) {
    // Derive audio endpoint from chat endpoint
    // https://api.groq.com/openai/v1/chat/completions -> https://api.groq.com/openai/v1/audio/transcriptions
    const audioEndpoint = this.endpoint.replace('/chat/completions', '/audio/transcriptions');
    const controller = this.createTimeout(options.timeout || 45000);
    const requestId = options.requestId || 'unknown';



    try {
      const formData = new FormData();
      // Node.js 18+ fetch supports Blobs in FormData
      const blob = new Blob([fileBuffer], { type: options.mimeType || 'audio/mpeg' });
      formData.append('file', blob, options.filename || 'audio.mp3');
      formData.append('model', model || 'whisper-1');
      
      if (options.language) formData.append('language', options.language);
      if (options.response_format) formData.append('response_format', options.response_format);
      
      // Add timestamp_granularities for word-level or segment-level timestamps
      if (options.timestamp_granularities) {
        if (Array.isArray(options.timestamp_granularities)) {
          options.timestamp_granularities.forEach(tg => formData.append('timestamp_granularities[]', tg));
        } else {
          formData.append('timestamp_granularities[]', options.timestamp_granularities);
        }
      }
      
      if (options.prompt) formData.append('prompt', options.prompt);
      if (options.temperature !== undefined) formData.append('temperature', String(options.temperature));

      const response = await fetch(audioEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          // Note: Do NOT set Content-Type header when using FormData; fetch will set it with boundary
        },
        body: formData,
        signal: controller.signal,
      });

      this.clearTimeout(controller);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
      }

      const data = await response.json();
      
      return {
        text: data.text || '',
        duration: data.duration || null,
        words: data.words || null,
        language: data.language || null,
        raw: data,
      };
    } catch (err) {
      this.clearTimeout(controller);
      if (err instanceof ProviderError) throw err;
      throw this.handleError(err);
    }
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
