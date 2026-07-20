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

async function checkWebhooks() {
  console.log("=== Checking Shopify webhooks for all integrations ===");
  const { data: integrations, error } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify')
    .eq('is_active', true);

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Found ${integrations.length} active Shopify integrations.`);

  for (const integration of integrations) {
    console.log(`\n--------------------------------------------`);
    console.log(`Comercio: ${integration.comercio}`);
    console.log(`Shop URL: ${integration.shop_url}`);
    console.log(`Access Token: ${integration.access_token ? 'Present (length: ' + integration.access_token.length + ')' : 'MISSING'}`);
    
    if (!integration.access_token || !integration.shop_url) {
      console.log('Skipping due to missing token or URL.');
      continue;
    }

    try {
      const response = await fetch(`https://${integration.shop_url}/admin/api/2024-04/webhooks.json`, {
        headers: {
          "X-Shopify-Access-Token": integration.access_token
        }
      });

      if (!response.ok) {
        console.log(`Shopify API error: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log(`Response: ${text}`);
        continue;
      }

      const data = await response.json();
      console.log('Webhooks registered in Shopify:');
      if (data.webhooks && data.webhooks.length > 0) {
        data.webhooks.forEach(w => {
          console.log(`- Topic: ${w.topic}, Address: ${w.address}`);
        });
      } else {
        console.log('No webhooks registered!');
      }
    } catch (err) {
      console.error(`Request failed:`, err);
    }
  }
}

checkWebhooks();
