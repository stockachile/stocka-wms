import supabase from './supabase.js';
import { renderTicketsClient } from './tickets.js';
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

    // Verificación de retorno exitoso de OAuth con Shopify
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('integration') === 'success') {
      alert('¡Tienda Shopify conectada exitosamente!');
      const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.pushState({ path: newUrl }, '', newUrl);
      setTimeout(() => {
        const integrationsTab = Array.from(document.querySelectorAll('.nav-item'))
          .find(n => n.getAttribute('data-view') === 'integrations');
        if (integrationsTab) {
          integrationsTab.click();
        }
      }, 500);
    }

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
        if (currentCompany) {
          checkBillingSuspension(currentCompany);
        }
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

    // Navigation Logic Setup
    if (navItems) {
      navItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const targetItem = e.target.closest('.nav-item');
          if (!targetItem) return;

          navItems.forEach(n => n.classList.remove('active'));
          targetItem.classList.add('active');

          const view = targetItem.getAttribute('data-view');
          
          if (view === 'dashboard') {
            viewTitle.textContent = 'Dashboard';
            renderDashboard();
          } else if (view === 'inventory') {
            viewTitle.textContent = 'Inventario';
            renderInventory();
          } else if (view === 'catalog') {
            viewTitle.textContent = 'Catálogo de Productos';
            renderCatalog();
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
          } else if (view === 'billing') {
            viewTitle.textContent = 'Facturación';
            renderBillingClient();
          } else if (view === 'profile') {
            viewTitle.textContent = 'Mi Perfil';
            renderProfile();
          } else if (view === 'inbox') {
            viewTitle.textContent = 'Mi Inbox';
            renderInboxPage();
          } else if (view === 'tickets') {
            viewTitle.textContent = 'Soporte y Tickets';
            const appContent = document.getElementById('app-content');
            renderTicketsClient(appContent);
          } else if (view === 'documentation') {
            viewTitle.textContent = 'Documentación del Servicio';
            renderDocsClient();
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
        // Por defecto, si es 'all' todos los ítems están permitidos
        if (navItems.length > 0) firstVisibleItem = navItems[0];
      }
      
      // Ocultar cabeceras de categorías vacías
      updateCategoryHeadersVisibility();
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
initChatWidget();

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
      const { data, error } = await supabase
        .from('dashboard_notifications')
        .select('*')
        .lte('created_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(30);
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

    // Obtener información de facturación
    let activePeriod = null;
    let currentPeriodRecords = [];
    let billingEnabled = false;
    let totalPendingAllPeriods = 0;
    let hasOverduePayments = false;
    let pendingFulfillmentAny = false;
    let pendingEnviameAny = false;
    let currentPeriodTotal = 0;
    let currentPeriodPaid = 0;
    let currentPeriodPending = 0;

    if (companyList.length > 0) {
      billingEnabled = true;
      try {
        const [periodsRes, mappingsRes] = await Promise.all([
          supabase.from('billing_periods').select('*').order('name', { ascending: false }),
          supabase.from('billing_mappings').select('comercio_nombre, billing_name')
        ]);

        const periods = periodsRes.data;
        const mappings = mappingsRes.data || [];

        if (periods && periods.length > 0) {
          activePeriod = periods.find(p => p.status === 'activo') || periods[0];
        }

        const uniqueBillingNames = new Set();
        companyList.forEach(c => {
          const matchedMapping = mappings.find(m => m.comercio_nombre.toLowerCase() === c.toLowerCase());
          const nameToUse = matchedMapping ? matchedMapping.billing_name : c;
          uniqueBillingNames.add(nameToUse);
        });
        const resolvedCompanyList = Array.from(uniqueBillingNames);

        if (resolvedCompanyList.length > 0) {
          const { data: allRecords } = await supabase
            .from('billing_records')
            .select('*')
            .in('comercio', resolvedCompanyList);

          if (allRecords && allRecords.length > 0) {
            if (activePeriod) {
              currentPeriodRecords = allRecords.filter(r => r.period_id === activePeriod.id);
            }

            allRecords.forEach(r => {
              const pendingFulf = (r.total_fulfillment || 0) - (r.abono_fulfillment || 0);
              const pendingEnv = (r.enviame || 0) - (r.abono_enviame || 0);
              
              if (pendingFulf > 0) {
                totalPendingAllPeriods += pendingFulf;
                pendingFulfillmentAny = true;
              }
              if (pendingEnv > 0) {
                totalPendingAllPeriods += pendingEnv;
                pendingEnviameAny = true;
              }

              if (r.pago_fulfillment === 'Atrasado' || r.pago_enviame === 'Atrasado') {
                hasOverduePayments = true;
              }
            });
          }
        }

        currentPeriodRecords.forEach(r => {
          currentPeriodTotal += (r.total_fulfillment || 0) + (r.enviame || 0);
          currentPeriodPaid += (r.abono_fulfillment || 0) + (r.abono_enviame || 0);
        });
        currentPeriodPending = currentPeriodTotal - currentPeriodPaid;
      } catch (err) {
        console.error('Error fetching billing data for dashboard:', err);
      }
    }

    let billingHtml = '';
    if (billingEnabled && activePeriod) {
      let statusBadge = '';
      let alertBanner = '';

      if (hasOverduePayments) {
        statusBadge = `
          <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 700; color: var(--color-danger); font-size: 0.8rem; background: rgba(239, 68, 68, 0.1); padding: 0.35rem 0.75rem; border-radius: 50px;">
            <i class="ri-error-warning-fill" style="font-size: 1rem;"></i> Pago Atrasado
          </span>
        `;
        let overdueServices = [];
        if (pendingFulfillmentAny) overdueServices.push('Fulfillment');
        if (pendingEnviameAny) overdueServices.push('Envíame');
        alertBanner = `
          <div style="background: rgba(239, 68, 68, 0.15); border-left: 4px solid var(--color-danger); padding: 1rem; border-radius: 4px; margin-top: 1.5rem; display: flex; align-items: center; gap: 0.75rem; text-align: left; width: 100%;">
            <i class="ri-alert-fill" style="color: var(--color-danger); font-size: 1.5rem; flex-shrink: 0;"></i>
            <div style="font-size: 0.9rem; color: var(--color-text-main);">
              <strong>¡Atención!</strong> Tienes pagos atrasados pendientes para el/los servicios de <strong>${overdueServices.join(' y ')}</strong>. Por favor, regulariza tu cuenta a la brevedad para evitar suspensiones de servicio.
            </div>
          </div>
        `;
      } else if (totalPendingAllPeriods > 0) {
        statusBadge = `
          <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 700; color: var(--color-warning); font-size: 0.8rem; background: rgba(245, 158, 11, 0.1); padding: 0.35rem 0.75rem; border-radius: 50px;">
            <i class="ri-time-fill" style="font-size: 1rem;"></i> Saldo Pendiente
          </span>
        `;
        let pendingServices = [];
        if (pendingFulfillmentAny) pendingServices.push('Fulfillment');
        if (pendingEnviameAny) pendingServices.push('Envíame');
        alertBanner = `
          <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid var(--color-warning); padding: 1rem; border-radius: 4px; margin-top: 1.5rem; display: flex; align-items: center; gap: 0.75rem; text-align: left; width: 100%;">
            <i class="ri-information-fill" style="color: var(--color-warning); font-size: 1.5rem; flex-shrink: 0;"></i>
            <div style="font-size: 0.9rem; color: var(--color-text-main);">
              Tienes un saldo total pendiente de cobro de <strong>$${totalPendingAllPeriods.toLocaleString()}</strong> correspondiente a los servicios de <strong>${pendingServices.join(' y ')}</strong>.
            </div>
          </div>
        `;
      } else {
        statusBadge = `
          <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 700; color: var(--color-success); font-size: 0.8rem; background: rgba(16, 185, 129, 0.1); padding: 0.35rem 0.75rem; border-radius: 50px;">
            <i class="ri-checkbox-circle-fill" style="font-size: 1rem;"></i> Al Día
          </span>
        `;
      }

      billingHtml = `
        <div class="card" style="grid-column: 1 / -1; display: flex; flex-direction: column;">
          <div class="card-header flex justify-between items-center" style="border-bottom: 1px solid var(--color-border); padding-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <h3 style="margin: 0;"><i class="ri-bill-line" style="margin-right: 0.5rem; color: var(--color-primary);"></i> Facturación y Estado de Cuenta</h3>
              <span style="font-size: 0.8rem; color: var(--color-text-muted); background: var(--color-bg-secondary); padding: 0.25rem 0.75rem; border-radius: 4px;">Periodo: ${activePeriod.name}</span>
            </div>
            ${statusBadge}
          </div>
          <div class="card-body" style="padding: 1.5rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
              <div style="background: var(--color-bg-secondary); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--color-border); text-align: center;">
                <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.25rem;">Total Facturado del Mes</div>
                <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-text-main);">$${currentPeriodTotal.toLocaleString()}</div>
              </div>
              <div style="background: var(--color-bg-secondary); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--color-border); text-align: center;">
                <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.25rem;">Abonado/Pagado</div>
                <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-success);">$${currentPeriodPaid.toLocaleString()}</div>
              </div>
              <div style="background: var(--color-bg-secondary); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--color-border); text-align: center;">
                <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.25rem;">Saldo Pendiente del Mes</div>
                <div style="font-size: 1.5rem; font-weight: 700; color: ${currentPeriodPending > 0 ? 'var(--color-warning)' : 'var(--color-text-main)'};">$${currentPeriodPending.toLocaleString()}</div>
              </div>
              <div style="display: flex; align-items: center; justify-content: center;">
                <button class="btn btn-primary" style="width: 100%; max-width: 200px; padding: 0.75rem 1rem; border-radius: 8px;" id="dashboard-to-billing-btn">
                  <i class="ri-receipt-line" style="margin-right: 0.5rem;"></i> Detalle de Facturas
                </button>
              </div>
            </div>
            ${alertBanner}
          </div>
        </div>
      `;
    }

    appContent.innerHTML = getObserverBanner() + `
      <div class="dashboard-hero">
        <div class="dashboard-hero-content">
          <h2>Te damos la bienvenida al WMS 3.0 de Stocka</h2>
          <p>Un nuevo centro de operaciones para la gestión de tu comercio, con la información centralizada, integraciones y más! Nos encontramos en pleno desarrollo y pronto lanzaremos nuevas novedades.</p>
        </div>
        <div class="dashboard-hero-image"></div>
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

        ${billingHtml}
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

  // Redirección al detalle de facturas
  const toBillingBtn = document.getElementById('dashboard-to-billing-btn');
  if (toBillingBtn) {
    toBillingBtn.addEventListener('click', () => {
      const billingNavItem = document.querySelector('[data-view="billing"]');
      if (billingNavItem) {
        billingNavItem.click();
      }
    });
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

// Render general catalog of products
async function renderCatalog() {
  const appContent = document.getElementById('app-content');
  appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem;">Cargando catálogo de productos...</p>`;

  try {
    const companyList = getCompanyList();
    let query = supabase.from('products').select('*');

    if (companyList.length > 0) {
      query = query.in('comercio', companyList);
    } else {
      query = query.eq('comercio', 'no asignado');
    }

    const { data: products, error } = await query;
    if (error) throw error;

    let rowsHtml = '';
    if (!products || products.length === 0) {
      rowsHtml = `
        <tr>
          <td colspan="11" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">
            No hay productos registrados en el catálogo.
          </td>
        </tr>
      `;
    } else {
      products.forEach(item => {
        // Thumbnail image
        const imgHtml = item.image_url 
          ? `<img src="${item.image_url}" alt="${item.name}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border);">` 
          : `<div style="width: 40px; height: 40px; background-color: var(--color-gray-dark); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); border: 1px solid var(--color-border);"><i class="ri-image-line" style="font-size: 1.2rem;"></i></div>`;

        // Dimensions
        const dimensions = (item.length || item.width || item.height)
          ? `${item.length || 0} x ${item.width || 0} x ${item.height || 0} cm`
          : '<span style="color: var(--color-text-muted); font-size: 0.85rem;">No def.</span>';

        // Weight
        const weight = item.weight 
          ? `${item.weight} kg` 
          : '<span style="color: var(--color-text-muted); font-size: 0.85rem;">No def.</span>';

        // Origin Badge
        let originBadge = '<span class="badge" style="background-color: #64748b; color: white; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600;">Manual</span>';
        if (item.shopify_product_id) {
          originBadge = `<img src="./img/shopify.png" alt="Shopify" title="Shopify" style="height: 42px; max-width: 120px; object-fit: contain; vertical-align: middle;" onerror="this.onerror=null; this.outerHTML='<span class=\\'badge\\' style=\\'background-color: #10b981; color: white; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600;\\'>Shopify</span>';" />`;
        } else if (item.raw_meli_data) {
          originBadge = `<img src="./img/mercadolibre.png" alt="MercadoLibre" title="MercadoLibre" style="height: 42px; max-width: 120px; object-fit: contain; vertical-align: middle;" onerror="this.onerror=null; this.outerHTML='<span class=\\'badge\\' style=\\'background-color: #ffe600; color: #2d3277; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 800;\\'>MercadoLibre</span>';" />`;
        } else if (item.raw_falabella_data) {
          originBadge = `<img src="./img/falabella.png" alt="Falabella" title="Falabella" style="height: 42px; max-width: 120px; object-fit: contain; vertical-align: middle;" onerror="this.onerror=null; this.outerHTML='<span class=\\'badge\\' style=\\'background-color: #ff6000; color: white; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600;\\'>Falabella</span>';" />`;
        } else if (item.raw_paris_data) {
          originBadge = `<img src="./img/paris.png" alt="París" title="París" style="height: 42px; max-width: 120px; object-fit: contain; vertical-align: middle;" onerror="this.onerror=null; this.outerHTML='<span class=\\'badge\\' style=\\'background-color: #00a8e8; color: white; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600;\\'>París</span>';" />`;
        }

        // Shopify Stock
        const shopifyStockHtml = item.shopify_product_id 
          ? `<strong style="color: var(--color-primary);">${item.shopify_stock ?? 0}</strong>` 
          : '<span style="color: var(--color-text-muted); font-size: 0.85rem;">N/A</span>';

        // Expiration and Lot
        const expAndLot = (item.expiration_date || item.lot_number)
          ? `<div style="font-size: 0.8rem; line-height: 1.2;">
               ${item.expiration_date ? `Vence: ${item.expiration_date}<br>` : ''}
               ${item.lot_number ? `Lote: ${item.lot_number}` : ''}
             </div>`
          : '<span style="color: var(--color-text-muted); font-size: 0.85rem;">-</span>';

        // Action button to Edit
        const isObserver = userRole === 'observer';
        const actionBtn = isObserver 
          ? '' 
          : `<button class="btn btn-outline btn-edit-product" data-id="${item.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border-color: var(--color-border); color: var(--color-text);"><i class="ri-edit-line" style="margin-right: 0.25rem;"></i>Editar</button>`;

        rowsHtml += `
          <tr data-product-row-id="${item.id}">
            <td style="padding: 0.75rem 1.5rem;">${imgHtml}</td>
            <td style="padding: 0.75rem 1.5rem;"><strong>${item.sku}</strong></td>
            <td style="padding: 0.75rem 1.5rem;">${item.name}</td>
            <td style="padding: 0.75rem 1.5rem;">${item.barcode || '<span style="color: var(--color-text-muted); font-size: 0.85rem;">-</span>'}</td>
            <td style="padding: 0.75rem 1.5rem;">$${item.price ? item.price.toLocaleString('es-CL') : '0'}</td>
            <td style="padding: 0.75rem 1.5rem;">${originBadge}</td>
            <td style="padding: 0.75rem 1.5rem;">${dimensions}</td>
            <td style="padding: 0.75rem 1.5rem;">${weight}</td>
            <td style="padding: 0.75rem 1.5rem;" class="text-center">${shopifyStockHtml}</td>
            <td style="padding: 0.75rem 1.5rem;">${expAndLot}</td>
            <td style="padding: 0.75rem 1.5rem;">${actionBtn}</td>
          </tr>
        `;
      });
    }

    const isObserver = userRole === 'observer';
    const createBtn = isObserver ? '' : '<button class="btn btn-primary" id="btn-new-product" style="padding: 0.5rem 1rem; font-size: 0.85rem;"><i class="ri-add-line" style="margin-right: 0.25rem;"></i>Nuevo Producto</button>';

    appContent.innerHTML = getObserverBanner() + `
      <div class="card" style="margin-bottom: 2rem; border: 1px solid var(--color-border); border-radius: 0.5rem; background-color: var(--color-card-bg); box-shadow: var(--shadow-sm);">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding: 1.25rem 1.5rem;">
          <h3 class="card-title" style="margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text);">Catálogo General de Productos</h3>
          ${createBtn}
        </div>
        <div class="table-responsive" style="overflow-x: auto; width: 100%;">
          <table class="table" style="width: 100%; border-collapse: collapse; text-align: left; vertical-align: middle;">
            <thead>
              <tr style="border-bottom: 2px solid var(--color-border); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted);">
                <th style="padding: 1rem 1.5rem;">Imagen</th>
                <th style="padding: 1rem 1.5rem;">SKU</th>
                <th style="padding: 1rem 1.5rem;">Nombre</th>
                <th style="padding: 1rem 1.5rem;">Cód. Barras</th>
                <th style="padding: 1rem 1.5rem;">Precio</th>
                <th style="padding: 1rem 1.5rem;">Origen</th>
                <th style="padding: 1rem 1.5rem;">Medidas</th>
                <th style="padding: 1rem 1.5rem;">Peso</th>
                <th style="padding: 1rem 1.5rem;" class="text-center">Stock Shopify</th>
                <th style="padding: 1rem 1.5rem;">Venc. / Lote</th>
                <th style="padding: 1rem 1.5rem;">Acciones</th>
              </tr>
            </thead>
            <tbody style="font-size: 0.9rem; color: var(--color-text);">
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Hook up Edit button listeners
    document.querySelectorAll('.btn-edit-product').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const prodId = e.currentTarget.getAttribute('data-id');
        openEditProductModal(prodId);
      });
    });

  } catch (err) {
    console.error(err);
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: #ef4444;">Error al cargar el catálogo: ${err.message}</p>`;
  }
}

async function openEditProductModal(prodId) {
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', prodId)
      .single();

    if (error) throw error;

    document.getElementById('edit-prod-id').value = product.id;
    document.getElementById('edit-prod-sku').value = product.sku;
    document.getElementById('edit-prod-name').value = product.name;
    document.getElementById('edit-prod-barcode').value = product.barcode || '';
    document.getElementById('edit-prod-length').value = product.length || '';
    document.getElementById('edit-prod-width').value = product.width || '';
    document.getElementById('edit-prod-height').value = product.height || '';
    document.getElementById('edit-prod-weight').value = product.weight || '';
    document.getElementById('edit-prod-expiration').value = product.expiration_date || '';
    document.getElementById('edit-prod-lot').value = product.lot_number || '';

    document.getElementById('modal-edit-product').classList.add('active');
  } catch (err) {
    console.error(err);
    alert('Error al cargar datos del producto: ' + err.message);
  }
}

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

  // Reset/Init WMS state
  window.clientWmsActiveTab = window.clientWmsActiveTab || 'Todos';
  window.clientWmsPageSize = window.clientWmsPageSize !== undefined ? window.clientWmsPageSize : 25;
  window.clientWmsCurrentPage = window.clientWmsCurrentPage || 1;

  try {
    const companyList = getCompanyList();
    let query = supabase
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
        comercio,
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
        raw_shopify_data,
        shopify_exported,
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

    window.clientLoadedOrders = orders || [];

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
    window.clientLoadedShipments = shipments;

    const isObserver = userRole === 'observer';
    const actionBtn = isObserver ? '' : '<button class="btn btn-primary" id="btn-new-order"><i class="ri-add-line"></i> Crear Pedido</button>';
    const statusOptions = ALL_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('');

    appContent.innerHTML = getObserverBanner() + `
      <!-- Tarjetas de KPI -->
      <div class="orders-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-info-bg); color: var(--badge-info-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-shopping-bag-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">Total Pedidos</span>
            <strong id="kpi-client-total" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">0</strong>
          </div>
        </div>
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-warning-bg); color: var(--badge-warning-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-time-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">Para Procesar</span>
            <strong id="kpi-client-processing" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">0</strong>
          </div>
        </div>
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-success-bg); color: var(--badge-success-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-hammer-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">En Preparación</span>
            <strong id="kpi-client-in-prep" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">0</strong>
          </div>
        </div>
        <div class="kpi-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm);">
          <div style="background: var(--badge-neutral-bg); color: var(--badge-neutral-text); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
            <i class="ri-money-dollar-circle-line"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: var(--color-text-muted); display: block; font-weight: 500;">Valor Facturado</span>
            <strong id="kpi-client-sales" style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 700;">$0</strong>
          </div>
        </div>
      </div>

      <!-- Panel de Filtros -->
      <div class="filters-card" style="background: var(--color-surface); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; align-items: end;">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-search-line"></i> Buscar Pedido</label>
            <input type="text" id="search-client-orders" class="form-input" placeholder="Buscar por ID, SKU, Producto, Tracking..." style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-plug-line"></i> Origen / Integración</label>
            <select id="filter-client-origen" class="form-input" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
              <option value="">Todos los orígenes</option>
              <option value="Shopify">Shopify</option>
              <option value="WooCommerce">WooCommerce</option>
              <option value="Jumpseller">Jumpseller</option>
              <option value="MercadoLibre">Mercado Libre</option>
              <option value="Falabella">Falabella</option>
              <option value="Paris">Paris</option>
              <option value="Manual">Manual</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-checkbox-circle-line"></i> Estado Origen</label>
            <select id="filter-client-status" class="form-input" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
              <option value="">Todos los estados</option>
              ${statusOptions}
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;"><i class="ri-download-2-line"></i> Exportación Shopify</label>
            <select id="filter-client-export-status" class="form-input" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;">
              <option value="">Todos</option>
              <option value="pending">Pendientes de exportar</option>
              <option value="exported">Exportados</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Agrupación por Pestañas de Estado WMS -->
      <div id="client-wms-tabs-container" style="margin-bottom: 1.25rem;"></div>

      <!-- Barra de Acciones por Lote (Bulk Actions) -->
      <div id="client-orders-bulk-actions" style="display: none; background: var(--color-surface); border: 1px solid var(--color-primary); padding: 0.75rem 1.25rem; border-radius: var(--radius-md); margin-bottom: 1.25rem; align-items: center; justify-content: space-between; gap: 1rem; box-shadow: var(--shadow-md);">
        <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--color-text-main); font-weight: 600; font-size: 0.9rem;">
          <i class="ri-checkbox-multiple-line" style="color: var(--color-primary); font-size: 1.2rem;"></i>
          <span>Seleccionados: <strong id="selected-orders-count" style="color: var(--color-primary);">0</strong> pedidos</span>
        </div>
        <div style="display: flex; gap: 0.75rem; align-items: center;">
          <button id="btn-bulk-export-shopify" class="btn btn-primary" style="background: #96bf48; border: none; color: white; display: flex; align-items: center; gap: 0.5rem; font-weight: 600; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
            <i class="ri-download-2-line"></i> Exportar Formato Shopify (CSV)
          </button>
          <button id="btn-bulk-mark-exported" class="btn btn-outline" style="border: 1px solid var(--color-border); display: flex; align-items: center; gap: 0.5rem; font-weight: 600; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; color: var(--color-text-main); background: transparent;">
            <i class="ri-check-double-line" style="color: var(--color-success);"></i> Marcar como Exportados
          </button>
          <button id="btn-bulk-clear-selection" class="btn btn-outline" style="border: 1px solid var(--color-border); display: flex; align-items: center; gap: 0.5rem; font-weight: 600; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; color: var(--color-text-muted); background: transparent;">
            Cancelar
          </button>
        </div>
      </div>

      <!-- Tabla de Pedidos -->
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <div>
            <h3 style="margin:0;">Mis Pedidos</h3>
          </div>
          ${actionBtn}
        </div>
        <div class="card-body" style="padding:0; overflow-x: auto;">
          <table class="data-table" style="min-width:600px;">
            <thead>
              <tr>
                <th style="width: 30px; text-align: center;"></th>
                <th style="width: 40px; text-align: center;">
                  <input type="checkbox" id="select-all-client-orders" style="cursor: pointer;">
                </th>
                <th style="min-width:140px;">ID Pedido</th>
                <th>Origen</th>
                <th>Fecha</th>
                <th style="text-align:center;">Artículos</th>
                <th style="text-align:right;">Valor Total</th>
                <th>Tipo Despacho</th>
                <th>SLA</th>
                <th>Etiqueta</th>
                <th>Estado Origen</th>
                <th>Estado WMS</th>
              </tr>
            </thead>
            <tbody id="client-orders-tbody">
              <!-- Carga dinámica -->
            </tbody>
          </table>
        </div>
        <!-- Paginación -->
        <div id="client-wms-pagination-container" style="padding: 1rem; border-top: 1px solid var(--color-border);"></div>
      </div>
    `;

    // Listeners para filtros
    const searchInput = document.getElementById('search-client-orders');
    const origenSelect = document.getElementById('filter-client-origen');
    const statusSelect = document.getElementById('filter-client-status');
    const exportStatusSelect = document.getElementById('filter-client-export-status');

    const triggerFilterUpdate = () => {
      window.clientWmsCurrentPage = 1;
      applyClientWmsFiltersAndRender();
    };

    if (searchInput) searchInput.addEventListener('keyup', triggerFilterUpdate);
    if (origenSelect) origenSelect.addEventListener('change', triggerFilterUpdate);
    if (statusSelect) statusSelect.addEventListener('change', triggerFilterUpdate);
    if (exportStatusSelect) exportStatusSelect.addEventListener('change', triggerFilterUpdate);

    // Listeners para acciones por lote (Bulk Actions)
    setTimeout(() => {
      const btnExport = document.getElementById('btn-bulk-export-shopify');
      const btnMark = document.getElementById('btn-bulk-mark-exported');
      const btnClear = document.getElementById('btn-bulk-clear-selection');
      
      const getSelectedIds = () => {
        const checkboxes = document.querySelectorAll('.order-select-checkbox:checked');
        return Array.from(checkboxes).map(cb => cb.getAttribute('data-order-id'));
      };
      
      if (btnExport) {
        btnExport.addEventListener('click', () => {
          const ids = getSelectedIds();
          if (ids.length === 0) return;
          window.exportShopifyOrdersCsv(ids);
          
          // Preguntar si quiere marcarlos como exportados
          setTimeout(() => {
            if (confirm('¿Deseas marcar los pedidos exportados como "Exportados" en el sistema?')) {
              window.markOrdersAsExported(ids);
            }
          }, 1000);
        });
      }
      
      if (btnMark) {
        btnMark.addEventListener('click', () => {
          const ids = getSelectedIds();
          if (ids.length === 0) return;
          if (confirm(`¿Estás seguro de marcar ${ids.length} pedidos como exportados?`)) {
            window.markOrdersAsExported(ids);
          }
        });
      }
      
      if (btnClear) {
        btnClear.addEventListener('click', () => {
          window.toggleSelectAllClientOrders(false);
          const selectAllCb = document.getElementById('select-all-client-orders');
          if (selectAllCb) selectAllCb.checked = false;
        });
      }
    }, 0);

    // Primera renderización de datos
    applyClientWmsFiltersAndRender();

  } catch (error) {
    console.error('Error fetching orders:', error);
    appContent.innerHTML = getObserverBanner() + `<p class="text-center" style="padding: 2rem; color: red;">Error al cargar pedidos: ${error.message}</p>`;
  }
}

