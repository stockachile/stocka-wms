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
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }

    [data-theme="dark"] .bg-card-container {
      background: var(--color-surface, #131b2e) !important;
      border-color: #2a3754 !important;
    }

    .bg-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .bg-kpi-card {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 12px;
      padding: 1.1rem 1.25rem;
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

    [data-theme="dark"] .bg-kpi-card::before {
      background: #a855f7;
    }

    .bg-kpi-title {
      font-size: 0.725rem;
      font-weight: 700;
      color: var(--color-text-muted, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    [data-theme="dark"] .bg-kpi-title {
      color: #94a3b8 !important;
    }

    .bg-kpi-value {
      font-size: 1.45rem;
      font-weight: 800;
      color: var(--color-text-main, #0f172a);
      font-family: 'Outfit', sans-serif;
    }

    [data-theme="dark"] .bg-kpi-value {
      color: #f8fafc !important;
    }

    .bg-kpi-subtitle {
      font-size: 0.75rem;
      color: var(--color-text-muted, #64748b);
      margin-top: 0.25rem;
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
      background: linear-gradient(135deg, #5f06fa 0%, #7c3aed 100%);
      color: #ffffff;
      border-radius: 10px;
      padding: 1.25rem 1.75rem;
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.25rem;
      box-shadow: 0 4px 14px rgba(95, 6, 250, 0.25);
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

    // 2. Datos legales adicionales (Razón Social, RUT, email) desde comercios_adicional_config
    let extra = null;
    const { data: extraByName } = await supabase
      .from('comercios_adicional_config')
      .select('razon_social, rut, email_colaborador')
      .ilike('comercio', cleanName)
      .maybeSingle();

    if (extraByName) {
      extra = extraByName;
    } else if (vConfig && vConfig.id) {
      const { data: extraById } = await supabase
        .from('comercios_adicional_config')
        .select('razon_social, rut, email_colaborador')
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
  } catch (e) {
    console.warn('Error cargando información legal del comercio:', e);
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

  // 1.1 Consultar si ya existe un registro guardado previamente (Supabase o localStorage)
  let savedSnapshot = null;
  let savedRecordStatus = null;
  if (billingState.currentPeriodId && commerceName && !customOverrides.forceFresh) {
    try {
      const { data: bRec } = await supabase
        .from('billing_records')
        .select('desglose_fulfillment, total_fulfillment, fulfillment_link')
        .eq('period_id', billingState.currentPeriodId)
        .eq('comercio', commerceName)
        .maybeSingle();

      if (bRec) {
        savedRecordStatus = bRec.desglose_fulfillment;
        if (bRec.fulfillment_link && (bRec.fulfillment_link.includes('billing_snapshots') || bRec.fulfillment_link.includes('_snapshot.json'))) {
          billingState.isPublished = true;
          savedRecordStatus = 'Publicado';

          if (!savedSnapshot && (bRec.fulfillment_link.startsWith('http://') || bRec.fulfillment_link.startsWith('https://'))) {
            try {
              const resp = await fetch(bRec.fulfillment_link);
              if (resp.ok) savedSnapshot = await resp.json();
            } catch (eSnap) {}
          }
        }
      }
    } catch (errRec) {
      console.warn('Error consultando billing_records previo:', errRec);
    }

    if (!savedSnapshot) {
      try {
        const localStr = localStorage.getItem(`stocka_fulfillment_details_${billingState.currentPeriodId}_${commerceName}`);
        if (localStr) savedSnapshot = JSON.parse(localStr);
      } catch (e) {}
    }
  }

  billingState.isSaved = !!(savedRecordStatus === 'Creado' || savedRecordStatus === 'Publicado' || (savedSnapshot && savedSnapshot.generatedAt));
  billingState.savedRecordStatus = savedRecordStatus || (billingState.isSaved ? 'Creado' : 'Pendiente');

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

  // 5. Calcular volumen de almacenamiento promedio del mes calendario (Punto B)
  const volData = await getMonthlyStorageVolume(commerceGroup, periodYear, periodMonth);
  billingState.volumeDailyAverage = volData.averageM3;
  billingState.volumeDaysLogged = volData.daysCount;
  billingState.volumeM3 = customOverrides.volumeM3 !== undefined 
    ? parseFloat(customOverrides.volumeM3) 
    : (savedSnapshot && savedSnapshot.volumeM3 !== undefined ? parseFloat(savedSnapshot.volumeM3) : volData.averageM3);

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

  const deliveryTypesList = getDeliveryTypes(cfg);
  const getDeliveryPrice = (key, fallback = 0) => {
    const found = deliveryTypesList.find(d => d.key === key);
    return found ? found.price : fallback;
  };

  const savedOrderMap = {};
  if (savedSnapshot && savedSnapshot.orders && Array.isArray(savedSnapshot.orders)) {
    savedSnapshot.orders.forEach(so => {
      if (so && so.id) {
        // Sanear si en el snapshot previo venía con isMarketplace=true pero surchargeMarketplace=0
        if (so.isMarketplace && (!so.surchargeMarketplace || so.surchargeMarketplace === 0)) {
          const mktRate = (cfg.pick_pack_rules && cfg.pick_pack_rules.surcharge_marketplace_collect) || 100;
          so.surchargeMarketplace = mktRate;
          so.pickPackTotal = (so.baseRate || 0) + (so.surchargeSku || 0) + (so.surchargeUnits || 0) + so.surchargeMarketplace;
          so.orderTotal = so.pickPackTotal + (so.shippingFreight || 0);
        } else if (!so.isMarketplace && so.surchargeMarketplace > 0) {
          so.surchargeMarketplace = 0;
          so.pickPackTotal = (so.baseRate || 0) + (so.surchargeSku || 0) + (so.surchargeUnits || 0);
          so.orderTotal = so.pickPackTotal + (so.shippingFreight || 0);
        }
        savedOrderMap[so.id] = so;
      }
    });
  }

  // 8. Procesar cada pedido: tarifa base, recargos y despacho
  const processedOrders = ordersList.map((ord, idx) => {
    const savedOrder = savedOrderMap[ord.id];
    const isExcluded = (customOverrides.excludedOrderIds && customOverrides.excludedOrderIds.includes(ord.id)) ||
                       (customOverrides.orders && customOverrides.orders[ord.id]?.isExcluded !== undefined ? customOverrides.orders[ord.id].isExcluded : (savedOrder ? !!savedOrder.isExcluded : false));
    
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

    // Detección automática de pedido Marketplace (+ $100)
    const platformUpper = String(ord.external_platform || '').toUpperCase();
    const agendaUpper = String(ord.agenda || '').toUpperCase();
    const operadorUpper = String(ord.operador || '').toUpperCase();

    const isMarketplaceAuto = platformUpper.includes('MERCADO') || 
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

    const mktSurchargeRate = (cfg.pick_pack_rules && cfg.pick_pack_rules.surcharge_marketplace_collect) || 100;

    // Reglas de Despacho (Punto D)
    const shippingMethodUpper = String(ord.shipping_method || '').toUpperCase();
    const cityNorm = String(ord.shipping_city || '').toLowerCase().trim();
    const isColina = cityNorm.includes('colina') || String(ord.shipping_address || '').toLowerCase().includes('colina');

    // Envíos Flex
    const isFlex = agendaUpper.includes('FLEX') || 
                   shippingMethodUpper.includes('FLEX') || 
                   (platformUpper.includes('MERCADO') && shippingMethodUpper.includes('FLEX'));

    // Operadores Stocka Express RM: STOCKA X, ALPHA, STK, RM
    const isStkRmCourier = ['STOCKA X', 'ALPHA', 'STK', 'RM', 'STOCKA'].some(c => 
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

    if (isRetiro) {
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

    // Sobreescritura manual por pedido si el admin ya lo editó (o si estaba guardado en snapshot)
    const manualOrderOverride = (customOverrides.orders && customOverrides.orders[ord.id]) || savedOrder;
    
    // Respetar override manual de isMarketplace si existe; de lo contrario usar auto-detección
    const isMarketplace = manualOrderOverride?.isMarketplace !== undefined
      ? !!manualOrderOverride.isMarketplace
      : isMarketplaceAuto;

    // Regla estricta de recargo Marketplace:
    // Checkbox marcado (true) = $100 (o tarifa configurada si > 0). NUNCA $0 si isMarketplace es true.
    // Checkbox desmarcado (false) = $0.
    let finalSurchargeMarketplace = 0;
    if (isMarketplace) {
      finalSurchargeMarketplace = (manualOrderOverride?.surchargeMarketplace !== undefined && manualOrderOverride.surchargeMarketplace > 0)
        ? manualOrderOverride.surchargeMarketplace
        : mktSurchargeRate;
    } else {
      finalSurchargeMarketplace = 0;
    }

    const finalBaseRate = manualOrderOverride?.baseRate !== undefined ? manualOrderOverride.baseRate : basePickPackRate;
    const finalSurchargeSku = manualOrderOverride?.surchargeSku !== undefined ? manualOrderOverride.surchargeSku : surchargeSku;
    const finalSurchargeUnits = manualOrderOverride?.surchargeUnits !== undefined ? manualOrderOverride.surchargeUnits : surchargeUnits;
    const finalDeliveryType = manualOrderOverride?.deliveryType || deliveryType;
    let finalShippingFreight = shippingFreight;
    if (manualOrderOverride?.shippingFreight !== undefined) {
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

    const finalPickPackTotal = finalBaseRate + finalSurchargeSku + finalSurchargeUnits + finalSurchargeMarketplace;
    const finalOrderTotal = finalPickPackTotal + finalShippingFreight;

    return {
      id: ord.id,
      rowNumber: idx + 1,
      orderNumber: ord.external_order_number || (ord.raw_shopify_data?.name ? ord.raw_shopify_data.name : ord.id.slice(0, 8)),
      externalOrderNumber: ord.external_order_number || (ord.raw_shopify_data?.name ? ord.raw_shopify_data.name : ord.id.slice(0, 8)),
      platform: ord.external_platform || (ord.raw_shopify_data ? 'Shopify' : (ord.raw_woocommerce_data ? 'WooCommerce' : (ord.raw_meli_data ? 'Mercado Libre' : 'Manual'))),
      externalPlatform: ord.external_platform || (ord.raw_shopify_data ? 'Shopify' : (ord.raw_woocommerce_data ? 'WooCommerce' : (ord.raw_meli_data ? 'Mercado Libre' : 'Manual'))),
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
      ticketVenta: finalTicketVenta,
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

  const billableShippingOrders = billableOrders.filter(o => (o.shippingFreight || 0) > 0);
  const totalRmFlexNet = billableShippingOrders.reduce((acc, o) => acc + (o.shippingFreight || 0), 0);

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

  // 12.1 Restaurar checks de checklist si vienen en el snapshot guardado
  if (savedSnapshot && savedSnapshot.checklist && savedSnapshot.checklist.checks) {
    if (typeof saveChecklistChecks === 'function') {
      const existingChecks = getChecklistChecks(billingState.currentPeriodId, commerceName);
      if (!existingChecks || Object.keys(existingChecks).length === 0) {
        saveChecklistChecks(billingState.currentPeriodId, commerceName, savedSnapshot.checklist.checks);
      }
    }
  }

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
    shippingRmFlexCount: billableShippingOrders.length,
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
export function renderStockaDesgloseHTML(snapshotState = null) {
  const b = snapshotState || billingState;
  const t = b.totals || {};
  const c = b.commerceInfo ? { ...b.commerceInfo } : {};
  const invDates = b.invoiceDates || {};
  const isClient = Boolean(b.isClientView);
  const commName = b.currentCommerce || b.comercio || '';

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
            ${b.supplies.filter(s => (s.qty || 0) > 0).map((s, idx) => `
              <tr>
                <td>
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <div>
                      <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">${escapeHtml(s.name)}</div>
                      <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">Insumos y material de empaque</div>
                    </div>
                    ${!isClient ? `
                    <div class="no-print" style="display: flex; gap: 4px; align-items: center;">
                      <button type="button" onclick="window.editManualSupplyItem('${s.id || idx}')" title="Editar cantidad o precio de este insumo" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #475569; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-pencil-line"></i> Editar
                      </button>
                      <button type="button" onclick="window.deleteManualSupplyItem('${s.id || idx}')" title="Eliminar este ítem de cobro" style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #dc2626; font-size: 0.75rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-delete-bin-line"></i> Eliminar
                      </button>
                    </div>` : ''}
                  </div>
                </td>
                <td style="text-align: center; font-weight: 600; color: #64748b;">${escapeHtml(s.unit || 'gl.')}</td>
                <td style="text-align: center; font-weight: 700; color: #0f172a;">${s.qty}</td>
                <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatCLP(s.total)}</td>
                <td style="text-align: right; color: #64748b;">${formatCLP((s.total || 0) * 0.19)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">${formatCLP((s.total || 0) * 1.19)}</td>
              </tr>
            `).join('')}

            <!-- 6. Costo Fijo Mensual -->
            <tr>
              <td>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                  <div>
                    <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">Costo Fijo Mensual Fulfillment ${t.fixedFeeUF > 0 ? (t.fixedFeeUF === 1.5 ? '- Rango 1' : '- Rango 2') : '(Exento)'}</div>
                    <div style="font-size: 0.725rem; color: #64748b; margin-top: 2px;">${escapeHtml(t.fixedFeeReason || '')}</div>
                  </div>
                  ${!isClient ? `
                  <div class="no-print">
                    <button type="button" onclick="window.openEditFixedFeeModal()" title="Editar o eximir costo fijo mensual" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; cursor: pointer; color: #475569; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
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

            <!-- 7. Ajustes Comerciales si existen -->
            ${b.adjustments.map((a, idx) => `
              <tr>
                <td>
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <div>
                      <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">${escapeHtml(a.concept || 'Ajuste comercial')}</div>
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

  summaryData.push([]);
  summaryData.push(["TOTALES DEL PERIODO", "", "", t.totalNet, t.iva, t.totalGross]);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Desglose Oficial");

  // Pestaña 2: Detalle de Todos los Pedidos (Formato tipo Excel Auditoría)
  const deliveryTypesMap = getDeliveryTypes(b.pricingConfig).reduce((acc, dt) => {
    acc[dt.key] = dt.name;
    return acc;
  }, {});

  const ordersHeaders = [
    "N°", "REF. ORIGEN", "PLATAFORMA", "ID PEDIDO", "FECHA", "AGENDA", "DESTINO / COMUNA", "OPERADOR", "MÉTODO ENVÍO",
    "TICKET VENTA ($)", "TIPO ENTREGA", "SKUS", "UNIDADES", "MKT?",
    "TARIFA BASE ($)", "REC. SKU ($)", "REC. UNID ($)", "REC. MKT ($)",
    "PREPARACIÓN TOTAL ($)", "FLETE ENVÍO ($)", "TOTAL COBRADO ($)", "ESTADO WMS", "INCLUIDO?"
  ];

  const ordersRows = (b.orders || []).map((o, idx) => [
    idx + 1,
    o.orderNumber || o.externalOrderNumber || o.id,
    o.platform || o.externalPlatform || 'Manual',
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
    if (b.invoiceDates?.dueDate) {
      payload.fecha_limite = b.invoiceDates.dueDate;
    }

    const fullSnapshot = {
      periodId: b.currentPeriodId,
      periodName: b.currentPeriodName,
      comercio: b.currentCommerce,
      commerceInfo: b.commerceInfo,
      invoiceDates: b.invoiceDates,
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
      checklist: (typeof getChecklistDataForSnapshot === 'function') ? getChecklistDataForSnapshot() : null,
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
    billingState.savedRecordStatus = 'Creado';
    renderKPIsUI();
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

// --- SUBIR SNAPSHOT DE FACTURACIÓN A SUPABASE STORAGE ---
export async function uploadBillingSnapshotToStorage(fullSnapshot) {
  const cleanCommerce = (fullSnapshot.comercio || 'comercio').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const periodId = fullSnapshot.periodId;
  const filePath = `billing_snapshots/${periodId}/${cleanCommerce}_snapshot.json`;
  const jsonString = JSON.stringify(fullSnapshot);
  const blob = new Blob([jsonString], { type: 'application/json' });

  const { data, error } = await supabase.storage
    .from('service_docs')
    .upload(filePath, blob, {
      contentType: 'application/json',
      upsert: true
    });

  if (error) throw error;

  const { data: publicData } = supabase.storage
    .from('service_docs')
    .getPublicUrl(filePath);

  return publicData.publicUrl;
}

// --- CONFIRMAR Y PUBLICAR COBRO AL COMERCIO (INTERACTIVO) ---
export async function confirmAndPublishBillingToCommerce() {
  const b = billingState;
  const t = b.totals || {};

  if (!b.currentPeriodId || !b.currentCommerce) {
    Swal.fire('Atención', 'No hay un periodo o comercio activo seleccionado para publicar.', 'warning');
    return false;
  }

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
            <span style="color: #0f172a; font-weight: 700;">Monto Total Facturado:</span>
            <strong style="color: #5f06fa; font-size: 1.05rem;">${formatCLP(t.totalToPay || 0)}</strong>
          </div>
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

    const fullSnapshot = {
      periodId: b.currentPeriodId,
      periodName: b.currentPeriodName,
      comercio: b.currentCommerce,
      commerceInfo: b.commerceInfo,
      invoiceDates: b.invoiceDates,
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
      pricingConfig: b.pricingConfig,
      checklist: (typeof getChecklistDataForSnapshot === 'function') ? getChecklistDataForSnapshot() : null,
      publishedAt: new Date().toISOString()
    };

    // 1. Guardar en localStorage para acceso local instantáneo
    const storageKey = `stocka_fulfillment_details_${b.currentPeriodId}_${b.currentCommerce}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(fullSnapshot));
    } catch (e) {}

    // 2. Subir Snapshot JSON a Supabase Storage
    let publicSnapshotUrl = null;
    try {
      publicSnapshotUrl = await uploadBillingSnapshotToStorage(fullSnapshot);
    } catch (storageErr) {
      console.warn('Error subiendo snapshot a Supabase Storage:', storageErr);
    }

    // 3. Actualizar o insertar registro en base de datos
    const updatePayload = {
      total_fulfillment: t.totalToPay,
      desglose_fulfillment: 'Enviado',
      updated_at: new Date().toISOString()
    };

    if (b.invoiceDates?.dueDate) {
      updatePayload.fecha_limite = b.invoiceDates.dueDate;
    }

    if (publicSnapshotUrl) {
      updatePayload.fulfillment_link = publicSnapshotUrl;
    }

    const { data: existingRec } = await supabase
      .from('billing_records')
      .select('id, pago_fulfillment, factura_fulfillment, fecha_limite')
      .eq('period_id', b.currentPeriodId)
      .eq('comercio', b.currentCommerce)
      .maybeSingle();

    // Auto-transición de estados operativos: al publicar cobro, pasa a 'En espera' de pago y 'Facturar'
    if (t.totalToPay > 0) {
      if (!existingRec || !existingRec.pago_fulfillment || existingRec.pago_fulfillment === 'Por solicitar') {
        updatePayload.pago_fulfillment = 'En espera';
      }
      if (!existingRec || !existingRec.factura_fulfillment || existingRec.factura_fulfillment === 'Esperando') {
        updatePayload.factura_fulfillment = 'Facturar';
      }
    }

    if (existingRec && existingRec.id) {
      const { error: updateErr } = await supabase
        .from('billing_records')
        .update(updatePayload)
        .eq('id', existingRec.id);

      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await supabase
        .from('billing_records')
        .insert({
          period_id: b.currentPeriodId,
          comercio: b.currentCommerce,
          pago_fulfillment: t.totalToPay > 0 ? 'En espera' : 'Sin movimientos',
          factura_fulfillment: t.totalToPay > 0 ? 'Facturar' : 'Sin movimientos',
          ...updatePayload
        });

      if (insertErr) throw insertErr;
    }

    let finalRecordId = existingRec?.id;
    if (!finalRecordId) {
      const { data: newlyCreated } = await supabase
        .from('billing_records')
        .select('id')
        .eq('period_id', b.currentPeriodId)
        .eq('comercio', b.currentCommerce)
        .maybeSingle();
      finalRecordId = newlyCreated?.id;
    }

    billingState.isSaved = true;
    billingState.isPublished = true;
    billingState.savedRecordStatus = 'Publicado';
    renderKPIsUI();

    if (typeof window.loadBillingPeriods === 'function') {
      window.loadBillingPeriods();
    }

    const postAction = await Swal.fire({
      icon: 'success',
      title: '¡Cobro Publicado con Éxito!',
      html: `
        <div style="text-align: left; font-size: 0.85rem; line-height: 1.4;">
          <p>La facturación de <strong>${escapeHtml(b.currentCommerce)}</strong> para <strong>${escapeHtml(b.currentPeriodName)}</strong> ha sido confirmada y publicada.</p>
          <p style="color: #10b981; font-weight: 700;"><i class="ri-checkbox-circle-line"></i> Monto cobrado: ${formatCLP(t.totalToPay)} (con IVA)</p>
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
  const orders = b.orders || [];

  // Cálculos analíticos clave
  const totalOrders = orders.length || 1;
  const avgCostPerOrder = Math.round((t.totalNet || 0) / totalOrders);
  const totalSalesAmount = orders.reduce((sum, o) => sum + (o.ticketVenta || 0), 0);
  const avgTicket = totalOrders > 0 ? Math.round(totalSalesAmount / totalOrders) : 0;
  const rmPct = (((t.shippingRmFlexCount || 0) / totalOrders) * 100).toFixed(1);
  const envPct = (((t.shippingEnviameCount || 0) / totalOrders) * 100).toFixed(1);
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
            Métricas de rendimiento operativo, costos logísticos unitarios y comportamiento de envíos para <strong>${escapeHtml(b.currentCommerce || b.comercio || '')}</strong> (${escapeHtml(b.currentPeriodName || b.periodName || '')}).
          </p>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <span class="bg-hero-badge purple">
          <i class="ri-wallet-3-line"></i> Costo Promedio Logística: ${formatCLP(avgCostPerOrder)} / pedido
        </span>
        <span class="bg-hero-badge teal" title="Ticket promedio de venta de los pedidos del periodo">
          <i class="ri-shopping-cart-2-line"></i> Ticket Promedio Venta: ${formatCLP(avgTicket)}
        </span>
      </div>
    </div>

    <!-- 4 KPI Cards Ejecutivas en 1 Sola Línea con Estilo Uniforme y Sobrio -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">COSTO LOGÍSTICO UNITARIO</div>
        <div class="bg-kpi-value">${formatCLP(avgCostPerOrder)}</div>
        <div class="bg-kpi-subtitle">Costo neto por pedido</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">DESPACHOS RM / FLEX</div>
        <div class="bg-kpi-value">${rmPct}%</div>
        <div class="bg-kpi-subtitle">${t.shippingRmFlexCount} de ${totalOrders} pedidos locales</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">ENVÍOS A REGIONES</div>
        <div class="bg-kpi-value">${envPct}%</div>
        <div class="bg-kpi-subtitle">${t.shippingEnviameCount} pedidos vía Envíame</div>
      </div>

      <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
        <div class="bg-kpi-title">PEDIDOS MARKETPLACE</div>
        <div class="bg-kpi-value">${mktPct}%</div>
        <div class="bg-kpi-subtitle">${mktCount} pedidos marketplace</div>
      </div>
    </div>

    <!-- 4 Tarjetas de Almacenamiento Diario en 1 Sola Fila (Sobrio y Uniforme) -->
    <div style="margin-bottom: 0.5rem;">
      <h4 style="margin: 0 0 0.6rem 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 0.4rem;">
        <i class="ri-archive-line text-stocka-purple"></i> Métricas de Almacenamiento Diario
      </h4>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">VOLUMEN PROMEDIO DIARIO</div>
          <div class="bg-kpi-value">${formatDec(b.volumeM3, 2)} <span class="bg-kpi-unit">m³</span></div>
          <div class="bg-kpi-subtitle">Promedio mes calendario</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">DÍAS CON REGISTRO</div>
          <div class="bg-kpi-value">${b.volumeDaysLogged} <span class="bg-kpi-unit">días</span></div>
          <div class="bg-kpi-subtitle">Mediciones registradas</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">PICO MÁXIMO REGISTRADO</div>
          <div class="bg-kpi-value">${formatDec(b.volumeStats?.maxDailyVolume || b.volumeM3, 2)} <span class="bg-kpi-unit">m³</span></div>
          <div class="bg-kpi-subtitle">Mayor ocupación en el mes</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">VOLUMEN MÍNIMO REGISTRADO</div>
          <div class="bg-kpi-value">${formatDec(b.volumeStats?.minDailyVolume || b.volumeM3, 2)} <span class="bg-kpi-unit">m³</span></div>
          <div class="bg-kpi-subtitle">Menor ocupación en el mes</div>
        </div>
      </div>
    </div>

    <!-- Gráfico de Evolución de Almacenamiento Diario -->
    <div class="bg-chart-card" style="margin-bottom: 2rem;">
      <div class="bg-chart-header">
        <div>
          <h4 class="bg-chart-title">
            <i class="ri-line-chart-line text-stocka-purple"></i> Evolución del Volumen de Almacenamiento Diario (m³)
          </h4>
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">Comportamiento del cubicaje medido durante el mes facturado</span>
        </div>
        <div class="bg-tariff-badge">
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
        <i class="ri-shopping-bag-3-line text-stocka-purple"></i> Artículos Vendidos y Despachados
      </h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">TOTAL ARTÍCULOS VENDIDOS</div>
          <div class="bg-kpi-value">${(b.productsStats?.totalUnits || 0).toLocaleString('es-CL')} <span class="bg-kpi-unit">unidades</span></div>
          <div class="bg-kpi-subtitle">Unidades físicas procesadas</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">PROMEDIO POR PEDIDO</div>
          <div class="bg-kpi-value">${b.productsStats?.avgUnitsPerOrder || 0} <span class="bg-kpi-unit">uds/pedido</span></div>
          <div class="bg-kpi-subtitle">Artículos por orden despachada</div>
        </div>

        <div class="bg-kpi-card" style="border-top: 3px solid #5f06fa; border-left: 1px solid var(--color-border);">
          <div class="bg-kpi-title">SKUS DISTINTOS DESPACHADOS</div>
          <div class="bg-kpi-value">${(b.productsStats?.allProducts || []).length} <span class="bg-kpi-unit">SKUs</span></div>
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
          <span class="bg-share-badge">Top ${(b.productsStats?.topProducts || []).length}</span>
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

  // A. Gráfico de Evolución de Almacenamiento Diario
  const dailyLogs = b.dailyStorageLogs && b.dailyStorageLogs.length > 0
    ? b.dailyStorageLogs
    : [{ date: `${b.currentPeriodYear || new Date().getFullYear()}-${String(b.currentPeriodMonth || 1).padStart(2, '0')}-01`, volume: b.volumeM3 || 0 }];

  const storageCanvas = container.querySelector('#chart-storage-evolution') || document.getElementById('chart-storage-evolution');
  if (storageCanvas) {
    const ctx = storageCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(95, 6, 250, 0.25)');
    gradient.addColorStop(1, isDark ? 'rgba(168, 85, 247, 0.01)' : 'rgba(95, 6, 250, 0.01)');

    getCanvasAndInit('chart-storage-evolution', {
      type: 'line',
      data: {
        labels: dailyLogs.map(l => {
          const parts = (l.date || '').split('-');
          return parts.length === 3 ? `${parts[2]}/${parts[1]}` : l.date;
        }),
        datasets: [{
          label: 'Volumen Diario (m³)',
          data: dailyLogs.map(l => l.volume),
          borderColor: chartPurple,
          backgroundColor: gradient,
          fill: true,
          tension: 0.25,
          borderWidth: 2.5,
          pointRadius: dailyLogs.length > 20 ? 2 : 4,
          pointBackgroundColor: chartPurple,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Outfit', size: 10 }, color: chartTextColor }
          },
          y: {
            beginAtZero: true,
            grid: { color: chartGridColor },
            ticks: {
              font: { family: 'Outfit', size: 10 },
              color: chartTextColor,
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
  if (topProds.length > 0) {
    getCanvasAndInit('chart-top-products', {
      type: 'bar',
      data: {
        labels: topProds.map(p => p.sku),
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
  const expenseData = [
    { label: 'Almacenamiento', val: t.storageNet || 0, color: '#5f06fa', darkColor: '#a855f7' },
    { label: 'Preparación (Pick&Pack)', val: t.pickPackNet || 0, color: '#7c3aed', darkColor: '#c084fc' },
    { label: 'Despachos RM/Flex', val: t.shippingRmFlexNet || 0, color: '#6366f1', darkColor: '#818cf8' },
    { label: 'Costo Fijo Mensual', val: t.fixedFeeNet || 0, color: '#3b82f6', darkColor: '#60a5fa' },
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
              const pct = (t.totalNet || 0) > 0 ? ((val / t.totalNet) * 100).toFixed(1) : 0;
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
          <button id="bg-btn-config-delivery" class="btn btn-outline" style="border-color: #5f06fa; color: #5f06fa; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px;" title="Configurar y editar tipos de entrega">
            <i class="ri-settings-4-line"></i> Tipos de Entrega
          </button>
          <button id="bg-btn-export-excel" class="btn btn-outline" style="border-color: #10b981; color: #10b981; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px;" title="Descargar Excel con fórmulas">
            <i class="ri-file-excel-2-fill"></i> Exportar Excel (.xlsx)
          </button>
          <button id="bg-btn-download-pdf" class="btn btn-outline" style="border-color: #ef4444; color: #ef4444; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px;" title="Descargar PDF Oficial">
            <i class="ri-file-pdf-fill"></i> Descargar PDF
          </button>
          <button id="bg-btn-save-record" class="btn btn-primary" style="background: #10b981; border-color: #10b981; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);" title="Guardar en base de datos">
            <i class="ri-save-3-fill"></i> Guardar Facturación
          </button>
          <button id="bg-btn-publish-record" class="btn btn-primary" style="background: linear-gradient(135deg, #5f06fa 0%, #7c3aed 100%); border-color: #5f06fa; height: 40px; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 8px; box-shadow: 0 4px 12px rgba(95, 6, 250, 0.3);" title="Confirmar cobro y publicar desglose oficial, registro de pedidos y métricas directamente en el portal del cliente">
            <i class="ri-send-plane-fill"></i> Confirmar y Publicar
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
        <button class="bg-subnav-btn" id="bg-tab-btn-checklist" onclick="window.switchBgSubTab('checklist')">
          <i class="ri-checkbox-circle-line"></i> Checklist Global
          <span id="bg-checklist-nav-badge" style="background: rgba(95, 6, 250, 0.12); color: #5f06fa; font-size: 0.72rem; padding: 1px 7px; border-radius: 10px; font-weight: 800; margin-left: 4px;">0/0</span>
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
              <button type="button" class="btn btn-primary btn-sm" onclick="window.openBulkEditOrdersModal()" style="background: #5f06fa; border-color: #5f06fa; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;" title="Editar masivamente pedidos filtrados o seleccionados">
                <i class="ri-edit-2-line"></i> Edición Masiva
              </button>
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
              <button type="button" class="bg-quick-filter-btn" id="qf-centro-envios" onclick="window.setBgQuickFilter('centro-envios')">
                Centro Envíos (<span id="qf-count-centro-envios">0</span>)
              </button>
              <button type="button" class="bg-quick-filter-btn" id="qf-mkt" onclick="window.setBgQuickFilter('mkt')">
                Marketplace (<span id="qf-count-mkt">0</span>)
              </button>
            </div>

            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <span id="bg-filter-count-badge" style="font-size: 0.75rem; font-weight: 700; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 4px 8px; border-radius: 6px;">
                Mostrando 0 de 0 pedidos
              </span>
              <button id="bg-btn-bulk-edit-filtered" class="btn btn-sm btn-outline" style="height: 28px; font-size: 0.72rem; padding: 0 8px; border-radius: 6px; border-color: #5f06fa; color: #5f06fa; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" onclick="window.openBulkEditOrdersModal('filtered')" title="Editar masivamente solo los pedidos visibles según filtros actuales">
                <i class="ri-edit-line"></i> Editar Filtrados
              </button>
              <button id="bg-btn-clear-all-filters" class="btn btn-sm btn-outline" style="height: 28px; font-size: 0.72rem; padding: 0 8px; border-radius: 6px; display: none; border-color: #cbd5e1;" onclick="window.clearBgTableFilters()">
                <i class="ri-filter-off-line"></i> Limpiar Filtros
              </button>
            </div>
          </div>

          <div class="bg-excel-table-container">
            <table class="bg-excel-table" id="bg-orders-excel-grid">
              <thead>
                <tr>
                  <th style="width: 42px; text-align: center;">
                    <input type="checkbox" id="bg-master-inclusion-checkbox" title="Marcar / Desmarcar todos los pedidos visibles" onchange="window.toggleAllVisibleOrdersInclusion(this.checked)" style="cursor: pointer; width: 15px; height: 15px; accent-color: #5f06fa;">
                  </th>
                  <th style="width: 42px; text-align: center;">N°</th>
                  <th style="min-width: 250px;">ID Pedido / Agenda</th>
                  <th style="min-width: 220px;">Destino / Operador / Método</th>
                  <th style="width: 125px; text-align: right;">Ticket Venta ($)</th>
                  <th style="width: 175px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
                      <span>Tipo Entrega</span>
                      <button type="button" onclick="window.openDeliveryTypesManagerModal()" title="Configurar y editar tipos de entrega" style="background: rgba(95,6,250,0.08); border: 1px solid rgba(95,6,250,0.25); border-radius: 4px; cursor: pointer; color: #5f06fa; font-size: 0.72rem; padding: 1px 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="ri-settings-4-line"></i> Editar
                      </button>
                    </div>
                  </th>
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
                      <input type="text" id="bg-col-filter-order" class="bg-col-filter-input" placeholder="ID / Fecha..." oninput="window.applyBgColumnFilters()" style="flex: 1; min-width: 80px;">
                      <select id="bg-col-filter-agenda" class="bg-col-filter-select" onchange="window.applyBgColumnFilters()" style="width: 125px; text-overflow: ellipsis;" title="Filtrar por agenda específica o estado">
                        <option value="">Todas las Agendas</option>
                        <option value="empty">⚠️ Sin Agenda</option>
                        <option value="with">Con Agenda</option>
                      </select>
                    </div>
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
        <!-- Barra de herramientas para personalizar insumos, fechas y datos legales -->
        <div class="no-print" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 0.75rem 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
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
    </div>
  `;

  // Asignar listeners de eventos
  document.getElementById('bg-btn-config-delivery')?.addEventListener('click', () => {
    window.openDeliveryTypesManagerModal();
  });

  document.getElementById('bg-btn-edit-desglose-header')?.addEventListener('click', () => {
    openEditDesgloseHeaderModal();
  });

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

  document.getElementById('bg-btn-publish-record')?.addEventListener('click', () => {
    confirmAndPublishBillingToCommerce();
  });

  // Ejecutar cálculo inicial
  await executeCalculationFromUI();
};

// Función para alternar sub-pestañas
window.switchBgSubTab = function(tabKey) {
  const tabs = ['register', 'desglose', 'analytics', 'checklist'];
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
  } else if (tabKey === 'checklist') {
    if (typeof renderBillingChecklistUI === 'function') {
      renderBillingChecklistUI();
    }
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
}

// Renderizar Tarjetas de KPI
function renderKPIsUI() {
  const container = document.getElementById('bg-kpis-container');
  if (!container) return;

  const b = billingState;
  const t = b.totals;

  container.innerHTML = `
    <div class="bg-kpi-card" style="border-left: 4px solid #5f06fa;">
      <div class="bg-kpi-title" style="display: flex; align-items: center; justify-content: space-between;">
        <span><i class="ri-money-dollar-circle-line" style="color: #5f06fa;"></i> TOTAL FACTURA (CON IVA)</span>
        ${b.isSaved 
          ? ((b.isPublished || b.savedRecordStatus === 'Publicado')
              ? '<span style="background: rgba(168, 85, 247, 0.15); color: #a855f7; border: 1px solid rgba(168, 85, 247, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.65rem; text-transform: none;"><i class="ri-send-plane-fill"></i> Publicado</span>'
              : '<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.65rem; text-transform: none;"><i class="ri-checkbox-circle-line"></i> Guardado</span>') 
          : '<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.65rem; text-transform: none;"><i class="ri-time-line"></i> Borrador</span>'}
      </div>
      <div class="bg-kpi-value text-stocka-purple">${formatCLP(t.totalToPay)}</div>
      <div class="bg-kpi-subtitle">Neto: ${formatCLP(t.totalNet)} + IVA: ${formatCLP(t.iva)}</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #0284c7;">
      <div class="bg-kpi-title"><i class="ri-box-3-line" style="color: #0284c7;"></i> PEDIDOS PROCESADOS</div>
      <div class="bg-kpi-value" style="color: #0284c7;">${t.billableOrdersCount} <span style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted, #94a3b8);">/ ${t.ordersCount}</span></div>
      <div class="bg-kpi-subtitle">Pick & Pack Base: ${formatCLP(b.activeRange?.pick_pack_base || 1250)}</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #10b981;">
      <div class="bg-kpi-title"><i class="ri-archive-2-line" style="color: #10b981;"></i> ALMACENAMIENTO MES</div>
      <div class="bg-kpi-value" style="color: #10b981;">${formatDec(b.volumeM3, 2)} <span style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted, #94a3b8);">m³</span></div>
      <div class="bg-kpi-subtitle">Promedio ${b.volumeDaysLogged} días (${formatCLP(t.storageNet)} neto)</div>
    </div>

    <div class="bg-kpi-card" style="border-left: 4px solid #f59e0b;">
      <div class="bg-kpi-title"><i class="ri-flashlight-line" style="color: #f59e0b;"></i> DESPACHOS RM / FLEX</div>
      <div class="bg-kpi-value" style="color: #f59e0b;">${t.shippingRmFlexCount} <span style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-muted, #94a3b8);">envíos</span></div>
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

// Generador del badge de Estado WMS (Despachado, Pickeado, En preparación, etc.)
export function getWmsStatusBadgeHTML(status) {
  const raw = (status || 'Completado').trim();
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

// Renderizar Filas de la Tabla Editable
export function renderOrdersTableUI() {
  const tbody = document.getElementById('bg-orders-table-body');
  if (!tbody) return;

  const orders = billingState.orders || [];
  if (orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="16" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
          <i class="ri-inbox-line" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: #5f06fa;"></i>
          No se encontraron pedidos asignados al periodo <strong>${billingState.currentPeriodName}</strong> para este comercio.<br>
          <span style="font-size: 0.8rem; margin-top: 0.25rem; display: inline-block;">Asigna el periodo en el <strong>Gestor de Pedidos</strong> para que aparezcan aquí automáticamente.</span>
        </td>
      </tr>
    `;
    updateQuickPillCounts([]);
    updateAgendaFilterOptions([]);
    updateDeliveryFilterOptions();
    const countBadge = document.getElementById('bg-filter-count-badge');
    if (countBadge) countBadge.textContent = 'Mostrando 0 de 0 pedidos';
    return;
  }

  const deliveryTypes = getDeliveryTypes(billingState.pricingConfig);

  tbody.innerHTML = orders.map((o) => {
    const isChecked = !o.isExcluded;
    const rowClass = isChecked ? '' : 'style="opacity: 0.5; background: #f1f5f9;"';

    // 1. Agenda check: junto al número de pedido, marcar en rojo si está vacío
    const hasAgenda = o.agenda && o.agenda.trim() !== '' && o.agenda !== '—';
    const agendaText = hasAgenda ? o.agenda.trim() : '';
    const agendaBadge = hasAgenda
      ? `<span class="bg-order-agenda-badge" title="Agenda asignada: ${escapeHtml(agendaText)}"><i class="ri-calendar-event-line"></i> ${escapeHtml(agendaText)}</span>`
      : `<span class="bg-order-agenda-badge-empty" title="Sin agenda asignada en el Gestor de Pedidos"><i class="ri-alert-line"></i> Sin Agenda</span>`;

    // 1b. Estado WMS al lado de la etiqueta de agenda
    const wmsStatusText = o.estadoWms || 'Completado';
    const wmsStatusBadge = getWmsStatusBadgeHTML(wmsStatusText);

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
          data-wms="${escapeHtml((wmsStatusText || '').toLowerCase())}"
          data-dest="${escapeHtml((o.destination || '').toLowerCase())}"
          data-operador="${escapeHtml(operadorText.toLowerCase())}"
          data-method="${escapeHtml(shippingMethodText.toLowerCase())}"
          data-ticket="${o.ticketVenta || 0}"
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
            ${wmsStatusBadge}
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
        <td style="text-align: right;">
          <input type="number" class="bg-excel-input" value="${o.ticketVenta || 0}" style="text-align: right; width: 85px; font-weight: 700; color: #0f766e;" onchange="window.updateBgOrderCell('${o.id}', 'ticketVenta', this.value)" title="Ticket de venta del pedido (monto de compra cliente: ${formatCLP(o.ticketVenta || 0)})">
        </td>
        <td>
          <select class="bg-excel-select" onchange="window.updateBgOrderDeliveryType('${o.id}', this.value)" style="width: 100%;">
            ${deliveryTypes.map(dt => `
              <option value="${escapeHtml(dt.key)}" ${o.deliveryType === dt.key ? 'selected' : ''}>
                ${escapeHtml(dt.name)} (${formatCLP(dt.price)})
              </option>
            `).join('')}
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

  // 3. Actualizar conteos de filtros rápidos y opciones dinámicas de agendas y tipos de entrega
  updateQuickPillCounts(orders);
  updateAgendaFilterOptions(orders);
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
    setVal('bg-col-filter-agenda', window.bgFilterState.agenda);
    setVal('bg-col-filter-dest', window.bgFilterState.dest);
    setVal('bg-col-filter-ticket-min', window.bgFilterState.ticketMin);
    setVal('bg-col-filter-ticket-max', window.bgFilterState.ticketMax);
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

  const deliveryTypes = getDeliveryTypes(billingState.pricingConfig);
  const dt = deliveryTypes.find(d => d.key === newType);

  order.deliveryType = newType;
  order.shippingFreight = dt ? dt.price : 0;

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
    const mktSurcharge = (billingState.pricingConfig?.pick_pack_rules?.surcharge_marketplace_collect) || 100;
    order.surchargeMarketplace = order.isMarketplace ? mktSurcharge : 0;
  } else if (field === 'baseRate') {
    order.baseRate = Math.max(0, parseInt(value, 10) || 0);
  } else if (field === 'shippingFreight') {
    order.shippingFreight = Math.max(0, parseInt(value, 10) || 0);
  } else if (field === 'ticketVenta') {
    order.ticketVenta = Math.max(0, parseInt(value, 10) || 0);
  }

  order.pickPackTotal = order.baseRate + order.surchargeSku + order.surchargeUnits + order.surchargeMarketplace;
  order.orderTotal = order.pickPackTotal + order.shippingFreight;

  recalculateFromCurrentState();
};

// Marcar / Desmarcar inclusión de todos los pedidos actualmente visibles
window.toggleAllVisibleOrdersInclusion = function(isChecked) {
  const visibleRows = Array.from(document.querySelectorAll('#bg-orders-table-body tr[id^="bg-row-"]')).filter(r => r.style.display !== 'none');
  if (visibleRows.length === 0) return;
  const visibleIds = new Set(visibleRows.map(r => r.getAttribute('data-id')));

  let changedCount = 0;
  (billingState.orders || []).forEach(o => {
    if (visibleIds.has(o.id)) {
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
  const allOrders = billingState.orders || [];
  if (allOrders.length === 0) {
    Swal.fire('Sin pedidos', 'No hay pedidos cargados para editar en este periodo.', 'info');
    return;
  }

  // 1. Obtener pedidos visibles según los filtros activos actuales en el DOM
  const visibleRows = Array.from(document.querySelectorAll('#bg-orders-table-body tr[id^="bg-row-"]')).filter(r => r.style.display !== 'none');
  const visibleIds = new Set(visibleRows.map(r => r.getAttribute('data-id')));
  const filteredOrders = allOrders.filter(o => visibleIds.has(o.id));
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
    width: '640px',
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
          if (rowEl) {
            rowEl.style.background = e.target.checked ? '#f5f3ff' : '#fcfcfd';
            rowEl.style.borderColor = e.target.checked ? '#c4b5fd' : '#e2e8f0';
          }
          if (e.target.id === 'bulk-chk-delivery') {
            const syncBox = document.getElementById('bulk-box-sync-freight');
            if (syncBox) syncBox.style.display = e.target.checked ? 'block' : 'none';
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
        targetOrders = allOrders.filter(o => visibleIds.has(o.id));
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
      const chkInclusion = document.getElementById('bulk-chk-inclusion')?.checked;

      if (!chkDelivery && !chkFreight && !chkSkus && !chkUnits && !chkMkt && !chkBaseRate && !chkInclusion) {
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
          inclusion: chkInclusion ? (document.getElementById('bulk-val-inclusion')?.value === 'inc') : null
        }
      };
    }
  });

  if (!bulkResult) return;

  const { targetOrders, updates } = bulkResult;
  const count = targetOrders.length;

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
      const extraSku = Math.max(0, ord.skuCount - 3);
      ord.surchargeSku = extraSku * 100;
    }

    // E. Unidades
    if (updates.units !== null) {
      ord.unitsCount = updates.units;
      const extraUnits = Math.max(0, ord.unitsCount - 10);
      ord.surchargeUnits = extraUnits * 50;
    }

    // F. Marketplace
    if (updates.mkt !== null) {
      ord.isMarketplace = updates.mkt;
      const mktSurcharge = (billingState.pricingConfig?.pick_pack_rules?.surcharge_marketplace_collect) || 100;
      ord.surchargeMarketplace = ord.isMarketplace ? mktSurcharge : 0;
    }

    // G. Tarifa Base Pick & Pack
    if (updates.baseRate !== null) {
      ord.baseRate = updates.baseRate;
    }

    // Recalcular totales por pedido
    ord.pickPackTotal = ord.baseRate + ord.surchargeSku + ord.surchargeUnits + ord.surchargeMarketplace;
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
  const totalNet = Math.round(netStorageCost + totalPickPackNet + totalShippingNet + inboundNet + fixedFeeCLP + totalSuppliesNet + totalAdjustmentsNet);
  const totalIVA = Math.round(totalNet * 0.19);
  const totalGross = totalNet + totalIVA;

  b.totals = {
    ...b.totals,
    ordersCount: b.orders.length,
    billableOrdersCount: billableOrders.length,
    storageNet: netStorageCost,
    pickPackNet: totalPickPackNet,
    shippingRmFlexCount: billableShippingOrders.length,
    shippingRmFlexNet: totalShippingNet,
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

// // Agregar Fila Manual de Insumos
window.addNewManualSupplyRow = async function() {
  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-box-3-line" style="color:#5f06fa;"></i><span>Agregar Insumo o Caja</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">NOMBRE DEL INSUMO:</label>
        <input id="swal-supply-name" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" placeholder="Ej: Caja S 20x20x20 o Cinta Embalaje" value="Caja S 20x20x20">
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CANTIDAD:</label>
            <input id="swal-supply-qty" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" min="1" value="1">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">PRECIO UNITARIO ($ NETO):</label>
            <input id="swal-supply-price" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" min="0" placeholder="450" value="450">
          </div>
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Agregar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const name = document.getElementById('swal-supply-name')?.value?.trim();
      const qty = parseInt(document.getElementById('swal-supply-qty')?.value, 10) || 1;
      const price = parseInt(document.getElementById('swal-supply-price')?.value, 10) || 0;

      if (!name) {
        Swal.showValidationMessage('Ingresa un nombre para el insumo.');
        return false;
      }
      return { name, qty, price };
    }
  });

  if (formValues && formValues.name) {
    billingState.supplies.push({
      id: 'custom_' + Date.now(),
      name: formValues.name,
      unit: 'gl.',
      qty: formValues.qty,
      unitPrice: formValues.price,
      total: formValues.qty * formValues.price
    });
    billingState.isSaved = false;
    billingState.suppliesSessionKey = `${billingState.currentPeriodId}_${billingState.currentCommerce}`;
    recalculateFromCurrentState();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Insumo agregado',
      text: `Se agregó "${formValues.name}" al desglose.`,
      showConfirmButton: false,
      timer: 2500
    });
  }
};

// Eliminar un ítem de insumo
window.deleteManualSupplyItem = function(supplyIdOrIdx) {
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

// Editar un ítem de insumo (nombre, cantidad, precio)
window.editManualSupplyItem = async function(supplyIdOrIdx) {
  const b = billingState;
  const idx = b.supplies.findIndex((s, i) => String(s.id) === String(supplyIdOrIdx) || String(i) === String(supplyIdOrIdx));
  if (idx === -1) return;

  const item = b.supplies[idx];

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-pencil-line" style="color:#5f06fa;"></i><span>Editar Ítem de Insumo</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">NOMBRE DEL INSUMO:</label>
        <input id="swal-edit-supply-name" class="swal2-input" style="margin: 0 0 0.75rem 0; width: 100%; height: 38px; font-size: 0.85rem;" value="${escapeHtml(item.name)}">
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">CANTIDAD:</label>
            <input id="swal-edit-supply-qty" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" min="0" value="${item.qty || 1}">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 0.25rem;">PRECIO UNITARIO ($ NETO):</label>
            <input id="swal-edit-supply-price" type="number" class="swal2-input" style="margin: 0; width: 100%; height: 38px; font-size: 0.85rem;" min="0" value="${item.unitPrice || 0}">
          </div>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-line"></i> Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#5f06fa',
    preConfirm: () => {
      const name = document.getElementById('swal-edit-supply-name')?.value?.trim();
      const qty = parseInt(document.getElementById('swal-edit-supply-qty')?.value, 10);
      const price = parseInt(document.getElementById('swal-edit-supply-price')?.value, 10);

      if (!name) {
        Swal.showValidationMessage('El nombre del insumo no puede estar vacío.');
        return false;
      }
      if (isNaN(qty) || qty < 0) {
        Swal.showValidationMessage('Ingresa una cantidad válida.');
        return false;
      }
      if (isNaN(price) || price < 0) {
        Swal.showValidationMessage('Ingresa un precio unitario válido.');
        return false;
      }
      return { name, qty, price };
    }
  });

  if (formValues) {
    if (formValues.qty === 0) {
      b.supplies.splice(idx, 1);
    } else {
      item.name = formValues.name;
      item.qty = formValues.qty;
      item.unitPrice = formValues.price;
      item.total = formValues.qty * formValues.price;
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

// Modal interactivo para editar o eximir Costo Fijo Mensual
window.openEditFixedFeeModal = async function() {
  const b = billingState;
  const t = b.totals;

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.4rem;"><i class="ri-money-dollar-box-line" style="color: #5f06fa;"></i><span>Costo Fijo Mensual</span></div>',
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0; margin-bottom: 1rem;">
          Modifica el costo fijo mensual para este periodo. Puedes seleccionar un rango estándar, ingresar un monto personalizado o dejarlo como <strong>Exento ($0)</strong>.
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
          reasonInput.value = `Costo fijo 0.9 UF (${formatCLP(0.9 * b.ufValue)})`;
        } else if (modeSelect.value === '1.5') {
          reasonInput.value = `Costo fijo 1.5 UF (${formatCLP(1.5 * b.ufValue)})`;
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

    const totalSuppliesNet = b.supplies.reduce((acc, s) => acc + (s.total || 0), 0);
    const totalAdjustmentsNet = b.adjustments.reduce((acc, a) => acc + (a.amount || 0), 0);
    const inboundNet = b.totals.inboundNet || 0;
    const totalNet = Math.round(b.totals.storageNet + b.totals.pickPackNet + b.totals.shippingRmFlexNet + inboundNet + formValues.clp + totalSuppliesNet + totalAdjustmentsNet);
    const totalIVA = Math.round(totalNet * 0.19);
    const totalGross = totalNet + totalIVA;

    b.totals.totalNet = totalNet;
    b.totals.iva = totalIVA;
    b.totals.totalGross = totalGross;
    b.totals.totalToPay = totalGross;

    b.isSaved = false;
    renderKPIsUI();

    const desgloseCont = document.getElementById('bg-desglose-view-container');
    if (desgloseCont) desgloseCont.innerHTML = renderStockaDesgloseHTML();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Costo fijo actualizado',
      showConfirmButton: false,
      timer: 2500
    });
  }
};


// Modal de Configuración y Edición de Tipos de Entrega y Tarifas
window.openDeliveryTypesManagerModal = async function() {
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
              uploadBillingSnapshotToStorage(cachedObj).catch(errUp => console.warn('Aviso sincronizando snapshot en Storage:', errUp));
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
  const noAgenda = orders.filter(o => !o.agenda || o.agenda.trim() === '' || o.agenda === '—').length;
  const withAgenda = total - noAgenda;
  const rmFlex = orders.filter(o => o.deliveryType === 'RM_STK' || o.deliveryType === 'COLINA' || o.deliveryType === 'FLEX').length;
  const enviame = orders.filter(o => o.deliveryType === 'ENVIAME_REGION').length;
  const centroEnvios = orders.filter(o => o.deliveryType === 'CENTRO_ENVIOS').length;
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
  setElText('qf-count-centro-envios', centroEnvios);
  setElText('qf-count-mkt', mkt);
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
    const rawAgenda = (o.agenda || '').trim();
    if (!rawAgenda || rawAgenda === '—' || rawAgenda === '-') {
      noAgendaCount++;
    } else {
      withAgendaCount++;
      agendaMap[rawAgenda] = (agendaMap[rawAgenda] || 0) + 1;
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
  const agendaSelect = document.getElementById('bg-col-filter-agenda');
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
  const agendaFilter = agendaSelect ? agendaSelect.value : (window.bgFilterState?.agenda || '');
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
    agenda: agendaFilter,
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
    countBadge.textContent = `Mostrando ${visibleCount} de ${totalCount} pedidos`;
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

  const isAnyFilterActive = !!(globalQuery || incFilter || orderQuery || agendaFilter || destQuery || !isNaN(ticketMin) || !isNaN(ticketMax) || deliveryFilter || !isNaN(skusMin) || !isNaN(unitsMin) || mktFilter);
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
    title: 'Confirmar aplicación o exención del Costo Fijo Mensual',
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
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.85rem;
      margin-bottom: 1.5rem;
    }

    @media (max-width: 860px) {
      .client-billing-modal-view .stocka-metric-row {
        grid-template-columns: repeat(2, 1fr);
      }
      .client-billing-modal-view .stocka-desglose-paper {
        padding: 1.5rem 1.25rem;
      }
    }

    @media (max-width: 520px) {
      .client-billing-modal-view .stocka-metric-row {
        grid-template-columns: 1fr;
      }
    }

    .client-billing-modal-view .stocka-metric-card {
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

    .client-billing-modal-view .stocka-metric-title {
      font-size: 0.7rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.35rem;
    }

    .client-billing-modal-view .stocka-metric-value {
      font-size: 1.35rem;
      font-weight: 800;
      color: #0f172a;
      font-family: 'Outfit', sans-serif;
      line-height: 1.2;
    }

    .client-billing-modal-view .stocka-metric-sub {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 0.35rem;
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
  let changed = false;

  snapshot.orders.forEach(o => {
    if (o.isMarketplace && (!o.surchargeMarketplace || o.surchargeMarketplace === 0)) {
      o.surchargeMarketplace = mktRate;
      o.pickPackTotal = (o.baseRate || 0) + (o.surchargeSku || 0) + (o.surchargeUnits || 0) + o.surchargeMarketplace;
      o.orderTotal = o.pickPackTotal + (o.shippingFreight || 0);
      changed = true;
    } else if (!o.isMarketplace && o.surchargeMarketplace > 0) {
      o.surchargeMarketplace = 0;
      o.pickPackTotal = (o.baseRate || 0) + (o.surchargeSku || 0) + (o.surchargeUnits || 0);
      o.orderTotal = o.pickPackTotal + (o.shippingFreight || 0);
      changed = true;
    }
  });

  if (changed && snapshot.totals) {
    const billable = snapshot.orders.filter(o => !o.isExcluded);
    snapshot.totals.pickPackNet = billable.reduce((acc, o) => acc + (o.pickPackTotal || 0), 0);
    const storageNet = snapshot.totals.storageNet || 0;
    const shippingNet = snapshot.totals.shippingRmFlexNet || 0;
    const inboundNet = snapshot.totals.inboundNet || 0;
    const fixedFeeNet = snapshot.totals.fixedFeeNet || 0;
    const suppliesNet = Array.isArray(snapshot.supplies) ? snapshot.supplies.reduce((acc, s) => acc + (s.total || 0), 0) : 0;
    const adjustmentsNet = Array.isArray(snapshot.adjustments) ? snapshot.adjustments.reduce((acc, a) => acc + (a.amount || 0), 0) : 0;
    snapshot.totals.totalNet = Math.round(storageNet + snapshot.totals.pickPackNet + shippingNet + inboundNet + fixedFeeNet + suppliesNet + adjustmentsNet);
    snapshot.totals.iva = Math.round(snapshot.totals.totalNet * 0.19);
    snapshot.totals.totalGross = snapshot.totals.totalNet + snapshot.totals.iva;
    snapshot.totals.totalToPay = snapshot.totals.totalGross;
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

  // 1. Intentar obtener snapshot desde localStorage o desde Supabase Storage (fulfillment_link)
  const cacheKey = `stocka_fulfillment_details_${rec.period_id}_${rec.comercio}`;
  let snapshot = null;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) snapshot = JSON.parse(cached);
  } catch (e) {}

  if (!snapshot && rec.fulfillment_link && (rec.fulfillment_link.startsWith('http://') || rec.fulfillment_link.startsWith('https://'))) {
    try {
      const fetchUrl = rec.fulfillment_link + (rec.fulfillment_link.includes('?') ? '&' : '?') + 't=' + Date.now();
      const resp = await fetch(fetchUrl);
      if (resp.ok) {
        snapshot = await resp.json();
        try { localStorage.setItem(cacheKey, JSON.stringify(snapshot)); } catch (e) {}
      }
    } catch (fetchErr) {
      console.warn('Error al descargar snapshot JSON de Storage:', fetchErr);
    }
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
        const { data: dbOrders } = await supabase
          .from('orders')
          .select('id, external_order_number, external_platform, raw_shopify_data, raw_woocommerce_data, raw_meli_data')
          .in('id', orderIds);
        if (dbOrders && dbOrders.length > 0) {
          const oMap = {};
          dbOrders.forEach(dbo => { oMap[dbo.id] = dbo; });
          snapshot.orders.forEach(o => {
            const dbo = oMap[o.id];
            if (dbo) {
              const plat = dbo.external_platform || (dbo.raw_shopify_data ? 'Shopify' : (dbo.raw_woocommerce_data ? 'WooCommerce' : (dbo.raw_meli_data ? 'Mercado Libre' : 'Manual')));
              o.platform = o.platform || plat;
              o.externalPlatform = o.externalPlatform || plat;
              const refNum = dbo.external_order_number || dbo.raw_shopify_data?.name || (dbo.raw_shopify_data?.order_number ? `#${dbo.raw_shopify_data.order_number}` : null);
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

  modalOverlay.innerHTML = `
    <div class="client-billing-modal-container">
      <!-- Modal Header -->
      <div class="client-billing-modal-header">
        <div style="display: flex; align-items: center; gap: 0.85rem;">
          <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka" class="modal-stocka-logo-light" style="height: 34px; width: auto; object-fit: contain;">
          <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/Stocka_1300_x_500_px_519_x_200_px_5.png?v=1779650350" alt="Stocka" class="modal-stocka-logo-dark" style="height: 34px; width: auto; object-fit: contain;">
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--color-text-main, #0f172a); display: flex; align-items: center; gap: 0.5rem;">
              <span>Facturación Fulfillment 360</span>
              <span style="font-size: 0.75rem; background: rgba(95, 6, 250, 0.1); color: #5f06fa; padding: 2px 8px; border-radius: 50px; font-weight: 800;">${escapeHtml(snapshot.comercio)}</span>
            </h3>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.775rem; color: var(--color-text-muted, #64748b);">
              Periodo: <strong>${escapeHtml(snapshot.periodName || '')}</strong> • Total a Pagar: <strong style="color: #5f06fa; font-size: 0.85rem;">${formatCLP(totals.totalToPay || rec.total_fulfillment || 0)}</strong> (IVA incl.)
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
          <button type="button" onclick="window.closeClientInteractiveBillingModal()" style="background: transparent; border: none; cursor: pointer; color: var(--color-text-muted, #64748b); font-size: 1.6rem; line-height: 1; padding: 2px 6px; border-radius: 6px;" title="Cerrar ventana">
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

              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <div style="position: relative;">
                  <input type="text" id="client-orders-filter-input" class="form-input" placeholder="Buscar por N° Pedido, Plataforma, Comuna u Operador..." style="height: 36px; font-size: 0.8rem; margin: 0; width: 260px; padding-left: 2rem; border-radius: 8px;" oninput="window.filterClientOrdersTable()">
                  <i class="ri-search-line" style="position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted, #94a3b8);"></i>
                </div>
                <span id="client-orders-filter-count" style="font-size: 0.75rem; font-weight: 700; color: #5f06fa; background: rgba(95, 6, 250, 0.08); padding: 5px 10px; border-radius: 6px;">
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
                    <th style="min-width: 95px;">Fecha</th>
                    <th style="min-width: 120px;">Agenda</th>
                    <th style="min-width: 160px;">Destino / Comuna</th>
                    <th style="min-width: 110px;">Operador</th>
                    <th style="min-width: 130px;">Tipo Entrega</th>
                    <th style="width: 55px; text-align: center;">SKUs</th>
                    <th style="width: 55px; text-align: center;">Unid.</th>
                    <th style="width: 95px; text-align: right;">Prep. Total</th>
                    <th style="width: 95px; text-align: right;">Flete Envío</th>
                    <th class="th-total-order" style="width: 105px; text-align: right;">Total Pedido</th>
                  </tr>
                </thead>
                <tbody id="client-modal-orders-body">
                  ${orders.map((o, idx) => {
                    const refDisplay = o.orderNumber || o.externalOrderNumber || (o.id ? o.id.slice(0, 8) : '—');
                    const platformName = o.platform || o.externalPlatform || (o.isMarketplace ? 'Marketplace' : 'Shopify');
                    return `
                    <tr class="client-modal-order-row">
                      <td class="cm-cell-num">${idx + 1}</td>
                      <td class="cm-cell-id">
                        <div style="font-weight: 800; font-size: 0.85rem; color: #a855f7;">${escapeHtml(refDisplay)}</div>
                        <div style="font-size: 0.68rem; color: var(--color-text-muted); font-family: monospace; font-weight: 500;" title="ID WMS: ${escapeHtml(o.id || '')}">
                          ${escapeHtml((o.id || '').slice(0, 13))}...
                        </div>
                      </td>
                      <td style="text-align: center;">
                        ${getPlatformBadgeHTML(platformName)}
                      </td>
                      <td class="cm-cell-date">${escapeHtml(o.date || '—')}</td>
                      <td class="cm-cell-agenda ${o.agenda ? '' : 'empty'}">${escapeHtml(o.agenda || 'Sin agenda')}</td>
                      <td class="cm-cell-dest">${escapeHtml(o.destination || 'Santiago')}</td>
                      <td class="cm-cell-op">${escapeHtml(o.operador || '—')}</td>
                      <td>
                        <span class="cm-delivery-badge">
                          ${escapeHtml(o.deliveryType || 'Estándar')}
                        </span>
                      </td>
                      <td class="cm-cell-qty">${o.skuCount || 1}</td>
                      <td class="cm-cell-qty">${o.unitsCount || 1}</td>
                      <td class="cm-cell-money">${formatCLP(o.pickPackTotal || 0)}</td>
                      <td class="cm-cell-money">${formatCLP(o.shippingFreight || 0)}</td>
                      <td class="cm-cell-total">${formatCLP(o.orderTotal || 0)}</td>
                    </tr>
                    `;
                  }).join('') || `<tr><td colspan="13" style="text-align: center; padding: 2rem; color: #94a3b8;">No se registraron pedidos en el periodo.</td></tr>`}
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
      renderBillingAnalyticsCharts('client-modal-analytics-mount', window.__currentClientBillingSnapshot);
    }
  }
}

// Cerrar el modal interactivo
export function closeClientInteractiveBillingModal() {
  const modalOverlay = document.getElementById('client-billing-interactive-modal');
  if (modalOverlay) {
    modalOverlay.style.display = 'none';
  }
}

// Filtrar la tabla de pedidos dentro del modal del cliente
export function filterClientOrdersTable() {
  const query = (document.getElementById('client-orders-filter-input')?.value || '').toLowerCase().trim();
  const rows = document.querySelectorAll('.client-modal-order-row');
  let visible = 0;

  rows.forEach(r => {
    const text = r.innerText.toLowerCase();
    if (!query || text.includes(query)) {
      r.style.display = '';
      visible++;
    } else {
      r.style.display = 'none';
    }
  });

  const countBadge = document.getElementById('client-orders-filter-count');
  if (countBadge) {
    countBadge.textContent = `Mostrando ${visible} de ${rows.length} pedidos`;
  }
}

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
        try { snapshot = JSON.parse(localStorage.getItem(cacheKey)); } catch (e) {}

        if (!snapshot && rec.fulfillment_link && (rec.fulfillment_link.startsWith('http://') || rec.fulfillment_link.startsWith('https://'))) {
          const fetchUrl = rec.fulfillment_link + (rec.fulfillment_link.includes('?') ? '&' : '?') + 't=' + Date.now();
          const resp = await fetch(fetchUrl);
          if (resp.ok) snapshot = await resp.json();
        }
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
        try { snapshot = JSON.parse(localStorage.getItem(cacheKey)); } catch (e) {}

        if (!snapshot && rec.fulfillment_link && (rec.fulfillment_link.startsWith('http://') || rec.fulfillment_link.startsWith('https://'))) {
          const resp = await fetch(rec.fulfillment_link);
          if (resp.ok) snapshot = await resp.json();
        }
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

  exportBillingToExcel(snapshot);
}

// Exportar todas las funciones al scope global window
window.openClientInteractiveBillingModal = openClientInteractiveBillingModal;
window.switchClientBillingTab = switchClientBillingTab;
window.closeClientInteractiveBillingModal = closeClientInteractiveBillingModal;
window.filterClientOrdersTable = filterClientOrdersTable;
window.downloadClientBillingPdf = downloadClientBillingPdf;
window.downloadClientBillingExcel = downloadClientBillingExcel;
window.confirmAndPublishBillingToCommerce = confirmAndPublishBillingToCommerce;
window.uploadBillingSnapshotToStorage = uploadBillingSnapshotToStorage;
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


