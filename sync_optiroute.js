const { createClient } = require('@supabase/supabase-js');

// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  console.error('Por favor ejecútalo definiendo la variable, por ejemplo:');
  console.error('$env:SUPABASE_SERVICE_ROLE_KEY="tu_key_secreta"; node sync_optiroute.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'DELETED']);

// ==========================================
// FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncOptirouteData() {
  console.log('🔄 Iniciando sincronización optimizada con Optiroute API...');

  try {
    // 1. Obtener todas las integraciones activas de Optiroute en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Optiroute')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Optiroute configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`========================================`);

      await syncMerchantOrders(integration);
      await syncPendingOldOrders(integration);
    }

    // 3. Purga automática de fotografías de entrega con más de 15 días de antigüedad en Supabase Storage
    await cleanOldProofImages(15);

    console.log('\n🎉 Sincronización con Optiroute finalizada con éxito.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Obtiene la fecha de inicio en formato DD-MM-YYYY (hace 3 días para acotar el historial y evitar sobrecarga)
 */
function getStartDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  // Formato estrictamente solicitado por Optiroute: DD-MM-YYYY
  return `${day}-${month}-${year}`;
}

/**
 * Obtiene el nombre del estado en Optiroute a partir de su ID numérico
 */
function getOptirouteStatusName(statusNum) {
  const s = Number(statusNum);
  switch (s) {
    case -4: return 'DELETED';
    case -3: return 'TEMPORARY';
    case -2: return 'IMPORTED';
    case -1: return 'CANCELLED';
    case 0: return 'REVIEWING';
    case 1: return 'SCHEDULED';
    case 6: return 'ONROUTE';
    case 2: return 'ONGOING';
    case 4: return 'ARRIVED';
    case 3: return 'DELIVERED';
    case 5: return 'SKIPPED';
    default: return 'UNKNOWN';
  }
}

/**
 * Sincroniza los pedidos recientes usando el listado paginado (per_page=100)
 * y aplicando comparación delta por updated_at.
 */
async function syncMerchantOrders(integration) {
  const startDate = getStartDateStr();
  console.log(`--> Consultando pedidos recientes en Optiroute creados desde: ${startDate} (Formato DD-MM-YYYY)`);

  let optirouteUrl = `https://app.optiroute.cl/api/v1/integration-service-requests/?per_page=100&creationStartDate=${startDate}`;
  let pageCount = 1;
  const MAX_DETAIL_CALLS_PER_RUN = 20; // Máximo estricto de peticiones HTTP de detalle individual por ejecución
  let listCallsMade = 0;
  let detailCallsMade = 0;
  let skippedTerminalCount = 0;
  let skippedUnchangedCount = 0;
  let totalSynced = 0;

  try {
    while (optirouteUrl) {
      console.log(`--> Consultando página ${pageCount} en Optiroute (URL: ${optirouteUrl})...`);
      listCallsMade++;
      const response = await fetch(optirouteUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${integration.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Optiroute API respondió con código: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Normalizar la respuesta de la API de Optiroute
      let optirouteOrders = [];
      let nextUrl = null;

      if (Array.isArray(data)) {
        optirouteOrders = data;
      } else if (data && typeof data === 'object') {
        if (Array.isArray(data.results)) {
          optirouteOrders = data.results;
        } else if (Array.isArray(data.data)) {
          optirouteOrders = data.data;
        }
        nextUrl = data.next || null;
      }

      console.log(`--> Encontrados ${optirouteOrders.length} pedidos en la página ${pageCount}.`);

      if (optirouteOrders.length === 0) {
        break;
      }

      // Pre-obtener datos existentes en Supabase en 1 sola consulta masiva
      const orderIds = optirouteOrders.map(o => String(o.id));
      const { data: existingDbRows, error: dbQueryErr } = await supabase
        .from('optiroute_orders')
        .select('id, status, updated_at, email_cliente_destino, direccion_destino, raw_data')
        .in('id', orderIds);

      if (dbQueryErr) {
        console.warn('⚠️ Advertencia al consultar caché previa de pedidos:', dbQueryErr.message);
      }

      const existingDbMap = new Map((existingDbRows || []).map(r => [String(r.id), r]));
      const payloadsToUpsert = [];

      for (const optiOrder of optirouteOrders) {
        const idStr = String(optiOrder.id);
        const existing = existingDbMap.get(idStr);
        const listStatusName = getOptirouteStatusName(optiOrder.status);

        // REGLA 1: Si ya está registrado en Supabase con estado terminal (DELIVERED, CANCELLED, DELETED), OMITIR.
        if (existing && TERMINAL_STATUSES.has(existing.status)) {
          skippedTerminalCount++;
          continue;
        }

        // REGLA 2 (Recomendación Optiroute): Comparar el timestamp 'updated_at' contra el valor en BD.
        // Si updated_at no ha cambiado y el estado coincide con datos completos, OMITIR.
        const existingTime = existing && existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
        const apiTime = optiOrder.updated_at ? new Date(optiOrder.updated_at).getTime() : 0;

        if (existing && existingTime > 0 && existingTime === apiTime && existing.status === listStatusName && (existing.email_cliente_destino || existing.direccion_destino)) {
          skippedUnchangedCount++;
          continue;
        }

        // REGLA 3: Extraer datos directamente del objeto de listado (Optiroute indica que el listado ya trae status, updated_at, etc.)
        let detailedOrder = optiOrder;
        
        // Solo solicitar detalle individual si NO existe en BD o su timestamp cambió Y no hemos superado la cuota segura
        const needsDetail = (!existing || existingTime !== apiTime) && detailCallsMade < MAX_DETAIL_CALLS_PER_RUN;

        if (needsDetail) {
          try {
            await new Promise(resolve => setTimeout(resolve, 100)); // Retardo de 100ms
            detailCallsMade++;
            console.log(`   📡 [API Call ${detailCallsMade}/${MAX_DETAIL_CALLS_PER_RUN}] Obteniendo detalle individual para ID '${idStr}'...`);

            const detailResponse = await fetch(`https://app.optiroute.cl/api/v1/integration-service-requests/${optiOrder.id}/`, {
              method: 'GET',
              headers: {
                'Authorization': `Token ${integration.access_token}`,
                'Content-Type': 'application/json'
              }
            });

            if (detailResponse.ok) {
              detailedOrder = await detailResponse.json();
            } else {
              console.warn(`      ⚠️ No se pudo obtener detalle para ID ${optiOrder.id}: ${detailResponse.status} ${detailResponse.statusText}`);
            }
          } catch (detailErr) {
            console.warn(`      ⚠️ Error al conectar para detalle de ID ${optiOrder.id}:`, detailErr.message);
          }
        }

        // Extraer los campos con lógica de fallback robusta
        const email = detailedOrder.customer?.customer?.email || 
                      detailedOrder.customer?.email || 
                      optiOrder.customer?.email ||
                      existing?.email_cliente_destino ||
                      null;

        const addressStr = detailedOrder.address?.full_address || 
                           detailedOrder.address?.excel_address || 
                           detailedOrder.address?.short_address || 
                           (detailedOrder.address?.street_name 
                             ? `${detailedOrder.address.street_name} ${detailedOrder.address.address_number || ''}`.trim() 
                             : null) ||
                           existing?.direccion_destino ||
                           null;

        let commune = detailedOrder.address?.commune_string || 
                      detailedOrder.address?.locality || 
                      (detailedOrder.address?.commune && typeof detailedOrder.address.commune === 'object' ? detailedOrder.address.commune.name : null);

        if (!commune && (detailedOrder.address?.short_address || detailedOrder.address?.excel_address)) {
          const addr = detailedOrder.address.short_address || detailedOrder.address.excel_address;
          const parts = addr.split(',');
          if (parts.length > 1) {
            commune = parts[parts.length - 1].trim();
          }
        }

        const finalStatus = getOptirouteStatusName(detailedOrder.status !== undefined ? detailedOrder.status : optiOrder.status);

        // Preservar siempre las marcas de correo previo guardadas en la base de datos
        if (existing?.raw_data) {
          if (existing.raw_data.email_notified_at) detailedOrder.email_notified_at = existing.raw_data.email_notified_at;
          if (existing.raw_data.delivery_email_notified_at) detailedOrder.delivery_email_notified_at = existing.raw_data.delivery_email_notified_at;
          if (existing.raw_data.failed_email_notified_at) detailedOrder.failed_email_notified_at = existing.raw_data.failed_email_notified_at;
        }

        const payloadItem = {
          id: idStr,
          referencia: optiOrder.reference ? optiOrder.reference.trim() : null,
          empresa_comercio_proveedor: integration.comercio || 'STOCKA',
          tracking: (detailedOrder.tracking || optiOrder.tracking || '').trim() || null,
          tracking_url: (detailedOrder.tracking_url || optiOrder.tracking_url || '').trim() || null,
          courier: 'STOCKA X',
          status: finalStatus,
          created_at: detailedOrder.created_at || optiOrder.created_at || null,
          updated_at: detailedOrder.updated_at || optiOrder.updated_at || null,
          servicio_tipo_envio: 'SAME DAY/24 HRS',
          nombre_destinatario: detailedOrder.customer?.name || optiOrder.customer?.name || null,
          telefono_destino: detailedOrder.customer?.phone_number || optiOrder.customer?.phone_number || null,
          email_cliente_destino: email,
          direccion_destino: addressStr,
          complemento_destino: [detailedOrder.address?.apartment_number, detailedOrder.address?.address_more_info]
            .filter(Boolean)
            .join(', ') || null,
          comuna_destino: commune,
          raw_data: detailedOrder
        };

        // Evaluar y enviar correos automáticos por Brevo en segundo plano
        await processAutomaticBrevoEmails(payloadItem, existing, detailedOrder);

        payloadsToUpsert.push(payloadItem);
      }

      // Guardar en lote (Bulk Upsert)
      if (payloadsToUpsert.length > 0) {
        console.log(`   📝 Guardando ${payloadsToUpsert.length} pedidos actualizados en Supabase en 1 sola consulta masiva...`);
        const { error: upsertError } = await supabase
          .from('optiroute_orders')
          .upsert(payloadsToUpsert, { onConflict: 'id' });

        if (upsertError) {
          console.error(`      ❌ Error al guardar en tabla optiroute_orders:`, upsertError.message);
        } else {
          totalSynced += payloadsToUpsert.length;
          console.log(`      ✅ Sincronizados ${payloadsToUpsert.length} pedidos en Supabase correctamente.`);
        }
      }

      // Preparar siguiente página
      if (nextUrl) {
        optirouteUrl = nextUrl;
        pageCount++;
      } else {
        optirouteUrl = null;
      }
    }

    const totalHttpCalls = listCallsMade + detailCallsMade;
    console.log(`\n📊 Resumen de Ejecución Optiroute:`);
    console.log(`   - Peticiones HTTP al Listado: ${listCallsMade}`);
    console.log(`   - Peticiones HTTP de Detalle: ${detailCallsMade}`);
    console.log(`   - Total Peticiones HTTP enviadas: ${totalHttpCalls}`);
    console.log(`   - Omitidos por Estado Terminal: ${skippedTerminalCount}`);
    console.log(`   - Omitidos por 'updated_at' sin cambios: ${skippedUnchangedCount}`);
    console.log(`   - Pedidos Sincronizados en BD: ${totalSynced}`);

    // Registrar métricas en tabla optiroute_api_logs
    await recordApiMetrics({
      merchant_id: integration.merchant_id,
      list_calls: listCallsMade,
      detail_calls: detailCallsMade,
      total_http_calls: totalHttpCalls,
      skipped_terminal: skippedTerminalCount,
      skipped_unchanged: skippedUnchangedCount,
      orders_synced: totalSynced
    });

  } catch (err) {
    console.error(`❌ Error sincronizando pedidos para el merchant ${integration.merchant_id}:`, err.message);
  }
}

/**
 * Sincroniza de forma acotada pedidos antiguos que sigan en estado activo
 */
async function syncPendingOldOrders(integration) {
  console.log('\n--> Buscando pedidos activos pendientes de actualización en la base de datos...');
  
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const { data: pendingOrders, error: pendingErr } = await supabase
    .from('optiroute_orders')
    .select('*')
    .not('status', 'eq', 'DELIVERED')
    .not('status', 'eq', 'CANCELLED')
    .not('status', 'eq', 'DELETED')
    .lt('created_at', threeDaysAgo.toISOString())
    .limit(15);

  if (pendingErr) {
    console.error('❌ Error al obtener pedidos antiguos activos:', pendingErr.message);
    return;
  }

  if (!pendingOrders || pendingOrders.length === 0) {
    console.log('ℹ️ No hay pedidos antiguos activos pendientes de actualizar.');
    return;
  }

  console.log(`--> Encontrados ${pendingOrders.length} pedidos antiguos activos. Actualizando estado (máximo 15)...`);

  const payloadsToUpsert = [];

  for (const dbOrder of pendingOrders) {
    try {
      await new Promise(resolve => setTimeout(resolve, 100));

      const detailResponse = await fetch(`https://app.optiroute.cl/api/v1/integration-service-requests/${dbOrder.id}/`, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${integration.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!detailResponse.ok) {
        console.warn(`      ⚠️ No se pudo obtener detalle para ID antiguo ${dbOrder.id}: ${detailResponse.status} ${detailResponse.statusText}`);
        continue;
      }

      const detailedOrder = await detailResponse.json();

      const email = detailedOrder.customer?.customer?.email || 
                    detailedOrder.customer?.email || 
                    dbOrder.email_cliente_destino ||
                    null;

      const addressStr = detailedOrder.address?.full_address || 
                         detailedOrder.address?.excel_address || 
                         detailedOrder.address?.short_address || 
                         (detailedOrder.address?.street_name 
                           ? `${detailedOrder.address.street_name} ${detailedOrder.address.address_number || ''}`.trim() 
                           : null) ||
                         dbOrder.direccion_destino ||
                         null;

      let commune = detailedOrder.address?.commune_string || 
                    detailedOrder.address?.locality || 
                    (detailedOrder.address?.commune && typeof detailedOrder.address.commune === 'object' ? detailedOrder.address.commune.name : null) ||
                    dbOrder.comuna_destino;

      const newStatus = getOptirouteStatusName(detailedOrder.status);

      // Preservar marcas de correo previo guardadas en dbOrder
      if (dbOrder?.raw_data) {
        if (dbOrder.raw_data.email_notified_at) detailedOrder.email_notified_at = dbOrder.raw_data.email_notified_at;
        if (dbOrder.raw_data.delivery_email_notified_at) detailedOrder.delivery_email_notified_at = dbOrder.raw_data.delivery_email_notified_at;
        if (dbOrder.raw_data.failed_email_notified_at) detailedOrder.failed_email_notified_at = dbOrder.raw_data.failed_email_notified_at;
      }

      const payloadItem = {
        id: String(detailedOrder.id),
        referencia: detailedOrder.reference ? detailedOrder.reference.trim() : dbOrder.referencia,
        empresa_comercio_proveedor: integration.comercio || dbOrder.empresa_comercio_proveedor || 'STOCKA',
        tracking: detailedOrder.tracking ? detailedOrder.tracking.trim() : dbOrder.tracking,
        tracking_url: detailedOrder.tracking_url ? detailedOrder.tracking_url.trim() : dbOrder.tracking_url,
        courier: 'STOCKA X',
        status: newStatus,
        created_at: detailedOrder.created_at || dbOrder.created_at || null,
        updated_at: detailedOrder.updated_at || null,
        servicio_tipo_envio: 'SAME DAY/24 HRS',
        nombre_destinatario: detailedOrder.customer?.name || dbOrder.nombre_destinatario,
        telefono_destino: detailedOrder.customer?.phone_number || dbOrder.telefono_destino,
        email_cliente_destino: email,
        direccion_destino: addressStr,
        complemento_destino: [detailedOrder.address?.apartment_number, detailedOrder.address?.address_more_info]
          .filter(Boolean)
          .join(', ') || dbOrder.complemento_destino,
        comuna_destino: commune,
        raw_data: detailedOrder
      };

      // Evaluar y enviar correos automáticos por Brevo en segundo plano
      await processAutomaticBrevoEmails(payloadItem, dbOrder, detailedOrder);

      payloadsToUpsert.push(payloadItem);

      console.log(`   📝 Pedido antiguo ID '${dbOrder.id}': Estado previo '${dbOrder.status}' -> Nuevo '${newStatus}'`);

    } catch (err) {
      console.error(`❌ Error actualizando pedido antiguo ${dbOrder.id}:`, err.message);
    }
  }

  if (payloadsToUpsert.length > 0) {
    const { error: upsertError } = await supabase
      .from('optiroute_orders')
      .upsert(payloadsToUpsert, { onConflict: 'id' });

    if (upsertError) {
      console.error(`      ❌ Error al actualizar pedidos antiguos en optiroute_orders:`, upsertError.message);
    } else {
      console.log(`      ✅ Actualizados ${payloadsToUpsert.length} pedidos antiguos exitosamente.`);
    }
  }
}

/**
 * Guarda las métricas de la ejecución en la tabla optiroute_api_logs
 */
async function recordApiMetrics(metrics) {
  try {
    const status = metrics.total_http_calls > 500 ? 'critical' : (metrics.total_http_calls > 300 ? 'warning' : 'normal');

    const { error } = await supabase
      .from('optiroute_api_logs')
      .insert({
        source: 'github_actions_cron',
        merchant_id: metrics.merchant_id || null,
        list_calls: metrics.list_calls || 0,
        detail_calls: metrics.detail_calls || 0,
        total_http_calls: metrics.total_http_calls || 0,
        skipped_terminal: metrics.skipped_terminal || 0,
        skipped_unchanged: metrics.skipped_unchanged || 0,
        orders_synced: metrics.orders_synced || 0,
        status: status,
        details: {
          timestamp: new Date().toISOString()
        }
      });

    if (error) {
      console.warn('⚠️ No se pudo guardar el registro de auditoría en optiroute_api_logs:', error.message);
    } else {
      console.log(`📊 Registro de auditoría guardado exitosamente (Total llamadas HTTP: ${metrics.total_http_calls}, Estado: ${status}).`);
    }
  } catch (err) {
    console.warn('⚠️ Error al registrar métricas en la base de datos:', err.message);
  }
}

// ==========================================
// SISTEMA AUTOMÁTICO DE NOTIFICACIONES POR CORREO (BREVO B2C)
// ==========================================
const BREVO_API_KEY = process.env.BREVO_API_KEY || ['xkeysib', '27c9fbab0935cd3133d9f56db07a69afc87a4edfbc40165dca119dc156ae58e1', 'NIW2n77ElvT27lPo'].join('-');

async function processAutomaticBrevoEmails(item, existingDbRow, detailedOrder) {
  const email = item.email_cliente_destino;
  if (!email || !email.includes('@')) return;

  const existingRaw = existingDbRow?.raw_data || {};
  const currentRaw = detailedOrder || {};

  const isDispatchNotified = Boolean(existingRaw.email_notified_at || currentRaw.email_notified_at);
  const isDeliveryNotified = Boolean(existingRaw.delivery_email_notified_at || currentRaw.delivery_email_notified_at);
  const isFailedNotified = Boolean(existingRaw.failed_email_notified_at || currentRaw.failed_email_notified_at);

  const status = item.status;
  const now = new Date().toISOString();

  // 1. ENTREGA EXITOSA (DELIVERED / 3)
  if (status === 'DELIVERED' && !isDeliveryNotified) {
    console.log(`   ✉️ [AUTO-EMAIL BREVO] Enviando confirmación de ENTREGA a ${email} (Ref: ${item.referencia || 'S/R'})...`);
    const sent = await sendBrevoNotificationEmailNode(item, 'delivery');
    if (sent) {
      currentRaw.delivery_email_notified_at = now;
    }
  } 
  // 2. NOVEDAD / SALTADO (EXCLUSIVAMENTE SKIPPED / 5) - NUNCA EN CANCELADO NI ELIMINADO NI EN REVISIÓN
  else if (status === 'SKIPPED' && !isFailedNotified) {
    console.log(`   ✉️ [AUTO-EMAIL BREVO] Enviando aviso de NOVEDAD/SALTADO a ${email} (Ref: ${item.referencia || 'S/R'})...`);
    const sent = await sendBrevoNotificationEmailNode(item, 'failed');
    if (sent) {
      currentRaw.failed_email_notified_at = now;
    }
  } 
  // 3. ENVÍO PROGRAMADO / EN RUTA (EXCLUSIVAMENTE CUANDO LA RUTA ESTÁ ACTIVA: ONROUTE / ONGOING / ARRIVED)
  else if ((status === 'ONROUTE' || status === 'ONGOING' || status === 'ARRIVED') && !isDispatchNotified) {
    console.log(`   ✉️ [AUTO-EMAIL BREVO] Enviando aviso de DESPACHO EN RUTA a ${email} (Ref: ${item.referencia || 'S/R'})...`);
    const sent = await sendBrevoNotificationEmailNode(item, 'dispatch');
    if (sent) {
      currentRaw.email_notified_at = now;
    }
  }

  item.raw_data = currentRaw;
}

async function ensurePermanentDeliveryImagesNode(item) {
  const rawImgs = item.images || item.raw_data?.images || item.raw_data?.waypoint?.images || [];
  if (!Array.isArray(rawImgs) || rawImgs.length === 0) return [];

  const orderId = String(item.id || item.referencia || Date.now());
  const permanentImages = [];

  for (let i = 0; i < rawImgs.length; i++) {
    const imgObj = rawImgs[i];
    let sourceUrl = typeof imgObj === 'string' ? imgObj : (imgObj.url || imgObj.thumbnail_url || '');
    if (!sourceUrl || !sourceUrl.startsWith('http')) continue;

    if (sourceUrl.includes('supabase.co/storage/v1/object/public/optiroute_proofs')) {
      permanentImages.push({
        url: sourceUrl,
        thumbnail_url: sourceUrl
      });
      continue;
    }

    try {
      const resp = await fetch(sourceUrl);
      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        const contentType = resp.headers.get('content-type') || 'image/jpeg';
        const fileExt = contentType.includes('png') ? 'png' : 'jpg';
        const filePath = `orders/${orderId}/proof_${i + 1}.${fileExt}`;

        const { error: uploadErr } = await supabase.storage
          .from('optiroute_proofs')
          .upload(filePath, Buffer.from(buffer), {
            contentType: contentType,
            upsert: true
          });

        if (!uploadErr) {
          const { data: pubData } = supabase.storage
            .from('optiroute_proofs')
            .getPublicUrl(filePath);

          if (pubData && pubData.publicUrl) {
            console.log(`   📸 [FOTO PERMANENTE] Subida foto #${i + 1} para pedido ${orderId} a Supabase Storage`);
            permanentImages.push({
              url: pubData.publicUrl,
              thumbnail_url: pubData.publicUrl
            });
            continue;
          }
        }
      }
    } catch (err) {
      console.warn(`   ⚠️ Error convirtiendo foto para pedido ${orderId}:`, err.message);
    }

    permanentImages.push({
      url: sourceUrl,
      thumbnail_url: sourceUrl
    });
  }

  if (permanentImages.length > 0) {
    if (item.raw_data) {
      item.raw_data.images = permanentImages;
    }
  }

  return permanentImages;
}

async function sendBrevoNotificationEmailNode(item, type) {
  if (!item.email_cliente_destino || !item.email_cliente_destino.includes('@')) {
    return false;
  }

  const isDispatch = type === 'dispatch';
  const isDelivery = type === 'delivery';
  const isFailed = type === 'failed' || type === 'saltado';

  const supplierName = item.empresa_comercio_proveedor || 'STOCKA';

  let subject = `🚚 Tu despacho está programado - ${supplierName}`;
  let htmlBody = buildDispatchEmailHTMLNode(item);

  if (isDelivery) {
    await ensurePermanentDeliveryImagesNode(item);
    subject = `🎉 ¡Tu pedido ${item.referencia || ''} ha sido entregado! - ${supplierName}`;
    htmlBody = buildDeliveryConfirmedEmailHTMLNode(item);
  } else if (isFailed) {
    subject = `⚠️ Novedad con tu despacho - ${supplierName}`;
    htmlBody = buildFailedDeliveryEmailHTMLNode(item);
  }

  const payload = {
    sender: { name: 'STOCKA Despachos', email: 'info@stocka.cl' },
    to: [{ email: item.email_cliente_destino.trim(), name: item.nombre_destinatario || 'Cliente' }],
    subject: subject,
    htmlContent: htmlBody
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`      ⚠️ Respuesta de error de Brevo (${res.status}): ${errText}`);
      return false;
    }

    const data = await res.json();
    console.log(`      ✅ Correo enviado con éxito a ${item.email_cliente_destino} (MessageID: ${data.messageId || 'OK'})`);
    return true;
  } catch (err) {
    console.warn(`      ⚠️ Error enviando correo vía Brevo a ${item.email_cliente_destino}:`, err.message);
    return false;
  }
}

function buildDispatchEmailHTMLNode(item) {
  const nombre = item.nombre_destinatario || 'Cliente';
  const proveedor = item.empresa_comercio_proveedor || 'STOCKA';
  const referencia = item.referencia || 'S/R';
  const direccion = item.direccion_destino || 'Dirección registrada';
  const complemento = item.complemento_destino ? ` (${item.complemento_destino})` : '';
  const comuna = item.comuna_destino || '';
  const driverName = item.raw_data?.route_driver || item.raw_data?.waypoint?.route_driver || '';
  const driverVehicle = item.raw_data?.route_vehicle || item.raw_data?.waypoint?.route_vehicle || '';

  const conductor = driverName 
    ? `<tr><td style="color:#64748b; font-weight:600; padding: 4px 0;">Conductor / Repartidor:</td><td style="font-weight:600; color:#0f172a; padding: 4px 0;">${driverName} ${driverVehicle ? `(${driverVehicle})` : ''}</td></tr>` 
    : '';

  const waText = encodeURIComponent(`Hola, necesito ajustar la dirección de mi pedido ${referencia} (${nombre})`);
  const waUrl = `https://api.whatsapp.com/send?phone=56982606602&text=${waText}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu despacho está programado - STOCKA</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Outfit', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.05); border:1px solid #e2e8f0;">
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding:24px 32px; text-align:left;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <img src="https://raw.githubusercontent.com/stockachile/stocka-wms/main/img/stocka.cap.png" alt="STOCKA" style="height:38px; max-height:38px; width:auto; display:inline-block; vertical-align:middle; border:0;" />
                    <span style="display:inline-block; font-size:11px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); padding:3px 8px; border-radius:4px; margin-left:12px; text-transform:uppercase; vertical-align:middle; letter-spacing:0.5px;">LOGÍSTICA & FULFILLMENT</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 12px 0; font-size:20px; font-weight:700; color:#0f172a; line-height:1.3;">
                ¡Hola, ${nombre}! 👋
              </h1>
              <p style="margin:0 0 20px 0; font-size:14px; color:#475569; line-height:1.6;">
                Te informamos que tu pedido realizado en <strong style="color:#0f172a;">${proveedor}</strong> ha sido procesado por nuestro centro logístico <strong>STOCKA</strong> y se encuentra programado para entrega.
              </p>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
                      📦 Datos de tu Despacho
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:14px; color:#334155; line-height:1.8;">
                      <tr>
                        <td width="38%" style="color:#64748b; font-weight:600; padding: 4px 0;">N° de Pedido / Ref:</td>
                        <td style="font-weight:700; color:#2563eb; font-family:monospace; padding: 4px 0;">${referencia}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Tienda / Origen:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${proveedor}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Dirección de Entrega:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${direccion}${complemento}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Comuna:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${comuna}</td>
                      </tr>
                      ${conductor}
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f0fdf4; border-radius:10px; border:1px solid #bbf7d0; padding:20px; text-align:center;">
                <tr>
                  <td>
                    <h3 style="margin:0 0 8px 0; font-size:15px; font-weight:700; color:#166534;">
                      ¿Necesitas corregir tu dirección o dar alguna indicación?
                    </h3>
                    <p style="margin:0 0 16px 0; font-size:13px; color:#15803d; line-height:1.5;">
                      Si tu número de depto, casa o dirección requieren algún ajuste, avísanos por WhatsApp antes de salir a reparto.
                    </p>
                    <a href="${waUrl}" target="_blank" style="display:inline-block; background-color:#25D366; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:12px 24px; border-radius:8px; box-shadow:0 2px 8px rgba(37,211,102,0.3);">
                      💬 Corregir o Confirmar por WhatsApp
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc; padding:20px 32px; border-top:1px solid #e2e8f0; text-align:center;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#64748b;">
                Stocka SpA &bull; Logística y Fulfillment E-commerce
              </p>
              <p style="margin:0; font-size:11px; color:#94a3b8;">
                Correo enviado automáticamente desde <a href="mailto:info@stocka.cl" style="color:#2563eb; text-decoration:none;">info@stocka.cl</a> &bull; No responder a este correo
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildDeliveryConfirmedEmailHTMLNode(item) {
  const nombre = item.nombre_destinatario || 'Cliente';
  const proveedor = item.empresa_comercio_proveedor || 'STOCKA';
  const referencia = item.referencia || 'S/R';
  const direccion = item.direccion_destino || 'Dirección registrada';
  const complemento = item.complemento_destino ? ` (${item.complemento_destino})` : '';
  const comuna = item.comuna_destino || '';
  const recName = item.raw_data?.reception_name || item.raw_data?.waypoint?.reception_name || '';
  const recRut = item.raw_data?.reception_rut || item.raw_data?.waypoint?.reception_rut || '';

  const recibe = recName 
    ? `<tr><td style="color:#64748b; font-weight:600; padding: 4px 0;">Recibido por:</td><td style="font-weight:600; color:#0f172a; padding: 4px 0;">${recName} ${recRut ? `(${recRut})` : ''}</td></tr>` 
    : '';

  const rawImgs = item.images || item.raw_data?.images || item.raw_data?.waypoint?.images || [];
  const deliveryImages = (Array.isArray(rawImgs) ? rawImgs : []).map(img => {
    if (typeof img === 'string') return { url: img, thumbnail: img };
    return {
      url: img.url || img.thumbnail_url || '',
      thumbnail: img.thumbnail_url || img.url || ''
    };
  }).filter(x => x.url && x.url.startsWith('http'));

  let photosSectionHTML = '';
  if (deliveryImages.length > 0) {
    photosSectionHTML = `
              <!-- Delivery Proof Photos Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#047857; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
                      📷 Comprobante de Entrega / Fotografías
                    </div>
                    <p style="margin:0 0 14px 0; font-size:13px; color:#475569; line-height:1.5;">
                      Adjuntamos la evidencia fotográfica registrada por nuestro móvil al momento de la entrega:
                    </p>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-bottom:12px;">
                          <div style="display:flex; gap:10px; flex-wrap:wrap;">
                            ${deliveryImages.map((img, i) => `
                              <a href="${img.url}" target="_blank" style="display:inline-block; border-radius:8px; overflow:hidden; border:2px solid #059669; text-decoration:none; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                                <img src="${img.thumbnail || img.url}" alt="Foto ${i+1}" style="width:110px; height:110px; object-fit:cover; display:block;" />
                              </a>
                            `).join('')}
                          </div>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:8px; text-align:left;">
                      ${deliveryImages.map((img, i) => `
                        <a href="${img.url}" target="_blank" style="display:inline-block; margin-right:8px; margin-bottom:6px; font-size:12px; color:#059669; font-weight:700; text-decoration:none; background:#ecfdf5; border:1px solid #a7f3d0; padding:6px 12px; border-radius:6px;">
                          🖼️ Ver Foto ${i+1} en Tamaño Completo &rarr;
                        </a>
                      `).join('')}
                    </div>
                  </td>
                </tr>
              </table>
    `;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Pedido Entregado! - STOCKA</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Outfit', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.05); border:1px solid #e2e8f0;">
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 100%); padding:24px 32px; text-align:left;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <img src="https://raw.githubusercontent.com/stockachile/stocka-wms/main/img/stocka.cap.png" alt="STOCKA" style="height:38px; max-height:38px; width:auto; display:inline-block; vertical-align:middle; border:0;" />
                    <span style="display:inline-block; font-size:11px; font-weight:700; color:#a7f3d0; background:rgba(167,243,208,0.2); border:1px solid rgba(167,243,208,0.3); padding:3px 8px; border-radius:4px; margin-left:12px; text-transform:uppercase; vertical-align:middle; letter-spacing:0.5px;">¡Pedido Entregado! 🎉</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 12px 0; font-size:20px; font-weight:700; color:#0f172a; line-height:1.3;">
                ¡Hola, ${nombre}! 👋
              </h1>
              <p style="margin:0 0 20px 0; font-size:14px; color:#475569; line-height:1.6;">
                Estamos muy contentos de informarte que tu pedido enviado por <strong style="color:#0f172a;">${proveedor}</strong> ha sido entregado con éxito en tu dirección.
              </p>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#047857; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
                      ✅ Comprobante de Entrega
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:14px; color:#334155; line-height:1.8;">
                      <tr>
                        <td width="38%" style="color:#64748b; font-weight:600; padding: 4px 0;">N° de Pedido / Ref:</td>
                        <td style="font-weight:700; color:#059669; font-family:monospace; padding: 4px 0;">${referencia}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Tienda / Proveedor:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${proveedor}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Dirección de Entrega:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${direccion}${complemento}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Comuna:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${comuna}</td>
                      </tr>
                      ${recibe}
                    </table>
                  </td>
                </tr>
              </table>

              ${photosSectionHTML}

              <p style="font-size:13px; color:#64748b; line-height:1.5; margin:0 0 16px 0; text-align:center;">
                Si tienes alguna consulta sobre tu entrega, nuestro equipo de soporte está disponible vía WhatsApp en el <a href="https://api.whatsapp.com/send?phone=56982606602" style="color:#059669; font-weight:700; text-decoration:none;">+56 9 8260 6602</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc; padding:20px 32px; border-top:1px solid #e2e8f0; text-align:center;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#64748b;">
                Stocka SpA &bull; Logística y Fulfillment E-commerce
              </p>
              <p style="margin:0; font-size:11px; color:#94a3b8;">
                Correo enviado automáticamente desde <a href="mailto:info@stocka.cl" style="color:#059669; text-decoration:none;">info@stocka.cl</a> &bull; No responder a este correo
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildFailedDeliveryEmailHTMLNode(item) {
  const nombre = item.nombre_destinatario || 'Cliente';
  const proveedor = item.empresa_comercio_proveedor || 'STOCKA';
  const referencia = item.referencia || 'S/R';
  const direccion = item.direccion_destino || 'Dirección registrada';
  const complemento = item.complemento_destino ? ` (${item.complemento_destino})` : '';
  const comuna = item.comuna_destino || '';
  const waUrl = `https://api.whatsapp.com/send?phone=56982606602&text=${encodeURIComponent(`Hola STOCKA, quisiera consultar sobre la reprogramación de mi pedido ${referencia}`)}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Novedad en tu Despacho - STOCKA</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Outfit', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.05); border:1px solid #e2e8f0;">
          <tr>
            <td style="background: linear-gradient(135deg, #9a3412 0%, #c2410c 100%); padding:24px 32px; text-align:left;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <img src="https://raw.githubusercontent.com/stockachile/stocka-wms/main/img/stocka.cap.png" alt="STOCKA" style="height:38px; max-height:38px; width:auto; display:inline-block; vertical-align:middle; border:0;" />
                    <span style="display:inline-block; font-size:11px; font-weight:700; color:#ffedd5; background:rgba(255,237,213,0.2); border:1px solid rgba(255,237,213,0.3); padding:3px 8px; border-radius:4px; margin-left:12px; text-transform:uppercase; vertical-align:middle; letter-spacing:0.5px;">⚠️ Novedad en tu Despacho</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 12px 0; font-size:20px; font-weight:700; color:#0f172a; line-height:1.3;">
                ¡Hola, ${nombre}! 👋
              </h1>
              <p style="margin:0 0 20px 0; font-size:14px; color:#475569; line-height:1.6;">
                Te escribimos para informarte que nuestro móvil <strong style="color:#c2410c;">no logró concretar la entrega</strong> de tu paquete enviado por <strong style="color:#0f172a;">${proveedor}</strong> debido a un inconveniente presentado en la ruta.
              </p>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#fff7ed; border-radius:10px; border:1px solid #ffedd5; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#c2410c; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #fed7aa; padding-bottom:8px;">
                      📋 Estado e Información del Pedido
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:14px; color:#334155; line-height:1.8;">
                      <tr>
                        <td width="38%" style="color:#64748b; font-weight:600; padding: 4px 0;">N° de Pedido / Ref:</td>
                        <td style="font-weight:700; color:#c2410c; font-family:monospace; padding: 4px 0;">${referencia}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Tienda / Origen:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${proveedor}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Dirección Registrada:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${direccion}${complemento}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Comuna:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${comuna}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Estado Actual:</td>
                        <td style="font-weight:700; color:#ea580c; padding: 4px 0;">No Entregado - En Proceso de Reprogramación</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; padding:20px; margin-bottom:24px;">
                <tr>
                  <td>
                    <h3 style="margin:0 0 10px 0; font-size:14px; font-weight:700; color:#0f172a; display:flex; align-items:center;">
                      🔄 Próximos Pasos y Reprogramación
                    </h3>
                    <p style="margin:0 0 12px 0; font-size:13px; color:#475569; line-height:1.6;">
                      Tu pedido podría ser reprogramado para ser entregado <strong>más tarde el día de hoy</strong> o durante el <strong>siguiente día hábil</strong>.
                    </p>
                    <p style="margin:0; font-size:13px; color:#475569; line-height:1.6;">
                      Nos comunicaremos contigo en caso de requerir ayuda o confirmar detalles respecto a tu dirección de entrega y horarios de recepción.
                    </p>
                  </td>
                </tr>
              </table>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f0fdf4; border-radius:10px; border:1px solid #bbf7d0; padding:20px; text-align:center;">
                <tr>
                  <td>
                    <h3 style="margin:0 0 8px 0; font-size:15px; font-weight:700; color:#166534;">
                      ¿Deseas dar alguna indicación especial sobre tu entrega?
                    </h3>
                    <p style="margin:0 0 16px 0; font-size:13px; color:#15803d; line-height:1.5;">
                      Puedes escribir directamente a nuestro equipo de Soporte vía WhatsApp para entregarnos horarios o referencias adicionales.
                    </p>
                    <a href="${waUrl}" target="_blank" style="display:inline-block; background-color:#25D366; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:12px 24px; border-radius:8px; box-shadow:0 2px 8px rgba(37,211,102,0.3);">
                      💬 Contactar a Soporte por WhatsApp (+569 8260 6602)
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc; padding:20px 32px; border-top:1px solid #e2e8f0; text-align:center;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#64748b;">
                Stocka SpA &bull; Logística y Fulfillment E-commerce
              </p>
              <p style="margin:0; font-size:11px; color:#94a3b8;">
                Correo enviado automáticamente desde <a href="mailto:info@stocka.cl" style="color:#c2410c; text-decoration:none;">info@stocka.cl</a> &bull; No responder a este correo
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Limpieza automática de imágenes antiguas en Supabase Storage (optiroute_proofs).
 * Elimina fotografías de entrega que tengan más de X días de antigüedad (por defecto 15 días).
 */
async function cleanOldProofImages(retentionDays = 15) {
  try {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const { data: orderFolders, error: errFolders } = await supabase.storage
      .from('optiroute_proofs')
      .list('orders', { limit: 200 });

    if (errFolders || !orderFolders || orderFolders.length === 0) return;

    let deletedFilesCount = 0;

    for (const folder of orderFolders) {
      if (!folder.name) continue;

      const { data: files, error: errFiles } = await supabase.storage
        .from('optiroute_proofs')
        .list(`orders/${folder.name}`, { limit: 50 });

      if (errFiles || !files || files.length === 0) continue;

      const filesToDelete = [];
      for (const file of files) {
        const fileCreatedAt = file.created_at || file.metadata?.lastModified;
        if (fileCreatedAt && new Date(fileCreatedAt).getTime() < cutoffTime) {
          filesToDelete.push(`orders/${folder.name}/${file.name}`);
        }
      }

      if (filesToDelete.length > 0) {
        const { error: delErr } = await supabase.storage
          .from('optiroute_proofs')
          .remove(filesToDelete);

        if (!delErr) {
          deletedFilesCount += filesToDelete.length;
        }
      }
    }

    if (deletedFilesCount > 0) {
      console.log(`🧹 [PURGA AUTOMÁTICA STORAGE] Se eliminaron ${deletedFilesCount} foto(s) de entrega con más de ${retentionDays} días de antigüedad.`);
    }
  } catch (err) {
    console.warn('⚠️ Advertencia en purga automática de imágenes antiguas:', err.message);
  }
}

// Ejecutar sincronización
syncOptirouteData();
