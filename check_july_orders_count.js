const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env from parent directory
const envPath = 'c:/Users/felip/Desktop/WMS STOCKA/.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const companyList = [
    'MMEDD', 'SERPA LTDA', 'RCT CHILE', 'SIMPLEMENTE CAFE', 'THE SKIN STORE', 'SILVER FOX',
    'JOYAS GLOSS', 'ALLTOKE', 'POM KIDS', 'STOCKA STORE TEST', 'YHANOS', 'BACK IN TIME',
    'DORMILONES', 'RELAJARTE', 'BE NATIVE', 'HIT GAMING', 'MAGIC MAKEUP', 'SMILE FOR PETS'
  ];
  
  const startOfMonth = new Date(2026, 6, 1).toISOString(); // July 1st, 2026 local time -> ISO
  console.log("startOfMonth:", startOfMonth);
  
  // Count using supabase count option
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfMonth)
    .in('comercio', companyList);
    
  if (error) {
    console.error("Error counting orders:", error);
    return;
  }
  
  console.log(`Total orders GTE startOfMonth for felipe.trup@gmail.com's comercios: ${count}`);
}

run();
