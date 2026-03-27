import { spawn } from 'node:child_process';
import { log } from './logger.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * CLI Spawner — the core of the local daemon.
 */

const DEFAULT_TIMEOUT = 300000; // 5 minutes default timeout for slow CLI tools

// Resolve the npm global bin directory dynamically
const NPM_BIN = process.env.APPDATA
  ? join(process.env.APPDATA, 'npm')           // Windows
  : join(homedir(), '.npm-global', 'bin');      // Unix fallback

/**
 * Get the absolute executable path for a tool to bypass environment issues.
 *
 * @param {string} tool - Tool name
 * @param {string} defaultCmd - Default command from config
 * @returns {string} - Absolute path or defaultCommand
 */
export function getExecutable(tool, defaultCmd) {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  const bin = (name) => join(NPM_BIN, `${name}${ext}`);

  const paths = {
    kilo:               bin('kilo'),
    opencode:           bin('opencode'),
    antigravity:        bin('opencode'),
    'antigravity-bridge': bin('opencode'),
    gemini:             bin('gemini'),
    claude:             bin('claude'),
    grok:               bin('grok'),
    kiro:               bin('kiro-cli'),
    zai:                bin('zai'),
    cline:              bin('cline'),
    // kimi lives in ~/.local/bin on Unix; on Windows use LOCALAPPDATA or PATH fallback
    kimi: process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || homedir(), 'Programs', 'kimi', 'kimi.exe')
      : join(homedir(), '.local', 'bin', 'kimi'),
    ollama: 'http://127.0.0.1:11434',  // handled directly via HTTP, not spawn
  };
  return paths[tool] || defaultCmd;
}

/**
 * Spawn a CLI command and collect or stream output.
 */
export async function spawnCLI(opts) {
  const {
    tool      = 'unknown',
    command,
    args      = [],
    env       = {},
    timeout   = DEFAULT_TIMEOUT,
    stream    = false,
    onChunk,
    onDone,
    onError,
  } = opts;

  const startTime = Date.now();
  const cmdString = `${command} ${args.join(' ')}`;

  const abortController = new AbortController();
  const timer = setTimeout(() => {
    abortController.abort();
  }, timeout);

  return new Promise((resolve, reject) => {
    let stdoutChunks = [];
    let stderrChunks = [];

    console.log(JSON.stringify({
      level:   'info',
      msg:     'Spawning CLI',
      command,
      args,
      cwd: process.cwd(),
    }));

    // MITM Proxy Injection for token capture
    const childEnv = { ...process.env, ...env };
    if (process.env.MITM_PROXY === 'true') {
      childEnv.HTTPS_PROXY = 'http://127.0.0.1:5060';
      childEnv.HTTP_PROXY  = 'http://127.0.0.1:5060';
      // Disable TLS verification for the child process so it trusts our MITM proxy
      childEnv.NODE_TLS_REJECT_UNAUTHORIZED = '0'; 
      log.info(`Injecting MITM proxy for ${tool} spawn`);
    }

    const child = spawn(command, args, {
      shell:  true,
      cwd:    process.cwd(),
      env:    childEnv,
      signal: abortController.signal,
      stdio:  ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdoutChunks.push(text);
      if (stream && onChunk) onChunk(text);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk.toString('utf8'));
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      const raw      = stdoutChunks.join('');
      const stderr   = stderrChunks.join('');
      const success  = exitCode === 0;

      log.request({
        tool,
        command:  cmdString,
        prompt:   args[args.length - 1] || '',
        duration,
        exitCode:  exitCode ?? -1,
        success,
        ...(success ? {} : { error: stderr || `Exit code ${exitCode}` }),
      });

      const result = {
        output:   raw.trim(),
        raw,
        tokens:   estimateTokens(args.join(' '), raw),
        exitCode: exitCode ?? -1,
        success,
        stderr:   stderr || null,
      };

      if (!success) {
        result.error = stderr.trim() || `Process exited with code ${exitCode}`;
      }

      if (stream && onDone) onDone(result);
      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError' || err.code === 'ABORT_ERR';
      const message   = isTimeout
        ? `[${tool}] Request timed out after ${timeout}ms`
        : `[${tool}] Spawn error: ${err.message}`;

      log.error(message, { tool, command: cmdString, duration });

      const result = {
        output:   '',
        raw:      '',
        tokens:   { input: 0, output: 0 },
        exitCode: -1,
        success:  false,
        error:    message,
      };

      if (stream && onError) onError(new Error(message));
      resolve(result);
    });
  });
}

/**
 * Build CLI arguments for various tools.
 */
export function buildArgs(tool, prompt, model, extraArgs = {}) {
  const q = `"${prompt}"`;

  switch (tool) {
    case 'claude':
      // claude -p "prompt" --dangerously-skip-permissions --output-format text
      // Note: newer Claude CLIs require --dangerously-skip-permissions BEFORE the prompt flag
      return [
        '-p', q,
        '--dangerously-skip-permissions',
        '--output-format', 'text',
        ...(model && model !== 'default' ? ['--model', model] : []),
      ];

    case 'antigravity':
    case 'antigravity-bridge':
      return [
        'run',
        '--model', (model && model !== 'default') ? model : 'anthropic/claude-sonnet-4-5',
        q,
      ];

    case 'kilo':
      // kilo run "prompt" is the correct headless invocation
      // Note: needs a model configured with API key (e.g. kilo -m openai/gpt-4o-mini)
      return [
        'run', q,
        '--auto',
        ...(model && model !== 'default' ? ['--model', model] : []),
      ];

    case 'opencode':
      return ['run', q];

    case 'gemini':
      // gemini -p "prompt" --yolo (no 'chat' subcommand exists)
      return [
        '-p', q,
        '--yolo',
        ...(model && model !== 'default' ? ['--model', model] : []),
      ];

    case 'kiro':
      // kiro-cli chat "prompt" (no --non-interactive flag exists)
      return ['chat', q, ...(model && model !== 'default' ? ['--model', model] : [])];

    case 'grok':
      // grok --prompt "prompt" (--non-interactive does NOT exist)
      return ['--prompt', q, ...(model && model !== 'default' ? ['--model', model] : [])];

    case 'zai':
      // zai -p "prompt" --no-color (--non-interactive does NOT exist)
      return ['-p', q, '--no-color', ...(model && model !== 'default' ? ['--model', model] : [])];

    case 'cline':
      return [q, '-y'];

    case 'kimi':
      // kimi CLI only supports TUI/ACP modes — no headless text completion.
      // Use the web subcommand approach (it starts a local web server on random port).
      // The only way to get text output is via --print flag with stdin piping.
      // For now, kimi is not supported in headless daemon mode.
      return ['info'];

    case 'codex':
      // codex exec "prompt" --full-auto --sandbox danger-full-access works headlessly
      return ['exec', q, '--full-auto', '--sandbox', 'danger-full-access'];

    case 'copilot':
      return [
        '-p', q,
        ...(model && model !== 'default' ? ['--model', model] : []),
      ];

    case 'custom':
      return [q];

    default:
      return [q];
  }
}

/**
 * Estimate tokens from prompt + output for accounting.
 */
function estimateTokens(input, output) {
  return {
    input:  Math.ceil((input  || '').length / 4),
    output: Math.ceil((output || '').length / 4),
  };
}
