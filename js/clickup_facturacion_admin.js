// js/clickup_facturacion_admin.js - Módulo de Gestión y Edición de Facturación ClickUp
import supabase from './supabase.js';

const CLICKUP_TOKEN = 'pk_66860151_UON1SYIAIP9OJKLPSXGDAI0FFCNZ1BVL';
const SPACE_ID = '90170718518';

let clickupFacturacionData = [];
let filteredData = [];
let isSyncing = false;

// Opciones predefinidas de Dropdowns
const DROPDOWN_OPTIONS = {
  desglose_fulfillment: ['Enviado', 'Aprobado', 'Creado', 'Por generar'],
  pago_fulfillment: ['Recibido', 'En espera', 'Atrasado', 'Abono', 'Aprobado', 'Incobrable', 'Por solicitar'],
  factura_fulfillment: ['EMITIDA', 'Facturar', 'Esperando', 'No se factura'],
  pago_enviame: ['En espera', 'Recibido', 'Atrasado', 'Abono', 'Aprobado', 'Sin movimientos', 'Incobrable', 'Por emitir'],
  fact_enviame: ['EMITIDA', 'Facturar', 'Sin movimiento', 'Esperando', 'No se factura'],
  list_name: ['2026', '2025', '2024']
};

// Formateador de moneda CLP
function formatCLP(val) {
  if (val === null || val === undefined || isNaN(val)) return '$0';
  return '$' + Math.round(val).toLocaleString('es-CL');
}

// Generador de insignias de estado (ClickUp Pills)
function getStatusPillHTML(value, category) {
  if (!value) return `<span class="badge" style="background: var(--color-bg); color: var(--color-text-muted); border: 1px dashed #444;">-</span>`;

  let bg = '#374151';
  let color = '#ffffff';

  const valUpper = String(value).toUpperCase();

  if (category === 'desglose') {
    if (valUpper.includes('ENVIADO')) { bg = '#059669'; }
    else if (valUpper.includes('APROBADO')) { bg = '#0d9488'; }
    else if (valUpper.includes('CREADO')) { bg = '#8b5cf6'; }
    else if (valUpper.includes('POR GENERAR')) { bg = '#4b5563'; }
  } else if (category === 'pago') {
    if (valUpper.includes('RECIBIDO')) { bg = '#1d4ed8'; }
    else if (valUpper.includes('EN ESPERA')) { bg = '#6b21a8'; }
    else if (valUpper.includes('ATRASADO')) { bg = '#be185d'; }
    else if (valUpper.includes('ABONO')) { bg = '#9333ea'; }
    else if (valUpper.includes('APROBADO')) { bg = '#16a34a'; }
    else if (valUpper.includes('POR SOLICITAR')) { bg = '#475569'; }
    else if (valUpper.includes('SIN MOVIMIENTO')) { bg = '#0284c7'; }
    else if (valUpper.includes('INCOBRABLE')) { bg = '#111827'; color = '#ef4444'; }
  } else if (category === 'factura') {
    if (valUpper.includes('EMITIDA')) { bg = '#059669'; }
    else if (valUpper.includes('FACTURAR')) { bg = '#d97706'; color = '#000000'; }
    else if (valUpper.includes('ESPERANDO')) { bg = '#4b5563'; }
    else if (valUpper.includes('NO SE FACTURA')) { bg = '#15803d'; }
    else if (valUpper.includes('SIN MOVIMIENTO')) { bg = '#0d9488'; }
  }

  return `<span class="badge" style="background-color: ${bg}; color: ${color}; padding: 0.25rem 0.6rem; font-size: 0.75rem; border-radius: 6px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; white-space: nowrap;">${value}</span>`;
}

