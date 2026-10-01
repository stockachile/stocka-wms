const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      env[match[1]] = value.trim();
    }
  });
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Check the inventory record
  const { data: inv } = await supabase
    .from('inventory')
    .select('*')
    .eq('product_id', '35bf628e-d7e3-4092-adf9-e8217a86d430');
  console.log('Inventory row:', inv);

  // Check audit_logs or similar
  const { data: audits, error: aErr } = await supabase
    .from('audit_logs')
    .select('*')
    .limit(5);
  console.log('audit_logs table:', aErr ? aErr.message : audits);

  // Check if there are other warehouses
  const { data: wh } = await supabase
    .from('warehouses')
    .select('*');
  console.log('Warehouses:', wh);

  // Check all orders of B4LIFE from August 2026 to see stock evolution
  const { data: augOrders } = await supabase
    .from('orders')
    .select('id, external_order_number, created_at, status, stock_descontado')
    .eq('comercio', 'B4LIFE')
    .gte('created_at', '2026-08-01T00:00:00')
    .lte('created_at', '2026-08-31T23:59:59');
  console.log('August orders count:', augOrders?.length);
  augOrders?.forEach(o => console.log(`  ${o.created_at} | ${o.external_order_number} | stock_descontado: ${o.stock_descontado}`));
}

main().catch(console.error);
