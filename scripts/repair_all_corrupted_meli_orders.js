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

    try {
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
    } catch (e) {
      console.error(`Error renovando token para ${integration.comercio}:`, e.message);
    }
  }
  return { accessToken: integration.access_token, userId: integration.username };
}

async function repairOrder(order, integration, accessToken, isDryRun) {
  let packOrOrderId = order.external_order_number.replace(/^[A-Z0-9_#]+?(?=\d{10,})/i, '').trim();
  if (!/^\d+$/.test(packOrOrderId)) {
    packOrOrderId = order.external_order_number.replace(/\D/g, '');
  }

  // Try /packs/ first
  let pack = null;
  let rawOrders = [];
  let shipmentId = null;

  const pRes = await fetch(`https://api.mercadolibre.com/packs/${packOrOrderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (pRes.ok) {
    pack = await pRes.json();
    shipmentId = pack.shipment?.id;
    for (const ordRef of (pack.orders || [])) {
      const oRes = await fetch(`https://api.mercadolibre.com/orders/${ordRef.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (oRes.ok) rawOrders.push(await oRes.json());
    }
  } else {
    // Direct order
    const oRes = await fetch(`https://api.mercadolibre.com/orders/${packOrOrderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (oRes.ok) {
      const ordData = await oRes.json();
      rawOrders.push(ordData);
      shipmentId = ordData.shipping?.id;
    } else {
      console.warn(`⚠️ No se encontró ni pack ni orden ${packOrOrderId} en MercadoLibre.`);
      return false;
    }
  }

  if (rawOrders.length === 0) return false;

  let shippingData = null;
  let meliTrackingNumber = shipmentId ? String(shipmentId).trim() : null;
  if (shipmentId) {
    const sRes = await fetch(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
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

  console.log(`\n📦 Orden ${order.external_order_number} (${order.comercio}):`);
  console.log(`   ANTERIOR: Cliente="${order.customer_name}", Tracking=${order.tracking_number}, Qty=${order.cantidad}, Total=$${order.total_value}`);
  console.log(`   CORRECTO: Cliente="${customerName}", Tracking=${meliTrackingNumber}, Qty=${flatQuantity}, Total=$${totalAmount}, SKUs=${flatSku}`);

  if (isDryRun) {
    return true;
  }

  // Update order in DB
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
    created_at: pack?.date_created || firstOrder.date_created,
    raw_meli_data: {
      orders: rawOrders,
      shipping: shippingData,
      shipping_status: shippingData?.status
    }
  };

  const { error: upErr } = await supabase.from('orders').update(updatePayload).eq('id', order.id);
  if (upErr) {
    console.error(`   ❌ Error actualizando orden en DB:`, upErr.message);
    return false;
  }

  // Replace order_items
  await supabase.from('order_items').delete().eq('order_id', order.id);

  let warehouseId = null;
  const { data: whRel } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', integration.merchant_id)
    .limit(1)
    .maybeSingle();
  if (whRel) warehouseId = whRel.warehouse_id;
  if (!warehouseId) {
    const { data: dWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
    if (dWh) warehouseId = dWh.id;
  }

  for (const [sku, qty] of Object.entries(itemQuantities)) {
    const { data: prod } = await supabase
      .from('products')
      .select('id, name')
      .eq('sku', sku)
      .eq('comercio', order.comercio)
      .maybeSingle();

    if (prod) {
      await supabase.from('order_items').insert([{
        order_id: order.id,
        product_id: prod.id,
        warehouse_id: warehouseId,
        quantity: qty
      }]);
    }
  }

  console.log(`   ✅ Actualizada y reparada con éxito.`);
  return true;
}

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  const targetId = process.argv.find(a => a.startsWith('--id='))?.split('=')[1];

  console.log(`🚀 Iniciando auditoría y reparación de órdenes MercadoLibre (Dry Run: ${isDryRun})...`);

  // Load integrations
  const { data: integrations } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'MercadoLibre')
    .eq('is_active', true);

  const intMap = {};
  for (const int of integrations) {
    intMap[int.comercio] = int;
  }

  let from = 0;
  const batchSize = 1000;
  const orders = [];

  while (true) {
    let q = supabase
      .from('orders')
      .select('id, external_order_number, comercio, customer_name, tracking_number, cantidad, total_value, raw_meli_data')
      .eq('external_platform', 'MercadoLibre')
      .range(from, from + batchSize - 1);

    if (targetId) {
      q = q.eq('id', targetId);
    }

    const { data: page, error } = await q;
    if (error || !page || page.length === 0) break;
    orders.push(...page);
    if (targetId || page.length < batchSize) break;
    from += batchSize;
  }
  console.log(`Total órdenes MercadoLibre a evaluar: ${orders.length}`);

  const tokens = {};
  let repairedCount = 0;

  for (const o of (orders || [])) {
    const rawOrders = o.raw_meli_data?.orders;
    let isCorrupted = false;

    if (Array.isArray(rawOrders) && rawOrders.length > 1) {
      const buyerIds = new Set(rawOrders.map(x => x.buyer?.id).filter(Boolean));
      if (buyerIds.size > 1) {
        isCorrupted = true;
      }
    }

    if (isCorrupted || targetId) {
      const int = intMap[o.comercio];
      if (!int) {
        console.warn(`⚠️ Sin integración para comercio ${o.comercio}`);
        continue;
      }

      if (!tokens[o.comercio]) {
        const { accessToken } = await getValidAccessToken(int);
        tokens[o.comercio] = accessToken;
      }

      const success = await repairOrder(o, int, tokens[o.comercio], isDryRun);
      if (success) repairedCount++;
    }
  }

  console.log(`\n🎉 Finalizado. Órdenes procesadas: ${repairedCount}`);
}

run();
