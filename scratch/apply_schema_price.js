const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

async function main() {
  const sqlPath = path.join(__dirname, '..', 'supabase_schema_shopify_products_price.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Sending SQL schema to Supabase exec_sql...');
  const { data, error } = await supabase.rpc('exec_sql', { sql });

  console.log('Result Data:', data);
  console.log('Result Error:', error);
}

main().catch(console.error);
