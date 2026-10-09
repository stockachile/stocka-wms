const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envConfig = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const envVars = {};
envConfig.split(/\r?\n/).forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...v] = line.split('=');
  if (k && v.length) envVars[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, created_at, status, estado_wms, shipping_method, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.error(error);
    return;
  }

  const fullOrders = (data || []).filter(o => {
    const raw = o.raw_meli_data;
    const isFullLog = raw?.shipping?.logistic_type === 'fulfillment' ||
      raw?.logistic_type === 'fulfillment' ||
      raw?.orders?.some(sub => sub.shipping?.logistic_type === 'fulfillment');
    const isFullMethod = o.shipping_method && o.shipping_method.toLowerCase().includes('full');
    return isFullLog || isFullMethod;
  });

  console.log(`Found ${fullOrders.length} fulfillment orders total in the last 1000 Meli orders:`);
  fullOrders.forEach(o => {
    console.log(`ID: ${o.id} | Order: ${o.external_order_number} | Commerce: ${o.comercio} | Status: ${o.status} | WMS: ${o.estado_wms} | Method: ${o.shipping_method} | Created: ${o.created_at}`);
  });
}

check();
