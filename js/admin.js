import supabase from './supabase.js';

// Función global para descargar archivos en PDF codificados en Base64
window.downloadBase64Pdf = function(base64, filename) {
  try {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error al descargar el PDF en Base64:', err);
    alert('No se pudo descargar la etiqueta de despacho: el archivo está dañado o no está disponible.');
  }
};

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
          
          if (view === 'dashboard') {
            viewTitle.textContent = 'Dashboard Admin';
            renderAdminDashboard();
          } else if (view === 'orders_admin') {
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
          } else if (view === 'upload_products_admin') {
            viewTitle.textContent = 'Carga de Planillas';
            renderUploadProducts();
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
          if (allowedModules.includes(view) || view === 'dashboard') {
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
      const defaultView = 'dashboard';
      const isDefaultAllowed = true;
      
      if (isDefaultAllowed) {
        viewTitle.textContent = 'Dashboard Admin';
        console.log('DEBUG: Renderizando vista Dashboard Admin...');
        renderAdminDashboard();
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

    // Notification Logic
    initNotifications(session.user.id);

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
        label_base64,
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
        const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : (platform === 'Falabella' ? '#84cc16' : '#6b7280'));
        const originHtml = `<span style="background-color: ${platformColor}15; color: ${platformColor}; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">${platform}</span>`;

        const skuStr = order.sku || order.order_items.map(oi => oi.products?.sku).filter(Boolean).join(', ') || 'Sin SKU';
        const nameStr = order.item || order.order_items.map(oi => oi.products?.name).filter(Boolean).join(', ') || 'Sin Nombre';
        const qtyStr = order.cantidad !== null && order.cantidad !== undefined ? order.cantidad : order.order_items.reduce((sum, oi) => sum + (oi.quantity || 0), 0);

        const orderDisplayId = order.external_order_number 
          ? `<span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${order.external_order_number}</span> <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">(${order.id.split('-')[0]})</span>` 
          : `<span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${order.id.split('-')[0]}</span>`;

        let trackingHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
        let labelHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
        
        if (order.label_base64) {
          labelHtml = `<button onclick="window.downloadBase64Pdf('${order.label_base64}', 'etiqueta_falabella_${order.external_order_number || order.id}.pdf')" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; font-weight: 600;"><i class="ri-download-2-line"></i> Descargar</button>`;
        }

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
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasOptiroute ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasOptiroute ? 'rgba(16, 185, 129, 0.2)' : 'var(--color-border)'};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                      <h4 style="margin: 0; font-size: 1.1rem; color: ${hasOptiroute ? '#10b981' : 'var(--color-text-main)'};">Optiroute Tracking</h4>
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
                  <input type="password" id="optiroute-token" class="form-input" placeholder="Ingresa tu Token de API Optiroute" value="${hasOptiroute ? optirouteIntegration.access_token : ''}" ${hasOptiroute ? 'readonly' : 'required'} style="background-color: ${hasOptiroute ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>

                <!-- Credential Helper (Only if not connected) -->
                ${!hasOptiroute ? `
                  <details style="margin-bottom: 1.25rem; border: 1px solid var(--color-border); padding: 0.75rem; border-radius: var(--radius-md); background: var(--color-surface);">
                    <summary style="font-size: 0.875rem; font-weight: 600; cursor: pointer; color: var(--color-accent);"><i class="ri-key-line"></i> Generar Token usando credenciales</summary>
                    <div style="margin-top: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem;">
                      <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">Ingresa las credenciales de tu cuenta Optiroute para obtener el token automáticamente:</p>
                      <div class="form-group" style="margin: 0;">
                        <input type="email" id="optiroute-username" class="form-input" placeholder="correo@empresa.com" style="padding: 0.5rem; font-size: 0.875rem; background-color: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border);">
                      </div>
                      <div class="form-group" style="margin: 0;">
                        <input type="password" id="optiroute-password" class="form-input" placeholder="Tu Contraseña" style="padding: 0.5rem; font-size: 0.875rem; background-color: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border);">
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
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);"><i class="ri-book-read-line" style="color: var(--color-primary);"></i> Guía de Integración Optiroute</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              
              <div class="tab-content">
                <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1rem;">
                  <li>
                    <strong style="color: var(--color-text-main);">¿Qué hace esta integración?</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">WMS STOCKA consultará periódicamente la API de Optiroute para obtener el estado de tránsito y entrega de las rutas de todos los pedidos, actualizando el WMS en tiempo real a nivel global.</p>
                  </li>
                  <li>
                    <strong style="color: var(--color-text-main);">Obtener Token Automáticamente:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Usa la sección desplegable <em>"Generar Token usando credenciales"</em> de la izquierda. Ingresa tu correo y contraseña de Optiroute para obtenerlo de inmediato.</p>
                  </li>
                  <li>
                    <strong style="color: var(--color-text-main);">Obtener Token Manualmente:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Si prefieres obtener tu token mediante un comando en la consola de tu computador:</p>
                    <pre style="background: var(--color-bg); padding: 0.5rem; border-radius: 4px; font-size: 0.75rem; overflow-x: auto; margin-top: 0.5rem; color: var(--color-text-main); border: 1px solid var(--color-border);">curl -X POST https://app.optiroute.cl/api-token-auth/ \\
  -F "username=tu-correo@empresa.com" \\
  -F "password=tu-contrasena"</pre>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem;">Copia el valor de 'token' retornado y pégalo arriba.</p>
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
            is_active: true,
            comercio: 'STOCKA'
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
              .eq('comercio', 'STOCKA')
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
          <tr style="transition: background-color 0.2s;">
            <td><span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${s.pedido_referencia || '-'}</span></td>
            <td>
              <span style="background-color: ${originColor}15; color: ${originColor}; padding: 0.35rem 0.75rem; border-radius: 99px; font-size: 0.75rem; font-weight: 700; border: 1px solid ${originColor}30;">
                ${originBadge}
              </span>
            </td>
            <td><span style="font-weight:600; color: var(--color-text-main);"><i class="ri-truck-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.courier || '-'}</span> ${trackingDisplay !== '-' ? `<span style="margin-left:0.25rem;">(${trackingDisplay})</span>` : ''}</td>
            <td>
              <div style="font-weight:600; color: var(--color-text-main);"><i class="ri-user-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.nombre_destinatario || '-'}</div>
              <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top: 0.2rem;"><i class="ri-phone-line" style="margin-right: 0.25rem;"></i>${s.telefono_destino || '-'}</div>
            </td>
            <td><i class="ri-map-pin-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.comuna_destino || '-'}</td>
            <td><span style="font-size:0.875rem; text-transform:capitalize; color: var(--color-text-main);">${s.status || '-'}</span></td>
            <td>
              <span class="badge ${badgeClass}" style="text-transform: capitalize; padding: 0.35rem 0.75rem; border-radius: 99px; font-weight: 600;">
                ${s.global_status ? s.global_status.toLowerCase() : 'desconocido'}
              </span>
            </td>
            <td>${clientVisibilityBadge}</td>
            <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
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
  { id: 'upload_products_admin', label: 'Carga de Planillas' },
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

// ==========================================
// Product Sheet Upload (Carga de Planillas) View & Logic
// ==========================================

let currentParsedProducts = [];
let currentRawJsonData = [];

async function renderUploadProducts() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: var(--color-text-muted);">Cargando comercios registrados...</p>`;

  try {
    const { data: comercios, error: comerciosError } = await supabase
      .from('v_comercios_config')
      .select('id, nombre, sigla')
      .order('nombre');

    if (comerciosError) throw comerciosError;

    appContent.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Carga Masiva de Productos</h3>
        </div>
        <div class="card-body">
          <div id="upload-alert-container"></div>
          
          <div style="background-color: var(--color-bg); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 2rem;">
            <h4 style="margin-top: 0; margin-bottom: 0.5rem; font-weight: 600;"><i class="ri-information-line"></i> Instrucciones de carga</h4>
            <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted); line-height: 1.5;">
              1. Seleccione el comercio al cual se asignarán los productos.<br>
              2. Defina si las dimensiones del archivo están expresadas en Centímetros o Metros para el cálculo del volumen en m³.<br>
              3. Suba un archivo Excel (.xlsx, .xls) o CSV (.csv). Las columnas requeridas son <strong>sku</strong> y <strong>Nombre</strong>. Opcionales: Código de barras, tipo, color, variable 1, variable 2, talla, largo, ancho, alto, volumen (si indica volumen manual, este anulará el cálculo automático).
            </p>
          </div>

          <form id="form-upload-products" style="max-width: 800px; margin-bottom: 1.5rem;">
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label class="form-label" style="font-weight: 600;">1. Seleccionar Comercio (Cliente) <span style="color: red;">*</span></label>
              <select id="upload-merchant-select" class="form-input" required style="max-width: 450px;">
                <option value="">-- Seleccione el comercio --</option>
                ${comercios && comercios.length > 0 
                  ? comercios.map(c => `<option value="${c.sigla}">${c.nombre} (${c.sigla})</option>`).join('')
                  : '<option value="" disabled>No hay comercios registrados</option>'
                }
              </select>
            </div>

            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label class="form-label" style="font-weight: 600;">2. Unidad de Dimensiones (para calcular volumen en m³)</label>
              <div style="display: flex; gap: 2rem; margin-top: 0.5rem;">
                <label style="display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
                  <input type="radio" name="dimension-unit" value="cm" checked style="cursor: pointer;">
                  <span>Centímetros (cm) <small style="color: var(--color-text-muted);">(Volumen = L * An * Al / 1,000,000)</small></span>
                </label>
                <label style="display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
                  <input type="radio" name="dimension-unit" value="m" style="cursor: pointer;">
                  <span>Metros (m) <small style="color: var(--color-text-muted);">(Volumen = L * An * Al)</small></span>
                </label>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label class="form-label" style="font-weight: 600;">3. Archivo Excel o CSV <span style="color: red;">*</span></label>
              <div style="display: flex; align-items: center; gap: 1rem; margin-top: 0.5rem;">
                <input type="file" id="upload-file-input" accept=".xlsx, .xls, .csv" class="form-input" style="display: none;">
                <button type="button" id="btn-select-file" class="btn btn-outline" style="border-style: dashed; padding: 0.75rem 1.5rem; display: inline-flex; align-items: center; gap: 0.5rem;">
                  <i class="ri-file-add-line" style="font-size: 1.1rem;"></i> Seleccionar archivo...
                </button>
                <span id="selected-file-name" style="color: var(--color-text-muted); font-style: italic;">Ningún archivo seleccionado</span>
              </div>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 2rem;">
              <button type="button" id="btn-download-template" class="btn btn-outline" style="display: inline-flex; align-items: center; gap: 0.5rem; border-color: var(--color-border);">
                <i class="ri-download-line"></i> Descargar Plantilla Ejemplo
              </button>
              <button type="button" id="btn-clear-upload" class="btn btn-outline" style="display: none;">Limpiar</button>
            </div>
          </form>

          <!-- Previsualización (Oculta por defecto) -->
          <div id="preview-section" style="display: none; border-top: 1px solid var(--color-border); padding-top: 2rem; margin-top: 2rem;">
            <h4 style="margin-bottom: 1.25rem; font-size: 1.1rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-eye-line" style="color: var(--color-accent);"></i> Previsualización y Validación de Datos
            </h4>

            <!-- Tarjetas de Resumen -->
            <div style="display: flex; gap: 1.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 150px; padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background-color: var(--color-surface-hover); text-align: center;">
                <div style="font-size: 0.8rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 600;">Filas Leídas</div>
                <div id="summary-total" style="font-size: 1.75rem; font-weight: 700; color: var(--color-dark); margin-top: 0.25rem;">0</div>
              </div>
              <div style="flex: 1; min-width: 150px; padding: 1rem; border-radius: var(--radius-md); border: 1px solid #bbf7d0; background-color: #f0fdf4; text-align: center;">
                <div style="font-size: 0.8rem; color: #166534; text-transform: uppercase; font-weight: 600;">Válidos (Listos)</div>
                <div id="summary-valid" style="font-size: 1.75rem; font-weight: 700; color: #15803d; margin-top: 0.25rem;">0</div>
                <div id="summary-valid-detail" style="font-size: 0.75rem; color: #166534; margin-top: 0.25rem;">0 nuevos / 0 act.</div>
              </div>
              <div style="flex: 1; min-width: 150px; padding: 1rem; border-radius: var(--radius-md); border: 1px solid #fecaca; background-color: #fef2f2; text-align: center;">
                <div style="font-size: 0.8rem; color: #991b1b; text-transform: uppercase; font-weight: 600;">Errores (Se omitirán)</div>
                <div id="summary-errors" style="font-size: 1.75rem; font-weight: 700; color: #b91c1c; margin-top: 0.25rem;">0</div>
              </div>
            </div>

            <!-- Tabla contenedora scrollable -->
            <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
              <table class="data-table" style="min-width: 1100px;">
                <thead style="position: sticky; top: 0; background-color: var(--color-surface); z-index: 10; box-shadow: 0 1px 0 var(--color-border);">
                  <tr>
                    <th style="width: 110px;">Estado</th>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th>Cód. Barras</th>
                    <th>Tipo</th>
                    <th>Color</th>
                    <th>Variables</th>
                    <th>Talla</th>
                    <th>Dimensiones (L x An x Al)</th>
                    <th>Volumen (m³)</th>
                  </tr>
                </thead>
                <tbody id="preview-table-body">
                  <!-- Se inyecta dinámicamente -->
                </tbody>
              </table>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 1rem; align-items: center;">
              <span id="save-loader" style="display: none; color: var(--color-text-muted); font-size: 0.9rem; align-items: center; gap: 0.5rem;">
                <i class="ri-loader-2-line ri-spin" style="font-size: 1.25rem; color: var(--color-accent);"></i> Guardando productos...
              </span>
              <button type="button" id="btn-cancel-upload" class="btn btn-outline" style="border-color: var(--color-border);">Cancelar</button>
              <button type="button" id="btn-save-products" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.5rem;">
                <i class="ri-save-line"></i> Guardar Productos
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    setupUploadEventListeners();

  } catch (err) {
    console.error('Error rendering upload view:', err);
    appContent.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center;">
        <p style="color: red; font-weight: 600;">Error al cargar vista de planillas</p>
        <p style="color: var(--color-text-muted); font-size: 0.9rem;">${err.message || err}</p>
      </div>
    `;
  }
}

function setupUploadEventListeners() {
  const fileInput = document.getElementById('upload-file-input');
  const btnSelectFile = document.getElementById('btn-select-file');
  const selectedFileName = document.getElementById('selected-file-name');
  const btnDownloadTemplate = document.getElementById('btn-download-template');
  const btnClearUpload = document.getElementById('btn-clear-upload');
  const btnCancelUpload = document.getElementById('btn-cancel-upload');
  const btnSaveProducts = document.getElementById('btn-save-products');
  const dimensionRadios = document.getElementsByName('dimension-unit');

  // Trigger file dialog
  btnSelectFile.addEventListener('click', () => fileInput.click());

  // Handle template download
  btnDownloadTemplate.addEventListener('click', downloadSampleTemplate);

  // File selected handler
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFileName.textContent = file.name;
      btnClearUpload.style.display = 'inline-flex';
      handleFileSelection(file);
    }
  });

  // Radio button changes to recalculate volume instantly
  dimensionRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (currentRawJsonData.length > 0) {
        recalculateAndRender();
      }
    });
  });

  // Clear/Cancel action
  const resetAll = () => {
    fileInput.value = '';
    selectedFileName.textContent = 'Ningún archivo seleccionado';
    btnClearUpload.style.display = 'none';
    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('upload-alert-container').innerHTML = '';
    currentParsedProducts = [];
    currentRawJsonData = [];
  };

  btnClearUpload.addEventListener('click', resetAll);
  btnCancelUpload.addEventListener('click', resetAll);

  // Save Products
  btnSaveProducts.addEventListener('click', saveProductsToSupabase);

  // Recalculate on merchant change to verify if SKUs exist or are new
  const merchantSelect = document.getElementById('upload-merchant-select');
  if (merchantSelect) {
    merchantSelect.addEventListener('change', () => {
      if (currentRawJsonData.length > 0) {
        recalculateAndRender();
      }
    });
  }
}

function downloadSampleTemplate() {
  const headers = ['sku', 'Nombre', 'Codigo de barras', 'tipo', 'color', 'variable 1', 'variable 2', 'talla', 'largo', 'ancho', 'alto', 'volumen'];
  const rows = [
    ['CAM-BLANCA-M', 'Camiseta Algodon Blanca M', '7701234567890', 'Ropa', 'Blanco', 'Algodon', 'Manga Corta', 'M', '30', '25', '2', ''],
    ['ZAP-RUN-42', 'Zapatilla Deportiva Running 42', '7709876543210', 'Calzado', 'Negro', 'Running', 'Suela Goma', '42', '32', '20', '12', ''],
    ['CAJA-GRANDE', 'Caja de Carton Grande', '', 'Embalaje', 'Cafe', 'Corrugado', '', 'Unica', '1.0', '0.8', '0.6', '0.48']
  ];
  
  // Create CSV format with BOM for Spanish accents
  const csvContent = "\uFEFF" 
    + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "plantilla_productos_stocka.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function handleFileSelection(file) {
  const alertContainer = document.getElementById('upload-alert-container');
  alertContainer.innerHTML = '';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error("El archivo seleccionado no tiene hojas de cálculo legibles.");
      }
      
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
      
      if (!jsonData || jsonData.length === 0) {
        throw new Error("El archivo seleccionado no contiene filas de datos.");
      }
      
      currentRawJsonData = jsonData;
      recalculateAndRender();

    } catch (err) {
      console.error('Error parsing sheet file:', err);
      alertContainer.innerHTML = `
        <div class="alert alert-error" style="display: block; margin-bottom: 1.5rem;">
          <strong>Error al leer planilla:</strong> ${err.message || 'Formato incorrecto o archivo dañado.'}
        </div>
      `;
      document.getElementById('preview-section').style.display = 'none';
      currentParsedProducts = [];
      currentRawJsonData = [];
    }
  };

  reader.onerror = () => {
    alertContainer.innerHTML = `
      <div class="alert alert-error" style="display: block; margin-bottom: 1.5rem;">
        Error al leer el archivo físico. Inténtelo de nuevo.
      </div>
    `;
  };

  reader.readAsArrayBuffer(file);
}

let existingMerchantSkus = new Set();

async function loadExistingMerchantSkus() {
  const merchantSelect = document.getElementById('upload-merchant-select');
  const selectedMerchantSigla = merchantSelect ? merchantSelect.value : '';
  
  existingMerchantSkus.clear();
  if (!selectedMerchantSigla) return;

  try {
    const { data: profiles, error: pError } = await supabase
      .from('profiles')
      .select('id, comercio')
      .eq('role', 'client');

    if (pError || !profiles) return;

    const matchedProfile = profiles.find(p => {
      if (!p.comercio || p.comercio === 'no asignado') return false;
      const siglaList = p.comercio.split(',').map(s => s.trim().toLowerCase());
      return siglaList.includes(selectedMerchantSigla.toLowerCase()) || siglaList.includes('all');
    });

    if (matchedProfile) {
      const { data: existingProducts } = await supabase
        .from('products')
        .select('sku')
        .eq('comercio', selectedMerchantSigla);

      if (existingProducts) {
        existingProducts.forEach(p => {
          if (p.sku) existingMerchantSkus.add(p.sku.trim().toLowerCase());
        });
      }
    }
  } catch (err) {
    console.error("Error loading existing merchant SKUs:", err);
  }
}

async function recalculateAndRender() {
  const dimensionUnit = document.querySelector('input[name="dimension-unit"]:checked').value;
  
  // Cargar SKUs existentes antes de mapear
  await loadExistingMerchantSkus();
  
  currentParsedProducts = currentRawJsonData.map(row => {
    const normalized = normalizeRowKeys(row);
    const mapped = mapRowToProduct(normalized, dimensionUnit);
    
    if (mapped.isValid && mapped.sku) {
      mapped.isUpdate = existingMerchantSkus.has(mapped.sku.trim().toLowerCase());
    } else {
      mapped.isUpdate = false;
    }
    
    return mapped;
  });
  
  renderPreviewTable();
}

function normalizeRowKeys(row) {
  const normalized = {};
  for (const key in row) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const normKey = key.trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, '_');
      
      normalized[normKey] = row[key];
    }
  }
  return normalized;
}

function mapRowToProduct(row, dimensionUnit) {
  const findValue = (keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
        return row[k];
      }
    }
    return '';
  };

  const sku = findValue(['sku', 'cod_articulo', 'codigo_articulo', 'ref', 'codigo']).toString().trim();
  const name = findValue(['nombre', 'name', 'nombre_producto', 'title', 'titulo', 'descripcion_producto']).toString().trim();
  const barcode = findValue(['codigo_de_barras', 'codigo_barras', 'barcode', 'barras', 'cod_barras', 'ean', 'upc', 'cod_barra']).toString().trim();
  
  const type = findValue(['tipo', 'type', 'categoria', 'category', 'clase', 'rubro']).toString().trim();
  const color = findValue(['color', 'colour', 'tono', 'color_item']).toString().trim();
  const variable_1 = findValue(['variable_1', 'variable1', 'var_1', 'var1', 'variable', 'var1_atributo']).toString().trim();
  const variable_2 = findValue(['variable_2', 'variable2', 'var_2', 'var2', 'var2_atributo']).toString().trim();
  const talla = findValue(['talla', 'tallas', 'size', 'medida', 'talle']).toString().trim();

  // Dimensiones (numéricos)
  const largoVal = parseFloat(findValue(['largo', 'length', 'length_cm', 'largo_cm', 'longitud', 'depth']).toString().replace(',', '.'));
  const anchoVal = parseFloat(findValue(['ancho', 'width', 'width_cm', 'ancho_cm', 'anchura']).toString().replace(',', '.'));
  const altoVal = parseFloat(findValue(['alto', 'height', 'height_cm', 'alto_cm', 'altura']).toString().replace(',', '.'));
  
  const largo = isNaN(largoVal) ? null : largoVal;
  const ancho = isNaN(anchoVal) ? null : anchoVal;
  const alto = isNaN(altoVal) ? null : altoVal;

  // Volumen manual
  const volumenVal = parseFloat(findValue(['volumen', 'volume', 'volumen_m3', 'vol', 'm3']).toString().replace(',', '.'));
  let volumen = isNaN(volumenVal) ? null : volumenVal;
  let isCalculated = false;

  // Calcular si no viene el volumen y tenemos todas las dimensiones
  if (volumen === null && largo !== null && ancho !== null && alto !== null) {
    isCalculated = true;
    if (dimensionUnit === 'cm') {
      volumen = (largo * ancho * alto) / 1000000;
    } else {
      volumen = largo * ancho * alto;
    }
    volumen = Math.round(volumen * 1000000) / 1000000;
  }

  // Validaciones
  const errors = [];
  if (!sku) errors.push('Falta SKU');
  if (!name) errors.push('Falta Nombre');

  return {
    sku,
    name,
    barcode: barcode || null,
    type: type || null,
    color: color || null,
    variable_1: variable_1 || null,
    variable_2: variable_2 || null,
    talla: talla || null,
    largo,
    ancho,
    alto,
    volumen,
    isCalculated,
    isValid: errors.length === 0,
    errors
  };
}

function renderPreviewTable() {
  const products = currentParsedProducts || [];
  const totalEl = document.getElementById('summary-total');
  const validEl = document.getElementById('summary-valid');
  const errorsEl = document.getElementById('summary-errors');
  const tbody = document.getElementById('preview-table-body');
  const previewSection = document.getElementById('preview-section');
  const btnSave = document.getElementById('btn-save-products');

  if (products.length === 0) {
    previewSection.style.display = 'none';
    return;
  }

  previewSection.style.display = 'block';

  let validCount = 0;
  let errorCount = 0;
  let newCount = 0;
  let updateCount = 0;
  let tbodyHtml = '';

  products.forEach(p => {
    if (p.isValid) {
      validCount++;
      if (p.isUpdate) {
        updateCount++;
      } else {
        newCount++;
      }
    } else {
      errorCount++;
    }

    const statusHtml = p.isValid
      ? (p.isUpdate 
          ? `<span style="color: #d97706; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;" title="El SKU ya existe. Se actualizará con los nuevos datos."><i class="ri-refresh-line"></i> Actualizar</span>`
          : `<span style="color: #16a34a; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-add-circle-fill"></i> Nuevo</span>`
        )
      : `<span style="color: #dc2626; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;" title="${p.errors.join(', ')}"><i class="ri-error-warning-fill"></i> Error: ${p.errors.join(', ')}</span>`;

    const dimsHtml = (p.largo !== null || p.ancho !== null || p.alto !== null)
      ? `${p.largo ?? '-'} x ${p.ancho ?? '-'} x ${p.alto ?? '-'}`
      : `<span style="color: var(--color-text-muted); font-style: italic;">Sin dimens.</span>`;

    const volHtml = p.volumen !== null
      ? `${p.volumen.toFixed(6)} m³ ${p.isCalculated ? '<span style="color: var(--color-text-muted); font-size: 0.7rem; font-weight: normal;">(calc)</span>' : '<span style="color: var(--color-accent); font-size: 0.7rem; font-weight: bold;">(manual)</span>'}`
      : `<span style="color: var(--color-text-muted); font-style: italic;">N/A</span>`;

    const variablesHtml = (p.variable_1 || p.variable_2)
      ? `${p.variable_1 ? `V1: ${p.variable_1}` : ''}${p.variable_1 && p.variable_2 ? ', ' : ''}${p.variable_2 ? `V2: ${p.variable_2}` : ''}`
      : `<span style="color: var(--color-text-muted); font-style: italic;">-</span>`;

    tbodyHtml += `
      <tr style="${p.isValid ? '' : 'background-color: #fef2f2;'}">
        <td>${statusHtml}</td>
        <td style="font-weight: 700; color: var(--color-dark);">${p.sku}</td>
        <td>${p.name}</td>
        <td>${p.barcode || '-'}</td>
        <td>${p.type || '-'}</td>
        <td>${p.color || '-'}</td>
        <td>${variablesHtml}</td>
        <td>${p.talla || '-'}</td>
        <td>${dimsHtml}</td>
        <td style="font-weight: 600; font-family: monospace;">${volHtml}</td>
      </tr>
    `;
  });

  totalEl.textContent = products.length;
  validEl.textContent = validCount;
  errorsEl.textContent = errorCount;
  tbody.innerHTML = tbodyHtml;

  const validDetailEl = document.getElementById('summary-valid-detail');
  if (validDetailEl) {
    validDetailEl.textContent = `${newCount} nuevos / ${updateCount} por act.`;
  }

  btnSave.disabled = (validCount === 0);
  if (validCount === 0) {
    btnSave.style.opacity = '0.5';
    btnSave.style.cursor = 'not-allowed';
  } else {
    btnSave.style.opacity = '1';
    btnSave.style.cursor = 'pointer';
  }
}

async function saveProductsToSupabase() {
  const alertContainer = document.getElementById('upload-alert-container');
  const merchantSelect = document.getElementById('upload-merchant-select');
  const btnSave = document.getElementById('btn-save-products');
  const loader = document.getElementById('save-loader');
  
  alertContainer.innerHTML = '';
  
  const selectedSigla = merchantSelect.value;
  if (!selectedSigla) {
    alert("Por favor, seleccione un comercio antes de guardar los productos.");
    merchantSelect.focus();
    return;
  }

  const validProducts = currentParsedProducts.filter(p => p.isValid);
  if (validProducts.length === 0) {
    alert("No hay productos válidos para guardar.");
    return;
  }

  const confirmed = confirm(`¿Está seguro que desea cargar/actualizar ${validProducts.length} productos en el comercio seleccionado?`);
  if (!confirmed) return;

  btnSave.disabled = true;
  btnSave.style.opacity = '0.5';
  loader.style.display = 'inline-flex';

  let selectedMerchantId = null;

  try {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, company_name, email, comercio')
      .eq('role', 'client');

    if (profilesError) throw profilesError;

    // Buscar coincidencia de sigla en el comercio asignado del perfil
    const matchedProfile = profiles.find(p => {
      if (!p.comercio || p.comercio === 'no asignado') return false;
      const siglaList = p.comercio.split(',').map(s => s.trim().toLowerCase());
      return siglaList.includes(selectedSigla.toLowerCase()) || siglaList.includes('all');
    });

    if (!matchedProfile) {
      throw new Error(`No se encontró ningún usuario Cliente con el comercio '${selectedSigla}' asignado. Configure la asignación en 'Gestionar Usuarios' primero.`);
    }

    selectedMerchantId = matchedProfile.id;

  } catch (err) {
    console.error('Error matching commerce to merchant user:', err);
    alertContainer.innerHTML = `
      <div class="alert alert-error" style="display: block; margin-bottom: 1.5rem;">
        <strong>Error de asignación:</strong> ${err.message || 'No se pudo vincular el comercio con un usuario.'}
      </div>
    `;
    btnSave.disabled = false;
    btnSave.style.opacity = '1';
    loader.style.display = 'none';
    return;
  }

  try {
    const productsToInsert = validProducts.map(p => ({
      merchant_id: selectedMerchantId,
      comercio: selectedSigla,
      sku: p.sku,
      name: p.name,
      barcode: p.barcode,
      type: p.type,
      color: p.color,
      variable_1: p.variable_1,
      variable_2: p.variable_2,
      talla: p.talla,
      largo: p.largo,
      ancho: p.ancho,
      alto: p.alto,
      volumen: p.volumen,
      length: p.largo,
      width: p.ancho,
      height: p.alto
    }));

    const BATCH_SIZE = 100;
    let insertedCount = 0;

    for (let i = 0; i < productsToInsert.length; i += BATCH_SIZE) {
      const batch = productsToInsert.slice(i, i + BATCH_SIZE);
      const { error: upsertError } = await supabase
        .from('products')
        .upsert(batch, { onConflict: 'comercio,sku' });

      if (upsertError) throw upsertError;
      insertedCount += batch.length;
    }

    alertContainer.innerHTML = `
      <div class="alert alert-success" style="display: block; margin-bottom: 1.5rem;">
        <strong>¡Carga masiva completada!</strong> Se guardaron / actualizaron ${insertedCount} productos con éxito en el comercio.
      </div>
    `;

    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('upload-file-input').value = '';
    document.getElementById('selected-file-name').textContent = 'Ningún archivo seleccionado';
    document.getElementById('btn-clear-upload').style.display = 'none';
    currentParsedProducts = [];
    currentRawJsonData = [];

  } catch (err) {
    console.error('Error uploading products to Supabase:', err);
    alertContainer.innerHTML = `
      <div class="alert alert-error" style="display: block; margin-bottom: 1.5rem;">
        <strong>Error al guardar en base de datos:</strong> ${err.message || 'Verifique su conexión y los datos del archivo.'}
      </div>
    `;
  } finally {
    btnSave.disabled = false;
    btnSave.style.opacity = '1';
    loader.style.display = 'none';
  }
}

// ============================================================================
// Dashboard Admin Module
// ============================================================================

async function initNotifications(userId) {
  const btn = document.getElementById('notification-btn');
  const dropdown = document.getElementById('notification-dropdown');
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notification-list');
  const markReadBtn = document.getElementById('mark-all-read-btn');

  if (!btn || !dropdown) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn) {
      dropdown.style.display = 'none';
    }
  });

  async function fetchNotifications() {
    try {
      const { data, error } = await supabase
        .from('dashboard_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      if (!data || data.length === 0) {
        list.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">No tienes notificaciones.</div>';
        badge.style.display = 'none';
        markReadBtn.style.display = 'none';
        return;
      }

      const unreadCount = data.filter(n => !n.is_read).length;
      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'flex';
        markReadBtn.style.display = 'block';
      } else {
        badge.style.display = 'none';
        markReadBtn.style.display = 'none';
      }

      list.innerHTML = data.map(n => `
        <div class="notification-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
          <div class="notification-title">${n.title}</div>
          <div class="notification-message">${n.message}</div>
          <span class="notification-time">${new Date(n.created_at).toLocaleString()}</span>
        </div>
      `).join('');

      document.querySelectorAll('.notification-item.unread').forEach(item => {
        item.addEventListener('click', async () => {
          const id = item.getAttribute('data-id');
          await supabase.from('dashboard_notifications').update({ is_read: true }).eq('id', id);
          item.classList.remove('unread');
          fetchNotifications();
        });
      });

    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  }

  if(markReadBtn) {
    markReadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const { data } = await supabase.from('dashboard_notifications').select('id').eq('is_read', false);
        if(data && data.length > 0) {
          const ids = data.map(n => n.id);
          await supabase.from('dashboard_notifications').update({ is_read: true }).in('id', ids);
          fetchNotifications();
        }
      } catch(err) { console.error(err); }
    });
  }

  fetchNotifications();
  setInterval(fetchNotifications, 120000);
}

async function renderAdminDashboard() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `
    <div style="margin-bottom: 2rem;">
      <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Gestión de Dashboard</h2>
      <p style="color: var(--color-text-muted); font-size: 1rem;">Administra las noticias, eventos y envía notificaciones a los usuarios.</p>
    </div>

    <div class="dashboard-grid">
      <!-- Gestión de Noticias -->
      <div class="card" style="grid-column: 1 / -1;">
        <div class="card-header">
          <h3><i class="ri-newspaper-line" style="margin-right: 0.5rem; color: var(--color-accent);"></i> Gestión de Noticias</h3>
        </div>
        <div class="card-body" style="display: grid; grid-template-columns: 1fr 2fr; gap: 2rem;">
          <div>
            <form id="form-create-news">
              <input type="hidden" id="news-id">
              <div class="form-group">
                <label class="form-label">Título</label>
                <input type="text" id="news-title" class="form-input" required>
              </div>
              <div class="form-group">
                <label class="form-label">Subtítulo (Opcional)</label>
                <input type="text" id="news-subtitle" class="form-input">
              </div>
              <div class="form-group">
                <label class="form-label">Cuerpo de la Noticia</label>
                <textarea id="news-body" class="form-input" rows="4" required style="resize: vertical;"></textarea>
              </div>
              <div style="display: flex; gap: 1rem;">
                <button type="submit" id="btn-save-news" class="btn btn-primary" style="flex: 1;">Publicar Noticia</button>
                <button type="button" id="btn-cancel-news" class="btn btn-outline" style="display: none;">Cancelar</button>
              </div>
            </form>
          </div>
          <div>
            <h4>Noticias Publicadas</h4>
            <div id="admin-news-list" style="max-height: 400px; overflow-y: auto; margin-top: 1rem;">Cargando...</div>
          </div>
        </div>
      </div>

      <!-- Gestión de Eventos -->
      <div class="card" style="grid-column: 1 / -1;">
        <div class="card-header">
          <h3><i class="ri-calendar-event-line" style="margin-right: 0.5rem; color: var(--color-primary);"></i> Gestión de Eventos y Calendario</h3>
        </div>
        <div class="card-body" style="display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 1rem;">
          <div id="admin-calendar-grid-container" style="border-right: 1px solid var(--color-border); padding-right: 0.5rem; min-height: 380px; display: flex; align-items: center; justify-content: center; flex-direction: column;">
            <div style="color: var(--color-text-muted); font-size: 0.9rem;"><i class="ri-loader-4-line ri-spin" style="margin-right: 0.5rem;"></i> Cargando calendario...</div>
          </div>
          <div id="admin-calendar-list-container" style="border-right: 1px solid var(--color-border); padding-right: 0.5rem; min-height: 380px;">
          </div>
          <div style="padding-left: 0.5rem;">
            <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); margin-bottom: 1rem; background-color: var(--color-surface); border-radius: var(--radius-md) var(--radius-md) 0 0;">
              <h4 style="margin: 0; font-size: 0.9rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;"><i class="ri-add-circle-line" style="color: var(--color-primary);"></i> Crear o Editar Evento</h4>
            </div>
            <form id="form-create-event">
              <input type="hidden" id="event-id">
              <div class="form-group">
                <label class="form-label">Título del Evento</label>
                <input type="text" id="event-title" class="form-input" required>
              </div>
              <div class="form-group">
                <label class="form-label">Fecha y Hora</label>
                <input type="datetime-local" id="event-date" class="form-input" required>
              </div>
              <div class="form-group">
                <label class="form-label">Tipo de Evento (Color)</label>
                <select id="event-color" class="form-input" required>
                  <option value="info">Información (Azul)</option>
                  <option value="success">Éxito (Verde)</option>
                  <option value="warning">Alerta (Amarillo)</option>
                  <option value="alert">Crítico (Rojo)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Descripción</label>
                <textarea id="event-desc" class="form-input" rows="2"></textarea>
              </div>
              <div style="display: flex; gap: 1rem;">
                <button type="submit" id="btn-save-event" class="btn btn-primary" style="flex: 1;">Agendar Evento</button>
                <button type="button" id="btn-cancel-event" class="btn btn-outline" style="display: none;">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Gestión de Comunicaciones -->
      <div class="card" style="grid-column: 1 / -1;">
        <div class="card-header">
          <h3><i class="ri-broadcast-line" style="margin-right: 0.5rem; color: var(--color-warning);"></i> Gestión de Comunicaciones</h3>
        </div>
        <div class="card-body">
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2rem;">
            
            <!-- Barra Superior -->
            <div style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.5rem;">
              <h4 style="margin-top: 0; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-layout-top-line" style="color: var(--color-primary);"></i> Barra Superior</h4>
              <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem;">Crea un banner visible en el tope de la pantalla para todos los usuarios. Solo un banner activo a la vez.</p>
              <form id="form-create-banner">
                <input type="hidden" id="banner-id">
                <div class="form-group">
                  <label class="form-label">Texto del Aviso</label>
                  <input type="text" id="banner-content" class="form-input" required>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                  <div class="form-group">
                    <label class="form-label">Color de Fondo</label>
                    <input type="color" id="banner-bg" class="form-input" value="#2563eb" style="height: 40px; padding: 0.2rem;">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Color de Texto</label>
                    <input type="color" id="banner-text" class="form-input" value="#ffffff" style="height: 40px; padding: 0.2rem;">
                  </div>
                </div>
                <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem;">
                  <input type="checkbox" id="banner-active" style="width: 1.2rem; height: 1.2rem;">
                  <label for="banner-active" style="font-weight: 600; cursor: pointer; margin: 0;">Activar este Banner</label>
                </div>
                <button type="submit" class="btn btn-primary" style="width: 100%;">Guardar Barra Superior</button>
              </form>
            </div>

            <!-- Pop-up Interactivo -->
            <div style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.5rem;">
              <h4 style="margin-top: 0; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-window-line" style="color: var(--color-accent);"></i> Pop-up al Inicio</h4>
              <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem;">Muestra una ventana modal bloqueante al iniciar sesión que exige confirmación de lectura.</p>
              <form id="form-create-popup">
                <input type="hidden" id="popup-id">
                <div class="form-group">
                  <label class="form-label">Título del Pop-up</label>
                  <input type="text" id="popup-title" class="form-input" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Contenido Detallado</label>
                  <textarea id="popup-content" class="form-input" rows="4" required style="resize: vertical;"></textarea>
                </div>
                <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem;">
                  <input type="checkbox" id="popup-active" style="width: 1.2rem; height: 1.2rem;">
                  <label for="popup-active" style="font-weight: 600; cursor: pointer; margin: 0;">Activar este Pop-up</label>
                </div>
                <button type="submit" class="btn btn-primary" style="width: 100%; background-color: var(--color-accent);">Guardar Pop-up</button>
              </form>
            </div>

            <!-- Notificación Inbox -->
            <div style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.5rem;">
              <h4 style="margin-top: 0; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-mail-send-line" style="color: var(--color-warning);"></i> Enviar a Inbox</h4>
              <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem;">Envía una notificación directa a la campanita de los usuarios con segmentación.</p>
              <form id="form-create-notification">
                <div class="form-group">
                  <label class="form-label">Título del Mensaje</label>
                  <input type="text" id="notif-title" class="form-input" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Mensaje</label>
                  <input type="text" id="notif-message" class="form-input" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Destinatarios</label>
                  <select id="notif-target" class="form-input" required onchange="document.getElementById('notif-individual-container').style.display = this.value === 'individual' ? 'block' : 'none';">
                    <option value="all">Todos los usuarios</option>
                    <option value="client">Solo Clientes</option>
                    <option value="admin">Solo Administradores</option>
                    <option value="individual">Usuario Individual...</option>
                  </select>
                </div>
                <div class="form-group" id="notif-individual-container" style="display: none;">
                  <label class="form-label">Seleccionar Usuario</label>
                  <select id="notif-user-id" class="form-input">
                    <option value="">Cargando usuarios...</option>
                  </select>
                </div>
                <button type="submit" class="btn btn-primary" style="width: 100%; background-color: var(--color-warning); color: #000;">Enviar Notificación Directa</button>
              </form>
            </div>
            
          </div>
          
          <hr style="margin: 2rem 0;">
          <h4>Historial Reciente de Inbox</h4>
          <div id="admin-notif-list" style="max-height: 300px; overflow-y: auto; margin-top: 1rem;">Cargando...</div>
        </div>
      </div>
    </div>
  `;

  // Fetch and render functions
  async function loadAdminData() {
    // Load News
    const { data: news } = await supabase.from('dashboard_news').select('*').order('created_at', { ascending: false });
    window.adminNewsData = news || [];
    const newsList = document.getElementById('admin-news-list');
    if(news && news.length > 0) {
      newsList.innerHTML = news.map(n => `
        <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600;">${n.title}</div>
            <div style="font-size: 0.8rem; color: var(--color-text-muted);">${new Date(n.created_at).toLocaleDateString()}</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-outline edit-news-btn" data-id="${n.id}" style="padding: 0.25rem 0.5rem;"><i class="ri-edit-line"></i></button>
            <button class="btn btn-outline delete-news-btn" data-id="${n.id}" style="padding: 0.25rem 0.5rem; color: var(--color-danger); border-color: var(--color-danger);"><i class="ri-delete-bin-line"></i></button>
          </div>
        </div>
      `).join('');
    } else {
      newsList.innerHTML = '<p style="color: var(--color-text-muted);">No hay noticias publicadas.</p>';
    }

    // Load Events
    const { data: events } = await supabase.from('dashboard_events').select('*').order('event_date', { ascending: false });
    
    // Initialize Admin Calendar State if not exists
    if (!window.adminCalendarState) {
      window.adminCalendarState = { currentDate: new Date(), selectedDateStr: null, events: [] };
    }
    window.adminCalendarState.events = events || [];

    const gridContainer = document.getElementById('admin-calendar-grid-container');
    const listContainer = document.getElementById('admin-calendar-list-container');
    if (gridContainer && listContainer && window.renderCalendarUI) {
      gridContainer.style.display = 'block';
      gridContainer.innerHTML = window.renderCalendarUI(window.adminCalendarState.events, window.adminCalendarState.currentDate, window.adminCalendarState.selectedDateStr);
      listContainer.innerHTML = renderAdminEventsListUI(window.adminCalendarState.events, window.adminCalendarState.selectedDateStr);
      setupCalendarListeners_admin();
    }

    // Load Notifications (Inbox)
    const { data: notifs } = await supabase.from('dashboard_notifications').select('*').order('created_at', { ascending: false }).limit(20);
    const notifList = document.getElementById('admin-notif-list');
    if(notifs && notifs.length > 0) {
      notifList.innerHTML = notifs.map(n => `
        <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600;">${n.title}</div>
            <div style="font-size: 0.8rem; color: var(--color-text-muted);">Enviado a: ${n.target_role === 'individual' ? 'Usuario Individual' : n.target_role} - ${new Date(n.created_at).toLocaleString()}</div>
          </div>
          <div>
            <button class="btn btn-outline delete-notif-btn" data-id="${n.id}" style="padding: 0.25rem 0.5rem; color: var(--color-danger); border-color: var(--color-danger);"><i class="ri-delete-bin-line"></i></button>
          </div>
        </div>
      `).join('');
    } else {
      notifList.innerHTML = '<p style="color: var(--color-text-muted);">No hay notificaciones enviadas recientemente.</p>';
    }

    // Load active banner and popups (Admin view simply loads the latest to populate the form if they want to edit, or we can just list them. We'll populate form with latest active)
    const { data: banners } = await supabase.from('system_banners').select('*').order('created_at', { ascending: false }).limit(1);
    if(banners && banners.length > 0) {
      const b = banners[0];
      document.getElementById('banner-id').value = b.id;
      document.getElementById('banner-content').value = b.content;
      document.getElementById('banner-bg').value = b.bg_color;
      document.getElementById('banner-text').value = b.text_color;
      document.getElementById('banner-active').checked = b.is_active;
    }

    const { data: popups } = await supabase.from('system_popups').select('*').order('created_at', { ascending: false }).limit(1);
    if(popups && popups.length > 0) {
      const p = popups[0];
      document.getElementById('popup-id').value = p.id;
      document.getElementById('popup-title').value = p.title;
      document.getElementById('popup-content').value = p.content;
      document.getElementById('popup-active').checked = p.is_active;
    }

    // Load profiles for direct messaging
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').order('full_name', { ascending: true });
    const userSelect = document.getElementById('notif-user-id');
    if (userSelect && profiles) {
      userSelect.innerHTML = '<option value="">-- Seleccione un Usuario --</option>' + profiles.map(p => `<option value="${p.id}">${p.full_name || 'Sin Nombre'} (${p.email || 'Sin Correo'})</option>`).join('');
    }

    attachEditDeleteListeners(window.adminNewsData || [], window.adminCalendarState.events);
  }

  function attachEditDeleteListeners(newsData, eventsData) {
    // News Delete
    document.querySelectorAll('.delete-news-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if(confirm('¿Eliminar esta noticia?')) {
          await supabase.from('dashboard_news').delete().eq('id', e.currentTarget.getAttribute('data-id'));
          loadAdminData();
        }
      });
    });
    // Events Delete
    document.querySelectorAll('.delete-event-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if(confirm('¿Eliminar este evento?')) {
          await supabase.from('dashboard_events').delete().eq('id', e.currentTarget.getAttribute('data-id'));
          loadAdminData();
        }
      });
    });
    // Notif Delete
    document.querySelectorAll('.delete-notif-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if(confirm('¿Eliminar esta notificación?')) {
          await supabase.from('dashboard_notifications').delete().eq('id', e.currentTarget.getAttribute('data-id'));
          loadAdminData();
        }
      });
    });

    // Edit News
    document.querySelectorAll('.edit-news-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const n = newsData.find(x => x.id === id);
        if(n) {
          document.getElementById('news-id').value = n.id;
          document.getElementById('news-title').value = n.title;
          document.getElementById('news-subtitle').value = n.subtitle || '';
          document.getElementById('news-body').value = n.body;
          document.getElementById('btn-save-news').textContent = 'Actualizar Noticia';
          document.getElementById('btn-cancel-news').style.display = 'block';
        }
      });
    });
    // Edit Events
    document.querySelectorAll('.edit-event-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const ev = eventsData.find(x => x.id === id);
        if(ev) {
          document.getElementById('event-id').value = ev.id;
          document.getElementById('event-title').value = ev.title;
          document.getElementById('event-desc').value = ev.description || '';
          
          // Format date for datetime-local (YYYY-MM-DDThh:mm)
          const d = new Date(ev.event_date);
          const formattedDate = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
          document.getElementById('event-date').value = formattedDate;
          
          document.getElementById('event-color').value = ev.color_type;
          document.getElementById('btn-save-event').textContent = 'Actualizar Evento';
          document.getElementById('btn-cancel-event').style.display = 'block';
        }
      });
    });
  }

  function renderAdminEventsListUI(events, selectedDateStr) {
    let filteredEvents = events;
    let title = 'Todos los Eventos (Admin)';

    if (selectedDateStr) {
      filteredEvents = events.filter(e => e.event_date.startsWith(selectedDateStr));
      const [y, m, d] = selectedDateStr.split('-');
      title = `Eventos del ${d}/${m}/${y}`;
    }

    if (filteredEvents.length === 0) {
      return `
        <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); background-color: var(--color-surface); border-radius: 0 var(--radius-md) 0 0;">
          <h4 style="margin: 0; font-size: 0.9rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;"><i class="ri-list-check" style="color: var(--color-primary);"></i> ${title}</h4>
        </div>
        <div style="padding: 3rem 1.5rem; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">
          <i class="ri-calendar-check-line" style="font-size: 3rem; display: block; margin-bottom: 1rem; opacity: 0.3; color: var(--color-text-muted);"></i>
          No hay eventos programados.
        </div>`;
    }

    const listHtml = filteredEvents.map(e => {
      const d = new Date(e.event_date);
      const timeStr = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      let colorClass = e.color_type || 'primary';
      if (colorClass === 'info') colorClass = 'primary';
      
      return `
        <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: flex-start; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='var(--color-surface-hover)'" onmouseout="this.style.backgroundColor='transparent'">
          <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem; color: var(--color-text-main);">
              <span style="width: 8px; height: 8px; border-radius: 50%; background-color: var(--color-${colorClass}); display: inline-block;"></span>
              ${e.title}
            </div>
            <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.25rem;"><i class="ri-time-line"></i> ${timeStr} - ${d.toLocaleDateString('es')}</div>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.85rem; color: var(--color-text-muted); line-height: 1.4;">${e.description || 'Sin descripción'}</p>
          </div>
          <div style="display: flex; gap: 0.5rem; margin-left: 1rem;">
            <button class="btn btn-outline edit-event-btn" data-id="${e.id}" style="padding: 0.25rem 0.5rem; border-color: var(--color-border);"><i class="ri-edit-line"></i></button>
            <button class="btn btn-outline delete-event-btn" data-id="${e.id}" style="padding: 0.25rem 0.5rem; color: var(--color-danger); border-color: var(--color-danger);"><i class="ri-delete-bin-line"></i></button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="padding: 1rem; border-bottom: 1px solid var(--color-border); background-color: var(--color-surface); border-radius: 0 var(--radius-md) 0 0;">
        <h4 style="margin: 0; font-size: 0.9rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;"><i class="ri-list-check" style="color: var(--color-primary);"></i> ${title}</h4>
      </div>
      <div style="max-height: 380px; overflow-y: auto;">
        ${listHtml}
      </div>
    `;
  }

  function setupCalendarListeners_admin() {
    const prevBtn = document.getElementById('cal-prev-month');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        window.adminCalendarState.currentDate.setMonth(window.adminCalendarState.currentDate.getMonth() - 1);
        window.adminCalendarState.selectedDateStr = null;
        loadAdminData(); // re-render
      });
    }
    
    const nextBtn = document.getElementById('cal-next-month');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        window.adminCalendarState.currentDate.setMonth(window.adminCalendarState.currentDate.getMonth() + 1);
        window.adminCalendarState.selectedDateStr = null;
        loadAdminData();
      });
    }

    document.querySelectorAll('.cal-day-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.getAttribute('data-date');
        if (window.adminCalendarState.selectedDateStr === dateStr) {
          window.adminCalendarState.selectedDateStr = null;
        } else {
          window.adminCalendarState.selectedDateStr = dateStr;
        }
        
        const gridContainer = document.getElementById('admin-calendar-grid-container');
        const listContainer = document.getElementById('admin-calendar-list-container');
        if (gridContainer && listContainer && window.renderCalendarUI) {
          gridContainer.innerHTML = window.renderCalendarUI(window.adminCalendarState.events, window.adminCalendarState.currentDate, window.adminCalendarState.selectedDateStr);
          listContainer.innerHTML = renderAdminEventsListUI(window.adminCalendarState.events, window.adminCalendarState.selectedDateStr);
          setupCalendarListeners_admin();
          attachEditDeleteListeners(window.adminNewsData || [], window.adminCalendarState.events); // Re-attach because list re-rendered
        }
      });
    });
  }

  // Cancel buttons
  document.getElementById('btn-cancel-news').addEventListener('click', () => {
    document.getElementById('form-create-news').reset();
    document.getElementById('news-id').value = '';
    document.getElementById('btn-save-news').textContent = 'Publicar Noticia';
    document.getElementById('btn-cancel-news').style.display = 'none';
  });
  
  document.getElementById('btn-cancel-event').addEventListener('click', () => {
    document.getElementById('form-create-event').reset();
    document.getElementById('event-id').value = '';
    document.getElementById('btn-save-event').textContent = 'Agendar Evento';
    document.getElementById('btn-cancel-event').style.display = 'none';
  });

  loadAdminData();

  // Handlers
  document.getElementById('form-create-news').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const id = document.getElementById('news-id').value;
      const payload = {
        title: document.getElementById('news-title').value,
        subtitle: document.getElementById('news-subtitle').value,
        body: document.getElementById('news-body').value,
        target_role: 'all'
      };

      if (id) {
        await supabase.from('dashboard_news').update(payload).eq('id', id);
        alert('Noticia actualizada exitosamente');
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        payload.created_by = user.id;
        await supabase.from('dashboard_news').insert([payload]);
        alert('Noticia publicada exitosamente');
      }
      
      document.getElementById('btn-cancel-news').click(); // reset form
      loadAdminData();
    } catch(err) { console.error(err); alert('Error al guardar noticia'); }
  });

  document.getElementById('form-create-event').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const id = document.getElementById('event-id').value;
      const payload = {
        title: document.getElementById('event-title').value,
        description: document.getElementById('event-desc').value,
        event_date: new Date(document.getElementById('event-date').value).toISOString(),
        color_type: document.getElementById('event-color').value,
        target_role: 'all'
      };

      if (id) {
        await supabase.from('dashboard_events').update(payload).eq('id', id);
        alert('Evento actualizado exitosamente');
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        payload.created_by = user.id;
        await supabase.from('dashboard_events').insert([payload]);
        alert('Evento agendado exitosamente');
      }

      document.getElementById('btn-cancel-event').click(); // reset form
      loadAdminData();
    } catch(err) { console.error(err); alert('Error al guardar evento'); }
  });

  document.getElementById('form-create-banner').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = {
        content: document.getElementById('banner-content').value,
        bg_color: document.getElementById('banner-bg').value,
        text_color: document.getElementById('banner-text').value,
        is_active: document.getElementById('banner-active').checked
      };
      
      const existingId = document.getElementById('banner-id').value;
      if (existingId) {
        await supabase.from('system_banners').update(payload).eq('id', existingId);
      } else {
        await supabase.from('system_banners').insert([payload]);
      }
      
      // If activated, optionally deactivate others. For simplicity, we just keep one or assume the admin knows.
      if (payload.is_active && existingId) {
         await supabase.from('system_banners').update({is_active: false}).neq('id', existingId);
      }

      alert('Barra superior guardada');
      loadAdminData();
    } catch(err) { console.error(err); alert('Error al guardar banner'); }
  });

  document.getElementById('form-create-popup').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = {
        title: document.getElementById('popup-title').value,
        content: document.getElementById('popup-content').value,
        is_active: document.getElementById('popup-active').checked
      };
      
      const existingId = document.getElementById('popup-id').value;
      if (existingId) {
        await supabase.from('system_popups').update(payload).eq('id', existingId);
      } else {
        await supabase.from('system_popups').insert([payload]);
      }
      
      if (payload.is_active && existingId) {
         await supabase.from('system_popups').update({is_active: false}).neq('id', existingId);
      }

      alert('Pop-up guardado');
      loadAdminData();
    } catch(err) { console.error(err); alert('Error al guardar pop-up'); }
  });

  document.getElementById('form-create-notification').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const target = document.getElementById('notif-target').value;
      let userId = null;
      if (target === 'individual') {
        userId = document.getElementById('notif-user-id').value;
        if (!userId) {
          alert('Debes seleccionar un usuario para el envío individual');
          return;
        }
      }

      await supabase.from('dashboard_notifications').insert([{
        title: document.getElementById('notif-title').value,
        message: document.getElementById('notif-message').value,
        target_role: target,
        user_id: userId
      }]);
      alert('Notificación de Inbox enviada exitosamente');
      e.target.reset();
      document.getElementById('notif-individual-container').style.display = 'none';
      loadAdminData();
    } catch(err) { console.error(err); alert('Error al enviar notificación'); }
  });
}



