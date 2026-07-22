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

async function testCampaigns() {
  console.log('=== Starting Campaign Trigger Test ===');
  const commerce = 'TEST_CAMPAIGNS_COMMERCE';

  // 0. Pre-cleanup
  console.log('0. Pre-cleaning test data...');
  const { data: oldOrders } = await supabase.from('orders').select('id').eq('comercio', commerce);
  if (oldOrders && oldOrders.length > 0) {
    const ids = oldOrders.map(o => o.id);
    await supabase.from('order_items').delete().in('order_id', ids);
    await supabase.from('orders').delete().in('id', ids);
  }
  await supabase.from('campaigns').delete().eq('comercio', commerce);
  await supabase.from('products').delete().eq('comercio', commerce);

  // 1. Create a mock merchant/comercio entry or profile if needed? No, just products with this commerce.
  // Let's create two products
  console.log('1. Creating test products...');
  const { data: prod1, error: p1Err } = await supabase
    .from('products')
    .insert({
      comercio: commerce,
      sku: 'TEST-TRIGGER-SKU',
      name: 'Trigger Product A',
      price: 10000,
      status: 'active'
    })
    .select()
    .single();

  if (p1Err) throw p1Err;
  console.log('Created Trigger Product:', prod1.id);

  const { data: prod2, error: p2Err } = await supabase
    .from('products')
    .insert({
      comercio: commerce,
      sku: 'TEST-GIFT-SKU',
      name: 'Free Gift Mug',
      price: 0,
      status: 'active'
    })
    .select()
    .single();

  if (p2Err) throw p2Err;
  console.log('Created Gift Product:', prod2.id);

  // 2. Create a campaign
  console.log('2. Creating active campaign...');
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .insert({
      comercio: commerce,
      name: 'Free Mug Campaign',
      active: true,
      trigger_skus: ['TEST-TRIGGER-SKU'],
      gift_sku: 'TEST-GIFT-SKU',
      gift_quantity: 1
    })
    .select()
    .single();

  if (campErr) throw campErr;
  console.log('Created Campaign:', campaign.id);

  // 3. Create a mock order
  console.log('3. Creating mock order...');
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      comercio: commerce,
      external_order_number: 'TEST-ORDER-CAMP-001',
      status: 'para procesar',
      payment_status: 'PAID'
    })
    .select()
    .single();

  if (orderErr) throw orderErr;
  console.log('Created Order:', order.id);

  // Get a warehouse id to use
  const { data: wh, error: whErr } = await supabase.from('warehouses').select('id').limit(1).single();
  const warehouseId = wh ? wh.id : null;
  console.log('Using Warehouse ID:', warehouseId);

  // 4. Insert trigger item
  console.log('4. Inserting trigger item into order_items...');
  const { data: item, error: itemErr } = await supabase
    .from('order_items')
    .insert({
      order_id: order.id,
      product_id: prod1.id,
      warehouse_id: warehouseId,
      quantity: 1
    })
    .select()
    .single();

  if (itemErr) throw itemErr;
  console.log('Inserted item:', item.id);

  // 5. Query order_items to see if the gift item was automatically inserted by the DB trigger
  console.log('5. Querying order items to check for gift auto-insertion...');
  const { data: finalItems, error: queryErr } = await supabase
    .from('order_items')
    .select('*, products(sku, name)')
    .eq('order_id', order.id);

  if (queryErr) throw queryErr;

  console.log('--- Order Items Found in DB: ---');
  finalItems.forEach(i => {
    console.log(`- Product: ${i.products.name} (${i.products.sku}), Quantity: ${i.quantity}`);
  });

  const hasGift = finalItems.some(i => i.products.sku === 'TEST-GIFT-SKU');
  if (hasGift) {
    console.log('\n✅ SUCCESS: Gift product was automatically added by the database trigger!');
  } else {
    console.log('\n❌ FAILURE: Gift product was NOT added by the database trigger.');
  }

  // 6. Cleanup test data
  console.log('\n6. Cleaning up test data...');
  await supabase.from('order_items').delete().eq('order_id', order.id);
  await supabase.from('orders').delete().eq('id', order.id);
  await supabase.from('campaigns').delete().eq('id', campaign.id);
  await supabase.from('products').delete().eq('id', prod1.id);
  await supabase.from('products').delete().eq('id', prod2.id);
  console.log('Cleanup completed successfully.');
}

testCampaigns().catch(err => {
  console.error('Test execution failed:', err);
});
