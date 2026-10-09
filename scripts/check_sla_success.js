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
  const { data: order } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, tracking_number, shipping_method, raw_meli_data')
    .eq('external_order_number', 'SER2000015417412721')
    .single();

  const { data: int } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('comercio', order.comercio)
    .eq('platform', 'MercadoLibre')
    .single();

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

  const shipId = order.tracking_number || order.raw_meli_data?.shipping?.id;
  console.log('Shipment ID:', shipId);

  const slaRes = await fetch(`https://api.mercadolibre.com/shipments/${shipId}/sla`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('SLA HTTP Status:', slaRes.status);
  const slaJson = await slaRes.json();
  console.log('SLA Response:', JSON.stringify(slaJson, null, 2));

  const shipRes = await fetch(`https://api.mercadolibre.com/shipments/${shipId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const shipJson = await shipRes.json();
  console.log('Shipment logistic_type:', shipJson.logistic_type);
  console.log('Shipment substatus_history:', JSON.stringify(shipJson.substatus_history, null, 2));
}

test();
