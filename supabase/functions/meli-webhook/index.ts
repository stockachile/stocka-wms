import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // Respond only to POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    console.log("Recibido Webhook MercadoLibre:", JSON.stringify(payload));

    const { resource, user_id, topic } = payload;

    if (!resource || !user_id) {
      return new Response("Missing required parameters in payload", { status: 400 });
    }

    // 1. Find the active integration for this MercadoLibre user
    const { data: integration, error: intErr } = await supabase
      .from("merchant_integrations")
      .select("*")
      .eq("platform", "MercadoLibre")
      .eq("username", String(user_id))
      .eq("is_active", true)
      .maybeSingle();

    if (intErr || !integration) {
      console.warn(`No se encontró integración activa de MercadoLibre para user_id: ${user_id}`);
      // Respond 200 so MercadoLibre does not retry indefinetly
      return new Response("Integration not configured", { status: 200 });
    }

    // 2. Refresh token if expired
    const credentials = await getValidAccessToken(integration);
    if (!credentials) {
      console.error(`No se pudo obtener sesión activa para la integración de ${integration.comercio}`);
      return new Response("Auth failed", { status: 200 });
    }

    const { accessToken } = credentials;

    // 3. Process the notification according to the resource type
    if (resource.startsWith("/orders/")) {
      const orderId = resource.split("/").pop();
      if (orderId) {
        console.log(`Procesando orden en tiempo real: ${orderId} para ${integration.comercio}`);
        await handleOrderNotification(orderId, integration, accessToken);
      }
    } else if (resource.startsWith("/shipments/")) {
      const shipmentId = resource.split("/").pop();
      if (shipmentId) {
        console.log(`Procesando despacho en tiempo real: ${shipmentId} para ${integration.comercio}`);
        // Fetch shipment to get the order_id
        const shipUrl = `https://api.mercadolibre.com/shipments/${shipmentId}`;
        const shipRes = await fetch(shipUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (shipRes.ok) {
          const shipData = await shipRes.json();
          const orderId = shipData.order_id;
          if (orderId) {
            console.log(`Redireccionando despacho ${shipmentId} a orden ${orderId}`);
            await handleOrderNotification(String(orderId), integration, accessToken);
          }
        }
      }
    } else if (resource.startsWith("/items/")) {
      const itemId = resource.split("/").pop();
      if (itemId) {
        console.log(`Sincronizando producto en tiempo real: ${itemId} para ${integration.comercio}`);
        await handleItemNotification(itemId, integration, accessToken);
      }
    }

    return new Response("Webhook processed successfully", { status: 200 });

  } catch (error) {
    console.error("Error procesando webhook MercadoLibre:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

async function handleOrderNotification(orderId: string, integration: any, accessToken: string) {
  const orderUrl = `https://api.mercadolibre.com/orders/${orderId}`;
  const response = await fetch(orderUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Error fetching order details: ${response.status}`);
  }

  const orderData = await response.json();
  const userId = integration.username;

  // Determine packaging/group
  const groupId = orderData.pack_id ? String(orderData.pack_id) : String(orderData.id);

  let ordersList = [orderData];
  if (orderData.pack_id) {
    const searchUrl = `https://api.mercadolibre.com/orders/search?seller=${userId}&pack_id=${orderData.pack_id}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (searchRes.ok) {
      const searchJson = await searchRes.json();
      if (searchJson.results && searchJson.results.length > 0) {
        ordersList = searchJson.results;
      }
    }
  }

  const group = {
    groupId: groupId,
    orders: ordersList,
    buyer: ordersList[0].buyer,
    shipping: ordersList[0].shipping,
    date_created: ordersList[0].date_created,
    status: ordersList[0].status,
    total_value: ordersList.reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
  };

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
      console.warn(`Advertencia al consultar despacho ${group.shipping.id}:`, err.message);
    }
  }

  if (logisticsType === 'fulfillment') {
    console.log(`Pedido ${groupId} omitido por ser Full.`);
    return;
  }

  const isCancelled = group.status === 'cancelled' || shippingStatus === 'cancelled';

  // Mapear logística y calcular SLA
  const mapLog: Record<string, string> = {
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

    if (isCancelled && existingOrder.status !== 'cancelado') {
      await supabase
        .from('orders')
        .update({ payment_status: group.status, status: 'cancelado', created_at: group.date_created })
        .eq('id', existingOrder.id);
    } else {
      const updatePayload: any = {
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
    }



    const { data: existingItems, error: itemsCheckErr } = await supabase
      .from('order_items')
      .select('id')
      .eq('order_id', localOrderId);

    if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
      shouldInsertItems = true;
    }
  } else {
    if (isCancelled) return;



    const skuMap: Record<string, string> = {};
    const { data: equivalences } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform')
      .eq('comercio', integration.comercio);
    
    if (equivalences) {
      equivalences.filter((e: any) => e.platform === 'Todas').forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
      equivalences.filter((e: any) => e.platform === 'MercadoLibre').forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }

    const itemsList = [];
    const itemQuantities: Record<string, number> = {};
    const itemNames: string[] = [];

    for (const order of group.orders) {
      for (const item of order.order_items) {
        let sku = item.item.seller_sku || item.item.seller_custom_field || 'Sin SKU';
        if (sku === 'Sin SKU' && item.item.variation_attributes) {
          const vSku = item.item.variation_attributes.find((a: any) => a.id === 'SELLER_SKU');
          if (vSku) sku = vSku.value_name;
        }
        sku = sku.trim().replace(/\s+/g, '');
        let mappedSku = skuMap[sku] || sku;

        itemsList.push({
          itemId: item.item.id,
          variationId: item.item.variation_id ? item.item.variation_id.toString() : null,
          title: item.item.title,
          price: Number(item.unit_price || 0),
          quantity: Number(item.quantity || 1),
          sku: mappedSku,
          variation: item.item.variation_attributes ? item.item.variation_attributes.map((v: any) => v.value_name).join(', ') : 'N/A'
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

    // Mapeo ya realizado al principio

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
      status: 'para procesar',
      created_at: group.date_created
    };

    const { data: newOrder, error: insErr } = await supabase
      .from('orders')
      .insert([orderDataToSave])
      .select('id')
      .single();

    if (insErr) {
      throw new Error(`Error al insertar pedido local ${groupId}: ${insErr.message}`);
    }

    localOrderId = newOrder.id;
    shouldInsertItems = true;

    if (localOrderId && shouldInsertItems) {
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
        throw new Error("No hay bodega configurada.");
      }

      for (const [sku, qty] of Object.entries(itemQuantities)) {
        let { data: product } = await supabase
          .from('products')
          .select('id, comercio')
          .eq('merchant_id', integration.merchant_id)
          .eq('sku', sku)
          .maybeSingle();

        if (!product) {
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
            
            try {
              const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemDetail.itemId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              if (itemRes.ok) {
                rawItemData = await itemRes.json();
                if (rawItemData.attributes) {
                  const gtinAttr = rawItemData.attributes.find((a: any) => a.id === 'GTIN' || a.id === 'EAN');
                  if (gtinAttr && gtinAttr.value_name) {
                    barcode = gtinAttr.value_name;
                  }
                }
              }
            } catch (e) {
              console.error(`Error al buscar barcode para ${sku}:`, e.message);
            }
          }

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
            product = newProd;
          }
        }

        if (product) {
          await supabase
            .from('order_items')
            .insert([{
              order_id: localOrderId,
              product_id: product.id,
              warehouse_id: warehouseId,
              quantity: qty
            }]);
        }
      }
    }

    const targetStatus = mapMeliStatus(shippingStatus);
    if (targetStatus !== 'para procesar') {
      await supabase
        .from('orders')
        .update({ status: targetStatus })
        .eq('id', localOrderId);
    }
  }
}

