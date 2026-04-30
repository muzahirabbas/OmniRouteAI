import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../core/logger.js';
import { updateToken } from './tokenStore.js';
import { getAllProviders } from '../core/registry.js';
import chokidar from 'chokidar';

const HOME = homedir();
const IS_WIN = process.platform === 'win32';
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');

export async function harvestTokens(singleProviderId = null) {
  const providers = singleProviderId 
    ? [getAllProviders().find(p => p.id === singleProviderId)].filter(Boolean)
    : getAllProviders();
    
  if (providers.length === 0) return {};
  
  const results = {};
  const { loadTokens } = await import('./tokenStore.js');

  for (const provider of providers) {
    if (provider.authMethod === 'none') continue;

    // First, check for token in environment variable (if envKey is defined)
    if (provider.envKey && process.env[provider.envKey]) {
      const envToken = process.env[provider.envKey];
      log.info(`Found token for ${provider.id} in environment variable ${provider.envKey}`);
      const tokenResult = { accessToken: envToken, source: 'env-var' };
      results[provider.id] = tokenResult;
      await updateToken(provider.id, tokenResult);
      continue;
    }

    // Then, check file-based tokens
    if (!provider.tokenPaths || provider.tokenPaths.length === 0) continue;

    try {
      const existingToken = await loadTokens();
      const existingProviderToken = existingToken[provider.id];
      
      // For harvested auth method, always re-harvest to get fresh tokens from CLI config files
      if (provider.authMethod === 'harvested') {
        log.info(`Harvest method for ${provider.id}, attempting harvest...`);
      } else if (existingProviderToken?.accessToken && existingProviderToken?.source && !existingProviderToken.source.includes('harvest')) {
        // For OAuth/device-flow, skip if existing token is valid and not from harvest
        log.info(`Skipping harvest for ${provider.id} - has existing token from ${existingProviderToken.source}`);
        continue;
      }
      
      const tokenData = await harvestProvider(provider);
      if (tokenData) {
        results[provider.id] = tokenData;
        await updateToken(provider.id, tokenData);
      }
    } catch (err) {
      log.warn(`Harvest failed for ${provider.id}: ${err.message}`);
    }
  }

  log.info(`Token harvest complete. Found: ${Object.keys(results).join(', ') || 'none'}`);
  return results;
}

async function harvestProvider(provider) {
  for (const tokenPath of provider.tokenPaths) {
    if (!existsSync(tokenPath)) continue;

    try {
      if (tokenPath.endsWith('.yml') || tokenPath.endsWith('.yaml')) {
        const raw = await readFile(tokenPath, 'utf8');
        const match = raw.match(/oauth_token:\s*([^\s\r\n]+)/);
        if (match?.[1]) {
          return { accessToken: match[1], source: 'gh-cli' };
        }
      } else if (tokenPath.endsWith('.toml')) {
        const raw = await readFile(tokenPath, 'utf8');
        const match = raw.match(/api_key\s*=\s*"([^"]+)"/);
        if (match?.[1]) {
          return { accessToken: match[1], source: 'kimi-toml' };
        }
        const envMatch = raw.match(/api_key\s*=\s*['"]([^'"]+)['"]/);
        if (envMatch?.[1]) {
          return { accessToken: envMatch[1], source: 'kimi-toml' };
        }
      } else if (tokenPath.endsWith('.env')) {
        const raw = await readFile(tokenPath, 'utf8');
        for (const field of provider.tokenFields) {
          const match = raw.match(new RegExp(`${field}=([^\\s]+)`));
          if (match?.[1]) {
            return { accessToken: match[1], source: 'env-file' };
          }
        }
      } else {
        try {
          const raw = await readFile(tokenPath, 'utf8');
          const data = JSON.parse(raw);
          
          if (provider.id === 'codex' && data.tokens) {
             return {
               accessToken: data.tokens.access_token || data.api_key,
               refreshToken: data.tokens.refresh_token,
               idToken: data.tokens.id_token,
               source: 'codex-config'
             };
          }

          const token = extractField(data, provider.tokenFields);
          if (token) {
            return { accessToken: token, source: provider.id + '-config' };
          }
        } catch (err) {
          // File might be encrypted (e.g., qoder) or malformed - skip gracefully
          log.warn(`Could not parse token file ${tokenPath}: ${err.message}`);
          continue;
        }
      }
    } catch (err) {
      continue;
    }
  }

  if (provider.id === 'copilot' || provider.id === 'gh') {
    const hostsYml = IS_WIN
      ? join(APPDATA, 'GitHub CLI', 'hosts.yml')
      : join(HOME, '.config', 'gh', 'hosts.yml');
    
    if (existsSync(hostsYml)) {
      try {
        const raw = await readFile(hostsYml, 'utf8');
        const match = raw.match(/oauth_token:\s*([^\s\r\n]+)/);
        if (match?.[1]) {
          return { accessToken: match[1], source: 'gh-cli' };
        }
      } catch {}
    }
  }

  if (provider.id === 'kiro') {
    // Kiro CLI stores its OIDC session tokens in a SQLite database:
    // macOS/Linux: ~/.local/share/kiro-cli/data.sqlite3
    // Windows: %APPDATA%\kiro-cli\data.sqlite3
    // JSON-based harvesting cannot read SQLite files.
    // Kiro authentication must be done via the IDE; daemon dispatch is disabled.
    log.warn('Kiro uses SQLite token storage — cannot harvest via file path. Authenticate via Kiro IDE.');
    return null;
  }

  return null;
}

