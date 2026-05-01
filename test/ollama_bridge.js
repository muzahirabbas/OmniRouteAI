/**
 * Test script for Ollama Local Bridge
 * Usage: node test/ollama_bridge.js
 */

const API_KEY = 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22';
const BACKEND_URL = 'https://omnirouterai-production.up.railway.app';
const TIMEOUT_MS = 90000; // Ollama might be slow if loading models

async function testRequest(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  console.log(`\nTesting model: ${payload.model || 'auto'}`);
  console.log(`Provider: ${payload.provider || 'auto'}`);
  
  try {
    const start = Date.now();
    const response = await fetch(`${BACKEND_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log(`❌ FAILED (Status ${response.status}) in ${duration}s`);
      console.log(`   Error: ${JSON.stringify(errorData.error || errorData)}`);
      return false;
    }
    
    const data = await response.json();
    console.log(`✅ SUCCESS in ${duration}s`);
    console.log(`   Provider used: ${data.provider}`);
    console.log(`   Model used: ${data.model}`);
    const output = data.output || data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
    console.log(`   Output: ${output.substring(0, 100).replace(/\n/g, ' ')}...`);
    return true;
  } catch (error) {
    clearTimeout(timeout);
    console.log(`❌ ERROR: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('OMNIROUTE AI - OLLAMA LOCAL BRIDGE TEST');
  console.log('='.repeat(60));
  console.log(`Backend: ${BACKEND_URL}`);
  console.log();

  const results = { passed: 0, failed: 0 };

  // Test 1: Ollama with Auto/Default model
  const test1 = await testRequest({
    provider: 'ollama_local_bridge',
    model: 'auto',
    prompt: 'Say hello in exactly 5 words.',
    max_tokens: 50
  });
  if (test1) results.passed++; else results.failed++;

  // Test 2: Ollama with specific Abliterated model
  const test2 = await testRequest({
    provider: 'ollama_local_bridge',
    model: 'huihui_ai/lfm2.5-abliterated:latest',
    prompt: 'Who are you?',
    max_tokens: 50
  });
  if (test2) results.passed++; else results.failed++;

  console.log('\n' + '='.repeat(60));
  console.log(`SUMMARY: ${results.passed} passed, ${results.failed} failed`);
  console.log('='.repeat(60));
}

runTests().catch(console.error);
