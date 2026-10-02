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

// ====== HELPERS VISUALES Y CONTRASTE PARA COLOR Y MÁQUINA DE PUNTO DE VENTA (POS) ======
if (!window.getPosColorLuminance) {
  window.getPosColorLuminance = function(hex) {
    if (!hex) return 0.5;
    let c = String(hex).replace('#', '').trim();
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return 0.5;
    const num = parseInt(c, 16);
    if (isNaN(num)) return 0.5;
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    const a = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  };
}

if (!window.getPosContrastTextColor) {
  window.getPosContrastTextColor = function(hex) {
    const lum = (typeof window.getPosColorLuminance === 'function') ? window.getPosColorLuminance(hex) : 0.5;
    return lum > 0.38 ? '#0f172a' : '#ffffff';
  };
}

if (!window.getPosReadableTextColor) {
  window.getPosReadableTextColor = function(hex) {
    if (!hex) return '#2563eb';
    const lum = (typeof window.getPosColorLuminance === 'function') ? window.getPosColorLuminance(hex) : 0.5;
    if (lum < 0.30) return hex;

    let c = String(hex).replace('#', '').trim();
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return '#1e293b';
    const num = parseInt(c, 16);
    if (isNaN(num)) return '#1e293b';
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;

    const rawDiff = Math.max(r, g, b) - Math.min(r, g, b);
    if (rawDiff <= 25) return '#334155';

    const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === rNorm) h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6;
      else if (max === gNorm) h = ((bNorm - rNorm) / d + 2) / 6;
      else h = ((rNorm - gNorm) / d + 4) / 6;
    }

    let targetL = 0.30;
    if (h > 0.10 && h < 0.45) targetL = 0.24;

    const s = 0.85;
    const q = targetL < 0.5 ? targetL * (1 + s) : targetL + s - targetL * s;
    const p = 2 * targetL - q;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const rFinal = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const gFinal = Math.round(hue2rgb(p, q, h) * 255);
    const bFinal = Math.round(hue2rgb(p, q, h - 1/3) * 255);

    return '#' + [rFinal, gFinal, bFinal].map(x => x.toString(16).padStart(2, '0')).join('');
  };
}

// Helper para generar icono SVG de máquina POS con color dinámico y contraste automático
window.getPosMachineSvg = function(colorHex = '#2563eb', size = 24) {
  const safeColor = (colorHex || '#2563eb').trim();
  const lum = (typeof window.getPosColorLuminance === 'function') ? window.getPosColorLuminance(safeColor) : 0.5;
  const isLight = lum > 0.40;

  const strokeColor = isLight ? 'rgba(0, 0, 0, 0.28)' : 'rgba(15, 23, 42, 0.85)';
  const slotColor = isLight ? '#0f172a' : '#ffffff';
  const slotOpacity = isLight ? '0.35' : '0.6';
  const keypadDotFill = isLight ? '#0f172a' : '#ffffff';
  const keypadDotOpacity = isLight ? '0.75' : '0.9';
  const bottomSlotOpacity = isLight ? '0.30' : '0.5';

  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.18)); flex-shrink: 0;">
    <!-- POS Terminal Main Body with chosen color -->
    <rect x="4.5" y="1.5" width="15" height="21" rx="2.8" fill="${safeColor}" stroke="${strokeColor}" stroke-width="0.8" />
    
    <!-- Top Receipt/Card slot indicator -->
    <rect x="7" y="2.5" width="10" height="0.8" rx="0.4" fill="${slotColor}" fill-opacity="${slotOpacity}" />
    
    <!-- Digital Screen -->
    <rect x="6.8" y="4.2" width="10.4" height="6.6" rx="1.2" fill="#0f172a" />
    <!-- Screen Glass Shine / Reflection -->
    <rect x="7.4" y="4.8" width="9.2" height="5.4" rx="0.8" fill="#1e293b" />
    <!-- Screen Content: Amount line & Card reader indicator -->
    <rect x="8.5" y="5.8" width="4.5" height="1.1" rx="0.55" fill="#38bdf8" />
    <rect x="8.5" y="7.5" width="7" height="1.6" rx="0.6" fill="#10b981" />
    
    <!-- Keypad Matrix (3x3 numeric keypad) -->
    <circle cx="8.2" cy="12.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="12" cy="12.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="15.8" cy="12.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="8.2" cy="14.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="12" cy="14.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="15.8" cy="14.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="8.2" cy="16.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="12" cy="16.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="15.8" cy="16.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    
    <!-- POS Function Buttons (Red Cancel, Yellow Clear, Green OK/Enter) -->
    <rect x="7.2" y="18.4" width="2.6" height="1.1" rx="0.5" fill="#ef4444" />
    <rect x="10.7" y="18.4" width="2.6" height="1.1" rx="0.5" fill="#eab308" />
    <rect x="14.2" y="18.4" width="2.6" height="1.1" rx="0.5" fill="#22c55e" />
    
    <!-- Bottom Chip Card Insertion Slot -->
    <rect x="8" y="20.7" width="8" height="0.7" rx="0.35" fill="${slotColor}" fill-opacity="${bottomSlotOpacity}" />
  </svg>`;
};

// Helper para resolver color de máquina POS
if (!window.resolvePosMachineColor) {
  window.resolvePosMachineColor = function(colorStr, colorHexStr) {
    if (colorHexStr && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorHexStr.trim())) {
      return colorHexStr.trim();
    }
    if (colorStr && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorStr.trim())) {
      return colorStr.trim();
    }
    const clean = (colorStr || '').trim().toLowerCase();
    if (!clean) return '#2563eb';

    const colorMap = [
      { keys: ['rojo', 'red', 'granate', 'carmesi'], hex: '#dc2626' },
      { keys: ['azul', 'blue', 'marino', 'navy'], hex: '#2563eb' },
      { keys: ['celeste', 'cyan', 'turquesa', 'sky'], hex: '#0284c7' },
      { keys: ['naranja', 'orange', 'anaranjado'], hex: '#ea580c' },
      { keys: ['negro', 'black', 'oscuro'], hex: '#1e293b' },
      { keys: ['verde', 'green', 'oliva', 'lima'], hex: '#16a34a' },
      { keys: ['amarillo', 'yellow', 'dorado', 'gold'], hex: '#ca8a04' },
      { keys: ['morado', 'purple', 'violeta', 'purpura', 'lila'], hex: '#7c3aed' },
      { keys: ['rosa', 'rosado', 'pink', 'fucsia', 'magenta'], hex: '#db2777' },
      { keys: ['gris', 'plomo', 'gray', 'grey', 'plateado', 'silver'], hex: '#64748b' },
      { keys: ['blanco', 'white', 'crema', 'claro'], hex: '#f8fafc' }
    ];

    for (const entry of colorMap) {
      if (entry.keys.some(k => clean === k || clean.includes(k))) {
        return entry.hex;
      }
    }
    return '#2563eb';
  };
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
  if (document.getElementById('pos-modo-pago')?.value === 'Transferencia') {
    window.updatePosPaymentMachineBanner();
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
  setVal('pos-customer-phone-number', '');
  const phoneCountrySel = document.getElementById('pos-customer-phone-country');
  if (phoneCountrySel) {
    phoneCountrySel.value = '+56';
    if (typeof window.handlePosPhoneCountryChange === 'function') {
      window.handlePosPhoneCountryChange();
    }
  }
  const phoneNumInput = document.getElementById('pos-customer-phone-number');
  if (phoneNumInput) {
    phoneNumInput.oninput = () => {
      if (typeof window.handlePosPhoneInput === 'function') {
        window.handlePosPhoneInput();
      }
    };
  }
  const phoneValMsg = document.getElementById('pos-phone-validation-msg');
  if (phoneValMsg) phoneValMsg.style.display = 'none';

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
        window.updatePosPaymentMachineBanner();
      } else {
        if (badgesContainer) badgesContainer.innerHTML = '';
        if (tbody) tbody.innerHTML = '';
        window.calculatePosTotals();
        window.updatePosPaymentMachineBanner();
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

  // 10. Configurar listener para actualizar banner de transferencia si cambia el código
  const codeInput = document.getElementById('pos-codigo-venta');
  if (codeInput) {
    codeInput.oninput = () => {
      if (document.getElementById('pos-modo-pago')?.value === 'Transferencia') {
        window.updatePosPaymentMachineBanner();
      }
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

      // Validar si el comercio tiene activo el Punto de Venta (POS)
      if (window.posSelectedCommerceConfig?.onboarding_checklist?.pos_active !== true) {
        Swal.fire({
          icon: 'error',
          title: 'Punto de Venta Deshabilitado',
          text: `El comercio "${commerce}" tiene deshabilitada la opción de Punto de Venta en la configuración de comercios. Por favor actívalo en Admin > Comercios para registrar ventas presenciales.`,
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

      // Validar formato del teléfono según el país seleccionado (si se ingresó)
      if (typeof window.validatePosCustomerPhone === 'function') {
        const phoneValidation = window.validatePosCustomerPhone();
        if (!phoneValidation.isValid) {
          Swal.fire({
            icon: 'warning',
            title: 'Teléfono Inválido',
            text: phoneValidation.message,
            confirmButtonColor: 'var(--color-primary)'
          });
          document.getElementById('pos-customer-phone-number')?.focus();
          return;
        }
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

        if (price <= 0) {
          hasError = true;
          errorMsg = `Por favor ingresa el Precio Unitario en la fila #${idx + 1}. Debes usar estrictamente el valor vigente dado por el comercio en su web o el precio autorizado por el mismo comercio.`;
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

      // Actualizar recuadro notorio de máquina de cobro asignada
      window.updatePosPaymentMachineBanner();
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
  // Cerrar menús de búsqueda de productos al hacer clic fuera
  if (!e.target.closest('.pos-product-search-wrapper')) {
    document.querySelectorAll('.pos-product-dropdown-list').forEach(d => {
      d.style.display = 'none';
    });
    document.querySelectorAll('.pos-dropdown-arrow').forEach(a => {
      a.style.transform = 'rotate(0deg)';
    });
  }

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

  // 7. Cerrar modales al hacer clic fuera del contenido o en botón de cierre
  const isPosSaleCloseBtn = e.target.closest('#btn-close-pos-sale') || e.target.closest('[data-close="modal-pos-sale"]');
  if (isPosSaleCloseBtn || e.target.id === 'modal-pos-sale') {
    e.preventDefault();
    e.stopPropagation();
    window.confirmAndClosePosModal();
    return;
  }

  if (e.target.id === 'modal-pos-detail') {
    e.target.classList.remove('active');
    return;
  }
});

