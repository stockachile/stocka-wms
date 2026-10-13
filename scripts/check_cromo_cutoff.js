const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k] = v.join('=').replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function checkCromoCutoff() {
  console.log('=== EVALUANDO CROMO CON REGLAS DE CORTE ===');

  const { data: sampleOrders } = await supabase
    .from('orders')
    .select('id, created_at, external_order_number')
    .eq('comercio', 'CROMO')
    .ilike('external_order_number', '%2044%');

  console.log('Sample orders with 2044:', sampleOrders);
  const refOrder = sampleOrders && sampleOrders.length ? sampleOrders[0] : null;
  const cutoffDate = refOrder ? refOrder.created_at : '2026-07-01T00:00:00Z';

  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, created_at, status, estado_wms, stock_descontado, sucursal_pickeo')
    .eq('comercio', 'CROMO')
    .or('status.eq.despachado,estado_wms.eq.Despachado')
    .gte('created_at', cutoffDate)
    .order('created_at', { ascending: true });

  console.log(`\nTotal órdenes despachadas desde corte: ${orders.length}`);

  const orderIds = orders.map(o => o.id);
  
  let allItems = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data: items } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, warehouse_id, products(sku, name, comercio)')
      .in('order_id', chunk);
    if (items) allItems.push(...items);
  }

  let allMovs = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data: movs } = await supabase
      .from('movements')
      .select('id, order_id, product_id, quantity, reference_doc, products(sku, comercio)')
      .in('order_id', chunk);
    if (movs) allMovs.push(...movs);
  }

  let problemOrders = [];
  for (const ord of orders) {
    const items = allItems.filter(i => i.order_id === ord.id);
    const movs = allMovs.filter(m => m.order_id === ord.id);

    const foreignMovs = movs.filter(m => m.products && m.products.comercio !== 'CROMO');
    const missingItems = items.filter(it => {
      const match = movs.find(m => m.product_id === it.product_id);
      return !match;
    });

    if (foreignMovs.length > 0 || missingItems.length > 0) {
      problemOrders.push({
        order: ord,
        foreignMovs,
        missingItems
      });
    }
  }

  console.log(`\nÓrdenes con discrepancias en el período activo: ${problemOrders.length}`);
  problemOrders.forEach(p => {
    console.log(`\n• Pedido ${p.order.external_order_number} (${p.order.id}):`);
    if (p.foreignMovs.length) {
      console.log('  ⚠️ MOVIMIENTOS AJENOS:', p.foreignMovs.map(m => `${m.id} (${m.reference_doc}, ${m.products?.comercio}, ${m.products?.sku})`));
    }
    if (p.missingItems.length) {
      console.log('  ❌ ITEMS SIN KARDEX:', p.missingItems.map(i => `${i.products?.sku} x ${i.quantity}`));
    }
  });

  // Current stock of C0076 in Matriz Ñuñoa
  const { data: prod } = await supabase.from('products').select('id, sku').eq('sku', 'C0076').eq('comercio', 'CROMO').single();
  const { data: inv } = await supabase.from('inventory').select('*').eq('product_id', prod.id).eq('warehouse_id', '973da888-8a63-4790-a08f-919e1af41a93').single();
  console.log('\nStock actual en Matriz Ñuñoa de C0076:', inv);
}

checkCromoCutoff().catch(console.error);
