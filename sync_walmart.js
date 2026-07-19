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
// FUNCIÓN AUXILIAR PARA ALERTAS POR CORREO (BREVO)
// ==========================================
async function sendEmailAlert(subject, htmlContent) {
  const apiKey = process.env.BREVO_API_KEY;
  const toEmail = 'stockachile@gmail.com';
  
  if (!apiKey) {
    console.log('ℹ️ Brevo API Key (BREVO_API_KEY) not configured. Email alert skipped.');
    return;
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Alertas WMS STOCKA', email: 'no-reply@stocka.cl' },
        to: [{ email: toEmail, name: 'Stocka Chile' }],
        subject: subject,
        htmlContent: htmlContent
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`⚠️ Failed to send Brevo email alert: ${res.status} - ${errText}`);
    } else {
      console.log(`✉️ Email alert sent to ${toEmail}`);
    }
  } catch (err) {
    console.error('⚠️ Error sending Brevo email alert:', err.message);
  }
}

// ==========================================
// MAPEO DE ESTADO LOGÍSTICO WALMART A WMS
// ==========================================
function mapWalmartStatus(walmartStatus) {
  const s = (walmartStatus || '').toLowerCase().trim();
  if (s === 'cancelled' || s === 'canceled') {
    return 'cancelado';
  }
  if (s === 'shipped' || s === 'delivered') {
    return 'despachado';
  }
  if (s === 'acknowledged' || s === 'created') {
    return 'en preparación';
  }
  return 'para procesar';
}

