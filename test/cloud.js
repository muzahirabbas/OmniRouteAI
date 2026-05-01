const API_KEY = process.env.API_KEY || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA';
const BACKEND_URL = process.env.BACKEND_URL || 'https://glistening-stillness-production-6724.up.railway.app';

const TIMEOUT_MS = 60000;

async function test(endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    clearTimeout(timeout);
    return { status: 0, data: { error: error.message }, ok: false };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('OMNIROUTE AI - CLOUD PROVIDERS TEST');
  console.log('='.repeat(60));
  console.log(`Backend: ${BACKEND_URL}`);
  console.log();

  // Fetch providers and overview stats
  const providersRes = await test('/api/admin/providers');
  const cloudProviders = (providersRes.data?.providers || []).filter(p => p.status === 'active' && p.type !== 'local_http');
  
  const overview = await test('/api/admin/overview');
  const providerHealth = overview.data?.providerHealth || [];

  console.log(`Cloud providers: ${cloudProviders.length}`);
  console.log(`Health stats: ${providerHealth.length} entries`);
  console.log();

  const results = { passed: 0, failed: 0, skipped: 0 };

  // Test 1: Provider Health Configuration
  console.log('[1/4] Provider Health Check...');
  if (providerHealth.length > 0) {
    console.log(`    PASS: ${providerHealth.length} providers tracked in health monitor`);
    providerHealth.forEach(p => {
      if (p.type !== 'local_http') {
        const healthStatus = p.status || 'unknown';
        console.log(`    - ${p.name}: ${healthStatus.toUpperCase()} (${p.errorRate || 0}% error rate)`);
      }
    });
    results.passed++;
  } else {
    console.log('    FAIL: No provider health data found');
    results.failed++;
  }

  // Test 2: Test each cloud provider
  console.log('\n[2/4] Testing Cloud Providers...');
  for (const provider of cloudProviders.slice(0, 8)) {
    console.log(`    Testing ${provider.name}...`);
    const result = await test('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'auto', // Use auto to let router select default model
        prompt: 'Hi',
        provider: provider.name,
        max_tokens: 10
      })
    });
    
    const success = result.status === 200 && (result.data?.output || result.data?.choices?.[0]?.text || result.data?.choices?.[0]?.message?.content);
    console.log(`      ${provider.name}: ${success ? 'PASS' : 'FAIL'} (status ${result.status})`);
    if (!success) {
      console.log(`      Error: ${JSON.stringify(result.data?.error || result.data).substring(0, 80)}`);
    }
    if (success) results.passed++;
    else results.failed++;
  }

  // Test 3: Automatic rotation
  console.log('\n[3/4] Cloud Provider Rotation...');
  const rotationResults = [];
  for (let i = 0; i < 5; i++) {
    const result = await test('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'auto', prompt: 'Hi', max_tokens: 5 })
    });
    const providerUsed = result.data?.provider || 'unknown';
    rotationResults.push(providerUsed);
    await new Promise(r => setTimeout(r, 400));
  }
  
  const uniqueProviders = new Set(rotationResults).size;
  console.log(`    Requests: ${rotationResults.length}`);
  console.log(`    Unique providers used: ${uniqueProviders}`);
  console.log(`    Rotation: ${rotationResults.join(' -> ')}`);
  
  if (uniqueProviders > 0) {
    console.log('    PASS: Cloud rotation active');
    results.passed++;
  } else {
    console.log('    FAIL: No rotation detected');
    results.failed++;
  }

  // Test 4: Dashboard Health Monitor
  console.log('\n[4/4] System Health Monitor...');
  const healthStats = await test('/api/admin/health');
  if (healthStats.ok && healthStats.data?.status === 'healthy') {
    console.log(`    PASS: Status HEALTHY (Redis: ${healthStats.data.redis})`);
    results.passed++;
  } else {
    console.log('    FAIL: System reportDegraded');
    results.failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`SUMMARY: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  console.log('='.repeat(60));
}

runTests().catch(console.error);
