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

// Specific order numbers confirmed as Fulfillment
const KNOWN_FULL_NUMBERS = [
  'MSE2000015421736277',
  'LAQ2000015420937019',
  'MSE2000015420477847',
  'MSE2000015417090947',
  'MSE2000015416477063',
  'LAQ2000015415238121',
  'MSE2000015414929651',
  '2000015413622765',
  'MSE2000015413600009',
  'MSE2000015411845869',
  'MSE2000015409498847',
  'MSE2000015403029979',
  'MSE2000015423645405',
  'MSE2000015405956759',
  'MSE2000015404113841',
  'MSE2000015408779673',
  '2000015402652205',
  '2000015398837571',
  'MSE2000015408443279',
  'MSE2000015413383337',
  'MSE2000015413184245',
  'MSE2000015413104713'
];

async function purgeFulfillmentOrders() {
  console.log('🔍 Buscando órdenes MercadoLibre Fulfillment para purgar...');

  const { data: allMeliOrders, error } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, raw_meli_data, status, estado_wms, created_at')
    .eq('external_platform', 'MercadoLibre')
    .limit(2000);

  if (error) {
    console.error('Error querying orders:', error);
    return;
  }

  const toDelete = [];

  for (const o of allMeliOrders) {
    const raw = o.raw_meli_data;
    const isFullInRaw = raw?.shipping?.logistic_type === 'fulfillment' ||
      raw?.logistic_type === 'fulfillment' ||
      raw?.orders?.some(x => x.shipping?.logistic_type === 'fulfillment') ||
      raw?.orders?.some(x => x.order_items?.some(it => it.stock?.node_id === 'CLRM03'));

    const isKnownFull = KNOWN_FULL_NUMBERS.includes(o.external_order_number);

    if (isFullInRaw || isKnownFull) {
      toDelete.push(o);
    }
  }

  console.log(`\n📋 Se encontraron ${toDelete.length} órdenes Fulfillment en WMS:`);
  toDelete.forEach(o => {
    console.log(`  - [${o.id}] ${o.external_order_number} (${o.comercio}) | Status: ${o.status} | WMS: ${o.estado_wms}`);
  });

  const ids = toDelete.map(o => o.id);

  if (ids.length === 0) {
    console.log('No hay órdenes Fulfillment para eliminar.');
    return;
  }

  // 1. Eliminar items de order_items
  const { error: itemsErr } = await supabase
    .from('order_items')
    .delete()
    .in('order_id', ids);

  if (itemsErr) {
    console.error('❌ Error eliminando order_items:', itemsErr.message);
    return;
  }
  console.log(`✅ Eliminados order_items de las ${ids.length} órdenes.`);

  // 2. Eliminar de orders
  const { error: ordErr } = await supabase
    .from('orders')
    .delete()
    .in('id', ids);

  if (ordErr) {
    console.error('❌ Error eliminando orders:', ordErr.message);
    return;
  }

  console.log(`🎉 Purgadas exitosamente ${ids.length} órdenes Fulfillment de la base de datos.`);
}

purgeFulfillmentOrders();
