const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

const supabaseUrl = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== Fetching Relajarte Shopify orders since July 17th ===");
  const { data: integrations, error } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify')
    .eq('comercio', 'RELAJARTE')
    .eq('is_active', true);

  if (error || !integrations || integrations.length === 0) {
    console.error("Relajarte Shopify integration not found:", error);
    return;
  }

  const integration = integrations[0];
  console.log(`Shop URL: ${integration.shop_url}`);
  
  try {
    const response = await fetch(`https://${integration.shop_url}/admin/api/2024-04/orders.json?status=any&created_at_min=2026-07-17T00:00:00-04:00`, {
      headers: {
        "X-Shopify-Access-Token": integration.access_token
      }
    });

    if (!response.ok) {
      console.log(`Shopify API error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.log(`Response: ${text}`);
      return;
    }

    const data = await response.json();
    console.log(`Found ${data.orders.length} orders in Shopify since July 17th:`);
    data.orders.forEach(o => {
      console.log(`- Shopify Order ID: ${o.id}, Number: ${o.order_number}, CreatedAt: ${o.created_at}, Total: ${o.total_price}`);
    });
  } catch (err) {
    console.error("Sync request failed:", err);
  }
}

run();
