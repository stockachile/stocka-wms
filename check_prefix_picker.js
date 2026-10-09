const { createClient } = require('@supabase/supabase-js');
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

const picker = createClient(PICKER_URL, PICKER_KEY);

async function test() {
  const { data } = await picker
    .from('active_orders')
    .select('id, order_number, sucursal, sheet_status, created_at')
    .or('order_number.ilike.%18866195870%,order_number.ilike.%15420489159%');
  console.log('Results in Picker active_orders:', data);
}

test().finally(() => process.exit(0));
