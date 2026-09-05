// js/billing_generator.js - Gestor de Facturación Automatizada STOCKA WMS
// Generación de facturación mensual por comercio con base en tarifas vigentes,
// volumen de almacenamiento diario, pedidos asignados por periodo,
// registro editable tipo Excel, desglose estético Stocka (#5f06fa) y analítica con gráficos.

import supabase from './supabase.js';
import { DEFAULT_PRICING_CONFIG, loadPricingConfig, sanitizeAndMergeConfig } from './pricing_manager.js';

// --- CONSTANTES DE MARCA Y SISTEMA STOCKA ---
export const STOCKA_BRAND = {
  primaryColor: '#5f06fa',
  primaryColorHover: '#4e04cc',
  primaryColorLight: 'rgba(95, 6, 250, 0.08)',
  primaryColorBorder: 'rgba(95, 6, 250, 0.25)',
  rut: '77.524.557-3',
  razonSocial: 'STOCKA SPA',
  giro: 'ALMACENAMIENTO Y FULFILLMENT',
  direccion: 'Campo de Deportes 405, Ñuñoa, Santiago',
  comuna: 'Ñuñoa',
  sitioWeb: 'www.stocka.cl',
  contactoEmail: 'contacto@stocka.cl',
  facturacionEmail: 'facturacion@stocka.cl',
  logoUrl: './img/newlogotransp.png'
};

// Estado reactivo del Gestor de Facturación
export const billingState = {
  currentPeriodId: null,
  currentPeriodName: null,
  currentPeriodYear: null,
  currentPeriodMonth: null,
  currentCommerce: null,
  commerceInfo: {},
  pricingConfig: null,
  ufValue: 40884,
  ufDate: null,
  volumeM3: 0,
  volumeDaysLogged: 0,
  volumeDailyAverage: 0,
  dailyStorageLogs: [],
  volumeStats: {
    averageM3: 0,
    daysCount: 0,
    maxDailyVolume: 0,
    minDailyVolume: 0
  },
  productsStats: {
    totalUnits: 0,
    avgUnitsPerOrder: 0,
    topProducts: [],
    allProducts: []
  },
  inboundDeclarations: [],
  activeRange: null,
  orders: [],
  supplies: [],
  adjustments: [],
  totals: {
    ordersCount: 0,
    billableOrdersCount: 0,
    storageGross: 0,
    storageDiscountPct: 0,
    storageDiscountLabel: '',
    storageDiscountAmount: 0,
    storageNet: 0,
    pickPackNet: 0,
    shippingRmFlexCount: 0,
    shippingRmFlexNet: 0,
    shippingEnviameCount: 0,
    shippingEnviameNet: 0,
    inboundTotalUF: 0,
    inboundNet: 0,
    fixedFeeNet: 0,
    fixedFeeUF: 0,
    fixedFeeReason: '',
    suppliesNet: 0,
    adjustmentsNet: 0,
    totalNet: 0,
    iva: 0,
    totalGross: 0,
    totalToPay: 0
  },
  isSaved: true,
  isLoading: false
};

// Inyectar estilos visuales avanzados del Gestor de Facturación
function injectBillingGeneratorStyles() {
  if (document.getElementById('billing-generator-styles')) return;
  const style = document.createElement('style');
  style.id = 'billing-generator-styles';
  style.innerHTML = `
    .bg-stocka-purple { background-color: #5f06fa !important; }
    .text-stocka-purple { color: #5f06fa !important; }
    .border-stocka-purple { border-color: #5f06fa !important; }

    .bg-card-container {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }

    .bg-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .bg-kpi-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 1.1rem 1.25rem;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.2s;
    }

    .bg-kpi-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      transform: translateY(-1px);
    }

    .bg-kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: #5f06fa;
    }

    .bg-kpi-title {
      font-size: 0.725rem;
      font-weight: 700;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .bg-kpi-value {
      font-size: 1.45rem;
      font-weight: 800;
      color: var(--color-text-main);
      font-family: 'Outfit', sans-serif;
    }

    .bg-kpi-subtitle {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      margin-top: 0.25rem;
    }

    /* Sub-tabs del Gestor */
    .bg-subnav {
      display: flex;
      gap: 0.5rem;
      border-bottom: 2px solid var(--color-border);
      margin-bottom: 1.5rem;
      padding-bottom: 0.5rem;
      flex-wrap: wrap;
    }

    .bg-subnav-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--color-text-muted);
      padding: 0.6rem 1.25rem;
      font-size: 0.85rem;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .bg-subnav-btn:hover {
      color: #5f06fa;
      background: rgba(95, 6, 250, 0.05);
    }

    .bg-subnav-btn.active {
      background: linear-gradient(135deg, rgba(95, 6, 250, 0.12) 0%, rgba(95, 6, 250, 0.05) 100%);
      color: #5f06fa;
      border-color: rgba(95, 6, 250, 0.35);
      box-shadow: 0 2px 6px rgba(95, 6, 250, 0.1);
    }

    /* Tabla editable tipo Excel */
    .bg-excel-table-container {
      max-height: 560px;
      overflow-y: auto;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.02);
    }

    .bg-excel-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      background: var(--color-surface);
    }

    .bg-excel-table th {
      position: sticky;
      top: 0;
      background: #f1f5f9;
      color: #1e293b;
      font-weight: 700;
      padding: 0.7rem 0.6rem;
      border: 1px solid #cbd5e1;
      text-align: left;
      z-index: 5;
      white-space: nowrap;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    [data-theme="dark"] .bg-excel-table th {
      background: #1e293b;
      color: #cbd5e1;
      border-color: #334155;
    }

    .bg-excel-table td {
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--color-border);
      vertical-align: middle;
      white-space: nowrap;
    }

    .bg-excel-table tr:hover {
      background: rgba(95, 6, 250, 0.02);
    }

    .bg-excel-input {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 0.25rem 0.4rem;
      font-size: 0.8rem;
      color: var(--color-text-main);
      font-family: inherit;
      width: 100%;
      box-sizing: border-box;
      transition: all 0.15s;
    }

    .bg-excel-input:hover {
      border-color: var(--color-border);
      background: var(--color-bg);
    }

    .bg-excel-input:focus {
      outline: none;
      border-color: #5f06fa;
      background: var(--color-bg);
      box-shadow: 0 0 0 2px rgba(95, 6, 250, 0.15);
    }

    .bg-excel-select {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-text-main);
      cursor: pointer;
    }

    /* Fila de Filtros por Columna Sticky */
    .bg-excel-table thead tr:first-child th {
      position: sticky;
      top: 0;
      z-index: 6;
      height: 38px;
      box-sizing: border-box;
    }

    .bg-excel-table thead tr.bg-table-filter-row th {
      position: sticky;
      top: 38px;
      z-index: 5;
      background: #f8fafc;
      border-bottom: 2px solid #cbd5e1;
      padding: 4px 5px;
      box-sizing: border-box;
      font-weight: 500;
    }

    [data-theme="dark"] .bg-excel-table thead tr.bg-table-filter-row th {
      background: #1e293b;
      border-bottom-color: #334155;
    }

    .bg-col-filter-input {
      width: 100%;
      padding: 3px 6px;
      font-size: 0.72rem;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      background: var(--color-surface);
      color: var(--color-text-main);
      box-sizing: border-box;
      font-family: inherit;
    }

    .bg-col-filter-input:focus {
      outline: none;
      border-color: #5f06fa;
      box-shadow: 0 0 0 1px #5f06fa;
    }

    .bg-col-filter-select {
      width: 100%;
      padding: 3px 4px;
      font-size: 0.7rem;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      background: var(--color-surface);
      color: var(--color-text-main);
      box-sizing: border-box;
      cursor: pointer;
      font-family: inherit;
    }

    .bg-col-filter-select:focus {
      outline: none;
      border-color: #5f06fa;
    }

    .bg-quick-filter-btn {
      padding: 3px 9px;
      font-size: 0.72rem;
      font-weight: 700;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .bg-quick-filter-btn:hover {
      border-color: #5f06fa;
      color: #5f06fa;
    }

    .bg-quick-filter-btn.active {
      background: #5f06fa !important;
      color: #ffffff !important;
      border-color: #5f06fa !important;
    }

    /* Badges de Agenda y Operador */
    .bg-order-agenda-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: #ede9fe;
      color: #5b21b6;
      border: 1px solid #ddd6fe;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.2px;
      vertical-align: middle;
    }

    .bg-order-agenda-badge-empty {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #f87171;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.2px;
      vertical-align: middle;
    }

    .bg-order-operador-badge {
      display: inline-flex;
      align-items: center;
      font-size: 0.65rem;
      font-weight: 700;
      color: #0f766e;
      background: #ccfbf1;
      border: 1px solid #99f6e4;
      padding: 1px 5px;
      border-radius: 4px;
      letter-spacing: 0.2px;
    }

    .bg-order-operador-badge-empty {
      display: inline-flex;
      align-items: center;
      font-size: 0.65rem;
      font-weight: 600;
      color: #94a3b8;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      padding: 1px 4px;
      border-radius: 4px;
    }

    .bg-order-shipping-method {
      font-size: 0.7rem;
      color: var(--color-text-muted);
      margin-top: 3px;
      display: flex;
      align-items: center;
      gap: 4px;
      line-height: 1.2;
    }

    /* === DOCUMENTO ESTÉTICO DESGLOSE OFICIAL STOCKA === */
    .stocka-desglose-paper {
      background: #ffffff;
      color: #0f172a;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04);
      max-width: 980px;
      margin: 0 auto;
      padding: 2.5rem 3rem;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-sizing: border-box;
      border: 1px solid #e2e8f0;
      position: relative;
    }

    @media print {
      .stocka-desglose-paper {
        box-shadow: none;
        border: none;
        padding: 0;
        max-width: 100%;
      }
    }

    .stocka-main-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid #e2e8f0;
      flex-wrap: wrap;
      gap: 1.25rem;
    }

    .stocka-entity-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
      box-sizing: border-box;
    }

    .stocka-entity-card-header {
      background: #5f06fa;
      color: #ffffff;
      padding: 0.5rem 0.85rem;
      font-size: 0.8rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stocka-entity-body {
      padding: 0.75rem 0.85rem;
    }

    .stocka-entity-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      padding: 0.3rem 0;
      border-bottom: 1px solid #f1f5f9;
    }

    .stocka-entity-row:last-child {
      border-bottom: none;
    }

    /* 4 Tarjetas Métricas en 1 Sola Línea con Estilo Único y Sobrio */
    .stocka-metric-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.85rem;
      margin-bottom: 1.5rem;
    }

    @media (max-width: 860px) {
      .stocka-metric-row {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .stocka-metric-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-top: 3px solid #5f06fa;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .stocka-metric-title {
      font-size: 0.7rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.35rem;
    }

    .stocka-metric-value {
      font-size: 1.35rem;
      font-weight: 800;
      color: #0f172a;
      font-family: 'Outfit', sans-serif;
      line-height: 1.2;
    }

    .stocka-metric-sub {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 0.35rem;
    }

    .stocka-banner-hero {
      background: #5f06fa;
      color: white;
      border-radius: 8px;
      padding: 1.25rem 1.75rem;
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.25rem;
    }

    .stocka-table-official {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
      border: 1px solid #cbd5e1;
      font-size: 0.85rem;
    }

    .stocka-table-official th {
      background: #5f06fa;
      color: #ffffff;
      padding: 0.65rem 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.5px;
      border: 1px solid #4e04cc;
    }

    .stocka-table-official td {
      padding: 0.65rem 0.85rem;
      border: 1px solid #e2e8f0;
      color: #1e293b;
      vertical-align: middle;
    }

    .stocka-table-official tr:nth-child(even) td {
      background: #f8fafc;
    }

    /* Estilos de la Pestaña de Analítica */
    .bg-analytics-hero {
      background: #f8fafc;
      border: 1px solid var(--color-border);
      border-left: 4px solid #5f06fa;
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .bg-chart-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 1.25rem;
      box-shadow: 0 2px 6px rgba(0,0,0,0.03);
      position: relative;
    }

    .bg-chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
    }

    .bg-chart-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--color-text-main);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `;
  document.head.appendChild(style);
}

// --- FORMATEADORES ---
export function formatCLP(val) {
  if (val === null || val === undefined || isNaN(val)) return '$0';
  return '$' + Math.round(Number(val)).toLocaleString('es-CL');
}

