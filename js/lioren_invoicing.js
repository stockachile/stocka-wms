// js/lioren_invoicing.js - Módulo de Emisión Automática de Facturas Electrónicas (DTE 33/34/61) vía LIOREN API
import supabase from './supabase.js';
import { LIOREN_CATALOGS } from './lioren_catalogs_data.js';

const LIOREN_EDGE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/lioren-api';
const BREVO_EMAIL_EDGE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email';

// Exponer catálogo en window para uso transversal en admin.js
window.LIOREN_CATALOGS = LIOREN_CATALOGS;

let cachedLiorenStatus = null;
let cachedLiorenStatusTs = 0;

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMUNA_TYPO_ALIASES = {
  provindencia: 'providencia',
  'santiago centro': 'santiago',
  stgo: 'santiago',
  'las conde': 'las condes',
  vitacuras: 'vitacura',
  pudahueles: 'pudahuel',
  'san bernado': 'san bernardo',
  'vina del mar': 'vina del mar'
};

// Resuelve automáticamente IDs enteros de Comuna y Ciudad de Lioren a partir de texto libre
export function resolveLiorenLocalityIds(comunaInput, ciudadInput = '') {
  const comunas = LIOREN_CATALOGS?.comunas || [];
  const ciudades = LIOREN_CATALOGS?.ciudades || [];

  let normComuna = normText(comunaInput);
  if (COMUNA_TYPO_ALIASES[normComuna]) {
    normComuna = COMUNA_TYPO_ALIASES[normComuna];
  }

  let matchedComuna = null;
  if (normComuna) {
    matchedComuna =
      comunas.find(c => normText(c.nombre) === normComuna) ||
      comunas.find(c => normText(c.nombre).startsWith(normComuna) || normComuna.startsWith(normText(c.nombre)));
  }

  let matchedCiudad = null;
  const normCiudad = normText(ciudadInput);

  if (matchedComuna) {
    const regionCiudades = ciudades.filter(ci => ci.region_id === matchedComuna.region_id);
    if (normCiudad) {
      matchedCiudad = regionCiudades.find(ci => normText(ci.nombre) === normCiudad) || null;
    }
    if (!matchedCiudad) {
      // Si existe una ciudad con el mismo nombre de la comuna en esa región (ej: Colina, Buin, Temuco, Concepción)
      matchedCiudad = regionCiudades.find(ci => normText(ci.nombre) === normText(matchedComuna.nombre)) || null;
    }
    if (!matchedCiudad && matchedComuna.region_id === 15) {
      // En Región Metropolitana (region_id = 15), la ciudad por defecto para comunas urbanas del Gran Santiago es Santiago (id: 176)
      matchedCiudad = regionCiudades.find(ci => ci.id === 176) || regionCiudades[0] || null;
    }
    if (!matchedCiudad && regionCiudades.length > 0) {
      matchedCiudad = regionCiudades[0];
    }
  } else if (normCiudad) {
    matchedCiudad = ciudades.find(ci => normText(ci.nombre) === normCiudad) || null;
  }

  return {
    comunaId: matchedComuna ? matchedComuna.id : null,
    comunaNombre: matchedComuna ? matchedComuna.nombre : (comunaInput || ''),
    ciudadId: matchedCiudad ? matchedCiudad.id : null,
    ciudadNombre: matchedCiudad ? matchedCiudad.nombre : (ciudadInput || ''),
    regionId: matchedComuna ? matchedComuna.region_id : (matchedCiudad ? matchedCiudad.region_id : null)
  };
}

window.resolveLiorenLocalityIds = resolveLiorenLocalityIds;

// Validador Módulo 11 de RUT Chileno
export function validateChileanRut(raw) {
  const cleaned = String(raw || '').replace(/[^0-9kK]/g, '').toUpperCase().trim();
  if (cleaned.length < 7 || cleaned.length > 10) {
    return { valid: false, formatted: String(raw || '').trim() };
  }
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) {
    return { valid: false, formatted: String(raw || '').trim() };
  }
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const mod = 11 - (sum % 11);
  const expectedDv = mod === 11 ? '0' : mod === 10 ? 'K' : String(mod);
  return {
    valid: dv === expectedDv,
    formatted: `${body}-${dv}`,
    expectedDv
  };
}

function formatCLP(val) {
  if (typeof window.formatCLP === 'function') return window.formatCLP(val);
  return '$' + Math.round(Number(val) || 0).toLocaleString('es-CL');
}

function computeBusinessDays(startDateStr, daysToAdd) {
  if (typeof window.addBusinessDaysLocal === 'function') {
    return window.addBusinessDaysLocal(startDateStr, daysToAdd);
  }
  const d = startDateStr ? new Date(startDateStr + 'T00:00:00') : new Date();
  let added = 0;
  while (added < daysToAdd) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toLocaleDateString('sv-SE');
}

async function callLiorenApi(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Tu sesión ha expirado. Vuelve a iniciar sesión para conectar con Lioren API.');
  }

  const res = await fetch(LIOREN_EDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Error HTTP ${res.status} al conectar con Lioren API`);
  }
  return data;
}

export async function getLiorenStatus(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedLiorenStatus && (now - cachedLiorenStatusTs < 60000)) {
    return cachedLiorenStatus;
  }
  const data = await callLiorenApi({ action: 'status' });
  cachedLiorenStatus = data;
  cachedLiorenStatusTs = now;
  return data;
}

function injectLiorenStyles() {
  if (document.getElementById('lioren-invoicing-styles')) return;
  const style = document.createElement('style');
  style.id = 'lioren-invoicing-styles';
  style.innerHTML = `
    .lioren-emit-modal-card {
      max-width: 1040px !important;
      width: 96vw !important;
      max-height: 94vh !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      border-radius: 16px !important;
      padding: 0 !important;
      box-shadow: 0 24px 60px -12px rgba(15, 23, 42, 0.28) !important;
    }
    .lioren-emit-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.4rem;
      border-bottom: 1px solid var(--color-border);
      background: var(--color-surface);
      flex-shrink: 0;
    }
    .lioren-emit-header-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .lioren-emit-icon-box {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(109, 40, 217, 0.14), rgba(79, 70, 229, 0.18));
      border: 1px solid rgba(109, 40, 217, 0.25);
      color: #6d28d9;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      flex-shrink: 0;
    }
    [data-theme="dark"] .lioren-emit-icon-box {
      color: #c4b5fd;
      border-color: rgba(167, 139, 250, 0.3);
    }
    .lioren-emit-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.85rem;
      flex-wrap: wrap;
      padding: 0.7rem 1.4rem;
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .lioren-mode-tabs {
      display: inline-grid;
      grid-template-columns: auto auto;
      gap: 0.3rem;
      background: var(--color-surface-hover, rgba(148, 163, 184, 0.14));
      padding: 0.25rem;
      border-radius: 10px;
      border: 1px solid var(--color-border);
      margin: 0;
    }
    .lioren-mode-tab {
      border: none;
      background: transparent;
      color: var(--color-text-muted);
      font-size: 0.79rem;
      font-weight: 700;
      padding: 0.44rem 0.9rem;
      border-radius: 7px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      transition: all 0.18s ease;
      white-space: nowrap;
    }
    .lioren-mode-tab.active {
      background: var(--color-surface, #ffffff);
      color: #6d28d9;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
    }
    [data-theme="dark"] .lioren-mode-tab.active {
      background: #1e293b;
      color: #c4b5fd;
    }
    .lioren-env-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.65rem;
      padding: 0.48rem 0.85rem;
      border-radius: 9px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 0.9rem;
    }
    .lioren-env-banner.compact-bar {
      margin-bottom: 0;
      flex: 1;
      min-width: 280px;
      max-width: 520px;
    }
    .lioren-env-banner.sandbox {
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.35);
      color: #b45309;
    }
    [data-theme="dark"] .lioren-env-banner.sandbox {
      color: #fcd34d;
    }
    .lioren-env-banner.production {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #047857;
    }
    [data-theme="dark"] .lioren-env-banner.production {
      color: #6ee7b7;
    }
    .lioren-emit-body {
      padding: 1.15rem 1.4rem;
      overflow-y: auto;
      flex: 1;
      background: var(--color-surface);
    }
    .lioren-emit-columns {
      display: grid;
      grid-template-columns: 1.06fr 1fr;
      gap: 1.15rem;
      align-items: start;
    }
    @media (max-width: 860px) {
      .lioren-emit-columns {
        grid-template-columns: 1fr;
      }
      .lioren-env-banner.compact-bar {
        max-width: 100%;
      }
    }
    .lioren-col-stack {
      display: flex;
      flex-direction: column;
      gap: 0.95rem;
    }
    .lioren-section-box {
      background: var(--color-bg, #f8fafc);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 1rem 1.1rem;
      margin-bottom: 0.9rem;
    }
    .lioren-col-stack .lioren-section-box {
      margin-bottom: 0;
    }
    [data-theme="dark"] .lioren-section-box {
      background: rgba(15, 23, 42, 0.55);
    }
    .lioren-section-title {
      font-size: 0.74rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.045em;
      color: #5b21b6;
      margin-bottom: 0.8rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    [data-theme="dark"] .lioren-section-title {
      color: #c4b5fd;
    }
    .lioren-field-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-text-main);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.35rem;
      margin-bottom: 0.3rem;
    }
    .lioren-ctrl-input,
    .lioren-ctrl-select {
      width: 100%;
      height: 40px !important;
      padding: 0 0.8rem !important;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      background-color: var(--color-surface);
      color: var(--color-text-main);
      font-family: var(--font-family);
      font-size: 0.85rem;
      line-height: 1.25 !important;
      box-sizing: border-box;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .lioren-ctrl-select {
      padding-right: 1.9rem !important;
      line-height: normal !important;
      cursor: pointer;
    }
    .lioren-ctrl-input:focus,
    .lioren-ctrl-select:focus {
      outline: none;
      border-color: #6d28d9;
      box-shadow: 0 0 0 3px rgba(109, 40, 217, 0.14);
    }
    .lioren-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    @media (max-width: 560px) {
      .lioren-grid-2 {
        grid-template-columns: 1fr;
      }
    }
    .lioren-Amounts-box {
      display: grid;
      grid-template-columns: 1fr 0.95fr 1.15fr;
      gap: 0.65rem;
      background: linear-gradient(135deg, rgba(109, 40, 217, 0.05), rgba(79, 70, 229, 0.07));
      border: 1px solid rgba(109, 40, 217, 0.22);
      border-radius: 10px;
      padding: 0.8rem;
    }
    @media (max-width: 560px) {
      .lioren-Amounts-box {
        grid-template-columns: 1fr;
      }
    }
    [data-theme="dark"] .lioren-Amounts-box {
      background: rgba(139, 92, 246, 0.1);
      border-color: rgba(139, 92, 246, 0.3);
    }
    .lioren-due-preset {
      padding: 0.2rem 0.6rem;
      font-size: 0.72rem;
      font-weight: 600;
      border-radius: 999px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-main);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .lioren-due-preset:hover {
      border-color: #6d28d9;
      color: #6d28d9;
      background: rgba(109, 40, 217, 0.07);
    }
    [data-theme="dark"] .lioren-due-preset:hover {
      color: #c4b5fd;
      border-color: #a78bfa;
    }
    .lioren-emit-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-top: 1.05rem;
      padding-top: 0.95rem;
      border-top: 1px solid var(--color-border);
    }
    .lioren-brevo-card {
      background: rgba(16, 185, 129, 0.08);
      padding: 0.75rem 0.9rem;
      border-radius: 10px;
      border: 1px solid rgba(16, 185, 129, 0.28);
      transition: all 0.18s ease;
    }
    .lioren-brevo-card.unchecked {
      background: var(--color-surface);
      border-color: var(--color-border);
      opacity: 0.82;
    }
    .btn-lioren-preview-email {
      display: inline-flex;
      align-items: center;
      gap: 0.32rem;
      height: 29px;
      padding: 0 0.68rem;
      border-radius: 7px;
      border: 1px solid rgba(16, 185, 129, 0.45);
      background: var(--color-surface, #ffffff);
      color: #059669;
      font-size: 0.73rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.16s ease;
      flex-shrink: 0;
    }
    .btn-lioren-preview-email:hover {
      background: #059669;
      color: #ffffff;
      border-color: #059669;
      box-shadow: 0 3px 8px rgba(5, 150, 105, 0.22);
    }
    [data-theme="dark"] .btn-lioren-preview-email {
      background: rgba(15, 23, 42, 0.85);
      color: #6ee7b7;
      border-color: rgba(110, 231, 183, 0.35);
    }
    [data-theme="dark"] .btn-lioren-preview-email:hover {
      background: #059669;
      color: #ffffff;
    }
    .lioren-recipient-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.12rem 0.48rem;
      border-radius: 999px;
      background: var(--color-surface, #ffffff);
      color: #047857;
      border: 1px solid rgba(16, 185, 129, 0.32);
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-theme="dark"] .lioren-recipient-chip {
      background: rgba(15, 23, 42, 0.8);
      color: #6ee7b7;
    }
    .lioren-email-preview-layout {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 1.15rem;
      align-items: stretch;
      min-height: 0;
      flex: 1;
    }
    @media (max-width: 900px) {
      .lioren-email-preview-layout {
        grid-template-columns: 1fr;
      }
    }
    .btn-lioren-quick-emit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      height: 26px;
      padding: 0 0.45rem;
      border-radius: 6px;
      border: 1px solid rgba(124, 58, 237, 0.35);
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.14), rgba(99, 102, 241, 0.14));
      color: #6d28d9;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }
    .btn-lioren-quick-emit:hover {
      background: #6d28d9;
      color: #ffffff;
      border-color: #6d28d9;
      transform: translateY(-1px);
    }
    [data-theme="dark"] .btn-lioren-quick-emit {
      color: #c4b5fd;
      border-color: rgba(167, 139, 250, 0.4);
    }
    [data-theme="dark"] .btn-lioren-quick-emit:hover {
      background: #7c3aed;
      color: #ffffff;
    }
    .lioren-sii-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 0.14rem 0.45rem;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .lioren-sii-pill.acepta { background: rgba(16, 185, 129, 0.15); color: #059669; border: 1px solid rgba(16, 185, 129, 0.35); }
    .lioren-sii-pill.pendiente { background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); }
    .lioren-sii-pill.reparo { background: rgba(59, 130, 246, 0.15); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.35); }
    .lioren-sii-pill.rechazo { background: rgba(239, 68, 68, 0.15); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.35); }
    .btn-lioren-1click {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.28rem;
      height: 28px;
      padding: 0 0.62rem;
      border-radius: 7px;
      border: none;
      background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%);
      color: #ffffff;
      font-size: 0.74rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.16s ease;
      box-shadow: 0 2px 6px rgba(109, 40, 217, 0.25);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .btn-lioren-1click:hover:not(:disabled) {
      filter: brightness(1.08);
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(109, 40, 217, 0.35);
    }
    .btn-lioren-1click:disabled {
      opacity: 0.65;
      cursor: wait;
      transform: none;
    }
    .btn-lioren-1click.compact {
      height: 26px;
      padding: 0 0.45rem;
      font-size: 0.7rem;
      border-radius: 6px;
    }
    .btn-lioren-1click.needs-setup {
      background: rgba(245, 158, 11, 0.14);
      color: #b45309;
      border: 1px solid rgba(245, 158, 11, 0.4);
      box-shadow: none;
    }
    [data-theme="dark"] .btn-lioren-1click.needs-setup {
      color: #fcd34d;
    }
    .btn-lioren-1click.needs-setup:hover:not(:disabled) {
      background: #f59e0b;
      color: #ffffff;
    }
    .lioren-bulk-kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.65rem;
      margin-bottom: 0.9rem;
    }
    @media (max-width: 600px) {
      .lioren-bulk-kpi-grid { grid-template-columns: 1fr; }
    }
    .lioren-bulk-kpi {
      padding: 0.65rem 0.8rem;
      border-radius: 9px;
      border: 1px solid var(--color-border);
      background: var(--color-surface-hover, rgba(148, 163, 184, 0.06));
    }
    .lioren-progress-track {
      width: 100%;
      height: 9px;
      border-radius: 999px;
      background: rgba(109, 40, 217, 0.12);
      overflow: hidden;
      margin: 0.5rem 0;
    }
    .lioren-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #6d28d9, #10b981);
      border-radius: 999px;
      transition: width 0.25s ease;
    }
  `;
  document.head.appendChild(style);
}

injectLiorenStyles();

export function renderLiorenSiiBadgeHtml(status) {
  if (!status) return '';
  const st = String(status).toLowerCase();
  if (st.startsWith('anulada_nc')) {
    const ncNum = st.replace('anulada_nc_', '');
    return `<span class="lioren-sii-pill rechazo" title="Anulada con Nota de Crédito #${escHtml(ncNum)}"><i class="ri-close-circle-line"></i> NC #${escHtml(ncNum)}</span>`;
  }
  const labels = {
    acepta: 'Aceptada SII',
    pendiente: 'Pendiente SII',
    reparo: 'Reparo SII',
    rechazo: 'Rechazada SII'
  };
  const cls = labels[st] ? st : 'pendiente';
  const lbl = labels[st] || status;
  return `<span class="lioren-sii-pill ${cls}"><i class="ri-shield-check-line"></i> ${escHtml(lbl)}</span>`;
}
window.renderLiorenSiiBadgeHtml = renderLiorenSiiBadgeHtml;

async function refreshViewsAfterInvoiceAction(periodId, recordId, serviceType) {
  try {
    if (typeof window.fetchBillingCommerceLegalDataset === 'function') {
      await window.fetchBillingCommerceLegalDataset(true);
    }
    if (typeof window.refreshDashboardData === 'function') {
      await window.refreshDashboardData();
    }
    if (periodId && typeof window.loadBillingRecords === 'function') {
      const bodyEl = document.getElementById(`period-body-${periodId}`);
      if (bodyEl) {
        await window.loadBillingRecords(periodId, bodyEl);
      }
    }
    if (document.getElementById('bg-period-overview-body') && typeof window.loadAndRenderPeriodOverview === 'function') {
      if (window.bgOverviewSelectedRecordIds) window.bgOverviewSelectedRecordIds.clear();
      await window.loadAndRenderPeriodOverview();
    }
    if (typeof window.syncGeneratorInvoiceBannerFromDb === 'function') {
      await window.syncGeneratorInvoiceBannerFromDb();
    }
    if (recordId && document.getElementById('modal-billing-commerce-detail') && typeof window.openBillingCommerceDetailModal === 'function') {
      const tab = serviceType === 'enviame' ? 'env' : 'fulf';
      await window.openBillingCommerceDetailModal(recordId, periodId, tab);
    }
  } catch (e) {
    console.warn('Aviso al refrescar vistas post-facturación:', e);
  }
}

