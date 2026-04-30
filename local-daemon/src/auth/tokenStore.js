import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { log } from '../core/logger.js';

const CONFIG_DIR = join(homedir(), '.omniroute', 'local-cli');
const TOKENS_FILE = join(CONFIG_DIR, 'tokens.json');

const ALGORITHM = 'aes-256-cbc';
const SECRET = scryptSync(homedir() + process.platform + process.arch, 'omniroute-salt', 32);

let _tokenCache = null;

export async function saveTokens(tokens) {
  _tokenCache = tokens;
  try {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, SECRET, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);

    const data = JSON.stringify({
      iv: iv.toString('hex'),
      data: encrypted.toString('hex')
    });

    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(TOKENS_FILE, data, 'utf8');
    _tokenCache = tokens; // Update cache after successful write
  } catch (err) {
    log.error(`Failed to save encrypted tokens: ${err.message}`);
    // Optionally clear cache on failure to force reload
    _tokenCache = null;
  }
}

export async function loadTokens() {
  if (_tokenCache) return _tokenCache;
  if (!existsSync(TOKENS_FILE)) return {};

  try {
    const raw = await readFile(TOKENS_FILE, 'utf8');
    const { iv, data } = JSON.parse(raw);

    const decipher = createDecipheriv(ALGORITHM, SECRET, Buffer.from(iv, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);

    _tokenCache = JSON.parse(decrypted.toString());
    return _tokenCache;
  } catch (err) {
    log.error(`Failed to load/decrypt tokens: ${err.message}`);
    return {};
  }
}

export async function updateToken(provider, tokenData) {
  const tokens = await loadTokens();
  tokens[provider] = {
    ...tokens[provider],
    ...tokenData,
    updatedAt: new Date().toISOString()
  };
  await saveTokens(tokens);
  return tokens[provider];
}

export async function getStoredToken(provider) {
  const tokens = await loadTokens();
  return tokens[provider] || null;
}

export async function deleteToken(provider) {
  const tokens = await loadTokens();
  delete tokens[provider];
  await saveTokens(tokens);
}

export async function forceReloadTokens() {
  _tokenCache = null;
  return loadTokens();
}
