const { createClient } = require('@supabase/supabase-js');
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

const extNumbers = [
  'MSE2000015421736277',
  'LAQ2000015420937019',
  'MSE2000015420477847',
  'MSE2000015417090947',
  'MSE2000015416477063',
  'LAQ2000015415238121',
  'MSE2000015414929651',
  '2000015413622765',
  'MSE2000015413600009',
  'MSE2000015411845869',
  'MSE2000015409498847',
  'MSE2000015403029979'
];

async function check() {
  const { data: act } = await picker.from('active_orders').select('*').in('order_number', extNumbers);
  console.log('Picker active_orders found:', act?.length || 0);
  if (act?.length) console.log(act.map(a => a.order_number));

  const cleanNums = extNumbers.map(e => e.replace(/\D/g, ''));
  const { data: actClean } = await picker.from('active_orders').select('*').in('order_number', cleanNums);
  console.log('Picker active_orders (clean numbers) found:', actClean?.length || 0);
  if (actClean?.length) console.log(actClean.map(a => a.order_number));
}

check();
