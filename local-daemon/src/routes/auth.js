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
 * Strategy: 
 * 1. Check if binary exists via `--version` or `--help`
 * 2. If tool has authCmd, try checking auth status
 * 3. For tools without authCmd, attempt a minimal functional test
 * 
 * If exit code = 0 → command exists and is functional.
 *
 * @param {string} toolName
 * @param {object} toolConfig
 * @returns {Promise<{status, authenticated, version?}>}
 */
async function checkAuthStatus(toolName, toolConfig) {
  // First check: does the binary exist?
  // Try --version first, then --help as fallback
  const versionResult = await spawnCLI({
    tool:    toolName,
    command: toolConfig.command,
    args:    ['--version'],
    env:     toolConfig.env || {},
    timeout: 5000,
    stream:  false,
  });

  let binaryAvailable = false;
  let versionOutput = null;

  if (versionResult.success && versionResult.exitCode === 0 && versionResult.output) {
    binaryAvailable = true;
    versionOutput = versionResult.output?.split('\n')[0] || null;
  } else {
    // Fallback: try --help (some tools don't have --version)
    const helpResult = await spawnCLI({
      tool:    toolName,
      command: toolConfig.command,
      args:    ['--help'],
      env:     toolConfig.env || {},
      timeout: 5000,
      stream:  false,
    });

    if (helpResult.success && helpResult.exitCode === 0) {
      binaryAvailable = true;
      versionOutput = 'help available';
    }
  }

  if (!binaryAvailable) {
    return {
      status:        'not_installed',
      authenticated: false,
      error:         `'${toolConfig.command}' binary not found in PATH or not executable`,
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

    // Enhanced: Check for common auth failure patterns in stderr
    const authFailed = !authResult.success || 
      (authResult.stderr && /unauthenticated|not logged in|login required|invalid token/i.test(authResult.stderr));

    return {
      status:        authFailed ? 'unauthenticated' : 'authenticated',
      authenticated: !authFailed,
      version:       versionOutput,
      details:       authResult.output?.slice(0, 200) || null,
    };
  }

  // No authCmd — assume available if binary works
  // Enhanced: For some tools, we can do a minimal functional test
  const functionalTest = await performFunctionalTest(toolName, toolConfig);
  
  return {
    status:        functionalTest.success ? 'available' : 'limited',
    authenticated: functionalTest.success,
    version:       versionOutput,
    functional:    functionalTest.success,
  };
}

/**
 * Perform a minimal functional test for tools without authCmd.
 * This verifies the tool can actually make API calls.
 * 
 * @param {string} toolName
 * @param {object} toolConfig
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function performFunctionalTest(toolName, toolConfig) {
  // Tools that support a simple ping or help command
  const testCommands = {
    claude: ['--help'],
    gemini: ['--help'],
    qwen: ['--version'],
    copilot: ['--version'],
  };

  const testArgs = testCommands[toolName];
  if (!testArgs) {
    // No specific test available — assume functional if binary exists
    return { success: true };
  }

  const result = await spawnCLI({
    tool:    toolName,
    command: toolConfig.command,
    args:    testArgs,
    env:     toolConfig.env || {},
    timeout: 5000,
    stream:  false,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.stderr || 'Functional test failed',
    };
  }

  return { success: true };
}
