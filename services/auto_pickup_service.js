/**
 * Servicio de Automatización de Retiros para Stocka WMS
 * 
 * Reglas de Negocio:
 * 1. Categoría de entrega: RETIRO (o método con palabras clave de retiro).
 * 2. Bodega por defecto: Sucursal Ñuñoa (Matriz Ñuñoa).
 * 3. Estado de pago: Pagado ('paid', 'pagado').
 * 4. Control de Stock:
 *    - Si NO hay stock suficiente en Sucursal Ñuñoa: NO se envía a preparación y Stox emite alerta de quiebre.
 *    - Si HAY stock suficiente: Pasa a 'En preparación', se envía al Picker y Stox notifica confirmación.
 * 5. Acción WMS: Pasa a 'En preparación', agenda='RETIRO', operador='SUCURSAL ÑUÑOA', sucursal_pickeo='Sucursal Ñuñoa'.
 * 6. Acción Picker: Se inserta en active_orders del Picker y se registra en store_pickups con PIN.
 * 7. Acción WhatsApp: Stox notifica al grupo de operaciones.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { sendWhatsAppMessage } = require('./whatsapp_client');

// Cargar variables de entorno
const envPath = path.join(__dirname, '../.env');
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

const WMS_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

const NUNOA_WAREHOUSE_ID = '973da888-8a63-4790-a08f-919e1af41a93'; // Matriz Ñuñoa
const DEFAULT_GROUP_JID = '120363043911687615@g.us'; // Coordinación Stocka

// Solo procesar pedidos creados desde hoy en adelante (02 de Septiembre de 2026 en adelante)
const AUTO_PICKUP_CUTOFF_DATE = process.env.AUTO_PICKUP_CUTOFF_DATE || '2026-09-02T00:00:00.000-04:00';

// Horario de Operaciones: 10:00 a 17:30 hrs (Hora de Chile)
const OPERATING_HOURS = {
  startHour: 10,
  startMinute: 0,
  endHour: 17,
  endMinute: 30,
  timeZone: 'America/Santiago'
};

function isWithinOperatingHours() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('es-CL', {
    timeZone: OPERATING_HOURS.timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const currentTotal = hour * 60 + minute;

  const startTotal = OPERATING_HOURS.startHour * 60 + OPERATING_HOURS.startMinute; // 10:00 -> 600
  const endTotal = OPERATING_HOURS.endHour * 60 + OPERATING_HOURS.endMinute;       // 17:30 -> 1050

  return currentTotal >= startTotal && currentTotal <= endTotal;
}

const wmsClient = createClient(WMS_URL, WMS_KEY);
const pickerClient = createClient(PICKER_URL, PICKER_KEY);

function generatePin() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let pin = '';
  for (let i = 0; i < 6; i++) {
    pin += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pin;
}

/**
 * Procesa un pedido individual para validarlo, enviarlo a preparación y notificar por WhatsApp
 */
