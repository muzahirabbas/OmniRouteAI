import { OAUTH_PROVIDERS } from './providers.js';
import { updateToken, getTokens } from './tokenStorage.js';
import { log } from '../logger.js';

/**
 * Refresh service to manage OAuth session lifecycles.
 */

export async function refreshIfNeeded(provider) {
  const tokens = await getTokens(provider);
  if (!tokens || (!tokens.refreshToken && !tokens.accessToken)) return null;

  // No refresh needed if it's a plain API key (like zai or harvested cline)
  if (!tokens.refreshToken && tokens.accessToken) return tokens.accessToken;

  // Prefer the actual expiry; fall back to 50-min heuristic
  let isExpired;
  if (tokens.expiresAt) {
    isExpired = Date.now() >= new Date(tokens.expiresAt).getTime() - 60_000;
  } else {
    const updatedAt = tokens.updatedAt ? new Date(tokens.updatedAt).getTime() : 0;
    isExpired = Date.now() - updatedAt >= 50 * 60 * 1000;
  }

  if (!isExpired) {
    return tokens.accessToken;
  }

  log.info(`Refreshing ${provider} token...`);
  const refreshed = await performRefresh(provider, tokens.refreshToken);
  if (refreshed) {
    await updateToken(provider, {
      accessToken:  refreshed.accessToken,
      refreshToken: refreshed.refreshToken || tokens.refreshToken,
      expiresAt:    refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : null,
    });
    return refreshed.accessToken;
  }
  return tokens.accessToken; 
}

async function performRefresh(provider, refreshToken) {
  const config = OAUTH_PROVIDERS[provider];
  if (!config || !config.refreshUrl) return null;

  try {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     config.clientId
    });
    
    if (config.clientSecret) {
      body.append('client_secret', config.clientSecret);
    }

    const res = await fetch(config.refreshUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':       'application/json'
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
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresIn:    data.expires_in
    };
  } catch (err) {
    log.error(`Network error during ${provider} refresh: ${err.message}`);
    return null;
  }
}
