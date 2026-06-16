import supabase from './supabase.js';

console.log('DEBUG: Iniciando js/app.js...');

let userRole = 'observer';
let currentMerchantId = null;
let currentCompany = null;

async function init() {
  console.log('DEBUG: Ejecutando función init()...');
  const userEmailSpan = document.getElementById('user-email');
  const logoutBtn = document.getElementById('logout-btn');
  const viewTitle = document.getElementById('view-title');
  const navItems = document.querySelectorAll('.nav-item');

  try {
    // Verify authentication
    console.log('DEBUG: Obteniendo sesión de Supabase...');
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error('DEBUG: Error al obtener sesión:', error);
    }

    if (!session) {
      console.warn('DEBUG: No hay sesión activa. Redirigiendo a index.html...');
      window.location.href = 'index.html';
      return;
    }

    console.log('DEBUG: Sesión activa encontrada para el usuario:', session.user.email);

    // Verificar rol y datos de perfil
    console.log('DEBUG: Consultando perfil en la base de datos para ID:', session.user.id);
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, company_name, full_name, comercio')
      .eq('id', session.user.id)
      .single();

    if (profileError) {
      console.warn('DEBUG: Error al obtener perfil (puede que no exista en la tabla profiles):', profileError);
    } else {
      console.log('DEBUG: Perfil encontrado:', profile);
      if (profile) {
        userRole = profile.role || 'observer';
        currentCompany = profile.comercio || null;
      }
    }

    if (profile && profile.role === 'admin') {
      console.log('DEBUG: Rol es admin. Redirigiendo a admin.html...');
      window.location.href = 'admin.html';
      return;
    }

    // Set user info
    const user = session.user;
    currentMerchantId = user.id;
    if (userEmailSpan) {
      const displayName = profile?.full_name || user.user_metadata?.full_name || profile?.company_name || user.email;
      userEmailSpan.textContent = displayName;
    }

    // Render initial view
    console.log('DEBUG: Renderizando vista inicial de inventario...');
    renderInventory();

    // Navigation Logic
    if (navItems) {
      navItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          navItems.forEach(n => n.classList.remove('active'));
          e.target.classList.add('active');

          const view = e.target.getAttribute('data-view');
          
          if (view === 'inventory') {
            viewTitle.textContent = 'Inventario';
            renderInventory();
          } else if (view === 'orders') {
            viewTitle.textContent = 'Pedidos';
            renderOrders();
          } else if (view === 'shipments') {
            viewTitle.textContent = 'Despachos';
            renderShipments();
          } else if (view === 'movements') {
            viewTitle.textContent = 'Movimientos';
            renderMovements();
          } else if (view === 'warehouses') {
            viewTitle.textContent = 'Bodegas';
            renderWarehouses();
          } else if (view === 'pending') {
            viewTitle.textContent = 'Por Asignar';
            renderPending();
          } else if (view === 'integrations') {
            viewTitle.textContent = 'Integraciones';
            renderIntegrations();
          } else if (view === 'profile') {
            viewTitle.textContent = 'Mi Perfil';
            renderProfile();
          }
        });
      });
    }

    // Logout Logic
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        console.log('DEBUG: Cerrando sesión...');
        await supabase.auth.signOut();
        window.location.href = 'index.html';
      });
    }

  } catch (err) {
    console.error('DEBUG: Error crítico durante la inicialización de app.js:', err);
  }
}

// Ejecutar inicialización
init();

// Supabase Rendering Functions

async function renderInventory() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando inventario...</p>`;

  try {
    const { data: inventory, error } = await supabase
      .from('inventory')
      .select(`
        quantity,
        committed_quantity,
        products!inner (sku, name, merchant_id),
        warehouses (name)
      `)
      .eq('products.merchant_id', currentMerchantId);

    if (error) throw error;

    let rowsHtml = '';
    if (!inventory || inventory.length === 0) {
      rowsHtml = `
        <tr>
          <td colspan="7" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">
            No hay inventario registrado.
          </td>
        </tr>
      `;
    } else {
      inventory.forEach(item => {
        let badge = '';
        const available = item.quantity - item.committed_quantity;
        if (available > 50) badge = '<span class="badge badge-success">En Stock</span>';
        else if (available > 0) badge = '<span class="badge badge-warning">Bajo Stock</span>';
        else badge = '<span class="badge badge-danger">Agotado</span>';

        rowsHtml += `
          <tr>
            <td>${item.products?.sku || 'N/A'}</td>
            <td>${item.products?.name || 'N/A'}</td>
            <td>${item.warehouses?.name || 'N/A'}</td>
            <td><strong>${item.quantity}</strong></td>
            <td style="color: var(--color-accent); font-weight: 500;">${item.committed_quantity}</td>
            <td style="color: var(--color-primary); font-weight: 600;">${available}</td>
            <td>${badge}</td>
          </tr>
        `;
      });
    }

    const isObserver = userRole === 'observer';
    const actionBtn = isObserver ? '' : '<button class="btn btn-primary" id="btn-new-product">Nuevo Producto</button>';

    appContent.innerHTML = getObserverBanner() + `
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <h3>Stock Actual</h3>
          ${actionBtn}
        </div>
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th>Bodega</th>
                <th>Físico</th>
                <th>Comprometido</th>
                <th>Disponible</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error fetching inventory:', error);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar el inventario: ${error.message}</p>`;
  }
}

async function renderMovements() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando movimientos...</p>`;

  try {
    const { data: movements, error } = await supabase
      .from('movements')
      .select(`
        date,
        type,
        quantity,
        products!inner (sku, merchant_id),
        warehouses (name)
      `)
      .eq('products.merchant_id', currentMerchantId)
      .order('date', { ascending: false });

    if (error) throw error;

    let rowsHtml = '';
    if (!movements || movements.length === 0) {
      rowsHtml = `<tr><td colspan="5" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay movimientos registrados.</td></tr>`;
    } else {
      movements.forEach(mov => {
        const dateObj = new Date(mov.date);
        const formattedDate = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const isEntry = mov.type === 'in';
        const typeStyle = isEntry ? `color: var(--color-primary); font-weight: bold;` : `color: var(--color-accent); font-weight: bold;`;
        const typeText = isEntry ? '+ Ingreso' : '- Salida';

        rowsHtml += `
          <tr>
            <td>${formattedDate}</td>
            <td><span style="${typeStyle}">${typeText}</span></td>
            <td>${mov.products.sku}</td>
            <td>${mov.warehouses.name}</td>
            <td>${mov.quantity}</td>
          </tr>
        `;
      });
    }

    appContent.innerHTML = `
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <h3>Historial de Movimientos</h3>
        </div>
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>SKU</th>
                <th>Bodega</th>
                <th>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error fetching movements:', error);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar los movimientos.</p>`;
  }
}

