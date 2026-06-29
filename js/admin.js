import supabase from './supabase.js';
import { renderTicketsAdmin } from './tickets.js';
import { initChatWidget } from './chat.js';


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

// Global function to toggle table action menus
window.toggleTableActionMenu = function(event, btn) {
  event.stopPropagation();
  // Close any other open menus first
  document.querySelectorAll('.table-action-menu-content.show').forEach(menu => {
    if (menu !== btn.nextElementSibling) {
      menu.classList.remove('show');
    }
  });
  // Toggle the clicked menu
  btn.nextElementSibling.classList.toggle('show');
};

// Close all table action menus when clicking anywhere else
document.addEventListener('click', function() {
  document.querySelectorAll('.table-action-menu-content.show').forEach(menu => {
    menu.classList.remove('show');
  });
});

// Formateador de moneda en pesos chilenos (CLP)
window.formatCLP = function(value) {
  if (value === null || value === undefined || isNaN(value) || value === '') {
    return '-';
  }
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(value);
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

function getDisplayStatusName(rawStatus) {
  if (!rawStatus) return 'Desconocido';
  const statusLower = rawStatus.trim().toLowerCase();
  switch (statusLower) {
    case 'delivered':
      return 'Entregado';
    case 'reviewing':
      return 'Creado';
    case 'skipped':
      return 'Reprogramado';
    default:
      const clean = rawStatus.replace(/_/g, ' ').trim();
      return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }
}

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
      .select('role, company_name, full_name, allowed_modules, comercio')
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

    // Check billing suspension status for assigned commerce
    if (profile && profile.comercio) {
      checkBillingSuspension(profile.comercio);
    }
    
    // Restaurar y configurar el estado colapsado del sidebar
    const sidebar = document.querySelector('.sidebar');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar');
    const toggleIcon = toggleSidebarBtn?.querySelector('i');
    
    const isSidebarCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    if (isSidebarCollapsed && sidebar) {
      sidebar.classList.add('collapsed');
      if (toggleSidebarBtn) toggleSidebarBtn.setAttribute('title', 'Expandir menú');
      if (toggleIcon) toggleIcon.className = 'ri-menu-unfold-line';
    }

    if (toggleSidebarBtn) {
      toggleSidebarBtn.addEventListener('click', () => {
        if (sidebar) {
          sidebar.classList.toggle('collapsed');
          const collapsed = sidebar.classList.contains('collapsed');
          localStorage.setItem('sidebar-collapsed', collapsed ? 'true' : 'false');
          if (toggleSidebarBtn) {
            toggleSidebarBtn.setAttribute('title', collapsed ? 'Expandir menú' : 'Contraer menú');
          }
          if (toggleIcon) {
            toggleIcon.className = collapsed ? 'ri-menu-unfold-line' : 'ri-menu-fold-line';
          }
        }
      });
    }

    // Navigation and Filtering
    if (navItems) {
      navItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const targetItem = e.target.closest('.nav-item');
          if (!targetItem) return;

          navItems.forEach(n => n.classList.remove('active'));
          targetItem.classList.add('active');

          const view = targetItem.getAttribute('data-view');
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
          } else if (view === 'declarations_admin') {
            viewTitle.textContent = 'Ingresos de Stock';
            renderDeclarationsAdmin();
          } else if (view === 'upload_products_admin') {
            viewTitle.textContent = 'Carga de Planillas';
            renderUploadProducts();
          } else if (view === 'users_admin') {
            viewTitle.textContent = 'Gestionar Usuarios';
            renderUsersAdmin();
          } else if (view === 'warehouses_admin') {
            viewTitle.textContent = 'Gestionar Bodegas';
            renderWarehousesAdmin();
          } else if (view === 'visibility_rules_admin') {
            viewTitle.textContent = 'Reglas de Visibilidad';
            renderVisibilityRulesAdmin();
          } else if (view === 'integrations') {
            viewTitle.textContent = 'Integraciones';
            renderIntegrations();
          } else if (view === 'billing_admin') {
            viewTitle.textContent = 'Facturación';
            renderBillingAdmin();
          } else if (view === 'profile') {
            viewTitle.textContent = 'Mi Perfil';
            renderProfile();
          } else if (view === 'inbox') {
            viewTitle.textContent = 'Mi Inbox';
            renderInboxPage();
          } else if (view === 'tickets_admin') {
            viewTitle.textContent = 'Gestión de Tickets';
            const appContent = document.getElementById('app-content');
            renderTicketsAdmin(appContent);
          } else if (view === 'documentation_admin') {
            viewTitle.textContent = 'Documentación del Servicio';
            renderDocsAdmin();
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
          if (allowedModules.includes(view) || view === 'dashboard' || view === 'profile' || view === 'inbox') {
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
      // Ocultar cabeceras de categorías vacías
      updateCategoryHeadersVisibility();
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
      } else if (e.target && e.target.classList.contains('wms-status-select')) {
        const orderId = e.target.getAttribute('data-order-id');
        const newWmsStatus = e.target.value;
        console.log(`DEBUG: Cambiando estado WMS de pedido ${orderId} a ${newWmsStatus}...`);
        await window.updateWmsOrderStatus(orderId, newWmsStatus);
      }
    });

    // Notification Logic
    initNotifications(session.user.id);

  } catch (err) {
    console.error('DEBUG: Error crítico durante la inicialización de admin.js:', err);
  }
}

// Ocultar cabeceras de categorías vacías en el menú
function updateCategoryHeadersVisibility() {
  const listItems = Array.from(document.querySelectorAll('.sidebar-nav > ul > li'));
  let currentHeader = null;
  let hasVisibleItems = false;
  
  listItems.forEach(li => {
    if (li.classList.contains('sidebar-category-header')) {
      if (currentHeader && !hasVisibleItems) {
        currentHeader.style.display = 'none';
      }
      currentHeader = li;
      hasVisibleItems = false;
    } else {
      if (li.style.display !== 'none') {
        hasVisibleItems = true;
      }
    }
  });
  
  if (currentHeader && !hasVisibleItems) {
    currentHeader.style.display = 'none';
  }
}

// Ejecutar inicialización
init();
initChatWidget();

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

window.toggleOrderRow = function(orderId) {
  const row = document.getElementById(`row-${orderId}`);
  const detailsRow = document.getElementById(`details-${orderId}`);
  const chevron = document.getElementById(`chevron-${orderId}`);
  if (!row || !detailsRow || !chevron) return;

  const isExpanded = row.classList.contains('expanded');
  if (isExpanded) {
    row.classList.remove('expanded');
    detailsRow.style.display = 'none';
    chevron.style.transform = 'rotate(0deg)';
  } else {
    row.classList.add('expanded');
    detailsRow.style.display = 'table-row';
    chevron.style.transform = 'rotate(90deg)';
  }
};
window.toggleRawOrderJson = function(orderId) {
  const container = document.getElementById(`raw-json-${orderId}`);
  if (!container) return;
  const isHidden = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
};

async function renderAdminOrders() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando todos los pedidos...</p>`;

  // Reset/Init WMS state
  window.wmsActiveTab = window.wmsActiveTab || 'Todos';
  window.wmsPageSize = window.wmsPageSize !== undefined ? window.wmsPageSize : 25;
  window.wmsCurrentPage = window.wmsCurrentPage || 1;
  window.wmsSelectedOrderIds = window.wmsSelectedOrderIds || new Set();

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        status,
        estado_wms,
        created_at,
        external_order_number,
        external_platform,
        origen,
        item,
        cantidad,
        sku,
        label_base64,
        total_value,
        customer_name,
        customer_email,
        customer_phone,
        shipping_address,
        shipping_city,
        shipping_complement,
        shipping_method,
        payment_status,
        tracking_number,
        tracking_url,
        courier,
        raw_woocommerce_data,
        raw_falabella_data,
        raw_meli_data,
        raw_optiroute_data,
        raw_lightdata_data,
        raw_paris_data,
        comercio,
        order_items (quantity, products(sku, name, price))
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    window.loadedOrders = orders || [];

    // Obtener los despachos correspondientes de la tabla envios_unificados (sin filtrar visible_to_client para el admin)
    let shipments = [];
    if (orders && orders.length > 0) {
      const orderRefs = orders.map(o => o.external_order_number).filter(Boolean);
      const orderIds = orders.map(o => o.id);
      const allRefs = [...orderRefs, ...orderIds];

      const { data: shipData, error: shipError } = await supabase
        .from('envios_unificados')
        .select('*')
        .in('pedido_referencia', allRefs);

      if (!shipError && shipData) {
        shipments = shipData;
      }
    }
    window.loadedShipments = shipments;

    // Obtener las opciones únicas de Comercios/Clientes para el filtro
    const uniqueMerchants = [...new Set(orders.map(o => o.comercio).filter(Boolean))].sort();
    const merchantOptions = uniqueMerchants.map(m => `<option value="${m}">${m}</option>`).join('');
    const statusOptions = ALL_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('');

    appContent.innerHTML = `
      <!-- Tarjetas de KPI -->
      <div class="orders-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-info-bg); color: var(--badge-info-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-shopping-bag-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">Total Pedidos</span>
            <strong id="kpi-total-orders" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">0</strong>
          </div>
        </div>
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-warning-bg); color: var(--badge-warning-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-time-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">Para Procesar</span>
            <strong id="kpi-to-process" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">0</strong>
          </div>
        </div>
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-success-bg); color: var(--badge-success-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-hammer-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">En Preparación</span>
            <strong id="kpi-in-prep" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">0</strong>
          </div>
        </div>
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-neutral-bg); color: var(--badge-neutral-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-money-dollar-circle-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">Ventas Totales</span>
            <strong id="kpi-total-sales" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">$0</strong>
          </div>
        </div>
      </div>

      <!-- Panel de Filtros -->
      <div class="filters-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; align-items: end;">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-search-line"></i> Buscar Pedido</label>
            <input type="text" id="search-orders" class="form-input" placeholder="Buscar por ID, SKU, Cliente, Tracking..." style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-store-2-line"></i> Comercio / Cliente</label>
            <select id="filter-merchant" class="form-input" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
              <option value="">Todos los comercios</option>
              ${merchantOptions}
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-plug-line"></i> Origen / Integración</label>
            <select id="filter-origen" class="form-input" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
              <option value="">Todos los orígenes</option>
              <option value="Shopify">Shopify</option>
              <option value="WooCommerce">WooCommerce</option>
              <option value="MercadoLibre">Mercado Libre</option>
              <option value="Falabella">Falabella</option>
              <option value="Paris">Paris</option>
              <option value="Manual">Manual</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-checkbox-circle-line"></i> Estado Origen</label>
            <select id="filter-status" class="form-input" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
              <option value="">Todos los estados</option>
              ${statusOptions}
            </select>
          </div>
        </div>
      </div>

      <!-- Agrupación por Pestañas de Estado WMS -->
      <div id="wms-tabs-container" style="margin-bottom: 1.25rem;"></div>

      <!-- Barra de Acciones Masivas -->
      <div id="wms-bulk-actions-container"></div>

      <!-- Tabla de Pedidos -->
      <div class="card">
        <div class="card-header">
          <h3>Panel de Control de Pedidos</h3>
        </div>
        <div class="card-body" style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">
                  <input type="checkbox" id="wms-select-all" onclick="window.toggleWmsSelectAll(this)" style="width: 16px; height: 16px; accent-color: var(--color-primary); cursor: pointer;">
                </th>
                <th style="width: 40px; text-align: center;"></th>
                <th>ID</th>
                <th>Comercio</th>
                <th>Origen</th>
                <th>Fecha</th>
                <th>SKU</th>
                <th>Nombre Producto</th>
                <th>Cantidad</th>
                <th style="text-align:right;">Valor Total</th>
                <th>Seguimiento</th>
                <th>Etiqueta</th>
                <th>Estado Origen</th>
                <th>Estado WMS</th>
              </tr>
            </thead>
            <tbody id="orders-tbody">
              <!-- Carga dinámica -->
            </tbody>
          </table>
        </div>
        <!-- Paginación -->
        <div id="wms-pagination-container" style="padding: 1rem; border-top: 1px solid var(--color-border);"></div>
      </div>
    `;

    // Escuchar eventos para aplicar filtros
    const searchInput = document.getElementById('search-orders');
    const merchantSelect = document.getElementById('filter-merchant');
    const origenSelect = document.getElementById('filter-origen');
    const statusSelect = document.getElementById('filter-status');

    const triggerFilterUpdate = () => {
      window.wmsCurrentPage = 1; // reset a la pág 1 en cada filtro nuevo
      applyWmsFiltersAndRender();
    };

    if (searchInput) searchInput.addEventListener('keyup', triggerFilterUpdate);
    if (merchantSelect) merchantSelect.addEventListener('change', triggerFilterUpdate);
    if (origenSelect) origenSelect.addEventListener('change', triggerFilterUpdate);
    if (statusSelect) statusSelect.addEventListener('change', triggerFilterUpdate);

    // Primera renderización de datos
    applyWmsFiltersAndRender();

  } catch (error) {
    console.error('Error fetching orders:', error);
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar pedidos: ${error.message}</p>`;
  }
}

window.applyWmsFiltersAndRender = function() {
  const orders = window.loadedOrders || [];
  const shipments = window.loadedShipments || [];

  const searchInput = document.getElementById('search-orders');
  const merchantSelect = document.getElementById('filter-merchant');
  const origenSelect = document.getElementById('filter-origen');
  const statusSelect = document.getElementById('filter-status');

  const searchText = (searchInput?.value || '').toLowerCase();
  const selectedMerchant = merchantSelect?.value || '';
  const selectedOrigen = origenSelect?.value || '';
  const selectedStatus = statusSelect?.value || '';

  // Filtro de base para los dropdowns y buscador
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

    return matchesSearch && matchesMerchant && matchesOrigen && matchesStatus;
  };

  // 1. Obtener conteo de pestañas
  const getTabCount = (tabName) => {
    return orders.filter(o => {
      const matchBase = matchesBaseFilters(o);
      const matchTab = tabName === 'Todos' || o.estado_wms === tabName;
      return matchBase && matchTab;
    }).length;
  };

  const tabs = ['Todos', 'En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia'];
  const tabsHtml = tabs.map(tab => {
    const isActive = window.wmsActiveTab === tab;
    const count = getTabCount(tab);
    let badgeBg = 'var(--color-bg)';
    let badgeColor = 'var(--color-text-muted)';
    if (tab === 'Incidencia') {
      badgeBg = '#fee2e2';
      badgeColor = '#ef4444';
    } else if (tab === 'Pickeado' || tab === 'Despachado') {
      badgeBg = '#dcfce7';
      badgeColor = '#22c55e';
    } else if (tab === 'En preparación') {
      badgeBg = '#fef3c7';
      badgeColor = '#d97706';
    } else if (tab === 'En procesamiento') {
      badgeBg = '#e0f2fe';
      badgeColor = '#0284c7';
    }

    return `
      <button onclick="window.setWmsTab('${tab}')" style="background: ${isActive ? 'var(--color-primary)' : 'transparent'}; color: ${isActive ? '#ffffff' : 'var(--color-text-main)'}; border: ${isActive ? 'none' : '1px solid var(--color-border)'}; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.825rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; transition: all 0.2s;">
        ${tab}
        <span style="background: ${isActive ? 'rgba(255,255,255,0.2)' : badgeBg}; color: ${isActive ? '#ffffff' : badgeColor}; padding: 0.15rem 0.45rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">${count}</span>
      </button>
    `;
  }).join('');
  
  const tabsContainer = document.getElementById('wms-tabs-container');
  if (tabsContainer) {
    tabsContainer.innerHTML = `
      <div style="display: flex; gap: 0.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem; flex-wrap: wrap;">
        ${tabsHtml}
      </div>
    `;
  }

  // 2. Filtrar lista de pedidos completa
  const filtered = orders.filter(o => {
    const matchBase = matchesBaseFilters(o);
    const matchTab = window.wmsActiveTab === 'Todos' || o.estado_wms === window.wmsActiveTab;
    return matchBase && matchTab;
  });

  // Actualizar KPIs de forma local con la pestaña activa
  const totalOrders = filtered.length;
  const ordersToProcess = filtered.filter(o => o.estado_wms === 'En procesamiento').length;
  const ordersInPrep = filtered.filter(o => o.estado_wms === 'En preparación').length;
  const totalSales = filtered.filter(o => o.estado_wms !== 'Incidencia' && o.status !== 'cancelado').reduce((sum, o) => sum + (Number(o.total_value) || 0), 0);

  document.getElementById('kpi-total-orders').textContent = totalOrders;
  document.getElementById('kpi-to-process').textContent = ordersToProcess;
  document.getElementById('kpi-in-prep').textContent = ordersInPrep;
  document.getElementById('kpi-total-sales').textContent = window.formatCLP(totalSales);

  // 3. Paginación
  const totalResults = filtered.length;
  const pageSize = window.wmsPageSize === 'All' ? totalResults : parseInt(window.wmsPageSize, 10);
  const totalPages = pageSize > 0 ? Math.ceil(totalResults / pageSize) : 1;

  if (window.wmsCurrentPage > totalPages) window.wmsCurrentPage = totalPages;
  if (window.wmsCurrentPage < 1) window.wmsCurrentPage = 1;

  const startIndex = (window.wmsCurrentPage - 1) * pageSize;
  const endIndex = pageSize === totalResults ? totalResults : Math.min(startIndex + pageSize, totalResults);
  const paginatedOrders = pageSize === totalResults ? filtered : filtered.slice(startIndex, endIndex);

  // 4. Renderizar filas en el tbody
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  if (paginatedOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="14" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
          No se encontraron pedidos con los criterios de búsqueda actuales.
        </td>
      </tr>
    `;
    const pagContainer = document.getElementById('wms-pagination-container');
    if (pagContainer) pagContainer.innerHTML = '';
    const cbAll = document.getElementById('wms-select-all');
    if (cbAll) cbAll.checked = false;
    renderWmsBulkActionsBar();
    return;
  }

  let rowsHtml = '';
  paginatedOrders.forEach(order => {
    // Buscar el envío en el listado cargado
    const orderShipments = shipments.filter(s => 
      s.pedido_referencia === order.id || 
      (order.external_order_number && s.pedido_referencia === order.external_order_number)
    );

    const dateSource = (orderShipments.length > 0 && orderShipments[0].created_at) 
      ? orderShipments[0].created_at 
      : order.created_at;

    const dateObj = new Date(dateSource);
    const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    let optionsHtml = ALL_STATUSES.map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${s}</option>`).join('');

    const platform = order.origen || order.external_platform || 'Manual';
    const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : (platform === 'Falabella' ? '#84cc16' : (platform === 'MercadoLibre' ? '#f59e0b' : (platform === 'WooCommerce' ? '#96588a' : '#6b7280'))));
    const originHtml = `<span style="background-color: ${platformColor}15; color: ${platformColor}; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">${platform}</span>`;

    const skuStr = order.sku || order.order_items?.map(oi => oi.products?.sku).filter(Boolean).join(', ') || 'Sin SKU';
    const nameStr = order.item || order.order_items?.map(oi => oi.products?.name).filter(Boolean).join(', ') || 'Sin Nombre';
    const qtyStr = order.cantidad !== null && order.cantidad !== undefined ? order.cantidad : order.order_items?.reduce((sum, oi) => sum + (oi.quantity || 0), 0);

    const orderDisplayId = order.external_order_number 
      ? `<span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${order.external_order_number}</span> <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">(${order.id.split('-')[0]})</span>` 
      : `<span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${order.id.split('-')[0]}</span>`;

    let trackingHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
    let labelHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
    
    if (order.label_base64) {
      labelHtml = `<button onclick="window.downloadBase64Pdf('${order.label_base64}', 'etiqueta_falabella_${order.external_order_number || order.id}.pdf')" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; font-weight: 600;"><i class="ri-download-2-line"></i> Descargar</button>`;
    } else if (order.label_url) {
      labelHtml = `<a href="${order.label_url}" target="_blank" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 600;"><i class="ri-external-link-line"></i> Ver Etiqueta</a>`;
    }

    let courier_destino = '';
    let comuna_destino = '';
    let trackingNum = order.tracking_number;
    let trackingUrl = order.tracking_url;

    if (orderShipments.length > 0) {
      const shipment = orderShipments[0];
      courier_destino = shipment.courier;
      comuna_destino = shipment.comuna_destino;
      if (shipment.tracking) {
        trackingNum = shipment.tracking;
        trackingUrl = shipment.tracking_url;
      }
    }

    const courierName = order.courier || courier_destino || 'Courier';
    if (trackingNum) {
      trackingHtml = trackingUrl && trackingUrl !== 'N/A'
        ? `<a href="${trackingUrl}" target="_blank" style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:500;"><i class="ri-truck-line"></i> ${courierName}: ${trackingNum}</a>`
        : `<span style="display:inline-flex; align-items:center; gap:0.25rem; color: var(--color-text-main);"><i class="ri-truck-line"></i> ${courierName}: ${trackingNum}</span>`;
    }

    // Items table breakdown
    let itemsRowsHtml = '';
    if (order.order_items && order.order_items.length > 0) {
      order.order_items.forEach(oi => {
        const pSku = oi.products?.sku || order.sku || 'Sin SKU';
        const pName = oi.products?.name || order.item || 'Sin Nombre';
        const pQty = oi.quantity || 0;
        const pPrice = Number(oi.products?.price) || (pQty > 0 ? (Number(order.total_value) / pQty) : 0) || 0;
        const subtotal = pQty * pPrice;
        itemsRowsHtml += `
          <tr style="border-bottom: 1px solid var(--color-border);">
            <td style="padding: 0.5rem; font-family: monospace; font-weight: 500;">${pSku}</td>
            <td style="padding: 0.5rem; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${pName}</td>
            <td style="padding: 0.5rem; text-align: center; font-weight: 600;">${pQty}</td>
            <td style="padding: 0.5rem; text-align: right;">${window.formatCLP(pPrice)}</td>
            <td style="padding: 0.5rem; text-align: right; font-weight: 600;">${window.formatCLP(subtotal)}</td>
          </tr>
        `;
      });
    } else {
      const pQty = Number(order.cantidad) || 1;
      const pPrice = pQty > 0 ? (Number(order.total_value) / pQty) : 0;
      itemsRowsHtml += `
        <tr style="border-bottom: 1px solid var(--color-border);">
          <td style="padding: 0.5rem; font-family: monospace; font-weight: 500;">${order.sku || 'Sin SKU'}</td>
          <td style="padding: 0.5rem; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${order.item || 'Sin Nombre'}</td>
          <td style="padding: 0.5rem; text-align: center; font-weight: 600;">${pQty}</td>
          <td style="padding: 0.5rem; text-align: right;">${window.formatCLP(pPrice)}</td>
          <td style="padding: 0.5rem; text-align: right; font-weight: 600;">${window.formatCLP(order.total_value)}</td>
        </tr>
      `;
    }

    let rawData = null;
    if (order.raw_woocommerce_data) rawData = order.raw_woocommerce_data;
    else if (order.raw_falabella_data) rawData = order.raw_falabella_data;
    else if (order.raw_meli_data) rawData = order.raw_meli_data;
    else if (order.raw_optiroute_data) rawData = order.raw_optiroute_data;
    else if (order.raw_lightdata_data) rawData = order.raw_lightdata_data;
    else if (order.raw_paris_data) rawData = order.raw_paris_data;

    let rawJsonBtnHtml = '';
    if (rawData) {
      rawJsonBtnHtml = `
        <button onclick="window.toggleRawOrderJson('${order.id}')" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.25rem; margin-top: 1rem; width: 100%; justify-content: center; font-weight: 600;">
          <i class="ri-code-s-slash-line"></i> Ver JSON de Integración
        </button>
        <div id="raw-json-${order.id}" style="display: none; margin-top: 0.5rem; text-align: left; background: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; word-break: break-all;">
          ${JSON.stringify(rawData, null, 2)}
        </div>
      `;
    }

    // Color del dropdown de WMS según el estado
    let wmsColor = '#0ea5e9'; // info
    if (order.estado_wms === 'Incidencia') wmsColor = '#ef4444'; // danger
    else if (order.estado_wms === 'Pickeado' || order.estado_wms === 'Despachado') wmsColor = '#22c55e'; // success
    else if (order.estado_wms === 'En preparación') wmsColor = '#f59e0b'; // warning

    rowsHtml += `
      <tr id="row-${order.id}" class="order-row" data-order-id="${order.id}" style="transition: background-color 0.2s;">
        <td style="text-align: center;" onclick="event.stopPropagation()">
          <input type="checkbox" class="wms-order-cb" data-order-id="${order.id}" ${window.wmsSelectedOrderIds.has(order.id) ? 'checked' : ''} onchange="window.toggleWmsOrderSelect(this, '${order.id}')" style="width: 16px; height: 16px; accent-color: var(--color-primary); cursor: pointer;">
        </td>
        <td style="cursor: pointer; text-align: center; font-size: 1.2rem; color: var(--color-primary);" onclick="window.toggleOrderRow('${order.id}')">
          <i id="chevron-${order.id}" class="ri-arrow-right-s-line expand-icon" style="transition: transform 0.2s; display: inline-block;"></i>
        </td>
        <td>${orderDisplayId}</td>
        <td><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i><strong>${order.comercio || 'Desconocido'}</strong></td>
        <td>${originHtml}</td>
        <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
        <td><span style="font-family: monospace; font-size: 0.85rem; color: var(--color-text-main); font-weight: 600;">${skuStr}</span></td>
        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${nameStr}">${nameStr}</td>
        <td><strong style="color: var(--color-text-main); font-size: 1.05rem;">${qtyStr}</strong></td>
        <td style="text-align:right; font-weight:700; color:var(--color-text-main); white-space:nowrap;">
          ${window.formatCLP(order.total_value)}
        </td>
        <td>${trackingHtml}</td>
        <td>${labelHtml}</td>
        <td>
          <select class="form-input status-select" data-order-id="${order.id}" style="padding: 0.25rem; font-size: 0.875rem; width: auto; font-weight: 500;">
            ${optionsHtml}
          </select>
        </td>
        <td>
          <select class="form-input wms-status-select" data-order-id="${order.id}" style="padding: 0.25rem 0.5rem; font-size: 0.825rem; width: auto; font-weight: 700; border: 1.5px solid ${wmsColor}; color: ${wmsColor}; background: ${wmsColor}06; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;">
            <option value="En procesamiento" ${order.estado_wms === 'En procesamiento' ? 'selected' : ''}>En procesamiento</option>
            <option value="En preparación" ${order.estado_wms === 'En preparación' ? 'selected' : ''}>En preparación</option>
            <option value="Pickeado" ${order.estado_wms === 'Pickeado' ? 'selected' : ''}>Pickeado</option>
            <option value="Despachado" ${order.estado_wms === 'Despachado' ? 'selected' : ''}>Despachado</option>
            <option value="Incidencia" ${order.estado_wms === 'Incidencia' ? 'selected' : ''}>Incidencia</option>
          </select>
        </td>
      </tr>
      <tr id="details-${order.id}" class="order-details-row" style="display: none; background-color: var(--color-bg);">
        <td colspan="14" style="padding: 1.5rem; border-top: none; border-bottom: 2px solid var(--color-border);">
          <div class="order-detail-container" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">
            
            <!-- Col 1: Datos del Cliente y Despacho -->
            <div style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
              <h4 style="margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; color: var(--color-primary); font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem;">
                <i class="ri-user-line"></i> Datos de Despacho
              </h4>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Nombre Cliente:</strong> ${order.customer_name || 'No registrado'}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Email:</strong> ${order.customer_email || 'No registrado'}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Teléfono:</strong> ${order.customer_phone || 'No registrado'}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem; line-height: 1.4;">
                <strong>Dirección:</strong> ${order.shipping_address || 'No registrada'} 
                ${order.shipping_complement ? `, ${order.shipping_complement}` : ''}
              </p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Ciudad/Comuna:</strong> ${order.shipping_city || comuna_destino || 'No registrada'}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Método de Envío:</strong> <span style="background: var(--badge-info-bg); color: var(--badge-info-text); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.8rem; font-weight: 500;">${order.shipping_method || 'Por definir'}</span></p>
              <p style="margin-bottom: 0; font-size: 0.9rem;"><strong>Pago:</strong> <span style="background: ${order.payment_status === 'PAID' ? 'var(--badge-success-bg)' : 'var(--badge-warning-bg)'}; color: ${order.payment_status === 'PAID' ? 'var(--badge-success-text)' : 'var(--badge-warning-text)'}; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.8rem; font-weight: 500;">${order.payment_status || 'PENDING'}</span></p>
            </div>

            <!-- Col 2: Desglose de Productos -->
            <div style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
              <h4 style="margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; color: var(--color-primary); font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem;">
                <i class="ri-shopping-basket-2-line"></i> Ítems del Pedido
              </h4>
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="border-bottom: 1px solid var(--color-border); text-align: left; color: var(--color-text-muted);">
                      <th style="padding: 0.25rem 0.5rem 0.5rem 0.5rem;">SKU</th>
                      <th style="padding: 0.25rem 0.5rem 0.5rem 0.5rem;">Producto</th>
                      <th style="padding: 0.25rem 0.5rem 0.5rem 0.5rem; text-align: center;">Cant</th>
                      <th style="padding: 0.25rem 0.5rem 0.5rem 0.5rem; text-align: right;">P. Unit</th>
                      <th style="padding: 0.25rem 0.5rem 0.5rem 0.5rem; text-align: right;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsRowsHtml}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Col 3: Integración y Logística -->
            <div style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
              <h4 style="margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; color: var(--color-primary); font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem;">
                <i class="ri-truck-line"></i> Logística e Integración
              </h4>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Plataforma Origen:</strong> ${originHtml}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Pedido Externo N°:</strong> <span style="font-family: monospace;">${order.external_order_number || '-'}</span></p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Courier:</strong> ${order.courier || courier_destino || '-'}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>N° Seguimiento:</strong> ${trackingHtml}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Etiqueta de Envío:</strong> ${labelHtml}</p>
              
              <!-- Botón para ver datos crudos de integración -->
              ${rawJsonBtnHtml}
            </div>

          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;

  // 5. Renderizar paginación
  const pagContainer = document.getElementById('wms-pagination-container');
  if (pagContainer) {
    const isFirstPage = window.wmsCurrentPage === 1;
    const isLastPage = window.wmsCurrentPage === totalPages;
    const rangeStart = startIndex + 1;
    const rangeEnd = endIndex;

    pagContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; font-size: 0.85rem; color: var(--color-text-muted);">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span>Mostrar</span>
          <select id="wms-page-size" onchange="window.setWmsPageSize(this.value)" class="form-input" style="width: auto; padding: 0.25rem; font-size: 0.8rem; height: auto; margin: 0; display: inline-block;">
            <option value="10" ${window.wmsPageSize == 10 ? 'selected' : ''}>10</option>
            <option value="25" ${window.wmsPageSize == 25 ? 'selected' : ''}>25</option>
            <option value="50" ${window.wmsPageSize == 50 ? 'selected' : ''}>50</option>
            <option value="100" ${window.wmsPageSize == 100 ? 'selected' : ''}>100</option>
            <option value="All" ${window.wmsPageSize === 'All' ? 'selected' : ''}>Todos</option>
          </select>
          <span>resultados por página</span>
        </div>
        
        <div>
          Mostrando <strong>${rangeStart}-${rangeEnd}</strong> de <strong>${totalResults}</strong> resultados
        </div>

        <div style="display: flex; gap: 0.25rem;">
          <button onclick="window.setWmsPage(1)" ${isFirstPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isFirstPage ? 'not-allowed' : 'pointer'}; opacity: ${isFirstPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);"><i class="ri-arrow-left-double-line"></i></button>
          <button onclick="window.setWmsPage(${window.wmsCurrentPage - 1})" ${isFirstPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isFirstPage ? 'not-allowed' : 'pointer'}; opacity: ${isFirstPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);"><i class="ri-arrow-left-s-line"></i> Anterior</button>
          
          <span style="padding: 0.25rem 0.75rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-weight: 600; color: var(--color-text-main); font-size: 0.75rem; display: inline-flex; align-items: center;">
            Pág. ${window.wmsCurrentPage} de ${totalPages}
          </span>

          <button onclick="window.setWmsPage(${window.wmsCurrentPage + 1})" ${isLastPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isLastPage ? 'not-allowed' : 'pointer'}; opacity: ${isLastPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);">Siguiente <i class="ri-arrow-right-s-line"></i></button>
          <button onclick="window.setWmsPage(${totalPages})" ${isLastPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isLastPage ? 'not-allowed' : 'pointer'}; opacity: ${isLastPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);"><i class="ri-arrow-right-double-line"></i></button>
        </div>
      </div>
    `;
  }

  // 6. Sincronizar checkbox de seleccionar todo en cabecera
  updateSelectAllCheckboxState();

  // 7. Renderizar barra de acciones masivas
  renderWmsBulkActionsBar();
};

