const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Cargar archivo .env
const envPath = path.join(__dirname, '..', '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const SUPABASE_URL = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY no está configurado en el archivo .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function mapCourierToOperador(courier) {
  if (!courier) return null;
  const c = courier.toUpperCase().trim();
  if (c.includes('STARKEN')) return 'STARKEN';
  if (c.includes('BLUE')) return 'BLUEXPRESS';
  if (c.includes('CHILEXPRESS')) return 'CHILEXPRESS';
  if (c.includes('ENVIAME') || c.includes('ENVÍAME')) return 'ENVIAME';
  if (c.includes('ALPHA') || c.includes('LIGHTDATA')) return 'ALPHA';
  if (c.includes('FALABELLA')) return 'FALABELLA';
  if (c.includes('MERCADO')) return 'MERCADOLIBRE';
  if (c.includes('RECIBELO') || c.includes('RECÍBELO') || c.includes('WELIVERY') || c.includes('WOODELIVERY') || c.includes('WODELY')) return 'STOCKA X';
  return c;
}

async function runSync() {
  console.log('🔄 Iniciando sincronización paginada de envíos Envíame -> Pedidos WMS con actualización de Operador...');

  try {
    // 1. Obtener todos los envíos de la tabla enviame_shipments (paginado)
    console.log('📡 Descargando envíos desde enviame_shipments...');
    let shipments = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('enviame_shipments')
        .select('*')
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error) throw error;
      shipments = shipments.concat(data);
      hasMore = data.length === pageSize;
      page++;
    }
    console.log(`✅ Se encontraron ${shipments.length} envíos totales en enviame_shipments.`);

    // 2. Obtener todos los pedidos del WMS (paginado)
    console.log('📡 Descargando pedidos desde la tabla orders...');
    let orders = [];
    page = 0;
    hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, external_order_number, tracking_number, tracking_url, label_url, courier, operador, status')
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error) throw error;
      orders = orders.concat(data);
      hasMore = data.length === pageSize;
      page++;
    }
    console.log(`✅ Se encontraron ${orders.length} pedidos totales en la tabla orders.`);

    // Crear mapas de búsqueda rápida de pedidos
    const orderMapById = {};
    const orderMapByExtNumber = {};
    orders.forEach(o => {
      orderMapById[o.id] = o;
      if (o.external_order_number) {
        orderMapByExtNumber[String(o.external_order_number).trim().toUpperCase()] = o;
      }
    });

    let updatedCount = 0;

    // 3. Procesar y cruzar cada envío
    for (const shipment of shipments) {
      if (!shipment.order_id) continue;

      const cleanOrderId = String(shipment.order_id).trim();
      let matchedOrder = null;

      // Buscar por ID (UUID)
      if (cleanOrderId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        matchedOrder = orderMapById[cleanOrderId];
      }

      // Si no coincide o no es UUID, buscar por número externo
      if (!matchedOrder) {
        matchedOrder = orderMapByExtNumber[cleanOrderId.toUpperCase()];
      }

      if (matchedOrder) {
        const targetOperador = mapCourierToOperador(shipment.courier);

        // Mapear estado para actualizar el estado del WMS si corresponde
        const shipmentStatusLower = (shipment.status || '').toLowerCase().trim();
        let targetWmsStatus = null;

        // Si ya está despachado o entregado en el courier, cambiar estado a 'despachado'
        if (
          shipmentStatusLower.includes('entregado') ||
          shipmentStatusLower.includes('delivered') ||
          shipmentStatusLower.includes('transito') ||
          shipmentStatusLower.includes('ruta') ||
          shipmentStatusLower.includes('reparto') ||
          shipmentStatusLower.includes('camino') ||
          shipmentStatusLower.includes('distribucion') ||
          shipmentStatusLower.includes('recolectado') ||
          shipmentStatusLower.includes('recogido') ||
          shipmentStatusLower.includes('admitido') ||
          shipmentStatusLower.includes('despachado') ||
          shipmentStatusLower === 'picked_up' ||
          shipmentStatusLower === 'shipped'
        ) {
          targetWmsStatus = 'despachado';
        } else if (
          shipmentStatusLower.includes('cancelado') ||
          shipmentStatusLower.includes('anulado') ||
          shipmentStatusLower === 'canceled' ||
          shipmentStatusLower === 'deleted'
        ) {
          targetWmsStatus = 'cancelado';
        }

        // Verificar si los campos actuales en el pedido son diferentes
        const needsUpdate = 
          matchedOrder.tracking_number !== shipment.tracking_number ||
          matchedOrder.tracking_url !== shipment.tracking_url ||
          matchedOrder.label_url !== shipment.label_url ||
          matchedOrder.courier !== shipment.courier ||
          matchedOrder.operador !== targetOperador ||
          (targetWmsStatus && matchedOrder.status !== targetWmsStatus && matchedOrder.status !== 'despachado' && matchedOrder.status !== 'cancelado');

        if (needsUpdate) {
          const updatePayload = {
            tracking_number: shipment.tracking_number,
            tracking_url: shipment.tracking_url,
            label_url: shipment.label_url,
            courier: shipment.courier,
            operador: targetOperador,
            enviame_delivery_id: shipment.id,
            enviame_status: shipment.status
          };

          // Actualizar estado general solo si corresponde y no retrocede un estado final
          if (targetWmsStatus && matchedOrder.status !== 'despachado' && matchedOrder.status !== 'cancelado') {
            updatePayload.status = targetWmsStatus;
          }

          console.log(`📝 Actualizando Pedido [Ref: ${matchedOrder.external_order_number || matchedOrder.id}] con Operador: ${targetOperador}, Tracking: ${shipment.tracking_number}`);

          const { error: updateErr } = await supabase
            .from('orders')
            .update(updatePayload)
            .eq('id', matchedOrder.id);

          if (updateErr) {
            console.error(`❌ Error al actualizar pedido ${matchedOrder.id}:`, updateErr.message);
          } else {
            updatedCount++;
            // Actualizar mapas locales para reflejar el cambio
            matchedOrder.tracking_number = shipment.tracking_number;
            matchedOrder.tracking_url = shipment.tracking_url;
            matchedOrder.label_url = shipment.label_url;
            matchedOrder.courier = shipment.courier;
            matchedOrder.operador = targetOperador;
            if (updatePayload.status) {
              matchedOrder.status = updatePayload.status;
            }
          }
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`🎉 Sincronización paginada completada.`);
    console.log(`- Pedidos actualizados en WMS: ${updatedCount}`);
    console.log(`========================================`);

  } catch (err) {
    console.error('❌ Error durante la sincronización:', err.message);
  }
}

runSync();
