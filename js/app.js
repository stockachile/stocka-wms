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

// Formateador de moneda en pesos chilenos (CLP)
window.formatCLP = function(value) {
  if (value === null || value === undefined || isNaN(value) || value === '') {
    return '-';
  }
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(value);
};

// Capturador de errores global para depuración en tiempo real
window.onerror = function (message, source, lineno, colno, error) {
  alert(`Error detectado en app.js:\n${message}\n\nArchivo: ${source}\nLínea: ${lineno}:${colno}`);
  return false;
};
window.onunhandledrejection = function (event) {
  alert(`Error de Promesa no manejada en app.js:\n${event.reason}`);
};

console.log('DEBUG: Iniciando js/app.js...');

let userRole = 'observer';
let currentMerchantId = null;
let currentCompany = null;

// Global state for calendar component
window.appCalendarState = {
  currentDate: new Date(),
  events: [],
  selectedDateStr: null
};

function getCompanyList() {
  const companyList = [];
  if (currentCompany) {
    currentCompany.split(',').forEach(c => {
      const trimmed = c.trim();
      if (trimmed) {
        companyList.push(trimmed);
        companyList.push(trimmed.toLowerCase());
        companyList.push(trimmed.toUpperCase());
      }
    });
  }
  return companyList;
}

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

function applyVisibilityRulesToQuery(query, rules) {
  if (rules && rules.length > 0) {
    rules.forEach(rule => {
      const rCourier = rule.courier;
      const rStatus = rule.status;

      if (rCourier && rStatus) {
        query = query.or(`courier.neq."${rCourier}",status.neq."${rStatus}"`);
      } else if (rCourier) {
        query = query.neq('courier', rCourier);
      } else if (rStatus) {
        query = query.neq('status', rStatus);
      }
    });
  }
  return query;
}

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
      .select('role, company_name, full_name, comercio, allowed_modules')
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

    // Check system banners and popups
    if (typeof window.checkSystemCommunications === 'function') {
      window.checkSystemCommunications(currentMerchantId);
    }

    // Navigation Logic Setup
    if (navItems) {
      navItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          navItems.forEach(n => n.classList.remove('active'));
          e.target.classList.add('active');

          const view = e.target.getAttribute('data-view');
          
          if (view === 'dashboard') {
            viewTitle.textContent = 'Dashboard';
            renderDashboard();
          } else if (view === 'inventory') {
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
          } else if (view === 'returns') {
            viewTitle.textContent = 'Logística Inversa';
            renderReturns();
          } else if (view === 'pickups') {
            viewTitle.textContent = 'Punto de Retiro';
            renderPickups();
          } else if (view === 'sales') {
            viewTitle.textContent = 'Punto de Ventas';
            renderSales();
          } else if (view === 'integrations') {
            viewTitle.textContent = 'Integraciones';
            renderIntegrations();
          } else if (view === 'declarations') {
            viewTitle.textContent = 'Ingresos de Stock';
            renderDeclarations();
          } else if (view === 'profile') {
            viewTitle.textContent = 'Mi Perfil';
            renderProfile();
          }
        });
      });
    }

    // Filter Navigation based on allowed_modules for Clients
    const allowedModulesStr = profile?.allowed_modules || 'all';
    let allowedModules = [];
    let firstVisibleItem = null;

    if (navItems) {
      if (allowedModulesStr !== 'all' && allowedModulesStr !== null && allowedModulesStr !== '') {
        allowedModules = allowedModulesStr.split(',').map(m => m.trim());
        
        navItems.forEach(item => {
          const view = item.getAttribute('data-view');
          if (allowedModules.includes(view) || view === 'dashboard' || view === 'profile') {
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
        // Por defecto, si es 'all' todos los ítems están permitidos
        if (navItems.length > 0) firstVisibleItem = navItems[0];
      }
    }

    // Initial View selection based on allowed modules for Client
    if (firstVisibleItem) {
      const defaultView = 'dashboard';
      const isDefaultAllowed = true; // Dashboard is default for everyone
      
      if (isDefaultAllowed) {
        console.log('DEBUG: Renderizando vista inicial Dashboard...');
        viewTitle.textContent = 'Dashboard';
        renderDashboard();
      } else {
        console.log('DEBUG: Vista de inventario restringida, seleccionando primer módulo permitido:', firstVisibleItem.getAttribute('data-view'));
        firstVisibleItem.click();
      }
    } else {
      const appContent = document.getElementById('app-content');
      appContent.innerHTML = `<div class="card" style="padding: 2rem; text-align: center;"><p style="color: var(--color-text-muted);">No tienes módulos asignados. Contacta a un administrador para obtener acceso.</p></div>`;
      viewTitle.textContent = 'Sin Acceso';
    }

    // Logout Logic
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        console.log('DEBUG: Cerrando sesión...');
        await supabase.auth.signOut();
        window.location.href = 'index.html';
      });
    }

    // Notification Logic
    initNotifications(session.user.id);

  } catch (err) {
    console.error('DEBUG: Error crítico durante la inicialización de app.js:', err);
  }
}

// Ejecutar inicialización
init();

// Supabase Rendering Functions

// Helper para notificaciones
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
      if (!currentMerchantId) return;
      // Fetch user's read records
      const { data: readRecords } = await supabase.from('user_notification_reads').select('entity_id').eq('user_id', currentMerchantId).eq('entity_type', 'notification');
      const readIds = readRecords ? readRecords.map(r => r.entity_id) : [];

      const rolesToMatch = ['all', userRole];
      const { data, error } = await supabase.from('dashboard_notifications').select('*').order('created_at', { ascending: false }).limit(30);
      if (error) throw error;

      const filteredData = data ? data.filter(n => {
        return (rolesToMatch.includes(n.target_role) && !n.user_id) || n.user_id === currentMerchantId;
      }) : [];

      if (!filteredData || filteredData.length === 0) {
        list.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">No tienes notificaciones.</div>';
        badge.style.display = 'none';
        markReadBtn.style.display = 'none';
        return;
      }

      const unreadCount = filteredData.filter(n => !readIds.includes(n.id)).length;
      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'flex';
        markReadBtn.style.display = 'block';
      } else {
        badge.style.display = 'none';
        markReadBtn.style.display = 'none';
      }

      list.innerHTML = filteredData.map(n => {
        const isReadLocally = readIds.includes(n.id);
        return `
        <div class="notification-item ${isReadLocally ? '' : 'unread'}" data-id="${n.id}" style="position: relative; padding-right: 2.5rem;">
          <div class="notification-title">${n.title}</div>
          <div class="notification-message">${n.message}</div>
          <span class="notification-time">${new Date(n.created_at).toLocaleString()}</span>
          <button ${isReadLocally ? 'disabled' : ''} class="mark-read-single-btn" data-id="${n.id}" title="${isReadLocally ? 'Notificación leída' : 'Marcar como leída'}" style="position: absolute; right: 0.75rem; top: 1rem; background: none; border: none; color: ${isReadLocally ? 'var(--color-text-muted)' : 'var(--color-primary)'}; cursor: ${isReadLocally ? 'default' : 'pointer'}; opacity: ${isReadLocally ? '0.4' : '1'}; transition: all 0.2s;"><i class="ri-check-double-line" style="font-size: 1.25rem;"></i></button>
        </div>
      `}).join('');

      document.querySelectorAll('.mark-read-single-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          await supabase.from('user_notification_reads').insert([{ user_id: currentMerchantId, entity_type: 'notification', entity_id: id }]);
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
        const unreadItems = document.querySelectorAll('.notification-item.unread');
        const inserts = Array.from(unreadItems).map(item => ({
          user_id: currentMerchantId,
          entity_type: 'notification',
          entity_id: item.getAttribute('data-id')
        }));
        if(inserts.length > 0) {
          await supabase.from('user_notification_reads').insert(inserts);
          fetchNotifications();
        }
      } catch(err) { console.error(err); }
    });
  }

  fetchNotifications();
  // Set interval to poll notifications every 2 minutes
  setInterval(fetchNotifications, 120000);
}

// Render Dashboard
async function renderDashboard() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = '<p class="text-center" style="padding: 2rem;">Cargando dashboard...</p>';

  try {
    // Obtener estadísticas rápidas
    const companyList = getCompanyList();
    let invQuery = supabase.from('inventory').select('quantity, committed_quantity');
    let ordQuery = supabase.from('orders').select('id, status');
    
    if (companyList.length > 0) {
      invQuery = supabase.from('inventory').select('quantity, committed_quantity, products!inner(comercio)').in('products.comercio', companyList);
      ordQuery = ordQuery.in('comercio', companyList);
    } else {
      invQuery = supabase.from('inventory').select('quantity, committed_quantity, products!inner(comercio)').eq('products.comercio', 'no asignado');
      ordQuery = ordQuery.eq('comercio', 'no asignado');
    }

    const [invRes, ordRes] = await Promise.all([invQuery, ordQuery]);

    let totalStock = 0;
    let availableStock = 0;
    if (invRes.data) {
      invRes.data.forEach(i => {
        totalStock += i.quantity;
        availableStock += (i.quantity - i.committed_quantity);
      });
    }

    let activeOrders = 0;
    let completedOrders = 0;
    if (ordRes.data) {
      ordRes.data.forEach(o => {
        if (['en preparación', 'para procesar', 'preparado'].includes(o.status)) activeOrders++;
        if (['despachado', 'entregado', 'retirado'].includes(o.status)) completedOrders++;
      });
    }

    // Obtener Noticias (El calendario se carga asíncronamente)
    const { data: news, error: newsErr } = await supabase.from('dashboard_news').select('*').order('created_at', { ascending: false });

    let newsHtml = '';
    if (!news || news.length === 0) {
      newsHtml = '<div style="padding: 1.5rem; text-align: center; color: var(--color-text-muted);">No hay noticias recientes.</div>';
    } else {
      newsHtml = news.map(n => `
        <div class="dashboard-list-item" style="flex-direction: column; gap: 0.5rem;">
          <div class="item-content" style="width: 100%;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <h4 style="margin:0;">${n.title}</h4>
              <span style="font-size: 0.7rem; color: var(--color-text-muted);">${new Date(n.created_at).toLocaleDateString()}</span>
            </div>
            ${n.subtitle ? `<div style="font-size: 0.85rem; font-weight: 600; color: var(--color-primary); margin-bottom: 0.5rem;">${n.subtitle}</div>` : ''}
            <p style="-webkit-line-clamp: 3;">${n.body}</p>
          </div>
        </div>
      `).join('');
    }

    appContent.innerHTML = getObserverBanner() + `
      <div class="dashboard-hero">
        <h2>Te damos la bienvenida al WMS 3.0 de Stocka</h2>
        <p>Un nuevo centro de operaciones para la gestión de tu comercio, con la información centralizada, integraciones y más! Nos encontramos en pleno desarrollo y pronto lanzaremos nuevas novedades.</p>
      </div>

      <div style="margin-bottom: 2rem;">
        <h3 style="margin-bottom: 1rem; font-size: 1.25rem;">Métricas Principales</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem;">
          <div class="stat-card stat-card-blue">
            <i class="ri-box-3-line stat-icon"></i>
            <div>
              <div class="stat-value">${totalStock}</div>
              <div class="stat-label">Stock Físico Total</div>
            </div>
          </div>
          <div class="stat-card stat-card-green">
            <i class="ri-check-double-line stat-icon"></i>
            <div>
              <div class="stat-value">${availableStock}</div>
              <div class="stat-label">Stock Disponible</div>
            </div>
          </div>
          <div class="stat-card stat-card-yellow">
            <i class="ri-time-line stat-icon"></i>
            <div>
              <div class="stat-value">${activeOrders}</div>
              <div class="stat-label">Pedidos en Proceso</div>
            </div>
          </div>
          <div class="stat-card stat-card-purple">
            <i class="ri-truck-line stat-icon"></i>
            <div>
              <div class="stat-value">${completedOrders}</div>
              <div class="stat-label">Pedidos Completados</div>
            </div>
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card" style="display: flex; flex-direction: column;">
          <div class="card-header flex justify-between items-center" style="border-bottom: 1px solid var(--color-border); padding-bottom: 1rem;">
            <h3 style="margin: 0;"><i class="ri-calendar-event-line" style="margin-right: 0.5rem; color: var(--color-primary);"></i> Calendario de Operaciones</h3>
          </div>
          <div class="card-body" style="padding: 0; flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 0;">
            <div id="calendar-grid-container" style="border-right: 1px solid var(--color-border); min-height: 380px; display: flex; align-items: center; justify-content: center; flex-direction: column;">
              <div style="color: var(--color-text-muted); font-size: 0.9rem;"><i class="ri-loader-4-line ri-spin" style="margin-right: 0.5rem;"></i> Cargando calendario...</div>
            </div>
            <div id="calendar-list-container" style="min-height: 380px;">
            </div>
          </div>
        </div>

        <div class="card" style="display: flex; flex-direction: column;">
          <div class="card-header flex justify-between items-center" style="border-bottom: 1px solid var(--color-border); padding-bottom: 1rem;">
            <h3 style="margin: 0;"><i class="ri-newspaper-line" style="margin-right: 0.5rem; color: var(--color-accent);"></i> Noticias del Sistema</h3>
          </div>
          <div class="card-body" style="padding: 0; flex: 1;">
            ${newsHtml}
          </div>
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error rendering dashboard:', error);
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar el dashboard: ${error.message}</p>`;
  }

  // Load dynamic calendar data
  if (typeof window.updateCalendarView_app === 'function') {
    window.updateCalendarView_app();
  }
}

window.updateCalendarView_app = async function() {
  const startOfMonth = new Date(window.appCalendarState.currentDate.getFullYear(), window.appCalendarState.currentDate.getMonth(), 1).toISOString();
  
  const { data: events } = await supabase
    .from('dashboard_events')
    .select('*')
    .gte('event_date', startOfMonth)
    .order('event_date', { ascending: true });
    
  window.appCalendarState.events = events || [];
  
  const gridContainer = document.getElementById('calendar-grid-container');
  const listContainer = document.getElementById('calendar-list-container');
  
  if (gridContainer && listContainer && window.renderCalendarUI) {
    gridContainer.style.display = 'block'; // reset flex used for loader
    gridContainer.innerHTML = window.renderCalendarUI(window.appCalendarState.events, window.appCalendarState.currentDate, window.appCalendarState.selectedDateStr);
    listContainer.innerHTML = window.renderEventsListUI(window.appCalendarState.events, window.appCalendarState.selectedDateStr);
    window.setupCalendarListeners_app();
  }
};

window.setupCalendarListeners_app = function() {
  const prevBtn = document.getElementById('cal-prev-month');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      window.appCalendarState.currentDate.setMonth(window.appCalendarState.currentDate.getMonth() - 1);
      window.appCalendarState.selectedDateStr = null;
      window.updateCalendarView_app();
    });
  }
  
  const nextBtn = document.getElementById('cal-next-month');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      window.appCalendarState.currentDate.setMonth(window.appCalendarState.currentDate.getMonth() + 1);
      window.appCalendarState.selectedDateStr = null;
      window.updateCalendarView_app();
    });
  }

  document.querySelectorAll('.cal-day-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.getAttribute('data-date');
      if (window.appCalendarState.selectedDateStr === dateStr) {
        window.appCalendarState.selectedDateStr = null; // toggle off
      } else {
        window.appCalendarState.selectedDateStr = dateStr;
      }
      
      const gridContainer = document.getElementById('calendar-grid-container');
      const listContainer = document.getElementById('calendar-list-container');
      if (gridContainer && listContainer && window.renderCalendarUI) {
        gridContainer.innerHTML = window.renderCalendarUI(window.appCalendarState.events, window.appCalendarState.currentDate, window.appCalendarState.selectedDateStr);
        listContainer.innerHTML = window.renderEventsListUI(window.appCalendarState.events, window.appCalendarState.selectedDateStr);
        window.setupCalendarListeners_app();
      }
    });
  });
};

async function renderInventory() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando inventario...</p>`;

  try {
    const companyList = getCompanyList();
    let query = supabase
      .from('inventory')
      .select(`
        quantity,
        committed_quantity,
        products!inner (sku, name, comercio),
        warehouses (name)
      `);

    if (companyList.length > 0) {
      query = query.in('products.comercio', companyList);
    } else {
      query = query.eq('products.comercio', 'no asignado');
    }

    const { data: inventory, error } = await query;

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
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar el inventario: ${error.message}</p>`;
  }
}

async function renderMovements() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando movimientos...</p>`;

  try {
    const companyList = getCompanyList();
    let query = supabase
      .from('movements')
      .select(`
        date,
        type,
        quantity,
        products!inner (sku, comercio),
        warehouses (name)
      `);

    if (companyList.length > 0) {
      query = query.in('products.comercio', companyList);
    } else {
      query = query.eq('products.comercio', 'no asignado');
    }

    query = query.order('date', { ascending: false });

    const { data: movements, error } = await query;

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

    appContent.innerHTML = getObserverBanner() + `
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
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar los movimientos.</p>`;
  }
}

async function renderWarehouses() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando bodegas...</p>`;

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
              <span style="font-size: 1.5rem;"><i class="ri-building-2-line"></i></span> ${w.name}
            </h4>
            <p style="font-size: 0.875rem; color: var(--color-text-muted); margin-bottom: 1rem;">${w.location || 'Sin ubicación'}</p>
          </div>
        `;
      });
    }

    appContent.innerHTML = getObserverBanner() + `
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
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar las bodegas.</p>`;
  }
}

async function renderOrders() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando pedidos...</p>`;

  try {
    const companyList = getCompanyList();
    let query = supabase
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
        comercio,
        total_value,
        order_items (quantity, products(sku, name))
      `);

    if (companyList.length > 0) {
      query = query.in('comercio', companyList);
    } else {
      query = query.eq('comercio', 'no asignado');
    }

    query = query.order('created_at', { ascending: false });

    const { data: orders, error } = await query;

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
      rowsHtml = `<tr><td colspan="10" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay pedidos registrados.</td></tr>`;
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

        const platform = order.origen || order.external_platform || 'Manual';
        const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : (platform === 'Falabella' ? '#84cc16' : (platform === 'MercadoLibre' ? '#f59e0b' : '#6b7280')));
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

        // Datos de despacho para la fila
        const firstShipment = orderShipments[0] || null;
        const totalItems = order.order_items?.reduce((s, i) => s + (i.quantity || 1), 0) || order.cantidad || '-';

        // Tipo de despacho legible
        const rawTipo = firstShipment?.servicio_tipo_envio || order.shipping_type || '';
        let tipoIcon = 'ri-truck-line';
        let tipoLabel = rawTipo || '-';
        if (/flex/i.test(rawTipo))          { tipoIcon = 'ri-flashlight-line';   tipoLabel = 'Flex'; }
        else if (/centro.*env/i.test(rawTipo) || /fulfillment/i.test(rawTipo)) { tipoIcon = 'ri-building-2-line';  tipoLabel = 'Centro Envíos'; }
        else if (/same.?day/i.test(rawTipo) || /24/i.test(rawTipo))            { tipoIcon = 'ri-time-line';         tipoLabel = 'Same Day'; }
        else if (/retiro/i.test(rawTipo) || /pickup/i.test(rawTipo))           { tipoIcon = 'ri-store-line';        tipoLabel = 'Retiro'; }
        else if (/normal/i.test(rawTipo))   { tipoIcon = 'ri-ship-line';         tipoLabel = 'Normal'; }
        const tipoHtml = rawTipo
          ? `<span style="display:inline-flex; align-items:center; gap:0.3rem; font-size:0.75rem; color:var(--color-text-main);"><i class="${tipoIcon}" style="color:var(--color-primary);"></i>${tipoLabel}</span>`
          : `<span style="color:var(--color-text-muted); font-size:0.78rem;">-</span>`;

        // SLA: días desde creación hasta ahora (o hasta entrega si existe)
        const createdAt = new Date(order.created_at);
        const slaRef = firstShipment?.promised_date || firstShipment?.date_closed || null;
        let slaHtml = `<span style="color:var(--color-text-muted); font-size:0.78rem;">-</span>`;
        if (slaRef) {
          const slaDate = new Date(slaRef);
          const diffDays = Math.round((slaDate - createdAt) / (1000 * 60 * 60 * 24));
          const slaColor = diffDays <= 1 ? '#059669' : (diffDays <= 3 ? '#d97706' : '#dc2626');
          slaHtml = `<span style="font-size:0.78rem; font-weight:600; color:${slaColor};">${diffDays}d</span>`;
        } else if (firstShipment?.servicio_tipo_envio) {
          // Mostrar SLA implícito según tipo
          const slaMap = { flex:'<1d', 'same day':'<1d', '24':'1d', normal:'3-5d', fulfillment:'2d' };
          const match = Object.keys(slaMap).find(k => rawTipo.toLowerCase().includes(k));
          slaHtml = match ? `<span style="font-size:0.75rem; color:var(--color-text-muted);">${slaMap[match]}</span>` : slaHtml;
        }

        rowsHtml += `
          <tr class="clickable-row" data-order-id="${order.id}" style="transition: background-color 0.15s;">
            <td>
              <div style="display:flex; flex-direction:column; gap:0.2rem;">
                <span style="font-family:monospace; font-size:0.82rem; background:var(--color-bg); padding:0.2rem 0.45rem; border-radius:var(--radius-sm); border:1px solid var(--color-border); letter-spacing:0.4px; font-weight:600;">${order.external_order_number || order.id.split('-')[0]}</span>
                ${order.external_order_number ? `<span style="font-size:0.7rem; color:var(--color-text-muted);">${order.id.split('-')[0]}</span>` : ''}
              </div>
            </td>
            <td>${originHtml}</td>
            <td style="white-space:nowrap; color:var(--color-text-muted); font-size:0.82rem;">
              <i class="ri-calendar-line" style="margin-right:0.25rem;"></i>${dateStr}
            </td>
            <td style="text-align:center;">
              <span style="font-size:1rem; font-weight:700; color:var(--color-text-main);">${totalItems}</span>
              <span style="display:block; font-size:0.68rem; color:var(--color-text-muted);">artículo${totalItems !== 1 ? 's' : ''}</span>
            </td>
            <td style="text-align:right; font-weight:700; color:var(--color-text-main); white-space:nowrap;">
              ${window.formatCLP(order.total_value)}
            </td>
            <td>${tipoHtml}</td>
            <td>${slaHtml}</td>
            <td>${labelHtml}</td>
            <td>
              <span style="background-color:${badgeColor}; color:${badgeTextColor}; padding:0.2rem 0.65rem; border-radius:99px; font-size:0.72rem; font-weight:700; white-space:nowrap; display:inline-block;">${order.status}</span>
            </td>
            <td>
              <button class="btn-order-detail btn btn-outline" data-order-id="${order.id}" style="padding:0.2rem 0.65rem; font-size:0.75rem; display:inline-flex; align-items:center; gap:0.3rem; white-space:nowrap;">
                <i class="ri-eye-line"></i> Ver detalle
              </button>
            </td>
          </tr>
        `;
      });
    }
    const isObserver = userRole === 'observer';
    const actionBtn = isObserver ? '' : '<button class="btn btn-primary" id="btn-new-order"><i class="ri-add-line"></i> Crear Pedido</button>';

    appContent.innerHTML = getObserverBanner() + `
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <div>
            <h3 style="margin:0;">Mis Pedidos</h3>
            <span style="font-size:0.8rem; color:var(--color-text-muted); margin-top:0.2rem; display:block;">${orders?.length || 0} pedidos encontrados</span>
          </div>
          ${actionBtn}
        </div>
        <div class="card-body" style="padding:0;">
          <div style="overflow-x:auto;">
            <table class="data-table" style="min-width:600px;">
              <thead>
                <tr>
                  <th style="min-width:140px;">ID Pedido</th>
                  <th>Origen</th>
                  <th>Fecha</th>
                  <th style="text-align:center;">Artículos</th>
                  <th style="text-align:right;">Valor Total</th>
                  <th>Tipo Despacho</th>
                  <th>SLA</th>
                  <th>Etiqueta</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Slide-over overlay para detalle de pedido -->
      <div class="slide-over-overlay" id="order-detail-overlay">
        <div class="slide-over-panel" id="order-detail-panel">
          <div class="slide-over-header">
            <h3><i class="ri-shopping-bag-3-line" style="color:var(--color-primary);"></i> Detalle del Pedido</h3>
            <button class="slide-over-close" id="btn-close-order-detail">&times;</button>
          </div>
          <div class="slide-over-body" id="order-detail-body">
            <div style="text-align:center; padding:3rem; color:var(--color-text-muted);">
              <i class="ri-loader-4-line" style="font-size:2rem;"></i>
              <p>Cargando...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cerrar panel
    document.getElementById('btn-close-order-detail')?.addEventListener('click', () => {
      document.getElementById('order-detail-overlay').classList.remove('active');
    });
    document.getElementById('order-detail-overlay')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('order-detail-overlay')) {
        document.getElementById('order-detail-overlay').classList.remove('active');
      }
    });

    // Botones Ver detalle
    document.querySelectorAll('.btn-order-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const orderId = btn.getAttribute('data-order-id');
        const order = orders.find(o => o.id === orderId);
        if (!order) return;
        renderOrderDetailPanel(order, shipments);
        document.getElementById('order-detail-overlay').classList.add('active');
      });
    });

  } catch (error) {
    console.error('Error fetching orders:', error);
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar pedidos.</p>`;
  }
}

function renderOrderDetailPanel(order, allShipments) {
  const body = document.getElementById('order-detail-body');
  if (!body) return;

  const orderShipments = allShipments.filter(s =>
    s.pedido_referencia === order.id ||
    (order.external_order_number && s.pedido_referencia === order.external_order_number)
  );

  const platform = order.origen || order.external_platform || 'Manual';
  const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : (platform === 'Falabella' ? '#84cc16' : (platform === 'MercadoLibre' ? '#f59e0b' : '#6b7280')));
  const dateStr = new Date(order.created_at).toLocaleString('es-CL');

  // Items HTML
  const itemsHtml = (order.order_items && order.order_items.length > 0)
    ? order.order_items.map(oi => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.65rem 1.25rem; border-bottom:1px solid var(--color-border); gap:1rem;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.85rem; font-weight:600; color:var(--color-text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${oi.products?.name || oi.item_name || 'Producto'}</div>
            <div style="font-size:0.72rem; color:var(--color-text-muted); margin-top:0.15rem; font-family:monospace;">${oi.products?.sku || oi.sku || '-'}</div>
          </div>
          <div style="flex-shrink:0; text-align:right;">
            <span style="font-size:0.78rem; color:var(--color-text-muted);">Cant.</span>
            <span style="font-size:0.95rem; font-weight:700; color:var(--color-text-main); margin-left:0.3rem;">${oi.quantity || 1}</span>
          </div>
        </div>
      `).join('')
    : `<div style="padding:1.25rem; color:var(--color-text-muted); font-size:0.85rem; text-align:center;">Sin ítems registrados.</div>`;

  // Tracking HTML
  const trackingSection = orderShipments.length > 0 ? orderShipments.map(s => `
    <div class="detail-info-row">
      <span class="detail-info-label">Courier</span>
      <span class="detail-info-value">${s.courier || '-'}</span>
    </div>
    <div class="detail-info-row">
      <span class="detail-info-label">Tracking</span>
      <span class="detail-info-value">
        ${s.tracking
          ? (s.tracking_url && s.tracking_url !== 'N/A'
              ? `<a href="${s.tracking_url}" target="_blank" style="color:var(--color-primary); font-weight:600; display:inline-flex; align-items:center; gap:0.25rem;"><i class="ri-external-link-line"></i> ${s.tracking}</a>`
              : `<span style="font-weight:600;">${s.tracking}</span>`)
          : '-'}
      </span>
    </div>
    <div class="detail-info-row">
      <span class="detail-info-label">Estado despacho</span>
      <span class="detail-info-value"><span style="background:rgba(99,102,241,0.12); color:var(--color-accent); padding:0.2rem 0.6rem; border-radius:99px; font-size:0.75rem; font-weight:700;">${s.status || '-'}</span></span>
    </div>
  `).join('<div style="height:0.5rem;"></div>') : `
    <div style="padding:1rem 1.25rem; color:var(--color-text-muted); font-size:0.82rem;">Sin despachos asociados.</div>
  `;

  body.innerHTML = `
    <!-- Header info del pedido -->
    <div style="display:flex; align-items:center; justify-content:space-between; padding:0.75rem 0; gap:1rem; flex-wrap:wrap;">
      <div>
        <div style="font-family:monospace; font-size:1rem; font-weight:700; color:var(--color-text-main);">${order.external_order_number || order.id.split('-')[0]}</div>
        ${order.external_order_number ? `<div style="font-size:0.7rem; color:var(--color-text-muted);">${order.id.split('-')[0]}</div>` : ''}
      </div>
      <span style="background-color:${getBadgeColor(order.status).bg}; color:${getBadgeColor(order.status).text}; padding:0.25rem 0.75rem; border-radius:99px; font-size:0.75rem; font-weight:700;">${order.status}</span>
    </div>

    <!-- Sección: Info general -->
    <div class="shipment-detail-section">
      <h4 class="shipment-detail-title"><i class="ri-file-list-3-line"></i> Información General</h4>
      <div class="detail-info-row">
        <span class="detail-info-label">Origen</span>
        <span class="detail-info-value"><span style="background-color:${platformColor}20; color:${platformColor}; padding:0.15rem 0.6rem; border-radius:4px; font-size:0.75rem; font-weight:700;">${platform}</span></span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Fecha creación</span>
        <span class="detail-info-value">${dateStr}</span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Comercio</span>
        <span class="detail-info-value">${order.comercio || '-'}</span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Valor Total</span>
        <span class="detail-info-value" style="font-weight: 700; color: var(--color-text-main);">${window.formatCLP(order.total_value)}</span>
      </div>
      ${order.notes ? `<div class="detail-info-row"><span class="detail-info-label">Notas</span><span class="detail-info-value" style="font-style:italic;">${order.notes}</span></div>` : ''}
    </div>

    <!-- Sección: Despacho -->
    <div class="shipment-detail-section">
      <h4 class="shipment-detail-title"><i class="ri-truck-line"></i> Despacho</h4>
      ${trackingSection}
    </div>

    <!-- Sección: Ítems -->
    <div class="shipment-detail-section">
      <h4 class="shipment-detail-title"><i class="ri-shopping-cart-line"></i> Ítems del Pedido</h4>
      ${itemsHtml}
      <div style="padding:0.6rem 1.25rem; background:var(--color-surface-hover); border-top:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:0.78rem; color:var(--color-text-muted);">Total ítems</span>
        <span style="font-weight:700; font-size:0.9rem;">${order.order_items?.reduce((s,i) => s + (i.quantity||1), 0) || '-'} unidades</span>
      </div>
    </div>
  `;
}

