/**
 * ENABLED-PROVIDER CONNECTIVITY TEST
 *
 * For every active cloud provider in the deployed OmniRouteAI:
 *   - Send a minimal chat completion
 *   - Classify the response
 *   - Cross-reference with the static-config audit table
 *
 * No source files are touched. No retries on 401 (so every misrouted
 * provider shows up on the first pass).
 *
 * Usage:
 *   node test/enabled-providers.js
 *   API_KEY=xxx BACKEND_URL=https://... node test/enabled-providers.js
 */

const API_KEY    = process.env.API_KEY     || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22x8';
const BACKEND    = process.env.BACKEND_URL || 'https://omni-routeam-main-production.up.railway.app';
const TIMEOUT_MS = 60000;
const RETRY_ON_5XX = 1;

// ─── Audit table: expected URL per provider (from src/config/providers.js) ───
const EXPECTED_URLS = {
  openai:              'https://api.openai.com/v1/chat/completions',
  anthropic:           'https://api.anthropic.com/v1/messages',
  google:              'https://generativelanguage.googleapis.com/v1beta/models/',
  xai:                 'https://api.x.ai/v1/chat/completions',
  alibaba:             'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  openrouter:          'https://openrouter.ai/api/v1/chat/completions',
  groq:                'https://api.groq.com/openai/v1/chat/completions',
  deepseek:            'https://api.deepseek.com/v1/chat/completions',
  moonshot:            'https://api.moonshot.cn/v1/chat/completions',
  together:            'https://api.together.xyz/v1/chat/completions',
  fireworks:           'https://api.fireworks.ai/inference/v1/chat/completions',
  hyperbolic:          'https://api.hyperbolic.xyz/v1/chat/completions',
  chutes:              'https://llm.chutes.ai/v1/chat/completions',
  nanobanana:          'https://api.nanobananaapi.ai/v1/chat/completions',
  opencode_zen:        'https://opencode.ai/zen/v1/chat/completions',
  modelscope:          'https://api-inference.modelscope.cn/v1/chat/completions',
  kilo:                'https://api.kilo.ai/api/gateway/chat/completions',
  'vercel-ai-gateway': 'https://ai-gateway.vercel.sh/v1/chat/completions',
  github_models:       'https://models.github.ai/inference/chat/completions',
  ovhcloud:            'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
  nscale:              'https://inference.api.nscale.com/v1/chat/completions',
  'aion-labs':         'https://api.aionlabs.ai/v1/chat/completions',
  llm7:                'https://api.llm7.io/v1/chat/completions',
  ai21:                'https://api.ai21.com/studio/v1/chat/completions',
  mistral:             'https://api.mistral.ai/v1/chat/completions',
  perplexity:          'https://api.perplexity.ai/v1/chat/completions',
  cohere:              'https://api.cohere.com/v1/chat',
  cerebras:            'https://api.cerebras.ai/v1/chat/completions',
  nvidia:              'https://integrate.api.nvidia.com/v1/chat/completions',
  cloudflare:          'https://api.cloudflare.com/client/v4/accounts/.../ai/run/',
  huggingface:         'https://router.huggingface.co/v1/chat/completions',
  sambanova:           'https://api.sambanova.ai/v1/chat/completions',
  cerebras:            'https://api.cerebras.ai/v1/chat/completions',
  'ollama-cloud':      'https://api.ollama.com/v1/chat/completions',
  vertex:              'https://*-aiplatform.googleapis.com/v1/...',
  glm:                 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  minimax:             'https://api.minimax.chat/v1/chat/completions',
  inception:           'https://api.inception.ai/v1/chat/completions',
  xiaomi:              'https://api.xiaomi.com/v1/chat/completions',
  cline_api:           'https://api.cline.bot/v1/chat/completions',
  deepgram:            'https://api.deepgram.com/v1/listen',
  assemblyai:          'https://api.assemblyai.com/v2/transcript',
};

