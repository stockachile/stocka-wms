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

async function run() {
  console.log("=== Simulating WMS Admin filters in July 2026 ===");
  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (quantity, products(sku, name, price, image_url, options))
    `)
    .gte('created_at', '2026-07-01T00:00:00+00:00')
    .lte('created_at', '2026-07-19T23:59:59+00:00')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Loaded ${orders.length} orders in Admin.`);

  // Unique comercios loaded
  const uniqueComercios = [...new Set(orders.map(o => o.comercio).filter(Boolean))].sort();
  console.log("Unique comercios loaded in Admin:", uniqueComercios);

  // Let's filter by the default filters (no search text, no merchant selected, no origin selected)
  const searchText = '';
  const selectedMerchant = '';
  const selectedOrigen = '';
  const selectedStatus = '';
  const selectedExportStatus = '';
  const dateFrom = '2026-07-01';
  const dateTo = '2026-07-19';

  const matchesBaseFilters = (order) => {
    const platform = order.origen || order.external_platform || 'Manual';
    const skuStr = (order.sku || order.order_items?.map(oi => oi.products?.sku).filter(Boolean).join(', ') || '').toLowerCase();
    const nameStr = (order.item || order.order_items?.map(oi => oi.products?.name).filter(Boolean).join(', ') || '').toLowerCase();
    const company = (order.comercio || '').toLowerCase();
    const customer = (order.customer_name || '').toLowerCase();
    const extNo = (order.external_order_number || '').toLowerCase();
    const tracking = (order.tracking_number || '').toLowerCase();
    const orderIdLower = order.id.toLowerCase();

    const matchesSearch = !searchText || 
      orderIdLower.includes(searchText) || 
      extNo.includes(searchText) || 
      skuStr.includes(searchText) || 
      nameStr.includes(searchText) || 
      company.includes(searchText) || 
      customer.includes(searchText) ||
      tracking.includes(searchText);

    const matchesMerchant = !selectedMerchant || order.comercio === selectedMerchant;
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

    return matchesSearch && matchesMerchant && matchesOrigen && matchesStatus && matchesExport && matchesDate;
  };

  const filtered = orders.filter(matchesBaseFilters);
  console.log(`Filtered in Admin: ${filtered.length}`);

  const countsByCommerce = {};
  filtered.forEach(o => {
    countsByCommerce[o.comercio] = (countsByCommerce[o.comercio] || 0) + 1;
  });
  console.log("Counts in Admin by commerce:", countsByCommerce);
}

run();
