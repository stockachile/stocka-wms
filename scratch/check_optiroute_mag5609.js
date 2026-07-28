const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cargar archivo .env
const envPath = path.join(__dirname, '..', '.env');
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

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("=== Fetching Optiroute token and querying order 4722370 ===");
  
  // 1. Obtener integración
  const { data: integrations } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Optiroute')
    .eq('is_active', true);
  
  if (!integrations || integrations.length === 0) {
    console.error('No active Optiroute integration found.');
    return;
  }

  // We find the one for MAGIC MAKEUP
  const integration = integrations.find(i => i.comercio === 'MAGIC MAKEUP') || integrations[0];
  console.log(`Using integration for commerce: ${integration.comercio}`);

  // 2. Fetch order from Optiroute API
  const url = `https://app.optiroute.cl/api/v1/integration-service-requests/4722370/`;
  console.log(`Fetching from: ${url}`);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Token ${integration.access_token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    console.error(`API failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(text);
    return;
  }

  const detailedOrder = await res.json();
  console.log("Optiroute API Response:");
  console.log(JSON.stringify(detailedOrder, null, 2));
}

run();
