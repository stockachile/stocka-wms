const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

async function run() {
  const { data: columns } = await supabase.from('orders').select('*').limit(1);
  if (columns && columns.length > 0) {
    const keys = Object.keys(columns[0]);
    console.log('Available columns in orders table:', keys);
    
    // Search in all columns that are strings
    for (const key of keys) {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq(key, '2000013912975267')
        .limit(1);
      
      if (data && data.length > 0) {
        console.log(`FOUND ORDER IN COLUMN "${key}":`);
        console.log(JSON.stringify(data[0], null, 2));
        return;
      }
    }
    console.log('Order 2000013912975267 not found in any column of orders table.');
  }
}

run();
