import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

/**
 * JSON file logger for the local daemon.
 *
 * Log location: ~/.omniroute/local-cli/daemon.log
 *
 * Each line is a JSON object:
 * { "timestamp": "...", "level": "info", "msg": "...", ...fields }
 *
 * Rotates at ~10MB by renaming to daemon.log.old and starting fresh.
 */

const LOG_FILE   = () => join(getConfigDir(), 'daemon.log');
const MAX_SIZE   = 10 * 1024 * 1024; // 10MB
let _stream      = null;
let _bytesWritten = 0;

function getStream() {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

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
    // Rename old log to .old (overwrites any previous .old)
    try {
      const logFile = LOG_FILE();
      if (existsSync(logFile)) {
        renameSync(logFile, logFile + '.old');
      }
    } catch { /* ignore rename errors */ }
  }
}

function write(level, msg, fields = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...fields,
  }) + '\n';

  _bytesWritten += entry.length;
  if (_bytesWritten > MAX_SIZE) rotate();

  getStream().write(entry);
}

export const log = {
  info:  (msg, fields = {}) => { write('info',  msg, fields); },
  warn:  (msg, fields = {}) => { write('warn',  msg, fields); },
  error: (msg, fields = {}) => { write('error', msg, fields); },
  debug: (msg, fields = {}) => { write('debug', msg, fields); },

  /**
   * Structured log for a CLI execution.
   *
   * @param {object} entry
   * @param {string}  entry.tool
   * @param {string}  entry.command
   * @param {string}  entry.prompt   - truncated
   * @param {number}  entry.duration - ms
   * @param {number}  entry.exitCode
   * @param {boolean} entry.success
   * @param {string}  [entry.error]
   */
  request: (entry) => {
    write('request', 'CLI execution', {
      tool:     entry.tool,
      command:  entry.command,
      prompt:   (entry.prompt || '').slice(0, 120),
      duration: entry.duration,
      exitCode: entry.exitCode,
      success:  entry.success,
      ...(entry.error ? { error: entry.error } : {}),
    });
  },
};

export function getLogPath() { return LOG_FILE(); }
