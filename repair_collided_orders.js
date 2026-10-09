const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

const NUNOA_WH_ID = '973da888-8a63-4790-a08f-919e1af41a93';

async function repair() {
  console.log('=== PREPARANDO REPARACIÓN DE ÓRDENES CON COLISIÓN ===');

  const collidedOrders = [
    { num: '2000015407915385', cleanNum: '2000015407915385', comercio: 'HIT GAMING' },
    { num: '2000015405464029', cleanNum: '2000015405464029', comercio: 'HIT GAMING' },
    { num: '2000015406284173', cleanNum: '2000015406284173', comercio: 'HIT GAMING' },
    { num: '2000015415791929', cleanNum: '2000015415791929', comercio: 'HIT GAMING' },
    { num: '2000015416840109', cleanNum: '2000015416840109', comercio: 'HIT GAMING' },
    { num: '2000015420927113', cleanNum: '2000015420927113', comercio: 'HIT GAMING' },
    { num: 'SER2000015405033913', cleanNum: '2000015405033913', comercio: 'SERPA LTDA' },
    { num: 'SER2000015408493535', cleanNum: '2000015408493535', comercio: 'SERPA LTDA' },
    { num: 'SER2000015410561841', cleanNum: '2000015410561841', comercio: 'SERPA LTDA' },
    { num: 'SER2000015412796429', cleanNum: '2000015412796429', comercio: 'SERPA LTDA' },
    { num: 'SER2000015417412721', cleanNum: '2000015417412721', comercio: 'SERPA LTDA' },
    { num: 'MSE2000015408082817', cleanNum: '2000015408082817', comercio: 'MAESE' }
  ];

  for (const item of collidedOrders) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Analizando ${item.num} (${item.comercio})...`);

    const { data: o } = await wms
      .from('orders')
      .select('*')
      .eq('external_order_number', item.num)
      .maybeSingle();

    if (!o) {
      console.warn(`No se encontró en WMS: ${item.num}`);
      continue;
    }

    const raw = o.raw_meli_data || {};
    const shipping = raw.shipping;
    const orders = raw.orders || [];

    // Resolver items reales de Mercado Libre
    const realItems = [];
    if (orders.length > 0) {
      for (const ord of orders) {
        for (const it of (ord.order_items || [])) {
          let sku = it.item?.seller_sku || it.item?.seller_custom_field || '';
          if (!sku && it.item?.variation_attributes) {
            const vSku = it.item.variation_attributes.find(a => a.id === 'SELLER_SKU');
            if (vSku) sku = vSku.value_name;
          }
          if (!sku) sku = it.item?.id || 'Sin SKU';
          sku = String(sku).trim().replace(/\s+/g, '');
          realItems.push({
            sku: sku,
            name: it.item?.title || 'Producto MercadoLibre',
            quantity: Number(it.quantity || 1),
            price: Number(it.unit_price || 0)
          });
        }
      }
    } else if (shipping?.shipping_items) {
      for (const it of shipping.shipping_items) {
        realItems.push({
          sku: it.id || 'SKU-TEMP',
          name: it.description || 'Producto MercadoLibre',
          quantity: Number(it.quantity || 1),
          price: 0
        });
      }
    }

    const realTrack = shipping?.id ? String(shipping.id) : (shipping?.tracking_number ? String(shipping.tracking_number) : o.tracking_number);
    const realDate = shipping?.date_created || orders[0]?.date_created || new Date().toISOString();
    const isReadyToShip = shipping?.status === 'ready_to_ship';
    const targetWmsStatus = isReadyToShip ? 'En preparación' : 'En procesamiento';
    const targetStatus = isReadyToShip ? 'en preparación' : 'para procesar';

    // Resolver destinatario
    const receiver = shipping?.receiver_address;
    let customerName = o.customer_name;
    if (receiver?.receiver_name) customerName = receiver.receiver_name;
    let shippingAddress = o.shipping_address;
    if (receiver?.address_line) shippingAddress = receiver.address_line;
    let shippingCity = o.shipping_city;
    if (receiver?.city?.name) shippingCity = receiver.city.name;
    let shippingComplement = o.shipping_complement;
    if (receiver?.comment) shippingComplement = receiver.comment;

    console.log(`Datos a actualizar en WMS para ${item.num}:`);
    console.log({
      estado_wms: targetWmsStatus,
      status: targetStatus,
      created_at: realDate,
      tracking_number: realTrack,
      sucursal_pickeo: 'Sucursal Ñuñoa',
      customer_name: customerName,
      shipping_address: shippingAddress,
      shipping_city: shippingCity,
      item: realItems.map(i => i.name).join(', '),
      sku: realItems.map(i => i.sku).join(', '),
      cantidad: realItems.reduce((sum, i) => sum + i.quantity, 0)
    });
    console.log('Real items:', realItems);
  }
}

repair().finally(() => process.exit(0));
