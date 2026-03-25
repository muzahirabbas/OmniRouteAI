import { createToolRoute } from './handler.js';
// POST /kilo
export async function kiloRoutes(app) {
  app.post('/kilo', createToolRoute('kilo', 'kilo_cli_local'));
}
