const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function repair() {
  console.log('🔄 Iniciando auditoría y reparación de trackings cruzados de Envíame...');

  // 1. Cargar configuraciones de comercio
  const { data: configs } = await supabase
    .from('comercios_adicional_config')
    .select('comercio, enviame_id');

  const compIdToComercio = {
    '166878': 'MAESE'
  };
  const comercioToCompId = {};
  (configs || []).forEach(c => {
    if (c.enviame_id) {
      const ids = String(c.enviame_id).split(',').map(s => s.trim().replace(/^ID\s*:?\s*/i, ''));
      ids.forEach(id => {
        if (id) compIdToComercio[id] = c.comercio.trim().toUpperCase();
      });
      comercioToCompId[c.comercio.trim().toUpperCase()] = ids;
    }
  });

  // 2. Obtener órdenes con enviame_delivery_id asignado
  const { data: ordersWithDelivery, error: ordErr } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, enviame_delivery_id, tracking_number, courier, operador, customer_name, status, shipping_city, created_at')
    .not('enviame_delivery_id', 'is', null);

  if (ordErr) {
    console.error('Error fetching orders:', ordErr);
    return;
  }

  console.log(`Total de pedidos con enviame_delivery_id: ${ordersWithDelivery.length}`);

  // 3. Cargar envíos de Envíame referenciados
  const deliveryIds = [...new Set(ordersWithDelivery.map(o => o.enviame_delivery_id))];
  const shipmentsMap = {};
  for (let i = 0; i < deliveryIds.length; i += 100) {
    const chunk = deliveryIds.slice(i, i + 100);
    const { data: ships } = await supabase
      .from('enviame_shipments')
      .select('id, order_id, seller_name, tracking_number, courier, raw_payload')
      .in('id', chunk);

    (ships || []).forEach(s => {
      shipmentsMap[s.id] = s;
    });
  }

  // 4. Identificar inconsistencias
  const mismatches = [];
  for (const ord of ordersWithDelivery) {
    const ship = shipmentsMap[ord.enviame_delivery_id];
    if (!ship) continue;

    let shipCompanyId = ship.raw_payload?.company?.id || null;
    if (!shipCompanyId && ship.raw_payload?.links) {
      const webLink = ship.raw_payload.links.find(l => l.rel === 'tracking-web' || l.href?.includes('/companies/'));
      const m = webLink?.href?.match(/\/companies\/(\d+)\//);
      if (m) shipCompanyId = m[1];
    }
    if (!shipCompanyId && ship.seller_name) {
      const m = ship.seller_name.match(/^ID\s*:?\s*(\d+)$/i);
      if (m) shipCompanyId = m[1];
    }

    let shipCommerceName = null;
    if (shipCompanyId && compIdToComercio[shipCompanyId]) {
      shipCommerceName = compIdToComercio[shipCompanyId];
    } else if (ship.seller_name && !ship.seller_name.startsWith('ID:')) {
      shipCommerceName = ship.seller_name.trim().toUpperCase();
    }

    const orderComercioUpper = (ord.comercio || '').trim().toUpperCase();

    let isMatch = false;
    if (shipCommerceName && orderComercioUpper) {
      if (shipCommerceName === orderComercioUpper) isMatch = true;
      else if (orderComercioUpper.includes(shipCommerceName) || shipCommerceName.includes(orderComercioUpper)) isMatch = true;
    } else if (shipCompanyId && comercioToCompId[orderComercioUpper]) {
      if (comercioToCompId[orderComercioUpper].includes(shipCompanyId)) isMatch = true;
    }

    // Caso corporativo 8326 (Stocka)
    if (shipCompanyId === '8326') {
      const ordNumClean = ord.external_order_number.replace(/^[^0-9]+/, '');
      const shipNumClean = String(ship.order_id).replace(/^[^0-9]+/, '');
      if (ord.external_order_number === ship.order_id || (ordNumClean && ordNumClean === shipNumClean && ordNumClean.length >= 4)) {
        isMatch = true;
      }
    }

    if (!isMatch && (shipCommerceName || shipCompanyId)) {
      mismatches.push({
        order: ord,
        ship: ship,
        shipCompanyId: shipCompanyId,
        shipCommerceName: shipCommerceName
      });
    }
  }

  console.log(`\n🚨 Se encontraron ${mismatches.length} pedidos con tracking de comercio erróneo.`);

  // 5. Aplicar reparación a cada orden afectada
  let repairedCount = 0;
  for (const item of mismatches) {
    const { order, ship, shipCommerceName, shipCompanyId } = item;

    console.log(`\n🧹 Reparando pedido [${order.comercio}] ${order.external_order_number}:`);
    console.log(`   - Tracking actual asignado incorrectamente: ${order.tracking_number} (${order.courier})`);
    console.log(`   - Delivery ID: ${order.enviame_delivery_id}`);
    console.log(`   - El delivery en realidad pertenece a: [${shipCommerceName || shipCompanyId}] (Ref: ${ship.order_id})`);

    const updatePayload = {
      enviame_delivery_id: null,
      enviame_status: null,
      tracking_number: null,
      tracking_url: null,
      label_url: null
    };

    // Si el courier u operador fue forzado por el tracking erróneo, resetearlo
    if (['STARKEN', 'RECIBELO', 'WELIVERY', 'STOCKA X'].includes((order.courier || '').toUpperCase()) ||
        ['STARKEN', 'RECIBELO', 'WELIVERY', 'STOCKA X'].includes((order.operador || '').toUpperCase())) {
      updatePayload.courier = null;
      updatePayload.operador = null;
    }

    const { error: updErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id);

    if (updErr) {
      console.error(`   ❌ Error al limpiar pedido ${order.id}:`, updErr.message);
    } else {
      console.log(`   ✅ Limpiado con éxito: Tracking removido, listo para asignación correcta.`);
      repairedCount++;
    }
  }

  console.log(`\n🎉 Reparación completada: ${repairedCount} pedidos restaurados a estado limpio.`);

  // 6. Verificación puntual del caso BLE#1067
  console.log('\n--- VERIFICACIÓN DEL CASO BLE#1067 ---');
  const { data: bleOrder } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, customer_name, tracking_number, courier, operador, enviame_delivery_id, status')
    .ilike('external_order_number', '%1067%')
    .eq('comercio', 'BLESSNUSS')
    .maybeSingle();

  console.log('Estado actual de BLE#1067:', bleOrder);
}

repair().catch(console.error);
