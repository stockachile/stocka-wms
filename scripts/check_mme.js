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
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('external_order_number', 'MME2000015422826417')
    .single();

  console.log('Order:');
  console.log('external_order_number:', order.external_order_number);
  console.log('shipping_method:', order.shipping_method);
  console.log('raw_meli_data orders length:', order.raw_meli_data?.orders?.length);
  console.log('raw_meli_data first order ID:', order.raw_meli_data?.orders?.[0]?.id);
  console.log('raw_meli_data shipping:', JSON.stringify(order.raw_meli_data?.shipping, null, 2));
}

test();
