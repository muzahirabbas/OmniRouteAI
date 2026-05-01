/**
 * COMPREHENSIVE SYSTEM TEST
 * 
 * Performs:
 * 1. System Health Check (Redis/Firestore)
 * 2. Active Provider Discovery
 * 3. Connectivity Test for EVERY active provider (Chat)
 * 4. Automatic Rotation Verification
 */

const API_KEY = process.env.API_KEY || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22';
const BACKEND = process.env.BACKEND_URL || 'https://omnirouterai-production.up.railway.app';

async function api(path, options = {}) {
  try {
    const res = await fetch(`${BACKEND}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    const data = await res.json();
    return { status: res.status, data, ok: res.ok };
  } catch (err) {
    return { status: 0, data: { error: err.message }, ok: false };
  }
}

async function run() {
  console.log('==================================================');
  console.log('🚀 OMNIROUTE AI COMPREHENSIVE TEST');
  console.log(`📡 TARGET: ${BACKEND}`);
  console.log('==================================================\n');

  // 1. Health Check
  console.log('STEP 1: System Health Check...');
  const health = await api('/api/admin/health');
  if (health.ok && health.data.status === 'healthy') {
    console.log(`✅ System Healthy (Redis: ${health.data.redis}, Firestore: ${health.data.firestore})\n`);
  } else {
    console.log(`❌ System Degraded: ${JSON.stringify(health.data)}\n`);
  }

  // 2. Discover Active Providers
  console.log('STEP 2: Discovering Active Providers...');
  const providersRes = await api('/api/admin/providers');
  const allProviders = providersRes.data.providers || [];
  const activeProviders = allProviders.filter(p => !p.disabled && p.status === 'active');
  console.log(`ℹ️ Found ${activeProviders.length} active providers out of ${allProviders.length} total.\n`);

  // 3. Test Connectivity for EACH Active Provider
  console.log('STEP 3: Testing Connectivity (Individual Toggles)...');
  const results = [];
  for (const p of activeProviders) {
    process.stdout.write(`   Testing ${p.name.padEnd(20)} ... `);
    const start = Date.now();
    const chatRes = await api('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        provider: p.name,
        max_tokens: 5
      })
    });
    const end = Date.now();
    
    if (chatRes.ok) {
      console.log(`✅ PASS (${end - start}ms)`);
      results.push({ name: p.name, success: true, latency: end - start });
    } else {
      console.log(`❌ FAIL (Status ${chatRes.status})`);
      console.log(`      Error: ${chatRes.data.error?.message || JSON.stringify(chatRes.data).substring(0, 100)}`);
      results.push({ name: p.name, success: false, error: chatRes.data.error?.message });
    }
  }

  // 4. Rotation Test (Auto-routing)
  console.log('\nSTEP 4: Rotation Verification (Auto-routing)...');
  const rotation = [];
  for (let i = 0; i < 5; i++) {
    const res = await api('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'auto',
        max_tokens: 5
      })
    });
    const used = res.data.provider || 'unknown';
    rotation.push(used);
    process.stdout.write(`   Req ${i+1}: ${used}\n`);
  }
  const unique = new Set(rotation).size;
  console.log(`ℹ️ Rotation Path: ${rotation.join(' ➔ ')}`);
  console.log(unique > 1 ? '✅ PASS: Multi-provider rotation detected.' : '⚠️ INFO: Single provider used (expected if high priority keys available).');

  // Final Summary
  console.log('\n==================================================');
  const passed = results.filter(r => r.success).length;
  console.log(`📊 SUMMARY: ${passed}/${results.length} Providers Responding`);
  console.log('==================================================\n');
}

run().catch(console.error);
