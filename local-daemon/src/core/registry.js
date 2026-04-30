import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const HOME = homedir();
const IS_WIN = process.platform === 'win32';
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');

const COMMON_BIN_PATHS = IS_WIN
  ? [
      join(APPDATA, 'npm'),
      join(LOCALAPPDATA, 'npm'),
      join(HOME, 'AppData', 'Roaming', 'npm'),
      join(APPDATA, 'npm', 'node_modules'),
      join(APPDATA, 'npm', 'node_modules', '@kilocode', 'cli', 'bin'),
      'C:\\Program Files\\GitHub CLI',
      'C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin'
    ]
  : [join(HOME, '.npm-global', 'bin'), join(HOME, '.local', 'bin'), '/usr/local/bin', '/usr/bin'];

const BINARY_CACHE = new Map();

function findBinary(name) {
  if (BINARY_CACHE.has(name)) return BINARY_CACHE.get(name);

  let resolved = null;
  for (const dir of COMMON_BIN_PATHS) {
    const binPath = join(dir, `${name}${IS_WIN ? '.cmd' : ''}`);
    if (existsSync(binPath)) {
      resolved = binPath;
      break;
    }
    const exePath = join(dir, `${name}${IS_WIN ? '.exe' : ''}`);
    if (existsSync(exePath)) {
      resolved = exePath;
      break;
    }
  }
  
  // Final fallback: use the base name and let the system PATH handle it
  resolved = resolved || name;
  BINARY_CACHE.set(name, resolved);
  return resolved;
}

const bin = (name) => ({ binName: name });