async function autoProcessSinglePickupOrder(orderId, options = {}) {
  const targetGroup = options.targetGroup || DEFAULT_GROUP_JID;
  const dryRun = options.dryRun || false;

  console.log(`[AutoPickup] Analizando pedido ${orderId}...`);

  // 1. Obtener la orden con sus ítems y productos
  const { data: order, error: orderErr } = await wmsClient
    .from('orders')
    .select(`
      id,
      external_order_number,
      comercio,
      merchant_id,
      customer_name,
      customer_email,
      customer_phone,
      shipping_address,
      shipping_city,
      shipping_complement,
      shipping_method,
      categoria_entrega,
      payment_status,
      estado_wms,
      agenda,
      operador,
      sucursal_pickeo,
      order_items (
        id,
        quantity,
        warehouse_id,
        products (
          id, sku, name, price, image_url, options, is_virtual, barcode, 
          send_barcode_to_picker, picking_match_strict, alias, send_alias_to_picker
        )
      )
    `)
    .eq('id', orderId)
    .single();

  if (orderErr || !order) {
    throw new Error(`Orden no encontrada: ${orderErr?.message}`);
  }

  // 2. Validar Condiciones de Negocio
  if (order.created_at && new Date(order.created_at) < new Date(AUTO_PICKUP_CUTOFF_DATE) && !options.force) {
    return { skipped: true, reason: `Pedido anterior a la fecha de activación de automatización (${AUTO_PICKUP_CUTOFF_DATE})` };
  }

  const orderNo = String(order.external_order_number || order.id);

  // 2.1 Verificar si el pedido ya registra completado/retirado en el historial del Picker
  const { data: pickerHistory } = await pickerClient
    .from('history_logs')
    .select('id, estado, fecha, comentarios')
    .eq('pedido', orderNo)
    .in('estado', ['Completado', 'Completado-Asistido', 'Listo para retiro', 'LISTO PARA RETIRO', 'Retirado', 'RETIRADO'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (pickerHistory && pickerHistory.length > 0) {
    const historicalStatus = pickerHistory[0].estado;
    console.log(`⚠️ Pedido ${orderNo} YA REGISTRA HISTORIAL en Picker ("${historicalStatus}"). No se admite re-envío.`);
    
    // Sincronizar WMS para que quede en estado terminal
    await wmsClient
      .from('orders')
      .update({ estado_wms: 'Despachado' })
      .eq('id', order.id);

    return {
      skipped: true,
      reason: `El pedido ya cuenta con registro histórico completado en el Picker ("${historicalStatus}"). Se sincronizó WMS a Despachado.`
    };
  }

  const isRetiro = (order.categoria_entrega === 'RETIRO') || 
                   (order.shipping_method && /retiro|pickup|centro|sucursal/i.test(order.shipping_method));
  
  const isPaid = order.payment_status && /paid|pagado/i.test(order.payment_status);

  // Obtener la configuración del comercio para verificar bodega por defecto
  let commerceDefaultWarehouse = null;
  if (order.comercio) {
    const { data: comConfig } = await wmsClient
      .from('comercios_adicional_config')
      .select('default_warehouse_id')
      .eq('comercio', order.comercio)
      .maybeSingle();
    commerceDefaultWarehouse = comConfig?.default_warehouse_id;
  }

  const isNunoa = (order.sucursal_pickeo && /ñuñoa/i.test(order.sucursal_pickeo)) ||
                  (commerceDefaultWarehouse === NUNOA_WAREHOUSE_ID) ||
                  (!order.sucursal_pickeo && !commerceDefaultWarehouse); // Default WMS a Ñuñoa si no está seteado

  if (!isRetiro) {
    return { skipped: true, reason: `No es categoría RETIRO (categoria_entrega: ${order.categoria_entrega}, shipping_method: ${order.shipping_method})` };
  }

  if (!isPaid) {
    return { skipped: true, reason: `Estado de pago no es pagado (payment_status: ${order.payment_status})` };
  }

  if (!isNunoa) {
    return { skipped: true, reason: `Bodega no corresponde a Sucursal Ñuñoa (sucursal_pickeo: ${order.sucursal_pickeo}, defaultWarehouse: ${commerceDefaultWarehouse})` };
  }


  // 2.5 Validación de Stock en Bodega Ñuñoa y consulta en otras sucursales
  const physicalItems = (order.order_items || []).filter(oi => !oi.products?.is_virtual && oi.products?.id);
  const stockShortages = [];

  if (physicalItems.length > 0) {
    const productIds = Array.from(new Set(physicalItems.map(oi => oi.products.id)));
    const { data: allInvData, error: invErr } = await wmsClient
      .from('inventory')
      .select('product_id, warehouse_id, quantity, warehouses (id, name)')
      .in('product_id', productIds);

    if (invErr) {
      console.error(`[AutoPickup] Error consultando inventario para ${orderNo}:`, invErr.message);
    }

    const nunoaInvMap = {};
    const otherBranchesMap = {}; // pId -> Array of { name, quantity }

    (allInvData || []).forEach(inv => {
      const pId = inv.product_id;
      const qty = inv.quantity || 0;
      const wId = inv.warehouse_id;
      const wName = inv.warehouses?.name || 'Otra Bodega';

      if (wId === NUNOA_WAREHOUSE_ID) {
        nunoaInvMap[pId] = (nunoaInvMap[pId] || 0) + qty;
      } else {
        if (!otherBranchesMap[pId]) otherBranchesMap[pId] = [];
        otherBranchesMap[pId].push({ name: wName, quantity: qty });
      }
    });

    const requiredMap = {};
    for (const oi of physicalItems) {
      const pId = oi.products.id;
      const qtyReq = parseInt(oi.quantity, 10) || 1;
      requiredMap[pId] = (requiredMap[pId] || 0) + qtyReq;
    }

    for (const pId of Object.keys(requiredMap)) {
      const required = requiredMap[pId];
      const availableNunoa = nunoaInvMap[pId] || 0;
      if (availableNunoa < required) {
        const itemObj = physicalItems.find(oi => oi.products.id === pId);
        
        // Formatear disponibilidad en otras sucursales
        const otherStockList = (otherBranchesMap[pId] || [])
          .filter(b => b.quantity > 0)
          .map(b => `${b.name} (${b.quantity} un)`);
        
        const otherBranchesSummary = otherStockList.length > 0
          ? otherStockList.join(', ')
          : 'Sin stock en otras bodegas';

        stockShortages.push({
          productId: pId,
          sku: itemObj?.products?.sku || 'Sin SKU',
          name: itemObj?.products?.name || 'Producto',
          required,
          availableNunoa,
          otherBranchesSummary
        });
      }
    }
  }

  const nowFormatted = new Date().toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // SI HAY QUIEBRE DE STOCK: FRENAR Y ALERTAR
  if (stockShortages.length > 0) {
    console.log(`⚠️ Pedido ${orderNo} NO TIENE STOCK SUFICIENTE en Sucursal Ñuñoa. Frenando envío a preparación...`);

    const shortagesText = stockShortages.map(s => [
      `• *${s.sku}* - ${s.name}:`,
      `  📍 _Sucursal Ñuñoa:_ ${s.availableNunoa} un (Requerido: ${s.required} un)`,
      `  🏢 _Otras sucursales:_ ${s.otherBranchesSummary}`
    ].join('\n')).join('\n\n');

    const shortageMessage = [
      `⚠️ *ALERTA: PEDIDO RETIRO SIN STOCK SUFICIENTE*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🏷️ *Comercio:* ${order.comercio || 'No asignado'}`,
      `🔢 *Orden:* #${orderNo}`,
      `👤 *Cliente:* ${order.customer_name || 'No informado'}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `❌ *Detalle de Quiebre:*`,
      shortagesText,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⚠️ *Acción Requerida:* El pedido se mantuvo en espera para que el equipo revise el stock antes de procesar.`,
      `🕒 ${nowFormatted}`
    ].join('\n');

    let waResult = null;
    if (!dryRun) {
      console.log(`[AutoPickup] Enviando alerta de quiebre de stock a ${targetGroup}...`);
      waResult = await sendWhatsAppMessage(targetGroup, shortageMessage);
    }

    return {
      success: false,
      hasStockShortage: true,
      dryRun,
      orderNo,
      comercio: order.comercio,
      shortages: stockShortages,
      whatsappResult: waResult,
      message: 'Frenado por stock insuficiente. Alerta de quiebre enviada por Stox.'
    };
  }

  // SI TIENE STOCK SUFICIENTE: PROCEDER CON ENVÍO A PICKING
  console.log(`✅ Pedido ${orderNo} CUMPLE todas las condiciones y TIENE STOCK. Ejecutando automatización...`);

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      orderNo,
      comercio: order.comercio,
      message: 'Validación y Stock exitosos (Modo Simulación)'
    };
  }

  // 3. Acción WMS: Actualizar orden a 'En preparación'
  const updatePayload = {
    estado_wms: 'En preparación',
    agenda: 'RETIRO',
    operador: 'SUCURSAL ÑUÑOA',
    sucursal_pickeo: 'Sucursal Ñuñoa'
  };

  const { error: updateErr } = await wmsClient
    .from('orders')
    .update(updatePayload)
    .eq('id', order.id);

  if (updateErr) throw new Error(`Error actualizando orden en WMS: ${updateErr.message}`);

  // Actualizar warehouse_id de los ítems a Matriz Ñuñoa
  await wmsClient
    .from('order_items')
    .update({ warehouse_id: NUNOA_WAREHOUSE_ID })
    .eq('order_id', order.id);

  // 4. Acción Picker: Insertar en active_orders del Picker
  const totu = physicalItems.reduce((sum, oi) => sum + (parseInt(oi.quantity, 10) || 0), 0) || 1;
  const pickerPayloads = [];

  physicalItems.forEach(oi => {
    const prod = oi.products || {};
    const opt = prod.options || {};
    pickerPayloads.push({
      sucursal: 'Sucursal Ñuñoa',
      order_number: orderNo,
      agenda: 'RETIRO',
      quantity: parseInt(oi.quantity, 10) || 1,
      sku: (prod.send_barcode_to_picker && prod.barcode) ? prod.barcode : (prod.sku || 'SKU-TEMP'),
      name: (prod.send_alias_to_picker && prod.alias && prod.alias.trim()) ? prod.alias.trim() : (prod.name || 'Producto WMS'),
      color: opt.color || null,
      talla: opt.talla || opt.size || null,
      manga: opt.manga || null,
      cuello: opt.cuello || null,
      client_name: order.customer_name || 'Sin nombre',
      tracking: orderNo,
      operator: 'SUCURSAL ÑUÑOA',
      totu: totu,
      sheet_status: 'EN PREPARACIÓN',
      contact_data_q: order.customer_email || '',
      contact_data_r: order.customer_phone || '',
      contact_data_s: order.shipping_address || '',
      contact_data_t: order.shipping_city || '',
      contact_data_u: order.shipping_complement || '',
      extra_col_v: prod.image_url || '',
      comercio: order.comercio || 'STOCKA',
      created_by: 'Stox Bot (AutoPickup)',
      picking_match_strict: prod.picking_match_strict || false
    });
  });

  if (pickerPayloads.length > 0) {
    // Limpiar anteriores si existieran y reinsertar
    await pickerClient.from('active_orders').delete().eq('order_number', orderNo);
    const { error: insPickerErr } = await pickerClient.from('active_orders').insert(pickerPayloads);
    if (insPickerErr) console.error(`[AutoPickup] Error insertando en Picker:`, insPickerErr.message);
  }

  // 5. Registrar en Punto de Retiro (store_pickups / sucursal_pickups)
  const pin = generatePin();
  try {
    const { data: wmsPickupExists } = await wmsClient
      .from('store_pickups')
      .select('id')
      .eq('pedido', orderNo)
      .maybeSingle();

    if (!wmsPickupExists) {
      const { data: maxIdData } = await wmsClient
        .from('store_pickups')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextId = maxIdData ? (parseInt(maxIdData.id, 10) + 1) : 1;

      await wmsClient.from('store_pickups').insert([{
        id: nextId,
        comercio: order.comercio,
        pedido: orderNo,
        nombre_apellido: order.customer_name,
        estado_pedido: 'NO PREPARADO',
        sucursal: 'Sucursal Ñuñoa',
        observaciones: `${order.customer_name || 'Cliente'} | Auto-ingreso Stox WMS`,
        pin_retiro: pin,
        marcar_retirado_web: false,
        avisado_x_mail: false,
        cant_mails_enviados: 0,
        notificado_automatico: false
      }]);
    }
  } catch (e) {
    console.error('[AutoPickup] Error registrando store_pickups:', e.message);
  }

  // 6. Acción WhatsApp: Stox notifica confirmación de auto-procesado
  const notificationText = [
    `📦 *NUEVO PEDIDO AUTO PROCESADO A PICKING*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏷️ *Comercio:* ${order.comercio || 'No asignado'}`,
    `🔢 *Orden:* #${orderNo}`,
    `👤 *Cliente:* ${order.customer_name || 'No informado'}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🚀 *Estado:* Enviado al sistema Picker para preparación inmediata.`,
    `🕒 ${nowFormatted}`
  ].join('\n');

  console.log(`[AutoPickup] Enviando notificación WhatsApp a ${targetGroup}...`);
  const waResult = await sendWhatsAppMessage(targetGroup, notificationText);

  return {
    success: true,
    orderId: order.id,
    orderNo,
    comercio: order.comercio,
    whatsappResult: waResult
  };
}

