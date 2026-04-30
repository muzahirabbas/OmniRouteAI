import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.omniroute', 'local-cli');
const TOKEN_FILE = () => join(CONFIG_DIR, 'token.txt');

let _token = null;

export async function loadToken() {
  if (_token) return _token;

  const tokenFile = TOKEN_FILE();
  const dir = CONFIG_DIR;

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

export async function validateToken(headerValue) {
  const expected = await loadToken();
  if (!headerValue) return false;
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