// ─── HTTP helper ────────────────────────────────────────────────────────────
async function call(path, body, method = 'POST') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BACKEND}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type':   'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, data, latency: Date.now() - t0 };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 0, data: { error: err.message }, latency: Date.now() - t0 };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Per-provider test ──────────────────────────────────────────────────────
async function testProvider(p) {
  // Step 1: probe key presence
  const keysRes = await call(`/api/admin/keys/${encodeURIComponent(p.name)}`);
  const keyCount = Array.isArray(keysRes.data?.keys) ? keysRes.data.keys.length
                 : Array.isArray(keysRes.data)        ? keysRes.data.length
                 : 0;
  const hasKey = keyCount > 0;

  // Step 2: send a chat completion
  const payload = {
    provider: p.name,
    model:    'auto',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 4,
  };

  let attempt = 0;
  let result;
  let retries = 0;
  while (true) {
    result = await call('/v1/chat/completions', payload);
    attempt++;
    if (!result.ok && result.status >= 500 && result.status < 600 && retries < RETRY_ON_5XX) {
      retries++;
      await sleep(500);
      continue;
    }
    break;
  }

  // Step 3: classify
  let classification, errorSnippet;
  const choices = result.data?.choices || result.data?.output?.choices;
  const hasContent = !!(choices && choices[0] && (choices[0].message?.content || choices[0].text));

  if (result.status === 200 && hasContent) {
    const usedProvider = result.data?.provider || p.name;
    classification = usedProvider === p.name ? 'PASS' : 'FELL_THROUGH';
    errorSnippet = usedProvider !== p.name ? `expected=${p.name} got=${usedProvider}` : null;
  } else if (result.status === 200) {
    classification = 'WARN_EMPTY';
  } else if (result.status === 401) {
    classification = 'FAIL_401';
  } else if (result.status === 429) {
    classification = 'WARN_RATELIMIT';
  } else if (result.status === 400) {
    classification = 'FAIL_400';
  } else if (result.status === 403) {
    classification = 'FAIL_403';
  } else if (result.status === 404) {
    classification = 'FAIL_404';
  } else if (result.status >= 500) {
    classification = 'FAIL_5XX';
  } else if (result.status === 0) {
    classification = 'FAIL_TIMEOUT';
  } else {
    classification = `FAIL_${result.status}`;
  }

  errorSnippet = errorSnippet || (
    result.data?.error?.message
    || result.data?.message
    || (typeof result.data === 'string' ? result.data.slice(0, 150) : null)
    || (result.data?.raw ? result.data.raw.slice(0, 150) : null)
  );

  return {
    name: p.name,
    keyCount,
    hasKey,
    expectedUrl: EXPECTED_URLS[p.name] || '(not in audit table)',
    status: result.status,
    latency: result.latency,
    classification,
    retries,
    errorSnippet,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(78));
  console.log(' OMNIROUTE AI — ENABLED PROVIDER CONNECTIVITY TEST');
  console.log('='.repeat(78));
  console.log(` Backend  : ${BACKEND}`);
  console.log(` API key  : ${API_KEY.slice(0, 8)}…${API_KEY.slice(-4)}`);
  console.log(` Timeout  : ${TIMEOUT_MS} ms`);
  console.log('='.repeat(78));
  console.log();

  // Phase 1: health
  console.log('PHASE 1 — System Health');
  const health = await call('/api/admin/health', null, 'GET');
  if (health.ok) {
    console.log(`  ✅ healthy  (redis=${health.data?.redis}, firestore=${health.data?.firestore})`);
  } else {
    console.log(`  ❌ DEGRADED  status=${health.status}  body=${JSON.stringify(health.data).slice(0, 120)}`);
    if (health.status === 401) {
      console.log('  Hint: the API_KEY is invalid. Set API_KEY env var to a working key.');
    }
    console.log();
  }

  // Phase 2: discover
  console.log('\nPHASE 2 — Discover Active Cloud Providers');
  const provRes = await call('/api/admin/providers', null, 'GET');
  if (!provRes.ok) {
    console.log(`  ❌ Cannot list providers (status=${provRes.status})`);
    console.log(`  body: ${JSON.stringify(provRes.data).slice(0, 200)}`);
    return;
  }
  const all = provRes.data?.providers || [];
  const cloud = all.filter((p) => p.status === 'active' && p.type !== 'local_http' && !p.disabled);
  console.log(`  Found ${cloud.length} active cloud providers (out of ${all.length} total)`);
  if (cloud.length === 0) {
    console.log('  Nothing to test.');
    return;
  }

  // Phase 3: per-provider
  console.log('\nPHASE 3 — Per-Provider Connectivity Test');
  console.log('  Sending "ping" with max_tokens=4. No retries on 401.');
  console.log('-'.repeat(78));
  const rows = [];
  for (const p of cloud) {
    process.stdout.write(`  ${p.name.padEnd(24)} … `);
    const r = await testProvider(p);
    rows.push(r);
    const tag = r.classification === 'PASS' ? '✅ PASS'
              : r.classification === 'WARN_RATELIMIT' ? '⚠️  RATE-LIMITED'
              : r.classification === 'WARN_EMPTY' ? '⚠️  EMPTY'
              : r.classification === 'FELL_THROUGH' ? '⚠️  FELL-THROUGH'
              : '❌ ' + r.classification;
    console.log(`${tag.padEnd(20)} (${String(r.status).padEnd(3)} ${String(r.latency + 'ms').padStart(6)}  keys=${r.keyCount})`);
    if (r.classification !== 'PASS') {
      console.log(`      ${(r.errorSnippet || '(no message)').toString().slice(0, 200)}`);
    }
  }

  // Phase 4: summary
  console.log('\n' + '='.repeat(78));
  console.log(' PHASE 4 — SUMMARY');
  console.log('='.repeat(78));

  const pass  = rows.filter((r) => r.classification === 'PASS').length;
  const fell  = rows.filter((r) => r.classification === 'FELL_THROUGH').length;
  const r401  = rows.filter((r) => r.classification === 'FAIL_401').length;
  const other = rows.filter((r) =>
    !['PASS', 'FELL_THROUGH', 'FAIL_401'].includes(r.classification)
  ).length;

  console.log(`  Total tested   : ${rows.length}`);
  console.log(`  ✅ PASS        : ${pass}`);
  console.log(`  ⚠️  FELL-THROUGH: ${fell}  (provider parameter fell through to another provider)`);
  console.log(`  ❌ 401          : ${r401}  (likely misrouted — see audit)`);
  console.log(`  ❓ other        : ${other}`);

  if (r401 > 0) {
    console.log('\n  Providers returning 401:');
    rows.filter((r) => r.classification === 'FAIL_401').forEach((r) => {
      console.log(`    - ${r.name.padEnd(22)} keys=${r.keyCount}  expected=${r.expectedUrl}`);
    });
  }
  if (fell > 0) {
    console.log('\n  Providers whose `provider` parameter fell through:');
    rows.filter((r) => r.classification === 'FELL_THROUGH').forEach((r) => {
      console.log(`    - ${r.name.padEnd(22)} ${r.errorSnippet}`);
    });
  }
  if (other > 0) {
    console.log('\n  Other failures:');
    rows.filter((r) =>
      !['PASS', 'FELL_THROUGH', 'FAIL_401'].includes(r.classification)
    ).forEach((r) => {
      console.log(`    - ${r.name.padEnd(22)} ${r.classification}  ${(r.errorSnippet || '').slice(0, 100)}`);
    });
  }

  console.log('\n' + '='.repeat(78));
  console.log(' DONE');
  console.log('='.repeat(78));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
