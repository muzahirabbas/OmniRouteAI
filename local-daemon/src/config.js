import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Config manager for OmniRouteAI Local Daemon.
 *
 * Config file location: ~/.omniroute/local-cli/config.json
 *
 * Contains CLI paths, port, tool enable/disable, environment vars.
 */

const CONFIG_DIR  = join(homedir(), '.omniroute', 'local-cli');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  port: 5059,
  host: '127.0.0.1', // Only localhost — never exposed remotely
  logLevel: 'info',

  // Per-tool configuration
  tools: {
    claude: {
      enabled:  true,
      command:  'claude',       // or full path: 'C:/Users/.../claude.exe'
      args:     [],             // extra default args
      timeout:  300000,          // ms, default 60s for long responses
      env:      {},             // extra env vars to inject
      authCmd:  'claude auth',  // command to check/run auth
    },
    gemini: {
      enabled:  true,
      command:  'gemini',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'gemini auth',
    },
    qwen: {
      enabled:  true,
      command:  'qwen',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'qwen',
    },
    antigravity: {
      enabled:  true,
      command:  'antigravity',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'antigravity auth login',
    },
    kilo: {
      enabled:  true,
      command:  'kilo',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'kilo auth',
    },
    opencode: {
      enabled:  true,
      command:  'opencode',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'opencode auth login',
    },
    codex: {
      enabled:  true,
      command:  'codex',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'codex login',
    },
    kiro: {
      enabled:  true,
      command:  'kiro-cli',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'kiro-cli auth',
    },
    grok: {
      enabled:  true,
      command:  'grok',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  null,
    },
    copilot: {
      enabled:  true,
      command:  'copilot',
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  'gh auth login --web -h github.com',
    },
    custom: {
      enabled:  true,
      command:  null,   // Must be set by user
      args:     [],
      timeout:  300000,
      env:      {},
      authCmd:  null,
    },
  },
};

let _config = null;

/**
 * Load config from disk, creating defaults if missing.
 * @returns {Promise<object>}
 */
export async function loadConfig() {
  if (_config) return _config;

  try {
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }

    if (!existsSync(CONFIG_PATH)) {
      await writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
      _config = structuredClone(DEFAULT_CONFIG);
    } else {
      const raw = await readFile(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      // Deep merge user config over defaults
      _config = deepMerge(DEFAULT_CONFIG, parsed);
    }
  } catch (err) {
    console.error(`[config] Failed to load config: ${err.message} — using defaults`);
    _config = structuredClone(DEFAULT_CONFIG);
  }

  return _config;
}

/**
 * Save current config to disk.
 * @param {object} updates - partial config to merge
 */
export async function saveConfig(updates) {
  _config = deepMerge(_config || DEFAULT_CONFIG, updates);
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf8');
  return _config;
}

/**
 * Get a tool config, patched with real resolved commands.
 * @param {string} toolName
 * @returns {object|null}
 */
export async function getToolConfig(toolName) {
  const config = await loadConfig();
  return config.tools?.[toolName] || null;
}

export function getConfigPath() { return CONFIG_PATH; }
export function getConfigDir()  { return CONFIG_DIR;  }

// ─── Deep merge helper ───────────────────────────────────────────────
function deepMerge(base, override) {
  const result = structuredClone(base);
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object') {
      result[k] = deepMerge(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}
