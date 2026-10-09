const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

async function test() {
  // Let's inspect order 2000015407915385 specifically and other HIT GAMING orders created recently
  const targetOrders = [
    '2000015407915385',
    '2000015420927113',
    '2000015416840109',
    '2000015406284173',
    '2000015405464029'
  ];

  console.log('=== Detalle en WMS para las órdenes de HIT GAMING con colisión ===');
  const { data: wmsOrders } = await wms
    .from('orders')
    .select('id, external_order_number, comercio, estado_wms, status, created_at, tracking_number, sucursal_pickeo, raw_meli_data')
    .in('external_order_number', targetOrders);

  wmsOrders.forEach(o => {
    console.log({
      num: o.external_order_number,
      comercio: o.comercio,
      wms_estado: o.estado_wms,
      status: o.status,
      created_at: o.created_at,
      sucursal: o.sucursal_pickeo,
      tracking: o.tracking_number,
      meli_real_track: o.raw_meli_data?.shipping?.id || o.raw_meli_data?.shipping?.tracking_number,
      meli_real_status: o.raw_meli_data?.shipping?.status || o.raw_meli_data?.shipping_status,
      meli_real_date: o.raw_meli_data?.shipping?.date_created || o.raw_meli_data?.date_created
    });
  });

  console.log('\n=== Detalle en Picker active_orders para estas mismas órdenes ===');
  const { data: pOrders } = await picker
    .from('active_orders')
    .select('id, order_number, sucursal, comercio, sheet_status, tracking, operator, created_at')
    .in('order_number', targetOrders);

  pOrders.forEach(p => {
    console.log({
      id: p.id,
      num: p.order_number,
      sucursal: p.sucursal,
      comercio: p.comercio,
      sheet_status: p.sheet_status,
      tracking: p.tracking,
      created_at: p.created_at
    });
  });
}

test().finally(() => process.exit(0));