function getBadgeColor(status) {
  if (['despachado','entregado','retirado'].includes(status)) return { bg:'#d1fae5', text:'#065f46' };
  if (['en preparación','preparado','listo para retiro'].includes(status)) return { bg:'#fef3c7', text:'#92400e' };
  if (status === 'en tránsito') return { bg:'#e0f2fe', text:'#0369a1' };
  if (['cancelado','incidencia'].includes(status)) return { bg:'#fee2e2', text:'#991b1b' };
  if (status === 'para procesar') return { bg:'#e0e7ff', text:'#3730a3' };
  return { bg:'#f3f4f6', text:'#374151' };
}

async function renderPending() {
  const appContent = document.getElementById('app-content');
    appContent.innerHTML = getObserverBanner() + `
      <div class="card">
        <div class="card-header">
          <h3>Stock Pendiente de Asignación</h3>
        </div>
        <div class="card-body">
          <p style="color: var(--color-text-muted); margin-bottom: 1rem;">Estos productos ingresaron a la Bodega Central y están a la espera de ser distribuidos a su ubicación final o bodega sucursal por el administrador.</p>
          <div style="padding: 2rem; border: 2px dashed var(--color-border); border-radius: var(--radius-md); text-align: center; color: var(--color-text-muted);">
            <span style="font-size: 2rem; display: block; margin-bottom: 1rem;"><i class="ri-folder-open-line"></i></span>
            Actualmente no hay stock pendiente de reubicación.
          </div>
        </div>
      </div>
    `;
  }

