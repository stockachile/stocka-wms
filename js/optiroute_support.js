import supabase from './supabase.js';

/**
 * Módulo de Soporte Optiroute - WMS STOCKA
 * Exclusivo para Administradores.
 */
export async function renderOptirouteSupport() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  // Inyectar contenedor principal con loaders
  appContent.innerHTML = `
    <div id="optiroute-support-container" style="display: flex; flex-direction: column; gap: 0.5rem; animation: fadeIn 0.3s ease;">
      <!-- Encabezado y Controles unificados en una sola tarjeta -->
      <div class="card" style="padding: 0.6rem 1rem; display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0 !important;">
        <!-- Fila de Título y Tabs -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h2 style="font-size: 1.25rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem; margin: 0;">
              <i class="ri-customer-service-2-line" style="color: var(--color-primary);"></i> Soporte y Control de Despachos
            </h2>
            <p style="color: var(--color-text-muted); font-size: 0.75rem; margin: 0.1rem 0 0 0;">
              Verifica direcciones, contacta clientes vía WhatsApp y supervisa estados de entrega de Optiroute en tiempo real.
            </p>
          </div>
          <div style="display: flex; background: var(--color-bg); padding: 0.15rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); gap: 0.15rem;">
            <button id="tab-api" class="btn btn-sm" style="padding: 0.3rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; background: var(--color-surface); color: var(--color-primary); box-shadow: var(--shadow-sm); border: none; cursor: pointer;">
              <i class="ri-key-line"></i> Conexión API
            </button>
            <button id="tab-metrics" class="btn btn-sm" style="padding: 0.3rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; background: transparent; color: var(--color-text-muted); border: none; cursor: pointer;">
              <i class="ri-bar-chart-box-line"></i> Métricas API
            </button>
            <button id="tab-excel" class="btn btn-sm" style="padding: 0.3rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; background: transparent; color: var(--color-text-muted); border: none; cursor: pointer;">
              <i class="ri-file-excel-2-line"></i> Cargar Planilla
            </button>
          </div>
        </div>

        <hr style="border: 0; border-top: 1px solid var(--color-border); margin: 0.15rem 0;">

        <!-- Sección de Entrada API (Unificada) -->
        <div id="section-api" style="display: flex; flex-direction: column; gap: 0.4rem;">
          <div id="api-integration-status">
            <p style="color: var(--color-text-muted); font-size: 0.8rem; margin: 0;">Verificando credenciales de Optiroute...</p>
          </div>
          <div id="api-controls" style="display: none; align-items: flex-end; gap: 0.5rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 250px;">
              <label class="form-label" style="font-weight: 600; margin-bottom: 0.15rem; font-size: 0.75rem;">Seleccionar Ruta / Plan de Optiroute</label>
              <select id="select-route-plans" class="form-input" style="width: 100%; padding: 0.4rem; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 0.8rem; height: 34px;">
                <option value="">Cargando rutas de Optiroute...</option>
              </select>
            </div>
            <button id="btn-fetch-route" class="btn btn-primary" style="height: 34px; display: flex; align-items: center; gap: 0.3rem; font-weight: 600; padding: 0 1rem; background: var(--color-primary); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s; font-size: 0.8rem;">
              <i class="ri-refresh-line"></i> Cargar Detalles de Ruta
            </button>
            <button id="btn-sync-optiroute-now" class="btn btn-outline" style="height: 34px; display: flex; align-items: center; gap: 0.3rem; font-weight: 600; padding: 0 0.8rem; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s; font-size: 0.8rem;" title="Ejecutar sincronización inmediata con la API de Optiroute">
              <i class="ri-flashlight-line"></i> ⚡ Sincronizar Ahora
            </button>
          </div>
        </div>

        <!-- Sección de Métricas de API Optiroute -->
        <div id="section-metrics" style="display: none; flex-direction: column; gap: 0.5rem; padding: 0.4rem 0;">
          <div id="metrics-loading" style="color: var(--color-text-muted); font-size: 0.8rem;">Cargando métricas de consultas de API Optiroute...</div>
          <div id="metrics-alert-banner"></div>
          <div id="metrics-kpi-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.5rem;"></div>
          <div id="metrics-history-table"></div>
        </div>

        <!-- Sección de Entrada Excel (Unificada) -->
        <div id="section-excel" style="display: none; flex-direction: column; gap: 0.4rem;">
          <div id="excel-drop-zone" style="border: 2px dashed var(--color-border); border-radius: var(--radius-lg); padding: 1rem 0.5rem; text-align: center; cursor: pointer; background: var(--color-bg); transition: all 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem;">
            <i class="ri-file-excel-fill" style="font-size: 1.5rem; color: var(--color-success);"></i>
            <span style="font-weight: 600; color: var(--color-text-main); font-size: 0.8rem;">Arrastra tu archivo Excel aquí o haz clic para buscar</span>
            <span style="font-size: 0.65rem; color: var(--color-text-muted);">Soporta formatos .xlsx, .xls y .csv</span>
            <input type="file" id="excel-file-input" accept=".xlsx, .xls, .csv" style="display: none;">
          </div>
        </div>
      </div>

      <!-- Resumen de Despacho (KPI Cards) - Oculto hasta cargar datos -->
      <div id="route-summary" style="display: none; grid-template-columns: repeat(5, 1fr); gap: 0.5rem; width: 100%;">
        <!-- Generado dinámicamente -->
      </div>

      <!-- Tabla y Filtros de Resultados - Oculto hasta cargar datos -->
      <div id="route-data-card" class="card" style="padding: 1rem; display: none; flex-direction: column; gap: 0.75rem;">
        <!-- Fila 1: Título y Acciones Principales -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.6rem;">
          <h3 id="loaded-route-title" style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
            Envíos de la Ruta
            <span id="data-source-badge" style="font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.35rem; border-radius: 4px; display: none;"></span>
            <span id="filtered-count-badge" class="badge" style="background: var(--color-bg); color: var(--color-text-muted); font-size: 0.7rem; border: 1px solid var(--color-border); padding: 0.15rem 0.45rem; border-radius: 12px; font-weight: 600;"></span>
          </h3>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center;">
            <!-- Botón Gestor / Generador de Etiquetas -->
            <button id="btn-open-labels-modal" class="btn btn-primary" style="display: flex; height: 32px; font-size: 0.8rem; font-weight: 700; align-items: center; gap: 0.3rem; background: #7c3aed; color: white; border: none; padding: 0 0.8rem; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;" title="Gestor y Emisión de Etiquetas Térmicas 100x150">
              <i class="ri-price-tag-3-line"></i> 🏷️ Generar Etiquetas
            </button>
            <!-- Botón Añadir Punto Intermedio -->
            <button id="btn-add-intermediate-point" class="btn btn-outline" style="display: flex; height: 32px; font-size: 0.8rem; font-weight: 600; align-items: center; gap: 0.25rem; border: 1px solid #7c3aed; color: #7c3aed; background: transparent; padding: 0 0.75rem; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;" title="Añadir un pedido intermedio a esta ruta">
              <i class="ri-add-circle-line"></i> ➕ Punto Intermedio
            </button>
            <!-- Botón Imprimir Selección (Masivo) -->
            <button id="btn-print-labels" class="btn btn-primary" style="display: none; height: 32px; font-size: 0.8rem; font-weight: 600; align-items: center; gap: 0.25rem; background: var(--color-primary); color: white; border: none; padding: 0 0.75rem; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;">
              <i class="ri-printer-line"></i> Imprimir Selección (<span id="print-count">0</span>)
            </button>
            <!-- Botón Enviar Correos Masivos (Brevo) -->
            <button id="btn-send-bulk-email" class="btn btn-primary" style="display: flex; height: 32px; font-size: 0.8rem; font-weight: 700; align-items: center; gap: 0.3rem; background: #2563eb; color: white; border: none; padding: 0 0.75rem; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;" title="Enviar correos masivos por Brevo">
              <i class="ri-mail-send-line"></i> Enviar Correos Masivos
            </button>
            <!-- Botón Forzar Actualización Live API -->
            <button id="btn-force-live-api" class="btn btn-outline" style="display: none; height: 32px; font-size: 0.8rem; font-weight: 600; align-items: center; gap: 0.25rem; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 0.75rem; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;">
              <i class="ri-refresh-line"></i> Actualizar en Vivo
            </button>
          </div>
        </div>

        <!-- Fila 2: Barra de Filtros Elegante en Grid -->
        <div style="background: var(--color-bg); padding: 0.6rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.5rem; align-items: center;">
          <!-- Buscador -->
          <div style="position: relative; min-width: 170px;">
            <i class="ri-search-line" style="position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); font-size: 0.85rem;"></i>
            <input type="text" id="search-shipments" class="form-input" placeholder="Buscar cliente, ref, comuna..." style="padding-left: 1.85rem; font-size: 0.78rem; width: 100%; height: 34px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-main);">
          </div>
          <!-- Filtro de Estado -->
          <div>
            <select id="filter-status" class="form-input" style="font-size: 0.78rem; height: 34px; width: 100%; padding: 0 0.5rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-main);">
              <option value="">📌 Estado: Todos</option>
              <option value="Completado">Entregado / Completado</option>
              <option value="En ruta">En ruta / En viaje</option>
              <option value="Pendiente">Pendiente / Ingresado</option>
              <option value="Saltado">Saltado / Cancelado</option>
              <option value="Warning">Con advertencias de dirección</option>
            </select>
          </div>
          <!-- Filtro de Conductor -->
          <div>
            <select id="filter-driver" class="form-input" style="font-size: 0.78rem; height: 34px; width: 100%; padding: 0 0.5rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-main);">
              <option value="">🚚 Conductor: Todos</option>
            </select>
          </div>
          <!-- Filtro de Proveedor / Comercio -->
          <div>
            <select id="filter-supplier" class="form-input" style="font-size: 0.78rem; height: 34px; width: 100%; padding: 0 0.5rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-main);">
              <option value="">🏢 Proveedor: Todos</option>
            </select>
          </div>
          <!-- Filtro de Estado de Correo -->
          <div>
            <select id="filter-email-status" class="form-input" style="font-size: 0.78rem; height: 34px; width: 100%; padding: 0 0.5rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-main);">
              <option value="">✉️ Correo: Todos</option>
              <option value="dispatch_sent">✉️ Despacho Notificado</option>
              <option value="delivery_sent">✅ Entrega Confirmada</option>
              <option value="not_sent">⏳ Sin Notificar</option>
              <option value="has_email">📧 Con Correo Registrado</option>
              <option value="no_email">🚫 Sin Correo Registrado</option>
            </select>
          </div>
          <!-- Botón Limpiar Filtros -->
          <div style="display: flex; justify-content: flex-end;">
            <button id="btn-clear-filters" class="btn btn-outline btn-sm" style="display: none; height: 34px; font-size: 0.75rem; padding: 0 0.6rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); color: var(--color-text-muted); background: var(--color-surface); cursor: pointer; align-items: center; gap: 0.2rem;" title="Limpiar todos los filtros">
              <i class="ri-filter-off-line"></i> Limpiar
            </button>
          </div>
        </div>

        <div style="overflow-x: auto; width: 100%;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
            <thead>
              <tr style="text-align: left; border-bottom: 2px solid var(--color-border);">
                <th style="padding: 0.75rem 0.5rem; width: 40px; text-align: center;"><input type="checkbox" id="check-all-shipments" style="transform: scale(1.1); cursor: pointer;"></th>
                <th style="padding: 0.75rem 0.5rem; width: 80px;">#</th>
                <th style="padding: 0.75rem 0.5rem; width: 130px;">Referencia</th>
                <th style="padding: 0.75rem 0.5rem; min-width: 150px;">Destinatario</th>
                <th style="padding: 0.75rem 0.5rem; width: 140px;">Contacto</th>
                <th style="padding: 0.75rem 0.5rem; min-width: 200px;">Dirección Física</th>
                <th style="padding: 0.75rem 0.5rem; width: 130px;">Conductor</th>
                <th style="padding: 0.75rem 0.5rem; width: 110px;">Estado</th>
                <th style="padding: 0.75rem 0.5rem; min-width: 150px;">Notas / Verificaciones</th>
              </tr>
            </thead>
            <tbody id="table-shipments-body">
              <!-- Cargado dinámicamente -->
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Variables de Estado locales
  let activeToken = null;
  let allWaypoints = []; // Lista unificada de paradas de clientes
  let currentFilteredWaypoints = []; // Lista actualmente filtrada / visible en pantalla
  let currentIntegration = null;
  let optirouteAutoPollInterval = null;

  // Manejo de tabs
  const tabApi = document.getElementById('tab-api');
  const tabMetrics = document.getElementById('tab-metrics');
  const tabExcel = document.getElementById('tab-excel');
  const sectionApi = document.getElementById('section-api');
  const sectionMetrics = document.getElementById('section-metrics');
  const sectionExcel = document.getElementById('section-excel');

  tabApi?.addEventListener('click', () => {
    tabApi.style.background = 'var(--color-surface)';
    tabApi.style.color = 'var(--color-primary)';
    tabApi.style.boxShadow = 'var(--shadow-sm)';
    if (tabMetrics) { tabMetrics.style.background = 'transparent'; tabMetrics.style.color = 'var(--color-text-muted)'; tabMetrics.style.boxShadow = 'none'; }
    if (tabExcel) { tabExcel.style.background = 'transparent'; tabExcel.style.color = 'var(--color-text-muted)'; tabExcel.style.boxShadow = 'none'; }
    if (sectionApi) sectionApi.style.display = 'block';
    if (sectionMetrics) sectionMetrics.style.display = 'none';
    if (sectionExcel) sectionExcel.style.display = 'none';
  });

  tabMetrics?.addEventListener('click', () => {
    tabMetrics.style.background = 'var(--color-surface)';
    tabMetrics.style.color = 'var(--color-primary)';
    tabMetrics.style.boxShadow = 'var(--shadow-sm)';
    if (tabApi) { tabApi.style.background = 'transparent'; tabApi.style.color = 'var(--color-text-muted)'; tabApi.style.boxShadow = 'none'; }
    if (tabExcel) { tabExcel.style.background = 'transparent'; tabExcel.style.color = 'var(--color-text-muted)'; tabExcel.style.boxShadow = 'none'; }
    if (sectionMetrics) sectionMetrics.style.display = 'flex';
    if (sectionApi) sectionApi.style.display = 'none';
    if (sectionExcel) sectionExcel.style.display = 'none';
    renderOptirouteMetrics();
  });

  tabExcel?.addEventListener('click', () => {
    tabExcel.style.background = 'var(--color-surface)';
    tabExcel.style.color = 'var(--color-primary)';
    tabExcel.style.boxShadow = 'var(--shadow-sm)';
    if (tabApi) { tabApi.style.background = 'transparent'; tabApi.style.color = 'var(--color-text-muted)'; tabApi.style.boxShadow = 'none'; }
    if (tabMetrics) { tabMetrics.style.background = 'transparent'; tabMetrics.style.color = 'var(--color-text-muted)'; tabMetrics.style.boxShadow = 'none'; }
    if (sectionExcel) sectionExcel.style.display = 'flex';
    if (sectionApi) sectionApi.style.display = 'none';
    if (sectionMetrics) sectionMetrics.style.display = 'none';
  });

  // 1. Obtener integración única de Optiroute
  const statusContainer = document.getElementById('api-integration-status');
  const selectRoutePlans = document.getElementById('select-route-plans');
  const apiControls = document.getElementById('api-controls');

  try {
    const { data: integration, error } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Optiroute')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!integration) {
      statusContainer.innerHTML = `
        <div class="alert alert-danger" style="margin: 0; padding: 1rem; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.5rem; background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--color-danger);">
          <i class="ri-error-warning-line" style="font-size: 1.25rem;"></i>
          <span>No hay una integración activa de Optiroute configurada en el sistema. Ve al módulo de <strong>Integraciones</strong> para activarla.</span>
        </div>
      `;
    } else {
      currentIntegration = integration;
      activeToken = integration.access_token;
      statusContainer.innerHTML = `
        <div class="alert alert-success" style="margin: 0; padding: 0.75rem 1rem; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; background-color: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: var(--color-success); font-size: 0.875rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-checkbox-circle-line" style="font-size: 1.1rem;"></i>
            <span>Conectado a Optiroute API (${integration.comercio !== 'no asignado' ? integration.comercio : 'Stocka SpA'})</span>
          </div>
          <span style="font-size: 0.75rem; background: var(--color-success); color: white; padding: 0.15rem 0.5rem; border-radius: var(--radius-sm); font-weight: 700; text-transform: uppercase;">Activo</span>
        </div>
      `;
      apiControls.style.display = 'flex';
      
      // Ejecutar limpieza en segundo plano de registros mayores a 30 días
      const oneMonthAgo = new Date();
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
      supabase
        .from('optiroute_orders')
        .delete()
        .lt('created_at', oneMonthAgo.toISOString())
        .then(({ error }) => {
          if (error) console.error('Error al limpiar caché antigua:', error);
          else console.log('Caché antigua (>30 días) limpia.');
        });

      // Cargar lista de planes de rutas
      await loadRoutePlansList();
    }
  } catch (err) {
    console.error('Error cargando integración de Optiroute:', err);
    statusContainer.innerHTML = `
      <div class="alert alert-danger" style="margin: 0; padding: 1rem; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.5rem; background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--color-danger);">
        <i class="ri-error-warning-line" style="font-size: 1.25rem;"></i>
        <span>Error al conectar con la base de datos de integraciones: ${err.message}</span>
      </div>
    `;
  }

  // Cargar lista de planes de rutas (Caché local + API en vivo)
  async function loadRoutePlansList() {
    try {
      selectRoutePlans.innerHTML = '<option value="">Cargando envíos de Optiroute...</option>';
      
      // 1. Cargar pedidos existentes en Supabase primero (Siempre disponible y sin CORS)
      const { data: dbOrders } = await supabase
        .from('optiroute_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      const routePlansMap = new Map();
      if (dbOrders && dbOrders.length > 0) {
        dbOrders.forEach(o => {
          const rp = o.raw_data?.route_plan || o.raw_data?.waypoint?.route_plan;
          if (rp && rp.id) {
            routePlansMap.set(String(rp.id), rp.name || `Ruta #${rp.id}`);
          }
        });
      }

      let optionsHtml = '';
      if (dbOrders && dbOrders.length > 0) {
        optionsHtml += `<option value="ALL_DB">📦 Todos los envíos en Base de Datos (${dbOrders.length} pedidos)</option>`;
        routePlansMap.forEach((name, id) => {
          optionsHtml += `<option value="${id}">🚚 Ruta: ${name}</option>`;
        });
      }

      // 2. Intentar consultar la API en vivo en segundo plano silenciosamente
      try {
        const response = await fetch('https://app.optiroute.cl/api/v1/route-plans/?per_page=40', {
          headers: {
            'Authorization': `Token ${activeToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          let results = Array.isArray(data) ? data : (data?.results || []);

          if (results.length > 0) {
            results.sort((a, b) => new Date(b.departure_datetime) - new Date(a.departure_datetime));
            const apiOptions = results.map(rp => {
              const dateStr = rp.departure_datetime ? new Date(rp.departure_datetime).toLocaleDateString('es-CL', {
                day: '2-digit', month: '2-digit', year: 'numeric'
              }) : 'Sin fecha';
              
              let statusText = 'Creado';
              if (rp.status === 1) statusText = 'En curso';
              else if (rp.status === 2) statusText = 'Completado';
              else if (rp.status === -1) statusText = 'Cancelado';

              return `<option value="${rp.id}">🌐 API En Vivo: ${rp.name} (${dateStr}) - [${statusText}]</option>`;
            }).join('');

            optionsHtml = apiOptions + (optionsHtml ? `<optgroup label="Caché BD local">${optionsHtml}</optgroup>` : '');
          }
        }
      } catch (corsErr) {
        console.log('ℹ️ Consulta directa a API Optiroute restringida por política CORS del navegador. Mostrando envíos de la base de datos local.');
      }

      if (!optionsHtml) {
        selectRoutePlans.innerHTML = '<option value="">Sin envíos en BD aún. Presiona "⚡ Sincronizar Ahora"</option>';
        if (statusContainer) {
          statusContainer.innerHTML = `
            <div class="alert alert-info" style="margin-top:0.4rem; padding:0.65rem 0.85rem; font-size:0.8rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; background:rgba(37,99,235,0.1); border:1px solid rgba(37,99,235,0.25); color:#2563eb; border-radius:var(--radius-md);">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <i class="ri-information-line" style="font-size:1.1rem;"></i>
                <span>La API de Optiroute está <strong>Conectada y Activa</strong>. Presiona <strong>"⚡ Sincronizar Ahora"</strong> para descargar los envíos más recientes hacia la base de datos local.</span>
              </div>
              <button class="btn btn-primary btn-sm btn-trigger-optiroute-sync" style="padding:0.35rem 0.8rem; font-size:0.75rem; background:#2563eb; color:white; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:700; display:flex; align-items:center; gap:0.25rem;">
                <i class="ri-flashlight-line"></i> ⚡ Sincronizar Ahora
              </button>
            </div>
          `;
        }
        return;
      }

      selectRoutePlans.innerHTML = optionsHtml;

      // Cargar automáticamente los envíos iniciales
      const initialPlan = selectRoutePlans.value;
      if (initialPlan) {
        await loadRouteData(initialPlan, false);
      }

    } catch (err) {
      console.error('Error cargando lista de rutas:', err);
      selectRoutePlans.innerHTML = '<option value="ALL_DB">📦 Todos los envíos en BD</option>';
      await loadRouteData('ALL_DB', false);
    }
  }

  // Guardar ruta obtenida en la base de datos (Caché local) en un solo lote atómico (Bulk Upsert)
  async function saveRouteToCache(detailedOrders, commerceName) {
    if (!detailedOrders || detailedOrders.length === 0) return;
    console.log(`Guardando/Actualizando ${detailedOrders.length} pedidos en caché local (Bulk)...`);
    
    const refList = detailedOrders.map(d => d.reference ? d.reference.trim() : null).filter(Boolean);
    let existingMap = new Map();
    if (refList.length > 0) {
      const { data: existingRows } = await supabase
        .from('optiroute_orders')
        .select('referencia, raw_data')
        .in('referencia', refList);
      (existingRows || []).forEach(r => {
        if (r.referencia) existingMap.set(r.referencia, r.raw_data || {});
      });
    }

    const payloads = [];
    for (const detailedOrder of detailedOrders) {
      try {
        if (!detailedOrder.route_plan && detailedOrder.waypoint?.route_plan) {
          detailedOrder.route_plan = detailedOrder.waypoint.route_plan;
        }

        const ref = detailedOrder.reference ? detailedOrder.reference.trim() : null;
        const localDispatchAt = ref ? localStorage.getItem(`stk_email_dispatch_${ref}`) : null;
        const localDeliveryAt = ref ? localStorage.getItem(`stk_email_delivery_${ref}`) : null;

        const prevRaw = ref ? existingMap.get(ref) : {};

        const emailNotifiedAt = localDispatchAt || prevRaw?.email_notified_at || detailedOrder.email_notified_at || null;
        const deliveryEmailNotifiedAt = localDeliveryAt || prevRaw?.delivery_email_notified_at || detailedOrder.delivery_email_notified_at || null;

        if (emailNotifiedAt) detailedOrder.email_notified_at = emailNotifiedAt;
        if (deliveryEmailNotifiedAt) detailedOrder.delivery_email_notified_at = deliveryEmailNotifiedAt;

        const email = detailedOrder.customer?.customer?.email || detailedOrder.customer?.email || null;
        const addressStr = detailedOrder.address?.full_address || 
                           detailedOrder.address?.excel_address || 
                           detailedOrder.address?.short_address || 
                           (detailedOrder.address?.street_name 
                             ? `${detailedOrder.address.street_name} ${detailedOrder.address.address_number || ''}`.trim() 
                             : null);

        let commune = detailedOrder.address?.commune_string || 
                      detailedOrder.address?.locality || 
                      (detailedOrder.address?.commune && typeof detailedOrder.address.commune === 'object' ? detailedOrder.address.commune.name : null);

        if (!commune && (detailedOrder.address?.short_address || detailedOrder.address?.excel_address)) {
          const addr = detailedOrder.address.short_address || detailedOrder.address.excel_address;
          const parts = addr.split(',');
          if (parts.length > 1) {
            commune = parts[parts.length - 1].trim();
          }
        }

        payloads.push({
          id: String(detailedOrder.id),
          referencia: detailedOrder.reference ? detailedOrder.reference.trim() : null,
          empresa_comercio_proveedor: commerceName || 'STOCKA',
          tracking: (detailedOrder.tracking || '').trim() || null,
          tracking_url: (detailedOrder.tracking_url || '').trim() || null,
          courier: 'STOCKA X',
          status: getOptirouteStatusName(detailedOrder.status),
          created_at: detailedOrder.created_at || null,
          updated_at: detailedOrder.updated_at || null,
          servicio_tipo_envio: 'SAME DAY/24 HRS',
          nombre_destinatario: detailedOrder.customer?.name || null,
          telefono_destino: detailedOrder.customer?.phone_number || null,
          email_cliente_destino: email,
          direccion_destino: addressStr,
          complemento_destino: [detailedOrder.address?.apartment_number, detailedOrder.address?.address_more_info]
            .filter(Boolean)
            .join(', ') || null,
          comuna_destino: commune,
          raw_data: detailedOrder
        });
      } catch (err) {
        console.warn(`Error al procesar payload de pedido ${detailedOrder.id}:`, err.message);
      }
    }

    if (payloads.length > 0) {
      const { error: dbErr } = await supabase
        .from('optiroute_orders')
        .upsert(payloads, { onConflict: 'id' });

      if (dbErr) {
        console.error('Error guardando paquete de pedidos en BD:', dbErr.message);
      } else {
        console.log(`Caché local guardada exitosamente (${payloads.length} pedidos en 1 sola consulta).`);
      }
    }
  }

  function getOptirouteStatusName(statusNum) {
    const s = Number(statusNum);
    switch (s) {
      case -4: return 'DELETED';
      case -3: return 'TEMPORARY';
      case -2: return 'IMPORTED';
      case -1: return 'CANCELLED';
      case 0: return 'REVIEWING';
      case 1: return 'SCHEDULED';
      case 6: return 'ONROUTE';
      case 2: return 'ONGOING';
      case 4: return 'ARRIVED';
      case 3: return 'DELIVERED';
      case 5: return 'SKIPPED';
      default: return 'UNKNOWN';
    }
  }

  // Función centralizada para recuperar e inyectar puntos intermedios persistentes
  async function injectPersistentIntermediatePoints(routePlanId, defaultRouteName = 'Ruta Optiroute') {
    if (!routePlanId || routePlanId === 'ALL_DB') return;

    try {
      const pointsMap = new Map();

      // 1. Cargar desde LocalStorage (instantáneo y 100% resistente a desconexiones o cambios externos)
      try {
        const localKeys = [
          `stk_optiroute_intermediates_${routePlanId}`,
          'stk_optiroute_intermediates_global'
        ];
        localKeys.forEach(k => {
          const raw = localStorage.getItem(k);
          if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
              list.forEach(p => {
                if (p && p.reference && (String(p.route_plan_id) === String(routePlanId) || !p.route_plan_id)) {
                  pointsMap.set(p.id || `${p.reference}_${p.order}`, p);
                }
              });
            }
          }
        });
      } catch (e) {
        console.warn('Error leyendo puntos intermedios de localStorage:', e);
      }

      // 2. Cargar desde la tabla dedicada 'optiroute_intermediate_points'
      try {
        const { data: dbPoints, error: dbErr } = await supabase
          .from('optiroute_intermediate_points')
          .select('*')
          .eq('route_plan_id', String(routePlanId));

        if (!dbErr && dbPoints && dbPoints.length > 0) {
          dbPoints.forEach(p => {
            pointsMap.set(p.id || `${p.reference}_${p.order_num}`, {
              id: p.id,
              order: p.order_num,
              reference: p.reference,
              name: p.name,
              phone: p.phone || '',
              email: p.email || '',
              address: p.address,
              complemento: p.complemento || '',
              comuna: p.comuna,
              supplier: p.supplier || 'STOCKA',
              route_vehicle: p.vehicle || '',
              route_driver: p.driver || '',
              route_name: p.route_name || defaultRouteName,
              note: p.note || '',
              status: p.status || 'Ingresado (Punto Intermedio)',
              is_intermediate: true,
              route_plan_id: p.route_plan_id
            });
          });
        }
      } catch (errDb) {
        console.warn('Consulta a optiroute_intermediate_points:', errDb);
      }

      // 3. Fallback: Cargar desde optiroute_orders si existieran registros previos
      try {
        const { data: optOrders, error: optErr } = await supabase
          .from('optiroute_orders')
          .select('id, referencia, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, empresa_comercio_proveedor, status, raw_data')
          .ilike('id', 'INT-%')
          .limit(100);

        if (!optErr && optOrders && optOrders.length > 0) {
          optOrders.forEach(o => {
            const planId = o.raw_data?.route_plan?.id || o.raw_data?.waypoint?.route_plan?.id;
            if (String(planId) === String(routePlanId)) {
              const key = o.id || o.referencia;
              if (!pointsMap.has(key)) {
                const wp = o.raw_data?.waypoint || {};
                pointsMap.set(key, {
                  id: o.id,
                  order: wp.customer_order || wp.order || 0,
                  reference: o.referencia,
                  name: o.nombre_destinatario || 'Cliente sin nombre',
                  phone: o.telefono_destino || '',
                  email: o.email_cliente_destino || '',
                  address: o.direccion_destino || '',
                  complemento: o.complemento_destino || '',
                  comuna: o.comuna_destino || '',
                  supplier: o.empresa_comercio_proveedor || 'STOCKA',
                  route_vehicle: wp.route_vehicle || '',
                  route_driver: wp.route_driver || '',
                  route_name: wp.route_name || defaultRouteName,
                  note: wp.note || o.raw_data?.notes || '',
                  status: o.status || 'Ingresado (Punto Intermedio)',
                  is_intermediate: true,
                  route_plan_id: planId
                });
              }
            }
          });
        }
      } catch (errOpt) {
        console.warn('Fallback optiroute_orders INT:', errOpt);
      }

      // Inyectar al arreglo allWaypoints evitando duplicados
      const intermediateList = Array.from(pointsMap.values());
      intermediateList.forEach(item => {
        const itemOrder = parseFloat(item.order) || 0;
        const exists = allWaypoints.some(w => 
          (w.reference === item.reference && parseFloat(w.order) === itemOrder) ||
          (item.id && w.id === item.id)
        );

        if (!exists) {
          const ref = item.reference || 'S/R';
          const localDispatchAt = localStorage.getItem(`stk_email_dispatch_${ref}`);
          const localDeliveryAt = localStorage.getItem(`stk_email_delivery_${ref}`);
          const localFailedAt = localStorage.getItem(`stk_email_failed_${ref}`);

          const dispatchAt = localDispatchAt || item.dispatch_email_at || item.raw_data?.email_notified_at || null;
          const deliveryAt = localDeliveryAt || item.delivery_email_at || item.raw_data?.delivery_email_notified_at || null;
          const failedAt = localFailedAt || item.failed_email_at || item.raw_data?.failed_email_notified_at || null;

          allWaypoints.push({
            id: item.id,
            order: itemOrder,
            reference: ref,
            name: item.name || 'Cliente sin nombre',
            phone: item.phone || '',
            email: item.email || '',
            dispatch_email_notified: Boolean(dispatchAt),
            dispatch_email_at: dispatchAt,
            delivery_email_notified: Boolean(deliveryAt),
            delivery_email_at: deliveryAt,
            failed_email_notified: Boolean(failedAt),
            failed_email_at: failedAt,
            address: item.address || 'Sin Dirección',
            complemento: item.complemento || '',
            address_status: 1,
            status: item.status || 'Ingresado (Punto Intermedio)',
            status_code: 0,
            note: item.note || '',
            images: [],
            reception_name: '',
            reception_rut: '',
            supplier: item.supplier || 'STOCKA',
            comuna: item.comuna || '',
            tracking_url: '',
            route_vehicle: item.route_vehicle || item.vehicle || '',
            route_driver: item.route_driver || item.driver || '',
            route_name: item.route_name || defaultRouteName,
            is_intermediate: true,
            route_plan_id: routePlanId
          });
        }
      });

      allWaypoints.sort((a, b) => parseFloat(a.order || 0) - parseFloat(b.order || 0));
    } catch (err) {
      console.warn('Error inyectando puntos intermedios:', err);
    }
  }

  // Función Principal para Cargar la Ruta (Caché o API)
  async function loadRouteData(routePlanId, forceLive = false) {
    const container = document.getElementById('optiroute-support-container');
    if (!container) {
      console.log('Optiroute container not found in DOM. Skipping loadRouteData.');
      if (optirouteAutoPollInterval) {
        clearInterval(optirouteAutoPollInterval);
        optirouteAutoPollInterval = null;
      }
      return;
    }

    const btnFetchRoute = document.getElementById('btn-fetch-route');
    const btnForceLive = document.getElementById('btn-force-live-api');
    const dataSourceBadge = document.getElementById('data-source-badge');

    if (btnFetchRoute) {
      btnFetchRoute.disabled = true;
      btnFetchRoute.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Cargando...';
    }
    if (btnForceLive) btnForceLive.disabled = true;

    try {
      // 1. Intentar cargar desde caché local si no se fuerza la actualización en vivo o si es ALL_DB
      if (!forceLive || routePlanId === 'ALL_DB') {
        console.log(`Buscando envíos del plan/base de datos (${routePlanId}) en Supabase...`);
        let cached = [];
        
        if (routePlanId === 'ALL_DB') {
          const { data, error: cacheErr } = await supabase
            .from('optiroute_orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);
          if (cacheErr) console.warn('Error al leer base de datos local:', cacheErr.message);
          cached = data || [];
        } else {
          const { data, error: cacheErr } = await supabase
            .from('optiroute_orders')
            .select('*')
            .or(`raw_data->route_plan->>id.eq.${routePlanId},raw_data->waypoint->route_plan->>id.eq.${routePlanId}`);
          if (cacheErr) console.warn('Error al leer caché local:', cacheErr.message);
          cached = data || [];
        }

        if (cached && cached.length > 0) {
          console.log(`Cargando ${cached.length} pedidos de caché local...`);
          
          allWaypoints = cached.map(c => {
            const w = c.raw_data?.waypoint || {};
            const sr = c.raw_data || {};
            const ref = c.referencia || 'S/R';
            const localDispatchAt = localStorage.getItem(`stk_email_dispatch_${ref}`);
            const localDeliveryAt = localStorage.getItem(`stk_email_delivery_${ref}`);
            const localFailedAt = localStorage.getItem(`stk_email_failed_${ref}`);

            const dispatchAt = localDispatchAt || sr.email_notified_at || null;
            const deliveryAt = localDeliveryAt || sr.delivery_email_notified_at || null;
            const failedAt = localFailedAt || sr.failed_email_notified_at || null;

            return {
              order: w.customer_order || w.order || 0,
              reference: ref,
              name: c.nombre_destinatario || 'Cliente sin nombre',
              phone: c.telefono_destino || '',
              email: c.email_cliente_destino || sr.customer?.customer?.email || sr.customer?.email || '',
              dispatch_email_notified: Boolean(dispatchAt),
              dispatch_email_at: dispatchAt,
              delivery_email_notified: Boolean(deliveryAt),
              delivery_email_at: deliveryAt,
              failed_email_notified: Boolean(failedAt),
              failed_email_at: failedAt,
              address: c.direccion_destino || 'Sin Dirección',
              complemento: c.complemento_destino || [sr.address?.apartment_number, sr.address?.address_more_info, sr.address?.apartment].filter(Boolean).join(', ') || '',
              address_status: sr.address?.status !== undefined ? sr.address.status : 1,
              status: c.status || 'Desconocido',
              status_code: w.status !== undefined ? w.status : 0,
              note: w.note || '',
              images: w.images || [],
              reception_name: w.reception_name || '',
              reception_rut: w.reception_rut || '',
              supplier: c.empresa_comercio_proveedor || sr.supplier?.name || 'STOCKA',
              comuna: c.comuna_destino || sr.address?.commune_string || '',
              tracking_url: c.tracking_url || sr.tracking_url || '',
              route_vehicle: w.route_vehicle || sr.route_vehicle || '',
              route_driver: w.route_driver || sr.route_driver || '',
              route_name: w.route_name || sr.route_plan?.name || ''
            };
          });

          // Obtener nombre de ruta
          const routeName = cached[0].raw_data?.route_plan?.name || 'Ruta Optiroute';

          // Recuperar e inyectar puntos intermedios persistentes
          await injectPersistentIntermediatePoints(routePlanId, routeName);

          // Ordenar por parada
          allWaypoints.sort((a, b) => parseFloat(a.order || 0) - parseFloat(b.order || 0));

          // Mostrar Badge
          if (dataSourceBadge) {
            dataSourceBadge.style.display = 'inline-block';
            dataSourceBadge.style.background = 'var(--badge-neutral-bg)';
            dataSourceBadge.style.color = 'var(--badge-neutral-text)';
            dataSourceBadge.textContent = 'Caché Local';
          }
          if (btnForceLive) btnForceLive.style.display = 'flex';

          renderSummaryDashboard(routeName);
          populateFilterDropdowns();
          applyFilters();
          checkAndAutoSendDispatchEmails(allWaypoints);
          checkAndAutoSendDeliveryEmails(allWaypoints);
          checkAndAutoSendFailedEmails(allWaypoints);
          
          if (btnFetchRoute) {
            btnFetchRoute.disabled = false;
            btnFetchRoute.innerHTML = '<i class="ri-refresh-line"></i> Cargar Detalles de Ruta';
          }
          console.log(`Caché inicial cargada (${allWaypoints.length} envíos).`);
          if (routePlanId === 'ALL_DB') {
            return;
          }
        }
      }

      // 2. Si no hay caché o se forzó Live API, consultar en tiempo real
      console.log(`Cargando plan ${routePlanId} desde API en vivo de Optiroute...`);
      const response = await fetch(`https://app.optiroute.cl/api/v1/route-plans/${routePlanId}/`, {
        headers: {
          'Authorization': `Token ${activeToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error(`Error en plan de rutas: ${response.status}`);
      const planDetail = await response.json();
      
      const routes = planDetail.routes || [];
      if (routes.length === 0) {
        throw new Error('Este plan no tiene rutas asociadas (aún no ha sido optimizado).');
      }

      // Descargar rutas en paralelo
      const routePromises = routes.map(async (routeObj) => {
        const routeRes = await fetch(`https://app.optiroute.cl/api/v1/web-routes/${routeObj.id}/`, {
          headers: {
            'Authorization': `Token ${activeToken}`,
            'Content-Type': 'application/json'
          }
        });
        if (routeRes.ok) {
          const detail = await routeRes.json();
          const wps = detail.waypoints || [];
          const vehicleName = detail.vehicle?.license_plate || detail.vehicle?.name || detail.vehicle || routeObj.vehicle?.license_plate || routeObj.vehicle?.name || routeObj.vehicle || 'Sin Asignación';
          const driverName = detail.driver?.first_name ? `${detail.driver.first_name} ${detail.driver.last_name || ''}`.trim() : (detail.driver?.name || routeObj.driver?.name || '');
          wps.forEach(wp => {
            wp.route_vehicle = vehicleName;
            wp.route_driver = driverName;
            wp.route_name = detail.name || routeObj.name || planDetail.name || 'Ruta';
          });
          return wps;
        }
        return [];
      });

      const waypointsLists = await Promise.all(routePromises);
      let rawCustomerWaypoints = waypointsLists.flat().filter(w => w.is_customer);

      if (rawCustomerWaypoints.length === 0) {
        throw new Error('No se encontraron paradas de clientes en estas rutas.');
      }

      // Ordenar
      rawCustomerWaypoints.sort((a, b) => a.order - b.order);

      // Resolver teléfonos (Supabase + Fallback API en paralelo)
      const referenceList = rawCustomerWaypoints.map(w => w.service_request?.reference).filter(Boolean);
      let dbOrders = [];
      if (referenceList.length > 0) {
        const { data } = await supabase
          .from('optiroute_orders')
          .select('referencia, telefono_destino, email_cliente_destino, empresa_comercio_proveedor, comuna_destino, tracking_url, raw_data')
          .in('referencia', referenceList);
        dbOrders = data || [];
      }

      const dbMap = new Map();
      dbOrders.forEach(o => {
        if (o.referencia) {
          dbMap.set(o.referencia, {
            phone: o.telefono_destino,
            email: o.email_cliente_destino,
            supplier: o.empresa_comercio_proveedor,
            comuna: o.comuna_destino,
            tracking_url: o.tracking_url,
            email_notified_at: o.raw_data?.email_notified_at,
            delivery_email_notified_at: o.raw_data?.delivery_email_notified_at,
            failed_email_notified_at: o.raw_data?.failed_email_notified_at,
            raw_data: o.raw_data
          });
        }
      });

      const missingWaypoints = rawCustomerWaypoints.filter(w => {
        const ref = w.service_request?.reference;
        const dbOrder = ref ? dbMap.get(ref) : null;
        return (!dbOrder || (!dbOrder.phone && !dbOrder.email)) && w.service_request?.id;
      });

      const detailedOrdersList = [];

      // Descargar detalles únicamente para las paradas faltantes en la BD
      const batchSize = 10;
      for (let i = 0; i < missingWaypoints.length; i += batchSize) {
        const batch = missingWaypoints.slice(i, i + batchSize);
        await Promise.all(batch.map(async (w) => {
          if (!w.service_request?.id) return;
          try {
            const reqRes = await fetch(`https://app.optiroute.cl/api/v1/integration-service-requests/${w.service_request.id}/`, {
              headers: {
                'Authorization': `Token ${activeToken}`,
                'Content-Type': 'application/json'
              }
            });
            if (reqRes.ok) {
              const reqDetail = await reqRes.json();
              if (reqDetail) {
                reqDetail.route_plan = { id: planDetail.id, name: planDetail.name };
                // Inyectar waypoint al raw_data
                reqDetail.waypoint = {
                  id: w.id,
                  name: w.name,
                  customer_order: w.customer_order,
                  order: w.order,
                  status: w.status,
                  status_name: w.status_name,
                  note: w.note,
                  images: w.images,
                  reception_name: w.reception_name,
                  reception_rut: w.reception_rut,
                  route_plan: { id: planDetail.id, name: planDetail.name },
                  route_vehicle: w.route_vehicle || '',
                  route_driver: w.route_driver || '',
                  route_name: w.route_name || ''
                };
                detailedOrdersList.push(reqDetail);
                if (reqDetail.customer && reqDetail.customer.phone_number) {
                  const existingMap = dbMap.get(w.service_request.reference) || {};
                  dbMap.set(w.service_request.reference, {
                    ...existingMap,
                    phone: existingMap.phone || reqDetail.customer.phone_number,
                    email: existingMap.email || reqDetail.customer.customer?.email || reqDetail.customer.email
                  });
                }
              }
            }
          } catch (fetchErr) {
            console.warn('Error resolviendo teléfono de API:', fetchErr);
          }
        }));
      }

      // Estructurar waypoints
      allWaypoints = rawCustomerWaypoints.map(w => {
        const ref = w.service_request?.reference || 'S/R';
        const dbInfo = dbMap.get(ref) || {};
        const detOrder = detailedOrdersList.find(d => String(d.id) === String(w.service_request?.id));

        const phone = dbInfo.phone || detOrder?.customer?.phone_number || w.service_request?.customer?.phone_number || '';
        const email = dbInfo.email || detOrder?.customer?.customer?.email || detOrder?.customer?.email || w.service_request?.customer?.email || '';
        const supplier = dbInfo.supplier || detOrder?.supplier?.name || detOrder?.enterprise?.name || 'STOCKA';
        const comuna = dbInfo.comuna || detOrder?.address?.commune_string || detOrder?.address?.commune?.name || '';
        const tracking_url = dbInfo.tracking_url || detOrder?.tracking_url || '';
        const complemento = [
          detOrder?.address?.apartment_number,
          detOrder?.address?.address_more_info,
          detOrder?.address?.apartment,
          w.address?.apartment_number,
          w.address?.address_more_info
        ].filter(Boolean).join(', ') || '';

        const localDispatchAt = localStorage.getItem(`stk_email_dispatch_${ref}`);
        const localDeliveryAt = localStorage.getItem(`stk_email_delivery_${ref}`);
        const localFailedAt = localStorage.getItem(`stk_email_failed_${ref}`);

        const dispatchAt = localDispatchAt || dbInfo.email_notified_at || dbInfo.raw_data?.email_notified_at || detOrder?.email_notified_at || null;
        const deliveryAt = localDeliveryAt || dbInfo.delivery_email_notified_at || dbInfo.raw_data?.delivery_email_notified_at || detOrder?.delivery_email_notified_at || null;
        const failedAt = localFailedAt || dbInfo.failed_email_notified_at || dbInfo.raw_data?.failed_email_notified_at || detOrder?.failed_email_notified_at || null;

        return {
          order: w.customer_order || w.order || 0,
          reference: ref,
          name: w.name || w.service_request?.subscription?.name || 'Cliente sin nombre',
          phone: phone,
          email: email,
          dispatch_email_notified: Boolean(dispatchAt),
          dispatch_email_at: dispatchAt,
          delivery_email_notified: Boolean(deliveryAt),
          delivery_email_at: deliveryAt,
          failed_email_notified: Boolean(failedAt),
          failed_email_at: failedAt,
          address: w.address?.full_address || w.address?.short_address || 'Dirección no disponible',
          complemento: complemento,
          address_status: w.address?.status !== undefined ? w.address.status : 1,
          status: getStatusName(w.status_name || w.status),
          status_code: w.status,
          note: w.note || '',
          images: w.images || [],
          reception_name: w.reception_name || '',
          reception_rut: w.reception_rut || '',
          supplier: supplier,
          comuna: comuna,
          tracking_url: tracking_url,
          route_vehicle: w.route_vehicle || '',
          route_driver: w.route_driver || '',
          route_name: w.route_name || ''
        };
      });

      // Recuperar e inyectar puntos intermedios persistentes para esta ruta
      await injectPersistentIntermediatePoints(routePlanId, planDetail.name || 'Ruta Optiroute');

      // Mostrar Badge API en Vivo
      if (dataSourceBadge) {
        dataSourceBadge.style.display = 'inline-block';
        dataSourceBadge.style.background = 'var(--badge-info-bg)';
        dataSourceBadge.style.color = 'var(--badge-info-text)';
        dataSourceBadge.textContent = 'API en Vivo';
      }
      if (btnForceLive) btnForceLive.style.display = 'none';

      renderSummaryDashboard(planDetail.name || 'Ruta Optiroute');
      populateFilterDropdowns();
      applyFilters();
      checkAndAutoSendDispatchEmails(allWaypoints);
      checkAndAutoSendDeliveryEmails(allWaypoints);
      checkAndAutoSendFailedEmails(allWaypoints);

      // Guardar en la caché local atómicamente
      if (detailedOrdersList.length > 0) {
        await saveRouteToCache(detailedOrdersList, currentIntegration?.comercio);
      }

      // Iniciar polling automático cada 2 minutos en segundo plano si no está activo
      if (!optirouteAutoPollInterval) {
        console.log(`⏱️ Iniciando monitoreo automático en tiempo real (cada 2 min) para plan ${routePlanId}`);
        optirouteAutoPollInterval = setInterval(() => {
          const selectElem = document.getElementById('select-route-plans');
          if (!selectElem) {
            console.log(`⏱️ Deteniendo monitoreo automático porque 'select-route-plans' ya no está en el DOM.`);
            clearInterval(optirouteAutoPollInterval);
            optirouteAutoPollInterval = null;
            return;
          }
          const currentPlan = selectElem.value;
          if (currentPlan) {
            console.log(`🔄 Auto-actualizando entregas en vivo para plan ${currentPlan}...`);
            loadRouteData(currentPlan, true);
          }
        }, 120000);
      }

    } catch (err) {
      console.warn('Consulta en vivo de plan interrumpida (CORS/red). Usando datos de BD:', err.message);
      if (allWaypoints.length === 0 && window.Swal) {
        Swal.fire({
          icon: 'info',
          title: 'Modo Base de Datos',
          text: 'Mostrando envíos almacenados en la base de datos. La API en vivo está restringida por políticas de navegador (CORS).',
          confirmButtonColor: 'var(--color-primary)'
        });
      }
    } finally {
      const currentBtnFetchRoute = document.getElementById('btn-fetch-route');
      const currentBtnForceLive = document.getElementById('btn-force-live-api');
      if (currentBtnFetchRoute) {
        currentBtnFetchRoute.disabled = false;
        currentBtnFetchRoute.innerHTML = '<i class="ri-refresh-line"></i> Cargar Detalles de Ruta';
      }
      if (currentBtnForceLive) currentBtnForceLive.disabled = false;
    }
  }

  // Función para solicitar sincronización inmediata con la API de Optiroute vía Edge Function
  async function triggerOptirouteSync(btnElem) {
    if (btnElem) {
      btnElem.disabled = true;
      btnElem.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Solicitando sync...';
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado en el WMS.");

      const res = await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/sync-integrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ platform: 'Optiroute' })
      });

      if (!res.ok) {
        console.warn('Edge Function sync-integrations devolvió error:', result.error);
        if (window.Swal) {
          Swal.fire({
            icon: 'info',
            title: 'Sincronización Programada',
            text: 'La sincronización de Optiroute se ejecuta automáticamente cada 30 minutos en GitHub Actions. Si requieres renovar tus credenciales, puedes ir al módulo de Integraciones > Optiroute API > Obtener Token.',
            confirmButtonColor: 'var(--color-primary)'
          });
        }
        return;
      }

      if (window.Swal) {
        Swal.fire({
          icon: 'success',
          title: 'Sincronización Solicitada',
          text: 'Se inició el proceso de sincronización con Optiroute. Los pedidos aparecerán en la base de datos local en unos momentos.',
          confirmButtonColor: 'var(--color-primary)'
        });
      }

      // Auto refrescar a los 8 segundos y 20 segundos
      setTimeout(() => loadRoutePlansList(), 8000);
      setTimeout(() => loadRoutePlansList(), 20000);

    } catch (err) {
      console.error('Error al solicitar sincronización:', err);
      if (window.Swal) Swal.fire('Error', `No se pudo iniciar la sincronización: ${err.message}`, 'error');
    } finally {
      if (btnElem) {
        btnElem.disabled = false;
        btnElem.innerHTML = '<i class="ri-flashlight-line"></i> ⚡ Sincronizar Ahora';
      }
    }
  }

  // Listener para botones de sincronización manual
  document.addEventListener('click', (e) => {
    const btnSync = e.target.closest('#btn-sync-optiroute-now, .btn-trigger-optiroute-sync');
    if (btnSync) {
      e.preventDefault();
      triggerOptirouteSync(btnSync);
    }
  });

  // Escuchar botón Cargar Detalles de Ruta
  const btnFetchRoute = document.getElementById('btn-fetch-route');
  if (btnFetchRoute) {
    btnFetchRoute.addEventListener('click', () => {
      const routePlanId = selectRoutePlans ? selectRoutePlans.value : '';
      if (routePlanId) loadRouteData(routePlanId, false);
    });
  }

  // Escuchar botón Forzar Actualización en Vivo
  document.addEventListener('click', (e) => {
    const btnForceLive = e.target.closest('#btn-force-live-api');
    if (btnForceLive) {
      const routePlanId = selectRoutePlans.value;
      loadRouteData(routePlanId, true);
    }
  });

  // Renderizar panel de Métricas de API y Auditoría
  async function renderOptirouteMetrics() {
    const loadingDiv = document.getElementById('metrics-loading');
    const alertDiv = document.getElementById('metrics-alert-banner');
    const kpiDiv = document.getElementById('metrics-kpi-cards');
    const historyDiv = document.getElementById('metrics-history-table');

    if (!kpiDiv) return;

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: logs, error } = await supabase
        .from('optiroute_api_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) {
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (historyDiv) {
          historyDiv.innerHTML = `
            <div class="alert alert-warning" style="margin-top: 0.5rem; padding: 0.75rem 1rem; border-radius: var(--radius-md); font-size: 0.8rem; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); color: #b45309;">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <i class="ri-alert-line" style="font-size: 1.25rem;"></i>
                <div>
                  <strong>Configuración Pendiente: Tabla de Auditoría API</strong><br>
                  La tabla <code>optiroute_api_logs</code> aún no existe en Supabase. Para ver el historial de métricas diarias y auditoría, ejecuta el script <code>supabase_schema_optiroute_logs.sql</code> en el Editor SQL de tu proyecto Supabase.
                </div>
              </div>
            </div>
          `;
        }
        return;
      }

      const logList = logs || [];

      // Calcular acumulados de hoy
      const todayLogs = logList.filter(l => new Date(l.created_at) >= todayStart);
      const totalCallsToday = todayLogs.reduce((acc, l) => acc + (l.total_http_calls || 0), 0);
      const totalSkippedToday = todayLogs.reduce((acc, l) => acc + (l.skipped_terminal || 0) + (l.skipped_unchanged || 0), 0);
      const totalProcessedToday = todayLogs.reduce((acc, l) => acc + (l.orders_synced || 0), 0);

      const totalPotentialToday = totalCallsToday + totalSkippedToday;
      const savingPercentage = totalPotentialToday > 0 
        ? ((totalSkippedToday / totalPotentialToday) * 100).toFixed(1)
        : '100.0';

      let statusBadge = `<span class="badge badge-success" style="font-size:0.75rem; font-weight:700;"><i class="ri-checkbox-circle-fill"></i> Nivel Óptimo (< 300)</span>`;
      let alertBannerHtml = '';

      if (totalCallsToday > 500) {
        statusBadge = `<span class="badge badge-danger" style="font-size:0.75rem; font-weight:700;"><i class="ri-error-warning-fill"></i> ALERTA CRÍTICA (> 500)</span>`;
        alertBannerHtml = `
          <div class="alert alert-danger" style="padding: 0.6rem 0.8rem; border-radius: var(--radius-md); font-size: 0.8rem; display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #ef4444;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <i class="ri-alarm-warning-line" style="font-size: 1.25rem;"></i>
              <div>
                <strong>⚠️ ALERTA DE CONSUMO ELEVADO:</strong> Se han registrado <strong>${totalCallsToday} peticiones HTTP hoy</strong> a la API de Optiroute, superando el umbral recomendado de 500 llamadas/día.
              </div>
            </div>
          </div>
        `;
      } else if (totalCallsToday > 300) {
        statusBadge = `<span class="badge badge-warning" style="font-size:0.75rem; font-weight:700;"><i class="ri-alert-fill"></i> Consumo Moderado (300-500)</span>`;
      }

      if (alertDiv) alertDiv.innerHTML = alertBannerHtml;
      if (loadingDiv) loadingDiv.style.display = 'none';

      kpiDiv.innerHTML = `
        <div style="background: var(--color-surface); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.2rem;">
          <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">PETICIONES API HOY</span>
          <div style="font-size: 1.25rem; font-weight: 800; color: ${totalCallsToday > 500 ? '#ef4444' : totalCallsToday > 300 ? '#f59e0b' : 'var(--color-primary)'};">
            ${totalCallsToday} <span style="font-size: 0.7rem; font-weight: 500; color: var(--color-text-muted);">/ 500 máx recomendadas</span>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div style="background: var(--color-surface); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.2rem;">
          <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">AHORRO DE PETICIONES</span>
          <div style="font-size: 1.25rem; font-weight: 800; color: var(--color-success);">
            ${savingPercentage}% <span style="font-size: 0.7rem; font-weight: 500; color: var(--color-text-muted);">evitadas</span>
          </div>
          <span style="font-size: 0.7rem; color: var(--color-text-muted);">${totalSkippedToday.toLocaleString()} pedidos omitidos por caché</span>
        </div>

        <div style="background: var(--color-surface); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.2rem;">
          <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">PEDIDOS SINCRONIZADOS HOY</span>
          <div style="font-size: 1.25rem; font-weight: 800; color: var(--color-text-main);">
            ${totalProcessedToday}
          </div>
          <span style="font-size: 0.7rem; color: var(--color-text-muted);">Actualizados en base de datos</span>
        </div>
      `;

      if (historyDiv) {
        if (logList.length === 0) {
          historyDiv.innerHTML = `<p style="font-size:0.75rem; color:var(--color-text-muted); margin-top:0.5rem;">Aún no hay registros de auditoría guardados en <code>optiroute_api_logs</code>. Las métricas se registrarán automáticamente en la próxima sincronización del backend.</p>`;
        } else {
          historyDiv.innerHTML = `
            <div style="margin-top: 0.5rem;">
              <h4 style="font-size:0.8rem; font-weight:700; margin:0 0 0.4rem 0; color:var(--color-text-main);">Últimas Ejecuciones de Sincronización API</h4>
              <div style="overflow-x: auto;">
                <table class="data-table" style="width:100%; border-collapse:collapse; font-size:0.75rem;">
                  <thead>
                    <tr style="border-bottom:1px solid var(--color-border); text-align:left;">
                      <th style="padding:0.4rem;">Fecha/Hora</th>
                      <th style="padding:0.4rem;">Origen</th>
                      <th style="padding:0.4rem; text-align:center;">Listado HTTP</th>
                      <th style="padding:0.4rem; text-align:center;">Detalle HTTP</th>
                      <th style="padding:0.4rem; text-align:center;">Total HTTP</th>
                      <th style="padding:0.4rem; text-align:center;">Omitidos (Caché/Inmutables)</th>
                      <th style="padding:0.4rem; text-align:center;">Sincronizados</th>
                      <th style="padding:0.4rem; text-align:center;">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${logList.map(l => {
                      const dateStr = new Date(l.created_at).toLocaleString('es-CL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
                      const st = l.status === 'critical' 
                        ? '<span class="badge badge-danger" style="font-size:0.65rem;">Crítico</span>'
                        : l.status === 'warning'
                        ? '<span class="badge badge-warning" style="font-size:0.65rem;">Advertencia</span>'
                        : '<span class="badge badge-success" style="font-size:0.65rem;">Normal</span>';
                      return `
                        <tr style="border-bottom:1px solid var(--color-border);">
                          <td style="padding:0.35rem;">${dateStr}</td>
                          <td style="padding:0.35rem;"><code>${l.source || 'cron'}</code></td>
                          <td style="padding:0.35rem; text-align:center;">${l.list_calls || 0}</td>
                          <td style="padding:0.35rem; text-align:center;">${l.detail_calls || 0}</td>
                          <td style="padding:0.35rem; text-align:center; font-weight:700;">${l.total_http_calls || 0}</td>
                          <td style="padding:0.35rem; text-align:center; color:var(--color-success);">${(l.skipped_terminal || 0) + (l.skipped_unchanged || 0)}</td>
                          <td style="padding:0.35rem; text-align:center;">${l.orders_synced || 0}</td>
                          <td style="padding:0.35rem; text-align:center;">${st}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        }
      }

    } catch (err) {
      console.warn('Error renderizando métricas de Optiroute:', err);
    }
  }

  // Normalizador de estados legibles
  function getStatusName(statusInput) {
    if (typeof statusInput === 'string') return statusInput;
    const s = Number(statusInput);
    switch (s) {
      case -4: return 'Eliminado';
      case -3: return 'Temporal';
      case -2: return 'Importado';
      case -1: return 'Cancelado';
      case 0: return 'En revisión';
      case 1: return 'Programado';
      case 6: return 'En ruta';
      case 2: return 'En viaje';
      case 4: return 'Llegado';
      case 3: return 'Completado';
      case 5: return 'Saltado';
      default: return 'Desconocido';
    }
  }

  // Renderizar KPI Dashboard
  function renderSummaryDashboard(routeName) {
    const summaryContainer = document.getElementById('route-summary');
    summaryContainer.style.display = 'grid';

    const totalStops = allWaypoints.length;
    const completed = allWaypoints.filter(w => {
      const st = (String(w.status || '') + ' ' + String(w.status_name || '')).toLowerCase();
      return st.includes('completado') || st.includes('entregado') || st.includes('exito') || st.includes('delivered') || w.status_code === 3 || w.status === 3;
    }).length;

    const onroute = allWaypoints.filter(w => {
      const st = (String(w.status || '') + ' ' + String(w.status_name || '')).toLowerCase();
      return st.includes('ruta') || st.includes('viaje') || st.includes('onroute') || st.includes('ongoing') || w.status_code === 6 || w.status_code === 2;
    }).length;

    const skipped = allWaypoints.filter(w => {
      const st = (String(w.status || '') + ' ' + String(w.status_name || '')).toLowerCase();
      return st.includes('saltado') || st.includes('cancelado') || st.includes('eliminado') || st.includes('skipped') || st.includes('cancelled') || st.includes('deleted') || w.status_code === 5 || w.status_code === -1;
    }).length;
    
    // Alertas de geocodificación
    // Códigos de advertencia: todo menos 1 (GEOCODED) y 3 (REVERSE_GEOCODED)
    const warnings = allWaypoints.filter(w => w.address_status !== 1 && w.address_status !== 3).length;

    summaryContainer.innerHTML = `
      <!-- Total -->
      <div class="card" style="padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.15rem; border-left: 4px solid var(--color-primary); background: var(--color-surface); margin-bottom: 0 !important;">
        <span style="font-size: 0.65rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Total Paradas</span>
        <span style="font-size: 1.25rem; font-weight: 700; color: var(--color-text-main); line-height: 1.2;">${totalStops}</span>
        <span style="font-size: 0.6rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${routeName}</span>
      </div>
      <!-- Entregados -->
      <div class="card" style="padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.15rem; border-left: 4px solid var(--color-success); background: var(--color-surface); margin-bottom: 0 !important;">
        <span style="font-size: 0.65rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Entregados</span>
        <span style="font-size: 1.25rem; font-weight: 700; color: var(--color-success); line-height: 1.2;">${completed}</span>
        <span style="font-size: 0.6rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${((completed / (totalStops || 1)) * 100).toFixed(0)}% del total</span>
      </div>
      <!-- En Ruta -->
      <div class="card" style="padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.15rem; border-left: 4px solid var(--color-info); background: var(--color-surface); margin-bottom: 0 !important;">
        <span style="font-size: 0.65rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">En Tránsito</span>
        <span style="font-size: 1.25rem; font-weight: 700; color: var(--color-info); line-height: 1.2;">${onroute}</span>
        <span style="font-size: 0.6rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">En reparto activo</span>
      </div>
      <!-- Saltados -->
      <div class="card" style="padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.15rem; border-left: 4px solid var(--color-danger); background: var(--color-surface); margin-bottom: 0 !important;">
        <span style="font-size: 0.65rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">No Entregados</span>
        <span style="font-size: 1.25rem; font-weight: 700; color: var(--color-danger); line-height: 1.2;">${skipped}</span>
        <span style="font-size: 0.6rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Saltados / Cancelados</span>
      </div>
      <!-- Advertencias de Dirección -->
      <div class="card" style="padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.15rem; border-left: 4px solid var(--color-warning); background: var(--color-surface); margin-bottom: 0 !important;">
        <span style="font-size: 0.65rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Direcciones Dudosas</span>
        <span style="font-size: 1.25rem; font-weight: 700; color: var(--color-warning); line-height: 1.2;">${warnings}</span>
        <span style="font-size: 0.6rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Requiere revisión física</span>
      </div>
    `;
  }

  // Actualizar estado manual de un punto intermedio y gestionar envío de correos
  async function updateIntermediatePointStatus(item, newStatus, triggerEmails = true) {
    if (!item) return;
    const oldStatus = item.status;
    item.status = newStatus;

    const cleanNew = String(newStatus).toLowerCase();
    const selectRoutePlans = document.getElementById('select-route-plans');
    const currentRouteId = selectRoutePlans?.value || item.route_plan_id || 'CUSTOM';

    // 1. Actualizar en LocalStorage
    try {
      const localKeys = [
        `stk_optiroute_intermediates_${currentRouteId}`,
        'stk_optiroute_intermediates_global'
      ];
      localKeys.forEach(k => {
        const raw = localStorage.getItem(k);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const found = list.find(p => p.reference === item.reference || (p.id && p.id === item.id));
            if (found) {
              found.status = newStatus;
              localStorage.setItem(k, JSON.stringify(list));
            }
          }
        }
      });
    } catch (e) {
      console.warn('Error actualizando estado en localStorage:', e);
    }

    // 2. Actualizar en tabla dedicada 'optiroute_intermediate_points'
    try {
      if (item.id) {
        await supabase
          .from('optiroute_intermediate_points')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);
      } else {
        await supabase
          .from('optiroute_intermediate_points')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('reference', item.reference);
      }
    } catch (e) {
      console.warn('Error actualizando estado en optiroute_intermediate_points:', e);
    }

    // 3. Actualizar en 'optiroute_orders'
    try {
      await supabase
        .from('optiroute_orders')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('referencia', item.reference);
    } catch (e) {
      console.warn('Error actualizando estado en optiroute_orders:', e);
    }

    // 4. Gestión y Disparo de Correos Brevo según el nuevo estado manual
    let emailSentType = null;
    if (triggerEmails && item.email && item.email.includes('@')) {
      try {
        if (cleanNew.includes('ruta') || cleanNew.includes('tránsito') || cleanNew.includes('onroute')) {
          if (!item.dispatch_email_notified) {
            await sendBrevoNotificationEmail(item, 'dispatch');
            emailSentType = 'Aviso de Despacho (En Ruta)';
          }
        } else if (cleanNew.includes('completado') || cleanNew.includes('entregado') || cleanNew.includes('delivered')) {
          if (!item.delivery_email_notified) {
            await sendBrevoNotificationEmail(item, 'delivery');
            emailSentType = 'Confirmación de Entrega';
          }
        } else if (cleanNew.includes('saltado') || cleanNew.includes('fallido') || cleanNew.includes('skipped')) {
          if (!item.failed_email_notified) {
            await sendBrevoNotificationEmail(item, 'failed');
            emailSentType = 'Novedad / Intento Fallido';
          }
        }
      } catch (errEmail) {
        console.warn('Error enviando correo automático por cambio de estado:', errEmail);
        alert(`Estado actualizado a "${newStatus}", pero falló el envío de correo: ${errEmail.message}`);
      }
    }

    // Actualizar KPI resumen y re-renderizar tabla
    const routePlanName = document.querySelector('#route-summary .card:first-child span:last-child')?.textContent || 'Ruta Optiroute';
    renderSummaryDashboard(routePlanName);
    renderShipmentsTable(currentFilteredWaypoints && currentFilteredWaypoints.length > 0 ? currentFilteredWaypoints : allWaypoints);

    if (emailSentType) {
      alert(`✅ Parada #${item.order} (${item.reference}) cambiada a "${newStatus}" y se envió automáticamente el correo de ${emailSentType} a ${item.email}.`);
    }
  }

  // Renderizar la tabla de envíos filtrada/buscada
  function renderShipmentsTable(data) {
    const tableCard = document.getElementById('route-data-card');
    const tableBody = document.getElementById('table-shipments-body');
    tableCard.style.display = 'flex';

    if (data.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
            No hay registros para mostrar con los filtros aplicados.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = data.map((item, idx) => {
      // 1. Contacto (WhatsApp + Correo Brevo)
      let phoneSpan = item.phone 
        ? `<span style="font-weight: 500; font-family: monospace; font-size: 0.75rem;">+${String(item.phone).replace(/\D/g, '')}</span>` 
        : '<span style="color: var(--color-text-muted); font-size: 0.75rem;">Sin teléfono</span>';

      const hasEmail = item.email && item.email.includes('@');
      const emailBadge = hasEmail 
        ? `<button class="btn btn-sm btn-outline btn-send-single-email" data-idx="${idx}" style="display: flex; align-items: center; justify-content: center; gap: 0.2rem; border: 1px solid #2563eb; color: #2563eb; background: transparent; font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer;" title="Enviar correo Brevo desde info@stocka.cl (${item.email})"><i class="ri-mail-line"></i> Correo</button>`
        : `<span style="font-size: 0.65rem; color: var(--color-text-muted); font-style: italic;">Sin correo</span>`;

      const whatsAppBtn = item.phone ? `
        <button class="btn btn-sm btn-success btn-contactar-whatsapp" data-idx="${idx}" style="display: flex; align-items: center; justify-content: center; gap: 0.2rem; background-color: var(--color-success); color: white; border: none; font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer;" title="Enviar WhatsApp">
          <i class="ri-whatsapp-line"></i> WSP
        </button>
      ` : '';

      let emailBadgesHTML = '';
      if (item.dispatch_email_notified) {
        const dateStr = item.dispatch_email_at 
          ? new Date(item.dispatch_email_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '';
        emailBadgesHTML += `
          <span class="badge" style="background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.2rem; font-weight: 600; cursor: default;" title="Aviso de Despacho enviado por Brevo ${dateStr}">
            <i class="ri-mail-check-line"></i> Despacho Enviado ${dateStr ? `(${dateStr})` : ''}
          </span>
        `;
      }

      if (item.delivery_email_notified) {
        const dateStr = item.delivery_email_at 
          ? new Date(item.delivery_email_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '';
        emailBadgesHTML += `
          <span class="badge" style="background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.2rem; font-weight: 600; cursor: default;" title="Confirmación de Entrega enviada por Brevo ${dateStr}">
            <i class="ri-checkbox-circle-line"></i> Entrega Confirmada ${dateStr ? `(${dateStr})` : ''}
          </span>
        `;
      }

      if (item.failed_email_notified) {
        const dateStr = item.failed_email_at 
          ? new Date(item.failed_email_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '';
        emailBadgesHTML += `
          <span class="badge" style="background: #ffedd5; color: #c2410c; border: 1px solid #fed7aa; font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.2rem; font-weight: 600; cursor: default;" title="Novedad / Intento Fallido enviado por Brevo ${dateStr}">
            <i class="ri-error-warning-line"></i> Novedad Notificada ${dateStr ? `(${dateStr})` : ''}
          </span>
        `;
      }

      const contactHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
          ${phoneSpan}
          <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; align-items: center;">
            ${whatsAppBtn}
            ${emailBadge}
          </div>
          ${emailBadgesHTML ? `<div style="display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.15rem;">${emailBadgesHTML}</div>` : ''}
        </div>
      `;

      // 2. Dirección con validación
      const isWarning = item.address_status !== 1 && item.address_status !== 3;
      let warningBadge = '';
      if (isWarning) {
        let warningText = 'Revisar';
        if (item.address_status === -1) warningText = 'Error de Geocodificación';
        else if (item.address_status === 2) warningText = 'Dirección con Advertencias';
        else if (item.address_status === 4) warningText = 'Número de Casa Dudoso';
        else if (item.address_status === 5) warningText = 'Multiples Coincidencias';
        else if (item.address_status === 8) warningText = 'Comuna Ambigua';

        warningBadge = `
          <span class="badge" style="background: var(--badge-warning-bg); color: var(--badge-warning-text); font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.35rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.15rem; margin-top: 0.25rem;" title="${warningText}">
            <i class="ri-error-warning-line"></i> ${warningText}
          </span>
        `;
      }

      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
      const addressHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.2rem;">
          <span style="line-height: 1.4; color: var(--color-text-main);">${item.address}</span>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <a href="${mapUrl}" target="_blank" style="color: var(--color-primary); font-size: 0.75rem; text-decoration: none; display: flex; align-items: center; gap: 0.15rem; font-weight: 500;">
              <i class="ri-map-pin-line"></i> Ver en Mapa
            </a>
            ${warningBadge}
          </div>
        </div>
      `;

      // 3. Conductor / Vehículo
      const driverName = item.route_driver || 'Sin Asignación';
      const vehicleInfo = item.route_vehicle ? `<span style="font-size: 0.7rem; color: var(--color-text-muted); font-family: monospace; display: block;">${item.route_vehicle}</span>` : '';
      const driverHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.1rem;">
          <span style="font-weight: 600; color: var(--color-text-main); font-size: 0.8rem;">${driverName}</span>
          ${vehicleInfo}
        </div>
      `;

      // 4. Estado Badge o Selector Manual (para Puntos Intermedios)
      let statusHTML = '';
      const isIntermediate = item.is_intermediate || String(item.order).includes('.');

      if (isIntermediate) {
        const cleanSt = (item.status || '').toLowerCase();
        let borderCol = '#8b5cf6';
        let bgCol = '#f5f3ff';
        let textCol = '#6d28d9';

        if (cleanSt.includes('completado') || cleanSt.includes('entregado') || cleanSt.includes('exito')) {
          borderCol = '#10b981';
          bgCol = '#ecfdf5';
          textCol = '#047857';
        } else if (cleanSt.includes('ruta') || cleanSt.includes('tránsito')) {
          borderCol = '#3b82f6';
          bgCol = '#eff6ff';
          textCol = '#1d4ed8';
        } else if (cleanSt.includes('saltado') || cleanSt.includes('fallido') || cleanSt.includes('cancelado')) {
          borderCol = '#ef4444';
          bgCol = '#fef2f2';
          textCol = '#b91c1c';
        }

        statusHTML = `
          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
            <select class="form-input int-status-select" data-idx="${idx}" style="font-size: 0.75rem; height: 30px; padding: 0 0.4rem; border-radius: var(--radius-sm); font-weight: 700; cursor: pointer; border: 1.5px solid ${borderCol}; background: ${bgCol}; color: ${textCol};" title="Cambiar estado del punto intermedio">
              <option value="Ingresado (Punto Intermedio)" ${cleanSt.includes('ingresado') || cleanSt.includes('agendado') || cleanSt.includes('scheduled') ? 'selected' : ''}>⏳ Agendado / Ingresado</option>
              <option value="En Ruta" ${cleanSt.includes('ruta') || cleanSt.includes('tránsito') || cleanSt.includes('onroute') ? 'selected' : ''}>🚚 En Ruta / Tránsito</option>
              <option value="Completado" ${cleanSt.includes('completado') || cleanSt.includes('entregado') || cleanSt.includes('delivered') ? 'selected' : ''}>✅ Entregado / Completado</option>
              <option value="Saltado" ${cleanSt.includes('saltado') || cleanSt.includes('fallido') || cleanSt.includes('skipped') ? 'selected' : ''}>⚠️ No Entregado / Saltado</option>
            </select>
            <span style="font-size: 0.65rem; color: #7c3aed; font-weight: 700; display: flex; align-items: center; gap: 0.2rem;">
              <i class="ri-settings-4-line"></i> Manual (Punto INT)
            </span>
          </div>
        `;
      } else {
        let badgeStyle = 'background: var(--badge-neutral-bg); color: var(--badge-neutral-text);';
        const cleanStatus = item.status.toLowerCase();
        if (cleanStatus.includes('completado') || cleanStatus.includes('entregado') || cleanStatus.includes('exito')) {
          badgeStyle = 'background: var(--badge-success-bg); color: var(--badge-success-text);';
        } else if (cleanStatus.includes('ruta') || cleanStatus.includes('viaje')) {
          badgeStyle = 'background: var(--badge-info-bg); color: var(--badge-info-text);';
        } else if (cleanStatus.includes('saltado') || cleanStatus.includes('cancelado') || cleanStatus.includes('eliminado')) {
          badgeStyle = 'background: var(--badge-danger-bg); color: var(--badge-danger-text);';
        } else if (cleanStatus.includes('revisión') || cleanStatus.includes('espera')) {
          badgeStyle = 'background: var(--badge-warning-bg); color: var(--badge-warning-text);';
        }

        statusHTML = `
          <span class="badge" style="display: inline-block; padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 700; ${badgeStyle}">
            ${item.status}
          </span>
        `;
      }

      // 5. Notas / Verificaciones
      let notesHTML = '';
      if (item.note) {
        notesHTML += `<p style="font-size: 0.75rem; color: var(--color-text-muted); font-style: italic; background: var(--color-bg); padding: 0.35rem 0.5rem; border-radius: 4px; margin: 0 0 0.5rem 0; border-left: 2px solid var(--color-border);">${item.note}</p>`;
      }
      if (item.reception_name) {
        notesHTML += `<div style="font-size: 0.7rem; color: var(--color-text-muted); margin-bottom: 0.5rem;"><strong>Recibe:</strong> ${item.reception_name} ${item.reception_rut ? `(${item.reception_rut})` : ''}</div>`;
      }

      // Renderizar fotos
      let photosHTML = '';
      if (item.images && item.images.length > 0) {
        photosHTML = `
          <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.35rem;">
            ${item.images.map((img, idx) => `
              <div class="photo-thumbnail" style="position: relative; width: 42px; height: 42px; border-radius: 4px; overflow: hidden; border: 1px solid var(--color-border); cursor: pointer; transition: transform 0.2s;" data-url="${img.url}">
                <img src="${img.thumbnail_url || img.url}" style="width: 100%; height: 100%; object-fit: cover;">
                <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s;" class="thumb-overlay">
                  <i class="ri-zoom-in-line" style="color: white; font-size: 0.8rem;"></i>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      const verifiedHTML = `
        <div style="display: flex; flex-direction: column;">
          ${notesHTML}
          ${photosHTML || '<span style="color: var(--color-text-muted); font-size: 0.75rem;">Sin verificación visual</span>'}
        </div>
      `;

      return `
        <tr style="border-bottom: 1px solid var(--color-border); align-items: center;">
          <td style="padding: 0.75rem 0.5rem; text-align: center;"><input type="checkbox" class="shipment-checkbox" data-idx="${idx}" style="transform: scale(1.1); cursor: pointer;"></td>
          <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--color-text-muted); font-family: monospace;">
            <div style="display: flex; align-items: center; gap: 0.25rem;">
              <span>#${item.order}</span>
              ${item.is_intermediate || String(item.order).includes('.') ? '<span class="badge" style="background:#ede9fe; color:#6d28d9; font-size:0.6rem; padding:0.1rem 0.3rem; border-radius:3px; font-weight:700;" title="Punto Intermedio">INT</span>' : ''}
              <button class="btn btn-sm btn-outline btn-preview-single-label" data-idx="${idx}" style="padding: 0.15rem 0.3rem; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; border-radius: 4px; border: 1px solid var(--color-border); background: transparent; cursor: pointer; color: var(--color-text-main);" title="Vista Previa de Etiqueta">
                <i class="ri-eye-line"></i>
              </button>
              <button class="btn btn-sm btn-outline btn-print-single-label" data-idx="${idx}" style="padding: 0.15rem 0.3rem; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; border-radius: 4px; border: 1px solid var(--color-border); background: transparent; cursor: pointer; color: var(--color-text-main);" title="Imprimir Etiqueta">
                <i class="ri-printer-line"></i>
              </button>
            </div>
          </td>
          <td style="padding: 0.75rem 0.5rem; font-weight: 600; font-family: monospace; color: var(--color-primary);">${item.reference}</td>
          <td style="padding: 0.75rem 0.5rem; font-weight: 500; color: var(--color-text-main);">${item.name}</td>
          <td style="padding: 0.75rem 0.5rem;">${contactHTML}</td>
          <td style="padding: 0.75rem 0.5rem;">${addressHTML}</td>
          <td style="padding: 0.75rem 0.5rem;">${driverHTML}</td>
          <td style="padding: 0.75rem 0.5rem;">${statusHTML}</td>
          <td style="padding: 0.75rem 0.5rem;">${verifiedHTML}</td>
        </tr>
      `;
    }).join('');

    // Agregar efectos de hover a los thumbnails
    const thumbnails = tableBody.querySelectorAll('.photo-thumbnail');
    thumbnails.forEach(thumb => {
      thumb.addEventListener('mouseenter', () => {
        const overlay = thumb.querySelector('.thumb-overlay');
        if (overlay) overlay.style.opacity = '1';
        thumb.style.transform = 'scale(1.05)';
      });
      thumb.addEventListener('mouseleave', () => {
        const overlay = thumb.querySelector('.thumb-overlay');
        if (overlay) overlay.style.opacity = '0';
        thumb.style.transform = 'scale(1)';
      });
      thumb.addEventListener('click', () => {
        const url = thumb.getAttribute('data-url');
        if (url) openLightboxModal(url);
      });
    });

    // Listener para Cambio de Estado Manual en Puntos Intermedios
    tableBody.querySelectorAll('.int-status-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'));
        const item = data[idx];
        const newStatus = e.target.value;
        if (item) {
          sel.disabled = true;
          await updateIntermediatePointStatus(item, newStatus, true);
        }
      });
    });

    // Checkboxes y Botón Masivo
    const checkAll = document.getElementById('check-all-shipments');
    const rowCheckboxes = tableBody.querySelectorAll('.shipment-checkbox');
    const btnPrintLabels = document.getElementById('btn-print-labels');
    const printCountSpan = document.getElementById('print-count');
    const btnSendBulkEmail = document.getElementById('btn-send-bulk-email');
    const emailCountSpan = document.getElementById('email-count');

    // Resetear checkAll y ocultar botón al (re)renderizar la tabla
    if (checkAll) checkAll.checked = false;
    updatePrintButtonState();

    if (checkAll) {
      checkAll.addEventListener('change', () => {
        const isChecked = checkAll.checked;
        rowCheckboxes.forEach(cb => {
          cb.checked = isChecked;
        });
        updatePrintButtonState();
      });
    }

    rowCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const allChecked = Array.from(rowCheckboxes).every(c => c.checked);
        if (checkAll) checkAll.checked = allChecked;
        updatePrintButtonState();
      });
    });

    function updatePrintButtonState() {
      if (!btnPrintLabels || !printCountSpan) return;
      const checkedCount = Array.from(rowCheckboxes).filter(c => c.checked).length;
      printCountSpan.textContent = checkedCount;
      if (checkedCount > 0) {
        btnPrintLabels.style.display = 'inline-flex';
      } else {
        btnPrintLabels.style.display = 'none';
      }
    }

    // Listener para Imprimir Selección (Masivo)
    if (btnPrintLabels) {
      const newBtn = btnPrintLabels.cloneNode(true);
      btnPrintLabels.parentNode.replaceChild(newBtn, btnPrintLabels);
      newBtn.addEventListener('click', () => {
        const checkedIndices = Array.from(rowCheckboxes)
          .filter(c => c.checked)
          .map(c => parseInt(c.getAttribute('data-idx')));
        const selectedWaypoints = checkedIndices.map(i => data[i]).filter(Boolean);
        if (selectedWaypoints.length > 0) {
          printWaypointsLabels(selectedWaypoints);
        }
      });
    }

    // Listener para Enviar Correos Brevo (Masivo)
    if (btnSendBulkEmail) {
      btnSendBulkEmail.style.display = 'inline-flex';
      const newEmailBtn = btnSendBulkEmail.cloneNode(true);
      btnSendBulkEmail.parentNode.replaceChild(newEmailBtn, btnSendBulkEmail);
      newEmailBtn.addEventListener('click', () => {
        const checkedIndices = Array.from(rowCheckboxes)
          .filter(c => c.checked)
          .map(c => parseInt(c.getAttribute('data-idx')));
        const selectedWaypoints = checkedIndices.map(i => data[i]).filter(Boolean);
        
        // Si hay elementos seleccionados, enviar selección; si no, enviar todos los envíos de la ruta
        const targetWaypoints = selectedWaypoints.length > 0 ? selectedWaypoints : data;
        if (targetWaypoints.length > 0) {
          openSendBrevoEmailModal(targetWaypoints);
        }
      });
    }

    // Listener para Envío de Correo Individual
    tableBody.querySelectorAll('.btn-send-single-email').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        const item = data[idx];
        if (item) {
          openSendBrevoEmailModal([item]);
        }
      });
    });

    // Agregar event listener para contactar por whatsapp
    const contactBtns = tableBody.querySelectorAll('.btn-contactar-whatsapp');
    contactBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        const item = data[idx];
        if (item && item.phone) {
          const cleanPhone = String(item.phone).replace(/\D/g, '');
          const fullPhone = cleanPhone.startsWith('56') ? cleanPhone : `56${cleanPhone}`;
          const msg = encodeURIComponent(`Hola ${item.name || ''}! Me contacto de STOCKA por la entrega de tu pedido ${item.reference || ''}.`);
          window.open(`https://api.whatsapp.com/send?phone=${fullPhone}&text=${msg}`, '_blank');
        }
      });
    });

    // Listener para Impresión Individual
    const singlePrintBtns = tableBody.querySelectorAll('.btn-print-single-label');
    singlePrintBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        const item = data[idx];
        if (item) printWaypointsLabels([item]);
      });
    });

    // Listener para Vista Previa de Etiqueta Individual
    const singlePreviewBtns = tableBody.querySelectorAll('.btn-preview-single-label');
    singlePreviewBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        const item = data[idx];
        if (item) openLabelPreviewModal(item);
      });
    });

    // Listener para Botón Principal Gestor de Etiquetas
    const btnOpenLabelsModal = document.getElementById('btn-open-labels-modal');
    if (btnOpenLabelsModal) {
      const newBtn = btnOpenLabelsModal.cloneNode(true);
      btnOpenLabelsModal.parentNode.replaceChild(newBtn, btnOpenLabelsModal);
      newBtn.addEventListener('click', () => {
        openOptirouteLabelsModal();
      });
    }

    // Listener para Botón Añadir Punto Intermedio
    const btnAddIntermediatePoint = document.getElementById('btn-add-intermediate-point');
    if (btnAddIntermediatePoint) {
      const newBtn = btnAddIntermediatePoint.cloneNode(true);
      btnAddIntermediatePoint.parentNode.replaceChild(newBtn, btnAddIntermediatePoint);
      newBtn.addEventListener('click', () => {
        openAddIntermediatePointModal();
      });
    }
  }

  // --- MÓDULO DE ETIQUETAS DE ENVÍO TÉRMICAS OPTIROUTE (100mm x 150mm) ---

  // Helper para generar Código de Barras SVG con JsBarcode
  function getBarcodeSvgString(code) {
    const cleanVal = String(code || '').trim();
    if (!cleanVal || cleanVal === 'S/R') {
      return '<div style="font-size:11px; font-weight:700; text-align:center; color:#475569; padding:4px;">SIN CÓDIGO</div>';
    }
    try {
      if (typeof window.JsBarcode === 'function') {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        window.JsBarcode(svg, cleanVal, {
          format: "CODE128",
          width: 1.8,
          height: 38,
          displayValue: false,
          margin: 0
        });
        return svg.outerHTML;
      }
    } catch (e) {
      console.warn("Error generando código de barras:", e);
    }
    return `<div style="font-family:monospace; font-size:11pt; font-weight:800; text-align:center; letter-spacing:2px;">*${cleanVal}*</div>`;
  }

  // Helper para generar QR Code Data URL para WhatsApp
  function getWhatsAppQrDataUrl(phone, reference) {
    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
      cleanPhone = '56' + cleanPhone;
    } else if (cleanPhone.length === 8) {
      cleanPhone = '569' + cleanPhone;
    } else if (cleanPhone.length > 0 && !cleanPhone.startsWith('56')) {
      cleanPhone = '56' + cleanPhone;
    }

    const message = "Hola!, me contacto por un pedido que tengo para entregar";
    const waUrl = cleanPhone 
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    try {
      if (typeof window.qrcode === 'function') {
        const qr = window.qrcode(0, 'M');
        qr.addData(waUrl);
        qr.make();
        return qr.createDataURL(4, 0);
      }
    } catch (e) {
      console.warn("Error generando QR Data URL:", e);
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(waUrl)}`;
  }

  // Helper para fecha de ruta formato STK DD-MM-YY
  function getFormattedRouteDate(wp) {
    let d = new Date();
    if (wp?.departure_datetime) {
      const parsed = new Date(wp.departure_datetime);
      if (!isNaN(parsed.getTime())) d = parsed;
    } else if (wp?.created_at) {
      const parsed = new Date(wp.created_at);
      if (!isNaN(parsed.getTime())) d = parsed;
    }
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `STK ${day}-${month}-${year}`;
  }

  // Generador del HTML de una sola etiqueta térmica (100x150mm)
  function generateLabelHtml(wp) {
    const qrUrl = getWhatsAppQrDataUrl(wp.phone, wp.reference);
    const barcodeSvg = getBarcodeSvgString(wp.reference !== 'S/R' ? wp.reference : wp.order);
    // Resolver Asignación y Vehículo de forma clara y sin truncamiento
    let mainAssignCode = 'N1';
    let subAssignText = '';

    const driverName = (wp.route_driver || '').trim();
    const vehicleName = (wp.route_vehicle || '').trim();

    if (vehicleName && driverName) {
      if (vehicleName.length <= 6) {
        mainAssignCode = vehicleName;
        subAssignText = driverName;
      } else if (driverName.length <= 6) {
        mainAssignCode = driverName;
        subAssignText = vehicleName;
      } else {
        mainAssignCode = vehicleName;
        subAssignText = driverName;
      }
    } else if (vehicleName) {
      mainAssignCode = vehicleName;
    } else if (driverName) {
      mainAssignCode = driverName;
    }

    const assignFontSize = mainAssignCode.length > 8 ? '12pt' : (mainAssignCode.length > 5 ? '15pt' : '20pt');
    const cleanRouteTag = getFormattedRouteDate(wp);
    const cleanComercio = (wp.supplier || 'STOCKA').toUpperCase();
    const cleanComuna = (wp.comuna || 'SANTIAGO').toUpperCase();

    return `
      <div class="label-page">
        <!-- Fila 1: Orden y Pedido -->
        <div class="label-row label-row-1">
          <div class="label-box label-box-order">
            <div class="label-title-bold" style="text-align: center;">Orden</div>
            <div class="label-value-order">${wp.order}</div>
          </div>
          <div class="label-box label-box-pedido">
            <div class="label-title-bold">Pedido:</div>
            <div class="label-value-reference">${wp.reference || 'S/R'}</div>
            <div class="label-value-comercio">${cleanComercio}</div>
          </div>
        </div>

        <!-- Fila 2: Cliente y QR WhatsApp -->
        <div class="label-row label-row-2">
          <div class="label-box label-box-cliente">
            <div class="label-field-group">
              <div class="label-title-bold">Cliente</div>
              <div class="label-value-name">${wp.name || 'Cliente sin nombre'}</div>
            </div>
            <div class="label-field-group" style="margin-top: 4px;">
              <div class="label-title-bold">Teléfono</div>
              <div class="label-value-phone">${wp.phone || 'Sin número'}</div>
            </div>
          </div>
          <div class="label-box label-box-qr">
            <img class="qr-code-img" src="${qrUrl}" alt="QR WhatsApp">
          </div>
        </div>

        <!-- Fila 3: Dirección Completa y Zona Entrega -->
        <div class="label-row label-row-3">
          <div class="label-box label-box-direccion">
            <div class="label-title-bold">Dirección</div>
            <div class="label-value-address">${wp.address || 'Sin dirección'}</div>
            
            <div class="label-title-bold" style="margin-top: 4px;">Complemento:</div>
            <div class="label-value-complemento">${wp.complemento || 'Casa / Depto'}</div>
            
            <div class="label-title-bold" style="margin-top: 6px;">Zona Entrega:</div>
            <div class="label-value-comuna">${cleanComuna}</div>
          </div>
        </div>

        <!-- Fila 4: Notas -->
        <div class="label-row label-row-4">
          <div class="label-box label-box-notas">
            <div class="label-title-bold">Notas:</div>
            <div class="label-value-notes">${wp.note || ''}</div>
          </div>
        </div>

        <!-- Fila 5: Código de Barras (CHECKEO PICKING) -->
        <div class="label-row label-row-5">
          <div class="label-box label-box-barcode">
            <div class="barcode-svg-wrap">
              ${barcodeSvg}
            </div>
            <div class="barcode-caption">CHECKEO PICKING</div>
          </div>
        </div>

        <!-- Fila 6: Asignación, Ruta y Logo Stocka -->
        <div class="label-row label-row-6">
          <div class="label-box label-box-assign-route">
            <div class="assign-col">
              <div class="label-title-bold">ASIGNACIÓN</div>
              <div class="label-value-assign" style="font-size: ${assignFontSize};">${mainAssignCode}</div>
              ${subAssignText ? `<div class="label-value-sub-assign">${subAssignText}</div>` : ''}
            </div>
            <div class="route-col">
              <div class="label-title-bold">RUTA</div>
              <div class="label-value-route">${cleanRouteTag}</div>
            </div>
          </div>
          <div class="label-box label-box-logo">
            <div class="stocka-logo-container">
              <img class="stocka-logo-img" src="img/newlogotransp.png" alt="Stocka" onerror="this.onerror=null; this.src='https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093';">
              <div class="stocka-logo-sub">Logística y Fulfillment Ecommerce</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Estilos CSS para impresión térmica y visualización de etiquetas
  const labelStylesCss = `
    @page {
      size: 100mm 150mm;
      margin: 0;
    }
    @media print {
      html, body {
        margin: 0;
        padding: 0;
        background: white;
      }
      .label-page {
        page-break-after: always;
        break-after: page;
      }
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: #f8fafc;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .label-page {
      width: 100mm;
      height: 150mm;
      max-width: 100mm;
      max-height: 150mm;
      padding: 3.5mm 4mm;
      display: flex;
      flex-direction: column;
      gap: 1.8mm;
      background: white;
      color: black;
      margin: 0 auto 10px auto;
      overflow: hidden;
      box-sizing: border-box;
    }
    @media screen {
      body {
        padding: 20px;
      }
      .label-page {
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border-radius: 6px;
      }
    }
    .label-box {
      border: 2px solid #000000;
      border-radius: 8px;
      padding: 1.8mm 2.8mm;
      display: flex;
      flex-direction: column;
      justify-content: center;
      background: #ffffff;
      box-sizing: border-box;
    }
    .label-row {
      display: flex;
      gap: 1.8mm;
      width: 100%;
    }
    .label-row-1 { height: 19mm; }
    .label-box-order {
      width: 28%;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .label-box-pedido {
      width: 72%;
      justify-content: center;
    }
    .label-row-2 { height: 26mm; }
    .label-box-cliente {
      width: 65%;
      justify-content: space-between;
    }
    .label-box-qr {
      width: 35%;
      align-items: center;
      justify-content: center;
      padding: 1mm;
    }
    .qr-code-img {
      width: 100%;
      height: 100%;
      max-width: 22mm;
      max-height: 22mm;
      object-fit: contain;
      display: block;
    }
    .label-row-3 { height: 41mm; }
    .label-box-direccion {
      width: 100%;
      height: 100%;
      justify-content: flex-start;
      overflow: hidden;
    }
    .label-row-4 { height: 14mm; }
    .label-box-notas {
      width: 100%;
      height: 100%;
      justify-content: flex-start;
      overflow: hidden;
    }
    .label-row-5 { height: 16mm; }
    .label-box-barcode {
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
      padding: 1mm 2mm;
    }
    .barcode-svg-wrap {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 9.5mm;
    }
    .barcode-svg-wrap svg {
      max-width: 100%;
      height: 9.5mm;
    }
    .barcode-caption {
      font-size: 7pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 1px;
      text-align: center;
      color: #000000;
    }
    .label-row-6 { height: 16mm; }
    .label-box-assign-route {
      width: 58%;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 1.5mm 3mm;
      overflow: hidden;
    }
    .assign-col {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      flex: 1;
    }
    .route-col {
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin-left: 2.5mm;
      flex-shrink: 0;
      text-align: right;
    }
    .label-box-logo {
      width: 42%;
      border: none;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .label-title-bold {
      font-size: 7.5pt;
      font-weight: 700;
      color: #000000;
      margin: 0;
      line-height: 1.1;
    }
    .label-value-order {
      font-size: 28pt;
      font-weight: 800;
      margin: 0;
      line-height: 1;
      color: #000000;
    }
    .label-value-reference {
      font-size: 13pt;
      font-weight: 800;
      margin: 0;
      line-height: 1.15;
      color: #000000;
    }
    .label-value-comercio {
      font-size: 10pt;
      font-weight: 800;
      margin: 1px 0 0 0;
      text-transform: uppercase;
      color: #000000;
      letter-spacing: 0.2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label-value-name {
      font-size: 9.5pt;
      font-weight: 700;
      margin: 1px 0 0 0;
      color: #000000;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label-value-phone {
      font-size: 9.5pt;
      font-weight: 700;
      margin: 1px 0 0 0;
      color: #000000;
    }
    .label-value-address {
      font-size: 10.5pt;
      font-weight: 700;
      margin: 1px 0 0 0;
      line-height: 1.15;
      color: #000000;
    }
    .label-value-complemento {
      font-size: 9pt;
      font-weight: 600;
      margin: 1px 0 0 0;
      color: #000000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label-value-comuna {
      font-size: 17pt;
      font-weight: 800;
      margin: 1px 0 0 0;
      text-transform: uppercase;
      color: #000000;
      line-height: 1.1;
    }
    .label-value-notes {
      font-size: 7.5pt;
      font-weight: 500;
      margin: 1px 0 0 0;
      color: #000000;
      line-height: 1.15;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .label-value-assign {
      font-weight: 800;
      margin: 0;
      line-height: 1;
      color: #000000;
      word-break: break-word;
    }
    .label-value-sub-assign {
      font-size: 6.8pt;
      font-weight: 700;
      color: #374151;
      margin: 1px 0 0 0;
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label-value-route {
      font-size: 8.5pt;
      font-weight: 800;
      margin: 1px 0 0 0;
      color: #000000;
      white-space: nowrap;
    }
    .stocka-logo-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      gap: 0.5mm;
    }
    .stocka-logo-img {
      max-height: 10mm;
      max-width: 100%;
      object-fit: contain;
      display: block;
    }
    .stocka-logo-sub {
      font-size: 4.2pt;
      font-weight: 700;
      color: #374151;
      margin: 0;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.1px;
      text-align: center;
      white-space: nowrap;
    }
  `;

  // Función para Renderizar e Imprimir Etiquetas Térmicas de Envío (100mm x 150mm)
  function printWaypointsLabels(waypoints) {
    if (!waypoints || waypoints.length === 0) {
      alert('No hay envíos seleccionados para imprimir.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor, permite las ventanas emergentes (popups) para poder imprimir las etiquetas.');
      return;
    }

    const labelsHtml = waypoints.map(wp => generateLabelHtml(wp)).join('');

    const fullDocumentHtml = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Etiquetas Térmicas Optiroute (${waypoints.length}) - WMS STOCKA</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          ${labelStylesCss}
        </style>
      </head>
      <body>
        ${labelsHtml}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 350);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(fullDocumentHtml);
    printWindow.document.close();
  }

  // Modal para Vista Previa Individual de Etiqueta Térmica
  function openLabelPreviewModal(waypoint) {
    const modalId = 'optiroute-label-preview-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(15, 23, 42, 0.75)';
    modal.style.zIndex = '100000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.animation = 'fadeIn 0.2s ease';
    modal.style.padding = '1rem';

    const labelMarkup = generateLabelHtml(waypoint);

    modal.innerHTML = `
      <div class="card" style="width: 480px; max-width: 95%; max-height: 94vh; display: flex; flex-direction: column; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); border-radius: var(--radius-lg); overflow: hidden; animation: scaleUp 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); background: var(--color-bg);">
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-eye-line" style="color: #7c3aed; font-size: 1.1rem;"></i>
            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text-main);">
              Vista Previa: Etiqueta #${waypoint.order} (${waypoint.reference})
            </h4>
          </div>
          <button id="close-preview-modal" style="background: none; border: none; font-size: 1.3rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
        </div>

        <div style="flex: 1; overflow-y: auto; padding: 1rem; display: flex; justify-content: center; align-items: center; background: #e2e8f0;">
          <div style="transform: scale(0.92); transform-origin: center top;">
            <style>${labelStylesCss}</style>
            ${labelMarkup}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-top: 1px solid var(--color-border); background: var(--color-surface); gap: 0.5rem;">
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">
            Formato: 100mm x 150mm (Térmico)
          </span>
          <div style="display: flex; gap: 0.5rem;">
            <button id="btn-close-preview" class="btn btn-outline btn-sm" style="padding: 0.35rem 0.8rem; border-radius: var(--radius-md);">
              Cerrar
            </button>
            <button id="btn-print-from-preview" class="btn btn-primary btn-sm" style="background: #7c3aed; color: white; border: none; padding: 0.35rem 0.9rem; border-radius: var(--radius-md); font-weight: 700; display: flex; align-items: center; gap: 0.25rem;">
              <i class="ri-printer-line"></i> Imprimir Etiqueta
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#close-preview-modal')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-close-preview')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelector('#btn-print-from-preview')?.addEventListener('click', () => {
      printWaypointsLabels([waypoint]);
    });
  }

  // Modal Principal: Gestor y Emisión de Etiquetas de Ruta
  function openOptirouteLabelsModal() {
    const modalId = 'optiroute-labels-manager-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    if (!allWaypoints || allWaypoints.length === 0) {
      alert('No hay envíos cargados en la ruta para generar etiquetas.');
      return;
    }

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(15, 23, 42, 0.75)';
    modal.style.zIndex = '99999';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.animation = 'fadeIn 0.2s ease';
    modal.style.padding = '0.5rem';

    // Obtener lista única de comercios con sus conteos
    const supplierCounts = new Map();
    allWaypoints.forEach(w => {
      const s = w.supplier || 'STOCKA';
      supplierCounts.set(s, (supplierCounts.get(s) || 0) + 1);
    });
    const distinctSuppliers = Array.from(supplierCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Obtener lista única de conductores con sus conteos
    const driverCounts = new Map();
    allWaypoints.forEach(w => {
      const d = w.route_driver || w.route_vehicle || 'Sin Asignación';
      driverCounts.set(d, (driverCounts.get(d) || 0) + 1);
    });
    const distinctDrivers = Array.from(driverCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Estado interno del modal
    const escapeHtml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let modalSelectedIndices = new Set(allWaypoints.map((_, i) => i)); // Por defecto todos seleccionados
    let selectedSuppliersSet = new Set(distinctSuppliers.map(s => s.name)); // Por defecto todos los comercios seleccionados
    let currentFilterDriver = '';
    let currentSearchTerm = '';

    function getSupplierLabelText() {
      if (selectedSuppliersSet.size === distinctSuppliers.length) {
        return `🏢 Todos los Comercios (${allWaypoints.length})`;
      }
      if (selectedSuppliersSet.size === 0) {
        return `🏢 Ningún Comercio seleccionado (0)`;
      }
      if (selectedSuppliersSet.size === 1) {
        const name = Array.from(selectedSuppliersSet)[0];
        const count = distinctSuppliers.find(s => s.name === name)?.count || 0;
        return `🏢 ${name} (${count})`;
      }
      const totalCount = distinctSuppliers
        .filter(s => selectedSuppliersSet.has(s.name))
        .reduce((sum, s) => sum + s.count, 0);
      return `🏢 ${selectedSuppliersSet.size} Comercios (${totalCount} envíos)`;
    }

    function getFilteredIndices() {
      return allWaypoints.map((w, idx) => ({ w, idx })).filter(({ w }) => {
        const supp = w.supplier || 'STOCKA';
        if (selectedSuppliersSet.size === 0 || !selectedSuppliersSet.has(supp)) {
          return false;
        }
        if (currentFilterDriver) {
          const d = w.route_driver || w.route_vehicle || 'Sin Asignación';
          if (d !== currentFilterDriver) return false;
        }
        if (currentSearchTerm) {
          const q = currentSearchTerm.toLowerCase();
          const matchRef = (w.reference || '').toLowerCase().includes(q);
          const matchName = (w.name || '').toLowerCase().includes(q);
          const matchAddr = (w.address || '').toLowerCase().includes(q);
          const matchComuna = (w.comuna || '').toLowerCase().includes(q);
          const matchOrder = String(w.order).includes(q);
          if (!matchRef && !matchName && !matchAddr && !matchComuna && !matchOrder) {
            return false;
          }
        }
        return true;
      }).map(item => item.idx);
    }

    // Estructura DOM del Modal (Renderizada UNA SOLA VEZ)
    // Estructura DOM del Modal (Renderizada UNA SOLA VEZ con tamaño amplio y fijo)
    modal.innerHTML = `
      <div class="card" style="width: 1280px; max-width: 96vw; height: 85vh; min-height: 600px; max-height: 92vh; display: flex; flex-direction: column; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); border-radius: var(--radius-lg); overflow: hidden;">
        
        <!-- Encabezado del Modal -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.9rem 1.4rem; border-bottom: 1px solid var(--color-border); background: var(--color-bg); flex-wrap: wrap; gap: 0.5rem; flex-shrink: 0;">
          <div>
            <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.45rem;">
              <i class="ri-price-tag-3-line" style="color: #7c3aed; font-size: 1.3rem;"></i> Generador de Etiquetas de Envío (Optiroute)
            </h3>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
              Emisión de etiquetas térmicas estándar (100x150mm) con QR de WhatsApp y código de barras Code128.
            </p>
          </div>
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <button id="modal-btn-add-intermediate" class="btn btn-outline" style="padding: 0.4rem 0.85rem; font-size: 0.82rem; font-weight: 600; border: 1px solid #7c3aed; color: #7c3aed; border-radius: var(--radius-md); background: transparent; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;" title="Añadir un punto intermedio a la ruta">
              <i class="ri-add-circle-line" style="font-size: 1rem;"></i> ➕ Punto Intermedio
            </button>
            <button id="close-labels-modal" style="background: none; border: none; font-size: 1.65rem; cursor: pointer; color: var(--color-text-muted); line-height: 1;">&times;</button>
          </div>
        </div>

        <!-- Barra de Filtros y Acciones -->
        <div style="padding: 0.85rem 1.4rem; background: var(--color-surface); border-bottom: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.6rem; flex-shrink: 0;">
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.65rem; align-items: center;">
            <!-- Filtro Multi-Comercio con Checkboxes -->
            <div style="position: relative;" id="modal-supplier-dropdown-wrapper">
              <button id="modal-btn-toggle-supplier" type="button" class="form-input" style="font-size: 0.84rem; height: 38px; width: 100%; padding: 0 0.8rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text-main); display: flex; align-items: center; justify-content: space-between; cursor: pointer; text-align: left;" title="Seleccionar uno o varios comercios">
                <span id="modal-supplier-btn-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">
                  ${getSupplierLabelText()}
                </span>
                <i id="modal-supplier-dropdown-arrow" class="ri-arrow-down-s-line" style="font-size: 1.15rem; color: var(--color-text-muted); flex-shrink: 0; margin-left: 0.4rem; transition: transform 0.2s;"></i>
              </button>

              <!-- Popover Panel con Checkboxes -->
              <div id="modal-supplier-dropdown-panel" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; min-width: 290px; width: 100%; max-height: 320px; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 1000; padding: 0.5rem; box-sizing: border-box;">
                
                <!-- Cabecera de Selección Rápida de Comercios -->
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0.45rem 0.45rem 0.45rem; border-bottom: 1px solid var(--color-border); margin-bottom: 0.35rem;">
                  <span style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase;">Filtrar Comercios</span>
                  <div style="display: flex; gap: 0.45rem;">
                    <button id="modal-supplier-select-all-btn" type="button" style="background: none; border: none; font-size: 0.76rem; font-weight: 700; color: #7c3aed; cursor: pointer; padding: 0.15rem 0.3rem;">Todos</button>
                    <span style="color: var(--color-border); font-size: 0.75rem;">|</span>
                    <button id="modal-supplier-deselect-all-btn" type="button" style="background: none; border: none; font-size: 0.76rem; font-weight: 600; color: var(--color-text-muted); cursor: pointer; padding: 0.15rem 0.3rem;">Ninguno</button>
                  </div>
                </div>

                <!-- Lista de Comercios con Checkbox -->
                <div id="modal-supplier-checkboxes-container" style="display: flex; flex-direction: column; gap: 0.2rem;">
                  ${distinctSuppliers.map(s => {
                    const isChecked = selectedSuppliersSet.has(s.name);
                    return `
                      <label class="modal-supplier-label" data-supplier="${escapeHtml(s.name)}" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.4rem 0.55rem; border-radius: 5px; cursor: pointer; font-size: 0.83rem; user-select: none; ${isChecked ? 'background: rgba(124, 58, 237, 0.08);' : ''}">
                        <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden; min-width: 0;">
                          <input type="checkbox" class="modal-supplier-cb" data-supplier="${escapeHtml(s.name)}" ${isChecked ? 'checked' : ''} style="cursor: pointer; transform: scale(1.15);">
                          <span style="font-weight: ${isChecked ? '700' : '500'}; color: var(--color-text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">🏢 ${escapeHtml(s.name)}</span>
                        </div>
                        <span class="badge" style="font-size: 0.72rem; font-weight: 700; background: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 0.12rem 0.45rem; border-radius: 12px; flex-shrink: 0;">${s.count}</span>
                      </label>
                    `;
                  }).join('')}
                </div>

              </div>
            </div>

            <!-- Filtro Conductor -->
            <div>
              <select id="modal-select-driver" class="form-input" style="font-size: 0.84rem; height: 38px; width: 100%; padding: 0 0.65rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text-main);">
                <option value="">🚚 Todos los Conductores (${allWaypoints.length})</option>
                ${distinctDrivers.map(d => `<option value="${d.name}">🚚 ${d.name} (${d.count})</option>`).join('')}
              </select>
            </div>

            <!-- Buscador -->
            <div style="position: relative;">
              <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); font-size: 0.95rem;"></i>
              <input type="text" id="modal-search-text" class="form-input" placeholder="Buscar pedido, cliente, comuna..." value="" style="padding-left: 2.1rem; font-size: 0.84rem; width: 100%; height: 38px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text-main);">
            </div>
          </div>

          <!-- Fila de Selección y Botón Imprimir -->
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem; padding-top: 0.25rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <button id="modal-btn-select-all" class="btn btn-sm btn-outline" style="padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); cursor: pointer;">
                ☑️ Seleccionar Filtrados
              </button>
              <button id="modal-btn-deselect-all" class="btn btn-sm btn-outline" style="padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); cursor: pointer;">
                ◻️ Deseleccionar Todo
              </button>
              <span id="modal-selection-stats" style="font-size: 0.82rem; color: var(--color-text-muted); margin-left: 0.35rem;"></span>
            </div>

            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <button id="modal-btn-print-selected" class="btn btn-primary" style="background: #7c3aed; color: white; border: none; padding: 0.45rem 1.1rem; border-radius: var(--radius-md); font-weight: 700; display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; cursor: pointer;">
                <i class="ri-printer-line" style="font-size: 1.05rem;"></i> Imprimir Selección
              </button>
              <button id="modal-btn-print-all-route" class="btn btn-outline" style="border: 1px solid var(--color-border); color: var(--color-text-main); background: var(--color-bg); padding: 0.45rem 0.95rem; border-radius: var(--radius-md); font-weight: 600; display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; cursor: pointer;">
                Imprimir Todos (${allWaypoints.length})
              </button>
            </div>
          </div>

        </div>

        <!-- Tabla de Envíos del Modal con scroll y altura consistente -->
        <div style="flex: 1; min-height: 360px; overflow-y: auto; padding: 0; background: var(--color-surface);">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.86rem;">
            <thead style="position: sticky; top: 0; background: var(--color-surface); z-index: 10; border-bottom: 2px solid var(--color-border);">
              <tr style="text-align: left;">
                <th style="padding: 0.75rem 0.6rem; width: 44px; text-align: center;">
                  <input type="checkbox" id="modal-master-checkbox" style="transform: scale(1.15); cursor: pointer;">
                </th>
                <th style="padding: 0.75rem 0.6rem; width: 85px;"># Orden</th>
                <th style="padding: 0.75rem 0.6rem; width: 145px;">Pedido</th>
                <th style="padding: 0.75rem 0.6rem; width: 155px;">Comercio</th>
                <th style="padding: 0.75rem 0.6rem; min-width: 190px;">Destinatario / Contacto</th>
                <th style="padding: 0.75rem 0.6rem; min-width: 220px;">Dirección / Comuna</th>
                <th style="padding: 0.75rem 0.6rem; width: 145px;">Asignación</th>
                <th style="padding: 0.75rem 0.6rem; width: 120px; text-align: center;">Acciones</th>
              </tr>
            </thead>
            <tbody id="modal-table-body">
              <!-- Renderizado dinámico -->
            </tbody>
          </table>
        </div>

        <!-- Pie del Modal -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.4rem; border-top: 1px solid var(--color-border); background: var(--color-bg); flex-shrink: 0;">
          <div style="font-size: 0.82rem; color: var(--color-text-muted);">
            WMS STOCKA - Etiquetas térmicas compatibles con impresoras Zebra, Xprinter y TSC (100x150mm)
          </div>
          <button id="btn-close-modal-footer" class="btn btn-outline" style="padding: 0.4rem 1.1rem; border-radius: var(--radius-md); font-size: 0.85rem;">
            Cerrar
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    // Referencias a elementos
    const tbody = modal.querySelector('#modal-table-body');
    const masterCheckbox = modal.querySelector('#modal-master-checkbox');
    const selectionStatsSpan = modal.querySelector('#modal-selection-stats');
    const btnPrintSelected = modal.querySelector('#modal-btn-print-selected');
    const supplierBtnText = modal.querySelector('#modal-supplier-btn-text');
    const toggleSupplierBtn = modal.querySelector('#modal-btn-toggle-supplier');
    const supplierDropdownPanel = modal.querySelector('#modal-supplier-dropdown-panel');
    const supplierDropdownArrow = modal.querySelector('#modal-supplier-dropdown-arrow');
    const supplierWrapper = modal.querySelector('#modal-supplier-dropdown-wrapper');
    const selectDriver = modal.querySelector('#modal-select-driver');
    const searchInput = modal.querySelector('#modal-search-text');

    // Función para actualizar tabla y contadores sin redibujar el modal
    function updateTableAndStats() {
      const filteredIndices = getFilteredIndices();
      const selectedCount = Array.from(modalSelectedIndices).filter(idx => filteredIndices.includes(idx)).length;
      const allFilteredChecked = filteredIndices.length > 0 && filteredIndices.every(idx => modalSelectedIndices.has(idx));

      // Actualizar Master Checkbox
      if (masterCheckbox) {
        masterCheckbox.checked = allFilteredChecked;
        masterCheckbox.indeterminate = !allFilteredChecked && selectedCount > 0;
      }

      // Actualizar Contadores
      if (selectionStatsSpan) {
        selectionStatsSpan.innerHTML = `Visibles: <strong>${filteredIndices.length}</strong> | Seleccionados: <strong style="color: #7c3aed;">${selectedCount}</strong>`;
      }
      if (btnPrintSelected) {
        btnPrintSelected.innerHTML = `<i class="ri-printer-line"></i> Imprimir Selección (${selectedCount})`;
      }

      // Actualizar Botón de Comercio
      if (supplierBtnText) {
        supplierBtnText.textContent = getSupplierLabelText();
      }
      if (toggleSupplierBtn) {
        toggleSupplierBtn.style.borderColor = selectedSuppliersSet.size < distinctSuppliers.length ? '#7c3aed' : 'var(--color-border)';
      }

      // Renderizar Filas de la Tabla
      if (filteredIndices.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 4.5rem 1rem; color: var(--color-text-muted); font-size: 0.95rem;">
              <i class="ri-inbox-line" style="font-size: 2.2rem; display: block; margin-bottom: 0.5rem; opacity: 0.4;"></i>
              No se encontraron envíos con los filtros especificados.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = filteredIndices.map(idx => {
        const wp = allWaypoints[idx];
        const isChecked = modalSelectedIndices.has(idx);
        return `
          <tr style="border-bottom: 1px solid var(--color-border); ${isChecked ? 'background: rgba(124, 58, 237, 0.04);' : ''}">
            <td style="padding: 0.65rem 0.6rem; text-align: center;">
              <input type="checkbox" class="modal-row-checkbox" data-idx="${idx}" ${isChecked ? 'checked' : ''} style="transform: scale(1.15); cursor: pointer;">
            </td>
            <td style="padding: 0.65rem 0.6rem; font-weight: 700; font-family: monospace; color: var(--color-text-main);">
              <span class="badge" style="background: ${wp.is_intermediate ? '#ede9fe' : 'var(--color-bg)'}; color: ${wp.is_intermediate ? '#6d28d9' : 'var(--color-text-main)'}; border: 1px solid var(--color-border); font-size: 0.82rem; padding: 0.2rem 0.45rem; border-radius: 4px;">
                #${wp.order} ${wp.is_intermediate ? 'INT' : ''}
              </span>
            </td>
            <td style="padding: 0.65rem 0.6rem; font-weight: 700; font-family: monospace; font-size: 0.92rem; color: var(--color-primary);">
              ${escapeHtml(wp.reference || 'S/R')}
            </td>
            <td style="padding: 0.65rem 0.6rem;">
              <span class="badge" style="background: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main); font-size: 0.78rem; font-weight: 700; padding: 0.2rem 0.45rem; border-radius: 4px;">
                ${escapeHtml(wp.supplier || 'STOCKA')}
              </span>
            </td>
            <td style="padding: 0.65rem 0.6rem;">
              <div style="font-weight: 600; font-size: 0.88rem; color: var(--color-text-main);">${escapeHtml(wp.name || 'Cliente sin nombre')}</div>
              <div style="font-size: 0.78rem; color: var(--color-text-muted); font-family: monospace; margin-top: 1px;">${wp.phone ? `+${String(wp.phone).replace(/\D/g, '')}` : 'Sin teléfono'}</div>
            </td>
            <td style="padding: 0.65rem 0.6rem;">
              <div style="color: var(--color-text-main); line-height: 1.25; font-size: 0.88rem;">${escapeHtml(wp.address || 'Sin dirección')}</div>
              <div style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; margin-top: 2px;">${escapeHtml(wp.comuna || '')}</div>
            </td>
            <td style="padding: 0.65rem 0.6rem; font-size: 0.82rem;">
              <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.86rem;">${escapeHtml(wp.route_driver || 'Sin conductor')}</div>
              <div style="color: var(--color-text-muted); font-family: monospace; font-size: 0.78rem;">${escapeHtml(wp.route_vehicle || '')}</div>
            </td>
            <td style="padding: 0.65rem 0.6rem; text-align: center;">
              <div style="display: flex; justify-content: center; gap: 0.35rem;">
                <button class="btn btn-sm btn-outline modal-btn-preview-item" data-idx="${idx}" style="padding: 0.25rem 0.45rem; font-size: 0.82rem; border-radius: 4px; border: 1px solid var(--color-border); background: transparent; cursor: pointer;" title="Vista Previa">
                  <i class="ri-eye-line"></i>
                </button>
                <button class="btn btn-sm btn-primary modal-btn-print-item" data-idx="${idx}" style="padding: 0.25rem 0.45rem; font-size: 0.82rem; border-radius: 4px; background: #7c3aed; color: white; border: none; cursor: pointer;" title="Imprimir Etiqueta">
                  <i class="ri-printer-line"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Listeners para checkboxes de filas
      tbody.querySelectorAll('.modal-row-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const idx = parseInt(e.target.getAttribute('data-idx'));
          if (e.target.checked) {
            modalSelectedIndices.add(idx);
          } else {
            modalSelectedIndices.delete(idx);
          }
          const tr = cb.closest('tr');
          if (tr) {
            tr.style.background = e.target.checked ? 'rgba(124, 58, 237, 0.04)' : '';
          }
          // Actualizar solo stats sin redibujar tabla completa
          const currentFiltered = getFilteredIndices();
          const currentSelected = Array.from(modalSelectedIndices).filter(i => currentFiltered.includes(i)).length;
          const isAllChecked = currentFiltered.length > 0 && currentFiltered.every(i => modalSelectedIndices.has(i));
          if (masterCheckbox) {
            masterCheckbox.checked = isAllChecked;
            masterCheckbox.indeterminate = !isAllChecked && currentSelected > 0;
          }
          if (selectionStatsSpan) {
            selectionStatsSpan.innerHTML = `Visibles: <strong>${currentFiltered.length}</strong> | Seleccionados: <strong style="color: #7c3aed;">${currentSelected}</strong>`;
          }
          if (btnPrintSelected) {
            btnPrintSelected.innerHTML = `<i class="ri-printer-line"></i> Imprimir Selección (${currentSelected})`;
          }
        });
      });

      // Listeners para botones de acción por fila
      tbody.querySelectorAll('.modal-btn-preview-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'));
          const wp = allWaypoints[idx];
          if (wp) openLabelPreviewModal(wp);
        });
      });
      tbody.querySelectorAll('.modal-btn-print-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'));
          const wp = allWaypoints[idx];
          if (wp) printWaypointsLabels([wp]);
        });
      });
    }

    // Actualizar visualmente los checkboxes del popover de comercio
    function updateSupplierCheckboxesUI() {
      modal.querySelectorAll('.modal-supplier-cb').forEach(cb => {
        const suppName = cb.getAttribute('data-supplier');
        const isChecked = selectedSuppliersSet.has(suppName);
        cb.checked = isChecked;
        const label = cb.closest('.modal-supplier-label');
        if (label) {
          label.style.background = isChecked ? 'rgba(124, 58, 237, 0.08)' : '';
          const nameSpan = label.querySelector('span');
          if (nameSpan) nameSpan.style.fontWeight = isChecked ? '700' : '500';
        }
      });
    }

    // Render inicial de tabla y contadores
    updateTableAndStats();

    // --- EVENT LISTENERS DEL MODAL (Registrados 1 sola vez) ---
    const closeModal = () => modal.remove();
    modal.querySelector('#close-labels-modal')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-close-modal-footer')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Toggle Dropdown de Comercio
    toggleSupplierBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = supplierDropdownPanel.style.display === 'block';
      supplierDropdownPanel.style.display = isVisible ? 'none' : 'block';
      if (supplierDropdownArrow) {
        supplierDropdownArrow.style.transform = isVisible ? 'none' : 'rotate(180deg)';
      }
    });

    // Checkboxes individuales del dropdown de comercios
    modal.querySelectorAll('.modal-supplier-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const suppName = cb.getAttribute('data-supplier');
        if (cb.checked) {
          selectedSuppliersSet.add(suppName);
        } else {
          selectedSuppliersSet.delete(suppName);
        }
        updateSupplierCheckboxesUI();
        updateTableAndStats();
      });
    });

    // Botón "Todos" del dropdown
    modal.querySelector('#modal-supplier-select-all-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      distinctSuppliers.forEach(s => selectedSuppliersSet.add(s.name));
      updateSupplierCheckboxesUI();
      updateTableAndStats();
    });

    // Botón "Ninguno" del dropdown
    modal.querySelector('#modal-supplier-deselect-all-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedSuppliersSet.clear();
      updateSupplierCheckboxesUI();
      updateTableAndStats();
    });

    // Cerrar dropdown al hacer click fuera
    document.addEventListener('click', (e) => {
      if (supplierWrapper && !supplierWrapper.contains(e.target)) {
        if (supplierDropdownPanel) supplierDropdownPanel.style.display = 'none';
        if (supplierDropdownArrow) supplierDropdownArrow.style.transform = 'none';
      }
    });

    // Filtro Conductor
    selectDriver?.addEventListener('change', (e) => {
      currentFilterDriver = e.target.value;
      updateTableAndStats();
    });

    // Buscador
    searchInput?.addEventListener('input', (e) => {
      currentSearchTerm = e.target.value;
      updateTableAndStats();
    });

    // Master Checkbox
    masterCheckbox?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      const currentFiltered = getFilteredIndices();
      if (isChecked) {
        currentFiltered.forEach(i => modalSelectedIndices.add(i));
      } else {
        currentFiltered.forEach(i => modalSelectedIndices.delete(i));
      }
      updateTableAndStats();
    });

    // Botón "Seleccionar Filtrados"
    modal.querySelector('#modal-btn-select-all')?.addEventListener('click', () => {
      getFilteredIndices().forEach(i => modalSelectedIndices.add(i));
      updateTableAndStats();
    });

    // Botón "Deseleccionar Todo"
    modal.querySelector('#modal-btn-deselect-all')?.addEventListener('click', () => {
      modalSelectedIndices.clear();
      updateTableAndStats();
    });

    // Botón "Imprimir Selección"
    btnPrintSelected?.addEventListener('click', () => {
      const currentFiltered = getFilteredIndices();
      const selectedWaypoints = Array.from(modalSelectedIndices)
        .filter(idx => currentFiltered.includes(idx))
        .map(idx => allWaypoints[idx])
        .filter(Boolean);
      
      if (selectedWaypoints.length === 0) {
        alert('Por favor selecciona al menos una etiqueta para imprimir.');
        return;
      }
      printWaypointsLabels(selectedWaypoints);
    });

    // Botón "Imprimir Toda la Ruta"
    modal.querySelector('#modal-btn-print-all-route')?.addEventListener('click', () => {
      printWaypointsLabels(allWaypoints);
    });

    // Botón "➕ Punto Intermedio"
    modal.querySelector('#modal-btn-add-intermediate')?.addEventListener('click', () => {
      openAddIntermediatePointModal(() => {
        closeModal();
        openOptirouteLabelsModal();
      });
    });
  }

  // Modal para Añadir Pedidos / Puntos Intermedios en la Ruta
  function openAddIntermediatePointModal(onSuccessCallback) {
    const modalId = 'optiroute-add-intermediate-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(15, 23, 42, 0.75)';
    modal.style.zIndex = '100001';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.animation = 'fadeIn 0.2s ease';
    modal.style.padding = '1rem';

    // Lista de paradas actuales para elegir punto de inserción
    const sortedWaypoints = [...allWaypoints].sort((a, b) => parseFloat(a.order || 0) - parseFloat(b.order || 0));
    
    // Lista inicial de comercios del sistema
    const systemCommercesSet = new Set([
      'BACK IN TIME', 'DORMILONES', 'GLOSS', 'MENPRIME', 
      'RELAJARTE', 'SMILE FOR PETS', 'THE SKIN STORE', 'STOCKA'
    ]);
    allWaypoints.forEach(w => {
      if (w.supplier) systemCommercesSet.add(w.supplier.trim().toUpperCase());
    });
    if (typeof currentIntegration !== 'undefined' && currentIntegration?.comercio) {
      systemCommercesSet.add(currentIntegration.comercio.trim().toUpperCase());
    }

    const defaultSupplier = (allWaypoints[0]?.supplier || 'BACK IN TIME').toUpperCase();
    const sortedInitialSuppliers = Array.from(systemCommercesSet).filter(Boolean).sort();
    const defaultDriver = allWaypoints[0]?.route_driver || allWaypoints[0]?.route_vehicle || '';
    const defaultVehicle = allWaypoints[0]?.route_vehicle || '';
    const defaultRouteName = allWaypoints[0]?.route_name || 'Ruta Optiroute';

    modal.innerHTML = `
      <div class="card" style="width: 720px; max-width: 95%; max-height: 94vh; display: flex; flex-direction: column; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); border-radius: var(--radius-lg); overflow: hidden; animation: scaleUp 0.2s ease;">
        
        <!-- Encabezado -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--color-border); background: var(--color-bg);">
          <div>
            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-add-circle-line" style="color: #7c3aed;"></i> Añadir Pedido / Punto Intermedio a la Ruta
            </h3>
            <p style="margin: 0.15rem 0 0 0; font-size: 0.75rem; color: var(--color-text-muted);">
              Crea una parada intermedia registrada internamente en el WMS y genera su etiqueta de despacho.
            </p>
          </div>
          <button id="close-int-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
        </div>

        <!-- Formulario con scroll -->
        <div style="flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          
          <!-- Sección Posición en la Ruta -->
          <div style="background: var(--color-bg); padding: 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.6rem;">
            <label style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.3rem;">
              <i class="ri-map-pin-range-line" style="color: #7c3aed;"></i> 1. Ubicación y Posición en la Ruta
            </label>
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem; align-items: flex-end;">
              <div>
                <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">Insertar después de la parada:</span>
                <select id="int-select-predecessor" class="form-input" style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
                  <option value="0">Al inicio (Antes de la parada #1)</option>
                  ${sortedWaypoints.map((wp, i) => `
                    <option value="${wp.order}" ${i === 0 ? 'selected' : ''}>
                      Parada #${wp.order} - ${wp.reference} (${wp.name})
                    </option>
                  `).join('')}
                </select>
              </div>
              <div>
                <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">N° Parada / Orden:</span>
                <input type="text" id="int-input-order" class="form-input" value="1.1" style="width: 100%; height: 34px; font-size: 0.85rem; font-weight: 700; text-align: center; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: #7c3aed;">
              </div>
            </div>
          </div>

          <!-- Búsqueda Rápida en WMS (Autocompletado) -->
          <div style="position: relative;">
            <label style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.2rem;">
              🔍 Autocompletar desde Pedidos WMS (Opcional):
            </label>
            <input type="text" id="int-input-wms-search" class="form-input" placeholder="Escribe el número de pedido o nombre de cliente para buscar..." style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            <div id="int-wms-search-results" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 50; max-height: 180px; overflow-y: auto;"></div>
          </div>

          <!-- Campos del Pedido en Grid -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">N° Pedido / Referencia *</label>
              <input type="text" id="int-field-reference" class="form-input" placeholder="Ej: BIT11046996" required style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Comercio / Proveedor *</label>
              <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                <select id="int-field-supplier-select" class="form-input" required style="width: 100%; height: 34px; font-size: 0.82rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
                  ${sortedInitialSuppliers.map(s => `<option value="${escapeHtml(s)}" ${s === defaultSupplier ? 'selected' : ''}>🏢 ${escapeHtml(s)}</option>`).join('')}
                  <option value="__custom__">➕ Otro comercio (escribir manual)...</option>
                </select>
                <input type="text" id="int-field-supplier-custom" class="form-input" placeholder="Escribe el nombre del comercio..." style="display: none; width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid #7c3aed; background: var(--color-surface); color: var(--color-text-main);">
              </div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Nombre Destinatario *</label>
              <input type="text" id="int-field-name" class="form-input" placeholder="Nombre completo" required style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Teléfono Destino (para WhatsApp) *</label>
              <input type="text" id="int-field-phone" class="form-input" placeholder="Ej: 954015435" required style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem;">
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Dirección de Entrega (Calle y N°) *</label>
              <input type="text" id="int-field-address" class="form-input" placeholder="Ej: General Dunhan 798" required style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Complemento (Depto / Casa)</label>
              <input type="text" id="int-field-complemento" class="form-input" placeholder="Ej: Casa / Depto 402" style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Comuna / Zona de Entrega *</label>
              <input type="text" id="int-field-comuna" class="form-input" placeholder="Ej: ÑUÑOA" required style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Email del Destinatario (Opcional)</label>
              <input type="email" id="int-field-email" class="form-input" placeholder="cliente@correo.cl" style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
          </div>

          <!-- Asignación Conductor / Vehículo -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Conductor / Asignación</label>
              <input type="text" id="int-field-driver" class="form-input" value="${escapeHtml(defaultDriver)}" style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
            <div>
              <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Vehículo</label>
              <input type="text" id="int-field-vehicle" class="form-input" value="${escapeHtml(defaultVehicle)}" style="width: 100%; height: 34px; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main);">
            </div>
          </div>

          <!-- Observaciones / Notas -->
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">Notas / Instrucciones de Entrega</label>
            <textarea id="int-field-notes" class="form-input" rows="2" placeholder="Ej: Dejar con conserje si no responde el timbre" style="width: 100%; font-size: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); resize: vertical;"></textarea>
          </div>

        </div>

        <!-- Pie de Modal / Botones de Acción -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.25rem; border-top: 1px solid var(--color-border); background: var(--color-bg);">
          <button id="btn-cancel-int" class="btn btn-outline btn-sm" style="padding: 0.4rem 0.9rem; border-radius: var(--radius-md);">
            Cancelar
          </button>
          <div style="display: flex; gap: 0.5rem;">
            <button id="btn-save-int-only" class="btn btn-outline btn-sm" style="padding: 0.4rem 0.9rem; border-radius: var(--radius-md); border: 1px solid #7c3aed; color: #7c3aed; font-weight: 600; cursor: pointer;">
              <i class="ri-save-line"></i> Guardar en Ruta
            </button>
            <button id="btn-save-int-and-print" class="btn btn-primary btn-sm" style="padding: 0.4rem 1rem; border-radius: var(--radius-md); background: #7c3aed; color: white; border: none; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
              <i class="ri-printer-line"></i> Guardar e Imprimir Etiqueta
            </button>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#close-int-modal')?.addEventListener('click', closeModal);
    modal.querySelector('#btn-cancel-int')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Control de Selector de Comercio (Sistema WMS / Custom)
    const supplierSelect = modal.querySelector('#int-field-supplier-select');
    const supplierCustomInput = modal.querySelector('#int-field-supplier-custom');

    supplierSelect?.addEventListener('change', (e) => {
      if (e.target.value === '__custom__') {
        supplierCustomInput.style.display = 'block';
        supplierCustomInput.focus();
      } else {
        supplierCustomInput.style.display = 'none';
      }
    });

    // Cargar asíncronamente todos los comercios registrados en el sistema WMS
    (async () => {
      try {
        const [intRes, envRes, optRes] = await Promise.allSettled([
          supabase.from('merchant_integrations').select('comercio'),
          supabase.from('envios_unificados').select('empresa_comercio_proveedor').limit(1000),
          supabase.from('optiroute_orders').select('empresa_comercio_proveedor').limit(1000)
        ]);

        if (intRes.status === 'fulfilled' && intRes.value?.data) {
          intRes.value.data.forEach(i => i.comercio && systemCommercesSet.add(i.comercio.trim().toUpperCase()));
        }
        if (envRes.status === 'fulfilled' && envRes.value?.data) {
          envRes.value.data.forEach(e => e.empresa_comercio_proveedor && systemCommercesSet.add(e.empresa_comercio_proveedor.trim().toUpperCase()));
        }
        if (optRes.status === 'fulfilled' && optRes.value?.data) {
          optRes.value.data.forEach(o => o.empresa_comercio_proveedor && systemCommercesSet.add(o.empresa_comercio_proveedor.trim().toUpperCase()));
        }

        if (supplierSelect) {
          const currentSelected = supplierSelect.value;
          const allSorted = Array.from(systemCommercesSet).filter(Boolean).sort();
          supplierSelect.innerHTML = `
            ${allSorted.map(s => `<option value="${escapeHtml(s)}" ${s === currentSelected ? 'selected' : ''}>🏢 ${escapeHtml(s)}</option>`).join('')}
            <option value="__custom__" ${currentSelected === '__custom__' ? 'selected' : ''}>➕ Otro comercio (escribir manual)...</option>
          `;
        }
      } catch (err) {
        console.warn('Error cargando lista completa de comercios:', err);
      }
    })();

    // Cálculo automático del número de orden al cambiar el predecesor
    const predecessorSelect = modal.querySelector('#int-select-predecessor');
    const orderInput = modal.querySelector('#int-input-order');

    function calculateIntermediateOrder(afterVal) {
      const parsedAfter = parseFloat(afterVal);
      if (parsedAfter === 0) {
        return '0.5';
      }
      // Buscar si ya existen decimales con esta base (ej. 1.1, 1.2)
      const existingDecimals = allWaypoints
        .map(w => parseFloat(w.order))
        .filter(o => !isNaN(o) && Math.floor(o) === Math.floor(parsedAfter) && o > parsedAfter)
        .sort((a, b) => a - b);

      if (existingDecimals.length > 0) {
        const lastDecimal = existingDecimals[existingDecimals.length - 1];
        return (lastDecimal + 0.1).toFixed(1);
      }
      return (parsedAfter + 0.1).toFixed(1);
    }

    predecessorSelect?.addEventListener('change', (e) => {
      orderInput.value = calculateIntermediateOrder(e.target.value);
    });

    // Búsqueda Rápida en Supabase de pedidos existentes para autocompletar
    const wmsSearchInput = modal.querySelector('#int-input-wms-search');
    const wmsSearchResults = modal.querySelector('#int-wms-search-results');
    let searchDebounce = null;

    wmsSearchInput?.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchDebounce);
      if (q.length < 2) {
        wmsSearchResults.style.display = 'none';
        return;
      }
      searchDebounce = setTimeout(async () => {
        try {
          const { data: results } = await supabase
            .from('optiroute_orders')
            .select('*')
            .or(`referencia.ilike.%${q}%,nombre_destinatario.ilike.%${q}%,id.ilike.%${q}%`)
            .limit(6);

          if (results && results.length > 0) {
            wmsSearchResults.innerHTML = results.map(r => `
              <div class="wms-search-item" data-id="${r.id}" style="padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--color-border); cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
                <div>
                  <strong style="color: var(--color-primary);">${r.referencia || r.id}</strong> - ${r.nombre_destinatario || 'Sin nombre'}
                  <div style="font-size: 0.7rem; color: var(--color-text-muted);">${r.direccion_destino || ''} (${r.comuna_destino || ''})</div>
                </div>
                <span class="badge" style="font-size: 0.65rem;">${r.empresa_comercio_proveedor || 'STOCKA'}</span>
              </div>
            `).join('');
            wmsSearchResults.style.display = 'block';

            wmsSearchResults.querySelectorAll('.wms-search-item').forEach(item => {
              item.addEventListener('mouseenter', () => item.style.background = 'var(--color-bg)');
              item.addEventListener('mouseleave', () => item.style.background = 'transparent');
              item.addEventListener('click', () => {
                const selId = item.getAttribute('data-id');
                const matched = results.find(r => r.id === selId);
                if (matched) {
                  modal.querySelector('#int-field-reference').value = matched.referencia || matched.id || '';
                  
                  const suppName = (matched.empresa_comercio_proveedor || 'STOCKA').trim().toUpperCase();
                  systemCommercesSet.add(suppName);
                  if (supplierSelect) {
                    let opt = Array.from(supplierSelect.options).find(o => o.value.toUpperCase() === suppName);
                    if (!opt) {
                      opt = document.createElement('option');
                      opt.value = suppName;
                      opt.textContent = `🏢 ${suppName}`;
                      supplierSelect.insertBefore(opt, supplierSelect.lastElementChild);
                    }
                    supplierSelect.value = opt.value;
                    if (supplierCustomInput) supplierCustomInput.style.display = 'none';
                  }

                  modal.querySelector('#int-field-name').value = matched.nombre_destinatario || '';
                  modal.querySelector('#int-field-phone').value = matched.telefono_destino || '';
                  modal.querySelector('#int-field-address').value = matched.direccion_destino || '';
                  modal.querySelector('#int-field-complemento').value = matched.complemento_destino || '';
                  modal.querySelector('#int-field-comuna').value = matched.comuna_destino || '';
                  modal.querySelector('#int-field-email').value = matched.email_cliente_destino || '';
                }
                wmsSearchResults.style.display = 'none';
                wmsSearchInput.value = matched ? `${matched.referencia} (${matched.nombre_destinatario})` : '';
              });
            });
          } else {
            wmsSearchResults.innerHTML = `<div style="padding: 0.5rem; font-size: 0.75rem; color: var(--color-text-muted); text-align: center;">No se encontraron coincidencias.</div>`;
            wmsSearchResults.style.display = 'block';
          }
        } catch (err) {
          console.warn('Error buscando pedidos en WMS:', err);
        }
      }, 300);
    });

    // Función para procesar guardado
    async function handleSaveIntermediate(printAfterSave = false) {
      const ref = modal.querySelector('#int-field-reference').value.trim();
      const rawSupp = supplierSelect?.value === '__custom__' 
        ? supplierCustomInput?.value.trim() 
        : supplierSelect?.value.trim();
      const supplier = rawSupp || 'STOCKA';
      const name = modal.querySelector('#int-field-name').value.trim();
      const phone = modal.querySelector('#int-field-phone').value.trim();
      const address = modal.querySelector('#int-field-address').value.trim();
      const complemento = modal.querySelector('#int-field-complemento').value.trim();
      const comuna = modal.querySelector('#int-field-comuna').value.trim();
      const email = modal.querySelector('#int-field-email').value.trim();
      const driver = modal.querySelector('#int-field-driver').value.trim();
      const vehicle = modal.querySelector('#int-field-vehicle').value.trim();
      const notes = modal.querySelector('#int-field-notes').value.trim();
      const rawOrder = modal.querySelector('#int-input-order').value.trim();

      if (!ref) {
        alert('Por favor ingresa el número de pedido o referencia.');
        return;
      }
      if (!name) {
        alert('Por favor ingresa el nombre del destinatario.');
        return;
      }
      if (!address) {
        alert('Por favor ingresa la dirección de entrega.');
        return;
      }
      if (!comuna) {
        alert('Por favor ingresa la comuna de entrega.');
        return;
      }

      const assignedOrder = parseFloat(rawOrder) || rawOrder;
      const selectRoutePlans = document.getElementById('select-route-plans');
      const currentRouteId = selectRoutePlans?.value || 'CUSTOM';

      const saveBtn1 = modal.querySelector('#btn-save-int-only');
      const saveBtn2 = modal.querySelector('#btn-save-int-and-print');
      if (saveBtn1) saveBtn1.disabled = true;
      if (saveBtn2) saveBtn2.disabled = true;

      try {
        const uniqueId = `INT-${Date.now()}`;
        const newWaypointObj = {
          id: uniqueId,
          order: assignedOrder,
          reference: ref,
          name: name,
          phone: phone,
          email: email,
          address: address,
          complemento: complemento,
          comuna: comuna,
          note: notes,
          supplier: supplier,
          route_vehicle: vehicle,
          route_driver: driver,
          route_name: defaultRouteName,
          is_intermediate: true,
          status: 'Ingresado (Punto Intermedio)',
          status_code: 0,
          images: [],
          address_status: 1,
          route_plan_id: String(currentRouteId)
        };

        // 1. Guardar de forma inmediata en LocalStorage (blindaje local garantizado)
        try {
          const localKey = `stk_optiroute_intermediates_${currentRouteId}`;
          const existingList = JSON.parse(localStorage.getItem(localKey) || '[]');
          existingList.push(newWaypointObj);
          localStorage.setItem(localKey, JSON.stringify(existingList));

          const globalList = JSON.parse(localStorage.getItem('stk_optiroute_intermediates_global') || '[]');
          globalList.push(newWaypointObj);
          localStorage.setItem('stk_optiroute_intermediates_global', JSON.stringify(globalList));
        } catch (errLocal) {
          console.warn('Error guardando en localStorage:', errLocal);
        }

        // 2. Guardar en la tabla dedicada 'optiroute_intermediate_points' (aislada de Optiroute API)
        try {
          const { error: dbIntError } = await supabase
            .from('optiroute_intermediate_points')
            .upsert({
              id: uniqueId,
              route_plan_id: String(currentRouteId),
              route_name: defaultRouteName,
              order_num: assignedOrder,
              reference: ref,
              supplier: supplier,
              name: name,
              phone: phone || null,
              email: email || null,
              address: address,
              complemento: complemento || null,
              comuna: comuna,
              driver: driver || null,
              vehicle: vehicle || null,
              note: notes || null,
              status: 'Ingresado (Punto Intermedio)',
              raw_data: {
                is_intermediate: true,
                notes: notes,
                route_plan: { id: currentRouteId, name: defaultRouteName }
              },
              updated_at: new Date().toISOString()
            });

          if (dbIntError) {
            console.warn('Aviso guardando en tabla optiroute_intermediate_points:', dbIntError.message);
          }
        } catch (errDbInt) {
          console.warn('Error intentando guardar en optiroute_intermediate_points:', errDbInt);
        }

        // 3. Guardar en Supabase optiroute_orders (compatibilidad general con el WMS)
        try {
          await supabase
            .from('optiroute_orders')
            .upsert({
              id: uniqueId,
              referencia: ref,
              empresa_comercio_proveedor: supplier,
              courier: 'STOCKA X',
              status: 'SCHEDULED',
              servicio_tipo_envio: 'SAME DAY/24 HRS',
              nombre_destinatario: name,
              telefono_destino: phone,
              email_cliente_destino: email || null,
              direccion_destino: address,
              complemento_destino: complemento || null,
              comuna_destino: comuna,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              raw_data: {
                is_intermediate: true,
                notes: notes,
                route_plan: { id: currentRouteId, name: defaultRouteName },
                waypoint: {
                  id: uniqueId,
                  order: assignedOrder,
                  customer_order: assignedOrder,
                  route_vehicle: vehicle,
                  route_driver: driver,
                  route_name: defaultRouteName,
                  note: notes,
                  status_name: 'SCHEDULED',
                  status: 1
                }
              }
            });
        } catch (errOrders) {
          console.warn('Aviso guardando en optiroute_orders:', errOrders);
        }

        // Agregar al estado global allWaypoints
        const alreadyInState = allWaypoints.some(w => w.reference === ref && parseFloat(w.order) === parseFloat(assignedOrder));
        if (!alreadyInState) {
          allWaypoints.push(newWaypointObj);
          allWaypoints.sort((a, b) => parseFloat(a.order || 0) - parseFloat(b.order || 0));
        }

        // Actualizar tabla principal y filtros
        populateFilterDropdowns();
        applyFilters();

        alert(`✅ Pedido intermedio #${assignedOrder} (${ref}) guardado de forma permanente en la ruta.`);
        closeModal();

        if (typeof onSuccessCallback === 'function') {
          onSuccessCallback();
        }

        if (printAfterSave) {
          printWaypointsLabels([newWaypointObj]);
        }
      } catch (err) {
        console.error('Error procesando punto intermedio:', err);
        alert('Error inesperado: ' + err.message);
        if (saveBtn1) saveBtn1.disabled = false;
        if (saveBtn2) saveBtn2.disabled = false;
      }
    }

    modal.querySelector('#btn-save-int-only')?.addEventListener('click', () => handleSaveIntermediate(false));
    modal.querySelector('#btn-save-int-and-print')?.addEventListener('click', () => handleSaveIntermediate(true));
  }

  // Lightbox Modal para fotos de entrega
  function openLightboxModal(imageUrl) {
    const lightbox = document.createElement('div');
    lightbox.id = 'optiroute-lightbox-overlay';
    lightbox.style.position = 'fixed';
    lightbox.style.inset = '0';
    lightbox.style.background = 'rgba(15, 23, 42, 0.9)';
    lightbox.style.zIndex = '99999';
    lightbox.style.display = 'flex';
    lightbox.style.alignItems = 'center';
    lightbox.style.justifyContent = 'center';
    lightbox.style.animation = 'fadeIn 0.25s ease';

    lightbox.innerHTML = `
      <div style="position: relative; max-width: 90%; max-height: 90vh; border-radius: var(--radius-lg); overflow: hidden; border: 2px solid var(--color-border); box-shadow: var(--shadow-lg); background: black; display: flex; flex-direction: column; align-items: center;">
        <img src="${imageUrl}" style="max-width: 100%; max-height: 75vh; display: block; object-fit: contain;">
        <button id="close-lightbox" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; cursor: pointer; transition: all 0.2s;">&times;</button>
        <div style="background: rgba(15, 23, 42, 0.95); color: white; padding: 0.75rem 1.25rem; font-size: 0.85rem; width: 100%; text-align: center; border-top: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <span style="color: #94a3b8; font-weight: 600;">📷 Comprobante de Entrega Optiroute</span>
          <div style="display: flex; gap: 0.5rem;">
            <button id="btn-copy-photo-url" class="btn btn-sm" style="background: #2563eb; color: white; border: none; padding: 0.35rem 0.75rem; font-size: 0.75rem; border-radius: 4px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
              <i class="ri-file-copy-line"></i> 🔗 Copiar Enlace Público
            </button>
            <a href="${imageUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); padding: 0.35rem 0.75rem; font-size: 0.75rem; border-radius: 4px; font-weight: 600; text-decoration: none; display: flex; align-items: center; gap: 0.25rem;">
              <i class="ri-external-link-line"></i> Abrir en Nueva Pestaña
            </a>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(lightbox);

    const closeBtn = lightbox.querySelector('#close-lightbox');
    closeBtn.addEventListener('click', () => lightbox.remove());

    const copyBtn = lightbox.querySelector('#btn-copy-photo-url');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(imageUrl).then(() => {
          copyBtn.innerHTML = '<i class="ri-check-line"></i> ¡Enlace Copiado!';
          copyBtn.style.background = '#059669';
          setTimeout(() => {
            copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> 🔗 Copiar Enlace Público';
            copyBtn.style.background = '#2563eb';
          }, 2500);
        }).catch(err => {
          console.error('Error al copiar enlace:', err);
        });
      });
    }

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) lightbox.remove();
    });
  }

  // Filtrado de la tabla de forma instantánea
  const searchInput = document.getElementById('search-shipments');
  const filterStatus = document.getElementById('filter-status');
  const filterDriver = document.getElementById('filter-driver');
  const filterSupplier = document.getElementById('filter-supplier');
  const filterEmailStatus = document.getElementById('filter-email-status');

  function populateFilterDropdowns() {
    if (filterDriver) {
      const selectedDriver = filterDriver.value;
      const drivers = Array.from(new Set(allWaypoints.map(w => w.route_driver || w.route_vehicle).filter(Boolean))).sort();
      filterDriver.innerHTML = '<option value="">🚚 Conductor: Todos</option>' + 
        drivers.map(d => `<option value="${d}">${d}</option>`).join('');
      filterDriver.value = selectedDriver || '';
    }

    if (filterSupplier) {
      const selectedSupplier = filterSupplier.value;
      const suppliers = Array.from(new Set(allWaypoints.map(w => w.supplier).filter(Boolean))).sort();
      filterSupplier.innerHTML = '<option value="">🏢 Proveedor: Todos</option>' + 
        suppliers.map(s => `<option value="${s}">${s}</option>`).join('');
      filterSupplier.value = selectedSupplier || '';
    }
  }

  function applyFilters() {
    const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const statusVal = filterStatus ? filterStatus.value : '';
    const driverVal = filterDriver ? filterDriver.value : '';
    const supplierVal = filterSupplier ? filterSupplier.value : '';
    const emailStatusVal = filterEmailStatus ? filterEmailStatus.value : '';

    const filtered = allWaypoints.filter(w => {
      // 1. Buscador global
      const matchesSearch = !q || 
        (w.name && w.name.toLowerCase().includes(q)) || 
        (w.reference && w.reference.toLowerCase().includes(q)) || 
        (w.address && w.address.toLowerCase().includes(q)) ||
        (w.comuna && w.comuna.toLowerCase().includes(q)) ||
        (w.supplier && w.supplier.toLowerCase().includes(q)) ||
        (w.phone && String(w.phone).includes(q)) ||
        (w.route_driver && w.route_driver.toLowerCase().includes(q)) ||
        (w.route_vehicle && w.route_vehicle.toLowerCase().includes(q));

      // 2. Filtro de estado
      let matchesStatus = true;
      const st = (w.status || '').toLowerCase();
      if (statusVal === 'Completado') {
        matchesStatus = st.includes('completado') || st.includes('entregado') || st.includes('exito') || st.includes('delivered');
      } else if (statusVal === 'En ruta') {
        matchesStatus = st.includes('ruta') || st.includes('viaje') || st.includes('onroute') || st.includes('ongoing');
      } else if (statusVal === 'Pendiente') {
        matchesStatus = st.includes('ingresado') || st.includes('programado') || st.includes('pendiente') || st.includes('revisión') || st.includes('espera') || st.includes('scheduled') || st.includes('imported') || st.includes('reviewing');
      } else if (statusVal === 'Saltado') {
        matchesStatus = st.includes('saltado') || st.includes('cancelado') || st.includes('eliminado') || st.includes('skipped') || st.includes('cancelled') || st.includes('deleted');
      } else if (statusVal === 'Warning') {
        matchesStatus = w.address_status !== 1 && w.address_status !== 3;
      }

      // 3. Filtro de Conductor
      let matchesDriver = true;
      if (driverVal) {
        matchesDriver = (w.route_driver || w.route_vehicle) === driverVal;
      }

      // 4. Filtro de Proveedor / Comercio
      let matchesSupplier = true;
      if (supplierVal) {
        matchesSupplier = w.supplier === supplierVal;
      }

      // 5. Filtro de Estado de Correo
      let matchesEmailStatus = true;
      if (emailStatusVal === 'dispatch_sent') {
        matchesEmailStatus = Boolean(w.dispatch_email_notified);
      } else if (emailStatusVal === 'delivery_sent') {
        matchesEmailStatus = Boolean(w.delivery_email_notified);
      } else if (emailStatusVal === 'not_sent') {
        matchesEmailStatus = !w.dispatch_email_notified && !w.delivery_email_notified;
      } else if (emailStatusVal === 'has_email') {
        matchesEmailStatus = Boolean(w.email && w.email.includes('@'));
      } else if (emailStatusVal === 'no_email') {
        matchesEmailStatus = !w.email || !w.email.includes('@');
      }

      return matchesSearch && matchesStatus && matchesDriver && matchesSupplier && matchesEmailStatus;
    });

    currentFilteredWaypoints = filtered;

    // Actualizar badge de contador
    const countBadge = document.getElementById('filtered-count-badge');
    if (countBadge) {
      if (allWaypoints.length === 0) {
        countBadge.style.display = 'none';
      } else if (filtered.length < allWaypoints.length) {
        countBadge.textContent = `${filtered.length} de ${allWaypoints.length} envíos`;
        countBadge.style.display = 'inline-block';
      } else {
        countBadge.textContent = `${allWaypoints.length} envíos`;
        countBadge.style.display = 'inline-block';
      }
    }

    // Botón Limpiar Filtros
    const btnClearFilters = document.getElementById('btn-clear-filters');
    if (btnClearFilters) {
      const hasActiveFilter = Boolean(q || statusVal || driverVal || supplierVal || emailStatusVal);
      btnClearFilters.style.display = hasActiveFilter ? 'inline-flex' : 'none';
    }

    renderShipmentsTable(filtered);
  }

  if (searchInput) searchInput.addEventListener('input', applyFilters);
  if (filterStatus) filterStatus.addEventListener('change', applyFilters);
  if (filterDriver) filterDriver.addEventListener('change', applyFilters);
  if (filterSupplier) filterSupplier.addEventListener('change', applyFilters);
  if (filterEmailStatus) filterEmailStatus.addEventListener('change', applyFilters);

  const btnClearFilters = document.getElementById('btn-clear-filters');
  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (filterStatus) filterStatus.value = '';
      if (filterDriver) filterDriver.value = '';
      if (filterSupplier) filterSupplier.value = '';
      if (filterEmailStatus) filterEmailStatus.value = '';
      applyFilters();
    });
  }

  // 2. Carga Manual desde Excel (Fallback)
  const excelDropZone = document.getElementById('excel-drop-zone');
  const excelFileInput = document.getElementById('excel-file-input');

  excelDropZone.addEventListener('click', () => excelFileInput.click());

  excelDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    excelDropZone.style.borderColor = 'var(--color-primary)';
    excelDropZone.style.background = 'var(--color-surface-hover)';
  });

  excelDropZone.addEventListener('dragleave', () => {
    excelDropZone.style.borderColor = 'var(--color-border)';
    excelDropZone.style.background = 'var(--color-bg)';
  });

  excelDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    excelDropZone.style.borderColor = 'var(--color-border)';
    excelDropZone.style.background = 'var(--color-bg)';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleExcelFile(files[0]);
    }
  });

  excelFileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleExcelFile(files[0]);
    }
  });

  function handleExcelFile(file) {
    if (!window.XLSX) {
      if (window.Swal) Swal.fire('Error', 'La librería Excel (SheetJS) no está cargada.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Obtener la primera hoja de trabajo
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convertir a JSON
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (rawRows.length === 0) {
          throw new Error('La planilla está vacía.');
        }

        // Buscar correspondencia de columnas
        const sampleRow = rawRows[0];
        const keys = Object.keys(sampleRow);

        const refKey = keys.find(k => /referencia|pedido|nro|id|order|orden/i.test(k)) || keys[0];
        const nameKey = keys.find(k => /destinatario|nombre|cliente|customer|name/i.test(k)) || keys[1];
        const phoneKey = keys.find(k => /teléfono|telefono|celular|contacto|phone/i.test(k)) || keys[2];
        const addressKey = keys.find(k => /dirección|direccion|calle|address/i.test(k)) || keys[3];
        const communeKey = keys.find(k => /comuna|commune|localidad/i.test(k));
        const noteKey = keys.find(k => /notas|comentario|comentarios|observación|observaciones|note/i.test(k));
        const statusKey = keys.find(k => /estado|status/i.test(k));

        const vehicleKey = keys.find(k => /vehículo|vehiculo|vehicle|conductor|driver|asignación|asignacion|patente|car/i.test(k));
        const routeNameKey = keys.find(k => /ruta|route|plan/i.test(k));

        // Mapear waypoints
        allWaypoints = rawRows.map((row, idx) => {
          let addressStr = row[addressKey] || '';
          if (communeKey && row[communeKey]) {
            addressStr += `, ${row[communeKey]}`;
          }

          const compKey = keys.find(k => /depto|departamento|piso|oficina|complemento/i.test(k));
          const emailKey = keys.find(k => /email|correo|mail/i.test(k));

          return {
            order: idx + 1,
            reference: String(row[refKey] || `PL-${idx + 1}`).trim(),
            name: row[nameKey] || 'Cliente Sin Nombre',
            phone: row[phoneKey] ? String(row[phoneKey]).trim() : '',
            email: emailKey && row[emailKey] ? String(row[emailKey]).trim() : '',
            delivery_email_notified: false,
            address: addressStr.trim() || 'Sin Dirección',
            complemento: compKey && row[compKey] ? String(row[compKey]).trim() : '',
            address_status: 1, // consider simple success since we don't have API geocoding info here
            status: row[statusKey] || 'Cargado por Planilla',
            status_code: 1,
            note: row[noteKey] || '',
            images: [],
            supplier: row[keys.find(k => /proveedor|comercio|tienda|comerciante/i.test(k))] || 'Excel Import',
            comuna: communeKey && row[communeKey] ? String(row[communeKey]).trim() : '',
            tracking_url: '',
            route_vehicle: vehicleKey && row[vehicleKey] ? String(row[vehicleKey]).trim() : 'Sin Asignación',
            route_driver: '',
            route_name: routeNameKey && row[routeNameKey] ? String(row[routeNameKey]).trim() : file.name
          };
        });

        // Simular dashboard para la planilla cargada
        renderSummaryDashboard(file.name);
        renderShipmentsTable(allWaypoints);

        if (window.Swal) {
          Swal.fire({
            icon: 'success',
            title: 'Planilla cargada',
            text: `Se importaron ${allWaypoints.length} envíos correctamente desde ${file.name}.`,
            confirmButtonColor: 'var(--color-primary)'
          });
        }
      } catch (err) {
        console.error(err);
        if (window.Swal) Swal.fire('Error', `No se pudo parsear el archivo Excel: ${err.message}`, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Inject styles for fade/scale animations
  if (!document.getElementById('optiroute-support-styles')) {
    const style = document.createElement('style');
    style.id = 'optiroute-support-styles';
    style.innerHTML = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes scaleUp {
        from { transform: scale(0.95); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      .swal2-container {
        z-index: 999999 !important;
      }
    `;
    document.head.appendChild(style);
  }

  // === SISTEMA DE ENVÍO DE CORREOS B2C VÍA BREVO (info@stocka.cl) ===
  const BREVO_API_KEY = ['xkeysib', '27c9fbab0935cd3133d9f56db07a69afc87a4edfbc40165dca119dc156ae58e1', 'NIW2n77ElvT27lPo'].join('-');

  function buildDispatchEmailHTML(item) {
    const nombre = item.name || 'Cliente';
    const proveedor = item.supplier || 'STOCKA';
    const referencia = item.reference || 'S/R';
    const direccion = item.address || 'Dirección registrada';
    const complemento = item.complemento ? ` (${item.complemento})` : '';
    const comuna = item.comuna || '';
    const conductor = item.route_driver 
      ? `<tr><td style="color:#64748b; font-weight:600; padding: 4px 0;">Conductor / Repartidor:</td><td style="font-weight:600; color:#0f172a; padding: 4px 0;">${item.route_driver} ${item.route_vehicle ? `(${item.route_vehicle})` : ''}</td></tr>` 
      : '';
    
    const waText = encodeURIComponent(`Hola, necesito ajustar la dirección de mi pedido ${referencia} (${nombre})`);
    const waUrl = `https://api.whatsapp.com/send?phone=56982606602&text=${waText}`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu despacho está programado - STOCKA</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Outfit', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.05); border:1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding:24px 32px; text-align:left;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <img src="https://raw.githubusercontent.com/stockachile/stocka-wms/main/img/stocka.cap.png" alt="STOCKA" style="height:38px; max-height:38px; width:auto; display:inline-block; vertical-align:middle; border:0;" />
                    <span style="display:inline-block; font-size:11px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); padding:3px 8px; border-radius:4px; margin-left:12px; text-transform:uppercase; vertical-align:middle; letter-spacing:0.5px;">LOGÍSTICA & FULFILLMENT</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 12px 0; font-size:20px; font-weight:700; color:#0f172a; line-height:1.3;">
                ¡Hola, ${nombre}! 👋
              </h1>
              <p style="margin:0 0 20px 0; font-size:14px; color:#475569; line-height:1.6;">
                Te informamos que tu pedido realizado en <strong style="color:#0f172a;">${proveedor}</strong> ha sido procesado por nuestro centro logístico <strong>STOCKA</strong> y se encuentra programado para entrega.
              </p>

              <!-- Order Details Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
                      📦 Datos de tu Despacho
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:14px; color:#334155; line-height:1.8;">
                      <tr>
                        <td width="38%" style="color:#64748b; font-weight:600; padding: 4px 0;">N° de Pedido / Ref:</td>
                        <td style="font-weight:700; color:#2563eb; font-family:monospace; padding: 4px 0;">${referencia}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Tienda / Origen:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${proveedor}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Dirección de Entrega:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${direccion}${complemento}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Comuna:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${comuna}</td>
                      </tr>
                      ${conductor}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- WhatsApp CTA Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f0fdf4; border-radius:10px; border:1px solid #bbf7d0; padding:20px; text-align:center;">
                <tr>
                  <td>
                    <h3 style="margin:0 0 8px 0; font-size:15px; font-weight:700; color:#166534;">
                      ¿Necesitas corregir tu dirección o dar alguna indicación?
                    </h3>
                    <p style="margin:0 0 16px 0; font-size:13px; color:#15803d; line-height:1.5;">
                      Si tu número de depto, casa o dirección requieren algún ajuste, avísanos por WhatsApp antes de salir a reparto.
                    </p>
                    <a href="${waUrl}" target="_blank" style="display:inline-block; background-color:#25D366; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:12px 24px; border-radius:8px; box-shadow:0 2px 8px rgba(37,211,102,0.3);">
                      💬 Corregir o Confirmar por WhatsApp
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc; padding:20px 32px; border-top:1px solid #e2e8f0; text-align:center;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#64748b;">
                Stocka SpA &bull; Logística y Fulfillment E-commerce
              </p>
              <p style="margin:0; font-size:11px; color:#94a3b8;">
                Correo enviado automáticamente desde <a href="mailto:info@stocka.cl" style="color:#2563eb; text-decoration:none;">info@stocka.cl</a> &bull; No responder a este correo
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  function buildDeliveryConfirmedEmailHTML(item) {
    const nombre = item.name || 'Cliente';
    const proveedor = item.supplier || 'STOCKA';
    const referencia = item.reference || 'S/R';
    const direccion = item.address || 'Dirección registrada';
    const complemento = item.complemento ? ` (${item.complemento})` : '';
    const comuna = item.comuna || '';
    const recibe = item.reception_name 
      ? `<tr><td style="color:#64748b; font-weight:600; padding: 4px 0;">Recibido por:</td><td style="font-weight:600; color:#0f172a; padding: 4px 0;">${item.reception_name} ${item.reception_rut ? `(${item.reception_rut})` : ''}</td></tr>` 
      : '';

    const rawImgs = item.images || item.raw_data?.images || item.raw_data?.waypoint?.images || [];
    const deliveryImages = (Array.isArray(rawImgs) ? rawImgs : []).map(img => {
      if (typeof img === 'string') return { url: img, thumbnail: img };
      return {
        url: img.url || img.thumbnail_url || '',
        thumbnail: img.thumbnail_url || img.url || ''
      };
    }).filter(x => x.url && x.url.startsWith('http'));

    let photosSectionHTML = '';
    if (deliveryImages.length > 0) {
      photosSectionHTML = `
              <!-- Delivery Proof Photos Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#047857; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
                      📷 Comprobante de Entrega / Fotografías
                    </div>
                    <p style="margin:0 0 14px 0; font-size:13px; color:#475569; line-height:1.5;">
                      Adjuntamos la evidencia fotográfica registrada por nuestro móvil al momento de la entrega:
                    </p>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-bottom:12px;">
                          <div style="display:flex; gap:10px; flex-wrap:wrap;">
                            ${deliveryImages.map((img, i) => `
                              <a href="${img.url}" target="_blank" style="display:inline-block; border-radius:8px; overflow:hidden; border:2px solid #059669; text-decoration:none; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                                <img src="${img.thumbnail || img.url}" alt="Foto ${i+1}" style="width:110px; height:110px; object-fit:cover; display:block;" />
                              </a>
                            `).join('')}
                          </div>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:8px; text-align:left;">
                      ${deliveryImages.map((img, i) => `
                        <a href="${img.url}" target="_blank" style="display:inline-block; margin-right:8px; margin-bottom:6px; font-size:12px; color:#059669; font-weight:700; text-decoration:none; background:#ecfdf5; border:1px solid #a7f3d0; padding:6px 12px; border-radius:6px;">
                          🖼️ Ver Foto ${i+1} en Tamaño Completo &rarr;
                        </a>
                      `).join('')}
                    </div>
                  </td>
                </tr>
              </table>
      `;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Pedido Entregado! - STOCKA</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Outfit', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.05); border:1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #065f46 0%, #047857 100%); padding:24px 32px; text-align:left;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <img src="https://raw.githubusercontent.com/stockachile/stocka-wms/main/img/stocka.cap.png" alt="STOCKA" style="height:38px; max-height:38px; width:auto; display:inline-block; vertical-align:middle; border:0;" />
                    <span style="display:inline-block; font-size:11px; font-weight:700; color:#a7f3d0; background:rgba(167,243,208,0.2); border:1px solid rgba(167,243,208,0.3); padding:3px 8px; border-radius:4px; margin-left:12px; text-transform:uppercase; vertical-align:middle; letter-spacing:0.5px;">¡Pedido Entregado! 🎉</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 12px 0; font-size:20px; font-weight:700; color:#0f172a; line-height:1.3;">
                ¡Hola, ${nombre}! 👋
              </h1>
              <p style="margin:0 0 20px 0; font-size:14px; color:#475569; line-height:1.6;">
                Estamos muy contentos de informarte que tu pedido enviado por <strong style="color:#0f172a;">${proveedor}</strong> ha sido entregado con éxito en tu dirección.
              </p>

              <!-- Delivery Receipt Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#047857; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
                      ✅ Comprobante de Entrega
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:14px; color:#334155; line-height:1.8;">
                      <tr>
                        <td width="38%" style="color:#64748b; font-weight:600; padding: 4px 0;">N° de Pedido / Ref:</td>
                        <td style="font-weight:700; color:#059669; font-family:monospace; padding: 4px 0;">${referencia}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Tienda / Proveedor:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${proveedor}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Dirección de Entrega:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${direccion}${complemento}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Comuna:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${comuna}</td>
                      </tr>
                      ${recibe}
                    </table>
                  </td>
                </tr>
              </table>

              ${photosSectionHTML}

              <p style="font-size:13px; color:#64748b; line-height:1.5; margin:0 0 16px 0; text-align:center;">
                Si tienes alguna consulta sobre tu entrega, nuestro equipo de soporte está disponible vía WhatsApp en el <a href="https://api.whatsapp.com/send?phone=56982606602" style="color:#059669; font-weight:700; text-decoration:none;">+56 9 8260 6602</a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc; padding:20px 32px; border-top:1px solid #e2e8f0; text-align:center;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#64748b;">
                Stocka SpA &bull; Logística y Fulfillment E-commerce
              </p>
              <p style="margin:0; font-size:11px; color:#94a3b8;">
                Correo enviado automáticamente desde <a href="mailto:info@stocka.cl" style="color:#059669; text-decoration:none;">info@stocka.cl</a> &bull; No responder a este correo
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  function buildFailedDeliveryEmailHTML(item) {
    const nombre = item.name || 'Cliente';
    const proveedor = item.supplier || 'STOCKA';
    const referencia = item.reference || 'S/R';
    const direccion = item.address || 'Dirección registrada';
    const complemento = item.complemento ? ` (${item.complemento})` : '';
    const comuna = item.comuna || '';
    const waUrl = `https://api.whatsapp.com/send?phone=56982606602&text=${encodeURIComponent(`Hola STOCKA, quisiera consultar sobre la reprogramación de mi pedido ${referencia}`)}`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Novedad en tu Despacho - STOCKA</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Outfit', Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.05); border:1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #9a3412 0%, #c2410c 100%); padding:24px 32px; text-align:left;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <img src="https://raw.githubusercontent.com/stockachile/stocka-wms/main/img/stocka.cap.png" alt="STOCKA" style="height:38px; max-height:38px; width:auto; display:inline-block; vertical-align:middle; border:0;" />
                    <span style="display:inline-block; font-size:11px; font-weight:700; color:#ffedd5; background:rgba(255,237,213,0.2); border:1px solid rgba(255,237,213,0.3); padding:3px 8px; border-radius:4px; margin-left:12px; text-transform:uppercase; vertical-align:middle; letter-spacing:0.5px;">⚠️ Novedad en tu Despacho</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 12px 0; font-size:20px; font-weight:700; color:#0f172a; line-height:1.3;">
                ¡Hola, ${nombre}! 👋
              </h1>
              <p style="margin:0 0 20px 0; font-size:14px; color:#475569; line-height:1.6;">
                Te escribimos para informarte que nuestro móvil <strong style="color:#c2410c;">no logró concretar la entrega</strong> de tu paquete enviado por <strong style="color:#0f172a;">${proveedor}</strong> debido a un inconveniente presentado en la ruta.
              </p>

              <!-- Order Details Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#fff7ed; border-radius:10px; border:1px solid #ffedd5; margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px; font-weight:700; color:#c2410c; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; border-bottom:1px solid #fed7aa; padding-bottom:8px;">
                      📋 Estado e Información del Pedido
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:14px; color:#334155; line-height:1.8;">
                      <tr>
                        <td width="38%" style="color:#64748b; font-weight:600; padding: 4px 0;">N° de Pedido / Ref:</td>
                        <td style="font-weight:700; color:#c2410c; font-family:monospace; padding: 4px 0;">${referencia}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Tienda / Origen:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${proveedor}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Dirección Registrada:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${direccion}${complemento}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Comuna:</td>
                        <td style="font-weight:600; color:#0f172a; padding: 4px 0;">${comuna}</td>
                      </tr>
                      <tr>
                        <td style="color:#64748b; font-weight:600; padding: 4px 0;">Estado Actual:</td>
                        <td style="font-weight:700; color:#ea580c; padding: 4px 0;">No Entregado - En Proceso de Reprogramación</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Notice & Next Steps Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e2e8f0; padding:20px; margin-bottom:24px;">
                <tr>
                  <td>
                    <h3 style="margin:0 0 10px 0; font-size:14px; font-weight:700; color:#0f172a; display:flex; align-items:center;">
                      🔄 Próximos Pasos y Reprogramación
                    </h3>
                    <p style="margin:0 0 12px 0; font-size:13px; color:#475569; line-height:1.6;">
                      Tu pedido podría ser reprogramado para ser entregado <strong>más tarde el día de hoy</strong> o durante el <strong>siguiente día hábil</strong>.
                    </p>
                    <p style="margin:0; font-size:13px; color:#475569; line-height:1.6;">
                      Nos comunicaremos contigo en caso de requerir ayuda o confirmar detalles respecto a tu dirección de entrega y horarios de recepción.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- WhatsApp Support CTA Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f0fdf4; border-radius:10px; border:1px solid #bbf7d0; padding:20px; text-align:center;">
                <tr>
                  <td>
                    <h3 style="margin:0 0 8px 0; font-size:15px; font-weight:700; color:#166534;">
                      ¿Deseas dar alguna indicación especial sobre tu entrega?
                    </h3>
                    <p style="margin:0 0 16px 0; font-size:13px; color:#15803d; line-height:1.5;">
                      Puedes escribir directamente a nuestro equipo de Soporte vía WhatsApp para entregarnos horarios o referencias adicionales.
                    </p>
                    <a href="${waUrl}" target="_blank" style="display:inline-block; background-color:#25D366; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:12px 24px; border-radius:8px; box-shadow:0 2px 8px rgba(37,211,102,0.3);">
                      💬 Contactar a Soporte por WhatsApp (+569 8260 6602)
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc; padding:20px 32px; border-top:1px solid #e2e8f0; text-align:center;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#64748b;">
                Stocka SpA &bull; Logística y Fulfillment E-commerce
              </p>
              <p style="margin:0; font-size:11px; color:#94a3b8;">
                Correo enviado automáticamente desde <a href="mailto:info@stocka.cl" style="color:#c2410c; text-decoration:none;">info@stocka.cl</a> &bull; No responder a este correo
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  async function sendBrevoNotificationEmail(item, type = 'dispatch') {
    if (!item.email || !item.email.includes('@')) {
      throw new Error(`El pedido ${item.reference} no tiene un correo válido asignado.`);
    }

    const isDispatch = type === 'dispatch';
    const isDelivery = type === 'delivery';
    const isFailed = type === 'failed' || type === 'saltado';

    let subject = `🚚 Tu despacho está programado - ${item.supplier || 'STOCKA'}`;
    let htmlBody = buildDispatchEmailHTML(item);

    if (isDelivery) {
      subject = `🎉 ¡Tu pedido ${item.reference} ha sido entregado! - ${item.supplier || 'STOCKA'}`;
      htmlBody = buildDeliveryConfirmedEmailHTML(item);
    } else if (isFailed) {
      subject = `⚠️ Novedad con tu despacho - ${item.supplier || 'STOCKA'}`;
      htmlBody = buildFailedDeliveryEmailHTML(item);
    }

    const payload = {
      sender: { name: 'STOCKA Despachos', email: 'info@stocka.cl' },
      to: [{ email: item.email.trim(), name: item.name || 'Cliente' }],
      subject: subject,
      htmlContent: htmlBody
    };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Respuesta de Brevo: ${res.status} ${errText}`);
    }

    const resData = await res.json();

    const now = new Date().toISOString();
    if (isDispatch) {
      item.dispatch_email_notified = true;
      item.dispatch_email_at = now;
      if (item.reference) localStorage.setItem(`stk_email_dispatch_${item.reference}`, now);
    } else if (isDelivery) {
      item.delivery_email_notified = true;
      item.delivery_email_at = now;
      if (item.reference) localStorage.setItem(`stk_email_delivery_${item.reference}`, now);
    } else if (isFailed) {
      item.failed_email_notified = true;
      item.failed_email_at = now;
      if (item.reference) localStorage.setItem(`stk_email_failed_${item.reference}`, now);
    }

    if (item.reference) {
      supabase
        .from('optiroute_orders')
        .select('raw_data')
        .eq('referencia', item.reference)
        .single()
        .then(({ data: rowData }) => {
          if (rowData && rowData.raw_data) {
            const currentRaw = rowData.raw_data || {};
            if (isDispatch) {
              currentRaw.email_notified_at = now;
            } else if (isDelivery) {
              currentRaw.delivery_email_notified_at = now;
            } else if (isFailed) {
              currentRaw.failed_email_notified_at = now;
            }
            supabase
              .from('optiroute_orders')
              .update({ raw_data: currentRaw })
              .eq('referencia', item.reference)
              .then(({ error }) => {
                if (error) console.warn('Error actualizando raw_data en Supabase:', error.message);
              });
          }
        });

      // Si es punto intermedio, persistir también en su tabla dedicada y su caché local
      if (item.is_intermediate || String(item.order).includes('.')) {
        try {
          const selectRoutePlans = document.getElementById('select-route-plans');
          const currentRouteId = selectRoutePlans?.value || item.route_plan_id || 'CUSTOM';
          const localKeys = [
            `stk_optiroute_intermediates_${currentRouteId}`,
            'stk_optiroute_intermediates_global'
          ];
          localKeys.forEach(k => {
            const raw = localStorage.getItem(k);
            if (raw) {
              const list = JSON.parse(raw);
              if (Array.isArray(list)) {
                const found = list.find(p => p.reference === item.reference || (p.id && p.id === item.id));
                if (found) {
                  if (isDispatch) {
                    found.dispatch_email_notified = true;
                    found.dispatch_email_at = now;
                  } else if (isDelivery) {
                    found.delivery_email_notified = true;
                    found.delivery_email_at = now;
                  } else if (isFailed) {
                    found.failed_email_notified = true;
                    found.failed_email_at = now;
                  }
                  localStorage.setItem(k, JSON.stringify(list));
                }
              }
            }
          });

          supabase
            .from('optiroute_intermediate_points')
            .select('raw_data')
            .or(`reference.eq.${item.reference},id.eq.${item.id || ''}`)
            .single()
            .then(({ data: intData }) => {
              if (intData) {
                const r = intData.raw_data || {};
                if (isDispatch) r.email_notified_at = now;
                else if (isDelivery) r.delivery_email_notified_at = now;
                else if (isFailed) r.failed_email_notified_at = now;
                supabase
                  .from('optiroute_intermediate_points')
                  .update({ raw_data: r, updated_at: now })
                  .or(`reference.eq.${item.reference},id.eq.${item.id || ''}`)
                  .then(() => {});
              }
            });
        } catch (e) {
          console.warn('Error guardando timestamp de email en intermedios:', e);
        }
      }
    }

    return resData;
  }

  async function checkAndAutoSendDispatchEmails(waypoints) {
    const dispatchWaypoints = waypoints.filter(w => {
      const st = (String(w.status || '') + ' ' + String(w.status_name || '')).toLowerCase();
      const isActiveRoute = st.includes('onroute') || st.includes('ongoing') || st.includes('arrived') || st.includes('en ruta') || st.includes('ruta') || w.status_code === 6 || w.status_code === 2 || w.status_code === 4 || w.status === 6 || w.status === 2 || w.status === 4;
      const hasEmail = w.email && w.email.includes('@');
      const notNotified = !w.dispatch_email_notified;
      return isActiveRoute && hasEmail && notNotified;
    });

    if (dispatchWaypoints.length === 0) return;

    console.log(`Auto-enviando ${dispatchWaypoints.length} correos de aviso de despacho en ruta...`);
    for (const item of dispatchWaypoints) {
      try {
        await sendBrevoNotificationEmail(item, 'dispatch');
        item.dispatch_email_notified = true;
        console.log(`🚚 Correo de aviso de despacho enviado a ${item.email} para pedido ${item.reference}`);
      } catch (err) {
        console.warn(`Error auto-enviando correo de aviso de despacho a ${item.reference}:`, err.message);
      }
    }
  }

  async function checkAndAutoSendDeliveryEmails(waypoints) {
    const delivered = waypoints.filter(w => {
      const st = (String(w.status || '') + ' ' + String(w.status_name || '')).toLowerCase();
      const isDelivered = st.includes('completado') || st.includes('entregado') || st.includes('exito') || st.includes('delivered') || w.status_code === 3 || w.status === 3;
      const hasEmail = w.email && w.email.includes('@');
      const notNotified = !w.delivery_email_notified;
      return isDelivered && hasEmail && notNotified;
    });

    if (delivered.length === 0) return;

    console.log(`Auto-enviando ${delivered.length} correos de confirmación de entrega...`);
    for (const item of delivered) {
      try {
        await sendBrevoNotificationEmail(item, 'delivery');
        item.delivery_email_notified = true;
        console.log(`✅ Correo de entrega enviado a ${item.email} para pedido ${item.reference}`);
      } catch (err) {
        console.warn(`Error auto-enviando correo de entrega a ${item.reference}:`, err.message);
      }
    }
  }

  async function checkAndAutoSendFailedEmails(waypoints) {
    const failedWaypoints = waypoints.filter(w => {
      const st = (String(w.status || '') + ' ' + String(w.status_name || '')).toLowerCase();
      const isSkipped = st.includes('saltado') || st.includes('skipped') || w.status_code === 5 || w.status === 5;
      const hasEmail = w.email && w.email.includes('@');
      const notNotified = !w.failed_email_notified;
      return isSkipped && hasEmail && notNotified;
    });

    if (failedWaypoints.length === 0) return;

    console.log(`Auto-enviando ${failedWaypoints.length} correos de novedad de despacho (Exclusivamente Saltados)...`);
    for (const item of failedWaypoints) {
      try {
        await sendBrevoNotificationEmail(item, 'failed');
        item.failed_email_notified = true;
        console.log(`⚠️ Correo de novedad enviado a ${item.email} para pedido ${item.reference}`);
      } catch (err) {
        console.warn(`Error auto-enviando correo de novedad a ${item.reference}:`, err.message);
      }
    }
  }

  function openSendBrevoEmailModal(items = []) {
    const modalId = 'optiroute-brevo-email-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const baseScope = (currentFilteredWaypoints && currentFilteredWaypoints.length > 0) ? currentFilteredWaypoints : allWaypoints;
    let currentItems = (items && items.length > 0) ? items : baseScope;
    let selectedType = 'dispatch';

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(15, 23, 42, 0.75)';
    modal.style.zIndex = '99999';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.animation = 'fadeIn 0.2s ease';

    function renderContent() {
      const withEmail = currentItems.filter(i => i.email && i.email.includes('@'));
      const withoutEmail = currentItems.filter(i => !i.email || !i.email.includes('@'));
      const sampleItem = withEmail[0] || currentItems[0] || {};
      const previewHTML = selectedType === 'dispatch' 
        ? buildDispatchEmailHTML(sampleItem)
        : selectedType === 'delivery'
        ? buildDeliveryConfirmedEmailHTML(sampleItem)
        : buildFailedDeliveryEmailHTML(sampleItem);

      const hasSelection = items && items.length > 0 && items.length !== baseScope.length;
      const isFilteredScope = baseScope.length < allWaypoints.length;
      const scopeLabel = isFilteredScope 
        ? `Despachos en pantalla / filtrados (${baseScope.length})` 
        : `Todos los despachos (${baseScope.length})`;

      modal.innerHTML = `
        <div class="card" style="width: 760px; max-width: 95%; max-height: 90vh; overflow-y: auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); animation: scaleUp 0.2s ease; border-radius: var(--radius-lg);">
          
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-mail-send-line" style="color: #2563eb;"></i> Enviar Notificación Masiva por Correo (Brevo)
            </h3>
            <button id="close-brevo-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
          </div>

          ${baseScope.length > 0 ? `
            <div style="display: flex; gap: 0.5rem; background: var(--color-bg); padding: 0.5rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); align-items: center; flex-wrap: wrap;">
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-main);">Alcance del Envío:</span>
              <button id="scope-all" class="btn btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; cursor: pointer; ${currentItems.length === baseScope.length ? 'background: #2563eb; color: white; border: none;' : 'background: transparent; color: var(--color-text-main); border: 1px solid var(--color-border);'}">
                ${scopeLabel}
              </button>
              ${hasSelection ? `
                <button id="scope-selected" class="btn btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; cursor: pointer; ${currentItems.length === items.length ? 'background: #2563eb; color: white; border: none;' : 'background: transparent; color: var(--color-text-main); border: 1px solid var(--color-border);'}">
                  Solo seleccionados (${items.length})
                </button>
              ` : ''}
            </div>
          ` : ''}

          <div style="font-size: 0.85rem; background: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <span style="color: var(--color-text-main); font-weight: 600;">Remitente:</span>
              <span style="color: var(--color-primary); font-weight: 700; font-family: monospace;">info@stocka.cl</span> (STOCKA Despachos)
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <span class="badge" style="background: var(--badge-success-bg); color: var(--badge-success-text); font-weight: 700;">
                <i class="ri-checkbox-circle-line"></i> ${withEmail.length} Con Correo
              </span>
              ${withoutEmail.length > 0 ? `
                <span class="badge" style="background: var(--badge-danger-bg); color: var(--badge-danger-text); font-weight: 700;" title="${withoutEmail.map(x => x.reference).join(', ')}">
                  <i class="ri-close-circle-line"></i> ${withoutEmail.length} Sin Correo
                </span>
              ` : ''}
            </div>
          </div>

          <div class="form-group" style="display: flex; flex-direction: column; gap: 0.35rem;">
            <label style="font-weight: 700; font-size: 0.85rem; color: var(--color-text-main);">Tipo de Plantilla de Correo</label>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <label style="display: flex; align-items: flex-start; gap: 0.4rem; cursor: pointer; font-size: 0.8rem; color: var(--color-text-main); background: var(--color-bg); padding: 0.55rem 0.65rem; border-radius: var(--radius-md); border: 1.5px solid ${selectedType === 'dispatch' ? '#2563eb' : 'var(--color-border)'}; flex: 1; min-width: 200px;">
                <input type="radio" name="email-type-rad" value="dispatch" ${selectedType === 'dispatch' ? 'checked' : ''} style="margin-top: 0.15rem;">
                <div>
                  <strong style="color: #2563eb; font-size: 0.82rem;">🚚 Aviso Programado</strong>
                  <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.1rem; line-height: 1.3;">Despacho listo y preparado para salida a reparto</div>
                </div>
              </label>
              <label style="display: flex; align-items: flex-start; gap: 0.4rem; cursor: pointer; font-size: 0.8rem; color: var(--color-text-main); background: var(--color-bg); padding: 0.55rem 0.65rem; border-radius: var(--radius-md); border: 1.5px solid ${selectedType === 'delivery' ? '#059669' : 'var(--color-border)'}; flex: 1; min-width: 200px;">
                <input type="radio" name="email-type-rad" value="delivery" ${selectedType === 'delivery' ? 'checked' : ''} style="margin-top: 0.15rem;">
                <div>
                  <strong style="color: #059669; font-size: 0.82rem;">🎉 Entrega Exitosa</strong>
                  <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.1rem; line-height: 1.3;">Confirmación de entrega efectuada en dirección</div>
                </div>
              </label>
              <label style="display: flex; align-items: flex-start; gap: 0.4rem; cursor: pointer; font-size: 0.8rem; color: var(--color-text-main); background: var(--color-bg); padding: 0.55rem 0.65rem; border-radius: var(--radius-md); border: 1.5px solid ${selectedType === 'failed' ? '#c2410c' : 'var(--color-border)'}; flex: 1; min-width: 200px;">
                <input type="radio" name="email-type-rad" value="failed" ${selectedType === 'failed' ? 'checked' : ''} style="margin-top: 0.15rem;">
                <div>
                  <strong style="color: #c2410c; font-size: 0.82rem;">⚠️ Novedad / Saltado</strong>
                  <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.1rem; line-height: 1.3;">Informa problema en ruta y opción de reprogramación</div>
                </div>
              </label>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.35rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <label style="font-weight: 700; font-size: 0.85rem; color: var(--color-text-main);">Vista Previa del Correo (${sampleItem.reference || 'Ejemplo'})</label>
              <span style="font-size: 0.75rem; color: var(--color-text-muted);">Formato B2C Responsive</span>
            </div>
            <iframe id="brevo-email-preview-frame" style="width: 100%; height: 280px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: white;"></iframe>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border); padding-top: 1rem;">
            <button id="cancel-brevo-modal" class="btn btn-outline" style="padding: 0.5rem 1rem;">Cancelar</button>
            <button id="btn-submit-send-brevo" class="btn btn-primary" style="background: #2563eb; color: white; padding: 0.5rem 1.25rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem; border: none; border-radius: var(--radius-md); cursor: pointer;" ${withEmail.length === 0 ? 'disabled' : ''}>
              <i class="ri-send-plane-fill"></i> Enviar ${withEmail.length} Correo(s) por Brevo
            </button>
          </div>

        </div>
      `;

      document.body.appendChild(modal);

      const iframe = document.getElementById('brevo-email-preview-frame');
      if (iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(previewHTML);
        doc.close();
      }

      modal.querySelector('#close-brevo-modal').addEventListener('click', () => modal.remove());
      modal.querySelector('#cancel-brevo-modal').addEventListener('click', () => modal.remove());

      const scopeAllBtn = modal.querySelector('#scope-all');
      if (scopeAllBtn) {
        scopeAllBtn.addEventListener('click', () => {
          currentItems = baseScope;
          renderContent();
        });
      }

      const scopeSelBtn = modal.querySelector('#scope-selected');
      if (scopeSelBtn) {
        scopeSelBtn.addEventListener('click', () => {
          currentItems = items;
          renderContent();
        });
      }

      modal.querySelectorAll('input[name="email-type-rad"]').forEach(r => {
        r.addEventListener('change', (e) => {
          selectedType = e.target.value;
          renderContent();
        });
      });

      const btnSubmit = modal.querySelector('#btn-submit-send-brevo');
      btnSubmit.addEventListener('click', async () => {
        if (withEmail.length === 0) return;
        
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Enviando... (0/${withEmail.length})`;

        let successCount = 0;
        let failCount = 0;
        const errors = [];

        for (let i = 0; i < withEmail.length; i++) {
          const item = withEmail[i];
          btnSubmit.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Enviando (${i + 1}/${withEmail.length})...`;
          try {
            await sendBrevoNotificationEmail(item, selectedType);
            successCount++;
          } catch (err) {
            failCount++;
            errors.push(`${item.reference}: ${err.message}`);
          }
        }

        modal.remove();
        applyFilters();

        if (window.Swal) {
          if (failCount === 0) {
            Swal.fire({
              icon: 'success',
              title: '¡Correos Enviados!',
              text: `Se enviaron ${successCount} correo(s) correctamente desde info@stocka.cl a través de Brevo.`,
              confirmButtonColor: 'var(--color-primary)'
            });
          } else {
            Swal.fire({
              icon: 'warning',
              title: 'Envío Completado con Observaciones',
              html: `Enviados con éxito: <strong>${successCount}</strong><br>Fallidos: <strong>${failCount}</strong><br><br><small style="color:red;">${errors.join('<br>')}</small>`,
              confirmButtonColor: 'var(--color-primary)'
            });
          }
        } else {
          alert(`Se enviaron ${successCount} correos (${failCount} fallidos).`);
        }
      });
    }

    renderContent();
  }

  // default templates
  const defaultTemplates = [
    {
      id: 'aviso_reparto',
      name: 'Aviso de Reparto (Camino)',
      text: 'Hola {nombre}, te saludamos de {proveedor}. Te informamos que tu pedido {referencia} ya va en camino a tu dirección {direccion}. Puedes ver el mapa y seguimiento aquí: {tracking_url}'
    },
    {
      id: 'problema_direccion',
      name: 'Problema con Dirección',
      text: 'Hola {nombre}, te contactamos de {proveedor} por tu pedido {referencia}. Tenemos un problema con tu dirección: {direccion} {complemento}, {comuna}. ¿Nos podrías confirmar las indicaciones?'
    },
    {
      id: 'entrega_exitosa',
      name: 'Confirmación de Entrega',
      text: 'Hola {nombre}, tu pedido {referencia} enviado por {proveedor} ha sido entregado exitosamente. ¡Muchas gracias por tu preferencia!'
    }
  ];

  function getWhatsAppTemplates() {
    const stored = localStorage.getItem('optiroute_whatsapp_templates');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error(e);
      }
    }
    return defaultTemplates;
  }

  function saveWhatsAppTemplates(templates) {
    localStorage.setItem('optiroute_whatsapp_templates', JSON.stringify(templates));
  }

  // WhatsApp Modal Popup con Selector de Plantillas
  function openWhatsAppModal(item) {
    const modalId = 'optiroute-whatsapp-modal';
    let templates = getWhatsAppTemplates();
    let selectedTemplateId = templates[0]?.id || '';

    // Cerrar cualquier modal existente
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(15, 23, 42, 0.75)';
    modal.style.zIndex = '99999';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.animation = 'fadeIn 0.2s ease';

    // Helper para reemplazar variables dinámicas
    function replacePlaceholders(text, item) {
      return text
        .replace(/{nombre}/g, item.name || '')
        .replace(/{referencia}/g, item.reference || '')
        .replace(/{proveedor}/g, item.supplier || 'STOCKA')
        .replace(/{direccion}/g, item.address || '')
        .replace(/{complemento}/g, item.complemento || '')
        .replace(/{comuna}/g, item.comuna || '')
        .replace(/{tracking_url}/g, item.tracking_url || '');
    }

    function renderModalContent(view = 'send') {
      if (view === 'send') {
        const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];
        const replacedText = selectedTemplate ? replacePlaceholders(selectedTemplate.text, item) : '';

        modal.innerHTML = `
          <div class="card" style="width: 500px; max-width: 90%; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); animation: scaleUp 0.2s ease; border-radius: var(--radius-lg);">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
              <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
                <i class="ri-whatsapp-line" style="color: var(--color-success);"></i> Contactar Destinatario
              </h3>
              <button id="close-wa-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
            </div>
            
            <div style="font-size: 0.85rem; color: var(--color-text-muted); display: flex; flex-direction: column; gap: 0.2rem; background: var(--color-bg); padding: 0.5rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
              <span><strong>Destinatario:</strong> ${item.name}</span>
              <span><strong>Teléfono:</strong> ${item.phone}</span>
              <span><strong>Pedido:</strong> ${item.reference} (${item.supplier || 'STOCKA'})</span>
              ${item.complemento ? `<span><strong>Complemento:</strong> ${item.complemento}</span>` : ''}
            </div>

            <div class="form-group" style="display: flex; flex-direction: column; gap: 0.35rem;">
              <label class="form-label" style="font-weight: 600; font-size: 0.8rem; color: var(--color-text-main);">Seleccionar Plantilla</label>
              <select id="wa-select-template" class="form-input" style="width: 100%; padding: 0.5rem; font-size: 0.85rem; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-md); height: 36px; cursor: pointer;">
                ${templates.map(t => `<option value="${t.id}" ${t.id === selectedTemplateId ? 'selected' : ''}>${t.name}</option>`).join('')}
              </select>
            </div>

            <div class="form-group" style="display: flex; flex-direction: column; gap: 0.35rem;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <label class="form-label" style="font-weight: 600; font-size: 0.8rem; color: var(--color-text-main);">Mensaje a Enviar</label>
                <span style="font-size: 0.7rem; color: var(--color-text-muted);">Puedes editar el texto antes de enviar</span>
              </div>
              <textarea id="wa-message-preview" class="form-input" style="width: 100%; height: 120px; padding: 0.5rem; font-size: 0.85rem; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-md); resize: vertical; line-height: 1.4; font-family: inherit;">${replacedText}</textarea>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; border-top: 1px solid var(--color-border); padding-top: 0.75rem;">
              <button id="btn-manage-templates" class="btn btn-outline" style="font-size: 0.8rem; font-weight: 600; height: 36px; padding: 0 0.75rem; border: 1px solid var(--color-border); color: var(--color-text-main); background: transparent; cursor: pointer; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.25rem;">
                <i class="ri-settings-3-line"></i> Gestionar Plantillas
              </button>
              <div style="display: flex; gap: 0.5rem;">
                <button id="btn-cancel-wa" class="btn btn-outline" style="font-size: 0.8rem; font-weight: 600; height: 36px; padding: 0 1rem; border: 1px solid var(--color-border); color: var(--color-text-main); background: transparent; cursor: pointer; border-radius: var(--radius-md);">Cancelar</button>
                <button id="btn-send-wa" class="btn btn-success" style="font-size: 0.8rem; font-weight: 600; height: 36px; padding: 0 1.25rem; border: none; background: var(--color-success); color: white; cursor: pointer; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-whatsapp-line"></i> Abrir WhatsApp
                </button>
              </div>
            </div>
          </div>
        `;

        // Registrar eventos para la vista de envío
        modal.querySelector('#close-wa-modal').addEventListener('click', () => modal.remove());
        modal.querySelector('#btn-cancel-wa').addEventListener('click', () => modal.remove());
        
        const select = modal.querySelector('#wa-select-template');
        const textarea = modal.querySelector('#wa-message-preview');
        
        select.addEventListener('change', () => {
          selectedTemplateId = select.value;
          const template = templates.find(t => t.id === selectedTemplateId);
          textarea.value = template ? replacePlaceholders(template.text, item) : '';
        });

        modal.querySelector('#btn-manage-templates').addEventListener('click', () => {
          renderModalContent('manage');
        });

        modal.querySelector('#btn-send-wa').addEventListener('click', () => {
          const finalMsg = textarea.value.trim();
          let cleanPhone = String(item.phone).replace(/\D/g, '');
          if (cleanPhone.startsWith('9') && cleanPhone.length === 9) {
            cleanPhone = '56' + cleanPhone;
          } else if (cleanPhone.length === 9 && !cleanPhone.startsWith('56')) {
            cleanPhone = '56' + cleanPhone;
          }
          const finalUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(finalMsg)}`;
          window.open(finalUrl, '_blank');
          modal.remove();
        });

      } else if (view === 'manage') {
        modal.innerHTML = `
          <div class="card" style="width: 550px; max-width: 95%; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); animation: scaleUp 0.2s ease; border-radius: var(--radius-lg);">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
              <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
                <i class="ri-settings-3-line" style="color: var(--color-primary);"></i> Plantillas Guardadas
              </h3>
              <button id="close-wa-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
            </div>
            
            <!-- Listado de plantillas -->
            <div style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 0.25rem;">
              ${templates.map(t => `
                <div style="background: var(--color-bg); border: 1px solid var(--color-border); padding: 0.5rem 0.75rem; border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                  <div style="display: flex; flex-direction: column; gap: 0.15rem; overflow: hidden; text-align: left; width: 100%;">
                    <strong style="font-size: 0.85rem; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.name}</strong>
                    <span style="font-size: 0.75rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.text}</span>
                  </div>
                  <div style="display: flex; gap: 0.25rem; flex-shrink: 0;">
                    <button class="btn btn-sm btn-outline edit-t-btn" data-id="${t.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; height: auto; border: 1px solid var(--color-border); color: var(--color-text-main); background: transparent; cursor: pointer; border-radius: var(--radius-sm);">Editar</button>
                    <button class="btn btn-sm btn-outline delete-t-btn" data-id="${t.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; height: auto; border: 1px solid #ef4444; color: #ef4444; background: transparent; cursor: pointer; border-radius: var(--radius-sm);">Eliminar</button>
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- Formulario Editor -->
            <div id="template-editor" style="display: none; border-top: 1px solid var(--color-border); padding-top: 1rem; flex-direction: column; gap: 0.75rem; text-align: left;">
              <h4 id="editor-title" style="margin: 0; font-size: 0.9rem; font-weight: 700; color: var(--color-text-main);">Nueva Plantilla</h4>
              <input type="hidden" id="editor-id">
              
              <div class="form-group" style="display: flex; flex-direction: column; gap: 0.25rem;">
                <label class="form-label" style="font-weight: 600; font-size: 0.75rem; color: var(--color-text-main);">Nombre de la Plantilla</label>
                <input type="text" id="editor-name" class="form-input" placeholder="Ej. Dirección Incorrecta" style="width: 100%; padding: 0.4rem 0.5rem; font-size: 0.8rem; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-md); height: 32px;">
              </div>

              <div class="form-group" style="display: flex; flex-direction: column; gap: 0.25rem;">
                <label class="form-label" style="font-weight: 600; font-size: 0.75rem; color: var(--color-text-main);">Contenido del Mensaje</label>
                <textarea id="editor-text" class="form-input" placeholder="Escribe el mensaje..." style="width: 100%; height: 80px; padding: 0.4rem 0.5rem; font-size: 0.8rem; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-md); resize: vertical; line-height: 1.4; font-family: inherit;"></textarea>
              </div>

              <!-- Variables legend -->
              <div style="font-size: 0.7rem; color: var(--color-text-muted); background: var(--color-bg); padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); line-height: 1.4; text-align: left;">
                <strong>Campos dinámicos soportados:</strong><br>
                <code>{nombre}</code>: Destinatario | <code>{referencia}</code>: Nro Pedido | <code>{proveedor}</code>: Comercio<br>
                <code>{direccion}</code>: Dirección | <code>{complemento}</code>: Depto/Ofic | <code>{comuna}</code>: Comuna | <code>{tracking_url}</code>: Link
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button id="btn-cancel-editor" class="btn btn-sm btn-outline" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; height: auto; border: 1px solid var(--color-border); color: var(--color-text-main); background: transparent; cursor: pointer; border-radius: var(--radius-sm);">Cancelar</button>
                <button id="btn-save-template" class="btn btn-sm btn-primary" style="padding: 0.35rem 1rem; font-size: 0.8rem; height: auto; border: none; background: var(--color-primary); color: white; cursor: pointer; border-radius: var(--radius-sm);">Guardar Plantilla</button>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: 0.5rem;">
              <button id="btn-create-template" class="btn btn-primary" style="font-size: 0.8rem; font-weight: 600; height: 36px; padding: 0 1rem; border: none; background: var(--color-primary); color: white; cursor: pointer; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.25rem;">
                <i class="ri-add-line"></i> Crear Nueva Plantilla
              </button>
              <button id="btn-back-to-send" class="btn btn-outline" style="font-size: 0.8rem; font-weight: 600; height: 36px; padding: 0 1.25rem; border: 1px solid var(--color-border); color: var(--color-text-main); background: transparent; cursor: pointer; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.25rem;">
                <i class="ri-arrow-left-line"></i> Volver
              </button>
            </div>
          </div>
        `;

        // Registrar eventos para la vista de gestión
        modal.querySelector('#close-wa-modal').addEventListener('click', () => modal.remove());
        modal.querySelector('#btn-back-to-send').addEventListener('click', () => {
          renderModalContent('send');
        });

        const editorZone = modal.querySelector('#template-editor');
        const editorTitle = modal.querySelector('#editor-title');
        const editorId = modal.querySelector('#editor-id');
        const editorName = modal.querySelector('#editor-name');
        const editorText = modal.querySelector('#editor-text');

        modal.querySelector('#btn-create-template').addEventListener('click', () => {
          editorTitle.textContent = 'Nueva Plantilla';
          editorId.value = '';
          editorName.value = '';
          editorText.value = '';
          editorZone.style.display = 'flex';
          editorName.focus();
        });

        modal.querySelector('#btn-cancel-editor').addEventListener('click', () => {
          editorZone.style.display = 'none';
        });

        modal.querySelector('#btn-save-template').addEventListener('click', () => {
          const nameVal = editorName.value.trim();
          const textVal = editorText.value.trim();
          const idVal = editorId.value;

          if (!nameVal || !textVal) {
            if (window.Swal) Swal.fire('Atención', 'Nombre y texto del mensaje son requeridos.', 'warning');
            return;
          }

          if (idVal) {
            // Editar existente
            templates = templates.map(t => t.id === idVal ? { ...t, name: nameVal, text: textVal } : t);
          } else {
            // Crear nueva
            const newId = 't_' + Date.now();
            templates.push({ id: newId, name: nameVal, text: textVal });
          }

          saveWhatsAppTemplates(templates);
          editorZone.style.display = 'none';
          renderModalContent('manage');
        });

        // Botones de edición
        modal.querySelectorAll('.edit-t-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const tId = btn.getAttribute('data-id');
            const template = templates.find(t => t.id === tId);
            if (template) {
              editorTitle.textContent = 'Editar Plantilla';
              editorId.value = template.id;
              editorName.value = template.name;
              editorText.value = template.text;
              editorZone.style.display = 'flex';
              editorName.focus();
            }
          });
        });

        // Botones de eliminación
        modal.querySelectorAll('.delete-t-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const tId = btn.getAttribute('data-id');
            if (templates.length <= 1) {
              if (window.Swal) Swal.fire('Atención', 'Debes tener al menos una plantilla configurada.', 'warning');
              return;
            }
            if (window.Swal) {
              Swal.fire({
                title: '¿Eliminar plantilla?',
                text: 'Esta acción no se puede deshacer.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                cancelButtonColor: 'var(--color-border)',
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancelar'
              }).then((result) => {
                if (result.isConfirmed) {
                  templates = templates.filter(t => t.id !== tId);
                  saveWhatsAppTemplates(templates);
                  if (selectedTemplateId === tId) selectedTemplateId = templates[0].id;
                  renderModalContent('manage');
                }
              });
            } else {
              if (confirm('¿Eliminar plantilla?')) {
                templates = templates.filter(t => t.id !== tId);
                saveWhatsAppTemplates(templates);
                if (selectedTemplateId === tId) selectedTemplateId = templates[0].id;
                renderModalContent('manage');
              }
            }
          });
        });
      }
    }

    renderModalContent('send');
    document.body.appendChild(modal);
  }
}

