import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../logger.js';
import { updateToken } from './tokenStorage.js';
import chokidar from 'chokidar';

/**
 * Token Harvester — Scans local machine for existing CLI/IDE sessions.
 * Paths are researched from official docs and known config locations.
 */

const HOME    = homedir();
const IS_WIN  = process.platform === 'win32';
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');

export async function harvestTokens() {
  const tasks = {
    claude:   harvestClaude(),
    gemini:   harvestGemini(),
    qwen:     harvestQwen(),
    zai:      harvestZai(),
    cline:    harvestCline(),
    opencode: harvestOpencode(),
    kilo:     harvestKilo(),
    copilot:  harvestCopilot(),
    kimi:     harvestKimi(),
    codex:    harvestCodex(),
    grok:     harvestGrok(),
    kiro:     harvestKiro(),
    cursor:   harvestCursor(),
    iflow:    harvestIFlow(),
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
  log.info(`Token harvest complete. Found: ${found.join(', ') || 'none'}`);
  return results;
}

/**
 * Watch for changes in CLI config files and re-harvest automatically.
 */
export function watchTokenFiles() {
  // Watch entire dirs so new files created post-login are also caught
  const dirs = [
    join(HOME, '.claude'),
    join(HOME, '.gemini'),
    join(HOME, '.qwen'),
    join(HOME, '.zai'),
    join(HOME, '.grok'),
    join(HOME, '.codex'),
    join(HOME, '.kimi'),
    join(HOME, '.kiro'),
    join(HOME, '.aws'),
    join(HOME, '.local', 'share', 'opencode'),
    join(HOME, '.config', 'kilo'),
    join(HOME, '.config', 'gh'),
    join(APPDATA, 'gh'),
    join(APPDATA, 'Code', 'User', 'globalStorage'),    // VS Code (Cline)
    join(LOCALAPPDATA, 'cursor-nightly', 'User', 'globalStorage'), // Cursor
    join(HOME, '.iflow'),
  ].filter(p => !!p);

  const watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    persistent:    true,
    depth:         2,
    ignored:       /(^|[/\\])\../, // ignore hidden files EXCEPT we need hidden dirs
  });

  watcher.on('change', async (path) => {
    log.info(`Config file changed: ${path}. Re-harvesting...`);
    await harvestTokens();
  });
  watcher.on('add', async (path) => {
    log.info(`New config file detected: ${path}. Re-harvesting...`);
    await harvestTokens();
  });

  return watcher;
}

// ─── Harvesters ───────────────────────────────────────────────────────

// Claude Code: ~/.claude/.credentials.json  (official path from Anthropic docs)
async function harvestClaude() {
  const paths = [
    join(HOME, '.claude', '.credentials.json'),
    join(HOME, '.claude', 'settings.json'),
    ...(IS_WIN ? [join(APPDATA, 'Claude', 'claude_desktop_config.json')] : []),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(await readFile(p, 'utf8'));
      // .credentials.json stores OAuth tokens
      const token = data.oauth_token || data.access_token || data.claudeAiOauth?.accessToken;
      if (token) return { accessToken: token, refreshToken: data.refresh_token, source: 'claude-cli' };
    } catch {}
  }
  return null;
}

// Gemini CLI: ~/.gemini/settings.json
async function harvestGemini() {
  const paths = [
    join(HOME, '.gemini', 'settings.json'),
    join(HOME, '.gemini', '.env'),
    join(HOME, '.config', 'gemini-cli', 'config.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = await readFile(p, 'utf8');
      if (p.endsWith('.env')) {
        const match = raw.match(/GEMINI_API_KEY=([^\s]+)/);
        if (match) return { accessToken: match[1], source: 'gemini-env' };
      } else {
        const data = JSON.parse(raw);
        const key = data.apiKey || data.geminiApiKey || data.access_token;
        if (key) return { accessToken: key, source: 'gemini-cli' };
      }
    } catch {}
  }
  return null;
}

// Qwen: ~/.qwen/oauth_creds.json or settings.json
async function harvestQwen() {
  const oauthPath   = join(HOME, '.qwen', 'oauth_creds.json');
  const settingPath = join(HOME, '.qwen', 'settings.json');
  if (existsSync(oauthPath)) {
    try {
      const data = JSON.parse(await readFile(oauthPath, 'utf8'));
      if (data.access_token) return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at, source: 'qwen-oauth' };
    } catch {}
  }
  if (existsSync(settingPath)) {
    try {
      const data = JSON.parse(await readFile(settingPath, 'utf8'));
      const key = data.apiKey || data.access_token;
      if (key) return { accessToken: key, source: 'qwen-settings' };
    } catch {}
  }
  return null;
}

// Zai: ~/.zai/user-settings.json
async function harvestZai() {
  const p = join(HOME, '.zai', 'user-settings.json');
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(await readFile(p, 'utf8'));
    const key = data.apiKey || data.token || data.accessToken;
    if (key) return { accessToken: key, source: 'zai-cli' };
  } catch {}
  return null;
}

