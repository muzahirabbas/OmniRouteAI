import { updateToken } from './tokenStorage.js';
import { log } from '../logger.js';
import { generatePKCE } from './pkce.js';

// --- Device Flow Constants ---
const QWEN_CONFIG = {
  clientId: "f0304373b74a44d2b584a3fb70ca9e56",
  deviceCodeUrl: "https://chat.qwen.ai/api/v1/oauth2/device/code",
  tokenUrl: "https://chat.qwen.ai/api/v1/oauth2/token",
  scope: "openid profile email model.completion",
  codeChallengeMethod: "S256",
};

const GITHUB_CONFIG = {
  clientId: "Iv1.b507a08c87ecfe98",
  deviceCodeUrl: "https://github.com/login/device/code",
  tokenUrl: "https://github.com/login/oauth/access_token",
  scopes: "read:user",
  copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

const KIRO_CONFIG = {
  registerClientUrl: "https://oidc.us-east-1.amazonaws.com/client/register",
  deviceAuthUrl: "https://oidc.us-east-1.amazonaws.com/device_authorization",
  tokenUrl: "https://oidc.us-east-1.amazonaws.com/token",
  startUrl: "https://view.awsapps.com/start",
  clientName: "kiro-oauth-client",
  clientType: "public",
  scopes: ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"],
  grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
};

const KILOCODE_CONFIG = {
  initiateUrl: "https://api.kilo.ai/api/device-auth/codes",
  pollUrlBase: "https://api.kilo.ai/api/device-auth/codes",
};

const KIMI_CONFIG = {
  clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
  deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
  tokenUrl: "https://auth.kimi.com/api/oauth/token",
};


// Pending device flow active polling
const activeDeviceFlows = new Map();

/**
 * Initiates the device authorization flow.
 * Returns { userCode, verificationUrl, expiresAt, deviceCode }
 */
export async function startDeviceFlow(tool) {
  try {
    if (tool === 'copilot') {
      const res = await fetch(GITHUB_CONFIG.deviceCodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: GITHUB_CONFIG.clientId, scope: GITHUB_CONFIG.scopes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const session = {
        tool,
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUrl: data.verification_uri,
        interval: (data.interval || 5) * 1000,
        expiresAt: Date.now() + (data.expires_in * 1000),
      };
      activeDeviceFlows.set(tool, session);
      return session;

    } else if (tool === 'qwen') {
      const pkce = generatePKCE(); // We must write a small pkce generator
      const res = await fetch(QWEN_CONFIG.deviceCodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: QWEN_CONFIG.clientId,
          scope: QWEN_CONFIG.scope,
          code_challenge: pkce.codeChallenge,
          code_challenge_method: QWEN_CONFIG.codeChallengeMethod,
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
      // Step 1: dynamic client register
      const regRes = await fetch(KIRO_CONFIG.registerClientUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          clientName: KIRO_CONFIG.clientName, clientType: KIRO_CONFIG.clientType, 
          scopes: KIRO_CONFIG.scopes, grantTypes: KIRO_CONFIG.grantTypes
        })
      });
      if (!regRes.ok) throw new Error('Kiro client reg failed: ' + await regRes.text());
      const clientInfo = await regRes.json();

      // Step 2: device auth
      const devRes = await fetch(KIRO_CONFIG.deviceAuthUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          clientId: clientInfo.clientId, clientSecret: clientInfo.clientSecret, startUrl: KIRO_CONFIG.startUrl
        })
      });
      if (!devRes.ok) throw new Error('Kiro device auth failed: ' + await devRes.text());
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
        const res = await fetch(KILOCODE_CONFIG.initiateUrl, { method: "POST", headers: { "Content-Type": "application/json" } });
        if (!res.ok) throw new Error('Kilocode initiate failed: ' + await res.text());
        const data = await res.json();
        const session = {
            tool,
            deviceCode: data.code,
            userCode: data.code,  // kilocode uses same for both usually
            verificationUrl: data.verificationUrl,
            interval: 3000, // 3s
            expiresAt: Date.now() + ((data.expiresIn || 300) * 1000)
        };
        activeDeviceFlows.set(tool, session);
        return session;

    } else if (tool === 'kimi') {
        const res = await fetch(KIMI_CONFIG.deviceCodeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ client_id: KIMI_CONFIG.clientId }),
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

    throw new Error(`Unsupported Device Flow tool: ${tool}`);
  } catch (err) {
    log.error(`Device flow start failed for ${tool}: ${err.message}`);
    throw err;
  }
}

/**
 * Polls the provider token endpoint. Returns 'pending' or 'success'.
 */
export async function pollDeviceFlow(tool) {
  const session = activeDeviceFlows.get(tool);
  if (!session) return { status: 'expired' };
  
  if (Date.now() > session.expiresAt) {
    activeDeviceFlows.delete(tool);
    return { status: 'expired' };
  }

  try {
    let tokens = null;

    if (tool === 'copilot') {
      const res = await fetch(GITHUB_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: GITHUB_CONFIG.clientId,
          device_code: session.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = await res.json();
      if (data.error === 'authorization_pending') return { status: 'pending' };
      if (data.error) throw new Error(data.error_description || data.error);
      
      // We got GitHub token. Must fetch Copilot proxy token now
      const copilotRes = await fetch(GITHUB_CONFIG.copilotTokenUrl, {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
          "User-Agent": GITHUB_CONFIG.userAgent,
        },
      });
      if (!copilotRes.ok) throw new Error("Could not fetch Copilot Token");
      const copilotData = await copilotRes.json();
      
      tokens = { accessToken: copilotData.token, refreshToken: data.refresh_token, source: 'copilot-device' };

    } else if (tool === 'qwen') {
      const res = await fetch(QWEN_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: QWEN_CONFIG.clientId,
          device_code: session.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          code_verifier: session.codeVerifier
        }),
      });
      const data = await res.json();
      if (data.error === 'authorization_pending') return { status: 'pending' };
      if (data.error) throw new Error(data.error_description || data.error);
      tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, source: 'qwen-device' };

    } else if (tool === 'kiro') {
      const res = await fetch(KIRO_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          clientId: session.extra.clientId,
          clientSecret: session.extra.clientSecret,
          deviceCode: session.deviceCode,
          grantType: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      let data = {};
      try { data = await res.json(); } catch { data = { error: 'invalid_response' }; }
      if (data.error === 'authorization_pending' || !data.accessToken) return { status: 'pending' };
      if (data.error) throw new Error(data.error_description || data.message || data.error);
      tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, source: 'kiro-device' };

    } else if (tool === 'kilo') {
      const res = await fetch(`${KILOCODE_CONFIG.pollUrlBase}/${session.deviceCode}`);
      if (res.status === 202) return { status: 'pending' };
      if (res.status === 403) throw new Error('Authorization denied by user');
      if (res.status === 410) throw new Error('Code expired');
      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
      const data = await res.json();
      if (data.status === 'approved' && data.token) {
          tokens = { accessToken: data.token, source: 'kilo-device' };
      } else {
          return { status: 'pending' };
      }
    } else if (tool === 'kimi') {
        const res = await fetch(KIMI_CONFIG.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({
            client_id: KIMI_CONFIG.clientId,
            device_code: session.deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        const data = await res.json();
        if (data.error === 'authorization_pending') return { status: 'pending' };
        if (data.error) throw new Error(data.error_description || data.error);
        tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, source: 'kimi-device' };
    }

    if (tokens) {
      log.info(`✅ Device Flow success for ${tool}`);
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
