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

async function run() {
  console.log('Reverting stock for "Café 3 variedades"...');

  // 1. Find the movements for "Ingreso de Stock: Café 3 variedades"
  const refDoc = 'Ingreso de Stock: Café 3 variedades';
  const { data: movs, error: movsErr } = await supabase
    .from('movements')
    .select('*')
    .eq('reference_doc', refDoc);

  if (movsErr) {
    console.error('Error fetching movements:', movsErr);
    return;
  }

  console.log(`Found ${movs ? movs.length : 0} movements to revert.`);

  if (movs && movs.length > 0) {
    for (const mov of movs) {
      console.log(`Processing movement: ID ${mov.id}, Product ID ${mov.product_id}, Qty ${mov.quantity}`);

      // Find the corresponding inventory row
      const { data: invs, error: invErr } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', mov.product_id)
        .eq('warehouse_id', mov.warehouse_id);

      if (invErr) {
        console.error('Error fetching inventory for product:', invErr);
        continue;
      }

      for (const inv of invs) {
        const newQty = inv.quantity - mov.quantity;
        if (newQty <= 0) {
          console.log(`Deleting inventory record (new quantity would be ${newQty}): ID ${inv.id}`);
          const { error: delErr } = await supabase
            .from('inventory')
            .delete()
            .eq('id', inv.id);
          if (delErr) console.error('Error deleting inventory row:', delErr);
        } else {
          console.log(`Decrementing inventory record from ${inv.quantity} to ${newQty}: ID ${inv.id}`);
          const { error: updErr } = await supabase
            .from('inventory')
            .update({ quantity: newQty })
            .eq('id', inv.id);
          if (updErr) console.error('Error updating inventory row:', updErr);
        }
      }

      // Delete the movement record
      console.log(`Deleting movement record: ID ${mov.id}`);
      const { error: delMovErr } = await supabase
        .from('movements')
        .delete()
        .eq('id', mov.id);
      if (delMovErr) console.error('Error deleting movement row:', delMovErr);
    }
  }

  // 2. Clear products_list or cache of that declaration if needed (actually it's okay to keep products_list in the declaration metadata, but we should make sure we don't auto-sum it if they save it again. Wait, the declaration status is already "Recibido Conforme", so it won't transition again).
  console.log('Revert completed successfully.');
}

run();
