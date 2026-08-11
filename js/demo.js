// js/demo.js - WMS STOCKA Demo Mode Helper and Mock Data Store

// 1. Verificar si el modo demo está activo
window.isDemoMode = function() {
  return sessionStorage.getItem('wms_demo_mode') === 'true';
};

// 2. Mock Data Initialization
const DEMO_USER_ID = 'demo-user-uuid-12345';
const DEMO_COMMERCE = 'Empresa Demo S.A.';

const INITIAL_MOCK_DATA = {
  profiles: [
    {
      id: DEMO_USER_ID,
      role: 'client',
      company_name: DEMO_COMMERCE,
      full_name: 'Cliente Invitado Demo',
      email: 'demo@stocka.cl',
      comercio: DEMO_COMMERCE,
      allowed_modules: 'inventory, catalog, volumen_diario, declarations, orders, shipments, movements, warehouses, pending, returns, pickups, sales, cotizador, billing, integrations, incidencias, documentation',
      is_demo_user: false,
      lead_status: null,
      lead_notes: '',
      lead_emails_sent: [],
      created_at: new Date('2026-08-01T00:00:00Z').toISOString()
    },
    {
      id: 'lead-1',
      role: 'observer',
      company_name: 'Tienda Deportiva SpA',
      full_name: 'Rodrigo Cárcamo',
      email: 'rodrigo.carcamo@gmail.com',
      comercio: 'no asignado',
      is_demo_user: true,
      lead_status: 'nuevo',
      lead_notes: 'Interesado en fulfillment para calzado deportivo en Santiago.',
      lead_emails_sent: [],
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'lead-2',
      role: 'observer',
      company_name: 'Electrónica Express',
      full_name: 'Valentina Silva',
      email: 'valentina.silva@outlook.com',
      comercio: 'no asignado',
      is_demo_user: true,
      lead_status: 'contactado',
      lead_notes: 'Busca bodega en RM con despacho rápido de accesorios.',
      lead_emails_sent: [
        { template: 'Bienvenida a la Demo', sent_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), subject: '¡Bienvenido a la Demo de WMS Stocka!' }
      ],
      created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    }
  ],
  warehouses: [
    { id: 'wh-central', name: 'Bodega Central', location: 'Santiago, RM', created_at: '2026-08-01T00:00:00Z' },
    { id: 'wh-norte', name: 'Bodega Norte', location: 'Antofagasta', created_at: '2026-08-01T00:00:00Z' }
  ],
  merchants_warehouses: [
    { id: 'mw-1', merchant_id: DEMO_USER_ID, warehouse_id: 'wh-central' },
    { id: 'mw-2', merchant_id: DEMO_USER_ID, warehouse_id: 'wh-norte' }
  ],
  products: [
    {
      id: 'p-1',
      merchant_id: DEMO_USER_ID,
      sku: 'IPHONE-14-PRO',
      name: 'iPhone 14 Pro Max 256GB Space Black',
      description: 'Dispositivo inteligente Apple en excelente estado',
      price: 1200000,
      volumen: 0.0005,
      weight: 0.24,
      stock_critico: 15,
      is_virtual: false,
      comercio: DEMO_COMMERCE,
      created_at: new Date('2026-08-01T10:00:00Z').toISOString()
    },
    {
      id: 'p-2',
      merchant_id: DEMO_USER_ID,
      sku: 'AUD-WIRELESS-X',
      name: 'Audífonos Bluetooth Over-Ear ANC',
      description: 'Audífonos inalámbricos con cancelación activa de ruido',
      price: 180000,
      volumen: 0.002,
      weight: 0.35,
      stock_critico: 10,
      is_virtual: false,
      comercio: DEMO_COMMERCE,
      created_at: new Date('2026-08-01T10:30:00Z').toISOString()
    },
    {
      id: 'p-3',
      merchant_id: DEMO_USER_ID,
      sku: 'BAG-ERG-IMP',
      name: 'Mochila Técnica Impermeable Pro 15.6"',
      description: 'Mochila ergonómica repelente al agua para laptops',
      price: 45000,
      volumen: 0.015,
      weight: 0.8,
      stock_critico: 20,
      is_virtual: false,
      comercio: DEMO_COMMERCE,
      created_at: new Date('2026-08-02T11:00:00Z').toISOString()
    },
    {
      id: 'p-4',
      merchant_id: DEMO_USER_ID,
      sku: 'THERM-SS-1L',
      name: 'Termo de Acero Inoxidable Premium 1L',
      description: 'Termo de doble capa de acero con aislamiento al vacío',
      price: 32000,
      volumen: 0.003,
      weight: 0.5,
      stock_critico: 8,
      is_virtual: false,
      comercio: DEMO_COMMERCE,
      created_at: new Date('2026-08-03T09:00:00Z').toISOString()
    }
  ],
  inventory: [
    { id: 'i-1', product_id: 'p-1', warehouse_id: 'wh-central', quantity: 45, committed_quantity: 5, updated_at: new Date().toISOString() },
    { id: 'i-2', product_id: 'p-1', warehouse_id: 'wh-norte', quantity: 12, committed_quantity: 0, updated_at: new Date().toISOString() },
    { id: 'i-3', product_id: 'p-2', warehouse_id: 'wh-central', quantity: 18, committed_quantity: 2, updated_at: new Date().toISOString() },
    { id: 'i-4', product_id: 'p-2', warehouse_id: 'wh-norte', quantity: 5, committed_quantity: 1, updated_at: new Date().toISOString() },
    { id: 'i-5', product_id: 'p-3', warehouse_id: 'wh-central', quantity: 9, committed_quantity: 3, updated_at: new Date().toISOString() }, // Alerta stock crítico
    { id: 'i-6', product_id: 'p-4', warehouse_id: 'wh-central', quantity: 60, committed_quantity: 8, updated_at: new Date().toISOString() }
  ],
  movements: [
    { id: 'm-1', product_id: 'p-1', warehouse_id: 'wh-central', type: 'in', quantity: 60, reference_doc: 'OC-4512 Ingreso Importación', date: new Date('2026-08-01T10:10:00Z').toISOString() },
    { id: 'm-2', product_id: 'p-1', warehouse_id: 'wh-central', type: 'out', quantity: 10, reference_doc: 'Pedido #1001 Despachado', date: new Date('2026-08-06T11:00:00Z').toISOString() },
    { id: 'm-3', product_id: 'p-2', warehouse_id: 'wh-central', type: 'in', quantity: 30, reference_doc: 'OC-4513 Recepción Fábrica', date: new Date('2026-08-01T11:00:00Z').toISOString() },
    { id: 'm-4', product_id: 'p-3', warehouse_id: 'wh-central', type: 'in', quantity: 12, reference_doc: 'OC-4514 Recepción Proveedor', date: new Date('2026-08-02T12:00:00Z').toISOString() }
  ],
  orders: [
    { 
      id: 'o-1001', 
      comercio: DEMO_COMMERCE, 
      status: 'shipped', 
      customer_name: 'María González', 
      customer_email: 'maria.gonzalez@gmail.com',
      customer_phone: '+56911223344',
      shipping_address: 'Av. Apoquindo 4800, Of. 101',
      shipping_city: 'Las Condes',
      shipping_method: 'Chilexpress',
      payment_status: 'PAID',
      total_price: 180000, 
      total_value: 180000,
      sucursal_pickeo: 'Bodega Central STK',
      agenda: 'Bloque Mañana (09:00 - 13:00)',
      fecha_procesamiento: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      operador: 'Chilexpress',
      external_order_number: '1001', 
      courier: 'Chilexpress', 
      tracking_number: '9876543210', 
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), 
      items_count: 1, 
      label_base64: 'mock_pdf_base64_data' 
    },
    { 
      id: 'o-1002', 
      comercio: DEMO_COMMERCE, 
      status: 'pending', 
      customer_name: 'Catalina Rivas', 
      customer_email: 'catalina.rivas@yahoo.com',
      customer_phone: '+56998765432',
      shipping_address: 'Av. Providencia 1250',
      shipping_city: 'Providencia',
      shipping_method: 'Starken',
      categoria_entrega: 'RETIRO',
      payment_status: 'PENDING',
      total_price: 6000000, 
      total_value: 6000000,
      sucursal_pickeo: 'Bodega Central STK',
      agenda: 'Bloque Tarde (14:00 - 18:00)',
      fecha_procesamiento: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      operador: 'Starken',
      external_order_number: '1002', 
      courier: 'Starken', 
      tracking_number: 'STK-8877665', 
      created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), 
      items_count: 5, 
      label_base64: 'mock_pdf_base64_data' 
    },
    { 
      id: 'o-1003', 
      comercio: DEMO_COMMERCE, 
      status: 'packing', 
      customer_name: 'Andrés Pérez', 
      customer_email: 'andres.perez@outlook.com',
      customer_phone: '+56955556666',
      shipping_address: 'Alameda 340',
      shipping_city: 'Santiago Centro',
      shipping_method: 'Blue Express',
      payment_status: 'PAID',
      total_price: 135000, 
      total_value: 135000,
      sucursal_pickeo: 'Bodega Central STK',
      agenda: 'Bloque Mañana (09:00 - 13:00)',
      fecha_procesamiento: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      operador: 'Blue Express',
      external_order_number: '1003', 
      courier: 'Blue Express', 
      tracking_number: 'BX-9988221', 
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), 
      items_count: 3, 
      label_base64: 'mock_pdf_base64_data' 
    },
    { 
      id: 'o-1004', 
      comercio: DEMO_COMMERCE, 
      status: 'cancelled', 
      customer_name: 'Ana López', 
      customer_email: 'ana.lopez@gmail.com',
      customer_phone: '+56988776655',
      shipping_address: 'O\'Higgins 450',
      shipping_city: 'Concepción',
      shipping_method: 'Starken',
      payment_status: 'PENDING',
      total_price: 32000, 
      total_value: 32000,
      sucursal_pickeo: 'Bodega Central STK',
      agenda: 'Sin agendar',
      fecha_procesamiento: '-',
      operador: 'Starken',
      external_order_number: '1000', 
      courier: 'Starken', 
      tracking_number: 'STK-CANCELLED', 
      created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(), 
      items_count: 1 
    },
    {
      id: 'o-1005',
      comercio: DEMO_COMMERCE,
      status: 'pending',
      customer_name: 'Camila Torres',
      customer_email: 'camila.torres@gmail.com',
      customer_phone: '+56977778888',
      shipping_address: 'Avenida del Mar 200',
      shipping_city: 'La Serena',
      shipping_method: 'Chilexpress',
      payment_status: 'PAID',
      total_price: 540000,
      total_value: 540000,
      sucursal_pickeo: 'Bodega Central STK',
      agenda: 'Bloque Mañana (09:00 - 13:00)',
      fecha_procesamiento: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      operador: 'Chilexpress',
      external_order_number: '1005',
      courier: 'Chilexpress',
      tracking_number: '9876543219',
      created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      items_count: 3
    },
    {
      id: 'o-1006',
      comercio: DEMO_COMMERCE,
      status: 'pending',
      customer_name: 'Juan Herrera',
      customer_email: 'juan.herrera@gmail.com',
      customer_phone: '+56944445555',
      shipping_address: 'Calle Prat 123',
      shipping_city: 'Valparaíso',
      shipping_method: 'Starken',
      payment_status: 'PENDING',
      total_price: 256000,
      total_value: 256000,
      sucursal_pickeo: 'Bodega Central STK',
      agenda: 'Bloque Tarde (14:00 - 18:00)',
      fecha_procesamiento: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      operador: 'Starken',
      external_order_number: '1006',
      courier: 'Starken',
      tracking_number: 'STK-9900112',
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      items_count: 8
    }
  ],
  order_items: [
    { id: 'oi-1', order_id: 'o-1001', product_id: 'p-2', quantity: 1, warehouse_id: 'wh-central', created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'oi-2', order_id: 'o-1002', product_id: 'p-1', quantity: 5, warehouse_id: 'wh-central', created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'oi-3', order_id: 'o-1003', product_id: 'p-3', quantity: 3, warehouse_id: 'wh-central', created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'oi-4', order_id: 'o-1004', product_id: 'p-4', quantity: 1, warehouse_id: 'wh-central', created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'oi-5', order_id: 'o-1005', product_id: 'p-2', quantity: 3, warehouse_id: 'wh-central', created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'oi-6', order_id: 'o-1006', product_id: 'p-4', quantity: 8, warehouse_id: 'wh-central', created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() }
  ],
  stock_declarations: [
    { id: 'sd-1', title: 'Importación Audífonos Q3', status: 'pending', quantity_declared: 200, volume_declared: 0.4, estimated_arrival_type: 'exact', estimated_arrival_date: '2026-08-20', estimated_arrival_period: 'morning', created_at: new Date('2026-08-05T11:00:00Z').toISOString(), merchant_id: DEMO_USER_ID, comercio: DEMO_COMMERCE },
    { id: 'sd-2', title: 'Reposición iPhones de prueba', status: 'completed', quantity_declared: 50, volume_declared: 0.025, estimated_arrival_type: 'exact', estimated_arrival_date: '2026-08-03', estimated_arrival_period: 'afternoon', created_at: new Date('2026-08-01T09:00:00Z').toISOString(), merchant_id: DEMO_USER_ID, comercio: DEMO_COMMERCE }
  ],
  merchant_integrations: [
    { id: 'mi-shopify', merchant_id: DEMO_USER_ID, platform: 'shopify', shop_url: 'empresa-demo.myshopify.com', is_active: true, comercio: DEMO_COMMERCE, created_at: new Date('2026-08-01T12:00:00Z').toISOString() },
    { id: 'mi-meli', merchant_id: DEMO_USER_ID, platform: 'mercado_libre', shop_url: 'Empresa Demo ML', is_active: false, comercio: DEMO_COMMERCE, created_at: new Date('2026-08-02T10:00:00Z').toISOString() }
  ],
  dashboard_news: [
    { id: 'n-1', title: '🚀 Lanzamiento: Integración de Envios Automatizados V2', content: 'Hemos optimizado la comunicación con couriers nacionales. Tus etiquetas y guías de despacho ahora se generan 40% más rápido de forma nativa.', created_at: new Date('2026-08-08T09:00:00Z').toISOString() },
    { id: 'n-2', title: '📊 Nuevos Módulos de Facturación y Liquidación', content: 'Revisa de manera transparente el desglose de almacenamiento cúbico, seguros y cobros KAM directo desde el panel de Billing.', created_at: new Date('2026-08-05T14:00:00Z').toISOString() }
  ],
  billing_periods: [
    { id: 'bp-1', name: 'Julio 2026', start_date: '2026-07-01', end_date: '2026-07-31' },
    { id: 'bp-2', name: 'Agosto 2026', start_date: '2026-08-01', end_date: '2026-08-31' }
  ],
  billing_mappings: [
    { id: 'bm-1', comercio_nombre: DEMO_COMMERCE, billing_name: DEMO_COMMERCE }
  ],
  comercios_adicional_config: [
    {
      id: 'cac-1',
      comercio: DEMO_COMMERCE,
      inventario_seguimiento: true,
      onboarding_checklist: {
        integrations: true,
        stock_declared: true,
        first_order: true,
        billing_details: false
      }
    }
  ],
  reverse_logistics: [
    { id: 'rl-1', comercio: DEMO_COMMERCE, order_number: '1001', type: 'return', reason: 'Talla incorrecta', status: 'received', created_at: new Date('2026-08-07T10:00:00Z').toISOString() }
  ],
  store_pickups: [],
  store_sales: [],
  system_banners: [],
  system_popups: [],
  user_notification_reads: [],
  shipping_rates: [
    { id: 'current', rates: { "Santiago": 3500, "Valparaiso": 4200, "Concepcion": 5000, "Antofagasta": 6500 } }
  ],
  envios_unificados: [
    {
      id: 'ship-1',
      pedido_referencia: '1001',
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      nombre_destinatario: 'María González',
      telefono_destino: '+56911223344',
      comuna_destino: 'Las Condes',
      direccion_destino: 'Av. Apoquindo 4800, Of. 101',
      courier: 'Chilexpress',
      tracking: '9876543210',
      tracking_url: 'https://www.chilexpress.cl',
      status: 'Entregado',
      global_status: 'DESPACHADO',
      source_table: 'lightdata_envios',
      empresa_comercio_proveedor: DEMO_COMMERCE
    },
    {
      id: 'ship-2',
      pedido_referencia: '1002',
      created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      nombre_destinatario: 'Catalina Rivas',
      telefono_destino: '+56998765432',
      comuna_destino: 'Providencia',
      direccion_destino: 'Av. Providencia 1250',
      courier: 'Starken',
      tracking: 'STK-8877665',
      tracking_url: 'https://www.starken.cl',
      status: 'Creado',
      global_status: 'SIN MOVIMIENTO',
      source_table: 'enviame_shipments',
      empresa_comercio_proveedor: DEMO_COMMERCE
    },
    {
      id: 'ship-3',
      pedido_referencia: '1003',
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      nombre_destinatario: 'Andrés Pérez',
      telefono_destino: '+56955556666',
      comuna_destino: 'Santiago Centro',
      direccion_destino: 'Alameda 340',
      courier: 'Blue Express',
      tracking: 'BX-9988221',
      tracking_url: 'https://www.blue.cl',
      status: 'Listo para despacho',
      global_status: 'SIN MOVIMIENTO',
      source_table: 'optiroute_envios',
      empresa_comercio_proveedor: DEMO_COMMERCE
    },
    {
      id: 'ship-4',
      pedido_referencia: '1000',
      created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 5.5 * 24 * 60 * 60 * 1000).toISOString(),
      nombre_destinatario: 'Ana López',
      telefono_destino: '+56988776655',
      comuna_destino: 'Concepción',
      direccion_destino: 'O\'Higgins 450',
      courier: 'Starken',
      tracking: 'STK-CANCELLED',
      tracking_url: 'https://www.starken.cl',
      status: 'No retirado',
      global_status: 'ALERTA',
      source_table: 'lightdata_envios',
      empresa_comercio_proveedor: DEMO_COMMERCE
    }
  ]
};

