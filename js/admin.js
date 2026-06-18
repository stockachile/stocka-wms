import supabase from './supabase.js';

// Capturador de errores global para depuración en tiempo real
window.onerror = function (message, source, lineno, colno, error) {
  alert(`Error detectado en admin.js:\n${message}\n\nArchivo: ${source}\nLínea: ${lineno}:${colno}`);
  return false;
};
window.onunhandledrejection = function (event) {
  alert(`Error de Promesa no manejada en admin.js:\n${event.reason}`);
};

console.log('DEBUG: Iniciando js/admin.js...');

async function init() {
  console.log('DEBUG: Ejecutando función init()...');
  const userEmailSpan = document.getElementById('user-email');
  const logoutBtn = document.getElementById('logout-btn');
  const viewTitle = document.getElementById('view-title');
  const navItems = document.querySelectorAll('.nav-item');

  try {
    // Verify authentication & Admin Role
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

    console.log('DEBUG: Consultando perfil de administrador para ID:', session.user.id);
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, company_name, full_name, allowed_modules')
      .eq('id', session.user.id)
      .single();
    
    if (profileError) {
      console.warn('DEBUG: Error al obtener perfil:', profileError);
    } else {
      console.log('DEBUG: Perfil encontrado:', profile);
    }
    
    if (!profile || profile.role !== 'admin') {
      console.warn('DEBUG: Acceso denegado, no es administrador. Redirigiendo...');
      alert("Acceso denegado. Se requieren permisos de Administrador.");
      window.location.href = 'dashboard.html';
      return;
    }

    // Set user info
    const user = session.user;
    if (userEmailSpan) {
      const displayName = profile?.full_name || user.user_metadata?.full_name || profile?.company_name || user.email;
      userEmailSpan.textContent = `${displayName} (ADMIN)`;
    }

    // Navigation and Filtering
    if (navItems) {
      navItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          navItems.forEach(n => n.classList.remove('active'));
          e.target.classList.add('active');

          const view = e.target.getAttribute('data-view');
          console.log('DEBUG: Navegando a vista administrador:', view);
          
          if (view === 'orders_admin') {
            viewTitle.textContent = 'Gestor de Pedidos';
            renderAdminOrders();
          } else if (view === 'consolidated_shipments') {
            viewTitle.textContent = 'Envíos Consolidados';
            renderConsolidatedShipments();
          } else if (view === 'reassign_admin') {
            viewTitle.textContent = 'Reubicar Stock';
            renderReassignStock();
          } else if (view === 'manual_in_admin') {
            viewTitle.textContent = 'Ingreso Manual';
            renderManualIn();
          } else if (view === 'users_admin') {
            viewTitle.textContent = 'Gestionar Usuarios';
            renderUsersAdmin();
          } else if (view === 'integrations') {
            viewTitle.textContent = 'Integraciones';
            renderIntegrations();
          }
        });
      });
    }

    // Filter Navigation based on allowed_modules for Admin
    const allowedModulesStr = profile?.allowed_modules || 'all';
    let allowedModules = [];
    let firstVisibleItem = null;

    if (navItems) {
      if (allowedModulesStr !== 'all' && allowedModulesStr !== null && allowedModulesStr !== '') {
        allowedModules = allowedModulesStr.split(',').map(m => m.trim());
        
        navItems.forEach(item => {
          const view = item.getAttribute('data-view');
          if (allowedModules.includes(view)) {
            const parentLi = item.closest('li');
            if (parentLi) parentLi.style.display = 'block';
            else item.style.display = 'block';
            if (!firstVisibleItem) firstVisibleItem = item;
          } else {
            const parentLi = item.closest('li');
            if (parentLi) parentLi.style.display = 'none';
            else item.style.display = 'none';
          }
        });
      } else {
        // Por defecto, si es 'all' todos los ítems de navegación están permitidos
        if (navItems.length > 0) firstVisibleItem = navItems[0];
      }
    }

    // Initial View selection based on allowed modules
    if (firstVisibleItem) {
      const defaultView = 'orders_admin';
      const isDefaultAllowed = (allowedModulesStr === 'all' || allowedModules.includes(defaultView));
      
      if (isDefaultAllowed) {
        viewTitle.textContent = 'Gestor de Pedidos';
        console.log('DEBUG: Renderizando vista de pedidos de administrador...');
        renderAdminOrders();
      } else {
        console.log('DEBUG: Vista por defecto restringida, seleccionando primer módulo permitido:', firstVisibleItem.getAttribute('data-view'));
        firstVisibleItem.click();
      }
    } else {
      const appContent = document.getElementById('app-content');
      appContent.innerHTML = `<div class="card" style="padding: 2rem; text-align: center;"><p style="color: var(--color-text-muted);">No tienes módulos asignados. Contacta al propietario del sistema.</p></div>`;
      viewTitle.textContent = 'Sin Acceso';
    }

    // Logout
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        console.log('DEBUG: Cerrando sesión...');
        await supabase.auth.signOut();
        window.location.href = 'index.html';
      });
    }

    // Event delegation for dynamic actions
    document.addEventListener('change', async (e) => {
      if (e.target && e.target.classList.contains('status-select')) {
        const orderId = e.target.getAttribute('data-order-id');
        const newStatus = e.target.value;
        console.log(`DEBUG: Cambiando estado de pedido ${orderId} a ${newStatus}...`);
        await updateOrderStatus(orderId, newStatus);
      }
    });

  } catch (err) {
    console.error('DEBUG: Error crítico durante la inicialización de admin.js:', err);
  }
}

// Ejecutar inicialización
init();

const ALL_STATUSES = [
  'para procesar', 
  'en preparación', 
  'preparado', 
  'despachado', 
  'en tránsito', 
  'listo para retiro', 
  'retirado',
  'entregado', 
  'en espera',
  'cancelado'
];

async function updateOrderStatus(orderId, newStatus) {
  try {
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId);
      
    if (error) throw error;
    alert(`Pedido actualizado a: ${newStatus}`);
    renderAdminOrders();
  } catch (err) {
    console.error(err);
    alert('Error al actualizar estado: ' + err.message);
  }
}

