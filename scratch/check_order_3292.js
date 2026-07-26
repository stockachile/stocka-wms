const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('Querying order #3292...');
  const { data: orders } = await client
    .from('orders')
    .select('*')
    .eq('external_order_number', '#3292');

  console.log('Orders found:', orders);

  if (orders && orders.length > 0) {
    const orderId = orders[0].id;
    console.log('\nQuerying order_items for order:', orderId);
    const { data: items } = await client
      .from('order_items')
      .select('*, products(*)')
      .eq('order_id', orderId);

    console.log('Order items:');
    items.forEach((item, idx) => {
      console.log(`\nItem ${idx + 1}:`);
      console.log(`  id: ${item.id}`);
      console.log(`  product_id: ${item.product_id}`);
      console.log(`  quantity: ${item.quantity}`);
      console.log(`  sku: ${item.products?.sku}`);
      console.log(`  name: ${item.products?.name}`);
    });
  }
}

run();
