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
  console.log("=== Running Admin Loop simulation ===");
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

  const { data: shipments } = await supabase
    .from('envios_unificados')
    .select('*')
    .in('pedido_referencia', orders.map(o => o.external_order_number).filter(Boolean));

  console.log(`Loaded ${orders.length} orders and ${shipments ? shipments.length : 0} shipments.`);

  // Global and helper variables/functions
  global.window = {
    wmsActiveTab: 'Todos',
    wmsPageSize: 25,
    wmsCurrentPage: 1,
    formatCLP: (v) => `$${v}`,
    currentPackSkusList: [],
    wmsColumnFilters: {},
    pickerOperatorsMap: {}
  };

  const mockTbody = { innerHTML: '' };
  const mockPagination = { innerHTML: '' };
  const mockKpis = {
    'kpi-total-orders': { textContent: '' },
    'kpi-orders-to-process': { textContent: '' },
    'kpi-orders-in-prep': { textContent: '' },
    'kpi-total-sales': { textContent: '' }
  };

  global.document = {
    getElementById: (id) => {
      if (id === 'wms-orders-tbody') return mockTbody;
      if (id === 'wms-pagination-container') return mockPagination;
      if (mockKpis[id]) return mockKpis[id];
      return null;
    }
  };

  // Run the loop logic of js/admin.js applyWmsFiltersAndRender
  const filtered = orders;
  const paginatedOrders = filtered.slice(0, 25);

  let rowsHtml = '';
  let errorIdx = -1;
  try {
    paginatedOrders.forEach((order, idx) => {
      errorIdx = idx;
      let orderShipments = (shipments || []).filter(s => 
        s.pedido_referencia === order.id || 
        (order.external_order_number && s.pedido_referencia === order.external_order_number) ||
        (order.tracking_number && s.pedido_referencia === order.tracking_number)
      );

      const isVirtualPlatform = order.origen === 'MercadoLibre' || 
                                order.external_platform === 'MercadoLibre' || 
                                order.origen === 'Falabella' || 
                                order.external_platform === 'Falabella' ||
                                order.origen === 'Paris' || 
                                order.external_platform === 'Paris';

      if (orderShipments.length === 0 && isVirtualPlatform) {
        let globStatus = 'SIN MOVIMIENTO';
        const wmsStatus = (order.status || '').toLowerCase().trim();
        const channelStatus = (order.payment_status || '').toLowerCase().trim();
        
        const isShipped = wmsStatus === 'despachado' || 
                          wmsStatus === 'entregado' || 
                          wmsStatus === 'retirado' ||
                          channelStatus === 'shipped' || 
                          channelStatus === 'delivered' || 
                          channelStatus === 'shipped_by_seller' || 
                          channelStatus === 'received' || 
                          channelStatus === 'closed';
                          
        const isAlert = wmsStatus === 'cancelado' || 
                        wmsStatus === 'incidencia' || 
                        channelStatus === 'cancelled' || 
                        channelStatus === 'refunded' || 
                        channelStatus === 'refused';
        
        if (isShipped) {
          globStatus = 'DESPACHADO';
        } else if (isAlert) {
          globStatus = 'ALERTA';
        }
        
        const isParis = order.origen === 'Paris' || order.external_platform === 'Paris';
        const isFalabella = order.origen === 'Falabella' || order.external_platform === 'Falabella';
        const defaultCourier = isFalabella ? 'Falabella' : (isParis ? 'Paris' : 'MercadoLibre');
        const sourceTable = isFalabella ? 'falabella' : (isParis ? 'paris' : 'mercadolibre');
        
        orderShipments = [{
          id: `virtual:${order.id}`,
          source_table: sourceTable,
          source_id: order.id,
          tracking: order.tracking_number || 'N/A',
          tracking_url: order.tracking_url || 'N/A',
          courier: order.courier || defaultCourier,
          status: order.status,
          global_status: globStatus,
          created_at: order.created_at,
          updated_at: order.created_at
        }];
      }

      // Check dates
      const dateSource = (orderShipments.length > 0 && orderShipments[0].created_at) 
        ? orderShipments[0].created_at 
        : order.created_at;

      const dateObj = new Date(dateSource);
      const dateStr = dateObj.toLocaleDateString();

      // items rows loop simulation
      let itemsRowsHtml = '';
      if (order.order_items && order.order_items.length > 0) {
        const grouped = {};
        order.order_items.forEach(oi => {
          const pSku = oi.products?.sku || oi.sku || 'Sin SKU';
          const pName = oi.products?.name || oi.item_name || 'Sin Nombre';
          const pQty = Number(oi.quantity) || 1;
          if (!grouped[pSku]) {
            grouped[pSku] = { sku: pSku, name: pName, quantity: 0 };
          }
          grouped[pSku].quantity += pQty;
        });
        Object.values(grouped).forEach(item => {
          const pPrice = item.quantity > 0 ? (Number(order.total_value) / item.quantity) : 0;
          const subtotal = item.quantity * pPrice;
        });
      } else {
        const pQty = Number(order.cantidad) || 1;
        const pPrice = pQty > 0 ? (Number(order.total_value) / pQty) : 0;
      }
    });

    console.log("Admin loop simulation finished successfully without errors!");
  } catch (err) {
    console.error(`Error at index ${errorIdx} (Order: ${paginatedOrders[errorIdx].external_order_number}):`, err);
  }
}

run();
