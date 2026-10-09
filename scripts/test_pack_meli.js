const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envConfig = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const envVars = {};
envConfig.split(/\r?\n/).forEach(l => {
  const [k, ...v] = l.split('=');
  if (k && v.length) envVars[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
});
const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: int } = await supabase.from('merchant_integrations').select('*').eq('comercio', 'MAESE').eq('platform', 'MercadoLibre').single();
  const tokenUrl = 'https://api.mercadolibre.com/oauth/token';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: int.client_id,
    client_secret: int.client_secret,
    refresh_token: int.refresh_token
  });
  const res = await fetch(tokenUrl, { method: 'POST', body: params });
  const d = await res.json();
  const token = d.access_token;
  
  // 1. Check pack
  const packRes = await fetch('https://api.mercadolibre.com/packs/2000015421736277', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Pack status:', packRes.status);
  if (packRes.ok) {
    const pack = await packRes.json();
    console.log('Pack shipment:', pack.shipment);
    console.log('Pack orders:', pack.orders);
  }

  // 3. Check shipment directly
  const shRes = await fetch('https://api.mercadolibre.com/shipments/48206384264', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Shipment status:', shRes.status);
  if (shRes.ok) {
    const sh = await shRes.json();
    console.log('Shipment logistic_type:', sh.logistic_type);
    console.log('Shipment status:', sh.status);
  } else {
    console.log('Shipment error:', await shRes.text());
  }
}
test();
