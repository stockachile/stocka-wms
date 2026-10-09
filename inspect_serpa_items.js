const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectSerpa() {
  const serpaOrders = [
    'SER2000015405033913',
    'SER2000015408493535',
    'SER2000015410561841',
    'SER2000015412796429',
    'SER2000015417412721'
  ];

  for (const num of serpaOrders) {
    const { data: o } = await wms.from('orders').select('*').eq('external_order_number', num).single();
    const raw = o.raw_meli_data;
    const shipping = raw?.shipping;
    const items = shipping?.shipping_items || [];
    const orders = raw?.orders || [];
    console.log(`\n================================`);
    console.log(`Orden: ${num}`);
    console.log(`Tracking real: ${shipping?.id || shipping?.tracking_number}`);
    console.log(`Fecha real: ${shipping?.date_created}`);
    console.log(`Destinatario real: ${shipping?.receiver_address?.receiver_name}, ${shipping?.receiver_address?.address_line}, ${shipping?.receiver_address?.city?.name}`);
    console.log(`Shipping items (${items.length}):`);
    items.forEach(it => {
      console.log(`  - ID: ${it.id} | Desc: ${it.description} | Qty: ${it.quantity}`);
    });
    if (items.length === 0 && orders.length > 0) {
      console.log(`Orders items:`);
      orders.forEach(ord => {
        (ord.order_items || []).forEach(it => {
          console.log(`  - SKU: ${it.item?.seller_sku} | Title: ${it.item?.title} | Qty: ${it.quantity}`);
        });
      });
    }
  }
}

inspectSerpa().finally(() => process.exit(0));
