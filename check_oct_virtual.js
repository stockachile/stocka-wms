const { createClient } = require('@supabase/supabase-js');
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

const picker = createClient(PICKER_URL, PICKER_KEY);

async function check() {
  const { data: virtualOrders } = await picker
    .from('active_orders')
    .select('order_number, comercio, created_at, tracking, operator, sheet_status')
    .eq('sucursal', 'Sucursal Virtual (Hub)')
    .gte('created_at', '2026-10-01T00:00:00+00:00');

  console.log(`Total pedidos en Sucursal Virtual en Octubre: ${virtualOrders?.length || 0}`);
  const byComercio = {};
  const uniqueNums = new Set();
  (virtualOrders || []).forEach(o => {
    uniqueNums.add(o.order_number);
    byComercio[o.comercio] = (byComercio[o.comercio] || 0) + 1;
  });
  console.log('Por comercio:', byComercio);
  console.log(`Pedidos únicos: ${uniqueNums.size}`);
  console.log('Lista de pedidos únicos:', Array.from(uniqueNums));
}

check().finally(() => process.exit(0));
