const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURACIÓN DE ENTORNO Y SUPABASE
// ==========================================
const envPath = path.join(__dirname, '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value.trim();
    }
  });
}

const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = env.ENVIAME_API_KEY || process.env.ENVIAME_API_KEY || "6boQAR4qOMMZxjS1DJlrnOPqj0Vp8n";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// CACHE Y RESOLUCIÓN DE COMERCIOS / ENVIAME ID
// ==========================================
let commerceConfigsCache = null;

async function loadCommerceConfigs() {
  if (commerceConfigsCache) return commerceConfigsCache;

  const { data: configs } = await supabase
    .from('comercios_adicional_config')
    .select('comercio, enviame_id, sigla, pedido_trae_sigla');

  const { data: vComercios } = await supabase
    .from('v_comercios_config')
    .select('nombre, sigla');

  const enviameIdToCommerce = {};
  const commerceToEnviameIds = {};
  const commerceToSigla = {};
  const siglaToCommerce = {};

  (vComercios || []).forEach(v => {
    if (v.nombre && v.sigla) {
      const cUpper = v.nombre.trim().toUpperCase();
      const sUpper = v.sigla.trim().toUpperCase();
      commerceToSigla[cUpper] = sUpper;
      siglaToCommerce[sUpper] = cUpper;
    }
  });

  (configs || []).forEach(c => {
    if (!c.comercio) return;
    const cUpper = c.comercio.trim().toUpperCase();
    if (c.sigla) {
      const sUpper = c.sigla.trim().toUpperCase();
      commerceToSigla[cUpper] = sUpper;
      siglaToCommerce[sUpper] = cUpper;
    }
    if (c.enviame_id) {
      const ids = String(c.enviame_id).split(',').map(s => s.trim().replace(/^ID\s*:?\s*/i, ''));
      ids.forEach(id => {
        if (id) enviameIdToCommerce[id] = cUpper;
      });
      commerceToEnviameIds[cUpper] = ids;
    }
  });

  // Fallbacks conocidos
  if (!enviameIdToCommerce['166878']) enviameIdToCommerce['166878'] = 'MAESE';
  if (!commerceToSigla['MAESE']) commerceToSigla['MAESE'] = 'MSE';
  if (!siglaToCommerce['MSE']) siglaToCommerce['MSE'] = 'MAESE';

  commerceConfigsCache = {
    enviameIdToCommerce,
    commerceToEnviameIds,
    commerceToSigla,
    siglaToCommerce
  };
  return commerceConfigsCache;
}

