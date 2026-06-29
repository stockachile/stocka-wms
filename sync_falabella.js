const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
// UTILERÍAS DE FIRMA Y API FALABELLA
// ==========================================
function buildSignedUrl(baseUrl, apiKey, userId, action, extraParams = {}) {
  const ahora = new Date();
  const timestamp = ahora.toISOString().split('.')[0] + 'Z';
  
  const params = {
    'Action': action,
    'Format': 'JSON',
    'Timestamp': timestamp,
    'UserID': userId,
    'Version': '1.0',
    ...extraParams
  };

  // Ordenar alfabéticamente por claves para la firma
  const queryString = Object.keys(params)
    .sort()
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');

  const signature = crypto.createHmac('sha256', apiKey).update(queryString).digest('hex');
  
  let finalBaseUrl = baseUrl.trim();
  if (!finalBaseUrl.startsWith('http://') && !finalBaseUrl.startsWith('https://')) {
    finalBaseUrl = 'https://' + finalBaseUrl;
  }
  if (!finalBaseUrl.endsWith('/')) {
    finalBaseUrl += '/';
  }
  
  return `${finalBaseUrl}?${queryString}&Signature=${signature}`;
}

// ==========================================
// FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncFalabellaData() {
  console.log('🔄 Sincronizando con Falabella Seller Center (Mirakl API)...');

  try {
    // 1. Obtener todas las integraciones activas de Falabella en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Falabella')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Falabella configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 URL Base: ${integration.shop_url}`);
      console.log(`📧 UserID: ${integration.username}`);
      console.log(`========================================`);

      await syncMerchantOrders(integration);
    }

    console.log('\n🎉 Sincronización finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Mapea el estado de Falabella (Mirakl) al WMS STOCKA
 */
function mapFalabellaStatus(statusName) {
  const s = (statusName || '').toLowerCase().trim();
  if (s.includes('cancel') || s.includes('refund') || s.includes('refus')) {
    return 'cancelado';
  }
  if (s.includes('ship') || s.includes('send') || s.includes('dispatch') || s.includes('deliv') || s.includes('receiv') || s.includes('close')) {
    // Para pedidos despachados o entregados, asignamos 'despachado'
    // Esto asegura que se descuente el stock físico al realizar la actualización de estado
    return 'despachado';
  }
  if (s.includes('accept') || s.includes('prepar') || s.includes('pack')) {
    return 'en preparación';
  }
  return 'para procesar';
}

/**
 * Sincroniza los pedidos de un cliente específico de Falabella
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
      equivalences.filter(e => e.platform === 'Falabella').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  try {
    // 1. Obtener pedidos de los últimos 7 días
    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);
    const createdAfter = hace7Dias.toISOString().split('.')[0] + 'Z';

    console.log(`--> Consultando pedidos creados después de: ${createdAfter}`);
    const urlOrders = buildSignedUrl(integration.shop_url, integration.access_token, integration.username, 'GetOrders', {
      'CreatedAfter': createdAfter
    });

    const response = await fetch(urlOrders);
    if (!response.ok) {
      throw new Error(`Error en API de Falabella (GetOrders): Status ${response.status}`);
    }

    const json = await response.json();
    let ordersObj = json?.SuccessResponse?.Body?.Orders;
    let orders = [];
    if (ordersObj) {
      if (ordersObj.Order) {
        orders = Array.isArray(ordersObj.Order) ? ordersObj.Order : [ordersObj.Order];
      } else if (Array.isArray(ordersObj)) {
        orders = ordersObj;
      }
    }

    console.log(`Se encontraron ${orders.length} pedidos en Falabella.`);

    for (const order of orders) {
      const orderId = order.OrderId;
      const orderNumber = order.OrderNumber || orderId;
      const statusName = (order.Statuses && order.Statuses.Status ? order.Statuses.Status : (order.Status || "")).toLowerCase().trim();
      
      console.log(`\nProcesando pedido Falabella ID: ${orderId} (N° Venta: ${orderNumber}, Estado: ${statusName})`);

      const isCancelled = statusName.includes('cancel') || statusName.includes('refund');

      // 1. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, label_base64, comercio')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', orderNumber)
        .eq('external_platform', 'Falabella')
        .maybeSingle();

      let localOrderId = null;
      let shouldInsertItems = false;
      let labelBase64 = existingOrder?.label_base64 || null;

      if (existingOrder) {
        localOrderId = existingOrder.id;
        
        // Si el pedido se canceló en origen, actualizar su estado en WMS
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ payment_status: statusName, status: 'cancelado', comercio: integration.comercio, created_at: new Date(order.CreatedAt).toISOString() })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${orderNumber} cancelado en Falabella. Actualizado en el WMS.`);
        } else {
          // Actualizar datos del pedido
          await supabase
            .from('orders')
            .update({ payment_status: statusName, raw_falabella_data: order, comercio: integration.comercio, created_at: new Date(order.CreatedAt).toISOString() })
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${orderNumber}`);
        }

        // Si existe pero no tiene etiqueta de despacho, intentar descargarla
        if (!labelBase64) {
          console.log(`📄 Descargando etiqueta pendiente para pedido existente...`);
          labelBase64 = await downloadLabelBase64(integration, orderId);
          if (labelBase64) {
            await supabase
              .from('orders')
              .update({ label_base64: labelBase64 })
              .eq('id', existingOrder.id);
            console.log(`✅ Etiqueta guardada en el WMS.`);
          }
        }

        // Verificar si la orden existente ya tiene items en la tabla order_items
        const { data: existingItems, error: itemsCheckErr } = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', localOrderId);

        if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
          console.log(`ℹ️ Pedido existente ${orderNumber} no tiene ítems registrados. Se procederá a ingresarlos.`);
          shouldInsertItems = true;
        }
      } else {
        // Pedido nuevo: Obtener ítems del pedido desde la API
        console.log(`--> Obteniendo ítems para el pedido nuevo ${orderId}...`);
        const items = await fetchOrderItems(integration, orderId);
        if (items.length === 0) {
          console.log(`⚠️ No se encontraron ítems para el pedido ${orderId}. Ignorando.`);
          continue;
        }

        // Descargar etiqueta de despacho
        console.log(`--> Descargando etiqueta de despacho...`);
        labelBase64 = await downloadLabelBase64(integration, orderId);

        // Agrupar ítems por SKU y recolectar nombres
        const itemQuantities = {};
        const itemNames = [];
        for (const item of items) {
          let sku = item.Sku || item.SellerSku;
          if (sku) {
            let cleanSku = sku.replace(/\s+/g, '');
            // Aplicar equivalencia de SKU
            let mappedSku = skuMap[cleanSku] || cleanSku;
            itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + 1;
          }
          if (item.Name && !itemNames.includes(item.Name)) {
            itemNames.push(item.Name);
          }
        }

        const flatSku = Object.keys(itemQuantities).join(', ');
        const flatItemName = itemNames.join(', ');
        const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);

        // Calcular valor total de la orden sumando precios de los ítems
        const totalValue = items.reduce((sum, item) => sum + Number(item.ItemPrice || 0), 0);

        // Mapear datos comunes del pedido
        const orderDataToSave = {
          merchant_id: integration.merchant_id,
          comercio: integration.comercio,
          external_order_number: orderNumber,
          external_platform: 'Falabella',
          payment_status: statusName,
          total_value: totalValue,
          customer_email: 'no-email@falabella.cl',
          customer_phone: order.AddressShipping?.Phone || 'No especificado',
          customer_name: `${order.CustomerFirstName || ''} ${order.CustomerLastName || ''}`.trim() || 'Cliente Falabella',
          shipping_address: order.AddressShipping?.Address1 || 'No especificada',
          shipping_city: order.AddressShipping?.City || 'No especificada',
          shipping_complement: [order.AddressShipping?.Address2, order.AddressShipping?.Address5].filter(Boolean).join(', ') || '',
          raw_falabella_data: order,
          label_base64: labelBase64,
          // Nuevas columnas planas
          origen: 'Falabella',
          item: flatItemName,
          cantidad: flatQuantity,
          sku: flatSku,
          created_at: new Date(order.CreatedAt).toISOString()
        };

        // Insertar nuevo pedido activo en WMS temporalmente como 'para procesar'
        // (Requerido para que la inserción de items aumente el stock comprometido)
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${orderNumber}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${orderNumber} con estado temporal 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;

        // Registrar ítems en order_items
        if (localOrderId && shouldInsertItems) {
          for (const [sku, qty] of Object.entries(itemQuantities)) {
            // Buscar producto por SKU en la base de datos
            let { data: product } = await supabase
              .from('products')
              .select('id, comercio')
              .eq('merchant_id', integration.merchant_id)
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
              // Buscar barcode final del catálogo de Falabella
              console.log(`🔍 Buscando barcode en el catálogo Falabella para SKU ${sku}...`);
              const barcode = await fetchProductBarcode(integration, sku);

              // Auto-crear producto faltante
              const orderItemDetail = items.find(item => {
                let itemSku = item.Sku || item.SellerSku;
                if (!itemSku) return false;
                let cleanItemSku = itemSku.replace(/\s+/g, '');
                let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
                return mappedItemSku === sku;
              });
              const productName = orderItemDetail?.Name || 'Producto Falabella ' + sku;
              const productPrice = Number(orderItemDetail?.ItemPrice || 0);

              const { data: newProd, error: prodErr } = await supabase
                .from('products')
                .insert([{
                  merchant_id: integration.merchant_id,
                  comercio: integration.comercio,
                  sku: sku,
                  name: productName,
                  barcode: barcode,
                  price: productPrice,
                  description: 'Creado automáticamente desde integración de Falabella (Mirakl)',
                  raw_falabella_data: orderItemDetail
                }])
                .select('id')
                .single();

              if (!prodErr && newProd) {
                console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${productName}", Barcode: ${barcode})`);
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
              console.warn(`   ⚠️ SKU ${sku} no encontrado/creado en la base de datos. No se pudo registrar en la orden.`);
            }
          }
        }

        // Actualizar al estado real final mapeado
        const targetStatus = mapFalabellaStatus(statusName);
        if (targetStatus !== 'para procesar') {
          console.log(`🔄 Transicionando estado final de la orden a '${targetStatus}'...`);
          const { error: statusUpdateErr } = await supabase
            .from('orders')
            .update({ status: targetStatus })
            .eq('id', localOrderId);

          if (statusUpdateErr) {
            console.error(`   ❌ Error al transicionar a estado ${targetStatus}:`, statusUpdateErr.message);
          } else {
            console.log(`   ✅ Estado de la orden transicionado exitosamente a '${targetStatus}' (Trigger de stock disparado).`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
  }
}

/**
 * Obtiene los items de un pedido desde la API de Falabella
 */
async function fetchOrderItems(integration, orderId) {
  const url = buildSignedUrl(integration.shop_url, integration.access_token, integration.username, 'GetOrderItems', {
    'OrderId': orderId
  });

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    
    const json = await res.json();
    let itemsObj = json?.SuccessResponse?.Body?.OrderItems;
    let items = [];
    if (itemsObj) {
      if (itemsObj.OrderItem) {
        items = Array.isArray(itemsObj.OrderItem) ? itemsObj.OrderItem : [itemsObj.OrderItem];
      } else if (Array.isArray(itemsObj)) {
        items = itemsObj;
      }
    }
    return items;
  } catch (e) {
    console.error(`Error obteniendo items del pedido ${orderId}:`, e.message);
    return [];
  }
}