// Render principal del Módulo
window.renderClickupFacturacionAdmin = async function(targetContainerId = 'app-content') {
  const container = document.getElementById(targetContainerId);
  if (!container) return;

  container.innerHTML = `
    <div style="padding: 1rem 0;">
      <!-- Header Bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h3 style="margin: 0; font-size: 1.3rem; color: var(--color-text-main); font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-table-line" style="color: #6366f1;"></i> Facturación ClickUp
          </h3>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.85rem; color: var(--color-text-muted);">
            Visualización y edición en tiempo real de los datos extraídos del espacio FACTURACIÓN de ClickUp.
          </p>
        </div>
        <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
          <button id="btn-sync-clickup-live" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.4rem; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
            <i class="ri-refresh-line" id="sync-icon"></i> Sincronizar ClickUp
          </button>
          <button id="btn-create-clickup-record" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-add-line"></i> Nuevo Registro
          </button>
        </div>
      </div>

      <!-- Summary KPI Cards -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="card" style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1rem; border-radius: 8px;">
          <span style="font-size: 0.8rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Total Registros</span>
          <strong id="kpi-clickup-count" style="font-size: 1.5rem; color: var(--color-text-main);">0</strong>
        </div>
        <div class="card" style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1rem; border-radius: 8px;">
          <span style="font-size: 0.8rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Total FULFILLMENT</span>
          <strong id="kpi-clickup-fulf" style="font-size: 1.5rem; color: #10b981;">$0</strong>
        </div>
        <div class="card" style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1rem; border-radius: 8px;">
          <span style="font-size: 0.8rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Total ENVIAME</span>
          <strong id="kpi-clickup-env" style="font-size: 1.5rem; color: #3b82f6;">$0</strong>
        </div>
        <div class="card" style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1rem; border-radius: 8px;">
          <span style="font-size: 0.8rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Gran Total</span>
          <strong id="kpi-clickup-grand-total" style="font-size: 1.5rem; color: #6366f1;">$0</strong>
        </div>
      </div>

      <!-- Filters Toolbar -->
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center;">
        <div style="flex: 1; min-width: 220px;">
          <input type="text" id="clickup-search-input" class="form-control" placeholder="🔍 Buscar por nombre, comercio, N° factura..." style="width: 100%; font-size: 0.85rem;">
        </div>
        <div style="width: 160px;">
          <select id="clickup-list-filter" class="form-control" style="font-size: 0.85rem;">
            <option value="all">Todas las listas</option>
            <option value="2026" selected>Año 2026</option>
            <option value="2025">Año 2025</option>
            <option value="2024">Año 2024</option>
          </select>
        </div>
        <div style="width: 180px;">
          <select id="clickup-comercio-filter" class="form-control" style="font-size: 0.85rem;">
            <option value="all">Todos los comercios</option>
          </select>
        </div>
        <div style="width: 180px;">
          <select id="clickup-pago-fulf-filter" class="form-control" style="font-size: 0.85rem;">
            <option value="all">Pago FULFILLMENT (Todos)</option>
            ${DROPDOWN_OPTIONS.pago_fulfillment.map(o => `<option value="${o}">${o}</option>`).join('')}
          </select>
        </div>
        <div style="width: 180px;">
          <select id="clickup-pago-env-filter" class="form-control" style="font-size: 0.85rem;">
            <option value="all">Pago ENVIAME (Todos)</option>
            ${DROPDOWN_OPTIONS.pago_enviame.map(o => `<option value="${o}">${o}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Main Data Table Container -->
      <div class="table-responsive" style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; overflow-x: auto;">
        <table class="table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
          <thead>
            <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--color-border); text-align: left; color: var(--color-text-muted);">
              <th style="padding: 0.75rem 0.5rem; text-align: center;">Acciones</th>
              <th style="padding: 0.75rem 0.5rem;">Lista / Año</th>
              <th style="padding: 0.75rem 0.5rem;">Nombre / Tarea</th>
              <th style="padding: 0.75rem 0.5rem;">Comercio</th>
              <th style="padding: 0.75rem 0.5rem;">Fecha Límite</th>
              <th style="padding: 0.75rem 0.5rem;">Desglose Fulf.</th>
              <th style="padding: 0.75rem 0.5rem;">Total FULF</th>
              <th style="padding: 0.75rem 0.5rem;">Abonos FULF</th>
              <th style="padding: 0.75rem 0.5rem;">Pago FULF</th>
              <th style="padding: 0.75rem 0.5rem;">Factura FULF</th>
              <th style="padding: 0.75rem 0.5rem;">N° Fact</th>
              <th style="padding: 0.75rem 0.5rem;">Envíame</th>
              <th style="padding: 0.75rem 0.5rem;">Abono ENV</th>
              <th style="padding: 0.75rem 0.5rem;">Pago ENV</th>
              <th style="padding: 0.75rem 0.5rem;">Factura ENV</th>
              <th style="padding: 0.75rem 0.5rem;">N° Fact ENV</th>
              <th style="padding: 0.75rem 0.5rem;">TOTAL</th>
            </tr>
          </thead>
          <tbody id="clickup-facturacion-table-body">
            <tr>
              <td colspan="17" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
                <i class="ri-loader-4-line spin" style="font-size: 1.8rem; display: block; margin-bottom: 0.5rem;"></i>
                Cargando registros de Facturación ClickUp...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  injectClickupModalHTML();
  bindClickupEvents();
  await fetchClickupFacturacionData();
};