window.setWmsTab = function(tab) {
  window.wmsActiveTab = tab;
  window.wmsCurrentPage = 1;
  window.wmsSelectedOrderIds.clear(); // Limpiar la selección cuando se cambian pestañas
  applyWmsFiltersAndRender();
};

window.setWmsPageSize = function(size) {
  window.wmsPageSize = size;
  window.wmsCurrentPage = 1;
  applyWmsFiltersAndRender();
};

window.setWmsPage = function(page) {
  window.wmsCurrentPage = page;
  applyWmsFiltersAndRender();
};

window.toggleWmsOrderSelect = function(cb, orderId) {
  if (cb.checked) {
    window.wmsSelectedOrderIds.add(orderId);
  } else {
    window.wmsSelectedOrderIds.delete(orderId);
  }
  updateSelectAllCheckboxState();
  renderWmsBulkActionsBar();
};

window.toggleWmsSelectAll = function(cbAll) {
  const checkboxes = document.querySelectorAll('.wms-order-cb');
  checkboxes.forEach(cb => {
    const orderId = cb.getAttribute('data-order-id');
    cb.checked = cbAll.checked;
    if (cbAll.checked) {
      window.wmsSelectedOrderIds.add(orderId);
    } else {
      window.wmsSelectedOrderIds.delete(orderId);
    }
  });
  renderWmsBulkActionsBar();
};

window.clearWmsSelection = function() {
  window.wmsSelectedOrderIds.clear();
  const checkboxes = document.querySelectorAll('.wms-order-cb');
  checkboxes.forEach(cb => cb.checked = false);
  const cbAll = document.getElementById('wms-select-all');
  if (cbAll) cbAll.checked = false;
  renderWmsBulkActionsBar();
};

function updateSelectAllCheckboxState() {
  const cbAll = document.getElementById('wms-select-all');
  if (!cbAll) return;
  const checkboxes = document.querySelectorAll('.wms-order-cb');
  if (checkboxes.length === 0) {
    cbAll.checked = false;
    return;
  }
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  cbAll.checked = allChecked;
}

function renderWmsBulkActionsBar() {
  const container = document.getElementById('wms-bulk-actions-container');
  if (!container) return;
  
  const selectedCount = window.wmsSelectedOrderIds.size;
  if (selectedCount === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = `
    <div class="bulk-actions-bar" style="background: var(--color-primary); color: #ffffff; padding: 0.75rem 1.25rem; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; box-shadow: var(--shadow-md); animation: slideDown 0.2s ease;">
      <div style="display: flex; align-items: center; gap: 1rem;">
        <i class="ri-checkbox-multiple-line" style="font-size: 1.25rem;"></i>
        <span style="font-weight: 600; font-size: 0.9rem;">${selectedCount} pedidos seleccionados</span>
        <button onclick="window.clearWmsSelection()" class="btn btn-outline" style="border-color: rgba(255,255,255,0.3); color: #ffffff; padding: 0.25rem 0.5rem; font-size: 0.75rem; background: transparent; cursor: pointer;">Limpiar</button>
      </div>
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <label style="font-size: 0.8rem; font-weight: 500;">Cambiar estado WMS a:</label>
        <select id="bulk-wms-status" class="form-input" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem; height: auto; margin: 0; background: #ffffff; color: #111827; border: 1px solid rgba(0,0,0,0.1);">
          <option value="En procesamiento">En procesamiento</option>
          <option value="En preparación">En preparación</option>
          <option value="Pickeado">Pickeado</option>
          <option value="Despachado">Despachado</option>
          <option value="Incidencia">Incidencia</option>
        </select>
        <button onclick="window.applyBulkWmsStatus()" class="btn btn-accent" style="background: #ffffff; color: var(--color-primary); font-weight: 600; padding: 0.25rem 0.75rem; font-size: 0.8rem; box-shadow: none; border: none; cursor: pointer; border-radius: var(--radius-sm);">Aplicar</button>
      </div>
    </div>
  `;
}

window.applyBulkWmsStatus = async function() {
  const newStatus = document.getElementById('bulk-wms-status').value;
  const ids = Array.from(window.wmsSelectedOrderIds);
  if (ids.length === 0) return;
  
  if (!confirm(`¿Estás seguro de que deseas actualizar el estado WMS de ${ids.length} pedidos a "${newStatus}"?`)) {
    return;
  }
  
  try {
    const updateData = { estado_wms: newStatus };
    if (newStatus === 'Despachado') {
      updateData.status = 'despachado';
    }
    const { error } = await supabase
      .from('orders')
      .update(updateData)
      .in('id', ids);
      
    if (error) throw error;
    alert(`Se actualizaron con éxito ${ids.length} pedidos a "${newStatus}".`);
    
    // Actualizar localmente
    if (window.loadedOrders) {
      ids.forEach(id => {
        const order = window.loadedOrders.find(o => o.id === id);
        if (order) {
          order.estado_wms = newStatus;
          if (newStatus === 'Despachado') order.status = 'despachado';
        }
      });
    }
    
    window.wmsSelectedOrderIds.clear();
    const cbAll = document.getElementById('wms-select-all');
    if (cbAll) cbAll.checked = false;
    
    applyWmsFiltersAndRender();
  } catch (err) {
    console.error(err);
    alert('Error en la actualización masiva: ' + err.message);
  }
};

window.updateWmsOrderStatus = async function(orderId, newWmsStatus) {
  try {
    const updateData = { estado_wms: newWmsStatus };
    if (newWmsStatus === 'Despachado') {
      updateData.status = 'despachado';
    }
    const { error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId);
      
    if (error) throw error;
    
    // Actualizar localmente
    const order = window.loadedOrders.find(o => o.id === orderId);
    if (order) {
      order.estado_wms = newWmsStatus;
      if (newWmsStatus === 'Despachado') order.status = 'despachado';
    }
    
    applyWmsFiltersAndRender();
  } catch (err) {
    console.error(err);
    alert('Error al actualizar estado WMS: ' + err.message);
  }
};

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

    // Obtener las integraciones de los comercios (clientes)
    const { data: merchantInts, error: merchErr } = await supabase
      .from('merchant_integrations')
      .select(`
        id,
        platform,
        shop_url,
        username,
        is_active,
        comercio,
        created_at,
        profiles (
          company_name
        )
      `)
      .neq('platform', 'Optiroute')
      .order('created_at', { ascending: false });

    if (merchErr) throw merchErr;

    let rowsHtml = '';
    if (merchantInts && merchantInts.length > 0) {
      merchantInts.forEach(mi => {
        const companyName = mi.profiles?.company_name || 'Desconocido';
        const commerceName = mi.comercio || 'No especificado';
        const platform = mi.platform || 'Desconocida';
        const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : (platform === 'Falabella' ? '#84cc16' : (platform === 'MercadoLibre' ? '#f59e0b' : (platform === 'WooCommerce' ? '#96588a' : '#6b7280'))));
        
        const platformHtml = `<span style="background-color: ${platformColor}15; color: ${platformColor}; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">${platform}</span>`;
        
        const shopInfo = mi.username 
          ? `${mi.username} (${mi.shop_url || '-'})` 
          : (mi.shop_url || '-');

        const dateStr = mi.created_at ? new Date(mi.created_at).toLocaleDateString('es-CL', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : '-';

        const statusBadge = mi.is_active 
          ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">Activa</span>' 
          : '<span class="badge badge-warning" style="background-color: #fef3c7; color: #92400e; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">Inactiva</span>';

        rowsHtml += `
          <tr style="border-bottom: 1px solid var(--color-border); transition: background-color 0.2s;">
            <td style="padding: 1rem 0.75rem;">
              <strong style="color: var(--color-text-main);">${companyName}</strong>
              <span style="font-size: 0.8rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">Comercio: ${commerceName}</span>
            </td>
            <td style="padding: 1rem 0.75rem;">${platformHtml}</td>
            <td style="padding: 1rem 0.75rem; font-family: monospace; font-size: 0.85rem; color: var(--color-text-main);">${shopInfo}</td>
            <td style="padding: 1rem 0.75rem; color: var(--color-text-muted); font-size: 0.875rem;">${dateStr}</td>
            <td style="padding: 1rem 0.75rem;">${statusBadge}</td>
          </tr>
        `;
      });
    } else {
      rowsHtml = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No hay integraciones de comercios configuradas.</td>
        </tr>
      `;
    }

    appContent.innerHTML = `
      <div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Integraciones del WMS (Administración)</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          Conecta el WMS STOCKA con plataformas de logística globales. 
          Sincroniza pedidos de todos los clientes y realiza el seguimiento de entregas en tiempo real.
        </p>
      </div>

        </div>

      </div>`;
      // JS Tabs Logic
      setTimeout(() => {
        const tabs = document.querySelectorAll('.integration-tab');
        const panes = document.querySelectorAll('.integration-tab-pane');
        tabs.forEach(tab => {
          tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.style.display = 'none');
            tab.classList.add('active');
            const targetPane = document.getElementById(tab.getAttribute('data-tab'));
            if (targetPane) {
              targetPane.style.display = 'block';
            }
          });
        });
      }, 0);


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
        return `<option value="${s.id}">${sourceName} - ${s.courier || 'N/A'} (Tracking: ${s.tracking || 'N/A'}) - Estado original: ${getDisplayStatusName(s.status)}</option>`;
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
            <td><span style="font-size:0.875rem; color: var(--color-text-main);">${getDisplayStatusName(s.status)}</span></td>
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
          <div class="card-body table-responsive" style="padding: 0;">
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
        <div class="card-body table-responsive" style="padding: 0;">
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
  { id: 'declarations', label: 'Ingresos de Stock' },
  { id: 'orders', label: 'Pedidos' },
  { id: 'shipments', label: 'Despachos' },
  { id: 'movements', label: 'Movimientos' },
  { id: 'warehouses', label: 'Bodegas' },
  { id: 'pending', label: 'Por Asignar' },
  { id: 'returns', label: 'Logística Inversa' },
  { id: 'pickups', label: 'Punto de Retiro' },
  { id: 'sales', label: 'Punto de Ventas' },
  { id: 'billing', label: 'Facturación' },
  { id: 'integrations', label: 'Integraciones' },
  { id: 'documentation', label: 'Documentación' },
  { id: 'profile', label: 'Mi Perfil' }
];

const ADMIN_MODULES = [
  { id: 'orders_admin', label: 'Gestor de Pedidos' },
  { id: 'consolidated_shipments', label: 'Envíos Consolidados' },
  { id: 'reassign_admin', label: 'Reubicar Stock' },
  { id: 'manual_in_admin', label: 'Ingreso Manual' },
  { id: 'declarations_admin', label: 'Declaraciones de Ingreso' },
  { id: 'upload_products_admin', label: 'Carga de Planillas' },
  { id: 'users_admin', label: 'Gestionar Usuarios' },
  { id: 'billing_admin', label: 'Facturación' },
  { id: 'integrations', label: 'Integraciones' },
  { id: 'documentation_admin', label: 'Documentación Admin' }
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
        .lte('created_at', new Date().toISOString())
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
        const { data } = await supabase
          .from('dashboard_notifications')
          .select('id')
          .eq('is_read', false)
          .lte('created_at', new Date().toISOString());
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
    const { data: notifs } = await supabase
      .from('dashboard_notifications')
      .select('*')
      .lte('created_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
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

async function renderVisibilityRulesAdmin() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando reglas de visibilidad...</p>`;

  try {
    const { data: rules, error: rulesError } = await supabase
      .from('reglas_visibilidad')
      .select('*')
      .order('created_at', { ascending: false });

    if (rulesError) throw rulesError;

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name, company_name')
      .neq('role', 'admin')
      .order('email');

    if (profilesError) throw profilesError;

    const { data: courierData } = await supabase
      .from('envios_unificados')
      .select('courier')
      .not('courier', 'is', null);
    const couriers = [...new Set((courierData || []).map(s => s.courier).filter(Boolean))].sort();

    const { data: statusData } = await supabase
      .from('envios_unificados')
      .select('status')
      .not('status', 'is', null);
    const statuses = [...new Set((statusData || []).map(s => s.status).filter(Boolean))].sort();

    let userOptionsHtml = '<option value="">-- Seleccionar Usuario --</option>';
    (profiles || []).forEach(p => {
      const displayName = `${p.email} (${p.full_name || p.company_name || 'Sin Nombre'})`;
      userOptionsHtml += `<option value="${p.id}" data-email="${p.email}">${displayName}</option>`;
    });

    let courierOptionsHtml = '<option value="">-- Cualquier Courier --</option>';
    couriers.forEach(c => {
      courierOptionsHtml += `<option value="${c}">${c}</option>`;
    });

    let statusOptionsHtml = '<option value="">-- Cualquier Estado --</option>';
    statuses.forEach(st => {
      statusOptionsHtml += `<option value="${st}">${getDisplayStatusName(st)}</option>`;
    });

    let rowsHtml = '';
    if (!rules || rules.length === 0) {
      rowsHtml = `<tr><td colspan="6" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay reglas de visibilidad creadas.</td></tr>`;
    } else {
      rules.forEach(r => {
        const dateStr = r.created_at ? new Date(r.created_at).toLocaleString() : '-';
        const scopeBadge = r.scope === 'global' 
          ? `<span style="background-color: #e0f2fe; color: #0369a1; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight:600;">Global</span>`
          : `<span style="background-color: #fef3c7; color: #d97706; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight:600;">Por Usuario</span>`;
        
        const userDisplay = r.scope === 'global' ? 'Todos los usuarios' : (r.user_email || 'Desconocido');
        const courierDisplay = r.courier ? `<span style="font-weight:600;">${r.courier}</span>` : '<em>Cualquiera</em>';
        const statusDisplay = r.status ? `<span style="font-weight:600; color:var(--color-accent);">${getDisplayStatusName(r.status)}</span>` : '<em>Cualquiera</em>';

        rowsHtml += `
          <tr style="border-bottom: 1px solid var(--color-border);">
            <td style="padding: 1rem 0.75rem;">${scopeBadge}</td>
            <td style="padding: 1rem 0.75rem;">${userDisplay}</td>
            <td style="padding: 1rem 0.75rem;">${courierDisplay}</td>
            <td style="padding: 1rem 0.75rem;">${statusDisplay}</td>
            <td style="padding: 1rem 0.75rem; font-size: 0.8rem; color: var(--color-text-muted);">${dateStr}</td>
            <td style="padding: 1rem 0.75rem;">
              <button class="btn btn-outline btn-danger btn-delete-rule" data-id="${r.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                <i class="ri-delete-bin-line"></i> Eliminar
              </button>
            </td>
          </tr>
        `;
      });
    }

    appContent.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1200px; margin: 0 auto; padding: 1rem;">
        
        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
          <h2 style="margin:0; font-size:1.5rem; font-weight:700; color:var(--color-text-main);">Reglas de Visibilidad de Datos</h2>
          <p style="margin:0; font-size:0.875rem; color:var(--color-text-muted);">
            Configura qué datos (despachos) ocultar en el panel de cliente en base a Courier y Estado.
          </p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr; gap: 1.5rem; align-items: start;">
          
          <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
            <h3 style="margin: 0 0 1.25rem 0; font-size: 1.1rem; font-weight: 700; color: var(--color-text-main); border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
              <i class="ri-add-line" style="color:var(--color-primary);"></i> Crear Nueva Regla
            </h3>
            
            <form id="form-create-visibility-rule" style="display: flex; flex-direction: column; gap: 1rem;">
              
              <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-weight:600; margin-bottom:0.25rem; display:block;">Ámbito (Scope)</label>
                <select id="rule-scope" class="form-input" required style="width:100%;">
                  <option value="global">Global (Todos los clientes)</option>
                  <option value="user">Por Usuario Específico</option>
                </select>
              </div>

              <div class="form-group" id="user-selection-group" style="display: none; margin: 0;">
                <label class="form-label" style="font-weight:600; margin-bottom:0.25rem; display:block;">Seleccionar Usuario</label>
                <select id="rule-user-id" class="form-input" style="width:100%;">
                  ${userOptionsHtml}
                </select>
              </div>

              <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-weight:600; margin-bottom:0.25rem; display:block;">Courier a Ocultar</label>
                <select id="rule-courier" class="form-input" style="width:100%;">
                  ${courierOptionsHtml}
                </select>
              </div>

              <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-weight:600; margin-bottom:0.25rem; display:block;">Estado a Ocultar</label>
                <select id="rule-status" class="form-input" style="width:100%;">
                  ${statusOptionsHtml}
                </select>
              </div>

              <p style="font-size:0.75rem; color:var(--color-text-muted); margin: 0; line-height: 1.4;">
                * Dejar Courier o Estado en "Cualquiera" aplicará la regla a todas las opciones de esa columna.
              </p>

              <button type="submit" class="btn btn-primary" style="width:100%; margin-top: 0.5rem;">
                <i class="ri-eye-off-line"></i> Guardar Regla
              </button>
            </form>
          </div>

          <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
            <h3 style="margin: 0 0 1.25rem 0; font-size: 1.1rem; font-weight: 700; color: var(--color-text-main); border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
              <i class="ri-list-check" style="color:var(--color-primary);"></i> Reglas de Exclusión Activas
            </h3>

            <div class="table-responsive">
              <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem;">
                <thead>
                  <tr style="border-bottom: 2px solid var(--color-border); color: var(--color-text-muted); font-weight: 600;">
                    <th style="padding: 0.75rem 0.5rem;">Ámbito</th>
                    <th style="padding: 0.75rem 0.5rem;">Usuario / Email</th>
                    <th style="padding: 0.75rem 0.5rem;">Courier</th>
                    <th style="padding: 0.75rem 0.5rem;">Estado</th>
                    <th style="padding: 0.75rem 0.5rem;">Creado</th>
                    <th style="padding: 0.75rem 0.5rem; width: 100px;">Acción</th>
                  </tr>
                </thead>
                <tbody id="visibility-rules-table-body">
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
          </div>

        </div>

      </div>
    `;

    if (!document.getElementById('visibility-rules-responsive-style')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'visibility-rules-responsive-style';
      styleTag.textContent = `
        @media (min-width: 900px) {
          #app-content > div > div {
            display: grid !important;
            grid-template-columns: 360px 1fr !important;
          }
        }
      `;
      document.head.appendChild(styleTag);
    }

    const scopeSelect = document.getElementById('rule-scope');
    const userSelectionGroup = document.getElementById('user-selection-group');
    const ruleUserId = document.getElementById('rule-user-id');

    scopeSelect.addEventListener('change', () => {
      if (scopeSelect.value === 'user') {
        userSelectionGroup.style.display = 'block';
        ruleUserId.setAttribute('required', 'true');
      } else {
        userSelectionGroup.style.display = 'none';
        ruleUserId.removeAttribute('required');
        ruleUserId.value = '';
      }
    });

    const form = document.getElementById('form-create-visibility-rule');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const scope = document.getElementById('rule-scope').value;
        const userId = scope === 'user' ? document.getElementById('rule-user-id').value : null;
        let userEmail = null;
        
        if (scope === 'user') {
          if (!userId) {
            alert('Por favor selecciona un usuario.');
            return;
          }
          const selectedOpt = document.getElementById('rule-user-id').selectedOptions[0];
          userEmail = selectedOpt.getAttribute('data-email');
        }

        const courier = document.getElementById('rule-courier').value || null;
        const status = document.getElementById('rule-status').value || null;

        if (!courier && !status) {
          alert('Por favor selecciona al menos un Courier o un Estado para ocultar.');
          return;
        }

        const { error: insertError } = await supabase
          .from('reglas_visibilidad')
          .insert([{
            scope,
            user_id: userId,
            user_email: userEmail,
            courier,
            status
          }]);

        if (insertError) throw insertError;

        alert('Regla de visibilidad creada exitosamente.');
        await renderVisibilityRulesAdmin();
      } catch (err) {
        console.error('Error al guardar la regla:', err);
        alert(`Error al guardar la regla: ${err.message || err}`);
      }
    });

    const tbody = document.getElementById('visibility-rules-table-body');
    tbody.querySelectorAll('.btn-delete-rule').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ruleId = btn.getAttribute('data-id');
        if (confirm('¿Estás seguro de que deseas eliminar esta regla de visibilidad?')) {
          try {
            const { error: deleteError } = await supabase
              .from('reglas_visibilidad')
              .delete()
              .eq('id', ruleId);

            if (deleteError) throw deleteError;

            alert('Regla de visibilidad de datos eliminada.');
            await renderVisibilityRulesAdmin();
          } catch (err) {
            console.error('Error al eliminar la regla:', err);
            alert(`Error al eliminar la regla: ${err.message || err}`);
          }
        }
      });
    });

  } catch (error) {
    console.error('Error renderVisibilityRulesAdmin:', error);
    appContent.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--color-danger);">
        <i class="ri-error-warning-line" style="font-size: 2.5rem; display: block; margin-bottom: 1rem;"></i>
        <h4>Error al cargar las reglas de visibilidad</h4>
        <p style="font-size: 0.9rem;">${error.message || error}</p>
        <button class="btn btn-outline" onclick="renderVisibilityRulesAdmin()" style="margin-top: 1rem;">Reintentar</button>
      </div>
    `;
  }
}

// ==========================================
// NUEVO MÓDULO: DECLARACIONES DE INGRESO DE STOCK (ADMINISTRADOR)
// ==========================================