async function renderIntegrations() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando integraciones...</p>`;

  try {
    const { data: userAuth } = await supabase.auth.getUser();
    if(!userAuth || !userAuth.user) throw new Error("No autenticado");
    const merchantId = userAuth.user.id;

    const assignedComercios = (currentCompany || '')
      .split(',')
      .map(c => c.trim())
      .filter(c => c && c.toLowerCase() !== 'no asignado');

    if (assignedComercios.length === 0) {
      appContent.innerHTML = getObserverBanner() + `
        <div class="alert alert-warning" style="display: block; margin: 2rem;">
          <i class="ri-error-warning-line"></i> No tienes comercios asociados. Debes tener al menos un comercio asignado para gestionar integraciones.
        </div>
      `;
      return;
    }

    if (!window.activeIntegrationCommerce || !assignedComercios.includes(window.activeIntegrationCommerce)) {
      window.activeIntegrationCommerce = assignedComercios[0];
    }

    // Obtener las integraciones de este comercio
    const { data: integrationsList, error: fetchErr } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('comercio', window.activeIntegrationCommerce);

    if (fetchErr) throw fetchErr;

    const shopifyIntegration = integrationsList ? integrationsList.find(i => i.platform === 'Shopify') : null;
    const parisIntegration = integrationsList ? integrationsList.find(i => i.platform === 'Paris') : null;
    const falabellaIntegration = integrationsList ? integrationsList.find(i => i.platform === 'Falabella') : null;
    const meliIntegration = integrationsList ? integrationsList.find(i => i.platform === 'MercadoLibre') : null;
    const wooIntegration = integrationsList ? integrationsList.find(i => i.platform === 'WooCommerce') : null;

    const hasShopify = !!shopifyIntegration;
    const shopUrl = hasShopify ? shopifyIntegration.shop_url : '';
    const shopifyStatusText = hasShopify 
      ? (shopifyIntegration.is_active ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-gray" style="background-color: #f3f4f6; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">No configurada</span>';

    const hasParis = !!parisIntegration;
    const parisUrl = hasParis ? parisIntegration.shop_url : 'https://api-developers.ecomm.cencosud.com';
    const parisStatusText = hasParis 
      ? (parisIntegration.is_active ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-gray" style="background-color: #f3f4f6; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">No configurada</span>';

    const hasFalabella = !!falabellaIntegration;
    const falabellaUrl = hasFalabella ? falabellaIntegration.shop_url : 'https://sellercenter-api.falabella.com';
    const falabellaUser = hasFalabella ? falabellaIntegration.username : '';
    const falabellaStatusText = hasFalabella 
      ? (falabellaIntegration.is_active ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-gray" style="background-color: #f3f4f6; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">No configurada</span>';

    const hasMeli = !!meliIntegration;
    const meliClientId = hasMeli ? (meliIntegration.client_id || '') : '';
    const meliRedirectUri = hasMeli ? (meliIntegration.shop_url || 'https://www.google.com') : 'https://www.google.com';
    const meliStatusText = hasMeli 
      ? (meliIntegration.is_active ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-gray" style="background-color: #f3f4f6; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">No configurada</span>';

    const hasWoo = !!wooIntegration;
    const wooUrl = hasWoo ? wooIntegration.shop_url : '';
    const wooStatusText = hasWoo 
      ? (wooIntegration.is_active ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-gray" style="background-color: #f3f4f6; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">No configurada</span>';

    let wooKey = '';
    let wooSecret = '';
    if (hasWoo) {
      try {
        const creds = JSON.parse(wooIntegration.access_token);
        wooKey = creds.consumer_key || '';
        wooSecret = creds.consumer_secret || '';
      } catch(e) {
        console.error("Error parsing WooCommerce credentials", e);
      }
    }

    const isObserver = userRole === 'observer';
    const disabledAttr = isObserver ? 'disabled' : '';

    const shopifyButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasShopify 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-shopify" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Tienda Shopify</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-shopify" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar Shopify</button>');

    const parisButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasParis 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-paris" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar París Marketplace</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-paris" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar París</button>');

    const falabellaButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasFalabella 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-falabella" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Falabella API</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-falabella" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar Falabella</button>');

    const meliButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasMeli 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-meli" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar MercadoLibre API</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-meli" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar MercadoLibre</button>');

    const wooButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasWoo 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-woo" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Tienda WooCommerce</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-woo" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar WooCommerce</button>');

    let selectorHtml = '';
    if (assignedComercios.length > 1) {
      selectorHtml = `
        <div style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.75rem; background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <label style="font-weight: 600; color: var(--color-text-main); font-size: 0.95rem;"><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i> Seleccionar Comercio para Integrar:</label>
          <select id="select-integration-commerce" class="form-input" style="max-width: 250px; font-weight: 600; cursor: pointer;">
            ${assignedComercios.map(c => `<option value="${c}" ${c === window.activeIntegrationCommerce ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
      `;
    } else {
      selectorHtml = `
        <div style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem; background: var(--color-surface); padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); font-size: 0.95rem;">
          <span style="color: var(--color-text-muted);"><i class="ri-store-2-line" style="margin-right: 0.25rem;"></i> Comercio Activo:</span>
          <strong style="color: var(--color-primary);">${window.activeIntegrationCommerce}</strong>
        </div>
      `;
    }

    appContent.innerHTML = getObserverBanner() + `
      <div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Integraciones Ecommerce</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          En esta sección puedes conectar WMS STOCKA con tus tiendas en línea y marketplaces. 
          Al realizar una integración, los <strong>pedidos</strong> que recibas en tu tienda se sincronizarán automáticamente con nuestro WMS para ser procesados y despachados.
        </p>
      </div>

      ${selectorHtml}

      <!-- Contenedor: una integracion por bloque -->
      <div style="display: flex; flex-direction: column; gap: 2rem;">

        <!-- SHOPIFY -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border:none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shopping-bag-3-line"></i> Shopify Integration</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasShopify ? "rgba(16, 185, 129, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasShopify ? "rgba(16, 185, 129, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasShopify ? "#10b981" : "var(--color-text-main)"};">Shopify Store</h4>
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
                  <input type="text" id="shopify-url" class="form-input" placeholder="ej. mitienda.myshopify.com" value="${shopUrl}" ${hasShopify ? "readonly" : "required"} ${disabledAttr} style="background-color: ${hasShopify || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasShopify ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Access Token (Admin API)</label>
                  <input type="password" id="shopify-token" class="form-input" placeholder="shpat_xxxxxxxxxxxxx" ${hasShopify ? "" : "required"} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Debe comenzar con <strong>shpat_</strong>.</p>
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${shopifyButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-shopping-bag-3-line" style="color: var(--color-primary);"></i></span> Guía de Integración Shopify
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Crear Aplicación Personalizada:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">En el panel de administración de tu tienda Shopify, ve a <em>Configuración &gt; Aplicaciones y canales de ventas &gt; Desarrollar aplicaciones</em>. Haz clic en el botón <strong style="color: var(--color-text-main);">Crear una aplicación</strong> y asígnale un nombre (ej: WMS STOCKA).</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Configurar Alcances de la API (Scopes):</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Haz clic en <strong style="color: var(--color-text-main);">Configurar alcances de la API del panel de control</strong>. Deberás seleccionar los permisos de <strong style="color: var(--color-text-main);">lectura y escritura</strong> (read and write) para las siguientes áreas:</p>
                  <ul style="margin: 0.5rem 0 0 0; padding-left: 1rem; color: var(--color-text-muted); font-size: 0.85rem;">
                     <li><em>Orders</em> (Pedidos)</li>
                     <li><em>Products</em> (Productos)</li>
                     <li><em>Inventory</em> (Inventario)</li>
                     <li><em>Locations</em> (Sucursales)</li>
                  </ul>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Instalar la Aplicación:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Una vez configurados los alcances, guarda los cambios y haz clic en el botón <strong style="color: var(--color-text-main);">Instalar aplicación</strong> ubicado en la parte superior derecha.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Obtener el Access Token:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Ve a la pestaña <strong style="color: var(--color-text-main);">Credenciales de la API</strong> y revela el <em>Token de acceso de la API del panel de control</em> (este token empieza con <code style="background: var(--color-bg); padding: 0.1rem 0.3rem; border-radius: 4px;">shpat_</code>). Cópialo y pégalo en el formulario de la izquierda junto con la URL de tu tienda.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- PARIS -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> París Marketplace (Cencosud)</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasParis ? "rgba(16, 185, 129, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasParis ? "rgba(16, 185, 129, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasParis ? "#10b981" : "var(--color-text-main)"};">París Store (Mirakl)</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización y aceptación automática de pedidos.</p>
                    </div>
                 </div>
                 <div>
                    ${parisStatusText}
                 </div>
              </div>
              <form id="form-paris-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de la API (Cencosud)</label>
                  <input type="text" id="paris-url" class="form-input" placeholder="ej. https://api-developers.ecomm.cencosud.com" value="${parisUrl}" ${hasParis ? "readonly" : "required"} ${disabledAttr} style="background-color: ${hasParis || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasParis ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">API Key del Vendedor</label>
                  <input type="password" id="paris-token" class="form-input" placeholder="Ingresa tu API Key de Cencosud" ${hasParis ? "" : "required"} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${parisButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración París
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Entrar al Seller Center:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Inicia sesión en tu portal de vendedor de París (Cencosud) y navega a la sección <strong style="color: var(--color-text-main);">Mi Cuenta &gt; Integraciones</strong>.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Habilitar Modo Integrador:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Activa el switch que dice <strong style="color: var(--color-text-main);">"Sí, quiero"</strong> bajo la pregunta <em>¿Quieres operar en Market Place usando un integrador?</em>.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Obtener la API Key:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Una vez activado, copia la <strong style="color: var(--color-text-main);">API Key</strong> generada. Pégala en el formulario de la izquierda.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Mapeo de SKUs:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Asegúrate de que los SKUs configurados en tus ofertas de París coincidan exactamente con los SKUs registrados en WMS STOCKA para la correcta asignación de productos en las órdenes.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- FALABELLA -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> Falabella Marketplace</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasFalabella ? "rgba(132, 204, 22, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasFalabella ? "rgba(132, 204, 22, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasFalabella ? "#84cc16" : "var(--color-text-main)"};">Falabella Store (Mirakl)</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de pedidos y descarga de etiquetas PDF.</p>
                    </div>
                 </div>
                 <div>
                    ${falabellaStatusText}
                 </div>
              </div>
              <form id="form-falabella-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de la API (Falabella)</label>
                  <input type="text" id="falabella-url" class="form-input" placeholder="ej. https://sellercenter-api.falabella.com" value="${falabellaUrl}" ${hasFalabella ? "readonly" : "required"} ${disabledAttr} style="background-color: ${hasFalabella || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">User ID / Email de Falabella</label>
                  <input type="email" id="falabella-user" class="form-input" placeholder="ej. hola@backintime.cl" value="${falabellaUser}" ${hasFalabella ? "readonly" : "required"} ${disabledAttr} style="background-color: ${hasFalabella || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasFalabella ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">API Key del Vendedor</label>
                  <input type="password" id="falabella-token" class="form-input" placeholder="Ingresa tu API Key de Falabella" ${hasFalabella ? "" : "required"} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${falabellaButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración Falabella
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Obtener Credenciales de API:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Inicia sesión en tu Seller Center de Falabella (Mirakl) y ve a la sección de configuración de perfil / API Key. Necesitarás tu <strong>User ID</strong> (email de acceso API) y la <strong>API Key</strong> correspondiente.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Configurar URL de la API:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">La URL de producción es <code style="background: var(--color-bg); padding: 0.1rem 0.3rem; border-radius: 4px;">https://sellercenter-api.falabella.com/</code>. Ingresa esta URL en el campo de la izquierda.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Mapeo de SKUs:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Asegúrate de que tus SKUs en Falabella coincidan de forma exacta con los SKUs en el WMS STOCKA para que las existencias se comprometan y descuenten automáticamente de forma correcta.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- MERCADOLIBRE -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> MercadoLibre Marketplace</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasMeli ? "rgba(245, 158, 11, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasMeli ? "rgba(245, 158, 11, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasMeli ? "#f59e0b" : "var(--color-text-main)"};">MercadoLibre Store (Official API)</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de pedidos, control logístico y descarga de etiquetas.</p>
                    </div>
                 </div>
                 <div>
                    ${meliStatusText}
                 </div>
              </div>
              <form id="form-meli-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">Client ID (App ID)</label>
                  <input type="text" id="meli-client-id" class="form-input" placeholder="ej. 34091030018433" value="${meliClientId || "34091030018433"}" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasMeli ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Client Secret (Key)</label>
                  <input type="password" id="meli-client-secret" class="form-input" placeholder="Ingresa tu Client Secret" value="EJA46V6AKIWDAWG4xQ1y14pteBWR0yGl" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">Redirect URI</label>
                  <input type="text" id="meli-redirect-uri" class="form-input" placeholder="ej. https://www.google.com" value="${meliRedirectUri || "https://www.google.com"}" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasMeli ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Código de Autorización (Authorization Code)</label>
                  <input type="password" id="meli-auth-code" class="form-input" placeholder="TG-xxxxxxxxxxxxxxxx" ${hasMeli ? "" : ""} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Requerido para nuevas integraciones (dejar vacío si migras con Refresh Token).</p>
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasMeli ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Refresh Token Existente (Opcional - Migración)</label>
                  <input type="password" id="meli-refresh-token" class="form-input" placeholder="TG-xxxxxxxxxxxxx-xxxxxxxx" ${hasMeli ? "" : ""} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Pega aquí el refreshToken obtenido de Google Sheets para migrar tu sesión activa sin re-autorizar.</p>
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${meliButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración MercadoLibre
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Obtener Código de Autorización:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">
                    Haz clic en el siguiente enlace para iniciar la autorización de la aplicación de MercadoLibre:<br>
                    <a href="https://auth.mercadolibre.cl/authorization?response_type=code&client_id=34091030018433&redirect_uri=https://www.google.com" target="_blank" style="display: inline-block; background-color: var(--color-primary); color: var(--color-dark); padding: 0.5rem 1rem; border-radius: 0.375rem; font-weight: 600; text-decoration: none; margin: 0.5rem 0; font-size: 0.85rem;">👉 Obtener Código de Autorización</a><br>
                    Inicia sesión, autoriza el acceso y copia el código que aparece en la barra de direcciones después de <strong style="color: var(--color-text-main);">code=TG-xxxxx</strong> y pégalo en el formulario de la izquierda.
                  </p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Migración directa desde Google Sheets (Alternativa):</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">
                    Si ya tenías la cuenta conectada mediante el script de Google Sheets, deja el campo de código de autorización vacío y pega directamente tu <strong>Refresh Token Existente</strong> extraído del Apps Script.
                  </p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- WOOCOMMERCE -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shopping-cart-2-line"></i> WooCommerce Integration</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasWoo ? "rgba(150, 88, 138, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasWoo ? "rgba(150, 88, 138, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasWoo ? "#96588a" : "var(--color-text-main)"};">WooCommerce Store</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de pedidos y productos.</p>
                    </div>
                 </div>
                 <div>
                    ${wooStatusText}
                 </div>
              </div>
              <form id="form-woo-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de tu tienda WooCommerce</label>
                  <input type="text" id="woo-url" class="form-input" placeholder="ej. https://mitienda.cl" value="${wooUrl}" ${hasWoo ? "readonly" : "required"} ${disabledAttr} style="background-color: ${hasWoo || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasWoo ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Consumer Key</label>
                  <input type="password" id="woo-key" class="form-input" placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="${wooKey}" ${hasWoo ? "readonly" : "required"} ${disabledAttr} style="background-color: ${hasWoo || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasWoo ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Consumer Secret</label>
                  <input type="password" id="woo-secret" class="form-input" placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="${wooSecret}" ${hasWoo ? "readonly" : "required"} ${disabledAttr} style="background-color: ${hasWoo || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${wooButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-shopping-cart-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración WooCommerce
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Habilitar SSL y Permalinks:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Asegúrate de que tu sitio tenga habilitado HTTPS y que los enlaces permanentes (Permalinks) no sean del tipo "Simple" en los ajustes de WordPress.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Generar Claves de la API:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">En tu panel de WordPress, ve a <em>WooCommerce &gt; Ajustes &gt; Avanzado &gt; API REST</em>. Haz clic en <strong style="color: var(--color-text-main);">Añadir clave</strong>.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Asignar Permisos:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Configura el acceso con permisos de <strong style="color: var(--color-text-main);">Lectura y Escritura</strong>. Copia el <em>Consumer Key</em> y el <em>Consumer Secret</em> que se generarán y pégalos en el formulario.</p>
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
            is_active: true,
            comercio: window.activeIntegrationCommerce
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
              .eq('comercio', window.activeIntegrationCommerce)
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

    // Paris Submit Listener
    if(!hasParis) {
      document.getElementById('form-paris-integration').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (userRole === 'observer') {
          alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
          return;
        }
        const btn = document.getElementById('btn-save-paris');
        btn.disabled = true;
        btn.textContent = 'Conectando...';

        const paris_url = document.getElementById('paris-url').value.trim();
        const token = document.getElementById('paris-token').value.trim();

        try {
          const { error: insErr } = await supabase.from('merchant_integrations').insert([{
            merchant_id: merchantId,
            platform: 'Paris',
            shop_url: paris_url,
            access_token: token,
            is_active: true,
            comercio: window.activeIntegrationCommerce
          }]);
          if(insErr) throw insErr;
          
          alert('Integración con París Marketplace guardada correctamente.');
          renderIntegrations(); // Recargar vista
        } catch(err) {
          console.error(err);
          alert('Error al guardar la integración: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Conectar París Marketplace';
        }
      });
    } else {
      document.getElementById('btn-disconnect-paris').addEventListener('click', async () => {
        if (userRole === 'observer') {
          alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
          return;
        }
        if(confirm('¿Estás seguro que deseas desconectar tu cuenta de París Marketplace?')) {
          try {
            const { error: delErr } = await supabase.from('merchant_integrations')
              .delete()
              .eq('comercio', window.activeIntegrationCommerce)
              .eq('platform', 'Paris');
            if(delErr) throw delErr;
            alert('Conexión con París eliminada.');
            renderIntegrations();
          } catch(err) {
             console.error(err);
             alert('Error al desconectar: ' + err.message);
          }
        }
      });
    }

    // Falabella Submit Listener
    if(!hasFalabella) {
      document.getElementById('form-falabella-integration').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (userRole === 'observer') {
          alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
          return;
        }
        const btn = document.getElementById('btn-save-falabella');
        btn.disabled = true;
        btn.textContent = 'Conectando...';

        const falabella_url = document.getElementById('falabella-url').value.trim();
        const falabella_user = document.getElementById('falabella-user').value.trim();
        const token = document.getElementById('falabella-token').value.trim();

        try {
          const { error: insErr } = await supabase.from('merchant_integrations').insert([{
            merchant_id: merchantId,
            platform: 'Falabella',
            shop_url: falabella_url,
            username: falabella_user,
            access_token: token,
            is_active: true,
            comercio: window.activeIntegrationCommerce
          }]);
          if(insErr) throw insErr;
          
          alert('Integración con Falabella guardada correctamente.');
          renderIntegrations(); // Recargar vista
        } catch(err) {
          console.error(err);
          alert('Error al guardar la integración: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Conectar Falabella API';
        }
      });
    } else {
      document.getElementById('btn-disconnect-falabella').addEventListener('click', async () => {
        if (userRole === 'observer') {
          alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
          return;
        }
        if(confirm('¿Estás seguro que deseas desconectar tu cuenta de Falabella?')) {
          try {
            const { error: delErr } = await supabase.from('merchant_integrations')
              .delete()
              .eq('comercio', window.activeIntegrationCommerce)
              .eq('platform', 'Falabella');
            if(delErr) throw delErr;
            alert('Conexión con Falabella eliminada.');
            renderIntegrations();
          } catch(err) {
             console.error(err);
             alert('Error al desconectar: ' + err.message);
          }
        }
      });
    }

    // MercadoLibre Submit Listener
    if(!hasMeli) {
      const formMeli = document.getElementById('form-meli-integration');
      if (formMeli) {
        formMeli.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (userRole === 'observer') {
            alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
            return;
          }
          const btn = document.getElementById('btn-save-meli');
          btn.disabled = true;
          btn.textContent = 'Conectando...';

          const client_id = document.getElementById('meli-client-id').value.trim();
          const client_secret = document.getElementById('meli-client-secret').value.trim();
          const redirect_uri = document.getElementById('meli-redirect-uri').value.trim();
          const auth_code = document.getElementById('meli-auth-code').value.trim();
          const refresh_token = document.getElementById('meli-refresh-token').value.trim();

          if (!auth_code && !refresh_token) {
            alert('Debes ingresar al menos el Código de Autorización (para cuenta nueva) o el Refresh Token (para migración).');
            btn.disabled = false;
            btn.textContent = 'Conectar MercadoLibre API';
            return;
          }

          try {
            const { error: insErr } = await supabase.from('merchant_integrations').insert([{
              merchant_id: merchantId,
              platform: 'MercadoLibre',
              shop_url: redirect_uri,
              client_id: client_id,
              client_secret: client_secret,
              access_token: refresh_token ? '' : auth_code, // Guardado inicialmente en access_token si no hay refresh token
              refresh_token: refresh_token || null,
              is_active: true,
              comercio: window.activeIntegrationCommerce
            }]);
            if(insErr) throw insErr;
            
            alert('Integración con MercadoLibre guardada. La sincronización se iniciará en el próximo ciclo.');
            renderIntegrations(); // Recargar vista
          } catch(err) {
            console.error(err);
            alert('Error al guardar la integración: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Conectar MercadoLibre API';
          }
        });
      }
    } else {
      const btnDisconnectMeli = document.getElementById('btn-disconnect-meli');
      if (btnDisconnectMeli) {
        btnDisconnectMeli.addEventListener('click', async () => {
          if (userRole === 'observer') {
            alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
            return;
          }
          if(confirm('¿Estás seguro que deseas desconectar tu cuenta de MercadoLibre?')) {
            try {
              const { error: delErr } = await supabase.from('merchant_integrations')
                .delete()
                .eq('comercio', window.activeIntegrationCommerce)
                .eq('platform', 'MercadoLibre');
              if(delErr) throw delErr;
              alert('Conexión con MercadoLibre eliminada.');
              renderIntegrations();
            } catch(err) {
               console.error(err);
               alert('Error al desconectar: ' + err.message);
            }
          }
        });
      }
    }

    // WooCommerce Submit Listener
    if(!hasWoo) {
      const formWoo = document.getElementById('form-woo-integration');
      if (formWoo) {
        formWoo.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (userRole === 'observer') {
            alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
            return;
          }
          const btn = document.getElementById('btn-save-woo');
          btn.disabled = true;
          btn.textContent = 'Conectando...';

          const shop_url = document.getElementById('woo-url').value.trim();
          const key = document.getElementById('woo-key').value.trim();
          const secret = document.getElementById('woo-secret').value.trim();

          const tokenJson = JSON.stringify({
            consumer_key: key,
            consumer_secret: secret
          });

          try {
            const { error: insErr } = await supabase.from('merchant_integrations').insert([{
              merchant_id: merchantId,
              platform: 'WooCommerce',
              shop_url: shop_url,
              access_token: tokenJson,
              is_active: true,
              comercio: window.activeIntegrationCommerce
            }]);
            if(insErr) throw insErr;
            
            alert('Integración con WooCommerce guardada correctamente.');
            renderIntegrations(); // Recargar vista
          } catch(err) {
            console.error(err);
            alert('Error al guardar la integración: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Conectar Tienda WooCommerce';
          }
        });
      }
    } else {
      const btnDisconnectWoo = document.getElementById('btn-disconnect-woo');
      if (btnDisconnectWoo) {
        btnDisconnectWoo.addEventListener('click', async () => {
          if (userRole === 'observer') {
            alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
            return;
          }
          if(confirm('¿Estás seguro que deseas desconectar tu tienda WooCommerce?')) {
            try {
              const { error: delErr } = await supabase.from('merchant_integrations')
                .delete()
                .eq('comercio', window.activeIntegrationCommerce)
                .eq('platform', 'WooCommerce');
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
    }

    const commerceSelect = document.getElementById('select-integration-commerce');
    if (commerceSelect) {
      commerceSelect.addEventListener('change', (e) => {
        window.activeIntegrationCommerce = e.target.value;
        renderIntegrations();
      });
    }

  } catch (error) {
    console.error('Error fetching integrations:', error);
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar las integraciones.</p>`;
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
        const companyList = getCompanyList();
        let query = supabase.from('products').select('id, name, sku');
        if (companyList.length > 0) {
          query = query.in('comercio', companyList);
        } else {
          query = query.eq('comercio', 'no asignado');
        }
        const { data: products } = await query;
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
        .insert([{
          merchant_id: merchantId,
          comercio: currentCompany ? currentCompany.split(',')[0].trim() : 'STOCKA',
          sku: sku,
          name: name,
          description: desc
        }])
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
        .insert([{
          merchant_id: merchantId,
          comercio: currentCompany ? currentCompany.split(',')[0].trim() : 'STOCKA',
          status: 'para procesar'
        }])
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
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando despachos consolidados...</p>`;

  try {
    const companyList = getCompanyList();
    
    // Obtener la lista de couriers únicos para este comercio primero
    let courierQuery = supabase
      .from('envios_unificados')
      .select('courier')
      .eq('visible_to_client', true);
    
    if (companyList.length > 0) {
      courierQuery = courierQuery.in('empresa_comercio_proveedor', companyList);
    }
    
    const { data: courierData } = await courierQuery;
    const couriers = [...new Set((courierData || []).map(s => s.courier).filter(Boolean))].sort();

    // Fetch unique status list from database
    let statusQuery = supabase
      .from('envios_unificados')
      .select('status')
      .eq('visible_to_client', true);
    if (companyList.length > 0) {
      statusQuery = statusQuery.in('empresa_comercio_proveedor', companyList);
    }
    const { data: statusData } = await statusQuery;
    const originalStatuses = [...new Set((statusData || []).map(s => s.status).filter(Boolean))].sort();

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const defaultDateFrom = `${year}-${month}-01`;
    const defaultDateTo = `${year}-${month}-${day}`;

    let allData = [];
    let filters = {
      search: '',
      statuses: [], // Array to store multiple selected original statuses
      courier: '',
      dateFrom: defaultDateFrom,
      dateTo: defaultDateTo
    };
    let sort = {
      field: 'created_at',
      asc: false
    };
    let currentPage = 1;
    const pageSize = 50;
    let totalFilteredRows = 0;

    // Render basic page wrapper with KPI grid, filters layout, and table skeleton
    appContent.innerHTML = getObserverBanner() + `
      <div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Resumen de Despachos</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          Visualiza y gestiona la información consolidada de todos tus envíos. Haz clic en un pedido para ver el detalle completo y el estado del tránsito.
        </p>
      </div>



      <!-- Filters Panel -->
      <div class="shipments-filters-panel">
        <div class="filter-item filter-item-search">
          <label class="filter-label">Buscar</label>
          <input type="text" id="ship-search-input" class="filter-input" placeholder="Referencia, destinatario, tracking, comuna...">
        </div>
        <div class="filter-item" style="position: relative;">
          <label class="filter-label">Estado</label>
          <div class="custom-multiselect" id="status-multiselect">
            <div class="multiselect-trigger" id="status-multiselect-trigger">
              <span class="trigger-text" id="status-trigger-text">Todos los estados</span>
              <i class="ri-arrow-down-s-line"></i>
            </div>
            <div class="multiselect-dropdown" id="status-multiselect-dropdown">
              <div class="multiselect-actions">
                <button type="button" id="status-select-all">Todos</button>
                <button type="button" id="status-clear-all">Limpiar</button>
              </div>
              <div class="multiselect-options" id="status-options-list">
                <!-- Options injected dynamically by JS -->
              </div>
            </div>
          </div>
        </div>
        <div class="filter-item">
          <label class="filter-label">Courier</label>
          <select id="ship-courier-select" class="filter-input">
            <option value="">Todos los couriers</option>
          </select>
        </div>
        <div class="filter-item">
          <label class="filter-label">Desde</label>
          <input type="date" id="ship-date-from" class="filter-input" value="${filters.dateFrom}">
        </div>
        <div class="filter-item">
          <label class="filter-label">Hasta</label>
          <input type="date" id="ship-date-to" class="filter-input" value="${filters.dateTo}">
        </div>
        <button id="ship-btn-export" class="btn-filter-action btn-export" style="border:none;">
          <span><i class="ri-inbox-archive-line"></i></span> Exportar Excel
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
                <th class="sortable-header" data-sort="status">Estado <span class="sort-indicator">⇅</span></th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody id="shipments-table-body">
              <!-- Injected by applyFiltersAndRenderTable -->
            </tbody>
          </table>
        </div>
        <!-- Contenedor para controles de paginación -->
        <div id="shipments-pagination-container"></div>
      </div>
    `;

    // Populate Courier Options dynamically from data
    const courierSelect = document.getElementById('ship-courier-select');
    couriers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      courierSelect.appendChild(opt);
    });

    // Renderizado de paginación
    const renderPagination = () => {
      const pagContainer = document.getElementById('shipments-pagination-container');
      const totalPages = Math.ceil(totalFilteredRows / pageSize);

      if (totalPages <= 1) {
        pagContainer.innerHTML = '';
        return;
      }

      const fromRow = (currentPage - 1) * pageSize + 1;
      const toRow = Math.min(currentPage * pageSize, totalFilteredRows);

      pagContainer.innerHTML = `
        <div class="shipments-pagination" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; background-color: var(--color-bg-card); border-top: 1px solid var(--color-border); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;">
          <span style="font-size: 0.875rem; color: var(--color-text-muted);">
            Mostrando <strong style="color: var(--color-text-main);">${fromRow}</strong> a 
            <strong style="color: var(--color-text-main);">${toRow}</strong> de 
            <strong style="color: var(--color-text-main);">${totalFilteredRows}</strong> resultados
          </span>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button id="ship-prev-page" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;" ${currentPage === 1 ? 'disabled' : ''}>
              <i class="ri-arrow-left-s-line"></i> Anterior
            </button>
            <span style="font-size: 0.875rem; color: var(--color-text-muted); padding: 0 0.5rem;">
              Pág. <strong>${currentPage}</strong> de <strong>${totalPages}</strong>
            </span>
            <button id="ship-next-page" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.25rem;" ${currentPage >= totalPages ? 'disabled' : ''}>
              Siguiente <i class="ri-arrow-right-s-line"></i>
            </button>
          </div>
        </div>
      `;

      // Event listeners para botones de paginación
      const btnPrev = document.getElementById('ship-prev-page');
      const btnNext = document.getElementById('ship-next-page');

      if (btnPrev && currentPage > 1) {
        btnPrev.addEventListener('click', async () => {
          currentPage--;
          await fetchAndRenderTable();
        });
      }

      if (btnNext && currentPage < totalPages) {
        btnNext.addEventListener('click', async () => {
          currentPage++;
          await fetchAndRenderTable();
        });
      }
    };

    // Filtering, sorting and rendering implementation
    const applyFiltersAndRenderTable = () => {
      let filtered = [...allData];

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

      // Render Table Rows
      const tbody = document.getElementById('shipments-table-body');
      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">No se encontraron despachos con los filtros aplicados.</td></tr>`;
        document.getElementById('shipments-pagination-container').innerHTML = '';
        return;
      }

      let rowsHtml = '';
      filtered.forEach(s => {
        const dateObj = s.created_at ? new Date(s.created_at) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '-';
        
        let badgeClass = 'badge-neutral';
        if (s.global_status === 'DESPACHADO') {
          badgeClass = 'badge-success';
        } else if (s.global_status === 'SIN MOVIMIENTO') {
          badgeClass = 'badge-warning';
        } else if (s.global_status === 'ALERTA') {
          badgeClass = 'badge-danger';
        }

        const platformBadge = s.source_table === 'lightdata_envios' ? 'LightData' 
          : s.source_table === 'enviame_shipments' ? 'Enviame' : 'Optiroute';
        
        const platformColor = s.source_table === 'lightdata_envios' ? '#3b82f6'
          : s.source_table === 'enviame_shipments' ? '#10b981' : '#8b5cf6';

        const trackingDisplay = s.tracking
          ? (s.tracking_url && s.tracking_url !== 'N/A'
              ? `<a href="${s.tracking_url}" target="_blank" onclick="event.stopPropagation();" style="font-weight:600; display:inline-flex; align-items:center; gap:0.25rem;"><i class="ri-links-line"></i> ${s.tracking}</a>`
              : s.tracking)
          : '-';

        rowsHtml += `
          <tr class="clickable-row" data-id="${s.id}" style="transition: background-color 0.2s;">
            <td><span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${s.pedido_referencia || '-'}</span></td>
            <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
            <td>
              <div style="font-weight:600; color: var(--color-text-main);"><i class="ri-user-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.nombre_destinatario || '-'}</div>
              <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top: 0.2rem;"><i class="ri-phone-line" style="margin-right: 0.25rem;"></i>${s.telefono_destino || '-'}</div>
            </td>
            <td><i class="ri-map-pin-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.comuna_destino || '-'}</td>
            <td><span style="font-weight:600; color: var(--color-text-main);"><i class="ri-truck-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.courier || '-'}</span></td>
            <td>${trackingDisplay}</td>
            <td>
              <span class="badge ${badgeClass}" style="padding: 0.35rem 0.75rem; border-radius: 99px; font-weight: 600;">
                ${getDisplayStatusName(s.status)}
              </span>
            </td>
            <td>
              <span style="background-color: ${platformColor}15; color: ${platformColor}; padding: 0.35rem 0.75rem; border-radius: 99px; font-size: 0.75rem; font-weight: 700; border: 1px solid ${platformColor}30;">
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

      // Render pagination controls
      renderPagination();
    };

    // Función para obtener los datos desde Supabase con filtros y paginación
    const fetchAndRenderTable = async () => {
      const tbody = document.getElementById('shipments-table-body');
      tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 3rem;">Cargando despachos...</td></tr>`;

      try {
        const companyList = getCompanyList();

        // Obtener reglas de visibilidad aplicables al usuario actual
        const { data: rules } = await supabase
          .from('reglas_visibilidad')
          .select('*');

        // 1. Query paginada y filtrada para la tabla
        let query = supabase
          .from('envios_unificados')
          .select('*', { count: 'exact' })
          .eq('visible_to_client', true);

        query = applyVisibilityRulesToQuery(query, rules);

        if (companyList.length > 0) {
          query = query.in('empresa_comercio_proveedor', companyList);
        }

        // Aplicar filtros
        if (filters.courier) {
          query = query.eq('courier', filters.courier);
        }
        if (filters.dateFrom) {
          query = query.gte('created_at', filters.dateFrom + 'T00:00:00Z');
        }
        if (filters.dateTo) {
          query = query.lte('created_at', filters.dateTo + 'T23:59:59Z');
        }
        if (filters.statuses && filters.statuses.length > 0) {
          query = query.in('status', filters.statuses);
        }
        if (filters.search) {
          const term = `%${filters.search}%`;
          query = query.or(`pedido_referencia.ilike.${term},nombre_destinatario.ilike.${term},tracking.ilike.${term},courier.ilike.${term},comuna_destino.ilike.${term},direccion_destino.ilike.${term}`);
        }

        // Ordenar y limitar por rango de paginación
        query = query.order('created_at', { ascending: false });
        query = query.range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

        const dataRes = await query;
        if (dataRes.error) throw dataRes.error;

        allData = dataRes.data || [];
        totalFilteredRows = dataRes.count || 0;

        applyFiltersAndRenderTable();
      } catch (err) {
        console.error('Error fetching shipments data:', err);
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-danger);">Error al cargar los datos de la base de datos.</td></tr>`;
      }
    };

    // Bind filters event listeners con de-bounce para búsqueda
    let searchTimeout;
    document.getElementById('ship-search-input').addEventListener('input', (e) => {
      filters.search = e.target.value;
      currentPage = 1; // Resetear a página 1
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        await fetchAndRenderTable();
      }, 300);
    });

    // Populate Status Options dynamically
    const statusOptionsList = document.getElementById('status-options-list');
    const statusTriggerText = document.getElementById('status-trigger-text');
    
    const updateStatusTriggerText = () => {
      if (filters.statuses.length === 0) {
        statusTriggerText.textContent = 'Todos los estados';
      } else if (filters.statuses.length === 1) {
        statusTriggerText.textContent = getDisplayStatusName(filters.statuses[0]);
      } else {
        statusTriggerText.textContent = `${filters.statuses.length} seleccionados`;
      }
    };

    originalStatuses.forEach(st => {
      const optDiv = document.createElement('div');
      optDiv.className = 'multiselect-option';
      
      const displayLabel = getDisplayStatusName(st);

      optDiv.innerHTML = `
        <input type="checkbox" id="chk-status-${st}" value="${st}">
        <label for="chk-status-${st}">${displayLabel}</label>
      `;

      // Click on row toggles checkbox
      optDiv.addEventListener('click', async (e) => {
        if (e.target.tagName !== 'INPUT') {
          const chk = optDiv.querySelector('input');
          chk.checked = !chk.checked;
          chk.dispatchEvent(new Event('change'));
        }
      });

      const checkbox = optDiv.querySelector('input');
      checkbox.addEventListener('change', async (e) => {
        const val = e.target.value;
        if (e.target.checked) {
          if (!filters.statuses.includes(val)) {
            filters.statuses.push(val);
          }
        } else {
          filters.statuses = filters.statuses.filter(v => v !== val);
        }
        updateStatusTriggerText();
        currentPage = 1;
        await fetchAndRenderTable();
      });

      statusOptionsList.appendChild(optDiv);
    });

    // Toggle Dropdown menu visibility
    const multiselectTrigger = document.getElementById('status-multiselect-trigger');
    const multiselectDropdown = document.getElementById('status-multiselect-dropdown');

    multiselectTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      multiselectDropdown.classList.toggle('show');
    });

    // Select All
    document.getElementById('status-select-all').addEventListener('click', async (e) => {
      e.stopPropagation();
      filters.statuses = [...originalStatuses];
      statusOptionsList.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.checked = true;
      });
      updateStatusTriggerText();
      currentPage = 1;
      await fetchAndRenderTable();
    });

    // Clear All
    document.getElementById('status-clear-all').addEventListener('click', async (e) => {
      e.stopPropagation();
      filters.statuses = [];
      statusOptionsList.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.checked = false;
      });
      updateStatusTriggerText();
      currentPage = 1;
      await fetchAndRenderTable();
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#status-multiselect')) {
        multiselectDropdown.classList.remove('show');
      }
    });

    document.getElementById('ship-courier-select').addEventListener('change', async (e) => {
      filters.courier = e.target.value;
      currentPage = 1; // Resetear a página 1
      await fetchAndRenderTable();
    });

    document.getElementById('ship-date-from').addEventListener('change', async (e) => {
      filters.dateFrom = e.target.value;
      currentPage = 1; // Resetear a página 1
      await fetchAndRenderTable();
    });

    document.getElementById('ship-date-to').addEventListener('change', async (e) => {
      filters.dateTo = e.target.value;
      currentPage = 1; // Resetear a página 1
      await fetchAndRenderTable();
    });

    // Excel Export CSV logic con consulta completa sin paginación
    document.getElementById('ship-btn-export').addEventListener('click', async () => {
      const tbody = document.getElementById('shipments-table-body');
      const originalHtml = tbody.innerHTML;
      tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem;">Generando reporte de exportación...</td></tr>`;

      try {
        const companyList = getCompanyList();

        // Obtener reglas de visibilidad
        const { data: rules } = await supabase
          .from('reglas_visibilidad')
          .select('*');

        let query = supabase
          .from('envios_unificados')
          .select('*')
          .eq('visible_to_client', true);

        query = applyVisibilityRulesToQuery(query, rules);

        if (companyList.length > 0) {
          query = query.in('empresa_comercio_proveedor', companyList);
        }

        if (filters.courier) {
          query = query.eq('courier', filters.courier);
        }
        if (filters.dateFrom) {
          query = query.gte('created_at', filters.dateFrom + 'T00:00:00Z');
        }
        if (filters.dateTo) {
          query = query.lte('created_at', filters.dateTo + 'T23:59:59Z');
        }
        if (filters.statuses && filters.statuses.length > 0) {
          query = query.in('status', filters.statuses);
        }
        if (filters.search) {
          const term = `%${filters.search}%`;
          query = query.or(`pedido_referencia.ilike.${term},nombre_destinatario.ilike.${term},tracking.ilike.${term},courier.ilike.${term},comuna_destino.ilike.${term},direccion_destino.ilike.${term}`);
        }

        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;

        const filtered = data || [];

        // Headers y mapeo de datos
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

        // Built UTF-8 CSV con BOM para compatibilidad con Excel
        const csvContent = "\ufeff" + [headers.join(','), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `despachos_stocka_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error('Error exporting shipments:', err);
        alert('Error al exportar los despachos: ' + err.message);
      } finally {
        tbody.innerHTML = originalHtml;
        // Volver a vincular eventos de clicks de la tabla
        tbody.querySelectorAll('.clickable-row').forEach(row => {
          row.addEventListener('click', () => {
            const id = row.getAttribute('data-id');
            const shipment = allData.find(x => x.id === id);
            if (shipment) {
              showShipmentDetailsModal(shipment);
            }
          });
        });
      }
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

    // Carga inicial de datos desde base de datos
    await fetchAndRenderTable();

  } catch (err) {
    console.error('Error rendering shipments:', err);
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar los despachos: ${err.message}</p>`;
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
        <div class="timeline-bubble">${gs === 'ALERTA' ? '<i class="ri-error-warning-line"></i>' : '2'}</div>
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
    ? `<a href="${shipment.tracking_url}" target="_blank" class="btn btn-complementary" style="margin-right: auto;"><i class="ri-links-line"></i> Seguimiento de Pedido</a>`
    : ``;

  modal.innerHTML = `
    <div class="slide-over-panel">
      <div class="slide-over-header">
        <h3><i class="ri-truck-line" style="color: var(--color-primary);"></i> Detalle de Despacho</h3>
        <button class="slide-over-close" id="btn-close-shipment-modal">&times;</button>
      </div>
      
      <div class="slide-over-body">
        
        <!-- Graphic Tracking Progress Timeline -->
        ${stepperHtml}

        <div class="shipment-detail-grid" style="display: flex; flex-direction: column; gap: 2rem;">
          
          <!-- Left Column: Logistics Info and Destination Info -->
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            
            <div class="shipment-detail-section">
              <h4 class="shipment-detail-title"><i class="ri-route-line"></i> Información de Logística</h4>
              <div class="detail-info-row">
                <span class="detail-info-label">Proveedor:</span>
                <span class="detail-info-value"><span style="background: var(--color-primary); color: white; padding: 0.15rem 0.6rem; border-radius: 99px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.03em;">${platformBadge}</span></span>
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
                        ? `<a href="${shipment.tracking_url}" target="_blank" style="font-weight:700; color:var(--color-accent);"><i class="ri-links-line"></i> ${shipment.tracking}</a>`
                        : `<span style="font-weight:700;">${shipment.tracking}</span>`)
                    : '-'}
                </span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Tipo de Servicio:</span>
                <span class="detail-info-value">${shipment.servicio_tipo_envio || '-'}</span>
              </div>
              <div class="detail-info-row">
                <span class="detail-info-label">Estado:</span>
                <span class="detail-info-value"><span style="background: rgba(99,102,241,0.12); color: var(--color-accent); padding: 0.2rem 0.65rem; border-radius: 99px; font-size: 0.78rem; font-weight: 700;">${getDisplayStatusName(shipment.status)}</span></span>
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
              <h4 class="shipment-detail-title"><i class="ri-map-pin-2-line"></i> Información del Cliente / Entrega</h4>
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
              <h4 class="shipment-detail-title"><i class="ri-shopping-bag-3-line"></i> Productos en la Orden de Venta</h4>
              <div id="order-details-loading" style="text-align: center; padding: 3rem 1rem; color: var(--color-text-muted); font-size:0.875rem; flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column;">
                <div style="margin-bottom:0.5rem; font-size:1.5rem;"><i class="ri-loop-right-line"></i></div>
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
      <span style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"><i class="ri-search-line"></i></span>
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
        total_value,
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
        <span style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"><i class="ri-search-line"></i></span>
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
        <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
          <span style="color: var(--color-text-muted); font-weight:500;">Valor Total:</span>
          <span style="font-weight:700; color: var(--color-text-main);">${window.formatCLP(order.total_value)}</span>
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
      <span style="color: red; font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"><i class="ri-error-warning-line"></i></span>
      Error al cargar los detalles del pedido asociado en la base de datos.
    `;
  }
}

// ==========================================
// Observer & Profile Functions
// ==========================================

function getObserverBanner() {
  let html = window.activeSystemBannerHtml || '';
  if (userRole === 'observer') {
    html += `
      <div class="observer-banner" style="background-color: #fef3c7; color: #d97706; padding: 0.75rem 1rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; font-weight: 500; display: flex; align-items: center; gap: 0.5rem; border: 1px solid #fde68a; font-size: 0.9rem;">
        <span><i class="ri-error-warning-line"></i></span> <strong>Modo Observador:</strong> Tienes acceso de solo lectura. No puedes realizar acciones, crear pedidos/productos ni modificar integraciones.
      </div>
    `;
  }
  return html;
}

async function renderProfile() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando perfil...</p>`;

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

            <div style="background-color: var(--color-bg); padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin: 1.5rem 0;">
              <h4 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 1.25rem; color: var(--color-text-main); text-transform: uppercase; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shield-user-line" style="color: var(--color-primary); font-size: 1.2rem;"></i> Atributos del Sistema</h4>
              
              <div style="display: flex; flex-direction: column; gap: 1.25rem;">
                <div>
                  <span style="display: block; color: var(--color-text-muted); font-size: 0.8rem; margin-bottom: 0.5rem; text-transform: uppercase; font-weight: 600;">Rol Asignado</span>
                  <span style="background-color: rgba(139, 92, 246, 0.15); color: #8b5cf6; padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.85rem; font-weight: 700; border: 1px solid rgba(139, 92, 246, 0.3); display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-user-star-line"></i> ${roleText}</span>
                </div>
                
                <div>
                  <span style="display: block; color: var(--color-text-muted); font-size: 0.8rem; margin-bottom: 0.5rem; text-transform: uppercase; font-weight: 600;">Comercios Asociados</span>
                  <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                    ${assignedComercios.split(',').map(c => `<span style="background-color: var(--color-surface); color: var(--color-text-main); border: 1px solid var(--color-border); padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-store-2-line" style="color: var(--color-primary);"></i> ${c.trim()}</span>`).join('')}
                  </div>
                </div>
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
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar perfil: ${err.message}</p>`;
  }
}

