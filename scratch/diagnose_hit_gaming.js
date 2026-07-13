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

// Copiar getValidAccessToken de sync_meli.js
async function getValidAccessToken(integration) {
  const tokenUrl = 'https://api.mercadolibre.com/oauth/token';
  if (integration.refresh_token) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      refresh_token: integration.refresh_token
    });
    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
      const data = await res.json();
      await supabase
        .from('merchant_integrations')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          username: String(data.user_id)
        })
        .eq('id', integration.id);
      return { accessToken: data.access_token, userId: data.user_id };
    } catch (e) {
      console.error("Error al renovar token:", e.message);
      return null;
    }
  }
  return null;
}

async function diagnose() {
  console.log('Fetching HIT GAMING integration...');
  const { data: integration, error } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('comercio', 'HIT GAMING')
    .eq('platform', 'MercadoLibre')
    .maybeSingle();

  if (error || !integration) {
    console.error('Integration not found:', error);
    return;
  }

  console.log('Getting valid access token...');
  const credentials = await getValidAccessToken(integration);
  if (!credentials) {
    console.error('Failed to get access token');
    return;
  }

  const { accessToken, userId } = credentials;
  console.log(`MercadoLibre User ID: ${userId}`);

  // Query orders created today (July 8th, 2026) in UTC
  const todayStr = '2026-07-08T00:00:00.000Z';
  console.log(`Querying orders created after: ${todayStr}`);

  const searchUrl = `https://api.mercadolibre.com/orders/search?seller=${userId}&date_created.from=${todayStr}&sort=date_desc`;
  const response = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    console.error(`Failed to fetch orders: ${response.status} - ${await response.text()}`);
    return;
  }

  const data = await response.json();
  const results = data.results || [];
  console.log(`Found ${results.length} orders on MercadoLibre created today:`);

  results.forEach(order => {
    console.log(`- Order ID: ${order.id}`);
    console.log(`  Date Created: ${order.date_created} (Local time parse: ${new Date(order.date_created).toLocaleString('es-CL', { timeZone: 'America/Santiago' })})`);
    console.log(`  Status: ${order.status}`);
    console.log(`  Shipping Status: ${order.shipping ? order.shipping.id : 'N/A'}`);
    console.log(`  Total Amount: ${order.total_amount}`);
  });
}

diagnose();
