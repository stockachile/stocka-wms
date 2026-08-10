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

      // Resolver dinámicamente el merchant_id real usando productos del comercio
      let activeMerchantId = integration.merchant_id;
      try {
        const { data: siblingProd } = await supabase
          .from('products')
          .select('merchant_id')
          .eq('comercio', integration.comercio)
          .limit(1)
          .maybeSingle();
        if (siblingProd && siblingProd.merchant_id) {
          activeMerchantId = siblingProd.merchant_id;
        }
      } catch (err) {
        console.error('Error al resolver merchant_id activo:', err.message);
      }
      
      if (activeMerchantId !== integration.merchant_id) {
        console.log(`Resolved Client Merchant ID: ${activeMerchantId}`);
        integration.merchant_id = activeMerchantId;
      }

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

  // Obtener sigla del comercio y configuración de prefijos por plataforma
  let siglaComercio = '';
  let prefijoOrigen = '';
  let agregarPrefijo = false; // Paris default is false
  let hasPlatConfig = false;

  if (integration.comercio) {
    try {
      const { data: configData } = await supabase
        .from('v_comercios_config')
        .select('sigla')
        .eq('nombre', integration.comercio)
        .maybeSingle();

      if (configData && configData.sigla) {
        siglaComercio = configData.sigla.trim().toUpperCase();
      }

      const { data: adicionalConfig } = await supabase
        .from('comercios_adicional_config')
        .select('pedido_trae_sigla, plat_siglas_config')
        .eq('comercio', integration.comercio)
        .maybeSingle();

      if (adicionalConfig) {
        const platConfig = (adicionalConfig.plat_siglas_config || {})['Paris'];
        if (platConfig) {
          hasPlatConfig = true;
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
        } else {
          // Fallback legacy
          agregarPrefijo = false;
        }
      } else {
        // Fallback default
        agregarPrefijo = false;
      }
      console.log(`ℹ️ Configuración de prefijo para Paris: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
    } catch (err) {
      console.error('⚠️ Error al consultar configuración de sigla para el comercio:', err.message);
    }
  }

  // Cargar equivalencias de SKU para este comercio
  const skuMap = {};
  try {
    const { data: equivalences } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform')
      .eq('comercio', integration.comercio);
    
    if (equivalences) {
      equivalences.filter(e => e.platform === 'Todas').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
      equivalences.filter(e => e.platform === 'Paris').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
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
      const orderId = order.subOrderNumber || order.originOrderNumber || order.id;
      let orderNumber = orderId.toString().trim();

      // 1. Quitar prefijo de origen si coincide
      if (prefijoOrigen && orderNumber.toUpperCase().startsWith(prefijoOrigen)) {
        orderNumber = orderNumber.substring(prefijoOrigen.length).trim();
      }

      // 2. Aplicar prefijo del WMS si corresponde
      let finalOrderId = orderNumber;
      if (agregarPrefijo && siglaComercio) {
        if (!orderNumber.toUpperCase().startsWith(siglaComercio)) {
          finalOrderId = `${siglaComercio}${orderNumber}`;
        }
      }
      // Resolver estados desde subOrders
      let isCancelled = false;
      let isDelivered = false;
      let statusName = 'created';

      if (order.subOrders && Array.isArray(order.subOrders) && order.subOrders.length > 0) {
        // Cencosud maneja estados a nivel de subOrders
        isCancelled = order.subOrders.every(so => {
          const sName = (so.status?.name || '').toLowerCase();
          const sDesc = (so.status?.description || '').toLowerCase();
          return sName.includes('cancel') || sDesc.includes('cancel') || so.status?.id === 2;
        });

        isDelivered = order.subOrders.some(so => {
          const sName = (so.status?.name || '').toLowerCase();
          return sName === 'delivered' || so.status?.id === 4;
        });

        // Usar el estado del primer sub-pedido como descriptivo principal
        statusName = order.subOrders[0].status?.name || 'created';
      }

      console.log(`\nProcesando pedido París ID: ${finalOrderId} (Estado actual resolved: ${statusName}, isCancelled: ${isCancelled}, isDelivered: ${isDelivered})`);
      
      const isActive = !isDelivered && !isCancelled;

      // 1. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, comercio')
        .eq('comercio', integration.comercio)
        .in('external_order_number', [orderNumber, finalOrderId])
        .eq('external_platform', 'Paris')
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
          let cleanSku = sku.replace(/\s+/g, '');
          // Aplicar equivalencia de SKU
          let mappedSku = skuMap[cleanSku] || cleanSku;
          itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + 1;
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

      // Calcular método de envío y SLA límite
      const mainSubOrder = order.subOrders && order.subOrders[0];
      let baseMethod = 'Despacho París';
      let limitDateStr = null;
      if (mainSubOrder) {
        baseMethod = mainSubOrder.carrier || (mainSubOrder.deliveryOption?.translate || mainSubOrder.deliveryOption?.name || 'Despacho París');
        // Priorizar la fecha límite de despacho (dispatchDate) que es el compromiso del vendedor
        limitDateStr = mainSubOrder.dispatchDate || mainSubOrder.arrivalDateEnd || mainSubOrder.arrivalDate;
      }
      
      let shippingMethodVal = baseMethod;
      if (limitDateStr) {
        const parts = limitDateStr.split('-');
        if (parts.length === 3) {
          const year = parts[0].slice(-2);
          const month = parts[1];
          const day = parts[2];
          shippingMethodVal = `${baseMethod} (Límite: ${day}/${month}/${year})`;
        }
      }

      // Mapear datos comunes del pedido
      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderId,
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
        shipping_method: shippingMethodVal,
        // Nuevas columnas planas solicitadas
        origen: 'Paris',
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku,
        created_at: new Date(order.originOrderDate || order.createdAt || new Date()).toISOString()
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
          console.log(`🚫 Pedido ${finalOrderId} cancelado en París. Actualizado en el WMS.`);
        } else {
          // Actualizar datos del pedido manteniendo el estado WMS actual
          await supabase
            .from('orders')
            .update(orderDataToSave)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${finalOrderId}`);
        }
        localOrderId = existingOrder.id;

        // Mecanismo de auto-recuperación (Healer):
        // Verificar si la orden existente ya tiene items en la tabla order_items
        const { data: existingItems, error: itemsCheckErr } = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', localOrderId);

        if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
          console.log(`ℹ️ Pedido existente ${finalOrderId} no tiene ítems registrados. Se procederá a ingresarlos.`);
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
          console.error(`❌ Error al insertar pedido local ${finalOrderId}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${finalOrderId} con estado 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;
      } else {
        console.log(`ℹ️ Pedido ${finalOrderId} ignorado por estar en estado final (cancelado/entregado) y no existir en WMS.`);
      }

      if (localOrderId && shouldInsertItems) {

        for (const [sku, qty] of Object.entries(itemQuantities)) {
          // Buscar producto por SKU en la base de datos
          let { data: product } = await supabase
            .from('products')
            .select('id, comercio')
            .eq('comercio', integration.comercio)
            .eq('sku', sku)
            .maybeSingle();

          if (product && product.comercio !== integration.comercio) {
            // Actualizar el comercio para mantenerlo al día con la integración
            await supabase
              .from('products')
              .update({ comercio: integration.comercio })
              .eq('id', product.id);
            product.comercio = integration.comercio;
          }

          if (!product) {
            // Auto-crear producto faltante
            const orderItemDetail = allItems.find(item => {
              let itemSku = item.sellerSku || item.sku;
              if (!itemSku) return false;
              let cleanItemSku = itemSku.replace(/\s+/g, '');
              let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
              return mappedItemSku === sku;
            });
            const productName = orderItemDetail?.name || 'Producto París ' + sku;
            const productPrice = Number(orderItemDetail?.priceAfterDiscounts || orderItemDetail?.grossPrice || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
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
