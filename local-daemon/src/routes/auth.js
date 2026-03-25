import { spawnCLI } from '../spawner.js';
import { getToolConfig, loadConfig } from '../config.js';
import { log } from '../logger.js';

/**
 * Auth management routes.
 *
 * GET  /auth/status        — check login status for all tools
 * GET  /auth/status/:tool  — check login status for specific tool
 * POST /auth/login/:tool   — trigger auth login flow for a tool
 */
export async function authRoutes(app) {

  // ─── GET /auth/status ─────────────────────────────────────────────
  app.get('/auth/status', async (request, reply) => {
    const config  = await loadConfig();
    const tools   = Object.keys(config.tools || {});
    const results = {};

    for (const toolName of tools) {
      const toolConfig = config.tools[toolName];
      if (!toolConfig.enabled || !toolConfig.command) {
        results[toolName] = { status: 'disabled', authenticated: null };
        continue;
      }

      results[toolName] = await checkAuthStatus(toolName, toolConfig);
    }

    return { tools: results, timestamp: new Date().toISOString() };
  });

  // ─── GET /auth/status/:tool ───────────────────────────────────────
  app.get('/auth/status/:tool', async (request, reply) => {
    const { tool } = request.params;
    const toolConfig = await getToolConfig(tool);

    if (!toolConfig) {
      return reply.code(404).send({ error: `Unknown tool: ${tool}` });
    }
    if (!toolConfig.enabled || !toolConfig.command) {
      return reply.code(503).send({ status: 'disabled', tool });
    }

    const status = await checkAuthStatus(tool, toolConfig);
    return { tool, ...status };
  });

  // ─── POST /auth/login/:tool ───────────────────────────────────────
  app.post('/auth/login/:tool', async (request, reply) => {
    const { tool } = request.params;
    const toolConfig = await getToolConfig(tool);

    if (!toolConfig) {
      return reply.code(404).send({ error: `Unknown tool: ${tool}` });
    }
    if (!toolConfig.enabled || !toolConfig.command) {
      return reply.code(503).send({ error: `Tool ${tool} is disabled` });
    }
    if (!toolConfig.authCmd) {
      return reply.code(400).send({
        error:   `Tool '${tool}' has no authCmd configured`,
        hint:    `Set tools.${tool}.authCmd in ~/.omniroute/local-cli/config.json`,
      });
    }

    log.info(`Triggering auth login for tool: ${tool}`);

    // Split authCmd into command + args
    const parts   = toolConfig.authCmd.trim().split(/\s+/);
    const command = parts[0];
    const args    = parts.slice(1);

    const result = await spawnCLI({
      tool,
      command,
      args,
      env:     toolConfig.env || {},
      timeout: 120000, // 2 min for interactive auth
      stream:  false,
    });

    return {
      tool,
      success:  result.success,
      output:   result.output,
      exitCode: result.exitCode,
      message:  result.success
        ? `Auth login flow completed for ${tool}`
        : `Auth login failed for ${tool}: ${result.error}`,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Check auth status for a tool by running a lightweight probe command.
 * Strategy: run `<command> --version` or `<command> auth status`.
 * If exit code = 0 → command exists and is functional.
 *
 * @param {string} toolName
 * @param {object} toolConfig
 * @returns {Promise<{status, authenticated, version?}>}
 */
async function checkAuthStatus(toolName, toolConfig) {
  // First check: does the binary exist?
  const versionResult = await spawnCLI({
    tool:    toolName,
    command: toolConfig.command,
    args:    ['--version'],
    env:     toolConfig.env || {},
    timeout: 5000,
    stream:  false,
  });

  if (!versionResult.success && versionResult.exitCode !== 0 && !versionResult.output) {
    return {
      status:        'not_installed',
      authenticated: false,
      error:         `'${toolConfig.command}' binary not found in PATH`,
    };
  }

  // If tool has an authCmd, try checking auth status
  if (toolConfig.authCmd) {
    const parts      = toolConfig.authCmd.trim().split(/\s+/);
    const statusArgs = [...parts.slice(1), 'status'].filter(Boolean);

    const authResult = await spawnCLI({
      tool:    toolName,
      command: parts[0],
      args:    statusArgs,
      env:     toolConfig.env || {},
      timeout: 8000,
      stream:  false,
    });

    return {
      status:        authResult.success ? 'authenticated' : 'unauthenticated',
      authenticated: authResult.success,
      version:       versionResult.output?.split('\n')[0] || null,
    };
  }

  // No authCmd — assume available if binary works
  return {
    status:        'available',
    authenticated: true,
    version:       versionResult.output?.split('\n')[0] || null,
  };
}
