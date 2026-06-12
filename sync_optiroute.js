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
    // 1. Obtener todas las integraciones activas de Optiroute en Supabase junto a su profile
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*, profiles(company_name)')
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
 * Obtiene la fecha de inicio en formato YYYY-MM-DD (hace 30 días)
 */
function getStartDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
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
 * Sincroniza los pedidos de un merchant específico usando sus credenciales de Optiroute
 * y los guarda en la tabla dedicada 'optiroute_orders'
 */
async function syncMerchantOrders(integration) {
  const startDate = getStartDateStr();
  console.log(`--> Consultando pedidos en Optiroute creados desde: ${startDate}`);

  let optirouteUrl = `https://app.optiroute.cl/api/v1/integration-service-requests/?per_page=100&creationStartDate=${startDate}`;
  let pageCount = 1;

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

      for (const optiOrder of optirouteOrders) {
        // Armar el payload para la tabla dedicada 'optiroute_orders'
        const upsertPayload = {
          id: String(optiOrder.id),
          empresa_comercio_proveedor: integration.profiles?.company_name || 'STOCKA',
          tracking: optiOrder.tracking ? optiOrder.tracking.trim() : null,
          tracking_url: optiOrder.tracking_url ? optiOrder.tracking_url.trim() : null,
          courier: 'STOCKA X',
          status: getOptirouteStatusName(optiOrder.status),
          updated_at: new Date().toISOString(),
          servicio_tipo_envio: 'SAME DAY/24 HRS',
          nombre_destinatario: optiOrder.customer?.name || null,
          telefono_destino: optiOrder.customer?.phone_number || null,
          email_cliente_destino: optiOrder.customer?.email || null,
          direccion_destino: optiOrder.address?.full_address || 
            (optiOrder.address?.street_name 
              ? `${optiOrder.address.street_name} ${optiOrder.address.address_number || ''}`.trim() 
              : null),
          complemento_destino: [optiOrder.address?.apartment_number, optiOrder.address?.address_more_info]
            .filter(Boolean)
            .join(', ') || null,
          comuna_destino: optiOrder.address?.commune?.name || optiOrder.address?.locality || null,
          raw_data: optiOrder
        };

        console.log(`   📝 Guardando/Actualizando pedido Optiroute ID '${upsertPayload.id}' (Proveedor: ${upsertPayload.empresa_comercio_proveedor}, Estado: ${upsertPayload.status})`);

        const { error: upsertError } = await supabase
          .from('optiroute_orders')
          .upsert(upsertPayload, { onConflict: 'id' });

        if (upsertError) {
          console.error(`      ❌ Error al guardar en tabla optiroute_orders:`, upsertError.message);
        } else {
          console.log(`      ✅ Guardado exitoso.`);
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

// Ejecutar sincronización
syncOptirouteData();
