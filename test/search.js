/**
 * SEARCH PROVIDERS TEST
 * 
 * Tests all enabled search providers by hitting the /v1/search endpoint.
 * Requires API keys to be configured in the backend.
 * 
 * Usage:
 *   node test/search.js
 *   BACKEND_URL=https://your-backend.com API_KEY=your-key node test/search.js
 */

const API_KEY = process.env.API_KEY || 'test-api-key';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_QUERY = 'What is the capital of France?';

const TIMEOUT_MS = 30000;

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
    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    clearTimeout(timeout);
    return { status: 0, data: { error: error.message }, ok: false };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('OMNIROUTE AI - SEARCH PROVIDERS TEST');
  console.log('='.repeat(60));
  console.log(`Backend: ${BACKEND_URL}`);
  console.log(`Query: "${TEST_QUERY}"`);
  console.log();

  const results = { passed: 0, failed: 0, skipped: 0 };

  // 1. Fetch Search Providers List
  console.log('[1/4] Fetch Search Providers List...');
  const providersList = await test('/api/admin/search-providers');
  if (providersList.ok && providersList.data?.providers) {
    console.log(`    PASS: Found ${providersList.data.providers.length} search providers`);
    results.passed++;
  } else {
    console.log(`    FAIL: ${JSON.stringify(providersList.data)}`);
    results.failed++;
    return;
  }

  // 2. Fetch Available Models (Search Provider IDs)
  console.log('\n[2/4] Fetch Search Models...');
  const models = await test('/v1/search/models');
  if (models.ok && models.data?.data) {
    console.log(`    PASS: Found ${models.data.data.length} search providers`);
    results.passed++;
  } else {
    console.log(`    FAIL: ${JSON.stringify(models.data)}`);
    results.failed++;
  }

  // 3. Test Global Search Endpoint
  console.log('\n[3/4] Test Global Search (/v1/search)...');
  const globalSearch = await test('/v1/search', {
    method: 'POST',
    body: JSON.stringify({ query: TEST_QUERY, max_results: 3 })
  });
  if (globalSearch.ok && globalSearch.data?.results) {
    console.log(`    PASS: Got ${globalSearch.data.results.length} results`);
    console.log(`    Provider: ${globalSearch.data.provider}`);
    if (globalSearch.data.results[0]) {
      console.log(`    Top result: ${globalSearch.data.results[0].title?.slice(0, 50)}...`);
    }
    results.passed++;
  } else {
    console.log(`    FAIL: ${JSON.stringify(globalSearch.data).slice(0, 200)}`);
    results.failed++;
  }

  // 4. Test Each Search Provider
  console.log('\n[4/4] Test Individual Search Providers...');
  const providerNames = ['tavily', 'brave', 'serper', 'exa', 'duckduckgo'];
  let providerResults = 0;

  for (const provider of providerNames) {
    process.stdout.write(`    Testing ${provider}... `);
    
    const result = await test(`/${provider}/v1/search`, {
      method: 'POST',
      body: JSON.stringify({ query: TEST_QUERY, max_results: 3 })
    });

    if (result.ok && result.data?.results) {
      console.log(`✓ Got ${result.data.results.length} results`);
      providerResults++;
    } else if (result.status === 404) {
      console.log(`⚠ Provider not found (no adapter?)`);
      results.skipped++;
    } else if (result.status === 400 || result.status === 401) {
      console.log(`⚠ No API key configured`);
      results.skipped++;
    } else {
      console.log(`✗ ${result.data?.error || result.status}`);
      results.failed++;
    }
  }

  if (providerResults > 0) {
    console.log(`    PASS: ${providerResults}/${providerNames.length} providers working`);
    results.passed++;
  } else {
    console.log(`    FAIL: No providers working`);
    results.failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed:  ${results.passed}`);
  console.log(`Failed:  ${results.failed}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log();

  if (results.failed === 0) {
    console.log('🎉 All critical tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }
}

runTests();