// ============================================================================
// MODAL 1: ESTADO DE CONEXIÓN LIOREN API & FOLIOS SII
// ============================================================================
window.openLiorenConnectionStatusModal = async function() {
  injectLiorenStyles();
  const existing = document.getElementById('modal-lioren-connection-status');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-lioren-connection-status';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '1150';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 560px; width: 95%;">
      <div class="modal-header">
        <h3 style="margin: 0; display: flex; align-items: center; gap: 0.5rem; font-size: 1.05rem;">
          <i class="ri-flashlight-fill" style="color: #7c3aed;"></i> Conexión LIOREN API — Facturación SII
        </h3>
        <button type="button" class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body" id="lioren-status-modal-body" style="padding: 1.25rem;">
        <div style="text-align: center; padding: 2rem 1rem; color: var(--color-text-muted);">
          <i class="ri-loader-4-line spin" style="font-size: 1.8rem; display: block; margin-bottom: 0.5rem; color: #7c3aed;"></i>
          Verificando credenciales, Certificado Digital SII y folios CAF en Lioren...
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const bodyEl = document.getElementById('lioren-status-modal-body');
  try {
    const st = await getLiorenStatus(true);
    const emp = st.miempresa || {};
    const who = st.whoami || {};
    const folios = st.folios || {};
    const acts = st.actividades || [];

    const folioRows = Object.entries(folios).map(([code, f]) => `
      <tr style="border-bottom: 1px solid var(--color-border);">
        <td style="padding: 0.45rem 0.5rem; font-weight: 700;">DTE ${escHtml(code)}</td>
        <td style="padding: 0.45rem 0.5rem;">${escHtml(f.nombre)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; font-weight: 700; color: ${f.disponibles > 10 ? '#10b981' : (f.disponibles > 0 ? '#f59e0b' : '#ef4444')};">${f.disponibles}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; color: var(--color-text-muted);">${f.siguiente ? '#' + f.siguiente : '—'}</td>
      </tr>
    `).join('');

    bodyEl.innerHTML = `
      <div class="lioren-env-banner ${st.isSandbox ? 'sandbox' : 'production'}">
        <span>
          <i class="${st.isSandbox ? 'ri-flask-fill' : 'ri-shield-check-fill'}"></i>
          ${st.isSandbox ? 'ENTORNO DE PRUEBAS (SANDBOX ACTIVO)' : 'ENTORNO DE PRODUCCIÓN OFICIAL SII'}
        </span>
        <span>RUT Emisor: ${escHtml(emp.rut || '—')}</span>
      </div>

      <div class="lioren-section-box">
        <div class="lioren-section-title"><span><i class="ri-building-4-line"></i> Empresa Autenticada en Lioren</span></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.8rem;">
          <div><strong style="color: var(--color-text-muted);">Razón Social:</strong><br>${escHtml(emp.rs || '—')}</div>
          <div><strong style="color: var(--color-text-muted);">Giro:</strong><br>${escHtml(emp.giro || '—')}</div>
          <div><strong style="color: var(--color-text-muted);">Certificado SII Vigente Hasta:</strong><br>${escHtml(who.sii_certificate?.expires_at || emp.validto || '—')}</div>
          <div><strong style="color: var(--color-text-muted);">Token API Expira:</strong><br>${escHtml(who.token?.expires_at || '—')}</div>
        </div>
        ${acts.length > 0 ? `
          <div style="margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed var(--color-border); font-size: 0.76rem;">
            <strong style="color: var(--color-text-muted);">Actividades Económicas SII:</strong>
            <ul style="margin: 0.25rem 0 0 1.1rem; padding: 0;">
              ${acts.map(a => `<li><code>${escHtml(a.codigo || a.codigosii)}</code> — ${escHtml(a.nombre)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>

      <div class="lioren-section-box">
        <div class="lioren-section-title"><span><i class="ri-numbers-line"></i> Disponibilidad de Folios Autorizados (CAF)</span></div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border); color: var(--color-text-muted); text-align: left;">
              <th style="padding: 0.35rem 0.5rem;">Código</th>
              <th style="padding: 0.35rem 0.5rem;">Documento</th>
              <th style="padding: 0.35rem 0.5rem; text-align: right;">Disponibles</th>
              <th style="padding: 0.35rem 0.5rem; text-align: right;">Próximo</th>
            </tr>
          </thead>
          <tbody>${folioRows}</tbody>
        </table>
      </div>

      <div class="lioren-section-box" style="margin-bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 220px;">
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-main);"><i class="ri-team-line" style="color: #7c3aed;"></i> Círculo de Compradores Lioren</div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.15rem;">Importa automáticamente Giro, Dirección, Comuna y Ciudad SII de los clientes guardados en tu cuenta Lioren (0 UF).</div>
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="btn-sync-lioren-compradores" style="border-color: rgba(124, 58, 237, 0.4); color: #6d28d9; font-weight: 700; white-space: nowrap;">
          <i class="ri-refresh-line"></i> Sincronizar Clientes
        </button>
      </div>
    `;

    const syncBtn = document.getElementById('btn-sync-lioren-compradores');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<i class="ri-loader-4-line spin"></i> Sincronizando...';
        try {
          const syncRes = await callLiorenApi({ action: 'sync_compradores' });
          if (typeof window.fetchBillingCommerceLegalDataset === 'function') {
            await window.fetchBillingCommerceLegalDataset(true);
          }
          if (typeof Swal !== 'undefined') {
            Swal.fire({
              icon: syncRes.totalInLioren > 0 ? 'success' : 'info',
              title: 'Sincronización con Lioren completada',
              html: syncRes.totalInLioren > 0
                ? `Se leyeron <strong>${syncRes.totalInLioren}</strong> clientes en el Círculo de Compradores de Lioren y se completaron datos tributarios en <strong>${syncRes.matchedCount}</strong> comercios del WMS.`
                : `El Círculo de Compradores en este entorno (${st.isSandbox ? 'Entorno de Pruebas' : 'Producción'}) tiene <strong>0 clientes registrados</strong> actualmente.`,
              confirmButtonColor: '#5f06fa'
            });
          }
        } catch (syncErr) {
          if (typeof Swal !== 'undefined') {
            Swal.fire('Error sincronizando clientes', syncErr.message || String(syncErr), 'error');
          }
        } finally {
          syncBtn.disabled = false;
          syncBtn.innerHTML = '<i class="ri-refresh-line"></i> Sincronizar Clientes';
        }
      });
    }
  } catch (err) {
    bodyEl.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; padding: 1rem; border-radius: 8px; font-size: 0.85rem;">
        <strong><i class="ri-error-warning-line"></i> No se pudo conectar con Lioren API:</strong>
        <p style="margin: 0.4rem 0 0 0;">${escHtml(err.message)}</p>
      </div>
    `;
  }
};

// ============================================================================
// MODAL 2: CONSULTAR ESTADO DTE EN VIVO EN EL SII
// ============================================================================
window.consultLiorenDteStatus = async function(recordId, serviceType, folio, tipodoc = '33') {
  if (!folio) return;
  try {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: `Consultando Folio #${folio} en Lioren / SII...`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
    }

    const { data: rec } = recordId
      ? await supabase.from('billing_records').select('id, period_id, factura_fulfillment_pdf_url, factura_enviame_pdf_url').eq('id', recordId).maybeSingle()
      : { data: null };

    const hasPdf = serviceType === 'fulfillment' ? Boolean(rec?.factura_fulfillment_pdf_url) : Boolean(rec?.factura_enviame_pdf_url);

    const res = await callLiorenApi({
      action: 'consult_dte',
      recordId,
      serviceType,
      tipodoc,
      folio: Number(folio),
      refreshFiles: !hasPdf
    });

    const d = res.dte || {};
    await refreshViewsAfterInvoiceAction(rec?.period_id, recordId, serviceType);

    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: d.estado === 'rechazo' ? 'error' : 'info',
        title: `Factura Electrónica #${d.folio}`,
        html: `
          <div style="text-align: left; font-size: 0.88rem; line-height: 1.6;">
            <div><strong>Estado revisión SII:</strong> ${renderLiorenSiiBadgeHtml(d.estado || 'pendiente')}</div>
            ${d.trackid ? `<div><strong>Track ID SII:</strong> <code>${escHtml(d.trackid)}</code></div>` : ''}
            <div><strong>Receptor:</strong> ${escHtml(d.rs || '')} (${escHtml(d.rut || '')})</div>
            <div><strong>Fecha Emisión:</strong> ${escHtml(d.fecha || '')}</div>
            <div><strong>Monto Neto:</strong> ${formatCLP(d.montoneto)} · <strong>IVA:</strong> ${formatCLP(d.montoiva)} · <strong>Total:</strong> <strong>${formatCLP(d.montototal)}</strong></div>
          </div>
        `,
        confirmButtonText: 'Cerrar',
        confirmButtonColor: '#5f06fa'
      });
    }
  } catch (err) {
    if (typeof Swal !== 'undefined') {
      Swal.fire('Error consultando DTE', err.message || String(err), 'error');
    } else {
      alert('Error consultando DTE: ' + (err.message || err));
    }
  }
};

