const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ==========================================
// CARGAR ARCHIVO .ENV LOCALMENTE
// ==========================================
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ==========================================
// FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncParisData() {
  console.log('🔄 Iniciando sincronización con París Marketplace (Mirakl)...');

  try {
    // 1. Obtener todas las integraciones activas de París en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Paris')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de París configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 URL Base: ${integration.shop_url}`);
      console.log(`========================================`);

      await syncMerchantOrders(integration);
    }

    console.log('\n🎉 Sincronización finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Sincroniza los pedidos de un cliente específico de París
 */
async function syncMerchantOrders(integration) {
  // A. Obtener o definir una bodega por defecto para el cliente
  let warehouseId = null;
  const { data: whRel, error: whErr } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', integration.merchant_id)
    .limit(1)
    .maybeSingle();

  if (whRel) {
    warehouseId = whRel.warehouse_id;
  } else {
    // Buscar la primera bodega disponible en el WMS como fallback
    const { data: defaultWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
    if (defaultWh) {
      warehouseId = defaultWh.id;
    }
  }

  if (!warehouseId) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: No hay ninguna bodega configurada en el WMS.`);
    return;
  }

  // B. Normalizar URL base de la API
  let baseUrl = integration.shop_url.trim();
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const ordersUrl = `${baseUrl}/orders?order_state_codes=WAITING_ACCEPTANCE,PREPARATION&limit=100`;

  console.log(`--> Consultando pedidos en la API de París...`);

  try {
    const response = await fetch(ordersUrl, {
      method: 'GET',
      headers: {
        'Authorization': integration.access_token,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Error en API de París (Mirakl): ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const orders = data.orders || [];
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      console.log(`\nProcesando pedido París ID: ${order.order_id} (Estado actual: ${order.order_state})`);

      // 1. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', order.order_id)
        .maybeSingle();

      // 2. Si el pedido está en espera de aceptación ("WAITING_ACCEPTANCE"), aceptarlo automáticamente en Mirakl
      if (order.order_state === 'WAITING_ACCEPTANCE') {
        console.log(`--> El pedido requiere aceptación. Aceptando automáticamente...`);
        const acceptUrl = `${baseUrl}/orders/${order.order_id}/accept`;
        
        // Estructura requerida por Mirakl para la aceptación/rechazo de líneas
        const acceptPayload = {
          order_lines: order.order_lines.map(line => ({
            id: line.order_line_id,
            accepted: true
          }))
        };

        try {
          const acceptRes = await fetch(acceptUrl, {
            method: 'PUT',
            headers: {
              'Authorization': integration.access_token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(acceptPayload)
          });

          if (!acceptRes.ok) {
            console.error(`❌ Error al aceptar pedido ${order.order_id} en París: ${acceptRes.status} ${acceptRes.statusText}`);
            continue; // Saltar inserción local hasta que sea aceptado con éxito
          }

          console.log(`✅ Pedido ${order.order_id} aceptado con éxito en París.`);
          order.order_state = 'PREPARATION'; // Forzar cambio de estado local temporalmente para procesarlo
        } catch (acceptErr) {
          console.error(`❌ Excepción al intentar aceptar pedido ${order.order_id}:`, acceptErr.message);
          continue;
        }
      }

      // 3. Mapear datos comunes del pedido
      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        external_order_number: order.order_id,
        external_platform: 'Paris',
        payment_status: order.order_state,
        total_value: order.total_price,
        customer_email: order.customer?.billing_address?.email || order.customer?.email,
        customer_phone: order.customer?.shipping_address?.phone || order.customer?.billing_address?.phone,
        customer_name: `${order.customer?.firstname || ''} ${order.customer?.lastname || ''}`.trim() || 'Cliente París',
        shipping_address: order.customer?.shipping_address?.street_1 || 'No especificada',
        shipping_city: order.customer?.shipping_address?.city || order.customer?.shipping_address?.municipality || 'No especificada',
        shipping_complement: order.customer?.shipping_address?.street_2 || '',
        raw_paris_data: order
      };

      let localOrderId = null;

      if (existingOrder) {
        // Actualizar pedido existente
        const { error: updErr } = await supabase
          .from('orders')
          .update(orderDataToSave)
          .eq('id', existingOrder.id);

        if (updErr) {
          console.error(`❌ Error al actualizar pedido local ${order.order_id}:`, updErr.message);
        } else {
          console.log(`📝 Actualizado pedido local ${order.order_id}`);
        }
        localOrderId = existingOrder.id;
      } else {
        // Insertar nuevo pedido
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${order.order_id}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${order.order_id}`);
        localOrderId = newOrder.id;

        // 4. Registrar ítems en order_items para reserva de stock
        for (const line of order.order_lines) {
          const sku = line.offer_sku || line.product_sku;
          
          if (!sku) {
            console.warn(`⚠️ Ítem de orden sin SKU definido. ID Línea: ${line.order_line_id}`);
            continue;
          }

          // Buscar producto por SKU en la base de datos
          const { data: product } = await supabase
            .from('products')
            .select('id')
            .eq('merchant_id', integration.merchant_id)
            .eq('sku', sku)
            .maybeSingle();

          if (product) {
            const { error: itemErr } = await supabase
              .from('order_items')
              .insert([{
                order_id: localOrderId,
                product_id: product.id,
                warehouse_id: warehouseId,
                quantity: line.quantity
              }]);

            if (itemErr) {
              console.error(`❌ Error al insertar ítem SKU ${sku} para orden ${order.order_id}:`, itemErr.message);
            } else {
              console.log(`   + Registrado ítem: SKU ${sku} x ${line.quantity} (Stock Reservado)`);
            }
          } else {
            console.warn(`⚠️ SKU ${sku} no encontrado en base de datos. No se pudo asociar a la orden local.`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
  }
}

// Ejecutar script
syncParisData();
