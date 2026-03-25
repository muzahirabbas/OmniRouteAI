import { createToolRoute } from './handler.js';
// POST /gemini
export async function geminiRoutes(app) {
  app.post('/gemini', createToolRoute('gemini', 'gemini_cli_local'));
}
