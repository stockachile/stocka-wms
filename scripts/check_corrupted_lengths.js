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
    .select('id, external_order_number, comercio, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .gte('created_at', '2026-10-07T00:00:00Z');

  const multiOrders = (orders || []).filter(o => {
    return Array.isArray(o.raw_meli_data?.orders) && o.raw_meli_data.orders.length > 5;
  });

  console.log(`Orders with >5 raw_meli_data.orders: ${multiOrders.length}`);
  multiOrders.forEach(o => {
    console.log(`  ${o.id} | ${o.external_order_number} | orders count: ${o.raw_meli_data.orders.length}`);
  });
}

check();