// ============================================================================
// MODAL 3: ANULAR FACTURA CON NOTA DE CRÉDITO ELECTRÓNICA (DTE 61)
// ============================================================================
window.openLiorenCreditNoteModal = async function(recordId, serviceType) {
  try {
    const { data: record, error } = await supabase
      .from('billing_records')
      .select('*, billing_periods(name)')
      .eq('id', recordId)
      .single();
    if (error || !record) throw new Error('No se encontró el registro de facturación.');

    const folio = serviceType === 'fulfillment' ? record.num_factura : record.num_factura_enviame;
    if (!folio) {
      alert('Este registro no tiene un folio de factura asociado para anular.');
      return;
    }

    const dataset = typeof window.fetchBillingCommerceLegalDataset === 'function'
      ? await window.fetchBillingCommerceLegalDataset()
      : null;
    const legal = typeof window.getBillingCommerceLegalInfo === 'function'
      ? window.getBillingCommerceLegalInfo(record.comercio, dataset)
      : {};
    const loc = resolveLiorenLocalityIds(legal.comuna_facturacion || '', legal.ciudad_facturacion || '');
    const comunaId = legal.lioren_comuna_id || loc.comunaId;
    const ciudadId = legal.lioren_ciudad_id || loc.ciudadId;

    const { value: confirmedMotivo } = await Swal.fire({
      icon: 'warning',
      title: `¿Emitir Nota de Crédito (61) para Folio #${folio}?`,
      html: `
        <div style="text-align: left; font-size: 0.84rem; color: var(--color-text-muted); margin-bottom: 0.75rem;">
          Se emitirá una <strong>Nota de Crédito Electrónica (DTE 61)</strong> en Lioren anulando la Factura <strong>#${folio}</strong> de <strong>${escHtml(record.comercio)}</strong> y el estado volverá a <em>Facturar</em>.
        </div>
        <label style="display: block; text-align: left; font-size: 0.78rem; font-weight: 600; margin-bottom: 0.25rem;">Glosa / Motivo de Anulación (SII):</label>
      `,
      input: 'text',
      inputValue: `Anula Factura Electrónica Folio ${folio}`,
      showCancelButton: true,
      confirmButtonText: 'Emitir Nota de Crédito (61)',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
      inputValidator: (val) => {
        if (!val || val.trim().length < 5) return 'Ingresa un motivo de al menos 5 caracteres.';
        return null;
      }
    });

    if (!confirmedMotivo) return;

    Swal.fire({
      title: 'Emitiendo Nota de Crédito (DTE 61) en Lioren...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const ncRes = await callLiorenApi({
      action: 'emit_credit_note',
      recordId,
      serviceType,
      refTipodoc: '33',
      refFolio: Number(folio),
      motivoGlosa: confirmedMotivo.trim(),
      receptor: {
        rut: legal.rut || '',
        rs: legal.razon_social || record.comercio,
        giro: (legal.giro_facturacion || 'COMERCIALIZACION Y VENTA AL POR MENOR').slice(0, 40),
        direccion: legal.direccion_facturacion || 'SANTIAGO',
        comuna: comunaId || 295,
        ciudad: ciudadId || 176
      },
      resetBillingStatus: true
    });

    await refreshViewsAfterInvoiceAction(record.period_id, recordId, serviceType);

    Swal.fire({
      icon: 'success',
      title: `Nota de Crédito #${ncRes.nc?.folio} Emitida`,
      html: `
        <p style="font-size: 0.88rem;">Se anuló correctamente la Factura <strong>#${folio}</strong> y el registro quedó disponible para volver a facturar.</p>
        ${ncRes.ncPdfUrl ? `<a href="${ncRes.ncPdfUrl}" target="_blank" class="btn btn-outline btn-sm" style="margin-top: 0.5rem; display: inline-flex; align-items: center; gap: 0.3rem;"><i class="ri-file-pdf-line"></i> Ver PDF Nota de Crédito #${ncRes.nc?.folio}</a>` : ''}
      `,
      confirmButtonColor: '#5f06fa'
    });
  } catch (err) {
    Swal.fire('Error al emitir Nota de Crédito', err.message || String(err), 'error');
  }
};

// ============================================================================
// MODAL PRINCIPAL UNIFICADO: EMITIR EN LIOREN (1 GLOSA) O REGISTRO MANUAL
// Reemplaza y potencia window.markDashboardInvoiceAsIssued(recordId, serviceType)
// ============================================================================
window.openLiorenEmitModal = async function(recordId, serviceType, options = {}) {
  injectLiorenStyles();
  const initialMode = options.initialMode === 'manual' ? 'manual' : 'lioren';
  const fromPublishFlow = Boolean(options.fromPublishFlow);

  try {
    const { data: record, error: getRecErr } = await supabase
      .from('billing_records')
      .select('*, billing_periods(name)')
      .eq('id', recordId)
      .single();

    if (getRecErr || !record) {
      throw new Error(getRecErr?.message || 'No se encontró el registro de facturación.');
    }

    const dataset = typeof window.fetchBillingCommerceLegalDataset === 'function'
      ? await window.fetchBillingCommerceLegalDataset()
      : null;
    const legal = typeof window.getBillingCommerceLegalInfo === 'function'
      ? window.getBillingCommerceLegalInfo(record.comercio, dataset)
      : {};

    const resolvedLoc = resolveLiorenLocalityIds(
      legal.comuna_facturacion || '',
      legal.ciudad_facturacion || ''
    );
    const initialComunaId = legal.lioren_comuna_id || resolvedLoc.comunaId || '';
    const initialCiudadId = legal.lioren_ciudad_id || resolvedLoc.ciudadId || '';

    const rawGrossAmount = Math.round(
      Number(serviceType === 'fulfillment' ? (record.total_fulfillment || 0) : (record.enviame || 0))
    );
    const initialNetAmount = rawGrossAmount > 0 ? Math.round(rawGrossAmount / 1.19) : 0;
    const initialIvaAmount = Math.round(initialNetAmount * 0.19);
    const initialTotalSii = initialNetAmount + initialIvaAmount;

    const todayIso = new Date().toLocaleDateString('sv-SE');
    const currentDueDate = serviceType === 'fulfillment'
      ? (record.fecha_limite || '')
      : (record.fecha_limite_enviame || '');
    const currentPagoStatus = serviceType === 'fulfillment'
      ? (record.pago_fulfillment || 'Por solicitar')
      : (record.pago_enviame || 'Por solicitar');
    const suggestedDueDate = computeBusinessDays(todayIso, 5);
    const hasFutureOrTodayDue = Boolean(currentDueDate && currentDueDate >= todayIso);
    const initialDueDate = hasFutureOrTodayDue ? currentDueDate : suggestedDueDate;
    const expiredDueDateAdjusted = Boolean(currentDueDate && currentDueDate < todayIso);

    // 1 sola glosa idéntica al estándar actual del WMS
    const periodRaw = record.billing_periods?.name || '';
    const formattedPeriod = periodRaw.replace(/[\s-]+/g, '-').toUpperCase();
    const defaultGlosa = `${serviceType === 'fulfillment' ? 'SERV. FULFILLMENT' : 'SERV. ENVIAME'} ${formattedPeriod}`.trim();
    const defaultActividad = serviceType === 'fulfillment' ? '521009' : '522190';

    // Llave de idempotencia única para esta apertura de modal (evita doble facturación en reintentos)
    const sessionIdempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `stocka-${recordId}-${serviceType}-${Date.now()}`;

    const comunasOptionsHtml = [
      `<option value="">— Seleccionar Comuna SII —</option>`,
      ...(LIOREN_CATALOGS.comunas || []).map(
        c => `<option value="${c.id}" data-region="${c.region_id}" data-nombre="${escHtml(c.nombre)}" ${Number(initialComunaId) === c.id ? 'selected' : ''}>${escHtml(c.nombre)}</option>`
      )
    ].join('');

    const ciudadesOptionsHtml = [
      `<option value="">— Seleccionar Ciudad SII —</option>`,
      ...(LIOREN_CATALOGS.ciudades || []).map(
        ci => `<option value="${ci.id}" data-region="${ci.region_id}" data-nombre="${escHtml(ci.nombre)}" ${Number(initialCiudadId) === ci.id ? 'selected' : ''}>${escHtml(ci.nombre)}</option>`
      )
    ].join('');

    let modal = document.getElementById('modal-register-dashboard-invoice');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-register-dashboard-invoice';
    modal.className = 'modal-overlay active';
    modal.style.zIndex = '1120';

    const rawGiro = legal.giro_facturacion || '';

    modal.innerHTML = `
      <div class="modal-content lioren-emit-modal-card">
        <!-- Encabezado Fijo -->
        <div class="lioren-emit-header">
          <div class="lioren-emit-header-left">
            <div class="lioren-emit-icon-box">
              <i class="ri-flashlight-fill"></i>
            </div>
            <div style="min-width: 0;">
              <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
                <h3 style="margin: 0; font-size: 1.08rem; font-weight: 800; letter-spacing: -0.01em;">
                  Facturación Oficial — ${escHtml(record.comercio)}
                </h3>
                <span class="client-badge ${serviceType === 'fulfillment' ? 'status-purple' : 'status-teal'}" style="font-size: 0.72rem; padding: 0.2rem 0.65rem; border-radius: 999px; font-weight: 700;">
                  ${serviceType === 'fulfillment' ? 'Fulfillment' : 'Courier Envíame'} · ${escHtml(periodRaw)}
                </span>
              </div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                Revisa los bloques tributarios del receptor y confirma los montos DTE antes de timbrar ante el SII.
              </div>
            </div>
          </div>
          <button type="button" class="modal-close" onclick="this.closest('.modal-overlay').remove()" title="Cerrar">&times;</button>
        </div>

        <!-- Barra Superior: Selector de Modo + Estado SII/CAF en Vivo -->
        <div class="lioren-emit-toolbar">
          <div class="lioren-mode-tabs">
            <button type="button" class="lioren-mode-tab ${initialMode === 'lioren' ? 'active' : ''}" data-mode="lioren">
              <i class="ri-flashlight-fill"></i> Emitir con LIOREN API
            </button>
            <button type="button" class="lioren-mode-tab ${initialMode === 'manual' ? 'active' : ''}" data-mode="manual">
              <i class="ri-edit-box-line"></i> Registrar Folio Manual
            </button>
          </div>

          <div id="lioren-modal-env-banner" class="lioren-env-banner compact-bar sandbox" style="opacity: 0.85;">
            <span><i class="ri-loader-4-line spin"></i> Conectando con Lioren API...</span>
            <span id="lioren-modal-folios-info">Verificando folios...</span>
          </div>
        </div>

        <!-- Cuerpo Desplazable en Bloques Relacionados -->
        <div class="lioren-emit-body">
          <!-- ================================================================ -->
          <!-- PANEL A: EMISIÓN AUTOMÁTICA VÍA LIOREN API (2 COLUMNAS AMPLIAS)  -->
          <!-- ================================================================ -->
          <form id="form-emit-lioren-invoice" style="display: ${initialMode === 'lioren' ? 'block' : 'none'};">
            <div class="lioren-emit-columns">
              <!-- COLUMNA IZQUIERDA: BLOQUES DEL RECEPTOR TRIBUTARIO -->
              <div class="lioren-col-stack">
                <!-- BLOQUE 1: IDENTIFICACIÓN TRIBUTARIA -->
                <div class="lioren-section-box">
                  <div class="lioren-section-title">
                    <span><i class="ri-building-2-line"></i> 1. Identificación del Receptor</span>
                    <span id="lioren-rut-badge" style="font-size: 0.72rem; text-transform: none; letter-spacing: 0;"></span>
                  </div>

                  <div class="lioren-grid-2" style="margin-bottom: 0.75rem;">
                    <div>
                      <label class="lioren-field-label" for="lioren-rec-rut"><span>RUT Receptor *</span></label>
                      <div style="display: flex; gap: 0.4rem; align-items: center;">
                        <input type="text" id="lioren-rec-rut" class="lioren-ctrl-input" value="${escHtml(legal.rut || '')}" placeholder="Ej: 76.684.648-3" required style="flex: 1; font-weight: 600;">
                        <button type="button" id="btn-lioren-lookup-rut" class="btn btn-outline btn-sm" style="height: 40px; padding: 0 0.7rem; font-size: 0.75rem; font-weight: 700; border-radius: 8px; white-space: nowrap; border-color: rgba(124, 58, 237, 0.35); color: #6d28d9;" title="Autocompletar desde tu Círculo de Compradores Lioren (0 UF)">
                          <i class="ri-search-eye-line"></i> Lioren
                        </button>
                      </div>
                    </div>
                    <div>
                      <label class="lioren-field-label" for="lioren-rec-email">
                        <span>Correo Receptor DTE</span>
                        <span style="font-weight: 400; color: var(--color-text-muted); font-size: 0.69rem;">Opcional</span>
                      </label>
                      <input type="email" id="lioren-rec-email" class="lioren-ctrl-input" value="${escHtml(legal.email_facturacion || legal.rep_legal_email || '')}" placeholder="facturacion@cliente.cl" maxlength="80">
                    </div>
                  </div>

                  <div id="lioren-comprador-lookup-msg" style="display: none; font-size: 0.74rem; margin-bottom: 0.75rem; padding: 0.45rem 0.7rem; border-radius: 8px;"></div>

                  <div style="margin-bottom: 0.75rem;">
                    <label class="lioren-field-label" for="lioren-rec-rs">
                      <span>Razón Social *</span>
                      <span style="font-weight: 400; color: var(--color-text-muted); font-size: 0.69rem;">5 a 100 car.</span>
                    </label>
                    <input type="text" id="lioren-rec-rs" class="lioren-ctrl-input" value="${escHtml(legal.razon_social || '')}" placeholder="Ej: COMERCIALIZADORA EJEMPLO SPA" minlength="5" maxlength="100" required style="font-weight: 600;">
                  </div>

                  <div>
                    <label class="lioren-field-label" for="lioren-rec-giro">
                      <span>Giro Tributario SII * <span style="font-weight: 400; color: var(--color-text-muted);">(máx. 40 car.)</span></span>
                      <span id="lioren-giro-counter" style="font-size: 0.71rem; font-weight: 700; padding: 0.08rem 0.45rem; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); color: ${rawGiro.length > 40 ? '#ef4444' : 'var(--color-text-muted)'};">${Math.min(rawGiro.length, 40)} / 40</span>
                    </label>
                    <input type="text" id="lioren-rec-giro" class="lioren-ctrl-input" value="${escHtml(rawGiro.slice(0, 40))}" placeholder="Ej: VENTA AL POR MENOR POR INTERNET" minlength="5" maxlength="40" required>
                    ${rawGiro.length > 40 ? `<div style="font-size: 0.7rem; color: #d97706; margin-top: 0.3rem;"><i class="ri-information-line"></i> El giro registrado (${rawGiro.length} car.) se ajustó al máximo de 40 caracteres del SII.</div>` : ''}
                  </div>
                </div>

                <!-- BLOQUE 2: DOMICILIO TRIBUTARIO Y FICHA WMS -->
                <div class="lioren-section-box">
                  <div class="lioren-section-title">
                    <span><i class="ri-map-pin-2-line"></i> 2. Domicilio Tributario SII</span>
                  </div>

                  <div style="margin-bottom: 0.75rem;">
                    <label class="lioren-field-label" for="lioren-rec-direccion">
                      <span>Dirección Tributaria *</span>
                      <span style="font-weight: 400; color: var(--color-text-muted); font-size: 0.69rem;">5 a 70 car.</span>
                    </label>
                    <input type="text" id="lioren-rec-direccion" class="lioren-ctrl-input" value="${escHtml((legal.direccion_facturacion || '').slice(0, 70))}" placeholder="Ej: AV. PROVIDENCIA 1234 OF 501" minlength="5" maxlength="70" required>
                  </div>

                  <div class="lioren-grid-2">
                    <div>
                      <label class="lioren-field-label" for="lioren-rec-comuna"><span>Comuna SII *</span></label>
                      <select id="lioren-rec-comuna" class="lioren-ctrl-select" required>
                        ${comunasOptionsHtml}
                      </select>
                    </div>
                    <div>
                      <label class="lioren-field-label" for="lioren-rec-ciudad"><span>Ciudad SII *</span></label>
                      <select id="lioren-rec-ciudad" class="lioren-ctrl-select" required>
                        ${ciudadesOptionsHtml}
                      </select>
                    </div>
                  </div>

                  <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.85rem; padding-top: 0.7rem; border-top: 1px dashed var(--color-border); cursor: pointer;">
                    <input type="checkbox" id="lioren-save-commerce-legal" checked style="width: 16px; height: 16px; accent-color: #7c3aed; cursor: pointer; flex-shrink: 0;">
                    <span>Guardar / actualizar estos datos tributarios en la ficha de <strong style="color: var(--color-text-main);">${escHtml(record.comercio)}</strong></span>
                  </label>
                </div>
              </div>

              <!-- COLUMNA DERECHA: DOCUMENTO, PLAZOS, MONTOS Y NOTIFICACIÓN -->
              <div class="lioren-col-stack">
                <!-- BLOQUE 3: CONFIGURACIÓN DEL DTE, GLOSA Y FECHAS -->
                <div class="lioren-section-box">
                  <div class="lioren-section-title">
                    <span><i class="ri-file-list-3-line"></i> 3. Documento DTE, Glosa y Plazos</span>
                  </div>

                  <div class="lioren-grid-2" style="margin-bottom: 0.75rem;">
                    <div>
                      <label class="lioren-field-label" for="lioren-dte-tipodoc"><span>Tipo de Documento SII</span></label>
                      <select id="lioren-dte-tipodoc" class="lioren-ctrl-select">
                        <option value="33" selected>33 — Factura Afecta (19% IVA)</option>
                        <option value="34">34 — Factura Exenta (0% IVA)</option>
                      </select>
                    </div>
                    <div>
                      <label class="lioren-field-label" for="lioren-dte-actividad"><span>Actividad Económica SII</span></label>
                      <select id="lioren-dte-actividad" class="lioren-ctrl-select">
                        <option value="521009" ${defaultActividad === '521009' ? 'selected' : ''}>521009 — Almacenamiento y depósito</option>
                        <option value="522190" ${defaultActividad === '522190' ? 'selected' : ''}>522190 — Transporte terrestre</option>
                      </select>
                    </div>
                  </div>

                  <div style="margin-bottom: 0.75rem;">
                    <label class="lioren-field-label" for="lioren-dte-glosa">
                      <span>Glosa Única / Detalle de Factura *</span>
                      <button type="button" id="btn-copy-lioren-glosa" style="border: none; background: transparent; color: #6d28d9; font-size: 0.71rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 0.2rem; padding: 0;">
                        <i class="ri-file-copy-line"></i> Copiar
                      </button>
                    </label>
                    <input type="text" id="lioren-dte-glosa" class="lioren-ctrl-input" value="${escHtml(defaultGlosa)}" minlength="3" maxlength="80" required style="font-weight: 700; letter-spacing: 0.01em;">
                  </div>

                  <div class="lioren-grid-2" style="margin-bottom: 0.55rem;">
                    <div>
                      <label class="lioren-field-label" for="lioren-dte-fecha"><span>Fecha de Emisión</span></label>
                      <input type="date" id="lioren-dte-fecha" class="lioren-ctrl-input" value="${todayIso}" required>
                    </div>
                    <div>
                      <label class="lioren-field-label" for="lioren-dte-vencimiento"><span>Vencimiento / Fecha Límite</span></label>
                      <input type="date" id="lioren-dte-vencimiento" class="lioren-ctrl-input" value="${initialDueDate}">
                    </div>
                  </div>

                  ${expiredDueDateAdjusted ? `
                    <div style="font-size: 0.7rem; color: #b45309; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.28); border-radius: 6px; padding: 0.3rem 0.55rem; margin-bottom: 0.55rem;">
                      <i class="ri-calendar-check-line"></i> La fecha límite previa (${escHtml(currentDueDate)}) ya había pasado; se actualizó a <strong>+5 días hábiles</strong>.
                    </div>
                  ` : ''}

                  <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                    <span style="font-size: 0.71rem; color: var(--color-text-muted); font-weight: 600;">Plazo rápido:</span>
                    <button type="button" class="lioren-due-preset" data-days="3">+3 días háb.</button>
                    <button type="button" class="lioren-due-preset" data-days="5">+5 días háb.</button>
                    <button type="button" class="lioren-due-preset" data-days="10">+10 días háb.</button>
                    <button type="button" class="lioren-due-preset" data-days="eom">Fin de mes</button>
                  </div>
                </div>

                <!-- BLOQUE 4: RESUMEN DE MONTOS SII Y ENVÍO DE CORREO -->
                <div class="lioren-section-box">
                  <div class="lioren-section-title">
                    <span><i class="ri-money-dollar-circle-line"></i> 4. Resumen de Montos SII y Envío</span>
                  </div>

                  <div class="lioren-Amounts-box">
                    <div>
                      <label for="lioren-dte-neto" style="font-size: 0.69rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Monto Neto ($)</label>
                      <input type="number" id="lioren-dte-neto" class="lioren-ctrl-input" value="${initialNetAmount}" min="1" step="1" required style="font-size: 0.9rem; font-weight: 700;">
                    </div>
                    <div>
                      <label for="lioren-dte-iva-view" style="font-size: 0.69rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">IVA 19% ($)</label>
                      <input type="text" id="lioren-dte-iva-view" class="lioren-ctrl-input" value="${formatCLP(initialIvaAmount)}" readonly style="font-size: 0.86rem; font-weight: 600; background: rgba(148, 163, 184, 0.08); cursor: default;">
                    </div>
                    <div>
                      <label for="lioren-dte-bruto" style="font-size: 0.69rem; font-weight: 800; text-transform: uppercase; color: #5f06fa; display: block; margin-bottom: 0.25rem;">Total Factura ($)</label>
                      <input type="number" id="lioren-dte-bruto" class="lioren-ctrl-input" value="${initialTotalSii}" min="1" step="1" style="font-size: 0.96rem; font-weight: 800; color: #5f06fa; border-color: rgba(95, 6, 250, 0.35);">
                    </div>
                  </div>

                  <div id="lioren-rounding-note" style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.45rem; margin-bottom: 0.8rem;">
                    Monto registrado en panel: <strong>${formatCLP(rawGrossAmount)}</strong>
                  </div>

                  ${fromPublishFlow ? `
                    <!-- Opción adicional cuando viene de Confirmar y Publicar Cobro -->
                    <div style="background: rgba(95, 6, 250, 0.06); padding: 0.65rem 0.85rem; border-radius: 10px; border: 1px solid rgba(95, 6, 250, 0.24); margin-bottom: 0.6rem; display: flex; align-items: flex-start; gap: 0.55rem;">
                      <input type="checkbox" id="lioren-notify-desglose-brevo" checked style="width: 17px; height: 17px; margin-top: 2px; accent-color: #5f06fa; cursor: pointer; flex-shrink: 0;">
                      <div style="min-width: 0;">
                        <label for="lioren-notify-desglose-brevo" style="font-size: 0.79rem; font-weight: 700; color: var(--color-text-main); cursor: pointer; display: block; line-height: 1.3;">
                          Enviar también correo automático de Desglose de Servicio Confirmado
                        </label>
                        <span style="font-size: 0.71rem; color: var(--color-text-muted); display: block; margin-top: 0.12rem;">
                          Notificará el Desglose Interactivo 360° confirmado para ${escHtml(periodRaw)} junto al proceso de facturación.
                        </span>
                      </div>
                    </div>
                  ` : ''}

                  <!-- Aviso por Correo (Brevo) integrado en el bloque de cierre -->
                  <div id="lioren-brevo-card-box" class="lioren-brevo-card">
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem;">
                      <div style="display: flex; align-items: flex-start; gap: 0.55rem; min-width: 0;">
                        <input type="checkbox" id="lioren-notify-brevo" checked style="width: 17px; height: 17px; margin-top: 2px; accent-color: #10b981; cursor: pointer; flex-shrink: 0;">
                        <div style="min-width: 0;">
                          <label for="lioren-notify-brevo" style="font-size: 0.79rem; font-weight: 700; color: var(--color-text-main); cursor: pointer; display: block; line-height: 1.3;">
                            Enviar aviso automático de factura al cliente por correo (Brevo)
                          </label>
                          <span id="lioren-notify-hint" style="font-size: 0.71rem; color: var(--color-text-muted); display: block; margin-top: 0.15rem;">
                            Adjuntará automáticamente el enlace al PDF oficial timbrado por Lioren.
                          </span>
                        </div>
                      </div>
                      <button type="button" id="btn-preview-lioren-email" class="btn-lioren-preview-email" title="Previsualizar correo y destinatarios">
                        <i class="ri-eye-line"></i> Previsualizar correo
                      </button>
                    </div>
                    <div id="lioren-notify-recipients-bar" style="margin-top: 0.5rem; padding-top: 0.45rem; border-top: 1px dashed rgba(16, 185, 129, 0.28); display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pie de Acción Principal -->
            <div class="lioren-emit-footer">
              <div style="font-size: 0.74rem; color: var(--color-text-muted); display: flex; align-items: center; gap: 0.35rem;">
                <i class="ri-shield-keyhole-line" style="color: #10b981; font-size: 0.95rem;"></i>
                <span>Protección anti-duplicidad activa · Se guardarán PDF y XML timbrados automáticamente.</span>
              </div>
              <div style="display: flex; align-items: center; gap: 0.6rem; margin-left: auto;">
                <button type="button" class="btn btn-outline" style="height: 40px; padding: 0 1.15rem; font-size: 0.85rem;" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="btn-submit-lioren-emit" style="height: 40px; padding: 0 1.35rem; font-size: 0.86rem; background: linear-gradient(135deg, #6d28d9, #4f46e5); border: none; font-weight: 700; display: inline-flex; align-items: center; gap: 0.45rem;">
                  <i class="ri-flashlight-fill"></i> Emitir Factura Electrónica
                </button>
              </div>
            </div>
          </form>

          <!-- ================================================================ -->
          <!-- PANEL B: REGISTRO MANUAL DE FACTURA EXTERNA (FLUJO CLÁSICO)      -->
          <!-- ================================================================ -->
          <form id="form-register-manual-invoice" style="display: ${initialMode === 'manual' ? 'block' : 'none'}; max-width: 680px; margin: 0 auto;">
            <div class="lioren-section-box" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
              <div>
                <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700;">Glosa sugerida</div>
                <div style="font-size: 0.92rem; font-weight: 800; margin-top: 0.15rem;">${escHtml(defaultGlosa)}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700;">Monto a Facturar</div>
                <div style="font-size: 1.15rem; font-weight: 800; color: var(--color-primary); margin-top: 0.1rem;">${formatCLP(rawGrossAmount)}</div>
              </div>
            </div>

            <div class="lioren-section-box">
              <div class="lioren-section-title">
                <span><i class="ri-edit-box-line"></i> Datos del Folio Emitido Externamente</span>
              </div>

              <div class="lioren-grid-2" style="margin-bottom: 0.85rem;">
                <div>
                  <label class="lioren-field-label" for="reg-invoice-num"><span>Número de Folio / Factura *</span></label>
                  <input type="number" id="reg-invoice-num" class="lioren-ctrl-input" placeholder="Ej: 12345" min="1" required>
                  <div id="reg-invoice-num-feedback" style="font-size: 0.74rem; margin-top: 0.25rem; display: none;"></div>
                </div>
                <div>
                  <label class="lioren-field-label" for="reg-invoice-due-date"><span>Fecha Límite de Pago</span></label>
                  <input type="date" id="reg-invoice-due-date" value="${initialDueDate}" class="lioren-ctrl-input">
                </div>
              </div>

              <div style="margin-bottom: 0.85rem;">
                <label class="lioren-field-label" for="reg-invoice-file"><span>Archivo Factura PDF (Opcional)</span></label>
                <input type="file" id="reg-invoice-file" accept=".pdf" class="lioren-ctrl-input" style="padding-top: 0.42rem !important; font-size: 0.8rem;">
              </div>

              <div id="manual-brevo-card-box" class="lioren-brevo-card">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.65rem;">
                  <div style="display: flex; align-items: center; gap: 0.55rem; min-width: 0;">
                    <input type="checkbox" id="reg-invoice-notify" checked style="width: 17px; height: 17px; accent-color: #10b981; cursor: pointer; flex-shrink: 0;">
                    <label for="reg-invoice-notify" style="font-size: 0.8rem; font-weight: 700; cursor: pointer; margin: 0;">
                      Enviar automáticamente aviso de factura emitida por correo (Brevo)
                    </label>
                  </div>
                  <button type="button" id="btn-preview-manual-email" class="btn-lioren-preview-email" title="Previsualizar correo y destinatarios">
                    <i class="ri-eye-line"></i> Previsualizar correo
                  </button>
                </div>
                <div id="manual-notify-recipients-bar" style="margin-top: 0.5rem; padding-top: 0.45rem; border-top: 1px dashed rgba(16, 185, 129, 0.28); display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;"></div>
              </div>
            </div>

            <div class="lioren-emit-footer" style="justify-content: flex-end;">
              <button type="button" class="btn btn-outline" style="height: 40px; padding: 0 1.15rem; font-size: 0.85rem;" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-reg-invoice" style="height: 40px; padding: 0 1.3rem; font-size: 0.86rem;">
                <i class="ri-save-line"></i> Guardar Folio Manual
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // --- Cambio entre pestañas (Lioren vs Manual) ---
    const formLioren = document.getElementById('form-emit-lioren-invoice');
    const formManual = document.getElementById('form-register-manual-invoice');
    modal.querySelectorAll('.lioren-mode-tab').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        modal.querySelectorAll('.lioren-mode-tab').forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
        const mode = tabBtn.getAttribute('data-mode');
        formLioren.style.display = mode === 'lioren' ? 'block' : 'none';
        formManual.style.display = mode === 'manual' ? 'block' : 'none';
      });
    });

    // --- Validación en vivo de RUT y contador de Giro ---
    const rutInput = document.getElementById('lioren-rec-rut');
    const rutBadge = document.getElementById('lioren-rut-badge');
    const updateRutBadge = () => {
      const check = validateChileanRut(rutInput.value);
      if (!rutInput.value.trim()) {
        rutBadge.innerHTML = `<span style="color: #ef4444;">RUT requerido</span>`;
      } else if (check.valid) {
        rutBadge.innerHTML = `<span style="color: #10b981; font-weight: 700;"><i class="ri-checkbox-circle-fill"></i> RUT válido (${escHtml(check.formatted)})</span>`;
      } else {
        rutBadge.innerHTML = `<span style="color: #ef4444; font-weight: 700;"><i class="ri-close-circle-fill"></i> Dígito verificador inválido</span>`;
      }
    };
    rutInput.addEventListener('input', updateRutBadge);
    updateRutBadge();

    const giroInput = document.getElementById('lioren-rec-giro');
    const giroCounter = document.getElementById('lioren-giro-counter');
    giroInput.addEventListener('input', () => {
      const len = giroInput.value.length;
      giroCounter.textContent = `${len} / 40`;
      giroCounter.style.color = len >= 38 ? '#f59e0b' : 'var(--color-text-muted)';
    });

    // --- Sincronización automática Comuna -> Ciudad ---
    const comunaSelect = document.getElementById('lioren-rec-comuna');
    const ciudadSelect = document.getElementById('lioren-rec-ciudad');
    comunaSelect.addEventListener('change', () => {
      const selectedOpt = comunaSelect.options[comunaSelect.selectedIndex];
      const comunaName = selectedOpt ? selectedOpt.getAttribute('data-nombre') : '';
      if (comunaName) {
        const autoLoc = resolveLiorenLocalityIds(comunaName, '');
        if (autoLoc.ciudadId) {
          ciudadSelect.value = String(autoLoc.ciudadId);
        }
      }
    });

    // --- Búsqueda en Círculo de Compradores de Lioren (GET /api/compradores, 0 UF) ---
    const lookupBtn = document.getElementById('btn-lioren-lookup-rut');
    const lookupMsg = document.getElementById('lioren-comprador-lookup-msg');
    const rsInput = document.getElementById('lioren-rec-rs');
    const dirInput = document.getElementById('lioren-rec-direccion');
    const emailInput = document.getElementById('lioren-rec-email');

    const runCompradorLookup = async (silentIfMissing = false) => {
      const check = validateChileanRut(rutInput.value);
      if (!check.valid) {
        if (!silentIfMissing && lookupMsg) {
          lookupMsg.style.display = 'block';
          lookupMsg.style.background = 'rgba(239, 68, 68, 0.1)';
          lookupMsg.style.color = '#dc2626';
          lookupMsg.innerHTML = '<i class="ri-error-warning-line"></i> Ingresa primero un RUT chileno válido para buscar en Lioren.';
        }
        return;
      }

      if (lookupBtn) {
        lookupBtn.disabled = true;
        lookupBtn.innerHTML = '<i class="ri-loader-4-line spin"></i>';
      }

      try {
        const res = await callLiorenApi({ action: 'lookup_comprador', rut: check.formatted });
        if (!document.body.contains(modal)) return;

        if (res.found && res.comprador) {
          const c = res.comprador;
          if (c.rs && (!silentIfMissing || !rsInput.value.trim())) rsInput.value = c.rs;
          if (c.giro && (!silentIfMissing || !giroInput.value.trim())) {
            giroInput.value = String(c.giro).slice(0, 40);
            giroInput.dispatchEvent(new Event('input'));
          }
          if (c.direccion && (!silentIfMissing || !dirInput.value.trim())) {
            dirInput.value = String(c.direccion).slice(0, 70);
          }
          if (c.comuna_id && (!silentIfMissing || !comunaSelect.value)) {
            comunaSelect.value = String(c.comuna_id);
          }
          if (c.ciudad_id && (!silentIfMissing || !ciudadSelect.value)) {
            ciudadSelect.value = String(c.ciudad_id);
          } else if (comunaSelect.value && !ciudadSelect.value) {
            comunaSelect.dispatchEvent(new Event('change'));
          }
          if (c.email && !emailInput.value.trim()) {
            emailInput.value = c.email;
            emailInput.dispatchEvent(new Event('input'));
          }

          if (lookupMsg) {
            lookupMsg.style.display = 'block';
            lookupMsg.style.background = 'rgba(16, 185, 129, 0.12)';
            lookupMsg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            lookupMsg.style.color = '#059669';
            lookupMsg.innerHTML = `<i class="ri-checkbox-circle-fill"></i> Datos completados automáticamente desde tu <strong>Círculo de Compradores Lioren</strong> (${escHtml(c.rs)}).`;
          }
        } else if (!silentIfMissing && lookupMsg) {
          lookupMsg.style.display = 'block';
          lookupMsg.style.background = 'rgba(245, 158, 11, 0.12)';
          lookupMsg.style.border = '1px solid rgba(245, 158, 11, 0.3)';
          lookupMsg.style.color = '#b45309';
          lookupMsg.innerHTML = `<i class="ri-information-line"></i> Este RUT aún no figura en el Círculo de Compradores del entorno activo en Lioren. Completa los campos una vez y quedarán guardados en el WMS.`;
        }
      } catch (e) {
        if (!silentIfMissing && lookupMsg) {
          lookupMsg.style.display = 'block';
          lookupMsg.style.background = 'rgba(239, 68, 68, 0.1)';
          lookupMsg.style.color = '#dc2626';
          lookupMsg.innerHTML = `<i class="ri-error-warning-line"></i> ${escHtml(e.message || 'No se pudo consultar Lioren.')}`;
        }
      } finally {
        if (lookupBtn && document.body.contains(modal)) {
          lookupBtn.disabled = false;
          lookupBtn.innerHTML = '<i class="ri-search-eye-line"></i> Lioren';
        }
      }
    };

    if (lookupBtn) {
      lookupBtn.addEventListener('click', () => runCompradorLookup(false));
    }

    // Autocompletado silencioso al abrir el modal si el comercio ya tiene RUT pero le falta Giro, Dirección o Comuna en el WMS
    if (validateChileanRut(rutInput.value).valid && (!giroInput.value.trim() || !dirInput.value.trim() || !comunaSelect.value || !ciudadSelect.value)) {
      runCompradorLookup(true);
    }

    // --- Sincronización bidireccional Neto <-> Bruto + Tipo DTE (33 vs 34) ---
    const tipodocSelect = document.getElementById('lioren-dte-tipodoc');
    const netoInput = document.getElementById('lioren-dte-neto');
    const ivaView = document.getElementById('lioren-dte-iva-view');
    const brutoInput = document.getElementById('lioren-dte-bruto');
    const roundingNote = document.getElementById('lioren-rounding-note');

    const recalcFromNeto = () => {
      const isExenta = tipodocSelect.value === '34';
      const neto = Math.max(0, Math.round(Number(netoInput.value) || 0));
      const iva = isExenta ? 0 : Math.round(neto * 0.19);
      const total = neto + iva;
      ivaView.value = isExenta ? '$0 (Exenta)' : formatCLP(iva);
      brutoInput.value = total;
      const diff = total - rawGrossAmount;
      roundingNote.innerHTML = diff === 0
        ? `<span style="color: #10b981;"><i class="ri-check-line"></i> Cuadra exacto con el monto registrado en panel (${formatCLP(rawGrossAmount)}).</span>`
        : `<span>Monto panel: <strong>${formatCLP(rawGrossAmount)}</strong> · Total SII exacto a emitir: <strong>${formatCLP(total)}</strong> (diferencia ${diff > 0 ? '+' : ''}${formatCLP(diff)})</span>`;
    };

    const recalcFromBruto = () => {
      const isExenta = tipodocSelect.value === '34';
      const targetBruto = Math.max(0, Math.round(Number(brutoInput.value) || 0));
      const neto = isExenta ? targetBruto : Math.round(targetBruto / 1.19);
      const iva = isExenta ? 0 : Math.round(neto * 0.19);
      const exactSiiTotal = neto + iva;
      netoInput.value = neto;
      ivaView.value = isExenta ? '$0 (Exenta)' : formatCLP(iva);
      if (exactSiiTotal !== targetBruto) {
        roundingNote.innerHTML = `<span style="color: #d97706;"><i class="ri-information-line"></i> Por redondeo entero del 19% IVA ante el SII, Neto ${formatCLP(neto)} + IVA ${formatCLP(iva)} = <strong>${formatCLP(exactSiiTotal)}</strong>.</span>`;
      } else {
        roundingNote.innerHTML = `<span style="color: #10b981;"><i class="ri-check-line"></i> Neto ${formatCLP(neto)} + IVA ${formatCLP(iva)} = <strong>${formatCLP(exactSiiTotal)}</strong>.</span>`;
      }
    };

    netoInput.addEventListener('input', recalcFromNeto);
    brutoInput.addEventListener('input', recalcFromBruto);
    tipodocSelect.addEventListener('change', recalcFromBruto);
    recalcFromNeto();

    // --- Copiar glosa con 1 clic ---
    const copyGlosaBtn = document.getElementById('btn-copy-lioren-glosa');
    const glosaInput = document.getElementById('lioren-dte-glosa');
    if (copyGlosaBtn && glosaInput) {
      copyGlosaBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(glosaInput.value.trim());
          const orig = copyGlosaBtn.innerHTML;
          copyGlosaBtn.innerHTML = '<i class="ri-check-line" style="color: #10b981;"></i> Copiada';
          setTimeout(() => {
            if (document.body.contains(copyGlosaBtn)) copyGlosaBtn.innerHTML = orig;
          }, 1600);
        } catch {
          glosaInput.select();
        }
      });
    }

    // --- Botones rápidos de fecha de vencimiento ---
    const vencInput = document.getElementById('lioren-dte-vencimiento');
    const fechaInput = document.getElementById('lioren-dte-fecha');
    fechaInput.addEventListener('change', () => {
      if (fechaInput.value && vencInput.value && vencInput.value < fechaInput.value) {
        vencInput.value = computeBusinessDays(fechaInput.value, 5);
      }
    });
    modal.querySelectorAll('.lioren-due-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const dVal = btn.getAttribute('data-days');
        const baseDate = fechaInput.value || todayIso;
        if (dVal === 'eom') {
          const base = new Date(baseDate + 'T00:00:00');
          const eom = new Date(base.getFullYear(), base.getMonth() + 1, 0);
          vencInput.value = eom.toLocaleDateString('sv-SE');
        } else {
          vencInput.value = computeBusinessDays(baseDate, parseInt(dVal, 10) || 5);
        }
      });
    });

    // --- Estado y previsualización en vivo del correo automático (Brevo) ---
    const envBanner = document.getElementById('lioren-modal-env-banner');
    const foliosInfo = document.getElementById('lioren-modal-folios-info');
    const notifyCheckbox = document.getElementById('lioren-notify-brevo');
    const notifyHint = document.getElementById('lioren-notify-hint');
    const liorenBrevoCard = document.getElementById('lioren-brevo-card-box');
    const liorenRecipientsBar = document.getElementById('lioren-notify-recipients-bar');
    const btnPreviewLiorenEmail = document.getElementById('btn-preview-lioren-email');

    const manualNotifyCheckbox = document.getElementById('reg-invoice-notify');
    const manualBrevoCard = document.getElementById('manual-brevo-card-box');
    const manualRecipientsBar = document.getElementById('manual-notify-recipients-bar');
    const btnPreviewManualEmail = document.getElementById('btn-preview-manual-email');
    const actSelect = document.getElementById('lioren-dte-actividad');

    let emailNotificationState = {
      customized: false,
      checkedEmails: [],
      extraToText: '',
      ccText: '',
      effectiveToEmails: [],
      effectiveCcEmails: [],
      customMessage: 'Factura oficial electrónica emitida.'
    };

    const resolveActiveModalRecipients = () => {
      const extraFromForm = [emailInput?.value?.trim(), legal.email_facturacion, legal.rep_legal_email].filter(Boolean);
      if (emailNotificationState.customized) {
        return {
          toEmails: emailNotificationState.effectiveToEmails || [],
          ccEmails: emailNotificationState.effectiveCcEmails || []
        };
      }
      const res = resolveInvoiceEmailCandidates(record.comercio, dataset, extraFromForm);
      return {
        toEmails: res.defaultRecipients,
        ccEmails: []
      };
    };

    const buildRecipientsBarHtml = (toEmails, ccEmails) => {
      if (!toEmails || toEmails.length === 0) {
        return `
          <span style="font-size: 0.71rem; color: #b45309; font-weight: 600;">
            <i class="ri-error-warning-line"></i> Sin destinatario registrado aún — haz clic en <strong>Previsualizar correo</strong> para indicar correo.
          </span>
        `;
      }
      const shown = toEmails.slice(0, 2);
      const rest = toEmails.length - shown.length;
      return `
        <span style="font-size: 0.7rem; font-weight: 700; color: var(--color-text-muted);">Para:</span>
        ${shown.map(em => `<span class="lioren-recipient-chip" title="${escHtml(em)}"><i class="ri-mail-line"></i> ${escHtml(em)}</span>`).join('')}
        ${rest > 0 ? `<span class="lioren-recipient-chip">+${rest} más</span>` : ''}
        ${ccEmails && ccEmails.length > 0 ? `<span class="lioren-recipient-chip" style="color: #0284c7; border-color: rgba(2, 132, 199, 0.32);">CC: ${ccEmails.length}</span>` : ''}
      `;
    };

    const syncEmailNotificationUi = () => {
      const { toEmails, ccEmails } = resolveActiveModalRecipients();
      const barHtml = buildRecipientsBarHtml(toEmails, ccEmails);

      if (liorenBrevoCard && notifyCheckbox && liorenRecipientsBar) {
        liorenBrevoCard.classList.toggle('unchecked', !notifyCheckbox.checked);
        liorenRecipientsBar.style.display = notifyCheckbox.checked ? 'flex' : 'none';
        liorenRecipientsBar.innerHTML = barHtml;
      }
      if (manualBrevoCard && manualNotifyCheckbox && manualRecipientsBar) {
        manualBrevoCard.classList.toggle('unchecked', !manualNotifyCheckbox.checked);
        manualRecipientsBar.style.display = manualNotifyCheckbox.checked ? 'flex' : 'none';
        manualRecipientsBar.innerHTML = barHtml;
      }
    };

    if (notifyCheckbox) notifyCheckbox.addEventListener('change', syncEmailNotificationUi);
    if (manualNotifyCheckbox) manualNotifyCheckbox.addEventListener('change', syncEmailNotificationUi);
    if (emailInput) emailInput.addEventListener('input', syncEmailNotificationUi);
    syncEmailNotificationUi();

    const triggerEmailPreview = (sourcePanel) => {
      const liveGross = sourcePanel === 'lioren'
        ? Math.max(0, Math.round(Number(brutoInput?.value) || initialTotalSii))
        : rawGrossAmount;
      const liveDue = sourcePanel === 'lioren'
        ? (vencInput?.value || initialDueDate)
        : (document.getElementById('reg-invoice-due-date')?.value || initialDueDate);

      openInvoiceEmailPreviewModal({
        mode: 'single',
        items: [{
          record,
          comercioName: record.comercio,
          periodName: periodRaw,
          serviceType,
          liveGrossAmount: liveGross,
          liveDueDateIso: liveDue,
          extraEmails: [emailInput?.value?.trim(), legal.email_facturacion, legal.rep_legal_email].filter(Boolean)
        }],
        dataset,
        currentState: emailNotificationState,
        onSaveState: (newState) => {
          emailNotificationState = newState;
          if (newState.effectiveToEmails?.length > 0) {
            if (sourcePanel === 'lioren' && notifyCheckbox) notifyCheckbox.checked = true;
            if (sourcePanel === 'manual' && manualNotifyCheckbox) manualNotifyCheckbox.checked = true;
          }
          syncEmailNotificationUi();
        }
      });
    };

    if (btnPreviewLiorenEmail) {
      btnPreviewLiorenEmail.addEventListener('click', () => triggerEmailPreview('lioren'));
    }
    if (btnPreviewManualEmail) {
      btnPreviewManualEmail.addEventListener('click', () => triggerEmailPreview('manual'));
    }

    // --- Consultar estado en vivo de Lioren (Sandbox vs Producción + Folios) ---
    getLiorenStatus(false)
      .then(st => {
        if (!document.body.contains(modal)) return;
        envBanner.style.opacity = '1';
        envBanner.className = `lioren-env-banner compact-bar ${st.isSandbox ? 'sandbox' : 'production'}`;
        const f33 = st.folios?.['33'];
        envBanner.innerHTML = `
          <span>
            <i class="${st.isSandbox ? 'ri-flask-fill' : 'ri-shield-check-fill'}"></i>
            ${st.isSandbox ? `ENTORNO PRUEBAS (${escHtml(st.miempresa?.rs || 'Sandbox')})` : `PRODUCCIÓN SII (${escHtml(st.miempresa?.rs || 'STOCKA SPA')})`}
          </span>
          <span>
            ${f33 ? `Folios 33 disp.: <strong>${f33.disponibles}</strong> · Próx: <strong>#${f33.siguiente}</strong>` : 'Conectado'}
          </span>
        `;

        // Poblar actividades económicas reales del emisor si vienen desde Lioren
        if (Array.isArray(st.actividades) && st.actividades.length > 0) {
          actSelect.innerHTML = st.actividades.map(a => {
            const code = String(a.codigo || a.codigosii || '');
            const fullName = String(a.nombre || '').trim();
            const shortName = fullName.length > 34 ? `${fullName.slice(0, 32)}…` : fullName;
            return `<option value="${escHtml(code)}" title="${escHtml(code + ' — ' + fullName)}" ${code === defaultActividad ? 'selected' : ''}>${escHtml(code)} — ${escHtml(shortName)}</option>`;
          }).join('');
        }

        // En Sandbox desmarcamos por defecto el envío de correo real al cliente para evitar confusiones
        const notifyDesgloseCb = document.getElementById('lioren-notify-desglose-brevo');
        if (st.isSandbox) {
          notifyCheckbox.checked = false;
          if (notifyDesgloseCb) notifyDesgloseCb.checked = false;
          notifyHint.innerHTML = `<strong style="color: #d97706;">Modo Pruebas detectado:</strong> desmarcado por defecto para no enviar correo real al cliente con un folio de prueba.`;
        } else {
          notifyCheckbox.checked = true;
        }
        syncEmailNotificationUi();
      })
      .catch(err => {
        if (!document.body.contains(modal)) return;
        envBanner.style.opacity = '1';
        envBanner.innerHTML = `
          <span style="color: #ef4444;"><i class="ri-error-warning-line"></i> Pendiente configurar conexión Edge Function: ${escHtml(err.message)}</span>
        `;
      });

    // --- Envío Formulario A: Emitir en LIOREN API ---
    formLioren.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const submitBtn = document.getElementById('btn-submit-lioren-emit');

      const rutVal = rutInput.value.trim();
      const rutValidation = validateChileanRut(rutVal);
      if (!rutValidation.valid) {
        Swal.fire('RUT Inválido', `El RUT ingresado (${rutVal}) no tiene un dígito verificador válido.`, 'warning');
        return;
      }

      const comunaOpt = comunaSelect.options[comunaSelect.selectedIndex];
      const ciudadOpt = ciudadSelect.options[ciudadSelect.selectedIndex];
      const comunaId = parseInt(comunaSelect.value, 10);
      const ciudadId = parseInt(ciudadSelect.value, 10);
      if (!comunaId || !ciudadId) {
        Swal.fire('Falta Comuna / Ciudad', 'Selecciona la Comuna y Ciudad tributaria del receptor.', 'warning');
        return;
      }

      const montoNeto = Math.round(Number(netoInput.value) || 0);
      if (montoNeto <= 0) {
        Swal.fire('Monto Inválido', 'El monto neto a facturar debe ser mayor a $0.', 'warning');
        return;
      }

      const fechaEmisionVal = fechaInput.value || todayIso;
      const vencimientoVal = vencInput.value || null;
      if (vencimientoVal && vencimientoVal < fechaEmisionVal) {
        Swal.fire('Fecha de Vencimiento Inválida', 'La fecha de vencimiento no puede ser anterior a la fecha de emisión de la factura.', 'warning');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="ri-loader-4-line spin"></i> Emitiendo en Lioren SII...';

      try {
        const emitResult = await callLiorenApi({
          action: 'emit_dte',
          recordId,
          comercio: record.comercio,
          serviceType,
          tipodoc: tipodocSelect.value,
          actividad: actSelect.value,
          fecha: fechaEmisionVal,
          vencimiento: vencimientoVal,
          glosa: document.getElementById('lioren-dte-glosa').value.trim(),
          montoNeto,
          receptor: {
            rut: rutValidation.formatted,
            rs: document.getElementById('lioren-rec-rs').value.trim(),
            giro: giroInput.value.trim().slice(0, 40),
            direccion: document.getElementById('lioren-rec-direccion').value.trim(),
            comuna: comunaId,
            ciudad: ciudadId,
            comunaNombre: comunaOpt?.getAttribute('data-nombre') || '',
            ciudadNombre: ciudadOpt?.getAttribute('data-nombre') || '',
            email: document.getElementById('lioren-rec-email').value.trim()
          },
          saveCommerceLegalInfo: document.getElementById('lioren-save-commerce-legal').checked,
          idempotencyKey: sessionIdempotencyKey
        });

        // Disparar correo(s) Brevo si el usuario lo dejó marcado
        const receptorEmailEntered = document.getElementById('lioren-rec-email').value.trim();
        const notifyDesgloseEl = document.getElementById('lioren-notify-desglose-brevo');
        let autoDesgloseSentOk = false;
        let autoEmailSentOk = false;

        if (notifyDesgloseEl?.checked) {
          autoDesgloseSentOk = await sendBrevoDesgloseNotification(
            recordId,
            record.comercio,
            serviceType,
            [receptorEmailEntered],
            {
              explicitToEmails: emailNotificationState.customized ? emailNotificationState.effectiveToEmails : undefined,
              ccEmails: emailNotificationState.effectiveCcEmails
            }
          );
        }

        if (notifyCheckbox.checked) {
          autoEmailSentOk = await sendBrevoInvoiceNotification(
            recordId,
            record.comercio,
            serviceType,
            [receptorEmailEntered],
            {
              explicitToEmails: emailNotificationState.customized ? emailNotificationState.effectiveToEmails : undefined,
              ccEmails: emailNotificationState.effectiveCcEmails,
              customMessage: emailNotificationState.customMessage
            }
          );
        }

        // Invalidar caché de folios disponibles
        cachedLiorenStatusTs = 0;
        modal.remove();

        await refreshViewsAfterInvoiceAction(record.period_id, recordId, serviceType);

        const dte = emitResult.dte || {};
        const fallbackEmailVal = receptorEmailEntered || legal.email_facturacion || legal.rep_legal_email || '';
        const safeCommJs = String(record.comercio || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeFallbackEmailJs = String(fallbackEmailVal).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        if (fromPublishFlow && typeof window.openPostPublishAndInvoiceModal === 'function') {
          window.openPostPublishAndInvoiceModal({
            recordId,
            periodId: record.period_id || '',
            periodName: periodRaw,
            comercioName: record.comercio,
            serviceType,
            dte,
            pdfUrl: emitResult.pdfUrl || '',
            xmlUrl: emitResult.xmlUrl || '',
            isSandbox: Boolean(emitResult.isSandbox),
            fallbackEmail: fallbackEmailVal,
            desgloseAlreadySent: autoDesgloseSentOk,
            invoiceAlreadySent: autoEmailSentOk
          });
          return;
        }

        Swal.fire({
          icon: 'success',
          title: `¡Factura Folio #${dte.folio} Emitida!`,
          html: `
            <div style="text-align: left; font-size: 0.86rem; line-height: 1.55;">
              ${emitResult.isSandbox ? `<div style="background: rgba(245, 158, 11, 0.14); color: #b45309; padding: 0.4rem 0.65rem; border-radius: 6px; font-size: 0.76rem; font-weight: 700; margin-bottom: 0.65rem;"><i class="ri-flask-fill"></i> Emitida en Entorno de Pruebas Lioren</div>` : ''}
              <div><strong>Comercio:</strong> ${escHtml(record.comercio)} (${escHtml(dte.rs || '')})</div>
              <div><strong>Folio SII Asignado:</strong> <span style="font-size: 1rem; font-weight: 800; color: #5f06fa;">#${dte.folio}</span></div>
              <div><strong>Neto:</strong> ${formatCLP(dte.montoneto)} · <strong>IVA:</strong> ${formatCLP(dte.montoiva)} · <strong>Total:</strong> <strong>${formatCLP(dte.montototal)}</strong></div>
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.85rem;">
                ${emitResult.pdfUrl ? `<a href="${emitResult.pdfUrl}" target="_blank" class="btn btn-primary btn-sm" style="flex: 1; justify-content: center; text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;"><i class="ri-file-pdf-fill"></i> Ver / Descargar PDF</a>` : ''}
                ${emitResult.xmlUrl ? `<a href="${emitResult.xmlUrl}" target="_blank" class="btn btn-outline btn-sm" style="flex: 1; justify-content: center; text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;"><i class="ri-code-s-slash-line"></i> Descargar XML SII</a>` : ''}
              </div>
              <div style="margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px dashed var(--color-border); display: flex; flex-direction: column; gap: 0.45rem;">
                ${autoEmailSentOk ? `
                  <div style="font-size: 0.75rem; color: #059669; font-weight: 600;">
                    <i class="ri-checkbox-circle-fill"></i> Notificación automática de Factura enviada al seller.
                  </div>
                ` : ''}
                <button type="button"
                        onclick="window.openInvoiceEmailComposer('${recordId}', '${safeCommJs}', '${record.period_id || ''}', '${serviceType}', '${safeFallbackEmailJs}', 'invoice_uploaded')"
                        class="btn btn-sm"
                        style="width: 100%; background: linear-gradient(135deg, #059669, #10b981); color: #ffffff; border: none; font-weight: 700; padding: 0.52rem 0.85rem; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; cursor: pointer; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);">
                  <i class="ri-mail-send-fill"></i> ${autoEmailSentOk ? 'Reenviar / Enviar Factura con Copia (CC)' : 'Enviar Correo de Factura Emitida'}
                </button>
                <button type="button"
                        onclick="window.openInvoiceEmailComposer('${recordId}', '${safeCommJs}', '${record.period_id || ''}', '${serviceType}', '${safeFallbackEmailJs}', 'billing_summary')"
                        class="btn btn-outline btn-sm"
                        style="width: 100%; border-color: rgba(95, 6, 250, 0.35); color: #5f06fa; font-weight: 700; padding: 0.48rem 0.85rem; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; cursor: pointer;">
                  <i class="ri-file-list-3-line"></i> Enviar Correo de Desglose de Servicios
                </button>
              </div>
            </div>
          `,
          confirmButtonText: 'Listo',
          confirmButtonColor: '#5f06fa'
        });
      } catch (err) {
        console.error('Error emitiendo DTE en Lioren:', err);
        Swal.fire('No se pudo emitir la factura', err.message || String(err), 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ri-flashlight-fill"></i> Emitir Factura Electrónica';
      }
    });

    // --- Validación y Envío Formulario B: Registro Manual Clásico ---
    const manualNumInput = document.getElementById('reg-invoice-num');
    const manualFeedback = document.getElementById('reg-invoice-num-feedback');
    const manualBtn = document.getElementById('btn-submit-reg-invoice');
    let dupTimeout = null;
    let isManualDup = false;

    manualNumInput.addEventListener('input', () => {
      clearTimeout(dupTimeout);
      const num = parseInt(manualNumInput.value.trim(), 10);
      if (!num || num <= 0) {
        manualFeedback.style.display = 'none';
        isManualDup = false;
        manualBtn.disabled = false;
        return;
      }
      manualFeedback.style.display = 'block';
      manualFeedback.style.color = 'var(--color-text-muted)';
      manualFeedback.innerHTML = '<i class="ri-loader-4-line spin"></i> Validando folio...';
      manualBtn.disabled = true;

      dupTimeout = setTimeout(async () => {
        try {
          const { data: dups } = await supabase
            .from('billing_records')
            .select('id, comercio, billing_periods(name), num_factura, num_factura_enviame')
            .or(`num_factura.eq.${num},num_factura_enviame.eq.${num}`);
          const realDups = (dups || []).filter(r => r.id !== recordId);
          if (realDups.length > 0) {
            const d = realDups[0];
            manualFeedback.style.color = '#ef4444';
            manualFeedback.innerHTML = `<i class="ri-error-warning-line"></i> El folio #${num} ya está usado en <strong>${escHtml(d.comercio)}</strong> (${escHtml(d.billing_periods?.name || '')}).`;
            isManualDup = true;
            manualBtn.disabled = true;
          } else {
            manualFeedback.style.color = '#10b981';
            manualFeedback.innerHTML = `<i class="ri-checkbox-circle-line"></i> Folio disponible.`;
            isManualDup = false;
            manualBtn.disabled = false;
          }
        } catch {
          manualFeedback.style.display = 'none';
          isManualDup = false;
          manualBtn.disabled = false;
        }
      }, 300);
    });

    formManual.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (isManualDup) return;
      const num = parseInt(manualNumInput.value.trim(), 10);
      if (!num || num <= 0) return;

      manualBtn.disabled = true;
      manualBtn.innerHTML = '<i class="ri-loader-4-line spin"></i> Guardando...';

      try {
        const fileInput = document.getElementById('reg-invoice-file');
        const dueDateVal = (document.getElementById('reg-invoice-due-date')?.value || '').trim() || null;
        const notifyManual = document.getElementById('reg-invoice-notify')?.checked;

        const updates = { updated_at: new Date().toISOString() };
        if (fileInput?.files?.[0]) {
          const file = fileInput.files[0];
          const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          const storagePath = `billing_files/${recordId}_factura_${serviceType}_${Date.now()}_${sanitizedName}`;
          const { error: upErr } = await supabase.storage.from('payment_receipts').upload(storagePath, file);
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from('payment_receipts').getPublicUrl(storagePath);
          if (serviceType === 'fulfillment') updates.factura_fulfillment_pdf_url = urlData.publicUrl;
          else updates.factura_enviame_pdf_url = urlData.publicUrl;
        }

        if (serviceType === 'fulfillment') {
          updates.factura_fulfillment = 'Emitida';
          updates.num_factura = num;
          updates.fecha_limite = dueDateVal;
        } else {
          updates.factura_enviame = 'Emitida';
          updates.num_factura_enviame = num;
          updates.fecha_limite_enviame = dueDateVal;
        }

        const { error: saveErr } = await supabase.from('billing_records').update(updates).eq('id', recordId);
        if (saveErr) throw saveErr;

        let manualEmailSentOk = false;
        if (notifyManual) {
          manualEmailSentOk = await sendBrevoInvoiceNotification(
            recordId,
            record.comercio,
            serviceType,
            [legal.email_facturacion, legal.rep_legal_email],
            {
              explicitToEmails: emailNotificationState.customized ? emailNotificationState.effectiveToEmails : undefined,
              ccEmails: emailNotificationState.effectiveCcEmails,
              customMessage: emailNotificationState.customMessage
            }
          );
        }

        modal.remove();
        await refreshViewsAfterInvoiceAction(record.period_id, recordId, serviceType);
        const fallbackManualVal = legal.email_facturacion || legal.rep_legal_email || '';
        const safeCommManualJs = String(record.comercio || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeFallbackManualJs = String(fallbackManualVal).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        if (fromPublishFlow && typeof window.openPostPublishAndInvoiceModal === 'function') {
          window.openPostPublishAndInvoiceModal({
            recordId,
            periodId: record.period_id || '',
            periodName: periodRaw,
            comercioName: record.comercio,
            serviceType,
            dte: { folio: num, montoneto: initialNetAmount, montoiva: initialIvaAmount, montototal: rawGrossAmount },
            pdfUrl: (serviceType === 'fulfillment' ? updates.factura_fulfillment_pdf_url : updates.factura_enviame_pdf_url) || '',
            xmlUrl: '',
            isSandbox: false,
            fallbackEmail: fallbackManualVal,
            desgloseAlreadySent: false,
            invoiceAlreadySent: manualEmailSentOk
          });
          return;
        }

        Swal.fire({
          icon: 'success',
          title: 'Factura registrada',
          html: `
            <div style="font-size: 0.88rem; display: flex; flex-direction: column; gap: 0.45rem;">
              <p style="margin: 0 0 0.35rem 0;">Folio <strong>#${num}</strong> guardado exitosamente para <strong>${escHtml(record.comercio)}</strong>.</p>
              <button type="button"
                      onclick="window.openInvoiceEmailComposer('${recordId}', '${safeCommManualJs}', '${record.period_id || ''}', '${serviceType}', '${safeFallbackManualJs}', 'invoice_uploaded')"
                      class="btn btn-sm"
                      style="width: 100%; background: linear-gradient(135deg, #059669, #10b981); color: #ffffff; border: none; font-weight: 700; padding: 0.52rem 0.85rem; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; cursor: pointer;">
                <i class="ri-mail-send-fill"></i> ${manualEmailSentOk ? 'Reenviar / Enviar Factura con Copia (CC)' : 'Enviar Correo de Factura Emitida'}
              </button>
              <button type="button"
                      onclick="window.openInvoiceEmailComposer('${recordId}', '${safeCommManualJs}', '${record.period_id || ''}', '${serviceType}', '${safeFallbackManualJs}', 'billing_summary')"
                      class="btn btn-outline btn-sm"
                      style="width: 100%; border-color: rgba(95, 6, 250, 0.35); color: #5f06fa; font-weight: 700; padding: 0.48rem 0.85rem; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; cursor: pointer;">
                <i class="ri-file-list-3-line"></i> Enviar Correo de Desglose de Servicios
              </button>
            </div>
          `,
          confirmButtonText: 'Listo',
          confirmButtonColor: '#5f06fa'
        });
      } catch (err) {
        alert('Error al registrar factura: ' + (err.message || err));
        manualBtn.disabled = false;
        manualBtn.innerHTML = '<i class="ri-save-line"></i> Guardar Folio Manual';
      }
    });
  } catch (err) {
    console.error('Error abriendo modal de facturación Lioren:', err);
    Swal.fire('Error', err.message || String(err), 'error');
  }
};