window.applyClientWmsFiltersAndRender = function() {
  const orders = window.clientLoadedOrders || [];
  const shipments = window.clientLoadedShipments || [];

  const searchInput = document.getElementById('search-client-orders');
  const origenSelect = document.getElementById('filter-client-origen');
  const statusSelect = document.getElementById('filter-client-status');
  const exportStatusSelect = document.getElementById('filter-client-export-status');

  const searchText = (searchInput?.value || '').toLowerCase();
  const selectedOrigen = origenSelect?.value || '';
  const selectedStatus = statusSelect?.value || '';
  const selectedExportStatus = exportStatusSelect?.value || '';

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
    if (selectedExportStatus === 'pending') {
      matchesExport = !order.shopify_exported;
    } else if (selectedExportStatus === 'exported') {
      matchesExport = !!order.shopify_exported;
    }

    return matchesSearch && matchesOrigen && matchesStatus && matchesExport;
  };

  // 1. Obtener conteo de pestañas
  const getTabCount = (tabName) => {
    return orders.filter(o => {
      const matchBase = matchesBaseFilters(o);
      const matchTab = tabName === 'Todos' || (o.estado_wms || 'En procesamiento') === tabName;
      return matchBase && matchTab;
    }).length;
  };

  const tabs = ['Todos', 'En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia'];
  const tabsHtml = tabs.map(tab => {
    const isActive = window.clientWmsActiveTab === tab;
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
      <button onclick="window.setClientWmsTab('${tab}')" style="background: ${isActive ? 'var(--color-primary)' : 'transparent'}; color: ${isActive ? '#ffffff' : 'var(--color-text-main)'}; border: ${isActive ? 'none' : '1px solid var(--color-border)'}; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.825rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; transition: all 0.2s;">
        ${tab}
        <span style="background: ${isActive ? 'rgba(255,255,255,0.2)' : badgeBg}; color: ${isActive ? '#ffffff' : badgeColor}; padding: 0.15rem 0.45rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">${count}</span>
      </button>
    `;
  }).join('');
  
  const tabsContainer = document.getElementById('client-wms-tabs-container');
  if (tabsContainer) {
    tabsContainer.innerHTML = `
      <div style="display: flex; gap: 0.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem; flex-wrap: wrap;">
        ${tabsHtml}
      </div>
    `;
  }

  // 2. Filtrar lista
  const filtered = orders.filter(o => {
    const matchBase = matchesBaseFilters(o);
    const matchTab = window.clientWmsActiveTab === 'Todos' || (o.estado_wms || 'En procesamiento') === window.clientWmsActiveTab;
    return matchBase && matchTab;
  });

  // KPIs
  const totalOrders = filtered.length;
  const ordersToProcess = filtered.filter(o => (o.estado_wms || 'En procesamiento') === 'En procesamiento').length;
  const ordersInPrep = filtered.filter(o => o.estado_wms === 'En preparación').length;
  const totalSales = filtered.filter(o => o.estado_wms !== 'Incidencia' && o.status !== 'cancelado').reduce((sum, o) => sum + (Number(o.total_value) || 0), 0);

  document.getElementById('kpi-client-total').textContent = totalOrders;
  document.getElementById('kpi-client-processing').textContent = ordersToProcess;
  document.getElementById('kpi-client-in-prep').textContent = ordersInPrep;
  document.getElementById('kpi-client-sales').textContent = window.formatCLP(totalSales);

  // 3. Paginación
  const totalResults = filtered.length;
  const pageSize = window.clientWmsPageSize === 'All' ? totalResults : parseInt(window.clientWmsPageSize, 10);
  const totalPages = pageSize > 0 ? Math.ceil(totalResults / pageSize) : 1;

  if (window.clientWmsCurrentPage > totalPages) window.clientWmsCurrentPage = totalPages;
  if (window.clientWmsCurrentPage < 1) window.clientWmsCurrentPage = 1;

  const startIndex = (window.clientWmsCurrentPage - 1) * pageSize;
  const endIndex = pageSize === totalResults ? totalResults : Math.min(startIndex + pageSize, totalResults);
  const paginatedOrders = pageSize === totalResults ? filtered : filtered.slice(startIndex, endIndex);

  // 4. Renderizar filas
  const tbody = document.getElementById('client-orders-tbody');
  if (!tbody) return;

  if (paginatedOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
          No se encontraron pedidos con los criterios de búsqueda actuales.
        </td>
      </tr>
    `;
    const pagContainer = document.getElementById('client-wms-pagination-container');
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  let rowsHtml = '';
  paginatedOrders.forEach(order => {
    const orderShipments = shipments.filter(s => 
      s.pedido_referencia === order.id || 
      (order.external_order_number && s.pedido_referencia === order.external_order_number)
    );

    const dateSource = (orderShipments.length > 0 && orderShipments[0].created_at) 
      ? orderShipments[0].created_at 
      : order.created_at;

    const dateObj = new Date(dateSource);
    const dateStr = dateObj.toLocaleDateString();
    
    // Badge de Estado Origen
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

    // Badge de Estado WMS
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
    const platformColor = platform === 'Paris' ? '#e11d48' : (platform === 'Shopify' ? '#96bf48' : (platform === 'Falabella' ? '#84cc16' : (platform === 'MercadoLibre' ? '#f59e0b' : '#6b7280')));
    const platformLower = platform.toLowerCase();
    const originHtml = `<img src="./img/${platformLower}.png" alt="${platform}" title="${platform}" style="height: 42px; max-width: 120px; object-fit: contain; vertical-align: middle;" onerror="this.onerror=null; this.outerHTML='<span style=\\'background-color: ${platformColor}15; color: ${platformColor}; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;\\'>${platform}</span>';" />`;

    const skuStr = order.sku || order.order_items?.map(oi => oi.products?.sku).filter(Boolean).join(', ') || 'Sin SKU';
    const nameStr = order.item || order.order_items?.map(oi => oi.products?.name).filter(Boolean).join(', ') || 'Sin Nombre';
    const totalItems = order.order_items?.reduce((s, i) => s + (i.quantity || 1), 0) || order.cantidad || '-';

    let trackingHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
    let labelHtml = `<span style="color: var(--color-text-muted); font-size: 0.875rem;">-</span>`;
    
    if (order.label_base64) {
      labelHtml = `<button onclick="window.downloadBase64Pdf('${order.label_base64}', 'etiqueta_falabella_${order.external_order_number || order.id}.pdf')" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; font-weight: 600;"><i class="ri-download-2-line"></i> Descargar</button>`;
    }

    if (orderShipments.length > 0) {
      const shipment = orderShipments[0];
      if (shipment.tracking) {
        const courierName = shipment.courier || 'Seguimiento';
        trackingHtml = shipment.tracking_url && shipment.tracking_url !== 'N/A'
          ? `<a href="${shipment.tracking_url}" target="_blank" style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:500;"><i class="ri-truck-line"></i> ${courierName}: ${shipment.tracking}</a>`
          : `<span style="display:inline-flex; align-items:center; gap:0.25rem; color: var(--color-text-main);"><i class="ri-truck-line"></i> ${courierName}: ${shipment.tracking}</span>`;
      }
    }

    const firstShipment = orderShipments[0] || null;
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

    const createdAt = new Date(order.created_at);
    const slaRef = firstShipment?.promised_date || firstShipment?.date_closed || null;
    let slaHtml = `<span style="color:var(--color-text-muted); font-size:0.78rem;">-</span>`;
    if (slaRef) {
      const slaDate = new Date(slaRef);
      const diffDays = Math.round((slaDate - createdAt) / (1000 * 60 * 60 * 24));
      const slaColor = diffDays <= 1 ? '#059669' : (diffDays <= 3 ? '#d97706' : '#dc2626');
      slaHtml = `<span style="font-size:0.78rem; font-weight:600; color:${slaColor};">${diffDays}d</span>`;
    } else if (firstShipment?.servicio_tipo_envio) {
      const slaMap = { flex:'<1d', 'same day':'<1d', '24':'1d', normal:'3-5d', fulfillment:'2d' };
      const match = Object.keys(slaMap).find(k => rawTipo.toLowerCase().includes(k));
      slaHtml = match ? `<span style="font-size:0.75rem; color:var(--color-text-muted);">${slaMap[match]}</span>` : slaHtml;
    }

    // Generar ítems detallados para el desplegable
    let itemsRowsHtml = '';
    if (order.order_items && order.order_items.length > 0) {
      order.order_items.forEach(oi => {
        const pSku = oi.products?.sku || oi.sku || 'Sin SKU';
        const pName = oi.products?.name || oi.item_name || 'Sin Nombre';
        const pQty = Number(oi.quantity) || 1;
        const pPrice = pQty > 0 ? (Number(order.total_value) / pQty) : 0;
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

    // Datos JSON Crudos
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
        <button onclick="window.toggleClientRawOrderJson('${order.id}')" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.25rem; margin-top: 1rem; width: 100%; justify-content: center; font-weight: 600;">
          <i class="ri-code-s-slash-line"></i> Ver JSON de Integración
        </button>
        <div id="raw-json-${order.id}" style="display: none; margin-top: 0.5rem; text-align: left; background: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; word-break: break-all;">
          ${JSON.stringify(rawData, null, 2)}
        </div>
      `;
    }

    const exportBadgeHtml = order.shopify_exported 
      ? `<span class="badge" style="background-color: #d1fae5; color: #065f46; font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.35rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.15rem; width: fit-content; margin-top: 0.2rem;"><i class="ri-check-line"></i> Exportado</span>`
      : '';

    rowsHtml += `
      <tr id="row-${order.id}" class="order-row" data-order-id="${order.id}" style="transition: background-color 0.15s;">
        <td style="cursor: pointer; text-align: center; font-size: 1.2rem; color: var(--color-primary);" onclick="window.toggleClientOrderRow('${order.id}')">
          <i id="chevron-${order.id}" class="ri-arrow-right-s-line expand-icon" style="transition: transform 0.2s; display: inline-block;"></i>
        </td>
        <td style="text-align: center; vertical-align: middle;">
          <input type="checkbox" class="order-select-checkbox" data-order-id="${order.id}" style="cursor: pointer;" onclick="event.stopPropagation();">
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:0.2rem;">
            <span style="font-family:monospace; font-size:0.82rem; background:var(--color-bg); padding:0.2rem 0.45rem; border-radius:var(--radius-sm); border:1px solid var(--color-border); letter-spacing:0.4px; font-weight:600;">${order.external_order_number || order.id.split('-')[0]}</span>
            ${order.external_order_number ? `<span style="font-size:0.7rem; color:var(--color-text-muted);">${order.id.split('-')[0]}</span>` : ''}
            ${exportBadgeHtml}
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
          <span style="background-color:${wmsBadgeBg}; color:${wmsBadgeColor}; padding:0.2rem 0.65rem; border-radius:99px; font-size:0.72rem; font-weight:700; white-space:nowrap; display:inline-block;">${wmsStatus}</span>
        </td>
      </tr>
      
      <!-- Fila Desplegable de Detalles -->
      <tr id="details-${order.id}" class="order-details-row" style="display: none; background-color: var(--color-bg);">
        <td colspan="12" style="padding: 1.5rem; border-top: none; border-bottom: 2px solid var(--color-border);">
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
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Ciudad/Comuna:</strong> ${order.shipping_city || '-'}</p>
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
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Courier:</strong> ${order.courier || '-'}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>N° Seguimiento:</strong> ${trackingHtml}</p>
              <p style="margin-bottom: 0.5rem; font-size: 0.9rem;"><strong>Etiqueta de Envío:</strong> ${labelHtml}</p>
              ${rawJsonBtnHtml}
            </div>

          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;

  // 5. Renderizar paginación
  const pagContainer = document.getElementById('client-wms-pagination-container');
  if (pagContainer) {
    const isFirstPage = window.clientWmsCurrentPage === 1;
    const isLastPage = window.clientWmsCurrentPage === totalPages;
    const rangeStart = startIndex + 1;
    const rangeEnd = endIndex;

    pagContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; font-size: 0.85rem; color: var(--color-text-muted);">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span>Mostrar</span>
          <select id="client-wms-page-size" onchange="window.setClientWmsPageSize(this.value)" class="form-input" style="width: auto; padding: 0.25rem; font-size: 0.8rem; height: auto; margin: 0; display: inline-block;">
            <option value="10" ${window.clientWmsPageSize == 10 ? 'selected' : ''}>10</option>
            <option value="25" ${window.clientWmsPageSize == 25 ? 'selected' : ''}>25</option>
            <option value="50" ${window.clientWmsPageSize == 50 ? 'selected' : ''}>50</option>
            <option value="100" ${window.clientWmsPageSize == 100 ? 'selected' : ''}>100</option>
            <option value="All" ${window.clientWmsPageSize === 'All' ? 'selected' : ''}>Todos</option>
          </select>
          <span>resultados por página</span>
        </div>
        
        <div>
          Mostrando <strong>${rangeStart}-${rangeEnd}</strong> de <strong>${totalResults}</strong> resultados
        </div>

        <div style="display: flex; gap: 0.25rem;">
          <button onclick="window.setClientWmsPage(1)" ${isFirstPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isFirstPage ? 'not-allowed' : 'pointer'}; opacity: ${isFirstPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);"><i class="ri-arrow-left-double-line"></i></button>
          <button onclick="window.setClientWmsPage(${window.clientWmsCurrentPage - 1})" ${isFirstPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isFirstPage ? 'not-allowed' : 'pointer'}; opacity: ${isFirstPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);"><i class="ri-arrow-left-s-line"></i> Anterior</button>
          
          <span style="padding: 0.25rem 0.75rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-weight: 600; color: var(--color-text-main); font-size: 0.75rem; display: inline-flex; align-items: center;">
            Pág. ${window.clientWmsCurrentPage} de ${totalPages}
          </span>

          <button onclick="window.setClientWmsPage(${window.clientWmsCurrentPage + 1})" ${isLastPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isLastPage ? 'not-allowed' : 'pointer'}; opacity: ${isLastPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);">Siguiente <i class="ri-arrow-right-s-line"></i></button>
          <button onclick="window.setClientWmsPage(${totalPages})" ${isLastPage ? 'disabled' : ''} class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: var(--radius-sm); cursor: ${isLastPage ? 'not-allowed' : 'pointer'}; opacity: ${isLastPage ? 0.5 : 1}; background: transparent; border-color: var(--color-border); color: var(--color-text-main);"><i class="ri-arrow-right-double-line"></i></button>
        </div>
      </div>
    `;
  }

  // Vincular eventos para los checkboxes
  const selectAllCb = document.getElementById('select-all-client-orders');
  if (selectAllCb) {
    selectAllCb.checked = false;
    selectAllCb.addEventListener('change', (e) => {
      window.toggleSelectAllClientOrders(e.target.checked);
    });
  }
  
  const checkboxes = document.querySelectorAll('.order-select-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      window.updateClientOrdersBulkSelection();
    });
  });
  
  window.updateClientOrdersBulkSelection();
};

window.setClientWmsTab = function(tab) {
  window.clientWmsActiveTab = tab;
  window.clientWmsCurrentPage = 1;
  applyClientWmsFiltersAndRender();
};

window.setClientWmsPageSize = function(size) {
  window.clientWmsPageSize = size;
  window.clientWmsCurrentPage = 1;
  applyClientWmsFiltersAndRender();
};

window.setClientWmsPage = function(page) {
  window.clientWmsCurrentPage = page;
  applyClientWmsFiltersAndRender();
};

window.toggleClientOrderRow = function(orderId) {
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

window.toggleClientRawOrderJson = function(orderId) {
  const container = document.getElementById(`raw-json-${orderId}`);
  if (!container) return;
  const isHidden = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
};

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
    const jumpsellerIntegration = integrationsList ? integrationsList.find(i => i.platform === 'Jumpseller') : null;

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

    const hasJumpseller = !!jumpsellerIntegration;
    const jumpsellerUrl = hasJumpseller ? jumpsellerIntegration.shop_url : '';
    const jumpsellerStatusText = hasJumpseller 
      ? (jumpsellerIntegration.is_active ? '<span class="badge badge-success" style="background-color: #d1fae5; color: #065f46; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">Activa</span>' : '<span class="badge badge-warning">Inactiva</span>') 
      : '<span class="badge badge-gray" style="background-color: #f3f4f6; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 99px; font-size: 0.75rem;">No configurada</span>';

    let jumpsellerLoginKey = '';
    let jumpsellerAuthToken = '';
    let jumpsellerWebhookSecret = '';
    if (hasJumpseller) {
      jumpsellerWebhookSecret = jumpsellerIntegration.webhook_secret || '';
      try {
        const creds = JSON.parse(jumpsellerIntegration.access_token);
        jumpsellerLoginKey = creds.login_key || '';
        jumpsellerAuthToken = creds.auth_token || '';
      } catch(e) {
        console.error("Error parsing Jumpseller credentials", e);
      }
    }

    const isObserver = userRole === 'observer';
    const disabledAttr = isObserver ? 'disabled' : '';

    const shopifyButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasShopify 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-shopify" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Tienda Shopify</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-shopify" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar Shopify</button>' +
            '<button type="button" class="btn btn-primary" id="btn-sync-shopify" style="background-color: #10b981; border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: white; box-shadow: var(--shadow-sm); transition: all 0.2s;">Sincronizar Productos</button>');

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
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-meli" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar MercadoLibre</button>' +
            '<button type="button" class="btn btn-primary" id="btn-sync-meli" style="background-color: #f59e0b; border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: white; box-shadow: var(--shadow-sm); transition: all 0.2s; margin-left: 0.5rem;">Sincronizar Productos</button>');

    const wooButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasWoo 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-woo" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Tienda WooCommerce</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-woo" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar WooCommerce</button>');

    const jumpsellerButtonHtml = isObserver 
      ? '<button type="button" class="btn" style="background-color: #e2e8f0; color: #94a3b8; cursor: not-allowed;" disabled>Conexión Deshabilitada (Solo Lectura)</button>'
      : (!hasJumpseller 
          ? '<button type="submit" class="btn btn-primary" id="btn-save-jumpseller" style="background-color: var(--color-primary); border: none; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; color: var(--color-dark); box-shadow: var(--shadow-sm); transition: all 0.2s;">Conectar Tienda Jumpseller</button>'
          : '<button type="button" class="btn btn-outline" id="btn-disconnect-jumpseller" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; transition: all 0.2s;">Desconectar Jumpseller</button>');

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

      <!-- Tabs Navigation -->
      <div class="integration-tabs">
        <button class="integration-tab active" data-tab="tab-summary"><i class="ri-dashboard-line"></i> Resumen</button>
        <button class="integration-tab" data-tab="tab-shopify"><i class="ri-shopping-bag-3-line"></i> Shopify</button>
        <button class="integration-tab" data-tab="tab-paris"><i class="ri-store-2-line"></i> París</button>
        <button class="integration-tab" data-tab="tab-falabella"><i class="ri-store-2-line"></i> Falabella</button>
        <button class="integration-tab" data-tab="tab-meli"><i class="ri-store-2-line"></i> MercadoLibre</button>
        <button class="integration-tab" data-tab="tab-woo"><i class="ri-shopping-cart-2-line"></i> WooCommerce</button>
        <button class="integration-tab" data-tab="tab-jumpseller"><i class="ri-shopping-bag-2-line"></i> Jumpseller</button>
        <button class="integration-tab" data-tab="tab-sku-mappings"><i class="ri-equalizer-line"></i> Equivalencias SKU</button>
      </div>

      <!-- Tab Content Container -->
      <div class="integration-content">

        <!-- TAB: Resumen -->
        <div id="tab-summary" class="integration-tab-pane" style="display: block;">
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
            ${hasShopify ? '<div class="card" style="border: 1px solid rgba(16, 185, 129, 0.2); background: rgba(16, 185, 129, 0.05); margin: 0;"><div class="card-body" style="padding: 1.5rem; display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 1rem;"><i class="ri-shopping-bag-3-line" style="font-size: 2rem; color: #10b981;"></i><div><h4 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);">Shopify</h4><span style="font-size: 0.85rem; color: var(--color-text-muted);">' + shopUrl + '</span></div></div>' + shopifyStatusText + '</div></div>' : ''}
            ${hasParis ? '<div class="card" style="border: 1px solid rgba(16, 185, 129, 0.2); background: rgba(16, 185, 129, 0.05); margin: 0;"><div class="card-body" style="padding: 1.5rem; display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 1rem;"><i class="ri-store-2-line" style="font-size: 2rem; color: #10b981;"></i><div><h4 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);">París</h4><span style="font-size: 0.85rem; color: var(--color-text-muted);">Activa</span></div></div>' + parisStatusText + '</div></div>' : ''}
            ${hasFalabella ? '<div class="card" style="border: 1px solid rgba(132, 204, 22, 0.2); background: rgba(132, 204, 22, 0.05); margin: 0;"><div class="card-body" style="padding: 1.5rem; display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 1rem;"><i class="ri-store-2-line" style="font-size: 2rem; color: #84cc16;"></i><div><h4 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);">Falabella</h4><span style="font-size: 0.85rem; color: var(--color-text-muted);">' + falabellaUser + '</span></div></div>' + falabellaStatusText + '</div></div>' : ''}
            ${hasMeli ? '<div class="card" style="border: 1px solid rgba(245, 158, 11, 0.2); background: rgba(245, 158, 11, 0.05); margin: 0;"><div class="card-body" style="padding: 1.5rem; display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 1rem;"><i class="ri-store-2-line" style="font-size: 2rem; color: #f59e0b;"></i><div><h4 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);">MercadoLibre</h4><span style="font-size: 0.85rem; color: var(--color-text-muted);">Conectado</span></div></div>' + meliStatusText + '</div></div>' : ''}
            ${hasWoo ? '<div class="card" style="border: 1px solid rgba(150, 88, 138, 0.2); background: rgba(150, 88, 138, 0.05); margin: 0;"><div class="card-body" style="padding: 1.5rem; display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 1rem;"><i class="ri-shopping-cart-2-line" style="font-size: 2rem; color: #96588a;"></i><div><h4 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);">WooCommerce</h4><span style="font-size: 0.85rem; color: var(--color-text-muted);">' + wooUrl + '</span></div></div>' + wooStatusText + '</div></div>' : ''}
            ${hasJumpseller ? '<div class="card" style="border: 1px solid rgba(2, 132, 199, 0.2); background: rgba(2, 132, 199, 0.05); margin: 0;"><div class="card-body" style="padding: 1.5rem; display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 1rem;"><i class="ri-shopping-bag-2-line" style="font-size: 2rem; color: #0284c7;"></i><div><h4 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);">Jumpseller</h4><span style="font-size: 0.85rem; color: var(--color-text-muted);">' + jumpsellerUrl + '</span></div></div>' + jumpsellerStatusText + '</div></div>' : ''}
            ${!hasShopify && !hasParis && !hasFalabella && !hasMeli && !hasWoo && !hasJumpseller ? '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--color-surface); border-radius: 0.5rem; border: 1px dashed var(--color-border);"><i class="ri-plug-line" style="font-size: 3rem; color: var(--color-text-muted); margin-bottom: 1rem; display: block;"></i><h3 style="color: var(--color-text-main); margin-bottom: 0.5rem;">No hay integraciones activas</h3><p style="color: var(--color-text-muted);">Selecciona una plataforma en las pestañas superiores para comenzar.</p></div>' : ''}
          </div>
        </div>

        <!-- TAB: Shopify -->
        <div id="tab-shopify" class="integration-tab-pane" style="display: none;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
            <div class="card" style="border:none; box-shadow: var(--shadow-md); margin:0;">
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
                  
                  ${!hasShopify ? `
                  <div style="margin-bottom: 1.25rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; font-weight: 600; cursor: pointer; color: var(--color-text-main);">
                      <input type="checkbox" id="shopify-manual-mode" style="cursor: pointer;">
                      <span>¿Conectar manualmente usando API Access Token privado?</span>
                    </label>
                  </div>
                  <div id="shopify-manual-fields" style="display: none; border-left: 2px solid var(--color-primary); padding-left: 1rem; margin-bottom: 1.25rem; margin-top: 0.5rem;">
                    <div class="form-group" style="margin-bottom: 1rem;">
                      <label class="form-label" style="font-weight: 600; font-size: 0.85rem;">Token de acceso Admin API (shpat_...)</label>
                      <input type="password" id="shopify-access-token" class="form-input" placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                    </div>
                    <div class="form-group" style="margin-bottom: 1rem;">
                      <label class="form-label" style="font-weight: 600; font-size: 0.85rem;">Secreto del Cliente / Webhook Secret</label>
                      <input type="password" id="shopify-webhook-secret" class="form-input" placeholder="shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                    </div>
                  </div>
                  ` : ''}

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
                    <strong style="color: var(--color-text-main);">Inicia la Conexión:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Ingresa la URL de tu tienda Shopify (ej: mitienda.myshopify.com) en el formulario y haz clic en <strong style="color: var(--color-text-main);">Conectar Tienda Shopify</strong>.</p>
                  </li>
                  <li>
                    <strong style="color: var(--color-text-main);">Autoriza la Aplicación:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Serás redirigido a tu panel de Shopify. Inicia sesión si es necesario y haz clic en <strong style="color: var(--color-text-main);">Instalar aplicación</strong> para otorgar los permisos de sincronización de pedidos e inventario a WMS STOCKA.</p>
                  </li>
                  <li>
                    <strong style="color: var(--color-text-main);">Conexión Exitosa:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Una vez instalada, serás redirigido de vuelta al WMS y tu tienda aparecerá como <strong style="color: var(--color-text-main);">Activa</strong>. Los nuevos pedidos comenzarán a sincronizarse automáticamente.</p>
                  </li>
                </ol>

                <div style="margin-top: 1.5rem; border-top: 1px solid var(--color-border); padding-top: 1.5rem;">
                  <h4 style="margin: 0 0 1rem 0; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem; color: var(--color-text-main); cursor: pointer;" id="toggle-manual-guide">
                    <span><i class="ri-information-line" style="color: var(--color-primary);"></i></span>
                    <span style="font-weight: 600;">¿Cómo conectar manualmente con Token Privado?</span>
                    <i class="ri-arrow-down-s-line" id="arrow-manual-guide" style="margin-left: auto; transition: transform 0.2s;"></i>
                  </h4>
                  <div id="manual-guide-content" style="display: none; font-size: 0.85rem; color: var(--color-text-muted); line-height: 1.6;">
                    <p style="margin-bottom: 0.75rem;">Si prefieres conectar tu tienda sin pasar por la aprobación de Shopify, puedes crear una aplicación personalizada privada en tu administrador de Shopify:</p>
                    <ol style="padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem;">
                      <li>
                        <strong>Habilitar desarrollo de apps:</strong>
                        <p style="margin: 0;">Ve a tu panel de Shopify -> <strong>Configuración</strong> -> <strong>Aplicaciones y canales de venta</strong> -> Haz clic en <strong>Desarrollar aplicaciones</strong> -> Activa el desarrollo si aún no lo has hecho.</p>
                      </li>
                      <li>
                        <strong>Crear la aplicación:</strong>
                        <p style="margin: 0;">Haz clic en <strong>Crear una aplicación</strong>, nómbrala (ej: <code>STOCKA WMS Conexión</code>) y selecciona tu usuario administrador.</p>
                      </li>
                      <li>
                        <strong>Configurar alcances del API (Scopes):</strong>
                        <p style="margin: 0;">Entra a <strong>Configuración del API del panel de control</strong> y otorga los siguientes permisos:</p>
                        <ul style="padding-left: 1rem; margin-top: 0.25rem; list-style-type: disc;">
                          <li><code>read_products</code> (Leer productos)</li>
                          <li><code>read_orders</code> (Leer pedidos)</li>
                        </ul>
                      </li>
                      <li>
                        <strong>Instalar y Copiar Token:</strong>
                        <p style="margin: 0;">Haz clic en <strong>Instalar aplicación</strong> en la esquina superior derecha. En la pestaña <strong>Credenciales de API</strong> verás el <strong>Token de acceso de la API del panel de control</strong>. Cópialo al portapapeles (este token comienza con <code>shpat_</code> y solo se puede ver una vez).</p>
                      </li>
                      <li>
                        <strong>Copiar Secreto de Cliente:</strong>
                        <p style="margin: 0;">En esa misma pestaña de Credenciales, desplázate un poco hacia abajo hasta la caja <strong>Clave de API y secreto de cliente</strong>. Copia el valor de <strong>Secreto de cliente</strong> (comienza con <code>shpss_</code>). Este secreto es indispensable para validar las firmas de las notificaciones de pedidos en tiempo real.</p>
                      </li>
                      <li>
                        <strong>Pega en el WMS:</strong>
                        <p style="margin: 0;">Regresa aquí, marca la casilla manual, pega los valores y haz clic en <strong>Guardar Conexión Manual</strong>.</p>
                      </li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB: Paris -->
        <div id="tab-paris" class="integration-tab-pane" style="display: none;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
            <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
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
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Inicia sesión en tu portal de vendedor de París (Cencosud) y navega a la sección <strong style="color: var(--color-text-main);">Mi Cuenta &gt; Integraciones</strong> o Ajustes de API.</p>
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
        </div>

        <!-- TAB: Falabella -->
        <div id="tab-falabella" class="integration-tab-pane" style="display: none;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
            <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
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
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Inicia sesión en tu Seller Center de Falabella (Mirakl) y ve a la sección de configuración de perfil / API Key. Necesitarás tu <strong style="color: var(--color-text-main);">User ID</strong> (email de acceso API) y la <strong style="color: var(--color-text-main);">API Key</strong> correspondiente.</p>
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

        <!-- TAB: MercadoLibre -->
        <div id="tab-meli" class="integration-tab-pane" style="display: none;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
            <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
              <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
                <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> MercadoLibre Marketplace</h3>
              </div>
              <div class="card-body" style="padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasMeli ? 'rgba(245, 158, 11, 0.1)' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasMeli ? 'rgba(245, 158, 11, 0.2)' : 'var(--color-border)'};">
                   <div style="display: flex; align-items: center; gap: 1rem;">
                      <div>
                         <h4 style="margin: 0; font-size: 1.1rem; color: ${hasMeli ? '#f59e0b' : 'var(--color-text-main)'};">MercadoLibre Store (Official API)</h4>
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
                    <input type="text" id="meli-client-id" class="form-input" placeholder="ej. 34091030018433" value="${meliClientId || '34091030018433'}" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasMeli ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Client Secret (Key)</label>
                    <input type="password" id="meli-client-secret" class="form-input" placeholder="Ingresa tu Client Secret" value="EJA46V6AKIWDAWG4xQ1y14pteBWR0yGl" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem;">
                    <label class="form-label" style="font-weight: 600;">Redirect URI</label>
                    <input type="text" id="meli-redirect-uri" class="form-input" placeholder="ej. https://www.google.com" value="${meliRedirectUri || 'https://www.google.com'}" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasMeli ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Código de Autorización (Authorization Code)</label>
                    <input type="password" id="meli-auth-code" class="form-input" placeholder="TG-xxxxxxxxx-xxxxxxxxx" ${hasMeli ? '' : ''} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                    <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Requerido para nuevas integraciones. Debe incluir el guión y los números del final.</p>
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasMeli ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Refresh Token Existente (Opcional - Migración)</label>
                    <input type="password" id="meli-refresh-token" class="form-input" placeholder="TG-xxxxxxxxxxxxx-xxxxxxxx" ${hasMeli ? '' : ''} ${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
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
                      Inicia sesión, autoriza el acceso y copia el código de autorización completo que aparece en la barra de direcciones después de <strong style="color: var(--color-text-main);">code=</strong>.<br>
                      <span style="color: #ef4444; font-weight: 600;"><i class="ri-error-warning-line"></i> IMPORTANTE:</span> Asegúrate de copiar el código <strong>completo</strong>, incluyendo el guión y los números que vienen al final (ej: <code style="background-color: var(--color-bg); padding: 0.1rem 0.3rem; border-radius: 0.25rem; font-family: monospace;">TG-xxxxxxxxx-xxxxxxxxxx</code>). Si omites la parte final, la conexión fallará.
                    </p>
                  </li>
                  <li>
                    <strong style="color: var(--color-text-main);">Migración directa desde Google Sheets (Alternativa):</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">
                      Si ya tenías la cuenta conectada mediante el script de Google Sheets, deja el campo de código de autorización vacío y pega directamente tu <strong style="color: var(--color-text-main);">Refresh Token Existente</strong> extraído del Apps Script.
                    </p>
                  </li>
                </ol>
              </div>
            </div>
          </div>

          <!-- Información de Servicios -->
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin: 1.5rem 0 0 0; background-color: var(--color-surface);">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-information-line" style="color: var(--color-primary);"></i></span> Servicios Disponibles y Tarifas
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem; color: var(--color-text-muted); font-size: 0.9rem; line-height: 1.6;">
              <p style="margin-top: 0;">Stocka puede conectarse a tu cuenta de MercadoLibre para el procesamiento automatizado de tus ventas. Al integrar tu cuenta, podrás activar modalidades como <strong>Flex</strong>, <strong>MercadoEnvíos</strong> y gestionar envíos de mercadería a <strong>Full</strong>.</p>
              
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-top: 1.25rem;">
                <div style="background: var(--color-bg); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                  <h4 style="margin: 0 0 0.5rem 0; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;"><i class="ri-flashlight-line" style="color: #f59e0b; font-size: 1.1rem;"></i> MercadoLibre Flex</h4>
                  <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-muted);">El costo de despacho Flex es de <strong>$3.200 + IVA</strong> y cubre las 36 comunas que ofrece MercadoLibre en la Región Metropolitana. Además se debe considerar el costo regular de preparación del pedido.</p>
                </div>
                <div style="background: var(--color-bg); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                  <h4 style="margin: 0 0 0.5rem 0; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;"><i class="ri-truck-line" style="color: #3b82f6; font-size: 1.1rem;"></i> MercadoEnvíos</h4>
                  <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-muted);">El costo para pedidos de MercadoEnvíos corresponde únicamente al costo de preparación del pedido + un recargo de <strong>$100</strong>. No hay costos de despacho cobrados por Stocka.</p>
                </div>
                <div style="background: var(--color-bg); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                  <h4 style="margin: 0 0 0.5rem 0; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;"><i class="ri-building-2-line" style="color: #10b981; font-size: 1.1rem;"></i> Envíos FULL</h4>
                  <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-muted);">El costo de procesamiento de envíos FULL se trata como un pedido normal (aplicando los recargos de SKU o unidades totales si corresponde), y conlleva un cargo adicional de <strong>$100 por unidad</strong>.</p>
                </div>
              </div>
              
              <div style="margin-top: 1.5rem; padding: 1rem 1.25rem; background-color: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.75rem;">
                <i class="ri-customer-service-2-line" style="font-size: 1.5rem; color: var(--color-primary);"></i>
                <p style="margin: 0; color: var(--color-primary); font-weight: 500; font-size: 0.9rem;">Para activar cada servicio, pueden contactar con nosotros a través de su ejecutiva KAM.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB: WooCommerce -->
        <div id="tab-woo" class="integration-tab-pane" style="display: none;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
            <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
              <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
                <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shopping-cart-2-line"></i> WooCommerce Integration</h3>
              </div>
              <div class="card-body" style="padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasWoo ? 'rgba(150, 88, 138, 0.1)' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasWoo ? 'rgba(150, 88, 138, 0.2)' : 'var(--color-border)'};">
                   <div style="display: flex; align-items: center; gap: 1rem;">
                      <div>
                         <h4 style="margin: 0; font-size: 1.1rem; color: ${hasWoo ? '#96588a' : 'var(--color-text-main)'};">WooCommerce Store</h4>
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
                    <input type="text" id="woo-url" class="form-input" placeholder="ej. https://mitienda.cl" value="${wooUrl}" ${hasWoo ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasWoo || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasWoo ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Consumer Key</label>
                    <input type="password" id="woo-key" class="form-input" placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="${wooKey}" ${hasWoo ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasWoo || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasWoo ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Consumer Secret</label>
                    <input type="password" id="woo-secret" class="form-input" placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="${wooSecret}" ${hasWoo ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasWoo || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
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

        <!-- TAB: Jumpseller -->
        <div id="tab-jumpseller" class="integration-tab-pane" style="display: none;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
            <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
              <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
                <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shopping-bag-2-line"></i> Jumpseller Integration</h3>
              </div>
              <div class="card-body" style="padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: ${hasJumpseller ? 'rgba(2, 132, 199, 0.1)' : 'var(--color-bg)'}; padding: 1rem; border-radius: 0.5rem; border: 1px solid ${hasJumpseller ? 'rgba(2, 132, 199, 0.2)' : 'var(--color-border)'};">
                   <div style="display: flex; align-items: center; gap: 1rem;">
                      <div>
                         <h4 style="margin: 0; font-size: 1.1rem; color: ${hasJumpseller ? '#0284c7' : 'var(--color-text-main)'};">Jumpseller Store</h4>
                         <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de pedidos y productos.</p>
                      </div>
                   </div>
                   <div>
                      ${jumpsellerStatusText}
                   </div>
                </div>
                <form id="form-jumpseller-integration">
                  <div class="form-group" style="margin-bottom: 1.25rem;">
                    <label class="form-label" style="font-weight: 600;">URL de tu tienda Jumpseller</label>
                    <input type="text" id="jumpseller-url" class="form-input" placeholder="ej. https://mitienda.jumpseller.com" value="${jumpsellerUrl}" ${hasJumpseller ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasJumpseller || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasJumpseller ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Login Key</label>
                    <input type="text" id="jumpseller-login-key" class="form-input" placeholder="ej. api_user@domain.com o login key de la API" value="${jumpsellerLoginKey}" ${hasJumpseller ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasJumpseller || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasJumpseller ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Auth Token</label>
                    <input type="password" id="jumpseller-auth-token" class="form-input" placeholder="Token de autorización API" value="${jumpsellerAuthToken}" ${hasJumpseller ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasJumpseller || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div class="form-group" style="margin-bottom: 1.25rem; ${hasJumpseller ? 'display:none;' : ''}">
                    <label class="form-label" style="font-weight: 600;">Webhook Secret (Hooks Token)</label>
                    <input type="password" id="jumpseller-webhook-secret" class="form-input" placeholder="Token de notificaciones (webhooks)" value="${jumpsellerWebhookSecret}" ${hasJumpseller ? 'readonly' : 'required'} ${disabledAttr} style="background-color: ${hasJumpseller || isObserver ? 'var(--color-bg)' : 'var(--color-surface)'}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                  </div>
                  <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                    ${jumpsellerButtonHtml}
                  </div>
                </form>
              </div>
            </div>
            <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
              <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
                <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                  <span><i class="ri-shopping-bag-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración Jumpseller
                </h3>
              </div>
              <div class="card-body" style="padding: 1.5rem;">
                <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                  <li>
                    <strong style="color: var(--color-text-main);">Habilitar HTTPS:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Asegúrate de que tu tienda Jumpseller esté activa y sea accesible de forma segura bajo HTTPS.</p>
                  </li>
                  <li>
                    <strong style="color: var(--color-text-main);">Obtener Credenciales de la API:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">En tu panel administrativo de Jumpseller, ve a <em>Configuración &gt; API</em> (o entra en la esquina superior de tu cuenta). Copia el <strong>Login Key</strong> y el <strong>Auth Token</strong> generados.</p>
                  </li>
                  <li>
                    <strong style="color: var(--color-text-main);">Guardar Configuración:</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Pega la URL de tu tienda (ej: <code>https://mitienda.jumpseller.com</code>), el Login Key y el Auth Token en el formulario y haz clic en <strong>Conectar Tienda Jumpseller</strong>.</p>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB: Equivalencias SKU -->
        <div id="tab-sku-mappings" class="integration-tab-pane" style="display: none; animation: fadeIn 0.3s ease;">
          <!-- Configuración de Plataforma Principal -->
          <div class="card" style="border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); margin-bottom: 2rem; border-radius: var(--radius-lg); background: var(--color-surface); overflow: hidden;">
            <div class="card-header" style="background: linear-gradient(90deg, rgba(37,99,235,0.05) 0%, rgba(37,99,235,0) 100%); padding: 1.5rem 2rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
              <div>
                <h4 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 600; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                  <i class="ri-settings-4-line" style="color: var(--color-primary);"></i> Plataforma Principal de Ventas
                </h4>
                <p style="margin: 0; font-size: 0.9rem; color: var(--color-text-muted);">
                  Establece la plataforma de donde proviene tu catálogo maestro de productos.
                </p>
              </div>
              <div style="display: flex; align-items: center; gap: 1rem;">
                <select id="eq-main-platform-select" class="form-input" style="min-width: 200px; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.6rem 1rem;">
                  <option value="">Ninguna (Usar WMS)</option>
                  <option value="Shopify">Shopify</option>
                  <option value="MercadoLibre">MercadoLibre</option>
                  <option value="Falabella">Falabella</option>
                  <option value="Paris">París</option>
                  <option value="WooCommerce">WooCommerce</option>
                  <option value="Jumpseller">Jumpseller</option>
                </select>
                <button id="btn-save-main-platform" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.5rem; border-radius: var(--radius-md); padding: 0.6rem 1.2rem; font-weight: 500; transition: all 0.2s;">
                  <i class="ri-save-line"></i> Guardar
                </button>
              </div>
            </div>
          </div>

          <!-- Tarjeta de Instrucciones y Descarga de Plantilla -->
          <div class="card" style="border: 1px solid rgba(59, 130, 246, 0.2); box-shadow: var(--shadow-sm); margin-bottom: 2rem; border-radius: var(--radius-lg); background: rgba(59, 130, 246, 0.02); overflow: hidden; padding: 1.5rem 2rem;">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; color: var(--color-primary); display: flex; align-items: center; gap: 0.5rem; font-weight: 600;">
              <i class="ri-information-line"></i> Instrucciones de Importación Masiva
            </h4>
            <p style="margin: 0 0 1.25rem 0; font-size: 0.9rem; color: var(--color-text-muted); line-height: 1.6;">
              Sube una planilla Excel o CSV para cargar equivalencias de SKU de forma masiva. Las columnas requeridas son:
              <br><strong>• Plataforma:</strong> El nombre de la plataforma (Shopify, MercadoLibre, Falabella, Paris, WooCommerce, Jumpseller o Todas).
              <br><strong>• SKU Plataforma:</strong> El SKU externo de la plataforma de ventas.
              <br><strong>• SKU Master:</strong> El SKU maestro de tu catálogo WMS (el producto físico).
            </p>
            <button id="btn-download-sku-template" class="btn btn-outline" style="border-color: var(--color-primary); color: var(--color-primary); background: transparent; padding: 0.5rem 1.2rem; border-radius: var(--radius-md); font-size: 0.875rem; font-weight: 500; display: inline-flex; align-items: center; gap: 0.5rem; transition: all 0.2s;">
              <i class="ri-download-2-line"></i> Descargar Planilla de Ejemplo
            </button>
          </div>

          <!-- Matriz / Grid Principal -->
          <div class="card" style="border: 1px solid var(--color-border); box-shadow: var(--shadow-md); margin-bottom: 2rem; border-radius: var(--radius-lg); background: var(--color-surface); overflow: hidden;">
            <div class="card-header" style="background-color: var(--color-surface); border-bottom: 1px solid var(--color-border); padding: 1.5rem 2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
              <div>
                <h3 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 600; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;" id="eq-matrix-title">
                  <i class="ri-table-2" style="color: var(--color-primary);"></i> Matriz de Equivalencias
                </h3>
                <p style="margin: 0; font-size: 0.9rem; color: var(--color-text-muted);">Asigna los SKUs equivalentes para tus plataformas de venta secundarias.</p>
              </div>
              <div style="display: flex; gap: 1rem; align-items: center;">
                <div style="position: relative;">
                  <i class="ri-search-line" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
                  <input type="text" id="eq-matrix-search" class="form-input" placeholder="Buscar producto..." style="width: 250px; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-full); padding: 0.5rem 1rem 0.5rem 2.5rem; font-size: 0.9rem; transition: border-color 0.2s;">
                </div>
                <input type="file" id="eq-matrix-import-excel" accept=".xlsx, .xls, .csv" style="display: none;">
                <label for="eq-matrix-import-excel" class="btn btn-outline" style="cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; border-radius: var(--radius-md); border-color: var(--color-border); background: var(--color-bg); color: var(--color-text-main); padding: 0.5rem 1rem; font-weight: 500; transition: all 0.2s;">
                  <i class="ri-file-excel-2-line" style="color: var(--color-success);"></i> Importar Planilla
                </label>
              </div>
            </div>
            <div class="card-body" style="padding: 0; overflow-x: auto;">
              <table class="data-table" style="width: 100%; border-collapse: collapse; min-width: 900px;">
                <thead id="eq-matrix-thead">
                  <tr style="border-bottom: 2px solid var(--color-border); background: var(--color-bg);">
                    <th style="padding: 1rem 2rem; text-align: left; font-size: 0.85rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Producto (Principal)</th>
                    <th style="padding: 1rem 2rem; text-align: left; font-size: 0.85rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">SKU Principal</th>
                  </tr>
                </thead>
                <tbody id="eq-matrix-tbody">
                  <tr>
                    <td colspan="4" style="text-align: center; padding: 3rem; color: var(--color-text-muted); font-size: 0.95rem;">
                      <i class="ri-loader-4-line ri-spin" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: var(--color-primary);"></i>
                      Cargando matriz...
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Sección de Chequeo de Consistencia (Errores / Advertencias) -->
          <div class="card" style="border: 1px solid rgba(239, 68, 68, 0.3); box-shadow: var(--shadow-sm); border-radius: var(--radius-lg); background: linear-gradient(145deg, rgba(239, 68, 68, 0.02) 0%, rgba(239, 68, 68, 0.05) 100%); overflow: hidden; margin-bottom: 1.5rem;">
            <div class="card-header" style="border-bottom: 1px solid rgba(239, 68, 68, 0.1); padding: 1.5rem 2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
              <div>
                <h3 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; font-weight: 600; color: var(--color-danger); display: flex; align-items: center; gap: 0.5rem;">
                  <i class="ri-error-warning-line"></i> Chequeo de Consistencia de Canales Secundarios
                </h3>
                <p style="margin: 0; color: var(--color-text-muted); font-size: 0.9rem;">
                  Valida que los productos que no se encuentran en la plataforma principal tengan exactamente el mismo SKU asignado en todas las plataformas secundarias de venta.
                </p>
              </div>
              <button id="btn-run-consistency-check" class="btn btn-outline" style="border-color: var(--color-danger); color: var(--color-danger); background: transparent; padding: 0.5rem 1.2rem; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.5rem; font-weight: 500; transition: all 0.2s;">
                <i class="ri-refresh-line"></i> Validar SKUs
              </button>
            </div>
            <div class="card-body" style="padding: 1.5rem 2rem;">
              <div id="eq-consistency-results" style="font-size: 0.9rem; padding: 1rem; border-radius: var(--radius-md); background: var(--color-surface); border: 1px dashed var(--color-border);">
                <span style="color: var(--color-text-muted); display: flex; align-items: center; gap: 0.5rem;">
                  <i class="ri-information-line"></i> Haz clic en "Validar SKUs" para iniciar el análisis.
                </span>
              </div>
            </div>
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
            const tabId = tab.getAttribute('data-tab');
            const targetPane = document.getElementById(tabId);
            if (targetPane) {
              targetPane.style.display = 'block';
            }
            if (tabId === 'tab-sku-mappings') {
              renderSkuMappings();
            }
          });
        });

        // Toggle para la conexión manual de Shopify
        const chkManual = document.getElementById('shopify-manual-mode');
        const divManual = document.getElementById('shopify-manual-fields');
        const btnSave = document.getElementById('btn-save-shopify');
        const txtAccessToken = document.getElementById('shopify-access-token');
        const txtWebhookSecret = document.getElementById('shopify-webhook-secret');
        
        if (chkManual && divManual && btnSave) {
          chkManual.addEventListener('change', () => {
            if (chkManual.checked) {
              divManual.style.display = 'block';
              btnSave.textContent = 'Guardar Conexión Manual';
              txtAccessToken.required = true;
              txtWebhookSecret.required = true;
            } else {
              divManual.style.display = 'none';
              btnSave.textContent = 'Conectar Tienda Shopify';
              txtAccessToken.required = false;
              txtWebhookSecret.required = false;
            }
          });
        }

        // Toggle para mostrar/ocultar la guía de conexión manual
        const toggleGuide = document.getElementById('toggle-manual-guide');
        const guideContent = document.getElementById('manual-guide-content');
        const arrowGuide = document.getElementById('arrow-manual-guide');
        
        if (toggleGuide && guideContent) {
          toggleGuide.addEventListener('click', () => {
            if (guideContent.style.display === 'none') {
              guideContent.style.display = 'block';
              if (arrowGuide) arrowGuide.style.transform = 'rotate(180deg)';
            } else {
              guideContent.style.display = 'none';
              if (arrowGuide) arrowGuide.style.transform = 'rotate(0deg)';
            }
          });
        }
      }, 0);


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

        const shop_url = document.getElementById('shopify-url').value.trim();
        const cleanShopUrl = shop_url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
        
        if (!cleanShopUrl.endsWith('.myshopify.com')) {
          alert('Por favor, ingresa una URL válida de Shopify (ej: mitienda.myshopify.com)');
          btn.disabled = false;
          btn.textContent = document.getElementById('shopify-manual-mode')?.checked ? 'Guardar Conexión Manual' : 'Conectar Tienda Shopify';
          return;
        }

        const chkManual = document.getElementById('shopify-manual-mode');
        const isManual = chkManual ? chkManual.checked : false;

        if (isManual) {
          btn.textContent = 'Guardando conexión...';
          const accessToken = document.getElementById('shopify-access-token').value.trim();
          const webhookSecret = document.getElementById('shopify-webhook-secret').value.trim();

          if (!accessToken || !webhookSecret) {
            alert('Por favor, ingresa tanto el Token de acceso como el Secreto de cliente.');
            btn.disabled = false;
            btn.textContent = 'Guardar Conexión Manual';
            return;
          }

          try {
            const { error: saveErr } = await supabase
              .from('merchant_integrations')
              .upsert({
                merchant_id: merchantId,
                comercio: window.activeIntegrationCommerce,
                platform: 'Shopify',
                shop_url: cleanShopUrl,
                access_token: accessToken,
                webhook_secret: webhookSecret,
                is_active: true
              }, { onConflict: 'comercio,platform' });

            if (saveErr) throw saveErr;

            btn.textContent = 'Sincronizando catálogo...';
            // Ejecutar la primera sincronización y registro de webhooks de forma automática
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/shopify-oauth', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${session.access_token}`
                }
              });
            }

            alert('Tienda Shopify conectada manualmente y catálogo sincronizado con éxito.');
            renderIntegrations();
          } catch (err) {
            console.error(err);
            alert('Error al guardar conexión manual: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Guardar Conexión Manual';
          }
          return;
        }

        btn.textContent = 'Redirigiendo a Shopify...';
        // Configuración de la App en Shopify Partners
        const clientId = '67efac0695de4fde9f6c8d90ed2319b4'; // Client ID de Shopify Partners de STOCKA WMS
        const scopes = 'read_products,read_orders';
        const redirectUri = 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/shopify-oauth';
        
        const stateObj = {
          merchant_id: merchantId,
          comercio: window.activeIntegrationCommerce,
          redirect_back_url: window.location.origin + window.location.pathname
        };
        // Codificar el state en base64 para transportarlo de forma segura
        const stateBase64 = btoa(JSON.stringify(stateObj));

        // Redirigir a la pantalla de instalación oficial de Shopify
        window.location.href = `https://${cleanShopUrl}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(stateBase64)}`;
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

      document.getElementById('btn-sync-shopify').addEventListener('click', async () => {
        if (userRole === 'observer') {
          alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
          return;
        }
        
        const btnSync = document.getElementById('btn-sync-shopify');
        btnSync.disabled = true;
        btnSync.textContent = 'Sincronizando...';

        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error("No hay sesión activa");

          const response = await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/shopify-oauth', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            }
          });

          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.error || 'Error al sincronizar');
          }

          alert(`¡Catálogo sincronizado exitosamente! Se importaron/actualizaron ${result.count} variantes de productos.`);
          if (typeof renderInventory === 'function') {
            renderInventory(); // Recargar inventario si corresponde
          }
        } catch (err) {
          console.error(err);
          alert('Error en la sincronización: ' + err.message);
        } finally {
          btnSync.disabled = false;
          btnSync.textContent = 'Sincronizar Productos';
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

          // Mostrar overlay de carga premium
          const loadingOverlay = document.createElement('div');
          loadingOverlay.id = 'meli-loading-overlay';
          loadingOverlay.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(4px);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            color: white;
            font-family: inherit;
            transition: all 0.3s ease;
          `;
          loadingOverlay.innerHTML = `
            <div style="background: var(--color-surface, #1e293b); padding: 2.5rem; border-radius: var(--radius-lg, 12px); border: 1px solid var(--color-border, #334155); box-shadow: var(--shadow-2xl); text-align: center; max-width: 400px; width: 90%;">
              <i class="ri-loader-4-line ri-spin" style="font-size: 3rem; color: #f59e0b; display: inline-block; margin-bottom: 1.5rem;"></i>
              <h3 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text-main, #f8fafc);">Conectando con MercadoLibre</h3>
              <p style="margin: 0 0 1.5rem 0; font-size: 0.9rem; color: var(--color-text-muted, #94a3b8); line-height: 1.5;">
                Estamos validando tus credenciales y realizando la primera sincronización de tu catálogo de productos. Esto puede tomar unos segundos...
              </p>
              <div style="width: 100%; background: var(--color-bg, #0f172a); height: 6px; border-radius: 99px; overflow: hidden; position: relative;">
                <div style="position: absolute; height: 100%; background: #f59e0b; width: 30%; border-radius: 99px; animation: meliProgress 1.5s infinite ease-in-out;"></div>
              </div>
            </div>
            <style>
              @keyframes meliProgress {
                0% { left: -30%; }
                50% { width: 40%; }
                100% { left: 100%; }
              }
            </style>
          `;
          document.body.appendChild(loadingOverlay);

          const client_id = document.getElementById('meli-client-id').value.trim();
          const client_secret = document.getElementById('meli-client-secret').value.trim();
          const redirect_uri = document.getElementById('meli-redirect-uri').value.trim();
          const auth_code = document.getElementById('meli-auth-code').value.trim();
          const refresh_token = document.getElementById('meli-refresh-token').value.trim();

          if (!auth_code && !refresh_token) {
            loadingOverlay.remove();
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
            
            // Llamar a la Edge Function inmediatamente para intercambiar el código
            let syncNotice = '';
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (session) {
                const response = await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/meli-sync', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                  },
                  body: JSON.stringify({
                    comercio: window.activeIntegrationCommerce
                  })
                });
                
                if (response.ok) {
                  const result = await response.json();
                  syncNotice = ` y se sincronizaron ${result.count} productos.`;
                } else {
                  const errJson = await response.json();
                  throw new Error(errJson.error || 'Error en sincronización inicial');
                }
              }
            } catch (syncErr) {
              console.warn('Advertencia en la sincronización inicial:', syncErr);
              syncNotice = ` (advertencia: la sincronización inicial falló por '${syncErr.message}', pero las credenciales se guardaron. El script de segundo plano intentará de nuevo)`;
            }

            loadingOverlay.remove();
            alert(`Integración con MercadoLibre guardada con éxito${syncNotice}`);
            renderIntegrations(); // Recargar vista
          } catch(err) {
            loadingOverlay.remove();
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

      const btnSyncMeli = document.getElementById('btn-sync-meli');
      if (btnSyncMeli) {
        btnSyncMeli.addEventListener('click', async () => {
          if (userRole === 'observer') {
            alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
            return;
          }
          
          btnSyncMeli.disabled = true;
          btnSyncMeli.textContent = 'Sincronizando...';

          // Mostrar overlay de carga premium
          const loadingOverlay = document.createElement('div');
          loadingOverlay.id = 'meli-loading-overlay';
          loadingOverlay.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(4px);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            color: white;
            font-family: inherit;
            transition: all 0.3s ease;
          `;
          loadingOverlay.innerHTML = `
            <div style="background: var(--color-surface, #1e293b); padding: 2.5rem; border-radius: var(--radius-lg, 12px); border: 1px solid var(--color-border, #334155); box-shadow: var(--shadow-2xl); text-align: center; max-width: 400px; width: 90%;">
              <i class="ri-loader-4-line ri-spin" style="font-size: 3rem; color: #f59e0b; display: inline-block; margin-bottom: 1.5rem;"></i>
              <h3 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text-main, #f8fafc);">Sincronizando MercadoLibre</h3>
              <p style="margin: 0 0 1.5rem 0; font-size: 0.9rem; color: var(--color-text-muted, #94a3b8); line-height: 1.5;">
                Estamos actualizando el catálogo de productos y variaciones en tiempo real. Esto puede tomar unos segundos...
              </p>
              <div style="width: 100%; background: var(--color-bg, #0f172a); height: 6px; border-radius: 99px; overflow: hidden; position: relative;">
                <div style="position: absolute; height: 100%; background: #f59e0b; width: 30%; border-radius: 99px; animation: meliProgress 1.5s infinite ease-in-out;"></div>
              </div>
            </div>
            <style>
              @keyframes meliProgress {
                0% { left: -30%; }
                50% { width: 40%; }
                100% { left: 100%; }
              }
            </style>
          `;
          document.body.appendChild(loadingOverlay);

          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("No hay sesión activa");

            const response = await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/meli-sync', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
              },
              body: JSON.stringify({
                comercio: window.activeIntegrationCommerce
              })
            });

            const result = await response.json();
            
            if (!response.ok) {
              throw new Error(result.error || 'Error al sincronizar');
            }

            loadingOverlay.remove();
            alert(`¡Catálogo de MercadoLibre sincronizado exitosamente! Se importaron/actualizaron ${result.count} variantes de productos.`);
            if (typeof renderInventory === 'function') {
              renderInventory(); // Recargar inventario si corresponde
            }
          } catch (err) {
            loadingOverlay.remove();
            console.error(err);
            alert('Error en la sincronización: ' + err.message);
          } finally {
            btnSyncMeli.disabled = false;
            btnSyncMeli.textContent = 'Sincronizar Productos';
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

    // Jumpseller Submit Listener
    if(!hasJumpseller) {
      const formJumpseller = document.getElementById('form-jumpseller-integration');
      if (formJumpseller) {
        formJumpseller.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (userRole === 'observer') {
            alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
            return;
          }
          const btn = document.getElementById('btn-save-jumpseller');
          btn.disabled = true;
          btn.textContent = 'Conectando...';

          const shop_url = document.getElementById('jumpseller-url').value.trim();
          const login_key = document.getElementById('jumpseller-login-key').value.trim();
          const auth_token = document.getElementById('jumpseller-auth-token').value.trim();
          const webhook_secret = document.getElementById('jumpseller-webhook-secret').value.trim();

          const tokenJson = JSON.stringify({
            login_key: login_key,
            auth_token: auth_token
          });

          try {
            const { error: insErr } = await supabase.from('merchant_integrations').insert([{
              merchant_id: merchantId,
              platform: 'Jumpseller',
              shop_url: shop_url,
              access_token: tokenJson,
              webhook_secret: webhook_secret,
              is_active: true,
              comercio: window.activeIntegrationCommerce
            }]);
            if(insErr) throw insErr;
            
            alert('Integración con Jumpseller guardada correctamente.');
            renderIntegrations(); // Recargar vista
          } catch(err) {
            console.error(err);
            alert('Error al guardar la integración: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Conectar Tienda Jumpseller';
          }
        });
      }
    } else {
      const btnDisconnectJumpseller = document.getElementById('btn-disconnect-jumpseller');
      if (btnDisconnectJumpseller) {
        btnDisconnectJumpseller.addEventListener('click', async () => {
          if (userRole === 'observer') {
            alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
            return;
          }
          if(confirm('¿Estás seguro que deseas desconectar tu tienda Jumpseller?')) {
            try {
              const { error: delErr } = await supabase.from('merchant_integrations')
                .delete()
                .eq('comercio', window.activeIntegrationCommerce)
                .eq('platform', 'Jumpseller');
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

  // Guardar Cambios Editar Producto
  document.getElementById('form-edit-product').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (userRole === 'observer') {
      alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
      return;
    }
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';

    const prodId = document.getElementById('edit-prod-id').value;
    const barcode = document.getElementById('edit-prod-barcode').value || null;
    const length = document.getElementById('edit-prod-length').value ? parseFloat(document.getElementById('edit-prod-length').value) : null;
    const width = document.getElementById('edit-prod-width').value ? parseFloat(document.getElementById('edit-prod-width').value) : null;
    const height = document.getElementById('edit-prod-height').value ? parseFloat(document.getElementById('edit-prod-height').value) : null;
    const weight = document.getElementById('edit-prod-weight').value ? parseFloat(document.getElementById('edit-prod-weight').value) : null;
    const expiration = document.getElementById('edit-prod-expiration').value || null;
    const lot = document.getElementById('edit-prod-lot').value || null;

    try {
      const { error } = await supabase
        .from('products')
        .update({
          barcode,
          length,
          width,
          height,
          weight,
          expiration_date: expiration,
          lot_number: lot
        })
        .eq('id', prodId);

      if (error) throw error;

      alert('Parámetros del producto actualizados exitosamente!');
      document.getElementById('modal-edit-product').classList.remove('active');
      e.target.reset();
      
      // Recargar catálogo si es la vista activa
      const activeNav = document.querySelector('.sidebar-nav .nav-item.active');
      if (activeNav && activeNav.getAttribute('data-view') === 'catalog') {
        renderCatalog();
      }
    } catch (error) {
      console.error(error);
      alert('Error al guardar cambios: ' + error.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Guardar Cambios';
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

    window.shipActiveTab = window.shipActiveTab || 'Todos';

    const tabMappings = {
      'Todos': null,
      'Creado': ['Creado', 'REVIEWING'],
      'Listo para despacho': ['Listo para despacho', 'Listo para despacho - Impreso'],
      'Entregado': ['Entregado', 'DELIVERED', 'Entregado con exito'],
      'No retirado': ['No Retirado', 'SKIPPED'],
      'Devolución': ['Devolucion entregada']
    };

    let allData = [];
    let filters = {
      search: '',
      statuses: tabMappings[window.shipActiveTab] ? [...tabMappings[window.shipActiveTab]] : [], // Initialize based on active tab
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

      <!-- Tabs Container -->
      <div id="shipments-tabs-container" style="margin-bottom: 1.25rem;"></div>

      <!-- Table Card -->
      <div class="card" style="border: none; box-shadow: var(--shadow-md);">
        <div class="card-body table-responsive" style="padding: 0;">
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

        // 1. Query para obtener los estados de todos los despachos bajo los filtros actuales (para los contadores de las pestañas)
        let countQuery = supabase
          .from('envios_unificados')
          .select('status')
          .eq('visible_to_client', true);

        countQuery = applyVisibilityRulesToQuery(countQuery, rules);

        if (companyList.length > 0) {
          countQuery = countQuery.in('empresa_comercio_proveedor', companyList);
        }
        if (filters.courier) {
          countQuery = countQuery.eq('courier', filters.courier);
        }
        if (filters.dateFrom) {
          countQuery = countQuery.gte('created_at', filters.dateFrom + 'T00:00:00Z');
        }
        if (filters.dateTo) {
          countQuery = countQuery.lte('created_at', filters.dateTo + 'T23:59:59Z');
        }
        if (filters.search) {
          const term = `%${filters.search}%`;
          countQuery = countQuery.or(`pedido_referencia.ilike.${term},nombre_destinatario.ilike.${term},tracking.ilike.${term},courier.ilike.${term},comuna_destino.ilike.${term},direccion_destino.ilike.${term}`);
        }

        // 2. Query paginada y filtrada para la tabla
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

        const [dataRes, countRes] = await Promise.all([query, countQuery]);
        if (dataRes.error) throw dataRes.error;

        allData = dataRes.data || [];
        totalFilteredRows = dataRes.count || 0;

        // Calcular contadores dinámicos para las pestañas
        let todosCount = 0;
        let creadoCount = 0;
        let listoCount = 0;
        let entregadoCount = 0;
        let noRetiradoCount = 0;
        let devolucionCount = 0;

        const countData = countRes.data || [];
        countData.forEach(item => {
          todosCount++;
          const statusLower = item.status ? item.status.trim().toLowerCase() : '';
          if (statusLower === 'creado' || statusLower === 'reviewing') {
            creadoCount++;
          } else if (statusLower === 'listo para despacho' || statusLower === 'listo para despacho - impreso') {
            listoCount++;
          } else if (statusLower === 'entregado' || statusLower === 'delivered' || statusLower === 'entregado con exito') {
            entregadoCount++;
          } else if (statusLower === 'no retirado' || statusLower === 'skipped') {
            noRetiradoCount++;
          } else if (statusLower === 'devolucion entregada') {
            devolucionCount++;
          }
        });

        const tabCounts = {
          'Todos': todosCount,
          'Creado': creadoCount,
          'Listo para despacho': listoCount,
          'Entregado': entregadoCount,
          'No retirado': noRetiradoCount,
          'Devolución': devolucionCount
        };

        const tabColors = {
          'Todos': { bg: 'var(--color-bg)', text: 'var(--color-text-muted)' },
          'Creado': { bg: '#e0f2fe', text: '#0284c7' },
          'Listo para despacho': { bg: '#fef3c7', text: '#d97706' },
          'Entregado': { bg: '#dcfce7', text: '#22c55e' },
          'No retirado': { bg: '#fee2e2', text: '#ef4444' },
          'Devolución': { bg: '#f3e8ff', text: '#a855f7' }
        };

        const tabsList = ['Todos', 'Creado', 'Listo para despacho', 'Entregado', 'No retirado', 'Devolución'];
        const activeTabCur = window.shipActiveTab || 'Todos';

        const tabsHtml = tabsList.map(tab => {
          const isActive = activeTabCur === tab;
          const count = tabCounts[tab] || 0;
          const colors = tabColors[tab];
          const badgeBg = isActive ? 'rgba(255,255,255,0.2)' : colors.bg;
          const badgeColor = isActive ? '#ffffff' : colors.text;

          return `
            <button onclick="window.setShipTab('${tab}')" style="background: ${isActive ? 'var(--color-primary)' : 'transparent'}; color: ${isActive ? '#ffffff' : 'var(--color-text-main)'}; border: ${isActive ? 'none' : '1px solid var(--color-border)'}; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.825rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; transition: all 0.2s;">
              ${tab}
              <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 0.15rem 0.45rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">${count}</span>
            </button>
          `;
        }).join('');

        const tabsContainer = document.getElementById('shipments-tabs-container');
        if (tabsContainer) {
          tabsContainer.innerHTML = `
            <div style="display: flex; gap: 0.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem; flex-wrap: wrap;">
              ${tabsHtml}
            </div>
          `;
        }

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

    const syncActiveTabFromDropdown = () => {
      let matchedTab = 'Todos';
      if (filters.statuses.length > 0) {
        for (const [tabName, statuses] of Object.entries(tabMappings)) {
          if (!statuses) continue;
          if (filters.statuses.length === statuses.length && 
              filters.statuses.every(s => statuses.includes(s))) {
            matchedTab = tabName;
            break;
          }
        }
      }
      window.shipActiveTab = matchedTab;
    };

    window.setShipTab = async (tab) => {
      window.shipActiveTab = tab;
      currentPage = 1;
      
      const tabStatuses = tabMappings[tab];
      if (tabStatuses) {
        filters.statuses = [...tabStatuses];
      } else {
        filters.statuses = [];
      }
      
      // Update checkboxes checked states
      const checkboxes = statusOptionsList.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(chk => {
        chk.checked = filters.statuses.includes(chk.value);
      });
      
      updateStatusTriggerText();
      await fetchAndRenderTable();
    };

    originalStatuses.forEach(st => {
      const optDiv = document.createElement('div');
      optDiv.className = 'multiselect-option';
      
      const displayLabel = getDisplayStatusName(st);
      const isChecked = filters.statuses.includes(st);

      optDiv.innerHTML = `
        <input type="checkbox" id="chk-status-${st}" value="${st}" ${isChecked ? 'checked' : ''}>
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
        syncActiveTabFromDropdown();
        updateStatusTriggerText();
        currentPage = 1;
        await fetchAndRenderTable();
      });

      statusOptionsList.appendChild(optDiv);
    });

    updateStatusTriggerText();

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
      syncActiveTabFromDropdown();
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
      syncActiveTabFromDropdown();
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
      <div class="card-body table-responsive">
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
      <div class="card-body table-responsive">
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
      <div class="card-body table-responsive">
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
      <div class="slide-over-overlay" id="dec-slide-over-overlay" onclick="if(event.target === this) closeNewDeclarationSlideOver()">
        <div class="slide-over-panel" id="dec-slide-over-panel">
          <div class="slide-over-header">
            <div>
              <h3 style="margin: 0; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;" id="dec-slide-over-title">Declarar Nuevo Ingreso</h3>
              <p style="margin: 0; margin-top: 0.25rem; font-size: 0.8rem; color: var(--color-text-muted);">Completa la información logística</p>
            </div>
            <button class="btn btn-outline" style="border: none; background: transparent; padding: 0.5rem;" onclick="closeNewDeclarationSlideOver()">
              <i class="ri-close-line" style="font-size: 1.25rem;"></i>
            </button>
          </div>
          <div class="slide-over-body" style="padding: 1.5rem; overflow-y: auto; flex: 1;">
            <div style="display: flex; justify-content: flex-end; margin-bottom: 1rem;">
              <button type="button" id="btn-info-declarations" style="background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.35); padding: 0.3rem 0.7rem; color: var(--color-primary); cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 99px; font-size: 0.78rem; font-weight: 600; transition: all 0.2s;" title="Recomendaciones y Condiciones">
                <i class="ri-information-line" style="font-size: 1rem;"></i> Recomendaciones
              </button>
            </div>

          <form id="form-new-declaration">
            <div id="dec-general-error-container" class="alert alert-error" style="display: none; padding: 0.75rem 1rem; font-size: 0.85rem; background: var(--badge-danger-bg); color: var(--badge-danger-text); border: 1px solid var(--color-danger); margin-bottom: 1.25rem; border-radius: 8px; line-height: 1.5; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.1);">
              <strong style="display: block; margin-bottom: 0.25rem;"><i class="ri-error-warning-line" style="vertical-align: text-bottom; margin-right: 3px;"></i> Errores de Validación:</strong>
              <div id="dec-general-error-list" style="margin-left: 1rem;"></div>
            </div>
            ${commerceSelectHtml}
            <div class="form-group">
              <label class="form-label">Título / Descripción del Ingreso *</label>
              <input type="text" id="dec-title" class="form-input" placeholder="Ej. Embarque de zapatos de niño N°3" required>
            </div>

            <div class="form-group">
              <label class="form-label">Cantidad Total Unidades *</label>
              <input type="number" id="dec-qty-declared" class="form-input" min="1" placeholder="Ej. 350" required>
            </div>

            <div class="form-group">
              <label class="form-label">Volumen Estimado (m³) *</label>
              <input type="number" id="dec-volume-declared" class="form-input" min="0.01" step="0.01" placeholder="Ej. 1.5" required>
              <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.35rem; line-height: 1.4;">
                <i class="ri-information-line" style="color: var(--color-primary); vertical-align: middle; margin-right: 2px;"></i>
                El volumen puede ser un valor estimado. Puedes multiplicar largo (m) × ancho (m) × alto (m) para obtenerlo. Se usará para indicar la bodega con capacidad suficiente y será confirmado en terreno.
              </p>
            </div>

            <!-- Desglose de Bultos -->
            <div class="form-group" style="background: var(--color-surface); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--color-border); margin-bottom: 1.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
              <label class="form-label" style="font-weight: 600; margin-bottom: 0.5rem; display: block; font-size: 0.95rem;">Detalle de Bultos a Enviar *</label>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 1rem; line-height: 1.4;">
                Es obligatorio indicar al menos 1 bulto total. Indique las cantidades que enviará o marque "No enviaré".
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
              <label class="form-label" style="font-weight: 600; display: flex; flex-direction: column; gap: 0.25rem;">
                <span>Planilla Detallada de Ingreso *</span>
                <button type="button" class="btn" style="background: none; border: none; padding: 0; color: var(--color-primary); font-size: 0.85rem; cursor: pointer; text-decoration: underline; font-weight: 600; font-family: var(--font-family); align-self: flex-start;" onclick="downloadDeclarationsTemplate()">
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

            <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
              <button type="submit" id="btn-submit-declaration" class="btn btn-primary" style="flex: 1; border-radius: var(--radius-md); padding: 0.75rem;">Crear Declaración de Ingreso</button>
            </div>
          </form>
          </div>
        </div>
      </div>
    `;

    appContent.innerHTML = getObserverBanner() + `
      <div id="dec-view-container">
        <!-- Render Slide Over Panel -->
        ${formHtml}
        
        <!-- Tabla Resumen Full Width -->
        <div id="dec-table-col" class="card" style="width: 100%;">
          <div class="card-header" style="border-bottom: 1px solid var(--color-border); padding-bottom: 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h3>Mis Declaraciones de Ingreso</h3>
              <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">Historial y estado de tus ingresos declarados.</p>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              <button class="btn btn-outline" style="padding: 0.4rem 0.75rem; font-size: 0.85rem; border-color: var(--color-border);" id="btn-refresh-declarations">
                <i class="ri-refresh-line"></i> Actualizar
              </button>
              ${!isObserver ? `
                <button class="btn btn-primary" style="padding: 0.4rem 0.85rem; font-size: 0.85rem;" onclick="openNewDeclarationSlideOver()">
                  <i class="ri-add-line"></i> Hacer un ingreso
                </button>
              ` : ''}
            </div>
          </div>
          <div class="card-body table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Título / Descripción</th>
                  <th>Llegada Estimada</th>
                  <th>Cant. Uds</th>
                  <th>Bultos</th>
                  <th>Volumen (m³)</th>
                  <th>Método Envío</th>
                  <th>Estado</th>
                  <th>Recibido / Incidencias</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="declarations-table-body">
                <tr><td colspan="9" class="text-center" style="padding: 1.5rem; color: var(--color-text-muted);">Cargando declaraciones...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

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

        // Limpiar errores previos
        const generalErrorContainer = document.getElementById('dec-general-error-container');
        const generalErrorList = document.getElementById('dec-general-error-list');
        if (generalErrorContainer) generalErrorContainer.style.display = 'none';

        const formErrors = [];
        const title = document.getElementById('dec-title').value.trim();
        const qtyDeclared = parseInt(document.getElementById('dec-qty-declared').value);
        const volumeDeclared = parseFloat(document.getElementById('dec-volume-declared').value);

        if (!title) formErrors.push("El título del ingreso es obligatorio.");
        if (isNaN(qtyDeclared) || qtyDeclared <= 0) formErrors.push("La cantidad total de unidades debe ser mayor a 0.");
        if (isNaN(volumeDeclared) || volumeDeclared <= 0) formErrors.push("El volumen estimado debe ser un número válido mayor a 0.");

        const noContainer = document.getElementById('dec-no-container').checked;
        const noPallet = document.getElementById('dec-no-pallet').checked;
        const noBox = document.getElementById('dec-no-box').checked;

        const containerCount = noContainer ? 0 : (parseInt(document.getElementById('dec-container-count').value) || 0);
        const palletCount = noPallet ? 0 : (parseInt(document.getElementById('dec-pallet-count').value) || 0);
        const boxCount = noBox ? 0 : (parseInt(document.getElementById('dec-box-count').value) || 0);

        const totalPackages = containerCount + palletCount + boxCount;
        if (totalPackages < 1) {
          formErrors.push("Debe declarar al menos 1 bulto total (contenedores, pallets o cajas).");
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

        const fileInput = document.getElementById('dec-file-input');
        if (!editingDeclarationId && (!clientUploadedFileBase64 || !clientUploadedFileName)) {
          formErrors.push("Es obligatorio adjuntar la planilla detallada de ingreso.");
        }

        // ETA checks
        let estimatedArrivalDate = null;
        let estimatedArrivalPeriod = null;

        if (dateMode === 'exact') {
          if (!clientSelectedDateStr) {
            formErrors.push("Debes seleccionar una fecha exacta de llegada en el calendario.");
          } else {
            estimatedArrivalDate = clientSelectedDateStr;
            const selectedDate = new Date(clientSelectedDateStr + 'T00:00:00');
            const isSunday = selectedDate.getDay() === 0;
            const isSaturday = selectedDate.getDay() === 6;
            const now = new Date();
            const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            if (selectedDate < todayMidnight) {
              formErrors.push("No puedes declarar un ingreso en fechas pasadas.");
            }
            if (isSunday) {
              formErrors.push("No se permiten ingresos los días domingo.");
            }
            if (isSaturday) {
              const diffTime = selectedDate.getTime() - now.getTime();
              const diffHours = diffTime / (60 * 60 * 1000);
              if (diffHours < 48) {
                formErrors.push("Los ingresos en día sábado requieren al menos 48 horas de aviso anticipado.");
              }
            }
          }
        } else {
          const pQty = document.getElementById('dec-period-qty').value;
          const pUnit = document.getElementById('dec-period-unit').value;
          estimatedArrivalPeriod = `${pQty} ${pUnit}`;
        }

        if (formErrors.length > 0) {
          if (generalErrorContainer && generalErrorList) {
            generalErrorList.innerHTML = `<ul style="margin: 0; padding-left: 0.5rem; text-align: left;">${formErrors.map(e => `<li style="margin-bottom: 2px;">${e}</li>`).join('')}</ul>`;
            generalErrorContainer.style.display = 'block';
            document.querySelector('.slideover-body').scrollTop = 0;
          } else {
            alert(formErrors.join('\n'));
          }
          return;
        }

        const submitBtn = document.getElementById('btn-submit-declaration');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Analizando planilla...';

        let fileBase64 = clientUploadedFileBase64;
        let fileName = clientUploadedFileName;
        let excelRows = null;

        if (editingDeclarationId && (!fileInput || !fileInput.files[0])) {
          try {
            const { data: decData, error: decErr } = await supabase
              .from('stock_declarations')
              .select('file_name, file_base64')
              .eq('id', editingDeclarationId)
              .single();

            if (decErr) throw decErr;
            if (decData) {
              fileBase64 = decData.file_base64;
              fileName = decData.file_name;
            }
          } catch (err) {
            console.error('Error fetching existing file:', err);
            alert('No se pudo recuperar la planilla previa de la base de datos.');
            submitBtn.disabled = false;
            submitBtn.textContent = editingDeclarationId ? 'Guardar Cambios' : 'Crear Declaración de Ingreso';
            return;
          }
        }

        try {
          if (fileInput && fileInput.files[0]) {
            excelRows = await parseExcelData(fileInput.files[0], false);
          } else if (fileBase64) {
            excelRows = await parseExcelData(fileBase64, true);
          }
        } catch (err) {
          console.error('Error parsing Excel:', err);
          submitBtn.disabled = false;
          submitBtn.textContent = editingDeclarationId ? 'Guardar Cambios' : 'Crear Declaración de Ingreso';
          if (generalErrorContainer && generalErrorList) {
            generalErrorList.innerHTML = `No se pudo interpretar el archivo Excel: ${err.message}`;
            generalErrorContainer.style.display = 'block';
            document.querySelector('.slideover-body').scrollTop = 0;
          } else {
            alert('Error al leer la planilla Excel: ' + err.message);
          }
          return;
        }

        // Validar Excel
        const validationResult = validateExcelData(
          excelRows, 
          qtyDeclared, 
          volumeDeclared, 
          requiresUnloading, 
          dateMode, 
          estimatedArrivalDate
        );
        const { errors, warnings, parsedProducts, totalQtyFromExcel } = validationResult;

        if (errors.length > 0) {
          submitBtn.disabled = false;
          submitBtn.textContent = editingDeclarationId ? 'Guardar Cambios' : 'Crear Declaración de Ingreso';
          if (generalErrorContainer && generalErrorList) {
            generalErrorList.innerHTML = `<ul style="margin: 0; padding-left: 0.5rem; text-align: left;">${errors.map(e => `<li style="margin-bottom: 2px;">${e}</li>`).join('')}</ul>`;
            generalErrorContainer.style.display = 'block';
            document.querySelector('.slideover-body').scrollTop = 0;
          } else {
            alert("Errores críticos en la planilla Excel:\n" + errors.join('\n'));
          }
          return;
        }

        // Calcular costos
        const cost = calculateEntryCost(volumeDeclared, requiresUnloading, dateMode, estimatedArrivalDate);

        submitBtn.disabled = false;
        submitBtn.textContent = editingDeclarationId ? 'Guardar Cambios' : 'Crear Declaración de Ingreso';

        const selectedCommerce = document.getElementById('dec-comercio')
          ? document.getElementById('dec-comercio').value
          : (currentCompany ? currentCompany.split(',')[0].trim() : 'STOCKA');

        // Mostrar Vista Previa
        showDeclarationPreviewModal({
          title,
          commerce: selectedCommerce,
          dateText: dateMode === 'exact' ? `${estimatedArrivalDate.split('-')[2]}/${estimatedArrivalDate.split('-')[1]}/${estimatedArrivalDate.split('-')[0]}` : estimatedArrivalPeriod,
          deliveryMethod,
          volumeDeclared,
          containerCount,
          palletCount,
          boxCount,
          packageType,
          contactInfo,
          carrierInfo,
          notes,
          requiresUnloading
        }, parsedProducts, warnings, cost, !!editingDeclarationId, async () => {
          // Callback de Confirmación del usuario en la modal de vista previa
          if (editingDeclarationId) {
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
              volume_declared: volumeDeclared,
              estimated_cost: cost.totalCost,
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
              volume_declared: volumeDeclared,
              volume_confirmed: 0,
              estimated_cost: cost.totalCost,
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
            
            // Re-establecer inputs
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
            
            closeNewDeclarationSlideOver();
          }

          // Redibujar calendario
          drawMiniCalendar(miniCalWrapper, clientCalendarCurrentDate.getFullYear(), clientCalendarCurrentDate.getMonth());

          // Recargar tabla
          fetchAndRenderClientDeclarations();
        });
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
      listTableBody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">No tienes declaraciones creadas.</td></tr>`;
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
        <button class="table-action-menu-item" onclick="editDeclaration('${dec.id}')">
          <i class="ri-edit-line" style="color: var(--color-primary);"></i> Editar
        </button>
      ` : '';

      const canDelete = ['Recibido Conforme', 'Recibido con Incidencias'].indexOf(dec.status) === -1;
      const deleteButtonHtml = canDelete ? `
        <button class="table-action-menu-item danger" onclick="deleteDeclaration('${dec.id}')">
          <i class="ri-delete-bin-line"></i> Eliminar
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
                ${editButtonHtml}
                <button class="table-action-menu-item" onclick="viewDeclarationDetail('${dec.id}')">
                  <i class="ri-eye-line" style="color: var(--color-primary);"></i> Detalle
                </button>
                ${deleteButtonHtml}
              </div>
            </div>
          </td>
        </tr>
      `;
    });
    
    listTableBody.innerHTML = html;
  } catch (err) {
    console.error('Error fetching client declarations:', err);
    listTableBody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 1.5rem; color: var(--color-danger);">Error al cargar declaraciones: ${err.message}</td></tr>`;
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
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Uds. Declaradas</th>
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Uds. Recibidas</th>
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Volumen Decl.</th>
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Volumen Conf.</th>
                  <th style="padding: 0.75rem 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border);">Incidencias</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 1.25rem; font-size: 1.2rem; font-weight: 600; color: var(--color-text-main); border-right: 1px dashed var(--color-border);">${dec.quantity_declared}</td>
                  <td style="padding: 1.25rem; font-size: 1.2rem; font-weight: 700; color: var(--color-success); border-right: 1px dashed var(--color-border);">${dec.quantity_received}</td>
                  <td style="padding: 1.25rem; font-size: 1.2rem; font-weight: 600; color: var(--color-text-main); border-right: 1px dashed var(--color-border);">${dec.volume_declared || 0} m³</td>
                  <td style="padding: 1.25rem; font-size: 1.2rem; font-weight: 700; color: var(--color-success); border-right: 1px dashed var(--color-border);">${dec.status !== 'Creada' && dec.status !== 'Bodega Asignada' ? (dec.volume_confirmed || 0) + ' m³' : '—'}</td>
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

          <!-- Costo Estimado del Ingreso Block -->
          <div style="margin-bottom: 1.5rem;">
            <div class="info-block" style="background: var(--color-surface); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--color-border); border-left: 4px solid var(--color-success); display: flex; align-items: flex-start; gap: 1rem;">
              <div style="background: rgba(16, 185, 129, 0.1); padding: 0.6rem; border-radius: 50%; color: var(--color-success);"><i class="ri-money-dollar-circle-line" style="font-size: 1.2rem;"></i></div>
              <div style="flex: 1; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong style="display: block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin-bottom: 0.15rem;">Costo Estimado del Ingreso</strong>
                  <span style="font-size: 0.75rem; color: var(--color-text-muted);">Calculado al registrar la declaración logística.</span>
                </div>
                <div style="font-size: 1.2rem; font-weight: 700; color: var(--color-success);">${(dec.estimated_cost || 0).toFixed(2)} UF</div>
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

// Excel Parser Helper using SheetJS
window.parseExcelData = function(fileOrBase64, isBase64 = false) {
  return new Promise((resolve, reject) => {
    try {
      let bytes;
      if (isBase64) {
        const binaryString = window.atob(fileOrBase64);
        const len = binaryString.length;
        bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
      }
      
      const readData = (data) => {
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        return XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      };

      if (isBase64) {
        resolve(readData(bytes));
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target.result);
            resolve(readData(data));
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(fileOrBase64);
      }
    } catch (err) {
      reject(err);
    }
  });
};

// Excel Data Validator
window.validateExcelData = function(rows, formQty, volumeDeclared, requiresUnloading, dateMode, estimatedArrivalDateStr) {
  const errors = [];
  const warnings = [];
  const parsedProducts = [];

  if (!rows || rows.length <= 1) {
    errors.push("La planilla no contiene filas de datos (solo cabeceras o vacía).");
    return { errors, warnings, parsedProducts };
  }

  const headerRow = rows[0];
  const skuIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'sku');
  const nameIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'nombre producto');
  const qtyIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'cantidad declarada');
  const priceIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'valor');
  const barcodeIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'código de barra');
  const expiryIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'fecha de vencimiento');

  if (skuIdx === -1) errors.push("No se encontró la columna requerida 'SKU' en la primera fila.");
  if (nameIdx === -1) errors.push("No se encontró la columna requerida 'Nombre Producto' en la primera fila.");
  if (qtyIdx === -1) errors.push("No se encontró la columna requerida 'Cantidad declarada' en la primera fila.");

  if (errors.length > 0) {
    return { errors, warnings, parsedProducts };
  }

  let totalQtyFromExcel = 0;
  const skuSet = new Set();
  const duplicateSkus = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    // Ignorar filas vacías
    const isEmptyRow = row.every(val => val === null || val === undefined || val.toString().trim() === '');
    if (isEmptyRow) continue;

    const sku = row[skuIdx] ? row[skuIdx].toString().trim() : '';
    const name = row[nameIdx] ? row[nameIdx].toString().trim() : '';
    const qtyVal = row[qtyIdx];
    const barcode = barcodeIdx !== -1 && row[barcodeIdx] ? row[barcodeIdx].toString().trim() : '';
    const priceVal = priceIdx !== -1 ? row[priceIdx] : '';
    const expiryVal = expiryIdx !== -1 && row[expiryIdx] ? row[expiryIdx].toString().trim() : '';

    const rowNum = i + 1; // Fila de la planilla para avisar

    if (!sku) {
      errors.push(`Fila ${rowNum}: El SKU es obligatorio.`);
    } else {
      if (skuSet.has(sku)) {
        if (!duplicateSkus.includes(sku)) duplicateSkus.push(sku);
      } else {
        skuSet.add(sku);
      }
    }

    if (!name) {
      errors.push(`Fila ${rowNum}: El Nombre Producto es obligatorio.`);
    }

    const qty = parseInt(qtyVal);
    if (isNaN(qtyVal) || isNaN(qty) || qty <= 0 || qty !== parseFloat(qtyVal)) {
      errors.push(`Fila ${rowNum} (${sku || 'S/SKU'}): La Cantidad declarada debe ser un número entero mayor a 0 (recibido: "${qtyVal || ''}").`);
    } else {
      totalQtyFromExcel += qty;
    }

    let price = 0;
    if (priceVal !== '' && priceVal !== null && priceVal !== undefined) {
      price = parseFloat(priceVal);
      if (isNaN(price) || price < 0) {
        warnings.push(`Fila ${rowNum} (${sku || 'S/SKU'}): El Valor "${priceVal}" no es un número válido. Se asumirá 0.`);
        price = 0;
      }
    }

    parsedProducts.push({
      rowNum,
      sku,
      name,
      barcode,
      qty,
      price,
      expiry: expiryVal,
      subtotal: qty * price
    });
  }

  if (duplicateSkus.length > 0) {
    warnings.push(`Se detectaron SKUs duplicados en la planilla: ${duplicateSkus.join(', ')}. Esto agrupará el stock al ingresar.`);
  }

  if (totalQtyFromExcel !== formQty) {
    warnings.push(`La suma de unidades de la planilla (${totalQtyFromExcel} uds) no coincide con la Cantidad Total Unidades declarada en el formulario (${formQty} uds).`);
  }

  return { errors, warnings, parsedProducts, totalQtyFromExcel };
};

// Cost Calculator for Stock Entry
window.calculateEntryCost = function(volume, requiresUnloading, arrivalType, arrivalDateStr) {
  let standardCost = 0;
  let unloadingCost = 0;
  let surchargeCost = 0;

  // 1. Costo de Descarga: 0.1 UF por m3 si requiere descarga
  if (requiresUnloading) {
    unloadingCost = 0.1 * volume;
  }

  // 2. Recargo por aviso tardío (< 24h)
  if (arrivalType === 'exact' && arrivalDateStr) {
    const selectedDate = new Date(arrivalDateStr + 'T00:00:00');
    const now = new Date();
    const diffTime = selectedDate.getTime() - now.getTime();
    if (diffTime < 24 * 60 * 60 * 1000) {
      surchargeCost = 0.75 * volume;
    }
  }

  const totalCost = unloadingCost + surchargeCost;

  return {
    standardCost,
    unloadingCost,
    surchargeCost,
    totalCost
  };
};

// Render Preview Modal
window.showDeclarationPreviewModal = function(formData, parsedProducts, warnings, cost, isEditMode, onConfirm) {
  const modalId = 'modal-client-dec-preview';
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal-overlay active';

  let warningsHtml = '';
  if (warnings && warnings.length > 0) {
    warningsHtml = `
      <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.85rem; color: var(--color-text-main); line-height: 1.4; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.05);">
        <strong style="color: #d97706; display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.25rem;">
          <i class="ri-error-warning-line" style="font-size: 1.1rem;"></i> Advertencias de Validación:
        </strong>
        <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.8rem; color: var(--color-text-main);">
          ${warnings.map(w => `<li style="margin-bottom: 2px;">${w}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  const skuSet = new Set(parsedProducts.map(p => p.sku));
  const totalValue = parsedProducts.reduce((acc, p) => acc + (p.subtotal || 0), 0);
  const totalQty = parsedProducts.reduce((acc, p) => acc + (p.qty || 0), 0);

  let rowsHtml = '';
  if (parsedProducts.length === 0) {
    rowsHtml = `<tr><td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--color-text-muted);">Sin productos en la planilla o planilla ya cargada anteriormente</td></tr>`;
  } else {
    parsedProducts.forEach(p => {
      rowsHtml += `
        <tr style="border-bottom: 1px solid var(--color-border); font-size: 0.8rem;">
          <td style="padding: 0.6rem 0.75rem; text-align: left; font-family: monospace; font-size: 0.75rem; color: var(--color-primary); font-weight: 500;">${p.sku}</td>
          <td style="padding: 0.6rem 0.75rem; text-align: left; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.name}">${p.name}</td>
          <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 600; color: var(--color-text-main);">${p.qty}</td>
          <td style="padding: 0.6rem 0.75rem; text-align: right; color: var(--color-text-muted);">$ ${p.price.toLocaleString('es-CL')}</td>
          <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 600; color: var(--color-text-main);">$ ${p.subtotal.toLocaleString('es-CL')}</td>
        </tr>
      `;
    });
  }

  modal.innerHTML = `
    <div class="modal-content animate-fade-in" style="max-width: 950px; width: 95%; display: flex; flex-direction: column; max-height: 90vh; border-radius: 12px; border: 1px solid var(--color-border); background: var(--color-surface); box-shadow: 0 12px 36px rgba(0,0,0,0.3); font-family: var(--font-family);">
      <div class="modal-header" style="border-bottom: 1px solid var(--color-border); padding: 1.25rem 1.5rem; display: flex; justify-content: space-between; align-items: center; background: var(--color-surface-hover);">
        <div>
          <h3 style="margin: 0; font-size: 1.25rem; color: var(--color-text-main); font-weight: 700; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-eye-line" style="color: var(--color-primary);"></i> Vista Previa de la Declaración</h3>
          <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0.25rem 0 0 0;">Verifica los datos logísticos, costos asociados y productos de la planilla antes de confirmar.</p>
        </div>
        <button onclick="document.getElementById('${modalId}').remove()" style="background: none; border: none; font-size: 1.5rem; color: var(--color-text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s;"><i class="ri-close-line"></i></button>
      </div>
      
      <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
        ${warningsHtml}
        
        <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 1.5rem;">
          <!-- Col 1: Logistic Details -->
          <div style="background: var(--color-surface-hover); border: 1px solid var(--color-border); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; height: fit-content; box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
            <h4 style="margin: 0; font-size: 0.95rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem; font-weight: 600;">
              <i class="ri-truck-line" style="color: var(--color-primary); font-size: 1.1rem;"></i> Resumen Logístico
            </h4>
            
            <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.85rem; line-height: 1.45;">
              <div><strong style="color: var(--color-text-muted);">Título/Descripción:</strong><br><span style="color: var(--color-text-main); font-weight: 500;">${formData.title}</span></div>
              <div><strong style="color: var(--color-text-muted);">Comercio:</strong><br><span style="color: var(--color-text-main); font-weight: 500;">${formData.commerce}</span></div>
              <div><strong style="color: var(--color-text-muted);">Llegada Estimada:</strong><br><span style="color: var(--color-text-main); font-weight: 500;">${formData.dateText}</span></div>
              <div><strong style="color: var(--color-text-muted);">Método de Envío:</strong><br><span class="badge" style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main); font-size: 0.75rem; padding: 2px 6px; display: inline-block; margin-top: 2px; font-weight: 500;">${formData.deliveryMethod}</span></div>
              <div><strong style="color: var(--color-text-muted);">Volumen Declarado:</strong><br><span style="color: var(--color-text-main); font-weight: 600;">${formData.volumeDeclared} m³</span></div>
              <div><strong style="color: var(--color-text-muted);">Detalle de Bultos:</strong><br>
                <div style="margin-top: 4px; font-size: 0.8rem; color: var(--color-text-main); display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: var(--color-surface); padding: 8px; border-radius: 6px; border: 1px solid var(--color-border);">
                  <span>Contenedores: <strong>${formData.containerCount}</strong></span>
                  <span>Pallets: <strong>${formData.palletCount}</strong></span>
                  <span>Cajas: <strong>${formData.boxCount}</strong></span>
                  <span>Tipo: <strong>${formData.packageType}</strong></span>
                </div>
              </div>
              <div><strong style="color: var(--color-text-muted);">Contacto:</strong><br><span style="color: var(--color-text-main);">${formData.contactInfo || '—'}</span></div>
              <div><strong style="color: var(--color-text-muted);">Transportista:</strong><br><span style="color: var(--color-text-main);">${formData.carrierInfo || '—'}</span></div>
              <div><strong style="color: var(--color-text-muted);">Notas del Cliente:</strong><br><span style="font-style: italic; color: var(--color-text-main);">"${formData.notes || 'Sin comentarios'}"</span></div>
            </div>
            
            <!-- Cost Breakdown -->
            <div style="margin-top: 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
              <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.4rem; font-weight: 600;">
                <i class="ri-money-dollar-circle-line" style="color: var(--color-success); font-size: 1.1rem;"></i> Costo Estimado del Ingreso
              </h4>
              <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.8rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--color-text-muted);">Servicio de Descarga (0.1 UF x m³):</span>
                  <strong>${cost.unloadingCost.toFixed(2)} UF</strong>
                </div>
                <div style="display: flex; justify-content: space-between; color: ${cost.surchargeCost > 0 ? 'var(--color-danger)' : 'inherit'}; font-weight: ${cost.surchargeCost > 0 ? '600' : 'normal'};">
                  <span style="color: ${cost.surchargeCost > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)'}; font-size: 0.78rem;">Recargo Aviso Tardío (< 24h):</span>
                  <strong>${cost.surchargeCost.toFixed(2)} UF</strong>
                </div>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 0.95rem; font-weight: 700; color: var(--color-text-main);">
                <span>Costo Total Estimado:</span>
                <span style="color: var(--color-success); font-size: 1.1rem;">${cost.totalCost.toFixed(2)} UF</span>
              </div>
              <p style="font-size: 0.7rem; color: var(--color-text-muted); margin: 0.5rem 0 0 0; line-height: 1.3;">
                * Los montos se expresan en UF y se liquidarán con el volumen físico corroborado en bodega.
              </p>
            </div>
          </div>
          
          <!-- Col 2: Products parsed from Excel -->
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <h4 style="margin: 0; font-size: 0.95rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; color: var(--color-text-main); display: flex; justify-content: space-between; align-items: center; font-weight: 600;">
              <span style="display: flex; align-items: center; gap: 0.5rem;"><i class="ri-file-list-3-line" style="color: var(--color-primary); font-size: 1.1rem;"></i> Detalle de Planilla</span>
              <span style="font-size: 0.75rem; background: rgba(37, 99, 235, 0.1); color: var(--color-primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600;">
                ${parsedProducts.length} filas
              </span>
            </h4>
            
            <div style="max-height: 310px; border: 1px solid var(--color-border); border-radius: 8px; overflow-y: auto; background: var(--color-surface); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 0;">
                <thead>
                  <tr style="position: sticky; top: 0; background: var(--color-surface-hover); z-index: 10; border-bottom: 2px solid var(--color-border); font-size: 0.75rem;">
                    <th style="padding: 0.6rem 0.75rem; text-align: left; font-weight: 600;">SKU</th>
                    <th style="padding: 0.6rem 0.75rem; text-align: left; font-weight: 600;">Producto</th>
                    <th style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 600;">Cant</th>
                    <th style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 600;">Valor</th>
                    <th style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 600;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
            
            <!-- Totals box -->
            <div style="background: var(--color-surface-hover); border: 1px solid var(--color-border); border-radius: 8px; padding: 0.85rem; display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 8px; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
              <div>
                <div style="font-size: 0.7rem; color: var(--color-text-muted);">SKUs Únicos</div>
                <strong style="font-size: 1rem; color: var(--color-text-main);">${skuSet.size}</strong>
              </div>
              <div style="border-left: 1px solid var(--color-border); border-right: 1px solid var(--color-border);">
                <div style="font-size: 0.7rem; color: var(--color-text-muted);">Total Uds Planilla</div>
                <strong style="font-size: 1rem; color: var(--color-primary);">${totalQty}</strong>
              </div>
              <div>
                <div style="font-size: 0.7rem; color: var(--color-text-muted);">Valor Declarado</div>
                <strong style="font-size: 1rem; color: var(--color-success);">$ ${totalValue.toLocaleString('es-CL')}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="modal-footer" style="border-top: 1px solid var(--color-border); padding: 1.25rem 1.5rem; background: var(--color-surface-hover); display: flex; justify-content: space-between; gap: 1rem;">
        <button class="btn btn-outline" onclick="document.getElementById('${modalId}').remove()" style="padding: 0.6rem 1.25rem; font-size: 0.85rem; font-weight: 600; border-radius: 6px; transition: all 0.2s;">
          <i class="ri-arrow-left-line" style="vertical-align: middle; margin-right: 3px;"></i> Volver a Editar Formulario
        </button>
        
        <button class="btn btn-primary" id="btn-confirm-send-declaration" style="padding: 0.6rem 1.5rem; font-size: 0.85rem; font-weight: 600; border-radius: 6px; background: var(--color-success); border-color: var(--color-success); transition: all 0.2s; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);">
          <i class="ri-checkbox-circle-line" style="vertical-align: middle; margin-right: 3px;"></i> ${isEditMode ? 'Guardar Cambios' : 'Confirmar y Enviar Declaración'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('btn-confirm-send-declaration').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('btn-confirm-send-declaration');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="ri-loader-4-line animate-spin"></i> Guardando...';
    try {
      await onConfirm();
      modal.remove();
    } catch (err) {
      console.error(err);
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<i class="ri-checkbox-circle-line"></i> ${isEditMode ? 'Guardar Cambios' : 'Confirmar y Enviar Declaración'}`;
    }
  });
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
    document.getElementById('dec-volume-declared').value = dec.volume_declared || '';
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

    const formTitle = document.getElementById('dec-slide-over-title');
    if (formTitle) {
      formTitle.innerHTML = 'Editar Declaración de Ingreso';
    }
    const submitBtn = document.getElementById('btn-submit-declaration');
    if (submitBtn) {
      submitBtn.textContent = 'Guardar Cambios';
    }
    const cancelBtn = document.getElementById('btn-cancel-edit-declaration');
    if (cancelBtn) {
      cancelBtn.style.display = 'block';
    }

    openNewDeclarationSlideOver();


  } catch (err) {
    console.error('Error opening declaration for editing:', err);
    alert('Error al abrir la declaración para editar: ' + err.message);
  }
};

