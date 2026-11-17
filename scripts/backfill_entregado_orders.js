/**
 * WMS STOCKA — Script de Backfill Histórico y Enriquecimiento de Snapshot ("Entregado" & "En Tránsito")
 *
 * Modos de uso:
 *   node scripts/backfill_entregado_orders.js --dry-run   (Modo por defecto: 100% lectura, genera reporte exacto)
 *   node scripts/backfill_entregado_orders.js --apply     (Ejecuta cierre en bloques seguros tras aplicar migración SQL)
 *
 * Qué hace:
 *   1. Escanea todos los pedidos históricos que aún no están en 'Entregado', 'Cancelado' ni 'Archivado'.
 *   2. Cruza contra envios_unificados (con clasificador canónico), store_pickups, reverse_logistics,
 *      payloads de Marketplaces/Shopify/POS y BD externa de App Picker (history_logs + sucursal_pickups).
 *   3. En modo --apply:
 *      - Respalda picker_history_snapshot en public.orders para preservar toda trazabilidad de escaneo.
 *      - Cierra en estado_wms = 'Entregado' todos los pedidos entregados/retirados/POS/LI procesados,
 *        disparando el trigger SQL zz_seal_order_closed_snapshot que congela closed_snapshot 360° en BD.
 *      - Avanza a estado_wms = 'Despachado' los pedidos abiertos cuyo courier ya reporta 'EN TRÁNSITO'.
 *      - Limpia de active_orders en Picker cualquier pedido cerrado que haya quedado rezagado.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const APPLY_CHANGES = args.includes('--apply');
const BATCH_LIMIT = (() => {
  const idx = args.indexOf('--limit');
  if (idx !== -1 && args[idx + 1]) {
    const n = parseInt(args[idx + 1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return Infinity;
})();

const envPath = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) {
      let v = (m[2] || '').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[m[1]] = v;
    }
  });
}

const WMS_URL = env.SUPABASE_URL || process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

if (!WMS_KEY) {
  console.error('❌ Falta SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const wms = createClient(WMS_URL, WMS_KEY, { auth: { persistSession: false } });
const picker = createClient(PICKER_URL, PICKER_KEY, { auth: { persistSession: false } });

function isValidRef(val) {
  if (!val) return false;
  const up = String(val).trim().toUpperCase();
  return !['', 'N/A', 'NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN'].includes(up);
}

function classifyShipmentTransportStatus(sourceTable, rawStatusText, rawData) {
  const src = String(sourceTable || '').trim().toLowerCase();
  let statusText = String(rawStatusText || '').trim();

  if (src === 'lightdata_envios' && rawData) {
    let raw23 = '';
    if (Array.isArray(rawData) && rawData.length > 23) {
      raw23 = String(rawData[23] || '').trim();
    } else if (rawData && Array.isArray(rawData.raw_data) && rawData.raw_data.length > 23) {
      raw23 = String(rawData.raw_data[23] || '').trim();
    }
    const isCoord = (s) => /^-?\d+\.\d+$/.test(s);
    if ((!statusText || isCoord(statusText)) && raw23 && !isCoord(raw23)) {
      statusText = raw23;
    } else if (raw23 && !isCoord(raw23) && /(entregad|delivered|camino|reparto|planta|ruta|tránsito|transito)/i.test(raw23)) {
      statusText = raw23;
    }
  } else if (src === 'enviame_shipments' && rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    const nested = String(rawData.status?.name || rawData.status?.code || rawData.tracking_status || '').trim();
    if (nested && (!statusText || statusText.toLowerCase() === 'despachado')) {
      statusText = nested;
    }
  }

  const low = statusText.toLowerCase().trim();
  if (!low) return { norm: 'SIN MOVIMIENTO', cleanStatus: 'Sin movimiento' };

  if (
    low.includes('rechazado por courier') ||
    (src === 'optiroute_orders' && ['skipped', 'reviewing', 'scheduled', 'imported', 'temporary'].includes(low)) ||
    (src === 'lightdata_envios' && ['no retirado', 'a retirar'].includes(low)) ||
    (src === 'bluex_envios' && ['pickup', 'in_preparation', 'creado', 'emitido', 'ingresado', 'procesando'].includes(low)) ||
    (src === 'starken_envios' && ['origen', 'en origen', 'creado', 'emitido', 'ingresado'].includes(low)) ||
    (src === 'enviame_shipments' && (['creado', 'listo para despacho', 'listo para despacho - impreso', 'eliminado'].includes(low) || low.includes('impres') || low.includes('listo para despacho')))
  ) {
    return { norm: 'SIN MOVIMIENTO', cleanStatus: statusText };
  }

  if (/(devoluci[oó]n|devuelto|returned|entregado al remitente|entregado en origen|devuelto a origen|retorno a origen)/i.test(low)) {
    return { norm: 'DEVOLUCIÓN', cleanStatus: statusText };
  }

  if (
    /(requiere soluci[oó]n|pendiente - requiere|retenid|excepci[oó]n|siniestr|extraviad|fallid|no entregad|failed|cancel|anula|eliminad|deleted)/i.test(low) ||
    (low.includes('rechazad') && !low.includes('rechazado por courier'))
  ) {
    return { norm: 'ALERTA', cleanStatus: statusText };
  }

  if (
    /(entregad|delivered|entrega exitosa|recibido conforme)/i.test(low) &&
    !/(no entregad|fallid|rechazad|remitente|devuel|devoluc|origen|disponible para retiro|listo para retiro|pendiente)/i.test(low)
  ) {
    return {
      norm: 'ENTREGADO',
      cleanStatus: /^-?\d+\.\d+$/.test(statusText) ? 'Entregado' : statusText
    };
  }

  if (
    /(tr[aá]nsito|in_transit|out_for_delivery|reparto|en ruta|onroute|ongoing|arrived|en camino|camino al destinatario|admitid|planta|clasificado|recepcionado en planta|en destino|redestin|disponible para retiro|cambio de direcci|cambi[oó] de direcci|nadie)/i.test(low) ||
    (src === 'lightdata_envios' && /(camino|recepcionado|procesamiento)/i.test(low)) ||
    (src === 'starken_envios' && ['transito', 'destino', 'reparto'].includes(low))
  ) {
    return {
      norm: 'EN TRÁNSITO',
      cleanStatus: /^-?\d+\.\d+$/.test(statusText) ? 'En tránsito' : statusText
    };
  }

  return { norm: 'SIN MOVIMIENTO', cleanStatus: statusText };
}

function detectMarketplaceOrPosDelivery(order) {
  const plat = String(order.origen || order.external_platform || '').toLowerCase().replace(/\s+/g, '');
  const cat = String(order.categoria_entrega || '').trim().toUpperCase();
  const agenda = String(order.agenda || '').trim().toUpperCase();

  // 1. POS
  if (
    ['SHOP POINT (POS)', 'SHOP POINT', 'POS'].includes(cat) ||
    ['puntodeventa', 'pos', 'shoppoint', 'shoppoint(pos)'].includes(plat) ||
    agenda === 'COMPRA EN BODEGA' ||
    order.raw_shopify_data?.is_pos_sale === true
  ) {
    return {
      isDelivered: true,
      ruleId: 'auto-pos-sale-to-entregado',
      targetStatus: 'entregado',
      deliveredAt: order.created_at || new Date().toISOString()
    };
  }

  // 2. Mercado Libre
  if (plat.includes('mercadolibre') || plat.includes('meli') || order.raw_meli_data) {
    const m = order.raw_meli_data;
    const ship = Array.isArray(m) && m.length > 0
      ? m[0]?.shipping
      : (m?.shipping || m?.shipment || m?.orders?.[0]?.shipping || null);
    const st = String(m?.shipping_status || ship?.status || '').toLowerCase().trim();
    const sub = String(ship?.substatus || '').toLowerCase().trim();
    const dateDeliv = ship?.status_history?.date_delivered || null;
    if (st === 'delivered' || sub === 'delivered' || Boolean(dateDeliv)) {
      return {
        isDelivered: true,
        ruleId: 'auto-marketplace-delivered-to-entregado',
        targetStatus: 'entregado',
        deliveredAt: dateDeliv || order.created_at || new Date().toISOString()
      };
    }
  }

  // 3. Falabella
  if (plat.includes('falabella') || order.raw_falabella_data) {
    const f = order.raw_falabella_data || {};
    const st = String(f.Statuses?.Status || f.Status || f.status || '').toLowerCase().trim();
    if (st === 'delivered' || st === 'entregado') {
      return {
        isDelivered: true,
        ruleId: 'auto-marketplace-delivered-to-entregado',
        targetStatus: 'entregado',
        deliveredAt: order.created_at || new Date().toISOString()
      };
    }
  }

  // 4. Paris
  if (plat.includes('paris') || order.raw_paris_data) {
    const p = order.raw_paris_data || {};
    const subStObj = p.subOrders?.[0]?.status;
    const st = String(
      (typeof subStObj === 'object' && subStObj !== null ? subStObj.name : subStObj) ||
      p.status ||
      order.payment_status ||
      ''
    ).toLowerCase().trim();
    const subId = String(subStObj?.id || '');
    if (['delivered', 'entregado', 'received'].includes(st) || subId === '4') {
      return {
        isDelivered: true,
        ruleId: 'auto-marketplace-delivered-to-entregado',
        targetStatus: 'entregado',
        deliveredAt: order.created_at || new Date().toISOString()
      };
    }
  }

  // 5. Ripley
  if (plat.includes('ripley') || order.raw_ripley_data) {
    const r = order.raw_ripley_data || {};
    const st = String(r.order_state || r.status || order.payment_status || '').toLowerCase().trim();
    if (['received', 'delivered', 'entregado', 'closed'].includes(st)) {
      return {
        isDelivered: true,
        ruleId: 'auto-marketplace-delivered-to-entregado',
        targetStatus: 'entregado',
        deliveredAt: order.created_at || new Date().toISOString()
      };
    }
  }

  // 6. Walmart
  if (plat.includes('walmart') || order.raw_walmart_data) {
    const w = order.raw_walmart_data || {};
    const st = String(w.status || order.payment_status || '').toLowerCase().trim();
    if (['delivered', 'entregado'].includes(st)) {
      return {
        isDelivered: true,
        ruleId: 'auto-marketplace-delivered-to-entregado',
        targetStatus: 'entregado',
        deliveredAt: order.created_at || new Date().toISOString()
      };
    }
  }

  // 7. Shopify Fulfillment nativo reportando delivered (excluyendo splits)
  const rs = order.raw_shopify_data;
  if (
    rs &&
    Array.isArray(rs.fulfillments) &&
    !order.is_split &&
    !order.parent_order_id &&
    !rs._is_split_child
  ) {
    const hasDeliv = rs.fulfillments.some(f => String(f?.shipment_status || '').toLowerCase().trim() === 'delivered');
    if (hasDeliv) {
      return {
        isDelivered: true,
        ruleId: 'auto-marketplace-delivered-to-entregado',
        targetStatus: 'entregado',
        deliveredAt: order.created_at || new Date().toISOString()
      };
    }
  }

  return { isDelivered: false };
}

async function fetchAllOrdersCandidates() {
  const all = [];
  let lastCreatedAt = null;
  const step = 400;
  let cols = [
    'id', 'status', 'estado_wms', 'created_at', 'external_order_number', 'external_platform', 'origen',
    'comercio', 'categoria_entrega', 'agenda', 'operador', 'courier', 'tracking_number', 'tracking_url',
    'payment_status', 'is_split', 'parent_order_id', 'stock_descontado', 'stock_descontado_at',
    'sucursal_pickeo', 'picker_status', 'picker_operator', 'picker_scanned_label', 'picker_last_synced_at',
    'raw_shopify_data', 'raw_meli_data', 'raw_falabella_data', 'raw_paris_data', 'raw_ripley_data', 'raw_walmart_data', 'raw_lightdata_data',
    'closed_snapshot', 'picker_history_snapshot'
  ].join(',');

  let hasNewSchemaCols = true;

  while (true) {
    let q = wms
      .from('orders')
      .select(cols)
      .not('estado_wms', 'in', '("Entregado","Cancelado","Archivado")')
      .order('created_at', { ascending: false })
      .limit(step);

    if (lastCreatedAt) {
      q = q.lt('created_at', lastCreatedAt);
    }

    const { data, error } = await q;
    if (error) {
      if (error.code === '42703' && cols.includes('closed_snapshot')) {
        hasNewSchemaCols = false;
        cols = cols.replace(/,closed_snapshot,picker_history_snapshot/g, '').replace(/,picker_status,picker_operator,picker_scanned_label,picker_last_synced_at/g, '');
        continue;
      }
      throw error;
    }

    if (!data || data.length === 0) break;
    all.push(...data);
    if (all.length >= BATCH_LIMIT) break;
    if (data.length < step) break;
    const nextCursor = data[data.length - 1].created_at;
    if (!nextCursor || nextCursor === lastCreatedAt) break;
    lastCreatedAt = nextCursor;
  }

  return { orders: all.slice(0, BATCH_LIMIT), hasNewSchemaCols };
}

async function fetchAllRows(client, table, selectCols) {
  const rows = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await client.from(table).select(selectCols).range(from, from + step - 1);
    if (error) {
      console.warn(`⚠️ Aviso consultando ${table}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return rows;
}

async function fetchShipmentsForOrders(orders) {
  const refSet = new Set();
  orders.forEach(o => {
    if (String(o.categoria_entrega || '').toUpperCase().trim() === 'RETIRO') return;
    const forced = o.raw_shopify_data?.wms_forced_tracking?.active ? o.raw_shopify_data.wms_forced_tracking.tracking_number : null;
    if (isValidRef(forced)) refSet.add(String(forced).trim());
    if (isValidRef(o.tracking_number)) refSet.add(String(o.tracking_number).trim());
    if (isValidRef(o.external_order_number)) {
      const ext = String(o.external_order_number).trim();
      refSet.add(ext);
      refSet.add(ext.replace(/^#+/, ''));
      refSet.add('#' + ext.replace(/^#+/, ''));
    }
    if (o.raw_lightdata_data?.did) refSet.add(String(o.raw_lightdata_data.did).trim());
    if (o.raw_lightdata_data?.id) refSet.add(String(o.raw_lightdata_data.id).trim());
  });

  const allRefs = Array.from(refSet).filter(r => r && !/["(),]/.test(r));
  const byKey = new Map();
  const addIdx = (k, s) => {
    if (!isValidRef(k)) return;
    const key = String(k).trim().toUpperCase();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
    const bare = key.replace(/^#+/, '');
    if (bare && bare !== key) {
      if (!byKey.has(bare)) byKey.set(bare, []);
      byKey.get(bare).push(s);
    }
  };

  const CHUNK = 90;
  for (let i = 0; i < allRefs.length; i += CHUNK) {
    const slice = allRefs.slice(i, i + CHUNK);
    const csv = `(${slice.map(x => `"${x}"`).join(',')})`;
    const { data, error } = await wms
      .from('envios_unificados')
      .select('id, source_table, source_id, pedido_referencia, tracking, tracking_url, courier, status, empresa_comercio_proveedor, updated_at, raw_data')
      .or(`pedido_referencia.in.${csv},tracking.in.${csv},source_id.in.${csv}`);

    if (error) continue;
    (data || []).forEach(s => {
      if (/(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)/i.test(String(s.courier || ''))) return;
      const cls = classifyShipmentTransportStatus(s.source_table, s.status, s.raw_data);
      s._norm = cls.norm;
      s._cleanStatus = cls.cleanStatus;
      addIdx(s.pedido_referencia, s);
      addIdx(s.tracking, s);
      addIdx(s.source_id, s);
    });
  }

  return byKey;
}

function findBestShipmentForOrder(order, shipmentsByKey) {
  const forced = order.raw_shopify_data?.wms_forced_tracking?.active
    ? String(order.raw_shopify_data.wms_forced_tracking.tracking_number || '').trim()
    : '';

  const candidates = new Set();
  const collect = (k) => {
    if (!isValidRef(k)) return;
    const up = String(k).trim().toUpperCase();
    (shipmentsByKey.get(up) || []).forEach(s => candidates.add(s));
    const bare = up.replace(/^#+/, '');
    (shipmentsByKey.get(bare) || []).forEach(s => candidates.add(s));
  };

  if (forced) {
    collect(forced);
  } else {
    collect(order.tracking_number);
    collect(order.external_order_number);
    collect(order.id);
    if (order.raw_lightdata_data?.did) collect(order.raw_lightdata_data.did);
    if (order.raw_lightdata_data?.id) collect(order.raw_lightdata_data.id);
  }

  const ordCom = String(order.comercio || '').trim().toUpperCase();
  const valid = Array.from(candidates).filter(s => {
    if (forced) {
      return String(s.tracking || '').trim().toUpperCase() === forced.toUpperCase() ||
             String(s.source_id || '').trim().toUpperCase() === forced.toUpperCase();
    }
    if (isValidRef(order.tracking_number)) {
      const oTrk = String(order.tracking_number).trim().toUpperCase();
      if (String(s.tracking || '').trim().toUpperCase() === oTrk || String(s.source_id || '').trim().toUpperCase() === oTrk) {
        return true;
      }
    }
    const sCom = String(s.empresa_comercio_proveedor || '').trim().toUpperCase();
    if (!sCom || sCom === 'NO ASIGNADO' || sCom.includes('STOCKA')) return true;
    return sCom === ordCom;
  });

  if (valid.length === 0) return null;

  const score = (norm) => (norm === 'ENTREGADO' ? 4 : norm === 'EN TRÁNSITO' ? 3 : (norm === 'ALERTA' || norm === 'DEVOLUCIÓN') ? 2 : 1);
  valid.sort((a, b) => {
    const diff = score(b._norm) - score(a._norm);
    if (diff !== 0) return diff;
    const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return tb - ta;
  });

  return valid[0];
}

async function main() {
  console.log('=====================================================================');
  console.log(`🔎 WMS STOCKA — Backfill Estado ENTREGADO & Conciliación En Tránsito`);
  console.log(`Modo de ejecución: ${APPLY_CHANGES ? '🚀 APPLY (Escritura en BD)' : '🧪 DRY-RUN (100% Solo Lectura)'}`);
  console.log('=====================================================================\n');

  const { orders, hasNewSchemaCols } = await fetchAllOrdersCandidates();
  console.log(`📦 Pedidos candidatos analizados (no cerrados ni cancelados): ${orders.length}`);
  console.log(`🗄️  Columnas closed_snapshot / picker_history_snapshot en BD: ${hasNewSchemaCols ? 'SÍ (Migración aplicada)' : 'NO AÚN (Pendiente migración SQL)'}`);

  if (APPLY_CHANGES && !hasNewSchemaCols) {
    console.error('\n❌ ABORTADO: Primero debes aplicar la migración SQL 20261116_estado_entregado_y_automatizaciones.sql antes de ejecutar --apply.');
    process.exit(1);
  }

  // Cargar tablas auxiliares para cruce rápido en memoria
  const [storePickups, revLogistics, pickerPickups, shipmentsByKey] = await Promise.all([
    fetchAllRows(wms, 'store_pickups', 'pedido, comercio, estado_pedido, sucursal, pin_retiro, updated_at'),
    fetchAllRows(wms, 'reverse_logistics', 'id, wms_order_id, referencia_pedido, comercio, status, estado, created_at'),
    fetchAllRows(picker, 'sucursal_pickups', 'pedido, comercio, estado_pedido, sucursal, updated_at'),
    fetchShipmentsForOrders(orders)
  ]);

  const pickupDoneSet = new Set();
  const pickupDoneByOrderOnly = new Map();
  [...storePickups, ...pickerPickups].forEach(sp => {
    const st = String(sp.estado_pedido || '').trim().toUpperCase();
    if (st !== 'ENTREGADO' && st !== 'RETIRADO') return;
    const pedBare = String(sp.pedido || '').trim().replace(/^#+/, '').toUpperCase();
    if (!pedBare) return;
    const com = String(sp.comercio || '').trim().toUpperCase();
    if (com) pickupDoneSet.add(`${com}::${pedBare}`);
    pickupDoneByOrderOnly.set(pedBare, sp);
  });

  const rlProcessedByWmsId = new Set();
  const rlProcessedByFolio = new Set();
  revLogistics.forEach(rl => {
    const rlSt = String(rl.status || rl.estado || '').trim().toLowerCase();
    if (rlSt !== 'procesado') return;
    if (rl.wms_order_id) rlProcessedByWmsId.add(String(rl.wms_order_id));
    if (rl.referencia_pedido) rlProcessedByFolio.add(String(rl.referencia_pedido).trim().toUpperCase());
  });

  const toEntregado = [];
  const toDespachado = [];
  const byRuleCounts = {};

  for (const order of orders) {
    const ordStatusLow = String(order.status || '').trim().toLowerCase();
    if (ordStatusLow === 'cancelado' || order.raw_shopify_data?.cancelled_at) continue;

    const extBare = String(order.external_order_number || '').trim().replace(/^#+/, '').toUpperCase();
    const comUp = String(order.comercio || '').trim().toUpperCase();
    const catUp = String(order.categoria_entrega || '').trim().toUpperCase();
    const isRetiro = catUp === 'RETIRO' || String(order.agenda || '').trim().toUpperCase() === 'RETIRO';

    // 1. Evaluar POS o Marketplaces / Shopify Fulfillment
    const mktPos = detectMarketplaceOrPosDelivery(order);
    if (mktPos.isDelivered) {
      toEntregado.push({
        order,
        ruleId: mktPos.ruleId,
        targetStatus: mktPos.targetStatus,
        deliveredAt: mktPos.deliveredAt
      });
      byRuleCounts[mktPos.ruleId] = (byRuleCounts[mktPos.ruleId] || 0) + 1;
      continue;
    }

    // 2. Evaluar Retiro en Sucursal
    const isPickupCompleted =
      ordStatusLow === 'retirado' ||
      (extBare && comUp && pickupDoneSet.has(`${comUp}::${extBare}`)) ||
      (extBare && !comUp && pickupDoneByOrderOnly.has(extBare));

    if (isPickupCompleted) {
      const spRef = pickupDoneByOrderOnly.get(extBare);
      toEntregado.push({
        order,
        ruleId: 'auto-pickup-retirado-to-entregado',
        targetStatus: 'retirado',
        deliveredAt: spRef?.updated_at || order.stock_descontado_at || order.created_at || new Date().toISOString()
      });
      byRuleCounts['auto-pickup-retirado-to-entregado'] = (byRuleCounts['auto-pickup-retirado-to-entregado'] || 0) + 1;
      continue;
    }

    // 3. Evaluar Logística Inversa procesada
    if (
      rlProcessedByWmsId.has(String(order.id)) ||
      (extBare && extBare.startsWith('LI-') && rlProcessedByFolio.has(extBare))
    ) {
      toEntregado.push({
        order,
        ruleId: 'auto-reverse-logistics-to-entregado',
        targetStatus: 'entregado',
        deliveredAt: order.created_at || new Date().toISOString()
      });
      byRuleCounts['auto-reverse-logistics-to-entregado'] = (byRuleCounts['auto-reverse-logistics-to-entregado'] || 0) + 1;
      continue;
    }

    // 4. Evaluar Despacho Courier en envios_unificados (o status='entregado' explícito sin devolución)
    if (!isRetiro) {
      const bestShip = findBestShipmentForOrder(order, shipmentsByKey);
      if (bestShip && bestShip._norm === 'ENTREGADO') {
        toEntregado.push({
          order,
          ruleId: 'auto-dispatch-delivered-to-entregado',
          targetStatus: 'entregado',
          deliveredAt: bestShip.updated_at || order.stock_descontado_at || order.created_at || new Date().toISOString()
        });
        byRuleCounts['auto-dispatch-delivered-to-entregado'] = (byRuleCounts['auto-dispatch-delivered-to-entregado'] || 0) + 1;
        continue;
      }

      if (ordStatusLow === 'entregado' && (!bestShip || (bestShip._norm !== 'DEVOLUCIÓN' && bestShip._norm !== 'ALERTA'))) {
        toEntregado.push({
          order,
          ruleId: 'auto-dispatch-delivered-to-entregado',
          targetStatus: 'entregado',
          deliveredAt: bestShip?.updated_at || order.stock_descontado_at || order.created_at || new Date().toISOString()
        });
        byRuleCounts['auto-dispatch-delivered-to-entregado'] = (byRuleCounts['auto-dispatch-delivered-to-entregado'] || 0) + 1;
        continue;
      }

      // 5. Evaluar Transporte EN TRÁNSITO para avanzar pedidos aún no despachados a Despachado
      const currentWms = String(order.estado_wms || 'En procesamiento').trim();
      if (
        bestShip &&
        bestShip._norm === 'EN TRÁNSITO' &&
        ['En procesamiento', 'En preparación', 'Pickeado'].includes(currentWms)
      ) {
        toDespachado.push({
          order,
          shipment: bestShip
        });
        byRuleCounts['auto-transport-in-transit-to-despachado'] = (byRuleCounts['auto-transport-in-transit-to-despachado'] || 0) + 1;
      }
    }
  }

  console.log('\n📊 RESUMEN DE CLASIFICACIÓN HISTÓRICA:');
  console.log(`   ✅ Total pedidos a cerrar en ENTREGADO (Snapshot Inmutable): ${toEntregado.length}`);
  Object.entries(byRuleCounts)
    .filter(([k]) => k !== 'auto-transport-in-transit-to-despachado')
    .forEach(([rule, cnt]) => {
      console.log(`      • ${rule}: ${cnt}`);
    });
  console.log(`   🚚 Total pedidos abiertos con courier EN TRÁNSITO → Despachado: ${toDespachado.length}`);

  if (!APPLY_CHANGES) {
    console.log('\nℹ️  Simulación DRY-RUN finalizada sin modificar ningún dato.');
    console.log('   Para aplicar estos cierres tras ejecutar la migración SQL, corre:');
    console.log('   node scripts/backfill_entregado_orders.js --apply\n');
    return;
  }

  // =========================================================================
  // FASE APPLY: Enriquecer logs de Picker y ejecutar actualizaciones en lotes
  // =========================================================================
  console.log('\n🔄 Consultando bitácoras históricas de App Picker para enriquecer picker_history_snapshot...');
  const pickerLogsByBareNum = new Map();
  const orderNumsForPicker = Array.from(new Set(
    toEntregado
      .map(x => String(x.order.external_order_number || '').trim())
      .filter(Boolean)
      .flatMap(ext => {
        const bare = ext.replace(/^#+/, '');
        return [ext, bare, `#${bare}`];
      })
  ));

  const PICKER_CHUNK = 120;
  for (let i = 0; i < orderNumsForPicker.length; i += PICKER_CHUNK) {
    const chunk = orderNumsForPicker.slice(i, i + PICKER_CHUNK);
    const { data: hLogs } = await picker
      .from('history_logs')
      .select('pedido, picker, estado, comentarios, sucursal, fecha, hora, created_at, items_summary')
      .in('pedido', chunk)
      .order('created_at', { ascending: false });

    (hLogs || []).forEach(lg => {
      const bare = String(lg.pedido || '').trim().replace(/^#+/, '').toUpperCase();
      if (!bare) return;
      if (!pickerLogsByBareNum.has(bare)) pickerLogsByBareNum.set(bare, []);
      if (pickerLogsByBareNum.get(bare).length < 15) {
        pickerLogsByBareNum.get(bare).push(lg);
      }
    });
  }

  console.log(`📝 Aplicando cierre ENTREGADO en ${toEntregado.length} pedidos (bloques de 150)...`);
  let closedOk = 0;
  let closedErr = 0;
  const UPDATE_BATCH = 150;
  const CONCURRENCY = 12;

  for (let i = 0; i < toEntregado.length; i += UPDATE_BATCH) {
    const slice = toEntregado.slice(i, i + UPDATE_BATCH);
    for (let j = 0; j < slice.length; j += CONCURRENCY) {
      const sub = slice.slice(j, j + CONCURRENCY);
      await Promise.all(sub.map(async (item) => {
        const { order, ruleId, targetStatus, deliveredAt } = item;
        const bare = String(order.external_order_number || '').trim().replace(/^#+/, '').toUpperCase();
        const logs = bare ? (pickerLogsByBareNum.get(bare) || []) : [];
        const firstLog = logs[0] || null;

        const updatePayload = {
          estado_wms: 'Entregado',
          status: targetStatus,
          delivered_at: deliveredAt,
          closed_at: new Date().toISOString(),
          closed_by_automation: `backfill:${ruleId}`
        };

        if (logs.length > 0 && !order.picker_history_snapshot) {
          updatePayload.picker_history_snapshot = {
            status: firstLog.estado || 'Completado',
            operator: firstLog.picker || order.picker_operator || null,
            sucursal: firstLog.sucursal || order.sucursal_pickeo || null,
            picked_at: firstLog.created_at || null,
            items_summary: firstLog.items_summary || null,
            logs
          };
          if (!order.picker_operator && firstLog.picker) {
            updatePayload.picker_operator = firstLog.picker;
          }
          if (!order.picker_status && firstLog.estado) {
            updatePayload.picker_status = firstLog.estado;
          }
        }

        const { error } = await wms.from('orders').update(updatePayload).eq('id', order.id);
        if (error) {
          closedErr++;
          if (closedErr <= 10) {
            console.warn(`   ⚠️ Error cerrando pedido ${order.external_order_number || order.id}: ${error.message}`);
          }
        } else {
          closedOk++;
        }
      }));
    }
    console.log(`   Progreso ENTREGADO: ${Math.min(i + UPDATE_BATCH, toEntregado.length)} / ${toEntregado.length} (OK: ${closedOk}, Err: ${closedErr})`);
  }

  let dispatchedOk = 0;
  let dispatchedErr = 0;
  if (toDespachado.length > 0) {
    console.log(`\n🚚 Avanzando ${toDespachado.length} pedidos con etiqueta EN TRÁNSITO a Despachado...`);
    for (let i = 0; i < toDespachado.length; i += CONCURRENCY) {
      const sub = toDespachado.slice(i, i + CONCURRENCY);
      await Promise.all(sub.map(async ({ order, shipment }) => {
        const { error } = await wms
          .from('orders')
          .update({
            estado_wms: 'Despachado',
            status: 'despachado',
            transport_status_normalized: 'EN TRÁNSITO',
            dispatched_at: shipment.updated_at || new Date().toISOString(),
            closed_by_automation: 'backfill:auto-transport-in-transit-to-despachado'
          })
          .eq('id', order.id);
        if (error) {
          dispatchedErr++;
        } else {
          dispatchedOk++;
        }
      }));
    }
  }

  // Actualizar contadores iniciales de ejecuciones en automation_rules y recalcular stock comprometido/en mesa
  try {
    const nowIso = new Date().toISOString();
    for (const [rId, cnt] of Object.entries(byRuleCounts)) {
      if (cnt <= 0) continue;
      const { data: currRule } = await wms.from('automation_rules').select('executions_count').eq('id', rId).maybeSingle();
      const prevCnt = Number(currRule?.executions_count) || 0;
      await wms.from('automation_rules').update({
        executions_count: prevCnt + cnt,
        last_executed_at: nowIso,
        updated_at: nowIso
      }).eq('id', rId);
    }
    console.log('🔄 Recalculando stock comprometido y en mesa (recalculate_committed_stock)...');
    await wms.rpc('recalculate_committed_stock');
  } catch (statsErr) {
    console.warn('⚠️ Aviso actualizando contadores o recalculando stock comprometido:', statsErr.message);
  }

  // Depurar de active_orders en Picker cualquier pedido cerrado
  try {
    const { data: activePickerRows } = await picker.from('active_orders').select('id, order_number, comercio');
    if (activePickerRows && activePickerRows.length > 0) {
      const closedPairs = new Set(
        [...toEntregado.map(x => x.order), ...toDespachado.map(x => x.order)]
          .map(o => `${String(o.comercio || '').trim().toUpperCase()}::${String(o.external_order_number || '').trim().replace(/^#+/, '').toUpperCase()}`)
      );
      const idsToDelete = activePickerRows
        .filter(r => {
          const com = String(r.comercio || '').trim().toUpperCase();
          const num = String(r.order_number || '').trim().replace(/^#+/, '').toUpperCase();
          return com && num && closedPairs.has(`${com}::${num}`);
        })
        .map(r => r.id);

      if (idsToDelete.length > 0) {
        for (let i = 0; i < idsToDelete.length; i += 100) {
          await picker.from('active_orders').delete().in('id', idsToDelete.slice(i, i + 100));
        }
        console.log(`🧹 Limpiados ${idsToDelete.length} registros rezagados en Picker active_orders.`);
      }
    }
  } catch (e) {
    console.warn('⚠️ Aviso limpiando active_orders en Picker:', e.message);
  }

  console.log('\n✨ BACKFILL FINALIZADO:');
  console.log(`   • Pedidos sellados en ENTREGADO: ${closedOk} (Errores: ${closedErr})`);
  console.log(`   • Pedidos avanzados a Despachado (En Tránsito): ${dispatchedOk} (Errores: ${dispatchedErr})\n`);
}

main().catch(err => {
  console.error('❌ Error fatal en backfill_entregado_orders:', err);
  process.exit(1);
});