// Helper para verificar si hay trabajo o datos sin guardar en el modal POS
window.hasPosSaleWorkInProgress = function() {
  const modal = document.getElementById('modal-pos-sale');
  if (!modal || !modal.classList.contains('active')) return false;

  // 1. Comercio seleccionado
  const commerce = document.getElementById('pos-select-commerce')?.value;
  if (commerce) return true;

  // 2. Datos de cliente ingresados
  const custName = document.getElementById('pos-customer-name')?.value.trim();
  const custEmail = document.getElementById('pos-customer-email')?.value.trim();
  const custPhone = document.getElementById('pos-customer-phone')?.value.trim();
  if (custName || custEmail || custPhone) return true;

  // 3. Productos en la tabla
  const rows = document.querySelectorAll('#pos-products-tbody tr');
  for (const r of rows) {
    if (r.dataset.productId || r.dataset.sku) return true;
    const catalogInput = r.querySelector('.pos-row-catalog-input')?.value.trim();
    if (catalogInput) return true;
    const sku = r.querySelector('.pos-row-sku')?.value.trim();
    const name = r.querySelector('.pos-row-name')?.value.trim();
    if (sku || name) return true;
    const price = r.querySelector('.pos-row-price')?.value.trim();
    if (price && price !== '0') return true;
  }

  // 4. Datos factura o comentarios
  const fRut = document.getElementById('pos-factura-rut')?.value.trim();
  const comments = document.getElementById('pos-comments')?.value.trim();
  if (fRut || comments) return true;

  return false;
};