async function renderAdminOrders() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando todos los pedidos...</p>`;

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        status,
        created_at,
        external_order_number,
        external_platform,
        origen,
        item,
        cantidad,
        sku,
        profiles (company_name),
        order_items (quantity, products(sku, name))
      `)
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
      rowsHtml = `<tr><td colspan="10" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay pedidos en el sistema.</td></tr>`;
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
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        let optionsHtml = ALL_STATUSES.map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${s}</option>`).join('');

        const platform = order.origen || order.external_platform || 'Manual';
        const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : '#6b7280');
        const originHtml = `<span style="background-color: ${platformColor}15; color: ${platformColor}; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">${platform}</span>`;

        const skuStr = order.sku || order.order_items.map(oi => oi.products?.sku).filter(Boolean).join(', ') || 'Sin SKU';
        const nameStr = order.item || order.order_items.map(oi => oi.products?.name).filter(Boolean).join(', ') || 'Sin Nombre';
        const qtyStr = order.cantidad !== null && order.cantidad !== undefined ? order.cantidad : order.order_items.reduce((sum, oi) => sum + (oi.quantity || 0), 0);

        const orderDisplayId = order.external_order_number 
          ? `<span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${order.external_order_number}</span> <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">(${order.id.split('-')[0]})</span>` 
          : `<span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${order.id.split('-')[0]}</span>`;

        let trackingHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
        let labelHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;

        if (orderShipments.length > 0) {
          const shipment = orderShipments[0]; // Tomar el primer despacho
          if (shipment.tracking) {
            const courierName = shipment.courier || 'Seguimiento';
            trackingHtml = shipment.tracking_url && shipment.tracking_url !== 'N/A'
              ? `<a href="${shipment.tracking_url}" target="_blank" style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:500;"><i class="ri-truck-line"></i> ${courierName}: ${shipment.tracking}</a>`
              : `<span style="display:inline-flex; align-items:center; gap:0.25rem; color: var(--color-text-main);"><i class="ri-truck-line"></i> ${courierName}: ${shipment.tracking}</span>`;
          }
        }

        rowsHtml += `
          <tr style="transition: background-color 0.2s;">
            <td>${orderDisplayId}</td>
            <td><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i><strong>${order.profiles?.company_name || 'Desconocido'}</strong></td>
            <td>${originHtml}</td>
            <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
            <td><span style="font-family: monospace; font-size: 0.85rem; color: var(--color-text-main); font-weight: 600;">${skuStr}</span></td>
            <td>${nameStr}</td>
            <td><strong style="color: var(--color-text-main); font-size: 1.05rem;">${qtyStr}</strong></td>
            <td>${trackingHtml}</td>
            <td>${labelHtml}</td>
            <td>
              <select class="form-input status-select" data-order-id="${order.id}" style="padding: 0.25rem; font-size: 0.875rem; width: auto; font-weight: 500;">
                ${optionsHtml}
              </select>
            </td>
          </tr>
        `;
      });
    }

    appContent.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Panel de Control de Pedidos</h3>
        </div>
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Origen</th>
                <th>Fecha</th>
                <th>SKU</th>
                <th>Nombre Producto</th>
                <th>Cantidad</th>
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

