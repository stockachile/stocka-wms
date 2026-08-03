const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'c:/Users/felip/Desktop/WMS STOCKA/.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Implementation of fetchAllSupabaseRows
async function fetchAllSupabaseRows(tableName, selectStr, filterCallback) {
  let allData = [];
  let from = 0;
  const step = 200;
  while (true) {
    let q = supabase.from(tableName).select(selectStr);
    if (filterCallback) q = filterCallback(q);
    const { data, error } = await q.range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    console.log(`Fetched ${data.length} rows (total: ${allData.length})`);
    if (data.length < step) break;
    from += step;
  }
  return allData;
}

async function run() {
  const now = new Date("2026-08-01T12:00:00");
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  console.log("startOfMonth:", startOfMonth);
  
  console.time("Fetch Full History");
  try {
    const histOrders = await fetchAllSupabaseRows('orders', `
      id,
      status,
      estado_wms,
      created_at,
      external_order_number,
      external_platform,
      origen,
      item,
      cantidad,
      sku,
      label_base64,
      total_value,
      customer_name,
      customer_email,
      customer_phone,
      shipping_address,
      shipping_city,
      shipping_complement,
      shipping_method,
      payment_status,
      tracking_number,
      tracking_url,
      courier,
      raw_woocommerce_data,
      raw_jumpseller_data,
      raw_falabella_data,
      raw_meli_data,
      raw_optiroute_data,
      raw_lightdata_data,
      raw_paris_data,
      raw_shopify_data,
      shopify_exported,
      comercio,
      agenda,
      operador,
      fecha_procesamiento,
      sucursal_pickeo,
      periodo_facturacion,
      order_items (quantity, product_id, warehouse_id, products(id, sku, name, price, image_url, options, is_virtual, barcode, send_barcode_to_picker))
    `, q => q.lt('created_at', startOfMonth).order('created_at', { ascending: false }));
    
    console.timeEnd("Fetch Full History");
    console.log(`Successfully fetched ${histOrders.length} full historical orders.`);
  } catch (err) {
    console.timeEnd("Fetch Full History");
    console.error("Error fetching full historical orders:", err);
  }
}

run();
