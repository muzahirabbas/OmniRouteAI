import { spawn, spawnSync } from 'node:child_process';
import { log } from './logger.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_TIMEOUT = 30000;
const MAX_CONCURRENT_SPAWNS = 3;

/**
 * Simple Semaphore to limit concurrent CLI executions.
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.running = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release() {
    this.running--;
    if (this.queue.length > 0) {
      this.running++;
      const next = this.queue.shift();
      next();
    }
  }
}

const spawnSemaphore = new Semaphore(MAX_CONCURRENT_SPAWNS);

/** Map of requestId → ChildProcess for all active CLI spawns */
const activeProcesses = new Map();

/**
 * Internal spawn implementation.
 */
async function _doSpawn(opts) {
  const {
    tool = 'unknown',
    command,
    wslCommand = null,  // Linux CLI to run via WSL on Windows
    args = [],
    env = {},
    timeout = DEFAULT_TIMEOUT,
    stream = false,
    signal: externalSignal = null,
    onChunk,
    onDone,
    onError,
    noContext = false,
  } = opts;

  if (!command) {
    const result = {
      output: '', raw: '', tokens: { input: 0, output: 0 },
      exitCode: -1, success: false, error: 'No command specified'
    };
    if (stream && onError) onError(new Error('No command specified'));
    return result;
  }

  // Check if we need to run via WSL on Windows
  let actualCommand = command;
  let actualArgs = args;
  
  if (process.platform === 'win32' && wslCommand) {
    // Use WSL with bash -l (login shell) to run CLI with full user PATH/environment
    // Login shell sources .bashrc/.profile which sets up user's PATH including ~/.local/bin
    const escapedArgs = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
    actualCommand = 'wsl';
    actualArgs = ['-e', 'bash', '-l', '-c', `${wslCommand} ${escapedArgs}`];
    log.info(`Windows detected, running ${wslCommand} via WSL login shell`, { tool });
  }

  const startTime = Date.now();
  
  const quoteArg = (arg) => {
    if (arg.includes(' ') || arg.includes('"') || arg.includes("'")) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  };
  
  const cmdString = `${actualCommand} ${actualArgs.map(quoteArg).join(' ')}`;

  log.info(`Spawning CLI: ${cmdString}`, { tool, cwd: process.cwd() });

  const abortController = new AbortController();
  let child = null;
  
  const timer = setTimeout(() => {
    log.error(`Timeout after ${timeout}ms for ${tool} [${command}], killing process...`);
    if (child && !child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child && !child.killed) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }, 500);
    }
    abortController.abort();
  }, timeout);

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortController.abort();
    } else {
      externalSignal.addEventListener('abort', () => {
        log.info(`External abort signal received for ${tool}`);
        abortController.abort();
      }, { once: true });
    }
  }

  return new Promise((resolve) => {
    let stdoutChunks = [];
    let stderrChunks = [];

    const childEnv = { ...process.env, ...env };

    if (process.env.MITM_PROXY === 'true') {
      childEnv.HTTPS_PROXY = 'http://127.0.0.1:5060';
      childEnv.HTTP_PROXY = 'http://127.0.0.1:5060';
      log.info(`MITM proxy enabled for ${tool}`);
    }

    const requestId = randomUUID();
    const useShell = process.platform === 'win32';
    
    let cmdToSpawn = actualCommand;
    let argsToSpawn = actualArgs;
    
    if (useShell && actualCommand.endsWith('.cmd')) {
      cmdToSpawn = 'cmd';
      argsToSpawn = ['/c', actualCommand, ...actualArgs];
    }
    
    let workingDir = process.env.TEMP || process.cwd();
    
    if (noContext) {
      try {
        workingDir = mkdtempSync(join(tmpdir(), 'omniroute-nocontext-'));
        log.info(`Running ${tool} in no-context mode: ${workingDir}`);
      } catch (err) {
        log.warn(`Failed to create temp dir for noContext: ${err.message}, falling back to default`);
      }
    }
    
    log.info(`SPAWN ARGS: ${cmdToSpawn} ${argsToSpawn.join(' ')}`, { tool, cwd: workingDir });
    child = spawn(cmdToSpawn, argsToSpawn, {
      shell: false,
      cwd: workingDir,
      env: childEnv,
      signal: abortController.signal,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    activeProcesses.set(requestId, child);
    
    // Close stdin immediately as we are only using CLI args for now.
    // This prevents CLI tools from hanging while waiting for more input.
    if (child.stdin) {
      child.stdin.end();
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdoutChunks.push(text);
      if (stream && onChunk) onChunk(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrChunks.push(text);
    });

    const cleanup = () => {
      clearTimeout(timer);
      activeProcesses.delete(requestId);
      if (noContext && workingDir && workingDir.includes('omniroute-nocontext-')) {
        try {
          rmSync(workingDir, { recursive: true, force: true });
          log.info(`Cleaned up no-context temp dir: ${workingDir}`);
        } catch (err) {
          log.warn(`Failed to clean up temp dir ${workingDir}: ${err.message}`);
        }
      }
    };

    child.on('close', (exitCode) => {
      cleanup();
      const duration = Date.now() - startTime;
      const raw = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      const success = exitCode === 0;

      log.request({
        tool,
        command: cmdString,
        prompt: args.join(' ').slice(0, 120),
        duration,
        exitCode: exitCode ?? -1,
        success,
        ...(success ? {} : { error: stderr || `Exit code ${exitCode}` })
      });

      const result = {
        output: stripAnsi(raw).trim(),
        raw,
        tokens: estimateTokens(args.join(' '), stripAnsi(raw)),
        exitCode: exitCode ?? -1,
        success,
        stderr: stripAnsi(stderr) || null,
      };

      if (!success) {
        result.error = stderr.trim() || `Process exited with code ${exitCode}`;
      }

      if (stream && onDone) onDone(result);
      resolve(result);
    });

    if (stream && externalSignal) {
      externalSignal.addEventListener('abort', () => {
        if (child && !child.killed) {
          log.info(`Killing child process due to external abort: ${tool}`);
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child && !child.killed) child.kill('SIGKILL');
          }, 1000);
        }
      }, { once: true });
    }

    child.on('error', (err) => {
      cleanup();
      const duration = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.message.includes('abort');
      const message = isTimeout
        ? `[${tool}] Request timed out after ${timeout}ms`
        : `[${tool}] Spawn error: ${err.message}`;

      log.error(message, { tool, command: cmdString, duration });

      const result = {
        output: '',
        raw: '',
        tokens: { input: 0, output: 0 },
        exitCode: -1,
        success: false,
        error: message,
      };

      if (stream && onError) onError(new Error(message));
      resolve(result);
    });
  });
}

