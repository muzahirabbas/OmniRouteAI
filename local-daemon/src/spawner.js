import { spawn } from 'node:child_process';
import { log } from './logger.js';

/**
 * CLI Spawner — the core of the local daemon.
 *
 * Responsibilities:
 * - Spawn CLI commands using child_process.spawn (shell: true)
 * - Stream stdout chunks directly to an HTTP reply (if streaming)
 * - Capture stderr separately (never mixed with stdout)
 * - Enforce timeouts via AbortController
 * - Return normalized { output, raw, tokens, exitCode, error }
 *
 * STREAMING MODE (stream=true):
 *   Each stdout chunk is immediately written to `reply.raw`
 *   Format: `data: <chunk>\n\n` (SSE compatible)
 *   Caller manages reply.raw lifecycle (writeHead / end)
 *
 * NON-STREAMING MODE (stream=false):
 *   Collects all stdout, returns on process exit.
 */

const DEFAULT_TIMEOUT = 300000; // 5 minutes default timeout for slow CLI tools

/**
 * Spawn a CLI command and collect or stream output.
 *
 * @param {object} opts
 * @param {string}   opts.tool       - Tool name for logging (e.g. 'claude')
 * @param {string}   opts.command    - CLI binary (e.g. 'claude', 'gemini')
 * @param {string[]} opts.args       - CLI arguments array
 * @param {object}   [opts.env]      - Extra env vars to inject
 * @param {number}   [opts.timeout]  - Timeout in ms (default 60s)
 * @param {boolean}  [opts.stream]   - If true, stream stdout chunks
 * @param {Function} [opts.onChunk]  - Callback per stdout chunk (stream mode)
 * @param {Function} [opts.onDone]   - Callback on process exit (stream mode)
 * @param {Function} [opts.onError]  - Callback on error (stream mode)
 * @returns {Promise<{output, raw, tokens, exitCode, success, error?}>}
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

  // AbortController for timeout enforcement
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
      // path: process.env.PATH?.split(';')[0] + '...', // Log first path as hint
    }));

    const child = spawn(command, args, {
      shell:  true,
      env:    { ...process.env, ...env },
      signal: abortController.signal,
      // Do NOT use stdio: 'pipe' for streaming — use default
    });

    // ── STDOUT ────────────────────────────────────────────────────
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdoutChunks.push(text);

      if (stream && onChunk) {
        onChunk(text);
      }
    });

    // ── STDERR ────────────────────────────────────────────────────
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk.toString('utf8'));
    });

    // ── PROCESS CLOSE ─────────────────────────────────────────────
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

      if (stream && onDone) {
        onDone(result);
      }
      // Always resolve — even in stream mode — to prevent promise/memory leak
      resolve(result);
    });

    // ── PROCESS ERROR ─────────────────────────────────────────────
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

      if (stream && onError) {
        onError(new Error(message));
      }
      // Always resolve — never reject — for clean HTTP handling
      resolve(result);
    });
  });
}

/**
 * Build CLI args for a prompt-based tool request.
 * Each tool has different CLI flag conventions.
 *
 * @param {string} tool    - tool name
 * @param {string} prompt  - user prompt
 * @param {string} [model] - optional model override
 * @param {object} [extraArgs] - tool-specific extra args from request body
 * @returns {string[]}
 */
export function buildArgs(tool, prompt, model, extraArgs = {}) {
  // CRITICAL: Double-quote prompt for Windows shell stability (shell: true).
  const q = `"${prompt}"`;

  switch (tool) {
    case 'claude':
      // Use absolute path to ensure daemon finds it
      return [
        'C:/Users/Zaari/AppData/Roaming/npm/claude.cmd',
        '-p', q,
        ...(model ? ['--model', model] : []),
        '--dangerously-skip-permissions',
        '--output-format', 'text',
      ];

    case 'antigravity':
      // Phase 6: Claude Code Proxy Bridge for Antigravity (as requested)
      // If we use 'claude -p', it may act as a better headless bridge if configured
      // Fallback to absolute path of antigravity.cmd if claude is not logged in
      return [
        'C:/Users/Zaari/AppData/Roaming/npm/claude.cmd',
        '-p',
        `Ask Antigravity: ${q}`,
        '--dangerously-skip-permissions',
        '--no-session-persistence',
      ];

    case 'kilo':
      return ['C:/Users/Zaari/AppData/Roaming/npm/kilo.cmd', 'run', q, '--auto'];

    case 'opencode':
      return ['C:/Users/Zaari/AppData/Roaming/npm/opencode.cmd', 'run', q];

    case 'gemini':
      return ['C:/Users/Zaari/AppData/Roaming/npm/gemini.cmd', 'chat', '-p', q];

    case 'qodo':
      return ['chat', q, ...(model ? ['--model', model] : [])];

    case 'codex':
      // Use "exec" for non-interactive plan execution
      return ['exec', q, '--full-auto', '--sandbox', 'danger-full-access'];

    case 'kiro':
      // kiro-cli became kiro usually
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
 * @param {string} input
 * @param {string} output
 * @returns {{ input: number, output: number }}
 */
function estimateTokens(input, output) {
  return {
    input:  Math.ceil((input  || '').length / 4),
    output: Math.ceil((output || '').length / 4),
  };
}

