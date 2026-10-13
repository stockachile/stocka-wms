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

async function inspectCommerce(commerceName) {
  console.log(`================================================================`);
  console.log(`REVISIÓN DETALLADA 1 A 1: COMERCIO "${commerceName}"`);
  console.log(`================================================================\n`);

  // 1. Configuración de inventario
  const { data: cfg } = await supabase
    .from('comercios_adicional_config')
    .select('*')
    .eq('comercio', commerceName)
    .maybeSingle();

  console.log('1. Configuración de inventario:', {
    inventario_seguimiento: cfg?.inventario_seguimiento,
    inventario_inicio_pedidos: cfg?.inventario_inicio_pedidos
  });

  // 2. Órdenes despachadas
  const { data: orders, error: ordErr } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, status, estado_wms, stock_descontado, stock_descontado_at, created_at, sucursal_pickeo')
    .eq('comercio', commerceName)
    .eq('estado_wms', 'Despachado')
    .order('created_at', { ascending: false });

  if (ordErr) {
    console.error('Error cargando órdenes:', ordErr);
    return;
  }

  console.log(`\n2. Total órdenes despachadas en WMS: ${orders?.length || 0}`);
  if (!orders || orders.length === 0) return;

  const orderIds = orders.map(o => o.id);

  // 3. Batch load order_items in chunks of 100
  const itemsByOrder = new Map();
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data: itemsChunk, error: itChunkErr } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, warehouse_id, products(id, sku, name, is_virtual, comercio)')
      .in('order_id', chunk);

    if (itChunkErr) console.error('Error cargando order_items chunk:', itChunkErr);
    (itemsChunk || []).forEach(it => {
      if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
      itemsByOrder.get(it.order_id).push(it);
    });
  }

  // 4. Batch load all movements linked by order_id in chunks of 100
  const movsByOrderIdMap = new Map();
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data: movsChunk, error: movChunkErr } = await supabase
      .from('movements')
      .select('id, reference_doc, order_id, product_id, quantity, date, type, warehouse_id, products(sku, name, comercio)')
      .in('order_id', chunk)
      .eq('type', 'out');

    if (movChunkErr) console.error('Error cargando movements chunk:', movChunkErr);
    (movsChunk || []).forEach(m => {
      if (!movsByOrderIdMap.has(m.order_id)) movsByOrderIdMap.set(m.order_id, []);
      movsByOrderIdMap.get(m.order_id).push(m);
    });
  }

  // Also load movements matching reference_doc 'Pedido <order_num>'
  const refSet = new Set();
  orders.forEach(o => {
    if (o.external_order_number) {
      refSet.add(`pedido ${o.external_order_number.trim()}`.toLowerCase());
      refSet.add(`pedido #${o.external_order_number.trim()}`.toLowerCase());
    }
    refSet.add(`pedido ${o.id}`.toLowerCase());
  });

  const { data: movsByCom } = await supabase
    .from('movements')
    .select('id, reference_doc, order_id, product_id, quantity, date, type, warehouse_id, products!inner(sku, name, comercio)')
    .eq('products.comercio', commerceName)
    .eq('type', 'out');


  const movsByRefMap = new Map();
  (movsByCom || []).forEach(m => {
    if (m.reference_doc) {
      const k = m.reference_doc.trim().toLowerCase();
      if (!movsByRefMap.has(k)) movsByRefMap.set(k, []);
      movsByRefMap.get(k).push(m);
    }
  });

  // 5. Comparar cada orden
  const issues = [];
  const validOrders = [];

  for (const o of orders) {
    const rawItems = itemsByOrder.get(o.id) || [];
    const physicalItems = rawItems.filter(i => i.products && !i.products.is_virtual && i.quantity > 0);

    const linked = movsByOrderIdMap.get(o.id) || [];
    const refKey1 = `pedido ${o.id}`.toLowerCase();
    const refKey2 = `pedido ${o.external_order_number || ''}`.toLowerCase();
    const refKey3 = `pedido #${o.external_order_number || ''}`.toLowerCase();

    const byRef1 = movsByRefMap.get(refKey1) || [];
    const byRef2 = o.external_order_number ? (movsByRefMap.get(refKey2) || []) : [];
    const byRef3 = o.external_order_number ? (movsByRefMap.get(refKey3) || []) : [];

    const allCandMovs = [...linked, ...byRef1, ...byRef2, ...byRef3];

    // Detectar movimientos ajenos
    const foreignMovs = linked.filter(m => m.products?.comercio && m.products.comercio.toUpperCase() !== commerceName.toUpperCase());

    // Detectar items físicos sin respaldo de movimiento legítimo
    const unbackedItems = [];
    for (const it of physicalItems) {
      const legitMov = allCandMovs.find(m => m.product_id === it.product_id && (!m.products?.comercio || m.products.comercio.toUpperCase() === commerceName.toUpperCase()));
      if (!legitMov) {
        unbackedItems.push(it);
      }
    }

    if (foreignMovs.length > 0 || unbackedItems.length > 0) {
      issues.push({
        order: o,
        physicalItems,
        foreignMovs,
        unbackedItems
      });
    } else {
      validOrders.push(o);
    }
  }

  console.log(`✔ Órdenes con Kardex 100% correcto: ${validOrders.length}`);
  console.log(`⚠️ Órdenes con anomalías detectadas: ${issues.length}\n`);

  for (const iss of issues) {
    const o = iss.order;
    console.log(`----------------------------------------------------------------`);
    console.log(`• Pedido: ${o.external_order_number || o.id}`);
    console.log(`  ID Interno: ${o.id}`);
    console.log(`  Fecha Creación: ${o.created_at}`);
    console.log(`  Estado: status='${o.status}', estado_wms='${o.estado_wms}', stock_descontado=${o.stock_descontado}`);
    console.log(`  Sucursal Pickeo: ${o.sucursal_pickeo || 'No asignada'}`);
    
    if (iss.foreignMovs.length > 0) {
      console.log(`  🚨 MOVIMIENTOS AJENOS ROBADOS (${iss.foreignMovs.length}):`);
      for (const fm of iss.foreignMovs) {
        console.log(`     - Mov ID: ${fm.id} | Ref: "${fm.reference_doc}" | Producto: ${fm.products?.sku} (${fm.products?.name}) | Comercio Original: "${fm.products?.comercio}" | Fecha Mov: ${fm.date}`);
      }
    }

    if (iss.unbackedItems.length > 0) {
      console.log(`  ❌ ÍTEMS REALES SIN REGISTRO EN KARDEX (${iss.unbackedItems.length}):`);
      for (const ui of iss.unbackedItems) {
        console.log(`     - SKU: ${ui.products?.sku} | Cantidad: ${ui.quantity} | Producto: ${ui.products?.name} | Warehouse: ${ui.warehouse_id}`);
      }
    }
  }
}

inspectCommerce(process.argv[2] || 'NOMAD').catch(console.error);
