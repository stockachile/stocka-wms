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
        <div class="notification-item ${isReadLocally ? '' : 'unread'}" data-id="${n.id}">
          <div class="notification-title">${n.title}</div>
          <div class="notification-message">${n.message}</div>
          <span class="notification-time">${new Date(n.created_at).toLocaleString()}</span>
        </div>
      `}).join('');

      document.querySelectorAll('.notification-item.unread').forEach(item => {
        item.addEventListener('click', async () => {
          const id = item.getAttribute('data-id');
          await supabase.from('user_notification_reads').insert([{ user_id: currentMerchantId, entity_type: 'notification', entity_id: id }]);
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
    const { data: news, error: newsErr } = await supabase

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
        <h2>Bienvenido a STOCKA OS</h2>
        <p>Tu Centro de Comando Modular para la gestión integral de inventario, despachos y logística inversa.</p>
        <button class="btn btn-primary" style="margin-top: 1.5rem; border-radius: 99px; padding: 0.5rem 1.5rem;" onclick="document.querySelector('[data-view=\\'inventory\\']').click()">
          <i class="ri-play-circle-line" style="margin-right: 0.5rem;"></i> Comenzar
        </button>
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
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar el dashboard: ${error.message}</p>`;
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
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando inventario...</p>`;

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
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar el inventario: ${error.message}</p>`;
  }
}

