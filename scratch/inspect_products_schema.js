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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectSchema() {
  const { data, error } = await supabase
    .from('synced_products')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching product:', error);
  } else if (data && data.length > 0) {
    console.log('Columns of public.products:');
    console.log(Object.keys(data[0]));
  } else {
    console.log('No products in DB to inspect schema.');
  }
}

inspectSchema();
