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

async function runIntegrityAudit() {
  const targetCommerce = process.argv[2] || null;

  console.log('================================================================');
  console.log('AUDITORÍA DE INTEGRIDAD: KARDEX Y DESCUENTOS DE STOCK');
  if (targetCommerce) {
    console.log(`Filtro por comercio: "${targetCommerce}"`);
  } else {
    console.log('Alcance: TODOS LOS COMERCIOS');
  }
  console.log('================================================================\n');

  // 1. Cargar todos los movimientos de salida
  console.log('1. Cargando movimientos de salida (type = out)...');
  const allOutMovements = [];
  let from = 0;
  while (true) {
    const { data: batch, error } = await supabase
      .from('movements')
      .select('id, order_id, product_id, reference_doc, quantity, date, type, warehouse_id, products(id, sku, name, comercio)')
      .eq('type', 'out')
      .range(from, from + 999);

    if (error) throw error;
    allOutMovements.push(...(batch || []));
    if (!batch || batch.length < 1000) break;
    from += 1000;
  }
  console.log(`   -> Total movimientos 'out' en base de datos: ${allOutMovements.length}`);

  // Indexar movimientos
  const movsByOrderId = new Map();
  const movsByRef = new Map();

  for (const m of allOutMovements) {
    if (m.order_id) {
      if (!movsByOrderId.has(m.order_id)) movsByOrderId.set(m.order_id, []);
      movsByOrderId.get(m.order_id).push(m);
    }
    if (m.reference_doc) {
      const cleanRef = m.reference_doc.trim().toLowerCase();
      if (!movsByRef.has(cleanRef)) movsByRef.set(cleanRef, []);
      movsByRef.get(cleanRef).push(m);
    }
  }

  // 2. Cargar órdenes despachadas
  console.log('2. Cargando órdenes despachadas...');
  let ordersQuery = supabase
    .from('orders')
    .select('id, external_order_number, comercio, status, estado_wms, stock_descontado, stock_descontado_at, created_at, sucursal_pickeo')
    .or('estado_wms.eq.Despachado,stock_descontado.eq.true');

  if (targetCommerce) {
    ordersQuery = ordersQuery.ilike('comercio', `%${targetCommerce}%`);
  }

  const allDispatchedOrders = [];
  from = 0;
  while (true) {
    const { data: batch, error } = await ordersQuery.range(from, from + 999);
    if (error) throw error;
    allDispatchedOrders.push(...(batch || []));
    if (!batch || batch.length < 1000) break;
    from += 1000;
  }
  console.log(`   -> Total órdenes despachadas analizadas: ${allDispatchedOrders.length}`);

  const orderMap = new Map();
  allDispatchedOrders.forEach(o => orderMap.set(o.id, o));

  // 3. Chequeo de colisiones cruzadas (Movimientos asignados a un comercio incorrecto)
  console.log('3. Verificando movimientos cruzados (asignaciones erróneas de otro comercio)...');
  const mismatchedOrders = new Map();

  for (const m of allOutMovements) {
    if (!m.order_id) continue;
    const ord = orderMap.get(m.order_id);
    if (ord) {
      const prodComercio = m.products?.comercio || '';
      if (prodComercio && ord.comercio && prodComercio.toUpperCase() !== ord.comercio.toUpperCase()) {
        if (!mismatchedOrders.has(ord.id)) {
          mismatchedOrders.set(ord.id, { order: ord, badMovements: [] });
        }
        mismatchedOrders.get(ord.id).badMovements.push(m);
      }
    }
  }

  // 4. Verificación ítem por ítem en order_items
  console.log('4. Verificando que cada producto físico tenga movimiento en Kardex...');
  const orderIdsList = allDispatchedOrders.map(o => o.id);
  const itemsByOrderId = new Map();

  for (let i = 0; i < orderIdsList.length; i += 200) {
    const chunk = orderIdsList.slice(i, i + 200);
    const { data: items, error } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, warehouse_id, products(id, sku, name, is_virtual, comercio)')
      .in('order_id', chunk);

    if (error) {
      console.error('Error cargando order_items:', error);
      break;
    }

    (items || []).forEach(it => {
      if (!itemsByOrderId.has(it.order_id)) itemsByOrderId.set(it.order_id, []);
      itemsByOrderId.get(it.order_id).push(it);
    });
  }

  const ordersMissingRealMovements = [];
  const missingByCommerce = {};

  for (const ord of allDispatchedOrders) {
    const rawItems = itemsByOrderId.get(ord.id) || [];
    const physicalItems = rawItems.filter(it => it.products && !it.products.is_virtual && it.quantity > 0);
    if (physicalItems.length === 0) continue;

    const linkedMovs = movsByOrderId.get(ord.id) || [];
    const refKey1 = `pedido ${ord.id}`.toLowerCase();
    const refKey2 = `pedido ${ord.external_order_number || ''}`.toLowerCase();
    const refKey3 = `pedido #${ord.external_order_number || ''}`.toLowerCase();

    const refMovs1 = movsByRef.get(refKey1) || [];
    const refMovs2 = ord.external_order_number ? (movsByRef.get(refKey2) || []) : [];
    const refMovs3 = ord.external_order_number ? (movsByRef.get(refKey3) || []) : [];

    const candidateMovs = [...linkedMovs, ...refMovs1, ...refMovs2, ...refMovs3];

    const unbackedItems = [];
    for (const item of physicalItems) {
      const hasMov = candidateMovs.some(m => m.product_id === item.product_id);
      if (!hasMov) {
        unbackedItems.push(item);
      }
    }

    if (unbackedItems.length > 0) {
      const record = {
        order: ord,
        totalItems: physicalItems.length,
        missingItemsCount: unbackedItems.length,
        unbackedItems: unbackedItems.map(it => ({
          sku: it.products?.sku,
          name: it.products?.name,
          quantity: it.quantity,
          comercio: it.products?.comercio
        })),
        hasMismatchedForeignMovement: mismatchedOrders.has(ord.id)
      };
      ordersMissingRealMovements.push(record);
      const com = ord.comercio || 'Sin Comercio';
      if (!missingByCommerce[com]) missingByCommerce[com] = [];
      missingByCommerce[com].push(record);
    }
  }

  console.log('\n================================================================');
  console.log(`RESULTADOS DE LA AUDITORÍA:`);
  console.log(`- Órdenes con movimientos robados de otro comercio: ${mismatchedOrders.size}`);
  console.log(`- Órdenes despachadas con ítems faltantes en el Kardex: ${ordersMissingRealMovements.length}`);
  console.log('================================================================');

  if (mismatchedOrders.size > 0) {
    console.log('\n🚨 DETALLE DE ÓRDENES CON COLISIÓN CRUZADA:');
    for (const [ordId, data] of mismatchedOrders.entries()) {
      console.log(`\n• Pedido: ${data.order.external_order_number || data.order.id} | Comercio: "${data.order.comercio}" | Fecha: ${data.order.created_at?.substring(0, 10)}`);
      for (const bm of data.badMovements) {
        console.log(`   ⚠️ Movimiento ajeno: ID ${bm.id} | Ref: "${bm.reference_doc}" | Producto: ${bm.products?.sku} | Comercio Original: "${bm.products?.comercio}"`);
      }
    }
  }

  console.log('\n📋 RESUMEN DE ÓRDENES SIN MOVIMIENTOS POR COMERCIO:');
  for (const [com, list] of Object.entries(missingByCommerce)) {
    const colCount = list.filter(l => l.hasMismatchedForeignMovement).length;
    console.log(` - ${com}: ${list.length} órdenes sin Kardex (${colCount} con colisión cruzada confirmada)`);
  }

  const reportPath = path.join(__dirname, 'kardex_integrity_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    filterCommerce: targetCommerce,
    mismatchedForeignOrdersCount: mismatchedOrders.size,
    ordersMissingRealMovementsCount: ordersMissingRealMovements.length,
    missingByCommerceSummary: Object.fromEntries(
      Object.entries(missingByCommerce).map(([c, list]) => [c, list.length])
    ),
    mismatchedOrders: Array.from(mismatchedOrders.values()),
    ordersMissingRealMovements
  }, null, 2));

  console.log(`\n💾 Reporte detallado guardado en: scripts/kardex_integrity_report.json\n`);
}

runIntegrityAudit().catch(console.error);
