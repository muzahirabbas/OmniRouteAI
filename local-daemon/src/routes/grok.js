import { createToolRoute } from './handler.js';
// POST /grok
export async function grokRoutes(app) {
  app.post('/grok', createToolRoute('grok', 'grok_cli_local'));
}