// Insertar HTML del Modal de Edición si no existe
function injectClickupModalHTML() {
  if (document.getElementById('modal-edit-clickup-facturacion')) return;

  const modalHTML = `
    <div class="modal-overlay" id="modal-edit-clickup-facturacion" style="display: none; z-index: 1200;">
      <div class="modal-content" style="max-width: 850px; width: 95%; max-height: 90vh; overflow-y: auto; background: var(--color-surface); border-radius: 8px; border: 1px solid var(--color-border); padding: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
          <h3 id="clickup-modal-title" style="margin: 0; font-size: 1.15rem; color: var(--color-text-main);">Editar Registro de Facturación</h3>
          <button class="modal-close-btn" id="btn-close-clickup-modal" style="background: none; border: none; font-size: 1.4rem; color: var(--color-text-muted); cursor: pointer;">&times;</button>
        </div>
        
        <form id="clickup-edit-form">
          <input type="hidden" id="edit-clickup-task-id">

          <!-- Sección 1: Información General -->
          <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 6px; border: 1px solid var(--color-border); margin-bottom: 1rem;">
            <h5 style="margin: 0 0 0.75rem 0; color: #6366f1; font-size: 0.9rem;">📌 Información General</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Nombre de Tarea / Registro</label>
                <input type="text" id="edit-clickup-task-name" class="form-control" required style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Lista / Año</label>
                <select id="edit-clickup-list-name" class="form-control" style="font-size: 0.85rem;">
                  ${DROPDOWN_OPTIONS.list_name.map(l => `<option value="${l}">${l}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Comercio</label>
                <input type="text" id="edit-clickup-comercio" class="form-control" placeholder="Ej. BIG BANG" style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Fecha Límite</label>
                <input type="date" id="edit-clickup-fecha-limite" class="form-control" style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Mes</label>
                <input type="text" id="edit-clickup-mes" class="form-control" placeholder="Ej. MAYO 2026" style="font-size: 0.85rem;">
              </div>
            </div>
          </div>

          <!-- Sección 2: FULFILLMENT -->
          <div style="background: rgba(16, 185, 129, 0.03); padding: 1rem; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.2); margin-bottom: 1rem;">
            <h5 style="margin: 0 0 0.75rem 0; color: #10b981; font-size: 0.9rem;">📦 Gestión Fulfillment</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Desglose Fulfillment</label>
                <select id="edit-clickup-desglose-fulf" class="form-control" style="font-size: 0.85rem;">
                  <option value="">(Sin definir)</option>
                  ${DROPDOWN_OPTIONS.desglose_fulfillment.map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Total FULF ($)</label>
                <input type="number" id="edit-clickup-total-fulf" class="form-control" step="1" style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Abonos FULF ($)</label>
                <input type="number" id="edit-clickup-abonos-fulf" class="form-control" step="1" style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Pago Fulfillment</label>
                <select id="edit-clickup-pago-fulf" class="form-control" style="font-size: 0.85rem;">
                  <option value="">(Sin definir)</option>
                  ${DROPDOWN_OPTIONS.pago_fulfillment.map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Factura Fulfillment</label>
                <select id="edit-clickup-factura-fulf" class="form-control" style="font-size: 0.85rem;">
                  <option value="">(Sin definir)</option>
                  ${DROPDOWN_OPTIONS.factura_fulfillment.map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">N° Factura Fulf.</label>
                <input type="text" id="edit-clickup-n-fact" class="form-control" placeholder="Ej. 1034" style="font-size: 0.85rem;">
              </div>
            </div>
          </div>

          <!-- Sección 3: ENVIAME -->
          <div style="background: rgba(59, 130, 246, 0.03); padding: 1rem; border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.2); margin-bottom: 1.25rem;">
            <h5 style="margin: 0 0 0.75rem 0; color: #3b82f6; font-size: 0.9rem;">🚚 Gestión Envíame</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Envíame ($)</label>
                <input type="number" id="edit-clickup-enviame" class="form-control" step="1" style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Abono Envíame ($)</label>
                <input type="number" id="edit-clickup-abono-env" class="form-control" step="1" style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Pago Envíame</label>
                <select id="edit-clickup-pago-env" class="form-control" style="font-size: 0.85rem;">
                  <option value="">(Sin definir)</option>
                  ${DROPDOWN_OPTIONS.pago_enviame.map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Factura Envíame</label>
                <select id="edit-clickup-fact-env" class="form-control" style="font-size: 0.85rem;">
                  <option value="">(Sin definir)</option>
                  ${DROPDOWN_OPTIONS.fact_enviame.map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">N° Factura Envíame</label>
                <input type="text" id="edit-clickup-n-fact-env" class="form-control" placeholder="Ej. 1043" style="font-size: 0.85rem;">
              </div>
              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">TOTAL ($)</label>
                <input type="number" id="edit-clickup-total" class="form-control" step="1" style="font-size: 0.85rem;">
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
            <button type="button" class="btn btn-outline" id="btn-cancel-clickup-edit" style="border-color: var(--color-border); color: var(--color-text-main);">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="btn-save-clickup-edit"><i class="ri-save-line"></i> Guardar Cambios</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// Asignar listeners de eventos
function bindClickupEvents() {
  const searchInput = document.getElementById('clickup-search-input');
  const listFilter = document.getElementById('clickup-list-filter');
  const comercioFilter = document.getElementById('clickup-comercio-filter');
  const pagoFulfFilter = document.getElementById('clickup-pago-fulf-filter');
  const pagoEnvFilter = document.getElementById('clickup-pago-env-filter');
  const btnSync = document.getElementById('btn-sync-clickup-live');
  const btnCreate = document.getElementById('btn-create-clickup-record');
  const btnCloseModal = document.getElementById('btn-close-clickup-modal');
  const btnCancelEdit = document.getElementById('btn-cancel-clickup-edit');
  const editForm = document.getElementById('clickup-edit-form');

  if (searchInput) searchInput.addEventListener('input', applyClickupFilters);
  if (listFilter) listFilter.addEventListener('change', applyClickupFilters);
  if (comercioFilter) comercioFilter.addEventListener('change', applyClickupFilters);
  if (pagoFulfFilter) pagoFulfFilter.addEventListener('change', applyClickupFilters);
  if (pagoEnvFilter) pagoEnvFilter.addEventListener('change', applyClickupFilters);

  if (btnSync) btnSync.addEventListener('click', syncClickupFacturacionLive);
  if (btnCreate) btnCreate.addEventListener('click', openCreateClickupModal);

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeClickupModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeClickupModal);

  if (editForm) editForm.addEventListener('submit', handleSaveClickupRecord);
}

// Obtener datos desde la tabla `clickup_facturacion` en Supabase
async function fetchClickupFacturacionData() {
  try {
    const { data, error } = await supabase
      .from('clickup_facturacion')
      .select('*')
      .order('date_created', { ascending: false });

    if (error) {
      console.warn("No se pudo cargar 'clickup_facturacion' desde Supabase:", error.message);
      renderTableError("No existe la tabla 'clickup_facturacion' en Supabase. Asegúrate de haber ejecutado el script SQL.");
      return;
    }

    clickupFacturacionData = data || [];
    populateComercioFilterOptions();
    applyClickupFilters();

  } catch (err) {
    console.error("Error al obtener datos de ClickUp Facturación:", err);
    renderTableError("Error de conexión al cargar registros.");
  }
}

// Poblar selector de comercios dinámicamente
function populateComercioFilterOptions() {
  const comercioSelect = document.getElementById('clickup-comercio-filter');
  if (!comercioSelect) return;

  const comercios = Array.from(new Set(clickupFacturacionData.map(d => d.comercio).filter(Boolean))).sort();
  comercioSelect.innerHTML = `<option value="all">Todos los comercios (${comercios.length})</option>` +
    comercios.map(c => `<option value="${c}">${c}</option>`).join('');
}

// Filtrado de datos en tiempo real
function applyClickupFilters() {
  const searchVal = (document.getElementById('clickup-search-input')?.value || '').toLowerCase().trim();
  const listVal = document.getElementById('clickup-list-filter')?.value || 'all';
  const comercioVal = document.getElementById('clickup-comercio-filter')?.value || 'all';
  const pagoFulfVal = document.getElementById('clickup-pago-fulf-filter')?.value || 'all';
  const pagoEnvVal = document.getElementById('clickup-pago-env-filter')?.value || 'all';

  filteredData = clickupFacturacionData.filter(item => {
    // Filtro por Lista
    if (listVal !== 'all' && item.list_name !== listVal) return false;

    // Filtro por Comercio
    if (comercioVal !== 'all' && item.comercio !== comercioVal) return false;

    // Filtro por Pago FULF
    if (pagoFulfVal !== 'all' && item.pago_fulfillment !== pagoFulfVal) return false;

    // Filtro por Pago ENV
    if (pagoEnvVal !== 'all' && item.pago_enviame !== pagoEnvVal) return false;

    // Filtro por Búsqueda de texto
    if (searchVal) {
      const matchName = (item.task_name || '').toLowerCase().includes(searchVal);
      const matchComercio = (item.comercio || '').toLowerCase().includes(searchVal);
      const matchNFact = (item.n_fact || '').toLowerCase().includes(searchVal);
      const matchNFactEnv = (item.n_fact_env || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchComercio && !matchNFact && !matchNFactEnv) return false;
    }

    return true;
  });

  updateKPICards();
  renderClickupTableRows();
}

// Actualizar métricas KPI
function updateKPICards() {
  const countEl = document.getElementById('kpi-clickup-count');
  const fulfEl = document.getElementById('kpi-clickup-fulf');
  const envEl = document.getElementById('kpi-clickup-env');
  const grandTotalEl = document.getElementById('kpi-clickup-grand-total');

  let totalFulf = 0;
  let totalEnv = 0;
  let grandTotal = 0;

  filteredData.forEach(item => {
    totalFulf += Number(item.total_fulf || 0);
    totalEnv += Number(item.enviame || 0);
    grandTotal += Number(item.total || (Number(item.total_fulf || 0) + Number(item.enviame || 0)));
  });

  if (countEl) countEl.textContent = filteredData.length;
  if (fulfEl) fulfEl.textContent = formatCLP(totalFulf);
  if (envEl) envEl.textContent = formatCLP(totalEnv);
  if (grandTotalEl) grandTotalEl.textContent = formatCLP(grandTotal);
}

// Renderizar filas de la tabla
function renderClickupTableRows() {
  const tbody = document.getElementById('clickup-facturacion-table-body');
  if (!tbody) return;

  if (filteredData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="17" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
          No se encontraron registros de Facturación ClickUp con los filtros seleccionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredData.map(item => {
    const formattedFecha = item.fecha_limite ? new Date(item.fecha_limite).toLocaleDateString('es-CL') : '-';
    
    return `
      <tr style="border-bottom: 1px solid var(--color-border); transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
        <td style="padding: 0.6rem 0.5rem; text-align: center; white-space: nowrap;">
          <button class="btn btn-outline btn-sm edit-clickup-btn" data-id="${item.task_id}" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; border-color: #6366f1; color: #6366f1;" title="Editar">
            <i class="ri-edit-line"></i>
          </button>
          <button class="btn btn-outline btn-sm delete-clickup-btn" data-id="${item.task_id}" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; border-color: #ef4444; color: #ef4444;" title="Eliminar">
            <i class="ri-delete-bin-line"></i>
          </button>
        </td>
        <td style="padding: 0.6rem 0.5rem; white-space: nowrap;"><span class="badge" style="background: #374151; color: #fff;">${item.list_name || 'Sin lista'}</span></td>
        <td style="padding: 0.6rem 0.5rem; font-weight: 600; color: var(--color-text-main); font-size: 0.83rem;">${item.task_name || '-'}</td>
        <td style="padding: 0.6rem 0.5rem; white-space: nowrap;"><span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); font-weight: 700;">${item.comercio || '-'}</span></td>
        <td style="padding: 0.6rem 0.5rem; white-space: nowrap; color: var(--color-text-muted);">${formattedFecha}</td>
        <td style="padding: 0.6rem 0.5rem;">${getStatusPillHTML(item.desglose_fulfillment, 'desglose')}</td>
        <td style="padding: 0.6rem 0.5rem; font-weight: 600; color: #10b981;">${formatCLP(item.total_fulf)}</td>
        <td style="padding: 0.6rem 0.5rem; color: var(--color-text-muted);">${formatCLP(item.abonos_fulf)}</td>
        <td style="padding: 0.6rem 0.5rem;">${getStatusPillHTML(item.pago_fulfillment, 'pago')}</td>
        <td style="padding: 0.6rem 0.5rem;">${getStatusPillHTML(item.factura_fulfillment, 'factura')}</td>
        <td style="padding: 0.6rem 0.5rem; font-weight: 600;">${item.n_fact || '-'}</td>
        <td style="padding: 0.6rem 0.5rem; font-weight: 600; color: #3b82f6;">${formatCLP(item.enviame)}</td>
        <td style="padding: 0.6rem 0.5rem; color: var(--color-text-muted);">${formatCLP(item.abono_env)}</td>
        <td style="padding: 0.6rem 0.5rem;">${getStatusPillHTML(item.pago_enviame, 'pago')}</td>
        <td style="padding: 0.6rem 0.5rem;">${getStatusPillHTML(item.fact_enviame, 'factura')}</td>
        <td style="padding: 0.6rem 0.5rem; font-weight: 600;">${item.n_fact_env || '-'}</td>
        <td style="padding: 0.6rem 0.5rem; font-weight: 700; color: #6366f1; font-size: 0.85rem;">${formatCLP(item.total || (Number(item.total_fulf || 0) + Number(item.enviame || 0)))}</td>
      </tr>
    `;
  }).join('');

  // Event delegation on tbody for Edit & Delete buttons
  if (!tbody.getAttribute('data-has-listeners')) {
    tbody.setAttribute('data-has-listeners', 'true');
    tbody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit-clickup-btn');
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        const taskId = editBtn.getAttribute('data-id');
        openEditClickupModal(taskId);
        return;
      }

      const deleteBtn = e.target.closest('.delete-clickup-btn');
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const taskId = deleteBtn.getAttribute('data-id');
        confirmDeleteClickupRecord(taskId);
        return;
      }
    });
  }
}

function renderTableError(msg) {
  const tbody = document.getElementById('clickup-facturacion-table-body');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="17" style="text-align: center; padding: 2.5rem; color: #ef4444;">
        <i class="ri-error-warning-line" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
        ${msg}
      </td>
    </tr>
  `;
}

// Abrir Modal de Edición
function openEditClickupModal(taskId) {
  const record = clickupFacturacionData.find(r => r.task_id === taskId);
  if (!record) {
    console.warn("No se encontró el registro para editar ID:", taskId);
    return;
  }

  document.getElementById('clickup-modal-title').textContent = `Editar Registro: ${record.task_name}`;
  document.getElementById('edit-clickup-task-id').value = record.task_id;
  document.getElementById('edit-clickup-task-name').value = record.task_name || '';
  document.getElementById('edit-clickup-list-name').value = record.list_name || '2026';
  document.getElementById('edit-clickup-comercio').value = record.comercio || '';
  document.getElementById('edit-clickup-mes').value = record.mes || '';
  
  if (record.fecha_limite) {
    document.getElementById('edit-clickup-fecha-limite').value = new Date(record.fecha_limite).toISOString().split('T')[0];
  } else {
    document.getElementById('edit-clickup-fecha-limite').value = '';
  }

  document.getElementById('edit-clickup-desglose-fulf').value = record.desglose_fulfillment || '';
  document.getElementById('edit-clickup-total-fulf').value = record.total_fulf !== null ? record.total_fulf : '';
  document.getElementById('edit-clickup-abonos-fulf').value = record.abonos_fulf !== null ? record.abonos_fulf : '';
  document.getElementById('edit-clickup-pago-fulf').value = record.pago_fulfillment || '';
  document.getElementById('edit-clickup-factura-fulf').value = record.factura_fulfillment || '';
  document.getElementById('edit-clickup-n-fact').value = record.n_fact || '';

  document.getElementById('edit-clickup-enviame').value = record.enviame !== null ? record.enviame : '';
  document.getElementById('edit-clickup-abono-env').value = record.abono_env !== null ? record.abono_env : '';
  document.getElementById('edit-clickup-pago-env').value = record.pago_enviame || '';
  document.getElementById('edit-clickup-fact-env').value = record.fact_enviame || '';
  document.getElementById('edit-clickup-n-fact-env').value = record.n_fact_env || '';
  document.getElementById('edit-clickup-total').value = record.total !== null ? record.total : '';

  const modal = document.getElementById('modal-edit-clickup-facturacion');
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
  }
}

// Abrir Modal para Crear Nuevo Registro
function openCreateClickupModal() {
  document.getElementById('clickup-modal-title').textContent = 'Crear Nuevo Registro de Facturación';
  document.getElementById('edit-clickup-task-id').value = 'NEW_' + Date.now();
  document.getElementById('clickup-edit-form').reset();
  document.getElementById('edit-clickup-list-name').value = '2026';

  const modal = document.getElementById('modal-edit-clickup-facturacion');
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
  }
}

// Cerrar Modal
function closeClickupModal() {
  const modal = document.getElementById('modal-edit-clickup-facturacion');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
  }
}

// Guardar Registro Editado en Supabase
async function handleSaveClickupRecord(e) {
  e.preventDefault();

  const taskId = document.getElementById('edit-clickup-task-id').value;
  const isNew = taskId.startsWith('NEW_');
  const actualTaskId = isNew ? 'MANUAL_' + Date.now() : taskId;

  const payload = {
    task_id: actualTaskId,
    task_name: document.getElementById('edit-clickup-task-name').value.trim(),
    list_name: document.getElementById('edit-clickup-list-name').value,
    list_id: document.getElementById('edit-clickup-list-name').value === '2026' ? '901710677537' : '901704092525',
    space_id: SPACE_ID,
    space_name: 'FACTURACION',
    comercio: document.getElementById('edit-clickup-comercio').value.trim() || null,
    mes: document.getElementById('edit-clickup-mes').value.trim() || null,
    fecha_limite: document.getElementById('edit-clickup-fecha-limite').value ? new Date(document.getElementById('edit-clickup-fecha-limite').value).toISOString() : null,
    desglose_fulfillment: document.getElementById('edit-clickup-desglose-fulf').value || null,
    total_fulf: document.getElementById('edit-clickup-total-fulf').value ? parseFloat(document.getElementById('edit-clickup-total-fulf').value) : null,
    abonos_fulf: document.getElementById('edit-clickup-abonos-fulf').value ? parseFloat(document.getElementById('edit-clickup-abonos-fulf').value) : null,
    pago_fulfillment: document.getElementById('edit-clickup-pago-fulf').value || null,
    factura_fulfillment: document.getElementById('edit-clickup-factura-fulf').value || null,
    n_fact: document.getElementById('edit-clickup-n-fact').value.trim() || null,
    enviame: document.getElementById('edit-clickup-enviame').value ? parseFloat(document.getElementById('edit-clickup-enviame').value) : null,
    abono_env: document.getElementById('edit-clickup-abono-env').value ? parseFloat(document.getElementById('edit-clickup-abono-env').value) : null,
    pago_enviame: document.getElementById('edit-clickup-pago-env').value || null,
    fact_enviame: document.getElementById('edit-clickup-fact-env').value || null,
    n_fact_env: document.getElementById('edit-clickup-n-fact-env').value.trim() || null,
    total: document.getElementById('edit-clickup-total').value ? parseFloat(document.getElementById('edit-clickup-total').value) : null,
    synced_at: new Date().toISOString()
  };

  if (isNew) {
    payload.date_created = new Date().toISOString();
  }

  try {
    const { error } = await supabase
      .from('clickup_facturacion')
      .upsert(payload, { onConflict: 'task_id' });

    if (error) throw error;

    if (window.Swal) {
      window.Swal.fire({
        icon: 'success',
        title: '¡Guardado!',
        text: 'El registro se actualizó correctamente en la base de datos.',
        timer: 1800,
        showConfirmButton: false
      });
    } else {
      alert('Registro guardado exitosamente.');
    }

    closeClickupModal();
    await fetchClickupFacturacionData();

  } catch (err) {
    console.error("Error al guardar registro:", err);
    if (window.Swal) {
      window.Swal.fire('Error', 'No se pudo guardar el registro: ' + err.message, 'error');
    } else {
      alert('Error al guardar: ' + err.message);
    }
  }
}

// Eliminar Registro
async function confirmDeleteClickupRecord(taskId) {
  const record = clickupFacturacionData.find(r => r.task_id === taskId);
  if (!record) return;

  const confirmAction = async () => {
    try {
      const { error } = await supabase
        .from('clickup_facturacion')
        .delete()
        .eq('task_id', taskId);

      if (error) throw error;

      if (window.Swal) {
        window.Swal.fire('Eliminado', 'El registro ha sido eliminado.', 'success');
      }
      await fetchClickupFacturacionData();
    } catch (err) {
      console.error("Error al eliminar registro:", err);
      if (window.Swal) window.Swal.fire('Error', err.message, 'error');
    }
  };

  if (window.Swal) {
    window.Swal.fire({
      title: '¿Eliminar Registro?',
      text: `Vas a eliminar el registro '${record.task_name}'. Esta acción no se puede deshacer.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#4b5563',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) confirmAction();
    });
  } else if (confirm(`¿Eliminar el registro '${record.task_name}'?`)) {
    confirmAction();
  }
}

