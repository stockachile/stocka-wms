const { createClient } = require('@supabase/supabase-js');
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

const picker = createClient(PICKER_URL, PICKER_KEY);

async function check() {
  const { data: cols } = await picker.from('active_orders').select('*').limit(1);
  console.log('One row of active_orders:', cols);

  // Let's check other orders in active_orders that have sheet_status
  const { data: statuses } = await picker.from('active_orders').select('sheet_status');
  const count = {};
  statuses.forEach(s => {
    count[s.sheet_status] = (count[s.sheet_status] || 0) + 1;
  });
  console.log('Statuses count in active_orders:', count);
}

check().finally(() => process.exit(0));