// Cierre seguro con confirmación para evitar pérdida involuntaria de trabajo
window.confirmAndClosePosModal = async function() {
  const modal = document.getElementById('modal-pos-sale');
  if (!modal) return;

  if (window.hasPosSaleWorkInProgress()) {
    const result = await Swal.fire({
      title: '¿Deseas salir del Punto de Venta?',
      html: `
        <div style="text-align: center; font-size: 0.92rem; color: var(--color-text-main); line-height: 1.5;">
          <p style="margin-bottom: 0.6rem;">Tienes una venta en progreso con información ingresada.</p>
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 0.75rem; color: #dc2626; font-size: 0.84rem; font-weight: 600;">
            <i class="ri-alert-line"></i> Si sales ahora, se perderán los productos cargados y los datos de la venta.
          </div>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, Salir y Descartar',
      cancelButtonText: 'Continuar con la Venta',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#2563eb',
      reverseButtons: true,
      focusCancel: true
    });

    if (result.isConfirmed) {
      modal.classList.remove('active');
    }
  } else {
    modal.classList.remove('active');
  }
};

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

  window.updatePosPaymentMachineBanner();
};

// ====== HELPERS PARA TRANSFERENCIAS BANCARIAS Y WHATSAPP EN POS ======

window.posBankQrMode = 'whatsapp';

window.handlePosPhoneCountryChange = function() {
  const select = document.getElementById('pos-customer-phone-country');
  const input = document.getElementById('pos-customer-phone-number');
  const hint = document.getElementById('pos-phone-format-hint');
  if (!select || !input) return;

  const opt = select.options[select.selectedIndex];
  const ph = opt?.getAttribute('data-placeholder') || '9 1234 5678';
  const hintText = opt?.getAttribute('data-hint') || '';
  input.placeholder = ph;
  if (hint) hint.textContent = hintText;

  window.handlePosPhoneInput();
};

window.handlePosPhoneInput = function() {
  const select = document.getElementById('pos-customer-phone-country');
  const input = document.getElementById('pos-customer-phone-number');
  const hidden = document.getElementById('pos-customer-phone');
  const msg = document.getElementById('pos-phone-validation-msg');
  if (!select || !input || !hidden) return;

  const country = select.value || '';
  let raw = input.value;
  let digits = raw.replace(/\D/g, '');

  if (!digits) {
    hidden.value = '';
    if (msg) msg.style.display = 'none';
    input.style.borderColor = '';
    return;
  }

  if (country === '+56') {
    if (digits.startsWith('56') && digits.length > 9) {
      digits = digits.slice(2);
    }
    digits = digits.slice(0, 9);
    if (digits.length > 5) {
      input.value = `${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`;
    } else if (digits.length > 1) {
      input.value = `${digits.slice(0, 1)} ${digits.slice(1)}`;
    } else {
      input.value = digits;
    }
    hidden.value = `+56 ${input.value}`;

    if (digits.length === 9 && digits.startsWith('9')) {
      input.style.borderColor = 'var(--color-success, #10b981)';
      if (msg) msg.style.display = 'none';
    } else if (digits.length === 9 && !digits.startsWith('9')) {
      input.style.borderColor = 'var(--color-danger, #ef4444)';
      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#ef4444';
        msg.textContent = 'En Chile el número móvil debe comenzar con el dígito 9.';
      }
    } else {
      input.style.borderColor = '';
      if (msg) msg.style.display = 'none';
    }
  } else if (country) {
    hidden.value = `${country} ${digits}`;
    input.style.borderColor = '';
    if (msg) msg.style.display = 'none';
  } else {
    hidden.value = raw.trim();
    input.style.borderColor = '';
    if (msg) msg.style.display = 'none';
  }
};

window.validatePosCustomerPhone = function() {
  const select = document.getElementById('pos-customer-phone-country');
  const input = document.getElementById('pos-customer-phone-number');
  const hidden = document.getElementById('pos-customer-phone');
  if (!input) return { isValid: true, phone: '' };

  const raw = input.value.trim();
  if (!raw) {
    if (hidden) hidden.value = '';
    return { isValid: true, phone: '' };
  }

  const country = select?.value || '+56';
  let digits = raw.replace(/\D/g, '');

  if (country === '+56') {
    if (digits.startsWith('56') && digits.length > 9) digits = digits.slice(2);
    if (digits.length !== 9) {
      return {
        isValid: false,
        message: 'El teléfono para Chile debe contener exactamente 9 dígitos (ej: 9 1234 5678).'
      };
    }
    if (!digits.startsWith('9')) {
      return {
        isValid: false,
        message: 'En Chile los números móviles deben comenzar con el dígito 9 (ej: 9 1234 5678).'
      };
    }
    const formatted = `+56 ${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`;
    if (hidden) hidden.value = formatted;
    return { isValid: true, phone: formatted };
  }

  const opt = select?.options[select?.selectedIndex];
  const expDigits = opt?.getAttribute('data-digits');
  if (expDigits && expDigits !== 'any') {
    const expected = parseInt(expDigits, 10);
    if (digits.length !== expected) {
      return {
        isValid: false,
        message: `El número de teléfono para ${opt.text} debe tener ${expected} dígitos.`
      };
    }
  } else {
    if (digits.length < 7) {
      return {
        isValid: false,
        message: 'Por favor ingresa un número de teléfono válido.'
      };
    }
  }

  const finalFormatted = country ? `${country} ${digits}` : raw;
  if (hidden) hidden.value = finalFormatted;
  return { isValid: true, phone: finalFormatted };
};

window.getPosCustomerFormattedPhone = function() {
  const hiddenVal = document.getElementById('pos-customer-phone')?.value || '';
  const numInputVal = document.getElementById('pos-customer-phone-number')?.value || '';
  const selectVal = document.getElementById('pos-customer-phone-country')?.value || '+56';

  let raw = hiddenVal || numInputVal;
  if (!raw) return '';

  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  const countryCode = selectVal.replace(/\D/g, '');
  if (digits.startsWith(countryCode) && digits.length > 9) {
    return digits;
  }
  return `${countryCode}${digits}`;
};

window.copyPosText = async function(text, label = 'Dato') {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (typeof Swal !== 'undefined') {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1800,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'success',
        title: `${label} copiado`
      });
    }
  } catch (err) {
    console.error('Error al copiar:', err);
  }
};

window.renderPosBankQrToCanvas = function(canvasEl, text, sizePx = 130) {
  if (!canvasEl || !text) return;
  try {
    if (typeof qrcode === 'function') {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      const margin = 2;
      const cellSize = Math.max(2, Math.floor(sizePx / (count + margin * 2)));
      const actualSize = (count + margin * 2) * cellSize;

      canvasEl.width = actualSize;
      canvasEl.height = actualSize;
      const ctx = canvasEl.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, actualSize, actualSize);
      ctx.fillStyle = '#1e293b';

      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
          }
        }
      }
      return;
    }
  } catch (e) {
    console.warn('Error con qrcode-generator:', e);
  }

  // Fallback a API de códigos QR
  try {
    const ctx = canvasEl.getContext('2d');
    canvasEl.width = sizePx;
    canvasEl.height = sizePx;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, sizePx, sizePx);
    };
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&data=${encodeURIComponent(text)}`;
  } catch (err) {
    console.error('Error generando fallback QR:', err);
  }
};

window.getPosBankTransferData = function() {
  const commerceName = (document.getElementById('pos-select-commerce')?.value || '').trim();
  let config = window.posSelectedCommerceConfig;
  if (!config && window.loadedCommerceConfigsMap) {
    const foundKey = Object.keys(window.loadedCommerceConfigsMap).find(k => k.trim().toLowerCase() === commerceName.toLowerCase());
    if (foundKey) config = window.loadedCommerceConfigsMap[foundKey];
  }
  if (!config && window.cachedAdminMerchants) {
    const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toLowerCase() === commerceName.toLowerCase());
    if (foundM) {
      config = {
        comercio: foundM.nombre,
        inventario_seguimiento: Boolean(foundM.inventario_seguimiento),
        onboarding_checklist: foundM.onboarding_checklist || {}
      };
    }
  }

  const ob = config?.onboarding_checklist || {};
  const bt = ob.pos_bank_transfer || {};
  const saleCode = (document.getElementById('pos-codigo-venta')?.value || '').trim();
  const totalAmount = (document.getElementById('pos-confirm-total')?.textContent || document.getElementById('pos-summary-total')?.textContent || '$0').trim();

  return {
    commerceName,
    bank: bt.bank || '',
    accountType: bt.account_type || 'Cuenta Corriente',
    accountNumber: bt.account_number || '',
    holderName: bt.holder_name || commerceName,
    holderRut: bt.holder_rut || '',
    email: bt.email || '',
    notes: bt.notes || '',
    saleCode,
    totalAmount
  };
};

window.getPosBankFormattedText = function() {
  const d = window.getPosBankTransferData();
  const lines = [
    `DATOS DE TRANSFERENCIA BANCARIA`,
    `Comercio: ${d.commerceName}`,
    d.bank ? `Banco: ${d.bank}` : null,
    d.accountType ? `Tipo de Cuenta: ${d.accountType}` : null,
    d.accountNumber ? `N° Cuenta: ${d.accountNumber}` : null,
    d.holderRut ? `RUT: ${d.holderRut}` : null,
    d.holderName ? `Titular: ${d.holderName}` : null,
    d.email ? `Correo: ${d.email}` : null,
    d.totalAmount && d.totalAmount !== '$0' ? `Monto a Transferir: ${d.totalAmount}` : null,
    d.saleCode ? `Referencia / Asunto: ${d.saleCode}` : null,
    d.notes ? `Nota: ${d.notes}` : null
  ].filter(Boolean);

  return lines.join('\n');
};

window.getPosBankWhatsAppMessage = function() {
  const d = window.getPosBankTransferData();
  const lines = [
    `*DATOS DE TRANSFERENCIA BANCARIA*`,
    `🏪 *Comercio:* ${d.commerceName}`,
    ``,
    d.bank ? `🏦 *Banco:* ${d.bank}` : null,
    d.accountType ? `💳 *Tipo de Cuenta:* ${d.accountType}` : null,
    d.accountNumber ? `🔢 *N° de Cuenta:* \`${d.accountNumber}\`` : null,
    d.holderRut ? `🆔 *RUT Titular:* \`${d.holderRut}\`` : null,
    d.holderName ? `👤 *Titular:* ${d.holderName}` : null,
    d.email ? `✉️ *Correo:* ${d.email}` : null,
    ``,
    d.totalAmount && d.totalAmount !== '$0' ? `💰 *Total a Transferir:* *${d.totalAmount}*` : null,
    d.saleCode ? `🏷️ *Referencia / Asunto:* \`${d.saleCode}\`` : null,
    d.notes ? `ℹ️ *Nota:* _${d.notes}_` : null,
    ``,
    `_Por favor envía el comprobante a este correo o muéstralo al cajero para completar tu compra._`
  ].filter(l => l !== null);

  return lines.join('\n');
};

window.posBankQrMode = 'whatsapp';

window.getPosBankQrPayload = function(mode = window.posBankQrMode || 'whatsapp') {
  if (mode === 'whatsapp') {
    const phone = window.getPosCustomerFormattedPhone();
    const msg = window.getPosBankWhatsAppMessage();
    const encoded = encodeURIComponent(msg);
    if (phone) {
      return `https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`;
    }
    return `https://api.whatsapp.com/send?text=${encoded}`;
  }
  return window.getPosBankFormattedText();
};

window.setPosBankQrMode = function(mode, context = 'banner') {
  window.posBankQrMode = mode;
  const isWa = mode === 'whatsapp';

  const btnWa = document.getElementById('pos-qr-toggle-wa');
  const btnTxt = document.getElementById('pos-qr-toggle-txt');
  const caption = document.getElementById('pos-qr-caption');
  if (btnWa && btnTxt) {
    btnWa.style.background = isWa ? '#25D366' : 'transparent';
    btnWa.style.color = isWa ? '#ffffff' : 'var(--color-text-muted)';
    btnTxt.style.background = !isWa ? '#4f46e5' : 'transparent';
    btnTxt.style.color = !isWa ? '#ffffff' : 'var(--color-text-muted)';
  }
  if (caption) {
    caption.textContent = isWa ? 'Abre mensaje en WhatsApp' : 'Copia texto al escanear';
    caption.style.color = isWa ? '#059669' : '#4f46e5';
  }

  const mBtnWa = document.getElementById('pos-modal-qr-toggle-wa');
  const mBtnTxt = document.getElementById('pos-modal-qr-toggle-txt');
  const mCaption = document.getElementById('pos-modal-qr-caption');
  if (mBtnWa && mBtnTxt) {
    mBtnWa.style.background = isWa ? '#25D366' : 'transparent';
    mBtnWa.style.color = isWa ? '#ffffff' : 'var(--color-text-muted)';
    mBtnTxt.style.background = !isWa ? '#4f46e5' : 'transparent';
    mBtnTxt.style.color = !isWa ? '#ffffff' : 'var(--color-text-muted)';
  }
  if (mCaption) {
    mCaption.textContent = isWa ? 'Al escanear abre todos los datos en WhatsApp' : 'Al escanear copia el texto en el teléfono';
    mCaption.style.color = isWa ? '#059669' : '#4f46e5';
  }

  const payload = window.getPosBankQrPayload(mode);
  const canvas = document.getElementById('pos-bank-qr-canvas');
  if (canvas) {
    window.renderPosBankQrToCanvas(canvas, payload, 125);
  }
  const modalCanvas = document.getElementById('pos-bank-qr-modal-canvas');
  if (modalCanvas) {
    window.renderPosBankQrToCanvas(modalCanvas, payload, 220);
  }
};

window.sendPosBankViaWhatsApp = function() {
  const phone = window.getPosCustomerFormattedPhone();
  const msg = window.getPosBankWhatsAppMessage();
  const encodedText = encodeURIComponent(msg);

  if (phone) {
    const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}`;
    window.open(url, '_blank');
    if (typeof Swal !== 'undefined') {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'success',
        title: `Abriendo WhatsApp para +${phone}`
      });
    }
  } else {
    Swal.fire({
      title: '<span style="font-size: 1.15rem; font-weight: 700; color: #1e293b;"><i class="ri-whatsapp-line" style="color: #25D366; vertical-align: middle;"></i> Enviar Datos por WhatsApp</span>',
      html: `
        <div style="text-align: left; font-size: 0.85rem; padding: 0.25rem 0;">
          <p style="margin-bottom: 0.75rem; color: var(--color-text-main); line-height: 1.4;">
            No se ingresó teléfono en el Paso 1. Ingresa el número de WhatsApp del cliente para enviarle los datos directamente:
          </p>
          <div style="display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.75rem;">
            <select id="swal-wa-country" class="form-input" style="width: 105px; height: 38px; padding: 0.3rem 0.5rem; font-size: 0.82rem;">
              <option value="+56" selected>🇨🇱 +56</option>
              <option value="+54">🇦🇷 +54</option>
              <option value="+51">🇵🇪 +51</option>
              <option value="+57">🇨🇴 +57</option>
              <option value="+52">🇲🇽 +52</option>
              <option value="+1">🇺🇸 +1</option>
              <option value="+34">🇪🇸 +34</option>
              <option value="">🌍 Otro</option>
            </select>
            <input type="tel" id="swal-wa-phone" class="form-input" placeholder="9 1234 5678" style="flex: 1; height: 38px; font-size: 0.9rem;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-send-plane-fill"></i> Enviar al Cliente',
      cancelButtonText: '<i class="ri-share-forward-line"></i> Elegir Contacto',
      confirmButtonColor: '#25D366',
      cancelButtonColor: '#4f46e5',
      focusConfirm: false,
      didOpen: () => {
        const swalInput = document.getElementById('swal-wa-phone');
        if (swalInput) {
          swalInput.focus();
          swalInput.addEventListener('input', () => {
            const raw = swalInput.value.replace(/\D/g, '');
            if (raw.length > 5) {
              swalInput.value = `${raw.slice(0,1)} ${raw.slice(1,5)} ${raw.slice(5,9)}`;
            } else if (raw.length > 1) {
              swalInput.value = `${raw.slice(0,1)} ${raw.slice(1)}`;
            }
          });
        }
      },
      preConfirm: () => {
        const country = (document.getElementById('swal-wa-country')?.value || '').replace(/\D/g, '');
        const num = (document.getElementById('swal-wa-phone')?.value || '').replace(/\D/g, '');
        if (!num) {
          Swal.showValidationMessage('Ingresa un número o haz clic en "Elegir Contacto"');
          return false;
        }
        return `${country}${num}`;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        window.open(`https://api.whatsapp.com/send?phone=${result.value}&text=${encodedText}`, '_blank');
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        window.open(`https://api.whatsapp.com/send?text=${encodedText}`, '_blank');
      }
    });
  }
};

