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
      await syncMerchantProducts(integration);
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
      equivalences.filter(e => e.platform === 'MercadoLibre').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
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

      // Mapear logística y calcular SLA
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
        try {
          const formatter = new Intl.DateTimeFormat('es-CL', {
            timeZone: 'America/Santiago',
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
          const parts = formatter.formatToParts(slaDate);
          const day = parts.find(p => p.type === 'day').value;
          const month = parts.find(p => p.type === 'month').value;
          const year = parts.find(p => p.type === 'year').value;
          const hour = parts.find(p => p.type === 'hour').value;
          const minute = parts.find(p => p.type === 'minute').value;
          formattedSla = `${day}/${month}/${year} ${hour}:${minute}`;
        } catch (e) {
          formattedSla = `${slaDate.getDate().toString().padStart(2, '0')}/${(slaDate.getMonth() + 1).toString().padStart(2, '0')}/${slaDate.getFullYear().toString().slice(-2)} ${slaDate.getHours().toString().padStart(2, '0')}:${slaDate.getMinutes().toString().padStart(2, '0')}`;
        }
      }
      const shippingMethod = expectedDate ? `${baseMethod} - SLA: ${formattedSla}` : baseMethod;
      const targetStatus = mapMeliStatus(shippingStatus);

      // B. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, comercio')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', groupId)
        .eq('external_platform', 'MercadoLibre')
        .maybeSingle();

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        localOrderId = existingOrder.id;

        // Si se canceló en MercadoLibre, cancelarlo en el WMS
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ payment_status: group.status, status: 'cancelado', created_at: group.date_created })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${groupId} cancelado en MercadoLibre. Actualizado en WMS.`);
        } else {
          // Actualizar datos del pedido sin sobreescribir el comercio para preservar reasignaciones manuales
          const updatePayload = {
            payment_status: group.status,
            raw_meli_data: group.orders,
            created_at: group.date_created,
            shipping_method: shippingMethod
          };
          
          if (existingOrder.status !== 'cancelado') {
            updatePayload.status = targetStatus;
          }

          await supabase
            .from('orders')
            .update(updatePayload)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${groupId} (Estado: ${targetStatus}, SLA: ${formattedSla})`);
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
            // Aplicar equivalencia de SKU
            let mappedSku = skuMap[sku] || sku;

            itemsList.push({
              itemId: item.item.id,
              variationId: item.item.variation_id ? item.item.variation_id.toString() : null,
              title: item.item.title,
              price: Number(item.unit_price || 0),
              quantity: Number(item.quantity || 1),
              sku: mappedSku,
              variation: item.item.variation_attributes ? item.item.variation_attributes.map(v => v.value_name).join(', ') : 'N/A'
            });

            itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity || 1);
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

        // Determinar comercio a asignar basado en el catálogo de productos
        const itemComercios = [];
        for (const sku of Object.keys(itemQuantities)) {
          let { data: product } = await supabase
            .from('products')
            .select('comercio')
            .eq('merchant_id', integration.merchant_id)
            .eq('sku', sku)
            .maybeSingle();
          
          if (product && product.comercio) {
            itemComercios.push(product.comercio);
          }
        }

        let resolvedCommerce = integration.comercio;
        const uniqueComercios = [...new Set(itemComercios)];
        if (uniqueComercios.length === 1) {
          resolvedCommerce = uniqueComercios[0];
        } else if (uniqueComercios.length > 1) {
          console.log(`⚠️ Pedido mixto detectado. Contiene productos de: ${uniqueComercios.join(', ')}. Asignando a tienda por defecto: ${resolvedCommerce}`);
        }

        const orderDataToSave = {
          merchant_id: integration.merchant_id,
          comercio: resolvedCommerce,
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
          origen: 'MercadoLibre',
          item: flatItemName,
          cantidad: flatQuantity,
          sku: flatSku,
          shipping_method: shippingMethod,
          status: 'para procesar', // Insertar en para procesar temporalmente
          created_at: group.date_created
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
              // Buscar información y barcode (GTIN) en la API de MercadoLibre
              const itemDetail = itemsList.find(i => i.sku === sku);
              let barcode = sku;
              let name = 'Producto MercadoLibre ' + sku;
              let price = 0;
              let rawItemData = null;
              let meliItemId = null;
              let meliVariationId = null;

              if (itemDetail) {
                name = itemDetail.title;
                price = itemDetail.price;
                meliItemId = itemDetail.itemId;
                meliVariationId = itemDetail.variationId;
                
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
                  meli_item_id: meliItemId,
                  meli_variation_id: meliVariationId,
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

/**
 * Sincroniza el catálogo completo de productos (publicaciones y variaciones) de un vendedor
 */
async function syncMerchantProducts(integration) {
  console.log('\n--> Sincronizando catálogo de productos desde MercadoLibre...');

  // 1. Cargar equivalencias de SKU para este comercio
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
      equivalences.filter(e => e.platform === 'MercadoLibre').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // 2. Obtener credenciales OAuth activas
  const credentials = await getValidAccessToken(integration);
  if (!credentials) {
    console.error(`❌ No se pudo obtener sesión activa para el comercio ${integration.comercio}. Saltando sync de productos.`);
    return;
  }

  const { accessToken, userId } = credentials;

  try {
    let offset = 0;
    let limit = 50;
    let hasMore = true;
    let allItemIds = [];

    // Fase A: Obtener todos los item IDs del seller
    while (hasMore) {
      const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search?limit=${limit}&offset=${offset}`;
      const response = await fetch(searchUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error(`Error al buscar items del vendedor: Status ${response.status}`);
      }

      const json = await response.json();
      const results = json.results || [];
      allItemIds.push(...results);

      offset += results.length;
      hasMore = results.length > 0 && json.paging && json.paging.total > offset;
    }

    console.log(`Se encontraron ${allItemIds.length} publicaciones de productos en MercadoLibre.`);

    // Fase B: Obtener detalles de productos en lotes y guardar/actualizar en Supabase
    const batchSize = 20;
    for (let i = 0; i < allItemIds.length; i += batchSize) {
      const batch = allItemIds.slice(i, i + batchSize);
      console.log(`Procesando lote de productos ${i + 1} a ${Math.min(i + batchSize, allItemIds.length)} de ${allItemIds.length}...`);

      const multigetUrl = `https://api.mercadolibre.com/items?ids=${batch.join(',')}`;
      const response = await fetch(multigetUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        console.error(`⚠️ Error al obtener detalles de lote: Status ${response.status}`);
        continue;
      }

      const itemsDetails = await response.json();

      for (const itemWrapper of itemsDetails) {
        if (itemWrapper.code !== 200 || !itemWrapper.body) {
          console.warn(`⚠️ Error en publicación individual de lote: Code ${itemWrapper.code}`);
          continue;
        }

        const itemDetail = itemWrapper.body;

        // Comprobar si el producto tiene variaciones
        if (itemDetail.variations && itemDetail.variations.length > 0) {
          for (const variation of itemDetail.variations) {
            let rawSku = getMeliSku(variation, variation.id.toString());
            let cleanSku = rawSku.trim().replace(/\s+/g, '');
            let mappedSku = skuMap[cleanSku] || cleanSku;

            // Nombre descriptivo de la variación
            let variantName = itemDetail.title;
            if (variation.attribute_combinations && variation.attribute_combinations.length > 0) {
              const combos = variation.attribute_combinations.map(a => a.value_name).filter(Boolean).join(', ');
              if (combos) variantName += ` - ${combos}`;
            }

            const barcode = getBarcodeFromAttributes(variation.attributes, cleanSku);
            const price = variation.price || itemDetail.price || 0;

            const productDataToSave = {
              merchant_id: integration.merchant_id,
              comercio: integration.comercio,
              sku: mappedSku,
              name: variantName,
              description: itemDetail.description || `Publicación MercadoLibre ${itemDetail.id} - Variación ${variation.id}`,
              barcode: barcode,
              price: price,
              meli_item_id: itemDetail.id,
              meli_variation_id: variation.id.toString(),
              raw_meli_data: { ...variation, base_item_title: itemDetail.title, base_item_id: itemDetail.id }
            };

            await saveOrUpdateProduct(productDataToSave);
          }
        } else {
          // Publicación sin variaciones
          let rawSku = getMeliSku(itemDetail, itemDetail.id);
          let cleanSku = rawSku.trim().replace(/\s+/g, '');
          let mappedSku = skuMap[cleanSku] || cleanSku;

          const barcode = getBarcodeFromAttributes(itemDetail.attributes, cleanSku);
          const price = itemDetail.price || 0;

          const productDataToSave = {
            merchant_id: integration.merchant_id,
            comercio: integration.comercio,
            sku: mappedSku,
            name: itemDetail.title,
            description: itemDetail.description || `Publicación MercadoLibre ${itemDetail.id}`,
            barcode: barcode,
            price: price,
            meli_item_id: itemDetail.id,
            meli_variation_id: null,
            raw_meli_data: itemDetail
          };

          await saveOrUpdateProduct(productDataToSave);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando catálogo para el comercio ${integration.comercio}:`, error.message);
  }
}

// Helper para guardar o actualizar producto
async function saveOrUpdateProduct(productData) {
  try {
    const { data: existingProduct } = await supabase
      .from('products')
      .select('id')
      .eq('merchant_id', productData.merchant_id)
      .eq('sku', productData.sku)
      .maybeSingle();

    if (existingProduct) {
      const { error: updErr } = await supabase
        .from('products')
        .update(productData)
        .eq('id', existingProduct.id);
      
      if (updErr) {
        console.error(`   ❌ Error al actualizar SKU ${productData.sku}:`, updErr.message);
      } else {
        console.log(`   📝 Actualizado producto SKU ${productData.sku}`);
      }
    } else {
      const { error: insErr } = await supabase
        .from('products')
        .insert([productData]);

      if (insErr) {
        console.error(`   ❌ Error al insertar SKU ${productData.sku}:`, insErr.message);
      } else {
        console.log(`   📥 Insertado nuevo producto SKU ${productData.sku}`);
      }
    }
  } catch (err) {
    console.error(`   ❌ Error general al procesar SKU ${productData.sku}:`, err.message);
  }
}

// Helper para obtener SKU de MercadoLibre
function getMeliSku(itemOrVariation, fallback) {
  let sku = itemOrVariation.seller_custom_field || 'Sin SKU';
  if ((sku === 'Sin SKU' || sku === '') && itemOrVariation.attributes) {
    const skuAttr = itemOrVariation.attributes.find(a => a.id === 'SELLER_SKU');
    if (skuAttr && skuAttr.value_name) sku = skuAttr.value_name;
  }
  sku = sku.trim().replace(/\s+/g, '');
  if (sku === 'SinSKU' || sku === 'SinSKU' || sku === '') {
    return fallback;
  }
  return sku;
}

// Helper para obtener código de barras
function getBarcodeFromAttributes(attributes, fallback) {
  if (!attributes) return fallback;
  const barcodeAttr = attributes.find(a => a.id === 'GTIN' || a.id === 'EAN' || a.id === 'UPC');
  return barcodeAttr && barcodeAttr.value_name ? barcodeAttr.value_name.trim() : fallback;
}

// Ejecutar script
syncMeliData();
