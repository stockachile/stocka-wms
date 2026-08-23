/**
 * WMS STOCKA - Centro de Manifiestos
 * Módulo para la creación, filtrado, firma y generación de Manifiestos de Retiro de Carga
 */

(function () {
  const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

  // Helper para obtener el cliente Supabase configurado y autenticado
  function getDb() {
    if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
      return window.supabaseClient;
    }
    if (window.actualSupabase && typeof window.actualSupabase.from === 'function') {
      return window.actualSupabase;
    }
    if (window.supabase && typeof window.supabase.from === 'function') {
      return window.supabase;
    }
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      if (!window._manifestsSupabaseClient) {
        window._manifestsSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
      return window._manifestsSupabaseClient;
    }
    return null;
  }

  // Estado local del módulo
  const state = {
    manifests: [],
    availableOrders: [],
    realCommerces: [],
    selectedOrders: new Map(), // orderId -> { order, packages_count }
    filtersList: {
      search: '',
      commerce: '',
      courier: '',
      dateFrom: '',
      dateTo: '',
      status: ''
    },
    filterOrders: {
      search: '',
      commerce: '',
      courier: '',
      dateFrom: '',
      dateTo: '',
      status: ''
    },
    driverInfo: {
      courier: '',
      driver_name: '',
      driver_rut: '',
      vehicle_info: '',
      license_plate: '',
      warehouse_name: 'Bodega Central Santiago',
      notes: ''
    },
    signatureData: null,
    isDrawing: false,
    isAdmin: false,
    activeViewingManifestId: null
  };

  // Helper para mostrar u ocultar modales con compatibilidad CSS (.active + opacity + pointer-events)
  function showModalElement(modal) {
    if (!modal) return;
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
    modal.classList.add('active');
  }

  function hideModalElement(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
    modal.style.display = 'none';
  }

  // Helper para notificaciones tipo Toast/Alert/SweetAlert
  function showNotification(message, type = 'info') {
    if (window.showToast) {
      window.showToast(message, type);
    } else if (window.Swal) {
      window.Swal.fire({
        icon: type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'info',
        title: 'Manifiestos',
        text: message,
        timer: 2500,
        showConfirmButton: false
      });
    } else {
      alert(`${type.toUpperCase()}: ${message}`);
    }
  }

  // Cargar comercios reales de la plataforma desde Supabase (profiles y envios_unificados)
  async function fetchRealCommerces() {
    const commercesSet = new Set();
    const db = getDb();

    try {
      if (db) {
        // Query 1: perfiles de usuarios/comercios reales
        const { data: profiles, error: pErr } = await db
          .from('profiles')
          .select('comercio, company_name')
          .neq('role', 'admin');

        if (!pErr && profiles) {
          profiles.forEach(p => {
            if (p.comercio) {
              p.comercio.split(',').forEach(c => {
                const trimmed = c.trim();
                if (trimmed && trimmed.toLowerCase() !== 'no asignado' && trimmed.toLowerCase() !== 'all') {
                  commercesSet.add(trimmed);
                }
              });
            }
            if (p.company_name && p.company_name.trim()) {
              const compTrimmed = p.company_name.trim();
              if (compTrimmed.toLowerCase() !== 'no asignado' && compTrimmed.toLowerCase() !== 'all') {
                commercesSet.add(compTrimmed);
              }
            }
          });
        }

        // Query 2: comercios desde tabla de configuración de comercios si existe
        const { data: configs } = await db
          .from('comercios_adicional_config')
          .select('comercio');

        if (configs) {
          configs.forEach(c => {
            if (c.comercio && c.comercio.trim()) {
              commercesSet.add(c.comercio.trim());
            }
          });
        }
      }
    } catch (e) {
      console.warn('[Manifiestos] Error consultando comercios reales de Supabase:', e);
    }

    state.realCommerces = Array.from(commercesSet).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    return state.realCommerces;
  }

  // Carga inicial de manifiestos desde Supabase con fallback en localStorage
  async function loadManifests() {
    const db = getDb();
    try {
      if (db) {
        const { data, error } = await db
          .from('manifests')
          .select('*, manifest_items(*)')
          .order('created_at', { ascending: false });

        if (!error && data) {
          state.manifests = data;
          saveManifestsLocalFallback(data);
          return data;
        }
      }
    } catch (err) {
      console.warn('[Manifiestos] Fallback local para manifiestos:', err);
    }

    const local = localStorage.getItem('wms_manifests_local');
    state.manifests = local ? JSON.parse(local) : [];
    return state.manifests;
  }

  function saveManifestsLocalFallback(manifests) {
    try {
      localStorage.setItem('wms_manifests_local', JSON.stringify(manifests));
    } catch (e) {
      console.error('[Manifiestos] Error guardando fallback local:', e);
    }
  }

  // Generar un código correlativo único para nuevos manifiestos
  function generateManifestCode() {
    const year = new Date().getFullYear();
    const count = state.manifests.length + 1;
    const seq = String(count).padStart(5, '0');
    return `MNF-${year}-${seq}`;
  }

  // Cargar pedidos elegibles para selección (excluyendo estado despachado y entregado)
  async function fetchEligibleOrders(filters = {}) {
    let orders = [];
    const db = getDb();

    try {
      if (db) {
        // 1. Consultar envios_unificados
        let query = db
          .from('envios_unificados')
          .select('*')
          .neq('global_status', 'DESPACHADO')
          .order('created_at', { ascending: false })
          .limit(300);

        if (filters.commerce) {
          query = query.ilike('empresa_comercio_proveedor', `%${filters.commerce.trim()}%`);
        }
        if (filters.courier) {
          query = query.ilike('courier', `%${filters.courier.trim()}%`);
        }
        if (filters.dateFrom) {
          query = query.gte('created_at', filters.dateFrom + 'T00:00:00Z');
        }
        if (filters.dateTo) {
          query = query.lte('created_at', filters.dateTo + 'T23:59:59Z');
        }

        const { data, error } = await query;
        if (!error && data && Array.isArray(data)) {
          orders = data;
        }

        // 2. Si envios_unificados no devuelve nada o pocos registros, consultar tabla orders
        if (orders.length === 0) {
          let ordQuery = db
            .from('orders')
            .select('*')
            .neq('status', 'despachado')
            .order('created_at', { ascending: false })
            .limit(200);

          if (filters.commerce) {
            ordQuery = ordQuery.ilike('comercio', `%${filters.commerce.trim()}%`);
          }
          if (filters.courier) {
            ordQuery = ordQuery.ilike('courier', `%${filters.courier.trim()}%`);
          }

          const { data: ordData, error: ordErr } = await ordQuery;
          if (!ordErr && ordData && Array.isArray(ordData)) {
            const mappedOrders = ordData.map(o => ({
              id: o.id,
              pedido_referencia: o.external_order_number || o.id,
              tracking: o.tracking_number || '',
              courier: o.courier || 'Por Asignar',
              empresa_comercio_proveedor: o.comercio || 'Sin Comercio',
              nombre_destinatario: o.customer_name || 'Cliente',
              comuna_destino: o.shipping_city || '',
              direccion_destino: o.shipping_address || '',
              status: o.status || 'Preparado',
              global_status: o.status === 'despachado' ? 'DESPACHADO' : 'SIN MOVIMIENTO',
              items_str: o.sku ? `${o.cantidad || 1}x ${o.sku} (${o.item || ''})` : (o.item || 'Producto')
            }));
            orders = [...orders, ...mappedOrders];
          }
        }
      }
    } catch (e) {
      console.warn('[Manifiestos] Error consultando pedidos en Supabase:', e);
    }

    // Filtrar estrictamente excluyendo pedidos que ya estén despachados o entregados
    orders = orders.filter(o => {
      if (o.global_status && o.global_status.toUpperCase() === 'DESPACHADO') return false;
      const st = (o.status || '').toLowerCase();
      if (st.includes('despachad') || st.includes('entregad') || st === 'delivered' || st === 'cancelado') return false;
      return true;
    });

    // Filtrar por comercio seleccionado
    if (filters.commerce) {
      const commTerm = filters.commerce.toLowerCase().trim();
      orders = orders.filter(o => {
        const commName = (o.empresa_comercio_proveedor || o.comercio || '').toLowerCase();
        return commName.includes(commTerm);
      });
    }

    // Filtrar por courier si aplica
    if (filters.courier) {
      const courTerm = filters.courier.toLowerCase().trim();
      orders = orders.filter(o => o.courier && o.courier.toLowerCase().includes(courTerm));
    }

    // Filtrar localmente por texto de búsqueda si aplica
    if (filters.search) {
      const term = filters.search.toLowerCase().trim();
      orders = orders.filter(o =>
        (o.pedido_referencia && o.pedido_referencia.toLowerCase().includes(term)) ||
        (o.tracking && o.tracking.toLowerCase().includes(term)) ||
        (o.nombre_destinatario && o.nombre_destinatario.toLowerCase().includes(term)) ||
        (o.empresa_comercio_proveedor && o.empresa_comercio_proveedor.toLowerCase().includes(term)) ||
        (o.comuna_destino && o.comuna_destino.toLowerCase().includes(term))
      );
    }

    return orders;
  }

  // Extraer lista única de comercios reales y couriers para selectores
  function getUniqueFilterOptions() {
    const commerceSet = new Set(['TODOS']);
    const courierSet = new Set(['TODOS', 'Starken', 'Blue Express', 'Chilexpress', 'Optiroute', 'Envíame', 'PedidosYa', 'Lightdata']);

    if (state.realCommerces && state.realCommerces.length > 0) {
      state.realCommerces.forEach(c => commerceSet.add(c));
    }

    state.manifests.forEach(m => {
      if (m.courier) courierSet.add(m.courier);
      if (m.merchant_name && m.merchant_name !== 'MÚLTIPLES COMERCIOS' && m.merchant_name !== 'TODOS') {
        commerceSet.add(m.merchant_name);
      }
    });

    state.availableOrders.forEach(o => {
      if (o.courier) courierSet.add(o.courier);
      if (o.empresa_comercio_proveedor) commerceSet.add(o.empresa_comercio_proveedor);
    });

    return {
      commerces: Array.from(commerceSet),
      couriers: Array.from(courierSet)
    };
  }

  // ==========================================
  // RENDERIZADO PRINCIPAL DEL MÓDULO
  // ==========================================

  window.renderManifestsAdmin = async function () {
    state.isAdmin = true;
    await renderManifestsView();
  };

  window.renderManifestsClient = async function () {
    state.isAdmin = false;
    await renderManifestsView();
  };

  async function renderManifestsView() {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    appContent.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 200px;">
        <i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: var(--color-primary);"></i>
        <span style="margin-left: 0.75rem; font-weight: 500;">Cargando Centro de Manifiestos...</span>
      </div>
    `;

    await loadManifests();
    await fetchRealCommerces();
    state.availableOrders = await fetchEligibleOrders(state.filterOrders);
    const filterOptions = getUniqueFilterOptions();

    // Calcular Estadísticas Rápidas
    const todayStr = new Date().toISOString().split('T')[0];
    const totalToday = state.manifests.filter(m => m.created_at && m.created_at.startsWith(todayStr)).length;
    const totalOrdersDesp = state.manifests.reduce((sum, m) => sum + (m.total_orders || 0), 0);
    const totalPackagesDesp = state.manifests.reduce((sum, m) => sum + (m.total_packages || 0), 0);

    const html = `
      <div class="manifests-module-container">
        <!-- Encabezado y Acciones -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h2 style="font-size: 1.4rem; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-file-paper-2-line" style="color: var(--color-primary);"></i> Centro de Manifiestos
            </h2>
            <p style="color: var(--color-text-muted); margin: 0.2rem 0 0 0; font-size: 0.85rem;">
              Gestión, firma y emisión de manifiestos de retiro para transportistas y couriers en bodega.
            </p>
          </div>
          <button id="btn-create-manifest" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.2rem; font-weight: 600; cursor: pointer;">
            <i class="ri-add-line" style="font-size: 1.1rem;"></i> Crear Nuevo Manifiesto
          </button>
        </div>

        <!-- KPI Cards Summary -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="card" style="padding: 1rem; border-left: 4px solid var(--color-primary);">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Manifiestos Hoy</div>
            <div style="font-size: 1.6rem; font-weight: 700; margin-top: 0.3rem;">${totalToday}</div>
          </div>
          <div class="card" style="padding: 1rem; border-left: 4px solid #10b981;">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Pedidos Manifestados</div>
            <div style="font-size: 1.6rem; font-weight: 700; margin-top: 0.3rem;">${totalOrdersDesp}</div>
          </div>
          <div class="card" style="padding: 1rem; border-left: 4px solid #f59e0b;">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Total Bultos Despachados</div>
            <div style="font-size: 1.6rem; font-weight: 700; margin-top: 0.3rem;">${totalPackagesDesp}</div>
          </div>
          <div class="card" style="padding: 1rem; border-left: 4px solid #6366f1;">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Histórico Manifiestos</div>
            <div style="font-size: 1.6rem; font-weight: 700; margin-top: 0.3rem;">${state.manifests.length}</div>
          </div>
        </div>

        <!-- Barra de Filtros -->
        <div class="card" style="padding: 1.2rem; margin-bottom: 1.5rem; background: var(--color-surface);">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; align-items: end;">
            <div>
              <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Buscar</label>
              <input type="text" id="mnf-filter-search" class="form-input" placeholder="Código, Conductor, Patente, Pedido..." value="${state.filtersList.search}">
            </div>
            <div>
              <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Comercio Real</label>
              <select id="mnf-filter-commerce" class="form-input">
                ${filterOptions.commerces.map(c => `<option value="${c === 'TODOS' ? '' : c}" ${state.filtersList.commerce === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Courier / Plataforma</label>
              <select id="mnf-filter-courier" class="form-input">
                ${filterOptions.couriers.map(cr => `<option value="${cr === 'TODOS' ? '' : cr}" ${state.filtersList.courier === cr ? 'selected' : ''}>${cr}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Estado</label>
              <select id="mnf-filter-status" class="form-input">
                <option value="">TODOS</option>
                <option value="Generado">Generado</option>
                <option value="Firmado">Firmado</option>
                <option value="Despachado">Despachado</option>
                <option value="Anulado">Anulado</option>
              </select>
            </div>
            <div>
              <button id="btn-clear-mnf-filters" class="btn btn-outline" style="width: 100%; height: 38px; cursor: pointer;">
                <i class="ri-refresh-line"></i> Limpiar Filtros
              </button>
            </div>
          </div>
        </div>

        <!-- Tabla de Manifiestos -->
        <div class="card" style="padding: 0; overflow: hidden;">
          <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); font-weight: 600; display: flex; justify-content: space-between; align-items: center;">
            <span><i class="ri-list-check" style="color: var(--color-primary); margin-right: 0.4rem;"></i> Historial de Manifiestos Generados</span>
            <span class="badge" style="background: var(--color-bg); color: var(--color-text-main); font-weight: 600;">${getFilteredManifests().length} Manifiestos</span>
          </div>

          <div style="overflow-x: auto;">
            <table class="data-table" style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: var(--color-bg); text-align: left; font-size: 0.8rem; text-transform: uppercase;">
                  <th style="padding: 0.75rem 1rem;">Código</th>
                  <th style="padding: 0.75rem 1rem;">Fecha / Hora</th>
                  <th style="padding: 0.75rem 1rem;">Courier</th>
                  <th style="padding: 0.75rem 1rem;">Conductor</th>
                  <th style="padding: 0.75rem 1rem;">Patente / Vehículo</th>
                  <th style="padding: 0.75rem 1rem;">Comercio</th>
                  <th style="padding: 0.75rem 1rem; text-align: center;">Pedidos</th>
                  <th style="padding: 0.75rem 1rem; text-align: center;">Bultos</th>
                  <th style="padding: 0.75rem 1rem; text-align: center;">Estado</th>
                  <th style="padding: 0.75rem 1rem; text-align: right;">Acciones</th>
                </tr>
              </thead>
              <tbody id="manifests-table-body">
                ${renderManifestRows()}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Modal de Creación de Manifiesto -->
      <div class="modal-overlay" id="modal-create-manifest" style="display: none; opacity: 0; pointer-events: none; z-index: 2500;">
        <div class="modal-content" style="max-width: 950px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; padding: 0; overflow: hidden; border-radius: 12px; background: var(--color-surface);">
          
          <div class="modal-header" style="padding: 1.25rem 1.5rem; background: var(--color-surface); border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin: 0; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-file-add-line" style="color: var(--color-primary);"></i> Crear Nuevo Manifiesto de Retiro
            </h3>
            <button class="modal-close" id="btn-close-create-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>

          <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 1.5rem;">
            
            <!-- Paso 1: Selección de Pedidos y Filtros -->
            <div style="background: var(--color-bg); padding: 1rem; border-radius: 8px; border: 1px solid var(--color-border); margin-bottom: 1.5rem;">
              <h4 style="margin: 0 0 0.8rem 0; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                <span style="background: var(--color-primary); color: white; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem;">1</span>
                Filtrar y Seleccionar Pedidos a Entregar (Pendientes de Salida)
              </h4>
              
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 1rem;">
                <div>
                  <label class="form-label" style="font-size: 0.75rem;">Filtrar Comercio Real</label>
                  <select id="modal-filter-commerce" class="form-input" style="font-size: 0.85rem; padding: 0.4rem;">
                    ${filterOptions.commerces.map(c => `<option value="${c === 'TODOS' ? '' : c}">${c}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size: 0.75rem;">Filtrar Courier / Plataforma</label>
                  <select id="modal-filter-courier" class="form-input" style="font-size: 0.85rem; padding: 0.4rem;">
                    ${filterOptions.couriers.map(cr => `<option value="${cr === 'TODOS' ? '' : cr}">${cr}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size: 0.75rem;">Buscar Pedido / Ref / Tracking</label>
                  <input type="text" id="modal-filter-search" class="form-input" placeholder="Ej: Pedido, tracking, cliente..." style="font-size: 0.85rem; padding: 0.4rem;">
                </div>
              </div>

              <!-- Tabla de Selección de Pedidos -->
              <div style="max-height: 250px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface);">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
                  <thead>
                    <tr style="background: var(--color-bg); position: sticky; top: 0; text-align: left; border-bottom: 1px solid var(--color-border);">
                      <th style="padding: 0.5rem; text-align: center; width: 40px;">
                        <input type="checkbox" id="chk-select-all-orders">
                      </th>
                      <th style="padding: 0.5rem;">Referencia / Tracking</th>
                      <th style="padding: 0.5rem;">Comercio</th>
                      <th style="padding: 0.5rem;">Courier</th>
                      <th style="padding: 0.5rem;">Destinatario / Comuna</th>
                      <th style="padding: 0.5rem; text-align: center; width: 100px;">Nº Bultos</th>
                    </tr>
                  </thead>
                  <tbody id="modal-orders-table-body">
                    ${renderModalOrderRows()}
                  </tbody>
                </table>
              </div>

              <!-- Contador flotante de Selección -->
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem; background: var(--color-surface); padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid var(--color-border);">
                <span style="font-size: 0.85rem; font-weight: 600;" id="selection-summary-text">
                  0 Pedidos Seleccionados | 0 Bultos en Total
                </span>
                <button type="button" id="btn-select-all-visible" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; cursor: pointer;">
                  Seleccionar Visibles
                </button>
              </div>
            </div>

            <!-- Paso 2: Datos del Transportista u Operador -->
            <div style="background: var(--color-bg); padding: 1rem; border-radius: 8px; border: 1px solid var(--color-border); margin-bottom: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.8rem;">
                <h4 style="margin: 0; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                  <span style="background: var(--color-primary); color: white; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem;">2</span>
                  Datos del Operador / Conductor que Retira
                </h4>
                <span style="font-size: 0.75rem; color: var(--color-text-muted); background: var(--color-surface); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--color-border);">
                  <i class="ri-edit-2-line"></i> Si se dejan en blanco, se generarán líneas para rellenar a lápiz
                </span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
                <div>
                  <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Operador Courier / Empresa</label>
                  <input type="text" id="inp-driver-courier" class="form-input" placeholder="Ej: Starken, Blue Express, Chilexpress">
                </div>
                <div>
                  <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Nombre del Conductor</label>
                  <input type="text" id="inp-driver-name" class="form-input" placeholder="Nombre y Apellido (o completar a lápiz)">
                </div>
                <div>
                  <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">RUT / Cédula Conductor</label>
                  <input type="text" id="inp-driver-rut" class="form-input" placeholder="Ej: 15.342.190-8">
                </div>
                <div>
                  <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Patente del Vehículo</label>
                  <input type="text" id="inp-license-plate" class="form-input" placeholder="Ej: HJKL-90 / K-XYZ-88" style="text-transform: uppercase;">
                </div>
                <div>
                  <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Vehículo (Marca / Modelo / Tipo)</label>
                  <input type="text" id="inp-vehicle-info" class="form-input" placeholder="Ej: Furgón Peugeot Partner White">
                </div>
                <div>
                  <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Bodega de Origen</label>
                  <input type="text" id="inp-warehouse-name" class="form-input" value="Bodega Central Santiago">
                </div>
              </div>

              <div style="margin-top: 0.8rem;">
                <label class="form-label" style="font-size: 0.8rem; font-weight: 600;">Observaciones de Salida / Retiro</label>
                <textarea id="inp-manifest-notes" class="form-input" rows="2" placeholder="Ej: Retiro completo de pallets Starken PM, cajas selladas."></textarea>
              </div>
            </div>

            <!-- Paso 3: Firma Digital del Conductor -->
            <div style="background: var(--color-bg); padding: 1rem; border-radius: 8px; border: 1px solid var(--color-border);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <h4 style="margin: 0; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                  <span style="background: var(--color-primary); color: white; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem;">3</span>
                  Firma Digital del Conductor / Operador (Opcional en Pantalla)
                </h4>
                <button type="button" id="btn-clear-signature" class="btn btn-outline" style="padding: 0.2rem 0.6rem; font-size: 0.75rem; cursor: pointer;">
                  <i class="ri-eraser-line"></i> Limpiar Firma
                </button>
              </div>

              <div style="border: 2px dashed var(--color-border); border-radius: 8px; background: white; text-align: center; position: relative;">
                <canvas id="signature-pad" width="600" height="150" style="width: 100%; height: 150px; cursor: crosshair; touch-action: none; display: block;"></canvas>
                <span id="signature-placeholder" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #9ca3af; font-size: 0.85rem; pointer-events: none;">
                  Firme aquí con el mouse o pantalla táctil (o firmar en papel)
                </span>
              </div>
            </div>

          </div>

          <div class="modal-footer" style="padding: 1rem 1.5rem; background: var(--color-surface); border-top: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
            <button type="button" id="btn-cancel-create-manifest" class="btn btn-outline" style="cursor: pointer;">Cancelar</button>
            <button type="button" id="btn-save-manifest" class="btn btn-primary" style="padding: 0.6rem 1.5rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <i class="ri-check-line" style="font-size: 1.1rem;"></i> Generar e Imprimir Manifiesto
            </button>
          </div>

        </div>
      </div>

      <!-- Modal de Vista Previa e Impresión -->
      <div class="modal-overlay" id="modal-view-manifest" style="display: none; opacity: 0; pointer-events: none; z-index: 2600;">
        <div class="modal-content" style="max-width: 900px; width: 95%; max-height: 95vh; display: flex; flex-direction: column; padding: 0; border-radius: 12px; overflow: hidden; background: var(--color-surface);">
          
          <div class="modal-header" style="padding: 0.9rem 1.5rem; background: var(--color-surface); border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <h3 style="margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-printer-line" style="color: var(--color-primary);"></i> Vista Previa del Manifiesto
            </h3>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <button id="btn-trigger-print" class="btn btn-primary" style="font-size: 0.85rem; padding: 0.45rem 0.9rem; display: flex; align-items: center; gap: 0.35rem; cursor: pointer; font-weight: 600;">
                <i class="ri-printer-fill"></i> Imprimir Documento
              </button>
              <button id="btn-print-newtab" class="btn btn-outline" style="font-size: 0.85rem; padding: 0.45rem 0.8rem; display: flex; align-items: center; gap: 0.35rem; cursor: pointer;" title="Abrir en pestaña nueva e imprimir">
                <i class="ri-external-link-line"></i> Abrir en Pestaña
              </button>
              <button class="modal-close" id="btn-close-view-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; margin-left: 0.5rem;">&times;</button>
            </div>
          </div>

          <div class="modal-body" id="printable-manifest-container" style="flex: 1; overflow-y: auto; padding: 1.5rem; background: #64748b;">
            <!-- Render dinámico del documento imprimible A4 -->
          </div>

        </div>
      </div>
    `;

    appContent.innerHTML = html;
    setupEventListeners();
  }

  // Renderizar filas del historial de manifiestos
  function renderManifestRows() {
    const list = getFilteredManifests();
    if (list.length === 0) {
      return `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
            <i class="ri-file-paper-2-line" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
            No se encontraron manifiestos generados.
          </td>
        </tr>
      `;
    }

    return list.map(m => {
      const dateFormatted = m.created_at ? new Date(m.created_at).toLocaleString('es-CL') : '—';
      let statusBadge = '<span class="badge" style="background: #e0e7ff; color: #3730a3;">Generado</span>';
      if (m.status === 'Firmado') statusBadge = '<span class="badge" style="background: #d1fae5; color: #065f46;">Firmado</span>';
      if (m.status === 'Despachado') statusBadge = '<span class="badge" style="background: #dbeafe; color: #1e40af;">Despachado</span>';
      if (m.status === 'Anulado') statusBadge = '<span class="badge" style="background: #fee2e2; color: #991b1b;">Anulado</span>';

      const driverDisplay = m.driver_name ? `${m.driver_name}<br><small style="color: var(--color-text-muted);">RUT: ${m.driver_rut || 'N/I'}</small>` : '<span style="color: var(--color-text-muted); font-style: italic;">Por completar (lápiz)</span>';
      const vehicleDisplay = m.license_plate ? `<strong>${m.license_plate}</strong><br><small style="color: var(--color-text-muted);">${m.vehicle_info || ''}</small>` : '<span style="color: var(--color-text-muted); font-style: italic;">Por completar (lápiz)</span>';

      return `
        <tr style="border-bottom: 1px solid var(--color-border); font-size: 0.88rem;">
          <td style="padding: 0.75rem 1rem; font-weight: 700; color: var(--color-primary);">${m.code}</td>
          <td style="padding: 0.75rem 1rem;">${dateFormatted}</td>
          <td style="padding: 0.75rem 1rem;"><span class="badge" style="background: var(--color-bg); font-weight: 600;">${m.courier || 'General'}</span></td>
          <td style="padding: 0.75rem 1rem; font-weight: 600;">${driverDisplay}</td>
          <td style="padding: 0.75rem 1rem;">${vehicleDisplay}</td>
          <td style="padding: 0.75rem 1rem;">${m.merchant_name || 'MÚLTIPLES'}</td>
          <td style="padding: 0.75rem 1rem; text-align: center; font-weight: 700;">${m.total_orders || 0}</td>
          <td style="padding: 0.75rem 1rem; text-align: center; font-weight: 700; color: var(--color-primary);">${m.total_packages || 0}</td>
          <td style="padding: 0.75rem 1rem; text-align: center;">${statusBadge}</td>
          <td style="padding: 0.75rem 1rem; text-align: right; white-space: nowrap;">
            <button class="btn btn-outline btn-view-mnf" data-id="${m.id}" style="padding: 0.3rem 0.6rem; font-size: 0.78rem; cursor: pointer; margin-right: 0.3rem;" title="Ver Documento">
              <i class="ri-eye-line"></i> Ver
            </button>
            <button class="btn btn-primary btn-direct-print-mnf" data-id="${m.id}" style="padding: 0.3rem 0.6rem; font-size: 0.78rem; cursor: pointer;" title="Imprimir Directamente">
              <i class="ri-printer-line"></i> Imprimir
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Filtrar lista de manifiestos
  function getFilteredManifests() {
    let list = state.manifests;
    const { search, commerce, courier, status } = state.filtersList;

    if (search) {
      const term = search.toLowerCase().trim();
      list = list.filter(m =>
        (m.code && m.code.toLowerCase().includes(term)) ||
        (m.driver_name && m.driver_name.toLowerCase().includes(term)) ||
        (m.license_plate && m.license_plate.toLowerCase().includes(term)) ||
        (m.courier && m.courier.toLowerCase().includes(term))
      );
    }
    if (commerce) {
      list = list.filter(m => m.merchant_name === commerce);
    }
    if (courier) {
      list = list.filter(m => m.courier === courier);
    }
    if (status) {
      list = list.filter(m => m.status === status);
    }

    return list;
  }

  // Renderizar filas de selección de pedidos en el Modal
  function renderModalOrderRows() {
    if (!state.availableOrders || state.availableOrders.length === 0) {
      const selectedCommerceName = state.filterOrders.commerce ? `para el comercio "${state.filterOrders.commerce}"` : '';
      return `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
            <i class="ri-inbox-line" style="font-size: 1.8rem; display: block; margin-bottom: 0.4rem; opacity: 0.6;"></i>
            No se encontraron pedidos pendientes de retiro ${selectedCommerceName}.
          </td>
        </tr>
      `;
    }

    return state.availableOrders.map(o => {
      const isChecked = state.selectedOrders.has(o.id);
      const pkgCount = isChecked ? state.selectedOrders.get(o.id).packages_count : 1;

      return `
        <tr style="border-bottom: 1px solid var(--color-border); ${isChecked ? 'background: rgba(99, 102, 241, 0.05);' : ''}">
          <td style="padding: 0.5rem; text-align: center;">
            <input type="checkbox" class="chk-order-item" data-id="${o.id}" ${isChecked ? 'checked' : ''}>
          </td>
          <td style="padding: 0.5rem;">
            <strong style="color: var(--color-primary);">${o.pedido_referencia || o.id}</strong>
            ${o.tracking ? `<br><small style="color: var(--color-text-muted);">Trk: ${o.tracking}</small>` : ''}
          </td>
          <td style="padding: 0.5rem; font-weight: 500;">${o.empresa_comercio_proveedor || o.comercio || 'Sin Comercio'}</td>
          <td style="padding: 0.5rem;"><span class="badge" style="font-size: 0.75rem;">${o.courier || 'N/A'}</span></td>
          <td style="padding: 0.5rem;">
            ${o.nombre_destinatario || 'Cliente'}
            <br><small style="color: var(--color-text-muted);">${o.comuna_destino || ''}</small>
          </td>
          <td style="padding: 0.5rem; text-align: center;">
            <input type="number" class="inp-order-packages form-input" data-id="${o.id}" min="1" value="${pkgCount}" style="width: 65px; padding: 0.2rem; text-align: center; font-size: 0.85rem;">
          </td>
        </tr>
      `;
    }).join('');
  }

  // Actualizar resumen dinámico de bultos y pedidos seleccionados
  function updateSelectionSummary() {
    const count = state.selectedOrders.size;
    let totalPackages = 0;

    state.selectedOrders.forEach(val => {
      totalPackages += parseInt(val.packages_count || 1, 10);
    });

    const label = document.getElementById('selection-summary-text');
    if (label) {
      label.textContent = `${count} Pedidos Seleccionados | ${totalPackages} Bultos en Total`;
    }
  }

  // ==========================================
  // EVENT LISTENERS & LOGIC DE NEGOCIO
  // ==========================================

  function setupEventListeners() {
    // Delegación global en Document para botones principales
    document.removeEventListener('click', handleGlobalClick);
    document.addEventListener('click', handleGlobalClick);

    // Filtros de Lista Principal
    const inpSearch = document.getElementById('mnf-filter-search');
    if (inpSearch) {
      inpSearch.addEventListener('input', (e) => {
        state.filtersList.search = e.target.value;
        refreshTableBody();
      });
    }

    const selCommerce = document.getElementById('mnf-filter-commerce');
    if (selCommerce) {
      selCommerce.addEventListener('change', (e) => {
        state.filtersList.commerce = e.target.value;
        refreshTableBody();
      });
    }

    const selCourier = document.getElementById('mnf-filter-courier');
    if (selCourier) {
      selCourier.addEventListener('change', (e) => {
        state.filtersList.courier = e.target.value;
        refreshTableBody();
      });
    }

    const selStatus = document.getElementById('mnf-filter-status');
    if (selStatus) {
      selStatus.addEventListener('change', (e) => {
        state.filtersList.status = e.target.value;
        refreshTableBody();
      });
    }

    const btnClear = document.getElementById('btn-clear-mnf-filters');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        state.filtersList = { search: '', commerce: '', courier: '', dateFrom: '', dateTo: '', status: '' };
        if (inpSearch) inpSearch.value = '';
        if (selCommerce) selCommerce.value = '';
        if (selCourier) selCourier.value = '';
        if (selStatus) selStatus.value = '';
        refreshTableBody();
      });
    }
  }

  function handleGlobalClick(e) {
    // 1. Botón Crear Manifiesto
    const btnCreate = e.target.closest('#btn-create-manifest');
    if (btnCreate) {
      state.selectedOrders.clear();
      state.signatureData = null;
      openCreateModal();
      return;
    }

    // 2. Cerrar Modal Creación
    const btnCloseCreate = e.target.closest('#btn-close-create-modal') || e.target.closest('#btn-cancel-create-manifest');
    if (btnCloseCreate) {
      hideModalElement(document.getElementById('modal-create-manifest'));
      return;
    }

    // 3. Guardar Manifiesto
    const btnSave = e.target.closest('#btn-save-manifest');
    if (btnSave) {
      submitNewManifest();
      return;
    }

    // 4. Ver Manifiesto desde tabla
    const btnView = e.target.closest('.btn-view-mnf');
    if (btnView) {
      const id = btnView.getAttribute('data-id');
      openViewModal(id);
      return;
    }

    // 5. Imprimir directo desde tabla
    const btnDirectPrint = e.target.closest('.btn-direct-print-mnf');
    if (btnDirectPrint) {
      const id = btnDirectPrint.getAttribute('data-id');
      printManifestDocument(id, false);
      return;
    }

    // 6. Cerrar Modal Ver
    const btnCloseView = e.target.closest('#btn-close-view-modal');
    if (btnCloseView) {
      hideModalElement(document.getElementById('modal-view-manifest'));
      return;
    }

    // 7. Activar Impresión dentro de Modal
    const btnPrint = e.target.closest('#btn-trigger-print');
    if (btnPrint) {
      if (state.activeViewingManifestId) {
        printManifestDocument(state.activeViewingManifestId, false);
      }
      return;
    }

    // 8. Abrir en pestaña nueva para imprimir
    const btnPrintNewTab = e.target.closest('#btn-print-newtab');
    if (btnPrintNewTab) {
      if (state.activeViewingManifestId) {
        printManifestDocument(state.activeViewingManifestId, true);
      }
      return;
    }
  }

  function refreshTableBody() {
    const tbody = document.getElementById('manifests-table-body');
    if (tbody) {
      tbody.innerHTML = renderManifestRows();
    }
  }

  // ==========================================
  // MODAL CREAR MANIFIESTO & CANVAS DE FIRMA
  // ==========================================

  async function openCreateModal() {
    const modal = document.getElementById('modal-create-manifest');
    if (!modal) return;

    // Asegurar que los comercios reales estén cargados desde Supabase
    await fetchRealCommerces();
    const filterOpts = getUniqueFilterOptions();

    // Actualizar el selector de comercio en el modal con los comercios reales
    const modComm = document.getElementById('modal-filter-commerce');
    if (modComm) {
      modComm.innerHTML = filterOpts.commerces.map(c => `<option value="${c === 'TODOS' ? '' : c}">${c}</option>`).join('');
    }

    showModalElement(modal);
    initSignatureCanvas();

    const modCour = document.getElementById('modal-filter-courier');
    const modSearch = document.getElementById('modal-filter-search');

    const handleFilterChange = async () => {
      state.filterOrders = {
        commerce: modComm ? modComm.value : '',
        courier: modCour ? modCour.value : '',
        search: modSearch ? modSearch.value : ''
      };

      // Si selecciona un courier en el filtro, prellenar operador
      const inpCourier = document.getElementById('inp-driver-courier');
      if (inpCourier && modCour && modCour.value && !inpCourier.value) {
        inpCourier.value = modCour.value;
      }

      state.availableOrders = await fetchEligibleOrders(state.filterOrders);
      const mBody = document.getElementById('modal-orders-table-body');
      if (mBody) mBody.innerHTML = renderModalOrderRows();
      setupModalOrderRowEvents();
    };

    if (modComm) modComm.onchange = handleFilterChange;
    if (modCour) modCour.onchange = handleFilterChange;
    if (modSearch) modSearch.oninput = handleFilterChange;

    // Cargar órdenes iniciales según filtros actuales
    await handleFilterChange();
  }

  function setupModalOrderRowEvents() {
    const tbody = document.getElementById('modal-orders-table-body');
    if (!tbody) return;

    // Checkbox Individual
    tbody.querySelectorAll('.chk-order-item').forEach(chk => {
      chk.onchange = (e) => {
        const id = e.target.getAttribute('data-id');
        const order = state.availableOrders.find(o => o.id === id);
        const pkgInput = tbody.querySelector(`.inp-order-packages[data-id="${id}"]`);
        const pkgCount = pkgInput ? parseInt(pkgInput.value, 10) : 1;

        if (e.target.checked && order) {
          state.selectedOrders.set(id, { order, packages_count: pkgCount });
        } else {
          state.selectedOrders.delete(id);
        }
        updateSelectionSummary();
      };
    });

    // Inputs de Bultos
    tbody.querySelectorAll('.inp-order-packages').forEach(inp => {
      inp.onchange = (e) => {
        const id = e.target.getAttribute('data-id');
        const count = Math.max(1, parseInt(e.target.value, 10) || 1);
        if (state.selectedOrders.has(id)) {
          const item = state.selectedOrders.get(id);
          item.packages_count = count;
          state.selectedOrders.set(id, item);
          updateSelectionSummary();
        }
      };
    });

    // Seleccionar Todos Global
    const chkAll = document.getElementById('chk-select-all-orders');
    if (chkAll) {
      chkAll.onchange = (e) => {
        const isChecked = e.target.checked;
        state.availableOrders.forEach(o => {
          if (isChecked) {
            const pkgInput = tbody.querySelector(`.inp-order-packages[data-id="${o.id}"]`);
            const pkgCount = pkgInput ? parseInt(pkgInput.value, 10) : 1;
            state.selectedOrders.set(o.id, { order: o, packages_count: pkgCount });
          } else {
            state.selectedOrders.delete(o.id);
          }
        });
        tbody.querySelectorAll('.chk-order-item').forEach(c => c.checked = isChecked);
        updateSelectionSummary();
      };
    }

    // Seleccionar Visibles
    const btnSelVis = document.getElementById('btn-select-all-visible');
    if (btnSelVis) {
      btnSelVis.onclick = () => {
        state.availableOrders.forEach(o => {
          const pkgInput = tbody.querySelector(`.inp-order-packages[data-id="${o.id}"]`);
          const pkgCount = pkgInput ? parseInt(pkgInput.value, 10) : 1;
          state.selectedOrders.set(o.id, { order: o, packages_count: pkgCount });
        });
        tbody.querySelectorAll('.chk-order-item').forEach(c => c.checked = true);
        if (chkAll) chkAll.checked = true;
        updateSelectionSummary();
      };
    }
  }

  // Inicializar Canvas de Firma Digital Tactil/Mouse
  function initSignatureCanvas() {
    const canvas = document.getElementById('signature-pad');
    const placeholder = document.getElementById('signature-placeholder');
    const btnClear = document.getElementById('btn-clear-signature');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }

    function startDraw(e) {
      state.isDrawing = true;
      if (placeholder) placeholder.style.display = 'none';
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }

    function draw(e) {
      if (!state.isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    function stopDraw() {
      if (state.isDrawing) {
        state.isDrawing = false;
        state.signatureData = canvas.toDataURL('image/png');
      }
    }

    canvas.onmousedown = startDraw;
    canvas.onmousemove = draw;
    canvas.onmouseup = stopDraw;
    canvas.onmouseleave = stopDraw;

    canvas.ontouchstart = startDraw;
    canvas.ontouchmove = draw;
    canvas.ontouchend = stopDraw;

    if (btnClear) {
      btnClear.onclick = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        state.signatureData = null;
        if (placeholder) placeholder.style.display = 'block';
      };
    }
  }

  // Guardar y Generar Manifiesto (Permite campos de conductor en blanco para completar a lápiz)
  async function submitNewManifest() {
    if (state.selectedOrders.size === 0) {
      showNotification('Debe seleccionar al menos 1 pedido para incluir en el manifiesto.', 'warning');
      return;
    }

    const courierInp = document.getElementById('inp-driver-courier');
    const driverNameInp = document.getElementById('inp-driver-name');
    const driverRutInp = document.getElementById('inp-driver-rut');
    const licensePlateInp = document.getElementById('inp-license-plate');
    const vehicleInfoInp = document.getElementById('inp-vehicle-info');
    const warehouseNameInp = document.getElementById('inp-warehouse-name');
    const notesInp = document.getElementById('inp-manifest-notes');

    const driverName = driverNameInp ? driverNameInp.value.trim() : '';
    const driverRut = driverRutInp ? driverRutInp.value.trim() : '';
    const licensePlate = licensePlateInp ? licensePlateInp.value.trim().toUpperCase() : '';
    const vehicleInfo = vehicleInfoInp ? vehicleInfoInp.value.trim() : '';
    const warehouseName = warehouseNameInp && warehouseNameInp.value.trim() ? warehouseNameInp.value.trim() : 'Bodega Central Santiago';
    const notes = notesInp ? notesInp.value.trim() : '';

    const items = [];
    let totalPackages = 0;
    const merchantsSet = new Set();
    const couriersSet = new Set();

    state.selectedOrders.forEach(({ order, packages_count }) => {
      const pCount = parseInt(packages_count || 1, 10);
      totalPackages += pCount;
      const cName = order.empresa_comercio_proveedor || order.comercio || '';
      if (cName) merchantsSet.add(cName);
      if (order.courier) couriersSet.add(order.courier);

      items.push({
        unified_shipment_id: order.id,
        pedido_referencia: order.pedido_referencia || order.id,
        tracking: order.tracking || '',
        courier: order.courier || (courierInp ? courierInp.value.trim() : 'General'),
        empresa_comercio_proveedor: cName || 'General',
        nombre_destinatario: order.nombre_destinatario || '',
        comuna_destino: order.comuna_destino || '',
        direccion_destino: order.direccion_destino || '',
        packages_count: pCount,
        products_summary: order.items_str || 'Productos Varios'
      });
    });

    const courier = (courierInp && courierInp.value.trim()) 
      ? courierInp.value.trim() 
      : (couriersSet.size === 1 ? Array.from(couriersSet)[0] : (couriersSet.size > 1 ? 'MÚLTIPLES COURIERS' : ''));

    const merchantNameStr = merchantsSet.size === 1 
      ? Array.from(merchantsSet)[0] 
      : (merchantsSet.size > 1 ? 'MÚLTIPLES COMERCIOS' : (state.filterOrders.commerce || 'General'));

    const code = generateManifestCode();

    const newManifest = {
      id: window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'mnf-' + Date.now(),
      code,
      courier: courier || '',
      merchant_name: merchantNameStr,
      driver_name: driverName || '',
      driver_rut: driverRut || '',
      vehicle_info: vehicleInfo || '',
      license_plate: licensePlate || '',
      total_orders: items.length,
      total_packages: totalPackages,
      notes,
      signature_data: state.signatureData,
      status: state.signatureData ? 'Firmado' : 'Generado',
      warehouse_name: warehouseName,
      created_at: new Date().toISOString(),
      manifest_items: items
    };

    // Inserción en Supabase (si está disponible)
    const db = getDb();
    try {
      if (db) {
        const { data: inserted, error: insertErr } = await db
          .from('manifests')
          .insert([{
            code: newManifest.code,
            courier: newManifest.courier || 'Por Asignar',
            merchant_name: newManifest.merchant_name,
            driver_name: newManifest.driver_name || 'Por Completar',
            driver_rut: newManifest.driver_rut || '',
            vehicle_info: newManifest.vehicle_info || '',
            license_plate: newManifest.license_plate || 'S/P',
            total_orders: newManifest.total_orders,
            total_packages: newManifest.total_packages,
            notes: newManifest.notes,
            signature_data: newManifest.signature_data,
            status: newManifest.status,
            warehouse_name: newManifest.warehouse_name
          }])
          .select()
          .single();

        if (!insertErr && inserted) {
          newManifest.id = inserted.id;

          // Insertar ítems
          const dbItems = items.map(it => ({ ...it, manifest_id: inserted.id }));
          await db.from('manifest_items').insert(dbItems);
        }
      }
    } catch (e) {
      console.warn('[Manifiestos] Guardado en Supabase falló, usando local storage:', e);
    }

    state.manifests.unshift(newManifest);
    saveManifestsLocalFallback(state.manifests);

    // Ocultar modal de creación
    hideModalElement(document.getElementById('modal-create-manifest'));

    showNotification(`¡Manifiesto ${code} generado exitosamente!`, 'success');
    refreshTableBody();

    // Abrir vista previa e imprimir inmediatamente
    openViewModal(newManifest.id);
  }

  // ==========================================
  // VISTA PREVIA E IMPRESIÓN DEL MANIFIESTO (A4)
  // ==========================================

  function openViewModal(manifestId) {
    const manifest = state.manifests.find(m => m.id === manifestId);
    if (!manifest) return;

    state.activeViewingManifestId = manifestId;
    const modal = document.getElementById('modal-view-manifest');
    const container = document.getElementById('printable-manifest-container');
    if (!modal || !container) return;

    container.innerHTML = generateDocumentBodyHTML(manifest);
    showModalElement(modal);
  }

  // Genera el documento HTML completo y aislado listo para ser enviado al Iframe / Ventana de Impresión
  function generateStandalonePrintHTML(m) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Manifiesto de Retiro - ${m.code}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1e293b;
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 10pt;
      line-height: 1.35;
    }
    .print-wrapper {
      width: 100%;
      background: #ffffff;
      padding: 0;
    }
    .header-box {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #2563eb;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .brand-title {
      font-size: 18pt;
      font-weight: 900;
      color: #1e3a8a;
      letter-spacing: -0.5px;
      margin: 0;
    }
    .brand-sub {
      font-size: 8.5pt;
      color: #475569;
      font-weight: 600;
      margin-top: 2px;
    }
    .doc-type {
      font-size: 12pt;
      font-weight: 800;
      color: #1d4ed8;
      margin: 0;
    }
    .doc-code {
      font-size: 11pt;
      font-weight: 800;
      color: #0f172a;
      margin-top: 2px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 12px;
      font-size: 8.5pt;
    }
    .info-col {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .section-tag {
      color: #475569;
      font-weight: 700;
      font-size: 7.5pt;
      text-transform: uppercase;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 2px;
      margin-bottom: 2px;
    }
    .kpi-row {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
    }
    .kpi-box {
      flex: 1;
      padding: 6px 12px;
      border-radius: 6px;
      text-align: center;
    }
    .kpi-orders {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
    }
    .kpi-packages {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
    }
    .kpi-label {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .kpi-val {
      font-size: 13pt;
      font-weight: 800;
      margin-top: 1px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
      margin-bottom: 12px;
      page-break-inside: auto;
    }
    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }
    thead {
      display: table-header-group;
    }
    th {
      background: #f1f5f9 !important;
      border-bottom: 2px solid #94a3b8;
      padding: 5px 6px;
      text-align: left;
      font-weight: 700;
      color: #1e293b;
    }
    td {
      border-bottom: 1px solid #e2e8f0;
      padding: 4px 6px;
      vertical-align: middle;
    }
    .handwrite-line {
      border-bottom: 1px solid #475569;
      display: inline-block;
      min-width: 160px;
      height: 14px;
      vertical-align: bottom;
      margin-left: 4px;
    }
  </style>
</head>
<body>
  <div class="print-wrapper">
    ${generateDocumentBodyHTML(m, true)}
  </div>
</body>
</html>`;
  }

  // Genera el bloque visual de contenido del manifiesto
  function generateDocumentBodyHTML(m, isPrintMode = false) {
    const items = m.manifest_items || [];
    const dateFormatted = m.created_at ? new Date(m.created_at).toLocaleString('es-CL') : new Date().toLocaleString('es-CL');

    const renderHandwriteLine = (val, minWidth = '160px') => {
      if (val && val.trim() !== '') {
        return `<strong style="color: #0f172a;">${val}</strong>`;
      }
      return `<span style="border-bottom: 1px solid #475569; display: inline-block; min-width: ${minWidth}; height: 15px; vertical-align: bottom; margin-left: 4px;"></span>`;
    };

    const containerStyle = isPrintMode 
      ? 'width: 100%;' 
      : 'background: white; color: #1f2937; padding: 2.2rem; border-radius: 8px; font-family: "Segoe UI", Arial, sans-serif; max-width: 820px; margin: 0 auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1); line-height: 1.4;';

    return `
      <div style="${containerStyle}">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #2563eb; padding-bottom: 8px; margin-bottom: 12px;">
          <div>
            <div style="font-size: 1.6rem; font-weight: 900; color: #1e3a8a; letter-spacing: -0.5px;">WMS STOCKA</div>
            <div style="font-size: 0.82rem; color: #4b5563; font-weight: 600;">Centro de Operaciones y Logística</div>
            <div style="font-size: 0.78rem; color: #6b7280;">Origen: ${m.warehouse_name || 'Bodega Central Santiago'}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.2rem; font-weight: 800; color: #1d4ed8;">MANIFIESTO DE RETIRO</div>
            <div style="font-size: 1.05rem; font-weight: 800; color: #1f2937; margin-top: 0.2rem;">${m.code}</div>
            <div style="font-size: 0.78rem; color: #6b7280; margin-top: 0.2rem;">Emisión: ${dateFormatted}</div>
          </div>
        </div>

        <!-- Bloque Conductor & Courier (con soporte de llenado manual a lápiz) -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; background: #f8fafc; padding: 0.9rem; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 12px; font-size: 0.83rem;">
          <div style="display: flex; flex-direction: column; gap: 0.4rem;">
            <div style="color: #475569; font-weight: 700; font-size: 0.73rem; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.2rem;">DATOS DEL TRANSPORTISTA</div>
            <div style="margin-top: 0.2rem;"><strong>Operador Courier:</strong> ${renderHandwriteLine(m.courier, '140px')}</div>
            <div><strong>Conductor:</strong> ${renderHandwriteLine(m.driver_name, '180px')}</div>
            <div><strong>RUT / Cédula:</strong> ${renderHandwriteLine(m.driver_rut, '170px')}</div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.4rem;">
            <div style="color: #475569; font-weight: 700; font-size: 0.73rem; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.2rem;">DATOS DEL VEHÍCULO Y CARGA</div>
            <div style="margin-top: 0.2rem;"><strong>Patente Vehículo:</strong> ${renderHandwriteLine(m.license_plate, '150px')}</div>
            <div><strong>Vehículo:</strong> ${renderHandwriteLine(m.vehicle_info, '190px')}</div>
            <div><strong>Comercio(s):</strong> <strong style="color: #1e3a8a;">${m.merchant_name || 'MÚLTIPLES'}</strong></div>
          </div>
        </div>

        <!-- Resumen Cuantitativo -->
        <div style="display: flex; gap: 1rem; margin-bottom: 12px;">
          <div style="flex: 1; background: #eff6ff; border: 1px solid #bfdbfe; padding: 0.55rem; border-radius: 6px; text-align: center;">
            <span style="font-size: 0.72rem; color: #1e40af; font-weight: 700; text-transform: uppercase;">Total Pedidos</span>
            <div style="font-size: 1.3rem; font-weight: 800; color: #1e3a8a;">${m.total_orders}</div>
          </div>
          <div style="flex: 1; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 0.55rem; border-radius: 6px; text-align: center;">
            <span style="font-size: 0.72rem; color: #166534; font-weight: 700; text-transform: uppercase;">Total Bultos / Cajas</span>
            <div style="font-size: 1.3rem; font-weight: 800; color: #14532d;">${m.total_packages}</div>
          </div>
        </div>

        <!-- Tabla Detallada de Pedidos -->
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 700; font-size: 0.84rem; margin-bottom: 0.35rem; color: #1f2937;">DETALLE DE PAQUETES Y PRODUCTOS INCLUIDOS</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left; border-bottom: 2px solid #cbd5e1;">
                <th style="padding: 0.4rem; width: 25px;">#</th>
                <th style="padding: 0.4rem;">Nº Pedido / Tracking</th>
                <th style="padding: 0.4rem;">Comercio</th>
                <th style="padding: 0.4rem;">Destinatario / Comuna</th>
                <th style="padding: 0.4rem; text-align: center; width: 55px;">Bultos</th>
                <th style="padding: 0.4rem;">Detalle Productos</th>
                <th style="padding: 0.4rem; text-align: center; width: 50px;">Recibido</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((it, idx) => `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 0.4rem; font-weight: 600; text-align: center;">${idx + 1}</td>
                  <td style="padding: 0.4rem;">
                    <strong>${it.pedido_referencia}</strong>
                    ${it.tracking ? `<br><span style="color: #64748b; font-size: 0.72rem;">Trk: ${it.tracking}</span>` : ''}
                  </td>
                  <td style="padding: 0.4rem;">${it.empresa_comercio_proveedor || '—'}</td>
                  <td style="padding: 0.4rem;">
                    ${it.nombre_destinatario || 'Cliente'}
                    <br><span style="color: #64748b; font-size: 0.72rem;">${it.comuna_destino || ''}</span>
                  </td>
                  <td style="padding: 0.4rem; text-align: center; font-weight: 700; color: #2563eb;">${it.packages_count || 1}</td>
                  <td style="padding: 0.4rem; font-size: 0.72rem; color: #4b5563;">${it.products_summary || 'Sin detalle'}</td>
                  <td style="padding: 0.4rem; text-align: center; font-size: 0.95rem; color: #64748b;">[ &nbsp; ]</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        ${m.notes ? `
          <div style="background: #fffbebfb; border-left: 3.5px solid #f59e0b; padding: 0.45rem 0.75rem; margin-bottom: 12px; font-size: 0.76rem; color: #92400e;">
            <strong>Observaciones:</strong> ${m.notes}
          </div>
        ` : ''}

        <!-- Declaración y Firmas -->
        <div style="margin-top: 14px; border-top: 1px solid #cbd5e1; padding-top: 0.65rem;">
          <div style="font-size: 0.71rem; color: #64748b; text-align: justify; margin-bottom: 1.2rem;">
            El transportista declara haber recibido a entera conformidad en la bodega de origen la totalidad de los bultos y paquetes consignados en el presente manifiesto, comprometiéndose a su custodia y traslado hacia el destino final acordado.
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 0.8rem;">
            <div style="border-top: 1px dashed #94a3b8; text-align: center; padding-top: 0.45rem;">
              <div style="font-size: 0.82rem; font-weight: 700; color: #1f2937;">Encargado de Bodega (WMS STOCKA)</div>
              <div style="font-size: 0.72rem; color: #64748b; margin-top: 0.2rem;">Firma y Timbre Salida</div>
            </div>

            <div style="border-top: 1px dashed #94a3b8; text-align: center; padding-top: 0.45rem;">
              ${m.signature_data ? `
                <img src="${m.signature_data}" style="max-height: 48px; margin-bottom: 0.2rem;" alt="Firma Conductor">
              ` : '<div style="height: 35px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 0.72rem; font-style: italic;">(Firma manual del conductor)</div>'}
              <div style="font-size: 0.82rem; font-weight: 700; color: #1f2937;">
                ${m.driver_name ? m.driver_name : 'Nombre: _____________________'}
              </div>
              <div style="font-size: 0.72rem; color: #64748b; margin-top: 0.2rem;">
                RUT: ${m.driver_rut ? m.driver_rut : '_____________________'}
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  // Función de impresión limpia y aislada que no depende del DOM de la aplicación ni de modales
  function printManifestDocument(manifestId, openInNewTab = false) {
    const manifest = state.manifests.find(m => m.id === manifestId);
    if (!manifest) {
      showNotification('No se encontró el manifiesto para imprimir.', 'warning');
      return;
    }

    const printableHTML = generateStandalonePrintHTML(manifest);

    // Opción A: Abrir en pestaña nueva si se solicita explícitamente
    if (openInNewTab) {
      const printWin = window.open('', '_blank');
      if (printWin) {
        printWin.document.open();
        printWin.document.write(printableHTML);
        printWin.document.close();
        setTimeout(() => {
          printWin.focus();
          printWin.print();
        }, 300);
        return;
      }
    }

    // Opción B: Impresión directa mediante iframe aislado
    let iframe = document.getElementById('wms-manifest-print-iframe');
    if (iframe) {
      iframe.remove();
    }

    iframe = document.createElement('iframe');
    iframe.id = 'wms-manifest-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-9999';
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow.document || iframe.contentDocument;
    frameDoc.open();
    frameDoc.write(printableHTML);
    frameDoc.close();

    const doPrint = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        console.warn('Iframe print falló, abriendo en ventana:', err);
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(printableHTML);
          win.document.close();
          win.print();
        }
      }
    };

    iframe.onload = () => {
      setTimeout(doPrint, 250);
    };

    setTimeout(doPrint, 500);
  }

})();
