const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log("Checking pg_net responses...");
  try {
    const { data, error } = await supabase.rpc('get_pg_net_responses');
    if (error) {
      console.error("Error executing RPC get_pg_net_responses:", error);
      console.log("\nPlease run this SQL in your Supabase Editor first:\n");
      console.log(`
CREATE OR REPLACE FUNCTION public.get_pg_net_responses()
RETURNS JSONB SECURITY DEFINER AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT jsonb_agg(t) INTO v_res
  FROM (
    SELECT *
    FROM net._http_response
    ORDER BY id DESC
    LIMIT 10
  ) t;
  RETURN v_res;
END;
$$ LANGUAGE plpgsql;
      `);
      return;
    }

    console.log("RESPONSES FROM pg_net:");
    console.log(JSON.stringify(data, null, 2));

  } catch (err) {
    console.error("Script error:", err);
  }
}

main();