/**
 * Obtiene el código de barras desde el catálogo usando el SKU del producto
 */
async function fetchProductBarcode(integration, sku) {
  if (!sku || sku === "S/SKU") return sku;

  const url = buildSignedUrl(integration.shop_url, integration.access_token, integration.username, 'GetProducts', {
    'Search': sku
  });

  try {
    const res = await fetch(url);
    if (!res.ok) return sku;
    
    const json = await res.json();
    if (json.SuccessResponse && json.SuccessResponse.Body && json.SuccessResponse.Body.Products) {
      const productos = json.SuccessResponse.Body.Products.Product;
      const prod = Array.isArray(productos) ? productos[0] : productos;
      if (prod) {
        return prod.ProductId || prod.MainProduct?.SellerSku || sku;
      }
    }
  } catch (e) {
    console.error(`Error buscando ProductId para ${sku}:`, e.message);
  }
  return sku;
}

/**
 * Descarga la etiqueta de despacho en PDF y la codifica en Base64
 */
async function downloadLabelBase64(integration, orderId) {
  const url = buildSignedUrl(integration.shop_url, integration.access_token, integration.username, 'GetDocument', {
    'DocumentType': 'ShippingLabel',
    'OrderIdList': `[${orderId}]`
  });

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      const buffer = await res.arrayBuffer();
      return Buffer.from(buffer).toString('base64');
    }

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const fileContent = json?.SuccessResponse?.Body?.Documents?.Document?.FileContent;
      if (fileContent) return fileContent;
    } catch (err) {
      // Ignorar error si no es JSON
    }
    return null;
  } catch (e) {
    console.error(`Error descargando etiqueta para pedido ${orderId}:`, e.message);
    return null;
  }
}

// Ejecutar script
syncFalabellaData();
