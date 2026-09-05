const { createClient } = require('@supabase/supabase-js');

// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const fs = require('fs');

const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
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

const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOPIFY_CLIENT_ID = env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_CLIENT_ID || '4d04c58f432c53fb870d1fbcad92431c';
const SHOPIFY_CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_CLIENT_SECRET;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Renueva de forma proactiva el token de acceso de Shopify usando el refresh token
async function getValidShopifyToken(integration) {
  if (!integration.refresh_token) {
    return integration.access_token;
  }

  const clientSecret = SHOPIFY_CLIENT_SECRET || integration.webhook_secret;
  if (!clientSecret) {
    console.error(`[Shopify Sync] No hay client_secret disponible para ${integration.shop_url}`);
    return integration.access_token;
  }

  console.log(`[Shopify Sync] Renovando token de acceso para ${integration.shop_url}...`);
  const tokenUrl = `https://${integration.shop_url}/admin/oauth/access_token`;
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: integration.refresh_token
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Shopify Sync] Error al renovar token de Shopify: ${res.status} - ${errorText}`);
      return integration.access_token;
    }

    const data = await res.json();
    console.log(`[Shopify Sync] Token renovado con éxito.`);

    await supabase
      .from('merchant_integrations')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token
      })
      .eq('id', integration.id);

    return data.access_token;
  } catch (err) {
    console.error(`[Shopify Sync] Excepción al renovar token de Shopify:`, err.message);
    return integration.access_token;
  }
}

async function syncShopifyData() {
  console.log('Iniciando sincronización con Shopify...');

  // 1. Obtener todas las integraciones activas de Shopify
  const { data: integrations, error: intError } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify')
    .eq('is_active', true);

  if (intError) {
    console.error('Error al obtener integraciones:', intError);
    return;
  }

  if (!integrations || integrations.length === 0) {
    console.log('No hay integraciones activas de Shopify configuradas.');
    return;
  }

  for (const integration of integrations) {
    console.log(`\n================================`);
    console.log(`Procesando tienda: ${integration.shop_url}`);
    console.log(`Original Merchant ID: ${integration.merchant_id}`);
    
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
    console.log(`================================`);

    // Renovar token si es necesario
    const accessToken = await getValidShopifyToken(integration);
    integration.access_token = accessToken;

    // 2. Extraer y Guardar Pedidos (Orders)
    await syncOrders(integration);
    
    // 3. Extraer y Guardar Productos (Opcional por ahora, pero recomendado)
    await syncProducts(integration);
  }

  console.log('\nSincronización finalizada.');
}

async function syncOrders(integration) {
  console.log('--> Extrayendo pedidos...');
  const url = `https://${integration.shop_url}/admin/api/2024-04/orders.json?status=any&limit=250`;

  // Obtener sigla del comercio y configuración de prefijos por plataforma
  let siglaComercio = '';
  let prefijoOrigen = '';
  let agregarPrefijo = false; // Shopify default fallback is false
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
        const platConfig = (adicionalConfig.plat_siglas_config || {})['Shopify'];
        if (platConfig) {
          hasPlatConfig = true;
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
        } else {
          // Fallback legacy for Shopify
          agregarPrefijo = false;
        }
      } else {
        // Fallback default
        agregarPrefijo = false;
      }
      console.log(`ℹ️ Configuración de prefijo para Shopify: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
    } catch (err) {
      console.error('⚠️ Error al consultar configuración de sigla para el comercio:', err.message);
    }
  }

  // Cargar primera bodega asignada al comerciante
  const { data: whRelation } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', integration.merchant_id)
    .limit(1)
    .maybeSingle();
  const warehouseId = whRelation?.warehouse_id || null;

  // Cargar equivalencias de SKU
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
      equivalences.filter(e => e.platform === 'Shopify').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': integration.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Error en Shopify API: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const orders = data.orders;
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      let orderNumber = (order.name || '').toString().trim();

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

      // Intentar buscar si el pedido ya existe en nuestra BD
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, comercio, status, estado_wms, raw_shopify_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement')
        .eq('comercio', integration.comercio)
        .eq('external_order_number', finalOrderNumber)
        .eq('external_platform', 'Shopify')
        .maybeSingle();

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderNumber, // Ej: #1001
        external_platform: 'Shopify',
        payment_status: order.financial_status,
        total_value: order.current_total_price,
        customer_email: order.contact_email || order.email || order.customer?.email || null,
        customer_phone: order.shipping_address?.phone || order.billing_address?.phone || order.customer?.phone || null,
        customer_name: (order.shipping_address ? `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim() : null) || 
                       (order.billing_address ? `${order.billing_address.first_name || ''} ${order.billing_address.last_name || ''}`.trim() : null) ||
                       (order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : null) || 'No registrado',
        shipping_address: order.shipping_address?.address1,
        shipping_city: order.shipping_address?.city,
        shipping_complement: order.shipping_address?.address2,
        shipping_method: order.shipping_lines && order.shipping_lines.length > 0 ? order.shipping_lines[0].title : null,
        raw_shopify_data: order, // GUARDAMOS EL PAYLOAD COMPLETO AQUI
        created_at: new Date(order.created_at).toISOString()
      };

      if (order.cancelled_at) {
        orderDataToSave.status = 'cancelado';
        orderDataToSave.estado_wms = 'Cancelado';
      }

      let orderId;
      if (existingOrder) {
        const existingRaw = existingOrder.raw_shopify_data || {};
        const isWmsItemsEdited = existingOrder.wms_items_edited === true || existingRaw.wms_items_edited === true;
        const isWmsShippingEdited = existingOrder.wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;
        const orderDataToUpdate = { ...orderDataToSave };
        
        // Si el pedido fue editado manualmente en WMS, no sobrescribir SKU, item, cantidad ni total_value
        if (isWmsItemsEdited) {
          delete orderDataToUpdate.sku;
          delete orderDataToUpdate.item;
          delete orderDataToUpdate.cantidad;
          delete orderDataToUpdate.total_value;
        }

        // Si los datos de despacho fueron editados en WMS, no sobrescribir dirección ni datos de contacto
        if (isWmsShippingEdited) {
          delete orderDataToUpdate.customer_name;
          delete orderDataToUpdate.customer_email;
          delete orderDataToUpdate.customer_phone;
          delete orderDataToUpdate.shipping_address;
          delete orderDataToUpdate.shipping_city;
          delete orderDataToUpdate.shipping_complement;
        }

        // Preservar las banderas dentro de raw_shopify_data para que no se borren en sincronizaciones
        orderDataToUpdate.raw_shopify_data = {
          ...order,
          ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
          ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
          ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
        };

        // Actualizar pedido existente
        await supabase
          .from('orders')
          .update(orderDataToUpdate)
          .eq('id', existingOrder.id);
        orderId = existingOrder.id;
        console.log(`Actualizado pedido ${order.name}`);

        // Si el pedido fue editado en WMS o ya fue despachado, entregado, retirado o cancelado, NO tocar sus order_items
        if (isWmsItemsEdited || ['despachado', 'entregado', 'retirado', 'cancelado'].includes(existingOrder.status)) {
          console.log(`Omite sync de ítems para pedido ${order.name} (${isWmsItemsEdited ? 'Editado en WMS' : existingOrder.status})`);
          continue;
        }
      } else {
        // Insertar nuevo pedido (lo ponemos como "para procesar" o su equivalente)
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ 
            ...orderDataToSave, 
            status: orderDataToSave.status || 'para procesar',
            estado_wms: orderDataToSave.estado_wms || 'En procesamiento'
          }])
          .select('id')
          .single();
          
        if(insErr || !newOrder) {
            console.error(`Error al insertar pedido ${order.name}:`, insErr ? insErr.message : 'No se retornaron datos');
            continue;
        } else {
            orderId = newOrder.id;
            console.log(`Insertado nuevo pedido ${order.name}`);
        }
      }

      // Sincronizar ítems de la orden de forma inteligente (Smart Diffing)
      const { data: existingItems } = await supabase
        .from('order_items')
        .select('id, product_id, quantity, warehouse_id')
        .eq('order_id', orderId);

      // Cargar relaciones de packs del catálogo para desglosar packs de forma precisa
      const { data: packRelations } = await supabase
        .from('product_pack_items')
        .select('pack_product_id, member_product_id, quantity');
      
      const packMembersMap = new Map();
      (packRelations || []).forEach(pr => {
        if (!packMembersMap.has(pr.pack_product_id)) packMembersMap.set(pr.pack_product_id, []);
        packMembersMap.get(pr.pack_product_id).push({
          member_product_id: pr.member_product_id,
          quantity: pr.quantity || 1
        });
      });

      // 1. Calcular el desglose total de productos físicos esperados para la orden
      const expectedQuantities = new Map(); // product_id -> total_quantity
      const lineItems = order.line_items || [];

      for (const item of lineItems) {
        let product = null;
        let cleanSku = (item.sku || "").trim().replace(/\s+/g, '');
        let mappedSku = skuMap[cleanSku] || cleanSku;
        let hasEquivalence = !!skuMap[cleanSku];
        let fallbackSku = item.variant_id ? String(item.variant_id) : (item.id ? String(item.id) : 'NO-SKU');
        let searchSku = mappedSku || fallbackSku;

        // Buscar producto en catálogo por comercio y sku
        let query = supabase.from('products')
          .select('id, is_pack')
          .eq('sku', searchSku)
          .eq('comercio', integration.comercio);

        const { data: foundProduct } = await query.maybeSingle();
        product = foundProduct;

        // Auto-crear producto si no existe
        if (!product) {
          const targetSku = hasEquivalence ? mappedSku : (item.sku || fallbackSku);
          const { data: newProd, error: prodErr } = await supabase
            .from('products')
            .insert([{
              merchant_id: integration.merchant_id,
              comercio: integration.comercio,
              sku: targetSku,
              name: `${item.title}${item.variant_title && item.variant_title !== 'Default Title' ? ' - ' + item.variant_title : ''}`,
              price: item.price ? parseFloat(item.price) : 0,
              description: 'Creado automáticamente desde sincronización de Shopify' + (hasEquivalence ? ` (Equivalencia de SKU: ${cleanSku})` : ''),
              status: 'active'
            }])
            .select('id, is_pack')
            .single();

          if (!prodErr && newProd) {
            product = newProd;
          } else {
            console.error(`Error auto-creando producto SKU ${targetSku}:`, prodErr ? prodErr.message : 'Error desconocido');
          }
        }

        if (product) {
          const packMembers = packMembersMap.get(product.id);
          if (product.is_pack && packMembers && packMembers.length > 0) {
            for (const pm of packMembers) {
              const currentQty = expectedQuantities.get(pm.member_product_id) || 0;
              expectedQuantities.set(pm.member_product_id, currentQty + (item.quantity * pm.quantity));
            }
          } else {
            const currentQty = expectedQuantities.get(product.id) || 0;
            expectedQuantities.set(product.id, currentQty + item.quantity);
          }
        }
      }

      // 2. Conciliar contra existingItems consolidando duplicados
      const existingByProduct = new Map(); // product_id -> Array<existingItem>
      (existingItems || []).forEach(i => {
        if (!existingByProduct.has(i.product_id)) existingByProduct.set(i.product_id, []);
        existingByProduct.get(i.product_id).push(i);
      });

      for (const [prodId, expQty] of expectedQuantities.entries()) {
        const rows = existingByProduct.get(prodId) || [];
        if (rows.length === 0) {
          // No existe, insertar
          await supabase.from('order_items').insert([{
            order_id: orderId,
            product_id: prodId,
            warehouse_id: warehouseId,
            quantity: expQty
          }]);
        } else {
          // Si existe una o más filas, mantener solo la primera con la cantidad total esperada y eliminar duplicados
          const primaryRow = rows[0];
          if (primaryRow.quantity !== expQty || (warehouseId && primaryRow.warehouse_id !== warehouseId)) {
            await supabase.from('order_items').update({
              quantity: expQty,
              warehouse_id: warehouseId || primaryRow.warehouse_id
            }).eq('id', primaryRow.id);
          }
          if (rows.length > 1) {
            for (let k = 1; k < rows.length; k++) {
              await supabase.from('order_items').delete().eq('id', rows[k].id);
            }
          }
        }
      }

      // 3. Eliminar productos en la BD que ya no están en expectedQuantities
      for (const [prodId, rows] of existingByProduct.entries()) {
        if (!expectedQuantities.has(prodId)) {
          for (const r of rows) {
            await supabase.from('order_items').delete().eq('id', r.id);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
  }
}

async function syncProducts(integration) {
  console.log('--> Extrayendo productos...');

  let url = `https://${integration.shop_url}/admin/api/2024-04/products.json?limit=250`;
  const seenSkus = new Set();
  const productsToUpsert = [];
  let pageCount = 0;

  try {
    while (url) {
      pageCount++;
      console.log(`[Shopify Product Sync] Cargando página ${pageCount}...`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': integration.access_token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Error en Shopify API: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const products = data.products || [];
      console.log(`Se encontraron ${products.length} productos base en la página ${pageCount}.`);

      for (const product of products) {
        // Intentar obtener la imagen principal del producto
        let imageUrl = null;
        if (product.image && product.image.src) {
          imageUrl = product.image.src;
        } else if (product.images && product.images.length > 0) {
          imageUrl = product.images[0].src;
        }

        for (const variant of product.variants) {
          let variantSku = variant.sku || (variant.id ? String(variant.id) : '');
          let cleanSku = variantSku.trim();
          if (!cleanSku) continue;

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

          // Si la variante tiene una imagen específica, la usamos, si no usamos la del producto principal
          let varImageUrl = imageUrl;
          if (product.images && variant.image_id) {
            const matchedImg = product.images.find(img => img.id === variant.image_id);
            if (matchedImg && matchedImg.src) {
              varImageUrl = matchedImg.src;
            }
          }

          productsToUpsert.push({
            comercio: integration.comercio,
            platform: 'Shopify',
            sku: cleanSku,
            name: `${product.title}${variant.title !== 'Default Title' ? ' - ' + variant.title : ''}`,
            image_url: varImageUrl,
            status: product.status,
            price: parseFloat(variant.price) || 0,
            barcode: variant.barcode || null
          });
        }
      }

      // Revisar encabezado Link para la siguiente página
      const linkHeader = response.headers.get('link');
      url = null;
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) {
          url = nextMatch[1];
        }
      }
    }

    if (productsToUpsert.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < productsToUpsert.length; i += batchSize) {
        const batch = productsToUpsert.slice(i, i + batchSize);
        const { error: upsertErr } = await supabase
          .from('synced_products')
          .upsert(batch, { onConflict: 'comercio,platform,sku' });

        if (upsertErr) throw upsertErr;
      }
      console.log(`Se han sincronizado ${productsToUpsert.length} variantes en synced_products.`);
    }

  } catch (error) {
    console.error(`Error sincronizando productos para ${integration.shop_url}:`, error.message);
  }
}

// Ejecutar el script
syncShopifyData();
