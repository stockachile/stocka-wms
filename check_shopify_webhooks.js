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

async function checkTokens() {
  console.log("=== Listing MAGIC MAKEUP Integrations & Token Prefixes ===");
  const { data: integrations, error } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify');
    
  if (error || !integrations) {
    console.error("Error or no integrations found:", error);
    return;
  }
  
  integrations.forEach(i => {
    const token = i.access_token || '';
    console.log(`Platform: ${i.platform}, Comercio: ${i.comercio}`);
    console.log(`  Shop URL: ${i.shop_url}`);
    console.log(`  Token: ${token}`);
    console.log(`  Webhook Secret: ${i.webhook_secret}`);
  });
}

checkTokens();
