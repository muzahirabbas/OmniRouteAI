import { refreshIfNeeded } from './refreshService.js';
import { log } from '../logger.js';

const PROVIDERS = {
  claude: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    headers: (token) => ({
      "Authorization": `Bearer ${token}`,
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219",
      "User-Agent": "claude-cli/2.1.63",
      "Content-Type": "application/json"
    })
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (token) => ({
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    })
  }
};

/**
 * Attempt to call provider API directly using OAuth tokens.
 * Falls back to CLI if tokens are missing.
 */
export async function tryDirectFetch(toolName, body, onChunk) {
  const config = PROVIDERS[toolName];
  if (!config) return null;

  const token = await refreshIfNeeded(toolName);
  if (!token) {
    log.info(`No OAuth token for ${toolName}, falling back to CLI.`);
    return null;
  }

  try {
    const { prompt, model, stream, system_prompt } = body;
    
    // Format body for provider (Claude format used as example)
    const providerBody = toolName === 'claude' ? {
      model: model || 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: prompt }],
      system: system_prompt,
      stream,
      max_tokens: 4096
    } : {
      contents: [{ parts: [{ text: prompt }] }]
    };

    const endpoint = toolName === 'gemini' 
      ? `${config.baseUrl}/${model || 'gemini-1.5-pro'}:generateContent`
      : config.baseUrl;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: config.headers(token),
      body: JSON.stringify(providerBody)
    });

    if (!response.ok) {
      log.warn(`Direct fetch for ${toolName} failed (${response.status}), falling back to CLI.`);
      return null;
    }

    if (stream) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullOutput = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        
        // Simple SSE parsing (Claude format)
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.delta?.text || data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                fullOutput += text;
                onChunk(text);
              }
            } catch (e) {}
          }
        }
      }
      return { output: fullOutput, success: true };
    } else {
      const data = await response.json();
      const output = toolName === 'claude' 
        ? data.content[0].text 
        : data.candidates[0].content.parts[0].text;
      return { output, success: true, tokens: { input: 0, output: 0 } };
    }
  } catch (err) {
    log.error(`Direct fetch error for ${toolName}: ${err.message}`);
    return null;
  }
}
