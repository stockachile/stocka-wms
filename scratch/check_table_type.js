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

async function checkTableType() {
  console.log('Creating temp RPC to check if orders is a table or view...');
  // We can create a temp RPC that checks information_schema.tables
  await supabase.rpc('exec_sql', { sql: `
    CREATE OR REPLACE FUNCTION get_table_type(t_name text) 
    RETURNS text 
    LANGUAGE plpgsql SECURITY DEFINER AS $$ 
    DECLARE 
      t_type text;
    BEGIN 
      SELECT table_type INTO t_type FROM information_schema.tables WHERE table_name = t_name;
      RETURN t_type;
    END; $$
  ` });

  const { data: tType, error } = await supabase.rpc('get_table_type', { t_name: 'orders' });
  if (error) {
    console.error('Error fetching table type:', error);
  } else {
    console.log('Type of "orders":', tType);
  }
}

checkTableType();
