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
async function syncJumpsellerData() {
  console.log('🔄 Iniciando sincronización con Jumpseller...');

  try {
    // 1. Obtener todas las integraciones activas de Jumpseller en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Jumpseller')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Jumpseller configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 URL Tienda: ${integration.shop_url}`);
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

      await syncMerchantJumpseller(integration);
    }

    console.log('\n🎉 Sincronización Jumpseller finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Sincroniza productos y pedidos de una integración específica
 */
async function syncMerchantJumpseller(integration) {
  // A. Parsear credenciales desde el access_token
  let loginKey, authToken;
  try {
    const creds = JSON.parse(integration.access_token);
    loginKey = creds.login_key;
    authToken = creds.auth_token;
  } catch (e) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Formato de access_token inválido. Debe ser un JSON conteniendo login_key y auth_token.`);
    return;
  }

  if (!loginKey || !authToken) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Faltan login_key o auth_token en las credenciales guardadas.`);
    return;
  }

  // B. Obtener bodega por defecto para el cliente
  let warehouseId = null;
  const { data: whRel, error: whErr } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', integration.merchant_id)
    .maybeSingle();

  if (whErr) {
    console.error('❌ Error al obtener bodega por defecto:', whErr.message);
  }
  
  warehouseId = whRel?.warehouse_id;
  if (!warehouseId) {
    const { data: defaultWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
    if (defaultWh) {
      warehouseId = defaultWh.id;
    }
  }

  if (!warehouseId) {
    console.warn('⚠️ Advertencia: No se encontró bodega por defecto asignada para este comercio. Se usará un valor nulo o se omitirá la inserción de ítems.');
  }

  const basicAuth = Buffer.from(`${loginKey}:${authToken}`).toString('base64');
  const headers = {
    'X-LOGIN-KEY': loginKey,
    'X-AUTH-TOKEN': authToken,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json'
  };

  // C. Sincronizar Productos primero (para asegurar mapeos en órdenes)
  await syncProducts(integration, headers);

  // D. Sincronizar Pedidos
  await syncOrders(integration, headers, warehouseId);
}

/**
 * Sincroniza el catálogo de productos de Jumpseller
 */
async function syncProducts(integration, headers) {
  console.log('--> Extrayendo productos desde Jumpseller...');

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
      equivalences.filter(e => e.platform === 'Jumpseller').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  const productsToUpsert = [];
  let page = 1;
  let hasMore = true;

  try {
    while (hasMore) {
      const url = `https://api.jumpseller.com/v1/products.json?limit=100&page=${page}`;
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        throw new Error(`Error en Jumpseller API (Página ${page}): ${response.status} ${response.statusText}`);
      }

      const productsList = await response.json();
      if (!Array.isArray(productsList) || productsList.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Página ${page}: se obtuvieron ${productsList.length} productos de Jumpseller.`);

      for (const item of productsList) {
        const p = item.product;
        const imageUrl = (p.images && p.images.length > 0 && p.images[0].url) ? p.images[0].url : null;
        const mainPrice = parseFloat(p.price) || 0;
        const mainBarcode = p.barcode ? String(p.barcode).trim() : null;

        // Un producto en Jumpseller puede o no tener variantes
        if (!p.variants || p.variants.length === 0) {
          let variantSku = p.sku || `JS-${p.id}`;
          let cleanSku = variantSku.trim().replace(/\s+/g, '');

          productsToUpsert.push({
            comercio: integration.comercio,
            platform: 'Jumpseller',
            sku: cleanSku,
            name: p.name,
            price: mainPrice,
            image_url: imageUrl,
            status: p.status || null,
            barcode: mainBarcode
          });
        } else {
          // Si tiene variantes
          for (const variantWrapper of p.variants) {
            const v = variantWrapper ? (variantWrapper.variant || variantWrapper) : null;
            if (!v) continue;
            let variantSku = v.sku || `JS-${p.id}-${v.id}`;
            let cleanSku = variantSku.trim().replace(/\s+/g, '');

            let varImageUrl = imageUrl;
            if (p.images && v.image_id) {
              const matchedImg = p.images.find(img => img.id === v.image_id);
              if (matchedImg && matchedImg.url) {
                varImageUrl = matchedImg.url;
              }
            }

            productsToUpsert.push({
              comercio: integration.comercio,
              platform: 'Jumpseller',
              sku: cleanSku,
              name: `${p.name} - Variante ${v.id}`,
              price: parseFloat(v.price) || mainPrice,
              image_url: varImageUrl,
              status: p.status || null,
              barcode: (v.barcode ? String(v.barcode).trim() : null) || mainBarcode
            });
          }
        }
      }

      if (productsList.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    if (productsToUpsert.length > 0) {
      const batchSize = 200;
      for (let i = 0; i < productsToUpsert.length; i += batchSize) {
        const batch = productsToUpsert.slice(i, i + batchSize);
        const { error: upsertErr } = await supabase
          .from('synced_products')
          .upsert(batch, { onConflict: 'comercio,platform,sku' });

        if (upsertErr) {
          console.error(`❌ Error en batch upsert de synced_products:`, upsertErr.message);
        }
      }
      console.log(`📥 Total de ${productsToUpsert.length} variantes/productos sincronizados en synced_products para ${integration.comercio}.`);
    }
  } catch (error) {
    console.error(`❌ Error sincronizando productos para ${integration.shop_url}:`, error.message);
  }
}

/**
 * Sincroniza los pedidos de Jumpseller
 */
async function syncOrders(integration, headers, warehouseId) {
  console.log('--> Extrayendo pedidos desde Jumpseller...');

  // Obtener sigla del comercio y configuración de prefijos por plataforma
  let siglaComercio = '';
  let prefijoOrigen = '';
  let agregarPrefijo = false; // Jumpseller default is false
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
        const platConfig = (adicionalConfig.plat_siglas_config || {})['Jumpseller'];
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
      console.log(`ℹ️ Configuración de prefijo para Jumpseller: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
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
      equivalences.filter(e => e.platform === 'Jumpseller').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  const url = `https://api.jumpseller.com/v1/orders.json?limit=50`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`Error en Jumpseller API Pedidos: ${response.status} ${response.statusText}`);
    }

    const ordersList = await response.json();
    console.log(`Se encontraron ${ordersList.length} pedidos.`);

    for (const item of ordersList) {
      const o = item.order;
      let orderNumber = `#JS-${o.id}`;

      // 1. Quitar prefijo de origen si coincide
      if (prefijoOrigen && orderNumber.toUpperCase().startsWith(prefijoOrigen)) {
        orderNumber = orderNumber.substring(prefijoOrigen.length).trim();
      }

      // 2. Aplicar prefijo del WMS si corresponde
      let finalOrderNumber = orderNumber;
      if (agregarPrefijo && siglaComercio) {
        if (!orderNumber.toUpperCase().startsWith(siglaComercio)) {
          finalOrderNumber = `${siglaComercio}${orderNumber}`;
        }
      }
      const statusName = o.status; // 'Pending', 'Paid', 'Canceled', 'Abandoned', 'Open'

      console.log(`\nProcesando pedido Jumpseller ID: ${finalOrderNumber} (Estado actual: ${statusName})`);

      // Clasificación de estados
      const isDelivered = o.shipment_status === 'shipped' || o.shipment_status === 'delivered';
      const isCancelled = ['Canceled', 'Abandoned', 'Open'].includes(statusName);
      const isActive = !isDelivered && !isCancelled;

      // Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, estado_wms, raw_jumpseller_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement')
        .eq('comercio', integration.comercio)
        .in('external_order_number', [orderNumber, finalOrderNumber])
        .eq('external_platform', 'Jumpseller')
        .maybeSingle();

      // Mapear campos planos de la orden y cantidades de items
      const itemNames = [];
      const itemQuantities = {};

      if (o.products) {
        for (const op of o.products) {
          let sku = op.sku || `JS-${op.product_id}${op.variant_id ? '-' + op.variant_id : ''}`;
          sku = sku.trim().replace(/\s+/g, '');
          let mappedSku = skuMap[sku] || sku;

          itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(op.qty || op.quantity || 1);
          if (op.name && !itemNames.includes(op.name)) {
            itemNames.push(op.name);
          }
        }
      }

      const flatSku = Object.keys(itemQuantities).join(', ');
      const flatItemName = itemNames.join(', ');
      const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
      const totalValue = Number(o.total || 0);

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderNumber,
        external_platform: 'Jumpseller',
        origen: 'Jumpseller',
        payment_status: statusName === 'Paid' ? 'PAID' : 'PENDING',
        total_value: totalValue,
        customer_email: o.customer?.email || o.shipping_address?.email || o.billing_address?.email,
        customer_phone: o.customer?.phone || o.shipping_address?.phone || o.billing_address?.phone,
        customer_name: o.customer?.name || o.shipping_address?.name || o.billing_address?.name || 'Cliente Jumpseller',
        shipping_address: o.shipping_address?.address || o.billing_address?.address,
        shipping_city: o.shipping_address?.city || o.billing_address?.city,
        shipping_complement: o.shipping_address?.municipality || o.shipping_address?.region || '',
        shipping_method: o.shipping_method_name || (o.shipping_option === 'store_pickup' ? 'Retiro en Tienda' : 'Despacho a Domicilio'),
        sku: flatSku || 'Sin SKU',
        item: flatItemName || 'Sin Nombre',
        cantidad: flatQuantity || 1,
        raw_jumpseller_data: o,
        created_at: new Date(o.created_at).toISOString()
      };

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        const existingRaw = existingOrder.raw_jumpseller_data || {};
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

        orderDataToUpdate.raw_jumpseller_data = {
          ...o,
          ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
          ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
          ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
        };

        // Actualizar datos del pedido existente en el WMS
        await supabase
          .from('orders')
          .update(orderDataToUpdate)
          .eq('id', existingOrder.id);
        console.log(`📝 Actualizado pedido local ${orderNumber}`);
        localOrderId = existingOrder.id;

        // Auto-recuperación (Healer): Validar si ya tiene ítems guardados (solo si no fue editado en WMS)
        if (!isWmsItemsEdited) {
          const { data: existingItems, error: itemsCheckErr } = await supabase
            .from('order_items')
            .select('id')
            .eq('order_id', localOrderId);

          if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
            console.log(`ℹ️ Pedido existente ${orderNumber} no tiene ítems registrados. Se procederá a ingresarlos.`);
            shouldInsertItems = true;
          }
        }
      } else if (isActive) {
        // Insertar nuevo pedido activo en WMS con estado 'para procesar'
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${orderNumber}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${orderNumber} con estado 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;
      } else {
        console.log(`ℹ️ Pedido ${orderNumber} ignorado por estar en estado final (cancelado/entregado) y no existir en el WMS.`);
      }

      // Registrar ítems en order_items
      if (localOrderId && shouldInsertItems) {
        for (const [sku, qty] of Object.entries(itemQuantities)) {
          // Buscar producto en la base de datos
           let { data: product } = await supabase
            .from('products')
            .select('id')
            .eq('sku', sku)
            .eq('comercio', integration.comercio)
            .maybeSingle();

          if (!product) {
            // Buscar detalle del item original usando mapeo inverso
            const itemDetail = o.products.find(op => {
              let opSku = op.sku || `JS-${op.product_id}${op.variant_id ? '-' + op.variant_id : ''}`;
              let cleanItemSku = opSku.trim().replace(/\s+/g, '');
              let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
              return mappedItemSku === sku;
            });

            // Auto-crear producto faltante en WMS
            const productName = itemDetail?.name || 'Producto Jumpseller ' + sku;
            const productPrice = Number(itemDetail?.price || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
                sku: sku,
                name: productName,
                price: productPrice,
                description: 'Creado automáticamente desde integración de Jumpseller (al procesar pedido)'
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

          if (product && warehouseId) {
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
            console.warn(`   ⚠️ SKU ${sku} no encontrado en base de datos o sin bodega por defecto. No se pudo registrar en la orden.`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
  }
}

// Ejecutar el script
syncJumpsellerData();
