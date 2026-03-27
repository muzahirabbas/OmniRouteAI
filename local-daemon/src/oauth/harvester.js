import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../logger.js';
import { updateToken } from './tokenStorage.js';
import chokidar from 'chokidar';

/**
 * Token Harvester — Scans local machine for existing CLI/IDE sessions.
 */

const IS_WIN = process.platform === 'win32';

export async function harvestTokens() {
  const tasks = {
    claude:   harvestClaude(),
    cursor:   harvestCursor(),
    gcloud:   harvestGCloud(),
    qwen:     harvestQwen(),
    zai:      harvestZai(),
    cline:    harvestCline(),
    opencode: harvestOpencode(),
    kilo:     harvestKilo(),
    copilot:  harvestCopilot(),
    kimi:     harvestKimi(),
  };

  const results = {};
  for (const [key, promise] of Object.entries(tasks)) {
    try {
      const token = await promise;
      if (token) {
        results[key] = token;
        await updateToken(key, token);
      }
    } catch (err) {
      log.error(`Harvest failed for ${key}: ${err.message}`);
    }
  }

  const found = Object.keys(results);
  log.info(`Token harvest completed. Found sessions for: ${found.join(', ') || 'none'}`);

  return results;
}

/**
 * Watch for changes in CLI config files and re-harvest automatically.
 */
export function watchTokenFiles() {
  const paths = [
    // Claude
    join(homedir(), '.config', 'claude-cli', 'config.json'),
    join(process.env.APPDATA || '', 'claude-cli', 'config.json'),
    // Qwen
    join(homedir(), '.qwen', 'oauth_creds.json'),
    join(homedir(), '.qwen', 'settings.json'),
    // Zai
    join(homedir(), '.zai', 'user-settings.json'),
    // Cline
    join(homedir(), '.cline', 'data', 'secrets.json'),
    // Copilot
    join(homedir(), '.copilot', 'config.json'),
    join(homedir(), IS_WIN ? 'AppData/Roaming/gh/hosts.yml' : '.config/gh/hosts.yml'),
    // Kimi
    join(homedir(), '.kimi', 'config.toml'),
  ].filter(p => !!p && existsSync(p));

  const watcher = chokidar.watch(paths, { ignoreInitial: true, persistent: true });

  watcher.on('change', async (path) => {
    log.info(`Token file changed: ${path}. Re-harvesting...`);
    await harvestTokens(); 
  });

  return watcher;
}

// ─── Individual Harvesters ───────────────────────────────────────────

async function harvestClaude() {
  const configPath = IS_WIN 
    ? join(process.env.APPDATA || '', 'claude-cli', 'config.json')
    : join(homedir(), '.config', 'claude-cli', 'config.json');

  if (!existsSync(configPath)) return null;

  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    if (config.oauth_token?.refresh_token || config.access_token) {
      return {
        accessToken:  config.access_token,
        refreshToken: config.oauth_token?.refresh_token,
        expiresAt:    config.oauth_token?.expires_at,
        source:       'claude-cli'
      };
    }
  } catch {}
  return null;
}

async function harvestCursor() {
  const storagePath = IS_WIN
    ? join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'storage.json')
    : join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'storage.json');

  if (!existsSync(storagePath)) return null;

  try {
    const data = JSON.parse(await readFile(storagePath, 'utf8'));
    const token = data['cursorAuth/accessToken'];
    if (token) {
      return {
        accessToken: token.replace(/^"|"$/g, ''),
        source:      'cursor-ide'
      };
    }
  } catch {}
  return null;
}

async function harvestGCloud() {
  const configDir = join(homedir(), IS_WIN ? 'AppData/Roaming/gcloud' : '.config/gcloud');
  const dbPath = join(configDir, 'access_tokens.db');
  if (existsSync(dbPath)) {
    return { type: 'gcloud-session', path: configDir, source: 'gcloud-cli' };
  }
  return null;
}

async function harvestQwen() {
  const oauthPath = join(homedir(), '.qwen', 'oauth_creds.json');
  if (existsSync(oauthPath)) {
    try {
      const data = JSON.parse(await readFile(oauthPath, 'utf8'));
      return {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresAt:    data.expires_at,
        source:       'qwen-cli'
      };
    } catch {}
  }
  return null;
}

async function harvestZai() {
  const path = join(homedir(), '.zai', 'user-settings.json');
  if (existsSync(path)) {
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      if (data.apiKey) return { accessToken: data.apiKey, source: 'zai-cli' };
    } catch {}
  }
  return null;
}

async function harvestCline() {
  const path = join(homedir(), '.cline', 'data', 'secrets.json');
  if (existsSync(path)) {
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      const key = data.anthropicApiKey || data.openAiApiKey || data.geminiApiKey;
      if (key) return { accessToken: key, source: 'cline-data', allKeys: data };
    } catch {}
  }
  return null;
}

async function harvestOpencode() {
  const path = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
  if (existsSync(path)) {
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      return { accessToken: 'managed-by-opencode', providers: data.providers, source: 'opencode-cli' };
    } catch {}
  }
  return null;
}

async function harvestKilo() {
  const path = join(homedir(), '.config', 'kilo', 'opencode.json');
  if (existsSync(path)) {
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      return { accessToken: 'managed-by-kilo', config: data, source: 'kilo-cli' };
    } catch {}
  }
  return null;
}

async function harvestCopilot() {
  const paths = [
    join(homedir(), '.copilot', 'config.json'),
    join(homedir(), IS_WIN ? 'AppData/Roaming/gh/hosts.yml' : '.config/gh/hosts.yml')
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = await readFile(p, 'utf8');
        if (p.endsWith('.json')) {
          const data = JSON.parse(raw);
          if (data.oauth_token) return { accessToken: data.oauth_token, source: 'copilot-standalone' };
        } else {
          // Parse simple YAML hosts.yml for github.com: oauth_token: ...
          const match = raw.match(/github\.com:\s+oauth_token:\s+([a-zA-Z0-9_]+)/);
          if (match) return { accessToken: match[1], source: 'gh-cli' };
        }
      } catch {}
    }
  }
  return null;
}

async function harvestKimi() {
  const path = join(homedir(), '.kimi', 'config.toml');
  if (existsSync(path)) {
    return { type: 'kimi-session', path: join(homedir(), '.kimi'), source: 'kimi-cli' };
  }
  return null;
}
