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
// MAPEO DE ESTADO LOGÍSTICO MERCADOLIBRE A WMS
// ==========================================
function mapMeliStatus(meliShippingStatus) {
  const s = (meliShippingStatus || '').toLowerCase().trim();
  if (s === 'cancelled') {
    return 'cancelado';
  }
  if (s === 'shipped' || s === 'delivered' || s === 'returned') {
    return 'despachado';
  }
  if (s === 'ready_to_ship' || s === 'handling') {
    return 'en preparación';
  }
  return 'para procesar';
}

// ==========================================
// FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncMeliData() {
  console.log('🔄 Sincronizando con MercadoLibre API...');

  try {
    // 1. Obtener todas las integraciones activas de MercadoLibre en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'MercadoLibre')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de MercadoLibre configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🏢 Comercio: ${integration.comercio}`);
      console.log(`========================================`);

      await syncMerchantOrders(integration);
    }

    console.log('\n🎉 Sincronización finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Realiza el flujo OAuth2 para obtener un token de acceso válido
 */
async function getValidAccessToken(integration) {
  const tokenUrl = 'https://api.mercadolibre.com/oauth/token';

  // Caso A: Existe un refresh token guardado
  if (integration.refresh_token) {
    console.log(`🔄 Renovando access token para el comercio ${integration.comercio}...`);
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      refresh_token: integration.refresh_token
    });

    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error en refresh_token flow: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      console.log(`✅ Token renovado con éxito.`);
      
      // Actualizar en base de datos inmediatamente
      await supabase
        .from('merchant_integrations')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          username: String(data.user_id)
        })
        .eq('id', integration.id);

      return { accessToken: data.access_token, userId: data.user_id };
    } catch (e) {
      console.error(`❌ Error al renovar token:`, e.message);
      return null;
    }
  }

  // Caso B: Es una nueva integración y tenemos el authorization code en access_token
  if (integration.access_token && !integration.refresh_token) {
    console.log(`🔌 Realizando intercambio de código inicial (authorization_code) para ${integration.comercio}...`);
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      code: integration.access_token,
      redirect_uri: integration.shop_url || 'https://www.google.com'
    });

    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error en authorization_code flow: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      console.log(`✅ Código intercambiado correctamente. Registrando refresh_token...`);

      // Guardar el access_token y refresh_token reales en Supabase
      await supabase
        .from('merchant_integrations')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          username: String(data.user_id)
        })
        .eq('id', integration.id);

      return { accessToken: data.access_token, userId: data.user_id };
    } catch (e) {
      console.error(`❌ Error al intercambiar código:`, e.message);
      return null;
    }
  }

  console.error(`❌ Error: La integración no tiene un refresh_token ni un código de autorización en access_token.`);
  return null;
}

/**
 * Sincroniza los pedidos de un cliente específico de MercadoLibre
 */
