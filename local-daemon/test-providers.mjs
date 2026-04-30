import { readFile, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * OmniRouteAI - Deep Provider & System Diagnostic Suite v2.0
 */

const DAEMON_URL = 'http://127.0.0.1:5059';
const HOME = homedir();
const CONFIG_DIR = join(HOME, '.omniroute', 'local-cli');
const TOKEN_FILE = join(CONFIG_DIR, 'token.txt');
const TOKENS_STORE = join(CONFIG_DIR, 'tokens.json');
const LOG_FILE = join(CONFIG_DIR, 'daemon.log');

async function getDaemonToken() {
  try { return (await readFile(TOKEN_FILE, 'utf8')).trim(); } 
  catch { return null; }
}

async function checkFile(path) {
  try { await access(path, constants.R_OK); return '✅ Readable'; }
  catch { return '❌ Missing/Locked'; }
}

async function runTest() {
  const token = await getDaemonToken();
  if (!token) {
    console.error('❌ Daemon token not found. Is the daemon initialized?');
    process.exit(1);
  }

  console.log('\n--- 🛠️  PHASE 1: System Audit ---\n');
  const systemResults = [
    { item: 'Config Directory', result: await checkFile(CONFIG_DIR) },
    { item: 'Daemon Secret', result: await checkFile(TOKEN_FILE) },
    { item: 'Encrypted Token Store', result: await checkFile(TOKENS_STORE) },
    { item: 'Active Log File', result: await checkFile(LOG_FILE) }
  ];
  console.table(systemResults);

  console.log('\n--- 🚀 PHASE 2: Provider Diagnostics ---\n');
  
  try {
    const statusRes = await fetch(`${DAEMON_URL}/auth/oauth-status`, {
      headers: { 'X-Local-Token': token }
    });
    if (!statusRes.ok) throw new Error(`Daemon unreachable (HTTP ${statusRes.status})`);
    
    const { providers } = await statusRes.json();
    const probeList = Object.entries(providers);
    const results = [];

    for (const [id, info] of probeList) {
      const start = Date.now();
      let status = '💤 Inactive';
      let latency = '-';
      let method = info.method || 'bridge';
      let outcome = 'Session required';

      if (info.active) {
        try {
          const testReq = await fetch(`${DAEMON_URL}/${id}`, {
            method: 'POST',
            headers: { 'X-Local-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: "Say 'OK'", model: "default" }),
            signal: AbortSignal.timeout(45000)
          });
          latency = `${Date.now() - start}ms`;
          const res = await testReq.json();
          if (res.success) {
            status = '✅ Success';
            outcome = res.output ? `CLI: ${res.output.trim().slice(0, 20)}...` : 'Direct API OK';
          } else {
            status = '❌ API Error';
            outcome = res.error || 'Unknown';
          }
        } catch (err) {
          status = '⚠️ Timeout';
          outcome = err.message;
        }
      }

      results.push({ Provider: id, Status: status, Latency: latency, Bridge: method, Result: outcome });
    }

    console.table(results);

    const activeCount = results.filter(r => r.Status.includes('✅') || r.Status.includes('❌') || r.Status.includes('⚠️')).length;
    
    if (activeCount === 0) {
      console.log('\n💡 ADVICE: All providers are currently INACTIVE.');
      console.log('1. Open https://omnirouteai.pages.dev and go to "Settings" -> "Local Auth".');
      console.log('2. Log in to Gemini or Claude to activate a session.');
      console.log('3. Re-run this test to verify the deep AI response cycle.\n');
    }

  } catch (err) {
    console.error(`❌ Diagnostic Aborted: ${err.message}`);
  }
}

runTest();