// 3. Inicializar base de datos simulada en sessionStorage
window.initializeDemoDB = function(forceReset = false) {
  if (!window.isDemoMode()) return;

  const exists = sessionStorage.getItem('wms_demo_db_initialized') === 'true';
  if (exists && !forceReset) {
    try {
      const profiles = JSON.parse(sessionStorage.getItem('wms_demo_profiles') || '[]');
      if (profiles.length > 0 && (!profiles[0].allowed_modules || profiles[0].allowed_modules.split(',').length < 10)) {
        profiles[0].allowed_modules = 'inventory, catalog, volumen_diario, declarations, orders, shipments, movements, warehouses, pending, returns, pickups, sales, cotizador, billing, integrations, incidencias, documentation';
        sessionStorage.setItem('wms_demo_profiles', JSON.stringify(profiles));
      }
      // Forzar alineación coherente de pedidos y despachos en la sesión actual
      if (!sessionStorage.getItem('wms_demo_db_aligned_v4')) {
        const makeCurrentDate = (offsetDays) => new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000).toISOString();
        const demoCommerce = sessionStorage.getItem('wms_demo_profiles') ? JSON.parse(sessionStorage.getItem('wms_demo_profiles'))[0]?.comercio || 'Empresa Demo S.A.' : 'Empresa Demo S.A.';
        
        const alignedOrders = [
          { 
            id: 'o-1001', 
            comercio: demoCommerce, 
            status: 'shipped', 
            customer_name: 'María González', 
            customer_email: 'maria.gonzalez@gmail.com',
            customer_phone: '+56911223344',
            shipping_address: 'Av. Apoquindo 4800, Of. 101',
            shipping_city: 'Las Condes',
            shipping_method: 'Chilexpress',
            payment_status: 'PAID',
            total_price: 180000, 
            total_value: 180000,
            sucursal_pickeo: 'Bodega Central STK',
            agenda: 'Bloque Mañana (09:00 - 13:00)',
            fecha_procesamiento: makeCurrentDate(2).split('T')[0],
            operador: 'Chilexpress',
            external_order_number: '1001', 
            courier: 'Chilexpress', 
            tracking_number: '9876543210', 
            created_at: makeCurrentDate(2), 
            items_count: 1, 
            label_base64: 'mock_pdf_base64_data' 
          },
          { 
            id: 'o-1002', 
            comercio: demoCommerce, 
            status: 'pending', 
            customer_name: 'Catalina Rivas', 
            customer_email: 'catalina.rivas@yahoo.com',
            customer_phone: '+56998765432',
            shipping_address: 'Av. Providencia 1250',
            shipping_city: 'Providencia',
            shipping_method: 'Starken',
            payment_status: 'PENDING',
            total_price: 6000000, 
            total_value: 6000000,
            sucursal_pickeo: 'Bodega Central STK',
            agenda: 'Bloque Tarde (14:00 - 18:00)',
            fecha_procesamiento: makeCurrentDate(4).split('T')[0],
            operador: 'Starken',
            external_order_number: '1002', 
            courier: 'Starken', 
            tracking_number: 'STK-8877665', 
            created_at: makeCurrentDate(4), 
            items_count: 5, 
            label_base64: 'mock_pdf_base64_data' 
          },
          { 
            id: 'o-1003', 
            comercio: demoCommerce, 
            status: 'packing', 
            customer_name: 'Andrés Pérez', 
            customer_email: 'andres.perez@outlook.com',
            customer_phone: '+56955556666',
            shipping_address: 'Alameda 340',
            shipping_city: 'Santiago Centro',
            shipping_method: 'Blue Express',
            payment_status: 'PAID',
            total_price: 135000, 
            total_value: 135000,
            sucursal_pickeo: 'Bodega Central STK',
            agenda: 'Bloque Mañana (09:00 - 13:00)',
            fecha_procesamiento: makeCurrentDate(5).split('T')[0],
            operador: 'Blue Express',
            external_order_number: '1003', 
            courier: 'Blue Express', 
            tracking_number: 'BX-9988221', 
            created_at: makeCurrentDate(5), 
            items_count: 3, 
            label_base64: 'mock_pdf_base64_data' 
          },
          { 
            id: 'o-1004', 
            comercio: demoCommerce, 
            status: 'cancelled', 
            customer_name: 'Ana López', 
            customer_email: 'ana.lopez@gmail.com',
            customer_phone: '+56988776655',
            shipping_address: 'O\'Higgins 450',
            shipping_city: 'Concepción',
            shipping_method: 'Starken',
            payment_status: 'PENDING',
            total_price: 32000, 
            total_value: 32000,
            sucursal_pickeo: 'Bodega Central STK',
            agenda: 'Sin agendar',
            fecha_procesamiento: '-',
            operador: 'Starken',
            external_order_number: '1000', 
            courier: 'Starken', 
            tracking_number: 'STK-CANCELLED', 
            created_at: makeCurrentDate(6), 
            items_count: 1 
          },
          {
            id: 'o-1005',
            comercio: demoCommerce,
            status: 'pending',
            customer_name: 'Camila Torres',
            customer_email: 'camila.torres@gmail.com',
            customer_phone: '+56977778888',
            shipping_address: 'Avenida del Mar 200',
            shipping_city: 'La Serena',
            shipping_method: 'Chilexpress',
            payment_status: 'PAID',
            total_price: 540000,
            total_value: 540000,
            sucursal_pickeo: 'Bodega Central STK',
            agenda: 'Bloque Mañana (09:00 - 13:00)',
            fecha_procesamiento: makeCurrentDate(1).split('T')[0],
            operador: 'Chilexpress',
            external_order_number: '1005',
            courier: 'Chilexpress',
            tracking_number: '9876543219',
            created_at: makeCurrentDate(1),
            items_count: 3
          },
          {
            id: 'o-1006',
            comercio: demoCommerce,
            status: 'pending',
            customer_name: 'Juan Herrera',
            customer_email: 'juan.herrera@gmail.com',
            customer_phone: '+56944445555',
            shipping_address: 'Calle Prat 123',
            shipping_city: 'Valparaíso',
            shipping_method: 'Starken',
            payment_status: 'PENDING',
            total_price: 256000,
            total_value: 256000,
            sucursal_pickeo: 'Bodega Central STK',
            agenda: 'Bloque Tarde (14:00 - 18:00)',
            fecha_procesamiento: makeCurrentDate(3).split('T')[0],
            operador: 'Starken',
            external_order_number: '1006',
            courier: 'Starken',
            tracking_number: 'STK-9900112',
            created_at: makeCurrentDate(3),
            items_count: 8
          }
        ];
        sessionStorage.setItem('wms_demo_orders', JSON.stringify(alignedOrders));

        const alignedOrderItems = [
          { id: 'oi-1', order_id: 'o-1001', product_id: 'p-2', quantity: 1, warehouse_id: 'wh-central', created_at: makeCurrentDate(2) },
          { id: 'oi-2', order_id: 'o-1002', product_id: 'p-1', quantity: 5, warehouse_id: 'wh-central', created_at: makeCurrentDate(4) },
          { id: 'oi-3', order_id: 'o-1003', product_id: 'p-3', quantity: 3, warehouse_id: 'wh-central', created_at: makeCurrentDate(5) },
          { id: 'oi-4', order_id: 'o-1004', product_id: 'p-4', quantity: 1, warehouse_id: 'wh-central', created_at: makeCurrentDate(6) },
          { id: 'oi-5', order_id: 'o-1005', product_id: 'p-2', quantity: 3, warehouse_id: 'wh-central', created_at: makeCurrentDate(1) },
          { id: 'oi-6', order_id: 'o-1006', product_id: 'p-4', quantity: 8, warehouse_id: 'wh-central', created_at: makeCurrentDate(3) }
        ];
        sessionStorage.setItem('wms_demo_order_items', JSON.stringify(alignedOrderItems));

        const shipments = [
          {
            id: 'ship-1',
            pedido_referencia: '1001',
            created_at: makeCurrentDate(2),
            updated_at: makeCurrentDate(1),
            nombre_destinatario: 'María González',
            telefono_destino: '+56911223344',
            comuna_destino: 'Las Condes',
            direccion_destino: 'Av. Apoquindo 4800, Of. 101',
            courier: 'Chilexpress',
            tracking: '9876543210',
            tracking_url: 'https://www.chilexpress.cl',
            status: 'Entregado',
            global_status: 'DESPACHADO',
            source_table: 'lightdata_envios',
            empresa_comercio_proveedor: demoCommerce
          },
          {
            id: 'ship-2',
            pedido_referencia: '1002',
            created_at: makeCurrentDate(4),
            updated_at: makeCurrentDate(3),
            nombre_destinatario: 'Catalina Rivas',
            telefono_destino: '+56998765432',
            comuna_destino: 'Providencia',
            direccion_destino: 'Av. Providencia 1250',
            courier: 'Starken',
            tracking: 'STK-8877665',
            tracking_url: 'https://www.starken.cl',
            status: 'Creado',
            global_status: 'SIN MOVIMIENTO',
            source_table: 'enviame_shipments',
            empresa_comercio_proveedor: demoCommerce
          },
          {
            id: 'ship-3',
            pedido_referencia: '1003',
            created_at: makeCurrentDate(5),
            updated_at: makeCurrentDate(4),
            nombre_destinatario: 'Andrés Pérez',
            telefono_destino: '+56955556666',
            comuna_destino: 'Santiago Centro',
            direccion_destino: 'Alameda 340',
            courier: 'Blue Express',
            tracking: 'BX-9988221',
            tracking_url: 'https://www.blue.cl',
            status: 'Listo para despacho',
            global_status: 'SIN MOVIMIENTO',
            source_table: 'optiroute_envios',
            empresa_comercio_proveedor: demoCommerce
          },
          {
            id: 'ship-4',
            pedido_referencia: '1000',
            created_at: makeCurrentDate(6),
            updated_at: makeCurrentDate(5.5),
            nombre_destinatario: 'Ana López',
            telefono_destino: '+56988776655',
            comuna_destino: 'Concepción',
            direccion_destino: 'O\'Higgins 450',
            courier: 'Starken',
            tracking: 'STK-CANCELLED',
            tracking_url: 'https://www.starken.cl',
            status: 'No retirado',
            global_status: 'ALERTA',
            source_table: 'lightdata_envios',
            empresa_comercio_proveedor: demoCommerce
          }
        ];
        const alignedProfiles = [
          {
            id: 'demo-client-uuid-placeholder',
            role: 'client',
            company_name: demoCommerce,
            full_name: 'Cliente Invitado Demo',
            email: 'demo@stocka.cl',
            comercio: demoCommerce,
            allowed_modules: 'inventory, catalog, volumen_diario, declarations, orders, shipments, movements, warehouses, pending, returns, pickups, sales, cotizador, billing, integrations, incidencias, documentation',
            is_demo_user: false,
            lead_status: null,
            lead_notes: '',
            lead_emails_sent: [],
            created_at: makeCurrentDate(10)
          },
          {
            id: 'lead-1',
            role: 'observer',
            company_name: 'Tienda Deportiva SpA',
            full_name: 'Rodrigo Cárcamo',
            email: 'rodrigo.carcamo@gmail.com',
            comercio: 'no asignado',
            is_demo_user: true,
            lead_status: 'nuevo',
            lead_notes: 'Interesado en fulfillment para calzado deportivo en Santiago.',
            lead_emails_sent: [],
            created_at: makeCurrentDate(3)
          },
          {
            id: 'lead-2',
            role: 'observer',
            company_name: 'Electrónica Express',
            full_name: 'Valentina Silva',
            email: 'valentina.silva@outlook.com',
            comercio: 'no asignado',
            is_demo_user: true,
            lead_status: 'contactado',
            lead_notes: 'Busca bodega en RM con despacho rápido de accesorios.',
            lead_emails_sent: [
              { template: 'Bienvenida a la Demo', sent_at: makeCurrentDate(1), subject: '¡Bienvenido a la Demo de WMS Stocka!' }
            ],
            created_at: makeCurrentDate(1)
          }
        ];
        sessionStorage.setItem('wms_demo_profiles', JSON.stringify(alignedProfiles));
        sessionStorage.setItem('wms_demo_envios_unificados', JSON.stringify(shipments));
        sessionStorage.setItem('wms_demo_db_aligned_v3', 'true');
      }
    } catch(e) {}
    try {
      const configs = JSON.parse(sessionStorage.getItem('wms_demo_comercios_adicional_config') || '[]');
      if (configs.length > 0 && configs[0].inventario_seguimiento !== true) {
        configs[0].inventario_seguimiento = true;
        sessionStorage.setItem('wms_demo_comercios_adicional_config', JSON.stringify(configs));
      }
    } catch(e) {}
    console.log('WMS: Base de datos demo activa cargada de sessionStorage.');
    return;
  }

  // Cargar datos por defecto
  Object.keys(INITIAL_MOCK_DATA).forEach(table => {
    sessionStorage.setItem(`wms_demo_${table}`, JSON.stringify(INITIAL_MOCK_DATA[table]));
  });
  
  sessionStorage.setItem('wms_demo_db_initialized', 'true');
  console.log('WMS: Base de datos demo inicializada con datos ficticios seguros.');
};

