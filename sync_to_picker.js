/**
 * WMS STOCKA -> PICKER SYSTEM BIDIRECTIONAL SYNC SCRIPT
 * 
 * Este script se puede ejecutar periódicamente (cada 5 minutos) en el servidor del WMS
 * para mantener sincronizados los pedidos que están en preparación y sus estados.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// 1. Cargar variables de entorno del WMS
const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
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

const WMS_URL = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// Credenciales del Picker (HPOMYMTECMXUJBXQAWU)
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

if (!WMS_KEY) {
  console.error("❌ Error: SUPABASE_SERVICE_ROLE_KEY no está configurado en el archivo .env");
  process.exit(1);
}

const wmsClient = createClient(WMS_URL, WMS_KEY);
const pickerClient = createClient(PICKER_URL, PICKER_KEY);

// Helper para extraer notas del pedido desde los datos crudos o WMS
function getOrderNoteText(order) {
  if (!order) return '';
  if (typeof order.notas === 'string' && order.notas.trim()) return order.notas.trim();
  if (typeof order.observation === 'string' && order.observation.trim()) return order.observation.trim();
  if (typeof order.note === 'string' && order.note.trim()) return order.note.trim();

  // Shopify
  const rawShopify = order.raw_shopify_data;
  if (rawShopify) {
    if (typeof rawShopify.note === 'string' && rawShopify.note.trim()) return rawShopify.note.trim();
    if (typeof rawShopify.notes === 'string' && rawShopify.notes.trim()) return rawShopify.notes.trim();
    if (typeof rawShopify.customer_note === 'string' && rawShopify.customer_note.trim()) return rawShopify.customer_note.trim();
    if (Array.isArray(rawShopify.note_attributes) && rawShopify.note_attributes.length > 0) {
      const noteAttr = rawShopify.note_attributes.map(a => `${a.name}: ${a.value}`).join(' | ');
      if (noteAttr) return noteAttr;
    }
  }

  // WooCommerce
  const rawWoo = order.raw_woocommerce_data;
  if (rawWoo) {
    if (typeof rawWoo.customer_note === 'string' && rawWoo.customer_note.trim()) return rawWoo.customer_note.trim();
    if (typeof rawWoo.note === 'string' && rawWoo.note.trim()) return rawWoo.note.trim();
  }

  // MercadoLibre
  const rawMeli = order.raw_meli_data;
  if (rawMeli) {
    if (typeof rawMeli.note === 'string' && rawMeli.note.trim()) return rawMeli.note.trim();
    if (typeof rawMeli.comments === 'string' && rawMeli.comments.trim()) return rawMeli.comments.trim();
    if (typeof rawMeli.comment === 'string' && rawMeli.comment.trim()) return rawMeli.comment.trim();
    if (typeof rawMeli.notes === 'string' && rawMeli.notes.trim()) return rawMeli.notes.trim();
  }

  // Jumpseller
  const rawJump = order.raw_jumpseller_data;
  if (rawJump) {
    if (typeof rawJump.note === 'string' && rawJump.note.trim()) return rawJump.note.trim();
    if (typeof rawJump.customer_notes === 'string' && rawJump.customer_notes.trim()) return rawJump.customer_notes.trim();
    if (typeof rawJump.notes === 'string' && rawJump.notes.trim()) return rawJump.notes.trim();
  }

  // TiendaNube
  const rawTn = order.raw_tiendanube_data;
  if (rawTn && typeof rawTn.note === 'string' && rawTn.note.trim()) return rawTn.note.trim();

  // Falabella / Paris / Ripley / Walmart
  if (order.raw_falabella_data?.note) return String(order.raw_falabella_data.note).trim();
  if (order.raw_falabella_data?.comments) return String(order.raw_falabella_data.comments).trim();
  if (order.raw_paris_data?.note) return String(order.raw_paris_data.note).trim();
  if (order.raw_paris_data?.comments) return String(order.raw_paris_data.comments).trim();
  if (order.raw_ripley_data?.note) return String(order.raw_ripley_data.note).trim();
  if (order.raw_ripley_data?.comments) return String(order.raw_ripley_data.comments).trim();
  if (order.raw_walmart_data?.note) return String(order.raw_walmart_data.note).trim();

  return '';
}

function buildPickerObservation(order, defaultObs) {
  const note = getOrderNoteText(order);
  const def = (defaultObs || '').trim();
  if (note && def) {
    if (def.toLowerCase().includes(note.toLowerCase())) {
      return def;
    }
    return `${note} | ${def}`;
  } else if (note) {
    return note;
  } else {
    return def;
  }
}

// Helper para resolver el SKU que se envía al Picker en active_orders (prioridad: CBAR WMS > CBAR Origen > SKU)
function resolvePickerSku(prod, order, commerceStrict) {
  const cbarWms = prod?.barcode_wms && String(prod.barcode_wms).trim();
  const originBarcode = prod?.barcode && String(prod.barcode).trim();
  const sendWms = prod?.send_barcode_wms_to_picker !== false;
  const sendOrigin = Boolean(prod?.send_barcode_to_picker || prod?.picking_match_strict || commerceStrict);
  if (cbarWms && sendWms) return cbarWms;
  if (sendOrigin && originBarcode) return originBarcode;
  return (prod?.sku || order?.sku || 'SKU-TEMP');
}

// Helper para resolver el código de seguimiento/etiqueta que se envía al Picker en active_orders
function resolveOrderTracking(order) {
  if (!order) return '';
  if (order.tracking_number && String(order.tracking_number).trim() && String(order.tracking_number).trim().toLowerCase() !== 'no informado') {
    return String(order.tracking_number).trim();
  }
  // Shopify fulfillments tracking fallback
  if (order.raw_shopify_data?.fulfillments && Array.isArray(order.raw_shopify_data.fulfillments)) {
    for (const f of order.raw_shopify_data.fulfillments) {
      if (f.tracking_number && String(f.tracking_number).trim()) {
        return String(f.tracking_number).trim();
      }
      if (Array.isArray(f.tracking_numbers) && f.tracking_numbers[0] && String(f.tracking_numbers[0]).trim()) {
        return String(f.tracking_numbers[0]).trim();
      }
    }
  }
  // MercadoLibre shipment ID fallback
  if (order.external_platform === 'MercadoLibre' || order.raw_meli_data) {
    const raw = order.raw_meli_data;
    let shipId = null;
    if (Array.isArray(raw)) shipId = raw[0]?.shipping?.id;
    else if (raw?.orders && Array.isArray(raw.orders)) shipId = raw.orders[0]?.shipping?.id;
    else if (raw?.shipping) shipId = raw.shipping?.id;
    if (shipId) return String(shipId).trim();
  }
  return '';
}

async function run() {
  console.log(`[${new Date().toISOString()}] Iniciando sincronización bidireccional WMS <-> Picker...`);

  try {
    // 0. Obtener comercios con lectura estricta obligatoria
    const { data: strictComercios } = await wmsClient
      .from('comercios_adicional_config')
      .select('comercio')
      .eq('picking_match_strict', true);
    const strictComerciosSet = new Set((strictComercios || []).map(c => String(c.comercio).trim().toUpperCase()));

    // 1. Obtener todos los pedidos del WMS en estado "En preparación"
    const { data: wmsOrders, error: wmsErr } = await wmsClient
      .from('orders')
      .select(`
        id,
        external_order_number,
        comercio,
        customer_name,
        customer_email,
        customer_phone,
        shipping_address,
        shipping_city,
        shipping_complement,
        shipping_method,
        courier,
        tracking_number,
        estado_wms,
        agenda,
        sucursal_pickeo,
        operador,
        raw_shopify_data,
        raw_woocommerce_data,
        raw_meli_data,
        raw_jumpseller_data,
        raw_tiendanube_data,
        raw_falabella_data,
        raw_paris_data,
        raw_ripley_data,
        raw_walmart_data,
        order_items (quantity, products(sku, name, price, image_url, options, is_virtual, barcode, barcode_wms, send_barcode_to_picker, send_barcode_wms_to_picker, picking_match_strict, alias, send_alias_to_picker, color, talla, variable_1, variable_2))
      `)
      .eq('estado_wms', 'En preparación');

    if (wmsErr) throw wmsErr;

    if (!wmsOrders || wmsOrders.length === 0) {
      console.log("ℹ️ No hay pedidos en estado 'En preparación' en el WMS.");
      return;
    }

    console.log(`📋 Se encontraron ${wmsOrders.length} pedidos 'En preparación' en WMS.`);

    // 2. Obtener todas las órdenes activas en el Picker para cruzar y comparar (normalizando # y sin #)
    const orderNumbersSet = new Set();
    wmsOrders.forEach(o => {
      const raw = String(o.external_order_number || o.id).trim();
      if (!raw) return;
      orderNumbersSet.add(raw);
      orderNumbersSet.add('#' + raw.replace(/^#/, ''));
      orderNumbersSet.add(raw.replace(/^#/, ''));
    });
    const orderNumbers = Array.from(orderNumbersSet);

    const { data: pickerActiveOrders, error: pickerErr } = await pickerClient
      .from('active_orders')
      .select('*')
      .in('order_number', orderNumbers);

    if (pickerErr) throw pickerErr;

    for (const wmsOrder of wmsOrders) {
      const orderNo = String(wmsOrder.external_order_number || wmsOrder.id);
      const cleanOrderNo = orderNo.replace(/^#/, '').trim().toUpperCase();
      
      // Registrar en Punto de Retiro (WMS y Picker) si la agenda es retiro
      if (wmsOrder.agenda && wmsOrder.agenda.trim().toUpperCase() === 'RETIRO') {
        await registerPickupIfNeeded(wmsOrder);
      }

      const pickerItemsForOrder = (pickerActiveOrders || []).filter(item => {
        const pNo = String(item.order_number || '').replace(/^#/, '').trim().toUpperCase();
        return pNo === cleanOrderNo;
      });

      const opUpper = String(wmsOrder.operador || '').toUpperCase().trim();
      const curUpper = String(wmsOrder.courier || '').toUpperCase().trim();
      const shipMethodUpper = String(wmsOrder.shipping_method || '').toUpperCase().trim();
      const agendaUpper = String(wmsOrder.agenda || '').toUpperCase().trim();

      const isStk = agendaUpper === 'STK';
      const isRetiro = agendaUpper === 'RETIRO';
      const isBodegaCompra = agendaUpper === 'COMPRA EN BODEGA';
      const isPorPagar = opUpper.includes('POR PAGAR') || curUpper.includes('POR PAGAR') || shipMethodUpper.includes('POR PAGAR');
      const isSucursal = opUpper.includes('SUCURSAL') || curUpper.includes('SUCURSAL');

      const resolvedTrack = resolveOrderTracking(wmsOrder);

      // Backfill tracking_number en WMS si se resolvió desde raw_shopify_data
      if (resolvedTrack && (!wmsOrder.tracking_number || String(wmsOrder.tracking_number).trim().toLowerCase() === 'no informado')) {
        wmsClient.from('orders').update({ tracking_number: resolvedTrack }).eq('id', wmsOrder.id).then(() => {}).catch(() => {});
        wmsOrder.tracking_number = resolvedTrack;
      }

      let cleanTracking = '';
      if (isStk) {
        cleanTracking = String(orderNo).replace(/[^a-zA-Z0-9]/g, '') || orderNo;
      } else if (isRetiro) {
        cleanTracking = String(orderNo).replace(/[^a-zA-Z0-9]/g, '');
      } else if (isPorPagar) {
        cleanTracking = resolvedTrack || '-';
      } else if (isBodegaCompra || isSucursal) {
        cleanTracking = resolvedTrack || String(orderNo).replace(/[^a-zA-Z0-9]/g, '') || '-';
      } else {
        cleanTracking = resolvedTrack;
      }

      const isCourier = !isStk && !isRetiro && !isPorPagar && !isBodegaCompra && !isSucursal;

      if (pickerItemsForOrder.length > 0) {
        const firstAct = pickerItemsForOrder[0];
        const currentPickerTrack = String(firstAct.tracking || '').trim();

        // 1. Si el pedido requiere courier pero no tiene tracking ni en Picker ni en WMS, y aún está EN PREPARACIÓN,
        // retirarlo temporalmente de active_orders para que el operario NO reciba pedidos "SIN TRACKING".
        if (isCourier && !cleanTracking && !currentPickerTrack && firstAct.sheet_status === 'EN PREPARACIÓN') {
          console.log(`🧹 [SYNC] Retirando pedido ${orderNo} de Picker porque no tiene tracking asignado aún (${wmsOrder.operador || 'Courier'}). Se reinsertará cuando se genere su etiqueta.`);
          await pickerClient.from('active_orders').delete().eq('order_number', orderNo);
          continue;
        }

        // 2. Si WMS tiene tracking pero en Picker está vacío o desactualizado, sincronizarlo inmediatamente
        if (cleanTracking && currentPickerTrack !== cleanTracking) {
          console.log(`🔄 [SYNC] Actualizando tracking en Picker para pedido ${orderNo}: "${currentPickerTrack || 'VACÍO'}" -> "${cleanTracking}"`);
          const { error: trkErr } = await pickerClient
            .from('active_orders')
            .update({ 
              tracking: cleanTracking,
              operator: wmsOrder.operador || firstAct.operator || ''
            })
            .eq('order_number', orderNo);
          if (trkErr) {
            console.error(`Error actualizando tracking en Picker para ${orderNo}:`, trkErr.message);
          } else {
            pickerItemsForOrder.forEach(it => { it.tracking = cleanTracking; });
          }
        }

        // Actualizar el estado y operario en WMS si las columnas existen
        try {
          const syncPayload = {
            picker_status: firstAct.sheet_status || 'EN PREPARACIÓN',
            picker_operator: firstAct.operator || null,
            picker_last_synced_at: new Date().toISOString()
          };
          if (firstAct.scanned_label) {
            syncPayload.picker_scanned_label = firstAct.scanned_label;
          }
          const { error: syncErr } = await wmsClient
            .from('orders')
            .update(syncPayload)
            .eq('id', wmsOrder.id);

          if (syncErr && syncPayload.picker_scanned_label) {
            delete syncPayload.picker_scanned_label;
            await wmsClient.from('orders').update(syncPayload).eq('id', wmsOrder.id);
          }
        } catch (_) {}

        // === CASO A: El pedido ya existe en el Picker, verificar si fue modificado en el WMS ===
        console.log(`🔍 Pedido ${orderNo} activo en Picker. Comparando ítems...`);

        // Estructurar ítems de WMS para comparar
        const wmsItemsMap = {};
        const commerceName = String(wmsOrder.comercio || '').trim().toUpperCase();
        const commerceStrict = strictComerciosSet.has(commerceName);
        wmsOrder.order_items.forEach(oi => {
          if (oi.products?.is_virtual) return;
          const sku = resolvePickerSku(oi.products, wmsOrder, commerceStrict).trim().toUpperCase();
          if (sku) {
            wmsItemsMap[sku] = (wmsItemsMap[sku] || 0) + (parseInt(oi.quantity, 10) || 0);
          }
        });

        // Estructurar ítems de Picker para comparar
        const pickerItemsMap = {};
        pickerItemsForOrder.forEach(pi => {
          const sku = (pi.sku || '').trim().toUpperCase();
          if (sku) {
            pickerItemsMap[sku] = (pickerItemsMap[sku] || 0) + (parseInt(pi.quantity, 10) || 0);
          }
        });

        // Comparar cantidad y SKUs
        let hasChanges = false;
        const wmsSkus = Object.keys(wmsItemsMap);
        const pickerSkus = Object.keys(pickerItemsMap);

        if (wmsSkus.length !== pickerSkus.length) {
          hasChanges = true;
        } else {
          for (const sku of wmsSkus) {
            if (wmsItemsMap[sku] !== pickerItemsMap[sku]) {
              hasChanges = true;
              break;
            }
          }
        }

        if (hasChanges) {
          console.log(`⚠️ DETECTADAS MODIFICACIONES en el pedido ${orderNo}. Actualizando Picker y alertando al operario...`);

          // 1. Eliminar anteriores en Picker
          await pickerClient
            .from('active_orders')
            .delete()
            .eq('order_number', orderNo);

          // 2. Insertar los actualizados con advertencia
          const payloads = [];
          const nowStr = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
          const physicalItems = wmsOrder.order_items.filter(oi => !oi.products?.is_virtual);
          const totu = physicalItems.reduce((sum, oi) => sum + (parseInt(oi.quantity, 10) || 0), 0) || 1;
          physicalItems.forEach(oi => {
            const prod = oi.products || {};
            const opt = prod.options || {};
            const colorVal = prod.color || opt.color || null;
            const tallaVal = opt.talla || opt.size || prod.talla || null;
            let mangaVal = prod.variable_1 || opt.var1 || opt.manga || null;
            let cuelloVal = prod.variable_2 || opt.var2 || opt.cuello || null;

            const v1Str = String(mangaVal || '').toUpperCase().trim();
            const v2Str = String(cuelloVal || '').toUpperCase().trim();
            const isManga = val => val.includes('LARGA') || val.includes('CORTA') || val.includes('MANGA') || val.includes('M LARGA') || val.includes('M. LARGA');
            const isCuello = val => val.includes('CUELLO') || val.includes('REDONDO') || val.includes('POLO') || val.includes('V-NECK') || val.includes('CUELLO V');

            if (isManga(v2Str) && !isManga(v1Str)) {
              const tmp = mangaVal;
              mangaVal = cuelloVal;
              cuelloVal = tmp;
            } else if (isCuello(v1Str) && !isCuello(v2Str)) {
              const tmp = mangaVal;
              mangaVal = cuelloVal;
              cuelloVal = tmp;
            }

            const commerceName = String(wmsOrder.comercio || '').trim().toUpperCase();
            const commerceStrict = strictComerciosSet.has(commerceName);
            payloads.push({
              sucursal: wmsOrder.sucursal_pickeo || 'Sucursal Virtual (Hub)',
              order_number: orderNo,
              agenda: wmsOrder.agenda || 'STK',
              quantity: parseInt(oi.quantity, 10) || 1,
              sku: resolvePickerSku(prod, wmsOrder, commerceStrict),
              name: (prod.send_alias_to_picker && prod.alias && prod.alias.trim()) ? prod.alias.trim() : (prod.name || 'Producto WMS'),
              color: colorVal ? String(colorVal).trim() : null,
              color_bg: opt.color_bg || null,
              color_text: opt.color_text || null,
              talla: tallaVal ? String(tallaVal).trim() : null,
              manga: mangaVal ? String(mangaVal).trim() : null,
              cuello: cuelloVal ? String(cuelloVal).trim() : null,
              client_name: wmsOrder.customer_name || 'Sin nombre',
              tracking: cleanTracking,
              operator: wmsOrder.operador || (isRetiro ? 'SUCURSAL ÑUÑOA' : (isPorPagar ? 'POR PAGAR' : '')),
              totu: totu,
              sheet_status: 'Pendiente (Obs)', // Resalta en color de alerta en Picker
              observation: buildPickerObservation(wmsOrder, `⚠️ [MODIFICADO] Este pedido sufrió cambios en el WMS el [${nowStr}]. Por favor verificar ítems.`),
              contact_data_q: wmsOrder.customer_email || '',
              contact_data_r: wmsOrder.customer_phone || '',
              contact_data_s: wmsOrder.shipping_address || '',
              contact_data_t: wmsOrder.shipping_city || '',
              contact_data_u: wmsOrder.shipping_complement || '',
              extra_col_v: prod.image_url || '',
              comercio: wmsOrder.comercio || 'MAGIC MAKEUP',
              created_by: 'Sistema WMS',
              picking_match_strict: commerceStrict || prod.picking_match_strict || false
            });
          });

          if (payloads.length > 0) {
            const { error: insErr } = await pickerClient.from('active_orders').insert(payloads);
            if (insErr) console.error(`Error re-insertando pedido ${orderNo} en Picker:`, insErr.message);
          }
        } else {
          console.log(`✅ Pedido ${orderNo} está al día en el Picker. Sin cambios.`);
        }

      } else {
        // === CASO B: El pedido no está activo en Picker active_orders ===
        console.log(`🔍 Pedido ${orderNo} no está activo en Picker. Verificando estado en Punto de Retiro e historial de completado...`);

        // B.1 Verificar si es retiro y ya fue cancelado o entregado en sucursal_pickups
        let isPickupHandled = false;
        try {
          const { data: pickupCheck } = await pickerClient
            .from('sucursal_pickups')
            .select('estado_pedido')
            .eq('pedido', orderNo)
            .maybeSingle();

          if (pickupCheck) {
            const st = (pickupCheck.estado_pedido || '').trim().toUpperCase();
            if (st === 'CANCELADO') {
              console.log(`🚫 Pedido ${orderNo} fue cancelado en Punto de Retiro. Sincronizando WMS a 'Cancelado'...`);
              await wmsClient.from('orders').update({ estado_wms: 'Cancelado' }).eq('id', wmsOrder.id);
              isPickupHandled = true;
            } else if (st === 'ENTREGADO') {
              console.log(`📦 Pedido ${orderNo} fue entregado en Punto de Retiro. Sincronizando WMS a 'Pickeado'...`);
              await wmsClient.from('orders').update({ estado_wms: 'Pickeado' }).eq('id', wmsOrder.id);
              isPickupHandled = true;
            }
          }
        } catch (pickErr) {
          console.error(`Error verificando sucursal_pickups para ${orderNo}:`, pickErr.message);
        }

        if (isPickupHandled) continue;

        // B.2 Consultar en logs de completado del Picker (normalizando #)
        const searchLogKeys = [orderNo, '#' + orderNo.replace(/^#/, ''), orderNo.replace(/^#/, '')];
        const { data: logs, error: logsErr } = await pickerClient
          .from('history_logs')
          .select('pedido, estado, comentarios, picker, scanned_label')
          .in('pedido', searchLogKeys)
          .in('estado', ['Completado', 'COMPLETADO', 'Completado-Asistido', 'Listo para retiro', 'LISTO PARA RETIRO'])
          .order('created_at', { ascending: false })
          .limit(1);

        if (logsErr) {
          console.error(`Error consultando logs para ${orderNo}:`, logsErr.message);
          continue;
        }

        if (logs && logs.length > 0) {
          // El pedido fue completado en el Picker, actualizamos el WMS a 'Pickeado'
          console.log(`🎉 ¡Pedido ${orderNo} completado en Picker con estado: "${logs[0].estado}"! Sincronizando WMS...`);
          
          let wmsUpdateErr = null;
          try {
            const completedPayload = { 
              estado_wms: 'Pickeado',
              picker_status: logs[0].estado,
              picker_operator: logs[0].picker || null,
              picker_last_synced_at: new Date().toISOString()
            };
            if (logs[0].scanned_label) {
              completedPayload.picker_scanned_label = logs[0].scanned_label;
            }
            const res = await wmsClient
              .from('orders')
              .update(completedPayload)
              .eq('id', wmsOrder.id);
            if (res.error) throw res.error;
          } catch (_) {
            const fallbackRes = await wmsClient
              .from('orders')
              .update({ estado_wms: 'Pickeado' })
              .eq('id', wmsOrder.id);
            wmsUpdateErr = fallbackRes.error;
          }

          if (wmsUpdateErr) {
            console.error(`Error actualizando estado en WMS para ${orderNo}:`, wmsUpdateErr.message);
          } else {
            console.log(`✅ Pedido ${orderNo} marcado exitosamente como 'Pickeado' en WMS.`);
          }
        } else {
          // B.3 CASO SELF-HEALING: El pedido está 'En preparación' en WMS pero NO está en active_orders ni en logs de completado.
          // REGLA CRÍTICA: Si el pedido requiere despacho por courier externo (no STK y no RETIRO) y NO tiene tracking asignado aún,
          // NO se inserta en active_orders para evitar que los operarios del Picker reciban pedidos "SIN TRACKING".
          if (isCourier && (!cleanTracking || String(cleanTracking).trim() === '' || String(cleanTracking).trim().toLowerCase() === 'no informado')) {
            console.log(`⏳ [SYNC PICKER] Pedido ${orderNo} (${wmsOrder.operador || 'Courier'}) está 'En preparación' pero no tiene tracking asignado aún en WMS. En espera de etiqueta antes de enviar al Picker.`);
            continue;
          }

          console.log(`🩹 [SELF-HEALING] Pedido ${orderNo} en preparación con tracking "${cleanTracking}". Re-insertando en active_orders...`);

          const physicalItems = (wmsOrder.order_items || []).filter(oi => !oi.products?.is_virtual);
          const totu = physicalItems.reduce((sum, oi) => sum + (parseInt(oi.quantity, 10) || 0), 0) || 1;
          const commerceStrict = strictComerciosSet.has(String(wmsOrder.comercio || '').trim().toUpperCase());
          const defaultSucursal = isRetiro ? 'Sucursal Ñuñoa' : 'Sucursal Virtual (Hub)';

          const payloads = [];
          physicalItems.forEach(oi => {
            const prod = oi.products || {};
            const opt = prod.options || {};
            const colorVal = prod.color || opt.color || null;
            const tallaVal = opt.talla || opt.size || prod.talla || null;
            let mangaVal = prod.variable_1 || opt.var1 || opt.manga || null;
            let cuelloVal = prod.variable_2 || opt.var2 || opt.cuello || null;

            const v1Str = String(mangaVal || '').toUpperCase().trim();
            const v2Str = String(cuelloVal || '').toUpperCase().trim();
            const isManga = val => val.includes('LARGA') || val.includes('CORTA') || val.includes('MANGA') || val.includes('M LARGA') || val.includes('M. LARGA');
            const isCuello = val => val.includes('CUELLO') || val.includes('REDONDO') || val.includes('POLO') || val.includes('V-NECK') || val.includes('CUELLO V');

            if (isManga(v2Str) && !isManga(v1Str)) {
              const tmp = mangaVal;
              mangaVal = cuelloVal;
              cuelloVal = tmp;
            } else if (isCuello(v1Str) && !isCuello(v2Str)) {
              const tmp = mangaVal;
              mangaVal = cuelloVal;
              cuelloVal = tmp;
            }

            payloads.push({
              sucursal: wmsOrder.sucursal_pickeo || defaultSucursal,
              order_number: orderNo,
              agenda: wmsOrder.agenda || (isRetiro ? 'RETIRO' : 'STK'),
              quantity: parseInt(oi.quantity, 10) || 1,
              sku: resolvePickerSku(prod, wmsOrder, commerceStrict),
              name: (prod.send_alias_to_picker && prod.alias && prod.alias.trim())
                ? prod.alias.trim()
                : (prod.name || 'Producto WMS'),
              color: colorVal ? String(colorVal).trim() : null,
              color_bg: opt.color_bg || null,
              color_text: opt.color_text || null,
              talla: tallaVal ? String(tallaVal).trim() : null,
              manga: mangaVal ? String(mangaVal).trim() : null,
              cuello: cuelloVal ? String(cuelloVal).trim() : null,
              client_name: wmsOrder.customer_name || 'Sin nombre',
              tracking: cleanTracking,
              operator: wmsOrder.operador || (isRetiro ? 'SUCURSAL ÑUÑOA' : (isPorPagar ? 'POR PAGAR' : '')),
              totu: totu,
              sheet_status: 'EN PREPARACIÓN',
              observation: buildPickerObservation(wmsOrder, ''),
              fecha: new Date().toISOString().split('T')[0],
              contact_data_q: wmsOrder.customer_email || '',
              contact_data_r: wmsOrder.customer_phone || '',
              contact_data_s: wmsOrder.shipping_address || '',
              contact_data_t: wmsOrder.shipping_city || '',
              contact_data_u: wmsOrder.shipping_complement || '',
              extra_col_v: prod.image_url || '',
              comercio: wmsOrder.comercio || 'STOCKA',
              created_by: 'Self-Healing Sync',
              picking_match_strict: commerceStrict || prod.picking_match_strict || false
            });
          });

          if (payloads.length > 0) {
            await pickerClient.from('active_orders').delete().eq('order_number', orderNo);
            const { error: insErr } = await pickerClient.from('active_orders').insert(payloads);
            if (insErr) {
              console.error(`❌ [SELF-HEALING] Error insertando pedido ${orderNo} en Picker:`, insErr.message);
            } else {
              console.log(`✅ [SELF-HEALING] Pedido ${orderNo} recuperado e insertado exitosamente en Picker active_orders.`);
            }
          }
        }
      }
    }

  } catch (err) {
    console.error("❌ Error general durante la sincronización:", err.message);
  }

  console.log(`[${new Date().toISOString()}] Sincronización finalizada.`);
}

if (require.main === module) {
  run();
}

module.exports = {
  runSyncToPicker: run
};

async function registerPickupIfNeeded(order) {
  const orderNumber = String(order.external_order_number || order.id);
  const sucursal = order.sucursal_pickeo || 'Sucursal Ñuñoa';
  const comercio = order.comercio || '';
  const customerName = order.customer_name || 'Cliente';

  // Helper para generar PIN
  const generatePin = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let pin = '';
    for (let i = 0; i < 6; i++) {
      pin += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pin;
  };

  try {
    const { data: wmsExists, error: wmsCheckErr } = await wmsClient
      .from('store_pickups')
      .select('id')
      .eq('pedido', orderNumber)
      .maybeSingle();

    if (!wmsCheckErr && !wmsExists) {
      const pin = generatePin();
      
      // Obtener el ID máximo actual de store_pickups para incrementarlo manualmente
      const { data: maxIdData } = await wmsClient
        .from('store_pickups')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextId = maxIdData ? (parseInt(maxIdData.id, 10) + 1) : 1;

      const { error: insErr } = await wmsClient
        .from('store_pickups')
        .insert([{
          id: nextId,
          comercio: comercio,
          pedido: orderNumber,
          nombre_apellido: customerName,
          estado_pedido: 'NO PREPARADO',
          sucursal: sucursal,
          observaciones: `${customerName} | Ingreso automático desde WMS`,
          pin_retiro: pin,
          marcar_retirado_web: false,
          avisado_x_mail: false,
          cant_mails_enviados: 0,
          notificado_automatico: false
        }]);

      if (insErr) {
        console.error(`Error registrando pickup en WMS para ${orderNumber}:`, insErr.message);
      } else {
        console.log(`📌 Pickup registrado automáticamente en WMS para ${orderNumber} con ID ${nextId}`);
      }
    }
  } catch (err) {
    console.error(`Error en registerPickupIfNeeded WMS para ${orderNumber}:`, err.message);
  }

  try {
    const { data: pickerExists, error: pickerCheckErr } = await pickerClient
      .from('sucursal_pickups')
      .select('id')
      .eq('pedido', orderNumber)
      .maybeSingle();

    if (!pickerCheckErr && !pickerExists) {
      // Obtener el PIN que insertamos o generar uno nuevo si falló
      let pin = '';
      const { data: wmsPickup } = await wmsClient
        .from('store_pickups')
        .select('pin_retiro')
        .eq('pedido', orderNumber)
        .maybeSingle();
      
      if (wmsPickup && wmsPickup.pin_retiro) {
        pin = wmsPickup.pin_retiro;
      } else {
        pin = generatePin();
      }

      const { error: insErr } = await pickerClient
        .from('sucursal_pickups')
        .insert([{
          comercio: comercio,
          pedido: orderNumber,
          nombre_apellido: customerName,
          estado_pedido: 'NO PREPARADO',
          sucursal: sucursal,
          observaciones: `${customerName} | Ingreso automático desde WMS`,
          pin_retiro: pin,
          marcar_retirado_web: false,
          avisado_x_mail: false,
          cant_mails_enviados: 0,
          notificado_automatico: false
        }]);

      if (insErr) {
        console.error(`Error registrando pickup en Picker para ${orderNumber}:`, insErr.message);
      } else {
        console.log(`📌 Pickup registrado automáticamente en Picker para ${orderNumber}`);
      }
    }
  } catch (err) {
    console.error(`Error en registerPickupIfNeeded Picker para ${orderNumber}:`, err.message);
  }
}