async function renderReassignStock() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Reubicación de Stock (En Desarrollo)</h3>
      </div>
      <div class="card-body">
        <p style="color: var(--color-text-muted);">Pronto podrás listar aquí el inventario de Bodega Central y reasignarlo a otras sucursales.</p>
      </div>
    </div>
  `;
}

async function renderManualIn() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Ingreso Manual de Mercancía (En Desarrollo)</h3>
      </div>
      <div class="card-body">
        <p style="color: var(--color-text-muted);">Pronto podrás registrar entradas directas de inventario para tus clientes aquí.</p>
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

    // Obtener la integración de Optiroute
    const { data: optirouteIntegration, error: optirouteErr } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('platform', 'Optiroute')
      .maybeSingle();

    if (optirouteErr) throw optirouteErr;

    const hasOptiroute = !!optirouteIntegration;
    const optirouteStatusText = hasOptiroute 
      ? (optirouteIntegration.is_active ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-neutral">No configurada</span>';

    appContent.innerHTML = `
      <div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Integraciones del WMS (Administración)</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          Conecta el WMS STOCKA con plataformas de logística globales. 
          Sincroniza pedidos de todos los clientes y realiza el seguimiento de entregas en tiempo real.
        </p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 2rem;">
        <!-- Left Column: Active/Available Integrations -->
        <div style="display: flex; flex-direction: column; gap: 2rem;">
          
          <!-- Optiroute Card -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-truck-line"></i> Optiroute API</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasOptiroute ? '#f0fdf4' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasOptiroute ? '#bbf7d0' : 'var(--color-border)'};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                      <h4 style="margin: 0; font-size: 1.1rem; color: ${hasOptiroute ? '#166534' : 'var(--color-text-main)'};">Optiroute Tracking</h4>
                      <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de estado de despacho global.</p>
                    </div>
                 </div>
                 <div>
                    ${optirouteStatusText}
                 </div>
              </div>
              
              <form id="form-optiroute-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">Access Token de la API</label>
                  <input type="password" id="optiroute-token" class="form-input" placeholder="Ingresa tu Token de API Optiroute" value="${hasOptiroute ? optirouteIntegration.access_token : ''}" ${hasOptiroute ? 'readonly' : 'required'} style="background-color: ${hasOptiroute ? '#f8fafc' : '#ffffff'};">
                </div>

                <!-- Credential Helper (Only if not connected) -->
                ${!hasOptiroute ? `
                  <details style="margin-bottom: 1.25rem; border: 1px solid var(--color-border); padding: 0.75rem; border-radius: var(--radius-md); background: #f8fafc;">
                    <summary style="font-size: 0.875rem; font-weight: 600; cursor: pointer; color: var(--color-accent);"><i class="ri-key-line"></i> Generar Token usando credenciales</summary>
                    <div style="margin-top: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem;">
                      <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">Ingresa las credenciales de tu cuenta Optiroute para obtener el token automáticamente:</p>
                      <div class="form-group" style="margin: 0;">
                        <input type="email" id="optiroute-username" class="form-input" placeholder="correo@empresa.com" style="padding: 0.5rem; font-size: 0.875rem;">
                      </div>
                      <div class="form-group" style="margin: 0;">
                        <input type="password" id="optiroute-password" class="form-input" placeholder="Tu Contraseña" style="padding: 0.5rem; font-size: 0.875rem;">
                      </div>
                      <button type="button" id="btn-generate-optiroute-token" class="btn btn-outline" style="padding: 0.5rem 1rem; font-size: 0.875rem; width: auto; font-weight: 600; border-color: var(--color-accent); color: var(--color-accent);">Obtener Token</button>
                      <div id="optiroute-token-generation-alert" class="alert" style="display: none; padding: 0.5rem; font-size: 0.8rem; margin: 0;"></div>
                    </div>
                  </details>
                ` : ''}
                
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${!hasOptiroute ? 
                    '<button type="submit" class="btn btn-primary" id="btn-save-optiroute" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Optiroute</button>' : 
                    '<button type="button" class="btn btn-outline" id="btn-disconnect-optiroute" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar Optiroute</button>'
                  }
                </div>
              </form>
            </div>
          </div>

        </div>

        <!-- Right Column: Manual/Guides -->
        <div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: #f8fafc;">
            <div class="card-header" style="background-color: #f1f5f9; border-bottom: 1px solid #e2e8f0; padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: #0f172a;"><i class="ri-book-read-line"></i> Guía de Integración Optiroute</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              
              <div class="tab-content">
                <ol style="margin: 0; padding-left: 1.25rem; color: #334155; font-size: 0.95rem; display: flex; flex-direction: column; gap: 1rem;">
                  <li>
                    <strong style="color: #0f172a;">¿Qué hace esta integración?</strong>
                    <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem; line-height: 1.5;">WMS STOCKA consultará periódicamente la API de Optiroute para obtener el estado de tránsito y entrega de las rutas de todos los pedidos, actualizando el WMS en tiempo real a nivel global.</p>
                  </li>
                  <li>
                    <strong style="color: #0f172a;">Obtener Token Automáticamente:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem; line-height: 1.5;">Usa la sección desplegable <em>"Generar Token usando credenciales"</em> de la izquierda. Ingresa tu correo y contraseña de Optiroute para obtenerlo de inmediato.</p>
                  </li>
                  <li>
                    <strong style="color: #0f172a;">Obtener Token Manualmente:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem; line-height: 1.5;">Si prefieres obtener tu token mediante un comando en la consola de tu computador:</p>
                    <pre style="background: #e2e8f0; padding: 0.5rem; border-radius: 4px; font-size: 0.75rem; overflow-x: auto; margin-top: 0.5rem; color: #0f172a;">curl -X POST https://app.optiroute.cl/api-token-auth/ \\
  -F "username=tu-correo@empresa.com" \\
  -F "password=tu-contrasena"</pre>
                    <p style="margin: 0.25rem 0 0 0; color: #475569; font-size: 0.85rem;">Copia el valor de 'token' retornado y pégalo arriba.</p>
                  </li>
                </ol>
              </div>

            </div>
          </div>
        </div>
      </div>
    `;

    // Optiroute Submit Listener
    if(!hasOptiroute) {
      document.getElementById('form-optiroute-integration').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-save-optiroute');
        btn.disabled = true;
        btn.textContent = 'Conectando...';

        const token = document.getElementById('optiroute-token').value.trim();

        try {
          const { error: insErr } = await supabase.from('merchant_integrations').insert([{
            merchant_id: merchantId,
            platform: 'Optiroute',
            shop_url: 'app.optiroute.cl',
            access_token: token,
            is_active: true
          }]);
          if(insErr) throw insErr;
          
          alert('Integración con Optiroute guardada correctamente.');
          renderIntegrations(); // Recargar vista
        } catch(err) {
          console.error(err);
          alert('Error al guardar la integración: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Conectar Optiroute';
        }
      });

      // Token Generator helper handler
      const btnGen = document.getElementById('btn-generate-optiroute-token');
      if(btnGen) {
        btnGen.addEventListener('click', async (e) => {
          e.preventDefault();
          const usernameInput = document.getElementById('optiroute-username');
          const passwordInput = document.getElementById('optiroute-password');
          const alertContainer = document.getElementById('optiroute-token-generation-alert');
          
          const username = usernameInput.value.trim();
          const password = passwordInput.value;
          
          if(!username || !password) {
            alertContainer.style.display = 'block';
            alertContainer.style.backgroundColor = '#fee2e2';
            alertContainer.style.color = '#b91c1c';
            alertContainer.style.border = '1px solid #fecaca';
            alertContainer.textContent = 'Ingresa tu usuario y contraseña.';
            return;
          }
          
          btnGen.disabled = true;
          btnGen.textContent = 'Obteniendo token...';
          alertContainer.style.display = 'none';
          
          try {
            const formData = new FormData();
            formData.append('username', username);
            formData.append('password', password);
            
            const response = await fetch('https://app.optiroute.cl/api-token-auth/', {
              method: 'POST',
              body: formData
            });
            
            if(!response.ok) {
              throw new Error(`Error en el servidor de Optiroute: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            if(data && data.token) {
              document.getElementById('optiroute-token').value = data.token;
              alertContainer.style.display = 'block';
              alertContainer.style.backgroundColor = '#d1fae5';
              alertContainer.style.color = '#047857';
              alertContainer.style.border = '1px solid #a7f3d0';
              alertContainer.innerHTML = 'Token generado con éxito. <strong>¡Haz clic en "Conectar Optiroute" abajo para guardarlo!</strong>';
              
              usernameInput.value = '';
              passwordInput.value = '';
            } else {
              throw new Error('El servidor no retornó un token.');
            }
          } catch(err) {
            console.error(err);
            alertContainer.style.display = 'block';
            alertContainer.style.backgroundColor = '#fee2e2';
            alertContainer.style.color = '#b91c1c';
            alertContainer.style.border = '1px solid #fecaca';
            alertContainer.innerHTML = '<strong>Error de conexión / Bloqueo CORS:</strong> Obtén el token manualmente usando curl (ver la pestaña Optiroute a la derecha) e ingrésalo en el campo de arriba.';
          } finally {
            btnGen.disabled = false;
            btnGen.textContent = 'Obtener Token';
          }
        });
      }
    } else {
      document.getElementById('btn-disconnect-optiroute').addEventListener('click', async () => {
        if(confirm('¿Estás seguro que deseas desconectar tu cuenta de Optiroute?')) {
          try {
            const { error: delErr } = await supabase.from('merchant_integrations')
              .delete()
              .eq('merchant_id', merchantId)
              .eq('platform', 'Optiroute');
            if(delErr) throw delErr;
            alert('Optiroute desconectado.');
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

async function renderConsolidatedShipments() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando panel consolidado de envíos...</p>`;

  let activeTab = 'all'; // 'all', 'multi', 'no_movement'
  let searchTerm = '';

  const openResolutionModal = async (ref, type) => {
    try {
      const { data: shipments, error } = await supabase
        .from('envios_unificados')
        .select('id, source_table, tracking, courier, status')
        .eq('pedido_referencia', ref)
        .eq('global_status', 'DESPACHADO');

      if (error) throw error;
      if (!shipments || shipments.length === 0) {
        alert('No se encontraron despachos asociados a esta alerta para resolver.');
        return;
      }

      let modal = document.getElementById('modal-resolve-alert');
      if (modal) modal.remove();

      modal = document.createElement('div');
      modal.id = 'modal-resolve-alert';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100%';
      modal.style.height = '100%';
      modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
      modal.style.display = 'flex';
      modal.style.justifyContent = 'center';
      modal.style.alignItems = 'center';
      modal.style.zIndex = '9999';
      modal.style.backdropFilter = 'blur(4px)';

      const title = type === 'discard' ? 'Descartar Alerta (Seleccionar Prevalente)' : 'Confirmar Problema (Ocultar Duplicados)';
      const description = type === 'discard' 
        ? `Esta acción marcará el problema como resuelto para el pedido <strong>${ref}</strong>. Todos los envíos continuarán siendo visibles para el cliente en su panel. Selecciona el despacho que prevalece logísticamente:`
        : `Esta acción marcará el problema como resuelto y ocultará de la vista del cliente los envíos duplicados incorrectos para el pedido <strong>${ref}</strong>. Selecciona el único despacho que debe mantenerse visible para el cliente:`;

      const optionsHtml = shipments.map(s => {
        const sourceName = s.source_table === 'lightdata_envios' ? 'LightData' : s.source_table === 'enviame_shipments' ? 'Enviame' : 'Optiroute';
        return `<option value="${s.id}">${sourceName} - ${s.courier || 'N/A'} (Tracking: ${s.tracking || 'N/A'}) - Estado original: ${s.status}</option>`;
      }).join('');

      modal.innerHTML = `
        <div style="background:#ffffff; padding:2rem; border-radius:12px; width:90%; max-width:550px; box-shadow:var(--shadow-lg); border: 1px solid var(--color-border);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: 1rem;">
            <h3 style="margin:0; font-size:1.25rem; font-weight:700; color:var(--color-dark);">${title}</h3>
            <button id="btn-close-resolve-modal" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--color-text-muted);">&times;</button>
          </div>
          <div style="margin-bottom:1.5rem;">
            <p style="margin:0 0 1.25rem 0; font-size:0.9rem; color:var(--color-text-muted); line-height:1.5;">${description}</p>
            <div class="form-group" style="margin:0;">
              <label class="form-label" style="font-weight:600; margin-bottom:0.5rem; display:block;">Seleccionar Despacho:</label>
              <select id="resolve-shipment-select" class="form-input" style="width:100%; padding:0.5rem; border-radius:6px; font-weight:500;">
                ${optionsHtml}
              </select>
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.75rem; border-top: 1px solid var(--color-border); padding-top:1.25rem;">
            <button class="btn btn-outline" id="btn-cancel-resolve" style="padding:0.5rem 1rem; border-radius:6px; cursor:pointer;">Cancelar</button>
            <button class="btn btn-primary" id="btn-confirm-resolve" style="background:var(--color-accent); color:#ffffff; border:none; padding:0.5rem 1rem; border-radius:6px; font-weight:600; cursor:pointer;">Confirmar Resolución</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const closeModal = () => modal.remove();
      modal.querySelector('#btn-close-resolve-modal').addEventListener('click', closeModal);
      modal.querySelector('#btn-cancel-resolve').addEventListener('click', closeModal);

      modal.querySelector('#btn-confirm-resolve').addEventListener('click', async () => {
        const selectedId = modal.querySelector('#resolve-shipment-select').value;
        const confirmBtn = modal.querySelector('#btn-confirm-resolve');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Procesando...';

        try {
          if (type === 'discard') {
            // Discard: mark all shipments of this order as resolved and visible to client
            const { error: updErr } = await supabase
              .from('envios_unificados')
              .update({ is_resolved: true, visible_to_client: true })
              .eq('pedido_referencia', ref);

            if (updErr) throw updErr;
          } else {
            // Confirm: mark all as resolved. The selected one remains visible to client, other hidden.
            // First mark all as resolved and hidden from client
            const { error: updAllErr } = await supabase
              .from('envios_unificados')
              .update({ is_resolved: true, visible_to_client: false })
              .eq('pedido_referencia', ref);

            if (updAllErr) throw updAllErr;

            // Then mark selected one as visible to client
            const { error: updSelErr } = await supabase
              .from('envios_unificados')
              .update({ visible_to_client: true })
              .eq('id', selectedId);

            if (updSelErr) throw updSelErr;
          }

          alert('Alerta resuelta con éxito.');
          modal.remove();
          await loadAndRender();
        } catch (err) {
          console.error('Error resolving alert:', err);
          alert('Error al resolver alerta: ' + err.message);
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirmar Resolución';
        }
      });

    } catch (err) {
      console.error('Error opening resolution modal:', err);
      alert('Error al cargar detalles de la alerta: ' + err.message);
    }
  };

  const loadAndRender = async () => {
    try {
      // 1. Fetch Summary Stats
      const { count: totalCount, error: countErr } = await supabase
        .from('envios_unificados')
        .select('*', { count: 'exact', head: true });
        
      const { data: allAlerts, error: alertsErr } = await supabase
        .from('envios_alertas_admin')
        .select('*');

      if (countErr || alertsErr) {
        throw countErr || alertsErr;
      }

      const multiCount = allAlerts.filter(a => a.tipo_alerta === 'MULTI_DESPACHADO').length;
      const noMovCount = allAlerts.filter(a => a.tipo_alerta === 'SIN_MOVIMIENTO').length;

      // 2. Fetch Tab Specific Data
      let rowsHtml = '';
      let tableHeaders = '';
      
      if (activeTab === 'all') {
        tableHeaders = `
          <tr>
            <th>Referencia</th>
            <th>Origen</th>
            <th>Courier (Tracking)</th>
            <th>Destinatario</th>
            <th>Comuna</th>
            <th>Estado Original</th>
            <th>Estado Global</th>
            <th>Visibilidad Cliente</th>
            <th>Creado El</th>
          </tr>
        `;

        let query = supabase.from('envios_unificados').select('*');
        if (searchTerm) {
          query = query.or(`pedido_referencia.ilike.%${searchTerm}%,tracking.ilike.%${searchTerm}%,nombre_destinatario.ilike.%${searchTerm}%,comuna_destino.ilike.%${searchTerm}%,courier.ilike.%${searchTerm}%`);
        }
        const { data: shipments, error: shipErr } = await query
          .order('created_at', { ascending: false })
          .limit(100);

        if (shipErr) throw shipErr;

        if (!shipments || shipments.length === 0) {
          rowsHtml = `<tr><td colspan="9" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No se encontraron envíos.</td></tr>`;
        } else {
          shipments.forEach(s => {
            const dateObj = s.created_at ? new Date(s.created_at) : null;
            const dateStr = dateObj ? dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-';
            
            let badgeClass = 'badge-neutral';
            if (s.global_status === 'DESPACHADO') {
              badgeClass = 'badge-success';
            } else if (s.global_status === 'SIN MOVIMIENTO') {
              badgeClass = 'badge-warning';
            } else if (s.global_status === 'ALERTA') {
              badgeClass = 'badge-danger';
            }

            const originBadge = s.source_table === 'lightdata_envios' ? 'LightData' 
              : s.source_table === 'enviame_shipments' ? 'Enviame' : 'Optiroute';
            
            const originColor = s.source_table === 'lightdata_envios' ? '#3b82f6'
              : s.source_table === 'enviame_shipments' ? '#10b981' : '#8b5cf6';

            const trackingDisplay = s.tracking
              ? (s.tracking_url && s.tracking_url !== 'N/A'
                  ? `<a href="${s.tracking_url}" target="_blank" style="font-weight:500;"><i class="ri-links-line"></i> ${s.tracking}</a>`
                  : s.tracking)
              : '-';

            const clientVisibilityBadge = s.visible_to_client 
              ? `<span style="background-color: #f0fdf4; color: #16a34a; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight:600;">Visible</span>`
              : `<span style="background-color: #fef2f2; color: #dc2626; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight:600;">Oculto</span>`;

            rowsHtml += `
              <tr>
                <td><strong>${s.pedido_referencia || '-'}</strong></td>
                <td><span style="background-color: ${originColor}15; color: ${originColor}; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight:600;">${originBadge}</span></td>
                <td>${s.courier || '-'} ${trackingDisplay !== '-' ? `(${trackingDisplay})` : ''}</td>
                <td>
                  <div style="font-weight:500;">${s.nombre_destinatario || '-'}</div>
                  <div style="font-size:0.75rem; color:var(--color-text-muted);">${s.telefono_destino || ''}</div>
                </td>
                <td>${s.comuna_destino || '-'}</td>
                <td><span style="font-size:0.875rem; text-transform:capitalize;">${s.status || '-'}</span></td>
                <td><span class="badge ${badgeClass}">${s.global_status || 'DESCONOCIDO'}</span></td>
                <td>${clientVisibilityBadge}</td>
                <td style="font-size:0.875rem; color:var(--color-text-muted);">${dateStr}</td>
              </tr>
            `;
          });
        }
      } else {
        tableHeaders = `
          <tr>
            <th>Pedido Ref.</th>
            <th>Tipo Alerta</th>
            <th>Descripción</th>
            <th>Tablas Afectadas</th>
            <th>Estados Originales</th>
            <th>Acciones</th>
          </tr>
        `;

        const filteredAlerts = allAlerts.filter(a => {
          const matchesSearch = searchTerm ? (a.pedido_referencia?.toLowerCase().includes(searchTerm.toLowerCase())) : true;
          if (activeTab === 'multi') return a.tipo_alerta === 'MULTI_DESPACHADO' && matchesSearch;
          if (activeTab === 'no_movement') return a.tipo_alerta === 'SIN_MOVIMIENTO' && matchesSearch;
          return false;
        });

        if (filteredAlerts.length === 0) {
          rowsHtml = `<tr><td colspan="6" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No se encontraron alertas para esta sección.</td></tr>`;
        } else {
          filteredAlerts.forEach(a => {
            let typeBg = '#fee2e2';
            let typeColor = '#991b1b';
            let typeText = 'Multi-Despachado';

            if (a.tipo_alerta === 'SIN_MOVIMIENTO') {
              typeBg = '#fffbeb';
              typeColor = '#d97706';
              typeText = 'Sin Movimiento';
            }

            const originBadges = a.tablas_origen.map((t, idx) => {
              const name = t === 'lightdata_envios' ? 'LightData' : t === 'enviame_shipments' ? 'Enviame' : 'Optiroute';
              const color = t === 'lightdata_envios' ? '#3b82f6' : t === 'enviame_shipments' ? '#10b981' : '#8b5cf6';
              const rawDate = a.fechas_creacion?.[idx];
              const dateStr = rawDate ? new Date(rawDate).toLocaleDateString([], {day:'2-digit', month:'2-digit'}) + ' ' + new Date(rawDate).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
              return `<div style="margin-bottom:0.25rem; display:flex; align-items:center; gap:0.5rem; white-space:nowrap;">
                <span style="background-color: ${color}15; color: ${color}; padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.7rem; font-weight:600;">${name}</span>
                <span style="font-size:0.75rem; color:var(--color-text-muted);">${dateStr}</span>
              </div>`;
            }).join('');

            let actionButtons = `<button class="btn btn-outline btn-view-pedidos-details" data-ref="${a.pedido_referencia}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; margin-right:0.25rem; font-weight:600; cursor:pointer;"><i class="ri-search-line"></i> Revisar</button>`;
            
            if (a.tipo_alerta === 'MULTI_DESPACHADO') {
              actionButtons += `
                <button class="btn btn-success btn-discard-alert" data-ref="${a.pedido_referencia}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem; background:#d1fae5; color:#065f46; border:1px solid #065f46; font-weight:600; cursor:pointer; border-radius:4px;"><i class="ri-check-line"></i> Descartar</button>
                <button class="btn btn-danger btn-confirm-alert" data-ref="${a.pedido_referencia}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; background:#fee2e2; color:#b91c1c; border:1px solid #b91c1c; font-weight:600; cursor:pointer; border-radius:4px;"><i class="ri-error-warning-line"></i> Confirmar</button>
              `;
            }

            rowsHtml += `
              <tr>
                <td><strong>${a.pedido_referencia}</strong></td>
                <td><span style="background-color: ${typeBg}; color: ${typeColor}; padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">${typeText}</span></td>
                <td style="font-size:0.875rem; max-width:300px;">${a.descripcion_alerta}</td>
                <td>${originBadges}</td>
                <td style="font-size:0.875rem; color:var(--color-text-muted);">${a.estados_originales.join(', ')}</td>
                <td style="white-space: nowrap;">
                  ${actionButtons}
                </td>
              </tr>
            `;
          });
        }
      }

      appContent.innerHTML = `
        <div style="margin-bottom: 2rem;">
          <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Consolidación y Auditoría de Logística</h2>
          <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
            Monitorea todos los envíos unificados de LightData, Enviame y Optiroute. Resuelve anomalías como duplicaciones de despacho o pedidos estancados de inmediato.
          </p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
          <div class="card" style="padding: 1.25rem; border: none; box-shadow: var(--shadow-sm); display:flex; align-items:center; gap:1rem; background:#ffffff;">
            <div style="font-size: 2.25rem; background: #e0f2fe; padding: 0.5rem; border-radius: 0.5rem; display:flex; align-items:center; justify-content:center; color:#0284c7; width:50px; height:50px;"><i class="ri-box-3-line"></i></div>
            <div>
              <div style="font-size: 0.875rem; color: var(--color-text-muted); font-weight:500;">Envíos Consolidados</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: var(--color-dark);">${totalCount}</div>
            </div>
          </div>
          <div class="card" style="padding: 1.25rem; border: none; box-shadow: var(--shadow-sm); display:flex; align-items:center; gap:1rem; background:#ffffff; border-left: 4px solid #ef4444;">
            <div style="font-size: 2.25rem; background: #fee2e2; padding: 0.5rem; border-radius: 0.5rem; display:flex; align-items:center; justify-content:center; color:#ef4444; width:50px; height:50px;"><i class="ri-error-warning-line"></i></div>
            <div>
              <div style="font-size: 0.875rem; color: var(--color-text-muted); font-weight:500;">Alerta: Multi-Despacho</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #ef4444;">${multiCount}</div>
            </div>
          </div>
          <div class="card" style="padding: 1.25rem; border: none; box-shadow: var(--shadow-sm); display:flex; align-items:center; gap:1rem; background:#ffffff; border-left: 4px solid #f59e0b;">
            <div style="font-size: 2.25rem; background: #fffbeb; padding: 0.5rem; border-radius: 0.5rem; display:flex; align-items:center; justify-content:center; color:#d97706; width:50px; height:50px;"><i class="ri-timer-line"></i></div>
            <div>
              <div style="font-size: 0.875rem; color: var(--color-text-muted); font-weight:500;">Alerta: Sin Movimiento</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #d97706;">${noMovCount}</div>
            </div>
          </div>
        </div>

        <div class="card" style="border: none; box-shadow: var(--shadow-md);">
          <div class="card-header" style="background:#ffffff; border-bottom: 1px solid var(--color-border); padding: 1rem 1.5rem; display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:1rem;">
            
            <div style="display:flex; gap:0.5rem; background:#f1f5f9; padding:0.25rem; border-radius:8px;">
              <button class="tab-btn ${activeTab === 'all' ? 'active' : ''}" data-tab="all" style="border:none; padding:0.5rem 1rem; border-radius:6px; font-weight:600; cursor:pointer; font-size:0.875rem; background:${activeTab === 'all' ? '#ffffff' : 'transparent'}; color:${activeTab === 'all' ? 'var(--color-accent)' : 'var(--color-text-muted)'}; box-shadow:${activeTab === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};">Todos</button>
              <button class="tab-btn ${activeTab === 'multi' ? 'active' : ''}" data-tab="multi" style="border:none; padding:0.5rem 1rem; border-radius:6px; font-weight:600; cursor:pointer; font-size:0.875rem; background:${activeTab === 'multi' ? '#ffffff' : 'transparent'}; color:${activeTab === 'multi' ? '#ef4444' : 'var(--color-text-muted)'}; box-shadow:${activeTab === 'multi' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};">
                Multi-Despacho (${multiCount})
              </button>
              <button class="tab-btn ${activeTab === 'no_movement' ? 'active' : ''}" data-tab="no_movement" style="border:none; padding:0.5rem 1rem; border-radius:6px; font-weight:600; cursor:pointer; font-size:0.875rem; background:${activeTab === 'no_movement' ? '#ffffff' : 'transparent'}; color:${activeTab === 'no_movement' ? '#d97706' : 'var(--color-text-muted)'}; box-shadow:${activeTab === 'no_movement' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};">
                Sin Movimiento (${noMovCount})
              </button>
            </div>

            <div style="position:relative; width: 280px;">
              <input type="text" id="shipments-search" class="form-input" style="padding: 0.5rem 0.75rem 0.5rem 2rem; font-size: 0.875rem; border-radius:6px; margin:0;" placeholder="Buscar referencia, comuna, etc..." value="${searchTerm}">
              <span style="position:absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); font-size:0.875rem;"><i class="ri-search-line"></i></span>
            </div>

          </div>
          <div class="card-body" style="padding: 0; overflow-x: auto;">
            <table class="data-table" style="width: 100%; margin: 0; border-collapse: collapse;">
              <thead>
                ${tableHeaders}
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
          ${activeTab === 'all' ? `
            <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border); font-size: 0.8rem; color: var(--color-text-muted); text-align: right;">
              Mostrando los últimos 100 registros. Usa el buscador para filtrar.
            </div>
          ` : ''}
        </div>
      `;

      appContent.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          activeTab = e.target.getAttribute('data-tab');
          loadAndRender();
        });
      });

      const searchInput = document.getElementById('shipments-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          searchTerm = e.target.value.trim();
        });
        searchInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            loadAndRender();
          }
        });
      }

      appContent.querySelectorAll('.btn-view-pedidos-details').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const ref = e.target.getAttribute('data-ref');
          activeTab = 'all';
          searchTerm = ref;
          loadAndRender();
        });
      });

      appContent.querySelectorAll('.btn-discard-alert').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const ref = e.target.getAttribute('data-ref');
          await openResolutionModal(ref, 'discard');
        });
      });

      appContent.querySelectorAll('.btn-confirm-alert').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const ref = e.target.getAttribute('data-ref');
          await openResolutionModal(ref, 'confirm');
        });
      });

    } catch (err) {
      console.error('Error rendering unified shipments:', err);
      appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar datos consolidados: ${err.message}</p>`;
    }
  };

  await loadAndRender();
}

// ==========================================
// User Management View Rendering & Logic
// ==========================================

async function renderUsersAdmin() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando usuarios y roles...</p>`;

  try {
    // Obtener todos los perfiles de usuarios
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (profilesError) throw profilesError;

    // Obtener los comercios configurados desde la vista segura v_comercios_config
    let comercios = [];
    let loadErrorMsg = null;
    try {
      const { data, error } = await supabase.from('v_comercios_config').select('nombre, sigla');
      if (!error && data) {
        comercios = data;
        window.cachedComercios = data; // Guardar en cache para el modal
        window.lastComerciosError = null;
      } else if (error) {
        console.warn("Error loading v_comercios_config:", error);
        loadErrorMsg = error.message || JSON.stringify(error);
        window.lastComerciosError = error;
      }
    } catch (e) {
      console.warn("Error loading v_comercios_config, using empty array:", e);
      loadErrorMsg = e.message || JSON.stringify(e);
      window.lastComerciosError = e;
    }

    let rowsHtml = '';
    if (!profiles || profiles.length === 0) {
      rowsHtml = `<tr><td colspan="6" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay usuarios registrados.</td></tr>`;
    } else {
      profiles.forEach(user => {
        const dateObj = user.created_at ? new Date(user.created_at) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'N/A';

        // Selector de Roles
        const roleSelect = `
          <select class="form-input user-role-select" data-user-id="${user.id}" style="padding: 0.35rem 0.5rem; font-size: 0.875rem; width: auto; min-width: 140px; margin: 0; display: inline-block;">
            <option value="observer" ${user.role === 'observer' ? 'selected' : ''}>Observador</option>
            <option value="client" ${user.role === 'client' ? 'selected' : ''}>Cliente</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        `;

        // Checkboxes de Comercios (solo editables/visibles para rol cliente)
        const currentComercios = user.comercio && user.comercio !== 'no asignado'
          ? user.comercio.split(',').map(c => c.trim())
          : [];

        window.adminComerciosList = comercios; // Exponer a nivel global para el modal
        let comerciosHtml = '';
        if (user.role !== 'client') {
          comerciosHtml = `<span style="color: var(--color-text-muted); font-size: 0.85rem; font-style: italic;">No aplica (Rol: ${user.role === 'admin' ? 'Administrador' : 'Observador'})</span>`;
        } else if (comercios.length === 0) {
          const errorDetail = loadErrorMsg ? `<br><small style="color: #ef4444; font-size: 0.8rem;">Detalle del error: ${loadErrorMsg}</small>` : '';
          comerciosHtml = `<span style="color: var(--color-text-muted); font-size: 0.85rem;">No hay comercios configurados en comercios_config.${errorDetail}</span>`;
        } else {
          const assignedCount = currentComercios.length;
          const assignedDataStr = encodeURIComponent(JSON.stringify(currentComercios));
          comerciosHtml = `
            <button class="btn btn-outline btn-sm" onclick="openUserComerciosModal('${user.id}', '${assignedDataStr}')" style="font-size: 0.8rem; padding: 0.35rem 0.75rem; border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
              <i class="ri-store-2-line"></i> Gestionar Comercios (${assignedCount})
            </button>
            <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.35rem; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${assignedCount > 0 ? currentComercios.join(', ') : 'Ninguno asignado'}
            </div>
          `;
        }

        rowsHtml += `
          <tr>
            <td><strong>${user.full_name || 'Sin nombre'}</strong></td>
            <td>${user.company_name || 'Sin empresa'}</td>
            <td>${user.email || 'Sin email'}</td>
            <td style="font-size: 0.85rem; color: var(--color-text-muted);">${dateStr}</td>
            <td>${roleSelect}</td>
            <td>
              <div style="display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center;">
                ${comerciosHtml}
              </div>
            </td>
            <td>
              <button class="btn btn-outline btn-manage-modules" 
                      data-user-id="${user.id}" 
                      data-user-name="${user.full_name || 'Sin nombre'}" 
                      data-user-role="${user.role}" 
                      data-allowed-modules="${user.allowed_modules || 'all'}" 
                      style="padding: 0.35rem 0.6rem; font-size: 0.8rem; font-weight: 500; cursor: pointer; border-color: var(--color-border); color: var(--color-text-main); background: var(--color-surface);">
                <i class="ri-settings-5-line"></i> Módulos
              </button>
            </td>
          </tr>
        `;
      });
    }

    appContent.innerHTML = `
      <div class="card" style="border: none; box-shadow: var(--shadow-md);">
        <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h3 style="margin: 0; font-size: 1.25rem;">Control de Acceso y Roles de Usuarios</h3>
            <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-top: 0.25rem; font-weight: normal; max-width: 650px;">
              Administra el rol de los usuarios y asocia uno o múltiples comercios a los clientes. Los nuevos usuarios se registran como 'observador' (solo lectura, sin comercio asignado) por defecto.
            </p>
          </div>
          <button class="btn btn-primary" id="btn-open-create-user-modal" style="background-color: var(--color-primary); color: var(--color-dark); font-weight: 600;">Crear Usuario</button>
        </div>
        <div class="card-body" style="padding: 0; overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Empresa</th>
                <th>Email</th>
                <th>Fecha de Registro</th>
                <th>Rol</th>
                <th>Comercios Asignados (Solo Clientes)</th>
                <th>Permisos</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

  } catch (err) {
    console.error("Error loading user administration view:", err);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar la administración de usuarios: ${err.message}</p>`;
  }
}