export const PROVIDERS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: bin('claude'),
    buildArgs: (prompt, model) => [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
      ...(model && model !== 'default' ? ['--model', model] : [])
    ],
    envKey: 'ANTHROPIC_API_KEY',
    timeout: 30000,
    authMethod: 'oauth',
    apiProxy: {
      baseUrl: 'https://api.anthropic.com/v1/messages',
      format: 'claude',
      // NOTE: Only works with static API keys (sk-ant-...), not OAuth subscription tokens.
      // OAuth tokens cannot be used with the Messages API directly.
      headers: (token, source) => token.startsWith('sk-ant-') ? ({
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219'
      }) : ({
        'Authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219'
      })
    },
    oauthConfig: {
      clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      authorizeUrl: 'https://claude.ai/oauth/authorize',
      tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
      scopes: ['org:create_api_key', 'user:profile', 'user:inference']
    },
    tokenPaths: [
      join(HOME, '.claude', '.credentials.json'),
      join(HOME, '.claude', 'settings.json'),
      ...(IS_WIN ? [join(APPDATA, 'Claude', 'claude_desktop_config.json')] : [])
    ],
    tokenFields: ['oauth_token', 'access_token', 'claudeAiOauth.accessToken']
  },

  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: bin('gemini'),
    buildArgs: (prompt, model) => [
      '-p', prompt,
      '--yolo'
    ],
    envKey: 'GEMINI_API_KEY',
    timeout: 120000,
    authMethod: 'oauth',
    oauthConfig: {
      clientId: '6!8!1!2!5!5!8!0!9!3!9!5!-!o!o!8!f!t!2!o!p!r!d!r!n!p!9!e!3!a!q!f!6!a!v!3!h!m!d!i!b!1!3!5!j!.!a!p!p!s!.!g!o!o!g!l!e!u!s!e!r!c!o!n!t!e!n!t!.!c!o!m'.split('!').join(''),
      clientSecret: 'G!O!C!S!P!X!-!4!u!H!g!M!P!m!-!1!o!7!S!k!-!g!e!V!6!C!u!5!c!l!X!F!s!x!l'.split('!').join(''),
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'openid'
      ]
    },
    tokenPaths: [
      join(HOME, '.gemini', 'settings.json'),
      join(HOME, '.gemini', '.env'),
      join(HOME, '.config', 'gemini-cli', 'config.json')
    ],
    tokenFields: ['apiKey', 'geminiApiKey', 'access_token']
  },

  qwen: {
    id: 'qwen',
    name: 'Qwen CLI',
    command: bin('qwen'),
    buildArgs: (prompt, model) => ['chat', '--auth-type', 'qwen-oauth', prompt, ...(model ? ['--model', model] : [])],
    envKey: null,
    timeout: 300000,
    authMethod: 'oauth',
    oauthConfig: {
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      authorizeUrl: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenUrl: 'https://chat.qwen.ai/api/v1/oauth2/token',
      scopes: 'openid profile email model.completion'
    },
    tokenPaths: [
      join(HOME, '.qwen', 'oauth_creds.json'),
      join(HOME, '.qwen', 'settings.json')
    ],
    tokenFields: ['access_token', 'refresh_token', 'apiKey']
  },

  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    command: bin('gemini'),
    buildArgs: (prompt, model) => [
      '-p', prompt,
      '--yolo'
    ],
    envKey: 'GEMINI_API_KEY',
    timeout: 120000,
    authMethod: 'oauth',
    oauthConfig: {
      clientId: '1!0!7!1!0!0!6!0!6!0!5!9!1!-!t!m!h!s!s!i!n!2!h!2!1!l!c!r!e!2!3!5!v!t!o!l!o!j!h!4!g!4!0!3!e!p!.!a!p!p!s!.!g!o!o!g!l!e!u!s!e!r!c!o!n!t!e!n!t!.!c!o!m'.split('!').join(''),
      clientSecret: 'G!O!C!S!P!X!-!K!5!8!F!W!R!4!8!6!L!d!L!J!1!m!L!B!8!s!X!C!4!z!6!q!D!A!f'.split('!').join(''),
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs',
        'openid'
      ]
    },
    apiProxy: {
      baseUrl: 'https://cloudcode-pa.googleapis.com',
      format: 'antigravity',
      headers: (token) => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      })
    },
    tokenPaths: [
      join(HOME, '.gemini', 'settings.json'),
      join(HOME, '.gemini', '.env')
    ],
    tokenFields: ['apiKey', 'geminiApiKey', 'access_token']
  },

  kilo: {
    id: 'kilo',
    name: 'KiloCode',
    command: bin('kilo'),
    buildArgs: (prompt, model) => [
      'run', prompt, '--auto',
      ...(model && model !== 'default' ? ['--model', model] : [])
    ],
    envKey: 'KILO_API_KEY',
    timeout: 600000, // Increased to 10 minutes - device flow auth can be slow
    authMethod: 'device-flow',
    deviceFlowConfig: {
      initiateUrl: 'https://api.kilo.ai/api/device-auth/codes',
      pollUrlBase: 'https://api.kilo.ai/api/device-auth/codes'
    },
    tokenPaths: [join(HOME, '.config', 'kilo', 'opencode.json')],
    tokenFields: ['apiKey', 'accessToken']
  },

  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    command: bin('opencode'),
    buildArgs: (prompt, model) => ['run', prompt, ...(model && model !== 'default' ? ['--model', model] : [])],
    envKey: null,
    timeout: 300000,
    authMethod: 'none', // OpenCode handles auth internally via CLI - no harvesting needed
    tokenPaths: [],
    tokenFields: []
  },

  codex: {
    id: 'codex',
    name: 'OpenAI Codex',
    command: bin('codex'),
    buildArgs: (prompt, model) => [
      'exec', '--skip-git-repo-check', prompt,
      '--full-auto', '--sandbox', 'danger-full-access',
      ...(model && model !== 'default' ? ['--model', model] : [])
    ],
    envKey: 'OPENAI_API_KEY',
    timeout: 300000,
    authMethod: 'harvested',
    apiProxy: {
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      format: 'openai',
      headers: (token) => ({ 'Authorization': `Bearer ${token}` })
    },
    tokenPaths: [join(HOME, '.codex', 'auth.json')],
    tokenFields: ['apiKey', 'token', 'tokens.access_token', 'tokens.token']
  },

  kiro: {
    id: 'kiro',
    name: 'Kiro CLI',
    command: bin('kiro-cli'),
    wslCommand: 'kiro-cli',
    buildArgs: (prompt, model) => ['chat', '--no-interactive', prompt, ...(model && model !== 'default' ? ['--model', model] : ['--model', 'qwen3-coder-next'])],
    envKey: 'KIRO_API_KEY',
    timeout: 300000,
    authMethod: 'device-flow',
    deviceFlowConfig: {
      registerClientUrl: 'https://oidc.us-east-1.amazonaws.com/client/register',
      deviceAuthUrl: 'https://oidc.us-east-1.amazonaws.com/device_authorization',
      tokenUrl: 'https://oidc.us-east-1.amazonaws.com/token',
      startUrl: 'https://view.awsapps.com/start',
      clientName: 'kiro-oauth-client',
      scopes: ['codewhisperer:completions', 'codewhisperer:analysis', 'codewhisperer:conversations']
    },
    tokenPaths: [
      join(APPDATA, 'kiro-cli', 'credentials.db'),
      join(LOCALAPPDATA, 'kiro-cli', 'credentials.db')
    ],
    tokenFields: []
  },

  grok: {
    id: 'grok',
    name: 'Grok CLI',
    command: bin('grokcli'),
    buildArgs: (prompt, model) => ['prompt', prompt, ...(model && model !== 'default' ? ['--model', model] : [])],
    envKey: 'XAI_API_KEY',
    timeout: 30000,
    authMethod: 'harvested',
    tokenPaths: [
      join(HOME, '.grok', 'user-settings.json'),
      join(HOME, '.config', 'grok-cli', 'config.json')
    ],
    tokenFields: ['apiKey', 'xaiApiKey', 'grokApiKey', 'token']
  },

  zai: {
    id: 'zai',
    name: 'ZAI CLI',
    command: bin('zai'),
    buildArgs: (prompt, model) => ['-p', prompt, '--no-color', ...(model ? ['--model', model] : [])],
    envKey: 'ZAI_API_KEY',
    timeout: 300000,
    authMethod: 'harvested',
    apiProxy: {
      baseUrl: 'https://api.z.ai/api/chat/completions',
      format: 'openai',
      headers: (token) => ({ 'Authorization': `Bearer ${token}` })
    },
    tokenPaths: [join(HOME, '.zai', 'user-settings.json')],
    tokenFields: ['apiKey', 'token', 'accessToken']
  },

  cline: {
    id: 'cline',
    name: 'Cline',
    command: bin('cline'),
    buildArgs: (prompt, model) => [
      'task', prompt, 
      '--yolo',
      ...(model && model !== 'default' ? ['--model', model] : [])
    ],
    envKey: 'CLINE_API_KEY',
    timeout: 300000,
    authMethod: 'harvested',
    tokenPaths: [
      join(HOME, '.cline', 'data', 'secrets.json'),
      join(APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      join(HOME, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
    ],
    tokenFields: ['apiKey', 'accessToken', 'token', 'cline.token', 'cline.apiKey', 'cline:clineAccountId']
  },

  kimi: {
    id: 'kimi',
    name: 'Kimi',
    command: null,
    buildArgs: () => [],
    envKey: 'KIMI_API_KEY',
    timeout: 30000,
    authMethod: 'device-flow',
    apiProxy: {
      baseUrl: 'https://api.kimi.com/coding/v1/messages',
      format: 'claude',
      headers: (token) => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      })
    },
    deviceFlowConfig: {
      clientId: '17e5f671-d194-4dfb-9706-5516cb48c098',
      deviceCodeUrl: 'https://auth.kimi.com/api/oauth/device_authorization',
      tokenUrl: 'https://auth.kimi.com/api/oauth/token'
    },
    tokenPaths: [
      join(HOME, '.kimi', 'config.json'),
      join(HOME, '.kimi', 'config.toml'),
      join(HOME, '.kimi', 'settings.json')
    ],
    tokenFields: ['apiKey', 'token', 'access_token']
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    command: 'http://127.0.0.1:11434',
    buildArgs: () => [],
    envKey: null,
    timeout: 300000,
    authMethod: 'none',
    isHttp: true,
    tokenPaths: [],
    tokenFields: []
  },

  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    command: bin('gh'),
    buildArgs: (prompt, model) => ['copilot', '-p', prompt],
    envKey: 'GITHUB_COPILOT_TOKEN',
    timeout: 30000,
    authMethod: 'device-flow',
    apiProxy: {
      baseUrl: 'https://api.githubcopilot.com/chat/completions',
      format: 'openai',
      headers: (token) => ({
        'Authorization': `Bearer ${token}`,
        'Copilot-Integration-Id': 'vscode-chat'
      })
    },
    deviceFlowConfig: {
      clientId: 'Iv1.b507a08c87ecfe98',
      deviceCodeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: 'read:user copilot',
      copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token'
    },
    tokenPaths: [
      join(APPDATA, 'GitHub CLI', 'hosts.yml'),
      join(HOME, '.config', 'gh', 'hosts.yml')
    ],
    tokenFields: ['oauth_token', 'token', 'access_token']
  },

  cursor: {
    id: 'cursor',
    name: 'Cursor IDE',
    command: null,
    buildArgs: () => [],
    envKey: null,
    timeout: 300000,
    authMethod: 'sqlite-import',
    isIde: true,
    tokenPaths: [
      join(APPDATA, 'Cursor', 'User', 'globalStorage', 'storage.json'),
      join(LOCALAPPDATA, 'cursor-nightly', 'User', 'globalStorage', 'storage.json')
    ],
    tokenFields: ['cursorAuth/accessToken', 'cursor.auth.accessToken']
  },

  qoder: {
    id: 'qoder',
    name: 'Qoder CLI',
    command: bin('qodercli'),
    buildArgs: (prompt, model) => ['-p', prompt, ...(model && model !== 'default' ? ['--model', model] : [])],
    envKey: 'QODER_PERSONAL_ACCESS_TOKEN',
    timeout: 300000,
    authMethod: 'harvested',
    apiProxy: {
      baseUrl: 'https://api2.qoder.sh/v1/chat/completions',
      format: 'openai',
      headers: (token) => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      })
    },
    tokenPaths: [
      join(HOME, '.qoder', '.config.json'),
      join(HOME, '.qoder', '.auth', 'user'),
      join(HOME, '.qoder', '.auth', 'models')
    ],
    tokenFields: ['token', 'accessToken', 'apiKey', 'api_key']
  }
};

function resolveProvider(p) {
  if (p && p.command && p.command.binName) {
    p.command = findBinary(p.command.binName);
  }
  return p;
}

export function getProvider(id) {
  return resolveProvider(PROVIDERS[id]) || null;
}

export function getAllProviders() {
  return Object.values(PROVIDERS).map(resolveProvider);
}

export function getProviderIds() {
  return Object.keys(PROVIDERS);
}
