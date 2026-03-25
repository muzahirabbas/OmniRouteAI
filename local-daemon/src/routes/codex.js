import { createToolRoute } from './handler.js';
// POST /codex
export async function codexRoutes(app) {
  app.post('/codex', createToolRoute('codex', 'codex_cli_local'));
}
