const API_KEY = process.env.API_KEY || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA';
const BACKEND_URL = process.env.BACKEND_URL || 'https://glistening-stillness-production-6724.up.railway.app';

async function testMultimodal() {
  console.log('=== Testing Multimodal Content Schema ===\n');

  // Test 1: Simple text message (should work)
  console.log('[1/3] Testing simple text message...');
  const textRes = await fetch(`${BACKEND_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'user', content: 'Say hi' }
      ],
      max_tokens: 5
    })
  });
  console.log(`  Status: ${textRes.status} ${textRes.ok ? '✅' : '❌'}`);

  // Test 2: Multimodal array content (the main fix)
  console.log('\n[2/3] Testing multimodal array content...');
  const multimodalRes = await fetch(`${BACKEND_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { 
          role: 'user', 
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', detail: 'low' } }
          ]
        }
      ],
      max_tokens: 10
    })
  });
  const multimodalData = await multimodalRes.json();
  console.log(`  Status: ${multimodalRes.status} ${multimodalRes.ok ? '✅' : '❌'}`);
  if (!multimodalRes.ok) {
    console.log(`  Error: ${JSON.stringify(multimodalData).substring(0, 200)}`);
  }

  // Test 3: Tool calling message
  console.log('\n[3/3] Testing tool message...');
  const toolRes = await fetch(`${BACKEND_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'test', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_123', content: 'Result' }
      ],
      max_tokens: 5
    })
  });
  console.log(`  Status: ${toolRes.status} ${toolRes.ok ? '✅' : '❌'}`);

  console.log('\n=== Tests Complete ===');
}

testMultimodal().catch(console.error);