// Sincronización en vivo desde la API de ClickUp
async function syncClickupFacturacionLive() {
  if (isSyncing) return;
  isSyncing = true;

  const syncIcon = document.getElementById('sync-icon');
  if (syncIcon) syncIcon.classList.add('spin');

  try {
    if (window.Swal) {
      window.Swal.fire({
        title: 'Sincronizando con ClickUp',
        text: 'Consultando la API de ClickUp y actualizando Supabase...',
        allowOutsideClick: false,
        didOpen: () => { window.Swal.showLoading(); }
      });
    }

    // 1. Obtener Listas de ClickUp
    const headers = { 'Authorization': CLICKUP_TOKEN };
    const listsRes = await fetch(`https://api.clickup.com/api/v2/space/${SPACE_ID}/list`, { headers });
    if (!listsRes.ok) throw new Error(`ClickUp API Error: ${listsRes.statusText}`);

    const listsData = await listsRes.json();
    const lists = listsData.lists || [];

    let totalTasksExtracted = 0;
    let recordsToUpsert = [];

    // 2. Extraer tareas de cada lista
    for (const list of lists) {
      let page = 0;
      while (true) {
        const taskUrl = `https://api.clickup.com/api/v2/list/${list.id}/task?subtasks=true&include_closed=true&page=${page}`;
        const res = await fetch(taskUrl, { headers });
        if (!res.ok) break;
        const data = await res.json();
        const tasks = data.tasks || [];
        if (tasks.length === 0) break;

        tasks.forEach(task => {
          recordsToUpsert.push(transformClickupTask(task, list.name));
        });

        totalTasksExtracted += tasks.length;
        if (data.last_page) break;
        page++;
      }
    }

    // 3. Upsert en lotes a Supabase
    const BATCH_SIZE = 100;
    for (let i = 0; i < recordsToUpsert.length; i += BATCH_SIZE) {
      const batch = recordsToUpsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('clickup_facturacion')
        .upsert(batch, { onConflict: 'task_id' });
      if (error) console.error("Error upserting batch:", error);
    }

    if (window.Swal) {
      window.Swal.fire({
        icon: 'success',
        title: '¡Sincronización Completada!',
        text: `Se actualizaron ${recordsToUpsert.length} registros desde ClickUp.`,
        timer: 2000
      });
    }

    await fetchClickupFacturacionData();

  } catch (err) {
    console.error("Error durante sincronización en vivo:", err);
    if (window.Swal) {
      window.Swal.fire('Error de Sincronización', err.message, 'error');
    }
  } finally {
    isSyncing = false;
    if (syncIcon) syncIcon.classList.remove('spin');
  }
}

