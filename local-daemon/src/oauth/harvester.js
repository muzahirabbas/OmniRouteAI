import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../logger.js';

/**
 * Token Harvester — Scans local machine for existing CLI/IDE sessions.
 * 
 * Sources:
 * 1. Claude CLI (~/.config/claude-cli/config.json)
 * 2. Cursor IDE (App Data / Local Storage)
 * 3. GCloud (access_tokens.db)
 * 4. Qwen CLI
 */

const IS_WIN = process.platform === 'win32';

export async function harvestTokens() {
  const results = {
    claude: await harvestClaude(),
    cursor: await harvestCursor(),
    gcloud: await harvestGCloud(),
    // Add more as needed
  };

  const found = Object.entries(results).filter(([_, v]) => !!v).map(([k]) => k);
  log.info(`Token harvest completed. Found sessions for: ${found.join(', ') || 'none'}`);

  return results;
}

/**
 * Harvest Claude CLI tokens
 */
async function harvestClaude() {
  const configPath = IS_WIN 
    ? join(process.env.APPDATA || '', 'claude-cli', 'config.json')
    : join(homedir(), '.config', 'claude-cli', 'config.json');

  if (!existsSync(configPath)) return null;

  try {
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    
    // Check for both direct token and oauth session
    if (config.oauth_token?.refresh_token || config.access_token) {
      return {
        accessToken: config.access_token,
        refreshToken: config.oauth_token?.refresh_token,
        expiresAt: config.oauth_token?.expires_at,
        source: 'claude-cli'
      };
    }
  } catch (err) {
    log.error(`Failed to harvest Claude token: ${err.message}`);
  }
  return null;
}

/**
 * Harvest Cursor tokens from Local Storage
 * Based on 9router's cursor auto-import logic
 */
async function harvestCursor() {
  const storagePaths = IS_WIN
    ? [join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'storage.json')]
    : [
        join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'storage.json'),
        join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'storage.json')
      ];

  for (const path of storagePaths) {
    if (!existsSync(path)) continue;

    try {
      const raw = await readFile(path, 'utf8');
      const data = JSON.parse(raw);
      
      const accessToken = data['cursorAuth/accessToken'];
      if (accessToken) {
        return {
          accessToken: accessToken.replace(/^"|"$/g, ''), // Clean JSON-wrapped strings
          source: 'cursor-ide'
        };
      }
    } catch (err) {
      log.error(`Failed to harvest Cursor token from ${path}: ${err.message}`);
    }
  }
  return null;
}

/**
 * Harvest GCloud (Gemini/Vertex) tokens
 */
async function harvestGCloud() {
  const gcloudDir = join(homedir(), IS_WIN ? 'AppData/Roaming/gcloud' : '.config/gcloud');
  const dbPath = join(gcloudDir, 'access_tokens.db');
  
  // Note: This is a SQLite DB. In a real robust impl, we'd use 'sqlite3'
  // For the MVP, we check for credentials.db or environment vars
  const legacyCreds = join(gcloudDir, 'credentials.db');
  
  if (existsSync(dbPath) || existsSync(legacyCreds)) {
    return {
      type: 'gcloud-session',
      path: gcloudDir,
      source: 'gcloud-cli'
    };
  }
  return null;
}