window.openNewDeclarationSlideOver = function() {
  const overlay = document.getElementById('dec-slide-over-overlay');
  if (overlay) overlay.classList.add('active');
};

window.closeNewDeclarationSlideOver = function() {
  const overlay = document.getElementById('dec-slide-over-overlay');
  if (overlay) overlay.classList.remove('active');
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

  const formTitle = document.getElementById('dec-slide-over-title');
  if (formTitle) {
    formTitle.innerHTML = 'Declarar Nuevo Ingreso';
  }
  const submitBtn = document.getElementById('btn-submit-declaration');
  if (submitBtn) {
    submitBtn.textContent = 'Crear Declaración de Ingreso';
  }
  const cancelBtn = document.getElementById('btn-cancel-edit-declaration');
  if (cancelBtn) {
    cancelBtn.style.display = 'none';
  }
  
  closeNewDeclarationSlideOver();
};

window.deleteDeclaration = async function(id) {
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

    alert('Ingreso de stock eliminado exitosamente.');
    renderDeclarations();
  } catch (err) {
    console.error('Error al eliminar ingreso de stock:', err);
    alert('Error al eliminar ingreso de stock: ' + err.message);
  }
};

// =========================================================================
// MÓDULO DE FACTURACIÓN Y COBRANZA - CLIENTE
// =========================================================================

