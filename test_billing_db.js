const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Parse .env manually
const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value.trim();
    }
  });
}

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testDatabase() {
  console.log("=== Testing DB Setup ===");
  
  // 1. Check periods
  console.log("1. Querying billing_periods...");
  const { data: periods, error: pError } = await supabase.from('billing_periods').select('*').limit(3);
  if (pError) {
    console.error("Error reading billing_periods:", pError);
  } else {
    console.log("SUCCESS: billing_periods query succeeded. Count returned:", periods.length);
    console.log("Sample periods:", periods);
  }

  // 2. Check billing records (with new column)
  console.log("2. Querying billing_records...");
  const { data: records, error: rError } = await supabase
    .from('billing_records')
    .select('id, comercio, fecha_limite, fecha_limite_enviame')
    .limit(3);
    
  if (rError) {
    console.error("FAIL: Error reading billing_records (check if column exists):", rError);
  } else {
    console.log("SUCCESS: billing_records query succeeded, including fecha_limite_enviame.");
    console.log("Sample records:", records);
  }

  // 3. Check RPC: check_overdue_payments
  console.log("3. Calling RPC check_overdue_payments...");
  const { error: overdueError } = await supabase.rpc('check_overdue_payments');
  if (overdueError) {
    console.error("FAIL: Error calling check_overdue_payments RPC:", overdueError);
  } else {
    console.log("SUCCESS: check_overdue_payments RPC executed successfully.");
  }

  // 4. Check RPC: clean_old_receipts
  console.log("4. Calling RPC clean_old_receipts...");
  const { error: cleanError } = await supabase.rpc('clean_old_receipts');
  if (cleanError) {
    console.error("FAIL: Error calling clean_old_receipts RPC:", cleanError);
  } else {
    console.log("SUCCESS: clean_old_receipts RPC executed successfully.");
  }

  console.log("=== Testing Finished ===");
}

testDatabase();
