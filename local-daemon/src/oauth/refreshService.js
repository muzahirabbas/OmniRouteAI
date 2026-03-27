import { OAUTH_PROVIDERS } from './providers.js';
import { updateToken, getTokens } from './tokenStorage.js';
import { log } from '../logger.js';

/**
 * Refresh service to manage OAuth session lifecycles.
 */

export async function refreshIfNeeded(provider) {
  const tokens = await getTokens(provider);
  if (!tokens || !tokens.refreshToken) return null;

  // Basic check: refresh if updated > 50 mins ago (standard 1h expiry)
  const lastUpdate = new Date(tokens.updatedAt).getTime();
  const now = Date.now();
  if (now - lastUpdate < 50 * 60 * 1000) {
    return tokens.accessToken;
  }

  log.info(`Refreshing ${provider} token...`);
  const refreshed = await performRefresh(provider, tokens.refreshToken);
  if (refreshed) {
    await updateToken(provider, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || tokens.refreshToken,
      expiresIn: refreshed.expiresIn
    });
    return refreshed.accessToken;
  }
  return tokens.accessToken; // Fallback to old token if refresh fails
}

async function performRefresh(provider, refreshToken) {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return null;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId
    });
    
    if (config.clientSecret) {
      body.append('client_secret', config.clientSecret);
    }

    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error(`Failed to refresh ${provider} token: ${errText}`);
      return null;
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  } catch (err) {
    log.error(`Network error during ${provider} refresh: ${err.message}`);
    return null;
  }
}