window.copyPosBankField = function(field, label) {
  const d = window.getPosBankTransferData();
  let val = '';
  switch(field) {
    case 'bank': val = d.bank; break;
    case 'account_type': val = d.accountType; break;
    case 'account_number': val = d.accountNumber; break;
    case 'holder_rut': val = d.holderRut; break;
    case 'holder_name': val = d.holderName; break;
    case 'email': val = d.email; break;
    case 'total_amount': val = (d.totalAmount || '').replace(/[^0-9]/g, '') || d.totalAmount; break;
    case 'sale_code': val = d.saleCode; break;
    default: val = '';
  }
  if (val) {
    window.copyPosText(val, label || 'Dato');
  }
};

window.copyPosBankDetails = function() {
  const text = window.getPosBankFormattedText();
  window.copyPosText(text, 'Datos de transferencia');
};

window.openPosBankQrModal = function() {
  const d = window.getPosBankTransferData();
  const isWa = (window.posBankQrMode === 'whatsapp');

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: `<span style="font-size: 1.15rem; font-weight: 700; color: #1e293b;"><i class="ri-qr-code-line" style="color: #4f46e5; vertical-align: middle;"></i> Código QR de Pago</span>`,
      html: `
        <div style="text-align: center; padding: 0.25rem 0;">
          <div style="font-size: 0.95rem; font-weight: 700; color: #4f46e5; margin-bottom: 0.25rem;">
            ${escapeHtml(d.commerceName)}
          </div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #065f46; margin-bottom: 0.65rem; background: rgba(16,185,129,0.1); padding: 0.35rem 0.8rem; border-radius: 6px; display: inline-block;">
            Total: ${escapeHtml(d.totalAmount)}
          </div>

          <div style="display: flex; justify-content: center; margin-bottom: 0.65rem;">
            <div style="display: inline-flex; background: rgba(0,0,0,0.06); border-radius: 20px; padding: 2px; font-size: 0.72rem; font-weight: 700;">
              <button type="button" id="pos-modal-qr-toggle-wa" onclick="window.setPosBankQrMode('whatsapp', 'modal')" style="border: none; border-radius: 16px; padding: 4px 12px; cursor: pointer; background: ${isWa ? '#25D366' : 'transparent'}; color: ${isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; gap: 4px; font-weight: 700; transition: all 0.2s;">
                <i class="ri-whatsapp-line"></i> WhatsApp QR
              </button>
              <button type="button" id="pos-modal-qr-toggle-txt" onclick="window.setPosBankQrMode('texto', 'modal')" style="border: none; border-radius: 16px; padding: 4px 12px; cursor: pointer; background: ${!isWa ? '#4f46e5' : 'transparent'}; color: ${!isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; gap: 4px; font-weight: 700; transition: all 0.2s;">
                <i class="ri-file-text-line"></i> Texto Directo
              </button>
            </div>
          </div>

          <div style="display: flex; justify-content: center; margin-bottom: 0.65rem;">
            <canvas id="pos-bank-qr-modal-canvas" style="background: #ffffff; padding: 10px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); border: 1.5px solid rgba(99, 102, 241, 0.25);"></canvas>
          </div>

          <p id="pos-modal-qr-caption" style="font-size: 0.78rem; color: #059669; font-weight: 600; max-width: 340px; margin: 0 auto 0.85rem auto; line-height: 1.35;">
            ${isWa ? 'Al escanear abre todos los datos en WhatsApp' : 'Al escanear copia el texto en el teléfono'}
          </p>

          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm" onclick="window.sendPosBankViaWhatsApp()" style="background: #25D366; color: #ffffff; border: none; font-size: 0.8rem; font-weight: 700; padding: 0.45rem 0.9rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(37, 211, 102, 0.3);">
              <i class="ri-whatsapp-line"></i> Enviar por WhatsApp
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.copyPosBankDetails()" style="background: #4f46e5; color: #ffffff; border: none; font-size: 0.8rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);">
              <i class="ri-file-copy-line"></i> Copiar datos
            </button>
          </div>
        </div>
      `,
      showConfirmButton: true,
      confirmButtonText: 'Cerrar',
      confirmButtonColor: '#64748b',
      didOpen: () => {
        const modalCanvas = document.getElementById('pos-bank-qr-modal-canvas');
        if (modalCanvas) {
          const payload = window.getPosBankQrPayload(window.posBankQrMode || 'whatsapp');
          window.renderPosBankQrToCanvas(modalCanvas, payload, 220);
        }
      }
    });
  }
};

