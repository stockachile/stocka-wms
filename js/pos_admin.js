import supabaseInstance from './supabase.js';

/**
 * WMS STOCKA - Módulo de Punto de Ventas (POS Sucursal Ñuñoa) para Administradores
 * 
 * Permite registrar ventas presenciales de cualquier comercio en la sucursal física de Ñuñoa,
 * integrando catálogo de productos, validación de stock disponible, generación de orden en el
 * gestor de pedidos, descuento de inventario físico y trazabilidad de movimientos.
 */

// Asegurar instancia de cliente Supabase de la aplicación con fallback seguro
const supabase = (supabaseInstance && typeof supabaseInstance.from === 'function')
  ? supabaseInstance
  : (window.supabaseClient && typeof window.supabaseClient.from === 'function' ? window.supabaseClient : supabaseInstance);

// Variables de Estado Global
let posCurrentPage = 1;
const posPageSize = 50;
window.posCatalogProducts = [];
window.posSelectedCommerceConfig = null;
window.posCurrentStep = 1;

// ID y Datos de la Sucursal Física Matriz Ñuñoa
const SUCURSAL_NUNOA_WH_ID = '973da888-8a63-4790-a08f-919e1af41a93';
const SUCURSAL_NUNOA_NAME = 'Matriz Ñuñoa';
const SUCURSAL_NUNOA_ADDRESS = 'Campo de Deportes 405, Ñuñoa';

// Helper de formateo de moneda CLP
function formatCLP(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0';
  return '$' + Math.round(amount).toLocaleString('es-CL');
}

// Helper para escapar HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper para generar código único de venta
window.generatePosSaleCode = function(prefix) {
  const cleanPrefix = (prefix || 'POS').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${cleanPrefix}-${rand}`;
};

window.regeneratePosCode = function() {
  const commerceSelect = document.getElementById('pos-select-commerce');
  let sigla = 'POS';
  if (commerceSelect && commerceSelect.value && window.cachedAdminMerchants) {
    const c = window.cachedAdminMerchants.find(m => m.nombre === commerceSelect.value);
    if (c && c.sigla && c.sigla !== 'SIN SIGLA') {
      sigla = c.sigla;
    }
  }
  const codeInput = document.getElementById('pos-codigo-venta');
  if (codeInput) {
    codeInput.value = window.generatePosSaleCode(sigla);
  }
};

// ====== 1. VISTA PRINCIPAL (TABLA Y KPIS) ======
async function renderPosAdmin() {
  window.renderPosAdmin = renderPosAdmin;
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: flex-end;">
      <div>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6; margin: 0;">
          Registro y gestión centralizada de ventas presenciales realizadas en la <strong>Sucursal Física de Ñuñoa</strong> (Campo de Deportes 405).
        </p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <button id="btn-open-create-pos-sale" onclick="window.openCreatePosSaleModal()" class="btn btn-primary" style="background-color: var(--color-primary); color: white; display: flex; align-items: center; gap: 0.35rem; font-weight: 600; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2); cursor: pointer;">
          <i class="ri-shopping-cart-2-line"></i> Registrar Venta
        </button>
        <button id="btn-pos-export-csv" class="btn btn-outline" style="background-color: transparent; color: #10b981; border-color: #10b981; display: flex; align-items: center; gap: 0.25rem;">
          <i class="ri-file-text-line"></i> CSV
        </button>
        <button id="btn-pos-export-excel" class="btn btn-outline" style="background-color: transparent; color: #059669; border-color: #059669; display: flex; align-items: center; gap: 0.25rem;">
          <i class="ri-file-excel-2-line"></i> Excel
        </button>
      </div>
    </div>

    <!-- Tarjetas de Métricas KPI -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem; border-left: 4px solid var(--color-primary);">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(59, 130, 246, 0.1); display: flex; align-items: center; justify-content: center; color: var(--color-primary); font-size: 1.5rem;">
          <i class="ri-shopping-bag-3-line"></i>
        </div>
        <div>
          <span style="font-size: 0.8rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; display: block;">Ventas del Mes</span>
          <strong id="pos-kpi-total-month" style="font-size: 1.5rem; color: var(--color-text-main);">0</strong>
        </div>
      </div>

      <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem; border-left: 4px solid #10b981;">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(16, 185, 129, 0.1); display: flex; align-items: center; justify-content: center; color: #10b981; font-size: 1.5rem;">
          <i class="ri-money-dollar-circle-line"></i>
        </div>
        <div>
          <span style="font-size: 0.8rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; display: block;">Monto Recaudado Mes</span>
          <strong id="pos-kpi-monto-month" style="font-size: 1.5rem; color: #10b981;">$0</strong>
        </div>
      </div>

      <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem; border-left: 4px solid #8b5cf6;">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(139, 92, 246, 0.1); display: flex; align-items: center; justify-content: center; color: #8b5cf6; font-size: 1.5rem;">
          <i class="ri-calendar-check-line"></i>
        </div>
        <div>
          <span style="font-size: 0.8rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; display: block;">Ventas de Hoy</span>
          <strong id="pos-kpi-today-count" style="font-size: 1.5rem; color: var(--color-text-main);">0</strong>
        </div>
      </div>

      <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem; border-left: 4px solid #f59e0b;">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(245, 158, 11, 0.1); display: flex; align-items: center; justify-content: center; color: #f59e0b; font-size: 1.5rem;">
          <i class="ri-store-2-line"></i>
        </div>
        <div>
          <span style="font-size: 0.8rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; display: block;">Comercios Activos POS</span>
          <strong id="pos-kpi-active-merchants" style="font-size: 1.5rem; color: var(--color-text-main);">0</strong>
        </div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-body" style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end;">
        <div class="form-group" style="flex: 1; min-width: 170px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Comercio</label>
          <select id="filter-pos-commerce" class="form-input">
            <option value="">Todos los Comercios</option>
            <!-- Inyectado dinámicamente -->
          </select>
        </div>

        <div class="form-group" style="flex: 1; min-width: 150px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Modo de Pago</label>
          <select id="filter-pos-payment" class="form-input">
            <option value="">Todos los Modos</option>
            <option value="Tarjeta de Débito">Tarjeta de Débito</option>
            <option value="Tarjeta de Crédito">Tarjeta de Crédito</option>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1; min-width: 140px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Documento</label>
          <select id="filter-pos-doc" class="form-input">
            <option value="">Todos los Tipos</option>
            <option value="BOLETA">Boleta</option>
            <option value="FACTURA">Factura</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1; min-width: 200px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Buscador General</label>
          <input type="text" id="filter-pos-search" class="form-input" placeholder="Buscar por código, cliente, correo, comentarios...">
        </div>

        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Desde Fecha</label>
          <input type="date" id="filter-pos-date-from" class="form-input">
        </div>

        <div class="form-group" style="flex: 1; min-width: 130px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.8rem;">Hasta Fecha</label>
          <input type="date" id="filter-pos-date-to" class="form-input">
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
              <th>Código Venta</th>
              <th>Comercio</th>
              <th>Cliente</th>
              <th>Sucursal</th>
              <th>Productos</th>
              <th style="text-align: right;">Total Pagado</th>
              <th>Pago y Documento</th>
              <th>Pedido Gestor</th>
              <th style="text-align: center;">Acciones</th>
            </tr>
          </thead>
          <tbody id="pos-admin-tbody">
            <tr><td colspan="10" class="text-center" style="padding: 2rem;">Cargando ventas...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem;">
        <div id="pos-pagination-info" style="font-size: 0.875rem; color: var(--color-text-muted);">
          Mostrando 0 registros
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btn-pos-prev-page" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Anterior</button>
          <button id="btn-pos-next-page" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Siguiente</button>
        </div>
      </div>
    </div>
  `;

  // Inicializar selectores de comercio en filtro
  await populateFilterCommerces();

  // Listeners de Filtros
  const filters = ['filter-pos-commerce', 'filter-pos-payment', 'filter-pos-doc', 'filter-pos-date-from', 'filter-pos-date-to'];
  filters.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        posCurrentPage = 1;
        fetchAndRenderPosData();
      });
    }
  });

  let searchTimeout;
  const searchInput = document.getElementById('filter-pos-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        posCurrentPage = 1;
        fetchAndRenderPosData();
      }, 400);
    });
  }

  // Paginación
  const btnPrev = document.getElementById('btn-pos-prev-page');
  const btnNext = document.getElementById('btn-pos-next-page');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (posCurrentPage > 1) {
        posCurrentPage--;
        fetchAndRenderPosData();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      posCurrentPage++;
      fetchAndRenderPosData();
    });
  }

  // Exportaciones
  document.getElementById('btn-pos-export-csv')?.addEventListener('click', () => exportPosSales('csv'));
  document.getElementById('btn-pos-export-excel')?.addEventListener('click', () => exportPosSales('excel'));

  // Abrir modal de registro
  document.getElementById('btn-open-create-pos-sale')?.addEventListener('click', () => {
    window.openCreatePosSaleModal();
  });

  // Cargar datos
  posCurrentPage = 1;
  await fetchAndRenderPosData();
};