window.renderBillingClient = async function() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  
  injectClientBillingStyles();
  
  // Ejecutar limpieza de comprobantes antiguos en segundo plano
  cleanOldReceiptsJS().catch(e => console.warn(e));
  Promise.resolve(supabase.rpc('check_overdue_payments')).catch(e => console.warn(e));
  
  appContent.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <div>
        <h3 style="margin: 0; font-size: 1.25rem; color: var(--color-text-main);">Mis Facturas</h3>
        <p style="margin: 0.25rem 0 0 0; font-size: 0.85rem; color: var(--color-text-muted);">Historial mensual y estado de facturación de tus comercios asociados</p>
      </div>
      <div>
        <!-- Selector de periodo -->
        <select id="client-period-select" class="form-input" style="padding: 0.5rem 1rem; min-width: 180px; margin: 0;" onchange="loadClientBillingData(this.value)">
          <option value="">Cargando periodos...</option>
        </select>
      </div>
    </div>
    
    <!-- Tarjetas de Resumen -->
    <div class="billing-summary-grid">
      <div class="billing-summary-card">
        <span class="billing-summary-label"><i class="ri-bill-line"></i> Total Facturado</span>
        <span class="billing-summary-value" id="summary-total-facturado">$0</span>
      </div>
      <div class="billing-summary-card">
        <span class="billing-summary-label" style="color: var(--color-success);"><i class="ri-checkbox-circle-line"></i> Total Pagado</span>
        <span class="billing-summary-value" id="summary-total-pagado" style="color: var(--color-success);">$0</span>
      </div>
      <div class="billing-summary-card">
        <span class="billing-summary-label" style="color: var(--color-warning);"><i class="ri-alert-line"></i> Saldo Pendiente</span>
        <span class="billing-summary-value" id="summary-saldo-pendiente" style="color: var(--color-warning);">$0</span>
      </div>
    </div>
    
    <!-- Tabla de Facturación -->
    <div class="card">
      <div class="card-header">
        <h3 id="client-table-header-title">Detalle de Cobros</h3>
      </div>
      <div class="card-body table-responsive" id="client-billing-table-body" style="padding: 0;">
        <div class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
          <i class="ri-loader-4-line spin" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
          Cargando datos...
        </div>
      </div>
    </div>

    <!-- Historial de Avisos de Pago -->
    <div class="card" style="margin-top: 1.5rem;">
      <div class="card-header">
        <h3>Historial de Avisos de Pago</h3>
      </div>
      <div class="card-body table-responsive" id="client-reports-table-body" style="padding: 0;">
        <div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
          Cargando avisos de pago...
        </div>
      </div>
    </div>
  `;
  
  await initClientPeriodSelect();
};

async function initClientPeriodSelect() {
  const select = document.getElementById('client-period-select');
  if (!select) return;
  
  try {
    const { data: periods, error } = await supabase
      .from('billing_periods')
      .select('*')
      .order('name', { ascending: false });
      
    if (error) throw error;
    
    if (!periods || periods.length === 0) {
      select.innerHTML = '<option value="">No hay periodos</option>';
      document.getElementById('client-billing-table-body').innerHTML = `
        <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
          No se registran periodos de facturación creados en el sistema.
        </div>
      `;
      document.getElementById('client-reports-table-body').innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
          No hay avisos de pago para mostrar.
        </div>
      `;
      return;
    }
    
    // Seleccionar automáticamente el primer periodo activo, de lo contrario el más reciente
    const activePeriod = periods.find(p => p.status === 'activo');
    const defaultPeriodId = activePeriod ? activePeriod.id : periods[0].id;
    
    select.innerHTML = periods.map(p => `<option value="${p.id}" ${p.id === defaultPeriodId ? 'selected' : ''}>${p.name}</option>`).join('');
    
    loadClientBillingData(defaultPeriodId);
  } catch (err) {
    console.error('Error initializing client period select:', err);
    select.innerHTML = '<option value="">Error al cargar</option>';
  }
}

