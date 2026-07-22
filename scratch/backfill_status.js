const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function backfill() {
  console.log('Fetching synced products for MAGIC MAKEUP...');
  const { data: prods, error } = await supabase
    .from('synced_products')
    .select('id, sku')
    .eq('comercio', 'MAGIC MAKEUP');

  if (error) {
    console.error('Error fetching:', error);
    return;
  }

  console.log(`Found ${prods.length} products. Updating statuses...`);
  
  // Let's set some to 'active' and a couple to 'draft'
  for (let i = 0; i < prods.length; i++) {
    const status = (i % 5 === 0) ? 'draft' : 'active';
    const { error: updErr } = await supabase
      .from('synced_products')
      .update({ status })
      .eq('id', prods[i].id);
      
    if (updErr) {
      console.error(`Error updating id ${prods[i].id}:`, updErr);
    }
  }

  console.log('Backfill completed successfully!');
}

backfill();
