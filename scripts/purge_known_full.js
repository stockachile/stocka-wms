const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envConfig = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const envVars = {};
envConfig.split(/\r?\n/).forEach(l => {
  const [k, ...v] = l.split('=');
  if (k && v.length) envVars[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
});
const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

const KNOWN_FULL_NUMBERS = [
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
  'MSE2000015403029979',
  'MSE2000015423645405',
  'MSE2000015405956759',
  'MSE2000015404113841',
  'MSE2000015408779673',
  '2000015402652205',
  '2000015398837571',
  'MSE2000015408443279',
  'MSE2000015413383337',
  'MSE2000015413184245',
  'MSE2000015413104713'
];

async function check() {
  const { data: found } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio')
    .in('external_order_number', KNOWN_FULL_NUMBERS);

  console.log(`Found ${found?.length || 0} known full numbers in orders:`);
  if (found?.length) {
    found.forEach(o => console.log(`  ${o.id} | ${o.external_order_number} (${o.comercio})`));
    const ids = found.map(o => o.id);
    await supabase.from('order_items').delete().in('order_id', ids);
    await supabase.from('orders').delete().in('id', ids);
    console.log(`✅ Purgadas ${ids.length} órdenes.`);
  }
}

check();
