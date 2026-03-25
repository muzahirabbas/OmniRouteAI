import { createToolRoute } from './handler.js';
// POST /qwen
export async function qwenRoutes(app) {
  app.post('/qwen', createToolRoute('qwen', 'qwen_cli_local'));
}
