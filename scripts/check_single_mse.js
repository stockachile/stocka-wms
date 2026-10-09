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
    .eq('external_order_number', 'MSE2000015423645405')
    .single();

  console.log('Order:');
  console.log('id:', order.id);
  console.log('created_at:', order.created_at);
  console.log('status:', order.status);
  console.log('estado_wms:', order.estado_wms);
  console.log('shipping_method:', order.shipping_method);
  console.log('sucursal_pickeo:', order.sucursal_pickeo);
  console.log('raw_meli_data orders length:', order.raw_meli_data?.orders?.length);
  console.log('raw_meli_data shipping logistic_type:', order.raw_meli_data?.shipping?.logistic_type);
}

test();
