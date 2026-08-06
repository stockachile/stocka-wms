const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'c:/Users/felip/Desktop/WMS STOCKA/.env';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findAllVinaOrders() {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, external_order_number, status, estado_wms, comercio, courier, shipping_address, customer_name, tracking_number, created_at')
      .or('shipping_address.ilike.%viña%,shipping_address.ilike.%vina%,shipping_address.ilike.%valparaiso%,shipping_address.ilike.%valpo%');

    if (error) throw error;

    console.log(`Se encontraron ${orders.length} pedidos en la tabla orders con destino a Viña del Mar/Valparaíso.`);
    orders.forEach(o => {
      console.log(`- ID: ${o.id}, Ref: ${o.external_order_number}, Comercio: ${o.comercio}, Cliente: ${o.customer_name}, Dirección: ${o.shipping_address}, Estado WMS: ${o.estado_wms}, Courier: ${o.courier}, Tracking: ${o.tracking_number}, Creado: ${o.created_at}`);
    });
  } catch (err) {
    console.error(err);
  }
}

findAllVinaOrders();