async function syncMerchantOrders(integration) {
  // A. Obtener bodega por defecto para el cliente
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
    const { data: defaultWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
    if (defaultWh) {
      warehouseId = defaultWh.id;
    }
  }

  if (!warehouseId) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: No hay bodega configurada.`);
    return;
  }

  // B. Obtener credenciales OAuth activas
  const credentials = await getValidAccessToken(integration);
  if (!credentials) {
    console.error(`❌ No se pudo obtener sesión activa para el comercio ${integration.comercio}. Saltando.`);
    return;
  }

  const { accessToken, userId } = credentials;

  try {
    // 1. Obtener pedidos creados en los últimos 7 días
    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);
    const createdAfter = hace7Dias.toISOString(); // Ej: 2026-06-15T21:49:34.123Z

    console.log(`--> Consultando pedidos MercadoLibre creados después de: ${createdAfter}`);
    
    let offset = 0;
    let hasMore = true;
    let rawOrders = [];

    while (hasMore) {
      const searchUrl = `https://api.mercadolibre.com/orders/search?seller=${userId}&date_created.from=${createdAfter}&offset=${offset}&limit=50&sort=date_desc`;
      const response = await fetch(searchUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error(`Error al buscar pedidos (search): Status ${response.status}`);
      }

      const json = await response.json();
      const results = json.results || [];
      rawOrders.push(...results);

      offset += results.length;
      hasMore = results.length > 0 && json.paging && json.paging.total > offset && offset < 300;
    }

    console.log(`Se encontraron ${rawOrders.length} pedidos crudos en MercadoLibre.`);

    // 2. Agrupar pedidos por pack_id o por id (para consolidar envíos)
    const orderGroups = {};
    for (const order of rawOrders) {
      const groupId = order.pack_id ? String(order.pack_id) : String(order.id);
      if (!orderGroups[groupId]) {
        orderGroups[groupId] = {
          groupId: groupId,
          orders: [],
          buyer: order.buyer,
          shipping: order.shipping,
          date_created: order.date_created,
          status: order.status,
          total_value: 0
        };
      }
      orderGroups[groupId].orders.push(order);
      // Sumar el total de la orden
      orderGroups[groupId].total_value += Number(order.total_amount || 0);
    }

    // 3. Procesar cada grupo de pedidos consolidado
    for (const group of Object.values(orderGroups)) {
      const groupId = group.groupId;
      console.log(`\nProcesando grupo de venta MercadoLibre N°: ${groupId} (${group.orders.length} pedido(s))`);

      // A. Consultar detalles de despacho y SLA en MercadoLibre API
      let shippingStatus = 'pending';
      let shippingData = null;
      let receiverAddress = null;
      let expectedDate = null;
      let logisticsType = 'not_specified';

      if (group.shipping && group.shipping.id) {
        try {
          const shipRes = await fetch(`https://api.mercadolibre.com/shipments/${group.shipping.id}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (shipRes.ok) {
            shippingData = await shipRes.json();
            shippingStatus = shippingData.status || 'pending';
            receiverAddress = shippingData.receiver_address;
            logisticsType = shippingData.logistic_type || 'not_specified';

            const slaRes = await fetch(`https://api.mercadolibre.com/shipments/${group.shipping.id}/sla`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (slaRes.ok) {
              const slaData = await slaRes.json();
              if (slaData.expected_date) {
                expectedDate = slaData.expected_date;
              }
            }
          }
        } catch (err) {
          console.warn(`⚠️ Advertencia al consultar despacho ${group.shipping.id}:`, err.message);
        }
      }

      // Omitir pedidos que son Meli Full (Fulfillment)
      if (logisticsType === 'fulfillment') {
        console.log(`ℹ️ Pedido ${groupId} omitido por ser logística Full (Fulfillment de MercadoLibre).`);
        continue;
      }

      const isCancelled = group.status === 'cancelled' || shippingStatus === 'cancelled';

      // B. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, label_base64')
        .eq('comercio', integration.comercio)
        .eq('external_order_number', groupId)
        .eq('external_platform', 'MercadoLibre')
        .maybeSingle();

      let localOrderId = null;
      let shouldInsertItems = false;
      let labelBase64 = existingOrder?.label_base64 || null;

      if (existingOrder) {
        localOrderId = existingOrder.id;

        // Si se canceló en MercadoLibre, cancelarlo en el WMS
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ payment_status: group.status, status: 'cancelado' })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${groupId} cancelado en MercadoLibre. Actualizado en WMS.`);
        } else {
          // Actualizar datos del pedido
          await supabase
            .from('orders')
            .update({ payment_status: group.status, raw_meli_data: group.orders })
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${groupId}`);
        }

        // Descargar etiqueta de despacho si falta
        if (!labelBase64 && group.shipping && group.shipping.id) {
          console.log(`📄 Descargando etiqueta pendiente para pedido existente...`);
          labelBase64 = await downloadMeliLabel(group.shipping.id, accessToken);
          if (labelBase64) {
            await supabase
              .from('orders')
              .update({ label_base64: labelBase64 })
              .eq('id', existingOrder.id);
            console.log(`✅ Etiqueta guardada en el WMS.`);
          }
        }

        // Verificar si tiene ítems registrados
        const { data: existingItems, error: itemsCheckErr } = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', localOrderId);

        if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
          shouldInsertItems = true;
        }
      } else {
        // C. Es un pedido nuevo: Procesar ítems y registrar en WMS
        if (isCancelled) {
          console.log(`ℹ️ Pedido ${groupId} está cancelado en origen y no existe localmente. Omitiendo creación.`);
          continue;
        }

        // Descargar etiqueta de despacho
        if (group.shipping && group.shipping.id) {
          console.log(`--> Descargando etiqueta de despacho...`);
          labelBase64 = await downloadMeliLabel(group.shipping.id, accessToken);
        }

        // Agrupar ítems por SKU y recolectar nombres
        const itemsList = [];
        const itemQuantities = {};
        const itemNames = [];

        for (const order of group.orders) {
          for (const item of order.order_items) {
            let sku = item.item.seller_sku || item.item.seller_custom_field || 'Sin SKU';
            if (sku === 'Sin SKU' && item.item.variation_attributes) {
              const vSku = item.item.variation_attributes.find(a => a.id === 'SELLER_SKU');
              if (vSku) sku = vSku.value_name;
            }
            sku = sku.trim().replace(/\s+/g, '');

            itemsList.push({
              itemId: item.item.id,
              title: item.item.title,
              price: Number(item.unit_price || 0),
              quantity: Number(item.quantity || 1),
              sku: sku,
              variation: item.item.variation_attributes ? item.item.variation_attributes.map(v => v.value_name).join(', ') : 'N/A'
            });

            itemQuantities[sku] = (itemQuantities[sku] || 0) + Number(item.quantity || 1);
            if (item.item.title && !itemNames.includes(item.item.title)) {
              itemNames.push(item.item.title);
            }
          }
        }

        const flatSku = Object.keys(itemQuantities).join(', ');
        const flatItemName = itemNames.join(', ');
        const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);

        // Mapear campos comunes del destinatario
        let customerName = 'Cliente MercadoLibre';
        if (group.buyer) {
          customerName = `${group.buyer.first_name || ''} ${group.buyer.last_name || ''}`.trim() || group.buyer.nickname || 'Cliente MercadoLibre';
        }

        let shippingAddress = 'No especificada';
        let shippingCity = 'No especificada';
        let shippingComplement = '';
        if (receiverAddress) {
          shippingAddress = (receiverAddress.street_name || '') + ' ' + (receiverAddress.street_number || '');
          if (shippingAddress.trim() === '' && receiverAddress.address_line) {
            shippingAddress = receiverAddress.address_line;
          }
          shippingCity = receiverAddress.city?.name || receiverAddress.municipality?.name || 'No especificada';
          shippingComplement = receiverAddress.comment || '';
        }

        const customerPhone = receiverAddress?.receiver_phone || 'No especificado';

        // Mapear logística
        const mapLog = {
          'self_service': 'FLEX ⚡', 
          'fulfillment': 'Full 📦', 
          'cross_docking': 'Colecta 🚚', 
          'drop_off': 'CENTRO DE ENVIOS 🏪',
          'xd_drop_off': 'CENTRO DE ENVIOS 🏪',
          'custom': 'Acordar / Retiro',
          'not_specified': 'Acordar / Retiro'
        };
        const baseMethod = mapLog[logisticsType] || logisticsType || 'Acordar / Retiro';
        let formattedSla = 'N/A';
        if (expectedDate) {
          const slaDate = new Date(expectedDate);
          formattedSla = `${slaDate.getDate().toString().padStart(2, '0')}/${(slaDate.getMonth() + 1).toString().padStart(2, '0')}/${slaDate.getFullYear().toString().slice(-2)} ${slaDate.getHours().toString().padStart(2, '0')}:${slaDate.getMinutes().toString().padStart(2, '0')}`;
        }
        const shippingMethod = expectedDate ? `${baseMethod} - SLA: ${formattedSla}` : baseMethod;

        const orderDataToSave = {
          merchant_id: integration.merchant_id,
          comercio: integration.comercio,
          external_order_number: groupId,
          external_platform: 'MercadoLibre',
          payment_status: group.status,
          total_value: group.total_value,
          customer_email: 'no-email@mercadolibre.cl',
          customer_phone: customerPhone,
          customer_name: customerName,
          shipping_address: shippingAddress,
          shipping_city: shippingCity,
          shipping_complement: shippingComplement,
          raw_meli_data: group.orders,
          label_base64: labelBase64,
          origen: 'MercadoLibre',
          item: flatItemName,
          cantidad: flatQuantity,
          sku: flatSku,
          shipping_method: shippingMethod,
          status: 'para procesar' // Insertar en para procesar temporalmente
        };

        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([orderDataToSave])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${groupId}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${groupId} con estado temporal 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;

        // Registrar items en order_items
        if (localOrderId && shouldInsertItems) {
          for (const [sku, qty] of Object.entries(itemQuantities)) {
            // Buscar producto por SKU
            let { data: product } = await supabase
              .from('products')
              .select('id')
              .eq('comercio', integration.comercio)
              .eq('sku', sku)
              .maybeSingle();

            if (!product) {
              // Buscar información y barcode (GTIN) en la API de MercadoLibre
              const itemDetail = itemsList.find(i => i.sku === sku);
              let barcode = sku;
              let name = 'Producto MercadoLibre ' + sku;
              let price = 0;
              let rawItemData = null;

              if (itemDetail) {
                name = itemDetail.title;
                price = itemDetail.price;
                
                console.log(`🔍 Buscando datos y barcode en MercadoLibre para ítem ID ${itemDetail.itemId}...`);
                try {
                  const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemDetail.itemId}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                  });
                  if (itemRes.ok) {
                    rawItemData = await itemRes.json();
                    if (rawItemData.attributes) {
                      const gtinAttr = rawItemData.attributes.find(a => a.id === 'GTIN' || a.id === 'EAN');
                      if (gtinAttr && gtinAttr.value_name) {
                        barcode = gtinAttr.value_name;
                      }
                    }
                  }
                } catch (e) {
                  console.error(`⚠️ Error al buscar barcode para ${sku}:`, e.message);
                }
              }

              // Auto-crear producto faltante
              const { data: newProd, error: prodErr } = await supabase
                .from('products')
                .insert([{
                  merchant_id: integration.merchant_id,
                  comercio: integration.comercio,
                  sku: sku,
                  name: name,
                  barcode: barcode,
                  price: price,
                  description: 'Creado automáticamente desde integración de MercadoLibre',
                  raw_meli_data: rawItemData
                }])
                .select('id')
                .single();

              if (!prodErr && newProd) {
                console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${name}", Barcode: ${barcode})`);
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
                console.log(`   + Registrado ítem: SKU ${sku} x ${qty} (Stock Reservado)`);
              }
            }
          }
        }

        // Transicionar al estado real final mapeado
        const targetStatus = mapMeliStatus(shippingStatus);
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
    console.error(`❌ Error sincronizando pedidos para el comercio ${integration.comercio}:`, error.message);
  }
}

/**
 * Descarga la etiqueta de despacho en PDF y la codifica en Base64
 */
async function downloadMeliLabel(shippingId, accessToken) {
  if (!shippingId || shippingId === 'N/A') return null;

  const url = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shippingId}&savePdf=Y`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      console.warn(`⚠️ No se pudo descargar la etiqueta para despacho ${shippingId}. Status: ${res.status}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      const buffer = await res.arrayBuffer();
      return Buffer.from(buffer).toString('base64');
    }

    return null;
  } catch (e) {
    console.error(`Error descargando etiqueta MercadoLibre para despacho ${shippingId}:`, e.message);
    return null;
  }
}

// Ejecutar script
syncMeliData();