window.loadClientBillingData = async function(periodId) {
  const tableContainer = document.getElementById('client-billing-table-body');
  const reportsContainer = document.getElementById('client-reports-table-body');
  if (!tableContainer || !periodId) return;
  
  tableContainer.innerHTML = `
    <div class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
      <i class="ri-loader-4-line spin" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
      Obteniendo registros...
    </div>
  `;
  
  try {
    const companyList = currentCompany ? currentCompany.split(',').map(c => c.trim()).filter(Boolean) : [];
    
    if (companyList.length === 0) {
      tableContainer.innerHTML = `
        <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
          <i class="ri-error-warning-line" style="font-size: 3rem; display: block; margin-bottom: 1rem; color: var(--color-warning);"></i>
          No tienes comercios asociados en tu perfil de usuario. Contacta a soporte.
        </div>
      `;
      if (reportsContainer) {
        reportsContainer.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
            Sin registros de comercios.
          </div>
        `;
      }
      return;
    }
    
    // 2. Obtener mapeos de facturación agrupados para resolver nombres
    let mappings = [];
    try {
      const { data: mappingsData } = await supabase
        .from('billing_mappings')
        .select('comercio_nombre, billing_name');
      if (mappingsData) mappings = mappingsData;
    } catch (err) {
      console.warn('Advertencia al cargar mappings en app.js:', err);
    }

    // Resolver nombres de facturación y filtrar duplicados usando un Set
    const uniqueBillingNames = new Set();
    companyList.forEach(c => {
      const matchedMapping = mappings.find(m => m.comercio_nombre.toLowerCase() === c.toLowerCase());
      const nameToUse = matchedMapping ? matchedMapping.billing_name : c;
      uniqueBillingNames.add(nameToUse);
    });
    
    const resolvedCompanyList = Array.from(uniqueBillingNames);

    // 3. Consultar registros de facturación de estos comercios para el periodo
    const { data: records, error } = await supabase
      .from('billing_records')
      .select('*')
      .eq('period_id', periodId)
      .in('comercio', resolvedCompanyList)
      .order('comercio', { ascending: true });
      
    if (error) throw error;
    
    if (!records || records.length === 0) {
      updateSummaryCards(0, 0, 0);
      tableContainer.innerHTML = `
        <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
          No se registran datos de facturación para tus comercios en este mes.
        </div>
      `;
      if (reportsContainer) {
        reportsContainer.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
            No hay avisos de pago para mostrar.
          </div>
        `;
      }
      return;
    }
    
    let totalFacturado = 0;
    let totalPagado = 0;
    let tableRowsFulf = '';
    let tableRowsEnv = '';
    
    records.forEach(r => {
      const recordTotal = (r.total_fulfillment || 0) + (r.enviame || 0);
      const recordPagado = (r.abono_fulfillment || 0) + (r.abono_enviame || 0);
      const pendingFulfillment = (r.total_fulfillment || 0) - (r.abono_fulfillment || 0);
      const pendingEnviame = (r.enviame || 0) - (r.abono_enviame || 0);
      const recordPending = recordTotal - recordPagado;
      
      totalFacturado += recordTotal;
      totalPagado += recordPagado;
      
      let actionBtn = '';
      if (recordPending > 0) {
        actionBtn = `
          <button class="action-btn-modern" onclick="abrirModalInformarPago('${periodId}', '${r.id}', '${r.comercio.replace(/'/g, "\\'")}', ${pendingFulfillment}, ${pendingEnviame})">
            <i class="ri-upload-cloud-2-line"></i> Informar Pago
          </button>
        `;
      } else {
        actionBtn = `
          <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 700; color: var(--color-success); font-size: 0.8rem; background: rgba(16, 185, 129, 0.1); padding: 0.35rem 0.75rem; border-radius: 50px;">
            <i class="ri-checkbox-circle-fill" style="font-size: 1rem;"></i> Pagado
          </span>
        `;
      }
      
      // Fila para tab Fulfillment
      tableRowsFulf += `
        <tr class="billing-record-row-fulf" data-pago-fulf="${r.pago_fulfillment || ''}" data-fact-fulf="${r.factura_fulfillment || ''}">
          <td style="font-weight: 600; color: var(--color-text-main); vertical-align: middle;">
            ${r.comercio}
          </td>
          <td style="vertical-align: middle;">
            <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: stretch; max-width: 220px;">
              ${r.fulfillment_link ? `
                <button class="btn btn-outline btn-sm btn-client-preview-doc btn-billing-link" data-name="Enlace Fulfillment - ${r.comercio}" data-url="${r.fulfillment_link}" style="padding: 0.35rem 0.5rem; font-size: 0.75rem; width: 100%; text-align: left; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; height: auto;">
                  <i class="ri-link" style="font-size: 0.9rem;"></i> Revisar registro de facturación
                </button>
              ` : ''}
              ${r.fulfillment_pdf_url ? `
                <button class="btn btn-outline btn-sm btn-client-preview-doc btn-billing-pdf" data-name="PDF Fulfillment - ${r.comercio}" data-url="${r.fulfillment_pdf_url}" style="padding: 0.35rem 0.5rem; font-size: 0.75rem; width: 100%; text-align: left; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; height: auto;">
                  <i class="ri-file-pdf-line" style="font-size: 0.9rem;"></i> Ver Desglose
                </button>
              ` : ''}
              ${(!r.fulfillment_link && !r.fulfillment_pdf_url) ? '<span style="color: var(--color-text-muted); font-size: 0.8rem;">-</span>' : ''}
            </div>
          </td>
          <td style="vertical-align: middle; color: var(--color-text-muted);">
            <div>${r.fecha_limite ? new Date(r.fecha_limite + 'T00:00:00').toLocaleDateString() : '-'}</div>
            ${window.getDeadlineBadgeHtml(r.fecha_limite, r.pago_fulfillment)}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            <span class="client-badge ${getClientStatusClass(r.desglose_fulfillment)}">${r.desglose_fulfillment || '-'}</span>
          </td>
          <td style="vertical-align: middle; text-align: right; font-weight: 500;">
            ${window.formatCLP(r.total_fulfillment)}
          </td>
          <td style="vertical-align: middle; text-align: right; color: var(--color-success); font-weight: 500;">
            ${window.formatCLP(r.abono_fulfillment)}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            <span class="client-badge ${getClientStatusClass(r.pago_fulfillment)}">${r.pago_fulfillment || '-'}</span>
            ${r.pago_fulfillment === 'Recibido' && r.fecha_pago_recibido_fulfillment ? `
              <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                Recibido: ${new Date(r.fecha_pago_recibido_fulfillment + 'T00:00:00').toLocaleDateString()}
              </div>
            ` : ''}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            <span class="client-badge ${getClientStatusClass(r.factura_fulfillment)}">${r.factura_fulfillment || '-'}</span>
          </td>
          <td style="vertical-align: middle; text-align: center; font-weight: 600; color: var(--color-text-main);">
            ${r.num_factura || '-'}
          </td>
          <td style="font-weight: 700; color: var(--color-text-main); vertical-align: middle; text-align: right;">
            ${window.formatCLP(recordTotal)}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            ${actionBtn}
          </td>
        </tr>
      `;

      // Fila para tab Envíame
      tableRowsEnv += `
        <tr class="billing-record-row-env" data-pago-env="${r.pago_enviame || ''}" data-fact-env="${r.factura_enviame || ''}">
          <td style="font-weight: 600; color: var(--color-text-main); vertical-align: middle;">
            ${r.comercio}
          </td>
          <td style="vertical-align: middle;">
            <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: stretch; max-width: 220px;">
              ${(r.enviame_pdfs && Array.isArray(r.enviame_pdfs) && r.enviame_pdfs.length > 0) ? r.enviame_pdfs.map((pdf, idx) => `
                <button class="btn btn-outline btn-sm btn-client-preview-doc btn-billing-pdf" data-name="${pdf.name || `PDF Envíame ${idx + 1}`}" data-url="${pdf.url}" style="padding: 0.35rem 0.5rem; font-size: 0.75rem; width: 100%; text-align: left; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; height: auto;">
                  <i class="ri-file-pdf-line" style="font-size: 0.9rem;"></i> ${pdf.name || `PDF ${idx + 1}`}
                </button>
              `).join('') : '<span style="color: var(--color-text-muted); font-size: 0.8rem;">-</span>'}
            </div>
          </td>
          <td style="vertical-align: middle; color: var(--color-text-muted);">
            <div>${r.fecha_limite_enviame ? new Date(r.fecha_limite_enviame + 'T00:00:00').toLocaleDateString() : '-'}</div>
            ${window.getDeadlineBadgeHtml(r.fecha_limite_enviame, r.pago_enviame)}
          </td>
          <td style="vertical-align: middle; text-align: right; font-weight: 500;">
            ${window.formatCLP(r.enviame)}
          </td>
          <td style="vertical-align: middle; text-align: right; color: var(--color-success); font-weight: 500;">
            ${window.formatCLP(r.abono_enviame)}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            <span class="client-badge ${getClientStatusClass(r.pago_enviame)}">${r.pago_enviame || '-'}</span>
            ${r.pago_enviame === 'Recibido' && r.fecha_pago_recibido_enviame ? `
              <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                Recibido: ${new Date(r.fecha_pago_recibido_enviame + 'T00:00:00').toLocaleDateString()}
              </div>
            ` : ''}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            <span class="client-badge ${getClientStatusClass(r.factura_enviame)}">${r.factura_enviame || '-'}</span>
          </td>
          <td style="vertical-align: middle; text-align: center; font-weight: 600; color: var(--color-text-main);">
            ${r.num_factura_enviame || '-'}
          </td>
          <td style="font-weight: 700; color: var(--color-text-main); vertical-align: middle; text-align: right;">
            ${window.formatCLP(recordTotal)}
          </td>
          <td style="vertical-align: middle; text-align: center;">
            ${actionBtn}
          </td>
        </tr>
      `;
    });
    
    const saldoPendiente = totalFacturado - totalPagado;
    updateSummaryCards(totalFacturado, totalPagado, saldoPendiente);
    
    window.switchBillingTabClient = function(tabName, btn) {
      document.querySelectorAll('.billing-tab-btn').forEach(b => {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      
      const tabFulf = document.getElementById('billing-tab-fulf');
      const tabEnv = document.getElementById('billing-tab-env');
      const tabExtra = document.getElementById('billing-tab-extra');
      const filtersFulf = document.getElementById('filters-fulf');
      const filtersEnv = document.getElementById('filters-env');
      const filtersExtra = document.getElementById('filters-extra');

      if (tabName === 'fulf') {
        if (tabFulf) tabFulf.style.display = 'block';
        if (tabEnv) tabEnv.style.display = 'none';
        if (tabExtra) tabExtra.style.display = 'none';
        if (filtersFulf) filtersFulf.style.display = 'flex';
        if (filtersEnv) filtersEnv.style.display = 'none';
        if (filtersExtra) filtersExtra.style.display = 'none';
      } else if (tabName === 'env') {
        if (tabFulf) tabFulf.style.display = 'none';
        if (tabEnv) tabEnv.style.display = 'block';
        if (tabExtra) tabExtra.style.display = 'none';
        if (filtersFulf) filtersFulf.style.display = 'none';
        if (filtersEnv) filtersEnv.style.display = 'flex';
        if (filtersExtra) filtersExtra.style.display = 'none';
      } else {
        if (tabFulf) tabFulf.style.display = 'none';
        if (tabEnv) tabEnv.style.display = 'none';
        if (tabExtra) tabExtra.style.display = 'block';
        if (filtersFulf) filtersFulf.style.display = 'none';
        if (filtersEnv) filtersEnv.style.display = 'none';
        if (filtersExtra) filtersExtra.style.display = 'flex';
        window.loadClientExtraCharges(periodId);
      }
    };

    tableContainer.innerHTML = `
      <!-- Pestañas -->
      <div class="billing-tabs-container">
        <button class="billing-tab-btn active" onclick="switchBillingTabClient('fulf', this)">Fulfillment</button>
        <button class="billing-tab-btn" onclick="switchBillingTabClient('env', this)">Envíame</button>
        <button class="billing-tab-btn" onclick="switchBillingTabClient('extra', this)">Cobros Adicionales</button>
      </div>

      <!-- Filtros Fulf -->
      <div id="filters-fulf" class="billing-filters-bar" style="display: flex; gap: 1rem; align-items: center; padding: 0.75rem 1.25rem; background: var(--color-bg); border-bottom: 1px solid var(--color-border); flex-wrap: wrap;">
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);"><i class="ri-filter-3-line"></i> Filtros Fulfillment:</span>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <label style="font-size: 0.75rem; color: var(--color-text-muted);">Pago:</label>
          <select class="form-input filter-pago-fulf" style="padding: 0.15rem 0.5rem; font-size: 0.75rem; margin: 0; width: auto;" onchange="filterBillingRowsClientFulf()">
            <option value="">Todos</option>
            <option value="Por solicitar">Por solicitar</option>
            <option value="Recibido">Recibido</option>
            <option value="En espera">En espera</option>
            <option value="Atrasado">Atrasado</option>
            <option value="abono">Abono</option>
            <option value="aprobado">Aprobado</option>
            <option value="incobrable">Incobrable</option>
            <option value="Sin movimientos">Sin movimientos</option>
          </select>
        </div>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <label style="font-size: 0.75rem; color: var(--color-text-muted);">Factura:</label>
          <select class="form-input filter-fact-fulf" style="padding: 0.15rem 0.5rem; font-size: 0.75rem; margin: 0; width: auto;" onchange="filterBillingRowsClientFulf()">
            <option value="">Todos</option>
            <option value="Esperando">Esperando</option>
            <option value="No se factura">No se factura</option>
            <option value="Emitida">Emitida</option>
            <option value="Facturar">Facturar</option>
            <option value="Sin movimientos">Sin movimientos</option>
          </select>
        </div>
      </div>

      <!-- Filtros Env -->
      <div id="filters-env" class="billing-filters-bar" style="display: none; gap: 1rem; align-items: center; padding: 0.75rem 1.25rem; background: var(--color-bg); border-bottom: 1px solid var(--color-border); flex-wrap: wrap;">
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);"><i class="ri-filter-3-line"></i> Filtros Envíame:</span>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <label style="font-size: 0.75rem; color: var(--color-text-muted);">Pago:</label>
          <select class="form-input filter-pago-env" style="padding: 0.15rem 0.5rem; font-size: 0.75rem; margin: 0; width: auto;" onchange="filterBillingRowsClientEnv()">
            <option value="">Todos</option>
            <option value="Por solicitar">Por solicitar</option>
            <option value="Recibido">Recibido</option>
            <option value="En espera">En espera</option>
            <option value="Atrasado">Atrasado</option>
            <option value="abono">Abono</option>
            <option value="aprobado">Aprobado</option>
            <option value="incobrable">Incobrable</option>
            <option value="Sin movimientos">Sin movimientos</option>
          </select>
        </div>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <label style="font-size: 0.75rem; color: var(--color-text-muted);">Factura:</label>
          <select class="form-input filter-fact-env" style="padding: 0.15rem 0.5rem; font-size: 0.75rem; margin: 0; width: auto;" onchange="filterBillingRowsClientEnv()">
            <option value="">Todos</option>
            <option value="Esperando">Esperando</option>
            <option value="No se factura">No se factura</option>
            <option value="Emitida">Emitida</option>
            <option value="Facturar">Facturar</option>
            <option value="Sin movimientos">Sin movimientos</option>
          </select>
        </div>
      </div>

      <!-- Filtros Extra -->
      <div id="filters-extra" class="billing-filters-bar" style="display: none; gap: 1rem; align-items: center; padding: 0.75rem 1.25rem; background: var(--color-bg); border-bottom: 1px solid var(--color-border); flex-wrap: wrap;">
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);"><i class="ri-add-circle-line"></i> Cobros Extraordinarios / Adicionales del Comercio:</span>
        <span style="font-size: 0.8rem; color: var(--color-text-muted);">Historial de cobros extraordinarios que hayan sido registrados por administración.</span>
      </div>

      <!-- Tabla Fulfillment -->
      <div id="billing-tab-fulf" class="table-responsive">
        <table class="data-table" style="min-width: 1000px; font-size: 0.85rem; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="min-width: 150px; border-bottom: 1px solid var(--color-border);">Comercio</th>
              <th style="min-width: 200px; border-bottom: 1px solid var(--color-border);">Registros</th>
              <th style="min-width: 110px; border-bottom: 1px solid var(--color-border);">Límite</th>
              <th style="min-width: 110px; border-bottom: 1px solid var(--color-border);">Desglose</th>
              <th style="min-width: 95px; text-align: right; border-bottom: 1px solid var(--color-border);">Total Fulf</th>
              <th style="min-width: 95px; text-align: right; border-bottom: 1px solid var(--color-border);">Abono Fulf</th>
              <th style="min-width: 120px; border-bottom: 1px solid var(--color-border);">Pago Fulf</th>
              <th style="min-width: 120px; border-bottom: 1px solid var(--color-border);">Factura Fulf</th>
              <th style="min-width: 70px; border-bottom: 1px solid var(--color-border);">N°Fact</th>
              <th style="min-width: 120px; text-align: right; border-bottom: 1px solid var(--color-border);">Total Mes (F+E)</th>
              <th style="min-width: 130px; text-align: center; border-bottom: 1px solid var(--color-border);">Acción</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsFulf}
          </tbody>
        </table>
      </div>

      <!-- Tabla Envíame -->
      <div id="billing-tab-env" class="table-responsive" style="display: none;">
        <table class="data-table" style="min-width: 1000px; font-size: 0.85rem; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="min-width: 150px; border-bottom: 1px solid var(--color-border);">Comercio</th>
              <th style="min-width: 200px; border-bottom: 1px solid var(--color-border);">Registros</th>
              <th style="min-width: 110px; border-bottom: 1px solid var(--color-border);">Límite</th>
              <th style="min-width: 95px; text-align: right; border-bottom: 1px solid var(--color-border);">Total Env</th>
              <th style="min-width: 95px; text-align: right; border-bottom: 1px solid var(--color-border);">Abono Env</th>
              <th style="min-width: 120px; border-bottom: 1px solid var(--color-border);">Pago Env</th>
              <th style="min-width: 120px; border-bottom: 1px solid var(--color-border);">Factura Env</th>
              <th style="min-width: 70px; border-bottom: 1px solid var(--color-border);">N°Fact Env</th>
              <th style="min-width: 120px; text-align: right; border-bottom: 1px solid var(--color-border);">Total Mes (F+E)</th>
              <th style="min-width: 130px; text-align: center; border-bottom: 1px solid var(--color-border);">Acción</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsEnv}
          </tbody>
        </table>
      </div>

      <!-- Tabla Cobros Adicionales -->
      <div id="billing-tab-extra" class="table-responsive" style="display: none;">
        <table class="data-table" style="min-width: 800px; font-size: 0.85rem; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="min-width: 110px; border-bottom: 1px solid var(--color-border);">Fecha</th>
              <th style="min-width: 150px; border-bottom: 1px solid var(--color-border);">Comercio</th>
              <th style="min-width: 300px; border-bottom: 1px solid var(--color-border);">Detalle del Cobro</th>
              <th style="min-width: 120px; text-align: right; border-bottom: 1px solid var(--color-border);">Monto</th>
              <th style="min-width: 120px; border-bottom: 1px solid var(--color-border);">Estado</th>
              <th style="min-width: 150px; border-bottom: 1px solid var(--color-border);">Periodo Asignado</th>
            </tr>
          </thead>
          <tbody id="client-extra-charges-table-body">
            <tr>
              <td colspan="6" class="text-center" style="padding: 2.5rem; color: var(--color-text-muted);">
                <i class="ri-loader-4-line spin" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
                Cargando cobros adicionales...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    
    // Bind previews for client billing attachments
    tableContainer.querySelectorAll('.btn-client-preview-doc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const name = btn.getAttribute('data-name');
        const url = btn.getAttribute('data-url');
        window.openDocPreviewModal(name, url);
      });
    });
    
    // 4. Consultar y listar reportes de pago de estos comercios para el periodo
    await loadClientPaymentReports(periodId, resolvedCompanyList);
    
  } catch (err) {
    console.error('Error loading client billing records:', err);
    tableContainer.innerHTML = `
      <div style="padding: 2rem; color: var(--color-danger); text-align: center;">
        <strong>Error al consultar facturas:</strong> ${err.message}
      </div>
    `;
  }
};

async function loadClientPaymentReports(periodId, resolvedCompanyList) {
  const reportsContainer = document.getElementById('client-reports-table-body');
  if (!reportsContainer) return;
  
  try {
    const { data: reports, error } = await supabase
      .from('payment_reports')
      .select('*')
      .eq('period_id', periodId)
      .in('comercio', resolvedCompanyList)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    if (!reports || reports.length === 0) {
      reportsContainer.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
          No has registrado avisos de pago para este periodo.
        </div>
      `;
      return;
    }
    
    let rows = '';
    reports.forEach(rep => {
      let statusClass = 'client-badge-gray';
      if (rep.status === 'aprobado') statusClass = 'client-badge-green';
      if (rep.status === 'rechazado') statusClass = 'client-badge-red';
      
      let statusLabel = rep.status.toUpperCase();
      if (rep.status === 'pendiente') statusLabel = 'PENDIENTE';
      if (rep.status === 'aprobado') statusLabel = 'APROBADO';
      if (rep.status === 'rechazado') statusLabel = 'RECHAZADO';
      
      const statusBadge = `<span class="client-badge ${statusClass}">${statusLabel}</span>`;
      
      let rejectionDetail = '';
      if (rep.status === 'rechazado' && rep.motivo_rechazo) {
        rejectionDetail = `<div style="font-size: 0.75rem; color: var(--color-danger); margin-top: 0.25rem;"><strong>Motivo:</strong> ${rep.motivo_rechazo}</div>`;
      }
      
      rows += `
        <tr>
          <td style="font-weight: 600; color: var(--color-text-main);">${rep.comercio}</td>
          <td>${new Date(rep.fecha_pago + 'T00:00:00').toLocaleDateString()}</td>
          <td style="font-weight: 600;">${window.formatCLP(rep.monto)}</td>
          <td style="text-transform: capitalize;">${rep.servicio}</td>
          <td>
            ${rep.comprobante_url ? `
              <a href="${rep.comprobante_url}" target="_blank" class="btn btn-outline btn-sm" style="padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                <i class="ri-file-text-line"></i> Ver Comprobante
              </a>
            ` : '-'}
          </td>
          <td>
            ${statusBadge}
            ${rejectionDetail}
          </td>
        </tr>
      `;
    });
    
    reportsContainer.innerHTML = `
      <table class="data-table" style="font-size: 0.85rem;">
        <thead>
          <tr>
            <th>Comercio</th>
            <th>Fecha Pago</th>
            <th>Monto</th>
            <th>Servicio</th>
            <th>Comprobante</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error loading client payment reports:', err);
    reportsContainer.innerHTML = `
      <div style="padding: 1rem; color: var(--color-danger); text-align: center;">
        Error al cargar historial de avisos de pago: ${err.message}
      </div>
    `;
  }
}

window.filterBillingRowsClientFulf = function() {
  const filterPagoFulf = document.querySelector('.filter-pago-fulf').value;
  const filterFactFulf = document.querySelector('.filter-fact-fulf').value;
  
  const rows = document.querySelectorAll('.billing-record-row-fulf');
  rows.forEach(row => {
    const pagoFulf = row.getAttribute('data-pago-fulf') || '';
    const factFulf = row.getAttribute('data-fact-fulf') || '';
    
    const matchPagoFulf = !filterPagoFulf || pagoFulf === filterPagoFulf;
    const matchFactFulf = !filterFactFulf || factFulf === filterFactFulf;
    
    if (matchPagoFulf && matchFactFulf) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
};

window.filterBillingRowsClientEnv = function() {
  const filterPagoEnv = document.querySelector('.filter-pago-env').value;
  const filterFactEnv = document.querySelector('.filter-fact-env').value;
  
  const rows = document.querySelectorAll('.billing-record-row-env');
  rows.forEach(row => {
    const pagoEnv = row.getAttribute('data-pago-env') || '';
    const factEnv = row.getAttribute('data-fact-env') || '';
    
    const matchPagoEnv = !filterPagoEnv || pagoEnv === filterPagoEnv;
    const matchFactEnv = !filterFactEnv || factEnv === filterFactEnv;
    
    if (matchPagoEnv && matchFactEnv) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
};

window.abrirModalInformarPago = function(periodId, recordId, comercio, pendingFulfillment, pendingEnviame) {
  let modal = document.getElementById('modal-informar-pago');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'modal-informar-pago';
  modal.className = 'modal-overlay';
  
  const defaultMonto = Math.max(0, pendingFulfillment) + Math.max(0, pendingEnviame);
  const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local format
  
  let serviceOptions = '';
  if (pendingFulfillment > 0 && pendingEnviame > 0) {
    serviceOptions = `
      <option value="ambos">Ambos (Fulfillment y Envíame)</option>
      <option value="fulfillment">Sólo Fulfillment</option>
      <option value="enviame">Sólo Envíame</option>
    `;
  } else if (pendingFulfillment > 0) {
    serviceOptions = `<option value="fulfillment" selected>Fulfillment</option>`;
  } else if (pendingEnviame > 0) {
    serviceOptions = `<option value="enviame" selected>Envíame</option>`;
  } else {
    serviceOptions = `<option value="ambos" selected>Ambos</option>`;
  }
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px; display: flex; flex-direction: column; max-height: 90vh; padding: 0;">
      <div class="modal-header" style="padding: 1.25rem; border-bottom: 1px solid var(--color-border); background: var(--color-surface); border-radius: var(--radius-lg) var(--radius-lg) 0 0;">
        <h3 style="margin: 0;">Informar Pago</h3>
        <button class="modal-close" id="btn-close-informar-pago-x">&times;</button>
      </div>
      <div class="modal-body" style="font-size: 0.95rem; color: var(--color-text-main); line-height: 1.6; overflow-y: auto; flex: 1; padding: 1.25rem;">
        <div style="margin-bottom: 1rem;">
          <label style="font-weight: 600; display: block; margin-bottom: 0.25rem;">Comercio:</label>
          <input type="text" class="form-input" value="${comercio}" disabled style="background-color: var(--color-bg); opacity: 0.8;">
        </div>
        
        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600;">Monto del Pago (CLP):</label>
          <input type="number" id="modal-monto-pago" class="form-input" value="${defaultMonto}" required placeholder="Monto abonado">
        </div>
        
        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600;">Fecha de Pago:</label>
          <input type="date" id="modal-fecha-pago" class="form-input" value="${todayStr}" required>
        </div>
        
        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600;">Servicio Correspondiente:</label>
          <select id="modal-servicio-pago" class="form-input" required>
            ${serviceOptions}
          </select>
        </div>
        
        <div class="form-group" style="margin-bottom: 1.25rem;">
          <label class="form-label" style="font-weight: 600;">Adjuntar Comprobante (PDF o Imagen):</label>
          <input type="file" id="modal-comprobante-file" class="form-input" accept=".pdf,image/*" required style="padding: 0.35rem;">
          <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">*Archivo obligatorio. Formatos permitidos: PDF, JPG, PNG.</span>
        </div>
        
        <div id="modal-error-message" style="display: none; padding: 0.75rem; margin-bottom: 1rem; background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-sm); color: var(--color-danger); font-size: 0.85rem;"></div>
      </div>
      <div class="modal-footer" style="padding: 1.25rem; border-top: 1px solid var(--color-border); background: var(--color-surface); border-radius: 0 0 var(--radius-lg) var(--radius-lg); display: flex; gap: 0.75rem;">
        <button class="btn btn-outline" id="btn-close-informar-pago" style="flex: 1;">Cancelar</button>
        <button class="btn btn-primary" id="btn-submit-informar-pago" style="flex: 1;">Enviar Reporte</button>
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
  
  document.getElementById('btn-close-informar-pago-x').addEventListener('click', closeModal);
  document.getElementById('btn-close-informar-pago').addEventListener('click', closeModal);
  
  const btnSubmit = document.getElementById('btn-submit-informar-pago');
  btnSubmit.addEventListener('click', async () => {
    const montoInput = document.getElementById('modal-monto-pago');
    const fechaInput = document.getElementById('modal-fecha-pago');
    const servicioSelect = document.getElementById('modal-servicio-pago');
    const fileInput = document.getElementById('modal-comprobante-file');
    const errMsg = document.getElementById('modal-error-message');
    
    const monto = parseInt(montoInput.value, 10);
    const fecha = fechaInput.value;
    const servicio = servicioSelect.value;
    const file = fileInput.files[0];
    
    if (!monto || monto <= 0) {
      errMsg.textContent = 'El monto debe ser mayor a 0.';
      errMsg.style.display = 'block';
      return;
    }
    if (!fecha) {
      errMsg.textContent = 'Por favor selecciona la fecha de pago.';
      errMsg.style.display = 'block';
      return;
    }
    if (!file) {
      errMsg.textContent = 'Por favor adjunta un comprobante de pago (PDF o Imagen).';
      errMsg.style.display = 'block';
      return;
    }
    
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="ri-loader-4-line spin"></i> Enviando...';
    errMsg.style.display = 'none';
    
    try {
      // 1. Subir comprobante al bucket payment_receipts
      const fileExt = file.name.split('.').pop();
      const fileName = `${recordId}_${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('payment_receipts')
        .upload(fileName, file);
        
      if (uploadError) throw uploadError;
      
      // 2. Obtener URL pública
      const { data: urlData } = supabase.storage
        .from('payment_receipts')
        .getPublicUrl(fileName);
        
      const comprobanteUrl = urlData.publicUrl;
      
      // 3. Registrar reporte en la base de datos
      const { error: insertError } = await supabase
        .from('payment_reports')
        .insert({
          period_id: periodId,
          comercio: comercio,
          monto: monto,
          fecha_pago: fecha,
          servicio: servicio,
          comprobante_url: comprobanteUrl,
          status: 'pendiente'
        });
        
      if (insertError) throw insertError;
      
      alert('Reporte de pago enviado con éxito. El administrador revisará tu comprobante.');
      closeModal();
      // Recargar tabla y avisos
      loadClientBillingData(periodId);
    } catch (err) {
      console.error('Error reporting payment:', err);
      errMsg.textContent = 'Error al enviar reporte: ' + err.message;
      errMsg.style.display = 'block';
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Enviar Reporte';
    }
  });
};

