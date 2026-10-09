const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

async function test() {
  // Get all active orders from Picker in Sucursal Virtual from Oct 7 and 8
  const { data: pOrders } = await picker
    .from('active_orders')
    .select('order_number, comercio, created_at, tracking, sheet_status')
    .eq('sucursal', 'Sucursal Virtual (Hub)')
    .gte('created_at', '2026-10-07T00:00:00+00:00');

  console.log(`Órdenes en Sucursal Virtual desde el 7 de Octubre: ${pOrders.length}`);
  const nums = Array.from(new Set(pOrders.map(p => p.order_number)));

  // Query WMS for these order numbers
  const { data: wOrders } = await wms
    .from('orders')
    .select('id, external_order_number, comercio, estado_wms, status, created_at, sucursal_pickeo, tracking_number')
    .in('external_order_number', nums);

  const wMap = new Map((wOrders || []).map(o => [o.external_order_number, o]));

  console.log(`Estado en WMS de los pedidos de Sucursal Virtual (7 y 8 de Octubre):`);
  nums.forEach(n => {
    const w = wMap.get(n);
    if (!w) {
      console.log(`  ❌ ${n}: NO EXISTE EN WMS!`);
    } else {
      console.log(`  - ${n} (${w.comercio}): WMS estado_wms="${w.estado_wms}", status="${w.status}", sucursal="${w.sucursal_pickeo}", created_at="${w.created_at}"`);
    }
  });
}

test().finally(() => process.exit(0));
