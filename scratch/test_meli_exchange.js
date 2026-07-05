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

async function testExchange() {
  // Get the MercadoLibre integration for STOCKA STORE TEST
  const { data: integration, error } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'MercadoLibre')
    .eq('comercio', 'STOCKA STORE TEST')
    .maybeSingle();

  if (error || !integration) {
    console.error('Integration not found:', error);
    return;
  }

  console.log('Found integration details:', {
    id: integration.id,
    client_id: integration.client_id,
    shop_url: integration.shop_url,
    access_token_has_tg: integration.access_token?.startsWith('TG-'),
    refresh_token: integration.refresh_token
  });

  const tokenUrl = 'https://api.mercadolibre.com/oauth/token';
  let params;

  if (integration.refresh_token) {
    console.log('Testing refresh token renewal...');
    params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      refresh_token: integration.refresh_token
    });
  } else {
    console.log('Testing authorization code exchange...');
    params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      code: integration.access_token,
      redirect_uri: integration.shop_url || 'https://www.google.com'
    });
  }

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    console.log('Response status:', res.status);
    const bodyText = await res.text();
    console.log('Response body:', bodyText);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

testExchange();
