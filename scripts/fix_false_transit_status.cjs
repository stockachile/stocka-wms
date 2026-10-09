const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envConfig = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const envVars = {};
envConfig.split(/\r?\n/).forEach(line => {
  if (!line || line.startsWith('#')) return;
  const idx = line.indexOf('=');
  if (idx !== -1) {
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    envVars[k] = v;
  }
});

const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`Corrigiendo status de órdenes con falso tránsito (Dry Run: ${isDryRun})...\n`);

  let from = 0;
  const batchSize = 1000;
  const allMeli = [];

  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, external_order_number, comercio, customer_name, tracking_number, status, estado_wms, raw_meli_data, created_at')
      .eq('external_platform', 'MercadoLibre')
      .eq('status', 'despachado')
      .range(from, from + batchSize - 1);

    if (error || !data || data.length === 0) break;
    allMeli.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const toFix = [];
  for (const o of allMeli) {
    const raw = o.raw_meli_data || {};
    const rawShip = raw.shipping || raw.shipment;
    const rawShipStatus = (raw.shipping_status || rawShip?.status || '').toLowerCase().trim();
    if (rawShipStatus === 'ready_to_ship' || rawShipStatus === 'handling' || rawShipStatus === 'pending') {
      if (o.estado_wms !== 'Despachado') {
        toFix.push(o);
      }
    }
  }

  console.log(`Total órdenes a corregir de 'despachado' -> 'en preparación': ${toFix.length}`);

  for (const ord of toFix) {
    console.log(`📦 Corrigiendo ${ord.external_order_number} (${ord.comercio}): Cliente="${ord.customer_name}", WMS="${ord.estado_wms}", MELI="${ord.raw_meli_data?.shipping_status || ord.raw_meli_data?.shipping?.status}"`);
    if (!isDryRun) {
      const { error: upErr } = await supabase
        .from('orders')
        .update({ status: 'en preparación' })
        .eq('id', ord.id);

      if (upErr) {
        console.error(`   ❌ Error al actualizar: ${upErr.message}`);
      } else {
        console.log(`   ✅ Actualizado status a 'en preparación'`);
      }
    }
  }

  console.log('\n🎉 Proceso completado.');
}

main().catch(console.error);
