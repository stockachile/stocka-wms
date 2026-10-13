const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const k = parts[0].trim();
    const v = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
    env[k] = v;
  }
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: ord } = await supabase.from('orders').select('*').ilike('external_order_number', '%HIT1033%').single();
  console.log('Orden HIT1033:');
  console.log({
    id: ord?.id,
    external_order_number: ord?.external_order_number,
    status: ord?.status,
    estado_wms: ord?.estado_wms,
    comercio: ord?.comercio,
    created_at: ord?.created_at,
    sucursal_pickeo: ord?.sucursal_pickeo
  });

  const { data: items } = await supabase.from('order_items').select('*, products(*)').eq('order_id', ord.id);
  console.log('\nItems de HIT1033:', items?.map(i => ({
    sku: i.products?.sku,
    name: i.products?.name,
    qty: i.quantity,
    warehouse_id: i.warehouse_id
  })));

  const { data: movs } = await supabase.from('movements').select('*, products(sku, name, comercio)').eq('order_id', ord.id);
  console.log('\nMovimientos con order_id = HIT1033:', movs?.map(m => ({
    id: m.id,
    ref: m.reference_doc,
    sku: m.products?.sku,
    comercio: m.products?.comercio
  })));

  // Check second order
  const { data: ord2 } = await supabase.from('orders').select('*').ilike('external_order_number', '%2000015023255637%').single();
  console.log('\nOrden MELI 2000015023255637 completa:', {
    channel: ord2?.channel,
    integration_type: ord2?.integration_type,
    carrier: ord2?.carrier,
    shipping_status: ord2?.shipping_status,
    fulfillment_type: ord2?.fulfillment_type,
    created_at: ord2?.created_at,
    updated_at: ord2?.updated_at
  });

  const { data: items2 } = await supabase.from('order_items').select('*, products(*)').eq('order_id', ord2.id);
  console.log('Items MELI:', items2?.map(i => ({ sku: i.products?.sku, name: i.products?.name, qty: i.quantity, wh: i.warehouse_id })));

  const { data: movs2 } = await supabase.from('movements').select('*').eq('order_id', ord2.id);
  console.log('Movimientos vinculados a orden 2:', movs2);

  const { data: wh } = await supabase.from('warehouses').select('*').eq('id', 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09').single();
  console.log('\nWarehouse ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09:', wh);
}

check().catch(console.error);