// ====== LOGISTICA INVERSA ======
let returnsCurrentPage = 1;
const returnsPageSize = 50;

window.renderReturns = async function() {
  const content = document.getElementById('app-content');
  
  content.innerHTML = getObserverBanner() + `
    <div style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: flex-end;">
      <div>
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Logística Inversa</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          Revisa las devoluciones y cambios. Filtra, pagina y exporta los datos.
        </p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <button id="btn-info-export" class="btn" style="background-color: rgba(59, 130, 246, 0.15); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.5rem 1rem; display: flex; align-items: center; gap: 0.4rem; border-radius: 99px; font-weight: 700; transition: all 0.2s; cursor: pointer;" title="¿Cómo exportar?">
          <i class="ri-information-line" style="font-size: 1.15rem;"></i> Info
        </button>
        <button id="btn-export-csv" class="btn btn-outline" style="background-color: transparent; color: #10b981; border-color: #10b981;">
          <i class="ri-file-text-line" style="margin-right: 0.25rem;"></i> CSV
        </button>
        <button id="btn-export-excel" class="btn btn-outline" style="background-color: transparent; color: #059669; border-color: #059669;">
          <i class="ri-file-excel-2-line" style="margin-right: 0.25rem;"></i> Excel
        </button>
      </div>
    </div>

    <!-- Filtros -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-body" style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end;">
        <div class="form-group" style="flex: 1; min-width: 150px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Tipo de Movimiento</label>
          <select id="filter-ret-type" class="form-input">
            <option value="">Todos</option>
            <option value="CAMBIO">Cambio</option>
            <option value="DEVOLUCION">Devolución</option>
          </select>
        </div>
        <div class="form-group" style="flex: 1; min-width: 200px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Buscador General</label>
          <input type="text" id="filter-ret-search" class="form-input" placeholder="Buscar por pedido, transporte, tracking...">
        </div>
        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Desde Fecha</label>
          <input type="date" id="filter-ret-date-from" class="form-input">
        </div>
        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Hasta Fecha</label>
          <input type="date" id="filter-ret-date-to" class="form-input">
        </div>
      </div>
    </div>

    <!-- Data Table -->
    <div class="card">
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Tipo</th>
              <th>Comercio</th>
              <th>Ref. Pedido</th>
              <th>Transporte</th>
              <th>Sucursal</th>
              <th>Ref. Transporte</th>
              <th>Cant.</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="returns-tbody">
            <tr><td colspan="9" class="text-center" style="padding: 2rem;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem;">
        <div id="returns-pagination-info" style="font-size: 0.875rem; color: var(--color-text-muted);">
          Mostrando 0 registros
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btn-ret-prev" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Anterior</button>
          <button id="btn-ret-next" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Siguiente</button>
        </div>
      </div>
    </div>
  `;

  // Añadir Listeners de Filtros
  const filters = ['filter-ret-type', 'filter-ret-date-from', 'filter-ret-date-to'];
  filters.forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      returnsCurrentPage = 1;
      fetchAndRenderReturnsData();
    });
  });

  let searchTimeout;
  document.getElementById('filter-ret-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      returnsCurrentPage = 1;
      fetchAndRenderReturnsData();
    }, 400);
  });

  // Listeners de paginación
  document.getElementById('btn-ret-prev').addEventListener('click', () => {
    if (returnsCurrentPage > 1) {
      returnsCurrentPage--;
      fetchAndRenderReturnsData();
    }
  });

  document.getElementById('btn-ret-next').addEventListener('click', () => {
    returnsCurrentPage++;
    fetchAndRenderReturnsData();
  });

  // Listeners Exportación
  document.getElementById('btn-export-csv').addEventListener('click', () => exportReturnsData('csv'));
  document.getElementById('btn-export-excel').addEventListener('click', () => exportReturnsData('excel'));
  document.getElementById('btn-info-export').addEventListener('click', () => {
    showInfoModal(
      'Guía de Exportación',
      `<ol style="margin: 0; padding-left: 1.5rem;">
         <li style="margin-bottom: 0.5rem;">Utiliza los filtros (Tipo, Buscador, Fechas) para acotar tu búsqueda.</li>
         <li style="margin-bottom: 0.5rem;">Haz clic en <strong>"CSV"</strong> o <strong>"Excel"</strong> para descargar el reporte.</li>
         <li>El archivo generado sólo contendrá los registros que coincidan con los filtros actuales en pantalla.</li>
       </ol>`
    );
  });

  // Carga Inicial
  returnsCurrentPage = 1;
  await fetchAndRenderReturnsData();
};

function buildReturnsQuery(query) {
  const fType = document.getElementById('filter-ret-type').value;
  const fSearch = document.getElementById('filter-ret-search').value.trim();
  const fFrom = document.getElementById('filter-ret-date-from').value;
  const fTo = document.getElementById('filter-ret-date-to').value;

  if (currentCompany) {
    const companyList = [];
    currentCompany.split(',').forEach(c => {
      const trimmed = c.trim();
      if (trimmed) {
        companyList.push(trimmed);
        companyList.push(trimmed.toLowerCase());
        companyList.push(trimmed.toUpperCase());
      }
    });
    if (companyList.length > 0) {
      query = query.in('comercio', companyList);
    }
  }
  if (fType) query = query.eq('tipo_movimiento', fType);
  if (fSearch) {
    query = query.or(`referencia_pedido.ilike.%${fSearch}%,transporte.ilike.%${fSearch}%,referencia_transporte.ilike.%${fSearch}%,sucursal.ilike.%${fSearch}%`);
  }
  
  if (fFrom) query = query.gte('created_at', fFrom + 'T00:00:00.000Z');
  if (fTo) query = query.lte('created_at', fTo + 'T23:59:59.999Z');

  return query;
}

async function fetchAndRenderReturnsData() {
  const tbody = document.getElementById('returns-tbody');
  const btnPrev = document.getElementById('btn-ret-prev');
  const btnNext = document.getElementById('btn-ret-next');
  const info = document.getElementById('returns-pagination-info');

  tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding: 2rem;">Cargando...</td></tr>';
  btnPrev.disabled = true;
  btnNext.disabled = true;

  try {
    let query = supabase.from('reverse_logistics').select('*', { count: 'exact' });
    query = buildReturnsQuery(query);

    const from = (returnsCurrentPage - 1) * returnsPageSize;
    const to = from + returnsPageSize - 1;

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: returns, error, count } = await query;
    if (error) throw error;

    let html = '';
    if (!returns || returns.length === 0) {
      html = '<tr><td colspan="9" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay registros encontrados.</td></tr>';
    } else {
      returns.forEach(r => {
        const d = new Date(r.created_at);
        const dateStr = d.toLocaleDateString() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        const badgeClass = r.tipo_movimiento === 'CAMBIO' ? 'badge-success' : 'badge-danger';
        
        let safeData = '{}';
        try { safeData = encodeURIComponent(JSON.stringify(r)); } catch(e){}

        html += `
          <tr style="transition: background-color 0.2s;">
            <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
            <td><span class="badge ${badgeClass}">${r.tipo_movimiento}</span></td>
            <td><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${r.comercio || 'N/A'}</td>
            <td><span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${r.referencia_pedido}</span></td>
            <td><i class="ri-truck-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${r.transporte || 'N/A'}</td>
            <td><i class="ri-map-pin-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${r.sucursal || 'N/A'}</td>
            <td><span style="font-family: monospace; font-size: 0.85rem; color: var(--color-text-muted);">${r.referencia_transporte || 'N/A'}</span></td>
            <td><strong style="color: var(--color-text-main); font-size: 1.05rem;">${r.cantidad_total}</strong></td>
            <td>
              <button class="btn btn-outline" onclick="window.openReturnsDetail('${safeData}')" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; border-color: var(--color-border); background: var(--color-surface);"><i class="ri-search-eye-line" style="color: var(--color-primary); margin-right:0.25rem;"></i> Detalle</button>
            </td>
          </tr>
        `;
      });
    }

    tbody.innerHTML = html;
    
    // Update pagination
    const currentEnd = Math.min(from + returnsPageSize, count || 0);
    info.textContent = `Mostrando ${count === 0 ? 0 : from + 1} a ${currentEnd} de ${count || 0} registros`;
    
    btnPrev.disabled = returnsCurrentPage <= 1;
    btnNext.disabled = currentEnd >= (count || 0);

  } catch (err) {
    console.error('Error:', err);
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger" style="padding: 2rem;">Error: ${err.message}</td></tr>`;
  }
}

async function exportReturnsData(format) {
  try {
    const info = document.getElementById('returns-pagination-info');
    const oldText = info.textContent;
    info.textContent = 'Preparando exportación...';
    
    let query = supabase.from('reverse_logistics').select('*').order('created_at', { ascending: false });
    query = buildReturnsQuery(query);
    
    const { data, error } = await query;
    if (error) throw error;
    
    if (!data || data.length === 0) {
      alert('No hay datos para exportar con estos filtros.');
      info.textContent = oldText;
      return;
    }

    // 3. Prepare data array
    const rows = data.map(r => {
      const d = new Date(r.created_at);
      const dateStr = d.toLocaleDateString() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      
      let productosStr = '';
      if (r.productos && Array.isArray(r.productos)) {
        productosStr = r.productos.map(p => `Devuelve: ${p.producto_devuelto || '-'} | Reemplaza: ${p.producto_reemplazo || '-'} | Cant: ${p.cantidad || 1}`).join(' || ');
      }

      return {
        'ID': r.id,
        'Fecha y Hora': dateStr,
        'Tipo': r.tipo_movimiento,
        'Comercio': r.comercio,
        'Referencia Pedido': r.referencia_pedido,
        'Transporte': r.transporte,
        'Sucursal': r.sucursal,
        'Tracking': r.referencia_transporte,
        'Cantidad': r.cantidad_total,
        'Creado Por': r.creado_por,
        'Comentarios': r.comentarios,
        'Detalle Productos': productosStr
      };
    });

    const timestamp = new Date().toISOString().slice(0,10);
    const filename = `logistica_inversa_${timestamp}`;

    if (format === 'csv') {
      const headers = Object.keys(rows[0]);
      const csvRows = rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
      const csvContent = "\ufeff" + [headers.join(','), ...csvRows].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${filename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } else if (format === 'excel') {
      if (typeof XLSX === 'undefined') {
        alert('Librería de Excel no está cargada. Intenta recargar la página.');
        info.textContent = oldText;
        return;
      }
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Logística Inversa");
      XLSX.writeFile(workbook, `${filename}.xlsx`);
    }

    info.textContent = oldText;
  } catch(e) {
    console.error('Error Exporting:', e);
    alert('Error al exportar: ' + e.message);
  }
}

window.openReturnsDetail = function(dataStr) {
  try {
    const data = JSON.parse(decodeURIComponent(dataStr));
    
    const title = data.tipo_movimiento === 'CAMBIO' ? 'Detalle de Cambio' : 'Detalle de Devolución';
    const badgeClass = data.tipo_movimiento === 'CAMBIO' ? 'badge-success' : 'badge-danger';
    
    let prodHtml = '<ul style="margin: 0; padding-left: 1.2rem; color: var(--color-text-main);">';
    if (data.productos && Array.isArray(data.productos)) {
      data.productos.forEach(p => {
        prodHtml += `<li style="margin-bottom: 0.25rem;"><strong>${p.cantidad || 1}x</strong> Devuelve: ${p.producto_devuelto || '-'} &rarr; Reemplazo: ${p.producto_reemplazo || '-'}</li>`;
      });
    } else {
      prodHtml += `<li><span style="color: var(--color-text-muted);">Sin detalles de productos</span></li>`;
    }
    prodHtml += '</ul>';

    let content = `
      <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left; padding: 0.5rem 0;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; background: var(--color-surface-hover); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Referencia Pedido</span>
            <span style="font-family: monospace; font-size: 1.1rem; font-weight: 600; color: var(--color-text-main);">${data.referencia_pedido || '-'}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Tipo Movimiento</span>
            <span class="badge ${badgeClass}">${data.tipo_movimiento || '-'}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Transporte / Courier</span>
            <span style="font-size: 0.9rem; font-weight: 500; color: var(--color-text-main);"><i class="ri-truck-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${data.transporte || '-'}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Tracking / Código</span>
            <span style="font-family: monospace; font-size: 0.9rem; color: var(--color-text-main);"><i class="ri-qr-code-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${data.referencia_transporte || '-'}</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-store-2-line" style="margin-right:0.25rem;"></i> Origen</h4>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Comercio</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.comercio || '-'}</strong>
              </div>
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Sucursal Destino</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.sucursal || '-'}</strong>
              </div>
            </div>
          </div>

          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-user-star-line" style="margin-right:0.25rem;"></i> Gestión Interna</h4>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Registrado Por</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.creado_por || '-'}</strong>
              </div>
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Cantidad Total (Artículos)</span>
                <strong style="color: var(--color-text-main); font-size: 1.1rem;">${data.cantidad_total || 0}</strong>
              </div>
            </div>
          </div>
        </div>

        <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <h4 style="margin: 0 0 0.75rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-shopping-cart-2-line" style="margin-right:0.25rem;"></i> Productos</h4>
          <div style="font-size: 0.95rem;">
            ${prodHtml}
          </div>
        </div>
        
        ${data.comentarios ? `
        <div style="background: var(--badge-warning-bg); color: var(--badge-warning-text); padding: 1rem; border-radius: var(--radius-md); border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.9rem;">
          <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; display: flex; align-items: center; gap: 0.25rem;"><i class="ri-message-3-line"></i> Observaciones</h4>
          ${data.comentarios}
        </div>` : ''}
      </div>
    `;

    if (typeof showInfoModal === 'function') {
      showInfoModal(title, content);
    } else {
      alert("Movimiento: " + data.referencia_pedido + "\nComercio: " + data.comercio);
    }
    
  } catch(e) {
    console.error(e);
    alert('Error al abrir detalle');
  }
}

// Modal Genérico de Información
window.showInfoModal = function(title, contentHtml) {
  let modal = document.getElementById('modal-generic-info');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'modal-generic-info';
  modal.className = 'modal-overlay';
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px; display: flex; flex-direction: column; max-height: 90vh; padding: 0;">
      <div class="modal-header" style="padding: 1.25rem; border-bottom: 1px solid var(--color-border); background: var(--color-surface); border-radius: var(--radius-lg) var(--radius-lg) 0 0;">
        <h3 style="margin: 0;">${title}</h3>
        <button class="modal-close" id="btn-close-generic-info">&times;</button>
      </div>
      <div class="modal-body" style="font-size: 0.95rem; color: var(--color-text-main); line-height: 1.6; overflow-y: auto; flex: 1; padding: 1.25rem;">
        ${contentHtml}
      </div>
      <div class="modal-footer" style="padding: 1.25rem; border-top: 1px solid var(--color-border); background: var(--color-surface); border-radius: 0 0 var(--radius-lg) var(--radius-lg);">
        <button class="btn btn-primary" id="btn-ok-generic-info" style="width: 100%;">Entendido</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  setTimeout(() => {
    modal.classList.add('active');
  }, 10);

  const closeModal = () => {
    modal.classList.remove('active');
    setTimeout(() => {
      modal.remove();
    }, 300);
  };

  document.getElementById('btn-close-generic-info').addEventListener('click', closeModal);
  document.getElementById('btn-ok-generic-info').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
};;

﻿// ====== PUNTO DE RETIRO ======
let pickupsCurrentPage = 1;
const pickupsPageSize = 50;

window.renderPickups = async function() {
  const content = document.getElementById('app-content');
  
  content.innerHTML = getObserverBanner() + `
    <div style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: flex-end;">
      <div>
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Punto de Retiro</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          Revisa las entregas y retiros en sucursales en tiempo real.
        </p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <button id="btn-info-export-pickups" class="btn" style="background-color: rgba(59, 130, 246, 0.15); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.5rem 1rem; display: flex; align-items: center; gap: 0.4rem; border-radius: 99px; font-weight: 700; transition: all 0.2s; cursor: pointer;" title="¿Cómo exportar?">
          <i class="ri-information-line" style="font-size: 1.15rem;"></i> Info
        </button>
        <button id="btn-export-pickups-csv" class="btn btn-outline" style="background-color: white; color: #10b981; border-color: #10b981;">
          <i class="ri-file-text-line" style="margin-right: 0.25rem;"></i> CSV
        </button>
        <button id="btn-export-pickups-excel" class="btn btn-outline" style="background-color: white; color: #059669; border-color: #059669;">
          <i class="ri-file-excel-2-line" style="margin-right: 0.25rem;"></i> Excel
        </button>
      </div>
    </div>

    <!-- Filtros -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-body" style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end;">
        <div class="form-group" style="flex: 1; min-width: 200px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Buscador General</label>
          <input type="text" id="filter-pickups-search" class="form-input" placeholder="Buscar por pedido, cliente, RUT, sucursal...">
        </div>
        <div class="form-group" style="flex: 1; min-width: 150px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Estado</label>
          <select id="filter-pickups-status" class="form-input">
            <option value="">Todos</option>
            <option value="ENTREGADO">Entregado</option>
            <option value="EN SUCURSAL">En Sucursal</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="EN RUTA">En Ruta</option>
          </select>
        </div>
        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Desde Fecha</label>
          <input type="date" id="filter-pickups-date-from" class="form-input">
        </div>
        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Hasta Fecha</label>
          <input type="date" id="filter-pickups-date-to" class="form-input">
        </div>
      </div>
    </div>

    <!-- Data Table -->
    <div class="card">
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha Registro</th>
              <th>Estado</th>
              <th>Comercio</th>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Sucursal</th>
              <th>F. Entrega</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="pickups-tbody">
            <tr><td colspan="8" class="text-center" style="padding: 2rem;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem;">
        <div id="pickups-pagination-info" style="font-size: 0.875rem; color: var(--color-text-muted);">
          Mostrando 0 registros
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btn-pickups-prev" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Anterior</button>
          <button id="btn-pickups-next" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Siguiente</button>
        </div>
      </div>
    </div>
  `;

  // Listeners de Filtros
  const filters = ['filter-pickups-status', 'filter-pickups-date-from', 'filter-pickups-date-to'];
  filters.forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      pickupsCurrentPage = 1;
      fetchAndRenderPickupsData();
    });
  });

  let searchTimeout;
  document.getElementById('filter-pickups-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      pickupsCurrentPage = 1;
      fetchAndRenderPickupsData();
    }, 400);
  });

  // Listeners Paginación
  document.getElementById('btn-pickups-prev').addEventListener('click', () => {
    if (pickupsCurrentPage > 1) {
      pickupsCurrentPage--;
      fetchAndRenderPickupsData();
    }
  });

  document.getElementById('btn-pickups-next').addEventListener('click', () => {
    pickupsCurrentPage++;
    fetchAndRenderPickupsData();
  });

  // Listeners Exportación
  document.getElementById('btn-export-pickups-csv').addEventListener('click', () => exportPickupsData('csv'));
  document.getElementById('btn-export-pickups-excel').addEventListener('click', () => exportPickupsData('excel'));
  document.getElementById('btn-info-export-pickups').addEventListener('click', () => {
    showInfoModal(
      'Guía de Exportación',
      `<ol style="margin: 0; padding-left: 1.5rem;">
         <li style="margin-bottom: 0.5rem;">Utiliza los filtros (Buscador, Fechas, Estado) para acotar tu búsqueda.</li>
         <li style="margin-bottom: 0.5rem;">Haz clic en <strong>"CSV"</strong> o <strong>"Excel"</strong> para descargar el reporte.</li>
         <li>El archivo generado sólo contendrá los registros que coincidan con los filtros actuales en pantalla.</li>
       </ol>`
    );
  });

  pickupsCurrentPage = 1;
  await fetchAndRenderPickupsData();
};

