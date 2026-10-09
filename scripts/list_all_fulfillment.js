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
    .select('id, external_order_number, comercio, shipping_method, raw_meli_data, status, estado_wms, created_at')
    .eq('external_platform', 'MercadoLibre')
    .order('created_at', { ascending: false })
    .limit(2000);

  const fullOrders = (orders || []).filter(o => {
    const raw = o.raw_meli_data;
    const isFull = raw?.shipping?.logistic_type === 'fulfillment' ||
                   raw?.logistic_type === 'fulfillment' ||
                   raw?.orders?.some(x => x.shipping?.logistic_type === 'fulfillment') ||
                   raw?.orders?.some(x => x.order_items?.some(it => it.stock?.node_id === 'CLRM03'));
    return isFull;
  });

  console.log(`Total Fulfillment orders found in database: ${fullOrders.length}`);
  const statusCounts = {};
  const wmsCounts = {};
  fullOrders.forEach(o => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    wmsCounts[o.estado_wms] = (wmsCounts[o.estado_wms] || 0) + 1;
  });
  console.log('Status counts:', statusCounts);
  console.log('WMS counts:', wmsCounts);

  console.log('\nOrders that are not cancelado/despachado:');
  fullOrders.filter(o => o.status !== 'cancelado' && o.status !== 'despachado').forEach(o => {
    console.log(`  ${o.id} | ${o.external_order_number} | ${o.comercio} | status: ${o.status} | wms: ${o.estado_wms} | created: ${o.created_at}`);
  });
}

test();
