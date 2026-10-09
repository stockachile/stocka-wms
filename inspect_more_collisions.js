const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectMore() {
  const checkNums = [
    'SER2000015408493535',
    'SER2000015417412721',
    'SER2000015410561841',
    'SER2000015412796429',
    'SER2000015405033913',
    'B4L2000015411339981',
    'MSE2000015408082817'
  ];

  const { data: orders } = await wms.from('orders')
    .select('id, external_order_number, comercio, estado_wms, status, created_at, tracking_number, raw_meli_data')
    .in('external_order_number', checkNums);

  orders.forEach(o => {
    const raw = o.raw_meli_data;
    const shipping = raw?.shipping;
    console.log({
      num: o.external_order_number,
      comercio: o.comercio,
      wms_estado: o.estado_wms,
      status: o.status,
      created_at: o.created_at,
      meli_track: shipping?.id || shipping?.tracking_number,
      meli_status: shipping?.status,
      meli_date: shipping?.date_created
    });
  });
}

inspectMore().finally(() => process.exit(0));