// Manejo de eventos delegados para cambios de rol y comercios asignados
document.addEventListener('change', async (e) => {
  if (e.target && e.target.classList.contains('user-role-select')) {
    const userId = e.target.getAttribute('data-user-id');
    const newRole = e.target.value;

    try {
      // Prevención de auto-degradación de Admin sin confirmación
      const { data: userAuth } = await supabase.auth.getUser();
      if (userAuth && userAuth.user && userAuth.user.id === userId && newRole !== 'admin') {
        const confirmChange = confirm('¡Advertencia! Estás modificando tu propio rol de Administrador. Si guardas este cambio perderás el acceso a este panel de administración. ¿Deseas continuar?');
        if (!confirmChange) {
          e.target.value = 'admin'; // Revertir en el select UI
          return;
        }
      }

      // Si cambia de cliente a otro rol, establecer comercio a 'no asignado'
      const updateData = { role: newRole };
      if (newRole !== 'client') {
        updateData.comercio = 'no asignado';
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId);

      if (error) throw error;

      alert('Rol actualizado con éxito.');

      // Recargar la vista de usuarios para habilitar/deshabilitar checkboxes
      const viewTitle = document.getElementById('view-title');
      if (viewTitle && viewTitle.textContent === 'Gestionar Usuarios') {
        renderUsersAdmin();
      }

      // Redirigir al dashboard si el administrador actual se auto-degradó
      if (userAuth && userAuth.user && userAuth.user.id === userId && newRole !== 'admin') {
        window.location.href = 'dashboard.html';
      }

    } catch (err) {
      console.error('Error al actualizar el rol:', err);
      alert('Error al actualizar el rol: ' + err.message);
    }
  }
});