function buildPickupsQuery(query) {
  const fSearch = document.getElementById('filter-pickups-search').value.trim();
  const fStatus = document.getElementById('filter-pickups-status').value;
  const fFrom = document.getElementById('filter-pickups-date-from').value;
  const fTo = document.getElementById('filter-pickups-date-to').value;

  if (currentCompany) {
    const companyList = [];
    currentCompany.split(',').forEach(c => {
      const trimmed = c.trim();
      if (trimmed) {
        companyList.push(trimmed);
        companyList.push(trimmed.toLowerCase());
        companyList.push(trimmed.toUpperCase());
      }
    });
    if (companyList.length > 0) {
      query = query.in('comercio', companyList);
    }
  }
  if (fStatus) query = query.eq('estado_pedido', fStatus);
  if (fSearch) {
    query = query.or(`pedido.ilike.%${fSearch}%,nombre_apellido.ilike.%${fSearch}%,rut.ilike.%${fSearch}%,sucursal.ilike.%${fSearch}%`);
  }
  
  if (fFrom) query = query.gte('created_at', fFrom + 'T00:00:00.000Z');
  if (fTo) query = query.lte('created_at', fTo + 'T23:59:59.999Z');

  return query;
}

async function fetchAndRenderPickupsData() {
  const tbody = document.getElementById('pickups-tbody');
  const btnPrev = document.getElementById('btn-pickups-prev');
  const btnNext = document.getElementById('btn-pickups-next');
  const info = document.getElementById('pickups-pagination-info');

  tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 2rem;">Cargando...</td></tr>';
  btnPrev.disabled = true;
  btnNext.disabled = true;

  try {
    let query = supabase.from('store_pickups').select('*', { count: 'exact' });
    query = buildPickupsQuery(query);

    const from = (pickupsCurrentPage - 1) * pickupsPageSize;
    const to = from + pickupsPageSize - 1;

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: pickups, error, count } = await query;
    if (error) throw error;

    let html = '';
    if (!pickups || pickups.length === 0) {
      html = '<tr><td colspan="8" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay registros encontrados.</td></tr>';
    } else {
      pickups.forEach(p => {
        const d = new Date(p.created_at);
        const dateStr = d.toLocaleDateString() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        
        let badgeClass = 'badge-neutral';
        const st = p.estado_pedido ? p.estado_pedido.toUpperCase() : '';
        if (st === 'ENTREGADO') badgeClass = 'badge-success';
        else if (st === 'EN SUCURSAL') badgeClass = 'badge-primary';
        else if (st === 'PENDIENTE') badgeClass = 'badge-warning';

        let safeData = '{}';
        try { safeData = encodeURIComponent(JSON.stringify(p)); } catch(e){}

        html += `
          <tr style="transition: background-color 0.2s;">
            <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
            <td><span class="badge ${badgeClass}">${st || 'N/A'}</span></td>
            <td><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${p.comercio || 'N/A'}</td>
            <td><span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${p.pedido || 'N/A'}</span></td>
            <td><i class="ri-user-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${p.nombre_apellido || 'N/A'}</td>
            <td><i class="ri-map-pin-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${p.sucursal || 'N/A'}</td>
            <td><strong style="color: var(--color-text-main); font-size: 0.95rem;">${p.fecha_retiro ? p.fecha_retiro + (p.hora_retiro ? ' ' + p.hora_retiro : '') : '-'}</strong></td>
            <td>
              <button class="btn btn-outline" onclick="window.openPickupsDetail('${safeData}')" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; border-color: var(--color-border); background: var(--color-surface);"><i class="ri-search-eye-line" style="color: var(--color-primary); margin-right:0.25rem;"></i> Detalle</button>
            </td>
          </tr>
        `;
      });
    }

    tbody.innerHTML = html;
    
    const currentEnd = Math.min(from + pickupsPageSize, count || 0);
    info.textContent = `Mostrando ${count === 0 ? 0 : from + 1} a ${currentEnd} de ${count || 0} registros`;
    
    btnPrev.disabled = pickupsCurrentPage <= 1;
    btnNext.disabled = currentEnd >= (count || 0);

  } catch (err) {
    console.error('Error:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger" style="padding: 2rem;">Error: ${err.message}</td></tr>`;
  }
}

async function exportPickupsData(format) {
  try {
    const info = document.getElementById('pickups-pagination-info');
    const oldText = info.textContent;
    info.textContent = 'Preparando exportación...';
    
    let query = supabase.from('store_pickups').select('*').order('created_at', { ascending: false });
    query = buildPickupsQuery(query);
    
    const { data, error } = await query;
    if (error) throw error;
    
    if (!data || data.length === 0) {
      alert('No hay datos para exportar con estos filtros.');
      info.textContent = oldText;
      return;
    }

    const rows = data.map(p => {
      const d = new Date(p.created_at);
      const dateStr = d.toLocaleDateString() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      
      return {
        'ID': p.id,
        'Fecha y Hora': dateStr,
        'Estado': p.estado_pedido,
        'Comercio': p.comercio,
        'Pedido': p.pedido,
        'Cliente': p.nombre_apellido,
        'RUT': p.rut,
        'Sucursal': p.sucursal,
        'Fecha Retiro': p.fecha_retiro,
        'Hora Retiro': p.hora_retiro,
        'Picker Entrega': p.picker_entrega,
        'Observaciones': p.observaciones,
        'Avisado Correo': p.avisado_x_mail ? 'Sí' : 'No',
        'Notif Automatica': p.notificado_automatico ? 'Sí' : 'No'
      };
    });

    const timestamp = new Date().toISOString().slice(0,10);
    const filename = `punto_retiro_${timestamp}`;

    if (format === 'csv') {
      const headers = Object.keys(rows[0]);
      const csvRows = rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
      const csvContent = "\ufeff" + [headers.join(','), ...csvRows].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${filename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } else if (format === 'excel') {
      if (typeof XLSX === 'undefined') {
        alert('Librería de Excel no está cargada.');
        info.textContent = oldText;
        return;
      }
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Punto Retiro");
      XLSX.writeFile(workbook, `${filename}.xlsx`);
    }

    info.textContent = oldText;
  } catch(e) {
    console.error('Error Exporting:', e);
    alert('Error al exportar: ' + e.message);
  }
}

window.openPickupsDetail = function(dataStr) {
  try {
    const data = JSON.parse(decodeURIComponent(dataStr));
    
    let badgeClass = 'badge-neutral';
    const st = data.estado_pedido || '';
    if (st.includes('LISTO')) badgeClass = 'badge-success';
    else if (st.includes('ENTREGADO')) badgeClass = 'badge-info';
    else if (st.includes('PENDIENTE')) badgeClass = 'badge-warning';

    let content = `
      <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left; padding: 0.5rem 0;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; background: var(--color-surface-hover); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Código Pedido</span>
            <span style="font-family: monospace; font-size: 1.1rem; font-weight: 600; color: var(--color-text-main);">${data.pedido || '-'}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Estado Retiro</span>
            <span class="badge ${badgeClass}">${st || '-'}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Fecha Programada</span>
            <span style="font-size: 0.9rem; font-weight: 500; color: var(--color-text-main);"><i class="ri-calendar-event-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${data.fecha_retiro || '-'} ${data.hora_retiro || ''}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Entregado por</span>
            <span style="font-size: 0.9rem; font-weight: 500; color: var(--color-text-main);"><i class="ri-user-star-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${data.picker_entrega || '-'}</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-store-2-line" style="margin-right:0.25rem;"></i> Origen</h4>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Comercio</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.comercio || '-'}</strong>
              </div>
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Sucursal</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.sucursal || '-'}</strong>
              </div>
            </div>
          </div>

          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-user-line" style="margin-right:0.25rem;"></i> Cliente</h4>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Nombre</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.nombre_apellido || '-'}</strong>
              </div>
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">RUT / Documento</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.rut || '-'}</strong>
              </div>
            </div>
          </div>
        </div>

        ${data.observaciones ? `
        <div style="background: var(--badge-warning-bg); color: var(--badge-warning-text); padding: 1rem; border-radius: var(--radius-md); border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.9rem;">
          <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; display: flex; align-items: center; gap: 0.25rem;"><i class="ri-message-3-line"></i> Observaciones</h4>
          ${data.observaciones}
        </div>` : ''}
      </div>
    `;

    if (window.showInfoModal) {
      window.showInfoModal('Detalle de Retiro', content);
    } else {
      alert("Comercio: " + data.comercio + "\nPedido: " + data.pedido + "\nEstado: " + data.estado_pedido + "\nSucursal: " + data.sucursal);
    }
    
  } catch(e) {
    console.error(e);
    alert('Error al abrir detalle');
  }
};

﻿
// ====== PUNTO DE VENTAS ======
let salesCurrentPage = 1;
const salesPageSize = 50;

window.renderSales = async function() {
  const content = document.getElementById('app-content');
  
  content.innerHTML = getObserverBanner() + `
    <div style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: flex-end;">
      <div>
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Punto de Ventas (POS)</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          Revisa las ventas realizadas en sucursales en tiempo real.
        </p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <button id="btn-info-export-sales" class="btn" style="background-color: rgba(59, 130, 246, 0.15); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.5rem 1rem; display: flex; align-items: center; gap: 0.4rem; border-radius: 99px; font-weight: 700; transition: all 0.2s; cursor: pointer;" title="¿Cómo exportar?">
          <i class="ri-information-line" style="font-size: 1.15rem;"></i> Info
        </button>
        <button id="btn-export-sales-csv" class="btn btn-outline" style="background-color: white; color: #10b981; border-color: #10b981;">
          <i class="ri-file-text-line" style="margin-right: 0.25rem;"></i> CSV
        </button>
        <button id="btn-export-sales-excel" class="btn btn-outline" style="background-color: white; color: #059669; border-color: #059669;">
          <i class="ri-file-excel-2-line" style="margin-right: 0.25rem;"></i> Excel
        </button>
      </div>
    </div>

    <!-- Filtros -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-body" style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end;">
        <div class="form-group" style="flex: 1; min-width: 200px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Buscador General</label>
          <input type="text" id="filter-sales-search" class="form-input" placeholder="Buscar por código, cliente, correo, sucursal...">
        </div>
        <div class="form-group" style="flex: 1; min-width: 150px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Modo de Pago</label>
          <select id="filter-sales-payment" class="form-input">
            <option value="">Todos</option>
            <option value="Tarjeta de Débito">Tarjeta de Débito</option>
            <option value="Tarjeta de Crédito">Tarjeta de Crédito</option>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
          </select>
        </div>
        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Desde Fecha</label>
          <input type="date" id="filter-sales-date-from" class="form-input">
        </div>
        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Hasta Fecha</label>
          <input type="date" id="filter-sales-date-to" class="form-input">
        </div>
      </div>
    </div>

    <!-- Data Table -->
    <div class="card">
      <div class="card-body" style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha Venta</th>
              <th>Código Venta</th>
              <th>Comercio</th>
              <th>Cliente</th>
              <th>Sucursal</th>
              <th>Monto Total</th>
              <th>Modo Pago</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="sales-tbody">
            <tr><td colspan="8" class="text-center" style="padding: 2rem;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem;">
        <div id="sales-pagination-info" style="font-size: 0.875rem; color: var(--color-text-muted);">
          Mostrando 0 registros
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btn-sales-prev" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Anterior</button>
          <button id="btn-sales-next" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Siguiente</button>
        </div>
      </div>
    </div>
  `;

  // Listeners de Filtros
  const filters = ['filter-sales-payment', 'filter-sales-date-from', 'filter-sales-date-to'];
  filters.forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      salesCurrentPage = 1;
      fetchAndRenderSalesData();
    });
  });

  let searchTimeout;
  document.getElementById('filter-sales-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      salesCurrentPage = 1;
      fetchAndRenderSalesData();
    }, 400);
  });

  // Listeners Paginación
  document.getElementById('btn-sales-prev').addEventListener('click', () => {
    if (salesCurrentPage > 1) {
      salesCurrentPage--;
      fetchAndRenderSalesData();
    }
  });

  document.getElementById('btn-sales-next').addEventListener('click', () => {
    salesCurrentPage++;
    fetchAndRenderSalesData();
  });

  // Listeners Exportación
  document.getElementById('btn-export-sales-csv').addEventListener('click', () => exportSalesData('csv'));
  document.getElementById('btn-export-sales-excel').addEventListener('click', () => exportSalesData('excel'));
  document.getElementById('btn-info-export-sales').addEventListener('click', () => {
    showInfoModal(
      'Guía de Exportación',
      `<ol style="margin: 0; padding-left: 1.5rem;">
         <li style="margin-bottom: 0.5rem;">Utiliza el buscador para acotar tu búsqueda.</li>
         <li style="margin-bottom: 0.5rem;">Haz clic en <strong>"CSV"</strong> o <strong>"Excel"</strong> para descargar el reporte.</li>
         <li>El archivo generado sólo contendrá las ventas que coincidan con los filtros actuales en pantalla.</li>
       </ol>`
    );
  });

  salesCurrentPage = 1;
  await fetchAndRenderSalesData();
};

function buildSalesQuery(query) {
  const fSearch = document.getElementById('filter-sales-search').value.trim();
  const fPayment = document.getElementById('filter-sales-payment').value;
  const fFrom = document.getElementById('filter-sales-date-from').value;
  const fTo = document.getElementById('filter-sales-date-to').value;

  if (currentCompany) {
    const companyList = [];
    currentCompany.split(',').forEach(c => {
      const trimmed = c.trim();
      if (trimmed) {
        companyList.push(trimmed);
        companyList.push(trimmed.toLowerCase());
        companyList.push(trimmed.toUpperCase());
      }
    });
    if (companyList.length > 0) {
      query = query.in('comercio', companyList);
    }
  }
  if (fPayment) query = query.eq('modo_pago', fPayment);
  if (fSearch) {
    query = query.or(`codigo_venta.ilike.%${fSearch}%,nombre_cliente.ilike.%${fSearch}%,correo_cliente.ilike.%${fSearch}%,sucursal.ilike.%${fSearch}%`);
  }
  
  if (fFrom) query = query.gte('created_at', fFrom + 'T00:00:00.000Z');
  if (fTo) query = query.lte('created_at', fTo + 'T23:59:59.999Z');

  return query;
}

async function fetchAndRenderSalesData() {
  const tbody = document.getElementById('sales-tbody');
  const btnPrev = document.getElementById('btn-sales-prev');
  const btnNext = document.getElementById('btn-sales-next');
  const info = document.getElementById('sales-pagination-info');

  tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 2rem;">Cargando...</td></tr>';
  btnPrev.disabled = true;
  btnNext.disabled = true;

  try {
    let query = supabase.from('store_sales').select('*', { count: 'exact' });
    query = buildSalesQuery(query);

    const from = (salesCurrentPage - 1) * salesPageSize;
    const to = from + salesPageSize - 1;

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: sales, error, count } = await query;
    if (error) throw error;

    let html = '';
    if (!sales || sales.length === 0) {
      html = '<tr><td colspan="8" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay registros encontrados.</td></tr>';
    } else {
      sales.forEach(s => {
        const d = new Date(s.created_at);
        const dateStr = d.toLocaleDateString() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        
        let montoFmt = s.monto_total ? '$' + Number(s.monto_total).toLocaleString('es-CL') : 'N/A';

        let safeData = '{}';
        try { safeData = encodeURIComponent(JSON.stringify(s)); } catch(e){}

        let badgeClass = 'badge-neutral';
        const pago = (s.modo_pago || '').toLowerCase();
        if (pago.includes('efectivo')) badgeClass = 'badge-success';
        else if (pago.includes('tarjeta') || pago.includes('crédito') || pago.includes('débito')) badgeClass = 'badge-info';
        else if (pago.includes('transferencia')) badgeClass = 'badge-warning';

        html += `
          <tr style="transition: background-color 0.2s;">
            <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
            <td><span style="font-family: monospace; font-size: 0.9rem; background: var(--color-bg); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">${s.codigo_venta || 'N/A'}</span></td>
            <td><i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${s.comercio || 'N/A'}</td>
            <td><i class="ri-user-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.nombre_cliente || 'N/A'}</td>
            <td><i class="ri-map-pin-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${s.sucursal || 'N/A'}</td>
            <td><strong style="color: #10b981; font-size: 1.05rem;">${montoFmt}</strong></td>
            <td><span class="badge ${badgeClass}">${s.modo_pago || 'N/A'}</span></td>
            <td>
              <button class="btn btn-outline" onclick="window.openSalesDetail('${safeData}')" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; border-color: var(--color-border); background: var(--color-surface);"><i class="ri-search-eye-line" style="color: var(--color-primary); margin-right:0.25rem;"></i> Detalle</button>
            </td>
          </tr>
        `;
      });
    }

    tbody.innerHTML = html;
    
    const currentEnd = Math.min(from + salesPageSize, count || 0);
    info.textContent = `Mostrando ${count === 0 ? 0 : from + 1} a ${currentEnd} de ${count || 0} registros`;
    
    btnPrev.disabled = salesCurrentPage <= 1;
    btnNext.disabled = currentEnd >= (count || 0);

  } catch (err) {
    console.error('Error:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger" style="padding: 2rem;">Error: ${err.message}</td></tr>`;
  }
}

async function exportSalesData(format) {
  try {
    const info = document.getElementById('sales-pagination-info');
    const oldText = info.textContent;
    info.textContent = 'Preparando exportación...';
    
    let query = supabase.from('store_sales').select('*').order('created_at', { ascending: false });
    query = buildSalesQuery(query);
    
    const { data, error } = await query;
    if (error) throw error;
    
    if (!data || data.length === 0) {
      alert('No hay datos para exportar con estos filtros.');
      info.textContent = oldText;
      return;
    }

    const rows = data.map(s => {
      const d = new Date(s.created_at);
      const dateStr = d.toLocaleDateString() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      
      let prodStr = '';
      if (s.productos) {
        try {
          let parsed = s.productos;
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          if (Array.isArray(parsed)) {
            prodStr = parsed.map(p => `${p.cantidad || 1}x ${p.producto || 'N/A'}`).join(' || ');
          }
        } catch(e) {}
      }

      return {
        'ID': s.id,
        'Fecha Venta': dateStr,
        'Código Venta': s.codigo_venta,
        'Comercio': s.comercio,
        'Sucursal': s.sucursal,
        'Monto Total': s.monto_total,
        'Modo Pago': s.modo_pago,
        'Documento': s.documento_tipo,
        'Nombre Cliente': s.nombre_cliente,
        'Correo Cliente': s.correo_cliente,
        'Teléfono': s.telefono_cliente,
        'Vendedor (Creado Por)': s.creado_por,
        'Productos': prodStr,
        'Comentarios': s.comentarios,
        'RUT Facturación': s.rut_facturacion,
        'Razón Social': s.razon_social_facturacion,
        'Giro': s.giro_facturacion,
        'Dirección Facturación': s.direccion_facturacion
      };
    });

    const timestamp = new Date().toISOString().slice(0,10);
    const filename = `punto_ventas_${timestamp}`;

    if (format === 'csv') {
      const headers = Object.keys(rows[0]);
      const csvRows = rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
      const csvContent = "\ufeff" + [headers.join(','), ...csvRows].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${filename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } else if (format === 'excel') {
      if (typeof XLSX === 'undefined') {
        alert('Librería de Excel no está cargada.');
        info.textContent = oldText;
        return;
      }
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Punto Ventas");
      XLSX.writeFile(workbook, `${filename}.xlsx`);
    }

    info.textContent = oldText;
  } catch(e) {
    console.error('Error Exporting:', e);
    alert('Error al exportar: ' + e.message);
  }
}

window.openSalesDetail = function(dataStr) {
  try {
    const data = JSON.parse(decodeURIComponent(dataStr));
    
    let prodHtml = '<ul style="margin: 0; padding-left: 1.2rem; color: var(--color-text-main);">';
    if (data.productos) {
      try {
        let parsed = data.productos;
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        if (Array.isArray(parsed)) {
          parsed.forEach(p => {
            prodHtml += `<li style="margin-bottom: 0.25rem;"><strong>${p.cantidad || 1}x</strong> ${p.producto || 'N/A'}</li>`;
          });
        }
      } catch(e) {}
    }
    prodHtml += '</ul>';

    let factHtml = '';
    if (data.documento_tipo === 'FACTURA') {
      factHtml = `
        <div style="grid-column: 1 / -1; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); padding: 1rem; border-radius: var(--radius-md); margin-top: 0.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #3b82f6; font-size: 0.9rem; display: flex; align-items: center; gap: 0.25rem;"><i class="ri-file-list-3-line"></i> Datos de Facturación</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
            <div><span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">RUT</span><strong style="color: var(--color-text-main); font-size: 0.9rem;">${data.rut_facturacion || '-'}</strong></div>
            <div><span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Razón Social</span><strong style="color: var(--color-text-main); font-size: 0.9rem;">${data.razon_social_facturacion || '-'}</strong></div>
            <div><span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Giro</span><strong style="color: var(--color-text-main); font-size: 0.9rem;">${data.giro_facturacion || '-'}</strong></div>
            <div style="grid-column: 1 / -1;"><span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Dirección</span><strong style="color: var(--color-text-main); font-size: 0.9rem;">${data.direccion_facturacion || '-'}</strong></div>
          </div>
        </div>
      `;
    }

    let montoFmt = data.monto_total ? '$' + Number(data.monto_total).toLocaleString('es-CL') : 'N/A';

    let content = `
      <div style="display: flex; flex-direction: column; gap: 1rem; text-align: left; padding: 0.5rem 0;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; background: var(--color-surface-hover); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Código de Venta</span>
            <span style="font-family: monospace; font-size: 1.1rem; font-weight: 600; color: var(--color-text-main);">${data.codigo_venta || '-'}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Total Pagado</span>
            <span style="font-size: 1.25rem; font-weight: 700; color: #10b981;">${montoFmt}</span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Documento y Pago</span>
            <span style="font-size: 0.9rem; font-weight: 500; color: var(--color-text-main);"><i class="ri-bank-card-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${data.modo_pago || '-'} <small>(${data.documento_tipo || '-'})</small></span>
          </div>
          <div>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Vendedor</span>
            <span style="font-size: 0.9rem; font-weight: 500; color: var(--color-text-main);"><i class="ri-user-star-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>${data.creado_por || '-'}</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-store-2-line" style="margin-right:0.25rem;"></i> Origen</h4>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Comercio</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.comercio || '-'}</strong>
              </div>
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Sucursal</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.sucursal || '-'}</strong>
              </div>
            </div>
          </div>

          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-user-line" style="margin-right:0.25rem;"></i> Cliente</h4>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem;">
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Nombre</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.nombre_cliente || '-'}</strong>
              </div>
              <div>
                <span style="color: var(--color-text-muted); font-size: 0.8rem; display: block;">Contacto</span>
                <strong style="color: var(--color-text-main); font-size: 0.95rem;">${data.correo_cliente || '-'}<br>${data.telefono_cliente || '-'}</strong>
              </div>
            </div>
          </div>
        </div>

        <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <h4 style="margin: 0 0 0.75rem 0; font-size: 0.9rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;"><i class="ri-shopping-cart-2-line" style="margin-right:0.25rem;"></i> Productos</h4>
          <div style="font-size: 0.95rem;">
            ${prodHtml}
          </div>
        </div>
        
        ${factHtml}
      </div>
    `;

    if (typeof showInfoModal === 'function') {
      showInfoModal('Detalle de Venta', content);
    } else {
      alert("Venta: " + data.codigo_venta + "\nTotal: " + montoFmt);
    }
    
  } catch(e) {
    console.error(e);
    alert('Error al abrir detalle de venta');
  }
};

// ==========================================
// System Communications (Banners & Popups)
// ==========================================
window.activeSystemBannerHtml = '';

window.checkSystemCommunications = async function(userId) {
  try {
    // 1. Fetch active Banner
    const { data: banners } = await supabase.from('system_banners').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1);
    if (banners && banners.length > 0) {
      const banner = banners[0];
      const { data: readBanner } = await supabase.from('user_notification_reads').select('id').eq('user_id', userId).eq('entity_type', 'banner').eq('entity_id', banner.id);
      if (!readBanner || readBanner.length === 0) {
        window.activeSystemBannerHtml = `
          <div id="system-banner-${banner.id}" style="background-color: ${banner.bg_color || '#2563eb'}; color: ${banner.text_color || '#ffffff'}; padding: 0.75rem 1rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; font-weight: 500; display: flex; align-items: center; justify-content: space-between; font-size: 0.95rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <div style="display: flex; align-items: center; gap: 0.5rem;"><i class="ri-information-fill"></i> ${banner.content}</div>
            <button onclick="dismissSystemBanner('${banner.id}', '${userId}')" style="background: none; border: none; color: inherit; cursor: pointer; font-size: 1.25rem; opacity: 0.8; padding: 0; display: flex;"><i class="ri-close-line"></i></button>
          </div>
        `;
        // Dynamically inject into app-content if not already there
        const appContent = document.getElementById('app-content');
        if (appContent && !document.getElementById(`system-banner-${banner.id}`)) {
          const temp = document.createElement('div');
          temp.innerHTML = window.activeSystemBannerHtml.trim();
          appContent.prepend(temp.firstChild);
        }
      }
    }

    // 2. Fetch active Popup
    const { data: popups } = await supabase.from('system_popups').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1);
    if (popups && popups.length > 0) {
      const popup = popups[0];
      const { data: readPopup } = await supabase.from('user_notification_reads').select('id').eq('user_id', userId).eq('entity_type', 'popup').eq('entity_id', popup.id);
      if (!readPopup || readPopup.length === 0) {
        window.showSystemPopupModal(popup, userId);
      }
    }
  } catch (err) {
    console.error('Error checking system communications:', err);
  }
};

