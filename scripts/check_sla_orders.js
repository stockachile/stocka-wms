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

async function check() {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, shipping_method, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .order('created_at', { ascending: false })
    .limit(20);

  console.log(`Checking ${orders.length} recent Meli orders:`);
  orders.forEach(o => {
    const raw = o.raw_meli_data;
    const expDate = raw?.expected_date 
      || raw?.shipping?.expected_date 
      || raw?.shipping?.shipping_option?.estimated_delivery_time?.date
      || raw?.shipping?.shipping_option?.estimated_delivery_limit?.date
      || raw?.orders?.[0]?.shipping?.shipping_option?.estimated_delivery_limit?.date;
    console.log(`\nOrder: ${o.external_order_number} (${o.comercio})`);
    console.log(`  shipping_method: "${o.shipping_method}"`);
    console.log(`  raw.expected_date:`, raw?.expected_date);
    console.log(`  raw.shipping.expected_date:`, raw?.shipping?.expected_date);
    console.log(`  raw.shipping?.shipping_option?.estimated_delivery_time?.date:`, raw?.shipping?.shipping_option?.estimated_delivery_time?.date);
    console.log(`  raw.shipping?.shipping_option?.estimated_delivery_limit?.date:`, raw?.shipping?.shipping_option?.estimated_delivery_limit?.date);
  });
}

check();
