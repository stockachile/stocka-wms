const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

async function fullDiagnostic() {
  console.log('=== DIAGNÓSTICO COMPLETO: ÓRDENES EN SUCURSAL VIRTUAL (OCT 7 Y 8) ===');

  const { data: pOrders } = await picker
    .from('active_orders')
    .select('*')
    .eq('sucursal', 'Sucursal Virtual (Hub)')
    .gte('created_at', '2026-10-07T00:00:00+00:00');

  // Group by order_number
  const groups = new Map();
  (pOrders || []).forEach(p => {
    if (!groups.has(p.order_number)) groups.set(p.order_number, []);
    groups.get(p.order_number).push(p);
  });

  console.log(`Total pedidos únicos en Sucursal Virtual: ${groups.size}`);

  const report = [];

  for (const [orderNo, pItems] of groups.entries()) {
    // Buscar en WMS con o sin prefijo
    const cleanNo = orderNo.replace(/\D/g, '');
    const { data: wOrders } = await wms
      .from('orders')
      .select('id, external_order_number, comercio, estado_wms, status, created_at, tracking_number, sucursal_pickeo, raw_meli_data')
      .ilike('external_order_number', `%${cleanNo}%`);

    const w = (wOrders || [])[0];
    const firstP = pItems[0];

    report.push({
      picker_order: orderNo,
      picker_comercio: firstP.comercio,
      picker_tracking: firstP.tracking,
      picker_items_count: pItems.length,
      picker_status: firstP.sheet_status,
      picker_created_at: firstP.created_at,
      wms_id: w?.id || null,
      wms_order: w?.external_order_number || null,
      wms_comercio: w?.comercio || null,
      wms_estado: w?.estado_wms || 'NO EXISTE',
      wms_status: w?.status || 'NO EXISTE',
      wms_created_at: w?.created_at || null,
      wms_tracking: w?.tracking_number || null,
      wms_sucursal: w?.sucursal_pickeo || null,
      is_collision: w && w.created_at && !w.created_at.startsWith('2026-10'),
      meli_ready: w?.raw_meli_data?.shipping?.status === 'ready_to_ship' || w?.raw_meli_data?.shipping_status === 'ready_to_ship'
    });
  }

  // Separar en categorías
  const collisions = report.filter(r => r.is_collision);
  const inPreparationInWms = report.filter(r => r.wms_estado === 'En preparación');
  const alreadyDispatchedInWms = report.filter(r => r.wms_estado === 'Despachado' || r.wms_estado === 'Pickeado');
  const otherStuck = report.filter(r => !r.is_collision && r.wms_estado !== 'En preparación' && r.wms_estado !== 'Despachado' && r.wms_estado !== 'Pickeado');

  console.log(`\n1. COLISIONES CRÍTICAS (Registros antiguos en WMS que bloquearon el pedido nuevo): ${collisions.length}`);
  collisions.forEach(c => {
    console.log(`  🚨 Pedido: ${c.picker_order} (${c.picker_comercio}) | WMS: ${c.wms_order} | WMS Fecha: ${c.wms_created_at} | WMS Estado: ${c.wms_estado} (${c.wms_status}) | Real Tracking: ${c.picker_tracking}`);
  });

  console.log(`\n2. PEDIDOS YA EN PREPARACIÓN EN WMS pero en Sucursal Virtual en Picker: ${inPreparationInWms.length}`);
  inPreparationInWms.forEach(c => {
    console.log(`  ⚠️ Pedido: ${c.picker_order} | WMS: ${c.wms_order} (${c.wms_comercio}) | Sucursal WMS: ${c.wms_sucursal}`);
  });

  console.log(`\n3. PEDIDOS YA DESPACHADOS/PICKEADOS EN WMS que quedaron residuales en Sucursal Virtual en Picker: ${alreadyDispatchedInWms.length}`);
  alreadyDispatchedInWms.forEach(c => {
    console.log(`  ℹ️ Pedido: ${c.picker_order} | WMS: ${c.wms_order} (${c.wms_comercio}) | WMS: ${c.wms_estado}`);
  });

  console.log(`\n4. OTROS: ${otherStuck.length}`);
  otherStuck.forEach(c => {
    console.log(`  ❓ Pedido: ${c.picker_order} | WMS: ${c.wms_order} (${c.wms_comercio}) | WMS Estado: ${c.wms_estado}`);
  });
}

fullDiagnostic().finally(() => process.exit(0));
