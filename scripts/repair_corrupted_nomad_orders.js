const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

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

async function repairNomadOrders() {
  const packIds = ['2000015414735007', '2000015416674253', '2000015416770509'];

  const { data: int } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('comercio', 'NOMAD')
    .eq('platform', 'MercadoLibre')
    .single();

  const { accessToken } = await getValidAccessToken(int);

  // Warehouse resolution
  let warehouseId = null;
  const { data: whRel } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', int.merchant_id)
    .limit(1)
    .maybeSingle();
  if (whRel) warehouseId = whRel.warehouse_id;
  if (!warehouseId) {
    const { data: dWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
    if (dWh) warehouseId = dWh.id;
  }

  for (const packId of packIds) {
    console.log(`\n==============================================`);
    console.log(`🔧 REPARANDO PEDIDO MERCADO LIBRE: ${packId}`);
    console.log(`==============================================`);

    const pRes = await fetch(`https://api.mercadolibre.com/packs/${packId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!pRes.ok) {
      console.error(`❌ Error al obtener pack ${packId}: ${pRes.status}`);
      continue;
    }

    const pack = await pRes.json();
    const rawOrders = [];
    for (const ordRef of pack.orders) {
      const oRes = await fetch(`https://api.mercadolibre.com/orders/${ordRef.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (oRes.ok) {
        rawOrders.push(await oRes.json());
      }
    }

    let shippingData = null;
    let meliTrackingNumber = pack.shipment?.id ? String(pack.shipment.id).trim() : null;
    if (pack.shipment?.id) {
      const sRes = await fetch(`https://api.mercadolibre.com/shipments/${pack.shipment.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (sRes.ok) {
        shippingData = await sRes.json();
      }
    }

    const firstOrder = rawOrders[0];
    const receiverAddress = shippingData?.receiver_address;

    let customerName = receiverAddress?.receiver_name;
    if (!customerName) {
      const fullName = `${firstOrder.buyer?.first_name || ''} ${firstOrder.buyer?.last_name || ''}`.trim();
      customerName = fullName || firstOrder.buyer?.nickname || 'Cliente MercadoLibre';
    }

    const customerPhone = receiverAddress?.receiver_phone || firstOrder.buyer?.phone?.number || 'No especificado';
    let shippingAddress = `${receiverAddress?.street_name || ''} ${receiverAddress?.street_number || ''}`.trim();
    if (!shippingAddress && receiverAddress?.address_line) {
      shippingAddress = receiverAddress.address_line;
    }
    const shippingCity = receiverAddress?.city?.name || receiverAddress?.neighborhood?.name || 'Santiago';
    const shippingComplement = receiverAddress?.comment || '';

    // Collect real items
    const itemQuantities = {};
    const itemNames = [];
    let totalAmount = 0;

    for (const ord of rawOrders) {
      totalAmount += Number(ord.total_amount || 0);
      for (const it of (ord.order_items || [])) {
        let sku = it.item?.seller_sku || it.item?.seller_custom_field || '';
        if (!sku && it.item?.variation_attributes) {
          const vSku = it.item.variation_attributes.find(a => a.id === 'SELLER_SKU');
          if (vSku) sku = vSku.value_name;
        }
        sku = (sku || it.item?.id || 'Sin SKU').trim().replace(/\s+/g, '');
        itemQuantities[sku] = (itemQuantities[sku] || 0) + Number(it.quantity || 1);
        if (it.item?.title && !itemNames.includes(it.item.title)) {
          itemNames.push(it.item.title);
        }
      }
    }

    const flatSku = Object.keys(itemQuantities).join(', ');
    const flatItemName = itemNames.join(', ');
    const flatQuantity = Object.values(itemQuantities).reduce((a, b) => a + b, 0);

    // Find in orders table
    const { data: dbOrders } = await supabase
      .from('orders')
      .select('id, external_order_number')
      .eq('external_order_number', packId);

    if (!dbOrders || dbOrders.length === 0) {
      console.log(`⚠️ Pedido ${packId} no encontrado en orders.`);
      continue;
    }

    const dbOrderId = dbOrders[0].id;
    console.log(`📌 Encontrado en DB: ID=${dbOrderId}`);

    const updatePayload = {
      customer_name: customerName,
      customer_phone: customerPhone,
      shipping_address: shippingAddress,
      shipping_city: shippingCity,
      shipping_complement: shippingComplement,
      tracking_number: meliTrackingNumber,
      total_value: totalAmount,
      cantidad: flatQuantity,
      item: flatItemName,
      sku: flatSku,
      created_at: pack.date_created || firstOrder.date_created,
      raw_meli_data: {
        orders: rawOrders,
        shipping: shippingData,
        shipping_status: shippingData?.status
      }
    };

    const { error: upErr } = await supabase.from('orders').update(updatePayload).eq('id', dbOrderId);
    if (upErr) {
      console.error(`❌ Error actualizando orden en DB:`, upErr.message);
      continue;
    }
    console.log(`✅ Orden actualizada en BD:`);
    console.log(`   - Cliente: ${customerName}`);
    console.log(`   - Dirección: ${shippingAddress}, ${shippingCity}`);
    console.log(`   - Tracking: ${meliTrackingNumber}`);
    console.log(`   - Cantidad: ${flatQuantity}, Total: $${totalAmount}`);
    console.log(`   - SKUs: ${flatSku}`);

    // Replace order_items
    await supabase.from('order_items').delete().eq('order_id', dbOrderId);

    for (const [sku, qty] of Object.entries(itemQuantities)) {
      const { data: prod } = await supabase
        .from('products')
        .select('id, name')
        .eq('sku', sku)
        .eq('comercio', 'NOMAD')
        .maybeSingle();

      if (prod) {
        await supabase.from('order_items').insert([{
          order_id: dbOrderId,
          product_id: prod.id,
          warehouse_id: warehouseId,
          quantity: qty
        }]);
        console.log(`   + Registrado ítem: SKU ${sku} x ${qty} (${prod.name})`);
      } else {
        console.error(`   ❌ Producto no encontrado para SKU: ${sku}`);
      }
    }
  }

  console.log(`\n🎉 Reparación de pedidos completada con éxito.`);
}

repairNomadOrders();
