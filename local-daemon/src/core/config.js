import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.omniroute', 'local-cli');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  port: 5059,
  host: '127.0.0.1',
  logLevel: 'info',
  mitmProxy: false,
};

let _config = null;

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
      _config = deepMerge(DEFAULT_CONFIG, parsed);
    }
  } catch (err) {
    console.error(`[config] Failed to load config: ${err.message} — using defaults`);
    _config = structuredClone(DEFAULT_CONFIG);
  }

  return _config;
}

export async function saveConfig(updates) {
  _config = deepMerge(_config || DEFAULT_CONFIG, updates);
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf8');
  return _config;
}

export async function getToolConfig(toolName) {
  const config = await loadConfig();
  return config.tools?.[toolName] || null;
}

export async function getTools() {
  const config = await loadConfig();
  return config.tools || {};
}

export function getConfigPath() { return CONFIG_PATH; }
export function getConfigDir() { return CONFIG_DIR; }

function deepMerge(base, override) {
  const result = structuredClone(base);
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object') {
      result[k] = deepMerge(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}
