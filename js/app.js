import supabase from './supabase.js';

console.log('DEBUG: Iniciando js/app.js...');

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

    // Verificar rol
    console.log('DEBUG: Consultando perfil en la base de datos para ID:', session.user.id);
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (profileError) {
      console.warn('DEBUG: Error al obtener perfil (puede que no exista en la tabla profiles):', profileError);
    } else {
      console.log('DEBUG: Perfil encontrado:', profile);
    }

    if (profile && profile.role === 'admin') {
      console.log('DEBUG: Rol es admin. Redirigiendo a admin.html...');
      window.location.href = 'admin.html';
      return;
    }

    // Set user info
    const user = session.user;
    if (userEmailSpan) {
      userEmailSpan.textContent = user.email;
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
          console.log('DEBUG: Navegando a vista:', view);
          
          if (view === 'inventory') {
            viewTitle.textContent = 'Inventario';
            renderInventory();
          } else if (view === 'orders') {
            viewTitle.textContent = 'Pedidos';
            renderOrders();
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
        products (sku, name),
        warehouses (name)
      `);

    if (error) throw error;

    if (!inventory || inventory.length === 0) {
      appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay inventario registrado.</p>`;
      return;
    }

    let rowsHtml = '';
    inventory.forEach(item => {
      let badge = '';
      const available = item.quantity - item.committed_quantity;
      if (available > 50) badge = '<span class="badge badge-success">En Stock</span>';
      else if (available > 0) badge = '<span class="badge badge-warning">Bajo Stock</span>';
      else badge = '<span class="badge badge-danger">Agotado</span>';

      rowsHtml += `
        <tr>
          <td>${item.products.sku}</td>
          <td>${item.products.name}</td>
          <td>${item.warehouses.name}</td>
          <td><strong>${item.quantity}</strong></td>
          <td style="color: var(--color-accent); font-weight: 500;">${item.committed_quantity}</td>
          <td style="color: var(--color-primary); font-weight: 600;">${available}</td>
          <td>${badge}</td>
        </tr>
      `;
    });

    appContent.innerHTML = `
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <h3>Stock Actual</h3>
          <button class="btn btn-primary" id="btn-new-product">Nuevo Producto</button>
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
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar el inventario.</p>`;
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
        products (sku),
        warehouses (name)
      `)
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
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Obtener los despachos correspondientes de la tabla enviame_shipments
    let shipments = [];
    if (orders && orders.length > 0) {
      const orderRefs = orders.map(o => o.external_order_number).filter(Boolean);
      const orderIds = orders.map(o => o.id);
      const allRefs = [...orderRefs, ...orderIds];

      const { data: shipData, error: shipError } = await supabase
        .from('enviame_shipments')
        .select('*')
        .in('order_id', allRefs);

      if (!shipError && shipData) {
        shipments = shipData;
      }
    }

    let rowsHtml = '';
    if (!orders || orders.length === 0) {
      rowsHtml = `<tr><td colspan="6" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay pedidos registrados.</td></tr>`;
    } else {
      orders.forEach(order => {
        const dateObj = new Date(order.created_at);
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

        // Buscar el envío en el listado cargado
        const orderShipments = shipments.filter(s => 
          s.order_id === order.id || 
          (order.external_order_number && s.order_id === order.external_order_number)
        );

        if (orderShipments.length > 0) {
          const shipment = orderShipments[0]; // Tomar el primer despacho
          if (shipment.tracking_number) {
            const courierName = shipment.courier || 'Seguimiento';
            trackingHtml = shipment.tracking_url && shipment.tracking_url !== 'N/A'
              ? `<a href="${shipment.tracking_url}" target="_blank" style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:500;">🚚 ${courierName}: ${shipment.tracking_number}</a>`
              : `<span style="display:inline-flex; align-items:center; gap:0.25rem; color: var(--color-text-main);">🚚 ${courierName}: ${shipment.tracking_number}</span>`;
          }
          if (shipment.label_url && shipment.label_url !== 'N/A') {
            labelHtml = `<a href="${shipment.label_url}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; border-color: var(--color-accent); color: var(--color-accent); display: inline-flex; gap: 0.25rem; align-items: center; border-radius: 4px;">📄 PDF</a>`;
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

    appContent.innerHTML = `
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <h3>Mis Pedidos</h3>
          <button class="btn btn-primary" id="btn-new-order">Crear Pedido</button>
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

    appContent.innerHTML = `
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
                  <input type="text" id="shopify-url" class="form-input" placeholder="ej. mitienda.myshopify.com" value="${shopUrl}" ${hasShopify ? 'readonly' : 'required'} style="background-color: ${hasShopify ? '#f8fafc' : '#ffffff'};">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasShopify ? 'display:none;' : ''}">
                  <label class="form-label" style="font-weight: 600;">Access Token (Admin API)</label>
                  <input type="password" id="shopify-token" class="form-input" placeholder="shpat_xxxxxxxxxxxxx" ${hasShopify ? '' : 'required'}>
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Debe comenzar con <strong>shpat_</strong>.</p>
                </div>
                
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${!hasShopify ? 
                    '<button type="submit" class="btn btn-primary" id="btn-save-shopify" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Tienda Shopify</button>' : 
                    '<button type="button" class="btn btn-outline" id="btn-disconnect-shopify" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar Shopify</button>'
                  }
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
      document.getElementById('modal-product').classList.add('active');
    }
    
    // Abrir modal de nuevo pedido
    if (e.target && e.target.id === 'btn-new-order') {
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