async function handleItemNotification(itemId: string, integration: any, accessToken: string) {
  const itemUrl = `https://api.mercadolibre.com/items/${itemId}`;
  const response = await fetch(itemUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Error fetching item details: ${response.status}`);
  }

  const itemDetail = await response.json();

  const skuMap: Record<string, string> = {};
  const { data: equivalences } = await supabase
    .from('sku_equivalences')
    .select('platform_sku, master_sku, platform')
    .eq('comercio', integration.comercio);
  
  if (equivalences) {
    equivalences.filter((e: any) => e.platform === 'Todas').forEach((e: any) => {
      if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
    });
    equivalences.filter((e: any) => e.platform === 'MercadoLibre').forEach((e: any) => {
      if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
    });
  }

  if (itemDetail.variations && itemDetail.variations.length > 0) {
    for (const variation of itemDetail.variations) {
      const rawSku = getMeliSku(variation, variation.id.toString());
      const cleanSku = rawSku.trim().replace(/\s+/g, '');
      const mappedSku = skuMap[cleanSku] || cleanSku;

      let variantName = itemDetail.title;
      if (variation.attribute_combinations && variation.attribute_combinations.length > 0) {
        const combos = variation.attribute_combinations.map((a: any) => a.value_name).filter(Boolean).join(', ');
        if (combos) variantName += ` - ${combos}`;
      }

      const barcode = getBarcodeFromAttributes(variation.attributes, cleanSku);
      const price = variation.price || itemDetail.price || 0;

      const productDataToUpsert = {
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

      await supabase
        .from("products")
        .upsert(productDataToUpsert, { onConflict: "merchant_id,sku" });
    }
  } else {
    const rawSku = getMeliSku(itemDetail, itemDetail.id);
    const cleanSku = rawSku.trim().replace(/\s+/g, '');
    const mappedSku = skuMap[cleanSku] || cleanSku;

    const barcode = getBarcodeFromAttributes(itemDetail.attributes, cleanSku);
    const price = itemDetail.price || 0;

    const productDataToUpsert = {
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

    await supabase
      .from("products")
      .upsert(productDataToUpsert, { onConflict: "merchant_id,sku" });
  }
}

async function getValidAccessToken(integration: any) {
  const tokenUrl = 'https://api.mercadolibre.com/oauth/token';

  if (integration.refresh_token) {
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

      if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

      const data = await res.json();
      
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
      console.error("Error al renovar token:", e.message);
      return null;
    }
  }

  if (integration.access_token && !integration.refresh_token) {
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

      if (!res.ok) throw new Error(`Auth code exchange failed: ${res.status}`);

      const data = await res.json();

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
      console.error(`Error al intercambiar código:`, e.message);
      return null;
    }
  }

  return null;
}

async function downloadMeliLabel(shippingId: string | number, accessToken: string): Promise<string | null> {
  if (!shippingId || shippingId === 'N/A') return null;

  const url = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shippingId}&savePdf=Y`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      const buffer = await res.arrayBuffer();
      const binary = String.fromCharCode(...new Uint8Array(buffer));
      return btoa(binary);
    }
    return null;
  } catch (e) {
    console.error(`Error descargando etiqueta:`, e.message);
    return null;
  }
}