// Actualización del recuadro notorio de Máquina de Pagos para Tarjetas (Paso 3)
window.updatePosPaymentMachineBanner = function() {
  const banner = document.getElementById('pos-payment-machine-banner');
  if (!banner) return;

  const commerceName = (document.getElementById('pos-select-commerce')?.value || '').trim();
  const modoPago = document.getElementById('pos-modo-pago')?.value || 'Tarjeta de Débito';

  if (!commerceName) {
    banner.innerHTML = '';
    return;
  }

  // Buscar configuración del comercio (desde cache activa o fallback global)
  let config = window.posSelectedCommerceConfig;
  if (!config && window.loadedCommerceConfigsMap) {
    const foundKey = Object.keys(window.loadedCommerceConfigsMap).find(k => k.trim().toLowerCase() === commerceName.toLowerCase());
    if (foundKey) config = window.loadedCommerceConfigsMap[foundKey];
  }
  if (!config && window.cachedAdminMerchants) {
    const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toLowerCase() === commerceName.toLowerCase());
    if (foundM) {
      config = {
        comercio: foundM.nombre,
        inventario_seguimiento: Boolean(foundM.inventario_seguimiento),
        onboarding_checklist: foundM.onboarding_checklist || {}
      };
    }
  }

  const ob = config?.onboarding_checklist || {};
  const isPosActive = ob.pos_active === true;
  const machine = ob.pos_machine || {};
  const bankTransfer = ob.pos_bank_transfer || {};
  const isCard = (modoPago === 'Tarjeta de Débito' || modoPago === 'Tarjeta de Crédito');

  if (!isPosActive) {
    banner.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.08); border: 2px solid #ef4444; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.85rem;">
        <i class="ri-forbid-2-line" style="color: #dc2626; font-size: 1.6rem; flex-shrink: 0;"></i>
        <div>
          <strong style="color: #dc2626; font-size: 0.88rem; display: block; margin-bottom: 0.2rem;">PUNTO DE VENTA DESHABILITADO PARA ${escapeHtml(commerceName)}</strong>
          <span style="font-size: 0.8rem; color: var(--color-text-main); line-height: 1.4;">
            Este comercio tiene la opción de POS inactiva en la configuración de comercios. Para operar presencialmente, habilítalo en la sección de Comercios.
          </span>
        </div>
      </div>
    `;
    return;
  }

  if (isCard) {
    const hasMachineConfig = Boolean(machine.brand || machine.model || machine.color || machine.owner);

    if (hasMachineConfig) {
      const dotColor = window.resolvePosMachineColor(machine.color, machine.color_hex);
      const isLightColor = (typeof window.getPosColorLuminance === 'function') ? (window.getPosColorLuminance(dotColor) > 0.38) : false;
      const badgeTextColor = (typeof window.getPosContrastTextColor === 'function') ? window.getPosContrastTextColor(dotColor) : '#ffffff';
      const readableTextColor = (typeof window.getPosReadableTextColor === 'function') ? window.getPosReadableTextColor(dotColor) : dotColor;
      const borderAccentColor = isLightColor ? readableTextColor : dotColor;

      const posSvgIconLarge = window.getPosMachineSvg(dotColor, 44);
      const posSvgIconMini = window.getPosMachineSvg(dotColor, 18);

      banner.innerHTML = `
        <div style="background: linear-gradient(135deg, ${dotColor}12 0%, #ffffff 100%); border: 2.5px solid ${borderAccentColor}; border-radius: var(--radius-md); padding: 1.15rem 1.35rem; box-shadow: 0 4px 16px ${isLightColor ? 'rgba(0,0,0,0.10)' : dotColor + '25'}; position: relative; overflow: hidden;">
          <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: ${borderAccentColor};"></div>
          
          <div style="display: flex; align-items: flex-start; gap: 1.1rem;">
            <div style="width: 52px; height: 52px; border-radius: 12px; background: rgba(255, 255, 255, 0.95); border: 2px solid ${borderAccentColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px ${isLightColor ? 'rgba(0,0,0,0.08)' : dotColor + '35'}; padding: 2px;">
              ${posSvgIconLarge}
            </div>
            
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.45rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <span style="background: ${dotColor}; color: ${badgeTextColor}; border: ${isLightColor ? '1px solid rgba(0,0,0,0.22)' : 'none'}; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; padding: 0.22rem 0.6rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px ${isLightColor ? 'rgba(0,0,0,0.12)' : dotColor + '40'};">
                    ${window.getPosMachineSvg(badgeTextColor, 13)} MÁQUINA DE PAGO OBLIGATORIA
                  </span>
                  <span style="font-size: 0.92rem; font-weight: 700; color: var(--color-text-main);">
                    Cobro con Tarjeta para <span style="color: ${readableTextColor}; font-weight: 800;">${escapeHtml(commerceName)}</span>
                  </span>
                </div>
              </div>
              
              <div style="font-size: 0.84rem; color: var(--color-text-main); margin-bottom: 0.75rem; line-height: 1.4;">
                Para evitar errores de recaudación o abonos a cuentas erróneas, realiza el cobro exclusivamente en este equipo físico:
              </div>
              
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.6rem; margin-bottom: ${machine.notes ? '0.65rem' : '0'};">
                <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid ${borderAccentColor}; border-radius: 8px; padding: 0.5rem 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                  <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Marca / Proveedor</span>
                  <strong style="font-size: 0.95rem; color: #1e293b; display: flex; align-items: center; gap: 0.3rem; margin-top: 0.15rem;">
                    <i class="ri-terminal-box-line" style="color: ${readableTextColor};"></i> ${escapeHtml(machine.brand || 'No asignada')}
                  </strong>
                </div>

                <div style="background: rgba(255, 255, 255, 0.95); border: 1.5px solid ${isLightColor ? readableTextColor + '55' : dotColor + '66'}; border-top: 2.5px solid ${borderAccentColor}; border-radius: 8px; padding: 0.5rem 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                  <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Color / Distintivo</span>
                  <strong style="font-size: 0.95rem; color: #1e293b; display: flex; align-items: center; gap: 0.4rem; margin-top: 0.15rem;">
                    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; background: ${dotColor}25; border: 1px solid ${isLightColor ? 'rgba(0,0,0,0.18)' : dotColor + '40'};">
                      ${posSvgIconMini}
                    </span>
                    <span style="color: ${readableTextColor}; font-weight: 800;">${escapeHtml(machine.color || 'No especificado')}</span>
                  </strong>
                </div>

                <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid ${borderAccentColor}; border-radius: 8px; padding: 0.5rem 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                  <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">N° Máquina / Terminal</span>
                  <strong style="font-size: 0.95rem; font-family: monospace; color: ${readableTextColor}; display: flex; align-items: center; gap: 0.3rem; margin-top: 0.15rem;">
                    <i class="ri-hashtag"></i> ${escapeHtml(machine.model || 'S/N')}
                  </strong>
                </div>

                <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid ${borderAccentColor}; border-radius: 8px; padding: 0.5rem 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                  <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Propiedad</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; display: flex; align-items: center; gap: 0.3rem; margin-top: 0.15rem;">
                    <i class="ri-building-line" style="color: #7c3aed;"></i> ${escapeHtml(machine.owner || 'STOCKA')}
                  </strong>
                </div>
              </div>

              ${machine.notes ? `
                <div style="background: rgba(255, 255, 255, 0.95); border-left: 4px solid #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); border-left-width: 4px; border-left-color: #f59e0b; padding: 0.55rem 0.85rem; border-radius: 6px; font-size: 0.82rem; color: var(--color-text-main);">
                  <strong style="color: #d97706;"><i class="ri-error-warning-fill"></i> Nota / Instrucción para Cajero:</strong> ${escapeHtml(machine.notes)}
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div style="background: rgba(245, 158, 11, 0.08); border: 2px dashed #f59e0b; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.85rem;">
          <div style="width: 46px; height: 46px; border-radius: 10px; background: rgba(245, 158, 11, 0.15); border: 1.5px solid #f59e0b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px;">
            ${window.getPosMachineSvg('#f59e0b', 38)}
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 800; color: #d97706; margin-bottom: 0.15rem;">
              MÁQUINA GENERAL DE STOCKA
            </div>
            <div style="font-size: 0.85rem; color: var(--color-text-main);">
              El comercio <strong>${escapeHtml(commerceName)}</strong> no tiene un terminal exclusivo registrado. Utiliza el terminal POS general de <strong>STOCKA</strong> para procesar el cobro con tarjeta.
            </div>
          </div>
        </div>
      `;
    }
  } else if (modoPago === 'Efectivo') {
    banner.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-md); padding: 0.85rem 1.15rem; display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 36px; height: 36px; border-radius: 8px; background: #10b981; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0;">
          <i class="ri-money-dollar-circle-fill"></i>
        </div>
        <div>
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 800; color: #059669; margin-bottom: 0.15rem;">
            Cobro en Efectivo
          </div>
          <div style="font-size: 0.83rem; color: var(--color-text-main);">
            Recibe el dinero en efectivo del cliente, ingrésalo en la gaveta física de caja y entrega el comprobante correspondiente.
          </div>
        </div>
      </div>
    `;
  } else if (modoPago === 'Transferencia') {
    const hasBankData = Boolean(bankTransfer.bank || bankTransfer.account_number || bankTransfer.holder_rut);
    const saleCode = (document.getElementById('pos-codigo-venta')?.value || '').trim();
    const totalAmount = (document.getElementById('pos-confirm-total')?.textContent || document.getElementById('pos-summary-total')?.textContent || '$0').trim();
    const isWa = (window.posBankQrMode !== 'texto');

    if (hasBankData) {
      banner.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, #ffffff 100%); border: 2.5px solid #6366f1; border-radius: var(--radius-md); padding: 1.15rem 1.35rem; box-shadow: 0 4px 16px rgba(99, 102, 241, 0.12); position: relative; overflow: hidden;">
          <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #6366f1;"></div>
          
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.85rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
              <span style="background: #6366f1; color: #ffffff; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; padding: 0.25rem 0.65rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 4px rgba(99, 102, 241, 0.3);">
                <i class="ri-bank-card-line"></i> DATOS DE TRANSFERENCIA BANCARIA
              </span>
              <span style="font-size: 0.92rem; font-weight: 700; color: var(--color-text-main);">
                Cuenta de destino para <span style="color: #4f46e5; font-weight: 800;">${escapeHtml(commerceName)}</span>
              </span>
            </div>
            
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <button type="button" class="btn btn-sm" onclick="window.sendPosBankViaWhatsApp()" style="background: #25D366; color: #ffffff; border: none; font-size: 0.78rem; font-weight: 700; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; border-radius: 6px; box-shadow: 0 2px 4px rgba(37, 211, 102, 0.25);" title="Enviar datos de pago por WhatsApp">
                <i class="ri-whatsapp-line"></i> Enviar por WhatsApp
              </button>
              <button type="button" class="btn btn-sm btn-primary" onclick="window.copyPosBankDetails()" style="background: #4f46e5; color: #ffffff; border: none; font-size: 0.78rem; font-weight: 600; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; border-radius: 6px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.25);">
                <i class="ri-file-copy-line"></i> Copiar todo
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr auto; gap: 1.15rem; align-items: center;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.55rem;">
              
              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Banco Destino</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.bank || 'No especificado')}</strong>
                </div>
                ${bankTransfer.bank ? `<button type="button" onclick="window.copyPosBankField('bank', 'Banco')" title="Copiar Banco" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Tipo de Cuenta</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.account_type || 'Cuenta Corriente')}</strong>
                </div>
                ${bankTransfer.account_type ? `<button type="button" onclick="window.copyPosBankField('account_type', 'Tipo de cuenta')" title="Copiar Tipo de Cuenta" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1.5px solid rgba(99, 102, 241, 0.4); border-top: 2.5px solid #4f46e5; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: #4f46e5; font-weight: 800; display: block;">N° de Cuenta</span>
                  <strong style="font-size: 0.92rem; font-family: monospace; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.account_number || 'No especificado')}</strong>
                </div>
                ${bankTransfer.account_number ? `<button type="button" onclick="window.copyPosBankField('account_number', 'N° de cuenta')" title="Copiar N° de cuenta" style="background: none; border: none; color: #4f46e5; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">RUT Titular</span>
                  <strong style="font-size: 0.85rem; font-family: monospace; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.holder_rut || 'No especificado')}</strong>
                </div>
                ${bankTransfer.holder_rut ? `<button type="button" onclick="window.copyPosBankField('holder_rut', 'RUT')" title="Copiar RUT" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Nombre / Razón Social</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.holder_name || commerceName)}</strong>
                </div>
                <button type="button" onclick="window.copyPosBankField('holder_name', 'Titular')" title="Copiar Titular" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Correo Comprobantes</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.email || 'No especificado')}</strong>
                </div>
                ${bankTransfer.email ? `<button type="button" onclick="window.copyPosBankField('email', 'Correo')" title="Copiar Correo" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.4); border-top: 2.5px solid #10b981; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: #047857; font-weight: 800; display: block;">Monto a Transferir</span>
                  <strong style="font-size: 0.95rem; color: #065f46; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(totalAmount)}</strong>
                </div>
                <button type="button" onclick="window.copyPosBankField('total_amount', 'Monto numérico')" title="Copiar Monto numérico" style="background: none; border: none; color: #047857; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Referencia / Asunto</span>
                  <strong style="font-size: 0.85rem; font-family: monospace; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(saleCode || '-')}</strong>
                </div>
                ${saleCode ? `<button type="button" onclick="window.copyPosBankField('sale_code', 'Código de venta')" title="Copiar Código" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

            </div>

            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: #ffffff; border: 1.5px solid rgba(99, 102, 241, 0.25); border-radius: 10px; padding: 0.65rem 0.75rem; box-shadow: 0 2px 8px rgba(0,0,0,0.05); min-width: 155px; text-align: center;">
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; margin-bottom: 0.35rem;">
                <span style="font-size: 0.68rem; font-weight: 700; color: #4f46e5; text-transform: uppercase; display: flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-qr-code-line"></i> QR para pago
                </span>
                <span id="pos-qr-caption" style="font-size: 0.62rem; color: ${isWa ? '#059669' : '#4f46e5'}; font-weight: 700;">
                  ${isWa ? 'Abre WhatsApp' : 'Texto directo'}
                </span>
              </div>
              
              <div style="display: inline-flex; background: rgba(0,0,0,0.06); border-radius: 14px; padding: 2px; font-size: 0.66rem; font-weight: 700; margin-bottom: 0.4rem; width: 100%;">
                <button type="button" id="pos-qr-toggle-wa" onclick="window.setPosBankQrMode('whatsapp')" style="flex: 1; border: none; border-radius: 12px; padding: 2px 6px; cursor: pointer; background: ${isWa ? '#25D366' : 'transparent'}; color: ${isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; justify-content: center; gap: 3px; font-weight: 700; transition: all 0.2s;">
                  <i class="ri-whatsapp-line"></i> WhatsApp
                </button>
                <button type="button" id="pos-qr-toggle-txt" onclick="window.setPosBankQrMode('texto')" style="flex: 1; border: none; border-radius: 12px; padding: 2px 6px; cursor: pointer; background: ${!isWa ? '#4f46e5' : 'transparent'}; color: ${!isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; justify-content: center; gap: 3px; font-weight: 700; transition: all 0.2s;">
                  <i class="ri-file-text-line"></i> Texto
                </button>
              </div>

              <div style="background: #ffffff; padding: 3px; border-radius: 6px; cursor: pointer;" onclick="window.openPosBankQrModal()" title="Clic para agrandar QR">
                <canvas id="pos-bank-qr-canvas" style="display: block; border-radius: 4px;"></canvas>
              </div>
              <button type="button" onclick="window.openPosBankQrModal()" class="btn btn-outline btn-sm" style="margin-top: 0.45rem; font-size: 0.7rem; padding: 0.2rem 0.5rem; width: 100%; border-color: rgba(99, 102, 241, 0.3); color: #4f46e5; display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem;">
                <i class="ri-fullscreen-line"></i> Agrandar
              </button>
            </div>
          </div>

          ${bankTransfer.notes ? `
            <div style="margin-top: 0.75rem; background: rgba(255, 255, 255, 0.95); border-left: 4px solid #6366f1; border: 1px solid rgba(99, 102, 241, 0.25); border-left-width: 4px; border-left-color: #6366f1; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.8rem; color: var(--color-text-main);">
              <strong style="color: #4f46e5;"><i class="ri-information-line"></i> Nota de Transferencia:</strong> ${escapeHtml(bankTransfer.notes)}
            </div>
          ` : ''}
        </div>
      `;

      setTimeout(() => {
        const canvas = document.getElementById('pos-bank-qr-canvas');
        if (canvas) {
          const payload = window.getPosBankQrPayload(window.posBankQrMode || 'whatsapp');
          window.renderPosBankQrToCanvas(canvas, payload, 125);
        }
      }, 30);

    } else {
      banner.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1.5px dashed #6366f1; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.85rem;">
          <div style="width: 42px; height: 42px; border-radius: 10px; background: rgba(99, 102, 241, 0.15); border: 1.5px solid #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; color: #4f46e5; flex-shrink: 0;">
            <i class="ri-bank-card-line"></i>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 800; color: #4f46e5; margin-bottom: 0.15rem;">
              TRANSFERENCIA BANCARIA - SIN CUENTA CONFIGURADA
            </div>
            <div style="font-size: 0.84rem; color: var(--color-text-main); line-height: 1.4;">
              El comercio <strong>${escapeHtml(commerceName)}</strong> no tiene registrada su cuenta bancaria para el POS. Puedes configurarla en <strong>Administración > Comercios > Editar Comercio > Datos de Transferencia Bancaria</strong>.
            </div>
          </div>
        </div>
      `;
    }
  } else {
    banner.innerHTML = '';
  }
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
    // 1. Obtener configuración adicional del comercio (evitando solicitar columnas inexistentes como sigla)
    let cac = null;
    try {
      const { data: cacRes, error: cacErr } = await supabase
        .from('comercios_adicional_config')
        .select('comercio, inventario_seguimiento, onboarding_checklist')
        .ilike('comercio', commerceName.trim())
        .maybeSingle();

      if (!cacErr && cacRes) {
        cac = cacRes;
      }
    } catch (e) {
      console.warn('Aviso consultando comercios_adicional_config:', e);
    }

    // Fallbacks robustos con las cachés globales cargadas en Admin
    if (!cac && window.loadedCommerceConfigsMap) {
      const foundKey = Object.keys(window.loadedCommerceConfigsMap).find(k => k.trim().toLowerCase() === commerceName.trim().toLowerCase());
      if (foundKey) {
        cac = window.loadedCommerceConfigsMap[foundKey];
      }
    }
    if (!cac && window.cachedAdminMerchants) {
      const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toLowerCase() === commerceName.trim().toLowerCase());
      if (foundM) {
        cac = {
          comercio: foundM.nombre,
          inventario_seguimiento: foundM.inventario_seguimiento !== undefined ? Boolean(foundM.inventario_seguimiento) : false,
          onboarding_checklist: foundM.onboarding_checklist || {}
        };
      }
    }

    window.posSelectedCommerceConfig = cac || {
      inventario_seguimiento: false,
      onboarding_checklist: {}
    };

    const hasStockTracking = Boolean(window.posSelectedCommerceConfig?.inventario_seguimiento);
    const isCatalogConfigured = Boolean(window.posSelectedCommerceConfig?.onboarding_checklist?.catalog_ready);

    // 2. Obtener productos del catálogo con su inventario en Matriz Ñuñoa e imagen
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, sku, name, price, image_url, is_pack, is_virtual, inventory(quantity, committed_quantity, reserved_quantity, warehouse_id)')
      .eq('comercio', commerceName)
      .neq('status', 'archived')
      .order('name');

    if (prodErr) throw prodErr;

    const rawProds = (products || []).filter(p => !p.is_pack && !p.is_virtual);

    // Mapear productos calculando stock disponible en Matriz Ñuñoa y desglose completo
    window.posCatalogProducts = rawProds.map(p => {
      const invList = p.inventory || [];
      const nunoaInv = invList.find(inv => inv.warehouse_id === SUCURSAL_NUNOA_WH_ID);
      const nunoaQty = nunoaInv ? (nunoaInv.quantity || 0) : 0;
      const nunoaCommitted = nunoaInv ? (nunoaInv.committed_quantity || 0) : 0;
      const nunoaReserved = nunoaInv ? (nunoaInv.reserved_quantity || 0) : 0;
      const availableInNunoa = Math.max(0, nunoaQty - nunoaCommitted - nunoaReserved);

      const totalPhysical = invList.reduce((acc, inv) => acc + (inv.quantity || 0), 0);
      const totalCommitted = invList.reduce((acc, inv) => acc + (inv.committed_quantity || 0), 0);
      const totalReserved = invList.reduce((acc, inv) => acc + (inv.reserved_quantity || 0), 0);
      const totalAvailable = Math.max(0, totalPhysical - totalCommitted - totalReserved);

      return {
        id: p.id,
        sku: p.sku || '',
        name: p.name || '',
        price: p.price || 0,
        image_url: p.image_url || '',
        nunoa_physical: nunoaQty,
        nunoa_committed: nunoaCommitted,
        nunoa_reserved: nunoaReserved,
        available_nunoa: availableInNunoa,
        total_physical: totalPhysical,
        total_committed: totalCommitted,
        total_reserved: totalReserved,
        available_total: totalAvailable
      };
    });

    const hasCatalogItems = window.posCatalogProducts.length > 0;

    // 3. Renderizar badges de estado en el Paso 1
    if (badgesContainer) {
      const isPosActive = window.posSelectedCommerceConfig?.onboarding_checklist?.pos_active === true;
      const machineInfo = window.posSelectedCommerceConfig?.onboarding_checklist?.pos_machine;
      const mColor = window.resolvePosMachineColor(machineInfo?.color, machineInfo?.color_hex);
      const mReadable = (typeof window.getPosReadableTextColor === 'function') ? window.getPosReadableTextColor(mColor) : mColor;
      const machineSnippet = (machineInfo?.brand || machineInfo?.model) 
        ? ` (${escapeHtml(machineInfo.brand || '')}${machineInfo.color ? ' ' + escapeHtml(machineInfo.color) : ''}${machineInfo.model ? ' - ' + escapeHtml(machineInfo.model) : ''})` 
        : '';

      const posBadge = isPosActive
        ? `<span class="badge" style="background: ${mColor}18; color: ${mReadable}; border: 1.5px solid ${mColor}55; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700;">
            ${window.getPosMachineSvg(mColor, 16)} POS Activo${machineSnippet}
          </span>`
        : `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.75rem;"><i class="ri-forbid-line"></i> POS Deshabilitado</span>`;

      const catalogBadge = (hasCatalogItems || isCatalogConfigured)
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem;"><i class="ri-checkbox-circle-line"></i> Catálogo Activo (${window.posCatalogProducts.length} productos)</span>`
        : `<span class="badge" style="background: rgba(245, 158, 11, 0.1); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.75rem;"><i class="ri-alert-line"></i> Sin Catálogo (Modo Manual)</span>`;

      const stockBadge = hasStockTracking
        ? `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.75rem;"><i class="ri-database-2-line"></i> Seguimiento de Stock Activo (Descuenta en Ñuñoa)</span>`
        : `<span class="badge badge-neutral" style="font-size: 0.75rem;"><i class="ri-information-line"></i> Sin Seguimiento de Stock</span>`;

      badgesContainer.innerHTML = `${posBadge} ${catalogBadge} ${stockBadge}`;
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

// Helper para abrir imagen en grande (lightbox / confirmación visual)
window.openPosImageLightbox = function(imageUrl, productName) {
  if (!imageUrl) return;
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: productName || 'Vista previa del producto',
      imageUrl: imageUrl,
      imageAlt: productName || 'Producto',
      imageMaxHeight: 450,
      showCloseButton: true,
      confirmButtonText: 'Cerrar',
      confirmButtonColor: 'var(--color-primary)'
    });
  } else {
    window.open(imageUrl, '_blank');
  }
};