// Modal para gestionar comercios asignados
window.openUserComerciosModal = function(userId, assignedDataStr) {
  const currentComercios = JSON.parse(decodeURIComponent(assignedDataStr));
  const comercios = window.adminComerciosList || [];
  
  let modal = document.getElementById('modal-manage-comercios');
  if (modal) modal.remove();

  let checkboxesHtml = '';
  comercios.forEach(com => {
    const isChecked = currentComercios.includes(com.nombre) ? 'checked' : '';
    checkboxesHtml += `
      <label style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); cursor: pointer; transition: background 0.2s;">
        <input type="checkbox" class="modal-comercio-cb" value="${com.nombre}" ${isChecked} style="width: 1.25rem; height: 1.25rem; cursor: pointer; accent-color: var(--color-primary);">
        <span style="font-size: 0.95rem; color: var(--color-text-main); font-weight: 500;">${com.nombre} <small style="color: var(--color-text-muted); font-weight: normal; margin-left: 0.25rem;">(${com.sigla})</small></span>
      </label>
    `;
  });

  modal = document.createElement('div');
  modal.id = 'modal-manage-comercios';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 480px; display: flex; flex-direction: column; max-height: 85vh; padding: 0;">
      <div class="modal-header" style="padding: 1.25rem; border-bottom: 1px solid var(--color-border); background: var(--color-surface); border-radius: var(--radius-lg) var(--radius-lg) 0 0;">
        <h3 style="margin: 0;"><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i>Asignar Comercios</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body" style="overflow-y: auto; flex: 1; padding: 0; background: var(--color-bg);">
        <div style="display: flex; flex-direction: column;">
          ${checkboxesHtml}
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.75rem; padding: 1.25rem; border-top: 1px solid var(--color-border); background: var(--color-surface); border-radius: 0 0 var(--radius-lg) var(--radius-lg);">
        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-comercios" style="display: flex; align-items: center; gap: 0.5rem;"><i class="ri-save-line"></i> Guardar Cambios</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  setTimeout(() => {
    modal.classList.add('active');
  }, 10);

  document.getElementById('btn-save-comercios').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Guardando...';

    const checkboxes = modal.querySelectorAll('.modal-comercio-cb:checked');
    const checkedComercios = Array.from(checkboxes).map(cb => cb.value);
    const commerceString = checkedComercios.length > 0 ? checkedComercios.join(', ') : 'no asignado';

    try {
      const { error } = await supabase.from('profiles').update({ comercio: commerceString }).eq('id', userId);
      if (error) throw error;
      
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 300);
      
      if (typeof renderUsersAdmin === 'function') {
        renderUsersAdmin();
      }
    } catch (err) {
      console.error('Error al guardar:', err);
      alert('Error al guardar comercios: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-save-line"></i> Guardar Cambios';
    }
  });
};