function updateSummaryCards(facturado, pagado, pendiente) {
  const fEl = document.getElementById('summary-total-facturado');
  const pEl = document.getElementById('summary-total-pagado');
  const peEl = document.getElementById('summary-saldo-pendiente');
  
  if (fEl) fEl.textContent = window.formatCLP(facturado);
  if (pEl) pEl.textContent = window.formatCLP(pagado);
  if (peEl) peEl.textContent = window.formatCLP(pendiente);
}

function getClientStatusClass(val) {
  if (!val) return 'client-badge-gray';
  const v = val.toLowerCase();
  if (['sin movimientos'].includes(v)) return 'client-badge-light-green';
  if (['enviado', 'emitida', 'aprobado'].includes(v)) return 'client-badge-green';
  if (['creado'].includes(v)) return 'client-badge-cyan';
  if (['por generar', 'por solicitar', 'esperando', 'no se factura'].includes(v)) return 'client-badge-gray';
  if (['recibido'].includes(v)) return 'client-badge-blue';
  if (['en espera'].includes(v)) return 'client-badge-purple';
  if (['facturar'].includes(v)) return 'client-badge-yellow';
  if (['atrasado', 'incobrable'].includes(v)) return 'client-badge-red';
  if (['abono'].includes(v)) return 'client-badge-teal';
  return 'client-badge-gray';
}

