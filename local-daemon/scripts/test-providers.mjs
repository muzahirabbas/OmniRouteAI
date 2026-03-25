#!/usr/bin/env node
/**
 * OmniRouteAI - Local CLI Provider Health Check Script
 * 
 * Tests all local CLI providers by sending a test prompt through the daemon.
 * Run AFTER starting the daemon.
 *
 * Usage:
 *   node scripts/test-providers.mjs
 *   node scripts/test-providers.mjs --provider gemini  (test one only)
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const DAEMON_URL   = 'http://127.0.0.1:5059';
const TOKEN_FILE   = join(homedir(), '.omniroute', 'local-cli', 'token.txt');
const TEST_PROMPT  = 'Say ONLY the word "pong". Nothing else.';
const TIMEOUT_MS   = 60_000;

// All local daemon providers to test
const PROVIDERS = [
  { name: 'qwen',        path: '/qwen' },
  { name: 'gemini',      path: '/gemini' },
  { name: 'claude',      path: '/claude' },
  { name: 'copilot',     path: '/copilot' },
  { name: 'grok',        path: '/grok' },
  { name: 'zai',         path: '/zai' },
  { name: 'kimi',        path: '/kimi' },
  { name: 'codex',       path: '/codex' },
  { name: 'kilo',        path: '/kilo' },
  { name: 'opencode',    path: '/opencode' },
  { name: 'antigravity', path: '/antigravity' },
  { name: 'ollama',      path: '/ollama/health', method: 'GET', isHealth: true },
];

// ─── Helpers ───────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function log(level, msg) {
  const ts    = new Date().toLocaleTimeString();
  const color = level === 'OK' ? GREEN : level === 'FAIL' ? RED : YELLOW;
  console.log(`[${ts}] ${color}${BOLD}${level}${RESET} ${msg}`);
}

async function getToken() {
  if (!existsSync(TOKEN_FILE)) {
    throw new Error(`Token file not found: ${TOKEN_FILE}`);
  }
  return (await readFile(TOKEN_FILE, 'utf8')).trim();
}

async function testProvider(provider, token) {
  const url     = `${DAEMON_URL}${provider.path}`;
  const method  = provider.method || 'POST';
  const headers = { 'X-Local-Token': token };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const body = method === 'POST' 
      ? JSON.stringify({ prompt: TEST_PROMPT }) 
      : undefined;
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    clearTimeout(timer);

    const data = await res.json();

    if (provider.isHealth) {
      const ok = data.status === 'running';
      return { ok, detail: ok ? `${data.models?.length || 0} models` : data.error || 'offline' };
    }

    const ok = res.ok && !!data.output;
    return { ok, detail: ok ? data.output?.slice(0, 80) : (data.error || `HTTP ${res.status}`) };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return { ok: false, detail: isTimeout ? 'TIMEOUT' : err.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const filterArg = process.argv.find((a, i) => process.argv[i - 1] === '--provider');
  const providers  = filterArg ? PROVIDERS.filter(p => p.name === filterArg) : PROVIDERS;

  console.log(`\n${BOLD}OmniRouteAI — Local Provider Health Check${RESET}`);
  console.log(`Daemon: ${DAEMON_URL}`);
  console.log(`Testing ${providers.length} provider(s)...\n`);

  // First check daemon is alive
  try {
    const res = await fetch(`${DAEMON_URL}/health`);
    const data = await res.json();
    log('OK', `Daemon is running — ${data.status}`);
  } catch {
    log('FAIL', 'Daemon is not running! Start it first: node src/main.js');
    process.exit(1);
  }

  let token;
  try {
    token = await getToken();
    log('OK', `Token loaded`);
  } catch (err) {
    log('FAIL', err.message);
    process.exit(1);
  }

  console.log('');
  const results = [];

  for (const provider of providers) {
    process.stdout.write(`  Testing ${provider.name.padEnd(15)} ... `);
    const { ok, detail } = await testProvider(provider, token);
    results.push({ name: provider.name, ok, detail });
    const symbol = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`${symbol}  ${detail}`);
  }

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log(`\n${BOLD}─────────── Summary ───────────${RESET}`);
  console.log(`${GREEN}Passed: ${passed}${RESET}  ${RED}Failed: ${failed}${RESET}  Total: ${results.length}`);

  if (failed > 0) {
    console.log(`\n${BOLD}Failed providers:${RESET}`);
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  ${RED}✗ ${r.name}${RESET}: ${r.detail}`);
    });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
