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
async function syncTiendanubeData() {
  console.log('🔄 Iniciando sincronización con Tiendanube...');

  try {
    // 1. Obtener todas las integraciones activas de Tiendanube en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Tiendanube')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Tiendanube configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 Store ID / Shop URL: ${integration.shop_url}`);
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

      await syncMerchantTiendanube(integration);
    }

    console.log('\n🎉 Sincronización Tiendanube finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Sincroniza productos y pedidos de una integración específica
 */
async function syncMerchantTiendanube(integration) {
  // A. Obtener Store ID (limpiar URL para extraer solo números si el usuario ingresó una URL)
  const storeId = integration.shop_url.trim().replace(/[^0-9]/g, '');
  if (!storeId) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: No se pudo determinar el Store ID de Tiendanube desde "${integration.shop_url}". Debe ser numérico.`);
    return;
  }

  const accessToken = integration.access_token.trim();
  if (!accessToken) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Falta el Access Token de Tiendanube.`);
    return;
  }

  // B. Obtener bodega por defecto para el cliente
  let warehouseId = null;
  const { data: whRel } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', integration.merchant_id)
    .limit(1)
    .maybeSingle();

  if (whRel) {
    warehouseId = whRel.warehouse_id;
  } else {
    // Buscar la primera bodega disponible como fallback
    const { data: defaultWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
    if (defaultWh) {
      warehouseId = defaultWh.id;
    }
  }

  if (!warehouseId) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: No hay ninguna bodega configurada en el WMS.`);
    return;
  }

  // C. Definir cabeceras obligatorias (Tiendanube exige User-Agent descriptivo)
  const headers = {
    'Authentication': `bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'StockaWMS (integraciones@stocka.cl)'
  };

  // 1. Sincronizar Productos primero (recomendado para mapear SKUs correctamente)
  await syncProducts(integration, storeId, headers);

  // 2. Sincronizar Pedidos (Orders)
  await syncOrders(integration, storeId, headers, warehouseId);
}

/**
 * Sincroniza los productos desde Tiendanube
 */
async function syncProducts(integration, storeId, headers) {
  console.log('--> Extrayendo productos desde Tiendanube...');
  const url = `https://api.tiendanube.com/v1/${storeId}/products?per_page=100`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`Error en API Tiendanube Productos: Status ${response.status} ${response.statusText}`);
    }

    const products = await response.json();
    console.log(`Se encontraron ${products.length} productos base.`);

    const seenSkus = new Set();
    const productsToUpsert = [];
    for (const product of products) {
      // Tiendanube soporta variantes
      const mainImageUrl = product.images && product.images.length > 0 ? product.images[0].src : null;
      const status = product.published ? 'published' : 'hidden';

      for (const variant of product.variants) {
        let variantSku = variant.sku || '';
        let cleanSku = variantSku.trim().replace(/\s+/g, '');
        if (!cleanSku) continue; // Ignorar productos sin SKU

        const upperSku = cleanSku.toUpperCase();
        if (seenSkus.has(upperSku)) {
          let suffixIndex = 1;
          let newSku = `${cleanSku}-DUP-${suffixIndex}`;
          while (seenSkus.has(newSku.toUpperCase())) {
            suffixIndex++;
            newSku = `${cleanSku}-DUP-${suffixIndex}`;
          }
          cleanSku = newSku;
        }
        seenSkus.add(cleanSku.toUpperCase());

        // Si la variante tiene una imagen asignada en Tiendanube, la usamos, si no la del producto base
        let imageUrl = mainImageUrl;
        if (variant.image_id && product.images) {
          const matchedImg = product.images.find(img => img.id === variant.image_id);
          if (matchedImg && matchedImg.src) {
            imageUrl = matchedImg.src;
          }
        }

        // Construir nombre combinando el del producto con las opciones de variante (talle, color, etc.)
        const variantNameParts = [];
        if (variant.values) {
          for (const langKey of Object.keys(variant.values)) {
            // Tomamos el primer idioma disponible o español si existe
            const val = variant.values[langKey];
            if (val) {
              variantNameParts.push(val);
              break;
            }
          }
        }
        
        let productName = '';
        if (product.name) {
          productName = product.name.es || product.name.pt || Object.values(product.name)[0] || 'Producto sin nombre';
        }
        const finalName = variantNameParts.length > 0 ? `${productName} - ${variantNameParts.join(' / ')}` : productName;

        productsToUpsert.push({
          comercio: integration.comercio,
          platform: 'Tiendanube',
          sku: cleanSku,
          name: finalName,
          image_url: imageUrl,
          status: status,
          price: parseFloat(variant.price) || 0
        });
      }
    }

    if (productsToUpsert.length > 0) {
      const { error: upsertErr } = await supabase
        .from('synced_products')
        .upsert(productsToUpsert, { onConflict: 'comercio,platform,sku' });

      if (upsertErr) throw upsertErr;
      console.log(`📥 Se han sincronizado ${productsToUpsert.length} variantes de Tiendanube en synced_products.`);
    }
  } catch (error) {
    console.error(`❌ Error sincronizando productos para Tiendanube (${storeId}):`, error.message);
  }
}

