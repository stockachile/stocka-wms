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

const felipeComercios = [
  'BE NATIVE', 'DORMILONES', 'HIT GAMING', 'JOYAS GLOSS', 
  'RCT CHILE', 'RELAJARTE', 'SIMPLEMENTE CAFE', 'SMILE FOR PETS', 
  'BACK IN TIME', 'LAQU & COMPANY', 'STOCKA STORE TEST', 'MAGIC MAKEUP'
];

async function run() {
  console.log("=== Simulating WMS Client filters in July 2026 ===");
  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (quantity, products(sku, name))
    `)
    .in('comercio', felipeComercios)
    .gte('created_at', '2026-07-01T00:00:00+00:00')
    .lte('created_at', '2026-07-19T23:59:59+00:00')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  const selectedOrigen = 'Shopify';
  const selectedStatus = '';
  const selectedExportStatus = '';
  const dateFrom = '2026-07-01';
  const dateTo = '2026-07-19';
  const searchText = '';

  const filtered = orders.filter(order => {
    const platform = order.origen || order.external_platform || 'Manual';
    const skuStr = (order.sku || order.order_items?.map(oi => oi.products?.sku).filter(Boolean).join(', ') || '').toLowerCase();
    const nameStr = (order.item || order.order_items?.map(oi => oi.products?.name).filter(Boolean).join(', ') || '').toLowerCase();
    const customer = (order.customer_name || '').toLowerCase();
    const extNo = (order.external_order_number || '').toLowerCase();
    const tracking = (order.tracking_number || '').toLowerCase();
    const orderIdLower = order.id.toLowerCase();

    const matchesSearch = !searchText || 
      orderIdLower.includes(searchText) || 
      extNo.includes(searchText) || 
      skuStr.includes(searchText) || 
      nameStr.includes(searchText) || 
      customer.includes(searchText) ||
      tracking.includes(searchText);

    const matchesOrigen = !selectedOrigen || platform.toLowerCase() === selectedOrigen.toLowerCase();
    const matchesStatus = !selectedStatus || order.status === selectedStatus;
    
    let matchesExport = true;

    let matchesDate = true;
    if (order.created_at) {
      const d = new Date(order.created_at);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const orderDateStr = `${year}-${month}-${day}`;
      
      if (dateFrom && orderDateStr < dateFrom) matchesDate = false;
      if (dateTo && orderDateStr > dateTo) matchesDate = false;
    }

    return matchesSearch && matchesOrigen && matchesStatus && matchesExport && matchesDate;
  });

  console.log(`Filtered count: ${filtered.length}`);
  console.log("Filtered orders (first 30):");
  filtered.forEach((o, i) => {
    console.log(`${i+1}. ID: ${o.external_order_number || o.id.split('-')[0]}, Commerce: ${o.comercio}, Origen: ${o.origen}, Platform: ${o.external_platform}, Created: ${o.created_at}`);
  });
}

run();
