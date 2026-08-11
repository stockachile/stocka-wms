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

async function testFullFetch() {
  try {
    const fromISO = new Date('2026-07-01T00:00:00').toISOString();
    const toISO = new Date('2026-08-10T23:59:59').toISOString();

    console.log('Starting full sequential fetch of WMS orders...');
    const startTime = Date.now();
    let allData = [];
    let from = 0;
    const step = 200;
    
    while (true) {
      const batchStart = Date.now();
      const { data, error } = await supabase
        .from('orders')
        .select(`
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
          shopify_exported,
          comercio,
          agenda,
          operador,
          fecha_procesamiento,
          sucursal_pickeo,
          periodo_facturacion,
          shopify_financial:raw_shopify_data->financial_status,
          shopify_fulfillment:raw_shopify_data->fulfillment_status,
          shopify_cancelled:raw_shopify_data->cancelled_at,
          shopify_line_items:raw_shopify_data->line_items,
          woocommerce_status:raw_woocommerce_data->status,
          woocommerce_line_items:raw_woocommerce_data->line_items,
          jumpseller_status:raw_jumpseller_data->status,
          jumpseller_products:raw_jumpseller_data->products,
          falabella_status:raw_falabella_data->status,
          falabella_state:raw_falabella_data->state,
          falabella_items:raw_falabella_data->items,
          meli_status:raw_meli_data->status,
          meli_order_items:raw_meli_data->order_items,
          paris_items:raw_paris_data->items,
          order_items (quantity, product_id, warehouse_id, products(id, sku, name, price, image_url, options, is_virtual, barcode, send_barcode_to_picker, picking_match_strict))
        `)
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at', { ascending: false })
        .range(from, from + step - 1);

      if (error) throw error;
      
      const batchTime = Date.now() - batchStart;
      console.log(`Fetched range [${from}, ${from + step - 1}] - ${data.length} rows in ${batchTime}ms.`);
      
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < step) break;
      from += step;
    }

    console.log(`\nFetch finished! Total rows: ${allData.length}. Total time: ${Date.now() - startTime}ms.`);

  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

testFullFetch();