// Helper unificado para obtener listado limpio de comercios individuales (sin cadenas combinadas)
window.getPosUniqueMerchantsList = async function() {
  const commercesSet = new Set();

  // 1. Comercios cacheados en admin (desagregando cadenas con coma si existieran)
  if (window.cachedAdminMerchants && window.cachedAdminMerchants.length > 0) {
    window.cachedAdminMerchants.forEach(m => {
      if (m.nombre) {
        m.nombre.split(',').forEach(part => {
          const trimmed = part.trim();
          if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'no asignado') {
            commercesSet.add(trimmed);
          }
        });
      }
    });
  }

  // 2. Consultar comercios_adicional_config (fuente canónica de comercios en el WMS)
  try {
    const { data: cacList } = await supabase
      .from('comercios_adicional_config')
      .select('comercio')
      .order('comercio');
    if (cacList) {
      cacList.forEach(c => {
        if (c.comercio) {
          c.comercio.split(',').forEach(part => {
            const trimmed = part.trim();
            if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'no asignado') {
              commercesSet.add(trimmed);
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn('Aviso consultando comercios_adicional_config:', e);
  }

  // 3. Consultar profiles desagregando cadenas combinadas por usuario
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('comercio')
      .neq('role', 'admin');
    if (profiles) {
      profiles.forEach(p => {
        if (p.comercio) {
          p.comercio.split(',').forEach(c => {
            const trimmed = c.trim();
            if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'no asignado') {
              commercesSet.add(trimmed);
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn('Aviso consultando profiles:', e);
  }

  return Array.from(commercesSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
};

// Helper para poblar dropdown de comercios en el filtro
async function populateFilterCommerces() {
  const select = document.getElementById('filter-pos-commerce');
  if (!select) return;

  try {
    const list = await window.getPosUniqueMerchantsList();
    list.forEach(cName => {
      const opt = document.createElement('option');
      opt.value = cName;
      opt.textContent = cName;
      select.appendChild(opt);
    });
  } catch (e) {
    console.warn('Error poblando comercios en filtro POS:', e);
  }
}

// ====== 2. CONSULTA Y RENDER DE DATOS ======
function buildPosSalesQuery(query) {
  const fCommerce = document.getElementById('filter-pos-commerce')?.value;
  const fPayment = document.getElementById('filter-pos-payment')?.value;
  const fDoc = document.getElementById('filter-pos-doc')?.value;
  const fSearch = document.getElementById('filter-pos-search')?.value.trim();
  const fFrom = document.getElementById('filter-pos-date-from')?.value;
  const fTo = document.getElementById('filter-pos-date-to')?.value;

  if (fCommerce) query = query.eq('comercio', fCommerce);
  if (fPayment) query = query.eq('modo_pago', fPayment);
  if (fDoc) query = query.eq('documento_tipo', fDoc);
  if (fSearch) {
    query = query.or(`codigo_venta.ilike.%${fSearch}%,nombre_cliente.ilike.%${fSearch}%,correo_cliente.ilike.%${fSearch}%,comentarios.ilike.%${fSearch}%,comercio.ilike.%${fSearch}%`);
  }
  if (fFrom) query = query.gte('created_at', fFrom + 'T00:00:00.000Z');
  if (fTo) query = query.lte('created_at', fTo + 'T23:59:59.999Z');

  return query;
}

async function fetchAndRenderPosData() {
  const tbody = document.getElementById('pos-admin-tbody');
  const btnPrev = document.getElementById('btn-pos-prev-page');
  const btnNext = document.getElementById('btn-pos-next-page');
  const info = document.getElementById('pos-pagination-info');

  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="padding: 2rem;"><i class="ri-loader-4-line spin" style="font-size: 1.5rem; display: inline-block;"></i> Cargando ventas...</td></tr>';
  if (btnPrev) btnPrev.disabled = true;
  if (btnNext) btnNext.disabled = true;

  try {
    // 1. Ejecutar consulta paginada
    let query = supabase.from('store_sales').select('*', { count: 'exact' });
    query = buildPosSalesQuery(query);

    const from = (posCurrentPage - 1) * posPageSize;
    const to = from + posPageSize - 1;
    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: sales, error, count } = await query;
    if (error) throw error;

    // 2. Guardar en cache para acceso instantáneo por ID sin depender de comillas en atributos HTML
    window.posSalesCache = window.posSalesCache || new Map();
    window.posSalesCache.clear();
    (sales || []).forEach(s => {
      window.posSalesCache.set(String(s.id), s);
      if (s.codigo_venta) window.posSalesCache.set(String(s.codigo_venta), s);
    });

    // 3. Calcular KPIs mensuales y del día
    updatePosKpis();

    // 4. Renderizar filas
    let html = '';
    if (!sales || sales.length === 0) {
      html = '<tr><td colspan="10" class="text-center" style="padding: 2.5rem; color: var(--color-text-muted);">No se encontraron ventas con los filtros aplicados.</td></tr>';
    } else {
      sales.forEach(s => {
        const d = new Date(s.created_at);
        const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        
        let montoFmt = formatCLP(s.monto_total);

        // Desglose de productos
        let prodSummary = 'Sin ítems';
        let totalQty = 0;
        if (s.productos) {
          try {
            let parsed = s.productos;
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            if (Array.isArray(parsed)) {
              totalQty = parsed.reduce((sum, p) => sum + (parseInt(p.cantidad, 10) || 1), 0);
              const itemsList = parsed.map(p => `${p.cantidad || 1}x ${escapeHtml(p.producto || p.name || 'Ítem')}`);
              if (itemsList.length <= 2) {
                prodSummary = itemsList.join('<br>');
              } else {
                prodSummary = `${itemsList[0]}<br><small class="text-muted">+ ${itemsList.length - 1} producto(s) más (${totalQty} un)</small>`;
              }
            }
          } catch(e) {}
        }

        // Badge de Pago
        let paymentBadge = 'badge-neutral';
        const pagoLower = (s.modo_pago || '').toLowerCase();
        if (pagoLower.includes('efectivo')) paymentBadge = 'badge-success';
        else if (pagoLower.includes('tarjeta') || pagoLower.includes('débito') || pagoLower.includes('crédito')) paymentBadge = 'badge-info';
        else if (pagoLower.includes('transferencia')) paymentBadge = 'badge-warning';

        // Badge de Documento
        const docBadge = (s.documento_tipo === 'FACTURA')
          ? `<span class="badge" style="background: rgba(139, 92, 246, 0.12); color: #7c3aed; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 0.72rem;"><i class="ri-file-paper-2-line"></i> Factura</span>`
          : `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.25); font-size: 0.72rem;"><i class="ri-bill-line"></i> Boleta</span>`;

        // Badge de Orden WMS
        let orderBadge = `<span class="text-muted" style="font-size: 0.8rem; font-style: italic;">Sin vincular</span>`;
        if (s.wms_order_id) {
          orderBadge = `<span class="badge badge-info" style="cursor: pointer;" onclick="window.filterOrderInGestor('${s.wms_order_id}', '${escapeHtml(s.codigo_venta)}')" title="Ver en Gestor de Pedidos"><i class="ri-box-3-line"></i> #${escapeHtml(s.codigo_venta)}</span>`;
        } else {
          // Revisar si en comentarios trae el ID de orden
          const ordMatch = (s.comentarios || '').match(/\[WMS-ORD:\s*([a-zA-Z0-9-]+)\]/);
          if (ordMatch) {
            orderBadge = `<span class="badge badge-info" style="cursor: pointer;" onclick="window.filterOrderInGestor('${ordMatch[1]}', '${escapeHtml(s.codigo_venta)}')" title="Ver en Gestor de Pedidos"><i class="ri-box-3-line"></i> #${escapeHtml(s.codigo_venta)}</span>`;
          }
        }

        html += `
          <tr style="transition: background-color 0.2s;">
            <td style="white-space: nowrap; font-size: 0.85rem;">
              <i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}
            </td>
            <td>
              <span style="font-family: monospace; font-size: 0.85rem; font-weight: 700; background: var(--color-bg); padding: 0.2rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.5px;">
                ${escapeHtml(s.codigo_venta || 'N/A')}
              </span>
            </td>
            <td>
              <strong style="color: var(--color-text-main); font-size: 0.85rem;">${escapeHtml(s.comercio || 'N/A')}</strong>
            </td>
            <td>
              <div style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-main);">${escapeHtml(s.nombre_cliente || 'Consumidor Final')}</div>
              ${s.correo_cliente ? `<div style="font-size: 0.75rem; color: var(--color-text-muted);"><i class="ri-mail-line"></i> ${escapeHtml(s.correo_cliente)}</div>` : ''}
            </td>
            <td>
              <span style="font-size: 0.8rem; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.25rem;">
                <i class="ri-map-pin-line" style="color: var(--color-primary);"></i> ${escapeHtml(s.sucursal || SUCURSAL_NUNOA_NAME)}
              </span>
            </td>
            <td style="font-size: 0.85rem; line-height: 1.4;">
              ${prodSummary}
            </td>
            <td style="text-align: right;">
              <strong style="color: #10b981; font-size: 1rem;">${montoFmt}</strong>
            </td>
            <td>
              <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start;">
                <span class="badge ${paymentBadge}" style="font-size: 0.75rem;">${escapeHtml(s.modo_pago || 'N/A')}</span>
                ${docBadge}
              </div>
            </td>
            <td>
              ${orderBadge}
            </td>
            <td style="text-align: center; white-space: nowrap;">
              <div style="display: flex; gap: 0.35rem; justify-content: center;">
                <button class="btn btn-outline btn-sm" onclick="window.openPosSaleDetail('${s.id}')" style="padding: 0.3rem 0.6rem; font-size: 0.78rem;" title="Ver Detalle Completo">
                  <i class="ri-search-eye-line" style="color: var(--color-primary);"></i> Detalle
                </button>
                <button class="btn btn-outline btn-sm" onclick="window.printPosTicket('${s.id}')" style="padding: 0.3rem 0.6rem; font-size: 0.78rem;" title="Imprimir Comprobante Térmico">
                  <i class="ri-printer-line"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      });
    }

    tbody.innerHTML = html;

    const currentEnd = Math.min(from + posPageSize, count || 0);
    if (info) {
      info.textContent = `Mostrando ${count === 0 ? 0 : from + 1} a ${currentEnd} de ${count || 0} registros`;
    }

    if (btnPrev) btnPrev.disabled = posCurrentPage <= 1;
    if (btnNext) btnNext.disabled = currentEnd >= (count || 0);

  } catch (err) {
    console.error('Error cargando ventas POS:', err);
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger" style="padding: 2rem;">Error al cargar ventas: ${err.message}</td></tr>`;
  }
}

// Función para actualizar tarjetas KPI superiores
async function updatePosKpis() {
  try {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    // Ventas del mes
    const { data: monthSales } = await supabase
      .from('store_sales')
      .select('monto_total, comercio')
      .gte('created_at', firstDayOfMonth);

    if (monthSales) {
      const countMonth = monthSales.length;
      const totalMonth = monthSales.reduce((sum, s) => sum + (Number(s.monto_total) || 0), 0);
      const uniqueCommerces = new Set(monthSales.map(s => s.comercio).filter(Boolean)).size;

      const kpiCount = document.getElementById('pos-kpi-total-month');
      const kpiMonto = document.getElementById('pos-kpi-monto-month');
      const kpiCommerces = document.getElementById('pos-kpi-active-merchants');

      if (kpiCount) kpiCount.textContent = countMonth;
      if (kpiMonto) kpiMonto.textContent = formatCLP(totalMonth);
      if (kpiCommerces) kpiCommerces.textContent = uniqueCommerces;
    }

    // Ventas de hoy
    const { count: todayCount } = await supabase
      .from('store_sales')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    const kpiToday = document.getElementById('pos-kpi-today-count');
    if (kpiToday) kpiToday.textContent = todayCount || 0;

  } catch (e) {
    console.warn('Error calculando KPIs de POS:', e);
  }
}

// Helper para filtrar orden en el Gestor de Pedidos
window.filterOrderInGestor = function(orderId, orderCode) {
  const navGestor = document.querySelector('.nav-item[data-view="orders_admin"]');
  if (navGestor) {
    navGestor.click();
    setTimeout(() => {
      const searchInput = document.getElementById('search-orders');
      if (searchInput) {
        searchInput.value = orderCode || orderId;
        searchInput.dispatchEvent(new Event('input'));
      }
    }, 300);
  }
};

// ====== 3. MODAL WIZARD: REGISTRO DE VENTA EN SUCURSAL ======

window.openCreatePosSaleModal = async function() {
  const modal = document.getElementById('modal-pos-sale');
  if (!modal) {
    console.error('Modal #modal-pos-sale no encontrado en el DOM');
    return;
  }

  // 1. Mostrar modal inmediatamente para feedback instantáneo
  modal.classList.add('active');

  // 2. Resetear Wizard al paso 1
  window.goToPosStep(1);

  // 3. Resetear formulario y datos del cliente de forma segura
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal('pos-customer-name', '');
  setVal('pos-customer-email', '');
  setVal('pos-customer-phone', '');
  setVal('pos-comments', '');
  setVal('pos-factura-rut', '');
  setVal('pos-factura-razon-social', '');
  setVal('pos-factura-giro', '');
  setVal('pos-factura-direccion', '');

  const badgesContainer = document.getElementById('pos-commerce-badges-container');
  if (badgesContainer) badgesContainer.innerHTML = '';

  // 4. Resetear documento a Boleta
  window.selectPosDocTipo('BOLETA');

  // 5. Resetear modo de pago
  window.selectPosModoPago('Tarjeta de Débito');

  // 6. Generar código de venta inicial
  window.regeneratePosCode();

  // 7. Limpiar filas de productos y resumen
  const tbody = document.getElementById('pos-products-tbody');
  if (tbody) tbody.innerHTML = '';
  window.calculatePosTotals();

  // 8. Poblar selector de comercios
  const commerceSelect = document.getElementById('pos-select-commerce');
  if (commerceSelect) {
    commerceSelect.innerHTML = '<option value="">Selecciona comercio...</option>';
    try {
      const list = await window.getPosUniqueMerchantsList();
      list.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        commerceSelect.appendChild(opt);
      });
    } catch (e) {
      console.warn('Aviso cargando comercios individuales para modal POS:', e);
    }

    commerceSelect.onchange = async () => {
      const selected = commerceSelect.value;
      if (selected) {
        await window.loadPosCommerceCatalog(selected);
        window.regeneratePosCode();
      } else {
        if (badgesContainer) badgesContainer.innerHTML = '';
        if (tbody) tbody.innerHTML = '';
        window.calculatePosTotals();
      }
    };
  }

  // 9. Configurar listener de cambio de modo manual
  const manualCheckbox = document.getElementById('pos-manual-mode');
  if (manualCheckbox) {
    manualCheckbox.onchange = () => {
      if (tbody) tbody.innerHTML = '';
      window.addPosRow(manualCheckbox.checked);
      window.calculatePosTotals();
    };
  }
};

// Navegación entre pasos del Wizard
window.goToPosStep = function(targetStep) {
  const currentStep = window.posCurrentStep || 1;

  // Validaciones si se avanza
  if (targetStep > currentStep) {
    if (currentStep === 1) {
      const commerce = document.getElementById('pos-select-commerce')?.value;
      if (!commerce) {
        Swal.fire({
          icon: 'warning',
          title: 'Comercio Requerido',
          text: 'Por favor selecciona el comercio para el cual se registra la venta.',
          confirmButtonColor: 'var(--color-primary)'
        });
        return;
      }

      const clientName = document.getElementById('pos-customer-name')?.value.trim();
      if (!clientName) {
        Swal.fire({
          icon: 'warning',
          title: 'Cliente Requerido',
          text: 'Por favor ingresa el nombre del cliente.',
          confirmButtonColor: 'var(--color-primary)'
        });
        document.getElementById('pos-customer-name')?.focus();
        return;
      }

      const clientEmail = document.getElementById('pos-customer-email')?.value.trim();
      if (!clientEmail || !clientEmail.includes('@')) {
        Swal.fire({
          icon: 'warning',
          title: 'Email Válido Requerido',
          text: 'Por favor ingresa un correo electrónico válido para el envío de información del pedido.',
          confirmButtonColor: 'var(--color-primary)'
        });
        document.getElementById('pos-customer-email')?.focus();
        return;
      }

      // Validar datos de factura si corresponde
      const docTipo = document.getElementById('pos-documento-tipo')?.value;
      if (docTipo === 'FACTURA') {
        const fRut = document.getElementById('pos-factura-rut')?.value.trim();
        const fRazon = document.getElementById('pos-factura-razon-social')?.value.trim();
        if (!fRut || !fRazon) {
          Swal.fire({
            icon: 'warning',
            title: 'Datos de Facturación Incompletos',
            text: 'Para emitir Factura Electrónica debes ingresar al menos el RUT y la Razón Social.',
            confirmButtonColor: 'var(--color-primary)'
          });
          return;
        }
      }
    }

    if (currentStep === 2) {
      const rows = document.querySelectorAll('#pos-products-tbody tr');
      if (rows.length === 0) {
        Swal.fire({
          icon: 'warning',
          title: 'Agrega al menos un producto',
          text: 'Debes agregar al menos un producto para completar la venta.',
          confirmButtonColor: 'var(--color-primary)'
        });
        return;
      }

      // Validar que todas las filas tengan SKU/Nombre, cantidad > 0 y precio >= 0
      let hasError = false;
      let errorMsg = '';
      const isManual = document.getElementById('pos-manual-mode')?.checked;

      rows.forEach((row, idx) => {
        if (hasError) return;
        const qty = parseInt(row.querySelector('.pos-row-qty')?.value, 10) || 0;
        const price = parseInt(row.querySelector('.pos-row-price')?.value, 10) || 0;

        if (qty <= 0) {
          hasError = true;
          errorMsg = `La cantidad en la fila #${idx + 1} debe ser mayor a 0.`;
          return;
        }

        if (isManual) {
          const sku = row.querySelector('.pos-row-sku')?.value.trim();
          const name = row.querySelector('.pos-row-name')?.value.trim();
          if (!sku || !name) {
            hasError = true;
            errorMsg = `Por favor completa el SKU y el Nombre del producto en la fila #${idx + 1}.`;
            return;
          }
        } else {
          const prodInput = row.querySelector('.pos-row-catalog-input')?.value.trim();
          if (!prodInput) {
            hasError = true;
            errorMsg = `Por favor selecciona un producto del catálogo en la fila #${idx + 1}.`;
            return;
          }

          // Validar stock disponible si el comercio tiene seguimiento activo
          if (window.posSelectedCommerceConfig?.inventario_seguimiento) {
            const availStock = parseInt(row.dataset.stock, 10) || 0;
            if (qty > availStock) {
              hasError = true;
              errorMsg = `La cantidad (${qty} un) supera el stock disponible en Ñuñoa (${availStock} un) para "${prodInput}".`;
              return;
            }
          }
        }
      });

      if (hasError) {
        Swal.fire({
          icon: 'warning',
          title: 'Verificar Productos',
          text: errorMsg,
          confirmButtonColor: 'var(--color-primary)'
        });
        return;
      }

      // Actualizar resumen en Paso 3
      const commerceName = document.getElementById('pos-select-commerce')?.value;
      const clientName = document.getElementById('pos-customer-name')?.value;
      const totalAmount = document.getElementById('pos-summary-total')?.textContent;
      const totalQty = Array.from(rows).reduce((acc, r) => acc + (parseInt(r.querySelector('.pos-row-qty')?.value, 10) || 0), 0);

      document.getElementById('pos-confirm-commerce').textContent = commerceName || '-';
      document.getElementById('pos-confirm-client').textContent = `Cliente: ${clientName || '-'}`;
      document.getElementById('pos-confirm-total').textContent = totalAmount || '$0';
      document.getElementById('pos-confirm-items-count').textContent = `${totalQty} unidades (${rows.length} producto${rows.length > 1 ? 's' : ''})`;
    }
  }

  // Cambiar pestaña activa
  window.posCurrentStep = targetStep;

  // Actualizar indicadores de pasos
  [1, 2, 3].forEach(step => {
    const tab = document.getElementById(`pos-wizard-tab-${step}`);
    const container = document.getElementById(`pos-wizard-step-${step}`);
    const line = document.getElementById(`pos-wizard-line-${step}`);

    if (container) {
      container.style.display = (step === targetStep) ? 'block' : 'none';
    }

    if (tab) {
      const numSpan = tab.querySelector('.step-num');
      if (step === targetStep) {
        tab.style.color = 'var(--color-primary)';
        if (numSpan) {
          numSpan.style.background = 'var(--color-primary)';
          numSpan.style.color = 'white';
          numSpan.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.15)';
        }
      } else if (step < targetStep) {
        tab.style.color = '#10b981';
        if (numSpan) {
          numSpan.style.background = '#10b981';
          numSpan.style.color = 'white';
          numSpan.style.boxShadow = 'none';
        }
      } else {
        tab.style.color = 'var(--color-text-muted)';
        if (numSpan) {
          numSpan.style.background = 'var(--color-bg-dark, #cbd5e1)';
          numSpan.style.color = 'var(--color-text-muted)';
          numSpan.style.boxShadow = 'none';
        }
      }
    }

    if (line) {
      line.style.background = (step < targetStep) ? '#10b981' : 'var(--color-border)';
    }
  });

  // Botones footer
  const btnPrev = document.getElementById('btn-pos-prev');
  const btnNext = document.getElementById('btn-pos-next');
  const btnSave = document.getElementById('btn-pos-save');

  if (btnPrev) btnPrev.style.display = (targetStep > 1) ? 'inline-flex' : 'none';
  if (btnNext) btnNext.style.display = (targetStep < 3) ? 'inline-flex' : 'none';
  if (btnSave) btnSave.style.display = (targetStep === 3) ? 'inline-flex' : 'none';
};

// Delegación de eventos global para controles del modal y wizard POS
document.addEventListener('click', (e) => {
  // 1. Abrir modal registrar venta
  if (e.target.closest('#btn-open-create-pos-sale')) {
    e.preventDefault();
    window.openCreatePosSaleModal();
    return;
  }

  // 2. Tabs del wizard
  const tab = e.target.closest('.pos-wizard-step-tab');
  if (tab && tab.id) {
    const stepMatch = tab.id.match(/pos-wizard-tab-(\d+)/);
    if (stepMatch) {
      e.preventDefault();
      window.goToPosStep(parseInt(stepMatch[1], 10));
      return;
    }
  }

  // 3. Botón Volver
  if (e.target.closest('#btn-pos-prev')) {
    e.preventDefault();
    if (window.posCurrentStep > 1) window.goToPosStep(window.posCurrentStep - 1);
    return;
  }

  // 4. Botón Siguiente
  if (e.target.closest('#btn-pos-next')) {
    e.preventDefault();
    if (window.posCurrentStep < 3) window.goToPosStep(window.posCurrentStep + 1);
    return;
  }

  // 5. Botón Agregar Producto
  if (e.target.closest('#btn-pos-add-row')) {
    e.preventDefault();
    const isManual = document.getElementById('pos-manual-mode')?.checked || false;
    window.addPosRow(isManual);
    return;
  }

  // 6. Eliminar fila de producto
  const btnRemove = e.target.closest('.btn-remove-pos-row');
  if (btnRemove) {
    e.preventDefault();
    const tr = btnRemove.closest('tr');
    if (tr) {
      tr.remove();
      window.calculatePosTotals();
    }
    return;
  }

  // 7. Cerrar modales al hacer clic fuera del contenido
  if (e.target.id === 'modal-pos-sale' || e.target.id === 'modal-pos-detail') {
    e.target.classList.remove('active');
    return;
  }
});

// Listener global para envío del formulario
document.addEventListener('submit', (e) => {
  if (e.target.id === 'form-pos-sale') {
    e.preventDefault();
    window.savePosSale(e);
  }
});

// Selector de Tipo de Documento: Boleta vs Factura
window.selectPosDocTipo = function(tipo) {
  const hiddenInput = document.getElementById('pos-documento-tipo');
  if (hiddenInput) hiddenInput.value = tipo;

  const cardBoleta = document.getElementById('lbl-pos-doc-boleta');
  const cardFactura = document.getElementById('lbl-pos-doc-factura');
  const facturaFields = document.getElementById('pos-factura-fields');

  if (tipo === 'FACTURA') {
    if (cardFactura) {
      cardFactura.style.border = '2px solid var(--color-primary)';
      cardFactura.style.background = 'rgba(59, 130, 246, 0.05)';
      cardFactura.querySelector('div:first-child').style.background = 'rgba(59, 130, 246, 0.1)';
      cardFactura.querySelector('div:first-child').style.color = 'var(--color-primary)';
    }
    if (cardBoleta) {
      cardBoleta.style.border = '1px solid var(--color-border)';
      cardBoleta.style.background = 'var(--color-surface)';
      cardBoleta.querySelector('div:first-child').style.background = 'var(--color-bg)';
      cardBoleta.querySelector('div:first-child').style.color = 'var(--color-text-muted)';
    }
    if (facturaFields) facturaFields.style.display = 'block';
  } else {
    if (cardBoleta) {
      cardBoleta.style.border = '2px solid var(--color-primary)';
      cardBoleta.style.background = 'rgba(59, 130, 246, 0.05)';
      cardBoleta.querySelector('div:first-child').style.background = 'rgba(59, 130, 246, 0.1)';
      cardBoleta.querySelector('div:first-child').style.color = 'var(--color-primary)';
    }
    if (cardFactura) {
      cardFactura.style.border = '1px solid var(--color-border)';
      cardFactura.style.background = 'var(--color-surface)';
      cardFactura.querySelector('div:first-child').style.background = 'var(--color-bg)';
      cardFactura.querySelector('div:first-child').style.color = 'var(--color-text-muted)';
    }
    if (facturaFields) facturaFields.style.display = 'none';
  }
};

// Selector de Modo de Pago
window.selectPosModoPago = function(modo) {
  const hiddenInput = document.getElementById('pos-modo-pago');
  if (hiddenInput) hiddenInput.value = modo;

  const cardsMap = {
    'Tarjeta de Débito': 'lbl-pos-pago-debito',
    'Tarjeta de Crédito': 'lbl-pos-pago-credito',
    'Efectivo': 'lbl-pos-pago-efectivo',
    'Transferencia': 'lbl-pos-pago-transferencia'
  };

  Object.entries(cardsMap).forEach(([m, cardId]) => {
    const card = document.getElementById(cardId);
    if (!card) return;
    if (m === modo) {
      card.style.border = '2px solid var(--color-primary)';
      card.style.background = 'rgba(59, 130, 246, 0.05)';
      card.querySelector('i').style.color = 'var(--color-primary)';
    } else {
      card.style.border = '1px solid var(--color-border)';
      card.style.background = 'var(--color-surface)';
      card.querySelector('i').style.color = 'var(--color-text-muted)';
    }
  });
};

// ====== 4. CARGA DE CATÁLOGO E INVENTARIO POR COMERCIO ======

window.loadPosCommerceCatalog = async function(commerceName) {
  const badgesContainer = document.getElementById('pos-commerce-badges-container');
  if (badgesContainer) {
    badgesContainer.innerHTML = '<span class="text-muted" style="font-size: 0.75rem;"><i class="ri-loader-4-line spin"></i> Verificando catálogo e inventario...</span>';
  }

  window.posCatalogProducts = [];
  window.posSelectedCommerceConfig = null;

  try {
    // 1. Obtener configuración adicional del comercio
    const { data: cac } = await supabase
      .from('comercios_adicional_config')
      .select('comercio, inventario_seguimiento, onboarding_checklist, sigla')
      .ilike('comercio', commerceName.trim())
      .maybeSingle();

    window.posSelectedCommerceConfig = cac || {
      inventario_seguimiento: false,
      onboarding_checklist: {}
    };

    const hasStockTracking = Boolean(cac?.inventario_seguimiento);
    const isCatalogConfigured = Boolean(cac?.onboarding_checklist?.catalog_ready);

    // 2. Obtener productos del catálogo con su inventario en Matriz Ñuñoa
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, sku, name, price, is_pack, is_virtual, inventory(quantity, committed_quantity, warehouse_id)')
      .eq('comercio', commerceName)
      .neq('status', 'archived')
      .order('name');

    if (prodErr) throw prodErr;

    const rawProds = (products || []).filter(p => !p.is_pack && !p.is_virtual);

    // Mapear productos calculando stock disponible en Matriz Ñuñoa
    window.posCatalogProducts = rawProds.map(p => {
      const nunoaInv = (p.inventory || []).find(inv => inv.warehouse_id === SUCURSAL_NUNOA_WH_ID);
      const nunoaQty = nunoaInv ? (nunoaInv.quantity || 0) : 0;
      const nunoaCommitted = nunoaInv ? (nunoaInv.committed_quantity || 0) : 0;
      const availableInNunoa = Math.max(0, nunoaQty - nunoaCommitted);

      const totalAvailable = (p.inventory || []).reduce((acc, inv) => {
        return acc + Math.max(0, (inv.quantity || 0) - (inv.committed_quantity || 0));
      }, 0);

      return {
        id: p.id,
        sku: p.sku || '',
        name: p.name || '',
        price: p.price || 0,
        available_nunoa: availableInNunoa,
        available_total: totalAvailable
      };
    });

    const hasCatalogItems = window.posCatalogProducts.length > 0;

    // 3. Renderizar badges de estado en el Paso 1
    if (badgesContainer) {
      const catalogBadge = (hasCatalogItems || isCatalogConfigured)
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem;"><i class="ri-checkbox-circle-line"></i> Catálogo Activo (${window.posCatalogProducts.length} productos)</span>`
        : `<span class="badge" style="background: rgba(245, 158, 11, 0.1); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.75rem;"><i class="ri-alert-line"></i> Sin Catálogo (Modo Manual)</span>`;

      const stockBadge = hasStockTracking
        ? `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.75rem;"><i class="ri-database-2-line"></i> Seguimiento de Stock Activo (Descuenta en Ñuñoa)</span>`
        : `<span class="badge badge-neutral" style="font-size: 0.75rem;"><i class="ri-information-line"></i> Sin Seguimiento de Stock</span>`;

      badgesContainer.innerHTML = `${catalogBadge} ${stockBadge}`;
    }

    // 4. Ajustar modo manual y filas de la tabla de productos
    const manualCheckbox = document.getElementById('pos-manual-mode');
    const manualWrapper = document.getElementById('pos-manual-mode-wrapper');

    if (hasCatalogItems) {
      if (manualCheckbox) manualCheckbox.checked = false;
      if (manualWrapper) manualWrapper.style.display = 'flex';
    } else {
      if (manualCheckbox) manualCheckbox.checked = true;
      if (manualWrapper) manualWrapper.style.display = 'flex';
    }

    // 5. Poblar primera fila de productos
    const tbody = document.getElementById('pos-products-tbody');
    tbody.innerHTML = '';
    window.addPosRow(!hasCatalogItems);
    window.calculatePosTotals();

  } catch (err) {
    console.error('Error cargando catálogo del comercio para POS:', err);
    if (badgesContainer) {
      badgesContainer.innerHTML = `<span class="text-danger" style="font-size: 0.75rem;"><i class="ri-error-warning-line"></i> Error al cargar catálogo: ${err.message}</span>`;
    }
  }
};

// ====== 5. TABLA DINÁMICA DE PRODUCTOS ======

window.addPosRow = function(isManual) {
  const tbody = document.getElementById('pos-products-tbody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.className = 'pos-product-row';

  const rowId = Math.random().toString(36).substr(2, 9);

  let prodCellHtml = '';
  if (isManual) {
    tr.dataset.manual = 'true';
    prodCellHtml = `
      <div style="display: flex; gap: 0.5rem;">
        <input type="text" class="form-input pos-row-sku" placeholder="SKU" required style="width: 35%;">
        <input type="text" class="form-input pos-row-name" placeholder="Nombre del Producto" required style="width: 65%;">
      </div>
    `;
  } else {
    tr.dataset.manual = 'false';
    const datalistId = `pos-datalist-${rowId}`;
    const options = (window.posCatalogProducts || []).map(p => {
      return `<option value="${escapeHtml(p.sku)} - ${escapeHtml(p.name)}" data-id="${p.id}" data-sku="${escapeHtml(p.sku)}" data-name="${escapeHtml(p.name)}" data-price="${p.price}" data-stock="${p.available_nunoa}"></option>`;
    }).join('');

    prodCellHtml = `
      <input type="text" class="form-input pos-row-catalog-input" list="${datalistId}" placeholder="Escribe para buscar SKU o nombre..." required style="width: 100%;">
      <datalist id="${datalistId}">
        ${options}
      </datalist>
    `;
  }

  tr.innerHTML = `
    <td>${prodCellHtml}</td>
    <td style="text-align: center;">
      <span class="pos-row-stock-badge badge badge-neutral" style="font-size: 0.78rem;">
        ${isManual ? 'Manual' : '-'}
      </span>
    </td>
    <td style="text-align: center;">
      <input type="number" class="form-input pos-row-qty" min="1" value="1" required style="width: 100%; text-align: center;">
    </td>
    <td style="text-align: right;">
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.25rem;">
        <span style="color: var(--color-text-muted);">$</span>
        <input type="number" class="form-input pos-row-price" min="0" value="0" step="10" required style="width: 110px; text-align: right;">
      </div>
    </td>
    <td style="text-align: right; font-weight: 700; color: #10b981; font-size: 0.95rem;">
      <span class="pos-row-subtotal">$0</span>
    </td>
    <td style="text-align: center;">
      <button type="button" class="btn-remove-pos-row" style="background: none; border: none; color: var(--color-danger, #ef4444); cursor: pointer; font-size: 1.15rem;" title="Eliminar ítem">
        <i class="ri-delete-bin-line"></i>
      </button>
    </td>
  `;

  tbody.appendChild(tr);

  // Listener para autocomplete de catálogo
  if (!isManual) {
    const input = tr.querySelector('.pos-row-catalog-input');
    input.addEventListener('change', () => {
      const val = input.value.trim().toLowerCase();
      const matched = (window.posCatalogProducts || []).find(p => {
        const full = `${p.sku} - ${p.name}`.toLowerCase();
        return full === val || p.sku.toLowerCase() === val || p.name.toLowerCase() === val;
      });

      if (matched) {
        tr.dataset.productId = matched.id;
        tr.dataset.sku = matched.sku;
        tr.dataset.name = matched.name;
        tr.dataset.stock = matched.available_nunoa;

        // Autocompletar precio
        const priceInput = tr.querySelector('.pos-row-price');
        if (priceInput && (parseInt(priceInput.value, 10) === 0 || !priceInput.value)) {
          priceInput.value = matched.price || 0;
        }

        // Badge de stock disponible
        const stockBadge = tr.querySelector('.pos-row-stock-badge');
        if (stockBadge) {
          if (matched.available_nunoa > 0) {
            stockBadge.className = 'pos-row-stock-badge badge badge-success';
            stockBadge.innerHTML = `<i class="ri-check-line"></i> ${matched.available_nunoa} un`;
          } else {
            stockBadge.className = 'pos-row-stock-badge badge badge-danger';
            stockBadge.innerHTML = `<i class="ri-close-line"></i> 0 un`;
          }
        }

        // Si el comercio tiene seguimiento estricto, limitar max
        if (window.posSelectedCommerceConfig?.inventario_seguimiento) {
          const qtyInput = tr.querySelector('.pos-row-qty');
          if (qtyInput) qtyInput.max = matched.available_nunoa;
        }
      }
      window.calculatePosTotals();
    });
  }

  // Listeners de cálculo en tiempo real
  const qtyInput = tr.querySelector('.pos-row-qty');
  const priceInput = tr.querySelector('.pos-row-price');

  const updateLineSubtotal = () => {
    const qty = parseInt(qtyInput?.value, 10) || 0;
    const price = parseInt(priceInput?.value, 10) || 0;
    const subtotal = Math.max(0, qty * price);
    const subtotalSpan = tr.querySelector('.pos-row-subtotal');
    if (subtotalSpan) subtotalSpan.textContent = formatCLP(subtotal);
    window.calculatePosTotals();
  };

  qtyInput?.addEventListener('input', updateLineSubtotal);
  priceInput?.addEventListener('input', updateLineSubtotal);

  // Listener para eliminar fila
  tr.querySelector('.btn-remove-pos-row')?.addEventListener('click', () => {
    tr.remove();
    window.calculatePosTotals();
  });

  updateLineSubtotal();
};

// Cálculo general de montos totales
window.calculatePosTotals = function() {
  const rows = document.querySelectorAll('#pos-products-tbody tr');
  let total = 0;

  rows.forEach(r => {
    const qty = parseInt(r.querySelector('.pos-row-qty')?.value, 10) || 0;
    const price = parseInt(r.querySelector('.pos-row-price')?.value, 10) || 0;
    total += Math.max(0, qty * price);
  });

  const neto = Math.round(total / 1.19);
  const iva = total - neto;

  const netoSpan = document.getElementById('pos-summary-neto');
  const ivaSpan = document.getElementById('pos-summary-iva');
  const totalSpan = document.getElementById('pos-summary-total');

  if (netoSpan) netoSpan.textContent = formatCLP(neto);
  if (ivaSpan) ivaSpan.textContent = formatCLP(iva);
  if (totalSpan) totalSpan.textContent = formatCLP(total);

  const confirmTotal = document.getElementById('pos-confirm-total');
  if (confirmTotal) confirmTotal.textContent = formatCLP(total);
};

// ====== 6. GUARDAR VENTA, CREAR PEDIDO Y DESCONTAR STOCK ======

window.savePosSale = async function(e) {
  if (e) e.preventDefault();

  const btnSave = document.getElementById('btn-pos-save');
  const commerce = document.getElementById('pos-select-commerce')?.value;
  const customerName = document.getElementById('pos-customer-name')?.value.trim();
  const customerEmail = document.getElementById('pos-customer-email')?.value.trim();
  const customerPhone = document.getElementById('pos-customer-phone')?.value.trim();
  const docTipo = document.getElementById('pos-documento-tipo')?.value || 'BOLETA';
  const modoPago = document.getElementById('pos-modo-pago')?.value || 'Tarjeta de Débito';
  const codigoVenta = document.getElementById('pos-codigo-venta')?.value.trim().toUpperCase();
  const comments = document.getElementById('pos-comments')?.value.trim();

  // Datos factura
  const fRut = document.getElementById('pos-factura-rut')?.value.trim();
  const fRazon = document.getElementById('pos-factura-razon-social')?.value.trim();
  const fGiro = document.getElementById('pos-factura-giro')?.value.trim();
  const fDireccion = document.getElementById('pos-factura-direccion')?.value.trim();

  // Ítems de la venta
  const rows = document.querySelectorAll('#pos-products-tbody tr');
  if (rows.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'Sin Productos',
      text: 'Debes agregar al menos un producto.',
      confirmButtonColor: 'var(--color-primary)'
    });
    return;
  }

  const isManual = document.getElementById('pos-manual-mode')?.checked;
  const itemsPayload = [];
  let totalAmount = 0;
  let totalUnits = 0;

  for (const r of rows) {
    const qty = parseInt(r.querySelector('.pos-row-qty')?.value, 10) || 1;
    const price = parseInt(r.querySelector('.pos-row-price')?.value, 10) || 0;
    const subtotal = qty * price;
    totalAmount += subtotal;
    totalUnits += qty;

    let sku = '';
    let name = '';
    let productId = null;

    if (isManual) {
      sku = r.querySelector('.pos-row-sku')?.value.trim() || 'SKU-MANUAL';
      name = r.querySelector('.pos-row-name')?.value.trim() || 'Producto Manual';
    } else {
      productId = r.dataset.productId || null;
      sku = r.dataset.sku || '';
      name = r.dataset.name || r.querySelector('.pos-row-catalog-input')?.value.trim() || 'Producto';
    }

    itemsPayload.push({
      sku: sku,
      producto: name,
      product_id: productId,
      cantidad: qty,
      precio: price,
      subtotal: subtotal
    });
  }

  // Confirmación previa
  const confirmResult = await Swal.fire({
    title: '¿Confirmar y Registrar Venta?',
    html: `
      <div style="text-align: left; font-size: 0.9rem; line-height: 1.5;">
        <p style="margin-bottom: 0.5rem;"><strong>Comercio:</strong> ${escapeHtml(commerce)}</p>
        <p style="margin-bottom: 0.5rem;"><strong>Cliente:</strong> ${escapeHtml(customerName)}</p>
        <p style="margin-bottom: 0.5rem;"><strong>Total a Cobrar:</strong> <span style="color: #10b981; font-weight: 700; font-size: 1.1rem;">${formatCLP(totalAmount)}</span></p>
        <p style="margin-bottom: 0.5rem;"><strong>Medio de Pago:</strong> ${escapeHtml(modoPago)} (${docTipo})</p>
        <p style="margin-bottom: 0.25rem;"><strong>Artículos:</strong> ${totalUnits} unidad(es)</p>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, Registrar Venta',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    cancelButtonColor: '#6b7280'
  });

  if (!confirmResult.isConfirmed) return;

  btnSave.disabled = true;
  btnSave.innerHTML = '<i class="ri-loader-4-line spin"></i> Procesando venta...';

  try {
    const adminUser = (window.currentUserProfile && window.currentUserProfile.email) || 'Administrador WMS';

    // 1. OBTENER MERCHANT_ID PARA VINCULAR EN ORDERS
    let merchantId = null;
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('merchant_id')
        .ilike('comercio', `%${commerce}%`)
        .limit(1)
        .maybeSingle();
      if (prof) merchantId = prof.merchant_id;
    } catch (e) {
      console.warn('No se pudo obtener merchant_id:', e);
    }

    // 2. CREAR PEDIDO EN EL GESTOR (orders)
    const skusString = itemsPayload.map(i => i.sku).filter(Boolean).join(', ');
    const namesString = itemsPayload.map(i => `${i.cantidad}x ${i.producto}`).join(', ');

    const orderPayload = {
      merchant_id: merchantId,
      comercio: commerce,
      status: 'despachado',
      estado_wms: 'Despachado',
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      shipping_address: `${SUCURSAL_NUNOA_ADDRESS} (Venta Presencial)`,
      shipping_city: 'Ñuñoa',
      shipping_method: 'Venta Presencial Sucursal Ñuñoa',
      operador: 'SUCURSAL ÑUÑOA',
      courier: 'STOCKA',
      origen: 'Punto de Venta',
      external_platform: 'Punto de Venta',
      external_order_number: codigoVenta,
      cantidad: totalUnits,
      sku: skusString || 'POS-SKU',
      item: namesString || 'Venta POS',
      total_value: totalAmount,
      sucursal_pickeo: SUCURSAL_NUNOA_NAME,
      agenda: 'POS',
      raw_shopify_data: {
        is_pos_sale: true,
        pos_sale_code: codigoVenta,
        payment_method: modoPago,
        document_type: docTipo,
        recorded_by: adminUser
      }
    };

    const { data: insertedOrder, error: orderErr } = await supabase
      .from('orders')
      .insert([orderPayload])
      .select()
      .single();

    if (orderErr) throw orderErr;

    // 3. CREAR ORDER_ITEMS
    const orderItemsPayload = [];
    for (const item of itemsPayload) {
      orderItemsPayload.push({
        order_id: insertedOrder.id,
        product_id: item.product_id,
        warehouse_id: SUCURSAL_NUNOA_WH_ID,
        quantity: item.cantidad
      });
    }

    if (orderItemsPayload.length > 0) {
      try {
        await supabase.from('order_items').insert(orderItemsPayload);
      } catch (oiErr) {
        console.warn('Aviso insertando order_items:', oiErr);
      }
    }

    // 4. INSERTAR VENTA EN STORE_SALES
    // Obtener siguiente ID disponible para store_sales si la secuencia no tiene default en BD
    let nextSaleId = null;
    try {
      const { data: maxRow } = await supabase
        .from('store_sales')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (maxRow && maxRow.length > 0 && maxRow[0].id) {
        nextSaleId = parseInt(maxRow[0].id, 10) + 1;
      }
    } catch (e) {
      console.warn('Aviso calculando nextSaleId para store_sales:', e);
    }

    const salePayload = {
      ...(nextSaleId ? { id: nextSaleId } : {}),
      codigo_venta: codigoVenta,
      comercio: commerce,
      nombre_cliente: customerName,
      correo_cliente: customerEmail || null,
      telefono_cliente: customerPhone || null,
      productos: JSON.stringify(itemsPayload),
      monto_total: totalAmount,
      modo_pago: modoPago,
      documento_tipo: docTipo,
      rut_facturacion: docTipo === 'FACTURA' ? fRut : null,
      giro_facturacion: docTipo === 'FACTURA' ? fGiro : null,
      razon_social_facturacion: docTipo === 'FACTURA' ? fRazon : null,
      direccion_facturacion: docTipo === 'FACTURA' ? fDireccion : null,
      comentarios: comments ? `${comments} [WMS-ORD: ${insertedOrder.id}]` : `[WMS-ORD: ${insertedOrder.id}]`,
      sucursal: 'Ñuñoa',
      creado_por: adminUser
    };

    // Intentar insertar con wms_order_id si la columna existe
    let insertedSale = null;
    try {
      const saleWithOrd = { ...salePayload, wms_order_id: insertedOrder.id, warehouse_id: SUCURSAL_NUNOA_WH_ID };
      const { data: sData, error: sErr } = await supabase.from('store_sales').insert([saleWithOrd]).select().single();
      if (sErr) throw sErr;
      insertedSale = sData;
    } catch (_) {
      // Fallback sin columnas nuevas si la migración aún no se ejecuta
      const { data: fallbackData, error: fallbackErr } = await supabase.from('store_sales').insert([salePayload]).select().single();
      if (fallbackErr) throw fallbackErr;
      insertedSale = fallbackData;
    }

    // 5. DESCUENTO DE STOCK Y MOVIMIENTOS (Si tiene seguimiento activo)
    const hasStockTracking = Boolean(window.posSelectedCommerceConfig?.inventario_seguimiento);
    if (hasStockTracking) {
      console.log(`📦 Descontando inventario en ${SUCURSAL_NUNOA_NAME} para ${commerce}...`);

      for (const item of itemsPayload) {
        if (item.product_id) {
          try {
            // A. Consultar inventario actual en Ñuñoa
            const { data: invRecord } = await supabase
              .from('inventory')
              .select('id, quantity')
              .eq('product_id', item.product_id)
              .eq('warehouse_id', SUCURSAL_NUNOA_WH_ID)
              .maybeSingle();

            if (invRecord) {
              const newQty = Math.max(0, (invRecord.quantity || 0) - item.cantidad);
              await supabase
                .from('inventory')
                .update({ quantity: newQty })
                .eq('id', invRecord.id);
            } else {
              await supabase
                .from('inventory')
                .insert([{
                  product_id: item.product_id,
                  warehouse_id: SUCURSAL_NUNOA_WH_ID,
                  quantity: 0
                }]);
            }

            // B. Registrar movimiento de salida en movements
            await supabase
              .from('movements')
              .insert([{
                product_id: item.product_id,
                warehouse_id: SUCURSAL_NUNOA_WH_ID,
                type: 'out',
                quantity: item.cantidad,
                reference_doc: `Venta POS Ñuñoa [${codigoVenta}]`,
                order_id: insertedOrder.id
              }]);

          } catch (invErr) {
            console.error(`Error actualizando stock para SKU ${item.sku}:`, invErr);
          }
        }
      }
    }

    // 6. SINCRONIZACIÓN ASÍNCRONA SEGURA CON PICKER (punto_ventas)
    Promise.resolve().then(async () => {
      try {
        const pickerClient = window.supabasePicker || null;
        if (pickerClient) {
          await pickerClient.from('punto_ventas').upsert([salePayload]);
        }
      } catch (pickSyncErr) {
        console.warn('Aviso sincronizando venta con Picker auxiliar:', pickSyncErr);
      }
    });

    // 7. MENSAJE DE ÉXITO Y ACCIONES
    document.getElementById('modal-pos-sale')?.classList.remove('active');

    Swal.fire({
      title: '¡Venta Registrada Exitosamente!',
      html: `
        <div style="text-align: center; line-height: 1.6; margin-top: 0.5rem;">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">
            Código de Venta: <strong style="font-family: monospace; color: var(--color-primary);">${escapeHtml(codigoVenta)}</strong>
          </p>
          <p style="color: #10b981; font-weight: 700; font-size: 1.3rem; margin-bottom: 0.75rem;">
            ${formatCLP(totalAmount)}
          </p>
          <div style="background: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-md); font-size: 0.85rem; text-align: left; margin-bottom: 1rem; border: 1px solid var(--color-border);">
            <div><strong>Pedido WMS:</strong> Generado con estado <em>Despachado</em>.</div>
            <div><strong>Inventario:</strong> ${hasStockTracking ? 'Stock descontado en Sucursal Ñuñoa.' : 'Sin seguimiento de stock físico.'}</div>
            <div><strong>Portal Cliente:</strong> Disponible en tiempo real para el comercio.</div>
          </div>
        </div>
      `,
      icon: 'success',
      showCancelButton: true,
      confirmButtonText: '<i class="ri-printer-line"></i> Imprimir Comprobante',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: 'var(--color-primary)',
      cancelButtonColor: '#6b7280'
    }).then(res => {
      if (res.isConfirmed && insertedSale) {
        window.printPosTicket(insertedSale);
      }
    });

    // Refrescar tabla y KPIs
    await fetchAndRenderPosData();

  } catch (err) {
    console.error('Error registrando venta POS:', err);
    Swal.fire({
      title: 'Error al Registrar Venta',
      text: err.message || 'Ocurrió un problema inesperado al guardar la venta.',
      icon: 'error',
      confirmButtonText: 'Entendido',
      confirmButtonColor: 'var(--color-danger)'
    });
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = 'Confirmar y Registrar Venta <i class="ri-check-line"></i>';
  }
};

// ====== 7. MODAL DE DETALLE DE VENTA ======

window.openPosSaleDetail = function(idOrData) {
  try {
    let data = null;
    if (typeof idOrData === 'object' && idOrData !== null) {
      data = idOrData;
    } else if (window.posSalesCache && window.posSalesCache.has(String(idOrData))) {
      data = window.posSalesCache.get(String(idOrData));
    } else {
      try {
        data = JSON.parse(decodeURIComponent(idOrData));
      } catch (e) {
        console.warn('Aviso parseando detalle de venta:', e);
      }
    }

    if (!data) {
      console.error('No se encontraron datos para la venta:', idOrData);
      return;
    }

    const modal = document.getElementById('modal-pos-detail');
    const container = document.getElementById('pos-detail-content');
    if (!modal || !container) return;

    // Parsear ítems
    let items = [];
    if (data.productos) {
      try {
        let p = data.productos;
        if (typeof p === 'string') p = JSON.parse(p);
        if (Array.isArray(p)) items = p;
      } catch (e) {}
    }

    let itemsTableHtml = `
      <table class="data-table" style="font-size: 0.85rem; width: 100%;">
        <thead>
          <tr>
            <th style="width: 15%; text-align: center;">Cantidad</th>
            <th style="width: 45%;">Producto</th>
            <th style="width: 20%; text-align: right;">Precio Unit.</th>
            <th style="width: 20%; text-align: right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (items.length === 0) {
      itemsTableHtml += `<tr><td colspan="4" class="text-center text-muted" style="padding: 1rem;">Sin detalle de productos</td></tr>`;
    } else {
      items.forEach(i => {
        const qty = parseInt(i.cantidad, 10) || 1;
        const price = parseInt(i.precio, 10) || 0;
        const subtotal = i.subtotal !== undefined ? i.subtotal : (qty * price);
        itemsTableHtml += `
          <tr>
            <td style="text-align: center; font-weight: 700;">${qty}x</td>
            <td>
              <strong style="color: var(--color-text-main);">${escapeHtml(i.producto || i.name || 'N/A')}</strong>
              ${i.sku ? `<div style="font-family: monospace; font-size: 0.75rem; color: var(--color-text-muted);">SKU: ${escapeHtml(i.sku)}</div>` : ''}
            </td>
            <td style="text-align: right;">${formatCLP(price)}</td>
            <td style="text-align: right; font-weight: 700; color: #10b981;">${formatCLP(subtotal)}</td>
          </tr>
        `;
      });
    }
    itemsTableHtml += `</tbody></table>`;

    // Datos de Facturación
    let factHtml = '';
    if (data.documento_tipo === 'FACTURA') {
      factHtml = `
        <div style="background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.25); padding: 1.25rem; border-radius: var(--radius-md); margin-top: 1rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #7c3aed; font-size: 0.9rem; display: flex; align-items: center; gap: 0.35rem;">
            <i class="ri-file-paper-2-line"></i> Datos Fiscales de Facturación
          </h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
            <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">RUT Empresa</span><strong style="color: var(--color-text-main);">${escapeHtml(data.rut_facturacion || '-')}</strong></div>
            <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Razón Social</span><strong style="color: var(--color-text-main);">${escapeHtml(data.razon_social_facturacion || '-')}</strong></div>
            <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Giro Comercial</span><strong style="color: var(--color-text-main);">${escapeHtml(data.giro_facturacion || '-')}</strong></div>
            <div style="grid-column: 1 / -1;"><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Dirección Fiscal</span><strong style="color: var(--color-text-main);">${escapeHtml(data.direccion_facturacion || '-')}</strong></div>
          </div>
        </div>
      `;
    }

    const d = new Date(data.created_at);
    const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        
        <!-- Header con Totales -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; background: var(--color-surface-hover); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <div>
            <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Código de Venta</span>
            <span style="font-family: monospace; font-size: 1.35rem; font-weight: 800; color: var(--color-primary);">${escapeHtml(data.codigo_venta || '-')}</span>
            <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.25rem;">
              <i class="ri-calendar-line"></i> ${dateStr}
            </div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Total Pagado</span>
            <span style="font-size: 1.6rem; font-weight: 800; color: #10b981;">${formatCLP(data.monto_total)}</span>
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-main); margin-top: 0.25rem;">
              ${escapeHtml(data.modo_pago || '-')} <small class="text-muted">(${data.documento_tipo || 'BOLETA'})</small>
            </div>
          </div>
        </div>

        <!-- Origen y Destinatario -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem;">
              <i class="ri-store-2-line"></i> Origen y Vendedor
            </h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem; margin-top: 0.5rem;">
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Comercio</span><strong>${escapeHtml(data.comercio || '-')}</strong></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Sucursal Física</span><strong>${escapeHtml(data.sucursal || SUCURSAL_NUNOA_NAME)}</strong></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Registrado Por</span><span style="color: var(--color-primary); font-weight: 500;">${escapeHtml(data.creado_por || '-')}</span></div>
            </div>
          </div>

          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem;">
              <i class="ri-user-smile-line"></i> Cliente Final
            </h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem; margin-top: 0.5rem;">
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Nombre Completo</span><strong>${escapeHtml(data.nombre_cliente || 'Consumidor Final')}</strong></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Correo Electrónico</span><span>${escapeHtml(data.correo_cliente || 'Sin correo')}</span></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Teléfono</span><span>${escapeHtml(data.telefono_cliente || 'Sin teléfono')}</span></div>
            </div>
          </div>
        </div>

        ${factHtml}

        <!-- Tabla de Productos -->
        <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem;">
            <i class="ri-shopping-cart-2-line"></i> Productos Vendidos
          </h4>
          <div style="margin-top: 0.5rem;">
            ${itemsTableHtml}
          </div>
        </div>

        <!-- Comentarios y Enlace al Gestor -->
        ${data.comentarios ? `
          <div style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 0.85rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem;">
            <strong style="color: #d97706; display: block; margin-bottom: 0.25rem;"><i class="ri-message-3-line"></i> Observaciones / Voucher:</strong>
            ${escapeHtml(data.comentarios)}
          </div>
        ` : ''}

      </div>
    `;

    // Botón de imprimir comprobante en el modal
    const printBtn = document.getElementById('btn-pos-print-ticket');
    if (printBtn) {
      printBtn.onclick = () => window.printPosTicket(data);
    }

    modal.classList.add('active');

  } catch (e) {
    console.error('Error abriendo detalle de venta POS:', e);
    alert('No se pudo abrir el detalle de la venta.');
  }
};

// ====== 8. IMPRESIÓN DE TICKET TÉRMICO (80MM) ======

window.printPosTicket = function(idOrData) {
  try {
    let data = null;
    if (typeof idOrData === 'object' && idOrData !== null) {
      data = idOrData;
    } else if (window.posSalesCache && window.posSalesCache.has(String(idOrData))) {
      data = window.posSalesCache.get(String(idOrData));
    } else {
      try {
        data = typeof idOrData === 'string' ? JSON.parse(decodeURIComponent(idOrData)) : idOrData;
      } catch (e) {
        console.warn('Aviso parseando ticket POS:', e);
      }
    }

    if (!data) {
      console.error('No se encontraron datos para imprimir ticket:', idOrData);
      return;
    }

    const printWindow = window.open('', '_blank', 'width=450,height=650');
    if (!printWindow) {
      alert('Por favor habilita las ventanas emergentes en tu navegador para imprimir.');
      return;
    }

    let items = [];
    if (data.productos) {
      try {
        let p = data.productos;
        if (typeof p === 'string') p = JSON.parse(p);
        if (Array.isArray(p)) items = p;
      } catch (e) {}
    }

    const d = new Date(data.created_at || new Date());
    const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    let itemsRows = '';
    items.forEach(i => {
      const qty = parseInt(i.cantidad, 10) || 1;
      const price = parseInt(i.precio, 10) || 0;
      const subtotal = i.subtotal !== undefined ? i.subtotal : (qty * price);
      itemsRows += `
        <tr>
          <td style="padding: 4px 0; vertical-align: top;">${qty}x</td>
          <td style="padding: 4px 0; vertical-align: top;">
            ${escapeHtml(i.producto || i.name || 'Ítem')}
            ${i.sku ? `<br><small style="font-size: 9px; color: #555;">SKU: ${escapeHtml(i.sku)}</small>` : ''}
          </td>
          <td style="padding: 4px 0; text-align: right; vertical-align: top;">${formatCLP(subtotal)}</td>
        </tr>
      `;
    });

    const ticketHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Comprobante Venta ${escapeHtml(data.codigo_venta || '')}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 12px;
            width: 76mm;
            box-sizing: border-box;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
          .logo { max-width: 140px; height: auto; margin-bottom: 4px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <h2 style="margin: 0 0 2px 0; font-size: 16px; font-weight: 800;">STOCKA CHILE</h2>
          <p style="margin: 0; font-size: 10px;">Sucursal Física Ñuñoa</p>
          <p style="margin: 0; font-size: 9px; color: #444;">${SUCURSAL_NUNOA_ADDRESS}</p>
          <p style="margin: 2px 0 0 0; font-size: 10px; font-weight: bold;">COMERCIO: ${escapeHtml(data.comercio || 'STOCKA')}</p>
        </div>

        <hr>

        <div>
          <div><strong>CÓDIGO:</strong> ${escapeHtml(data.codigo_venta || '-')}</div>
          <div><strong>FECHA:</strong> ${dateStr}</div>
          <div><strong>DOCUMENTO:</strong> ${data.documento_tipo || 'BOLETA'}</div>
          <div><strong>CLIENTE:</strong> ${escapeHtml(data.nombre_cliente || 'Consumidor Final')}</div>
          ${data.correo_cliente ? `<div><strong>EMAIL:</strong> ${escapeHtml(data.correo_cliente)}</div>` : ''}
          ${data.documento_tipo === 'FACTURA' ? `
            <div style="margin-top: 4px; font-size: 10px; border-top: 1px dotted #888; padding-top: 3px;">
              <div><strong>RUT:</strong> ${escapeHtml(data.rut_facturacion || '-')}</div>
              <div><strong>RAZÓN:</strong> ${escapeHtml(data.razon_social_facturacion || '-')}</div>
              <div><strong>GIRO:</strong> ${escapeHtml(data.giro_facturacion || '-')}</div>
            </div>
          ` : ''}
        </div>

        <hr>

        <table>
          <thead>
            <tr style="border-bottom: 1px solid #000;">
              <th style="text-align: left; width: 15%; padding-bottom: 3px;">Cant</th>
              <th style="text-align: left; width: 55%; padding-bottom: 3px;">Detalle</th>
              <th style="text-align: right; width: 30%; padding-bottom: 3px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <hr>

        <div style="font-size: 12px;">
          <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 14px;">
            <span>TOTAL:</span>
            <span>${formatCLP(data.monto_total)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 3px;">
            <span>Medio de Pago:</span>
            <span>${escapeHtml(data.modo_pago || 'Tarjeta')}</span>
          </div>
        </div>

        <hr>

        <div class="text-center" style="font-size: 9px; color: #555; line-height: 1.3;">
          <p style="margin: 0;">¡Gracias por tu compra en Stocka!</p>
          <p style="margin: 2px 0 0 0;">Atendido por: ${escapeHtml(data.creado_por || 'Mesón Ñuñoa')}</p>
          <p style="margin: 4px 0 0 0;">www.stocka.cl</p>
        </div>

        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 800);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(ticketHtml);
    printWindow.document.close();

  } catch (e) {
    console.error('Error al imprimir ticket térmico:', e);
    alert('No se pudo generar el ticket de impresión.');
  }
};

// ====== 9. EXPORTACIÓN DE DATOS (CSV Y EXCEL) ======

window.exportPosSales = async function(format) {
  try {
    let query = supabase.from('store_sales').select('*').order('created_at', { ascending: false });
    query = buildPosSalesQuery(query);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      alert('No hay datos para exportar con los filtros seleccionados.');
      return;
    }

    const rows = data.map(s => {
      const d = new Date(s.created_at);
      const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

      let prodStr = '';
      if (s.productos) {
        try {
          let p = s.productos;
          if (typeof p === 'string') p = JSON.parse(p);
          if (Array.isArray(p)) {
            prodStr = p.map(item => `${item.cantidad || 1}x ${item.producto || item.name || 'N/A'}`).join(' || ');
          }
        } catch (e) {}
      }

      return {
        'Código Venta': s.codigo_venta,
        'Fecha Venta': dateStr,
        'Comercio': s.comercio,
        'Sucursal': s.sucursal || SUCURSAL_NUNOA_NAME,
        'Total Pagado': s.monto_total,
        'Modo Pago': s.modo_pago,
        'Documento': s.documento_tipo,
        'Cliente': s.nombre_cliente,
        'Email Cliente': s.correo_cliente,
        'Teléfono': s.telefono_cliente,
        'Productos': prodStr,
        'Vendedor': s.creado_por,
        'Comentarios': s.comentarios,
        'RUT Factura': s.rut_facturacion || '',
        'Razón Social Factura': s.razon_social_facturacion || '',
        'Giro Factura': s.giro_facturacion || '',
        'Dirección Factura': s.direccion_facturacion || '',
        'ID Orden WMS': s.wms_order_id || ''
      };
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `ventas_sucursal_nunoa_${timestamp}`;

    if (format === 'csv') {
      const headers = Object.keys(rows[0]);
      const csvRows = rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
      const csvContent = '\ufeff' + [headers.join(','), ...csvRows].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${filename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } else if (format === 'excel') {
      if (typeof XLSX === 'undefined') {
        alert('Librería SheetJS (XLSX) no disponible.');
        return;
      }
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Ventas POS Ñuñoa');
      XLSX.writeFile(workbook, `${filename}.xlsx`);
    }

  } catch (err) {
    console.error('Error al exportar ventas POS:', err);
    alert('Error al exportar: ' + err.message);
  }
};

window.renderPosAdmin = renderPosAdmin;

export { renderPosAdmin };
export default renderPosAdmin;
