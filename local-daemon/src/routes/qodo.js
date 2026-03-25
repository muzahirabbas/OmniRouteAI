import { createToolRoute } from './handler.js';
// POST /qodo
export async function qodoRoutes(app) {
  app.post('/qodo', createToolRoute('qodo', 'qodo_cli_local'));
}
