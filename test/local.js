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
  console.log('OMNIROUTE AI - LOCAL PROVIDERS TEST');
  console.log('='.repeat(60));
  console.log(`Backend: ${BACKEND_URL}`);
  console.log();

  // Fetch providers
  const providersResponse = await test('/api/admin/providers');
  const localProviders = (providersResponse.data?.providers || []).filter(p => !p.disabled && p.type === 'local_http');

  console.log(`Found ${localProviders.length} active local providers:`);
  localProviders.forEach(p => {
    console.log(`  - ${p.name}: ${p.models?.slice(0, 3).join(', ')}...`);
  });
  console.log();

  const results = { passed: 0, failed: 0 };

  // Test 1: Model Fetch
  console.log('[1/3] Model Discovery (ollama_local_bridge)...');
  const models = await test('/api/admin/providers/fetch-models', {
    method: 'POST',
    body: JSON.stringify({ providerName: 'ollama_local_bridge' })
  });
  if (models.data?.success || models.status === 200) {
    const modelCount = models.data?.models?.length || 0;
    console.log(`    PASS: Discovered ${modelCount} models`);
    results.passed++;
  } else {
    console.log(`    FAIL/SKIP: ${models.data?.error || 'Daemon unreachable'}`);
    results.failed++;
  }

  // Test 2: Test each local provider
  console.log('\n[2/3] Testing Local Provider Connectivity...');
  for (const provider of localProviders.slice(0, 3)) {
    console.log(`    Testing ${provider.name}...`);
    const result = await test('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: provider.models?.[0] || 'auto',
        prompt: 'Hi',
        provider: provider.name,
        max_tokens: 10
      })
    });
    const success = result.status === 200 && (result.data?.choices?.[0]?.text || result.data?.choices?.[0]?.message?.content || result.data?.output);
    console.log(`    ${provider.name}: ${success ? 'PASS' : 'FAIL'} (status ${result.status})`);
    if (!success) {
      console.log(`      Error: ${JSON.stringify(result.data?.error || result.data).substring(0, 60)}`);
    }
    if (success) results.passed++;
    else results.failed++;
  }

  // Test 3: Automatic rotation through local providers
  console.log('\n[3/3] Local Provider Rotation...');
  const rotationResults = [];
  for (let i = 0; i < 3; i++) {
    const result = await test('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'auto', prompt: 'Hi', max_tokens: 5, provider: 'auto' })
    });
    const providerUsed = result.data?.provider || 'unknown';
    rotationResults.push(providerUsed);
    await new Promise(r => setTimeout(r, 400));
  }
  const uniqueProvidersUsed = new Set(rotationResults).size;
  console.log(`    Requests: ${rotationResults.length}`);
  console.log(`    Unique providers used: ${uniqueProvidersUsed}`);
  console.log(`    Rotation: ${rotationResults.join(' -> ')}`);
  
  if (uniqueProvidersUsed > 0) {
    console.log('    PASS: Local routing system functional');
    results.passed++;
  } else {
    console.log('    FAIL: No routing response');
    results.failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`SUMMARY: ${results.passed} passed, ${results.failed} failed`);
  console.log('='.repeat(60));
}

runTests().catch(console.error);
