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
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true });
    
  if (error) {
    console.error("Error counting orders:", error);
    return;
  }
  
  console.log(`Total orders in orders table: ${count}`);
}

run();