async function renderWarehouses() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando bodegas...</p>`;

  try {
    const { data: warehousesAssigned, error } = await supabase
      .from('merchants_warehouses')
      .select(`
        warehouses (id, name, location)
      `);

    if (error) throw error;

    let cardsHtml = '';
    if (!warehousesAssigned || warehousesAssigned.length === 0) {
      cardsHtml = `<p style="color: var(--color-text-muted);">Aún no tienes bodegas asignadas.</p>`;
    } else {
      warehousesAssigned.forEach(mw => {
        const w = mw.warehouses;
        cardsHtml += `
          <div style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.5rem; background: var(--color-bg);">
            <h4 style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.5rem;">🏭</span> ${w.name}
            </h4>
            <p style="font-size: 0.875rem; color: var(--color-text-muted); margin-bottom: 1rem;">${w.location || 'Sin ubicación'}</p>
          </div>
        `;
      });
    }

    appContent.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Bodegas Asignadas</h3>
        </div>
        <div class="card-body">
          <p style="color: var(--color-text-muted); margin-bottom: 1.5rem;">Como cliente, tus productos están distribuidos en las siguientes bodegas administradas por STOCKA.</p>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem;">
            ${cardsHtml}
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error fetching warehouses:', error);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar las bodegas.</p>`;
  }
}

async function renderOrders() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando pedidos...</p>`;

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        status,
        created_at,
        external_order_number,
        order_items (quantity, products(sku, name))
      `)
      .eq('merchant_id', currentMerchantId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Obtener los despachos correspondientes de la tabla envios_unificados
    let shipments = [];
    if (orders && orders.length > 0) {
      const orderRefs = orders.map(o => o.external_order_number).filter(Boolean);
      const orderIds = orders.map(o => o.id);
      const allRefs = [...orderRefs, ...orderIds];

      const { data: shipData, error: shipError } = await supabase
        .from('envios_unificados')
        .select('*')
        .in('pedido_referencia', allRefs)
        .eq('visible_to_client', true);

      if (!shipError && shipData) {
        shipments = shipData;
      }
    }

    let rowsHtml = '';
    if (!orders || orders.length === 0) {
      rowsHtml = `<tr><td colspan="6" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay pedidos registrados.</td></tr>`;
    } else {
      orders.forEach(order => {
        // Buscar el envío en el listado cargado
        const orderShipments = shipments.filter(s => 
          s.pedido_referencia === order.id || 
          (order.external_order_number && s.pedido_referencia === order.external_order_number)
        );

        // Usar la fecha del envío (plataforma) si existe, de lo contrario la nativa de la orden
        const dateSource = (orderShipments.length > 0 && orderShipments[0].created_at) 
          ? orderShipments[0].created_at 
          : order.created_at;

        const dateObj = new Date(dateSource);
        const dateStr = dateObj.toLocaleDateString();
        
        let badgeColor = 'var(--color-gray)';
        let badgeTextColor = '#1a1a1a';
        if (order.status === 'despachado' || order.status === 'entregado' || order.status === 'retirado') {
          badgeColor = '#d1fae5'; // green
          badgeTextColor = '#065f46';
        } else if (order.status === 'en preparación' || order.status === 'preparado' || order.status === 'listo para retiro') {
          badgeColor = '#fef3c7'; // yellow
          badgeTextColor = '#92400e';
        } else if (order.status === 'en tránsito') {
          badgeColor = '#e0f2fe'; // blue
          badgeTextColor = '#0369a1';
        } else if (order.status === 'cancelado' || order.status === 'incidencia') {
          badgeColor = '#fee2e2'; // red
          badgeTextColor = '#991b1b';
        } else if (order.status === 'para procesar') {
          badgeColor = '#e0e7ff'; // indigo
          badgeTextColor = '#3730a3';
        } else if (order.status === 'en espera' || order.status === 'sin stock') {
          badgeColor = '#f3f4f6'; // gray
          badgeTextColor = '#374151';
        }

        let itemsStr = order.order_items.map(oi => `${oi.quantity}x ${oi.products.sku}`).join(', ');

        const orderDisplayId = order.external_order_number 
          ? `${order.external_order_number} <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; font-weight: normal;">(${order.id.split('-')[0]})</span>` 
          : order.id.split('-')[0];

        let trackingHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
        let labelHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;

        if (orderShipments.length > 0) {
          const shipment = orderShipments[0]; // Tomar el primer despacho
          if (shipment.tracking) {
            const courierName = shipment.courier || 'Seguimiento';
            trackingHtml = shipment.tracking_url && shipment.tracking_url !== 'N/A'
              ? `<a href="${shipment.tracking_url}" target="_blank" style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:500;">🚚 ${courierName}: ${shipment.tracking}</a>`
              : `<span style="display:inline-flex; align-items:center; gap:0.25rem; color: var(--color-text-main);">🚚 ${courierName}: ${shipment.tracking}</span>`;
          }
        }

        rowsHtml += `
          <tr>
            <td>${orderDisplayId}</td>
            <td>${dateStr}</td>
            <td>${itemsStr}</td>
            <td>${trackingHtml}</td>
            <td>${labelHtml}</td>
            <td><span style="background-color: ${badgeColor}; color: ${badgeTextColor}; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem; text-transform: capitalize; font-weight: 600;">${order.status}</span></td>
          </tr>
        `;
      });
    }
    const isObserver = userRole === 'observer';
    const actionBtn = isObserver ? '' : '<button class="btn btn-primary" id="btn-new-order">Crear Pedido</button>';

    appContent.innerHTML = getObserverBanner() + `
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <h3>Mis Pedidos</h3>
          ${actionBtn}
        </div>
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID Pedido</th>
                <th>Fecha</th>
                <th>Ítems</th>
                <th>Seguimiento</th>
                <th>Etiqueta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error fetching orders:', error);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar pedidos.</p>`;
  }
}

