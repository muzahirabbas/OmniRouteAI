import { createToolRoute } from './handler.js';
// POST /copilot
export async function copilotRoutes(app) {
  app.post('/copilot', createToolRoute('copilot', 'copilot_cli_local'));
}
