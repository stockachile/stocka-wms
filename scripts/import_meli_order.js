const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. CARGAR VARIABLES DE ENTORNO
const envPath = path.join(__dirname, '..', '.env');
const envConfig = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envConfig.split(/\r?\n/).forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    envVars[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
});

const SUPABASE_URL = envVars.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getValidAccessToken(integration) {
  const tokenUrl = 'https://api.mercadolibre.com/oauth/token';
  if (integration.refresh_token) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      refresh_token: integration.refresh_token
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (res.ok) {
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
    }
  }
  return { accessToken: integration.access_token, userId: integration.username };
}

async function importMeliOrder({ packOrOrderId, targetEstadoWms = 'Archivado', targetComercio = 'LAQU & COMPANY' }) {
  console.log(`\n======================================================`);
  console.log(`🚀 IMPORTANDO PEDIDO/PACK ${packOrOrderId} DE MERCADO LIBRE`);
  console.log(`🏢 Comercio objetivo: ${targetComercio}`);
  console.log(`📌 Estado WMS solicitado: ${targetEstadoWms}`);
  console.log(`======================================================\n`);

  // 1. Obtener integración
  const { data: integrations, error: intErr } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'MercadoLibre')
    .ilike('comercio', `%${targetComercio}%`);

  if (intErr || !integrations || integrations.length === 0) {
    throw new Error(`No se encontró integración de MercadoLibre para ${targetComercio}`);
  }

  const integration = integrations[0];
  const { accessToken } = await getValidAccessToken(integration);

  // 2. Resolver Bodega por defecto
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
    if (defaultWh) warehouseId = defaultWh.id;
  }

  // 3. Consultar Pack o Pedido en Mercado Libre
  let packData = null;
  let rawOrders = [];
  let shipmentId = null;

  console.log(`🔍 Consultando pack ${packOrOrderId} en API de Mercado Libre...`);
  const packRes = await fetch(`https://api.mercadolibre.com/packs/${packOrOrderId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (packRes.ok) {
    packData = await packRes.json();
    console.log(`✅ Pack encontrado con ${packData.orders?.length} orden(es).`);
    shipmentId = packData.shipment?.id;
    for (const ordRef of packData.orders) {
      const ordRes = await fetch(`https://api.mercadolibre.com/orders/${ordRef.id}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (ordRes.ok) {
        rawOrders.push(await ordRes.json());
      }
    }
  } else {
    console.log(`ℹ️ No es pack. Consultando como orden directa ${packOrOrderId}...`);
    const ordRes = await fetch(`https://api.mercadolibre.com/orders/${packOrOrderId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (ordRes.ok) {
      const ordData = await ordRes.json();
      rawOrders.push(ordData);
      shipmentId = ordData.shipping?.id;
    } else {
      throw new Error(`No se encontró la orden ni el pack ${packOrOrderId} en Mercado Libre`);
    }
  }

  if (rawOrders.length === 0) {
    throw new Error('No se pudieron obtener órdenes para este identificador');
  }

  // 4. Consultar Shipment si existe
  let shippingData = null;
  let logisticsType = 'not_specified';
  let receiverAddress = null;
  let meliTrackingNumber = shipmentId ? String(shipmentId) : null;

  if (shipmentId) {
    console.log(`📦 Consultando despacho ${shipmentId}...`);
    const shipRes = await fetch(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (shipRes.ok) {
      shippingData = await shipRes.json();
      logisticsType = shippingData.logistic_type || 'not_specified';
      receiverAddress = shippingData.receiver_address;
      if (shippingData.id) meliTrackingNumber = String(shippingData.id);
    }
  }

  const mapLog = {
    'self_service': 'FLEX ⚡', 
    'fulfillment': 'Full 📦', 
    'cross_docking': 'Colecta 🚚', 
    'drop_off': 'CENTRO DE ENVIOS 🏪',
    'xd_drop_off': 'CENTRO DE ENVIOS 🏪',
    'custom': 'Acordar / Retiro',
    'not_specified': 'Acordar / Retiro'
  };
  const shippingMethod = mapLog[logisticsType] || logisticsType || 'Acordar / Retiro';

  // 5. Configuración de sigla y prefijo
  let siglaComercio = '';
  let prefijoOrigen = '';
  let agregarPrefijo = true;

  const { data: configData } = await supabase
    .from('v_comercios_config')
    .select('sigla')
    .eq('nombre', targetComercio)
    .maybeSingle();

  if (configData && configData.sigla) {
    siglaComercio = configData.sigla.trim().toUpperCase();
  }

  const { data: adicionalConfig } = await supabase
    .from('comercios_adicional_config')
    .select('plat_siglas_config')
    .eq('comercio', targetComercio)
    .maybeSingle();

  if (adicionalConfig) {
    const platConfig = (adicionalConfig.plat_siglas_config || {})['MercadoLibre'];
    if (platConfig) {
      agregarPrefijo = platConfig.agregar_prefijo !== false;
      prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
    }
  }

  let baseOrderNumber = String(packOrOrderId).trim();
  if (prefijoOrigen && baseOrderNumber.toUpperCase().startsWith(prefijoOrigen)) {
    baseOrderNumber = baseOrderNumber.substring(prefijoOrigen.length).trim();
  }
  let finalOrderNumber = baseOrderNumber;
  if (agregarPrefijo && siglaComercio && !baseOrderNumber.toUpperCase().startsWith(siglaComercio)) {
    finalOrderNumber = `${siglaComercio}${baseOrderNumber}`;
  }

  // 6. Cargar y registrar equivalencias de SKU
  const { data: equivalences } = await supabase
    .from('sku_equivalences')
    .select('platform_sku, master_sku')
    .eq('comercio', targetComercio);

  const skuMap = {};
  if (equivalences) {
    equivalences.forEach(e => {
      if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
    });
  }

  // Si LAQ-EL-SP001 no tiene equivalencia, agregarla automáticamente para Eco-Litter Special (ELSP001)
  if (!skuMap['LAQ-EL-SP001']) {
    console.log(`🔗 Creando equivalencia de SKU: LAQ-EL-SP001 -> ELSP001 para ${targetComercio}...`);
    await supabase.from('sku_equivalences').insert([{
      comercio: targetComercio,
      platform_sku: 'LAQ-EL-SP001',
      master_sku: 'ELSP001',
      platform: 'MercadoLibre'
    }]);
    skuMap['LAQ-EL-SP001'] = 'ELSP001';
  }

  // 7. Agrupar ítems
  const itemsList = [];
  const itemQuantities = {};
  const itemNames = [];
  let totalAmount = 0;

  for (const order of rawOrders) {
    totalAmount += Number(order.total_amount || 0);
    for (const item of order.order_items || []) {
      let rawSku = item.item.seller_sku || item.item.seller_custom_field || '';
      if ((!rawSku || rawSku === 'Sin SKU') && item.item.variation_attributes) {
        const vSku = item.item.variation_attributes.find(a => a.id === 'SELLER_SKU');
        if (vSku && vSku.value_name) rawSku = vSku.value_name;
      }
      rawSku = (rawSku || item.item.id || 'Sin SKU').trim().replace(/\s+/g, '');
      const mappedSku = skuMap[rawSku] || rawSku;

      itemsList.push({
        itemId: item.item.id,
        title: item.item.title,
        price: Number(item.unit_price || 0),
        quantity: Number(item.quantity || 1),
        rawSku: rawSku,
        mappedSku: mappedSku
      });

      itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity || 1);
      if (item.item.title && !itemNames.includes(item.item.title)) {
        itemNames.push(item.item.title);
      }
    }
  }

  // 8. Datos del comprador
  const firstOrder = rawOrders[0];
  let customerName = 'Cliente MercadoLibre';
  if (receiverAddress?.receiver_name) {
    customerName = receiverAddress.receiver_name;
  } else if (firstOrder.buyer) {
    customerName = `${firstOrder.buyer.first_name || ''} ${firstOrder.buyer.last_name || ''}`.trim() || firstOrder.buyer.nickname;
  }

  let shippingAddress = 'No especificada';
  let shippingCity = 'Santiago';
  let shippingComplement = '';
  if (receiverAddress) {
    shippingAddress = `${receiverAddress.street_name || ''} ${receiverAddress.street_number || ''}`.trim();
    if (!shippingAddress && receiverAddress.address_line) shippingAddress = receiverAddress.address_line;
    shippingCity = receiverAddress.city?.name || receiverAddress.neighborhood?.name || 'Santiago';
    shippingComplement = receiverAddress.comment || '';
  }

  const customerPhone = receiverAddress?.receiver_phone || firstOrder.buyer?.phone?.number || 'No especificado';

  // 9. Comprobar si ya existe en orders
  const { data: existingList } = await supabase
    .from('orders')
    .select('id, external_order_number')
    .eq('comercio', targetComercio)
    .ilike('external_order_number', `%${packOrOrderId}%`);

  let orderId = null;
  const orderPayload = {
    merchant_id: integration.merchant_id,
    comercio: targetComercio,
    external_order_number: finalOrderNumber,
    external_platform: 'MercadoLibre',
    payment_status: firstOrder.status || 'paid',
    total_value: totalAmount,
    customer_email: 'no-email@mercadolibre.cl',
    customer_phone: customerPhone,
    customer_name: customerName,
    shipping_address: shippingAddress,
    shipping_city: shippingCity,
    shipping_complement: shippingComplement,
    tracking_number: meliTrackingNumber,
    raw_meli_data: { pack: packData, orders: rawOrders, shipment: shippingData },
    origen: 'MercadoLibre',
    item: itemNames.join(', '),
    cantidad: Object.values(itemQuantities).reduce((a, b) => a + b, 0),
    sku: Object.keys(itemQuantities).join(', '),
    shipping_method: shippingMethod,
    status: 'despachado', // Mantiene status comercial
    estado_wms: targetEstadoWms, // 'Archivado'
    created_at: packData?.date_created || firstOrder.date_created,
    stock_descontado: false
  };

  if (existingList && existingList.length > 0) {
    orderId = existingList[0].id;
    console.log(`📝 Actualizando pedido existente en WMS (ID: ${orderId}, N°: ${finalOrderNumber})...`);
    await supabase.from('orders').update(orderPayload).eq('id', orderId);
  } else {
    console.log(`📥 Creando nuevo pedido en WMS con N°: ${finalOrderNumber}...`);
    const { data: inserted, error: insErr } = await supabase
      .from('orders')
      .insert([orderPayload])
      .select('id')
      .single();

    if (insErr) {
      throw new Error(`Error insertando pedido: ${insErr.message}`);
    }
    orderId = inserted.id;
  }

  // 10. Registrar productos e ítems en order_items
  // Primero limpiamos items si ya existían para este orderId
  await supabase.from('order_items').delete().eq('order_id', orderId);

  for (const [sku, qty] of Object.entries(itemQuantities)) {
    let { data: product } = await supabase
      .from('products')
      .select('id, name')
      .eq('sku', sku)
      .eq('comercio', targetComercio)
      .maybeSingle();

    if (!product) {
      console.log(`⚠️ Producto ${sku} no encontrado en catálogo. Buscando producto por defecto o creándolo...`);
      const { data: newProd, error: newProdErr } = await supabase
        .from('products')
        .insert([{
          merchant_id: integration.merchant_id,
          comercio: targetComercio,
          sku: sku,
          name: itemNames[0] || `Producto ${sku}`,
          price: itemsList[0]?.price || 0,
          description: 'Auto-creado por importación Mercado Libre'
        }])
        .select('id, name')
        .single();
      if (!newProdErr) product = newProd;
    }

    if (product) {
      console.log(`   + Enlazando ítem: Producto "${product.name}" (${sku}) x ${qty} en Bodega ID ${warehouseId}`);
      await supabase.from('order_items').insert([{
        order_id: orderId,
        product_id: product.id,
        warehouse_id: warehouseId,
        quantity: qty
      }]);
    }
  }

  console.log(`\n🎉 ¡PEDIDO IMPORTADO EXITOSAMENTE AL WMS!`);
  console.log(`🆔 ID en Supabase: ${orderId}`);
  console.log(`🏷️ N° Pedido WMS: ${finalOrderNumber}`);
  console.log(`📦 Estado Comercial (status): despachado`);
  console.log(`📋 Estado Operativo WMS (estado_wms): ${targetEstadoWms}`);
  console.log(`👤 Destinatario: ${customerName} (${shippingAddress}, ${shippingCity})`);
  console.log(`🛍️ Ítem: ${itemNames.join(', ')} x ${Object.values(itemQuantities).reduce((a, b) => a + b, 0)} (${Object.keys(itemQuantities).join(', ')})`);
  console.log(`🚚 Despacho: ${shippingMethod} (Tracking: ${meliTrackingNumber})`);

  return { orderId, orderNumber: finalOrderNumber };
}

// Ejecución
importMeliOrder({
  packOrOrderId: '2000014796263943',
  targetEstadoWms: 'Archivado',
  targetComercio: 'LAQU & COMPANY'
}).catch(console.error);
