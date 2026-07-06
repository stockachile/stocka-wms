const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
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
}

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkIntegrations() {
  console.log("=== Checking Integrations for MAGIC MAKEUP ===");
  
  const { data: integrations, error } = await supabase
    .from('merchant_integrations')
    .select('*');
    
  if (error) {
    console.error("Error fetching merchant_integrations:", error);
    return;
  }
  
  console.log("All Integrations:");
  integrations.forEach(integration => {
    console.log(`ID: ${integration.id}, Comercio: ${integration.comercio}, Platform: ${integration.platform}, Created: ${integration.created_at}, Syncing: ${integration.sync_status}`);
    console.log(`  Shop URL: ${integration.shop_url}`);
    console.log(`  Access Token: ${integration.access_token ? '(Present)' : '(Missing)'}`);
    console.log(`  Webhook Secret: ${integration.webhook_secret ? '(Present)' : '(Missing)'}`);
  });
  
  console.log("\n=== Checking Orders ===");
  const { data: orders, error: oError } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, origen, created_at, status')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (oError) {
    console.error("Error reading orders:", oError);
  } else {
    console.log("Last 10 orders in system:");
    orders.forEach(o => {
      console.log(`Order ID: ${o.id}, Ext: ${o.external_order_number}, Comercio: ${o.comercio}, Origen: ${o.origen}, Status: ${o.status}, Date: ${o.created_at}`);
    });
  }
}

checkIntegrations();