// ==========================================
// Modal handlers for Creating Users (RPC)
// ==========================================

// ==========================================
// Modal handlers for Creating Users (RPC)
// ==========================================

const CLIENT_MODULES = [
  { id: 'inventory', label: 'Inventario' },
  { id: 'orders', label: 'Pedidos' },
  { id: 'shipments', label: 'Despachos' },
  { id: 'movements', label: 'Movimientos' },
  { id: 'warehouses', label: 'Bodegas' },
  { id: 'pending', label: 'Por Asignar' },
  { id: 'returns', label: 'Logística Inversa' },
  { id: 'pickups', label: 'Punto de Retiro' },
  { id: 'sales', label: 'Punto de Ventas' },
  { id: 'integrations', label: 'Integraciones' },
  { id: 'profile', label: 'Mi Perfil' }
];

const ADMIN_MODULES = [
  { id: 'orders_admin', label: 'Gestor de Pedidos' },
  { id: 'consolidated_shipments', label: 'Envíos Consolidados' },
  { id: 'reassign_admin', label: 'Reubicar Stock' },
  { id: 'manual_in_admin', label: 'Ingreso Manual' },
  { id: 'users_admin', label: 'Gestionar Usuarios' },
  { id: 'integrations', label: 'Integraciones' }
];

// Abrir y cerrar el modal de creación de usuario
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-open-create-user-modal') {
    e.preventDefault();
    const modal = document.getElementById('modal-create-user');
    if (modal) {
      // Limpiar y resetear el formulario
      const form = document.getElementById('form-create-user');
      if (form) form.reset();
      document.getElementById('modal-user-alert-container').innerHTML = '';
      document.getElementById('new-user-comercios-group').style.display = 'none';
      
      // Mostrar y precargar los módulos correspondientes a 'observer' (rol por defecto)
      const modulesGroup = document.getElementById('new-user-modules-group');
      const modulesList = document.getElementById('new-user-modules-list');
      if (modulesGroup && modulesList) {
        modulesGroup.style.display = 'block';
        modulesList.innerHTML = '';
        CLIENT_MODULES.forEach(mod => {
          modulesList.innerHTML += `
            <label style="display: inline-flex; align-items: center; gap: 0.25rem; margin-right: 1.25rem; font-size: 0.85rem; cursor: pointer; user-select: none;">
              <input type="checkbox" class="new-user-module-cb" value="${mod.id}" checked>
              <span>${mod.label}</span>
            </label>
          `;
        });
      }
      
      modal.classList.add('active');
    }
  }
});