// Reemplazar globalmente markDashboardInvoiceAsIssued para que todos los botones existentes usen el nuevo modal Lioren + Manual
window.markDashboardInvoiceAsIssued = window.openLiorenEmitModal;

// ============================================================================
// EVALUADOR DE PREPARACIÓN TRIBUTARIA SII (PARA PÍLDORAS Y EMISIÓN 1-CLICK)
// ============================================================================
export function evaluateCommerceSiiReadiness(comercioName, dataset = null) {
  const legal = typeof window.getBillingCommerceLegalInfo === 'function'
    ? window.getBillingCommerceLegalInfo(comercioName, dataset)
    : {};

  const rutCheck = validateChileanRut(legal.rut || '');
  const rs = String(legal.razon_social || '').trim().slice(0, 100);
  const giro = String(legal.giro_facturacion || '').trim().slice(0, 40);
  const direccion = String(legal.direccion_facturacion || '').trim().slice(0, 70);
  const resolvedLoc = resolveLiorenLocalityIds(legal.comuna_facturacion || '', legal.ciudad_facturacion || '');
  const comunaId = Number(legal.lioren_comuna_id || resolvedLoc.comunaId || 0) || null;
  const ciudadId = Number(legal.lioren_ciudad_id || resolvedLoc.ciudadId || 0) || null;

  const comunaObj = comunaId ? (LIOREN_CATALOGS.comunas || []).find(c => c.id === comunaId) : null;
  const ciudadObj = ciudadId ? (LIOREN_CATALOGS.ciudades || []).find(ci => ci.id === ciudadId) : null;

  const missing = [];
  if (!rutCheck.valid) missing.push('RUT');
  if (rs.length < 5) missing.push('Razón Social');
  if (giro.length < 5) missing.push('Giro SII');
  if (direccion.length < 5) missing.push('Dirección');
  if (!comunaId) missing.push('Comuna SII');
  if (!ciudadId) missing.push('Ciudad SII');

  return {
    ready: missing.length === 0,
    missing,
    rutValid: rutCheck.valid,
    rutFormatted: rutCheck.valid ? rutCheck.formatted : String(legal.rut || '').trim(),
    rs,
    giro,
    direccion,
    comunaId,
    ciudadId,
    comunaNombre: comunaObj?.nombre || resolvedLoc.comunaNombre || legal.comuna_facturacion || '',
    ciudadNombre: ciudadObj?.nombre || resolvedLoc.ciudadNombre || legal.ciudad_facturacion || '',
    email: String(legal.email_facturacion || legal.rep_legal_email || '').trim().slice(0, 80)
  };
}
window.evaluateCommerceSiiReadiness = evaluateCommerceSiiReadiness;

