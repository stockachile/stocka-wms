const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkWebhooks() {
  const { data: integrations } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify')
    .eq('is_active', true);

  if (!integrations || integrations.length === 0) {
    console.log('No active integrations.');
    return;
  }
  const integration = integrations[0];
  console.log('Checking shop:', integration.shop_url);

  const response = await fetch(`https://${integration.shop_url}/admin/api/2024-04/webhooks.json`, {
    headers: {
      "X-Shopify-Access-Token": integration.access_token
    }
  });

  const data = await response.json();
  console.log('Webhooks registered:', JSON.stringify(data.webhooks, null, 2));
}

checkWebhooks();
