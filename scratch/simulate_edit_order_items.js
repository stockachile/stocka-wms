const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  console.log('Logging in as admin...');
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: 'stockachile@gmail.com',
    password: 'Mika17187'
  });

  if (authError) {
    console.error('Login failed:', authError);
    return;
  }
  console.log('Login successful! UID:', authData.user.id);

  // Let's get one order and one product to try inserting into order_items
  console.log('Fetching an order...');
  const { data: orders, error: ordersError } = await client
    .from('orders')
    .select('id, comercio')
    .limit(1);

  if (ordersError || !orders || orders.length === 0) {
    console.error('Failed to fetch order:', ordersError);
    return;
  }
  const order = orders[0];
  console.log('Target order:', order);

  console.log('Fetching a product for this commerce:', order.comercio);
  const { data: products, error: productsError } = await client
    .from('products')
    .select('id, sku, name')
    .eq('comercio', order.comercio)
    .limit(1);

  if (productsError || !products || products.length === 0) {
    console.error('Failed to fetch product:', productsError);
    return;
  }
  const product = products[0];
  console.log('Target product:', product);

  // Now, try to insert a row into order_items
  console.log('Attempting to insert a row into order_items...');
  const { data: inserted, error: insertError } = await client
    .from('order_items')
    .insert({
      order_id: order.id,
      product_id: product.id,
      quantity: 1,
      warehouse_id: null // trigger should set default
    })
    .select();

  console.log('Insert Result:', inserted);
  console.log('Insert Error:', insertError);

  // Let's try updating an existing order item if we can find one
  console.log('Fetching existing order_items for this order...');
  const { data: items, error: itemsError } = await client
    .from('order_items')
    .select('order_id, product_id, quantity')
    .eq('order_id', order.id);

  console.log('Current items:', items);
  if (items && items.length > 0) {
    const item = items[0];
    console.log('Attempting to update quantity of order_item...');
    const { data: updated, error: updateError } = await client
      .from('order_items')
      .update({ quantity: item.quantity + 1 })
      .eq('order_id', item.order_id)
      .eq('product_id', item.product_id)
      .select();

    console.log('Update Result:', updated);
    console.log('Update Error:', updateError);
  }
}

run();
