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

    console.log('\n🎉 Sincronización con Optiroute finalizada con éxito.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Obtiene la fecha de inicio en formato YYYY-MM-DD (hace 3 días para evitar consultas masivas de histórico)
 */
function getStartDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
 * Sincroniza los pedidos recientes de un merchant específico usando sus credenciales de Optiroute.
 * Aplica filtros estrictos para omitir pedidos entregados/cancelados y evitar throttling.
 */
async function syncMerchantOrders(integration) {
  const startDate = getStartDateStr();
  console.log(`--> Consultando pedidos recientes en Optiroute creados desde: ${startDate}`);

  let optirouteUrl = `https://app.optiroute.cl/api/v1/integration-service-requests/?per_page=100&creationStartDate=${startDate}`;
  let pageCount = 1;
  const MAX_DETAIL_CALLS_PER_RUN = 30; // Máximo de peticiones HTTP de detalle individual por ejecución
  let detailCallsMade = 0;

  try {
    while (optirouteUrl) {
      console.log(`--> Consultando página ${pageCount} en Optiroute (URL: ${optirouteUrl})...`);
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
        .select('id, status, email_cliente_destino, direccion_destino, raw_data')
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

        // 1. REGLA PRINCIPAL: Si ya está registrado en Supabase con estado terminal (DELIVERED, CANCELLED, DELETED), OMITIR.
        if (existing && TERMINAL_STATUSES.has(existing.status)) {
          console.log(`   ⏭️ Omitiendo ID '${idStr}': Ya está en estado terminal '${existing.status}' en la BD.`);
          continue;
        }

        // 2. REGLA DE INMUTABILIDAD: Si no ha cambiado de estado y ya tenemos datos en la BD, OMITIR.
        if (existing && existing.status === listStatusName && (existing.email_cliente_destino || existing.direccion_destino)) {
          console.log(`   ⏭️ Omitiendo ID '${idStr}': Sin cambios de estado ('${listStatusName}') y datos completos en BD.`);
          continue;
        }

        // 3. Determinar si requiere consulta de detalle individual
        // Solo hacer GET de detalle si NO existe en BD o su estado cambió, Y no hemos excedido la cuota segura por ejecución
        let detailedOrder = optiOrder;
        const needsDetail = (!existing || existing.status !== listStatusName) && detailCallsMade < MAX_DETAIL_CALLS_PER_RUN;

        if (needsDetail) {
          try {
            await new Promise(resolve => setTimeout(resolve, 100)); // Retardo de 100ms para cuidar el servidor de Optiroute
            detailCallsMade++;
            console.log(`   📡 [API Call ${detailCallsMade}/${MAX_DETAIL_CALLS_PER_RUN}] Obteniendo detalle para ID '${idStr}'...`);

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

        payloadsToUpsert.push({
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
        });
      }

      // Guardar en lote (Bulk Upsert)
      if (payloadsToUpsert.length > 0) {
        console.log(`   📝 Guardando ${payloadsToUpsert.length} pedidos actualizados en Supabase en 1 consulta masiva...`);
        const { error: upsertError } = await supabase
          .from('optiroute_orders')
          .upsert(payloadsToUpsert, { onConflict: 'id' });

        if (upsertError) {
          console.error(`      ❌ Error al guardar en tabla optiroute_orders:`, upsertError.message);
        } else {
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

  } catch (err) {
    console.error(`❌ Error sincronizando pedidos para el merchant ${integration.merchant_id}:`, err.message);
  }
}

/**
 * Sincroniza de forma acotada pedidos antiguos que sigan en estado activo
 * en la base de datos (excluyendo DELIVERED, CANCELLED, DELETED)
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
    .limit(20);

  if (pendingErr) {
    console.error('❌ Error al obtener pedidos antiguos activos:', pendingErr.message);
    return;
  }

  if (!pendingOrders || pendingOrders.length === 0) {
    console.log('ℹ️ No hay pedidos antiguos activos pendientes de actualizar.');
    return;
  }

  console.log(`--> Encontrados ${pendingOrders.length} pedidos antiguos activos. Actualizando estado (máximo 20)...`);

  const payloadsToUpsert = [];

  for (const dbOrder of pendingOrders) {
    try {
      await new Promise(resolve => setTimeout(resolve, 100)); // Evitar saturación del servidor

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

      payloadsToUpsert.push({
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
      });

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

// Ejecutar sincronización
syncOptirouteData();