window.downloadBase64File = function(base64, filename) {
  try {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    let mimeType = 'application/octet-stream';
    if (filename.endsWith('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (filename.endsWith('.xls')) mimeType = 'application/vnd.ms-excel';
    else if (filename.endsWith('.csv')) mimeType = 'text/csv';

    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error al descargar el archivo:', err);
    alert('No se pudo descargar el archivo.');
  }
};

window.renderDeclarationsAdmin = async function() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = '<p class="text-center" style="padding: 2rem;">Cargando declaraciones de ingreso...</p>';

  try {
    // Consultar todas las declaraciones junto con el nombre de la empresa/comercio
    const { data: declarations, error } = await supabase
      .from('stock_declarations')
      .select('*, profiles!inner (company_name), warehouses (name, address, comuna)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    let rowsHtml = '';
    if (!declarations || declarations.length === 0) {
      rowsHtml = '<tr><td colspan="10" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay declaraciones de ingresos registradas.</td></tr>';
    } else {
      declarations.forEach(dec => {
        let statusBadge = '';
        switch (dec.status) {
          case 'Creada':
            statusBadge = '<span class="badge" style="background-color: var(--badge-neutral-bg); color: var(--badge-neutral-text);">Creada</span>';
            break;
          case 'Bodega Asignada':
            statusBadge = '<span class="badge" style="background-color: rgba(37, 99, 235, 0.1); color: var(--color-primary); border: 1px solid rgba(37, 99, 235, 0.2);">Bodega Asignada</span>';
            break;
          case 'En Recepción - Pendiente Conteo':
            statusBadge = '<span class="badge animate-pulse" style="background-color: var(--badge-info-bg); color: var(--badge-info-text);">Pendiente Conteo</span>';
            break;
          case 'En proceso de conteo/clasificación':
            statusBadge = '<span class="badge animate-pulse" style="background-color: var(--badge-warning-bg); color: var(--badge-warning-text); border: 1px solid rgba(245, 158, 11, 0.3);">Conteo/Clasificación</span>';
            break;
          case 'Recibido Conforme':
            statusBadge = '<span class="badge" style="background-color: var(--badge-success-bg); color: var(--badge-success-text);">Recibido Conforme</span>';
            break;
          case 'Recibido con Incidencias':
            statusBadge = '<span class="badge" style="background-color: var(--badge-danger-bg); color: var(--badge-danger-text); border: 1px solid rgba(239, 68, 68, 0.3);">Recibido con Incidencias</span>';
            break;
          default:
            statusBadge = `<span class="badge badge-neutral">${dec.status}</span>`;
        }

        let etaText = '';
        if (dec.estimated_arrival_type === 'exact') {
          const [y, m, d] = dec.estimated_arrival_date.split('-');
          etaText = `${d}/${m}/${y}`;
        } else {
          etaText = dec.estimated_arrival_period;
        }

        let qtyReceivedText = '—';
        if (['Recibido Conforme', 'Recibido con Incidencias', 'En proceso de conteo/clasificación', 'En Recepción - Pendiente Conteo'].indexOf(dec.status) !== -1) {
          const incColor = dec.quantity_incidents > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)';
          qtyReceivedText = `
            <div style="font-size: 0.85rem;">
              <span>Recibido: <strong>${dec.quantity_received}</strong></span><br>
              <span style="font-size: 0.75rem; color: ${incColor};">Incidencias: <strong>${dec.quantity_incidents}</strong></span>
            </div>
          `;
        }

        rowsHtml += `
          <tr style="transition: background-color 0.2s;">
            <td style="font-weight: 600; color: var(--color-primary);">
              ${dec.comercio || 'no asignado'}
              <div style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 400; margin-top: 2px;">
                ${dec.profiles?.company_name || 'Desconocido'}
              </div>
            </td>
            <td style="font-weight: 500; color: var(--color-text-main); font-family: var(--font-family); font-size: 0.9rem;">
              ${dec.title}
              ${dec.warehouses ? `
              <div style="font-size: 0.75rem; color: var(--color-primary); font-weight: 500; margin-top: 2px;">
                <i class="ri-map-pin-line" style="vertical-align: text-bottom; margin-right: 2px;"></i> ${dec.warehouses.name}
              </div>
              ` : ''}
            </td>
            <td style="font-size: 0.85rem;"><i class="ri-calendar-event-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${etaText}</td>
            <td style="font-size: 0.85rem;"><strong>${dec.quantity_declared}</strong></td>
            <td style="font-size: 0.85rem;">
              <strong>${dec.package_count}</strong> <span style="font-size: 0.75rem; color: var(--color-text-muted);">(${dec.package_type})</span>
              <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 2px;">
                C: ${dec.container_count || 0} | P: ${dec.pallet_count || 0} | Cx: ${dec.box_count || 0}
              </div>
              ${dec.requires_unloading ? '<span class="badge" style="font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; display: inline-block; margin-top: 2px; background-color: var(--badge-warning-bg); color: var(--badge-warning-text); font-weight: 600;">Descarga</span>' : ''}
            </td>
            <td style="font-size: 0.85rem;">
              <div style="font-size: 0.85rem;">
                <span>Decl: <strong>${dec.volume_declared || 0} m³</strong></span><br>
                <span style="font-size: 0.75rem; color: var(--color-text-muted);">
                  Conf: <strong>${dec.status !== 'Creada' && dec.status !== 'Bodega Asignada' ? (dec.volume_confirmed || 0) + ' m³' : '—'}</strong>
                </span>
              </div>
            </td>
            <td style="font-size: 0.85rem;"><span style="font-size: 0.8rem; background: var(--color-surface-hover); padding: 0.2rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); font-family: var(--font-family);">${dec.delivery_method}</span></td>
            <td style="font-size: 0.85rem;">${statusBadge}</td>
            <td style="font-size: 0.85rem;">${qtyReceivedText}</td>
            <td style="font-size: 0.85rem; text-align: center; overflow: visible;">
              <div class="table-action-menu">
                <button class="table-action-menu-btn" onclick="toggleTableActionMenu(event, this)">
                  <i class="ri-more-2-fill"></i> Acciones
                </button>
                <div class="table-action-menu-content">
                  <button class="table-action-menu-item" onclick="downloadBase64File('${dec.file_base64}', '${dec.file_name}')">
                    <i class="ri-file-excel-2-line" style="color: var(--color-success);"></i> Planilla
                  </button>
                  <button class="table-action-menu-item" onclick="manageDeclaration('${dec.id}')">
                    <i class="ri-settings-4-line" style="color: var(--color-primary);"></i> Gestionar
                  </button>
                  ${['Recibido Conforme', 'Recibido con Incidencias'].indexOf(dec.status) === -1 ? `
                  <button class="table-action-menu-item danger" onclick="deleteDeclarationAdmin('${dec.id}')">
                    <i class="ri-delete-bin-line"></i> Eliminar
                  </button>
                  ` : ''}
                </div>
              </div>
            </td>
          </tr>
        `;
      });
    }

    appContent.innerHTML = `
      <div class="card">
        <div class="card-header" style="border-bottom: 1px solid var(--color-border); padding-bottom: 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h3>Gestión de Ingresos de Stock</h3>
            <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">Controla, clasifica y recepciona los ingresos declarados por los clientes.</p>
          </div>
          <button class="btn btn-outline" style="padding: 0.4rem 0.75rem; font-size: 0.85rem; border-color: var(--color-border);" id="btn-refresh-admin-declarations">
            <i class="ri-refresh-line"></i> Actualizar
          </button>
        </div>
        <div class="card-body table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Comercio</th>
                <th>Título / Descripción</th>
                <th>Llegada Estimada</th>
                <th>Declaradas</th>
                <th>Bultos</th>
                <th>Volumen (m³)</th>
                <th>Método Envío</th>
                <th>Estado</th>
                <th>Recibido / Incidencias</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Refresh Handler
    const refreshBtn = document.getElementById('btn-refresh-admin-declarations');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        renderDeclarationsAdmin();
      });
    }

  } catch (err) {
    console.error('Error fetching admin declarations:', err);
    appContent.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--color-danger);"><i class="ri-error-warning-line" style="font-size: 2.5rem; display: block; margin-bottom: 1rem;"></i><h4>Error al cargar declaraciones</h4><p>${err.message}</p></div>`;
  }
};

let currentDeclarationIncidents = [];

function renderStatusActionButtons(currentStatus) {
  const container = document.getElementById('manage-dec-actions-buttons');
  const statusInput = document.getElementById('manage-dec-status');
  const submitBtn = document.querySelector('#form-manage-declaration button[type="submit"]');
  if (!container || !statusInput) return;
  
  container.innerHTML = '';
  statusInput.value = ''; // Reset target status

  let actionsHtml = '';
  
  if (currentStatus === 'Creada') {
    actionsHtml = `
      <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.25rem;">
        Estado actual: <strong style="color: var(--color-primary);">${currentStatus}</strong>. Siguiente paso:
      </div>
      <button type="button" class="btn btn-primary btn-status-action" data-status="Bodega Asignada" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 8px;">
        <i class="ri-map-pin-line" style="font-size: 1.1rem;"></i> Marcar como: Bodega Asignada
      </button>
    `;
  } else if (currentStatus === 'Bodega Asignada') {
    actionsHtml = `
      <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.25rem;">
        Estado actual: <strong style="color: var(--color-primary);">${currentStatus}</strong>. Siguiente paso:
      </div>
      <button type="button" class="btn btn-primary btn-status-action" data-status="En Recepción - Pendiente Conteo" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 8px;">
        <i class="ri-play-circle-line" style="font-size: 1.1rem;"></i> Marcar como: En Recepción - Pendiente Conteo
      </button>
    `;
  } else if (currentStatus === 'En Recepción - Pendiente Conteo') {
    actionsHtml = `
      <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.25rem;">
        Estado actual: <strong style="color: var(--color-warning);">${currentStatus}</strong>. Siguiente paso:
      </div>
      <button type="button" class="btn btn-primary btn-status-action" data-status="En proceso de conteo/clasificación" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; background-color: var(--color-warning); border-color: var(--color-warning); border-radius: 8px; color: black;">
        <i class="ri-swap-box-line" style="font-size: 1.1rem;"></i> Marcar como: En proceso de conteo/clasificación
      </button>
    `;
  } else if (currentStatus === 'En proceso de conteo/clasificación') {
    actionsHtml = `
      <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">
        Estado actual: <strong style="color: var(--color-accent);">${currentStatus}</strong>. Selecciona el resultado final:
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <button type="button" class="btn btn-outline btn-status-action btn-status-choice" data-status="Recibido Conforme" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0.75rem 0.5rem; gap: 0.35rem; font-size: 0.85rem; border-color: var(--color-success); color: var(--color-success); border-radius: 8px;">
          <i class="ri-checkbox-circle-line" style="font-size: 1.5rem;"></i>
          <span>Recibido Conforme</span>
        </button>
        <button type="button" class="btn btn-outline btn-status-action btn-status-choice" data-status="Recibido con Incidencias" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0.75rem 0.5rem; gap: 0.35rem; font-size: 0.85rem; border-color: var(--color-danger); color: var(--color-danger); border-radius: 8px;">
          <i class="ri-error-warning-line" style="font-size: 1.5rem;"></i>
          <span>Recibido con Incidencias</span>
        </button>
      </div>
    `;
  } else {
    actionsHtml = `
      <div style="text-align: center; padding: 0.5rem 0; color: var(--color-text-muted); font-size: 0.9rem;">
        <i class="ri-checkbox-multiple-line" style="font-size: 2rem; color: var(--color-success); display: block; margin-bottom: 0.5rem;"></i>
        Este ingreso ya se encuentra finalizado en estado:<br>
        <strong style="color: var(--color-text-main); font-size: 1rem;">${currentStatus}</strong>.
      </div>
    `;
  }
  
  container.innerHTML = actionsHtml;

  if (submitBtn) {
    if (currentStatus === 'Recibido Conforme' || currentStatus === 'Recibido con Incidencias') {
      submitBtn.style.display = 'none';
    } else {
      submitBtn.style.display = 'inline-block';
    }
  }

  container.querySelectorAll('.btn-status-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetStatus = btn.getAttribute('data-status');
      
      if (btn.classList.contains('btn-status-choice')) {
        container.querySelectorAll('.btn-status-choice').forEach(b => {
          b.style.backgroundColor = 'transparent';
          b.style.color = b.getAttribute('data-status') === 'Recibido Conforme' ? 'var(--color-success)' : 'var(--color-danger)';
        });
        btn.style.backgroundColor = targetStatus === 'Recibido Conforme' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
      }
      
      statusInput.value = targetStatus;
      handleManageStatusChange(targetStatus);
    });
  });

  const singleActionBtn = container.querySelector('.btn-status-action:not(.btn-status-choice)');
  if (singleActionBtn) {
    singleActionBtn.click();
  } else {
    handleManageStatusChange(currentStatus);
  }
}

function handleManageStatusChange(status) {
  const qtyDeclared = parseInt(document.getElementById('manage-dec-qty-declared').textContent) || 0;
  const qtyReceivedInput = document.getElementById('manage-dec-qty-received');
  const qtyIncidentsInput = document.getElementById('manage-dec-qty-incidents');
  const incidentsPanel = document.getElementById('manage-dec-incidents-panel');
  const groupReceived = document.getElementById('manage-dec-group-received');
  const groupIncidents = document.getElementById('manage-dec-group-incidents');
  const groupWarehouse = document.getElementById('manage-dec-group-warehouse');
  const groupVolumeConfirmed = document.getElementById('manage-dec-group-volume-confirmed');
  const volumeConfirmedInput = document.getElementById('manage-dec-volume-confirmed');
  
  if (status === 'Bodega Asignada') {
    if (groupWarehouse) {
      groupWarehouse.style.display = 'block';
      const selectEl = document.getElementById('manage-dec-warehouse-select');
      if (selectEl) selectEl.setAttribute('required', 'required');
    }
  } else {
    if (groupWarehouse) {
      groupWarehouse.style.display = 'none';
      const selectEl = document.getElementById('manage-dec-warehouse-select');
      if (selectEl) selectEl.removeAttribute('required');
    }
  }

  if (['En Recepción - Pendiente Conteo', 'En proceso de conteo/clasificación', 'Recibido Conforme', 'Recibido con Incidencias'].indexOf(status) !== -1) {
    if (groupVolumeConfirmed) groupVolumeConfirmed.style.display = 'block';
    if (volumeConfirmedInput) volumeConfirmedInput.setAttribute('required', 'required');
  } else {
    if (groupVolumeConfirmed) groupVolumeConfirmed.style.display = 'none';
    if (volumeConfirmedInput) volumeConfirmedInput.removeAttribute('required');
  }
  
  if (status === 'Recibido Conforme') {
    if (groupReceived) groupReceived.style.display = 'block';
    if (groupIncidents) groupIncidents.style.display = 'block';
    qtyReceivedInput.value = qtyDeclared;
    qtyReceivedInput.disabled = true;
    qtyReceivedInput.setAttribute('required', 'required');
    qtyIncidentsInput.value = 0;
    qtyIncidentsInput.disabled = true;
    qtyIncidentsInput.setAttribute('required', 'required');
    incidentsPanel.style.display = 'none';
  } else if (status === 'Recibido con Incidencias') {
    if (groupReceived) groupReceived.style.display = 'block';
    if (groupIncidents) groupIncidents.style.display = 'block';
    qtyReceivedInput.disabled = false;
    qtyReceivedInput.setAttribute('required', 'required');
    qtyIncidentsInput.disabled = false;
    qtyIncidentsInput.setAttribute('required', 'required');
    incidentsPanel.style.display = 'block';
    if (parseInt(qtyIncidentsInput.value) <= 0) {
      qtyIncidentsInput.value = 1;
    }
    renderIncidentsInputsList();
  } else {
    if (groupReceived) groupReceived.style.display = 'none';
    if (groupIncidents) groupIncidents.style.display = 'none';
    qtyReceivedInput.value = 0;
    qtyReceivedInput.removeAttribute('required');
    qtyIncidentsInput.value = 0;
    qtyIncidentsInput.removeAttribute('required');
    incidentsPanel.style.display = 'none';
  }
}

function renderIncidentsInputsList() {
  const container = document.getElementById('manage-dec-incidents-list-container');
  if (!container) return;
  container.innerHTML = '';
  
  if (currentDeclarationIncidents.length === 0) {
    currentDeclarationIncidents.push('');
  }
  
  currentDeclarationIncidents.forEach((inc, idx) => {
    container.innerHTML += `
      <div style="display: flex; gap: 0.5rem; align-items: center;" class="incident-item-row" data-index="${idx}">
        <span style="font-size: 0.85rem; font-weight: 600; color: var(--color-danger); width: 20px;">${idx + 1}.</span>
        <input type="text" class="form-input incident-desc-input" style="flex: 1; padding: 0.35rem; font-size: 0.85rem;" value="${inc.replace(/"/g, '&quot;')}" placeholder="Ej. Caja 3 mojada, daño menor">
        <button type="button" class="btn btn-outline btn-remove-incident" style="padding: 0.25rem 0.4rem; color: var(--color-danger); border-color: rgba(239, 68, 68, 0.2); height: auto; margin: 0; line-height: 1;" data-index="${idx}" title="Eliminar">&times;</button>
      </div>
    `;
  });
}

function saveCurrentIncidentsInputs() {
  const inputs = document.querySelectorAll('.incident-desc-input');
  currentDeclarationIncidents = Array.from(inputs).map(inp => inp.value.trim());
}

// Global change listener for status dropdown
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'manage-dec-status') {
    handleManageStatusChange(e.target.value);
  }
});

// Click listener for dynamic incidents list
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-add-incident-item') {
    e.preventDefault();
    saveCurrentIncidentsInputs();
    currentDeclarationIncidents.push('');
    renderIncidentsInputsList();
  }
  
  const removeBtn = e.target.closest('.btn-remove-incident');
  if (removeBtn) {
    e.preventDefault();
    const idx = parseInt(removeBtn.getAttribute('data-index'));
    saveCurrentIncidentsInputs();
    currentDeclarationIncidents.splice(idx, 1);
    renderIncidentsInputsList();
  }
});

window.manageDeclaration = async function(id) {
  try {
    const { data: dec, error } = await supabase
      .from('stock_declarations')
      .select('*, profiles (company_name), warehouses (name, address, comuna)')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Llenar campos informativos del modal
    document.getElementById('manage-dec-id').value = dec.id;
    document.getElementById('manage-dec-merchant').innerHTML = `<strong>${dec.comercio || 'no asignado'}</strong> <span style="font-size: 0.85rem; color: var(--color-text-muted);">(${dec.profiles?.company_name || 'Desconocido'})</span>`;
    document.getElementById('manage-dec-title').textContent = dec.title;
    
    let etaText = '';
    if (dec.estimated_arrival_type === 'exact') {
      const [y, m, d] = dec.estimated_arrival_date.split('-');
      etaText = `${d}/${m}/${y}`;
    } else {
      etaText = dec.estimated_arrival_period;
    }
    document.getElementById('manage-dec-date').textContent = etaText;
    document.getElementById('manage-dec-qty-declared').textContent = dec.quantity_declared;
    document.getElementById('manage-dec-volume-declared').textContent = dec.volume_declared || 0;
    document.getElementById('manage-dec-packages').textContent = dec.package_count;
    document.getElementById('manage-dec-package-type').textContent = dec.package_type;
    document.getElementById('manage-dec-container-count').textContent = dec.container_count || 0;
    document.getElementById('manage-dec-pallet-count').textContent = dec.pallet_count || 0;
    document.getElementById('manage-dec-box-count').textContent = dec.box_count || 0;
    document.getElementById('manage-dec-unloading').innerHTML = dec.requires_unloading 
      ? '<span style="color: var(--color-warning); font-weight: bold;">Sí, solicitada (0.1 UF x m³)</span>' 
      : 'No requerida';
    document.getElementById('manage-dec-estimated-cost').textContent = (dec.estimated_cost || 0).toFixed(2) + ' UF';
    document.getElementById('manage-dec-method').textContent = dec.delivery_method;

    // Bodega asignada
    const warehouseNameEl = document.getElementById('manage-dec-warehouse-name');
    if (warehouseNameEl) {
      if (dec.warehouses) {
        warehouseNameEl.innerHTML = `<strong>${dec.warehouses.name}</strong> <span style="font-size: 0.85rem; color: var(--color-text-muted);">(${dec.warehouses.comuna}, ${dec.warehouses.address})</span>`;
      } else {
        warehouseNameEl.innerHTML = '<span style="color: var(--color-text-muted); font-style: italic;">No asignada</span>';
      }
    }

    // Cargar bodegas para el selector
    const { data: warehouses } = await supabase
      .from('warehouses')
      .select('id, name, address, comuna, operating_days')
      .order('name');

    const selectEl = document.getElementById('manage-dec-warehouse-select');
    if (selectEl) {
      selectEl.innerHTML = '<option value="">-- Selecciona una Bodega --</option>';
      if (warehouses) {
        warehouses.forEach(w => {
          selectEl.innerHTML += `<option value="${w.id}">${w.name} (${w.comuna})</option>`;
        });
      }
      selectEl.value = dec.warehouse_id || '';
    }

    // Contacto y transportista
    document.getElementById('manage-dec-contact').textContent = dec.contact_info || 'No registrado';
    document.getElementById('manage-dec-carrier').textContent = dec.carrier_info || 'No registrado';
    document.getElementById('manage-dec-notes').textContent = dec.notes || 'Sin notas del cliente';

    // Rellenar campos del formulario
    document.getElementById('manage-dec-status').value = dec.status;
    document.getElementById('manage-dec-stage-comment').value = '';
    
    currentDeclarationIncidents = dec.incidents_list || [];
    
    // Si la cantidad recibida es 0 y el estado es Creada, sugerimos la declarada para ahorrar trabajo
    document.getElementById('manage-dec-qty-received').value = dec.status === 'Creada' ? dec.quantity_declared : dec.quantity_received;
    document.getElementById('manage-dec-qty-incidents').value = dec.quantity_incidents;
    document.getElementById('manage-dec-volume-confirmed').value = (dec.status === 'Creada' || dec.status === 'Bodega Asignada') ? (dec.volume_declared || '') : (dec.volume_confirmed || '');
    document.getElementById('manage-dec-admin-notes').value = dec.admin_notes || '';

    // Renderizar botones de acción según el estado actual de la declaración
    renderStatusActionButtons(dec.status);

    // Limpiar alertas previas
    document.getElementById('modal-dec-alert-container').innerHTML = '';

    // Mostrar el modal
    document.getElementById('modal-manage-declaration').classList.add('active');

  } catch (err) {
    console.error('Error fetching declaration details for manage:', err);
    alert('Error al obtener los detalles de la declaración: ' + err.message);
  }
};

// Event Delegation for managing declarations form submission
document.addEventListener('submit', async (e) => {
  if (e.target && e.target.id === 'form-manage-declaration') {
    e.preventDefault();

    const id = document.getElementById('manage-dec-id').value;
    const status = document.getElementById('manage-dec-status').value;
    let qtyReceived = parseInt(document.getElementById('manage-dec-qty-received').value);
    let qtyIncidents = parseInt(document.getElementById('manage-dec-qty-incidents').value);
    const stageComment = document.getElementById('manage-dec-stage-comment').value.trim();
    const adminNotes = document.getElementById('manage-dec-admin-notes').value.trim();
    const alertContainer = document.getElementById('modal-dec-alert-container');

    // Validador de cantidades básicas
    if (isNaN(qtyReceived) || qtyReceived < 0) {
      alertContainer.innerHTML = '<div class="alert alert-error" style="display:block;">La cantidad recibida debe ser un número válido mayor o igual a 0.</div>';
      return;
    }

    if (isNaN(qtyIncidents) || qtyIncidents < 0) {
      alertContainer.innerHTML = '<div class="alert alert-error" style="display:block;">La cantidad de incidencias debe ser un número válido mayor o igual a 0.</div>';
      return;
    }

    if (!stageComment) {
      alertContainer.innerHTML = '<div class="alert alert-error" style="display:block;">El comentario de la etapa / notas de avance es obligatorio.</div>';
      return;
    }

    // Validar volumen confirmado si el estado requiere confirmación de recepción
    let volumeConfirmed = 0;
    if (['En Recepción - Pendiente Conteo', 'En proceso de conteo/clasificación', 'Recibido Conforme', 'Recibido con Incidencias'].indexOf(status) !== -1) {
      volumeConfirmed = parseFloat(document.getElementById('manage-dec-volume-confirmed').value);
      if (isNaN(volumeConfirmed) || volumeConfirmed <= 0) {
        alertContainer.innerHTML = '<div class="alert alert-error" style="display:block;">El volumen confirmado (m³) es obligatorio y debe ser mayor a 0.</div>';
        return;
      }
    }

    // Validar bodega si es Bodega Asignada
    let warehouseId = null;
    if (status === 'Bodega Asignada') {
      const selectEl = document.getElementById('manage-dec-warehouse-select');
      warehouseId = selectEl ? selectEl.value : null;
      if (!warehouseId) {
        alertContainer.innerHTML = '<div class="alert alert-error" style="display:block;">Debes seleccionar una bodega obligatoriamente.</div>';
        return;
      }
    }

    // Reglas según estado específico
    let incidentsList = [];
    if (status === 'Recibido Conforme') {
      const qtyDeclared = parseInt(document.getElementById('manage-dec-qty-declared').textContent) || 0;
      qtyReceived = qtyDeclared;
      qtyIncidents = 0;
    } else if (status === 'Recibido con Incidencias') {
      saveCurrentIncidentsInputs();
      incidentsList = currentDeclarationIncidents.filter(Boolean);
      if (incidentsList.length === 0) {
        alertContainer.innerHTML = '<div class="alert alert-error" style="display:block;">Debes describir al menos 1 incidencia detallada cuando seleccionas "Recibido con Incidencias".</div>';
        return;
      }
      if (qtyIncidents <= 0) {
        alertContainer.innerHTML = '<div class="alert alert-error" style="display:block;">La cantidad de incidencias debe ser mayor a 0 para el estado "Recibido con Incidencias".</div>';
        return;
      }
    }

    const saveBtn = e.target.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando cambios...';

    try {
      // 1. Obtener historial previo de la base de datos
      const { data: latestDec, error: fetchError } = await supabase
        .from('stock_declarations')
        .select('history')
        .eq('id', id)
        .single();
        
      if (fetchError) throw fetchError;
      
      const existingHistory = latestDec.history || [];
      const newHistoryEntry = {
        status: status,
        timestamp: new Date().toISOString(),
        comment: stageComment
      };
      const updatedHistory = [...existingHistory, newHistoryEntry];
 
      // 2. Ejecutar actualización
      const updateData = {
        status: status,
        quantity_received: qtyReceived,
        quantity_incidents: qtyIncidents,
        incidents_list: status === 'Recibido con Incidencias' ? incidentsList : [],
        history: updatedHistory,
        admin_notes: adminNotes,
        updated_at: new Date().toISOString()
      };

      if (['En Recepción - Pendiente Conteo', 'En proceso de conteo/clasificación', 'Recibido Conforme', 'Recibido con Incidencias'].indexOf(status) !== -1) {
        updateData.volume_confirmed = volumeConfirmed;
      }
 
      if (status === 'Bodega Asignada') {
        updateData.warehouse_id = warehouseId;
      }

      const { error } = await supabase
        .from('stock_declarations')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      // 3. Enviar notificaciones
      try {
        const { data: updatedDec } = await supabase
          .from('stock_declarations')
          .select('title, comercio, warehouse_id, warehouses(name, address, comuna, operating_days)')
          .eq('id', id)
          .single();

        if (updatedDec) {
          const title = updatedDec.title;
          const comercio = updatedDec.comercio;
          
          if (status === 'Bodega Asignada' && updatedDec.warehouses) {
            const wh = updatedDec.warehouses;
            const notifTitle = 'Bodega Asignada a tu Ingreso de Stock';
            const notifMsg = `Tu ingreso de stock "${title}" tiene asignada la bodega: "${wh.name}" (Dirección: ${wh.address}, Comuna: ${wh.comuna}). Días de operación: ${wh.operating_days || 'Lunes a Viernes'}.`;
            await notifyCommerceUsers(comercio, notifTitle, notifMsg);
          } else {
            const notifTitle = 'Actualización de Estado de Ingreso';
            let commentText = stageComment ? ` Comentario: "${stageComment}"` : '';
            const notifMsg = `El estado de tu ingreso de stock "${title}" ha cambiado a: "${status}".${commentText}`;
            await notifyCommerceUsers(comercio, notifTitle, notifMsg);
          }
        }
      } catch (notifErr) {
        console.error('Error al enviar notificaciones:', notifErr);
      }

      alert('Recepción de ingreso actualizada correctamente y se notificó al usuario.');
      document.getElementById('modal-manage-declaration').classList.remove('active');
      
      // Refrescar tabla
      renderDeclarationsAdmin();
    } catch (err) {
      console.error('Error updating stock reception:', err);
      alertContainer.innerHTML = `<div class="alert alert-error" style="display:block;">Error al guardar cambios: ${err.message}</div>`;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar Cambios';
    }
  }
});

// --- GESTIÓN DE BODEGAS ---

window.renderWarehousesAdmin = async function() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = '<p class="text-center" style="padding: 2rem;">Cargando bodegas...</p>';

  try {
    const { data: warehouses, error } = await supabase
      .from('warehouses')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    let rowsHtml = '';
    if (!warehouses || warehouses.length === 0) {
      rowsHtml = '<tr><td colspan="5" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay bodegas registradas.</td></tr>';
    } else {
      warehouses.forEach(w => {
        rowsHtml += `
          <tr>
            <td style="font-weight: 600; color: var(--color-text-main);">${w.name}</td>
            <td>${w.address}</td>
            <td>${w.comuna}</td>
            <td><span style="font-size: 0.85rem; font-family: var(--font-family); background: var(--color-surface-hover); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--color-border);">${w.operating_days}</span></td>
            <td>
              <button class="btn btn-outline btn-sm" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; font-weight: 500; cursor: pointer; border-color: var(--color-danger); color: var(--color-danger); background: var(--color-surface);" onclick="deleteWarehouse('${w.id}')">
                <i class="ri-delete-bin-line"></i> Eliminar
              </button>
            </td>
          </tr>
        `;
      });
    }

    appContent.innerHTML = `
      <div style="display: grid; grid-template-columns: 350px 1fr; gap: 1.5rem; align-items: start;">
        <!-- Formulario de creación (izquierda) -->
        <div class="card" style="border: none; box-shadow: var(--shadow-md); padding: 1.5rem; background: var(--color-surface);">
          <h3 style="margin-top: 0; margin-bottom: 1.25rem; font-size: 1.15rem; display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
            <i class="ri-add-circle-line" style="color: var(--color-primary);"></i> Nueva Bodega
          </h3>
          <form id="form-create-warehouse" style="display: flex; flex-direction: column; gap: 1rem;">
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-weight: 600;">Nombre de la Bodega *</label>
              <input type="text" id="wh-name" class="form-input" placeholder="Ej: Bodega Central Pudahuel" required style="width: 100%;">
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-weight: 600;">Dirección *</label>
              <input type="text" id="wh-address" class="form-input" placeholder="Ej: Av. Américo Vespucio 1234" required style="width: 100%;">
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-weight: 600;">Comuna *</label>
              <input type="text" id="wh-comuna" class="form-input" placeholder="Ej: Pudahuel" required style="width: 100%;">
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label" style="font-weight: 600;">Días y Horarios de Operación *</label>
              <input type="text" id="wh-operating-days" class="form-input" placeholder="Ej: Lunes a Viernes 08:30 - 17:30" required style="width: 100%;">
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top: 0.5rem; justify-content: center; width: 100%; font-weight: 600;">
              <i class="ri-save-line"></i> Guardar Bodega
            </button>
          </form>
        </div>

        <!-- Tabla de listado (derecha) -->
        <div class="card" style="border: none; box-shadow: var(--shadow-md); background: var(--color-surface);">
          <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.25rem;">
            <h3 style="margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-building-2-line" style="color: var(--color-primary);"></i> Bodegas Registradas
            </h3>
          </div>
          <div class="card-body table-responsive" style="padding: 0;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Dirección</th>
                  <th>Comuna</th>
                  <th>Días de Operación</th>
                  <th style="width: 120px;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Escuchar el submit del formulario
    document.getElementById('form-create-warehouse').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="ri-loader-4-line animate-spin"></i> Guardando...';

      try {
        const name = document.getElementById('wh-name').value.trim();
        const address = document.getElementById('wh-address').value.trim();
        const comuna = document.getElementById('wh-comuna').value.trim();
        const operatingDays = document.getElementById('wh-operating-days').value.trim();

        const { error: insertError } = await supabase
          .from('warehouses')
          .insert([{
            name: name,
            address: address,
            comuna: comuna,
            operating_days: operatingDays
          }]);

        if (insertError) throw insertError;

        alert('Bodega creada exitosamente.');
        renderWarehousesAdmin();
      } catch (err) {
        console.error('Error creating warehouse:', err);
        alert('Error al crear bodega: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ri-save-line"></i> Guardar Bodega';
      }
    });

  } catch (err) {
    console.error('Error loading warehouses:', err);
    appContent.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--color-danger);"><i class="ri-error-warning-line" style="font-size: 2.5rem; display: block; margin-bottom: 1rem;"></i><h4>Error al cargar bodegas</h4><p>${err.message}</p></div>`;
  }
};

