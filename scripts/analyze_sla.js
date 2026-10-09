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
    .gte('created_at', '2026-10-07T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`Analyzing ${orders.length} Meli orders from 2026-10-07 to now:`);

  let fullCount = 0;
  let nonFullWithSla = 0;
  let nonFullWithoutSla = 0;

  for (const o of orders) {
    const isFull = o.raw_meli_data?.shipping?.logistic_type === 'fulfillment' ||
                   o.raw_meli_data?.logistic_type === 'fulfillment' ||
                   o.raw_meli_data?.orders?.some(x => x.shipping?.logistic_type === 'fulfillment');
    if (isFull) {
      fullCount++;
      console.log(`Fulfillment order: ${o.id} | ${o.external_order_number} (${o.comercio}) | status: ${o.status} | wms: ${o.estado_wms}`);
      continue;
    }

    const hasSlaInMethod = /SLA/i.test(o.shipping_method || '');
    if (hasSlaInMethod) {
      nonFullWithSla++;
    } else {
      nonFullWithoutSla++;
      const sh = o.raw_meli_data?.shipping;
      console.log(`\nOrder: ${o.external_order_number} (${o.comercio}) | method: "${o.shipping_method}"`);
      console.log(`  log_type: ${sh?.logistic_type}`);
      console.log(`  estimated_delivery_time.date:`, sh?.shipping_option?.estimated_delivery_time?.date);
      console.log(`  estimated_delivery_time.pay_before:`, sh?.shipping_option?.estimated_delivery_time?.pay_before);
      console.log(`  estimated_delivery_limit.date:`, sh?.shipping_option?.estimated_delivery_limit?.date);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Fulfillment orders (should not be in WMS): ${fullCount}`);
  console.log(`  Non-fulfillment WITH SLA: ${nonFullWithSla}`);
  console.log(`  Non-fulfillment WITHOUT SLA: ${nonFullWithoutSla}`);
}

test();
