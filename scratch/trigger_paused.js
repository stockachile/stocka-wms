const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const commerce = 'STOCKA STORE TEST';
  console.log(`Setting ${commerce} to al_dia = false...`);
  await supabase
    .from('commerce_billing_status')
    .upsert({ comercio: commerce, al_dia: false });

  // Wait 3 seconds
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log(`Setting ${commerce} to al_dia = true (restored)...`);
  const { error } = await supabase
    .from('commerce_billing_status')
    .upsert({ comercio: commerce, al_dia: true });

  if (error) {
    console.error("Error setting status:", error);
    return;
  }

  console.log("Waiting 5 seconds for pg_net execution...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log("Checking pg_net responses...");
  const { data: responses, error: resErr } = await supabase.rpc('get_pg_net_responses');
  if (resErr) {
    console.error("Error getting responses:", resErr);
    return;
  }

  console.log("LATEST PG_NET RESPONSES:");
  console.log(JSON.stringify(responses.slice(0, 2), null, 2));
}

main();
