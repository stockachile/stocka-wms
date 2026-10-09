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

async function runFastAudit() {
  console.log('🔍 Iniciando auditoría rápida de órdenes Mercado Libre activas y recientes...');

  // 1. Obtener todas las órdenes de Mercado Libre recientes (últimos 14 días) o no terminales
  const hace14Dias = new Date();
  hace14Dias.setDate(hace14Dias.getDate() - 14);
  const dateIso = hace14Dias.toISOString();

  const { data: recentOrders, error } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, customer_name, tracking_number, status, estado_wms, cantidad, total_value, stock_descontado, raw_meli_data, created_at')
    .eq('external_platform', 'MercadoLibre')
    .gte('created_at', dateIso)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching orders:', error);
    return;
  }

  console.log(`📦 Órdenes Mercado Libre en los últimos 14 días: ${recentOrders.length}`);

  const report = {
    // 1. WMS dice "Despachado", pero Mercado Libre dice "ready_to_ship" / "handling" (Falso tránsito)
    falsoTransito: [],
    // 2. Órdenes con múltiples compradores en raw_meli_data (contaminadas)
    contaminadasWebhook: [],
    // 3. Órdenes con tracking_number que no coincide con el shipping.id de MELI
    desajusteTracking: [],
    // 4. Órdenes en preparación en MELI que tienen stock_descontado = true (posible descuento prematuro/falso)
    stockDescontadoSinDespacho: []
  };

  for (const o of recentOrders) {
    const raw = o.raw_meli_data || {};
    const rawShip = raw.shipping || raw.shipment;
    const rawShipId = rawShip?.id ? String(rawShip.id).trim() : null;
    const rawShipStatus = (raw.shipping_status || rawShip?.status || '').toLowerCase().trim();
    const rawOrders = raw.orders || [];

    // 1. Falso tránsito
    const isWmsShipped = o.status === 'despachado' || o.estado_wms === 'Despachado';
    const isMeliNotShipped = rawShipStatus === 'ready_to_ship' || rawShipStatus === 'handling' || rawShipStatus === 'pending';
    if (isWmsShipped && isMeliNotShipped) {
      report.falsoTransito.push({
        id: o.id,
        external_order_number: o.external_order_number,
        comercio: o.comercio,
        cliente: o.customer_name,
        fecha: o.created_at,
        estado_wms: o.estado_wms,
        status_db: o.status,
        meli_shipping_status: rawShipStatus,
        tracking: o.tracking_number
      });
    }

    // 2. Contaminadas por webhook
    if (Array.isArray(rawOrders) && rawOrders.length > 1) {
      const buyerIds = new Set(rawOrders.map(x => x.buyer?.id).filter(Boolean));
      if (buyerIds.size > 1) {
        report.contaminadasWebhook.push({
          id: o.id,
          external_order_number: o.external_order_number,
          comercio: o.comercio,
          cliente: o.customer_name,
          fecha: o.created_at,
          compradores_distintos: buyerIds.size,
          ordenes_en_raw: rawOrders.length,
          tracking: o.tracking_number
        });
      }
    }

    // 3. Desajuste de tracking
    if (rawShipId && o.tracking_number && String(o.tracking_number).trim() !== rawShipId) {
      if (!o.tracking_number.includes(rawShipId) && !rawShipId.includes(o.tracking_number)) {
        report.desajusteTracking.push({
          id: o.id,
          external_order_number: o.external_order_number,
          comercio: o.comercio,
          cliente: o.customer_name,
          fecha: o.created_at,
          tracking_wms: o.tracking_number,
          shipping_id_meli: rawShipId
        });
      }
    }

    // 4. Stock descontado antes de despacho real
    if (o.stock_descontado && isMeliNotShipped) {
      report.stockDescontadoSinDespacho.push({
        id: o.id,
        external_order_number: o.external_order_number,
        comercio: o.comercio,
        cliente: o.customer_name,
        fecha: o.created_at,
        estado_wms: o.estado_wms,
        meli_shipping_status: rawShipStatus,
        cantidad: o.cantidad
      });
    }
  }

  console.log('\n======================================================');
  console.log('📊 RESULTADOS AUDITORÍA ÓRDENES RECIENTES MERCADO LIBRE');
  console.log('======================================================');
  console.log(`1️⃣ Falso despacho / tránsito (WMS despachado, MELI ready_to_ship): ${report.falsoTransito.length}`);
  if (report.falsoTransito.length > 0) console.log(JSON.stringify(report.falsoTransito, null, 2));

  console.log(`\n2️⃣ Órdenes con compradores cruzados (contaminadas por webhook): ${report.contaminadasWebhook.length}`);
  if (report.contaminadasWebhook.length > 0) console.log(JSON.stringify(report.contaminadasWebhook, null, 2));

  console.log(`\n3️⃣ Desajuste de tracking (WMS tracking vs MELI shipping_id): ${report.desajusteTracking.length}`);
  if (report.desajusteTracking.length > 0) console.log(JSON.stringify(report.desajusteTracking, null, 2));

  console.log(`\n4️⃣ Stock marcado como descontado mientras MELI sigue en ready_to_ship: ${report.stockDescontadoSinDespacho.length}`);
  if (report.stockDescontadoSinDespacho.length > 0) console.log(JSON.stringify(report.stockDescontadoSinDespacho, null, 2));
  console.log('======================================================\n');
}

runFastAudit();
