// js/billing_generator.js - Gestor de Facturación Automatizada STOCKA WMS
// Generación de facturación mensual por comercio con base en tarifas vigentes,
// volumen de almacenamiento diario, pedidos asignados por periodo,
// registro editable tipo Excel, desglose estético Stocka (#5f06fa) y analítica con gráficos.

import supabase from './supabase.js';
import { DEFAULT_PRICING_CONFIG, loadPricingConfig, sanitizeAndMergeConfig, getDeliveryTypes, savePricingConfig } from './pricing_manager.js';

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
  banco: 'SCOTIABANK (SUD AMERICANO)',
  tipoCuenta: 'CTA CORRIENTE',
  numeroCuenta: '992369965',
  emailEnvio: 'finanzas@stocka.cl',
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
  invoiceDates: {
    emisionDate: '',
    dueDate: '',
    termLabel: '5 días corridos'
  },
  pricingConfig: null,
  ufValue: 40884,
  ufDate: null,
  volumeM3: 0,
  isManualVolume: false,
  autoVolumeM3: 0,
  autoVolumeDaysLogged: 0,
  autoDailyStorageLogs: [],
  volumeSessionKey: '',
  volumeDaysLogged: 0,
  volumeDailyAverage: 0,
  dailyStorageLogs: [],
  volumeStats: {
    averageM3: 0,
    daysCount: 0,
    maxDailyVolume: 0,
    minDailyVolume: 0
  },
  storageByStore: {},
  productsStats: {
    totalUnits: 0,
    avgUnitsPerOrder: 0,
    topProducts: [],
    allProducts: []
  },
  inboundDeclarations: [],
  activeRange: null,
  orders: [],
  customColumns: [],
  supplies: [],
  adjustments: [],
  totals: {
    ordersCount: 0,
    billableOrdersCount: 0,
    storageRate: 0,
    defaultStorageRate: 0,
    storageGross: 0,
    storageDiscountPct: 0,
    storageDiscountLabel: '',
    storageDiscountAmount: 0,
    storageNet: 0,
    isStorageCustom: false,
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
    posActive: false,
    posFeeUF: 0,
    posFeeNet: 0,
    posFeeDetails: '',
    posIsStocka: false,
    posMachine: null,
    suppliesNet: 0,
    adjustmentsNet: 0,
    totalNet: 0,
    iva: 0,
    totalGross: 0,
    totalToPay: 0
  },
  isSaved: true,
  isPublished: false,
  isPaid: false,
  isLocked: false,
  paymentStatus: 'Por solicitar',
  loadedFromSnapshot: false,
  isLoading: false,
  isConglomerate: false,
  conglomerateName: null,
  conglomerateChildren: [],
  selectedAsChildStore: false,
  storeBreakdown: [],
  activeConglomerateStoreFilter: null,
  commerceObservations: [],
  activeObservationsFilter: 'all'
};

// Inyectar estilos visuales avanzados del Gestor de Facturación
export function injectBillingGeneratorStyles() {
  if (document.getElementById('billing-generator-styles')) return;
  const style = document.createElement('style');
  style.id = 'billing-generator-styles';
  style.innerHTML = `
    .bg-stocka-purple { background-color: #5f06fa !important; }
    .text-stocka-purple { color: #5f06fa !important; }
    .border-stocka-purple { border-color: #5f06fa !important; }

    [data-theme="dark"] .text-stocka-purple { color: #c084fc !important; }
    [data-theme="dark"] .border-stocka-purple { border-color: #a855f7 !important; }

    .bg-card-container {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 10px;
      padding: 0.65rem 1rem;
      margin-bottom: 0.65rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.03);
    }

    [data-theme="dark"] .bg-card-container {
      background: var(--color-surface, #131b2e) !important;
      border-color: #2a3754 !important;
    }

    .bg-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
      gap: 0.55rem;
      margin-bottom: 0.6rem;
    }

    .bg-kpi-card {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 9px;
      padding: 0.5rem 0.8rem;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.2s;
    }

    [data-theme="dark"] .bg-kpi-card {
      background: var(--color-surface, #131b2e) !important;
      border-color: #2a3754 !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    }

    .bg-kpi-card:hover {
      box-shadow: 0 3px 8px rgba(0,0,0,0.05);
      transform: translateY(-1px);
    }

    .bg-kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 3.5px;
      height: 100%;
      background: #5f06fa;
    }

    [data-theme="dark"] .bg-kpi-card::before {
      background: #a855f7;
    }

    .bg-kpi-title {
      font-size: 0.65rem;
      font-weight: 700;
      color: var(--color-text-muted, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 0.15rem;
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    [data-theme="dark"] .bg-kpi-title {
      color: #94a3b8 !important;
    }

    .bg-kpi-value {
      font-size: 1.15rem;
      line-height: 1.2;
      font-weight: 800;
      color: var(--color-text-main, #0f172a);
      font-family: 'Outfit', sans-serif;
    }

    [data-theme="dark"] .bg-kpi-value {
      color: #f8fafc !important;
    }

    .bg-kpi-subtitle {
      font-size: 0.68rem;
      color: var(--color-text-muted, #64748b);
      margin-top: 0.12rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    [data-theme="dark"] .bg-kpi-subtitle {
      color: #94a3b8 !important;
    }

    .bg-kpi-unit {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-muted, #64748b);
    }
    [data-theme="dark"] .bg-kpi-unit {
      color: #94a3b8 !important;
    }

    .bg-hero-badge {
      padding: 0.4rem 0.8rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-main);
    }
    .bg-hero-badge.purple {
      background: rgba(95, 6, 250, 0.08);
      border-color: rgba(95, 6, 250, 0.2);
      color: #5f06fa;
    }
    .bg-hero-badge.teal {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.2);
      color: #0f766e;
    }
    [data-theme="dark"] .bg-hero-badge.purple {
      background: rgba(168, 85, 247, 0.15) !important;
      border-color: rgba(168, 85, 247, 0.35) !important;
      color: #c084fc !important;
    }
    [data-theme="dark"] .bg-hero-badge.teal {
      background: rgba(20, 184, 166, 0.15) !important;
      border-color: rgba(20, 184, 166, 0.35) !important;
      color: #2dd4bf !important;
    }

    .bg-tariff-badge {
      font-size: 0.8rem;
      font-weight: 700;
      color: #5f06fa;
      background: rgba(95, 6, 250, 0.08);
      padding: 0.3rem 0.6rem;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    [data-theme="dark"] .bg-tariff-badge {
      color: #c084fc !important;
      background: rgba(168, 85, 247, 0.15) !important;
    }

    .bg-share-badge {
      background: rgba(95, 6, 250, 0.08);
      color: #5f06fa;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.72rem;
      display: inline-block;
    }
    [data-theme="dark"] .bg-share-badge {
      background: rgba(168, 85, 247, 0.15) !important;
      color: #c084fc !important;
    }

    /* Sub-tabs del Gestor */
    .bg-subnav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      border-bottom: 1.5px solid var(--color-border);
      margin-bottom: 0.55rem;
      padding-bottom: 0.35rem;
      flex-wrap: wrap;
    }

    .bg-subnav-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--color-text-muted);
      padding: 0.35rem 0.85rem;
      font-size: 0.78rem;
      font-weight: 700;
      border-radius: 7px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
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

    .bg-toolbar-btn {
      height: 31px;
      padding: 0 0.65rem;
      font-size: 0.75rem;
      font-weight: 700;
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      gap: 0.32rem;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s;
    }

    /* Conglomerados y Holdings */
    .bg-conglomerate-banner {
      background: linear-gradient(135deg, rgba(95, 6, 250, 0.06) 0%, rgba(124, 58, 237, 0.03) 100%);
      border: 1.5px solid rgba(95, 6, 250, 0.26);
      border-radius: 9px;
      padding: 0.42rem 0.85rem;
      margin-top: 0;
      margin-bottom: 0.55rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
      box-shadow: 0 1px 4px rgba(95, 6, 250, 0.04);
    }
    [data-theme="dark"] .bg-conglomerate-banner {
      background: linear-gradient(135deg, rgba(95, 6, 250, 0.16) 0%, rgba(30, 27, 75, 0.45) 100%);
      border-color: rgba(168, 85, 247, 0.35);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .bg-order-child-store-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 700;
      background: rgba(95, 6, 250, 0.08);
      color: #5f06fa;
      border: 1px solid rgba(95, 6, 250, 0.2);
      white-space: nowrap;
    }
    [data-theme="dark"] .bg-order-child-store-badge {
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
      border-color: rgba(168, 85, 247, 0.3);
    }
    .bg-order-pos-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 7px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 800;
      background: rgba(14, 165, 233, 0.14);
      color: #0284c7;
      border: 1px solid rgba(14, 165, 233, 0.38);
      white-space: nowrap;
      letter-spacing: 0.01em;
    }
    [data-theme="dark"] .bg-order-pos-badge {
      background: rgba(56, 189, 248, 0.18);
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.42);
    }

    /* Tabla editable tipo Excel */
    .bg-excel-table-container {
      max-height: calc(100vh - 230px);
      min-height: 480px;
      overflow-y: auto;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.02);
    }

    .bg-excel-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
      background: var(--color-surface);
    }

    .bg-excel-table th {
      position: sticky;
      top: 0;
      background: #f1f5f9;
      color: #1e293b;
      font-weight: 700;
      padding: 0.45rem 0.5rem;
      border: 1px solid #cbd5e1;
      text-align: left;
      z-index: 5;
      white-space: nowrap;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.35px;
    }

    [data-theme="dark"] .bg-excel-table th {
      background: #1e293b;
      color: #cbd5e1;
      border-color: #334155;
    }

    .bg-excel-table td {
      padding: 0.32rem 0.5rem;
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
      padding: 0.2rem 0.35rem;
      font-size: 0.78rem;
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

    /* Ocultar botones de incremento/decremento (steppers) para que no tapen los números */
    .bg-excel-input::-webkit-outer-spin-button,
    .bg-excel-input::-webkit-inner-spin-button,
    .bg-col-filter-input::-webkit-outer-spin-button,
    .bg-col-filter-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .bg-excel-input[type=number],
    .bg-col-filter-input[type=number] {
      -moz-appearance: textfield;
      appearance: textfield;
    }

    .bg-excel-select {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 0.2rem 0.45rem;
      font-size: 0.73rem;
      font-weight: 700;
      color: var(--color-text-main);
      cursor: pointer;
    }

    /* Fila de Filtros por Columna Sticky */
    .bg-excel-table thead tr:first-child th {
      position: sticky;
      top: 0;
      z-index: 6;
      height: 34px;
      box-sizing: border-box;
    }

    .bg-excel-table thead tr.bg-table-filter-row th {
      position: sticky;
      top: 34px;
      z-index: 5;
      background: #f8fafc;
      border-bottom: 2px solid #cbd5e1;
      padding: 3px 4px;
      box-sizing: border-box;
      font-weight: 500;
    }

    [data-theme="dark"] .bg-excel-table thead tr.bg-table-filter-row th {
      background: #1e293b;
      border-bottom-color: #334155;
    }

    .bg-col-filter-input {
      width: 100%;
      padding: 2px 5px;
      font-size: 0.7rem;
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
      padding: 2px 4px;
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

    .bg-table-locked .bg-excel-input,
    .bg-table-locked .bg-excel-select {
      pointer-events: none !important;
      background: transparent !important;
      border-color: transparent !important;
      box-shadow: none !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      cursor: default !important;
    }

    .bg-table-locked tbody input[type="checkbox"] {
      pointer-events: none !important;
      cursor: default !important;
      opacity: 0.72;
    }

    .bg-quick-filter-btn {
      padding: 2px 8px;
      font-size: 0.7rem;
      font-weight: 700;
      border-radius: 5px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 3px;
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

    /* Badges de Estado WMS */
    .bg-order-wms-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      letter-spacing: 0.2px;
      vertical-align: middle;
      white-space: nowrap;
    }
    .bg-wms-despachado {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }
    .bg-wms-pickeado {
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #bae6fd;
    }
    .bg-wms-preparacion {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .bg-wms-procesamiento {
      background: #ede9fe;
      color: #6d28d9;
      border: 1px solid #ddd6fe;
    }
    .bg-wms-incidencia {
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }
    .bg-wms-archivado {
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #cbd5e1;
    }
    .bg-wms-default {
      background: #f8fafc;
      color: #475569;
      border: 1px solid #e2e8f0;
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

    .stocka-entities-grid {
      display: flex;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
      width: 100%;
      box-sizing: border-box;
    }

    @media (max-width: 680px) {
      .stocka-entities-grid {
        flex-direction: column;
      }
    }

    .stocka-entity-card {
      flex: 1 1 0;
      width: 50%;
      min-width: 0;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
      box-sizing: border-box;
    }

    @media (max-width: 680px) {
      .stocka-entity-card {
        width: 100%;
      }
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

    /* Tarjetas Métricas en 1 Sola Línea con Estilo Único y Sobrio (4 o 5 tarjetas) */
    .stocka-metric-row {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      gap: 0.7rem;
      margin-bottom: 1.15rem;
      width: 100%;
    }

    @media (max-width: 720px) {
      .stocka-metric-row {
        flex-wrap: wrap;
      }
    }

    .stocka-metric-card {
      flex: 1 1 0;
      min-width: 0;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-top: 3px solid #5f06fa;
      border-radius: 8px;
      padding: 0.7rem 0.85rem;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .stocka-metric-title {
      font-size: 0.67rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 0.28rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .stocka-metric-value {
      font-size: 1.22rem;
      font-weight: 800;
      color: #0f172a;
      font-family: 'Outfit', sans-serif;
      line-height: 1.15;
      white-space: nowrap;
    }

    .stocka-metric-sub {
      font-size: 0.71rem;
      color: #64748b;
      margin-top: 0.28rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .stocka-banner-hero {
      background: linear-gradient(135deg, #5f06fa 0%, #6d28d9 60%, #4c1d95 100%);
      color: #ffffff;
      border-radius: 10px;
      padding: 1rem 1.35rem;
      margin-bottom: 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: nowrap;
      gap: 1.15rem;
      box-shadow: 0 4px 14px rgba(95, 6, 250, 0.24);
    }

    @media (max-width: 760px) {
      .stocka-banner-hero {
        flex-wrap: wrap;
      }
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
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-left: 4px solid #5f06fa;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    [data-theme="dark"] .bg-analytics-hero {
      background: var(--color-surface, #131b2e) !important;
      border-color: #2a3754 !important;
      border-left: 4px solid #a855f7 !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }

    .bg-chart-card {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 12px;
      padding: 1.25rem;
      box-shadow: 0 2px 6px rgba(0,0,0,0.03);
      position: relative;
    }

    [data-theme="dark"] .bg-chart-card {
      background: var(--color-surface, #131b2e) !important;
      border-color: #2a3754 !important;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
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

    /* Elementos interactivos que no deben verse en impresión/PDF */
    .no-print {
      transition: opacity 0.15s ease;
    }

    @media print {
      .no-print {
        display: none !important;
      }
    }

    /* Estilos de la Pestaña Checklist Global */
    .bg-checklist-hero {
      background: linear-gradient(135deg, rgba(95, 6, 250, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%);
      border: 1px solid var(--color-border);
      border-left: 4px solid #5f06fa;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .bg-checklist-progress-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 2px 6px rgba(0,0,0,0.02);
    }

    .bg-checklist-progress-bar-bg {
      background: #e2e8f0;
      border-radius: 999px;
      height: 10px;
      overflow: hidden;
      margin-top: 0.5rem;
      width: 100%;
    }

    .bg-checklist-progress-bar-fill {
      background: linear-gradient(90deg, #5f06fa 0%, #10b981 100%);
      height: 100%;
      border-radius: 999px;
      transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .bg-checklist-item-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 10px;
      padding: 0.85rem 1.15rem;
      margin-bottom: 0.65rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      transition: all 0.2s ease;
      cursor: pointer;
      user-select: none;
    }

    .bg-checklist-item-card:hover {
      border-color: #cbd5e1;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(0,0,0,0.04);
    }

    .bg-checklist-item-card.completed {
      background: #f8fafc;
      border-color: #d1fae5;
    }

    [data-theme="dark"] .bg-checklist-item-card.completed {
      background: rgba(16, 185, 129, 0.04);
      border-color: rgba(16, 185, 129, 0.2);
    }

    .bg-checklist-item-card.completed .checklist-title {
      color: #64748b;
      text-decoration: line-through;
    }

    .bg-checklist-check-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      color: #94a3b8;
      transition: transform 0.15s ease, color 0.15s ease;
      flex-shrink: 0;
    }

    .bg-checklist-check-btn:hover {
      transform: scale(1.15);
      color: #5f06fa;
    }

    .bg-checklist-check-btn.checked {
      color: #10b981;
    }

    .bg-checklist-badge-cat {
      font-size: 0.68rem;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
  `;
  document.head.appendChild(style);
}

// --- FORMATEADORES ---
export function formatCLP(val) {
  if (val === null || val === undefined || isNaN(val)) return '$0';
  const num = Math.round(Number(val));
  if (num < 0) {
    return '-$' + Math.abs(num).toLocaleString('es-CL');
  }
  return '$' + num.toLocaleString('es-CL');
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

  const fetchWithTimeout = async (url, ms = 1500) => {
    const fetchPromise = fetch(url);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), ms));
    return Promise.race([fetchPromise, timeoutPromise]);
  };

  // 1. Intentar consulta a mindicador.cl para la fecha exacta del día 1
  try {
    const res = await fetchWithTimeout(`https://mindicador.cl/api/uf/${dateStr}`, 1500);
    if (res.ok) {
      const data = await res.json();
      const val = data?.serie?.[0]?.valor;
      if (val && !isNaN(val) && val > 30000) {
        return { value: Math.round(val), dateStr: displayDateStr };
      }
    }
  } catch (e) {
    console.warn(`No se pudo obtener UF para fecha ${dateStr} (usando fallback rápido):`, e.message || e);
  }

  // 2. Si cayó en fin de semana, probar con el día 2 o 3
  try {
    const res2 = await fetchWithTimeout(`https://mindicador.cl/api/uf/02-${mmStr}-${year}`, 1500);
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

// Obtener mapa completo de conglomerados y relaciones de comercios mapeados
export async function getConglomerateMappings() {
  // Seed canónico por defecto de alta disponibilidad
  const canonicalConglomerates = [
    {
      canonicalName: 'BIG BANG',
      aliases: ['BIG BANG', 'BIG BANG SPA', 'HOLDING BIG BANG'],
      children: ['BACK IN TIME', 'DORMILONES', 'RELAJARTE']
    },
    {
      canonicalName: 'SILVER FOX',
      aliases: ['SILVER FOX', 'SILVER FOX SPA', 'HOLDING SILVER FOX'],
      children: ['FORTE MAX', 'MENPRIME']
    }
  ];

  const conglomeratesMap = {};
  const childToConglomerateMap = {};

  // Inicializar seed en ambos mapas
  canonicalConglomerates.forEach(cg => {
    cg.aliases.forEach(alias => {
      conglomeratesMap[alias.toUpperCase()] = [...cg.children];
    });
    cg.children.forEach(child => {
      childToConglomerateMap[child.toUpperCase()] = cg.canonicalName;
    });
  });

  try {
    const { data, error } = await supabase
      .from('billing_mappings')
      .select('comercio_nombre, billing_name');

    if (!error && data && data.length > 0) {
      data.forEach(m => {
        let parent = (m.billing_name || '').trim().toUpperCase();
        const child = (m.comercio_nombre || '').trim().toUpperCase();
        if (!parent || !child) return;

        // Normalizar alias canónicos
        if (parent === 'BIG BANG' || parent === 'BIG BANG SPA') parent = 'BIG BANG';
        if (parent === 'SILVER FOX' || parent === 'SILVER FOX SPA') parent = 'SILVER FOX';
        
        if (!conglomeratesMap[parent]) conglomeratesMap[parent] = [];
        if (!conglomeratesMap[parent].includes(child)) conglomeratesMap[parent].push(child);
        childToConglomerateMap[child] = parent;

        // Mantener sincronizado el alias corto/largo
        if (parent === 'BIG BANG') conglomeratesMap['BIG BANG SPA'] = conglomeratesMap['BIG BANG'];
        if (parent === 'SILVER FOX') conglomeratesMap['SILVER FOX SPA'] = conglomeratesMap['SILVER FOX'];
      });
    }
  } catch (e) {
    console.warn('Error cargando billing_mappings:', e);
  }

  // Detectar holdings en comercios_adicional_config por RUT común (>1 tienda)
  try {
    const { data: configs } = await supabase
      .from('comercios_adicional_config')
      .select('comercio, razon_social, rut');
    
    if (configs && configs.length > 0) {
      const byRut = {};
      configs.forEach(c => {
        const r = (c.rut || '').trim().toUpperCase();
        if (!r || r === '—' || r === '-') return;
        if (!byRut[r]) byRut[r] = [];
        byRut[r].push(c);
      });
      Object.entries(byRut).forEach(([rut, stores]) => {
        if (stores.length > 1) {
          let mainName = (stores[0].razon_social || stores[0].comercio || '').trim().toUpperCase();
          if (mainName.includes('BIG BANG')) mainName = 'BIG BANG';
          if (mainName.includes('SILVER FOX')) mainName = 'SILVER FOX';

          if (mainName) {
            const childNames = stores.map(s => s.comercio.trim().toUpperCase());
            if (!conglomeratesMap[mainName]) conglomeratesMap[mainName] = [];
            childNames.forEach(cn => {
              if (!conglomeratesMap[mainName].includes(cn)) conglomeratesMap[mainName].push(cn);
              childToConglomerateMap[cn] = mainName;
            });

            // Sincronizar alias
            if (mainName === 'BIG BANG') conglomeratesMap['BIG BANG SPA'] = conglomeratesMap['BIG BANG'];
            if (mainName === 'SILVER FOX') conglomeratesMap['SILVER FOX SPA'] = conglomeratesMap['SILVER FOX'];
          }
        }
      });
    }
  } catch (eH) {}

  // Construir lista canónica deduplicada para despliegue en UI (solo nombres canónicos únicos)
  const canonicalDisplayList = [];
  const addedCanonical = new Set();

  canonicalConglomerates.forEach(cg => {
    const canonicalName = cg.canonicalName;
    const resolvedChildren = Array.from(new Set(conglomeratesMap[canonicalName] || cg.children));
    canonicalDisplayList.push({
      name: canonicalName,
      children: resolvedChildren
    });
    addedCanonical.add(canonicalName.toUpperCase());
    cg.aliases.forEach(a => addedCanonical.add(a.toUpperCase()));
  });

  Object.keys(conglomeratesMap).forEach(k => {
    const kUpper = k.toUpperCase();
    if (!addedCanonical.has(kUpper) && !kUpper.includes('BIG BANG') && !kUpper.includes('SILVER FOX')) {
      canonicalDisplayList.push({
        name: k,
        children: [...conglomeratesMap[k]]
      });
      addedCanonical.add(kUpper);
    }
  });

  return { conglomeratesMap, childToConglomerateMap, canonicalDisplayList };
}

// Normalizar el comercio hijo de cada pedido a su nombre oficial dentro del conglomerado
export function normalizeOrderChildStore(orderComercio, conglomerateChildren = [], defaultCommerce = '') {
  if (!orderComercio) return defaultCommerce;
  const upper = String(orderComercio).trim().toUpperCase();
  for (const child of (conglomerateChildren || [])) {
    const cUpper = child.toUpperCase();
    if (upper === cUpper || upper.includes(cUpper) || cUpper.includes(upper)) {
      return child;
    }
  }
  return orderComercio;
}

// Detección de pedidos con agenda FULL MERCADOLIBRE para cobro de etiquetado
export function isFullMeliOrder(order) {
  if (!order) return false;
  const agenda = String(order.agenda || '').toUpperCase().trim();
  if (!agenda) return false;
  return agenda.includes('FULL MERCADOLIBRE') || 
         agenda.includes('FULL MERCADO LIBRE') || 
         (agenda.includes('FULL') && (agenda.includes('MERCADO') || agenda.includes('MELI')));
}
window.isFullMeliOrder = isFullMeliOrder;

// Detección de pedidos generados en Punto de Venta físico (POS)
export function isPosSaleOrder(order) {
  if (!order) return false;
  if (order.isPosOrder === true || order.deliveryType === 'POS') return true;
  const orderNum = String(order.external_order_number || order.orderNumber || order.externalOrderNumber || '').trim().toUpperCase();
  if (orderNum.startsWith('POS-') || orderNum.startsWith('VTA-')) return true;
  const cat = String(order.categoria_entrega || order.categoriaEntrega || '').trim().toUpperCase();
  if (cat === 'SHOP POINT (POS)' || cat === 'SHOP POINT' || cat === 'POS') return true;
  const orig = String(order.origen || '').trim().toUpperCase();
  const plat = String(order.external_platform || order.platform || order.externalPlatform || '').trim().toUpperCase();
  if (orig === 'PUNTO DE VENTA' || orig === 'POS' || plat === 'PUNTO DE VENTA' || plat === 'POS' || plat.includes('PUNTO DE VENTA')) return true;
  const ag = String(order.agenda || '').trim().toUpperCase();
  if (ag === 'COMPRA EN BODEGA' || ag === 'PUNTO DE VENTA' || ag === 'POS') return true;
  if (order.raw_shopify_data?.is_pos_sale) return true;
  const shipMethod = String(order.shipping_method || order.shippingMethod || '').trim().toUpperCase();
  if (shipMethod.includes('PUNTO DE VENTA') || shipMethod.includes('COMPRA EN BODEGA') || shipMethod.includes('VENTA PRESENCIAL')) return true;
  return false;
}
window.isPosSaleOrder = isPosSaleOrder;

// Resolver la Categoría de Pedido canónica para el Gestor de Facturación
export function resolveOrderBillingCategoria(order) {
  if (!order) return 'DISTRIBUCIÓN';
  if (isPosSaleOrder(order)) return 'SHOP POINT (POS)';

  const rawCat = String(order.categoriaEntrega || order.categoria_entrega || '').trim().toUpperCase();
  if (rawCat === 'SHOP POINT (POS)' || rawCat === 'SHOP POINT' || rawCat === 'POS') {
    return 'SHOP POINT (POS)';
  }

  const orderNum = String(order.external_order_number || order.orderNumber || order.externalOrderNumber || '').trim().toUpperCase();
  const plat = String(order.external_platform || order.platform || order.externalPlatform || '').trim().toUpperCase();
  const shipMethod = String(order.shipping_method || order.shippingMethod || '').trim().toUpperCase();
  if (
    rawCat.includes('INVERSA') ||
    plat.includes('INVERSA') ||
    orderNum.startsWith('LI-') ||
    order.raw_shopify_data?.is_reverse_logistics ||
    shipMethod.includes('LOGISTICA INVERSA') ||
    shipMethod.includes('LOGÍSTICA INVERSA')
  ) {
    return 'LOGÍSTICA INVERSA';
  }

  const ag = String(order.agenda || '').trim().toUpperCase();
  const deliv = String(order.deliveryType || '').trim().toUpperCase();
  if (rawCat === 'RETIRO' || deliv === 'RETIRO' || ag.includes('RETIRO')) {
    return 'RETIRO';
  }

  return 'DISTRIBUCIÓN';
}
window.resolveOrderBillingCategoria = resolveOrderBillingCategoria;

// Generar el badge HTML estilizado para la columna Categoría de Pedido en las tablas tipo Excel
export function getBillingOrderCategoriaBadgeHTML(order) {
  const cat = resolveOrderBillingCategoria(order);
  if (cat === 'SHOP POINT (POS)') {
    return `<span class="bg-order-cat-badge bg-cat-pos" style="display: inline-flex; align-items: center; gap: 4px; background: rgba(14, 165, 233, 0.12); color: #0284c7; border: 1px solid rgba(14, 165, 233, 0.35); padding: 2px 7px; border-radius: 5px; font-size: 0.68rem; font-weight: 800; white-space: nowrap;" title="Categoría: Shop Point (Punto de Venta)"><i class="ri-shopping-cart-2-line"></i> Shop Point (POS)</span>`;
  }
  if (cat === 'LOGÍSTICA INVERSA') {
    return `<span class="bg-order-cat-badge bg-cat-reverse" style="display: inline-flex; align-items: center; gap: 4px; background: rgba(124, 58, 237, 0.12); color: #7c3aed; border: 1px solid rgba(124, 58, 237, 0.32); padding: 2px 7px; border-radius: 5px; font-size: 0.68rem; font-weight: 800; white-space: nowrap;" title="Categoría: Logística Inversa"><i class="ri-arrow-left-right-line"></i> Logística Inversa</span>`;
  }
  if (cat === 'RETIRO') {
    return `<span class="bg-order-cat-badge bg-cat-retiro" style="display: inline-flex; align-items: center; gap: 4px; background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); padding: 2px 7px; border-radius: 5px; font-size: 0.68rem; font-weight: 800; white-space: nowrap;" title="Categoría: Retiro en Bodega / Sucursal"><i class="ri-store-2-line"></i> Retiro</span>`;
  }
  return `<span class="bg-order-cat-badge bg-cat-dist" style="display: inline-flex; align-items: center; gap: 4px; background: rgba(37, 99, 235, 0.10); color: #2563eb; border: 1px solid rgba(37, 99, 235, 0.28); padding: 2px 7px; border-radius: 5px; font-size: 0.68rem; font-weight: 800; white-space: nowrap;" title="Categoría: Distribución"><i class="ri-truck-line"></i> Distribución</span>`;
}
window.getBillingOrderCategoriaBadgeHTML = getBillingOrderCategoriaBadgeHTML;

// Calcular desglose métrico por tienda dentro de un conglomerado
export function computeConglomerateStoreBreakdown(orders = [], bState = {}) {
  const children = bState.conglomerateChildren || [];
  if (!bState.isConglomerate || children.length === 0) {
    return [];
  }

  const breakdown = [];

  children.forEach(storeName => {
    const storeUpper = storeName.toUpperCase();
    const storeOrders = (orders || []).filter(o => {
      const oCom = String(o.comercio || '').toUpperCase();
      return oCom === storeUpper || oCom.includes(storeUpper) || storeUpper.includes(oCom);
    });

    const billableOrders = storeOrders.filter(o => !o.isExcluded);
    const pickPackNet = billableOrders.reduce((sum, o) => sum + (o.pickPackTotal || 0), 0);
    const shippingFreightNet = billableOrders.reduce((sum, o) => sum + (o.shippingFreight || 0), 0);

    // Cobro de Etiqueta FULL de MELI para esta tienda ($100 por unidad en pedidos con agenda FULL MERCADOLIBRE)
    const storeMeliFullOrders = billableOrders.filter(o => isFullMeliOrder(o));
    const storeMeliFullUnits = storeMeliFullOrders.reduce((sum, o) => sum + (Math.max(1, parseInt(o.unitsCount, 10) || 1)), 0);
    const storeMeliFullNet = storeMeliFullUnits * 100;

    const shippingRmCount = billableOrders.filter(o => (o.deliveryType === 'RM_STK' || o.deliveryType === 'FLEX' || o.deliveryType === 'COLINA') && !o.isConsolidatedSecondary && (o.shippingFreight || 0) > 0).length;
    const shippingEnviameCount = billableOrders.filter(o => (o.deliveryType === 'ENVIAME' || o.deliveryType === 'REGION' || o.deliveryType === 'ENVIAME_REGION') && !o.isConsolidatedSecondary).length;
    const totalSalesTicket = storeOrders.reduce((sum, o) => sum + (o.ticketVenta || 0), 0);
    const avgTicket = storeOrders.length > 0 ? Math.round(totalSalesTicket / storeOrders.length) : 0;
    const mktCount = storeOrders.filter(o => o.isMarketplace).length;
    const excludedOrders = storeOrders.length - billableOrders.length;

    const storeTotalNet = pickPackNet + shippingFreightNet + storeMeliFullNet;

    breakdown.push({
      storeName,
      totalOrders: storeOrders.length,
      billableOrders: billableOrders.length,
      excludedOrders,
      shippingRmCount,
      shippingEnviameCount,
      mktCount,
      avgTicket,
      pickPackNet,
      shippingFreightNet,
      meliFullOrdersCount: storeMeliFullOrders.length,
      meliFullUnitsCount: storeMeliFullUnits,
      meliFullNet: storeMeliFullNet,
      totalSalesTicket,
      storeTotalNet,
      sharePct: 0
    });
  });

  const totalOperationalNet = breakdown.reduce((sum, s) => sum + (s.storeTotalNet || 0), 0);
  const totalOrdersAll = breakdown.reduce((sum, s) => sum + (s.totalOrders || 0), 0);

  breakdown.forEach(s => {
    if (totalOperationalNet > 0) {
      s.sharePct = parseFloat(((s.storeTotalNet / totalOperationalNet) * 100).toFixed(1));
    } else if (totalOrdersAll > 0) {
      s.sharePct = parseFloat(((s.totalOrders / totalOrdersAll) * 100).toFixed(1));
    } else {
      s.sharePct = 0;
    }
  });

  return breakdown;
}

// Calcular ranking de productos y estadísticas de artículos vendidos desde una lista de pedidos
export function computeProductsStatsFromOrders(orders = []) {
  const billableOrders = (orders || []).filter(o => !o.isExcluded);
  const productMap = {};
  let totalUnitsSold = 0;

  billableOrders.forEach(ord => {
    let items = (ord.items && ord.items.length > 0) ? ord.items : null;

    if (!items || items.length === 0) {
      const rawSku = (ord.sku && ord.sku !== 'null') ? String(ord.sku).trim() : '';
      const rawItem = (ord.item && ord.item !== 'null') ? String(ord.item).trim() : '';

      if (rawSku.includes(',') || rawItem.includes(',')) {
        const skus = rawSku ? rawSku.split(',').map(s => s.trim()) : [];
        const names = rawItem ? rawItem.split(',').map(n => n.trim()) : [];
        const maxLen = Math.max(skus.length, names.length);
        items = [];
        for (let i = 0; i < maxLen; i++) {
          const s = skus[i] || skus[0] || 'S/SKU';
          const n = names[i] || names[0] || s || 'Producto';
          items.push({ sku: s, name: n, quantity: 1 });
        }
      } else if (rawSku || rawItem) {
        items = [{
          sku: rawSku || 'S/SKU',
          name: rawItem || rawSku || 'Producto',
          quantity: parseInt(ord.unitsCount || ord.cantidad, 10) || 1
        }];
      } else {
        items = [{
          sku: 'S/SKU',
          name: `Pedido #${ord.orderNumber || ord.externalOrderNumber || (ord.id ? ord.id.slice(0, 8) : 'General')}`,
          quantity: parseInt(ord.unitsCount || ord.cantidad, 10) || 1
        }];
      }
    }

    items.forEach(it => {
      const key = it.sku && it.sku !== 'S/SKU' ? it.sku : (it.name || 'Desconocido');
      const qty = parseInt(it.quantity, 10) || 1;
      totalUnitsSold += qty;
      if (!productMap[key]) {
        productMap[key] = {
          sku: it.sku || 'S/SKU',
          name: it.name || 'Producto',
          quantity: 0
        };
      }
      productMap[key].quantity += qty;
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

  return {
    totalUnits: totalUnitsSold,
    avgUnitsPerOrder: billableOrders.length > 0 ? parseFloat((totalUnitsSold / billableOrders.length).toFixed(2)) : 0,
    topProducts: sortedProducts.slice(0, 10),
    allProducts: sortedProducts
  };
}

// Resolver comercios mapeados (Punto A del análisis crítico)
export async function resolveCommerceGroup(commerceName) {
  if (!commerceName) return [commerceName];
  const clean = commerceName.trim();
  const upper = clean.toUpperCase();

  const { conglomeratesMap } = await getConglomerateMappings();

  let group = [];
  
  // Detección directa y exhaustiva de Holdings conocidos
  if (upper === 'BIG BANG' || upper === 'BIG BANG SPA' || upper.includes('BIG BANG')) {
    const list = conglomeratesMap['BIG BANG'] || conglomeratesMap['BIG BANG SPA'] || ['BACK IN TIME', 'DORMILONES', 'RELAJARTE'];
    group = ['BIG BANG', 'BIG BANG SPA', ...list];
  } else if (upper === 'SILVER FOX' || upper === 'SILVER FOX SPA' || upper.includes('SILVER FOX')) {
    const list = conglomeratesMap['SILVER FOX'] || conglomeratesMap['SILVER FOX SPA'] || ['FORTE MAX', 'MENPRIME'];
    group = ['SILVER FOX', 'SILVER FOX SPA', ...list];
  } else if (conglomeratesMap[upper] && conglomeratesMap[upper].length > 0) {
    group = [clean, ...conglomeratesMap[upper]];
  } else {
    // Comercio o tienda individual (ej: DORMILONES, BACK IN TIME, STREET GYM, etc.)
    // Se factura de manera individual para esa tienda específica
    group = [clean];
  }

  // Deduplicar respetando mayúsculas/minúsculas pero agregando variantes comunes para queries Supabase case-sensitive
  const resultSet = new Set();
  group.forEach(name => {
    if (!name) return;
    const n = name.trim();
    resultSet.add(n);
    resultSet.add(n.toUpperCase());
    resultSet.add(n.toLowerCase());
  });

  return Array.from(resultSet);
}

// Obtener datos legales del comercio (Razón Social, RUT, Sigla, Contacto)
export async function getCommerceBillingInfo(commerceName) {
  const cleanName = (commerceName || '').trim();
  const result = {
    comercio: cleanName,
    razonSocial: cleanName,
    rut: '—',
    sigla: '—',
    direccion: '—',
    emailFacturacion: '—'
  };

  try {
    // 1. Sigla y ID desde v_comercios_config
    const { data: vConfig } = await supabase
      .from('v_comercios_config')
      .select('id, sigla, nombre')
      .ilike('nombre', cleanName)
      .maybeSingle();

    if (vConfig && vConfig.sigla) {
      result.sigla = vConfig.sigla.toUpperCase().trim();
    }

    // 2. Datos legales adicionales y configuración POS desde comercios_adicional_config
    let extra = null;
    const { data: extraByName } = await supabase
      .from('comercios_adicional_config')
      .select('razon_social, rut, email_colaborador, onboarding_checklist')
      .ilike('comercio', cleanName)
      .maybeSingle();

    if (extraByName) {
      extra = extraByName;
    } else if (vConfig && vConfig.id) {
      const { data: extraById } = await supabase
        .from('comercios_adicional_config')
        .select('razon_social, rut, email_colaborador, onboarding_checklist')
        .eq('comercio_id', vConfig.id)
        .maybeSingle();
      if (extraById) extra = extraById;
    }

    if (extra) {
      if (extra.razon_social && extra.razon_social.trim()) {
        result.razonSocial = extra.razon_social.trim();
      }
      if (extra.rut && extra.rut.trim()) {
        result.rut = extra.rut.trim();
      }
      if (extra.email_colaborador && extra.email_colaborador.trim()) {
        result.emailFacturacion = extra.email_colaborador.trim();
      }
    }

    // Comprobar también en window.cachedAdminMerchants o window.loadedCommerceConfigsMap
    let cachedMerch = null;
    if (typeof window !== 'undefined' && Array.isArray(window.cachedAdminMerchants)) {
      cachedMerch = window.cachedAdminMerchants.find(m => m.nombre && m.nombre.trim().toLowerCase() === cleanName.toLowerCase());
    }
    const obChecklist = extra?.onboarding_checklist || cachedMerch?.onboarding_checklist || null;
    result.onboardingChecklist = obChecklist;

    // Resolver POS config del comercio
    const isPosActive = obChecklist?.pos_active === true;
    const machine = obChecklist?.pos_machine || {};
    const ownerStr = String(machine.owner || '').trim();
    let isStocka = false;
    if (ownerStr.toUpperCase().includes('STOCKA') || (machine.brand || '').toUpperCase().includes('STOCKA')) {
      isStocka = true;
    } else if (ownerStr.toLowerCase().includes('propiedad de') || ownerStr.toLowerCase().includes('propio') || ownerStr.toUpperCase().includes(cleanName.toUpperCase())) {
      isStocka = false;
    } else {
      isStocka = false;
    }

    result.posConfig = {
      active: isPosActive,
      isStockaMachine: isStocka,
      ownerText: ownerStr || (isStocka ? 'Propiedad de STOCKA' : `Propiedad de ${cleanName}`),
      brand: machine.brand || '',
      model: machine.model || '',
      color: machine.color || '',
      notes: machine.notes || ''
    };

    // 3. Si es un conglomerado o no se encontró RUT, intentar obtener datos legales y POS de sus comercios asociados
    try {
      const groupStores = await resolveCommerceGroup(cleanName);
      const childStores = groupStores.filter(s => s.toUpperCase() !== cleanName.toUpperCase());
      if (childStores.length > 0) {
        const { data: childConfigs } = await supabase
          .from('comercios_adicional_config')
          .select('comercio, razon_social, rut, email_colaborador, onboarding_checklist')
          .in('comercio', childStores);
        
        if (childConfigs && childConfigs.length > 0) {
          const validChild = childConfigs.find(c => c.rut && c.rut !== '—' && c.rut.trim() !== '') || childConfigs[0];
          if (validChild) {
            if ((!result.rut || result.rut === '—') && validChild.rut) result.rut = validChild.rut.trim();
            if ((!result.razonSocial || result.razonSocial === cleanName) && validChild.razon_social) result.razonSocial = validChild.razon_social.trim();
            if ((!result.emailFacturacion || result.emailFacturacion === '—') && validChild.email_colaborador) result.emailFacturacion = validChild.email_colaborador.trim();
          }
        }

        // Mapear configuración POS de tiendas del conglomerado (deduplicadas por nombre en mayúsculas)
        const uniqueChildStores = [];
        const seenChildUpper = new Set();
        childStores.forEach(s => {
          const up = String(s || '').trim().toUpperCase();
          if (up && up !== cleanName.toUpperCase() && !seenChildUpper.has(up)) {
            seenChildUpper.add(up);
            uniqueChildStores.push(up);
          }
        });

        result.childPosConfigs = uniqueChildStores.map(childName => {
          const chCfg = (childConfigs || []).find(c => c.comercio?.trim().toLowerCase() === childName.toLowerCase());
          const chCached = (typeof window !== 'undefined' && Array.isArray(window.cachedAdminMerchants))
            ? window.cachedAdminMerchants.find(m => m.nombre && m.nombre.trim().toLowerCase() === childName.toLowerCase())
            : null;
          const chOb = chCfg?.onboarding_checklist || chCached?.onboarding_checklist || {};
          const chMach = chOb.pos_machine || {};
          const chOwner = String(chMach.owner || '').trim();
          const chIsStocka = chOwner.toUpperCase().includes('STOCKA') || (chMach.brand || '').toUpperCase().includes('STOCKA');
          return {
            store: childName,
            posConfig: {
              active: chOb.pos_active === true,
              isStockaMachine: chIsStocka,
              ownerText: chOwner || (chIsStocka ? 'Propiedad de STOCKA' : `Propiedad de ${childName}`),
              brand: chMach.brand || '',
              model: chMach.model || '',
              color: chMach.color || '',
              notes: chMach.notes || ''
            }
          };
        });
      }
    } catch (eChild) {
      console.warn('Error resolviendo datos fiscales de comercios del conglomerado:', eChild);
    }
  } catch (e) {
    console.warn('Error cargando información legal del comercio:', e);
  }

  // Si aún no hay sigla y es un conglomerado conocido, usar nombre
  if (result.sigla === '—') {
    const upper = cleanName.toUpperCase();
    if (upper === 'BIG BANG') result.sigla = 'BIG BANG';
    else if (upper === 'SILVER FOX') result.sigla = 'SILVER FOX';
    else if (cleanName.length <= 5) result.sigla = cleanName.toUpperCase();
  }

  // Fallback a localStorage si el usuario guardó datos legales previamente en el navegador
  try {
    const localLegalStr = localStorage.getItem(`stocka_commerce_legal_${cleanName}`);
    if (localLegalStr) {
      const lLegal = JSON.parse(localLegalStr);
      if (lLegal.razonSocial && result.razonSocial === cleanName) result.razonSocial = lLegal.razonSocial;
      if (lLegal.rut && lLegal.rut !== '—' && (result.rut === '—' || !result.rut)) result.rut = lLegal.rut;
      if (lLegal.sigla && lLegal.sigla !== '—' && (result.sigla === '—' || !result.sigla)) result.sigla = lLegal.sigla;
    }
  } catch (e) {}

  return result;
}

// Obtener volumen promedio diario de almacenamiento del mes calendario (Punto B) y desglose por tienda del conglomerado
export async function getMonthlyStorageVolume(commerceGroup, year, month) {
  if (!commerceGroup || commerceGroup.length === 0 || !year || !month) {
    return { averageM3: 0, daysCount: 0, dailyLogs: [], byStore: {} };
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
      const dailyByStoreMap = {};
      const storeDatesMap = {};

      data.forEach(item => {
        const d = item.fecha;
        const v = parseFloat(item.volumen) || 0;
        const storeKey = String(item.comercio || '').trim().toUpperCase();
        dailyMap[d] = (dailyMap[d] || 0) + v;

        if (storeKey) {
          if (!dailyByStoreMap[d]) dailyByStoreMap[d] = {};
          dailyByStoreMap[d][storeKey] = parseFloat(((dailyByStoreMap[d][storeKey] || 0) + v).toFixed(4));

          if (!storeDatesMap[storeKey]) storeDatesMap[storeKey] = {};
          storeDatesMap[storeKey][d] = (storeDatesMap[storeKey][d] || 0) + v;
        }
      });

      const dates = Object.keys(dailyMap).sort();
      const daysCount = dates.length;
      const totalVolumeSum = dates.reduce((acc, d) => acc + dailyMap[d], 0);
      const averageM3 = daysCount > 0 ? (totalVolumeSum / daysCount) : 0;

      const byStore = {};
      Object.keys(storeDatesMap).forEach(storeKey => {
        const sMap = storeDatesMap[storeKey];
        const sDates = Object.keys(sMap).sort();
        const sDaysCount = sDates.length;
        const sTotalSum = sDates.reduce((acc, d) => acc + sMap[d], 0);
        const sAvg = sDaysCount > 0 ? (sTotalSum / sDaysCount) : 0;
        const sVols = sDates.map(d => sMap[d]);
        const sMax = sVols.length > 0 ? Math.max(...sVols) : 0;
        const sMin = sVols.length > 0 ? Math.min(...sVols) : 0;

        byStore[storeKey] = {
          storeName: storeKey,
          averageM3: parseFloat(sAvg.toFixed(4)),
          daysCount: sDaysCount,
          maxDailyVolume: parseFloat(sMax.toFixed(4)),
          minDailyVolume: parseFloat(sMin.toFixed(4)),
          dailyLogs: dates.map(d => ({
            date: d,
            volume: parseFloat((sMap[d] || 0).toFixed(4))
          }))
        };
      });

      return {
        averageM3: parseFloat(averageM3.toFixed(4)),
        daysCount,
        dailyLogs: dates.map(d => ({
          date: d,
          volume: parseFloat(dailyMap[d].toFixed(4)),
          byStore: dailyByStoreMap[d] || {}
        })),
        byStore
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
      const byStore = {};
      let sum = 0;
      curVol.forEach(c => {
        const v = parseFloat(c.volumen_actual) || 0;
        sum += v;
        const storeKey = String(c.comercio || '').trim().toUpperCase();
        if (storeKey) {
          const prev = byStore[storeKey]?.averageM3 || 0;
          const nextVol = parseFloat((prev + v).toFixed(4));
          byStore[storeKey] = {
            storeName: storeKey,
            averageM3: nextVol,
            daysCount: 1,
            maxDailyVolume: nextVol,
            minDailyVolume: nextVol,
            dailyLogs: []
          };
        }
      });
      return {
        averageM3: parseFloat(sum.toFixed(4)),
        daysCount: 1,
        dailyLogs: [],
        byStore
      };
    }
  } catch (e) {}

  return { averageM3: 0, daysCount: 0, dailyLogs: [], byStore: {} };
}

// Generar serie diaria constante (línea fija en el tiempo) para cuando el Admin fija un volumen mensual manual
export function generateConstantDailyStorageLogs(year, month, volumeM3) {
  const y = parseInt(year, 10) || new Date().getFullYear();
  const m = parseInt(month, 10) || (new Date().getMonth() + 1);
  const mm = String(m).padStart(2, '0');
  const lastDay = new Date(y, m, 0).getDate();
  const fixedVol = parseFloat((Math.max(0, parseFloat(volumeM3) || 0)).toFixed(4));
  const logs = [];
  for (let d = 1; d <= lastDay; d++) {
    logs.push({
      date: `${y}-${mm}-${String(d).padStart(2, '0')}`,
      volume: fixedVol
    });
  }
  return logs;
}

// --- FUNCIONES AUXILIARES PARA COLUMNAS PERSONALIZADAS DE COBRO (RECARGOS PREPARACIÓN) ---
export function calculateCustomColumnRuleAmount(col, order) {
  if (!col || !order) return 0;
  const rate = Math.max(0, Number(col.rate) || 0);
  if (col.mode === 'per_unit') {
    const units = Math.max(1, parseInt(order.unitsCount, 10) || 1);
    return Math.round(rate * units);
  }
  return Math.round(rate);
}

export function computeOrderCustomSurchargesTotal(order, customColumns = null) {
  if (!order) return 0;
  const cols = Array.isArray(customColumns) ? customColumns : (billingState.customColumns || []);
  if (!order.customSurcharges || typeof order.customSurcharges !== 'object') return 0;
  if (cols.length > 0) {
    return cols.reduce((acc, col) => {
      if (!col || !col.id) return acc;
      return acc + Math.max(0, Math.round(Number(order.customSurcharges[col.id]) || 0));
    }, 0);
  }
  return Object.values(order.customSurcharges).reduce((acc, v) => acc + Math.max(0, Math.round(Number(v) || 0)), 0);
}

export function recomputeOrderPickPackWithCustomColumns(order, customColumns = null) {
  if (!order) return;
  const cols = Array.isArray(customColumns) ? customColumns : (billingState.customColumns || []);
  if (!order.customSurcharges || typeof order.customSurcharges !== 'object') {
    order.customSurcharges = {};
  }
  if (!order.customSurchargesMeta || typeof order.customSurchargesMeta !== 'object') {
    order.customSurchargesMeta = {};
  }

  let customTotal = 0;
  cols.forEach(col => {
    if (!col || !col.id) return;
    const meta = order.customSurchargesMeta[col.id];
    const isManual = meta === 'manual' || (typeof meta === 'object' && Boolean(meta.isManual));
    const isRule = meta === 'rule' || (typeof meta === 'object' && Boolean(meta.enabled) && !meta.isManual);
    let val = order.customSurcharges[col.id];

    if (isManual) {
      val = Math.max(0, Math.round(Number(val) || 0));
      order.customSurcharges[col.id] = val;
      order.customSurchargesMeta[col.id] = 'manual';
    } else if (isRule) {
      val = calculateCustomColumnRuleAmount(col, order);
      order.customSurcharges[col.id] = val;
      order.customSurchargesMeta[col.id] = 'rule';
    } else if (val !== undefined && val !== null) {
      val = Math.max(0, Math.round(Number(val) || 0));
      order.customSurcharges[col.id] = val;
      order.customSurchargesMeta[col.id] = 'rule';
    } else {
      val = calculateCustomColumnRuleAmount(col, order);
      order.customSurcharges[col.id] = val;
      order.customSurchargesMeta[col.id] = 'rule';
    }

    customTotal += val;
  });

  order.customSurchargesTotal = customTotal;
  order.pickPackTotal = (order.baseRate || 0) + (order.surchargeSku || 0) + (order.surchargeUnits || 0) + (order.surchargeMarketplace || 0) + customTotal;
  order.orderTotal = order.pickPackTotal + (order.shippingFreight || 0);
}

// Guardia de protección para periodos cerrados / confirmados / pagados
export function guardBillingLocked(actionLabel = 'modificar este registro') {
  if (!billingState.isLocked) return false;
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'warning',
      title: billingState.isPaid ? '🔒 Periodo Cerrado y Pagado' : '🔒 Periodo Confirmado (Solo Lectura)',
      text: billingState.isPaid
        ? `No es posible ${actionLabel} porque este periodo ya fue confirmado y pagado.`
        : `El desglose está bloqueado en modo lectura. Usa "Reabrir para Rectificar" si necesitas editarlo.`,
      showConfirmButton: false,
      timer: 3200
    });
  }
  return true;
}
window.guardBillingLocked = guardBillingLocked;

// Hidratar estado de facturación directamente desde un Snapshot congelado (0 consultas de recálculo)
function hydrateBillingStateFromSnapshot(snapshot, commerceName, periodName, periodYear, periodMonth) {
  sanitizeSnapshotOrdersMarketplace(snapshot);

  billingState.currentCommerce = commerceName;
  billingState.currentPeriodName = periodName || snapshot.periodName || billingState.currentPeriodName;
  billingState.currentPeriodYear = snapshot.currentPeriodYear || periodYear;
  billingState.currentPeriodMonth = snapshot.currentPeriodMonth || periodMonth;

  const upperComm = String(commerceName || '').trim().toUpperCase();
  const isConglom = Boolean(
    snapshot.isConglomerate ||
    upperComm.includes('BIG BANG') ||
    upperComm.includes('SILVER FOX') ||
    (Array.isArray(snapshot.conglomerateChildren) && snapshot.conglomerateChildren.length > 0)
  );
  billingState.isConglomerate = isConglom;
  billingState.conglomerateName = snapshot.conglomerateName || (isConglom ? (upperComm.includes('BIG BANG') ? 'BIG BANG' : (upperComm.includes('SILVER FOX') ? 'SILVER FOX' : upperComm)) : null);

  let childrenList = Array.isArray(snapshot.conglomerateChildren) ? snapshot.conglomerateChildren : [];
  if (isConglom && childrenList.length === 0 && Array.isArray(snapshot.orders)) {
    const distinctStores = Array.from(new Set(snapshot.orders.map(o => String(o.comercio || '').trim()).filter(Boolean)));
    if (distinctStores.length > 0) childrenList = distinctStores;
  }
  billingState.conglomerateChildren = childrenList;
  billingState.selectedAsChildStore = false;
  billingState.activeConglomerateStoreFilter = null;

  billingState.commerceInfo = snapshot.commerceInfo
    ? { ...snapshot.commerceInfo }
    : { comercio: commerceName, razonSocial: commerceName, rut: '—', sigla: '—' };

  if (snapshot.invoiceDates) {
    billingState.invoiceDates = { ...billingState.invoiceDates, ...snapshot.invoiceDates };
  }

  billingState.pricingConfig = sanitizeAndMergeConfig(snapshot.pricingConfig || billingState.pricingConfig || DEFAULT_PRICING_CONFIG);
  billingState.ufValue = Number(snapshot.ufValue) || 40884;
  billingState.ufDate = snapshot.ufDate || `01/${String(billingState.currentPeriodMonth).padStart(2, '0')}/${billingState.currentPeriodYear}`;

  const volM3 = Number(snapshot.volumeM3) || 0;
  billingState.volumeM3 = parseFloat(volM3.toFixed(4));
  billingState.isManualVolume = Boolean(snapshot.isManualVolume || snapshot.totals?.isManualVolume);
  billingState.autoVolumeM3 = Number(snapshot.autoVolumeM3 ?? volM3) || 0;
  billingState.volumeDailyAverage = Number(snapshot.volumeDailyAverage ?? volM3) || 0;
  billingState.volumeDaysLogged = Number(snapshot.volumeDaysLogged) || 30;
  billingState.dailyStorageLogs = Array.isArray(snapshot.dailyStorageLogs) ? snapshot.dailyStorageLogs : [];
  billingState.autoDailyStorageLogs = billingState.dailyStorageLogs;
  billingState.autoVolumeDaysLogged = billingState.volumeDaysLogged;

  const sessKey = `${billingState.currentPeriodId}_${commerceName}`;
  billingState.volumeSessionKey = sessKey;
  billingState.suppliesSessionKey = sessKey;
  billingState.adjustmentsSessionKey = sessKey;
  billingState.abonosSessionKey = sessKey;
  billingState.customColumnsSessionKey = sessKey;

  billingState.volumeStats = snapshot.volumeStats || {
    averageM3: billingState.volumeM3,
    daysCount: billingState.volumeDaysLogged,
    maxDailyVolume: billingState.volumeM3,
    minDailyVolume: billingState.volumeM3
  };
  billingState.storageByStore = (snapshot.storageByStore && typeof snapshot.storageByStore === 'object')
    ? snapshot.storageByStore
    : {};

  billingState.inboundDeclarations = Array.isArray(snapshot.inboundDeclarations) ? snapshot.inboundDeclarations : [];
  billingState.activeRange = snapshot.activeRange || null;
  billingState.orders = Array.isArray(snapshot.orders)
    ? snapshot.orders.map((o, idx) => ({ ...o, rowNumber: o.rowNumber || idx + 1 }))
    : [];
  billingState.customColumns = Array.isArray(snapshot.customColumns) ? snapshot.customColumns : [];
  billingState.supplies = Array.isArray(snapshot.supplies) ? snapshot.supplies : [];
  billingState.adjustments = Array.isArray(snapshot.adjustments) ? snapshot.adjustments : [];
  billingState.abonos = Array.isArray(snapshot.abonos) ? snapshot.abonos : [];
  billingState.posAbonoSales = Array.isArray(snapshot.posAbonoSales) ? snapshot.posAbonoSales : null;
  billingState.posAbonoSummary = snapshot.posAbonoSummary || null;
  billingState.allMerchantPosSales = Array.isArray(snapshot.allMerchantPosSales) ? snapshot.allMerchantPosSales : [];

  billingState.totals = {
    ...billingState.totals,
    ...(snapshot.totals || {})
  };

  billingState.productsStats = (snapshot.productsStats && Array.isArray(snapshot.productsStats.topProducts) && snapshot.productsStats.topProducts.length > 0)
    ? snapshot.productsStats
    : computeProductsStatsFromOrders(billingState.orders);

  billingState.storeBreakdown = billingState.isConglomerate
    ? computeConglomerateStoreBreakdown(billingState.orders, billingState)
    : [];

  billingState.version = snapshot.version || billingState.snapshotVersion || 1;
  billingState.publishedAt = snapshot.publishedAt || snapshot.generatedAt || null;
  billingState.loadedFromSnapshot = true;
  billingState.isLoading = false;

  return billingState;
}

// --- MOTOR DE CÁLCULO DE VENTAS POS Y ABONO AL SERVICIO DE FULFILLMENT ---
const BG_POS_MONTH_NAMES_ES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

function deriveBgPosPeriodFromDate(dateVal) {
  const d = dateVal ? new Date(dateVal) : new Date();
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${BG_POS_MONTH_NAMES_ES[now.getMonth()]} ${now.getFullYear()}`;
  }
  return `${BG_POS_MONTH_NAMES_ES[d.getMonth()]} ${d.getFullYear()}`;
}

export async function fetchAndComputePosSalesAbonoForBilling(commerceGroup, periodName, pricingConfig, ordersList = []) {
  const targetPeriodUpper = String(periodName || '').trim().toUpperCase();
  const groupList = Array.isArray(commerceGroup) && commerceGroup.length > 0 ? commerceGroup : [];
  const queryCommerces = [];
  groupList.forEach(c => {
    const t = String(c || '').trim();
    if (t) {
      queryCommerces.push(t, t.toUpperCase(), t.toLowerCase());
    }
  });
  const uniqueQueryCommerces = Array.from(new Set(queryCommerces));

  if (uniqueQueryCommerces.length === 0) {
    return {
      allSales: [],
      periodAbonoSales: [],
      summary: { salesCount: 0, totalGross: 0, totalCommissionNet: 0, totalCommissionIva: 0, totalCommissionWithIva: 0, totalAbonoAmount: 0 }
    };
  }

  let rawSales = [];
  let commerceConfigMap = {};
  try {
    const [salesRes, cacsRes] = await Promise.all([
      supabase.from('store_sales').select('*').in('comercio', uniqueQueryCommerces).order('created_at', { ascending: false }),
      supabase.from('commerce_additional_config').select('comercio, onboarding_checklist').in('comercio', uniqueQueryCommerces)
    ]);
    if (!salesRes.error && Array.isArray(salesRes.data)) {
      rawSales = salesRes.data;
    }
    if (!cacsRes.error && Array.isArray(cacsRes.data)) {
      cacsRes.data.forEach(row => {
        if (row.comercio) commerceConfigMap[row.comercio.trim().toUpperCase()] = row;
      });
    }
  } catch (e) {
    console.warn('[BillingGenerator] Aviso consultando store_sales para abono POS:', e);
  }

  const ordersByExternalNum = new Map();
  (ordersList || []).forEach(o => {
    const ext = String(o.external_order_number || o.externalOrderNumber || o.orderNumber || '').trim().toUpperCase();
    if (ext) ordersByExternalNum.set(ext, o);
  });

  const debitPct = Number(pricingConfig?.pos_service_fee?.debit_pct ?? pricingConfig?.pos_fee_debit_pct ?? 2.5);
  const creditPct = Number(pricingConfig?.pos_service_fee?.credit_pct ?? pricingConfig?.pos_fee_credit_pct ?? 3.5);

  const allProcessedSales = rawSales.map(sale => {
    const saleCode = String(sale.codigo_venta || '').trim().toUpperCase();
    const linkedOrd = ordersByExternalNum.get(saleCode) || null;
    const commUpper = String(sale.comercio || '').trim().toUpperCase();
    const commCfg = commerceConfigMap[commUpper] || null;
    const ob = commCfg?.onboarding_checklist || {};
    const cfgMachine = ob.pos_machine || {};
    const ordMachine = linkedOrd?.raw_shopify_data?.pos_machine || null;

    const modoPago = String(sale.modo_pago || '').trim();
    const modoLower = modoPago.toLowerCase();
    const isDebit = modoLower.includes('débito') || modoLower.includes('debito');
    const isCredit = modoLower.includes('crédito') || modoLower.includes('credito');
    const isCardSale = isDebit || isCredit || modoLower.includes('tarjeta');

    const brand = (ordMachine?.brand || cfgMachine.brand || (isCardSale ? 'Transbank' : modoPago)).trim();
    const model = (ordMachine?.model || cfgMachine.model || '').trim();
    const color = (ordMachine?.color || cfgMachine.color || '').trim();
    const rawOwner = (ordMachine?.owner || cfgMachine.owner || (isCardSale ? 'STOCKA' : (sale.comercio || 'COMERCIO'))).trim();
    const isStockaOwned = isCardSale ? (rawOwner.toUpperCase().includes('STOCKA') || !rawOwner) : false;

    const montoTotal = Math.max(0, Math.round(Number(sale.monto_total) || 0));
    const appliesStockaPosSettlement = Boolean(isCardSale && isStockaOwned);
    const feePct = appliesStockaPosSettlement ? (isCredit ? creditPct : debitPct) : 0;
    const commissionNet = appliesStockaPosSettlement ? Math.round(montoTotal * (feePct / 100)) : 0;
    const commissionIva = appliesStockaPosSettlement ? Math.round(commissionNet * 0.19) : 0;
    const commissionTotal = commissionNet + commissionIva;
    const sellerPayout = Math.max(0, montoTotal - commissionTotal);

    // Determinar periodo de abono
    let abonoPeriod = '';
    let isAbono = false;
    let isExplicit = false;

    const commentStr = String(sale.comentarios || '');
    const tagMatch = commentStr.match(/\[ABONO-PER:\s*([^\]]+)\]/i);
    const ordAbonoPer = linkedOrd?.raw_shopify_data?.pos_abono_period;
    const txTagMatch = commentStr.match(/\[TX-CODE:\s*([^\]]+)\]/i);
    const rawTxCode = (txTagMatch && txTagMatch[1]) ? txTagMatch[1] : (linkedOrd?.raw_shopify_data?.pos_tx_code || '');
    const txCode = String(rawTxCode || '').replace(/\s+/g, '').replace(/[\[\]]/g, '').toUpperCase();

    if (tagMatch && tagMatch[1]) {
      const val = tagMatch[1].trim().toUpperCase();
      isExplicit = true;
      if (val === 'SIN_ABONO' || val === 'PAGO_DIRECTO' || val === 'NINGUNO') {
        abonoPeriod = 'SIN_ABONO';
        isAbono = false;
      } else {
        abonoPeriod = val;
        isAbono = true;
      }
    } else if (ordAbonoPer) {
      const val = String(ordAbonoPer).trim().toUpperCase();
      isExplicit = true;
      if (val === 'SIN_ABONO' || val === 'PAGO_DIRECTO' || val === 'NINGUNO') {
        abonoPeriod = 'SIN_ABONO';
        isAbono = false;
      } else {
        abonoPeriod = val;
        isAbono = true;
      }
    } else if (!appliesStockaPosSettlement) {
      abonoPeriod = 'SIN_ABONO';
      isAbono = false;
    } else if (linkedOrd?.periodo_facturacion && String(linkedOrd.periodo_facturacion).trim()) {
      abonoPeriod = String(linkedOrd.periodo_facturacion).trim().toUpperCase();
      isAbono = true;
    } else {
      abonoPeriod = deriveBgPosPeriodFromDate(sale.created_at);
      isAbono = true;
    }

    let prodSummary = '';
    let unitsCount = 0;
    if (sale.productos) {
      try {
        const p = typeof sale.productos === 'string' ? JSON.parse(sale.productos) : sale.productos;
        if (Array.isArray(p)) {
          prodSummary = p.map(i => `${i.cantidad || 1}x ${i.producto || i.name || 'Producto'}`).join(', ');
          p.forEach(i => { unitsCount += (parseInt(i.cantidad, 10) || 1); });
        }
      } catch (e) {}
    }

    return {
      id: sale.id,
      codigo_venta: sale.codigo_venta || '-',
      comercio: sale.comercio || '',
      nombre_cliente: sale.nombre_cliente || 'Consumidor Final',
      correo_cliente: sale.correo_cliente || '',
      created_at: sale.created_at,
      modo_pago: modoPago,
      documento_tipo: sale.documento_tipo || 'BOLETA',
      productos_summary: prodSummary,
      units_count: unitsCount || 1,
      machine_brand: brand,
      machine_model: model,
      machine_color: color,
      machine_owner: isStockaOwned ? 'STOCKA' : rawOwner,
      is_stocka_machine: isStockaOwned,
      is_card_sale: isCardSale,
      applies_settlement: appliesStockaPosSettlement,
      monto_total: montoTotal,
      fee_pct: feePct,
      commission_net: commissionNet,
      commission_iva: commissionIva,
      commission_total: commissionTotal,
      seller_payout: sellerPayout,
      abono_period: abonoPeriod,
      is_abono: isAbono,
      is_explicit_period: isExplicit,
      tx_code: txCode,
      raw_comentarios: sale.comentarios || ''
    };
  });

  const periodAbonoSales = allProcessedSales.filter(s => s.is_abono && s.abono_period === targetPeriodUpper && (s.applies_settlement || s.is_explicit_period));

  const summary = {
    salesCount: periodAbonoSales.length,
    totalGross: periodAbonoSales.reduce((acc, s) => acc + s.monto_total, 0),
    totalCommissionNet: periodAbonoSales.reduce((acc, s) => acc + s.commission_net, 0),
    totalCommissionIva: periodAbonoSales.reduce((acc, s) => acc + s.commission_iva, 0),
    totalCommissionWithIva: periodAbonoSales.reduce((acc, s) => acc + s.commission_total, 0),
    totalAbonoAmount: periodAbonoSales.reduce((acc, s) => acc + s.seller_payout, 0)
  };

  return {
    allSales: allProcessedSales,
    periodAbonoSales,
    summary
  };
}

export function syncPosAbonoIntoBillingState(b) {
  if (!b) return;
  if (!Array.isArray(b.abonos)) b.abonos = [];

  const summary = b.posAbonoSummary;
  const existingIdx = b.abonos.findIndex(a => a && (a.id === 'abono_pos_sales' || a.isPosAbono === true));

  if (b.posAbonoExcludedManually) {
    return;
  }

  if (summary && summary.salesCount > 0 && summary.totalAbonoAmount > 0) {
    const posEntry = {
      id: 'abono_pos_sales',
      isPosAbono: true,
      amount: summary.totalAbonoAmount,
      grossAmount: summary.totalGross,
      commissionNet: summary.totalCommissionNet,
      commissionIva: summary.totalCommissionIva,
      commissionTotal: summary.totalCommissionWithIva,
      salesCount: summary.salesCount,
      date: existingIdx >= 0 && b.abonos[existingIdx].date ? b.abonos[existingIdx].date : new Date().toISOString().split('T')[0],
      voucher: `${summary.salesCount} venta${summary.salesCount === 1 ? '' : 's'} POS`,
      reference: `Abono por Ventas Punto de Venta (POS) — ${b.currentPeriodName || b.periodName || ''}`,
      notes: `Ventas Brutas: ${formatCLP(summary.totalGross)} | Comisión POS (+IVA): -${formatCLP(summary.totalCommissionWithIva)} | Pago Neto Seller (Abono): ${formatCLP(summary.totalAbonoAmount)}`
    };

    if (existingIdx >= 0) {
      b.abonos[existingIdx] = posEntry;
    } else {
      b.abonos.unshift(posEntry);
    }
  } else if (existingIdx >= 0) {
    b.abonos.splice(existingIdx, 1);
  }
}

// --- MOTOR PRINCIPAL DE CÁLCULO DE FACTURACIÓN ---
export async function calculateCommerceBilling(commerceName, periodName, customOverrides = {}) {
  billingState.isLoading = true;
  billingState.currentCommerce = commerceName;
  billingState.currentPeriodName = periodName;
  billingState.activeConglomerateStoreFilter = null;
  billingState.loadedFromSnapshot = false;

  // Extraer año y mes del periodo (ej: "AGOSTO 2026")
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

  if (customOverrides.forceFresh) {
    billingState.suppliesSessionKey = null;
    billingState.adjustmentsSessionKey = null;
    billingState.abonosSessionKey = null;
    billingState.customColumnsSessionKey = null;
    billingState.supplies = [];
    billingState.adjustments = [];
    billingState.abonos = [];
    billingState.customColumns = [];
    billingState.orders = [];
  }

  // Reiniciar totales a valores limpios para evitar contaminación entre sesiones o comercios
  billingState.totals = {
    ordersCount: 0,
    billableOrdersCount: 0,
    storageRate: 0,
    defaultStorageRate: 0,
    storageGross: 0,
    storageDiscountPct: 0,
    storageDiscountLabel: '',
    storageDiscountAmount: 0,
    storageNet: 0,
    isStorageCustom: false,
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
    posActive: false,
    posFeeUF: 0,
    posFeeNet: 0,
    posFeeDetails: '',
    posIsStocka: false,
    posMachine: null,
    suppliesNet: 0,
    totalSuppliesNet: 0,
    adjustmentsNet: 0,
    totalAdjustmentsNet: 0,
    totalNet: 0,
    iva: 0,
    totalGross: 0,
    totalAbonos: 0,
    totalToPay: 0
  };

  billingState.isPaid = false;
  billingState.isPublished = false;
  billingState.isLocked = false;
  billingState.paymentStatus = 'Por solicitar';

  // 1.1 Consultar si ya existe un registro guardado/publicado/pagado (Supabase y localStorage)
  let savedSnapshot = null;
  let savedRecordStatus = null;
  if (billingState.currentPeriodId && commerceName) {
    let localSnapshot = null;
    try {
      let localStr = localStorage.getItem(`stocka_fulfillment_details_${billingState.currentPeriodId}_${commerceName}`);
      if (!localStr && (commerceName === 'BIG BANG' || commerceName === 'BIG BANG SPA')) {
        localStr = localStorage.getItem(`stocka_fulfillment_details_${billingState.currentPeriodId}_BIG BANG SPA`) ||
                   localStorage.getItem(`stocka_fulfillment_details_${billingState.currentPeriodId}_BIG BANG`);
      }
      if (localStr) localSnapshot = JSON.parse(localStr);
    } catch (e) {}

    try {
      const lookupCommerces = [commerceName];
      const upperCheck = commerceName.trim().toUpperCase();
      if (upperCheck === 'BIG BANG' || upperCheck === 'BIG BANG SPA' || upperCheck.includes('BIG BANG')) {
        lookupCommerces.push('BIG BANG', 'BIG BANG SPA');
      } else if (upperCheck === 'SILVER FOX' || upperCheck === 'SILVER FOX SPA' || upperCheck.includes('SILVER FOX')) {
        lookupCommerces.push('SILVER FOX', 'SILVER FOX SPA');
      }

      const { data: bRecList } = await supabase
        .from('billing_records')
        .select('id, desglose_fulfillment, pago_fulfillment, factura_fulfillment, total_fulfillment, abono_fulfillment, fulfillment_link, comercio, updated_at, fecha_limite')
        .eq('period_id', billingState.currentPeriodId)
        .in('comercio', lookupCommerces);

      const bRec = (bRecList && bRecList.length > 0)
        ? (bRecList.find(r => r.fulfillment_link && ['Enviado', 'Publicado', 'Aprobado'].includes(r.desglose_fulfillment)) ||
           bRecList.find(r => r.fulfillment_link) ||
           bRecList.find(r => (r.total_fulfillment || 0) > 0) ||
           bRecList[0])
        : null;

      if (bRec) {
        const rawPago = String(bRec.pago_fulfillment || 'Por solicitar').trim();
        const rawDesglose = String(bRec.desglose_fulfillment || '').trim();
        const isPaidStatus = ['recibido', 'aprobado', 'pagado'].includes(rawPago.toLowerCase()) || rawDesglose.toLowerCase() === 'aprobado';
        const isPublishedStatus = isPaidStatus || ['enviado', 'publicado', 'aprobado', 'confirmado'].includes(rawDesglose.toLowerCase());

        billingState.isPaid = isPaidStatus;
        billingState.paymentStatus = rawPago || 'Por solicitar';
        billingState.isPublished = isPublishedStatus;
        billingState.isLocked = isPaidStatus ? true : (isPublishedStatus && !customOverrides.unlockForEdit);

        savedRecordStatus = rawDesglose;
        if (isPublishedStatus) {
          savedRecordStatus = isPaidStatus ? 'Aprobado' : 'Publicado';
        } else if (rawDesglose === 'Creado') {
          billingState.isSaved = true;
          savedRecordStatus = 'Creado';
        }

        // Si el snapshot local ya coincide exactamente con el link versionado inmutable en Storage, usarlo al instante sin descargar de red
        const isLocalExactMatch = Boolean(
          localSnapshot &&
          Array.isArray(localSnapshot.orders) &&
          localSnapshot.orders.length > 0 &&
          localSnapshot.totals &&
          bRec.fulfillment_link &&
          (localSnapshot.fulfillment_link === bRec.fulfillment_link ||
           (localSnapshot.version && bRec.fulfillment_link.includes(`_v${localSnapshot.version}_`)))
        );

        if (isLocalExactMatch) {
          savedSnapshot = localSnapshot;
        } else if (bRec.fulfillment_link && (bRec.fulfillment_link.includes('billing_snapshots') || bRec.fulfillment_link.includes('_snapshot') || bRec.fulfillment_link.includes('.json'))) {
          if (bRec.fulfillment_link.startsWith('http://') || bRec.fulfillment_link.startsWith('https://')) {
            try {
              const fetchUrl = bRec.fulfillment_link + (bRec.fulfillment_link.includes('?') ? '&' : '?') + 't=' + Date.now();
              const resp = await fetch(fetchUrl, { cache: 'no-store' });
              if (resp.ok) {
                savedSnapshot = await resp.json();
                savedSnapshot.fulfillment_link = bRec.fulfillment_link;
              }
            } catch (eSnap) {}
          }
        }
      }
    } catch (errRec) {
      console.warn('Error consultando billing_records previo:', errRec);
    }

    if (!customOverrides.forceFresh || billingState.isLocked) {
      if (localSnapshot && savedSnapshot && localSnapshot !== savedSnapshot) {
        const localTime = new Date(localSnapshot.generatedAt || localSnapshot.publishedAt || 0).getTime();
        const remoteTime = new Date(savedSnapshot.generatedAt || savedSnapshot.publishedAt || 0).getTime();
        if (remoteTime >= localTime || billingState.isLocked) {
          try {
            localStorage.setItem(`stocka_fulfillment_details_${billingState.currentPeriodId}_${commerceName}`, JSON.stringify(savedSnapshot));
          } catch (e) {}
        } else {
          savedSnapshot = localSnapshot;
          if (typeof uploadBillingSnapshotToStorage === 'function') {
            uploadBillingSnapshotToStorage(localSnapshot).catch(e => console.warn('Aviso sincronizando snapshot local a Storage:', e));
          }
        }
      } else if (!savedSnapshot && localSnapshot) {
        savedSnapshot = localSnapshot;
      } else if (savedSnapshot && !localSnapshot) {
        try {
          localStorage.setItem(`stocka_fulfillment_details_${billingState.currentPeriodId}_${commerceName}`, JSON.stringify(savedSnapshot));
        } catch (e) {}
      }

      if (savedSnapshot) {
        billingState.snapshotVersion = savedSnapshot.version || (billingState.isPublished ? 1 : 0);
      }
    } else {
      savedSnapshot = null;
    }
  }

  billingState.isSaved = !!(savedRecordStatus === 'Creado' || savedRecordStatus === 'Publicado' || savedRecordStatus === 'Aprobado' || (savedSnapshot && savedSnapshot.generatedAt));
  billingState.savedRecordStatus = savedRecordStatus || (billingState.isSaved ? 'Creado' : 'Pendiente');

  // VÍA RÁPIDA INSTANTÁNEA: Si el periodo está Pagado, Confirmado/Publicado, o es un Borrador Guardado y no se pidió recalcular contra BD
  const canHydrateDirectlyFromSnapshot = Boolean(
    savedSnapshot &&
    Array.isArray(savedSnapshot.orders) &&
    savedSnapshot.orders.length > 0 &&
    savedSnapshot.totals &&
    (billingState.isLocked || billingState.isPaid || billingState.isPublished || (billingState.isSaved && !customOverrides.forceFresh && !customOverrides.forceRecalculateFromDB))
  );

  if (canHydrateDirectlyFromSnapshot) {
    console.log(`[BillingGenerator] Carga instantánea desde snapshot (${commerceName} - ${periodName}) | Bloqueado=${billingState.isLocked} | Pagado=${billingState.isPaid}`);
    const hydrated = hydrateBillingStateFromSnapshot(savedSnapshot, commerceName, periodName, periodYear, periodMonth);
    if (hydrated.isConglomerate && (!hydrated.storageByStore || Object.keys(hydrated.storageByStore).length === 0)) {
      try {
        const group = await resolveCommerceGroup(commerceName);
        const vData = await getMonthlyStorageVolume(group, hydrated.currentPeriodYear || periodYear, hydrated.currentPeriodMonth || periodMonth);
        if (vData && vData.byStore && Object.keys(vData.byStore).length > 0) {
          hydrated.storageByStore = vData.byStore;
          if (!hydrated.isManualVolume && Array.isArray(vData.dailyLogs) && vData.dailyLogs.length > 0) {
            hydrated.dailyStorageLogs = vData.dailyLogs;
          }
          try {
            savedSnapshot.storageByStore = vData.byStore;
            if (!hydrated.isManualVolume && Array.isArray(vData.dailyLogs) && vData.dailyLogs.length > 0) {
              savedSnapshot.dailyStorageLogs = vData.dailyLogs;
            }
            localStorage.setItem(`stocka_fulfillment_details_${billingState.currentPeriodId}_${commerceName}`, JSON.stringify(savedSnapshot));
          } catch (eCache) {}
        }
      } catch (eVol) {
        console.warn('[BillingGenerator] Aviso enriqueciendo volumen por tienda en snapshot:', eVol);
      }
    }

    // Enriquecer ventas POS consideradas como abono en el periodo (en tiempo real contra store_sales)
    try {
      const posGroup = hydrated.isConglomerate && Array.isArray(hydrated.conglomerateChildren) && hydrated.conglomerateChildren.length > 0
        ? [commerceName, ...hydrated.conglomerateChildren]
        : await resolveCommerceGroup(commerceName);
      const posData = await fetchAndComputePosSalesAbonoForBilling(posGroup, hydrated.currentPeriodName || periodName, hydrated.pricingConfig, hydrated.orders);
      hydrated.allMerchantPosSales = posData.allSales;
      hydrated.posAbonoSales = posData.periodAbonoSales;
      hydrated.posAbonoSummary = posData.summary;
      if (!hydrated.isLocked && !hydrated.isPaid) {
        syncPosAbonoIntoBillingState(hydrated);
        const recomputedAbonos = (hydrated.abonos || []).reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0);
        hydrated.totals.totalAbonos = recomputedAbonos;
        hydrated.totals.totalToPay = Math.max(0, (hydrated.totals.totalGross || 0) - recomputedAbonos);
      }
    } catch (ePosSnap) {
      console.warn('[BillingGenerator] Aviso enriqueciendo ventas POS en snapshot:', ePosSnap);
    }

    return hydrated;
  }

  // 1. Cargar tarifas oficiales desde pricing_manager (solo cuando se requiere cálculo desde BD)
  const rawPricing = await loadPricingConfig(supabase);
  billingState.pricingConfig = sanitizeAndMergeConfig(rawPricing);
  const cfg = billingState.pricingConfig;

  // 3. Obtener UF del día 1 del mes facturado (Punto E)
  const ufResult = await getUfForPeriod(periodYear, periodMonth);
  billingState.ufValue = customOverrides.ufValue || ufResult.value;
  billingState.ufDate = ufResult.dateStr;

  // 4. Resolver holdings y obtener datos legales del cliente (Punto A)
  const { conglomeratesMap, childToConglomerateMap } = await getConglomerateMappings();
  const upperCommerce = (commerceName || '').trim().toUpperCase();

  // Detección estricta de holding / conglomerado
  const isConglomerateName = !!conglomeratesMap[upperCommerce] || 
                             upperCommerce === 'BIG BANG' || upperCommerce === 'BIG BANG SPA' || upperCommerce.includes('BIG BANG') ||
                             upperCommerce === 'SILVER FOX' || upperCommerce === 'SILVER FOX SPA' || upperCommerce.includes('SILVER FOX');

  const parentConglomerate = childToConglomerateMap[upperCommerce];

  billingState.isConglomerate = isConglomerateName;
  billingState.conglomerateName = isConglomerateName 
    ? (upperCommerce.includes('BIG BANG') ? 'BIG BANG' : (upperCommerce.includes('SILVER FOX') ? 'SILVER FOX' : upperCommerce))
    : (parentConglomerate || upperCommerce);

  billingState.conglomerateChildren = (conglomeratesMap[billingState.conglomerateName] || conglomeratesMap[upperCommerce] || [])
    .filter(c => c.toUpperCase() !== billingState.conglomerateName && c.toUpperCase() !== 'BIG BANG' && c.toUpperCase() !== 'BIG BANG SPA' && c.toUpperCase() !== 'SILVER FOX' && c.toUpperCase() !== 'SILVER FOX SPA');

  billingState.selectedAsChildStore = !isConglomerateName && !!parentConglomerate;

  const commerceGroup = await resolveCommerceGroup(commerceName);
  const fetchedCommerceInfo = await getCommerceBillingInfo(commerceName);

  let mergedCommerceInfo = { ...fetchedCommerceInfo };
  if (savedSnapshot && savedSnapshot.commerceInfo) {
    mergedCommerceInfo = { ...mergedCommerceInfo, ...savedSnapshot.commerceInfo };
    if (fetchedCommerceInfo.razonSocial && fetchedCommerceInfo.razonSocial !== commerceName) {
      mergedCommerceInfo.razonSocial = fetchedCommerceInfo.razonSocial;
    }
    if (fetchedCommerceInfo.rut && fetchedCommerceInfo.rut !== '—') {
      mergedCommerceInfo.rut = fetchedCommerceInfo.rut;
    }
    if (fetchedCommerceInfo.sigla && fetchedCommerceInfo.sigla !== '—') {
      mergedCommerceInfo.sigla = fetchedCommerceInfo.sigla;
    }
  }

  // Verificar si hay datos legales guardados localmente para este comercio
  try {
    const localLegalStr = localStorage.getItem(`stocka_commerce_legal_${commerceName}`);
    if (localLegalStr) {
      const localLegal = JSON.parse(localLegalStr);
      if (localLegal.razonSocial) mergedCommerceInfo.razonSocial = localLegal.razonSocial;
      if (localLegal.rut && localLegal.rut !== '—') mergedCommerceInfo.rut = localLegal.rut;
      if (localLegal.sigla && localLegal.sigla !== '—') mergedCommerceInfo.sigla = localLegal.sigla;
    }
  } catch (e) {}

  if (customOverrides.commerceInfo) {
    mergedCommerceInfo = { ...mergedCommerceInfo, ...customOverrides.commerceInfo };
  }
  billingState.commerceInfo = mergedCommerceInfo;

  // Fechas de facturación (Emisión y Fecha Límite de Pago)
  const todayNow = new Date();
  const defaultDueObj = new Date(todayNow);
  defaultDueObj.setDate(defaultDueObj.getDate() + 5);
  const toISODate = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  const defaultInvoiceDates = {
    emisionDate: toISODate(todayNow),
    dueDate: toISODate(defaultDueObj),
    termLabel: '5 días corridos'
  };

  billingState.invoiceDates = customOverrides.invoiceDates || 
    (savedSnapshot && savedSnapshot.invoiceDates ? { ...defaultInvoiceDates, ...savedSnapshot.invoiceDates } : defaultInvoiceDates);

  // 5. Calcular volumen de almacenamiento promedio del mes calendario (Punto B) o aplicar volumen mensual manual fijado por Admin
  const volData = await getMonthlyStorageVolume(commerceGroup, periodYear, periodMonth);
  billingState.autoVolumeM3 = volData.averageM3;
  billingState.autoVolumeDaysLogged = volData.daysCount;
  billingState.autoDailyStorageLogs = volData.dailyLogs || [];
  billingState.storageByStore = volData.byStore || {};

  const currentVolSessionKey = `${billingState.currentPeriodId}_${commerceName}`;
  let isManualVolume = false;
  let resolvedVolumeM3 = volData.averageM3;

  if (customOverrides.forceFresh) {
    isManualVolume = false;
    resolvedVolumeM3 = volData.averageM3;
  } else if (customOverrides.volumeM3 !== undefined) {
    resolvedVolumeM3 = Math.max(0, parseFloat(customOverrides.volumeM3) || 0);
    isManualVolume = customOverrides.isManualVolume !== undefined ? Boolean(customOverrides.isManualVolume) : true;
  } else if (billingState.volumeSessionKey === currentVolSessionKey && billingState.isManualVolume) {
    isManualVolume = true;
    resolvedVolumeM3 = Math.max(0, parseFloat(billingState.volumeM3) || 0);
  } else if (savedSnapshot && (savedSnapshot.isManualVolume === true || savedSnapshot.totals?.isManualVolume === true)) {
    isManualVolume = true;
    resolvedVolumeM3 = Math.max(0, parseFloat(savedSnapshot.volumeM3) || 0);
  } else if (savedSnapshot && savedSnapshot.volumeM3 !== undefined) {
    resolvedVolumeM3 = Math.max(0, parseFloat(savedSnapshot.volumeM3) || 0);
    isManualVolume = Boolean(savedSnapshot.isManualVolume);
  }

  billingState.isManualVolume = isManualVolume;
  billingState.volumeSessionKey = currentVolSessionKey;
  billingState.volumeM3 = parseFloat(resolvedVolumeM3.toFixed(4));

  if (isManualVolume) {
    const flatLogs = generateConstantDailyStorageLogs(periodYear, periodMonth, billingState.volumeM3);
    billingState.volumeDailyAverage = billingState.volumeM3;
    billingState.volumeDaysLogged = flatLogs.length;
    billingState.dailyStorageLogs = flatLogs;
    billingState.volumeStats = {
      averageM3: billingState.volumeM3,
      daysCount: flatLogs.length,
      maxDailyVolume: billingState.volumeM3,
      minDailyVolume: billingState.volumeM3
    };
  } else {
    billingState.volumeDailyAverage = volData.averageM3;
    billingState.volumeDaysLogged = volData.daysCount;
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
  }

  // 5.1 Consultar declaraciones de ingreso de stock asignadas al periodo
  let inboundDeclarationsList = [];
  try {
    const { data: rawDecs, error: decErr } = await supabase
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

    if (!decErr && rawDecs) {
      const pNorm = (periodName || '').trim().toUpperCase();
      inboundDeclarationsList = rawDecs.filter(d => {
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

  // 6. Consultar pedidos asignados al periodo en el Gestor de Pedidos con paginación keyset determinista
  //    (optimizado con proyección JSONB ligera y carga selectiva de order_items para evitar statement_timeout 57014 en holdings grandes como BIG BANG)
  let ordersList = [];
  try {
    const queryCommerceGroup = Array.from(new Set(
      commerceGroup
        .map(c => String(c || '').trim())
        .filter(c => c && c === c.toUpperCase())
    ));
    const effectiveCommerceGroup = queryCommerceGroup.length > 0 ? queryCommerceGroup : commerceGroup;

    // 6.1 Pre-cargar catálogo de productos del grupo para resolver SKUs y productos virtuales en memoria sin LATERAL JOIN por fila
    const productsById = {};
    const virtualSkus = new Set();
    try {
      const { data: prodsData } = await supabase
        .from('products')
        .select('id,sku,name,is_virtual')
        .in('comercio', effectiveCommerceGroup)
        .limit(5000);
      if (Array.isArray(prodsData)) {
        prodsData.forEach(p => {
          if (!p || !p.id) return;
          productsById[p.id] = p;
          if (p.is_virtual && p.sku) {
            virtualSkus.add(String(p.sku).trim().toUpperCase());
          }
        });
      }
    } catch (eProd) {
      console.warn('[BillingGenerator] Aviso pre-cargando productos del comercio:', eProd);
    }

    // 6.2 Proyección ligera de pedidos (extrae sólo subcampos JSONB requeridos en vez de blobs completos ni LATERAL order_items)
    const fastOrderSelectFields = 'id,created_at,external_order_number,external_platform,status,estado_wms,comercio,categoria_entrega,agenda,operador,shipping_city,shipping_address,shipping_method,total_value,sku,cantidad,item,periodo_facturacion,consolidation_role:raw_shopify_data->>_consolidation_role,consolidated_into_folio:raw_shopify_data->>_consolidated_into_folio,consolidated_into_id:raw_shopify_data->>_consolidated_into_order_id,consolidated_children_folios:raw_shopify_data->_consolidated_children_folios,shopify_items:raw_shopify_data->line_items,shopify_name:raw_shopify_data->>name,shopify_total:raw_shopify_data->>total_price,woo_items:raw_woocommerce_data->line_items,woo_total:raw_woocommerce_data->>total,meli_items:raw_meli_data->order_items,meli_total:raw_meli_data->>total_amount';

    let step = 500;
    let lastCreatedAt = null;
    let pageCount = 0;
    let hadFatalQueryError = false;
    const existingIds = new Set();

    while (pageCount < 60) {
      pageCount++;
      let resData = null;
      let lastErr = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        let q = supabase
          .from('orders')
          .select(fastOrderSelectFields)
          .in('comercio', effectiveCommerceGroup)
          .eq('periodo_facturacion', periodName)
          .order('created_at', { ascending: false })
          .limit(step);

        if (lastCreatedAt) {
          q = q.lte('created_at', lastCreatedAt);
        }

        const { data, error } = await q;
        if (!error && data) {
          resData = data;
          lastErr = null;
          break;
        }
        lastErr = error;
        const isTimeout = error?.code === '57014' || String(error?.message || '').toLowerCase().includes('timeout');
        if (isTimeout && step > 250) {
          step = Math.max(250, Math.floor(step / 2));
          console.warn(`[BillingGenerator] Timeout en página ${pageCount}, reduciendo lote a ${step} y reintentando...`);
        } else {
          console.warn(`[BillingGenerator] Reintento ${attempt} página ${pageCount}:`, error?.message || error);
        }
        await new Promise(r => setTimeout(r, 350 * attempt));
      }

      if (lastErr || !resData || resData.length === 0) {
        if (lastErr) {
          hadFatalQueryError = true;
          console.error(`[BillingGenerator] Error en página ${pageCount}:`, lastErr);
        }
        break;
      }

      // Filtrar pedidos repetidos en el límite temporal idéntico y reconstruir estructura ligera compatible
      const newOrders = resData.filter(o => !existingIds.has(o.id));
      if (newOrders.length === 0) {
        break;
      }

      newOrders.forEach(o => {
        existingIds.add(o.id);
        if (!o.raw_shopify_data && (o.shopify_items || o.shopify_name || o.shopify_total)) {
          o.raw_shopify_data = {
            line_items: Array.isArray(o.shopify_items) ? o.shopify_items : [],
            name: o.shopify_name || null,
            total_price: o.shopify_total || null
          };
        }
        if (!o.raw_woocommerce_data && (o.woo_items || o.woo_total)) {
          o.raw_woocommerce_data = {
            line_items: Array.isArray(o.woo_items) ? o.woo_items : [],
            total: o.woo_total || null
          };
        }
        if (!o.raw_meli_data && (o.meli_items || o.meli_total)) {
          o.raw_meli_data = {
            order_items: Array.isArray(o.meli_items) ? o.meli_items : [],
            total_amount: o.meli_total || null
          };
        }
      });

      ordersList = ordersList.concat(newOrders);
      console.log(`[BillingGenerator] Página ${pageCount}: +${newOrders.length} pedidos (Total: ${ordersList.length})`);

      if (resData.length < step) {
        break;
      }

      lastCreatedAt = resData[resData.length - 1].created_at;
    }

    // 6.3 Enriquecer selectivamente con order_items sólo aquellos pedidos que lo requieren
    //     (pedidos manuales sin line_items, pedidos editados/divididos donde cantidad != suma raw, o con SKUs virtuales)
    if (ordersList.length > 0) {
      const candidateOrderIds = [];
      ordersList.forEach(ord => {
        if (Array.isArray(ord.order_items) && ord.order_items.length > 0) return;
        const shopItems = ord.raw_shopify_data?.line_items;
        const wooItems = ord.raw_woocommerce_data?.line_items;
        const meliItems = ord.raw_meli_data?.order_items || (Array.isArray(ord.raw_meli_data) && ord.raw_meli_data[0]?.order_items);

        let rawList = null;
        if (Array.isArray(shopItems) && shopItems.length > 0) {
          rawList = shopItems.map(li => ({ sku: String(li.sku || '').trim().toUpperCase(), qty: parseInt(li.quantity, 10) || 1 }));
        } else if (Array.isArray(wooItems) && wooItems.length > 0) {
          rawList = wooItems.map(li => ({ sku: String(li.sku || '').trim().toUpperCase(), qty: parseInt(li.quantity, 10) || 1 }));
        } else if (Array.isArray(meliItems) && meliItems.length > 0) {
          rawList = meliItems.map(mi => ({ sku: String(mi.item?.seller_sku || '').trim().toUpperCase(), qty: parseInt(mi.quantity, 10) || 1 }));
        }

        if (!rawList) {
          candidateOrderIds.push(ord.id);
        } else {
          const rawUnits = rawList.reduce((s, x) => s + x.qty, 0);
          const ordCant = parseInt(ord.cantidad, 10) || 0;
          const hasVirt = rawList.some(x => virtualSkus.has(x.sku));
          if ((ordCant > 0 && ordCant !== rawUnits) || hasVirt) {
            candidateOrderIds.push(ord.id);
          }
        }
      });

      if (candidateOrderIds.length > 0) {
        const itemsByOrderId = {};
        const CHUNK_SIZE = 120;
        for (let i = 0; i < candidateOrderIds.length; i += CHUNK_SIZE) {
          const chunkIds = candidateOrderIds.slice(i, i + CHUNK_SIZE);
          try {
            const { data: oiRows, error: oiErr } = await supabase
              .from('order_items')
              .select('order_id,quantity,product_id')
              .in('order_id', chunkIds);
            if (!oiErr && Array.isArray(oiRows)) {
              oiRows.forEach(row => {
                if (!itemsByOrderId[row.order_id]) itemsByOrderId[row.order_id] = [];
                itemsByOrderId[row.order_id].push({
                  quantity: row.quantity,
                  product_id: row.product_id,
                  products: productsById[row.product_id] || null
                });
              });
            }
          } catch (eOi) {
            console.warn('[BillingGenerator] Aviso consultando lote de order_items:', eOi);
          }
        }
        ordersList.forEach(ord => {
          if (itemsByOrderId[ord.id]) {
            ord.order_items = itemsByOrderId[ord.id];
          }
        });
      }
    }

    // Fallback secundario de alta disponibilidad: sólo si la consulta directa falló por error de red/DB y no es parcial de una sola tienda de un holding
    if (ordersList.length === 0 && hadFatalQueryError && window.loadedOrders && Array.isArray(window.loadedOrders) && window.loadedOrders.length > 0) {
      const pNorm = (periodName || '').trim().toUpperCase();
      const groupSet = new Set(commerceGroup.map(c => c.trim().toUpperCase()));
      const memoryMatches = window.loadedOrders.filter(o => {
        const cNorm = (o.comercio || '').trim().toUpperCase();
        const oPeriod = (o.periodo_facturacion || '').trim().toUpperCase();
        return groupSet.has(cNorm) && oPeriod === pNorm;
      });
      if (memoryMatches.length > 0) {
        console.log(`[BillingGenerator] Recuperados ${memoryMatches.length} pedidos desde memoria de sesión (window.loadedOrders)`);
        ordersList = memoryMatches;
      }
    }
  } catch (e) {
    console.error('Error cargando pedidos para facturación:', e);
  }

  // 7. Determinar cantidad de pedidos y tramo tarifario (order_ranges)
  const totalOrdersCount = ordersList.length;
  const fallbackRange = { min: 0, max: 999999, pick_pack_base: 1250, storage_m3: 48900 };
  let activeRange = (cfg.order_ranges && cfg.order_ranges[0]) || fallbackRange;
  if (cfg.order_ranges && Array.isArray(cfg.order_ranges) && cfg.order_ranges.length > 0) {
    for (const r of cfg.order_ranges) {
      if (totalOrdersCount >= r.min && totalOrdersCount <= r.max) {
        activeRange = r;
        break;
      }
    }
    if (totalOrdersCount > cfg.order_ranges[cfg.order_ranges.length - 1].min) {
      activeRange = cfg.order_ranges[cfg.order_ranges.length - 1];
    }
  }
  billingState.activeRange = activeRange;


  const deliveryTypesList = getDeliveryTypes(cfg);
  const getDeliveryPrice = (key, fallback = 0) => {
    const found = deliveryTypesList.find(d => d.key === key);
    return found ? found.price : fallback;
  };

  // 7.1 Restaurar columnas personalizadas de cobro (recargos de preparación)
  const currentCustomColsKey = `${billingState.currentPeriodId}_${commerceName}`;
  if (customOverrides.customColumns !== undefined) {
    billingState.customColumns = customOverrides.customColumns;
    billingState.customColumnsSessionKey = currentCustomColsKey;
  } else if (!customOverrides.forceFresh && billingState.customColumnsSessionKey === currentCustomColsKey && Array.isArray(billingState.customColumns)) {
    // Preservar columnas personalizadas creadas/editadas durante la sesión activa
  } else if (!customOverrides.forceFresh && savedSnapshot && Array.isArray(savedSnapshot.customColumns)) {
    billingState.customColumns = savedSnapshot.customColumns;
    billingState.customColumnsSessionKey = currentCustomColsKey;
  } else {
    billingState.customColumns = [];
    billingState.customColumnsSessionKey = currentCustomColsKey;
  }

  const savedOrderMap = {};
  if (!customOverrides.forceFresh) {
    if (savedSnapshot && savedSnapshot.orders && Array.isArray(savedSnapshot.orders)) {
      savedSnapshot.orders.forEach(so => {
        if (so && so.id) {
          const customTotal = computeOrderCustomSurchargesTotal(so, billingState.customColumns);
          // Sanear si en el snapshot previo venía con isMarketplace=true pero surchargeMarketplace=0 (salvo edición manual)
          if (!so.surchargeMarketplaceManual && so.isMarketplace && (!so.surchargeMarketplace || so.surchargeMarketplace === 0)) {
            const mktRate = (cfg.pick_pack_rules && cfg.pick_pack_rules.surcharge_marketplace_collect) || 100;
            so.surchargeMarketplace = mktRate;
            so.pickPackTotal = (so.baseRate || 0) + (so.surchargeSku || 0) + (so.surchargeUnits || 0) + so.surchargeMarketplace + customTotal;
            so.orderTotal = so.pickPackTotal + (so.shippingFreight || 0);
          } else if (!so.surchargeMarketplaceManual && !so.isMarketplace && so.surchargeMarketplace > 0) {
            so.surchargeMarketplace = 0;
            so.pickPackTotal = (so.baseRate || 0) + (so.surchargeSku || 0) + (so.surchargeUnits || 0) + customTotal;
            so.orderTotal = so.pickPackTotal + (so.shippingFreight || 0);
          }
          savedOrderMap[so.id] = so;
        }
      });
    }
    if (billingState.currentPeriodId && commerceName && billingState.currentCommerce === commerceName && Array.isArray(billingState.orders) && billingState.orders.length > 0 && billingState.customColumnsSessionKey === currentCustomColsKey) {
      billingState.orders.forEach(bo => {
        if (bo && bo.id) {
          savedOrderMap[bo.id] = bo;
        }
      });
    }
  }

  // 8. Procesar cada pedido: tarifa base, recargos y despacho
  const processedOrders = ordersList.map((ord, idx) => {
    const savedOrder = savedOrderMap[ord.id];
    const isExcluded = (customOverrides.excludedOrderIds && customOverrides.excludedOrderIds.includes(ord.id)) ||
                       (customOverrides.orders && customOverrides.orders[ord.id]?.isExcluded !== undefined ? customOverrides.orders[ord.id].isExcluded : (savedOrder ? !!savedOrder.isExcluded : false));
    
    // Conteo de SKUs y Unidades (incluyendo order_items para pedidos manuales y sincronizados)
    let skuCount = 1;
    let unitsCount = Math.max(1, parseInt(ord.cantidad, 10) || 1);
    
    if (ord.order_items && Array.isArray(ord.order_items) && ord.order_items.length > 0) {
      const nonVirtualItems = ord.order_items.filter(item => !item.products?.is_virtual && (parseInt(item.quantity, 10) || 0) > 0);
      const itemsToCount = nonVirtualItems.length > 0 ? nonVirtualItems : ord.order_items;
      const uniqueSkus = new Set(
        itemsToCount.map((item, iIdx) => {
          const k = String(item.products?.sku || item.sku || item.product_id || '').trim().toUpperCase();
          return k || `ITEM_${iIdx}`;
        })
      );
      skuCount = Math.max(1, uniqueSkus.size);
      unitsCount = Math.max(1, itemsToCount.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 1), 0));
    } else if (ord.raw_shopify_data?.line_items && Array.isArray(ord.raw_shopify_data.line_items) && ord.raw_shopify_data.line_items.length > 0) {
      const uniqueSkus = new Set(
        ord.raw_shopify_data.line_items.map((item, iIdx) => {
          const k = String(item.sku || item.product_id || item.title || '').trim().toUpperCase();
          return k || `ITEM_${iIdx}`;
        })
      );
      skuCount = Math.max(1, uniqueSkus.size);
      unitsCount = Math.max(1, ord.raw_shopify_data.line_items.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 1), 0));
    } else if (ord.raw_woocommerce_data?.line_items && Array.isArray(ord.raw_woocommerce_data.line_items) && ord.raw_woocommerce_data.line_items.length > 0) {
      const uniqueSkus = new Set(
        ord.raw_woocommerce_data.line_items.map((item, iIdx) => {
          const k = String(item.sku || item.product_id || item.name || '').trim().toUpperCase();
          return k || `ITEM_${iIdx}`;
        })
      );
      skuCount = Math.max(1, uniqueSkus.size);
      unitsCount = Math.max(1, ord.raw_woocommerce_data.line_items.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 1), 0));
    } else if (ord.raw_meli_data?.order_items && Array.isArray(ord.raw_meli_data.order_items) && ord.raw_meli_data.order_items.length > 0) {
      const uniqueSkus = new Set(
        ord.raw_meli_data.order_items.map((item, iIdx) => {
          const k = String(item.item?.seller_sku || item.item?.id || item.item?.title || '').trim().toUpperCase();
          return k || `ITEM_${iIdx}`;
        })
      );
      skuCount = Math.max(1, uniqueSkus.size);
      unitsCount = Math.max(1, ord.raw_meli_data.order_items.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 1), 0));
    } else if (ord.sku && String(ord.sku).includes(',')) {
      skuCount = new Set(String(ord.sku).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)).size || 1;
    }

    // Sobreescritura manual por pedido si el admin ya lo editó (o si estaba guardado en snapshot).
    // Si el snapshot tenía el fallback antiguo (1 SKU / 1 Unidad) pero order_items indica > 1, actualizar al valor real.
    const manualOrderOverride = (customOverrides.orders && customOverrides.orders[ord.id]) || savedOrder;
    const isExplicitOverride = Boolean(customOverrides.orders && customOverrides.orders[ord.id]);
    const savedSkuCount = manualOrderOverride?.skuCount !== undefined ? Math.max(1, parseInt(manualOrderOverride.skuCount, 10) || 1) : null;
    const savedUnitsCount = manualOrderOverride?.unitsCount !== undefined ? Math.max(1, parseInt(manualOrderOverride.unitsCount, 10) || 1) : null;

    const finalSkuCount = (savedSkuCount !== null && (isExplicitOverride || !(savedSkuCount === 1 && skuCount > 1)))
      ? savedSkuCount
      : skuCount;
    const finalUnitsCount = (savedUnitsCount !== null && (isExplicitOverride || !(savedUnitsCount === 1 && unitsCount > 1)))
      ? savedUnitsCount
      : unitsCount;

    // Detección de pedido de Punto de Venta físico (POS)
    const isPosOrder = isPosSaleOrder(ord) || isPosSaleOrder(manualOrderOverride);
    const posBasePickPackRate = (cfg.services && cfg.services.showroom_sale_base) || (cfg.shipping && cfg.shipping.pickup_express_base) || 1490;

    // Reglas de Recargos de Pick & Pack (POS tiene tarifa base $1.490)
    const basePickPackRate = isPosOrder ? posBasePickPackRate : activeRange.pick_pack_base;
    const extraSkuCount = Math.max(0, finalSkuCount - (cfg.pick_pack_rules.base_included_sku || 3));
    const surchargeSku = extraSkuCount * (cfg.pick_pack_rules.surcharge_extra_sku || 100);

    const extraUnitsCount = Math.max(0, finalUnitsCount - (cfg.pick_pack_rules.base_included_units || 10));
    const surchargeUnits = extraUnitsCount * (cfg.pick_pack_rules.surcharge_extra_unit || 50);

    // Detección automática de pedido Marketplace (+ $100)
    const platformUpper = String(ord.external_platform || '').toUpperCase();
    const agendaUpper = String(ord.agenda || '').toUpperCase();
    const operadorUpper = String(ord.operador || '').toUpperCase();

    const isMarketplaceAuto = !isPosOrder && (
                              platformUpper.includes('MERCADO') || 
                              platformUpper.includes('FALABELLA') || 
                              platformUpper.includes('RIPLEY') || 
                              platformUpper.includes('WALMART') || 
                              platformUpper.includes('PARIS') || 
                              agendaUpper.includes('MERCADO') || 
                              agendaUpper.includes('FALABELLA') || 
                              agendaUpper.includes('FLEX') || 
                              agendaUpper.includes('CENTRO DE ENVIOS') || 
                              operadorUpper.includes('MERCADOLIBRE') || 
                              operadorUpper.includes('FALABELLA'));

    const mktSurchargeRate = (cfg.pick_pack_rules && cfg.pick_pack_rules.surcharge_marketplace_collect) || 100;

    // Reglas de Despacho (Punto D)
    const shippingMethodUpper = String(ord.shipping_method || '').toUpperCase();
    const cityNorm = String(ord.shipping_city || '').toLowerCase().trim();
    const isColina = cityNorm.includes('colina') || String(ord.shipping_address || '').toLowerCase().includes('colina');

    // Envíos Flex
    const isFlex = !isPosOrder && (
                   agendaUpper.includes('FLEX') || 
                   shippingMethodUpper.includes('FLEX') || 
                   (platformUpper.includes('MERCADO') && shippingMethodUpper.includes('FLEX')));

    // Operadores Stocka Express RM: STOCKA X, ALPHA, STK, RM
    const isStkRmCourier = !isPosOrder && ['STOCKA X', 'ALPHA', 'STK', 'RM', 'STOCKA'].some(c => 
      operadorUpper.includes(c) || agendaUpper === c
    );

    const isRetiro = String(ord.categoria_entrega || '').toUpperCase() === 'RETIRO' || agendaUpper.includes('RETIRO');
    const isCentroEnvios = agendaUpper.includes('CENTRO DE ENVIOS') || 
                           shippingMethodUpper.includes('CENTRO DE ENVIOS') || 
                           (operadorUpper.includes('MERCADOLIBRE') && !isFlex);
    const isEnviameRegion = agendaUpper.includes('REGION') || 
                            ['STARKEN', 'CHILEXPRESS', 'BLUEXPRESS', 'CORREOS', 'ENVIAME'].some(c => operadorUpper.includes(c)) ||
                            shippingMethodUpper.includes('REGION') ||
                            shippingMethodUpper.includes('ENVIAME');

    let deliveryType = 'OTHER';
    let shippingFreight = 0;

    if (isPosOrder) {
      deliveryType = 'POS';
      shippingFreight = 0;
    } else if (isRetiro) {
      deliveryType = 'RETIRO';
      shippingFreight = getDeliveryPrice('RETIRO', 0);
    } else if (isFlex) {
      deliveryType = 'FLEX';
      shippingFreight = getDeliveryPrice('FLEX', 3200);
    } else if (isStkRmCourier) {
      if (isColina) {
        deliveryType = 'COLINA';
        shippingFreight = getDeliveryPrice('COLINA', 3490);
      } else {
        deliveryType = 'RM_STK';
        shippingFreight = getDeliveryPrice('RM_STK', 3200);
      }
    } else if (isCentroEnvios) {
      deliveryType = 'CENTRO_ENVIOS';
      shippingFreight = getDeliveryPrice('CENTRO_ENVIOS', 0);
    } else if (isEnviameRegion) {
      deliveryType = 'ENVIAME_REGION';
      shippingFreight = getDeliveryPrice('ENVIAME_REGION', 0);
    } else {
      // Operadores tradicionales (STARKEN, CHILEXPRESS, BLUEXPRESS, ENVIAME) van a $0 en fulfillment
      deliveryType = 'ENVIAME_REGION';
      shippingFreight = getDeliveryPrice('ENVIAME_REGION', 0);
    }

    // Respetar override manual de isMarketplace si existe; de lo contrario usar auto-detección
    const isMarketplace = manualOrderOverride?.isMarketplace !== undefined
      ? !!manualOrderOverride.isMarketplace
      : isMarketplaceAuto;

    const isSurchargeMarketplaceManual = Boolean(manualOrderOverride?.surchargeMarketplaceManual);
    let finalSurchargeMarketplace = 0;
    if (isSurchargeMarketplaceManual && manualOrderOverride?.surchargeMarketplace !== undefined) {
      finalSurchargeMarketplace = Math.max(0, Math.round(Number(manualOrderOverride.surchargeMarketplace) || 0));
    } else if (isMarketplace) {
      finalSurchargeMarketplace = (manualOrderOverride?.surchargeMarketplace !== undefined && manualOrderOverride.surchargeMarketplace > 0)
        ? manualOrderOverride.surchargeMarketplace
        : mktSurchargeRate;
    } else {
      finalSurchargeMarketplace = 0;
    }

    const isBaseRateManual = Boolean(manualOrderOverride?.baseRateManual);
    const finalBaseRate = isPosOrder
      ? ((isBaseRateManual && manualOrderOverride?.baseRate !== undefined) ? manualOrderOverride.baseRate : posBasePickPackRate)
      : (manualOrderOverride?.baseRate !== undefined ? manualOrderOverride.baseRate : basePickPackRate);
    const isSurchargeSkuManual = Boolean(manualOrderOverride?.surchargeSkuManual);
    const finalSurchargeSku = (isSurchargeSkuManual && manualOrderOverride?.surchargeSku !== undefined)
      ? Math.max(0, Math.round(Number(manualOrderOverride.surchargeSku) || 0))
      : surchargeSku;

    const isSurchargeUnitsManual = Boolean(manualOrderOverride?.surchargeUnitsManual);
    const finalSurchargeUnits = (isSurchargeUnitsManual && manualOrderOverride?.surchargeUnits !== undefined)
      ? Math.max(0, Math.round(Number(manualOrderOverride.surchargeUnits) || 0))
      : surchargeUnits;

    // Detectar estado de Consolidación de Pedidos (1 Envío en Pedido Principal + N Preparaciones individuales)
    const memLiveOrd = (window.loadedOrders && Array.isArray(window.loadedOrders))
      ? window.loadedOrders.find(mo => String(mo.id) === String(ord.id))
      : null;
    const rawConsRole = memLiveOrd?.raw_shopify_data?._consolidation_role || ord.consolidation_role || ord.raw_shopify_data?._consolidation_role || null;
    const rawConsIntoId = memLiveOrd?.consolidated_into_order_id || memLiveOrd?.raw_shopify_data?._consolidated_into_order_id || ord.consolidated_into_id || ord.consolidated_into_order_id || ord.raw_shopify_data?._consolidated_into_order_id || null;
    const rawConsIntoFolio = memLiveOrd?.raw_shopify_data?._consolidated_into_folio || ord.consolidated_into_folio || ord.raw_shopify_data?._consolidated_into_folio || null;
    const rawConsChildrenFolios = memLiveOrd?.raw_shopify_data?._consolidated_children_folios || ord.consolidated_children_folios || ord.raw_shopify_data?._consolidated_children_folios || [];

    const isConsolidatedSecondary = Boolean(rawConsRole === 'secondary' || (rawConsIntoId && String(rawConsIntoId) !== String(ord.id)) || manualOrderOverride?.isConsolidatedSecondary);
    const isConsolidatedPrimary = Boolean(rawConsRole === 'primary' || (Array.isArray(rawConsChildrenFolios) && rawConsChildrenFolios.length > 0) || manualOrderOverride?.isConsolidatedPrimary);

    const isShippingFreightManual = Boolean(manualOrderOverride?.shippingFreightManual);
    const finalDeliveryType = isPosOrder
      ? (manualOrderOverride?.deliveryType === 'POS' || !manualOrderOverride?.deliveryType || manualOrderOverride?.deliveryType === 'RETIRO' || manualOrderOverride?.deliveryType === 'ENVIAME_REGION' ? 'POS' : manualOrderOverride.deliveryType)
      : (manualOrderOverride?.deliveryType || deliveryType);
    let finalShippingFreight = shippingFreight;
    if ((isPosOrder || isConsolidatedSecondary) && !isShippingFreightManual) {
      // Regla de negocio: En pedidos consolidados se cobra 1 envío (en el principal) y las N preparaciones (secundario tiene flete $0)
      finalShippingFreight = 0;
    } else if (manualOrderOverride?.shippingFreight !== undefined) {
      finalShippingFreight = manualOrderOverride.shippingFreight;
    } else if (manualOrderOverride?.deliveryType) {
      finalShippingFreight = getDeliveryPrice(manualOrderOverride.deliveryType, shippingFreight);
    }
    // Ticket de venta del pedido (monto de compra cliente)
    let ticketVenta = 0;
    if (ord.total_value !== null && ord.total_value !== undefined && !isNaN(Number(ord.total_value))) {
      ticketVenta = Math.round(Number(ord.total_value));
    } else if (ord.raw_shopify_data?.total_price) {
      ticketVenta = Math.round(Number(ord.raw_shopify_data.total_price)) || 0;
    } else if (ord.raw_woocommerce_data?.total) {
      ticketVenta = Math.round(Number(ord.raw_woocommerce_data.total)) || 0;
    } else if (ord.raw_meli_data?.total_amount) {
      ticketVenta = Math.round(Number(ord.raw_meli_data.total_amount)) || 0;
    }

    const finalTicketVenta = manualOrderOverride?.ticketVenta !== undefined ? manualOrderOverride.ticketVenta : ticketVenta;

    // Calcular recargos de columnas personalizadas de cobro (por unidad o global)
    const customSurcharges = {};
    const customSurchargesMeta = {};
    const activeCustomCols = Array.isArray(billingState.customColumns) ? billingState.customColumns : [];
    activeCustomCols.forEach(col => {
      if (!col || !col.id) return;
      const savedMeta = manualOrderOverride?.customSurchargesMeta?.[col.id];
      const savedVal = manualOrderOverride?.customSurcharges?.[col.id];
      const isManual = savedMeta === 'manual' || (typeof savedMeta === 'object' && Boolean(savedMeta.isManual));
      const isRule = savedMeta === 'rule' || (typeof savedMeta === 'object' && Boolean(savedMeta.enabled) && !savedMeta.isManual);

      if (isManual) {
        customSurchargesMeta[col.id] = 'manual';
        customSurcharges[col.id] = Math.max(0, Math.round(Number(savedVal) || 0));
      } else if (isRule) {
        customSurchargesMeta[col.id] = 'rule';
        customSurcharges[col.id] = col.mode === 'per_unit'
          ? Math.round((Number(col.rate) || 0) * finalUnitsCount)
          : Math.round(Number(col.rate) || 0);
      } else if (savedVal !== undefined && savedVal !== null) {
        const numVal = Math.max(0, Math.round(Number(savedVal) || 0));
        customSurcharges[col.id] = numVal;
        customSurchargesMeta[col.id] = 'manual';
      } else {
        customSurchargesMeta[col.id] = 'rule';
        customSurcharges[col.id] = col.mode === 'per_unit'
          ? Math.round((Number(col.rate) || 0) * finalUnitsCount)
          : Math.round(Number(col.rate) || 0);
      }
    });

    const customSurchargesTotal = activeCustomCols.reduce((acc, col) => acc + (customSurcharges[col.id] || 0), 0);
    const finalPickPackTotal = finalBaseRate + finalSurchargeSku + finalSurchargeUnits + finalSurchargeMarketplace + customSurchargesTotal;
    const finalOrderTotal = finalPickPackTotal + finalShippingFreight;

    const resolvedPlatform = isPosOrder
      ? 'Punto de Venta (POS)'
      : (ord.external_platform || (ord.raw_shopify_data ? 'Shopify' : (ord.raw_woocommerce_data ? 'WooCommerce' : (ord.raw_meli_data ? 'Mercado Libre' : 'Manual'))));

    return {
      id: ord.id,
      rowNumber: idx + 1,
      orderNumber: ord.external_order_number || (ord.raw_shopify_data?.name ? ord.raw_shopify_data.name : ord.id.slice(0, 8)),
      externalOrderNumber: ord.external_order_number || (ord.raw_shopify_data?.name ? ord.raw_shopify_data.name : ord.id.slice(0, 8)),
      platform: resolvedPlatform,
      externalPlatform: resolvedPlatform,
      isPosOrder,
      date: ord.created_at ? ord.created_at.slice(0, 10) : '—',
      destination: ord.shipping_city || 'Santiago',
      isColina,
      isFlex,
      skuCount: finalSkuCount,
      unitsCount: finalUnitsCount,
      isMarketplace,
      categoriaEntrega: resolveOrderBillingCategoria({
        ...ord,
        isPosOrder,
        deliveryType: finalDeliveryType
      }),
      operador: (ord.operador && String(ord.operador).trim() !== '' && String(ord.operador).trim() !== '—') ? String(ord.operador).trim() : (isPosOrder ? 'POS Sucursal' : ''),
      agenda: (ord.agenda && String(ord.agenda).trim() !== '' && String(ord.agenda).trim() !== '—') ? String(ord.agenda).trim() : '',
      shippingMethod: (ord.shipping_method && String(ord.shipping_method).trim() !== '' && String(ord.shipping_method).trim() !== '—') ? String(ord.shipping_method).trim() : (isPosOrder ? 'Entrega en Punto Físico' : ''),
      ticketVenta: finalTicketVenta,
      deliveryType: finalDeliveryType,
      baseRate: finalBaseRate,
      baseRateManual: isBaseRateManual,
      surchargeSku: finalSurchargeSku,
      surchargeSkuManual: isSurchargeSkuManual,
      surchargeUnits: finalSurchargeUnits,
      surchargeUnitsManual: isSurchargeUnitsManual,
      surchargeMarketplace: finalSurchargeMarketplace,
      surchargeMarketplaceManual: isSurchargeMarketplaceManual,
      customSurcharges,
      customSurchargesMeta,
      customSurchargesTotal,
      pickPackTotal: finalPickPackTotal,
      shippingFreight: finalShippingFreight,
      shippingFreightManual: isShippingFreightManual,
      isConsolidatedPrimary,
      isConsolidatedSecondary,
      consolidatedIntoFolio: rawConsIntoFolio || manualOrderOverride?.consolidatedIntoFolio || null,
      consolidatedChildrenFolios: Array.isArray(rawConsChildrenFolios) ? rawConsChildrenFolios : (manualOrderOverride?.consolidatedChildrenFolios || []),
      orderTotal: finalOrderTotal,
      isExcluded: !!isExcluded,
      estadoWms: ord.estado_wms || 'Completado',
      comercio: normalizeOrderChildStore(ord.comercio, billingState.conglomerateChildren, billingState.currentCommerce)
    };
  });

  billingState.orders = processedOrders;

  // 9. Calcular Totales de Pedidos y Envíos
  const billableOrders = processedOrders.filter(o => !o.isExcluded);
  const totalPickPackNet = billableOrders.reduce((acc, o) => acc + o.pickPackTotal, 0);

  const billableShippingOrders = billableOrders.filter(o => (o.shippingFreight || 0) > 0);
  const totalRmFlexNet = billableShippingOrders.reduce((acc, o) => acc + (o.shippingFreight || 0), 0);

  const enviameOrders = billableOrders.filter(o => o.deliveryType === 'ENVIAME_REGION' && !o.isConsolidatedSecondary);

  // 9b. Detección y cálculo de Cobro de Etiqueta FULL de MELI ($100 por producto / unidad en pedidos con agenda FULL MERCADOLIBRE)
  const fullMeliOrders = billableOrders.filter(o => isFullMeliOrder(o));
  const meliFullUnitsCount = fullMeliOrders.reduce((acc, o) => acc + (Math.max(1, parseInt(o.unitsCount, 10) || 1)), 0);
  const meliFullRate = (cfg.pick_pack_rules && cfg.pick_pack_rules.surcharge_ml_full_labeling) || 100;
  const meliFullNet = meliFullUnitsCount * meliFullRate;

  // 9.1 Conteo global de artículos y ranking de productos más vendidos
  const productMap = {};
  let totalUnitsSold = 0;

  billableOrders.forEach(ord => {
    const memOrd = (window.loadedOrders && Array.isArray(window.loadedOrders)) ? window.loadedOrders.find(o => o.id === ord.id) : null;
    const rawOrd = ordersList.find(o => o.id === ord.id) || memOrd || ord;
    let items = [];

    // 1. Probar order_items (si viene cargado en rawOrd o memOrd)
    const oItems = rawOrd.order_items || memOrd?.order_items;
    if (oItems && Array.isArray(oItems) && oItems.length > 0) {
      items = oItems.map(oi => ({
        sku: String(oi.products?.sku || oi.sku || 'S/SKU').trim(),
        name: String(oi.products?.name || oi.products?.sku || oi.item_name || 'Producto sin nombre').trim(),
        quantity: parseInt(oi.quantity, 10) || 1
      }));
    }

    // 2. Probar raw_shopify_data
    if (items.length === 0) {
      const shopifyData = rawOrd.raw_shopify_data || memOrd?.raw_shopify_data;
      if (shopifyData?.line_items && Array.isArray(shopifyData.line_items) && shopifyData.line_items.length > 0) {
        items = shopifyData.line_items.map(li => ({
          sku: String(li.sku || 'S/SKU').trim(),
          name: String(li.name || li.title || 'Producto Shopify').trim(),
          quantity: parseInt(li.quantity, 10) || 1
        }));
      }
    }

    // 3. Probar raw_woocommerce_data
    if (items.length === 0) {
      const wooData = rawOrd.raw_woocommerce_data || memOrd?.raw_woocommerce_data;
      if (wooData?.line_items && Array.isArray(wooData.line_items) && wooData.line_items.length > 0) {
        items = wooData.line_items.map(li => ({
          sku: String(li.sku || 'S/SKU').trim(),
          name: String(li.name || 'Producto WooCommerce').trim(),
          quantity: parseInt(li.quantity, 10) || 1
        }));
      }
    }

    // 4. Probar raw_meli_data
    if (items.length === 0) {
      const meliData = rawOrd.raw_meli_data || memOrd?.raw_meli_data;
      if (meliData) {
        const meliOrders = Array.isArray(meliData) ? meliData : [meliData];
        meliOrders.forEach(mo => {
          if (mo && Array.isArray(mo.order_items)) {
            mo.order_items.forEach(mi => {
              items.push({
                sku: String(mi.item?.seller_sku || 'S/SKU').trim(),
                name: String(mi.item?.title || 'Producto MercadoLibre').trim(),
                quantity: parseInt(mi.quantity, 10) || 1
              });
            });
          }
        });
      }
    }

    // 5. Probar campos planos sku / item (desglosando listas separadas por coma)
    if (items.length === 0) {
      const rawSku = (rawOrd.sku && rawOrd.sku !== 'null') ? String(rawOrd.sku).trim() : '';
      const rawItem = (rawOrd.item && rawOrd.item !== 'null') ? String(rawOrd.item).trim() : '';

      if (rawSku.includes(',') || rawItem.includes(',')) {
        const skus = rawSku ? rawSku.split(',').map(s => s.trim()) : [];
        const names = rawItem ? rawItem.split(',').map(n => n.trim()) : [];
        const maxLen = Math.max(skus.length, names.length);
        for (let i = 0; i < maxLen; i++) {
          const s = skus[i] || skus[0] || 'S/SKU';
          const n = names[i] || names[0] || s || 'Producto sin nombre';
          items.push({
            sku: s,
            name: n,
            quantity: 1
          });
        }
      } else if (rawSku || rawItem) {
        items.push({
          sku: rawSku || 'S/SKU',
          name: rawItem || rawSku || 'Producto',
          quantity: parseInt(rawOrd.cantidad, 10) || ord.unitsCount || 1
        });
      } else {
        items.push({
          sku: 'S/SKU',
          name: `Pedido #${ord.orderNumber || (ord.id ? ord.id.slice(0, 8) : 'General')}`,
          quantity: parseInt(rawOrd.cantidad, 10) || ord.unitsCount || 1
        });
      }
    }

    ord.items = items;
  });

  billingState.productsStats = computeProductsStatsFromOrders(billableOrders);

  // 10. Cálculo de Almacenamiento y Descuento por Volumen (> 10 m3)
  const defaultStorageM3Rate = activeRange.storage_m3 || 48900;
  let baseStorageM3Rate = defaultStorageM3Rate;

  let defaultDiscountPct = 0;
  let defaultDiscountLabel = "Sin descuento (< 10 m³)";
  if (cfg.storage_discounts && cfg.storage_discounts.length > 0) {
    for (const d of cfg.storage_discounts) {
      if (billingState.volumeM3 >= d.min && billingState.volumeM3 <= d.max) {
        defaultDiscountPct = d.discount_pct;
        defaultDiscountLabel = `${d.discount_pct}% dcto por volumen (${d.min} - ${d.max === 999999 ? '+60' : d.max} m³)`;
        break;
      }
    }
  }

  let storageDiscountPct = defaultDiscountPct;
  let storageDiscountLabel = defaultDiscountLabel;
  let isStorageCustom = false;

  const savedTotals = savedSnapshot?.totals;
  if (customOverrides.storageRate !== undefined) {
    baseStorageM3Rate = Number(customOverrides.storageRate);
    isStorageCustom = true;
  } else if (savedTotals && savedTotals.storageRate !== undefined && savedTotals.storageRate > 0) {
    baseStorageM3Rate = Number(savedTotals.storageRate);
    if (savedTotals.isStorageCustom) isStorageCustom = true;
  }

  if (customOverrides.storageDiscountPct !== undefined) {
    storageDiscountPct = Number(customOverrides.storageDiscountPct);
    storageDiscountLabel = customOverrides.storageDiscountLabel || `${storageDiscountPct}% dcto`;
    isStorageCustom = true;
  } else if (savedTotals && savedTotals.storageDiscountPct !== undefined) {
    storageDiscountPct = Number(savedTotals.storageDiscountPct);
    storageDiscountLabel = savedTotals.storageDiscountLabel || `${storageDiscountPct}% dcto`;
    if (savedTotals.isStorageCustom) isStorageCustom = true;
  }

  const grossStorage = billingState.volumeM3 * baseStorageM3Rate;
  const storageDiscountAmount = Math.round(grossStorage * (storageDiscountPct / 100));
  const netStorageCost = Math.round(grossStorage - storageDiscountAmount);

  // 11. Cálculo de Costo Fijo Mensual (Punto E)
  const minOrdersExemption = cfg.fixed_service_fee.exemption_min_orders ?? 75;
  const minVolumeExemption = cfg.fixed_service_fee.exemption_min_volume ?? 1.5;
  const tier1MaxOrders = cfg.fixed_service_fee.tier1_max_orders ?? 50;
  const tier1MaxVolume = cfg.fixed_service_fee.tier1_max_volume ?? 1.0;
  const tier2MaxOrders = cfg.fixed_service_fee.tier2_max_orders ?? minOrdersExemption;
  const tier2MaxVolume = cfg.fixed_service_fee.tier2_max_volume ?? minVolumeExemption;

  let fixedFeeUF = 0;
  let fixedFeeCLP = 0;
  let fixedFeeReason = "";

  if (billableOrders.length >= minOrdersExemption || billingState.volumeM3 >= minVolumeExemption) {
    fixedFeeUF = 0;
    fixedFeeCLP = 0;
    fixedFeeReason = `Exento ($0) por alcanzar ${billableOrders.length >= minOrdersExemption ? `≥ ${minOrdersExemption} pedidos` : `≥ ${minVolumeExemption} m³`}`;
  } else if (billingState.volumeM3 < tier1MaxVolume && billableOrders.length < tier1MaxOrders) {
    fixedFeeUF = cfg.fixed_service_fee.tier1_fee_uf ?? 1.5;
    fixedFeeCLP = Math.round(fixedFeeUF * billingState.ufValue);
    fixedFeeReason = `Costo variable ${fixedFeeUF} UF (${formatCLP(fixedFeeCLP)}) por operar con < ${tier1MaxOrders} pedidos y < ${tier1MaxVolume} m³`;
  } else {
    fixedFeeUF = cfg.fixed_service_fee.tier2_fee_uf ?? 0.9;
    fixedFeeCLP = Math.round(fixedFeeUF * billingState.ufValue);
    fixedFeeReason = `Costo variable ${fixedFeeUF} UF (${formatCLP(fixedFeeCLP)}) por operar con < ${tier2MaxOrders} pedidos y < ${tier2MaxVolume} m³`;
  }

  // Permitir override del costo fijo si el admin lo modificó
  if (customOverrides.fixedFeeCLP !== undefined) {
    fixedFeeCLP = Math.round(customOverrides.fixedFeeCLP);
    fixedFeeUF = billingState.ufValue > 0 ? parseFloat((fixedFeeCLP / billingState.ufValue).toFixed(2)) : 0;
  }

  // 11.1 Cálculo de Servicio Punto de Venta (POS) - 0,2 UF mensual (Punto G)
  const defaultPosUfRate = cfg.services?.pos_monthly_uf || cfg.pos_service_fee?.monthly_fee_uf || 0.2;
  const savedPosTotals = savedSnapshot?.totals || {};
  const commPosConfig = billingState.commerceInfo?.posConfig || {};

  let isPosActive = commPosConfig.active === true;
  let posFeeUF = 0;
  let posFeeCLP = 0;
  let posFeeDetails = "";
  let posIsStocka = commPosConfig.isStockaMachine || false;
  let posMachine = {
    brand: commPosConfig.brand || '',
    model: commPosConfig.model || '',
    color: commPosConfig.color || '',
    owner: commPosConfig.ownerText || '',
    notes: commPosConfig.notes || ''
  };

  // Manejo de tiendas activas en conglomerado si el padre no tiene POS pero las hijas sí
  const childPosConfigs = billingState.commerceInfo?.childPosConfigs || [];
  if (!isPosActive && childPosConfigs.length > 0) {
    const seenPosStores = new Set();
    const activeChildren = childPosConfigs.filter(c => {
      if (c.posConfig?.active !== true) return false;
      const stUp = String(c.store || '').trim().toUpperCase();
      if (!stUp || seenPosStores.has(stUp)) return false;
      seenPosStores.add(stUp);
      return true;
    });
    if (activeChildren.length > 0) {
      isPosActive = true;
      // El cobro de POS es único por comercio o conglomerado (0,2 UF), sin multiplicar por marcas internas
      posFeeUF = defaultPosUfRate;
      posFeeCLP = Math.round(posFeeUF * billingState.ufValue);
      const childDetails = activeChildren.map(c => {
        const m = c.posConfig;
        const ownerLabel = m.isStockaMachine ? 'Máquina STOCKA' : 'Máquina Propia';
        const parts = [m.brand, m.model ? '#' + m.model : '', m.color ? '(' + m.color + ')' : ''].filter(Boolean).join(' ');
        return `${String(c.store || '').trim().toUpperCase()}: ${ownerLabel}${parts ? ` [${parts}]` : ''}`;
      }).join('; ');
      posFeeDetails = `Habilitación mensual POS (${formatDec(defaultPosUfRate, 1)} UF) @ ${formatCLP(billingState.ufValue)}/UF (${childDetails})`;
      posIsStocka = activeChildren.some(c => c.posConfig?.isStockaMachine);
    }
  } else if (isPosActive) {
    posFeeUF = defaultPosUfRate;
    posFeeCLP = Math.round(posFeeUF * billingState.ufValue);
    const ownerLabel = posIsStocka ? 'Equipo provisto por STOCKA' : 'Equipo propio del comercio';
    const techDetails = [
      posMachine.brand ? `Marca: ${posMachine.brand}` : '',
      posMachine.model ? `N°/Terminal: #${posMachine.model}` : '',
      posMachine.color ? `Color: ${posMachine.color}` : '',
      posMachine.notes ? `Instrucciones: ${posMachine.notes}` : ''
    ].filter(Boolean).join(', ');
    posFeeDetails = `Habilitación mensual POS (0,2 UF) @ ${formatCLP(billingState.ufValue)}/UF. ${ownerLabel}${techDetails ? ` [${techDetails}]` : ''}.`;
  } else {
    posFeeUF = 0;
    posFeeCLP = 0;
    posFeeDetails = 'Punto de Venta no habilitado para este comercio';
  }

  // Respetar snapshot guardado si ya tenía valores calculados (salvo si proviene del cálculo antiguo multiplicado por tiendas)
  const isLegacyMultipliedPos = Boolean(
    String(savedPosTotals.posFeeDetails || '').includes('tienda(s)') ||
    (billingState.isConglomerate && savedPosTotals.posFeeUF > defaultPosUfRate && String(savedPosTotals.posFeeDetails || '').includes('Habilitación POS'))
  );
  if (savedPosTotals.posFeeNet !== undefined && !isLegacyMultipliedPos) {
    posFeeCLP = savedPosTotals.posFeeNet;
    posFeeUF = savedPosTotals.posFeeUF !== undefined ? savedPosTotals.posFeeUF : (billingState.ufValue > 0 ? parseFloat((posFeeCLP / billingState.ufValue).toFixed(2)) : 0);
    if (savedPosTotals.posFeeDetails) posFeeDetails = savedPosTotals.posFeeDetails;
    if (savedPosTotals.posIsStocka !== undefined) posIsStocka = savedPosTotals.posIsStocka;
    if (savedPosTotals.posMachine) posMachine = savedPosTotals.posMachine;
    if (savedPosTotals.posActive !== undefined) isPosActive = savedPosTotals.posActive;
  }

  // Permitir override manual si el usuario editó el cobro de POS en el periodo
  if (customOverrides.posFeeCLP !== undefined) {
    posFeeCLP = Math.round(customOverrides.posFeeCLP);
    posFeeUF = billingState.ufValue > 0 ? parseFloat((posFeeCLP / billingState.ufValue).toFixed(2)) : 0;
    if (customOverrides.posFeeDetails) {
      posFeeDetails = customOverrides.posFeeDetails;
    }
  }

  // 12. Insumos y Ajustes Adicionales (Punto F)
  const currentSuppliesKey = `${billingState.currentPeriodId}_${commerceName}`;
  if (customOverrides.supplies !== undefined) {
    billingState.supplies = customOverrides.supplies;
  } else if (savedSnapshot && Array.isArray(savedSnapshot.supplies)) {
    billingState.supplies = savedSnapshot.supplies;
  } else if (billingState.suppliesSessionKey === currentSuppliesKey && Array.isArray(billingState.supplies)) {
    // Preservar modificaciones o eliminaciones del usuario durante la sesión activa
  } else {
    billingState.supplies = enviameOrders.length > 0 ? [
      { id: 'box_s', name: 'Insumos: cajas de despacho a Regiones', unit: 'gl.', qty: 1, unitPrice: 450, total: 450 }
    ] : [];
    billingState.suppliesSessionKey = currentSuppliesKey;
  }
  syncDynamicSuppliesQuantities(billingState.supplies, billableOrders);
  const totalSuppliesNet = billingState.supplies.reduce((acc, s) => acc + (s.total || 0), 0);

  if (customOverrides.adjustments !== undefined) {
    billingState.adjustments = customOverrides.adjustments;
  } else if (savedSnapshot && Array.isArray(savedSnapshot.adjustments)) {
    billingState.adjustments = savedSnapshot.adjustments;
  } else if (billingState.adjustmentsSessionKey === currentSuppliesKey && Array.isArray(billingState.adjustments)) {
    // Preservar ajustes en memoria durante la sesión activa
  } else {
    billingState.adjustments = [];
    billingState.adjustmentsSessionKey = currentSuppliesKey;
  }
  const totalAdjustmentsNet = billingState.adjustments.reduce((acc, a) => acc + (a.amount || 0), 0);

  // 12.2 Abonos a Cuenta (descuentan directamente del monto a pagar por el cliente)
  if (customOverrides.abonos !== undefined) {
    billingState.abonos = customOverrides.abonos;
  } else if (savedSnapshot && Array.isArray(savedSnapshot.abonos)) {
    billingState.abonos = savedSnapshot.abonos;
  } else if (billingState.abonosSessionKey === currentSuppliesKey && Array.isArray(billingState.abonos)) {
    // Preservar abonos en memoria durante la sesión activa
  } else {
    try {
      let localAbonosStr = localStorage.getItem(`stocka_billing_abonos_${currentSuppliesKey}`);
      if (!localAbonosStr && (commerceName === 'BIG BANG' || commerceName === 'BIG BANG SPA')) {
        localAbonosStr = localStorage.getItem(`stocka_billing_abonos_${billingState.currentPeriodId}_BIG BANG SPA`) ||
                         localStorage.getItem(`stocka_billing_abonos_${billingState.currentPeriodId}_BIG BANG`);
      }
      if (localAbonosStr) {
        billingState.abonos = JSON.parse(localAbonosStr);
      } else {
        billingState.abonos = [];
      }
    } catch (eAb) {
      billingState.abonos = [];
    }
    billingState.abonosSessionKey = currentSuppliesKey;
  }

  // 12.2.b Integrar Ventas Punto de Venta (POS) consideradas como Abono en el Periodo
  try {
    const posData = await fetchAndComputePosSalesAbonoForBilling(commerceGroup, periodName, cfg, ordersList);
    billingState.allMerchantPosSales = posData.allSales;
    billingState.posAbonoSales = posData.periodAbonoSales;
    billingState.posAbonoSummary = posData.summary;
    syncPosAbonoIntoBillingState(billingState);
  } catch (ePosCalc) {
    console.warn('[BillingGenerator] Aviso calculando abonos POS del periodo:', ePosCalc);
    billingState.allMerchantPosSales = [];
    billingState.posAbonoSales = [];
    billingState.posAbonoSummary = { salesCount: 0, totalGross: 0, totalCommissionNet: 0, totalCommissionIva: 0, totalCommissionWithIva: 0, totalAbonoAmount: 0 };
  }

  const totalAbonos = (billingState.abonos || []).reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0);

  // 12.3 Restaurar checks de checklist si vienen en el snapshot guardado
  if (savedSnapshot && savedSnapshot.checklist && savedSnapshot.checklist.checks) {
    if (typeof saveChecklistChecks === 'function') {
      const existingChecks = getChecklistChecks(billingState.currentPeriodId, commerceName);
      if (!existingChecks || Object.keys(existingChecks).length === 0) {
        saveChecklistChecks(billingState.currentPeriodId, commerceName, savedSnapshot.checklist.checks);
      }
    }
  }

  // 13. Totales Finales Consolidados
  const totalNet = Math.round(netStorageCost + totalPickPackNet + totalRmFlexNet + inboundTotalNet + fixedFeeCLP + posFeeCLP + totalSuppliesNet + totalAdjustmentsNet + meliFullNet);
  const totalIVA = Math.round(totalNet * 0.19);
  const totalGross = totalNet + totalIVA;
  const totalToPay = Math.max(0, totalGross - totalAbonos);

  billingState.totals = {
    ordersCount: totalOrdersCount,
    billableOrdersCount: billableOrders.length,
    meliFullOrdersCount: fullMeliOrders.length,
    meliFullUnitsCount,
    meliFullRate,
    meliFullNet,
    storageRate: baseStorageM3Rate,
    defaultStorageRate: defaultStorageM3Rate,
    storageGross: Math.round(grossStorage),
    storageDiscountPct,
    storageDiscountLabel,
    storageDiscountAmount,
    storageNet: netStorageCost,
    isStorageCustom,
    isManualVolume: billingState.isManualVolume,
    autoVolumeM3: billingState.autoVolumeM3,
    pickPackNet: totalPickPackNet,
    shippingRmFlexCount: billableShippingOrders.length,
    shippingRmFlexNet: totalRmFlexNet,
    shippingEnviameCount: enviameOrders.length,
    shippingEnviameNet: 0,
    inboundTotalUF: parseFloat(inboundTotalUF.toFixed(4)),
    inboundNet: inboundTotalNet,
    fixedFeeUF,
    fixedFeeNet: fixedFeeCLP,
    fixedFeeReason,
    posActive: isPosActive,
    posFeeUF,
    posFeeNet: posFeeCLP,
    posFeeDetails,
    posIsStocka,
    posMachine,
    suppliesNet: totalSuppliesNet,
    totalSuppliesNet,
    adjustmentsNet: totalAdjustmentsNet,
    totalAdjustmentsNet,
    totalNet,
    iva: totalIVA,
    totalGross,
    totalAbonos,
    totalToPay
  };

  // 10. Desglose analítico por tienda si es un conglomerado
  billingState.storeBreakdown = computeConglomerateStoreBreakdown(billingState.orders, billingState);

  billingState.isLoading = false;
  return billingState;
}

// --- GENERADOR DEL DESGLOSE ESTÉTICO OFICIAL STOCKA (#5f06fa) ---
export function renderStockaDesgloseHTML(snapshotState = null) {
  const b = snapshotState || billingState;
  const t = b.totals || {};

  // Sincronizar ajustes con la lista real de ajustes para evitar estados huérfanos o desalineados
  const realAdjustments = Array.isArray(b.adjustments) ? b.adjustments : [];
  const realAdjustmentsNet = realAdjustments.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
  t.adjustmentsNet = realAdjustmentsNet;
  t.totalAdjustmentsNet = realAdjustmentsNet;
  const c = b.commerceInfo ? { ...b.commerceInfo } : {};
  const invDates = b.invoiceDates || {};
  const isClient = Boolean(b.isClientView || b.isLocked);
  const commName = b.currentCommerce || b.comercio || '';
  const sBreakdown = (b.storeBreakdown && b.storeBreakdown.length > 0)
    ? b.storeBreakdown
    : (b.isConglomerate ? computeConglomerateStoreBreakdown(b.orders, b) : []);

  // Detección y cálculo garantizado de Cobro de Etiqueta FULL de MELI
  let meliFullOrdersCount = t.meliFullOrdersCount;
  let meliFullUnitsCount = t.meliFullUnitsCount;
  let meliFullNet = t.meliFullNet;

  if (meliFullNet === undefined || meliFullNet === null) {
    const fullMeliOrders = (b.orders || []).filter(o => !o.isExcluded && isFullMeliOrder(o));
    meliFullOrdersCount = fullMeliOrders.length;
    meliFullUnitsCount = fullMeliOrders.reduce((sum, o) => sum + (Math.max(1, parseInt(o.unitsCount, 10) || 1)), 0);
    meliFullNet = meliFullUnitsCount * 100;

    if (meliFullNet > 0) {
      t.meliFullOrdersCount = meliFullOrdersCount;
      t.meliFullUnitsCount = meliFullUnitsCount;
      t.meliFullRate = 100;
      t.meliFullNet = meliFullNet;
      t.totalNet = (t.totalNet || 0) + meliFullNet;
      t.iva = Math.round(t.totalNet * 0.19);
      t.totalGross = t.totalNet + t.iva;
      t.totalToPay = Math.max(0, t.totalGross - (t.totalAbonos || 0));
    }
  }

  // Auto-enriquecimiento de respaldo desde localStorage si RUT o Razón Social vienen vacíos o con guión
  if (commName) {
    try {
      const rawLocal = localStorage.getItem(`stocka_commerce_legal_${commName}`);
      if (rawLocal) {
        const localLegal = JSON.parse(rawLocal);
        if ((!c.rut || c.rut === '—') && localLegal.rut && localLegal.rut !== '—') {
          c.rut = localLegal.rut;
        }
        if ((!c.razonSocial || c.razonSocial === commName) && localLegal.razonSocial) {
          c.razonSocial = localLegal.razonSocial;
        }
        if ((!c.sigla || c.sigla === '—') && localLegal.sigla && localLegal.sigla !== '—') {
          c.sigla = localLegal.sigla;
        }
      }
    } catch (e) {}
  }

  // Formateo seguro de fechas de emisión y vencimiento
  let emisionStr = '';
  let vencimientoStr = '';
  let termLabel = invDates.termLabel || '5 días corridos';

  if (invDates.emisionDate) {
    const p = invDates.emisionDate.split('-');
    if (p.length === 3) emisionStr = `${p[2]}/${p[1]}/${p[0]}`;
  }
  if (invDates.dueDate) {
    const p = invDates.dueDate.split('-');
    if (p.length === 3) vencimientoStr = `${p[2]}/${p[1]}/${p[0]}`;
  }

  if (!emisionStr || !vencimientoStr) {
    const today = new Date();
    emisionStr = today.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 5);
    vencimientoStr = dueDate.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  return `
    <div class="stocka-desglose-paper" id="stocka-printable-invoice">
      <!-- Barra Superior con Logo y Badges -->
      <div class="stocka-main-header">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <img src="${STOCKA_BRAND.logoUrl}" alt="STOCKA" style="height: 44px; width: auto; object-fit: contain;">
        </div>
        
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <span style="background: rgba(95, 6, 250, 0.08); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.25); padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.85rem;">
            ${b.currentPeriodName || b.periodName || 'PERIODO'}
          </span>
          ${b.version ? `
            <span style="background: rgba(16, 185, 129, 0.08); color: #047857; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 5px;" title="Versión oficial: v${b.version}${b.publishedAt ? ` (Publicado: ${new Date(b.publishedAt).toLocaleString('es-CL')})` : ''}">
              <i class="ri-git-commit-line"></i> Versión Oficial: <strong>v${b.version}</strong>
            </span>
          ` : (b.publishedAt ? `
            <span style="background: rgba(16, 185, 129, 0.08); color: #047857; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 5px;">
              <i class="ri-checkbox-circle-line"></i> Versión Publicada
            </span>
          ` : `
            <span style="background: rgba(245, 158, 11, 0.08); color: #b45309; border: 1px solid rgba(245, 158, 11, 0.3); padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 5px;">
              <i class="ri-draft-line"></i> Borrador de Trabajo
            </span>
          `)}
          <span style="background: #f8fafc; color: #475569; border: 1px solid #cbd5e1; padding: 0.4rem 0.85rem; border-radius: 6px; font-weight: 700; font-size: 0.85rem; ${!isClient ? 'cursor: pointer;' : ''} display: inline-flex; align-items: center; gap: 6px;" ${!isClient ? 'onclick="window.openEditDesgloseHeaderModal()" title="Haga clic para editar fechas y plazo de pago"' : ''}>
            <span>Plazo de Pago: ${termLabel} (${vencimientoStr})</span>
            ${!isClient ? '<i class="ri-edit-line no-print" style="color: #5f06fa; font-size: 0.9rem;"></i>' : ''}
          </span>
        </div>
      </div>

      <!-- Tarjetas de Información: Emisor y Cliente (2 Columnas en Paralelo) -->
      <div class="stocka-entities-grid" style="display: flex !important; flex-direction: row !important; gap: 1.25rem !important; margin-bottom: 1.5rem !important; width: 100% !important; box-sizing: border-box !important;">
        <!-- Tarjeta Emisor (STOCKA SPA) -->
        <div class="stocka-entity-card" style="flex: 1 1 0 !important; width: 50% !important; min-width: 0 !important; box-sizing: border-box !important;">
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
        <div class="stocka-entity-card" style="flex: 1 1 0 !important; width: 50% !important; min-width: 0 !important; box-sizing: border-box !important;">
          <div class="stocka-entity-card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span title="Razón Social Oficial">Razón Social: ${escapeHtml(c.razonSocial || c.nombre || c.comercio || b.currentCommerce || b.comercio || '')}</span>
            ${!isClient ? `
            <button type="button" class="no-print" onclick="window.openEditDesgloseHeaderModal()" style="background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.4); color: #ffffff; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Editar fechas y datos fiscales">
              <i class="ri-edit-line"></i> Editar
            </button>` : ''}
          </div>
          <div class="stocka-entity-body">
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Rut:</span>
              <span style="font-weight: 700; color: #0f172a;">${escapeHtml(c.rut || '—')}</span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Cód. Comercio:</span>
              <span style="font-weight: 800; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 1px 6px; border-radius: 4px;">${escapeHtml(c.sigla || '—')}</span>
            </div>
            ${b.isConglomerate ? `
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Tipo Facturación:</span>
              <span style="font-weight: 800; color: #5f06fa; display: inline-flex; align-items: center; gap: 4px; background: rgba(95, 6, 250, 0.08); padding: 1px 6px; border-radius: 4px; font-size: 0.78rem;">
                <i class="ri-building-line"></i> Holding / Conglomerado
              </span>
            </div>
            <div class="stocka-entity-row">
              <span style="color: #64748b; font-weight: 600;">Tiendas Consolidadas:</span>
              <span style="font-weight: 700; color: #0f172a; font-size: 0.78rem; line-height: 1.3;">
                ${(b.conglomerateChildren || []).join(' • ')}
              </span>
            </div>
            ` : ''}
            <div class="stocka-entity-row" ${!isClient ? 'style="cursor: pointer;" onclick="window.openEditDesgloseHeaderModal()" title="Haga clic para editar fecha de emisión"' : ''}>
              <span style="color: #64748b; font-weight: 600;">Fecha Emisión:</span>
              <span style="font-weight: 700; color: #0f172a; display: inline-flex; align-items: center; gap: 4px;">
                ${emisionStr} ${!isClient ? '<i class="ri-pencil-line no-print" style="color: #5f06fa; font-size: 0.8rem;"></i>' : ''}
              </span>
            </div>
            <div class="stocka-entity-row" ${!isClient ? 'style="cursor: pointer;" onclick="window.openEditDesgloseHeaderModal()" title="Haga clic para editar plazo y fecha límite de pago"' : ''}>
              <span style="color: #64748b; font-weight: 600;">Plazo de Pago:</span>
              <span style="font-weight: 700; color: #0f172a; display: inline-flex; align-items: center; gap: 4px;">
                ${vencimientoStr} (${termLabel}) ${!isClient ? '<i class="ri-pencil-line no-print" style="color: #5f06fa; font-size: 0.8rem;"></i>' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Cartas Métricas en una sola fila con diseño sobrio y uniforme -->
      <div class="stocka-metric-row" style="display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; gap: 0.7rem !important; width: 100% !important; box-sizing: border-box !important;">
        <div class="stocka-metric-card" style="flex: 1 1 0 !important; min-width: 0 !important;">
          <div class="stocka-metric-title">Pedidos Procesados</div>
          <div class="stocka-metric-value">${t.billableOrdersCount} <span style="font-size: 0.76rem; font-weight: 600; color: #64748b;">ud.</span></div>
          <div class="stocka-metric-sub">Base: ${formatCLP(b.activeRange?.pick_pack_base || 1250)}</div>
        </div>

        <div class="stocka-metric-card" style="flex: 1 1 0 !important; min-width: 0 !important; ${!isClient ? 'cursor: pointer;' : ''}" ${!isClient ? 'onclick="window.openEditStorageFeeModal()" title="Haga clic para configurar volumen mensual manual, tarifa o descuento"' : ''}>
          <div class="stocka-metric-title" style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
            <span style="overflow: hidden; text-overflow: ellipsis;">Almacenamiento Mes</span>
            ${!isClient && (b.isManualVolume || t.isManualVolume) ? `
              <span class="no-print" style="background: rgba(95, 6, 250, 0.1); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.25); font-size: 0.58rem; font-weight: 800; padding: 1px 4px; border-radius: 4px; text-transform: uppercase; flex-shrink: 0;">
                Manual
              </span>
            ` : ''}
          </div>
          <div class="stocka-metric-value">${formatDec(b.volumeM3, 2)} <span style="font-size: 0.76rem; font-weight: 600; color: #64748b;">m³</span></div>
          <div class="stocka-metric-sub">Tarifa: ${formatCLP(t.storageRate || b.activeRange?.storage_m3 || 48900)} / m³</div>
        </div>

        <div class="stocka-metric-card" style="flex: 1 1 0 !important; min-width: 0 !important;">
          <div class="stocka-metric-title">UF del Periodo</div>
          <div class="stocka-metric-value">${formatCLP(b.ufValue)}</div>
          <div class="stocka-metric-sub">Día ${b.ufDate || '01/08/2026'}</div>
        </div>

        <div class="stocka-metric-card" style="flex: 1 1 0 !important; min-width: 0 !important;">
          <div class="stocka-metric-title">Costo Variable Mensual</div>
          <div class="stocka-metric-value">${t.fixedFeeUF > 0 ? `${formatDec(t.fixedFeeUF, 1)} UF` : 'EXENTO'}</div>
          <div class="stocka-metric-sub">${t.fixedFeeUF > 0 ? formatCLP(t.fixedFeeNet) : '$0'}</div>
        </div>

        ${(t.posActive || t.posFeeUF > 0) ? `
        <div class="stocka-metric-card" style="flex: 1 1 0 !important; min-width: 0 !important; border-top: 3px solid #0ea5e9;">
          <div class="stocka-metric-title"><i class="ri-store-3-line" style="color: #0ea5e9;"></i> Punto de Venta (POS)</div>
          <div class="stocka-metric-value" style="color: #0ea5e9;">${t.posFeeUF > 0 ? `${formatDec(t.posFeeUF, 1)} UF` : 'EXENTO'}</div>
          <div class="stocka-metric-sub">${t.posFeeUF > 0 ? formatCLP(t.posFeeNet) : '$0'} · ${t.posIsStocka ? 'Equipo STOCKA' : 'Equipo Propio'}</div>
        </div>
        ` : ''}
      </div>

      <!-- Hero Card: Total a Facturar, Abonos y Monto a Pagar (Resumen alineado a la derecha) -->
      <div class="stocka-banner-hero">
        <div style="display: flex; gap: 1.15rem; align-items: center; flex-wrap: nowrap; flex: 1 1 auto; min-width: 0;">
          <div>
            <div style="font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.85; font-weight: 600; margin-bottom: 2px;">Subtotal Neto</div>
            <div style="font-size: 1.08rem; font-weight: 800; white-space: nowrap;">${formatCLP(t.totalNet)}</div>
          </div>
          <div style="border-left: 1px solid rgba(255,255,255,0.22); padding-left: 1.05rem;">
            <div style="font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.85; font-weight: 600; margin-bottom: 2px;">IVA (19%)</div>
            <div style="font-size: 1.08rem; font-weight: 800; white-space: nowrap;">${formatCLP(t.iva)}</div>
          </div>
          <div style="border-left: 1px solid rgba(255,255,255,0.22); padding-left: 1.05rem;">
            <div style="font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.85; font-weight: 600; margin-bottom: 2px;">Descuentos / Ajustes</div>
            <div style="font-size: 1.08rem; font-weight: 800; white-space: nowrap;">${t.adjustmentsNet ? formatCLP(t.adjustmentsNet) : '$0'}</div>
          </div>
          ${t.totalAbonos > 0 ? `
          <div style="border-left: 1px solid rgba(255,255,255,0.22); padding-left: 1.05rem;">
            <div style="font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; color: #a7f3d0; margin-bottom: 2px;">Abonos Registrados</div>
            <div style="font-size: 1.08rem; font-weight: 800; color: #6ee7b7; white-space: nowrap;">-${formatCLP(t.totalAbonos)}</div>
          </div>
          ` : ''}
        </div>

        <div style="margin-left: auto; text-align: right; background: rgba(15, 23, 42, 0.24); border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 8px; padding: 0.65rem 1.1rem; min-width: 265px; flex-shrink: 0;">
          ${t.totalAbonos > 0 ? `
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; width: 100%; font-size: 0.72rem; letter-spacing: 0.3px;">
                <span style="opacity: 0.88; font-weight: 600; text-transform: uppercase;">Monto a Facturar (c/IVA):</span>
                <strong style="font-weight: 800; font-size: 0.86rem; color: #ffffff;">${formatCLP(t.totalGross)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; width: 100%; font-size: 0.72rem; color: #a7f3d0; font-weight: 700;">
                <span style="display: inline-flex; align-items: center; gap: 4px;"><i class="ri-checkbox-circle-fill"></i> Abonos a favor:</span>
                <strong>-${formatCLP(t.totalAbonos)}</strong>
              </div>
              <div style="margin-top: 3px; border-top: 1px solid rgba(255,255,255,0.25); padding-top: 5px; width: 100%; text-align: right;">
                <div style="font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.9px; font-weight: 800; color: #fde047;">MONTO A PAGAR (SALDO)</div>
                <div style="font-size: 1.75rem; font-weight: 900; line-height: 1.08; color: #ffffff; letter-spacing: -0.3px;">${formatCLP(t.totalToPay)}</div>
              </div>
            </div>
          ` : `
            <div style="text-align: right;">
              <div style="font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.9px; font-weight: 800; color: #fde047; margin-bottom: 2px;">TOTAL A FACTURAR / PAGAR (IVA INCL.)</div>
              <div style="font-size: 1.8rem; font-weight: 900; line-height: 1.08; color: #ffffff; letter-spacing: -0.3px;">${formatCLP(t.totalToPay)}</div>
            </div>
          `}
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
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                      <span style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Servicio de almacenamiento</span>
                      ${!isClient && (b.isManualVolume || t.isManualVolume) ? `
                        <span class="no-print" style="background: rgba(95, 6, 250, 0.1); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.25); font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Volumen mensual indicado manualmente por Admin (Automático BD: ${formatDec(b.autoVolumeM3 ?? t.autoVolumeM3 ?? 0, 2)} m³)">
                          <i class="ri-edit-2-line"></i> Volumen Manual
                        </span>
                      ` : ''}
                      ${!isClient && t.isStorageCustom ? `
                        <span class="no-print" style="background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px;">
                          Tarifa/Dcto Manual
                        </span>
                      ` : ''}
                    </div>
                    <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                      ${formatDec(b.volumeM3, 2)} m³ @ ${formatCLP(t.storageRate || b.activeRange?.storage_m3 || 48900)} / m³ ${t.storageDiscountPct > 0 ? `(${t.storageDiscountLabel || `${t.storageDiscountPct}% dcto`})` : ''}
                    </div>
                  </div>
                  ${!isClient ? `
                  <div class="no-print">
                    <button type="button" onclick="window.openEditStorageFeeModal()" title="Editar tarifa de almacenamiento o porcentaje de descuento" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #475569; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                      <i class="ri-pencil-line"></i> Editar
                    </button>
                  </div>` : ''}
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
                  ${(() => {
                    const billable = (b.orders || []).filter(o => !o.isExcluded);
                    const posCount = billable.filter(o => o.isPosOrder || isPosSaleOrder(o)).length;
                    const posNote = posCount > 0 ? ` (incluye ${posCount} venta${posCount === 1 ? '' : 's'} Punto de Venta POS base $1.490)` : '';
                    const baseDesc = `Pick & Pack base ${formatCLP(b.activeRange?.pick_pack_base || 1250)}${posNote} + recargos por SKUs adicionales y unidades`;
                    const activeCols = Array.isArray(b.customColumns) ? b.customColumns : [];
                    if (activeCols.length === 0) return baseDesc;
                    const colSummaries = activeCols.map(col => {
                      const colSum = billable.reduce((acc, o) => acc + Math.max(0, Number(o.customSurcharges?.[col.id]) || 0), 0);
                      if (colSum <= 0) return null;
                      const modeTxt = col.mode === 'per_unit' ? `${formatCLP(col.rate)}/unid.` : `${formatCLP(col.rate)} global`;
                      return `${escapeHtml(col.name)} (${modeTxt}: ${formatCLP(colSum)})`;
                    }).filter(Boolean);
                    return colSummaries.length > 0
                      ? `${baseDesc} + recargos personalizados [${colSummaries.join(' · ')}]`
                      : baseDesc;
                  })()}
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

            <!-- 4.2 Cobro de Etiqueta FULL de MELI (si aplica) -->
            ${((t.meliFullNet > 0) || (meliFullUnitsCount > 0)) ? `
              <tr>
                <td>
                  <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Cobro de etiqueta FULL de MELI</div>
                  <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                    $100 por producto incluido en el pedido (${t.meliFullUnitsCount || meliFullUnitsCount} unidades en ${t.meliFullOrdersCount || meliFullOrdersCount} pedido${(t.meliFullOrdersCount || meliFullOrdersCount) === 1 ? '' : 's'} con agenda FULL MERCADOLIBRE)
                  </div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">ud.</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">${t.meliFullUnitsCount || meliFullUnitsCount}</td>
                <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.meliFullNet || meliFullNet)}</td>
                <td style="text-align: right; color: #64748b;">${formatCLP((t.meliFullNet || meliFullNet) * 0.19)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP((t.meliFullNet || meliFullNet) * 1.19)}</td>
              </tr>
            ` : ''}

            <!-- 5. Insumos -->
            ${b.supplies.filter(s => (s.qty || 0) > 0 || (!isClient && s.qtyMode === 'dynamic_groups')).map((s, idx) => `
              <tr>
                <td>
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <div>
                      <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                        <span style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">${escapeHtml(s.name)}</span>
                        ${s.qtyMode === 'dynamic_groups' && s.formulaCode ? `
                          <span style="background: rgba(95, 6, 250, 0.08); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.24); font-size: 0.67rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Cantidad calculada dinámicamente según grupos de pedidos seleccionados">
                            <i class="ri-links-line"></i> ${escapeHtml(s.formulaCode)}
                          </span>
                        ` : ''}
                      </div>
                      <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">
                        ${s.qtyMode === 'dynamic_groups' && s.dynamicSummary
                          ? `Insumos y material de empaque · Calculado sobre ${escapeHtml(s.dynamicSummary)}${!s.isBubbleLinearCm && s.unitPrice ? ` · ${formatCLP(s.unitPrice)} c/u` : ''}`
                          : `Insumos y material de empaque${(s.qty > 1 && s.unitPrice > 0) ? ` · ${formatCLP(s.unitPrice)} c/u` : ''}`}
                      </div>
                    </div>
                    ${!isClient ? `
                    <div class="no-print" style="display: flex; gap: 4px; align-items: center;">
                      <button type="button" onclick="window.editManualSupplyItem('${s.id || idx}')" title="Editar cantidad, grupos dinámicos o precio de este insumo" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #475569; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-pencil-line"></i> Editar
                      </button>
                      <button type="button" onclick="window.deleteManualSupplyItem('${s.id || idx}')" title="Eliminar este ítem de cobro" style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #dc2626; font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-delete-bin-line"></i> Eliminar
                      </button>
                    </div>` : ''}
                  </div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">${escapeHtml(s.unit || (s.isBubbleLinearCm ? 'gl.' : 'ud.'))}</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">${s.qty}</td>
                <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(s.total)}</td>
                <td style="text-align: right; color: #64748b;">${formatCLP((s.total || 0) * 0.19)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP((s.total || 0) * 1.19)}</td>
              </tr>
            `).join('')}

            <!-- 6. Costo Variable Mensual -->
            <tr>
              <td>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                  <div>
                    <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Costo Variable Mensual Fulfillment ${t.fixedFeeUF > 0 ? (t.fixedFeeUF === 1.5 ? '- Rango 1' : '- Rango 2') : '(Exento)'}</div>
                    <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">${escapeHtml(t.fixedFeeReason || '')}</div>
                  </div>
                  ${!isClient ? `
                  <div class="no-print">
                    <button type="button" onclick="window.openEditFixedFeeModal()" title="Editar o eximir costo variable mensual" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #475569; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                      <i class="ri-pencil-line"></i> Editar
                    </button>
                  </div>` : ''}
                </div>
              </td>
              <td style="text-align: center; font-weight: 600; color: #64748b;">UF</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${t.fixedFeeUF > 0 ? formatDec(t.fixedFeeUF, 1) : '0'}</td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.fixedFeeNet)}</td>
              <td style="text-align: right; color: #64748b;">${formatCLP(t.fixedFeeNet * 0.19)}</td>
              <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP(t.fixedFeeNet * 1.19)}</td>
            </tr>

            <!-- 6.1 Servicio Punto de Venta (POS) -->
            ${(t.posFeeUF > 0 || t.posActive) ? `
            <tr>
              <td>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                      <span style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Servicio de Punto de Venta (POS) - Sucursal Ñuñoa</span>
                      ${t.posIsStocka ? `
                        <span style="background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe; font-size: 0.7rem; font-weight: 700; padding: 1px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                          <i class="ri-store-3-line"></i> Equipo STOCKA
                        </span>
                      ` : `
                        <span style="background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; font-size: 0.7rem; font-weight: 700; padding: 1px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                          <i class="ri-user-star-line"></i> Equipo Propio del Comercio
                        </span>
                      `}
                    </div>
                    <div style="font-size: 0.725rem; color: #64748b; margin-top: 3px; line-height: 1.35;">
                      ${escapeHtml(t.posFeeDetails || '')}
                    </div>
                  </div>
                  ${!isClient ? `
                  <div class="no-print">
                    <button type="button" onclick="window.openEditPosFeeModal()" title="Editar o eximir cobro de Punto de Venta" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #475569; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                      <i class="ri-pencil-line"></i> Editar
                    </button>
                  </div>` : ''}
                </div>
              </td>
              <td style="text-align: center; font-weight: 600; color: #64748b;">UF</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${t.posFeeUF > 0 ? formatDec(t.posFeeUF, 1) : '0'}</td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(t.posFeeNet)}</td>
              <td style="text-align: right; color: #64748b;">${formatCLP(t.posFeeNet * 0.19)}</td>
              <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP(t.posFeeNet * 1.19)}</td>
            </tr>
            ` : ''}

            <!-- 7. Ajustes Comerciales si existen -->
            ${b.adjustments.map((a, idx) => `
              <tr>
                <td>
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <div>
                      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">${escapeHtml(a.concept || 'Ajuste comercial')}</span>
                        ${(a.isObservationAdjustment || a.linkedObservationKey) ? `
                          <span style="background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; font-size: 0.67rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Ingresado desde Apelación / Observación de Facturación">
                            <i class="ri-question-answer-line"></i> Apelación${a.linkedObservationPeriod ? ` (${escapeHtml(a.linkedObservationPeriod)})` : ''}
                          </span>
                        ` : ''}
                      </div>
                      <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">${escapeHtml(a.notes || '')}</div>
                    </div>
                    ${!isClient ? `
                    <div class="no-print" style="display: flex; gap: 4px; align-items: center;">
                      <button type="button" onclick="window.deleteManualAdjustmentItem('${a.id || idx}')" title="Eliminar este ajuste" style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #dc2626; font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-delete-bin-line"></i> Eliminar
                      </button>
                    </div>` : ''}
                  </div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">gl.</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">1</td>
                <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(a.amount)}</td>
                <td style="text-align: right; color: #64748b;">${formatCLP((a.amount || 0) * 0.19)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP((a.amount || 0) * 1.19)}</td>
              </tr>
            `).join('')}

            <!-- 8. Abonos Registrados a Cuenta (Descuentan directamente el total a pagar) -->
            ${(b.abonos || []).map((ab, idx) => `
              <tr style="background: rgba(16, 185, 129, 0.04); border-left: 3px solid #10b981;">
                <td>
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <div>
                      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span style="background: ${ab.isPosAbono || ab.id === 'abono_pos_sales' ? '#059669' : ((ab.isObservationAbono || ab.linkedObservationKey) ? '#5f06fa' : '#10b981')}; color: #ffffff; padding: 2px 7px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; display: inline-flex; align-items: center; gap: 3px;">
                          <i class="${ab.isPosAbono || ab.id === 'abono_pos_sales' ? 'ri-store-3-line' : ((ab.isObservationAbono || ab.linkedObservationKey) ? 'ri-question-answer-line' : 'ri-hand-coin-line')}"></i> ${ab.isPosAbono || ab.id === 'abono_pos_sales' ? 'Abono Ventas POS' : ((ab.isObservationAbono || ab.linkedObservationKey) ? `Saldo por Apelación${ab.linkedObservationPeriod ? ` (${escapeHtml(ab.linkedObservationPeriod)})` : ''}` : 'Abono')}
                        </span>
                        <strong style="color: #0f172a; font-size: 0.85rem;">${escapeHtml(ab.reference || 'Abono a cuenta')}</strong>
                        ${ab.voucher ? `<span style="font-size: 0.72rem; color: #047857; background: rgba(16, 185, 129, 0.12); padding: 1px 6px; border-radius: 4px; font-weight: 600;">${escapeHtml(ab.voucher)}</span>` : ''}
                      </div>
                      <div style="font-size: 0.72rem; color: #047857; margin-top: 3px;">
                        ${ab.date ? `Fecha: <strong>${escapeHtml(ab.date)}</strong>` : ''}
                        ${ab.notes ? ` · ${escapeHtml(ab.notes)}` : ''}
                        · <em>Descuenta directamente el saldo a pagar por el cliente</em>
                      </div>
                    </div>
                    ${!isClient ? `
                    <div class="no-print" style="display: flex; gap: 4px; align-items: center;">
                      ${(ab.isPosAbono || ab.id === 'abono_pos_sales') ? `
                        <button type="button" onclick="window.openManagePosAbonosBillingModal()" title="Gestionar ventas POS incluidas como abono en este periodo" style="background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 4px; padding: 2px 8px; cursor: pointer; color: #047857; font-size: 0.74rem; font-weight: 800; display: inline-flex; align-items: center; gap: 3px;">
                          <i class="ri-list-check-2"></i> Detalle / Gestionar POS
                        </button>
                      ` : ''}
                      <button type="button" onclick="window.editManualAbonoItem('${ab.id || idx}')" title="Editar este abono" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #059669; font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-edit-line"></i> Editar
                      </button>
                      <button type="button" onclick="window.deleteManualAbonoItem('${ab.id || idx}')" title="Eliminar este abono" style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #dc2626; font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-delete-bin-line"></i> Eliminar
                      </button>
                    </div>` : ''}
                  </div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">gl.</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">${ab.salesCount || 1}</td>
                <td style="text-align: right; color: #64748b;">—</td>
                <td style="text-align: right; color: #64748b;">—</td>
                <td style="text-align: right; font-weight: 800; color: #059669; font-size: 0.95rem;">
                  -${formatCLP(ab.amount)}
                </td>
              </tr>
            `).join('')}

            <!-- Fila de Totales Finales (Monto a Facturar) -->
            <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #5f06fa;">
              <td colspan="3" style="text-align: right; padding-right: 1.5rem; font-size: 0.9rem; color: #0f172a;">
                ${t.totalAbonos > 0 ? 'MONTO TOTAL A FACTURAR (CON IVA):' : 'TOTALES DEL PERIODO:'}
              </td>
              <td style="text-align: right; color: #5f06fa; font-size: 0.95rem;">${formatCLP(t.totalNet)}</td>
              <td style="text-align: right; color: #5f06fa; font-size: 0.95rem;">${formatCLP(t.iva)}</td>
              <td style="text-align: right; color: #5f06fa; font-size: 1.05rem; font-weight: 900;">${formatCLP(t.totalGross)}</td>
            </tr>

            ${t.totalAbonos > 0 ? `
            <!-- Fila Resumen de Abonos Registrados -->
            <tr style="background: rgba(16, 185, 129, 0.05); font-weight: 800; border-top: 1px solid rgba(16, 185, 129, 0.25);">
              <td colspan="5" style="text-align: right; padding-right: 1.5rem; font-size: 0.88rem; color: #047857;">
                <i class="ri-checkbox-circle-line"></i> (-) TOTAL ABONOS REGISTRADOS:
              </td>
              <td style="text-align: right; color: #047857; font-size: 1.05rem; font-weight: 900;">
                -${formatCLP(t.totalAbonos)}
              </td>
            </tr>

            <!-- Fila Resumen Monto Final a Pagar -->
            <tr style="background: #f5f3ff; font-weight: 900; border-top: 2px solid #5f06fa;">
              <td colspan="5" style="text-align: right; padding-right: 1.5rem; font-size: 0.95rem; color: #5f06fa;">
                MONTO FINAL A PAGAR POR EL CLIENTE (SALDO):
              </td>
              <td style="text-align: right; color: #5f06fa; font-size: 1.25rem; font-weight: 900;">
                ${formatCLP(t.totalToPay)}
              </td>
            </tr>
            ` : ''}
          </tbody>
        </table>
      </div>

      ${b.isConglomerate && sBreakdown && sBreakdown.length > 0 ? `
        <!-- Desglose Consolidado por Tienda del Conglomerado -->
        <div style="margin-top: 1.5rem; background: #ffffff; border-radius: 10px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="background: rgba(95, 6, 250, 0.05); padding: 0.75rem 1.25rem; border-bottom: 1px solid rgba(95, 6, 250, 0.15); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 28px; height: 28px; border-radius: 6px; background: #5f06fa; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1rem;">
                <i class="ri-pie-chart-2-line"></i>
              </div>
              <div>
                <strong style="color: #0f172a; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.4px;">
                  Resumen Consolidado por Tienda del Conglomerado
                </strong>
                <div style="font-size: 0.72rem; color: #64748b;">
                  Distribución de pedidos, preparación y despachos de ${escapeHtml(b.currentCommerce || b.comercio || 'Conglomerado')}
                </div>
              </div>
            </div>
            <span style="background: #ffffff; color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.3); padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.725rem; font-weight: 800;">
              ${sBreakdown.length} TIENDAS AGRUPADAS
            </span>
          </div>

          <div style="overflow-x: auto;">
            <table class="stocka-table-official" style="margin: 0; border: none; width: 100%;">
              <thead>
                <tr style="background: #f8fafc;">
                  <th style="text-align: left; padding: 8px 12px;">TIENDA / COMERCIO</th>
                  <th style="text-align: center; width: 85px;">PEDIDOS</th>
                  <th style="text-align: center; width: 85px;">ENVÍOS RM</th>
                  <th style="text-align: right; width: 120px;">PICK & PACK</th>
                  <th style="text-align: right; width: 120px;">FLETE RM</th>
                  <th style="text-align: right; width: 130px;">TOTAL NETO OP.</th>
                  <th style="text-align: right; width: 90px;">% PART.</th>
                </tr>
              </thead>
              <tbody>
                ${sBreakdown.map(s => `
                  <tr>
                    <td style="padding: 8px 12px;">
                      <div style="font-weight: 700; color: #0f172a; font-size: 0.825rem; display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                        <span style="display: inline-flex; align-items: center; gap: 5px;">
                          <i class="ri-store-2-line" style="color: #5f06fa;"></i> ${escapeHtml(s.storeName)}
                        </span>
                        ${!b.isClientView ? `
                          <div class="no-print" style="display: flex; gap: 4px;">
                            <button type="button"
                                    onclick="window.switchBgSubTab('register'); window.setConglomerateStoreView('${escapeHtml(s.storeName)}');"
                                    class="btn btn-xs"
                                    style="background: rgba(95,6,250,0.08); color: #5f06fa; border: 1px solid rgba(95,6,250,0.25); border-radius: 4px; padding: 2px 6px; font-size: 0.68rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;"
                                    title="Ver tabla de pedidos filtrada para ${escapeHtml(s.storeName)}">
                              <i class="ri-table-line"></i> Pedidos
                            </button>
                            <button type="button"
                                    onclick="window.switchBgSubTab('analytics'); window.setConglomerateStoreView('${escapeHtml(s.storeName)}');"
                                    class="btn btn-xs"
                                    style="background: rgba(95,6,250,0.08); color: #5f06fa; border: 1px solid rgba(95,6,250,0.25); border-radius: 4px; padding: 2px 6px; font-size: 0.68rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;"
                                    title="Ver analítica y gráficos de ${escapeHtml(s.storeName)}">
                              <i class="ri-pie-chart-line"></i> Analítica
                            </button>
                          </div>
                        ` : ''}
                      </div>
                      ${s.totalSalesTicket > 0 ? `<div style="font-size: 0.68rem; color: #64748b; margin-top: 1px;">Venta total declarada: ${formatCLP(s.totalSalesTicket)}</div>` : ''}
                    </td>
                    <td style="text-align: center; font-weight: 700; color: #0f172a;">${s.billableOrders}</td>
                    <td style="text-align: center; font-weight: 600; color: #475569;">${s.shippingRmCount}</td>
                    <td style="text-align: right; font-weight: 600; color: #0f172a;">${formatCLP(s.pickPackNet)}</td>
                    <td style="text-align: right; font-weight: 600; color: #0f172a;">${formatCLP(s.shippingFreightNet)}</td>
                    <td style="text-align: right; font-weight: 800; color: #5f06fa;">${formatCLP(s.storeTotalNet)}</td>
                    <td style="text-align: right; font-weight: 700; color: #0f172a;">
                      <span style="background: rgba(95, 6, 250, 0.08); padding: 2px 6px; border-radius: 4px;">${s.sharePct}%</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background: #f8fafc; font-weight: 800; border-top: 1px solid #cbd5e1;">
                  <td style="text-align: left; padding: 8px 12px; color: #0f172a;">TOTALES OPERACIONALES:</td>
                  <td style="text-align: center; color: #0f172a;">${sBreakdown.reduce((sum, s) => sum + s.billableOrders, 0)}</td>
                  <td style="text-align: center; color: #0f172a;">${sBreakdown.reduce((sum, s) => sum + s.shippingRmCount, 0)}</td>
                  <td style="text-align: right; color: #0f172a;">${formatCLP(sBreakdown.reduce((sum, s) => sum + s.pickPackNet, 0))}</td>
                  <td style="text-align: right; color: #0f172a;">${formatCLP(sBreakdown.reduce((sum, s) => sum + s.shippingFreightNet, 0))}</td>
                  <td style="text-align: right; color: #5f06fa; font-size: 0.9rem;">${formatCLP(sBreakdown.reduce((sum, s) => sum + s.storeTotalNet, 0))}</td>
                  <td style="text-align: right; color: #5f06fa;">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ` : ''}

      ${((Array.isArray(b.posAbonoSales) && b.posAbonoSales.length > 0) || (!isClient && Array.isArray(b.allMerchantPosSales) && b.allMerchantPosSales.length > 0)) ? (() => {
        const posSalesList = Array.isArray(b.posAbonoSales) ? b.posAbonoSales : [];
        const sumGross = posSalesList.reduce((acc, s) => acc + (Number(s.monto_total) || 0), 0);
        const sumCommNet = posSalesList.reduce((acc, s) => acc + (Number(s.commission_net) || 0), 0);
        const sumCommIva = posSalesList.reduce((acc, s) => acc + (Number(s.commission_iva) || 0), 0);
        const sumCommTotal = posSalesList.reduce((acc, s) => acc + (Number(s.commission_total) || 0), 0);
        const sumAbono = posSalesList.reduce((acc, s) => acc + (Number(s.seller_payout) || 0), 0);

        return `
          <!-- Detalle de Ventas Punto de Venta (POS) Consideradas como Abono en el Periodo -->
          <div style="margin-top: 1.5rem; background: #ffffff; border-radius: 10px; border: 1.5px solid rgba(16, 185, 129, 0.4); overflow: hidden; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.06);">
            <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.09) 0%, rgba(5, 150, 105, 0.03) 100%); padding: 0.85rem 1.25rem; border-bottom: 1px solid rgba(16, 185, 129, 0.25); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.65rem;">
              <div style="display: flex; align-items: center; gap: 0.6rem;">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: #059669; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;">
                  <i class="ri-store-3-line"></i>
                </div>
                <div>
                  <strong style="color: #064e3b; font-size: 0.86rem; text-transform: uppercase; letter-spacing: 0.4px; display: block;">
                    Detalle de Ventas Punto de Venta (POS) Consideradas como Abono en el Periodo
                  </strong>
                  <div style="font-size: 0.72rem; color: #047857; margin-top: 1px;">
                    Recaudación en máquina POS propiedad de Stocka descontando comisiones vigentes (+IVA) e imputada como abono en <strong>${escapeHtml(b.currentPeriodName || b.periodName || '')}</strong>
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span style="background: #ffffff; color: #047857; border: 1px solid rgba(16, 185, 129, 0.4); padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.725rem; font-weight: 800;">
                  ${posSalesList.length} VENTA${posSalesList.length === 1 ? '' : 'S'} · ABONO: ${formatCLP(sumAbono)}
                </span>
                ${!isClient ? `
                  <button type="button" class="no-print" onclick="window.openManagePosAbonosBillingModal()" style="background: #059669; color: #ffffff; border: none; padding: 0.3rem 0.75rem; border-radius: 6px; font-size: 0.73rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(5, 150, 105, 0.25);">
                    <i class="ri-settings-3-line"></i> Gestionar Ventas POS del Periodo
                  </button>
                ` : ''}
              </div>
            </div>

            ${posSalesList.length === 0 ? `
              <div style="padding: 1.25rem; text-align: center; font-size: 0.8rem; color: #64748b;">
                No hay ventas POS asignadas como abono para el periodo <strong>${escapeHtml(b.currentPeriodName || '')}</strong>.
                ${!isClient ? `Puedes asignar o revisar las ${(b.allMerchantPosSales || []).length} ventas históricas del comercio haciendo clic en <strong>"Gestionar Ventas POS del Periodo"</strong>.` : ''}
              </div>
            ` : `
              <div style="overflow-x: auto;">
                <table class="stocka-table-official" style="margin: 0; border: none; width: 100%;">
                  <thead>
                    <tr style="background: #f0fdf4;">
                      <th style="text-align: center; width: 38px; padding: 7px 8px;">#</th>
                      <th style="text-align: left; width: 115px; padding: 7px 8px;">FECHA</th>
                      <th style="text-align: left; width: 135px; padding: 7px 8px;">CÓDIGO VENTA / TX</th>
                      ${b.isConglomerate ? `<th style="text-align: left; width: 115px; padding: 7px 8px;">TIENDA</th>` : ''}
                      <th style="text-align: left; padding: 7px 8px;">CLIENTE / PRODUCTOS</th>
                      <th style="text-align: left; width: 120px; padding: 7px 8px;">MEDIO DE PAGO</th>
                      <th style="text-align: left; width: 145px; padding: 7px 8px;">MÁQUINA POS</th>
                      <th style="text-align: right; width: 110px; padding: 7px 8px;">VENTA BRUTA</th>
                      <th style="text-align: right; width: 130px; padding: 7px 8px;">COMISIÓN POS (+IVA)</th>
                      <th style="text-align: right; width: 135px; padding: 7px 10px; background: #dcfce7; color: #065f46;">ABONO AL SERVICIO</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${posSalesList.map((s, idx) => {
                      const d = s.created_at ? new Date(s.created_at) : null;
                      const dateFmt = (d && !isNaN(d.getTime()))
                        ? d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
                        : '-';
                      return `
                        <tr>
                          <td style="text-align: center; color: #64748b; font-weight: 700; padding: 7px 8px;">${idx + 1}</td>
                          <td style="font-size: 0.75rem; color: #334155; white-space: nowrap; padding: 7px 8px;">${escapeHtml(dateFmt)}</td>
                          <td style="padding: 7px 8px;">
                            <span style="font-family: monospace; font-size: 0.76rem; font-weight: 800; background: #f8fafc; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; color: #0f172a; display: inline-block;">
                              ${escapeHtml(s.codigo_venta)}
                            </span>
                            ${s.tx_code ? `<div style="margin-top: 2px;"><span style="font-family: monospace; font-size: 0.68rem; font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 5px; border-radius: 4px; display: inline-block;" title="Código de Transacción Único">TX: ${escapeHtml(s.tx_code)}</span></div>` : ''}
                          </td>
                          ${b.isConglomerate ? `<td style="font-size: 0.76rem; font-weight: 700; color: #0f172a; padding: 7px 8px;">${escapeHtml(s.comercio)}</td>` : ''}
                          <td style="padding: 7px 8px;">
                            <div style="font-weight: 700; font-size: 0.78rem; color: #0f172a;">${escapeHtml(s.nombre_cliente || 'Consumidor Final')}</div>
                            ${s.productos_summary ? `<div style="font-size: 0.68rem; color: #64748b; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(s.productos_summary)}">${escapeHtml(s.productos_summary)}</div>` : ''}
                          </td>
                          <td style="font-size: 0.75rem; font-weight: 600; color: #1e293b; padding: 7px 8px;">
                            ${escapeHtml(s.modo_pago || '-')}
                            <div style="font-size: 0.65rem; color: #64748b;">${escapeHtml(s.documento_tipo || 'BOLETA')}</div>
                          </td>
                          <td style="padding: 7px 8px;">
                            <div style="font-size: 0.76rem; font-weight: 700; color: #0f172a;">
                              ${escapeHtml(s.machine_brand || 'Transbank')} ${s.machine_model ? `<span style="font-family: monospace; background: #2563eb; color: #fff; padding: 0 4px; border-radius: 3px; font-size: 0.68rem;">#${escapeHtml(s.machine_model)}</span>` : ''}
                            </div>
                            <span style="font-size: 0.65rem; font-weight: 700; color: #1d4ed8;">Propiedad de ${escapeHtml(s.machine_owner || 'STOCKA')}</span>
                          </td>
                          <td style="text-align: right; font-weight: 700; color: #0f172a; padding: 7px 8px;">${formatCLP(s.monto_total)}</td>
                          <td style="text-align: right; padding: 7px 8px;">
                            <div style="font-weight: 700; color: #dc2626; font-size: 0.78rem;">-${formatCLP(s.commission_total)}</div>
                            <div style="font-size: 0.64rem; color: #64748b;">${Number(s.fee_pct || 0).toFixed(2)}% + IVA (${formatCLP(s.commission_net)} + ${formatCLP(s.commission_iva)})</div>
                          </td>
                          <td style="text-align: right; font-weight: 900; color: #059669; font-size: 0.86rem; background: rgba(16, 185, 129, 0.05); padding: 7px 10px;">
                            ${formatCLP(s.seller_payout)}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                  <tfoot>
                    <tr style="background: #ecfdf5; font-weight: 800; border-top: 2px solid #10b981;">
                      <td colspan="${b.isConglomerate ? 7 : 6}" style="text-align: right; padding: 8px 12px; color: #064e3b; font-size: 0.82rem;">
                        TOTAL VENTAS POS CONSIDERADAS EN EL PERIODO (${posSalesList.length} VENTA${posSalesList.length === 1 ? '' : 'S'}):
                      </td>
                      <td style="text-align: right; padding: 8px 8px; color: #0f172a; font-size: 0.85rem;">${formatCLP(sumGross)}</td>
                      <td style="text-align: right; padding: 8px 8px; color: #dc2626; font-size: 0.84rem;">
                        -${formatCLP(sumCommTotal)}
                        <div style="font-size: 0.63rem; font-weight: 600; color: #64748b;">Neto ${formatCLP(sumCommNet)} + IVA ${formatCLP(sumCommIva)}</div>
                      </td>
                      <td style="text-align: right; padding: 8px 10px; color: #047857; font-size: 0.96rem; font-weight: 900; background: #d1fae5;">
                        ${formatCLP(sumAbono)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            `}
          </div>
        `;
      })() : ''}

      <!-- Cuadro de Pago e Información Bancaria Oficial STOCKA -->
      <div style="margin-top: 1.75rem; background: #f8fafc; border-radius: 10px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <!-- Cabecera del Cuadro de Pago -->
        <div style="background: #ffffff; padding: 0.75rem 1.25rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <div style="width: 28px; height: 28px; border-radius: 6px; background: rgba(95, 6, 250, 0.08); display: flex; align-items: center; justify-content: center; color: #5f06fa; font-size: 1rem;">
              <i class="ri-bank-card-line"></i>
            </div>
            <strong style="color: #0f172a; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.4px;">
              Datos para Transferencia Bancaria
            </strong>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <button type="button" class="no-print" onclick="window.copyDesgloseBankDetails(this)" title="Copiar datos para transferencia" style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; padding: 0.3rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="ri-file-copy-line" style="color: #5f06fa;"></i> <span>Copiar Datos</span>
            </button>
            <span style="background: rgba(95, 6, 250, 0.06); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.2); padding: 0.3rem 0.65rem; border-radius: 6px; font-size: 0.725rem; font-weight: 700;">
              Documento Oficial • STOCKA WMS
            </span>
          </div>
        </div>

        <!-- Grilla de Datos de Transferencia -->
        <div style="padding: 1rem 1.25rem; display: flex; flex-direction: row; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
          <div style="flex: 1 1 0; min-width: 180px;">
            <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.4px; margin-bottom: 2px;">Razón Social:</div>
            <div style="font-size: 0.875rem; font-weight: 800; color: #0f172a;">${STOCKA_BRAND.razonSocial}</div>
            
            <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.4px; margin-top: 0.65rem; margin-bottom: 2px;">RUT:</div>
            <div style="font-size: 0.875rem; font-weight: 800; color: #0f172a;">${STOCKA_BRAND.rut}</div>
          </div>

          <div style="flex: 1 1 0; min-width: 180px;">
            <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.4px; margin-bottom: 2px;">Banco:</div>
            <div style="font-size: 0.875rem; font-weight: 800; color: #0f172a;">${STOCKA_BRAND.banco}</div>

            <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.4px; margin-top: 0.65rem; margin-bottom: 2px;">Tipo de Cuenta:</div>
            <div style="font-size: 0.875rem; font-weight: 800; color: #0f172a;">${STOCKA_BRAND.tipoCuenta}</div>
          </div>

          <div style="flex: 1 1 0; min-width: 180px;">
            <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.4px; margin-bottom: 2px;">N° de Cuenta:</div>
            <div style="font-size: 1rem; font-weight: 900; color: #5f06fa; font-family: monospace, monospace; letter-spacing: 0.5px;">${STOCKA_BRAND.numeroCuenta}</div>

            <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.4px; margin-top: 0.65rem; margin-bottom: 2px;">Email de Envío:</div>
            <div style="font-size: 0.875rem; font-weight: 800; color: #0f172a;">
              <a href="mailto:${STOCKA_BRAND.emailEnvio}" style="color: #5f06fa; text-decoration: underline; font-weight: 800;">${STOCKA_BRAND.emailEnvio}</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --- EXPORTACIÓN EXCEL (.xlsx) CON SHEETJS ---
export function exportBillingToExcel(customState = null) {
  if (typeof XLSX === 'undefined') {
    Swal.fire('Error', 'Librería XLSX no disponible para la exportación.', 'error');
    return;
  }

  const b = customState || billingState;
  const t = b.totals || {};
  const c = b.commerceInfo || {};

  const wb = XLSX.utils.book_new();

  const emisionParts = (b.invoiceDates?.emisionDate || '').split('-');
  const emisionStr = emisionParts.length === 3 ? `${emisionParts[2]}/${emisionParts[1]}/${emisionParts[0]}` : '';
  const dueParts = (b.invoiceDates?.dueDate || '').split('-');
  const vencimientoStr = dueParts.length === 3 ? `${dueParts[2]}/${dueParts[1]}/${dueParts[0]}` : '';

  // Pestaña 1: Resumen Desglose de Facturación
  const summaryData = [
    ["STOCKA SPA", "", "Razón Social:", c.razonSocial || c.comercio || b.currentCommerce || b.comercio || 'COMERCIO'],
    ["RUT: 77.524.557-3", "", "RUT Cliente:", c.rut || '—'],
    ["ALMACENAMIENTO Y FULFILLMENT", "", "Cód. Comercio:", c.sigla || '—'],
    ["Campo de Deportes 405, Ñuñoa", "", "Periodo:", b.currentPeriodName || b.periodName || 'PERIODO'],
    ["www.stocka.cl", "", "Fecha Emisión:", emisionStr],
    ["", "", "Fecha Límite Pago:", `${vencimientoStr} (${b.invoiceDates?.termLabel || ''})`],
    ["", "", "UF Referencia:", b.ufValue],
    ...(b.version ? [["", "", "Versión Oficial:", `v${b.version} (${b.publishedAt ? new Date(b.publishedAt).toLocaleString('es-CL') : 'Publicada'})`]] : []),
    ...(b.isConglomerate ? [
      ["", "", "Tipo Facturación:", "Holding / Conglomerado Consolidado"],
      ["", "", "Tiendas Agrupadas:", (b.conglomerateChildren || []).join(', ')]
    ] : []),
    [],
    ["DESGLOSE MENSUAL DE SERVICIOS DE FULFILLMENT"],
    ["ITEM", "UNIDAD", "CANTIDAD", "NETO ($)", "IVA ($)", "TOTAL ($)"],
    [
      `Servicio de almacenamiento (${formatDec(b.volumeM3, 2)} m³ @ ${formatCLP(t.storageRate || b.activeRange?.storage_m3 || 48900)}/m³${t.storageDiscountPct > 0 ? ` - ${t.storageDiscountLabel || `${t.storageDiscountPct}% dcto`}` : ''})`,
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

  // Cobro de Etiqueta FULL de MELI si aplica
  let meliUnits = t.meliFullUnitsCount;
  let meliNet = t.meliFullNet;
  let meliOrders = t.meliFullOrdersCount;
  if (meliNet === undefined || meliNet === null) {
    const fullMeliOrders = (b.orders || []).filter(o => !o.isExcluded && isFullMeliOrder(o));
    meliOrders = fullMeliOrders.length;
    meliUnits = fullMeliOrders.reduce((sum, o) => sum + (Math.max(1, parseInt(o.unitsCount, 10) || 1)), 0);
    meliNet = meliUnits * 100;
  }
  if (meliNet > 0 || meliUnits > 0) {
    summaryData.push([
      `Cobro de etiqueta FULL de MELI (${meliUnits} unidades en ${meliOrders} pedidos con agenda FULL MERCADOLIBRE)`,
      "ud.",
      meliUnits,
      meliNet,
      Math.round(meliNet * 0.19),
      Math.round(meliNet * 1.19)
    ]);
  }

  // Agregar insumos
  (b.supplies || []).forEach(s => {
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

  // Costo Variable
  summaryData.push([
    `Costo Variable Mensual Fulfillment (${t.fixedFeeReason})`,
    "UF",
    t.fixedFeeUF,
    t.fixedFeeNet,
    Math.round(t.fixedFeeNet * 0.19),
    Math.round(t.fixedFeeNet * 1.19)
  ]);

  // Servicio Punto de Venta (POS) si aplica
  if (t.posFeeNet > 0 || t.posActive) {
    summaryData.push([
      `Servicio Punto de Venta (POS) - ${t.posIsStocka ? 'Equipo STOCKA' : 'Equipo Propio'} (${t.posFeeDetails || ''})`,
      "UF",
      t.posFeeUF || 0.2,
      t.posFeeNet,
      Math.round(t.posFeeNet * 0.19),
      Math.round(t.posFeeNet * 1.19)
    ]);
  }

  // Ajustes
  (b.adjustments || []).forEach(a => {
    summaryData.push([
      `Ajuste: ${a.concept || 'Ajuste comercial'} (${a.notes || ''})`,
      "gl.",
      1,
      a.amount,
      Math.round((a.amount || 0) * 0.19),
      Math.round((a.amount || 0) * 1.19)
    ]);
  });

  const abonosList = b.abonos || [];
  const totalAbonos = t.totalAbonos !== undefined ? t.totalAbonos : abonosList.reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0);
  const totalToPay = t.totalToPay !== undefined ? t.totalToPay : Math.max(0, t.totalGross - totalAbonos);

  summaryData.push([]);
  if (totalAbonos > 0) {
    summaryData.push(["MONTO TOTAL A FACTURAR (CON IVA)", "", "", t.totalNet, t.iva, t.totalGross]);
    summaryData.push([]);
    summaryData.push(["ABONOS / PAGOS REGISTRADOS", "", "", "", "", ""]);
    abonosList.forEach(ab => {
      const docPart = ab.voucher ? `Comprobante ${ab.voucher}` : (ab.reference || 'Abono');
      const datePart = ab.date ? `(${ab.date})` : '';
      const notesPart = ab.notes ? `[${ab.notes}]` : '';
      summaryData.push([`Abono: ${docPart} ${datePart} ${notesPart}`.trim(), "gl.", 1, "", "", -Math.abs(Math.round(Number(ab.amount)) || 0)]);
    });
    summaryData.push(["(-) TOTAL ABONOS REGISTRADOS", "", "", "", "", -totalAbonos]);
    summaryData.push(["MONTO FINAL A PAGAR POR EL CLIENTE (SALDO)", "", "", "", "", totalToPay]);
  } else {
    summaryData.push(["TOTALES DEL PERIODO (A FACTURAR / A PAGAR)", "", "", t.totalNet, t.iva, t.totalGross]);
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Desglose Oficial");

  // Pestaña adicional para Conglomerados: Resumen Consolidado por Tienda
  const sBreakdown = (b.storeBreakdown && b.storeBreakdown.length > 0)
    ? b.storeBreakdown
    : (b.isConglomerate ? computeConglomerateStoreBreakdown(b.orders, b) : []);

  if (b.isConglomerate && sBreakdown.length > 0) {
    const storeBreakdownData = [
      ["RESUMEN CONSOLIDADO POR TIENDA - CONGLOMERADO", b.currentCommerce || b.comercio, "PERIODO:", b.currentPeriodName || b.periodName],
      ["Tiendas Consolidadas:", (b.conglomerateChildren || []).join(', ')],
      [],
      ["TIENDA / COMERCIO", "TOTAL PEDIDOS", "PEDIDOS FACTURABLES", "ENVÍOS RM", "ENVÍOS REGIÓN", "TICKET VENTA TOTAL ($)", "PICK & PACK NETO ($)", "FLETE RM NETO ($)", "TOTAL NETO OPERACIONAL ($)", "% PARTICIPACIÓN"]
    ];
    sBreakdown.forEach(st => {
      storeBreakdownData.push([
        st.storeName,
        st.totalOrders,
        st.billableOrders,
        st.shippingRmCount,
        st.shippingEnviameCount,
        st.totalSalesTicket,
        st.pickPackNet,
        st.shippingFreightNet,
        st.storeTotalNet,
        `${st.sharePct}%`
      ]);
    });
    const wsStoreBreakdown = XLSX.utils.aoa_to_sheet(storeBreakdownData);
    XLSX.utils.book_append_sheet(wb, wsStoreBreakdown, "Resumen por Tienda");
  }

  // Pestaña 2: Detalle de Todos los Pedidos (Formato tipo Excel Auditoría)
  const deliveryTypesMap = getDeliveryTypes(b.pricingConfig).reduce((acc, dt) => {
    acc[dt.key] = dt.name;
    return acc;
  }, {});

  const customColsList = Array.isArray(b.customColumns) ? b.customColumns : [];
  const customColHeaders = customColsList.map(col => `${(col.name || 'RECARGO').toUpperCase()} (${col.mode === 'per_unit' ? '$/UNID' : 'GLOBAL'} $)`);

  const ordersHeaders = [
    "N°", "REF. ORIGEN", "PLATAFORMA", "CATEGORÍA PEDIDO", "TIENDA / COMERCIO", "ID PEDIDO", "FECHA", "AGENDA", "DESTINO / COMUNA", "OPERADOR", "MÉTODO ENVÍO",
    "TICKET VENTA ($)", "TIPO ENTREGA", "SKUS", "UNIDADES", "MKT?",
    "TARIFA BASE ($)", "REC. SKU ($)", "REC. UNID ($)", "REC. MKT ($)",
    ...customColHeaders,
    "PREPARACIÓN TOTAL ($)", "FLETE ENVÍO ($)", "TOTAL COBRADO ($)", "ESTADO WMS", "INCLUIDO?"
  ];

  const ordersRows = (b.orders || []).map((o, idx) => [
    idx + 1,
    o.orderNumber || o.externalOrderNumber || o.id,
    o.platform || o.externalPlatform || 'Manual',
    resolveOrderBillingCategoria(o),
    o.comercio || b.currentCommerce || '—',
    o.id,
    o.date,
    o.agenda || 'Sin agenda',
    o.destination,
    o.operador || 'S/Op',
    o.shippingMethod || '—',
    o.ticketVenta || 0,
    deliveryTypesMap[o.deliveryType] || o.deliveryType || '—',
    o.skuCount,
    o.unitsCount,
    o.isMarketplace ? 'SI' : 'NO',
    o.baseRate,
    o.surchargeSku,
    o.surchargeUnits,
    o.surchargeMarketplace,
    ...customColsList.map(col => Math.max(0, Number(o.customSurcharges?.[col.id]) || 0)),
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
      ["TOP PRODUCTOS MÁS VENDIDOS - PERIODO", b.currentPeriodName || b.periodName, "COMERCIO:", b.currentCommerce || b.comercio],
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
      ["DECLARACIONES DE INGRESO DE STOCK", b.currentPeriodName || b.periodName, "COMERCIO:", b.currentCommerce || b.comercio],
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

  // Pestaña 5: Detalle de Ventas POS Consideradas como Abono en el Periodo
  if (Array.isArray(b.posAbonoSales) && b.posAbonoSales.length > 0) {
    const posSalesList = b.posAbonoSales;
    const sumGross = posSalesList.reduce((acc, s) => acc + (Number(s.monto_total) || 0), 0);
    const sumCommNet = posSalesList.reduce((acc, s) => acc + (Number(s.commission_net) || 0), 0);
    const sumCommIva = posSalesList.reduce((acc, s) => acc + (Number(s.commission_iva) || 0), 0);
    const sumCommTotal = posSalesList.reduce((acc, s) => acc + (Number(s.commission_total) || 0), 0);
    const sumAbono = posSalesList.reduce((acc, s) => acc + (Number(s.seller_payout) || 0), 0);

    const posAbonoData = [
      ["DETALLE DE VENTAS PUNTO DE VENTA (POS) CONSIDERADAS COMO ABONO EN EL PERIODO"],
      ["COMERCIO / HOLDING:", b.currentCommerce || b.comercio, "PERIODO DE FACTURACIÓN:", b.currentPeriodName || b.periodName],
      ["CANTIDAD VENTAS:", posSalesList.length, "VENTA BRUTA TOTAL ($):", sumGross, "COMISIÓN POS + IVA ($):", sumCommTotal, "MONTO NETO ABONADO AL SERVICIO ($):", sumAbono],
      [],
      ["N°", "FECHA VENTA", "CÓDIGO VENTA", "CÓD. TRANSACCIÓN", "COMERCIO / TIENDA", "CLIENTE", "PRODUCTOS", "MEDIO DE PAGO", "DOCUMENTO", "MÁQUINA POS", "TERMINAL #", "PROPIEDAD MÁQUINA", "MONTO BRUTO ($)", "% COMISIÓN POS", "COMISIÓN NETA ($)", "IVA COMISIÓN ($)", "COMISIÓN TOTAL + IVA ($)", "MONTO ABONO AL SERVICIO ($)", "PERIODO ABONO"]
    ];

    posSalesList.forEach((s, idx) => {
      const d = s.created_at ? new Date(s.created_at) : null;
      const dateStr = (d && !isNaN(d.getTime()))
        ? d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        : '-';
      posAbonoData.push([
        idx + 1,
        dateStr,
        s.codigo_venta || '-',
        s.tx_code || '',
        s.comercio || b.currentCommerce || '-',
        s.nombre_cliente || 'Consumidor Final',
        s.productos_summary || '',
        s.modo_pago || '-',
        s.documento_tipo || 'BOLETA',
        s.machine_brand || 'Transbank',
        s.machine_model ? `#${s.machine_model}` : '',
        `Propiedad de ${s.machine_owner || 'STOCKA'}`,
        s.monto_total || 0,
        `${Number(s.fee_pct || 0).toFixed(2)}%`,
        s.commission_net || 0,
        s.commission_iva || 0,
        s.commission_total || 0,
        s.seller_payout || 0,
        s.abono_period || (b.currentPeriodName || '')
      ]);
    });

    posAbonoData.push([]);
    posAbonoData.push([
      "", "", "", "", "", "", "", "", "", "", "", "TOTALES PERIODO:",
      sumGross, "", sumCommNet, sumCommIva, sumCommTotal, sumAbono, b.currentPeriodName || ''
    ]);

    const wsPosAbono = XLSX.utils.aoa_to_sheet(posAbonoData);
    XLSX.utils.book_append_sheet(wb, wsPosAbono, "Abono Ventas POS");
  }

  const fileName = `Facturacion_Stocka_${c.sigla || b.currentCommerce || b.comercio || 'COMERCIO'}_${(b.currentPeriodName || b.periodName || 'PERIODO').replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// --- DESCARGA A PDF (HTML2PDF) ---
export function downloadBillingPdf(customElement = null, customFilename = null) {
  const element = customElement || document.getElementById('stocka-printable-invoice');
  if (!element) {
    Swal.fire('Error', 'No se encontró el desglose para exportar.', 'error');
    return;
  }

  // Ocultar temporalmente los elementos interactivos que no deben figurar en el PDF oficial
  const noPrintEls = element.querySelectorAll('.no-print');
  noPrintEls.forEach(el => {
    el.setAttribute('data-prev-display', el.style.display || '');
    el.style.setProperty('display', 'none', 'important');
  });

  const restoreNoPrint = () => {
    noPrintEls.forEach(el => {
      const prev = el.getAttribute('data-prev-display');
      if (prev) el.style.display = prev;
      else el.style.removeProperty('display');
    });
  };

  if (typeof html2pdf === 'undefined') {
    window.print();
    restoreNoPrint();
    return;
  }

  const filename = customFilename || `Desglose_Stocka_${billingState.commerceInfo?.sigla || billingState.currentCommerce || 'COMERCIO'}_${(billingState.currentPeriodName || 'PERIODO').replace(/\s+/g, '_')}.pdf`;

  const opt = {
    margin: [8, 8, 8, 8],
    filename: filename,
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
    restoreNoPrint();
    Swal.close();
  }).catch(err => {
    restoreNoPrint();
    console.error('Error generando PDF:', err);
    Swal.fire('Error', 'No se pudo generar el PDF: ' + err.message, 'error');
  });
}

// --- VERIFICAR Y RESTAURAR SESIÓN DE ADMINISTRADOR ANTES DE ESCRIBIR EN BILLING_RECORDS ---
async function ensureAdminBillingSession() {
  try {
    let { data: { session } } = await supabase.auth.getSession();
    let currentRole = null;
    let currentEmail = session?.user?.email || '';

    if (session?.user?.id) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();
      currentRole = prof?.role || null;
    }

    if (currentRole === 'admin') {
      try {
        const serialized = JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user: session.user
        });
        sessionStorage.setItem('sb-wms-admin-session-backup', serialized);
        localStorage.setItem('sb-wms-admin-session-backup', serialized);
      } catch (e) {}
      return true;
    }

    // 1. Intentar restaurar silenciosamente el respaldo de sesión de Administrador
    try {
      const backupRaw = sessionStorage.getItem('sb-wms-admin-session-backup') || localStorage.getItem('sb-wms-admin-session-backup');
      if (backupRaw) {
        const backupSess = JSON.parse(backupRaw);
        if (backupSess?.access_token && backupSess?.refresh_token) {
          const { data: restored, error: restErr } = await supabase.auth.setSession({
            access_token: backupSess.access_token,
            refresh_token: backupSess.refresh_token
          });
          if (!restErr && restored?.session?.user?.id) {
            const { data: adminProf } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', restored.session.user.id)
              .maybeSingle();
            if (adminProf?.role === 'admin') {
              return true;
            }
          }
        }
      }
    } catch (eRestore) {
      console.warn('No se pudo restaurar respaldo de sesión Admin automáticamente:', eRestore);
    }

    // 2. Si no hay respaldo o expiró, solicitar re-autenticación en el mismo modal sin perder los datos en pantalla
    const defaultAdminEmail = window.currentAdminUser?.email || 'stockachile@gmail.com';
    const switchedAccountNotice = currentEmail
      ? `La sesión activa del navegador cambió en otra pestaña a <strong>${escapeHtml(currentEmail)}</strong> (rol <code>${escapeHtml(currentRole || 'cliente')}</code>).`
      : `La sesión de Administrador en el navegador expiró o fue cerrada en otra pestaña.`;

    const authResult = await Swal.fire({
      icon: 'warning',
      title: 'Restaurar Sesión de Administrador',
      html: `
        <div style="text-align: left; font-size: 0.85rem; line-height: 1.45; color: #334155;">
          <p style="margin-bottom: 0.65rem;">${switchedAccountNotice}</p>
          <p style="margin-bottom: 0.85rem; color: #64748b;">Ingresa tus credenciales de Administrador para restaurar los permisos y publicar/guardar sin perder los cambios ni columnas personalizadas en pantalla:</p>
          <div style="margin-bottom: 0.6rem;">
            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.25rem;">Correo Administrador</label>
            <input id="swal-admin-reauth-email" type="email" class="swal2-input" value="${escapeHtml(defaultAdminEmail)}" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.25rem;">Contraseña</label>
            <input id="swal-admin-reauth-pass" type="password" class="swal2-input" placeholder="Contraseña de administrador" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-shield-keyhole-line"></i> Restaurar y Continuar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#5f06fa',
      focusConfirm: false,
      preConfirm: async () => {
        const email = (document.getElementById('swal-admin-reauth-email')?.value || '').trim();
        const password = document.getElementById('swal-admin-reauth-pass')?.value || '';
        if (!email || !password) {
          Swal.showValidationMessage('Ingresa tu correo y contraseña de Administrador');
          return false;
        }
        const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (loginErr || !loginData?.session) {
          Swal.showValidationMessage('Credenciales inválidas: ' + (loginErr?.message || 'Error de autenticación'));
          return false;
        }
        const { data: checkProf } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', loginData.session.user.id)
          .maybeSingle();
        if (checkProf?.role !== 'admin') {
          Swal.showValidationMessage('La cuenta ingresada no tiene permisos de Administrador.');
          return false;
        }
        try {
          const serialized = JSON.stringify({
            access_token: loginData.session.access_token,
            refresh_token: loginData.session.refresh_token,
            user: loginData.session.user
          });
          sessionStorage.setItem('sb-wms-admin-session-backup', serialized);
          localStorage.setItem('sb-wms-admin-session-backup', serialized);
        } catch (e) {}
        return true;
      }
    });

    return Boolean(authResult.isConfirmed && authResult.value);
  } catch (err) {
    console.warn('Error verificando sesión de administrador:', err);
    return true;
  }
}

// --- GUARDAR Y SINCRONIZAR EN BILLING_RECORDS ---
export async function saveBillingRecordToSupabase() {
  const b = billingState;
  const t = b.totals;

  if (!b.currentPeriodId || !b.currentCommerce) {
    Swal.fire('Atención', 'No hay un periodo o comercio activo seleccionado.', 'warning');
    return false;
  }

  if (guardBillingLocked('guardar cambios')) return false;

  const hasAdminAuth = await ensureAdminBillingSession();
  if (!hasAdminAuth) return false;

  try {
    Swal.fire({
      title: 'Guardando Facturación...',
      text: 'Actualizando registros y congelando desglose...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const payload = {
      total_fulfillment: Math.round(Number(t.totalGross) || 0),
      abono_fulfillment: Math.round(Number(t.totalAbonos) || 0),
      desglose_fulfillment: 'Creado',
      updated_at: new Date().toISOString()
    };
    if (b.invoiceDates?.dueDate) {
      payload.fecha_limite = b.invoiceDates.dueDate;
    }

    const currentVer = billingState.snapshotVersion || 1;
    billingState.snapshotVersion = currentVer;

    const fullSnapshot = {
      periodId: b.currentPeriodId,
      periodName: b.currentPeriodName,
      comercio: b.currentCommerce,
      version: currentVer,
      versionLabel: `v${currentVer}${b.isPublished ? '' : ' (Borrador)'}`,
      isConglomerate: Boolean(b.isConglomerate),
      conglomerateName: b.conglomerateName || null,
      conglomerateChildren: b.conglomerateChildren || [],
      storeBreakdown: (b.storeBreakdown && b.storeBreakdown.length > 0)
        ? b.storeBreakdown
        : (b.isConglomerate ? computeConglomerateStoreBreakdown(b.orders, b) : []),
      commerceInfo: b.commerceInfo,
      invoiceDates: b.invoiceDates,
      currentPeriodYear: b.currentPeriodYear,
      currentPeriodMonth: b.currentPeriodMonth,
      isManualVolume: Boolean(b.isManualVolume),
      autoVolumeM3: b.autoVolumeM3,
      volumeM3: b.volumeM3,
      volumeDailyAverage: b.volumeDailyAverage,
      volumeDaysLogged: b.volumeDaysLogged,
      dailyStorageLogs: b.dailyStorageLogs,
      volumeStats: b.volumeStats,
      storageByStore: b.storageByStore || {},
      productsStats: b.productsStats,
      inboundDeclarations: b.inboundDeclarations,
      ufValue: b.ufValue,
      ufDate: b.ufDate,
      activeRange: b.activeRange,
      totals: b.totals,
      orders: b.orders,
      customColumns: b.customColumns || [],
      supplies: b.supplies,
      adjustments: b.adjustments,
      abonos: b.abonos || [],
      posAbonoSales: b.posAbonoSales || [],
      posAbonoSummary: b.posAbonoSummary || null,
      allMerchantPosSales: b.allMerchantPosSales || [],
      pricingConfig: b.pricingConfig,
      checklist: (typeof getChecklistDataForSnapshot === 'function') ? getChecklistDataForSnapshot() : null,
      generatedAt: new Date().toISOString()
    };

    // 1. Guardar en localStorage inmediatamente para persistencia rápida
    const storageKey = `stocka_fulfillment_details_${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(fullSnapshot));
    } catch (e) {}

    // 2. Subir Snapshot JSON a Supabase Storage para persistencia definitiva en la nube
    let publicSnapshotUrl = null;
    try {
      publicSnapshotUrl = await uploadBillingSnapshotToStorage(fullSnapshot);
    } catch (storageErr) {
      console.warn('Error subiendo snapshot a Supabase Storage en guardado:', storageErr);
    }

    if (publicSnapshotUrl) {
      payload.fulfillment_link = publicSnapshotUrl;
    }

    // 3. Buscar registro existente por ID o por comercio/alias
    const lookupCommerces = [b.currentCommerce];
    const upperComm = (b.currentCommerce || '').trim().toUpperCase();
    if (upperComm === 'BIG BANG' || upperComm === 'BIG BANG SPA' || upperComm.includes('BIG BANG')) {
      lookupCommerces.push('BIG BANG', 'BIG BANG SPA');
    } else if (upperComm === 'SILVER FOX' || upperComm === 'SILVER FOX SPA' || upperComm.includes('SILVER FOX')) {
      lookupCommerces.push('SILVER FOX', 'SILVER FOX SPA');
    }

    const { data: existingRecs } = await supabase
      .from('billing_records')
      .select('id')
      .eq('period_id', b.currentPeriodId)
      .in('comercio', lookupCommerces)
      .limit(1);

    const existingId = existingRecs && existingRecs[0] ? existingRecs[0].id : null;

    if (existingId) {
      const { error: updateErr } = await supabase
        .from('billing_records')
        .update(payload)
        .eq('id', existingId);

      if (updateErr) throw updateErr;
    } else {
      const { data: updatedRows, error: baseErr } = await supabase
        .from('billing_records')
        .update(payload)
        .eq('period_id', b.currentPeriodId)
        .eq('comercio', b.currentCommerce)
        .select('id');

      if (baseErr) throw baseErr;

      if (!updatedRows || updatedRows.length === 0) {
        const { error: insertErr } = await supabase
          .from('billing_records')
          .insert({
            period_id: b.currentPeriodId,
            comercio: b.currentCommerce,
            pago_fulfillment: (t.totalToPay || 0) > 0 ? 'Por solicitar' : 'Sin movimientos',
            factura_fulfillment: 'Esperando',
            ...payload
          });
        if (insertErr) throw insertErr;
      }
    }

    billingState.isSaved = true;
    billingState.savedRecordStatus = 'Creado';
    renderKPIsUI();
    Swal.fire('¡Facturación Guardada!', `Se actualizó el monto facturado a ${formatCLP(t.totalGross || 0)}${(t.totalAbonos > 0) ? ` (Abonos: -${formatCLP(t.totalAbonos)} | Saldo a pagar: ${formatCLP(t.totalToPay)})` : ''} y el estado a "Creado" para ${b.currentCommerce}.`, 'success');

    if (typeof window.loadBillingPeriods === 'function') {
      window.loadBillingPeriods();
    }
    if (typeof loadAndRenderPeriodOverview === 'function') {
      loadAndRenderPeriodOverview({ silentBadgeOnly: true }).catch(() => {});
    }

    return true;
  } catch (err) {
    console.error('Error guardando registro de facturación:', err);
    Swal.fire('Error', 'No se pudo guardar: ' + err.message, 'error');
    return false;
  }
}

// --- SUBIR SNAPSHOT DE FACTURACIÓN A SUPABASE STORAGE ---
export async function uploadBillingSnapshotToStorage(fullSnapshot) {
  const cleanCommerce = (fullSnapshot.comercio || 'comercio').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const periodId = fullSnapshot.periodId;
  const versionNum = fullSnapshot.version || 1;
  const timestamp = Date.now();

  const versionedFilePath = `billing_snapshots/${periodId}/${cleanCommerce}_snapshot_v${versionNum}_${timestamp}.json`;
  const canonicalFilePath = `billing_snapshots/${periodId}/${cleanCommerce}_snapshot.json`;
  const jsonString = JSON.stringify(fullSnapshot);
  const blob = new Blob([jsonString], { type: 'application/json' });

  // 1. Subir al path versionado inmutable
  let uploadVersionedSuccess = false;
  try {
    const { data: vData, error: vError } = await supabase.storage
      .from('service_docs')
      .upload(versionedFilePath, blob, {
        contentType: 'application/json',
        cacheControl: '3600',
        upsert: true
      });
    if (!vError && vData) {
      uploadVersionedSuccess = true;
    } else if (vError) {
      console.warn('Aviso subiendo snapshot versionado:', vError);
    }
  } catch (eVer) {
    console.warn('Excepción al subir snapshot versionado:', eVer);
  }

  // 2. Subir también al path canónico con cacheControl 0
  const { data: cData, error: cError } = await supabase.storage
    .from('service_docs')
    .upload(canonicalFilePath, blob, {
      contentType: 'application/json',
      cacheControl: '0',
      upsert: true
    });

  if (cError && !uploadVersionedSuccess) throw cError;

  const targetPath = uploadVersionedSuccess ? versionedFilePath : canonicalFilePath;
  const { data: publicData } = supabase.storage
    .from('service_docs')
    .getPublicUrl(targetPath);

  const finalUrl = uploadVersionedSuccess 
    ? publicData.publicUrl 
    : `${publicData.publicUrl}?v=${versionNum}&t=${timestamp}`;

  return finalUrl;
}

// --- CONFIRMAR Y PUBLICAR COBRO AL COMERCIO (INTERACTIVO) ---
export async function confirmAndPublishBillingToCommerce() {
  const b = billingState;
  const t = b.totals || {};

  if (!b.currentPeriodId || !b.currentCommerce) {
    Swal.fire('Atención', 'No hay un periodo o comercio activo seleccionado para publicar.', 'warning');
    return false;
  }

  if (guardBillingLocked('volver a publicar un periodo cerrado')) return false;

  const hasAdminAuth = await ensureAdminBillingSession();
  if (!hasAdminAuth) return false;

  // Cuadro de confirmación explícita
  const result = await Swal.fire({
    title: '<div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;"><i class="ri-send-plane-fill" style="color: #5f06fa;"></i><span>¿Confirmar y Publicar Cobro?</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.88rem; line-height: 1.5; color: #334155;">
        <p style="margin-bottom: 0.75rem;">Estás a punto de confirmar y publicar oficialmente la liquidación del periodo para el comercio:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.75rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span style="color: #64748b; font-weight: 600;">Comercio:</span>
            <strong style="color: #0f172a;">${escapeHtml(b.currentCommerce)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span style="color: #64748b; font-weight: 600;">Periodo:</span>
            <strong style="color: #0f172a;">${escapeHtml(b.currentPeriodName)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span style="color: #64748b; font-weight: 600;">Pedidos Facturables:</span>
            <strong style="color: #0284c7;">${t.billableOrdersCount || 0} pedidos</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 0.35rem; margin-top: 0.35rem;">
            <span style="color: #0f172a; font-weight: 700;">Monto a Facturar (con IVA):</span>
            <strong style="color: #5f06fa; font-size: 1.08rem; font-weight: 800;">${formatCLP(t.totalGross || 0)}</strong>
          </div>
          ${(t.totalAbonos > 0) ? `
          <div style="display: flex; justify-content: space-between; margin-top: 0.25rem;">
            <span style="color: #166534; font-weight: 600;">(-) Abonos Registrados:</span>
            <strong style="color: #166534; font-size: 0.95rem;">-${formatCLP(t.totalAbonos)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e1; padding-top: 0.4rem; margin-top: 0.4rem; background: #eef2ff; margin-left: -1rem; margin-right: -1rem; padding-left: 1rem; padding-right: 1rem; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;">
            <span style="color: #1e1b4b; font-weight: 800;">Monto a Pagar (Saldo Cliente):</span>
            <strong style="color: #4338ca; font-size: 1.15rem; font-weight: 900;">${formatCLP(t.totalToPay || 0)}</strong>
          </div>
          ` : ''}
        </div>
        <div style="background: rgba(95, 6, 250, 0.06); border: 1px solid rgba(95, 6, 250, 0.2); border-radius: 6px; padding: 0.55rem 0.75rem; font-size: 0.78rem; color: #5f06fa; line-height: 1.4;">
          <i class="ri-information-line"></i> <strong>Efecto en el Portal del Cliente:</strong><br>
          El comercio podrá ver interactivamente el <strong>Desglose Oficial</strong>, el <strong>Registro de Pedidos</strong> y el <strong>Panel de Métricas</strong> en la sección donde antes veía adjuntos. No afectará otros periodos ni registros cargados manualmente.
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-send-plane-fill"></i> Sí, Confirmar y Publicar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    cancelButtonColor: '#64748b'
  });

  if (!result.isConfirmed) return false;

  try {
    Swal.fire({
      title: 'Publicando Facturación...',
      text: 'Subiendo snapshot interactivo a la nube y actualizando portal del cliente...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const prevVer = billingState.snapshotVersion || 0;
    const publishedVersion = prevVer + 1;
    billingState.snapshotVersion = publishedVersion;

    const fullSnapshot = {
      periodId: b.currentPeriodId,
      periodName: b.currentPeriodName,
      comercio: b.currentCommerce,
      version: publishedVersion,
      versionLabel: `v${publishedVersion}`,
      isConglomerate: Boolean(b.isConglomerate),
      conglomerateName: b.conglomerateName || null,
      conglomerateChildren: b.conglomerateChildren || [],
      storeBreakdown: (b.storeBreakdown && b.storeBreakdown.length > 0)
        ? b.storeBreakdown
        : (b.isConglomerate ? computeConglomerateStoreBreakdown(b.orders, b) : []),
      commerceInfo: b.commerceInfo,
      invoiceDates: b.invoiceDates,
      currentPeriodYear: b.currentPeriodYear,
      currentPeriodMonth: b.currentPeriodMonth,
      isManualVolume: Boolean(b.isManualVolume),
      autoVolumeM3: b.autoVolumeM3,
      volumeM3: b.volumeM3,
      volumeDailyAverage: b.volumeDailyAverage,
      volumeDaysLogged: b.volumeDaysLogged,
      dailyStorageLogs: b.dailyStorageLogs,
      volumeStats: b.volumeStats,
      storageByStore: b.storageByStore || {},
      productsStats: b.productsStats,
      inboundDeclarations: b.inboundDeclarations,
      ufValue: b.ufValue,
      ufDate: b.ufDate,
      activeRange: b.activeRange,
      totals: b.totals,
      orders: b.orders,
      customColumns: b.customColumns || [],
      supplies: b.supplies,
      adjustments: b.adjustments,
      abonos: b.abonos || [],
      posAbonoSales: b.posAbonoSales || [],
      posAbonoSummary: b.posAbonoSummary || null,
      allMerchantPosSales: b.allMerchantPosSales || [],
      pricingConfig: b.pricingConfig,
      checklist: (typeof getChecklistDataForSnapshot === 'function') ? getChecklistDataForSnapshot() : null,
      generatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString()
    };

    // 1. Subir Snapshot JSON a Supabase Storage (obtiene URL versionada inmutable)
    let publicSnapshotUrl = null;
    try {
      publicSnapshotUrl = await uploadBillingSnapshotToStorage(fullSnapshot);
      fullSnapshot.fulfillment_link = publicSnapshotUrl;
    } catch (storageErr) {
      console.warn('Error subiendo snapshot a Supabase Storage:', storageErr);
    }

    // 2. Guardar en localStorage para acceso local instantáneo
    const storageKey = `stocka_fulfillment_details_${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(fullSnapshot));
    } catch (e) {}

    // 3. Actualizar o insertar registro en base de datos
    const roundedGross = Math.round(Number(t.totalGross) || 0);
    const roundedAbonos = Math.round(Number(t.totalAbonos) || 0);
    const roundedToPay = Math.round(Number(t.totalToPay) || 0);

    const updatePayload = {
      total_fulfillment: roundedGross,
      abono_fulfillment: roundedAbonos,
      desglose_fulfillment: 'Enviado',
      updated_at: new Date().toISOString()
    };

    if (b.invoiceDates?.dueDate) {
      updatePayload.fecha_limite = b.invoiceDates.dueDate;
    }

    if (publicSnapshotUrl) {
      updatePayload.fulfillment_link = publicSnapshotUrl;
    }

    const lookupCommerces = [b.currentCommerce];
    const upperComm = (b.currentCommerce || '').trim().toUpperCase();
    if (upperComm === 'BIG BANG' || upperComm === 'BIG BANG SPA' || upperComm.includes('BIG BANG')) {
      lookupCommerces.push('BIG BANG', 'BIG BANG SPA');
    } else if (upperComm === 'SILVER FOX' || upperComm === 'SILVER FOX SPA' || upperComm.includes('SILVER FOX')) {
      lookupCommerces.push('SILVER FOX', 'SILVER FOX SPA');
    }

    const { data: existingRecs } = await supabase
      .from('billing_records')
      .select('id, pago_fulfillment, factura_fulfillment, fecha_limite')
      .eq('period_id', b.currentPeriodId)
      .in('comercio', lookupCommerces)
      .limit(1);

    const existingRec = existingRecs && existingRecs[0] ? existingRecs[0] : null;

    // Auto-transición de estados operativos: al publicar cobro, pasa a 'En espera' de pago y 'Facturar'
    if (roundedGross > 0) {
      if (!existingRec || !existingRec.pago_fulfillment || existingRec.pago_fulfillment === 'Por solicitar') {
        updatePayload.pago_fulfillment = roundedToPay > 0 ? 'En espera' : 'Recibido';
      }
      if (!existingRec || !existingRec.factura_fulfillment || existingRec.factura_fulfillment === 'Esperando') {
        updatePayload.factura_fulfillment = 'Facturar';
      }
    }

    let finalRecordId = existingRec?.id || null;

    if (existingRec && existingRec.id) {
      const { error: updateErr } = await supabase
        .from('billing_records')
        .update(updatePayload)
        .eq('id', existingRec.id);

      if (updateErr) throw updateErr;
    } else {
      const { data: updatedRows, error: baseErr } = await supabase
        .from('billing_records')
        .update(updatePayload)
        .eq('period_id', b.currentPeriodId)
        .eq('comercio', b.currentCommerce)
        .select('id');

      if (baseErr) throw baseErr;

      if (updatedRows && updatedRows.length > 0) {
        finalRecordId = updatedRows[0].id;
      } else {
        const { data: insertedRows, error: insertErr } = await supabase
          .from('billing_records')
          .insert({
            period_id: b.currentPeriodId,
            comercio: b.currentCommerce,
            pago_fulfillment: roundedToPay > 0 ? 'En espera' : (roundedGross > 0 ? 'Recibido' : 'Sin movimientos'),
            factura_fulfillment: roundedGross > 0 ? 'Facturar' : 'Sin movimientos',
            ...updatePayload
          })
          .select('id');

        if (insertErr) throw insertErr;
        if (insertedRows && insertedRows[0]) {
          finalRecordId = insertedRows[0].id;
        }
      }
    }

    billingState.isSaved = true;
    billingState.isPublished = true;
    billingState.isLocked = true;
    billingState.savedRecordStatus = 'Publicado';
    renderLockStatusBannerAndSyncToolbarUI();
    renderKPIsUI();
    renderOrdersTableUI();
    const desgloseCont = document.getElementById('bg-desglose-view-container');
    if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();

    if (typeof window.loadBillingPeriods === 'function') {
      window.loadBillingPeriods();
    }
    if (typeof loadAndRenderPeriodOverview === 'function') {
      loadAndRenderPeriodOverview({ silentBadgeOnly: true }).catch(() => {});
    }

    const postAction = await Swal.fire({
      icon: 'success',
      title: '¡Cobro Publicado con Éxito!',
      html: `
        <div style="text-align: left; font-size: 0.85rem; line-height: 1.4;">
          <p>La facturación de <strong>${escapeHtml(b.currentCommerce)}</strong> para <strong>${escapeHtml(b.currentPeriodName)}</strong> ha sido confirmada y publicada.</p>
          <p style="color: #5f06fa; font-weight: 700; margin-bottom: 0.25rem;"><i class="ri-file-text-line"></i> Monto a Facturar: ${formatCLP(t.totalGross || 0)} (con IVA)</p>
          ${(t.totalAbonos > 0) ? `
          <p style="color: #166534; font-weight: 700; margin-bottom: 0.25rem;"><i class="ri-checkbox-circle-line"></i> Abonos Registrados: -${formatCLP(t.totalAbonos)}</p>
          <p style="color: #4338ca; font-weight: 800; font-size: 0.95rem; margin-bottom: 0.5rem;"><i class="ri-wallet-3-line"></i> Monto a Pagar por Cliente: ${formatCLP(t.totalToPay || 0)}</p>
          ` : `
          <p style="color: #10b981; font-weight: 700; margin-bottom: 0.5rem;"><i class="ri-checkbox-circle-line"></i> Monto a Cobrar: ${formatCLP(t.totalToPay || 0)} (con IVA)</p>
          `}
          <p style="color: #64748b; font-size: 0.78rem;">El cliente ya tiene acceso interactivo al Desglose Oficial, Registro tipo Excel y Panel de Métricas en su portal.</p>
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 0.5rem 0.75rem; margin-top: 0.75rem; font-size: 0.78rem; color: #334155;">
            ¿Deseas enviar el correo oficial de notificación con el enlace interactivo a los contactos del comercio ahora?
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-mail-send-line"></i> Enviar Correo al Cliente',
      cancelButtonText: 'Cerrar sin Enviar',
      confirmButtonColor: '#5f06fa',
      cancelButtonColor: '#64748b'
    });

    if (postAction.isConfirmed && finalRecordId && typeof window.openSendBillingEmailModal === 'function') {
      window.openSendBillingEmailModal(finalRecordId, b.currentCommerce, b.currentPeriodId);
    }

    return true;
  } catch (err) {
    console.error('Error publicando facturación:', err);
    Swal.fire('Error', 'No se pudo publicar la facturación: ' + err.message, 'error');
    return false;
  }
}

// --- RENDERIZADOR DE ANALÍTICA Y GRÁFICOS (CHART.JS) TOTALMENTE MEJORADO ---
export async function renderBillingAnalyticsCharts(targetContainerId = 'bg-analytics-container', snapshotState = null) {
  const container = document.getElementById(targetContainerId);
  if (!container) return;

  // Asegurar inyección de estilos actualizados
  injectBillingGeneratorStyles();

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

  const b = snapshotState || billingState;
  const t = b.totals || {};
  const allOrders = b.orders || [];

  // Si es conglomerado y el snapshot aún no tenía desglose de volumen por tienda, enriquecerlo desde comercios_volumen_diario
  if (b.isConglomerate && (!b.storageByStore || Object.keys(b.storageByStore).length === 0)) {
    try {
      const group = await resolveCommerceGroup(b.currentCommerce || b.comercio || b.conglomerateName);
      let pYear = b.currentPeriodYear;
      let pMonth = b.currentPeriodMonth;
      if ((!pYear || !pMonth) && Array.isArray(b.dailyStorageLogs) && b.dailyStorageLogs.length > 0) {
        const parts = String(b.dailyStorageLogs[0].date || '').split('-');
        if (parts.length >= 2) {
          pYear = parseInt(parts[0], 10);
          pMonth = parseInt(parts[1], 10);
        }
      }
      pYear = pYear || new Date().getFullYear();
      pMonth = pMonth || (new Date().getMonth() + 1);
      const volData = await getMonthlyStorageVolume(group, pYear, pMonth);
      if (volData && volData.byStore && Object.keys(volData.byStore).length > 0) {
        b.storageByStore = volData.byStore;
        if (!b.isManualVolume && Array.isArray(volData.dailyLogs) && volData.dailyLogs.length > 0) {
          b.dailyStorageLogs = volData.dailyLogs;
        }
      }
    } catch (eVol) {
      console.warn('[BillingGenerator] No se pudo enriquecer volumen por tienda en analítica:', eVol);
    }
  }

  const sBreakdown = (b.storeBreakdown && b.storeBreakdown.length > 0)
    ? b.storeBreakdown
    : (b.isConglomerate ? computeConglomerateStoreBreakdown(allOrders, b) : []);

  const activeStore = (snapshotState ? snapshotState.activeConglomerateStoreFilter : billingState.activeConglomerateStoreFilter) || null;
  const isStoreFiltered = Boolean(b.isConglomerate && activeStore);

  // Resolver métricas y series diarias de almacenamiento por cada tienda del conglomerado
  const childStoresList = (b.conglomerateChildren && b.conglomerateChildren.length > 0)
    ? b.conglomerateChildren
    : sBreakdown.map(s => s.storeName);

  const storeStorageColors = ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#6366f1', '#14b8a6'];

  const resolveStoreStorageData = (storeName, idx = 0) => {
    const stUp = String(storeName || '').trim().toUpperCase();
    const map = b.storageByStore || {};
    let matched = map[stUp];
    if (!matched) {
      const foundKey = Object.keys(map).find(k => k.toUpperCase() === stUp || k.toUpperCase().includes(stUp) || stUp.includes(k.toUpperCase()));
      if (foundKey) matched = map[foundKey];
    }
    if (!matched && Array.isArray(b.dailyStorageLogs) && b.dailyStorageLogs.some(l => l.byStore)) {
      const logs = b.dailyStorageLogs.map(l => {
        const byS = l.byStore || {};
        const k = Object.keys(byS).find(x => x.toUpperCase() === stUp || x.toUpperCase().includes(stUp) || stUp.includes(x.toUpperCase()));
        return { date: l.date, volume: k ? (parseFloat(byS[k]) || 0) : 0 };
      });
      const nonZero = logs.filter(l => l.volume > 0);
      const dCount = nonZero.length || logs.length;
      const sum = logs.reduce((acc, l) => acc + l.volume, 0);
      const avg = dCount > 0 ? sum / dCount : 0;
      const vols = (nonZero.length > 0 ? nonZero : logs).map(l => l.volume);
      matched = {
        storeName,
        averageM3: parseFloat(avg.toFixed(4)),
        daysCount: nonZero.length,
        maxDailyVolume: vols.length > 0 ? parseFloat(Math.max(...vols).toFixed(4)) : 0,
        minDailyVolume: vols.length > 0 ? parseFloat(Math.min(...vols).toFixed(4)) : 0,
        dailyLogs: logs
      };
    }
    const avgM3 = matched ? (parseFloat(matched.averageM3) || 0) : 0;
    const totalHoldingVol = parseFloat(b.volumeM3) || 0;
    const sharePct = totalHoldingVol > 0 ? parseFloat(((avgM3 / totalHoldingVol) * 100).toFixed(1)) : 0;
    return {
      storeName,
      color: storeStorageColors[idx % storeStorageColors.length],
      averageM3: avgM3,
      daysCount: matched ? (matched.daysCount || 0) : 0,
      maxDailyVolume: matched ? (parseFloat(matched.maxDailyVolume) || 0) : 0,
      minDailyVolume: matched ? (parseFloat(matched.minDailyVolume) || 0) : 0,
      dailyLogs: (matched && Array.isArray(matched.dailyLogs)) ? matched.dailyLogs : [],
      sharePct
    };
  };

  const storesStorageBreakdown = b.isConglomerate
    ? childStoresList.map((stName, idx) => resolveStoreStorageData(stName, idx))
    : [];

  const activeStoreStorage = isStoreFiltered
    ? (storesStorageBreakdown.find(s => s.storeName.toUpperCase() === activeStore.toUpperCase()) || resolveStoreStorageData(activeStore, 0))
    : null;

  const displayVolAvg = isStoreFiltered ? (activeStoreStorage?.averageM3 || 0) : (b.volumeM3 || 0);
  const displayVolDays = isStoreFiltered ? (activeStoreStorage?.daysCount || b.volumeDaysLogged || 0) : (b.volumeDaysLogged || 0);
  const displayVolMax = isStoreFiltered
    ? (activeStoreStorage?.maxDailyVolume || 0)
    : ((b.isManualVolume || t.isManualVolume) ? b.volumeM3 : (b.volumeStats?.maxDailyVolume ?? b.volumeM3));
  const displayVolMin = isStoreFiltered
    ? (activeStoreStorage?.minDailyVolume || 0)
    : ((b.isManualVolume || t.isManualVolume) ? b.volumeM3 : (b.volumeStats?.minDailyVolume ?? b.volumeM3));

  // Filtrar pedidos según tienda activa seleccionada o mostrar todos los pedidos del conglomerado
  const orders = isStoreFiltered
    ? allOrders.filter(o => {
        const oCom = String(o.comercio || '').toUpperCase();
        const stUp = activeStore.toUpperCase();
        return oCom === stUp || oCom.includes(stUp) || stUp.includes(oCom);
      })
    : allOrders;

  const billableOrders = orders.filter(o => !o.isExcluded);

  // Datos de la tienda seleccionada
  const storeData = isStoreFiltered
    ? (sBreakdown.find(s => s.storeName.toUpperCase() === activeStore.toUpperCase()) || {
        storeName: activeStore,
        totalOrders: orders.length,
        billableOrders: billableOrders.length,
        pickPackNet: billableOrders.reduce((sum, o) => sum + (o.pickPackTotal || 0), 0),
        shippingFreightNet: billableOrders.reduce((sum, o) => sum + (o.shippingFreight || 0), 0),
        storeTotalNet: billableOrders.reduce((sum, o) => sum + (o.pickPackTotal || 0) + (o.shippingFreight || 0), 0),
        sharePct: 0
      })
    : null;

  // Cálculos analíticos clave
  const totalOrders = orders.length || 0;
  const totalNetOperational = isStoreFiltered
    ? (storeData?.storeTotalNet || 0)
    : (t.totalNet || 0);

  const avgCostPerOrder = totalOrders > 0 ? Math.round(totalNetOperational / totalOrders) : 0;
  const totalSalesAmount = orders.reduce((sum, o) => sum + (o.ticketVenta || 0), 0);
  const avgTicket = totalOrders > 0 ? Math.round(totalSalesAmount / totalOrders) : 0;
  const rmCount = billableOrders.filter(o => o.deliveryType === 'RM_STK' || o.deliveryType === 'FLEX' || o.deliveryType === 'COLINA').length;
  const rmPct = totalOrders > 0 ? (((rmCount) / totalOrders) * 100).toFixed(1) : '0.0';
  const envCount = billableOrders.filter(o => o.deliveryType === 'ENVIAME' || o.deliveryType === 'REGION' || o.deliveryType === 'ENVIAME_REGION').length;
  const envPct = totalOrders > 0 ? (((envCount) / totalOrders) * 100).toFixed(1) : '0.0';
  const mktCount = orders.filter(o => o.isMarketplace).length;
  const mktPct = totalOrders > 0 ? (((mktCount) / totalOrders) * 100).toFixed(1) : '0.0';

  // Métricas de catálogo y productos para este alcance
  const productsStats = isStoreFiltered
    ? computeProductsStatsFromOrders(billableOrders)
    : (b.productsStats || computeProductsStatsFromOrders(billableOrders));

  container.innerHTML = `
    <!-- Banner de Encabezado Analítico -->
    <div class="bg-analytics-hero">
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: #5f06fa; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; box-shadow: 0 4px 12px rgba(95, 6, 250, 0.3); flex-shrink: 0;">
          <i class="${isStoreFiltered ? 'ri-store-2-fill' : 'ri-line-chart-fill'}"></i>
        </div>
        <div>
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span>${isStoreFiltered ? `Analítica por Tienda: 🏪 ${escapeHtml(activeStore)}` : 'Dashboard Analítico del Periodo'}</span>
            ${isStoreFiltered ? `
              <span class="badge" style="background: rgba(95, 6, 250, 0.15); color: #5f06fa; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; font-weight: 800;">
                ${storeData.sharePct}% del Holding
              </span>
            ` : ''}
          </h3>
          <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
            ${isStoreFiltered
              ? `Métricas operacionales específicas de la tienda <strong>${escapeHtml(activeStore)}</strong> dentro del conglomerado <strong>${escapeHtml(b.currentCommerce || b.comercio || '')}</strong> (${escapeHtml(b.currentPeriodName || b.periodName || '')}).`
              : `Métricas de rendimiento operativo consolidado, costos logísticos unitarios y comportamiento de envíos para <strong>${escapeHtml(b.currentCommerce || b.comercio || '')}</strong> (${escapeHtml(b.currentPeriodName || b.periodName || '')}).`}
          </p>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
        <span class="bg-hero-badge purple">
          <i class="ri-wallet-3-line"></i> Costo Promedio Logística: ${formatCLP(avgCostPerOrder)} / pedido
        </span>
        <span class="bg-hero-badge teal" title="Ticket promedio de venta de los pedidos">
          <i class="ri-shopping-cart-2-line"></i> Ticket Promedio Venta: ${formatCLP(avgTicket)}
        </span>
        ${isStoreFiltered ? `
          <button type="button" class="btn btn-sm" onclick="window.setConglomerateStoreView(null)" style="background: var(--color-surface); border: 1.5px solid rgba(95,6,250,0.35); color: #5f06fa; font-weight: 700; border-radius: 8px; padding: 0.4rem 0.85rem; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <i class="ri-building-line"></i> Ver Consolidado Holding
          </button>
        ` : ''}
      </div>
    </div>

    ${b.isConglomerate ? `
      <!-- Selector Rápido de Tienda para Analítica -->
      <div style="background: var(--color-surface); border: 1.5px solid rgba(95, 6, 250, 0.25); border-radius: 10px; padding: 0.65rem 1rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <i class="ri-store-3-line" style="color: #5f06fa; font-size: 1.25rem;"></i>
          <span style="font-size: 0.82rem; font-weight: 800; color: var(--color-text-main);">
            Ver Analítica por Tienda del Holding:
          </span>
        </div>
        <div style="display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap;">
          <button type="button"
                  onclick="window.setConglomerateStoreView(null)"
                  class="btn btn-sm"
                  style="border-radius: 6px; font-size: 0.76rem; font-weight: 700; padding: 0.35rem 0.8rem; border: 1.5px solid ${!activeStore ? '#5f06fa' : 'rgba(95,6,250,0.2)'}; background: ${!activeStore ? '#5f06fa' : 'var(--color-surface)'}; color: ${!activeStore ? '#ffffff' : 'var(--color-text-main)'}; cursor: pointer; transition: all 0.2s;">
            <i class="ri-building-line"></i> 🏢 Consolidado Holding (${allOrders.length})
          </button>
          ${((b.conglomerateChildren && b.conglomerateChildren.length > 0) ? b.conglomerateChildren : sBreakdown.map(s => s.storeName)).map(ch => {
            const chData = sBreakdown.find(s => s.storeName.toUpperCase() === ch.toUpperCase());
            const chCount = chData ? chData.totalOrders : 0;
            const isChActive = activeStore && activeStore.toUpperCase() === ch.toUpperCase();
            return `
              <button type="button"
                      onclick="window.setConglomerateStoreView(${isChActive ? 'null' : `'${escapeHtml(ch)}'`})"
                      class="btn btn-sm"
                      title="${isChActive ? 'Hacer clic para ver Consolidado Holding' : `Filtrar por ${escapeHtml(ch)}`}"
                      style="border-radius: 6px; font-size: 0.76rem; font-weight: 700; padding: 0.35rem 0.8rem; border: 1.5px solid ${isChActive ? '#5f06fa' : 'rgba(95,6,250,0.2)'}; background: ${isChActive ? '#5f06fa' : 'var(--color-surface)'}; color: ${isChActive ? '#ffffff' : 'var(--color-text-main)'}; cursor: pointer; transition: all 0.2s;">
                <i class="ri-store-2-line" style="${isChActive ? 'color: #ffffff;' : 'color: #5f06fa;'}"></i>
                <span>${escapeHtml(ch)}</span>
                <span style="background: ${isChActive ? 'rgba(255,255,255,0.25)' : 'rgba(95,6,250,0.1)'}; color: ${isChActive ? '#ffffff' : '#5f06fa'}; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 800;">
                  ${chCount}
                </span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}

    <!-- 4 KPI Cards Ejecutivas en 1 Sola Línea con Estilo Uniforme y Sobrio -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">COSTO LOGÍSTICO UNITARIO</div>
        <div class="bg-kpi-value">${formatCLP(avgCostPerOrder)}</div>
        <div class="bg-kpi-subtitle">${isStoreFiltered ? `Costo neto por pedido de ${escapeHtml(activeStore)}` : 'Costo neto por pedido'}</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">DESPACHOS RM / FLEX</div>
        <div class="bg-kpi-value">${rmPct}%</div>
        <div class="bg-kpi-subtitle">${rmCount} de ${totalOrders} pedidos locales</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">ENVÍOS A REGIONES</div>
        <div class="bg-kpi-value">${envPct}%</div>
        <div class="bg-kpi-subtitle">${envCount} pedidos vía Envíame</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">PEDIDOS MARKETPLACE</div>
        <div class="bg-kpi-value">${mktPct}%</div>
        <div class="bg-kpi-subtitle">${mktCount} pedidos marketplace</div>
      </div>
    </div>

    <!-- 4 Tarjetas de Almacenamiento Diario en 1 Sola Fila (Sobrio y Uniforme) -->
    <div style="margin-bottom: 0.5rem;">
      <h4 style="margin: 0 0 0.6rem 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
        <span style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span><i class="ri-archive-line text-stocka-purple"></i> Métricas de Almacenamiento Diario ${isStoreFiltered ? `(${escapeHtml(activeStore)})` : ''}</span>
          ${!b.isClientView && (b.isManualVolume || t.isManualVolume) ? `
            <span class="no-print" style="font-size: 0.7rem; background: rgba(95, 6, 250, 0.12); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.3); padding: 2px 8px; border-radius: 6px; font-weight: 800; text-transform: none; display: inline-flex; align-items: center; gap: 4px;" title="El cliente solo ve el valor y el gráfico estándar, sin saber que es manual">
              <i class="ri-edit-2-line"></i> Volumen Manual Fijo (Auto BD: ${formatDec(b.autoVolumeM3 ?? t.autoVolumeM3 ?? 0, 2)} m³)
            </span>
          ` : ''}
        </span>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          ${isStoreFiltered ? `
            <span style="font-size: 0.72rem; background: rgba(95,6,250,0.08); color: #5f06fa; padding: 2px 8px; border-radius: 6px; font-weight: 600; text-transform: none;">
              <i class="ri-information-line"></i> ${activeStoreStorage?.sharePct || 0}% del total holding (${formatDec(b.volumeM3, 2)} m³ consolidados)
            </span>
          ` : ''}
          ${!b.isClientView && !b.isLocked ? `
            <button type="button" class="btn btn-xs btn-outline no-print" onclick="window.openEditStorageFeeModal()" style="font-size: 0.72rem; font-weight: 700; border-color: rgba(95, 6, 250, 0.35); color: #5f06fa; border-radius: 6px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 4px; text-transform: none; cursor: pointer;">
              <i class="ri-pencil-line"></i> Configurar Volumen / Tarifa
            </button>
          ` : ''}
        </div>
      </h4>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title" style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
            <span>VOLUMEN PROMEDIO DIARIO</span>
            ${!b.isClientView && (b.isManualVolume || t.isManualVolume) && !isStoreFiltered ? `<span class="no-print" style="background: rgba(95, 6, 250, 0.12); color: #5f06fa; font-size: 0.62rem; font-weight: 800; padding: 1px 5px; border-radius: 4px;">MANUAL</span>` : ''}
          </div>
          <div class="bg-kpi-value">${formatDec(displayVolAvg, 2)} <span class="bg-kpi-unit">m³</span></div>
          <div class="bg-kpi-subtitle">${isStoreFiltered ? `Promedio de ${escapeHtml(activeStore)} (${activeStoreStorage?.sharePct || 0}% del holding)` : 'Promedio mes calendario'}</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">DÍAS CON REGISTRO</div>
          <div class="bg-kpi-value">${displayVolDays} <span class="bg-kpi-unit">días</span></div>
          <div class="bg-kpi-subtitle">${isStoreFiltered ? `Mediciones de ${escapeHtml(activeStore)}` : 'Mediciones registradas'}</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">PICO MÁXIMO REGISTRADO</div>
          <div class="bg-kpi-value">${formatDec(displayVolMax, 2)} <span class="bg-kpi-unit">m³</span></div>
          <div class="bg-kpi-subtitle">${isStoreFiltered ? `Mayor ocupación de ${escapeHtml(activeStore)}` : 'Mayor ocupación en el mes'}</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">VOLUMEN MÍNIMO REGISTRADO</div>
          <div class="bg-kpi-value">${formatDec(displayVolMin, 2)} <span class="bg-kpi-unit">m³</span></div>
          <div class="bg-kpi-subtitle">${isStoreFiltered ? `Menor ocupación de ${escapeHtml(activeStore)}` : 'Menor ocupación en el mes'}</div>
        </div>
      </div>
    </div>

    <!-- Gráfico de Evolución de Almacenamiento Diario -->
    <div class="bg-chart-card" style="margin-bottom: ${b.isConglomerate && storesStorageBreakdown.length > 0 ? '1.25rem' : '2rem'};">
      <div class="bg-chart-header">
        <div>
          <h4 class="bg-chart-title" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span><i class="ri-line-chart-line text-stocka-purple"></i> Evolución del Volumen de Almacenamiento Diario (m³) ${isStoreFiltered ? `— 🏪 ${escapeHtml(activeStore)}` : (b.isConglomerate ? '— Consolidado y por Comercio' : '')}</span>
            ${!b.isClientView && (b.isManualVolume || t.isManualVolume) && !isStoreFiltered ? `
              <span class="no-print" style="font-size: 0.68rem; background: rgba(95, 6, 250, 0.12); color: #5f06fa; border: 1px solid rgba(95, 6, 250, 0.3); padding: 1px 7px; border-radius: 4px; font-weight: 800;">
                <i class="ri-subtract-line"></i> Valor Fijo Manual (${formatDec(b.volumeM3, 2)} m³)
              </span>
            ` : ''}
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">
            ${isStoreFiltered
              ? `Evolución diaria del cubicaje de ${escapeHtml(activeStore)} durante el periodo facturado`
              : (b.isConglomerate
                  ? 'Comparativa diaria del total consolidado del holding junto al volumen individual de cada comercio'
                  : 'Comportamiento del cubicaje medido durante el mes facturado')}
          </span>
        </div>
        <div class="bg-tariff-badge">
          Tarifa: ${formatCLP(t.storageRate || b.activeRange?.storage_m3 || 48900)} / m³
        </div>
      </div>
      <div style="height: 260px; position: relative;">
        <canvas id="chart-storage-evolution"></canvas>
      </div>
    </div>

    ${b.isConglomerate && storesStorageBreakdown.length > 0 ? `
      <!-- Gráficos Individuales de Almacenamiento Diario por Comercio del Conglomerado -->
      <div style="margin-bottom: 2rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
          <h4 style="margin: 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 0.45rem;">
            <i class="ri-store-2-line text-stocka-purple"></i> Gráficos de Almacenamiento Diario por Comercio (${storesStorageBreakdown.length} Tiendas)
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">
            Cada gráfico utiliza su propia escala para visualizar con precisión la curva de ocupación de cada marca
          </span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.15rem;">
          ${storesStorageBreakdown.map((st, idx) => {
            const isThisStoreActive = activeStore && activeStore.toUpperCase() === st.storeName.toUpperCase();
            return `
              <div class="bg-chart-card" style="padding: 1rem 1.1rem; border: ${isThisStoreActive ? `2px solid ${st.color}` : '1px solid var(--color-border)'}; box-shadow: ${isThisStoreActive ? '0 4px 14px rgba(95,6,250,0.12)' : '0 1px 3px rgba(0,0,0,0.03)'};">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; flex-wrap: wrap;">
                  <div style="display: flex; align-items: center; gap: 0.45rem;">
                    <span style="width: 10px; height: 10px; border-radius: 50%; background: ${st.color}; display: inline-block; flex-shrink: 0;"></span>
                    <strong style="font-size: 0.88rem; color: var(--color-text-main);">${escapeHtml(st.storeName)}</strong>
                    <span class="bg-share-badge" style="font-size: 0.68rem; padding: 1px 6px;">${st.sharePct}% del Holding</span>
                  </div>
                  <button type="button"
                          onclick="window.setConglomerateStoreView(${isThisStoreActive ? 'null' : `'${escapeHtml(st.storeName)}'`})"
                          class="btn btn-xs"
                          style="font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: 5px; border: 1px solid ${isThisStoreActive ? st.color : 'rgba(95,6,250,0.28)'}; background: ${isThisStoreActive ? st.color : 'var(--color-surface)'}; color: ${isThisStoreActive ? '#ffffff' : '#5f06fa'}; cursor: pointer;">
                    ${isThisStoreActive ? '<i class="ri-check-line"></i> Filtrado' : '<i class="ri-filter-3-line"></i> Filtrar tienda'}
                  </button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.45rem; background: var(--color-bg, #f8fafc); border: 1px solid var(--color-border); border-radius: 7px; padding: 0.4rem 0.6rem; margin-bottom: 0.65rem; font-size: 0.72rem;">
                  <div>
                    <div style="color: var(--color-text-muted); font-size: 0.64rem; font-weight: 700; text-transform: uppercase;">Promedio</div>
                    <div style="font-weight: 800; color: ${st.color}; font-size: 0.85rem;">${formatDec(st.averageM3, 2)} m³</div>
                  </div>
                  <div>
                    <div style="color: var(--color-text-muted); font-size: 0.64rem; font-weight: 700; text-transform: uppercase;">Pico Máx.</div>
                    <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.82rem;">${formatDec(st.maxDailyVolume, 2)} m³</div>
                  </div>
                  <div>
                    <div style="color: var(--color-text-muted); font-size: 0.64rem; font-weight: 700; text-transform: uppercase;">Mínimo</div>
                    <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.82rem;">${formatDec(st.minDailyVolume, 2)} m³</div>
                  </div>
                </div>
                <div style="height: 175px; position: relative;">
                  <canvas id="chart-storage-store-${idx}"></canvas>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Métricas de Artículos Vendidos y Despachados -->
    <div style="margin-bottom: 0.5rem;">
      <h4 style="margin: 0 0 0.6rem 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 0.4rem;">
        <i class="ri-shopping-bag-3-line text-stocka-purple"></i> Artículos Vendidos y Despachados ${isStoreFiltered ? `(${escapeHtml(activeStore)})` : ''}
      </h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">TOTAL ARTÍCULOS VENDIDOS</div>
          <div class="bg-kpi-value">${(productsStats?.totalUnits || 0).toLocaleString('es-CL')} <span class="bg-kpi-unit">unidades</span></div>
          <div class="bg-kpi-subtitle">Unidades físicas procesadas</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">PROMEDIO POR PEDIDO</div>
          <div class="bg-kpi-value">${productsStats?.avgUnitsPerOrder || 0} <span class="bg-kpi-unit">uds/pedido</span></div>
          <div class="bg-kpi-subtitle">Artículos por orden despachada</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">SKUS DISTINTOS DESPACHADOS</div>
          <div class="bg-kpi-value">${(productsStats?.allProducts || []).length} <span class="bg-kpi-unit">SKUs</span></div>
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
              Top 10 Productos Más Vendidos ${isStoreFiltered ? `(${escapeHtml(activeStore)})` : ''}
            </h4>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">Ranking por unidades físicas despachadas en el periodo</span>
          </div>
          <span class="bg-share-badge">Top ${(productsStats?.topProducts || []).length}</span>
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
              ${(productsStats?.topProducts || []).map(p => `
                <tr style="border-bottom: 1px solid var(--color-border);">
                  <td class="text-stocka-purple" style="padding: 7px 8px; font-weight: 700;">${p.rank}</td>
                  <td style="padding: 7px 8px; font-weight: 600; font-family: monospace; font-size: 0.75rem;">${p.sku}</td>
                  <td style="padding: 7px 8px; color: var(--color-text-main); font-weight: 500; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 220px;" title="${p.name}">${p.name}</td>
                  <td style="padding: 7px 8px; text-align: right; font-weight: 700; color: var(--color-text-main);">${p.quantity}</td>
                  <td style="padding: 7px 8px; text-align: right;">
                    <span class="bg-share-badge">${p.sharePct}%</span>
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
            <span style="background: rgba(16, 185, 129, 0.12); color: var(--badge-success-text, #10b981); font-weight: 700; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.8rem;">
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
                  <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: var(--badge-success-text, #10b981);">${formatCLP(dec.costCLP)}</td>
                  <td style="padding: 8px 10px; text-align: center;">
                    <span class="badge" style="background: var(--badge-success-bg, rgba(16, 185, 129, 0.12)); color: var(--badge-success-text, #10b981); font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">
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

    <!-- Sección Conglomerado: Participación y Distribución por Tienda -->
    ${b.isConglomerate && sBreakdown && sBreakdown.length > 0 ? `
      <div style="margin-bottom: 2rem;">
        <h4 style="margin: 0 0 0.8rem 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 0.4rem;">
          <i class="ri-building-line text-stocka-purple"></i> Distribución Consolidada por Tienda (${sBreakdown.length} Marcas / Comercios Agrupados)
        </h4>

        <div style="display: grid; grid-template-columns: 1.25fr 1fr; gap: 1.5rem; align-items: start;">
          <!-- Tabla de Participación por Tienda -->
          <div class="bg-chart-card">
            <div class="bg-chart-header">
              <div>
                <h4 class="bg-chart-title">Detalle Operacional y Costos por Tienda</h4>
                <span style="font-size: 0.75rem; color: var(--color-text-muted);">Consolidado de pedidos, despachos y costos netos directos</span>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <span class="bg-share-badge">${sBreakdown.length} Tiendas</span>
                ${activeStore ? `
                  <button type="button" class="btn btn-xs btn-outline" onclick="window.setConglomerateStoreView(null)" style="font-size: 0.72rem; padding: 2px 7px; border-radius: 5px; border-color: rgba(95,6,250,0.35); color: #5f06fa; font-weight: 700; cursor: pointer;">
                    <i class="ri-refresh-line"></i> Ver Todas
                  </button>
                ` : ''}
              </div>
            </div>
            <div style="overflow-x: auto; max-height: 280px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
                <thead>
                  <tr style="border-bottom: 2px solid var(--color-border); text-align: left; color: var(--color-text-muted);">
                    <th style="padding: 6px 8px; min-width: 180px;">Tienda</th>
                    <th style="padding: 6px 8px; text-align: center;">Pedidos</th>
                    <th style="padding: 6px 8px; text-align: center;">Envíos RM</th>
                    <th style="padding: 6px 8px; text-align: center;">Almac. Prom.</th>
                    <th style="padding: 6px 8px; text-align: right;">Costo Neto Op.</th>
                    <th style="padding: 6px 8px; text-align: right;">% Part.</th>
                  </tr>
                </thead>
                <tbody>
                  ${sBreakdown.map(s => {
                    const isRowActive = activeStore && activeStore.toUpperCase() === s.storeName.toUpperCase();
                    const stStorage = storesStorageBreakdown.find(st => st.storeName.toUpperCase() === s.storeName.toUpperCase());
                    return `
                      <tr style="border-bottom: 1px solid var(--color-border); ${isRowActive ? 'background: rgba(95,6,250,0.08);' : ''}">
                        <td style="padding: 7px 8px; font-weight: 700; color: var(--color-text-main);">
                          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                            <span style="display: inline-flex; align-items: center; gap: 4px;">
                              <i class="ri-store-2-line" style="color: #5f06fa;"></i> ${escapeHtml(s.storeName)}
                            </span>
                            <div style="display: inline-flex; align-items: center; gap: 4px;">
                              <button type="button"
                                      onclick="window.setConglomerateStoreView(${isRowActive ? 'null' : `'${escapeHtml(s.storeName)}'`})"
                                      class="btn btn-xs"
                                      title="${isRowActive ? 'Restablecer a Consolidado Holding' : `Filtrar métricas de ${escapeHtml(s.storeName)}`}"
                                      style="padding: 2px 7px; font-size: 0.7rem; font-weight: 700; border-radius: 4px; border: 1px solid rgba(95,6,250,0.3); background: ${isRowActive ? '#5f06fa' : 'var(--color-surface)'}; color: ${isRowActive ? '#ffffff' : '#5f06fa'}; cursor: pointer;">
                                ${isRowActive ? '<i class="ri-check-line"></i> Activa' : '<i class="ri-filter-line"></i> Filtrar'}
                              </button>
                              <button type="button"
                                      onclick="window.setConglomerateStoreView('${escapeHtml(s.storeName)}'); if(document.getElementById('client-billing-interactive-modal')?.style.display !== 'none'){ window.switchClientBillingTab('register'); } else if(typeof window.switchBgTab === 'function'){ window.switchBgTab('orders'); }"
                                      class="btn btn-xs"
                                      title="Ver los ${s.billableOrders} pedidos de ${escapeHtml(s.storeName)} en el Registro Excel"
                                      style="padding: 2px 7px; font-size: 0.7rem; font-weight: 600; border-radius: 4px; border: 1px solid rgba(16,185,129,0.35); background: rgba(16,185,129,0.08); color: #10b981; cursor: pointer;">
                                <i class="ri-table-line"></i> Ver Pedidos
                              </button>
                            </div>
                          </div>
                        </td>
                        <td style="padding: 7px 8px; text-align: center; font-weight: 700;">${s.billableOrders}</td>
                        <td style="padding: 7px 8px; text-align: center; color: var(--color-text-muted);">${s.shippingRmCount}</td>
                        <td style="padding: 7px 8px; text-align: center; font-weight: 700; color: #10b981;">
                          ${stStorage ? `${formatDec(stStorage.averageM3, 2)} m³` : '—'}
                        </td>
                        <td style="padding: 7px 8px; text-align: right; font-weight: 700; color: var(--color-text-main);">${formatCLP(s.storeTotalNet)}</td>
                        <td style="padding: 7px 8px; text-align: right;">
                          <span class="bg-share-badge">${s.sharePct}%</span>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Gráfico Doughnut Participación por Tienda -->
          <div class="bg-chart-card">
            <div class="bg-chart-header">
              <h4 class="bg-chart-title">Participación de Pedidos por Tienda</h4>
              <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">% Volumen de Órdenes</span>
            </div>
            <div style="height: 250px; position: relative;">
              <canvas id="chart-conglomerate-stores-donut"></canvas>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Detección dinámica de modo oscuro para Chart.js
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body.getAttribute('data-theme') === 'dark';
  const chartTextColor = isDark ? '#cbd5e1' : '#64748b';
  const chartGridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const chartBorderColor = isDark ? '#131b2e' : '#ffffff';
  const chartPurple = isDark ? '#a855f7' : '#5f06fa';

  const corporatePalette = isDark
    ? ['#a855f7', '#c084fc', '#818cf8', '#60a5fa', '#38bdf8', '#2dd4bf', '#34d399', '#94a3b8', '#cbd5e1']
    : ['#5f06fa', '#7c3aed', '#6366f1', '#4f46e5', '#3b82f6', '#0ea5e9', '#10b981', '#64748b', '#94a3b8'];

  // Función segura para crear o recrear un gráfico Chart.js dentro del contenedor
  const getCanvasAndInit = (id, config) => {
    const canvas = container.querySelector('#' + id) || document.getElementById(id);
    if (!canvas) return null;
    if (typeof Chart !== 'undefined' && typeof Chart.getChart === 'function') {
      const existing = Chart.getChart(canvas);
      if (existing) existing.destroy();
    }
    return new Chart(canvas, config);
  };

  // A. Gráfico de Evolución de Almacenamiento Diario (Consolidado + Comercios o Tienda Filtrada)
  const isManualVol = !!(b.isManualVolume || t.isManualVolume);
  const periodYear = b.currentPeriodYear || new Date().getFullYear();
  const periodMonth = b.currentPeriodMonth || (new Date().getMonth() + 1);
  const fixedVolVal = Number((parseFloat(b.volumeM3) || 0).toFixed(2));
  const baseDailyLogs = isManualVol
    ? generateConstantDailyStorageLogs(periodYear, periodMonth, fixedVolVal)
    : (b.dailyStorageLogs && b.dailyStorageLogs.length > 0
        ? b.dailyStorageLogs
        : [{ date: `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`, volume: fixedVolVal }]);

  const activeLogs = (isStoreFiltered && activeStoreStorage && activeStoreStorage.dailyLogs && activeStoreStorage.dailyLogs.length > 0)
    ? activeStoreStorage.dailyLogs
    : baseDailyLogs;

  const maxLogVol = activeLogs.reduce((max, l) => Math.max(max, parseFloat(l.volume) || 0), 0);
  const ySuggestedMax = maxLogVol > 0 ? Number((maxLogVol * 1.25).toFixed(2)) : 5;

  const storageCanvas = container.querySelector('#chart-storage-evolution') || document.getElementById('chart-storage-evolution');
  if (storageCanvas) {
    const ctx = storageCanvas.getContext('2d');
    const mainLineColor = isStoreFiltered && activeStoreStorage?.color ? activeStoreStorage.color : chartPurple;
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, isDark ? 'rgba(168, 85, 247, 0.32)' : 'rgba(95, 6, 250, 0.22)');
    gradient.addColorStop(1, isDark ? 'rgba(168, 85, 247, 0.01)' : 'rgba(95, 6, 250, 0.01)');

    const dateList = activeLogs.map(l => l.date);
    const formattedLabels = dateList.map(d => {
      const parts = (d || '').split('-');
      return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
    });

    const storageDatasets = [{
      label: isStoreFiltered
        ? `${activeStore} (${formatDec(activeStoreStorage?.averageM3 || 0, 2)} m³ prom.)`
        : (b.isConglomerate ? `Total Holding (${formatDec(b.volumeM3, 2)} m³ prom.)` : 'Volumen Diario (m³)'),
      data: activeLogs.map(l => Number((parseFloat(l.volume) || 0).toFixed(2))),
      borderColor: mainLineColor,
      backgroundColor: gradient,
      fill: true,
      tension: (isManualVol && !isStoreFiltered) ? 0 : 0.25,
      borderWidth: 2.5,
      pointRadius: activeLogs.length > 20 ? 2 : 4,
      pointBackgroundColor: mainLineColor,
      pointHoverRadius: 6
    }];

    // Si es vista consolidada de un conglomerado, incluir también las curvas de cada tienda en el gráfico principal
    if (b.isConglomerate && !isStoreFiltered && storesStorageBreakdown.length > 0) {
      storesStorageBreakdown.forEach(st => {
        const stLogMap = {};
        (st.dailyLogs || []).forEach(sl => { stLogMap[sl.date] = sl.volume; });
        const stSeries = dateList.map(d => Number((parseFloat(stLogMap[d] ?? 0) || 0).toFixed(2)));
        storageDatasets.push({
          label: `${st.storeName} (${formatDec(st.averageM3, 2)} m³ prom.)`,
          data: stSeries,
          borderColor: st.color,
          backgroundColor: st.color,
          fill: false,
          tension: 0.25,
          borderWidth: 2,
          pointRadius: dateList.length > 20 ? 1.8 : 3.5,
          pointBackgroundColor: st.color,
          pointHoverRadius: 5
        });
      });
    }

    getCanvasAndInit('chart-storage-evolution', {
      type: 'line',
      data: {
        labels: formattedLabels,
        datasets: storageDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Outfit', size: 10 }, color: chartTextColor }
          },
          y: {
            beginAtZero: true,
            suggestedMax: ySuggestedMax,
            grid: { color: chartGridColor },
            ticks: {
              font: { family: 'Outfit', size: 10 },
              color: chartTextColor,
              callback: val => `${val} m³`
            }
          }
        },
        plugins: {
          legend: {
            display: storageDatasets.length > 1,
            position: 'top',
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              font: { family: 'Outfit', size: 11, weight: '600' },
              color: chartTextColor
            }
          },
          tooltip: {
            callbacks: {
              label: context => ` ${context.dataset.label.split(' (')[0]}: ${context.raw} m³`
            }
          }
        }
      }
    });
  }

  // A2. Gráficos individuales de almacenamiento diario por cada comercio del conglomerado (con escala propia)
  if (b.isConglomerate && storesStorageBreakdown.length > 0) {
    storesStorageBreakdown.forEach((st, idx) => {
      const stCanvasId = `chart-storage-store-${idx}`;
      const stCanvas = container.querySelector('#' + stCanvasId) || document.getElementById(stCanvasId);
      if (!stCanvas) return;

      const stLogs = (st.dailyLogs && st.dailyLogs.length > 0)
        ? st.dailyLogs
        : baseDailyLogs.map(l => ({ date: l.date, volume: 0 }));

      const stMax = stLogs.reduce((m, l) => Math.max(m, parseFloat(l.volume) || 0), 0);
      const stSuggestedMax = stMax > 0 ? Number((stMax * 1.25).toFixed(2)) : 5;

      const stLabels = stLogs.map(l => {
        const parts = (l.date || '').split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : l.date;
      });

      getCanvasAndInit(stCanvasId, {
        type: 'line',
        data: {
          labels: stLabels,
          datasets: [{
            label: `${st.storeName} (m³)`,
            data: stLogs.map(l => Number((parseFloat(l.volume) || 0).toFixed(2))),
            borderColor: st.color,
            backgroundColor: st.color + '22',
            fill: true,
            tension: 0.25,
            borderWidth: 2.2,
            pointRadius: stLogs.length > 20 ? 1.8 : 3.5,
            pointBackgroundColor: st.color,
            pointHoverRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { family: 'Outfit', size: 9 }, color: chartTextColor, maxTicksLimit: 10 }
            },
            y: {
              beginAtZero: true,
              suggestedMax: stSuggestedMax,
              grid: { color: chartGridColor },
              ticks: {
                font: { family: 'Outfit', size: 9 },
                color: chartTextColor,
                callback: val => `${val} m³`
              }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: context => ` ${st.storeName}: ${context.raw} m³`
              }
            }
          }
        }
      });
    });
  }

  // B. Gráfico de Barras de Top Productos Más Vendidos
  const topProds = (productsStats?.topProducts || []).slice(0, 6);
  if (topProds.length > 0) {
    getCanvasAndInit('chart-top-products', {
      type: 'bar',
      data: {
        labels: topProds.map(p => (p.sku && p.sku !== 'S/SKU') ? (p.sku.length > 22 ? p.sku.slice(0, 20) + '...' : p.sku) : (p.name.length > 22 ? p.name.slice(0, 20) + '...' : p.name)),
        datasets: [{
          label: 'Unidades Vendidas',
          data: topProds.map(p => p.quantity),
          backgroundColor: corporatePalette.slice(0, topProds.length),
          borderRadius: 6,
          borderWidth: 1,
          borderColor: chartBorderColor
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: chartGridColor },
            ticks: { stepSize: 1, font: { family: 'Outfit', size: 10 }, color: chartTextColor }
          },
          y: {
            grid: { display: false },
            ticks: { font: { family: 'Outfit', weight: '700', size: 11 }, color: chartTextColor }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: context => {
                const prod = topProds[context[0]?.dataIndex];
                return prod ? prod.name : '';
              },
              label: context => {
                const prod = topProds[context.dataIndex];
                return prod ? `SKU: ${prod.sku} — ${prod.quantity.toLocaleString('es-CL')} unidades (${prod.sharePct}% del total)` : '';
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

  getCanvasAndInit('chart-courier-distribution', {
    type: 'doughnut',
    data: {
      labels: courierLabels,
      datasets: [{
        data: courierCounts,
        backgroundColor: corporatePalette.slice(0, courierLabels.length),
        borderWidth: 2,
        borderColor: chartBorderColor,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 12,
            color: chartTextColor,
            font: { family: 'Outfit', size: 11, weight: '600' }
          }
        }
      },
      cutout: '62%'
    }
  });

  // 2. Chart Delivery Types (Dinámico según configuración de tarifas)
  const configuredDeliveryTypes = getDeliveryTypes(b.pricingConfig);
  const typeMap = {};
  configuredDeliveryTypes.forEach(dt => {
    typeMap[dt.key] = { label: `${dt.name} (${formatCLP(dt.price)})`, count: 0 };
  });

  orders.forEach(o => {
    if (typeMap[o.deliveryType]) {
      typeMap[o.deliveryType].count++;
    } else {
      const fallbackLabel = o.deliveryType || 'Otro';
      if (!typeMap[fallbackLabel]) {
        typeMap[fallbackLabel] = { label: fallbackLabel, count: 0 };
      }
      typeMap[fallbackLabel].count++;
    }
  });

  const activeEntries = Object.values(typeMap).filter(item => item.count > 0);
  const typeLabels = activeEntries.map(item => item.label);
  const typeCounts = activeEntries.map(item => item.count);

  getCanvasAndInit('chart-delivery-types', {
    type: 'pie',
    data: {
      labels: typeLabels.length > 0 ? typeLabels : ['Sin despachos'],
      datasets: [{
        data: typeCounts.length > 0 ? typeCounts : [1],
        backgroundColor: corporatePalette.slice(0, Math.max(typeLabels.length, 1)),
        borderWidth: 2,
        borderColor: chartBorderColor,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 12,
            color: chartTextColor,
            font: { family: 'Outfit', size: 11, weight: '600' }
          }
        }
      }
    }
  });

  // 3. Chart Expense Breakdown
  const expenseData = isStoreFiltered
    ? [
        { label: 'Preparación (Pick&Pack)', val: storeData?.pickPackNet || 0, color: '#7c3aed', darkColor: '#c084fc' },
        { label: 'Flete Despacho', val: storeData?.shippingFreightNet || 0, color: '#6366f1', darkColor: '#818cf8' },
        { label: 'Etiqueta FULL MELI', val: storeData?.meliFullNet || 0, color: '#f59e0b', darkColor: '#fbbf24' }
      ].filter(e => e.val > 0)
    : [
        { label: 'Almacenamiento', val: t.storageNet || 0, color: '#5f06fa', darkColor: '#a855f7' },
        { label: 'Preparación (Pick&Pack)', val: t.pickPackNet || 0, color: '#7c3aed', darkColor: '#c084fc' },
        { label: 'Despachos RM/Flex', val: t.shippingRmFlexNet || 0, color: '#6366f1', darkColor: '#818cf8' },
        { label: 'Costo Variable Mensual', val: t.fixedFeeNet || 0, color: '#3b82f6', darkColor: '#60a5fa' },
        { label: 'Etiqueta FULL MELI', val: t.meliFullNet || 0, color: '#f59e0b', darkColor: '#fbbf24' },
        { label: 'Punto de Venta (POS)', val: t.posFeeNet || 0, color: '#0ea5e9', darkColor: '#38bdf8' },
        { label: 'Recepción e Ingreso de Stock', val: t.inboundNet || 0, color: '#10b981', darkColor: '#34d399' },
        { label: 'Insumos de Embalaje', val: t.suppliesNet || 0, color: '#64748b', darkColor: '#94a3b8' }
      ].filter(e => e.val > 0);

  getCanvasAndInit('chart-expense-breakdown', {
    type: 'doughnut',
    data: {
      labels: expenseData.map(e => e.label),
      datasets: [{
        data: expenseData.map(e => e.val),
        backgroundColor: expenseData.map(e => isDark ? (e.darkColor || e.color) : e.color),
        borderWidth: 2,
        borderColor: chartBorderColor,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 12,
            color: chartTextColor,
            font: { family: 'Outfit', size: 11, weight: '600' }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw || 0;
              const totalRef = isStoreFiltered ? (storeData?.storeTotalNet || 0) : (t.totalNet || 0);
              const pct = totalRef > 0 ? ((val / totalRef) * 100).toFixed(1) : 0;
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

  getCanvasAndInit('chart-frequent-destinations', {
    type: 'bar',
    data: {
      labels: sortedDests.map(d => d[0]),
      datasets: [{
        label: 'Cantidad de Pedidos',
        data: sortedDests.map(d => d[1]),
        backgroundColor: isDark ? 'rgba(168, 85, 247, 0.85)' : 'rgba(95, 6, 250, 0.85)',
        hoverBackgroundColor: isDark ? '#a855f7' : '#5f06fa',
        borderColor: isDark ? '#c084fc' : '#5f06fa',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: chartGridColor },
          ticks: { stepSize: 1, font: { family: 'Outfit', size: 10 }, color: chartTextColor }
        },
        y: {
          grid: { display: false },
          ticks: { font: { family: 'Outfit', weight: '600', size: 11 }, color: chartTextColor }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });

  // 5. Chart Conglomerado: Participación de Tiendas (si aplica)
  if (b.isConglomerate && sBreakdown && sBreakdown.length > 0) {
    const storeLabels = sBreakdown.map(s => s.storeName);
    const storeOrders = sBreakdown.map(s => s.billableOrders);

    getCanvasAndInit('chart-conglomerate-stores-donut', {
      type: 'doughnut',
      data: {
        labels: storeLabels,
        datasets: [{
          data: storeOrders,
          backgroundColor: corporatePalette.slice(0, storeLabels.length),
          borderColor: chartBorderColor,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 12,
              color: chartTextColor,
              font: { family: 'Outfit', size: 11, weight: '600' }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const count = context.raw || 0;
                const total = storeOrders.reduce((sum, v) => sum + v, 0);
                const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
                return ` ${context.label}: ${count} pedidos (${pct}%)`;
              }
            }
          }
        },
        cutout: '55%'
      }
    });
  }

  // Observer para re-renderizar los gráficos automáticamente al cambiar de tema (claro/oscuro)
  if (!container.__themeObserverAttached) {
    container.__themeObserverAttached = true;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          if (document.body.contains(container)) {
            renderBillingAnalyticsCharts(targetContainerId, snapshotState);
          }
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
}

// Agrupar y ordenar periodos por año calendario (Años descendente, meses en orden calendario Enero-Diciembre)
export function groupAndSortBillingPeriods(periodsList) {
  if (!periodsList || !Array.isArray(periodsList) || periodsList.length === 0) return [];

  const getYear = (p) => {
    if (p && p.period_year) return parseInt(p.period_year, 10);
    const match = ((p && p.name) || '').match(/\b(20\d\d)\b/);
    if (match) return parseInt(match[1], 10);
    return new Date().getFullYear();
  };

  const getMonth = (p) => {
    if (p && p.period_month) return parseInt(p.period_month, 10);
    const parts = ((p && p.name) || '').trim().toUpperCase();
    const monthMap = {
      'ENERO': 1, 'ENE': 1,
      'FEBRERO': 2, 'FEB': 2,
      'MARZO': 3, 'MAR': 3,
      'ABRIL': 4, 'ABR': 4,
      'MAYO': 5, 'MAY': 5,
      'JUNIO': 6, 'JUN': 6,
      'JULIO': 7, 'JUL': 7,
      'AGOSTO': 8, 'AGO': 8,
      'SEPTIEMBRE': 9, 'SEP': 9, 'SETIEMBRE': 9,
      'OCTUBRE': 10, 'OCT': 10,
      'NOVIEMBRE': 11, 'NOV': 11,
      'DICIEMBRE': 12, 'DIC': 12
    };
    for (const [key, val] of Object.entries(monthMap)) {
      if (parts.includes(key)) return val;
    }
    return 1;
  };

  const groupsByYear = {};
  periodsList.forEach(p => {
    const y = getYear(p);
    const m = getMonth(p);
    if (!groupsByYear[y]) groupsByYear[y] = [];
    groupsByYear[y].push({ ...p, _year: y, _month: m });
  });

  const sortedYears = Object.keys(groupsByYear).map(Number).sort((a, b) => b - a);

  return sortedYears.map(year => ({
    year,
    periods: groupsByYear[year].sort((a, b) => a._month - b._month)
  }));
}
window.groupAndSortBillingPeriods = groupAndSortBillingPeriods;

// --- VISTA PRINCIPAL DEL MÓDULO DEL GESTOR DE FACTURACIÓN ---
window.renderBillingGeneratorAdmin = async function(targetContainerId = 'tab-generator-content', initialCommerce = null, initialPeriodId = null) {
  injectBillingGeneratorStyles();

  const container = document.getElementById(targetContainerId);
  if (!container) return;

  // Mostrar estado de carga inmediato mientras se obtienen filtros de Supabase
  container.innerHTML = `
    <div style="text-align: center; padding: 4rem 2rem; color: var(--color-text-muted);">
      <div style="width: 44px; height: 44px; border: 4px solid rgba(95, 6, 250, 0.15); border-top-color: #5f06fa; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1.25rem;"></div>
      <h3 style="font-weight: 800; color: var(--color-text-main); margin: 0 0 0.5rem 0; font-size: 1.15rem;">Cargando Gestor de Facturación...</h3>
      <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">Obteniendo periodos oficiales, comercios y tarifas...</p>
    </div>
  `;

  // Cargar lista de periodos, lista de comercios y mapa de conglomerados
  let periods = [];
  let comercios = [];
  let conglomeratesMap = {};
  let childToConglomerateMap = {};
  let canonicalDisplayList = [];

  try {
    const { data: pData } = await supabase.from('billing_periods').select('id, name, period_month, period_year, status').order('created_at', { ascending: false });
    periods = pData || [];

    const { data: cData } = await supabase.from('v_comercios_config').select('nombre, sigla').order('nombre');
    const inactiveSet = typeof window.fetchInactiveMerchantsSet === 'function'
      ? await window.fetchInactiveMerchantsSet()
      : new Set();
    comercios = (cData || []).filter(c => c.nombre && !inactiveSet.has(c.nombre.trim().toUpperCase()));

    const congData = await getConglomerateMappings();
    conglomeratesMap = congData.conglomeratesMap || {};
    childToConglomerateMap = congData.childToConglomerateMap || {};
    canonicalDisplayList = congData.canonicalDisplayList || [];
  } catch (e) {
    console.error('Error cargando filtros iniciales:', e);
  }

  // Garantizar que initialCommerce esté en la lista si fue solicitado
  if (initialCommerce) {
    const upperInit = String(initialCommerce).toUpperCase();
    if (!comercios.some(c => String(c.nombre).toUpperCase() === upperInit) && !conglomeratesMap[upperInit]) {
      comercios.unshift({ nombre: initialCommerce, sigla: 'COM' });
    }
  }

  const defaultPeriod = initialPeriodId 
    ? (periods.find(p => p.id === initialPeriodId) || periods.find(p => p.status === 'activo') || periods[0] || { id: initialPeriodId, name: 'SEPTIEMBRE 2026' })
    : (periods.find(p => p.status === 'activo') || periods[0] || { id: '', name: 'SEPTIEMBRE 2026' });

  const defaultCommerce = initialCommerce ? String(initialCommerce).trim() : '';
  const selUpper = String(defaultCommerce || '').trim().toUpperCase();
  let hasSelectedCommerce = false;

  // Filtrar comercios individuales para que no aparezcan nombres de holdings repetidos
  const individualComerciosList = comercios.filter(c => {
    const cUpper = String(c.nombre || '').trim().toUpperCase();
    if (cUpper === 'BIG BANG' || cUpper === 'BIG BANG SPA' || cUpper.includes('BIG BANG') || cUpper.includes('HOLDING BIG BANG')) return false;
    if (cUpper === 'SILVER FOX' || cUpper === 'SILVER FOX SPA' || cUpper.includes('SILVER FOX') || cUpper.includes('HOLDING SILVER FOX')) return false;
    return true;
  });

  const periodGroups = groupAndSortBillingPeriods(periods);
  const periodOptionsHTML = periodGroups.length > 0
    ? periodGroups.map(group => `
        <optgroup label="📅 Año ${group.year}">
          ${group.periods.map(p => `
            <option value="${p.id}" data-name="${escapeHtml(p.name)}" ${p.id === defaultPeriod?.id ? 'selected' : ''}>
              ${escapeHtml(p.name)}${p.status === 'activo' ? ' (Activo)' : ''}
            </option>
          `).join('')}
        </optgroup>
      `).join('')
    : `<option value="${escapeHtml(defaultPeriod?.id || '')}" data-name="${escapeHtml(defaultPeriod?.name || 'SEPTIEMBRE 2026')}" selected>${escapeHtml(defaultPeriod?.name || 'SEPTIEMBRE 2026')}</option>`;

  const startInGenerator = Boolean(initialCommerce);

  container.innerHTML = `
    <div style="padding: 0.5rem 0;">
      <!-- ========================================================================= -->
      <!-- VISTA 1: RESUMEN DEL PERIODO ACTUAL (DEFAULT AL ENTRAR AL GESTOR)        -->
      <!-- ========================================================================= -->
      <div id="bg-period-overview-wrapper" style="display: ${startInGenerator ? 'none' : 'block'};">
        <!-- Barra Superior del Resumen del Periodo -->
        <div class="bg-card-container" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; border-left: 4px solid #5f06fa; margin-bottom: 1.25rem;">
          <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
            <div style="width: 46px; height: 46px; border-radius: 12px; background: linear-gradient(135deg, #5f06fa 0%, #7c3aed 100%); color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.45rem; box-shadow: 0 4px 12px rgba(95, 6, 250, 0.28); flex-shrink: 0;">
              <i class="ri-dashboard-3-line"></i>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--color-text-main);">
                  Resumen del Periodo — Gestor de Facturación
                </h3>
                <span id="bg-overview-period-badge" style="background: rgba(95, 6, 250, 0.1); color: #5f06fa; font-size: 0.72rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; border: 1px solid rgba(95, 6, 250, 0.25);">
                  ${escapeHtml(defaultPeriod?.name || 'PERIODO ACTUAL')}
                </span>
              </div>
              <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
                Estado general de desgloses emitidos, totales de fulfillment y comercios pendientes de generar en el periodo.
              </p>
            </div>
          </div>

          <div style="display: flex; align-items: flex-end; gap: 0.65rem; flex-wrap: wrap;">
            <div>
              <label style="font-size: 0.7rem; font-weight: 800; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem; text-transform: uppercase;">
                <i class="ri-calendar-event-line" style="color: #5f06fa;"></i> Periodo Oficial:
              </label>
              <select id="bg-overview-select-period" class="form-input" style="height: 40px; margin: 0; min-width: 220px; font-weight: 700; border-radius: 8px;">
                ${periodOptionsHTML}
              </select>
            </div>

            <button type="button" id="bg-btn-refresh-overview" class="btn btn-outline" style="height: 40px; border-color: #cbd5e1; font-weight: 700; border-radius: 8px; display: inline-flex; align-items: center; gap: 0.35rem;" title="Actualizar métricas y estados del periodo">
              <i class="ri-refresh-line"></i> Actualizar
            </button>

            <button type="button" onclick="window.switchBgMainMode('generator')" class="btn btn-primary" style="height: 40px; background: linear-gradient(135deg, #5f06fa 0%, #7c3aed 100%); border-color: #5f06fa; font-weight: 700; border-radius: 8px; display: inline-flex; align-items: center; gap: 0.45rem; box-shadow: 0 4px 12px rgba(95, 6, 250, 0.28);">
              <i class="ri-calculator-line"></i> Ir al Generador de Desgloses <i class="ri-arrow-right-line"></i>
            </button>
          </div>
        </div>

        <!-- Contenedor Dinámico del Resumen del Periodo -->
        <div id="bg-period-overview-body">
          <div style="text-align: center; padding: 3.5rem 2rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-text-muted);">
            <i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: #5f06fa; display: inline-block; margin-bottom: 0.5rem;"></i>
            <div style="font-weight: 700; color: var(--color-text-main);">Cargando resumen del periodo...</div>
          </div>
        </div>
      </div>

      <!-- ========================================================================= -->
      <!-- VISTA 2: GENERADOR Y EDITOR DE DESGLOSES POR COMERCIO                     -->
      <!-- ========================================================================= -->
      <div id="bg-generator-workspace-wrapper" style="display: ${startInGenerator ? 'block' : 'none'};">
      <!-- Barra Superior de Control y Acciones (Compacta en 1 fila) -->
      <div class="bg-card-container" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; padding: 0.48rem 0.85rem; margin-bottom: 0.55rem; border-left: 4px solid #5f06fa;">
        <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
          <button type="button" onclick="window.switchBgMainMode('overview')" class="btn btn-outline bg-toolbar-btn" style="border-color: rgba(95, 6, 250, 0.35); background: rgba(95, 6, 250, 0.05); color: #5f06fa; font-weight: 800;" title="Volver a la vista resumen del periodo actual">
            <i class="ri-arrow-left-line"></i> Resumen
            <span id="bg-btn-overview-pending-badge" style="display: none; background: #f59e0b; color: #ffffff; font-size: 0.64rem; font-weight: 800; padding: 1px 5px; border-radius: 999px;">0</span>
          </button>

          <div style="display: flex; align-items: center; gap: 0.35rem; position: relative;" title="Comercio o Holding a facturar">
            <select id="bg-select-commerce" class="form-input" style="height: 31px; padding: 0 0.55rem; margin: 0; width: 260px; max-width: 275px; font-size: 0.77rem; font-weight: 700; border-radius: 7px; text-overflow: ellipsis;">
              <option value="" ${!defaultCommerce ? 'selected' : ''}>— Selecciona comercio o holding —</option>
              ${canonicalDisplayList.length > 0 ? `
                <optgroup label="🏢 Conglomerados / Holdings (Cuentas Consolidadas)">
                  ${canonicalDisplayList.map(cg => {
                    const cgUpper = String(cg.name).trim().toUpperCase();
                    const cleanChildren = (cg.children || []).filter(ch => {
                      const u = String(ch || '').trim().toUpperCase();
                      return u && u !== cgUpper && u !== `${cgUpper} SPA`;
                    });
                    let isSel = false;
                    if (selUpper && !hasSelectedCommerce) {
                      if (cgUpper === selUpper || (selUpper.includes('BIG BANG') && cgUpper === 'BIG BANG') || (selUpper.includes('SILVER FOX') && cgUpper === 'SILVER FOX')) {
                        isSel = true;
                        hasSelectedCommerce = true;
                      }
                    }
                    return `<option value="${escapeHtml(cg.name)}" ${isSel ? 'selected' : ''}>🏢 ${escapeHtml(cg.name)} (${escapeHtml(cleanChildren.join(', '))})</option>`;
                  }).join('')}
                </optgroup>
              ` : ''}
              <optgroup label="🏪 Tiendas / Comercios Individuales">
                ${individualComerciosList.map(c => {
                  const cUpper = String(c.nombre).trim().toUpperCase();
                  let isSel = false;
                  if (selUpper && !hasSelectedCommerce && cUpper === selUpper) {
                    isSel = true;
                    hasSelectedCommerce = true;
                  }
                  return `<option value="${escapeHtml(c.nombre)}" ${isSel ? 'selected' : ''}>${escapeHtml(c.nombre)} (${escapeHtml(c.sigla || 'N/A')})</option>`;
                }).join('')}
              </optgroup>
            </select>
            <span id="bg-select-commerce-spinner" style="display: none; color: #5f06fa; font-size: 1.05rem; align-items: center;" title="Cargando comercio...">
              <i class="ri-loader-4-line ri-spin"></i>
            </span>
          </div>

          <select id="bg-select-period" class="form-input" style="height: 31px; padding: 0 0.55rem; margin: 0; width: 175px; font-size: 0.77rem; font-weight: 700; border-radius: 7px;" title="Periodo Oficial de Facturación">
            ${periodOptionsHTML}
          </select>

          <button id="bg-btn-recalculate" class="btn btn-primary bg-toolbar-btn" style="background: #5f06fa; border-color: #5f06fa; box-shadow: 0 2px 8px rgba(95, 6, 250, 0.22);" title="Calcular o actualizar facturación del comercio seleccionado">
            <i class="ri-refresh-line"></i> Calcular
          </button>
        </div>

        <div style="display: flex; gap: 0.38rem; align-items: center; flex-wrap: wrap;">
          <button id="bg-btn-config-delivery" class="btn btn-outline bg-toolbar-btn" style="border-color: rgba(95, 6, 250, 0.45); color: #5f06fa;" title="Configurar y editar tarifas de tipos de entrega">
            <i class="ri-settings-4-line"></i> Tipos Entrega
          </button>
          <button id="bg-btn-export-excel" class="btn btn-outline bg-toolbar-btn" style="border-color: #10b981; color: #10b981;" title="Exportar registro a Excel (.xlsx) con fórmulas">
            <i class="ri-file-excel-2-fill"></i> Excel
          </button>
          <button id="bg-btn-download-pdf" class="btn btn-outline bg-toolbar-btn" style="border-color: #ef4444; color: #ef4444;" title="Descargar PDF del Desglose Oficial">
            <i class="ri-file-pdf-fill"></i> PDF
          </button>
          <button id="bg-btn-save-record" class="btn btn-primary bg-toolbar-btn" style="background: #10b981; border-color: #10b981; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.22);" title="Guardar borrador de facturación en base de datos">
            <i class="ri-save-3-fill"></i> Guardar
          </button>
          <button id="bg-btn-publish-record" class="btn btn-primary bg-toolbar-btn" style="background: linear-gradient(135deg, #5f06fa 0%, #7c3aed 100%); border-color: #5f06fa; box-shadow: 0 2px 8px rgba(95, 6, 250, 0.28);" title="Confirmar cobro y publicar desglose oficial, registro de pedidos y métricas directamente en el portal del cliente">
            <i class="ri-send-plane-fill"></i> Confirmar y Publicar
          </button>
        </div>
      </div>

      <!-- Banner de Estado Cerrado / Confirmado / Pagado -->
      <div id="bg-lock-status-banner" style="display: none; margin-bottom: 0.5rem;"></div>

      <!-- Banner de Alerta de Apelaciones / Observaciones de Facturación sin Respuesta -->
      <div id="bg-commerce-observations-alert-banner" style="display: none; margin-bottom: 0.65rem;"></div>

      <!-- Banner de Conglomerado Dinámico -->
      <div id="bg-conglomerate-banner-container"></div>

      <!-- Resumen KPI en Vivo -->
      <div id="bg-kpis-container" class="bg-kpi-grid">
        ${startInGenerator ? `
          <div style="grid-column: 1 / -1; text-align: center; padding: 0.9rem; color: var(--color-text-muted); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px;">
            <i class="ri-loader-4-line ri-spin" style="font-size: 1.25rem; color: #5f06fa; display: inline-block; margin-bottom: 0.2rem;"></i>
            <div style="font-size: 0.82rem;">Iniciando cálculo para <strong>${escapeHtml(defaultCommerce)}</strong>...</div>
          </div>
        ` : ''}
      </div>

      <!-- Sub-pestañas de Navegación + Acciones Rápidas del Registro -->
      <div class="bg-subnav">
        <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
          <button class="bg-subnav-btn active" id="bg-tab-btn-register" onclick="window.switchBgSubTab('register')" title="Edita libremente celdas de tarifas, recargos o fletes en tiempo real">
            <i class="ri-table-fill"></i> Registro Editable (Excel)
          </button>
          <button class="bg-subnav-btn" id="bg-tab-btn-desglose" onclick="window.switchBgSubTab('desglose')">
            <i class="ri-file-list-3-fill"></i> Desglose Oficial Stocka
          </button>
          <button class="bg-subnav-btn" id="bg-tab-btn-analytics" onclick="window.switchBgSubTab('analytics')">
            <i class="ri-bar-chart-2-fill"></i> Analítica y Gráficas
          </button>
          <button class="bg-subnav-btn" id="bg-tab-btn-checklist" onclick="window.switchBgSubTab('checklist')">
            <i class="ri-checkbox-circle-line"></i> Checklist Global
            <span id="bg-checklist-nav-badge" style="background: rgba(95, 6, 250, 0.12); color: #5f06fa; font-size: 0.68rem; padding: 1px 6px; border-radius: 10px; font-weight: 800; margin-left: 2px;">0/0</span>
          </button>
          <button class="bg-subnav-btn" id="bg-tab-btn-observations" onclick="window.switchBgSubTab('observations')" title="Ver apelaciones y observaciones de facturación del comercio e ingresarlas como saldo al periodo en curso">
            <i class="ri-question-answer-line"></i> Apelaciones / Observaciones
            <span id="bg-observations-nav-badge" style="display: none; background: #ef4444; color: #ffffff; font-size: 0.68rem; padding: 1px 6px; border-radius: 10px; font-weight: 800; margin-left: 2px;">0</span>
          </button>
        </div>

        <div id="bg-register-top-actions" style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" onclick="window.openAddCustomColumnModal()" style="height: 29px; padding: 0 0.6rem; font-size: 0.73rem; border-radius: 6px; font-weight: 700; border-color: rgba(234, 88, 12, 0.45); color: #c2410c; background: rgba(234, 88, 12, 0.06); display: inline-flex; align-items: center; gap: 3px;" title="Añadir columna de cobro personalizada (Recargo por unidad o global por pedido) que se suma a Preparación">
            <i class="ri-layout-column-line" style="color: #ea580c;"></i> + Columna Recargo
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.addNewManualSupplyRow()" style="height: 29px; padding: 0 0.6rem; font-size: 0.73rem; border-radius: 6px; font-weight: 600;" title="Agregar Insumo o Caja">+ Insumo</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.addNewManualAdjustmentRow()" style="height: 29px; padding: 0 0.6rem; font-size: 0.73rem; border-radius: 6px; font-weight: 600;" title="Agregar Descuento o Ajuste Comercial">+ Ajuste</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.addNewManualAbonoRow()" style="height: 29px; padding: 0 0.6rem; font-size: 0.73rem; border-radius: 6px; font-weight: 600; border-color: rgba(16, 185, 129, 0.5); color: #047857; background: rgba(16, 185, 129, 0.05); display: inline-flex; align-items: center; gap: 3px;" title="Registrar abono comercial que descuenta el saldo a pagar por el cliente">
            <i class="ri-hand-coin-line" style="color: #10b981;"></i> + Abono
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.openManagePosAbonosBillingModal()" style="height: 29px; padding: 0 0.6rem; font-size: 0.73rem; border-radius: 6px; font-weight: 700; border-color: rgba(5, 150, 105, 0.55); color: #065f46; background: rgba(16, 185, 129, 0.1); display: inline-flex; align-items: center; gap: 3px;" title="Ver y gestionar el detalle de ventas Punto de Venta (POS) consideradas como abono en este periodo">
            <i class="ri-store-3-line" style="color: #059669;"></i> Ventas POS / Abono
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="window.openBulkEditOrdersModal()" style="height: 29px; padding: 0 0.65rem; font-size: 0.73rem; background: #5f06fa; border-color: #5f06fa; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" title="Editar masivamente pedidos filtrados o seleccionados">
            <i class="ri-edit-2-line"></i> Edición Masiva
          </button>
        </div>
      </div>

      <!-- Contenedor 1: Registro Editable tipo Excel -->
      <div id="bg-content-register" style="display: block;">
        <div class="card" style="padding: 0.6rem 0.75rem; margin-bottom: 1rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px;">
          <!-- Barra Unificada de Filtros Rápidos, Búsqueda Global y Conteo -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.45rem; background: var(--color-bg); padding: 0.35rem 0.65rem; border-radius: 7px; border: 1px solid var(--color-border);">
            <div style="display: flex; gap: 0.3rem; align-items: center; flex-wrap: wrap;">
              <span style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-main); margin-right: 4px; display: inline-flex; align-items: center; gap: 4px;" title="Registro Editable de Pedidos del Periodo — Edita libremente celdas de tarifas, recargos o fletes">
                <i class="ri-file-excel-line" style="color: #10b981; font-size: 0.9rem;"></i>
                <span style="color: var(--color-text-muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.3px;">Filtros:</span>
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
              <button type="button" class="bg-quick-filter-btn" id="qf-centro-envios" onclick="window.setBgQuickFilter('centro-envios')">
                Centro Envíos (<span id="qf-count-centro-envios">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-mkt" onclick="window.setBgQuickFilter('mkt')">
                Marketplace (<span id="qf-count-mkt">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-pos" onclick="window.setBgQuickFilter('pos')" style="border-color: rgba(14, 165, 233, 0.4); color: #0284c7;" title="Pedidos de Punto de Venta físico (Base $1.490 · Despacho $0)">
                <i class="ri-store-3-fill"></i> Punto de Venta (<span id="qf-count-pos">0</span>)
              </button>
            </div>

            <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
              <div style="position: relative;">
                <input type="text" id="bg-filter-order-input" class="form-input" placeholder="Búsqueda global..." style="height: 27px; font-size: 0.74rem; margin: 0; width: 175px; padding-left: 1.75rem; border-radius: 6px;" oninput="window.applyBgColumnFilters()">
                <i class="ri-search-line" style="position: absolute; left: 0.5rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); font-size: 0.8rem;"></i>
              </div>
              <span id="bg-filter-count-badge" style="font-size: 0.71rem; font-weight: 700; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 3px 7px; border-radius: 5px; white-space: nowrap;">
                Mostrando 0 de 0 pedidos
              </span>
              <button id="bg-btn-bulk-edit-filtered" class="btn btn-sm btn-outline" style="height: 27px; font-size: 0.71rem; padding: 0 7px; border-radius: 5px; border-color: #5f06fa; color: #5f06fa; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" onclick="window.openBulkEditOrdersModal('filtered')" title="Editar masivamente solo los pedidos visibles según filtros actuales">
                <i class="ri-edit-line"></i> Editar Filtrados
              </button>
              <button id="bg-btn-clear-all-filters" class="btn btn-sm btn-outline" style="height: 27px; font-size: 0.71rem; padding: 0 7px; border-radius: 5px; display: none; border-color: #cbd5e1;" onclick="window.clearBgTableFilters()">
                <i class="ri-filter-off-line"></i> Limpiar
              </button>
            </div>
          </div>

          <!-- Banner Informativo de Tienda Seleccionada (Holding) -->
          <div id="bg-store-active-filter-banner" style="display: none; margin-bottom: 0.5rem;"></div>

          <div class="bg-excel-table-container">
            <table class="bg-excel-table" id="bg-orders-excel-grid">
              <thead>
                <tr>
                  <th style="width: 42px; text-align: center;">
                    <input type="checkbox" id="bg-master-inclusion-checkbox" title="Marcar / Desmarcar todos los pedidos visibles" onchange="window.toggleAllVisibleOrdersInclusion(this.checked)" style="cursor: pointer; width: 15px; height: 15px; accent-color: #5f06fa;">
                  </th>
                  <th style="width: 42px; text-align: center;">N°</th>
                  <th style="min-width: 245px;">ID Pedido / Agenda</th>
                  <th style="width: 135px; min-width: 125px; text-align: center;">Categoría</th>
                  <th style="min-width: 215px;">Destino / Operador / Método</th>
                  <th style="width: 125px; text-align: right;">Ticket Venta ($)</th>
                  <th style="width: 175px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
                      <span>Tipo Entrega</span>
                      <button type="button" id="bg-th-btn-edit-delivery" onclick="window.openDeliveryTypesManagerModal()" title="Configurar y editar tipos de entrega" style="background: rgba(95,6,250,0.08); border: 1px solid rgba(95,6,250,0.25); border-radius: 4px; cursor: pointer; color: #5f06fa; font-size: 0.72rem; padding: 1px 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-settings-4-line"></i> Editar
                      </button>
                    </div>
                  </th>
                  <th style="width: 70px; min-width: 65px; text-align: center;">SKUs</th>
                  <th style="width: 70px; min-width: 65px; text-align: center;">Unid.</th>
                  <th style="width: 55px; text-align: center;">Mkt?</th>
                  <th style="width: 85px; text-align: right;">Base ($)</th>
                  <th style="width: 80px; text-align: right;">Rec. SKU</th>
                  <th style="width: 80px; text-align: right;">Rec. Unid</th>
                  <th style="width: 80px; text-align: right;">Rec. Mkt</th>
                  <th id="bg-th-prep-total" style="width: 105px; text-align: right;">
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                      <span>Prep. Total</span>
                      <button type="button" id="bg-th-btn-add-surcharge" onclick="window.openAddCustomColumnModal()" title="Añadir columna de recargo de preparación (por unidad o global)" style="background: rgba(234, 88, 12, 0.1); border: 1px solid rgba(234, 88, 12, 0.35); border-radius: 4px; cursor: pointer; color: #c2410c; font-size: 0.65rem; padding: 1px 5px; font-weight: 700; display: inline-flex; align-items: center; gap: 2px; white-space: nowrap;">
                        <i class="ri-add-line"></i> Recargo
                      </button>
                    </div>
                  </th>
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
                      <input type="text" id="bg-col-filter-order" class="bg-col-filter-input" placeholder="ID / Fecha..." oninput="window.applyBgColumnFilters()" style="flex: 1; min-width: 80px;">
                      <select id="bg-col-filter-store" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 125px; text-overflow: ellipsis; font-weight: 700; color: #5f06fa; ${billingState.isConglomerate ? '' : 'display: none;'}" title="Filtrar por tienda del conglomerado">
                        <option value="">Todas las Tiendas</option>
                      </select>
                      <select id="bg-col-filter-agenda" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 125px; text-overflow: ellipsis;" title="Filtrar por agenda específica o estado">
                        <option value="">Todas las Agendas</option>
                        <option value="empty">⚠️ Sin Agenda</option>
                        <option value="with">Con Agenda</option>
                      </select>
                    </div>
                  </th>
                  <th style="padding: 3px 4px; text-align: center;">
                    <select id="bg-col-filter-categoria" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 100%;" title="Filtrar por Categoría de Pedido">
                      <option value="">Todas las Categorías</option>
                    </select>
                  </th>
                  <th style="padding: 3px 6px;">
                    <input type="text" id="bg-col-filter-dest" class="bg-col-filter-input" placeholder="Comuna, Operador o Método..." oninput="window.applyBgColumnFilters()">
                  </th>
                  <th style="padding: 3px 3px; text-align: right;">
                    <div style="display: flex; gap: 3px; align-items: center;">
                      <input type="number" id="bg-col-filter-ticket-min" class="bg-col-filter-input" placeholder="Min $" style="width: 50%; min-width: 0; text-align: right; padding: 2px 4px; font-size: 0.7rem;" oninput="window.applyBgColumnFilters()" title="Filtrar por ticket de venta mínimo">
                      <span style="font-size: 0.65rem; color: #94a3b8; user-select: none;">-</span>
                      <input type="number" id="bg-col-filter-ticket-max" class="bg-col-filter-input" placeholder="Max $" style="width: 50%; min-width: 0; text-align: right; padding: 2px 4px; font-size: 0.7rem;" oninput="window.applyBgColumnFilters()" title="Filtrar por ticket de venta máximo">
                    </div>
                  </th>
                  <th style="padding: 3px 4px;">
                    <select id="bg-col-filter-delivery" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 100%;">
                      <option value="">Todos los tipos</option>
                    </select>
                  </th>
                  <th style="padding: 3px 3px; text-align: center;">
                    <input type="number" id="bg-col-filter-skus" class="bg-col-filter-input" placeholder="Min" style="width: 100%; text-align: center; padding: 2px 2px;" oninput="window.applyBgColumnFilters()">
                  </th>
                  <th style="padding: 3px 3px; text-align: center;">
                    <input type="number" id="bg-col-filter-units" class="bg-col-filter-input" placeholder="Min" style="width: 100%; text-align: center; padding: 2px 2px;" oninput="window.applyBgColumnFilters()">
                  </th>
                  <th style="padding: 3px 2px; text-align: center;">
                    <select id="bg-col-filter-mkt" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 100%;">
                      <option value="">Todos</option>
                      <option value="yes">Mkt</option>
                      <option value="no">No Mkt</option>
                    </select>
                  </th>
                  <th id="bg-filter-row-values-colspan" colspan="7" style="padding: 3px 6px; text-align: right; color: #94a3b8; font-size: 0.7rem; font-weight: 500;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                      <span id="bg-filter-row-values-label" style="font-size: 0.68rem; color: #64748b;"><i class="ri-edit-line"></i> Columnas de valores y recargos editables</span>
                      <button type="button" id="bg-th-btn-add-col-filter" onclick="window.openAddCustomColumnModal()" style="background: #fff7ed; border: 1px solid #fdba74; color: #c2410c; border-radius: 4px; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" title="Añadir nueva columna de cobro / recargo de preparación">
                        <i class="ri-add-circle-line"></i> + Columna Cobro
                      </button>
                    </div>
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
        <!-- Barra de herramientas para personalizar insumos, fechas y datos legales -->
        <div id="bg-desglose-top-toolbar" class="no-print" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 0.75rem 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; font-weight: 600; color: var(--color-text-main);">
            <i class="ri-file-list-3-line" style="color: #5f06fa; font-size: 1.2rem;"></i>
            <span>Desglose Oficial Stocka</span>
            <span style="color: var(--color-text-muted); font-size: 0.75rem; font-weight: 500;">(Puedes agregar/eliminar insumos, editar fechas y datos fiscales)</span>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline btn-sm" onclick="window.addNewManualSupplyRow()" style="display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; border-radius: 6px;">
              <i class="ri-box-3-line" style="color: #5f06fa;"></i> + Insumo / Caja
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick="window.addNewManualAdjustmentRow()" style="display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; border-radius: 6px;">
              <i class="ri-price-tag-3-line" style="color: #0284c7;"></i> + Ajuste Comercial
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick="window.addNewManualAbonoRow()" style="display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 6px; border-color: rgba(16, 185, 129, 0.5); color: #047857; background: rgba(16, 185, 129, 0.05);" title="Registrar abono comercial que descuenta directamente el monto a pagar por el cliente">
              <i class="ri-hand-coin-line" style="color: #10b981;"></i> + Registrar Abono
            </button>
            <button type="button" id="bg-btn-edit-desglose-header" class="btn btn-outline btn-sm" style="display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 700; border-color: rgba(95, 6, 250, 0.4); color: #5f06fa; border-radius: 6px;">
              <i class="ri-calendar-check-line"></i> Editar Fechas y Datos Legales
            </button>
          </div>
        </div>
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

      <!-- Contenedor 4: Checklist Global -->
      <div id="bg-content-checklist" style="display: none;">
        <div id="bg-checklist-container">
          <!-- Renderizado dinámico del Checklist Global -->
        </div>
      </div>

      <!-- Contenedor 5: Apartado de Apelaciones / Observaciones del Comercio -->
      <div id="bg-content-observations" style="display: none;">
        <div id="bg-observations-container">
          <!-- Renderizado dinámico de Apelaciones y Observaciones -->
        </div>
      </div>
      </div>
    </div>
  `;

  // Guardar metadatos para el Resumen del Periodo
  window.__bgOverviewMeta = {
    periods,
    comercios,
    conglomeratesMap,
    childToConglomerateMap,
    canonicalDisplayList,
    individualComerciosList
  };

  // Listeners del Resumen del Periodo
  document.getElementById('bg-overview-select-period')?.addEventListener('change', (e) => {
    const newPeriodId = e.target.value;
    const genSelect = document.getElementById('bg-select-period');
    if (genSelect && genSelect.value !== newPeriodId) {
      genSelect.value = newPeriodId;
    }
    loadAndRenderPeriodOverview();
  });

  document.getElementById('bg-btn-refresh-overview')?.addEventListener('click', () => {
    loadAndRenderPeriodOverview();
  });

  // Asignar listeners de eventos del Generador
  document.getElementById('bg-btn-config-delivery')?.addEventListener('click', () => {
    window.openDeliveryTypesManagerModal();
  });

  document.getElementById('bg-btn-edit-desglose-header')?.addEventListener('click', () => {
    openEditDesgloseHeaderModal();
  });

  document.getElementById('bg-btn-recalculate')?.addEventListener('click', async () => {
    const commerceSelect = document.getElementById('bg-select-commerce');
    if (!commerceSelect || !commerceSelect.value) {
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'info',
          title: 'Selecciona un comercio',
          text: 'Elige primero un comercio o holding de la lista para calcular su facturación.',
          showConfirmButton: false,
          timer: 3000
        });
      }
      commerceSelect?.focus();
      return;
    }

    if (guardBillingLocked('recalcular un periodo cerrado')) return;

    const b = billingState;
    const hasData = b.currentCommerce === commerceSelect.value && ((b.orders && b.orders.length > 0) || b.isSaved);

    if (hasData && typeof Swal !== 'undefined') {
      const result = await Swal.fire({
        title: 'Actualizar Facturación desde WMS',
        html: `
          <div style="text-align: left; font-size: 0.88rem; color: #334155; line-height: 1.5;">
            <p style="margin-bottom: 0.85rem;">¿Cómo deseas recalcular la facturación de <strong>${escapeHtml(b.currentCommerce || 'este comercio')}</strong>?</p>
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.85rem; margin-bottom: 0.65rem;">
              <strong style="color: #5f06fa; display: flex; align-items: center; gap: 5px; font-size: 0.95rem;">
                <i class="ri-refresh-line"></i> Actualizar manteniendo cambios
              </strong>
              <div style="font-size: 0.785rem; color: #64748b; margin-top: 4px;">
                Recalcula con los datos más recientes de pedidos y tarifas, pero <strong>conserva tus ediciones manuales</strong> (tipos de despacho editados, insumos, abonos, ajustes y fechas).
              </div>
            </div>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 0.85rem;">
              <strong style="color: #dc2626; display: flex; align-items: center; gap: 5px; font-size: 0.95rem;">
                <i class="ri-restart-line"></i> Restablecer a valores iniciales
              </strong>
              <div style="font-size: 0.785rem; color: #64748b; margin-top: 4px;">
                Descarta todas las modificaciones manuales y vuelve a calcular todo automáticamente desde cero según los datos originales de la BD.
              </div>
            </div>
          </div>
        `,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonColor: '#5f06fa',
        denyButtonColor: '#dc2626',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: '<i class="ri-check-line"></i> Mantener mis cambios',
        denyButtonText: '<i class="ri-restart-line"></i> Restablecer desde cero',
        cancelButtonText: 'Cancelar'
      });

      if (result.isConfirmed) {
        executeCalculationFromUI({ forceFresh: false, forceRecalculateFromDB: true });
      } else if (result.isDenied) {
        executeCalculationFromUI({ forceFresh: true, forceRecalculateFromDB: true });
      }
    } else {
      executeCalculationFromUI({ forceRecalculateFromDB: true });
    }
  });

  document.getElementById('bg-select-commerce')?.addEventListener('change', (e) => {
    if (!e.target.value) {
      renderGeneratorEmptyCommerceState();
      return;
    }
    executeCalculationFromUI();
  });

  document.getElementById('bg-select-period')?.addEventListener('change', (e) => {
    const ovSelect = document.getElementById('bg-overview-select-period');
    if (ovSelect && ovSelect.value !== e.target.value) {
      ovSelect.value = e.target.value;
    }
    const commerceSelect = document.getElementById('bg-select-commerce');
    if (commerceSelect && commerceSelect.value) {
      executeCalculationFromUI();
    } else {
      billingState.currentPeriodId = e.target.value;
    }
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

  document.getElementById('bg-btn-publish-record')?.addEventListener('click', () => {
    confirmAndPublishBillingToCommerce();
  });

  // Si se ingresó con un comercio específico, ir directo al generador; de lo contrario dejar estado vacío en generador y mostrar Resumen del Periodo
  if (startInGenerator) {
    await executeCalculationFromUI();
    loadAndRenderPeriodOverview({ silentBadgeOnly: true });
  } else {
    renderGeneratorEmptyCommerceState();
    await loadAndRenderPeriodOverview();
  }
};

// Renderizar estado vacío limpio en el Generador cuando aún no se ha seleccionado ningún comercio
export function renderGeneratorEmptyCommerceState() {
  billingState.currentCommerce = '';
  billingState.orders = [];
  billingState.isManualVolume = false;
  billingState.autoVolumeM3 = 0;
  billingState.autoVolumeDaysLogged = 0;
  billingState.autoDailyStorageLogs = [];
  billingState.volumeSessionKey = '';
  billingState.isConglomerate = false;
  billingState.conglomerateName = null;
  billingState.conglomerateChildren = [];
  billingState.storeBreakdown = [];
  billingState.activeConglomerateStoreFilter = null;
  billingState.isSaved = false;
  billingState.isPublished = false;
  billingState.isPaid = false;
  billingState.isLocked = false;
  billingState.paymentStatus = 'Por solicitar';
  billingState.loadedFromSnapshot = false;
  billingState.commerceObservations = [];

  if (typeof renderLockStatusBannerAndSyncToolbarUI === 'function') {
    renderLockStatusBannerAndSyncToolbarUI();
  }

  const obsAlertBanner = document.getElementById('bg-commerce-observations-alert-banner');
  if (obsAlertBanner) {
    obsAlertBanner.style.display = 'none';
    obsAlertBanner.innerHTML = '';
  }
  const obsNavBadge = document.getElementById('bg-observations-nav-badge');
  if (obsNavBadge) {
    obsNavBadge.style.display = 'none';
  }

  const congBanner = document.getElementById('bg-conglomerate-banner-container');
  if (congBanner) congBanner.innerHTML = '';

  const storeBanner = document.getElementById('bg-store-active-filter-banner');
  if (storeBanner) {
    storeBanner.style.display = 'none';
    storeBanner.innerHTML = '';
  }

  const kpisCont = document.getElementById('bg-kpis-container');
  if (kpisCont) {
    kpisCont.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 1.75rem 1.5rem; color: var(--color-text-muted); background: var(--color-surface); border: 1px dashed rgba(95, 6, 250, 0.35); border-radius: 12px;">
        <i class="ri-store-2-line" style="font-size: 2rem; color: #5f06fa; display: inline-block; margin-bottom: 0.35rem;"></i>
        <div style="font-weight: 800; color: var(--color-text-main); font-size: 0.98rem;">Selecciona un comercio desde la lista superior</div>
        <div style="font-size: 0.82rem; margin-top: 0.2rem;">Elige un comercio o holding en <strong>"COMERCIO A FACTURAR"</strong> para cargar sus pedidos, tarifas y desglose sin esperas innecesarias.</div>
      </div>
    `;
  }

  const ordersTbody = document.getElementById('bg-orders-table-body');
  if (ordersTbody) {
    ordersTbody.innerHTML = `
      <tr>
        <td colspan="30" style="text-align: center; padding: 3.5rem 1.5rem; color: var(--color-text-muted);">
          <i class="ri-cursor-line" style="font-size: 2.2rem; color: #5f06fa; display: inline-block; margin-bottom: 0.5rem;"></i>
          <div style="font-weight: 800; color: var(--color-text-main); font-size: 0.95rem;">Ningún comercio seleccionado</div>
          <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.25rem;">Selecciona un comercio en el selector superior para consultar sus pedidos y calcular la facturación.</div>
        </td>
      </tr>
    `;
  }

  if (typeof updateQuickPillCounts === 'function') {
    updateQuickPillCounts([]);
  }
  const countBadge = document.getElementById('bg-filter-count-badge');
  if (countBadge) {
    countBadge.textContent = 'Mostrando 0 de 0 pedidos';
  }

  const emptySectionHTML = `
    <div style="text-align: center; padding: 3.5rem 1.5rem; background: var(--color-surface); border: 1px dashed rgba(95, 6, 250, 0.35); border-radius: 12px; color: var(--color-text-muted);">
      <i class="ri-store-2-line" style="font-size: 2.2rem; color: #5f06fa; display: inline-block; margin-bottom: 0.5rem;"></i>
      <div style="font-weight: 800; color: var(--color-text-main); font-size: 0.98rem;">Selecciona un comercio en la barra superior</div>
      <div style="font-size: 0.82rem; margin-top: 0.25rem;">Una vez seleccionado el comercio, aquí se generará su información detallada.</div>
    </div>
  `;

  const desgloseCont = document.getElementById('bg-desglose-view-container');
  if (desgloseCont) desgloseCont.innerHTML = emptySectionHTML;

  const analyticsCont = document.getElementById('bg-analytics-container');
  if (analyticsCont) analyticsCont.innerHTML = emptySectionHTML;

  const obsCont = document.getElementById('bg-observations-container');
  if (obsCont) obsCont.innerHTML = emptySectionHTML;
}

// Alternar entre la Vista Resumen del Periodo y el Generador de Desgloses
window.switchBgMainMode = async function(mode = 'overview', commerceName = null, periodId = null) {
  const overviewWrapper = document.getElementById('bg-period-overview-wrapper');
  const generatorWrapper = document.getElementById('bg-generator-workspace-wrapper');
  if (!overviewWrapper || !generatorWrapper) return;

  if (mode === 'overview') {
    generatorWrapper.style.display = 'none';
    overviewWrapper.style.display = 'block';
    const genPeriod = document.getElementById('bg-select-period')?.value;
    const ovSelect = document.getElementById('bg-overview-select-period');
    if (ovSelect && genPeriod && ovSelect.value !== genPeriod) {
      ovSelect.value = genPeriod;
    }
    await loadAndRenderPeriodOverview();
    return;
  }

  // Modo 'generator'
  overviewWrapper.style.display = 'none';
  generatorWrapper.style.display = 'block';

  const genPeriodSelect = document.getElementById('bg-select-period');
  const ovPeriodSelect = document.getElementById('bg-overview-select-period');
  const targetPeriodId = periodId || ovPeriodSelect?.value || genPeriodSelect?.value;
  if (genPeriodSelect && targetPeriodId && genPeriodSelect.value !== targetPeriodId) {
    genPeriodSelect.value = targetPeriodId;
  }

  const commerceSelect = document.getElementById('bg-select-commerce');
  let targetCommerce = commerceName;
  if (commerceSelect && targetCommerce) {
    const cleanTarget = String(targetCommerce).trim().toUpperCase();
    let matchedValue = null;
    for (let i = 0; i < commerceSelect.options.length; i++) {
      const optVal = String(commerceSelect.options[i].value || '').trim().toUpperCase();
      if (!optVal) continue;
      if (optVal === cleanTarget || (cleanTarget.includes('BIG BANG') && optVal === 'BIG BANG') || (cleanTarget.includes('SILVER FOX') && optVal === 'SILVER FOX')) {
        matchedValue = commerceSelect.options[i].value;
        break;
      }
    }
    if (!matchedValue) {
      const newOpt = document.createElement('option');
      newOpt.value = targetCommerce;
      newOpt.textContent = targetCommerce;
      commerceSelect.insertBefore(newOpt, commerceSelect.firstChild);
      matchedValue = targetCommerce;
    }
    commerceSelect.value = matchedValue;
  }

  const currentSelectComm = commerceSelect?.value || '';
  const currentSelectPeriod = genPeriodSelect?.value || '';

  if (!currentSelectComm) {
    renderGeneratorEmptyCommerceState();
    commerceSelect?.focus();
    return;
  }

  const needsRecalc = Boolean(commerceName) ||
    !billingState.currentCommerce ||
    billingState.currentCommerce !== currentSelectComm ||
    billingState.currentPeriodId !== currentSelectPeriod;

  if (needsRecalc) {
    await executeCalculationFromUI();
  } else if (typeof loadAndRenderCommerceObservationsUI === 'function') {
    await loadAndRenderCommerceObservationsUI();
  }
};

window.openBillingGeneratorFromOverview = async function(commerceName, periodId = null, targetSubTab = null) {
  await window.switchBgMainMode('generator', commerceName, periodId);
  if (targetSubTab && typeof window.switchBgSubTab === 'function') {
    window.switchBgSubTab(targetSubTab);
  }
};

// Cargar y renderizar la Vista Resumen del Periodo Actual en el Gestor de Facturación
export async function loadAndRenderPeriodOverview(options = {}) {
  const { silentBadgeOnly = false } = options;
  const ovSelect = document.getElementById('bg-overview-select-period') || document.getElementById('bg-select-period');
  if (!ovSelect) return;

  const periodId = ovSelect.value;
  const selectedOpt = ovSelect.selectedIndex >= 0 ? ovSelect.options[ovSelect.selectedIndex] : null;
  const periodName = (selectedOpt && selectedOpt.getAttribute('data-name')) || selectedOpt?.text?.replace(/\s*\(Activo\)\s*$/i, '') || 'PERIODO ACTUAL';

  const badgeEl = document.getElementById('bg-overview-period-badge');
  if (badgeEl) badgeEl.textContent = periodName;

  const bodyEl = document.getElementById('bg-period-overview-body');
  const refreshBtn = document.getElementById('bg-btn-refresh-overview');
  if (!silentBadgeOnly && refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Actualizando...';
  }
  if (!silentBadgeOnly && bodyEl && !bodyEl.querySelector('.bg-overview-loaded-root')) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 3.5rem 2rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-text-muted);">
        <i class="ri-loader-4-line ri-spin" style="font-size: 2.1rem; color: #5f06fa; display: inline-block; margin-bottom: 0.5rem;"></i>
        <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.95rem;">Consultando resumen de <strong>${escapeHtml(periodName)}</strong>...</div>
        <div style="font-size: 0.78rem; margin-top: 0.2rem;">Obteniendo desgloses emitidos, borradores y pedidos asignados al periodo.</div>
      </div>
    `;
  }

  try {
    const meta = window.__bgOverviewMeta || {};
    const conglomeratesMap = meta.conglomeratesMap || {};
    const childToConglomerateMap = meta.childToConglomerateMap || {};
    const canonicalDisplayList = meta.canonicalDisplayList || [];

    // 1. Consultar billing_records del periodo y conteo de pedidos asignados al periodo en paralelo
    const fetchOrdersByPeriod = async () => {
      let allOrders = [];
      let page = 0;
      const step = 1000;
      let lastCreatedAt = null;
      const seenIds = new Set();

      while (page < 20) {
        page++;
        let q = supabase
          .from('orders')
          .select('id, created_at, comercio')
          .eq('periodo_facturacion', periodName)
          .order('created_at', { ascending: false })
          .limit(step);

        if (lastCreatedAt) q = q.lte('created_at', lastCreatedAt);
        const { data, error } = await q;
        if (error || !data || data.length === 0) break;
        const fresh = data.filter(o => !seenIds.has(o.id));
        if (fresh.length === 0) break;
        fresh.forEach(o => seenIds.add(o.id));
        allOrders = allOrders.concat(fresh);
        if (data.length < step) break;
        lastCreatedAt = data[data.length - 1].created_at;
      }
      return allOrders;
    };

    const [recordsRes, periodOrders, obsRecordsRes] = await Promise.all([
      supabase.from('billing_records').select('*').eq('period_id', periodId).order('comercio', { ascending: true }),
      fetchOrdersByPeriod(),
      supabase
        .from('billing_records')
        .select('id, comercio, period_id, client_observation, observation_status, admin_response, observation_updated_at, client_observation_enviame, observation_status_enviame, admin_response_enviame, observation_updated_at_enviame, updated_at, billing_periods(name)')
        .or('client_observation.not.is.null,client_observation_enviame.not.is.null,observation_status.eq.pendiente,observation_status_enviame.eq.pendiente')
    ]);

    const records = recordsRes.data || [];
    const obsRecords = obsRecordsRes?.data || [];

    // Normalizador de nombre de comercio hacia cuenta de facturación (holding si aplica)
    const normalizeToBillingEntity = (rawName) => {
      const clean = String(rawName || '').trim();
      const upper = clean.toUpperCase();
      if (!upper) return '';
      if (upper === 'BIG BANG' || upper === 'BIG BANG SPA' || upper.includes('BIG BANG')) return 'BIG BANG';
      if (upper === 'SILVER FOX' || upper === 'SILVER FOX SPA' || upper.includes('SILVER FOX')) return 'SILVER FOX';
      if (childToConglomerateMap[upper]) {
        const mapped = String(childToConglomerateMap[upper]).trim().toUpperCase();
        if (mapped.includes('BIG BANG')) return 'BIG BANG';
        if (mapped.includes('SILVER FOX')) return 'SILVER FOX';
        return mapped;
      }
      return clean;
    };

    // Mapear apelaciones / observaciones por comercio o holding
    const unansweredObsByEntity = {};
    const totalObsByEntity = {};
    let totalUnansweredObservations = 0;

    obsRecords.forEach(r => {
      const entityName = normalizeToBillingEntity(r.comercio);
      const entityKey = entityName.toUpperCase();
      if (!entityKey) return;
      const pName = r.billing_periods?.name || 'Periodo';

      // Fulfillment observation
      const fClient = String(r.client_observation || '').trim();
      const fAdmin = String(r.admin_response || '').trim();
      const fStatus = r.observation_status || 'sin_observacion';
      const hasFulfillmentObs = fStatus === 'pendiente' || fStatus === 'respondida' || Boolean(fClient) || Boolean(fAdmin);
      if (hasFulfillmentObs) {
        totalObsByEntity[entityKey] = (totalObsByEntity[entityKey] || 0) + 1;
        const isUnanswered = fStatus === 'pendiente' || (Boolean(fClient) && !Boolean(fAdmin) && fStatus !== 'sin_observacion');
        if (isUnanswered) {
          if (!unansweredObsByEntity[entityKey]) unansweredObsByEntity[entityKey] = [];
          unansweredObsByEntity[entityKey].push({
            key: `${r.id}_fulfillment`,
            recordId: r.id,
            comercio: r.comercio,
            periodName: pName,
            serviceLabel: 'Fulfillment',
            clientObservation: fClient || '(Apelación marcada pendiente)',
            updatedAt: r.observation_updated_at || r.updated_at
          });
          totalUnansweredObservations++;
        }
      }

      // Envíame observation
      const eClient = String(r.client_observation_enviame || '').trim();
      const eAdmin = String(r.admin_response_enviame || '').trim();
      const eStatus = r.observation_status_enviame || 'sin_observacion';
      const hasEnviameObs = eStatus === 'pendiente' || eStatus === 'respondida' || Boolean(eClient) || Boolean(eAdmin);
      if (hasEnviameObs) {
        totalObsByEntity[entityKey] = (totalObsByEntity[entityKey] || 0) + 1;
        const isUnanswered = eStatus === 'pendiente' || (Boolean(eClient) && !Boolean(eAdmin) && eStatus !== 'sin_observacion');
        if (isUnanswered) {
          if (!unansweredObsByEntity[entityKey]) unansweredObsByEntity[entityKey] = [];
          unansweredObsByEntity[entityKey].push({
            key: `${r.id}_enviame`,
            recordId: r.id,
            comercio: r.comercio,
            periodName: pName,
            serviceLabel: 'Envíame',
            clientObservation: eClient || '(Apelación marcada pendiente)',
            updatedAt: r.observation_updated_at_enviame || r.updated_at
          });
          totalUnansweredObservations++;
        }
      }
    });

    // Sincronizar indicadores 🚨 en el selector <select id="bg-select-commerce">
    const genCommSelect = document.getElementById('bg-select-commerce');
    if (genCommSelect) {
      Array.from(genCommSelect.options).forEach(opt => {
        const val = String(opt.value || '').trim();
        if (!val) return;
        if (!opt.getAttribute('data-base-label')) {
          opt.setAttribute('data-base-label', opt.textContent.replace(/^🚨\s*/, '').replace(/\s*·\s*\d+\s*apelaci[oó]n.*$/i, '').trim());
        }
        const baseLabel = opt.getAttribute('data-base-label') || opt.textContent;
        const entityKey = normalizeToBillingEntity(val).toUpperCase();
        const unansList = unansweredObsByEntity[entityKey] || unansweredObsByEntity[val.toUpperCase()] || [];
        if (unansList.length > 0) {
          opt.textContent = `🚨 ${baseLabel} · ${unansList.length} apelación${unansList.length === 1 ? '' : 'es'} sin resp.`;
        } else {
          opt.textContent = baseLabel;
        }
      });
    }

    // Contar pedidos por comercio y por tienda hija
    const ordersCountByEntity = {};
    const childOrdersBreakdownByEntity = {};
    let totalPeriodOrdersCount = 0;

    (periodOrders || []).forEach(ord => {
      const rawStore = String(ord.comercio || '').trim();
      if (!rawStore) return;
      totalPeriodOrdersCount++;
      const entity = normalizeToBillingEntity(rawStore);
      const entityKey = entity.toUpperCase();
      ordersCountByEntity[entityKey] = (ordersCountByEntity[entityKey] || 0) + 1;

      if (entityKey !== rawStore.toUpperCase()) {
        if (!childOrdersBreakdownByEntity[entityKey]) childOrdersBreakdownByEntity[entityKey] = {};
        const childKey = rawStore.toUpperCase();
        childOrdersBreakdownByEntity[entityKey][childKey] = (childOrdersBreakdownByEntity[entityKey][childKey] || 0) + 1;
      }
    });

    // Unificar registros de billing_records y comercios con pedidos en el periodo
    const entityMap = new Map();

    records.forEach(r => {
      const entityName = normalizeToBillingEntity(r.comercio);
      const key = entityName.toUpperCase();
      if (!key) return;

      const existing = entityMap.get(key);
      // Si hubiera duplicado (ej. BIG BANG y BIG BANG SPA), priorizar el que tenga total_fulfillment > 0 o desglose emitido
      if (!existing || ((r.total_fulfillment || 0) > (existing.record?.total_fulfillment || 0)) || r.desglose_fulfillment === 'Enviado') {
        entityMap.set(key, {
          key,
          comercio: entityName,
          rawComercioRecord: r.comercio,
          record: r
        });
      }
    });

    // Agregar también cualquier comercio/holding que tenga pedidos en el periodo o apelaciones sin respuesta aunque aún no tenga fila en billing_records
    Object.keys(ordersCountByEntity).forEach(entityKey => {
      if (!entityMap.has(entityKey)) {
        entityMap.set(entityKey, {
          key: entityKey,
          comercio: entityKey,
          rawComercioRecord: entityKey,
          record: null
        });
      }
    });
    Object.keys(unansweredObsByEntity).forEach(entityKey => {
      if (!entityMap.has(entityKey)) {
        entityMap.set(entityKey, {
          key: entityKey,
          comercio: entityKey,
          rawComercioRecord: entityKey,
          record: null
        });
      }
    });

    // Construir lista enriquecida de ítems del periodo
    const items = Array.from(entityMap.values()).map(entry => {
      const r = entry.record;
      const entityKey = entry.key;
      const ordersCount = ordersCountByEntity[entityKey] || 0;
      const childBreakdownObj = childOrdersBreakdownByEntity[entityKey] || null;
      const unansweredObservationsList = unansweredObsByEntity[entityKey] || [];
      const unansweredObservationsCount = unansweredObservationsList.length;
      const totalObservationsCount = totalObsByEntity[entityKey] || 0;

      // Verificar si es un holding/conglomerado
      const congMatch = canonicalDisplayList.find(cg => String(cg.name).trim().toUpperCase() === entityKey);
      const isConglomerate = Boolean(congMatch || entityKey === 'BIG BANG' || entityKey === 'SILVER FOX' || conglomeratesMap[entityKey]);
      const conglomerateChildren = congMatch?.children || conglomeratesMap[entityKey] || [];

      // Verificar si tiene snapshot local en borrador
      let localDraft = null;
      try {
        const localStr = localStorage.getItem(`stocka_fulfillment_details_${periodId}_${entry.comercio}`) ||
                         (entry.rawComercioRecord ? localStorage.getItem(`stocka_fulfillment_details_${periodId}_${entry.rawComercioRecord}`) : null);
        if (localStr) localDraft = JSON.parse(localStr);
      } catch (e) {}

      const rawDesglose = String(r?.desglose_fulfillment || 'Por Generar').trim();
      const rawPago = String(r?.pago_fulfillment || 'Por solicitar').trim();
      const rawFactura = String(r?.factura_fulfillment || 'Esperando').trim();
      const totalFulfillment = Math.round(Number(r?.total_fulfillment) || Number(localDraft?.totals?.totalGross) || 0);
      const isSettledByStatus = rawPago.toLowerCase() === 'recibido' || rawPago.toLowerCase() === 'aprobado' || rawDesglose.toLowerCase() === 'aprobado';
      const abonoFulfillment = isSettledByStatus
        ? totalFulfillment
        : Math.round(Number(r?.abono_fulfillment) || Number(localDraft?.totals?.totalAbonos) || 0);
      const saldoFulfillment = Math.max(0, totalFulfillment - abonoFulfillment);
      const hasSnapshotLink = Boolean(r?.fulfillment_link || localDraft);

      // Clasificar estado del desglose: 'issued' (Emitido/Enviado/Aprobado), 'draft' (Creado/Borrador), 'exempt' (No se factura / Sin movimientos), 'pending' (Por Generar)
      let statusCategory = 'pending';
      let statusLabel = 'Por Generar';
      if (rawDesglose === 'Enviado' || rawDesglose === 'Publicado' || rawDesglose === 'Aprobado') {
        statusCategory = 'issued';
        statusLabel = rawDesglose === 'Aprobado' ? 'Aprobado' : 'Emitido / Publicado';
      } else if (rawDesglose === 'Creado') {
        statusCategory = 'draft';
        statusLabel = 'Borrador Guardado';
      } else if (rawDesglose === 'No se factura' || (rawPago === 'Sin movimientos' && ordersCount === 0 && totalFulfillment === 0)) {
        statusCategory = 'exempt';
        statusLabel = rawDesglose === 'No se factura' ? 'No se factura' : 'Sin movimientos';
      } else {
        statusCategory = 'pending';
        statusLabel = 'Por Generar';
      }

      return {
        key: entityKey,
        comercio: entry.comercio,
        recordId: r?.id || null,
        isConglomerate,
        conglomerateChildren,
        childBreakdownObj,
        ordersCount,
        statusCategory,
        statusLabel,
        rawDesglose,
        rawPago,
        rawFactura,
        totalFulfillment,
        abonoFulfillment,
        saldoFulfillment,
        hasSnapshotLink,
        updatedAt: r?.updated_at || localDraft?.generatedAt || null,
        lastNotifiedAt: r?.last_notified_at || null,
        unansweredObservationsCount,
        unansweredObservationsList,
        totalObservationsCount
      };
    });

    // Ordenar: primero borradores y pendientes con pedidos, luego emitidos por monto descendente, luego el resto alfabéticamente
    items.sort((a, b) => {
      const rank = (it) => {
        if (it.statusCategory === 'draft') return 1;
        if (it.statusCategory === 'pending' && it.ordersCount > 0) return 2;
        if (it.statusCategory === 'issued') return 3;
        if (it.statusCategory === 'pending') return 4;
        return 5;
      };
      const rA = rank(a);
      const rB = rank(b);
      if (rA !== rB) return rA - rB;
      if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
      if (b.totalFulfillment !== a.totalFulfillment) return b.totalFulfillment - a.totalFulfillment;
      return a.comercio.localeCompare(b.comercio, 'es');
    });

    // Calcular métricas globales del periodo
    const issuedItems = items.filter(i => i.statusCategory === 'issued');
    const draftItems = items.filter(i => i.statusCategory === 'draft');
    const pendingItems = items.filter(i => i.statusCategory === 'pending');
    const pendingWithOrdersItems = pendingItems.filter(i => i.ordersCount > 0);
    const exemptItems = items.filter(i => i.statusCategory === 'exempt');
    const withUnansweredObsItems = items.filter(i => (i.unansweredObservationsCount || 0) > 0);

    const totalGrossAll = items.reduce((acc, i) => acc + i.totalFulfillment, 0);
    const totalNetAll = Math.round(totalGrossAll / 1.19);
    const totalGrossIssued = issuedItems.reduce((acc, i) => acc + i.totalFulfillment, 0);
    const totalGrossDraft = draftItems.reduce((acc, i) => acc + i.totalFulfillment, 0);
    const totalAbonosAll = items.reduce((acc, i) => acc + i.abonoFulfillment, 0);
    const totalSaldoAll = items.reduce((acc, i) => acc + i.saldoFulfillment, 0);

    const actionableTotal = issuedItems.length + draftItems.length + pendingItems.length;
    const completedCount = issuedItems.length;
    const generatedOrIssuedCount = issuedItems.length + draftItems.length;
    const progressPct = actionableTotal > 0 ? Math.round((completedCount / actionableTotal) * 100) : 0;

    // Actualizar badge en el botón "<- Resumen del Periodo" dentro del Generador
    const pendingBadgeEl = document.getElementById('bg-btn-overview-pending-badge');
    const urgentPendingCount = pendingItems.length + draftItems.length;
    if (pendingBadgeEl) {
      if (urgentPendingCount > 0) {
        pendingBadgeEl.textContent = `${urgentPendingCount} pend.`;
        pendingBadgeEl.style.display = 'inline-block';
      } else {
        pendingBadgeEl.style.display = 'none';
      }
    }

    window.__bgOverviewLastState = {
      periodId,
      periodName,
      items,
      issuedItems,
      draftItems,
      pendingItems,
      pendingWithOrdersItems,
      exemptItems,
      withUnansweredObsItems,
      totalUnansweredObservations,
      totalGrossAll,
      totalNetAll,
      totalGrossIssued,
      totalGrossDraft,
      totalAbonosAll,
      totalSaldoAll,
      totalPeriodOrdersCount,
      actionableTotal,
      completedCount,
      generatedOrIssuedCount,
      progressPct
    };

    if (!silentBadgeOnly) {
      renderPeriodOverviewDOM();
    }
  } catch (err) {
    console.error('Error cargando resumen del periodo en Gestor de Facturación:', err);
    if (!silentBadgeOnly && bodyEl) {
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; color: #b91c1c;">
          <i class="ri-error-warning-line" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
          <strong>No se pudo cargar el resumen del periodo</strong>
          <div style="font-size: 0.82rem; margin-top: 0.25rem;">${escapeHtml(err.message || 'Error inesperado')}</div>
          <button type="button" class="btn btn-sm btn-primary" onclick="window.loadAndRenderPeriodOverview()" style="margin-top: 0.85rem; background: #5f06fa; border-color: #5f06fa;">
            <i class="ri-refresh-line"></i> Reintentar
          </button>
        </div>
      `;
    }
  } finally {
    if (!silentBadgeOnly && refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="ri-refresh-line"></i> Actualizar';
    }
  }
}
window.loadAndRenderPeriodOverview = loadAndRenderPeriodOverview;

window.bgOverviewActiveFilter = 'all'; // 'all' | 'pending' | 'draft' | 'issued' | 'exempt'
window.bgOverviewSearchQuery = '';

export function renderPeriodOverviewDOM() {
  const bodyEl = document.getElementById('bg-period-overview-body');
  const st = window.__bgOverviewLastState;
  if (!bodyEl || !st) return;

  const activeFilter = window.bgOverviewActiveFilter || 'all';
  const searchQuery = String(window.bgOverviewSearchQuery || '').trim().toLowerCase();

  // Cola prioritaria de comercios pendientes de generar o en borrador por publicar
  const workQueueItems = st.items.filter(i => i.statusCategory === 'draft' || i.statusCategory === 'pending');

  // Filtrar tabla general
  const filteredTableItems = st.items.filter(item => {
    if (activeFilter === 'pending' && item.statusCategory !== 'pending') return false;
    if (activeFilter === 'draft' && item.statusCategory !== 'draft') return false;
    if (activeFilter === 'issued' && item.statusCategory !== 'issued') return false;
    if (activeFilter === 'exempt' && item.statusCategory !== 'exempt') return false;
    if (activeFilter === 'observations' && (item.unansweredObservationsCount || 0) === 0) return false;
    if (searchQuery) {
      const matchName = item.comercio.toLowerCase().includes(searchQuery);
      const matchChild = (item.conglomerateChildren || []).some(c => String(c).toLowerCase().includes(searchQuery));
      if (!matchName && !matchChild) return false;
    }
    return true;
  });

  const filteredOrdersSum = filteredTableItems.reduce((acc, i) => acc + i.ordersCount, 0);
  const filteredGrossSum = filteredTableItems.reduce((acc, i) => acc + i.totalFulfillment, 0);
  const filteredAbonoSum = filteredTableItems.reduce((acc, i) => acc + i.abonoFulfillment, 0);
  const filteredSaldoSum = filteredTableItems.reduce((acc, i) => acc + i.saldoFulfillment, 0);

  const getStatusBadgeHTML = (item) => {
    if (item.statusCategory === 'issued') {
      return `<span style="display: inline-flex; align-items: center; gap: 4px; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-size: 0.72rem; font-weight: 800; padding: 3px 8px; border-radius: 999px;"><i class="ri-checkbox-circle-fill"></i> Emitido / Publicado</span>`;
    }
    if (item.statusCategory === 'draft') {
      return `<span style="display: inline-flex; align-items: center; gap: 4px; background: #ede9fe; color: #5b21b6; border: 1px solid #ddd6fe; font-size: 0.72rem; font-weight: 800; padding: 3px 8px; border-radius: 999px;"><i class="ri-draft-line"></i> Borrador (Creado)</span>`;
    }
    if (item.statusCategory === 'exempt') {
      return `<span style="display: inline-flex; align-items: center; gap: 4px; background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 999px;"><i class="ri-forbid-line"></i> ${escapeHtml(item.statusLabel)}</span>`;
    }
    return `<span style="display: inline-flex; align-items: center; gap: 4px; background: #fef3c7; color: #b45309; border: 1px solid #fde68a; font-size: 0.72rem; font-weight: 800; padding: 3px 8px; border-radius: 999px;"><i class="ri-time-line"></i> Por Generar</span>`;
  };

  bodyEl.innerHTML = `
    <div class="bg-overview-loaded-root">
      ${(st.withUnansweredObsItems && st.withUnansweredObsItems.length > 0) ? `
        <!-- Banner Global de Alerta: Apelaciones / Observaciones de Facturación sin Respuesta -->
        <div style="background: linear-gradient(135deg, #fef2f2 0%, #fff1f2 100%); border: 1.5px solid #ef4444; border-left: 5px solid #dc2626; border-radius: 11px; padding: 0.85rem 1.15rem; margin-bottom: 1.15rem; box-shadow: 0 3px 10px rgba(239, 68, 68, 0.12);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.75rem;">
            <div style="flex: 1; min-width: 280px;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem;">
                <span style="background: #dc2626; color: #ffffff; font-size: 0.7rem; font-weight: 900; padding: 2px 8px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.3px;">
                  <i class="ri-alarm-warning-fill"></i> Alerta de Apelaciones sin Respuesta
                </span>
                <strong style="font-size: 0.9rem; color: #991b1b;">
                  Existen ${st.totalUnansweredObservations} observación(es) / apelación(es) pendiente(s) en ${st.withUnansweredObsItems.length} comercio(s)
                </strong>
              </div>
              <div style="font-size: 0.78rem; color: #7f1d1d; margin-bottom: 0.55rem;">
                Haz clic en cualquier comercio afectado para revisar sus observaciones y <strong>aplicarlas como saldo a favor o ajuste en el desglose del periodo en curso (${escapeHtml(st.periodName)})</strong>:
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 0.45rem;">
                ${st.withUnansweredObsItems.map(it => {
                  const firstObs = (it.unansweredObservationsList || [])[0];
                  const tooltip = (it.unansweredObservationsList || [])
                    .map(o => `[${o.periodName} · ${o.serviceLabel}] ${o.clientObservation}`)
                    .join(' | ');
                  return `
                    <button type="button"
                            onclick="window.openBillingGeneratorFromOverview('${escapeHtml(it.comercio)}', '${escapeHtml(st.periodId)}', 'observations')"
                            title="${escapeHtml(tooltip)}"
                            style="background: #ffffff; border: 1.5px solid #fca5a5; color: #b91c1c; border-radius: 8px; padding: 4px 10px; font-size: 0.75rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                      <i class="ri-question-answer-fill" style="color: #dc2626;"></i>
                      <span>${it.isConglomerate ? '🏢 ' : ''}${escapeHtml(it.comercio)}</span>
                      <span style="background: #fee2e2; color: #991b1b; padding: 1px 6px; border-radius: 999px; font-size: 0.68rem; font-weight: 900;">
                        ${it.unansweredObservationsCount} sin resp.${firstObs ? ` (${escapeHtml(firstObs.periodName)})` : ''}
                      </span>
                      <i class="ri-arrow-right-up-line" style="font-size: 0.85rem;"></i>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
            <div>
              <button type="button"
                      onclick="window.setBgOverviewFilter('${activeFilter === 'observations' ? 'all' : 'observations'}')"
                      class="btn btn-sm"
                      style="background: ${activeFilter === 'observations' ? '#991b1b' : '#dc2626'}; color: #ffffff; border: none; font-weight: 800; font-size: 0.74rem; padding: 0.45rem 0.85rem; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;">
                <i class="ri-filter-3-line"></i>
                <span>${activeFilter === 'observations' ? 'Mostrar Todos los Comercios' : `Filtrar Comercios con Apelación (${st.withUnansweredObsItems.length})`}</span>
              </button>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- 1. Tarjeta de Progreso General del Periodo -->
      <div class="bg-card-container" style="padding: 1rem 1.35rem; margin-bottom: 1.15rem; background: linear-gradient(135deg, rgba(95, 6, 250, 0.04) 0%, rgba(16, 185, 129, 0.04) 100%);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.55rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
            <span style="font-weight: 800; font-size: 0.92rem; color: var(--color-text-main);">
              <i class="ri-flag-2-fill" style="color: #5f06fa;"></i> Avance de Emisión de Desgloses (${escapeHtml(st.periodName)}):
            </span>
            <span style="font-weight: 800; font-size: 0.9rem; color: ${st.progressPct === 100 ? '#10b981' : '#5f06fa'};">
              ${st.completedCount} de ${st.actionableTotal} emitidos (${st.progressPct}%)
            </span>
            ${st.draftItems.length > 0 ? `
              <span style="background: #ede9fe; color: #5b21b6; font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 999px;">
                + ${st.draftItems.length} en borrador listo(s) para publicar
              </span>
            ` : ''}
          </div>
          <div style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 600;">
            ${st.pendingItems.length > 0
              ? `<span style="color: #d97706;"><i class="ri-alert-line"></i> Faltan <strong>${st.pendingItems.length}</strong> desglose(s) por generar (${st.pendingWithOrdersItems.length} con pedidos asignados)</span>`
              : `<span style="color: #10b981;"><i class="ri-checkbox-circle-fill"></i> ¡Todos los desgloses activos del periodo han sido generados!</span>`}
          </div>
        </div>
        <div style="width: 100%; height: 10px; background: rgba(148, 163, 184, 0.2); border-radius: 999px; overflow: hidden;">
          <div style="width: ${st.progressPct}%; height: 100%; background: linear-gradient(90deg, #5f06fa 0%, #10b981 100%); border-radius: 999px; transition: width 0.35s ease;"></div>
        </div>
      </div>

      <!-- 2. Grid de KPIs del Periodo -->
      <div class="bg-kpi-grid" style="margin-bottom: 1.35rem;">
        <div class="bg-kpi-card" style="border-left: 4px solid #5f06fa;">
          <div class="bg-kpi-title"><i class="ri-money-dollar-circle-line" style="color: #5f06fa;"></i> TOTAL FULFILLMENT PERIODO</div>
          <div class="bg-kpi-value" style="color: #5f06fa;">${formatCLP(st.totalGrossAll)}</div>
          <div class="bg-kpi-subtitle">Neto: <strong>${formatCLP(st.totalNetAll)}</strong> · Emitido: ${formatCLP(st.totalGrossIssued)}</div>
        </div>

        <div class="bg-kpi-card" style="border-left: 4px solid #10b981;">
          <div class="bg-kpi-title"><i class="ri-checkbox-circle-line" style="color: #10b981;"></i> DESGLOSES EMITIDOS</div>
          <div class="bg-kpi-value" style="color: #10b981;">${st.issuedItems.length} <span style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-muted);">comercios</span></div>
          <div class="bg-kpi-subtitle">
            ${st.draftItems.length > 0
              ? `<span style="color: #6d28d9; font-weight: 700;">${st.draftItems.length} en borrador (${formatCLP(st.totalGrossDraft)})</span>`
              : 'Publicados en portal de clientes'}
          </div>
        </div>

        <div class="bg-kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="bg-kpi-title"><i class="ri-time-line" style="color: #f59e0b;"></i> PENDIENTES DE GENERAR</div>
          <div class="bg-kpi-value" style="color: #d97706;">${st.pendingItems.length} <span style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-muted);">comercios</span></div>
          <div class="bg-kpi-subtitle">
            <strong>${st.pendingWithOrdersItems.length}</strong> con pedidos activos en el periodo
          </div>
        </div>

        <div class="bg-kpi-card" style="border-left: 4px solid #0284c7;">
          <div class="bg-kpi-title"><i class="ri-wallet-3-line" style="color: #0284c7;"></i> SALDO POR COBRAR</div>
          <div class="bg-kpi-value" style="color: #0284c7;">${formatCLP(st.totalSaldoAll)}</div>
          <div class="bg-kpi-subtitle">Abonos recibidos: <strong style="color: #10b981;">${formatCLP(st.totalAbonosAll)}</strong></div>
        </div>

        <div class="bg-kpi-card" style="border-left: 4px solid #6366f1;">
          <div class="bg-kpi-title"><i class="ri-shopping-bag-3-line" style="color: #6366f1;"></i> PEDIDOS DEL PERIODO</div>
          <div class="bg-kpi-value" style="color: #6366f1;">${st.totalPeriodOrdersCount.toLocaleString('es-CL')}</div>
          <div class="bg-kpi-subtitle">Asignados a <strong>${escapeHtml(st.periodName)}</strong></div>
        </div>
      </div>

      <!-- 3. Sección Prioritaria: Desgloses de Fulfillment Pendientes de Generar / En Borrador -->
      <div class="bg-card-container" style="margin-bottom: 1.35rem; border: 1px solid ${workQueueItems.length > 0 ? 'rgba(245, 158, 11, 0.35)' : 'var(--color-border)'};">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.9rem;">
          <div>
            <h4 style="margin: 0; font-size: 1rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.45rem;">
              <i class="ri-list-check-2" style="color: #f59e0b; font-size: 1.2rem;"></i>
              Desgloses de Fulfillment Pendientes de Generar y Borradores (${workQueueItems.length})
            </h4>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.78rem; color: var(--color-text-muted);">
              Haz clic en <strong>Generar Desglose</strong> o <strong>Continuar Edición</strong> en cualquier comercio para abrir directamente su calculadora editable.
            </p>
          </div>
          ${workQueueItems.length > 0 ? `
            <span style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-size: 0.74rem; font-weight: 800; padding: 4px 10px; border-radius: 8px;">
              ${st.pendingWithOrdersItems.length} con pedidos listos · ${st.draftItems.length} en borrador
            </span>
          ` : ''}
        </div>

        ${workQueueItems.length === 0 ? `
          <div style="text-align: center; padding: 1.75rem 1rem; background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.35); border-radius: 10px; color: #047857;">
            <i class="ri-checkbox-circle-fill" style="font-size: 1.8rem; display: block; margin-bottom: 0.35rem; color: #10b981;"></i>
            <strong style="font-size: 0.92rem;">¡No hay desgloses pendientes de generar en ${escapeHtml(st.periodName)}!</strong>
            <div style="font-size: 0.78rem; opacity: 0.85; margin-top: 0.15rem;">Todos los comercios del periodo ya fueron emitidos o marcados sin movimiento.</div>
          </div>
        ` : `
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 0.75rem; max-height: 360px; overflow-y: auto; padding-right: 4px;">
            ${workQueueItems.map(item => {
              const isDraft = item.statusCategory === 'draft';
              const hasOrders = item.ordersCount > 0;
              const childBadges = item.childBreakdownObj
                ? Object.entries(item.childBreakdownObj).map(([cName, cQty]) => `${cName}: ${cQty}`).join(' · ')
                : (item.isConglomerate && item.conglomerateChildren.length > 0 ? `Holding: ${item.conglomerateChildren.join(', ')}` : '');

              return `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.75rem 0.95rem; border-radius: 10px; background: var(--color-bg); border: 1px solid ${isDraft ? '#c4b5fd' : (hasOrders ? '#fde68a' : 'var(--color-border)')}; border-left: 4px solid ${isDraft ? '#7c3aed' : (hasOrders ? '#f59e0b' : '#94a3b8')};">
                  <div style="min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                      <strong style="font-size: 0.86rem; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${item.isConglomerate ? '🏢 ' : ''}${escapeHtml(item.comercio)}
                      </strong>
                      <span style="font-size: 0.68rem; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: ${hasOrders ? 'rgba(95, 6, 250, 0.1)' : '#f1f5f9'}; color: ${hasOrders ? '#5f06fa' : '#64748b'};">
                        ${item.ordersCount.toLocaleString('es-CL')} ped.
                      </span>
                      ${(item.unansweredObservationsCount || 0) > 0 ? `
                        <span onclick="event.stopPropagation(); window.openBillingGeneratorFromOverview('${escapeHtml(item.comercio)}', '${escapeHtml(st.periodId)}', 'observations')"
                              title="Tiene ${item.unansweredObservationsCount} apelación(es)/observación(es) sin respuesta. Haz clic para revisar e ingresar saldo."
                              style="font-size: 0.66rem; font-weight: 900; padding: 1px 6px; border-radius: 999px; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">
                          🚨 ${item.unansweredObservationsCount} apelación${item.unansweredObservationsCount === 1 ? '' : 'es'}
                        </span>
                      ` : ''}
                    </div>
                    ${childBadges ? `
                      <div style="font-size: 0.68rem; color: var(--color-text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(childBadges)}">
                        ${escapeHtml(childBadges)}
                      </div>
                    ` : ''}
                    <div style="margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                      ${isDraft ? `
                        <span style="font-size: 0.7rem; font-weight: 700; color: #6d28d9;">
                          <i class="ri-draft-line"></i> Borrador: <strong>${formatCLP(item.totalFulfillment)}</strong>
                        </span>
                      ` : `
                        <span style="font-size: 0.7rem; font-weight: 600; color: ${hasOrders ? '#b45309' : '#64748b'};">
                          ${hasOrders ? '<i class="ri-flashlight-fill"></i> Listo para calcular' : 'Sin pedidos asignados aún'}
                        </span>
                      `}
                    </div>
                  </div>

                  <button type="button"
                          onclick="window.openBillingGeneratorFromOverview('${escapeHtml(item.comercio)}', '${escapeHtml(st.periodId)}')"
                          class="btn btn-sm"
                          style="background: ${isDraft ? '#7c3aed' : (hasOrders ? '#5f06fa' : 'var(--color-surface)')}; color: ${isDraft || hasOrders ? '#ffffff' : 'var(--color-text-main)'}; border: 1px solid ${isDraft ? '#7c3aed' : (hasOrders ? '#5f06fa' : 'var(--color-border)')}; font-weight: 700; font-size: 0.74rem; padding: 0.4rem 0.75rem; border-radius: 7px; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; flex-shrink: 0;">
                    <i class="${isDraft ? 'ri-edit-box-line' : 'ri-calculator-line'}"></i>
                    <span>${isDraft ? 'Continuar' : 'Generar'}</span>
                    <i class="ri-arrow-right-s-line"></i>
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <!-- 4. Tabla Completa de Desgloses Emitidos y Estado del Periodo -->
      <div class="bg-card-container">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;">
          <div>
            <h4 style="margin: 0; font-size: 1rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.45rem;">
              <i class="ri-file-list-3-fill" style="color: #5f06fa; font-size: 1.2rem;"></i>
              Listado de Desgloses del Periodo (${filteredTableItems.length})
            </h4>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.78rem; color: var(--color-text-muted);">
              Consulta todos los desgloses emitidos, montos facturados, saldos y salta directamente al generador de cualquier comercio.
            </p>
          </div>

          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <div style="position: relative;">
              <input type="text" id="bg-overview-search-input" class="form-input" placeholder="Buscar comercio o marca..." value="${escapeHtml(window.bgOverviewSearchQuery || '')}" oninput="window.setBgOverviewSearch(this.value)" style="height: 36px; font-size: 0.8rem; margin: 0; width: 220px; padding-left: 2rem; border-radius: 8px;">
              <i class="ri-search-line" style="position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
            </div>
          </div>
        </div>

        <!-- Píldoras de Filtro Rápido -->
        <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.9rem; background: var(--color-bg); padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid var(--color-border);">
          <span style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-muted); text-transform: uppercase; margin-right: 4px;">
            <i class="ri-filter-3-line" style="color: #5f06fa;"></i> Filtrar Estado:
          </span>
          <button type="button" class="bg-quick-filter-btn ${activeFilter === 'all' ? 'active' : ''}" onclick="window.setBgOverviewFilter('all')">
            Todos (${st.items.length})
          </button>
          <button type="button" class="bg-quick-filter-btn ${activeFilter === 'issued' ? 'active' : ''}" onclick="window.setBgOverviewFilter('issued')">
            ✅ Emitidos / Publicados (${st.issuedItems.length})
          </button>
          <button type="button" class="bg-quick-filter-btn ${activeFilter === 'draft' ? 'active' : ''}" onclick="window.setBgOverviewFilter('draft')">
            📝 En Borrador (${st.draftItems.length})
          </button>
          <button type="button" class="bg-quick-filter-btn ${activeFilter === 'pending' ? 'active' : ''}" onclick="window.setBgOverviewFilter('pending')">
            ⏳ Pendientes de Generar (${st.pendingItems.length})
          </button>
          <button type="button" class="bg-quick-filter-btn ${activeFilter === 'exempt' ? 'active' : ''}" onclick="window.setBgOverviewFilter('exempt')">
            🚫 Sin Movimiento / Exentos (${st.exemptItems.length})
          </button>
          <button type="button" class="bg-quick-filter-btn ${activeFilter === 'observations' ? 'active' : ''}" onclick="window.setBgOverviewFilter('observations')" style="${(st.withUnansweredObsItems?.length || 0) > 0 ? 'border-color: #fca5a5; background: #fef2f2; color: #b91c1c; font-weight: 800;' : ''}">
            🚨 Con Apelación sin Respuesta (${(st.withUnansweredObsItems || []).length})
          </button>
        </div>

        <div class="bg-excel-table-container" style="max-height: 540px;">
          <table class="bg-excel-table">
            <thead>
              <tr>
                <th style="width: 45px; text-align: center;">#</th>
                <th style="min-width: 210px;">Comercio / Holding</th>
                <th style="width: 110px; text-align: center;">Pedidos Periodo</th>
                <th style="width: 165px; text-align: center;">Estado Desglose</th>
                <th style="width: 135px; text-align: right;">Total Fulfillment (IVA Incl.)</th>
                <th style="width: 120px; text-align: right;">Abonos</th>
                <th style="width: 135px; text-align: right;">Saldo a Pagar</th>
                <th style="width: 150px; text-align: center;">Pago / Factura</th>
                <th style="width: 145px; text-align: center;">Última Gestión</th>
                <th style="width: 205px; text-align: right;">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${filteredTableItems.length === 0 ? `
                <tr>
                  <td colspan="10" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
                    No se encontraron comercios que coincidan con el filtro seleccionado.
                  </td>
                </tr>
              ` : filteredTableItems.map((item, idx) => {
                const updatedStr = item.updatedAt
                  ? new Date(item.updatedAt).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                  : '—';
                const notifiedStr = item.lastNotifiedAt
                  ? new Date(item.lastNotifiedAt).toLocaleString('es-CL', { day: '2-digit', month: '2-digit' })
                  : null;

                return `
                  <tr>
                    <td style="text-align: center; color: #64748b; font-weight: 700;">${idx + 1}</td>
                    <td>
                      <div style="font-weight: 800; color: var(--color-text-main); font-size: 0.85rem; display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                        <span>${item.isConglomerate ? '🏢 ' : ''}${escapeHtml(item.comercio)}</span>
                        ${item.isConglomerate && item.conglomerateChildren.length > 0 ? `
                          <span style="font-size: 0.65rem; font-weight: 700; background: rgba(95, 6, 250, 0.08); color: #5f06fa; padding: 1px 6px; border-radius: 4px;">
                            ${escapeHtml(item.conglomerateChildren.join(', '))}
                          </span>
                        ` : ''}
                        ${(item.unansweredObservationsCount || 0) > 0 ? `
                          <button type="button"
                                  onclick="window.openBillingGeneratorFromOverview('${escapeHtml(item.comercio)}', '${escapeHtml(st.periodId)}', 'observations')"
                                  title="Abrir apelaciones sin respuesta de ${escapeHtml(item.comercio)} e ingresar saldo al desglose"
                                  style="background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; font-size: 0.67rem; font-weight: 900; padding: 2px 7px; border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">
                            <i class="ri-alarm-warning-fill"></i> ${item.unansweredObservationsCount} apelación${item.unansweredObservationsCount === 1 ? '' : 'es'} sin resp.
                          </button>
                        ` : ((item.totalObservationsCount || 0) > 0 ? `
                          <button type="button"
                                  onclick="window.openBillingGeneratorFromOverview('${escapeHtml(item.comercio)}', '${escapeHtml(st.periodId)}', 'observations')"
                                  title="Ver historial de observaciones respondidas (${item.totalObservationsCount})"
                                  style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-size: 0.66rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">
                            <i class="ri-question-answer-line"></i> ${item.totalObservationsCount} obs.
                          </button>
                        ` : '')}
                      </div>
                    </td>
                    <td style="text-align: center;">
                      <span style="font-weight: 800; font-size: 0.85rem; color: ${item.ordersCount > 0 ? '#5f06fa' : '#94a3b8'};">
                        ${item.ordersCount.toLocaleString('es-CL')}
                      </span>
                    </td>
                    <td style="text-align: center;">
                      ${getStatusBadgeHTML(item)}
                    </td>
                    <td style="text-align: right; font-weight: 800; font-size: 0.86rem; color: ${item.totalFulfillment > 0 ? 'var(--color-text-main)' : '#94a3b8'};">
                      ${formatCLP(item.totalFulfillment)}
                    </td>
                    <td style="text-align: right; font-weight: 700; color: ${item.abonoFulfillment > 0 ? '#10b981' : '#94a3b8'};">
                      ${item.abonoFulfillment > 0 ? `-${formatCLP(item.abonoFulfillment)}` : '$0'}
                    </td>
                    <td style="text-align: right; font-weight: 800; font-size: 0.86rem; color: ${item.saldoFulfillment > 0 ? '#0284c7' : '#64748b'};">
                      ${formatCLP(item.saldoFulfillment)}
                    </td>
                    <td style="text-align: center; font-size: 0.72rem;">
                      <div style="font-weight: 700; color: var(--color-text-main);">${escapeHtml(item.rawPago)}</div>
                      <div style="color: var(--color-text-muted); font-size: 0.68rem;">Fact: ${escapeHtml(item.rawFactura)}</div>
                    </td>
                    <td style="text-align: center; font-size: 0.72rem; color: var(--color-text-muted);">
                      <div>${updatedStr}</div>
                      ${notifiedStr ? `<div style="color: #10b981; font-weight: 700; font-size: 0.66rem;"><i class="ri-mail-check-line"></i> Notif. ${notifiedStr}</div>` : ''}
                    </td>
                    <td style="text-align: right;">
                      <div style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 5px;">
                        ${item.recordId && (item.statusCategory === 'issued' || item.statusCategory === 'draft') ? `
                          <button type="button"
                                  onclick="window.openClientInteractiveBillingModal('${escapeHtml(item.recordId)}', 'desglose')"
                                  class="btn btn-outline btn-sm"
                                  style="height: 29px; padding: 0 8px; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border-color: #cbd5e1; display: inline-flex; align-items: center; gap: 3px;"
                                  title="Ver vista previa del desglose oficial">
                            <i class="ri-eye-line"></i> Ver
                          </button>
                        ` : ''}
                        <button type="button"
                                onclick="window.openBillingGeneratorFromOverview('${escapeHtml(item.comercio)}', '${escapeHtml(st.periodId)}')"
                                class="btn btn-primary btn-sm"
                                style="height: 29px; padding: 0 10px; font-size: 0.73rem; font-weight: 700; border-radius: 6px; background: ${item.statusCategory === 'pending' ? '#5f06fa' : (item.statusCategory === 'draft' ? '#7c3aed' : '#0f172a')}; border-color: transparent; display: inline-flex; align-items: center; gap: 4px;"
                                title="Abrir este comercio en el Generador de Desgloses">
                          <i class="${item.statusCategory === 'pending' ? 'ri-calculator-line' : 'ri-edit-2-line'}"></i>
                          <span>${item.statusCategory === 'pending' ? 'Generar' : 'Abrir en Gestor'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            ${filteredTableItems.length > 0 ? `
              <tfoot>
                <tr style="background: rgba(95, 6, 250, 0.06); font-weight: 800; border-top: 2px solid #cbd5e1;">
                  <td colspan="2" style="padding: 0.65rem 0.75rem; text-align: right; color: var(--color-text-main);">TOTALES (${filteredTableItems.length} comercios):</td>
                  <td style="text-align: center; color: #5f06fa; font-size: 0.88rem;">${filteredOrdersSum.toLocaleString('es-CL')}</td>
                  <td></td>
                  <td style="text-align: right; color: #5f06fa; font-size: 0.9rem;">${formatCLP(filteredGrossSum)}</td>
                  <td style="text-align: right; color: #10b981; font-size: 0.86rem;">${filteredAbonoSum > 0 ? `-${formatCLP(filteredAbonoSum)}` : '$0'}</td>
                  <td style="text-align: right; color: #0284c7; font-size: 0.9rem;">${formatCLP(filteredSaldoSum)}</td>
                  <td colspan="3"></td>
                </tr>
              </tfoot>
            ` : ''}
          </table>
        </div>
      </div>
    </div>
  `;
}

window.setBgOverviewFilter = function(filter) {
  window.bgOverviewActiveFilter = filter || 'all';
  renderPeriodOverviewDOM();
};

window.setBgOverviewSearch = function(query) {
  window.bgOverviewSearchQuery = query || '';
  renderPeriodOverviewDOM();
  const input = document.getElementById('bg-overview-search-input');
  if (input) {
    input.focus();
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (e) {}
  }
};

// Función para alternar sub-pestañas
window.switchBgSubTab = function(tabKey) {
  const tabs = ['register', 'desglose', 'analytics', 'checklist', 'observations'];
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

  const regActions = document.getElementById('bg-register-top-actions');
  if (regActions) {
    regActions.style.display = (tabKey === 'register' && !billingState.isLocked) ? 'flex' : 'none';
  }

  if (!billingState.currentCommerce && (tabKey === 'desglose' || tabKey === 'analytics' || tabKey === 'observations')) {
    renderGeneratorEmptyCommerceState();
    return;
  }

  if (tabKey === 'desglose') {
    const container = document.getElementById('bg-desglose-view-container');
    if (container) container.innerHTML = renderStockaDesgloseHTML();
  } else if (tabKey === 'analytics') {
    renderBillingAnalyticsCharts();
  } else if (tabKey === 'checklist') {
    if (typeof renderBillingChecklistUI === 'function') {
      renderBillingChecklistUI();
    }
  } else if (tabKey === 'observations') {
    if (typeof renderCommerceObservationsSectionUI === 'function') {
      renderCommerceObservationsSectionUI();
    }
    if (typeof loadAndRenderCommerceObservationsUI === 'function') {
      loadAndRenderCommerceObservationsUI();
    }
  }
};

// Renderizar Banner de Periodo Cerrado/Pagado y sincronizar botones de edición en la barra de herramientas
export function renderLockStatusBannerAndSyncToolbarUI() {
  const b = billingState;
  const isLocked = Boolean(b.isLocked);
  const isPaid = Boolean(b.isPaid);
  const isPublished = Boolean(b.isPublished);

  // 1. Banner de estado de bloqueo / periodo cerrado
  const banner = document.getElementById('bg-lock-status-banner');
  if (banner) {
    if (!b.currentCommerce || !isLocked) {
      banner.style.display = 'none';
      banner.innerHTML = '';
    } else if (isPaid) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 1.5px solid #10b981; border-radius: 9px; padding: 0.5rem 0.9rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6rem; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.12);">
          <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            <span style="background: #059669; color: #ffffff; padding: 0.22rem 0.6rem; border-radius: 6px; font-weight: 800; font-size: 0.74rem; display: inline-flex; align-items: center; gap: 4px; letter-spacing: 0.02em;">
              <i class="ri-lock-2-fill"></i> PERIODO CERRADO Y PAGADO
            </span>
            <span style="font-size: 0.78rem; color: #065f46; font-weight: 600;">
              Facturación liquidada (${escapeHtml(b.paymentStatus || 'Pagado')}) · <strong>Modo Solo Lectura</strong> (cargado al instante sin recalcular).
            </span>
          </div>
          <span style="font-size: 0.7rem; color: #047857; background: rgba(255,255,255,0.75); border: 1px solid rgba(16,185,129,0.35); padding: 2px 8px; border-radius: 999px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
            <i class="ri-shield-check-fill"></i> Registro Inmutable v${b.currentVersion || 1}
          </span>
        </div>
      `;
    } else if (isPublished) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <div style="background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border: 1.5px solid #8b5cf6; border-radius: 9px; padding: 0.5rem 0.9rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6rem; box-shadow: 0 2px 6px rgba(139, 92, 246, 0.12);">
          <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            <span style="background: #6d28d9; color: #ffffff; padding: 0.22rem 0.6rem; border-radius: 6px; font-weight: 800; font-size: 0.74rem; display: inline-flex; align-items: center; gap: 4px; letter-spacing: 0.02em;">
              <i class="ri-lock-line"></i> PERIODO CONFIRMADO Y PUBLICADO (v${b.currentVersion || 1})
            </span>
            <span style="font-size: 0.78rem; color: #4c1d95; font-weight: 600;">
              El desglose ya fue enviado al comercio y se encuentra en <strong>Modo Solo Lectura</strong>.
            </span>
          </div>
          <button type="button" onclick="window.unlockPublishedBillingForEdit()" class="btn btn-sm" style="background: #ffffff; color: #6d28d9; border: 1px solid #8b5cf6; font-weight: 700; font-size: 0.72rem; height: 26px; padding: 0 0.65rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.04);" title="Habilitar edición excepcional para emitir una rectificación (nueva versión)">
            <i class="ri-lock-unlock-line"></i> Reabrir para Rectificar
          </button>
        </div>
      `;
    }
  }

  // 2. Sincronizar botones principales de barra superior
  const calcBtn = document.getElementById('bg-btn-recalculate');
  const saveBtn = document.getElementById('bg-btn-save-billing');
  const publishBtn = document.getElementById('bg-btn-confirm-publish');
  const configBtn = document.getElementById('bg-btn-pricing-config');

  if (calcBtn) {
    calcBtn.style.display = isLocked ? 'none' : 'inline-flex';
  }
  if (saveBtn) {
    saveBtn.style.display = isLocked ? 'none' : 'inline-flex';
  }
  if (publishBtn) {
    publishBtn.style.display = isLocked ? 'none' : 'inline-flex';
  }
  if (configBtn) {
    configBtn.style.display = isLocked ? 'none' : 'inline-flex';
  }

  // 3. Sincronizar acciones de edición en la barra de sub-pestañas y cabeceras de tabla
  const activeTabBtn = document.querySelector('#bg-main-subtabs .bg-subtab-btn.active');
  const isRegisterTab = !activeTabBtn || activeTabBtn.id === 'bg-tab-btn-register';
  const regActions = document.getElementById('bg-register-top-actions');
  if (regActions) {
    regActions.style.display = (isRegisterTab && !isLocked) ? 'flex' : 'none';
  }

  const hideWhenLockedIds = [
    'bg-btn-bulk-edit-filtered',
    'bg-th-btn-edit-delivery',
    'bg-th-btn-add-surcharge',
    'bg-th-btn-add-col-filter',
    'bg-desglose-top-toolbar'
  ];
  hideWhenLockedIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = isLocked ? 'none' : '';
    }
  });
}
window.renderLockStatusBannerAndSyncToolbarUI = renderLockStatusBannerAndSyncToolbarUI;

// Permitir reabrir excepcionalmente un periodo confirmado (pero aún NO pagado) para emitir rectificación
window.unlockPublishedBillingForEdit = async function() {
  if (billingState.isPaid) {
    guardBillingLocked();
    return;
  }
  if (typeof Swal !== 'undefined') {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: '¿Reabrir periodo para rectificar?',
      html: `
        <div style="font-size: 0.88rem; color: #334155; text-align: left; line-height: 1.45;">
          Este periodo ya fue <strong>Confirmado y Publicado (v${billingState.currentVersion || 1})</strong> para <strong>${escapeHtml(billingState.currentCommerce)}</strong>.<br><br>
          Si lo reabres y realizas cambios, deberás volver a presionar <strong>"Confirmar y Publicar"</strong> para generar una nueva versión oficial (v${(billingState.currentVersion || 1) + 1}).
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-lock-unlock-line"></i> Sí, habilitar edición',
      cancelButtonText: 'Cancelar (Mantener cerrado)',
      confirmButtonColor: '#6d28d9'
    });
    if (!isConfirmed) return;
  }

  billingState.isLocked = false;
  renderLockStatusBannerAndSyncToolbarUI();
  renderKPIsUI();
  renderOrdersTableUI();
  const desgloseCont = document.getElementById('bg-desglose-view-container');
  if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();
};

// Ejecutar el motor de cálculo desde los valores actuales de la UI
export async function executeCalculationFromUI(overrides = {}) {
  const commerceSelect = document.getElementById('bg-select-commerce');
  const periodSelect = document.getElementById('bg-select-period');
  const calcBtn = document.getElementById('bg-btn-recalculate');

  if (!commerceSelect || !periodSelect) return;

  const commerceName = commerceSelect.value;
  const periodId = periodSelect.value;
  const selectedOption = periodSelect.selectedIndex >= 0 ? periodSelect.options[periodSelect.selectedIndex] : null;
  const periodName = (selectedOption && selectedOption.getAttribute('data-name')) || selectedOption?.text || 'AGOSTO 2026';

  if (!commerceName) {
    renderGeneratorEmptyCommerceState();
    return;
  }

  // Feedback visual inmediato en botón de cálculo y selector de comercio
  const commerceSpinner = document.getElementById('bg-select-commerce-spinner');
  if (commerceSpinner) commerceSpinner.style.display = 'inline-flex';
  if (commerceSelect) commerceSelect.disabled = true;

  if (calcBtn) {
    calcBtn.disabled = true;
    calcBtn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Cargando...`;
  }

  const isSwitchingCommerce = billingState.currentCommerce !== commerceName || billingState.currentPeriodId !== periodId;
  const kpisCont = document.getElementById('bg-kpis-container');
  if (kpisCont && (isSwitchingCommerce || !billingState.orders || billingState.orders.length === 0)) {
    kpisCont.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 0.9rem; color: var(--color-text-muted); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px;">
        <i class="ri-loader-4-line ri-spin" style="font-size: 1.25rem; color: #5f06fa; display: inline-block; margin-bottom: 0.2rem;"></i>
        <div style="font-size: 0.82rem;">Cargando facturación de <strong>${escapeHtml(commerceName)}</strong> (${escapeHtml(periodName)})...</div>
      </div>
    `;
  }

  // Si la tabla o el comercio cambió, mostrar spinner de carga
  const ordersTbody = document.getElementById('bg-orders-table-body');
  if (ordersTbody && (isSwitchingCommerce || !billingState.orders || billingState.orders.length === 0)) {
    ordersTbody.innerHTML = `
      <tr>
        <td colspan="30" style="text-align: center; padding: 3rem; color: var(--color-text-muted);">
          <i class="ri-loader-4-line ri-spin" style="font-size: 2.2rem; color: #5f06fa; display: inline-block; margin-bottom: 0.6rem;"></i>
          <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.95rem;">Cargando facturación para <strong>${escapeHtml(commerceName)}</strong> (${escapeHtml(periodName)})...</div>
          <div style="font-size: 0.775rem; color: var(--color-text-muted); margin-top: 0.25rem;">Verificando registro del periodo o calculando tarifas...</div>
        </td>
      </tr>
    `;
  }

  try {
    billingState.currentPeriodId = periodId;

    // Ejecutar cálculo o hidratar snapshot instantáneamente si ya está cerrado/guardado
    await calculateCommerceBilling(commerceName, periodName, overrides);

    // Sincronizar banner de bloqueo y barra de herramientas según el estado del periodo
    renderLockStatusBannerAndSyncToolbarUI();

    // Actualizar KPI Cards en pantalla
    renderKPIsUI();

    // Actualizar Banner de Conglomerado
    renderConglomerateBannerUI();

    // Actualizar Tabla Editable
    renderOrdersTableUI();

    // Actualizar Desglose Oficial
    const desgloseCont = document.getElementById('bg-desglose-view-container');
    if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();

    // Actualizar Badge y Vista de Checklist
    if (typeof updateChecklistNavBadge === 'function') {
      updateChecklistNavBadge();
    }
    const checklistContent = document.getElementById('bg-content-checklist');
    if (checklistContent && checklistContent.style.display !== 'none') {
      if (typeof renderBillingChecklistUI === 'function') {
        renderBillingChecklistUI();
      }
    }

    // Cargar y mostrar Alerta + Apartado de Apelaciones / Observaciones del Comercio
    if (typeof loadAndRenderCommerceObservationsUI === 'function') {
      await loadAndRenderCommerceObservationsUI();
    }
  } catch (err) {
    console.error('Error calculando facturación desde UI:', err);
    if (ordersTbody) {
      ordersTbody.innerHTML = `
        <tr>
          <td colspan="16" style="text-align: center; padding: 2.5rem; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;">
            <i class="ri-error-warning-fill" style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;"></i>
            <strong style="font-size: 1rem;">No se pudo completar el cálculo de facturación</strong><br>
            <span style="font-size: 0.85rem; font-family: monospace; display: inline-block; margin-top: 0.35rem; color: #7f1d1d;">${escapeHtml(err.message || 'Error inesperado')}</span><br>
            <button type="button" class="btn btn-sm btn-primary" onclick="window.executeCalculationFromUI()" style="margin-top: 1rem; background: #5f06fa; border-color: #5f06fa; font-weight: 700; border-radius: 6px;">
              <i class="ri-refresh-line"></i> Reintentar Cálculo
            </button>
          </td>
        </tr>
      `;
    }
    const kpisCont = document.getElementById('bg-kpis-container');
    if (kpisCont && (!billingState.totals || !billingState.totals.totalToPay)) {
      kpisCont.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 1rem; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;">
          <i class="ri-alert-line" style="font-size: 1.35rem; display: inline-block; margin-bottom: 0.2rem;"></i>
          <div style="font-weight: 700; font-size: 0.85rem;">Error al calcular totales del periodo para ${escapeHtml(commerceName)}.</div>
        </div>
      `;
    }
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'Error en cálculo de facturación',
        text: err.message || 'No se pudo generar el cálculo para este comercio.',
        confirmButtonColor: '#5f06fa'
      });
    }
  } finally {
    billingState.isLoading = false;
    if (calcBtn) {
      calcBtn.disabled = false;
      calcBtn.innerHTML = `<i class="ri-refresh-line"></i> Recalcular`;
    }
    if (commerceSpinner) commerceSpinner.style.display = 'none';
    if (commerceSelect) commerceSelect.disabled = false;
    renderLockStatusBannerAndSyncToolbarUI();
  }
}
window.executeCalculationFromUI = executeCalculationFromUI;

// Renderizar Banner Dinámico de Conglomerados / Holdings (Compacto en 1 línea)
export function renderConglomerateBannerUI() {
  const container = document.getElementById('bg-conglomerate-banner-container');
  if (!container) return;

  const b = billingState;
  if (!b) {
    container.innerHTML = '';
    return;
  }

  // Caso 1: Se está facturando el conglomerado consolidado (ej: BIG BANG SPA)
  if (b.isConglomerate && !b.selectedAsChildStore) {
    const children = b.conglomerateChildren || [];
    const breakdown = (b.storeBreakdown && b.storeBreakdown.length > 0)
      ? b.storeBreakdown
      : computeConglomerateStoreBreakdown(b.orders, b);
    const activeStore = b.activeConglomerateStoreFilter;
    const totalOrdersHolding = (b.orders || []).length;
    const isAllSelected = !activeStore;

    const storePills = children.map(childName => {
      const storeData = breakdown.find(s => s.storeName.toUpperCase() === childName.toUpperCase());
      const orderCount = storeData ? storeData.totalOrders : 0;
      const netTotal = storeData ? storeData.storeTotalNet : 0;
      const isSelected = activeStore && activeStore.toUpperCase() === childName.toUpperCase();

      return `
        <button type="button"
                onclick="window.setConglomerateStoreView('${escapeHtml(childName)}')"
                class="bg-conglom-store-tab ${isSelected ? 'active' : ''}"
                style="font-size: 0.72rem; font-weight: 700; padding: 0.24rem 0.6rem; border-radius: 6px; border: 1.5px solid ${isSelected ? '#5f06fa' : 'rgba(95,6,250,0.2)'}; background: ${isSelected ? '#5f06fa' : 'var(--color-surface)'}; color: ${isSelected ? '#ffffff' : 'var(--color-text-main)'}; display: inline-flex; align-items: center; gap: 4px; box-shadow: ${isSelected ? '0 2px 7px rgba(95,6,250,0.28)' : '0 1px 2px rgba(0,0,0,0.03)'}; cursor: pointer; transition: all 0.15s ease;">
          <i class="ri-store-2-line" style="${isSelected ? 'color: #ffffff;' : 'color: #5f06fa;'}"></i>
          <span>${escapeHtml(childName)}</span>
          <span style="background: ${isSelected ? 'rgba(255,255,255,0.25)' : 'rgba(95,6,250,0.1)'}; color: ${isSelected ? '#ffffff' : '#5f06fa'}; padding: 1px 5px; border-radius: 4px; font-size: 0.67rem; font-weight: 800;">
            ${orderCount.toLocaleString('es-CL')} ped.
          </span>
          ${netTotal > 0 ? `
            <span style="font-size: 0.65rem; opacity: ${isSelected ? '0.9' : '0.75'};">
              (${formatCLP(netTotal)})
            </span>
          ` : ''}
        </button>
      `;
    }).join('');

    container.innerHTML = `
      <div class="bg-conglomerate-banner" title="Cálculo unificado en memoria con ${totalOrdersHolding.toLocaleString('es-CL')} pedidos. Selecciona una tienda para filtrar su tabla y analítica al instante sin re-consultar.">
        <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
          <div style="width: 26px; height: 26px; border-radius: 7px; background: linear-gradient(135deg, #5f06fa 0%, #7c3aed 100%); color: white; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; flex-shrink: 0; box-shadow: 0 2px 6px rgba(95,6,250,0.25);">
            <i class="ri-building-line"></i>
          </div>
          <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <span style="font-weight: 800; font-size: 0.84rem; color: #5f06fa;">
              Holding: ${escapeHtml(b.conglomerateName || b.currentCommerce)}
            </span>
            <span class="badge" style="background: #5f06fa; color: white; font-size: 0.64rem; padding: 0.1rem 0.45rem; border-radius: 9999px;">${children.length} marcas</span>
            <span style="font-size: 0.72rem; color: var(--color-text-muted);">
              · <strong>${totalOrdersHolding.toLocaleString('es-CL')}</strong> ped. en memoria
            </span>
            ${activeStore ? `
              <span class="badge" style="background: #10b981; color: white; font-size: 0.65rem; padding: 0.1rem 0.5rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 3px;">
                <i class="ri-eye-line"></i> ${escapeHtml(activeStore)}
              </span>
            ` : ''}
          </div>
        </div>

        <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
          <button type="button"
                  onclick="window.setConglomerateStoreView(null)"
                  class="bg-conglom-store-tab ${isAllSelected ? 'active' : ''}"
                  style="font-size: 0.72rem; font-weight: 700; padding: 0.24rem 0.6rem; border-radius: 6px; border: 1.5px solid ${isAllSelected ? '#5f06fa' : 'rgba(95,6,250,0.2)'}; background: ${isAllSelected ? '#5f06fa' : 'var(--color-surface)'}; color: ${isAllSelected ? '#ffffff' : 'var(--color-text-main)'}; display: inline-flex; align-items: center; gap: 4px; box-shadow: ${isAllSelected ? '0 2px 7px rgba(95,6,250,0.28)' : '0 1px 2px rgba(0,0,0,0.03)'}; cursor: pointer; transition: all 0.15s ease;">
            <i class="ri-building-line" style="${isAllSelected ? 'color: #ffffff;' : 'color: #5f06fa;'}"></i>
            <span>Consolidado</span>
            <span style="background: ${isAllSelected ? 'rgba(255,255,255,0.25)' : 'rgba(95,6,250,0.1)'}; color: ${isAllSelected ? '#ffffff' : '#5f06fa'}; padding: 1px 5px; border-radius: 4px; font-size: 0.67rem; font-weight: 800;">
              ${totalOrdersHolding.toLocaleString('es-CL')}
            </span>
          </button>
          ${storePills}
        </div>
      </div>
    `;
  } 
  // Caso 2: El usuario seleccionó una tienda que pertenece a un conglomerado (ej: BACK IN TIME)
  else if (b.selectedAsChildStore && b.conglomerateName) {
    const parentName = b.conglomerateName;
    const siblings = (b.conglomerateChildren || []).filter(c => c.toUpperCase() !== String(b.currentCommerce).toUpperCase());
    container.innerHTML = `
      <div style="background: rgba(245, 158, 11, 0.08); border: 1.5px solid rgba(245, 158, 11, 0.35); border-radius: 9px; padding: 0.45rem 0.85rem; margin-top: 0; margin-bottom: 0.55rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; color: #b45309; font-size: 0.78rem;">
          <i class="ri-information-line" style="font-size: 1.05rem; flex-shrink: 0; color: #d97706;"></i>
          <span>
            <strong>${escapeHtml(b.currentCommerce)}</strong> pertenece al holding <strong>${escapeHtml(parentName)}</strong>${siblings.length > 0 ? ` (junto a ${escapeHtml(siblings.join(', '))})` : ''}.
          </span>
        </div>
        <button type="button" class="btn btn-sm" onclick="window.selectAndCalculateCommerce('${escapeHtml(parentName)}')" style="background: #5f06fa; color: white; border: none; font-weight: 700; font-size: 0.72rem; border-radius: 6px; padding: 0.25rem 0.65rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; box-shadow: 0 2px 5px rgba(95,6,250,0.22);">
          <i class="ri-building-line"></i> Facturar Holding (${escapeHtml(parentName)})
        </button>
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
}
window.renderConglomerateBannerUI = renderConglomerateBannerUI;

export function setConglomerateStoreView(storeName = null) {
  const normStore = storeName ? storeName : null;
  billingState.activeConglomerateStoreFilter = normStore;

  // Si estamos en la vista interactiva del cliente:
  if (window.__currentClientBillingSnapshot) {
    window.__currentClientBillingSnapshot.activeConglomerateStoreFilter = normStore;
  }

  // 1. Re-renderizar banner para actualizar estilos visuales de las pastillas (admin)
  if (typeof renderConglomerateBannerUI === 'function') {
    try { renderConglomerateBannerUI(); } catch (e) { console.warn(e); }
  }

  // 2. Sincronizar selector de columna de tienda en la tabla editable (admin)
  const storeSelect = document.getElementById('bg-col-filter-store');
  if (storeSelect) {
    storeSelect.value = normStore || '';
  }
  if (!window.bgFilterState) window.bgFilterState = {};
  window.bgFilterState.store = (normStore || '').toLowerCase().trim();

  // 3. Renderizar barra KPI informativa de la tienda activa sobre la tabla (admin)
  if (typeof updateActiveStoreFilterBannerUI === 'function') {
    try { updateActiveStoreFilterBannerUI(); } catch (e) { console.warn(e); }
  }

  // 4. Aplicar filtros a las filas de la tabla (admin)
  if (typeof window.applyBgColumnFilters === 'function') {
    try { window.applyBgColumnFilters(); } catch (e) { console.warn(e); }
  }

  // 5. Si la pestaña de Analítica Admin está activa, re-renderizar los gráficos
  const analyticsContent = document.getElementById('bg-content-analytics');
  if (analyticsContent && analyticsContent.style.display !== 'none') {
    try { renderBillingAnalyticsCharts('bg-analytics-container'); } catch (e) { console.warn(e); }
  }

  // 6. Si estamos en el modal interactivo del CLIENTE, re-renderizar analítica si está visible
  const clientAnalyticsMount = document.getElementById('client-modal-analytics-mount');
  const clientAnalyticsContent = document.getElementById('client-modal-content-analytics');
  if (clientAnalyticsMount && window.__currentClientBillingSnapshot) {
    if (!clientAnalyticsContent || clientAnalyticsContent.style.display !== 'none') {
      try { renderBillingAnalyticsCharts('client-modal-analytics-mount', window.__currentClientBillingSnapshot); } catch (e) { console.warn(e); }
    }
  }

  // 7. Sincronizar selector de tienda y filtrar tabla de pedidos en modal de CLIENTE
  const clientStoreSelect = document.getElementById('client-orders-store-filter');
  if (clientStoreSelect) {
    clientStoreSelect.value = normStore || '';
  }
  if (typeof window.filterClientOrdersTable === 'function') {
    try { window.filterClientOrdersTable(false); } catch (e) { console.warn(e); }
  }
}
window.setConglomerateStoreView = setConglomerateStoreView;

// Renderizar o actualizar el mini-banner KPI de la tienda filtrada sobre la tabla editable
export function updateActiveStoreFilterBannerUI() {
  const banner = document.getElementById('bg-store-active-filter-banner');
  if (!banner) return;

  const activeStore = billingState.activeConglomerateStoreFilter;
  if (!billingState.isConglomerate || !activeStore) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  const breakdown = (billingState.storeBreakdown && billingState.storeBreakdown.length > 0)
    ? billingState.storeBreakdown
    : computeConglomerateStoreBreakdown(billingState.orders, billingState);

  const storeData = breakdown.find(s => s.storeName.toUpperCase() === activeStore.toUpperCase()) || {
    storeName: activeStore,
    totalOrders: 0,
    billableOrders: 0,
    pickPackNet: 0,
    shippingFreightNet: 0,
    storeTotalNet: 0,
    sharePct: 0,
    avgTicket: 0
  };

  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="background: linear-gradient(135deg, rgba(95, 6, 250, 0.08) 0%, rgba(124, 58, 237, 0.04) 100%); border: 1.5px solid rgba(95, 6, 250, 0.32); border-radius: 7px; padding: 0.38rem 0.75rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; box-shadow: 0 1px 4px rgba(95,6,250,0.05);">
      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        <span style="background: #5f06fa; color: white; padding: 0.15rem 0.55rem; border-radius: 5px; font-weight: 800; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 3px; box-shadow: 0 1px 4px rgba(95,6,250,0.22);">
          <i class="ri-store-2-fill"></i> ${escapeHtml(activeStore)}
        </span>
        <span style="font-size: 0.75rem; color: var(--color-text-main); font-weight: 600;">
          Pedidos: <strong style="color: #5f06fa;">${storeData.totalOrders.toLocaleString('es-CL')}</strong> (${storeData.billableOrders.toLocaleString('es-CL')} fact.)
        </span>
        <span style="font-size: 0.7rem; color: var(--color-text-muted);">•</span>
        <span style="font-size: 0.75rem; color: var(--color-text-main);">
          Pick & Pack: <strong>${formatCLP(storeData.pickPackNet)}</strong>
        </span>
        <span style="font-size: 0.7rem; color: var(--color-text-muted);">•</span>
        <span style="font-size: 0.75rem; color: var(--color-text-main);">
          Flete: <strong>${formatCLP(storeData.shippingFreightNet)}</strong>
        </span>
        <span style="font-size: 0.7rem; color: var(--color-text-muted);">•</span>
        <span style="font-size: 0.76rem; color: #5f06fa; font-weight: 800;">
          Subtotal Neto: ${formatCLP(storeData.storeTotalNet)}
        </span>
        <span style="font-size: 0.68rem; background: rgba(95, 6, 250, 0.12); color: #5f06fa; padding: 1px 6px; border-radius: 4px; font-weight: 700;">
          ${storeData.sharePct}% del Holding
        </span>
      </div>
      <button type="button" class="btn btn-sm btn-outline" onclick="window.setConglomerateStoreView(null)" style="font-size: 0.7rem; font-weight: 700; border-radius: 5px; border-color: rgba(95,6,250,0.4); color: #5f06fa; height: 24px; padding: 0 8px; display: inline-flex; align-items: center; gap: 3px; cursor: pointer;">
        <i class="ri-close-line"></i> Quitar filtro
      </button>
    </div>
  `;
}
window.updateActiveStoreFilterBannerUI = updateActiveStoreFilterBannerUI;

window.selectAndCalculateCommerce = function(commerceName) {
  const sel = document.getElementById('bg-select-commerce');
  if (sel) {
    sel.value = commerceName;
    if (typeof executeCalculationFromUI === 'function') {
      executeCalculationFromUI();
    }
  }
};

// Renderizar Tarjetas de KPI
export function renderKPIsUI() {
  const container = document.getElementById('bg-kpis-container');
  if (!container) return;

  const b = billingState;
  const t = b.totals || {};
  const isLocked = Boolean(b.isLocked);

  let statusBadgeHTML = '';
  if (b.isPaid) {
    statusBadgeHTML = '<span style="background: rgba(16, 185, 129, 0.16); color: #059669; border: 1px solid rgba(16, 185, 129, 0.4); padding: 2px 7px; border-radius: 4px; font-weight: 800; font-size: 0.65rem; text-transform: none; display: inline-flex; align-items: center; gap: 3px;"><i class="ri-lock-2-fill"></i> Pagado · Cerrado</span>';
  } else if (b.isPublished || b.savedRecordStatus === 'Publicado') {
    statusBadgeHTML = `<span style="background: rgba(168, 85, 247, 0.15); color: #7e22ce; border: 1px solid rgba(168, 85, 247, 0.35); padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.65rem; text-transform: none; display: inline-flex; align-items: center; gap: 3px;"><i class="${isLocked ? 'ri-lock-line' : 'ri-send-plane-fill'}"></i> ${isLocked ? 'Confirmado · Cerrado' : 'Publicado'}</span>`;
  } else if (b.isSaved) {
    statusBadgeHTML = '<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.65rem; text-transform: none;"><i class="ri-checkbox-circle-line"></i> Guardado</span>';
  } else {
    statusBadgeHTML = '<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.65rem; text-transform: none;"><i class="ri-time-line"></i> Borrador</span>';
  }

  container.innerHTML = `
    <div class="bg-kpi-card" style="border-left: 4px solid #5f06fa;">
      <div class="bg-kpi-title" style="display: flex; align-items: center; justify-content: space-between;">
        <span><i class="ri-money-dollar-circle-line" style="color: #5f06fa;"></i> ${t.totalAbonos > 0 ? 'MONTO A PAGAR (SALDO)' : 'TOTAL FACTURA (CON IVA)'}</span>
        ${statusBadgeHTML}
      </div>
      <div class="bg-kpi-value text-stocka-purple">${formatCLP(t.totalToPay)}</div>
      <div class="bg-kpi-subtitle">
        ${t.totalAbonos > 0 
          ? `Facturar: <strong>${formatCLP(t.totalGross)}</strong> · Abonos: <strong style="color: #10b981;">-${formatCLP(t.totalAbonos)}</strong>` 
          : `Neto: ${formatCLP(t.totalNet)} + IVA: ${formatCLP(t.iva)}`}
      </div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #0284c7;">
      <div class="bg-kpi-title"><i class="ri-box-3-line" style="color: #0284c7;"></i> PEDIDOS PROCESADOS</div>
      <div class="bg-kpi-value" style="color: #0284c7;">${t.billableOrdersCount || 0} <span style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted, #94a3b8);">/ ${t.ordersCount || 0}</span></div>
      <div class="bg-kpi-subtitle">Pick & Pack Base: ${formatCLP(b.activeRange?.pick_pack_base || 1250)}</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #10b981; ${isLocked ? 'cursor: default;' : 'cursor: pointer;'} position: relative;" ${isLocked ? '' : 'onclick="window.openEditStorageFeeModal()" title="Clic para configurar volumen mensual (m³), tarifa o descuento de almacenamiento"'}>
      <div class="bg-kpi-title" style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
        <span style="display: inline-flex; align-items: center; gap: 6px;"><i class="ri-archive-2-line" style="color: #10b981;"></i> ALMACENAMIENTO MES</span>
        ${!isLocked ? `
          <span class="no-print" style="display: inline-flex; align-items: center; gap: 3px; font-size: 0.65rem; font-weight: 800; color: #5f06fa; background: rgba(95,6,250,0.08); border: 1px solid rgba(95,6,250,0.22); padding: 1px 6px; border-radius: 999px; text-transform: none; letter-spacing: 0;">
            <i class="ri-edit-2-line"></i> ${b.isManualVolume ? 'Manual · Editar' : 'Editar m³'}
          </span>
        ` : ''}
      </div>
      <div class="bg-kpi-value" style="color: #10b981; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span>${formatDec(b.volumeM3, 2)} <span style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted, #94a3b8);">m³</span></span>
        ${b.isManualVolume ? `<span class="no-print" style="background: #5f06fa; color: #ffffff; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.3px;">MANUAL</span>` : ''}
      </div>
      <div class="bg-kpi-subtitle">
        ${b.isManualVolume
          ? `<span class="no-print" style="color: #5f06fa; font-weight: 700;">Fijado manual (Auto: ${formatDec(b.autoVolumeM3 || 0, 2)} m³) · </span><span>${formatCLP(t.storageNet)} neto</span>`
          : `Promedio ${b.volumeDaysLogged || 0} días (${formatCLP(t.storageNet)} neto)`}
      </div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #f59e0b;">
      <div class="bg-kpi-title"><i class="ri-flashlight-line" style="color: #f59e0b;"></i> DESPACHOS RM / FLEX</div>
      <div class="bg-kpi-value" style="color: #f59e0b;">${t.shippingRmFlexCount || 0} <span style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted, #94a3b8);">envíos</span></div>
      <div class="bg-kpi-subtitle">Neto Despachos: ${formatCLP(t.shippingRmFlexNet)}</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid ${t.fixedFeeUF > 0 ? '#ef4444' : '#10b981'};">
      <div class="bg-kpi-title"><i class="ri-shield-star-line" style="color: ${t.fixedFeeUF > 0 ? '#ef4444' : '#10b981'};"></i> COSTO VARIABLE MENSUAL</div>
      <div class="bg-kpi-value" style="color: ${t.fixedFeeUF > 0 ? '#ef4444' : '#10b981'};">
        ${t.fixedFeeUF > 0 ? `${formatDec(t.fixedFeeUF, 1)} UF` : 'EXENTO'}
      </div>
      <div class="bg-kpi-subtitle">${t.fixedFeeUF > 0 ? formatCLP(t.fixedFeeNet) : 'Metas de actividad alcanzadas'}</div>
    </div>

    ${(t.posActive || t.posFeeUF > 0) ? `
    <div class="bg-kpi-card" style="border-left: 4px solid #0ea5e9;">
      <div class="bg-kpi-title"><i class="ri-store-3-line" style="color: #0ea5e9;"></i> PUNTO DE VENTA (POS)</div>
      <div class="bg-kpi-value" style="color: #0ea5e9;">
        ${t.posFeeUF > 0 ? `${formatDec(t.posFeeUF, 1)} UF` : 'EXENTO'}
      </div>
      <div class="bg-kpi-subtitle">${t.posFeeUF > 0 ? formatCLP(t.posFeeNet) : '$0'} · ${t.posIsStocka ? 'Equipo STOCKA' : 'Equipo Propio'}</div>
    </div>
    ` : ''}
  `;
}
window.renderKPIsUI = renderKPIsUI;

// Generador del badge de Estado WMS (Despachado, Pickeado, En preparación, etc.)
export function getWmsStatusBadgeHTML(status) {
  const raw = String(status || 'Completado').trim();
  const lower = raw.toLowerCase();

  let cls = 'bg-wms-default';
  let icon = 'ri-record-circle-line';

  if (lower.includes('despachado') || lower.includes('entregado')) {
    cls = 'bg-wms-despachado';
    icon = 'ri-truck-line';
  } else if (lower.includes('pickeado')) {
    cls = 'bg-wms-pickeado';
    icon = 'ri-check-double-line';
  } else if (lower.includes('preparación') || lower.includes('preparacion')) {
    cls = 'bg-wms-preparacion';
    icon = 'ri-time-line';
  } else if (lower.includes('procesamiento')) {
    cls = 'bg-wms-procesamiento';
    icon = 'ri-loader-4-line';
  } else if (lower.includes('incidencia')) {
    cls = 'bg-wms-incidencia';
    icon = 'ri-error-warning-line';
  } else if (lower.includes('cancelado')) {
    cls = 'bg-wms-incidencia';
    icon = 'ri-close-circle-line';
  } else if (lower.includes('archivado')) {
    cls = 'bg-wms-archivado';
    icon = 'ri-archive-line';
  } else {
    cls = 'bg-wms-despachado';
    icon = 'ri-checkbox-circle-line';
  }

  return `<span class="bg-order-wms-badge ${cls}" title="Estado WMS: ${escapeHtml(raw)}"><i class="${icon}"></i> ${escapeHtml(raw)}</span>`;
}

// Sincronizar cabeceras dinámicas de columnas de cobro personalizadas en la tabla Excel
function syncCustomColumnsHeaderDOM() {
  const prepTotalTh = document.getElementById('bg-th-prep-total');
  if (!prepTotalTh || !prepTotalTh.parentElement) return;

  const headerRow = prepTotalTh.parentElement;
  headerRow.querySelectorAll('.bg-custom-surcharge-th').forEach(el => el.remove());

  const isLocked = Boolean(billingState.isLocked);
  const customCols = Array.isArray(billingState.customColumns) ? billingState.customColumns : [];
  customCols.forEach(col => {
    const th = document.createElement('th');
    th.className = 'bg-custom-surcharge-th';
    th.style.cssText = 'width: 110px; min-width: 98px; text-align: right; background: #fff7ed; color: #9a3412; border-left: 1px dashed #fdba74; border-right: 1px dashed #fdba74; vertical-align: middle;';
    const modeBadge = col.mode === 'per_unit'
      ? `${formatCLP(col.rate || 0)}/unid`
      : `${formatCLP(col.rate || 0)} global`;
    th.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 3px; width: 100%;">
          <span style="font-size: 0.72rem; font-weight: 800; color: #9a3412; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 72px;" title="${escapeHtml(col.name)} (${escapeHtml(modeBadge)})">${escapeHtml(col.name)}</span>
          ${!isLocked ? `
            <button type="button" onclick="window.openEditCustomColumnModal('${escapeHtml(col.id)}')" title="Editar columna de recargo (${escapeHtml(col.name)})" style="background: transparent; border: none; cursor: pointer; color: #ea580c; padding: 0 1px; font-size: 0.78rem; line-height: 1;">
              <i class="ri-settings-4-line"></i>
            </button>
            <button type="button" onclick="window.deleteCustomColumn('${escapeHtml(col.id)}')" title="Eliminar columna de recargo" style="background: transparent; border: none; cursor: pointer; color: #dc2626; padding: 0 1px; font-size: 0.78rem; line-height: 1;">
              <i class="ri-close-circle-line"></i>
            </button>
          ` : ''}
        </div>
        <span style="font-size: 0.62rem; font-weight: 700; color: #c2410c; background: #ffedd5; padding: 0px 4px; border-radius: 3px; line-height: 1.2;">
          ${escapeHtml(modeBadge)}
        </span>
      </div>
    `;
    headerRow.insertBefore(th, prepTotalTh);
  });

  const filterColspanTh = document.getElementById('bg-filter-row-values-colspan');
  if (filterColspanTh) {
    filterColspanTh.setAttribute('colspan', String(7 + customCols.length));
  }
}

// Renderizar Filas de la Tabla Editable
export function renderOrdersTableUI() {
  const tbody = document.getElementById('bg-orders-table-body');
  if (!tbody) return;

  const isLocked = Boolean(billingState.isLocked);
  const gridTable = document.getElementById('bg-orders-excel-grid');
  if (gridTable) {
    gridTable.classList.toggle('bg-table-locked', isLocked);
  }
  const masterCheckbox = document.getElementById('bg-master-inclusion-checkbox');
  if (masterCheckbox) {
    masterCheckbox.disabled = isLocked;
  }

  syncCustomColumnsHeaderDOM();
  const customCols = Array.isArray(billingState.customColumns) ? billingState.customColumns : [];

  const orders = billingState.orders || [];
  if (orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${17 + customCols.length}" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
          <i class="ri-inbox-line" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: #5f06fa;"></i>
          No se encontraron pedidos asignados al periodo <strong>${escapeHtml(billingState.currentPeriodName || '')}</strong> para este comercio.<br>
          <span style="font-size: 0.8rem; margin-top: 0.25rem; display: inline-block;">Asigna el periodo en el <strong>Gestor de Pedidos</strong> para que aparezcan aquí automáticamente.</span>
        </td>
      </tr>
    `;
    updateQuickPillCounts([]);
    updateAgendaFilterOptions([]);
    updateCategoriaFilterOptions([]);
    updateStoreFilterOptions([]);
    updateDeliveryFilterOptions();
    const countBadge = document.getElementById('bg-filter-count-badge');
    if (countBadge) countBadge.textContent = 'Mostrando 0 de 0 pedidos';
    return;
  }

  const deliveryTypes = getDeliveryTypes(billingState.pricingConfig);
  const disAttr = isLocked ? 'disabled' : '';

  tbody.innerHTML = orders.map((o) => {
    const isChecked = !o.isExcluded;
    const rowClass = isChecked ? '' : 'style="opacity: 0.5; background: #f1f5f9;"';

    // 1. Agenda check: junto al número de pedido, marcar en rojo si está vacío
    const rawAgendaStr = String(o.agenda || '').trim();
    const hasAgenda = rawAgendaStr !== '' && rawAgendaStr !== '—' && rawAgendaStr !== '-';
    const agendaText = hasAgenda ? rawAgendaStr : '';
    const agendaBadge = hasAgenda
      ? `<span class="bg-order-agenda-badge" title="Agenda asignada: ${escapeHtml(agendaText)}"><i class="ri-calendar-event-line"></i> ${escapeHtml(agendaText)}</span>`
      : `<span class="bg-order-agenda-badge-empty" title="Sin agenda asignada en el Gestor de Pedidos"><i class="ri-alert-line"></i> Sin Agenda</span>`;

    // 1b. Estado WMS al lado de la etiqueta de agenda
    const wmsStatusText = String(o.estadoWms || 'Completado').trim();
    const wmsStatusBadge = getWmsStatusBadgeHTML(wmsStatusText);

    // 2. Operador junto a la comuna, y abajo el método de envío
    const rawOperadorStr = String(o.operador || '').trim();
    const hasOperador = rawOperadorStr !== '' && rawOperadorStr !== '—' && rawOperadorStr !== '-';
    const operadorText = hasOperador ? rawOperadorStr : 'S/Op';
    const operadorBadge = hasOperador
      ? `<span class="bg-order-operador-badge" title="Operador en Gestor: ${escapeHtml(operadorText)}"><i class="ri-truck-line"></i> ${escapeHtml(operadorText)}</span>`
      : `<span class="bg-order-operador-badge-empty" title="Sin operador asignado">S/Op</span>`;

    const rawShippingMethodStr = String(o.shippingMethod || '').trim();
    const shippingMethodText = (rawShippingMethodStr !== '' && rawShippingMethodStr !== '—' && rawShippingMethodStr !== '-')
      ? rawShippingMethodStr
      : 'Sin método';

    const customColsCellsHTML = customCols.map(col => {
      const val = (o.customSurcharges && o.customSurcharges[col.id] !== undefined)
        ? (Number(o.customSurcharges[col.id]) || 0)
        : calculateCustomColumnRuleAmount(col, o);
      const isManual = Boolean(o.customSurchargesMeta && (o.customSurchargesMeta[col.id] === 'manual' || o.customSurchargesMeta[col.id]?.isManual));
      const modeHint = col.mode === 'per_unit'
        ? `${formatCLP(col.rate || 0)} × ${o.unitsCount || 1} unid.${isManual ? ' (Editado manual)' : ''}`
        : `Valor global (${formatCLP(col.rate || 0)})${isManual ? ' (Editado manual)' : ''}`;
      return `
        <td class="bg-custom-surcharge-td" style="text-align: right; background: rgba(255, 247, 237, 0.45); border-left: 1px dashed #fed7aa; border-right: 1px dashed #fed7aa;">
          <input type="number" class="bg-excel-input" value="${val}" min="0" ${disAttr}
            style="text-align: right; width: 78px; font-weight: 700; color: ${val > 0 ? '#ea580c' : '#64748b'}; ${isManual ? 'border-color: #f97316; background: #fff7ed;' : ''}"
            onchange="window.updateBgOrderCustomColumn('${o.id}', '${col.id}', this.value)"
            title="${escapeHtml(col.name)}: ${escapeHtml(modeHint)}">
        </td>
      `;
    }).join('');

    const isOrderPos = Boolean(o.isPosOrder || isPosSaleOrder(o));
    const orderCategoria = resolveOrderBillingCategoria(o);
    o.categoriaEntrega = orderCategoria;

    return `
      <tr ${rowClass} id="bg-row-${o.id}" data-id="${o.id}"
          data-order="${escapeHtml((o.orderNumber || '').toLowerCase())}"
          data-comercio="${escapeHtml((o.comercio || '').toLowerCase())}"
          data-date="${escapeHtml((o.date || '').toLowerCase())}"
          data-agenda="${escapeHtml(agendaText.toLowerCase())}"
          data-has-agenda="${hasAgenda ? '1' : '0'}"
          data-categoria="${escapeHtml(orderCategoria)}"
          data-wms="${escapeHtml((wmsStatusText || '').toLowerCase())}"
          data-dest="${escapeHtml((o.destination || '').toLowerCase())}"
          data-operador="${escapeHtml(operadorText.toLowerCase())}"
          data-method="${escapeHtml(shippingMethodText.toLowerCase())}"
          data-ticket="${o.ticketVenta || 0}"
          data-delivery="${o.deliveryType}"
          data-skus="${o.skuCount}"
          data-units="${o.unitsCount}"
          data-mkt="${o.isMarketplace ? '1' : '0'}"
          data-pos="${isOrderPos ? '1' : '0'}"
          data-inc="${isChecked ? '1' : '0'}">
        <td style="text-align: center;">
          <input type="checkbox" ${isChecked ? 'checked' : ''} ${disAttr} onchange="window.toggleBgOrderInclusion('${o.id}', this.checked)" style="cursor: pointer; width: 16px; height: 16px; accent-color: #5f06fa;">
        </td>
        <td style="text-align: center; color: #64748b; font-weight: 700;">${o.rowNumber}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
            <strong style="color: var(--color-text-main); font-size: 0.85rem;">${escapeHtml(o.orderNumber)}</strong>
            ${o.isConsolidatedPrimary ? `
              <span style="background: #eef2ff; color: #4338ca; border: 1px solid #a5b4fc; font-size: 0.65rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Pedido Principal Consolidado: Incluye flete del envío unificado + preparación individual">
                <i class="ri-links-fill"></i> CONSOLIDADO PRINCIPAL${Array.isArray(o.consolidatedChildrenFolios) && o.consolidatedChildrenFolios.length > 0 ? ` (+${escapeHtml(o.consolidatedChildrenFolios.join(', '))})` : ''}
              </span>
            ` : ''}
            ${o.isConsolidatedSecondary ? `
              <span style="background: #f0fdfa; color: #0f766e; border: 1px solid #5eead4; font-size: 0.65rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Pedido Secundario Consolidado: Se cobra preparación (Pick & Pack) y $0 de Flete de Envío (viaja en paquete principal ${escapeHtml(o.consolidatedIntoFolio || '')})">
                <i class="ri-git-merge-line"></i> CONSOLIDADO EN ${escapeHtml(o.consolidatedIntoFolio || 'PRINCIPAL')} (FLETE $0)
              </span>
            ` : ''}
            ${isOrderPos ? `
              <span class="bg-order-pos-badge" title="Pedido de Punto de Venta físico (Tarifa Prep. Base $1.490 · Despacho $0)">
                <i class="ri-store-3-fill"></i> PUNTO DE VENTA
              </span>
            ` : ''}
            ${billingState.isConglomerate && o.comercio ? `
              <span class="bg-order-child-store-badge" title="Tienda del conglomerado: ${escapeHtml(o.comercio)}">
                <i class="ri-store-2-line"></i> ${escapeHtml(o.comercio)}
              </span>
            ` : ''}
            ${agendaBadge}
            ${wmsStatusBadge}
          </div>
          <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 2px;">
            <i class="ri-calendar-line"></i> ${escapeHtml(o.date)}
          </div>
        </td>
        <td style="text-align: center; white-space: nowrap;">
          ${getBillingOrderCategoriaBadgeHTML(o)}
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
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.ticketVenta || 0}" ${disAttr} style="text-align: right; width: 85px; font-weight: 700; color: #0f766e;" onchange="window.updateBgOrderCell('${o.id}', 'ticketVenta', this.value)" title="Ticket de venta del pedido (monto de compra cliente: ${formatCLP(o.ticketVenta || 0)})">
        </td>
        <td>
          <select class="bg-excel-select" ${disAttr} onchange="window.updateBgOrderDeliveryType('${o.id}', this.value)" style="width: 100%;">
            ${deliveryTypes.map(dt => `
              <option value="${escapeHtml(dt.key)}" ${o.deliveryType === dt.key ? 'selected' : ''}>
                ${escapeHtml(dt.name)} (${formatCLP(dt.price)})
              </option>
            `).join('')}
          </select>
        </td>
        <td style="text-align: center; padding: 3px 2px;">
          <input type="number" class="bg-excel-input" value="${o.skuCount}" min="1" ${disAttr} style="text-align: center; font-weight: 700; width: 100%; font-size: 0.88rem; padding: 2px 0;" onchange="window.updateBgOrderCell('${o.id}', 'skuCount', this.value)">
        </td>
        <td style="text-align: center; padding: 3px 2px;">
          <input type="number" class="bg-excel-input" value="${o.unitsCount}" min="1" ${disAttr} style="text-align: center; font-weight: 700; width: 100%; font-size: 0.88rem; padding: 2px 0;" onchange="window.updateBgOrderCell('${o.id}', 'unitsCount', this.value)">
        </td>
        <td style="text-align: center;">
          <input type="checkbox" ${o.isMarketplace ? 'checked' : ''} ${disAttr} onchange="window.updateBgOrderCell('${o.id}', 'isMarketplace', this.checked)" style="accent-color: #5f06fa; cursor: pointer;">
        </td>
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.baseRate}" min="0" ${disAttr} style="text-align: right; width: 75px; font-weight: 600;" onchange="window.updateBgOrderCell('${o.id}', 'baseRate', this.value)" title="Tarifa Base Pick & Pack: ${formatCLP(o.baseRate)}">
        </td>
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.surchargeSku || 0}" min="0" ${disAttr}
            style="text-align: right; width: 72px; font-weight: 700; color: ${(o.surchargeSku || 0) > 0 ? '#ea580c' : '#64748b'}; ${o.surchargeSkuManual ? 'border-color: #f97316; background: #fff7ed;' : ''}"
            onchange="window.updateBgOrderCell('${o.id}', 'surchargeSku', this.value)"
            title="Recargo SKU Extra: ${formatCLP(o.surchargeSku || 0)}${o.surchargeSkuManual ? ' (Editado manualmente)' : ''}">
        </td>
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.surchargeUnits || 0}" min="0" ${disAttr}
            style="text-align: right; width: 76px; font-weight: 700; color: ${(o.surchargeUnits || 0) > 0 ? '#ea580c' : '#64748b'}; ${o.surchargeUnitsManual ? 'border-color: #f97316; background: #fff7ed;' : ''}"
            onchange="window.updateBgOrderCell('${o.id}', 'surchargeUnits', this.value)"
            title="Recargo Unidades Extra: ${formatCLP(o.surchargeUnits || 0)}${o.surchargeUnitsManual ? ' (Editado manualmente)' : ''}">
        </td>
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.surchargeMarketplace || 0}" min="0" ${disAttr}
            style="text-align: right; width: 72px; font-weight: 700; color: ${(o.surchargeMarketplace || 0) > 0 ? '#ea580c' : '#64748b'}; ${o.surchargeMarketplaceManual ? 'border-color: #f97316; background: #fff7ed;' : ''}"
            onchange="window.updateBgOrderCell('${o.id}', 'surchargeMarketplace', this.value)"
            title="Recargo Marketplace: ${formatCLP(o.surchargeMarketplace || 0)}${o.surchargeMarketplaceManual ? ' (Editado manualmente)' : ''}">
        </td>
        ${customColsCellsHTML}
        <td style="text-align: right; font-weight: 700; color: var(--color-text-main);" title="Base: ${formatCLP(o.baseRate)} | SKU: ${formatCLP(o.surchargeSku)} | Unid: ${formatCLP(o.surchargeUnits)} | Mkt: ${formatCLP(o.surchargeMarketplace)}${o.customSurchargesTotal > 0 ? ` | Recargos Extra: ${formatCLP(o.customSurchargesTotal)}` : ''}">
          ${formatCLP(o.pickPackTotal)}
        </td>
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.shippingFreight}" ${disAttr} style="text-align: right; width: 80px; font-weight: 700; color: #5f06fa;" onchange="window.updateBgOrderCell('${o.id}', 'shippingFreight', this.value)">
        </td>
        <td style="text-align: right; font-weight: 800; color: #5f06fa; background: rgba(95, 6, 250, 0.05); font-size: 0.85rem;">
          ${formatCLP(o.orderTotal)}
        </td>
      </tr>
    `;
  }).join('');

  // 3. Actualizar conteos de filtros rápidos y opciones dinámicas de agendas, categorías y tipos de entrega
  updateQuickPillCounts(orders);
  updateAgendaFilterOptions(orders);
  updateCategoriaFilterOptions(orders);
  updateStoreFilterOptions(orders);
  updateDeliveryFilterOptions(orders);

  // 4. Restaurar valores en los inputs de filtros si estaban activos
  if (window.bgFilterState) {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el && v !== undefined && v !== null) el.value = v;
    };
    setVal('bg-filter-order-input', window.bgFilterState.global);
    setVal('bg-col-filter-inc', window.bgFilterState.inc);
    setVal('bg-col-filter-order', window.bgFilterState.order);
    setVal('bg-col-filter-store', window.bgFilterState.store);
    setVal('bg-col-filter-agenda', window.bgFilterState.agenda);
    setVal('bg-col-filter-categoria', window.bgFilterState.categoria);
    setVal('bg-col-filter-dest', window.bgFilterState.dest);
    setVal('bg-col-filter-ticket-min', window.bgFilterState.ticketMin);
    setVal('bg-col-filter-ticket-max', window.bgFilterState.ticketMax);
    setVal('bg-col-filter-delivery', window.bgFilterState.delivery);
    setVal('bg-col-filter-skus', window.bgFilterState.skus);
    setVal('bg-col-filter-units', window.bgFilterState.units);
    setVal('bg-col-filter-mkt', window.bgFilterState.mkt);
  }

  // 4b. Actualizar banner de tienda activa del holding si aplica
  updateActiveStoreFilterBannerUI();

  // 5. Reaplicar filtros activos
  window.applyBgColumnFilters();
}

// Funciones de Edición Inline en el Grid
window.toggleBgOrderInclusion = function(orderId, isChecked) {
  if (guardBillingLocked()) {
    renderOrdersTableUI();
    return;
  }
  const order = billingState.orders.find(o => String(o.id) === String(orderId));
  if (order) {
    order.isExcluded = !isChecked;
    billingState.isSaved = false;
    recalculateFromCurrentState();
  }
};

window.updateBgOrderDeliveryType = function(orderId, newType) {
  if (guardBillingLocked()) {
    renderOrdersTableUI();
    return;
  }
  const order = billingState.orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  const deliveryTypes = getDeliveryTypes(billingState.pricingConfig);
  const dt = deliveryTypes.find(d => d.key === newType);

  order.deliveryType = newType;
  if (newType === 'POS') {
    order.isPosOrder = true;
    order.shippingFreight = 0;
    if (!order.baseRateManual) {
      order.baseRate = (billingState.pricingConfig?.services?.showroom_sale_base) || (billingState.pricingConfig?.shipping?.pickup_express_base) || 1490;
    }
    recomputeOrderPickPackWithCustomColumns(order, billingState.customColumns);
  } else if (order.isConsolidatedSecondary && !order.shippingFreightManual) {
    order.shippingFreight = 0;
  } else {
    order.shippingFreight = dt ? dt.price : 0;
  }

  order.orderTotal = order.pickPackTotal + order.shippingFreight;
  billingState.isSaved = false;
  recalculateFromCurrentState();
};

window.updateBgOrderCell = function(orderId, field, value) {
  if (guardBillingLocked()) {
    renderOrdersTableUI();
    return;
  }
  const order = billingState.orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  const rules = billingState.pricingConfig?.pick_pack_rules || {};

  if (field === 'skuCount') {
    order.skuCount = Math.max(1, parseInt(value, 10) || 1);
    const extraSku = Math.max(0, order.skuCount - (rules.base_included_sku || 3));
    order.surchargeSku = extraSku * (rules.surcharge_extra_sku || 100);
    order.surchargeSkuManual = false;
  } else if (field === 'unitsCount') {
    order.unitsCount = Math.max(1, parseInt(value, 10) || 1);
    const extraUnits = Math.max(0, order.unitsCount - (rules.base_included_units || 10));
    order.surchargeUnits = extraUnits * (rules.surcharge_extra_unit || 50);
    order.surchargeUnitsManual = false;
  } else if (field === 'surchargeSku') {
    order.surchargeSku = Math.max(0, Math.round(Number(value) || 0));
    order.surchargeSkuManual = true;
  } else if (field === 'surchargeUnits') {
    order.surchargeUnits = Math.max(0, Math.round(Number(value) || 0));
    order.surchargeUnitsManual = true;
  } else if (field === 'surchargeMarketplace') {
    order.surchargeMarketplace = Math.max(0, Math.round(Number(value) || 0));
    order.surchargeMarketplaceManual = true;
  } else if (field === 'isMarketplace') {
    order.isMarketplace = !!value;
    const mktSurcharge = rules.surcharge_marketplace_collect || 100;
    order.surchargeMarketplace = order.isMarketplace ? mktSurcharge : 0;
    order.surchargeMarketplaceManual = false;
  } else if (field === 'baseRate') {
    order.baseRate = Math.max(0, parseInt(value, 10) || 0);
    order.baseRateManual = true;
  } else if (field === 'shippingFreight') {
    order.shippingFreight = Math.max(0, parseInt(value, 10) || 0);
    order.shippingFreightManual = true;
  } else if (field === 'ticketVenta') {
    order.ticketVenta = Math.max(0, parseInt(value, 10) || 0);
  }

  billingState.isSaved = false;
  recomputeOrderPickPackWithCustomColumns(order, billingState.customColumns);
  order.orderTotal = order.pickPackTotal + order.shippingFreight;

  recalculateFromCurrentState();
};

// Actualizar valor de una columna de cobro personalizada en un pedido específico
window.updateBgOrderCustomColumn = function(orderId, colId, rawValue) {
  if (guardBillingLocked()) {
    renderOrdersTableUI();
    return;
  }
  const order = billingState.orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  if (!order.customSurcharges || typeof order.customSurcharges !== 'object') {
    order.customSurcharges = {};
  }
  if (!order.customSurchargesMeta || typeof order.customSurchargesMeta !== 'object') {
    order.customSurchargesMeta = {};
  }

  const val = Math.max(0, Math.round(Number(rawValue) || 0));
  order.customSurcharges[colId] = val;
  order.customSurchargesMeta[colId] = 'manual';

  recomputeOrderPickPackWithCustomColumns(order, billingState.customColumns);
  order.orderTotal = order.pickPackTotal + (order.shippingFreight || 0);

  recalculateFromCurrentState();
};

// Modal para añadir una nueva columna de cobro (recargo de preparación por unidad o global)
window.openAddCustomColumnModal = async function() {
  if (guardBillingLocked()) return;
  const allOrders = billingState.orders || [];
  const visibleRows = Array.from(document.querySelectorAll('#bg-orders-table-body tr[id^="bg-row-"]')).filter(r => r.style.display !== 'none');
  const visibleIds = new Set(visibleRows.map(r => String(r.getAttribute('data-id'))));
  const filteredCount = allOrders.filter(o => visibleIds.has(String(o.id))).length;
  const includedCount = allOrders.filter(o => !o.isExcluded).length;
  const defaultScope = (filteredCount > 0 && filteredCount < allOrders.length) ? 'filtered' : 'included';

  const { value: formVal } = await Swal.fire({
    title: '<span style="color: #1e293b; font-size: 1.1rem; font-weight: 800; display: inline-flex; align-items: center; gap: 6px;"><i class="ri-layout-column-line" style="color: #ea580c;"></i> Nueva Columna de Cobro (Recargo Prep.)</span>',
    html: `
      <div style="text-align: left; font-size: 0.85rem; color: #1e293b;">
        <p style="font-size: 0.76rem; color: #64748b; margin: 0 0 12px 0; line-height: 1.35;">
          Añade una columna personalizada de recargo de preparación. Su monto se sumará directamente al <strong>Costo de Preparación (Prep. Total)</strong> de cada pedido.
        </p>

        <div style="margin-bottom: 12px;">
          <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 4px; text-transform: uppercase;">1. Nombre del Recargo / Columna</label>
          <input id="swal-cc-name" type="text" class="form-input" placeholder="Ej: Recargo Prep., Etiquetado, Armado Kit, Embalaje Especial..." value="Recargo Prep." style="width: 100%; height: 36px; font-size: 0.85rem; border-radius: 6px;">
        </div>

        <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div>
            <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 4px; text-transform: uppercase;">2. Modalidad de Cálculo</label>
            <select id="swal-cc-mode" class="form-input" style="width: 100%; height: 36px; font-size: 0.82rem; border-radius: 6px; font-weight: 600;">
              <option value="per_unit">Por Unidad (Valor × Unid. del pedido)</option>
              <option value="global">Global por Pedido (Monto fijo por pedido)</option>
            </select>
          </div>
          <div>
            <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 4px; text-transform: uppercase;">3. Valor ($ CLP Neto)</label>
            <input id="swal-cc-rate" type="number" class="form-input" min="0" value="100" placeholder="100" style="width: 100%; height: 36px; font-size: 0.85rem; text-align: right; font-weight: 700; border-radius: 6px;">
          </div>
        </div>

        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px;">
          <label style="font-size: 0.74rem; font-weight: 800; color: #9a3412; display: block; margin-bottom: 6px; text-transform: uppercase;">
            <i class="ri-focus-3-line"></i> 4. Aplicación Inicial en Pedidos
          </label>
          <div style="display: flex; flex-direction: column; gap: 5px; font-size: 0.78rem;">
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="radio" name="swal-cc-scope" value="included" ${defaultScope === 'included' ? 'checked' : ''} style="accent-color: #ea580c;">
              <span>Aplicar a todos los pedidos incluidos (${includedCount} pedidos)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="radio" name="swal-cc-scope" value="filtered" ${defaultScope === 'filtered' ? 'checked' : ''} style="accent-color: #ea580c;">
              <span>Aplicar solo a los pedidos filtrados/visibles hoy (${filteredCount} pedidos) y dejar el resto en $0</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="radio" name="swal-cc-scope" value="zero" style="accent-color: #ea580c;">
              <span>Iniciar todos los pedidos en $0 (para digitar manualmente en la tabla)</span>
            </label>
          </div>
        </div>
      </div>
    `,
    width: '540px',
    showCancelButton: true,
    confirmButtonText: '<i class="ri-add-line"></i> Crear Columna y Sumar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#ea580c',
    focusConfirm: false,
    preConfirm: () => {
      const name = (document.getElementById('swal-cc-name')?.value || '').trim();
      const mode = document.getElementById('swal-cc-mode')?.value || 'per_unit';
      const rate = Math.max(0, Math.round(Number(document.getElementById('swal-cc-rate')?.value) || 0));
      const scope = document.querySelector('input[name="swal-cc-scope"]:checked')?.value || 'included';

      if (!name) {
        Swal.showValidationMessage('Ingresa un nombre para la columna de recargo.');
        return false;
      }
      return { name, mode, rate, scope };
    }
  });

  if (!formVal) return;

  if (!Array.isArray(billingState.customColumns)) {
    billingState.customColumns = [];
  }

  const newCol = {
    id: 'cc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: formVal.name,
    mode: formVal.mode === 'per_unit' ? 'per_unit' : 'global',
    rate: formVal.rate
  };

  billingState.customColumns.push(newCol);
  billingState.customColumnsSessionKey = `${billingState.currentPeriodId || ''}_${billingState.currentComercio || ''}`;

  (billingState.orders || []).forEach(ord => {
    if (!ord.customSurcharges || typeof ord.customSurcharges !== 'object') ord.customSurcharges = {};
    if (!ord.customSurchargesMeta || typeof ord.customSurchargesMeta !== 'object') ord.customSurchargesMeta = {};

    if (formVal.scope === 'zero') {
      ord.customSurcharges[newCol.id] = 0;
      ord.customSurchargesMeta[newCol.id] = 'manual';
    } else if (formVal.scope === 'filtered') {
      if (visibleIds.has(String(ord.id))) {
        ord.customSurcharges[newCol.id] = calculateCustomColumnRuleAmount(newCol, ord);
        ord.customSurchargesMeta[newCol.id] = 'rule';
      } else {
        ord.customSurcharges[newCol.id] = 0;
        ord.customSurchargesMeta[newCol.id] = 'manual';
      }
    } else {
      ord.customSurcharges[newCol.id] = calculateCustomColumnRuleAmount(newCol, ord);
      ord.customSurchargesMeta[newCol.id] = 'rule';
    }

    recomputeOrderPickPackWithCustomColumns(ord, billingState.customColumns);
    ord.orderTotal = ord.pickPackTotal + (ord.shippingFreight || 0);
  });

  recalculateFromCurrentState();

  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: `Columna "${newCol.name}" añadida`,
    text: 'Se actualizó el costo de preparación de los pedidos.',
    showConfirmButton: false,
    timer: 3000
  });
};

// Modal para editar una columna de cobro personalizada existente
window.openEditCustomColumnModal = async function(colId) {
  if (guardBillingLocked()) return;
  const customCols = Array.isArray(billingState.customColumns) ? billingState.customColumns : [];
  const col = customCols.find(c => c.id === colId);
  if (!col) return;

  const { value: formVal } = await Swal.fire({
    title: `<span style="color: #1e293b; font-size: 1.05rem; font-weight: 800; display: inline-flex; align-items: center; gap: 6px;"><i class="ri-settings-4-line" style="color: #ea580c;"></i> Editar Columna: ${escapeHtml(col.name)}</span>`,
    html: `
      <div style="text-align: left; font-size: 0.85rem; color: #1e293b;">
        <div style="margin-bottom: 12px;">
          <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 4px; text-transform: uppercase;">Nombre del Recargo / Columna</label>
          <input id="swal-edit-cc-name" type="text" class="form-input" value="${escapeHtml(col.name)}" style="width: 100%; height: 36px; font-size: 0.85rem; border-radius: 6px;">
        </div>

        <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div>
            <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 4px; text-transform: uppercase;">Modalidad de Cálculo</label>
            <select id="swal-edit-cc-mode" class="form-input" style="width: 100%; height: 36px; font-size: 0.82rem; border-radius: 6px; font-weight: 600;">
              <option value="per_unit" ${col.mode === 'per_unit' ? 'selected' : ''}>Por Unidad (Valor × Unid. del pedido)</option>
              <option value="global" ${col.mode !== 'per_unit' ? 'selected' : ''}>Global por Pedido (Monto fijo por pedido)</option>
            </select>
          </div>
          <div>
            <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 4px; text-transform: uppercase;">Valor ($ CLP Neto)</label>
            <input id="swal-edit-cc-rate" type="number" class="form-input" min="0" step="10" value="${Number(col.rate) || 0}" style="width: 100%; height: 36px; font-size: 0.85rem; text-align: right; font-weight: 700; border-radius: 6px;">
          </div>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 600; color: #334155; cursor: pointer;">
            <input type="checkbox" id="swal-edit-cc-recalc-all" checked style="accent-color: #ea580c; width: 15px; height: 15px;">
            <span>Recalcular esta columna en todos los pedidos con la nueva tarifa/modalidad</span>
          </label>
        </div>
      </div>
    `,
    width: '520px',
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#ea580c',
    focusConfirm: false,
    preConfirm: () => {
      const name = (document.getElementById('swal-edit-cc-name')?.value || '').trim();
      const mode = document.getElementById('swal-edit-cc-mode')?.value || 'per_unit';
      const rate = Math.max(0, Math.round(Number(document.getElementById('swal-edit-cc-rate')?.value) || 0));
      const recalcAll = !!document.getElementById('swal-edit-cc-recalc-all')?.checked;
      if (!name) {
        Swal.showValidationMessage('El nombre de la columna no puede estar vacío.');
        return false;
      }
      return { name, mode, rate, recalcAll };
    }
  });

  if (!formVal) return;

  col.name = formVal.name;
  col.mode = formVal.mode === 'per_unit' ? 'per_unit' : 'global';
  col.rate = formVal.rate;

  (billingState.orders || []).forEach(ord => {
    if (!ord.customSurcharges || typeof ord.customSurcharges !== 'object') ord.customSurcharges = {};
    if (!ord.customSurchargesMeta || typeof ord.customSurchargesMeta !== 'object') ord.customSurchargesMeta = {};

    if (formVal.recalcAll || ord.customSurchargesMeta[col.id] !== 'manual') {
      ord.customSurcharges[col.id] = calculateCustomColumnRuleAmount(col, ord);
      ord.customSurchargesMeta[col.id] = 'rule';
    }
    recomputeOrderPickPackWithCustomColumns(ord, billingState.customColumns);
    ord.orderTotal = ord.pickPackTotal + (ord.shippingFreight || 0);
  });

  recalculateFromCurrentState();
};

// Eliminar una columna de cobro personalizada
window.deleteCustomColumn = async function(colId) {
  if (guardBillingLocked()) return;
  const customCols = Array.isArray(billingState.customColumns) ? billingState.customColumns : [];
  const col = customCols.find(c => c.id === colId);
  if (!col) return;

  const { isConfirmed } = await Swal.fire({
    title: '¿Eliminar columna de cobro?',
    html: `Se quitará la columna <strong>${escapeHtml(col.name)}</strong> y se descontará su recargo del costo de preparación de los pedidos.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626'
  });

  if (!isConfirmed) return;

  billingState.customColumns = customCols.filter(c => c.id !== colId);

  (billingState.orders || []).forEach(ord => {
    if (ord.customSurcharges && typeof ord.customSurcharges === 'object') {
      delete ord.customSurcharges[colId];
    }
    if (ord.customSurchargesMeta && typeof ord.customSurchargesMeta === 'object') {
      delete ord.customSurchargesMeta[colId];
    }
    recomputeOrderPickPackWithCustomColumns(ord, billingState.customColumns);
    ord.orderTotal = ord.pickPackTotal + (ord.shippingFreight || 0);
  });

  recalculateFromCurrentState();
};

// Marcar / Desmarcar inclusión de todos los pedidos actualmente visibles
window.toggleAllVisibleOrdersInclusion = function(isChecked) {
  if (guardBillingLocked()) {
    renderOrdersTableUI();
    return;
  }
  const visibleRows = Array.from(document.querySelectorAll('#bg-orders-table-body tr[id^="bg-row-"]')).filter(r => r.style.display !== 'none');
  if (visibleRows.length === 0) return;
  const visibleIds = new Set(visibleRows.map(r => String(r.getAttribute('data-id'))));

  let changedCount = 0;
  (billingState.orders || []).forEach(o => {
    if (visibleIds.has(String(o.id))) {
      if (o.isExcluded !== !isChecked) {
        o.isExcluded = !isChecked;
        changedCount++;
      }
    }
  });

  if (changedCount > 0) {
    recalculateFromCurrentState();
  }
};

// Modal de Edición Masiva de Pedidos
window.openBulkEditOrdersModal = async function(preselectedScope = null) {
  if (guardBillingLocked()) return;
  const allOrders = billingState.orders || [];
  if (allOrders.length === 0) {
    Swal.fire('Sin pedidos', 'No hay pedidos cargados para editar en este periodo.', 'info');
    return;
  }

  // 1. Obtener pedidos visibles según los filtros activos actuales en el DOM
  const visibleRows = Array.from(document.querySelectorAll('#bg-orders-table-body tr[id^="bg-row-"]')).filter(r => r.style.display !== 'none');
  const visibleIds = new Set(visibleRows.map(r => String(r.getAttribute('data-id'))));
  const filteredOrders = allOrders.filter(o => visibleIds.has(String(o.id)));
  const includedOrders = allOrders.filter(o => !o.isExcluded);

  const filteredCount = filteredOrders.length;
  const includedCount = includedOrders.length;
  const totalCount = allOrders.length;

  // Determinar alcance por defecto
  let defaultScope = preselectedScope;
  if (!defaultScope) {
    if (filteredCount < totalCount && filteredCount > 0) {
      defaultScope = 'filtered';
    } else {
      defaultScope = 'all';
    }
  }

  const deliveryTypes = getDeliveryTypes(billingState.pricingConfig);
  const defaultBaseRate = billingState.activeRange?.pick_pack_base || 1250;
  const customCols = Array.isArray(billingState.customColumns) ? billingState.customColumns : [];

  const customColsBulkHTML = customCols.map(col => {
    const ruleDesc = col.mode === 'per_unit'
      ? `Aplicar regla (${formatCLP(col.rate || 0)} × Unid.)`
      : `Aplicar regla (${formatCLP(col.rate || 0)} global)`;
    return `
      <div class="bulk-edit-row" id="row-bulk-cc-${escapeHtml(col.id)}" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px dashed #fdba74; background: #fff7ed;">
        <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #9a3412; flex: 1;">
          <input type="checkbox" id="bulk-chk-cc-${escapeHtml(col.id)}" class="bulk-col-toggle bulk-cc-toggle" data-cc-id="${escapeHtml(col.id)}" data-target="bulk-val-cc-action-${escapeHtml(col.id)}" style="width: 15px; height: 15px; accent-color: #ea580c;">
          <span>Recargo: ${escapeHtml(col.name)}</span>
        </label>
        <div style="display: flex; gap: 4px; width: 240px;">
          <select id="bulk-val-cc-action-${escapeHtml(col.id)}" class="form-input bulk-cc-action-select" data-cc-id="${escapeHtml(col.id)}" style="height: 32px; font-size: 0.75rem; padding: 2px 6px; flex: 1; border-radius: 6px;" disabled>
            <option value="rule">${escapeHtml(ruleDesc)}</option>
            <option value="zero">Dejar en $0 (Sin recargo)</option>
            <option value="fixed">Monto fijo manual ($)</option>
          </select>
          <input type="number" id="bulk-val-cc-amount-${escapeHtml(col.id)}" class="form-input" value="${Number(col.rate) || 0}" min="0" style="height: 32px; font-size: 0.75rem; width: 78px; text-align: right; border-radius: 6px; display: none;" disabled>
        </div>
      </div>
    `;
  }).join('');

  // Construir HTML del modal
  const modalHTML = `
    <div style="text-align: left; font-size: 0.85rem; color: var(--color-text-main);">
      <!-- 1. Selección del Alcance -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 14px;">
        <div style="font-weight: 800; color: #1e293b; font-size: 0.82rem; margin-bottom: 8px; display: flex; align-items: center; gap: 5px;">
          <i class="ri-focus-3-line" style="color: #5f06fa; font-size: 1rem;"></i> 1. ALCANCE: ¿QUÉ PEDIDOS DESEAS MODIFICAR?
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 6px; border-radius: 6px; transition: background 0.15s;" class="bulk-scope-label">
            <input type="radio" name="bulk-scope" value="filtered" ${defaultScope === 'filtered' ? 'checked' : ''} style="accent-color: #5f06fa; width: 15px; height: 15px;">
            <span style="font-weight: 600; color: #334155;">Pedidos filtrados / visibles actualmente</span>
            <span style="margin-left: auto; background: rgba(95, 6, 250, 0.1); color: #5f06fa; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 10px;">
              ${filteredCount} pedidos
            </span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 6px; border-radius: 6px; transition: background 0.15s;" class="bulk-scope-label">
            <input type="radio" name="bulk-scope" value="included" ${defaultScope === 'included' ? 'checked' : ''} style="accent-color: #5f06fa; width: 15px; height: 15px;">
            <span style="font-weight: 600; color: #334155;">Todos los pedidos incluidos para cobro</span>
            <span style="margin-left: auto; background: #dcfce7; color: #15803d; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 10px;">
              ${includedCount} pedidos
            </span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 6px; border-radius: 6px; transition: background 0.15s;" class="bulk-scope-label">
            <input type="radio" name="bulk-scope" value="all" ${defaultScope === 'all' ? 'checked' : ''} style="accent-color: #5f06fa; width: 15px; height: 15px;">
            <span style="font-weight: 600; color: #334155;">Todos los pedidos del periodo (sin excepción)</span>
            <span style="margin-left: auto; background: #f1f5f9; color: #475569; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 10px;">
              ${totalCount} pedidos
            </span>
          </label>
        </div>
      </div>

      <!-- 2. Columnas a Actualizar -->
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
        <div style="font-weight: 800; color: #1e293b; font-size: 0.82rem; margin-bottom: 4px; display: flex; align-items: center; gap: 5px;">
          <i class="ri-checkbox-line" style="color: #5f06fa; font-size: 1rem;"></i> 2. SELECCIONA LAS COLUMNAS A MODIFICAR
        </div>
        <p style="font-size: 0.72rem; color: #64748b; margin-bottom: 12px; line-height: 1.3;">
          Marca únicamente las casillas de las columnas que deseas cambiar. Las que dejes desmarcadas <strong>no se modificarán</strong>.
        </p>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          
          <!-- Columna: Tipo de Entrega -->
          <div class="bulk-edit-row" id="row-bulk-delivery" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <div style="flex: 1;">
              <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b;">
                <input type="checkbox" id="bulk-chk-delivery" class="bulk-col-toggle" data-target="bulk-val-delivery" style="width: 15px; height: 15px; accent-color: #5f06fa;">
                <span>Tipo de Entrega</span>
              </label>
              <div id="bulk-box-sync-freight" style="margin-top: 6px; margin-left: 21px; display: none;">
                <label style="font-size: 0.72rem; color: #5f06fa; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                  <input type="checkbox" id="bulk-sync-freight" checked style="accent-color: #5f06fa;">
                  Actualizar flete según tarifa del tipo
                </label>
              </div>
            </div>
            <div style="width: 200px;">
              <select id="bulk-val-delivery" class="form-input" style="height: 32px; font-size: 0.78rem; padding: 2px 6px; width: 100%; border-radius: 6px;" disabled>
                ${deliveryTypes.map(dt => `<option value="${escapeHtml(dt.key)}">${escapeHtml(dt.name)} (${formatCLP(dt.price)})</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- Columna: Flete Envío ($) -->
          <div class="bulk-edit-row" id="row-bulk-freight" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-freight" class="bulk-col-toggle" data-target="bulk-val-freight" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>Flete Envío ($)</span>
            </label>
            <div style="width: 200px;">
              <input type="number" id="bulk-val-freight" class="form-input" placeholder="0" value="0" min="0" step="50" style="height: 32px; font-size: 0.78rem; text-align: right; width: 100%; border-radius: 6px;" disabled>
            </div>
          </div>

          <!-- Columna: SKUs -->
          <div class="bulk-edit-row" id="row-bulk-skus" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-skus" class="bulk-col-toggle" data-target="bulk-val-skus" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>Cantidad SKUs</span>
            </label>
            <div style="width: 200px;">
              <input type="number" id="bulk-val-skus" class="form-input" placeholder="1" value="1" min="1" style="height: 32px; font-size: 0.78rem; text-align: center; width: 100%; border-radius: 6px;" disabled>
            </div>
          </div>

          <!-- Columna: Unidades -->
          <div class="bulk-edit-row" id="row-bulk-units" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-units" class="bulk-col-toggle" data-target="bulk-val-units" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>Cantidad Unidades</span>
            </label>
            <div style="width: 200px;">
              <input type="number" id="bulk-val-units" class="form-input" placeholder="1" value="1" min="1" style="height: 32px; font-size: 0.78rem; text-align: center; width: 100%; border-radius: 6px;" disabled>
            </div>
          </div>

          <!-- Columna: Marketplace? -->
          <div class="bulk-edit-row" id="row-bulk-mkt" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-mkt" class="bulk-col-toggle" data-target="bulk-val-mkt" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>¿Es Marketplace?</span>
            </label>
            <div style="width: 200px;">
              <select id="bulk-val-mkt" class="form-input" style="height: 32px; font-size: 0.78rem; padding: 2px 6px; width: 100%; border-radius: 6px;" disabled>
                <option value="no">No (Recargo $0)</option>
                <option value="yes">Sí (Recargo $100)</option>
              </select>
            </div>
          </div>

          <!-- Columna: Tarifa Base Pick & Pack ($) -->
          <div class="bulk-edit-row" id="row-bulk-baserate" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-baserate" class="bulk-col-toggle" data-target="bulk-val-baserate" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>Base Pick & Pack ($)</span>
            </label>
            <div style="width: 200px;">
              <input type="number" id="bulk-val-baserate" class="form-input" placeholder="${defaultBaseRate}" value="${defaultBaseRate}" min="0" step="50" style="height: 32px; font-size: 0.78rem; text-align: right; width: 100%; border-radius: 6px;" disabled>
            </div>
          </div>

          <!-- Columna: Recargo SKU ($) -->
          <div class="bulk-edit-row" id="row-bulk-surchargesku" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-surchargesku" class="bulk-col-toggle" data-target="bulk-val-surchargesku" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>Recargo SKU ($)</span>
            </label>
            <div style="width: 200px;">
              <input type="number" id="bulk-val-surchargesku" class="form-input" placeholder="0" value="0" min="0" step="50" style="height: 32px; font-size: 0.78rem; text-align: right; width: 100%; border-radius: 6px;" disabled>
            </div>
          </div>

          <!-- Columna: Recargo Unidades ($) -->
          <div class="bulk-edit-row" id="row-bulk-surchargeunits" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-surchargeunits" class="bulk-col-toggle" data-target="bulk-val-surchargeunits" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>Recargo Unidades ($)</span>
            </label>
            <div style="width: 200px;">
              <input type="number" id="bulk-val-surchargeunits" class="form-input" placeholder="0" value="0" min="0" step="50" style="height: 32px; font-size: 0.78rem; text-align: right; width: 100%; border-radius: 6px;" disabled>
            </div>
          </div>

          ${customColsBulkHTML}

          <!-- Columna: Inclusión en Facturación -->
          <div class="bulk-edit-row" id="row-bulk-inclusion" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fcfcfd;">
            <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; color: #1e293b; flex: 1;">
              <input type="checkbox" id="bulk-chk-inclusion" class="bulk-col-toggle" data-target="bulk-val-inclusion" style="width: 15px; height: 15px; accent-color: #5f06fa;">
              <span>Inclusión (Inc.)</span>
            </label>
            <div style="width: 200px;">
              <select id="bulk-val-inclusion" class="form-input" style="height: 32px; font-size: 0.78rem; padding: 2px 6px; width: 100%; border-radius: 6px;" disabled>
                <option value="inc">✓ Incluir en cobro (Activo)</option>
                <option value="exc">✗ Excluir de cobro (Omitir)</option>
              </select>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  const { value: bulkResult } = await Swal.fire({
    title: '<span style="color: #1e293b; font-size: 1.15rem; font-weight: 800; display: inline-flex; align-items: center; gap: 6px;"><i class="ri-edit-2-line" style="color: #5f06fa;"></i> Edición Masiva de Pedidos</span>',
    html: modalHTML,
    width: '660px',
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Aplicar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    focusConfirm: false,
    didOpen: () => {
      // Activar / desactivar inputs al marcar o desmarcar la casilla de cada columna
      document.querySelectorAll('.bulk-col-toggle').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const targetId = e.target.getAttribute('data-target');
          const inputEl = document.getElementById(targetId);
          const rowEl = e.target.closest('.bulk-edit-row');
          if (inputEl) {
            inputEl.disabled = !e.target.checked;
            if (e.target.checked) inputEl.focus();
          }
          const ccId = e.target.getAttribute('data-cc-id');
          if (ccId) {
            const amtEl = document.getElementById(`bulk-val-cc-amount-${ccId}`);
            if (amtEl) amtEl.disabled = !e.target.checked;
          }
          if (rowEl && !ccId) {
            rowEl.style.background = e.target.checked ? '#f5f3ff' : '#fcfcfd';
            rowEl.style.borderColor = e.target.checked ? '#c4b5fd' : '#e2e8f0';
          }
          if (e.target.id === 'bulk-chk-delivery') {
            const syncBox = document.getElementById('bulk-box-sync-freight');
            if (syncBox) syncBox.style.display = e.target.checked ? 'block' : 'none';
          }
        });
      });

      document.querySelectorAll('.bulk-cc-action-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const ccId = e.target.getAttribute('data-cc-id');
          const amtEl = document.getElementById(`bulk-val-cc-amount-${ccId}`);
          if (amtEl) {
            amtEl.style.display = e.target.value === 'fixed' ? 'block' : 'none';
          }
        });
      });
    },
    preConfirm: () => {
      // 1. Validar alcance
      const selectedScopeEl = document.querySelector('input[name="bulk-scope"]:checked');
      const scope = selectedScopeEl ? selectedScopeEl.value : 'filtered';

      let targetOrders = [];
      if (scope === 'filtered') {
        targetOrders = allOrders.filter(o => visibleIds.has(String(o.id)));
      } else if (scope === 'included') {
        targetOrders = allOrders.filter(o => !o.isExcluded);
      } else {
        targetOrders = allOrders;
      }

      if (targetOrders.length === 0) {
        Swal.showValidationMessage('No hay ningún pedido en el alcance seleccionado para modificar.');
        return false;
      }

      // 2. Validar que al menos una columna fue seleccionada
      const chkDelivery = document.getElementById('bulk-chk-delivery')?.checked;
      const chkFreight = document.getElementById('bulk-chk-freight')?.checked;
      const chkSkus = document.getElementById('bulk-chk-skus')?.checked;
      const chkUnits = document.getElementById('bulk-chk-units')?.checked;
      const chkMkt = document.getElementById('bulk-chk-mkt')?.checked;
      const chkBaseRate = document.getElementById('bulk-chk-baserate')?.checked;
      const chkSurchargeSku = document.getElementById('bulk-chk-surchargesku')?.checked;
      const chkSurchargeUnits = document.getElementById('bulk-chk-surchargeunits')?.checked;
      const chkInclusion = document.getElementById('bulk-chk-inclusion')?.checked;

      const customUpdates = {};
      let hasCustomColSelected = false;
      customCols.forEach(col => {
        const chkCC = document.getElementById(`bulk-chk-cc-${col.id}`)?.checked;
        if (chkCC) {
          hasCustomColSelected = true;
          const action = document.getElementById(`bulk-val-cc-action-${col.id}`)?.value || 'rule';
          const fixedAmount = Math.max(0, Math.round(Number(document.getElementById(`bulk-val-cc-amount-${col.id}`)?.value) || 0));
          customUpdates[col.id] = { action, fixedAmount, col };
        }
      });

      if (!chkDelivery && !chkFreight && !chkSkus && !chkUnits && !chkMkt && !chkBaseRate && !chkSurchargeSku && !chkSurchargeUnits && !chkInclusion && !hasCustomColSelected) {
        Swal.showValidationMessage('Selecciona al menos una columna para aplicar cambios masivos.');
        return false;
      }

      return {
        scope,
        targetOrders,
        updates: {
          delivery: chkDelivery ? document.getElementById('bulk-val-delivery')?.value : null,
          syncFreight: chkDelivery ? !!document.getElementById('bulk-sync-freight')?.checked : false,
          freight: chkFreight ? Math.max(0, parseInt(document.getElementById('bulk-val-freight')?.value, 10) || 0) : null,
          skus: chkSkus ? Math.max(1, parseInt(document.getElementById('bulk-val-skus')?.value, 10) || 1) : null,
          units: chkUnits ? Math.max(1, parseInt(document.getElementById('bulk-val-units')?.value, 10) || 1) : null,
          mkt: chkMkt ? (document.getElementById('bulk-val-mkt')?.value === 'yes') : null,
          baseRate: chkBaseRate ? Math.max(0, parseInt(document.getElementById('bulk-val-baserate')?.value, 10) || 0) : null,
          surchargeSku: chkSurchargeSku ? Math.max(0, parseInt(document.getElementById('bulk-val-surchargesku')?.value, 10) || 0) : null,
          surchargeUnits: chkSurchargeUnits ? Math.max(0, parseInt(document.getElementById('bulk-val-surchargeunits')?.value, 10) || 0) : null,
          inclusion: chkInclusion ? (document.getElementById('bulk-val-inclusion')?.value === 'inc') : null,
          customUpdates
        }
      };
    }
  });

  if (!bulkResult) return;

  const { targetOrders, updates } = bulkResult;
  const count = targetOrders.length;
  const rules = billingState.pricingConfig?.pick_pack_rules || {};

  targetOrders.forEach(ord => {
    // A. Inclusión
    if (updates.inclusion !== null) {
      ord.isExcluded = !updates.inclusion;
    }

    // B. Tipo de Entrega y sincronización de Flete
    if (updates.delivery !== null) {
      ord.deliveryType = updates.delivery;
      if (updates.syncFreight && updates.freight === null) {
        const dt = deliveryTypes.find(d => d.key === updates.delivery);
        ord.shippingFreight = dt ? dt.price : 0;
      }
    }

    // C. Flete Envío explícito (anula sync automático si se especificó)
    if (updates.freight !== null) {
      ord.shippingFreight = updates.freight;
    }

    // D. SKUs
    if (updates.skus !== null) {
      ord.skuCount = updates.skus;
      const extraSku = Math.max(0, ord.skuCount - (rules.base_included_sku || 3));
      ord.surchargeSku = extraSku * (rules.surcharge_extra_sku || 100);
      ord.surchargeSkuManual = false;
    }

    // E. Unidades
    if (updates.units !== null) {
      ord.unitsCount = updates.units;
      const extraUnits = Math.max(0, ord.unitsCount - (rules.base_included_units || 10));
      ord.surchargeUnits = extraUnits * (rules.surcharge_extra_unit || 50);
      ord.surchargeUnitsManual = false;
    }

    // D2. Recargo SKU explícito ($)
    if (updates.surchargeSku !== null) {
      ord.surchargeSku = updates.surchargeSku;
      ord.surchargeSkuManual = true;
    }

    // E2. Recargo Unidades explícito ($)
    if (updates.surchargeUnits !== null) {
      ord.surchargeUnits = updates.surchargeUnits;
      ord.surchargeUnitsManual = true;
    }

    // F. Marketplace
    if (updates.mkt !== null) {
      ord.isMarketplace = updates.mkt;
      const mktSurcharge = rules.surcharge_marketplace_collect || 100;
      ord.surchargeMarketplace = ord.isMarketplace ? mktSurcharge : 0;
      ord.surchargeMarketplaceManual = false;
    }

    // G. Tarifa Base Pick & Pack
    if (updates.baseRate !== null) {
      ord.baseRate = updates.baseRate;
    }

    // H. Columnas de Cobro Personalizadas
    if (updates.customUpdates) {
      if (!ord.customSurcharges || typeof ord.customSurcharges !== 'object') ord.customSurcharges = {};
      if (!ord.customSurchargesMeta || typeof ord.customSurchargesMeta !== 'object') ord.customSurchargesMeta = {};
      Object.entries(updates.customUpdates).forEach(([ccId, cfg]) => {
        if (cfg.action === 'rule') {
          ord.customSurcharges[ccId] = calculateCustomColumnRuleAmount(cfg.col, ord);
          ord.customSurchargesMeta[ccId] = 'rule';
        } else if (cfg.action === 'zero') {
          ord.customSurcharges[ccId] = 0;
          ord.customSurchargesMeta[ccId] = 'manual';
        } else if (cfg.action === 'fixed') {
          ord.customSurcharges[ccId] = cfg.fixedAmount;
          ord.customSurchargesMeta[ccId] = 'manual';
        }
      });
    }

    // Recalcular totales por pedido (incluyendo columnas personalizadas de recargo)
    recomputeOrderPickPackWithCustomColumns(ord, billingState.customColumns);
    ord.orderTotal = ord.pickPackTotal + ord.shippingFreight;
  });

  // Re-ejecutar cálculo reactivo general y actualizar UI
  recalculateFromCurrentState();

  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: 'Edición masiva completada',
    text: `Se actualizaron ${count} pedidos correctamente.`,
    showConfirmButton: false,
    timer: 3500
  });
};

// Recálculo rápido de totales a partir del estado de pedidos editado
function recalculateFromCurrentState() {
  const b = billingState;
  const billableOrders = b.orders.filter(o => !o.isExcluded);

  const totalPickPackNet = billableOrders.reduce((acc, o) => acc + o.pickPackTotal, 0);

  // Todo flete facturable en fulfillment (costo de flete > 0)
  const billableShippingOrders = billableOrders.filter(o => (o.shippingFreight || 0) > 0);
  const totalShippingNet = billableShippingOrders.reduce((acc, o) => acc + (o.shippingFreight || 0), 0);

  const enviameOrders = billableOrders.filter(o => o.deliveryType === 'ENVIAME_REGION');

  // Cobro de Etiqueta FULL de MELI ($100 por producto en pedidos con agenda FULL MERCADOLIBRE)
  const fullMeliOrders = billableOrders.filter(o => isFullMeliOrder(o));
  const meliFullUnitsCount = fullMeliOrders.reduce((acc, o) => acc + (Math.max(1, parseInt(o.unitsCount, 10) || 1)), 0);
  const meliFullRate = (b.pricingConfig?.pick_pack_rules?.surcharge_ml_full_labeling) || 100;
  const meliFullNet = meliFullUnitsCount * meliFullRate;

  const baseStorageM3Rate = b.totals?.storageRate || b.activeRange?.storage_m3 || 48900;
  const storageDiscountPct = (b.totals?.storageDiscountPct !== undefined) ? b.totals.storageDiscountPct : 0;
  const grossStorage = b.volumeM3 * baseStorageM3Rate;
  const storageDiscountAmount = Math.round(grossStorage * (storageDiscountPct / 100));
  const netStorageCost = Math.round(grossStorage - storageDiscountAmount);

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
    fixedFeeReason = `Costo variable 1.5 UF (${formatCLP(fixedFeeCLP)}) por operar con < 50 pedidos y < 1 m³`;
  } else {
    fixedFeeUF = 0.9;
    fixedFeeCLP = Math.round(0.9 * b.ufValue);
    fixedFeeReason = `Costo variable 0.9 UF (${formatCLP(fixedFeeCLP)}) por operar con < 75 pedidos y < 1.5 m³`;
  }

  syncDynamicSuppliesQuantities(b.supplies, billableOrders);
  const totalSuppliesNet = (b.supplies || []).reduce((acc, s) => acc + (s.total || 0), 0);
  const totalAdjustmentsNet = (b.adjustments || []).reduce((acc, a) => acc + (a.amount || 0), 0);
  const totalAbonos = (b.abonos || []).reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0);

  const inboundNet = b.totals.inboundNet || 0;
  const posFeeCLP = (b.totals.posFeeNet !== undefined) ? b.totals.posFeeNet : (b.totals.posActive ? Math.round((b.totals.posFeeUF || 0.2) * b.ufValue) : 0);
  const totalNet = Math.round(netStorageCost + totalPickPackNet + totalShippingNet + inboundNet + fixedFeeCLP + posFeeCLP + totalSuppliesNet + totalAdjustmentsNet + meliFullNet);
  const totalIVA = Math.round(totalNet * 0.19);
  const totalGross = totalNet + totalIVA;
  const totalToPay = Math.max(0, totalGross - totalAbonos);

  b.totals = {
    ...b.totals,
    ordersCount: b.orders.length,
    billableOrdersCount: billableOrders.length,
    meliFullOrdersCount: fullMeliOrders.length,
    meliFullUnitsCount,
    meliFullRate,
    meliFullNet,
    storageRate: baseStorageM3Rate,
    storageGross: Math.round(grossStorage),
    storageDiscountPct,
    storageDiscountAmount,
    storageNet: netStorageCost,
    isManualVolume: !!b.isManualVolume,
    pickPackNet: totalPickPackNet,
    shippingRmFlexCount: billableShippingOrders.length,
    shippingRmFlexNet: totalShippingNet,
    shippingEnviameCount: enviameOrders.length,
    fixedFeeUF,
    fixedFeeNet: fixedFeeCLP,
    fixedFeeReason,
    posFeeNet: posFeeCLP,
    suppliesNet: totalSuppliesNet,
    totalSuppliesNet,
    adjustmentsNet: totalAdjustmentsNet,
    totalAdjustmentsNet,
    totalAbonos,
    totalNet,
    iva: totalIVA,
    totalGross,
    totalToPay
  };

  if (b.isConglomerate) {
    b.storeBreakdown = computeConglomerateStoreBreakdown(b.orders, b);
    renderConglomerateBannerUI();
    updateActiveStoreFilterBannerUI();
  }

  renderKPIsUI();
  renderOrdersTableUI();

  const desgloseCont = document.getElementById('bg-desglose-view-container');
  if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();

  const analyticsSubTab = document.getElementById('bg-subtab-analytics');
  if (analyticsSubTab && analyticsSubTab.style.display !== 'none') {
    renderBillingAnalyticsCharts();
  }

  if (typeof renderCommerceObservationsBannerUI === 'function') {
    renderCommerceObservationsBannerUI();
  }
  const obsSubTab = document.getElementById('bg-content-observations');
  if (obsSubTab && obsSubTab.style.display !== 'none' && typeof renderCommerceObservationsSectionUI === 'function') {
    renderCommerceObservationsSectionUI();
  }
}

// =========================================================================
// MOTOR DE ASIGNACIÓN DINÁMICA DE INSUMOS POR AGENDAS / GRUPOS DE PEDIDOS
// (Garantiza 0 duplicación de grupos y 0 doble conteo de pedidos)
// =========================================================================
export function resolveCanonicalSupplyAgendaGroup(order) {
  const raw = String(order?.agenda || '').trim();
  const hasAgenda = Boolean(raw && raw !== '—' && raw !== '-');
  const norm = hasAgenda
    ? raw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
    : '';
  const dt = String(order?.deliveryType || '').trim().toUpperCase();

  if (
    order?.isPosOrder ||
    isPosSaleOrder(order) ||
    dt === 'POS' ||
    norm === 'COMPRA EN BODEGA' ||
    norm === 'POS' ||
    norm.includes('PUNTO DE VENTA') ||
    norm.includes('SHOWROOM')
  ) {
    return { key: 'POS', label: 'PUNTO DE VENTA (POS)', shortLabel: 'POS', rawAgenda: raw || 'POS', sortOrder: 60 };
  }

  if (!hasAgenda) {
    return { key: 'SIN_AGENDA', label: 'SIN AGENDA', shortLabel: 'SIN AGENDA', rawAgenda: 'Sin Agenda', sortOrder: 99 };
  }

  if (isFullMeliOrder(order) || norm.includes('FULL MERCADO') || norm === 'FULL MELI' || norm === 'FULL') {
    return { key: 'FULL_MELI', label: 'FULL MERCADOLIBRE', shortLabel: 'FULL MELI', rawAgenda: raw, sortOrder: 50 };
  }

  if (norm === 'FLEX' || norm.includes('FLEX')) {
    return { key: 'FLEX', label: 'FLEX', shortLabel: 'FLEX', rawAgenda: raw, sortOrder: 20 };
  }

  if (
    ['RM', 'STK', 'RM-STK', 'RM STK', 'STOCKA', 'STOCKA X', 'ALPHA', 'COLINA', 'SANTIAGO'].includes(norm) ||
    norm.startsWith('RM ')
  ) {
    return { key: 'RM', label: 'RM', shortLabel: 'RM', rawAgenda: raw, sortOrder: 10 };
  }

  if (norm.includes('CENTRO DE ENVIO') || norm.includes('CENTRO ENVIO') || norm === 'COLECTA') {
    return { key: 'CENTRO_ENVIOS', label: 'CENTRO DE ENVÍOS', shortLabel: 'CENTRO DE ENVÍOS', rawAgenda: raw, sortOrder: 40 };
  }

  if (norm.includes('RETIRO')) {
    return { key: 'RETIRO', label: 'RETIRO', shortLabel: 'RETIRO', rawAgenda: raw, sortOrder: 55 };
  }

  if (
    norm === 'REGION' ||
    norm === 'REGIONES' ||
    norm.includes('REGION') ||
    norm.includes('ENVIAME') ||
    ['STARKEN', 'CHILEXPRESS', 'BLUEXPRESS', 'BLUE EXPRESS', 'CORREOS'].includes(norm)
  ) {
    return { key: 'REGIONES', label: 'REGIONES', shortLabel: 'REGIONES', rawAgenda: raw, sortOrder: 30 };
  }

  const customKey = 'AG_' + norm.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { key: customKey, label: norm, shortLabel: norm, rawAgenda: raw, sortOrder: 70 };
}

export function getOrderSupplyGroupsCatalog(orders = [], ensureKeys = []) {
  const billableOrders = (Array.isArray(orders) ? orders : []).filter(o => !o.isExcluded);
  const baseCatalog = [
    { key: 'RM', label: 'RM', shortLabel: 'RM', sortOrder: 10 },
    { key: 'FLEX', label: 'FLEX', shortLabel: 'FLEX', sortOrder: 20 },
    { key: 'REGIONES', label: 'REGIONES', shortLabel: 'REGIONES', sortOrder: 30 },
    { key: 'CENTRO_ENVIOS', label: 'CENTRO DE ENVÍOS', shortLabel: 'CENTRO DE ENVÍOS', sortOrder: 40 },
    { key: 'FULL_MELI', label: 'FULL MERCADOLIBRE', shortLabel: 'FULL MELI', sortOrder: 50 },
    { key: 'RETIRO', label: 'RETIRO', shortLabel: 'RETIRO', sortOrder: 55 },
    { key: 'POS', label: 'PUNTO DE VENTA (POS)', shortLabel: 'POS', sortOrder: 60 },
    { key: 'SIN_AGENDA', label: 'SIN AGENDA', shortLabel: 'SIN AGENDA', sortOrder: 99 }
  ];

  const groupMap = new Map();
  baseCatalog.forEach(g => {
    groupMap.set(g.key, {
      ...g,
      orderIds: new Set(),
      unitsCount: 0,
      rawAgendas: new Set()
    });
  });

  const globalSeenOrderIds = new Set();

  billableOrders.forEach((ord, idx) => {
    const ordId = String(ord?.id ?? `idx_${idx}`);
    if (globalSeenOrderIds.has(ordId)) return;
    globalSeenOrderIds.add(ordId);

    const resolved = resolveCanonicalSupplyAgendaGroup(ord);
    if (!groupMap.has(resolved.key)) {
      groupMap.set(resolved.key, {
        key: resolved.key,
        label: resolved.label,
        shortLabel: resolved.shortLabel || resolved.label,
        sortOrder: resolved.sortOrder || 70,
        orderIds: new Set(),
        unitsCount: 0,
        rawAgendas: new Set()
      });
    }
    const entry = groupMap.get(resolved.key);
    entry.orderIds.add(ordId);
    entry.unitsCount += Math.max(1, parseInt(ord?.unitsCount, 10) || 1);
    if (resolved.rawAgenda) entry.rawAgendas.add(String(resolved.rawAgenda).toUpperCase().trim());
  });

  const ensureSet = new Set(['RM', 'FLEX', 'REGIONES', ...(Array.isArray(ensureKeys) ? ensureKeys : [])]);

  return Array.from(groupMap.values())
    .filter(g => g.orderIds.size > 0 || ensureSet.has(g.key))
    .map(g => ({
      key: g.key,
      label: g.label,
      shortLabel: g.shortLabel,
      sortOrder: g.sortOrder,
      count: g.orderIds.size,
      unitsCount: g.unitsCount,
      orderIds: g.orderIds,
      rawAgendasList: Array.from(g.rawAgendas)
    }))
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label, 'es'));
}

export function computeDynamicSupplyGroupStats(orders = [], selectedGroupKeys = []) {
  const uniqueSelectedKeys = Array.from(
    new Set((Array.isArray(selectedGroupKeys) ? selectedGroupKeys : []).map(k => String(k || '').trim()).filter(Boolean))
  );
  const catalog = getOrderSupplyGroupsCatalog(orders, uniqueSelectedKeys);
  const selectedSet = new Set(uniqueSelectedKeys);

  const matchedOrderIds = new Set();
  let matchedUnitsCount = 0;
  const activeGroups = [];

  catalog.forEach(g => {
    if (!selectedSet.has(g.key)) return;
    let groupAddedOrders = 0;
    g.orderIds.forEach(id => {
      if (!matchedOrderIds.has(id)) {
        matchedOrderIds.add(id);
        groupAddedOrders++;
      }
    });
    matchedUnitsCount += g.unitsCount;
    activeGroups.push({
      key: g.key,
      label: g.label,
      shortLabel: g.shortLabel,
      count: groupAddedOrders
    });
  });

  const formulaCode = activeGroups.map(g => g.shortLabel).join('+');
  const formulaText = activeGroups.map(g => `${g.shortLabel} (${g.count})`).join(' + ');

  return {
    selectedKeys: activeGroups.map(g => g.key),
    activeGroups,
    totalOrders: matchedOrderIds.size,
    totalUnits: matchedUnitsCount,
    formulaCode,
    formulaText,
    catalog
  };
}

export function syncDynamicSuppliesQuantities(supplies = [], orders = []) {
  if (!Array.isArray(supplies)) return;
  supplies.forEach(s => {
    if (!s || s.qtyMode !== 'dynamic_groups' || !Array.isArray(s.selectedGroups) || s.selectedGroups.length === 0) return;
    const stats = computeDynamicSupplyGroupStats(orders, s.selectedGroups);
    s.selectedGroups = stats.selectedKeys;
    s.matchedOrdersCount = stats.totalOrders;
    s.formulaCode = stats.formulaCode;
    s.formulaText = stats.formulaText;

    if (s.isBubbleLinearCm) {
      const cmPerOrder = Math.max(1, parseFloat(s.cmPerOrder) || 50);
      const costPerCm = Math.max(0, parseFloat(s.costPerCm) || 3.6);
      const rollWidthCm = s.rollWidthCm || 100;
      const totalCm = Math.round(cmPerOrder * stats.totalOrders);
      const totalCost = Math.round(totalCm * costPerCm);
      s.qty = 1;
      s.unit = 'gl.';
      s.unitPrice = totalCost;
      s.total = totalCost;
      if (s.baseMaterialName) {
        s.name = `${s.baseMaterialName} (${totalCm.toLocaleString('es-CL')} cm lineales · ancho ${rollWidthCm} cm)`;
      }
      s.dynamicSummary = `${stats.formulaCode}: ${stats.formulaText} = ${stats.totalOrders} ped. × ${cmPerOrder} cm (${totalCm.toLocaleString('es-CL')} cm)`;
    } else {
      const perOrderQty = Math.max(0.01, parseFloat(s.perOrderQty) || 1);
      const computedQty = Math.round(stats.totalOrders * perOrderQty);
      s.qty = computedQty;
      if (!s.unit || s.unit === 'gl.') s.unit = 'ud.';
      s.total = Math.round(computedQty * (Number(s.unitPrice) || 0));
      s.dynamicSummary = `${stats.formulaCode}: ${stats.formulaText} = ${stats.totalOrders} ped.${perOrderQty !== 1 ? ` × ${perOrderQty} ud/ped` : ''}`;
    }
  });
}

function renderSupplyDynamicGroupSelectorHTML(catalog, initialMode = 'dynamic_groups', initialSelectedKeys = ['RM', 'FLEX', 'REGIONES'], initialPerOrderQty = 1) {
  const isDynamic = initialMode === 'dynamic_groups';
  const selSet = new Set(initialSelectedKeys);

  return `
    <div style="margin-bottom: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.65rem 0.75rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 0.5rem; flex-wrap: wrap;">
        <label style="font-size: 0.73rem; font-weight: 800; color: #334155; text-transform: uppercase; display: flex; align-items: center; gap: 4px; margin: 0;">
          <i class="ri-links-line" style="color: #5f06fa; font-size: 0.9rem;"></i> Modo de Cantidad:
        </label>
        <div style="display: inline-flex; background: #e2e8f0; padding: 2px; border-radius: 6px; gap: 2px;">
          <button type="button" id="swal-sup-mode-dynamic" style="border: none; border-radius: 5px; padding: 4px 9px; font-size: 0.72rem; font-weight: 800; cursor: pointer; transition: all 0.15s; background: ${isDynamic ? '#5f06fa' : 'transparent'}; color: ${isDynamic ? '#ffffff' : '#475569'};">
            <i class="ri-stack-line"></i> Por Agendas / Grupos
          </button>
          <button type="button" id="swal-sup-mode-manual" style="border: none; border-radius: 5px; padding: 4px 9px; font-size: 0.72rem; font-weight: 800; cursor: pointer; transition: all 0.15s; background: ${!isDynamic ? '#5f06fa' : 'transparent'}; color: ${!isDynamic ? '#ffffff' : '#475569'};">
            <i class="ri-edit-2-line"></i> Fija Manual
          </button>
        </div>
      </div>

      <div id="swal-sup-dynamic-panel" style="display: ${isDynamic ? 'block' : 'none'};">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 0.4rem; flex-wrap: wrap;">
          <span style="font-size: 0.69rem; font-weight: 700; color: #64748b;">Combinaciones rápidas:</span>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            <button type="button" class="swal-sup-preset-btn" data-preset="rm_flex_reg" style="background: #ede9fe; border: 1px solid #c4b5fd; color: #5b21b6; font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; cursor: pointer;">
              ⚡ RM+FLEX+REGIONES
            </button>
            <button type="button" class="swal-sup-preset-btn" data-preset="rm_flex" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 999px; cursor: pointer;">
              RM+FLEX
            </button>
            <button type="button" class="swal-sup-preset-btn" data-preset="regiones" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 999px; cursor: pointer;">
              Solo REGIONES
            </button>
            <button type="button" class="swal-sup-preset-btn" data-preset="all_agenda" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 999px; cursor: pointer;">
              Con Agenda
            </button>
            <button type="button" class="swal-sup-preset-btn" data-preset="all" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 999px; cursor: pointer;">
              Todos
            </button>
            <button type="button" class="swal-sup-preset-btn" data-preset="none" style="background: #ffffff; border: 1px solid #fecaca; color: #dc2626; font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 999px; cursor: pointer;">
              Limpiar
            </button>
          </div>
        </div>

        <div style="font-size: 0.69rem; color: #64748b; margin-bottom: 0.35rem;">
          Selecciona las agendas / grupos a sumar (grupos normalizados sin duplicados):
        </div>

        <div id="swal-sup-groups-grid" style="display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 0.55rem;">
          ${catalog.map(g => {
            const active = selSet.has(g.key);
            const rawHint = g.rawAgendasList && g.rawAgendasList.length > 1
              ? `Incluye: ${g.rawAgendasList.join(', ')}`
              : `Grupo: ${g.label} (${g.count} pedidos únicos)`;
            return `
              <button type="button"
                      class="swal-sup-group-pill"
                      data-group-key="${escapeHtml(g.key)}"
                      title="${escapeHtml(rawHint)}"
                      style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 7px; font-size: 0.74rem; font-weight: 700; cursor: pointer; transition: all 0.15s; border: 1.5px solid ${active ? '#5f06fa' : '#cbd5e1'}; background: ${active ? 'rgba(95, 6, 250, 0.1)' : '#ffffff'}; color: ${active ? '#4c1d95' : '#334155'};">
                <i class="swal-sup-pill-icon ${active ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}" style="color: ${active ? '#5f06fa' : '#94a3b8'}; font-size: 0.88rem;"></i>
                <span>${escapeHtml(g.label)}</span>
                <span style="background: ${active ? '#5f06fa' : '#f1f5f9'}; color: ${active ? '#ffffff' : '#475569'}; font-size: 0.67rem; font-weight: 800; padding: 1px 5px; border-radius: 4px;">
                  ${g.count}
                </span>
              </button>
            `;
          }).join('')}
        </div>

        <div id="swal-sup-per-order-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px 8px; margin-bottom: 0.45rem;">
          <span style="font-size: 0.72rem; font-weight: 700; color: #334155;">
            Unidades de insumo por pedido considerado:
          </span>
          <input id="swal-sup-per-order-qty" type="number" min="0.1" step="any" value="${initialPerOrderQty}" class="swal2-input" style="margin: 0; width: 78px; height: 28px; font-size: 0.8rem; font-weight: 800; text-align: right; padding: 2px 6px;">
        </div>

        <div id="swal-sup-formula-summary" style="background: rgba(95, 6, 250, 0.06); border: 1px dashed rgba(95, 6, 250, 0.32); border-radius: 6px; padding: 6px 8px; font-size: 0.73rem; color: #1e293b; line-height: 1.35;">
        </div>
      </div>
    </div>
  `;
}

// Agregar Fila Manual de Insumos (con soporte para catálogo de Cajas por tamaño, Plástico Burbuja y Cantidad Dinámica por Agendas)
window.addNewManualSupplyRow = async function() {
  if (guardBillingLocked()) return;
  const cfg = billingState.pricingConfig || DEFAULT_PRICING_CONFIG;
  const knownBoxes = Array.isArray(cfg.supplies?.boxes) && cfg.supplies.boxes.length > 0
    ? cfg.supplies.boxes
    : DEFAULT_PRICING_CONFIG.supplies.boxes;
  const bwRoll = cfg.supplies?.bubble_wrap_roll || DEFAULT_PRICING_CONFIG.supplies.bubble_wrap_roll;
  const costPerCm = Number(bwRoll?.cost_per_linear_cm ?? 3.6);
  const rollWidthCm = bwRoll?.roll_width_cm ?? 100;

  const defaultBox = knownBoxes.find(b => b.id === 'box_s') || knownBoxes[0] || { name: 'Caja S', length_cm: 20, width_cm: 20, height_cm: 20, unit_price: 450 };

  const ordersList = billingState.orders || [];
  const catalog = getOrderSupplyGroupsCatalog(ordersList, ['RM', 'FLEX', 'REGIONES']);
  const defaultSelectedKeys = ['RM', 'FLEX', 'REGIONES'].filter(k => catalog.some(g => g.key === k));
  const initialStats = computeDynamicSupplyGroupStats(ordersList, defaultSelectedKeys);
  const hasBillableOrders = ordersList.some(o => !o.isExcluded);
  const initialMode = hasBillableOrders ? 'dynamic_groups' : 'manual';
  const initialQty = initialMode === 'dynamic_groups' ? Math.max(0, initialStats.totalOrders) : 1;

  let modalState = {
    mode: initialMode,
    selectedKeys: [...defaultSelectedKeys],
    perOrderQty: 1
  };

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-box-3-line" style="color:#5f06fa;"></i><span>Agregar Insumo o Material</span></div>',
    width: '580px',
    html: `
      <div style="text-align: left; font-size: 0.88rem;">
        <label style="font-size: 0.74rem; font-weight: 800; color: #475569; display: block; margin-bottom: 0.25rem; text-transform: uppercase;">
          1. Seleccionar Material Conocido del Tarifario:
        </label>
        <select id="swal-supply-preset" class="swal2-select" style="margin: 0 0 0.7rem 0; width: 100%; height: 38px; font-size: 0.84rem; font-weight: 600;">
          <optgroup label="📦 Cajas por Tamaño y Unidad">
            ${knownBoxes.map((bx, i) => `
              <option value="box_${i}" ${bx.id === defaultBox.id ? 'selected' : ''}>
                ${escapeHtml(bx.name)} (${bx.length_cm}×${bx.width_cm}×${bx.height_cm} cm) — ${formatCLP(bx.unit_price)} c/u
              </option>
            `).join('')}
          </optgroup>
          <optgroup label="🫧 Plástico Burbuja (Costo Lineal por cm)">
            <option value="bubble_cm">
              Plástico Burbuja (Ancho ${rollWidthCm} cm) — $${costPerCm.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} / cm lineal
            </option>
          </optgroup>
          <optgroup label="✏️ Otro Material">
            <option value="custom">Otro insumo personalizado...</option>
          </optgroup>
        </select>

        ${renderSupplyDynamicGroupSelectorHTML(catalog, initialMode, defaultSelectedKeys, 1)}

        <div id="swal-bubble-helper-box" style="display: none; background: rgba(95, 6, 250, 0.06); border: 1px solid rgba(95, 6, 250, 0.25); border-radius: 8px; padding: 0.65rem 0.8rem; margin-bottom: 0.75rem; font-size: 0.78rem;">
          <div style="font-weight: 800; color: #5f06fa; margin-bottom: 0.35rem;">
            <i class="ri-scissors-cut-line"></i> Cálculo Lineal por Centímetro (Rollo ${rollWidthCm} cm ancho × ${bwRoll?.roll_length_m ?? 100} m)
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
            <div>
              <label style="font-size: 0.7rem; font-weight: 700; color: #475569; display: block;">CM POR PEDIDO / CORTE:</label>
              <input id="swal-bubble-cm-per-order" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 34px; font-size: 0.82rem;" min="1" value="50">
            </div>
            <div>
              <label style="font-size: 0.7rem; font-weight: 700; color: #475569; display: block;">N° DE PEDIDOS / CORTES:</label>
              <input id="swal-bubble-orders-count" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 34px; font-size: 0.82rem;" min="0" value="${initialQty}">
            </div>
          </div>
          <div style="margin-top: 0.4rem; color: #334155; font-size: 0.75rem;">
            Total lineal: <strong id="swal-bubble-total-cm-lbl">50 cm</strong> &times; $${costPerCm.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}/cm = <strong id="swal-bubble-calc-total" style="color: #5f06fa;">$${Math.round(50 * costPerCm).toLocaleString('es-CL')}</strong>
          </div>
        </div>

        <label style="font-size: 0.74rem; font-weight: 800; color: #475569; display: block; margin-bottom: 0.25rem;">NOMBRE EN EL DESGLOSE:</label>
        <input id="swal-supply-name" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Ej: Caja S (20x20x20 cm)" value="${escapeHtml(`${defaultBox.name} (${defaultBox.length_cm}x${defaultBox.width_cm}x${defaultBox.height_cm} cm)`)}">
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <label id="swal-supply-qty-lbl" style="font-size: 0.74rem; font-weight: 800; color: #475569; display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem;">
              <span>CANTIDAD (UNID.):</span>
              <span id="swal-supply-qty-badge" style="font-size: 0.64rem; background: #ede9fe; color: #5f06fa; padding: 1px 5px; border-radius: 4px; font-weight: 800; display: ${initialMode === 'dynamic_groups' ? 'inline-block' : 'none'};">DINÁMICA</span>
            </label>
            <input id="swal-supply-qty" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; font-weight: 700;" min="0" value="${initialQty}">
          </div>
          <div>
            <label id="swal-supply-price-lbl" style="font-size: 0.74rem; font-weight: 800; color: #475569; display: block; margin-bottom: 0.25rem;">PRECIO UNITARIO ($ NETO):</label>
            <input id="swal-supply-price" type="number" step="0.01" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; font-weight: 700;" min="0" value="${defaultBox.unit_price}">
          </div>
        </div>

        <div id="swal-supply-total-preview" style="margin-top: 0.65rem; padding: 0.5rem 0.75rem; background: #f1f5f9; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem;">
          <span style="color: #475569; font-weight: 700;">Total Neto Insumo:</span>
          <strong id="swal-supply-total-net-lbl" style="color: #5f06fa; font-size: 0.92rem; font-weight: 900;">$0</strong>
        </div>
      </div>
    `,
    didOpen: () => {
      const presetSel = document.getElementById('swal-supply-preset');
      const nameInp = document.getElementById('swal-supply-name');
      const qtyInp = document.getElementById('swal-supply-qty');
      const qtyBadge = document.getElementById('swal-supply-qty-badge');
      const priceInp = document.getElementById('swal-supply-price');
      const totalNetLbl = document.getElementById('swal-supply-total-net-lbl');
      const bubbleBox = document.getElementById('swal-bubble-helper-box');
      const cmPerOrderInp = document.getElementById('swal-bubble-cm-per-order');
      const ordersCountInp = document.getElementById('swal-bubble-orders-count');
      const totalCmLbl = document.getElementById('swal-bubble-total-cm-lbl');
      const calcTotalLbl = document.getElementById('swal-bubble-calc-total');

      const btnModeDynamic = document.getElementById('swal-sup-mode-dynamic');
      const btnModeManual = document.getElementById('swal-sup-mode-manual');
      const dynamicPanel = document.getElementById('swal-sup-dynamic-panel');
      const perOrderRow = document.getElementById('swal-sup-per-order-row');
      const perOrderInp = document.getElementById('swal-sup-per-order-qty');
      const formulaSummary = document.getElementById('swal-sup-formula-summary');
      const groupPills = Array.from(document.querySelectorAll('.swal-sup-group-pill'));
      const presetBtns = Array.from(document.querySelectorAll('.swal-sup-preset-btn'));

      const updateTotalPreview = () => {
        const q = Math.max(0, parseInt(qtyInp?.value, 10) || 0);
        const p = Math.max(0, Math.round(parseFloat(priceInp?.value) || 0));
        const net = q * p;
        if (totalNetLbl) {
          totalNetLbl.textContent = `${formatCLP(net)} neto (${formatCLP(Math.round(net * 1.19))} IVA incl.)`;
        }
      };

      const syncBubbleHelper = () => {
        const cmPerOrd = Math.max(1, parseFloat(cmPerOrderInp?.value) || 0);
        const ordCnt = Math.max(0, parseInt(ordersCountInp?.value, 10) || 0);
        const totalCm = Math.round(cmPerOrd * ordCnt);
        const totalCost = Math.round(totalCm * costPerCm);
        if (totalCmLbl) totalCmLbl.textContent = `${totalCm.toLocaleString('es-CL')} cm`;
        if (calcTotalLbl) calcTotalLbl.textContent = `$${totalCost.toLocaleString('es-CL')}`;
        if (nameInp) nameInp.value = `Plástico Burbuja (${totalCm} cm lineales · ancho ${rollWidthCm} cm)`;
        if (qtyInp) qtyInp.value = ordCnt > 0 ? 1 : 0;
        if (priceInp) priceInp.value = totalCost;
        updateTotalPreview();
      };

      const refreshDynamicUI = () => {
        const isDyn = modalState.mode === 'dynamic_groups';
        const isBubble = presetSel?.value === 'bubble_cm';
        if (dynamicPanel) dynamicPanel.style.display = isDyn ? 'block' : 'none';
        if (perOrderRow) perOrderRow.style.display = (isDyn && !isBubble) ? 'flex' : 'none';
        if (qtyBadge) qtyBadge.style.display = isDyn ? 'inline-block' : 'none';

        if (btnModeDynamic) {
          btnModeDynamic.style.background = isDyn ? '#5f06fa' : 'transparent';
          btnModeDynamic.style.color = isDyn ? '#ffffff' : '#475569';
        }
        if (btnModeManual) {
          btnModeManual.style.background = !isDyn ? '#5f06fa' : 'transparent';
          btnModeManual.style.color = !isDyn ? '#ffffff' : '#475569';
        }

        const selSet = new Set(modalState.selectedKeys);
        groupPills.forEach(pill => {
          const k = pill.getAttribute('data-group-key');
          const active = selSet.has(k);
          pill.style.borderColor = active ? '#5f06fa' : '#cbd5e1';
          pill.style.background = active ? 'rgba(95, 6, 250, 0.1)' : '#ffffff';
          pill.style.color = active ? '#4c1d95' : '#334155';
          const icon = pill.querySelector('.swal-sup-pill-icon');
          if (icon) {
            icon.className = `swal-sup-pill-icon ${active ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}`;
            icon.style.color = active ? '#5f06fa' : '#94a3b8';
          }
          const badge = pill.querySelector('span:last-child');
          if (badge) {
            badge.style.background = active ? '#5f06fa' : '#f1f5f9';
            badge.style.color = active ? '#ffffff' : '#475569';
          }
        });

        if (isDyn) {
          const stats = computeDynamicSupplyGroupStats(ordersList, modalState.selectedKeys);
          const perOrd = Math.max(0.01, parseFloat(perOrderInp?.value) || 1);
          modalState.perOrderQty = perOrd;

          if (isBubble) {
            if (ordersCountInp) ordersCountInp.value = stats.totalOrders;
            syncBubbleHelper();
          } else {
            const finalQty = Math.round(stats.totalOrders * perOrd);
            if (qtyInp) qtyInp.value = finalQty;
            updateTotalPreview();
          }

          if (formulaSummary) {
            if (stats.activeGroups.length === 0) {
              formulaSummary.innerHTML = `<span style="color:#dc2626; font-weight:700;"><i class="ri-error-warning-line"></i> Selecciona al menos un grupo de pedidos arriba.</span>`;
            } else {
              const multTxt = (!isBubble && perOrd !== 1) ? ` &times; ${perOrd} ud/ped = <strong>${Math.round(stats.totalOrders * perOrd)} ud.</strong>` : '';
              formulaSummary.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span><strong style="color:#5f06fa;">${escapeHtml(stats.formulaCode)}</strong>: ${escapeHtml(stats.formulaText)}</span>
                  <span style="background:#5f06fa; color:#fff; padding:1px 7px; border-radius:999px; font-weight:800; font-size:0.7rem;">
                    ${stats.totalOrders} ped. únicos${multTxt}
                  </span>
                </div>
              `;
            }
          }
        } else {
          updateTotalPreview();
        }
      };

      btnModeDynamic?.addEventListener('click', () => {
        modalState.mode = 'dynamic_groups';
        refreshDynamicUI();
      });

      btnModeManual?.addEventListener('click', () => {
        modalState.mode = 'manual';
        refreshDynamicUI();
      });

      groupPills.forEach(pill => {
        pill.addEventListener('click', () => {
          const k = pill.getAttribute('data-group-key');
          if (!k) return;
          const idx = modalState.selectedKeys.indexOf(k);
          if (idx >= 0) {
            modalState.selectedKeys.splice(idx, 1);
          } else {
            modalState.selectedKeys.push(k);
          }
          modalState.mode = 'dynamic_groups';
          refreshDynamicUI();
        });
      });

      presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-preset');
          if (preset === 'rm_flex_reg') {
            modalState.selectedKeys = ['RM', 'FLEX', 'REGIONES'].filter(k => catalog.some(g => g.key === k));
          } else if (preset === 'rm_flex') {
            modalState.selectedKeys = ['RM', 'FLEX'].filter(k => catalog.some(g => g.key === k));
          } else if (preset === 'regiones') {
            modalState.selectedKeys = ['REGIONES'].filter(k => catalog.some(g => g.key === k));
          } else if (preset === 'all_agenda') {
            modalState.selectedKeys = catalog.filter(g => g.key !== 'SIN_AGENDA' && g.count > 0).map(g => g.key);
          } else if (preset === 'all') {
            modalState.selectedKeys = catalog.filter(g => g.count > 0).map(g => g.key);
          } else if (preset === 'none') {
            modalState.selectedKeys = [];
          }
          modalState.mode = 'dynamic_groups';
          refreshDynamicUI();
        });
      });

      perOrderInp?.addEventListener('input', refreshDynamicUI);

      qtyInp?.addEventListener('input', () => {
        if (modalState.mode === 'dynamic_groups') {
          modalState.mode = 'manual';
          refreshDynamicUI();
        } else {
          updateTotalPreview();
        }
      });

      priceInp?.addEventListener('input', updateTotalPreview);

      presetSel?.addEventListener('change', () => {
        const val = presetSel.value;
        if (val.startsWith('box_')) {
          if (bubbleBox) bubbleBox.style.display = 'none';
          const idx = parseInt(val.replace('box_', ''), 10);
          const bx = knownBoxes[idx];
          if (bx) {
            if (nameInp) nameInp.value = `${bx.name} (${bx.length_cm}x${bx.width_cm}x${bx.height_cm} cm)`;
            if (priceInp) priceInp.value = bx.unit_price;
          }
          refreshDynamicUI();
        } else if (val === 'bubble_cm') {
          if (bubbleBox) bubbleBox.style.display = 'block';
          refreshDynamicUI();
        } else {
          if (bubbleBox) bubbleBox.style.display = 'none';
          if (nameInp) nameInp.value = '';
          if (priceInp) priceInp.value = 0;
          refreshDynamicUI();
          nameInp?.focus();
        }
      });

      cmPerOrderInp?.addEventListener('input', syncBubbleHelper);
      ordersCountInp?.addEventListener('input', () => {
        if (modalState.mode === 'dynamic_groups') {
          modalState.mode = 'manual';
          refreshDynamicUI();
        }
        syncBubbleHelper();
      });

      refreshDynamicUI();
    },
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Agregar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const name = document.getElementById('swal-supply-name')?.value?.trim();
      const qty = parseInt(document.getElementById('swal-supply-qty')?.value, 10) || 0;
      const price = Math.round(parseFloat(document.getElementById('swal-supply-price')?.value) || 0);
      const isBubble = document.getElementById('swal-supply-preset')?.value === 'bubble_cm';
      const cmPerOrder = Math.max(1, parseFloat(document.getElementById('swal-bubble-cm-per-order')?.value) || 50);
      const perOrderQty = Math.max(0.01, parseFloat(document.getElementById('swal-sup-per-order-qty')?.value) || 1);

      if (!name) {
        Swal.showValidationMessage('Ingresa un nombre para el insumo.');
        return false;
      }

      if (modalState.mode === 'dynamic_groups') {
        if (!modalState.selectedKeys || modalState.selectedKeys.length === 0) {
          Swal.showValidationMessage('Selecciona al menos un grupo/agenda de pedidos o cambia a modo "Fija Manual".');
          return false;
        }
        const stats = computeDynamicSupplyGroupStats(ordersList, modalState.selectedKeys);
        if (stats.totalOrders === 0) {
          Swal.showValidationMessage('Los grupos seleccionados tienen 0 pedidos en este periodo. Selecciona otro grupo o usa "Fija Manual".');
          return false;
        }
        return {
          name,
          qty,
          price,
          qtyMode: 'dynamic_groups',
          selectedGroups: stats.selectedKeys,
          perOrderQty,
          isBubbleLinearCm: isBubble,
          cmPerOrder,
          costPerCm,
          rollWidthCm,
          baseMaterialName: isBubble ? 'Plástico Burbuja' : null,
          matchedOrdersCount: stats.totalOrders,
          formulaCode: stats.formulaCode,
          formulaText: stats.formulaText
        };
      }

      if (qty <= 0) {
        Swal.showValidationMessage('Ingresa una cantidad mayor a 0.');
        return false;
      }

      return {
        name,
        qty,
        price,
        qtyMode: 'manual',
        selectedGroups: [],
        perOrderQty: 1,
        isBubbleLinearCm: isBubble
      };
    }
  });

  if (formValues && formValues.name) {
    const newSupply = {
      id: 'custom_' + Date.now(),
      name: formValues.name,
      unit: formValues.isBubbleLinearCm ? 'gl.' : 'ud.',
      qty: formValues.qty,
      unitPrice: formValues.price,
      total: formValues.qty * formValues.price,
      qtyMode: formValues.qtyMode || 'manual',
      selectedGroups: Array.isArray(formValues.selectedGroups) ? formValues.selectedGroups : [],
      perOrderQty: formValues.perOrderQty || 1,
      isBubbleLinearCm: Boolean(formValues.isBubbleLinearCm),
      cmPerOrder: formValues.cmPerOrder || 50,
      costPerCm: formValues.costPerCm || costPerCm,
      rollWidthCm: formValues.rollWidthCm || rollWidthCm,
      baseMaterialName: formValues.baseMaterialName || null,
      matchedOrdersCount: formValues.matchedOrdersCount || formValues.qty,
      formulaCode: formValues.formulaCode || '',
      formulaText: formValues.formulaText || ''
    };

    if (newSupply.qtyMode === 'dynamic_groups') {
      syncDynamicSuppliesQuantities([newSupply], billingState.orders || []);
    }

    billingState.supplies.push(newSupply);
    billingState.isSaved = false;
    billingState.suppliesSessionKey = `${billingState.currentPeriodId}_${billingState.currentCommerce}`;
    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Insumo agregado',
      text: newSupply.qtyMode === 'dynamic_groups'
        ? `Se agregó "${newSupply.name}" (${newSupply.formulaCode}: ${newSupply.qty} ud.).`
        : `Se agregó "${newSupply.name}" al desglose.`,
      showConfirmButton: false,
      timer: 2800
    });
  }
};

// Eliminar un ítem de insumo
window.deleteManualSupplyItem = function(supplyIdOrIdx) {
  if (guardBillingLocked()) return;
  const b = billingState;
  const idx = b.supplies.findIndex((s, i) => String(s.id) === String(supplyIdOrIdx) || String(i) === String(supplyIdOrIdx));
  if (idx === -1) return;

  const item = b.supplies[idx];
  Swal.fire({
    title: '¿Eliminar ítem de cobro?',
    html: `
      <div style="text-align: left; font-size: 0.9rem; color: #334155;">
        ¿Estás seguro de eliminar <strong>${escapeHtml(item.name)}</strong> del desglose?
        <div style="margin-top: 0.75rem; padding: 0.6rem 0.85rem; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px; font-size: 0.8rem; color: #991b1b;">
          Se descontarán <strong>${formatCLP(Math.round((item.total || 0) * 1.19))}</strong> (IVA incl.) del total a facturar.
        </div>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: '<i class="ri-delete-bin-line"></i> Sí, eliminar',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      b.supplies.splice(idx, 1);
      b.isSaved = false;
      b.suppliesSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;

      recalculateFromCurrentState();

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Ítem eliminado',
        text: `"${item.name}" fue eliminado del desglose.`,
        showConfirmButton: false,
        timer: 3000
      });
    }
  });
};

// Editar un ítem de insumo (nombre, cantidad fija o dinámica por agendas, precio)
window.editManualSupplyItem = async function(supplyIdOrIdx) {
  if (guardBillingLocked()) return;
  const b = billingState;
  const idx = b.supplies.findIndex((s, i) => String(s.id) === String(supplyIdOrIdx) || String(i) === String(supplyIdOrIdx));
  if (idx === -1) return;

  const item = b.supplies[idx];
  const ordersList = b.orders || [];
  const existingSelected = Array.isArray(item.selectedGroups) && item.selectedGroups.length > 0
    ? item.selectedGroups
    : ['RM', 'FLEX', 'REGIONES'];
  const catalog = getOrderSupplyGroupsCatalog(ordersList, existingSelected);
  const initialMode = item.qtyMode === 'dynamic_groups' ? 'dynamic_groups' : 'manual';
  const initialPerOrderQty = item.perOrderQty || 1;

  let modalState = {
    mode: initialMode,
    selectedKeys: [...existingSelected.filter(k => catalog.some(g => g.key === k))],
    perOrderQty: initialPerOrderQty
  };

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-pencil-line" style="color:#5f06fa;"></i><span>Editar Ítem de Insumo</span></div>',
    width: '580px',
    html: `
      <div style="text-align: left; font-size: 0.88rem;">
        <label style="font-size: 0.75rem; font-weight: 800; color: #475569; display: block; margin-bottom: 0.25rem;">NOMBRE DEL INSUMO:</label>
        <input id="swal-edit-supply-name" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${escapeHtml(item.name)}">
        
        ${renderSupplyDynamicGroupSelectorHTML(catalog, initialMode, modalState.selectedKeys, initialPerOrderQty)}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 800; color: #475569; display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem;">
              <span>CANTIDAD:</span>
              <span id="swal-edit-supply-qty-badge" style="font-size: 0.64rem; background: #ede9fe; color: #5f06fa; padding: 1px 5px; border-radius: 4px; font-weight: 800; display: ${initialMode === 'dynamic_groups' ? 'inline-block' : 'none'};">DINÁMICA</span>
            </label>
            <input id="swal-edit-supply-qty" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; font-weight: 700;" min="0" value="${item.qty || 1}">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 800; color: #475569; display: block; margin-bottom: 0.25rem;">PRECIO UNITARIO ($ NETO):</label>
            <input id="swal-edit-supply-price" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; font-weight: 700;" min="0" value="${item.unitPrice || 0}">
          </div>
        </div>

        <div style="margin-top: 0.65rem; padding: 0.5rem 0.75rem; background: #f1f5f9; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem;">
          <span style="color: #475569; font-weight: 700;">Total Neto Insumo:</span>
          <strong id="swal-edit-supply-total-net-lbl" style="color: #5f06fa; font-size: 0.92rem; font-weight: 900;">$0</strong>
        </div>
      </div>
    `,
    didOpen: () => {
      const qtyInp = document.getElementById('swal-edit-supply-qty');
      const qtyBadge = document.getElementById('swal-edit-supply-qty-badge');
      const priceInp = document.getElementById('swal-edit-supply-price');
      const totalNetLbl = document.getElementById('swal-edit-supply-total-net-lbl');

      const btnModeDynamic = document.getElementById('swal-sup-mode-dynamic');
      const btnModeManual = document.getElementById('swal-sup-mode-manual');
      const dynamicPanel = document.getElementById('swal-sup-dynamic-panel');
      const perOrderInp = document.getElementById('swal-sup-per-order-qty');
      const formulaSummary = document.getElementById('swal-sup-formula-summary');
      const groupPills = Array.from(document.querySelectorAll('.swal-sup-group-pill'));
      const presetBtns = Array.from(document.querySelectorAll('.swal-sup-preset-btn'));

      const updateTotalPreview = () => {
        const q = Math.max(0, parseInt(qtyInp?.value, 10) || 0);
        const p = Math.max(0, Math.round(parseFloat(priceInp?.value) || 0));
        const net = q * p;
        if (totalNetLbl) {
          totalNetLbl.textContent = `${formatCLP(net)} neto (${formatCLP(Math.round(net * 1.19))} IVA incl.)`;
        }
      };

      const refreshDynamicUI = () => {
        const isDyn = modalState.mode === 'dynamic_groups';
        if (dynamicPanel) dynamicPanel.style.display = isDyn ? 'block' : 'none';
        if (qtyBadge) qtyBadge.style.display = isDyn ? 'inline-block' : 'none';

        if (btnModeDynamic) {
          btnModeDynamic.style.background = isDyn ? '#5f06fa' : 'transparent';
          btnModeDynamic.style.color = isDyn ? '#ffffff' : '#475569';
        }
        if (btnModeManual) {
          btnModeManual.style.background = !isDyn ? '#5f06fa' : 'transparent';
          btnModeManual.style.color = !isDyn ? '#ffffff' : '#475569';
        }

        const selSet = new Set(modalState.selectedKeys);
        groupPills.forEach(pill => {
          const k = pill.getAttribute('data-group-key');
          const active = selSet.has(k);
          pill.style.borderColor = active ? '#5f06fa' : '#cbd5e1';
          pill.style.background = active ? 'rgba(95, 6, 250, 0.1)' : '#ffffff';
          pill.style.color = active ? '#4c1d95' : '#334155';
          const icon = pill.querySelector('.swal-sup-pill-icon');
          if (icon) {
            icon.className = `swal-sup-pill-icon ${active ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}`;
            icon.style.color = active ? '#5f06fa' : '#94a3b8';
          }
          const badge = pill.querySelector('span:last-child');
          if (badge) {
            badge.style.background = active ? '#5f06fa' : '#f1f5f9';
            badge.style.color = active ? '#ffffff' : '#475569';
          }
        });

        if (isDyn) {
          const stats = computeDynamicSupplyGroupStats(ordersList, modalState.selectedKeys);
          const perOrd = Math.max(0.01, parseFloat(perOrderInp?.value) || 1);
          modalState.perOrderQty = perOrd;
          const finalQty = item.isBubbleLinearCm ? 1 : Math.round(stats.totalOrders * perOrd);
          if (qtyInp) qtyInp.value = finalQty;
          updateTotalPreview();

          if (formulaSummary) {
            if (stats.activeGroups.length === 0) {
              formulaSummary.innerHTML = `<span style="color:#dc2626; font-weight:700;"><i class="ri-error-warning-line"></i> Selecciona al menos un grupo de pedidos arriba.</span>`;
            } else {
              const multTxt = (!item.isBubbleLinearCm && perOrd !== 1) ? ` &times; ${perOrd} ud/ped = <strong>${finalQty} ud.</strong>` : '';
              formulaSummary.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span><strong style="color:#5f06fa;">${escapeHtml(stats.formulaCode)}</strong>: ${escapeHtml(stats.formulaText)}</span>
                  <span style="background:#5f06fa; color:#fff; padding:1px 7px; border-radius:999px; font-weight:800; font-size:0.7rem;">
                    ${stats.totalOrders} ped. únicos${multTxt}
                  </span>
                </div>
              `;
            }
          }
        } else {
          updateTotalPreview();
        }
      };

      btnModeDynamic?.addEventListener('click', () => {
        modalState.mode = 'dynamic_groups';
        refreshDynamicUI();
      });

      btnModeManual?.addEventListener('click', () => {
        modalState.mode = 'manual';
        refreshDynamicUI();
      });

      groupPills.forEach(pill => {
        pill.addEventListener('click', () => {
          const k = pill.getAttribute('data-group-key');
          if (!k) return;
          const pIdx = modalState.selectedKeys.indexOf(k);
          if (pIdx >= 0) {
            modalState.selectedKeys.splice(pIdx, 1);
          } else {
            modalState.selectedKeys.push(k);
          }
          modalState.mode = 'dynamic_groups';
          refreshDynamicUI();
        });
      });

      presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-preset');
          if (preset === 'rm_flex_reg') {
            modalState.selectedKeys = ['RM', 'FLEX', 'REGIONES'].filter(k => catalog.some(g => g.key === k));
          } else if (preset === 'rm_flex') {
            modalState.selectedKeys = ['RM', 'FLEX'].filter(k => catalog.some(g => g.key === k));
          } else if (preset === 'regiones') {
            modalState.selectedKeys = ['REGIONES'].filter(k => catalog.some(g => g.key === k));
          } else if (preset === 'all_agenda') {
            modalState.selectedKeys = catalog.filter(g => g.key !== 'SIN_AGENDA' && g.count > 0).map(g => g.key);
          } else if (preset === 'all') {
            modalState.selectedKeys = catalog.filter(g => g.count > 0).map(g => g.key);
          } else if (preset === 'none') {
            modalState.selectedKeys = [];
          }
          modalState.mode = 'dynamic_groups';
          refreshDynamicUI();
        });
      });

      perOrderInp?.addEventListener('input', refreshDynamicUI);
      qtyInp?.addEventListener('input', () => {
        if (modalState.mode === 'dynamic_groups') {
          modalState.mode = 'manual';
          refreshDynamicUI();
        } else {
          updateTotalPreview();
        }
      });
      priceInp?.addEventListener('input', updateTotalPreview);

      refreshDynamicUI();
    },
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const name = document.getElementById('swal-edit-supply-name')?.value?.trim();
      const qty = parseInt(document.getElementById('swal-edit-supply-qty')?.value, 10);
      const price = parseInt(document.getElementById('swal-edit-supply-price')?.value, 10);
      const perOrderQty = Math.max(0.01, parseFloat(document.getElementById('swal-sup-per-order-qty')?.value) || 1);

      if (!name) {
        Swal.showValidationMessage('El nombre del insumo no puede estar vacío.');
        return false;
      }
      if (isNaN(price) || price < 0) {
        Swal.showValidationMessage('Ingresa un precio unitario válido.');
        return false;
      }

      if (modalState.mode === 'dynamic_groups') {
        if (!modalState.selectedKeys || modalState.selectedKeys.length === 0) {
          Swal.showValidationMessage('Selecciona al menos un grupo/agenda de pedidos o cambia a modo "Fija Manual".');
          return false;
        }
        const stats = computeDynamicSupplyGroupStats(ordersList, modalState.selectedKeys);
        return {
          name,
          qty: Math.round(stats.totalOrders * perOrderQty),
          price,
          qtyMode: 'dynamic_groups',
          selectedGroups: stats.selectedKeys,
          perOrderQty
        };
      }

      if (isNaN(qty) || qty < 0) {
        Swal.showValidationMessage('Ingresa una cantidad válida.');
        return false;
      }
      return { name, qty, price, qtyMode: 'manual', selectedGroups: [], perOrderQty: 1 };
    }
  });

  if (formValues) {
    if (formValues.qtyMode === 'manual' && formValues.qty === 0) {
      b.supplies.splice(idx, 1);
    } else {
      item.name = formValues.name;
      item.qty = formValues.qty;
      item.unitPrice = formValues.price;
      item.total = formValues.qty * formValues.price;
      item.qtyMode = formValues.qtyMode;
      item.selectedGroups = formValues.selectedGroups;
      item.perOrderQty = formValues.perOrderQty;
      if (item.qtyMode === 'dynamic_groups') {
        syncDynamicSuppliesQuantities([item], b.orders || []);
      } else {
        delete item.formulaCode;
        delete item.formulaText;
        delete item.dynamicSummary;
      }
    }

    b.isSaved = false;
    b.suppliesSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;
    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Insumo actualizado',
      showConfirmButton: false,
      timer: 2500
    });
  }
};

// Agregar Fila Manual de Ajuste / Descuento Comercial
window.addNewManualAdjustmentRow = async function() {
  if (guardBillingLocked()) return;
  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-price-tag-3-line" style="color:#5f06fa;"></i><span>Agregar Ajuste Comercial / Descuento</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CONCEPTO / RAZÓN:</label>
        <input id="swal-adj-concept" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Ej: Descuento Comercial Acordado o Cobro Especial" value="Descuento Comercial Acordado">
        
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">MONTO NETO ($ - Usar negativo para descuentos):</label>
        <input id="swal-adj-amount" type="number" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="-15000" value="-10000">

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">NOTAS INTERNAS:</label>
        <input id="swal-adj-notes" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Autorizado por Gerencia">
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Aplicar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const concept = document.getElementById('swal-adj-concept')?.value?.trim();
      const amount = parseInt(document.getElementById('swal-adj-amount')?.value, 10);
      const notes = document.getElementById('swal-adj-notes')?.value?.trim() || '';

      if (!concept) {
        Swal.showValidationMessage('Ingresa un concepto para el ajuste.');
        return false;
      }
      if (isNaN(amount) || amount === 0) {
        Swal.showValidationMessage('Ingresa un monto válido distinto de cero.');
        return false;
      }

      return { concept, amount, notes };
    }
  });

  if (formValues && formValues.concept) {
    billingState.adjustments.push({
      id: 'adj_' + Date.now(),
      concept: formValues.concept,
      amount: formValues.amount,
      notes: formValues.notes
    });
    billingState.isSaved = false;
    billingState.adjustmentsSessionKey = `${billingState.currentPeriodId}_${billingState.currentCommerce}`;
    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Ajuste aplicado',
      text: `${formValues.concept} por ${formatCLP(formValues.amount)} aplicado.`,
      showConfirmButton: false,
      timer: 2500
    });
  }
};

// Eliminar un ajuste comercial
window.deleteManualAdjustmentItem = function(adjIdOrIdx) {
  if (guardBillingLocked()) return;
  const b = billingState;
  const idx = b.adjustments.findIndex((a, i) => String(a.id) === String(adjIdOrIdx) || String(i) === String(adjIdOrIdx));
  if (idx === -1) return;

  const item = b.adjustments[idx];
  Swal.fire({
    title: '¿Eliminar ajuste comercial?',
    html: `¿Estás seguro de eliminar el ajuste <strong>${escapeHtml(item.concept || 'Ajuste comercial')}</strong> (${formatCLP(item.amount)})?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: '<i class="ri-delete-bin-line"></i> Sí, eliminar',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      b.adjustments.splice(idx, 1);
      b.isSaved = false;
      b.adjustmentsSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;

      recalculateFromCurrentState();

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Ajuste eliminado',
        showConfirmButton: false,
        timer: 3000
      });
    }
  });
};

// --- GESTIÓN DE ABONOS A CUENTA (DESCUENTAN DIRECTAMENTE EL TOTAL A PAGAR) ---

// Agregar Fila Manual de Abono a Cuenta
window.addNewManualAbonoRow = async function() {
  if (guardBillingLocked()) return;
  const b = billingState;
  const todayStr = new Date().toISOString().split('T')[0];

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-hand-coin-line" style="color:#10b981;"></i><span>Registrar Abono a Cuenta</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0; margin-bottom: 0.85rem;">
          Registra un abono o anticipo comercial. Este monto <strong>descuenta directamente el saldo a pagar</strong> por el cliente, sin alterar la base imponible ni el IVA de la factura.
        </p>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">MONTO ABONADO ($ CLP CON IVA / TOTAL):</label>
        <input id="swal-abono-amount" type="number" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.95rem; font-weight: 700; color: #047857;" placeholder="Ej: 500000" min="1" step="1000">

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">FECHA DEL ABONO:</label>
            <input id="swal-abono-date" type="date" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${todayStr}">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">N° COMPROBANTE / VOUCHER:</label>
            <input id="swal-abono-voucher" type="text" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Ej: #TRF-98124">
          </div>
        </div>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CONCEPTO O REFERENCIA:</label>
        <input id="swal-abono-ref" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Ej: Abono 50% anticipado o Transferencia bancaria" value="Abono a cuenta">

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">NOTAS INTERNAS / OBSERVACIONES:</label>
        <input id="swal-abono-notes" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Ej: Verificado en cartola bancaria">
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Registrar Abono',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    preConfirm: () => {
      const amountVal = document.getElementById('swal-abono-amount')?.value;
      const amount = Math.abs(parseInt(amountVal, 10));
      const date = document.getElementById('swal-abono-date')?.value?.trim();
      const voucher = document.getElementById('swal-abono-voucher')?.value?.trim() || '';
      const reference = document.getElementById('swal-abono-ref')?.value?.trim() || 'Abono a cuenta';
      const notes = document.getElementById('swal-abono-notes')?.value?.trim() || '';

      if (isNaN(amount) || amount <= 0) {
        Swal.showValidationMessage('Ingresa un monto de abono válido mayor a $0.');
        return false;
      }

      return { amount, date, voucher, reference, notes };
    }
  });

  if (formValues && formValues.amount > 0) {
    if (!Array.isArray(b.abonos)) b.abonos = [];

    b.abonos.push({
      id: 'abono_' + Date.now(),
      amount: formValues.amount,
      date: formValues.date,
      voucher: formValues.voucher,
      reference: formValues.reference,
      notes: formValues.notes
    });

    b.isSaved = false;
    b.abonosSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;

    const storageKey = `stocka_billing_abonos_${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(b.abonos));
    } catch (e) {}

    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Abono registrado',
      text: `Se registró abono por ${formatCLP(formValues.amount)}.`,
      showConfirmButton: false,
      timer: 3000
    });
  }
};

// Editar un abono registrado
window.editManualAbonoItem = async function(abonoIdOrIdx) {
  if (guardBillingLocked()) return;
  const b = billingState;
  if (!Array.isArray(b.abonos)) return;
  const idx = b.abonos.findIndex((a, i) => String(a.id) === String(abonoIdOrIdx) || String(i) === String(abonoIdOrIdx));
  if (idx === -1) return;

  const ab = b.abonos[idx];

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-edit-line" style="color:#10b981;"></i><span>Editar Abono</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">MONTO ABONADO ($ CLP CON IVA / TOTAL):</label>
        <input id="swal-edit-abono-amount" type="number" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.95rem; font-weight: 700; color: #047857;" value="${ab.amount || 0}" min="1" step="1000">

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">FECHA DEL ABONO:</label>
            <input id="swal-edit-abono-date" type="date" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${ab.date || ''}">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">N° COMPROBANTE / VOUCHER:</label>
            <input id="swal-edit-abono-voucher" type="text" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${escapeHtml(ab.voucher || '')}">
          </div>
        </div>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CONCEPTO O REFERENCIA:</label>
        <input id="swal-edit-abono-ref" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${escapeHtml(ab.reference || 'Abono a cuenta')}">

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">NOTAS INTERNAS / OBSERVACIONES:</label>
        <input id="swal-edit-abono-notes" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${escapeHtml(ab.notes || '')}">
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    preConfirm: () => {
      const amountVal = document.getElementById('swal-edit-abono-amount')?.value;
      const amount = Math.abs(parseInt(amountVal, 10));
      const date = document.getElementById('swal-edit-abono-date')?.value?.trim();
      const voucher = document.getElementById('swal-edit-abono-voucher')?.value?.trim() || '';
      const reference = document.getElementById('swal-edit-abono-ref')?.value?.trim() || 'Abono a cuenta';
      const notes = document.getElementById('swal-edit-abono-notes')?.value?.trim() || '';

      if (isNaN(amount) || amount <= 0) {
        Swal.showValidationMessage('Ingresa un monto de abono válido mayor a $0.');
        return false;
      }

      return { amount, date, voucher, reference, notes };
    }
  });

  if (formValues) {
    ab.amount = formValues.amount;
    ab.date = formValues.date;
    ab.voucher = formValues.voucher;
    ab.reference = formValues.reference;
    ab.notes = formValues.notes;

    b.isSaved = false;
    b.abonosSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;

    const storageKey = `stocka_billing_abonos_${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(b.abonos));
    } catch (e) {}

    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Abono actualizado',
      text: `Monto actualizado a ${formatCLP(formValues.amount)}.`,
      showConfirmButton: false,
      timer: 2500
    });
  }
};

// Eliminar un abono registrado
window.deleteManualAbonoItem = function(abonoIdOrIdx) {
  if (guardBillingLocked()) return;
  const b = billingState;
  if (!Array.isArray(b.abonos)) return;
  const idx = b.abonos.findIndex((a, i) => String(a.id) === String(abonoIdOrIdx) || String(i) === String(abonoIdOrIdx));
  if (idx === -1) return;

  const ab = b.abonos[idx];
  Swal.fire({
    title: '¿Eliminar abono registrado?',
    html: `
      <div style="text-align: left; font-size: 0.9rem; color: #334155;">
        ¿Estás seguro de eliminar el abono <strong>${escapeHtml(ab.reference || 'Abono')}</strong> (${formatCLP(ab.amount)})?
        <div style="margin-top: 0.75rem; padding: 0.6rem 0.85rem; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px; font-size: 0.8rem; color: #991b1b;">
          El saldo a pagar por el cliente volverá a incrementarse en <strong>${formatCLP(ab.amount)}</strong>.
        </div>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: '<i class="ri-delete-bin-line"></i> Sí, eliminar abono',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      if (ab.id === 'abono_pos_sales' || ab.isPosAbono) {
        b.posAbonoExcludedManually = true;
      }
      b.abonos.splice(idx, 1);
      b.isSaved = false;
      b.abonosSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;

      const storageKey = `stocka_billing_abonos_${b.currentPeriodId}_${b.currentCommerce}`;
      try {
        localStorage.setItem(storageKey, JSON.stringify(b.abonos));
      } catch (e) {}

      recalculateFromCurrentState();

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Abono eliminado',
        text: `Se eliminó el abono de ${formatCLP(ab.amount)}.`,
        showConfirmButton: false,
        timer: 3000
      });
    }
  });
};

// Modal interactivo para gestionar las Ventas POS consideradas como Abono en el Periodo actual
window.openManagePosAbonosBillingModal = async function() {
  const b = billingState;
  if (!b.currentCommerce || !b.currentPeriodName) {
    Swal.fire('Atención', 'Selecciona primero un comercio y un periodo de facturación.', 'warning');
    return;
  }

  const targetPeriodUpper = String(b.currentPeriodName || '').trim().toUpperCase();

  try {
    Swal.fire({
      title: 'Consultando Ventas POS...',
      text: `Cargando ventas de ${b.currentCommerce} en Punto de Venta...`,
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const posGroup = b.isConglomerate && Array.isArray(b.conglomerateChildren) && b.conglomerateChildren.length > 0
      ? [b.currentCommerce, ...b.conglomerateChildren]
      : await resolveCommerceGroup(b.currentCommerce);

    const posData = await fetchAndComputePosSalesAbonoForBilling(posGroup, targetPeriodUpper, b.pricingConfig, b.orders);
    b.allMerchantPosSales = posData.allSales;
    b.posAbonoSales = posData.periodAbonoSales;
    b.posAbonoSummary = posData.summary;

    const allSales = posData.allSales || [];
    Swal.close();

    if (allSales.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Sin Ventas POS Registradas',
        html: `No se encontraron ventas presenciales registradas en Punto de Venta para <strong>${escapeHtml(b.currentCommerce)}</strong>.`,
        confirmButtonColor: '#5f06fa'
      });
      return;
    }

    const isLocked = Boolean(b.isLocked);

    const rowsHtml = allSales.map((s) => {
      const isIncludedInCurrent = Boolean(s.is_abono && s.abono_period === targetPeriodUpper);
      const d = s.created_at ? new Date(s.created_at) : null;
      const dateFmt = (d && !isNaN(d.getTime()))
        ? d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        : '-';

      return `
        <tr class="bg-pos-modal-row" data-sale-id="${s.id}" data-gross="${s.monto_total}" data-comm-net="${s.commission_net}" data-comm-iva="${s.commission_iva}" data-comm-total="${s.commission_total}" data-payout="${s.seller_payout}" style="border-bottom: 1px solid #e2e8f0; background: ${isIncludedInCurrent ? 'rgba(16, 185, 129, 0.06)' : '#ffffff'};">
          <td style="text-align: center; padding: 7px 6px;">
            <input type="checkbox" class="bg-pos-sale-chk" data-sale-id="${s.id}" ${isIncludedInCurrent ? 'checked' : ''} ${isLocked ? 'disabled' : ''} style="width: 16px; height: 16px; accent-color: #059669; cursor: pointer;">
          </td>
          <td style="padding: 7px 6px; font-size: 0.74rem; white-space: nowrap; color: #334155;">${escapeHtml(dateFmt)}</td>
          <td style="padding: 7px 6px;">
            <span style="font-family: monospace; font-size: 0.75rem; font-weight: 800; background: #f8fafc; border: 1px solid #cbd5e1; padding: 1px 5px; border-radius: 4px; display: inline-block;">${escapeHtml(s.codigo_venta)}</span>
            ${s.tx_code ? `<div style="margin-top: 2px;"><span style="font-family: monospace; font-size: 0.66rem; font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 5px; border-radius: 4px; display: inline-block;">TX: ${escapeHtml(s.tx_code)}</span></div>` : ''}
          </td>
          <td style="padding: 7px 6px; font-size: 0.75rem; font-weight: 700; color: #0f172a;">${escapeHtml(s.comercio)}</td>
          <td style="padding: 7px 6px; font-size: 0.75rem; color: #1e293b;">
            <div style="font-weight: 600;">${escapeHtml(s.nombre_cliente)}</div>
            <div style="font-size: 0.66rem; color: #64748b;">${escapeHtml(s.modo_pago)}</div>
          </td>
          <td style="padding: 7px 6px; font-size: 0.73rem;">
            <div style="font-weight: 700; color: #0f172a;">${escapeHtml(s.machine_brand)} ${s.machine_model ? `#${escapeHtml(s.machine_model)}` : ''}</div>
            <span style="font-size: 0.64rem; color: ${s.is_stocka_machine ? '#1d4ed8' : '#7c3aed'}; font-weight: 700;">
              ${s.is_stocka_machine ? 'Propiedad STOCKA' : 'Propiedad ' + escapeHtml(s.machine_owner)}
            </span>
          </td>
          <td style="padding: 7px 6px; text-align: right; font-weight: 700; font-size: 0.78rem; color: #0f172a;">${formatCLP(s.monto_total)}</td>
          <td style="padding: 7px 6px; text-align: right; font-size: 0.75rem; color: #dc2626; font-weight: 700;">
            ${s.applies_settlement ? `-${formatCLP(s.commission_total)} <div style="font-size:0.62rem;color:#64748b;font-weight:500;">(${s.fee_pct.toFixed(2)}%+IVA)</div>` : '$0'}
          </td>
          <td style="padding: 7px 8px; text-align: right; font-weight: 900; font-size: 0.82rem; color: #059669;">${formatCLP(s.seller_payout)}</td>
          <td style="padding: 7px 6px; text-align: center; font-size: 0.7rem;">
            <span class="bg-pos-row-period-badge" style="padding: 2px 6px; border-radius: 4px; font-weight: 800; background: ${isIncludedInCurrent ? '#d1fae5' : '#f1f5f9'}; color: ${isIncludedInCurrent ? '#065f46' : '#64748b'};">
              ${isIncludedInCurrent ? escapeHtml(targetPeriodUpper) : escapeHtml(s.is_abono ? s.abono_period : 'Sin Abono')}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    const { value: selectedIds } = await Swal.fire({
      title: `<div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;font-size:1.1rem;"><i class="ri-store-3-line" style="color:#059669;"></i><span>Ventas POS Consideradas como Abono (${escapeHtml(targetPeriodUpper)})</span></div>`,
      width: '940px',
      html: `
        <div style="text-align: left; font-size: 0.84rem;">
          <p style="margin: 0 0 0.75rem 0; color: #475569; line-height: 1.45;">
            Selecciona las ventas de <strong>${escapeHtml(b.currentCommerce)}</strong> en Punto de Venta cuya recaudación neta (descontando comisión POS + IVA) se considera como <strong>Abono al Servicio de Fulfillment</strong> en el periodo <strong>${escapeHtml(targetPeriodUpper)}</strong>:
          </p>

          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.65rem; margin-bottom: 0.85rem; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 0.65rem 0.85rem;">
            <div>
              <span style="font-size: 0.66rem; text-transform: uppercase; color: #065f46; font-weight: 800; display: block;">Ventas Seleccionadas</span>
              <strong id="swal-pos-abono-count" style="font-size: 1.1rem; color: #0f172a;">0</strong>
            </div>
            <div>
              <span style="font-size: 0.66rem; text-transform: uppercase; color: #065f46; font-weight: 800; display: block;">Total Bruto Ventas</span>
              <strong id="swal-pos-abono-gross" style="font-size: 1.1rem; color: #0f172a;">$0</strong>
            </div>
            <div>
              <span style="font-size: 0.66rem; text-transform: uppercase; color: #dc2626; font-weight: 800; display: block;">Comisión POS (+IVA)</span>
              <strong id="swal-pos-abono-comm" style="font-size: 1.1rem; color: #dc2626;">-$0</strong>
            </div>
            <div style="background: #ffffff; border: 1px solid #34d399; border-radius: 6px; padding: 0.25rem 0.55rem;">
              <span style="font-size: 0.66rem; text-transform: uppercase; color: #047857; font-weight: 800; display: block;">Monto Abono Periodo</span>
              <strong id="swal-pos-abono-net" style="font-size: 1.15rem; color: #059669; font-weight: 900;">$0</strong>
            </div>
          </div>

          <div style="max-height: 360px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
              <thead style="position: sticky; top: 0; background: #f8fafc; z-index: 2; border-bottom: 2px solid #cbd5e1;">
                <tr>
                  <th style="width: 36px; text-align: center; padding: 7px 6px;">
                    <input type="checkbox" id="swal-pos-master-chk" ${isLocked ? 'disabled' : ''} style="width: 15px; height: 15px; accent-color: #059669; cursor: pointer;" title="Seleccionar / Deseleccionar todas">
                  </th>
                  <th style="text-align: left; padding: 7px 6px;">Fecha</th>
                  <th style="text-align: left; padding: 7px 6px;">Código</th>
                  <th style="text-align: left; padding: 7px 6px;">Comercio</th>
                  <th style="text-align: left; padding: 7px 6px;">Cliente / Pago</th>
                  <th style="text-align: left; padding: 7px 6px;">Máquina POS</th>
                  <th style="text-align: right; padding: 7px 6px;">Monto Bruto</th>
                  <th style="text-align: right; padding: 7px 6px;">Comisión + IVA</th>
                  <th style="text-align: right; padding: 7px 8px;">Pago Seller (Abono)</th>
                  <th style="text-align: center; padding: 7px 6px;">Periodo Asignado</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      `,
      showCancelButton: true,
      showConfirmButton: !isLocked,
      confirmButtonText: '<i class="ri-check-double-line"></i> Guardar y Sincronizar Abono en Desglose',
      cancelButtonText: isLocked ? 'Cerrar' : 'Cancelar',
      confirmButtonColor: '#059669',
      didOpen: () => {
        const chks = Array.from(document.querySelectorAll('.bg-pos-sale-chk'));
        const masterChk = document.getElementById('swal-pos-master-chk');

        const recomputeModalTotals = () => {
          let cnt = 0;
          let gross = 0;
          let comm = 0;
          let net = 0;
          chks.forEach(c => {
            const tr = c.closest('tr');
            const badge = tr?.querySelector('.bg-pos-row-period-badge');
            if (c.checked) {
              cnt++;
              gross += Number(tr?.dataset.gross || 0);
              comm += Number(tr?.dataset.commTotal || 0);
              net += Number(tr?.dataset.payout || 0);
              if (tr) tr.style.background = 'rgba(16, 185, 129, 0.06)';
              if (badge) {
                badge.textContent = targetPeriodUpper;
                badge.style.background = '#d1fae5';
                badge.style.color = '#065f46';
              }
            } else {
              if (tr) tr.style.background = '#ffffff';
              if (badge) {
                badge.textContent = 'No incluido';
                badge.style.background = '#f1f5f9';
                badge.style.color = '#64748b';
              }
            }
          });
          const elCnt = document.getElementById('swal-pos-abono-count');
          const elGross = document.getElementById('swal-pos-abono-gross');
          const elComm = document.getElementById('swal-pos-abono-comm');
          const elNet = document.getElementById('swal-pos-abono-net');
          if (elCnt) elCnt.textContent = String(cnt);
          if (elGross) elGross.textContent = formatCLP(gross);
          if (elComm) elComm.textContent = `-${formatCLP(comm)}`;
          if (elNet) elNet.textContent = formatCLP(net);
        };

        chks.forEach(c => c.addEventListener('change', recomputeModalTotals));
        if (masterChk) {
          masterChk.checked = chks.length > 0 && chks.every(c => c.checked);
          masterChk.addEventListener('change', () => {
            chks.forEach(c => { c.checked = masterChk.checked; });
            recomputeModalTotals();
          });
        }
        recomputeModalTotals();
      },
      preConfirm: () => {
        const chks = Array.from(document.querySelectorAll('.bg-pos-sale-chk'));
        return new Set(chks.filter(c => c.checked).map(c => String(c.dataset.saleId)));
      }
    });

    if (!selectedIds) return;

    Swal.fire({
      title: 'Actualizando Ventas POS...',
      text: 'Guardando asignación de periodo y sincronizando abono...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    // Actualizar en store_sales aquellas ventas cuyo estado cambió respecto al periodo actual
    for (const s of allSales) {
      const shouldBeInPeriod = selectedIds.has(String(s.id));
      const wasInPeriod = Boolean(s.is_abono && s.abono_period === targetPeriodUpper);

      if (shouldBeInPeriod !== wasInPeriod) {
        const newPeriodTag = shouldBeInPeriod ? targetPeriodUpper : 'SIN_ABONO';
        let updatedComment = String(s.raw_comentarios || '').replace(/\s*\[ABONO-PER:\s*[^\]]+\]/gi, '').trim();
        updatedComment = `${updatedComment} [ABONO-PER: ${newPeriodTag}]`.trim();

        await supabase
          .from('store_sales')
          .update({ comentarios: updatedComment, updated_at: new Date().toISOString() })
          .eq('id', s.id);

        s.raw_comentarios = updatedComment;
        s.abono_period = newPeriodTag;
        s.is_abono = shouldBeInPeriod;
        s.is_explicit_period = true;
      }
    }

    b.posAbonoExcludedManually = false;
    b.posAbonoSales = allSales.filter(s => selectedIds.has(String(s.id)));
    b.posAbonoSummary = {
      salesCount: b.posAbonoSales.length,
      totalGross: b.posAbonoSales.reduce((acc, s) => acc + s.monto_total, 0),
      totalCommissionNet: b.posAbonoSales.reduce((acc, s) => acc + s.commission_net, 0),
      totalCommissionIva: b.posAbonoSales.reduce((acc, s) => acc + s.commission_iva, 0),
      totalCommissionWithIva: b.posAbonoSales.reduce((acc, s) => acc + s.commission_total, 0),
      totalAbonoAmount: b.posAbonoSales.reduce((acc, s) => acc + s.seller_payout, 0)
    };

    syncPosAbonoIntoBillingState(b);
    b.isSaved = false;
    b.abonosSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(`stocka_billing_abonos_${b.currentPeriodId}_${b.currentCommerce}`, JSON.stringify(b.abonos));
    } catch (e) {}

    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Abono POS Sincronizado',
      text: `${b.posAbonoSummary.salesCount} venta(s) POS por ${formatCLP(b.posAbonoSummary.totalAbonoAmount)} abonadas en ${targetPeriodUpper}.`,
      showConfirmButton: false,
      timer: 3200
    });
  } catch (err) {
    console.error('Error gestionando ventas POS en facturación:', err);
    Swal.fire('Error', 'No se pudo actualizar las ventas POS: ' + (err.message || err), 'error');
  }
};

// Modal interactivo para editar o eximir Costo Variable Mensual
window.openEditFixedFeeModal = async function() {
  if (guardBillingLocked()) return;
  const b = billingState;
  const t = b.totals;

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-money-dollar-box-line" style="color: #5f06fa;"></i><span>Costo Variable Mensual</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0; margin-bottom: 1rem;">
          Modifica el costo variable mensual para este periodo. Puedes seleccionar un rango estándar, ingresar un monto personalizado o dejarlo como <strong>Exento ($0)</strong>.
        </p>
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CONDICIÓN / RANGO:</label>
        <select id="swal-fixedfee-mode" class="swal2-select" style="width: 100%; height: 38px; margin: 0 0 0.75rem 0; font-size: 0.85rem;">
          <option value="exento" ${t.fixedFeeUF === 0 ? 'selected' : ''}>Exento ($0)</option>
          <option value="0.9" ${t.fixedFeeUF === 0.9 ? 'selected' : ''}>0.9 UF (${formatCLP(0.9 * b.ufValue)}) - Rango 2</option>
          <option value="1.5" ${t.fixedFeeUF === 1.5 ? 'selected' : ''}>1.5 UF (${formatCLP(1.5 * b.ufValue)}) - Rango 1</option>
          <option value="custom" ${t.fixedFeeUF > 0 && t.fixedFeeUF !== 0.9 && t.fixedFeeUF !== 1.5 ? 'selected' : ''}>Monto Personalizado ($ CLP)</option>
        </select>

        <div id="swal-fixedfee-custom-container" style="display: ${t.fixedFeeUF > 0 && t.fixedFeeUF !== 0.9 && t.fixedFeeUF !== 1.5 ? 'block' : 'none'}; margin-bottom: 0.75rem;">
          <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">MONTO NETO ($ CLP):</label>
          <input type="number" id="swal-fixedfee-custom-amount" class="swal2-input" style="width: 100%; height: 38px; margin: 0; font-size: 0.85rem;" value="${t.fixedFeeNet || 0}">
        </div>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">MOTIVO O NOTA EN LA FACTURA:</label>
        <input type="text" id="swal-fixedfee-reason" class="swal2-input" style="width: 100%; height: 38px; margin: 0; font-size: 0.85rem;" value="${escapeHtml(t.fixedFeeReason || '')}">
      </div>
    `,
    didOpen: () => {
      const modeSelect = document.getElementById('swal-fixedfee-mode');
      const customContainer = document.getElementById('swal-fixedfee-custom-container');
      const reasonInput = document.getElementById('swal-fixedfee-reason');

      modeSelect?.addEventListener('change', () => {
        if (modeSelect.value === 'custom') {
          customContainer.style.display = 'block';
        } else {
          customContainer.style.display = 'none';
        }

        if (modeSelect.value === 'exento') {
          reasonInput.value = 'Exento ($0) por acuerdo comercial';
        } else if (modeSelect.value === '0.9') {
          reasonInput.value = `Costo variable 0.9 UF (${formatCLP(0.9 * b.ufValue)})`;
        } else if (modeSelect.value === '1.5') {
          reasonInput.value = `Costo variable 1.5 UF (${formatCLP(1.5 * b.ufValue)})`;
        }
      });
    },
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Aplicar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const mode = document.getElementById('swal-fixedfee-mode')?.value;
      const customAmount = parseInt(document.getElementById('swal-fixedfee-custom-amount')?.value, 10) || 0;
      const reason = document.getElementById('swal-fixedfee-reason')?.value?.trim() || '';

      let clp = 0;
      let uf = 0;
      if (mode === 'exento') {
        clp = 0;
        uf = 0;
      } else if (mode === '0.9') {
        uf = 0.9;
        clp = Math.round(0.9 * b.ufValue);
      } else if (mode === '1.5') {
        uf = 1.5;
        clp = Math.round(1.5 * b.ufValue);
      } else {
        clp = customAmount;
        uf = b.ufValue > 0 ? parseFloat((customAmount / b.ufValue).toFixed(2)) : 0;
      }

      return { clp, uf, reason };
    }
  });

  if (formValues) {
    b.totals.fixedFeeNet = formValues.clp;
    b.totals.fixedFeeUF = formValues.uf;
    b.totals.fixedFeeReason = formValues.reason;

    const totalSuppliesNet = (b.supplies || []).reduce((acc, s) => acc + (s.total || 0), 0);
    const totalAdjustmentsNet = (b.adjustments || []).reduce((acc, a) => acc + (a.amount || 0), 0);
    const totalAbonos = (b.abonos || []).reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0);
    const inboundNet = b.totals.inboundNet || 0;
    const posFeeNet = b.totals.posFeeNet || 0;
    const meliFullNet = b.totals.meliFullNet || 0;
    const totalNet = Math.round(b.totals.storageNet + b.totals.pickPackNet + b.totals.shippingRmFlexNet + inboundNet + formValues.clp + posFeeNet + totalSuppliesNet + totalAdjustmentsNet + meliFullNet);
    const totalIVA = Math.round(totalNet * 0.19);
    const totalGross = totalNet + totalIVA;
    const totalToPay = Math.max(0, totalGross - totalAbonos);

    b.totals.suppliesNet = totalSuppliesNet;
    b.totals.totalSuppliesNet = totalSuppliesNet;
    b.totals.adjustmentsNet = totalAdjustmentsNet;
    b.totals.totalAdjustmentsNet = totalAdjustmentsNet;
    b.totals.totalAbonos = totalAbonos;
    b.totals.totalNet = totalNet;
    b.totals.iva = totalIVA;
    b.totals.totalGross = totalGross;
    b.totals.totalToPay = totalToPay;

    b.isSaved = false;
    renderKPIsUI();

    const desgloseCont = document.getElementById('bg-desglose-view-container');
    if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Costo variable actualizado',
      showConfirmButton: false,
      timer: 2500
    });
  }
};

// Modal interactivo para editar o eximir Cobro Punto de Venta (POS)
window.openEditPosFeeModal = async function() {
  if (guardBillingLocked()) return;
  const b = billingState;
  const t = b.totals;
  const machine = t.posMachine || {};
  const isStocka = t.posIsStocka;

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-store-3-line" style="color: #0ea5e9;"></i><span>Cobro Punto de Venta (POS)</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem;">
          <div style="font-size: 0.75rem; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 0.35rem;">Información del Equipo en Sucursal:</div>
          <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.35rem;">
            <span style="font-size: 0.8rem; font-weight: 600; color: #0f172a;">Propiedad:</span>
            <span class="badge" style="background: ${isStocka ? '#ede9fe' : '#e0f2fe'}; color: ${isStocka ? '#6d28d9' : '#0284c7'}; font-weight: 700; padding: 2px 7px; border-radius: 4px; font-size: 0.72rem;">
              ${isStocka ? 'Equipo provisto por STOCKA' : 'Equipo Propio del Comercio'}
            </span>
          </div>
          <div style="font-size: 0.775rem; color: #64748b; line-height: 1.4;">
            ${machine.brand ? `<div><strong>Marca:</strong> ${escapeHtml(machine.brand)}</div>` : ''}
            ${machine.model ? `<div><strong>N° Máquina/Terminal:</strong> #${escapeHtml(machine.model)}</div>` : ''}
            ${machine.color ? `<div><strong>Color/Distintivo:</strong> ${escapeHtml(machine.color)}</div>` : ''}
            ${machine.notes ? `<div><strong>Instrucciones Cajero:</strong> ${escapeHtml(machine.notes)}</div>` : ''}
          </div>
        </div>

        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0; margin-bottom: 0.75rem;">
          La tarifa oficial de servicio POS es de <strong>0,2 UF mensual</strong> (${formatCLP(0.2 * b.ufValue)}). Puedes modificar la condición o ingresar un monto personalizado.
        </p>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CONDICIÓN / TARIFA:</label>
        <select id="swal-posfee-mode" class="swal2-select" style="width: 100%; height: 38px; margin: 0 0 0.75rem 0; font-size: 0.85rem;">
          <option value="0.2" ${t.posFeeUF === 0.2 ? 'selected' : ''}>0.2 UF mensual (${formatCLP(0.2 * b.ufValue)}) - Tarifa Oficial</option>
          <option value="exento" ${t.posFeeUF === 0 ? 'selected' : ''}>Exento ($0) / Bonificado</option>
          <option value="custom" ${t.posFeeUF > 0 && t.posFeeUF !== 0.2 ? 'selected' : ''}>Monto Personalizado ($ CLP)</option>
        </select>

        <div id="swal-posfee-custom-container" style="display: ${t.posFeeUF > 0 && t.posFeeUF !== 0.2 ? 'block' : 'none'}; margin-bottom: 0.75rem;">
          <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">MONTO NETO ($ CLP):</label>
          <input type="number" id="swal-posfee-custom-amount" class="swal2-input" style="width: 100%; height: 38px; margin: 0; font-size: 0.85rem;" value="${t.posFeeNet || 0}">
        </div>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">DETALLE O NOTA EN LA FACTURA:</label>
        <input type="text" id="swal-posfee-reason" class="swal2-input" style="width: 100%; height: 38px; margin: 0; font-size: 0.85rem;" value="${escapeHtml(t.posFeeDetails || '')}">
      </div>
    `,
    didOpen: () => {
      const modeSelect = document.getElementById('swal-posfee-mode');
      const customContainer = document.getElementById('swal-posfee-custom-container');
      const reasonInput = document.getElementById('swal-posfee-reason');

      modeSelect?.addEventListener('change', () => {
        if (modeSelect.value === 'custom') {
          customContainer.style.display = 'block';
        } else {
          customContainer.style.display = 'none';
        }

        if (modeSelect.value === 'exento') {
          reasonInput.value = 'Exento ($0) por acuerdo comercial en Punto de Venta';
        } else if (modeSelect.value === '0.2') {
          const ownerLabel = isStocka ? 'Equipo provisto por STOCKA' : 'Equipo propio del comercio';
          reasonInput.value = `Cobro mensual POS (0,2 UF) @ ${formatCLP(b.ufValue)}/UF. ${ownerLabel}`;
        }
      });
    },
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Aplicar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#0ea5e9',
    preConfirm: () => {
      const mode = document.getElementById('swal-posfee-mode')?.value;
      const customAmount = parseInt(document.getElementById('swal-posfee-custom-amount')?.value, 10) || 0;
      const reason = document.getElementById('swal-posfee-reason')?.value?.trim() || '';

      let clp = 0;
      let uf = 0;
      if (mode === 'exento') {
        clp = 0;
        uf = 0;
      } else if (mode === '0.2') {
        uf = 0.2;
        clp = Math.round(0.2 * b.ufValue);
      } else {
        clp = customAmount;
        uf = b.ufValue > 0 ? parseFloat((customAmount / b.ufValue).toFixed(2)) : 0;
      }

      return { clp, uf, reason };
    }
  });

  if (formValues) {
    b.totals.posFeeNet = formValues.clp;
    b.totals.posFeeUF = formValues.uf;
    b.totals.posFeeDetails = formValues.reason;

    const totalSuppliesNet = (b.supplies || []).reduce((acc, s) => acc + (s.total || 0), 0);
    const totalAdjustmentsNet = (b.adjustments || []).reduce((acc, a) => acc + (a.amount || 0), 0);
    const totalAbonos = (b.abonos || []).reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0);
    const inboundNet = b.totals.inboundNet || 0;
    const fixedFeeNet = b.totals.fixedFeeNet || 0;
    const meliFullNet = b.totals.meliFullNet || 0;
    const totalNet = Math.round(b.totals.storageNet + b.totals.pickPackNet + b.totals.shippingRmFlexNet + inboundNet + fixedFeeNet + formValues.clp + totalSuppliesNet + totalAdjustmentsNet + meliFullNet);
    const totalIVA = Math.round(totalNet * 0.19);
    const totalGross = totalNet + totalIVA;
    const totalToPay = Math.max(0, totalGross - totalAbonos);

    b.totals.suppliesNet = totalSuppliesNet;
    b.totals.totalSuppliesNet = totalSuppliesNet;
    b.totals.adjustmentsNet = totalAdjustmentsNet;
    b.totals.totalAdjustmentsNet = totalAdjustmentsNet;
    b.totals.totalAbonos = totalAbonos;
    b.totals.totalNet = totalNet;
    b.totals.iva = totalIVA;
    b.totals.totalGross = totalGross;
    b.totals.totalToPay = totalToPay;

    b.isSaved = false;
    renderKPIsUI();

    const desgloseCont = document.getElementById('bg-desglose-view-container');
    if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Cobro de Punto de Venta actualizado',
      showConfirmButton: false,
      timer: 2500
    });
  }
};

// Modal interactivo para asignar o editar el volumen mensual (m³), tarifa de almacenamiento y descuento por volumen
window.openEditStorageFeeModal = async function() {
  if (guardBillingLocked()) return;
  const b = billingState;
  const t = b.totals || {};
  const activeRange = b.activeRange || {};
  const cfg = b.pricingConfig || DEFAULT_PRICING_CONFIG;
  const volM3 = parseFloat(b.volumeM3) || 0;
  const autoVolM3 = (b.autoVolumeM3 !== undefined && b.autoVolumeM3 !== null)
    ? (parseFloat(b.autoVolumeM3) || 0)
    : volM3;
  const isManualVolCurrent = !!(b.isManualVolume || t.isManualVolume);

  // Tarifa por defecto según el tramo de pedidos
  const defaultRate = activeRange.storage_m3 || 48900;
  const currentRate = t.storageRate || defaultRate;

  // Función auxiliar para obtener el descuento estándar según un volumen m³ dado
  const getDiscountForVol = (targetVol) => {
    let pct = 0;
    let label = "Sin descuento (< 10 m³)";
    if (cfg.storage_discounts && Array.isArray(cfg.storage_discounts)) {
      for (const d of cfg.storage_discounts) {
        if (targetVol >= d.min && targetVol <= d.max) {
          pct = d.discount_pct;
          label = `${d.discount_pct}% dcto por volumen (${d.min} - ${d.max === 999999 ? '+60' : d.max} m³)`;
          break;
        }
      }
    }
    return { pct, label };
  };

  const initialDefaultDiscount = getDiscountForVol(volM3);
  let defaultDiscountPct = initialDefaultDiscount.pct;
  let defaultDiscountLabel = initialDefaultDiscount.label;

  const currentDiscountPct = (t.storageDiscountPct !== undefined) ? t.storageDiscountPct : defaultDiscountPct;
  const currentDiscountLabel = t.storageDiscountLabel || defaultDiscountLabel;
  const isCustom = !!t.isStorageCustom;

  // Lista de rangos oficiales para sugerencias rápidas de tarifa
  const standardRanges = (cfg.order_ranges && Array.isArray(cfg.order_ranges))
    ? cfg.order_ranges
    : DEFAULT_PRICING_CONFIG.order_ranges;

  // Opciones de descuentos estándar
  const standardDiscounts = (cfg.storage_discounts && Array.isArray(cfg.storage_discounts))
    ? cfg.storage_discounts
    : DEFAULT_PRICING_CONFIG.storage_discounts;

  const result = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;"><i class="ri-archive-line" style="color: #5f06fa;"></i><span>Volumen y Tarifa de Almacenamiento</span></div>',
    width: '560px',
    html: `
      <div style="text-align: left; font-size: 0.88rem; line-height: 1.45; color: #334155;">
        <!-- Banner Informativo -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem 0.9rem; margin-bottom: 0.95rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; font-size: 0.78rem;">
            <span style="color: #64748b; font-weight: 600;">Comercio:</span>
            <strong style="color: #0f172a;">${escapeHtml(b.currentCommerce)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; font-size: 0.78rem;">
            <span style="color: #64748b; font-weight: 600;">Volumen Calculado BD (Automático):</span>
            <strong style="color: #0f172a;">${formatDec(autoVolM3, 2)} m³ <span style="color: #64748b; font-weight: 500;">(${b.autoVolumeDaysLogged || 0} días reg.)</span></strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; font-size: 0.78rem;">
            <span style="color: #64748b; font-weight: 600;">Tarifa Estándar del Tramo:</span>
            <span style="color: #0f172a; font-weight: 700;">${formatCLP(defaultRate)} / m³ <span style="color: #64748b; font-weight: 500;">(${escapeHtml(activeRange.label || `${activeRange.min || 0}-${activeRange.max || '∞'} ped`)})</span></span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
            <span style="color: #64748b; font-weight: 600;">Descuento Estándar por Volumen:</span>
            <span id="swal-storage-banner-default-discount" style="color: #0f172a; font-weight: 700;">${defaultDiscountPct}% <span style="color: #64748b; font-weight: 500;">(${escapeHtml(defaultDiscountLabel)})</span></span>
          </div>
        </div>

        <!-- 1. VOLUMEN MENSUAL DE ALMACENAMIENTO (m³) -->
        <div style="margin-bottom: 0.9rem; background: ${isManualVolCurrent ? 'rgba(95, 6, 250, 0.04)' : '#ffffff'}; border: 1.5px solid ${isManualVolCurrent ? 'rgba(95, 6, 250, 0.35)' : '#e2e8f0'}; border-radius: 8px; padding: 0.75rem 0.85rem;" id="swal-storage-vol-box">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem; gap: 6px; flex-wrap: wrap;">
            <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; display: flex; align-items: center; gap: 5px;">
              1. Volumen Mensual a Cobrar (m³):
              <span id="swal-storage-vol-mode-badge" style="background: ${isManualVolCurrent ? '#5f06fa' : '#e2e8f0'}; color: ${isManualVolCurrent ? '#ffffff' : '#475569'}; font-size: 0.65rem; font-weight: 800; padding: 1px 7px; border-radius: 999px;">
                ${isManualVolCurrent ? 'MANUAL FIJO' : 'AUTOMÁTICO BD'}
              </span>
            </label>
            <button type="button" id="swal-storage-btn-reset-vol" style="background: none; border: none; color: #5f06fa; font-size: 0.72rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0;">
              Usar automático BD (${formatDec(autoVolM3, 2)} m³)
            </button>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <div style="display: flex; gap: 4px; background: #f1f5f9; padding: 3px; border-radius: 7px;">
              <button type="button" id="swal-vol-mode-auto" style="border: none; border-radius: 5px; padding: 6px 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.15s; background: ${!isManualVolCurrent ? '#ffffff' : 'transparent'}; color: ${!isManualVolCurrent ? '#0f172a' : '#64748b'}; box-shadow: ${!isManualVolCurrent ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'};">
                Automático
              </button>
              <button type="button" id="swal-vol-mode-manual" style="border: none; border-radius: 5px; padding: 6px 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.15s; background: ${isManualVolCurrent ? '#5f06fa' : 'transparent'}; color: ${isManualVolCurrent ? '#ffffff' : '#64748b'}; box-shadow: ${isManualVolCurrent ? '0 1px 2px rgba(95,6,250,0.25)' : 'none'};">
                Manual Fijo
              </button>
            </div>
            <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
              <input type="number" id="swal-storage-vol-input" class="swal2-input" style="flex: 1; height: 38px; margin: 0; font-size: 0.95rem; font-weight: 800; color: #0f172a; text-align: right;" min="0" step="0.01" value="${volM3}">
              <span style="font-weight: 800; font-size: 0.88rem; color: #475569;">m³</span>
            </div>
          </div>
          <div style="font-size: 0.71rem; color: #64748b; margin-top: 0.45rem; line-height: 1.35;">
            <i class="ri-information-line" style="color: #5f06fa;"></i>
            Si fijas un <strong>volumen manual</strong>, el gráfico mostrará una línea constante en este valor durante el periodo. <strong>El cliente verá el formato estándar (sin aviso de cálculo manual)</strong>; solo el Admin verá la etiqueta <em>Manual</em>.
          </div>
        </div>

        <!-- 2. TARIFA BASE ($ / m³) -->
        <div style="margin-bottom: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">
              2. Tarifa de Almacenamiento ($ CLP / m³):
            </label>
            <button type="button" id="swal-storage-btn-reset-rate" style="background: none; border: none; color: #5f06fa; font-size: 0.72rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0;">
              Usar estándar (${formatCLP(defaultRate)})
            </button>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <input type="number" id="swal-storage-rate" class="swal2-input" style="flex: 1; height: 38px; margin: 0; font-size: 0.9rem; font-weight: 700; color: #0f172a;" value="${currentRate}">
            <select id="swal-storage-rate-presets" class="swal2-select" style="width: 140px; height: 38px; margin: 0; font-size: 0.78rem;" title="Seleccionar una tarifa estándar de la lista">
              <option value="">Tarifas Stocka...</option>
              ${standardRanges.map(r => `
                <option value="${r.storage_m3}" ${r.storage_m3 === currentRate ? 'selected' : ''}>
                  ${formatCLP(r.storage_m3)} (${r.min}-${r.max >= 999999 ? '+2.5k' : r.max})
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- 3. DESCUENTO POR VOLUMEN (%) -->
        <div style="margin-bottom: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
            <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">
              3. Descuento Comercial / Volumen:
            </label>
            <button type="button" id="swal-storage-btn-reset-discount" style="background: none; border: none; color: #5f06fa; font-size: 0.72rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0;">
              Usar regla estándar (<span id="swal-storage-reset-discount-pct">${defaultDiscountPct}</span>%)
            </button>
          </div>
          <select id="swal-storage-discount-mode" class="swal2-select" style="width: 100%; height: 38px; margin: 0 0 0.5rem 0; font-size: 0.85rem; font-weight: 600;">
            <option value="default" id="swal-storage-discount-opt-default" ${currentDiscountPct === defaultDiscountPct ? 'selected' : ''}>
              ⭐ Automático del sistema (${defaultDiscountPct}% - ${defaultDiscountLabel})
            </option>
            <option value="0" ${currentDiscountPct === 0 && defaultDiscountPct !== 0 ? 'selected' : ''}>
              0% - Sin descuento
            </option>
            ${standardDiscounts.map(d => `
              <option value="${d.discount_pct}" ${d.discount_pct === currentDiscountPct && currentDiscountPct !== defaultDiscountPct ? 'selected' : ''}>
                ${d.discount_pct}% - ${escapeHtml(d.label || `${d.min}-${d.max} m³`)}
              </option>
            `).join('')}
            <option value="custom" ${![0, defaultDiscountPct, ...standardDiscounts.map(d => d.discount_pct)].includes(currentDiscountPct) ? 'selected' : ''}>
              ✏️ Ingresar otro porcentaje manual...
            </option>
          </select>

          <div id="swal-storage-custom-discount-container" style="display: ${![0, defaultDiscountPct, ...standardDiscounts.map(d => d.discount_pct)].includes(currentDiscountPct) ? 'block' : 'none'}; margin-bottom: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <input type="number" id="swal-storage-custom-discount-pct" class="swal2-input" style="flex: 1; height: 38px; margin: 0; font-size: 0.85rem;" min="0" max="100" step="0.5" placeholder="Ej: 20" value="${currentDiscountPct}">
              <span style="font-weight: 700; font-size: 0.9rem; color: #475569;">%</span>
            </div>
          </div>
        </div>

        <!-- 4. DESCRIPCIÓN / NOTA DEL DESCUENTO -->
        <div style="margin-bottom: 0.95rem;">
          <label style="font-size: 0.75rem; font-weight: 800; color: #475569; display: block; margin-bottom: 0.25rem; text-transform: uppercase;">
            4. Glosa / Detalle que aparecerá en el desglose:
          </label>
          <input type="text" id="swal-storage-discount-label" class="swal2-input" style="width: 100%; height: 36px; margin: 0; font-size: 0.82rem;" value="${escapeHtml(currentDiscountLabel)}">
        </div>

        <!-- 5. CUADRO REACTIVO DE CÁLCULO EN VIVO -->
        <div id="swal-storage-live-preview" style="background: linear-gradient(135deg, rgba(95, 6, 250, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%); border: 1.5px solid rgba(95, 6, 250, 0.25); border-radius: 8px; padding: 0.75rem 0.9rem;">
          <div style="font-size: 0.72rem; font-weight: 800; color: #5f06fa; text-transform: uppercase; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 4px;">
            <i class="ri-calculator-line"></i> Cálculo en Tiempo Real:
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 2px;">
            <span style="color: #64748b;">Subtotal Bruto (<strong id="prev-vol" style="color: #0f172a;">${formatDec(volM3, 2)}</strong> m³ × <span id="prev-rate">$0</span>):</span>
            <strong id="prev-gross" style="color: #0f172a;">$0</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 4px;">
            <span style="color: #dc2626;">(-) Descuento Aplicado (<span id="prev-pct">0%</span>):</span>
            <strong id="prev-discount" style="color: #dc2626;">-$0</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem; border-top: 1px solid rgba(95,6,250,0.2); padding-top: 4px; margin-top: 4px;">
            <span style="color: #0f172a; font-weight: 800;">Total Neto Almacenamiento:</span>
            <strong id="prev-net" style="color: #5f06fa; font-size: 1rem; font-weight: 900;">$0</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #64748b; margin-top: 2px;">
            <span>+ IVA (19%): <span id="prev-iva">$0</span></span>
            <span>Total con IVA: <strong id="prev-total" style="color: #0f172a;">$0</strong></span>
          </div>
          <div id="prev-fixed-fee-hint" style="font-size: 0.72rem; margin-top: 6px; padding-top: 5px; border-top: 1px dashed rgba(95,6,250,0.2); color: #475569;"></div>
        </div>
      </div>
    `,
    didOpen: () => {
      let isManualMode = isManualVolCurrent;

      const volBox = document.getElementById('swal-storage-vol-box');
      const volModeBadge = document.getElementById('swal-storage-vol-mode-badge');
      const btnModeAuto = document.getElementById('swal-vol-mode-auto');
      const btnModeManual = document.getElementById('swal-vol-mode-manual');
      const btnResetVol = document.getElementById('swal-storage-btn-reset-vol');
      const volInput = document.getElementById('swal-storage-vol-input');

      const rateInput = document.getElementById('swal-storage-rate');
      const ratePresets = document.getElementById('swal-storage-rate-presets');
      const discountSelect = document.getElementById('swal-storage-discount-mode');
      const optDefaultDiscount = document.getElementById('swal-storage-discount-opt-default');
      const resetDiscountPctSpan = document.getElementById('swal-storage-reset-discount-pct');
      const bannerDefaultDiscount = document.getElementById('swal-storage-banner-default-discount');
      const customDiscountContainer = document.getElementById('swal-storage-custom-discount-container');
      const customDiscountInput = document.getElementById('swal-storage-custom-discount-pct');
      const labelInput = document.getElementById('swal-storage-discount-label');

      const prevVol = document.getElementById('prev-vol');
      const prevRate = document.getElementById('prev-rate');
      const prevGross = document.getElementById('prev-gross');
      const prevPct = document.getElementById('prev-pct');
      const prevDiscount = document.getElementById('prev-discount');
      const prevNet = document.getElementById('prev-net');
      const prevIva = document.getElementById('prev-iva');
      const prevTotal = document.getElementById('prev-total');
      const prevFixedFeeHint = document.getElementById('prev-fixed-fee-hint');

      const setVolModeUI = (manual) => {
        isManualMode = !!manual;
        if (volBox) {
          volBox.style.background = isManualMode ? 'rgba(95, 6, 250, 0.04)' : '#ffffff';
          volBox.style.borderColor = isManualMode ? 'rgba(95, 6, 250, 0.35)' : '#e2e8f0';
          volBox.dataset.manualMode = isManualMode ? '1' : '0';
        }
        if (volModeBadge) {
          volModeBadge.textContent = isManualMode ? 'MANUAL FIJO' : 'AUTOMÁTICO BD';
          volModeBadge.style.background = isManualMode ? '#5f06fa' : '#e2e8f0';
          volModeBadge.style.color = isManualMode ? '#ffffff' : '#475569';
        }
        if (btnModeAuto) {
          btnModeAuto.style.background = !isManualMode ? '#ffffff' : 'transparent';
          btnModeAuto.style.color = !isManualMode ? '#0f172a' : '#64748b';
          btnModeAuto.style.boxShadow = !isManualMode ? '0 1px 2px rgba(0,0,0,0.08)' : 'none';
        }
        if (btnModeManual) {
          btnModeManual.style.background = isManualMode ? '#5f06fa' : 'transparent';
          btnModeManual.style.color = isManualMode ? '#ffffff' : '#64748b';
          btnModeManual.style.boxShadow = isManualMode ? '0 1px 2px rgba(95,6,250,0.25)' : 'none';
        }
      };

      setVolModeUI(isManualVolCurrent);

      const updateCalculation = (updateDefaultLabelIfAuto = false) => {
        const activeVol = Math.max(0, parseFloat(volInput?.value) || 0);
        const dynamicDefault = getDiscountForVol(activeVol);
        defaultDiscountPct = dynamicDefault.pct;
        defaultDiscountLabel = dynamicDefault.label;

        if (optDefaultDiscount) {
          optDefaultDiscount.textContent = `⭐ Automático del sistema (${defaultDiscountPct}% - ${defaultDiscountLabel})`;
        }
        if (resetDiscountPctSpan) {
          resetDiscountPctSpan.textContent = String(defaultDiscountPct);
        }
        if (bannerDefaultDiscount) {
          bannerDefaultDiscount.innerHTML = `${defaultDiscountPct}% <span style="color: #64748b; font-weight: 500;">(${escapeHtml(defaultDiscountLabel)})</span>`;
        }

        const rate = parseInt(rateInput?.value, 10) || 0;
        let pct = 0;
        const mode = discountSelect?.value;

        if (mode === 'default') {
          pct = defaultDiscountPct;
          if (updateDefaultLabelIfAuto && labelInput) {
            labelInput.value = defaultDiscountLabel;
          }
        } else if (mode === 'custom') {
          pct = parseFloat(customDiscountInput?.value) || 0;
        } else {
          pct = parseFloat(mode) || 0;
        }

        const gross = Math.round(activeVol * rate);
        const discountAmount = Math.round(gross * (pct / 100));
        const net = Math.max(0, gross - discountAmount);
        const iva = Math.round(net * 0.19);
        const total = net + iva;

        if (prevVol) prevVol.textContent = formatDec(activeVol, 2);
        if (prevRate) prevRate.textContent = formatCLP(rate);
        if (prevGross) prevGross.textContent = formatCLP(gross);
        if (prevPct) prevPct.textContent = `${pct}%`;
        if (prevDiscount) prevDiscount.textContent = `-${formatCLP(discountAmount)}`;
        if (prevNet) prevNet.textContent = formatCLP(net);
        if (prevIva) prevIva.textContent = formatCLP(iva);
        if (prevTotal) prevTotal.textContent = formatCLP(total);

        if (prevFixedFeeHint) {
          const billableOrdersCount = (b.orders || []).filter(o => !o.isExcluded).length;
          const fFee = cfg.fixed_service_fee || {};
          const minOrdEx = fFee.exemption_min_orders ?? 75;
          const minVolEx = fFee.exemption_min_volume ?? 1.5;
          const t1MaxOrd = fFee.tier1_max_orders ?? 50;
          const t1MaxVol = fFee.tier1_max_volume ?? 1.0;
          const t1Uf = fFee.tier1_fee_uf ?? 1.5;
          const t2MaxOrd = fFee.tier2_max_orders ?? minOrdEx;
          const t2MaxVol = fFee.tier2_max_volume ?? minVolEx;
          const t2Uf = fFee.tier2_fee_uf ?? 0.9;
          if (billableOrdersCount >= minOrdEx || activeVol >= minVolEx) {
            prevFixedFeeHint.innerHTML = `<i class="ri-shield-check-line" style="color: #10b981;"></i> <strong>Costo Variable Mensual:</strong> <span style="color: #10b981; font-weight: 700;">EXENTO ($0)</span> (${activeVol >= minVolEx ? `volumen ≥ ${minVolEx} m³` : `≥ ${minOrdEx} pedidos`})`;
          } else if (activeVol < t1MaxVol && billableOrdersCount < t1MaxOrd) {
            prevFixedFeeHint.innerHTML = `<i class="ri-information-line" style="color: #ef4444;"></i> <strong>Costo Variable Mensual:</strong> <span style="color: #ef4444; font-weight: 700;">${t1Uf} UF</span> (&lt; ${t1MaxOrd} pedidos y &lt; ${t1MaxVol} m³)`;
          } else {
            prevFixedFeeHint.innerHTML = `<i class="ri-information-line" style="color: #f59e0b;"></i> <strong>Costo Variable Mensual:</strong> <span style="color: #d97706; font-weight: 700;">${t2Uf} UF</span> (&lt; ${t2MaxOrd} pedidos y &lt; ${t2MaxVol} m³)`;
          }
        }
      };

      btnModeAuto?.addEventListener('click', () => {
        setVolModeUI(false);
        if (volInput) volInput.value = autoVolM3;
        updateCalculation(true);
      });

      btnModeManual?.addEventListener('click', () => {
        setVolModeUI(true);
        volInput?.focus();
        volInput?.select();
        updateCalculation(true);
      });

      btnResetVol?.addEventListener('click', () => {
        setVolModeUI(false);
        if (volInput) volInput.value = autoVolM3;
        updateCalculation(true);
      });

      volInput?.addEventListener('input', () => {
        setVolModeUI(true);
        updateCalculation(true);
      });

      ratePresets?.addEventListener('change', () => {
        if (ratePresets.value && rateInput) {
          rateInput.value = ratePresets.value;
          updateCalculation();
        }
      });

      rateInput?.addEventListener('input', () => {
        if (ratePresets) ratePresets.value = '';
        updateCalculation();
      });

      discountSelect?.addEventListener('change', () => {
        const mode = discountSelect.value;
        if (mode === 'custom') {
          if (customDiscountContainer) customDiscountContainer.style.display = 'block';
        } else {
          if (customDiscountContainer) customDiscountContainer.style.display = 'none';
        }

        if (mode === 'default') {
          if (labelInput) labelInput.value = defaultDiscountLabel;
        } else if (mode === '0') {
          if (labelInput) labelInput.value = 'Sin descuento (< 10 m³)';
        } else if (mode === 'custom') {
          const cPct = parseFloat(customDiscountInput?.value) || 0;
          if (labelInput) labelInput.value = `${cPct}% dcto comercial pactado`;
        } else {
          const match = standardDiscounts.find(d => String(d.discount_pct) === mode);
          if (labelInput) labelInput.value = match ? `${match.discount_pct}% dcto por volumen (${match.label || `${match.min}-${match.max} m³`})` : `${mode}% dcto por volumen`;
        }

        updateCalculation();
      });

      customDiscountInput?.addEventListener('input', () => {
        const cPct = parseFloat(customDiscountInput?.value) || 0;
        if (labelInput) labelInput.value = `${cPct}% dcto comercial pactado`;
        updateCalculation();
      });

      document.getElementById('swal-storage-btn-reset-rate')?.addEventListener('click', () => {
        if (rateInput) rateInput.value = defaultRate;
        if (ratePresets) ratePresets.value = String(defaultRate);
        updateCalculation();
      });

      document.getElementById('swal-storage-btn-reset-discount')?.addEventListener('click', () => {
        if (discountSelect) discountSelect.value = 'default';
        if (customDiscountContainer) customDiscountContainer.style.display = 'none';
        if (labelInput) labelInput.value = defaultDiscountLabel;
        updateCalculation();
      });

      updateCalculation();
    },
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Aplicar Almacenamiento',
    denyButtonText: '<i class="ri-restart-line"></i> Restablecer Automático',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    denyButtonColor: '#64748b',
    cancelButtonColor: '#94a3b8',
    preConfirm: () => {
      const volBox = document.getElementById('swal-storage-vol-box');
      const volInput = document.getElementById('swal-storage-vol-input');
      const rateInput = document.getElementById('swal-storage-rate');
      const discountSelect = document.getElementById('swal-storage-discount-mode');
      const customDiscountInput = document.getElementById('swal-storage-custom-discount-pct');
      const labelInput = document.getElementById('swal-storage-discount-label');

      const isManualVolume = volBox?.dataset?.manualMode === '1';
      const rawVol = Math.max(0, parseFloat(volInput?.value) || 0);
      const volumeM3 = isManualVolume ? Number(rawVol.toFixed(2)) : autoVolM3;

      const dynamicDefault = getDiscountForVol(volumeM3);
      const rate = parseInt(rateInput?.value, 10) || defaultRate;
      let pct = 0;
      const mode = discountSelect?.value;
      if (mode === 'default') {
        pct = dynamicDefault.pct;
      } else if (mode === 'custom') {
        pct = parseFloat(customDiscountInput?.value) || 0;
      } else {
        pct = parseFloat(mode) || 0;
      }

      const label = labelInput?.value?.trim() || (pct > 0 ? `${pct}% dcto por volumen` : 'Sin descuento');
      const isCustom = (rate !== defaultRate || pct !== dynamicDefault.pct);

      return { volumeM3, isManualVolume, rate, discountPct: pct, discountLabel: label, isCustom };
    }
  });

  let chosenValues = null;
  if (result.isDenied) {
    const autoDefault = getDiscountForVol(autoVolM3);
    chosenValues = {
      volumeM3: autoVolM3,
      isManualVolume: false,
      rate: defaultRate,
      discountPct: autoDefault.pct,
      discountLabel: autoDefault.label,
      isCustom: false
    };
  } else if (result.isConfirmed && result.value) {
    chosenValues = result.value;
  }

  if (chosenValues) {
    const newVolM3 = chosenValues.volumeM3;
    const isManualVolume = !!chosenValues.isManualVolume;
    const rate = chosenValues.rate;
    const discountPct = chosenValues.discountPct;
    const discountLabel = chosenValues.discountLabel;
    const isCustom = chosenValues.isCustom;

    b.volumeM3 = newVolM3;
    b.isManualVolume = isManualVolume;
    b.volumeSessionKey = `${b.currentPeriodId || ''}_${b.currentCommerce || ''}`;

    const periodYear = b.currentPeriodYear || new Date().getFullYear();
    const periodMonth = b.currentPeriodMonth || (new Date().getMonth() + 1);

    if (isManualVolume) {
      const constLogs = generateConstantDailyStorageLogs(periodYear, periodMonth, newVolM3);
      b.dailyStorageLogs = constLogs;
      b.volumeDaysLogged = constLogs.length;
      b.volumeStats = {
        averageM3: newVolM3,
        minDailyVolume: newVolM3,
        maxDailyVolume: newVolM3,
        daysLogged: constLogs.length,
        isManualVolume: true,
        autoVolumeM3: autoVolM3
      };
    } else {
      const restoredLogs = Array.isArray(b.autoDailyStorageLogs) && b.autoDailyStorageLogs.length > 0
        ? JSON.parse(JSON.stringify(b.autoDailyStorageLogs))
        : [];
      b.dailyStorageLogs = restoredLogs;
      b.volumeDaysLogged = b.autoVolumeDaysLogged || restoredLogs.length || 0;
      let minAuto = restoredLogs.length > 0 ? Infinity : 0;
      let maxAuto = 0;
      for (const l of restoredLogs) {
        const v = parseFloat(l.volume) || 0;
        if (v < minAuto) minAuto = v;
        if (v > maxAuto) maxAuto = v;
      }
      if (minAuto === Infinity) minAuto = 0;
      b.volumeStats = {
        averageM3: newVolM3,
        minDailyVolume: Number(minAuto.toFixed(2)),
        maxDailyVolume: Number(maxAuto.toFixed(2)),
        daysLogged: b.volumeDaysLogged,
        isManualVolume: false,
        autoVolumeM3: autoVolM3
      };
    }

    const gross = Math.round(newVolM3 * rate);
    const discountAmount = Math.round(gross * (discountPct / 100));
    const net = Math.max(0, gross - discountAmount);

    b.totals.storageRate = rate;
    b.totals.defaultStorageRate = defaultRate;
    b.totals.storageDiscountPct = discountPct;
    b.totals.storageDiscountLabel = discountLabel;
    b.totals.storageGross = gross;
    b.totals.storageDiscountAmount = discountAmount;
    b.totals.storageNet = net;
    b.totals.isStorageCustom = isCustom;
    b.totals.isManualVolume = isManualVolume;

    b.isSaved = false;

    // Recalcular todos los totales consolidados (incluyendo Costo Variable Mensual por cambio de m³) y refrescar vistas
    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: (isManualVolume || isCustom)
        ? `Almacenamiento actualizado (${formatDec(newVolM3, 2)} m³${isManualVolume ? ' manual' : ''})`
        : 'Almacenamiento restablecido a cálculo automático',
      showConfirmButton: false,
      timer: 2500
    });
  }
};

// Modal de Configuración y Edición de Tipos de Entrega y Tarifas
window.openDeliveryTypesManagerModal = async function() {
  if (guardBillingLocked()) return;
  const currentConfig = billingState.pricingConfig || DEFAULT_PRICING_CONFIG;
  const deliveryTypes = JSON.parse(JSON.stringify(getDeliveryTypes(currentConfig)));

  const renderModalRowsHTML = (types) => {
    return types.map((dt, idx) => `
      <tr class="swal-dt-row" data-index="${idx}" data-key="${escapeHtml(dt.key)}" data-is-base="${dt.is_base ? '1' : '0'}" style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 6px 8px;">
          <input type="text" class="swal2-input dt-name-input" value="${escapeHtml(dt.name)}" style="margin: 0; height: 36px; font-size: 0.85rem; font-weight: 700; width: 100%; border-radius: 6px;" placeholder="Nombre de entrega">
        </td>
        <td style="padding: 6px 8px; text-align: center;">
          <span style="font-family: monospace; font-size: 0.75rem; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 6px; border-radius: 4px; display: inline-block;">
            ${escapeHtml(dt.key)}
          </span>
        </td>
        <td style="padding: 6px 8px; text-align: right;">
          <div style="position: relative; display: inline-block; width: 100%;">
            <input type="number" class="swal2-input dt-price-input" value="${dt.price}" min="0" step="50" style="margin: 0; height: 36px; font-size: 0.85rem; font-weight: 700; width: 100%; text-align: right; color: #5f06fa; border-radius: 6px;" placeholder="0">
          </div>
        </td>
        <td style="padding: 6px 8px; text-align: center;">
          <select class="swal2-select dt-billable-select" style="margin: 0; height: 36px; font-size: 0.8rem; font-weight: 600; width: 100%; border-radius: 6px;">
            <option value="1" ${dt.is_billable !== false ? 'selected' : ''}>Sí (Flete)</option>
            <option value="0" ${dt.is_billable === false ? 'selected' : ''}>No ($0)</option>
          </select>
        </td>
        <td style="padding: 6px 8px; text-align: center;">
          ${dt.is_base ? `
            <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; display: inline-flex; align-items: center; gap: 2px;" title="Tipo base protegido del sistema">
              <i class="ri-lock-line"></i> Base
            </span>
          ` : `
            <button type="button" class="btn-delete-dt" onclick="window.removeDeliveryTypeRow(this)" title="Eliminar este tipo de entrega" style="background: #fee2e2; border: 1px solid #fecaca; color: #dc2626; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
              <i class="ri-delete-bin-line"></i>
            </button>
          `}
        </td>
      </tr>
    `).join('');
  };

  window.removeDeliveryTypeRow = function(btn) {
    const row = btn.closest('tr');
    if (row) row.remove();
  };

  const modalHtml = `
    <div style="text-align: left; max-height: 70vh; overflow-y: auto; padding-right: 4px;">
      <p style="font-size: 0.8rem; color: #64748b; margin-top: 0; margin-bottom: 1rem;">
        Personaliza los nombres y las tarifas netas ($ CLP) de cada tipo de entrega, o define nuevos tipos según los acuerdos logísticos de tu operación.
      </p>

      <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 1.25rem;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left; color: #475569; font-weight: 700; font-size: 0.75rem;">
              <th style="padding: 8px 10px;">Nombre / Etiqueta</th>
              <th style="padding: 8px 10px; width: 140px; text-align: center;">Clave / Código</th>
              <th style="padding: 8px 10px; width: 110px; text-align: right;">Tarifa ($ CLP)</th>
              <th style="padding: 8px 10px; width: 105px; text-align: center;">Facturable</th>
              <th style="padding: 8px 10px; width: 65px; text-align: center;">Acción</th>
            </tr>
          </thead>
          <tbody id="swal-dt-tbody">
            ${renderModalRowsHTML(deliveryTypes)}
          </tbody>
        </table>
      </div>

      <!-- Formulario para agregar nuevo tipo de entrega -->
      <div style="background: rgba(95, 6, 250, 0.04); border: 1px dashed rgba(95, 6, 250, 0.35); border-radius: 8px; padding: 0.85rem 1rem;">
        <div style="font-weight: 800; font-size: 0.825rem; color: #5f06fa; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 4px;">
          <i class="ri-add-circle-line" style="font-size: 1rem;"></i> Agregar Nuevo Tipo de Entrega
        </div>
        <div style="display: grid; grid-template-columns: 1.8fr 1.2fr 1fr 1fr auto; gap: 6px; align-items: flex-end;">
          <div>
            <label style="font-size: 0.7rem; font-weight: 700; color: #64748b; display: block; margin-bottom: 2px;">Nombre:</label>
            <input type="text" id="swal-new-dt-name" class="swal2-input" placeholder="Ej: Chilexpress Express" style="margin: 0; height: 34px; font-size: 0.8rem; width: 100%; border-radius: 6px;">
          </div>
          <div>
            <label style="font-size: 0.7rem; font-weight: 700; color: #64748b; display: block; margin-bottom: 2px;">Clave / Código:</label>
            <input type="text" id="swal-new-dt-key" class="swal2-input" placeholder="CHILEXPRESS" style="margin: 0; height: 34px; font-size: 0.8rem; width: 100%; border-radius: 6px; font-family: monospace; text-transform: uppercase;">
          </div>
          <div>
            <label style="font-size: 0.7rem; font-weight: 700; color: #64748b; display: block; margin-bottom: 2px;">Tarifa ($):</label>
            <input type="number" id="swal-new-dt-price" class="swal2-input" placeholder="0" value="0" min="0" step="50" style="margin: 0; height: 34px; font-size: 0.8rem; width: 100%; text-align: right; border-radius: 6px;">
          </div>
          <div>
            <label style="font-size: 0.7rem; font-weight: 700; color: #64748b; display: block; margin-bottom: 2px;">Facturable:</label>
            <select id="swal-new-dt-billable" class="swal2-select" style="margin: 0; height: 34px; font-size: 0.78rem; width: 100%; border-radius: 6px;">
              <option value="1">Sí (Flete)</option>
              <option value="0">No ($0)</option>
            </select>
          </div>
          <div>
            <button type="button" id="swal-btn-add-dt" class="btn btn-primary" style="height: 34px; background: #5f06fa; border-color: #5f06fa; font-size: 0.78rem; font-weight: 700; border-radius: 6px; padding: 0 10px; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;">
              <i class="ri-add-line"></i> Añadir
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const { value: updatedTypes } = await Swal.fire({
    title: '<div style="display: flex; align-items: center; gap: 8px; color: #5f06fa; font-size: 1.2rem; font-weight: 800;"><i class="ri-settings-4-line"></i> Configuración de Tipos de Entrega</div>',
    html: modalHtml,
    width: '840px',
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-save-3-line"></i> Guardar Configuración',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    cancelButtonColor: '#94a3b8',
    didOpen: () => {
      const nameInput = document.getElementById('swal-new-dt-name');
      const keyInput = document.getElementById('swal-new-dt-key');
      const priceInput = document.getElementById('swal-new-dt-price');
      const billableSelect = document.getElementById('swal-new-dt-billable');
      const addBtn = document.getElementById('swal-btn-add-dt');
      const tbody = document.getElementById('swal-dt-tbody');

      let userEditedKey = false;
      keyInput?.addEventListener('input', () => { userEditedKey = true; });

      nameInput?.addEventListener('input', (e) => {
        if (!userEditedKey) {
          const autoKey = e.target.value.trim().toUpperCase()
            .replace(/[ÁÀÄÂ]/g, 'A')
            .replace(/[ÉÈËÊ]/g, 'E')
            .replace(/[ÍÌÏÎ]/g, 'I')
            .replace(/[ÓÒÖÔ]/g, 'O')
            .replace(/[ÚÙÜÛ]/g, 'U')
            .replace(/Ñ/g, 'N')
            .replace(/[^A-Z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
          keyInput.value = autoKey;
        }
      });

      addBtn?.addEventListener('click', () => {
        const name = nameInput.value.trim();
        let key = keyInput.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const price = Math.max(0, parseInt(priceInput.value, 10) || 0);
        const isBillable = billableSelect.value === '1';

        if (!name) {
          Swal.showValidationMessage('Ingresa un nombre para el nuevo tipo de entrega.');
          return;
        }
        if (!key) {
          key = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        }

        // Verificar unicidad de clave
        const existingKeys = Array.from(tbody.querySelectorAll('tr.swal-dt-row')).map(r => r.getAttribute('data-key'));
        if (existingKeys.includes(key)) {
          Swal.showValidationMessage(`La clave "${key}" ya existe en la lista.`);
          return;
        }

        // Crear fila nueva
        const tr = document.createElement('tr');
        tr.className = 'swal-dt-row';
        tr.setAttribute('data-key', key);
        tr.setAttribute('data-is-base', '0');
        tr.style.borderBottom = '1px solid #f1f5f9';
        tr.innerHTML = `
          <td style="padding: 6px 8px;">
            <input type="text" class="swal2-input dt-name-input" value="${escapeHtml(name)}" style="margin: 0; height: 36px; font-size: 0.85rem; font-weight: 700; width: 100%; border-radius: 6px;">
          </td>
          <td style="padding: 6px 8px; text-align: center;">
            <span style="font-family: monospace; font-size: 0.75rem; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 6px; border-radius: 4px; display: inline-block;">
              ${escapeHtml(key)}
            </span>
          </td>
          <td style="padding: 6px 8px; text-align: right;">
            <input type="number" class="swal2-input dt-price-input" value="${price}" min="0" step="50" style="margin: 0; height: 36px; font-size: 0.85rem; font-weight: 700; width: 100%; text-align: right; color: #5f06fa; border-radius: 6px;">
          </td>
          <td style="padding: 6px 8px; text-align: center;">
            <select class="swal2-select dt-billable-select" style="margin: 0; height: 36px; font-size: 0.8rem; font-weight: 600; width: 100%; border-radius: 6px;">
              <option value="1" ${isBillable ? 'selected' : ''}>Sí (Flete)</option>
              <option value="0" ${!isBillable ? 'selected' : ''}>No ($0)</option>
            </select>
          </td>
          <td style="padding: 6px 8px; text-align: center;">
            <button type="button" class="btn-delete-dt" onclick="window.removeDeliveryTypeRow(this)" title="Eliminar este tipo de entrega" style="background: #fee2e2; border: 1px solid #fecaca; color: #dc2626; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 0.85rem;">
              <i class="ri-delete-bin-line"></i>
            </button>
          </td>
        `;
        tbody.appendChild(tr);

        // Limpiar inputs
        nameInput.value = '';
        keyInput.value = '';
        priceInput.value = '0';
        billableSelect.value = '1';
        userEditedKey = false;
        Swal.resetValidationMessage();
      });
    },
    preConfirm: () => {
      const tbody = document.getElementById('swal-dt-tbody');
      const rows = Array.from(tbody.querySelectorAll('tr.swal-dt-row'));

      // Si el usuario escribió en el formulario de nuevo tipo y no pulsó 'Añadir', agregarlo si tiene nombre
      const pendingName = document.getElementById('swal-new-dt-name')?.value.trim();
      let pendingKey = document.getElementById('swal-new-dt-key')?.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const pendingPrice = Math.max(0, parseInt(document.getElementById('swal-new-dt-price')?.value, 10) || 0);
      const pendingBillable = document.getElementById('swal-new-dt-billable')?.value === '1';

      if (pendingName) {
        if (!pendingKey) pendingKey = pendingName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const existingKeys = rows.map(r => r.getAttribute('data-key'));
        if (!existingKeys.includes(pendingKey)) {
          rows.push({
            getAttribute: (attr) => attr === 'data-key' ? pendingKey : (attr === 'data-is-base' ? '0' : null),
            querySelector: (sel) => {
              if (sel === '.dt-name-input') return { value: pendingName };
              if (sel === '.dt-price-input') return { value: pendingPrice };
              if (sel === '.dt-billable-select') return { value: pendingBillable ? '1' : '0' };
              return null;
            }
          });
        }
      }

      if (rows.length === 0) {
        Swal.showValidationMessage('Debe existir al menos un tipo de entrega.');
        return false;
      }

      const results = [];
      const seenKeys = new Set();

      for (const r of rows) {
        const key = r.getAttribute('data-key');
        const name = r.querySelector('.dt-name-input')?.value?.trim();
        const priceVal = r.querySelector('.dt-price-input')?.value;
        const price = Math.max(0, parseInt(priceVal, 10) || 0);
        const isBillable = r.querySelector('.dt-billable-select')?.value === '1';
        const isBase = r.getAttribute('data-is-base') === '1';

        if (!name) {
          Swal.showValidationMessage(`El tipo con clave "${key}" tiene el nombre vacío.`);
          return false;
        }

        if (seenKeys.has(key)) {
          Swal.showValidationMessage(`Clave duplicada encontrada: "${key}".`);
          return false;
        }
        seenKeys.add(key);

        results.push({
          key,
          name,
          price,
          is_billable: isBillable,
          is_base: isBase
        });
      }

      return results;
    }
  });

  if (!updatedTypes || updatedTypes.length === 0) return;

  // Actualizar y guardar en pricing_config
  const updatedConfig = {
    ...(billingState.pricingConfig || DEFAULT_PRICING_CONFIG),
    delivery_types: updatedTypes
  };

  try {
    await savePricingConfig(updatedConfig, supabase);
    billingState.pricingConfig = updatedConfig;

    // Actualizar tarifas de los pedidos en memoria
    const typeMap = {};
    updatedTypes.forEach(dt => { typeMap[dt.key] = dt; });

    (billingState.orders || []).forEach(ord => {
      const matched = typeMap[ord.deliveryType];
      if (matched) {
        ord.shippingFreight = matched.price;
      } else {
        // Tipo eliminado: reasignar a RETIRO
        ord.deliveryType = 'RETIRO';
        ord.shippingFreight = 0;
      }
      ord.orderTotal = ord.pickPackTotal + ord.shippingFreight;
    });

    // Recalcular y actualizar UI completa
    recalculateFromCurrentState();
    renderOrdersTableUI(billingState.orders);

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Tipos de entrega actualizados',
      text: 'Tarifas guardadas y pedidos actualizados con éxito.',
      showConfirmButton: false,
      timer: 3000
    });
  } catch (err) {
    console.error('Error al guardar configuración de tipos de entrega:', err);
    Swal.fire('Error', 'No se pudo guardar la configuración en la base de datos: ' + err.message, 'error');
  }
};

// Modal de Edición de Fechas de Emisión, Plazo de Pago y Datos Legales del Comercio
export function openEditDesgloseHeaderModal() {
  if (guardBillingLocked()) return;
  const b = billingState;
  const c = b.commerceInfo || {};
  const d = b.invoiceDates || {};

  const now = new Date();
  const toISODate = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  
  const currentEmision = d.emisionDate || toISODate(now);
  let currentDue = d.dueDate;
  if (!currentDue) {
    const dueObj = new Date(now);
    dueObj.setDate(dueObj.getDate() + 5);
    currentDue = toISODate(dueObj);
  }
  const currentTerm = d.termLabel || '5 días corridos';
  const currentRazon = c.razonSocial || c.comercio || '';
  const currentRut = (c.rut && c.rut !== '—') ? c.rut : '';
  const currentSigla = (c.sigla && c.sigla !== '—') ? c.sigla : '';

  Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;"><i class="ri-calendar-event-line" style="color: #5f06fa;"></i><span>Editar Fechas y Datos Legales</span></div>',
    width: 600,
    html: `
      <div style="text-align: left; font-size: 0.9rem; color: #334155;">
        <p style="font-size: 0.825rem; color: #64748b; margin-top: 0; margin-bottom: 1.25rem;">
          Personaliza la <strong>Fecha de Emisión</strong>, <strong>Fecha Límite de Pago</strong> y la información legal para el desglose oficial de <strong>${escapeHtml(b.currentCommerce || 'Comercio')}</strong>.
        </p>

        <!-- Sección 1: Fechas -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem;">
          <div style="font-weight: 700; font-size: 0.825rem; color: #5f06fa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-calendar-check-line"></i> Fechas de Facturación
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-bottom: 0.75rem;">
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.25rem;">FECHA DE EMISIÓN</label>
              <input type="date" id="swal-inp-emision" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; border-radius: 6px;" value="${currentEmision}">
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.25rem;">FECHA LÍMITE DE PAGO</label>
              <input type="date" id="swal-inp-due" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; border-radius: 6px;" value="${currentDue}">
            </div>
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
              <label style="font-size: 0.75rem; font-weight: 700; color: #475569;">TEXTO DEL PLAZO (RÓTULO)</label>
              <div style="display: flex; gap: 4px;">
                <button type="button" id="btn-quick-5d" style="background: #e2e8f0; border: none; padding: 2px 7px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; color: #334155; cursor: pointer;">+5 d</button>
                <button type="button" id="btn-quick-10d" style="background: #e2e8f0; border: none; padding: 2px 7px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; color: #334155; cursor: pointer;">+10 d</button>
                <button type="button" id="btn-quick-15d" style="background: #e2e8f0; border: none; padding: 2px 7px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; color: #334155; cursor: pointer;">+15 d</button>
                <button type="button" id="btn-quick-30d" style="background: #e2e8f0; border: none; padding: 2px 7px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; color: #334155; cursor: pointer;">+30 d</button>
                <button type="button" id="btn-quick-eom" style="background: #e2e8f0; border: none; padding: 2px 7px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; color: #334155; cursor: pointer;">Fin de Mes</button>
              </div>
            </div>
            <input type="text" id="swal-inp-term" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; border-radius: 6px;" value="${escapeHtml(currentTerm)}" placeholder="ej: 5 días corridos">
          </div>
        </div>

        <!-- Sección 2: Información Legal del Comercio -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem;">
          <div style="font-weight: 700; font-size: 0.825rem; color: #0284c7; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-building-line"></i> Datos Legales del Cliente
          </div>
          <div style="margin-bottom: 0.75rem;">
            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.25rem;">RAZÓN SOCIAL</label>
            <input type="text" id="swal-inp-razon" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; border-radius: 6px;" value="${escapeHtml(currentRazon)}" placeholder="Razón Social Oficial">
          </div>
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.85rem; margin-bottom: 0.75rem;">
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.25rem;">RUT CLIENTE</label>
              <input type="text" id="swal-inp-rut" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; border-radius: 6px;" value="${escapeHtml(currentRut)}" placeholder="ej: 77.948.909-4">
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.25rem;">CÓD. SIGLA</label>
              <input type="text" id="swal-inp-sigla" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem; border-radius: 6px;" value="${escapeHtml(currentSigla)}" placeholder="ej: TSS">
            </div>
          </div>

          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.785rem; color: #475569; cursor: pointer; margin-top: 0.5rem; user-select: none;">
            <input type="checkbox" id="swal-chk-save-db" checked style="accent-color: #5f06fa; width: 16px; height: 16px; cursor: pointer;">
            <span>Guardar Razón Social y RUT permanentemente en la configuración del comercio</span>
          </label>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Aplicar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    didOpen: () => {
      const emisionEl = document.getElementById('swal-inp-emision');
      const dueEl = document.getElementById('swal-inp-due');
      const termEl = document.getElementById('swal-inp-term');

      const recalcTerm = () => {
        if (!emisionEl.value || !dueEl.value) return;
        const eDate = new Date(emisionEl.value + 'T00:00:00');
        const dDate = new Date(dueEl.value + 'T00:00:00');
        const diffTime = dDate.getTime() - eDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
        if (diffDays > 0) {
          termEl.value = `${diffDays} días corridos`;
        } else if (diffDays === 0) {
          termEl.value = 'Mismo día (Contado)';
        }
      };

      const setPresetDays = (days) => {
        if (!emisionEl.value) emisionEl.value = toISODate(new Date());
        const baseDate = new Date(emisionEl.value + 'T00:00:00');
        baseDate.setDate(baseDate.getDate() + days);
        dueEl.value = toISODate(baseDate);
        termEl.value = `${days} días corridos`;
      };

      const setEndOfMonth = () => {
        if (!emisionEl.value) emisionEl.value = toISODate(new Date());
        const [y, m] = emisionEl.value.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        dueEl.value = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        recalcTerm();
      };

      emisionEl?.addEventListener('change', recalcTerm);
      dueEl?.addEventListener('change', recalcTerm);

      document.getElementById('btn-quick-5d')?.addEventListener('click', () => setPresetDays(5));
      document.getElementById('btn-quick-10d')?.addEventListener('click', () => setPresetDays(10));
      document.getElementById('btn-quick-15d')?.addEventListener('click', () => setPresetDays(15));
      document.getElementById('btn-quick-30d')?.addEventListener('click', () => setPresetDays(30));
      document.getElementById('btn-quick-eom')?.addEventListener('click', setEndOfMonth);
    },
    preConfirm: () => {
      const emisionDate = document.getElementById('swal-inp-emision')?.value;
      const dueDate = document.getElementById('swal-inp-due')?.value;
      const termLabel = document.getElementById('swal-inp-term')?.value?.trim() || '5 días corridos';
      const razonSocial = document.getElementById('swal-inp-razon')?.value?.trim() || b.currentCommerce;
      const rut = document.getElementById('swal-inp-rut')?.value?.trim() || '—';
      const sigla = document.getElementById('swal-inp-sigla')?.value?.trim()?.toUpperCase() || '—';
      const saveToDb = document.getElementById('swal-chk-save-db')?.checked || false;

      if (!emisionDate || !dueDate) {
        Swal.showValidationMessage('Debes ingresar la fecha de emisión y la fecha límite de pago.');
        return false;
      }

      return { emisionDate, dueDate, termLabel, razonSocial, rut, sigla, saveToDb };
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const { emisionDate, dueDate, termLabel, razonSocial, rut, sigla, saveToDb } = result.value;

      b.invoiceDates = { emisionDate, dueDate, termLabel };
      b.commerceInfo = {
        ...b.commerceInfo,
        razonSocial,
        rut,
        sigla
      };

      // Guardar permanentemente en localStorage de datos legales del comercio
      if (b.currentCommerce) {
        try {
          localStorage.setItem(`stocka_commerce_legal_${b.currentCommerce}`, JSON.stringify({
            razonSocial,
            rut,
            sigla
          }));
        } catch (e) {}
      }

      // Si el usuario marcó guardar en base de datos
      if (saveToDb && b.currentCommerce) {
        try {
          const { error: updErr } = await supabase
            .from('comercios_adicional_config')
            .upsert({
              comercio: b.currentCommerce,
              razon_social: razonSocial,
              rut: rut !== '—' ? rut : null
            }, { onConflict: 'comercio' });

          if (updErr) {
            console.warn('Aviso actualizando comercios_adicional_config:', updErr);
          }
        } catch (eDb) {
          console.warn('Excepción guardando datos legales en DB:', eDb);
        }
      }

      // Actualizar inmediatamente en el snapshot guardado en localStorage y re-subir a Storage si ya estaba publicado
      if (b.currentPeriodId && b.currentCommerce) {
        const storageKey = `stocka_fulfillment_details_${b.currentPeriodId}_${b.currentCommerce}`;
        try {
          const cachedStr = localStorage.getItem(storageKey);
          if (cachedStr) {
            const cachedObj = JSON.parse(cachedStr);
            cachedObj.commerceInfo = { ...cachedObj.commerceInfo, razonSocial, rut, sigla };
            cachedObj.invoiceDates = { emisionDate, dueDate, termLabel };
            localStorage.setItem(storageKey, JSON.stringify(cachedObj));

            if (b.isPublished) {
              uploadBillingSnapshotToStorage(cachedObj).then(newUrl => {
                if (newUrl) {
                  cachedObj.fulfillment_link = newUrl;
                  try { localStorage.setItem(storageKey, JSON.stringify(cachedObj)); } catch (e) {}
                  supabase
                    .from('billing_records')
                    .update({ fulfillment_link: newUrl, updated_at: new Date().toISOString() })
                    .eq('period_id', b.currentPeriodId)
                    .eq('comercio', b.currentCommerce)
                    .then(() => {})
                    .catch(e => console.warn('Aviso actualizando fulfillment_link en DB:', e));
                }
              }).catch(errUp => console.warn('Aviso sincronizando snapshot en Storage:', errUp));
            }
          }
        } catch (e) {}

        // Sincronizar fecha_limite en billing_records si se definió dueDate
        if (dueDate) {
          try {
            await supabase
              .from('billing_records')
              .update({ fecha_limite: dueDate, updated_at: new Date().toISOString() })
              .eq('period_id', b.currentPeriodId)
              .eq('comercio', b.currentCommerce);
          } catch (eDate) {
            console.warn('Aviso actualizando fecha_limite en billing_records:', eDate);
          }
        }
      }

      // Marcar estado como pendiente de guardado formal si no estaba publicado
      if (!b.isPublished) {
        b.isSaved = false;
      }

      // Actualizar contenedor del desglose oficial
      const desgloseCont = document.getElementById('bg-desglose-view-container');
      if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();

      // Si el modal interactivo de cliente está abierto, actualizar su vista y snapshot activo
      if (window.__currentClientBillingSnapshot) {
        window.__currentClientBillingSnapshot.commerceInfo = {
          ...window.__currentClientBillingSnapshot.commerceInfo,
          razonSocial,
          rut,
          sigla
        };
        window.__currentClientBillingSnapshot.invoiceDates = { emisionDate, dueDate, termLabel };
        const clientDesgloseCont = document.querySelector('#client-modal-content-desglose .client-billing-modal-view');
        if (clientDesgloseCont) {
          clientDesgloseCont.innerHTML = renderStockaDesgloseHTML(window.__currentClientBillingSnapshot);
        }
      }

      // Notificación toast
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Desglose oficial actualizado',
        text: 'Las fechas y datos legales se actualizaron correctamente.',
        showConfirmButton: false,
        timer: 3000
      });
    }
  });
}

// --- MOTOR DE FILTRADO POR COLUMNAS Y FILTROS RÁPIDOS EN REGISTRO EDITABLE ---
window.bgFilterState = {
  global: '',
  inc: '',
  order: '',
  agenda: '',
  dest: '',
  ticketMin: '',
  ticketMax: '',
  delivery: '',
  skus: '',
  units: '',
  mkt: '',
  quickFilter: 'all'
};

// Actualizar contadores numéricos en las pastillas de filtros rápidos
function updateQuickPillCounts(orders) {
  const total = orders.length;
  const noAgenda = orders.filter(o => {
    const a = String(o.agenda || '').trim();
    return !a || a === '—' || a === '-';
  }).length;
  const withAgenda = total - noAgenda;
  const rmFlex = orders.filter(o => o.deliveryType === 'RM_STK' || o.deliveryType === 'COLINA' || o.deliveryType === 'FLEX').length;
  const enviame = orders.filter(o => o.deliveryType === 'ENVIAME_REGION').length;
  const centroEnvios = orders.filter(o => o.deliveryType === 'CENTRO_ENVIOS').length;
  const mkt = orders.filter(o => o.isMarketplace).length;
  const posCount = orders.filter(o => o.isPosOrder || isPosSaleOrder(o)).length;

  const setElText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };
  setElText('qf-count-all', total);
  setElText('qf-count-no-agenda', noAgenda);
  setElText('qf-count-with-agenda', withAgenda);
  setElText('qf-count-rm-flex', rmFlex);
  setElText('qf-count-enviame', enviame);
  setElText('qf-count-centro-envios', centroEnvios);
  setElText('qf-count-mkt', mkt);
  setElText('qf-count-pos', posCount);
}

// Actualizar dinámicamente las opciones del selector de Tiendas del Conglomerado
function updateStoreFilterOptions(orders = null) {
  const select = document.getElementById('bg-col-filter-store');
  if (!select) return;

  if (!billingState.isConglomerate) {
    select.style.display = 'none';
    select.innerHTML = '<option value="">Todas las Tiendas</option>';
    return;
  }

  select.style.display = '';
  const currentVal = select.value || (window.bgFilterState?.store || '');
  const ordersList = orders || billingState.orders || [];
  const storeMap = {};

  ordersList.forEach(o => {
    const rawStore = String(o.comercio || '').trim();
    if (rawStore) {
      storeMap[rawStore] = (storeMap[rawStore] || 0) + 1;
    }
  });

  // Asegurar que también aparezcan todas las tiendas hijas del conglomerado
  (billingState.conglomerateChildren || []).forEach(child => {
    if (storeMap[child] === undefined) {
      storeMap[child] = 0;
    }
  });

  const sortedStores = Object.keys(storeMap).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  let optionsHTML = '<option value="">🏢 Todas las Tiendas</option>';
  sortedStores.forEach(st => {
    const isSel = currentVal.toLowerCase() === st.toLowerCase();
    const count = storeMap[st] || 0;
    optionsHTML += `<option value="${escapeHtml(st)}" ${isSel ? 'selected' : ''}>🏪 ${escapeHtml(st)} (${count})</option>`;
  });

  select.innerHTML = optionsHTML;
  if (currentVal) {
    const matchOpt = Array.from(select.options).find(o => o.value.toLowerCase() === currentVal.toLowerCase());
    if (matchOpt) select.value = matchOpt.value;
  }
}

// Actualizar dinámicamente las opciones del selector de Agendas (ej: CENTRO DE ENVIOS, FLEX, RM, STK, etc.)
function updateAgendaFilterOptions(orders) {
  const select = document.getElementById('bg-col-filter-agenda');
  if (!select) return;

  const currentVal = select.value || (window.bgFilterState?.agenda || '');

  let noAgendaCount = 0;
  let withAgendaCount = 0;
  const agendaMap = {};

  orders.forEach(o => {
    const rawAgenda = String(o.agenda || '').trim();
    if (!rawAgenda || rawAgenda === '—' || rawAgenda === '-') {
      noAgendaCount++;
    } else {
      withAgendaCount++;
      const normAgenda = rawAgenda.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
      agendaMap[normAgenda] = (agendaMap[normAgenda] || 0) + 1;
    }
  });

  const sortedAgendas = Object.keys(agendaMap).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  let optionsHTML = `
    <option value="">Todas las Agendas</option>
    <option value="empty" ${currentVal === 'empty' ? 'selected' : ''}>⚠️ Sin Agenda (${noAgendaCount})</option>
    <option value="with" ${currentVal === 'with' ? 'selected' : ''}>✓ Con Agenda (${withAgendaCount})</option>
  `;

  if (sortedAgendas.length > 0) {
    optionsHTML += `
      <optgroup label="Agendas Asignadas (${sortedAgendas.length})">
        ${sortedAgendas.map(ag => {
          const isSel = currentVal.toLowerCase() === ag.toLowerCase();
          return `<option value="${escapeHtml(ag)}" ${isSel ? 'selected' : ''}>${escapeHtml(ag)} (${agendaMap[ag]})</option>`;
        }).join('')}
      </optgroup>
    `;
  }

  select.innerHTML = optionsHTML;
  if (currentVal) {
    const matchOpt = Array.from(select.options).find(o => o.value.toLowerCase() === currentVal.toLowerCase());
    if (matchOpt) select.value = matchOpt.value;
  }
}

// Actualizar dinámicamente las opciones del selector de Categoría de Pedido
function updateCategoriaFilterOptions(orders = null) {
  const select = document.getElementById('bg-col-filter-categoria');
  if (!select) return;

  const currentVal = select.value || (window.bgFilterState?.categoria || '');
  const ordersList = orders || billingState.orders || [];
  const countMap = {
    'DISTRIBUCIÓN': 0,
    'RETIRO': 0,
    'SHOP POINT (POS)': 0,
    'LOGÍSTICA INVERSA': 0
  };

  ordersList.forEach(o => {
    const cat = resolveOrderBillingCategoria(o);
    countMap[cat] = (countMap[cat] || 0) + 1;
  });

  const categoriesCatalog = [
    { key: 'DISTRIBUCIÓN', label: 'Distribución' },
    { key: 'RETIRO', label: 'Retiro' },
    { key: 'SHOP POINT (POS)', label: 'Shop Point (POS)' },
    { key: 'LOGÍSTICA INVERSA', label: 'Logística Inversa' }
  ];

  let optionsHTML = '<option value="">Todas las Categorías</option>';
  categoriesCatalog.forEach(c => {
    const isSel = currentVal === c.key;
    const count = countMap[c.key] || 0;
    optionsHTML += `<option value="${escapeHtml(c.key)}" ${isSel ? 'selected' : ''}>${escapeHtml(c.label)}${ordersList.length > 0 ? ` (${count})` : ''}</option>`;
  });

  select.innerHTML = optionsHTML;
  if (currentVal) {
    const matchOpt = Array.from(select.options).find(o => o.value === currentVal);
    if (matchOpt) select.value = matchOpt.value;
  }
}

// Actualizar dinámicamente las opciones del selector de Tipo de Entrega
function updateDeliveryFilterOptions(orders = null) {
  const select = document.getElementById('bg-col-filter-delivery');
  if (!select) return;

  const currentVal = select.value || (window.bgFilterState?.delivery || '');
  const deliveryTypes = getDeliveryTypes(billingState.pricingConfig);

  const ordersList = orders || billingState.orders || [];
  const countMap = {};
  ordersList.forEach(o => {
    countMap[o.deliveryType] = (countMap[o.deliveryType] || 0) + 1;
  });

  let optionsHTML = '<option value="">Todos los tipos</option>';
  deliveryTypes.forEach(dt => {
    const isSel = currentVal === dt.key;
    const count = countMap[dt.key] || 0;
    optionsHTML += `<option value="${escapeHtml(dt.key)}" ${isSel ? 'selected' : ''}>${escapeHtml(dt.name)} (${formatCLP(dt.price)})${ordersList.length > 0 ? ` [${count}]` : ''}</option>`;
  });

  select.innerHTML = optionsHTML;
  if (currentVal) {
    const matchOpt = Array.from(select.options).find(o => o.value === currentVal);
    if (matchOpt) select.value = matchOpt.value;
  }
}

// Aplicar filtros por columnas de forma combinada y reactiva
window.applyBgColumnFilters = function() {
  const globalInput = document.getElementById('bg-filter-order-input');
  const incSelect = document.getElementById('bg-col-filter-inc');
  const orderInput = document.getElementById('bg-col-filter-order');
  const storeSelect = document.getElementById('bg-col-filter-store');
  const agendaSelect = document.getElementById('bg-col-filter-agenda');
  const categoriaSelect = document.getElementById('bg-col-filter-categoria');
  const destInput = document.getElementById('bg-col-filter-dest');
  const ticketMinInput = document.getElementById('bg-col-filter-ticket-min');
  const ticketMaxInput = document.getElementById('bg-col-filter-ticket-max');
  const deliverySelect = document.getElementById('bg-col-filter-delivery');
  const skusInput = document.getElementById('bg-col-filter-skus');
  const unitsInput = document.getElementById('bg-col-filter-units');
  const mktSelect = document.getElementById('bg-col-filter-mkt');

  const globalQuery = (globalInput ? globalInput.value : (window.bgFilterState?.global || '')).toLowerCase().trim();
  const incFilter = incSelect ? incSelect.value : (window.bgFilterState?.inc || '');
  const orderQuery = (orderInput ? orderInput.value : (window.bgFilterState?.order || '')).toLowerCase().trim();
  const storeFilter = (storeSelect ? storeSelect.value : (window.bgFilterState?.store || '')).toLowerCase().trim();
  const agendaFilter = agendaSelect ? agendaSelect.value : (window.bgFilterState?.agenda || '');
  const categoriaFilter = categoriaSelect ? categoriaSelect.value : (window.bgFilterState?.categoria || '');

  // Sincronizar estado de tienda seleccionada si cambió desde el dropdown
  if (billingState.isConglomerate && storeSelect) {
    const rawVal = storeSelect.value ? storeSelect.value.trim() : null;
    if (billingState.activeConglomerateStoreFilter !== rawVal) {
      billingState.activeConglomerateStoreFilter = rawVal;
      renderConglomerateBannerUI();
      updateActiveStoreFilterBannerUI();
      const analyticsContent = document.getElementById('bg-content-analytics');
      if (analyticsContent && analyticsContent.style.display !== 'none') {
        renderBillingAnalyticsCharts();
      }
    }
  }
  const destQuery = (destInput ? destInput.value : (window.bgFilterState?.dest || '')).toLowerCase().trim();
  const ticketMinVal = ticketMinInput ? ticketMinInput.value : (window.bgFilterState?.ticketMin || '');
  const ticketMaxVal = ticketMaxInput ? ticketMaxInput.value : (window.bgFilterState?.ticketMax || '');
  const deliveryFilter = deliverySelect ? deliverySelect.value : (window.bgFilterState?.delivery || '');
  const skusVal = skusInput ? skusInput.value : (window.bgFilterState?.skus || '');
  const unitsVal = unitsInput ? unitsInput.value : (window.bgFilterState?.units || '');
  const mktFilter = mktSelect ? mktSelect.value : (window.bgFilterState?.mkt || '');

  const ticketMin = ticketMinVal !== '' ? parseInt(ticketMinVal, 10) : NaN;
  const ticketMax = ticketMaxVal !== '' ? parseInt(ticketMaxVal, 10) : NaN;
  const skusMin = skusVal !== '' ? parseInt(skusVal, 10) : NaN;
  const unitsMin = unitsVal !== '' ? parseInt(unitsVal, 10) : NaN;

  window.bgFilterState = {
    global: globalQuery,
    inc: incFilter,
    order: orderQuery,
    store: storeFilter,
    agenda: agendaFilter,
    categoria: categoriaFilter,
    dest: destQuery,
    ticketMin: ticketMinVal,
    ticketMax: ticketMaxVal,
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

    // 2. ID Pedido, fecha, agenda o estado WMS
    if (match && orderQuery) {
      const orderText = ((r.getAttribute('data-order') || '') + ' ' +
                         (r.getAttribute('data-agenda') || '') + ' ' +
                         (r.getAttribute('data-wms') || '') + ' ' +
                         (r.getAttribute('data-date') || '')).toLowerCase();
      if (!orderText.includes(orderQuery)) match = false;
    }

    // 2b. Tienda del Conglomerado
    if (match && storeFilter) {
      const rowStore = (r.getAttribute('data-comercio') || '').toLowerCase().trim();
      if (!rowStore.includes(storeFilter) && !storeFilter.includes(rowStore)) match = false;
    }

    // 3. Estado o Nombre de Agenda (ej: 'empty', 'with', 'CENTRO DE ENVIOS', 'FLEX', 'RM', 'STK')
    if (match && agendaFilter) {
      const hasAgenda = r.getAttribute('data-has-agenda') === '1';
      if (agendaFilter === 'empty') {
        if (hasAgenda) match = false;
      } else if (agendaFilter === 'with') {
        if (!hasAgenda) match = false;
      } else {
        const rowAgenda = (r.getAttribute('data-agenda') || '').trim().toLowerCase();
        const targetAgenda = agendaFilter.trim().toLowerCase();
        const words = rowAgenda.split(/[\s\-_/+,|]+/);
        const matchesExact = rowAgenda === targetAgenda;
        const matchesWord = words.includes(targetAgenda);
        if (!matchesExact && !matchesWord && !rowAgenda.startsWith(targetAgenda) && !rowAgenda.endsWith(targetAgenda)) {
          match = false;
        }
      }
    }

    // 3b. Categoría de Pedido (DISTRIBUCIÓN, RETIRO, SHOP POINT (POS), LOGÍSTICA INVERSA)
    if (match && categoriaFilter) {
      const rowCat = (r.getAttribute('data-categoria') || 'DISTRIBUCIÓN').trim().toUpperCase();
      if (rowCat !== categoriaFilter.trim().toUpperCase()) {
        match = false;
      }
    }

    // 4. Destino, Operador y Método de Envío
    if (match && destQuery) {
      const destText = ((r.getAttribute('data-dest') || '') + ' ' +
                        (r.getAttribute('data-operador') || '') + ' ' +
                        (r.getAttribute('data-method') || '')).toLowerCase();
      if (!destText.includes(destQuery)) match = false;
    }

    // 4b. Ticket de Venta Mínimo y Máximo ($)
    if (match && (!isNaN(ticketMin) || !isNaN(ticketMax))) {
      const ticket = parseInt(r.getAttribute('data-ticket'), 10) || 0;
      if (!isNaN(ticketMin) && ticket < ticketMin) match = false;
      if (!isNaN(ticketMax) && ticket > ticketMax) match = false;
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
    if (billingState.isConglomerate && billingState.activeConglomerateStoreFilter) {
      countBadge.innerHTML = `Mostrando <strong>${visibleCount}</strong> de <strong>${totalCount}</strong> pedidos <span style="background: rgba(95,6,250,0.12); color: #5f06fa; padding: 2px 7px; border-radius: 4px; font-weight: 800; font-size: 0.72rem; margin-left: 4px;"><i class="ri-store-2-line"></i> ${escapeHtml(billingState.activeConglomerateStoreFilter)}</span>`;
    } else {
      countBadge.textContent = `Mostrando ${visibleCount} de ${totalCount} pedidos`;
    }
  }

  // Actualizar checkbox maestro de inclusión según el estado de las filas visibles
  const masterCheckbox = document.getElementById('bg-master-inclusion-checkbox');
  if (masterCheckbox) {
    if (visibleCount === 0) {
      masterCheckbox.checked = false;
      masterCheckbox.indeterminate = false;
    } else {
      let includedVisibleCount = 0;
      rows.forEach(r => {
        if (r.style.display !== 'none' && r.getAttribute('data-inc') === '1') {
          includedVisibleCount++;
        }
      });
      masterCheckbox.checked = includedVisibleCount === visibleCount;
      masterCheckbox.indeterminate = includedVisibleCount > 0 && includedVisibleCount < visibleCount;
    }
  }

  const isAnyFilterActive = !!(globalQuery || incFilter || orderQuery || storeFilter || agendaFilter || categoriaFilter || destQuery || !isNaN(ticketMin) || !isNaN(ticketMax) || deliveryFilter || !isNaN(skusMin) || !isNaN(unitsMin) || mktFilter);
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
    'bg-col-filter-store',
    'bg-col-filter-agenda',
    'bg-col-filter-categoria',
    'bg-col-filter-dest',
    'bg-col-filter-ticket-min',
    'bg-col-filter-ticket-max',
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
    if (billingState.isConglomerate) {
      billingState.activeConglomerateStoreFilter = null;
      renderConglomerateBannerUI();
      updateActiveStoreFilterBannerUI();
    }
  } else {
    // Si se activa un filtro rápido y hay una tienda seleccionada en el holding, preservar su selección
    if (billingState.isConglomerate && billingState.activeConglomerateStoreFilter) {
      const storeSelect = document.getElementById('bg-col-filter-store');
      if (storeSelect) storeSelect.value = billingState.activeConglomerateStoreFilter;
      if (!window.bgFilterState) window.bgFilterState = {};
      window.bgFilterState.store = billingState.activeConglomerateStoreFilter.toLowerCase().trim();
    }
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
  } else if (filterType === 'centro-envios') {
    const el = document.getElementById('bg-col-filter-delivery');
    if (el) el.value = 'CENTRO_ENVIOS';
  } else if (filterType === 'mkt') {
    const el = document.getElementById('bg-col-filter-mkt');
    if (el) el.value = 'yes';
  } else if (filterType === 'pos') {
    const el = document.getElementById('bg-col-filter-delivery');
    if (el) el.value = 'POS';
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
    window.switchBillingAdminTab('generator', commerceName, periodId);
  } else if (typeof window.renderBillingGeneratorAdmin === 'function') {
    window.renderBillingGeneratorAdmin('tab-generator-content', commerceName, periodId);
  }
};

// Modal interactivo para fechas y datos legales del desglose oficial
window.openEditDesgloseHeaderModal = openEditDesgloseHeaderModal;

// Función para copiar los datos bancarios del desglose oficial al portapapeles
window.copyDesgloseBankDetails = function(btn) {
  const textToCopy = `Datos para Transferencia Bancaria
Razón Social: ${STOCKA_BRAND.razonSocial}
RUT: ${STOCKA_BRAND.rut}
Banco: ${STOCKA_BRAND.banco}
Tipo de Cuenta: ${STOCKA_BRAND.tipoCuenta}
N° de Cuenta: ${STOCKA_BRAND.numeroCuenta}
Email de Envío: ${STOCKA_BRAND.emailEnvio}`;

  const showSuccessFeedback = () => {
    if (btn) {
      const origHtml = btn.innerHTML;
      btn.innerHTML = `<i class="ri-check-line" style="color: #10b981;"></i> <span>¡Copiado!</span>`;
      btn.style.borderColor = '#10b981';
      btn.style.color = '#10b981';
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.style.borderColor = '#cbd5e1';
        btn.style.color = '#334155';
      }, 2500);
    }
    if (window.Swal) {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'success',
        title: 'Datos para transferencia copiados'
      });
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(showSuccessFeedback).catch(() => {
      fallbackCopy(textToCopy);
    });
  } else {
    fallbackCopy(textToCopy);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showSuccessFeedback();
    } catch (e) {
      if (window.Swal) Swal.fire('Datos para Transferencia Bancaria', text.replace(/\n/g, '<br>'), 'info');
    }
    ta.remove();
  }
};

// ============================================================================
// --- SUBSISTEMA DE CHECKLIST GLOBAL DE FACTURACIÓN Y VERIFICACIÓN ---
// ============================================================================

export const DEFAULT_GLOBAL_CHECKLIST_ITEMS = [
  {
    id: 'chk_orders_agenda',
    title: 'Revisar y clasificar pedidos sin agenda o asignación',
    description: 'Filtrar pedidos en "Sin Agenda" y verificar el courier o destino en WMS antes de facturar.',
    category: 'Pedidos',
    isDefault: true
  },
  {
    id: 'chk_pickpack_rates',
    title: 'Verificar tarifas Pick & Pack y recargos por SKUs / Unidades',
    description: 'Comprobar que la tarifa base ($850) y los tramos por exceso de SKUs (+3) y Unidades (+10) sean correctos.',
    category: 'Tarifas',
    isDefault: true
  },
  {
    id: 'chk_enviame_regions',
    title: 'Auditar pedidos a Regiones y sincronización de fletes Envíame',
    description: 'Verificar cantidad de pedidos Envíame / Región y corroborar que sus fletes concuerden.',
    category: 'Despachos',
    isDefault: true
  },
  {
    id: 'chk_rm_flex',
    title: 'Confirmar pedidos Flex y RM con sus tarifas asignadas',
    description: 'Revisar despachos Flex / RM ($3.200) y Colina / zonas periféricas ($3.490).',
    category: 'Despachos',
    isDefault: true
  },
  {
    id: 'chk_storage_volume',
    title: 'Validar m³ de almacenamiento mensual y descuento por tramo',
    description: 'Confirmar el promedio mensual de m³ y el porcentaje de descuento comercial aplicado.',
    category: 'Almacenamiento',
    isDefault: true
  },
  {
    id: 'chk_inbound_stock',
    title: 'Revisar cobros de ingresos de stock (inbound) del mes',
    description: 'Validar si el comercio tuvo recepciones de stock y si el cobro por unidades/m³ corresponde.',
    category: 'Almacenamiento',
    isDefault: true
  },
  {
    id: 'chk_supplies_boxes',
    title: 'Revisar y verificar insumos y cajas de despacho agregadas o eliminadas',
    description: 'Chequear cajas de envío a regiones ($450 c/u) y cualquier material adicional consumido.',
    category: 'Insumos',
    isDefault: true
  },
  {
    id: 'chk_fixed_fee',
    title: 'Confirmar aplicación o exención del Costo Variable Mensual',
    description: 'Verificar si aplica exención (>= 75 pedidos o >= 1.5 m³) o cobro (0.9 UF / 1.5 UF).',
    category: 'Tarifas',
    isDefault: true
  },
  {
    id: 'chk_legal_data',
    title: 'Validar Razón Social, RUT del cliente y fechas de emisión/pago',
    description: 'Confirmar que los datos tributarios del cliente coincidan con el SII y que el plazo de pago sea el acordado.',
    category: 'Fiscal & Legal',
    isDefault: true
  },
  {
    id: 'chk_save_record',
    title: 'Congelar registro haciendo clic en "Guardar Facturación"',
    description: 'Presionar el botón verde "Guardar Facturación" para respaldar el total y snapshot en Supabase.',
    category: 'Cierre',
    isDefault: true
  },
  {
    id: 'chk_export_pdf',
    title: 'Exportar y auditar PDF oficial del desglose',
    description: 'Descargar el PDF oficial para verificar presentación visual antes de enviar al cliente.',
    category: 'Cierre',
    isDefault: true
  },
  {
    id: 'chk_send_invoice',
    title: 'Enviar desglose formal y factura por correo al comercio',
    description: 'Notificar al contacto de facturación con el PDF y detalles del pago.',
    category: 'Cierre',
    isDefault: true
  }
];

const CHECKLIST_STORAGE_KEY_ITEMS = 'stocka_billing_global_checklist_items';

const CATEGORY_COLORS = {
  'Pedidos': { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' },
  'Tarifas': { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff' },
  'Despachos': { bg: '#fef3c7', color: '#b45309', border: '#fde68a' },
  'Almacenamiento': { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
  'Insumos': { bg: '#ffedd5', color: '#c2410c', border: '#fed7aa' },
  'Fiscal & Legal': { bg: '#ede9fe', color: '#5f06fa', border: '#ddd6fe' },
  'Cierre': { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
  'General': { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' }
};

export function getGlobalChecklistItems() {
  try {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY_ITEMS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error al leer checklist global de localStorage:', e);
  }
  saveGlobalChecklistItems(DEFAULT_GLOBAL_CHECKLIST_ITEMS);
  return DEFAULT_GLOBAL_CHECKLIST_ITEMS;
}

export function saveGlobalChecklistItems(items) {
  try {
    localStorage.setItem(CHECKLIST_STORAGE_KEY_ITEMS, JSON.stringify(items));
  } catch (e) {
    console.error('Error al guardar checklist global en localStorage:', e);
  }
}

function getChecklistChecksKey(periodId, commerce) {
  const p = periodId || billingState.currentPeriodId || 'default';
  const c = commerce || billingState.currentCommerce || 'default';
  return `stocka_billing_checks_${p}_${c}`;
}

export function getChecklistChecks(periodId, commerce) {
  try {
    const raw = localStorage.getItem(getChecklistChecksKey(periodId, commerce));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

export function saveChecklistChecks(periodId, commerce, checks) {
  try {
    localStorage.setItem(getChecklistChecksKey(periodId, commerce), JSON.stringify(checks));
  } catch (e) {}
}

export function getChecklistDataForSnapshot() {
  const items = getGlobalChecklistItems();
  const checks = getChecklistChecks(billingState.currentPeriodId, billingState.currentCommerce);
  const completedCount = items.filter(it => checks[it.id]?.checked).length;
  return {
    items,
    checks,
    completedCount,
    totalCount: items.length,
    savedAt: new Date().toISOString()
  };
}

export function updateChecklistNavBadge() {
  const badge = document.getElementById('bg-checklist-nav-badge');
  if (!badge) return;

  const items = getGlobalChecklistItems();
  const checks = getChecklistChecks(billingState.currentPeriodId, billingState.currentCommerce);
  const total = items.length;
  const completed = items.filter(it => checks[it.id]?.checked).length;

  badge.textContent = `${completed}/${total}`;
  if (completed === total && total > 0) {
    badge.style.background = '#dcfce7';
    badge.style.color = '#15803d';
  } else {
    badge.style.background = 'rgba(95, 6, 250, 0.12)';
    badge.style.color = '#5f06fa';
  }
}

// Filtros y búsqueda para la UI del checklist
window.bgChecklistFilter = 'all'; // 'all' | 'pending' | 'completed'
window.bgChecklistSearch = '';

export function renderBillingChecklistUI(targetContainerId = 'bg-checklist-container') {
  const container = document.getElementById(targetContainerId);
  if (!container) return;

  const items = getGlobalChecklistItems();
  const checks = getChecklistChecks(billingState.currentPeriodId, billingState.currentCommerce);
  const totalCount = items.length;
  const completedCount = items.filter(it => checks[it.id]?.checked).length;
  const pendingCount = totalCount - completedCount;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isAllCompleted = totalCount > 0 && completedCount === totalCount;

  // Filtrado
  const filter = window.bgChecklistFilter || 'all';
  const query = (window.bgChecklistSearch || '').toLowerCase().trim();

  const filteredItems = items.filter(it => {
    const isChecked = !!checks[it.id]?.checked;
    if (filter === 'pending' && isChecked) return false;
    if (filter === 'completed' && !isChecked) return false;
    if (query) {
      const matchTitle = (it.title || '').toLowerCase().includes(query);
      const matchDesc = (it.description || '').toLowerCase().includes(query);
      const matchCat = (it.category || '').toLowerCase().includes(query);
      if (!matchTitle && !matchDesc && !matchCat) return false;
    }
    return true;
  });

  updateChecklistNavBadge();

  container.innerHTML = `
    <!-- Hero del Checklist Global -->
    <div class="bg-checklist-hero">
      <div style="display: flex; align-items: center; gap: 0.85rem;">
        <div style="width: 44px; height: 44px; border-radius: 10px; background: #5f06fa; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; box-shadow: 0 4px 10px rgba(95, 6, 250, 0.25);">
          <i class="ri-checkbox-circle-line"></i>
        </div>
        <div>
          <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
            Checklist Global de Facturación
            <span style="font-size: 0.725rem; font-weight: 700; background: rgba(95, 6, 250, 0.1); color: #5f06fa; padding: 2px 8px; border-radius: 6px;">Control de Calidad</span>
          </h3>
          <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
            Lista de verificación para validar y auditar la facturación de <strong>${escapeHtml(billingState.currentCommerce || 'Comercio')}</strong> (${escapeHtml(billingState.currentPeriodName || 'Periodo')}).
          </p>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <button type="button" class="btn btn-outline btn-sm" onclick="window.markAllChecklistItems(true)" style="border-radius: 6px; font-weight: 700; color: #10b981; border-color: #10b981;" title="Marcar todos los puntos como listos">
          <i class="ri-check-double-line"></i> Marcar Todos
        </button>
        <button type="button" class="btn btn-outline btn-sm" onclick="window.markAllChecklistItems(false)" style="border-radius: 6px; font-weight: 700; color: #64748b; border-color: #cbd5e1;" title="Desmarcar todos los puntos">
          <i class="ri-refresh-line"></i> Desmarcar Todos
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.openAddChecklistItemModal()" style="background: #5f06fa; border-color: #5f06fa; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
          <i class="ri-add-line"></i> + Nuevo Punto
        </button>
        <button type="button" class="btn btn-outline btn-sm" onclick="window.resetDefaultChecklistItems()" style="border-radius: 6px; font-weight: 600; color: #94a3b8; font-size: 0.75rem;" title="Restablecer a los 12 puntos por defecto de Stocka">
          Restablecer
        </button>
      </div>
    </div>

    <!-- Tarjeta de Progreso Visual -->
    <div class="bg-checklist-progress-card">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <div style="font-weight: 800; font-size: 0.95rem; color: var(--color-text-main);">
            Progreso de Verificación:
          </div>
          <span style="font-size: 0.85rem; font-weight: 800; color: ${isAllCompleted ? '#10b981' : '#5f06fa'};">
            ${completedCount} de ${totalCount} completados (${pct}%)
          </span>
        </div>
        <div style="font-size: 0.775rem; color: var(--color-text-muted);">
          ${isAllCompleted 
            ? '<span style="color: #10b981; font-weight: 700;"><i class="ri-checkbox-circle-fill"></i> ¡Todo revisado! Listo para facturar.</span>' 
            : `<span>Quedan <strong>${pendingCount}</strong> punto(s) pendiente(s).</span>`}
        </div>
      </div>
      <div class="bg-checklist-progress-bar-bg">
        <div class="bg-checklist-progress-bar-fill" style="width: ${pct}%; background: ${isAllCompleted ? '#10b981' : 'linear-gradient(90deg, #5f06fa 0%, #10b981 100%)'};"></div>
      </div>
    </div>

    <!-- Barra de Búsqueda y Filtros Rápidos -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem; background: var(--color-bg); padding: 0.55rem 0.85rem; border-radius: 8px; border: 1px solid var(--color-border);">
      <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
        <span style="font-size: 0.725rem; font-weight: 800; color: var(--color-text-muted); margin-right: 4px; text-transform: uppercase; letter-spacing: 0.4px;">
          <i class="ri-filter-3-line" style="color: #5f06fa;"></i> Mostrar:
        </span>
        <button type="button" class="bg-quick-filter-btn ${filter === 'all' ? 'active' : ''}" onclick="window.setBgChecklistFilter('all')">
          Todos (${totalCount})
        </button>
        <button type="button" class="bg-quick-filter-btn ${filter === 'pending' ? 'active' : ''}" onclick="window.setBgChecklistFilter('pending')" style="${pendingCount > 0 ? 'border-color: #fde68a; background: #fffbeb; color: #b45309;' : ''}">
          Pendientes (${pendingCount})
        </button>
        <button type="button" class="bg-quick-filter-btn ${filter === 'completed' ? 'active' : ''}" onclick="window.setBgChecklistFilter('completed')" style="${completedCount > 0 ? 'border-color: #bbf7d0; background: #f0fdf4; color: #15803d;' : ''}">
          Completados (${completedCount})
        </button>
      </div>

      <div style="position: relative; width: 220px;">
        <input type="text" id="bg-checklist-search-input" class="form-input" placeholder="Buscar punto..." value="${escapeHtml(query)}" style="height: 34px; font-size: 0.8rem; margin: 0; width: 100%; padding-left: 2rem; border-radius: 6px;" oninput="window.setBgChecklistSearch(this.value)">
        <i class="ri-search-line" style="position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
      </div>
    </div>

    <!-- Listado de Puntos del Checklist -->
    <div id="bg-checklist-items-list">
      ${filteredItems.length === 0 ? `
        <div style="text-align: center; padding: 2.5rem 1rem; background: var(--color-surface); border: 1px dashed var(--color-border); border-radius: 10px;">
          <i class="ri-check-line" style="font-size: 2.5rem; color: #94a3b8; display: block; margin-bottom: 0.5rem;"></i>
          <h5 style="margin: 0 0 0.25rem 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text-main);">No hay puntos en este filtro</h5>
          <p style="margin: 0; font-size: 0.8rem; color: var(--color-text-muted);">
            ${query ? `No se encontraron coincidencias para "${escapeHtml(query)}".` : (filter === 'pending' ? '¡Felicitaciones! Has completado todos los puntos.' : 'No hay tareas registradas.')}
          </p>
          ${filter !== 'all' || query ? `
            <button type="button" class="btn btn-outline btn-sm" onclick="window.setBgChecklistFilter('all'); document.getElementById('bg-checklist-search-input').value=''; window.setBgChecklistSearch('');" style="margin-top: 0.85rem; font-size: 0.75rem;">
              Ver todos los puntos
            </button>
          ` : ''}
        </div>
      ` : filteredItems.map((it) => {
        const chkData = checks[it.id] || {};
        const isChecked = !!chkData.checked;
        const catStyle = CATEGORY_COLORS[it.category] || CATEGORY_COLORS['General'];
        const checkedAtFormatted = chkData.checkedAt 
          ? new Date(chkData.checkedAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : null;

        return `
          <div class="bg-checklist-item-card ${isChecked ? 'completed' : ''}" onclick="window.toggleChecklistItem('${it.id}', event)">
            <div style="display: flex; align-items: flex-start; gap: 0.85rem; flex: 1;">
              <button type="button" class="bg-checklist-check-btn ${isChecked ? 'checked' : ''}" title="${isChecked ? 'Marcar como pendiente' : 'Marcar como completado'}" onclick="event.stopPropagation(); window.toggleChecklistItem('${it.id}');">
                <i class="${isChecked ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}"></i>
              </button>

              <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.25rem;">
                  <span class="bg-checklist-badge-cat" style="background: ${catStyle.bg}; color: ${catStyle.color}; border: 1px solid ${catStyle.border};">
                    ${escapeHtml(it.category || 'General')}
                  </span>
                  <span class="checklist-title" style="font-weight: 700; font-size: 0.875rem; color: var(--color-text-main);">
                    ${escapeHtml(it.title)}
                  </span>
                  ${isChecked ? `
                    <span style="background: rgba(16, 185, 129, 0.12); color: #059669; font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px;">
                      <i class="ri-check-line"></i> Completado ${checkedAtFormatted ? `(${checkedAtFormatted})` : ''}
                    </span>
                  ` : ''}
                </div>

                ${it.description ? `
                  <div style="font-size: 0.775rem; color: var(--color-text-muted); line-height: 1.35;">
                    ${escapeHtml(it.description)}
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="no-print" style="display: flex; align-items: center; gap: 4px;" onclick="event.stopPropagation();">
              <button type="button" onclick="window.openEditChecklistItemModal('${it.id}')" title="Editar este punto" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #475569; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                <i class="ri-pencil-line"></i> Editar
              </button>
              <button type="button" onclick="window.deleteChecklistItem('${it.id}')" title="Eliminar este punto del checklist" style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px; padding: 4px 8px; cursor: pointer; color: #dc2626; font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

window.setBgChecklistFilter = function(filter) {
  window.bgChecklistFilter = filter;
  renderBillingChecklistUI();
};

window.setBgChecklistSearch = function(query) {
  window.bgChecklistSearch = query;
  renderBillingChecklistUI();
};

window.toggleChecklistItem = function(itemId, event) {
  if (event && (event.target.closest('button') || event.target.tagName === 'BUTTON')) {
    return;
  }
  const checks = getChecklistChecks(billingState.currentPeriodId, billingState.currentCommerce);
  const isCurrentlyChecked = !!checks[itemId]?.checked;

  checks[itemId] = {
    checked: !isCurrentlyChecked,
    checkedAt: !isCurrentlyChecked ? new Date().toISOString() : null
  };

  saveChecklistChecks(billingState.currentPeriodId, billingState.currentCommerce, checks);
  renderBillingChecklistUI();
};

window.markAllChecklistItems = function(checkAll = true) {
  const items = getGlobalChecklistItems();
  const checks = getChecklistChecks(billingState.currentPeriodId, billingState.currentCommerce);

  items.forEach(it => {
    checks[it.id] = {
      checked: checkAll,
      checkedAt: checkAll ? new Date().toISOString() : null
    };
  });

  saveChecklistChecks(billingState.currentPeriodId, billingState.currentCommerce, checks);
  renderBillingChecklistUI();

  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: checkAll ? 'Todos los puntos marcados' : 'Checklist desmarcado',
    showConfirmButton: false,
    timer: 2000
  });
};

window.openAddChecklistItemModal = async function() {
  const categories = Object.keys(CATEGORY_COLORS);

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-add-circle-line" style="color:#5f06fa;"></i><span>Agregar Punto al Checklist</span></div>',
    width: 540,
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">TÍTULO / TAREA A VALIDAR:</label>
        <input id="swal-chk-title" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Ej: Verificar retención de IVA o factura exenta">

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">DESCRIPCIÓN / INSTRUCCIONES (OPCIONAL):</label>
        <textarea id="swal-chk-desc" class="swal2-textarea" style="margin: 0 0 0.75rem 0; width: 100%; height: 65px; font-size: 0.8rem; resize: vertical;" placeholder="Detalles de cómo realizar la verificación..."></textarea>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CATEGORÍA:</label>
        <select id="swal-chk-cat" class="swal2-select" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;">
          ${categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('')}
        </select>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Guardar Punto',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const title = document.getElementById('swal-chk-title')?.value?.trim();
      const description = document.getElementById('swal-chk-desc')?.value?.trim() || '';
      const category = document.getElementById('swal-chk-cat')?.value || 'General';

      if (!title) {
        Swal.showValidationMessage('Ingresa un título para el punto.');
        return false;
      }
      return { title, description, category };
    }
  });

  if (formValues && formValues.title) {
    const items = getGlobalChecklistItems();
    const newItem = {
      id: 'chk_' + Date.now(),
      title: formValues.title,
      description: formValues.description,
      category: formValues.category,
      isDefault: false
    };
    items.push(newItem);
    saveGlobalChecklistItems(items);
    renderBillingChecklistUI();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Punto agregado',
      text: `Se añadió "${newItem.title}" al checklist global.`,
      showConfirmButton: false,
      timer: 2500
    });
  }
};

window.openEditChecklistItemModal = async function(itemId) {
  const items = getGlobalChecklistItems();
  const item = items.find(it => it.id === itemId);
  if (!item) return;

  const categories = Object.keys(CATEGORY_COLORS);

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-pencil-line" style="color:#5f06fa;"></i><span>Editar Punto del Checklist</span></div>',
    width: 540,
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">TÍTULO / TAREA A VALIDAR:</label>
        <input id="swal-edit-chk-title" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${escapeHtml(item.title)}">

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">DESCRIPCIÓN / INSTRUCCIONES:</label>
        <textarea id="swal-edit-chk-desc" class="swal2-textarea" style="margin: 0 0 0.75rem 0; width: 100%; height: 65px; font-size: 0.8rem; resize: vertical;">${escapeHtml(item.description || '')}</textarea>

        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CATEGORÍA:</label>
        <select id="swal-edit-chk-cat" class="swal2-select" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;">
          ${categories.map(cat => `<option value="${escapeHtml(cat)}" ${cat === item.category ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}
        </select>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const title = document.getElementById('swal-edit-chk-title')?.value?.trim();
      const description = document.getElementById('swal-edit-chk-desc')?.value?.trim() || '';
      const category = document.getElementById('swal-edit-chk-cat')?.value || 'General';

      if (!title) {
        Swal.showValidationMessage('El título no puede estar vacío.');
        return false;
      }
      return { title, description, category };
    }
  });

  if (formValues && formValues.title) {
    item.title = formValues.title;
    item.description = formValues.description;
    item.category = formValues.category;

    saveGlobalChecklistItems(items);
    renderBillingChecklistUI();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Punto actualizado',
      showConfirmButton: false,
      timer: 2000
    });
  }
};

window.deleteChecklistItem = function(itemId) {
  const items = getGlobalChecklistItems();
  const idx = items.findIndex(it => it.id === itemId);
  if (idx === -1) return;

  const item = items[idx];

  Swal.fire({
    title: '¿Eliminar punto del checklist?',
    html: `¿Estás seguro de eliminar <strong>"${escapeHtml(item.title)}"</strong> de la lista global de control?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: '<i class="ri-delete-bin-line"></i> Sí, eliminar',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      items.splice(idx, 1);
      saveGlobalChecklistItems(items);
      renderBillingChecklistUI();

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Punto eliminado',
        showConfirmButton: false,
        timer: 2000
      });
    }
  });
};

window.resetDefaultChecklistItems = function() {
  Swal.fire({
    title: '¿Restablecer plantilla por defecto?',
    text: 'Se restaurarán los 12 puntos recomendados de control de calidad para Stocka WMS.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#5f06fa',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Restablecer',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      saveGlobalChecklistItems(DEFAULT_GLOBAL_CHECKLIST_ITEMS);
      renderBillingChecklistUI();

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Plantilla restablecida',
        showConfirmButton: false,
        timer: 2000
      });
    }
  });
};

// Exportar funciones globales
window.renderBillingChecklistUI = renderBillingChecklistUI;
window.updateChecklistNavBadge = updateChecklistNavBadge;

// ============================================================================
// --- SUBSISTEMA DE VISUALIZACIÓN INTERACTIVA PARA CLIENTES (PORTAL COMERCIO) ---
// ============================================================================

// Generar badge con color e icono para la plataforma de origen del pedido
export function getPlatformBadgeHTML(platform) {
  const p = String(platform || 'Manual').trim();
  const pLower = p.toLowerCase();
  
  let icon = 'ri-global-line';
  let color = '#64748b';
  let bg = 'rgba(100, 116, 139, 0.1)';
  let border = 'rgba(100, 116, 139, 0.25)';
  let slug = 'manual';

  if (pLower.includes('shopify')) {
    icon = 'ri-shopping-bag-3-fill';
    color = '#10b981';
    bg = 'rgba(16, 185, 129, 0.12)';
    border = 'rgba(16, 185, 129, 0.3)';
    slug = 'shopify';
  } else if (pLower.includes('mercado') || pLower.includes('meli')) {
    icon = 'ri-shopping-cart-fill';
    color = '#f59e0b';
    bg = 'rgba(245, 158, 11, 0.12)';
    border = 'rgba(245, 158, 11, 0.3)';
    slug = 'mercadolibre';
  } else if (pLower.includes('woo')) {
    icon = 'ri-store-2-fill';
    color = '#8b5cf6';
    bg = 'rgba(139, 92, 246, 0.12)';
    border = 'rgba(139, 92, 246, 0.3)';
    slug = 'woocommerce';
  } else if (pLower.includes('falabella')) {
    icon = 'ri-store-3-fill';
    color = '#84cc16';
    bg = 'rgba(132, 204, 22, 0.12)';
    border = 'rgba(132, 204, 22, 0.3)';
    slug = 'falabella';
  } else if (pLower.includes('paris')) {
    icon = 'ri-store-line';
    color = '#e11d48';
    bg = 'rgba(225, 29, 72, 0.12)';
    border = 'rgba(225, 29, 72, 0.3)';
    slug = 'paris';
  } else if (pLower.includes('ripley')) {
    icon = 'ri-store-line';
    color = '#7c3aed';
    bg = 'rgba(124, 58, 237, 0.12)';
    border = 'rgba(124, 58, 237, 0.3)';
    slug = 'ripley';
  } else if (pLower.includes('vtex')) {
    icon = 'ri-shopping-cart-line';
    color = '#ec4899';
    bg = 'rgba(236, 72, 153, 0.12)';
    border = 'rgba(236, 72, 153, 0.3)';
    slug = 'vtex';
  } else if (pLower.includes('punto de venta') || pLower === 'pos' || pLower.includes('(pos)')) {
    icon = 'ri-store-3-fill';
    color = '#0284c7';
    bg = 'rgba(14, 165, 233, 0.14)';
    border = 'rgba(14, 165, 233, 0.38)';
    slug = 'pos';
  }

  return `<span class="cm-platform-badge cm-platform-${slug}" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; background: ${bg}; color: ${color}; border: 1px solid ${border}; white-space: nowrap;">
    <i class="${icon}"></i> ${escapeHtml(p)}
  </span>`;
}
window.getPlatformBadgeHTML = getPlatformBadgeHTML;

// Inyectar estilos específicos para el modal interactivo de clientes
export function injectClientInteractiveModalStyles() {
  injectBillingGeneratorStyles();

  // Asegurar reemplazo limpio sin estilos cacheados desactualizados
  const existing = document.getElementById('client-interactive-modal-styles');
  if (existing) {
    existing.remove();
  }

  const style = document.createElement('style');
  style.id = 'client-interactive-modal-styles';
  style.innerHTML = `
    .client-billing-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(6px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      animation: cbFadeIn 0.2s ease-out;
    }

    @keyframes cbFadeIn {
      from { opacity: 0; transform: scale(0.98); }
      to { opacity: 1; transform: scale(1); }
    }

    .client-billing-modal-container {
      background: var(--color-surface, #ffffff);
      color: var(--color-text-main, #0f172a);
      width: 100%;
      max-width: 1250px;
      max-height: 94vh;
      border-radius: 16px;
      border: 1px solid var(--color-border, #e2e8f0);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
    }

    .client-billing-modal-header {
      padding: 1.1rem 1.5rem;
      background: var(--color-surface, #ffffff);
      border-bottom: 1px solid var(--color-border, #e2e8f0);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .modal-stocka-logo-light {
      display: inline-block;
    }
    .modal-stocka-logo-dark {
      display: none;
    }

    .client-billing-modal-subnav {
      display: flex;
      gap: 0.5rem;
      background: var(--color-surface, #ffffff);
      padding: 0.6rem 1.5rem 0.75rem 1.5rem;
      border-bottom: 1.5px solid var(--color-border, #e2e8f0);
      overflow-x: auto;
    }

    .client-billing-modal-tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--color-text-muted, #64748b);
      background: transparent;
      border: 1.5px solid transparent;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .client-billing-modal-tab-btn:hover {
      color: #5f06fa;
      background: rgba(95, 6, 250, 0.05);
    }

    .client-billing-modal-tab-btn.active {
      color: #5f06fa;
      background: rgba(95, 6, 250, 0.1);
      border-color: rgba(95, 6, 250, 0.3);
    }

    .client-billing-modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      background: var(--color-bg, #f1f5f9);
    }

    /* Ocultar elementos de administración o edición para clientes */
    .client-billing-modal-view .no-print,
    .client-billing-modal-view button.no-print {
      display: none !important;
    }

    .client-billing-modal-view {
      display: flex;
      justify-content: center;
      width: 100%;
    }

    /* === HOJA Y ELEMENTOS DEL DESGLOSE OFICIAL STOCKA === */
    .client-billing-modal-view .stocka-desglose-paper {
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.03);
      margin: 0 auto;
      width: 100%;
      max-width: 980px;
      background: #ffffff !important;
      color: #0f172a !important;
      border-radius: 14px;
      border: 1px solid #cbd5e1;
      padding: 2.5rem 3rem;
      box-sizing: border-box;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    [data-theme="dark"] .client-billing-modal-view .stocka-desglose-paper,
    html[data-theme="dark"] .client-billing-modal-view .stocka-desglose-paper {
      background: #ffffff !important;
      color: #0f172a !important;
    }

    .client-billing-modal-view .stocka-main-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid #e2e8f0;
      flex-wrap: wrap;
      gap: 1.25rem;
    }

    .client-billing-modal-view .stocka-entities-grid {
      display: flex;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
      width: 100%;
      box-sizing: border-box;
    }

    @media (max-width: 680px) {
      .client-billing-modal-view .stocka-entities-grid {
        flex-direction: column;
      }
    }

    .client-billing-modal-view .stocka-entity-card {
      flex: 1 1 0;
      width: 50%;
      min-width: 0;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
      box-sizing: border-box;
    }

    @media (max-width: 680px) {
      .client-billing-modal-view .stocka-entity-card {
        width: 100%;
      }
    }

    .client-billing-modal-view .stocka-entity-card-header {
      background: #5f06fa;
      color: #ffffff;
      padding: 0.5rem 0.85rem;
      font-size: 0.8rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .client-billing-modal-view .stocka-entity-body {
      padding: 0.75rem 0.85rem;
    }

    .client-billing-modal-view .stocka-entity-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
      padding: 0.35rem 0;
      border-bottom: 1px solid #f1f5f9;
    }

    .client-billing-modal-view .stocka-entity-row:last-child {
      border-bottom: none;
    }

    .client-billing-modal-view .stocka-metric-row {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      gap: 0.7rem;
      margin-bottom: 1.15rem;
      width: 100%;
    }

    @media (max-width: 720px) {
      .client-billing-modal-view .stocka-metric-row {
        flex-wrap: wrap;
      }
      .client-billing-modal-view .stocka-desglose-paper {
        padding: 1.5rem 1.25rem;
      }
    }

    .client-billing-modal-view .stocka-metric-card {
      flex: 1 1 0;
      min-width: 0;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-top: 3px solid #5f06fa;
      border-radius: 8px;
      padding: 0.7rem 0.85rem;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .client-billing-modal-view .stocka-metric-title {
      font-size: 0.67rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 0.28rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .client-billing-modal-view .stocka-metric-value {
      font-size: 1.22rem;
      font-weight: 800;
      color: #0f172a;
      font-family: 'Outfit', sans-serif;
      line-height: 1.15;
      white-space: nowrap;
    }

    .client-billing-modal-view .stocka-metric-sub {
      font-size: 0.71rem;
      color: #64748b;
      margin-top: 0.28rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .client-billing-modal-view .stocka-official-total-card {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #4338ca 100%);
      border-radius: 12px;
      padding: 1.5rem 2rem;
      color: #ffffff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.25rem;
      box-shadow: 0 4px 14px rgba(95, 6, 250, 0.25);
    }

    .client-billing-modal-view .stocka-table-official {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
      border: 1px solid #cbd5e1;
      font-size: 0.85rem;
      border-radius: 8px;
      overflow: hidden;
    }

    .client-billing-modal-view .stocka-table-official th {
      background: #5f06fa;
      color: #ffffff;
      padding: 0.75rem 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.5px;
      border: 1px solid #4e04cc;
    }

    .client-billing-modal-view .stocka-table-official td {
      padding: 0.7rem 0.85rem;
      border: 1px solid #e2e8f0;
      color: #1e293b;
      vertical-align: middle;
    }

    .client-billing-modal-view .stocka-table-official tr:nth-child(even) td {
      background: #f8fafc;
    }

    /* Modal Header y Subnav en Dark Mode */
    [data-theme="dark"] .client-billing-modal-container,
    html[data-theme="dark"] .client-billing-modal-container {
      background: #0f172a !important;
      border-color: #334155 !important;
    }
    [data-theme="dark"] .client-billing-modal-header,
    html[data-theme="dark"] .client-billing-modal-header {
      background: #1e293b !important;
      border-bottom-color: #334155 !important;
    }
    [data-theme="dark"] .client-billing-modal-header h3,
    html[data-theme="dark"] .client-billing-modal-header h3 {
      color: #f8fafc !important;
    }
    [data-theme="dark"] .client-billing-modal-header h3 span:first-child,
    html[data-theme="dark"] .client-billing-modal-header h3 span:first-child {
      color: #f8fafc !important;
    }
    [data-theme="dark"] .client-billing-modal-header p,
    html[data-theme="dark"] .client-billing-modal-header p {
      color: #94a3b8 !important;
    }
    [data-theme="dark"] .client-billing-modal-header p strong,
    html[data-theme="dark"] .client-billing-modal-header p strong {
      color: #cbd5e1 !important;
    }
    [data-theme="dark"] .client-billing-modal-subnav,
    html[data-theme="dark"] .client-billing-modal-subnav {
      background: #1e293b !important;
      border-bottom-color: #334155 !important;
    }
    [data-theme="dark"] .client-billing-modal-tab-btn,
    html[data-theme="dark"] .client-billing-modal-tab-btn {
      color: #94a3b8 !important;
    }
    [data-theme="dark"] .client-billing-modal-tab-btn:hover,
    html[data-theme="dark"] .client-billing-modal-tab-btn:hover {
      color: #c084fc !important;
      background: rgba(168, 85, 247, 0.12) !important;
    }
    [data-theme="dark"] .client-billing-modal-tab-btn.active,
    html[data-theme="dark"] .client-billing-modal-tab-btn.active {
      color: #c084fc !important;
      background: rgba(168, 85, 247, 0.2) !important;
      border-color: rgba(168, 85, 247, 0.45) !important;
    }
    [data-theme="dark"] .client-billing-modal-body,
    html[data-theme="dark"] .client-billing-modal-body {
      background: #0b1120 !important;
    }

    [data-theme="dark"] .modal-stocka-logo-light,
    html[data-theme="dark"] .modal-stocka-logo-light {
      display: none !important;
    }
    [data-theme="dark"] .modal-stocka-logo-dark,
    html[data-theme="dark"] .modal-stocka-logo-dark {
      display: inline-block !important;
    }

    /* Tabla interactiva de pedidos para clientes */
    .client-modal-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }

    .client-modal-table th {
      background: var(--color-surface-hover, #f8fafc);
      color: var(--color-text-muted, #475569);
      font-weight: 700;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--color-border, #e2e8f0);
      white-space: nowrap;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .client-modal-table th.th-total-order {
      background: #ede9fe;
      color: #5b21b6;
      border-color: #ddd6fe;
    }

    .client-modal-table td {
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--color-border, #e2e8f0);
      color: var(--color-text-main, #1e293b);
      vertical-align: middle;
      background: var(--color-surface, #ffffff);
    }

    .client-modal-table tr:nth-child(even) td {
      background: var(--color-bg, #f8fafc);
    }

    .client-modal-table tr:hover td {
      background: rgba(95, 6, 250, 0.04);
    }

    /* Celdas semánticas de pedidos */
    .cm-cell-num {
      text-align: center;
      font-weight: 700;
      color: var(--color-text-muted, #64748b);
    }
    .cm-cell-id {
      font-weight: 700;
      font-family: monospace;
      color: #5f06fa;
    }
    .cm-cell-date {
      white-space: nowrap;
      font-size: 0.75rem;
      color: var(--color-text-muted, #475569);
    }
    .cm-cell-agenda {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-text-main, #0f172a);
    }
    .cm-cell-agenda.empty {
      color: var(--color-text-muted, #94a3b8);
      font-weight: 500;
    }
    .cm-cell-dest {
      font-weight: 600;
      color: var(--color-text-main, #0f172a);
    }
    .cm-cell-op {
      font-size: 0.75rem;
      color: var(--color-text-muted, #475569);
    }
    .cm-delivery-badge {
      background: rgba(95, 6, 250, 0.08);
      color: #5f06fa;
      border: 1px solid rgba(95, 6, 250, 0.2);
      font-size: 0.72rem;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
      display: inline-block;
    }
    .cm-platform-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .cm-cell-qty {
      text-align: center;
      font-weight: 700;
      color: var(--color-text-main, #0f172a);
    }
    .cm-cell-money {
      text-align: right;
      font-weight: 700;
      color: var(--color-text-main, #0f172a);
    }
    .cm-cell-total {
      text-align: right;
      font-weight: 800;
      color: #5b21b6;
      background: rgba(95, 6, 250, 0.07);
    }

    /* === MODO OSCURO PARA TABLA TIPO EXCEL CLIENTE === */
    [data-theme="dark"] #client-modal-content-register > div,
    html[data-theme="dark"] #client-modal-content-register > div {
      background: #1e293b !important;
      border-color: #334155 !important;
    }
    [data-theme="dark"] #client-modal-content-register h4,
    html[data-theme="dark"] #client-modal-content-register h4 {
      color: #f8fafc !important;
    }
    [data-theme="dark"] #client-modal-content-register p,
    html[data-theme="dark"] #client-modal-content-register p {
      color: #94a3b8 !important;
    }
    [data-theme="dark"] #client-orders-filter-input,
    html[data-theme="dark"] #client-orders-filter-input {
      background: #0f172a !important;
      border-color: #334155 !important;
      color: #f8fafc !important;
    }
    [data-theme="dark"] #client-orders-filter-input::placeholder,
    html[data-theme="dark"] #client-orders-filter-input::placeholder {
      color: #64748b !important;
    }
    [data-theme="dark"] #client-orders-filter-count,
    html[data-theme="dark"] #client-orders-filter-count {
      color: #c084fc !important;
      background: rgba(168, 85, 247, 0.18) !important;
      border: 1px solid rgba(168, 85, 247, 0.35) !important;
    }
    [data-theme="dark"] #client-modal-content-register .client-modal-table-scroll,
    html[data-theme="dark"] #client-modal-content-register .client-modal-table-scroll {
      border-color: #334155 !important;
      background: #0f172a !important;
    }
    [data-theme="dark"] .client-modal-table th,
    html[data-theme="dark"] .client-modal-table th {
      background: #0f172a !important;
      color: #cbd5e1 !important;
      border-color: #334155 !important;
    }
    [data-theme="dark"] .client-modal-table th.th-total-order,
    html[data-theme="dark"] .client-modal-table th.th-total-order {
      background: rgba(168, 85, 247, 0.22) !important;
      color: #e9d5ff !important;
      border-color: rgba(168, 85, 247, 0.45) !important;
    }
    [data-theme="dark"] .client-modal-table td,
    html[data-theme="dark"] .client-modal-table td {
      border-color: #334155 !important;
      color: #e2e8f0 !important;
      background: #1e293b !important;
    }
    [data-theme="dark"] .client-modal-table tr:nth-child(even) td,
    html[data-theme="dark"] .client-modal-table tr:nth-child(even) td {
      background: #172236 !important;
    }
    [data-theme="dark"] .client-modal-table tr:hover td,
    html[data-theme="dark"] .client-modal-table tr:hover td {
      background: rgba(168, 85, 247, 0.14) !important;
    }
    [data-theme="dark"] .cm-cell-num,
    html[data-theme="dark"] .cm-cell-num {
      color: #94a3b8 !important;
    }
    [data-theme="dark"] .cm-cell-id,
    html[data-theme="dark"] .cm-cell-id {
      color: #c084fc !important;
    }
    [data-theme="dark"] .cm-cell-date,
    html[data-theme="dark"] .cm-cell-date {
      color: #cbd5e1 !important;
    }
    [data-theme="dark"] .cm-cell-agenda,
    html[data-theme="dark"] .cm-cell-agenda {
      color: #f8fafc !important;
    }
    [data-theme="dark"] .cm-cell-agenda.empty,
    html[data-theme="dark"] .cm-cell-agenda.empty {
      color: #64748b !important;
    }
    [data-theme="dark"] .cm-cell-dest,
    html[data-theme="dark"] .cm-cell-dest {
      color: #f8fafc !important;
    }
    [data-theme="dark"] .cm-cell-op,
    html[data-theme="dark"] .cm-cell-op {
      color: #cbd5e1 !important;
    }
    [data-theme="dark"] .cm-delivery-badge,
    html[data-theme="dark"] .cm-delivery-badge {
      background: rgba(168, 85, 247, 0.22) !important;
      color: #e9d5ff !important;
      border-color: rgba(168, 85, 247, 0.45) !important;
    }
    [data-theme="dark"] .cm-cell-qty,
    html[data-theme="dark"] .cm-cell-qty {
      color: #f8fafc !important;
    }
    [data-theme="dark"] .cm-cell-money,
    html[data-theme="dark"] .cm-cell-money {
      color: #f8fafc !important;
    }
    [data-theme="dark"] .cm-cell-total,
    html[data-theme="dark"] .cm-cell-total {
      color: #e9d5ff !important;
      background: rgba(168, 85, 247, 0.25) !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Garantiza que si una orden está marcada como Marketplace, su recargo sea estrictamente $100
 * (o tarifa configurada) y nunca $0, recalculando sus totales de preparación y pedido.
 */
export function sanitizeSnapshotOrdersMarketplace(snapshot, config = null) {
  if (!snapshot || !Array.isArray(snapshot.orders)) return;
  const cfg = config || billingState.pricingConfig;
  const mktRate = (cfg?.pick_pack_rules?.surcharge_marketplace_collect) || 100;
  const posBaseRate = (cfg?.services?.showroom_sale_base) || (cfg?.shipping?.pickup_express_base) || 1490;
  const customCols = Array.isArray(snapshot.customColumns) ? snapshot.customColumns : [];
  let changed = false;

  snapshot.orders.forEach(o => {
    const customTotal = computeOrderCustomSurchargesTotal(o, customCols);
    const isPos = isPosSaleOrder(o);
    o.categoriaEntrega = resolveOrderBillingCategoria(o);

    if (isPos) {
      let posChanged = false;
      if (!o.isPosOrder) {
        o.isPosOrder = true;
        posChanged = true;
      }
      if (o.platform !== 'Punto de Venta (POS)') {
        o.platform = 'Punto de Venta (POS)';
        o.externalPlatform = 'Punto de Venta (POS)';
      }
      if (!o.baseRateManual && o.baseRate !== posBaseRate) {
        o.baseRate = posBaseRate;
        posChanged = true;
      }
      if (!o.shippingFreightManual && (o.shippingFreight || 0) !== 0) {
        o.shippingFreight = 0;
        posChanged = true;
      }
      if (!o.deliveryType || o.deliveryType === 'RETIRO' || o.deliveryType === 'ENVIAME_REGION' || o.deliveryType === 'OTHER') {
        o.deliveryType = 'POS';
      }
      if (posChanged) {
        o.pickPackTotal = (o.baseRate || 0) + (o.surchargeSku || 0) + (o.surchargeUnits || 0) + (o.surchargeMarketplace || 0) + customTotal;
        o.orderTotal = o.pickPackTotal + (o.shippingFreight || 0);
        changed = true;
      }
    }

    if (!o.surchargeMarketplaceManual && o.isMarketplace && (!o.surchargeMarketplace || o.surchargeMarketplace === 0)) {
      o.surchargeMarketplace = mktRate;
      o.pickPackTotal = (o.baseRate || 0) + (o.surchargeSku || 0) + (o.surchargeUnits || 0) + o.surchargeMarketplace + customTotal;
      o.orderTotal = o.pickPackTotal + (o.shippingFreight || 0);
      changed = true;
    } else if (!o.surchargeMarketplaceManual && !o.isMarketplace && o.surchargeMarketplace > 0) {
      o.surchargeMarketplace = 0;
      o.pickPackTotal = (o.baseRate || 0) + (o.surchargeSku || 0) + (o.surchargeUnits || 0) + customTotal;
      o.orderTotal = o.pickPackTotal + (o.shippingFreight || 0);
      changed = true;
    } else if (customCols.length > 0 && o.customSurchargesTotal !== customTotal) {
      o.pickPackTotal = (o.baseRate || 0) + (o.surchargeSku || 0) + (o.surchargeUnits || 0) + (o.surchargeMarketplace || 0) + customTotal;
      o.orderTotal = o.pickPackTotal + (o.shippingFreight || 0);
      changed = true;
    }
  });

  // Si el snapshot tiene volumen manual fijado, garantizar que dailyStorageLogs y volumeStats sean constantes a lo largo del tiempo
  const isSnapManualVol = !!(snapshot.isManualVolume || snapshot.totals?.isManualVolume || snapshot.volumeStats?.isManualVolume);
  if (isSnapManualVol) {
    const fixedVol = Number((parseFloat(snapshot.volumeM3) || 0).toFixed(2));
    let snapYear = snapshot.currentPeriodYear;
    let snapMonth = snapshot.currentPeriodMonth;
    if ((!snapYear || !snapMonth) && Array.isArray(snapshot.dailyStorageLogs) && snapshot.dailyStorageLogs.length > 0) {
      const parts = String(snapshot.dailyStorageLogs[0].date || '').split('-');
      if (parts.length >= 2) {
        snapYear = parseInt(parts[0], 10);
        snapMonth = parseInt(parts[1], 10);
      }
    }
    snapYear = snapYear || new Date().getFullYear();
    snapMonth = snapMonth || (new Date().getMonth() + 1);
    const constLogs = generateConstantDailyStorageLogs(snapYear, snapMonth, fixedVol);
    snapshot.isManualVolume = true;
    snapshot.dailyStorageLogs = constLogs;
    snapshot.volumeDaysLogged = constLogs.length;
    snapshot.volumeStats = {
      ...(snapshot.volumeStats || {}),
      averageM3: fixedVol,
      minDailyVolume: fixedVol,
      maxDailyVolume: fixedVol,
      daysLogged: constLogs.length,
      isManualVolume: true
    };
    if (snapshot.totals) {
      snapshot.totals.isManualVolume = true;
    }
  }

  // Deduplicar childPosConfigs si vinieran con variantes mayúsculas/minúsculas en el snapshot
  if (snapshot.commerceInfo && Array.isArray(snapshot.commerceInfo.childPosConfigs)) {
    const seenPos = new Set();
    snapshot.commerceInfo.childPosConfigs = snapshot.commerceInfo.childPosConfigs.filter(c => {
      const stUp = String(c?.store || '').trim().toUpperCase();
      if (!stUp || seenPos.has(stUp)) return false;
      seenPos.add(stUp);
      c.store = stUp;
      return true;
    });
  }

  // Normalizar cobro POS si el snapshot tenía multiplicación por tiendas (ej: 1,2 UF en lugar de 0,2 UF único por comercio/conglomerado)
  if (snapshot.totals) {
    const defaultPosUf = (cfg?.services?.pos_monthly_uf || cfg?.pos_service_fee?.monthly_fee_uf || 0.2);
    const posDetStr = String(snapshot.totals.posFeeDetails || '');
    const isMultipliedLegacyPos = Boolean(
      posDetStr.includes('tienda(s)') ||
      (snapshot.totals.posFeeUF > defaultPosUf && posDetStr.includes('Habilitación POS'))
    );
    if (isMultipliedLegacyPos) {
      const ufVal = Number(snapshot.ufValue || billingState.ufValue || 41065);
      snapshot.totals.posFeeUF = defaultPosUf;
      snapshot.totals.posFeeNet = Math.round(defaultPosUf * ufVal);
      const activeChildPos = (snapshot.commerceInfo?.childPosConfigs || []).filter(c => c.posConfig?.active === true);
      if (activeChildPos.length > 0) {
        const childDetails = activeChildPos.map(c => {
          const m = c.posConfig;
          const ownerLabel = m.isStockaMachine ? 'Máquina STOCKA' : 'Máquina Propia';
          const parts = [m.brand, m.model ? '#' + m.model : '', m.color ? '(' + m.color + ')' : ''].filter(Boolean).join(' ');
          return `${String(c.store || '').trim().toUpperCase()}: ${ownerLabel}${parts ? ` [${parts}]` : ''}`;
        }).join('; ');
        snapshot.totals.posFeeDetails = `Habilitación mensual POS (${formatDec(defaultPosUf, 1)} UF) @ ${formatCLP(ufVal)}/UF (${childDetails})`;
      } else {
        const parenMatch = posDetStr.match(/\(([^@]+)\)\s*@/);
        if (parenMatch && parenMatch[1]) {
          const seenSeg = new Set();
          const uniqueSegs = parenMatch[1].split(';').map(s => s.trim()).filter(s => {
            const storePart = (s.split(':')[0] || '').trim().toUpperCase();
            if (!storePart || seenSeg.has(storePart)) return false;
            seenSeg.add(storePart);
            return true;
          }).map(s => {
            const idx = s.indexOf(':');
            return idx > 0 ? `${s.slice(0, idx).trim().toUpperCase()}:${s.slice(idx + 1)}` : s;
          });
          snapshot.totals.posFeeDetails = `Habilitación mensual POS (${formatDec(defaultPosUf, 1)} UF) @ ${formatCLP(ufVal)}/UF (${uniqueSegs.join('; ')})`;
        } else {
          snapshot.totals.posFeeDetails = `Habilitación mensual POS (${formatDec(defaultPosUf, 1)} UF) @ ${formatCLP(ufVal)}/UF`;
        }
      }
      changed = true;
    }
  }

  // Calcular Cobro de Etiqueta FULL de MELI ($100 por producto en pedidos con agenda FULL MERCADOLIBRE)
  const billable = snapshot.orders.filter(o => !o.isExcluded);
  const fullMeliOrders = billable.filter(o => isFullMeliOrder(o));
  const meliFullUnitsCount = fullMeliOrders.reduce((sum, o) => sum + (Math.max(1, parseInt(o.unitsCount, 10) || 1)), 0);
  const meliFullRate = 100;
  const meliFullNet = meliFullUnitsCount * meliFullRate;

  if (snapshot.totals) {
    const prevMeliNet = snapshot.totals.meliFullNet !== undefined ? snapshot.totals.meliFullNet : null;
    snapshot.totals.meliFullOrdersCount = fullMeliOrders.length;
    snapshot.totals.meliFullUnitsCount = meliFullUnitsCount;
    snapshot.totals.meliFullRate = meliFullRate;
    snapshot.totals.meliFullNet = meliFullNet;

    // Si cambió marketplace O si el snapshot no tenía meliFullNet registrado o difiere
    if (changed || prevMeliNet === null || prevMeliNet !== meliFullNet) {
      const storageNet = snapshot.totals.storageNet || 0;
      snapshot.totals.pickPackNet = billable.reduce((acc, o) => acc + (o.pickPackTotal || 0), 0);
      const shippingNet = snapshot.totals.shippingRmFlexNet || 0;
      const inboundNet = snapshot.totals.inboundNet || 0;
      const fixedFeeNet = snapshot.totals.fixedFeeNet || 0;
      const posFeeNet = snapshot.totals.posFeeNet || 0;
      const suppliesNet = Array.isArray(snapshot.supplies) ? snapshot.supplies.reduce((acc, s) => acc + (s.total || 0), 0) : 0;
      const adjustmentsNet = Array.isArray(snapshot.adjustments) ? snapshot.adjustments.reduce((acc, a) => acc + (a.amount || 0), 0) : 0;
      const totalAbonos = Array.isArray(snapshot.abonos) ? snapshot.abonos.reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0) : (snapshot.totals.totalAbonos || 0);
      snapshot.totals.totalNet = Math.round(storageNet + snapshot.totals.pickPackNet + shippingNet + inboundNet + fixedFeeNet + posFeeNet + suppliesNet + adjustmentsNet + meliFullNet);
      snapshot.totals.iva = Math.round(snapshot.totals.totalNet * 0.19);
      snapshot.totals.totalGross = snapshot.totals.totalNet + snapshot.totals.iva;
      snapshot.totals.totalAbonos = totalAbonos;
      snapshot.totals.totalToPay = Math.max(0, snapshot.totals.totalGross - totalAbonos);
    }
  }
}

async function enrichSnapshotWithPosAbonosIfNeeded(snapshot) {
  if (!snapshot) return;
  try {
    const commName = snapshot.comercio || '';
    const periodName = snapshot.periodName || snapshot.currentPeriodName || '';
    if (!commName || !periodName) return;

    const childStores = (Array.isArray(snapshot.conglomerateChildren) && snapshot.conglomerateChildren.length > 0)
      ? snapshot.conglomerateChildren
      : Array.from(new Set((snapshot.orders || []).map(o => (o.comercio || '').trim()).filter(Boolean)));
    const commGroup = {
      billingEntity: commName,
      isConglomerate: Boolean(snapshot.isConglomerate || childStores.length > 1),
      children: childStores.length > 0 ? childStores : [commName]
    };

    const posRes = await fetchAndComputePosSalesAbonoForBilling(
      commGroup,
      periodName,
      billingState.pricingConfig,
      snapshot.orders || []
    );
    if (posRes && Array.isArray(posRes.periodAbonoSales)) {
      snapshot.posAbonoSales = posRes.periodAbonoSales;
      snapshot.posAbonoSummary = posRes.summary;
      snapshot.allMerchantPosSales = posRes.allSales;
      if (!snapshot.posAbonoExcludedManually) {
        syncPosAbonoIntoBillingState(snapshot);
        if (snapshot.totals) {
          const totalAbonos = Array.isArray(snapshot.abonos)
            ? snapshot.abonos.reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0)
            : (snapshot.totals.totalAbonos || 0);
          snapshot.totals.totalAbonos = totalAbonos;
          snapshot.totals.totalToPay = Math.max(0, (snapshot.totals.totalGross || 0) - totalAbonos);
        }
      }
    }
  } catch (err) {
    console.warn('[BillingGenerator] Error enriqueciendo snapshot con abonos POS:', err);
  }
}

// Abrir el Modal Interactivo para el Cliente (Desglose, Registro, Métricas)
export async function openClientInteractiveBillingModal(recordId, initialTab = 'desglose') {
  injectBillingGeneratorStyles();
  injectClientInteractiveModalStyles();

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Cargando Facturación...',
      text: 'Obteniendo datos interactivos y métricas del periodo...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });
  }

  let rec = null;
  try {
    const { data, error } = await supabase
      .from('billing_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (error) throw error;
    rec = data;
  } catch (err) {
    console.error('Error obteniendo billing_record:', err);
    if (typeof Swal !== 'undefined') Swal.fire('Error', 'No se pudo cargar el registro de facturación.', 'error');
    return;
  }

  if (!rec) {
    if (typeof Swal !== 'undefined') Swal.fire('Atención', 'Registro de facturación no encontrado.', 'warning');
    return;
  }

  // 1. Obtener snapshot oficial desde Supabase Storage (fulfillment_link) o cache local validado
  const cacheKey = `stocka_fulfillment_details_${rec.period_id}_${rec.comercio}`;
  let cached = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch (e) {}

  let snapshot = null;
  const recUpdatedTime = rec.updated_at ? new Date(rec.updated_at).getTime() : 0;
  const cachedTime = cached ? new Date(cached.publishedAt || cached.generatedAt || 0).getTime() : 0;
  const cachedLink = cached?.fulfillment_link || '';

  // El cache local es válido únicamente si coincide con el enlace publicado oficial, el monto facturado y su vigencia
  const isCacheUpToDate = cached && 
    (!rec.fulfillment_link || cachedLink === rec.fulfillment_link) &&
    (rec.total_fulfillment === undefined || rec.total_fulfillment === null || cached.totals?.totalGross === rec.total_fulfillment) &&
    (!recUpdatedTime || cachedTime >= (recUpdatedTime - 5000));

  if (isCacheUpToDate) {
    snapshot = cached;
  } else if (cached) {
    console.log('[BillingGenerator] Cache local desactualizado detectado. Se forzará descarga de versión oficial de la nube.', {
      cacheTotal: cached.totals?.totalGross,
      dbTotal: rec.total_fulfillment,
      cacheLink: cachedLink,
      dbLink: rec.fulfillment_link
    });
    try { localStorage.removeItem(cacheKey); } catch (e) {}
  }

  // Descargar el snapshot oficial de Storage si no hay snapshot o el local está desactualizado respecto a la DB
  if (!snapshot && rec.fulfillment_link && (rec.fulfillment_link.startsWith('http://') || rec.fulfillment_link.startsWith('https://'))) {
    try {
      const fetchUrl = rec.fulfillment_link + (rec.fulfillment_link.includes('?') ? '&' : '?') + 't=' + Date.now();
      const resp = await fetch(fetchUrl, { cache: 'no-store' });
      if (resp.ok) {
        snapshot = await resp.json();
        snapshot.fulfillment_link = rec.fulfillment_link;
        try { localStorage.setItem(cacheKey, JSON.stringify(snapshot)); } catch (e) {}
      }
    } catch (fetchErr) {
      console.warn('Error al descargar snapshot JSON de Storage:', fetchErr);
    }
  }

  // Fallback de contingencia ante falla de conectividad
  if (!snapshot && cached) {
    console.warn('[BillingGenerator] Usando cache local como fallback de contingencia');
    snapshot = cached;
  }

  // Fallback si no hay snapshot (registro tradicional no interactivo)
  if (!snapshot) {
    if (typeof Swal !== 'undefined') Swal.close();
    if (rec.fulfillment_link) {
      window.open(rec.fulfillment_link, '_blank');
      return;
    }
    if (typeof Swal !== 'undefined') {
      Swal.fire('Atención', 'No hay detalle interactivo cargado para este registro.', 'info');
    }
    return;
  }

  // Garantizar que recargos Marketplace y totales sean consistentes
  sanitizeSnapshotOrdersMarketplace(snapshot);

  // Asegurar detección de conglomerado y desglose por tienda en snapshots
  if (!snapshot.isConglomerate && snapshot.orders && snapshot.orders.length > 0) {
    const distinctStores = Array.from(new Set(snapshot.orders.map(o => (o.comercio || '').trim()).filter(Boolean)));
    if (distinctStores.length > 1) {
      snapshot.isConglomerate = true;
      if (!snapshot.conglomerateChildren || snapshot.conglomerateChildren.length === 0) {
        snapshot.conglomerateChildren = distinctStores;
      }
    }
  }

  if (snapshot.isConglomerate) {
    if (snapshot.orders && snapshot.orders.length > 0) {
      snapshot.storeBreakdown = computeConglomerateStoreBreakdown(snapshot.orders, snapshot);
    } else if (Array.isArray(snapshot.storeBreakdown) && snapshot.storeBreakdown.length > 0) {
      const totalOpNet = snapshot.storeBreakdown.reduce((sum, s) => sum + (Number(s.storeTotalNet) || 0), 0);
      if (totalOpNet > 0) {
        snapshot.storeBreakdown = snapshot.storeBreakdown.map(s => ({
          ...s,
          sharePct: parseFloat((((Number(s.storeTotalNet) || 0) / totalOpNet) * 100).toFixed(1))
        }));
      }
    }
  }

  // Enriquecer y sincronizar datos legales del cliente (RUT, Razón Social, Sigla)
  const commName = snapshot.comercio || rec.comercio;
  if (!snapshot.commerceInfo) snapshot.commerceInfo = {};

  try {
    const fetchedLegal = await getCommerceBillingInfo(commName);
    if (fetchedLegal) {
      if ((!snapshot.commerceInfo.rut || snapshot.commerceInfo.rut === '—') && fetchedLegal.rut && fetchedLegal.rut !== '—') {
        snapshot.commerceInfo.rut = fetchedLegal.rut;
      }
      if ((!snapshot.commerceInfo.razonSocial || snapshot.commerceInfo.razonSocial === commName) && fetchedLegal.razonSocial) {
        snapshot.commerceInfo.razonSocial = fetchedLegal.razonSocial;
      }
      if ((!snapshot.commerceInfo.sigla || snapshot.commerceInfo.sigla === '—') && fetchedLegal.sigla && fetchedLegal.sigla !== '—') {
        snapshot.commerceInfo.sigla = fetchedLegal.sigla;
      }
    }
  } catch (e) {}

  try {
    const localLegalStr = localStorage.getItem(`stocka_commerce_legal_${commName}`);
    if (localLegalStr) {
      const localLegal = JSON.parse(localLegalStr);
      if (localLegal.razonSocial) snapshot.commerceInfo.razonSocial = localLegal.razonSocial;
      if (localLegal.rut && localLegal.rut !== '—') snapshot.commerceInfo.rut = localLegal.rut;
      if (localLegal.sigla && localLegal.sigla !== '—') snapshot.commerceInfo.sigla = localLegal.sigla;
    }
  } catch (e) {}

  await enrichSnapshotWithPosAbonosIfNeeded(snapshot);

  try {
    localStorage.setItem(cacheKey, JSON.stringify(snapshot));
  } catch (e) {}

  if (typeof Swal !== 'undefined') Swal.close();

  // Enriquecer pedidos con referencia de origen y plataforma si no vinieran en el snapshot
  if (snapshot.orders && Array.isArray(snapshot.orders)) {
    const needsOrderEnrichment = snapshot.orders.some(o => !o.platform || !o.orderNumber || o.orderNumber === o.id.slice(0, 8));
    if (needsOrderEnrichment) {
      try {
        const orderIds = snapshot.orders.map(o => o.id);
        const BATCH_SIZE = 120;
        let dbOrders = [];
        for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
          const chunk = orderIds.slice(i, i + BATCH_SIZE);
          const { data: chunkData, error: chunkErr } = await supabase
            .from('orders')
            .select('id, external_order_number, external_platform, shopify_name:raw_shopify_data->>name, shopify_order_num:raw_shopify_data->>order_number')
            .in('id', chunk);
          if (!chunkErr && chunkData) {
            dbOrders = dbOrders.concat(chunkData);
          }
        }
        if (dbOrders && dbOrders.length > 0) {
          const oMap = {};
          dbOrders.forEach(dbo => { oMap[dbo.id] = dbo; });
          snapshot.orders.forEach(o => {
            const dbo = oMap[o.id];
            if (dbo) {
              const plat = dbo.external_platform || (dbo.shopify_name || dbo.shopify_order_num ? 'Shopify' : 'Manual');
              o.platform = o.platform || plat;
              o.externalPlatform = o.externalPlatform || plat;
              const refNum = dbo.external_order_number || dbo.shopify_name || (dbo.shopify_order_num ? `#${dbo.shopify_order_num}` : null);
              if (refNum) {
                o.orderNumber = refNum;
                o.externalOrderNumber = refNum;
              }
            }
          });
        }
      } catch (err) {
        console.warn('Error enriqueciendo pedidos con plataforma/referencia:', err);
      }
    }
  }

  // Marcar modo cliente
  snapshot.isClientView = true;
  window.__currentClientBillingSnapshot = snapshot;
  window.__currentClientBillingRecord = rec;

  // Renderizar o reutilizar el contenedor del modal
  let modalOverlay = document.getElementById('client-billing-interactive-modal');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'client-billing-interactive-modal';
    modalOverlay.className = 'client-billing-modal-overlay';
    document.body.appendChild(modalOverlay);

    // Cerrar al hacer clic en el backdrop
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) window.closeClientInteractiveBillingModal();
    });

    // Cerrar con Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalOverlay.style.display !== 'none') {
        window.closeClientInteractiveBillingModal();
      }
    });
  }

  const totals = snapshot.totals || {};
  const orders = snapshot.orders || [];
  const customCols = Array.isArray(snapshot.customColumns) ? snapshot.customColumns : [];
  const childStores = (snapshot.conglomerateChildren && snapshot.conglomerateChildren.length > 0)
    ? snapshot.conglomerateChildren
    : Array.from(new Set(orders.map(o => (o.comercio || '').trim()).filter(Boolean)));
  const isConglomerateRecord = Boolean(snapshot.isConglomerate || childStores.length > 1);

  modalOverlay.innerHTML = `
    <div class="client-billing-modal-container">
      <!-- Modal Header -->
      <div class="client-billing-modal-header">
        <div style="display: flex; align-items: center; gap: 0.85rem;">
          <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka" class="modal-stocka-logo-light" style="height: 34px; width: auto; object-fit: contain;">
          <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/Stocka_1300_x_500_px_519_x_200_px_5.png?v=1779650350" alt="Stocka" class="modal-stocka-logo-dark" style="height: 34px; width: auto; object-fit: contain;">
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--color-text-main, #0f172a); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span>Facturación Fulfillment 360</span>
              <span style="font-size: 0.75rem; background: rgba(95, 6, 250, 0.1); color: #5f06fa; padding: 2px 8px; border-radius: 50px; font-weight: 800;">${escapeHtml(snapshot.comercio)}</span>
              ${snapshot.version ? `
                <span style="font-size: 0.72rem; background: rgba(16, 185, 129, 0.12); color: #047857; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 8px; border-radius: 50px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px;" title="Versión oficial publicada">
                  <i class="ri-git-commit-line"></i> v${snapshot.version}
                </span>
              ` : ''}
            </h3>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.775rem; color: var(--color-text-muted, #64748b);">
              Periodo: <strong>${escapeHtml(snapshot.periodName || '')}</strong> • 
              ${snapshot.publishedAt ? `Publicado: <strong>${new Date(snapshot.publishedAt).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong> • ` : ''}
              ${(totals.totalAbonos > 0)
                ? `Monto a Facturar: <strong>${formatCLP(totals.totalGross || 0)}</strong> • Abonos: <strong style="color: #10b981;">-${formatCLP(totals.totalAbonos)}</strong> • Monto a Pagar: <strong style="color: #5f06fa; font-size: 0.88rem;">${formatCLP(totals.totalToPay || 0)}</strong> (IVA incl.)`
                : `Total a Facturar / Pagar: <strong style="color: #5f06fa; font-size: 0.85rem;">${formatCLP(totals.totalGross || totals.totalToPay || rec.total_fulfillment || 0)}</strong> (IVA incl.)`}
            </p>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" onclick="window.downloadClientBillingPdf('${rec.id}')" style="border-color: #ef4444; color: #ef4444; font-weight: 700; height: 34px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;" title="Descargar Desglose Oficial en formato PDF">
            <i class="ri-file-pdf-fill"></i> Descargar PDF
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.downloadClientBillingExcel('${rec.id}')" style="border-color: #10b981; color: #10b981; font-weight: 700; height: 34px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;" title="Descargar Planilla Excel Completa con Auditoría">
            <i class="ri-file-excel-2-fill"></i> Descargar Excel (.xlsx)
          </button>
          <div style="height: 24px; width: 1px; background: var(--color-border, #e2e8f0); margin: 0 0.35rem;"></div>
          <button type="button" class="client-modal-close-btn" onclick="window.closeClientInteractiveBillingModal()" style="background: var(--color-bg, #f1f5f9); border: 1.5px solid var(--color-border, #cbd5e1); cursor: pointer; color: var(--color-text-muted, #64748b); width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 1.35rem; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.05);" title="Cerrar ventana" onmouseover="this.style.background='#e2e8f0'; this.style.color='#0f172a'" onmouseout="this.style.background='var(--color-bg, #f1f5f9)'; this.style.color='var(--color-text-muted, #64748b)'">
            <i class="ri-close-line"></i>
          </button>
        </div>
      </div>

      <!-- Subnav de Pestañas -->
      <div class="client-billing-modal-subnav">
        <button type="button" id="client-modal-tab-btn-desglose" class="client-billing-modal-tab-btn active" onclick="window.switchClientBillingTab('desglose')">
          <i class="ri-file-list-3-fill" style="color: #5f06fa;"></i> Desglose Oficial Stocka
        </button>
        <button type="button" id="client-modal-tab-btn-register" class="client-billing-modal-tab-btn" onclick="window.switchClientBillingTab('register')">
          <i class="ri-table-fill" style="color: #10b981;"></i> Registro de Pedidos (Excel)
          <span style="background: rgba(16, 185, 129, 0.12); color: #10b981; font-size: 0.7rem; padding: 1px 6px; border-radius: 10px; font-weight: 800;">${orders.length}</span>
        </button>
        <button type="button" id="client-modal-tab-btn-analytics" class="client-billing-modal-tab-btn" onclick="window.switchClientBillingTab('analytics')">
          <i class="ri-bar-chart-2-fill" style="color: #0284c7;"></i> Métricas y Gráficas
        </button>
      </div>

      <!-- Body con Contenedores de las 3 Pestañas -->
      <div class="client-billing-modal-body">
        <!-- 1. Pestaña Desglose Oficial -->
        <div id="client-modal-content-desglose" style="display: block;">
          <div class="client-billing-modal-view">
            ${renderStockaDesgloseHTML(snapshot)}
          </div>
        </div>

        <!-- 2. Pestaña Registro de Pedidos tipo Excel -->
        <div id="client-modal-content-register" style="display: none;">
          <div style="background: var(--color-surface, #ffffff); border: 1px solid var(--color-border, #e2e8f0); border-radius: 12px; padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
              <div>
                <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--color-text-main, #0f172a); display: flex; align-items: center; gap: 0.4rem;">
                  <i class="ri-file-excel-line" style="color: #10b981;"></i> Registro Oficial de Pedidos Despachados
                </h4>
                <p style="margin: 0.2rem 0 0 0; font-size: 0.775rem; color: var(--color-text-muted, #64748b);">
                  Auditoría completa de todas las órdenes procesadas en el periodo con sus recargos y fletes itemizados.
                </p>
              </div>

              <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                ${isConglomerateRecord ? `
                  <div style="display: flex; align-items: center; gap: 6px; position: relative;">
                    <select id="client-orders-store-filter" class="form-select" onchange="window.filterClientOrdersTable(true)" style="height: 36px; font-size: 0.8rem; margin: 0; padding: 0.35rem 0.75rem; border-radius: 8px; border: 1.5px solid rgba(95,6,250,0.35); background: var(--color-surface, #ffffff); color: var(--color-text-main, #0f172a); font-weight: 700; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.05); max-width: 230px;">
                      <option value="">🏢 Todas las Tiendas (${orders.length})</option>
                      ${childStores.map(st => {
                        const count = orders.filter(o => (o.comercio || '').toUpperCase() === st.toUpperCase()).length;
                        const isSel = (snapshot.activeConglomerateStoreFilter && snapshot.activeConglomerateStoreFilter.toUpperCase() === st.toUpperCase()) ? 'selected' : '';
                        return `<option value="${escapeHtml(st)}" ${isSel}>🏪 ${escapeHtml(st)} (${count})</option>`;
                      }).join('')}
                    </select>
                    <span id="client-orders-store-spinner" style="display: none; color: #5f06fa; font-size: 1.15rem; align-items: center;" title="Cargando comercio...">
                      <i class="ri-loader-4-line ri-spin"></i>
                    </span>
                  </div>
                ` : ''}

                <div style="position: relative;">
                  <input type="text" id="client-orders-filter-input" class="form-input" placeholder="Buscar por N° Pedido, Plataforma, Comuna u Operador..." style="height: 36px; font-size: 0.8rem; margin: 0; width: 260px; padding-left: 2rem; border-radius: 8px;" oninput="window.filterClientOrdersTable(false)">
                  <i class="ri-search-line" style="position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted, #94a3b8);"></i>
                </div>
                <span id="client-orders-filter-count" style="font-size: 0.75rem; font-weight: 700; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 5px 10px; border-radius: 6px; white-space: nowrap;">
                  Mostrando ${orders.length} pedidos
                </span>
              </div>
            </div>

            <div class="client-modal-table-scroll" style="overflow-x: auto; max-height: 60vh; border: 1px solid var(--color-border, #e2e8f0); border-radius: 8px;">
              <table class="client-modal-table" id="client-modal-orders-grid">
                <thead>
                  <tr>
                    <th style="width: 40px; text-align: center;">N°</th>
                    <th style="min-width: 140px;">Ref. Pedido</th>
                    <th style="min-width: 120px; text-align: center;">Plataforma</th>
                    <th style="min-width: 125px; text-align: center;">Categoría</th>
                    <th style="min-width: 95px;">Fecha</th>
                    <th style="min-width: 120px;">Agenda</th>
                    <th style="min-width: 160px;">Destino / Comuna</th>
                    <th style="min-width: 110px;">Operador</th>
                    <th style="min-width: 130px;">Tipo Entrega</th>
                    <th style="width: 70px; min-width: 65px; text-align: center;">SKUs</th>
                    <th style="width: 70px; min-width: 65px; text-align: center;">Unid.</th>
                    ${customCols.map(cc => `<th style="width: 95px; text-align: right;">${escapeHtml(cc.name)}</th>`).join('')}
                    <th style="width: 95px; text-align: right;">Prep. Total</th>
                    <th style="width: 95px; text-align: right;">Flete Envío</th>
                    <th class="th-total-order" style="width: 105px; text-align: right;">Total Pedido</th>
                  </tr>
                </thead>
                <tbody id="client-modal-orders-body">
                  ${orders.map((o, idx) => {
                    const refDisplay = o.orderNumber || o.externalOrderNumber || (o.id ? o.id.slice(0, 8) : '—');
                    const isOrderPos = Boolean(o.isPosOrder || isPosSaleOrder(o));
                    const platformName = isOrderPos ? 'Punto de Venta (POS)' : (o.platform || o.externalPlatform || (o.isMarketplace ? 'Marketplace' : 'Shopify'));
                    const deliveryLabel = isOrderPos ? 'Punto de Venta (POS)' : (o.deliveryType || 'Estándar');
                    return `
                    <tr class="client-modal-order-row" data-comercio="${escapeHtml((o.comercio || '').toUpperCase())}">
                      <td class="cm-cell-num">${idx + 1}</td>
                      <td class="cm-cell-id">
                        <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                          <span style="font-weight: 800; font-size: 0.85rem; color: #a855f7;">${escapeHtml(refDisplay)}</span>
                          ${isOrderPos ? `
                            <span class="bg-order-pos-badge" title="Venta realizada en Punto de Venta físico">
                              <i class="ri-store-3-fill"></i> PUNTO DE VENTA
                            </span>
                          ` : ''}
                          ${snapshot.isConglomerate && o.comercio ? `
                            <span class="bg-order-child-store-badge" title="Tienda: ${escapeHtml(o.comercio)}">
                              <i class="ri-store-2-line"></i> ${escapeHtml(o.comercio)}
                            </span>
                          ` : ''}
                        </div>
                        <div style="font-size: 0.68rem; color: var(--color-text-muted); font-family: monospace; font-weight: 500;" title="ID WMS: ${escapeHtml(o.id || '')}">
                          ${escapeHtml((o.id || '').slice(0, 13))}...
                        </div>
                      </td>
                      <td style="text-align: center;">
                        ${getPlatformBadgeHTML(platformName)}
                      </td>
                      <td style="text-align: center; white-space: nowrap;">
                        ${getBillingOrderCategoriaBadgeHTML(o)}
                      </td>
                      <td class="cm-cell-date">${escapeHtml(o.date || '—')}</td>
                      <td class="cm-cell-agenda ${o.agenda ? '' : 'empty'}">${escapeHtml(o.agenda || 'Sin agenda')}</td>
                      <td class="cm-cell-dest">${escapeHtml(o.destination || 'Santiago')}</td>
                      <td class="cm-cell-op">${escapeHtml(o.operador || (isOrderPos ? 'POS Sucursal' : '—'))}</td>
                      <td>
                        <span class="cm-delivery-badge">
                          ${escapeHtml(deliveryLabel)}
                        </span>
                      </td>
                      <td class="cm-cell-qty">${o.skuCount || 1}</td>
                      <td class="cm-cell-qty">${o.unitsCount || 1}</td>
                      ${customCols.map(cc => {
                        const val = (o.customSurcharges && o.customSurcharges[cc.id] !== undefined)
                          ? (Number(o.customSurcharges[cc.id]) || 0)
                          : calculateCustomColumnRuleAmount(cc, o);
                        return `<td class="cm-cell-money">${formatCLP(val)}</td>`;
                      }).join('')}
                      <td class="cm-cell-money">${formatCLP(o.pickPackTotal || 0)}</td>
                      <td class="cm-cell-money">${formatCLP(o.shippingFreight || 0)}</td>
                      <td class="cm-cell-total">${formatCLP(o.orderTotal || 0)}</td>
                    </tr>
                    `;
                  }).join('') || `<tr><td colspan="${14 + customCols.length}" style="text-align: center; padding: 2rem; color: #94a3b8;">No se registraron pedidos en el periodo.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 3. Pestaña Métricas y Gráficas -->
        <div id="client-modal-content-analytics" style="display: none;">
          <div id="client-modal-analytics-mount">
            <!-- Cargado dinámicamente con Chart.js -->
          </div>
        </div>
      </div>
    </div>
  `;

  modalOverlay.style.display = 'flex';

  // Activar la pestaña solicitada
  window.switchClientBillingTab(initialTab);
}

// Alternar entre las pestañas del modal interactivo
export function switchClientBillingTab(tabKey) {
  const tabs = ['desglose', 'register', 'analytics'];
  tabs.forEach(t => {
    const btn = document.getElementById(`client-modal-tab-btn-${t}`);
    const content = document.getElementById(`client-modal-content-${t}`);
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

  if (tabKey === 'analytics') {
    if (window.__currentClientBillingSnapshot) {
      try {
        renderBillingAnalyticsCharts('client-modal-analytics-mount', window.__currentClientBillingSnapshot);
      } catch (e) {
        console.warn('Error renderizando analítica interactiva:', e);
      }
    }
  }

  if (tabKey === 'register') {
    if (typeof window.filterClientOrdersTable === 'function') {
      try {
        window.filterClientOrdersTable(false);
      } catch (e) {
        console.warn('Error filtrando pedidos al cambiar a registro:', e);
      }
    }
  }
}
window.switchClientBillingTab = switchClientBillingTab;

// Cerrar el modal interactivo
export function closeClientInteractiveBillingModal() {
  const modalOverlay = document.getElementById('client-billing-interactive-modal');
  if (modalOverlay) {
    modalOverlay.style.display = 'none';
  }
}
window.closeClientInteractiveBillingModal = closeClientInteractiveBillingModal;

// Filtrar la tabla de pedidos dentro del modal del cliente
export function filterClientOrdersTable(syncToAnalytics = false) {
  const query = (document.getElementById('client-orders-filter-input')?.value || '').toLowerCase().trim();
  const storeSelect = document.getElementById('client-orders-store-filter');
  const storeSpinner = document.getElementById('client-orders-store-spinner');
  const countBadge = document.getElementById('client-orders-filter-count');

  // Mostrar ícono de carga en el selector y en el badge de conteo inmediatamente
  if (storeSpinner) storeSpinner.style.display = 'inline-flex';
  if (countBadge && syncToAnalytics) {
    countBadge.innerHTML = `<i class="ri-loader-4-line ri-spin" style="color: #5f06fa; margin-right: 4px;"></i> Cargando tienda...`;
  }

  // Permitir que el navegador repinte la UI con el ícono de carga antes de filtrar filas y renderizar gráficos
  setTimeout(() => {
    try {
      // Si no viene forzado desde el selector (ej: al cambiar de pestaña o desde un botón externo), sincronizar con snapshot
      if (!syncToAnalytics && window.__currentClientBillingSnapshot && storeSelect) {
        const activeFromSnap = window.__currentClientBillingSnapshot.activeConglomerateStoreFilter || '';
        if (storeSelect.value.toUpperCase() !== activeFromSnap.toUpperCase()) {
          storeSelect.value = activeFromSnap;
        }
      }

      const selectedStore = (storeSelect?.value || '').toUpperCase().trim();

      // Guardar en el snapshot para que la analítica y el registro queden sincronizados
      if (window.__currentClientBillingSnapshot) {
        window.__currentClientBillingSnapshot.activeConglomerateStoreFilter = selectedStore || null;
      }

      const rows = document.querySelectorAll('.client-modal-order-row');
      let visible = 0;

      rows.forEach(r => {
        const rowComercio = (r.getAttribute('data-comercio') || '').toUpperCase().trim();
        const text = r.innerText.toLowerCase();

        // Validar coincidencia de texto
        const matchesText = !query || text.includes(query);

        // Validar coincidencia de tienda
        const matchesStore = !selectedStore || (rowComercio === selectedStore || rowComercio.includes(selectedStore) || selectedStore.includes(rowComercio));

        if (matchesText && matchesStore) {
          r.style.display = '';
          visible++;
        } else {
          r.style.display = 'none';
        }
      });

      if (countBadge) {
        if (selectedStore || query) {
          countBadge.textContent = `Mostrando ${visible} de ${rows.length} pedidos${selectedStore ? ` (${selectedStore})` : ''}`;
        } else {
          countBadge.textContent = `Mostrando ${rows.length} pedidos`;
        }
      }

      // Si el usuario cambió la tienda desde el select y la pestaña analítica está visible, re-renderizar gráficos
      if (syncToAnalytics && window.__currentClientBillingSnapshot) {
        const clientAnalyticsContent = document.getElementById('client-modal-content-analytics');
        const clientAnalyticsMount = document.getElementById('client-modal-analytics-mount');
        if (clientAnalyticsMount && (!clientAnalyticsContent || clientAnalyticsContent.style.display !== 'none')) {
          try {
            renderBillingAnalyticsCharts('client-modal-analytics-mount', window.__currentClientBillingSnapshot);
          } catch (e) {
            console.warn('Error re-renderizando analítica:', e);
          }
        }
      }
    } finally {
      if (storeSpinner) storeSpinner.style.display = 'none';
    }
  }, 20);
}
window.filterClientOrdersTable = filterClientOrdersTable;

// Descarga directa de PDF para el cliente
export async function downloadClientBillingPdf(recordId) {
  let snapshot = window.__currentClientBillingSnapshot;

  if (!snapshot || (window.__currentClientBillingRecord && window.__currentClientBillingRecord.id !== recordId)) {
    try {
      const { data: rec } = await supabase
        .from('billing_records')
        .select('*')
        .eq('id', recordId)
        .single();

      if (rec) {
        const cacheKey = `stocka_fulfillment_details_${rec.period_id}_${rec.comercio}`;
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch (e) {}

        const recUpdatedTime = rec.updated_at ? new Date(rec.updated_at).getTime() : 0;
        const cachedTime = cached ? new Date(cached.publishedAt || cached.generatedAt || 0).getTime() : 0;
        const isCacheValid = cached && 
          (!rec.fulfillment_link || cached.fulfillment_link === rec.fulfillment_link) &&
          (rec.total_fulfillment === undefined || rec.total_fulfillment === null || cached.totals?.totalGross === rec.total_fulfillment) &&
          (!recUpdatedTime || cachedTime >= (recUpdatedTime - 5000));

        if (isCacheValid) {
          snapshot = cached;
        } else if (cached) {
          try { localStorage.removeItem(cacheKey); } catch (e) {}
        }

        if (!snapshot && rec.fulfillment_link && (rec.fulfillment_link.startsWith('http://') || rec.fulfillment_link.startsWith('https://'))) {
          try {
            const fetchUrl = rec.fulfillment_link + (rec.fulfillment_link.includes('?') ? '&' : '?') + 't=' + Date.now();
            const resp = await fetch(fetchUrl, { cache: 'no-store' });
            if (resp.ok) {
              snapshot = await resp.json();
              snapshot.fulfillment_link = rec.fulfillment_link;
              try { localStorage.setItem(cacheKey, JSON.stringify(snapshot)); } catch (e) {}
            }
          } catch (eF) {
            console.warn('Error descargando snapshot para PDF:', eF);
          }
        }

        if (!snapshot && cached) snapshot = cached;
      }
    } catch (e) {
      console.warn('Error recuperando snapshot para PDF:', e);
    }
  }

  if (!snapshot) {
    if (typeof Swal !== 'undefined') Swal.fire('Error', 'No se encontró la información del cobro para generar el PDF.', 'error');
    return;
  }

  // Garantizar que recargos Marketplace y totales sean consistentes
  sanitizeSnapshotOrdersMarketplace(snapshot);

  // Enriquecer y sincronizar datos legales del cliente (RUT, Razón Social, Sigla)
  const commName = snapshot.comercio || '';
  if (!snapshot.commerceInfo) snapshot.commerceInfo = {};

  try {
    const fetchedLegal = await getCommerceBillingInfo(commName);
    if (fetchedLegal) {
      if ((!snapshot.commerceInfo.rut || snapshot.commerceInfo.rut === '—') && fetchedLegal.rut && fetchedLegal.rut !== '—') {
        snapshot.commerceInfo.rut = fetchedLegal.rut;
      }
      if ((!snapshot.commerceInfo.razonSocial || snapshot.commerceInfo.razonSocial === commName) && fetchedLegal.razonSocial) {
        snapshot.commerceInfo.razonSocial = fetchedLegal.razonSocial;
      }
      if ((!snapshot.commerceInfo.sigla || snapshot.commerceInfo.sigla === '—') && fetchedLegal.sigla && fetchedLegal.sigla !== '—') {
        snapshot.commerceInfo.sigla = fetchedLegal.sigla;
      }
    }
  } catch (e) {}

  try {
    const localLegalStr = localStorage.getItem(`stocka_commerce_legal_${commName}`);
    if (localLegalStr) {
      const localLegal = JSON.parse(localLegalStr);
      if (localLegal.razonSocial) snapshot.commerceInfo.razonSocial = localLegal.razonSocial;
      if (localLegal.rut && localLegal.rut !== '—') snapshot.commerceInfo.rut = localLegal.rut;
      if (localLegal.sigla && localLegal.sigla !== '—') snapshot.commerceInfo.sigla = localLegal.sigla;
    }
  } catch (e) {}

  await enrichSnapshotWithPosAbonosIfNeeded(snapshot);

  snapshot.isClientView = true;

  // Renderizar siempre en un contenedor limpio y aislado con estilos oficiales
  const tempDiv = document.createElement('div');
  tempDiv.className = 'client-billing-modal-view';
  tempDiv.style.position = 'fixed';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '0';
  tempDiv.style.width = '850px';
  tempDiv.style.background = '#ffffff';
  tempDiv.innerHTML = renderStockaDesgloseHTML(snapshot);
  document.body.appendChild(tempDiv);
  const printable = tempDiv.querySelector('#stocka-printable-invoice') || tempDiv;

  const cleanCommerce = (snapshot.commerceInfo?.sigla || snapshot.comercio || 'COMERCIO').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanPeriod = (snapshot.periodName || 'PERIODO').replace(/\s+/g, '_');
  const filename = `Desglose_Oficial_Stocka_${cleanCommerce}_${cleanPeriod}.pdf`;

  downloadBillingPdf(printable, filename);

  setTimeout(() => {
    try { tempDiv.remove(); } catch (e) {}
  }, 8000);
}

// Descarga directa de Excel para el cliente
export async function downloadClientBillingExcel(recordId) {
  let snapshot = window.__currentClientBillingSnapshot;

  if (!snapshot || (window.__currentClientBillingRecord && window.__currentClientBillingRecord.id !== recordId)) {
    try {
      const { data: rec } = await supabase
        .from('billing_records')
        .select('*')
        .eq('id', recordId)
        .single();

      if (rec) {
        const cacheKey = `stocka_fulfillment_details_${rec.period_id}_${rec.comercio}`;
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch (e) {}

        const recUpdatedTime = rec.updated_at ? new Date(rec.updated_at).getTime() : 0;
        const cachedTime = cached ? new Date(cached.publishedAt || cached.generatedAt || 0).getTime() : 0;
        const isCacheValid = cached && 
          (!rec.fulfillment_link || cached.fulfillment_link === rec.fulfillment_link) &&
          (rec.total_fulfillment === undefined || rec.total_fulfillment === null || cached.totals?.totalGross === rec.total_fulfillment) &&
          (!recUpdatedTime || cachedTime >= (recUpdatedTime - 5000));

        if (isCacheValid) {
          snapshot = cached;
        } else if (cached) {
          try { localStorage.removeItem(cacheKey); } catch (e) {}
        }

        if (!snapshot && rec.fulfillment_link && (rec.fulfillment_link.startsWith('http://') || rec.fulfillment_link.startsWith('https://'))) {
          try {
            const fetchUrl = rec.fulfillment_link + (rec.fulfillment_link.includes('?') ? '&' : '?') + 't=' + Date.now();
            const resp = await fetch(fetchUrl, { cache: 'no-store' });
            if (resp.ok) {
              snapshot = await resp.json();
              snapshot.fulfillment_link = rec.fulfillment_link;
              try { localStorage.setItem(cacheKey, JSON.stringify(snapshot)); } catch (e) {}
            }
          } catch (eF) {
            console.warn('Error descargando snapshot para Excel:', eF);
          }
        }

        if (!snapshot && cached) snapshot = cached;
      }
    } catch (e) {
      console.warn('Error recuperando snapshot para Excel:', e);
    }
  }

  if (!snapshot) {
    if (typeof Swal !== 'undefined') Swal.fire('Error', 'No se encontró la información del cobro para exportar a Excel.', 'error');
    return;
  }

  // Garantizar que recargos Marketplace y totales sean consistentes
  sanitizeSnapshotOrdersMarketplace(snapshot);

  await enrichSnapshotWithPosAbonosIfNeeded(snapshot);

  exportBillingToExcel(snapshot);
}

// ============================================================================
// SISTEMA DE ALERTAS Y APARTADO DE APELACIONES / OBSERVACIONES EN EL GESTOR
// (Detecta apelaciones sin respuesta e ingresa saldos al periodo en curso)
// ============================================================================

function extractSuggestedClpAmountsFromText(...texts) {
  const combined = texts.map(t => String(t || '')).join(' ');
  const amounts = new Set();
  // Detectar formatos como $15.000, $ 120.500, 15.000, 25000
  const regex = /(?:\$\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,8})\b/g;
  let match;
  while ((match = regex.exec(combined)) !== null) {
    const rawNum = parseInt(String(match[1]).replace(/\./g, ''), 10);
    // Filtrar años como 2025/2026 o números fuera de rango razonable
    if (!isNaN(rawNum) && rawNum >= 500 && rawNum <= 50000000 && rawNum !== 2024 && rawNum !== 2025 && rawNum !== 2026 && rawNum !== 2027) {
      amounts.add(rawNum);
    }
  }
  return Array.from(amounts).slice(0, 5);
}

export function getObservationAppliedEntriesInCurrentPeriod(obsKey, obs = null) {
  const b = billingState;
  const keyStr = String(obsKey || '').trim();
  const tagMarker = `[OBS:${keyStr}]`;

  const matchedAbonos = (Array.isArray(b.abonos) ? b.abonos : []).filter(ab => {
    if (!ab) return false;
    if (ab.linkedObservationKey && String(ab.linkedObservationKey) === keyStr) return true;
    const refNotes = `${ab.reference || ''} ${ab.notes || ''} ${ab.voucher || ''}`;
    return Boolean(keyStr && refNotes.includes(tagMarker));
  });

  const matchedAdjustments = (Array.isArray(b.adjustments) ? b.adjustments : []).filter(adj => {
    if (!adj) return false;
    if (adj.linkedObservationKey && String(adj.linkedObservationKey) === keyStr) return true;
    const conceptNotes = `${adj.concept || ''} ${adj.notes || ''}`;
    return Boolean(keyStr && conceptNotes.includes(tagMarker));
  });

  const totalAbonoApplied = matchedAbonos.reduce((acc, a) => acc + (Math.abs(Math.round(Number(a.amount))) || 0), 0);
  const totalAdjustmentNetApplied = matchedAdjustments.reduce((acc, a) => acc + (Math.round(Number(a.amount)) || 0), 0);
  const totalAdjustmentGrossApplied = Math.round(totalAdjustmentNetApplied * 1.19);

  return {
    isApplied: matchedAbonos.length > 0 || matchedAdjustments.length > 0,
    matchedAbonos,
    matchedAdjustments,
    totalAbonoApplied,
    totalAdjustmentNetApplied,
    totalAdjustmentGrossApplied
  };
}

export async function fetchCommerceBillingObservations(commerceName) {
  const rawName = String(commerceName || '').trim();
  const cleanName = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawName;
  if (!cleanName) return [];

  try {
    let groupNames = [];
    try {
      groupNames = await resolveCommerceGroup(cleanName);
    } catch (eGrp) {
      groupNames = [cleanName];
    }

    const extraChildren = Array.isArray(billingState.conglomerateChildren) ? billingState.conglomerateChildren : [];
    const targetUpperSet = new Set(
      [rawName, cleanName, ...(Array.isArray(groupNames) ? groupNames : []), ...extraChildren]
        .map(n => String(n || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toUpperCase())
        .filter(Boolean)
    );

    if (cleanName.toUpperCase().includes('BIG BANG') || targetUpperSet.has('BIG BANG')) {
      ['BIG BANG', 'BIG BANG SPA', 'BACK IN TIME', 'DORMILONES', 'RELAJARTE'].forEach(s => targetUpperSet.add(s));
    }
    if (cleanName.toUpperCase().includes('SILVER FOX') || targetUpperSet.has('SILVER FOX')) {
      ['SILVER FOX', 'SILVER FOX SPA', 'AURA', 'MODUS', 'HYGGE', 'FORTE MAX', 'MENPRIME'].forEach(s => targetUpperSet.add(s));
    }

    const { data, error } = await supabase
      .from('billing_records')
      .select('*, billing_periods(name)')
      .or('client_observation.not.is.null,client_observation_enviame.not.is.null,observation_status.eq.pendiente,observation_status_enviame.eq.pendiente,observation_status.eq.respondida,observation_status_enviame.eq.respondida');

    if (error || !data) {
      if (error) console.warn('Aviso consultando billing_records para observaciones:', error);
      return [];
    }

    const matchedRecords = data.filter(r => {
      const recComm = String(r.comercio || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toUpperCase();
      if (!recComm) return false;
      if (targetUpperSet.has(recComm)) return true;
      for (const tName of targetUpperSet) {
        if (recComm.includes(tName) || tName.includes(recComm)) return true;
      }
      return false;
    });

    const observations = [];

    matchedRecords.forEach(r => {
      const periodName = r.billing_periods?.name || 'Periodo Anterior';

      // 1. Evaluar observación de Fulfillment
      const fClient = String(r.client_observation || '').trim();
      const fAdmin = String(r.admin_response || '').trim();
      const fStatus = r.observation_status || 'sin_observacion';
      const hasFulfillmentObs = fStatus === 'pendiente' || fStatus === 'respondida' || Boolean(fClient) || Boolean(fAdmin);

      if (hasFulfillmentObs) {
        const isUnanswered = fStatus === 'pendiente' || (Boolean(fClient) && !Boolean(fAdmin) && fStatus !== 'sin_observacion');
        observations.push({
          key: `${r.id}_fulfillment`,
          recordId: r.id,
          comercio: r.comercio,
          periodId: r.period_id,
          periodName,
          service: 'fulfillment',
          serviceLabel: 'Fulfillment',
          status: isUnanswered ? 'pendiente' : (fStatus === 'respondida' || Boolean(fAdmin) ? 'respondida' : fStatus),
          isUnanswered,
          clientObservation: fClient,
          adminResponse: fAdmin,
          updatedAt: r.observation_updated_at || r.updated_at || r.created_at,
          totalServiceAmount: Math.round(Number(r.total_fulfillment) || 0),
          suggestedAmounts: extractSuggestedClpAmountsFromText(fClient, fAdmin)
        });
      }

      // 2. Evaluar observación de Envíame
      const eClient = String(r.client_observation_enviame || '').trim();
      const eAdmin = String(r.admin_response_enviame || '').trim();
      const eStatus = r.observation_status_enviame || 'sin_observacion';
      const hasEnviameObs = eStatus === 'pendiente' || eStatus === 'respondida' || Boolean(eClient) || Boolean(eAdmin);

      if (hasEnviameObs) {
        const isUnanswered = eStatus === 'pendiente' || (Boolean(eClient) && !Boolean(eAdmin) && eStatus !== 'sin_observacion');
        observations.push({
          key: `${r.id}_enviame`,
          recordId: r.id,
          comercio: r.comercio,
          periodId: r.period_id,
          periodName,
          service: 'enviame',
          serviceLabel: 'Envíame',
          status: isUnanswered ? 'pendiente' : (eStatus === 'respondida' || Boolean(eAdmin) ? 'respondida' : eStatus),
          isUnanswered,
          clientObservation: eClient,
          adminResponse: eAdmin,
          updatedAt: r.observation_updated_at_enviame || r.updated_at || r.created_at,
          totalServiceAmount: Math.round(Number(r.enviame ?? r.total_enviame) || 0),
          suggestedAmounts: extractSuggestedClpAmountsFromText(eClient, eAdmin)
        });
      }
    });

    // Ordenar: primero las que están sin respuesta, luego por fecha más reciente
    observations.sort((a, b) => {
      if (a.isUnanswered !== b.isUnanswered) return a.isUnanswered ? -1 : 1;
      const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tB - tA;
    });

    return observations;
  } catch (err) {
    console.warn('Error consultando observaciones del comercio en Gestor:', err);
    return [];
  }
}

export async function loadAndRenderCommerceObservationsUI(showToastOnRefresh = false) {
  const b = billingState;
  if (!b.currentCommerce) {
    b.commerceObservations = [];
    renderCommerceObservationsBannerUI();
    return;
  }

  const obsList = await fetchCommerceBillingObservations(b.currentCommerce);
  b.commerceObservations = obsList;

  renderCommerceObservationsBannerUI();

  const obsContainer = document.getElementById('bg-observations-container');
  if (obsContainer) {
    renderCommerceObservationsSectionUI();
  }

  if (showToastOnRefresh && typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: `Observaciones sincronizadas (${obsList.length})`,
      showConfirmButton: false,
      timer: 2000
    });
  }
}
window.loadAndRenderCommerceObservationsUI = loadAndRenderCommerceObservationsUI;

export function renderCommerceObservationsBannerUI() {
  const b = billingState;
  const banner = document.getElementById('bg-commerce-observations-alert-banner');
  const navBadge = document.getElementById('bg-observations-nav-badge');
  const tabBtn = document.getElementById('bg-tab-btn-observations');
  const obsList = Array.isArray(b.commerceObservations) ? b.commerceObservations : [];

  const unansweredList = obsList.filter(o => o.isUnanswered);
  const unansweredCount = unansweredList.length;
  const totalCount = obsList.length;

  // Actualizar badge en el botón de la sub-pestaña "Apelaciones / Observaciones"
  if (navBadge) {
    if (unansweredCount > 0) {
      navBadge.style.display = 'inline-block';
      navBadge.style.background = '#ef4444';
      navBadge.style.color = '#ffffff';
      navBadge.textContent = `${unansweredCount} sin resp.`;
      if (tabBtn) tabBtn.style.borderColor = 'rgba(239, 68, 68, 0.55)';
    } else if (totalCount > 0) {
      navBadge.style.display = 'inline-block';
      navBadge.style.background = 'rgba(95, 6, 250, 0.14)';
      navBadge.style.color = '#5f06fa';
      navBadge.textContent = `${totalCount}`;
      if (tabBtn) tabBtn.style.borderColor = '';
    } else {
      navBadge.style.display = 'none';
      if (tabBtn) tabBtn.style.borderColor = '';
    }
  }

  if (!banner) return;

  if (!b.currentCommerce || totalCount === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  // Caso 1: Existen apelaciones / observaciones SIN RESPUESTA (Alerta prominente)
  if (unansweredCount > 0) {
    banner.style.display = 'block';
    banner.innerHTML = `
      <div style="background: linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%); border: 1.5px solid #ef4444; border-left: 5px solid #dc2626; border-radius: 10px; padding: 0.75rem 1rem; box-shadow: 0 3px 10px rgba(239, 68, 68, 0.12);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.65rem; margin-bottom: 0.55rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="background: #dc2626; color: #ffffff; font-size: 0.7rem; font-weight: 900; padding: 3px 9px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.3px;">
              <i class="ri-alarm-warning-fill"></i> Apelación / Observación sin Respuesta (${unansweredCount})
            </span>
            <strong style="font-size: 0.86rem; color: #991b1b;">
              ${escapeHtml(b.currentCommerce)} mantiene ${unansweredCount} observación(es) pendiente(s) de respuesta
            </strong>
          </div>
          <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <button type="button"
                    onclick="window.switchBgSubTab('observations')"
                    class="btn btn-sm"
                    style="background: #ffffff; color: #b91c1c; border: 1px solid #fca5a5; font-weight: 800; font-size: 0.73rem; padding: 0.32rem 0.7rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="ri-question-answer-line"></i> Ver Apartado Completo (${totalCount})
            </button>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.45rem;">
          ${unansweredList.map(obs => {
            const appliedInfo = getObservationAppliedEntriesInCurrentPeriod(obs.key, obs);
            const isSamePeriod = String(obs.periodId) === String(b.currentPeriodId) || String(obs.periodName).toUpperCase() === String(b.currentPeriodName).toUpperCase();
            return `
              <div style="background: rgba(255, 255, 255, 0.92); border: 1px solid #fecaca; border-radius: 8px; padding: 0.55rem 0.8rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.65rem;">
                <div style="flex: 1; min-width: 240px;">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 3px;">
                    <span style="font-size: 0.68rem; font-weight: 800; padding: 1px 7px; border-radius: 4px; background: ${obs.service === 'enviame' ? '#e0f2fe' : '#ede9fe'}; color: ${obs.service === 'enviame' ? '#0369a1' : '#5b21b6'};">
                      ${obs.service === 'enviame' ? '🚚 Envíame' : '📦 Fulfillment'}
                    </span>
                    <span style="font-size: 0.7rem; font-weight: 800; color: #334155; background: #f1f5f9; padding: 1px 7px; border-radius: 4px;">
                      📅 Periodo Origen: ${escapeHtml(obs.periodName)}${isSamePeriod ? ' (Periodo Actual)' : ''}
                    </span>
                    ${obs.comercio && obs.comercio.toUpperCase() !== b.currentCommerce.toUpperCase() ? `
                      <span style="font-size: 0.68rem; font-weight: 700; color: #5f06fa; background: rgba(95,6,250,0.08); padding: 1px 6px; border-radius: 4px;">
                        🏪 ${escapeHtml(obs.comercio)}
                      </span>
                    ` : ''}
                    ${appliedInfo.isApplied ? `
                      <span style="font-size: 0.68rem; font-weight: 800; background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 1px 7px; border-radius: 999px; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-checkbox-circle-fill"></i> Saldo ingresado en ${escapeHtml(b.currentPeriodName)} (${formatCLP(appliedInfo.totalAbonoApplied || Math.abs(appliedInfo.totalAdjustmentGrossApplied))})
                      </span>
                    ` : ''}
                  </div>
                  <div style="font-size: 0.8rem; color: #1e293b; font-weight: 600; line-height: 1.35;">
                    <span style="color: #dc2626; font-weight: 800;">Cliente dice:</span> "${escapeHtml(obs.clientObservation || 'Observación marcada pendiente de revisión')}"
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; flex-shrink: 0;">
                  ${!b.isLocked ? `
                    <button type="button"
                            onclick="window.openApplyObservationToBillingModal('${escapeHtml(obs.key)}')"
                            style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #ffffff; border: none; border-radius: 6px; padding: 0.36rem 0.7rem; font-size: 0.73rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 5px rgba(16, 185, 129, 0.25);"
                            title="Ingresar esta observación al desglose de ${escapeHtml(b.currentPeriodName)} como saldo a favor (abono) o ajuste comercial y responder al comercio">
                      <i class="ri-hand-coin-fill"></i> Ingresar como Saldo a ${escapeHtml(b.currentPeriodName)}
                    </button>
                  ` : ''}
                  <button type="button"
                          onclick="window.openReplyObservationFromGeneratorModal('${escapeHtml(obs.key)}')"
                          style="background: #ffffff; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.73rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;"
                          title="Responder observación o cambiar su estado">
                    <i class="ri-reply-fill" style="color: #5f06fa;"></i> Responder
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    return;
  }

  // Caso 2: Todas las observaciones están respondidas, pero existen observaciones asociadas al comercio
  const appliedCount = obsList.filter(o => getObservationAppliedEntriesInCurrentPeriod(o.key, o).isApplied).length;
  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="background: linear-gradient(135deg, #f8fafc 0%, #f5f3ff 100%); border: 1px solid #c4b5fd; border-left: 4px solid #5f06fa; border-radius: 9px; padding: 0.5rem 0.9rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem;">
      <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; font-size: 0.78rem; color: #334155;">
        <span style="background: #ede9fe; color: #5b21b6; font-weight: 800; font-size: 0.69rem; padding: 2px 8px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px;">
          <i class="ri-question-answer-line"></i> ${totalCount} Observación(es) Registrada(s)
        </span>
        <span>
          Todas las apelaciones de <strong>${escapeHtml(b.currentCommerce)}</strong> tienen respuesta registrada.
          ${appliedCount > 0 ? `<strong style="color: #059669;">(${appliedCount} ingresada(s) como saldo en ${escapeHtml(b.currentPeriodName)})</strong>` : 'Puedes consultarlas o ingresarlas como saldo al periodo en curso.'}
        </span>
      </div>
      <div style="display: flex; align-items: center; gap: 0.4rem;">
        <button type="button"
                onclick="window.switchBgSubTab('observations')"
                style="background: #ffffff; color: #5f06fa; border: 1px solid #c4b5fd; border-radius: 6px; padding: 3px 9px; font-size: 0.72rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
          <i class="ri-eye-line"></i> Ver Observaciones e Ingresar Saldo
        </button>
      </div>
    </div>
  `;
}
window.renderCommerceObservationsBannerUI = renderCommerceObservationsBannerUI;

window.setBgObservationsFilter = function(filterKey) {
  billingState.activeObservationsFilter = filterKey || 'all';
  renderCommerceObservationsSectionUI();
};

export function renderCommerceObservationsSectionUI() {
  const b = billingState;
  const container = document.getElementById('bg-observations-container');
  if (!container) return;

  if (!b.currentCommerce) {
    return;
  }

  const allObs = Array.isArray(b.commerceObservations) ? b.commerceObservations : [];
  const unansweredObs = allObs.filter(o => o.isUnanswered);
  const answeredObs = allObs.filter(o => !o.isUnanswered);
  const activeFilter = b.activeObservationsFilter || 'all';

  let totalAppliedInCurrentPeriod = 0;
  let appliedObsCount = 0;
  allObs.forEach(obs => {
    const app = getObservationAppliedEntriesInCurrentPeriod(obs.key, obs);
    if (app.isApplied) {
      appliedObsCount++;
      totalAppliedInCurrentPeriod += (app.totalAbonoApplied + Math.abs(app.totalAdjustmentGrossApplied));
    }
  });

  const filteredObs = allObs.filter(obs => {
    if (activeFilter === 'unanswered') return obs.isUnanswered;
    if (activeFilter === 'answered') return !obs.isUnanswered;
    if (activeFilter === 'applied') return getObservationAppliedEntriesInCurrentPeriod(obs.key, obs).isApplied;
    return true;
  });

  container.innerHTML = `
    <div class="bg-card-container" style="margin-bottom: 1.5rem;">
      <!-- Cabecera del Apartado -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.1rem; padding-bottom: 0.85rem; border-bottom: 1px solid var(--color-border);">
        <div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.45rem;">
              <i class="ri-question-answer-fill" style="color: #5f06fa; font-size: 1.25rem;"></i>
              Apelaciones y Observaciones de Facturación — ${escapeHtml(b.currentCommerce)}
            </h3>
            ${unansweredObs.length > 0 ? `
              <span style="background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; font-size: 0.72rem; font-weight: 900; padding: 2px 9px; border-radius: 999px;">
                🚨 ${unansweredObs.length} SIN RESPUESTA
              </span>
            ` : (allObs.length > 0 ? `
              <span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; font-size: 0.72rem; font-weight: 800; padding: 2px 9px; border-radius: 999px;">
                ✅ Al día (${allObs.length} respondida${allObs.length === 1 ? '' : 's'})
              </span>
            ` : '')}
          </div>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
            Revisa las observaciones enviadas por el comercio en cualquier periodo y <strong>aplícalas directamente como saldo a favor (abono) o ajuste comercial al periodo en curso (${escapeHtml(b.currentPeriodName || 'Actual')})</strong>.
          </p>
        </div>

        <div style="display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap;">
          <button type="button"
                  onclick="window.loadAndRenderCommerceObservationsUI(true)"
                  class="btn btn-outline btn-sm"
                  style="height: 32px; padding: 0 0.75rem; font-size: 0.76rem; font-weight: 700; border-radius: 7px; display: inline-flex; align-items: center; gap: 4px;">
            <i class="ri-refresh-line"></i> Sincronizar Observaciones
          </button>
          <button type="button"
                  onclick="window.switchBgSubTab('desglose')"
                  class="btn btn-outline btn-sm"
                  style="height: 32px; padding: 0 0.75rem; font-size: 0.76rem; font-weight: 700; border-radius: 7px; border-color: rgba(95,6,250,0.4); color: #5f06fa; display: inline-flex; align-items: center; gap: 4px;">
            <i class="ri-file-list-3-line"></i> Ver Desglose de ${escapeHtml(b.currentPeriodName || 'Periodo')}
          </button>
        </div>
      </div>

      <!-- Tarjetas de Resumen Rápido -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 1.1rem;">
        <div style="background: ${unansweredObs.length > 0 ? '#fef2f2' : 'var(--color-bg)'}; border: 1px solid ${unansweredObs.length > 0 ? '#fca5a5' : 'var(--color-border)'}; border-left: 4px solid ${unansweredObs.length > 0 ? '#dc2626' : '#10b981'}; border-radius: 9px; padding: 0.75rem 0.95rem;">
          <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: ${unansweredObs.length > 0 ? '#991b1b' : 'var(--color-text-muted)'};">Apelaciones sin Respuesta</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: ${unansweredObs.length > 0 ? '#dc2626' : '#10b981'}; margin-top: 2px;">
            ${unansweredObs.length}
          </div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted);">
            ${unansweredObs.length > 0 ? 'Requieren atención y respuesta' : 'Sin apelaciones pendientes'}
          </div>
        </div>

        <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-left: 4px solid #5f06fa; border-radius: 9px; padding: 0.75rem 0.95rem;">
          <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--color-text-muted);">Total Histórico Comercio</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #5f06fa; margin-top: 2px;">
            ${allObs.length}
          </div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted);">
            ${answeredObs.length} respondida(s) · Fulfillment y Envíame
          </div>
        </div>

        <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-left: 4px solid #059669; border-radius: 9px; padding: 0.75rem 0.95rem;">
          <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--color-text-muted);">Saldos Aplicados en ${escapeHtml(b.currentPeriodName || 'Curso')}</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #059669; margin-top: 2px;">
            ${formatCLP(totalAppliedInCurrentPeriod)}
          </div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted);">
            ${appliedObsCount} observación(es) ingresada(s) a este desglose
          </div>
        </div>

        <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-left: 4px solid #0284c7; border-radius: 9px; padding: 0.75rem 0.95rem;">
          <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--color-text-muted);">Saldo Final a Pagar (${escapeHtml(b.currentPeriodName || 'Curso')})</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #0284c7; margin-top: 2px;">
            ${formatCLP(b.totals?.totalToPay || 0)}
          </div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted);">
            Total Factura c/IVA: ${formatCLP(b.totals?.totalGross || 0)}
          </div>
        </div>
      </div>

      <!-- Barra de Filtros -->
      <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; background: var(--color-bg); padding: 0.45rem 0.75rem; border-radius: 8px; border: 1px solid var(--color-border);">
        <span style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-muted); text-transform: uppercase; margin-right: 4px;">
          <i class="ri-filter-3-line" style="color: #5f06fa;"></i> Mostrar:
        </span>
        <button type="button" class="bg-quick-filter-btn ${activeFilter === 'all' ? 'active' : ''}" onclick="window.setBgObservationsFilter('all')">
          Todas (${allObs.length})
        </button>
        <button type="button" class="bg-quick-filter-btn ${activeFilter === 'unanswered' ? 'active' : ''}" onclick="window.setBgObservationsFilter('unanswered')" style="${unansweredObs.length > 0 ? 'border-color: #fca5a5; color: #b91c1c; font-weight: 800;' : ''}">
          🚨 Sin Respuesta (${unansweredObs.length})
        </button>
        <button type="button" class="bg-quick-filter-btn ${activeFilter === 'answered' ? 'active' : ''}" onclick="window.setBgObservationsFilter('answered')">
          ✅ Respondidas (${answeredObs.length})
        </button>
        <button type="button" class="bg-quick-filter-btn ${activeFilter === 'applied' ? 'active' : ''}" onclick="window.setBgObservationsFilter('applied')">
          💰 Ingresadas al Periodo Actual (${appliedObsCount})
        </button>
      </div>

      <!-- Listado de Tarjetas de Observación -->
      ${filteredObs.length === 0 ? `
        <div style="text-align: center; padding: 2.75rem 1.5rem; background: var(--color-bg); border: 1px dashed var(--color-border); border-radius: 10px; color: var(--color-text-muted);">
          <i class="ri-chat-check-line" style="font-size: 2.2rem; color: #10b981; display: block; margin-bottom: 0.4rem;"></i>
          <strong style="font-size: 0.95rem; color: var(--color-text-main);">
            ${allObs.length === 0
              ? `No existen apelaciones ni observaciones registradas para ${escapeHtml(b.currentCommerce)}`
              : 'No hay observaciones que coincidan con el filtro seleccionado'}
          </strong>
          <div style="font-size: 0.8rem; margin-top: 0.25rem;">
            Cuando el cliente envíe una observación sobre Fulfillment o Envíame desde su portal, aparecerá automáticamente aquí con alerta para que puedas responderla o ingresarla como saldo al periodo en curso.
          </div>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 0.85rem;">
          ${filteredObs.map(obs => {
            const appliedInfo = getObservationAppliedEntriesInCurrentPeriod(obs.key, obs);
            const dateStr = obs.updatedAt
              ? new Date(obs.updatedAt).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—';
            const isSamePeriod = String(obs.periodId) === String(b.currentPeriodId) || String(obs.periodName).toUpperCase() === String(b.currentPeriodName).toUpperCase();

            return `
              <div style="background: var(--color-surface); border: 1.5px solid ${obs.isUnanswered ? '#fca5a5' : (appliedInfo.isApplied ? '#86efac' : 'var(--color-border)')}; border-left: 5px solid ${obs.isUnanswered ? '#dc2626' : (appliedInfo.isApplied ? '#10b981' : '#5f06fa')}; border-radius: 10px; padding: 0.95rem 1.15rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                <!-- Fila Superior: Badges y Acciones -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.65rem; margin-bottom: 0.75rem;">
                  <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                    ${obs.isUnanswered ? `
                      <span style="background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; font-size: 0.7rem; font-weight: 900; padding: 2px 9px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="ri-alarm-warning-fill"></i> SIN RESPUESTA / PENDIENTE
                      </span>
                    ` : `
                      <span style="background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-size: 0.7rem; font-weight: 800; padding: 2px 9px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="ri-checkbox-circle-fill"></i> RESPONDIDA
                      </span>
                    `}

                    <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; background: ${obs.service === 'enviame' ? '#e0f2fe' : '#ede9fe'}; color: ${obs.service === 'enviame' ? '#0369a1' : '#5b21b6'};">
                      ${obs.service === 'enviame' ? '🚚 Servicio Envíame' : '📦 Servicio Fulfillment'}
                    </span>

                    <span style="font-size: 0.73rem; font-weight: 800; color: #1e293b; background: #f1f5f9; border: 1px solid #e2e8f0; padding: 2px 8px; border-radius: 6px;">
                      📅 Periodo Apelado: ${escapeHtml(obs.periodName)}${isSamePeriod ? ' (Periodo Actual)' : ''}
                    </span>

                    <span style="font-size: 0.72rem; font-weight: 700; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 2px 8px; border-radius: 6px;">
                      🏪 ${escapeHtml(obs.comercio)}
                    </span>

                    ${obs.totalServiceAmount > 0 ? `
                      <span style="font-size: 0.72rem; color: #64748b; font-weight: 600;">
                        Cobro periodo origen: <strong>${formatCLP(obs.totalServiceAmount)}</strong>
                      </span>
                    ` : ''}

                    <span style="font-size: 0.7rem; color: #94a3b8;">
                      <i class="ri-time-line"></i> ${dateStr}
                    </span>
                  </div>

                  <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                    ${!b.isLocked ? `
                      <button type="button"
                              onclick="window.openApplyObservationToBillingModal('${escapeHtml(obs.key)}')"
                              class="btn btn-sm"
                              style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #ffffff; border: none; font-weight: 800; font-size: 0.75rem; padding: 0.4rem 0.85rem; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);">
                        <i class="ri-hand-coin-fill"></i>
                        <span>${appliedInfo.isApplied ? `Agregar Otro Saldo en ${escapeHtml(b.currentPeriodName)}` : `Ingresar al Desglose (${escapeHtml(b.currentPeriodName)}) como Saldo`}</span>
                      </button>
                    ` : `
                      <span style="font-size: 0.7rem; color: #64748b; font-weight: 700; background: #f1f5f9; padding: 4px 8px; border-radius: 6px;">
                        <i class="ri-lock-line"></i> Desglose actual bloqueado
                      </span>
                    `}

                    <button type="button"
                            onclick="window.openReplyObservationFromGeneratorModal('${escapeHtml(obs.key)}')"
                            class="btn btn-outline btn-sm"
                            style="height: 31px; padding: 0 0.75rem; font-size: 0.74rem; font-weight: 700; border-radius: 7px; display: inline-flex; align-items: center; gap: 4px;">
                      <i class="ri-reply-line" style="color: #5f06fa;"></i>
                      <span>${obs.adminResponse ? 'Editar Respuesta / Estado' : 'Responder al Cliente'}</span>
                    </button>
                  </div>
                </div>

                <!-- Cuerpo: Observación del Cliente y Respuesta Admin -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem;">
                  <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 0.65rem 0.85rem;">
                    <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #b45309; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                      <i class="ri-user-voice-line"></i> Apelación / Observación del Comercio:
                    </div>
                    <div style="font-size: 0.83rem; color: #1e293b; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(obs.clientObservation || '(Marcada como pendiente sin texto detallado)')}</div>
                  </div>

                  <div style="background: ${obs.adminResponse ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${obs.adminResponse ? '#bbf7d0' : '#fecaca'}; border-radius: 8px; padding: 0.65rem 0.85rem;">
                    <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: ${obs.adminResponse ? '#15803d' : '#dc2626'}; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                      <i class="${obs.adminResponse ? 'ri-shield-check-line' : 'ri-error-warning-line'}"></i> Respuesta Administración Stocka:
                    </div>
                    ${obs.adminResponse ? `
                      <div style="font-size: 0.83rem; color: #065f46; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(obs.adminResponse)}</div>
                    ` : `
                      <div style="font-size: 0.8rem; color: #b91c1c; font-style: italic;">
                        Sin respuesta registrada aún. Puedes responder directamente o ingresar un saldo a favor en este periodo y responder en un solo paso.
                      </div>
                    `}
                  </div>
                </div>

                <!-- Pie: Estado de aplicación en el desglose del periodo en curso -->
                ${appliedInfo.isApplied ? `
                  <div style="margin-top: 0.65rem; background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 0.5rem 0.8rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 0.78rem; color: #065f46;">
                      <i class="ri-checkbox-circle-fill" style="color: #059669; font-size: 1rem;"></i>
                      <strong>Aplicada en el desglose en curso (${escapeHtml(b.currentPeriodName)}):</strong>
                      ${appliedInfo.matchedAbonos.map(ab => `
                        <span style="background: #ffffff; border: 1px solid #6ee7b7; padding: 2px 8px; border-radius: 6px; font-weight: 800; color: #047857; display: inline-flex; align-items: center; gap: 5px;">
                          Abono / Saldo a favor: -${formatCLP(ab.amount)} (${escapeHtml(ab.reference || 'Abono')})
                          ${!b.isLocked ? `<button type="button" onclick="window.deleteManualAbonoItem('${escapeHtml(ab.id)}')" title="Quitar este abono del desglose" style="background: transparent; border: none; color: #dc2626; cursor: pointer; padding: 0 2px; font-size: 0.85rem;"><i class="ri-close-circle-fill"></i></button>` : ''}
                        </span>
                      `).join('')}
                      ${appliedInfo.matchedAdjustments.map(adj => `
                        <span style="background: #ffffff; border: 1px solid #c4b5fd; padding: 2px 8px; border-radius: 6px; font-weight: 800; color: #5b21b6; display: inline-flex; align-items: center; gap: 5px;">
                          Ajuste Neto: ${formatCLP(adj.amount)} (${formatCLP(Math.round(adj.amount * 1.19))} c/IVA · ${escapeHtml(adj.concept || 'Ajuste')})
                          ${!b.isLocked ? `<button type="button" onclick="window.deleteManualAdjustmentItem('${escapeHtml(adj.id)}')" title="Quitar este ajuste del desglose" style="background: transparent; border: none; color: #dc2626; cursor: pointer; padding: 0 2px; font-size: 0.85rem;"><i class="ri-close-circle-fill"></i></button>` : ''}
                        </span>
                      `).join('')}
                    </div>
                    <button type="button" onclick="window.switchBgSubTab('desglose')" style="background: #059669; color: #ffffff; border: none; border-radius: 6px; padding: 3px 9px; font-size: 0.72rem; font-weight: 700; cursor: pointer;">
                      Ver en Desglose Oficial →
                    </button>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}
window.renderCommerceObservationsSectionUI = renderCommerceObservationsSectionUI;

// Modal para ingresar una apelación / observación como Saldo (Abono o Ajuste) al periodo en curso
window.openApplyObservationToBillingModal = async function(obsKey) {
  if (guardBillingLocked()) return;
  const b = billingState;
  const obsList = Array.isArray(b.commerceObservations) ? b.commerceObservations : [];
  const obs = obsList.find(o => String(o.key) === String(obsKey));
  if (!obs) {
    if (typeof Swal !== 'undefined') Swal.fire('Aviso', 'No se encontró la observación seleccionada.', 'warning');
    return;
  }

  const currentPeriodLabel = b.currentPeriodName || 'PERIODO EN CURSO';
  const currentTotalGross = Math.round(Number(b.totals?.totalGross) || 0);
  const currentTotalToPay = Math.round(Number(b.totals?.totalToPay) || 0);
  const defaultSuggestedAmount = (obs.suggestedAmounts && obs.suggestedAmounts.length > 0) ? obs.suggestedAmounts[0] : '';
  const todayStr = new Date().toISOString().split('T')[0];

  const defaultConceptAbono = `Saldo a favor por apelación ${obs.serviceLabel} (${obs.periodName})`;
  const defaultConceptAdjDiscount = `Descuento por observación ${obs.serviceLabel} (${obs.periodName})`;
  const defaultConceptAdjCharge = `Ajuste por observación ${obs.serviceLabel} (${obs.periodName})`;

  const { value: formResult } = await Swal.fire({
    title: `<div style="display:flex;align-items:center;justify-content:center;gap:0.45rem;font-size:1.08rem;"><i class="ri-hand-coin-fill" style="color:#059669;"></i><span>Ingresar Observación como Saldo en ${escapeHtml(currentPeriodLabel)}</span></div>`,
    width: '640px',
    html: `
      <div style="text-align: left; font-size: 0.86rem; color: #1e293b;">
        <!-- Contexto de la Observación -->
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 0.9rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;">
            <span style="font-size: 0.72rem; font-weight: 800; color: #b45309; text-transform: uppercase;">
              <i class="ri-question-answer-line"></i> Observación de ${escapeHtml(obs.comercio)} · ${escapeHtml(obs.serviceLabel)} (${escapeHtml(obs.periodName)})
            </span>
            <span style="font-size: 0.68rem; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: ${obs.isUnanswered ? '#fee2e2' : '#dcfce7'}; color: ${obs.isUnanswered ? '#dc2626' : '#15803d'};">
              ${obs.isUnanswered ? '🚨 Sin respuesta' : '✅ Respondida'}
            </span>
          </div>
          <div style="font-size: 0.8rem; color: #334155; white-space: pre-wrap; max-height: 90px; overflow-y: auto; line-height: 1.35;">"${escapeHtml(obs.clientObservation || 'Apelación pendiente')}"</div>
        </div>

        <!-- 1. Tipo de Aplicación en el Desglose -->
        <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 0.35rem; text-transform: uppercase;">
          1. ¿Cómo deseas ingresar este saldo al desglose de ${escapeHtml(currentPeriodLabel)}?
        </label>
        <div style="display: grid; grid-template-columns: 1fr; gap: 0.45rem; margin-bottom: 0.85rem;">
          <label id="swal-obs-mode-card-abono" style="display: flex; align-items: flex-start; gap: 8px; padding: 0.55rem 0.75rem; border-radius: 8px; border: 2px solid #10b981; background: #ecfdf5; cursor: pointer;">
            <input type="radio" name="swal-obs-apply-mode" value="abono" checked style="margin-top: 3px; accent-color: #059669;">
            <div>
              <div style="font-weight: 800; font-size: 0.82rem; color: #065f46;">💰 Saldo a Favor / Abono directo al Monto a Pagar (Recomendado)</div>
              <div style="font-size: 0.72rem; color: #047857;">Descuenta directamente del <strong>Monto a Pagar (Saldo)</strong> en ${escapeHtml(currentPeriodLabel)} sin alterar el Neto ni el IVA de la factura del mes.</div>
            </div>
          </label>

          <label id="swal-obs-mode-card-adj-discount" style="display: flex; align-items: flex-start; gap: 8px; padding: 0.55rem 0.75rem; border-radius: 8px; border: 1.5px solid #cbd5e1; background: #ffffff; cursor: pointer;">
            <input type="radio" name="swal-obs-apply-mode" value="adj_discount" style="margin-top: 3px; accent-color: #5f06fa;">
            <div>
              <div style="font-weight: 800; font-size: 0.82rem; color: #1e293b;">🏷️ Descuento Comercial en Base Neta (Reduce Neto + IVA)</div>
              <div style="font-size: 0.72rem; color: #64748b;">Ingresa una línea negativa en los ítems del desglose oficial disminuyendo la base imponible neta.</div>
            </div>
          </label>

          <label id="swal-obs-mode-card-adj-charge" style="display: flex; align-items: flex-start; gap: 8px; padding: 0.55rem 0.75rem; border-radius: 8px; border: 1.5px solid #cbd5e1; background: #ffffff; cursor: pointer;">
            <input type="radio" name="swal-obs-apply-mode" value="adj_charge" style="margin-top: 3px; accent-color: #ea580c;">
            <div>
              <div style="font-weight: 800; font-size: 0.82rem; color: #1e293b;">➕ Cargo / Diferencia a Cobrar en Base Neta (Suma Neto + IVA)</div>
              <div style="font-size: 0.72rem; color: #64748b;">Ingresa un cobro adicional positivo en la base neta del desglose actual.</div>
            </div>
          </label>
        </div>

        <!-- 2. Monto y Concepto -->
        <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 0.75rem; margin-bottom: 0.65rem;">
          <div>
            <label id="swal-obs-amount-label" style="font-size: 0.73rem; font-weight: 800; color: #334155; display: block; margin-bottom: 0.25rem;">
              MONTO SALDO ($ CLP TOTAL):
            </label>
            <input id="swal-obs-amount" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.95rem; font-weight: 800; color: #047857; text-align: right;" placeholder="Ej: 15000" min="1" step="100" value="${defaultSuggestedAmount}">
          </div>
          <div>
            <label style="font-size: 0.73rem; font-weight: 800; color: #334155; display: block; margin-bottom: 0.25rem;">
              CONCEPTO EN EL DESGLOSE:
            </label>
            <input id="swal-obs-concept" type="text" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.82rem; font-weight: 600;" value="${escapeHtml(defaultConceptAbono)}">
          </div>
        </div>

        ${obs.suggestedAmounts && obs.suggestedAmounts.length > 0 ? `
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 0.75rem;">
            <span style="font-size: 0.7rem; font-weight: 700; color: #64748b;">Montos detectados en el texto:</span>
            ${obs.suggestedAmounts.map(amt => `
              <button type="button" class="swal-obs-suggested-amt-btn" data-amt="${amt}" style="background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; border-radius: 999px; padding: 2px 8px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                Usar ${formatCLP(amt)}
              </button>
            `).join('')}
          </div>
        ` : ''}

        <!-- Vista Previa en Vivo del Impacto en el Periodo en Curso -->
        <div id="swal-obs-impact-preview" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.6rem 0.85rem; margin-bottom: 0.85rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; font-size: 0.78rem;">
          <div>
            <span style="color: #64748b;">Saldo actual ${escapeHtml(currentPeriodLabel)}:</span>
            <strong style="color: #334155; margin-left: 4px;">${formatCLP(currentTotalToPay)}</strong>
          </div>
          <div>
            <span style="color: #64748b;">Nuevo Saldo a Pagar proyectado:</span>
            <strong id="swal-obs-new-balance-lbl" style="color: #059669; font-size: 0.92rem; font-weight: 900; margin-left: 4px;">${formatCLP(currentTotalToPay)}</strong>
          </div>
        </div>

        <!-- 3. Responder y Marcar como Respondida simultáneamente -->
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 0.65rem 0.85rem;">
          <label style="display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: 0.78rem; color: #166534; cursor: pointer; margin-bottom: 0.4rem;">
            <input type="checkbox" id="swal-obs-also-reply" ${obs.isUnanswered ? 'checked' : ''} style="width: 15px; height: 15px; accent-color: #16a34a;">
            <span>Responder observación y marcar como "✅ Respondida" al guardar</span>
          </label>
          <textarea id="swal-obs-reply-text" rows="2" class="swal2-textarea" style="margin: 0; width: 100%; font-size: 0.8rem; padding: 0.45rem 0.6rem; border-radius: 6px; min-height: 54px;" placeholder="Escribe la respuesta oficial que verá el comercio...">${escapeHtml(obs.adminResponse || `Se acoge observación de ${obs.periodName} y se aplica saldo a favor en el desglose del periodo ${currentPeriodLabel}.`)}</textarea>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-double-line"></i> Ingresar al Desglose',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#059669',
    focusConfirm: false,
    didOpen: () => {
      const radios = Array.from(document.querySelectorAll('input[name="swal-obs-apply-mode"]'));
      const amountInp = document.getElementById('swal-obs-amount');
      const amountLbl = document.getElementById('swal-obs-amount-label');
      const conceptInp = document.getElementById('swal-obs-concept');
      const newBalanceLbl = document.getElementById('swal-obs-new-balance-lbl');
      const replyTxt = document.getElementById('swal-obs-reply-text');
      const cardAbono = document.getElementById('swal-obs-mode-card-abono');
      const cardDiscount = document.getElementById('swal-obs-mode-card-adj-discount');
      const cardCharge = document.getElementById('swal-obs-mode-card-adj-charge');

      const syncPreview = () => {
        const mode = document.querySelector('input[name="swal-obs-apply-mode"]:checked')?.value || 'abono';
        const rawAmt = Math.max(0, Math.abs(parseInt(amountInp?.value, 10) || 0));

        if (cardAbono) {
          cardAbono.style.borderColor = mode === 'abono' ? '#10b981' : '#cbd5e1';
          cardAbono.style.background = mode === 'abono' ? '#ecfdf5' : '#ffffff';
        }
        if (cardDiscount) {
          cardDiscount.style.borderColor = mode === 'adj_discount' ? '#5f06fa' : '#cbd5e1';
          cardDiscount.style.background = mode === 'adj_discount' ? '#f5f3ff' : '#ffffff';
        }
        if (cardCharge) {
          cardCharge.style.borderColor = mode === 'adj_charge' ? '#ea580c' : '#cbd5e1';
          cardCharge.style.background = mode === 'adj_charge' ? '#fff7ed' : '#ffffff';
        }

        if (mode === 'abono') {
          if (amountLbl) amountLbl.textContent = 'MONTO SALDO A FAVOR ($ CLP TOTAL):';
          const projected = Math.max(0, currentTotalToPay - rawAmt);
          if (newBalanceLbl) {
            newBalanceLbl.textContent = `${formatCLP(projected)} (-${formatCLP(rawAmt)})`;
            newBalanceLbl.style.color = '#059669';
          }
        } else if (mode === 'adj_discount') {
          if (amountLbl) amountLbl.textContent = 'MONTO DESCUENTO NETO ($ CLP SIN IVA):';
          const grossImpact = Math.round(rawAmt * 1.19);
          const projected = Math.max(0, currentTotalToPay - grossImpact);
          if (newBalanceLbl) {
            newBalanceLbl.textContent = `${formatCLP(projected)} (-${formatCLP(rawAmt)} neto / -${formatCLP(grossImpact)} c/IVA)`;
            newBalanceLbl.style.color = '#5f06fa';
          }
        } else {
          if (amountLbl) amountLbl.textContent = 'MONTO CARGO NETO ($ CLP SIN IVA):';
          const grossImpact = Math.round(rawAmt * 1.19);
          const projected = currentTotalToPay + grossImpact;
          if (newBalanceLbl) {
            newBalanceLbl.textContent = `${formatCLP(projected)} (+${formatCLP(rawAmt)} neto / +${formatCLP(grossImpact)} c/IVA)`;
            newBalanceLbl.style.color = '#ea580c';
          }
        }

        if (replyTxt && !obs.adminResponse && rawAmt > 0) {
          if (mode === 'abono') {
            replyTxt.value = `Se acoge observación de ${obs.periodName} (${obs.serviceLabel}) y se ingresa saldo a favor por ${formatCLP(rawAmt)} en el desglose del periodo ${currentPeriodLabel}.`;
          } else if (mode === 'adj_discount') {
            replyTxt.value = `Se acoge observación de ${obs.periodName} (${obs.serviceLabel}) y se aplica descuento comercial neto de ${formatCLP(rawAmt)} en el desglose del periodo ${currentPeriodLabel}.`;
          } else {
            replyTxt.value = `Se revisa observación de ${obs.periodName} (${obs.serviceLabel}) y se incorpora ajuste neto de ${formatCLP(rawAmt)} en el desglose del periodo ${currentPeriodLabel}.`;
          }
        }
      };

      radios.forEach(r => {
        r.addEventListener('change', () => {
          const mode = r.value;
          if (conceptInp) {
            if (mode === 'abono') conceptInp.value = defaultConceptAbono;
            else if (mode === 'adj_discount') conceptInp.value = defaultConceptAdjDiscount;
            else conceptInp.value = defaultConceptAdjCharge;
          }
          syncPreview();
        });
      });

      amountInp?.addEventListener('input', syncPreview);

      document.querySelectorAll('.swal-obs-suggested-amt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.getAttribute('data-amt');
          if (amountInp && val) {
            amountInp.value = val;
            syncPreview();
          }
        });
      });

      syncPreview();
    },
    preConfirm: () => {
      const mode = document.querySelector('input[name="swal-obs-apply-mode"]:checked')?.value || 'abono';
      const amount = Math.abs(parseInt(document.getElementById('swal-obs-amount')?.value, 10) || 0);
      const concept = document.getElementById('swal-obs-concept')?.value?.trim() || defaultConceptAbono;
      const alsoReply = Boolean(document.getElementById('swal-obs-also-reply')?.checked);
      const replyText = document.getElementById('swal-obs-reply-text')?.value?.trim() || '';

      if (!amount || amount <= 0) {
        Swal.showValidationMessage('Ingresa un monto en pesos ($ CLP) mayor a 0.');
        return false;
      }
      if (!concept) {
        Swal.showValidationMessage('Ingresa un concepto o referencia para el desglose.');
        return false;
      }
      if (alsoReply && !replyText) {
        Swal.showValidationMessage('Escribe una respuesta para el cliente o desmarca la casilla de responder.');
        return false;
      }

      return { mode, amount, concept, alsoReply, replyText };
    }
  });

  if (!formResult) return;

  const { mode, amount, concept, alsoReply, replyText } = formResult;
  const tagNote = `[OBS:${obs.key}] Apelación ${obs.serviceLabel} (${obs.periodName}) - ${obs.comercio}`;

  if (mode === 'abono') {
    if (!Array.isArray(b.abonos)) b.abonos = [];
    b.abonos.push({
      id: 'abono_obs_' + Date.now(),
      amount,
      date: todayStr,
      voucher: `APEL-${obs.periodName.replace(/\s+/g, '')}`,
      reference: concept,
      notes: tagNote,
      isObservationAbono: true,
      linkedObservationKey: obs.key,
      linkedObservationPeriod: obs.periodName,
      linkedObservationService: obs.serviceLabel
    });
    b.abonosSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(`stocka_billing_abonos_${b.currentPeriodId}_${b.currentCommerce}`, JSON.stringify(b.abonos));
    } catch (e) {}
  } else {
    if (!Array.isArray(b.adjustments)) b.adjustments = [];
    const signedAmount = mode === 'adj_discount' ? -Math.abs(amount) : Math.abs(amount);
    b.adjustments.push({
      id: 'adj_obs_' + Date.now(),
      concept,
      amount: signedAmount,
      notes: tagNote,
      isObservationAdjustment: true,
      linkedObservationKey: obs.key,
      linkedObservationPeriod: obs.periodName,
      linkedObservationService: obs.serviceLabel
    });
    b.adjustmentsSessionKey = `${b.currentPeriodId}_${b.currentCommerce}`;
  }

  b.isSaved = false;
  recalculateFromCurrentState();

  // Si se marcó responder y actualizar estado en billing_records
  if (alsoReply && obs.recordId) {
    try {
      const isEnviame = obs.service === 'enviame';
      const updatePayload = isEnviame
        ? {
            admin_response_enviame: replyText,
            observation_status_enviame: 'respondida',
            observation_updated_at_enviame: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        : {
            admin_response: replyText,
            observation_status: 'respondida',
            observation_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

      await supabase.from('billing_records').update(updatePayload).eq('id', obs.recordId);
      if (typeof window.updatePendingObservationsBadge === 'function') {
        window.updatePendingObservationsBadge();
      }
      loadAndRenderPeriodOverview({ silentBadgeOnly: true });
    } catch (errUpd) {
      console.warn('Error actualizando respuesta de observación en BD:', errUpd);
    }
  }

  await loadAndRenderCommerceObservationsUI();

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: mode === 'abono' ? 'Saldo a favor ingresado al desglose' : 'Ajuste comercial ingresado al desglose',
      text: `${concept}: ${formatCLP(amount)} aplicado en ${currentPeriodLabel} (Recuerda Guardar / Confirmar).`,
      showConfirmButton: false,
      timer: 3800
    });
  }
};

// Modal para responder o cambiar estado de una apelación / observación directamente desde el Gestor
window.openReplyObservationFromGeneratorModal = async function(obsKey) {
  const b = billingState;
  const obsList = Array.isArray(b.commerceObservations) ? b.commerceObservations : [];
  const obs = obsList.find(o => String(o.key) === String(obsKey));
  if (!obs) return;

  const { value: replyValues } = await Swal.fire({
    title: `<div style="display:flex;align-items:center;justify-content:center;gap:0.45rem;font-size:1.05rem;"><i class="ri-question-answer-fill" style="color:#5f06fa;"></i><span>Gestionar Apelación — ${escapeHtml(obs.comercio)}</span></div>`,
    width: '560px',
    html: `
      <div style="text-align: left; font-size: 0.86rem; color: #1e293b;">
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 0.65rem;">
          <span style="background: #ede9fe; color: #5b21b6; font-weight: 800; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px;">
            ${escapeHtml(obs.serviceLabel)}
          </span>
          <span style="background: #f1f5f9; color: #334155; font-weight: 800; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px;">
            Periodo: ${escapeHtml(obs.periodName)}
          </span>
        </div>

        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 0.65rem 0.8rem; margin-bottom: 0.85rem;">
          <div style="font-size: 0.7rem; font-weight: 800; color: #b45309; text-transform: uppercase; margin-bottom: 3px;">
            Observación enviada por el comercio:
          </div>
          <div style="font-size: 0.82rem; color: #1e293b; white-space: pre-wrap;">${escapeHtml(obs.clientObservation || '(Sin texto)')}</div>
        </div>

        <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 0.25rem;">
          RESPUESTA ADMINISTRACIÓN STOCKA:
        </label>
        <textarea id="swal-gen-obs-response" rows="4" class="swal2-textarea" style="margin: 0 0 0.75rem 0; width: 100%; font-size: 0.84rem; padding: 0.55rem;" placeholder="Escribe la respuesta o resolución para el cliente...">${escapeHtml(obs.adminResponse || '')}</textarea>

        <label style="font-size: 0.74rem; font-weight: 800; color: #334155; display: block; margin-bottom: 0.25rem;">
          ESTADO DE LA OBSERVACIÓN:
        </label>
        <select id="swal-gen-obs-status" class="swal2-select" style="margin: 0; width: 100%; height: 38px; font-size: 0.84rem; font-weight: 700;">
          <option value="respondida" ${!obs.isUnanswered || obs.status === 'respondida' ? 'selected' : ''}>✅ Respondida / Resuelta</option>
          <option value="pendiente" ${obs.isUnanswered ? 'selected' : ''}>🚨 Pendiente de revisión (Sin respuesta)</option>
          <option value="sin_observacion">🗑️ Cerrar / Sin observación activa</option>
        </select>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-save-3-line"></i> Guardar Respuesta',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const responseText = document.getElementById('swal-gen-obs-response')?.value?.trim() || '';
      const status = document.getElementById('swal-gen-obs-status')?.value || 'respondida';
      return { responseText, status };
    }
  });

  if (!replyValues) return;

  try {
    const isEnviame = obs.service === 'enviame';
    const finalStatus = (replyValues.responseText && replyValues.status === 'pendiente') ? 'respondida' : replyValues.status;
    const payload = isEnviame
      ? {
          admin_response_enviame: replyValues.responseText,
          observation_status_enviame: finalStatus,
          observation_updated_at_enviame: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      : {
          admin_response: replyValues.responseText,
          observation_status: finalStatus,
          observation_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

    const { error } = await supabase.from('billing_records').update(payload).eq('id', obs.recordId);
    if (error) throw error;

    await loadAndRenderCommerceObservationsUI();
    loadAndRenderPeriodOverview({ silentBadgeOnly: true });
    if (typeof window.updatePendingObservationsBadge === 'function') {
      window.updatePendingObservationsBadge();
    }

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Observación actualizada',
      showConfirmButton: false,
      timer: 2500
    });
  } catch (err) {
    console.error('Error guardando respuesta de observación:', err);
    Swal.fire('Error', 'No se pudo actualizar la observación: ' + (err.message || err), 'error');
  }
};

// Exportar todas las funciones al scope global window
window.openClientInteractiveBillingModal = openClientInteractiveBillingModal;
window.switchClientBillingTab = switchClientBillingTab;
window.closeClientInteractiveBillingModal = closeClientInteractiveBillingModal;
window.filterClientOrdersTable = filterClientOrdersTable;
window.downloadClientBillingPdf = downloadClientBillingPdf;
window.downloadClientBillingExcel = downloadClientBillingExcel;
window.confirmAndPublishBillingToCommerce = confirmAndPublishBillingToCommerce;
window.uploadBillingSnapshotToStorage = uploadBillingSnapshotToStorage;
// window.addNewManualAbonoRow = addNewManualAbonoRow;
// window.editManualAbonoItem = editManualAbonoItem;
// window.deleteManualAbonoItem = deleteManualAbonoItem;
window.injectBillingGeneratorStyles = injectBillingGeneratorStyles;
window.injectClientInteractiveModalStyles = injectClientInteractiveModalStyles;

// Inyección proactiva de estilos tanto en admin como en dashboard cliente
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectBillingGeneratorStyles();
      injectClientInteractiveModalStyles();
    });
  } else {
    injectBillingGeneratorStyles();
    injectClientInteractiveModalStyles();
  }
}