window.deleteWarehouse = async function(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar esta bodega? Las declaraciones asociadas quedarán sin bodega asignada.')) return;
  try {
    const { error } = await supabase
      .from('warehouses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    alert('Bodega eliminada correctamente.');
    renderWarehousesAdmin();
  } catch (err) {
    console.error('Error deleting warehouse:', err);
    alert('Error al eliminar la bodega: ' + err.message);
  }
};

// --- HELPER DE NOTIFICACIONES ---

async function notifyCommerceUsers(comercio, title, message) {
  try {
    if (!comercio || comercio === 'no asignado') return;
    
    // 1. Obtener todos los perfiles con rol client
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, comercio')
      .eq('role', 'client');
      
    if (error) {
      console.error('Error al obtener perfiles para notificar:', error);
      return;
    }
    
    if (!profiles || profiles.length === 0) return;
    
    // 2. Filtrar perfiles asociados al comercio (soporta listas separadas por coma)
    const targetProfiles = profiles.filter(p => {
      if (!p.comercio || p.comercio === 'no asignado') return false;
      const userComercios = p.comercio.split(',').map(c => c.trim().toLowerCase());
      return userComercios.includes(comercio.toLowerCase());
    });
    
    if (targetProfiles.length === 0) return;
    
    // 3. Crear las inserciones para dashboard_notifications
    const inserts = targetProfiles.map(p => ({
      user_id: p.id,
      target_role: 'client',
      title: title,
      message: message,
      is_read: false
    }));
    
    const { error: insertError } = await supabase
      .from('dashboard_notifications')
      .insert(inserts);
      
    if (insertError) {
      console.error('Error al insertar notificaciones en la base de datos:', insertError);
    }
  } catch (err) {
    console.error('Error en notifyCommerceUsers:', err);
  }
}

window.deleteDeclarationAdmin = async function(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este ingreso de stock? Esta acción no se puede deshacer.')) return;
  
  try {
    const { data: dec, error: fetchErr } = await supabase
      .from('stock_declarations')
      .select('status')
      .eq('id', id)
      .single();
      
    if (fetchErr) throw fetchErr;
    
    if (dec.status === 'Recibido Conforme' || dec.status === 'Recibido con Incidencias') {
      alert('No se permite eliminar un ingreso de stock que ya ha sido recibido o recibido con incidencias.');
      return;
    }

    const { error } = await supabase
      .from('stock_declarations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    alert('Ingreso de stock eliminado exitosamente por el administrador.');
    renderDeclarationsAdmin();
  } catch (err) {
    console.error('Error al eliminar ingreso de stock (admin):', err);
    alert('Error al eliminar ingreso de stock: ' + err.message);
  }
};

// =========================================================================
// MÓDULO DE FACTURACIÓN Y COBRANZA - ADMIN
// =========================================================================

function injectBillingStyles() {
  if (document.getElementById('billing-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'billing-styles';
  style.innerHTML = `
    .billing-input {
      background: transparent;
      border: 1px solid transparent;
      padding: 0.25rem;
      border-radius: var(--radius-sm);
      color: var(--color-text-main);
      width: 100%;
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    .billing-input:hover {
      border-color: var(--color-border);
      background: var(--color-bg);
    }
    .billing-input:focus {
      border-color: var(--color-primary);
      background: var(--color-surface);
      outline: none;
    }
    .billing-select {
      border: none;
      border-radius: var(--radius-sm);
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      outline: none;
      text-align-last: center;
      transition: all 0.2s;
      appearance: none;
    }
    .status-green { background-color: rgba(16, 185, 129, 0.15) !important; color: #065f46 !important; border: 1px solid rgba(16, 185, 129, 0.3) !important; }
    .status-green-light { background-color: rgba(52, 211, 153, 0.15) !important; color: #047857 !important; border: 1px solid rgba(52, 211, 153, 0.3) !important; }
    .status-gray { background-color: rgba(148, 163, 184, 0.15) !important; color: #475569 !important; border: 1px solid rgba(148, 163, 184, 0.3) !important; }
    .status-blue { background-color: rgba(59, 130, 246, 0.15) !important; color: #1e40af !important; border: 1px solid rgba(59, 130, 246, 0.3) !important; }
    .status-purple { background-color: rgba(139, 92, 246, 0.15) !important; color: #5b21b6 !important; border: 1px solid rgba(139, 92, 246, 0.3) !important; }
    .status-yellow { background-color: rgba(245, 158, 11, 0.15) !important; color: #854d0e !important; border: 1px solid rgba(245, 158, 11, 0.3) !important; }
    .status-red { background-color: rgba(239, 68, 68, 0.15) !important; color: #991b1b !important; border: 1px solid rgba(239, 68, 68, 0.3) !important; }
    .status-teal { background-color: rgba(20, 184, 166, 0.15) !important; color: #115e59 !important; border: 1px solid rgba(20, 184, 166, 0.3) !important; }
    .status-cyan { background-color: rgba(6, 182, 212, 0.15) !important; color: #075985 !important; border: 1px solid rgba(6, 182, 212, 0.3) !important; }
    
    .billing-period-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      margin-bottom: 1rem;
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }
    .billing-period-header {
      padding: 1rem 1.5rem;
      background: var(--color-surface);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      transition: background 0.2s;
    }
    .billing-period-header:hover {
      background: var(--color-surface-hover);
    }
    .billing-period-body {
      display: none;
      border-top: 1px solid var(--color-border);
      padding: 0;
      overflow: auto;
      max-height: calc(100vh - 250px);
    }
    .billing-period-body table {
      margin: 0;
    }
    .billing-period-card.active .billing-period-body {
      display: block;
    }
    .billing-period-card.active .billing-period-header i.collapse-icon {
      transform: rotate(90deg);
    }
    .collapse-icon {
      transition: transform 0.2s;
    }
    .billing-saving-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.8rem;
      color: var(--color-success);
      opacity: 0;
      transition: opacity 0.3s;
    }
    .billing-saving-badge.show {
      opacity: 1;
    }
    .text-right {
      text-align: right;
    }
    
    .billing-tab-btn {
      background: transparent;
      border: none;
      padding: 0.5rem 1rem;
      color: var(--color-text-muted);
      cursor: pointer;
      font-weight: 500;
      font-size: 0.9rem;
      border-bottom: 2px solid transparent;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.2s;
    }
    .billing-tab-btn.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
      font-weight: 600;
    }
    .billing-tab-btn:hover {
      color: var(--color-text-main);
    }
    
    /* Dashboard styles */
    .dashboard-subtabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      background: var(--color-surface-hover);
      padding: 0.35rem;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      width: fit-content;
    }
    .dashboard-subtab-btn {
      background: transparent;
      border: none;
      padding: 0.4rem 1rem;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      border-radius: var(--radius-sm);
      transition: all 0.2s;
    }
    .dashboard-subtab-btn.active {
      background: var(--color-surface);
      color: var(--color-primary);
      box-shadow: var(--shadow-sm);
      font-weight: 600;
    }
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .dashboard-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
    }
    .dashboard-card::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 3px;
      background: transparent;
      transition: background-color 0.2s;
    }
    .dashboard-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
      border-color: var(--color-primary);
    }
    .dashboard-card.primary::after { background: var(--color-primary); }
    .dashboard-card.success::after { background: var(--color-success); }
    .dashboard-card.warning::after { background: var(--color-warning); }
    .dashboard-card.danger::after { background: var(--color-danger); }
    .dashboard-card.info::after { background: var(--color-cyan); }
    
    .dashboard-card-label {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .dashboard-card-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text-main);
      margin-bottom: 0.25rem;
    }
    .dashboard-card-sub {
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }
    
    /* Dashboard Modal */
    .d-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1100;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .d-modal-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }
    .d-modal-container {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      width: 90%;
      max-width: 750px;
      max-height: 85%;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-xl);
      transform: scale(0.95);
      transition: transform 0.3s ease;
      overflow: hidden;
    }
    .d-modal-overlay.active .d-modal-container {
      transform: scale(1);
    }
    .d-modal-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--color-surface);
    }
    .d-modal-header h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--color-text-main);
    }
    .d-modal-close {
      background: transparent;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 1.5rem;
      line-height: 1;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
    }
    .d-modal-close:hover {
      color: var(--color-text-main);
    }
    .d-modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
    }
    
    /* Switch toggle styles */
    .billing-switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 22px;
    }
    .billing-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .billing-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--color-border);
      transition: .3s;
      border-radius: 22px;
    }
    .billing-switch input:checked + .billing-slider {
      background-color: var(--color-success);
    }
    .billing-switch input:focus + .billing-slider {
      box-shadow: 0 0 1px var(--color-success);
    }
    .billing-switch input:checked + .billing-slider:before {
      transform: translateX(22px);
    }
    .billing-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
    }
  `;
  document.head.appendChild(style);
}

function getStatusClass(val) {
  if (!val) return 'status-gray';
  const v = val.toLowerCase();
  if (['sin movimientos'].includes(v)) return 'status-green-light';
  if (['enviado', 'emitida', 'aprobado'].includes(v)) return 'status-green';
  if (['creado'].includes(v)) return 'status-cyan';
  if (['por generar', 'por solicitar', 'esperando', 'no se factura'].includes(v)) return 'status-gray';
  if (['recibido'].includes(v)) return 'status-blue';
  if (['en espera'].includes(v)) return 'status-purple';
  if (['facturar'].includes(v)) return 'status-yellow';
  if (['atrasado', 'incobrable'].includes(v)) return 'status-red';
  if (['abono'].includes(v)) return 'status-teal';
  return 'status-gray';
}

async function checkBillingSuspension(companyStr) {
  if (!companyStr) return;
  try {
    const list = companyStr.split(',').map(c => c.trim()).filter(Boolean);
    if (list.length === 0) return;
    
    const { data: mappings } = await supabase
      .from('billing_mappings')
      .select('comercio_nombre, billing_name');
    
    const billingComercios = new Set();
    list.forEach(c => {
      const match = mappings?.find(m => m.comercio_nombre.toLowerCase() === c.toLowerCase());
      billingComercios.add(match ? match.billing_name : c);
    });
    
    const resolvedList = Array.from(billingComercios);
    
    const { data: statuses, error } = await supabase
      .from('commerce_billing_status')
      .select('comercio, al_dia')
      .in('comercio', resolvedList);
      
    if (error) throw error;
    
    const pausedComercios = statuses?.filter(s => !s.al_dia).map(s => s.comercio) || [];
    if (pausedComercios.length > 0) {
      showSuspensionBanner(pausedComercios);
    }
  } catch (err) {
    console.error('Error checking billing suspension:', err);
  }
}

function showSuspensionBanner(pausedComercios) {
  if (document.getElementById('billing-suspension-banner')) return;
  const mainContent = document.querySelector('.main-content');
  if (!mainContent) return;
  
  const banner = document.createElement('div');
  banner.id = 'billing-suspension-banner';
  banner.style.cssText = `
    background-color: #ef4444; 
    color: white; 
    padding: 0.75rem 1.5rem; 
    text-align: center; 
    font-weight: 500; 
    font-size: 0.9rem;
    display: flex; 
    align-items: center; 
    justify-content: center; 
    gap: 0.5rem;
    border-bottom: 2px solid #b91c1c;
  `;
  banner.innerHTML = `
    <i class="ri-error-warning-fill" style="font-size: 1.25rem;"></i>
    <span><strong>Servicio Pausado:</strong> El comercio <strong>${pausedComercios.join(', ')}</strong> se encuentra con servicio pausado. Por favor regularizar a la brevedad con nuestra área de finanzas a <a href="mailto:finanzas@stocka.cl" style="color: white; text-decoration: underline; font-weight: 700;">finanzas@stocka.cl</a>.</span>
  `;
  mainContent.insertBefore(banner, mainContent.firstChild);
}

window.toggleCommerceAlDia = async function(comercio, checkboxEl) {
  const alDia = checkboxEl.checked;
  const actionText = alDia ? 'marcar AL DÍA' : 'poner en SERVICIO PAUSADO';
  if (!confirm(`¿Estás seguro de que deseas ${actionText} al comercio ${comercio}?`)) {
    // Revertir el estado visual del checkbox
    checkboxEl.checked = !alDia;
    return;
  }

  showSavingBadge(true);
  try {
    const { error } = await supabase
      .from('commerce_billing_status')
      .upsert({ comercio, al_dia: alDia, updated_at: new Date().toISOString() }, { onConflict: 'comercio' });
    if (error) throw error;
    setTimeout(() => showSavingBadge(false), 500);
  } catch (err) {
    console.error('Error updating commerce status:', err);
    alert('Error al actualizar estado del comercio: ' + err.message);
    checkboxEl.checked = !alDia; // Revertir en caso de error
    showSavingBadge(false);
  }
};

window.loadCommerceStatusTab = async function() {
  const container = document.getElementById('status-list-container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
      <i class="ri-loader-4-line spin" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
      Cargando estados de comercio...
    </div>
  `;
  
  try {
    // 1. Obtener registros de facturación para sacar comercios únicos
    const { data: records, error: recError } = await supabase
      .from('billing_records')
      .select('comercio');
      
    if (recError) throw recError;
    
    // 2. Obtener los estados guardados
    const { data: statuses, error: statError } = await supabase
      .from('commerce_billing_status')
      .select('*');
      
    if (statError) throw statError;
    
    // Unificar todos los comercios únicos
    const commerceNames = new Set();
    if (records) records.forEach(r => { if (r.comercio) commerceNames.add(r.comercio.trim()); });
    if (statuses) statuses.forEach(s => { if (s.comercio) commerceNames.add(s.comercio.trim()); });
    
    const uniqueCommerces = [...commerceNames].sort();
    
    const statusMap = {};
    const updatedMap = {};
    if (statuses) {
      statuses.forEach(s => {
        statusMap[s.comercio.trim()] = s.al_dia;
        updatedMap[s.comercio.trim()] = s.updated_at;
      });
    }
    
    if (uniqueCommerces.length === 0) {
      container.innerHTML = `
        <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
          No se encontraron comercios registrados en el sistema.
        </div>
      `;
      return;
    }
    
    let tableRows = '';
    uniqueCommerces.forEach(c => {
      const alDia = statusMap[c] !== false; // Default true
      const updatedAt = updatedMap[c] ? new Date(updatedMap[c]).toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) : 'No registrado';
      
      const badge = alDia 
        ? `<span class="badge status-green" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;"><i class="ri-checkbox-circle-line"></i> Activo / Al Día</span>`
        : `<span class="badge status-red" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;"><i class="ri-alert-line"></i> Pausado por Facturación</span>`;
      
      tableRows += `
        <tr class="commerce-status-row" data-commerce-name="${c.toLowerCase()}">
          <td style="font-weight: 600; color: var(--color-text-main); font-size: 0.95rem; padding: 1rem 1.25rem; vertical-align: middle;">
            ${c}
          </td>
          <td style="vertical-align: middle; padding: 1rem 1.25rem;">
            ${badge}
          </td>
          <td style="vertical-align: middle; padding: 1rem 1.25rem; text-align: center;">
            <label class="billing-switch" style="vertical-align: middle;">
              <input type="checkbox" ${alDia ? 'checked' : ''} onchange="toggleCommerceAlDiaTab('${c}', this)">
              <span class="billing-slider"></span>
            </label>
          </td>
          <td style="color: var(--color-text-muted); font-size: 0.8rem; vertical-align: middle; padding: 1rem 1.25rem;">
            ${updatedAt}
          </td>
        </tr>
      `;
    });
    
    container.innerHTML = `
      <table class="data-table" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 1rem 1.25rem;">Comercio</th>
            <th style="text-align: left; padding: 1rem 1.25rem; width: 250px;">Estado de Servicio</th>
            <th style="text-align: center; padding: 1rem 1.25rem; width: 120px;">Acción (Activar/Pausar)</th>
            <th style="text-align: left; padding: 1rem 1.25rem; width: 220px;">Última Modificación</th>
          </tr>
        </thead>
        <tbody id="status-table-body">
          ${tableRows}
        </tbody>
      </table>
    `;
    
  } catch (err) {
    console.error("Error loading commerce status tab:", err);
    container.innerHTML = `
      <div style="padding: 2rem; color: var(--color-danger); text-align: center;">
        Error al cargar los estados de comercio: ${err.message}
      </div>
    `;
  }
};

window.filterStatusComercios = function() {
  const query = (document.getElementById('status-search-input')?.value || '').toLowerCase().trim();
  const rows = document.querySelectorAll('.commerce-status-row');
  rows.forEach(row => {
    const name = row.getAttribute('data-commerce-name') || '';
    if (name.includes(query)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
};

window.toggleCommerceAlDiaTab = async function(comercio, switchEl) {
  const alDia = switchEl.checked;
  const actionText = alDia ? 'marcar AL DÍA y ACTIVAR el servicio' : 'poner en SERVICIO PAUSADO';
  if (!confirm(`¿Estás seguro de que deseas ${actionText} para el comercio ${comercio}?`)) {
    switchEl.checked = !alDia;
    return;
  }
  
  showSavingBadge(true);
  try {
    const { error } = await supabase
      .from('commerce_billing_status')
      .upsert({ comercio, al_dia: alDia, updated_at: new Date().toISOString() }, { onConflict: 'comercio' });
      
    if (error) throw error;
    
    // Refrescar la pestaña completa para actualizar badge y timestamp
    await loadCommerceStatusTab();
    
    // Ejecutar verificación en segundo plano para actualizar banners globales
    Promise.resolve(supabase.rpc('check_overdue_payments')).catch(e => console.warn(e));
    
    setTimeout(() => showSavingBadge(false), 500);
  } catch (err) {
    console.error('Error updating commerce status from tab:', err);
    alert('Error al actualizar estado del comercio: ' + err.message);
    switchEl.checked = !alDia;
    showSavingBadge(false);
  }
};

async function cleanOldReceiptsJS() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: oldReports, error } = await supabase
      .from('payment_reports')
      .select('id, comprobante_url')
      .neq('status', 'pendiente')
      .not('comprobante_url', 'is', null)
      .lt('created_at', sevenDaysAgo.toISOString());
      
    if (error) throw error;
    
    if (oldReports && oldReports.length > 0) {
      console.log(`Eliminando ${oldReports.length} comprobantes antiguos...`);
      
      const filePaths = oldReports.map(rep => {
        const parts = rep.comprobante_url.split('/payment_receipts/');
        return parts.length > 1 ? parts[1] : null;
      }).filter(Boolean);
      
      if (filePaths.length > 0) {
        await supabase.storage
          .from('payment_receipts')
          .remove(filePaths);
      }
      
      const ids = oldReports.map(rep => rep.id);
      await supabase
        .from('payment_reports')
        .update({ comprobante_url: null })
        .in('id', ids);
    }
  } catch (err) {
    console.error('Error in cleanOldReceiptsJS:', err);
  }
}

window.renderBillingAdmin = async function() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  
  injectBillingStyles();
  
  // Ejecutar procesos automáticos de base de datos en segundo plano
  cleanOldReceiptsJS().catch(e => console.warn(e));
  Promise.resolve(supabase.rpc('check_overdue_payments')).catch(e => console.warn(e));
  
  appContent.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <div>
        <h3 style="margin: 0; font-size: 1.25rem; color: var(--color-text-main);">Control de Facturación</h3>
        <p style="margin: 0.25rem 0 0 0; font-size: 0.85rem; color: var(--color-text-muted);">Gestiona periodos, registros de facturación y avisos de pago de los comercios</p>
      </div>
      <div style="display: flex; gap: 0.75rem; align-items: center;">
        <span id="saving-badge" class="billing-saving-badge"><i class="ri-checkbox-circle-line"></i> Guardado</span>
        <button class="btn btn-primary" onclick="openCreatePeriodModal()"><i class="ri-add-line"></i> Nuevo Periodo</button>
      </div>
    </div>
    
    <!-- Tabs -->
    <div class="billing-tabs" style="display: flex; gap: 1rem; border-bottom: 1px solid var(--color-border); margin-bottom: 1.5rem; padding-bottom: 0.25rem;">
      <button class="billing-tab-btn" id="tab-control-btn" onclick="switchBillingAdminTab('control')"><i class="ri-bill-line"></i> Control de Facturas</button>
      <button class="billing-tab-btn" id="tab-reports-btn" onclick="switchBillingAdminTab('reports')"><i class="ri-notification-3-line"></i> Avisos de Pago <span id="pending-reports-badge" class="badge badge-danger" style="display: none; margin-left: 0.25rem; font-size: 0.7rem; padding: 0.15rem 0.35rem; border-radius: 50%;">0</span></button>
      <button class="billing-tab-btn active" id="tab-metrics-btn" onclick="switchBillingAdminTab('metrics')"><i class="ri-dashboard-line"></i> Dashboard</button>
      <button class="billing-tab-btn" id="tab-status-btn" onclick="switchBillingAdminTab('status')"><i class="ri-toggle-line"></i> Estados de Comercio</button>
    </div>
    
    <div id="tab-control-content" style="display: none;">
      <div id="periods-list-container">
        <div class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
          <i class="ri-loader-4-line spin" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
          Cargando periodos de facturación...
        </div>
      </div>
    </div>
    
    <div id="tab-reports-content" style="display: none;">
      <div class="card">
        <div class="card-header">
          <h3>Revisión de Avisos de Pago</h3>
        </div>
        <div class="card-body table-responsive" id="reports-list-container" style="padding: 0;">
          <!-- Cargado dinámicamente -->
        </div>
      </div>
    </div>

    <div id="tab-metrics-content" style="display: block;">
      <div id="metrics-dashboard-container">
        <!-- Cargado dinámicamente -->
      </div>
    </div>

    <div id="tab-status-content" style="display: none;">
      <div class="card">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h3 style="margin: 0; font-size: 1.1rem;"><i class="ri-toggle-line"></i> Estados de Servicio de Comercios</h3>
            <p style="margin: 0.15rem 0 0 0; font-size: 0.75rem; color: var(--color-text-muted);">Controla el estado del servicio activo o pausado por facturación para cada comercio</p>
          </div>
          <div style="position: relative;">
            <input type="text" id="status-search-input" class="form-input" placeholder="Buscar comercio..." style="padding-left: 2rem; margin: 0; width: 220px;" oninput="filterStatusComercios()">
            <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
          </div>
        </div>
        <div class="card-body table-responsive" id="status-list-container" style="padding: 0;">
          <!-- Cargado dinámicamente -->
        </div>
      </div>
    </div>
  `;
  
  await updatePendingReportsBadge();
  switchBillingAdminTab('metrics');
};

window.switchBillingAdminTab = function(tabName) {
  const tabs = ['control', 'reports', 'metrics', 'status'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-${t}-btn`);
    const content = document.getElementById(`tab-${t}-content`);
    if (btn && content) {
      if (t === tabName) {
        btn.classList.add('active');
        content.style.display = 'block';
      } else {
        btn.classList.remove('active');
        content.style.display = 'none';
      }
    }
  });

  if (tabName === 'control') {
    loadBillingPeriods();
  } else if (tabName === 'reports') {
    loadPendingPaymentReports();
  } else if (tabName === 'metrics') {
    loadBillingMetricsDashboard();
  } else if (tabName === 'status') {
    loadCommerceStatusTab();
  }
};

async function updatePendingReportsBadge() {
  try {
    const { count, error } = await supabase
      .from('payment_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendiente');
    if (error) throw error;
    const badge = document.getElementById('pending-reports-badge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error updating pending reports badge:', err);
  }
}

async function loadBillingPeriods() {
  const container = document.getElementById('periods-list-container');
  if (!container) return;
  
  try {
    const { data: periods, error } = await supabase
      .from('billing_periods')
      .select('*')
      .order('name', { ascending: false }); // Ordenar descendentemente por nombre (ej: JUNIO 2026 antes que MAYO 2026)
      
    if (error) throw error;
    
    if (!periods || periods.length === 0) {
      container.innerHTML = `
        <div class="card" style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
          <i class="ri-bill-line" style="font-size: 3rem; display: block; margin-bottom: 1rem; color: var(--color-border);"></i>
          <p style="font-weight: 500; font-size: 1rem; margin-bottom: 0.5rem;">No hay periodos de facturación</p>
          <p style="font-size: 0.85rem; margin-bottom: 1.5rem;">Comienza creando tu primer periodo mensual para llevar el control.</p>
          <button class="btn btn-primary btn-sm" onclick="openCreatePeriodModal()"><i class="ri-add-line"></i> Crear Periodo</button>
        </div>
      `;
      return;
    }
    
    // Agrupar periodos según el estado
    const activePeriods = periods.filter(p => p.status === 'activo');
    const inProcessPeriods = periods.filter(p => p.status === 'en_proceso');
    const upcomingPeriods = periods.filter(p => p.status === 'proximo');
    
    let html = '';
    
    // 1. Periodo Activo
    html += renderPeriodGroupSection('Periodo Activo', activePeriods, 'activo');
    
    // 2. En Proceso
    html += renderPeriodGroupSection('En Proceso', inProcessPeriods, 'en_proceso');
    
    // 3. Próximos Periodos
    html += renderPeriodGroupSection('Próximos Periodos', upcomingPeriods, 'proximo');
    
    container.innerHTML = html;
    
    // Expandir automáticamente el primer periodo activo si existe, de lo contrario el primero en proceso
    const firstPeriodCard = container.querySelector('.billing-period-card');
    if (firstPeriodCard) {
      const periodId = firstPeriodCard.getAttribute('data-period-id');
      togglePeriodCollapse(periodId, firstPeriodCard);
    }
    
  } catch (err) {
    console.error('Error loading billing periods:', err);
    container.innerHTML = `
      <div class="card" style="padding: 2rem; border-color: var(--color-danger); color: var(--color-danger);">
        <p><strong>Error al cargar periodos:</strong> ${err.message}</p>
      </div>
    `;
  }
}

function renderPeriodGroupSection(title, list, groupStatus) {
  if (list.length === 0) return '';
  
  let listHtml = '';
  list.forEach(p => {
    listHtml += `
      <div class="billing-period-card" id="period-card-${p.id}" data-period-id="${p.id}">
        <div class="billing-period-header" onclick="handlePeriodHeaderClick('${p.id}')">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <i class="ri-arrow-right-s-line collapse-icon" style="font-size: 1.25rem; color: var(--color-text-muted);"></i>
            <span style="font-weight: 600; color: var(--color-text-main); font-size: 1rem;">${p.name}</span>
            <span class="badge ${p.status === 'activo' ? 'badge-success' : p.status === 'en_proceso' ? 'badge-warning' : 'badge-neutral'}" style="text-transform: uppercase; font-size: 0.7rem; padding: 0.15rem 0.4rem;">
              ${p.status === 'activo' ? 'Activo' : p.status === 'en_proceso' ? 'En Proceso' : 'Próximo'}
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 1rem;" onclick="event.stopPropagation()">
            <!-- Selector de estado del periodo -->
            <select class="form-input" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; margin: 0; width: auto;" onchange="updatePeriodStatus('${p.id}', this.value)">
              <option value="activo" ${p.status === 'activo' ? 'selected' : ''}>Activo</option>
              <option value="en_proceso" ${p.status === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
              <option value="proximo" ${p.status === 'proximo' ? 'selected' : ''}>Próximo</option>
            </select>
            
            <button class="btn btn-outline btn-sm" onclick="exportPeriodToExcel('${p.id}', '${p.name}')" title="Exportar a Excel" style="padding: 0.25rem 0.5rem;">
              <i class="ri-file-excel-line" style="color: #16a34a; font-size: 1.1rem;"></i>
            </button>
            <button class="btn btn-outline btn-sm" onclick="openEditPeriodModal('${p.id}', '${p.name.replace(/'/g, "\\'")}', ${p.period_month || 'null'}, ${p.period_year || 'null'}, '${p.status}')" title="Editar Periodo" style="padding: 0.25rem 0.5rem;">
              <i class="ri-edit-line" style="font-size: 1.1rem;"></i>
            </button>
            <button class="btn btn-outline btn-sm" onclick="openAddCommerceModal('${p.id}')" title="Añadir Comercio" style="padding: 0.25rem 0.5rem;">
              <i class="ri-add-line" style="font-size: 1.1rem;"></i>
            </button>
            <button class="btn btn-outline btn-sm" onclick="deletePeriod('${p.id}', '${p.name}')" title="Eliminar Periodo" style="padding: 0.25rem 0.5rem; border-color: var(--color-danger); color: var(--color-danger);">
              <i class="ri-delete-bin-line" style="font-size: 1.1rem;"></i>
            </button>
          </div>
        </div>
        <div class="billing-period-body" id="period-body-${p.id}">
          <!-- Se carga dinámicamente -->
        </div>
      </div>
    `;
  });
  
  return `
    <div style="margin-bottom: 1.5rem;">
      <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 0.75rem; letter-spacing: 0.05em; display: flex; align-items: center; gap: 0.5rem;">
        <span style="display:inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${groupStatus === 'activo' ? 'var(--color-success)' : groupStatus === 'en_proceso' ? 'var(--color-warning)' : 'var(--color-sidebar-text)'}"></span>
        ${title}
      </h4>
      ${listHtml}
    </div>
  `;
}

window.handlePeriodHeaderClick = function(periodId) {
  const card = document.getElementById(`period-card-${periodId}`);
  if (card) {
    togglePeriodCollapse(periodId, card);
  }
};

