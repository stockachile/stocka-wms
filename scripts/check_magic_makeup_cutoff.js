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

async function checkMagicCutoff() {
  console.log('=== EVALUANDO MAGIC MAKEUP CON REGLAS DE CORTE ===');

  const { data: refOrder } = await supabase
    .from('orders')
    .select('id, created_at, external_order_number')
    .ilike('external_order_number', '%MAG5575%')
    .eq('comercio', 'MAGIC MAKEUP')
    .single();

  console.log('Corte Shopify MAG5575:', refOrder);
  const cutoffDate = refOrder.created_at;

  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, created_at, status, estado_wms, stock_descontado, sucursal_pickeo')
    .eq('comercio', 'MAGIC MAKEUP')
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

    const foreignMovs = movs.filter(m => m.products && m.products.comercio !== 'MAGIC MAKEUP');
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
}

checkMagicCutoff().catch(console.error);
