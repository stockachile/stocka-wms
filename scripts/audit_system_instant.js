const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf-8');
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = val;
  }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function instantAudit() {
  console.log('=== AUDITORIA COMPLETA INSTANTÁNEA EN TODOS LOS COMERCIOS ===');

  // 1. Cargar todos los movimientos en memoria
  console.log('1. Cargando todos los movimientos...');
  const allMovements = [];
  let from = 0;
  while (true) {
    const { data: batch, error } = await supabase
      .from('movements')
      .select('id, order_id, product_id, reference_doc, quantity, date, type, warehouse_id')
      .range(from, from + 999);
    
    if (error) throw error;
    allMovements.push(...(batch || []));
    if (!batch || batch.length < 1000) break;
    from += 1000;
  }
  console.log(`Movimientos cargados: ${allMovements.length}`);

  const movOrderIdSet = new Set();
  const allRefDocs = [];
  for (const m of allMovements) {
    if (m.type === 'out') {
      if (m.order_id) movOrderIdSet.add(m.order_id);
      if (m.reference_doc) allRefDocs.push({ text: m.reference_doc.toLowerCase(), original: m.reference_doc });
    }
  }

  // 2. Cargar comercios activos y fechas de inicio
  console.log('2. Cargando comercios y configuraciones de corte...');
  const { data: configs } = await supabase
    .from('comercios_adicional_config')
    .select('*')
    .eq('inventario_seguimiento', true);

  const startOrderTimestamps = {};
  for (const cfg of configs) {
    const com = cfg.comercio;
    const inicioPed = cfg.inventario_inicio_pedidos || {};
    startOrderTimestamps[com] = {};

    for (const [platform, pConfig] of Object.entries(inicioPed)) {
      if (!pConfig || pConfig === 'null') continue;
      const startNum = pConfig.external_order_number;
      if (startNum) {
        const { data: cutOrders } = await supabase
          .from('orders')
          .select('id, created_at, external_order_number')
          .eq('comercio', com)
          .eq('external_order_number', startNum)
          .limit(1);
        
        if (cutOrders && cutOrders.length > 0) {
          startOrderTimestamps[com][platform] = {
            id: cutOrders[0].id,
            timestamp: new Date(cutOrders[0].created_at).getTime(),
            startNum: startNum,
            include: pConfig.incluir !== false
          };
        } else {
          startOrderTimestamps[com][platform] = {
            id: null,
            timestamp: null,
            startNum: startNum,
            cleanNum: parseInt(startNum.replace(/[^0-9]/g, ''), 10),
            include: pConfig.incluir !== false
          };
        }
      }
    }
  }

  function checkShouldProcess(order, cfg) {
    if (order.origen === 'Logística Inversa' && (
      order.raw_shopify_data?.rl_type === 'DEVOLUCION' ||
      order.raw_shopify_data?.no_stock_deduction === 'true' ||
      (order.shipping_method && order.shipping_method.toLowerCase().includes('devolucion'))
    )) {
      return false;
    }

    if (!cfg.inventario_seguimiento) return false;

    const plat = order.external_platform || 'Manual';
    const startInfo = startOrderTimestamps[order.comercio]?.[plat];
    if (!startInfo) return true;

    const orderTime = new Date(order.created_at).getTime();

    if (startInfo.timestamp) {
      if (startInfo.include) {
        return orderTime >= startInfo.timestamp;
      } else {
        if (order.id === startInfo.id || order.external_order_number === startInfo.startNum) return false;
        return orderTime > startInfo.timestamp;
      }
    } else if (!isNaN(startInfo.cleanNum)) {
      const cleanOrd = parseInt((order.external_order_number || '').replace(/[^0-9]/g, ''), 10);
      if (isNaN(cleanOrd)) return true;
      if (startInfo.include) {
        return cleanOrd >= startInfo.cleanNum;
      } else {
        return cleanOrd > startInfo.cleanNum;
      }
    }

    return true;
  }

  // 3. Evaluar órdenes de cada comercio
  console.log('3. Evaluando pedidos de cada comercio...');
  const allCandidateMissing = [];

  for (const cfg of configs) {
    const com = cfg.comercio;
    let orders = [];
    from = 0;
    while (true) {
      const { data: batch, error } = await supabase
        .from('orders')
        .select(`
          id,
          external_order_number,
          comercio,
          status,
          estado_wms,
          created_at,
          external_platform,
          stock_descontado,
          stock_descontado_at,
          sucursal_pickeo,
          origen,
          shipping_method,
          raw_shopify_data
        `)
        .eq('comercio', com)
        .eq('estado_wms', 'Despachado')
        .range(from, from + 999);

      if (error) { console.error(`Error orders ${com}:`, error); break; }
      orders.push(...(batch || []));
      if (!batch || batch.length < 1000) break;
      from += 1000;
    }

    const eligibleOrders = orders.filter(o => checkShouldProcess(o, cfg));
    for (const ord of eligibleOrders) {
      // 1. Por order_id
      if (movOrderIdSet.has(ord.id)) continue;

      // 2. Por external_order_number
      const ext = (ord.external_order_number || '').trim().toLowerCase();
      if (ext && allRefDocs.some(r => r.text.includes(ext))) continue;

      allCandidateMissing.push(ord);
    }
  }

  console.log(`Candidatos iniciales sin movimientos: ${allCandidateMissing.length}`);

  // 4. Batch query para los order_items de todos los candidatos (por lotes de 200)
  console.log('4. Verificando ítems físicos por lotes...');
  const itemsByOrderId = new Map();
  const candidateIds = allCandidateMissing.map(c => c.id);

  for (let i = 0; i < candidateIds.length; i += 200) {
    const slice = candidateIds.slice(i, i + 200);
    const { data: items } = await supabase
      .from('order_items')
      .select(`
        id,
        order_id,
        product_id,
        quantity,
        warehouse_id,
        products (
          id,
          sku,
          name,
          is_virtual
        )
      `)
      .in('order_id', slice);

    (items || []).forEach(it => {
      if (!itemsByOrderId.has(it.order_id)) itemsByOrderId.set(it.order_id, []);
      itemsByOrderId.get(it.order_id).push(it);
    });
  }

  // 5. Filtrar solo los que tienen ítems físicos y clasificar colisiones
  const finalMissing = [];
  const byCommerceSummary = {};

  for (const ord of allCandidateMissing) {
    const rawItems = itemsByOrderId.get(ord.id) || [];
    const physicalItems = rawItems.filter(it => it.products && !it.products.is_virtual && it.quantity > 0);
    if (physicalItems.length === 0) continue;

    // Detectar colisión con regla de dígitos
    const cleanNum = (ord.external_order_number || '').replace(/[^0-9]/g, '');
    let collisionDoc = null;
    if (cleanNum && cleanNum.length >= 3) {
      const col = allRefDocs.find(r => r.text.includes(cleanNum));
      if (col) collisionDoc = col.original;
    }

    const orderObj = {
      id: ord.id,
      external_order_number: ord.external_order_number,
      comercio: ord.comercio,
      platform: ord.external_platform,
      created_at: ord.created_at,
      status: ord.status,
      estado_wms: ord.estado_wms,
      stock_descontado: ord.stock_descontado,
      stock_descontado_at: ord.stock_descontado_at,
      sucursal_pickeo: ord.sucursal_pickeo,
      collisionWith: collisionDoc,
      items: physicalItems.map(it => ({
        product_id: it.product_id,
        sku: it.products.sku,
        name: it.products.name,
        quantity: it.quantity,
        warehouse_id: it.warehouse_id
      }))
    };

    finalMissing.push(orderObj);
    byCommerceSummary[ord.comercio] = byCommerceSummary[ord.comercio] || [];
    byCommerceSummary[ord.comercio].push(orderObj);
  }

  console.log('\n=============================================================');
  console.log(`TOTAL REAL DE PEDIDOS AFECTADOS SIN KARDEX: ${finalMissing.length}`);
  console.log('=============================================================');

  for (const [com, list] of Object.entries(byCommerceSummary)) {
    const colCount = list.filter(o => o.collisionWith).length;
    console.log(`\n• ${com}: ${list.length} pedidos sin Kardex (${colCount} confirmados por colisión de números)`);
    list.slice(0, 10).forEach(o => {
      console.log(`   - ${o.external_order_number} | Fecha: ${o.created_at.substring(0, 10)} | Ítems: ${o.items.length} uds | Colisión: ${o.collisionWith || 'Ninguna'}`);
    });
    if (list.length > 10) console.log(`   ... y ${list.length - 10} más`);
  }

  fs.writeFileSync('scripts/instant_audit_report.json', JSON.stringify({
    totalCount: finalMissing.length,
    byCommerce: byCommerceSummary,
    allOrders: finalMissing
  }, null, 2));

  console.log('\nReporte guardado exitosamente en scripts/instant_audit_report.json');
}

instantAudit();
