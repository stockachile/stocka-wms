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
  console.log('🔄 Iniciando sincronización con París Marketplace (Cencosud API)...');

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

  // B. Normalizar URL base de la API de Cencosud
  let baseUrl = integration.shop_url.trim();
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  try {
    // 1. Autenticar usando el API Key (Bearer Token) para obtener el Access Token JWT
    console.log(`--> Autenticando API Key con Cencosud...`);
    const authRes = await fetch(`${baseUrl}/v1/auth/apiKey`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${integration.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!authRes.ok) {
      throw new Error(`Error en autenticación API Key Cencosud: Status ${authRes.status}`);
    }

    const authData = await authRes.json();
    const jwtToken = authData.accessToken;
    console.log(`✅ Autenticación exitosa. Token JWT obtenido.`);

    // 2. Obtener las últimas 100 órdenes desde Cencosud
    console.log(`--> Consultando pedidos en la API de París (Cencosud)...`);
    const ordersRes = await fetch(`${baseUrl}/v1/orders?limit=100`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!ordersRes.ok) {
      throw new Error(`Error en API de París (Cencosud): ${ordersRes.status} ${ordersRes.statusText}`);
    }

    const data = await ordersRes.json();
    const orders = data.data || [];
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      const orderId = order.originOrderNumber || order.id;
      const statusName = order.status?.name || 'created';
      
      console.log(`\nProcesando pedido París ID: ${orderId} (Estado actual: ${statusName})`);

      // Clasificación de estados
      const isDelivered = statusName === 'delivered' || order.status?.id === 4;
      const isCancelled = statusName.toLowerCase().includes('cancel') || 
                          order.status?.description?.toLowerCase().includes('cancel') ||
                          order.status?.id === 2; // ID común de cancelación
      
      const isActive = !isDelivered && !isCancelled;

      // 1. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', orderId)
        .maybeSingle();

      // Obtener todos los ítems de todos los sub-pedidos y la primera dirección de despacho
      const allItems = [];
      let shippingAddress = null;
      
      if (order.subOrders && Array.isArray(order.subOrders)) {
        for (const subOrder of order.subOrders) {
          if (subOrder.items && Array.isArray(subOrder.items)) {
            allItems.push(...subOrder.items);
          }
          if (subOrder.shippingAddress && !shippingAddress) {
            shippingAddress = subOrder.shippingAddress;
          }
        }
      }
      
      if (!shippingAddress) {
        shippingAddress = order.billingAddress;
      }

      // 1. Agrupar ítems por SKU y recolectar nombres
      const itemQuantities = {};
      const itemNames = [];
      for (const item of allItems) {
        let sku = item.sellerSku || item.sku;
        if (sku) {
          sku = sku.replace(/\s+/g, '');
          itemQuantities[sku] = (itemQuantities[sku] || 0) + 1;
        }
        if (item.name && !itemNames.includes(item.name)) {
          itemNames.push(item.name);
        }
      }

      const flatSku = Object.keys(itemQuantities).join(', ');
      const flatItemName = itemNames.join(', ');
      const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);

      // Calcular valor total de la orden sumando precios de los ítems
      const totalValue = allItems.reduce((sum, item) => sum + Number(item.priceAfterDiscounts || item.grossPrice || 0), 0);

      // Mapear datos comunes del pedido
      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        external_order_number: orderId,
        external_platform: 'Paris',
        payment_status: statusName,
        total_value: totalValue,
        customer_email: order.customer?.email || 'no-email@paris.cl',
        customer_phone: shippingAddress?.phone || order.customer?.phone || 'No especificado',
        customer_name: `${shippingAddress?.firstName || order.customer?.firstName || ''} ${shippingAddress?.lastName || order.customer?.lastName || ''}`.trim() || 'Cliente París',
        shipping_address: shippingAddress?.address1 || 'No especificada',
        shipping_city: shippingAddress?.city || 'No especificada',
        shipping_complement: [shippingAddress?.address2, shippingAddress?.address3].filter(Boolean).join(', ') || '',
        raw_paris_data: order,
        // Nuevas columnas planas solicitadas
        origen: 'Paris',
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku
      };

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        // Si el pedido se canceló en origen, actualizar su estado en WMS
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ ...orderDataToSave, status: 'cancelado' })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${orderId} cancelado en París. Actualizado en el WMS.`);
        } else {
          // Actualizar datos del pedido manteniendo el estado WMS actual
          await supabase
            .from('orders')
            .update(orderDataToSave)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${orderId}`);
        }
        localOrderId = existingOrder.id;

        // Mecanismo de auto-recuperación (Healer):
        // Verificar si la orden existente ya tiene items en la tabla order_items
        const { data: existingItems, error: itemsCheckErr } = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', localOrderId);

        if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
          console.log(`ℹ️ Pedido existente ${orderId} no tiene ítems registrados. Se procederá a ingresarlos.`);
          shouldInsertItems = true;
        }
      } else if (isActive) {
        // Insertar nuevo pedido activo en WMS
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${orderId}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${orderId} con estado 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;
      } else {
        console.log(`ℹ️ Pedido ${orderId} ignorado por estar en estado final (cancelado/entregado) y no existir en WMS.`);
      }

      if (localOrderId && shouldInsertItems) {

        for (const [sku, qty] of Object.entries(itemQuantities)) {
          // Buscar producto por SKU en la base de datos
          let { data: product } = await supabase
            .from('products')
            .select('id')
            .eq('merchant_id', integration.merchant_id)
            .eq('sku', sku)
            .maybeSingle();

          if (!product) {
            // Auto-crear producto faltante
            const orderItemDetail = allItems.find(item => (item.sellerSku || item.sku)?.replace(/\s+/g, '') === sku);
            const productName = orderItemDetail?.name || 'Producto París ' + sku;
            const productPrice = Number(orderItemDetail?.priceAfterDiscounts || orderItemDetail?.grossPrice || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                sku: sku,
                name: productName,
                price: productPrice,
                description: 'Creado automáticamente desde integración de París (Cencosud)',
                raw_paris_data: orderItemDetail
              }])
              .select('id')
              .single();

            if (!prodErr && newProd) {
              console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${productName}")`);
              product = newProd;
            } else {
              console.error(`   ❌ Error al crear producto para SKU ${sku}:`, prodErr?.message);
            }
          }

          if (product) {
            const { error: itemErr } = await supabase
              .from('order_items')
              .insert([{
                order_id: localOrderId,
                product_id: product.id,
                warehouse_id: warehouseId,
                quantity: qty
              }]);

            if (itemErr) {
              console.error(`   ❌ Error al registrar ítem SKU ${sku} para la orden:`, itemErr.message);
            } else {
              console.log(`   + Registrado ítem: SKU ${sku} x ${qty} (Stock Reservado)`);
            }
          } else {
            console.warn(`   ⚠️ SKU ${sku} no encontrado en base de datos. No se pudo registrar en la orden.`);
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
