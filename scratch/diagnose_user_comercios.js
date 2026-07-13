const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function diagnose() {
  console.log('--- START DIAGNOSIS ---');
  
  // 1. Get profile data
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, email, comercio, role');
  if (pErr) console.error('Profiles error:', pErr);
  else console.log('Profiles in DB:', profiles);

  // 2. Get products data (limit 5)
  const { data: products, error: prErr } = await supabase
    .from('products')
    .select('id, sku, name, comercio, stock_critico')
    .limit(5);
  if (prErr) console.error('Products error:', prErr);
  else console.log('Products in DB (sample):', products);

  // 3. Get inventory data (limit 5)
  const { data: inventory, error: invErr } = await supabase
    .from('inventory')
    .select('id, product_id, quantity, products!inner(comercio)')
    .limit(5);
  if (invErr) console.error('Inventory error:', invErr);
  else console.log('Inventory in DB (sample):', inventory);

  // 4. Get comercios_adicional_config
  const { data: configs, error: cfgErr } = await supabase
    .from('comercios_adicional_config')
    .select('*');
  if (cfgErr) console.error('Config error:', cfgErr);
  else console.log('comercios_adicional_config in DB:', configs);

  console.log('--- END DIAGNOSIS ---');
}

diagnose();