// Funciones para leer y guardar tablas individuales
window.getMockTable = function(table) {
  const raw = sessionStorage.getItem(`wms_demo_${table}`);
  return raw ? JSON.parse(raw) : [];
};

window.saveMockTable = function(table, data) {
  sessionStorage.setItem(`wms_demo_${table}`, JSON.stringify(data));
};

// 4. Inyectar Banner visual y Widget de control interactivo
window.injectDemoUI = function() {
  if (!window.isDemoMode()) return;
  if (document.getElementById('wms-demo-widget')) return;

  // Inyectar CSS y animación
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes wms-ping-demo {
      75%, 100% {
        transform: scale(2.2);
        opacity: 0;
      }
    }
    @keyframes pulse-demo-icon {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.15); opacity: 1; }
    }
    @keyframes wms-contact-glow {
      0%, 100% {
        box-shadow: 0 10px 15px -3px rgba(94, 23, 235, 0.35), 0 0 0 0 rgba(94, 23, 235, 0.45);
      }
      50% {
        box-shadow: 0 15px 25px -3px rgba(94, 23, 235, 0.45), 0 0 0 12px rgba(94, 23, 235, 0);
      }
    }
  `;
  document.head.appendChild(style);

  // Inyectar píldora indicadora en la cabecera
  const topHeader = document.querySelector('.top-header');
  if (topHeader) {
    const titleContainer = topHeader.querySelector('.header-title') || topHeader.firstElementChild;
    if (titleContainer && !document.querySelector('.demo-badge-pill')) {
      const badge = document.createElement('div');
      badge.className = 'demo-badge-pill';
      badge.style.cssText = `
        background: linear-gradient(135deg, rgba(94, 23, 235, 0.12) 0%, rgba(37, 99, 235, 0.08) 100%);
        border: 1px solid rgba(94, 23, 235, 0.25);
        border-radius: 99px;
        padding: 0.3rem 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--color-accent, #5e17eb);
        box-shadow: 0 2px 8px rgba(94, 23, 235, 0.05);
        font-family: 'Inter', sans-serif;
        margin-left: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      `;
      badge.innerHTML = `
        <span style="position: relative; display: flex; width: 8px; height: 8px;">
          <span style="position: absolute; display: inline-flex; height: 100%; width: 100%; border-radius: 50%; background-color: #10b981; opacity: 0.75;"></span>
          <span style="position: absolute; display: inline-flex; height: 100%; width: 100%; border-radius: 50%; background-color: #10b981; animation: wms-ping-demo 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        </span>
        Modo Demo
      `;
      // Insertar después del título
      titleContainer.style.display = 'flex';
      titleContainer.style.alignItems = 'center';
      titleContainer.appendChild(badge);
    }
  }

  // Inyectar Widget de control en la esquina inferior derecha
  const widget = document.createElement('div');
  widget.id = 'wms-demo-widget';
  widget.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 0.75rem 1.1rem;
    border-radius: var(--radius-lg, 12px);
    color: white;
    font-family: 'Inter', sans-serif;
    z-index: 99999;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.85rem;
    animation: slideUpWmsDemo 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  widget.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.5rem;">
      <i class="ri-shield-line" style="color: #a78bfa; font-size: 1.1rem; animation: pulse-demo-icon 2s ease-in-out infinite;"></i>
      <span style="font-weight: 500; color: rgba(255, 255, 255, 0.85);">Entorno Simulado</span>
    </div>
    <div style="width: 1px; height: 16px; background-color: rgba(255, 255, 255, 0.15);"></div>
    <div style="display: flex; gap: 0.4rem;">
      <button id="demo-action-reset" style="
        background: rgba(94, 23, 235, 0.2);
        border: 1px solid rgba(94, 23, 235, 0.45);
        color: #c084fc;
        padding: 0.25rem 0.6rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.25rem;
        transition: all 0.2s;
        font-family: 'Inter', sans-serif;
      " onmouseover="this.style.background='rgba(94, 23, 235, 0.35)'; this.style.color='#f3e8ff';" onmouseout="this.style.background='rgba(94, 23, 235, 0.2)'; this.style.color='#c084fc';">
        <i class="ri-refresh-line"></i> Reiniciar
      </button>
      <button id="demo-action-exit" style="
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.7);
        padding: 0.25rem 0.6rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        font-family: 'Inter', sans-serif;
      " onmouseover="this.style.borderColor='rgba(255, 255, 255, 0.45)'; this.style.color='white'; this.style.background='rgba(255,255,255,0.05)';" onmouseout="this.style.borderColor='rgba(255, 255, 255, 0.2)'; this.style.color='rgba(255, 255, 255, 0.7)'; this.style.background='transparent';">
        Salir
      </button>
    </div>
  `;
  document.body.appendChild(widget);

  // Inyectar Botón Flotante de Contacto Comercial
  const contactFab = document.createElement('button');
  contactFab.id = 'wms-demo-contact-fab';
  contactFab.style.cssText = `
    position: fixed;
    bottom: 84px;
    right: 24px;
    background: linear-gradient(135deg, #5e17eb 0%, #2563eb 100%);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 99px;
    color: white;
    font-family: 'Inter', sans-serif;
    font-size: 0.82rem;
    font-weight: 800;
    padding: 0.75rem 1.25rem;
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    animation: slideUpWmsDemo 0.5s cubic-bezier(0.16, 1, 0.3, 1), wms-contact-glow 2.5s infinite ease-in-out;
  `;
  contactFab.innerHTML = `
    <i class="ri-customer-service-2-line" style="font-size: 1rem;"></i>
    <span>Contacto Comercial</span>
  `;

  // Efectos hover fluidos
  contactFab.addEventListener('mouseover', () => {
    contactFab.style.transform = 'translateY(-3px) scale(1.04)';
    contactFab.style.boxShadow = '0 20px 30px -5px rgba(94, 23, 235, 0.5), 0 0 0 4px rgba(94, 23, 235, 0.2)';
    contactFab.style.animation = 'none'; // Pausar pulso en hover para mayor responsividad táctil
  });
  contactFab.addEventListener('mouseout', () => {
    contactFab.style.transform = 'translateY(0) scale(1)';
    contactFab.style.animation = 'wms-contact-glow 2.5s infinite ease-in-out';
  });

  contactFab.addEventListener('click', () => {
    window.injectDemoWelcomeModal(true);
  });

  document.body.appendChild(contactFab);

  // 5. Configurar manejadores de eventos del widget
  document.getElementById('demo-action-reset').addEventListener('click', () => {
    if (window.Swal) {
      window.Swal.fire({
        title: '¿Reiniciar base de datos?',
        text: 'Se restablecerán todos los productos, órdenes e inventario a los valores por defecto de la demostración.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: 'var(--color-primary, #2563eb)',
        cancelButtonColor: 'rgba(0,0,0,0.1)',
        confirmButtonText: 'Sí, reiniciar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          window.initializeDemoDB(true);
          window.location.reload();
        }
      });
    } else {
      if (confirm('¿Restablecer datos demo a los valores originales?')) {
        window.initializeDemoDB(true);
        window.location.reload();
      }
    }
  });

  document.getElementById('demo-action-exit').addEventListener('click', () => {
    sessionStorage.removeItem('wms_demo_mode');
    sessionStorage.removeItem('wms_demo_db_initialized');
    window.location.href = 'index.html';
  });
};

