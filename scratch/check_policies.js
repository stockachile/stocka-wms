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

async function checkPolicies() {
  const { data, error } = await supabase.rpc('get_policies_for_table', { table_name: 'orders' });
  if (error) {
    // If rpc doesn't exist, query pg_policies directly via sql if we can (using a raw select if supported, or via postgrest)
    console.log('RPC error or missing:', error.message);
    
    // Let's run a query on pg_policies using a raw postgres query if possible. Since we can't do raw sql via supabase client easily without an RPC, let's look for existing RPCs or check pg_policies via a function.
    // Let's try calling another RPC or listing them.
    const { data: policies, error: polErr } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('schemaname', 'public')
      .eq('tablename', 'orders');
    
    if (polErr) {
      console.log('Direct query on pg_policies failed (which is normal if it is not exposed in API):', polErr.message);
      
      // Let's create a temporary RPC to run raw SQL and check policies!
      console.log('Creating a temp RPC to query policies...');
      await supabase.rpc('exec_sql', { sql: 'CREATE OR REPLACE FUNCTION get_table_policies(t_name text) RETURNS TABLE(policy_name text, cmd text, roles text[], qual text, with_check text) LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN QUERY SELECT policyname::text, cmd::text, roles::text[], qual::text, with_check::text FROM pg_policies WHERE tablename = t_name; END; $$' });
      
      const { data: res, error: rpcErr } = await supabase.rpc('get_table_policies', { t_name: 'orders' });
      if (rpcErr) {
        console.error('Failed to query table policies:', rpcErr);
      } else {
        console.log('Policies for table "orders":', res);
      }
    } else {
      console.log('pg_policies data:', policies);
    }
  } else {
    console.log('Policies:', data);
  }
}

checkPolicies();