// Cline (VS Code Extension): uses VS Code Secret Storage (encrypted in OS keychain)
// Best we can do: check VS Code global state DB for the presence of credentials
async function harvestCline() {
  const vscodeStatePaths = [
    join(APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
    join(HOME, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
    join(HOME, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
    // Fallback: cline's own data dir if it stores anything there
    join(HOME, '.cline', 'data', 'secrets.json'),
  ];
  for (const p of vscodeStatePaths) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(await readFile(p, 'utf8'));
      // Cline stores apiKey in its MCP settings
      if (data) return { accessToken: 'vscode-managed', config: data, source: 'cline-vscode' };
    } catch {}
  }
  return null;
}

// OpenCode: ~/.local/share/opencode/auth.json
async function harvestOpencode() {
  const paths = [
    join(HOME, '.local', 'share', 'opencode', 'auth.json'),
    join(APPDATA, 'opencode', 'auth.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(await readFile(p, 'utf8'));
      if (data) return { accessToken: 'managed-by-opencode', providers: data.providers, source: 'opencode-cli' };
    } catch {}
  }
  return null;
}

// Kilo: ~/.config/kilo/opencode.json
async function harvestKilo() {
  const p = join(HOME, '.config', 'kilo', 'opencode.json');
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(await readFile(p, 'utf8'));
    if (data) return { accessToken: 'managed-by-kilo', config: data, source: 'kilo-cli' };
  } catch {}
  return null;
}

// GitHub Copilot: ~/.config/gh/hosts.yml (via GitHub gh CLI)
async function harvestCopilot() {
  const hostsYml = IS_WIN
    ? join(APPDATA, 'GitHub CLI', 'hosts.yml')
    : join(HOME, '.config', 'gh', 'hosts.yml');

  if (existsSync(hostsYml)) {
    try {
      const raw = await readFile(hostsYml, 'utf8');
      // Parse Token from hosts.yml: github.com:\n  oauth_token: gho_xxx
      const match = raw.match(/oauth_token:\s*([^\s\r\n]+)/);
      if (match?.[1]) return { accessToken: match[1], source: 'gh-cli' };
    } catch {}
  }
  return null;
}

// Kimi: ~/.kimi/config.toml or ~/.kimi/config.json
async function harvestKimi() {
  const paths = [
    join(HOME, '.kimi', 'config.json'),
    join(HOME, '.kimi', 'config.toml'),
    join(HOME, '.kimi', 'settings.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = await readFile(p, 'utf8');
      if (p.endsWith('.json')) {
        const data = JSON.parse(raw);
        const key = data.apiKey || data.token || data.access_token;
        if (key) return { accessToken: key, source: 'kimi-cli' };
      } else {
        // TOML: api_key = "..."
        const match = raw.match(/api_key\s*=\s*"([^"]+)"/);
        if (match?.[1]) return { accessToken: match[1], source: 'kimi-toml' };
      }
    } catch {}
  }
  return null;
}

// Codex CLI (OpenAI): ~/.codex/auth.json
async function harvestCodex() {
  const p = join(HOME, '.codex', 'auth.json');
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(await readFile(p, 'utf8'));
    const key = data.apiKey || data.openAiApiKey || data.token;
    if (key) return { accessToken: key, source: 'codex-cli' };
  } catch {}
  return null;
}

// Grok (xAI): ~/.grok/user-settings.json
async function harvestGrok() {
  const paths = [
    join(HOME, '.grok', 'user-settings.json'),
    join(HOME, '.config', 'grok-cli', 'config.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(await readFile(p, 'utf8'));
      const key = data.apiKey || data.xaiApiKey || data.grokApiKey || data.token;
      if (key) return { accessToken: key, source: 'grok-cli' };
    } catch {}
  }
  return null;
}

// Kiro (AWS IDE): uses ~/.aws/credentials
async function harvestKiro() {
  const p = join(HOME, '.aws', 'credentials');
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, 'utf8');
    // Check for kiro-specific profile or default profile
    if (raw.includes('[') && raw.includes('aws_access_key_id')) {
      return { accessToken: 'aws-managed', source: 'kiro-aws' };
    }
  } catch {}
  return null;
}

// Cursor IDE: %APPDATA%\Cursor\User\globalStorage\storage.json
async function harvestCursor() {
  const paths = [
    join(APPDATA, 'Cursor', 'User', 'globalStorage', 'storage.json'),
    join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'storage.json'),
    join(HOME, '.config', 'Cursor', 'User', 'globalStorage', 'storage.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(await readFile(p, 'utf8'));
      const token = data['cursorAuth/accessToken'] || data['cursor.auth.accessToken'];
      if (token) return { accessToken: String(token).replace(/^\"|\"$/g, ''), source: 'cursor-ide' };
    } catch {}
  }
  return null;
}

// iFlow: ~/.iflow/auth.json
async function harvestIFlow() {
  const p = join(HOME, '.iflow', 'auth.json');
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(await readFile(p, 'utf8'));
    const token = data.access_token || data.token || data.accessToken;
    if (token) return { accessToken: token, refreshToken: data.refresh_token, source: 'iflow-cli' };
  } catch {}
  return null;
}
