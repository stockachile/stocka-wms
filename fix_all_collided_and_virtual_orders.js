const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

const NUNOA_WH_ID = '973da888-8a63-4790-a08f-919e1af41a93';

const ORDERS_TO_REPAIR = [
  // HIT GAMING
  {
    orderNumber: '2000015407915385',
    cleanNumber: '2000015407915385',
    comercio: 'HIT GAMING',
    productId: '288f8e70-a49f-46af-8ac3-9ab10ec20c17',
    sku: 'MS-VX-R1SE-BK',
    name: 'Mouse Gamer Vxe R1 Se+ Dragonfly Inalambrico Paw3395 Color Negro',
    qty: 1,
    tracking: '48199518584',
    dateCreated: '2026-10-07T15:28:34.352-04:00',
    customerName: 'Miguel Angel Soto Vera',
    address: 'Avenida Libertador Bernardo Ohiggins 4719',
    city: 'Santiago',
    complement: '1618 Referencia: Dejar en recepción para departamento 1618',
    image: 'https://http2.mlstatic.com/D_698881-MLA95147853834_102025-O.webp'
  },
  {
    orderNumber: '2000015405464029',
    cleanNumber: '2000015405464029',
    comercio: 'HIT GAMING',
    productId: '1875dce1-9ced-43a6-bb9f-35de5af1cea0',
    sku: 'MS-VX-R1SE-WH',
    name: 'Mouse Gamer Vxe R1 Se+ Dragonfly Inalambrico Paw3395 Color Blanco',
    qty: 1,
    tracking: '48198274508',
    dateCreated: '2026-10-07T13:28:22.861-04:00',
    customerName: 'ELYAN VALENZUELA',
    address: 'Frankfort 5071',
    city: 'San Miguel',
    complement: '',
    image: ''
  },
  {
    orderNumber: '2000015406284173',
    cleanNumber: '2000015406284173',
    comercio: 'HIT GAMING',
    productId: '7805ee3b-0681-4f34-b201-04df6aa59f18',
    sku: 'KB-AJ-AK820PRO-GR',
    name: 'AJAZZ KEYBOARD AK820 PRO GREY - FLYING FISH SWITCH',
    qty: 1,
    tracking: '48198686278',
    dateCreated: '2026-10-07T14:08:06.037-04:00',
    customerName: 'Diego Ramirez Guiñez',
    address: 'Chacabuco 1175',
    city: 'Santiago',
    complement: '',
    image: ''
  },
  {
    orderNumber: '2000015415791929',
    cleanNumber: '2000015415791929',
    comercio: 'HIT GAMING',
    productId: '93cdf27b-7090-466b-b0a2-777fad3b90c3',
    sku: 'AL-CS-VIRTUOSOCG-BK',
    name: 'EAR PADS CORSAIR VIRTUOSO COOLING GEL BLACK',
    qty: 1,
    tracking: '48203055633',
    dateCreated: '2026-10-07T22:15:23.577-04:00',
    customerName: 'Ignacio Becerra Gallardo',
    address: 'BRASIL 666',
    city: 'Concepcion',
    complement: '',
    image: ''
  },
  {
    orderNumber: '2000015416840109',
    cleanNumber: '2000015416840109',
    comercio: 'HIT GAMING',
    productId: 'b1a5a88b-e41f-4d6f-b7d0-1cd16a2b515b',
    sku: 'MS-AT-A92P-PK',
    name: 'Mouse Atk A9 2.0 Plus Inalambrico Paw3395 Rosa',
    qty: 1,
    tracking: '48203855584',
    dateCreated: '2026-10-07T23:24:47.487-04:00',
    customerName: 'Johanna Noemí Ramos Arraño',
    address: 'Los olmos 3223 SN',
    city: 'Macul',
    complement: '',
    image: ''
  },
  {
    orderNumber: '2000015420927113',
    cleanNumber: '2000015420927113',
    comercio: 'HIT GAMING',
    productId: 'b1a5a88b-e41f-4d6f-b7d0-1cd16a2b515b',
    sku: 'MS-AT-A92P-PK',
    name: 'Mouse Atk A9 2.0 Plus Inalambrico Paw3395 Rosa',
    qty: 1,
    tracking: '48205611901',
    dateCreated: '2026-10-08T09:09:31.364-04:00',
    customerName: 'Pia Espinoza',
    address: 'Rivas 530',
    city: 'San Joaquín',
    complement: '',
    image: ''
  },

  // SERPA LTDA
  {
    orderNumber: 'SER2000015405033913',
    cleanNumber: '2000015405033913',
    comercio: 'SERPA LTDA',
    productId: 'eba75afa-f851-48d3-94a7-59c166f5f114',
    sku: 'BGPPA',
    name: 'Perfume Sin Alcohol Biogance Parisian Vainilla Para Perros Y Gatos 50ml',
    qty: 1,
    tracking: '48198064266',
    dateCreated: '2026-10-07T13:08:02.734-04:00',
    customerName: 'deysi ossandon',
    address: 'Pasaje Uno 713',
    city: 'Copiapo',
    complement: '',
    image: ''
  },
  {
    orderNumber: 'SER2000015408493535',
    cleanNumber: '2000015408493535',
    comercio: 'SERPA LTDA',
    productId: '86beec56-089d-43cc-83a8-4fc2d157889a',
    sku: 'BGGLD',
    name: 'Desenredante Abrillantador Perro 150ml Aceite Jojoba Biogance N/a',
    qty: 1,
    tracking: '48199494483',
    dateCreated: '2026-10-07T15:58:56.483-04:00',
    customerName: 'Maricel Ferrer Pérez',
    address: 'Mar Jonico 7515',
    city: 'Vitacura',
    complement: '',
    image: ''
  },
  {
    orderNumber: 'SER2000015410561841',
    cleanNumber: '2000015410561841',
    comercio: 'SERPA LTDA',
    productId: 'c52261d6-1617-4ef6-b40e-d27f16d94efb',
    sku: 'BGWD300',
    name: 'Shampoo En Seco Hipoalergénico Para Perros Biogance 300ml N/a',
    qty: 1,
    tracking: '48200526997',
    dateCreated: '2026-10-07T17:49:35.795-04:00',
    customerName: 'Camila Galleguillos',
    address: 'Paseo Maria Merani de Casanova 3661',
    city: 'Peñalolén',
    complement: '',
    image: ''
  },
  {
    orderNumber: 'SER2000015412796429',
    cleanNumber: '2000015412796429',
    comercio: 'SERPA LTDA',
    productId: '73ad2290-90a6-4803-91ae-802f5c182132',
    sku: 'BGPSP',
    name: 'Perfume Biogance Jazmín Sin Alcohol Para Perros Y Gatos Fragancia Floral 50ml',
    qty: 1,
    tracking: '48201964954',
    dateCreated: '2026-10-07T19:44:37.271-04:00',
    customerName: 'Valentina Gonzalez',
    address: 'Pasaje Palguin 367',
    city: 'Quilicura',
    complement: '',
    image: ''
  },
  {
    orderNumber: 'SER2000015417412721',
    cleanNumber: '2000015417412721',
    comercio: 'SERPA LTDA',
    // 2 items: BGPPA x 1 + BGPPM x 1
    items: [
      {
        productId: 'eba75afa-f851-48d3-94a7-59c166f5f114',
        sku: 'BGPPA',
        name: 'Perfume Sin Alcohol Biogance Parisian Vainilla Para Perros Y Gatos 50ml',
        qty: 1
      },
      {
        productId: 'daf458ec-45cc-472a-a04f-fa276bce3eb8',
        sku: 'BGPPM',
        name: 'Perfume Sin Alcohol Biogance Para Perros Y Gatos Lavanda Cedro 50 Ml',
        qty: 1
      }
    ],
    tracking: '48203766709',
    dateCreated: '2026-10-08T00:22:08.420-04:00',
    customerName: 'Angélica Paz de Nuestra Señora de la Esp Pmartínez Johnson',
    address: 'Avenida Adolfo Eastman Cox 908',
    city: 'Limache',
    complement: '',
    image: ''
  },

  // MAESE
  {
    orderNumber: 'MSE2000015408082817',
    cleanNumber: '2000015408082817',
    comercio: 'MAESE',
    productId: '81777c43-fc38-4a7d-aca1-d57af0dc6c5e',
    sku: '5902444723161',
    name: 'D3 + K2 4000iu 120 tabletas -Proactive',
    qty: 3,
    tracking: '48199289675',
    dateCreated: '2026-10-07T19:38:38-04:00',
    customerName: '',
    address: 'Avenida Vicuña Mackenna 327',
    city: 'Santiago',
    complement: 'Referencia: Dpto 711',
    image: ''
  }
];

