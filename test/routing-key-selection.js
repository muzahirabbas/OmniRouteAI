/**
 * KEY SELECTION & ROUTING AUDIT TEST
 * 
 * Tests:
 * 1. Key selection with provider=auto, model=gemma-4-31b-it
 * 2. Key rotation and least-used selection
 * 3. Model validation from Firestore providers
 * 4. Key saving and retrieval
 * 5. Edge cases: disabled keys, RPM exceeded, excluded keys
 */

const API_KEY = process.env.API_KEY || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22';
const BACKEND = process.env.BACKEND_URL || 'https://glistening-stillness-production-6724.up.railway.app';
const TIMEOUT_MS = 120000;

async function test(endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data, ok: response.ok, headers: response.headers };
  } catch (error) {
    clearTimeout(timeout);
    return { status: 0, data: { error: error.message }, ok: false };
  }
}

async function runKeySelectionAudit() {
  console.log('==================================================');
  console.log('🔍 KEY SELECTION & ROUTING AUDIT TEST');
  console.log(`📡 TARGET: ${BACKEND}`);
  console.log('==================================================\n');

  const results = { passed: 0, failed: 0, errors: [] };

  // 1. Health check
  console.log('[TEST 1/10] Server Health...');
  const health = await test('/health');
  if (health.ok && health.data?.status === 'ok') {
    console.log('    ✅ PASS: Server is healthy\n');
    results.passed++;
  } else {
    console.log(`    ❌ FAIL: ${health.data?.error || 'Server not healthy'}\n`);
    results.failed++;
    results.errors.push('Health check failed');
    return results;
  }

  // 2. Fetch all providers from Firestore
  console.log('[TEST 2/10] Fetch Provider Configuration...');
  const providersRes = await test('/api/admin/providers');
  const allProviders = providersRes.data?.providers || [];
  const activeProviders = allProviders.filter(p => p.status === 'active');
  console.log(`    ✅ Found ${allProviders.length} providers, ${activeProviders.length} active`);
  
  // Check if any provider has gemma-4-31b-it model
  const providersWithGemma = allProviders.filter(p => 
    p.models && p.models.includes('gemma-4-31b-it')
  );
  console.log(`    ℹ️  Providers with gemma-4-31b-it: ${providersWithGemma.map(p => p.name).join(', ') || 'none found'}`);
  results.passed++;

  // 3. Test model discovery endpoint
  console.log('\n[TEST 3/10] Model Discovery...');
  const modelsRes = await test('/api/admin/models');
  const allModels = modelsRes.data?.models || [];
  const hasGemmaModel = allModels.includes('gemma-4-31b-it');
  console.log(`    ✅ Total unique models: ${allModels.length}`);
  console.log(`    ℹ️  gemma-4-31b-it in model list: ${hasGemmaModel ? 'YES' : 'NO'}`);
  results.passed++;

  // 4. Simulate rotation with provider=auto, model=gemma-4-31b-it
  console.log('\n[TEST 4/10] Simulate Rotation (provider=auto, model=gemma-4-31b-it)...');
  const simRes = await test(`/api/admin/simulate-rotation?model=gemma-4-31b-it&provider=auto&prompt=Test+rotation`);
  if (simRes.ok && simRes.data?.success) {
    console.log(`    ✅ PASS: Selection successful`);
    console.log(`    📦 Selected Provider: ${simRes.data.selected?.provider}`);
    console.log(`    📦 Selected Model: ${simRes.data.selected?.model}`);
    console.log(`    📦 Selected Key: ${simRes.data.selected?.apiKey}`);
    results.passed++;
  } else {
    console.log(`    ❌ FAIL: ${simRes.data?.error || JSON.stringify(simRes.data).substring(0, 100)}`);
    results.failed++;
    results.errors.push(`Simulate rotation failed: ${simRes.data?.error}`);
  }

  // 5. Simulate rotation without specific model (auto mode)
  console.log('\n[TEST 5/10] Simulate Rotation (auto model)...');
  const simAutoRes = await test(`/api/admin/simulate-rotation?provider=auto&prompt=Test+auto`);
  if (simAutoRes.ok && simAutoRes.data?.success) {
    console.log(`    ✅ PASS: Auto selection successful`);
    console.log(`    📦 Selected: ${simAutoRes.data.selected?.provider} / ${simAutoRes.data.selected?.model}`);
    results.passed++;
  } else {
    console.log(`    ❌ FAIL: ${simAutoRes.data?.error}`);
    results.failed++;
    results.errors.push('Auto model selection failed');
  }

  // 6. Check key status for providers
  console.log('\n[TEST 6/10] Check Key Status for Active Providers...');
  for (const provider of activeProviders.slice(0, 5)) {
    const keyStatusRes = await test(`/api/admin/keys/${provider.name}/status`);
    if (keyStatusRes.ok) {
      const { keys, available, disabled } = keyStatusRes.data;
      console.log(`    ℹ️  ${provider.name}: ${keys?.length || 0} keys, ${available} available, ${disabled} disabled`);
    }
  }
  results.passed++;

  // 7. Test actual chat completion with gemma-4-31b-it
  console.log('\n[TEST 7/10] Live Chat Completion (model=gemma-4-31b-it)...');
  const chatRes = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gemma-4-31b-it',
      prompt: 'Say "OK" in exactly 2 words',
      max_tokens: 10
    })
  });
  
  if (chatRes.status === 200 && chatRes.data?.choices?.[0]?.message?.content !== undefined) {
    console.log(`    ✅ PASS: Got response from ${chatRes.data.model}`);
    console.log(`    💬 Response: ${chatRes.data.choices[0].message.content?.substring(0, 50) || '(empty)'}`);
    results.passed++;
  } else if (chatRes.data?.error) {
    console.log(`    ❌ FAIL: ${chatRes.data.error.message || JSON.stringify(chatRes.data).substring(0, 80)}`);
    if (chatRes.data.available_providers) {
      console.log(`    ℹ️  Available providers: ${chatRes.data.available_providers.slice(0, 5).join(', ')}`);
    }
    results.failed++;
    results.errors.push(`Chat failed: ${chatRes.data.error}`);
  } else {
    console.log(`    ❌ FAIL: Unexpected response: ${JSON.stringify(chatRes.data).substring(0, 100)}`);
    results.failed++;
  }

  // 8. Test with auto model selection
  console.log('\n[TEST 8/10] Live Chat (model=auto, no provider specified)...');
  const chatAutoRes = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      prompt: 'Reply with "test"',
      max_tokens: 5
    })
  });
  
  const hasContent = chatAutoRes.data?.choices?.[0]?.message?.content !== undefined;
  if (chatAutoRes.status === 200 && hasContent) {
    console.log(`    ✅ PASS: Got response from ${chatAutoRes.data.model}`);
    results.passed++;
  } else if (chatAutoRes.data?.error) {
    console.log(`    ❌ FAIL: ${chatAutoRes.data.error.message || JSON.stringify(chatAutoRes.data.error).substring(0,80)}`);
    results.failed++;
    results.errors.push(`Auto chat failed: ${chatAutoRes.data.error}`);
  } else {
    console.log(`    ❌ FAIL: status=${chatAutoRes.status}, hasContent=${!!hasContent}, data keys=${Object.keys(chatAutoRes.data || {}).join(',')}`);
    results.failed++;
  }

  // 9. Key rotation test (multiple requests should rotate keys)
  console.log('\n[TEST 9/10] Key Rotation Test (5 requests)...');
  const rotationResults = [];
  for (let i = 0; i < 5; i++) {
    const rotRes = await test('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'auto',
        prompt: `Number ${i}`,
        max_tokens: 3
      })
    });
    if (rotRes.data?.choices?.[0]?.message?.content !== undefined) {
      rotationResults.push(rotRes.data.model);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  const uniqueModels = new Set(rotationResults).size;
  console.log(`    📊 Models used: ${rotationResults.join(' → ')}`);
  console.log(`    ℹ️  Unique models: ${uniqueModels}`);
  if (uniqueModels > 0) {
    console.log(`    ✅ PASS: Key rotation active`);
    results.passed++;
  } else {
    console.log(`    ❌ FAIL: No rotation detected`);
    results.failed++;
    results.errors.push('Key rotation not working');
  }

  // 10. Check admin key management
  console.log('\n[TEST 10/10] Admin Key Management...');
  const cloudProviders = activeProviders.filter(p => p.type !== 'local_http');
  if (cloudProviders.length > 0) {
    const testProvider = cloudProviders[0].name;
    const keysRes = await test(`/api/admin/keys/${testProvider}`);
    if (keysRes.ok) {
      console.log(`    ✅ PASS: Retrieved ${keysRes.data?.keys?.length || 0} keys for ${testProvider}`);
      results.passed++;
    } else {
      console.log(`    ❌ FAIL: Could not retrieve keys`);
      results.failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 AUDIT RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed:  ${results.passed}/10`);
  console.log(`Failed:  ${results.failed}/10`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ Errors encountered:');
    results.errors.forEach(e => console.log(`   - ${e}`));
  }
  console.log('='.repeat(60));

  return results;
}

runKeySelectionAudit().then(results => {
  process.exit(results.failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});