import { getToolConfig } from '../config.js';

export async function ollamaRoutes(app) {
  /**
   * Secure bridge to local Ollama API (11434).
   * This allows a cloud-hosted OmniRouteAI backend to reach a machine's local models.
   */
  app.post('/ollama', async (request, reply) => {
    const toolConfig = await getToolConfig('ollama_local');
    if (!toolConfig?.enabled) {
      return reply.code(503).send({ error: 'Ollama local bridge is disabled' });
    }

    const { prompt, model, stream } = request.body;
    const ollamaUrl = 'http://localhost:11434/api/chat';

    try {
      const response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama3',
          messages: [{ role: 'user', content: prompt }],
          stream: false, // For now, non-streaming bridge
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return reply.code(502).send({ error: `Ollama error: ${errText}`, provider: 'ollama_local' });
      }

      const data = await response.json();
      
      return {
        output:   data.message?.content || '',
        provider: 'ollama_local',
        model:    data.model,
        tokens: {
          input:  data.prompt_eval_count || 0,
          output: data.eval_count || 0,
        },
        success:  true,
      };
    } catch (err) {
      return reply.code(504).send({ error: `Failed to reach local Ollama: ${err.message}`, provider: 'ollama_local' });
    }
  });
}