async function run() {
  console.log('🚀 INICIANDO REPARACIÓN Y SINCRONIZACIÓN DE PEDIDOS...\n');

  for (const item of ORDERS_TO_REPAIR) {
    console.log(`=======================================================`);
    console.log(`📦 Procesando pedido: ${item.orderNumber} (${item.comercio})`);

    // 1. Obtener orden en WMS
    const { data: order, error: oErr } = await wms
      .from('orders')
      .select('id, external_order_number')
      .eq('external_order_number', item.orderNumber)
      .maybeSingle();

    if (!order) {
      console.error(`❌ No se encontró en WMS: ${item.orderNumber}`);
      continue;
    }

    const orderId = order.id;

    // 2. Determinar items
    const itemsList = item.items || [{
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      qty: item.qty
    }];

    const flatName = itemsList.map(i => i.name).join(', ');
    const flatSku = itemsList.map(i => i.sku).join(', ');
    const totalQty = itemsList.reduce((sum, i) => sum + i.qty, 0);

    // 3. Actualizar orden en WMS
    const updatePayload = {
      estado_wms: 'En preparación',
      status: 'en preparación',
      sucursal_pickeo: 'Sucursal Ñuñoa',
      tracking_number: item.tracking,
      created_at: item.dateCreated,
      item: flatName,
      sku: flatSku,
      cantidad: totalQty,
      courier: 'MERCADOLIBRE',
      operador: 'MERCADOLIBRE'
    };

    if (item.customerName) updatePayload.customer_name = item.customerName;
    if (item.address) updatePayload.shipping_address = item.address;
    if (item.city) updatePayload.shipping_city = item.city;
    if (item.complement) updatePayload.shipping_complement = item.complement;

    const { error: upErr } = await wms.from('orders').update(updatePayload).eq('id', orderId);
    if (upErr) {
      console.error(`❌ Error actualizando orden ${item.orderNumber} en WMS:`, upErr.message);
      continue;
    }
    console.log(`✅ WMS orders actualizado: 'En preparación', sucursal 'Sucursal Ñuñoa', tracking '${item.tracking}'`);

    // 4. Limpiar order_items viejos/basura y registrar los items reales
    await wms.from('order_items').delete().eq('order_id', orderId);
    for (const it of itemsList) {
      const { error: insItemErr } = await wms.from('order_items').insert({
        order_id: orderId,
        product_id: it.productId,
        warehouse_id: NUNOA_WH_ID,
        quantity: it.qty
      });
      if (insItemErr) console.error(`   ❌ Error insertando item ${it.sku}:`, insItemErr.message);
      else console.log(`   + Item vinculado: ${it.sku} x ${it.qty} (Bodega Matriz Ñuñoa)`);
    }

    // 5. Actualizar o insertar en Picker active_orders
    // 5.1 Eliminar duplicados previos en active_orders (tanto con prefijo como sin prefijo, y en cualquier sucursal)
    const orderSearchKeys = [item.orderNumber, item.cleanNumber, '#' + item.orderNumber, '#' + item.cleanNumber];
    await picker.from('active_orders').delete().in('order_number', orderSearchKeys);

    // 5.2 Insertar en Picker con Sucursal Ñuñoa y estado EN PREPARACIÓN
    const pickerPayloads = itemsList.map(it => ({
      sucursal: 'Sucursal Ñuñoa',
      order_number: item.orderNumber,
      agenda: 'MERCADOLIBRE',
      quantity: it.qty,
      sku: it.sku,
      name: it.name,
      color: null,
      talla: null,
      manga: null,
      cuello: null,
      client_name: item.customerName || 'Cliente MercadoLibre',
      tracking: item.tracking,
      operator: 'FLEX ⚡ - SLA: 08/10/26 23:00',
      totu: totalQty,
      sheet_status: 'EN PREPARACIÓN',
      observation: '',
      fecha: new Date().toISOString().split('T')[0],
      contact_data_q: '',
      contact_data_r: '',
      contact_data_s: item.address || '',
      contact_data_t: item.city || '',
      contact_data_u: item.complement || '',
      extra_col_v: item.image || '',
      comercio: item.comercio,
      created_by: 'Sistema WMS - Recuperación',
      picking_match_strict: false
    }));

    const { error: pInsErr } = await picker.from('active_orders').insert(pickerPayloads);
    if (pInsErr) {
      console.error(`❌ Error insertando en Picker active_orders para ${item.orderNumber}:`, pInsErr.message);
    } else {
      console.log(`🎉 Picker active_orders exitoso: ${pickerPayloads.length} item(s) en 'Sucursal Ñuñoa' con estado 'EN PREPARACIÓN'!`);
    }
  }

  // 6. Limpieza de duplicados residuales en Sucursal Virtual para órdenes ya despachadas
  console.log(`\n🧹 Limpiando órdenes ya despachadas de Sucursal Virtual (Hub) en Picker...`);
  const ordersToCleanFromVirtual = [
    '2000015399072131',
    '2000015395408559',
    '2000015400574121',
    '2000015391881617',
    '2000015392992489'
  ];
  const { error: delErr } = await picker
    .from('active_orders')
    .delete()
    .eq('sucursal', 'Sucursal Virtual (Hub)')
    .in('order_number', ordersToCleanFromVirtual);
  if (!delErr) {
    console.log(`✅ Limpiados ${ordersToCleanFromVirtual.length} pedidos residuales de Sucursal Virtual.`);
  }

  // 7. Limpieza de pedidos de MAGIC MAKEUP que ya tienen versión con prefijo en Sucursal Ñuñoa
  const magicWithoutPrefix = [
    '2000018866195870',
    '2000015420489159',
    '2000015401662489',
    '2000018850350068',
    '2000015413526469'
  ];
  await picker
    .from('active_orders')
    .delete()
    .eq('sucursal', 'Sucursal Virtual (Hub)')
    .in('order_number', magicWithoutPrefix);
  console.log(`✅ Limpiados duplicados sin prefijo de MAGIC MAKEUP en Sucursal Virtual.`);

  console.log(`\n✨ ¡PROCESO DE REPARACIÓN FINALIZADO CON ÉXITO!`);
}

run().finally(() => process.exit(0));