// Intenta autocompletar en silencio desde el Círculo de Compradores de Lioren si tiene RUT válido pero faltan datos locales
async function tryHydrateReceptorFromLioren(siiInfo) {
  if (siiInfo.ready || !siiInfo.rutValid) return siiInfo;
  try {
    const res = await callLiorenApi({ action: 'lookup_comprador', rut: siiInfo.rutFormatted });
    if (!res?.found || !res.comprador) return siiInfo;

    const c = res.comprador;
    const rs = siiInfo.rs.length >= 5 ? siiInfo.rs : String(c.rs || '').trim().slice(0, 100);
    const giro = siiInfo.giro.length >= 5 ? siiInfo.giro : String(c.giro || '').trim().slice(0, 40);
    const direccion = siiInfo.direccion.length >= 5 ? siiInfo.direccion : String(c.direccion || '').trim().slice(0, 70);
    const comunaId = siiInfo.comunaId || (c.comuna_id ? Number(c.comuna_id) : null);
    let ciudadId = siiInfo.ciudadId || (c.ciudad_id ? Number(c.ciudad_id) : null);

    const comunaObj = comunaId ? (LIOREN_CATALOGS.comunas || []).find(cm => cm.id === comunaId) : null;
    if (!ciudadId && comunaObj) {
      ciudadId = resolveLiorenLocalityIds(comunaObj.nombre, '').ciudadId;
    }
    const ciudadObj = ciudadId ? (LIOREN_CATALOGS.ciudades || []).find(ci => ci.id === ciudadId) : null;

    const missing = [];
    if (!siiInfo.rutValid) missing.push('RUT');
    if (rs.length < 5) missing.push('Razón Social');
    if (giro.length < 5) missing.push('Giro SII');
    if (direccion.length < 5) missing.push('Dirección');
    if (!comunaId) missing.push('Comuna SII');
    if (!ciudadId) missing.push('Ciudad SII');

    return {
      ...siiInfo,
      ready: missing.length === 0,
      missing,
      rs,
      giro,
      direccion,
      comunaId,
      ciudadId,
      comunaNombre: comunaObj?.nombre || siiInfo.comunaNombre,
      ciudadNombre: ciudadObj?.nombre || siiInfo.ciudadNombre,
      email: siiInfo.email || String(c.email || '').trim().slice(0, 80),
      hydratedFromLioren: true
    };
  } catch {
    return siiInfo;
  }
}

window.openInvoiceEmailComposer = function(recordId, comercioName, periodId, serviceType = 'fulfillment', fallbackEmail = '', emailType = 'invoice_uploaded') {
  if (typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
    Swal.close();
  }
  if (typeof window.openSendBillingEmailModal === 'function') {
    window.openSendBillingEmailModal(recordId, comercioName, periodId, {
      defaultEmailType: emailType || 'invoice_uploaded',
      defaultServiceType: serviceType,
      fallbackEmail
    });
  }
};

function formatIsoToDisplayDate(dateStr) {
  if (!dateStr) return 'No definida';
  const parts = String(dateStr).trim().split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return String(dateStr);
}

function addDaysToDisplayDate(dateStr, days) {
  if (!dateStr) return 'No definida';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return 'No definida';
    d.setDate(d.getDate() + days);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  } catch {
    return 'No definida';
  }
}

export function resolveInvoiceEmailCandidates(comercioName, dataset = null, extraEmails = []) {
  const ds = dataset || window.__billingCommerceLegalDataset || {};
  const norm = (s) => String(s || '').trim().toLowerCase();
  const target = norm(comercioName);
  const aliases = new Set([target]);

  if (target === 'pom kids') aliases.add('poms kids');
  if (target === 'poms kids') aliases.add('pom kids');

  (ds.mappings || []).forEach(m => {
    const cName = norm(m.comercio_nombre);
    const bName = norm(m.billing_name);
    if (bName === target && cName) aliases.add(cName);
    if (cName === target && bName) aliases.add(bName);
  });

  const seen = new Set();
  const candidates = [];

  const pushCandidate = (rawEmail, label, role, defaultSelected = false) => {
    String(rawEmail || '')
      .split(/[,;\s]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.includes('@') && e.includes('.'))
      .forEach(clean => {
        if (seen.has(clean)) {
          if (defaultSelected) {
            const ex = candidates.find(item => item.email === clean);
            if (ex) ex.defaultSelected = true;
          }
          return;
        }
        seen.add(clean);
        candidates.push({
          email: clean,
          label: String(label || clean.split('@')[0]).trim(),
          role: String(role || 'Contacto').trim(),
          defaultSelected: Boolean(defaultSelected)
        });
      });
  };

  // 1. Contactos activos de facturación (prioridad oficial de Brevo, respetando email_preferences.billing)
  const allContacts = (ds.contacts || []).filter(c => c?.email && aliases.has(norm(c.comercio)));
  const activeContacts = allContacts.filter(c => c.activo !== false);
  const billingEnabledContacts = activeContacts.filter(c => !c.email_preferences || c.email_preferences.billing !== false);
  const billingMutedContacts = activeContacts.filter(c => c.email_preferences && c.email_preferences.billing === false);
  const billingMutedSet = new Set(billingMutedContacts.map(c => norm(c.email)));
  const hasActiveContacts = billingEnabledContacts.length > 0;

  billingEnabledContacts.forEach(c => {
    pushCandidate(c.email, c.nombre || 'Finanzas', c.rol || 'Cobranza', true);
  });

  // 2. Correos adicionales provistos en el modal (ej. Correo Receptor DTE)
  (extraEmails || []).forEach(em => {
    const clean = norm(em);
    pushCandidate(em, 'Receptor DTE', 'Factura SII', !hasActiveContacts && !billingMutedSet.has(clean));
  });

  // 3. Configuración legal / tributaria del comercio
  if (typeof window.getBillingCommerceLegalInfo === 'function') {
    const leg = window.getBillingCommerceLegalInfo(comercioName, ds);
    if (leg.email_facturacion) {
      const clean = norm(leg.email_facturacion);
      pushCandidate(leg.email_facturacion, 'Facturación SII', 'Ficha SII', !hasActiveContacts && !billingMutedSet.has(clean) && candidates.filter(c => c.defaultSelected).length === 0);
    }
    if (leg.rep_legal_email) {
      const clean = norm(leg.rep_legal_email);
      pushCandidate(leg.rep_legal_email, leg.rep_legal_nombre || 'Rep. Legal', 'Legal', !hasActiveContacts && !billingMutedSet.has(clean) && candidates.filter(c => c.defaultSelected).length === 0);
    }
  }

  (ds.configs || [])
    .filter(cfg => aliases.has(norm(cfg.comercio)))
    .forEach(cfg => {
      if (cfg.email_colaborador) pushCandidate(cfg.email_colaborador, 'Colaborador', 'Equipo', false);
      if (cfg.contacto && String(cfg.contacto).includes('@')) pushCandidate(cfg.contacto, 'Contacto', 'Comercio', false);
    });

  // 4. Usuarios del portal WMS asignados a este comercio
  (ds.profiles || []).forEach(p => {
    if (!p?.email || p.role === 'admin' || !p.comercio) return;
    const assigned = String(p.comercio).split(',').map(s => norm(s));
    if (assigned.some(a => aliases.has(a))) {
      const clean = norm(p.email);
      const shouldSelectFallback = !hasActiveContacts && !billingMutedSet.has(clean) && candidates.filter(c => c.defaultSelected).length === 0;
      pushCandidate(p.email, p.full_name || 'Usuario Portal', 'Portal WMS', shouldSelectFallback);
    }
  });

  // 5. Contactos con facturación desactivada o inactivos (disponibles para marcar manualmente si se desea)
  billingMutedContacts.forEach(c => {
    pushCandidate(c.email, c.nombre || 'Contacto', 'Sin Facturación', false);
  });
  allContacts
    .filter(c => c.activo === false)
    .forEach(c => pushCandidate(c.email, c.nombre || 'Contacto', 'Inactivo', false));

  const defaultRecipients = candidates.filter(c => c.defaultSelected).map(c => c.email);
  return { candidates, defaultRecipients, hasActiveContacts };
}

