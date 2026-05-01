/**
 * DRY RUN ROTATION AUDIT (FETCH-BASED)
 * 
 * Verifies provider and key rotation by hitting the /api/admin/simulate-rotation
 * endpoint on the live backend.
 * 
 * Benefits:
 * 1. ZERO tokens used (no AI calls)
 * 2. Real production audit (uses live Redis/Firestore state)
 * 3. Fast & lightweight (no local node_modules required)
 */

const API_KEY = process.env.API_KEY || 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA22';
const BACKEND = process.env.BACKEND_URL || 'https://glistening-stillness-production-6724.up.railway.app';
const ITERATIONS = 20;

async function runDryAudit() {
  console.log('==================================================');
  console.log(`🚀 STARTING DRY RUN ROTATION AUDIT (${ITERATIONS} iterations)`);
  console.log(`📡 TARGET: ${BACKEND}`);
  console.log('==================================================\n');

  const stats = {
    providers: {},
    keys: {},
    tiers: {},
    errors: 0
  };

  const startTime = Date.now();

  for (let i = 1; i <= ITERATIONS; i++) {
    process.stdout.write(`\rProgress: [${i}/${ITERATIONS}] `);
    
    try {
      const resp = await fetch(`${BACKEND}/api/admin/simulate-rotation?taskType=general`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      });
      
      const data = await resp.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }

      const { provider, apiKey, tier } = data.selected;

      // Track Distributions
      stats.providers[provider] = (stats.providers[provider] || 0) + 1;
      stats.keys[`${provider}:${apiKey}`] = (stats.keys[`${provider}:${apiKey}`] || 0) + 1;
      stats.tiers[tier] = (stats.tiers[tier] || 0) + 1;

    } catch (err) {
      stats.errors++;
      console.error(`\n❌ Error on iteration ${i}:`, err.message);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\n✅ COMPLETED in ${duration}s (Errors: ${stats.errors})\n`);

  // --- REPORT ---

  console.log('--- 🛡️  PRIORITY TIER DISTRIBUTION ---');
  Object.keys(stats.tiers).sort().forEach(tier => {
    const count = stats.tiers[tier];
    const pct = ((count / ITERATIONS) * 100).toFixed(1);
    console.log(`Tier ${tier}:`.padEnd(10), `${count}`.padStart(3), `(${pct}%)`);
  });

  console.log('\n--- ⚖️  PROVIDER WEIGHT DISTRIBUTION ---');
  Object.entries(stats.providers)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      const pct = ((count / ITERATIONS) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(parseFloat(pct) / 2));
      console.log(`${name.padEnd(20)} ${bar.padEnd(25)} ${count} (${pct}%)`);
    });

  console.log('\n--- 🔄  API KEY ROTATION (TOP 10) ---');
  Object.entries(stats.keys)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([id, count]) => {
      console.log(`Key ${id.padEnd(35)}: ${count} uses`);
    });

  console.log('\n==================================================');
  console.log('AUDIT COMPLETE (Dry Run — 0 Tokens Used)');
  console.log('==================================================\n');
}

runDryAudit().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});