// Alternar visibilidad de comercios y módulos según el rol seleccionado en el formulario de creación
document.addEventListener('change', async (e) => {
  if (e.target && e.target.id === 'new-user-role') {
    const role = e.target.value;
    const commerceGroup = document.getElementById('new-user-comercios-group');
    const commerceList = document.getElementById('new-user-comercios-list');
    
    // Alternar Comercios (Solo clientes)
    if (role === 'client') {
      commerceGroup.style.display = 'block';
      commerceList.innerHTML = `<span style="color: var(--color-text-muted); font-size: 0.85rem;">Cargando comercios...</span>`;
      
      if (!window.cachedComercios || window.cachedComercios.length === 0) {
        try {
          const { data, error } = await supabase.from('v_comercios_config').select('nombre, sigla');
          if (!error && data) {
            window.cachedComercios = data;
            window.lastComerciosError = null;
          } else if (error) {
            console.error("Error al obtener v_comercios_config desde el modal:", error);
            window.lastComerciosError = error;
          }
        } catch (err) {
          console.error("Error al obtener v_comercios_config desde el modal:", err);
          window.lastComerciosError = err;
        }
      }
      
      const comercios = window.cachedComercios || [];
      if (comercios.length === 0) {
        const errorDetail = window.lastComerciosError ? `<br><small style="color: #ef4444; font-size: 0.8rem;">Detalle del error: ${window.lastComerciosError.message || JSON.stringify(window.lastComerciosError)}</small>` : '';
        commerceList.innerHTML = `<span style="color: var(--color-text-muted); font-size: 0.85rem; font-style: italic;">No hay comercios configurados en la base de datos.${errorDetail}</span>`;
      } else {
        commerceList.innerHTML = '';
        comercios.forEach(com => {
          commerceList.innerHTML += `
            <label style="display: inline-flex; align-items: center; gap: 0.25rem; margin-right: 1.25rem; font-size: 0.85rem; cursor: pointer; user-select: none;">
              <input type="checkbox" class="new-user-comercio-cb" value="${com.nombre}">
              <span>${com.nombre} (${com.sigla})</span>
            </label>
          `;
        });
      }
    } else {
      commerceGroup.style.display = 'none';
    }

    // Alternar Módulos
    const modulesGroup = document.getElementById('new-user-modules-group');
    const modulesList = document.getElementById('new-user-modules-list');
    if (modulesGroup && modulesList) {
      modulesGroup.style.display = 'block';
      modulesList.innerHTML = '';
      const targetModules = (role === 'admin') ? ADMIN_MODULES : CLIENT_MODULES;
      targetModules.forEach(mod => {
        modulesList.innerHTML += `
          <label style="display: inline-flex; align-items: center; gap: 0.25rem; margin-right: 1.25rem; font-size: 0.85rem; cursor: pointer; user-select: none;">
            <input type="checkbox" class="new-user-module-cb" value="${mod.id}" checked>
            <span>${mod.label}</span>
          </label>
        `;
      });
    }
  }
});

