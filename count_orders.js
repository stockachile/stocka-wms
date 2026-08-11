const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'c:/Users/felip/Desktop/WMS STOCKA/.env';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function countOrders() {
  try {
    const fromISO = new Date('2026-07-01T00:00:00').toISOString();
    const toISO = new Date('2026-08-10T23:59:59').toISOString();

    console.log('Counting total orders in the database...');
    const { count: totalCount, error: err1 } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });
    
    if (err1) throw err1;
    console.log(`Total orders: ${totalCount}`);

    console.log('\nCounting orders in the selected date range (2026-07-01 to 2026-08-10)...');
    const startTime = Date.now();
    const { count: rangeCount, error: err2 } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', fromISO)
      .lte('created_at', toISO);

    if (err2) throw err2;
    console.log(`Orders in range: ${rangeCount} (Query took ${Date.now() - startTime}ms)`);

  } catch (err) {
    console.error(err);
  }
}

countOrders();