// ====== 5. TABLA DINÁMICA DE PRODUCTOS ======

// Renderizador del buscador interactivo con desglose de stock (Físico, Mesa/Reservado, Comprometido, Disp. Ñuñoa)
window.renderPosRowDropdown = function(tr, query = '') {
  const dropdown = tr.querySelector('.pos-product-dropdown-list');
  if (!dropdown) return;

  const catalog = window.posCatalogProducts || [];
  const q = (query || '').toLowerCase().trim();

  let filtered = [];
  if (!q) {
    filtered = catalog.slice(0, 40);
  } else {
    const tokens = q.split(/\s+/).filter(Boolean);
    filtered = catalog.filter(p => {
      const target = `${p.sku || ''} ${p.name || ''}`.toLowerCase();
      return tokens.every(tok => target.includes(tok));
    }).slice(0, 40);
  }

  if (filtered.length === 0) {
    dropdown.innerHTML = `
      <div style="padding: 1.25rem 1rem; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">
        <i class="ri-search-line" style="font-size: 1.4rem; display: block; margin-bottom: 0.35rem; color: #94a3b8;"></i>
        No se encontraron productos para "<strong>${escapeHtml(query)}</strong>"
      </div>
    `;
    dropdown.style.display = 'block';
    return;
  }

  let html = '';
  filtered.forEach(p => {
    const isOutOfStock = (p.available_nunoa || 0) <= 0;
    const availBadge = isOutOfStock
      ? `<span style="background: rgba(239, 68, 68, 0.12); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.3); padding: 1.5px 7px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 0.25rem;">
          <i class="ri-alert-line"></i> Disp Ñuñoa: 0 un
        </span>`
      : `<span style="background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); padding: 1.5px 7px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 0.25rem;">
          <i class="ri-checkbox-circle-line"></i> Disp Ñuñoa: ${p.available_nunoa} un
        </span>`;

    html += `
      <div class="pos-product-search-item" data-id="${p.id}" style="padding: 0.6rem 0.8rem; cursor: pointer; border-bottom: 1px solid var(--color-border); color: var(--color-text-main); transition: background-color 0.15s; display: flex; flex-direction: column; gap: 0.3rem;" onmouseover="this.style.backgroundColor='var(--color-bg, #f8fafc)'" onmouseout="this.style.backgroundColor='transparent'">
        <div style="display: flex; gap: 0.65rem; align-items: center;">
          ${p.image_url ? `
            <img src="${escapeHtml(p.image_url)}" alt="" style="width: 38px; height: 38px; object-fit: cover; border-radius: 6px; border: 1px solid var(--color-border); flex-shrink: 0;" onerror="this.style.display='none'">
          ` : `
            <div style="width: 38px; height: 38px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); flex-shrink: 0;"><i class="ri-image-line" style="font-size: 1.2rem;"></i></div>
          `}
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem;">
              <span style="font-weight: 700; color: var(--color-primary, #2563eb); font-size: 0.88rem; font-family: monospace;">${escapeHtml(p.sku)}</span>
              <span style="color: var(--color-text-muted); font-weight: 600; font-size: 0.82rem;">${formatCLP(p.price || 0)}</span>
            </div>
            <div style="font-size: 0.82rem; color: var(--color-text-main); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(p.name)}">
              ${escapeHtml(p.name)}
            </div>
          </div>
        </div>

        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.4rem; font-size: 0.73rem; background: rgba(0,0,0,0.025); padding: 0.3rem 0.55rem; border-radius: 4px; border: 1px dashed var(--color-border);">
          <div style="display: flex; gap: 0.6rem; color: var(--color-text-muted); align-items: center; font-size: 0.73rem;">
            <span title="Stock físico total en Ñuñoa" style="display: inline-flex; align-items: center; gap: 0.25rem;">
              <i class="ri-box-3-line" style="color: var(--color-primary); font-size: 0.85rem;"></i> Fís: <strong style="color: var(--color-text-main);">${p.nunoa_physical}</strong>
            </span>
            <span style="opacity: 0.35;">|</span>
            <span title="Stock en mesa de preparación / reservado" style="display: inline-flex; align-items: center; gap: 0.25rem;">
              <i class="ri-archive-drawer-line" style="color: #f59e0b; font-size: 0.85rem;"></i> Mesa: <strong style="color: #d97706;">${p.nunoa_reserved}</strong>
            </span>
            <span style="opacity: 0.35;">|</span>
            <span title="Stock comprometido en pedidos en proceso" style="display: inline-flex; align-items: center; gap: 0.25rem;">
              <i class="ri-time-line" style="color: #3b82f6; font-size: 0.85rem;"></i> Comp: <strong style="color: #3b82f6;">${p.nunoa_committed}</strong>
            </span>
            ${p.available_total > p.available_nunoa ? `
              <span style="opacity: 0.35;">|</span>
              <span title="Stock disponible en toda la red STOCKA" style="color: var(--color-text-muted);">
                Red: <strong style="color: var(--color-text-main);">${p.available_total}</strong>
              </span>
            ` : ''}
          </div>
          <div>
            ${availBadge}
          </div>
        </div>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.style.display = 'block';

  dropdown.querySelectorAll('.pos-product-search-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = item.getAttribute('data-id');
      window.selectPosRowProduct(tr, pid);
    });
  });
};

// Selección de producto en la fila POS
window.selectPosRowProduct = function(tr, productId) {
  const p = (window.posCatalogProducts || []).find(prod => prod.id === productId);
  if (!p) return;

  tr.dataset.productId = p.id;
  tr.dataset.sku = p.sku;
  tr.dataset.name = p.name;
  tr.dataset.stock = p.available_nunoa;
  tr.dataset.nunoaPhysical = p.nunoa_physical;
  tr.dataset.nunoaReserved = p.nunoa_reserved;
  tr.dataset.nunoaCommitted = p.nunoa_committed;
  tr.dataset.imageUrl = p.image_url || '';

  const input = tr.querySelector('.pos-row-catalog-input');
  if (input) input.value = `${p.sku} - ${p.name}`;

  const dropdown = tr.querySelector('.pos-product-dropdown-list');
  if (dropdown) dropdown.style.display = 'none';

  const arrow = tr.querySelector('.pos-dropdown-arrow');
  if (arrow) arrow.style.transform = 'rotate(0deg)';

  // Vista previa de imagen
  const imgPreview = tr.querySelector('.pos-product-img-preview');
  if (imgPreview) {
    if (p.image_url) {
      imgPreview.innerHTML = `
        <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" 
             style="width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 4px;" 
             onerror="this.outerHTML='<i class=\\'ri-image-line\\' style=\\'color:var(--color-text-muted);font-size:1.25rem;\\'></i>'">
      `;
      imgPreview.style.borderColor = 'var(--color-primary)';
      imgPreview.style.cursor = 'pointer';
      imgPreview.title = `${p.name} (Click para ampliar)`;
      imgPreview.onclick = () => window.openPosImageLightbox(p.image_url, p.name);
    } else {
      imgPreview.innerHTML = `<i class="ri-image-line" style="color: var(--color-text-muted); font-size: 1.25rem;"></i>`;
      imgPreview.style.borderColor = 'var(--color-border)';
      imgPreview.style.cursor = 'default';
      imgPreview.title = 'Sin imagen disponible';
      imgPreview.onclick = null;
    }
  }

  // Actualizar columna de stock con badges y niveles de stock idéntico a pedido manual
  const stockContainer = tr.querySelector('.pos-row-stock-container') || tr.querySelector('td:nth-child(2)');
  if (stockContainer) {
    const isOutOfStock = (p.available_nunoa <= 0);
    stockContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
        <span class="pos-row-stock-badge badge ${isOutOfStock ? 'badge-danger' : 'badge-success'}" style="font-size: 0.78rem; font-weight: 700;">
          <i class="${isOutOfStock ? 'ri-close-line' : 'ri-check-line'}"></i> ${p.available_nunoa} un
        </span>
        <div style="font-size: 0.68rem; color: var(--color-text-muted); white-space: nowrap; line-height: 1.2;" title="Stock Físico en Ñuñoa: ${p.nunoa_physical} | En Mesa (Reservado): ${p.nunoa_reserved} | Comprometido: ${p.nunoa_committed}">
          Fís:${p.nunoa_physical} · Mesa:${p.nunoa_reserved} · Comp:${p.nunoa_committed}
        </div>
      </div>
    `;
  }

  // Si el comercio tiene seguimiento estricto, limitar max
  if (window.posSelectedCommerceConfig?.inventario_seguimiento) {
    const qtyInput = tr.querySelector('.pos-row-qty');
    if (qtyInput) qtyInput.max = p.available_nunoa;
  }

  window.calculatePosTotals();

  // Enfocar precio unitario para agilizar el cobro
  const priceInput = tr.querySelector('.pos-row-price');
  if (priceInput) {
    priceInput.focus();
  }
};

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
      <div style="display: flex; align-items: center; gap: 0.65rem;">
        <div class="pos-product-img-preview" style="width: 44px; height: 44px; min-width: 44px; border-radius: var(--radius-sm, 6px); border: 1px dashed var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;" title="Ingreso manual">
          <i class="ri-edit-line" style="color: var(--color-text-muted); font-size: 1.15rem;"></i>
        </div>
        <div style="display: flex; gap: 0.5rem; flex: 1; min-width: 0;">
          <input type="text" class="form-input pos-row-sku" placeholder="SKU" required style="width: 35%;">
          <input type="text" class="form-input pos-row-name" placeholder="Nombre del Producto" required style="width: 65%;">
        </div>
      </div>
    `;
  } else {
    tr.dataset.manual = 'false';
    prodCellHtml = `
      <div style="display: flex; align-items: center; gap: 0.65rem;">
        <div class="pos-product-img-preview" style="width: 44px; height: 44px; min-width: 44px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; box-shadow: var(--shadow-sm); transition: all 0.2s;" title="Vista previa del producto">
          <i class="ri-image-line" style="color: var(--color-text-muted); font-size: 1.25rem;"></i>
        </div>
        <div style="flex: 1; min-width: 0; position: relative;" class="pos-product-search-wrapper">
          <div style="position: relative; display: flex; align-items: center;">
            <input type="text" class="form-input pos-row-catalog-input" placeholder="🔍 Escribe para buscar SKU o nombre..." autocomplete="off" required style="width: 100%; padding-right: 2rem;">
            <i class="ri-arrow-down-s-line pos-dropdown-arrow" style="position: absolute; right: 0.65rem; color: var(--color-text-muted); pointer-events: none; transition: transform 0.2s;"></i>
          </div>
          <div class="pos-product-dropdown-list" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; min-width: 440px; max-width: 600px; max-height: 290px; overflow-y: auto; background: var(--color-surface, #ffffff); border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px); box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.15); z-index: 1200;">
          </div>
        </div>
      </div>
    `;
  }

  tr.innerHTML = `
    <td>${prodCellHtml}</td>
    <td style="text-align: center; vertical-align: middle;">
      <div class="pos-row-stock-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
        <span class="pos-row-stock-badge badge badge-neutral" style="font-size: 0.78rem;">
          ${isManual ? 'Manual' : '-'}
        </span>
      </div>
    </td>
    <td style="text-align: center;">
      <input type="number" class="form-input pos-row-qty" min="1" value="1" required style="width: 100%; text-align: center;">
    </td>
    <td style="text-align: right;">
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.25rem;">
        <span style="color: var(--color-text-muted);">$</span>
        <input type="number" class="form-input pos-row-price" min="0" value="" placeholder="Ingresa $" step="10" required style="width: 115px; text-align: right; font-weight: 600;" title="Ingresa estrictamente el valor dado por el comercio en su web o autorizado">
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

  // Listener para autocomplete de catálogo y actualización de vista previa de imagen
  if (!isManual) {
    const input = tr.querySelector('.pos-row-catalog-input');
    const dropdown = tr.querySelector('.pos-product-dropdown-list');
    const arrow = tr.querySelector('.pos-dropdown-arrow');

    input.addEventListener('focus', () => {
      document.querySelectorAll('.pos-product-dropdown-list').forEach(d => {
        if (d !== dropdown) d.style.display = 'none';
      });
      document.querySelectorAll('.pos-dropdown-arrow').forEach(a => {
        if (a !== arrow) a.style.transform = 'rotate(0deg)';
      });
      if (arrow) arrow.style.transform = 'rotate(180deg)';
      window.renderPosRowDropdown(tr, input.value);
    });

    input.addEventListener('input', () => {
      if (arrow) arrow.style.transform = 'rotate(180deg)';
      window.renderPosRowDropdown(tr, input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dropdown) dropdown.style.display = 'none';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = dropdown?.querySelector('.pos-product-search-item');
        if (first) {
          first.click();
        }
      }
    });

    input.addEventListener('change', () => {
      const val = input.value.trim();
      if (!val) {
        delete tr.dataset.productId;
        delete tr.dataset.sku;
        delete tr.dataset.name;
        delete tr.dataset.stock;
        delete tr.dataset.imageUrl;

        const imgPreview = tr.querySelector('.pos-product-img-preview');
        if (imgPreview) {
          imgPreview.innerHTML = `<i class="ri-image-line" style="color: var(--color-text-muted); font-size: 1.25rem;"></i>`;
          imgPreview.style.borderColor = 'var(--color-border)';
          imgPreview.style.cursor = 'default';
          imgPreview.title = 'Vista previa del producto';
          imgPreview.onclick = null;
        }

        const stockContainer = tr.querySelector('.pos-row-stock-container');
        if (stockContainer) {
          stockContainer.innerHTML = `<span class="pos-row-stock-badge badge badge-neutral" style="font-size: 0.78rem;">-</span>`;
        }
        window.calculatePosTotals();
      }
    });
  }

  // Listeners de cálculo en tiempo real
  const qtyInput = tr.querySelector('.pos-row-qty');
  const priceInput = tr.querySelector('.pos-row-price');

  const updateLineSubtotal = () => {
    const qty = parseInt(qtyInput?.value, 10) || 0;
    const priceVal = priceInput?.value;
    const price = (priceVal !== '' && !isNaN(priceVal)) ? Math.max(0, parseInt(priceVal, 10)) : 0;
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
    const priceVal = r.querySelector('.pos-row-price')?.value;
    const price = (priceVal !== '' && !isNaN(priceVal)) ? Math.max(0, parseInt(priceVal, 10)) : 0;
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
      subtotal: subtotal,
      image_url: r.dataset.imageUrl || null
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
        recorded_by: adminUser,
        pos_machine: (modoPago.includes('Tarjeta') || modoPago.includes('Débito') || modoPago.includes('Crédito'))
          ? (window.posSelectedCommerceConfig?.onboarding_checklist?.pos_machine || { brand: 'STOCKA POS' })
          : null
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

    const assignedMachine = window.posSelectedCommerceConfig?.onboarding_checklist?.pos_machine;
    const isCard = modoPago.includes('Tarjeta') || modoPago.includes('Débito') || modoPago.includes('Crédito');
    const machineTag = isCard 
      ? ` [Terminal: ${(assignedMachine?.brand || 'STOCKA') + (assignedMachine?.model ? ' ' + assignedMachine.model : '')}]`
      : '';

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
      comentarios: comments ? `${comments} [WMS-ORD: ${insertedOrder.id}]${machineTag}` : `[WMS-ORD: ${insertedOrder.id}]${machineTag}`,
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
              <div style="display: flex; align-items: center; gap: 0.65rem;">
                ${i.image_url ? `
                  <img src="${escapeHtml(i.image_url)}" alt="" style="width: 36px; height: 36px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border); flex-shrink: 0; cursor: pointer;" onclick="window.openPosImageLightbox('${escapeHtml(i.image_url)}', '${escapeHtml(i.producto || i.name || '')}')" onerror="this.style.display='none'">
                ` : ''}
                <div>
                  <strong style="color: var(--color-text-main);">${escapeHtml(i.producto || i.name || 'N/A')}</strong>
                  ${i.sku ? `<div style="font-family: monospace; font-size: 0.75rem; color: var(--color-text-muted);">SKU: ${escapeHtml(i.sku)}</div>` : ''}
                </div>
              </div>
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
