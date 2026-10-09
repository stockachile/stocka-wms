const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: allOrders } = await wms
    .from('orders')
    .select('id, external_order_number, comercio, estado_wms, status, created_at, shipping_method, raw_meli_data')
    .gte('created_at', '2026-10-08T00:00:00')
    .order('created_at', { ascending: false });

  const fullOrders = (allOrders || []).filter(ord => {
    const raw = ord.raw_meli_data;
    const logType = raw?.shipping?.logistic_type || raw?.orders?.[0]?.shipping?.logistic_type;
    return logType === 'fulfillment';
  });

  console.log(`Fulfillment orders count: ${fullOrders.length}`);
  fullOrders.forEach(o => {
    console.log(`ID: ${o.id} | Num: ${o.external_order_number} | Comercio: ${o.comercio} | Created: ${o.created_at} | Method: "${o.shipping_method}" | WMS: ${o.estado_wms}`);
  });
}

check().finally(() => process.exit(0));
