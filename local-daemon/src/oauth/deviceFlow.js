import { log } from '../logger.js';
import { updateToken } from './tokenStorage.js';
import { OAUTH_PROVIDERS } from './providers.js';

/**
 * Manages OAuth Device Authorization Flow for providers.
 */

const PENDING_FLOWS = new Map();

export async function startDeviceFlow(provider) {
  const config = OAUTH_PROVIDERS[provider];
  if (!config || !config.tokenUrl) return null;

  // GitHub vs. others may use different device auth URLs
  const deviceAuthUrl = provider === 'copilot' 
    ? 'https://github.com/login/device/code'
    : provider === 'qwen'
    ? 'https://chat.qwen.ai/api/v1/oauth2/device/code'
    : config.tokenUrl.replace('token', 'device/code');

  try {
    const res = await fetch(deviceAuthUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json' 
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: provider === 'copilot' ? 'read:user,user:email' : 'openid,profile,email,chat'
      })
    });

    if (!res.ok) {
      const err = await res.text();
      log.error(`Device flow start failed for ${provider}: ${err}`);
      return null;
    }

    const data = await res.json();
    // { device_code, user_code, verification_uri, expires_in, interval }
    
    PENDING_FLOWS.set(provider, {
      provider,
      deviceCode: data.device_code,
      interval: (data.interval || 5) * 1000,
      expiresAt: Date.now() + (data.expires_in * 1000)
    });

    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri || data.verification_url,
      expiresIn: data.expires_in
    };
  } catch (err) {
    log.error(`Device flow error for ${provider}: ${err.message}`);
    return null;
  }
}

export async function pollDeviceFlow(provider) {
  const flow = PENDING_FLOWS.get(provider);
  if (!flow) return { error: 'No active login flow' };
  
  if (Date.now() > flow.expiresAt) {
    PENDING_FLOWS.delete(provider);
    return { error: 'Login invitation expired' };
  }

  const config = OAUTH_PROVIDERS[provider];

  try {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json' 
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: flow.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    const data = await res.json();

    if (data.error === 'authorization_pending') {
      return { status: 'pending' };
    }

    if (data.access_token) {
      PENDING_FLOWS.delete(provider);
      await updateToken(provider, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
        source: 'device-flow'
      });
      return { status: 'success', accessToken: data.access_token };
    }

    return { error: data.error_description || data.error || 'Unknown polling error' };

  } catch (err) {
    return { error: err.message };
  }
}
