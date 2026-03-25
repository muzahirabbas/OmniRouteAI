import { createToolRoute } from './handler.js';
// POST /claude
export async function claudeRoutes(app) {
  app.post('/claude', createToolRoute('claude', 'claude_cli_local'));
}
