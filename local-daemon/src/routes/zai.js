import { createToolRoute } from './handler.js';
export async function zaiRoutes(app) {
  app.post('/zai', createToolRoute('zai', 'zai_cli_local'));
}
