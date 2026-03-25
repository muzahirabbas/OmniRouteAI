import { createToolRoute } from './handler.js';
// POST /opencode
export async function opencodeRoutes(app) {
  app.post('/opencode', createToolRoute('opencode', 'opencode_cli_local'));
}