// 6. Bloqueo de Descarga de Datos (Cumpliendo el requisito de seguridad)
window.setupDemoBlockers = function() {
  if (!window.isDemoMode()) return;

  // Interceptar window.print
  const originalPrint = window.print;
  window.print = function() {
    if (window.isDemoMode()) {
      if (window.Swal) {
        window.Swal.fire({
          title: 'Función No Disponible',
          text: 'La descarga de informes, facturas y la impresión física están desactivadas en la versión de demostración.',
          icon: 'info',
          confirmButtonColor: 'var(--color-accent, #5e17eb)',
          confirmButtonText: 'Entendido'
        });
      } else {
        alert('Modo Demo: Impresión y exportación de archivos deshabilitadas.');
      }
      return;
    }
    originalPrint.apply(this, arguments);
  };

  // Interceptar clicks en fase de captura para evitar descargas
  document.addEventListener('click', (e) => {
    if (!window.isDemoMode()) return;

    // Selectores de botones de exportación, descarga o ver desgloses PDF
    const target = e.target.closest(
      '#btn-export-inventory, ' +
      '#btn-export-movements, ' +
      '#btn-bulk-export-shopify, ' +
      '#ship-btn-export, ' +
      '#btn-export-csv, ' +
      '#btn-export-excel, ' +
      '.btn-billing-pdf, ' +
      '.btn-client-preview-doc, ' +
      '[id*="export-excel"], ' +
      '[id*="export-csv"], ' +
      'button[onclick="window.print()"]'
    );

    if (target) {
      e.preventDefault();
      e.stopPropagation();

      if (window.Swal) {
        window.Swal.fire({
          title: 'Exportación Bloqueada',
          text: 'Por motivos de seguridad y resguardo del entorno de prueba, las exportaciones de datos y descargas de PDFs están deshabilitadas en el modo demo.',
          icon: 'warning',
          confirmButtonColor: 'var(--color-accent, #5e17eb)',
          confirmButtonText: 'Entendido'
        });
      } else {
        alert('Modo Demo: La exportación de datos está restringida.');
      }
    }
  }, true); // Captura activada para detener el evento antes de que lo reciba app.js
};

