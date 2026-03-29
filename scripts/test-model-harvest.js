import { STATIC_PROVIDERS } from '../src/config/providers.js';
import { getDb } from '../src/config/firestore.js';

async function testAllCloudProviders() {
  const db = getDb();
  console.log('--- STARTING MODEL HARVEST DIAGNOSTICS (V2) ---\n');

  // Skip local ones and Ollama (which usually needs a local bridge)
  const cloudProviders = STATIC_PROVIDERS.filter(p => !p.type && p.name !== 'ollama');

  for (const p of cloudProviders) {
    try {
      // 1. Get ALL Keys for this provider
      const keysSnapshot = await db.collection('api_keys')
        .where('provider', '==', p.name)
        .get();

      if (keysSnapshot.empty) {
        continue;
      }

      // Use the first non-disabled key
      const activeKeys = keysSnapshot.docs.filter(d => d.data().is_disabled !== true);
      if (activeKeys.length === 0) {
        console.warn(`[${p.name}] All keys are disabled.`);
        continue;
      }
      
      const apiKey = activeKeys[0].data().key;
      console.log(`Testing [${p.name}]...`);

      // 2. URL transformation (Copy of backend logic)
      let modelsUrl = p.endpoint || '';
      if (modelsUrl.includes('/chat/completions')) {
        modelsUrl = modelsUrl.replace('/chat/completions', '/models');
      } else if (modelsUrl.includes('/messages')) {
        modelsUrl = modelsUrl.replace('/messages', '/models');
      } else {
        const parts = modelsUrl.split('/');
        if (parts.length > 3) {
           parts.pop(); 
           modelsUrl = parts.join('/') + '/models';
        }
      }

      // Hardcoded overrides
      if (p.name === 'google') modelsUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
      if (p.name === 'huggingface') {
        modelsUrl = 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=50&filter=text-generation';
      }

      // Hardcoded Overrides Simulation (Matching Backend)
      const HARDCODED_MODELS = {
        'anthropic': ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
        'cloudflare': ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-405b', '@cf/mistral/mistral-7b-instruct-v0.1'],
        'minimax': ['abab7-chat', 'abab6.5-chat', 'abab6.5s-chat'],
        'vertex': ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro']
      };

      if (HARDCODED_MODELS[p.name]) {
        console.log(`  [SUCCESS] ${p.name}: Found ${HARDCODED_MODELS[p.name].length} models (HARDCODED FALLBACK)`);
        continue;
      }

      const headers = { 'Authorization': `Bearer ${apiKey}` };
      let finalUrl = p.name === 'google' ? `${modelsUrl}?key=${apiKey}` : modelsUrl;
      if (p.name === 'google') delete headers.Authorization;
      if (p.name === 'huggingface') delete headers.Authorization;
      
      // Amazon/Vertex etc might need special headers
      if (p.name === 'anthropic') {
         // headers['x-api-key'] = apiKey; (not useful for discovery if the URL is wrong)
      }

      // 3. Attempt Fetch
      const response = await fetch(finalUrl, { headers, signal: AbortSignal.timeout(6000) });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'No detail');
        console.error(`  [FAIL] HTTP ${response.status}: ${errText.substring(0, 150)}`);
      } else {
        const data = await response.json();
        let modelsCount = 0;
        if (Array.isArray(data.data)) modelsCount = data.data.length;
        else if (Array.isArray(data.models)) modelsCount = data.models.length;
        else if (Array.isArray(data) && p.name === 'huggingface') modelsCount = data.length;
        
        console.log(`  [SUCCESS] Found ${modelsCount} models.`);
      }
    } catch (err) {
      console.error(`  [ERROR] ${p.name}: ${err.message}`);
    }
    console.log('');
  }
}

testAllCloudProviders().then(() => process.exit(0)).catch(console.error);