// Transformador de tarea ClickUp a objeto Supabase
function transformClickupTask(task, listName) {
  const customMap = {};
  (task.custom_fields || []).forEach(cf => {
    if (cf.value !== undefined && cf.value !== null) {
      if (cf.type === 'drop_down' && cf.type_config?.options) {
        const opt = cf.type_config.options.find(o => o.id === cf.value || o.orderindex === cf.value);
        customMap[cf.name] = opt ? opt.name : String(cf.value);
      } else if (cf.type === 'date') {
        const ts = parseInt(cf.value);
        customMap[cf.name] = !isNaN(ts) ? new Date(ts).toISOString() : null;
      } else if (cf.type === 'number' || cf.type === 'currency' || cf.type === 'formula') {
        const num = parseFloat(cf.value);
        customMap[cf.name] = !isNaN(num) ? num : null;
      } else {
        customMap[cf.name] = String(cf.value);
      }
    }
  });

  return {
    task_id: task.id,
    task_name: task.name,
    list_id: task.list?.id,
    list_name: listName || task.list?.name || 'Desconocido',
    space_id: SPACE_ID,
    space_name: 'FACTURACION',
    status: task.status?.status || null,
    status_color: task.status?.color || null,
    comercio: customMap['COMERCIO'] || null,
    mes: customMap['MES'] || null,
    fecha_limite: customMap['Fecha limite'] || customMap['Fecha límite'] || null,
    desglose_fulfillment: customMap['DESGLOSE FULFILLMENT'] || customMap['DESGLOSE FULFIL...'] || null,
    total_fulf: customMap['💰 Total FULF'] || customMap['Total FULF'] || null,
    abonos_fulf: customMap['Abonos FULF.'] || customMap['Abonos FULF'] || null,
    pago_fulfillment: customMap['PAGO FULLFILMENT'] || null,
    factura_fulfillment: customMap['FACTURA FULFILLMENT'] || customMap['FACTURA FULFIL...'] || null,
    n_fact: customMap['N°FACT'] || null,
    enviame: customMap['💰 ENVIAME'] || customMap['ENVIAME'] || null,
    abono_env: customMap['Abono ENV.'] || null,
    pago_enviame: customMap['PAGO ENVIAME'] || null,
    fact_enviame: customMap['FACT. ENVIAME'] || null,
    n_fact_env: customMap['N°FACT ENV.'] || null,
    total: customMap['TOTAL'] || null,
    total_fact: customMap['TOTAL FACT'] || null,
    monto: customMap['MONTO'] || null,
    ultimo_desglose: customMap['ULTIMO DESGLOSE'] || null,
    alpha: customMap['ALPHA'] || null,
    dif_s: customMap['DIF S'] ? String(customMap['DIF S']) : null,
    time_formula: customMap['TIME'] ? String(customMap['TIME']) : null,
    date_created: task.date_created ? new Date(parseInt(task.date_created)).toISOString() : null,
    date_updated: task.date_updated ? new Date(parseInt(task.date_updated)).toISOString() : null,
    date_closed: task.date_closed ? new Date(parseInt(task.date_closed)).toISOString() : null,
    url: task.url || null,
    raw_custom_fields: task.custom_fields || [],
    synced_at: new Date().toISOString()
  };
}

window.openEditClickupModal = openEditClickupModal;
window.openCreateClickupModal = openCreateClickupModal;
window.closeClickupModal = closeClickupModal;
window.confirmDeleteClickupRecord = confirmDeleteClickupRecord;