// 7. Inyectar Modal de Bienvenida Premium
window.injectDemoWelcomeModal = function(forceShow = false) {
  if (!window.isDemoMode()) return;
  if (sessionStorage.getItem('wms_demo_welcome_shown') === 'true' && !forceShow) return;
  if (document.getElementById('demo-welcome-modal')) return;

  // Inyectar css de RemixIcon si no existe
  if (!document.querySelector('link[href*="remixicon"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css';
    document.head.appendChild(link);
  }

  const modal = document.createElement('div');
  modal.id = 'demo-welcome-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    display: flex; align-items: center; justify-content: center;
    z-index: 100000; opacity: 0; transition: opacity 0.4s ease;
    font-family: 'Inter', sans-serif; padding: 1.5rem;
  `;
  
  modal.innerHTML = `
    <div id="demo-welcome-card" style="
      background: #ffffff;
      max-width: 580px;
      width: 100%;
      border-radius: 24px;
      border: 1px solid rgba(226, 232, 240, 0.8);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      overflow: hidden;
      transform: scale(0.9);
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: flex;
      flex-direction: column;
    ">
      <!-- Header visual premium -->
      <div style="
        background: linear-gradient(135deg, #5e17eb 0%, #2563eb 100%);
        padding: 2.25rem 2.25rem 2rem 2.25rem;
        position: relative;
        color: white;
      ">
        <div style="
          position: absolute; top: -40px; right: -40px;
          width: 130px; height: 130px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 50%;
        "></div>
        
        <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" style="width: 48px; height: 48px; object-fit: contain; margin-bottom: 1.25rem;" alt="Stocka Logo">
        
        <h2 style="font-size: 1.55rem; font-weight: 800; margin: 0 0 0.5rem 0; letter-spacing: -0.02em; line-height: 1.25; font-family: 'Inter', sans-serif;">
          ¡Bienvenido a la Demo de Stocka!
        </h2>
        <p style="color: rgba(255, 255, 255, 0.88); font-size: 0.9rem; font-weight: 500; margin: 0; line-height: 1.45; font-family: 'Inter', sans-serif;">
          Estás ingresando a una demostración interactiva de nuestro sistema WMS (Warehouse Management System).
        </p>
      </div>

      <!-- Body content -->
      <div style="padding: 2.25rem; background: #ffffff;">
        <p style="font-size: 0.88rem; color: #475569; line-height: 1.6; margin: 0 0 1.75rem 0; font-weight: 500; font-family: 'Inter', sans-serif;">
          Este entorno utiliza <strong>datos simulados y ficticios</strong> diseñados para que conozcas la interfaz y el flujo operacional. Ten en cuenta que <span style="color: #5e17eb; font-weight: 700;">las integraciones y funcionalidades de exportación real se encuentran desactivadas</span> hasta que seas cliente y conectes tus propios canales de venta.
        </p>

        <div style="height: 1px; background-color: #f1f5f9; margin-bottom: 1.75rem;"></div>

        <!-- Tarjeta de Asesoría Comercial -->
        <div style="
          background: #f8fafc;
          border: 1px dashed rgba(94, 23, 235, 0.25);
          border-radius: 16px;
          padding: 1.25rem;
          margin-bottom: 1.75rem;
        ">
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
            <div style="
              width: 42px; height: 42px;
              background: linear-gradient(135deg, rgba(94, 23, 235, 0.1) 0%, rgba(37, 99, 235, 0.1) 100%);
              border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              color: #5e17eb; font-size: 1.25rem;
            ">
              <i class="ri-user-star-line"></i>
            </div>
            <div>
              <h4 style="margin: 0; font-size: 0.92rem; font-weight: 800; color: #0f172a; font-family: 'Inter', sans-serif;">Felipe Trujillo</h4>
              <span style="font-size: 0.72rem; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Inter', sans-serif;">Asesoría Comercial WMS</span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <!-- Email -->
            <a href="mailto:felipe.tp@stocka.cl" style="
              display: flex; align-items: center; justify-content: center; gap: 0.45rem;
              background: white; border: 1px solid #e2e8f0; border-radius: 10px;
              padding: 0.65rem; color: #334155; font-size: 0.8rem; font-weight: 700;
              text-decoration: none; transition: all 0.2s;
              font-family: 'Inter', sans-serif;
            " onmouseover="this.style.borderColor='#cbd5e1'; this.style.background='#f8fafc';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white';">
              <i class="ri-mail-line" style="color: #64748b; font-size: 0.95rem;"></i> felipe.tp@stocka.cl
            </a>

            <!-- WhatsApp -->
            <a href="https://wa.me/56939247487" target="_blank" style="
              display: flex; align-items: center; justify-content: center; gap: 0.45rem;
              background: #25d366; border: 1px solid #22c55e; border-radius: 10px;
              padding: 0.65rem; color: white; font-size: 0.8rem; font-weight: 700;
              text-decoration: none; transition: all 0.2s;
              font-family: 'Inter', sans-serif;
            " onmouseover="this.style.background='#22c55e'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='#25d366'; this.style.transform='translateY(0)';">
              <i class="ri-whatsapp-line" style="font-size: 0.95rem;"></i> WhatsApp
            </a>
          </div>
        </div>

        <!-- Acciones principales -->
        <div style="display: flex; align-items: center; gap: 1rem;">
          <button id="close-welcome-modal-btn" style="
            flex: 1;
            background: linear-gradient(135deg, #5e17eb 0%, #3b82f6 100%);
            color: white; border: none; border-radius: 12px;
            padding: 0.9rem; font-size: 0.9rem; font-weight: 700;
            cursor: pointer; transition: all 0.2s;
            box-shadow: 0 4px 12px rgba(94, 23, 235, 0.2);
            font-family: 'Inter', sans-serif;
          " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 16px rgba(94, 23, 235, 0.3)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(94, 23, 235, 0.2)';">
            Explorar Demo WMS
          </button>

          <a href="https://stocka.cl" target="_blank" style="
            display: flex; align-items: center; justify-content: center; gap: 0.4rem;
            border: 1px solid #cbd5e1; border-radius: 12px;
            padding: 0.9rem 1.25rem; color: #475569; font-size: 0.85rem; font-weight: 700;
            text-decoration: none; transition: all 0.2s;
            background: white;
            font-family: 'Inter', sans-serif;
          " onmouseover="this.style.borderColor='#94a3b8'; this.style.background='#f8fafc';" onmouseout="this.style.borderColor='#cbd5e1'; this.style.background='white';">
            stocka.cl <i class="ri-external-link-line" style="font-size: 0.9rem;"></i>
          </a>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Forzar reflow e iniciar transición de entrada
  const card = document.getElementById('demo-welcome-card');
  void modal.offsetWidth;
  modal.style.opacity = '1';
  if (card) {
    card.style.transform = 'scale(1)';
  }

  // Guardar flag para que no se muestre de nuevo en la misma sesión
  sessionStorage.setItem('wms_demo_welcome_shown', 'true');

  // Cerrar modal al hacer clic en el botón
  document.getElementById('close-welcome-modal-btn').addEventListener('click', () => {
    modal.style.opacity = '0';
    if (card) {
      card.style.transform = 'scale(0.9)';
    }
    setTimeout(() => {
      modal.remove();
    }, 400);
  });
};

const runOnLoad = (callback) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback);
  } else {
    callback();
  }
};

// Inicializar de inmediato al importar
if (window.isDemoMode()) {
  window.initializeDemoDB();
  window.setupDemoBlockers();
  runOnLoad(() => {
    window.injectDemoUI();
    window.injectDemoWelcomeModal();
  });
}