function injectClientBillingStyles() {
  if (document.getElementById('client-billing-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'client-billing-styles';
  style.innerHTML = `
    .billing-summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .billing-summary-card {
      background: linear-gradient(145deg, var(--color-surface) 0%, rgba(30, 41, 59, 0.3) 100%);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: var(--radius-lg);
      padding: 1.5rem 1.75rem;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
      backdrop-filter: blur(10px);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    .billing-summary-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; width: 100%; height: 4px;
      background: var(--color-primary);
    }
    .billing-summary-card:nth-child(2)::before {
      background: var(--color-success);
    }
    .billing-summary-card:nth-child(3)::before {
      background: var(--color-warning);
    }
    .billing-summary-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    }
    .billing-summary-label {
      font-size: 0.8rem;
      color: var(--color-text-muted);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .billing-summary-label i {
      font-size: 1.1rem;
      opacity: 0.8;
    }
    .billing-summary-value {
      font-size: 1.75rem;
      font-weight: 800;
      color: var(--color-text-main);
      letter-spacing: -0.02em;
    }
    
    /* Modern Pill Tabs */
    .billing-tabs-container {
      display: inline-flex;
      background: var(--color-bg);
      border-radius: 50px;
      padding: 0.25rem;
      margin: 1rem 1.25rem;
      border: 1px solid var(--color-border);
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
    }
    .billing-tab-btn {
      padding: 0.5rem 1.5rem;
      border-radius: 50px;
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--color-text-muted);
      cursor: pointer;
      border: none;
      background: transparent;
      transition: all 0.3s ease;
    }
    .billing-tab-btn.active {
      background: var(--color-surface);
      color: var(--color-text-main);
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    /* Filters Bar */
    .billing-filters-bar {
      display: flex;
      gap: 1.5rem;
      align-items: center;
      padding: 1rem 1.25rem;
      background: linear-gradient(90deg, rgba(30,41,59,0.2) 0%, transparent 100%);
      border-bottom: 1px solid var(--color-border);
      flex-wrap: wrap;
    }

    /* Modern Pill Badges */
    .client-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.3rem 0.75rem;
      border-radius: 50px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      min-width: 90px;
      text-align: center;
      border: 1px solid transparent;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .client-badge-green { background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05)); color: #10b981; border-color: rgba(16, 185, 129, 0.2); }
    .client-badge-gray { background: linear-gradient(135deg, rgba(148, 163, 184, 0.15), rgba(148, 163, 184, 0.05)); color: #94a3b8; border-color: rgba(148, 163, 184, 0.2); }
    .client-badge-blue { background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05)); color: #3b82f6; border-color: rgba(59, 130, 246, 0.2); }
    .client-badge-purple { background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.05)); color: #8b5cf6; border-color: rgba(139, 92, 246, 0.2); }
    .client-badge-yellow { background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05)); color: #f59e0b; border-color: rgba(245, 158, 11, 0.2); }
    .client-badge-red { background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05)); color: #ef4444; border-color: rgba(239, 68, 68, 0.2); }
    .client-badge-teal { background: linear-gradient(135deg, rgba(20, 184, 166, 0.15), rgba(20, 184, 166, 0.05)); color: #14b8a6; border-color: rgba(20, 184, 166, 0.2); }
    .client-badge-cyan { background: linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(6, 182, 212, 0.05)); color: #06b6d4; border-color: rgba(6, 182, 212, 0.2); }
    .client-badge-light-green { background: linear-gradient(135deg, rgba(52, 211, 153, 0.2), rgba(52, 211, 153, 0.05)) !important; color: #10b981 !important; border-color: rgba(52, 211, 153, 0.3) !important; }
    
    .billing-record-row-fulf, .billing-record-row-env {
      transition: background-color 0.2s ease;
    }
    .billing-record-row-fulf:hover, .billing-record-row-env:hover {
      background-color: rgba(255, 255, 255, 0.03);
    }
    
    .text-right {
      text-align: right;
    }
    
    .action-btn-modern {
      background: linear-gradient(135deg, var(--color-primary), #4f46e5);
      color: white;
      border: none;
      padding: 0.35rem 0.85rem;
      border-radius: 50px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
    }
    .action-btn-modern:hover {
      transform: scale(1.03);
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.5);
    }

    /* Billing document buttons */
    .btn-billing-link {
      border-color: rgba(59, 130, 246, 0.3) !important;
      color: #2563eb !important;
      background: rgba(59, 130, 246, 0.06) !important;
    }
    .btn-billing-link:hover {
      background: rgba(59, 130, 246, 0.12) !important;
      border-color: rgba(59, 130, 246, 0.5) !important;
    }
    .btn-billing-pdf {
      border-color: rgba(220, 38, 38, 0.3) !important;
      color: #dc2626 !important;
      background: rgba(220, 38, 38, 0.06) !important;
    }
    .btn-billing-pdf:hover {
      background: rgba(220, 38, 38, 0.12) !important;
      border-color: rgba(220, 38, 38, 0.5) !important;
    }

    /* Dark mode overrides */
    [data-theme="dark"] .btn-billing-link {
      border-color: rgba(96, 165, 250, 0.25) !important;
      color: #93c5fd !important;
      background: rgba(96, 165, 250, 0.08) !important;
    }
    [data-theme="dark"] .btn-billing-link:hover {
      background: rgba(96, 165, 250, 0.15) !important;
      border-color: rgba(96, 165, 250, 0.4) !important;
    }
    [data-theme="dark"] .btn-billing-pdf {
      border-color: rgba(251, 113, 133, 0.25) !important;
      color: #fda4af !important;
      background: rgba(251, 113, 133, 0.08) !important;
    }
    [data-theme="dark"] .btn-billing-pdf:hover {
      background: rgba(251, 113, 133, 0.15) !important;
      border-color: rgba(251, 113, 133, 0.4) !important;
    }
  `;
  document.head.appendChild(style);
}

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

window.checkBillingSuspension = checkBillingSuspension;

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

window.showSuspensionBanner = showSuspensionBanner;

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

// ==========================================
// Módulo de Documentación de Servicio (Cliente)
// ==========================================

function injectDocsStyles() {
  if (document.getElementById('docs-client-styles')) return;
  const style = document.createElement('style');
  style.id = 'docs-client-styles';
  style.innerHTML = `
    .docs-container {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
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
    .docs-main-content {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .pinned-section {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%);
      border: 1px dashed var(--color-primary);
      border-radius: var(--radius-lg);
      padding: 1.25rem;
    }
    .pinned-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
      margin-top: 0.75rem;
    }
    .doc-card-pinned {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1rem;
      position: relative;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .doc-card-pinned:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
      border-color: var(--color-primary);
    }
    .doc-card-pinned::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: linear-gradient(to bottom, #f59e0b, #d97706);
    }
    .doc-file-icon {
      font-size: 2.25rem;
      color: var(--color-primary);
    }
    .doc-star-badge {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      color: #f59e0b;
      font-size: 1.1rem;
    }
    .files-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
    }
    .doc-card-standard {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1rem;
      box-shadow: var(--shadow-sm);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .doc-card-standard:hover {
      border-color: var(--color-primary);
      box-shadow: var(--shadow-md);
    }
    .doc-info {
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
    }
    .doc-badge-folder {
      background: rgba(59, 130, 246, 0.08);
      color: var(--color-primary);
      padding: 0.15rem 0.4rem;
      border-radius: var(--radius-sm);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      align-self: flex-start;
    }
  `;
  document.head.appendChild(style);
}

// Variables globales cliente
let clientDocsList = [];
let clientSelectedFolder = 'all';
let clientSearchQuery = '';

window.renderDocsClient = async function() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  injectDocsStyles();

  // Inyectar banner de observador si procede
  const observerBanner = typeof getObserverBanner === 'function' ? getObserverBanner() : '';

  appContent.innerHTML = observerBanner + `
    <div class="docs-container">
      <div class="card" style="padding: 1.25rem;">
        <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
          <div style="position: relative; flex: 1; min-width: 250px;">
            <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
            <input type="text" id="client-doc-search" class="form-input" style="padding-left: 2.25rem;" placeholder="Buscar documentos por nombre o descripción..." value="${clientSearchQuery}">
          </div>
        </div>
      </div>

      <div class="docs-grid">
        <aside class="folder-sidebar">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 0.75rem; letter-spacing: 0.05em;">Carpetas</h4>
          <ul id="client-folder-list" class="folder-list">
            <li class="folder-item active" data-folder="all">
              <span><i class="ri-folder-open-line folder-icon"></i> Todas</span>
              <span id="client-folder-count-all" class="badge" style="font-size: 0.75rem; padding: 0.1rem 0.4rem;">0</span>
            </li>
          </ul>
        </aside>

        <div class="docs-main-content">
          <!-- Sección de Destacados -->
          <div id="client-pinned-section" class="pinned-section" style="display: none;">
            <h4 style="margin: 0; color: #b45309; display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em;">
              <i class="ri-star-fill" style="color: #f59e0b;"></i> Documentos Destacados
            </h4>
            <div id="client-pinned-grid" class="pinned-grid"></div>
          </div>

          <!-- Listado de Archivos -->
          <div class="card" style="padding: 1.5rem;">
            <h3 style="margin-top: 0; margin-bottom: 1.25rem; font-size: 1.1rem; display: flex; justify-content: space-between;" id="client-current-folder-title">
              <span>Todos los Archivos</span>
              <span id="client-files-count" style="font-size: 0.85rem; color: var(--color-text-muted); font-weight: normal;">0 archivos</span>
            </h3>
            <div id="client-files-grid" class="files-grid">
              <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--color-text-muted);">
                <i class="ri-loader-4-line spin" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
                Cargando archivos...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Search filter trigger
  const searchInput = document.getElementById('client-doc-search');
  searchInput.addEventListener('input', (e) => {
    clientSearchQuery = e.target.value.trim().toLowerCase();
    filterAndRenderDocsClient();
  });

  await loadDocsClientData();
};

async function loadDocsClientData() {
  try {
    const { data, error } = await supabase
      .from('service_docs')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false });

    if (error) throw error;

    clientDocsList = data || [];
    renderClientFoldersSidebar();
    filterAndRenderDocsClient();
  } catch (err) {
    console.error('Error loading client documents:', err);
    const grid = document.getElementById('client-files-grid');
    if (grid) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--color-danger);">
          <i class="ri-error-warning-line" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
          Error al cargar los documentos de servicio: ${err.message}
        </div>
      `;
    }
  }
}

function renderClientFoldersSidebar() {
  const sidebar = document.getElementById('client-folder-list');
  if (!sidebar) return;

  const folders = {};
  clientDocsList.forEach(doc => {
    const f = doc.folder || 'General';
    folders[f] = (folders[f] || 0) + 1;
  });

  let html = `
    <li class="folder-item ${clientSelectedFolder === 'all' ? 'active' : ''}" data-folder="all">
      <span><i class="ri-folder-open-line folder-icon"></i> Todas</span>
      <span class="badge" style="font-size: 0.75rem; padding: 0.1rem 0.4rem; background: var(--color-border); color: var(--color-text-main); font-weight: 600;">${clientDocsList.length}</span>
    </li>
  `;

  Object.keys(folders).sort().forEach(folder => {
    html += `
      <li class="folder-item ${clientSelectedFolder === folder ? 'active' : ''}" data-folder="${folder}">
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
      clientSelectedFolder = item.getAttribute('data-folder');
      filterAndRenderDocsClient();
    });
  });
}

function getFileIconClass(filename) {
  if (!filename) return 'ri-file-text-line';
  const cleanFilename = filename.split('?')[0];
  const ext = cleanFilename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'pdf': return 'ri-file-pdf-line';
    case 'xls':
    case 'xlsx':
    case 'csv': return 'ri-file-excel-line';
    case 'doc':
    case 'docx': return 'ri-file-word-line';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp': return 'ri-file-image-line';
    case 'zip':
    case 'rar':
    case '7z': return 'ri-file-zip-line';
    default: return 'ri-file-text-line';
  }
}

function filterAndRenderDocsClient() {
  const grid = document.getElementById('client-files-grid');
  const pinnedSection = document.getElementById('client-pinned-section');
  const pinnedGrid = document.getElementById('client-pinned-grid');
  const folderTitle = document.getElementById('client-current-folder-title');
  const countSpan = document.getElementById('client-files-count');
  
  if (!grid) return;

  // Filtrar lista
  let filtered = clientDocsList;

  if (clientSelectedFolder !== 'all') {
    filtered = filtered.filter(doc => doc.folder === clientSelectedFolder);
    if (folderTitle) folderTitle.innerHTML = `<span>Carpeta: ${clientSelectedFolder}</span>`;
  } else {
    if (folderTitle) folderTitle.innerHTML = `<span>Todos los Archivos</span>`;
  }

  if (clientSearchQuery) {
    filtered = filtered.filter(doc => 
      doc.name.toLowerCase().includes(clientSearchQuery) || 
      (doc.description && doc.description.toLowerCase().includes(clientSearchQuery))
    );
  }

  if (countSpan) countSpan.textContent = `${filtered.length} archivos`;

  // Renderizar destacados (solo si no hay filtro de búsqueda activo, o si los destacados coinciden con la búsqueda)
  const pinnedFiles = filtered.filter(doc => doc.is_pinned);
  if (pinnedFiles.length > 0) {
    if (pinnedSection) pinnedSection.style.display = 'block';
    if (pinnedGrid) {
      pinnedGrid.innerHTML = pinnedFiles.map(doc => {
        const iconClass = getFileIconClass(doc.file_url);
        const formattedDate = new Date(doc.updated_at).toLocaleDateString('es-CL', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });

        return `
          <div class="doc-card-pinned">
            <div class="doc-star-badge"><i class="ri-star-fill"></i></div>
            <div class="doc-info" style="margin-bottom: 0.5rem;">
              <i class="${iconClass} doc-file-icon" style="color: #d97706;"></i>
              <div style="flex: 1; padding-right: 1.25rem;">
                <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text-main); line-height: 1.3;">${doc.name}</h4>
                <span class="doc-badge-folder" style="margin-top: 0.25rem; display: inline-block;">${doc.folder || 'General'}</span>
              </div>
            </div>
            <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0 0 1rem 0; min-height: 2.4rem; line-height: 1.4;">${doc.description || 'Sin descripción'}</p>
            <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--color-border); padding-top: 0.75rem; margin-top: auto;">
              <span style="font-size: 0.75rem; color: var(--color-text-muted);">Act: ${formattedDate}</span>
              <div style="display: flex; gap: 0.25rem;">
                <button class="btn btn-outline btn-client-preview-doc" data-name="${doc.name}" data-url="${doc.file_url}" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; height: auto;">
                  <i class="ri-eye-line"></i> Ver
                </button>
                <a href="${doc.file_url}" target="_blank" class="btn btn-primary" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; height: auto;" title="Descargar">
                  <i class="ri-download-2-line"></i>
                </a>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } else {
    if (pinnedSection) pinnedSection.style.display = 'none';
  }

  // Renderizar estándar
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--color-text-muted);">
        <i class="ri-file-search-line" style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.5;"></i>
        No se encontraron archivos en esta carpeta.
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(doc => {
    const iconClass = getFileIconClass(doc.file_url);
    const formattedDate = new Date(doc.updated_at).toLocaleDateString('es-CL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    const isPinnedHeaderBadge = doc.is_pinned ? `<i class="ri-star-fill" style="color: #f59e0b;" title="Destacado"></i> ` : '';

    return `
      <div class="doc-card-standard">
        <div>
          <div class="doc-info" style="margin-bottom: 0.5rem;">
            <i class="${iconClass}" style="font-size: 2rem; color: var(--color-primary);"></i>
            <div style="flex: 1;">
              <h4 style="margin: 0; font-size: 0.9rem; font-weight: 600; color: var(--color-text-main); line-height: 1.3;">
                ${isPinnedHeaderBadge}${doc.name}
              </h4>
              <div style="display: flex; gap: 0.35rem; align-items: center; margin-top: 0.25rem;">
                <span class="doc-badge-folder">${doc.folder || 'General'}</span>
              </div>
            </div>
          </div>
          <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0.5rem 0 0 0; line-height: 1.4;">${doc.description || 'Sin descripción'}</p>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--color-border); padding-top: 0.75rem; margin-top: 0.5rem;">
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">Actualizado: ${formattedDate}</span>
          <div style="display: flex; gap: 0.25rem;">
            <button class="btn btn-outline btn-client-preview-doc" data-name="${doc.name}" data-url="${doc.file_url}" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; height: auto;">
              <i class="ri-eye-line"></i> Ver
            </button>
            <a href="${doc.file_url}" target="_blank" class="btn btn-outline" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; height: auto;" title="Descargar archivo">
              <i class="ri-download-2-line"></i>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Bind previews
  document.querySelectorAll('.btn-client-preview-doc').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const name = btn.getAttribute('data-name');
      const url = btn.getAttribute('data-url');
      window.openDocPreviewModal(name, url);
    });
  });
}

window.openDocPreviewModal = function(name, url) {
  const modal = document.getElementById('modal-doc-preview');
  const title = document.getElementById('doc-preview-title');
  const body = document.getElementById('doc-preview-body');
  const info = document.getElementById('doc-preview-info');
  const downloadBtn = document.getElementById('doc-preview-download-btn');
  
  if (!modal || !body) return;
  
  title.textContent = name;
  body.innerHTML = '';
  
  const knownExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'txt', 'html', 'htm', 'xlsx', 'xls', 'csv', 'docx', 'doc', 'zip', 'rar', '7z'];
  let ext = '';
  let isExternalLink = false;
  
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) {
      ext = lastSegment.split('.').pop().toLowerCase();
      if (!knownExtensions.includes(ext)) {
        isExternalLink = true;
      }
    } else {
      isExternalLink = true; // No hay extensión de archivo en el path, asumimos que es link
    }
  } catch (e) {
    // Si no es URL válida, intentar split simple
    const cleanUrl = url.split('?')[0];
    ext = cleanUrl.split('.').pop().toLowerCase();
    if (!knownExtensions.includes(ext)) {
      isExternalLink = true;
    }
  }
  
  let html = '';
  let infoText = 'Vista previa del archivo';
  
  if (isExternalLink) {
    html = `
      <div style="padding:3rem; text-align:center; color:var(--color-text-muted); display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; box-sizing:border-box;">
        <div style="width:70px; height:70px; border-radius:50%; background:rgba(59, 130, 246, 0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; margin-bottom:1.5rem;">
          <i class="ri-external-link-line" style="font-size:2.5rem;"></i>
        </div>
        <h3 style="color:var(--color-text-main); margin-bottom:0.75rem; font-size:1.4rem; font-weight:700;">Documento Online Externo</h3>
        <p style="font-size:0.9rem; max-width:480px; margin:0 auto 1.5rem auto; line-height:1.6; color:var(--color-text-muted);">
          Este documento está enlazado a un servicio externo (como Google Sheets, Notion, OneDrive o YouTube) y no se puede visualizar directamente dentro de esta ventana debido a restricciones de seguridad del sitio de origen.
        </p>
        <a href="${url}" target="_blank" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.5rem; padding:0.6rem 1.25rem; font-size:0.95rem; font-weight:600; text-decoration:none;">
          <i class="ri-external-link-line"></i> Abrir en pestaña nueva
        </a>
        <div style="margin-top:2rem; padding:0.75rem 1rem; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-md); font-family:monospace; font-size:0.75rem; color:var(--color-text-muted); word-break:break-all; max-width:90%;">
          Enlace: ${url}
        </div>
      </div>
    `;
    infoText = 'Enlace externo';
    if (downloadBtn) {
      downloadBtn.innerHTML = '<i class="ri-external-link-line"></i> Abrir Enlace';
    }
  } else if (['pdf', 'txt', 'html', 'htm'].includes(ext)) {
    html = `<iframe src="${url}" style="width:100%; height:100%; border:none; background:white;"></iframe>`;
    if (downloadBtn) {
      downloadBtn.innerHTML = '<i class="ri-download-2-line"></i> Descargar Archivo';
    }
  } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    html = `<div style="padding:1rem; width:100%; height:100%; overflow:auto; display:flex; align-items:center; justify-content:center;"><img src="${url}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:4px; box-shadow:var(--shadow-md);"></div>`;
    if (downloadBtn) {
      downloadBtn.innerHTML = '<i class="ri-download-2-line"></i> Descargar Archivo';
    }
  } else {
    html = `
      <div style="padding:2.5rem; text-align:center; color:var(--color-text-muted);">
        <i class="ri-file-warning-line" style="font-size:3rem; color:var(--color-primary); display:block; margin-bottom:1rem;"></i>
        <h4 style="color:var(--color-text-main); margin-bottom:0.5rem;">Vista previa no disponible</h4>
        <p style="font-size:0.875rem; max-width:400px; margin:0 auto 1.5rem auto;">Los archivos de tipo <strong>.${ext}</strong> no se pueden visualizar directamente en el navegador.</p>
        <a href="${url}" target="_blank" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.5rem;">
          <i class="ri-download-2-line"></i> Descargar para Visualizar
        </a>
      </div>
    `;
    infoText = 'Descarga requerida para este tipo de archivo';
    if (downloadBtn) {
      downloadBtn.innerHTML = '<i class="ri-download-2-line"></i> Descargar Archivo';
    }
  }
  
  body.innerHTML = html;
  if (info) info.textContent = infoText;
  if (downloadBtn) {
    downloadBtn.href = url;
    downloadBtn.setAttribute('download', name);
  }
  
  modal.classList.add('active');
};

window.closeDocPreviewModal = function() {
  const modal = document.getElementById('modal-doc-preview');
  const body = document.getElementById('doc-preview-body');
  if (body) body.innerHTML = '';
  if (modal) modal.classList.remove('active');
};

// Global function to switch tabs in Integrations view
window.switchIntegrationTab = function(tabId) {
  const container = document.querySelector('.integrations-tabs-container');
  if (!container) return;
  
  const buttons = container.querySelectorAll('.integration-tab-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
      btn.style.borderBottomColor = 'var(--color-primary)';
      btn.style.color = 'var(--color-text-main)';
      btn.style.fontWeight = '600';
    } else {
      btn.classList.remove('active');
      btn.style.borderBottomColor = 'transparent';
      btn.style.color = 'var(--color-text-muted)';
      btn.style.fontWeight = '500';
    }
  });

  const panes = document.querySelectorAll('.integration-tab-pane');
  panes.forEach(pane => {
    if (pane.id === 'tab-' + tabId) {
      pane.style.display = 'block';
    } else {
      pane.style.display = 'none';
    }
  });
};

window.renderSkuMappings = async function() {
  const tbody = document.getElementById('eq-matrix-tbody');
  const thead = document.getElementById('eq-matrix-thead');
  const mainSelect = document.getElementById('eq-main-platform-select');
  if (!tbody || !thead || !mainSelect) return;

  tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--color-text-muted);"><i class="ri-loader-4-line ri-spin" style="font-size: 1.5rem;"></i> Cargando datos de equivalencias...</td></tr>`;

  try {
    const commerce = window.activeIntegrationCommerce || window.currentUser?.comercio;
    if (!commerce) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--color-danger);"><i class="ri-error-warning-line"></i> No se pudo determinar el comercio actual.</td></tr>`;
      return;
    }

    // 1. Obtener integraciones activas del comercio
    const { data: integrations, error: intErr } = await supabase
      .from('merchant_integrations')
      .select('platform, is_active, is_main')
      .eq('comercio', commerce);

    if (intErr) throw intErr;

    const activeIntegrations = (integrations || []).filter(i => i.is_active && i.platform !== 'Optiroute');
    const mainIntegration = activeIntegrations.find(i => i.is_main);
    const mainPlatform = mainIntegration ? mainIntegration.platform : '';

    // Set select value
    mainSelect.value = mainPlatform;

    if (!mainPlatform) {
      thead.innerHTML = `
        <tr style="border-bottom: 1px solid var(--color-border); background: var(--color-bg);">
          <th style="padding: 1rem; text-align: left; font-size: 0.85rem;">Producto (Principal)</th>
          <th style="padding: 1rem; text-align: left; font-size: 0.85rem;">SKU Principal</th>
        </tr>
      `;
      tbody.innerHTML = `
        <tr>
          <td colspan="2" style="text-align: center; padding: 3rem; color: var(--color-text-muted);">
            <i class="ri-information-line" style="font-size: 2.5rem; display: block; margin-bottom: 1rem; color: var(--color-warning);"></i>
            Por favor, define una <strong>Plataforma Principal de Ventas</strong> arriba para habilitar la matriz de mapeo.
          </td>
        </tr>
      `;
      setupSkuMappingsListeners();
      return;
    }

    // Secondary platforms are the other active integrations
    const secondaryPlatforms = activeIntegrations.filter(i => i.platform !== mainPlatform).map(i => i.platform);

    // Render the header with secondary platforms
    thead.innerHTML = `
      <tr style="border-bottom: 1px solid var(--color-border); background: var(--color-bg);">
        <th style="padding: 1rem; text-align: left; font-size: 0.85rem;">Producto (${mainPlatform})</th>
        <th style="padding: 1rem; text-align: left; font-size: 0.85rem;">SKU Master</th>
        ${secondaryPlatforms.map(sp => `<th style="padding: 1rem; text-align: left; font-size: 0.85rem;">SKU en ${sp}</th>`).join('')}
      </tr>
    `;

    // 2. Fetch products
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('sku, name')
      .eq('comercio', commerce)
      .order('name');

    if (prodErr) throw prodErr;

    // 3. Fetch current mappings
    const { data: mappings, error: mapErr } = await supabase
      .from('sku_equivalences')
      .select('*')
      .eq('comercio', commerce);

    if (mapErr) throw mapErr;

    // Index mappings by master_sku -> platform -> platform_sku
    const mappingsMap = {};
    if (mappings) {
      mappings.forEach(m => {
        if (!mappingsMap[m.master_sku]) {
          mappingsMap[m.master_sku] = {};
        }
        mappingsMap[m.master_sku][m.platform] = m.platform_sku;
      });
    }

    window.currentProductsForMatrix = products || [];
    window.currentSecondaryPlatforms = secondaryPlatforms;
    window.currentMappingsMap = mappingsMap;

    renderMatrixRows(products || [], secondaryPlatforms, mappingsMap);

  } catch (err) {
    console.error('Error cargando la matriz:', err);
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--color-danger);"><i class="ri-error-warning-line"></i> Error al cargar datos: ${err.message}</td></tr>`;
  }
};

function renderMatrixRows(products, secondaryPlatforms, mappingsMap) {
  const tbody = document.getElementById('eq-matrix-tbody');
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${2 + secondaryPlatforms.length}" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No hay productos en el catálogo de este comercio. Sincroniza tu plataforma principal primero.</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const productMappings = mappingsMap[p.sku] || {};
    return `
      <tr style="border-bottom: 1px solid var(--color-border); transition: background-color 0.15s;" onmouseover="this.style.backgroundColor='var(--color-bg)'" onmouseout="this.style.backgroundColor='transparent'">
        <td style="padding: 0.75rem 1rem; font-size: 0.9rem; color: var(--color-text-main); font-weight: 500;">${p.name || 'Sin Nombre'}</td>
        <td style="padding: 0.75rem 1rem; font-size: 0.9rem; font-family: monospace; font-weight: bold; color: var(--color-primary);">${p.sku}</td>
        ${secondaryPlatforms.map(sp => {
          const val = productMappings[sp] || '';
          return `
            <td style="padding: 0.5rem 1rem;">
              <input type="text" class="form-input eq-matrix-input" 
                     data-master-sku="${p.sku}" 
                     data-platform="${sp}" 
                     value="${val}" 
                     placeholder="Igual al master" 
                     style="margin: 0; padding: 0.35rem 0.6rem; font-size: 0.85rem; font-family: monospace; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); border-radius: 4px;">
            </td>
          `;
        }).join('')}
      </tr>
    `;
  }).join('');

  // Add event listeners for inputs
  tbody.querySelectorAll('.eq-matrix-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const masterSku = e.target.getAttribute('data-master-sku');
      const platform = e.target.getAttribute('data-platform');
      const value = e.target.value.trim().replace(/\s+/g, '');
      const commerce = window.activeIntegrationCommerce || window.currentUser?.comercio;

      if (!commerce) return;

      // Add visual saving indicator
      e.target.style.borderColor = 'var(--color-primary)';

      try {
        if (value === '') {
          // Si el valor está vacío, eliminamos la equivalencia
          const { error } = await supabase
            .from('sku_equivalences')
            .delete()
            .eq('comercio', commerce)
            .eq('platform', platform)
            .eq('master_sku', masterSku);

          if (error) throw error;
        } else {
          // Si tiene valor, hacemos el upsert
          const { error } = await supabase
            .from('sku_equivalences')
            .upsert([{
              comercio,
              platform,
              platform_sku: value,
              master_sku: masterSku
            }], { onConflict: 'comercio,platform,platform_sku' });

          if (error) throw error;
        }
        e.target.style.borderColor = '#10b981'; // green for success
        setTimeout(() => { e.target.style.borderColor = 'var(--color-border)'; }, 1000);
      } catch (err) {
        console.error(err);
        e.target.style.borderColor = 'var(--color-danger)'; // red for error
        alert(`Error al guardar equivalencia para ${platform}: ${err.message}`);
      }
    });
  });

  setupSkuMappingsListeners();
}

