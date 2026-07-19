const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
  const { data, error } = await supabase.rpc('inspect_table_policies', { table_name: 'products' });
  if (error) {
    // If RPC doesn't exist, we can use a direct SQL query via a custom function or see if there is another way.
    // Let's run a query on pg_policies using supabase.rpc or check if there is an existing function.
    console.error('RPC Error:', error);
    
    // Let's try executing arbitrary query if there is any execute_sql function
    const { data: policies, error: polErr } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'products');
    if (polErr) {
      console.error('pg_policies select error:', polErr);
      // Let's try select from pg_catalog.pg_policies
      const { data: d, error: e } = await supabase.from('pg_catalog.pg_policies').select('*');
      console.error(e);
    } else {
      console.log(policies);
    }
  } else {
    console.log(data);
  }
}

check();
