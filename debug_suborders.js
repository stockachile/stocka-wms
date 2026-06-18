const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cargar variables de entorno locales
const envPath = path.join(__dirname, '.env');
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

async function test() {
  const { data: integration } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Paris')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const apiKey = integration.access_token;
  
  try {
    const authRes = await fetch('https://api-developers.ecomm.cencosud.com/v1/auth/apiKey', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const authData = await authRes.json();
    const jwtToken = authData.accessToken;

    const res = await fetch('https://api-developers.ecomm.cencosud.com/v1/orders?limit=1', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    const firstOrder = data.data[0];
    
    console.log('Order originOrderNumber:', firstOrder.originOrderNumber);
    console.log('subOrders type:', typeof firstOrder.subOrders, Array.isArray(firstOrder.subOrders) ? 'Array' : 'Not Array');
    
    if (firstOrder.subOrders && firstOrder.subOrders.length > 0) {
      console.log('Number of subOrders:', firstOrder.subOrders.length);
      console.log('Keys of first subOrder:', Object.keys(firstOrder.subOrders[0]));
      console.log('Items in first subOrder:', firstOrder.subOrders[0].items ? firstOrder.subOrders[0].items.length : 'undefined');
    }
  } catch (err) {
    console.error('Err:', err);
  }
}

test();
