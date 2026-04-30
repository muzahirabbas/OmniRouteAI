import { updateToken } from './tokenStore.js';
import { log } from '../core/logger.js';
import { getProvider } from '../core/registry.js';
import { generatePKCE } from './pkce.js';

const activeDeviceFlows = new Map();

const GITHUB_CONFIG = {
  clientId: 'Iv1.b507a08c87ecfe98',
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scopes: 'read:user',
  copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token',
  apiVersion: '2022-11-28',
  userAgent: 'GitHubCopilotChat/0.26.7',
};

export async function startDeviceFlow(tool, redirectUri = 'http://127.0.0.1:5059/auth/callback') {
  const provider = getProvider(tool);
  if (!provider || !provider.deviceFlowConfig) {
    throw new Error(`Device flow not supported for ${tool}`);
  }

  const config = provider.deviceFlowConfig;

  try {
    if (tool === 'copilot') {
      const res = await fetch(config.deviceCodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({ client_id: config.clientId, scope: config.scopes }),
      });
      let data;
      try {
        data = await res.json();
      } catch (e) {
        const text = await res.text();
        throw new Error(`GitHub device flow failed: ${text}`);
      }
      if (!res.ok) throw new Error(data.error_description || data.error || await res.text());
      if (!data.device_code) throw new Error(`Invalid response from GitHub: ${JSON.stringify(data)}`);

      const session = {
        tool,
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUrl: data.verification_uri,
        interval: Math.max(data.interval || 5, 5) * 1000,
        expiresAt: Date.now() + (data.expires_in * 1000),
      };
      activeDeviceFlows.set(tool, session);
      return session;

    } else if (tool === 'qwen') {
      const pkce = generatePKCE();
      const res = await fetch(config.deviceCodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          scope: config.scope,
          code_challenge: pkce.codeChallenge,
          code_challenge_method: 'S256',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const session = {
        tool,
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUrl: data.verification_uri_complete || data.verification_uri,
        interval: (data.interval || 5) * 1000,
        expiresAt: Date.now() + (data.expires_in * 1000),
        codeVerifier: pkce.codeVerifier
      };
      activeDeviceFlows.set(tool, session);
      return session;

    } else if (tool === 'kiro') {
      const regRes = await fetch(config.registerClientUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: config.clientName,
          clientType: 'public',
          scopes: config.scopes,
          grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']
        })
      });
      if (!regRes.ok) throw new Error('Kiro client registration failed');
      const clientInfo = await regRes.json();

      const devRes = await fetch(config.deviceAuthUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientInfo.clientId,
          clientSecret: clientInfo.clientSecret,
          startUrl: config.startUrl
        })
      });
      if (!devRes.ok) throw new Error('Kiro device auth failed');
      const data = await devRes.json();

      const session = {
        tool,
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        verificationUrl: data.verificationUriComplete || data.verificationUri,
        interval: (data.interval || 5) * 1000,
        expiresAt: Date.now() + (data.expiresIn * 1000),
        extra: { clientId: clientInfo.clientId, clientSecret: clientInfo.clientSecret }
      };
      activeDeviceFlows.set(tool, session);
      return session;

    } else if (tool === 'kilo') {
      const res = await fetch(config.initiateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error('Kilo initiate failed');
      const data = await res.json();

      const session = {
        tool,
        deviceCode: data.code,
        userCode: data.code,
        verificationUrl: data.verificationUrl,
        interval: 3000,
        expiresAt: Date.now() + ((data.expiresIn || 300) * 1000)
      };
      activeDeviceFlows.set(tool, session);
      return session;

    } else if (tool === 'kimi') {
      const res = await fetch(config.deviceCodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const session = {
        tool,
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUrl: data.verification_uri_complete || `https://www.kimi.com/code/authorize_device?user_code=${data.user_code}`,
        interval: (data.interval || 5) * 1000,
        expiresAt: Date.now() + (data.expires_in * 1000)
      };
      activeDeviceFlows.set(tool, session);
      return session;
    }

    throw new Error(`Unknown device flow tool: ${tool}`);
  } catch (err) {
    log.error(`Device flow start failed for ${tool}: ${err.message}`);
    throw err;
  }
}

