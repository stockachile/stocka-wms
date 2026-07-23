const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function rename() {
  console.log('Starting migration to rename POMS KIDS to POM KIDS...');

  // 1. Fetch old config
  const { data: oldConfigs, error: fetchErr } = await supabase
    .from('comercios_adicional_config')
    .select('*')
    .eq('comercio', 'POMS KIDS');

  if (fetchErr) {
    console.error('Error fetching old config:', fetchErr.message);
    return;
  }

  if (oldConfigs && oldConfigs.length > 0) {
    const oldConfig = oldConfigs[0];
    console.log('Found old config for POMS KIDS:', oldConfig);

    // Insert new config with 'POM KIDS'
    const newConfig = {
      ...oldConfig,
      comercio: 'POM KIDS'
    };
    // Remove database generated / unique columns if needed (none here)
    const { error: insertErr } = await supabase
      .from('comercios_adicional_config')
      .insert(newConfig);

    if (insertErr) {
      console.error('Error inserting new config:', insertErr.message);
      return;
    }
    console.log('Inserted new config for POM KIDS successfully.');
  } else {
    console.log('No old config found for POMS KIDS in comercios_adicional_config.');
  }

  // 2. Update products
  const { count: prodCount, error: prodErr } = await supabase
    .from('products')
    .update({ comercio: 'POM KIDS' })
    .eq('comercio', 'POMS KIDS');

  if (prodErr) {
    console.error('Error updating products:', prodErr.message);
  } else {
    console.log(`Updated products successfully.`);
  }

  // 3. Update orders
  const { count: orderCount, error: orderErr } = await supabase
    .from('orders')
    .update({ comercio: 'POM KIDS' })
    .eq('comercio', 'POMS KIDS');

  if (orderErr) {
    console.error('Error updating orders:', orderErr.message);
  } else {
    console.log(`Updated orders successfully.`);
  }

  // 4. Delete old config
  if (oldConfigs && oldConfigs.length > 0) {
    const { error: deleteErr } = await supabase
      .from('comercios_adicional_config')
      .delete()
      .eq('comercio', 'POMS KIDS');

    if (deleteErr) {
      console.error('Error deleting old config:', deleteErr.message);
    } else {
      console.log('Deleted old config for POMS KIDS successfully.');
    }
  }

  console.log('Migration finished.');
}

rename();
