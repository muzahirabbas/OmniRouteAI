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

const DEFAULT_TIMEOUT = 60000; // 60 seconds

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
      } else {
        resolve(result);
      }
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
      } else {
        resolve(result); // Always resolve (never reject) for clean HTTP handling
      }
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
  switch (tool) {
    case 'claude':
      // claude -p "prompt" [--model model]
      return [
        '-p', prompt,
        ...(model ? ['--model', model] : []),
        '--output-format', 'text',
      ];

    case 'gemini':
      // gemini -p "prompt" [--model model]
      return [
        '-p', prompt,
        ...(model ? ['--model', model] : []),
      ];

    case 'qwen':
      // qwen-code run "prompt"
      return ['run', prompt];

    case 'antigravity':
      // antigravity "prompt" [--model model]
      return [
        prompt,
        ...(model ? ['--model', model] : []),
      ];

    case 'kilo':
      // kilo run "prompt"
      return ['run', prompt];

    case 'opencode':
      // opencode run "prompt"
      return ['run', prompt];

    case 'qodo':
      // qodo chat "prompt"
      return ['chat', prompt, ...(model ? ['--model', model] : [])];

    case 'codex':
      // codex "prompt"
      return [prompt, ...(model ? ['--model', model] : [])];

    case 'kiro':
      // kiro-cli chat "prompt"
      return ['chat', prompt, ...(model ? ['--model', model] : [])];

    case 'grok':
      // grok "prompt"
      return [prompt, ...(model ? ['--model', model] : [])];

    case 'copilot':
      // copilot suggest -t shell "prompt" -- or just copilot "prompt"
      // the official "gh copilot suggest" requires tty, but basic copilot might wrap it. 
      // We'll pass the prompt as the primary intent.
      return ['suggest', '-t', 'doc', prompt];

    case 'custom':
      return [prompt];

    default:
      return [prompt];
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