async function renderMovements() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando movimientos...</p>`;

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
              <span style="font-size: 1.5rem;"><i class="ri-building-2-line"></i></span> ${w.name}
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
    const companyList = getCompanyList();
    let query = supabase
      .from('orders')
      .select(`
        id,
        status,
        created_at,
        external_order_number,
        comercio,
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
      rowsHtml = `<tr><td colspan="9" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No hay pedidos registrados.</td></tr>`;
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
            <td>${originHtml}</td>
            <td style="white-space: nowrap;"><i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}</td>
            <td><span style="font-family: monospace; font-size: 0.85rem; color: var(--color-text-main); font-weight: 600;">${skuStr}</span></td>
            <td>${nameStr}</td>
            <td><strong style="color: var(--color-text-main); font-size: 1.05rem;">${qtyStr}</strong></td>
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
            <span style="font-size: 2rem; display: block; margin-bottom: 1rem;"><i class="ri-folder-open-line"></i></span>
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

    const assignedComercios = (currentCompany || '')
      .split(',')
      .map(c => c.trim())
      .filter(c => c && c.toLowerCase() !== 'no asignado');

    if (assignedComercios.length === 0) {
      appContent.innerHTML = `
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

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 2rem;">
        <!-- Left Column: Active/Available Integrations -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          
          <!-- Shopify Card -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shopping-bag-3-line"></i> Shopify Integration</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasShopify ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasShopify ? 'rgba(16, 185, 129, 0.2)' : 'var(--color-border)'};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasShopify ? '#10b981' : 'var(--color-text-main)'};">Shopify Store</h4>
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
                  <input type="text" id="shopify-url" class="form-input" placeholder="ej. mitienda.myshopify.com" value="${shopUrl}" ${hasShopify ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasShopify || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasShopify ? 'display:none;' : ''}">
                  <label class="form-label" style="font-weight: 600;">Access Token (Admin API)</label>
                  <input type="password" id="shopify-token" class="form-input" placeholder="shpat_xxxxxxxxxxxxx" ${hasShopify ? '' : 'required'} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Debe comenzar con <strong>shpat_</strong>.</p>
                </div>
                
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${shopifyButtonHtml}
                </div>
              </form>
            </div>
          </div>

          <!-- Paris Marketplace Card -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> París Marketplace (Cencosud)</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasParis ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasParis ? 'rgba(16, 185, 129, 0.2)' : 'var(--color-border)'};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasParis ? '#10b981' : 'var(--color-text-main)'};">París Store (Mirakl)</h4>
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
                  <input type="text" id="paris-url" class="form-input" placeholder="ej. https://api-developers.ecomm.cencosud.com" value="${parisUrl}" ${hasParis ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasParis || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasParis ? 'display:none;' : ''}">
                  <label class="form-label" style="font-weight: 600;">API Key del Vendedor</label>
                  <input type="password" id="paris-token" class="form-input" placeholder="Ingresa tu API Key de Cencosud" ${hasParis ? '' : 'required'} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${parisButtonHtml}
                </div>
              </form>
            </div>
          </div>

          <!-- Falabella Marketplace Card -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> Falabella Marketplace</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasFalabella ? 'rgba(132, 204, 22, 0.1)' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasFalabella ? 'rgba(132, 204, 22, 0.2)' : 'var(--color-border)'};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: ${hasFalabella ? '#84cc16' : 'var(--color-text-main)'};">Falabella Store (Mirakl)</h4>
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
                  <input type="text" id="falabella-url" class="form-input" placeholder="ej. https://sellercenter-api.falabella.com" value="${falabellaUrl}" ${hasFalabella ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasFalabella || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">User ID / Email de Falabella</label>
                  <input type="email" id="falabella-user" class="form-input" placeholder="ej. hola@backintime.cl" value="${falabellaUser}" ${hasFalabella ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasFalabella || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; ${hasFalabella ? 'display:none;' : ''}">
                  <label class="form-label" style="font-weight: 600;">API Key del Vendedor</label>
                  <input type="password" id="falabella-token" class="form-input" placeholder="Ingresa tu API Key de Falabella" ${hasFalabella ? '' : 'required'} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  ${falabellaButtonHtml}
                </div>
              </form>
            </div>
          </div>

        </div>

        <!-- Right Column: Manual/Guide -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          
          <!-- Shopify Guide -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface);">
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

          <!-- Paris Guide -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración París
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Entrar al Seller Center:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Inicia sesión en tu portal de vendedor de París (Cencosud) y navega a la sección <strong style="color: var(--color-text-main);">Mi Cuenta > Integraciones</strong>.</p>
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

          <!-- Falabella Guide -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin-top: 1.5rem;">
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

    const commerceSelect = document.getElementById('select-integration-commerce');
    if (commerceSelect) {
      commerceSelect.addEventListener('change', (e) => {
        window.activeIntegrationCommerce = e.target.value;
        renderIntegrations();
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
  appContent.innerHTML = `<p class="text-center" style="padding: 2rem;">Cargando despachos consolidados...</p>`;

  try {
    console.log('DEBUG: Cargando lista de couriers únicos para la empresa:', currentCompany);
    
    // Obtener la lista de couriers únicos para este comercio primero
    let courierQuery = supabase
      .from('envios_unificados')
      .select('courier')
      .eq('visible_to_client', true);
    
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
        courierQuery = courierQuery.in('empresa_comercio_proveedor', companyList);
      }
    }
    
    const { data: courierData } = await courierQuery;
    const couriers = [...new Set((courierData || []).map(s => s.courier).filter(Boolean))].sort();

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const defaultDateFrom = `${year}-${month}-01`;
    const defaultDateTo = `${year}-${month}-${day}`;

    let allData = [];
    let filters = {
      search: '',
      status: '',
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
          <div class="kpi-icon"><i class="ri-box-3-line"></i></div>
          <div class="kpi-info">
            <span class="kpi-label">Total Envíos</span>
            <span class="kpi-value" id="kpi-total-val">0</span>
          </div>
        </div>
        <div class="shipments-kpi-card kpi-despachado">
          <div class="kpi-icon"><i class="ri-truck-line"></i></div>
          <div class="kpi-info">
            <span class="kpi-label">Despachados</span>
            <span class="kpi-value" id="kpi-despachado-val">0</span>
          </div>
        </div>
        <div class="shipments-kpi-card kpi-sin-movimiento">
          <div class="kpi-icon"><i class="ri-timer-line"></i></div>
          <div class="kpi-info">
            <span class="kpi-label">Sin Movimiento</span>
            <span class="kpi-value" id="kpi-sin-movimiento-val">0</span>
          </div>
        </div>
        <div class="shipments-kpi-card kpi-alerta">
          <div class="kpi-icon"><i class="ri-error-warning-line"></i></div>
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
                <th class="sortable-header" data-sort="global_status">Estado Global <span class="sort-indicator">⇅</span></th>
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
              <span class="badge ${badgeClass}" style="text-transform: capitalize; padding: 0.35rem 0.75rem; border-radius: 99px; font-weight: 600;">
                ${s.global_status ? s.global_status.toLowerCase() : 'desconocido'}
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

        // 1. Query para KPIs en paralelo (sin limit/range de paginación ni búsqueda por texto)
        let kpiQuery = supabase
          .from('envios_unificados')
          .select('global_status')
          .eq('visible_to_client', true);
        
        if (companyList.length > 0) {
          kpiQuery = kpiQuery.in('empresa_comercio_proveedor', companyList);
        }
        if (filters.courier) {
          kpiQuery = kpiQuery.eq('courier', filters.courier);
        }
        if (filters.dateFrom) {
          kpiQuery = kpiQuery.gte('created_at', filters.dateFrom + 'T00:00:00Z');
        }
        if (filters.dateTo) {
          kpiQuery = kpiQuery.lte('created_at', filters.dateTo + 'T23:59:59Z');
        }

        // 2. Query paginada y filtrada para la tabla
        let query = supabase
          .from('envios_unificados')
          .select('*', { count: 'exact' })
          .eq('visible_to_client', true);

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
        if (filters.status) {
          query = query.eq('global_status', filters.status);
        }
        if (filters.search) {
          const term = `%${filters.search}%`;
          query = query.or(`pedido_referencia.ilike.${term},nombre_destinatario.ilike.${term},tracking.ilike.${term},courier.ilike.${term},comuna_destino.ilike.${term},direccion_destino.ilike.${term}`);
        }

        // Ordenar y limitar por rango de paginación
        query = query.order('created_at', { ascending: false });
        query = query.range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

        // Ejecutar consultas en paralelo
        const [kpiRes, dataRes] = await Promise.all([kpiQuery, query]);

        if (kpiRes.error) throw kpiRes.error;
        if (dataRes.error) throw dataRes.error;

        // Actualizar KPIs
        const kpis = kpiRes.data || [];
        const totalCount = kpis.length;
        const totalDespachado = kpis.filter(s => s.global_status === 'DESPACHADO').length;
        const totalSinMov = kpis.filter(s => s.global_status === 'SIN MOVIMIENTO').length;
        const totalAlerta = kpis.filter(s => s.global_status === 'ALERTA').length;

        document.getElementById('kpi-total-val').textContent = totalCount;
        document.getElementById('kpi-despachado-val').textContent = totalDespachado;
        document.getElementById('kpi-sin-movimiento-val').textContent = totalSinMov;
        document.getElementById('kpi-alerta-val').textContent = totalAlerta;

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

    const statusTabs = document.querySelectorAll('#ship-status-tabs .shipment-tab');
    statusTabs.forEach(tab => {
      tab.addEventListener('click', async (e) => {
        statusTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        filters.status = e.target.getAttribute('data-status');
        currentPage = 1; // Resetear a página 1
        await fetchAndRenderTable();
      });
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

        let query = supabase
          .from('envios_unificados')
          .select('*')
          .eq('visible_to_client', true);

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
        if (filters.status) {
          query = query.eq('global_status', filters.status);
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
    appContent.innerHTML = `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar perfil: ${err.message}</p>`;
  }
}

// ====== LOGISTICA INVERSA ======
let returnsCurrentPage = 1;
const returnsPageSize = 50;

window.renderReturns = async function() {
  const content = document.getElementById('app-content');
  
  content.innerHTML = `
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
  
  content.innerHTML = `
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
  
  content.innerHTML = `
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
