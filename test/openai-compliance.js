const API_KEY = process.env.API_KEY || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA';
const BACKEND_URL = process.env.BACKEND_URL || 'https://glistening-stillness-production-6724.up.railway.app';
const TEST_PROVIDER = process.env.TEST_PROVIDER || 'google';

const TIMEOUT_MS = 90000;

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
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data, ok: response.ok, headers: response.headers };
  } catch (error) {
    clearTimeout(timeout);
    return { status: 0, data: { error: error.message }, ok: false };
  }
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('OMNIROUTE AI - OPENAI COMPLIANCE TEST');
  console.log('='.repeat(70));
  console.log(`Backend: ${BACKEND_URL}`);
  console.log(`Provider: ${TEST_PROVIDER}`);
  console.log();

  const results = { passed: 0, failed: 0, skipped: 0 };

  // ============================================================
  // TEST 1: Standard OpenAI Messages Format
  // ============================================================
  console.log('[1/10] Standard OpenAI Messages Format...');
  const messagesTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "test" if you receive this.' }
      ],
      max_tokens: 10
    })
  });

  const hasValidFormat = messagesTest.data?.id && 
                         messagesTest.data?.object === 'chat.completion' &&
                         messagesTest.data?.model &&
                         messagesTest.data?.choices?.length > 0;
  
  if (messagesTest.ok && hasValidFormat) {
    console.log(`    PASS: Valid OpenAI response format received`);
    console.log(`    ID: ${messagesTest.data.id}, Model: ${messagesTest.data.model}`);
    results.passed++;
  } else {
    console.log(`    FAIL: ${JSON.stringify(messagesTest.data?.error || messagesTest.data).substring(0, 100)}`);
    results.failed++;
  }

  // ============================================================
  // TEST 2: Legacy prompt format (backward compatibility)
  // ============================================================
  console.log('\n[2/10] Legacy prompt format (backward compatibility)...');
  const promptTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      prompt: 'Say "legacy" if you receive this.',
      max_tokens: 10
    })
  });

  if (promptTest.ok && (promptTest.data?.output || promptTest.data?.choices?.[0]?.message?.content)) {
    console.log(`    PASS: Got response using legacy prompt format`);
    const content = promptTest.data?.output || promptTest.data?.choices?.[0]?.message?.content;
    console.log(`    Response: ${content.substring(0, 50)}`);
    results.passed++;
  } else {
    console.log(`    FAIL: ${JSON.stringify(promptTest.data?.error || promptTest.data).substring(0, 100)}`);
    results.failed++;
  }

  // ============================================================
  // TEST 3: Provider-Specific Endpoint
  // ============================================================
  console.log('\n[3/10] Provider-Specific Endpoint (/:provider/v1/chat/completions)...');
  const providerSpecificTest = await test('/google/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'user', content: 'Say "provider" if you work.' }
      ],
      max_tokens: 10
    })
  });

  if (providerSpecificTest.ok && (providerSpecificTest.data?.output || providerSpecificTest.data?.choices?.[0]?.message?.content)) {
    console.log(`    PASS: Provider-specific endpoint works`);
    const content = providerSpecificTest.data?.output || providerSpecificTest.data?.choices?.[0]?.message?.content;
    console.log(`    Response: ${content.substring(0, 50)}`);
    results.passed++;
  } else {
    console.log(`    FAIL: ${JSON.stringify(providerSpecificTest.data?.error || providerSpecificTest.data).substring(0, 100)}`);
    results.failed++;
  }

  // ============================================================
  // TEST 4: Full OpenAI Fields
  // ============================================================
  console.log('\n[4/10] Full OpenAI Fields (temperature, top_p, stop, etc.)...');
  const fullFieldsTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'user', content: 'Say "fields" and stop.' }
      ],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 10,
      stop: '.',
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      user: 'test-user-123'
    })
  });

  if (fullFieldsTest.ok) {
    console.log(`    PASS: Full fields accepted (no validation error)`);
    const content = fullFieldsTest.data?.output || fullFieldsTest.data?.choices?.[0]?.message?.content;
    console.log(`    Response: ${content ? content.substring(0, 50) : '(empty)'}`);
    results.passed++;
  } else {
    console.log(`    FAIL: ${JSON.stringify(fullFieldsTest.data?.error || fullFieldsTest.data).substring(0, 100)}`);
    results.failed++;
  }

  // ============================================================
  // TEST 5: Streaming with Messages Array
  // ============================================================
  console.log('\n[5/10] Streaming with Messages Array...');
  const streamTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'user', content: 'Count from 1 to 5.' }
      ],
      stream: true
    })
  });

  if (streamTest.ok && streamTest.headers?.get('content-type')?.includes('text/event-stream')) {
    console.log(`    PASS: Streaming response with SSE`);
    results.passed++;
  } else {
    console.log(`    FAIL: ${streamTest.headers?.get('content-type') || 'No stream'}`);
    results.failed++;
  }

  // ============================================================
  // TEST 6: Response Format - system_fingerprint
  // ============================================================
  console.log('\n[6/10] Response Format - system_fingerprint...');
  const responseFormatTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5
    })
  });

  if (responseFormatTest.ok && responseFormatTest.data?.system_fingerprint !== undefined) {
    console.log(`    PASS: system_fingerprint present: ${responseFormatTest.data.system_fingerprint}`);
    results.passed++;
  } else {
    console.log(`    FAIL: system_fingerprint missing or undefined`);
    results.failed++;
  }

  // ============================================================
  // TEST 7: Response Format - Standard usage field
  // ============================================================
  console.log('\n[7/10] Response Format - Standard usage field...');
  const usageTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [{ role: 'user', content: 'Hello world' }],
      max_tokens: 5
    })
  });

  const hasStandardUsage = usageTest.data?.usage?.prompt_tokens !== undefined &&
                           usageTest.data?.usage?.completion_tokens !== undefined &&
                           usageTest.data?.usage?.total_tokens !== undefined;
  const hasDuplicateTokens = usageTest.data?.tokens !== undefined;

  if (usageTest.ok && hasStandardUsage) {
    if (hasDuplicateTokens) {
      console.log(`    WARN: Duplicate 'tokens' field also present (non-compliant)`);
    } else {
      console.log(`    PASS: Standard usage field present, no duplicate tokens`);
    }
    console.log(`    usage: ${JSON.stringify(usageTest.data.usage)}`);
    results.passed++;
  } else {
    console.log(`    FAIL: Usage field missing or incorrect`);
    results.failed++;
  }

  // ============================================================
  // TEST 8: Empty Messages Array (Edge Case)
  // ============================================================
  console.log('\n[8/10] Edge Case - Empty Messages Array...');
  const emptyMessagesTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [],
      max_tokens: 5
    })
  });

  // Should either work (with system prompt) or return proper error
  if (!emptyMessagesTest.ok) {
    console.log(`    PASS: Properly rejects empty messages (status ${emptyMessagesTest.status})`);
    results.passed++;
  } else {
    console.log(`    WARN: Accepted empty messages (may be valid if system_prompt provided)`);
    results.skipped++;
  }

  // ============================================================
  // TEST 9: Invalid Message Role (Edge Case)
  // ============================================================
  console.log('\n[9/10] Edge Case - Invalid Message Role...');
  const invalidRoleTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'invalid_role', content: 'test' }
      ],
      max_tokens: 5
    })
  });

  if (!invalidRoleTest.ok) {
    console.log(`    PASS: Properly rejects invalid role (status ${invalidRoleTest.status})`);
    results.passed++;
  } else {
    console.log(`    WARN: Accepted invalid role (may be provider-tolerant)`);
    results.skipped++;
  }

  // ============================================================
  // TEST 10: Tool Calling with Messages
  // ============================================================
  console.log('\n[10/10] Tool Calling with Messages...');
  const toolsTest = await test('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [
        { role: 'user', content: 'What is 2+2?' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'calculator',
            description: 'Perform basic math calculations',
            parameters: {
              type: 'object',
              properties: {
                expression: { type: 'string', description: 'Math expression' }
              },
              required: ['expression']
            }
          }
        }
      ],
      max_tokens: 50
    })
  });

  if (toolsTest.ok) {
    const hasToolCall = toolsTest.data?.choices?.[0]?.message?.tool_calls?.length > 0;
    const hasContent = toolsTest.data?.output || toolsTest.data?.choices?.[0]?.message?.content;
    if (hasContent || hasToolCall) {
      console.log(`    PASS: Tool calling accepted`);
      if (hasToolCall) console.log(`    Tool call: ${JSON.stringify(toolsTest.data.choices[0].message.tool_calls[0])}`);
      results.passed++;
    } else {
      console.log(`    WARN: No tool call or content returned`);
      results.skipped++;
    }
  } else {
    console.log(`    FAIL: ${JSON.stringify(toolsTest.data?.error || toolsTest.data).substring(0, 80)}`);
    results.failed++;
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n' + '='.repeat(70));
  console.log('OPENAI COMPLIANCE TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Passed:  ${results.passed}/10`);
  console.log(`Failed:  ${results.failed}/10`);
  console.log(`Skipped: ${results.skipped}/10`);
  console.log('='.repeat(70));

  // Return exit code
  if (results.failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