// ==========================================
// FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncWalmartData() {
  console.log('🔄 Sincronizando con Walmart API...');

  try {
    // 1. Obtener todas las integraciones activas de Walmart en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Walmart')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Walmart configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🏢 Comercio: ${integration.comercio}`);
      console.log(`========================================`);

      let syncError = null;
      try {
        await syncMerchantOrders(integration);
      } catch (err) {
        console.error(`❌ Error al sincronizar pedidos de ${integration.comercio}:`, err.message);
        syncError = `Pedidos: ${err.message}`;
      }

      try {
        await syncMerchantProducts(integration);
      } catch (err) {
        console.error(`❌ Error al sincronizar catálogo de ${integration.comercio}:`, err.message);
        syncError = syncError ? `${syncError} | Catálogo: ${err.message}` : `Catálogo: ${err.message}`;
      }

      // Escribir estado en la base de datos
      try {
        await supabase
          .from('merchant_integrations')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_error: syncError
          })
          .eq('id', integration.id);
        console.log(`✅ Estado de sincronización de ${integration.comercio} actualizado.`);

        if (syncError) {
          const emailSubject = `⚠️ ALERTA: Fallo de Sincronización Walmart - ${integration.comercio}`;
          const emailBody = `
            <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #ddd; border-radius: 8px;">
              <h2 style="color: #b91c1c; margin-top: 0;">Alerta de Sincronización Walmart WMS STOCKA</h2>
              <p>Se ha detectado un problema al sincronizar la integración del comercio en el WMS.</p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
              <ul style="list-style: none; padding-left: 0;">
                <li style="margin-bottom: 10px;"><strong>Comercio:</strong> ${integration.comercio}</li>
                <li style="margin-bottom: 10px;"><strong>Plataforma:</strong> ${integration.platform}</li>
                <li style="margin-bottom: 10px;"><strong>Fecha/Hora:</strong> ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}</li>
                <li style="margin-bottom: 10px;">
                  <strong>Detalle del Error:</strong><br>
                  <pre style="background-color: #fef2f2; color: #991b1b; padding: 10px; border-radius: 4px; border: 1px solid #fee2e2; font-family: monospace; overflow-x: auto; margin-top: 5px;">${syncError}</pre>
                </li>
              </ul>
              <p style="margin-top: 20px; font-size: 0.9rem; color: #666;">Por favor, ingresa al panel de administración del WMS para revisar o re-sincronizar manualmente.</p>
            </div>
          `;
          await sendEmailAlert(emailSubject, emailBody);
        }
      } catch (dbErr) {
        console.error(`❌ Error al registrar estado de sincronización en DB:`, dbErr.message);
      }
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
  const tokenUrl = 'https://marketplace.walmartapis.com/v3/token';

  // Autenticación básica usando client_id y client_secret
  const clientId = integration.client_id;
  const clientSecret = integration.client_secret;

  if (!clientId || !clientSecret) {
    console.error('❌ Error: Falta Client ID o Client Secret para la integración de Walmart.');
    return null;
  }

  // Si tenemos refresh token, lo usamos para renovar
  if (integration.refresh_token) {
    console.log(`🔄 Renovando access token Walmart para el comercio ${integration.comercio}...`);
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integration.refresh_token
    });

    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const correlationId = crypto.randomUUID();

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId
        },
        body: params.toString()
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error en refresh_token flow Walmart: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      console.log(`✅ Token renovado con éxito.`);
      
      // Actualizar en base de datos inmediatamente
      await supabase
        .from('merchant_integrations')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token || integration.refresh_token // Walmart puede o no devolver un nuevo refresh token
        })
        .eq('id', integration.id);

      return data.access_token;
    } catch (e) {
      console.error(`❌ Error al renovar token Walmart:`, e.message);
      // Si falla, intentamos usar el authorization code inicial si estuviera disponible
    }
  }

  // Caso B: Es una nueva integración y tenemos el authorization code en access_token
  // (Nota: Si se usa el flujo donde guardamos el código inicial temporalmente en access_token)
  if (integration.access_token && !integration.refresh_token) {
    // Si la cadena parece un código OAuth (no un access_token JWT largo de Walmart)
    if (integration.access_token.length < 100) {
      console.log(`🔌 Realizando intercambio de código inicial (authorization_code) para Walmart - ${integration.comercio}...`);
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: integration.access_token,
        redirect_uri: integration.shop_url || 'https://www.google.com'
      });

      try {
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const correlationId = crypto.randomUUID();

        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'WM_SVC.NAME': 'Walmart Marketplace',
            'WM_QOS.CORRELATION_ID': correlationId
          },
          body: params.toString()
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Error en authorization_code flow Walmart: ${res.status} - ${errorText}`);
        }

        const data = await res.json();
        console.log(`✅ Código intercambiado correctamente. Registrando access_token y refresh_token...`);

        // Guardar en Supabase
        await supabase
          .from('merchant_integrations')
          .update({
            access_token: data.access_token,
            refresh_token: data.refresh_token || null
          })
          .eq('id', integration.id);

        return data.access_token;
      } catch (e) {
        console.error(`❌ Error al intercambiar código Walmart:`, e.message);
        return null;
      }
    } else {
      // Si es un access_token que ya parece estar configurado y no tenemos refresh token, lo devolvemos
      return integration.access_token;
    }
  }

  // En Walmart, a veces se puede obtener un access token directamente usando client_credentials
  // (Si el portal del vendedor permite Client Credentials directas, que es lo más común para apps customizadas)
  console.log(`🔄 Obteniendo access token usando client_credentials directas...`);
  const params = new URLSearchParams({
    grant_type: 'client_credentials'
  });

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const correlationId = crypto.randomUUID();

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': correlationId
      },
      body: params.toString()
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Error en client_credentials flow Walmart: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    console.log(`✅ Access token client_credentials obtenido con éxito.`);
    
    // Guardar temporalmente en DB
    await supabase
      .from('merchant_integrations')
      .update({
        access_token: data.access_token
      })
      .eq('id', integration.id);

    return data.access_token;
  } catch (e) {
    console.error(`❌ Error al obtener token por client_credentials:`, e.message);
    return null;
  }
}

/**
 * Sincroniza los pedidos de un cliente específico de Walmart
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
    throw new Error("No hay bodega configurada para este comercio");
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
      equivalences.filter(e => e.platform === 'Walmart').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // B. Obtener credenciales activas
  const accessToken = await getValidAccessToken(integration);
  if (!accessToken) {
    throw new Error("No se pudo obtener sesión activa para Walmart (API Key inválida o expirada)");
  }

  try {
    // 1. Obtener pedidos creados en los últimos 7 días
    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);
    const createdAfter = hace7Dias.toISOString();

    console.log(`--> Consultando pedidos Walmart creados después de: ${createdAfter}`);
    
    const correlationId = crypto.randomUUID();
    const searchUrl = `https://marketplace.walmartapis.com/v3/orders?createdStartDate=${createdAfter}&limit=50`;

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'WM_SEC.ACCESS_TOKEN': accessToken,
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': correlationId,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Error al buscar pedidos de Walmart: Status ${response.status}`);
    }

    const json = await response.json();
    
    // En Walmart v3, los pedidos están típicamente en list.elements.order
    let rawOrders = [];
    if (json && json.list && json.list.elements && json.list.elements.order) {
      rawOrders = Array.isArray(json.list.elements.order) ? json.list.elements.order : [json.list.elements.order];
    } else if (json && Array.isArray(json.orders)) {
      rawOrders = json.orders;
    }

    console.log(`Se encontraron ${rawOrders.length} pedidos crudos en Walmart.`);

    // 3. Procesar cada pedido
    for (const order of rawOrders) {
      const orderId = String(order.purchaseOrderId || order.customerOrderId);
      console.log(`\nProcesando pedido Walmart N°: ${orderId}`);

      // Mapear estado
      // Walmart order status es usualmente el status del order line, o global
      // Tomamos el status de las líneas de la orden
      let lineStatuses = [];
      let itemsList = [];
      let itemQuantities = {};
      let itemNames = [];
      let totalAmount = 0;

      const orderLines = order.orderLines?.orderLine || [];
      const linesArray = Array.isArray(orderLines) ? orderLines : [orderLines];

      for (const line of linesArray) {
        const sku = String(line.item?.sku || '').trim().replace(/\s+/g, '');
        const mappedSku = skuMap[sku] || sku;
        const title = line.item?.productName || 'Producto Walmart';
        const qty = Number(line.orderLineQuantity?.amount || 1);
        
        let price = 0;
        const charges = line.charge?.charges || [];
        const chargesArray = Array.isArray(charges) ? charges : [charges];
        const productCharge = chargesArray.find(c => c.chargeType === 'PRODUCT');
        if (productCharge && productCharge.chargeAmount) {
          price = Number(productCharge.chargeAmount.amount || 0);
        }

        itemsList.push({
          itemId: line.lineNumber,
          title: title,
          price: price,
          quantity: qty,
          sku: mappedSku
        });

        itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + qty;
        totalAmount += (price * qty);
        if (title && !itemNames.includes(title)) {
          itemNames.push(title);
        }

        const orderStatuses = line.orderLineStatuses?.orderLineStatus || [];
        const statusArray = Array.isArray(orderStatuses) ? orderStatuses : [orderStatuses];
        for (const st of statusArray) {
          if (st.status) lineStatuses.push(st.status);
        }
      }

      // Si hay varios estados, tomamos el más prioritario
      // Si todos son Shipped/Delivered -> despachado
      // Si alguno es Cancelled -> cancelado (o si todos lo son)
      // Por defecto -> en preparación / para procesar
      let finalWalmartStatus = 'Created';
      if (lineStatuses.includes('Cancelled')) {
        finalWalmartStatus = 'Cancelled';
      } else if (lineStatuses.every(s => s === 'Shipped' || s === 'Delivered')) {
        finalWalmartStatus = 'Shipped';
      } else if (lineStatuses.includes('Acknowledged') || lineStatuses.includes('Created')) {
        finalWalmartStatus = 'Acknowledged';
      }

      const isCancelled = finalWalmartStatus === 'Cancelled';
      const targetStatus = mapWalmartStatus(finalWalmartStatus);
      const shippingMethod = order.shippingInfo?.methodCode || 'Standard';

      // B. Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, comercio')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', orderId)
        .eq('external_platform', 'Walmart')
        .maybeSingle();

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        localOrderId = existingOrder.id;

        // Si se canceló en Walmart, cancelarlo en el WMS
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ payment_status: finalWalmartStatus, status: 'cancelado', created_at: order.orderDate })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${orderId} cancelado en Walmart. Actualizado en WMS.`);
        } else {
          // Actualizar datos del pedido
          const updatePayload = {
            payment_status: finalWalmartStatus,
            raw_walmart_data: order,
            created_at: order.orderDate,
            shipping_method: shippingMethod
          };
          
          if (existingOrder.status !== 'cancelado') {
            updatePayload.status = targetStatus;
          }

          await supabase
            .from('orders')
            .update(updatePayload)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${orderId} (Estado: ${targetStatus})`);
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
        // C. Es un pedido nuevo
        if (isCancelled) {
          console.log(`ℹ️ Pedido ${orderId} está cancelado en origen y no existe localmente. Omitiendo creación.`);
          continue;
        }

        const flatSku = Object.keys(itemQuantities).join(', ');
        const flatItemName = itemNames.join(', ');
        const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);

        // Mapear campos del destinatario
        const customerName = order.shippingInfo?.postalAddress?.name || 'Cliente Walmart';
        const customerPhone = order.shippingInfo?.phone || 'No especificado';
        
        const postalAddress = order.shippingInfo?.postalAddress;
        let shippingAddress = 'No especificada';
        let shippingCity = 'No especificada';
        let shippingComplement = '';
        if (postalAddress) {
          shippingAddress = `${postalAddress.address1 || ''} ${postalAddress.address2 || ''}`.trim() || 'No especificada';
          shippingCity = postalAddress.city || 'No especificada';
          shippingComplement = [postalAddress.state, postalAddress.postalCode].filter(Boolean).join(', ');
        }

        // Determinar comercio a asignar
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
        }

        const orderDataToSave = {
          merchant_id: integration.merchant_id,
          comercio: resolvedCommerce,
          external_order_number: orderId,
          external_platform: 'Walmart',
          payment_status: finalWalmartStatus,
          total_value: totalAmount,
          customer_email: order.customerEmailId || 'no-email@walmart.com',
          customer_phone: customerPhone,
          customer_name: customerName,
          shipping_address: shippingAddress,
          shipping_city: shippingCity,
          shipping_complement: shippingComplement,
          raw_walmart_data: order,
          origen: 'Walmart',
          item: flatItemName,
          cantidad: flatQuantity,
          sku: flatSku,
          shipping_method: shippingMethod,
          status: 'para procesar', // Insertar en para procesar temporalmente
          created_at: order.orderDate
        };

        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([orderDataToSave])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${orderId}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${orderId} con estado temporal 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;

        // Registrar items en order_items
        if (localOrderId && shouldInsertItems) {
          for (const [sku, qty] of Object.entries(itemQuantities)) {
            let { data: product } = await supabase
              .from('products')
              .select('id')
              .eq('sku', sku)
              .eq('comercio', integration.comercio)
              .maybeSingle();

            if (!product) {
              const itemDetail = itemsList.find(i => i.sku === sku);
              let name = 'Producto Walmart ' + sku;
              let price = 0;
              if (itemDetail) {
                name = itemDetail.title;
                price = itemDetail.price;
              }

              // Auto-crear producto faltante
              const { data: newProd, error: prodErr } = await supabase
                .from('products')
                .insert([{
                  merchant_id: integration.merchant_id,
                  comercio: integration.comercio,
                  sku: sku,
                  name: name,
                  barcode: sku, // Usar SKU como código de barras por defecto
                  price: price,
                  description: 'Creado automáticamente desde integración de Walmart'
                }])
                .select('id')
                .single();

              if (!prodErr && newProd) {
                console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${name}")`);
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
            console.log(`   ✅ Estado de la orden transicionado exitosamente a '${targetStatus}'`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para el comercio ${integration.comercio}:`, error.message);
    throw error;
  }
}

/**
 * Sincroniza el catálogo de productos de un vendedor de Walmart
 */
async function syncMerchantProducts(integration) {
  console.log('\n--> Sincronizando catálogo de productos desde Walmart...');

  const accessToken = await getValidAccessToken(integration);
  if (!accessToken) {
    throw new Error("No se pudo obtener sesión activa para Walmart (API Key inválida o expirada)");
  }

  try {
    const correlationId = crypto.randomUUID();
    let nextCursor = '*';
    let hasMore = true;
    let itemsDetails = [];

    // Fase A: Obtener items de Walmart (paginado)
    while (hasMore) {
      let searchUrl = `https://marketplace.walmartapis.com/v3/items?limit=50`;
      if (nextCursor && nextCursor !== '*') {
        searchUrl += `&nextCursor=${encodeURIComponent(nextCursor)}`;
      }

      const response = await fetch(searchUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Error al buscar items del vendedor en Walmart: Status ${response.status}`);
      }

      const json = await response.json();
      
      const elements = json.ItemResponse || [];
      itemsDetails.push(...elements);

      nextCursor = json.nextCursor;
      hasMore = elements.length > 0 && nextCursor && nextCursor !== '';
    }

    console.log(`Se encontraron ${itemsDetails.length} publicaciones de productos en Walmart.`);

    // Fase B: Guardar/actualizar en Supabase
    for (const itemDetail of itemsDetails) {
      const sku = String(itemDetail.sku || '').trim().replace(/\s+/g, '');
      if (!sku) continue;

      const productDataToSave = {
        comercio: integration.comercio,
        platform: 'Walmart',
        sku: sku,
        name: itemDetail.productName || 'Producto Walmart'
      };

      try {
        const { error } = await supabase
          .from('synced_products')
          .upsert([productDataToSave], { onConflict: 'comercio,platform,sku' });

        if (error) {
          console.error(`   ❌ Error al sincronizar SKU ${sku} en synced_products:`, error.message);
        } else {
          console.log(`   📥 Sincronizado SKU ${sku} en synced_products`);
        }
      } catch (err) {
        console.error(`   ❌ Error general al procesar SKU ${sku}:`, err.message);
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando catálogo para el comercio ${integration.comercio}:`, error.message);
    throw error;
  }
}

// Ejecutar script si es invocado directamente
if (require.main === module) {
  syncWalmartData();
}

module.exports = {
  syncWalmartData,
  syncMerchantOrders,
  syncMerchantProducts
};