window.togglePeriodCollapse = async function(periodId, cardElement) {
  cardElement.classList.toggle('active');
  const isExpanded = cardElement.classList.contains('active');
  const body = document.getElementById(`period-body-${periodId}`);
  
  if (isExpanded && body) {
    body.innerHTML = `
      <div class="text-center" style="padding: 2rem; color: var(--color-text-muted);">
        <i class="ri-loader-4-line spin" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
        Cargando registros de facturación...
      </div>
    `;
    await loadBillingRecords(periodId, body);
  }
};

async function loadBillingRecords(periodId, bodyElement) {
  try {
    // 1. Obtener registros de facturación
    const { data: records, error } = await supabase
      .from('billing_records')
      .select('*')
      .eq('period_id', periodId)
      .order('comercio', { ascending: true });
      
    if (error) throw error;
    
    // 2. Obtener estados de comercio ("Al día")
    const { data: statuses, error: statusErr } = await supabase
      .from('commerce_billing_status')
      .select('*');
      
    if (statusErr) console.warn('Error fetching commerce status:', statusErr);
    
    const statusMap = {};
    if (statuses) {
      statuses.forEach(s => {
        statusMap[s.comercio] = s.al_dia;
      });
    }
    
    if (!records || records.length === 0) {
      bodyElement.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
          No hay registros de facturación para este periodo.
          <div style="margin-top: 1rem;">
            <button class="btn btn-primary btn-sm" onclick="openAddCommerceModal('${periodId}')"><i class="ri-add-line"></i> Agregar Comercio</button>
          </div>
        </div>
      `;
      return;
    }
    
    let tableRows = '';
    records.forEach(r => {
      const total = (r.total_fulfillment || 0) + (r.enviame || 0);
      const alDia = statusMap[r.comercio] !== false; // Default true
      
      tableRows += `
        <tr id="row-${r.id}" class="billing-record-row" data-pago-fulf="${r.pago_fulfillment || ''}" data-fact-fulf="${r.factura_fulfillment || ''}" data-pago-env="${r.pago_enviame || ''}" data-fact-env="${r.factura_enviame || ''}">
          <td style="font-weight: 600; color: var(--color-text-main); vertical-align: middle;">
            ${r.comercio}
          </td>
          
          <!-- Fulfillment -->
          <td class="col-group-fulf" style="vertical-align: middle;">
            <input type="date" value="${r.fecha_limite || ''}" class="billing-input" onchange="saveField('${r.id}', 'fecha_limite', this.value)" style="width: 125px;">
          </td>
          <td class="col-group-fulf" style="vertical-align: middle;">
            <select class="billing-select ${getStatusClass(r.desglose_fulfillment)}" onchange="updateSelectField(this, '${r.id}', 'desglose_fulfillment')">
              <option value="Por Generar" ${r.desglose_fulfillment === 'Por Generar' ? 'selected' : ''}>Por Generar</option>
              <option value="Enviado" ${r.desglose_fulfillment === 'Enviado' ? 'selected' : ''}>Enviado</option>
              <option value="Aprobado" ${r.desglose_fulfillment === 'Aprobado' ? 'selected' : ''}>Aprobado</option>
              <option value="Creado" ${r.desglose_fulfillment === 'Creado' ? 'selected' : ''}>Creado</option>
              <option value="Sin movimientos" ${r.desglose_fulfillment === 'Sin movimientos' ? 'selected' : ''}>Sin movimientos</option>
            </select>
          </td>
          <td class="col-group-fulf" style="vertical-align: middle;">
            <input type="text" value="${formatCLP(r.total_fulfillment || 0)}" class="billing-input text-right" onfocus="if(this.value.includes('$')) this.value = this.value.replace(/[^\d-]/g, '')" onblur="saveMoneyField('${r.id}', 'total_fulfillment', this)" onkeydown="if(event.key==='Enter')this.blur()" style="width: 100px;">
          </td>
          <td class="col-group-fulf" style="vertical-align: middle;">
            <input type="text" value="${formatCLP(r.abono_fulfillment || 0)}" class="billing-input text-right" onfocus="if(this.value.includes('$')) this.value = this.value.replace(/[^\d-]/g, '')" onblur="saveMoneyField('${r.id}', 'abono_fulfillment', this)" onkeydown="if(event.key==='Enter')this.blur()" style="width: 100px;">
          </td>
          <td class="col-group-fulf" style="vertical-align: middle;">
            <select class="billing-select ${getStatusClass(r.pago_fulfillment)}" onchange="updateSelectField(this, '${r.id}', 'pago_fulfillment')">
              <option value="Por solicitar" ${r.pago_fulfillment === 'Por solicitar' ? 'selected' : ''}>Por solicitar</option>
              <option value="Recibido" ${r.pago_fulfillment === 'Recibido' ? 'selected' : ''}>Recibido</option>
              <option value="En espera" ${r.pago_fulfillment === 'En espera' ? 'selected' : ''}>En espera</option>
              <option value="Atrasado" ${r.pago_fulfillment === 'Atrasado' ? 'selected' : ''}>Atrasado</option>
              <option value="abono" ${r.pago_fulfillment === 'abono' ? 'selected' : ''}>Abono</option>
              <option value="aprobado" ${r.pago_fulfillment === 'aprobado' ? 'selected' : ''}>Aprobado</option>
              <option value="incobrable" ${r.pago_fulfillment === 'incobrable' ? 'selected' : ''}>Incobrable</option>
              <option value="Sin movimientos" ${r.pago_fulfillment === 'Sin movimientos' ? 'selected' : ''}>Sin movimientos</option>
            </select>
            ${r.pago_fulfillment === 'Recibido' ? `
              <div style="margin-top: 0.25rem;">
                <input type="date" value="${r.fecha_pago_recibido_fulfillment || ''}" class="billing-input" onchange="saveField('${r.id}', 'fecha_pago_recibido_fulfillment', this.value)" style="font-size: 0.75rem; padding: 0.15rem 0.25rem; text-align: center; border: 1px solid var(--color-border); width: 100%; box-sizing: border-box;" title="Fecha de Pago Recibido">
              </div>
            ` : ''}
          </td>
          <td class="col-group-fulf" style="vertical-align: middle;">
            <select class="billing-select ${getStatusClass(r.factura_fulfillment)}" onchange="updateSelectField(this, '${r.id}', 'factura_fulfillment')">
              <option value="Esperando" ${r.factura_fulfillment === 'Esperando' ? 'selected' : ''}>Esperando</option>
              <option value="No se factura" ${r.factura_fulfillment === 'No se factura' ? 'selected' : ''}>No se factura</option>
              <option value="Emitida" ${r.factura_fulfillment === 'Emitida' ? 'selected' : ''}>Emitida</option>
              <option value="Facturar" ${r.factura_fulfillment === 'Facturar' ? 'selected' : ''}>Facturar</option>
              <option value="Sin movimientos" ${r.factura_fulfillment === 'Sin movimientos' ? 'selected' : ''}>Sin movimientos</option>
            </select>
          </td>
          <td class="col-group-fulf col-group-divider" style="vertical-align: middle;">
            <input type="number" value="${r.num_factura || ''}" placeholder="-" class="billing-input" onblur="saveNumberField('${r.id}', 'num_factura', this.value, true)" onkeydown="if(event.key==='Enter')this.blur()" style="width: 70px;">
          </td>
          
          <!-- Envíame -->
          <td class="col-group-env" style="vertical-align: middle;">
            <input type="date" value="${r.fecha_limite_enviame || ''}" class="billing-input" onchange="saveField('${r.id}', 'fecha_limite_enviame', this.value)" style="width: 125px;">
          </td>
          <td class="col-group-env" style="vertical-align: middle;">
            <input type="text" value="${formatCLP(r.enviame || 0)}" class="billing-input text-right" onfocus="if(this.value.includes('$')) this.value = this.value.replace(/[^\d-]/g, '')" onblur="saveMoneyField('${r.id}', 'enviame', this)" onkeydown="if(event.key==='Enter')this.blur()" style="width: 100px;">
          </td>
          <td class="col-group-env" style="vertical-align: middle;">
            <input type="text" value="${formatCLP(r.abono_enviame || 0)}" class="billing-input text-right" onfocus="if(this.value.includes('$')) this.value = this.value.replace(/[^\d-]/g, '')" onblur="saveMoneyField('${r.id}', 'abono_enviame', this)" onkeydown="if(event.key==='Enter')this.blur()" style="width: 100px;">
          </td>
          <td class="col-group-env" style="vertical-align: middle;">
            <select class="billing-select ${getStatusClass(r.pago_enviame)}" onchange="updateSelectField(this, '${r.id}', 'pago_enviame')">
              <option value="Por solicitar" ${r.pago_enviame === 'Por solicitar' ? 'selected' : ''}>Por solicitar</option>
              <option value="Recibido" ${r.pago_enviame === 'Recibido' ? 'selected' : ''}>Recibido</option>
              <option value="En espera" ${r.pago_enviame === 'En espera' ? 'selected' : ''}>En espera</option>
              <option value="Atrasado" ${r.pago_enviame === 'Atrasado' ? 'selected' : ''}>Atrasado</option>
              <option value="abono" ${r.pago_enviame === 'abono' ? 'selected' : ''}>Abono</option>
              <option value="aprobado" ${r.pago_enviame === 'aprobado' ? 'selected' : ''}>Aprobado</option>
              <option value="incobrable" ${r.pago_enviame === 'incobrable' ? 'selected' : ''}>Incobrable</option>
              <option value="Sin movimientos" ${r.pago_enviame === 'Sin movimientos' ? 'selected' : ''}>Sin movimientos</option>
            </select>
            ${r.pago_enviame === 'Recibido' ? `
              <div style="margin-top: 0.25rem;">
                <input type="date" value="${r.fecha_pago_recibido_enviame || ''}" class="billing-input" onchange="saveField('${r.id}', 'fecha_pago_recibido_enviame', this.value)" style="font-size: 0.75rem; padding: 0.15rem 0.25rem; text-align: center; border: 1px solid var(--color-border); width: 100%; box-sizing: border-box;" title="Fecha de Pago Recibido">
              </div>
            ` : ''}
          </td>
          <td class="col-group-env" style="vertical-align: middle;">
            <select class="billing-select ${getStatusClass(r.factura_enviame)}" onchange="updateSelectField(this, '${r.id}', 'factura_enviame')">
              <option value="Esperando" ${r.factura_enviame === 'Esperando' ? 'selected' : ''}>Esperando</option>
              <option value="No se factura" ${r.factura_enviame === 'No se factura' ? 'selected' : ''}>No se factura</option>
              <option value="Emitida" ${r.factura_enviame === 'Emitida' ? 'selected' : ''}>Emitida</option>
              <option value="Facturar" ${r.factura_enviame === 'Facturar' ? 'selected' : ''}>Facturar</option>
              <option value="Sin movimientos" ${r.factura_enviame === 'Sin movimientos' ? 'selected' : ''}>Sin movimientos</option>
            </select>
          </td>
          <td class="col-group-env col-group-divider" style="vertical-align: middle;">
            <input type="number" value="${r.num_factura_enviame || ''}" placeholder="-" class="billing-input" onblur="saveNumberField('${r.id}', 'num_factura_enviame', this.value, true)" onkeydown="if(event.key==='Enter')this.blur()" style="width: 70px;">
          </td>
          
          <td id="total-${r.id}" class="col-group-divider" style="font-weight: 700; color: var(--color-text-main); vertical-align: middle; text-align: right;">
            ${formatCLP(total)}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            <button class="btn btn-outline btn-sm" onclick="deleteBillingRecord('${r.id}', '${r.comercio}', '${periodId}')" style="border-color: var(--color-danger); color: var(--color-danger); padding: 0.15rem 0.35rem;" title="Eliminar Fila">
              <i class="ri-delete-bin-line" style="font-size: 0.9rem;"></i>
            </button>
          </td>
        </tr>
      `;
    });
    
window.generateBillingMultiSelect = function(label, filterClass, periodId, options) {
  let html = `
    <div style="display: flex; align-items: center; gap: 0.35rem;">
      <label style="font-size: 0.75rem; color: var(--color-text-muted);">${label}</label>
      <div class="ms-container" style="position: relative; display: inline-block;">
        <div class="form-input ms-header" onclick="toggleBillingMultiSelect(this)" style="cursor: pointer; padding: 0.15rem 0.5rem; font-size: 0.75rem; margin: 0; min-width: 140px; display: flex; justify-content: space-between; align-items: center; user-select: none; background: var(--color-surface);">
          <span class="ms-label" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px;">Todos</span>
          <i class="ri-arrow-down-s-line"></i>
        </div>
        <div class="ms-dropdown" style="display: none; position: absolute; top: 100%; left: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); z-index: 100; max-height: 250px; overflow-y: auto; padding: 0.25rem 0; box-shadow: 0 4px 12px rgba(0,0,0,0.2); min-width: 100%; margin-top: 0.25rem;">
          <label style="display: flex; align-items: center; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.75rem; transition: background 0.2s;" onmouseover="this.style.background='var(--color-bg)'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" value="" class="${filterClass}-all" checked onchange="toggleBillingMultiSelectAll(this, '${filterClass}', '${periodId}')" style="margin-right: 0.5rem; width: 14px; height: 14px; accent-color: var(--color-primary);"> Todos
          </label>
  `;
  
  options.forEach(opt => {
    html += `
          <label style="display: flex; align-items: center; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.75rem; transition: background 0.2s;" onmouseover="this.style.background='var(--color-bg)'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" value="${opt}" class="${filterClass}" checked onchange="updateBillingMultiSelectLabel('${filterClass}', this.closest('.ms-container')); filterBillingRows('${periodId}')" style="margin-right: 0.5rem; width: 14px; height: 14px; accent-color: var(--color-primary);"> ${opt}
          </label>
    `;
  });
  
  html += `
        </div>
      </div>
    </div>
  `;
  return html;
};

    bodyElement.innerHTML = `
        <!-- Filtros rápidos -->
        <div class="billing-filters-bar" style="display: flex; gap: 1rem; align-items: center; padding: 0.75rem 1.25rem; background: var(--color-bg); border-bottom: 1px solid var(--color-border); flex-wrap: wrap;">
          <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);"><i class="ri-filter-3-line"></i> Filtros:</span>
          
          ${generateBillingMultiSelect('Pago Fulf:', 'filter-pago-fulf', periodId, ['Por solicitar', 'Recibido', 'En espera', 'Atrasado', 'abono', 'aprobado', 'incobrable', 'Sin movimientos'])}
          
          ${generateBillingMultiSelect('Factura Fulf:', 'filter-fact-fulf', periodId, ['Esperando', 'No se factura', 'Emitida', 'Facturar', 'Sin movimientos'])}
          
          ${generateBillingMultiSelect('Pago Env:', 'filter-pago-env', periodId, ['Por solicitar', 'Recibido', 'En espera', 'Atrasado', 'abono', 'aprobado', 'incobrable', 'Sin movimientos'])}
          
          ${generateBillingMultiSelect('Factura Env:', 'filter-fact-env', periodId, ['Esperando', 'No se factura', 'Emitida', 'Facturar', 'Sin movimientos'])}
        </div>

        <table class="data-table billing-table" style="min-width: 1600px; font-size: 0.825rem; border-collapse: collapse;">
          <thead>
            <tr>
              <th rowspan="2" style="min-width: 150px; vertical-align: middle; border-bottom: 2px solid var(--color-border);">Comercio</th>
              <th colspan="7" class="th-group-fulf col-group-divider" style="text-align: center; font-weight: 700;">Fulfillment</th>
              <th colspan="6" class="th-group-env col-group-divider" style="text-align: center; font-weight: 700;">Envíame</th>
              <th rowspan="2" class="col-group-divider" style="min-width: 120px; text-align: right; vertical-align: middle; border-bottom: 2px solid var(--color-border);">Total Mes</th>
              <th rowspan="2" style="width: 50px; text-align: center; vertical-align: middle; border-bottom: 2px solid var(--color-border);">Acción</th>
            </tr>
            <tr>
              <!-- Fulfillment fields -->
              <th class="col-group-fulf" style="min-width: 125px; border-bottom: 1px solid var(--color-border);">Límite</th>
              <th class="col-group-fulf" style="min-width: 120px; border-bottom: 1px solid var(--color-border);">Desglose</th>
              <th class="col-group-fulf" style="min-width: 100px; text-align: right; border-bottom: 1px solid var(--color-border);">Total Fulf</th>
              <th class="col-group-fulf" style="min-width: 100px; text-align: right; border-bottom: 1px solid var(--color-border);">Abono Fulf</th>
              <th class="col-group-fulf" style="min-width: 130px; border-bottom: 1px solid var(--color-border);">Pago Fulf</th>
              <th class="col-group-fulf" style="min-width: 130px; border-bottom: 1px solid var(--color-border);">Factura Fulf</th>
              <th class="col-group-fulf col-group-divider" style="min-width: 70px; border-bottom: 1px solid var(--color-border);">N°Fact</th>
              
              <!-- Envíame fields -->
              <th class="col-group-env" style="min-width: 125px; border-bottom: 1px solid var(--color-border);">Límite</th>
              <th class="col-group-env" style="min-width: 100px; text-align: right; border-bottom: 1px solid var(--color-border);">Total Env</th>
              <th class="col-group-env" style="min-width: 100px; text-align: right; border-bottom: 1px solid var(--color-border);">Abono Env</th>
              <th class="col-group-env" style="min-width: 130px; border-bottom: 1px solid var(--color-border);">Pago Env</th>
              <th class="col-group-env" style="min-width: 130px; border-bottom: 1px solid var(--color-border);">Factura Env</th>
              <th class="col-group-env col-group-divider" style="min-width: 70px; border-bottom: 1px solid var(--color-border);">N°Fact Env</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
          <tfoot id="tfoot-${periodId}" style="background: var(--color-surface); font-weight: 700; position: sticky; bottom: 0; box-shadow: 0 -2px 10px rgba(0,0,0,0.1); z-index: 10;">
            <!-- Generated dynamically -->
          </tfoot>
        </table>
    `;
    
    // Update the tfoot dynamically
    window.updateBillingFooterTotals(periodId);
    
  } catch (err) {
    console.error('Error rendering billing records:', err);
    bodyElement.innerHTML = `
      <div style="padding: 1rem; color: var(--color-danger);">
        Error al cargar registros: ${err.message}
      </div>
    `;
  }
}

window.toggleBillingMultiSelect = function(headerEl) {
  const dropdown = headerEl.nextElementSibling;
  const isVisible = dropdown.style.display === 'block';
  document.querySelectorAll('.ms-dropdown').forEach(d => d.style.display = 'none');
  if (!isVisible) dropdown.style.display = 'block';
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.ms-container')) {
    document.querySelectorAll('.ms-dropdown').forEach(d => d.style.display = 'none');
  }
});

window.toggleBillingMultiSelectAll = function(cbAll, filterClass, periodId) {
  const isChecked = cbAll.checked;
  const dropdown = cbAll.closest('.ms-dropdown');
  dropdown.querySelectorAll('.' + filterClass).forEach(cb => cb.checked = isChecked);
  updateBillingMultiSelectLabel(filterClass, dropdown.closest('.ms-container'));
  filterBillingRows(periodId);
};

window.updateBillingMultiSelectLabel = function(filterClass, container) {
  if (!container) return;
  const checkboxes = container.querySelectorAll('.' + filterClass);
  const cbAll = container.querySelector('.' + filterClass + '-all');
  const label = container.querySelector('.ms-label');
  
  const checked = Array.from(checkboxes).filter(cb => cb.checked);
  
  if (checked.length === checkboxes.length) {
    if (cbAll) cbAll.checked = true;
    label.textContent = 'Todos';
  } else if (checked.length === 0) {
    if (cbAll) cbAll.checked = false;
    label.textContent = 'Ninguno';
  } else if (checked.length === 1) {
    if (cbAll) cbAll.checked = false;
    label.textContent = checked[0].value;
  } else {
    if (cbAll) cbAll.checked = false;
    label.textContent = checked.length + ' selec.';
  }
};

window.updateBillingFooterTotals = function(periodId) {
  const container = document.getElementById(`period-body-${periodId}`);
  if (!container) return;
  
  const rows = container.querySelectorAll('.billing-record-row');
  let sumTotalFulf = 0;
  let sumAbonoFulf = 0;
  let sumTotalEnv = 0;
  let sumAbonoEnv = 0;
  let sumTotalMes = 0;
  
  rows.forEach(row => {
    if (row.style.display === 'none') return;
    
    const getVal = (nameContains) => {
      const input = row.querySelector(`input[onblur*="${nameContains}"]`);
      if (input) {
        const valStr = (input.value || '0').replace(/[^\d-]/g, '');
        return parseInt(valStr, 10) || 0;
      }
      return 0;
    };
    
    const tFulf = getVal('total_fulfillment');
    const aFulf = getVal('abono_fulfillment');
    const tEnv = getVal('enviame');
    const aEnv = getVal('abono_enviame');
    
    sumTotalFulf += tFulf;
    sumAbonoFulf += aFulf;
    sumTotalEnv += tEnv;
    sumAbonoEnv += aEnv;
    sumTotalMes += (tFulf + tEnv);
  });
  
  const tfoot = document.getElementById(`tfoot-${periodId}`);
  if (tfoot) {
    tfoot.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: right; padding: 1rem;">TOTALES (filtrados):</td>
        <td class="col-group-fulf" style="text-align: right; padding: 1rem;">${formatCLP(sumTotalFulf)}</td>
        <td class="col-group-fulf" style="text-align: right; padding: 1rem;">${formatCLP(sumAbonoFulf)}</td>
        <td colspan="4" class="col-group-divider"></td>
        <td class="col-group-env" style="text-align: right; padding: 1rem;">${formatCLP(sumTotalEnv)}</td>
        <td class="col-group-env" style="text-align: right; padding: 1rem;">${formatCLP(sumAbonoEnv)}</td>
        <td colspan="3" class="col-group-divider"></td>
        <td class="col-group-divider" style="text-align: right; padding: 1rem; color: var(--color-primary); font-size: 0.95rem;">${formatCLP(sumTotalMes)}</td>
        <td></td>
      </tr>
    `;
  }
};

window.filterBillingRows = function(periodId) {
  const container = document.getElementById(`period-body-${periodId}`);
  if (!container) return;
  
  const getSelected = (filterClass) => {
    const checkboxes = container.querySelectorAll('.' + filterClass + ':checked');
    if (checkboxes.length === 0) return null;
    const allCb = container.querySelector('.' + filterClass + '-all');
    if (allCb && allCb.checked) return null;
    return Array.from(checkboxes).map(cb => cb.value);
  };
  
  const filterPagoFulf = getSelected('filter-pago-fulf');
  const filterFactFulf = getSelected('filter-fact-fulf');
  const filterPagoEnv = getSelected('filter-pago-env');
  const filterFactEnv = getSelected('filter-fact-env');
  
  const rows = container.querySelectorAll('.billing-record-row');
  rows.forEach(row => {
    const pagoFulf = row.getAttribute('data-pago-fulf') || '';
    const factFulf = row.getAttribute('data-fact-fulf') || '';
    const pagoEnv = row.getAttribute('data-pago-env') || '';
    const factEnv = row.getAttribute('data-fact-env') || '';
    
    const matchPagoFulf = !filterPagoFulf || filterPagoFulf.includes(pagoFulf);
    const matchFactFulf = !filterFactFulf || filterFactFulf.includes(factFulf);
    const matchPagoEnv = !filterPagoEnv || filterPagoEnv.includes(pagoEnv);
    const matchFactEnv = !filterFactEnv || filterFactEnv.includes(factEnv);
    
    if (matchPagoFulf && matchFactFulf && matchPagoEnv && matchFactEnv) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
  
  window.updateBillingFooterTotals(periodId);
};

window.updateSelectField = function(selectEl, recordId, fieldName) {
  const val = selectEl.value;
  selectEl.className = 'billing-select ' + getStatusClass(val);
  
  const row = document.getElementById(`row-${recordId}`);
  if (row) {
    row.setAttribute(`data-${fieldName.replace('_', '-')}`, val);
    
    // Auto-fill abono locally if status is marked Recibido
    if (val === 'Recibido') {
      const today = new Date().toLocaleDateString('sv-SE');
      if (fieldName === 'pago_fulfillment') {
        const totalInput = row.querySelector('input[onblur*="total_fulfillment"]');
        const abonoInput = row.querySelector('input[onblur*="abono_fulfillment"]');
        if (totalInput && abonoInput) {
          abonoInput.value = totalInput.value;
        }
        saveField(recordId, 'fecha_pago_recibido_fulfillment', today);
        
        // Dynamic DOM injection of the datepicker
        let dateContainer = selectEl.parentNode.querySelector('div');
        if (!dateContainer) {
          const div = document.createElement('div');
          div.style.marginTop = '0.25rem';
          div.innerHTML = `<input type="date" value="${today}" class="billing-input" onchange="saveField('${recordId}', 'fecha_pago_recibido_fulfillment', this.value)" style="font-size: 0.75rem; padding: 0.15rem 0.25rem; text-align: center; border: 1px solid var(--color-border); width: 100%; box-sizing: border-box;" title="Fecha de Pago Recibido">`;
          selectEl.parentNode.appendChild(div);
        }
      } else if (fieldName === 'pago_enviame') {
        const totalInput = row.querySelector('input[onblur*="enviame"]');
        const abonoInput = row.querySelector('input[onblur*="abono_enviame"]');
        if (totalInput && abonoInput) {
          abonoInput.value = totalInput.value;
        }
        saveField(recordId, 'fecha_pago_recibido_enviame', today);
        
        // Dynamic DOM injection of the datepicker
        let dateContainer = selectEl.parentNode.querySelector('div');
        if (!dateContainer) {
          const div = document.createElement('div');
          div.style.marginTop = '0.25rem';
          div.innerHTML = `<input type="date" value="${today}" class="billing-input" onchange="saveField('${recordId}', 'fecha_pago_recibido_enviame', this.value)" style="font-size: 0.75rem; padding: 0.15rem 0.25rem; text-align: center; border: 1px solid var(--color-border); width: 100%; box-sizing: border-box;" title="Fecha de Pago Recibido">`;
          selectEl.parentNode.appendChild(div);
        }
      }
    } else {
      // Remove dynamic datepicker if status changed from Recibido
      let dateContainer = selectEl.parentNode.querySelector('div');
      if (dateContainer) {
        dateContainer.remove();
      }
      if (fieldName === 'pago_fulfillment') {
        saveField(recordId, 'fecha_pago_recibido_fulfillment', null);
      } else if (fieldName === 'pago_enviame') {
        saveField(recordId, 'fecha_pago_recibido_enviame', null);
      }
    }
  }
  
  saveField(recordId, fieldName, val);
};

window.saveMoneyField = function(recordId, fieldName, inputEl) {
  let valueStr = inputEl.value || '0';
  valueStr = valueStr.replace(/[^\d-]/g, '');
  const val = parseInt(valueStr, 10);
  const numericVal = isNaN(val) ? 0 : val;
  
  inputEl.value = formatCLP(numericVal);
  saveField(recordId, fieldName, numericVal);
};

window.saveNumberField = function(recordId, fieldName, valueStr, isNullable = false) {
  if (valueStr === '' || valueStr === null || valueStr === undefined) {
    if (isNullable) {
      saveField(recordId, fieldName, null);
    } else {
      saveField(recordId, fieldName, 0);
    }
    return;
  }
  const val = parseInt(valueStr, 10);
  saveField(recordId, fieldName, isNaN(val) ? 0 : val);
};

window.saveField = async function(recordId, fieldName, fieldValue) {
  showSavingBadge(true);
  try {
    const { error } = await supabase
      .from('billing_records')
      .update({ [fieldName]: fieldValue })
      .eq('id', recordId);
      
    if (error) throw error;
    
    // Si cambió total_fulfillment o enviame, recalcular el TOTAL local de la fila
    if (fieldName === 'total_fulfillment' || fieldName === 'enviame') {
      const row = document.getElementById(`row-${recordId}`);
      if (row) {
        const totalFulfInput = row.querySelector(`input[onblur*="total_fulfillment"]`);
        const enviameInput = row.querySelector(`input[onblur*="enviame"]`);
        const totalCell = document.getElementById(`total-${recordId}`);
        
        if (totalFulfInput && enviameInput && totalCell) {
          const tf = parseInt(totalFulfInput.value.replace(/[^\d-]/g, ''), 10) || 0;
          const env = parseInt(enviameInput.value.replace(/[^\d-]/g, ''), 10) || 0;
          totalCell.textContent = formatCLP(tf + env);
        }
      }
    }
    
    if (['total_fulfillment', 'enviame', 'abono_fulfillment', 'abono_enviame'].includes(fieldName)) {
      const row = document.getElementById(`row-${recordId}`);
      if (row) {
        const container = row.closest('div[id^="period-body-"]');
        if (container) {
          const pId = container.id.replace('period-body-', '');
          if (window.updateBillingFooterTotals) {
            window.updateBillingFooterTotals(pId);
          }
        }
      }
    }
    
    setTimeout(() => showSavingBadge(false), 500);
  } catch (err) {
    console.error('Error saving billing record field:', err);
    alert('Error al guardar datos de facturación: ' + err.message);
    showSavingBadge(false);
  }
};

function showSavingBadge(show) {
  const badge = document.getElementById('saving-badge');
  if (badge) {
    if (show) {
      badge.classList.add('show');
      badge.innerHTML = '<i class="ri-loader-4-line spin"></i> Guardando...';
      badge.style.color = 'var(--color-warning)';
    } else {
      badge.innerHTML = '<i class="ri-checkbox-circle-line"></i> Guardado';
      badge.style.color = 'var(--color-success)';
      setTimeout(() => {
        if (badge.innerHTML.includes('Guardado')) {
          badge.classList.remove('show');
        }
      }, 1500);
    }
  }
}

window.openCreatePeriodModal = function() {
  let modal = document.getElementById('modal-create-billing-period');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'modal-create-billing-period';
  modal.className = 'modal-overlay';
  
  const currentYear = new Date().getFullYear();
  const currentMonthIndex = new Date().getMonth() + 1; // 1-12
  
  const months = [
    { val: 1, text: 'ENERO' },
    { val: 2, text: 'FEBRERO' },
    { val: 3, text: 'MARZO' },
    { val: 4, text: 'ABRIL' },
    { val: 5, text: 'MAYO' },
    { val: 6, text: 'JUNIO' },
    { val: 7, text: 'JULIO' },
    { val: 8, text: 'AGOSTO' },
    { val: 9, text: 'SEPTIEMBRE' },
    { val: 10, text: 'OCTUBRE' },
    { val: 11, text: 'NOVIEMBRE' },
    { val: 12, text: 'DICIEMBRE' }
  ];
  
  let monthOptions = months.map(m => `<option value="${m.val}" ${m.val === currentMonthIndex ? 'selected' : ''}>${m.text}</option>`).join('');
  const initialName = `${months[currentMonthIndex - 1].text} ${currentYear}`;
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 450px;">
      <div class="modal-header">
        <h3><i class="ri-bill-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i> Crear Nuevo Periodo</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <form id="form-create-billing-period">
        <div class="modal-body" style="padding: 1.25rem;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div class="form-group" style="margin: 0;">
              <label class="form-label">Mes del Periodo</label>
              <select id="period-month-input" class="form-input" required>
                ${monthOptions}
              </select>
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label">Año del Periodo</label>
              <input type="number" id="period-year-input" class="form-input" value="${currentYear}" required>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Nombre del Periodo</label>
            <input type="text" id="period-name-input" class="form-input" value="${initialName}" required>
            <small style="color: var(--color-text-muted); display: block; margin-top: 0.25rem;">Se auto-genera al cambiar el mes/año, pero puedes editarlo libremente.</small>
          </div>
          <div class="form-group">
            <label class="form-label">Estado Inicial</label>
            <select id="period-status-input" class="form-input" required>
              <option value="proximo" selected>Próximo</option>
              <option value="activo">Activo</option>
              <option value="en_proceso">En Proceso</option>
            </select>
          </div>
          <div style="background-color: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 0.85rem; color: var(--color-text-muted);">
            <i class="ri-information-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>
            Al crear el periodo, se auto-generarán registros vacíos para todos los comercios configurados en el WMS de forma automática.
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-create-period"><i class="ri-save-line"></i> Crear Periodo</button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('active'), 10);
  
  const monthSelect = document.getElementById('period-month-input');
  const yearInput = document.getElementById('period-year-input');
  const nameInput = document.getElementById('period-name-input');
  
  const updateName = () => {
    const monthText = monthSelect.options[monthSelect.selectedIndex].text;
    const yearVal = yearInput.value.trim();
    if (yearVal) {
      nameInput.value = `${monthText} ${yearVal}`;
    }
  };
  
  monthSelect.addEventListener('change', updateName);
  yearInput.addEventListener('input', updateName);
  
  document.getElementById('form-create-billing-period').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-create-period');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Creando...';
    
    const name = nameInput.value.trim();
    const month = parseInt(monthSelect.value, 10);
    const year = parseInt(yearInput.value, 10);
    const status = document.getElementById('period-status-input').value;
    
    try {
      // 1. Crear el periodo en billing_periods
      const { data: period, error: periodErr } = await supabase
        .from('billing_periods')
        .insert({ name, status, period_month: month, period_year: year })
        .select()
        .single();
        
      if (periodErr) throw periodErr;
      
      // 2. Obtener todos los comercios desde v_comercios_config
      const { data: comercios, error: comerciosErr } = await supabase
        .from('v_comercios_config')
        .select('nombre');
        
      if (comerciosErr) throw comerciosErr;
      
      // 3. Obtener mapeos de facturación agrupados
      let mappings = [];
      try {
        const { data: mappingsData } = await supabase
          .from('billing_mappings')
          .select('comercio_nombre, billing_name');
        if (mappingsData) mappings = mappingsData;
      } catch (err) {
        console.warn('Advertencia al cargar mappings en creación de periodo:', err);
      }
      
      if (comercios && comercios.length > 0) {
        // Resolver nombres de facturación y filtrar duplicados usando un Set
        const uniqueBillingNames = new Set();
        comercios.forEach(c => {
          const matchedMapping = mappings.find(m => m.comercio_nombre.toLowerCase() === c.nombre.toLowerCase());
          const nameToUse = matchedMapping ? matchedMapping.billing_name : c.nombre;
          uniqueBillingNames.add(nameToUse);
        });
        
        // Crear registros de facturación por defecto para los nombres únicos
        const defaultRecords = Array.from(uniqueBillingNames).map(name => ({
          period_id: period.id,
          comercio: name,
          total_fulfillment: 0,
          abono_fulfillment: 0,
          enviame: 0,
          abono_enviame: 0,
          desglose_fulfillment: 'Por Generar',
          pago_fulfillment: 'Por solicitar',
          factura_fulfillment: 'Esperando',
          pago_enviame: 'Por solicitar',
          factura_enviame: 'Esperando'
        }));
        
        const { error: recordsErr } = await supabase
          .from('billing_records')
          .insert(defaultRecords);
          
        if (recordsErr) throw recordsErr;
      }
      
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 300);
      alert('Periodo mensual creado exitosamente con sus comercios.');
      await loadBillingPeriods();
      
    } catch (err) {
      console.error('Error creating billing period:', err);
      alert('Error al crear periodo de facturación: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-save-line"></i> Crear Periodo';
    }
  });
};