function extractField(obj, fields) {
  for (const field of fields) {
    if (field.includes('.')) {
      const parts = field.split('.');
      let value = obj;
      for (const part of parts) {
        value = value?.[part];
      }
      if (value) {
        // If value looks like a JSON string, try to parse it and extract idToken
        // Handle both "{\"idToken\":" and "{\"idToken\":"
        if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('{"') || value.startsWith('\\"'))) {
          try {
            const parsed = JSON.parse(value);
            return parsed.idToken || parsed.accessToken || parsed.token || value;
          } catch {}
        }
        return value;
      }
    } else {
      if (obj[field]) {
        const value = obj[field];
        // If value looks like a JSON string (e.g., cline:clineAccountId), parse it
        // Handle both "{\"idToken\":" and "{\"idToken\":" and plain {"
        if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('{"') || value.startsWith('\\"'))) {
          try {
            const parsed = JSON.parse(value);
            return parsed.idToken || parsed.accessToken || parsed.token || value;
          } catch {}
        }
        return value;
      }
    }
  }
  
  for (const provider of ['anthropic', 'openai', 'opencode', 'github-copilot', 'google', 'openrouter']) {
    if (obj[provider]?.key) return obj[provider].key;
    if (obj[provider]?.access) return obj[provider].access;
  }
  
  return null;
}

let watcher = null;

export function watchTokenFiles() {
  const dirs = new Set();
  const providers = getAllProviders();

  for (const provider of providers) {
    if (!provider.tokenPaths) continue;
    for (const p of provider.tokenPaths) {
      const dir = join(p, '..');
      if (existsSync(dir)) dirs.add(dir);
    }
  }

  const dirArray = [...dirs];
  if (dirArray.length === 0) return null;

  watcher = chokidar.watch(dirArray, {
    ignoreInitial: true,
    persistent: true,
    depth: 2,
    ignored: /(^|[\/\\])\../,
  });

  watcher.on('change', async (path) => {
    const provider = providers.find(pr => pr.tokenPaths?.some(tp => join(tp) === join(path)));
    if (provider) {
      log.info(`Config file changed: ${path}. Re-harvesting ${provider.id}...`);
      await harvestTokens(provider.id);
    } else {
      log.info(`Non-specific config changed: ${path}. Generic re-harvest...`);
      await harvestTokens();
    }
  });

  watcher.on('add', async (path) => {
    const provider = providers.find(pr => pr.tokenPaths?.some(tp => join(tp) === join(path)));
    if (provider) {
      log.info(`New config file detected: ${path}. Re-harvesting ${provider.id}...`);
      await harvestTokens(provider.id);
    } else {
      await harvestTokens();
    }
  });

  return watcher;
}

export function stopWatching() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
