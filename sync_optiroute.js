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

// ==========================================
// FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncOptirouteData() {
  console.log('🔄 Iniciando sincronización con Optiroute API...');

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
    }

    console.log('\n🎉 Sincronización con Optiroute finalizada con éxito.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Obtiene la fecha de inicio en formato YYYY-MM-DD (hace 15 días)
 */
function getStartDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 15);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Mapea los estados numéricos de la API de Optiroute a los estados de WMS STOCKA
 */
function mapOptirouteStatusToWms(statusNum) {
  const s = Number(statusNum);
  switch (s) {
    case -4: // DELETED (El pedido fue borrado)
    case -1: // CANCELLED (El pedido fue cancelado)
      return 'cancelado';
    case -2: // IMPORTED
    case 0:  // REVIEWING (Ingresó a Optiroute - Estado Inicial)
      return 'para procesar';
    case 1:  // SCHEDULED (Asignado a un destino en algún plan de ruta)
      return 'preparado'; // O se mantiene su estado actual en WMS
    case 6:  // ONROUTE (Ruta ya iniciada)
    case 2:  // ONGOING (Viaje iniciado hacia el destino)
    case 4:  // ARRIVED (Llegó al lugar de entrega, sin entregar)
      return 'en tránsito';
    case 3:  // DELIVERED (Entregado al cliente con éxito)
      return 'entregado';
    case 5:  // SKIPPED (El pedido fue marcado como saltado por el conductor)
      return 'incidencia';
    default:
      return null;
  }
}

/**
 * Sincroniza los pedidos de un merchant específico usando sus credenciales de Optiroute
 */
async function syncMerchantOrders(integration) {
  const startDate = getStartDateStr();
  console.log(`--> Consultando pedidos en Optiroute creados desde: ${startDate}`);

  const optirouteUrl = `https://app.optiroute.cl/api/v1/integration-service-requests/?per_page=100&creationStartDate=${startDate}`;

  try {
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
    
    // Normalizar la respuesta de la API de Optiroute (por paginación DRF o array directo)
    let optirouteOrders = [];
    if (Array.isArray(data)) {
      optirouteOrders = data;
    } else if (data && Array.isArray(data.results)) {
      optirouteOrders = data.results;
    } else if (data && Array.isArray(data.data)) {
      optirouteOrders = data.data;
    }

    console.log(`--> Encontrados ${optirouteOrders.length} pedidos en la API de Optiroute.`);

    for (const optiOrder of optirouteOrders) {
      if (!optiOrder.reference) {
        console.log(`   [ID ${optiOrder.id}] Omitiendo pedido sin propiedad 'reference'`);
        continue;
      }

      const referenceStr = optiOrder.reference.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(referenceStr);

      // 1. Buscar coincidencia exacta en Supabase de forma global (todos los merchants)
      let query = supabase
        .from('orders')
        .select('id, status, external_order_number, optiroute_status');

      if (isUuid) {
        query = query.eq('id', referenceStr);
      } else {
        query = query.eq('external_order_number', referenceStr);
      }

      let { data: dbOrders, error: findError } = await query;

      if (findError) {
        console.error(`   ❌ Error al buscar pedido '${referenceStr}' en Supabase:`, findError.message);
        continue;
      }

      // Reintento alternativo agregando/quitando '#' para número de pedido (Shopify)
      if ((!dbOrders || dbOrders.length === 0) && !isUuid) {
        const alternativeRef = referenceStr.startsWith('#') 
          ? referenceStr.substring(1) 
          : `#${referenceStr}`;

        const { data: retryOrders, error: retryError } = await supabase
          .from('orders')
          .select('id, status, external_order_number, optiroute_status')
          .eq('external_order_number', alternativeRef);

        if (!retryError && retryOrders && retryOrders.length > 0) {
          dbOrders = retryOrders;
        }
      }

      if (!dbOrders || dbOrders.length === 0) {
        console.log(`   [Ref: ${referenceStr}] Pedido no encontrado en Supabase. Omitiendo.`);
        continue;
      }

      const dbOrder = dbOrders[0];
      const mappedStatus = mapOptirouteStatusToWms(optiOrder.status);

      // Armar payload de actualización
      const updatePayload = {
        optiroute_id: String(optiOrder.id),
        optiroute_status: String(optiOrder.status),
        raw_optiroute_data: optiOrder
      };

      // Si el estado en Optiroute se mapea a un estado de WMS y es diferente al actual, lo actualizamos
      if (mappedStatus && mappedStatus !== dbOrder.status) {
        updatePayload.status = mappedStatus;
      }

      // Sincronizar número de seguimiento, url y chofer si están disponibles
      if (optiOrder.tracking) {
        updatePayload.tracking_number = optiOrder.tracking.trim();
      }
      if (optiOrder.tracking_url) {
        updatePayload.tracking_url = optiOrder.tracking_url.trim();
      }
      
      if (optiOrder.assigned_driver) {
        updatePayload.courier = `Optiroute (${optiOrder.assigned_driver})`;
      } else {
        updatePayload.courier = 'Optiroute';
      }

      // Determinar si hay cambios reales para realizar el UPDATE
      const needsUpdate = 
        updatePayload.status || 
        dbOrder.optiroute_status !== String(optiOrder.status);

      if (needsUpdate) {
        const oldStatus = dbOrder.status;
        const newStatus = updatePayload.status || oldStatus;
        
        console.log(`   📝 Actualizando pedido '${dbOrder.external_order_number || dbOrder.id}'`);
        console.log(`      - Estado: "${oldStatus}" -> "${newStatus}"`);
        console.log(`      - Estado Optiroute: "${dbOrder.optiroute_status || 'N/A'}" -> "${optiOrder.status}"`);

        const { error: updateError } = await supabase
          .from('orders')
          .update(updatePayload)
          .eq('id', dbOrder.id);

        if (updateError) {
          console.error(`      ❌ Error al actualizar en Supabase:`, updateError.message);
        } else {
          console.log(`      ✅ Actualización exitosa.`);
        }
      } else {
        console.log(`   ✓ Pedido '${dbOrder.external_order_number || dbOrder.id}' ya está al día.`);
      }
    }

  } catch (err) {
    console.error(`❌ Error sincronizando pedidos para el merchant ${integration.merchant_id}:`, err.message);
  }
}

// Ejecutar sincronización
syncOptirouteData();