window.openAddCommerceModal = async function(periodId) {
  let modal = document.getElementById('modal-add-commerce-billing');
  if (modal) modal.remove();
  
  let comercios = [];
  try {
    const { data, error } = await supabase.from('v_comercios_config').select('nombre, sigla');
    if (error) throw error;
    comercios = data || [];
  } catch (err) {
    console.error('Error fetching comercios:', err);
    alert('Error al cargar comercios disponibles: ' + err.message);
    return;
  }
  
  const optionsHtml = comercios.map(c => `<option value="${c.nombre}">${c.nombre} (${c.sigla})</option>`).join('');
  
  modal = document.createElement('div');
  modal.id = 'modal-add-commerce-billing';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h3><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i> Añadir Comercio</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <form id="form-add-commerce-billing">
        <div class="modal-body" style="padding: 1.25rem;">
          <div class="form-group">
            <label class="form-label">Seleccionar Comercio</label>
            <select id="add-commerce-select" class="form-input" required>
              <option value="">-- Seleccionar --</option>
              ${optionsHtml}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-add-commerce-row"><i class="ri-check-line"></i> Agregar</button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('active'), 10);
  
  document.getElementById('form-add-commerce-billing').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-add-commerce-row');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Agregando...';
    
    const comercio = document.getElementById('add-commerce-select').value;
    if (!comercio) return;
    
    try {
      // Resolver mappings
      let nameToUse = comercio;
      try {
        const { data: mapping } = await supabase
          .from('billing_mappings')
          .select('billing_name')
          .eq('comercio_nombre', comercio)
          .maybeSingle();
        if (mapping) nameToUse = mapping.billing_name;
      } catch (err) {
        console.warn('Error resolving billing mapping:', err);
      }
      
      const { error } = await supabase
        .from('billing_records')
        .insert({
          period_id: periodId,
          comercio: nameToUse,
          total_fulfillment: 0,
          abono_fulfillment: 0,
          enviame: 0,
          abono_enviame: 0,
          desglose_fulfillment: 'Por Generar',
          pago_fulfillment: 'Por solicitar',
          factura_fulfillment: 'Esperando',
          pago_enviame: 'Por solicitar',
          factura_enviame: 'Esperando'
        });
        
      if (error) {
        if (error.code === '23505') {
          throw new Error('Este comercio ya tiene un registro en este periodo.');
        }
        throw error;
      }
      
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 300);
      
      const body = document.getElementById(`period-body-${periodId}`);
      if (body) {
        await loadBillingRecords(periodId, body);
      }
    } catch (err) {
      console.error('Error adding commerce to period:', err);
      alert(err.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-check-line"></i> Agregar';
    }
  });
};

window.updatePeriodStatus = async function(periodId, newStatus) {
  try {
    const { error } = await supabase
      .from('billing_periods')
      .update({ status: newStatus })
      .eq('id', periodId);
      
    if (error) throw error;
    
    alert('Estado del periodo actualizado.');
    await loadBillingPeriods();
  } catch (err) {
    console.error('Error updating period status:', err);
    alert('Error al actualizar estado del periodo: ' + err.message);
  }
};

window.deletePeriod = async function(periodId, periodName) {
  if (!confirm(`¿Estás completamente seguro de eliminar el periodo "${periodName}"? Esto eliminará de forma permanente todos los registros de facturación de este mes.`)) return;
  
  try {
    const { error } = await supabase
      .from('billing_periods')
      .delete()
      .eq('id', periodId);
      
    if (error) throw error;
    
    alert('Periodo eliminado exitosamente.');
    await loadBillingPeriods();
  } catch (err) {
    console.error('Error deleting period:', err);
    alert('Error al eliminar periodo: ' + err.message);
  }
};

window.deleteBillingRecord = async function(recordId, commerceName, periodId) {
  if (!confirm(`¿Eliminar la fila de facturación del comercio "${commerceName}"?`)) return;
  
  try {
    const { error } = await supabase
      .from('billing_records')
      .delete()
      .eq('id', recordId);
      
    if (error) throw error;
    
    const body = document.getElementById(`period-body-${periodId}`);
    if (body) {
      await loadBillingRecords(periodId, body);
    }
  } catch (err) {
    console.error('Error deleting record:', err);
    alert('Error al eliminar registro: ' + err.message);
  }
};