/**
 * Sincroniza los pedidos desde Tiendanube
 */
async function syncOrders(integration, storeId, headers, warehouseId) {
  console.log('--> Extrayendo pedidos desde Tiendanube...');

  // Obtener sigla del comercio y configuración de prefijos por plataforma
  let siglaComercio = '';
  let prefijoOrigen = '';
  let agregarPrefijo = true;
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
        const platConfig = (adicionalConfig.plat_siglas_config || {})['Tiendanube'];
        if (platConfig) {
          hasPlatConfig = true;
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
        } else {
          // Fallback legacy
          agregarPrefijo = !adicionalConfig.pedido_trae_sigla;
        }
      } else {
        // Fallback default
        agregarPrefijo = true;
      }
      console.log(`ℹ️ Configuración de prefijo para Tiendanube: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
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
      equivalences.filter(e => e.platform === 'Tiendanube').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // Traer los pedidos recientes
  const url = `https://api.tiendanube.com/v1/${storeId}/orders?per_page=50`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      if (response.status === 404) {
        try {
          const errData = await response.clone().json();
          if (errData && errData.description === 'Last page is 0') {
            console.log('ℹ️ No hay pedidos registrados en la tienda (la API retornó Last page is 0).');
            return;
          }
        } catch (e) {
          // Si no es JSON o no tiene la descripción, continuar al error regular
        }
      }
      throw new Error(`Error en API Tiendanube Pedidos: Status ${response.status} ${response.statusText}`);
    }

    const orders = await response.json();
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      const orderId = order.id.toString();
      let orderNumber = (order.number ? order.number.toString() : orderId).trim();

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
      
      // Mapeo de estados en Tiendanube
      // status: open, closed, cancelled
      // payment_status: pending, paid, unpaid, abandoned, voided, refunded
      const statusName = order.status; 
      const paymentStatus = order.payment_status;

      console.log(`\nProcesando pedido Tiendanube ID: ${finalOrderNumber} (Estado: ${statusName}, Pago: ${paymentStatus})`);

      const isDelivered = order.shipping_status === 'delivered';
      const isCancelled = statusName === 'cancelled' || ['voided', 'refunded'].includes(paymentStatus);
      const isActive = !isDelivered && !isCancelled;

      // Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status')
        .eq('comercio', integration.comercio)
        .in('external_order_number', [orderNumber, finalOrderNumber])
        .maybeSingle();

      // Mapear campos planos de la orden
      const itemNames = [];
      const itemQuantities = {};
      
      for (const item of order.products) {
        let sku = item.sku || `TN-${item.product_id}${item.variant_id ? '-' + item.variant_id : ''}`;
        sku = sku.trim().replace(/\s+/g, '');
        // Aplicar equivalencia de SKU
        let mappedSku = skuMap[sku] || sku;
        itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity);

        const name = item.name ? (item.name.es || item.name.pt || Object.values(item.name)[0] || 'Producto') : 'Producto';
        if (name && !itemNames.includes(name)) {
          itemNames.push(name);
        }
      }

      const flatSku = Object.keys(itemQuantities).join(', ');
      const flatItemName = itemNames.join(', ');
      const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
      const totalValue = Number(order.total || 0);

      // Direcciones en Tiendanube
      const addr = order.shipping_address;
      let addressString = 'No especificada';
      let complementString = '';
      if (addr) {
        addressString = `${addr.address || ''} ${addr.number || ''}`.trim() || 'No especificada';
        complementString = [addr.floor, addr.locality, addr.province, addr.zipcode].filter(Boolean).join(', ');
      }

      const customerName = addr 
        ? `${addr.first_name || ''} ${addr.last_name || ''}`.trim() 
        : (order.contact_name || order.customer?.name || 'Cliente Tiendanube');

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderNumber,
        external_platform: 'Tiendanube',
        payment_status: paymentStatus === 'paid' ? 'PAID' : 'PENDING',
        total_value: totalValue,
        customer_email: order.contact_email || order.customer?.email || 'no-email@tiendanube.com',
        customer_phone: addr?.phone || order.contact_phone || 'No especificado',
        customer_name: customerName,
        shipping_address: addressString,
        shipping_city: addr?.city || 'No especificada',
        shipping_complement: complementString,
        shipping_method: order.shipping_option || 'Por definir',
        raw_tiendanube_data: order,
        origen: 'Tiendanube',
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku
      };

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        // Si el pedido se canceló, actualizar estado en WMS
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ ...orderDataToSave, status: 'cancelado' })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${finalOrderNumber} cancelado en Tiendanube. Actualizado en WMS.`);
        } else {
          // Actualizar datos generales manteniendo el estado WMS actual
          await supabase
            .from('orders')
            .update(orderDataToSave)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${finalOrderNumber}`);
        }
        localOrderId = existingOrder.id;

        // Validar si ya tiene ítems guardados (Healer/Auto-recuperación)
        const { data: existingItems, error: itemsCheckErr } = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', localOrderId);

        if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
          console.log(`ℹ️ Pedido existente ${finalOrderNumber} no tiene ítems registrados. Se ingresarán.`);
          shouldInsertItems = true;
        }
      } else if (isActive) {
        // Insertar nuevo pedido activo en WMS como 'para procesar'
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${finalOrderNumber}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${finalOrderNumber} en estado 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;
      } else {
        console.log(`ℹ5 Pedido ${finalOrderNumber} ignorado por estar en estado final y no existir en WMS.`);
      }

      // Registrar ítems en order_items
      if (localOrderId && shouldInsertItems) {
        for (const [sku, qty] of Object.entries(itemQuantities)) {
          // Buscar producto en la base de datos por merchant_id y sku
          let { data: product } = await supabase
            .from('products')
            .select('id')
            .eq('sku', sku)
            .eq('merchant_id', integration.merchant_id)
            .maybeSingle();

          if (!product) {
            // Mapeo inverso para obtener datos originales del item y crearlo
            const itemDetail = order.products.find(item => {
              let itemSku = item.sku || `TN-${item.product_id}${item.variant_id ? '-' + item.variant_id : ''}`;
              let cleanItemSku = itemSku.trim().replace(/\s+/g, '');
              let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
              return mappedItemSku === sku;
            });

            const pName = itemDetail?.name 
              ? (itemDetail.name.es || itemDetail.name.pt || Object.values(itemDetail.name)[0] || 'Producto Tiendanube ' + sku) 
              : 'Producto Tiendanube ' + sku;
            const productPrice = Number(itemDetail?.price || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
                sku: sku,
                name: pName,
                price: productPrice,
                description: 'Creado automáticamente desde integración de Tiendanube (al procesar pedido)'
              }])
              .select('id')
              .single();

            if (!prodErr && newProd) {
              console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${pName}")`);
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
              console.error(`   ❌ Error al registrar ítem SKU ${sku}:`, itemErr.message);
            } else {
              console.log(`   + Registrado ítem: SKU ${sku} x ${qty}`);
            }
          } else {
            console.warn(`   ⚠️ SKU ${sku} no encontrado en base de datos. No se pudo registrar en la orden.`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para Tiendanube (${storeId}):`, error.message);
  }
}

// Ejecutar script si se corre directamente
if (require.main === module) {
  syncTiendanubeData();
}
