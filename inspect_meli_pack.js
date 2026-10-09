const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspect() {
  const { data: o } = await wms.from('orders').select('raw_meli_data').eq('id', '0233a496-214e-4cd1-8d7f-05358e510b8d').single();
  const str = JSON.stringify(o.raw_meli_data);
  console.log('Contains 2000015407915385 in raw_meli_data?', str.includes('2000015407915385'));
  console.log('Contains 2000018854620014 in raw_meli_data?', str.includes('2000018854620014'));
  console.log('raw_meli_data order IDs:', (o.raw_meli_data?.orders || []).map(x => ({ id: x.id, pack_id: x.pack_id })));

  // Let's also check if there is an order in orders table with external_order_number = 2000018854620014
  const { data: byMeliId } = await wms.from('orders').select('id, external_order_number, comercio, estado_wms, created_at').eq('external_order_number', '2000018854620014');
  console.log('Orders with external_order_number = 2000018854620014:', byMeliId);
}

inspect().catch(console.error);
