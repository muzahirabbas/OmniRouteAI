import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';
import { ProviderError } from '../utils/errors.js';
import { extractTokens } from '../services/statsService.js';

/**
 * Cline API adapter
 * https://docs.cline.bot/api
 *
 * OpenAI-compatible Chat Completions gateway. The Cline API wraps
 * non-streaming responses in an envelope:
 *   { "data": { ...OpenAI shape... }, "success": true }
 *
 * Streaming responses (SSE) are raw OpenAI-style `data:` lines and
 * need no unwrapping. We inherit `sendStreamRequest` unchanged and
 * override `normalizeResponse` to unwrap `.data` for non-streaming.
 *
 * The `sendRequest` and `sendStreamRequest` implementations are
 * inherited from `OpenAICompatibleAdapter`.
 */
export class ClineApiAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('cline_api', 'https://api.cline.bot/api/v1/chat/completions');
  }

  /**
   * Build request headers.
   * Adds Cline's optional tracking headers (HTTP-Referer, X-Title)
   * on top of the inherited Bearer + Content-Type + X-Request-ID.
   */
  buildHeaders(apiKey, options = {}) {
    const headers = super.buildHeaders(apiKey, options);
    headers['HTTP-Referer'] = 'https://omnirouterai.app';
    headers['X-Title'] = 'OmniRouteAI2';
    return headers;
  }

  /**
   * Normalize a Cline API non-streaming response.
   * Unwraps the { data, success } envelope before extracting fields.
   * Falls back to treating the raw payload as OpenAI-shape if no
   * envelope is present (forward-compat / future-proofing).
   *
   * @param {object} rawResponse
   * @returns {Promise<{ output: string, tokens: object, thinking: string|null, tool_calls: array, finish_reason: string, raw: object }>}
   */
  async normalizeResponse(rawResponse) {
    if (!rawResponse) {
      return {
        output: '',
        tokens: { input: 0, output: 0, reasoning: 0 },
        thinking: null,
        tool_calls: [],
        finish_reason: 'stop',
        raw: {},
      };
    }

    const inner = rawResponse.data ?? rawResponse;

    const output = inner.choices?.[0]?.message?.content || '';
    const reasoning = inner.choices?.[0]?.message?.reasoning || null;
    const toolCalls = inner.choices?.[0]?.message?.tool_calls || [];
    const finishReason = inner.choices?.[0]?.finish_reason || 'stop';
    const tokens = await extractTokens(inner, output);

    const normalized = {
      output,
      tokens,
      thinking: reasoning,
      tool_calls: toolCalls,
      finish_reason: finishReason,
      raw: rawResponse,
    };

    // Cline returns a `provider` field on successful responses — pass it through
    // so the router can record the actual upstream provider that served the call.
    if (inner.provider && !normalized.provider) {
      normalized.provider = inner.provider;
    }

    return normalized;
  }
}