async function renderPending() {
  const appContent = document.getElementById('app-content');
    appContent.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Stock Pendiente de Asignación</h3>
        </div>
        <div class="card-body">
          <p style="color: var(--color-text-muted); margin-bottom: 1rem;">Estos productos ingresaron a la Bodega Central y están a la espera de ser distribuidos a su ubicación final o bodega sucursal por el administrador.</p>
          <div style="padding: 2rem; border: 2px dashed var(--color-border); border-radius: var(--radius-md); text-align: center; color: var(--color-text-muted);">
            <span style="font-size: 2rem; display: block; margin-bottom: 1rem;">🗂️</span>
            Actualmente no hay stock pendiente de reubicación.
          </div>
        </div>
      </div>
    `;
  }

async function renderIntegrations() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando integraciones...</p>`;

  try {
    const { data: userAuth } = await supabase.auth.getUser();
    if(!userAuth || !userAuth.user) throw new Error("No autenticado");
    const merchantId = userAuth.user.id;

    // Obtener la integración de Shopify
    const { data: shopifyIntegration, error: shopifyErr } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('platform', 'Shopify')
      .maybeSingle();

    if (shopifyErr) throw shopifyErr;

    const hasShopify = !!shopifyIntegration;
    const shopUrl = hasShopify ? shopifyIntegration.shop_url : '';
    const shopifyStatusText = hasShopify 
      ? (shopifyIntegration.is_active ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-gray" style="background-color: #f3f4f6; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">No configurada</span>';

    const isObserver = userRole === 'observer';
    const disabledAttr = isObserver ? 'disabled' : '';

    const buttonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasShopify 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-shopify" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Tienda Shopify</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-shopify" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar Shopify</button>');

    appContent.innerHTML = getObserverBanner() + `
      <div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Integraciones Ecommerce</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          En esta sección puedes conectar WMS STOCKA con tus tiendas en línea. 
          Al realizar una integración, los <strong>pedidos</strong> que recibas en tu tienda se sincronizarán automáticamente con nuestro WMS para ser procesados y despachados. Además, el <strong>inventario</strong> se mantendrá actualizado en tiempo real entre tus bodegas y tu plataforma de venta.
        </p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 2rem;">
        <!-- Left Column: Active/Available Integrations -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">🛍️ Shopify Integration</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasShopify ? '#f0fdf4' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasShopify ? '#bbf7d0' : 'var(--color-border)'};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                      <h4 style="margin: 0; font-size: 1.1rem; color: ${hasShopify ? '#166534' : 'var(--color-text-main)'};">Shopify Store</h4>
                      <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Pedidos e inventario automático.</p>
                    </div>
                 </div>
                 <div>
                    ${shopifyStatusText}
                 </div>
              </div>
              
              <form id="form-shopify-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de tu tienda Shopify</label>
                  <input type="text" id="shopify-url" class="form-input" placeholder="ej. mitienda.myshopify.com" value="${shopUrl}" ${hasShopify ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasShopify || isObserver ? '#f8fafc' : '#ffffff'};">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasShopify ? 'display:none;' : ''}">
                  <label class="form-label" style="font-weight: 600;">Access Token (Admin API)</label>
                  <input type="password" id="shopify-token" class="form-input" placeholder="shpat_xxxxxxxxxxxxx" ${hasShopify ? '' : 'required'} ${disabledAttr}>
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Debe comenzar con <strong>shpat_</strong>.</p>
                </div>
                
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${buttonHtml}
                </div>
              </form>
            </div>
          </div>
        </div>

        <!-- Right Column: Manual/Guide -->
        <div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: #f8fafc;">
            <div class="card-header" style="background-color: #f1f5f9; border-bottom: 1px solid #e2e8f0; padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: #0f172a; display: flex; align-items: center; gap: 0.5rem;">
                <span>🛍️</span> Guía de Integración Shopify
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: #334155; font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: #0f172a;">Crear Aplicación Personalizada:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem; line-height: 1.5;">En el panel de administración de tu tienda Shopify, ve a <em>Configuración &gt; Aplicaciones y canales de ventas &gt; Desarrollar aplicaciones</em>. Haz clic en el botón <strong>Crear una aplicación</strong> y asígnale un nombre (ej: WMS STOCKA).</p>
                </li>
                <li>
                  <strong style="color: #0f172a;">Configurar Alcances de la API (Scopes):</strong>
                  <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem; line-height: 1.5;">Haz clic en <strong>Configurar alcances de la API del panel de control</strong>. Deberás seleccionar los permisos de <strong>lectura y escritura</strong> (read and write) para las siguientes áreas:</p>
                  <ul style="margin: 0.5rem 0 0 0; padding-left: 1rem; color: #475569; font-size: 0.85rem;">
                     <li><em>Orders</em> (Pedidos)</li>
                     <li><em>Products</em> (Productos)</li>
                     <li><em>Inventory</em> (Inventario)</li>
                     <li><em>Locations</em> (Sucursales)</li>
                  </ul>
                </li>
                <li>
                  <strong style="color: #0f172a;">Instalar la Aplicación:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem; line-height: 1.5;">Una vez configurados los alcances, guarda los cambios y haz clic en el botón <strong>Instalar aplicación</strong> ubicado en la parte superior derecha.</p>
                </li>
                <li>
                  <strong style="color: #0f172a;">Obtener el Access Token:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem; line-height: 1.5;">Ve a la pestaña <strong>Credenciales de la API</strong> y revela el <em>Token de acceso de la API del panel de control</em> (este token empieza con <code>shpat_</code>). Cópialo y pégalo en el formulario de la izquierda junto con la URL de tu tienda.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    `;

    // Shopify Submit Listener
    if(!hasShopify) {
      document.getElementById('form-shopify-integration').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (userRole === 'observer') {
          alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
          return;
        }
        const btn = document.getElementById('btn-save-shopify');
        btn.disabled = true;
        btn.textContent = 'Conectando...';

        const shop_url = document.getElementById('shopify-url').value;
        const token = document.getElementById('shopify-token').value;

        try {
          const { error: insErr } = await supabase.from('merchant_integrations').insert([{
            merchant_id: merchantId,
            platform: 'Shopify',
            shop_url: shop_url,
            access_token: token,
            is_active: true
          }]);
          if(insErr) throw insErr;
          
          alert('Integración con Shopify guardada correctamente.');
          renderIntegrations(); // Recargar vista
        } catch(err) {
          console.error(err);
          alert('Error al guardar la integración: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Conectar Tienda Shopify';
        }
      });
    } else {
      document.getElementById('btn-disconnect-shopify').addEventListener('click', async () => {
        if (userRole === 'observer') {
          alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
          return;
        }
        if(confirm('¿Estás seguro que deseas desconectar tu tienda Shopify?')) {
          try {
            const { error: delErr } = await supabase.from('merchant_integrations')
              .delete()
              .eq('merchant_id', merchantId)
              .eq('platform', 'Shopify');
            if(delErr) throw delErr;
            alert('Tienda desconectada.');
            renderIntegrations();
          } catch(err) {
             console.error(err);
             alert('Error al desconectar: ' + err.message);
          }
        }
      });
    }

  } catch (error) {
    console.error('Error fetching integrations:', error);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar las integraciones.</p>`;
  }
}

  // ==========================================
  // Modal & Forms Logic
  // ==========================================

  // Handle opening modals dynamically from injected buttons
  document.addEventListener('click', async (e) => {
    // Abrir modal de nuevo producto
    if (e.target && e.target.id === 'btn-new-product') {
      if (userRole === 'observer') {
        alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
        return;
      }
      document.getElementById('modal-product').classList.add('active');
    }
    
    // Abrir modal de nuevo pedido
    if (e.target && e.target.id === 'btn-new-order') {
      if (userRole === 'observer') {
        alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
        return;
      }
      const modalOrder = document.getElementById('modal-order');
      const selectProd = document.getElementById('order-product');
      selectProd.innerHTML = '<option value="">Cargando productos...</option>';
      modalOrder.classList.add('active');

      // Cargar productos del usuario
      const { data: userAuth } = await supabase.auth.getUser();
      if(userAuth && userAuth.user) {
        const { data: products } = await supabase.from('products').select('id, name, sku').eq('merchant_id', userAuth.user.id);
        if(products) {
          selectProd.innerHTML = '<option value="">Selecciona un producto</option>';
          products.forEach(p => {
            selectProd.innerHTML += `<option value="${p.id}">${p.sku} - ${p.name}</option>`;
          });
        }
      }
    }

    // Cerrar modals
    if (e.target && e.target.closest('[data-close]')) {
      e.preventDefault();
      const modalId = e.target.closest('[data-close]').getAttribute('data-close');
      document.getElementById(modalId).classList.remove('active');
    }
  });

  // Guardar Nuevo Producto
  document.getElementById('form-new-product').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (userRole === 'observer') {
      alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
      return;
    }
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';

    const sku = document.getElementById('prod-sku').value;
    const name = document.getElementById('prod-name').value;
    const desc = document.getElementById('prod-desc').value;
    const stock = parseInt(document.getElementById('prod-stock').value, 10);

    try {
      const { data: userAuth } = await supabase.auth.getUser();
      const merchantId = userAuth.user.id;

      // 1. Crear el producto
      const { data: newProd, error: errProd } = await supabase
        .from('products')
        .insert([{ merchant_id: merchantId, sku: sku, name: name, description: desc }])
        .select()
        .single();
      
      if (errProd) throw errProd;

      // 2. Si el stock inicial > 0, asignar a Bodega Central
      if (stock > 0) {
        // Buscar la Bodega Central
        const { data: bodegaCentral } = await supabase
          .from('warehouses')
          .select('id')
          .ilike('name', '%Central%')
          .limit(1)
          .single();
        
        if (bodegaCentral) {
          await supabase.from('inventory').insert([{
            product_id: newProd.id,
            warehouse_id: bodegaCentral.id,
            quantity: stock
          }]);
          
          // Registrar movimiento inicial
          await supabase.from('movements').insert([{
            product_id: newProd.id,
            warehouse_id: bodegaCentral.id,
            type: 'in',
            quantity: stock,
            reference_doc: 'Stock Inicial'
          }]);
        }
      }

      alert('Producto creado exitosamente!');
      document.getElementById('modal-product').classList.remove('active');
      e.target.reset();
      renderInventory(); // Refrescar vista
    } catch (error) {
      console.error(error);
      alert('Error al crear producto: ' + error.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Guardar Producto';
    }
  });

  // Guardar Nuevo Pedido
  document.getElementById('form-new-order').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (userRole === 'observer') {
      alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
      return;
    }
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Procesando...';

    const prodId = document.getElementById('order-product').value;
    const qty = parseInt(document.getElementById('order-qty').value, 10);

    if(!prodId) {
      alert("Selecciona un producto");
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Confirmar Pedido';
      return;
    }

    try {
      const { data: userAuth } = await supabase.auth.getUser();
      const merchantId = userAuth.user.id;

      // Buscar bodega con mayor disponibilidad (Stock Físico - Comprometido)
      const { data: invData, error: errInv } = await supabase
        .from('inventory')
        .select('warehouse_id, quantity, committed_quantity')
        .eq('product_id', prodId);
        
      if(errInv) throw errInv;

      let bestWarehouse = null;
      let maxAvailable = -1;

      if(invData && invData.length > 0) {
        invData.forEach(inv => {
          const available = inv.quantity - inv.committed_quantity;
          if (available > maxAvailable) {
            maxAvailable = available;
            bestWarehouse = inv.warehouse_id;
          }
        });
      }

      if(!bestWarehouse || maxAvailable < qty) {
         // Si no hay suficiente, de todos modos creamos el pedido pero alertamos (o tomamos la que tenga algo)
         // Para este MVP, si no hay stock disponible total en una bodega, asignamos a la que tenga más, 
         // aunque el stock se vuelva negativo o quede "en espera" (sin stock).
         // Si bestWarehouse es null (porque recién se creó el producto con 0 stock y no hay inventory row), 
         // buscamos la bodega central por defecto.
         if(!bestWarehouse) {
            const { data: bodegaCentral } = await supabase.from('warehouses').select('id').ilike('name', '%Central%').limit(1).single();
            bestWarehouse = bodegaCentral.id;
         }
      }

      // 1. Crear el Pedido Padre
      const { data: newOrder, error: errOrder } = await supabase
        .from('orders')
        .insert([{ merchant_id: merchantId, status: 'para procesar' }])
        .select()
        .single();
      
      if(errOrder) throw errOrder;

      // 2. Crear Order Item (esto dispara el trigger de stock comprometido)
      const { error: errItem } = await supabase
        .from('order_items')
        .insert([{
          order_id: newOrder.id,
          product_id: prodId,
          warehouse_id: bestWarehouse,
          quantity: qty
        }]);

      if(errItem) throw errItem;

      alert('Pedido registrado con éxito');
      document.getElementById('modal-order').classList.remove('active');
      e.target.reset();
      renderOrders(); // Refrescar vista
    } catch (error) {
      console.error(error);
      alert('Error al crear pedido: ' + error.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Confirmar Pedido';
    }
  });

// ==========================================================================
// Shipments View Rendering & Logic (envios_unificados)
// ==========================================================================

async function renderShipments() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando despachos consolidados...</p>`;

  try {
    console.log('DEBUG: Cargando envíos consolidados filtrando por empresa:', currentCompany);
    
    let query = supabase
      .from('envios_unificados')
      .select('*')
      .eq('visible_to_client', true);

    if (currentCompany) {
      query = query.ilike('empresa_comercio_proveedor', currentCompany);
    }

    const { data: shipments, error } = await query;
    if (error) throw error;

    let allData = shipments || [];
    let filters = {
      search: '',
      status: '',
      courier: '',
      dateFrom: '',
      dateTo: ''
    };
    let sort = {
      field: 'created_at',
      asc: false
    };

    // Render basic page wrapper with KPI grid, filters layout, and table skeleton
    appContent.innerHTML = `
      <div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Resumen de Despachos</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          Visualiza y gestiona la información consolidada de todos tus envíos. Haz clic en un pedido para ver el detalle completo y el estado del tránsito.
        </p>
      </div>

      <!-- KPI Grid -->
      <div class="shipments-kpi-grid">
        <div class="shipments-kpi-card kpi-total">
          <div class="kpi-icon">📦</div>
          <div class="kpi-info">
            <span class="kpi-label">Total Envíos</span>
            <span class="kpi-value" id="kpi-total-val">0</span>
          </div>
        </div>
        <div class="shipments-kpi-card kpi-despachado">
          <div class="kpi-icon">🚚</div>
          <div class="kpi-info">
            <span class="kpi-label">Despachados</span>
            <span class="kpi-value" id="kpi-despachado-val">0</span>
          </div>
        </div>
        <div class="shipments-kpi-card kpi-sin-movimiento">
          <div class="kpi-icon">⏳</div>
          <div class="kpi-info">
            <span class="kpi-label">Sin Movimiento</span>
            <span class="kpi-value" id="kpi-sin-movimiento-val">0</span>
          </div>
        </div>
        <div class="shipments-kpi-card kpi-alerta">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-info">
            <span class="kpi-label">Alertas</span>
            <span class="kpi-value" id="kpi-alerta-val">0</span>
          </div>
        </div>
      </div>

      <!-- Shipments Tabs -->
      <div class="shipments-tabs" id="ship-status-tabs">
        <button class="shipment-tab active" data-status="">Todos los estados</button>
        <button class="shipment-tab" data-status="DESPACHADO">Despachado</button>
        <button class="shipment-tab" data-status="SIN MOVIMIENTO">Sin Movimiento</button>
        <button class="shipment-tab" data-status="ALERTA">Alerta</button>
      </div>

      <!-- Filters Panel -->
      <div class="shipments-filters-panel">
        <div class="filter-item filter-item-search">
          <label class="filter-label">Buscar</label>
          <input type="text" id="ship-search-input" class="filter-input" placeholder="Referencia, destinatario, tracking, comuna...">
        </div>
        <div class="filter-item">
          <label class="filter-label">Courier</label>
          <select id="ship-courier-select" class="filter-input">
            <option value="">Todos los couriers</option>
          </select>
        </div>
        <div class="filter-item">
          <label class="filter-label">Desde</label>
          <input type="date" id="ship-date-from" class="filter-input">
        </div>
        <div class="filter-item">
          <label class="filter-label">Hasta</label>
          <input type="date" id="ship-date-to" class="filter-input">
        </div>
        <button id="ship-btn-export" class="btn-filter-action btn-export" style="border:none;">
          <span>📥</span> Exportar Excel
        </button>
      </div>

      <!-- Table Card -->
      <div class="card" style="border: none; box-shadow: var(--shadow-md);">
        <div class="card-body" style="padding: 0; overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th class="sortable-header" data-sort="pedido_referencia">Referencia <span class="sort-indicator">⇅</span></th>
                <th class="sortable-header" data-sort="created_at" style="color: var(--color-accent);">Fecha <span class="sort-indicator">▼</span></th>
                <th class="sortable-header" data-sort="nombre_destinatario">Destinatario <span class="sort-indicator">⇅</span></th>
                <th class="sortable-header" data-sort="comuna_destino">Comuna <span class="sort-indicator">⇅</span></th>
                <th class="sortable-header" data-sort="courier">Courier <span class="sort-indicator">⇅</span></th>
                <th>Tracking</th>
                <th class="sortable-header" data-sort="global_status">Estado Global <span class="sort-indicator">⇅</span></th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody id="shipments-table-body">
              <!-- Injected by applyFiltersAndRenderTable -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Populate Courier Options dynamically from data
    const courierSelect = document.getElementById('ship-courier-select');
    const couriers = [...new Set(allData.map(s => s.courier).filter(Boolean))].sort();
    couriers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      courierSelect.appendChild(opt);
    });

    // Filtering, sorting and rendering implementation
    const applyFiltersAndRenderTable = () => {
      let filtered = allData.filter(s => {
        // 1. Text search filter
        if (filters.search) {
          const query = filters.search.toLowerCase();
          const ref = (s.pedido_referencia || '').toLowerCase();
          const dest = (s.nombre_destinatario || '').toLowerCase();
          const tracking = (s.tracking || '').toLowerCase();
          const courier = (s.courier || '').toLowerCase();
          const commune = (s.comuna_destino || '').toLowerCase();
          const dir = (s.direccion_destino || '').toLowerCase();
          
          if (!ref.includes(query) && 
              !dest.includes(query) && 
              !tracking.includes(query) && 
              !courier.includes(query) && 
              !commune.includes(query) && 
              !dir.includes(query)) {
            return false;
          }
        }

        // 2. Global status filter
        if (filters.status && s.global_status !== filters.status) {
          return false;
        }

        // 3. Courier filter
        if (filters.courier && s.courier !== filters.courier) {
          return false;
        }

        // 4. Date range filter
        if (s.created_at) {
          const itemDate = new Date(s.created_at);
          if (filters.dateFrom) {
            const fromDate = new Date(filters.dateFrom + 'T00:00:00');
            if (itemDate < fromDate) return false;
          }
          if (filters.dateTo) {
            const toDate = new Date(filters.dateTo + 'T23:59:59');
            if (itemDate > toDate) return false;
          }
        } else if (filters.dateFrom || filters.dateTo) {
          return false;
        }

        return true;
      });

      // Sort dataset in-memory
      filtered.sort((a, b) => {
        let valA = a[sort.field] || '';
        let valB = b[sort.field] || '';

        if (sort.field === 'created_at') {
          valA = valA ? new Date(valA).getTime() : 0;
          valB = valB ? new Date(valB).getTime() : 0;
        } else {
          valA = valA.toString().toLowerCase();
          valB = valB.toString().toLowerCase();
        }

        if (valA < valB) return sort.asc ? -1 : 1;
        if (valA > valB) return sort.asc ? 1 : -1;
        return 0;
      });

      // Update Top KPIs
      const totalCount = allData.length;
      const totalDespachado = allData.filter(s => s.global_status === 'DESPACHADO').length;
      const totalSinMov = allData.filter(s => s.global_status === 'SIN MOVIMIENTO').length;
      const totalAlerta = allData.filter(s => s.global_status === 'ALERTA').length;

      document.getElementById('kpi-total-val').textContent = totalCount;
      document.getElementById('kpi-despachado-val').textContent = totalDespachado;
      document.getElementById('kpi-sin-movimiento-val').textContent = totalSinMov;
      document.getElementById('kpi-alerta-val').textContent = totalAlerta;

      // Render Table Rows
      const tbody = document.getElementById('shipments-table-body');
      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">No se encontraron despachos con los filtros aplicados.</td></tr>`;
        return;
      }

      let rowsHtml = '';
      filtered.forEach(s => {
        const dateObj = s.created_at ? new Date(s.created_at) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '-';
        
        let badgeBg = '#f3f4f6';
        let badgeColor = '#374151';
        if (s.global_status === 'DESPACHADO') {
          badgeBg = '#d1fae5';
          badgeColor = '#065f46';
        } else if (s.global_status === 'SIN MOVIMIENTO') {
          badgeBg = '#fef3c7';
          badgeColor = '#92400e';
        } else if (s.global_status === 'ALERTA') {
          badgeBg = '#fee2e2';
          badgeColor = '#991b1b';
        }

        const platformBadge = s.source_table === 'lightdata_envios' ? 'LightData' 
          : s.source_table === 'enviame_shipments' ? 'Enviame' : 'Optiroute';
        
        const platformColor = s.source_table === 'lightdata_envios' ? '#3b82f6'
          : s.source_table === 'enviame_shipments' ? '#10b981' : '#8b5cf6';

        const trackingDisplay = s.tracking
          ? (s.tracking_url && s.tracking_url !== 'N/A'
              ? `<a href="${s.tracking_url}" target="_blank" onclick="event.stopPropagation();" style="font-weight:600; display:inline-flex; align-items:center; gap:0.25rem;">🔗 ${s.tracking}</a>`
              : s.tracking)
          : '-';

        rowsHtml += `
          <tr class="clickable-row" data-id="${s.id}">
            <td><strong>${s.pedido_referencia || '-'}</strong></td>
            <td style="font-weight: 500;">${dateStr}</td>
            <td>
              <div style="font-weight:600;">${s.nombre_destinatario || '-'}</div>
              <div style="font-size:0.75rem; color:var(--color-text-muted);">${s.telefono_destino || ''}</div>
            </td>
            <td>${s.comuna_destino || '-'}</td>
            <td><span style="font-weight:500;">${s.courier || '-'}</span></td>
            <td>${trackingDisplay}</td>
            <td>
              <span class="badge" style="background-color: ${badgeBg}; color: ${badgeColor}; padding: 0.25rem 0.5rem; text-transform: capitalize;">
                ${s.global_status ? s.global_status.toLowerCase() : 'desconocido'}
              </span>
            </td>
            <td>
              <span style="background-color: ${platformColor}15; color: ${platformColor}; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                ${platformBadge}
              </span>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = rowsHtml;

      // Event listeners for details modal
      tbody.querySelectorAll('.clickable-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.getAttribute('data-id');
          const shipment = allData.find(x => x.id === id);
          if (shipment) {
            showShipmentDetailsModal(shipment);
          }
        });
      });
    };

    // Bind filters event listeners
    document.getElementById('ship-search-input').addEventListener('input', (e) => {
      filters.search = e.target.value;
      applyFiltersAndRenderTable();
    });

    const statusTabs = document.querySelectorAll('#ship-status-tabs .shipment-tab');
    statusTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        statusTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        filters.status = e.target.getAttribute('data-status');
        applyFiltersAndRenderTable();
      });
    });

    document.getElementById('ship-courier-select').addEventListener('change', (e) => {
      filters.courier = e.target.value;
      applyFiltersAndRenderTable();
    });

    document.getElementById('ship-date-from').addEventListener('change', (e) => {
      filters.dateFrom = e.target.value;
      applyFiltersAndRenderTable();
    });

    document.getElementById('ship-date-to').addEventListener('change', (e) => {
      filters.dateTo = e.target.value;
      applyFiltersAndRenderTable();
    });

    // Excel Export CSV logic
    document.getElementById('ship-btn-export').addEventListener('click', () => {
      let filtered = allData.filter(s => {
        if (filters.search) {
          const query = filters.search.toLowerCase();
          const ref = (s.pedido_referencia || '').toLowerCase();
          const dest = (s.nombre_destinatario || '').toLowerCase();
          const tracking = (s.tracking || '').toLowerCase();
          const courier = (s.courier || '').toLowerCase();
          const commune = (s.comuna_destino || '').toLowerCase();
          const dir = (s.direccion_destino || '').toLowerCase();
          if (!ref.includes(query) && !dest.includes(query) && !tracking.includes(query) && !courier.includes(query) && !commune.includes(query) && !dir.includes(query)) return false;
        }
        if (filters.status && s.global_status !== filters.status) return false;
        if (filters.courier && s.courier !== filters.courier) return false;
        if (s.created_at) {
          const itemDate = new Date(s.created_at);
          if (filters.dateFrom) {
            const fromDate = new Date(filters.dateFrom + 'T00:00:00');
            if (itemDate < fromDate) return false;
          }
          if (filters.dateTo) {
            const toDate = new Date(filters.dateTo + 'T23:59:59');
            if (itemDate > toDate) return false;
          }
        } else if (filters.dateFrom || filters.dateTo) {
          return false;
        }
        return true;
      });

      // Headers and data mapping
      const headers = ['Referencia Pedido', 'Origen Logistica', 'Courier', 'Tracking', 'Destinatario', 'Direccion', 'Comuna', 'Estado Global', 'Estado Original', 'Fecha Creacion'];
      const rows = filtered.map(s => {
        const platformName = s.source_table === 'lightdata_envios' ? 'LightData' : s.source_table === 'enviame_shipments' ? 'Enviame' : 'Optiroute';
        const dateStr = s.created_at ? new Date(s.created_at).toLocaleString() : '-';
        return [
          s.pedido_referencia || '',
          platformName,
          s.courier || '',
          s.tracking || '',
          s.nombre_destinatario || '',
          `${s.direccion_destino || ''} ${s.complemento_destino || ''}`,
          s.comuna_destino || '',
          s.global_status || '',
          s.status || '',
          dateStr
        ];
      });

      // Built UTF-8 CSV with BOM for Excel Spanish compatibility
      const csvContent = "\ufeff" + [headers.join(','), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `despachos_stocka_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    // Sorting headers listeners
    const sortHeaders = appContent.querySelectorAll('.sortable-header');
    sortHeaders.forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort');
        if (sort.field === field) {
          sort.asc = !sort.asc;
        } else {
          sort.field = field;
          sort.asc = true;
        }

        // Update indicators
        sortHeaders.forEach(h => {
          const indicator = h.querySelector('.sort-indicator');
          if (h.getAttribute('data-sort') === sort.field) {
            indicator.textContent = sort.asc ? '▲' : '▼';
            h.style.color = 'var(--color-accent)';
          } else {
            indicator.textContent = '⇅';
            h.style.color = 'var(--color-text-muted)';
          }
        });

        applyFiltersAndRenderTable();
      });
    });

    // Initial table render
    applyFiltersAndRenderTable();

  } catch (err) {
    console.error('Error rendering shipments:', err);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar los despachos: ${err.message}</p>`;
  }
}

function showShipmentDetailsModal(shipment) {
  let modal = document.getElementById('modal-shipment-detail');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'modal-shipment-detail';
  modal.className = 'slide-over-overlay';
  
  // Animar entrada del overlay y panel
  setTimeout(() => {
    modal.classList.add('active');
  }, 10);
  
  const dateObj = shipment.created_at ? new Date(shipment.created_at) : null;
  const dateStr = dateObj ? dateObj.toLocaleString() : '-';
  const updatedObj = shipment.updated_at ? new Date(shipment.updated_at) : null;
  const updatedStr = updatedObj ? updatedObj.toLocaleString() : '-';

  const platformBadge = shipment.source_table === 'lightdata_envios' ? 'LightData' 
    : shipment.source_table === 'enviame_shipments' ? 'Enviame' : 'Optiroute';

  // Calculate timeline stepper progress
  let step1Class = 'completed';
  let step2Class = '';
  let step3Class = '';
  let progressBarWidth = '0%';

  const gs = shipment.global_status;
  const rawStatus = (shipment.status || '').toLowerCase();

  const isDelivered = (gs === 'DESPACHADO') && (
    rawStatus.includes('entregado') || 
    rawStatus.includes('delivered') || 
    rawStatus.includes('nadie') || 
    rawStatus.includes('exito')
  );

  if (gs === 'DESPACHADO') {
    step2Class = 'completed';
    progressBarWidth = '50%';
    if (isDelivered) {
      step3Class = 'completed';
      progressBarWidth = '100%';
    } else {
      step2Class = 'active'; // Transit state
    }
  } else if (gs === 'SIN MOVIMIENTO') {
    step1Class = 'active';
    progressBarWidth = '0%';
  } else if (gs === 'ALERTA') {
    step2Class = 'warning';
    progressBarWidth = '50%';
  }

  // Stepper timeline
  const stepperHtml = `
    <div class="timeline-stepper">
      <div class="timeline-progress-bar" style="width: ${progressBarWidth};"></div>
      <div class="timeline-step ${step1Class}">
        <div class="timeline-bubble">1</div>
        <div class="timeline-label">Creado</div>
      </div>
      <div class="timeline-step ${step2Class}">
        <div class="timeline-bubble">${gs === 'ALERTA' ? '⚠️' : '2'}</div>
        <div class="timeline-label">${gs === 'ALERTA' ? 'Incidencia' : 'En Tránsito'}</div>
      </div>
      <div class="timeline-step ${step3Class}">
        <div class="timeline-bubble">3</div>
        <div class="timeline-label">Entregado</div>
      </div>
    </div>
  `;

  // Tracking button HTML
  const hasTracking = shipment.tracking_url && shipment.tracking_url !== 'N/A';
  const trackingBtnHtml = hasTracking
    ? `<a href="${shipment.tracking_url}" target="_blank" class="btn btn-complementary" style="margin-right: auto;">🔗 Seguimiento de Pedido</a>`
    : ``;

  modal.innerHTML = `
    <div class="slide-over-panel">
      <div class="slide-over-header">
        <h3>Detalle de Despacho</h3>
        <button class="slide-over-close" id="btn-close-shipment-modal">&times;</button>
      </div>
      
      <div class="slide-over-body">
        
        <!-- Graphic Tracking Progress Timeline -->
        ${stepperHtml}

        <div class="shipment-detail-grid" style="display: flex; flex-direction: column; gap: 2rem;">
          
          <!-- Left Column: Logistics Info and Destination Info -->
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            
            <!-- Logistics section -->
            <div class="shipment-detail-section">
              <h4 class="shipment-detail-title">Información de Logística</h4>
              <div class="detail-info-row">
                <span class="detail-info-label">Proveedor de Integración:</span>
                <span class="detail-info-value" style="background-color:var(--color-border); padding:0.1rem 0.4rem; border-radius:4px; font-size:0.75rem; font-weight:600;">${platformBadge}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Courier de Envío:</span>
                <span class="detail-info-value" style="font-weight:700;">${shipment.courier || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Referencia Pedido:</span>
                <span class="detail-info-value" style="font-weight:700;">${shipment.pedido_referencia || 'Sin Referencia'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Código de Tracking:</span>
                <span class="detail-info-value">
                  ${shipment.tracking 
                    ? (shipment.tracking_url && shipment.tracking_url !== 'N/A'
                        ? `<a href="${shipment.tracking_url}" target="_blank" style="font-weight:700; color:var(--color-accent);">🔗 ${shipment.tracking}</a>`
                        : `<span style="font-weight:700;">${shipment.tracking}</span>`)
                    : '-'}
                </span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Tipo de Servicio:</span>
                <span class="detail-info-value">${shipment.servicio_tipo_envio || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Estado Logístico Original:</span>
                <span class="detail-info-value" style="text-transform: capitalize; color: var(--color-accent); font-weight:600;">${shipment.status || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Ingresado al Sistema:</span>
                <span class="detail-info-value" style="font-size:0.8rem;">${dateStr}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Última Actualización:</span>
                <span class="detail-info-value" style="font-size:0.8rem;">${updatedStr}</span>
              </div>
            </div>

            <!-- Destination section -->
            <div class="shipment-detail-section">
              <h4 class="shipment-detail-title">Información del Cliente / Entrega</h4>
              <div class="detail-info-row">
                <span class="detail-info-label">Destinatario:</span>
                <span class="detail-info-value" style="font-weight:700;">${shipment.nombre_destinatario || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Dirección de Despacho:</span>
                <span class="detail-info-value">${shipment.direccion_destino || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Depto / Ofic / Casa:</span>
                <span class="detail-info-value">${shipment.complemento_destino || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Comuna / Región:</span>
                <span class="detail-info-value" style="font-weight:700;">${shipment.comuna_destino || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Teléfono móvil:</span>
                <span class="detail-info-value">${shipment.telefono_destino || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Correo electrónico:</span>
                <span class="detail-info-value">${shipment.email_cliente_destino || '-'}</span>
              </div>
            </div>

          </div>

          <!-- Right Column: Associated WMS Order Items -->
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <div class="shipment-detail-section" style="height: 100%; display: flex; flex-direction: column;">
              <h4 class="shipment-detail-title">Productos en la Orden de Venta</h4>
              <div id="order-details-loading" style="text-align: center; padding: 3rem 1rem; color: var(--color-text-muted); font-size:0.875rem; flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column;">
                <div style="margin-bottom:0.5rem; font-size:1.5rem;">🔄</div>
                Buscando orden de venta en WMS...
              </div>
              <div id="order-details-content" style="display: none; flex:1;">
                <!-- Dynamically filled by fetchAndRenderAssociatedOrder -->
              </div>
            </div>
          </div>
        </div>

      </div>
      
      <div class="slide-over-footer">
        ${trackingBtnHtml}
        <button class="btn btn-outline" id="btn-close-shipment-footer">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  const closeModal = () => {
    modal.classList.remove('active');
    setTimeout(() => {
      modal.remove();
    }, 400); // Wait for CSS transition
  };

  document.getElementById('btn-close-shipment-modal').addEventListener('click', closeModal);
  document.getElementById('btn-close-shipment-footer').addEventListener('click', closeModal);

  // Cierra al hacer clic en el overlay difuminado
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Load WMS orders mapping asynchronously
  fetchAndRenderAssociatedOrder(shipment.pedido_referencia);
}

async function fetchAndRenderAssociatedOrder(pedidoRef) {
  const loadingEl = document.getElementById('order-details-loading');
  const contentEl = document.getElementById('order-details-content');
  
  if (!pedidoRef) {
    loadingEl.innerHTML = `
      <span style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;">🔎</span>
      No existe una referencia de pedido válida vinculada a este despacho.
    `;
    return;
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedidoRef);
    let query = supabase
      .from('orders')
      .select(`
        id,
        status,
        created_at,
        order_items (
          quantity,
          products (sku, name)
        )
      `);

    if (isUuid) {
      query = query.or(`external_order_number.eq."${pedidoRef}",id.eq."${pedidoRef}"`);
    } else {
      query = query.eq('external_order_number', pedidoRef);
    }

    const { data: orders, error } = await query;

    if (error) throw error;

    if (!orders || orders.length === 0) {
      loadingEl.innerHTML = `
        <span style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;">🔍</span>
        Este despacho no está asociado a una Orden de Venta local de WMS STOCKA.
        <br><br>
        <span style="font-size: 0.75rem; display: block; font-weight: normal; color: var(--color-text-muted); line-height: 1.4;">
          El envío fue consolidado directamente desde las plataformas logísticas externas (LightData, Enviame o Optiroute).
        </span>
      `;
      return;
    }

    const order = orders[0];
    const items = order.order_items || [];
    
    let itemsHtml = '';
    if (items.length === 0) {
      itemsHtml = '<p style="color: var(--color-text-muted); font-size: 0.85rem; padding:1rem; text-align:center;">No hay productos registrados en este pedido.</p>';
    } else {
      itemsHtml = `
        <div style="max-height: 250px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
          <table class="data-table" style="width: 100%; font-size: 0.8rem; margin:0;">
            <thead>
              <tr style="background-color: var(--color-bg);">
                <th style="padding: 0.5rem 0.75rem; font-size:0.7rem;">SKU / Producto</th>
                <th style="padding: 0.5rem 0.75rem; text-align: center; width:60px; font-size:0.7rem;">Cant</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr>
                  <td style="padding: 0.5rem 0.75rem;">
                    <span style="font-weight: 700; display: block; color: var(--color-dark);">${item.products ? item.products.sku : '-'}</span>
                    <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.products ? item.products.name : 'Desconocido'}</span>
                  </td>
                  <td style="padding: 0.5rem 0.75rem; text-align: center; font-weight: 700; color: var(--color-accent); font-size:0.875rem;">${item.quantity}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    const orderDateStr = order.created_at ? new Date(order.created_at).toLocaleDateString() : '-';

    contentEl.innerHTML = `
      <div style="background-color: var(--color-bg); padding: 1rem; border-radius: var(--radius-md); border:1px solid var(--color-border); margin-bottom: 1.25rem; font-size: 0.825rem;">
        <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
          <span style="color: var(--color-text-muted); font-weight:500;">ID de Pedido:</span>
          <span style="font-weight:700; color: var(--color-dark);">${order.id.split('-')[0]}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
          <span style="color: var(--color-text-muted); font-weight:500;">Fecha de Creación:</span>
          <span style="font-weight:600;">${orderDateStr}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color: var(--color-text-muted); font-weight:500;">Estado del WMS:</span>
          <span style="background-color: #d1fae5; color: #065f46; padding: 0.2rem 0.5rem; border-radius: 99px; font-size: 0.7rem; font-weight:700; text-transform:capitalize;">
            ${order.status}
          </span>
        </div>
      </div>
      
      <div>
        <h5 style="font-size: 0.75rem; font-weight: 700; margin-bottom: 0.5rem; text-transform: uppercase; color: var(--color-text-muted); letter-spacing:0.02em;">Artículos Solicitados</h5>
        ${itemsHtml}
      </div>
    `;

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

  } catch (err) {
    console.error('Error fetching associated order details:', err);
    loadingEl.innerHTML = `
      <span style="color: red; font-size: 1.5rem; display: block; margin-bottom: 0.5rem;">⚠️</span>
      Error al cargar los detalles del pedido asociado en la base de datos.
    `;
  }
}

// ==========================================
// Observer & Profile Functions
// ==========================================

function getObserverBanner() {
  if (userRole === 'observer') {
    return `
      <div class="observer-banner" style="background-color: #fef3c7; color: #d97706; padding: 0.75rem 1rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; font-weight: 500; display: flex; align-items: center; gap: 0.5rem; border: 1px solid #fde68a; font-size: 0.9rem;">
        <span>⚠️</span> <strong>Modo Observador:</strong> Tienes acceso de solo lectura. No puedes realizar acciones, crear pedidos/productos ni modificar integraciones.
      </div>
    `;
  }
  return '';
}

async function renderProfile() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando perfil...</p>`;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("No se pudo obtener el usuario autenticado.");

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) throw error;

    // Valores por defecto
    const fullName = profile.full_name || '';
    const companyName = profile.company_name || '';
    const phone = profile.phone || '';
    const contactEmail = profile.contact_email || '';
    const avatarUrl = profile.avatar_url || '';
    const assignedComercios = profile.comercio || 'no asignado';
    const roleText = profile.role === 'admin' ? 'Administrador' : (profile.role === 'client' ? 'Cliente' : 'Observador');

    appContent.innerHTML = `
      <div style="max-width: 700px; margin: 0 auto;">
        ${getObserverBanner()}
        <div class="card" style="border: none; box-shadow: var(--shadow-md);">
          <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem; display: flex; align-items: center; gap: 1.5rem;">
            <div id="profile-avatar-preview" style="width: 80px; height: 80px; border-radius: var(--radius-full); background-color: var(--color-gray); background-image: url('${avatarUrl || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}'); background-size: cover; background-position: center; border: 3px solid var(--color-primary); box-shadow: var(--shadow-sm);"></div>
            <div>
              <h3 style="margin: 0; font-size: 1.35rem;">${fullName || 'Mi Perfil'}</h3>
              <p style="margin: 0; font-size: 0.9rem; color: var(--color-text-muted);">${roleText} - ${companyName}</p>
            </div>
          </div>
          
          <form id="form-edit-profile" class="card-body" style="padding: 1.5rem;">
            <div id="profile-alert-container"></div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <div class="form-group" style="margin-bottom: 1rem;">
                <label class="form-label" style="font-weight: 600;">Nombre Completo</label>
                <input type="text" id="profile-name" class="form-input" value="${fullName}" placeholder="Tu nombre" required>
              </div>
              <div class="form-group" style="margin-bottom: 1rem;">
                <label class="form-label" style="font-weight: 600;">Empresa</label>
                <input type="text" class="form-input" value="${companyName}" disabled style="background-color: #f1f5f9; cursor: not-allowed;">
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <div class="form-group" style="margin-bottom: 1rem;">
                <label class="form-label" style="font-weight: 600;">Teléfono de Contacto</label>
                <input type="text" id="profile-phone" class="form-input" value="${phone}" placeholder="Ej. +56912345678">
              </div>
              <div class="form-group" style="margin-bottom: 1rem;">
                <label class="form-label" style="font-weight: 600;">Correo de Contacto</label>
                <input type="email" id="profile-contact-email" class="form-input" value="${contactEmail}" placeholder="correo@ejemplo.com">
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 600;">URL Imagen de Perfil</label>
              <input type="url" id="profile-avatar-url" class="form-input" value="${avatarUrl}" placeholder="https://ejemplo.com/mi-avatar.jpg">
            </div>

            <div style="background-color: var(--color-bg); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin: 1.5rem 0;">
              <h4 style="font-size: 0.9rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-dark); text-transform: uppercase;">Atributos Asignados por Administrador</h4>
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.85rem;">
                <span style="color: var(--color-text-muted);">Rol del Sistema:</span>
                <strong style="color: var(--color-accent);">${roleText}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                <span style="color: var(--color-text-muted);">Comercios Asociados:</span>
                <strong style="color: var(--color-primary); text-align: right; max-width: 60%; word-break: break-all;">${assignedComercios}</strong>
              </div>
            </div>

            <div style="text-align: right;">
              <button type="submit" class="btn btn-primary" id="btn-save-profile" style="background-color: var(--color-accent); color: white;">Guardar Cambios</button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Manejar envío del formulario de perfil
    document.getElementById('form-edit-profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const newName = document.getElementById('profile-name').value.trim();
      const newPhone = document.getElementById('profile-phone').value.trim();
      const newContactEmail = document.getElementById('profile-contact-email').value.trim();
      const newAvatarUrl = document.getElementById('profile-avatar-url').value.trim();
      const alertContainer = document.getElementById('profile-alert-container');
      const saveBtn = document.getElementById('btn-save-profile');

      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';

      try {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            full_name: newName,
            phone: newPhone,
            contact_email: newContactEmail,
            avatar_url: newAvatarUrl
          })
          .eq('id', user.id);

        if (updateError) throw updateError;

        // Actualizar vista previa del avatar
        const avatarPreview = document.getElementById('profile-avatar-preview');
        if (avatarPreview) {
          avatarPreview.style.backgroundImage = `url('${newAvatarUrl || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}')`;
        }

        // Actualizar saludo en el header
        const userEmailSpan = document.getElementById('user-email');
        if (userEmailSpan) {
          userEmailSpan.textContent = newName || user.email;
        }

        alertContainer.innerHTML = `<div class="alert alert-success" style="display: block;">¡Perfil actualizado con éxito!</div>`;
        setTimeout(() => {
          alertContainer.innerHTML = '';
        }, 4000);

      } catch (err) {
        console.error("Error al actualizar perfil:", err);
        alertContainer.innerHTML = `<div class="alert alert-error" style="display: block;">Error al actualizar perfil: ${err.message}</div>`;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Cambios';
      }
    });

  } catch (err) {
    console.error("Error rendering profile view:", err);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar perfil: ${err.message}</p>`;
  }
}
