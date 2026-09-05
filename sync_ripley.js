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
async function syncRipleyData() {
  console.log('🔄 Iniciando sincronización con Ripley Marketplace (Mirakl API)...');

  try {
    // 1. Obtener todas las integraciones activas de Ripley en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Ripley')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Ripley configuradas.');
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
 * Mapea el estado de la orden de Ripley (Mirakl) al WMS STOCKA
 */
function mapRipleyStatus(statusName) {
  const s = (statusName || '').toUpperCase().trim();
  if (['CANCELED', 'REFUSED', 'CANCELLED'].includes(s)) {
    return 'cancelado';
  }
  if (['SHIPPED', 'RECEIVED', 'CLOSED'].includes(s)) {
    return 'despachado';
  }
  if (['WAITING_ACCEPTANCE', 'WAITING_DEBIT_PAYMENT', 'WAITING_SHIPPING'].includes(s)) {
    return 'para procesar';
  }
  if (['SHIPPING', 'PACKING'].includes(s)) {
    return 'en preparación';
  }
  return 'para procesar';
}

/**
 * Sincroniza los pedidos de un cliente específico de Ripley
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
  let agregarPrefijo = false;
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
        const platConfig = (adicionalConfig.plat_siglas_config || {})['Ripley'];
        if (platConfig) {
          hasPlatConfig = true;
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
        } else {
          agregarPrefijo = false;
        }
      } else {
        agregarPrefijo = false;
      }
      console.log(`ℹ️ Configuración de prefijo para Ripley: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
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
      equivalences.filter(e => e.platform === 'Ripley').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // B. Normalizar URL base de la API de Ripley (Mirakl)
  let baseUrl = integration.shop_url.trim();
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  // Asegurar que la URL termine en /api
  let apiUrl = baseUrl;
  if (!apiUrl.includes('/api')) {
    apiUrl += '/api';
  }

  try {
    console.log(`--> Consultando pedidos en la API de Ripley (Mirakl)...`);
    const ordersUrl = `${apiUrl}/orders?limit=100&paginate=false`;
    
    const ordersRes = await fetch(ordersUrl, {
      method: 'GET',
      headers: {
        'Authorization': integration.access_token,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!ordersRes.ok) {
      throw new Error(`Error en API de Ripley (Mirakl): ${ordersRes.status} ${ordersRes.statusText}`);
    }

    const data = await ordersRes.json();
    const orders = data.orders || [];
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      const orderId = order.commercial_id || order.order_id;
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

      const statusName = order.order_state || 'STAGING';
      console.log(`\nProcesando pedido Ripley ID: ${finalOrderId} (Estado origen: ${statusName})`);

      const targetStatus = mapRipleyStatus(statusName);
      const isCancelled = targetStatus === 'cancelado';
      const isDelivered = targetStatus === 'despachado';
      const isActive = !isDelivered && !isCancelled;

      // 1. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, estado_wms, comercio, raw_ripley_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement, wms_items_edited, wms_shipping_edited')
        .eq('comercio', integration.comercio)
        .in('external_order_number', [orderNumber, finalOrderId])
        .eq('external_platform', 'Ripley')
        .maybeSingle();

      const customer = order.customer || {};
      const shippingAddress = customer.shipping_address || customer.billing_address || {};
      const customerName = `${shippingAddress.firstname || customer.firstname || ''} ${shippingAddress.lastname || customer.lastname || ''}`.trim() || 'Cliente Ripley';
      const customerPhone = shippingAddress.phone || shippingAddress.phone_secondary || 'No especificado';
      const customerEmail = customer.email || 'no-email@ripley.cl';
      const address = shippingAddress.street_1 || shippingAddress.street_2 || 'No especificada';
      const city = shippingAddress.city || 'No especificada';
      const complement = [shippingAddress.street_2, shippingAddress.additional_info].filter(Boolean).join(', ') || '';

      // Agrupar ítems por SKU y recolectar nombres
      const allLines = order.order_lines || [];
      const itemQuantities = {};
      const itemNames = [];
      
      for (const item of allLines) {
        let sku = item.offer_sku || item.product_sku;
        if (sku) {
          let cleanSku = sku.replace(/\s+/g, '');
          let mappedSku = skuMap[cleanSku] || cleanSku;
          itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity || 1);
        }
        if (item.product_title && !itemNames.includes(item.product_title)) {
          itemNames.push(item.product_title);
        }
      }

      const flatSku = Object.keys(itemQuantities).join(', ');
      const flatItemName = itemNames.join(', ');
      const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);

      // Calcular valor total de la orden
      const totalValue = Number(order.total_price || 0);

      // Calcular método de envío
      const baseMethod = order.shipping_type_label || order.shipping_company || 'Despacho Ripley';
      let shippingMethodVal = baseMethod;
      if (order.shipping_deadline) {
        try {
          const dlDate = new Date(order.shipping_deadline);
          const day = dlDate.getDate().toString().padStart(2, '0');
          const month = (dlDate.getMonth() + 1).toString().padStart(2, '0');
          const year = dlDate.getFullYear().toString().slice(-2);
          shippingMethodVal = `${baseMethod} (Límite: ${day}/${month}/${year})`;
        } catch (e) {}
      }

      // Mapear datos comunes del pedido
      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderId,
        external_platform: 'Ripley',
        payment_status: statusName,
        total_value: totalValue,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        customer_name: customerName,
        shipping_address: address,
        shipping_city: city,
        shipping_complement: complement,
        raw_ripley_data: order,
        shipping_method: shippingMethodVal,
        origen: 'Ripley',
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku,
        created_at: new Date(order.created_date || new Date()).toISOString()
      };

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        const existingRaw = existingOrder.raw_ripley_data || {};
        const isWmsItemsEdited = existingOrder.wms_items_edited === true || existingRaw.wms_items_edited === true;
        const isWmsShippingEdited = existingOrder.wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;
        const orderDataToUpdate = { ...orderDataToSave };

        if (isWmsItemsEdited) {
          delete orderDataToUpdate.sku;
          delete orderDataToUpdate.item;
          delete orderDataToUpdate.cantidad;
          delete orderDataToUpdate.total_value;
        }

        if (isWmsShippingEdited) {
          delete orderDataToUpdate.customer_name;
          delete orderDataToUpdate.customer_email;
          delete orderDataToUpdate.customer_phone;
          delete orderDataToUpdate.shipping_address;
          delete orderDataToUpdate.shipping_city;
          delete orderDataToUpdate.shipping_complement;
        }

        orderDataToUpdate.raw_ripley_data = {
          ...order,
          ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
          ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
          ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
        };

        // No sobreescribir estados terminales en WMS
        const isTerminalWMS = ['despachado', 'cancelado', 'entregado', 'retirado'].includes(existingOrder.status);
        
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ ...orderDataToUpdate, status: 'cancelado' })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${finalOrderId} cancelado en Ripley. Actualizado en el WMS.`);
        } else if (!isTerminalWMS) {
          // Actualizar datos del pedido manteniendo el estado WMS actual o transicionando a despachado
          if (isDelivered) {
            orderDataToUpdate.status = 'despachado';
          }
          await supabase
            .from('orders')
            .update(orderDataToUpdate)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${finalOrderId}`);
        } else {
          // Si ya está terminal, actualizar solo la metadata cruda y de soporte sin tocar estado ni items editados
          await supabase
            .from('orders')
            .update({
              raw_ripley_data: orderDataToUpdate.raw_ripley_data,
              payment_status: statusName
            })
            .eq('id', existingOrder.id);
          console.log(`ℹ️ Pedido local ${finalOrderId} ya está en estado terminal '${existingOrder.status}'. Sincronizados datos crudos.`);
        }
        localOrderId = existingOrder.id;

        // Verificar si tiene ítems registrados (solo si no fue editado en WMS)
        if (!isWmsItemsEdited) {
          const { data: existingItems, error: itemsCheckErr } = await supabase
            .from('order_items')
            .select('id')
            .eq('order_id', localOrderId);

          if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
            shouldInsertItems = true;
          }
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
            await supabase
              .from('products')
              .update({ comercio: integration.comercio })
              .eq('id', product.id);
            product.comercio = integration.comercio;
          }

          if (!product) {
            // Auto-crear producto faltante
            const orderItemDetail = allLines.find(item => {
              let itemSku = item.offer_sku || item.product_sku;
              if (!itemSku) return false;
              let cleanItemSku = itemSku.replace(/\s+/g, '');
              let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
              return mappedItemSku === sku;
            });
            
            const productName = orderItemDetail?.product_title || 'Producto Ripley ' + sku;
            const productPrice = Number(orderItemDetail?.price || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
                sku: sku,
                name: productName,
                price: productPrice,
                description: 'Creado automáticamente desde integración de Ripley (Mirakl)',
                raw_ripley_data: orderItemDetail
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
syncRipleyData();