/**
 * Escanea y procesa todos los pedidos pendientes de retiro que cumplan las condiciones
 */
async function processAllPendingPickups(options = {}) {
  // Validar horario de operaciones (10:00 a 17:30 hrs)
  if (!options.force && !options.ignoreOperatingHours && !isWithinOperatingHours()) {
    const nowTimeStr = new Date().toLocaleTimeString('es-CL', { timeZone: OPERATING_HOURS.timeZone });
    console.log(`[AutoPickup] ⏸️ Fuera de horario operativo (10:00 a 17:30 hrs). Hora actual: ${nowTimeStr}. Los pedidos se procesarán automáticamente a partir de las 10:00 hrs.`);
    return {
      skipped: true,
      reason: `Fuera de horario operativo (10:00 a 17:30 hrs). Hora actual: ${nowTimeStr}`,
      processed: 0,
      results: []
    };
  }

  console.log(`[AutoPickup] Buscando pedidos pendientes de retiro...`);

  const { data: pendingOrders, error } = await wmsClient
    .from('orders')
    .select('id, external_order_number, comercio, created_at')
    .eq('categoria_entrega', 'RETIRO')
    .in('payment_status', ['paid', 'PAID', 'pagado', 'PAGADO'])
    .in('estado_wms', ['En procesamiento', 'Ingresado', 'no procesado'])
    .gte('created_at', AUTO_PICKUP_CUTOFF_DATE)
    .order('created_at', { ascending: false })
    .limit(options.limit || 20);

  if (error) {
    console.error('[AutoPickup] Error buscando órdenes pendientes:', error.message);
    return { error: error.message };
  }

  if (!pendingOrders || pendingOrders.length === 0) {
    console.log('[AutoPickup] No hay pedidos pendientes que requieran procesamiento.');
    return { processed: 0, results: [] };
  }

  console.log(`[AutoPickup] Encontrados ${pendingOrders.length} pedidos potenciales.`);
  const results = [];

  for (const o of pendingOrders) {
    try {
      const res = await autoProcessSinglePickupOrder(o.id, options);
      results.push({ id: o.id, orderNo: o.external_order_number, result: res });
    } catch (err) {
      console.error(`[AutoPickup] Error procesando ${o.external_order_number}:`, err.message);
      results.push({ id: o.id, orderNo: o.external_order_number, error: err.message });
    }
  }

  return { processed: results.length, results };
}

module.exports = {
  autoProcessSinglePickupOrder,
  processAllPendingPickups,
  NUNOA_WAREHOUSE_ID,
  DEFAULT_GROUP_JID
};
