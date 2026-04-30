import crypto from 'node:crypto';
import { updateToken } from './tokenStore.js';
import { log } from '../core/logger.js';
import { getProvider } from '../core/registry.js';
import { startLocalCallbackServer, stopLocalCallbackServer, initCallback, resolveCallback } from './localCallbackServer.js';

const activeOAuthSessions = new Map();

export async function startOAuthFlow(tool, redirectUri = null) {
  const provider = getProvider(tool);
  if (!provider || !provider.oauthConfig) {
    throw new Error(`OAuth not supported for ${tool}`);
  }

  const config = provider.oauthConfig;
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  let finalRedirectUri = redirectUri;

  await stopLocalCallbackServer(tool).catch(() => {});

  if (tool === 'codex') {
    const { port } = await startLocalCallbackServer(tool, 1455);
    finalRedirectUri = `http://localhost:${port}/callback`;
  } else if (!finalRedirectUri) {
    finalRedirectUri = 'http://localhost:5059/auth/callback';
  }

  activeOAuthSessions.set(state, { tool, codeVerifier, redirectUri: finalRedirectUri, startTime: Date.now() });

  initCallback(tool);

  setTimeout(() => activeOAuthSessions.get(state) && activeOAuthSessions.delete(state), 300000);

  let url = '';

  if (tool === 'claude') {
    const params = new URLSearchParams({
      code: 'true',
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: finalRedirectUri,
      scope: config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    url = `${config.authorizeUrl}?${params.toString()}`;
  } else if (tool === 'gemini' || tool === 'antigravity') {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: finalRedirectUri,
      scope: config.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    url = `${config.authorizeUrl}?${params.toString()}`;
  } else if (tool === 'cline') {
    const params = new URLSearchParams({
      redirect_uri: finalRedirectUri,
      state,
      client_type: 'extension',
    });
    url = `${config.authorizeUrl}?${params.toString()}`;
  } else if (tool === 'codex') {
    log.info(`Starting Codex OAuth with redirectUri: ${finalRedirectUri}`);
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: finalRedirectUri,
      scope: 'openid profile email offline_access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
    });
    url = `${config.authorizeUrl}?${params.toString()}`;
    log.info(`Codex auth URL: ${url}`);
  }

  try {
    const open = (await import('open')).default;
    await open(url);
    log.info(`Opened OAuth flow for ${tool}`);
  } catch (err) {
    log.warn(`Could not open browser: ${err.message}`);
  }

  return { success: true, url, state };
}

export async function handleOAuthCallback(code, state) {
  let session = activeOAuthSessions.get(state);

  if (!session) {
    for (const [s, data] of activeOAuthSessions.entries()) {
      if (data.tool === 'cline' && Date.now() - data.startTime < 300000) {
        session = data;
        break;
      }
    }
  }

  if (!session && (state === 'none' || !state)) {
    for (const [s, data] of activeOAuthSessions.entries()) {
      if (data.tool === 'cline') {
        session = data;
        break;
      }
    }
  }

  if (!session) throw new Error('Invalid OAuth session or expired state');

  const { tool, redirectUri, codeVerifier } = session;
  activeOAuthSessions.delete(state);

  const provider = getProvider(tool);
  const config = provider?.oauthConfig;

  log.info(`Exchanging OAuth code for ${tool}...`);

  try {
    let tokens = null;

    if (tool === 'cline') {
      try {
        let base64 = code;
        const padding = 4 - (base64.length % 4);
        if (padding !== 4) base64 += '='.repeat(padding);
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        const lastBrace = decoded.lastIndexOf('}');
        if (lastBrace === -1) throw new Error('No JSON found');
        const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1));
        tokens = {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresIn: tokenData.expiresAt ? Math.floor((new Date(tokenData.expiresAt).getTime() - Date.now()) / 1000) : 3600,
          email: tokenData.email,
          source: 'cline-decoded'
        };
      } catch (e) {
        log.warn(`Cline decode failed: ${e.message}`);
        const res = await fetch(config.tokenExchangeUrl || config.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'authorization_code', code, client_type: 'extension', redirect_uri: redirectUri }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        tokens = {
          accessToken: data.data?.accessToken || data.accessToken,
          refreshToken: data.data?.refreshToken || data.refreshToken,
          source: 'cline-oauth'
        };
      }
    } else if (tool === 'gemini' || tool === 'antigravity') {
      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        source: `${tool}-oauth`
      };

      // Background fetch for Google project details to avoid blocking the UI response
      fetchGoogleProjectId(tokens.accessToken).then(({ projectId, tierId }) => {
        if (projectId || tierId) {
          log.info(`Background project fetch successful for ${tool}`);
          updateToken(tool, { projectId, tierId });
        }
      }).catch(e => log.warn(`Google project fetch failed: ${e.message}`));
    } else if (tool === 'codex') {
      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
        source: `${tool}-oauth`
      };
    } else {
      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          state,
          grant_type: 'authorization_code',
          client_id: config.clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        source: `${tool}-oauth`
      };
    }

    if (tokens) {
      log.info(`Successfully obtained OAuth tokens for ${tool}`);
      await updateToken(tool, tokens);
      
      // Resolve the callback status immediately so the UI can proceed
      resolveCallback(tool, { code, state });
      
      try {
        const { syncTokenToCLI } = await import('./sync.js');
        await syncTokenToCLI(tool, tokens);
      } catch (e) {
        log.warn(`Token sync failed: ${e.message}`);
      }
      
      return { success: true, tool };
    }

    throw new Error('No tokens received');
  } catch (err) {
    log.error(`OAuth exchange failed for ${tool}: ${err.message}`);
    throw err;
  }
}

async function fetchGoogleProjectId(accessToken) {
  try {
    const res = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${accessToken}`, 
        'Content-Type': 'application/json',
        'x-request-source': 'local'
      },
      body: JSON.stringify({ metadata: { ideType: 9, platform: 5, pluginType: 2 } }),
    });

    if (!res.ok) return { projectId: '', tierId: 'legacy-tier' };
    const data = await res.json();

    const projectId = data.cloudaicompanionProject?.id || data.cloudaicompanionProject || '';
    let tierId = 'legacy-tier';
    if (Array.isArray(data.allowedTiers)) {
      for (const tier of data.allowedTiers) {
        if (tier.isDefault && tier.id) {
          tierId = tier.id.trim();
          break;
        }
      }
    }
    return { projectId, tierId };
  } catch {
    return { projectId: '', tierId: 'legacy-tier' };
  }
}
