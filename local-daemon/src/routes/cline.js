import { createToolRoute } from './handler.js';
export async function clineRoutes(app) {
  app.post('/cline', createToolRoute('cline', 'cline_cli_local'));
}