// Resolver comercio a partir del payload del delivery de Envíame
function resolveCommerceForDelivery(d, context = {}, cache) {
  const { enviameIdToCommerce, commerceToEnviameIds, commerceToSigla, siglaToCommerce } = cache;

  if (context.comercio) {
    const cUpper = context.comercio.trim().toUpperCase();
    return {
      comercio: cUpper,
      sigla: commerceToSigla[cUpper] || null,
      companyId: context.enviameId || (commerceToEnviameIds[cUpper] ? commerceToEnviameIds[cUpper][0] : null)
    };
  }

  // 1. Extraer company ID de Envíame
  let companyId = d.company?.id ? String(d.company.id).trim() : null;
  if (!companyId && d.seller_id) companyId = String(d.seller_id).trim();
  if (!companyId && d.links && Array.isArray(d.links)) {
    const link = d.links.find(l => l.href && l.href.includes('/companies/'));
    const m = link?.href?.match(/\/companies\/(\d+)\//);
    if (m) companyId = m[1];
  }
  if (!companyId && d.seller_name && /^ID\s*:?\s*\d+$/i.test(d.seller_name)) {
    companyId = d.seller_name.replace(/^ID\s*:?\s*/i, '').trim();
  }

  // 2. Extraer nombre de la empresa
  let companyName = d.company?.name ? d.company.name.trim().toUpperCase() : null;
  if (!companyName && d.seller_name && !/^ID\s*:?\s*\d+$/i.test(d.seller_name)) {
    companyName = d.seller_name.trim().toUpperCase();
  }

  // A. Coincidencia estricta por Company ID (Enviame ID)
  if (companyId && enviameIdToCommerce[companyId]) {
    const com = enviameIdToCommerce[companyId];
    return { comercio: com, sigla: commerceToSigla[com] || null, companyId, companyName };
  }

  // B. Coincidencia por Company Name
  if (companyName) {
    for (const [comKey, sVal] of Object.entries(commerceToSigla)) {
      if (comKey === companyName || companyName.includes(comKey) || comKey.includes(companyName)) {
        return { comercio: comKey, sigla: sVal, companyId, companyName };
      }
    }
  }

  // C. Coincidencia por Sigla en order_id (ej: BLE#1025, DOR55019059, STG1065)
  const ref = String(d.imported_id || d.order_number || '').trim();
  const cleanPrefix = ref.replace(/^[^A-Za-z0-9]+/, '').substring(0, 3).toUpperCase();
  if (cleanPrefix.length === 3 && siglaToCommerce[cleanPrefix]) {
    const com = siglaToCommerce[cleanPrefix];
    return { comercio: com, sigla: cleanPrefix, companyId, companyName };
  }

  return { comercio: null, sigla: null, companyId, companyName };
}

// Mapeo estandarizado de Courier a Operador WMS STOCKA
function mapCourierToOperador(courier) {
  if (!courier) return 'STOCKA';
  const cUpper = String(courier).trim().toUpperCase();
  if (cUpper.includes('STARKEN')) return 'STARKEN';
  if (cUpper.includes('BLUEXPRESS') || cUpper.includes('BLUE EXPRESS') || cUpper.includes('BLUE')) return 'BLUEXPRESS';
  if (cUpper.includes('CHILEXPRESS')) return 'CHILEXPRESS';
  if (cUpper.includes('ALPHA') || cUpper.includes('LIGHTDATA')) return 'ALPHA';
  if (cUpper.includes('FALABELLA')) return 'FALABELLA';
  if (cUpper.includes('MERCADO')) return 'MERCADOLIBRE';
  if (cUpper.includes('PARIS')) return 'PARIS';
  if (cUpper.includes('RIPLEY')) return 'RIPLEY';
  if (cUpper.includes('WALMART')) return 'WALMART';
  if (cUpper.includes('RECIBELO') || cUpper.includes('RECÍBELO') || cUpper.includes('WELIVERY') || cUpper.includes('WOODELIVERY') || cUpper.includes('WODELY')) {
    return 'STOCKA X';
  }
  return cUpper;
}

// Mapeo de estado crudo a estado global unificado (compatible con constraint de envios_unificados: DESPACHADO, SIN MOVIMIENTO, ALERTA)
function mapStatusToGlobal(statusName) {
  if (!statusName) return 'SIN MOVIMIENTO';
  const s = String(statusName).trim().toLowerCase();
  if (s.includes('requiere solucion') || s.includes('requiere solución') || s.includes('excepcion') || s.includes('excepción') || s.includes('siniestr') || s.includes('fallid') || s.includes('cancel')) {
    return 'ALERTA';
  }
  if (s.includes('transito') || s.includes('tránsito') || s.includes('ruta') || s.includes('reparto') || s.includes('camino') || s.includes('planta') || s.includes('admitid') || s.includes('disponible para retiro') || s.includes('entregad') || s.includes('delivered')) {
    return 'DESPACHADO';
  }
  return 'SIN MOVIMIENTO';
}

// Limpiar valores vacíos o no informados
function cleanValue(v) {
  if (!v) return null;
  const str = String(v).trim();
  if (!str || str.toLowerCase() === 'no informado' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined' || str === '-' || str.toLowerCase() === 'n/a') {
    return null;
  }
  return str;
}

// Consultar delivery individual en la API de Envíame
async function fetchEnviameDelivery(deliveryId) {
  const url = `https://api.enviame.io/api/s2/v2/deliveries/${deliveryId}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'api-key': API_KEY
      }
    });
    if (res.ok) {
      const json = await res.json();
      return json.data || null;
    } else {
      console.warn(`[Envíame API] Error ${res.status} al consultar delivery ${deliveryId}`);
      return null;
    }
  } catch (err) {
    console.error(`[Envíame API] Excepción al consultar delivery ${deliveryId}:`, err.message);
    return null;
  }
}

// Procesar y conciliar un delivery de Envíame en Supabase
async function processEnviameDelivery(d, context = {}) {
  if (!d || !d.identifier) return false;

  const deliveryId = String(d.identifier);
  const rawTracking = d.tracking_number || d.carrier_tracking_number || d.barcodes || null;
  const validTracking = cleanValue(rawTracking);
  const courier = cleanValue(d.carrier || d.courier?.name) || 'STARKEN';
  const statusName = d.status?.name || d.status || 'Creado';
  const importedId = cleanValue(d.imported_id || d.order_number);
  const mappedOperator = mapCourierToOperador(courier);
  const globalStatus = mapStatusToGlobal(statusName);

  const cache = await loadCommerceConfigs();
  const resolved = resolveCommerceForDelivery(d, context, cache);

  let labelUrl = null;
  if (d.label && typeof d.label === 'object') {
    labelUrl = d.label.PDF || d.label.PNG || null;
  } else if (typeof d.label === 'string' && d.label.startsWith('http')) {
    labelUrl = d.label;
  }

  let trackingUrl = null;
  if (d.links && Array.isArray(d.links)) {
    const webLink = d.links.find(l => l.rel === 'tracking-web');
    if (webLink?.href) trackingUrl = webLink.href;
  }
  if (!trackingUrl && validTracking) {
    trackingUrl = `https://tracking.enviame.io/?n=${encodeURIComponent(validTracking)}`;
  }

  // 1. Actualizar enviame_shipments
  const sellerDisplay = resolved.comercio || d.company?.name || (resolved.companyId ? `ID: ${resolved.companyId}` : null);
  const shipmentPayload = {
    id: deliveryId,
    order_id: importedId,
    tracking_number: validTracking || 'No informado',
    tracking_url: trackingUrl,
    label_url: labelUrl,
    courier: courier,
    status: statusName,
    seller_name: sellerDisplay,
    service_type: d.service || null,
    recipient_name: cleanValue(d.customer?.full_name),
    recipient_phone: cleanValue(d.customer?.phone),
    recipient_email: cleanValue(d.customer?.email),
    recipient_address: cleanValue(d.shipping_address?.full_address),
    commune: cleanValue(d.shipping_address?.place || d.shipping_address?.county),
    enviame_created_at: d.created_at || null,
    enviame_updated_at: d.updated_at || null,
    raw_payload: d,
    updated_at: new Date().toISOString()
  };

  const { error: shipErr } = await supabase
    .from('enviame_shipments')
    .upsert(shipmentPayload, { onConflict: 'id' });

  if (shipErr) {
    console.error(`❌ Error al actualizar enviame_shipments (${deliveryId}):`, shipErr.message);
  }

  // 2. Actualizar envios_unificados
  const unifiedId = `enviame_shipments:${deliveryId}`;
  const unifiedPayload = {
    id: unifiedId,
    source_table: 'enviame_shipments',
    source_id: deliveryId,
    empresa_comercio_proveedor: resolved.comercio || d.company?.name || null,
    tracking: validTracking || 'No informado',
    tracking_url: trackingUrl,
    courier: courier,
    status: statusName,
    global_status: globalStatus,
    updated_at: new Date().toISOString(),
    servicio_tipo_envio: d.service || null,
    nombre_destinatario: cleanValue(d.customer?.full_name),
    telefono_destino: cleanValue(d.customer?.phone),
    email_cliente_destino: cleanValue(d.customer?.email),
    direccion_destino: cleanValue(d.shipping_address?.full_address),
    comuna_destino: cleanValue(d.shipping_address?.place || d.shipping_address?.county),
    pedido_referencia: importedId || deliveryId,
    raw_data: d
  };

  const { error: uniErr } = await supabase
    .from('envios_unificados')
    .upsert(unifiedPayload, { onConflict: 'id' });

  if (uniErr) {
    console.warn(`⚠️ Aviso al actualizar envios_unificados (${unifiedId}):`, uniErr.message);
  }

  // 3. Buscar y actualizar el pedido en public.orders
  let targetOrder = null;

  // REGLA DE SEGURIDAD ESTRICTA:
  // Si no se puede validar a qué comercio pertenece la entrega de Envíame,
  // NO actualizamos ningún pedido en orders. Esto previene que pedidos con números
  // idénticos (ej: #1067) de tiendas distintas sean sobreescritos incorrectamente.
  if (!resolved.comercio) {
    console.log(`⚠️ Delivery ${deliveryId} (Ref: ${importedId}) no tiene comercio identificable. Se guarda en envíos pero NO se vincula a orders para prevenir asignación cruzada.`);
    return Boolean(validTracking);
  }

  if (importedId) {
    // Normalizar número eliminando '#' y prefijo de sigla del comercio si aplica
    let cleanNum = importedId.replace(/^#+/, '');
    if (resolved.sigla) {
      cleanNum = cleanNum.replace(new RegExp(`^${resolved.sigla}[#\\-_]?`, 'i'), '');
    }
    cleanNum = cleanNum.replace(/^[A-Za-z]{2,5}/, '');

    // Construir lista exhaustiva de candidatos exactos
    const candidates = [
      importedId,
      `#${cleanNum}`,
      cleanNum,
      resolved.sigla ? `${resolved.sigla}#${cleanNum}` : null,
      resolved.sigla ? `${resolved.sigla}${cleanNum}` : null
    ].filter(Boolean);

    const uniqueCandidates = [...new Set(candidates)];

    // Búsqueda ESTRICTA por comercio exacto y candidatos exactos (sin ILIKE comodín)
    const { data: matchedOrders } = await supabase
      .from('orders')
      .select('id, external_order_number, tracking_number, courier, operador, label_url, comercio')
      .ilike('comercio', resolved.comercio)
      .in('external_order_number', uniqueCandidates)
      .limit(1);

    if (matchedOrders && matchedOrders.length > 0) {
      targetOrder = matchedOrders[0];
    }
  }

  // Fallback por enviame_delivery_id: SÓLO dentro del mismo comercio
  if (!targetOrder) {
    const { data: o3 } = await supabase
      .from('orders')
      .select('id, external_order_number, tracking_number, courier, operador, label_url, comercio')
      .eq('enviame_delivery_id', deliveryId)
      .ilike('comercio', resolved.comercio)
      .maybeSingle();
    if (o3) targetOrder = o3;
  }

  if (targetOrder) {
    const orderUpdate = {
      enviame_delivery_id: deliveryId,
      enviame_status: statusName,
      courier: courier,
      operador: mappedOperator
    };

    if (validTracking) {
      orderUpdate.tracking_number = validTracking;
      if (trackingUrl) orderUpdate.tracking_url = trackingUrl;
    } else if (targetOrder.tracking_number === 'No informado') {
      orderUpdate.tracking_number = null;
    }

    if (labelUrl) {
      orderUpdate.label_url = labelUrl;
    }

    const { error: ordErr } = await supabase
      .from('orders')
      .update(orderUpdate)
      .eq('id', targetOrder.id);

    if (ordErr) {
      console.error(`❌ Error actualizando order ${targetOrder.external_order_number} (${targetOrder.comercio}):`, ordErr.message);
    } else {
      console.log(`✅ Pedido [${targetOrder.comercio}] ${targetOrder.external_order_number} actualizado: Tracking: ${validTracking || '(pendiente)'} | Courier: ${courier} | Estado: ${statusName}`);
      return true;
    }
  } else {
    console.log(`ℹ️ Delivery ${deliveryId} ([${resolved.comercio}] Ref: ${importedId}) registrado en envíos pero sin pedido WMS asociado a este comercio.`);
  }

  return Boolean(validTracking);
}

// Sincronización Principal
async function runSync(options = {}) {
  console.log('🚀 Iniciando sincronización de Envíame -> WMS STOCKA...');
  console.log(`Fecha actual: ${new Date().toISOString()}`);

  const specificOrder = options.order;
  if (specificOrder) {
    console.log(`🎯 Modo específico: Sincronizando pedido o delivery ${specificOrder}...`);
    let deliveryId = null;

    // 1. ¿Es directamente un delivery ID numérico de Envíame?
    if (/^\d{8,11}$/.test(specificOrder)) {
      const d = await fetchEnviameDelivery(specificOrder);
      if (d) {
        await processEnviameDelivery(d);
        console.log(`🎉 Delivery ${specificOrder} sincronizado exitosamente.`);
        return;
      }
    }

    // 2. Buscar en orders (soportando UUID o número de pedido externo)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(specificOrder);
    let orderQuery = supabase
      .from('orders')
      .select('id, external_order_number, comercio, enviame_delivery_id, tracking_number');

    if (isUuid) {
      orderQuery = orderQuery.eq('id', specificOrder);
    } else {
      orderQuery = orderQuery.or(`external_order_number.eq.${specificOrder},external_order_number.eq.#${specificOrder},enviame_delivery_id.eq.${specificOrder}`);
    }

    const { data: o } = await orderQuery.limit(1);

    if (o && o[0]) {
      const order = o[0];
      deliveryId = order.enviame_delivery_id;
      if (!deliveryId) {
        const cache = await loadCommerceConfigs();
        const ordComUpper = (order.comercio || '').trim().toUpperCase();
        const expectedIds = cache.commerceToEnviameIds[ordComUpper] || [];

        const cleanExt = String(order.external_order_number).replace(/^#/, '');
        let shipQ = supabase
          .from('enviame_shipments')
          .select('id, seller_name, raw_payload')
          .or(`order_id.eq.${order.external_order_number},order_id.eq.${cleanExt}`)
          .order('created_at', { ascending: false });

        if (expectedIds.length > 0) {
          const filterOr = expectedIds.map(id => `seller_name.ilike.%${id}%`).concat(`seller_name.ilike.%${order.comercio}%`).join(',');
          shipQ = shipQ.or(filterOr);
        } else if (order.comercio) {
          shipQ = shipQ.ilike('seller_name', `%${order.comercio}%`);
        }

        const { data: s } = await shipQ.limit(1);
        if (s && s[0]) deliveryId = s[0].id;
      }

      if (deliveryId) {
        console.log(`Consultando delivery ${deliveryId} en Envíame para orden [${order.comercio}] ${order.external_order_number}...`);
        const d = await fetchEnviameDelivery(deliveryId);
        if (d) {
          await processEnviameDelivery(d, { comercio: order.comercio });
          console.log(`🎉 Pedido ${specificOrder} sincronizado exitosamente.`);
          return;
        }
      } else {
        console.log(`ℹ️ No se encontró ningún delivery en Envíame para el pedido ${specificOrder} asociado al comercio [${order.comercio}].`);
        return;
      }
    } else {
      console.log(`⚠️ Pedido ${specificOrder} no encontrado en orders.`);
      return;
    }
  }

  // 1. RECUPERACIÓN DIRIGIDA: Envíos recientes en enviame_shipments sin tracking
  console.log('\n--- 1. BUSCANDO ENVÍOS SIN TRACKING EN ENVIAME_SHIPMENTS ---');
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: pendingShipments, error: pendErr } = await supabase
    .from('enviame_shipments')
    .select('id, order_id, courier, tracking_number, status, seller_name, created_at')
    .or('tracking_number.eq.No informado,tracking_number.is.null,status.eq.Creado')
    .gte('created_at', fourteenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(150);

  if (pendErr) {
    console.error('Error consultando envíos pendientes:', pendErr.message);
  } else {
    console.log(`Se encontraron ${pendingShipments?.length || 0} envíos pendientes de tracking.`);
    let resolvedCount = 0;

    for (const ship of (pendingShipments || [])) {
      const d = await fetchEnviameDelivery(ship.id);
      if (d) {
        const hasTrack = await processEnviameDelivery(d);
        if (hasTrack) resolvedCount++;
      }
      await delay(120); // Throttle respetuoso para no saturar la API
    }
    console.log(`✨ Recuperación completada: ${resolvedCount} envíos obtuvieron su tracking oficial.`);
  }

  // 2. SINCRONIZACIÓN PROACTIVA POR COMERCIO: Consultar últimas entregas de comercios con enviame_id
  console.log('\n--- 2. SINCRONIZACIÓN DE ÚLTIMAS ENTREGAS POR COMERCIO ---');
  const { data: comercios } = await supabase
    .from('comercios_adicional_config')
    .select('comercio, enviame_id')
    .not('enviame_id', 'is', null);

  for (const c of (comercios || [])) {
    const compId = String(c.enviame_id).trim();
    if (!/^\d+$/.test(compId)) continue;

    try {
      console.log(`Sincronizando entregas recientes para [${c.comercio}] (Company ID: ${compId})...`);
      const url = `https://api.enviame.io/api/s2/v2/companies/${compId}/deliveries?limit=30`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'api-key': API_KEY }
      });

      if (res.ok) {
        const json = await res.json();
        const deliveries = json.data || [];
        console.log(`  -> Obtenidos ${deliveries.length} envíos recientes.`);
        for (const d of deliveries) {
          // Si el comercio no viene en el payload, inyectar el nombre y el company ID
          if (!d.company) d.company = { id: compId, name: c.comercio };
          await processEnviameDelivery(d, { comercio: c.comercio, enviameId: compId });
        }
      } else {
        console.warn(`  ⚠️ Respuesta ${res.status} de Envíame para ${c.comercio}`);
      }
    } catch (err) {
      console.error(`  ❌ Error sincronizando ${c.comercio}:`, err.message);
    }
    await delay(200);
  }

  console.log('\n🎉 ¡Sincronización de Envíame finalizada exitosamente!');
}

// Ejecución directa desde CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  let orderArg = null;
  const orderIdx = args.indexOf('--order');
  if (orderIdx !== -1 && args[orderIdx + 1]) {
    orderArg = args[orderIdx + 1];
  }

  runSync({ order: orderArg }).then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Fatal error en sync_enviame:', err);
    process.exit(1);
  });
}

module.exports = { runSync, fetchEnviameDelivery, processEnviameDelivery, loadCommerceConfigs, resolveCommerceForDelivery };
