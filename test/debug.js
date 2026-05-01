const API_KEY = 'AxzcsaFSAZxsaxczv_AsdxcaXxdax12scfdsaczxv131xzvgdzvqwdqwdxzcdfaczxvgfaA';
const BACKEND_URL = 'https://glistening-stillness-production-6724.up.railway.app';

async function test() {
  const res = await fetch(`${BACKEND_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'auto',
      provider: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5
    })
  });
  const data = await res.json();
  console.log('Keys in response:', Object.keys(data));
  console.log('Has system_fingerprint:', 'system_fingerprint' in data);
  console.log('Full response:', JSON.stringify(data, null, 2));
}

test().catch(console.error);
