const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const orderNumber = 'MAG5602';
  const targetWarehouse = '973da888-8a63-4790-a08f-919e1af41a93'; // Matriz Ñuñoa
  const productId = '8f9d9a49-baf7-44f5-a1a0-9c6895c5b83b';

  console.log('--- Initial Inventory ---');
  const { data: initInv } = await supabase
    .from('inventory')
    .select('*, warehouses(name)')
    .eq('product_id', productId);
  console.log(JSON.stringify(initInv, null, 2));

  console.log('\n--- Fetching Order Items ---');
  const { data: order } = await supabase
    .from('orders')
    .select('id, external_order_number, order_items(*)')
    .eq('external_order_number', orderNumber)
    .maybeSingle();

  console.log('Order ID:', order.id);
  console.log('Order Items:', JSON.stringify(order.order_items, null, 2));

  console.log('\n--- Updating Order Items Warehouse ID ---');
  const { data: updateRes, error: updateErr } = await supabase
    .from('order_items')
    .update({ warehouse_id: targetWarehouse })
    .eq('order_id', order.id)
    .select();

  if (updateErr) {
    console.error('Update failed:', updateErr);
  } else {
    console.log('Update succeeded:', JSON.stringify(updateRes, null, 2));

    console.log('\n--- Final Inventory ---');
    const { data: finalInv } = await supabase
      .from('inventory')
      .select('*, warehouses(name)')
      .eq('product_id', productId);
    console.log(JSON.stringify(finalInv, null, 2));

    // Revert it back to Central to leave it clean for the user to do the actual flow in WMS
    console.log('\n--- Reverting back to Bodega Central ---');
    const centralWarehouse = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';
    await supabase
      .from('order_items')
      .update({ warehouse_id: centralWarehouse })
      .eq('order_id', order.id);
    
    console.log('Reverted successfully.');
  }
}

run();
