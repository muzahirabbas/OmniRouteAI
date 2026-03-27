import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';
import { getConfigDir } from '../config.js';
import { log } from '../logger.js';
import { homedir } from 'node:os';

/**
 * Encrypted token storage for OAuth sessions.
 * Stores to ~/.omniroute/local-cli/tokens.json
 */

const TOKENS_FILE = join(getConfigDir(), 'tokens.json');

// Simple machine-specific key derivation for encryption
const ALGORITHM = 'aes-256-cbc';
const SECRET    = scryptSync(homedir() + process.platform + process.arch, 'omniroute-salt', 32);

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
    
    await writeFile(TOKENS_FILE, data, 'utf8');
  } catch (err) {
    log.error(`Failed to save encrypted tokens: ${err.message}`);
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
    log.error(`Failed to load/decrypt tokens: ${err.message}. File might be corrupted or key changed.`);
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

export async function getTokens(provider) {
  const tokens = await loadTokens();
  return tokens[provider] || null;
}
