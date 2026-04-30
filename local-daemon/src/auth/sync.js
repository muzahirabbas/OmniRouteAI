import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { log } from '../core/logger.js';

const HOME = homedir();
const IS_WIN = process.platform === 'win32';
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');

async function readJson(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeJson(filePath, data) {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    log.error(`Failed to write ${filePath}: ${err.message}`);
    return false;
  }
}

export async function syncTokenToCLI(tool, tokens) {
  if (!tokens || !tokens.accessToken) return false;

  try {
    if (tool === 'cline') {
      const p = join(HOME, '.cline', 'data', 'secrets.json');
      const data = await readJson(p);
      
      data['cline:clineAccountId'] = JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || '',
        userInfo: {
          id: tokens.email || 'cli-user',
          email: tokens.email || 'local@daemon',
        },
        expiresAt: tokens.expiresIn 
          ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
          : new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        provider: 'cline',
        startedAt: Date.now()
      });
      
      return await writeJson(p, data);

    } else if (tool === 'gemini' || tool === 'antigravity') {
      const p = join(HOME, '.gemini', 'settings.json');
      const data = await readJson(p);
      
      data.access_token = tokens.accessToken;
      data.geminiApiKey = tokens.accessToken;
      data.apiKey = tokens.accessToken;
      
      if (tokens.projectId) {
        data.projectId = tokens.projectId;
        data.projectIdForCompanion = tokens.projectId;
      }
      if (tokens.tierId) data.tierId = tokens.tierId;

      return await writeJson(p, data);

    } else if (tool === 'claude') {
      const p = join(HOME, '.claude', '.credentials.json');
      const data = await readJson(p);
      data.oauth_token = tokens.accessToken;
      data.access_token = tokens.accessToken;
      if (tokens.refreshToken) data.refresh_token = tokens.refreshToken;
      return await writeJson(p, data);

    } else if (tool === 'codex') {
      const p = join(HOME, '.codex', 'auth.json');
      const data = await readJson(p);
      
      // Preserving existing fields (like account_id) while updating tokens
      data.api_key = tokens.idToken || tokens.accessToken;
      data.tokens = {
        ...(data.tokens || {}),
        access_token: tokens.accessToken,
        id_token: tokens.idToken || (data.tokens?.id_token),
        refresh_token: tokens.refreshToken || (data.tokens?.refresh_token)
      };
      data.last_refresh = new Date().toISOString();
      
      return await writeJson(p, data);

    } else if (tool === 'qwen') {
      const qwenDir = join(HOME, '.qwen');
      const p = join(qwenDir, 'oauth_creds.json');
      await mkdir(qwenDir, { recursive: true });
      const data = await readJson(p);
      data.access_token = tokens.accessToken;
      if (tokens.refreshToken) data.refresh_token = tokens.refreshToken;
      return await writeJson(p, data);

    } else if (tool === 'cursor') {
      const p = join(APPDATA, 'Cursor', 'User', 'globalStorage', 'storage.json');
      const data = await readJson(p);
      data['cursorAuth/accessToken'] = tokens.accessToken;
      data['cursor.auth.accessToken'] = tokens.accessToken;
      if (tokens.providerSpecificData?.machineId) {
        data['storage.serviceMachineId'] = tokens.providerSpecificData.machineId;
      }
      return await writeJson(p, data);

    } else if (tool === 'zai') {
      const p = join(HOME, '.zai', 'user-settings.json');
      const data = await readJson(p);
      data.apiKey = tokens.accessToken;
      data.token = tokens.accessToken;
      return await writeJson(p, data);
    }

    return true;
  } catch (err) {
    log.error(`Sync failed for ${tool}: ${err.message}`);
    return false;
  }
}

export async function wipeTokenFromCLI(tool) {
  try {
    const paths = [];

    if (tool === 'cline') {
      paths.push(
        join(HOME, '.cline', 'data', 'secrets.json'),
        join(APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
      );
    }
    if (tool === 'gemini' || tool === 'antigravity') {
      paths.push(join(HOME, '.gemini', 'settings.json'), join(HOME, '.gemini', '.env'));
    }
    if (tool === 'claude') {
      paths.push(join(HOME, '.claude', '.credentials.json'), join(HOME, '.claude', 'settings.json'));
    }
    if (tool === 'codex') paths.push(join(HOME, '.codex', 'auth.json'));
    if (tool === 'qwen') paths.push(join(HOME, '.qwen', 'oauth_creds.json'), join(HOME, '.qwen', 'settings.json'));
    if (tool === 'zai') paths.push(join(HOME, '.zai', 'user-settings.json'));
    if (tool === 'cursor') {
      paths.push(
        join(APPDATA, 'Cursor', 'User', 'globalStorage', 'storage.json'),
        join(LOCALAPPDATA, 'cursor-nightly', 'User', 'globalStorage', 'storage.json')
      );
    }

    for (const p of paths) {
      if (existsSync(p)) {
        if (p.includes('storage.json') || p.includes('cline_mcp_settings')) {
          const data = await readJson(p);
          if (p.includes('cline')) {
            delete data.apiKey;
            delete data['cline:clineAccountId'];
          }
          if (p.includes('Cursor')) {
            delete data['cursorAuth/accessToken'];
            delete data['cursor.auth.accessToken'];
          }
          await writeJson(p, data);
        } else {
          await writeJson(p, {});
        }
        log.info(`Wiped config at: ${p}`);
      }
    }
    return true;
  } catch (err) {
    log.error(`Wipe failed for ${tool}: ${err.message}`);
    return false;
  }
}

export async function polarizeAllTokens() {
  const { loadTokens } = await import('./tokenStore.js');
  const allTokens = await loadTokens();
  
  for (const [tool, tokens] of Object.entries(allTokens)) {
    if (tokens?.accessToken) {
      await syncTokenToCLI(tool, tokens);
    }
  }
}