function buildInvoiceUploadedEmailPreview({
  record,
  comercioName,
  periodName,
  serviceType = 'fulfillment',
  liveGrossAmount = null,
  liveDueDateIso = '',
  customMessage = 'Factura oficial electrónica emitida.'
}) {
  const safeComm = escHtml(comercioName || record?.comercio || 'Comercio');
  const safePeriod = escHtml(periodName || record?.billing_periods?.name || 'Periodo Actual');
  const isFulf = serviceType !== 'enviame';

  const totalFulf = isFulf && liveGrossAmount !== null
    ? Math.max(0, Math.round(Number(liveGrossAmount) || 0))
    : Math.round(Number(record?.total_fulfillment || 0));
  const abonoFulf = Math.round(Number(record?.abono_fulfillment || 0));
  const pagoFulf = record?.pago_fulfillment || 'Por solicitar';
  const isFulfPaid = ['Recibido', 'aprobado', 'Sin movimientos'].includes(pagoFulf);
  const pendFulf = isFulfPaid ? 0 : Math.max(0, totalFulf - abonoFulf);

  const totalEnv = !isFulf && liveGrossAmount !== null
    ? Math.max(0, Math.round(Number(liveGrossAmount) || 0))
    : Math.round(Number(record?.enviame || 0));
  const abonoEnv = Math.round(Number(record?.abono_enviame || 0));
  const pagoEnv = record?.pago_enviame || 'Por solicitar';
  const isEnvPaid = ['Recibido', 'aprobado', 'Sin movimientos'].includes(pagoEnv);
  const pendEnv = isEnvPaid ? 0 : Math.max(0, totalEnv - abonoEnv);

  const dueFulfStr = formatIsoToDisplayDate(isFulf ? (liveDueDateIso || record?.fecha_limite) : record?.fecha_limite);
  const dueEnvStr = formatIsoToDisplayDate(!isFulf ? (liveDueDateIso || record?.fecha_limite_enviame) : record?.fecha_limite_enviame);

  const totalPeriodInvoiced = isFulf ? totalFulf : totalEnv;
  const totalPeriodPending = isFulf ? pendFulf : pendEnv;
  const totalMonto = (totalPeriodPending > 0 && totalPeriodPending < totalPeriodInvoiced)
    ? totalPeriodPending
    : totalPeriodInvoiced;

  // Botones de descarga de factura PDF (el servicio actual se adjuntará recién timbrado por Lioren)
  let invoiceButtonsHtml = '';
  if (isFulf) {
    invoiceButtonsHtml += `
      <span style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; margin: 5px; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);">
        Descargar Factura Fulfillment
      </span>
    `;
    if (record?.factura_enviame_pdf_url) {
      invoiceButtonsHtml += `
        <a href="${escHtml(record.factura_enviame_pdf_url)}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none; margin: 5px;">
          Descargar Factura Envíame
        </a>
      `;
    }
  } else {
    if (record?.factura_fulfillment_pdf_url) {
      invoiceButtonsHtml += `
        <a href="${escHtml(record.factura_fulfillment_pdf_url)}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none; margin: 5px;">
          Descargar Factura Fulfillment
        </a>
      `;
    }
    invoiceButtonsHtml += `
      <span style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; margin: 5px; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);">
        Descargar Factura Envíame
      </span>
    `;
  }

  let servicesHtml = '';
  if (isFulf) {
    const isInteractive = Boolean(
      (record?.fulfillment_link && (record.fulfillment_link.includes('.json') || record.fulfillment_link.includes('billing_snapshots'))) ||
      (record?.fulfillment_pdf_url && (record.fulfillment_pdf_url.includes('.json') || record.fulfillment_pdf_url.includes('billing_snapshots')))
    );
    const docLink = isInteractive
      ? (record?.fulfillment_link || record?.fulfillment_pdf_url)
      : (record?.fulfillment_pdf_url || record?.fulfillment_link);

    let docBtn = '';
    if (isInteractive) {
      docBtn = `
        <div style="font-size: 12.5px; color: #475569; line-height: 1.45; margin-bottom: 10px; text-align: center;">
          Este periodo cuenta con <strong>Desglose Interactivo 360°</strong> disponible en tu portal WMS Stocka.
        </div>
        <span style="display: inline-block; background-color: #5f06fa; color: #ffffff; padding: 9px 20px; font-size: 13px; font-weight: 700; border-radius: 6px;">
          Ver Desglose Interactivo en WMS
        </span>
      `;
    } else if (docLink) {
      docBtn = `<a href="${escHtml(docLink)}" target="_blank" style="display: inline-block; background-color: #ffffff; color: #2563eb; border: 1px solid #2563eb; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; text-decoration: none;">Descargar Desglose Fulfillment</a>`;
    } else {
      docBtn = `<span style="color: #94a3b8; font-size: 12px;">Desglose disponible en el portal WMS</span>`;
    }

    servicesHtml = `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 15px;">
        <div style="font-size: 15px; font-weight: 700; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 14px;">Servicio Fulfillment (Almacenaje y Operación)</div>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Monto Facturado:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #1e293b; text-align: right; font-weight: 700;">${formatCLP(totalFulf)}</td>
          </tr>
          ${abonoFulf > 0 ? `
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Abono Registrado:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #166534; text-align: right; font-weight: 600;">-${formatCLP(abonoFulf)}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Fecha Límite de Pago:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569; text-align: right;">${escHtml(dueFulfStr)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Estado de Pago:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569; text-align: right;"><span style="display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; text-transform: uppercase; ${isFulfPaid ? 'background-color: #dcfce7; color: #166534;' : 'background-color: #fef3c7; color: #92400e;'}">${escHtml(pagoFulf)}</span></td>
          </tr>
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="padding: 8px 0 4px 0; font-size: 13.5px; color: ${isFulfPaid ? '#166534' : '#dc2626'}; font-weight: 700;"><strong>Saldo Pendiente:</strong></td>
            <td style="padding: 8px 0 4px 0; font-size: 14.5px; color: ${isFulfPaid ? '#166534' : '#dc2626'}; text-align: right; font-weight: 800;">${isFulfPaid ? '$0 (Pagado)' : formatCLP(pendFulf)}</td>
          </tr>
        </table>
        <div style="margin-top: 14px; text-align: center;">${docBtn}</div>
      </div>
    `;
  } else {
    const hasEnvPdfs = Array.isArray(record?.enviame_pdfs) && record.enviame_pdfs.length > 0;
    servicesHtml = `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 15px;">
        <div style="font-size: 15px; font-weight: 700; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 14px;">Servicio Envíame (Courier y Despacho)</div>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Monto Facturado:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #1e293b; text-align: right; font-weight: 700;">${formatCLP(totalEnv)}</td>
          </tr>
          ${abonoEnv > 0 ? `
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Abono Registrado:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #166534; text-align: right; font-weight: 600;">-${formatCLP(abonoEnv)}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Fecha Límite de Pago:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569; text-align: right;">${escHtml(dueEnvStr)} <span style="font-size: 11px; color: #ea580c; font-weight: bold; display: block;">(Plazo de 3 días fijado por Envíame)</span></td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569;"><strong>Estado de Pago:</strong></td>
            <td style="padding: 6px 0; font-size: 13.5px; color: #475569; text-align: right;"><span style="display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; text-transform: uppercase; ${isEnvPaid ? 'background-color: #dcfce7; color: #166534;' : 'background-color: #fef3c7; color: #92400e;'}">${escHtml(pagoEnv)}</span></td>
          </tr>
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="padding: 8px 0 4px 0; font-size: 13.5px; color: ${isEnvPaid ? '#166534' : '#dc2626'}; font-weight: 700;"><strong>Saldo Pendiente:</strong></td>
            <td style="padding: 8px 0 4px 0; font-size: 14.5px; color: ${isEnvPaid ? '#166534' : '#dc2626'}; text-align: right; font-weight: 800;">${isEnvPaid ? '$0 (Pagado)' : formatCLP(pendEnv)}</td>
          </tr>
        </table>
        ${hasEnvPdfs ? `
          <div style="margin-top: 14px; text-align: center;">
            <span style="display: inline-block; background-color: #5B00E4; color: #ffffff; padding: 9px 20px; font-size: 13px; font-weight: 700; border-radius: 6px;">Ingresar al WMS</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  let customMsgHtml = '';
  if (customMessage && String(customMessage).trim()) {
    const safeCustom = escHtml(String(customMessage).trim()).replace(/\n/g, '<br>');
    customMsgHtml = `
      <div style="margin: 18px 0; padding: 14px; background-color: #f1f5f9; border-left: 4px solid #94a3b8; font-size: 13px; color: #334155; line-height: 1.5; border-radius: 0 8px 8px 0;">
        <strong>Nota de Finanzas:</strong><br>
        ${safeCustom}
      </div>
    `;
  }

  const subject = `[Factura Disponible] Factura de servicios cargada - ${comercioName || record?.comercio || ''}`;

  const innerCardHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 16px 12px; border-radius: 10px;">
      <div style="max-width: 590px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 10px rgba(15, 23, 42, 0.06); overflow: hidden;">
        <!-- HEADER ESMERALDA -->
        <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 24px 22px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.4px; color: #ffffff !important;">Factura de Servicios Disponible</h1>
          <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.94; color: #ffffff !important;">${safePeriod} - ${safeComm}</p>
        </div>
        <!-- CONTENIDO -->
        <div style="padding: 24px 22px;">
          <div style="font-size: 15px; color: #1e293b; margin-bottom: 18px; line-height: 1.5;">
            Le informamos que se ha cargado en la plataforma del WMS Stocka la factura correspondiente a sus servicios del periodo <strong>${safePeriod}</strong>.
          </div>

          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 16px; font-size: 14px; color: #166534; font-weight: 700; text-align: center;">
            FACTURA DISPONIBLE EN EL PORTAL
          </div>

          <div style="margin: 16px 0 18px 0; text-align: center;">
            ${invoiceButtonsHtml}
            <div style="font-size: 11.5px; color: #059669; margin-top: 6px; font-weight: 600;">
              ✨ Enlace automático al PDF oficial timbrado ante el SII al momento de emitir
            </div>
          </div>

          ${servicesHtml}

          <div style="margin-top: 20px; padding: 14px 16px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 14.5px; font-weight: 700; color: #1e3a8a;">Total Período:</span>
            <span style="font-size: 19px; font-weight: 800; color: #1e3a8a;">${formatCLP(totalMonto)}</span>
          </div>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 18px 0; font-family: sans-serif;">
            <div style="font-size: 12.5px; font-weight: 700; color: #1e293b; margin-bottom: 7px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px;">
              Datos para Transferencia Bancaria
            </div>
            <table style="width: 100%; font-size: 12px; border-collapse: collapse; line-height: 1.5;">
              <tr><td style="color: #64748b; padding: 2px 0; width: 120px;">Razón Social:</td><td style="color: #1e293b; font-weight: 600;">STOCKA SPA</td></tr>
              <tr><td style="color: #64748b; padding: 2px 0;">RUT:</td><td style="color: #1e293b; font-weight: 600;">77.524.557-3</td></tr>
              <tr><td style="color: #64748b; padding: 2px 0;">Banco:</td><td style="color: #1e293b; font-weight: 600;">SCOTIABANK (SUD AMERICANO)</td></tr>
              <tr><td style="color: #64748b; padding: 2px 0;">Tipo de Cuenta:</td><td style="color: #1e293b; font-weight: 600;">CTA CORRIENTE</td></tr>
              <tr><td style="color: #64748b; padding: 2px 0;">N° de Cuenta:</td><td style="color: #1e293b; font-weight: 600; font-family: monospace;">992369965</td></tr>
              <tr><td style="color: #64748b; padding: 2px 0;">Email de Envío:</td><td style="color: #2563eb; font-weight: 600;">finanzas@stocka.cl</td></tr>
            </table>
          </div>

          ${customMsgHtml}

          <div style="text-align: center; margin: 22px 0;">
            <span style="display: block; background-color: #2563eb; color: #ffffff; padding: 11px 22px; font-size: 14.5px; font-weight: 600; border-radius: 8px; text-align: center;">Acceder a WMS Stocka</span>
          </div>

          <div style="margin-top: 22px; padding: 14px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 12.5px; line-height: 1.55;">
            <strong>Acceso a Facturas Históricas:</strong><br>
            Le recordamos que puede revisar e informar el pago de esta y otras facturas pasadas directamente desde el portal de facturación en su cuenta del WMS.
          </div>
        </div>
        <!-- FOOTER -->
        <div style="background-color: #f1f5f9; padding: 18px 16px; text-align: center; font-size: 11.5px; color: #64748b; border-top: 1px solid #e2e8f0; line-height: 1.55;">
          <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka Logo" style="height: 30px; margin-bottom: 8px; display: inline-block;"><br>
          <strong style="color: #1e293b;">Stocka SpA</strong> · Logística y Fulfillment Ecommerce<br>
          Campo de Deportes 405, Ñuñoa · <span style="color: #2563eb; font-weight: 600;">finanzas@stocka.cl</span>
        </div>
      </div>
    </div>
  `;

  return {
    subject,
    senderName: 'Finanzas Stocka',
    senderEmail: 'finanzas@stocka.cl',
    innerCardHtml
  };
}

function openInvoiceEmailPreviewModal({
  mode = 'single',
  items = [],
  dataset = null,
  currentState = null,
  onSaveState = null
}) {
  injectLiorenStyles();
  const existing = document.getElementById('modal-lioren-email-preview');
  if (existing) existing.remove();

  if (!items || items.length === 0) return;

  let activeIdx = 0;
  const isSingle = mode === 'single' && items.length === 1;

  const getInitialSelectionForIdx = (idx) => {
    const it = items[idx];
    const resolved = resolveInvoiceEmailCandidates(it.comercioName, dataset, it.extraEmails || []);
    if (isSingle && currentState?.customized) {
      return {
        resolved,
        selectedSet: new Set(currentState.checkedEmails || []),
        extraToText: currentState.extraToText || '',
        ccText: currentState.ccText || '',
        customMessage: currentState.customMessage ?? 'Factura oficial electrónica emitida.'
      };
    }
    return {
      resolved,
      selectedSet: new Set(resolved.defaultRecipients),
      extraToText: '',
      ccText: '',
      customMessage: currentState?.customMessage ?? 'Factura oficial electrónica emitida.'
    };
  };

  let state = getInitialSelectionForIdx(0);

  const previewModal = document.createElement('div');
  previewModal.id = 'modal-lioren-email-preview';
  previewModal.className = 'modal-overlay active';
  previewModal.style.zIndex = '1220';

  previewModal.innerHTML = `
    <div class="modal-content" style="max-width: 1120px; width: 96vw; max-height: 93vh; display: flex; flex-direction: column; overflow: hidden; border-radius: 16px; padding: 0;">
      <div class="lioren-emit-header">
        <div class="lioren-emit-header-left">
          <div class="lioren-emit-icon-box" style="background: rgba(16, 185, 129, 0.14); border-color: rgba(16, 185, 129, 0.35); color: #059669;">
            <i class="ri-mail-check-fill"></i>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 1.04rem; font-weight: 800;">
              Vista Previa del Correo Automático al Cliente (Brevo)
            </h3>
            <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.12rem;">
              ${isSingle
                ? 'Revisa exactamente qué correo y a qué destinatarios se enviará apenas se emita la factura.'
                : `Inspecciona la plantilla y los destinatarios resueltos para cualquiera de las ${items.length} facturas en cola.`}
            </div>
          </div>
        </div>
        <button type="button" class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>

      ${!isSingle ? `
        <div style="padding: 0.65rem 1.4rem; background: var(--color-bg); border-bottom: 1px solid var(--color-border); display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
          <span style="font-size: 0.76rem; font-weight: 700; color: var(--color-text-muted);"><i class="ri-store-2-line"></i> Previsualizar comercio de la cola:</span>
          <select id="lioren-preview-batch-select" class="lioren-ctrl-select" style="max-width: 440px; height: 36px !important; font-weight: 600;">
            ${items.map((it, i) => `<option value="${i}">${escHtml(it.comercioName)} — ${it.serviceType === 'fulfillment' ? 'Fulfillment' : 'Envíame'} (${formatCLP(it.liveGrossAmount || 0)})</option>`).join('')}
          </select>
        </div>
      ` : ''}

      <div style="padding: 1.15rem 1.4rem; overflow-y: auto; flex: 1; background: var(--color-surface); display: flex; flex-direction: column;">
        <div class="lioren-email-preview-layout">
          <!-- Panel Izquierdo: Destinatarios y Nota -->
          <div style="display: flex; flex-direction: column; gap: 0.85rem;">
            <div class="lioren-section-box" style="margin: 0;">
              <div class="lioren-section-title">
                <span><i class="ri-user-received-2-line"></i> Destinatarios del Correo</span>
              </div>

              <div id="lioren-preview-candidates-list" style="display: flex; flex-direction: column; gap: 0.4rem; max-height: 195px; overflow-y: auto; margin-bottom: 0.65rem;"></div>

              ${isSingle ? `
                <div style="margin-bottom: 0.55rem;">
                  <label class="lioren-field-label" for="lioren-preview-extra-to"><span>Agregar correo adicional (Para +)</span></label>
                  <input type="text" id="lioren-preview-extra-to" class="lioren-ctrl-input" value="${escHtml(state.extraToText)}" placeholder="otro@cliente.cl, finanzas@..." style="height: 36px !important; font-size: 0.8rem;">
                </div>
                <div>
                  <label class="lioren-field-label" for="lioren-preview-cc"><span>Con Copia (CC opcional)</span></label>
                  <input type="text" id="lioren-preview-cc" class="lioren-ctrl-input" value="${escHtml(state.ccText)}" placeholder="copia@empresa.cl..." style="height: 36px !important; font-size: 0.8rem;">
                </div>
              ` : ''}
            </div>

            <div class="lioren-section-box" style="margin: 0;">
              <div class="lioren-section-title">
                <span><i class="ri-sticky-note-line"></i> Nota de Finanzas (Opcional)</span>
              </div>
              <textarea id="lioren-preview-custom-msg" ${isSingle ? '' : 'readonly'} class="form-input" rows="3" placeholder="Ej: Factura oficial electrónica emitida." style="width: 100%; font-size: 0.8rem; padding: 0.55rem 0.7rem; border-radius: 8px; resize: vertical; background: var(--color-surface);">${escHtml(state.customMessage)}</textarea>
              <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.35rem;">
                ${isSingle ? 'Si dejas este campo vacío, no se mostrará el recuadro gris "Nota de Finanzas" en el correo.' : 'En emisión masiva se incluye automáticamente esta glosa informativa.'}
              </div>
            </div>

            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 0.7rem 0.85rem; font-size: 0.74rem; color: var(--color-text-main); line-height: 1.45;">
              <strong style="color: #059669;"><i class="ri-information-fill"></i> Envío automático post-timbraje:</strong><br>
              El correo solo se enviará una vez que Lioren confirme el folio SII y almacene el PDF oficial en el WMS.
            </div>
          </div>

          <!-- Panel Derecho: Metadatos + Lienzo HTML Real -->
          <div style="border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; background: #ffffff;">
            <div id="lioren-preview-envelope-meta" style="padding: 0.75rem 1rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.78rem; color: #334155;"></div>
            <div id="lioren-preview-html-stage" style="padding: 0.9rem; background: #e2e8f0; overflow-y: auto; max-height: 58vh; flex: 1;"></div>
          </div>
        </div>

        <div class="lioren-emit-footer" style="justify-content: flex-end; margin-top: 0.95rem;">
          <button type="button" class="btn btn-outline" style="height: 38px; padding: 0 1.1rem; font-size: 0.84rem;" onclick="this.closest('.modal-overlay').remove()">
            ${isSingle ? 'Cancelar' : 'Cerrar Vista Previa'}
          </button>
          ${isSingle ? `
            <button type="button" class="btn btn-primary" id="btn-apply-lioren-email-preview" style="height: 38px; padding: 0 1.25rem; font-size: 0.85rem; background: linear-gradient(135deg, #059669, #10b981); border: none; font-weight: 700; display: inline-flex; align-items: center; gap: 0.4rem;">
              <i class="ri-check-double-line"></i> Aplicar Destinatarios y Volver
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(previewModal);

  const candidatesEl = document.getElementById('lioren-preview-candidates-list');
  const extraToEl = document.getElementById('lioren-preview-extra-to');
  const ccEl = document.getElementById('lioren-preview-cc');
  const customMsgEl = document.getElementById('lioren-preview-custom-msg');
  const metaEl = document.getElementById('lioren-preview-envelope-meta');
  const stageEl = document.getElementById('lioren-preview-html-stage');

  const computeEffectiveLists = () => {
    const toList = [...state.selectedSet];
    const extraRaw = extraToEl ? extraToEl.value : '';
    extraRaw
      .split(/[,;\s]+/)
      .map(s => s.trim().toLowerCase())
      .filter(s => s.includes('@') && s.includes('.'))
      .forEach(em => {
        if (!toList.includes(em)) toList.push(em);
      });

    const ccList = [];
    const ccRaw = ccEl ? ccEl.value : '';
    ccRaw
      .split(/[,;\s]+/)
      .map(s => s.trim().toLowerCase())
      .filter(s => s.includes('@') && s.includes('.') && !toList.includes(s))
      .forEach(em => {
        if (!ccList.includes(em)) ccList.push(em);
      });

    return { toList, ccList };
  };

  const renderCandidatesAndCanvas = () => {
    const it = items[activeIdx];
    const cands = state.resolved.candidates;

    if (cands.length === 0) {
      candidatesEl.innerHTML = `
        <div style="font-size: 0.76rem; color: #b45309; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); padding: 0.55rem 0.7rem; border-radius: 8px;">
          <i class="ri-alert-line"></i> No hay correos guardados aún para <strong>${escHtml(it.comercioName)}</strong>. ${isSingle ? 'Escribe un correo abajo en "Para +" o en Correo Receptor DTE.' : 'Agrega un contacto de facturación para notificarle.'}
        </div>
      `;
    } else {
      candidatesEl.innerHTML = cands.map(c => `
        <label style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.45rem 0.6rem; border-radius: 8px; border: 1px solid var(--color-border); background: var(--color-surface); cursor: ${isSingle ? 'pointer' : 'default'};">
          <div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0;">
            <input type="checkbox" class="lioren-preview-cand-cb" value="${escHtml(c.email)}" ${state.selectedSet.has(c.email) ? 'checked' : ''} ${isSingle ? '' : 'disabled'} style="width: 15px; height: 15px; accent-color: #10b981; flex-shrink: 0;">
            <div style="min-width: 0; font-size: 0.76rem; line-height: 1.25;">
              <div style="font-weight: 700; color: var(--color-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escHtml(c.email)}</div>
              <div style="font-size: 0.68rem; color: var(--color-text-muted);">${escHtml(c.label)}</div>
            </div>
          </div>
          <span style="font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.42rem; border-radius: 999px; background: rgba(16, 185, 129, 0.12); color: #059669; flex-shrink: 0;">
            ${escHtml(c.role)}
          </span>
        </label>
      `).join('');

      if (isSingle) {
        candidatesEl.querySelectorAll('.lioren-preview-cand-cb').forEach(cb => {
          cb.addEventListener('change', () => {
            if (cb.checked) state.selectedSet.add(cb.value);
            else state.selectedSet.delete(cb.value);
            renderEnvelopeAndHtml();
          });
        });
      }
    }

    renderEnvelopeAndHtml();
  };

  const renderEnvelopeAndHtml = () => {
    const it = items[activeIdx];
    const { toList, ccList } = computeEffectiveLists();
    const msgVal = customMsgEl ? customMsgEl.value : state.customMessage;

    const preview = buildInvoiceUploadedEmailPreview({
      record: it.record,
      comercioName: it.comercioName,
      periodName: it.periodName,
      serviceType: it.serviceType,
      liveGrossAmount: it.liveGrossAmount,
      liveDueDateIso: it.liveDueDateIso,
      customMessage: msgVal
    });

    metaEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; padding-bottom: 0.35rem; border-bottom: 1px dashed #cbd5e1;">
        <div><strong style="color: #0f172a;">De:</strong> ${escHtml(preview.senderName)} &lt;${escHtml(preview.senderEmail)}&gt;</div>
        <span style="font-size: 0.69rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;">
          Plantilla: Factura de Servicios Disponible
        </span>
      </div>
      <div style="margin-bottom: 0.25rem;">
        <strong style="color: #0f172a;">Para:</strong>
        ${toList.length > 0
          ? toList.map(em => `<span style="display: inline-block; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; border-radius: 999px; padding: 1px 8px; font-size: 0.72rem; font-weight: 600; margin: 1px 2px;">${escHtml(em)}</span>`).join('')
          : `<span style="color: #dc2626; font-weight: 700;">⚠️ Sin destinatarios seleccionados</span>`}
      </div>
      ${ccList.length > 0 ? `
        <div style="margin-bottom: 0.25rem;">
          <strong style="color: #0284c7;">CC:</strong>
          ${ccList.map(em => `<span style="display: inline-block; background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; border-radius: 999px; padding: 1px 8px; font-size: 0.71rem; font-weight: 600; margin: 1px 2px;">${escHtml(em)}</span>`).join('')}
        </div>
      ` : ''}
      <div style="font-weight: 700; color: #0f172a; margin-top: 0.2rem;">
        <span style="color: #64748b; font-weight: 600;">Asunto:</span> ${escHtml(preview.subject)}
      </div>
    `;

    stageEl.innerHTML = preview.innerCardHtml;
  };

  if (extraToEl) extraToEl.addEventListener('input', renderEnvelopeAndHtml);
  if (ccEl) ccEl.addEventListener('input', renderEnvelopeAndHtml);
  if (customMsgEl && isSingle) customMsgEl.addEventListener('input', renderEnvelopeAndHtml);

  const batchSelect = document.getElementById('lioren-preview-batch-select');
  if (batchSelect) {
    batchSelect.addEventListener('change', () => {
      activeIdx = parseInt(batchSelect.value, 10) || 0;
      state = getInitialSelectionForIdx(activeIdx);
      renderCandidatesAndCanvas();
    });
  }

  const applyBtn = document.getElementById('btn-apply-lioren-email-preview');
  if (applyBtn && isSingle) {
    applyBtn.addEventListener('click', () => {
      const { toList, ccList } = computeEffectiveLists();
      if (typeof onSaveState === 'function') {
        onSaveState({
          customized: true,
          checkedEmails: [...state.selectedSet],
          extraToText: extraToEl ? extraToEl.value.trim() : '',
          ccText: ccEl ? ccEl.value.trim() : '',
          effectiveToEmails: toList,
          effectiveCcEmails: ccList,
          customMessage: customMsgEl ? customMsgEl.value : 'Factura oficial electrónica emitida.'
        });
      }
      previewModal.remove();
    });
  }

  renderCandidatesAndCanvas();
}

async function sendBrevoInvoiceNotification(recordId, comercioName, serviceType, extraEmails = [], customOptions = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;

    const ds = window.__billingCommerceLegalDataset;
    let targetEmails = [];

    if (Array.isArray(customOptions.explicitToEmails) && customOptions.explicitToEmails.length > 0) {
      targetEmails = customOptions.explicitToEmails;
    } else {
      const resolved = resolveInvoiceEmailCandidates(comercioName, ds, extraEmails);
      // Si no tiene contactos de cobranza activos en billing_contacts, enviamos los correos de respaldo resueltos
      targetEmails = resolved.hasActiveContacts ? [] : resolved.defaultRecipients;
    }

    const ccEmails = Array.isArray(customOptions.ccEmails) ? customOptions.ccEmails : [];
    const customMessage = customOptions.customMessage !== undefined
      ? String(customOptions.customMessage)
      : 'Factura oficial electrónica emitida.';

    const res = await fetch(BREVO_EMAIL_EDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        recordId,
        commerceName: comercioName,
        comercio: comercioName,
        serviceType,
        emails: targetEmails,
        ccEmails,
        customMessage,
        emailType: 'invoice_uploaded'
      })
    });
    if (res.ok) {
      await supabase
        .from('billing_records')
        .update({ last_notified_at: new Date().toISOString() })
        .eq('id', recordId);
      return true;
    }
  } catch (e) {
    console.warn('Aviso enviando notificación Brevo:', e);
  }
  return false;
}

async function sendBrevoDesgloseNotification(recordId, comercioName, serviceType, extraEmails = [], customOptions = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;

    const ds = window.__billingCommerceLegalDataset;
    let targetEmails = [];

    if (Array.isArray(customOptions.explicitToEmails) && customOptions.explicitToEmails.length > 0) {
      targetEmails = customOptions.explicitToEmails;
    } else {
      const resolved = resolveInvoiceEmailCandidates(comercioName, ds, extraEmails);
      targetEmails = resolved.hasActiveContacts ? [] : resolved.defaultRecipients;
    }

    const ccEmails = Array.isArray(customOptions.ccEmails) ? customOptions.ccEmails : [];

    const res = await fetch(BREVO_EMAIL_EDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        recordId,
        commerceName: comercioName,
        comercio: comercioName,
        serviceType,
        emails: targetEmails,
        ccEmails,
        customMessage: '',
        emailType: 'billing_summary'
      })
    });
    if (res.ok) {
      await supabase
        .from('billing_records')
        .update({ last_notified_at: new Date().toISOString() })
        .eq('id', recordId);
      return true;
    }
  } catch (e) {
    console.warn('Aviso enviando correo de desglose Brevo:', e);
  }
  return false;
}

