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
  console.log("=== Running DOM rendering simulation ===");
  
  // 1. Fetch orders and shipments
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

  const { data: shipments } = await supabase
    .from('envios_unificados')
    .select('*')
    .in('pedido_referencia', orders.map(o => o.external_order_number).filter(Boolean));

  console.log(`Loaded ${orders.length} orders.`);

  // 2. Mock Global and Helper variables/functions
  global.window = {
    clientWmsActiveTab: 'Todos',
    clientWmsPageSize: 25,
    clientWmsCurrentPage: 1,
    formatCLP: (v) => `$${v}`,
    currentPackSkusList: []
  };

  // Mock document
  const mockTbody = {
    innerHTML: ''
  };
  const mockPagination = {
    innerHTML: ''
  };
  const mockKpis = {
    'kpi-client-total': { textContent: '' },
    'kpi-client-processing': { textContent: '' },
    'kpi-client-in-prep': { textContent: '' },
    'kpi-client-sales': { textContent: '' }
  };

  global.document = {
    getElementById: (id) => {
      if (id === 'client-orders-tbody') return mockTbody;
      if (id === 'client-wms-pagination-container') return mockPagination;
      if (mockKpis[id]) return mockKpis[id];
      return null;
    }
  };

  // 3. Filter orders (matching Shopify)
  const selectedOrigen = 'Shopify';
  const selectedStatus = '';
  const selectedExportStatus = '';
  const dateFrom = '2026-07-01';
  const dateTo = '2026-07-19';
  const searchText = '';

  const matchesBaseFilters = (order) => {
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
  };

  const filtered = orders.filter(o => {
    const matchBase = matchesBaseFilters(o);
    const matchTab = window.clientWmsActiveTab === 'Todos' || (o.estado_wms || 'En procesamiento') === window.clientWmsActiveTab;
    return matchBase && matchTab;
  });

  const totalResults = filtered.length;
  const pageSize = 25;
  const totalPages = Math.ceil(totalResults / pageSize);
  const startIndex = 0;
  const endIndex = 25;
  const paginatedOrders = filtered.slice(startIndex, endIndex);

  console.log(`Filtered: ${filtered.length}, Paginated: ${paginatedOrders.length}`);

  // 4. Run loop from js/app.js
  let rowsHtml = '';
  let errorIndex = -1;

  try {
    paginatedOrders.forEach((order, idx) => {
      errorIndex = idx;
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

      let originalPacksHtml = '';
      let packBadgeHtml = '';
      const masterProducts = [];
      let packSkus = new Set(window.currentPackSkusList || []);
      if (packSkus.size === 0) {
        packSkus = new Set(masterProducts.filter(p => p.is_pack).map(p => p.sku.toLowerCase()));
      }
      const foundPacks = [];

      const checkRawItems = (items, platform = '') => {
        if (!Array.isArray(items)) return;
        items.forEach(item => {
          let sku = '';
          let qty = 1;
          if (platform === 'meli') {
            sku = item.item?.seller_sku || item.item?.seller_custom_field || '';
            if (!sku && item.item?.variation_attributes) {
              const vSkuAttr = item.item.variation_attributes.find(a => a.id === 'SELLER_SKU');
              if (vSkuAttr) sku = vSkuAttr.value_name || '';
            }
            qty = item.quantity || 1;
          } else {
            sku = item.sku || item.variant_sku || item.seller_sku || item.platform_sku || '';
            qty = item.quantity || item.qty || 1;
          }
          sku = (sku || '').trim().toLowerCase();
          if (sku && packSkus.has(sku)) {
            foundPacks.push(`<strong>${sku.toUpperCase()}</strong> (x${qty})`);
          }
        });
      };

      if (order.raw_shopify_data && order.raw_shopify_data.line_items) {
        checkRawItems(order.raw_shopify_data.line_items, 'shopify');
      } else if (order.raw_woocommerce_data && order.raw_woocommerce_data.line_items) {
        checkRawItems(order.raw_woocommerce_data.line_items, 'woocommerce');
      }

      if (foundPacks.length > 0) {
        originalPacksHtml = `<div>${foundPacks.join(', ')}</div>`;
        packBadgeHtml = `<span>Con Packs</span>`;
      }

      const dateSource = (orderShipments.length > 0 && orderShipments[0].created_at) 
        ? orderShipments[0].created_at 
        : order.created_at;

      const dateObj = new Date(dateSource);
      const dateStr = dateObj.toLocaleDateString();
      
      let badgeColor = 'var(--color-gray)';
      let badgeTextColor = '#1a1a1a';
      if (order.status === 'despachado' || order.status === 'entregado' || order.status === 'retirado') {
        badgeColor = '#d1fae5';
        badgeTextColor = '#065f46';
      } else if (order.status === 'en preparación' || order.status === 'preparado' || order.status === 'listo para retiro') {
        badgeColor = '#fef3c7';
        badgeTextColor = '#92400e';
      } else if (order.status === 'cancelado' || order.status === 'incidencia') {
        badgeColor = '#fee2e2';
        badgeTextColor = '#991b1b';
      } else if (order.status === 'para procesar') {
        badgeColor = '#e0e7ff';
        badgeTextColor = '#3730a3';
      }

      const wmsStatus = order.estado_wms || 'En procesamiento';
      let wmsBadgeBg = '#e0f2fe';
      let wmsBadgeColor = '#0369a1';
      if (wmsStatus === 'Incidencia') {
        wmsBadgeBg = '#fee2e2';
        wmsBadgeColor = '#991b1b';
      } else if (wmsStatus === 'Pickeado' || wmsStatus === 'Despachado') {
        wmsBadgeBg = '#d1fae5';
        wmsBadgeColor = '#065f46';
      } else if (wmsStatus === 'En preparación') {
        wmsBadgeBg = '#fef3c7';
        wmsBadgeColor = '#92400e';
      }

      const platform = order.origen || order.external_platform || 'Manual';
      const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : '#6b7280');
      const platformLower = platform.toLowerCase();
      const originHtml = `<span>${platform}</span>`;

      const skuStr = order.sku || order.order_items?.map(oi => oi.products?.sku).filter(Boolean).join(', ') || 'Sin SKU';
      const nameStr = order.item || order.order_items?.map(oi => oi.products?.name).filter(Boolean).join(', ') || 'Sin Nombre';
      const totalItems = order.order_items?.reduce((s, i) => s + (i.quantity || 1), 0) || order.cantidad || '-';

      let trackingHtml = `-`;
      let labelHtml = `-`;
      
      if (order.label_base64) {
        labelHtml = `Download`;
      }

      if (orderShipments.length > 0) {
        const shipment = orderShipments[0];
        if (shipment.tracking) {
          const courierName = shipment.courier || 'Seguimiento';
          trackingHtml = `${courierName}: ${shipment.tracking}`;
        }
      }

      let shipmentStatusHtml = '';
      if (orderShipments.length > 0) {
        const shipment = orderShipments[0];
        const globStatus = shipment.global_status || 'SIN MOVIMIENTO';
        shipmentStatusHtml = `${globStatus}`;
      }

      const firstShipment = orderShipments[0] || null;
      const rawTipo = firstShipment?.servicio_tipo_envio || order.shipping_type || '';
      const tipoHtml = `<span>${rawTipo}</span>`;

      const createdAt = new Date(order.created_at);
      const slaRef = firstShipment?.promised_date || firstShipment?.date_closed || null;
      let slaHtml = `-`;
      if (slaRef) {
        const slaDate = new Date(slaRef);
        const diffDays = Math.round((slaDate - createdAt) / (1000 * 60 * 60 * 24));
        slaHtml = `<span>${diffDays}d</span>`;
      }

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
          itemsRowsHtml += `<tr><td>${item.sku}</td></tr>`;
        });
      } else {
        const pQty = Number(order.cantidad) || 1;
        const pPrice = pQty > 0 ? (Number(order.total_value) / pQty) : 0;
        itemsRowsHtml += `<tr><td>${order.sku}</td></tr>`;
      }

      let rawData = null;
      if (order.raw_woocommerce_data) rawData = order.raw_woocommerce_data;
      else if (order.raw_shopify_data) rawData = order.raw_shopify_data;

      const exportBadgeHtml = order.shopify_exported ? `Exportado` : '';
      let shipmentBadgeHtml = '';

      rowsHtml += `
        <tr id="row-${order.id}">
          <td>${order.external_order_number || order.id}</td>
        </tr>
      `;
    });
    
    console.log("Rendering completed successfully without any errors!");
  } catch (err) {
    console.error(`Error at paginated index ${errorIndex} (Order: ${paginatedOrders[errorIndex].external_order_number}):`, err);
  }
}

run();
