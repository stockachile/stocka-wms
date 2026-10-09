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

async function test() {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .limit(2000);

  const fullIds = (orders || []).filter(o => {
    const raw = o.raw_meli_data;
    return raw?.shipping?.logistic_type === 'fulfillment' ||
           raw?.logistic_type === 'fulfillment' ||
           raw?.orders?.some(x => x.shipping?.logistic_type === 'fulfillment') ||
           raw?.orders?.some(x => x.order_items?.some(it => it.stock?.node_id === 'CLRM03'));
  }).map(o => o.id);

  console.log(`Checking movements for ${fullIds.length} fulfillment orders...`);
  const { data: movs } = await supabase
    .from('movements')
    .select('id, order_id')
    .in('order_id', fullIds);

  console.log('Movements found for any fulfillment order:', movs?.length || 0);
}

test();
