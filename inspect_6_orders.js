const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

async function test() {
  const targetHitOrders = [
    '2000015407915385',
    '2000015405464029',
    '2000015406284173',
    '2000015415791929',
    '2000015416840109',
    '2000015420927113'
  ];

  console.log('=== DETALLE DE ITEMS Y ESTADOS REALES DE LAS 6 ÓRDENES HIT GAMING ===');
  for (const num of targetHitOrders) {
    const { data: o } = await wms.from('orders').select('id, external_order_number, comercio, estado_wms, status, created_at, tracking_number, sucursal_pickeo, raw_meli_data').eq('external_order_number', num).single();
    const raw = o.raw_meli_data;
    const shipping = raw?.shipping;
    const orders = raw?.orders || [];
    console.log(`\n--------------------------------------------`);
    console.log(`Pedido: ${o.external_order_number} (WMS ID: ${o.id})`);
    console.log(`WMS estado_wms: ${o.estado_wms} | status: ${o.status} | created_at: ${o.created_at}`);
    console.log(`WMS tracking_number: ${o.tracking_number} | Real shipping ID: ${shipping?.id} (status: ${shipping?.status})`);
    console.log(`Meli items en shipping/orders:`);
    if (shipping?.shipping_items) {
      shipping.shipping_items.forEach(it => {
        console.log(`  - ${it.description} x ${it.quantity} (ID: ${it.id})`);
      });
    } else if (orders.length > 0) {
      orders.forEach(ord => {
        (ord.order_items || []).forEach(it => {
          console.log(`  - ${it.item?.title} x ${it.quantity} (SKU: ${it.item?.seller_sku})`);
        });
      });
    }

    const { data: items } = await wms.from('order_items').select('quantity, products(sku, name)').eq('order_id', o.id);
    console.log(`WMS order_items actuales (${items?.length} productos):`);
    (items || []).slice(0, 3).forEach(it => {
      console.log(`  - ${it.products?.name} (${it.products?.sku}) x ${it.quantity}`);
    });
    if (items && items.length > 3) console.log(`  ... (+${items.length - 3} más)`);
  }
}

test().finally(() => process.exit(0));
