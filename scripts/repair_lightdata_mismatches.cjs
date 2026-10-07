const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      env[match[1]] = value.trim();
    }
  });
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';
const pickerClient = createClient(PICKER_URL, PICKER_KEY);

async function repair(dryRun = true) {
  console.log(`=== AUDITORÍA Y REPARACIÓN DE SEGUIMIENTOS CRUZADOS (LIGHTDATA/ALPHA) ===`);
  console.log(`Modo: ${dryRun ? 'DRY-RUN (Simulación sin cambios)' : 'APLICAR CAMBIOS EN BASE DE DATOS'}\n`);

  let allOrders = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, external_order_number, tracking_number, tracking_url, courier, operador, customer_name, customer_email, customer_phone, status, estado_wms, raw_lightdata_data, lightdata_status, created_at, comercio')
      .not('raw_lightdata_data', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('Error fetching orders:', error);
      break;
    }
    allOrders.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  const mismatchedOrders = [];

  for (const o of allOrders) {
    const ld = o.raw_lightdata_data;
    if (!ld) continue;

    const ext = String(o.external_order_number || '').trim().replace(/^#/, '').toUpperCase();
    const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '');

    // Reference in LightData
    const rawRef = String(ld.raw_data?.[1] || ld.tracking || '').trim().replace(/^#/, '').toUpperCase();
    const cleanRawRef = rawRef.replace(/[^a-zA-Z0-9]/g, '');

    if (!cleanRawRef) continue;

    // Is pure DID (numeric like 796079)
    const isPureDid = /^\d{5,8}$/.test(cleanRawRef);

    // If cleanRawRef differs from cleanExt and is not a pure DID
    if (!isPureDid && cleanExt && cleanRawRef && cleanExt !== cleanRawRef) {
      const isSub = cleanExt.endsWith(cleanRawRef) || cleanRawRef.endsWith(cleanExt);
      if (isSub) continue;

      // Extract numeric components
      const extDigits = cleanExt.replace(/^[^0-9]+/, '');
      const refDigits = cleanRawRef.replace(/^[^0-9]+/, '');
      if (extDigits && refDigits && extDigits === refDigits && extDigits.length >= 3) {
        continue; // Same order number with different prefix (e.g. LVR#JS-1274 vs LVR-1274)
      }

      // Exclude ML pack vs shipping id
      const isMlShipment = ext.startsWith('MSE') && /^\d{10,12}$/.test(cleanRawRef);
      if (isMlShipment) continue;

      mismatchedOrders.push({
        order: o,
        intendedOrder: rawRef,
        assignedDid: ld.id || ld.did,
        ldStatus: ld.status
      });
    }
  }

  console.log(`Pedidos detectados con seguimiento cruzado / erróneo: ${mismatchedOrders.length}\n`);

  for (const item of mismatchedOrders) {
    const o = item.order;
    console.log(`[${o.comercio}] Pedido: ${o.external_order_number} (ID: ${o.id})`);
    console.log(`  Cliente: ${o.customer_name} (${o.customer_email || o.customer_phone})`);
    console.log(`  Estado WMS actual: ${o.estado_wms} | Estado Origen: ${o.status}`);
    console.log(`  Tracking erróneo asignado: ${o.tracking_number} (DID: ${item.assignedDid}, Estado LD: ${item.ldStatus})`);
    console.log(`  El tracking correspondía en realidad al pedido: ${item.intendedOrder}`);

    if (!dryRun) {
      // 1. Limpiar datos erróneos en WMS orders
      const updatePayload = {
        tracking_number: null,
        tracking_url: null,
        raw_lightdata_data: null,
        lightdata_status: null,
        courier: null
      };

      const { error: updErr } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', o.id);

      if (updErr) {
        console.error(`  ❌ Error al actualizar en Supabase orders:`, updErr.message);
      } else {
        console.log(`  ✅ Corregido en Supabase orders: tracking y raw_lightdata_data reseteados.`);
      }

      // 2. Limpiar tracking erróneo en el Picker active_orders si existe
      const cleanExt = String(o.external_order_number || '').trim();
      if (cleanExt) {
        const searchNumbers = [cleanExt, '#' + cleanExt.replace(/^#/, ''), cleanExt.replace(/^#/, '')];
        const { error: pickErr } = await pickerClient
          .from('active_orders')
          .update({ tracking: null })
          .in('order_number', searchNumbers);

        if (pickErr) {
          console.warn(`  ⚠️ Error al actualizar Picker active_orders:`, pickErr.message);
        } else {
          console.log(`  ✅ Corregido en Picker active_orders: tracking removido de las cestas.`);
        }
      }
    }
    console.log('--------------------------------------------------');
  }

  if (dryRun) {
    console.log(`\n💡 Para aplicar estos cambios en la base de datos, ejecuta el script con: node scripts/repair_lightdata_mismatches.cjs --apply`);
  } else {
    console.log(`\n🎉 Reparación completada para los ${mismatchedOrders.length} pedidos afectados.`);
  }
}

const applyFlag = process.argv.includes('--apply');
repair(!applyFlag);
