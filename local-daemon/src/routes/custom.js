import { createToolRoute } from './handler.js';
// POST /custom — for user-defined CLI tools
export async function customRoutes(app) {
  app.post('/custom', createToolRoute('custom', 'custom_cli_local'));
}
