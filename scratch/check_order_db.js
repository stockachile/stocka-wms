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
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', '2000013912975267')
    .maybeSingle();

  if (error || !order) {
    console.error('Order not found in DB:', error);
    return;
  }

  console.log('ORDER IN DATABASE:');
  console.log(`ID: ${order.id}`);
  console.log(`Comercio: ${order.comercio}`);
  console.log(`Origen: ${order.origen}`);
  console.log(`Date Created: ${order.date_created}`);
  console.log(`Created At: ${order.created_at}`);
  console.log(`SLA (expected_date): ${order.expected_date}`);
  console.log(`Status: ${order.status}`);
  console.log(`Raw data:`, JSON.stringify(order.raw_data, null, 2));
}

run();