export async function pollDeviceFlow(tool) {
  const session = activeDeviceFlows.get(tool);
  log.info(`pollDeviceFlow called for ${tool}, session exists: ${!!session}`);
  if (!session) {
    log.warn(`No active session for ${tool}, returning expired`);
    return { status: 'expired' };
  }

  if (Date.now() > session.expiresAt) {
    log.warn(`Session expired for ${tool}`);
    activeDeviceFlows.delete(tool);
    return { status: 'expired' };
  }

  const provider = getProvider(tool);
  const config = provider?.deviceFlowConfig;

  try {
    if (tool === 'copilot') {
      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: session.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      let data;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = {};
        text.split('&').forEach(pair => {
          const [key, val] = pair.split('=');
          if (key) data[key] = decodeURIComponent(val || '');
        });
      }
      log.info(`GitHub token exchange response status: ${res.status}, data: ${JSON.stringify(data)}`);
      if (data.error === 'authorization_pending' || data.error === 'slow_down') {
        if (data.interval) {
          session.interval = parseInt(data.interval, 10) * 1000;
          activeDeviceFlows.set(tool, session);
          log.info(`Updated polling interval to ${session.interval}ms per GitHub request`);
        }
        return { status: 'pending', interval: session.interval };
      }
      if (data.error) throw new Error(data.error_description || data.error);
      if (!data.access_token) {
        log.error(`No access_token in response: ${JSON.stringify(data)}`);
        throw new Error('No access_token in GitHub response');
      }

      log.info(`GitHub token exchange success, fetching Copilot token...`);
      const copilotRes = await fetch(config.copilotTokenUrl, {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
          Accept: 'application/json',
          'X-GitHub-Api-Version': config.apiVersion,
          'User-Agent': GITHUB_CONFIG.userAgent,
        },
      });
      if (!copilotRes.ok) {
        const errText = await copilotRes.text();
        log.error(`Copilot token fetch failed: ${copilotRes.status} - ${errText}`);
        throw new Error(`Could not fetch Copilot token: ${copilotRes.status}`);
      }
      const copilotData = await copilotRes.json();
      log.info(`Copilot token obtained successfully`);

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
          Accept: 'application/json',
          'X-GitHub-Api-Version': config.apiVersion,
          'User-Agent': GITHUB_CONFIG.userAgent,
        },
      });
      const userInfo = userRes.ok ? await userRes.json() : {};

      const tokens = {
        accessToken: copilotData.token,
        refreshToken: data.refresh_token,
        source: 'copilot-device',
        providerSpecificData: {
          copilotTokenExpiresAt: copilotData.expires_at,
          githubUserId: userInfo.id,
          githubLogin: userInfo.login,
        }
      };

      await updateToken(tool, tokens);
      activeDeviceFlows.delete(tool);
      return { status: 'success' };

    } else if (tool === 'qwen') {
      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: session.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          code_verifier: session.codeVerifier
        }),
      });
      const data = await res.json();
      if (data.error === 'authorization_pending' || data.error === 'slow_down') {
        if (data.interval) {
          session.interval = parseInt(data.interval, 10) * 1000;
          activeDeviceFlows.set(tool, session);
          log.info(`Updated Qwen polling interval to ${session.interval}ms`);
        }
        return { status: 'pending', interval: session.interval };
      }
      if (data.error) throw new Error(data.error_description || data.error);

      const tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        source: 'qwen-device'
      };

      await updateToken(tool, tokens);
      activeDeviceFlows.delete(tool);
      return { status: 'success' };

    } else if (tool === 'kiro') {
      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: session.extra.clientId,
          clientSecret: session.extra.clientSecret,
          deviceCode: session.deviceCode,
          grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      let data = {};
      try { data = await res.json(); } catch { data = { error: 'invalid_response' }; }
      if (data.error === 'authorization_pending' || !data.accessToken) return { status: 'pending' };
      if (data.error) throw new Error(data.error_description || data.error);

      const tokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        source: 'kiro-device'
      };

      await updateToken(tool, tokens);
      activeDeviceFlows.delete(tool);
      return { status: 'success' };

    } else if (tool === 'kilo') {
      let data;
      try {
        const res = await fetch(`${config.pollUrlBase}/${session.deviceCode}`);
        try {
          data = await res.json();
        } catch (e) {
          const text = await res.text();
          throw new Error(`Kilo poll returned non-JSON: ${text}`);
        }
        log.info(`Kilo poll status: ${res.status}, data: ${JSON.stringify(data)}`);
      
        if (res.status === 202) return { status: 'pending' };
        if (res.status === 403) throw new Error('Authorization denied');
        if (res.status === 410) throw new Error('Code expired');
        if (!res.ok) throw new Error(`Poll failed: ${res.status}, ${JSON.stringify(data)}`);

        if ((data.status === 'approved' || data.status === 'completed') && data.token) {
          const tokens = { accessToken: data.token, source: 'kilo-device' };
          await updateToken(tool, tokens);
          activeDeviceFlows.delete(tool);
          log.info(`Kilo token saved successfully`);
          return { status: 'success' };
        }
        if (data.status === 'pending' || data.status === 'waiting') {
          return { status: 'pending' };
        }
        return { status: 'pending', data };
      } catch (err) {
        log.error(`Kilo poll error: ${err.message}`);
        return { status: 'error', message: err.message };
      }

    } else if (tool === 'kimi') {
      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: session.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const data = await res.json();
      if (data.error === 'authorization_pending' || data.error === 'slow_down') return { status: 'pending' };
      if (data.error) throw new Error(data.error_description || data.error);

      const tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        source: 'kimi-device'
      };

      await updateToken(tool, tokens);
      activeDeviceFlows.delete(tool);
      return { status: 'success' };
    }

    return { status: 'pending' };

  } catch (err) {
    log.error(`Device flow poll failed for ${tool}: ${err.message}`);
    activeDeviceFlows.delete(tool);
    return { status: 'error', message: err.message };
  }
}

export function getActiveFlow(tool) {
  return activeDeviceFlows.get(tool);
}
