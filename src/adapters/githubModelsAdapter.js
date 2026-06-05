import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';

/**
 * GitHub Models adapter.
 * Endpoint: https://models.github.ai/inference/chat/completions
 * Auth: Bearer token (GitHub PAT with models:read scope)
 * Format: OpenAI-compatible, but rejects `metadata` unless `store=true`.
 */
export class GithubModelsAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('github-models', 'https://models.github.ai/inference/chat/completions');
  }

  buildBody(prompt, model, stream = false, options = {}) {
    const body = super.buildBody(prompt, model, stream, options);

    // GitHub Models returns 400 if `metadata` is sent without `store=true`.
    delete body.metadata;

    return body;
  }
}
