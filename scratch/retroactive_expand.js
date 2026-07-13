const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
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

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ordersToExpand = ['2000013952688733', '3108198000'];

async function expand() {
  console.log('=== RETROACTIVE PACK EXPANSION ===');

  for (const extNum of ordersToExpand) {
    console.log(`\nProcessing Order: ${extNum}`);
    
    // 1. Fetch order details
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, status, WMS:estado_wms')
      .eq('external_order_number', extNum)
      .maybeSingle();

    if (orderErr || !order) {
      console.error(`Error finding order ${extNum}:`, orderErr);
      continue;
    }

    console.log(`Order WMS status: ${order.WMS}, Status: ${order.status}`);

    // 2. Fetch pack items in this order
    const { data: orderItems, error: itemsErr } = await supabase
      .from('order_items')
      .select('*, products(*)')
      .eq('order_id', order.id);

    if (itemsErr) {
      console.error(`Error fetching items for order ${order.id}:`, itemsErr);
      continue;
    }

    for (const item of orderItems) {
      if (item.products?.is_pack) {
        console.log(`Found unexpanded pack: ${item.products.sku} (Quantity: ${item.quantity})`);

        // Fetch pack components
        const { data: components, error: compErr } = await supabase
          .from('product_pack_items')
          .select('*, products:member_product_id(sku, name)')
          .eq('pack_product_id', item.product_id);

        if (compErr) {
          console.error(`Error fetching components for pack ${item.product_id}:`, compErr);
          continue;
        }

        if (!components || components.length === 0) {
          console.log(`Pack ${item.products.sku} has no components configured. Skipping.`);
          continue;
        }

        console.log(`Pack components count: ${components.length}`);

        // Insert component items into order_items
        for (const comp of components) {
          const compQty = item.quantity * comp.quantity;
          console.log(`Inserting component: ${comp.products.sku} x${compQty}`);
          
          const { error: insErr } = await supabase
            .from('order_items')
            .insert([{
              order_id: order.id,
              product_id: comp.member_product_id,
              warehouse_id: item.warehouse_id,
              quantity: compQty
            }]);

          if (insErr) {
            console.error(`Error inserting component item:`, insErr);
          } else {
            console.log(`Successfully inserted ${comp.products.sku} x${compQty}`);
          }
        }

        // Delete original pack item
        console.log(`Deleting original pack item: ${item.products.sku}`);
        const { error: delErr } = await supabase
          .from('order_items')
          .delete()
          .eq('id', item.id);

        if (delErr) {
          console.error(`Error deleting original pack item:`, delErr);
        } else {
          console.log(`Successfully deleted pack item ${item.products.sku}`);
        }
      }
    }
  }

  console.log('\n=== DONE ===');
}
expand();
