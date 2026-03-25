import { createToolRoute } from './handler.js';
// POST /kiro
export async function kiroRoutes(app) {
  app.post('/kiro', createToolRoute('kiro', 'kiro_cli_local'));
}