function setupSkuMappingsListeners() {
  // 0. Descargar plantilla
  const btnDownload = document.getElementById('btn-download-sku-template');
  if (btnDownload) {
    const newBtnDownload = btnDownload.cloneNode(true);
    btnDownload.parentNode.replaceChild(newBtnDownload, btnDownload);
    newBtnDownload.addEventListener('click', () => {
      const headers = [['Plataforma', 'SKU Plataforma', 'SKU Master']];
      const sampleData = [
        ['Shopify', 'poleraazulxl', 'POL-AZ-XL'],
        ['MercadoLibre', '12334456', 'POL-AZ-XL'],
        ['Falabella', 'FAL-POLERA-AZUL', 'POL-AZ-XL'],
        ['Todas', 'poleraazul-general', 'POL-AZ-XL']
      ];
      const wsData = headers.concat(sampleData);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Equivalencias');
      XLSX.writeFile(wb, 'plantilla_equivalencias_sku.xlsx');
    });
  }

  // 1. Guardar plataforma principal
  const btnSaveMain = document.getElementById('btn-save-main-platform');
  const mainSelect = document.getElementById('eq-main-platform-select');
  if (btnSaveMain && mainSelect) {
    const newBtn = btnSaveMain.cloneNode(true);
    btnSaveMain.parentNode.replaceChild(newBtn, btnSaveMain);
    newBtn.addEventListener('click', async () => {
      const selected = mainSelect.value;
      const commerce = window.activeIntegrationCommerce || window.currentUser?.comercio;
      if (!commerce) return;

      newBtn.disabled = true;
      newBtn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Guardando...`;

      try {
        // Primero quitar is_main de todas las integraciones de este comercio
        const { error: resetErr } = await supabase
          .from('merchant_integrations')
          .update({ is_main: false })
          .eq('comercio', commerce);

        if (resetErr) throw resetErr;

        if (selected) {
          // Establecer is_main = true para la seleccionada
          const { error: setErr } = await supabase
            .from('merchant_integrations')
            .update({ is_main: true })
            .eq('comercio', commerce)
            .eq('platform', selected);

          if (setErr) throw setErr;
        }

        alert('Plataforma principal actualizada correctamente.');
        window.renderSkuMappings();
      } catch (err) {
        alert('Error al actualizar plataforma principal: ' + err.message);
      } finally {
        newBtn.disabled = false;
        newBtn.innerHTML = `<i class="ri-save-line"></i> Guardar`;
      }
    });
  }

  // 2. Buscador en la matriz
  const searchInput = document.getElementById('eq-matrix-search');
  if (searchInput) {
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);
    newSearchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      if (!window.currentProductsForMatrix) return;

      const filteredProducts = window.currentProductsForMatrix.filter(p => 
        (p.name && p.name.toLowerCase().includes(term)) || 
        (p.sku && p.sku.toLowerCase().includes(term))
      );

      renderMatrixRows(filteredProducts, window.currentSecondaryPlatforms, window.currentMappingsMap);
    });
  }

  // 3. Botón de validación de consistencia
  const btnValidate = document.getElementById('btn-run-consistency-check');
  if (btnValidate) {
    const newBtn = btnValidate.cloneNode(true);
    btnValidate.parentNode.replaceChild(newBtn, btnValidate);
    newBtn.addEventListener('click', async () => {
      const resultsDiv = document.getElementById('eq-consistency-results');
      if (!resultsDiv) return;

      resultsDiv.innerHTML = `<span style="color: var(--color-primary);"><i class="ri-loader-4-line ri-spin"></i> Analizando integraciones activas...</span>`;
      
      try {
        const commerce = window.activeIntegrationCommerce || window.currentUser?.comercio;

        // También podemos obtener productos de 'products' que no tienen 'shopify_product_id' o que pertenecen a las secundarias
        const { data: allProducts, error: prodErr } = await supabase
          .from('products')
          .select('sku, name, raw_shopify_data')
          .eq('comercio', commerce);

        if (prodErr) throw prodErr;

        // Comprobemos si hay inconsistencias.
        const { data: integrations } = await supabase
          .from('merchant_integrations')
          .select('platform, is_main')
          .eq('comercio', commerce)
          .eq('is_main', true)
          .maybeSingle();

        const mainPlatform = integrations ? integrations.platform : null;

        if (!mainPlatform) {
          resultsDiv.innerHTML = `<span style="color: var(--color-warning);"><i class="ri-alert-line"></i> Debe definir una plataforma principal para realizar la validación.</span>`;
          return;
        }

        // Agrupar por SKU y ver si hay duplicados o inconsistencias
        const skuGroups = {};
        allProducts.forEach(p => {
          if (p.sku) {
            if (!skuGroups[p.sku]) skuGroups[p.sku] = [];
            skuGroups[p.sku].push(p.name);
          }
        });

        const inconsistencies = [];
        for (const [sku, names] of Object.entries(skuGroups)) {
          if (names.length > 1) {
            inconsistencies.push({
              sku,
              issue: 'Duplicado en catálogo',
              detail: `Existen ${names.length} variantes/productos con este mismo SKU en el systema WMS: "${names.join(', ')}"`
            });
          }
        }

        // Buscar si hay SKUs mapeados que no existen en productos
        const { data: currentMappings } = await supabase
          .from('sku_equivalences')
          .select('platform_sku, master_sku, platform')
          .eq('comercio', commerce);

        if (currentMappings) {
          const wmsSkus = new Set(allProducts.map(p => p.sku));
          currentMappings.forEach(m => {
            if (!wmsSkus.has(m.master_sku)) {
              inconsistencies.push({
                sku: m.master_sku,
                issue: 'SKU Master huérfano',
                detail: `La equivalencia para la plataforma ${m.platform} (SKU: ${m.platform_sku}) apunta a un SKU Master que no existe en el catálogo.`
              });
            }
          });
        }

        if (inconsistencies.length === 0) {
          resultsDiv.innerHTML = `<div style="color: #10b981; display:flex; align-items:center; gap:0.5rem; font-weight:600;"><i class="ri-checkbox-circle-line" style="font-size:1.25rem;"></i> ¡Todos los SKUs analizados están limpios y consistentes!</div>`;
        } else {
          resultsDiv.innerHTML = `
            <div style="color: var(--color-danger); font-weight:600; margin-bottom: 0.5rem;"><i class="ri-close-circle-line"></i> Se encontraron ${inconsistencies.length} inconsistencias:</div>
            <ul style="padding-left: 1.25rem; margin: 0; display:flex; flex-direction:column; gap:0.5rem;">
              ${inconsistencies.map(inc => `
                <li>
                  <strong style="font-family:monospace; color: var(--color-text-main);">${inc.sku}</strong>: 
                  <span style="color: var(--color-danger);">${inc.issue}</span> - <span style="color: var(--color-text-muted); font-size:0.85rem;">${inc.detail}</span>
                </li>
              `).join('')}
            </ul>
          `;
        }

      } catch (err) {
        console.error(err);
        resultsDiv.innerHTML = `<span style="color: var(--color-danger);"><i class="ri-error-warning-line"></i> Error al realizar validación: ${err.message}</span>`;
      }
    });
  }

  // 4. Configurar importación de Excel con Vista Previa
  const importInput = document.getElementById('eq-matrix-import-excel');
  if (importInput) {
    const newImportInput = importInput.cloneNode(true);
    importInput.parentNode.replaceChild(newImportInput, importInput);
    newImportInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet);

          if (rows.length === 0) {
            alert('El archivo Excel está vacío.');
            return;
          }

          // Identificar columnas
          const sample = rows[0];
          let colPlatform = '';
          let colPlatformSku = '';
          let colMasterSku = '';

          for (const key of Object.keys(sample)) {
            const lower = key.toLowerCase().trim();
            if (lower === 'plataforma' || lower === 'platform') colPlatform = key;
            else if (lower === 'sku plataforma' || lower === 'platform_sku' || lower === 'sku_plataforma' || lower === 'sku externo') colPlatformSku = key;
            else if (lower === 'sku master' || lower === 'master_sku' || lower === 'sku_master' || lower === 'sku wms' || lower === 'sku maestro') colMasterSku = key;
          }

          if (!colPlatformSku || !colMasterSku) {
            alert('Error: Columnas no encontradas. Asegúrate de que el archivo tenga "SKU Plataforma" y "SKU Master" como columnas.');
            return;
          }

          const commerce = window.activeIntegrationCommerce || window.currentUser?.comercio;

          // Obtener lista de SKUs válidos del catálogo para validar
          const { data: validProducts } = await supabase
            .from('products')
            .select('sku')
            .eq('comercio', commerce);
          
          const validSkus = new Set((validProducts || []).map(p => p.sku));

          const previewData = [];
          const allowedPlatforms = ['Todas', 'Shopify', 'MercadoLibre', 'Falabella', 'Paris', 'WooCommerce', 'Jumpseller'];

          rows.forEach((r) => {
            let platformVal = colPlatform ? r[colPlatform] : 'Todas';
            if (platformVal) {
              platformVal = platformVal.toString().trim();
              const matched = allowedPlatforms.find(ap => ap.toLowerCase() === platformVal.toLowerCase());
              platformVal = matched || 'Todas';
            } else {
              platformVal = 'Todas';
            }

            const platformSkuVal = r[colPlatformSku] ? r[colPlatformSku].toString().trim().replace(/\s+/g, '') : '';
            const masterSkuVal = r[colMasterSku] ? r[colMasterSku].toString().trim() : '';

            let status = 'Válido';
            let statusColor = '#10b981';
            let isValid = true;

            if (!platformSkuVal || !masterSkuVal) {
              status = 'Faltan datos (SKU)';
              statusColor = '#f59e0b';
              isValid = false;
            } else if (!validSkus.has(masterSkuVal)) {
              status = 'SKU Master no existe en Catálogo WMS';
              statusColor = '#ef4444';
              isValid = false;
            }

            previewData.push({
              platform: platformVal,
              platform_sku: platformSkuVal,
              master_sku: masterSkuVal,
              status,
              statusColor,
              isValid
            });
          });

          // Mostrar la modal de vista previa
          showImportPreviewModal(previewData);

        } catch (error) {
          console.error(error);
          alert('Error al leer el archivo Excel: ' + error.message);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }
}

function showImportPreviewModal(previewData) {
  let modal = document.getElementById('modal-eq-preview');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-eq-preview';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 850px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; padding: 0; background: var(--color-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl);">
      <div class="modal-header" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background-color: var(--color-bg); border-radius: var(--radius-lg) var(--radius-lg) 0 0;">
        <h3 style="margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text-main);">
          <i class="ri-file-excel-2-line" style="color: #10b981; margin-right: 0.5rem;"></i> Vista Previa de Importación
        </h3>
        <button class="modal-close" onclick="document.getElementById('modal-eq-preview').classList.remove('active')" style="background:none; border:none; font-size: 1.5rem; cursor:pointer; color: var(--color-text-muted);">&times;</button>
      </div>
      <div class="modal-body" style="flex: 1; padding: 1.5rem; overflow-y: auto;">
        <p style="margin-top: 0; margin-bottom: 1rem; font-size: 0.9rem; color: var(--color-text-muted);">
          Se procesaron <strong>${previewData.length}</strong> registros de tu planilla. Revisa el estado antes de confirmar.
        </p>
        <table class="data-table" style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border); background: var(--color-bg);">
              <th style="padding: 0.75rem; font-size: 0.85rem; color: var(--color-text-main);">Plataforma</th>
              <th style="padding: 0.75rem; font-size: 0.85rem; color: var(--color-text-main);">SKU Plataforma</th>
              <th style="padding: 0.75rem; font-size: 0.85rem; color: var(--color-text-main);">SKU Master</th>
              <th style="padding: 0.75rem; font-size: 0.85rem; color: var(--color-text-main);">Estado / Diagnóstico</th>
            </tr>
          </thead>
          <tbody>
            ${previewData.map(row => `
              <tr style="border-bottom: 1px solid var(--color-border);">
                <td style="padding: 0.75rem; font-size: 0.875rem;">${row.platform}</td>
                <td style="padding: 0.75rem; font-family: monospace; font-size: 0.875rem;">${row.platform_sku || 'N/A'}</td>
                <td style="padding: 0.75rem; font-family: monospace; font-size: 0.875rem; font-weight: 600; color: var(--color-primary);">${row.master_sku || 'N/A'}</td>
                <td style="padding: 0.75rem; font-size: 0.875rem; font-weight: 500; color: ${row.statusColor};">
                  ${row.status === 'Válido' ? '<i class="ri-checkbox-circle-line"></i> Válido' : `<i class="ri-error-warning-line"></i> ${row.status}`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer" style="padding: 1.25rem 1.5rem; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 1rem; background-color: var(--color-bg); border-radius: 0 0 var(--radius-lg) var(--radius-lg);">
        <button class="btn btn-outline" onclick="document.getElementById('modal-eq-preview').classList.remove('active')" style="margin:0;">Cancelar</button>
        <button id="btn-confirm-eq-import" class="btn btn-primary" style="margin:0;" ${previewData.some(r => r.isValid) ? '' : 'disabled'}>
          Confirmar e Importar (${previewData.filter(r => r.isValid).length} válidos)
        </button>
      </div>
    </div>
  `;

  modal.classList.add('active');

  const btnConfirm = document.getElementById('btn-confirm-eq-import');
  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      btnConfirm.disabled = true;
      btnConfirm.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Importando...`;

      const validRows = previewData.filter(r => r.isValid).map(r => ({
        comercio: window.activeIntegrationCommerce || window.currentUser?.comercio,
        platform: r.platform,
        platform_sku: r.platform_sku,
        master_sku: r.master_sku
      }));

      try {
        const { error } = await supabase
          .from('sku_equivalences')
          .upsert(validRows, { onConflict: 'comercio,platform,platform_sku' });

        if (error) throw error;

        alert(`Se han importado exitosamente ${validRows.length} equivalencias.`);
        modal.classList.remove('active');
        window.renderSkuMappings();
      } catch (err) {
        alert('Error al realizar la importación masiva: ' + err.message);
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = `Confirmar e Importar`;
      }
    });
  }
}

window.getDeadlineBadgeHtml = function(fechaLimiteStr, pagoStatus) {
  if (!fechaLimiteStr) return '';
  if (pagoStatus === 'Recibido' || pagoStatus === 'aprobado' || pagoStatus === 'Sin movimientos') return '';
  
  const limitDate = new Date(fechaLimiteStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  limitDate.setHours(0, 0, 0, 0);
  
  const diffTime = limitDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    const days = Math.abs(diffDays);
    return `<div class="deadline-badge deadline-overdue" style="margin-top: 0.35rem; font-size: 0.7rem; font-weight: 700; color: var(--color-danger); display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(239, 68, 68, 0.1); padding: 0.15rem 0.4rem; border-radius: 4px;">
      <i class="ri-error-warning-line"></i> Venció hace ${days} ${days === 1 ? 'día' : 'días'}
    </div>`;
  } else if (diffDays === 0) {
    return `<div class="deadline-badge deadline-today" style="margin-top: 0.35rem; font-size: 0.7rem; font-weight: 700; color: #d97706; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(217, 119, 6, 0.1); padding: 0.15rem 0.4rem; border-radius: 4px;">
      <i class="ri-time-line"></i> Vence hoy
    </div>`;
  } else {
    return `<div class="deadline-badge deadline-upcoming" style="margin-top: 0.35rem; font-size: 0.7rem; font-weight: 700; color: var(--color-primary); display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(59, 130, 246, 0.1); padding: 0.15rem 0.4rem; border-radius: 4px;">
      <i class="ri-calendar-todo-line"></i> Vence en ${diffDays} ${diffDays === 1 ? 'día' : 'días'}
    </div>`;
  }
};

window.updateClientOrdersBulkSelection = function() {
  const checkboxes = document.querySelectorAll('.order-select-checkbox:checked');
  const bulkBar = document.getElementById('client-orders-bulk-actions');
  const countEl = document.getElementById('selected-orders-count');
  
  if (checkboxes.length > 0) {
    if (bulkBar) bulkBar.style.display = 'flex';
    if (countEl) countEl.textContent = checkboxes.length;
  } else {
    if (bulkBar) bulkBar.style.display = 'none';
  }
};

window.toggleSelectAllClientOrders = function(checked) {
  const checkboxes = document.querySelectorAll('.order-select-checkbox');
  checkboxes.forEach(cb => cb.checked = checked);
  window.updateClientOrdersBulkSelection();
};

window.exportShopifyOrdersCsv = function(selectedOrderIds) {
  const allOrders = window.clientLoadedOrders || [];
  const selectedOrders = allOrders.filter(o => selectedOrderIds.includes(o.id));
  
  if (selectedOrders.length === 0) {
    alert("No hay pedidos seleccionados.");
    return;
  }
  
  // Ordenar de forma cronológica ascendente (el más antiguo primero)
  selectedOrders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  const shopifyHeaders = [
    "Name", "Email", "Financial Status", "Paid at", "Fulfillment Status", "Fulfilled at", 
    "Accepts Marketing", "Currency", "Subtotal", "Shipping", "Taxes", "Total", 
    "Discount Code", "Discount Amount", "Shipping Method", "Created at", 
    "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem compare at price", 
    "Lineitem sku", "Lineitem requires shipping", "Lineitem taxable", "Lineitem fulfillment status", 
    "Billing Name", "Billing Street", "Billing Address1", "Billing Address2", "Billing Company", 
    "Billing City", "Billing Zip", "Billing Province", "Billing Country", "Billing Phone", 
    "Shipping Name", "Shipping Street", "Shipping Address1", "Shipping Address2", "Shipping Company", 
    "Shipping City", "Shipping Zip", "Shipping Province", "Shipping Country", "Shipping Phone", 
    "Notes", "Note Attributes", "Cancelled at", "Payment Method", "Payment Reference", 
    "Refunded Amount", "Vendor", "Outstanding Balance", "Employee", "Location", 
    "Device ID", "Id", "Tags", "Risk Level", "Source", "Lineitem discount", 
    "Tax 1 Name", "Tax 1 Value", "Tax 2 Name", "Tax 2 Value", "Tax 3 Name", "Tax 3 Value", 
    "Tax 4 Name", "Tax 4 Value", "Tax 5 Name", "Tax 5 Value", "Phone", "Receipt Number", 
    "Duties", "Billing Province Name", "Shipping Province Name", "Payment ID", 
    "Payment Terms Name", "Next Payment Due At", "Payment References"
  ];
  
  const csvRows = [];
  csvRows.push(shopifyHeaders.join(","));
  
  selectedOrders.forEach(order => {
    const raw = order.raw_shopify_data || {};
    
    // Determinar line items
    let lineItems = [];
    if (raw.line_items && raw.line_items.length > 0) {
      lineItems = raw.line_items;
    } else if (order.order_items && order.order_items.length > 0) {
      lineItems = order.order_items.map(oi => ({
        quantity: oi.quantity || 1,
        title: oi.products?.name || oi.item_name || "Producto sin nombre",
        price: order.total_value ? (Number(order.total_value) / order.order_items.length).toFixed(2) : "0.00",
        sku: oi.products?.sku || oi.sku || "",
        requires_shipping: true,
        taxable: true,
        fulfillment_status: order.estado_wms === 'Despachado' ? 'fulfilled' : null,
        vendor: "WMS STOCKA"
      }));
    } else {
      lineItems = [{
        quantity: order.cantidad || 1,
        title: order.item || "Producto sin nombre",
        price: order.total_value || "0.00",
        sku: order.sku || "",
        requires_shipping: true,
        taxable: true,
        fulfillment_status: order.estado_wms === 'Despachado' ? 'fulfilled' : null,
        vendor: "WMS STOCKA"
      }];
    }
    
    // Mapear shipping / billing details de raw o fallback de WMS
    const shippingName = raw.shipping_address ? `${raw.shipping_address.first_name || ''} ${raw.shipping_address.last_name || ''}`.trim() : (order.customer_name || "");
    const shippingAddr1 = raw.shipping_address?.address1 || (order.shipping_address || "");
    const shippingAddr2 = raw.shipping_address?.address2 || (order.shipping_complement || "");
    const shippingCompany = raw.shipping_address?.company || "";
    const shippingCity = raw.shipping_address?.city || (order.shipping_city || "");
    const shippingZip = raw.shipping_address?.zip || "";
    const shippingProvince = raw.shipping_address?.province_code || "";
    const shippingCountry = raw.shipping_address?.country_code || "";
    const shippingPhone = raw.shipping_address?.phone || (order.customer_phone || "");
    
    const billingName = raw.billing_address ? `${raw.billing_address.first_name || ''} ${raw.billing_address.last_name || ''}`.trim() : shippingName;
    const billingAddr1 = raw.billing_address?.address1 || shippingAddr1;
    const billingAddr2 = raw.billing_address?.address2 || shippingAddr2;
    const billingCompany = raw.billing_address?.company || shippingCompany;
    const billingCity = raw.billing_address?.city || shippingCity;
    const billingZip = raw.billing_address?.zip || shippingZip;
    const billingProvince = raw.billing_address?.province_code || shippingProvince;
    const billingCountry = raw.billing_address?.country_code || shippingCountry;
    const billingPhone = raw.billing_address?.phone || shippingPhone;
    
    const orderName = raw.name || order.external_order_number || `#${order.id.split('-')[0]}`;
    const email = raw.email || order.customer_email || "";
    const finStatus = raw.financial_status || (order.payment_status === 'PAID' ? 'paid' : 'pending');
    const fulfillStatus = raw.fulfillment_status || (order.estado_wms === 'Despachado' ? 'fulfilled' : '');
    const paidAt = raw.processed_at || order.created_at;
    const fulfilledAt = order.estado_wms === 'Despachado' ? order.created_at : '';
    const currency = raw.currency || "CLP";
    const subtotal = raw.subtotal_price || (Number(order.total_value) || 0).toFixed(2);
    const shipping = raw.total_shipping_price_set?.shop_money?.amount || "0.00";
    const taxes = raw.total_tax || "0.00";
    const total = raw.total_price || (Number(order.total_value) || 0).toFixed(2);
    const discountCode = raw.discount_codes?.map(dc => dc.code).join(", ") || "";
    const discountAmt = raw.total_discounts || "0.00";
    const shippingMethod = raw.shipping_lines?.map(sl => sl.title).join(", ") || order.shipping_method || "";
    const createdAt = raw.created_at || order.created_at;
    const note = raw.note || "";
    const tags = raw.tags || "";
    const paymentMethod = raw.gateway || "";
    
    lineItems.forEach((item, index) => {
      const rowData = {
        "Name": orderName,
        "Email": index === 0 ? email : "",
        "Financial Status": index === 0 ? finStatus : "",
        "Paid at": index === 0 ? paidAt : "",
        "Fulfillment Status": index === 0 ? fulfillStatus : "",
        "Fulfilled at": index === 0 ? fulfilledAt : "",
        "Accepts Marketing": index === 0 ? "yes" : "",
        "Currency": index === 0 ? currency : "",
        "Subtotal": index === 0 ? subtotal : "",
        "Shipping": index === 0 ? shipping : "",
        "Taxes": index === 0 ? taxes : "",
        "Total": index === 0 ? total : "",
        "Discount Code": index === 0 ? discountCode : "",
        "Discount Amount": index === 0 ? discountAmt : "",
        "Shipping Method": index === 0 ? shippingMethod : "",
        "Created at": index === 0 ? createdAt : "",
        "Lineitem quantity": item.quantity || 1,
        "Lineitem name": item.title || item.name || "",
        "Lineitem price": item.price || "0.00",
        "Lineitem compare at price": "",
        "Lineitem sku": item.sku || "",
        "Lineitem requires shipping": item.requires_shipping !== false ? "true" : "false",
        "Lineitem taxable": item.taxable !== false ? "true" : "false",
        "Lineitem fulfillment status": item.fulfillment_status || "",
        "Billing Name": index === 0 ? billingName : "",
        "Billing Street": index === 0 ? billingAddr1 : "",
        "Billing Address1": index === 0 ? billingAddr1 : "",
        "Billing Address2": index === 0 ? billingAddr2 : "",
        "Billing Company": index === 0 ? billingCompany : "",
        "Billing City": index === 0 ? billingCity : "",
        "Billing Zip": index === 0 ? billingZip : "",
        "Billing Province": index === 0 ? billingProvince : "",
        "Billing Country": index === 0 ? billingCountry : "",
        "Billing Phone": index === 0 ? billingPhone : "",
        "Shipping Name": index === 0 ? shippingName : "",
        "Shipping Street": index === 0 ? shippingAddr1 : "",
        "Shipping Address1": index === 0 ? shippingAddr1 : "",
        "Shipping Address2": index === 0 ? shippingAddr2 : "",
        "Shipping Company": index === 0 ? shippingCompany : "",
        "Shipping City": index === 0 ? shippingCity : "",
        "Shipping Zip": index === 0 ? shippingZip : "",
        "Shipping Province": index === 0 ? shippingProvince : "",
        "Shipping Country": index === 0 ? shippingCountry : "",
        "Shipping Phone": index === 0 ? shippingPhone : "",
        "Notes": index === 0 ? note : "",
        "Note Attributes": "",
        "Cancelled at": index === 0 ? (raw.cancelled_at || "") : "",
        "Payment Method": index === 0 ? paymentMethod : "",
        "Payment Reference": "",
        "Refunded Amount": "0.00",
        "Vendor": item.vendor || "",
        "Outstanding Balance": "0.00",
        "Employee": "",
        "Location": "",
        "Device ID": "",
        "Id": index === 0 ? (raw.id || "") : "",
        "Tags": index === 0 ? tags : "",
        "Risk Level": "low",
        "Source": index === 0 ? (raw.source_name || "web") : "",
        "Lineitem discount": "0.00",
        "Tax 1 Name": "",
        "Tax 1 Value": "",
        "Tax 2 Name": "",
        "Tax 2 Value": "",
        "Tax 3 Name": "",
        "Tax 3 Value": "",
        "Tax 4 Name": "",
        "Tax 4 Value": "",
        "Tax 5 Name": "",
        "Tax 5 Value": "",
        "Phone": index === 0 ? (raw.phone || "") : "",
        "Receipt Number": "",
        "Duties": "",
        "Billing Province Name": "",
        "Shipping Province Name": "",
        "Payment ID": "",
        "Payment Terms Name": "",
        "Next Payment Due At": "",
        "Payment References": ""
      };
      
      const csvRow = shopifyHeaders.map(h => {
        const val = rowData[h] !== undefined ? String(rowData[h]) : "";
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(",");
      csvRows.push(csvRow);
    });
  });
  
  const csvContent = "\ufeff" + csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `shopify_orders_export_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

window.markOrdersAsExported = async function(selectedOrderIds) {
  if (typeof userRole !== 'undefined' && userRole === 'observer') {
    alert('Acceso denegado: El rol de Observador no permite realizar esta acción.');
    return;
  }
  
  try {
    const { error } = await supabase
      .from('orders')
      .update({ shopify_exported: true })
      .in('id', selectedOrderIds);
      
    if (error) throw error;
    
    alert(`Se marcaron ${selectedOrderIds.length} pedidos como exportados.`);
    
    // Desmarcar cabecera general
    const selectAllCb = document.getElementById('select-all-client-orders');
    if (selectAllCb) selectAllCb.checked = false;
    
    renderOrders();
  } catch (err) {
    console.error(err);
    alert('Error al marcar pedidos como exportados: ' + err.message);
  }
};

window.loadClientExtraCharges = async function(periodId) {
  const tbody = document.getElementById('client-extra-charges-table-body');
  if (!tbody) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error("No hay sesión activa");

    const { data: profile } = await supabase
      .from('profiles')
      .select('comercio')
      .eq('id', userId)
      .single();

    let charges = [];
    if (profile && profile.comercio === 'all') {
      const { data, error: cErr } = await supabase
        .from('extra_billing_charges')
        .select('*')
        .order('fecha', { ascending: false });
      if (cErr) throw cErr;
      charges = data || [];
    } else {
      let companyList = [];
      if (profile && profile.comercio) {
        companyList = profile.comercio.split(',').map(c => c.trim()).filter(Boolean);
      }

      if (companyList.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center" style="padding: 2rem; color: var(--color-text-muted);">
              No tienes comercios asociados para ver cobros adicionales.
            </td>
          </tr>
        `;
        return;
      }

      const { data, error: cErr } = await supabase
        .from('extra_billing_charges')
        .select('*')
        .in('comercio', companyList)
        .order('fecha', { ascending: false });
      if (cErr) throw cErr;
      charges = data || [];
    }

    const { data: periods } = await supabase
      .from('billing_periods')
      .select('id, name');
    
    const periodsMap = {};
    if (periods) {
      periods.forEach(p => {
        periodsMap[p.id] = p.name;
      });
    }

    if (!charges || charges.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
            No se registran cobros adicionales ni extraordinarios para tu comercio.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = charges.map(c => {
      const formattedDate = new Date(c.fecha + 'T00:00:00').toLocaleDateString();
      const statusClass = c.status === 'cobrado' ? 'status-active' : 'status-inactive';
      const statusText = c.status === 'cobrado' ? 'Cobrado' : 'Pendiente';
      const statusBadge = `<span class="client-badge ${statusClass}">${statusText}</span>`;
      const periodName = c.status === 'cobrado' ? (periodsMap[c.periodo_id] || 'No especificado') : '-';

      return `
        <tr>
          <td style="vertical-align: middle; color: var(--color-text-muted);">${formattedDate}</td>
          <td style="vertical-align: middle; font-weight: 600; color: var(--color-text-main);">${c.comercio}</td>
          <td style="vertical-align: middle;">${c.detalle}</td>
          <td style="vertical-align: middle; text-align: right; font-weight: 600; color: var(--color-text-main);">${window.formatCLP(c.monto)}</td>
          <td style="vertical-align: middle;">${statusBadge}</td>
          <td style="vertical-align: middle; color: var(--color-text-muted);">${periodName}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading client extra charges:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center" style="padding: 2rem; color: var(--color-danger);">
          Error al consultar cobros adicionales: ${err.message}
        </td>
      </tr>
    `;
  }
};

