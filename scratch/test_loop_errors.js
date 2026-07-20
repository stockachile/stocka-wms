const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env manually
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value.trim();
  }
});

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const felipeComercios = [
  'BE NATIVE', 'DORMILONES', 'HIT GAMING', 'JOYAS GLOSS', 
  'RCT CHILE', 'RELAJARTE', 'SIMPLEMENTE CAFE', 'SMILE FOR PETS', 
  'BACK IN TIME', 'LAQU & COMPANY', 'STOCKA STORE TEST', 'MAGIC MAKEUP'
];

async function run() {
  console.log("=== Loading all orders and shipments for Felipe in July ===");
  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (quantity, products(sku, name))
    `)
    .in('comercio', felipeComercios)
    .gte('created_at', '2026-07-01T00:00:00+00:00')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  const { data: shipments } = await supabase
    .from('envios_unificados')
    .select('*')
    .in('pedido_referencia', orders.map(o => o.external_order_number).filter(Boolean));

  console.log(`Loaded ${orders.length} orders and ${shipments ? shipments.length : 0} shipments.`);

  // Emulate formatCLP
  const formatCLP = (v) => `$${v}`;

  let errorCount = 0;
  orders.forEach((order, index) => {
    try {
      let orderShipments = (shipments || []).filter(s => 
        s.pedido_referencia === order.id || 
        (order.external_order_number && s.pedido_referencia === order.external_order_number) ||
        (order.tracking_number && s.pedido_referencia === order.tracking_number)
      );

      const isVirtualPlatform = order.origen === 'MercadoLibre' || 
                                order.external_platform === 'MercadoLibre' || 
                                order.origen === 'Falabella' || 
                                order.external_platform === 'Falabella' ||
                                order.origen === 'Paris' || 
                                order.external_platform === 'Paris';

      if (orderShipments.length === 0 && isVirtualPlatform) {
        orderShipments = [{
          id: `virtual:${order.id}`,
          source_table: 'virtual',
          source_id: order.id,
          tracking: order.tracking_number || 'N/A',
          tracking_url: order.tracking_url || 'N/A',
          courier: order.courier || 'Virtual',
          status: order.status,
          global_status: 'SIN MOVIMIENTO',
          created_at: order.created_at,
          updated_at: order.created_at
        }];
      }

      // Check date source
      const dateSource = (orderShipments.length > 0 && orderShipments[0].created_at) 
        ? orderShipments[0].created_at 
        : order.created_at;

      const dateObj = new Date(dateSource);
      const dateStr = dateObj.toLocaleDateString();

      // items rows loop simulation
      let itemsRowsHtml = '';
      if (order.order_items && order.order_items.length > 0) {
        const grouped = {};
        order.order_items.forEach(oi => {
          const pSku = oi.products?.sku || oi.sku || 'Sin SKU';
          const pName = oi.products?.name || oi.item_name || 'Sin Nombre';
          const pQty = Number(oi.quantity) || 1;
          
          if (!grouped[pSku]) {
            grouped[pSku] = {
              sku: pSku,
              name: pName,
              quantity: 0
            };
          }
          grouped[pSku].quantity += pQty;
        });

        Object.values(grouped).forEach(item => {
          const pPrice = item.quantity > 0 ? (Number(order.total_value) / item.quantity) : 0;
          const subtotal = item.quantity * pPrice;
        });
      } else {
        const pQty = Number(order.cantidad) || 1;
        const pPrice = pQty > 0 ? (Number(order.total_value) / pQty) : 0;
      }

    } catch (e) {
      errorCount++;
      console.error(`Error at order index ${index} (ID: ${order.id}, Num: ${order.external_order_number}):`, e.message);
    }
  });

  console.log(`Finished checking. Total loop errors: ${errorCount}`);
}

run();
