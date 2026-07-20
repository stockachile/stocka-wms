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
  console.log("=== Inspecting Shopify Access Tokens ===");
  const { data: integrations } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify');

  integrations.forEach(i => {
    const token = i.access_token || '';
    console.log(`Comercio: ${i.comercio}`);
    console.log(`Shop URL: ${i.shop_url}`);
    console.log(`Token masked: ${token.slice(0, 8)}...${token.slice(-8)}`);
    console.log(`Token length: ${token.length}`);
    console.log(`Webhook secret: ${i.webhook_secret}`);
  });
}

run();