export async function spawnCLI(opts) {
  const tool = opts.tool || 'unknown';
  log.info(`Queueing CLI spawn for ${tool} (running: ${spawnSemaphore.running}/${MAX_CONCURRENT_SPAWNS})`);
  
  await spawnSemaphore.acquire();
  try {
    return await _doSpawn(opts);
  } finally {
    spawnSemaphore.release();
  }
}

export async function killCurrentProcess() {
  for (const [id, proc] of activeProcesses.entries()) {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 1000);
    }
    activeProcesses.delete(id);
  }
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[JKmsu]/g, '')
            .replace(/\x1b\]8[^\\]*\\\\/g, '')
            .replace(/\x1b\?[0-9;]*[JKmsu]/g, '')
            .replace(/\x1b\[G/g, '')
            .replace(/\x1b\[\?25[hl]/g, '')
            .replace(/\x1b\[([0-9]+)G/g, '')  // Cursor position
            .replace(/[\u001b\u009b][\x00-\x1f\x7f]+/g, '')
            .replace(/\r/g, '')  // Strip carriage returns
            .replace(/^\s*>\s*/, '');  // Remove leading > (blockquotes)
}

function estimateTokens(input, output) {
  return {
    input: Math.ceil((input || '').length / 4),
    output: Math.ceil((output || '').length / 4),
  };
}

export async function getExecutablePath(tool, defaultCmd) {
  const { getProvider } = await import('./registry.js');
  const provider = getProvider(tool);
  return provider?.command || defaultCmd || tool;
}
