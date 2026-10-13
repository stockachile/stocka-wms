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

async function inspectCromo() {
  console.log('=== INSPECCIÓN CROMO ===');
  const { data: ords } = await supabase.from('orders').select('*').eq('comercio', 'CROMO').ilike('external_order_number', '%2074%');
  console.log('Órdenes CROMO con 2074:', ords);
  const ord = ords && ords.length ? ords[0] : null;
  if (!ord) return;
  console.log('Orden CRO#2074:', {
    id: ord.id,
    external_order_number: ord.external_order_number,
    status: ord.status,
    estado_wms: ord.estado_wms,
    created_at: ord.created_at,
    sucursal_pickeo: ord.sucursal_pickeo
  });

  const { data: items } = await supabase.from('order_items').select('*, products(*)').eq('order_id', ord.id);
  console.log('Items CRO#2074:', items.map(i => ({ sku: i.products?.sku, name: i.products?.name, qty: i.quantity, wh: i.warehouse_id })));

  const { data: ordsById, error: errById } = await supabase
    .from('orders')
    .select('id, external_order_number, status, estado_wms, stock_descontado, stock_descontado_at, sucursal_pickeo, created_at')
    .in('id', ['09c1f899-e6ba-4c0e-9e94-4a5339cf4f84', 'b905d2cf-54d1-443d-8cc7-e3afcb499cbb']);
  console.log('\nÓrdenes manuales:', ordsById);
  const { data: manualCutoff } = await supabase.from('orders').select('id, external_order_number, created_at, status, estado_wms').ilike('external_order_number', '%LI-1906-9C7D%');
  console.log('Manual cutoff order:', manualCutoff);

  const { data: prods } = await supabase.from('products').select('id, sku, name').in('sku', ['C0061', 'C0083']).eq('comercio', 'CROMO');
  const prodIds = prods.map(p => p.id);
  const { data: inv } = await supabase.from('inventory').select('*').in('product_id', prodIds).eq('warehouse_id', '973da888-8a63-4790-a08f-919e1af41a93');
  console.log('Prods:', prods);
  console.log('Inv:', inv);
}

inspectCromo().catch(console.error);
