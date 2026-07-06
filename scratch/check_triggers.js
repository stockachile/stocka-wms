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

async function checkTriggers() {
  console.log('Creating RPC to query pg_trigger...');
  await supabase.rpc('exec_sql', { sql: `
    CREATE OR REPLACE FUNCTION get_table_triggers(t_name text) 
    RETURNS TABLE(trigger_name text, event_manipulation text, action_statement text, action_timing text) 
    LANGUAGE plpgsql SECURITY DEFINER AS $$ 
    BEGIN 
      RETURN QUERY 
      SELECT 
        tgname::text as trigger_name,
        CASE 
          WHEN (tgtype & 2) <> 0 THEN 'INSERT'
          WHEN (tgtype & 4) <> 0 THEN 'DELETE'
          WHEN (tgtype & 16) <> 0 THEN 'UPDATE'
          ELSE 'OTHER'
        END::text as event_manipulation,
        proname::text as action_statement,
        CASE 
          WHEN (tgtype & 1) <> 0 THEN 'ROW'
          ELSE 'STATEMENT'
        END::text as action_timing
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE c.relname = t_name;
    END; $$
  ` });

  const { data: triggers, error } = await supabase.rpc('get_table_triggers', { t_name: 'orders' });
  if (error) {
    console.error('Error fetching triggers:', error);
  } else {
    console.log('Triggers on table "orders":', triggers);
  }
}

checkTriggers();
