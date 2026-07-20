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

async function run() {
  console.log("=== Querying merchant_integrations ===");
  const { data: integrations, error } = await supabase
    .from('merchant_integrations')
    .select('*');
  
  if (error) {
    console.error(error);
    return;
  }
  
  console.log("All Integrations:");
  integrations.forEach(i => {
    console.log(`ID: ${i.id}, Comercio: ${i.comercio}, Platform: ${i.platform}, Active: ${i.is_active}, CreatedAt: ${i.created_at}`);
  });
}

run();
