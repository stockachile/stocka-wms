const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

async function test() {
  const { data: pOrders } = await picker
    .from('active_orders')
    .select('order_number, comercio, created_at, tracking, sheet_status')
    .eq('sucursal', 'Sucursal Virtual (Hub)')
    .gte('created_at', '2026-10-07T00:00:00+00:00');

  const nums = Array.from(new Set(pOrders.map(p => p.order_number)));

  for (const n of nums) {
    const { data: w } = await wms
      .from('orders')
      .select('id, external_order_number, comercio, estado_wms, status, created_at, sucursal_pickeo, tracking_number')
      .ilike('external_order_number', `%${n}%`);

    if (!w || w.length === 0) {
      console.log(`❌ ${n}: REALMENTE NO EXISTE EN WMS!`);
    } else {
      w.forEach(ord => {
        console.log(`  - Picker: ${n} -> WMS: ${ord.external_order_number} (${ord.comercio}) | WMS estado_wms="${ord.estado_wms}" | status="${ord.status}" | sucursal="${ord.sucursal_pickeo}" | created_at="${ord.created_at}"`);
      });
    }
  }
}

test().finally(() => process.exit(0));
