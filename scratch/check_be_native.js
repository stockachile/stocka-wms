const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
  console.log('--- merchant_integrations for BE NATIVE ---');
  const { data: integrations, error: intErr } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('comercio', 'BE NATIVE');
  if (intErr) console.error(intErr);
  else console.log(integrations);

  console.log('--- count of synced_products for BE NATIVE ---');
  const { count: syncCount, error: syncErr } = await supabase
    .from('synced_products')
    .select('*', { count: 'exact', head: true })
    .eq('comercio', 'BE NATIVE');
  if (syncErr) console.error(syncErr);
  else console.log('Synced products count:', syncCount);

  console.log('--- count of products for BE NATIVE ---');
  const { count: prodCount, error: prodErr } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('comercio', 'BE NATIVE');
  if (prodErr) console.error(prodErr);
  else console.log('Products count:', prodCount);
}

check();
