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

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

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

async function runHistoricalSync() {
  console.log('🔄 Iniciando regularización histórica de pedidos en base a envíos con movimiento...');

  try {
    // 1. Descargar todos los envíos unificados con movimiento (paginado)
    console.log('📡 Descargando envíos activos (DESPACHADO)...');
    let shipments = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('envios_unificados')
        .select('*')
        .eq('global_status', 'DESPACHADO')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;
      shipments = shipments.concat(data);
      hasMore = data.length === pageSize;
      page++;
    }
    console.log(`✅ Se encontraron ${shipments.length} envíos con movimiento.`);

    // 2. Descargar todos los pedidos del WMS (paginado)
    console.log('📡 Descargando pedidos desde la tabla orders...');
    let orders = [];
    page = 0;
    hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, external_order_number, tracking_number, courier, status')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;
      orders = orders.concat(data);
      hasMore = data.length === pageSize;
      page++;
    }
    console.log(`✅ Se encontraron ${orders.length} pedidos totales.`);

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

    // 3. Cruzar y actualizar pedidos
    for (const shipment of shipments) {
      if (!shipment.pedido_referencia) continue;

      const cleanRef = String(shipment.pedido_referencia).trim();
      let matchedOrder = null;

      // Buscar por ID (UUID)
      if (cleanRef.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        matchedOrder = orderMapById[cleanRef];
      }

      // Si no coincide o no es UUID, buscar por número externo
      if (!matchedOrder) {
        matchedOrder = orderMapByExtNumber[cleanRef.toUpperCase()];
      }

      if (matchedOrder) {
        const targetOperador = mapCourierToOperador(shipment.courier);
        
        // El pedido necesita actualizarse si:
        // A) No tiene tracking asignado.
        // B) O el tracking asignado es diferente al del envío que sí se movió.
        const needsUpdate = 
          !matchedOrder.tracking_number || 
          matchedOrder.tracking_number !== shipment.tracking ||
          matchedOrder.courier !== shipment.courier;

        if (needsUpdate) {
          const updatePayload = {
            tracking_number: shipment.tracking,
            tracking_url: shipment.tracking_url,
            courier: shipment.courier,
            operador: targetOperador
          };

          // Actualizar estado general a despachado si no está en un estado final
          if (matchedOrder.status !== 'despachado' && matchedOrder.status !== 'cancelado') {
            updatePayload.status = 'despachado';
          }

          console.log(`📝 Corrigiendo Pedido [Ref: ${matchedOrder.external_order_number || matchedOrder.id}] -> Asignando tracking con movimiento: ${shipment.tracking} (${shipment.courier})`);

          const { error: updateErr } = await supabase
            .from('orders')
            .update(updatePayload)
            .eq('id', matchedOrder.id);

          if (updateErr) {
            console.error(`❌ Error al actualizar pedido ${matchedOrder.id}:`, updateErr.message);
          } else {
            updatedCount++;
            // Actualizar datos locales
            matchedOrder.tracking_number = shipment.tracking;
            matchedOrder.courier = shipment.courier;
            if (updatePayload.status) {
              matchedOrder.status = updatePayload.status;
            }
          }
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`🎉 Regularización histórica completada.`);
    console.log(`- Pedidos antiguos actualizados con tracking activo: ${updatedCount}`);
    console.log(`========================================`);

  } catch (err) {
    console.error('❌ Error durante la regularización:', err.message);
  }
}

runHistoricalSync();