window.dismissSystemBanner = async function(bannerId, userId) {
  const el = document.getElementById(`system-banner-${bannerId}`);
  if (el) el.style.display = 'none';
  window.activeSystemBannerHtml = '';
  await supabase.from('user_notification_reads').insert([{ user_id: userId, entity_type: 'banner', entity_id: bannerId }]);
};

window.showSystemPopupModal = function(popup, userId) {
  const modalId = 'system-popup-modal';
  if (document.getElementById(modalId)) return;
  
  const modal = document.createElement('div');
  modal.id = modalId;
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.backgroundColor = 'rgba(0,0,0,0.6)';
  modal.style.zIndex = '999999';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.backdropFilter = 'blur(4px)';
  
  const formattedContent = popup.content.replace(/\n/g, '<br>');
  
  modal.innerHTML = `
    <div style="background: var(--color-surface); padding: 2rem; border-radius: var(--radius-lg); max-width: 500px; width: 90%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); border: 1px solid var(--color-border); position: relative; animation: slideUp 0.3s ease-out forwards;">
      <h3 style="margin-top: 0; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem; font-size: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--color-border);">
        <i class="ri-notification-3-line" style="color: var(--color-accent);"></i> ${popup.title}
      </h3>
      <div style="color: var(--color-text-muted); line-height: 1.6; margin-bottom: 2rem; margin-top: 1.5rem; font-size: 1rem; max-height: 50vh; overflow-y: auto;">
        ${formattedContent}
      </div>
      <button onclick="dismissSystemPopup('${popup.id}', '${userId}')" class="btn btn-primary" style="width: 100%; background-color: var(--color-accent); font-size: 1rem; padding: 0.75rem;">Entendido, cerrar aviso</button>
    </div>
  `;
  document.body.appendChild(modal);
};

window.dismissSystemPopup = async function(popupId, userId) {
  const modal = document.getElementById('system-popup-modal');
  if (modal) modal.remove();
  await supabase.from('user_notification_reads').insert([{ user_id: userId, entity_type: 'popup', entity_id: popupId }]);
};

// ==========================================
// NUEVO MÓDULO: DECLARACIONES DE INGRESO DE STOCK (CLIENTE)
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

window.downloadDeclarationsTemplate = function() {
  try {
    const wb = XLSX.utils.book_new();
    const headers = [
      'Nombre Producto',
      'SKU',
      'Código de barra',
      'Cantidad declarada',
      'Valor',
      'Stock crítico (cantidad)',
      'Fecha de vencimiento',
      'Largo',
      'Ancho',
      'Alto',
      'Peso'
    ];
    const sampleData = [
      headers,
      ['Zapatos Niño N3', 'SKU-ZAP-003', '7801234567890', '100', '15000', '10', '2027-12-31', '30', '20', '15', '0.5'],
      ['Camiseta Deportiva M', 'SKU-CAM-002', '7801234567891', '250', '8990', '20', '', '25', '15', '2', '0.2']
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Ingreso');
    XLSX.writeFile(wb, 'plantilla_declaracion_ingreso.xlsx');
  } catch (err) {
    console.error('Error al generar la plantilla:', err);
    alert('Error al descargar la plantilla.');
  }
};

// Variables globales para el formulario
let clientSelectedDateStr = '';
let clientCalendarCurrentDate = new Date();
let clientUploadedFileBase64 = '';
let clientUploadedFileName = '';
let editingDeclarationId = null;

window.renderDeclarations = async function() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando módulo de declaraciones...</p>`;

  try {
    const isObserver = userRole === 'observer';
    
    // Resetear estados
    clientSelectedDateStr = '';
    clientCalendarCurrentDate = new Date();
    clientUploadedFileBase64 = '';
    clientUploadedFileName = '';

    const commerces = currentCompany ? currentCompany.split(',').map(c => c.trim()).filter(Boolean) : [];
    let commerceSelectHtml = '';
    if (commerces.length > 1) {
      commerceSelectHtml = `
        <div class="form-group">
          <label class="form-label">Comercio Asociado *</label>
          <select id="dec-comercio" class="form-input" required>
            ${commerces.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
      `;
    } else {
      const defaultCommerce = commerces[0] || 'STOCKA';
      commerceSelectHtml = `
        <div class="form-group">
          <label class="form-label">Comercio Asociado *</label>
          <select id="dec-comercio" class="form-input" required disabled style="opacity: 0.85; cursor: not-allowed;">
            <option value="${defaultCommerce}">${defaultCommerce}</option>
          </select>
        </div>
      `;
    }

    const formHtml = isObserver ? `
      <div class="card" style="padding: 1.5rem; text-align: center;">
        <p style="color: var(--color-text-muted);">Como Observador, no puedes crear declaraciones de ingreso.</p>
      </div>
    ` : `
      <div class="card">
        <div class="card-header" style="border-bottom: 1px solid var(--color-border); padding-bottom: 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h3 style="display: flex; align-items: center; gap: 0.75rem;">
              Declarar Nuevo Ingreso
              <button type="button" id="btn-info-declarations" style="background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.35); padding: 0.3rem 0.7rem; color: var(--color-primary); cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 99px; font-size: 0.78rem; font-weight: 600; font-family: var(--font-family); transition: all 0.2s; letter-spacing: 0.3px;" onmouseover="this.style.background='rgba(59, 130, 246, 0.22)'; this.style.borderColor='rgba(59, 130, 246, 0.5)'; this.style.transform='translateY(-1px)'; this.style.boxShadow='0 3px 8px rgba(59, 130, 246, 0.2)';" onmouseout="this.style.background='rgba(59, 130, 246, 0.12)'; this.style.borderColor='rgba(59, 130, 246, 0.35)'; this.style.transform='translateY(0)'; this.style.boxShadow='none';" title="Recomendaciones y Condiciones">
                <i class="ri-information-line" style="font-size: 1rem;"></i> Info
              </button>
            </h3>
            <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">
              Completa la información logística y adjunta la planilla detallada de stock.
            </p>
          </div>
        </div>
        <form id="form-new-declaration">
          ${commerceSelectHtml}
          <div class="form-group">
            <label class="form-label">Título / Descripción del Ingreso *</label>
            <input type="text" id="dec-title" class="form-input" placeholder="Ej. Embarque de zapatos de niño N°3" required>
          </div>

          <div class="form-group">
            <label class="form-label">Cantidad Total Unidades *</label>
            <input type="number" id="dec-qty-declared" class="form-input" min="1" placeholder="Ej. 350" required>
          </div>

          <!-- Desglose de Bultos -->
          <div class="form-group" style="background: var(--color-surface); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--color-border); margin-bottom: 1.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <label class="form-label" style="font-weight: 600; margin-bottom: 0.5rem; display: block; font-size: 0.95rem;">Detalle de Bultos a Enviar *</label>
            <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 1rem; line-height: 1.4;">
              Es obligatorio indicar al menos 1 bulto total. Indique las cantidades que enviará o marque "No enviaré" para cada tipo.
            </p>
            
            <!-- Contenedores -->
            <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 1rem; align-items: center; margin-bottom: 0.75rem;">
              <div style="display: flex; flex-direction: column;">
                <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.25rem;">Contenedores (Containers)</label>
                <input type="number" id="dec-container-count" class="form-input" min="1" placeholder="Cantidad" required style="padding: 0.5rem 0.75rem;">
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 1.15rem;">
                <input type="checkbox" id="dec-no-container" class="dec-no-envio-cb" style="width: 16px; height: 16px; cursor: pointer;">
                <label for="dec-no-container" style="font-size: 0.85rem; cursor: pointer; color: var(--color-text-muted); user-select: none;">No enviaré</label>
              </div>
            </div>

            <!-- Pallets -->
            <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 1rem; align-items: center; margin-bottom: 0.75rem;">
              <div style="display: flex; flex-direction: column;">
                <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.25rem;">Pallets</label>
                <input type="number" id="dec-pallet-count" class="form-input" min="1" placeholder="Cantidad" required style="padding: 0.5rem 0.75rem;">
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 1.15rem;">
                <input type="checkbox" id="dec-no-pallet" class="dec-no-envio-cb" style="width: 16px; height: 16px; cursor: pointer;">
                <label for="dec-no-pallet" style="font-size: 0.85rem; cursor: pointer; color: var(--color-text-muted); user-select: none;">No enviaré</label>
              </div>
            </div>

            <!-- Cajas -->
            <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 1rem; align-items: center; margin-bottom: 0.5rem;">
              <div style="display: flex; flex-direction: column;">
                <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.25rem;">Cajas (Boxes)</label>
                <input type="number" id="dec-box-count" class="form-input" min="1" placeholder="Cantidad" required style="padding: 0.5rem 0.75rem;">
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 1.15rem;">
                <input type="checkbox" id="dec-no-box" class="dec-no-envio-cb" style="width: 16px; height: 16px; cursor: pointer;">
                <label for="dec-no-box" style="font-size: 0.85rem; cursor: pointer; color: var(--color-text-muted); user-select: none;">No enviaré</label>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Método de Ingreso *</label>
            <select id="dec-delivery-method" class="form-input" required>
              <option value="Transporte vía courier">Transporte vía courier</option>
              <option value="Desde proveedor">Desde proveedor</option>
              <option value="Transporte particular">Transporte particular</option>
              <option value="Solicita retiro (solo dentro de Santiago)">Solicita retiro (solo dentro de Santiago)</option>
            </select>
          </div>

          <!-- Servicio de Descarga -->
          <div class="form-group" style="background: var(--color-surface); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--color-border); margin-bottom: 1.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <input type="checkbox" id="dec-requires-unloading" style="width: 18px; height: 18px; cursor: pointer;">
              <label for="dec-requires-unloading" style="font-weight: 600; cursor: pointer; color: var(--color-text-main); font-size: 0.9rem; user-select: none;">¿El ingreso requiere servicio de descarga por parte de bodega?</label>
            </div>
            <div id="dec-unloading-warning" style="display: none; padding: 0.75rem; font-size: 0.8rem; background: var(--badge-warning-bg); color: var(--badge-warning-text); border: 1px solid var(--color-warning); margin-top: 0.75rem; border-radius: var(--radius-sm); line-height: 1.45;">
              <i class="ri-alert-line" style="vertical-align: middle; margin-right: 4px; font-size: 1rem;"></i>
              <strong>Nota Importante:</strong> Las descargas se realizan de forma manual en bodega y tienen un costo de <strong>0,1 UF por m³</strong>.
            </div>
          </div>

          <div class="form-group" style="background: var(--color-surface); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--color-border); box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <label class="form-label" style="font-weight: 600; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <span style="font-size: 0.95rem;">Fecha Estimada de Llegada *</span>
              <span id="date-mode-badge" class="badge" style="font-size: 0.7rem; text-transform: uppercase; background-color: var(--badge-info-bg); color: var(--badge-info-text); letter-spacing: 0.5px; font-weight: 700;">Exacta</span>
            </label>
            
            <div style="display: flex; background: rgba(255,255,255,0.03); padding: 0.35rem; border-radius: 8px; border: 1px solid var(--color-border); gap: 0.25rem; margin-bottom: 1.25rem;">
              <button type="button" id="btn-date-exact" style="flex: 1; padding: 0.6rem; font-size: 0.85rem; border-radius: 6px; margin: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: none; background: var(--color-primary); color: white; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
                <i class="ri-calendar-check-line" style="font-size: 1.1rem;"></i> Fecha Exacta
              </button>
              <button type="button" id="btn-date-estimate" style="flex: 1; padding: 0.6rem; font-size: 0.85rem; border-radius: 6px; margin: 0; border: none; background: transparent; color: var(--color-text-muted); font-weight: 500; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.4rem;" onmouseover="if(this.style.background==='transparent') this.style.background='rgba(255,255,255,0.05)'" onmouseout="if(this.style.color==='var(--color-text-muted)') this.style.background='transparent'">
                <i class="ri-timer-line" style="font-size: 1.1rem;"></i> Plazo Estimativo
              </button>
            </div>
            
            <!-- Exact Date Picker Container -->
            <div id="dec-date-exact-container">
              <div id="mini-calendar-wrapper"></div>
              <div id="dec-date-selected-label" style="font-size: 0.85rem; margin-top: 0.5rem; color: var(--color-text-main); font-weight: 500;">
                <span style="color: var(--color-text-muted);">Ninguna fecha seleccionada</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.35rem; display: flex; align-items: center; gap: 4px;">
                <i class="ri-time-line" style="color: var(--color-primary);"></i> Horario de recepción: <strong>11:00 a 16:00 hrs.</strong>
              </div>
              <div id="dec-date-warning" class="alert alert-warning" style="display: none; padding: 0.5rem; font-size: 0.8rem; background: var(--badge-warning-bg); color: var(--badge-warning-text); border: 1px solid var(--color-warning); margin-top: 0.5rem; border-radius: var(--radius-sm); line-height: 1.4;"></div>
              <div id="dec-date-error" class="alert alert-error" style="display: none; padding: 0.5rem; font-size: 0.8rem; background: var(--badge-danger-bg); color: var(--badge-danger-text); border: 1px solid var(--color-danger); margin-top: 0.5rem; border-radius: var(--radius-sm); line-height: 1.4;"></div>
            </div>
            
            <!-- Estimate Picker Container -->
            <div id="dec-date-estimate-container" style="display: none;">
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">Ingresa el plazo estimado para el arribo de la mercadería:</p>
              <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                <input type="number" id="dec-period-qty" class="form-input" min="1" value="1" style="width: 80px;">
                <select id="dec-period-unit" class="form-input" style="flex: 1;">
                  <option value="semanas">Semanas</option>
                  <option value="meses">Meses</option>
                </select>
              </div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); display: flex; align-items: center; gap: 4px;">
                <i class="ri-time-line" style="color: var(--color-primary);"></i> Horario de recepción: <strong>11:00 a 16:00 hrs.</strong>
              </div>
            </div>
          </div>

          <div class="form-group" style="background: rgba(16, 185, 129, 0.05); padding: 1rem; border-radius: var(--radius-md); border: 1px dashed var(--color-success);">
            <label class="form-label" style="font-weight: 600; display: flex; justify-content: space-between; align-items: center;">
              <span>Planilla Detallada de Ingreso *</span>
              <button type="button" class="btn" style="background: none; border: none; padding: 0; color: var(--color-primary); font-size: 0.85rem; cursor: pointer; text-decoration: underline; font-weight: 600; font-family: var(--font-family);" onclick="downloadDeclarationsTemplate()">
                <i class="ri-download-cloud-line"></i> Descargar Planilla Tipo
              </button>
            </label>
            <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.75rem;">
              Descarga la planilla tipo, llénala con los datos de tus productos y súbela aquí. Formato Excel o CSV.
            </p>
            <input type="file" id="dec-file-input" class="form-input" accept=".xlsx, .xls, .csv" required style="background: var(--color-surface);">
            <div id="dec-file-selected-info" style="font-size: 0.8rem; margin-top: 0.4rem; color: var(--color-text-muted); font-style: italic;"></div>
          </div>

          <div class="form-group">
            <label class="form-label">Datos de Contacto del Comercio</label>
            <input type="text" id="dec-contact-info" class="form-input" placeholder="Nombre, email o teléfono de contacto para este ingreso">
          </div>

          <div class="form-group">
            <label class="form-label">Datos del Transportista (Si aplica)</label>
            <input type="text" id="dec-carrier-info" class="form-input" placeholder="Patente, nombre chofer o empresa de transporte">
          </div>

          <div class="form-group">
            <label class="form-label">Comentarios Adicionales</label>
            <textarea id="dec-notes" class="form-input" rows="2" placeholder="Observaciones generales para el equipo de bodega..."></textarea>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
            <button type="button" id="btn-cancel-edit-declaration" class="btn btn-outline" style="flex: 1; display: none; border-radius: var(--radius-md);" onclick="cancelEditDeclaration()">Cancelar</button>
            <button type="submit" id="btn-submit-declaration" class="btn btn-primary" style="flex: 2; border-radius: var(--radius-md);">Crear Declaración de Ingreso</button>
          </div>
        </form>
      </div>
    `;

    appContent.innerHTML = getObserverBanner() + `
      <div style="display: grid; grid-template-columns: 1fr; gap: 1.5rem; align-items: start;" id="dec-view-container">
        <!-- Columna 1: Formulario -->
        <div id="dec-form-col">
          ${formHtml}
        </div>
        
        <!-- Columna 2: Tabla Resumen -->
        <div id="dec-table-col" class="card">
          <div class="card-header" style="border-bottom: 1px solid var(--color-border); padding-bottom: 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3>Mis Declaraciones de Ingreso</h3>
              <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">Historial y estado de tus ingresos declarados.</p>
            </div>
            <button class="btn btn-outline" style="padding: 0.4rem 0.75rem; font-size: 0.85rem; border-color: var(--color-border);" id="btn-refresh-declarations">
              <i class="ri-refresh-line"></i> Actualizar
            </button>
          </div>
          <div class="card-body" style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Título / Descripción</th>
                  <th>Llegada Estimada</th>
                  <th>Cant. Uds</th>
                  <th>Bultos</th>
                  <th>Método Envío</th>
                  <th>Estado</th>
                  <th>Recibido / Incidencias</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="declarations-table-body">
                <tr><td colspan="8" class="text-center" style="padding: 1.5rem; color: var(--color-text-muted);">Cargando declaraciones...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Responsive layout
    const updateLayout = () => {
      const container = document.getElementById('dec-view-container');
      if (container) {
        if (window.innerWidth >= 1024) {
          container.style.gridTemplateColumns = '380px 1fr';
        } else {
          container.style.gridTemplateColumns = '1fr';
        }
      }
    };
    updateLayout();
    window.removeEventListener('resize', updateLayout);
    window.addEventListener('resize', updateLayout);

    // Initial table load
    fetchAndRenderClientDeclarations();

    // Refresh button
    const refreshBtn = document.getElementById('btn-refresh-declarations');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fetchAndRenderClientDeclarations();
      });
    }

    // Info button
    const infoBtn = document.getElementById('btn-info-declarations');
    if (infoBtn) {
      infoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showDeclarationsInfoModal();
      });
    }

    if (!isObserver) {
      // Date Mode Toggle Logic
      const btnExact = document.getElementById('btn-date-exact');
      const btnEstimate = document.getElementById('btn-date-estimate');
      const containerExact = document.getElementById('dec-date-exact-container');
      const containerEstimate = document.getElementById('dec-date-estimate-container');
      const dateModeBadge = document.getElementById('date-mode-badge');
      
      let dateMode = 'exact'; // 'exact' or 'estimate'

      btnExact.addEventListener('click', (e) => {
        e.preventDefault();
        dateMode = 'exact';
        
        btnExact.style.background = 'var(--color-primary)';
        btnExact.style.color = 'white';
        btnExact.style.fontWeight = '600';
        btnExact.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        
        btnEstimate.style.background = 'transparent';
        btnEstimate.style.color = 'var(--color-text-muted)';
        btnEstimate.style.fontWeight = '500';
        btnEstimate.style.boxShadow = 'none';
        
        containerExact.style.display = 'block';
        containerEstimate.style.display = 'none';
        dateModeBadge.textContent = 'Exacta';
        dateModeBadge.style.backgroundColor = 'var(--badge-info-bg)';
        dateModeBadge.style.color = 'var(--badge-info-text)';
      });

      btnEstimate.addEventListener('click', (e) => {
        e.preventDefault();
        dateMode = 'estimate';
        
        btnEstimate.style.background = 'var(--color-primary)';
        btnEstimate.style.color = 'white';
        btnEstimate.style.fontWeight = '600';
        btnEstimate.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        
        btnExact.style.background = 'transparent';
        btnExact.style.color = 'var(--color-text-muted)';
        btnExact.style.fontWeight = '500';
        btnExact.style.boxShadow = 'none';
        
        containerExact.style.display = 'none';
        containerEstimate.style.display = 'block';
        dateModeBadge.textContent = 'Estimativo';
        dateModeBadge.style.backgroundColor = 'var(--badge-warning-bg)';
        dateModeBadge.style.color = 'var(--badge-warning-text)';
      });

      // Render calendar picker
      const miniCalWrapper = document.getElementById('mini-calendar-wrapper');
      if (miniCalWrapper) {
        drawMiniCalendar(miniCalWrapper, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());
      }

      // Bind checkbox toggles for container, pallet, and box counts
      const bindNoEnvioToggle = (checkboxId, inputId) => {
        const checkbox = document.getElementById(checkboxId);
        const input = document.getElementById(inputId);
        if (checkbox && input) {
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              input.disabled = true;
              input.value = '';
              input.removeAttribute('required');
            } else {
              input.disabled = false;
              input.setAttribute('required', 'required');
            }
          });
        }
      };

      bindNoEnvioToggle('dec-no-container', 'dec-container-count');
      bindNoEnvioToggle('dec-no-pallet', 'dec-pallet-count');
      bindNoEnvioToggle('dec-no-box', 'dec-box-count');

      // Bind unloading service warning toggle
      const requiresUnloadingCb = document.getElementById('dec-requires-unloading');
      const unloadingWarning = document.getElementById('dec-unloading-warning');
      if (requiresUnloadingCb && unloadingWarning) {
        requiresUnloadingCb.addEventListener('change', () => {
          unloadingWarning.style.display = requiresUnloadingCb.checked ? 'block' : 'none';
        });
      }

      // File Input Change
      const fileInput = document.getElementById('dec-file-input');
      const fileInfo = document.getElementById('dec-file-selected-info');
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
          clientUploadedFileBase64 = '';
          clientUploadedFileName = '';
          fileInfo.textContent = '';
          return;
        }

        const ext = file.name.split('.').pop().toLowerCase();
        if (['xlsx', 'xls', 'csv'].indexOf(ext) === -1) {
          alert('Formato de archivo no válido. Debe subir una planilla .xlsx, .xls o .csv.');
          fileInput.value = '';
          clientUploadedFileBase64 = '';
          clientUploadedFileName = '';
          fileInfo.textContent = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = function(evt) {
          clientUploadedFileBase64 = evt.target.result.split(',')[1];
          clientUploadedFileName = file.name;
          fileInfo.textContent = `Archivo seleccionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        };
        reader.onerror = function() {
          alert('Error al leer el archivo. Intente de nuevo.');
          fileInput.value = '';
          clientUploadedFileBase64 = '';
          clientUploadedFileName = '';
          fileInfo.textContent = '';
        };
        reader.readAsDataURL(file);
      });

      // Submit Form
      const form = document.getElementById('form-new-declaration');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = document.getElementById('dec-title').value.trim();
        const qtyDeclared = parseInt(document.getElementById('dec-qty-declared').value);
        
        const noContainer = document.getElementById('dec-no-container').checked;
        const noPallet = document.getElementById('dec-no-pallet').checked;
        const noBox = document.getElementById('dec-no-box').checked;

        const containerCount = noContainer ? 0 : (parseInt(document.getElementById('dec-container-count').value) || 0);
        const palletCount = noPallet ? 0 : (parseInt(document.getElementById('dec-pallet-count').value) || 0);
        const boxCount = noBox ? 0 : (parseInt(document.getElementById('dec-box-count').value) || 0);

        const totalPackages = containerCount + palletCount + boxCount;
        if (totalPackages < 1) {
          alert('Debe declarar al menos 1 bulto total (contenedores, pallets o cajas).');
          return;
        }

        // Determinar tipo de bulto
        let packageType = 'Mixto';
        const activeTypes = [];
        if (containerCount > 0) activeTypes.push('Contenedores');
        if (palletCount > 0) activeTypes.push('Pallets');
        if (boxCount > 0) activeTypes.push('Cajas');

        if (activeTypes.length === 1) {
          packageType = activeTypes[0];
        }

        const requiresUnloading = document.getElementById('dec-requires-unloading').checked;
        
        const deliveryMethod = document.getElementById('dec-delivery-method').value;
        const contactInfo = document.getElementById('dec-contact-info').value.trim();
        const carrierInfo = document.getElementById('dec-carrier-info').value.trim();
        const notes = document.getElementById('dec-notes').value.trim();

        if (!title) {
          alert('El título o descripción del ingreso es obligatorio.');
          return;
        }

        if (dateMode === 'exact') {
          if (!clientSelectedDateStr) {
            alert('Debes seleccionar una fecha exacta de llegada en el calendario.');
            return;
          }
          const selectedDate = new Date(clientSelectedDateStr + 'T00:00:00');
          const isSunday = selectedDate.getDay() === 0;
          const isSaturday = selectedDate.getDay() === 6;
          const now = new Date();
          const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

          if (selectedDate < todayMidnight) {
            alert('No puedes declarar un ingreso en fechas pasadas.');
            return;
          }
          if (isSunday) {
            alert('No se permiten ingresos los días domingo.');
            return;
          }
          if (isSaturday) {
            const diffTime = selectedDate.getTime() - now.getTime();
            const diffHours = diffTime / (60 * 60 * 1000);
            if (diffHours < 48) {
              alert('Los ingresos en día sábado requieren al menos 48 horas de aviso anticipado.');
              return;
            }
          }
        }

        if (!editingDeclarationId && (!clientUploadedFileBase64 || !clientUploadedFileName)) {
          alert('Es obligatorio adjuntar la planilla detallada de ingreso.');
          return;
        }

        const submitBtn = document.getElementById('btn-submit-declaration');
        submitBtn.disabled = true;
        submitBtn.textContent = editingDeclarationId ? 'Guardando cambios...' : 'Creando declaración...';

        try {
          let estimatedArrivalDate = null;
          let estimatedArrivalPeriod = null;

          if (dateMode === 'exact') {
            estimatedArrivalDate = clientSelectedDateStr;
          } else {
            const pQty = document.getElementById('dec-period-qty').value;
            const pUnit = document.getElementById('dec-period-unit').value;
            estimatedArrivalPeriod = `${pQty} ${pUnit}`;
          }

          const selectedCommerce = document.getElementById('dec-comercio')
            ? document.getElementById('dec-comercio').value
            : (currentCompany ? currentCompany.split(',')[0].trim() : 'STOCKA');

          if (editingDeclarationId) {
            // Fetch current declaration data to get current status and history
            const { data: currentDec, error: getError } = await supabase
              .from('stock_declarations')
              .select('status, history')
              .eq('id', editingDeclarationId)
              .single();
              
            if (getError) throw getError;
            
            const newHistory = (currentDec.history || []).concat({
              status: currentDec.status,
              timestamp: new Date().toISOString(),
              comment: 'Declaración modificada por el cliente.'
            });

            const updateData = {
              comercio: selectedCommerce,
              title: title,
              estimated_arrival_type: dateMode,
              estimated_arrival_date: estimatedArrivalDate,
              estimated_arrival_period: estimatedArrivalPeriod,
              quantity_declared: qtyDeclared,
              package_count: totalPackages,
              package_type: packageType,
              container_count: containerCount,
              pallet_count: palletCount,
              box_count: boxCount,
              requires_unloading: requiresUnloading,
              delivery_method: deliveryMethod,
              contact_info: contactInfo,
              carrier_info: carrierInfo,
              notes: notes,
              history: newHistory
            };

            if (clientUploadedFileName && clientUploadedFileBase64) {
              updateData.file_name = clientUploadedFileName;
              updateData.file_base64 = clientUploadedFileBase64;
            }

            const { error: updateError } = await supabase
              .from('stock_declarations')
              .update(updateData)
              .eq('id', editingDeclarationId);

            if (updateError) throw updateError;
            
            alert('¡Declaración modificada con éxito!');
            cancelEditDeclaration();
          } else {
            const insertData = {
              merchant_id: currentMerchantId,
              comercio: selectedCommerce,
              title: title,
              estimated_arrival_type: dateMode,
              estimated_arrival_date: estimatedArrivalDate,
              estimated_arrival_period: estimatedArrivalPeriod,
              quantity_declared: qtyDeclared,
              quantity_received: 0,
              quantity_incidents: 0,
              package_count: totalPackages,
              package_type: packageType,
              container_count: containerCount,
              pallet_count: palletCount,
              box_count: boxCount,
              requires_unloading: requiresUnloading,
              delivery_method: deliveryMethod,
              contact_info: contactInfo,
              carrier_info: carrierInfo,
              notes: notes,
              status: 'Creada',
              incidents_list: [],
              history: [{
                status: 'Creada',
                timestamp: new Date().toISOString(),
                comment: 'Declaración de ingreso de stock creada y registrada.'
              }],
              file_name: clientUploadedFileName,
              file_base64: clientUploadedFileBase64
            };

            const { error: insertError } = await supabase
              .from('stock_declarations')
              .insert([insertData]);

            if (insertError) throw insertError;

            alert('¡Declaración de ingreso de stock creada con éxito!');
            form.reset();
            
            // Re-enable inputs and reset styles
            const inputs = ['dec-container-count', 'dec-pallet-count', 'dec-box-count'];
            inputs.forEach(id => {
              const el = document.getElementById(id);
              if (el) {
                el.disabled = false;
                el.setAttribute('required', 'required');
              }
            });
            const unloadingWarning = document.getElementById('dec-unloading-warning');
            if (unloadingWarning) unloadingWarning.style.display = 'none';

            clientSelectedDateStr = '';
            clientUploadedFileBase64 = '';
            clientUploadedFileName = '';
            if (fileInfo) fileInfo.textContent = '';
            
            const label = document.getElementById('dec-date-selected-label');
            if (label) label.innerHTML = '<span style="color: var(--color-text-muted);">Ninguna fecha seleccionada</span>';
            
            document.getElementById('dec-date-warning').style.display = 'none';
            document.getElementById('dec-date-error').style.display = 'none';
          }

          // Redraw calendar to clear selection styling
          drawMiniCalendar(miniCalWrapper, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());

          // Reload table
          fetchAndRenderClientDeclarations();
        } catch (err) {
          console.error('Error al guardar declaración:', err);
          alert('Error al guardar declaración: ' + err.message);
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = editingDeclarationId ? 'Guardar Cambios' : 'Crear Declaración de Ingreso';
        }
      });
    }

  } catch (err) {
    console.error('Error rendering declarations view:', err);
    appContent.innerHTML = getObserverBanner() + `<p style="color: red; padding: 2rem;">Error al renderizar el módulo: ${err.message}</p>`;
  }
};

function drawMiniCalendar(container, year, month) {
  const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = firstDay === 0 ? 6 : firstDay - 1; // Mon is 0

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  
  let html = `
    <div class="mini-calendar" style="border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); overflow: hidden; max-width: 100%; margin-top: 0.5rem; box-shadow: var(--shadow-sm);">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: var(--color-surface-hover); border-bottom: 1px solid var(--color-border);">
        <button type="button" id="mini-cal-prev" class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--color-border); background: var(--color-surface); height: auto; line-height: 1;"><i class="ri-arrow-left-s-line"></i></button>
        <span style="font-weight: 600; font-size: 0.85rem; color: var(--color-text-main);">${monthNames[month]} ${year}</span>
        <button type="button" id="mini-cal-next" class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--color-border); background: var(--color-surface); height: auto; line-height: 1;"><i class="ri-arrow-right-s-line"></i></button>
      </div>
      <div style="padding: 0.5rem;">
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-weight: 700; color: var(--color-text-muted); font-size: 0.7rem; margin-bottom: 0.25rem; text-transform: uppercase;">
          <div>Lu</div><div>Ma</div><div>Mi</div><div>Ju</div><div>Vi</div><div>Sá</div><div>Do</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">
  `;

  for (let i = 0; i < startDay; i++) {
    html += `<div></div>`;
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let day = 1; day <= daysInMonth; day++) {
    const dStr = `${year}-${String(month+1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const thisDayDate = new Date(year, month, day);
    const isPast = thisDayDate < todayMidnight;
    const isSunday = thisDayDate.getDay() === 0;
    const isSelected = clientSelectedDateStr === dStr;
    const isToday = dStr === todayStr;

    let cellStyle = `padding: 0.4rem 0.1rem; text-align: center; border-radius: var(--radius-sm); font-size: 0.8rem; cursor: pointer; transition: all 0.2s; min-height: 32px; display: flex; align-items: center; justify-content: center;`;
    
    const isClickable = !isPast && !isSunday;

    if (isPast) {
      cellStyle += ` color: var(--color-text-muted); opacity: 0.35; cursor: not-allowed; text-decoration: line-through;`;
    } else if (isSunday) {
      cellStyle += ` color: var(--color-danger); opacity: 0.4; cursor: not-allowed; background-color: rgba(239, 68, 68, 0.05);`;
    } else if (isSelected) {
      cellStyle += ` background-color: var(--color-primary); color: white; font-weight: 700; box-shadow: 0 2px 4px rgba(37,99,235,0.3);`;
    } else if (isToday) {
      cellStyle += ` background-color: rgba(37, 99, 235, 0.1); color: var(--color-primary); font-weight: 700; border: 1px solid rgba(37, 99, 235, 0.3);`;
    } else {
      cellStyle += ` color: var(--color-text-main); font-weight: 500;`;
    }

    html += `
      <div class="mini-cal-day" data-date="${dStr}" data-past="${isPast}" data-sunday="${isSunday}" style="${cellStyle}" 
           ${isClickable && !isSelected ? `onmouseover="this.style.backgroundColor='var(--color-surface-hover)'" onmouseout="this.style.backgroundColor='transparent'"` : ''}
           title="${isSunday ? 'Domingos no disponibles para ingresos' : ''}">
        ${day}
      </div>
    `;
  }

  html += `</div></div></div>`;
  container.innerHTML = html;

  // Event Listeners for Mini Calendar
  container.querySelector('#mini-cal-prev').addEventListener('click', (e) => {
    e.preventDefault();
    clientCalendarCurrentDate.setMonth(clientCalendarCurrentDate.getMonth() - 1);
    drawMiniCalendar(container, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());
  });

  container.querySelector('#mini-cal-next').addEventListener('click', (e) => {
    e.preventDefault();
    clientCalendarCurrentDate.setMonth(clientCalendarCurrentDate.getMonth() + 1);
    drawMiniCalendar(container, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());
  });

  container.querySelectorAll('.mini-cal-day').forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.preventDefault();
      if (cell.getAttribute('data-past') === 'true') return;
      if (cell.getAttribute('data-sunday') === 'true') {
        alert('No se permiten ingresos los días domingo.');
        return;
      }
      clientSelectedDateStr = cell.getAttribute('data-date');
      drawMiniCalendar(container, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());
      updateDateCheck();
    });
  });
}