function mapMeliStatus(meliShippingStatus: string) {
  const s = (meliShippingStatus || '').toLowerCase().trim();
  if (s === 'cancelled') return 'cancelado';
  if (s === 'shipped' || s === 'delivered' || s === 'returned') return 'despachado';
  if (s === 'ready_to_ship' || s === 'handling') return 'en preparación';
  return 'para procesar';
}

function getMeliSku(itemOrVariation: any, fallback: string): string {
  let sku = itemOrVariation.seller_custom_field || 'Sin SKU';
  if ((sku === 'Sin SKU' || sku === '') && itemOrVariation.attributes) {
    const skuAttr = itemOrVariation.attributes.find((a: any) => a.id === 'SELLER_SKU');
    if (skuAttr && skuAttr.value_name) sku = skuAttr.value_name;
  }
  sku = sku.trim().replace(/\s+/g, '');
  if (sku === 'SinSKU' || sku === 'SinSKU' || sku === '') {
    return fallback;
  }
  return sku;
}

function getBarcodeFromAttributes(attributes: any[] | undefined, fallback: string): string {
  if (!attributes) return fallback;
  const barcodeAttr = attributes.find((a: any) => a.id === 'GTIN' || a.id === 'EAN' || a.id === 'UPC');
  return barcodeAttr && barcodeAttr.value_name ? barcodeAttr.value_name.trim() : fallback;
}
