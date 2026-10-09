const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectHit() {
  const hitOrders = [
    '2000015407915385',
    '2000015405464029',
    '2000015406284173',
    '2000015415791929',
    '2000015416840109',
    '2000015420927113'
  ];

  for (const num of hitOrders) {
    const { data: o } = await wms.from('orders').select('*').eq('external_order_number', num).single();
    const raw = o.raw_meli_data;
    const shipping = raw?.shipping;
    const items = shipping?.shipping_items || [];
    console.log(`\n================================`);
    console.log(`Orden: ${num}`);
    console.log(`Tracking real: ${shipping?.id || shipping?.tracking_number}`);
    console.log(`Fecha real: ${shipping?.date_created}`);
    console.log(`Destinatario real: ${shipping?.receiver_address?.receiver_name}, ${shipping?.receiver_address?.address_line}, ${shipping?.receiver_address?.city?.name}`);
    console.log(`Ítems reales en shipping_items (${items.length}):`);
    items.forEach(it => {
      console.log(`  - ID: ${it.id} | Desc: ${it.description} | Qty: ${it.quantity}`);
    });
  }
}

inspectHit().finally(() => process.exit(0));
