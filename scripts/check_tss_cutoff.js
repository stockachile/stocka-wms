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

async function checkTSSCutoff() {
  console.log('=== EVALUANDO THE SKIN STORE CON REGLAS DE CORTE ===');

  // Buscar orden de corte TSS1063
  const { data: refOrder } = await supabase
    .from('orders')
    .select('id, created_at, external_order_number')
    .ilike('external_order_number', '%TSS1063%')
    .eq('comercio', 'THE SKIN STORE')
    .single();

  console.log('Corte Shopify TSS1063:', refOrder);
  const cutoffDate = refOrder.created_at;

  // Obtener todas las órdenes despachadas desde cutoffDate
  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, created_at, status, estado_wms, stock_descontado, sucursal_pickeo')
    .eq('comercio', 'THE SKIN STORE')
    .or('status.eq.despachado,estado_wms.eq.Despachado')
    .gte('created_at', cutoffDate)
    .order('created_at', { ascending: true });

  console.log(`\nTotal órdenes despachadas desde corte: ${orders.length}`);

  const orderIds = orders.map(o => o.id);
  
  // Buscar items en chunks
  let allItems = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data: items } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, warehouse_id, products(sku, name, comercio)')
      .in('order_id', chunk);
    if (items) allItems.push(...items);
  }

  // Buscar movimientos vinculados en chunks
  let allMovs = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data: movs } = await supabase
      .from('movements')
      .select('id, order_id, product_id, quantity, reference_doc, products(sku, comercio)')
      .in('order_id', chunk);
    if (movs) allMovs.push(...movs);
  }

  console.log(`Total items encontrados: ${allItems.length}`);
  console.log(`Total movimientos vinculados: ${allMovs.length}`);

  let problemOrders = [];
  for (const ord of orders) {
    const items = allItems.filter(i => i.order_id === ord.id);
    const movs = allMovs.filter(m => m.order_id === ord.id);

    // Chequear si tiene movimientos ajenos
    const foreignMovs = movs.filter(m => m.products && m.products.comercio !== 'THE SKIN STORE');
    // Chequear items sin movimiento correspondiente
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

checkTSSCutoff().catch(console.error);
