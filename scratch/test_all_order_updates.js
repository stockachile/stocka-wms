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

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log('Logging in...');
  const { data: { session } } = await supabase.auth.signInWithPassword({
    email: 'stockachile@gmail.com',
    password: 'Mika17187'
  });

  // Fetch the first 5 orders
  const { data: orders } = await supabase
    .from('orders')
    .select('id, comercio, estado_wms')
    .limit(5);

  console.log('Fetched 5 orders to test:', orders);

  for (const order of orders) {
    console.log(`Testing update on order ${order.id} (comercio: ${order.comercio})...`);
    const { data, error } = await supabase
      .from('orders')
      .update({ estado_wms: order.estado_wms }) // Update to same WMS status to avoid side effects
      .eq('id', order.id)
      .select();
    
    if (error) {
      console.error(`  Failed with error:`, error);
    } else {
      console.log(`  Result:`, data);
    }
  }
}

run();