function updateDateCheck() {
  const warningContainer = document.getElementById('dec-date-warning');
  const errorContainer = document.getElementById('dec-date-error');
  const selectedLabel = document.getElementById('dec-date-selected-label');
  
  if (!clientSelectedDateStr) {
    selectedLabel.innerHTML = '<span style="color: var(--color-text-muted);">Ninguna fecha seleccionada</span>';
    warningContainer.style.display = 'none';
    errorContainer.style.display = 'none';
    return;
  }
  
  const [y, m, d] = clientSelectedDateStr.split('-');
  selectedLabel.innerHTML = `<strong>Fecha seleccionada:</strong> ${d}/${m}/${y}`;
  
  const now = new Date();
  const selectedDate = new Date(clientSelectedDateStr + 'T00:00:00'); // Midnight of selected day
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const isSunday = selectedDate.getDay() === 0;
  const isSaturday = selectedDate.getDay() === 6;

  if (selectedDate < todayMidnight) {
    errorContainer.style.display = 'block';
    errorContainer.textContent = '❌ No puedes declarar un ingreso en fechas pasadas.';
    warningContainer.style.display = 'none';
  } else if (isSunday) {
    errorContainer.style.display = 'block';
    errorContainer.textContent = '❌ No se permiten ingresos los días domingo.';
    warningContainer.style.display = 'none';
  } else if (isSaturday) {
    const diffTime = selectedDate.getTime() - now.getTime();
    const diffHours = diffTime / (60 * 60 * 1000);
    
    if (diffHours < 48) {
      errorContainer.style.display = 'block';
      errorContainer.innerHTML = `❌ Los ingresos en día sábado requieren al menos <strong>48 horas de aviso anticipado</strong> y aprobación previa.`;
      warningContainer.style.display = 'none';
    } else {
      warningContainer.style.display = 'block';
      warningContainer.innerHTML = `<i class="ri-error-warning-line"></i> <strong>Aviso Sábado:</strong> Los ingresos en día sábado solo podrán realizarse con aviso anticipado de 48 hrs y están sujetos a la <strong>aprobación del equipo de Stocka</strong>.`;
      errorContainer.style.display = 'none';
    }
  } else if ((selectedDate.getTime() - now.getTime()) < 24 * 60 * 60 * 1000) {
    // Less than 24 hours from current time
    warningContainer.style.display = 'block';
    warningContainer.innerHTML = `<i class="ri-error-warning-line"></i> <strong>Advertencia:</strong> La declaración se realiza con menos de 24 horas de anticipación. El costo de ingresar dicho stock será de <strong>0.75 UF x m³</strong>.`;
    errorContainer.style.display = 'none';
  } else {
    warningContainer.style.display = 'none';
    errorContainer.style.display = 'none';
  }
}

