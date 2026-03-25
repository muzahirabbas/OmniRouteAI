import { spawn } from 'node:child_process';
import { log } from './logger.js';

/**
 * CLI Spawner — the core of the local daemon.
 */

const DEFAULT_TIMEOUT = 300000; // 5 minutes default timeout for slow CLI tools

/**
 * Get the absolute executable path for a tool to bypass environment issues.
 *
 * @param {string} tool - Tool name
 * @param {string} defaultCmd - Default command from config
 * @returns {string} - Absolute path or defaultCommand
 */
export function getExecutable(tool, defaultCmd) {
  const paths = {
    kilo:               'C:\\Users\\Zaari\\AppData\\Roaming\\npm\\kilo.cmd',
    opencode:           'C:\\Users\\Zaari\\AppData\\Roaming\\npm\\opencode.cmd',
    antigravity:        'C:\\Users\\Zaari\\AppData\\Roaming\\npm\\opencode.cmd',
    'antigravity-bridge': 'C:\\Users\\Zaari\\AppData\\Roaming\\npm\\opencode.cmd',
    gemini:             'C:\\Users\\Zaari\\AppData\\Roaming\\npm\\gemini.cmd',
    claude:             'C:\\Users\\Zaari\\AppData\\Roaming\\npm\\claude.cmd',
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

    // Use a single command string for Windows stability with batch files
    const fullCommandString = `"${command}" ${args.join(' ')}`;

    const child = spawn(fullCommandString, {
      shell:  true,
      cwd:    process.cwd(),
      env:    { ...process.env, ...env },
      signal: abortController.signal,
      stdio:  ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: true,
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
      return [
        '-p', q,
        ...(model ? ['--model', model] : []),
        '--dangerously-skip-permissions',
        '--output-format', 'text',
      ];

    case 'antigravity':
    case 'antigravity-bridge':
      // Phase 15: Use the registered Antigravity model slug for headless access
      return [
        'run',
        '--model', (model && model !== 'default') ? `google/antigravity-${model}` : 'google/antigravity-claude-sonnet-4-6',
        q,
      ];

    case 'kilo':
      return ['run', q, '--auto'];

    case 'opencode':
      return ['run', q];

    case 'gemini':
      return ['chat', '-p', q];

    case 'qodo':
      return ['chat', q, ...(model ? ['--model', model] : [])];

    case 'codex':
      return ['exec', q, '--full-auto', '--sandbox', 'danger-full-access'];

    case 'kiro':
      return ['chat', q, ...(model ? ['--model', model] : [])];

    case 'grok':
      return ['--prompt', q, ...(model ? ['--model', model] : [])];

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
