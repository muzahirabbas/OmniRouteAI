import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.omniroute', 'local-cli');
const LOG_FILE = () => join(CONFIG_DIR, 'daemon.log');
const MAX_SIZE = 10 * 1024 * 1024;

let _stream = null;
let _bytesWritten = (() => {
  try { return statSync(LOG_FILE()).size; } catch { return 0; }
})();

function getStream() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!_stream) {
    _stream = createWriteStream(LOG_FILE(), { flags: 'a', encoding: 'utf8' });
    _stream.on('error', (err) => {
      process.stderr.write(`[logger] Write error: ${err.message}\n`);
    });
  }
  return _stream;
}

function rotate() {
  if (_stream) {
    _stream.end();
    _stream = null;
    _bytesWritten = 0;
    try {
      const logFile = LOG_FILE();
      if (existsSync(logFile)) {
        renameSync(logFile, logFile + '.old');
      }
    } catch {}
  }
}

function write(level, msg, fields = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...fields,
  }) + '\n';

  _bytesWritten += Buffer.byteLength(entry, 'utf8');
  if (_bytesWritten > MAX_SIZE) rotate();

  getStream().write(entry);
}

export const log = {
  info: (msg, fields = {}) => write('info', msg, fields),
  warn: (msg, fields = {}) => write('warn', msg, fields),
  error: (msg, fields = {}) => write('error', msg, fields),
  debug: (msg, fields = {}) => write('debug', msg, fields),

  request: (entry) => {
    write('request', 'CLI execution', {
      tool: entry.tool,
      command: entry.command,
      prompt: (entry.prompt || '').slice(0, 120),
      duration: entry.duration,
      exitCode: entry.exitCode,
      success: entry.success,
      ...(entry.error ? { error: entry.error } : {}),
    });
  },
};

export function getLogPath() { return LOG_FILE(); }
