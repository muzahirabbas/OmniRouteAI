import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';
export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super('openai', 'https://api.openai.com/v1/chat/completions');
  }

  buildHeaders(apiKey, options = {}) {
    const headers = super.buildHeaders(apiKey, options);
    
    // Add OpenAI-specific headers
    if (options.organization || process.env.OPENAI_ORGANIZATION) {
      headers['OpenAI-Organization'] = options.organization || process.env.OPENAI_ORGANIZATION;
    }
    
    if (options.project || process.env.OPENAI_PROJECT) {
      headers['OpenAI-Project'] = options.project || process.env.OPENAI_PROJECT;
    }
    
    return headers;
  }
}