const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const picker = createClient('https://hpomymtecmxujbjxqawu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ');

async function audit() {
  console.log('====================================================');
  console.log('1. Órdenes en Picker active_orders con Sucursal Virtual (Hub)');
  console.log('====================================================');
  const { data: virtualInPicker } = await picker
    .from('active_orders')
    .select('id, order_number, sucursal, comercio, agenda, tracking, operator, sheet_status, created_at')
    .eq('sucursal', 'Sucursal Virtual (Hub)')
    .order('created_at', { ascending: false });

  console.log(`Total en Sucursal Virtual (Hub): ${virtualInPicker?.length || 0}`);
  if (virtualInPicker && virtualInPicker.length > 0) {
    // Agrupar por order_number
    const uniqueOrders = new Map();
    virtualInPicker.forEach(o => {
      if (!uniqueOrders.has(o.order_number)) uniqueOrders.set(o.order_number, o);
    });
    console.log(`Pedidos únicos en Sucursal Virtual: ${uniqueOrders.size}`);
    console.log('Muestra (últimos 15 pedidos únicos):');
    Array.from(uniqueOrders.values()).slice(0, 15).forEach(o => {
      console.log(`  - N°: ${o.order_number} | Comercio: ${o.comercio} | Status: ${o.sheet_status} | Creado: ${o.created_at} | Tracking: ${o.tracking}`);
    });
  }

  console.log('\n====================================================');
  console.log('2. Órdenes WMS "En preparación" que NO están en Picker active_orders');
  console.log('====================================================');
  const { data: wmsPrep } = await wms
    .from('orders')
    .select('id, external_order_number, comercio, estado_wms, tracking_number, operador, courier, created_at, sucursal_pickeo')
    .eq('estado_wms', 'En preparación');

  const { data: pickerAll } = await picker
    .from('active_orders')
    .select('order_number, sucursal, sheet_status');
  
  const pickerOrderNums = new Set((pickerAll || []).map(p => String(p.order_number).replace(/^#/, '').trim().toUpperCase()));

  const missingInPicker = (wmsPrep || []).filter(o => {
    const rawNo = String(o.external_order_number || o.id).replace(/^#/, '').trim().toUpperCase();
    return !pickerOrderNums.has(rawNo);
  });

  console.log(`Total "En preparación" en WMS: ${wmsPrep?.length || 0}`);
  console.log(`Faltantes en Picker active_orders: ${missingInPicker.length}`);
  missingInPicker.slice(0, 15).forEach(o => {
    console.log(`  - N°: ${o.external_order_number} | Comercio: ${o.comercio} | Courier: ${o.courier} | Operador: ${o.operador} | Track: ${o.tracking_number || 'VACÍO'} | Sucursal: ${o.sucursal_pickeo}`);
  });

  console.log('\n====================================================');
  console.log('3. Órdenes MercadoLibre recientes (Octubre) que quedaron en "En procesamiento" o "despachado" en WMS');
  console.log('====================================================');
  // Buscar pedidos de MercadoLibre creados recientemente en Meli pero con estado no preparado en WMS
  const { data: meliOrders } = await wms
    .from('orders')
    .select('id, external_order_number, comercio, estado_wms, status, created_at, tracking_number, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .neq('estado_wms', 'En preparación')
    .neq('estado_wms', 'Pickeado')
    .neq('estado_wms', 'Cancelado')
    .order('created_at', { ascending: false })
    .limit(50);

  const stuckMeli = (meliOrders || []).filter(o => {
    const meliDate = o.raw_meli_data?.shipping?.date_created || o.raw_meli_data?.date_created || o.raw_meli_data?.orders?.[0]?.date_created;
    if (meliDate && meliDate.startsWith('2026-10')) {
      return true;
    }
    return false;
  });

  console.log(`Total órdenes MELI recientes en WMS no preparadas/no pickeadas: ${stuckMeli.length}`);
  stuckMeli.forEach(o => {
    console.log(`  - N°: ${o.external_order_number} | Comercio: ${o.comercio} | WMS: ${o.estado_wms} | Status: ${o.status} | Creado: ${o.created_at} | Track: ${o.tracking_number} | MeliDate: ${o.raw_meli_data?.shipping?.date_created || o.raw_meli_data?.orders?.[0]?.date_created}`);
  });

  console.log('\n====================================================');
  console.log('4. ¿Hay órdenes en Picker de HIT GAMING u otros que no coinciden en WMS?');
  console.log('====================================================');
  const { data: hitInPicker } = await picker
    .from('active_orders')
    .select('order_number, sucursal, sheet_status, tracking, created_at')
    .eq('comercio', 'HIT GAMING');
  console.log('HIT GAMING en active_orders:', hitInPicker);
}

audit().finally(() => process.exit(0));
