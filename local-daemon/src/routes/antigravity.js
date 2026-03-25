import { createToolRoute } from './handler.js';
// POST /antigravity
export async function antigravityRoutes(app) {
  app.post('/antigravity', createToolRoute('antigravity', 'antigravity_cli_local'));
}