export function formatDec(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '0';
  return Number(val).toLocaleString('es-CL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Obtener valor UF para el día 1 del mes calendario de un periodo
export async function getUfForPeriod(year, month) {
  if (!year || !month) {
    const todayUf = typeof window.getLiveUfValue === 'function' ? await window.getLiveUfValue() : 40884;
    return { value: todayUf, dateStr: '01/--/----' };
  }

  const mmStr = String(month).padStart(2, '0');
  const dateStr = `01-${mmStr}-${year}`;
  const displayDateStr = `01/${mmStr}/${year}`;

  // 1. Intentar consulta a mindicador.cl para la fecha exacta del día 1
  try {
    const res = await fetch(`https://mindicador.cl/api/uf/${dateStr}`);
    if (res.ok) {
      const data = await res.json();
      const val = data?.serie?.[0]?.valor;
      if (val && !isNaN(val) && val > 30000) {
        return { value: Math.round(val), dateStr: displayDateStr };
      }
    }
  } catch (e) {
    console.warn(`No se pudo obtener UF para fecha ${dateStr}:`, e);
  }

  // 2. Si cayó en fin de semana, probar con el día 2 o 3
  try {
    const res2 = await fetch(`https://mindicador.cl/api/uf/02-${mmStr}-${year}`);
    if (res2.ok) {
      const data2 = await res2.json();
      const val2 = data2?.serie?.[0]?.valor;
      if (val2 && !isNaN(val2) && val2 > 30000) {
        return { value: Math.round(val2), dateStr: `02/${mmStr}/${year}` };
      }
    }
  } catch (e) {}

  // 3. Fallback a valor general en vivo
  try {
    const liveUf = typeof window.getLiveUfValue === 'function' ? await window.getLiveUfValue() : 40884;
    return { value: liveUf, dateStr: displayDateStr };
  } catch (e) {
    return { value: 40884, dateStr: displayDateStr };
  }
}

// Resolver comercios mapeados (Punto A del análisis crítico)
export async function resolveCommerceGroup(commerceName) {
  if (!commerceName) return [commerceName];

  try {
    const { data, error } = await supabase
      .from('billing_mappings')
      .select('comercio_nombre, billing_name');

    if (!error && data && data.length > 0) {
      // Caso 1: commerceName es el billing_name (ej: 'BIG BANG')
      const children = data
        .filter(m => m.billing_name.toUpperCase() === commerceName.toUpperCase())
        .map(m => m.comercio_nombre);

      if (children.length > 0) {
        return children;
      }

      // Caso 2: commerceName es un comercio hijo, verificar si tiene billing_name
      const mapping = data.find(m => m.comercio_nombre.toUpperCase() === commerceName.toUpperCase());
      if (mapping) {
        const siblings = data
          .filter(m => m.billing_name.toUpperCase() === mapping.billing_name.toUpperCase())
          .map(m => m.comercio_nombre);
        return siblings.length > 0 ? siblings : [commerceName];
      }
    }
  } catch (e) {
    console.warn('Error resolviendo billing_mappings:', e);
  }

  return [commerceName];
}

// Obtener datos legales del comercio (Razón Social, RUT, Sigla, Contacto)
export async function getCommerceBillingInfo(commerceName) {
  const result = {
    comercio: commerceName,
    razonSocial: commerceName,
    rut: '—',
    sigla: '—',
    direccion: '—',
    emailFacturacion: '—'
  };

  try {
    // 1. Datos adicionales (Razón Social, RUT, dirección)
    const { data: extra } = await supabase
      .from('comercios_adicional_config')
      .select('razon_social, rut, direccion_facturacion, email_facturacion')
      .ilike('comercio', commerceName)
      .maybeSingle();

    if (extra) {
      if (extra.razon_social) result.razonSocial = extra.razon_social.trim();
      if (extra.rut) result.rut = extra.rut.trim();
      if (extra.direccion_facturacion) result.direccion = extra.direccion_facturacion.trim();
      if (extra.email_facturacion) result.emailFacturacion = extra.email_facturacion.trim();
    }

    // 2. Sigla de v_comercios_config
    const { data: vConfig } = await supabase
      .from('v_comercios_config')
      .select('sigla, nombre')
      .ilike('nombre', commerceName)
      .maybeSingle();

    if (vConfig && vConfig.sigla) {
      result.sigla = vConfig.sigla.toUpperCase().trim();
    }
  } catch (e) {
    console.warn('Error cargando información legal del comercio:', e);
  }

  return result;
}

// Obtener volumen promedio diario de almacenamiento del mes calendario (Punto B)
export async function getMonthlyStorageVolume(commerceGroup, year, month) {
  if (!commerceGroup || commerceGroup.length === 0 || !year || !month) {
    return { averageM3: 0, daysCount: 0, dailyLogs: [] };
  }

  const mm = String(month).padStart(2, '0');
  const startDate = `${year}-${mm}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  try {
    const { data, error } = await supabase
      .from('comercios_volumen_diario')
      .select('comercio, fecha, volumen')
      .in('comercio', commerceGroup)
      .gte('fecha', startDate)
      .lte('fecha', endDate)
      .order('fecha', { ascending: true });

    if (!error && data && data.length > 0) {
      const dailyMap = {};
      data.forEach(item => {
        const d = item.fecha;
        const v = parseFloat(item.volumen) || 0;
        dailyMap[d] = (dailyMap[d] || 0) + v;
      });

      const dates = Object.keys(dailyMap);
      const daysCount = dates.length;
      const totalVolumeSum = dates.reduce((acc, d) => acc + dailyMap[d], 0);
      const averageM3 = daysCount > 0 ? (totalVolumeSum / daysCount) : 0;

      return {
        averageM3: parseFloat(averageM3.toFixed(4)),
        daysCount,
        dailyLogs: dates.map(d => ({ date: d, volume: dailyMap[d] }))
      };
    }
  } catch (e) {
    console.warn('Error consultando volumen diario:', e);
  }

  // Fallback a volumen actual
  try {
    const { data: curVol } = await supabase
      .from('v_comercios_volumen_actual')
      .select('comercio, volumen_actual')
      .in('comercio', commerceGroup);

    if (curVol && curVol.length > 0) {
      const sum = curVol.reduce((acc, c) => acc + (parseFloat(c.volumen_actual) || 0), 0);
      return {
        averageM3: parseFloat(sum.toFixed(4)),
        daysCount: 1,
        dailyLogs: []
      };
    }
  } catch (e) {}

  return { averageM3: 0, daysCount: 0, dailyLogs: [] };
}

// --- MOTOR PRINCIPAL DE CÁLCULO DE FACTURACIÓN ---
export async function calculateCommerceBilling(commerceName, periodName, customOverrides = {}) {
  billingState.isLoading = true;
  billingState.currentCommerce = commerceName;
  billingState.currentPeriodName = periodName;

  // 1. Cargar tarifas oficiales desde pricing_manager
  const rawPricing = await loadPricingConfig(supabase);
  billingState.pricingConfig = sanitizeAndMergeConfig(rawPricing);
  const cfg = billingState.pricingConfig;

  // 2. Extraer año y mes del periodo (ej: "AGOSTO 2026")
  let periodYear = 2026;
  let periodMonth = 8;
  const periodParts = (periodName || '').trim().split(/\s+/);
  if (periodParts.length >= 2) {
    const mName = periodParts[0].toUpperCase();
    const yVal = parseInt(periodParts[1], 10);
    if (!isNaN(yVal)) periodYear = yVal;

    const monthMap = {
      'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4, 'MAYO': 5, 'JUNIO': 6,
      'JULIO': 7, 'AGOSTO': 8, 'SEPTIEMBRE': 9, 'OCTUBRE': 10, 'NOVIEMBRE': 11, 'DICIEMBRE': 12
    };
    if (monthMap[mName]) periodMonth = monthMap[mName];
  }
  billingState.currentPeriodYear = periodYear;
  billingState.currentPeriodMonth = periodMonth;

  // 3. Obtener UF del día 1 del mes facturado (Punto E)
  const ufResult = await getUfForPeriod(periodYear, periodMonth);
  billingState.ufValue = customOverrides.ufValue || ufResult.value;
  billingState.ufDate = ufResult.dateStr;

  // 4. Resolver holdings y obtener datos legales del cliente (Punto A)
  const commerceGroup = await resolveCommerceGroup(commerceName);
  billingState.commerceInfo = await getCommerceBillingInfo(commerceName);

  // 5. Calcular volumen de almacenamiento promedio del mes calendario (Punto B)
  const volData = await getMonthlyStorageVolume(commerceGroup, periodYear, periodMonth);
  billingState.volumeDailyAverage = volData.averageM3;
  billingState.volumeDaysLogged = volData.daysCount;
  billingState.volumeM3 = customOverrides.volumeM3 !== undefined 
    ? parseFloat(customOverrides.volumeM3) 
    : volData.averageM3;

  const dailyLogs = volData.dailyLogs || [];
  const vols = dailyLogs.map(l => l.volume).filter(v => typeof v === 'number');
  const maxDailyVolume = vols.length > 0 ? Math.max(...vols) : billingState.volumeM3;
  const minDailyVolume = vols.length > 0 ? Math.min(...vols) : billingState.volumeM3;
  billingState.dailyStorageLogs = dailyLogs;
  billingState.volumeStats = {
    averageM3: billingState.volumeM3,
    daysCount: billingState.volumeDaysLogged,
    maxDailyVolume: parseFloat(maxDailyVolume.toFixed(4)),
    minDailyVolume: parseFloat(minDailyVolume.toFixed(4))
  };

  // 5.1 Consultar declaraciones de ingreso de stock asignadas al periodo
  let inboundDeclarationsList = [];
  try {
    let rawDecs = null;
    const res1 = await supabase
      .from('stock_declarations')
      .select(`
        id,
        title,
        status,
        quantity_declared,
        quantity_received,
        volume_declared,
        volume_confirmed,
        estimated_cost,
        real_cost,
        delivery_method,
        package_count,
        package_type,
        billing_status,
        periodo_facturacion,
        billing_notes,
        created_at
      `)
      .in('comercio', commerceGroup);

    if (!res1.error && res1.data) {
      rawDecs = res1.data;
    } else {
      // Fallback si la columna periodo_facturacion aún no existe en el esquema
      const res2 = await supabase
        .from('stock_declarations')
        .select(`
          id,
          title,
          status,
          quantity_declared,
          quantity_received,
          volume_declared,
          volume_confirmed,
          estimated_cost,
          real_cost,
          delivery_method,
          package_count,
          package_type,
          billing_status,
          billing_notes,
          created_at
        `)
        .in('comercio', commerceGroup);

      if (!res2.error && res2.data) {
        rawDecs = res2.data;
      }
    }

    if (rawDecs) {
      const pNorm = (periodName || '').trim().toUpperCase();
      inboundDeclarationsList = rawDecs.filter(d => {
        if (d.periodo_facturacion && d.periodo_facturacion.trim().toUpperCase() === pNorm) return true;
        if (d.billing_notes && d.billing_notes.toUpperCase().includes(pNorm)) return true;
        return false;
      });
    }
  } catch (errDec) {
    console.warn('Error consultando stock_declarations para facturación:', errDec);
  }

  let inboundTotalUF = 0;
  let inboundTotalNet = 0;
  const processedInbounds = inboundDeclarationsList.map(dec => {
    const costUF = (dec.real_cost !== null && dec.real_cost !== undefined && dec.real_cost > 0)
      ? parseFloat(dec.real_cost)
      : (parseFloat(dec.estimated_cost) || 0);
    const costCLP = Math.round(costUF * billingState.ufValue);
    inboundTotalUF += costUF;
    inboundTotalNet += costCLP;
    return {
      ...dec,
      costUF: parseFloat(costUF.toFixed(4)),
      costCLP
    };
  });
  billingState.inboundDeclarations = processedInbounds;

  // 6. Consultar pedidos asignados al periodo en el Gestor de Pedidos
  let ordersList = [];
  try {
    const { data: rawOrders, error: ordErr } = await supabase
      .from('orders')
      .select(`
        id,
        created_at,
        external_order_number,
        external_platform,
        status,
        estado_wms,
        comercio,
        categoria_entrega,
        agenda,
        operador,
        shipping_city,
        shipping_address,
        shipping_method,
        total_value,
        sku,
        cantidad,
        item,
        raw_shopify_data,
        raw_woocommerce_data,
        raw_meli_data,
        periodo_facturacion,
        order_items (
          quantity,
          products (
            id,
            sku,
            name,
            is_virtual
          )
        )
      `)
      .in('comercio', commerceGroup)
      .eq('periodo_facturacion', periodName);

    if (ordErr) throw ordErr;
    ordersList = rawOrders || [];
  } catch (e) {
    console.error('Error cargando pedidos para facturación:', e);
  }

  // 7. Determinar cantidad de pedidos y tramo tarifario (order_ranges)
  const totalOrdersCount = ordersList.length;
  let activeRange = cfg.order_ranges[0];
  for (const r of cfg.order_ranges) {
    if (totalOrdersCount >= r.min && totalOrdersCount <= r.max) {
      activeRange = r;
      break;
    }
  }
  if (totalOrdersCount > cfg.order_ranges[cfg.order_ranges.length - 1].min) {
    activeRange = cfg.order_ranges[cfg.order_ranges.length - 1];
  }
  billingState.activeRange = activeRange;

  // 8. Procesar cada pedido: tarifa base, recargos y despacho
  const processedOrders = ordersList.map((ord, idx) => {
    const isExcluded = customOverrides.excludedOrderIds && customOverrides.excludedOrderIds.includes(ord.id);
    
    // Conteo de SKUs y Unidades
    let skuCount = 1;
    let unitsCount = Math.max(1, parseInt(ord.cantidad, 10) || 1);
    
    if (ord.order_items && Array.isArray(ord.order_items) && ord.order_items.length > 0) {
      skuCount = ord.order_items.length;
      unitsCount = ord.order_items.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 1), 0);
    } else if (ord.sku && ord.sku.includes(',')) {
      skuCount = ord.sku.split(',').length;
    }

    // Reglas de Recargos de Pick & Pack
    const basePickPackRate = activeRange.pick_pack_base; // ej: $1.250
    const extraSkuCount = Math.max(0, skuCount - (cfg.pick_pack_rules.base_included_sku || 3));
    const surchargeSku = extraSkuCount * (cfg.pick_pack_rules.surcharge_extra_sku || 100);

    const extraUnitsCount = Math.max(0, unitsCount - (cfg.pick_pack_rules.base_included_units || 10));
    const surchargeUnits = extraUnitsCount * (cfg.pick_pack_rules.surcharge_extra_unit || 50);

    // Detección de pedido Marketplace (+ $100)
    const platformUpper = String(ord.external_platform || '').toUpperCase();
    const agendaUpper = String(ord.agenda || '').toUpperCase();
    const operadorUpper = String(ord.operador || '').toUpperCase();

    const isMarketplace = platformUpper.includes('MERCADO') || 
                          platformUpper.includes('FALABELLA') || 
                          platformUpper.includes('RIPLEY') || 
                          platformUpper.includes('WALMART') || 
                          platformUpper.includes('PARIS') || 
                          agendaUpper.includes('MERCADO') || 
                          agendaUpper.includes('FALABELLA') || 
                          agendaUpper.includes('FLEX') || 
                          agendaUpper.includes('CENTRO DE ENVIOS') || 
                          operadorUpper.includes('MERCADOLIBRE') || 
                          operadorUpper.includes('FALABELLA');

    const surchargeMarketplace = isMarketplace ? (cfg.pick_pack_rules.surcharge_marketplace_collect || 100) : 0;
    const unitPickPackTotal = basePickPackRate + surchargeSku + surchargeUnits + surchargeMarketplace;

    // Reglas de Despacho (Punto D)
    const shippingMethodUpper = String(ord.shipping_method || '').toUpperCase();
    const cityNorm = String(ord.shipping_city || '').toLowerCase().trim();
    const isColina = cityNorm.includes('colina') || String(ord.shipping_address || '').toLowerCase().includes('colina');

    // Envíos Flex cobran $3.200 + IVA a TODO destino (Confirmado por el usuario)
    const isFlex = agendaUpper.includes('FLEX') || 
                   shippingMethodUpper.includes('FLEX') || 
                   (platformUpper.includes('MERCADO') && shippingMethodUpper.includes('FLEX'));

    // Operadores Stocka Express RM: STOCKA X, ALPHA, STK, RM
    const isStkRmCourier = ['STOCKA X', 'ALPHA', 'STK', 'RM', 'STOCKA'].some(c => 
      operadorUpper.includes(c) || agendaUpper === c
    );

    let deliveryType = 'OTHER';
    let shippingFreight = 0;

    if (String(ord.categoria_entrega || '').toUpperCase() === 'RETIRO') {
      deliveryType = 'RETIRO';
      shippingFreight = 0;
    } else if (isFlex) {
      deliveryType = 'FLEX';
      shippingFreight = 3200; // Flex cobra 3200 a todo destino
    } else if (isStkRmCourier) {
      if (isColina) {
        deliveryType = 'COLINA';
        shippingFreight = 3490; // Colina 3490 + IVA
      } else {
        deliveryType = 'RM_STK';
        shippingFreight = 3200; // RM Stocka 3200 + IVA
      }
    } else {
      // Operadores tradicionales (STARKEN, CHILEXPRESS, BLUEXPRESS, ENVIAME) van a $0 en fulfillment
      deliveryType = 'ENVIAME_REGION';
      shippingFreight = 0;
    }

    // Sobreescritura manual por pedido si el admin ya lo editó
    const manualOrderOverride = customOverrides.orders && customOverrides.orders[ord.id];
    const finalBaseRate = manualOrderOverride?.baseRate !== undefined ? manualOrderOverride.baseRate : basePickPackRate;
    const finalSurchargeSku = manualOrderOverride?.surchargeSku !== undefined ? manualOrderOverride.surchargeSku : surchargeSku;
    const finalSurchargeUnits = manualOrderOverride?.surchargeUnits !== undefined ? manualOrderOverride.surchargeUnits : surchargeUnits;
    const finalSurchargeMarketplace = manualOrderOverride?.surchargeMarketplace !== undefined ? manualOrderOverride.surchargeMarketplace : surchargeMarketplace;
    const finalShippingFreight = manualOrderOverride?.shippingFreight !== undefined ? manualOrderOverride.shippingFreight : shippingFreight;
    const finalDeliveryType = manualOrderOverride?.deliveryType || deliveryType;

    const finalPickPackTotal = finalBaseRate + finalSurchargeSku + finalSurchargeUnits + finalSurchargeMarketplace;
    const finalOrderTotal = finalPickPackTotal + finalShippingFreight;

    return {
      id: ord.id,
      rowNumber: idx + 1,
      orderNumber: ord.external_order_number || ord.id.slice(0, 8),
      date: ord.created_at ? ord.created_at.slice(0, 10) : '—',
      destination: ord.shipping_city || 'Santiago',
      isColina,
      isFlex,
      skuCount,
      unitsCount,
      isMarketplace,
      categoriaEntrega: ord.categoria_entrega || 'DISTRIBUCIÓN',
      operador: (ord.operador && String(ord.operador).trim() !== '' && String(ord.operador).trim() !== '—') ? String(ord.operador).trim() : '',
      agenda: (ord.agenda && String(ord.agenda).trim() !== '' && String(ord.agenda).trim() !== '—') ? String(ord.agenda).trim() : '',
      shippingMethod: (ord.shipping_method && String(ord.shipping_method).trim() !== '' && String(ord.shipping_method).trim() !== '—') ? String(ord.shipping_method).trim() : '',
      deliveryType: finalDeliveryType,
      baseRate: finalBaseRate,
      surchargeSku: finalSurchargeSku,
      surchargeUnits: finalSurchargeUnits,
      surchargeMarketplace: finalSurchargeMarketplace,
      pickPackTotal: finalPickPackTotal,
      shippingFreight: finalShippingFreight,
      orderTotal: finalOrderTotal,
      isExcluded: !!isExcluded,
      estadoWms: ord.estado_wms || 'Completado'
    };
  });

  billingState.orders = processedOrders;

  // 9. Calcular Totales de Pedidos y Envíos
  const billableOrders = processedOrders.filter(o => !o.isExcluded);
  const totalPickPackNet = billableOrders.reduce((acc, o) => acc + o.pickPackTotal, 0);

  const rmFlexOrders = billableOrders.filter(o => o.deliveryType === 'RM_STK' || o.deliveryType === 'COLINA' || o.deliveryType === 'FLEX');
  const totalRmFlexNet = rmFlexOrders.reduce((acc, o) => acc + o.shippingFreight, 0);

  const enviameOrders = billableOrders.filter(o => o.deliveryType === 'ENVIAME_REGION');

  // 9.1 Conteo global de artículos y ranking de productos más vendidos
  const productMap = {};
  let totalUnitsSold = 0;

  billableOrders.forEach(ord => {
    const rawOrd = ordersList.find(o => o.id === ord.id) || ord;
    let items = [];

    if (rawOrd.order_items && Array.isArray(rawOrd.order_items) && rawOrd.order_items.length > 0) {
      items = rawOrd.order_items.map(oi => ({
        sku: (oi.products?.sku || 'S/SKU').trim(),
        name: (oi.products?.name || oi.products?.sku || 'Producto sin nombre').trim(),
        quantity: parseInt(oi.quantity, 10) || 1
      }));
    } else if (rawOrd.raw_shopify_data?.line_items && Array.isArray(rawOrd.raw_shopify_data.line_items)) {
      items = rawOrd.raw_shopify_data.line_items.map(li => ({
        sku: (li.sku || 'S/SKU').trim(),
        name: (li.name || li.title || 'Producto Shopify').trim(),
        quantity: parseInt(li.quantity, 10) || 1
      }));
    } else if (rawOrd.raw_woocommerce_data?.line_items && Array.isArray(rawOrd.raw_woocommerce_data.line_items)) {
      items = rawOrd.raw_woocommerce_data.line_items.map(li => ({
        sku: (li.sku || 'S/SKU').trim(),
        name: (li.name || 'Producto WooCommerce').trim(),
        quantity: parseInt(li.quantity, 10) || 1
      }));
    } else if (rawOrd.raw_meli_data) {
      const meliOrders = Array.isArray(rawOrd.raw_meli_data) ? rawOrd.raw_meli_data : [rawOrd.raw_meli_data];
      meliOrders.forEach(mo => {
        if (mo && Array.isArray(mo.order_items)) {
          mo.order_items.forEach(mi => {
            items.push({
              sku: (mi.item?.seller_sku || 'S/SKU').trim(),
              name: (mi.item?.title || 'Producto MercadoLibre').trim(),
              quantity: parseInt(mi.quantity, 10) || 1
            });
          });
        }
      });
    }

    if (items.length === 0) {
      items.push({
        sku: (rawOrd.sku || 'S/SKU').trim(),
        name: (rawOrd.item || rawOrd.sku || 'Producto general').trim(),
        quantity: parseInt(rawOrd.cantidad, 10) || ord.unitsCount || 1
      });
    }

    items.forEach(it => {
      const key = it.sku && it.sku !== 'S/SKU' ? it.sku : (it.name || 'Desconocido');
      totalUnitsSold += it.quantity;
      if (!productMap[key]) {
        productMap[key] = {
          sku: it.sku || 'S/SKU',
          name: it.name || 'Producto',
          quantity: 0
        };
      }
      productMap[key].quantity += it.quantity;
      if (it.name && it.name !== 'Producto sin nombre' && productMap[key].name === 'Producto sin nombre') {
        productMap[key].name = it.name;
      }
    });
  });

  const sortedProducts = Object.values(productMap)
    .sort((a, b) => b.quantity - a.quantity)
    .map((p, idx) => ({
      rank: idx + 1,
      sku: p.sku,
      name: p.name,
      quantity: p.quantity,
      sharePct: totalUnitsSold > 0 ? parseFloat(((p.quantity / totalUnitsSold) * 100).toFixed(1)) : 0
    }));

  billingState.productsStats = {
    totalUnits: totalUnitsSold,
    avgUnitsPerOrder: billableOrders.length > 0 ? parseFloat((totalUnitsSold / billableOrders.length).toFixed(2)) : 0,
    topProducts: sortedProducts.slice(0, 10),
    allProducts: sortedProducts
  };

  // 10. Cálculo de Almacenamiento y Descuento por Volumen (> 10 m3)
  const baseStorageM3Rate = activeRange.storage_m3; // ej: $48.900
  const grossStorage = billingState.volumeM3 * baseStorageM3Rate;

  let storageDiscountPct = 0;
  let storageDiscountLabel = "Sin descuento (< 10 m³)";
  if (cfg.storage_discounts && cfg.storage_discounts.length > 0) {
    for (const d of cfg.storage_discounts) {
      if (billingState.volumeM3 >= d.min && billingState.volumeM3 <= d.max) {
        storageDiscountPct = d.discount_pct;
        storageDiscountLabel = `${d.discount_pct}% dcto por volumen (${d.min} - ${d.max === 999999 ? '+60' : d.max} m³)`;
        break;
      }
    }
  }
  const storageDiscountAmount = Math.round(grossStorage * (storageDiscountPct / 100));
  const netStorageCost = Math.round(grossStorage - storageDiscountAmount);

  // 11. Cálculo de Costo Fijo Mensual (Punto E)
  const minOrdersExemption = cfg.fixed_service_fee.exemption_min_orders || 75;
  const minVolumeExemption = cfg.fixed_service_fee.exemption_min_volume || 1.5;

  let fixedFeeUF = 0;
  let fixedFeeCLP = 0;
  let fixedFeeReason = "";

  if (billableOrders.length >= minOrdersExemption || billingState.volumeM3 >= minVolumeExemption) {
    fixedFeeUF = 0;
    fixedFeeCLP = 0;
    fixedFeeReason = `Exento ($0) por alcanzar ${billableOrders.length >= minOrdersExemption ? '≥ 75 pedidos' : '≥ 1.5 m³'}`;
  } else if (billingState.volumeM3 < 1.0 && billableOrders.length < 50) {
    fixedFeeUF = cfg.fixed_service_fee.tier1_fee_uf || 1.5;
    fixedFeeCLP = Math.round(fixedFeeUF * billingState.ufValue);
    fixedFeeReason = `Costo fijo 1.5 UF (${formatCLP(fixedFeeCLP)}) por operar con < 50 pedidos y < 1 m³`;
  } else {
    fixedFeeUF = cfg.fixed_service_fee.tier2_fee_uf || 0.9;
    fixedFeeCLP = Math.round(fixedFeeUF * billingState.ufValue);
    fixedFeeReason = `Costo fijo 0.9 UF (${formatCLP(fixedFeeCLP)}) por operar con < 75 pedidos y < 1.5 m³`;
  }

  // Permitir override del costo fijo si el admin lo modificó
  if (customOverrides.fixedFeeCLP !== undefined) {
    fixedFeeCLP = Math.round(customOverrides.fixedFeeCLP);
    fixedFeeUF = billingState.ufValue > 0 ? parseFloat((fixedFeeCLP / billingState.ufValue).toFixed(2)) : 0;
  }

  // 12. Insumos y Ajustes Adicionales (Punto F)
  billingState.supplies = customOverrides.supplies || [
    { id: 'box_s', name: 'Insumos: cajas de despacho a Regiones', unit: 'gl.', qty: enviameOrders.length > 0 ? 1 : 0, unitPrice: 450, total: enviameOrders.length > 0 ? 450 : 0 }
  ];
  const totalSuppliesNet = billingState.supplies.reduce((acc, s) => acc + (s.total || 0), 0);

  billingState.adjustments = customOverrides.adjustments || [];
  const totalAdjustmentsNet = billingState.adjustments.reduce((acc, a) => acc + (a.amount || 0), 0);

  // 13. Totales Finales Consolidados
  const totalNet = Math.round(netStorageCost + totalPickPackNet + totalRmFlexNet + inboundTotalNet + fixedFeeCLP + totalSuppliesNet + totalAdjustmentsNet);
  const totalIVA = Math.round(totalNet * 0.19);
  const totalGross = totalNet + totalIVA;

  billingState.totals = {
    ordersCount: totalOrdersCount,
    billableOrdersCount: billableOrders.length,
    storageGross: Math.round(grossStorage),
    storageDiscountPct,
    storageDiscountLabel,
    storageDiscountAmount,
    storageNet: netStorageCost,
    pickPackNet: totalPickPackNet,
    shippingRmFlexCount: rmFlexOrders.length,
    shippingRmFlexNet: totalRmFlexNet,
    shippingEnviameCount: enviameOrders.length,
    shippingEnviameNet: 0,
    inboundTotalUF: parseFloat(inboundTotalUF.toFixed(4)),
    inboundNet: inboundTotalNet,
    fixedFeeUF,
    fixedFeeNet: fixedFeeCLP,
    fixedFeeReason,
    suppliesNet: totalSuppliesNet,
    adjustmentsNet: totalAdjustmentsNet,
    totalNet,
    iva: totalIVA,
    totalGross,
    totalToPay: totalGross
  };

  billingState.isLoading = false;
  return billingState;
}

// --- GENERADOR DEL DESGLOSE ESTÉTICO OFICIAL STOCKA (#5f06fa) ---
export function renderStockaDesgloseHTML() {
  const b = billingState;
  const t = b.totals;
  const c = b.commerceInfo;

  const today = new Date();
  const emisionStr = today.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  
  // Vencimiento: 5 días corridos desde la emisión
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + 5);
  const vencimientoStr = dueDate.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return `
    <div class="stocka-desglose-paper" id="stocka-printable-invoice">
      <!-- Barra Superior con Logo y Badges -->
      <div class="stocka-main-header">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <img src="${STOCKA_BRAND.logoUrl}" alt="STOCKA" style="height: 44px; width: auto; object-fit: contain;">
        </div>
        
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <span style="background: rgba(95, 6, 250, 0.08); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.25); padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.85rem;">
            ${b.currentPeriodName}
          </span>
          <span style="background: #f8fafc; color: #475569; border: 1px solid #cbd5e1; padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.85rem;">
            Plazo de Pago: 5 días corridos (${vencimientoStr})
          </span>
        </div>
      </div>

      <!-- Tarjetas de Información: Emisor y Cliente -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
        <!-- Tarjeta Emisor (STOCKA SPA) -->
        <div class="stocka-entity-card">
          <div class="stocka-entity-card-header">
            STOCKA SPA
          </div>
          <div class="stocka-entity-body">
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Rut:</span>
              <span style="font-weight: 700; color: #0f172a;">${STOCKA_BRAND.rut}</span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Giro:</span>
              <span style="font-weight: 600; color: #334155;">${STOCKA_BRAND.giro}</span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Dirección:</span>
              <span style="font-weight: 600; color: #334155;">${STOCKA_BRAND.direccion}</span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Sitio Web:</span>
              <span style="font-weight: 700; color: #5f06fa;"><a href="https://www.stocka.cl" target="_blank" style="color: #5f06fa; text-decoration: underline;">${STOCKA_BRAND.sitioWeb}</a></span>
            </div>
          </div>
        </div>

        <!-- Tarjeta Cliente (Comercio) -->
        <div class="stocka-entity-card">
          <div class="stocka-entity-card-header">
            Razón Social: ${c.razonSocial || c.nombre}
          </div>
          <div class="stocka-entity-body">
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Rut:</span>
              <span style="font-weight: 700; color: #0f172a;">${c.rut || '—'}</span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Cód. Comercio:</span>
              <span style="font-weight: 800; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 1px 6px; border-radius: 4px;">${c.sigla || '—'}</span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Fecha Emisión:</span>
              <span style="font-weight: 700; color: #0f172a;">${emisionStr}</span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Plazo de Pago:</span>
              <span style="font-weight: 700; color: #0f172a;">${vencimientoStr}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 4 Cartas Métricas en una misma línea con diseño sobrio y uniforme -->
      <div class="stocka-metric-row">
        <div class="stocka-metric-card">
          <div class="stocka-metric-title">Pedidos Procesados</div>
          <div class="stocka-metric-value">${t.billableOrdersCount} <span style="font-size: 0.8rem; font-weight: 600; color: #64748b;">ud.</span></div>
          <div class="stocka-metric-sub">Base: ${formatCLP(b.activeRange?.pick_pack_base || 1250)}</div>
        </div>

        <div class="stocka-metric-card">
          <div class="stocka-metric-title">Almacenamiento Mes</div>
          <div class="stocka-metric-value">${formatDec(b.volumeM3, 2)} <span style="font-size: 0.8rem; font-weight: 600; color: #64748b;">m³</span></div>
          <div class="stocka-metric-sub">Tarifa: ${formatCLP(b.activeRange?.storage_m3 || 48900)} / m³</div>
        </div>

        <div class="stocka-metric-card">
          <div class="stocka-metric-title">UF del Periodo</div>
          <div class="stocka-metric-value">${formatCLP(b.ufValue)}</div>
          <div class="stocka-metric-sub">Día ${b.ufDate || '01/08/2026'}</div>
        </div>

        <div class="stocka-metric-card">
          <div class="stocka-metric-title">Costo Fijo Mensual</div>
          <div class="stocka-metric-value">${t.fixedFeeUF > 0 ? `${formatDec(t.fixedFeeUF, 1)} UF` : 'EXENTO'}</div>
          <div class="stocka-metric-sub">${t.fixedFeeUF > 0 ? formatCLP(t.fixedFeeNet) : '$0'}</div>
        </div>
      </div>

      <!-- Hero Card: Total a Pagar y Resumen Fiscal -->
      <div class="stocka-banner-hero">
        <div style="display: flex; gap: 2rem; align-items: center; flex-wrap: wrap;">
          <div>
            <div style="font-size: 0.725rem; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85; font-weight: 600;">Subtotal Neto</div>
            <div style="font-size: 1.15rem; font-weight: 800;">${formatCLP(t.totalNet)}</div>
          </div>
          <div style="border-left: 1px solid rgba(255,255,255,0.25); padding-left: 1.5rem;">
            <div style="font-size: 0.725rem; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85; font-weight: 600;">IVA (19%)</div>
            <div style="font-size: 1.15rem; font-weight: 800;">${formatCLP(t.iva)}</div>
          </div>
          <div style="border-left: 1px solid rgba(255,255,255,0.25); padding-left: 1.5rem;">
            <div style="font-size: 0.725rem; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85; font-weight: 600;">Descuentos / Ajustes</div>
            <div style="font-size: 1.15rem; font-weight: 800;">${t.adjustmentsNet ? formatCLP(t.adjustmentsNet) : '$0'}</div>
          </div>
        </div>

        <div style="text-align: right;">
          <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; opacity: 0.9;">TOTAL A FACTURAR / PAGAR</div>
          <div style="font-size: 2.1rem; font-weight: 900; line-height: 1.1;">${formatCLP(t.totalToPay)}</div>
        </div>
      </div>

      <!-- Tabla Oficial Itemizada (Sin Iconos) -->
      <div style="margin-top: 1rem;">
        <table class="stocka-table-official">
          <thead>
            <tr>
              <th style="text-align: left;">ITEM</th>
              <th style="text-align: center; width: 65px;">UD.</th>
              <th style="text-align: center; width: 75px;">CANT</th>
              <th style="text-align: right; width: 125px;">NETO</th>
              <th style="text-align: right; width: 110px;">IVA</th>
              <th style="text-align: right; width: 135px;">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <!-- 1. Almacenamiento -->
            <tr>
              <td>
                <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Servicio de almacenamiento</div>
                <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                  ${formatDec(b.volumeM3, 2)} m³ @ ${formatCLP(b.activeRange?.storage_m3 || 48900)} / m³ ${t.storageDiscountPct > 0 ? `(${t.storageDiscountLabel})` : ''}
                </div>
              </td>
              <td style="text-align: center; font-weight: 600; color: #64748b;">m³</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${formatDec(b.volumeM3, 2)}</td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.storageNet)}</td>
              <td style="text-align: right; color: #64748b;">${formatCLP(t.storageNet * 0.19)}</td>
              <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP(t.storageNet * 1.19)}</td>
            </tr>

            <!-- 2. Preparación de Pedidos -->
            <tr>
              <td>
                <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Servicio de preparación de pedidos</div>
                <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                  Pick & Pack base ${formatCLP(b.activeRange?.pick_pack_base || 1250)} + recargos por SKUs adicionales y unidades
                </div>
              </td>
              <td style="text-align: center; font-weight: 600; color: #64748b;">ud.</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${t.billableOrdersCount}</td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.pickPackNet)}</td>
              <td style="text-align: right; color: #64748b;">${formatCLP(t.pickPackNet * 0.19)}</td>
              <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP(t.pickPackNet * 1.19)}</td>
            </tr>

            <!-- 3. Despachos RM / Flex -->
            <tr>
              <td>
                <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Servicio de despachos RM/Flex</div>
                <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                  Stocka Express $3.200 + IVA (Colina $3.490 + IVA / Flex $3.200 + IVA)
                </div>
              </td>
              <td style="text-align: center; font-weight: 600; color: #64748b;">ud.</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${t.shippingRmFlexCount}</td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.shippingRmFlexNet)}</td>
              <td style="text-align: right; color: #64748b;">${formatCLP(t.shippingRmFlexNet * 0.19)}</td>
              <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP(t.shippingRmFlexNet * 1.19)}</td>
            </tr>

            <!-- 4. Despachos Mediante Envíame -->
            <tr>
              <td>
                <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Despachos procesados mediante Enviame</div>
                <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                  Fletes regionales facturados en la liquidación mensual de Envíame
                </div>
              </td>
              <td style="text-align: center; font-weight: 600; color: #64748b;">ud.</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${t.shippingEnviameCount}</td>
              <td style="text-align: right; color: #94a3b8; font-weight: 700;">—</td>
              <td style="text-align: right; color: #94a3b8; font-weight: 700;">—</td>
              <td style="text-align: right; color: #94a3b8; font-weight: 700;">—</td>
            </tr>

            <!-- 4.1 Recepción e Ingreso de Stock (si aplica) -->
            ${t.inboundNet > 0 ? `
              <tr>
                <td>
                  <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Servicio de recepción e ingreso de stock</div>
                  <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                    ${(b.inboundDeclarations || []).length} ingreso(s) de stock procesado(s) (${(b.inboundDeclarations || []).map(d => '#' + d.id.substring(0, 8).toUpperCase()).join(', ')}) @ ${formatCLP(b.ufValue)} / UF
                  </div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">UF</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">${formatDec(t.inboundTotalUF || 0, 4)}</td>
                <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.inboundNet)}</td>
                <td style="text-align: right; color: #64748b;">${formatCLP(t.inboundNet * 0.19)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP(t.inboundNet * 1.19)}</td>
              </tr>
            ` : ''}

            <!-- 5. Insumos -->
            ${b.supplies.filter(s => (s.qty || 0) > 0).map(s => `
              <tr>
                <td>
                  <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">${s.name}</div>
                  <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">Insumos y material de empaque</div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">${s.unit || 'ud.'}</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">${s.qty}</td>
                <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(s.total)}</td>
                <td style="text-align: right; color: #64748b;">${formatCLP((s.total || 0) * 0.19)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP((s.total || 0) * 1.19)}</td>
              </tr>
            `).join('')}

            <!-- 6. Costo Fijo Mensual -->
            <tr>
              <td>
                <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Costo Fijo Mensual Fulfillment ${t.fixedFeeUF > 0 ? (t.fixedFeeUF === 1.5 ? '- Rango 1' : '- Rango 2') : '(Exento)'}</div>
                <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">${t.fixedFeeReason}</div>
              </td>
              <td style="text-align: center; font-weight: 600; color: #64748b;">UF</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${t.fixedFeeUF > 0 ? formatDec(t.fixedFeeUF, 1) : '0'}</td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.fixedFeeNet)}</td>
              <td style="text-align: right; color: #64748b;">${formatCLP(t.fixedFeeNet * 0.19)}</td>
              <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP(t.fixedFeeNet * 1.19)}</td>
            </tr>

            <!-- 7. Ajustes Comerciales si existen -->
            ${b.adjustments.map(a => `
              <tr>
                <td>
                  <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">${a.concept || 'Ajuste comercial'}</div>
                  <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">${a.notes || ''}</div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">gl.</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">1</td>
                <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(a.amount)}</td>
                <td style="text-align: right; color: #64748b;">${formatCLP((a.amount || 0) * 0.19)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP((a.amount || 0) * 1.19)}</td>
              </tr>
            `).join('')}

            <!-- Fila de Totales Finales -->
            <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #5f06fa;">
              <td colspan="3" style="text-align: right; padding-right: 1.5rem; font-size: 0.9rem; color: #0f172a;">
                TOTALES DEL PERIODO:
              </td>
              <td style="text-align: right; color: #5f06fa; font-size: 0.95rem;">${formatCLP(t.totalNet)}</td>
              <td style="text-align: right; color: #5f06fa; font-size: 0.95rem;">${formatCLP(t.iva)}</td>
              <td style="text-align: right; color: #5f06fa; font-size: 1.05rem; font-weight: 900;">${formatCLP(t.totalGross)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cuadro de Pago e Información Bancaria Sincero y Corporativo -->
      <div style="margin-top: 1.75rem; padding: 1rem 1.25rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <strong style="color: #0f172a; font-size: 0.85rem; display: block; margin-bottom: 0.25rem;">Datos para Transferencia Electrónica (Banco Santander):</strong>
          <span style="font-size: 0.8rem; color: #475569;">Cuenta Corriente N° <strong>88-7524557-3</strong> | STOCKA SPA | RUT: <strong>77.524.557-3</strong> | Correo: <strong>pagos@stocka.cl</strong></span>
        </div>
        <div style="text-align: right;">
          <span style="background: #ffffff; color: #5f06fa; border: 1px solid #cbd5e1; padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">
            Documento Oficial • STOCKA WMS
          </span>
        </div>
      </div>
    </div>
  `;
}

// --- EXPORTACIÓN EXCEL (.xlsx) CON SHEETJS ---
export function exportBillingToExcel() {
  if (typeof XLSX === 'undefined') {
    Swal.fire('Error', 'Librería XLSX no disponible para la exportación.', 'error');
    return;
  }

  const b = billingState;
  const t = b.totals;
  const c = b.commerceInfo;

  const wb = XLSX.utils.book_new();

  // Pestaña 1: Resumen Desglose de Facturación
  const summaryData = [
    ["STOCKA SPA", "", "Razón Social:", c.razonSocial],
    ["RUT: 77.524.557-3", "", "RUT Cliente:", c.rut],
    ["ALMACENAMIENTO Y FULFILLMENT", "", "Cód. Comercio:", c.sigla],
    ["Campo de Deportes 405, Ñuñoa", "", "Periodo:", b.currentPeriodName],
    ["www.stocka.cl", "", "UF Referencia:", b.ufValue],
    [],
    ["DESGLOSE MENSUAL DE SERVICIOS DE FULFILLMENT"],
    ["ITEM", "UNIDAD", "CANTIDAD", "NETO ($)", "IVA ($)", "TOTAL ($)"],
    [
      "Servicio de almacenamiento",
      "m3",
      b.volumeM3,
      t.storageNet,
      Math.round(t.storageNet * 0.19),
      Math.round(t.storageNet * 1.19)
    ],
    [
      "Servicio de preparación de pedidos",
      "ud.",
      t.billableOrdersCount,
      t.pickPackNet,
      Math.round(t.pickPackNet * 0.19),
      Math.round(t.pickPackNet * 1.19)
    ],
    [
      "Servicio de despachos RM/Flex",
      "ud.",
      t.shippingRmFlexCount,
      t.shippingRmFlexNet,
      Math.round(t.shippingRmFlexNet * 0.19),
      Math.round(t.shippingRmFlexNet * 1.19)
    ],
    [
      "Despachos procesados mediante Enviame",
      "ud.",
      t.shippingEnviameCount,
      0,
      0,
      0
    ]
  ];

  // Recepción de Stock si aplica
  if (t.inboundNet > 0) {
    summaryData.push([
      `Servicio de recepción e ingreso de stock (${(b.inboundDeclarations || []).length} declaraciones)`,
      "UF",
      t.inboundTotalUF || 0,
      t.inboundNet,
      Math.round(t.inboundNet * 0.19),
      Math.round(t.inboundNet * 1.19)
    ]);
  }

  // Agregar insumos
  b.supplies.forEach(s => {
    if ((s.qty || 0) > 0) {
      summaryData.push([
        s.name,
        s.unit || 'ud.',
        s.qty,
        s.total,
        Math.round(s.total * 0.19),
        Math.round(s.total * 1.19)
      ]);
    }
  });

  // Costo Fijo
  summaryData.push([
    `Costo Fijo Mensual Fulfillment (${t.fixedFeeReason})`,
    "UF",
    t.fixedFeeUF,
    t.fixedFeeNet,
    Math.round(t.fixedFeeNet * 0.19),
    Math.round(t.fixedFeeNet * 1.19)
  ]);

  // Ajustes
  b.adjustments.forEach(a => {
    summaryData.push([
      a.concept || 'Ajuste comercial',
      "gl.",
      1,
      a.amount,
      Math.round(a.amount * 0.19),
      Math.round(a.amount * 1.19)
    ]);
  });

  // Totales
  summaryData.push([]);
  summaryData.push(["SUBTOTAL NETO:", "", "", t.totalNet]);
  summaryData.push(["IVA (19%):", "", "", t.iva]);
  summaryData.push(["TOTAL A FACTURAR / PAGAR:", "", "", t.totalGross]);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Desglose Mensual");

  // Pestaña 2: Auditoría Detalle Pedido por Pedido
  const ordersHeaders = [
    "N°", "ID Pedido", "N° Pedido Ext", "Fecha", "Destino / Comuna", "Tipo Entrega",
    "SKU", "Unidades", "Marketplace?", "Tarifa Base Prep ($)", "Recargo SKU ($)",
    "Recargo Unidades ($)", "Recargo Market ($)", "Total Pick & Pack ($)",
    "Costo Despacho ($)", "Total Pedido ($)", "Estado WMS", "Incluido en Factura"
  ];

  const ordersRows = b.orders.map(o => [
    o.rowNumber,
    o.id,
    o.orderNumber,
    o.date,
    o.destination,
    o.deliveryType,
    o.skuCount,
    o.unitsCount,
    o.isMarketplace ? 'SI' : 'NO',
    o.baseRate,
    o.surchargeSku,
    o.surchargeUnits,
    o.surchargeMarketplace,
    o.pickPackTotal,
    o.shippingFreight,
    o.orderTotal,
    o.estadoWms,
    o.isExcluded ? 'NO' : 'SI'
  ]);

  const wsOrders = XLSX.utils.aoa_to_sheet([ordersHeaders, ...ordersRows]);
  XLSX.utils.book_append_sheet(wb, wsOrders, "Auditoría Pedidos");

  // Pestaña 3: Top Productos Más Vendidos
  if (b.productsStats?.allProducts && b.productsStats.allProducts.length > 0) {
    const productsData = [
      ["TOP PRODUCTOS MÁS VENDIDOS - PERIODO", b.currentPeriodName, "COMERCIO:", b.currentCommerce],
      ["Total Artículos Vendidos:", b.productsStats.totalUnits, "Promedio por Pedido:", b.productsStats.avgUnitsPerOrder],
      [],
      ["RANKING", "SKU", "NOMBRE DEL PRODUCTO", "UNIDADES VENDIDAS", "% PARTICIPACIÓN"]
    ];
    b.productsStats.allProducts.forEach(p => {
      productsData.push([p.rank, p.sku, p.name, p.quantity, `${p.sharePct}%`]);
    });
    const wsProducts = XLSX.utils.aoa_to_sheet(productsData);
    XLSX.utils.book_append_sheet(wb, wsProducts, "Top Productos");
  }

  // Pestaña 4: Declaraciones de Ingreso de Stock (si aplican)
  if (b.inboundDeclarations && b.inboundDeclarations.length > 0) {
    const inboundsData = [
      ["DECLARACIONES DE INGRESO DE STOCK", b.currentPeriodName, "COMERCIO:", b.currentCommerce],
      ["UF Referencia:", b.ufValue, "Total Costo Neto ($):", t.inboundNet],
      [],
      ["CÓDIGO ING", "TÍTULO", "UNIDADES RECIBIDAS", "VOLUMEN (m³)", "COSTO REAL/EST (UF)", "COSTO NETO (CLP)", "ESTADO"]
    ];
    b.inboundDeclarations.forEach(d => {
      inboundsData.push([
        `#ING-${d.id.substring(0, 8).toUpperCase()}`,
        d.title,
        d.quantity_received || d.quantity_declared || 0,
        d.volume_confirmed || d.volume_declared || 0,
        d.costUF,
        d.costCLP,
        d.billing_status || 'Facturado'
      ]);
    });
    const wsInbounds = XLSX.utils.aoa_to_sheet(inboundsData);
    XLSX.utils.book_append_sheet(wb, wsInbounds, "Ingresos Stock");
  }

  const fileName = `Facturacion_Stocka_${c.sigla || 'COMERCIO'}_${b.currentPeriodName.replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// --- DESCARGA A PDF (HTML2PDF) ---
export function downloadBillingPdf() {
  const element = document.getElementById('stocka-printable-invoice');
  if (!element) {
    Swal.fire('Error', 'No se encontró el desglose para exportar.', 'error');
    return;
  }

  if (typeof html2pdf === 'undefined') {
    window.print();
    return;
  }

  const opt = {
    margin: [8, 8, 8, 8],
    filename: `Desglose_Stocka_${billingState.commerceInfo.sigla || 'COMERCIO'}_${billingState.currentPeriodName.replace(/\s+/g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  Swal.fire({
    title: 'Generando PDF Oficial...',
    text: 'Por favor espera un momento mientras se renderiza el documento...',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  html2pdf().set(opt).from(element).save().then(() => {
    Swal.close();
  }).catch(err => {
    console.error('Error generando PDF:', err);
    Swal.fire('Error', 'No se pudo generar el PDF: ' + err.message, 'error');
  });
}

// --- GUARDAR Y SINCRONIZAR EN BILLING_RECORDS ---
export async function saveBillingRecordToSupabase() {
  const b = billingState;
  const t = b.totals;

  if (!b.currentPeriodId || !b.currentCommerce) {
    Swal.fire('Atención', 'No hay un periodo o comercio activo seleccionado.', 'warning');
    return false;
  }

  try {
    Swal.fire({
      title: 'Guardando Facturación...',
      text: 'Actualizando registros y congelando desglose...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const payload = {
      total_fulfillment: t.totalToPay,
      desglose_fulfillment: 'Creado',
      updated_at: new Date().toISOString()
    };

    const fullSnapshot = {
      periodId: b.currentPeriodId,
      periodName: b.currentPeriodName,
      comercio: b.currentCommerce,
      commerceInfo: b.commerceInfo,
      volumeM3: b.volumeM3,
      volumeDailyAverage: b.volumeDailyAverage,
      volumeDaysLogged: b.volumeDaysLogged,
      dailyStorageLogs: b.dailyStorageLogs,
      volumeStats: b.volumeStats,
      productsStats: b.productsStats,
      inboundDeclarations: b.inboundDeclarations,
      ufValue: b.ufValue,
      ufDate: b.ufDate,
      activeRange: b.activeRange,
      totals: b.totals,
      orders: b.orders,
      supplies: b.supplies,
      adjustments: b.adjustments,
      generatedAt: new Date().toISOString()
    };

    // 1. Guardar en localStorage inmediatamente para persistencia rápida
    const storageKey = `stocka_fulfillment_details_${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(fullSnapshot));
    } catch (e) {}

    // 2. Intentar actualizar en Supabase billing_records
    let updateSuccess = false;
    try {
      const { error: fullErr } = await supabase
        .from('billing_records')
        .update({
          ...payload,
          fulfillment_details: fullSnapshot,
          fulfillment_volume: b.volumeM3,
          fulfillment_orders_count: t.billableOrdersCount,
          fulfillment_uf_value: b.ufValue,
          fulfillment_calculated_at: new Date().toISOString()
        })
        .eq('period_id', b.currentPeriodId)
        .eq('comercio', b.currentCommerce);

      if (!fullErr) {
        updateSuccess = true;
      } else {
        console.warn('Columnas extendidas aún no disponibles en Supabase, aplicando campos base:', fullErr.message);
      }
    } catch (e) {}

    if (!updateSuccess) {
      const { error: baseErr } = await supabase
        .from('billing_records')
        .update(payload)
        .eq('period_id', b.currentPeriodId)
        .eq('comercio', b.currentCommerce);

      if (baseErr) throw baseErr;
    }

    billingState.isSaved = true;
    Swal.fire('¡Facturación Guardada!', `Se actualizó el monto total a ${formatCLP(t.totalToPay)} y el estado a "Creado" para ${b.currentCommerce}.`, 'success');

    if (typeof window.loadBillingPeriods === 'function') {
      window.loadBillingPeriods();
    }

    return true;
  } catch (err) {
    console.error('Error guardando registro de facturación:', err);
    Swal.fire('Error', 'No se pudo guardar: ' + err.message, 'error');
    return false;
  }
}

// --- RENDERIZADOR DE ANALÍTICA Y GRÁFICOS (CHART.JS) TOTALMENTE MEJORADO ---
export async function renderBillingAnalyticsCharts(targetContainerId = 'bg-analytics-container') {
  const container = document.getElementById(targetContainerId);
  if (!container) return;

  // Cargar Chart.js dinámicamente si no existe
  if (typeof Chart === 'undefined') {
    if (typeof window.ensureChartJsLoaded === 'function') {
      await window.ensureChartJsLoaded();
    } else {
      await new Promise(resolve => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }
  }

  const b = billingState;
  const t = b.totals;
  const orders = b.orders || [];

  // Cálculos analíticos clave
  const totalOrders = orders.length || 1;
  const avgCostPerOrder = Math.round(t.totalNet / totalOrders);
  const rmPct = ((t.shippingRmFlexCount / totalOrders) * 100).toFixed(1);
  const envPct = ((t.shippingEnviameCount / totalOrders) * 100).toFixed(1);
  const mktCount = orders.filter(o => o.isMarketplace).length;
  const mktPct = ((mktCount / totalOrders) * 100).toFixed(1);

  container.innerHTML = `
    <!-- Banner de Encabezado Analítico -->
    <div class="bg-analytics-hero">
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: #5f06fa; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; box-shadow: 0 4px 12px rgba(95, 6, 250, 0.3);">
          <i class="ri-line-chart-fill"></i>
        </div>
        <div>
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--color-text-main);">Dashboard Analítico del Periodo</h3>
          <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
            Métricas de rendimiento operativo, costos logísticos unitarios y comportamiento de envíos para <strong>${b.currentCommerce}</strong> (${b.currentPeriodName}).
          </p>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <span style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.8rem; font-weight: 700; color: var(--color-text-main); display: inline-flex; align-items: center; gap: 0.35rem;">
          <i class="ri-wallet-3-line" style="color: #5f06fa;"></i> Costo Promedio: ${formatCLP(avgCostPerOrder)} / pedido
        </span>
      </div>
    </div>

    <!-- 4 KPI Cards Ejecutivas en 1 Sola Línea con Estilo Uniforme y Sobrio -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">COSTO LOGÍSTICO UNITARIO</div>
        <div class="bg-kpi-value" style="color: #0f172a;">${formatCLP(avgCostPerOrder)}</div>
        <div class="bg-kpi-subtitle">Costo neto por pedido</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">DESPACHOS RM / FLEX</div>
        <div class="bg-kpi-value" style="color: #0f172a;">${rmPct}%</div>
        <div class="bg-kpi-subtitle">${t.shippingRmFlexCount} de ${totalOrders} pedidos locales</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">ENVÍOS A REGIONES</div>
        <div class="bg-kpi-value" style="color: #0f172a;">${envPct}%</div>
        <div class="bg-kpi-subtitle">${t.shippingEnviameCount} pedidos vía Envíame</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">PEDIDOS MARKETPLACE</div>
        <div class="bg-kpi-value" style="color: #0f172a;">${mktPct}%</div>
        <div class="bg-kpi-subtitle">${mktCount} pedidos marketplace</div>
      </div>
    </div>

    <!-- 4 Tarjetas de Almacenamiento Diario en 1 Sola Fila (Sobrio y Uniforme) -->
    <div style="margin-bottom: 0.5rem;">
      <h4 style="margin: 0 0 0.6rem 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 0.4rem;">
        <i class="ri-archive-line" style="color: #5f06fa;"></i> Métricas de Almacenamiento Diario
      </h4>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">VOLUMEN PROMEDIO DIARIO</div>
          <div class="bg-kpi-value" style="color: #0f172a;">${formatDec(b.volumeM3, 2)} <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">m³</span></div>
          <div class="bg-kpi-subtitle">Promedio mes calendario</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">DÍAS CON REGISTRO</div>
          <div class="bg-kpi-value" style="color: #0f172a;">${b.volumeDaysLogged} <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">días</span></div>
          <div class="bg-kpi-subtitle">Mediciones registradas</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">PICO MÁXIMO REGISTRADO</div>
          <div class="bg-kpi-value" style="color: #0f172a;">${formatDec(b.volumeStats?.maxDailyVolume || b.volumeM3, 2)} <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">m³</span></div>
          <div class="bg-kpi-subtitle">Mayor ocupación en el mes</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">VOLUMEN MÍNIMO REGISTRADO</div>
          <div class="bg-kpi-value" style="color: #0f172a;">${formatDec(b.volumeStats?.minDailyVolume || b.volumeM3, 2)} <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">m³</span></div>
          <div class="bg-kpi-subtitle">Menor ocupación en el mes</div>
        </div>
      </div>
    </div>

    <!-- Gráfico de Evolución de Almacenamiento Diario -->
    <div class="bg-chart-card" style="margin-bottom: 2rem;">
      <div class="bg-chart-header">
        <div>
          <h4 class="bg-chart-title" style="display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-line-chart-line" style="color: #5f06fa;"></i> Evolución del Volumen de Almacenamiento Diario (m³)
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">Comportamiento del cubicaje medido durante el mes facturado</span>
        </div>
        <div style="font-size: 0.8rem; font-weight: 700; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 0.3rem 0.6rem; border-radius: 6px;">
          Tarifa: ${formatCLP(b.activeRange?.storage_m3 || 48900)} / m³
        </div>
      </div>
      <div style="height: 250px; position: relative;">
        <canvas id="chart-storage-evolution"></canvas>
      </div>
    </div>

    <!-- Métricas de Artículos Vendidos y Despachados -->
    <div style="margin-bottom: 0.5rem;">
      <h4 style="margin: 0 0 0.6rem 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 0.4rem;">
        <i class="ri-shopping-bag-3-line" style="color: #5f06fa;"></i> Artículos Vendidos y Despachados
      </h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">TOTAL ARTÍCULOS VENDIDOS</div>
          <div class="bg-kpi-value" style="color: #0f172a;">${(b.productsStats?.totalUnits || 0).toLocaleString('es-CL')} <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">unidades</span></div>
          <div class="bg-kpi-subtitle">Unidades físicas procesadas</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">PROMEDIO POR PEDIDO</div>
          <div class="bg-kpi-value" style="color: #0f172a;">${b.productsStats?.avgUnitsPerOrder || 0} <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">uds/pedido</span></div>
          <div class="bg-kpi-subtitle">Artículos por orden despachada</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">SKUS DISTINTOS DESPACHADOS</div>
          <div class="bg-kpi-value" style="color: #0f172a;">${(b.productsStats?.allProducts || []).length} <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">SKUs</span></div>
          <div class="bg-kpi-subtitle">Variedad de catálogo con rotación</div>
        </div>
      </div>
    </div>

    <!-- Tabla y Gráfico de Top Productos Más Vendidos -->
    <div style="display: grid; grid-template-columns: 1.3fr 1fr; gap: 1.5rem; margin-bottom: 2rem; align-items: start;">
      <!-- Tabla Top Productos -->
      <div class="bg-chart-card">
        <div class="bg-chart-header">
          <div>
            <h4 class="bg-chart-title">
              Top 10 Productos Más Vendidos
            </h4>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">Ranking por unidades físicas despachadas en el periodo</span>
          </div>
          <span style="font-size: 0.75rem; color: #5f06fa; font-weight: 700;">Top ${(b.productsStats?.topProducts || []).length}</span>
        </div>
        <div style="overflow-x: auto; max-height: 310px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
            <thead>
              <tr style="border-bottom: 2px solid var(--color-border); text-align: left; color: var(--color-text-muted);">
                <th style="padding: 6px 8px; width: 30px;">#</th>
                <th style="padding: 6px 8px; width: 100px;">SKU</th>
                <th style="padding: 6px 8px;">Producto</th>
                <th style="padding: 6px 8px; text-align: right; width: 75px;">Unidades</th>
                <th style="padding: 6px 8px; text-align: right; width: 75px;">% Part.</th>
              </tr>
            </thead>
            <tbody>
              ${(b.productsStats?.topProducts || []).map(p => `
                <tr style="border-bottom: 1px solid var(--color-border);">
                  <td style="padding: 7px 8px; font-weight: 700; color: #5f06fa;">${p.rank}</td>
                  <td style="padding: 7px 8px; font-weight: 600; font-family: monospace; font-size: 0.75rem;">${p.sku}</td>
                  <td style="padding: 7px 8px; color: var(--color-text-main); font-weight: 500; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 220px;" title="${p.name}">${p.name}</td>
                  <td style="padding: 7px 8px; text-align: right; font-weight: 700; color: var(--color-text-main);">${p.quantity}</td>
                  <td style="padding: 7px 8px; text-align: right;">
                    <span style="background: rgba(95, 6, 250, 0.08); color: #5f06fa; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem;">${p.sharePct}%</span>
                  </td>
                </tr>
              `).join('') || `<tr><td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--color-text-muted);">Sin pedidos con productos registrados</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Gráfico de Barras de Top Productos -->
      <div class="bg-chart-card">
        <div class="bg-chart-header">
          <h4 class="bg-chart-title">Unidades Despachadas (Top SKUs)</h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">Unidades</span>
        </div>
        <div style="height: 310px; position: relative;">
          <canvas id="chart-top-products"></canvas>
        </div>
      </div>
    </div>

    <!-- Sección de Ingresos de Stock Asociados (si aplica) -->
    ${b.inboundDeclarations && b.inboundDeclarations.length > 0 ? `
      <div class="bg-chart-card" style="margin-bottom: 2rem;">
        <div class="bg-chart-header">
          <div>
            <h4 class="bg-chart-title" style="display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-inbox-archive-line" style="color: #10b981;"></i> Ingresos de Stock del Periodo (${b.inboundDeclarations.length})
            </h4>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">Declaraciones de recepción asignadas a este periodo de facturación</span>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <span style="background: rgba(16, 185, 129, 0.1); color: #059669; font-weight: 700; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.8rem;">
              Total: ${formatDec(t.inboundTotalUF || 0, 4)} UF (${formatCLP(t.inboundNet)})
            </span>
          </div>
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
            <thead>
              <tr style="border-bottom: 2px solid var(--color-border); text-align: left; color: var(--color-text-muted);">
                <th style="padding: 8px 10px;"># Código</th>
                <th style="padding: 8px 10px;">Título / Descripción</th>
                <th style="padding: 8px 10px; text-align: center;">Unidades</th>
                <th style="padding: 8px 10px; text-align: center;">Volumen</th>
                <th style="padding: 8px 10px; text-align: right;">Costo UF</th>
                <th style="padding: 8px 10px; text-align: right;">Costo Neto (CLP)</th>
                <th style="padding: 8px 10px; text-align: center;">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${b.inboundDeclarations.map(dec => `
                <tr style="border-bottom: 1px solid var(--color-border);">
                  <td style="padding: 8px 10px; font-family: monospace; font-weight: 700; color: var(--color-primary);">#${dec.id.substring(0, 8).toUpperCase()}</td>
                  <td style="padding: 8px 10px; font-weight: 600; color: var(--color-text-main);">${dec.title}</td>
                  <td style="padding: 8px 10px; text-align: center;">${dec.quantity_received || dec.quantity_declared || 0} uds</td>
                  <td style="padding: 8px 10px; text-align: center;">${dec.volume_confirmed || dec.volume_declared || 0} m³</td>
                  <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: var(--color-text-main);">${formatDec(dec.costUF, 4)} UF</td>
                  <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: #059669;">${formatCLP(dec.costCLP)}</td>
                  <td style="padding: 8px 10px; text-align: center;">
                    <span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #059669; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">
                      ${dec.billing_status || 'Facturado'}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    <!-- Grid de 4 Gráficos Profesionales de Despachos y Gastos -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <!-- Gráfico 1: Ventas y Envíos por Operador -->
      <div class="bg-chart-card">
        <div class="bg-chart-header">
          <h4 class="bg-chart-title">
            Distribución por Courier / Operador
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">Participación %</span>
        </div>
        <div style="height: 250px; position: relative;">
          <canvas id="chart-courier-distribution"></canvas>
        </div>
      </div>

      <!-- Gráfico 2: Desglose por Modalidad de Entrega -->
      <div class="bg-chart-card">
        <div class="bg-chart-header">
          <h4 class="bg-chart-title">
            Modalidad y Tarifas de Entrega
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">RM, Colina, Flex, Región</span>
        </div>
        <div style="height: 250px; position: relative;">
          <canvas id="chart-delivery-types"></canvas>
        </div>
      </div>

      <!-- Gráfico 3: Composición del Gasto Logístico -->
      <div class="bg-chart-card">
        <div class="bg-chart-header">
          <h4 class="bg-chart-title">
            Composición del Gasto del Servicio
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">% Por Concepto Neto</span>
        </div>
        <div style="height: 250px; position: relative;">
          <canvas id="chart-expense-breakdown"></canvas>
        </div>
      </div>

      <!-- Gráfico 4: Top 8 Destinos / Comunas Frecuentes -->
      <div class="bg-chart-card">
        <div class="bg-chart-header">
          <h4 class="bg-chart-title">
            Destinos y Comunas Más Frecuentes
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">Top 8 Comunas</span>
        </div>
        <div style="height: 250px; position: relative;">
          <canvas id="chart-frequent-destinations"></canvas>
        </div>
      </div>
    </div>
  `;

  const corporatePalette = ['#5f06fa', '#7c3aed', '#6366f1', '#4f46e5', '#3b82f6', '#0ea5e9', '#10b981', '#64748b', '#94a3b8'];

  // A. Gráfico de Evolución de Almacenamiento Diario
  const dailyLogs = b.dailyStorageLogs && b.dailyStorageLogs.length > 0
    ? b.dailyStorageLogs
    : [{ date: `${b.currentPeriodYear}-${String(b.currentPeriodMonth).padStart(2, '0')}-01`, volume: b.volumeM3 }];

  const storageCanvas = document.getElementById('chart-storage-evolution');
  if (storageCanvas) {
    const ctx = storageCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(95, 6, 250, 0.25)');
    gradient.addColorStop(1, 'rgba(95, 6, 250, 0.01)');

    new Chart(storageCanvas, {
      type: 'line',
      data: {
        labels: dailyLogs.map(l => {
          const parts = l.date.split('-');
          return parts.length === 3 ? `${parts[2]}/${parts[1]}` : l.date;
        }),
        datasets: [{
          label: 'Volumen Diario (m³)',
          data: dailyLogs.map(l => l.volume),
          borderColor: '#5f06fa',
          backgroundColor: gradient,
          fill: true,
          tension: 0.25,
          borderWidth: 2.5,
          pointRadius: dailyLogs.length > 20 ? 2 : 4,
          pointBackgroundColor: '#5f06fa',
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Outfit', size: 10 } }
          },
          y: {
            beginAtZero: true,
            ticks: {
              font: { family: 'Outfit', size: 10 },
              callback: val => `${val} m³`
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context => ` Volumen: ${context.raw} m³`
            }
          }
        }
      }
    });
  }

  // B. Gráfico de Barras de Top Productos Más Vendidos
  const topProds = (b.productsStats?.topProducts || []).slice(0, 6);
  const topProductsCanvas = document.getElementById('chart-top-products');
  if (topProductsCanvas && topProds.length > 0) {
    new Chart(topProductsCanvas, {
      type: 'bar',
      data: {
        labels: topProds.map(p => p.sku),
        datasets: [{
          label: 'Unidades Vendidas',
          data: topProds.map(p => p.quantity),
          backgroundColor: corporatePalette.slice(0, topProds.length),
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#ffffff'
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, font: { family: 'Outfit', size: 10 } } },
          y: { ticks: { font: { family: 'Outfit', weight: '700', size: 11 } } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: context => {
                const prod = topProds[context.dataIndex];
                return prod ? `Producto: ${prod.name}\nParticipación: ${prod.sharePct}%` : '';
              }
            }
          }
        }
      }
    });
  }

  // 1. Chart Courier Distribution
  const courierMap = {};
  orders.forEach(o => {
    const courier = (o.operador && o.operador !== '—') ? o.operador : (o.deliveryType === 'RM_STK' ? 'STOCKA RM' : 'SIN ASIGNAR');
    courierMap[courier] = (courierMap[courier] || 0) + 1;
  });
  const courierLabels = Object.keys(courierMap);
  const courierCounts = courierLabels.map(l => courierMap[l]);

  new Chart(document.getElementById('chart-courier-distribution'), {
    type: 'doughnut',
    data: {
      labels: courierLabels,
      datasets: [{
        data: courierCounts,
        backgroundColor: corporatePalette.slice(0, courierLabels.length),
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'Outfit', size: 11, weight: '600' } } }
      },
      cutout: '62%'
    }
  });

  // 2. Chart Delivery Types
  const typeMap = { 'RM Stocka ($3.200)': 0, 'Colina ($3.490)': 0, 'Flex ($3.200)': 0, 'Envíame Regiones ($0)': 0, 'Retiro ($0)': 0 };
  orders.forEach(o => {
    if (o.deliveryType === 'RM_STK') typeMap['RM Stocka ($3.200)']++;
    else if (o.deliveryType === 'COLINA') typeMap['Colina ($3.490)']++;
    else if (o.deliveryType === 'FLEX') typeMap['Flex ($3.200)']++;
    else if (o.deliveryType === 'ENVIAME_REGION') typeMap['Envíame Regiones ($0)']++;
    else if (o.deliveryType === 'RETIRO') typeMap['Retiro ($0)']++;
  });
  const typeLabels = Object.keys(typeMap).filter(k => typeMap[k] > 0);
  const typeCounts = typeLabels.map(k => typeMap[k]);

  new Chart(document.getElementById('chart-delivery-types'), {
    type: 'pie',
    data: {
      labels: typeLabels,
      datasets: [{
        data: typeCounts,
        backgroundColor: corporatePalette.slice(0, typeLabels.length),
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'Outfit', size: 11, weight: '600' } } }
      }
    }
  });

  // 3. Chart Expense Breakdown
  const expenseData = [
    { label: 'Almacenamiento', val: t.storageNet, color: '#5f06fa' },
    { label: 'Preparación (Pick&Pack)', val: t.pickPackNet, color: '#7c3aed' },
    { label: 'Despachos RM/Flex', val: t.shippingRmFlexNet, color: '#6366f1' },
    { label: 'Costo Fijo Mensual', val: t.fixedFeeNet, color: '#3b82f6' },
    { label: 'Recepción e Ingreso de Stock', val: t.inboundNet || 0, color: '#10b981' },
    { label: 'Insumos de Embalaje', val: t.suppliesNet, color: '#64748b' }
  ].filter(e => e.val > 0);

  new Chart(document.getElementById('chart-expense-breakdown'), {
    type: 'doughnut',
    data: {
      labels: expenseData.map(e => e.label),
      datasets: [{
        data: expenseData.map(e => e.val),
        backgroundColor: expenseData.map(e => e.color),
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'Outfit', size: 11, weight: '600' } } },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw || 0;
              const pct = t.totalNet > 0 ? ((val / t.totalNet) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${formatCLP(val)} (${pct}%)`;
            }
          }
        }
      },
      cutout: '58%'
    }
  });

  // 4. Chart Top 8 Comunas
  const destMap = {};
  orders.forEach(o => {
    const dest = (o.destination || 'Santiago').toUpperCase().trim();
    destMap[dest] = (destMap[dest] || 0) + 1;
  });
  const sortedDests = Object.entries(destMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

  new Chart(document.getElementById('chart-frequent-destinations'), {
    type: 'bar',
    data: {
      labels: sortedDests.map(d => d[0]),
      datasets: [{
        label: 'Cantidad de Pedidos',
        data: sortedDests.map(d => d[1]),
        backgroundColor: 'rgba(95, 6, 250, 0.85)',
        hoverBackgroundColor: '#5f06fa',
        borderColor: '#5f06fa',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1 } },
        y: { ticks: { font: { family: 'Outfit', weight: '600', size: 11 } } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// --- VISTA PRINCIPAL DEL MÓDULO DEL GESTOR DE FACTURACIÓN ---
window.renderBillingGeneratorAdmin = async function(targetContainerId = 'tab-generator-content', initialCommerce = null, initialPeriodId = null) {
  injectBillingGeneratorStyles();

  const container = document.getElementById(targetContainerId);
  if (!container) return;

  // Cargar lista de periodos y lista de comercios
  let periods = [];
  let comercios = [];

  try {
    const { data: pData } = await supabase.from('billing_periods').select('id, name, period_month, period_year, status').order('created_at', { ascending: false });
    periods = pData || [];

    const { data: cData } = await supabase.from('v_comercios_config').select('nombre, sigla').order('nombre');
    comercios = cData || [];
  } catch (e) {
    console.error('Error cargando filtros iniciales:', e);
  }

  const defaultPeriod = initialPeriodId 
    ? periods.find(p => p.id === initialPeriodId) 
    : (periods[0] || { id: '', name: 'AGOSTO 2026' });

  const defaultCommerce = initialCommerce || (comercios[0]?.nombre || 'STREET GYM');

  container.innerHTML = `
    <div style="padding: 0.5rem 0;">
      <!-- Barra Superior de Control y Filtros -->
      <div class="bg-card-container" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; border-left: 4px solid #5f06fa;">
        <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 800; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">
              <i class="ri-store-2-line" style="color: #5f06fa;"></i> COMERCIO A FACTURAR:
            </label>
            <select id="bg-select-commerce" class="form-input" style="height: 40px; margin: 0; min-width: 230px; font-weight: 700; border-radius: 8px;">
              ${comercios.map(c => `
                <option value="${c.nombre}" ${c.nombre === defaultCommerce ? 'selected' : ''}>${c.nombre} (${c.sigla || 'N/A'})</option>
              `).join('')}
            </select>
          </div>

          <div>
            <label style="font-size: 0.75rem; font-weight: 800; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">
              <i class="ri-calendar-event-line" style="color: #5f06fa;"></i> PERIODO OFICIAL:
            </label>
            <select id="bg-select-period" class="form-input" style="height: 40px; margin: 0; min-width: 190px; font-weight: 700; border-radius: 8px;">
              ${periods.map(p => `
                <option value="${p.id}" data-name="${p.name}" ${p.id === defaultPeriod?.id ? 'selected' : ''}>${p.name}</option>
              `).join('')}
            </select>
          </div>

          <div style="padding-top: 1.15rem;">
            <button id="bg-btn-recalculate" class="btn btn-primary" style="height: 40px; background: #5f06fa; border-color: #5f06fa; display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 700; border-radius: 8px; box-shadow: 0 4px 12px rgba(95, 6, 250, 0.25);">
              <i class="ri-refresh-line"></i> Calcular Facturación
            </button>
          </div>
        </div>

        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; padding-top: 1.15rem;">
          <button id="bg-btn-export-excel" class="btn btn-outline" style="border-color: #10b981; color: #10b981; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px;" title="Descargar Excel con fórmulas">
            <i class="ri-file-excel-2-fill"></i> Exportar Excel (.xlsx)
          </button>
          <button id="bg-btn-download-pdf" class="btn btn-outline" style="border-color: #ef4444; color: #ef4444; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px;" title="Descargar PDF Oficial">
            <i class="ri-file-pdf-fill"></i> Descargar PDF
          </button>
          <button id="bg-btn-save-record" class="btn btn-primary" style="background: #10b981; border-color: #10b981; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);" title="Guardar en base de datos">
            <i class="ri-save-3-fill"></i> Guardar Facturación
          </button>
        </div>
      </div>

      <!-- Resumen KPI en Vivo -->
      <div id="bg-kpis-container" class="bg-kpi-grid">
        <!-- Cargado dinámicamente -->
      </div>

      <!-- Sub-pestañas de Navegación del Gestor -->
      <div class="bg-subnav">
        <button class="bg-subnav-btn active" id="bg-tab-btn-register" onclick="window.switchBgSubTab('register')">
          <i class="ri-table-fill"></i> Registro Editable (Excel)
        </button>
        <button class="bg-subnav-btn" id="bg-tab-btn-desglose" onclick="window.switchBgSubTab('desglose')">
          <i class="ri-file-list-3-fill"></i> Desglose Oficial Stocka
        </button>
        <button class="bg-subnav-btn" id="bg-tab-btn-analytics" onclick="window.switchBgSubTab('analytics')">
          <i class="ri-bar-chart-2-fill"></i> Analítica y Gráficas
        </button>
      </div>

      <!-- Contenedor 1: Registro Editable tipo Excel -->
      <div id="bg-content-register" style="display: block;">
        <div class="card" style="padding: 1.25rem; margin-bottom: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
                <i class="ri-file-excel-line" style="color: #10b981;"></i> Registro Editable de Pedidos del Periodo
              </h4>
              <p style="margin: 0.25rem 0 0 0; font-size: 0.775rem; color: var(--color-text-muted);">
                Edita libremente celdas de tarifas, recargos o fletes. Todos los cambios recalculan en tiempo real el desglose y las gráficas.
              </p>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
              <div style="position: relative;">
                <input type="text" id="bg-filter-order-input" class="form-input" placeholder="Búsqueda global..." style="height: 36px; font-size: 0.8rem; margin: 0; width: 210px; padding-left: 2rem; border-radius: 8px;" oninput="window.applyBgColumnFilters()">
                <i class="ri-search-line" style="position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
              </div>
              <button class="btn btn-outline btn-sm" onclick="window.addNewManualSupplyRow()" style="border-radius: 6px; font-weight: 600;" title="Agregar Insumo o Caja">+ Insumo</button>
              <button class="btn btn-outline btn-sm" onclick="window.addNewManualAdjustmentRow()" style="border-radius: 6px; font-weight: 600;" title="Agregar Descuento / Ajuste">+ Ajuste Comercial</button>
            </div>
          </div>

          <!-- Barra de Filtros Rápidos por Categoría -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.6rem; background: var(--color-bg); padding: 0.55rem 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
              <span style="font-size: 0.725rem; font-weight: 800; color: var(--color-text-muted); margin-right: 4px; text-transform: uppercase; letter-spacing: 0.4px;">
                <i class="ri-filter-3-line" style="color: #5f06fa;"></i> Filtros Rápidos:
              </span>
              <button type="button" class="bg-quick-filter-btn active" id="qf-all" onclick="window.setBgQuickFilter('all')">
                Todos (<span id="qf-count-all">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-no-agenda" onclick="window.setBgQuickFilter('no-agenda')" style="border-color: #fca5a5; background: #fef2f2; color: #b91c1c;" title="Pedidos sin agenda asignada en gestor">
                <i class="ri-alert-line"></i> Sin Agenda (<span id="qf-count-no-agenda">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-with-agenda" onclick="window.setBgQuickFilter('with-agenda')">
                Con Agenda (<span id="qf-count-with-agenda">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-rm-flex" onclick="window.setBgQuickFilter('rm-flex')">
                RM / Flex (<span id="qf-count-rm-flex">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-enviame" onclick="window.setBgQuickFilter('enviame')">
                Envíame / Región (<span id="qf-count-enviame">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-mkt" onclick="window.setBgQuickFilter('mkt')">
                Marketplace (<span id="qf-count-mkt">0</span>)
              </button>
            </div>

            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <span id="bg-filter-count-badge" style="font-size: 0.75rem; font-weight: 700; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 4px 8px; border-radius: 6px;">
                Mostrando 0 de 0 pedidos
              </span>
              <button id="bg-btn-clear-all-filters" class="btn btn-sm btn-outline" style="height: 28px; font-size: 0.72rem; padding: 0 8px; border-radius: 6px; display: none; border-color: #cbd5e1;" onclick="window.clearBgTableFilters()">
                <i class="ri-filter-off-line"></i> Limpiar Filtros
              </button>
            </div>
          </div>

          <div class="bg-excel-table-container">
            <table class="bg-excel-table" id="bg-orders-excel-grid">
              <thead>
                <tr>
                  <th style="width: 42px; text-align: center;">Inc.</th>
                  <th style="width: 42px; text-align: center;">N°</th>
                  <th style="min-width: 200px;">ID Pedido / Agenda</th>
                  <th style="min-width: 230px;">Destino / Operador / Método</th>
                  <th style="width: 145px;">Tipo Entrega</th>
                  <th style="width: 55px; text-align: center;">SKUs</th>
                  <th style="width: 55px; text-align: center;">Unid.</th>
                  <th style="width: 55px; text-align: center;">Mkt?</th>
                  <th style="width: 85px; text-align: right;">Base ($)</th>
                  <th style="width: 80px; text-align: right;">Rec. SKU</th>
                  <th style="width: 80px; text-align: right;">Rec. Unid</th>
                  <th style="width: 80px; text-align: right;">Rec. Mkt</th>
                  <th style="width: 95px; text-align: right;">Prep. Total</th>
                  <th style="width: 95px; text-align: right;">Flete Envío</th>
                  <th style="width: 105px; text-align: right; background: #e0e7ff; color: #3730a3;">Total Pedido</th>
                </tr>

                <!-- Fila de Filtros por Columna -->
                <tr class="bg-table-filter-row">
                  <th style="text-align: center; padding: 3px 2px;">
                    <select id="bg-col-filter-inc" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" title="Filtrar por inclusión">
                      <option value="">Todo</option>
                      <option value="inc">✓ Inc</option>
                      <option value="exc">✗ Exc</option>
                    </select>
                  </th>
                  <th style="text-align: center; padding: 3px 2px;">
                    <button type="button" onclick="window.clearBgTableFilters()" title="Limpiar todos los filtros de la tabla" style="background: transparent; border: none; cursor: pointer; color: #64748b; font-size: 0.85rem; padding: 2px;">
                      <i class="ri-filter-off-line"></i>
                    </button>
                  </th>
                  <th style="padding: 3px 6px;">
                    <div style="display: flex; gap: 4px; align-items: center;">
                      <input type="text" id="bg-col-filter-order" class="bg-col-filter-input" placeholder="ID / Fecha..." oninput="window.applyBgColumnFilters()" style="flex: 1;">
                      <select id="bg-col-filter-agenda" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 95px;" title="Filtrar por estado de agenda">
                        <option value="">Agendas</option>
                        <option value="empty">⚠️ Sin Agenda</option>
                        <option value="with">Con Agenda</option>
                      </select>
                    </div>
                  </th>
                  <th style="padding: 3px 6px;">
                    <input type="text" id="bg-col-filter-dest" class="bg-col-filter-input" placeholder="Comuna, Operador o Método..." oninput="window.applyBgColumnFilters()">
                  </th>
                  <th style="padding: 3px 4px;">
                    <select id="bg-col-filter-delivery" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 100%;">
                      <option value="">Todos los tipos</option>
                      <option value="RM_STK">RM-STK ($3.200)</option>
                      <option value="COLINA">Colina ($3.490)</option>
                      <option value="FLEX">Flex ($3.200)</option>
                      <option value="ENVIAME_REGION">Envíame / Región ($0)</option>
                      <option value="RETIRO">Retiro ($0)</option>
                    </select>
                  </th>
                  <th style="padding: 3px 2px; text-align: center;">
                    <input type="number" id="bg-col-filter-skus" class="bg-col-filter-input" placeholder="Min" style="width: 100%; text-align: center;" oninput="window.applyBgColumnFilters()">
                  </th>
                  <th style="padding: 3px 2px; text-align: center;">
                    <input type="number" id="bg-col-filter-units" class="bg-col-filter-input" placeholder="Min" style="width: 100%; text-align: center;" oninput="window.applyBgColumnFilters()">
                  </th>
                  <th style="padding: 3px 2px; text-align: center;">
                    <select id="bg-col-filter-mkt" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 100%;">
                      <option value="">Todos</option>
                      <option value="yes">Mkt</option>
                      <option value="no">No Mkt</option>
                    </select>
                  </th>
                  <th colspan="7" style="padding: 3px 6px; text-align: right; color: #94a3b8; font-size: 0.7rem; font-weight: 500;">
                    <span style="font-size: 0.68rem; color: #64748b;"><i class="ri-edit-line"></i> Columnas de valores y recargos editables</span>
                  </th>
                </tr>
              </thead>
              <tbody id="bg-orders-table-body">
                <!-- Filas renderizadas dinámicamente -->
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Contenedor 2: Desglose Oficial Stocka -->
      <div id="bg-content-desglose" style="display: none;">
        <div style="margin-bottom: 2rem;" id="bg-desglose-view-container">
          <!-- Renderizado dinámico del Desglose Mejorado -->
        </div>
      </div>

      <!-- Contenedor 3: Analítica y Gráficas -->
      <div id="bg-content-analytics" style="display: none;">
        <div id="bg-analytics-container">
          <!-- Renderizado dinámico de Chart.js -->
        </div>
      </div>
    </div>
  `;

  // Asignar listeners de eventos
  document.getElementById('bg-btn-recalculate')?.addEventListener('click', () => {
    executeCalculationFromUI();
  });

  document.getElementById('bg-select-commerce')?.addEventListener('change', () => {
    executeCalculationFromUI();
  });

  document.getElementById('bg-select-period')?.addEventListener('change', () => {
    executeCalculationFromUI();
  });

  document.getElementById('bg-btn-export-excel')?.addEventListener('click', () => {
    exportBillingToExcel();
  });

  document.getElementById('bg-btn-download-pdf')?.addEventListener('click', () => {
    downloadBillingPdf();
  });

  document.getElementById('bg-btn-save-record')?.addEventListener('click', () => {
    saveBillingRecordToSupabase();
  });

  // Ejecutar cálculo inicial
  await executeCalculationFromUI();
};

// Función para alternar sub-pestañas
window.switchBgSubTab = function(tabKey) {
  const tabs = ['register', 'desglose', 'analytics'];
  tabs.forEach(t => {
    const btn = document.getElementById(`bg-tab-btn-${t}`);
    const content = document.getElementById(`bg-content-${t}`);
    if (btn && content) {
      if (t === tabKey) {
        btn.classList.add('active');
        content.style.display = 'block';
      } else {
        btn.classList.remove('active');
        content.style.display = 'none';
      }
    }
  });

  if (tabKey === 'desglose') {
    const container = document.getElementById('bg-desglose-view-container');
    if (container) container.innerHTML = renderStockaDesgloseHTML();
  } else if (tabKey === 'analytics') {
    renderBillingAnalyticsCharts();
  }
};

// Ejecutar el motor de cálculo desde los valores actuales de la UI
async function executeCalculationFromUI(overrides = {}) {
  const commerceSelect = document.getElementById('bg-select-commerce');
  const periodSelect = document.getElementById('bg-select-period');

  if (!commerceSelect || !periodSelect) return;

  const commerceName = commerceSelect.value;
  const periodId = periodSelect.value;
  const selectedOption = periodSelect.options[periodSelect.selectedIndex];
  const periodName = selectedOption ? selectedOption.getAttribute('data-name') : 'AGOSTO 2026';

  billingState.currentPeriodId = periodId;

  // Ejecutar cálculo completo
  await calculateCommerceBilling(commerceName, periodName, overrides);

  // Actualizar KPI Cards en pantalla
  renderKPIsUI();

  // Actualizar Tabla Editable
  renderOrdersTableUI();

  // Actualizar Desglose Oficial
  const desgloseCont = document.getElementById('bg-desglose-view-container');
  if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();
}

// Renderizar Tarjetas de KPI
function renderKPIsUI() {
  const container = document.getElementById('bg-kpis-container');
  if (!container) return;

  const b = billingState;
  const t = b.totals;

  container.innerHTML = `
    <div class="bg-kpi-card" style="border-left: 4px solid #5f06fa;">
      <div class="bg-kpi-title"><i class="ri-money-dollar-circle-line" style="color: #5f06fa;"></i> TOTAL FACTURA (CON IVA)</div>
      <div class="bg-kpi-value text-stocka-purple">${formatCLP(t.totalToPay)}</div>
      <div class="bg-kpi-subtitle">Neto: ${formatCLP(t.totalNet)} + IVA: ${formatCLP(t.iva)}</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #0284c7;">
      <div class="bg-kpi-title"><i class="ri-box-3-line" style="color: #0284c7;"></i> PEDIDOS PROCESADOS</div>
      <div class="bg-kpi-value" style="color: #0284c7;">${t.billableOrdersCount} <span style="font-size: 0.9rem; font-weight: 600; color: #64748b;">/ ${t.ordersCount}</span></div>
      <div class="bg-kpi-subtitle">Pick & Pack Base: ${formatCLP(b.activeRange?.pick_pack_base || 1250)}</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #10b981;">
      <div class="bg-kpi-title"><i class="ri-archive-2-line" style="color: #10b981;"></i> ALMACENAMIENTO MES</div>
      <div class="bg-kpi-value" style="color: #10b981;">${formatDec(b.volumeM3, 2)} <span style="font-size: 0.9rem; font-weight: 600;">m³</span></div>
      <div class="bg-kpi-subtitle">Promedio ${b.volumeDaysLogged} días (${formatCLP(t.storageNet)} neto)</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #f59e0b;">
      <div class="bg-kpi-title"><i class="ri-flashlight-line" style="color: #f59e0b;"></i> DESPACHOS RM / FLEX</div>
      <div class="bg-kpi-value" style="color: #f59e0b;">${t.shippingRmFlexCount} <span style="font-size: 0.9rem; font-weight: 600; color: #64748b;">envíos</span></div>
      <div class="bg-kpi-subtitle">Neto Despachos: ${formatCLP(t.shippingRmFlexNet)}</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid ${t.fixedFeeUF > 0 ? '#ef4444' : '#10b981'};">
      <div class="bg-kpi-title"><i class="ri-shield-star-line" style="color: ${t.fixedFeeUF > 0 ? '#ef4444' : '#10b981'};"></i> COSTO FIJO MENSUAL</div>
      <div class="bg-kpi-value" style="color: ${t.fixedFeeUF > 0 ? '#ef4444' : '#10b981'};">
        ${t.fixedFeeUF > 0 ? `${formatDec(t.fixedFeeUF, 1)} UF` : 'EXENTO'}
      </div>
      <div class="bg-kpi-subtitle">${t.fixedFeeUF > 0 ? formatCLP(t.fixedFeeNet) : 'Metas de actividad alcanzadas'}</div>
    </div>
  `;
}

// Renderizar Filas de la Tabla Editable
// Renderizar Filas de la Tabla Editable
function renderOrdersTableUI() {
  const tbody = document.getElementById('bg-orders-table-body');
  if (!tbody) return;

  const orders = billingState.orders || [];
  if (orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="15" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
          <i class="ri-inbox-line" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: #5f06fa;"></i>
          No se encontraron pedidos asignados al periodo <strong>${billingState.currentPeriodName}</strong> para este comercio.<br>
          <span style="font-size: 0.8rem; margin-top: 0.25rem; display: inline-block;">Asigna el periodo en el <strong>Gestor de Pedidos</strong> para que aparezcan aquí automáticamente.</span>
        </td>
      </tr>
    `;
    updateQuickPillCounts([]);
    const countBadge = document.getElementById('bg-filter-count-badge');
    if (countBadge) countBadge.textContent = 'Mostrando 0 de 0 pedidos';
    return;
  }

  tbody.innerHTML = orders.map((o) => {
    const isChecked = !o.isExcluded;
    const rowClass = isChecked ? '' : 'style="opacity: 0.5; background: #f1f5f9;"';

    // 1. Agenda check: junto al número de pedido, marcar en rojo si está vacío
    const hasAgenda = o.agenda && o.agenda.trim() !== '' && o.agenda !== '—';
    const agendaText = hasAgenda ? o.agenda.trim() : '';
    const agendaBadge = hasAgenda
      ? `<span class="bg-order-agenda-badge" title="Agenda asignada: ${escapeHtml(agendaText)}"><i class="ri-calendar-event-line"></i> ${escapeHtml(agendaText)}</span>`
      : `<span class="bg-order-agenda-badge-empty" title="Sin agenda asignada en el Gestor de Pedidos"><i class="ri-alert-line"></i> Sin Agenda</span>`;

    // 2. Operador junto a la comuna, y abajo el método de envío
    const hasOperador = o.operador && o.operador.trim() !== '' && o.operador !== '—';
    const operadorText = hasOperador ? o.operador.trim() : 'S/Op';
    const operadorBadge = hasOperador
      ? `<span class="bg-order-operador-badge" title="Operador en Gestor: ${escapeHtml(operadorText)}"><i class="ri-truck-line"></i> ${escapeHtml(operadorText)}</span>`
      : `<span class="bg-order-operador-badge-empty" title="Sin operador asignado">S/Op</span>`;

    const shippingMethodText = (o.shippingMethod && o.shippingMethod.trim() !== '' && o.shippingMethod !== '—')
      ? o.shippingMethod.trim()
      : 'Sin método';

    return `
      <tr ${rowClass} id="bg-row-${o.id}" data-id="${o.id}"
          data-order="${escapeHtml((o.orderNumber || '').toLowerCase())}"
          data-date="${escapeHtml((o.date || '').toLowerCase())}"
          data-agenda="${escapeHtml(agendaText.toLowerCase())}"
          data-has-agenda="${hasAgenda ? '1' : '0'}"
          data-dest="${escapeHtml((o.destination || '').toLowerCase())}"
          data-operador="${escapeHtml(operadorText.toLowerCase())}"
          data-method="${escapeHtml(shippingMethodText.toLowerCase())}"
          data-delivery="${o.deliveryType}"
          data-skus="${o.skuCount}"
          data-units="${o.unitsCount}"
          data-mkt="${o.isMarketplace ? '1' : '0'}"
          data-inc="${isChecked ? '1' : '0'}">
        <td style="text-align: center;">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.toggleBgOrderInclusion('${o.id}', this.checked)" style="cursor: pointer; width: 16px; height: 16px; accent-color: #5f06fa;">
        </td>
        <td style="text-align: center; color: #64748b; font-weight: 700;">${o.rowNumber}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
            <strong style="color: var(--color-text-main); font-size: 0.85rem;">${escapeHtml(o.orderNumber)}</strong>
            ${agendaBadge}
          </div>
          <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 2px;">
            <i class="ri-calendar-line"></i> ${escapeHtml(o.date)}
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
            <span style="${o.isColina ? 'color: #ea580c; font-weight: 700;' : 'font-weight: 600; color: var(--color-text-main);'}">${escapeHtml(o.destination)}</span>
            ${o.isColina ? '<span style="background: #ffedd5; color: #c2410c; font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; font-weight: 800;">COLINA</span>' : ''}
            ${operadorBadge}
          </div>
          <div class="bg-order-shipping-method" title="Método de envío: ${escapeHtml(shippingMethodText)}">
            <i class="ri-e-bike-2-line" style="color: #5f06fa; font-size: 0.75rem; flex-shrink: 0;"></i>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">${escapeHtml(shippingMethodText)}</span>
          </div>
        </td>
        <td>
          <select class="bg-excel-select" onchange="window.updateBgOrderDeliveryType('${o.id}', this.value)" style="width: 100%;">
            <option value="RM_STK" ${o.deliveryType === 'RM_STK' ? 'selected' : ''}>RM-STK ($3.200)</option>
            <option value="COLINA" ${o.deliveryType === 'COLINA' ? 'selected' : ''}>Colina ($3.490)</option>
            <option value="FLEX" ${o.deliveryType === 'FLEX' ? 'selected' : ''}>Flex ($3.200)</option>
            <option value="ENVIAME_REGION" ${o.deliveryType === 'ENVIAME_REGION' ? 'selected' : ''}>Envíame / Región ($0)</option>
            <option value="RETIRO" ${o.deliveryType === 'RETIRO' ? 'selected' : ''}>Retiro ($0)</option>
          </select>
        </td>
        <td style="text-align: center;">
          <input type="number" class="bg-excel-input" value="${o.skuCount}" min="1" style="text-align: center; font-weight: 700;" onchange="window.updateBgOrderCell('${o.id}', 'skuCount', this.value)">
        </td>
        <td style="text-align: center;">
          <input type="number" class="bg-excel-input" value="${o.unitsCount}" min="1" style="text-align: center; font-weight: 700;" onchange="window.updateBgOrderCell('${o.id}', 'unitsCount', this.value)">
        </td>
        <td style="text-align: center;">
          <input type="checkbox" ${o.isMarketplace ? 'checked' : ''} onchange="window.updateBgOrderCell('${o.id}', 'isMarketplace', this.checked)" style="accent-color: #5f06fa; cursor: pointer;">
        </td>
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.baseRate}" style="text-align: right; width: 75px; font-weight: 600;" onchange="window.updateBgOrderCell('${o.id}', 'baseRate', this.value)">
        </td>
        <td style="text-align: right; color: ${o.surchargeSku > 0 ? '#ea580c' : '#64748b'}; font-weight: 600;">
          ${formatCLP(o.surchargeSku)}
        </td>
        <td style="text-align: right; color: ${o.surchargeUnits > 0 ? '#ea580c' : '#64748b'}; font-weight: 600;">
          ${formatCLP(o.surchargeUnits)}
        </td>
        <td style="text-align: right; color: ${o.surchargeMarketplace > 0 ? '#ea580c' : '#64748b'}; font-weight: 600;">
          ${formatCLP(o.surchargeMarketplace)}
        </td>
        <td style="text-align: right; font-weight: 700; color: var(--color-text-main);">
          ${formatCLP(o.pickPackTotal)}
        </td>
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.shippingFreight}" style="text-align: right; width: 80px; font-weight: 700; color: #5f06fa;" onchange="window.updateBgOrderCell('${o.id}', 'shippingFreight', this.value)">
        </td>
        <td style="text-align: right; font-weight: 800; color: #5f06fa; background: rgba(95, 6, 250, 0.05); font-size: 0.85rem;">
          ${formatCLP(o.orderTotal)}
        </td>
      </tr>
    `;
  }).join('');

  // 3. Actualizar conteos de filtros rápidos
  updateQuickPillCounts(orders);

  // 4. Restaurar valores en los inputs de filtros si estaban activos
  if (window.bgFilterState) {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el && v !== undefined && v !== null) el.value = v;
    };
    setVal('bg-filter-order-input', window.bgFilterState.global);
    setVal('bg-col-filter-inc', window.bgFilterState.inc);
    setVal('bg-col-filter-order', window.bgFilterState.order);
    setVal('bg-col-filter-agenda', window.bgFilterState.agenda);
    setVal('bg-col-filter-dest', window.bgFilterState.dest);
    setVal('bg-col-filter-delivery', window.bgFilterState.delivery);
    setVal('bg-col-filter-skus', window.bgFilterState.skus);
    setVal('bg-col-filter-units', window.bgFilterState.units);
    setVal('bg-col-filter-mkt', window.bgFilterState.mkt);
  }

  // 5. Reaplicar filtros activos
  window.applyBgColumnFilters();
}

// Funciones de Edición Inline en el Grid
window.toggleBgOrderInclusion = function(orderId, isChecked) {
  const order = billingState.orders.find(o => o.id === orderId);
  if (order) {
    order.isExcluded = !isChecked;
    recalculateFromCurrentState();
  }
};

window.updateBgOrderDeliveryType = function(orderId, newType) {
  const order = billingState.orders.find(o => o.id === orderId);
  if (!order) return;

  order.deliveryType = newType;
  if (newType === 'RM_STK') order.shippingFreight = 3200;
  else if (newType === 'COLINA') order.shippingFreight = 3490;
  else if (newType === 'FLEX') order.shippingFreight = 3200;
  else if (newType === 'ENVIAME_REGION') order.shippingFreight = 0;
  else if (newType === 'RETIRO') order.shippingFreight = 0;

  order.orderTotal = order.pickPackTotal + order.shippingFreight;
  recalculateFromCurrentState();
};

window.updateBgOrderCell = function(orderId, field, value) {
  const order = billingState.orders.find(o => o.id === orderId);
  if (!order) return;

  if (field === 'skuCount') {
    order.skuCount = Math.max(1, parseInt(value, 10) || 1);
    const extraSku = Math.max(0, order.skuCount - 3);
    order.surchargeSku = extraSku * 100;
  } else if (field === 'unitsCount') {
    order.unitsCount = Math.max(1, parseInt(value, 10) || 1);
    const extraUnits = Math.max(0, order.unitsCount - 10);
    order.surchargeUnits = extraUnits * 50;
  } else if (field === 'isMarketplace') {
    order.isMarketplace = !!value;
    order.surchargeMarketplace = order.isMarketplace ? 100 : 0;
  } else if (field === 'baseRate') {
    order.baseRate = Math.max(0, parseInt(value, 10) || 0);
  } else if (field === 'shippingFreight') {
    order.shippingFreight = Math.max(0, parseInt(value, 10) || 0);
  }

  order.pickPackTotal = order.baseRate + order.surchargeSku + order.surchargeUnits + order.surchargeMarketplace;
  order.orderTotal = order.pickPackTotal + order.shippingFreight;

  recalculateFromCurrentState();
};

// Recálculo rápido de totales a partir del estado de pedidos editado
function recalculateFromCurrentState() {
  const b = billingState;
  const billableOrders = b.orders.filter(o => !o.isExcluded);

  const totalPickPackNet = billableOrders.reduce((acc, o) => acc + o.pickPackTotal, 0);

  const rmFlexOrders = billableOrders.filter(o => o.deliveryType === 'RM_STK' || o.deliveryType === 'COLINA' || o.deliveryType === 'FLEX');
  const totalRmFlexNet = rmFlexOrders.reduce((acc, o) => acc + o.shippingFreight, 0);

  const enviameOrders = billableOrders.filter(o => o.deliveryType === 'ENVIAME_REGION');

  const baseStorageM3Rate = b.activeRange?.storage_m3 || 48900;
  const grossStorage = b.volumeM3 * baseStorageM3Rate;
  const netStorageCost = Math.round(grossStorage * (1 - (b.totals.storageDiscountPct || 0) / 100));

  let fixedFeeUF = 0;
  let fixedFeeCLP = 0;
  let fixedFeeReason = "";

  if (billableOrders.length >= 75 || b.volumeM3 >= 1.5) {
    fixedFeeUF = 0;
    fixedFeeCLP = 0;
    fixedFeeReason = `Exento ($0) por alcanzar ${billableOrders.length >= 75 ? '≥ 75 pedidos' : '≥ 1.5 m³'}`;
  } else if (b.volumeM3 < 1.0 && billableOrders.length < 50) {
    fixedFeeUF = 1.5;
    fixedFeeCLP = Math.round(1.5 * b.ufValue);
    fixedFeeReason = `Costo fijo 1.5 UF (${formatCLP(fixedFeeCLP)}) por operar con < 50 pedidos y < 1 m³`;
  } else {
    fixedFeeUF = 0.9;
    fixedFeeCLP = Math.round(0.9 * b.ufValue);
    fixedFeeReason = `Costo fijo 0.9 UF (${formatCLP(fixedFeeCLP)}) por operar con < 75 pedidos y < 1.5 m³`;
  }

  const totalSuppliesNet = b.supplies.reduce((acc, s) => acc + (s.total || 0), 0);
  const totalAdjustmentsNet = b.adjustments.reduce((acc, a) => acc + (a.amount || 0), 0);

  const inboundNet = b.totals.inboundNet || 0;
  const totalNet = Math.round(netStorageCost + totalPickPackNet + totalRmFlexNet + inboundNet + fixedFeeCLP + totalSuppliesNet + totalAdjustmentsNet);
  const totalIVA = Math.round(totalNet * 0.19);
  const totalGross = totalNet + totalIVA;

  b.totals = {
    ...b.totals,
    ordersCount: b.orders.length,
    billableOrdersCount: billableOrders.length,
    storageNet: netStorageCost,
    pickPackNet: totalPickPackNet,
    shippingRmFlexCount: rmFlexOrders.length,
    shippingRmFlexNet: totalRmFlexNet,
    shippingEnviameCount: enviameOrders.length,
    fixedFeeUF,
    fixedFeeNet: fixedFeeCLP,
    fixedFeeReason,
    totalNet,
    iva: totalIVA,
    totalGross,
    totalToPay: totalGross
  };

  renderKPIsUI();
  renderOrdersTableUI();

  const desgloseCont = document.getElementById('bg-desglose-view-container');
  if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();
}

// Agregar Fila Manual de Insumos
window.addNewManualSupplyRow = async function() {
  const { value: formValues } = await Swal.fire({
    title: 'Agregar Insumo o Caja',
    html: `
      <div style="text-align: left;">
        <label style="font-size: 0.8rem; font-weight: 600;">Nombre del Insumo:</label>
        <input id="swal-supply-name" class="swal2-input" placeholder="Ej: Caja S 20x20x20 o Plástico Burbuja" value="Caja S 20x20x20">
        
        <label style="font-size: 0.8rem; font-weight: 600; margin-top: 0.5rem; display: block;">Cantidad:</label>
        <input id="swal-supply-qty" type="number" class="swal2-input" placeholder="1" value="1">

        <label style="font-size: 0.8rem; font-weight: 600; margin-top: 0.5rem; display: block;">Precio Unitario Neto ($):</label>
        <input id="swal-supply-price" type="number" class="swal2-input" placeholder="450" value="450">
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Agregar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      return {
        name: document.getElementById('swal-supply-name').value,
        qty: parseInt(document.getElementById('swal-supply-qty').value, 10) || 1,
        price: parseInt(document.getElementById('swal-supply-price').value, 10) || 0
      };
    }
  });

  if (formValues && formValues.name) {
    billingState.supplies.push({
      id: 'custom_' + Date.now(),
      name: formValues.name,
      unit: 'ud.',
      qty: formValues.qty,
      unitPrice: formValues.price,
      total: formValues.qty * formValues.price
    });
    recalculateFromCurrentState();
  }
};

// Agregar Fila Manual de Ajuste / Descuento Comercial
window.addNewManualAdjustmentRow = async function() {
  const { value: formValues } = await Swal.fire({
    title: 'Agregar Ajuste Comercial / Descuento',
    html: `
      <div style="text-align: left;">
        <label style="font-size: 0.8rem; font-weight: 600;">Concepto / Razón:</label>
        <input id="swal-adj-concept" class="swal2-input" placeholder="Ej: Descuento Comercial Acordado o Cobro Especial" value="Descuento Comercial Acordado">
        
        <label style="font-size: 0.8rem; font-weight: 600; margin-top: 0.5rem; display: block;">Monto Neto ($ - Usar negativo para descuentos):</label>
        <input id="swal-adj-amount" type="number" class="swal2-input" placeholder="-15000" value="-10000">

        <label style="font-size: 0.8rem; font-weight: 600; margin-top: 0.5rem; display: block;">Notas internas:</label>
        <input id="swal-adj-notes" class="swal2-input" placeholder="Autorizado por Gerencia">
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Aplicar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      return {
        concept: document.getElementById('swal-adj-concept').value,
        amount: parseInt(document.getElementById('swal-adj-amount').value, 10) || 0,
        notes: document.getElementById('swal-adj-notes').value
      };
    }
  });

  if (formValues && formValues.concept) {
    billingState.adjustments.push({
      id: 'adj_' + Date.now(),
      concept: formValues.concept,
      amount: formValues.amount,
      notes: formValues.notes
    });
    recalculateFromCurrentState();
  }
};

// --- MOTOR DE FILTRADO POR COLUMNAS Y FILTROS RÁPIDOS EN REGISTRO EDITABLE ---
window.bgFilterState = {
  global: '',
  inc: '',
  order: '',
  agenda: '',
  dest: '',
  delivery: '',
  skus: '',
  units: '',
  mkt: '',
  quickFilter: 'all'
};

// Actualizar contadores numéricos en las pastillas de filtros rápidos
function updateQuickPillCounts(orders) {
  const total = orders.length;
  const noAgenda = orders.filter(o => !o.agenda || o.agenda.trim() === '' || o.agenda === '—').length;
  const withAgenda = total - noAgenda;
  const rmFlex = orders.filter(o => o.deliveryType === 'RM_STK' || o.deliveryType === 'COLINA' || o.deliveryType === 'FLEX').length;
  const enviame = orders.filter(o => o.deliveryType === 'ENVIAME_REGION').length;
  const mkt = orders.filter(o => o.isMarketplace).length;

  const setElText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };
  setElText('qf-count-all', total);
  setElText('qf-count-no-agenda', noAgenda);
  setElText('qf-count-with-agenda', withAgenda);
  setElText('qf-count-rm-flex', rmFlex);
  setElText('qf-count-enviame', enviame);
  setElText('qf-count-mkt', mkt);
}

// Aplicar filtros por columnas de forma combinada y reactiva
window.applyBgColumnFilters = function() {
  const globalInput = document.getElementById('bg-filter-order-input');
  const incSelect = document.getElementById('bg-col-filter-inc');
  const orderInput = document.getElementById('bg-col-filter-order');
  const agendaSelect = document.getElementById('bg-col-filter-agenda');
  const destInput = document.getElementById('bg-col-filter-dest');
  const deliverySelect = document.getElementById('bg-col-filter-delivery');
  const skusInput = document.getElementById('bg-col-filter-skus');
  const unitsInput = document.getElementById('bg-col-filter-units');
  const mktSelect = document.getElementById('bg-col-filter-mkt');

  const globalQuery = (globalInput ? globalInput.value : (window.bgFilterState?.global || '')).toLowerCase().trim();
  const incFilter = incSelect ? incSelect.value : (window.bgFilterState?.inc || '');
  const orderQuery = (orderInput ? orderInput.value : (window.bgFilterState?.order || '')).toLowerCase().trim();
  const agendaFilter = agendaSelect ? agendaSelect.value : (window.bgFilterState?.agenda || '');
  const destQuery = (destInput ? destInput.value : (window.bgFilterState?.dest || '')).toLowerCase().trim();
  const deliveryFilter = deliverySelect ? deliverySelect.value : (window.bgFilterState?.delivery || '');
  const skusVal = skusInput ? skusInput.value : (window.bgFilterState?.skus || '');
  const unitsVal = unitsInput ? unitsInput.value : (window.bgFilterState?.units || '');
  const mktFilter = mktSelect ? mktSelect.value : (window.bgFilterState?.mkt || '');

  const skusMin = skusVal !== '' ? parseInt(skusVal, 10) : NaN;
  const unitsMin = unitsVal !== '' ? parseInt(unitsVal, 10) : NaN;

  window.bgFilterState = {
    global: globalQuery,
    inc: incFilter,
    order: orderQuery,
    agenda: agendaFilter,
    dest: destQuery,
    delivery: deliveryFilter,
    skus: skusVal,
    units: unitsVal,
    mkt: mktFilter,
    quickFilter: window.bgFilterState?.quickFilter || 'all'
  };

  const rows = document.querySelectorAll('#bg-orders-table-body tr[id^="bg-row-"]');
  let visibleCount = 0;
  const totalCount = rows.length;

  rows.forEach(r => {
    let match = true;

    // 1. Inclusión
    if (incFilter === 'inc' && r.getAttribute('data-inc') !== '1') match = false;
    else if (incFilter === 'exc' && r.getAttribute('data-inc') !== '0') match = false;

    // 2. ID Pedido, fecha o agenda
    if (match && orderQuery) {
      const orderText = ((r.getAttribute('data-order') || '') + ' ' +
                         (r.getAttribute('data-agenda') || '') + ' ' +
                         (r.getAttribute('data-date') || '')).toLowerCase();
      if (!orderText.includes(orderQuery)) match = false;
    }

    // 3. Estado de Agenda (con agenda vs sin agenda roja)
    if (match && agendaFilter) {
      const hasAgenda = r.getAttribute('data-has-agenda') === '1';
      if (agendaFilter === 'empty' && hasAgenda) match = false;
      if (agendaFilter === 'with' && !hasAgenda) match = false;
    }

    // 4. Destino, Operador y Método de Envío
    if (match && destQuery) {
      const destText = ((r.getAttribute('data-dest') || '') + ' ' +
                        (r.getAttribute('data-operador') || '') + ' ' +
                        (r.getAttribute('data-method') || '')).toLowerCase();
      if (!destText.includes(destQuery)) match = false;
    }

    // 5. Tipo Entrega
    if (match && deliveryFilter) {
      if (r.getAttribute('data-delivery') !== deliveryFilter) match = false;
    }

    // 6. SKUs min
    if (match && !isNaN(skusMin)) {
      const skus = parseInt(r.getAttribute('data-skus'), 10) || 0;
      if (skus < skusMin) match = false;
    }

    // 7. Unidades min
    if (match && !isNaN(unitsMin)) {
      const units = parseInt(r.getAttribute('data-units'), 10) || 0;
      if (units < unitsMin) match = false;
    }

    // 8. Marketplace?
    if (match && mktFilter) {
      const isMkt = r.getAttribute('data-mkt') === '1';
      if (mktFilter === 'yes' && !isMkt) match = false;
      if (mktFilter === 'no' && isMkt) match = false;
    }

    // 9. Búsqueda Global
    if (match && globalQuery) {
      const allText = r.textContent.toLowerCase();
      if (!allText.includes(globalQuery)) match = false;
    }

    r.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });

  // Actualizar contador y botón de limpiar
  const countBadge = document.getElementById('bg-filter-count-badge');
  if (countBadge) {
    countBadge.textContent = `Mostrando ${visibleCount} de ${totalCount} pedidos`;
  }

  const isAnyFilterActive = !!(globalQuery || incFilter || orderQuery || agendaFilter || destQuery || deliveryFilter || !isNaN(skusMin) || !isNaN(unitsMin) || mktFilter);
  const clearBtn = document.getElementById('bg-btn-clear-all-filters');
  if (clearBtn) {
    clearBtn.style.display = isAnyFilterActive ? 'inline-flex' : 'none';
  }
};

// Limpiar todos los filtros aplicados
window.clearBgTableFilters = function(resetQuickButtons = true) {
  const ids = [
    'bg-filter-order-input',
    'bg-col-filter-inc',
    'bg-col-filter-order',
    'bg-col-filter-agenda',
    'bg-col-filter-dest',
    'bg-col-filter-delivery',
    'bg-col-filter-skus',
    'bg-col-filter-units',
    'bg-col-filter-mkt'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  if (resetQuickButtons) {
    document.querySelectorAll('.bg-quick-filter-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('qf-all')?.classList.add('active');
    window.bgFilterState = { quickFilter: 'all' };
  }

  window.applyBgColumnFilters();
};

// Activar un filtro rápido desde las pastillas superiores
window.setBgQuickFilter = function(filterType) {
  window.clearBgTableFilters(false);

  document.querySelectorAll('.bg-quick-filter-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`qf-${filterType}`)?.classList.add('active');
  window.bgFilterState.quickFilter = filterType;

  if (filterType === 'all') {
    // Ya limpio
  } else if (filterType === 'no-agenda') {
    const el = document.getElementById('bg-col-filter-agenda');
    if (el) el.value = 'empty';
  } else if (filterType === 'with-agenda') {
    const el = document.getElementById('bg-col-filter-agenda');
    if (el) el.value = 'with';
  } else if (filterType === 'rm-flex') {
    const el = document.getElementById('bg-col-filter-delivery');
    if (el) el.value = 'FLEX';
  } else if (filterType === 'enviame') {
    const el = document.getElementById('bg-col-filter-delivery');
    if (el) el.value = 'ENVIAME_REGION';
  } else if (filterType === 'mkt') {
    const el = document.getElementById('bg-col-filter-mkt');
    if (el) el.value = 'yes';
  }

  window.applyBgColumnFilters();
};

// Compatibilidad con buscador previo
window.filterBgOrdersTable = function(query) {
  window.applyBgColumnFilters();
};

// Función de entrada para abrir el Gestor directamente desde una fila del Control de Facturación
window.openBillingGeneratorForRecord = function(periodId, commerceName) {
  if (typeof window.switchBillingAdminTab === 'function') {
    window.switchBillingAdminTab('generator');
  }
  window.renderBillingGeneratorAdmin('tab-generator-content', commerceName, periodId);
};
