const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env manually
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
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

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== Querying unique statuses and counts from lightdata_envios using Postgres ===");
  // Since supabase-js doesn't support GROUP BY directly, we can use the exec_sql RPC (if it works under a different name)
  // or we can query all and aggregate in JS (which might be slow if there are millions of rows, but let's check count first).
  
  const { count, error: countErr } = await supabase
    .from('lightdata_envios')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.error("Error getting count:", countErr);
    return;
  }

  console.log("Total rows in lightdata_envios:", count);

  // If there are less than 100k rows, we can easily fetch them in chunks or use select('status') with pagination.
  // Wait, let's use client-side aggregation by fetching status columns only.
  let allStatuses = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('lightdata_envios')
      .select('status')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error("Error fetching page:", error);
      break;
    }

    if (!data || data.length === 0) break;
    allStatuses.push(...data.map(d => d.status));
    page++;
    if (data.length < pageSize) break;
  }

  const counts = {};
  allStatuses.forEach(s => {
    const key = s || 'NULL';
    counts[key] = (counts[key] || 0) + 1;
  });

  console.log("All unique statuses in lightdata_envios:", counts);
}

run();