async function fetchAndRenderClientDeclarations() {
  const listTableBody = document.getElementById('declarations-table-body');
  if (!listTableBody) return;
  
  listTableBody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 1.5rem; color: var(--color-text-muted);">Cargando declaraciones...</td></tr>`;
  
  try {
    const { data: declarations, error } = await supabase
      .from('stock_declarations')
      .select('*, warehouses(name, address, comuna)')
      .eq('merchant_id', currentMerchantId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    if (!declarations || declarations.length === 0) {
      listTableBody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No tienes declaraciones creadas.</td></tr>`;
      return;
    }
    
    let html = '';
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
      
      const isEditable = ['Creada', 'Bodega Asignada', 'En Recepción - Pendiente Conteo', 'En proceso de conteo/clasificación'].indexOf(dec.status) !== -1;
      const editButtonHtml = isEditable ? `
        <button class="btn btn-outline" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; border-color: var(--color-primary); color: var(--color-primary); height: auto; font-family: var(--font-family);" onclick="editDeclaration('${dec.id}')" title="Editar Declaración">
          <i class="ri-edit-line" style="font-size: 0.9rem; margin-right: 2px;"></i> Editar
        </button>
      ` : '';

      html += `
        <tr style="transition: background-color 0.2s;">
          <td style="font-weight: 500; color: var(--color-text-main); font-family: var(--font-family); font-size: 0.9rem;">
            ${dec.title}
            <div style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 400; margin-top: 2px;">
              <i class="ri-store-2-line" style="vertical-align: text-bottom; margin-right: 2px;"></i> ${dec.comercio || 'STOCKA'}
            </div>
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
          <td style="font-size: 0.85rem;"><span style="font-size: 0.8rem; background: var(--color-surface-hover); padding: 0.2rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); font-family: var(--font-family);">${dec.delivery_method}</span></td>
          <td style="font-size: 0.85rem;">${statusBadge}</td>
          <td style="font-size: 0.85rem;">${qtyReceivedText}</td>
          <td style="font-size: 0.85rem;">
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              <button class="btn btn-outline" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; border-color: var(--color-border); height: auto; font-family: var(--font-family);" onclick="downloadBase64File('${dec.file_base64}', '${dec.file_name}')" title="Descargar Planilla Detalle">
                <i class="ri-file-excel-2-line" style="color: var(--color-success); font-size: 0.9rem; margin-right: 2px;"></i> Planilla
              </button>
              ${editButtonHtml}
              <button class="btn btn-primary" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; background-color: var(--color-accent); height: auto; font-family: var(--font-family);" onclick="viewDeclarationDetail('${dec.id}')" title="Ver Detalles">
                <i class="ri-eye-line" style="font-size: 0.9rem; margin-right: 2px;"></i> Detalle
              </button>
            </div>
          </td>
        </tr>
      `;
    });
    
    listTableBody.innerHTML = html;
  } catch (err) {
    console.error('Error fetching client declarations:', err);
    listTableBody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 1.5rem; color: var(--color-danger);">Error al cargar declaraciones: ${err.message}</td></tr>`;
  }
}

window.viewDeclarationDetail = async function(id) {
  try {
    const { data: dec, error } = await supabase
      .from('stock_declarations')
      .select('*, warehouses(name, address, comuna, operating_days)')
      .eq('id', id)
      .single();
      
    if (error) throw error;
    
    const modalId = 'modal-client-dec-detail';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();
    
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay active';
    
    let etaText = '';
    if (dec.estimated_arrival_type === 'exact') {
      const [y, m, d] = dec.estimated_arrival_date.split('-');
      etaText = `${d}/${m}/${y}`;
    } else {
      etaText = dec.estimated_arrival_period;
    }

    const progressPercent = dec.quantity_declared > 0 
      ? Math.min(100, Math.round((dec.quantity_received / dec.quantity_declared) * 100))
      : 0;

    let detailStatusBadgeColor = 'var(--badge-neutral-bg)';
    let detailStatusTextColor = 'var(--badge-neutral-text)';
    switch (dec.status) {
      case 'Creada':
        detailStatusBadgeColor = 'var(--badge-neutral-bg)';
        detailStatusTextColor = 'var(--badge-neutral-text)';
        break;
      case 'Bodega Asignada':
        detailStatusBadgeColor = 'rgba(37, 99, 235, 0.1)';
        detailStatusTextColor = 'var(--color-primary)';
        break;
      case 'En Recepción - Pendiente Conteo':
        detailStatusBadgeColor = 'var(--badge-info-bg)';
        detailStatusTextColor = 'var(--badge-info-text)';
        break;
      case 'En proceso de conteo/clasificación':
        detailStatusBadgeColor = 'var(--badge-warning-bg)';
        detailStatusTextColor = 'var(--badge-warning-text)';
        break;
      case 'Recibido Conforme':
        detailStatusBadgeColor = 'var(--badge-success-bg)';
        detailStatusTextColor = 'var(--badge-success-text)';
        break;
      case 'Recibido con Incidencias':
        detailStatusBadgeColor = 'var(--badge-danger-bg)';
        detailStatusTextColor = 'var(--badge-danger-text)';
        break;
    }

    let incidentsHtml = '';
    const incidents = dec.incidents_list || [];
    if (incidents.length > 0) {
      incidentsHtml = `
        <div style="margin-bottom: 1.5rem; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 1.25rem;">
          <h4 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: var(--color-danger); display: flex; align-items: center; gap: 0.5rem; font-family: var(--font-family);">
            <i class="ri-error-warning-line" style="font-size: 1.2rem;"></i> Detalle de Incidencias en Recepción
          </h4>
          <ol style="margin: 0; padding-left: 1.2rem; color: var(--color-text-main); font-size: 0.9rem; font-family: var(--font-family);">
            ${incidents.map(inc => `<li style="margin-bottom: 0.35rem;">${inc}</li>`).join('')}
          </ol>
        </div>
      `;
    }

    let historyTimelineHtml = '';
    const history = dec.history || [];
    if (history.length > 0) {
      let stepsHtml = '';
      history.forEach((step, index) => {
        const isLast = index === history.length - 1;
        const dateObj = new Date(step.timestamp);
        
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const formattedDate = `${day}/${month}/${year} ${hours}:${minutes}`;
        
        let statusBadgeColor = 'var(--badge-neutral-bg)';
        let statusTextColor = 'var(--badge-neutral-text)';
        switch (step.status) {
          case 'Creada':
            statusBadgeColor = 'var(--badge-neutral-bg)';
            statusTextColor = 'var(--badge-neutral-text)';
            break;
          case 'Bodega Asignada':
            statusBadgeColor = 'rgba(37, 99, 235, 0.1)';
            statusTextColor = 'var(--color-primary)';
            break;
          case 'En Recepción - Pendiente Conteo':
            statusBadgeColor = 'var(--badge-info-bg)';
            statusTextColor = 'var(--badge-info-text)';
            break;
          case 'En proceso de conteo/clasificación':
            statusBadgeColor = 'var(--badge-warning-bg)';
            statusTextColor = 'var(--badge-warning-text)';
            break;
          case 'Recibido Conforme':
            statusBadgeColor = 'var(--badge-success-bg)';
            statusTextColor = 'var(--badge-success-text)';
            break;
          case 'Recibido con Incidencias':
            statusBadgeColor = 'var(--badge-danger-bg)';
            statusTextColor = 'var(--badge-danger-text)';
            break;
        }

        stepsHtml += `
          <div style="display: flex; gap: 1rem; position: relative; margin-bottom: 1.25rem; font-family: var(--font-family);">
            ${!isLast ? `<div style="position: absolute; left: 15px; top: 30px; bottom: -20px; width: 2px; background: var(--color-border); z-index: 1;"></div>` : ''}
            
            <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--color-surface); border: 2px solid ${isLast ? 'var(--color-primary)' : 'var(--color-border)'}; display: flex; align-items: center; justify-content: center; z-index: 2; flex-shrink: 0; box-shadow: var(--shadow-sm);">
              <div style="width: 10px; height: 10px; border-radius: 50%; background: ${isLast ? 'var(--color-primary)' : 'var(--color-text-muted)'};"></div>
            </div>
            
            <div style="flex: 1; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 0.75rem 1rem; box-shadow: var(--shadow-sm);">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.35rem;">
                <span class="badge" style="background-color: ${statusBadgeColor}; color: ${statusTextColor}; font-size: 0.75rem; font-weight: 700;">${step.status}</span>
                <span style="font-size: 0.75rem; color: var(--color-text-muted);"><i class="ri-time-line"></i> ${formattedDate}</span>
              </div>
              <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-main); font-weight: 500; line-height: 1.4;">${step.comment || ''}</p>
            </div>
          </div>
        `;
      });

      historyTimelineHtml = `
        <div style="margin-bottom: 1.5rem; font-family: var(--font-family);">
          <h4 style="margin: 0 0 1rem 0; font-size: 0.95rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-history-line" style="color: var(--color-primary);"></i> Historial de Avance
          </h4>
          <div style="display: flex; flex-direction: column;">
            ${stepsHtml}
          </div>
        </div>
      `;
    }
    
    modal.innerHTML = `
      <style>
        @keyframes slideInUpDetail {
          from { opacity: 0; transform: translateY(30px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .dec-detail-card {
          animation: slideInUpDetail 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .copy-btn {
          background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; width: 32px; height: 32px; 
          color: var(--color-text-muted); cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center;
        }
        .copy-btn:hover { color: var(--color-primary); border-color: var(--color-primary); background: rgba(59, 130, 246, 0.05); }
        .info-block { transition: transform 0.2s, box-shadow 0.2s; }
        .info-block:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
      </style>
      <div class="modal-content dec-detail-card" style="max-width: 650px; border-radius: 12px; overflow: hidden; padding: 0; box-shadow: 0 20px 40px rgba(0,0,0,0.4); border: 1px solid var(--color-border);">
        <div class="modal-header" style="padding: 1.5rem; border-bottom: 1px solid var(--color-border); background: linear-gradient(145deg, var(--color-surface) 0%, var(--color-bg) 100%); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; display: flex; align-items: center; gap: 0.75rem; font-family: var(--font-family); font-size: 1.25rem;">
            <div style="background: rgba(59, 130, 246, 0.15); padding: 0.5rem; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <i class="ri-inbox-archive-line" style="color: var(--color-primary); font-size: 1.2rem;"></i>
            </div>
            Detalle de Ingreso de Stock
          </h3>
          <button class="modal-close" onclick="document.getElementById('${modalId}').remove()" style="background: var(--color-surface-hover); border: none; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text-muted); transition: all 0.2s;">
            <i class="ri-close-line" style="font-size: 1.2rem;"></i>
          </button>
        </div>
        
        <div class="modal-body" style="font-size: 0.95rem; line-height: 1.6; padding: 1.5rem; max-height: 75vh; overflow-y: auto; font-family: var(--font-family); background: var(--color-bg);">
          
          <!-- Summary Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
            <div class="info-block" style="background: var(--color-surface); padding: 1rem; border-radius: 10px; border: 1px solid var(--color-border); position: relative;">
              <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Información General</span>
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="padding-right: 0.5rem;">
                  <strong style="color: var(--color-text-main); font-size: 1.05rem; display: block; margin-bottom: 0.2rem;">${dec.title}</strong>
                  <div style="color: var(--color-text-muted); font-size: 0.85rem; margin-bottom: 0.2rem;"><i class="ri-calendar-event-line" style="vertical-align: text-bottom; margin-right: 3px;"></i> ${etaText}</div>
                  <div style="color: var(--color-text-muted); font-size: 0.85rem;"><i class="ri-store-2-line" style="vertical-align: text-bottom; margin-right: 3px;"></i> Comercio: <strong>${dec.comercio || 'STOCKA'}</strong></div>
                </div>
                <button class="copy-btn" onclick="navigator.clipboard.writeText('${dec.title}'); this.innerHTML='<i class=\\'ri-check-line\\'></i>'; setTimeout(() => this.innerHTML='<i class=\\'ri-clipboard-line\\'></i>', 2000);" title="Copiar Título"><i class="ri-clipboard-line"></i></button>
              </div>
            </div>

            <div class="info-block" style="background: var(--color-surface); padding: 1rem; border-radius: 10px; border: 1px solid var(--color-border); display: flex; flex-direction: column; justify-content: center; align-items: flex-start;">
              <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; letter-spacing: 0.5px; display: block; margin-bottom: 0.5rem;">Estado Actual</span>
              <span class="badge" style="background-color: ${detailStatusBadgeColor}; color: ${detailStatusTextColor}; font-weight: 700; font-size: 0.85rem; padding: 0.4rem 0.8rem; text-transform: uppercase; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.1);">${dec.status}</span>
            </div>
          </div>

          <!-- Grid Logistics -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
            <div style="background: var(--color-surface); padding: 1rem; border-radius: 10px; border-left: 4px solid var(--color-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 600; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px;">Bultos Totales</div>
              <div style="font-size: 1.25rem; font-weight: 700; color: var(--color-text-main);">${dec.package_count} <span style="font-size: 0.85rem; font-weight: normal; color: var(--color-text-muted); background: var(--color-bg); padding: 0.1rem 0.4rem; border-radius: 4px;">${dec.package_type}</span></div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.35rem;">
                Detalle: <strong>${dec.container_count || 0}</strong> cont., <strong>${dec.pallet_count || 0}</strong> pall., <strong>${dec.box_count || 0}</strong> caj.
              </div>
            </div>
            <div style="background: var(--color-surface); padding: 1rem; border-radius: 10px; border-left: 4px solid var(--color-accent); box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 600; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px;">Método de Envío</div>
              <div style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;"><i class="ri-truck-line" style="color: var(--color-accent);"></i> ${dec.delivery_method}</div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.35rem;">
                Descarga en bodega: <strong>${dec.requires_unloading ? 'Sí, solicitada (0.1 UF x m³)' : 'No requerida'}</strong>
              </div>
            </div>
          </div>

          <!-- Bodega Asignada Block -->
          ${dec.warehouses ? `
          <div class="info-block" style="background: var(--color-surface); padding: 1rem; border-radius: 10px; border: 1px solid var(--color-border); border-left: 4px solid var(--color-primary); margin-bottom: 1.5rem; display: flex; align-items: flex-start; gap: 1rem;">
            <div style="background: rgba(37, 99, 235, 0.1); padding: 0.5rem; border-radius: 8px; color: var(--color-primary); display: flex; align-items: center; justify-content: center;">
              <i class="ri-map-pin-line" style="font-size: 1.3rem;"></i>
            </div>
            <div style="flex: 1;">
              <strong style="display: block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin-bottom: 0.25rem;">Bodega de Ingreso Asignada</strong>
              <div style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main);">${dec.warehouses.name}</div>
              <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.2rem;">
                Dirección: <strong>${dec.warehouses.address}</strong>, Comuna: <strong>${dec.warehouses.comuna}</strong>
              </div>
              <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.2rem;">
                Días de Operación: <strong>${dec.warehouses.operating_days}</strong>
              </div>
            </div>
          </div>
          ` : ''}
          
          <!-- Quantities Table -->
          <div style="margin-bottom: 1.5rem; background: var(--color-surface); border-radius: 10px; border: 1px solid var(--color-border); overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
            <div style="background: rgba(0,0,0,0.1); padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
              <h4 style="margin: 0; font-size: 0.95rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;"><i class="ri-bar-chart-box-line" style="color: var(--color-primary);"></i> Progreso de Recepción</h4>
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--color-success); background: rgba(16, 185, 129, 0.1); padding: 0.2rem 0.5rem; border-radius: 4px;">${progressPercent}% Completado</span>
            </div>
            <table style="width: 100%; text-align: left; border-collapse: collapse;">
              <thead>
                <tr style="background: rgba(0,0,0,0.02);">
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Declaradas</th>
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Recepcionadas</th>
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Incidencias</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 1.25rem; font-size: 1.2rem; font-weight: 600; color: var(--color-text-main); border-right: 1px dashed var(--color-border);">${dec.quantity_declared}</td>
                  <td style="padding: 1.25rem; font-size: 1.2rem; font-weight: 700; color: var(--color-success); border-right: 1px dashed var(--color-border);">${dec.quantity_received}</td>
                  <td style="padding: 1.25rem; font-size: 1.2rem; font-weight: 600; color: ${dec.quantity_incidents > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)'};">${dec.quantity_incidents}</td>
                </tr>
              </tbody>
            </table>
            <!-- Progress Bar -->
            <div style="height: 4px; width: 100%; background: rgba(0,0,0,0.1); position: relative;">
              <div style="position: absolute; left: 0; top: 0; height: 100%; width: ${progressPercent}%; background: var(--color-success); border-radius: 0 2px 2px 0; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);"></div>
            </div>
          </div>
          
          ${incidentsHtml}
          
          ${historyTimelineHtml}
          
          <!-- Contact Accordions / Sections -->
          <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem;">
            <div class="info-block" style="background: var(--color-surface); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--color-border); display: flex; align-items: flex-start; gap: 1rem;">
              <div style="background: var(--color-bg); padding: 0.6rem; border-radius: 50%; color: var(--color-primary); box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);"><i class="ri-user-line" style="font-size: 1.2rem;"></i></div>
              <div style="flex: 1;">
                <strong style="display: block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin-bottom: 0.35rem;">Contacto Comercio</strong>
                <div style="font-size: 0.95rem; color: var(--color-text-main); white-space: pre-wrap; font-weight: 500;">${dec.contact_info || '<span style="color:var(--color-text-muted); font-style:italic; font-weight: normal;">Sin registrar</span>'}</div>
              </div>
            </div>

            <div class="info-block" style="background: var(--color-surface); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--color-border); display: flex; align-items: flex-start; gap: 1rem;">
              <div style="background: var(--color-bg); padding: 0.6rem; border-radius: 50%; color: var(--color-accent); box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);"><i class="ri-truck-line" style="font-size: 1.2rem;"></i></div>
              <div style="flex: 1;">
                <strong style="display: block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin-bottom: 0.35rem;">Datos del Transportista</strong>
                <div style="font-size: 0.95rem; color: var(--color-text-main); white-space: pre-wrap; font-weight: 500;">${dec.carrier_info || '<span style="color:var(--color-text-muted); font-style:italic; font-weight: normal;">Sin registrar</span>'}</div>
              </div>
            </div>
          </div>
          
          <!-- Notes -->
          <div style="background: rgba(245, 158, 11, 0.05); border-left: 4px solid var(--color-warning); padding: 1.25rem; border-radius: 0 10px 10px 0; margin-bottom: 1rem; border-top: 1px solid rgba(245,158,11,0.1); border-right: 1px solid rgba(245,158,11,0.1); border-bottom: 1px solid rgba(245,158,11,0.1);">
            <strong style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--color-warning); margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">
              <i class="ri-message-2-line" style="font-size: 1.1rem;"></i> Comentarios del Cliente (Tus Notas)
            </strong>
            <p style="margin: 0; font-size: 0.95rem; font-style: italic; color: var(--color-text-main); white-space: pre-wrap; line-height: 1.5;">"${dec.notes || 'Sin comentarios'}"</p>
          </div>
          
          <div style="background: rgba(37, 99, 235, 0.05); border-left: 4px solid var(--color-primary); padding: 1.25rem; border-radius: 0 10px 10px 0; border-top: 1px solid rgba(37,99,235,0.1); border-right: 1px solid rgba(37,99,235,0.1); border-bottom: 1px solid rgba(37,99,235,0.1);">
            <strong style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--color-primary); margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">
              <i class="ri-shield-check-line" style="font-size: 1.1rem;"></i> Notas de Recepción del Administrador
            </strong>
            <p style="margin: 0; font-size: 0.95rem; color: var(--color-text-main); font-weight: 500; white-space: pre-wrap; line-height: 1.5;">${dec.admin_notes || 'El ingreso aún no ha sido procesado por bodega o no registra notas de recepción.'}</p>
          </div>

        </div>
        
        <div class="modal-footer" style="padding: 1.25rem 1.5rem; border-top: 1px solid var(--color-border); background: var(--color-surface); display: flex; justify-content: flex-end; gap: 1rem;">
          <button class="btn btn-outline" onclick="document.getElementById('${modalId}').remove()" style="padding: 0.6rem 1.5rem; font-weight: 600; border-radius: 8px; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            Cerrar Detalle
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  } catch (err) {
    console.error('Error viewing declaration detail:', err);
    alert('Error al obtener los detalles: ' + err.message);
  }
};

window.showDeclarationsInfoModal = function() {
  const modalId = 'modal-declarations-info';
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <style>
      @keyframes slideInUpInfo {
        from { opacity: 0; transform: translateY(20px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .dec-info-card {
        animation: slideInUpInfo 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
    </style>
    <div class="modal-content dec-info-card" style="max-width: 550px; border-radius: 12px; overflow: hidden; padding: 0; box-shadow: 0 20px 40px rgba(0,0,0,0.4); border: 1px solid var(--color-border); background: var(--color-bg);">
      <div class="modal-header" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-border); background: linear-gradient(145deg, var(--color-surface) 0%, var(--color-bg) 100%); display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; display: flex; align-items: center; gap: 0.5rem; font-size: 1.15rem; font-family: var(--font-family); color: var(--color-text-main);">
          <i class="ri-information-line" style="color: var(--color-primary); font-size: 1.25rem;"></i>
          Información y Recomendaciones de Ingreso
        </h3>
        <button type="button" class="modal-close" onclick="document.getElementById('${modalId}').remove()" style="background: var(--color-surface-hover); border: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text-muted);">
          <i class="ri-close-line"></i>
        </button>
      </div>
      <div class="modal-body" style="padding: 1.5rem; font-family: var(--font-family); max-height: 70vh; overflow-y: auto; font-size: 0.9rem; color: var(--color-text-main);">
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          
          <div style="display: flex; gap: 0.75rem; background: var(--color-surface); padding: 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="color: var(--color-primary); font-size: 1.25rem; display: flex; align-items: center;"><i class="ri-time-line"></i></div>
            <div>
              <strong style="display: block; margin-bottom: 0.15rem; color: var(--color-text-main);">Aviso Anticipado</strong>
              <span style="color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.4;">Se sugiere realizar el aviso anticipado de ingreso de stock con al menos <strong>48 horas</strong> de anticipación.</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; background: var(--color-surface); padding: 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="color: var(--color-primary); font-size: 1.25rem; display: flex; align-items: center;"><i class="ri-time-line"></i></div>
            <div>
              <strong style="display: block; margin-bottom: 0.15rem; color: var(--color-text-main);">Horarios de Ingreso</strong>
              <span style="color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.4;">El horario establecido para la recepción física de stock en bodega es entre las <strong>11:00 y las 16:00 hrs</strong>.</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; background: var(--color-surface); padding: 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="color: var(--color-success); font-size: 1.25rem; display: flex; align-items: center;"><i class="ri-global-line"></i></div>
            <div>
              <strong style="display: block; margin-bottom: 0.15rem; color: var(--color-text-main);">Ingresos desde el Exterior</strong>
              <span style="color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.4;">Se recomienda crear la declaración en el momento en que la carga está saliendo del país de origen o cuando se informa su arribo al país.</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; background: var(--color-surface); padding: 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="color: var(--color-warning); font-size: 1.25rem; display: flex; align-items: center;"><i class="ri-scales-3-line"></i></div>
            <div>
              <strong style="display: block; margin-bottom: 0.15rem; color: var(--color-text-main);">Volumen y Cargos Adicionales</strong>
              <span style="color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.4;">Si el ingreso supera el volumen de <strong>1 m³</strong>, aplicará un cargo de ingreso de stock de <strong>0.1 UF x m³</strong>.</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; background: var(--color-surface); padding: 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="color: var(--color-primary); font-size: 1.25rem; display: flex; align-items: center;"><i class="ri-checkbox-circle-line"></i></div>
            <div>
              <strong style="display: block; margin-bottom: 0.15rem; color: var(--color-text-main);">Plazo de Disponibilidad</strong>
              <span style="color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.4;">Una vez recepcionado el stock, considere un plazo de al menos <strong>24 a 48 horas</strong> para disponibilizar los productos para pedidos (conteo, clasificación y ubicación en estanterías).</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; background: var(--color-surface); padding: 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="color: var(--color-danger); font-size: 1.25rem; display: flex; align-items: flex-start; padding-top: 2px;"><i class="ri-error-warning-line"></i></div>
            <div>
              <strong style="display: block; margin-bottom: 0.15rem; color: var(--color-text-main);">Ampliación de Plazos</strong>
              <span style="color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.4;">El plazo de disponibilidad puede ser mayor si la bodega lo sugiere. Factores que amplían los plazos:
                <ul style="margin: 0.25rem 0 0 1.2rem; padding: 0; list-style-type: disc;">
                  <li>Productos no identificados con código de barras.</li>
                  <li>Ingreso con más de 20 SKU diferentes.</li>
                  <li>El stock llega desordenado.</li>
                </ul>
              </span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; background: var(--color-surface); padding: 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="color: var(--color-primary); font-size: 1.25rem; display: flex; align-items: center;"><i class="ri-notification-3-line"></i></div>
            <div>
              <strong style="display: block; margin-bottom: 0.15rem; color: var(--color-text-main);">Seguimiento y Sucursal</strong>
              <span style="color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.4;">Una vez creada la declaración, podrá ver en el portal las actualizaciones de su ingreso de stock, como la sucursal asignada para el ingreso.</span>
            </div>
          </div>

        </div>
      </div>
      <div class="modal-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border); background: var(--color-surface); display: flex; justify-content: flex-end;">
        <button type="button" class="btn btn-primary" onclick="document.getElementById('${modalId}').remove()" style="margin: 0;">Entendido</button>
      </div>
    </div>
  </div>
  `;
  document.body.appendChild(modal);
};

window.editDeclaration = async function(id) {
  try {
    const { data: dec, error } = await supabase
      .from('stock_declarations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!dec) return;

    editingDeclarationId = dec.id;

    document.getElementById('dec-title').value = dec.title || '';
    document.getElementById('dec-qty-declared').value = dec.quantity_declared || '';
    document.getElementById('dec-delivery-method').value = dec.delivery_method || '';
    document.getElementById('dec-contact-info').value = dec.contact_info || '';
    document.getElementById('dec-carrier-info').value = dec.carrier_info || '';
    document.getElementById('dec-notes').value = dec.notes || '';

    if (document.getElementById('dec-comercio')) {
      document.getElementById('dec-comercio').value = dec.comercio;
    }

    const containerCountInput = document.getElementById('dec-container-count');
    const containerNoCb = document.getElementById('dec-no-container');
    if (dec.container_count === 0) {
      if (containerNoCb) containerNoCb.checked = true;
      if (containerCountInput) {
        containerCountInput.disabled = true;
        containerCountInput.value = '';
        containerCountInput.removeAttribute('required');
      }
    } else {
      if (containerNoCb) containerNoCb.checked = false;
      if (containerCountInput) {
        containerCountInput.disabled = false;
        containerCountInput.value = dec.container_count;
        containerCountInput.setAttribute('required', 'required');
      }
    }

    const palletCountInput = document.getElementById('dec-pallet-count');
    const palletNoCb = document.getElementById('dec-no-pallet');
    if (dec.pallet_count === 0) {
      if (palletNoCb) palletNoCb.checked = true;
      if (palletCountInput) {
        palletCountInput.disabled = true;
        palletCountInput.value = '';
        palletCountInput.removeAttribute('required');
      }
    } else {
      if (palletNoCb) palletNoCb.checked = false;
      if (palletCountInput) {
        palletCountInput.disabled = false;
        palletCountInput.value = dec.pallet_count;
        palletCountInput.setAttribute('required', 'required');
      }
    }

    const boxCountInput = document.getElementById('dec-box-count');
    const boxNoCb = document.getElementById('dec-no-box');
    if (dec.box_count === 0) {
      if (boxNoCb) boxNoCb.checked = true;
      if (boxCountInput) {
        boxCountInput.disabled = true;
        boxCountInput.value = '';
        boxCountInput.removeAttribute('required');
      }
    } else {
      if (boxNoCb) boxNoCb.checked = false;
      if (boxCountInput) {
        boxCountInput.disabled = false;
        boxCountInput.value = dec.box_count;
        boxCountInput.setAttribute('required', 'required');
      }
    }

    const requiresUnloadingCb = document.getElementById('dec-requires-unloading');
    const unloadingWarning = document.getElementById('dec-unloading-warning');
    if (requiresUnloadingCb) {
      requiresUnloadingCb.checked = !!dec.requires_unloading;
      if (unloadingWarning) {
        unloadingWarning.style.display = dec.requires_unloading ? 'block' : 'none';
      }
    }

    const btnExact = document.getElementById('btn-date-exact');
    const btnEstimate = document.getElementById('btn-date-estimate');
    const fileInput = document.getElementById('dec-file-input');
    const fileInfo = document.getElementById('dec-file-selected-info');
    
    if (fileInput) {
      fileInput.removeAttribute('required');
    }
    if (fileInfo) {
      fileInfo.innerHTML = `<strong>Archivo actual:</strong> ${dec.file_name} <br><span style="font-size: 0.75rem; color: var(--color-text-muted);">(Selecciona uno nuevo solo si deseas reemplazar el archivo anterior)</span>`;
    }

    if (dec.estimated_arrival_type === 'exact') {
      if (btnExact) btnExact.click();
      clientSelectedDateStr = dec.estimated_arrival_date;
      
      const [y, m, d] = clientSelectedDateStr.split('-');
      clientCalendarCurrentDate = new Date(parseInt(y), parseInt(m) - 1, 1);
      const miniCalWrapper = document.getElementById('mini-calendar-wrapper');
      if (miniCalWrapper) {
        drawMiniCalendar(miniCalWrapper, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());
      }
      updateDateCheck();
    } else {
      if (btnEstimate) btnEstimate.click();
      const parts = (dec.estimated_arrival_period || '').split(' ');
      const qty = parseInt(parts[0]) || 1;
      const unit = parts[1] || 'semanas';
      
      const qtyInput = document.getElementById('dec-period-qty');
      const unitInput = document.getElementById('dec-period-unit');
      if (qtyInput) qtyInput.value = qty;
      if (unitInput) unitInput.value = unit;
    }

    const formTitle = document.getElementById('dec-form-title');
    if (formTitle) {
      formTitle.textContent = 'Editar Declaración de Ingreso';
    }
    const submitBtn = document.getElementById('btn-submit-declaration');
    if (submitBtn) {
      submitBtn.textContent = 'Guardar Cambios';
    }
    const cancelBtn = document.getElementById('btn-cancel-edit-declaration');
    if (cancelBtn) {
      cancelBtn.style.display = 'block';
    }

    const formCol = document.getElementById('dec-form-col');
    if (formCol) {
      formCol.scrollIntoView({ behavior: 'smooth' });
    }

  } catch (err) {
    console.error('Error opening declaration for editing:', err);
    alert('Error al abrir la declaración para editar: ' + err.message);
  }
};

window.cancelEditDeclaration = function() {
  editingDeclarationId = null;
  const form = document.getElementById('form-new-declaration');
  if (form) form.reset();

  const fileInput = document.getElementById('dec-file-input');
  if (fileInput) {
    fileInput.setAttribute('required', 'required');
  }
  const fileInfo = document.getElementById('dec-file-selected-info');
  if (fileInfo) fileInfo.innerHTML = '';

  const inputs = ['dec-container-count', 'dec-pallet-count', 'dec-box-count'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = false;
      el.setAttribute('required', 'required');
    }
  });
  const unloadingWarning = document.getElementById('dec-unloading-warning');
  if (unloadingWarning) unloadingWarning.style.display = 'none';

  clientSelectedDateStr = '';
  clientCalendarCurrentDate = new Date();
  const btnExact = document.getElementById('btn-date-exact');
  if (btnExact) btnExact.click();
  const miniCalWrapper = document.getElementById('mini-calendar-wrapper');
  if (miniCalWrapper) {
    drawMiniCalendar(miniCalWrapper, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());
  }
  const dateLabel = document.getElementById('dec-date-selected-label');
  if (dateLabel) dateLabel.innerHTML = '<span style="color: var(--color-text-muted);">Ninguna fecha seleccionada</span>';
  
  const dateWarning = document.getElementById('dec-date-warning');
  if (dateWarning) dateWarning.style.display = 'none';
  const dateError = document.getElementById('dec-date-error');
  if (dateError) dateError.style.display = 'none';

  const formTitle = document.getElementById('dec-form-title');
  if (formTitle) {
    formTitle.textContent = 'Declarar Nuevo Ingreso';
  }
  const submitBtn = document.getElementById('btn-submit-declaration');
  if (submitBtn) {
    submitBtn.textContent = 'Crear Declaración de Ingreso';
  }
  const cancelBtn = document.getElementById('btn-cancel-edit-declaration');
  if (cancelBtn) {
    cancelBtn.style.display = 'none';
  }
};
