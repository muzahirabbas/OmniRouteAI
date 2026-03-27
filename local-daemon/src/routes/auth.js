import { spawn } from 'node:child_process';
import { log } from '../logger.js';
import { getTools, getToolConfig, loadConfig } from '../config.js';
import { loadTokens, saveTokens } from '../oauth/tokenStorage.js';
import { startDeviceFlow, pollDeviceFlow } from '../oauth/deviceFlow.js';
import { harvestTokens } from '../oauth/harvester.js';
import { spawnCLI } from '../spawner.js';

/**
 * Auth management routes.
 *
 * GET  /auth/status        — check login status for all tools (CLI + OAuth)
 * GET  /auth/oauth-status  — check active OAuth sessions (Daemon-managed)
 * POST /auth/login/:tool   — trigger auth login flow for a tool
 * POST /auth/harvest       — manual trigger for token scan
 */
export async function authRoutes(app) {

  // ─── POST /auth/harvest ──────────────────────────────────────────
  app.post('/auth/harvest', async (request, reply) => {
    log.info('Triggering manual token harvest scan');
    const results = await harvestTokens();
    return {
      success: true,
      sessions: results,
      timestamp: new Date().toISOString()
    };
  });

  // ─── GET /auth/oauth-status ──────────────────────────────────────────
  app.get('/auth/oauth-status', async () => {
    const tokens = await loadTokens();
    const tools = await getTools();
    
    const status = {};
    for (const [id, config] of Object.entries(tools || {})) {
      const tokenData = tokens[id];
      status[id] = {
        name:     config.name,
        active:   !!tokenData,
        source:   tokenData?.source || 'none',
        expires:  tokenData?.expiresAt || null,
        method:   tokenData?.source ? 'Harvested' : (['copilot', 'qwen'].includes(id) ? 'Device Flow' : 'CLI')
      };
    }
    return { providers: status };
  });

  // ─── POST /auth/:tool/login (Trigger OAuth/Device Flow) ─────────────
  app.post('/auth/:tool/login', async (request, reply) => {
    const { tool } = request.params;
    log.info(`Initiating OAuth login flow for ${tool}...`);
    const flow = await startDeviceFlow(tool);
    if (!flow) return reply.code(500).send({ error: `Failed to start login flow for ${tool}` });
    return flow;
  });

  // ─── GET /auth/:tool/poll (Check Login Success) ─────────────────────
  app.get('/auth/:tool/poll', async (request) => {
    const { tool } = request.params;
    return await pollDeviceFlow(tool);
  });

  // ─── DELETE /auth/:tool (Revoke Session) ────────────────────────────
  app.delete('/auth/:tool', async (request) => {
    const { tool } = request.params;
    const tokens = await loadTokens();
    if (tokens[tool]) {
      delete tokens[tool];
      await saveTokens(tokens);
      log.info(`Revoked active session for ${tool}`);
    }
    return { success: true };
  });

  // ─── GET /auth/status ─────────────────────────────────────────────
  app.get('/auth/status', async (request, reply) => {
    const config  = await loadConfig();
    const tools   = Object.keys(config.tools || {});
    const tokens  = await loadTokens();
    const results = {};

    for (const toolName of tools) {
      const toolConfig = config.tools[toolName];
      if (!toolConfig.enabled || !toolConfig.command) {
        results[toolName] = { status: 'disabled', authenticated: null };
        continue;
      }

      // 1. Check if we have an active daemon-managed OAuth session
      if (tokens[toolName]) {
        results[toolName] = { 
          status: 'authenticated', 
          authenticated: true, 
          method: 'oauth',
          source: tokens[toolName].source 
        };
        continue;
      }

      // 2. Fallback to CLI status probe
      results[toolName] = await checkAuthStatus(toolName, toolConfig);
    }

    return { tools: results, timestamp: new Date().toISOString() };
  });

  // ─── POST /auth/login/:tool (CLI Fallback) ─────────────────────────
  app.post('/auth/login/:tool', async (request, reply) => {
    const { tool } = request.params;
    const toolConfig = await getToolConfig(tool);

    if (!toolConfig) return reply.code(404).send({ error: `Unknown tool: ${tool}` });
    
    // If it's a known OAuth tool, redirect to device flow route if they use this legacy endpoint
    if (['copilot', 'qwen'].includes(tool)) {
      const flow = await startDeviceFlow(tool);
      if (flow) return { method: 'device-flow', ...flow };
    }

    const cmd = toolConfig.authCmd || `${tool} auth login`;
    const parts = cmd.trim().split(/\s+/);
    
    const result = await spawnCLI({
      tool,
      command: parts[0],
      args:    parts.slice(1),
      env:     toolConfig.env || {},
      timeout: 120000, 
      stream:  false,
    });

    return {
      tool,
      success:  result.success,
      output:   result.output,
      message:  result.success ? `Auth flow finished for ${tool}` : `Auth failed: ${result.error}`,
    };
  });
}

/**
 * Probes CLI binary for traditional login status.
 */
async function checkAuthStatus(toolName, toolConfig) {
  const versionResult = await spawnCLI({
    tool:    toolName,
    command: toolConfig.command,
    args:    ['--version'],
    env:     toolConfig.env || {},
    timeout: 5000,
    stream:  false,
  });

  if (!versionResult.success && versionResult.exitCode !== 0) {
    return { status: 'not_installed', authenticated: false };
  }

  const versionOutput = versionResult.output?.split('\n')[0] || 'active';

  if (toolConfig.authCmd) {
    const parts = toolConfig.authCmd.trim().split(/\s+/);
    const verb  = parts[1];
    const isSafe = parts.length === 2 && !verb?.startsWith('-');
    const statusArgs = isSafe ? [verb, 'status'] : ['--version'];

    const authResult = await spawnCLI({
      tool:    toolName,
      command: parts[0],
      args:    statusArgs,
      env:     toolConfig.env || {},
      timeout: 8000,
      stream:  false,
    });

    const authFailed = !authResult.success ||
      (authResult.stderr && /unauthenticated|not logged in|login required|invalid token/i.test(authResult.stderr));

    return {
      status:        authFailed ? 'unauthenticated' : 'authenticated',
      authenticated: !authFailed,
      version:       versionOutput,
      method:        'cli'
    };
  }

  return {
    status:        'available',
    authenticated: true,
    version:       versionOutput,
    method:        'binary'
  };
}
