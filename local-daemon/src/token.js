import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

/**
 * Local auth token manager.
 *
 * On first run: generates a cryptographically random 32-byte token,
 * stores it in ~/.omniroute/local-cli/token.txt
 *
 * All incoming HTTP requests must include the header:
 *   X-Local-Token: <token>
 *
 * The main OmniRouteAI backend reads this token from:
 *   LOCAL_DAEMON_TOKEN env var (set in the main app's .env)
 *
 * Token never changes between restarts once created.
 */

const TOKEN_FILE = () => join(getConfigDir(), 'token.txt');

let _token = null;

/**
 * Load or generate the daemon auth token.
 * @returns {Promise<string>}
 */
export async function loadToken() {
  if (_token) return _token;

  const tokenFile = TOKEN_FILE();
  const dir       = getConfigDir();

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  if (existsSync(tokenFile)) {
    _token = (await readFile(tokenFile, 'utf8')).trim();
  } else {
    _token = randomBytes(32).toString('hex');
    await writeFile(tokenFile, _token, 'utf8');
    console.log(`[token] Generated new daemon token. Stored at: ${tokenFile}`);
    console.log(`[token] Set LOCAL_DAEMON_TOKEN=${_token} in your main OmniRouteAI .env`);
  }

  return _token;
}

/**
 * Validate the X-Local-Token header on an incoming request.
 * @param {string} headerValue
 * @returns {Promise<boolean>}
 */
export async function validateToken(headerValue) {
  const expected = await loadToken();
  if (!headerValue) return false;
  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(expected, headerValue);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function getTokenFilePath() { return TOKEN_FILE(); }
