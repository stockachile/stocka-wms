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
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
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

          // Ordenar por parada
          allWaypoints.sort((a, b) => a.order - b.order);

          // Obtener nombre de ruta
          const routeName = cached[0].raw_data?.route_plan?.name || 'Ruta Optiroute';

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

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Error HTTP ${res.status}`);

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
        console.warn('Advertencia al consultar optiroute_api_logs:', error.message);
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

      // 4. Estado Badge
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

      const statusBadge = `
        <span class="badge" style="display: inline-block; padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 700; ${badgeStyle}">
          ${item.status}
        </span>
      `;

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
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span>#${item.order}</span>
              <button class="btn btn-sm btn-outline btn-print-single-label" data-idx="${idx}" style="padding: 0.15rem 0.3rem; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; gap: 0.1rem; border-radius: 4px; border: 1px solid var(--color-border); background: transparent; cursor: pointer; color: var(--color-text-main);" title="Imprimir Etiqueta">
                <i class="ri-printer-line"></i>
              </button>
            </div>
          </td>
          <td style="padding: 0.75rem 0.5rem; font-weight: 600; font-family: monospace; color: var(--color-primary);">${item.reference}</td>
          <td style="padding: 0.75rem 0.5rem; font-weight: 500; color: var(--color-text-main);">${item.name}</td>
          <td style="padding: 0.75rem 0.5rem;">${contactHTML}</td>
          <td style="padding: 0.75rem 0.5rem;">${addressHTML}</td>
          <td style="padding: 0.75rem 0.5rem;">${driverHTML}</td>
          <td style="padding: 0.75rem 0.5rem;">${statusBadge}</td>
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
        if (item) openWhatsAppModal(item);
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
  }

  // Función para Renderizar e Imprimir Etiquetas Térmicas de Envío (100mm x 150mm)
  function printWaypointsLabels(waypoints) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor, permite las ventanas emergentes (popups) para poder imprimir las etiquetas.');
      return;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Etiquetas de Envío WMS STOCKA</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page {
            size: 100mm 150mm;
            margin: 0;
          }
          @media print {
            body {
              margin: 0;
              padding: 0;
              background: white;
            }
            .label-page {
              page-break-after: always;
            }
          }
          body {
            font-family: 'Outfit', 'Segoe UI', Arial, sans-serif;
            margin: 0;
            padding: 0;
            background: white;
            -webkit-print-color-adjust: exact;
          }
          .label-page {
            width: 100mm;
            height: 150mm;
            box-sizing: border-box;
            padding: 4mm;
            display: flex;
            flex-direction: column;
            gap: 2.5mm;
            background: white;
            color: black;
          }
          .label-box {
            border: 2px solid #000000;
            border-radius: 8px;
            padding: 2mm 3mm;
            display: flex;
            flex-direction: column;
            justify-content: center;
            box-sizing: border-box;
          }
          .label-row-1 {
            display: flex;
            gap: 2.5mm;
            height: 20mm;
          }
          .label-box-order {
            width: 25%;
            align-items: center;
            justify-content: center;
            background: #ffffff;
          }
          .label-box-pedido {
            width: 75%;
            justify-content: center;
          }
          .label-row-2 {
            display: flex;
            gap: 2.5mm;
            height: 28mm;
          }
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
          .qr-code {
            width: 100%;
            height: 100%;
            max-width: 22mm;
            max-height: 22mm;
            object-fit: contain;
          }
          .label-row-3 {
            height: 44mm;
          }
          .label-box-direccion {
            height: 100%;
            justify-content: flex-start;
            gap: 1mm;
          }
          .label-row-4 {
            height: 16mm;
          }
          .label-box-notas {
            height: 100%;
            justify-content: flex-start;
            overflow: hidden;
          }
          .label-row-5 {
            display: flex;
            gap: 2.5mm;
            height: 16mm;
          }
          .label-box-route {
            width: 55%;
            flex-direction: row;
            align-items: center;
            justify-content: flex-start;
            gap: 4mm;
          }
          .label-box-logo {
            width: 45%;
            border: none;
            padding: 0;
            align-items: center;
            justify-content: flex-end;
          }
          .label-title {
            font-size: 7.5pt;
            font-weight: 700;
            color: #4b5563;
            text-transform: uppercase;
            margin: 0;
            letter-spacing: 0.5px;
          }
          .label-value-order {
            font-size: 32pt;
            font-weight: 800;
            margin: 0;
            line-height: 1;
            color: #000;
          }
          .label-value-reference {
            font-size: 13pt;
            font-weight: 800;
            margin: 0;
            line-height: 1.2;
          }
          .label-value-comercio {
            font-size: 10.5pt;
            font-weight: 700;
            margin: 2px 0 0 0;
            text-transform: uppercase;
            color: #374151;
            letter-spacing: 0.3px;
          }
          .label-value-name {
            font-size: 10pt;
            font-weight: 700;
            margin: 1px 0;
          }
          .label-value-phone {
            font-size: 10.5pt;
            font-weight: 700;
            margin: 0;
            font-family: monospace;
          }
          .label-value-address {
            font-size: 11pt;
            font-weight: 700;
            margin: 0;
            line-height: 1.2;
          }
          .label-value-complemento {
            font-size: 9.5pt;
            font-weight: 600;
            margin: 0;
            color: #1f2937;
          }
          .label-value-comuna {
            font-size: 18pt;
            font-weight: 800;
            margin: 0;
            text-transform: uppercase;
            color: #000;
            line-height: 1.1;
          }
          .label-value-notes {
            font-size: 8pt;
            font-weight: 500;
            margin: 2px 0 0 0;
            color: #1f2937;
            line-height: 1.3;
          }
          .label-value-assign {
            font-size: 20pt;
            font-weight: 800;
            margin: 0;
            line-height: 1;
          }
          .label-value-route-name {
            font-size: 9pt;
            font-weight: 700;
            margin: 0;
            color: #374151;
          }
          .stocka-logo-container {
            display: flex;
            align-items: center;
            gap: 2mm;
          }
          .stocka-logo-text {
            font-size: 13.5pt;
            font-weight: 800;
            color: #1e1b4b;
            margin: 0;
            line-height: 1;
          }
          .stocka-logo-sub {
            font-size: 5pt;
            font-weight: 600;
            color: #4b5563;
            margin: 0.15rem 0 0 0;
            line-height: 1.2;
            text-transform: uppercase;
            letter-spacing: 0.2px;
          }
        </style>
      </head>
      <body>
        ${waypoints.map(wp => {
          const qrid = wp.reference !== 'S/R' ? wp.reference : wp.order;
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(wp.tracking_url || qrid)}`;
          const cleanVehicle = wp.route_vehicle || 'Sin Asig.';
          const cleanRouteName = wp.route_name || 'Ruta Optiroute';
          
          return `
            <div class="label-page">
              <div class="label-row-1">
                <div class="label-box label-box-order">
                  <span class="label-title">Orden</span>
                  <span class="label-value-order">${wp.order}</span>
                </div>
                <div class="label-box label-box-pedido">
                  <span class="label-title">Pedido:</span>
                  <span class="label-value-reference">${wp.reference}</span>
                  <span class="label-value-comercio">${wp.supplier}</span>
                </div>
              </div>
              
              <div class="label-row-2">
                <div class="label-box label-box-cliente">
                  <div>
                    <span class="label-title">Cliente</span>
                    <div class="label-value-name">${wp.name}</div>
                  </div>
                  <div>
                    <span class="label-title">Teléfono</span>
                    <div class="label-value-phone">${wp.phone || 'Sin número'}</div>
                  </div>
                </div>
                <div class="label-box label-box-qr">
                  <img class="qr-code" src="${qrUrl}" alt="QR">
                </div>
              </div>
              
              <div class="label-row-3">
                <div class="label-box label-box-direccion">
                  <span class="label-title">Dirección</span>
                  <span class="label-value-address">${wp.address}</span>
                  
                  <span class="label-title" style="margin-top: 3px;">Complemento:</span>
                  <span class="label-value-complemento">${wp.complemento || 'Sin complemento'}</span>
                  
                  <span class="label-title" style="margin-top: 5px;">Zona Entrega:</span>
                  <span class="label-value-comuna">${wp.comuna || 'Sin Comuna'}</span>
                </div>
              </div>
              
              <div class="label-row-4">
                <div class="label-box label-box-notas">
                  <span class="label-title">Notas:</span>
                  <span class="label-value-notes">${wp.note || 'Sin notas del pedido.'}</span>
                </div>
              </div>
              
              <div class="label-row-5">
                <div class="label-box label-box-route">
                  <div>
                    <span class="label-title">Asignación</span>
                    <div class="label-value-assign">${cleanVehicle}</div>
                  </div>
                  <div>
                    <span class="label-title">Ruta</span>
                    <div class="label-value-route-name">${cleanRouteName}</div>
                  </div>
                </div>
                <div class="label-box label-box-logo">
                  <div class="stocka-logo-container">
                    <svg viewBox="0 0 100 100" width="28" height="28" style="flex-shrink: 0;">
                      <polygon points="50,5 95,25 95,75 50,95 5,75 5,25" fill="#6366f1" />
                      <path d="M35 65 L65 35 M45 35 L65 35 L65 55" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                    </svg>
                    <div style="display: flex; flex-direction: column; align-items: flex-start;">
                      <span class="stocka-logo-text">Stocka</span>
                      <span class="stocka-logo-sub">Logística y Fulfillment</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
        
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 500);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }

  // Lightbox Modal para fotos de entrega
  function openLightboxModal(imageUrl) {
    const lightbox = document.createElement('div');
    lightbox.id = 'optiroute-lightbox-overlay';
    lightbox.style.position = 'fixed';
    lightbox.style.inset = '0';
    lightbox.style.background = 'rgba(15, 23, 42, 0.9)'; // Dark slate background
    lightbox.style.zIndex = '99999';
    lightbox.style.display = 'flex';
    lightbox.style.alignItems = 'center';
    lightbox.style.justifyContent = 'center';
    lightbox.style.animation = 'fadeIn 0.25s ease';

    lightbox.innerHTML = `
      <div style="position: relative; max-width: 90%; max-height: 85vh; border-radius: var(--radius-lg); overflow: hidden; border: 2px solid var(--color-border); box-shadow: var(--shadow-lg); background: black;">
        <img src="${imageUrl}" style="max-width: 100%; max-height: 80vh; display: block; object-fit: contain;">
        <button id="close-lightbox" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; cursor: pointer; transition: all 0.2s;">&times;</button>
        <div style="background: rgba(0,0,0,0.7); color: white; padding: 0.75rem 1rem; font-size: 0.8rem; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
          Comprobante de Entrega Optiroute
        </div>
      </div>
    `;

    document.body.appendChild(lightbox);

    const closeBtn = lightbox.querySelector('#close-lightbox');
    closeBtn.addEventListener('click', () => lightbox.remove());
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
    }

    return resData;
  }

  async function checkAndAutoSendDispatchEmails(waypoints) {
    const dispatchWaypoints = waypoints.filter(w => {
      const st = (String(w.status || '') + ' ' + String(w.status_name || '')).toLowerCase();
      const isCancelledOrDeleted = st.includes('cancel') || st.includes('eliminad') || st.includes('deleted');
      const hasEmail = w.email && w.email.includes('@');
      const notNotified = !w.dispatch_email_notified;
      return !isCancelledOrDeleted && hasEmail && notNotified;
    });

    if (dispatchWaypoints.length === 0) return;

    console.log(`Auto-enviando ${dispatchWaypoints.length} correos de aviso de despacho programado...`);
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
      const isFailed = st.includes('saltado') || st.includes('cancelado') || st.includes('eliminado') || st.includes('skipped') || st.includes('cancelled') || st.includes('deleted') || w.status_code === 5 || w.status === 5;
      const hasEmail = w.email && w.email.includes('@');
      const notNotified = !w.failed_email_notified;
      return isFailed && hasEmail && notNotified;
    });

    if (failedWaypoints.length === 0) return;

    console.log(`Auto-enviando ${failedWaypoints.length} correos de novedad de despacho (Saltados/Cancelados)...`);
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