window.exportPeriodToExcel = async function(periodId, periodName) {
  try {
    const { data: records, error } = await supabase
      .from('billing_records')
      .select('*')
      .eq('period_id', periodId)
      .order('comercio', { ascending: true });
      
    if (error) throw error;
    
    if (!records || records.length === 0) {
      alert('No hay registros para exportar en este periodo.');
      return;
    }
    
    const rows = records.map(r => ({
      'Comercio': r.comercio,
      'Fecha Límite Fulf.': r.fecha_limite || '-',
      'Desglose Fulf.': r.desglose_fulfillment || '-',
      'Total Fulf.': r.total_fulfillment || 0,
      'Abonos Fulf.': r.abono_fulfillment || 0,
      'Pago Fulf.': r.pago_fulfillment || '-',
      'Factura Fulf.': r.factura_fulfillment || '-',
      'N° Factura Fulf.': r.num_factura || '-',
      'Fecha Límite Env.': r.fecha_limite_enviame || '-',
      'Enviame': r.enviame || 0,
      'Abono Env.': r.abono_enviame || 0,
      'Pago Env.': r.pago_enviame || '-',
      'Fact. Env.': r.factura_enviame || '-',
      'N° Factura Env.': r.num_factura_enviame || '-',
      'Total General': (r.total_fulfillment || 0) + (r.enviame || 0)
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    
    XLSX.utils.book_append_sheet(wb, ws, 'Facturacion');
    
    const filename = `Facturacion_${periodName.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(wb, filename);
    
  } catch (err) {
    console.error('Error exporting to Excel:', err);
    alert('Error al exportar a Excel: ' + err.message);
  }
};

async function loadPendingPaymentReports() {
  const container = document.getElementById('reports-list-container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
      <i class="ri-loader-4-line spin" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
      Cargando avisos de pago pendientes...
    </div>
  `;
  
  try {
    const { data: reports, error } = await supabase
      .from('payment_reports')
      .select('*, billing_periods(name)')
      .eq('status', 'pendiente')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    // Update badge count
    const badge = document.getElementById('pending-reports-badge');
    if (badge) {
      if (reports.length > 0) {
        badge.textContent = reports.length;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
    
    if (!reports || reports.length === 0) {
      container.innerHTML = `
        <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
          <i class="ri-checkbox-circle-line" style="font-size: 3rem; display: block; margin-bottom: 1rem; color: var(--color-success);"></i>
          No hay avisos de pago pendientes de revisión.
        </div>
      `;
      return;
    }
    
    let rows = '';
    reports.forEach(rep => {
      const periodName = rep.billing_periods?.name || 'Desconocido';
      rows += `
        <tr>
          <td style="font-weight: 600; color: var(--color-text-main);">${rep.comercio}</td>
          <td>${periodName}</td>
          <td>${new Date(rep.fecha_pago + 'T00:00:00').toLocaleDateString()}</td>
          <td style="font-weight: 600;">$${rep.monto.toLocaleString('es-CL')}</td>
          <td style="text-transform: capitalize;">${rep.servicio}</td>
          <td>
            ${rep.comprobante_url ? `
              <a href="${rep.comprobante_url}" target="_blank" class="btn btn-outline btn-sm" style="padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                <i class="ri-file-text-line"></i> Ver Comprobante
              </a>
            ` : '-'}
          </td>
          <td>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-primary btn-sm" onclick="approvePaymentReport('${rep.id}', '${rep.period_id}', '${rep.comercio}', '${rep.servicio}', ${rep.monto})" style="padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                <i class="ri-check-line"></i> Aprobar
              </button>
              <button class="btn btn-outline btn-sm" onclick="rejectPaymentReport('${rep.id}', '${rep.comercio}', ${rep.monto}, '${rep.servicio}')" style="border-color: var(--color-danger); color: var(--color-danger); padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                <i class="ri-close-line"></i> Rechazar
              </button>
            </div>
          </td>
        </tr>
      `;
    });
    
    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Comercio</th>
            <th>Periodo</th>
            <th>Fecha Pago</th>
            <th>Monto</th>
            <th>Servicio</th>
            <th>Comprobante</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error loading pending payment reports:', err);
    container.innerHTML = `
      <div style="padding: 2rem; color: var(--color-danger); text-align: center;">
        Error al cargar avisos de pago: ${err.message}
      </div>
    `;
  }
}

window.approvePaymentReport = async function(reportId, periodId, commerce, servicio, monto) {
  if (!confirm(`¿Aprobar el pago de $${monto.toLocaleString('es-CL')} de ${commerce} para ${servicio}?`)) return;
  showSavingBadge(true);
  try {
    // Obtener la fecha de pago informada por el cliente
    const { data: report, error: repGetErr } = await supabase
      .from('payment_reports')
      .select('fecha_pago')
      .eq('id', reportId)
      .single();
      
    if (repGetErr) throw repGetErr;
    const paymentDate = report ? report.fecha_pago : new Date().toLocaleDateString('sv-SE');

    const { data: record, error: getErr } = await supabase
      .from('billing_records')
      .select('id, total_fulfillment, enviame')
      .eq('period_id', periodId)
      .eq('comercio', commerce)
      .single();
      
    if (getErr) throw getErr;
    
    const updates = {};
    if (servicio === 'fulfillment' || servicio === 'ambos') {
      updates.pago_fulfillment = 'Recibido';
      updates.abono_fulfillment = record.total_fulfillment;
      updates.fecha_pago_recibido_fulfillment = paymentDate;
    }
    if (servicio === 'enviame' || servicio === 'ambos') {
      updates.pago_enviame = 'Recibido';
      updates.abono_enviame = record.enviame;
      updates.fecha_pago_recibido_enviame = paymentDate;
    }
    
    const { error: updErr } = await supabase
      .from('billing_records')
      .update(updates)
      .eq('id', record.id);
      
    if (updErr) throw updErr;
    
    const { error: repErr } = await supabase
      .from('payment_reports')
      .update({ status: 'aprobado' })
      .eq('id', reportId);
      
    if (repErr) throw repErr;
    
    const { data: users } = await supabase.from('profiles').select('id, comercio');
    const targetUsers = users?.filter(u => {
      const list = u.comercio ? u.comercio.split(',').map(x => x.trim()) : [];
      return list.includes(commerce) || u.comercio === 'all';
    }) || [];
    
    for (const u of targetUsers) {
      await supabase.from('dashboard_notifications').insert({
        user_id: u.id,
        target_role: 'client',
        title: `Reporte de pago aprobado - ${commerce}`,
        message: `El reporte de pago por $${monto.toLocaleString('es-CL')} para el servicio ${servicio} ha sido aprobado exitosamente.`,
        is_read: false
      });
    }
    
    alert('Reporte de pago aprobado y registro de facturación actualizado.');
    await loadPendingPaymentReports();
    showSavingBadge(false);
  } catch (err) {
    console.error('Error approving payment report:', err);
    alert('Error al aprobar el pago: ' + err.message);
    showSavingBadge(false);
  }
};

window.rejectPaymentReport = async function(reportId, commerce, monto, servicio) {
  const reason = prompt(`Introduce el motivo de rechazo del pago de $${monto.toLocaleString('es-CL')} de ${commerce}:`);
  if (reason === null) return;
  if (!reason.trim()) {
    alert('Debes indicar un motivo de rechazo.');
    return;
  }
  
  showSavingBadge(true);
  try {
    const { error: repErr } = await supabase
      .from('payment_reports')
      .update({ status: 'rechazado', motivo_rechazo: reason })
      .eq('id', reportId);
      
    if (repErr) throw repErr;
    
    const { data: users } = await supabase.from('profiles').select('id, comercio');
    const targetUsers = users?.filter(u => {
      const list = u.comercio ? u.comercio.split(',').map(x => x.trim()) : [];
      return list.includes(commerce) || u.comercio === 'all';
    }) || [];
    
    for (const u of targetUsers) {
      await supabase.from('dashboard_notifications').insert({
        user_id: u.id,
        target_role: 'client',
        title: `Reporte de pago rechazado - ${commerce}`,
        message: `El reporte de pago por $${monto.toLocaleString('es-CL')} para el servicio ${servicio} fue rechazado. Motivo: ${reason}`,
        is_read: false
      });
    }
    
    alert('Reporte de pago rechazado y notificado al cliente.');
    await loadPendingPaymentReports();
    showSavingBadge(false);
  } catch (err) {
    console.error('Error rejecting payment report:', err);
    alert('Error al rechazar el pago: ' + err.message);
    showSavingBadge(false);
  }
};

window.openEditPeriodModal = function(periodId, currentName, currentMonth, currentYear, currentStatus) {
  let modal = document.getElementById('modal-edit-billing-period');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'modal-edit-billing-period';
  modal.className = 'modal-overlay';
  
  const months = [
    { val: 1, text: 'ENERO' },
    { val: 2, text: 'FEBRERO' },
    { val: 3, text: 'MARZO' },
    { val: 4, text: 'ABRIL' },
    { val: 5, text: 'MAYO' },
    { val: 6, text: 'JUNIO' },
    { val: 7, text: 'JULIO' },
    { val: 8, text: 'AGOSTO' },
    { val: 9, text: 'SEPTIEMBRE' },
    { val: 10, text: 'OCTUBRE' },
    { val: 11, text: 'NOVIEMBRE' },
    { val: 12, text: 'DICIEMBRE' }
  ];
  
  // Si currentMonth es nulo, intentar deducirlo
  let selectedMonth = currentMonth;
  let selectedYear = currentYear;
  if (!selectedMonth || !selectedYear) {
    const parts = currentName.split(' ');
    selectedYear = parts[1] ? parseInt(parts[1], 10) : new Date().getFullYear();
    const mText = parts[0] ? parts[0].toUpperCase() : '';
    const mMatch = months.find(m => m.text === mText);
    selectedMonth = mMatch ? mMatch.val : 1;
  }
  
  let monthOptions = months.map(m => `<option value="${m.val}" ${m.val === selectedMonth ? 'selected' : ''}>${m.text}</option>`).join('');
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 450px;">
      <div class="modal-header">
        <h3><i class="ri-edit-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i> Editar Periodo</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <form id="form-edit-billing-period">
        <div class="modal-body" style="padding: 1.25rem;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div class="form-group" style="margin: 0;">
              <label class="form-label">Mes del Periodo</label>
              <select id="edit-period-month-input" class="form-input" required>
                ${monthOptions}
              </select>
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label">Año del Periodo</label>
              <input type="number" id="edit-period-year-input" class="form-input" value="${selectedYear}" required>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Nombre del Periodo</label>
            <input type="text" id="edit-period-name-input" class="form-input" value="${currentName}" required>
            <small style="color: var(--color-text-muted); display: block; margin-top: 0.25rem;">Se auto-genera al cambiar el mes/año, pero puedes editarlo libremente.</small>
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select id="edit-period-status-input" class="form-input" required>
              <option value="proximo" ${currentStatus === 'proximo' ? 'selected' : ''}>Próximo</option>
              <option value="activo" ${currentStatus === 'activo' ? 'selected' : ''}>Activo</option>
              <option value="en_proceso" ${currentStatus === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-edit-period"><i class="ri-save-line"></i> Guardar Cambios</button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('active'), 10);
  
  const monthSelect = document.getElementById('edit-period-month-input');
  const yearInput = document.getElementById('edit-period-year-input');
  const nameInput = document.getElementById('edit-period-name-input');
  
  const updateName = () => {
    const monthText = monthSelect.options[monthSelect.selectedIndex].text;
    const yearVal = yearInput.value.trim();
    if (yearVal) {
      nameInput.value = `${monthText} ${yearVal}`;
    }
  };
  
  monthSelect.addEventListener('change', updateName);
  yearInput.addEventListener('input', updateName);
  
  document.getElementById('form-edit-billing-period').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-edit-period');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Guardando...';
    
    const name = nameInput.value.trim();
    const month = parseInt(monthSelect.value, 10);
    const year = parseInt(yearInput.value, 10);
    const status = document.getElementById('edit-period-status-input').value;
    
    try {
      const { error } = await supabase
        .from('billing_periods')
        .update({ name, period_month: month, period_year: year, status })
        .eq('id', periodId);
        
      if (error) throw error;
      
      alert('Periodo actualizado exitosamente.');
      modal.remove();
      await loadBillingPeriods();
    } catch (err) {
      console.error('Error updating period:', err);
      alert('Error al actualizar periodo: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-save-line"></i> Guardar Cambios';
    }
  });
};

let cachedDashboardRecords = [];
let cachedDashboardPeriods = [];
let cachedDashboardCommerceStatus = [];

async function loadBillingMetricsDashboard() {
  const container = document.getElementById('metrics-dashboard-container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
      <i class="ri-loader-4-line spin" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
      Calculando métricas y analizando datos de facturación...
    </div>
  `;
  
  try {
    const { data: records, error: recError } = await supabase
      .from('billing_records')
      .select('*, billing_periods(name, status, period_month, period_year)');
      
    if (recError) throw recError;
    
    const { data: periods, error: perError } = await supabase
      .from('billing_periods')
      .select('*')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });
      
    if (perError) throw perError;

    const { data: commerceStatus, error: csError } = await supabase
      .from('commerce_billing_status')
      .select('*');
      
    if (csError) throw csError;
    
    cachedDashboardRecords = records || [];
    cachedDashboardPeriods = periods || [];
    cachedDashboardCommerceStatus = commerceStatus || [];
    
    if (cachedDashboardRecords.length === 0) {
      container.innerHTML = `
        <div class="card" style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
          <i class="ri-bar-chart-2-line" style="font-size: 3rem; display: block; margin-bottom: 1rem; color: var(--color-border);"></i>
          <p style="font-weight: 500; font-size: 1rem; margin-bottom: 0.5rem;">No hay registros de facturación creados</p>
          <p style="font-size: 0.85rem;">Para visualizar las métricas del dashboard, primero crea un periodo mensual y agrega cobros.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <div class="dashboard-subtabs">
        <button class="dashboard-subtab-btn active" id="d-subtab-period" onclick="switchDashboardSubTab('period')"><i class="ri-calendar-line"></i> Vista por Periodo</button>
        <button class="dashboard-subtab-btn" id="d-subtab-commerce" onclick="switchDashboardSubTab('commerce')"><i class="ri-store-2-line"></i> Vista por Comercio</button>
        <button class="dashboard-subtab-btn" id="d-subtab-pending" onclick="switchDashboardSubTab('pending')"><i class="ri-checkbox-circle-line"></i> Tareas y Pendientes</button>
      </div>
      
      <div id="d-content-period"></div>
      <div id="d-content-commerce" style="display: none;"></div>
      <div id="d-content-pending" style="display: none;"></div>

      <!-- Dashboard Detail Modal -->
      <div id="dashboard-detail-modal" class="d-modal-overlay" onclick="closeDashboardModal()">
        <div class="d-modal-container" onclick="event.stopPropagation()">
          <div class="d-modal-header">
            <h3 id="d-modal-title">Detalles de Métrica</h3>
            <button class="d-modal-close" onclick="closeDashboardModal()">&times;</button>
          </div>
          <div class="d-modal-body" id="d-modal-body-content"></div>
        </div>
      </div>
    `;
    
    switchDashboardSubTab('period');
    
  } catch (err) {
    console.error('Error loading billing dashboard:', err);
    container.innerHTML = `
      <div class="card" style="padding: 2rem; border-color: var(--color-danger); color: var(--color-danger);">
        <p><strong>Error al generar métricas:</strong> ${err.message}</p>
      </div>
    `;
  }
}

window.switchDashboardSubTab = function(tabName) {
  const tabs = ['period', 'commerce', 'pending'];
  tabs.forEach(t => {
    const btn = document.getElementById(`d-subtab-${t}`);
    const content = document.getElementById(`d-content-${t}`);
    if (btn && content) {
      if (t === tabName) {
        btn.classList.add('active');
        content.style.display = 'block';
      } else {
        btn.classList.remove('active');
        content.style.display = 'none';
      }
    }
  });
  
  if (tabName === 'period') {
    renderDashboardPeriodView();
  } else if (tabName === 'commerce') {
    renderDashboardCommerceView();
  } else if (tabName === 'pending') {
    renderDashboardPendingView();
  }
};

function renderDashboardPeriodView() {
  const content = document.getElementById('d-content-period');
  if (!content) return;
  
  let options = '';
  let selectedPeriodId = '';
  const activePeriod = cachedDashboardPeriods.find(p => p.status === 'activo');
  if (activePeriod) {
    selectedPeriodId = activePeriod.id;
  } else if (cachedDashboardPeriods.length > 0) {
    selectedPeriodId = cachedDashboardPeriods[0].id;
  }
  
  cachedDashboardPeriods.forEach(p => {
    options += `<option value="${p.id}" ${p.id === selectedPeriodId ? 'selected' : ''}>${p.name} (${p.status.toUpperCase()})</option>`;
  });
  
  content.innerHTML = `
    <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.25rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <label style="font-weight: 600; font-size: 0.9rem; color: var(--color-text-main);">Seleccionar Periodo:</label>
        <select id="d-period-select" class="form-input" style="width: 250px; margin: 0; padding: 0.35rem 0.75rem;" onchange="updateDashboardPeriodView()">
          ${options}
        </select>
      </div>
      <div id="d-period-status-badge"></div>
    </div>
    
    <div id="d-period-metrics-cards" class="dashboard-grid"></div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
      <div class="card" style="margin: 0;">
        <div class="card-header">
          <h3><i class="ri-history-line"></i> Resumen de Recaudación del Periodo</h3>
        </div>
        <div class="card-body" id="d-period-recaudacion-summary" style="padding: 1.25rem;"></div>
      </div>
      <div class="card" style="margin: 0;">
        <div class="card-header">
          <h3><i class="ri-trophy-line"></i> Top Facturadores de este Periodo</h3>
        </div>
        <div class="card-body" id="d-period-top-commerces" style="padding: 1.25rem;"></div>
      </div>
    </div>
  `;
  
  updateDashboardPeriodView();
}

window.updateDashboardPeriodView = function() {
  const periodSelect = document.getElementById('d-period-select');
  if (!periodSelect) return;
  const periodId = periodSelect.value;
  
  const periodObj = cachedDashboardPeriods.find(p => p.id === periodId);
  const statusBadge = document.getElementById('d-period-status-badge');
  if (statusBadge && periodObj) {
    let statusClass = 'badge-neutral';
    if (periodObj.status === 'activo') statusClass = 'badge-success';
    if (periodObj.status === 'en_proceso') statusClass = 'badge-warning';
    statusBadge.innerHTML = `<span class="badge ${statusClass}" style="text-transform: uppercase;">Estado: ${periodObj.status}</span>`;
  }
  
  const periodRecords = cachedDashboardRecords.filter(r => r.period_id === periodId);
  
  let totalFulfFact = 0;
  let totalEnvFact = 0;
  let totalFulfRec = 0;
  let totalEnvRec = 0;
  let totalAtrasado = 0;
  let totalProximo = 0;
  
  periodRecords.forEach(r => {
    totalFulfFact += (r.total_fulfillment || 0);
    totalEnvFact += (r.enviame || 0);
    totalFulfRec += (r.abono_fulfillment || 0);
    totalEnvRec += (r.abono_enviame || 0);
    
    const pendingFulf = (r.total_fulfillment || 0) - (r.abono_fulfillment || 0);
    const pendingEnv = (r.enviame || 0) - (r.abono_enviame || 0);
    
    if (r.pago_fulfillment === 'Atrasado') {
      totalAtrasado += pendingFulf;
    } else if (r.pago_fulfillment !== 'Recibido' && r.pago_fulfillment !== 'abono' && r.pago_fulfillment !== 'aprobado' && r.pago_fulfillment !== 'Sin movimientos') {
      totalProximo += pendingFulf;
    }
    
    if (r.pago_enviame === 'Atrasado') {
      totalAtrasado += pendingEnv;
    } else if (r.pago_enviame !== 'Recibido' && r.pago_enviame !== 'abono' && r.pago_enviame !== 'aprobado' && r.pago_enviame !== 'Sin movimientos') {
      totalProximo += pendingEnv;
    }
  });
  
  // Calcular variaciones con respecto al mes anterior
  let cMonth = periodObj.period_month;
  let cYear = periodObj.period_year;
  if (!cMonth || !cYear) {
    const parts = (periodObj.name || '').split(' ');
    cYear = parts[1] ? parseInt(parts[1], 10) : new Date().getFullYear();
    const monthsMap = {
      'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4,
      'MAYO': 5, 'JUNIO': 6, 'JULIO': 7, 'AGOSTO': 8,
      'SEPTIEMBRE': 9, 'OCTUBRE': 10, 'NOVIEMBRE': 11, 'DICIEMBRE': 12
    };
    cMonth = monthsMap[parts[0]?.toUpperCase()] || 1;
  }
  
  let prevMonth = cMonth - 1;
  let prevYear = cYear;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = cYear - 1;
  }
  
  const prevPeriodObj = cachedDashboardPeriods.find(p => {
    let pM = p.period_month;
    let pY = p.period_year;
    if (!pM || !pY) {
      const parts = (p.name || '').split(' ');
      pY = parts[1] ? parseInt(parts[1], 10) : 0;
      const monthsMap = {
        'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4,
        'MAYO': 5, 'JUNIO': 6, 'JULIO': 7, 'AGOSTO': 8,
        'SEPTIEMBRE': 9, 'OCTUBRE': 10, 'NOVIEMBRE': 11, 'DICIEMBRE': 12
      };
      pM = monthsMap[parts[0]?.toUpperCase()] || 0;
    }
    return pM === prevMonth && pY === prevYear;
  });
  
  let prevFulfFact = 0;
  let prevEnvFact = 0;
  let prevFulfRec = 0;
  let prevEnvRec = 0;
  let prevAtrasado = 0;
  let prevProximo = 0;
  let hasPrevData = false;
  
  if (prevPeriodObj) {
    hasPrevData = true;
    const prevRecords = cachedDashboardRecords.filter(r => r.period_id === prevPeriodObj.id);
    prevRecords.forEach(r => {
      prevFulfFact += (r.total_fulfillment || 0);
      prevEnvFact += (r.enviame || 0);
      prevFulfRec += (r.abono_fulfillment || 0);
      prevEnvRec += (r.abono_enviame || 0);
      
      const pendingFulf = (r.total_fulfillment || 0) - (r.abono_fulfillment || 0);
      const pendingEnv = (r.enviame || 0) - (r.abono_enviame || 0);
      
      if (r.pago_fulfillment === 'Atrasado') {
        prevAtrasado += pendingFulf;
      } else if (r.pago_fulfillment !== 'Recibido' && r.pago_fulfillment !== 'abono' && r.pago_fulfillment !== 'aprobado' && r.pago_fulfillment !== 'Sin movimientos') {
        prevProximo += pendingFulf;
      }
      
      if (r.pago_enviame === 'Atrasado') {
        prevAtrasado += pendingEnv;
      } else if (r.pago_enviame !== 'Recibido' && r.pago_enviame !== 'abono' && r.pago_enviame !== 'aprobado' && r.pago_enviame !== 'Sin movimientos') {
        prevProximo += pendingEnv;
      }
    });
  }
  
  const getVariationHtml = (curr, prev, isOverdue = false) => {
    if (!hasPrevData) {
      return `<span style="font-size: 0.72rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">Sin datos del mes anterior</span>`;
    }
    if (prev === 0 && curr === 0) {
      return `<span style="font-size: 0.72rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">0% vs mes anterior</span>`;
    }
    
    let pct = 0;
    if (prev === 0) {
      pct = 100;
    } else {
      pct = ((curr - prev) / prev) * 100;
    }
    
    let colorClass = '';
    let arrow = '';
    let sign = pct > 0 ? '+' : '';
    
    if (pct > 0) {
      arrow = '▲';
      if (isOverdue) {
        colorClass = 'color: var(--color-danger)';
      } else {
        colorClass = 'color: var(--color-success)';
      }
    } else if (pct < 0) {
      arrow = '▼';
      if (isOverdue) {
        colorClass = 'color: var(--color-success)';
      } else {
        colorClass = 'color: var(--color-danger)';
      }
    } else {
      return `<span style="font-size: 0.72rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">0% vs mes anterior</span>`;
    }
    
    return `<span style="font-size: 0.72rem; ${colorClass}; font-weight: 600; display: block; margin-top: 0.25rem;">${arrow} ${sign}${pct.toFixed(1)}% vs mes ant.</span>`;
  };
  
  const cardsContainer = document.getElementById('d-period-metrics-cards');
  if (cardsContainer) {
    cardsContainer.innerHTML = `
      <div class="dashboard-card primary" onclick="showDashboardMetricDetail('fulf_fact', '${periodId}')">
        <div class="dashboard-card-label"><i class="ri-bill-line"></i> Total Facturación Fulfillment</div>
        <div class="dashboard-card-value">${window.formatCLP(totalFulfFact)}</div>
        <div class="dashboard-card-sub">Clic para ver detalle de comercios</div>
        ${getVariationHtml(totalFulfFact, prevFulfFact, false)}
      </div>
      <div class="dashboard-card primary" onclick="showDashboardMetricDetail('env_fact', '${periodId}')">
        <div class="dashboard-card-label"><i class="ri-bill-line"></i> Total Facturación Envíame</div>
        <div class="dashboard-card-value">${window.formatCLP(totalEnvFact)}</div>
        <div class="dashboard-card-sub">Clic para ver detalle de comercios</div>
        ${getVariationHtml(totalEnvFact, prevEnvFact, false)}
      </div>
      <div class="dashboard-card success" onclick="showDashboardMetricDetail('fulf_rec', '${periodId}')">
        <div class="dashboard-card-label" style="color: var(--color-success);"><i class="ri-checkbox-circle-line"></i> Pagos Recibidos Fulfillment</div>
        <div class="dashboard-card-value" style="color: var(--color-success);">${window.formatCLP(totalFulfRec)}</div>
        <div class="dashboard-card-sub">${totalFulfFact > 0 ? ((totalFulfRec / totalFulfFact) * 100).toFixed(0) : 0}% recaudado</div>
        ${getVariationHtml(totalFulfRec, prevFulfRec, false)}
      </div>
      <div class="dashboard-card success" onclick="showDashboardMetricDetail('env_rec', '${periodId}')">
        <div class="dashboard-card-label" style="color: var(--color-success);"><i class="ri-checkbox-circle-line"></i> Pagos Recibidos Envíame</div>
        <div class="dashboard-card-value" style="color: var(--color-success);">${window.formatCLP(totalEnvRec)}</div>
        <div class="dashboard-card-sub">${totalEnvFact > 0 ? ((totalEnvRec / totalEnvFact) * 100).toFixed(0) : 0}% recaudado</div>
        ${getVariationHtml(totalEnvRec, prevEnvRec, false)}
      </div>
      <div class="dashboard-card danger" onclick="showDashboardMetricDetail('atrasado', '${periodId}')">
        <div class="dashboard-card-label" style="color: var(--color-danger);"><i class="ri-error-warning-line"></i> Montos con Atraso</div>
        <div class="dashboard-card-value" style="color: var(--color-danger);">${window.formatCLP(totalAtrasado)}</div>
        <div class="dashboard-card-sub">Total vencido y no pagado</div>
        ${getVariationHtml(totalAtrasado, prevAtrasado, true)}
      </div>
      <div class="dashboard-card warning" onclick="showDashboardMetricDetail('proximo', '${periodId}')">
        <div class="dashboard-card-label" style="color: var(--color-warning);"><i class="ri-time-line"></i> Montos Próximos a Vencer</div>
        <div class="dashboard-card-value" style="color: var(--color-warning);">${window.formatCLP(totalProximo)}</div>
        <div class="dashboard-card-sub">Pagos pendientes a tiempo</div>
        ${getVariationHtml(totalProximo, prevProximo, true)}
      </div>
    `;
  }
  
  const recSummary = document.getElementById('d-period-recaudacion-summary');
  if (recSummary) {
    const totalFact = totalFulfFact + totalEnvFact;
    const totalRec = totalFulfRec + totalEnvRec;
    const recPercent = totalFact > 0 ? ((totalRec / totalFact) * 100).toFixed(1) : '0';
    
    recSummary.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; justify-content: space-between; font-size: 0.95rem; color: var(--color-text-main); font-weight: 500;">
          <span>Total Facturado del Periodo:</span>
          <strong>${window.formatCLP(totalFact)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.95rem; color: var(--color-success); font-weight: 500;">
          <span>Total Recaudado:</span>
          <strong>${window.formatCLP(totalRec)} (${recPercent}%)</strong>
        </div>
        <div style="background: var(--color-bg); border-radius: 6px; height: 10px; width: 100%; overflow: hidden; margin: 0.5rem 0;">
          <div style="background: var(--color-success); height: 100%; width: ${recPercent}%;"></div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; border-top: 1px solid var(--color-border); padding-top: 1rem; font-size: 0.85rem;">
          <div>
            <span style="color: var(--color-text-muted);">Pendiente Fulfillment:</span><br>
            <strong>${window.formatCLP(totalFulfFact - totalFulfRec)}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted);">Pendiente Envíame:</span><br>
            <strong>${window.formatCLP(totalEnvFact - totalEnvRec)}</strong>
          </div>
        </div>
      </div>
    `;
  }
  
  const topCommercesContainer = document.getElementById('d-period-top-commerces');
  if (topCommercesContainer) {
    const commList = periodRecords.map(r => {
      const recTotal = (r.total_fulfillment || 0) + (r.enviame || 0);
      const recPagado = (r.abono_fulfillment || 0) + (r.abono_enviame || 0);
      return {
        name: r.comercio,
        total: recTotal,
        recibido: recPagado,
        pendiente: recTotal - recPagado
      };
    }).sort((a, b) => b.total - a.total).slice(0, 5);
    
    if (commList.length === 0) {
      topCommercesContainer.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: 2rem;">No hay registros en este periodo</p>';
      return;
    }
    
    const maxVal = commList[0].total || 1;
    
    topCommercesContainer.innerHTML = commList.map(c => {
      const widthPct = ((c.total / maxVal) * 100).toFixed(0);
      return `
        <div style="margin-bottom: 1rem; border-bottom: 1px dashed var(--color-border); padding-bottom: 0.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <span style="font-weight: 600; color: var(--color-text-main); font-size: 0.9rem;">${c.name}</span>
            <strong style="color: var(--color-text-main); font-size: 0.9rem;">${window.formatCLP(c.total)}</strong>
          </div>
          <div style="background: var(--color-bg); border-radius: 4px; height: 6px; width: 100%; overflow: hidden;">
            <div style="background: var(--color-primary); height: 100%; width: ${widthPct}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.2rem;">
            <span>Recibido: ${window.formatCLP(c.recibido)}</span>
            <span>Pendiente: ${window.formatCLP(c.pendiente)}</span>
          </div>
        </div>
      `;
    }).join('');
  }
};

window.showDashboardMetricDetail = function(metricType, periodId) {
  const periodRecords = cachedDashboardRecords.filter(r => r.period_id === periodId);
  const modal = document.getElementById('dashboard-detail-modal');
  const modalTitle = document.getElementById('d-modal-title');
  const modalBody = document.getElementById('d-modal-body-content');
  
  if (!modal || !modalTitle || !modalBody) return;
  
  let titleText = '';
  let tableRows = '';
  
  if (metricType === 'fulf_fact') {
    titleText = 'Detalle de Facturación Fulfillment';
    tableRows = periodRecords.map(r => `
      <tr>
        <td><strong>${r.comercio}</strong></td>
        <td style="font-weight: 600;">${window.formatCLP(r.total_fulfillment)}</td>
        <td>${r.fecha_limite ? new Date(r.fecha_limite + 'T00:00:00').toLocaleDateString() : '-'}</td>
        <td><span class="client-badge ${getStatusClass(r.pago_fulfillment)}">${r.pago_fulfillment}</span></td>
      </tr>
    `).join('');
  } else if (metricType === 'env_fact') {
    titleText = 'Detalle de Facturación Envíame';
    tableRows = periodRecords.map(r => `
      <tr>
        <td><strong>${r.comercio}</strong></td>
        <td style="font-weight: 600;">${window.formatCLP(r.enviame)}</td>
        <td>${r.fecha_limite_enviame ? new Date(r.fecha_limite_enviame + 'T00:00:00').toLocaleDateString() : '-'}</td>
        <td><span class="client-badge ${getStatusClass(r.pago_enviame)}">${r.pago_enviame}</span></td>
      </tr>
    `).join('');
  } else if (metricType === 'fulf_rec') {
    titleText = 'Detalle de Pagos Recibidos Fulfillment';
    const filtered = periodRecords.filter(r => (r.abono_fulfillment || 0) > 0);
    tableRows = filtered.map(r => `
      <tr>
        <td><strong>${r.comercio}</strong></td>
        <td style="font-weight: 600; color: var(--color-success);">${window.formatCLP(r.abono_fulfillment)} <span style="font-weight: normal; font-size: 0.75rem; color: var(--color-text-muted);">de ${window.formatCLP(r.total_fulfillment)}</span></td>
        <td>${r.fecha_limite ? new Date(r.fecha_limite + 'T00:00:00').toLocaleDateString() : '-'}</td>
        <td><span class="client-badge ${getStatusClass(r.pago_fulfillment)}">${r.pago_fulfillment}</span></td>
      </tr>
    `).join('');
  } else if (metricType === 'env_rec') {
    titleText = 'Detalle de Pagos Recibidos Envíame';
    const filtered = periodRecords.filter(r => (r.abono_enviame || 0) > 0);
    tableRows = filtered.map(r => `
      <tr>
        <td><strong>${r.comercio}</strong></td>
        <td style="font-weight: 600; color: var(--color-success);">${window.formatCLP(r.abono_enviame)} <span style="font-weight: normal; font-size: 0.75rem; color: var(--color-text-muted);">de ${window.formatCLP(r.enviame)}</span></td>
        <td>${r.fecha_limite_enviame ? new Date(r.fecha_limite_enviame + 'T00:00:00').toLocaleDateString() : '-'}</td>
        <td><span class="client-badge ${getStatusClass(r.pago_enviame)}">${r.pago_enviame}</span></td>
      </tr>
    `).join('');
  } else if (metricType === 'atrasado') {
    titleText = 'Detalle de Montos con Atraso';
    const list = [];
    periodRecords.forEach(r => {
      const fPending = (r.total_fulfillment || 0) - (r.abono_fulfillment || 0);
      const ePending = (r.enviame || 0) - (r.abono_enviame || 0);
      
      if (r.pago_fulfillment === 'Atrasado' && fPending > 0) {
        list.push({ commerce: r.comercio, service: 'Fulfillment', amount: fPending, dueDate: r.fecha_limite, status: r.pago_fulfillment });
      }
      if (r.pago_enviame === 'Atrasado' && ePending > 0) {
        list.push({ commerce: r.comercio, service: 'Envíame', amount: ePending, dueDate: r.fecha_limite_enviame, status: r.pago_enviame });
      }
    });
    
    tableRows = list.map(item => `
      <tr>
        <td><strong>${item.commerce}</strong><br><span style="font-size: 0.75rem; color: var(--color-text-muted);">${item.service}</span></td>
        <td style="color: var(--color-danger); font-weight: 600;">${window.formatCLP(item.amount)}</td>
        <td>${item.dueDate ? new Date(item.dueDate + 'T00:00:00').toLocaleDateString() : '-'}</td>
        <td><span class="client-badge ${getStatusClass(item.status)}">${item.status}</span></td>
      </tr>
    `).join('');
  } else if (metricType === 'proximo') {
    titleText = 'Detalle de Montos Próximos a Vencer';
    const list = [];
    periodRecords.forEach(r => {
      const fPending = (r.total_fulfillment || 0) - (r.abono_fulfillment || 0);
      const ePending = (r.enviame || 0) - (r.abono_enviame || 0);
      
      if (r.pago_fulfillment !== 'Recibido' && r.pago_fulfillment !== 'abono' && r.pago_fulfillment !== 'aprobado' && r.pago_fulfillment !== 'Sin movimientos' && r.pago_fulfillment !== 'Atrasado' && fPending > 0) {
        list.push({ commerce: r.comercio, service: 'Fulfillment', amount: fPending, dueDate: r.fecha_limite, status: r.pago_fulfillment });
      }
      if (r.pago_enviame !== 'Recibido' && r.pago_enviame !== 'abono' && r.pago_enviame !== 'aprobado' && r.pago_enviame !== 'Sin movimientos' && r.pago_enviame !== 'Atrasado' && ePending > 0) {
        list.push({ commerce: r.comercio, service: 'Envíame', amount: ePending, dueDate: r.fecha_limite_enviame, status: r.pago_enviame });
      }
    });
    
    tableRows = list.map(item => `
      <tr>
        <td><strong>${item.commerce}</strong><br><span style="font-size: 0.75rem; color: var(--color-text-muted);">${item.service}</span></td>
        <td style="color: var(--color-warning); font-weight: 600;">${window.formatCLP(item.amount)}</td>
        <td>${item.dueDate ? new Date(item.dueDate + 'T00:00:00').toLocaleDateString() : '-'}</td>
        <td><span class="client-badge ${getStatusClass(item.status)}">${item.status}</span></td>
      </tr>
    `).join('');
  }
  
  modalTitle.textContent = titleText;
  
  if (!tableRows) {
    modalBody.innerHTML = `
      <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
        No hay registros para esta métrica en este periodo.
      </div>
    `;
  } else {
    modalBody.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Comercio</th>
              <th>Monto</th>
              <th>Fecha Vencimiento</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    `;
  }
  
  modal.classList.add('active');
};

window.closeDashboardModal = function() {
  const modal = document.getElementById('dashboard-detail-modal');
  if (modal) modal.classList.remove('active');
};

function renderDashboardCommerceView() {
  const content = document.getElementById('d-content-commerce');
  if (!content) return;
  
  const commerces = [...new Set(cachedDashboardRecords.map(r => r.comercio))].sort();
  
  let options = '';
  commerces.forEach(c => {
    options += `<option value="${c}">${c}</option>`;
  });
  
  content.innerHTML = `
    <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.25rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <label style="font-weight: 600; font-size: 0.9rem; color: var(--color-text-main);">Seleccionar Comercio:</label>
        <select id="d-commerce-select" class="form-input" style="width: 250px; margin: 0; padding: 0.35rem 0.75rem;" onchange="updateDashboardCommerceView()">
          ${options}
        </select>
      </div>
      <div id="d-commerce-status-indicator"></div>
    </div>
    
    <div id="d-commerce-summary-cards" class="dashboard-grid"></div>
    
    <div class="card" style="margin-top: 1.5rem;">
      <div class="card-header">
        <h3><i class="ri-history-line"></i> Historial Completo y Registro Anual</h3>
      </div>
      <div class="card-body table-responsive" id="d-commerce-history-table" style="padding: 0;"></div>
    </div>
  `;
  
  updateDashboardCommerceView();
}

window.updateDashboardCommerceView = function() {
  const commSelect = document.getElementById('d-commerce-select');
  if (!commSelect) return;
  const commerce = commSelect.value;
  if (!commerce) return;
  
  const statusObj = cachedDashboardCommerceStatus.find(s => s.comercio.toLowerCase() === commerce.toLowerCase());
  const isAlDia = statusObj ? statusObj.al_dia : true;
  
  const statusIndicator = document.getElementById('d-commerce-status-indicator');
  if (statusIndicator) {
    statusIndicator.innerHTML = `
      <span class="badge ${isAlDia ? 'badge-success' : 'badge-danger'}" style="text-transform: uppercase; font-size: 0.75rem; padding: 0.25rem 0.5rem; font-weight: 600;">
        Estado del Servicio: ${isAlDia ? 'Al Día (Activo)' : 'Pausado / Suspendido'}
      </span>
    `;
  }
  
  const commRecords = cachedDashboardRecords.filter(r => r.comercio.toLowerCase() === commerce.toLowerCase());
  
  let totalFact = 0;
  let totalRec = 0;
  commRecords.forEach(r => {
    totalFact += (r.total_fulfillment || 0) + (r.enviame || 0);
    totalRec += (r.abono_fulfillment || 0) + (r.abono_enviame || 0);
  });
  
  const cards = document.getElementById('d-commerce-summary-cards');
  if (cards) {
    cards.innerHTML = `
      <div class="dashboard-card primary">
        <div class="dashboard-card-label"><i class="ri-bill-line"></i> Total Facturado Histórico</div>
        <div class="dashboard-card-value">${window.formatCLP(totalFact)}</div>
        <div class="dashboard-card-sub">Fulfillment + Envíame</div>
      </div>
      <div class="dashboard-card success">
        <div class="dashboard-card-label" style="color: var(--color-success);"><i class="ri-checkbox-circle-line"></i> Total Pagado Histórico</div>
        <div class="dashboard-card-value" style="color: var(--color-success);">${window.formatCLP(totalRec)}</div>
        <div class="dashboard-card-sub">${totalFact > 0 ? ((totalRec / totalFact) * 100).toFixed(0) : 0}% recaudado</div>
      </div>
      <div class="dashboard-card warning">
        <div class="dashboard-card-label" style="color: var(--color-warning);"><i class="ri-error-warning-line"></i> Saldo Pendiente Acumulado</div>
        <div class="dashboard-card-value" style="color: var(--color-warning);">${window.formatCLP(totalFact - totalRec)}</div>
        <div class="dashboard-card-sub">Monto por cobrar restante</div>
      </div>
    `;
  }
  
  const recordsByYear = {};
  commRecords.forEach(r => {
    let year = r.billing_periods?.period_year;
    let month = r.billing_periods?.period_month;
    
    if (!year || !month) {
      const parts = (r.billing_periods?.name || '').split(' ');
      year = parts[1] ? parseInt(parts[1], 10) : new Date().getFullYear();
    }
    
    if (!recordsByYear[year]) recordsByYear[year] = [];
    recordsByYear[year].push(r);
  });
  
  const sortedYears = Object.keys(recordsByYear).sort((a, b) => b - a);
  
  const tableContainer = document.getElementById('d-commerce-history-table');
  if (tableContainer) {
    if (sortedYears.length === 0) {
      tableContainer.innerHTML = '<div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">Sin historial registrado</div>';
      return;
    }
    
    let html = '';
    sortedYears.forEach(year => {
      const yearRecords = recordsByYear[year].sort((a, b) => {
        const m1 = a.billing_periods?.period_month || 1;
        const m2 = b.billing_periods?.period_month || 1;
        return m2 - m1;
      });
      
      const rows = yearRecords.map(r => `
        <tr>
          <td><strong>${r.billing_periods?.name}</strong></td>
          <td>${window.formatCLP(r.total_fulfillment)}</td>
          <td>${window.formatCLP(r.abono_fulfillment)}</td>
          <td>
            <span class="client-badge ${getStatusClass(r.pago_fulfillment)}">${r.pago_fulfillment}</span>
            ${r.pago_fulfillment === 'Recibido' && r.fecha_pago_recibido_fulfillment ? `
              <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                Recibido: ${new Date(r.fecha_pago_recibido_fulfillment + 'T00:00:00').toLocaleDateString()}
              </div>
            ` : ''}
          </td>
          <td>${r.num_factura ? '#' + r.num_factura : '-'}</td>
          
          <td>${window.formatCLP(r.enviame)}</td>
          <td>${window.formatCLP(r.abono_enviame)}</td>
          <td>
            <span class="client-badge ${getStatusClass(r.pago_enviame)}">${r.pago_enviame}</span>
            ${r.pago_enviame === 'Recibido' && r.fecha_pago_recibido_enviame ? `
              <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                Recibido: ${new Date(r.fecha_pago_recibido_enviame + 'T00:00:00').toLocaleDateString()}
              </div>
            ` : ''}
          </td>
          <td>${r.num_factura_enviame ? '#' + r.num_factura_enviame : '-'}</td>
          
          <td style="font-weight: 600; color: var(--color-text-main);">${window.formatCLP((r.total_fulfillment || 0) + (r.enviame || 0))}</td>
        </tr>
      `).join('');
      
      html += `
        <div style="padding: 0.85rem 1.25rem; background: var(--color-surface-hover); border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); font-weight: 600; font-size: 0.95rem; color: var(--color-text-main);">
          Año ${year}
        </div>
        <table class="data-table" style="margin-bottom: 1.5rem;">
          <thead>
            <tr>
              <th>Periodo</th>
              <th>Fulf. Total</th>
              <th>Fulf. Abono</th>
              <th>Fulf. Pago</th>
              <th>Fulf. Factura</th>
              <th>Env. Total</th>
              <th>Env. Abono</th>
              <th>Env. Pago</th>
              <th>Env. Factura</th>
              <th>Monto Mes</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;
    });
    
    tableContainer.innerHTML = html;
  }
};

function renderDashboardPendingView() {
  const content = document.getElementById('d-content-pending');
  if (!content) return;
  
  const invoicesToEmit = [];
  cachedDashboardRecords.forEach(r => {
    if (r.factura_fulfillment === 'Facturar') {
      invoicesToEmit.push({ recordId: r.id, periodName: r.billing_periods?.name || '', commerce: r.comercio, service: 'Fulfillment', amount: r.total_fulfillment, type: 'fulfillment' });
    }
    if (r.factura_enviame === 'Facturar') {
      invoicesToEmit.push({ recordId: r.id, periodName: r.billing_periods?.name || '', commerce: r.comercio, service: 'Envíame', amount: r.enviame, type: 'enviame' });
    }
  });
  
  const fulfDetailsToSend = cachedDashboardRecords.filter(r => 
    (r.desglose_fulfillment === 'Por Generar' || r.desglose_fulfillment === 'Creado') && (r.total_fulfillment || 0) > 0
  );
  
  const envDetailsToSend = cachedDashboardRecords.filter(r => 
    r.pago_enviame === 'Por solicitar' && (r.enviame || 0) > 0
  );
  
  let invoicesRows = invoicesToEmit.map(i => `
    <tr>
      <td><strong>${i.commerce}</strong></td>
      <td>${i.periodName}</td>
      <td><span class="client-badge status-blue">${i.service}</span></td>
      <td style="font-weight: 600;">${window.formatCLP(i.amount)}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="markDashboardInvoiceAsIssued('${i.recordId}', '${i.type}')">
          <i class="ri-file-add-line"></i> Registrar Factura
        </button>
      </td>
    </tr>
  `).join('');
  
  let fulfDetailsRows = fulfDetailsToSend.map(r => `
    <tr>
      <td><strong>${r.comercio}</strong></td>
      <td>${r.billing_periods?.name || ''}</td>
      <td><span class="client-badge status-gray">${r.desglose_fulfillment}</span></td>
      <td style="font-weight: 500;">${window.formatCLP(r.total_fulfillment)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="markDashboardFulfDetailSent('${r.id}')">
          <i class="ri-mail-send-line"></i> Marcar Enviado
        </button>
      </td>
    </tr>
  `).join('');
  
  let envDetailsRows = envDetailsToSend.map(r => `
    <tr>
      <td><strong>${r.comercio}</strong></td>
      <td>${r.billing_periods?.name || ''}</td>
      <td><span class="client-badge status-gray">${r.pago_enviame}</span></td>
      <td style="font-weight: 500;">${window.formatCLP(r.enviame)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="markDashboardEnvDetailSent('${r.id}')">
          <i class="ri-mail-send-line"></i> Marcar Enviado
        </button>
      </td>
    </tr>
  `).join('');
  
  content.innerHTML = `
    <!-- Section 1: Facturas por Emitir -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <h3><i class="ri-file-warning-line"></i> Facturas por Emitir (${invoicesToEmit.length})</h3>
      </div>
      <div class="card-body table-responsive" style="padding: 0;">
        ${invoicesRows ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>Comercio</th>
                <th>Periodo</th>
                <th>Servicio</th>
                <th>Monto</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${invoicesRows}
            </tbody>
          </table>
        ` : `
          <div style="padding: 2.5rem; text-align: center; color: var(--color-text-muted);">
            No hay facturas pendientes de emisión.
          </div>
        `}
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
      <!-- Section 2: Enviar Detalle Fulfillment -->
      <div class="card" style="margin: 0;">
        <div class="card-header">
          <h3><i class="ri-mail-line"></i> Enviar Detalle Fulfillment (${fulfDetailsToSend.length})</h3>
        </div>
        <div class="card-body table-responsive" style="padding: 0;">
          ${fulfDetailsRows ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th>Comercio</th>
                  <th>Periodo</th>
                  <th>Estado</th>
                  <th>Monto</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                ${fulfDetailsRows}
              </tbody>
            </table>
          ` : `
            <div style="padding: 2.5rem; text-align: center; color: var(--color-text-muted);">
              No hay detalles de Fulfillment pendientes de enviar.
            </div>
          `}
        </div>
      </div>
      
      <!-- Section 3: Enviar Detalle Envíame -->
      <div class="card" style="margin: 0;">
        <div class="card-header">
          <h3><i class="ri-mail-line"></i> Enviar Detalle Envíame (${envDetailsToSend.length})</h3>
        </div>
        <div class="card-body table-responsive" style="padding: 0;">
          ${envDetailsRows ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th>Comercio</th>
                  <th>Periodo</th>
                  <th>Estado</th>
                  <th>Monto</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                ${envDetailsRows}
              </tbody>
            </table>
          ` : `
            <div style="padding: 2.5rem; text-align: center; color: var(--color-text-muted);">
              No hay detalles de Envíame pendientes de enviar.
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

window.markDashboardInvoiceAsIssued = async function(recordId, serviceType) {
  const invoiceNumStr = prompt('Introduce el Número de Factura emitida:');
  if (invoiceNumStr === null) return;
  const num = parseInt(invoiceNumStr.trim(), 10);
  if (isNaN(num) || num <= 0) {
    alert('Número de factura no válido.');
    return;
  }
  
  showSavingBadge(true);
  try {
    const updateObj = {};
    if (serviceType === 'fulfillment') {
      updateObj.factura_fulfillment = 'Emitida';
      updateObj.num_factura = num;
    } else {
      updateObj.factura_enviame = 'Emitida';
      updateObj.num_factura_enviame = num;
    }
    
    const { error } = await supabase
      .from('billing_records')
      .update(updateObj)
      .eq('id', recordId);
      
    if (error) throw error;
    
    alert('Factura registrada con éxito.');
    await refreshDashboardData();
  } catch (err) {
    console.error(err);
    alert('Error al registrar factura: ' + err.message);
  } finally {
    showSavingBadge(false);
  }
};

window.markDashboardFulfDetailSent = async function(recordId) {
  if (!confirm('¿Marcar el desglose de Fulfillment como enviado al cliente?')) return;
  
  showSavingBadge(true);
  try {
    const { error } = await supabase
      .from('billing_records')
      .update({ desglose_fulfillment: 'Enviado' })
      .eq('id', recordId);
      
    if (error) throw error;
    
    alert('Desglose marcado como Enviado.');
    await refreshDashboardData();
  } catch (err) {
    console.error(err);
    alert('Error: ' + err.message);
  } finally {
    showSavingBadge(false);
  }
};

window.markDashboardEnvDetailSent = async function(recordId) {
  if (!confirm('¿Marcar el detalle de Envíame como enviado y solicitar el pago? (Esto cambiará el estado del pago a "En espera")')) return;
  
  showSavingBadge(true);
  try {
    const { error } = await supabase
      .from('billing_records')
      .update({ pago_enviame: 'En espera' })
      .eq('id', recordId);
      
    if (error) throw error;
    
    alert('Detalle marcado como enviado y pago solicitado.');
    await refreshDashboardData();
  } catch (err) {
    console.error(err);
    alert('Error: ' + err.message);
  } finally {
    showSavingBadge(false);
  }
};

async function refreshDashboardData() {
  try {
    const { data: records, error } = await supabase
      .from('billing_records')
      .select('*, billing_periods(name, status, period_month, period_year)');
    if (error) throw error;
    cachedDashboardRecords = records || [];
    renderDashboardPendingView();
  } catch(err) {
    console.error('Error refreshing dashboard records:', err);
  }
}

async function renderInboxPage() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  
  appContent.innerHTML = `
    <div style="max-width: 900px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2 style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 600;">Mi Inbox de Notificaciones</h2>
        <button id="inbox-mark-all-read-btn" class="btn btn-outline" style="border-color: var(--color-primary); color: var(--color-primary); display: none;">
          <i class="ri-check-double-line" style="margin-right: 0.25rem;"></i> Marcar todas leídas
        </button>
      </div>
      <div class="card">
        <div class="card-body" style="padding: 0;">
          <div id="inbox-list" style="min-height: 200px; position: relative;">
            <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
              <i class="ri-loader-4-line spin" style="font-size: 2rem;"></i><br>Cargando...
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  await loadInboxData();
}

async function loadInboxData() {
  const list = document.getElementById('inbox-list');
  const markAllBtn = document.getElementById('inbox-mark-all-read-btn');
  if (!list) return;

  try {
    if (!currentMerchantId) return;
    
    // Fetch user's read records
    const { data: readRecords } = await supabase
      .from('user_notification_reads')
      .select('entity_id')
      .eq('user_id', currentMerchantId)
      .eq('entity_type', 'notification');
      
    const readIds = readRecords ? readRecords.map(r => r.entity_id) : [];

    const rolesToMatch = ['all', userRole];
    // Traer un historial más largo (100)
    const { data, error } = await supabase
      .from('dashboard_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
      
    if (error) throw error;

    const filteredData = data ? data.filter(n => {
      return (rolesToMatch.includes(n.target_role) && !n.user_id) || n.user_id === currentMerchantId;
    }) : [];

    if (!filteredData || filteredData.length === 0) {
      list.innerHTML = `
        <div style="padding: 4rem 2rem; text-align: center; color: var(--color-text-muted);">
          <div style="background: var(--color-surface-hover); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
            <i class="ri-inbox-archive-line" style="font-size: 2rem; color: var(--color-border);"></i>
          </div>
          <h3 style="font-size: 1.1rem; color: var(--color-text-main); margin-bottom: 0.25rem;">Bandeja vacía</h3>
          <p style="font-size: 0.9rem;">No tienes notificaciones en tu historial.</p>
        </div>`;
      if (markAllBtn) markAllBtn.style.display = 'none';
      return;
    }

    const unreadCount = filteredData.filter(n => !readIds.includes(n.id)).length;
    if (markAllBtn) {
      markAllBtn.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
      
      // Remove old listener by replacing button
      const newBtn = markAllBtn.cloneNode(true);
      markAllBtn.parentNode.replaceChild(newBtn, markAllBtn);
      
      newBtn.addEventListener('click', async () => {
        try {
          const unreadItems = filteredData.filter(n => !readIds.includes(n.id));
          const inserts = unreadItems.map(item => ({
            user_id: currentMerchantId,
            entity_type: 'notification',
            entity_id: item.id
          }));
          
          if (inserts.length > 0) {
            newBtn.innerHTML = '<i class="ri-loader-4-line spin"></i> Marcando...';
            await supabase.from('user_notification_reads').insert(inserts);
            await loadInboxData();
          }
        } catch(err) {
          console.error(err);
        }
      });
    }

    list.innerHTML = filteredData.map(n => {
      const isReadLocally = readIds.includes(n.id);
      return `
      <div class="inbox-item ${isReadLocally ? 'read' : 'unread'}" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; gap: 1rem; align-items: flex-start; transition: background-color 0.2s; background: ${isReadLocally ? 'transparent' : 'rgba(59, 130, 246, 0.05)'};">
        <div style="flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; background: ${isReadLocally ? 'var(--color-surface-hover)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isReadLocally ? 'var(--color-text-muted)' : 'var(--color-primary)'}; display: flex; align-items: center; justify-content: center;">
          <i class="${isReadLocally ? 'ri-notification-badge-line' : 'ri-notification-3-fill'}" style="font-size: 1.25rem;"></i>
        </div>
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.25rem;">
            <h4 style="margin: 0; font-size: 1rem; color: var(--color-text-main); font-weight: ${isReadLocally ? '500' : '600'};">${n.title}</h4>
            <span style="font-size: 0.75rem; color: var(--color-text-muted); white-space: nowrap; margin-left: 1rem;">${new Date(n.created_at).toLocaleString()}</span>
          </div>
          <p style="margin: 0; font-size: 0.9rem; color: ${isReadLocally ? 'var(--color-text-muted)' : 'var(--color-text-main)'}; line-height: 1.5;">${n.message}</p>
        </div>
        ${!isReadLocally ? `
          <button class="btn btn-outline mark-inbox-read-btn" data-id="${n.id}" title="Marcar como leída" style="padding: 0.25rem 0.5rem; font-size: 1.1rem; border: none; color: var(--color-primary); background: transparent;">
            <i class="ri-check-line"></i>
          </button>
        ` : `
          <div style="padding: 0.25rem 0.5rem; color: var(--color-text-muted); font-size: 1.1rem;"><i class="ri-check-double-line"></i></div>
        `}
      </div>
    `}).join('');

    document.querySelectorAll('.mark-inbox-read-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        btn.innerHTML = '<i class="ri-loader-4-line spin"></i>';
        await supabase.from('user_notification_reads').insert([{ user_id: currentMerchantId, entity_type: 'notification', entity_id: id }]);
        await loadInboxData();
      });
    });

  } catch (err) {
    console.error('Error fetching inbox:', err);
    list.innerHTML = `<div style="padding: 2rem; color: var(--color-danger); text-align: center;">Error al cargar: ${err.message}</div>`;
  }
}

// ==========================================
// Módulo de Documentación de Servicio (Admin)
// ==========================================

function injectDocsAdminStyles() {
  if (document.getElementById('docs-admin-styles')) return;
  const style = document.createElement('style');
  style.id = 'docs-admin-styles';
  style.innerHTML = `
    .docs-admin-container {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .docs-admin-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .docs-admin-filters {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .docs-grid {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 1.5rem;
    }
    @media (max-width: 768px) {
      .docs-grid {
        grid-template-columns: 1fr;
      }
    }
    .folder-sidebar {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1rem;
      align-self: start;
    }
    .folder-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .folder-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 0.75rem;
      border-radius: var(--radius-md);
      cursor: pointer;
      color: var(--color-text-muted);
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.2s;
    }
    .folder-item:hover {
      background: var(--color-bg);
      color: var(--color-text-main);
    }
    .folder-item.active {
      background: rgba(59, 130, 246, 0.1);
      color: var(--color-primary);
    }
    .folder-icon {
      font-size: 1.1rem;
      margin-right: 0.5rem;
    }
    .file-list-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .badge-folder {
      background-color: rgba(59, 130, 246, 0.1);
      color: var(--color-primary);
      padding: 0.2rem 0.5rem;
      border-radius: var(--radius-sm);
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .btn-pin {
      background: none;
      border: none;
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0.25rem;
      border-radius: var(--radius-sm);
      transition: all 0.2s;
      line-height: 1;
    }
    .btn-pin.pinned {
      color: #f59e0b;
    }
    .btn-pin.unpinned {
      color: var(--color-text-muted);
      opacity: 0.4;
    }
    .btn-pin:hover {
      opacity: 1;
      background: var(--color-bg);
    }
    .btn-action-doc {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-action-doc:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
      background: var(--color-bg);
    }
    .btn-action-delete:hover {
      border-color: var(--color-danger);
      color: var(--color-danger);
      background: rgba(239, 68, 68, 0.05);
    }
  `;
  document.head.appendChild(style);
}

// Variables globales para administración de documentación
let adminDocsList = [];
let adminSelectedFolder = 'all';
let adminSearchQuery = '';

window.toggleUploadSourceType = function(type) {
  const fileGroup = document.getElementById('doc-upload-file-group');
  const urlGroup = document.getElementById('doc-upload-url-group');
  const fileInput = document.getElementById('doc-upload-file');
  const urlInput = document.getElementById('doc-upload-url');
  
  if (type === 'upload') {
    if (fileGroup) fileGroup.style.display = 'block';
    if (urlGroup) urlGroup.style.display = 'none';
    if (fileInput) fileInput.required = true;
    if (urlInput) urlInput.required = false;
  } else {
    if (fileGroup) fileGroup.style.display = 'none';
    if (urlGroup) urlGroup.style.display = 'block';
    if (fileInput) fileInput.required = false;
    if (urlInput) urlInput.required = true;
  }
};

window.toggleEditSourceType = function(type) {
  const fileGroup = document.getElementById('doc-edit-file-group');
  const urlGroup = document.getElementById('doc-edit-url-group');
  const fileInput = document.getElementById('doc-edit-file');
  const urlInput = document.getElementById('doc-edit-url');
  
  if (type === 'upload') {
    if (fileGroup) fileGroup.style.display = 'block';
    if (urlGroup) urlGroup.style.display = 'none';
    if (fileInput) fileInput.required = false; 
    if (urlInput) urlInput.required = false;
  } else {
    if (fileGroup) fileGroup.style.display = 'none';
    if (urlGroup) urlGroup.style.display = 'block';
    if (fileInput) fileInput.required = false;
    if (urlInput) urlInput.required = true;
  }
};

window.renderDocsAdmin = async function() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  injectDocsAdminStyles();

  appContent.innerHTML = `
    <div class="docs-admin-container">
      <div class="docs-admin-header">
        <div>
          <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-top: 0.25rem;">Carga, actualiza y gestiona los archivos de documentación para los clientes.</p>
        </div>
        <button id="btn-open-upload-doc" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.5rem;">
          <i class="ri-upload-cloud-line"></i> Subir Documento
        </button>
      </div>

      <div class="card" style="padding: 1.25rem; margin-bottom: 0.5rem;">
        <div class="docs-admin-filters">
          <div style="position: relative; flex: 1; min-width: 250px;">
            <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
            <input type="text" id="admin-doc-search" class="form-input" style="padding-left: 2.25rem;" placeholder="Buscar por nombre o descripción..." value="${adminSearchQuery}">
          </div>
        </div>
      </div>

      <div class="docs-grid">
        <aside class="folder-sidebar">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 0.75rem; letter-spacing: 0.05em;">Carpetas</h4>
          <ul id="admin-folder-list" class="folder-list">
            <li class="folder-item active" data-folder="all">
              <span><i class="ri-folder-open-line folder-icon"></i> Todas</span>
              <span id="folder-count-all" class="badge" style="font-size: 0.75rem; padding: 0.1rem 0.4rem;">0</span>
            </li>
          </ul>
        </aside>

        <section class="file-list-card">
          <div style="padding: 1.25rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin: 0; font-size: 1.1rem;" id="admin-current-folder-title">Todos los Archivos</h3>
            <span style="font-size: 0.85rem; color: var(--color-text-muted);" id="admin-files-count">0 archivos encontrados</span>
          </div>
          <div style="overflow-x: auto;">
            <table class="data-table" style="font-size: 0.875rem;">
              <thead>
                <tr>
                  <th style="width: 50px; text-align: center;">Fijar</th>
                  <th>Nombre del Archivo</th>
                  <th>Carpeta</th>
                  <th>Última Actualización</th>
                  <th style="text-align: right; width: 150px;">Acciones</th>
                </tr>
              </thead>
              <tbody id="admin-docs-table-body">
                <tr>
                  <td colspan="5" class="text-center" style="padding: 2.5rem; color: var(--color-text-muted);">
                    <i class="ri-loader-4-line spin" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
                    Cargando documentos...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;

  // Bind events
  document.getElementById('btn-open-upload-doc').addEventListener('click', () => {
    openUploadDocModal();
  });

  const searchInput = document.getElementById('admin-doc-search');
  searchInput.addEventListener('input', (e) => {
    adminSearchQuery = e.target.value.trim().toLowerCase();
    filterAndRenderDocsTable();
  });

  // Load documentation from Supabase
  await loadDocsAdminData();
};

async function loadDocsAdminData() {
  try {
    const { data, error } = await supabase
      .from('service_docs')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false });

    if (error) throw error;

    adminDocsList = data || [];
    renderFoldersSidebar();
    filterAndRenderDocsTable();
  } catch (err) {
    console.error('Error loading documents:', err);
    const tbody = document.getElementById('admin-docs-table-body');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center" style="padding: 2.5rem; color: var(--color-danger);">
            <i class="ri-error-warning-line" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
            Error al cargar documentación: ${err.message}
          </td>
        </tr>
      `;
    }
  }
}

