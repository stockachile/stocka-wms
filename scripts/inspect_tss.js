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

async function inspectTSS() {
  console.log('=== INSPECCIÓN THE SKIN STORE ===');
  // Order TSS1250 was flagged
  const { data: ord } = await supabase.from('orders').select('*').ilike('external_order_number', '%TSS1250%').single();
  console.log('Orden TSS1250:', {
    id: ord.id,
    external_order_number: ord.external_order_number,
    status: ord.status,
    estado_wms: ord.estado_wms,
    created_at: ord.created_at,
    sucursal_pickeo: ord.sucursal_pickeo
  });

  const { data: items } = await supabase.from('order_items').select('*, products(*)').eq('order_id', ord.id);
  console.log('Items TSS1250:', items.map(i => ({ sku: i.products?.sku, name: i.products?.name, qty: i.quantity, wh: i.warehouse_id })));

  // Order TSS1083
  const { data: ord1083 } = await supabase.from('orders').select('*').ilike('external_order_number', '%TSS1083%').single();
  console.log('\nOrden TSS1083:', {
    id: ord1083.id,
    external_order_number: ord1083.external_order_number,
    status: ord1083.status,
    estado_wms: ord1083.estado_wms,
    stock_descontado: ord1083.stock_descontado,
    stock_descontado_at: ord1083.stock_descontado_at,
    created_at: ord1083.created_at,
    sucursal_pickeo: ord1083.sucursal_pickeo
  });

  const { data: items1083 } = await supabase.from('order_items').select('*, products(*)').eq('order_id', ord1083.id);
  console.log('Items TSS1083:', items1083.map(i => ({ sku: i.products?.sku, name: i.products?.name, qty: i.quantity, wh: i.warehouse_id })));

  const { data: movs1083 } = await supabase.from('movements').select('*, products(sku, comercio)').eq('order_id', ord1083.id);
  console.log('Movimientos vinculados TSS1083:', movs1083.map(m => ({ id: m.id, ref: m.reference_doc, sku: m.products?.sku, com: m.products?.comercio })));

  // Check inventory for DR0004
  const { data: prod } = await supabase.from('products').select('*').eq('sku', 'DR0004').eq('comercio', 'THE SKIN STORE').single();
  const { data: inv } = await supabase.from('inventory').select('*').eq('product_id', prod.id).eq('warehouse_id', '973da888-8a63-4790-a08f-919e1af41a93').single();
  const { data: searchTSS1083 } = await supabase.from('movements').select('*').ilike('reference_doc', '%TSS1083%');
  console.log('Movimientos con ref TSS1083:', searchTSS1083);
}

inspectTSS().catch(console.error);
