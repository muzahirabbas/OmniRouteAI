import { log } from '../core/logger.js';
import { getAllProviders } from '../core/registry.js';
import { loadTokens, forceReloadTokens } from './tokenStore.js';
import { harvestTokens } from './harvester.js';
import { startOAuthFlow, handleOAuthCallback } from './oauthFlow.js';
import { startDeviceFlow, pollDeviceFlow } from './deviceFlow.js';
import { wipeTokenFromCLI, polarizeAllTokens } from './sync.js';
import { deleteToken } from './tokenStore.js';
import { getCallbackStatus, stopLocalCallbackServer } from './localCallbackServer.js';

export async function registerAuthRoutes(app) {
  app.post('/auth/harvest', async () => {
    const results = await harvestTokens();
    await forceReloadTokens();
    return { success: true, sessions: results, timestamp: new Date().toISOString() };
  });

  app.get('/auth/oauth-status', async (request) => {
    const forceRefresh = request.query?.force === 'true';
    const tokens = forceRefresh ? await forceReloadTokens() : await loadTokens();
    const providers = getAllProviders();
    
    const status = {};
    for (const provider of providers) {
      const tokenData = tokens[provider.id];
      status[provider.id] = {
        name: provider.name,
        active: !!tokenData?.accessToken,
        source: tokenData?.source || 'none',
        expires: tokenData?.expiresAt || null,
        method: provider.authMethod
      };
    }
    return { providers: status };
  });

  app.post('/auth/:tool/login', async (request, reply) => {
    const { tool } = request.params;
    const body = request.body || {};
    const redirectUri = body.redirectUri || 'http://localhost:5059/auth/callback';

    const providers = getAllProviders();
    const provider = providers.find(p => p.id === tool);

    if (!provider) {
      return reply.code(404).send({ error: `Unknown tool: ${tool}` });
    }

    try {
      if (provider.authMethod === 'oauth') {
        const flow = await startOAuthFlow(tool, redirectUri);
        return { method: 'oauth', ...flow };
      } else if (provider.authMethod === 'device-flow') {
        const flow = await startDeviceFlow(tool, redirectUri);
        return { method: 'device-flow', ...flow };
      } else if (provider.authMethod === 'sqlite-import') {
        return { method: 'sqlite-import', message: 'SQLite import not implemented in this version' };
      } else {
        return reply.code(400).send({ error: `Tool ${tool} does not support web login` });
      }
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.get('/auth/:tool/poll', async (request) => {
    const { tool } = request.params;
    log.info(`Poll requested for ${tool}`);
    const result = await pollDeviceFlow(tool);
    log.info(`Poll result for ${tool}: ${JSON.stringify(result)}`);
    return result;
  });

  app.get('/auth/:tool/callback-status', async (request) => {
    const { tool } = request.params;
    return getCallbackStatus(tool);
  });

  app.delete('/auth/:tool/callback-server', async (request) => {
    const { tool } = request.params;
    await stopLocalCallbackServer(tool);
    return { success: true };
  });

  app.get('/auth/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query;

    if (error) {
      return reply.type('text/html').send(`<h2>OAuth Failed</h2><p>${error_description || error}</p>`);
    }
    if (!code) {
      return reply.type('text/html').send(`<h2>Invalid Request</h2><p>Missing code.</p>`);
    }

    try {
      await handleOAuthCallback(code, state);
      return reply.type('text/html').send(`
        <html><body>
          <h2>Login Successful!</h2>
          <p>You can close this window now and return to OmniRouteAI.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body></html>
      `);
    } catch (err) {
      return reply.type('text/html').send(`<h2>OAuth Failed</h2><p>${err.message}</p>`);
    }
  });

  app.delete('/auth/:tool', async (request) => {
    const { tool } = request.params;
    
    await deleteToken(tool);
    await wipeTokenFromCLI(tool);
    log.info(`Revoked active session for ${tool}`);
    
    return { success: true };
  });

  app.post('/auth/polarize', async () => {
    await polarizeAllTokens();
    return { success: true };
  });
}
