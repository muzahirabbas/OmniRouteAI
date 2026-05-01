/**
 * CONFIGURATION AUDIT & RECOMMENDATION
 * 
 * 1. Fetches current priority/weight for all providers.
 * 2. Analyzes Google (Gemini) capabilities.
 * 3. Recommends optimal settings for Cost/Power balance.
 */

const API_KEY = process.env.API_KEY || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22';
const BACKEND = process.env.BACKEND_URL || 'https://omnirouterai-production.up.railway.app';

async function runAudit() {
  console.log('==================================================');
  console.log('📊 OMNIROUTE AI CONFIGURATION AUDIT');
  console.log('==================================================\n');

  try {
    const res = await fetch(`${BACKEND}/api/admin/providers`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    const data = await res.json();
    const providers = data.providers || [];

    console.log('--- 📋 CURRENT CONFIGURATION ---');
    console.log('Provider'.padEnd(20), 'Priority'.padEnd(10), 'Weight'.padEnd(10), 'Status');
    console.log('-'.repeat(50));
    
    providers.sort((a, b) => a.priority - b.priority || b.weight - a.weight).forEach(p => {
      console.log(
        p.name.padEnd(20), 
        String(p.priority).padEnd(10), 
        String(p.weight).padEnd(10), 
        p.disabled ? '🔴 DISABLED' : '🟢 ACTIVE'
      );
    });

    console.log('\n--- 🔍 GOOGLE (GEMINI) CAPABILITIES ---');
    const google = providers.find(p => p.name === 'google');
    if (google) {
      console.log(`Models: ${google.models?.join(', ')}`);
      console.log(`Features: ${google.features?.join(', ')}`);
      console.log(`RPM Limit: ${google.rpmLimit}`);
      console.log(`Reasoning: ${google.supports_reasoning ? 'YES' : 'NO'}`);
    } else {
      console.log('Google provider not found.');
    }

    console.log('\n--- 💡 OPTIMAL BALANCE RECOMMENDATION ---');
    console.log('To achieve the best Cost/Power balance, we recommend three tiers:');
    
    console.log('\n1. ⚡ POWER TIER (Priority 1)');
    console.log('   - openai (gpt-4o)');
    console.log('   - anthropic (claude-3-7-sonnet)');
    console.log('   - xai (grok-2)');
    console.log('   *Use these for complex reasoning and coding tasks.*');

    console.log('\n2. ⚖️ BALANCE TIER (Priority 2)');
    console.log('   - google (gemini-1.5-flash) <- HIGHEST WEIGHT HERE');
    console.log('   - groq (llama-3.3-70b)');
    console.log('   - deepseek (deepseek-chat)');
    console.log('   *High intelligence but extremely cost-effective or free-tier.*');

    console.log('\n3. 💸 ECONOMY TIER (Priority 3+)');
    console.log('   - cloudflare');
    console.log('   - local_http providers (ngrok bridges)');
    console.log('   *Zero cost, use for simple tasks or failover.*');

    console.log('\n--- 🛠️ PROPOSED CHANGES FOR GOOGLE ---');
    console.log('Current: Priority 1, Weight 10');
    console.log('Recommended: Priority 2, Weight 25');
    console.log('Reasoning: Gemini 1.5 Flash is incredibly fast and has a high free-tier quota (15 RPM).');
    console.log('Moving it to Tier 2 with high weight makes it the primary "balanced" choice.');

  } catch (err) {
    console.error('Audit failed:', err.message);
  }
}

runAudit();