function renderFoldersSidebar() {
  const sidebar = document.getElementById('admin-folder-list');
  if (!sidebar) return;

  const folders = {};
  adminDocsList.forEach(doc => {
    const f = doc.folder || 'General';
    folders[f] = (folders[f] || 0) + 1;
  });

  let html = `
    <li class="folder-item ${adminSelectedFolder === 'all' ? 'active' : ''}" data-folder="all">
      <span><i class="ri-folder-open-line folder-icon"></i> Todas</span>
      <span class="badge" style="font-size: 0.75rem; padding: 0.1rem 0.4rem; background: var(--color-border); color: var(--color-text-main); font-weight: 600;">${adminDocsList.length}</span>
    </li>
  `;

  Object.keys(folders).sort().forEach(folder => {
    html += `
      <li class="folder-item ${adminSelectedFolder === folder ? 'active' : ''}" data-folder="${folder}">
        <span><i class="ri-folder-line folder-icon"></i> ${folder}</span>
        <span class="badge" style="font-size: 0.75rem; padding: 0.1rem 0.4rem; background: var(--color-border); color: var(--color-text-main); font-weight: 600;">${folders[folder]}</span>
      </li>
    `;
  });

  sidebar.innerHTML = html;

  sidebar.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', () => {
      sidebar.querySelectorAll('.folder-item').forEach(li => li.classList.remove('active'));
      item.classList.add('active');
      adminSelectedFolder = item.getAttribute('data-folder');
      filterAndRenderDocsTable();
    });
  });
}

function filterAndRenderDocsTable() {
  const tbody = document.getElementById('admin-docs-table-body');
  const countSpan = document.getElementById('admin-files-count');
  const folderTitle = document.getElementById('admin-current-folder-title');
  if (!tbody) return;

  let filtered = adminDocsList;

  if (adminSelectedFolder !== 'all') {
    filtered = filtered.filter(doc => doc.folder === adminSelectedFolder);
    if (folderTitle) folderTitle.textContent = `Carpeta: ${adminSelectedFolder}`;
  } else {
    if (folderTitle) folderTitle.textContent = 'Todos los Archivos';
  }

  if (adminSearchQuery) {
    filtered = filtered.filter(doc => 
      doc.name.toLowerCase().includes(adminSearchQuery) || 
      (doc.description && doc.description.toLowerCase().includes(adminSearchQuery))
    );
  }

  if (countSpan) countSpan.textContent = `${filtered.length} archivos encontrados`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
          <i class="ri-file-search-line" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; opacity: 0.5;"></i>
          No se encontraron documentos en esta carpeta.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(doc => {
    const formattedDate = new Date(doc.updated_at).toLocaleDateString('es-CL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const isPinnedClass = doc.is_pinned ? 'pinned' : 'unpinned';
    const isPinnedIcon = doc.is_pinned ? 'ri-star-fill' : 'ri-star-line';

    return `
      <tr>
        <td style="text-align: center;">
          <button class="btn-pin ${isPinnedClass}" data-id="${doc.id}" title="${doc.is_pinned ? 'Quitar destacado' : 'Destacar/Fijar archivo'}">
            <i class="${isPinnedIcon}"></i>
          </button>
        </td>
        <td>
          <div style="font-weight: 600; color: var(--color-text-main);">${doc.name}</div>
          <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">${doc.description || 'Sin descripción'}</div>
        </td>
        <td>
          <span class="badge-folder">${doc.folder || 'General'}</span>
        </td>
        <td style="color: var(--color-text-muted); font-size: 0.8rem;">
          ${formattedDate}
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 0.25rem;">
            <a href="${doc.file_url}" target="_blank" class="btn-action-doc" title="Descargar/Ver">
              <i class="ri-download-2-line"></i>
            </a>
            <button class="btn-action-doc btn-edit-doc" data-id="${doc.id}" title="Editar metadatos / archivo">
              <i class="ri-edit-line"></i>
            </button>
            <button class="btn-action-doc btn-action-delete btn-delete-doc" data-id="${doc.id}" data-path="${doc.storage_path}" title="Eliminar">
              <i class="ri-delete-bin-line"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-pin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const doc = adminDocsList.find(d => d.id === id);
      if (doc) {
        btn.innerHTML = '<i class="ri-loader-4-line spin" style="font-size: 1rem;"></i>';
        const newPinned = !doc.is_pinned;
        try {
          const { error } = await supabase
            .from('service_docs')
            .update({ is_pinned: newPinned, updated_at: new Date().toISOString() })
            .eq('id', id);

          if (error) throw error;
          await loadDocsAdminData();
        } catch (err) {
          alert('Error al destacar: ' + err.message);
          await loadDocsAdminData();
        }
      }
    });
  });

  tbody.querySelectorAll('.btn-edit-doc').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openEditDocModal(id);
    });
  });

  tbody.querySelectorAll('.btn-delete-doc').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const path = btn.getAttribute('data-path');
      
      if (confirm('¿Estás seguro de eliminar este documento? Esta acción no se puede deshacer y borrará el archivo de almacenamiento.')) {
        btn.innerHTML = '<i class="ri-loader-4-line spin" style="font-size: 1rem;"></i>';
        try {
          if (path) {
            const { error: storageError } = await supabase.storage
              .from('service_docs')
              .remove([path]);
            if (storageError) console.warn('Aviso de Storage al borrar:', storageError);
          }

          const { error } = await supabase
            .from('service_docs')
            .delete()
            .eq('id', id);

          if (error) throw error;

          await loadDocsAdminData();
        } catch (err) {
          alert('Error al eliminar: ' + err.message);
          await loadDocsAdminData();
        }
      }
    });
  });
}

function openUploadDocModal() {
  const modal = document.getElementById('modal-doc-upload');
  const alertDiv = document.getElementById('modal-doc-upload-alert');
  const form = document.getElementById('form-doc-upload');
  
  if (alertDiv) alertDiv.style.display = 'none';
  if (form) form.reset();

  const radioUpload = document.querySelector('input[name="doc-upload-type"][value="upload"]');
  if (radioUpload) radioUpload.checked = true;
  window.toggleUploadSourceType('upload');

  const select = document.getElementById('doc-upload-folder-select');
  if (select) {
    const folders = Array.from(new Set(adminDocsList.map(d => d.folder || 'General')));
    select.innerHTML = '<option value="">-- Selecciona Carpeta --</option>';
    folders.forEach(f => {
      select.innerHTML += `<option value="${f}">${f}</option>`;
    });
  }

  if (modal) modal.classList.add('active');
}

function openEditDocModal(id) {
  const modal = document.getElementById('modal-doc-edit');
  const alertDiv = document.getElementById('modal-doc-edit-alert');
  const form = document.getElementById('form-doc-edit');
  
  if (alertDiv) alertDiv.style.display = 'none';
  if (form) form.reset();

  const doc = adminDocsList.find(d => d.id === id);
  if (!doc) return;

  document.getElementById('doc-edit-id').value = doc.id;
  document.getElementById('doc-edit-old-path').value = doc.storage_path || '';
  document.getElementById('doc-edit-name').value = doc.name;
  document.getElementById('doc-edit-desc').value = doc.description || '';
  document.getElementById('doc-edit-pinned').checked = doc.is_pinned;
  
  const currentLabel = document.getElementById('doc-edit-current-file-label');
  
  if (doc.storage_path) {
    const radioUpload = document.getElementById('radio-edit-upload');
    if (radioUpload) radioUpload.checked = true;
    window.toggleEditSourceType('upload');
    if (currentLabel) {
      currentLabel.innerHTML = `Archivo actual cargado.`;
    }
    const urlInput = document.getElementById('doc-edit-url');
    if (urlInput) urlInput.value = '';
  } else {
    const radioUrl = document.getElementById('radio-edit-url');
    if (radioUrl) radioUrl.checked = true;
    window.toggleEditSourceType('url');
    if (currentLabel) {
      currentLabel.innerHTML = '';
    }
    const urlInput = document.getElementById('doc-edit-url');
    if (urlInput) urlInput.value = doc.file_url || '';
  }

  const select = document.getElementById('doc-edit-folder-select');
  if (select) {
    const folders = Array.from(new Set(adminDocsList.map(d => d.folder || 'General')));
    select.innerHTML = '<option value="">-- Selecciona Carpeta --</option>';
    folders.forEach(f => {
      const selected = f === doc.folder ? 'selected' : '';
      select.innerHTML += `<option value="${f}" ${selected}>${f}</option>`;
    });
  }

  if (modal) modal.classList.add('active');
}

document.addEventListener('submit', async (e) => {
  if (e.target && e.target.id === 'form-doc-upload') {
    e.preventDefault();
    const alertDiv = document.getElementById('modal-doc-upload-alert');
    const submitBtn = document.getElementById('btn-submit-doc-upload');
    
    if (alertDiv) alertDiv.style.display = 'none';
    
    const name = document.getElementById('doc-upload-name').value.trim();
    const desc = document.getElementById('doc-upload-desc').value.trim();
    const selFolder = document.getElementById('doc-upload-folder-select').value;
    const newFolder = document.getElementById('doc-upload-folder-new').value.trim();
    const fileInput = document.getElementById('doc-upload-file');
    const isPinned = document.getElementById('doc-upload-pinned').checked;
    const uploadType = document.querySelector('input[name="doc-upload-type"]:checked').value;

    const folder = newFolder || selFolder || 'General';

    submitBtn.disabled = true;
    submitBtn.textContent = 'Procesando...';

    try {
      let fileUrl = '';
      let storagePath = null;

      if (uploadType === 'upload') {
        const file = fileInput.files[0];
        if (!file) {
          throw new Error('Por favor, selecciona un archivo para subir.');
        }
        
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        storagePath = `docs/${Date.now()}_${sanitizedName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('service_docs')
          .upload(storagePath, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('service_docs')
          .getPublicUrl(storagePath);

        fileUrl = urlData.publicUrl;
      } else {
        fileUrl = document.getElementById('doc-upload-url').value.trim();
        if (!fileUrl) {
          throw new Error('Por favor, ingresa la URL del documento online.');
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;

      const { error: dbError } = await supabase
        .from('service_docs')
        .insert({
          name: name,
          description: desc,
          file_url: fileUrl,
          storage_path: storagePath,
          folder: folder,
          is_pinned: isPinned,
          updated_by: userId
        });

      if (dbError) throw dbError;

      document.getElementById('modal-doc-upload').classList.remove('active');
      await loadDocsAdminData();

    } catch (err) {
      console.error('Error uploading document:', err);
      if (alertDiv) {
        alertDiv.textContent = 'Error: ' + err.message;
        alertDiv.style.display = 'block';
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Subir Archivo';
    }
  }

  if (e.target && e.target.id === 'form-doc-edit') {
    e.preventDefault();
    const alertDiv = document.getElementById('modal-doc-edit-alert');
    const submitBtn = document.getElementById('btn-submit-doc-edit');
    
    if (alertDiv) alertDiv.style.display = 'none';

    const id = document.getElementById('doc-edit-id').value;
    const oldPath = document.getElementById('doc-edit-old-path').value;
    const name = document.getElementById('doc-edit-name').value.trim();
    const desc = document.getElementById('doc-edit-desc').value.trim();
    const selFolder = document.getElementById('doc-edit-folder-select').value;
    const newFolder = document.getElementById('doc-edit-folder-new').value.trim();
    const fileInput = document.getElementById('doc-edit-file');
    const isPinned = document.getElementById('doc-edit-pinned').checked;
    const editType = document.querySelector('input[name="doc-edit-type"]:checked').value;

    const folder = newFolder || selFolder || 'General';

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    try {
      let fileUrl = null;
      let storagePath = oldPath || null;

      const doc = adminDocsList.find(d => d.id === id);
      if (doc) {
        fileUrl = doc.file_url;
      }

      if (editType === 'upload') {
        const newFile = fileInput.files[0];
        if (newFile) {
          const sanitizedName = newFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          storagePath = `docs/${Date.now()}_${sanitizedName}`;

          const { error: uploadError } = await supabase.storage
            .from('service_docs')
            .upload(storagePath, newFile);

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from('service_docs')
            .getPublicUrl(storagePath);

          fileUrl = urlData.publicUrl;

          if (oldPath) {
            await supabase.storage.from('service_docs').remove([oldPath]);
          }
        }
      } else {
        fileUrl = document.getElementById('doc-edit-url').value.trim();
        if (!fileUrl) {
          throw new Error('Por favor, ingresa la URL del documento online.');
        }
        if (oldPath) {
          await supabase.storage.from('service_docs').remove([oldPath]);
          storagePath = null;
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;

      const updateData = {
        name: name,
        description: desc,
        folder: folder,
        is_pinned: isPinned,
        updated_at: new Date().toISOString(),
        updated_by: userId,
        file_url: fileUrl,
        storage_path: storagePath
      };

      const { error: dbError } = await supabase
        .from('service_docs')
        .update(updateData)
        .eq('id', id);

      if (dbError) throw dbError;

      document.getElementById('modal-doc-edit').classList.remove('active');
      await loadDocsAdminData();

    } catch (err) {
      console.error('Error updating document:', err);
      if (alertDiv) {
        alertDiv.textContent = 'Error: ' + err.message;
        alertDiv.style.display = 'block';
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar Cambios';
    }
  }
});

