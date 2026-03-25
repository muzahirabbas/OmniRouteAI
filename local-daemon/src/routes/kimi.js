import { createToolRoute } from './handler.js';
export async function kimiRoutes(app) {
  app.post('/kimi', createToolRoute('kimi', 'kimi_cli_local'));
}