// Modal persistente post-publicación + facturación (permite enviar Desglose, Factura o Ambos sin cerrarse entre envíos)
window.openPostPublishAndInvoiceModal = function({
  recordId,
  periodId = '',
  periodName = '',
  comercioName = '',
  serviceType = 'fulfillment',
  dte = {},
  pdfUrl = '',
  xmlUrl = '',
  isSandbox = false,
  totalAbonos = 0,
  totalToPay = 0,
  fallbackEmail = '',
  desgloseAlreadySent = false,
  invoiceAlreadySent = false
}) {
  injectLiorenStyles();
  if (typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
    Swal.close();
  }

  const prevModal = document.getElementById('modal-post-publish-actions');
  if (prevModal) prevModal.remove();

  let desgloseSent = Boolean(desgloseAlreadySent);
  let invoiceSent = Boolean(invoiceAlreadySent);

  const modal = document.createElement('div');
  modal.id = 'modal-post-publish-actions';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '9500'; // Debajo de modal-send-billing-email (9999) para permanecer abierto tras enviar el primer correo

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 580px; width: 95vw; border-radius: 16px; padding: 0; overflow: hidden; box-shadow: 0 24px 60px -12px rgba(15, 23, 42, 0.3);">
      <div class="lioren-emit-header">
        <div class="lioren-emit-header-left">
          <div class="lioren-emit-icon-box" style="background: rgba(16, 185, 129, 0.14); border-color: rgba(16, 185, 129, 0.35); color: #059669;">
            <i class="ri-checkbox-circle-fill"></i>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800;">
              ¡Cobro Publicado y Factura Folio #${escHtml(String(dte.folio || ''))} Emitida!
            </h3>
            <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.12rem;">
              ${escHtml(comercioName)} · ${escHtml(periodName)}
            </div>
          </div>
        </div>
        <button type="button" class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>

      <div style="padding: 1.15rem 1.35rem; background: var(--color-surface); font-size: 0.85rem; line-height: 1.5;">
        ${isSandbox ? `
          <div style="background: rgba(245, 158, 11, 0.14); color: #b45309; padding: 0.45rem 0.7rem; border-radius: 8px; font-size: 0.76rem; font-weight: 700; margin-bottom: 0.75rem;">
            <i class="ri-flask-fill"></i> Factura emitida en Entorno de Pruebas Lioren
          </div>
        ` : ''}

        <!-- Resumen DTE + enlaces PDF/XML -->
        <div class="lioren-section-box" style="padding: 0.8rem 0.95rem; margin-bottom: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <div>
              <span style="color: var(--color-text-muted); font-size: 0.76rem;">Folio SII Asignado:</span>
              <strong style="font-size: 1.02rem; color: #5f06fa; margin-left: 0.25rem;">#${escHtml(String(dte.folio || ''))}</strong>
            </div>
            <div style="font-size: 0.8rem;">
              Neto <strong>${formatCLP(dte.montoneto || 0)}</strong> · IVA <strong>${formatCLP(dte.montoiva || 0)}</strong> · Total <strong style="color: #0f172a;">${formatCLP(dte.montototal || 0)}</strong>
            </div>
          </div>
          ${totalAbonos > 0 ? `
            <div style="font-size: 0.76rem; color: #4338ca; font-weight: 700; margin-top: 0.3rem;">
              Saldo Cliente tras Abonos: ${formatCLP(totalToPay)}
            </div>
          ` : ''}
          ${(pdfUrl || xmlUrl) ? `
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.65rem;">
              ${pdfUrl ? `<a href="${escHtml(pdfUrl)}" target="_blank" class="btn btn-primary btn-sm" style="flex: 1; justify-content: center; text-decoration: none; display: inline-flex; align-items: center; gap: 0.35rem; height: 34px; font-size: 0.78rem;"><i class="ri-file-pdf-fill"></i> Ver / Descargar PDF</a>` : ''}
              ${xmlUrl ? `<a href="${escHtml(xmlUrl)}" target="_blank" class="btn btn-outline btn-sm" style="flex: 1; justify-content: center; text-decoration: none; display: inline-flex; align-items: center; gap: 0.35rem; height: 34px; font-size: 0.78rem;"><i class="ri-code-s-slash-line"></i> Descargar XML SII</a>` : ''}
            </div>
          ` : ''}
        </div>

        <!-- Opciones de envío de correo al comercio -->
        <div class="lioren-section-box" style="padding: 0.9rem 1rem; margin-bottom: 0;">
          <div class="lioren-section-title" style="margin-bottom: 0.65rem;">
            <span><i class="ri-mail-send-line"></i> Notificaciones por Correo al Comercio</span>
          </div>
          <p style="font-size: 0.76rem; color: var(--color-text-muted); margin: 0 0 0.7rem 0;">
            Puedes previsualizar y enviar por separado el <strong>Correo de Desglose Confirmado</strong>, el <strong>Correo de Factura Emitida</strong>, o despachar ambos en un clic:
          </p>

          <div style="display: flex; flex-direction: column; gap: 0.55rem;">
            <!-- Opción 1: Correo de Desglose Confirmado -->
            <button type="button" id="btn-postpub-open-desglose-email" style="width: 100%; padding: 0.62rem 0.85rem; border-radius: 9px; border: 1.5px solid #8b5cf6; background: rgba(95, 6, 250, 0.06); color: #5b21b6; font-size: 0.81rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; text-align: left; transition: all 0.15s ease;">
              <span style="display: inline-flex; align-items: center; gap: 0.45rem;">
                <i class="ri-bar-chart-box-line" style="font-size: 1rem;"></i>
                <span>1. Previsualizar y Enviar Correo de Desglose Confirmado</span>
              </span>
              <span id="badge-postpub-desglose-status" style="font-size: 0.69rem; padding: 2px 8px; border-radius: 999px; background: ${desgloseSent ? '#dcfce7' : '#ede9fe'}; color: ${desgloseSent ? '#166534' : '#5b21b6'};">
                ${desgloseSent ? '✓ Enviado' : 'Abrir visor'}
              </span>
            </button>

            <!-- Opción 2: Correo de Factura Emitida -->
            <button type="button" id="btn-postpub-open-invoice-email" style="width: 100%; padding: 0.62rem 0.85rem; border-radius: 9px; border: 1.5px solid #10b981; background: rgba(16, 185, 129, 0.07); color: #047857; font-size: 0.81rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; text-align: left; transition: all 0.15s ease;">
              <span style="display: inline-flex; align-items: center; gap: 0.45rem;">
                <i class="ri-file-text-line" style="font-size: 1rem;"></i>
                <span>2. Previsualizar y Enviar Correo de Factura Emitida</span>
              </span>
              <span id="badge-postpub-invoice-status" style="font-size: 0.69rem; padding: 2px 8px; border-radius: 999px; background: ${invoiceSent ? '#dcfce7' : '#d1fae5'}; color: #065f46;">
                ${invoiceSent ? '✓ Enviado' : 'Abrir visor'}
              </span>
            </button>

            <!-- Opción 3: Enviar Ambos en 1 Clic -->
            <button type="button" id="btn-postpub-send-both-auto" style="width: 100%; margin-top: 0.15rem; padding: 0.62rem 0.9rem; border-radius: 9px; border: none; background: linear-gradient(135deg, #4f46e5, #059669); color: #ffffff; font-size: 0.82rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; box-shadow: 0 3px 10px rgba(79, 70, 229, 0.24);">
              <i class="ri-send-plane-2-fill"></i> Enviar Ambos Correos Automáticamente (Desglose + Factura)
            </button>
          </div>
        </div>

        <div class="lioren-emit-footer" style="justify-content: flex-end; margin-top: 0.9rem; padding-top: 0.8rem;">
          <button type="button" class="btn btn-primary" style="height: 38px; padding: 0 1.25rem; font-size: 0.84rem; background: #5f06fa; border: none;" onclick="this.closest('.modal-overlay').remove()">
            Finalizar y Cerrar
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const btnDesglose = document.getElementById('btn-postpub-open-desglose-email');
  const btnInvoice = document.getElementById('btn-postpub-open-invoice-email');
  const btnBoth = document.getElementById('btn-postpub-send-both-auto');
  const badgeDesglose = document.getElementById('badge-postpub-desglose-status');
  const badgeInvoice = document.getElementById('badge-postpub-invoice-status');

  if (btnDesglose) {
    btnDesglose.addEventListener('click', () => {
      if (typeof window.openSendBillingEmailModal === 'function') {
        window.openSendBillingEmailModal(recordId, comercioName, periodId, {
          defaultEmailType: 'billing_summary',
          defaultServiceType: serviceType,
          fallbackEmail
        });
        if (badgeDesglose && !desgloseSent) {
          badgeDesglose.textContent = 'Visor abierto';
        }
      }
    });
  }

  if (btnInvoice) {
    btnInvoice.addEventListener('click', () => {
      if (typeof window.openSendBillingEmailModal === 'function') {
        window.openSendBillingEmailModal(recordId, comercioName, periodId, {
          defaultEmailType: 'invoice_uploaded',
          defaultServiceType: serviceType,
          fallbackEmail
        });
        if (badgeInvoice && !invoiceSent) {
          badgeInvoice.textContent = 'Visor abierto';
        }
      }
    });
  }

  if (btnBoth) {
    btnBoth.addEventListener('click', async () => {
      btnBoth.disabled = true;
      btnBoth.innerHTML = '<i class="ri-loader-4-line spin"></i> Enviando correo de Desglose y correo de Factura...';

      const okDesglose = desgloseSent
        ? true
        : await sendBrevoDesgloseNotification(recordId, comercioName, serviceType, fallbackEmail ? [fallbackEmail] : []);
      const okInvoice = invoiceSent
        ? true
        : await sendBrevoInvoiceNotification(recordId, comercioName, serviceType, fallbackEmail ? [fallbackEmail] : []);

      if (okDesglose) {
        desgloseSent = true;
        if (badgeDesglose) {
          badgeDesglose.textContent = '✓ Enviado';
          badgeDesglose.style.background = '#dcfce7';
          badgeDesglose.style.color = '#166534';
        }
      }
      if (okInvoice) {
        invoiceSent = true;
        if (badgeInvoice) {
          badgeInvoice.textContent = '✓ Enviado';
          badgeInvoice.style.background = '#dcfce7';
          badgeInvoice.style.color = '#166534';
        }
      }

      if (okDesglose && okInvoice) {
        btnBoth.style.background = '#059669';
        btnBoth.innerHTML = '<i class="ri-checkbox-circle-fill"></i> ¡Ambos correos enviados con éxito!';
      } else {
        btnBoth.disabled = false;
        btnBoth.innerHTML = '<i class="ri-error-warning-line"></i> Reintentar o abrir visor individual arriba';
      }
    });
  }
};

// ============================================================================
// EMISIÓN RÁPIDA EN 1 SOLO CLICK (SIN ABRIR MODAL SI LA FICHA SII ESTÁ LISTA)
// ============================================================================
window.quickEmitLiorenInvoice = async function(recordId, serviceType, btnEl = null, options = {}) {
  injectLiorenStyles();
  const normalizedService = serviceType === 'enviame' ? 'enviame' : 'fulfillment';
  const prevHtml = btnEl ? btnEl.innerHTML : '';

  if (btnEl) {
    if (btnEl.disabled) return;
    btnEl.disabled = true;
    btnEl.innerHTML = `<i class="ri-loader-4-line spin"></i>`;
  }

  try {
    const [recRes, dataset] = await Promise.all([
      supabase
        .from('billing_records')
        .select('*, billing_periods(name)')
        .eq('id', recordId)
        .single(),
      typeof window.fetchBillingCommerceLegalDataset === 'function'
        ? window.fetchBillingCommerceLegalDataset()
        : Promise.resolve(null)
    ]);

    const record = recRes.data;
    if (recRes.error || !record) {
      throw new Error(recRes.error?.message || 'No se encontró el registro de facturación.');
    }

    const existingFolio = normalizedService === 'fulfillment' ? record.num_factura : record.num_factura_enviame;
    if (existingFolio) {
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'info',
          title: `${record.comercio} ya tiene asignado el Folio #${existingFolio}`,
          showConfirmButton: false,
          timer: 3500
        });
      }
      await refreshViewsAfterInvoiceAction(record.period_id, recordId, normalizedService);
      return;
    }

    const rawGross = Math.round(
      Number(normalizedService === 'fulfillment' ? (record.total_fulfillment || 0) : (record.enviame || 0))
    );
    const montoNeto = rawGross > 0 ? Math.round(rawGross / 1.19) : 0;
    if (montoNeto <= 0) {
      if (typeof Swal !== 'undefined') {
        Swal.fire('Monto en $0', `El servicio ${normalizedService === 'fulfillment' ? 'Fulfillment' : 'Envíame'} de ${record.comercio} tiene monto $0 y no puede facturarse.`, 'warning');
      }
      return;
    }

    let sii = evaluateCommerceSiiReadiness(record.comercio, dataset);
    if (!sii.ready && sii.rutValid) {
      sii = await tryHydrateReceptorFromLioren(sii);
    }

    // Si aún falta algún dato SII obligatorio, abrimos el modal de emisión para completarlo por única vez
    if (!sii.ready) {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = prevHtml;
      }
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'warning',
          title: `Completa por única vez (${sii.missing.join(', ')}) para activar 1-Click en ${record.comercio}`,
          showConfirmButton: false,
          timer: 4200
        });
      }
      return window.openLiorenEmitModal(recordId, normalizedService);
    }

    const todayIso = new Date().toLocaleDateString('sv-SE');
    const existingDueDate = normalizedService === 'fulfillment'
      ? (record.fecha_limite || '')
      : (record.fecha_limite_enviame || '');
    const vencimiento = (existingDueDate && existingDueDate >= todayIso)
      ? existingDueDate
      : computeBusinessDays(todayIso, 5);

    const periodRaw = record.billing_periods?.name || '';
    const formattedPeriod = periodRaw.replace(/[\s-]+/g, '-').toUpperCase();
    const glosa = `${normalizedService === 'fulfillment' ? 'SERV. FULFILLMENT' : 'SERV. ENVIAME'} ${formattedPeriod}`.trim();
    const actividad = normalizedService === 'fulfillment' ? '521009' : '522190';
    const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `quick-${recordId}-${normalizedService}-${Date.now()}`;

    const emitResult = await callLiorenApi({
      action: 'emit_dte',
      recordId,
      comercio: record.comercio,
      serviceType: normalizedService,
      tipodoc: '33',
      actividad,
      fecha: todayIso,
      vencimiento,
      glosa,
      montoNeto,
      receptor: {
        rut: sii.rutFormatted,
        rs: sii.rs,
        giro: sii.giro,
        direccion: sii.direccion,
        comuna: sii.comunaId,
        ciudad: sii.ciudadId,
        comunaNombre: sii.comunaNombre,
        ciudadNombre: sii.ciudadNombre,
        email: sii.email
      },
      saveCommerceLegalInfo: true,
      idempotencyKey
    });

    cachedLiorenStatusTs = 0;

    // Decidir si enviar correo automático por Brevo (en Sandbox nunca por defecto; en Producción respeta el switch de la barra)
    const autoEmailPref = options.sendEmail !== undefined
      ? Boolean(options.sendEmail)
      : (window._pendingTasksState ? window._pendingTasksState.autoEmailOneClick !== false : true);

    if (!emitResult.isSandbox && autoEmailPref) {
      await sendBrevoInvoiceNotification(recordId, record.comercio, normalizedService);
    }

    const dte = emitResult.dte || {};
    const safeQuickCommJs = String(record.comercio || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeQuickEmailJs = String(sii.email || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `⚡ Folio #${dte.folio} emitido — ${record.comercio}`,
        html: `
          <div style="font-size: 0.78rem; margin-top: 0.25rem; display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <span>Total SII: <strong>${formatCLP(dte.montototal)}</strong></span>
            ${emitResult.pdfUrl ? `<a href="${emitResult.pdfUrl}" target="_blank" style="color: #6d28d9; font-weight: 700; text-decoration: underline;">Ver PDF</a>` : ''}
            <button type="button" onclick="window.openInvoiceEmailComposer('${recordId}', '${safeQuickCommJs}', '${record.period_id || ''}', '${normalizedService}', '${safeQuickEmailJs}')" style="background: #10b981; color: #ffffff; border: none; border-radius: 5px; padding: 0.14rem 0.48rem; font-size: 0.72rem; font-weight: 700; cursor: pointer;">
              <i class="ri-mail-send-line"></i> Enviar Correo
            </button>
          </div>
        `,
        showConfirmButton: false,
        timer: 6500,
        timerProgressBar: true
      });
    }

    await refreshViewsAfterInvoiceAction(record.period_id, recordId, normalizedService);
  } catch (err) {
    console.error('Error en emisión rápida 1-Click Lioren:', err);
    if (typeof Swal !== 'undefined') {
      Swal.fire('No se pudo emitir la factura', err.message || String(err), 'error');
    } else {
      alert('Error al emitir factura: ' + (err.message || err));
    }
  } finally {
    if (btnEl && document.body.contains(btnEl)) {
      btnEl.disabled = false;
      btnEl.innerHTML = prevHtml;
    }
  }
};

