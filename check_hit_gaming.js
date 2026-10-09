const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

async function test() {
  try {
    const { data: pastOrders } = await wms.from('orders')
      .select('id, external_order_number, sucursal_pickeo, estado_wms, courier, operador, created_at')
      .ilike('comercio', '%HIT GAMING%')
      .order('created_at', { ascending: false })
      .limit(10);
    console.log('pastOrders HIT GAMING:', pastOrders);

    const { data: pickerHit } = await picker.from('active_orders')
      .select('id, order_number, sucursal, sheet_status, created_at')
      .ilike('comercio', '%HIT GAMING%')
      .order('id', { ascending: false })
      .limit(10);
    console.log('picker active_orders HIT GAMING:', pickerHit);

    const { data: pickerLogsHit } = await picker.from('history_logs')
      .select('id, pedido, sucursal, estado, picker, created_at')
      .ilike('comercio', '%HIT GAMING%')
      .order('id', { ascending: false })
      .limit(10);
    console.log('picker history_logs HIT GAMING:', pickerLogsHit);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

test();
