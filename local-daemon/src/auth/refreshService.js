import { getStoredToken, updateToken } from './tokenStore.js';
import { log } from '../core/logger.js';
import { getProvider } from '../core/registry.js';

const TOKEN_EXPIRY_BUFFER = 60_000;

export async function refreshTokenIfNeeded(providerId) {
  const tokenData = await getStoredToken(providerId);
  if (!tokenData) return null;

  if (tokenData.accessToken && !tokenData.refreshToken) {
    return tokenData.accessToken;
  }

  const isExpired = isTokenExpired(tokenData);
  const isCopilotHostToken = providerId === 'copilot' && !tokenData.accessToken.startsWith('tid=');

  if (!isExpired && !isCopilotHostToken) {
    return tokenData.accessToken;
  }

  if (!tokenData.refreshToken) {
    log.warn(`Token for ${providerId} is expired and has no refresh token`);
    return tokenData.accessToken;
  }

  log.info(`Refreshing token for ${providerId}...`);
  
  if (providerId === 'copilot') {
    const chatToken = await performCopilotTokenSwap(tokenData.accessToken);
    if (chatToken) {
      await updateToken(providerId, {
        accessToken: chatToken,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() // Copilot tokens last ~25 min
      });
      return chatToken;
    }
    return tokenData.accessToken;
  }
  
  const refreshed = await performRefresh(providerId, tokenData.refreshToken);
  
  if (refreshed) {
    await updateToken(providerId, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || tokenData.refreshToken,
      expiresAt: refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : null,
    });
    return refreshed.accessToken;
  }

  return tokenData.accessToken;
}

function isTokenExpired(tokenData) {
  if (tokenData.expiresAt) {
    return Date.now() >= new Date(tokenData.expiresAt).getTime() - TOKEN_EXPIRY_BUFFER;
  }

  if (tokenData.expiresIn) {
    const expiresMs = tokenData.expiresIn * 1000;
    const issuedAt = tokenData.updatedAt ? new Date(tokenData.updatedAt).getTime() : Date.now() - 60000;
    return Date.now() >= issuedAt + expiresMs - TOKEN_EXPIRY_BUFFER;
  }

  if (tokenData.updatedAt) {
    const updatedAt = new Date(tokenData.updatedAt).getTime();
    return Date.now() - updatedAt >= 50 * 60 * 1000;
  }

  return false;
}

async function performRefresh(providerId, refreshToken) {
  const provider = getProvider(providerId);
  if (!provider) return null;

  const oauthConfig = provider.oauthConfig || provider.deviceFlowConfig;
  if (!oauthConfig || !oauthConfig.tokenUrl) {
    log.warn(`No refresh config for ${providerId}`);
    return null;
  }

  try {
    let body;
    const params = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    if (oauthConfig.clientId) {
      params.client_id = oauthConfig.clientId;
    }

    if (oauthConfig.clientSecret && ['gemini', 'antigravity'].includes(providerId)) {
      params.client_secret = oauthConfig.clientSecret;
    }

    const isJson = ['claude', 'cline', 'codex'].includes(providerId);
    const res = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: isJson ? JSON.stringify(params) : new URLSearchParams(params).toString()
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`Token refresh failed for ${providerId}: ${errText}`);
      return null;
    }

    const data = await res.json();
    
    if (!data.refresh_token && ['gemini', 'antigravity'].includes(providerId)) {
      log.warn(`Refresh for ${providerId} did not return a new rotation token. Future refreshes may fail.`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (err) {
    log.error(`Network error during ${providerId} refresh: ${err.message}`);
    return null;
  }
}
async function performCopilotTokenSwap(hostToken) {
  try {
    log.info('Exchanging GitHub host token for short-lived Copilot session token...');
    const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        'Authorization': `token ${hostToken}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      const err = await res.text();
      log.warn(`Copilot token exchange failed: ${err}`);
      return null;
    }

    const data = await res.json();
    return data.token;
  } catch (err) {
    log.error(`Copilot exchange error: ${err.message}`);
    return null;
  }
}