// ============================================================================
// EMISIÓN MASIVA DE FACTURAS ELECTRÓNICAS EN LOTE (COLA CON PROGRESO EN VIVO)
// ============================================================================
window.openBulkLiorenEmitModal = async function(rawItems = []) {
  injectLiorenStyles();

  // Deduplicar pares (recordId, serviceType)
  const seen = new Set();
  const uniquePairs = [];
  for (const it of rawItems || []) {
    if (!it?.recordId) continue;
    const svc = it.serviceType === 'enviame' || it.serviceType === 'env' ? 'enviame' : 'fulfillment';
    const key = `${it.recordId}:${svc}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePairs.push({ key, recordId: String(it.recordId), serviceType: svc });
    }
  }

  if (uniquePairs.length === 0) {
    if (typeof Swal !== 'undefined') {
      Swal.fire('Sin selección', 'Selecciona al menos un registro o desglose para emitir facturas masivamente.', 'info');
    }
    return;
  }

  let existingModal = document.getElementById('modal-lioren-bulk-emit');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-lioren-bulk-emit';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '1140';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 780px; width: 96%; max-height: 92vh; display: flex; flex-direction: column;">
      <div class="modal-header" style="padding: 1rem 1.25rem;">
        <h3 style="margin: 0; font-size: 1.08rem; display: flex; align-items: center; gap: 0.5rem;">
          <i class="ri-flashlight-fill" style="color: #7c3aed;"></i>
          <span>Emisión Masiva de Facturas Electrónicas — Lioren SII</span>
        </h3>
        <button type="button" class="modal-close" id="btn-close-bulk-lioren" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body" id="lioren-bulk-modal-body" style="padding: 1.25rem; overflow-y: auto; flex: 1;">
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--color-text-muted);">
          <i class="ri-loader-4-line spin" style="font-size: 2rem; color: #7c3aed; display: block; margin-bottom: 0.6rem;"></i>
          Validando fichas tributarias SII, montos y disponibilidad de folios CAF para <strong>${uniquePairs.length}</strong> documentos...
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const bodyEl = document.getElementById('lioren-bulk-modal-body');

  try {
    const recordIds = [...new Set(uniquePairs.map(p => p.recordId))];
    const [recsRes, dataset, liorenSt] = await Promise.all([
      supabase
        .from('billing_records')
        .select('*, billing_periods(name)')
        .in('id', recordIds),
      typeof window.fetchBillingCommerceLegalDataset === 'function'
        ? window.fetchBillingCommerceLegalDataset(true)
        : Promise.resolve(null),
      getLiorenStatus(true).catch(() => null)
    ]);

    if (recsRes.error) throw recsRes.error;
    const recMap = new Map((recsRes.data || []).map(r => [String(r.id), r]));

    const readyItems = [];
    const alreadyEmittedItems = [];
    const skippedItems = [];

    // Cachear búsquedas por RUT para no repetir llamadas en comercios con ambos servicios seleccionados
    const hydratedCache = new Map();

    for (const pair of uniquePairs) {
      const rec = recMap.get(pair.recordId);
      if (!rec) continue;

      const isFulf = pair.serviceType === 'fulfillment';
      const existingFolio = isFulf ? rec.num_factura : rec.num_factura_enviame;
      const rawGross = Math.round(Number(isFulf ? (rec.total_fulfillment || 0) : (rec.enviame || 0)));
      const montoNeto = rawGross > 0 ? Math.round(rawGross / 1.19) : 0;
      const montoIva = Math.round(montoNeto * 0.19);
      const montoTotalSii = montoNeto + montoIva;
      const periodName = rec.billing_periods?.name || '';
      const formattedPeriod = periodName.replace(/[\s-]+/g, '-').toUpperCase();
      const glosa = `${isFulf ? 'SERV. FULFILLMENT' : 'SERV. ENVIAME'} ${formattedPeriod}`.trim();

      if (existingFolio) {
        alreadyEmittedItems.push({
          ...pair,
          comercio: rec.comercio,
          periodName,
          folio: existingFolio,
          rawGross
        });
        continue;
      }

      if (montoNeto <= 0) {
        skippedItems.push({
          ...pair,
          comercio: rec.comercio,
          periodId: rec.period_id || '',
          periodName,
          rawGross,
          reason: 'Monto $0 (sin cobro facturable)'
        });
        continue;
      }

      let sii = hydratedCache.get(rec.comercio);
      if (!sii) {
        sii = evaluateCommerceSiiReadiness(rec.comercio, dataset);
        if (!sii.ready && sii.rutValid) {
          sii = await tryHydrateReceptorFromLioren(sii);
        }
        hydratedCache.set(rec.comercio, sii);
      }

      if (!sii.ready) {
        skippedItems.push({
          ...pair,
          comercio: rec.comercio,
          periodId: rec.period_id || '',
          periodName,
          rawGross,
          reason: `Falta: ${sii.missing.join(', ')}`
        });
        continue;
      }

      readyItems.push({
        ...pair,
        record: rec,
        comercio: rec.comercio,
        periodId: rec.period_id || '',
        periodName,
        glosa,
        actividad: isFulf ? '521009' : '522190',
        existingDueDate: isFulf ? (rec.fecha_limite || '') : (rec.fecha_limite_enviame || ''),
        montoNeto,
        montoIva,
        montoTotalSii,
        sii,
        idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `bulk-${pair.recordId}-${pair.serviceType}-${Date.now()}`
      });
    }

    const f33 = liorenSt?.folios?.['33'];
    const isSandbox = Boolean(liorenSt?.isSandbox);
    const totalBrutoReady = readyItems.reduce((acc, i) => acc + i.montoTotalSii, 0);
    const totalNetoReady = readyItems.reduce((acc, i) => acc + i.montoNeto, 0);
    const notEnoughFolios = f33 && readyItems.length > f33.disponibles;

    bodyEl.innerHTML = `
      ${liorenSt ? `
        <div class="lioren-env-banner ${isSandbox ? 'sandbox' : 'production'}">
          <span>
            <i class="${isSandbox ? 'ri-flask-fill' : 'ri-shield-check-fill'}"></i>
            ${isSandbox ? `ENTORNO DE PRUEBAS (${escHtml(liorenSt.miempresa?.rs || '')})` : `PRODUCCIÓN OFICIAL SII (${escHtml(liorenSt.miempresa?.rs || 'STOCKA SPA')})`}
          </span>
          <span>
            Folios DTE 33 disp.: <strong style="color: ${notEnoughFolios ? '#dc2626' : 'inherit'};">${f33 ? f33.disponibles : '—'}</strong>
            ${f33?.siguiente ? ` · Próximo: <strong>#${f33.siguiente}</strong>` : ''}
          </span>
        </div>
      ` : ''}

      <div class="lioren-bulk-kpi-grid">
        <div class="lioren-bulk-kpi" style="border-color: rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.06);">
          <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #059669;">Listas para Emitir</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: var(--color-text-main); margin-top: 0.15rem;" id="bulk-ready-count-label">${readyItems.length} factura${readyItems.length === 1 ? '' : 's'}</div>
          <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.1rem;" id="bulk-ready-sum-label">Total: <strong>${formatCLP(totalBrutoReady)}</strong> (Neto: ${formatCLP(totalNetoReady)})</div>
        </div>
        <div class="lioren-bulk-kpi">
          <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted);">Ya Emitidas (Se Omiten)</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: var(--color-text-main); margin-top: 0.15rem;">${alreadyEmittedItems.length}</div>
          <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.1rem;">Evita duplicidad de folios</div>
        </div>
        <div class="lioren-bulk-kpi" style="${skippedItems.length > 0 ? 'border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.06);' : ''}">
          <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: ${skippedItems.length > 0 ? '#d97706' : 'var(--color-text-muted)'};">Incompletas / Monto $0</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: var(--color-text-main); margin-top: 0.15rem;">${skippedItems.length}</div>
          <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.1rem;">Requieren completar ficha SII</div>
        </div>
      </div>

      ${notEnoughFolios ? `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); color: #dc2626; padding: 0.65rem 0.85rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 0.85rem;">
          <i class="ri-error-warning-fill"></i> <strong>Atención con tus folios CAF:</strong> tienes <strong>${f33.disponibles}</strong> folios DTE 33 disponibles en Lioren y hay <strong>${readyItems.length}</strong> documentos listos. Desmarca algunos o solicita más CAF en Lioren antes de emitir el total.
        </div>
      ` : ''}

      ${readyItems.length > 0 ? `
        <div class="lioren-section-box" style="padding: 0.7rem 0.85rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
            <div style="display: inline-flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
              <label style="display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.79rem; font-weight: 600; cursor: pointer;">
                <input type="checkbox" id="bulk-lioren-notify-brevo" ${isSandbox ? '' : 'checked'} style="width: 16px; height: 16px; accent-color: #10b981;">
                <span>Enviar correo Brevo con PDF timbrado a cada cliente tras emitir</span>
              </label>
              <button type="button" id="btn-preview-bulk-email" class="btn-lioren-preview-email" style="height: 27px; font-size: 0.71rem; padding: 0 0.58rem;">
                <i class="ri-eye-line"></i> Previsualizar correo
              </button>
            </div>
            <div style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.76rem;">
              <span style="color: var(--color-text-muted); font-weight: 600;">Plazo si no tiene vencimiento vigente:</span>
              <select id="bulk-lioren-due-mode" class="lioren-ctrl-select" style="height: 34px !important; padding: 0 1.8rem 0 0.65rem !important; font-size: 0.78rem; width: auto; margin: 0;">
                <option value="5" selected>+5 días hábiles</option>
                <option value="3">+3 días hábiles</option>
                <option value="10">+10 días hábiles</option>
                <option value="eom">Fin de mes</option>
              </select>
            </div>
          </div>
        </div>

        <div id="bulk-lioren-progress-panel" style="display: none;" class="lioren-section-box">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; font-weight: 700;">
            <span id="bulk-lioren-progress-text"><i class="ri-loader-4-line spin"></i> Iniciando cola de emisión SII...</span>
            <span id="bulk-lioren-progress-pct">0%</span>
          </div>
          <div class="lioren-progress-track">
            <div class="lioren-progress-fill" id="bulk-lioren-progress-bar"></div>
          </div>
        </div>

        <div style="border: 1px solid var(--color-border); border-radius: 10px; overflow: hidden; margin-bottom: 0.85rem;">
          <div style="max-height: 290px; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
              <thead style="position: sticky; top: 0; background: var(--color-bg); z-index: 2; border-bottom: 1px solid var(--color-border);">
                <tr style="text-align: left; color: var(--color-text-muted); font-size: 0.7rem; text-transform: uppercase;">
                  <th style="padding: 0.5rem 0.6rem; width: 34px; text-align: center;">
                    <input type="checkbox" id="bulk-lioren-check-all" checked style="accent-color: #6d28d9; cursor: pointer;">
                  </th>
                  <th style="padding: 0.5rem 0.6rem;">Comercio / Receptor</th>
                  <th style="padding: 0.5rem 0.6rem;">Glosa Única (SII)</th>
                  <th style="padding: 0.5rem 0.6rem; text-align: right;">Total SII</th>
                  <th style="padding: 0.5rem 0.6rem; text-align: center;">Estado Cola</th>
                </tr>
              </thead>
              <tbody>
                ${readyItems.map((item, idx) => `
                  <tr style="border-bottom: 1px solid var(--color-border);" data-bulk-idx="${idx}">
                    <td style="padding: 0.5rem 0.6rem; text-align: center;">
                      <input type="checkbox" class="bulk-lioren-item-cb" data-idx="${idx}" checked style="accent-color: #6d28d9; cursor: pointer;">
                    </td>
                    <td style="padding: 0.5rem 0.6rem;">
                      <div style="font-weight: 700; color: var(--color-text-main);">${escHtml(item.comercio)}</div>
                      <div style="font-size: 0.7rem; color: var(--color-text-muted);">${escHtml(item.sii.rutFormatted)} · ${escHtml(item.sii.rs.slice(0, 34))}</div>
                    </td>
                    <td style="padding: 0.5rem 0.6rem;">
                      <span class="client-badge ${item.serviceType === 'fulfillment' ? 'status-purple' : 'status-teal'}" style="font-size: 0.66rem; padding: 0.1rem 0.4rem;">
                        ${item.serviceType === 'fulfillment' ? 'Fulfillment' : 'Envíame'}
                      </span>
                      <div style="font-size: 0.72rem; font-weight: 600; margin-top: 0.15rem;">${escHtml(item.glosa)}</div>
                    </td>
                    <td style="padding: 0.5rem 0.6rem; text-align: right; font-weight: 700;">
                      ${formatCLP(item.montoTotalSii)}
                      <div style="font-size: 0.68rem; font-weight: 400; color: var(--color-text-muted);">Neto ${formatCLP(item.montoNeto)}</div>
                    </td>
                    <td style="padding: 0.5rem 0.6rem; text-align: center;" id="bulk-row-status-${idx}">
                      <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">En cola</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : `
        <div style="padding: 1.5rem; text-align: center; background: var(--color-bg); border-radius: 10px; border: 1px dashed var(--color-border); margin-bottom: 0.85rem; color: var(--color-text-muted); font-size: 0.85rem;">
          Ninguno de los registros seleccionados está pendiente y con ficha SII completa para emitir en este momento.
        </div>
      `}

      ${skippedItems.length > 0 ? `
        <details style="margin-bottom: 0.85rem; border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 0.55rem 0.8rem; background: rgba(245, 158, 11, 0.05); font-size: 0.77rem;">
          <summary style="cursor: pointer; font-weight: 700; color: #b45309;">
            <i class="ri-alert-line"></i> Ver ${skippedItems.length} registro(s) omitido(s) por datos SII faltantes o monto $0
          </summary>
          <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; max-height: 140px; overflow-y: auto;">
            ${skippedItems.map(sk => {
              const safeCommJs = String(sk.comercio || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              return `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.25rem 0; border-bottom: 1px dashed rgba(245, 158, 11, 0.2);">
                  <span><strong>${escHtml(sk.comercio)}</strong> (${escHtml(sk.periodName)} · ${sk.serviceType === 'fulfillment' ? 'Fulfillment' : 'Envíame'}) — <span style="color: #dc2626;">${escHtml(sk.reason)}</span></span>
                  <button type="button" class="btn btn-outline btn-sm" style="font-size: 0.68rem; padding: 0.12rem 0.45rem;" onclick="window.openQuickEditCommerceLegalModal('${safeCommJs}', '${sk.periodId}', '${sk.recordId}')">
                    <i class="ri-edit-2-line"></i> Completar Ficha
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </details>
      ` : ''}

      <div style="display: flex; justify-content: flex-end; gap: 0.55rem; border-top: 1px solid var(--color-border); padding-top: 0.85rem;">
        <button type="button" class="btn btn-outline" id="btn-cancel-bulk-lioren" onclick="this.closest('.modal-overlay').remove()">Cerrar</button>
        ${readyItems.length > 0 ? `
          <button type="button" class="btn btn-primary" id="btn-start-bulk-lioren" style="background: linear-gradient(135deg, #6d28d9, #4f46e5); border: none; font-weight: 700; display: inline-flex; align-items: center; gap: 0.4rem;">
            <i class="ri-flashlight-fill"></i> Emitir ${readyItems.length} Factura${readyItems.length === 1 ? '' : 's'} Ahora
          </button>
        ` : ''}
      </div>
    `;

    if (readyItems.length === 0) return;

    const checkAllCb = document.getElementById('bulk-lioren-check-all');
    const itemCbs = Array.from(modal.querySelectorAll('.bulk-lioren-item-cb'));
    const startBtn = document.getElementById('btn-start-bulk-lioren');
    const cancelBtn = document.getElementById('btn-cancel-bulk-lioren');
    const closeTopBtn = document.getElementById('btn-close-bulk-lioren');
    const countLbl = document.getElementById('bulk-ready-count-label');
    const sumLbl = document.getElementById('bulk-ready-sum-label');
    const previewBulkEmailBtn = document.getElementById('btn-preview-bulk-email');

    if (previewBulkEmailBtn) {
      previewBulkEmailBtn.addEventListener('click', () => {
        const dueMode = document.getElementById('bulk-lioren-due-mode')?.value || '5';
        const todayIsoNow = new Date().toLocaleDateString('sv-SE');
        const activeIdxs = itemCbs.filter(cb => cb.checked).map(cb => Number(cb.dataset.idx));
        const sourceItems = (activeIdxs.length > 0 ? activeIdxs.map(i => readyItems[i]) : readyItems).map(it => {
          let previewDue = (it.existingDueDate && it.existingDueDate >= todayIsoNow) ? it.existingDueDate : '';
          if (!previewDue) {
            if (dueMode === 'eom') {
              const d = new Date(todayIsoNow + 'T00:00:00');
              previewDue = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('sv-SE');
            } else {
              previewDue = computeBusinessDays(todayIsoNow, parseInt(dueMode, 10) || 5);
            }
          }
          return {
            record: it.record,
            comercioName: it.comercio,
            periodName: it.periodName,
            serviceType: it.serviceType,
            liveGrossAmount: it.montoTotalSii,
            liveDueDateIso: previewDue,
            extraEmails: it.sii?.email ? [it.sii.email] : []
          };
        });
        openInvoiceEmailPreviewModal({
          mode: 'bulk',
          items: sourceItems,
          dataset
        });
      });
    }

    const syncBulkSelectionSummary = () => {
      const activeIndices = itemCbs.filter(cb => cb.checked).map(cb => Number(cb.dataset.idx));
      const brSum = activeIndices.reduce((acc, idx) => acc + readyItems[idx].montoTotalSii, 0);
      const ntSum = activeIndices.reduce((acc, idx) => acc + readyItems[idx].montoNeto, 0);
      countLbl.textContent = `${activeIndices.length} factura${activeIndices.length === 1 ? '' : 's'}`;
      sumLbl.innerHTML = `Total: <strong>${formatCLP(brSum)}</strong> (Neto: ${formatCLP(ntSum)})`;
      startBtn.disabled = activeIndices.length === 0;
      startBtn.innerHTML = `<i class="ri-flashlight-fill"></i> Emitir ${activeIndices.length} Factura${activeIndices.length === 1 ? '' : 's'} Ahora`;
      if (checkAllCb) checkAllCb.checked = activeIndices.length === itemCbs.length && itemCbs.length > 0;
    };

    if (checkAllCb) {
      checkAllCb.addEventListener('change', () => {
        itemCbs.forEach(cb => { if (!cb.disabled) cb.checked = checkAllCb.checked; });
        syncBulkSelectionSummary();
      });
    }
    itemCbs.forEach(cb => cb.addEventListener('change', syncBulkSelectionSummary));

    let stopRequested = false;
    let isRunning = false;

    startBtn.addEventListener('click', async () => {
      if (isRunning) {
        stopRequested = true;
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="ri-stop-circle-line"></i> Deteniendo tras actual...';
        return;
      }

      const selectedIndices = itemCbs.filter(cb => cb.checked).map(cb => Number(cb.dataset.idx));
      if (selectedIndices.length === 0) return;

      isRunning = true;
      stopRequested = false;
      const sendEmail = Boolean(document.getElementById('bulk-lioren-notify-brevo')?.checked);
      const dueMode = document.getElementById('bulk-lioren-due-mode')?.value || '5';
      const todayIso = new Date().toLocaleDateString('sv-SE');

      itemCbs.forEach(cb => { cb.disabled = true; });
      if (checkAllCb) checkAllCb.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      if (closeTopBtn) closeTopBtn.disabled = true;

      startBtn.style.background = '#dc2626';
      startBtn.innerHTML = '<i class="ri-stop-circle-line"></i> Detener Cola';

      const progPanel = document.getElementById('bulk-lioren-progress-panel');
      const progText = document.getElementById('bulk-lioren-progress-text');
      const progPct = document.getElementById('bulk-lioren-progress-pct');
      const progBar = document.getElementById('bulk-lioren-progress-bar');
      progPanel.style.display = 'block';

      let okCount = 0;
      let errCount = 0;
      const touchedPeriods = new Set();

      for (let step = 0; step < selectedIndices.length; step++) {
        if (stopRequested) break;
        const idx = selectedIndices[step];
        const item = readyItems[idx];
        const statusCell = document.getElementById(`bulk-row-status-${idx}`);

        const pctBefore = Math.round((step / selectedIndices.length) * 100);
        progPct.textContent = `${pctBefore}%`;
        progBar.style.width = `${pctBefore}%`;
        progText.innerHTML = `<i class="ri-loader-4-line spin"></i> Emitiendo ${step + 1} de ${selectedIndices.length}: <strong>${escHtml(item.comercio)}</strong>...`;

        if (statusCell) {
          statusCell.innerHTML = `<span style="color: #6d28d9; font-weight: 700;"><i class="ri-loader-4-line spin"></i> Emitiendo...</span>`;
        }

        let vencimiento = (item.existingDueDate && item.existingDueDate >= todayIso) ? item.existingDueDate : '';
        if (!vencimiento) {
          if (dueMode === 'eom') {
            const nowD = new Date(todayIso + 'T00:00:00');
            vencimiento = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).toLocaleDateString('sv-SE');
          } else {
            vencimiento = computeBusinessDays(todayIso, parseInt(dueMode, 10) || 5);
          }
        }

        try {
          const res = await callLiorenApi({
            action: 'emit_dte',
            recordId: item.recordId,
            comercio: item.comercio,
            serviceType: item.serviceType,
            tipodoc: '33',
            actividad: item.actividad,
            fecha: todayIso,
            vencimiento,
            glosa: item.glosa,
            montoNeto: item.montoNeto,
            receptor: {
              rut: item.sii.rutFormatted,
              rs: item.sii.rs,
              giro: item.sii.giro,
              direccion: item.sii.direccion,
              comuna: item.sii.comunaId,
              ciudad: item.sii.ciudadId,
              comunaNombre: item.sii.comunaNombre,
              ciudadNombre: item.sii.ciudadNombre,
              email: item.sii.email
            },
            saveCommerceLegalInfo: true,
            idempotencyKey: item.idempotencyKey
          });

          if (sendEmail && !res.isSandbox) {
            await sendBrevoInvoiceNotification(item.recordId, item.comercio, item.serviceType);
          }

          okCount++;
          if (item.periodId) touchedPeriods.add(item.periodId);

          if (statusCell) {
            statusCell.innerHTML = `
              <span style="color: #059669; font-weight: 800;">
                <i class="ri-checkbox-circle-fill"></i> #${res.dte?.folio}
              </span>
              ${res.pdfUrl ? `<a href="${res.pdfUrl}" target="_blank" style="margin-left: 0.3rem; font-size: 0.7rem; color: #6d28d9; font-weight: 700;">PDF</a>` : ''}
            `;
          }
        } catch (itemErr) {
          errCount++;
          if (statusCell) {
            statusCell.innerHTML = `<span style="color: #dc2626; font-weight: 700; font-size: 0.7rem;" title="${escHtml(itemErr.message)}"><i class="ri-close-circle-fill"></i> Error</span>`;
          }
        }
      }

      cachedLiorenStatusTs = 0;
      progPct.textContent = '100%';
      progBar.style.width = '100%';
      progText.innerHTML = stopRequested
        ? `<span style="color: #d97706;"><i class="ri-information-fill"></i> Cola detenida por usuario · Emitidas: <strong>${okCount}</strong> · Errores: <strong>${errCount}</strong></span>`
        : `<span style="color: #059669;"><i class="ri-checkbox-circle-fill"></i> Proceso finalizado · Emitidas: <strong>${okCount}</strong> · Errores: <strong>${errCount}</strong></span>`;

      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Finalizar y Cerrar';
      }
      if (closeTopBtn) closeTopBtn.disabled = false;
      startBtn.style.display = 'none';

      // Limpiar selección masiva de Tareas y Pendientes si existe
      if (window._pendingTasksState?.selectedKeys) {
        window._pendingTasksState.selectedKeys.clear();
      }

      // Refrescar todas las vistas afectadas
      await refreshViewsAfterInvoiceAction([...touchedPeriods][0] || '', '', 'fulfillment');
      for (const pid of touchedPeriods) {
        const pBody = document.getElementById(`period-body-${pid}`);
        if (pBody && typeof window.loadBillingRecords === 'function') {
          await window.loadBillingRecords(pid, pBody);
        }
      }
    });
  } catch (err) {
    console.error('Error preparando emisión masiva Lioren:', err);
    bodyEl.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); color: #dc2626; padding: 1rem; border-radius: 8px; font-size: 0.85rem;">
        <strong><i class="ri-error-warning-line"></i> Error al preparar emisión masiva:</strong>
        <p style="margin: 0.4rem 0 0 0;">${escHtml(err.message || err)}</p>
      </div>
    `;
  }
};

// Helpers globales para lanzar emisión masiva desde Control de Facturas y Vista por Comercio
window.bulkEmitFromControlFacturas = function(periodId) {
  const container = document.getElementById(`period-body-${periodId}`);
  if (!container) return;
  const activeTab = (window.activeBillingTabs && window.activeBillingTabs[periodId]) || 'fulf';
  const selector = activeTab === 'fulf' ? '.row-select-fulf:checked' : '.row-select-env:checked';
  const serviceType = activeTab === 'fulf' ? 'fulfillment' : 'enviame';
  const items = Array.from(container.querySelectorAll(selector)).map(cb => ({
    recordId: cb.value,
    serviceType
  }));
  window.openBulkLiorenEmitModal(items);
};

window.bulkEmitFromCommerceView = function() {
  const ids = [...(window._commerceViewState?.selectedRecordIds || [])];
  if (ids.length === 0) return;
  const scope = document.getElementById('cv-bulk-scope-select')?.value || 'both';
  const items = [];
  ids.forEach(recordId => {
    if (scope === 'fulf' || scope === 'both') items.push({ recordId, serviceType: 'fulfillment' });
    if (scope === 'env' || scope === 'both') items.push({ recordId, serviceType: 'enviame' });
  });
  window.openBulkLiorenEmitModal(items);
};

// ============================================================================
// INTEGRACIÓN DIRECTA CON GESTOR DE FACTURACIÓN ("CONFIRMAR Y PUBLICAR")
// ============================================================================
window.inspectCommerceForImmediateInvoice = async function(comercioName) {
  injectLiorenStyles();
  const [dataset, liorenStatus] = await Promise.all([
    typeof window.fetchBillingCommerceLegalDataset === 'function'
      ? window.fetchBillingCommerceLegalDataset()
      : Promise.resolve(null),
    getLiorenStatus(false).catch(() => null)
  ]);

  let sii = evaluateCommerceSiiReadiness(comercioName, dataset);
  if (!sii.ready && sii.rutValid) {
    sii = await tryHydrateReceptorFromLioren(sii);
  }

  return { sii, dataset, liorenStatus };
};

window.emitImmediateLiorenInvoice = async function(recordId, serviceType = 'fulfillment', options = {}) {
  injectLiorenStyles();
  const normalizedService = serviceType === 'enviame' ? 'enviame' : 'fulfillment';
  const comercioName = options.comercioName || '';
  const periodName = options.periodName || '';
  const grossAmount = Math.round(Number(options.grossAmount) || 0);
  const montoNeto = grossAmount > 0 ? Math.round(grossAmount / 1.19) : 0;

  if (montoNeto <= 0) {
    throw new Error('El monto a facturar debe ser mayor a $0.');
  }

  let sii = options.sii;
  if (!sii) {
    const dataset = typeof window.fetchBillingCommerceLegalDataset === 'function'
      ? await window.fetchBillingCommerceLegalDataset()
      : null;
    sii = evaluateCommerceSiiReadiness(comercioName, dataset);
    if (!sii.ready && sii.rutValid) {
      sii = await tryHydrateReceptorFromLioren(sii);
    }
  }

  if (!sii?.ready) {
    throw new Error(`Faltan datos SII obligatorios para emitir: ${(sii?.missing || ['RUT']).join(', ')}.`);
  }

  const todayIso = new Date().toLocaleDateString('sv-SE');
  const rawDue = String(options.dueDate || '').trim();
  const vencimiento = (rawDue && rawDue >= todayIso) ? rawDue : computeBusinessDays(todayIso, 5);
  const formattedPeriod = String(periodName || '').replace(/[\s-]+/g, '-').toUpperCase();
  const glosa = `${normalizedService === 'fulfillment' ? 'SERV. FULFILLMENT' : 'SERV. ENVIAME'} ${formattedPeriod}`.trim();
  const actividad = normalizedService === 'fulfillment' ? '521009' : '522190';
  const idempotencyKey = options.idempotencyKey || ((typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `pub-emit-${recordId}-${normalizedService}-${Date.now()}`);

  const emitResult = await callLiorenApi({
    action: 'emit_dte',
    recordId,
    comercio: comercioName,
    serviceType: normalizedService,
    tipodoc: '33',
    actividad,
    fecha: todayIso,
    vencimiento,
    glosa,
    montoNeto,
    receptor: {
      rut: sii.rutFormatted,
      rs: sii.rs,
      giro: sii.giro,
      direccion: sii.direccion,
      comuna: sii.comunaId,
      ciudad: sii.ciudadId,
      comunaNombre: sii.comunaNombre,
      ciudadNombre: sii.ciudadNombre,
      email: sii.email
    },
    saveCommerceLegalInfo: true,
    idempotencyKey
  });

  cachedLiorenStatusTs = 0;
  await refreshViewsAfterInvoiceAction(options.periodId || '', recordId, normalizedService);
  return emitResult;
};