// Procesar el envío del formulario para crear el usuario en la base de datos
document.addEventListener('submit', async (e) => {
  if (e.target && e.target.id === 'form-create-user') {
    e.preventDefault();
    const alertContainer = document.getElementById('modal-user-alert-container');
    const saveBtn = document.getElementById('btn-save-new-user');
    
    const name = document.getElementById('new-user-name').value.trim();
    const company = document.getElementById('new-user-company').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-password').value.trim();
    const role = document.getElementById('new-user-role').value;
    
    // Obtener comercios seleccionados (solo si el rol es cliente)
    let commerceString = 'no asignado';
    if (role === 'client') {
      const checked = Array.from(document.querySelectorAll('.new-user-comercio-cb:checked')).map(cb => cb.value);
      if (checked.length > 0) {
        commerceString = checked.join(', ');
      }
    }

    // Obtener módulos seleccionados
    const checkedModules = Array.from(document.querySelectorAll('.new-user-module-cb:checked')).map(cb => cb.value);
    const targetModulesList = (role === 'admin') ? ADMIN_MODULES : CLIENT_MODULES;
    let allowedModulesString = 'all';
    if (checkedModules.length === 0) {
      allowedModulesString = '';
    } else if (checkedModules.length < targetModulesList.length) {
      allowedModulesString = checkedModules.join(', ');
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Creando usuario...';
    alertContainer.innerHTML = '';

    try {
      // Llamar a la función RPC segura de la base de datos
      const { data: userId, error } = await supabase.rpc('admin_create_user', {
        p_email: email,
        p_password: password,
        p_full_name: name,
        p_company_name: company,
        p_role: role,
        p_comercio: commerceString,
        p_allowed_modules: allowedModulesString
      });

      if (error) throw error;

      alertContainer.innerHTML = `<div class="alert alert-success" style="display: block;">¡Usuario creado con éxito!</div>`;
      
      setTimeout(() => {
        const modal = document.getElementById('modal-create-user');
        if (modal) modal.classList.remove('active');
        e.target.reset();
        
        // Recargar la tabla de perfiles
        renderUsersAdmin();
      }, 1500);

    } catch (err) {
      console.error('Error al ejecutar RPC admin_create_user:', err);
      alertContainer.innerHTML = `<div class="alert alert-error" style="display: block;">Error: ${err.message || 'No se pudo crear el usuario.'}</div>`;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Crear Usuario';
    }
  }
});

// ==========================================
// Handlers para Restringir Módulos
// ==========================================

// Manejar la apertura del modal para restringir módulos
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-manage-modules');
  if (btn) {
    e.preventDefault();
    const userId = btn.getAttribute('data-user-id');
    const username = btn.getAttribute('data-user-name');
    const role = btn.getAttribute('data-user-role');
    const allowedModulesStr = btn.getAttribute('data-allowed-modules') || 'all';

    const modal = document.getElementById('modal-manage-modules');
    if (modal) {
      document.getElementById('manage-modules-user-id').value = userId;
      document.getElementById('manage-modules-username').textContent = username;
      document.getElementById('manage-modules-user-role').textContent = role === 'admin' ? 'Administrador' : (role === 'client' ? 'Cliente' : 'Observador');
      document.getElementById('modal-modules-alert-container').innerHTML = '';

      const listContainer = document.getElementById('manage-modules-checkboxes-list');
      listContainer.innerHTML = '';

      const targetModules = (role === 'admin') ? ADMIN_MODULES : CLIENT_MODULES;
      const allowedModules = allowedModulesStr !== 'all' && allowedModulesStr !== '' 
        ? allowedModulesStr.split(',').map(m => m.trim()) 
        : targetModules.map(m => m.id); // Si es 'all', todos marcados por defecto

      targetModules.forEach(mod => {
        const isChecked = allowedModules.includes(mod.id) ? 'checked' : '';
        listContainer.innerHTML += `
          <label style="display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; cursor: pointer; user-select: none;">
            <input type="checkbox" class="manage-module-cb" value="${mod.id}" ${isChecked}>
            <span>${mod.label}</span>
          </label>
        `;
      });

      modal.classList.add('active');
    }
  }
});

// Guardar la configuración de módulos permitidos
document.addEventListener('submit', async (e) => {
  if (e.target && e.target.id === 'form-manage-modules') {
    e.preventDefault();
    const alertContainer = document.getElementById('modal-modules-alert-container');
    const saveBtn = document.getElementById('btn-save-modules');
    const userId = document.getElementById('manage-modules-user-id').value;
    const roleText = document.getElementById('manage-modules-user-role').textContent;
    const role = roleText === 'Administrador' ? 'admin' : (roleText === 'Cliente' ? 'client' : 'observer');

    const checkboxes = document.querySelectorAll('.manage-module-cb');
    const checked = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

    const targetModulesList = (role === 'admin') ? ADMIN_MODULES : CLIENT_MODULES;
    let allowedModulesString = 'all';
    
    if (checked.length === 0) {
      allowedModulesString = '';
    } else if (checked.length < targetModulesList.length) {
      allowedModulesString = checked.join(', ');
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    alertContainer.innerHTML = '';

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ allowed_modules: allowedModulesString })
        .eq('id', userId);

      if (error) throw error;

      alertContainer.innerHTML = `<div class="alert alert-success" style="display: block;">¡Permisos de módulos actualizados con éxito!</div>`;
      
      setTimeout(() => {
        const modal = document.getElementById('modal-manage-modules');
        if (modal) modal.classList.remove('active');
        e.target.reset();
        
        // Recargar la tabla de perfiles
        renderUsersAdmin();
      }, 1500);

    } catch (err) {
      console.error('Error al actualizar módulos permitidos:', err);
      alertContainer.innerHTML = `<div class="alert alert-error" style="display: block;">Error: ${err.message || 'No se pudieron actualizar los permisos.'}</div>`;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar Permisos';
    }
  }
});

// Cerrar cualquier modal que use data-close o .modal-close (Cerrado por delegación global)
document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) {
    e.preventDefault();
    const modalId = closeBtn.getAttribute('data-close');
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }
});


