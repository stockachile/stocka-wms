const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = {};
if (fs.existsSync('.env')) {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      env[match[1]] = (match[2] || '').replace(/^"(.*)"$/, '$1').trim();
    }
  });
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function unifyMagicOrders() {
  const mariaId = 'bd23767f-869d-4c52-91d0-2d2ef95cb8c0';
  
  console.log(`Updating all MAGIC MAKEUP orders to merchant_id ${mariaId}...`);
  const { data, error } = await supabase
    .from('orders')
    .update({ merchant_id: mariaId })
    .eq('comercio', 'MAGIC MAKEUP');

  if (error) {
    console.error("Error updating orders:", error.message);
  } else {
    console.log("Successfully updated all MAGIC MAKEUP orders!");
  }

  // Check counts again
  const { data: orders } = await supabase
    .from('orders')
    .select('merchant_id')
    .eq('comercio', 'MAGIC MAKEUP');

  const orderCounts = {};
  if (orders) {
    orders.forEach(o => {
      orderCounts[o.merchant_id] = (orderCounts[o.merchant_id] || 0) + 1;
    });
  }
  console.log("Updated Orders per merchant_id for MAGIC MAKEUP:", orderCounts);
}

unifyMagicOrders();
