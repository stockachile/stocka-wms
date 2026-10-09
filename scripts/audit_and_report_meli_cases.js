const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const envConfig = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envConfig.split(/\r?\n/).forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    envVars[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
});

const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function runAudit() {
  console.log('🔍 Iniciando auditoría exhaustiva de órdenes Mercado Libre...');

  let from = 0;
  const batchSize = 1000;
  const allOrders = [];

  while (true) {
    const { data: page, error } = await supabase
      .from('orders')
      .select('id, external_order_number, comercio, customer_name, tracking_number, status, estado_wms, cantidad, total_value, stock_descontado, raw_meli_data, order_items(id, product_id, quantity, product:products(sku, name))')
      .eq('external_platform', 'MercadoLibre')
      .range(from, from + batchSize - 1);

    if (error || !page || page.length === 0) break;
    allOrders.push(...page);
    if (page.length < batchSize) break;
    from += batchSize;
  }

  console.log(`📦 Total órdenes Mercado Libre analizadas: ${allOrders.length}`);

  // Only check movements for recent Mercado Libre orders that have stock_descontado = true
  const ordersWithStock = allOrders.filter(o => o.stock_descontado);
  console.log(`🔍 Órdenes con stock descontado a verificar: ${ordersWithStock.length}`);

  const movementsByOrderId = {};
  if (ordersWithStock.length > 0) {
    const ids = ordersWithStock.map(o => o.id);
    // Query in batches of 100
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data: movChunk } = await supabase
        .from('movements')
        .select('id, order_id, product_id, quantity, type, reference_doc, product:products(sku, name)')
        .in('order_id', chunk);

      for (const m of (movChunk || [])) {
        if (m.order_id) {
          if (!movementsByOrderId[m.order_id]) movementsByOrderId[m.order_id] = [];
          movementsByOrderId[m.order_id].push(m);
        }
      }
    }
  }

  const cases = {
    // Caso 1: En WMS figura "despachado", pero en MELI sigue en "ready_to_ship" o "handling"
    falsoDespachoMeli: [],
    // Caso 2: raw_meli_data contiene órdenes de múltiples compradores (contaminación del webhook)
    compradoresCruzadosWebhook: [],
    // Caso 3: Desajuste entre el tracking_number del pedido y el shipping_id de Mercado Libre
    trackingMismatches: [],
    // Caso 4: Movimientos de stock en BD no coinciden con los order_items reales
    movimientosStockInconsistentes: []
  };

  for (const o of allOrders) {
    const raw = o.raw_meli_data || {};
    const rawShip = raw.shipping || raw.shipment;
    const rawShipId = rawShip?.id ? String(rawShip.id).trim() : null;
    const rawShipStatus = (raw.shipping_status || rawShip?.status || '').toLowerCase().trim();
    const rawOrders = raw.orders || [];

    // 1. Falso despacho
    const isWmsShipped = o.status === 'despachado' || o.estado_wms === 'Despachado';
    const isMeliNotShipped = rawShipStatus === 'ready_to_ship' || rawShipStatus === 'handling' || rawShipStatus === 'pending';
    if (isWmsShipped && isMeliNotShipped) {
      cases.falsoDespachoMeli.push({
        id: o.id,
        external_order_number: o.external_order_number,
        comercio: o.comercio,
        cliente: o.customer_name,
        estado_wms: o.estado_wms,
        status_db: o.status,
        meli_shipping_status: rawShipStatus,
        tracking: o.tracking_number
      });
    }

    // 2. Compradores cruzados en raw_meli_data
    if (Array.isArray(rawOrders) && rawOrders.length > 1) {
      const buyerIds = new Set(rawOrders.map(x => x.buyer?.id).filter(Boolean));
      if (buyerIds.size > 1) {
        cases.compradoresCruzadosWebhook.push({
          id: o.id,
          external_order_number: o.external_order_number,
          comercio: o.comercio,
          cliente_actual: o.customer_name,
          compradores_distintos: buyerIds.size,
          ordenes_en_raw: rawOrders.length,
          tracking: o.tracking_number
        });
      }
    }

    // 3. Tracking mismatch
    if (rawShipId && o.tracking_number && String(o.tracking_number).trim() !== rawShipId) {
      if (!o.tracking_number.includes(rawShipId) && !rawShipId.includes(o.tracking_number)) {
        cases.trackingMismatches.push({
          id: o.id,
          external_order_number: o.external_order_number,
          comercio: o.comercio,
          tracking_en_wms: o.tracking_number,
          tracking_real_meli: rawShipId,
          cliente: o.customer_name
        });
      }
    }

    // 4. Movimientos de stock inconsistentes con order_items
    const movs = movementsByOrderId[o.id] || [];
    if (movs.length > 0) {
      const movTotalQty = movs.reduce((sum, m) => sum + Number(m.quantity || 0), 0);
      const itemsTotalQty = (o.order_items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);

      // Check if products match
      const movProdIds = new Set(movs.map(m => m.product_id));
      const itemProdIds = new Set((o.order_items || []).map(it => it.product_id));
      let prodMismatch = false;
      for (const p of movProdIds) {
        if (!itemProdIds.has(p)) {
          prodMismatch = true;
          break;
        }
      }

      if (movTotalQty !== itemsTotalQty || prodMismatch) {
        cases.movimientosStockInconsistentes.push({
          id: o.id,
          external_order_number: o.external_order_number,
          comercio: o.comercio,
          cliente: o.customer_name,
          unidades_descontadas: movTotalQty,
          unidades_reales_pedido: itemsTotalQty,
          productos_distintos_en_movimientos: movs.map(m => `${m.product?.sku || m.product_id} x${m.quantity}`),
          productos_reales_en_pedido: (o.order_items || []).map(it => `${it.product?.sku || it.product_id} x${it.quantity}`)
        });
      }
    }
  }

  const reportPath = path.join(__dirname, 'audit_meli_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(cases, null, 2), 'utf-8');

  console.log('\n======================================================');
  console.log('📊 RESUMEN AUDITORÍA CASOS MERCADO LIBRE');
  console.log('======================================================');
  console.log(`1️⃣ Falso despacho (WMS dice Despachado pero MELI dice ready_to_ship): ${cases.falsoDespachoMeli.length}`);
  console.log(`2️⃣ Compradores cruzados (órdenes contaminadas por webhook): ${cases.compradoresCruzadosWebhook.length}`);
  console.log(`3️⃣ Tracking inconsistente (WMS tracking vs MELI shipping_id): ${cases.trackingMismatches.length}`);
  console.log(`4️⃣ Movimientos de stock inconsistentes con ítems del pedido: ${cases.movimientosStockInconsistentes.length}`);
  console.log('======================================================\n');

  console.log('Reporte guardado en:', reportPath);
}

runAudit();
