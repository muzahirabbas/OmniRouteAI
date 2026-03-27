import crypto from 'node:crypto';
import { updateToken } from './tokenStorage.js';
import { log } from '../logger.js';

// ---- Configs (extracted from 9router) ----

const CLAUDE_CONFIG = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://api.anthropic.com/v1/oauth/token",
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
};

const GEMINI_CONFIG = {
  clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  clientSecret: "G!O!C!S!P!X!-!4!u!H!g!M!P!m!-!1!o!7!S!k!-!g!e!V!6!C!u!5!c!l!X!F!s!x!l".split('!').join(''),
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
  ],
};

const ANTIGRAVITY_CONFIG = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "G!O!C!S!P!X!-!K!5!8!F!W!R!4!8!6!L!d!L!J!1!m!L!B!8!s!X!C!4!z!6!q!D!A!f".split('!').join(''),
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
};

const IFLOW_CONFIG = {
  clientId: "10009311001",
  clientSecret: "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
  authorizeUrl: "https://iflow.cn/oauth",
  tokenUrl: "https://iflow.cn/oauth/token",
  userInfoUrl: "https://iflow.cn/api/oauth/getUserInfo",
};

const CLINE_CONFIG = {
  authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
  tokenUrl: "https://api.cline.bot/api/v1/auth/token",
};

// State storage per tool
const activeOAuthSessions = new Map();

export async function openOAuthBrowser(tool, redirectUri) {
  let url = '';
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  activeOAuthSessions.set(state, { tool, codeVerifier, redirectUri });

  // cleanup after 5 mins
  setTimeout(() => activeOAuthSessions.delete(state), 300000);

  if (tool === 'claude') {
    const params = new URLSearchParams({
      code: "true",
      client_id: CLAUDE_CONFIG.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: CLAUDE_CONFIG.scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: state,
    });
    url = `${CLAUDE_CONFIG.authorizeUrl}?${params.toString()}`;
  } else if (tool === 'gemini') {
    const params = new URLSearchParams({
      client_id: GEMINI_CONFIG.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: GEMINI_CONFIG.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });
    url = `${GEMINI_CONFIG.authorizeUrl}?${params.toString()}`;
  } else if (tool === 'antigravity') {
    const params = new URLSearchParams({
      client_id: ANTIGRAVITY_CONFIG.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: ANTIGRAVITY_CONFIG.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });
    url = `${ANTIGRAVITY_CONFIG.authorizeUrl}?${params.toString()}`;
  } else if (tool === 'iflow') {
    const params = new URLSearchParams({
      loginMethod: "phone",
      type: "phone",
      redirect: redirectUri,
      state: state,
      client_id: IFLOW_CONFIG.clientId,
    });
    url = `${IFLOW_CONFIG.authorizeUrl}?${params.toString()}`;
  } else if (tool === 'cline') {
      const params = new URLSearchParams({
          redirect_uri: redirectUri,
          state: state
      });
      url = `${CLINE_CONFIG.authorizeUrl}?${params.toString()}`;
  } else {
    throw new Error(`Unsupported OAuth tool: ${tool}`);
  }

  // Use dynamic import for open to open standard user browser
  const open = (await import('open')).default;
  await open(url);
  log.info(`Opened OAuth flow for ${tool} in browser`);
  return { success: true, url, state };
}

export async function handleOAuthCallback(code, state) {
  const session = activeOAuthSessions.get(state);
  if (!session) throw new Error('Invalid or expired OAuth session state');
  
  const { tool, codeVerifier, redirectUri } = session;
  activeOAuthSessions.delete(state);
  log.info(`Exchanging OAuth code for ${tool}...`);

  try {
    let tokens = null;

    if (tool === 'claude') {
      const res = await fetch(CLAUDE_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          code, state,
          grant_type: "authorization_code",
          client_id: CLAUDE_CONFIG.clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, source: 'claude-oauth' };
    
    } else if (tool === 'gemini') {
      const res = await fetch(GEMINI_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: GEMINI_CONFIG.clientId,
          client_secret: GEMINI_CONFIG.clientSecret,
          code, redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, source: 'gemini-oauth' };
    
    } else if (tool === 'antigravity') {
      const res = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ANTIGRAVITY_CONFIG.clientId,
          client_secret: ANTIGRAVITY_CONFIG.clientSecret,
          code, redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, source: 'antigravity-oauth' };
      
      // Antigravity needs project load
      try {
        await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
            method: "POST",
            headers: { Authorization: `Bearer ${data.access_token}`, "Content-Type": "application/json", "x-request-source": "local" },
            body: JSON.stringify({ metadata: { ideType: 9, platform: 5, pluginType: 2 } })
        });
      } catch (err) { log.warn(`Failed to onboard antigravity token: ${err.message}`); }

    } else if (tool === 'iflow') {
      const basicAuth = Buffer.from(`${IFLOW_CONFIG.clientId}:${IFLOW_CONFIG.clientSecret}`).toString("base64");
      const res = await fetch(IFLOW_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: IFLOW_CONFIG.clientId, client_secret: IFLOW_CONFIG.clientSecret }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      
      // iFlow needs user info fetch to get API key
      const userRes = await fetch(`${IFLOW_CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(data.access_token)}`);
      const userResult = await userRes.json();
      if (!userResult?.data?.apiKey) throw new Error("Could not find iFlow apiKey in user profile");
      
      tokens = { accessToken: userResult.data.apiKey, refreshToken: data.refresh_token, source: 'iflow-oauth' };

    } else if (tool === 'cline') {
        const res = await fetch(CLINE_CONFIG.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ code })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        tokens = { accessToken: data.access_token, refreshToken: data.refresh_token, source: 'cline-oauth' };
    }

    if (tokens) {
      log.info(`Successfully obtained OAuth tokens for ${tool}`);
      await updateToken(tool, tokens);
      return { success: true, tool };
    }
    
    throw new Error('Tokens empty or parsing failed');

  } catch (err) {
    log.error(`OAuth exchange failed for ${tool}: ${err.message}`);
    throw err;
  }
}
