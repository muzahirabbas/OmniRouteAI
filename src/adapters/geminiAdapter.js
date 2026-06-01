import { BaseAdapter } from './baseAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Gemini adapter.
 * Maps prompt → contents[{parts}], extracts candidates[0].
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 */
export class GeminiAdapter extends BaseAdapter {
  constructor(providerName = 'google') {
    super(providerName);
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  /**
   * Build request body for Gemini.
   */
  buildBody(prompt, options = {}) {
    let contents = [];

    if (options.messages && options.messages.length > 0) {
      contents = options.messages.map(m => {
        if (m.role === 'tool') {
           return {
             role: 'user', // Gemini expects functionResponse to come from user
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
              if (p.type === 'document' || p.type === 'pdf') {
                 return {
                   inlineData: {
                     mimeType: 'application/pdf',
                     data: p.data
                   }
                 };
              }
              return null;
           }).filter(Boolean);
        }
        
        if (parts.length === 0) parts = [{ text: '' }];
        return { role, parts };
      });
      
      // Filter out system messages (handled separately)
      contents = contents.filter(c => c.role !== 'system');
    } else {
      let parts = [];
      if (Array.isArray(prompt)) {
        parts = prompt.map(p => {
          if (typeof p === 'string') return { text: p };
          if (p.type === 'text') return { text: p.text };
          if (p.type === 'image' || p.type === 'audio' || p.type === 'video' || p.type === 'document' || p.type === 'pdf') {
            return {
              inlineData: {
                mimeType: (p.type === 'document' || p.type === 'pdf') ? 'application/pdf' : this.sanitizeMimeType(p.media_type),
                data: p.data
              }
            };
          }
          return p;
        });
      } else {
        parts = [{ text: prompt }];
      }
      contents = [{ role: 'user', parts }];
    }

    const generationConfig = {
      maxOutputTokens: options.max_tokens || 8192,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.top_p !== undefined ? { topP: options.top_p } : {}),
      ...(options.thinkingBudget !== undefined && options.thinkingBudget > 0 
        ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } } 
        : {}),
    };

    if (options.response_format) {
      if (options.response_format.type === 'json_object') {
        generationConfig.responseMimeType = 'application/json';
      } else if (options.response_format.type === 'json_schema') {
        generationConfig.responseMimeType = 'application/json';
        if (options.response_format.json_schema && options.response_format.json_schema.schema) {
          generationConfig.responseSchema = options.response_format.json_schema.schema;
        }
      }
    }

    const body = { contents, generationConfig };

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
    const url = `${this.baseUrl}/${model}:generateContent`;
    const controller = this.createTimeout();

    try {
      const reqHeaders = { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey 
      };
      if (options.requestId) {
        reqHeaders['X-Request-ID'] = options.requestId;
        reqHeaders['X-OmniRoute-Request-ID'] = options.requestId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(this.buildBody(prompt, options)),
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

  /**
   * Send a streaming request to Gemini.
   */
  async sendStreamRequest(prompt, model, apiKey, options = {}) {
    const url = `${this.baseUrl}/${model}:streamGenerateContent?alt=sse`;
    const controller = this.createTimeout(this.streamTimeout);
    const signal = options.abortSignal 
      ? AbortSignal.any([controller.signal, options.abortSignal])
      : controller.signal;
    let fullOutput = '';
    let lastRaw = null; // capture last parsed chunk for usageMetadata
    let toolCalls = [];

    try {
      const reqHeaders = { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      };
      if (options.requestId) {
        reqHeaders['X-Request-ID'] = options.requestId;
        reqHeaders['X-OmniRoute-Request-ID'] = options.requestId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(this.buildBody(prompt, options)),
        signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(this.providerName, `HTTP ${response.status}: ${errorBody}`, response.status);
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

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            lastRaw = parsed;
            
            // Check for tool calls in stream
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
              } else if (part.text) {
                const text = part.text;
                // Check if this chunk contains THOUGHT: prefix (Google API bug)
                // Only send content BEFORE THOUGHT: to frontend in real-time
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
            }
          } catch { /* skip unparseable */ }
        }
      }

      this.clearTimeout(controller);

      // Gemini includes usageMetadata in final chunk
      const tokens = await extractTokens(lastRaw, fullOutput, prompt);

      // Known Google API bug: thinking appears with "THOUGHT:" prefix in text field
      // Must filter manually (confirmed by Google GitHub issue #2121)
      let thinking = null;
      if (fullOutput.toLowerCase().includes('thought:')) {
        const idx = fullOutput.toLowerCase().indexOf('thought:');
        thinking = fullOutput.substring(idx);  // Extract thinking content
        fullOutput = fullOutput.substring(0, idx).trim();  // Clean actual response
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

  /**
   * Normalize Gemini response.
   * 
   * Note: Google has a known bug (GitHub #2121) where thinking appears in text
   * field with "THOUGHT:" prefix instead of separate part with part.thought=True.
   * We manually extract it here.
   */
  async normalizeResponse(rawResponse) {
    if (!rawResponse) return { output: '', tokens: { input: 0, output: 0, reasoning: 0 }, thinking: null, tool_calls: [], finish_reason: 'stop', raw: {} };
    
    let output = '';
    const toolCalls = [];
    
    const parts = rawResponse.candidates?.[0]?.content?.parts || [];
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
    if (output.toLowerCase().includes('thought:')) {
      const idx = output.toLowerCase().indexOf('thought:');
      thinking = output.substring(idx);  // Extract thinking content
      output = output.substring(0, idx).trim();  // Clean actual response
    }
    
    const tokens = await extractTokens(rawResponse, output);
    
    // Determine finish reason
    const finishReason = toolCalls.length > 0 ? 'tool_calls' : (rawResponse.candidates?.[0]?.finishReason || 'stop');

    return { output: output.trim(), tokens, thinking, tool_calls: toolCalls, finish_reason: finishReason, raw: rawResponse };
  }

  handleError(err) {
    if (err.name === 'AbortError') {
      return new ProviderError(this.providerName, 'Request timed out', 504, err);
    }
    return new ProviderError(this.providerName, err.message, err.status || 502, err);
  }
}
