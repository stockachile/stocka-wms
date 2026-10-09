const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'c:/Users/felip/Desktop/WMS STOCKA/.env';
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

const WMS_URL = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

const wmsClient = createClient(WMS_URL, WMS_KEY);
const pickerClient = createClient(PICKER_URL, PICKER_KEY);

async function main() {
  console.log('=== 1. Buscar en WMS por tracking 48199518584 ===');
  const { data: byTrack, error: errTrack } = await wmsClient
    .from('orders')
    .select('id, external_order_number, comercio, external_platform, estado_wms, tracking_number, created_at, updated_at, sucursal_pickeo')
    .eq('tracking_number', '48199518584');
  console.log('Por tracking en WMS:', byTrack, errTrack);

  console.log('=== 2. Ver detalles del pedido encontrado 0233a496-214e-4cd1-8d7f-05358e510b8d en WMS ===');
  const { data: fullOrder, error: errFull } = await wmsClient
    .from('orders')
    .select('*')
    .eq('id', '0233a496-214e-4cd1-8d7f-05358e510b8d');
  if (fullOrder && fullOrder[0]) {
    const o = fullOrder[0];
    console.log({
      id: o.id,
      external_order_number: o.external_order_number,
      comercio: o.comercio,
      external_platform: o.external_platform,
      estado_wms: o.estado_wms,
      status: o.status,
      created_at: o.created_at,
      updated_at: o.updated_at,
      sucursal_pickeo: o.sucursal_pickeo,
      tracking_number: o.tracking_number,
      shipping_status: o.shipping_status,
      fecha_procesamiento: o.fecha_procesamiento,
      raw_meli_shipping_id: o.raw_meli_data?.shipping?.id || o.raw_meli_data?.shipping_id,
      raw_meli_date_created: o.raw_meli_data?.date_created || o.raw_meli_data?.orders?.[0]?.date_created
    });
  }

  console.log('=== 3. Buscar todas las órdenes de HIT GAMING creadas o actualizadas recientemente en WMS ===');
  const { data: recentHit } = await wmsClient
    .from('orders')
    .select('id, external_order_number, comercio, external_platform, estado_wms, tracking_number, created_at, updated_at')
    .eq('comercio', 'HIT GAMING')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('HIT GAMING recientes:', recentHit);

  console.log('=== 4. En Picker active_orders, ¿cuántas órdenes hay y de qué sucursales? ===');
  const { data: pickerOrders, error: pErr } = await pickerClient
    .from('active_orders')
    .select('id, order_number, sucursal, comercio, sheet_status, fecha, created_at')
    .order('id', { ascending: false })
    .limit(20);
  console.log('Últimas 20 órdenes en Picker active_orders:', pickerOrders);

  console.log('=== 5. ¿Qué sucursales distintas hay en Picker active_orders? ===');
  const { data: pickerSucursales } = await pickerClient
    .from('active_orders')
    .select('sucursal');
  const sucs = Array.from(new Set((pickerSucursales || []).map(s => s.sucursal)));
  console.log('Sucursales en Picker active_orders:', sucs);
}

main().catch(console.error);
