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

async function filterHitGamingByCutoff() {
  console.log('=== EVALUANDO HIT GAMING CON REGLAS DE CORTE ===');

  // Configuración de corte para HIT GAMING:
  // Shopify: HIT1018 (no incluir, pedidos > 1018)
  // MercadoLibre: 2000014489824909 (no incluir, pedidos > fecha o número)
  
  const { data: cutOrderShopify } = await supabase
    .from('orders')
    .select('id, created_at, external_order_number')
    .eq('comercio', 'HIT GAMING')
    .eq('external_order_number', 'HIT1018')
    .single();

  const { data: cutOrderMeli } = await supabase
    .from('orders')
    .select('id, created_at, external_order_number')
    .eq('comercio', 'HIT GAMING')
    .ilike('external_order_number', '%2000014489824909%')
    .maybeSingle();

  console.log('Corte Shopify HIT1018:', cutOrderShopify);
  console.log('Corte MercadoLibre:', cutOrderMeli);

  const shopifyCutTime = cutOrderShopify ? new Date(cutOrderShopify.created_at).getTime() : 0;
  const meliCutTime = cutOrderMeli ? new Date(cutOrderMeli.created_at).getTime() : 0;

  // Cargar órdenes despachadas
  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, external_platform, created_at, status, estado_wms, stock_descontado')
    .eq('comercio', 'HIT GAMING')
    .eq('estado_wms', 'Despachado');

  const eligibleOrders = (orders || []).filter(o => {
    const t = new Date(o.created_at).getTime();
    if (o.external_platform === 'Shopify' || (o.external_order_number && o.external_order_number.startsWith('HIT1'))) {
      const num = parseInt((o.external_order_number || '').replace(/[^0-9]/g, ''), 10);
      return num > 1018;
    }
    if (meliCutTime > 0) {
      return t > meliCutTime;
    }
    return true;
  });

  console.log(`\nTotal órdenes despachadas después de fecha/pedido de corte: ${eligibleOrders.length}`);

  // Revisar movimientos para estas órdenes elegibles
  const eligibleIds = eligibleOrders.map(o => o.id);
  const issues = [];

  for (let i = 0; i < eligibleIds.length; i += 100) {
    const chunkIds = eligibleIds.slice(i, i + 100);
    
    // items
    const { data: items } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, products(sku, name, is_virtual)')
      .in('order_id', chunkIds);

    // movs
    const { data: movs } = await supabase
      .from('movements')
      .select('id, order_id, product_id, reference_doc, quantity, products(sku, name, comercio)')
      .in('order_id', chunkIds)
      .eq('type', 'out');

    const itemsByOrd = new Map();
    (items || []).forEach(it => {
      if (!itemsByOrd.has(it.order_id)) itemsByOrd.set(it.order_id, []);
      itemsByOrd.get(it.order_id).push(it);
    });

    const movsByOrd = new Map();
    (movs || []).forEach(m => {
      if (!movsByOrd.has(m.order_id)) movsByOrd.set(m.order_id, []);
      movsByOrd.get(m.order_id).push(m);
    });

    for (const ordId of chunkIds) {
      const ord = eligibleOrders.find(o => o.id === ordId);
      const ordItems = (itemsByOrd.get(ordId) || []).filter(it => it.products && !it.products.is_virtual && it.quantity > 0);
      const ordMovs = movsByOrd.get(ordId) || [];

      // foreign movements
      const foreignMovs = ordMovs.filter(m => m.products?.comercio && m.products.comercio !== 'HIT GAMING');

      // missing items
      const missingItems = ordItems.filter(it => !ordMovs.some(m => m.product_id === it.product_id && (!m.products?.comercio || m.products.comercio === 'HIT GAMING')));

      if (foreignMovs.length > 0 || missingItems.length > 0) {
        issues.push({
          order: ord,
          foreignMovs,
          missingItems
        });
      }
    }
  }

  console.log(`\nÓrdenes con problemas dentro del período activo de inventario: ${issues.length}`);
  for (const iss of issues) {
    console.log(`\n• Pedido: ${iss.order.external_order_number} (${iss.order.id}) | Fecha: ${iss.order.created_at}`);
    if (iss.foreignMovs.length > 0) {
      console.log('  🚨 MOVIMIENTOS AJENOS ROBADOS:');
      iss.foreignMovs.forEach(fm => {
        console.log(`     - Mov ID: ${fm.id} | Ref: "${fm.reference_doc}" | Prod: ${fm.products?.sku} | Comercio: ${fm.products?.comercio}`);
      });
    }
    if (iss.missingItems.length > 0) {
      console.log('  ❌ ÍTEMS SIN KARDEX:');
      iss.missingItems.forEach(mi => {
        console.log(`     - SKU: ${mi.products?.sku} | Cant: ${mi.quantity} | Prod: ${mi.products?.name}`);
      });
    }
  }
}

filterHitGamingByCutoff().catch(console.error);
