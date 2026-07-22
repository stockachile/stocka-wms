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

async function backfillAllFast() {
  console.log('1. Setting all NULL statuses to "active" in bulk...');
  const { data: updData, error: updErr } = await supabase
    .from('synced_products')
    .update({ status: 'active' })
    .is('status', null)
    .select('id');

  if (updErr) {
    console.error('Error in bulk update to active:', updErr);
    return;
  }
  
  console.log('Bulk active update completed.');

  console.log('2. Fetching some products to set as "draft" for testing variations...');
  const { data: prods, error: fetchErr } = await supabase
    .from('synced_products')
    .select('id')
    .eq('status', 'active')
    .limit(150);

  if (fetchErr) {
    console.error('Error fetching for draft:', fetchErr);
    return;
  }

  if (prods && prods.length > 0) {
    console.log(`3. Setting ${prods.length} products to "draft" state...`);
    const idsToSetDraft = prods.filter((_, idx) => idx % 6 === 0).map(p => p.id);
    
    if (idsToSetDraft.length > 0) {
      const { error: draftErr } = await supabase
        .from('synced_products')
        .update({ status: 'draft' })
        .in('id', idsToSetDraft);

      if (draftErr) {
        console.error('Error setting draft status:', draftErr);
      } else {
        console.log(`Successfully set ${idsToSetDraft.length} products to draft status!`);
      }
    }
  }

  console.log('All backfills completed successfully!');
}

backfillAllFast();
