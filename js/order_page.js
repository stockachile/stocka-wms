/**
 * WMS STOCKA - Buscador Multicriterio de Pedidos & Página Dedicada 360° por Pedido (v2)
 * Permite:
 * 1. Buscar cualquier pedido (reciente o histórico antiguo) desde el Buscador Principal (Ctrl+K)
 *    en Panel Admin (admin.html) y Portal Clientes (dashboard.html) usando múltiples criterios
 *    (# Pedido, Tracking/Guía, Cliente, Email/Teléfono, Comuna/Dirección, SKU/Producto, Comercio, Estado y Antigüedad).
 * 2. Abrir una Página Dedicada 360° del Pedido en una nueva pestaña (?order=<UUID>) con:
 *    - Stepper / Línea de Tiempo de las 5 Etapas Operativas del Pedido
 *    - Desglose amplio de Productos, Stock en Bodega y Verificación de Escaneo Picker
 *    - Ficha de Destinatario, Dirección de Despacho, Cobertura y Notas
 *    - Trazabilidad en vivo de Etapas del Picking (conectado a active_orders y history_logs del Picker)
 *    - Detalles de Plataforma / Canal de Venta, Transporte Courier y Auto-Track
 */

import { supabase } from './supabase.js';

const PICKER_SUPABASE_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

let _pickerSupabaseClient = null;
function getPickerSupabase() {
  if (_pickerSupabaseClient) return _pickerSupabaseClient;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    _pickerSupabaseClient = window.supabase.createClient(PICKER_SUPABASE_URL, PICKER_SUPABASE_KEY);
  }
  return _pickerSupabaseClient;
}

const ORDER_SEARCH_CRITERIA_ADMIN = [
  { id: 'all', label: 'Todo', icon: 'ri-apps-2-line', placeholder: 'Escribe #pedido, tracking, cliente, email, comuna, SKU o comercio...' },
  { id: 'order_num', label: '# Pedido', icon: 'ri-hashtag', placeholder: 'Escribe el número de pedido (ej: 10452 o #10452)...' },
  { id: 'tracking', label: 'Tracking / Guía', icon: 'ri-barcode-line', placeholder: 'Escribe el código de seguimiento o guía del courier...' },
  { id: 'customer', label: 'Cliente', icon: 'ri-user-search-line', placeholder: 'Escribe nombre o apellido del destinatario...' },
  { id: 'contact', label: 'Email / Tel', icon: 'ri-phone-line', placeholder: 'Escribe correo electrónico o teléfono del comprador...' },
  { id: 'location', label: 'Comuna / Dir', icon: 'ri-map-pin-line', placeholder: 'Escribe comuna (ej: Las Condes) o calle de destino...' },
  { id: 'sku', label: 'SKU / Producto', icon: 'ri-shopping-basket-2-line', placeholder: 'Escribe código SKU, código de barras o nombre del producto...' },
  { id: 'commerce', label: 'Comercio', icon: 'ri-store-2-line', placeholder: 'Escribe nombre del comercio / tienda (ej: Joyas Gloss)...' }
];

const ORDER_SEARCH_CRITERIA_CLIENT = ORDER_SEARCH_CRITERIA_ADMIN.filter(c => c.id !== 'commerce');

function escapeHtmlSafe(str) {
  if (window.escapeHtml) return window.escapeHtml(str);
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatClpSafe(val) {
  if (window.formatCLP) return window.formatCLP(val);
  const num = Number(val) || 0;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(num);
}

function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || '').trim());
}

function formatRelativeTimeEs(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Hace instantes';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hace 1 día';
  if (days < 30) return `Hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'Hace 1 mes' : `Hace ${months} meses`;
}

function getClientAllowedCommerces() {
  const list = [];
  const add = (raw) => {
    if (!raw) return;
    String(raw).split(',').forEach(part => {
      const clean = part.trim();
      if (clean && clean.toLowerCase() !== 'no asignado') {
        if (!list.includes(clean)) list.push(clean);
        if (!list.includes(clean.toUpperCase())) list.push(clean.toUpperCase());
        if (!list.includes(clean.toLowerCase())) list.push(clean.toLowerCase());
      }
    });
  };
  add(window.currentCompany);
  add(window.currentUserProfile?.comercio);
  add(window.currentUserProfile?.company_name);
  return list;
}

function getWmsStatusStyle(order) {
  const wms = String(order?.estado_wms || order?.status || 'En procesamiento').trim();
  const low = wms.toLowerCase();
  if (low.includes('despachado') || low.includes('entregado') || low.includes('retirado')) {
    return { label: wms, bg: 'rgba(16, 185, 129, 0.14)', color: '#059669', border: 'rgba(16, 185, 129, 0.35)', icon: 'ri-truck-line' };
  }
  if (low.includes('pickeado') || low.includes('preparado') || low.includes('listo')) {
    return { label: wms, bg: 'rgba(59, 130, 246, 0.14)', color: '#2563eb', border: 'rgba(59, 130, 246, 0.35)', icon: 'ri-checkbox-circle-line' };
  }
  if (low.includes('preparación') || low.includes('preparacion')) {
    return { label: wms, bg: 'rgba(245, 158, 11, 0.15)', color: '#d97706', border: 'rgba(245, 158, 11, 0.35)', icon: 'ri-loader-2-line' };
  }
  if (low.includes('incidencia') || low.includes('problema')) {
    return { label: wms, bg: 'rgba(239, 68, 68, 0.14)', color: '#dc2626', border: 'rgba(239, 68, 68, 0.35)', icon: 'ri-error-warning-line' };
  }
  if (low.includes('cancelado')) {
    return { label: wms, bg: 'rgba(100, 116, 139, 0.14)', color: '#64748b', border: 'rgba(100, 116, 139, 0.35)', icon: 'ri-close-circle-line' };
  }
  return { label: wms || 'En procesamiento', bg: 'rgba(99, 102, 241, 0.12)', color: '#4f46e5', border: 'rgba(99, 102, 241, 0.3)', icon: 'ri-time-line' };
}

function getPlatformMeta(order) {
  const raw = String(order?.origen || order?.external_platform || 'Manual').trim();
  const low = raw.toLowerCase();
  if (low.includes('shopify')) return { name: 'Shopify', icon: 'ri-shopping-bag-3-fill', color: '#65a30d', bg: 'rgba(132, 204, 22, 0.14)', border: 'rgba(132, 204, 22, 0.35)' };
  if (low.includes('meli') || low.includes('mercado')) return { name: 'Mercado Libre', icon: 'ri-hand-coin-fill', color: '#ca8a04', bg: 'rgba(234, 179, 8, 0.15)', border: 'rgba(234, 179, 8, 0.35)' };
  if (low.includes('falabella')) return { name: 'Falabella', icon: 'ri-store-3-fill', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.14)', border: 'rgba(22, 163, 74, 0.35)' };
  if (low.includes('woo')) return { name: 'WooCommerce', icon: 'ri-shopping-cart-fill', color: '#9333ea', bg: 'rgba(147, 51, 234, 0.14)', border: 'rgba(147, 51, 234, 0.35)' };
  if (low.includes('jumpseller')) return { name: 'Jumpseller', icon: 'ri-global-line', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.14)', border: 'rgba(2, 132, 199, 0.35)' };
  if (low.includes('paris')) return { name: 'Paris', icon: 'ri-building-4-fill', color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.14)', border: 'rgba(14, 165, 233, 0.35)' };
  if (low.includes('ripley')) return { name: 'Ripley', icon: 'ri-vip-crown-fill', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.14)', border: 'rgba(124, 58, 237, 0.35)' };
  if (low.includes('walmart')) return { name: 'Walmart', icon: 'ri-sun-fill', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.14)', border: 'rgba(37, 99, 235, 0.35)' };
  if (low.includes('tiendanube')) return { name: 'Tiendanube', icon: 'ri-cloud-fill', color: '#0369a1', bg: 'rgba(3, 105, 161, 0.14)', border: 'rgba(3, 105, 161, 0.35)' };
  if (low.includes('inversa')) return { name: 'Logística Inversa', icon: 'ri-arrow-go-back-line', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.14)', border: 'rgba(124, 58, 237, 0.35)' };
  if (low.includes('punto de venta') || low === 'pos') return { name: 'Punto de Venta (POS)', icon: 'ri-store-2-fill', color: '#0d9488', bg: 'rgba(13, 148, 136, 0.14)', border: 'rgba(13, 148, 136, 0.35)' };
  return { name: raw || 'Manual', icon: 'ri-file-list-3-fill', color: '#4f46e5', bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.3)' };
}

function getOrderPageUrl(orderId, isAdmin = null) {
  const adminMode = isAdmin !== null ? isAdmin : Boolean(document.getElementById('admin-cmd-container') || window.location.pathname.includes('admin'));
  const currentPath = window.location.pathname || '';
  const usesCleanUrls = !currentPath.endsWith('.html') && (currentPath.endsWith('/admin') || currentPath.endsWith('/dashboard'));
  let basePage = adminMode
    ? (usesCleanUrls ? '/admin' : 'admin.html')
    : (usesCleanUrls ? '/dashboard' : 'dashboard.html');
  if (adminMode && (currentPath.endsWith('/admin') || currentPath.endsWith('/admin.html'))) {
    basePage = currentPath;
  } else if (!adminMode && (currentPath.endsWith('/dashboard') || currentPath.endsWith('/dashboard.html'))) {
    basePage = currentPath;
  }
  return `${basePage}?order=${encodeURIComponent(orderId)}#order=${encodeURIComponent(orderId)}`;
}

function consumePendingOrderFromUrlOrStorage() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const fromQuery = (urlParams.get('order') || urlParams.get('pedido') || '').trim();
    if (fromQuery) {
      localStorage.removeItem('wms_pending_open_order');
      return fromQuery;
    }
    const rawHash = (window.location.hash || '').replace(/^#/, '').trim();
    const hashMatch = rawHash.match(/^(?:order|pedido)=(.+)$/i);
    if (hashMatch && hashMatch[1]) {
      localStorage.removeItem('wms_pending_open_order');
      return decodeURIComponent(hashMatch[1]).trim();
    }
    const rawStorage = localStorage.getItem('wms_pending_open_order');
    if (rawStorage) {
      localStorage.removeItem('wms_pending_open_order');
      const parsed = JSON.parse(rawStorage);
      if (parsed && parsed.orderId && (Date.now() - (Number(parsed.ts) || 0) < 25000)) {
        const cleanUrl = `${window.location.pathname}?order=${encodeURIComponent(parsed.orderId)}#order=${encodeURIComponent(parsed.orderId)}`;
        window.history.replaceState({ orderId: parsed.orderId }, '', cleanUrl);
        return String(parsed.orderId).trim();
      }
    }
  } catch (e) {
    console.warn('[OrderPage] Error leyendo parámetro inicial de pedido:', e);
  }
  return '';
}

const INITIAL_DETECTED_ORDER_ID = consumePendingOrderFromUrlOrStorage();
if (INITIAL_DETECTED_ORDER_ID) {
  window._suppressDashboardForOrderPage = true;
  window._activeSingleOrderPageId = INITIAL_DETECTED_ORDER_ID;
  window._pendingSingleOrderPage = {
    orderId: INITIAL_DETECTED_ORDER_ID,
    isAdmin: Boolean(document.getElementById('admin-cmd-container') || window.location.pathname.includes('admin'))
  };
}

window.openOrderInNewTab = function(orderId, isAdmin = null) {
  if (!orderId) return;
  const adminMode = isAdmin !== null ? isAdmin : Boolean(document.getElementById('admin-cmd-container') || window.location.pathname.includes('admin'));
  try {
    localStorage.setItem('wms_pending_open_order', JSON.stringify({
      orderId: String(orderId).trim(),
      isAdmin: adminMode,
      ts: Date.now()
    }));
  } catch (e) {}
  const url = getOrderPageUrl(orderId, adminMode);
  window.open(url, '_blank');
};

window.openSingleOrderHere = function(orderId, isAdmin = null) {
  if (!orderId) return;
  const adminMode = isAdmin !== null ? isAdmin : Boolean(document.getElementById('admin-cmd-container') || window.location.pathname.includes('admin'));
  const newUrl = `${window.location.pathname}?order=${encodeURIComponent(orderId)}#order=${encodeURIComponent(orderId)}`;
  window.history.pushState({ orderId }, '', newUrl);
  window.renderSingleOrderPage(orderId, { isAdmin: adminMode });
};

window.copyOrderDirectLink = function(orderId, isAdmin = null) {
  if (!orderId) return;
  const relUrl = getOrderPageUrl(orderId, isAdmin);
  const fullUrl = `${window.location.origin}/${relUrl.replace(/^\//, '')}`;
  navigator.clipboard.writeText(fullUrl).then(() => {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Link directo del pedido copiado al portapapeles',
        showConfirmButton: false,
        timer: 2000
      });
    }
  }).catch(() => {});
};

// ============================================================================
// ESTILOS DE PÁGINA DE PEDIDO 360° & BUSCADOR MULTICRITERIO
// ============================================================================
function injectOrderSearchStyles() {
  if (document.getElementById('wms-order-search-page-styles')) return;
  const style = document.createElement('style');
  style.id = 'wms-order-search-page-styles';
  style.textContent = `
    .cmd-criteria-bar {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.6rem 1rem;
      background: rgba(248, 250, 252, 0.46);
      border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    }
    [data-theme="dark"] .cmd-criteria-bar {
      background: rgba(15, 23, 42, 0.46);
      border-bottom-color: rgba(255, 255, 255, 0.08);
    }
    .cmd-criteria-chips-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .cmd-criterion-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      padding: 0.24rem 0.58rem;
      border-radius: 999px;
      font-size: 0.73rem;
      font-weight: 600;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(255, 255, 255, 0.75);
      color: var(--color-text-muted, #64748b);
      cursor: pointer;
      transition: all 0.15s ease;
      line-height: 1.2;
    }
    [data-theme="dark"] .cmd-criterion-chip {
      background: rgba(30, 41, 59, 0.72);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .cmd-criterion-chip:hover {
      border-color: var(--color-primary, #6366f1);
      color: var(--color-primary, #6366f1);
    }
    .cmd-criterion-chip.active {
      background: var(--color-primary, #6366f1);
      color: #ffffff;
      border-color: var(--color-primary, #6366f1);
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.32);
    }
    .cmd-criteria-filters-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .cmd-criteria-select {
      padding: 0.22rem 0.55rem;
      font-size: 0.73rem;
      font-weight: 600;
      border-radius: 7px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(255, 255, 255, 0.8);
      color: var(--color-text-main, #0f172a);
      cursor: pointer;
      outline: none;
    }
    [data-theme="dark"] .cmd-criteria-select {
      background: rgba(30, 41, 59, 0.8);
      border-color: rgba(255, 255, 255, 0.14);
    }
    .cmd-mono-icon {
      color: var(--color-text-muted, #64748b);
      font-size: 0.82rem;
      vertical-align: -1px;
      margin-right: 0.15rem;
      opacity: 0.85;
    }
    .cmd-order-live-item {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 0.85rem !important;
      padding: 0.65rem 0.85rem !important;
      border-bottom: 1px dashed rgba(148, 163, 184, 0.22);
      border-radius: 10px;
      text-align: left;
      width: 100%;
    }
    .cmd-order-actions-col {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-shrink: 0;
    }
    .cmd-order-btn-newtab {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.26rem 0.55rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(99, 102, 241, 0.1);
      color: var(--color-primary, #4f46e5);
      border: 1px solid rgba(99, 102, 241, 0.28);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .cmd-order-btn-newtab:hover,
    .cmd-result-item.is-selected .cmd-order-btn-newtab {
      background: var(--color-primary, #4f46e5);
      color: #ffffff;
      border-color: var(--color-primary, #4f46e5);
    }
    .cmd-order-btn-here {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.26rem 0.45rem;
      border-radius: 6px;
      font-size: 0.7rem;
      font-weight: 600;
      background: var(--color-surface, #ffffff);
      color: var(--color-text-muted, #64748b);
      border: 1px solid var(--color-border, #cbd5e1);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    /* ======================================================================
       DISEÑO EJECUTIVO PÁGINA DE PEDIDO 360° (v2)
       ====================================================================== */
    .single-order-page-wrap {
      display: flex;
      flex-direction: column;
      gap: 1.15rem;
      padding-bottom: 3rem;
      max-width: 1480px;
      margin: 0 auto;
      animation: fadeInOrderPage 0.22s ease-out;
    }
    @keyframes fadeInOrderPage {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sop-top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.75rem;
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 12px;
      padding: 0.7rem 1.1rem;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
    }
    .sop-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.42rem 0.85rem;
      border-radius: 8px;
      font-size: 0.78rem;
      font-weight: 700;
      border: 1px solid var(--color-border, #cbd5e1);
      background: var(--color-surface, #ffffff);
      color: var(--color-text-main, #0f172a);
      cursor: pointer;
      transition: all 0.16s ease;
      text-decoration: none;
      line-height: 1.2;
      white-space: nowrap;
    }
    .sop-btn:hover {
      border-color: var(--color-primary, #6366f1);
      color: var(--color-primary, #6366f1);
      background: rgba(99, 102, 241, 0.05);
      transform: translateY(-1px);
    }
    .sop-btn-primary {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #ffffff !important;
      border-color: #4f46e5;
      box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);
    }
    .sop-btn-primary:hover {
      background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
      color: #ffffff !important;
      box-shadow: 0 4px 10px rgba(79, 70, 229, 0.35);
    }
    .sop-btn-indigo {
      background: rgba(99, 102, 241, 0.08);
      color: #4f46e5;
      border-color: rgba(99, 102, 241, 0.3);
    }
    .sop-btn-emerald {
      background: rgba(16, 185, 129, 0.08);
      color: #059669;
      border-color: rgba(16, 185, 129, 0.32);
    }
    .sop-btn-emerald:hover {
      background: rgba(16, 185, 129, 0.15);
      border-color: #059669;
      color: #047857;
    }
    .sop-btn-purple {
      background: rgba(124, 58, 237, 0.08);
      color: #7c3aed;
      border-color: rgba(124, 58, 237, 0.32);
    }
    .sop-btn-purple:hover {
      background: rgba(124, 58, 237, 0.15);
      border-color: #7c3aed;
      color: #6d28d9;
    }
    .sop-btn-amber {
      background: rgba(234, 88, 12, 0.08);
      color: #ea580c;
      border-color: rgba(234, 88, 12, 0.32);
    }

    /* Hero Card */
    .sop-hero-card {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 14px;
      padding: 1.25rem 1.4rem;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
      display: flex;
      flex-direction: column;
      gap: 1.15rem;
      position: relative;
      overflow: hidden;
    }
    .sop-hero-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #10b981 100%);
    }
    .sop-kpi-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.75rem;
    }
    .sop-kpi-box {
      background: var(--color-bg, #f8fafc);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 10px;
      padding: 0.75rem 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .sop-kpi-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.15rem;
      flex-shrink: 0;
    }
    .sop-kpi-info {
      display: flex;
      flex-direction: column;
      gap: 0.12rem;
      min-width: 0;
    }
    .sop-kpi-label {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted, #64748b);
    }
    .sop-kpi-val {
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--color-text-main, #0f172a);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Stepper / Línea de Tiempo de Etapas */
    .sop-stepper-card {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 14px;
      padding: 1.15rem 1.4rem;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.03);
    }
    .sop-stepper-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.1rem;
      padding-bottom: 0.65rem;
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .sop-stepper-track {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.5rem;
      position: relative;
    }
    @media (max-width: 960px) {
      .sop-stepper-track {
        grid-template-columns: 1fr;
        gap: 0.75rem;
      }
    }
    .sop-step-item {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.85rem 0.9rem;
      border-radius: 10px;
      border: 1px solid var(--color-border, #e2e8f0);
      background: var(--color-bg, #f8fafc);
      transition: all 0.2s ease;
    }
    .sop-step-item.is-completed {
      border-color: rgba(16, 185, 129, 0.35);
      background: rgba(16, 185, 129, 0.04);
    }
    .sop-step-item.is-delivered-final {
      border: 2px solid #10b981;
      background: rgba(16, 185, 129, 0.09);
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.16);
    }
    .sop-step-item.is-current {
      border: 2px solid var(--color-primary, #6366f1);
      background: rgba(99, 102, 241, 0.06);
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.12);
    }
    .sop-step-item.is-alert {
      border: 2px solid #ef4444;
      background: rgba(239, 68, 68, 0.06);
    }
    .sop-step-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
    }
    .sop-step-circle {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.95rem;
      font-weight: 700;
      background: var(--color-surface, #ffffff);
      border: 2px solid var(--color-border, #cbd5e1);
      color: var(--color-text-muted, #64748b);
    }
    .sop-step-item.is-completed .sop-step-circle {
      background: #10b981;
      border-color: #10b981;
      color: #ffffff;
    }
    .sop-step-item.is-delivered-final .sop-step-circle {
      background: #059669;
      border-color: #059669;
      color: #ffffff;
      box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.22);
    }
    .sop-step-item.is-current .sop-step-circle {
      background: var(--color-primary, #6366f1);
      border-color: var(--color-primary, #6366f1);
      color: #ffffff;
      box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.2);
    }
    .sop-step-item.is-alert .sop-step-circle {
      background: #ef4444;
      border-color: #ef4444;
      color: #ffffff;
    }
    .sop-step-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--color-text-main, #0f172a);
      line-height: 1.25;
    }
    .sop-step-desc {
      font-size: 0.74rem;
      color: var(--color-text-muted, #64748b);
      line-height: 1.35;
    }
    .sop-step-meta {
      margin-top: auto;
      padding-top: 0.35rem;
      border-top: 1px dashed var(--color-border, #e2e8f0);
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--color-text-muted, #64748b);
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    /* Secciones y Grillas Asimétricas */
    .sop-grid-main {
      display: grid;
      grid-template-columns: 1.65fr 1fr;
      gap: 1.15rem;
      align-items: start;
    }
    .sop-grid-two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.15rem;
      align-items: start;
    }
    @media (max-width: 1080px) {
      .sop-grid-main,
      .sop-grid-two {
        grid-template-columns: 1fr;
      }
    }
    .sop-section-card {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 14px;
      padding: 1.25rem;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.03);
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }
    .sop-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding-bottom: 0.65rem;
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .sop-section-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 800;
      color: var(--color-text-main, #0f172a);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .sop-section-icon {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: rgba(99, 102, 241, 0.1);
      color: var(--color-primary, #6366f1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.95rem;
    }
    .sop-info-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .sop-info-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.45rem 0.65rem;
      border-radius: 8px;
      background: var(--color-bg, #f8fafc);
      border: 1px solid var(--color-border, #e2e8f0);
      font-size: 0.83rem;
    }
    .sop-info-key {
      color: var(--color-text-muted, #64748b);
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      flex-shrink: 0;
    }
    .sop-info-val {
      color: var(--color-text-main, #0f172a);
      font-weight: 700;
      text-align: right;
      word-break: break-word;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .sop-mini-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
      gap: 0.55rem;
    }
    .sop-mini-stat {
      background: var(--color-bg, #f8fafc);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 8px;
      padding: 0.55rem 0.7rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .sop-mini-stat-label {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--color-text-muted, #64748b);
    }
    .sop-mini-stat-val {
      font-size: 0.84rem;
      font-weight: 700;
      color: var(--color-text-main, #0f172a);
    }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// 1. CONSULTA MULTICRITERIO EN SUPABASE PARA EL BUSCADOR GLOBAL
// ============================================================================
let _sopComerciosSiglaMapPromise = null;
async function getCommercesBySiglaMap() {
  if (_sopComerciosSiglaMapPromise) return _sopComerciosSiglaMapPromise;
  _sopComerciosSiglaMapPromise = (async () => {
    const siglaToCommerces = new Map();
    const commerceToSigla = new Map();
    const allSiglasSet = new Set();
    const allCommercesSet = new Set();
    try {
      const { data } = await supabase.from('v_comercios_config').select('nombre, sigla');
      if (Array.isArray(data)) {
        data.forEach(row => {
          const sig = String(row.sigla || '').trim().toUpperCase();
          const nom = String(row.nombre || '').trim();
          const nomUpper = nom.toUpperCase();
          if (nom) allCommercesSet.add(nom);
          if (sig) allSiglasSet.add(sig);
          if (sig && nomUpper) {
            if (!siglaToCommerces.has(sig)) siglaToCommerces.set(sig, new Set());
            siglaToCommerces.get(sig).add(nomUpper);
            commerceToSigla.set(nomUpper, sig);
          }
        });
      }
    } catch (e) {}
    return {
      siglaToCommerces,
      commerceToSigla,
      allSiglas: Array.from(allSiglasSet),
      allCommerces: Array.from(allCommercesSet)
    };
  })();
  return _sopComerciosSiglaMapPromise;
}

function parseOrderCodeParts(rawStr) {
  const clean = String(rawStr || '').replace(/["(),]/g, '').trim();
  const noHash = clean.replace(/^#+/, '').trim();
  const alnumOnly = noHash.replace(/[^a-zA-Z0-9]/g, '');
  const withoutLi = noHash.replace(/^LI[-_#]*/i, '');
  const match = withoutLi.match(/^([A-Za-z]{2,6})[-_\s#]*(\d{2,}[A-Za-z0-9]*)$/);
  if (match) {
    const prefix = match[1].toUpperCase();
    const numPart = match[2];
    return {
      hasPrefix: true,
      prefix,
      numPart,
      compact: `${prefix}${numPart}`,
      withHash: `${prefix}#${numPart}`,
      withDash: `${prefix}-${numPart}`,
      wildcardOne: `${prefix}_${numPart}`,
      wildcardTwo: `${prefix}__${numPart}`,
      alnumLower: `${prefix}${numPart}`.toLowerCase(),
      numLower: numPart.toLowerCase()
    };
  }
  return {
    hasPrefix: false,
    prefix: '',
    numPart: noHash,
    compact: alnumOnly,
    withHash: '',
    withDash: '',
    wildcardOne: '',
    wildcardTwo: '',
    alnumLower: alnumOnly.toLowerCase(),
    numLower: alnumOnly.toLowerCase()
  };
}

/**
 * Construye variantes exactas y rangos B-Tree (gte/lte) para consultar
 * `orders.external_order_number` y `orders.tracking_number` usando índices B-Tree
 * en ~180ms sin provocar `57014 statement_timeout` por full-scan ILIKE + RLS.
 */
function buildOrderReferenceVariants(rawStr, allSiglas = []) {
  const clean = String(rawStr || '').replace(/["(),]/g, '').trim();
  const noHash = clean.replace(/^#+/, '').trim();
  const upper = noHash.toUpperCase();
  const codeParts = parseOrderCodeParts(clean);

  const extSet = new Set();
  const trkSet = new Set();
  const prefixRanges = [];

  if (clean) extSet.add(clean);
  if (noHash) {
    extSet.add(noHash);
    extSet.add(`#${noHash}`);
    trkSet.add(noHash);
  }
  if (upper) {
    extSet.add(upper);
    extSet.add(`#${upper}`);
    trkSet.add(upper);
    if (!/\s/.test(upper)) {
      prefixRanges.push({ col: 'external_order_number', prefix: upper });
      prefixRanges.push({ col: 'external_order_number', prefix: `#${upper}` });
      prefixRanges.push({ col: 'tracking_number', prefix: upper });
    }
  }

  if (codeParts.hasPrefix) {
    const p = codeParts.prefix;
    const n = codeParts.numPart;
    [
      `${p}${n}`, `#${p}${n}`,
      `${p}#${n}`, `#${p}#${n}`,
      `${p}-${n}`, `#${p}-${n}`,
      `${p}_${n}`, `${p} ${n}`,
      `LI-${p}${n}`, `LI-${p}#${n}`, `LI-${p}-${n}`,
      n, `#${n}`
    ].forEach(v => extSet.add(v));
    trkSet.add(`${p}${n}`);
    trkSet.add(`${p}-${n}`);
    trkSet.add(n);

    prefixRanges.push({ col: 'external_order_number', prefix: `${p}${n}` });
    prefixRanges.push({ col: 'external_order_number', prefix: `${p}#${n}` });
    prefixRanges.push({ col: 'external_order_number', prefix: `${p}-${n}` });
    prefixRanges.push({ col: 'external_order_number', prefix: `#${p}-${n}` });
    prefixRanges.push({ col: 'tracking_number', prefix: `${p}${n}` });
  } else if (/^\d{2,10}$/.test(noHash) && allSiglas.length > 0) {
    allSiglas.forEach(sig => {
      extSet.add(`${sig}${noHash}`);
      extSet.add(`#${sig}${noHash}`);
      extSet.add(`${sig}#${noHash}`);
      extSet.add(`${sig}-${noHash}`);
      extSet.add(`#${sig}-${noHash}`);
    });
  }

  return {
    extList: Array.from(extSet).filter(Boolean),
    trkList: Array.from(trkSet).filter(Boolean),
    prefixRanges
  };
}

async function queryOrdersMultiCriteria({ query, criterion, statusFilter, dateRangeFilter, isAdmin }) {
  const rawQ = String(query || '').trim();
  if (rawQ.length < 2 && !statusFilter) return [];

  const cleanQ = rawQ.replace(/["(),]/g, '').trim();
  const cleanNoHash = cleanQ.replace(/^#+/, '').trim();
  const qLower = cleanNoHash.toLowerCase();
  const codeParts = parseOrderCodeParts(cleanQ);
  const siglaMaps = await getCommercesBySiglaMap();
  const allSiglas = siglaMaps.allSiglas || [];
  const allCommerces = siglaMaps.allCommerces || [];

  const allowedCommerces = !isAdmin ? getClientAllowedCommerces() : [];
  if (!isAdmin && allowedCommerces.length === 0 && !window.currentClientUser?.id) {
    return [];
  }

  let fromDateIso = null;
  let fromDateMs = 0;
  if (dateRangeFilter && dateRangeFilter !== 'all') {
    const now = new Date();
    const fromDate = new Date();
    if (dateRangeFilter === '7d') fromDate.setDate(now.getDate() - 7);
    else if (dateRangeFilter === '30d') fromDate.setDate(now.getDate() - 30);
    else if (dateRangeFilter === '90d') fromDate.setDate(now.getDate() - 90);
    else if (dateRangeFilter === '365d') fromDate.setDate(now.getDate() - 365);
    fromDateIso = fromDate.toISOString();
    fromDateMs = fromDate.getTime();
  }

  const selectCols = `
    id,
    created_at,
    external_order_number,
    external_platform,
    origen,
    comercio,
    status,
    estado_wms,
    customer_name,
    customer_email,
    customer_phone,
    shipping_city,
    shipping_address,
    courier,
    operador,
    tracking_number,
    total_value,
    categoria_entrega,
    sku,
    item
  `.replace(/\s+/g, ' ').trim();

  const applyBaseFilters = (qb) => {
    let q = qb;
    if (!isAdmin) {
      if (allowedCommerces.length > 0) q = q.in('comercio', allowedCommerces);
      else if (window.currentClientUser?.id) q = q.eq('merchant_id', window.currentClientUser.id);
    }
    if (statusFilter) q = q.eq('estado_wms', statusFilter);
    if (fromDateIso) q = q.gte('created_at', fromDateIso);
    return q;
  };

  const resultsMap = new Map();
  const addRows = (rows) => {
    (rows || []).forEach(r => {
      if (!r || !r.id) return;
      if (statusFilter && String(r.estado_wms || '') !== statusFilter) return;
      if (fromDateMs > 0 && r.created_at && new Date(r.created_at).getTime() < fromDateMs) return;
      if (!isAdmin && allowedCommerces.length > 0) {
        const commUp = String(r.comercio || '').trim().toUpperCase();
        const allowedUp = allowedCommerces.map(c => String(c || '').trim().toUpperCase());
        if (!allowedUp.includes(commUp)) return;
      }
      if (!resultsMap.has(r.id)) resultsMap.set(r.id, r);
    });
  };

  // --------------------------------------------------------------------------
  // NIVEL 0: Búsqueda instantánea en memoria local (window.loadedOrders)
  // --------------------------------------------------------------------------
  if (Array.isArray(window.loadedOrders) && window.loadedOrders.length > 0) {
    const localMatches = [];
    for (let i = 0; i < window.loadedOrders.length; i++) {
      const o = window.loadedOrders[i];
      if (!o || !o.id) continue;
      if (cleanQ.length < 2) {
        localMatches.push(o);
        if (localMatches.length >= 25) break;
        continue;
      }
      const extStr = String(o.external_order_number || '').toLowerCase();
      const extAlnum = extStr.replace(/[^a-z0-9]/g, '');
      const trkStr = String(o.tracking_number || '').toLowerCase();
      const custStr = String(o.customer_name || '').toLowerCase();
      const emailStr = String(o.customer_email || '').toLowerCase();
      const phoneStr = String(o.customer_phone || '').toLowerCase();
      const cityStr = String(o.shipping_city || '').toLowerCase();
      const addrStr = String(o.shipping_address || '').toLowerCase();
      const skuStr = String(o.sku || '').toLowerCase();
      const itemStr = String(o.item || '').toLowerCase();
      const commStr = String(o.comercio || '').toLowerCase();

      let matched = false;
      if (criterion === 'order_num') {
        matched = extStr.includes(qLower) || (codeParts.alnumLower && extAlnum.includes(codeParts.alnumLower)) || trkStr.includes(qLower);
      } else if (criterion === 'tracking') {
        matched = trkStr.includes(qLower) || (codeParts.alnumLower && extAlnum.includes(codeParts.alnumLower));
      } else if (criterion === 'customer') {
        matched = custStr.includes(qLower);
      } else if (criterion === 'contact') {
        matched = emailStr.includes(qLower) || phoneStr.includes(qLower);
      } else if (criterion === 'location') {
        matched = cityStr.includes(qLower) || addrStr.includes(qLower);
      } else if (criterion === 'sku') {
        matched = skuStr.includes(qLower) || itemStr.includes(qLower);
      } else if (criterion === 'commerce') {
        matched = commStr.includes(qLower);
      } else {
        matched =
          extStr.includes(qLower) ||
          (codeParts.alnumLower && extAlnum.includes(codeParts.alnumLower)) ||
          trkStr.includes(qLower) ||
          custStr.includes(qLower) ||
          emailStr.includes(qLower) ||
          phoneStr.includes(qLower) ||
          cityStr.includes(qLower) ||
          skuStr.includes(qLower) ||
          commStr.includes(qLower);
      }
      if (matched) {
        localMatches.push(o);
        if (localMatches.length >= 25) break;
      }
    }
    addRows(localMatches);
  }

  // Si solo se filtró por estado sin texto de búsqueda
  if (cleanQ.length < 2 && statusFilter) {
    try {
      const { data } = await applyBaseFilters(supabase.from('orders').select(selectCols)).limit(20);
      addRows(data);
    } catch (e) {}
    return Array.from(resultsMap.values()).slice(0, 8);
  }

  // --------------------------------------------------------------------------
  // NIVEL 1: Búsqueda Indexada B-Tree en `orders` (~180ms, sin ILIKE full-scan)
  // --------------------------------------------------------------------------
  const tier1Tasks = [];

  // 1A. Coincidencia por Comercio (usa índice idx_orders_comercio_periodo)
  if ((criterion === 'commerce' || criterion === 'all') && isAdmin) {
    const matchedComms = allCommerces.filter(c => c.toLowerCase().includes(qLower));
    if (matchedComms.length > 0 && (criterion === 'commerce' || qLower.length >= 4)) {
      tier1Tasks.push((async () => {
        try {
          const { data } = await applyBaseFilters(
            supabase.from('orders').select(selectCols).in('comercio', matchedComms)
          ).limit(18);
          addRows(data);
        } catch (e) {}
      })());
    }
  }

  // 1B. Coincidencia B-Tree por N° Pedido / Tracking / UUID (usa idx_orders_external_order_number y idx_orders_tracking_number)
  if (criterion === 'order_num' || criterion === 'tracking' || criterion === 'all') {
    const looksLikeCodeOrNumber = !/\s/.test(cleanNoHash) && (/\d/.test(cleanNoHash) || cleanNoHash.length <= 14);
    if (looksLikeCodeOrNumber || criterion === 'order_num' || criterion === 'tracking') {
      tier1Tasks.push((async () => {
        try {
          const variants = buildOrderReferenceVariants(cleanQ, allSiglas);
          const orParts = [];
          if (isUuid(cleanQ)) orParts.push(`id.eq.${cleanQ}`);
          if (criterion !== 'tracking' && variants.extList.length > 0) {
            const csvExt = variants.extList.slice(0, 260).map(x => `"${x.replace(/"/g, '')}"`).join(',');
            orParts.push(`external_order_number.in.(${csvExt})`);
          }
          if (variants.trkList.length > 0) {
            const csvTrk = variants.trkList.slice(0, 30).map(x => `"${x.replace(/"/g, '')}"`).join(',');
            orParts.push(`tracking_number.in.(${csvTrk})`);
            if (criterion === 'tracking' && variants.extList.length > 0) {
              const csvExt = variants.extList.slice(0, 120).map(x => `"${x.replace(/"/g, '')}"`).join(',');
              orParts.push(`external_order_number.in.(${csvExt})`);
            }
          }
          variants.prefixRanges.slice(0, 8).forEach(pr => {
            if (criterion === 'tracking' && pr.col !== 'tracking_number') return;
            orParts.push(`and(${pr.col}.gte."${pr.prefix}",${pr.col}.lte."${pr.prefix}\uffff")`);
          });

          if (orParts.length > 0) {
            const { data } = await applyBaseFilters(
              supabase.from('orders').select(selectCols).or(Array.from(new Set(orParts)).join(','))
            ).limit(25);
            addRows(data);
          }

          // Si el usuario escribió una sigla + número (ej. GLS28107) y el comercio guarda solo el número (28107)
          if (codeParts.hasPrefix && codeParts.numPart.length >= 3) {
            const targetComms = Array.from(siglaMaps.siglaToCommerces.get(codeParts.prefix) || []);
            if (targetComms.length > 0) {
              const numVariants = [
                codeParts.numPart,
                `#${codeParts.numPart}`,
                `${codeParts.prefix}${codeParts.numPart}`,
                `${codeParts.prefix}#${codeParts.numPart}`,
                `${codeParts.prefix}-${codeParts.numPart}`,
                `#${codeParts.prefix}-${codeParts.numPart}`
              ];
              const { data: byCommNum } = await applyBaseFilters(
                supabase
                  .from('orders')
                  .select(selectCols)
                  .in('comercio', targetComms)
                  .in('external_order_number', numVariants)
              ).limit(15);
              addRows(byCommNum);
            }
          }
        } catch (e) {}
      })());
    }
  }

  if (tier1Tasks.length > 0) {
    await Promise.all(tier1Tasks);
  }

  // --------------------------------------------------------------------------
  // NIVEL 2: Búsqueda por SKU / Producto -> Comercio indexado o ID de pedido
  // --------------------------------------------------------------------------
  if ((criterion === 'sku' || (criterion === 'all' && resultsMap.size === 0)) && cleanQ.length >= 2) {
    try {
      let prodQuery = supabase
        .from('products')
        .select('id, sku, name, comercio')
        .or(`sku.ilike.%${cleanQ}%,name.ilike.%${cleanQ}%,barcode.ilike.%${cleanQ}%`)
        .limit(25);
      if (!isAdmin && allowedCommerces.length > 0) {
        prodQuery = prodQuery.in('comercio', allowedCommerces);
      }
      const { data: prods } = await prodQuery;
      if (prods && prods.length > 0) {
        const prodComms = Array.from(new Set(prods.map(p => String(p.comercio || '').trim()).filter(Boolean)));
        if (prodComms.length > 0) {
          const { data: ordByCommSku } = await applyBaseFilters(
            supabase
              .from('orders')
              .select(selectCols)
              .in('comercio', prodComms)
              .or(`sku.ilike.%${cleanQ}%,item.ilike.%${cleanQ}%`)
          ).limit(20);
          addRows(ordByCommSku);
        }
        if (resultsMap.size === 0) {
          const pIds = prods.map(p => p.id);
          const { data: oItems } = await supabase
            .from('order_items')
            .select('order_id')
            .in('product_id', pIds)
            .limit(30);
          const oIds = Array.from(new Set((oItems || []).map(oi => oi.order_id).filter(Boolean)));
          if (oIds.length > 0) {
            const { data: ordByIds } = await applyBaseFilters(
              supabase.from('orders').select(selectCols).in('id', oIds.slice(0, 25))
            ).limit(20);
            addRows(ordByIds);
          }
        }
      }
    } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // NIVEL 3: Búsqueda de Destinatario / Contacto / Comuna / Tracking vía `envios_unificados`
  // y resolución B-Tree en `orders` (~1.2s total sin timeout)
  // --------------------------------------------------------------------------
  if (
    criterion === 'customer' ||
    criterion === 'contact' ||
    criterion === 'location' ||
    (resultsMap.size === 0 && (criterion === 'all' || criterion === 'tracking' || criterion === 'order_num'))
  ) {
    try {
      let euOr = '';
      if (criterion === 'customer') {
        euOr = `nombre_destinatario.ilike.%${cleanQ}%`;
      } else if (criterion === 'contact') {
        euOr = `email_cliente_destino.ilike.%${cleanQ}%,telefono_destino.ilike.%${cleanQ}%`;
      } else if (criterion === 'location') {
        euOr = `comuna_destino.ilike.%${cleanQ}%,direccion_destino.ilike.%${cleanQ}%`;
      } else if (criterion === 'tracking' || criterion === 'order_num') {
        euOr = `tracking.ilike.%${cleanQ}%,pedido_referencia.ilike.%${cleanNoHash}%`;
      } else {
        if (cleanQ.includes('@')) {
          euOr = `email_cliente_destino.ilike.%${cleanQ}%`;
        } else if (/\s/.test(cleanQ) || /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/.test(cleanQ)) {
          euOr = `nombre_destinatario.ilike.%${cleanQ}%,comuna_destino.ilike.%${cleanQ}%,direccion_destino.ilike.%${cleanQ}%`;
        } else {
          euOr = `tracking.ilike.%${cleanQ}%,pedido_referencia.ilike.%${cleanNoHash}%,telefono_destino.ilike.%${cleanQ}%,nombre_destinatario.ilike.%${cleanQ}%`;
        }
      }

      if (euOr) {
        const { data: ships } = await supabase
          .from('envios_unificados')
          .select('pedido_referencia, tracking')
          .or(euOr)
          .limit(25);
        if (ships && ships.length > 0) {
          const refSet = new Set();
          const trkSet = new Set();
          ships.forEach(s => {
            if (s.pedido_referencia) {
              const v = buildOrderReferenceVariants(s.pedido_referencia, allSiglas);
              v.extList.forEach(x => refSet.add(x));
            }
            if (s.tracking) {
              trkSet.add(String(s.tracking).trim());
            }
          });
          const euOrParts = [];
          const refArr = Array.from(refSet).slice(0, 200);
          const trkArr = Array.from(trkSet).slice(0, 30);
          if (refArr.length > 0) {
            const csvRefs = refArr.map(x => `"${x.replace(/"/g, '')}"`).join(',');
            euOrParts.push(`external_order_number.in.(${csvRefs})`);
          }
          if (trkArr.length > 0) {
            const csvTrks = trkArr.map(x => `"${x.replace(/"/g, '')}"`).join(',');
            euOrParts.push(`tracking_number.in.(${csvTrks})`);
          }
          if (euOrParts.length > 0) {
            const { data: ordByEu } = await applyBaseFilters(
              supabase.from('orders').select(selectCols).or(euOrParts.join(','))
            ).limit(20);
            addRows(ordByEu);
          }
        }
      }
    } catch (e) {}
  }

  let list = Array.from(resultsMap.values());
  const targetCommercesForPrefix = codeParts.hasPrefix
    ? (siglaMaps.siglaToCommerces.get(codeParts.prefix) || new Set())
    : new Set();

  const getOrderMatchScore = (ord) => {
    const extRaw = String(ord.external_order_number || '').trim();
    const extNoHash = extRaw.replace(/^#+/, '').trim().toLowerCase();
    const extAlnum = extRaw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const trkAlnum = String(ord.tracking_number || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const commUpper = String(ord.comercio || '').trim().toUpperCase();
    const commSigla = siglaMaps.commerceToSigla.get(commUpper) || '';
    const compositeCode = (commSigla && extAlnum && !extAlnum.startsWith(commSigla.toLowerCase()))
      ? `${commSigla.toLowerCase()}${extAlnum}`
      : extAlnum;

    if (extNoHash === qLower || extAlnum === codeParts.alnumLower || trkAlnum === codeParts.alnumLower || compositeCode === codeParts.alnumLower) {
      return 100;
    }
    if (codeParts.hasPrefix) {
      const isPrefixCommerce = targetCommercesForPrefix.has(commUpper) || commUpper.includes(codeParts.prefix);
      if (extAlnum.includes(codeParts.alnumLower) || trkAlnum.includes(codeParts.alnumLower)) {
        return 90;
      }
      if (isPrefixCommerce && extAlnum.includes(codeParts.numLower)) {
        return 85;
      }
      if (targetCommercesForPrefix.size > 0 && !isPrefixCommerce && (criterion === 'order_num' || criterion === 'tracking')) {
        return -1;
      }
    }
    const strippedPrefixNum = extRaw.replace(/^[A-Za-z]{2,6}[-_\s#]+/, '').replace(/^#+/, '').toLowerCase();
    if (strippedPrefixNum === qLower) {
      return 80;
    }
    return 10;
  };

  if (codeParts.hasPrefix && (criterion === 'order_num' || criterion === 'tracking')) {
    const filtered = list.filter(ord => getOrderMatchScore(ord) >= 0);
    if (filtered.length > 0 || targetCommercesForPrefix.size > 0) {
      list = filtered;
    }
  }

  list.sort((a, b) => {
    const scoreA = getOrderMatchScore(a);
    const scoreB = getOrderMatchScore(b);
    if (scoreA !== scoreB) return scoreB - scoreA;
    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tB - tA;
  });

  return list.slice(0, 8);
}

function attachMultiCriteriaOrderSearch({ dropdownId, inputId, resultsId, isAdmin }) {
  const dropdown = document.getElementById(dropdownId);
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!dropdown || !input || !results) return;
  if (dropdown.dataset.orderSearchEnhanced === 'true') return;
  dropdown.dataset.orderSearchEnhanced = 'true';

  const criteriaList = isAdmin ? ORDER_SEARCH_CRITERIA_ADMIN : ORDER_SEARCH_CRITERIA_CLIENT;
  let activeCriterion = 'all';
  let activeStatus = '';
  let activeDateRange = 'all';
  let debounceTimer = null;
  let searchSeq = 0;

  const inputWrap = dropdown.querySelector('.admin-cmd-input-wrap');
  const criteriaBar = document.createElement('div');
  criteriaBar.className = 'cmd-criteria-bar';
  criteriaBar.innerHTML = `
    <div class="cmd-criteria-chips-row" role="tablist" aria-label="Criterios de búsqueda de pedido">
      <span style="font-size: 0.68rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; margin-right: 0.15rem; display: inline-flex; align-items: center; gap: 0.2rem;">
        <i class="ri-filter-3-line"></i> Criterio:
      </span>
      ${criteriaList.map(c => `
        <button type="button" class="cmd-criterion-chip ${c.id === 'all' ? 'active' : ''}" data-criterion="${c.id}" title="${escapeHtmlSafe(c.placeholder)}">
          <i class="${c.icon}"></i>
          <span>${escapeHtmlSafe(c.label)}</span>
        </button>
      `).join('')}
    </div>
    <div class="cmd-criteria-filters-row">
      <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
        <select class="cmd-criteria-select" data-cmd-filter="status" title="Filtrar por estado del pedido">
          <option value="">Estado: Todos</option>
          <option value="En procesamiento">En procesamiento</option>
          <option value="En preparación">En preparación</option>
          <option value="Pickeado">Pickeado / Preparado</option>
          <option value="Despachado">Despachado</option>
          <option value="Incidencia">Con Incidencia</option>
          <option value="Cancelado">Cancelado</option>
        </select>
        <select class="cmd-criteria-select" data-cmd-filter="daterange" title="Rango de antigüedad de la búsqueda">
          <option value="all">Histórico Completo (Sin límite)</option>
          <option value="7d">Últimos 7 días</option>
          <option value="30d">Últimos 30 días</option>
          <option value="90d">Últimos 90 días</option>
          <option value="365d">Último año</option>
        </select>
      </div>
      <span style="font-size: 0.68rem; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.25rem; white-space: nowrap; flex-shrink: 0;">
        <i class="ri-external-link-line cmd-mono-icon" style="margin-right: 0;"></i> Abre Página de Pedido en nueva pestaña
      </span>
    </div>
  `;

  if (inputWrap && inputWrap.nextSibling) {
    dropdown.insertBefore(criteriaBar, inputWrap.nextSibling);
  } else {
    dropdown.prepend(criteriaBar);
  }

  const ensureLiveContainer = () => {
    let box = results.querySelector('.cmd-live-orders-section');
    if (!box) {
      box = document.createElement('div');
      box.className = 'cmd-live-orders-section';
      results.prepend(box);
    }
    return box;
  };

  const triggerLiveOrderSearch = () => {
    const q = input.value.trim();
    if (q.length < 2 && !activeStatus) {
      const existing = results.querySelector('.cmd-live-orders-section');
      if (existing) existing.remove();
      return;
    }

    const liveBox = ensureLiveContainer();
    const criterionObj = criteriaList.find(c => c.id === activeCriterion) || criteriaList[0];
    liveBox.innerHTML = `
      <div class="cmd-group-label" style="display: flex; align-items: center; justify-content: space-between;">
        <span><i class="ri-compass-discover-line"></i> Pedidos Directos (${escapeHtmlSafe(criterionObj.label)})</span>
        <span style="font-size: 0.68rem; color: var(--color-primary); font-weight: 600;">
          <i class="ri-loader-4-line ri-spin"></i> Buscando en base de datos...
        </span>
      </div>
    `;

    if (debounceTimer) clearTimeout(debounceTimer);
    const currentSeq = ++searchSeq;

    debounceTimer = setTimeout(async () => {
      const orders = await queryOrdersMultiCriteria({
        query: q,
        criterion: activeCriterion,
        statusFilter: activeStatus,
        dateRangeFilter: activeDateRange,
        isAdmin
      });

      if (currentSeq !== searchSeq) return;
      const boxNow = ensureLiveContainer();

      if (!orders || orders.length === 0) {
        boxNow.innerHTML = `
          <div class="cmd-group-label" style="display: flex; align-items: center; justify-content: space-between;">
            <span>Pedidos en Histórico (${escapeHtmlSafe(criterionObj.label)})</span>
            <span style="font-size: 0.68rem; color: var(--color-text-muted);">0 coincidencias</span>
          </div>
          <div style="padding: 0.65rem 0.85rem; font-size: 0.76rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border);">
            No se encontraron pedidos con <strong>"${escapeHtmlSafe(q)}"</strong> bajo el criterio <strong>${escapeHtmlSafe(criterionObj.label)}</strong>${activeStatus ? ` y estado <strong>${escapeHtmlSafe(activeStatus)}</strong>` : ''}.
          </div>
        `;
        return;
      }

      let itemsHtml = `
        <div class="cmd-group-label" style="display: flex; align-items: center; justify-content: space-between;">
          <span>Pedidos Encontrados · Clic o Enter para abrir Página del Pedido</span>
          <span style="font-size: 0.68rem; color: var(--color-primary); font-weight: 700;">${orders.length} resultado${orders.length === 1 ? '' : 's'}</span>
        </div>
      `;

      orders.forEach(ord => {
        const stStyle = getWmsStatusStyle(ord);
        const orderNum = ord.external_order_number || ord.id.slice(0, 8);
        const displayNum = String(orderNum).startsWith('#') ? orderNum : `#${orderNum}`;
        const dateStr = ord.created_at ? new Date(ord.created_at).toLocaleDateString('es-CL') : '-';
        const customer = ord.customer_name || 'Sin nombre';
        const comuna = ord.shipping_city || 'Sin comuna';
        const platform = ord.origen || ord.external_platform || 'Manual';
        const trackingHtml = ord.tracking_number ? ` · <i class="ri-barcode-line cmd-mono-icon"></i> Guía: ${escapeHtmlSafe(ord.tracking_number)}` : '';
        const courier = ord.courier || ord.operador || '';
        const totalStr = ord.total_value ? ` · ${formatClpSafe(ord.total_value)}` : '';

        itemsHtml += `
          <div role="button" tabindex="0" class="cmd-result-item cmd-order-live-item" data-live-order-id="${escapeHtmlSafe(ord.id)}">
            <span class="cmd-result-left" style="min-width: 0; flex: 1; gap: 0.75rem;">
              <span class="cmd-result-icon" style="width: 34px; height: 34px; border-radius: 9px; font-size: 1.05rem; background: ${stStyle.bg}; color: ${stStyle.color}; border: 1px solid ${stStyle.border}; flex-shrink: 0;">
                <i class="${stStyle.icon}"></i>
              </span>
              <span class="cmd-result-text" style="min-width: 0; flex: 1; gap: 0.18rem;">
                <span class="cmd-result-title" style="display: flex; align-items: center; gap: 0.42rem; flex-wrap: wrap;">
                  <strong style="font-family: monospace; font-size: 0.9rem; color: var(--color-primary);">${escapeHtmlSafe(displayNum)}</strong>
                  ${isAdmin && ord.comercio ? `<span style="font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.45rem; border-radius: 5px; background: rgba(148, 163, 184, 0.14); border: 1px solid rgba(148, 163, 184, 0.25); color: var(--color-text-main);">${escapeHtmlSafe(ord.comercio)}</span>` : ''}
                  <span style="font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.48rem; border-radius: 999px; background: ${stStyle.bg}; color: ${stStyle.color}; border: 1px solid ${stStyle.border};">${escapeHtmlSafe(stStyle.label)}</span>
                  <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">${escapeHtmlSafe(platform)} · <i class="ri-calendar-line cmd-mono-icon"></i>${escapeHtmlSafe(dateStr)}</span>
                  ${ord.total_value ? `<span style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-main);">${formatClpSafe(ord.total_value)}</span>` : ''}
                </span>
                <span class="cmd-result-sub" style="display: block; font-size: 0.74rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  <i class="ri-user-3-line cmd-mono-icon"></i><strong>${escapeHtmlSafe(customer)}</strong> · <i class="ri-map-pin-2-line cmd-mono-icon"></i>${escapeHtmlSafe(comuna)}${courier ? ` · <i class="ri-truck-line cmd-mono-icon"></i>${escapeHtmlSafe(courier)}` : ''}${trackingHtml}
                </span>
              </span>
            </span>
            <span class="cmd-order-actions-col">
              <span class="cmd-order-btn-here" data-open-mode="here" data-order-id="${escapeHtmlSafe(ord.id)}" title="Abrir Página del Pedido en esta misma pestaña">
                Abrir aquí
              </span>
              <span class="cmd-order-btn-newtab" data-open-mode="newtab" data-order-id="${escapeHtmlSafe(ord.id)}" title="Abrir Página del Pedido en una nueva pestaña (Enter)">
                Nueva pestaña <i class="ri-external-link-line"></i>
              </span>
            </span>
          </div>
        `;
      });

      boxNow.innerHTML = itemsHtml;

      const allItems = results.querySelectorAll('.cmd-result-item');
      allItems.forEach((el, idx) => el.classList.toggle('is-selected', idx === 0));
    }, 150);
  };

  criteriaBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.cmd-criterion-chip');
    if (!chip) return;
    e.stopPropagation();
    activeCriterion = chip.getAttribute('data-criterion') || 'all';
    criteriaBar.querySelectorAll('.cmd-criterion-chip').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-criterion') === activeCriterion);
    });
    const found = criteriaList.find(c => c.id === activeCriterion);
    if (found) input.placeholder = found.placeholder;
    input.focus();
    triggerLiveOrderSearch();
  });

  criteriaBar.querySelectorAll('.cmd-criteria-select').forEach(sel => {
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const filterType = sel.getAttribute('data-cmd-filter');
      if (filterType === 'status') activeStatus = sel.value;
      else if (filterType === 'daterange') activeDateRange = sel.value;
      input.focus();
      triggerLiveOrderSearch();
    });
  });

  input.addEventListener('input', () => {
    triggerLiveOrderSearch();
  });

  results.addEventListener('click', (e) => {
    const orderItem = e.target.closest('.cmd-order-live-item');
    if (!orderItem) return;

    const orderId = orderItem.getAttribute('data-live-order-id');
    if (!orderId) return;

    const modeBtn = e.target.closest('[data-open-mode]');
    const openMode = modeBtn ? modeBtn.getAttribute('data-open-mode') : 'newtab';

    dropdown.style.display = 'none';
    const container = dropdown.closest('.admin-cmd-container');
    if (container) container.classList.remove('cmd-open');
    document.getElementById('cmd-glass-backdrop')?.classList.remove('active');

    if (openMode === 'here') {
      e.stopPropagation();
      e.preventDefault();
      window.openSingleOrderHere(orderId, isAdmin);
    } else {
      e.stopPropagation();
      e.preventDefault();
      window.openOrderInNewTab(orderId, isAdmin);
    }
  }, true);
}

// ============================================================================
// 2. HELPERS PARA TRAZABILIDAD PICKER Y STEPPER DE ETAPAS DEL PEDIDO
// ============================================================================
function buildPickerQueryKeys(orderData) {
  const keys = new Set();
  const addVariants = (raw) => {
    if (!raw) return;
    const str = String(raw).trim();
    if (!str) return;
    const noHash = str.replace(/^#/, '').trim();
    keys.add(str);
    keys.add(noHash);
    keys.add('#' + noHash);
    keys.add(str.toUpperCase());
    keys.add(noHash.toUpperCase());
    keys.add(('#' + noHash).toUpperCase());
    // Si tiene prefijo compuesto como SFP#3850, añadir también #3850 y 3850
    const hashParts = noHash.split('#');
    if (hashParts.length > 1) {
      const tail = hashParts[hashParts.length - 1].trim();
      if (tail && tail.length >= 3) {
        keys.add(tail);
        keys.add('#' + tail);
      }
    }
  };
  addVariants(orderData?.external_order_number);
  addVariants(orderData?.id);
  return Array.from(keys);
}

function parseScannedItemsMap(historyLogs) {
  const map = {};
  if (!Array.isArray(historyLogs)) return map;
  historyLogs.forEach(log => {
    const summary = String(log?.items_summary || '').trim();
    if (!summary || summary === '-') return;
    summary.split(',').forEach(part => {
      const clean = part.trim();
      const m = clean.match(/^(.+?)\s*\((\d+)\/(\d+)\)$/);
      if (m) {
        const skuKey = m[1].trim().toUpperCase();
        if (!map[skuKey]) {
          map[skuKey] = { scanned: Number(m[2]), total: Number(m[3]), raw: clean };
        }
      }
    });
  });
  return map;
}

/**
 * Resuelve de forma integral el estado real del courier / Auto-Track,
 * homologando LightData (ALPHA con extracción de raw_data[23] cuando status es coordenada GPS o DESPACHADO),
 * Envíame, Blue Express, Starken, Optiroute (STOCKA X), Marketplaces (Mercado Libre, Falabella, Paris, Ripley, Walmart),
 * Fulfillments de Shopify y Retiros en Tienda (store_pickups).
 */
function resolveOrderCourierTracking(orderData, rawShipments, directLdRows, storePickupRows, pickerData) {
  const effCat = typeof window.getOrderEffectiveCategoriaEntrega === 'function'
    ? window.getOrderEffectiveCategoriaEntrega(orderData)
    : String(orderData?.categoria_entrega || 'DISTRIBUCIÓN').toUpperCase().trim();
  const isRetiroOrder = effCat === 'RETIRO';

  // Caso 1: Pedido de Retiro en Sucursal
  if (isRetiroOrder) {
    const pickupRow = (storePickupRows || [])[0] || null;
    const pickupDelivered = (pickupRow && String(pickupRow.estado_pedido || '').trim().toUpperCase() === 'ENTREGADO')
      || ['RETIRADO', 'ENTREGADO'].includes(String(pickerData?.status || '').trim().toUpperCase())
      || ['entregado', 'retirado'].includes(String(orderData?.status || '').toLowerCase().trim());

    const globSt = pickupDelivered ? 'ENTREGADO' : (pickerData?.isCompleted ? 'LISTO PARA RETIRO' : 'EN SUCURSAL');
    return {
      isRetiro: true,
      hasTracking: false,
      shipment: null,
      effectiveCourier: 'Retiro en Sucursal',
      effectiveTracking: pickupRow?.pin_retiro ? `PIN: ${pickupRow.pin_retiro}` : '',
      effectiveTrackingUrl: '',
      globalStatus: globSt,
      rawStatusText: pickupDelivered ? 'Retirado por cliente en sucursal' : (pickupRow?.estado_pedido || pickerData?.status || 'Pendiente de retiro'),
      isDelivered: pickupDelivered,
      isInTransit: false,
      isAlert: false,
      isReturned: false,
      sourceTable: 'store_pickups',
      updatedAt: pickupRow?.updated_at || orderData?.stock_descontado_at || null
    };
  }

  // Enriquecer o fusionar filas directas de lightdata_envios con envios_unificados
  const mergedShipments = Array.isArray(rawShipments) ? [...rawShipments] : [];
  if (Array.isArray(directLdRows) && directLdRows.length > 0) {
    directLdRows.forEach(ld => {
      if (!ld || !ld.id) return;
      const unifiedId = `lightdata_envios:${ld.id}`;
      const existing = mergedShipments.find(s => s.id === unifiedId || String(s.source_id) === String(ld.id));
      if (existing) {
        if (!existing.raw_data && ld.raw_data) existing.raw_data = ld.raw_data;
        if (ld.status && (!existing.status || /^-?\d+\.\d+$/.test(String(existing.status).trim()))) {
          existing.status = ld.status;
        }
      } else {
        mergedShipments.push({
          id: unifiedId,
          source_table: 'lightdata_envios',
          source_id: String(ld.id),
          pedido_referencia: ld.tracking || orderData.external_order_number || String(ld.id),
          tracking: ld.tracking || String(ld.id),
          tracking_url: ld.tracking_url || (ld.raw_data && ld.raw_data[31]) || `https://alphagroup.lightdata.com.ar/tracking.php?token=${ld.id}d54df4s8a88`,
          courier: ld.courier || 'ALPHA',
          status: ld.status || (ld.raw_data && ld.raw_data[23]) || 'En tránsito',
          global_status: null,
          comuna_destino: ld.comuna_destino || orderData.shipping_city,
          empresa_comercio_proveedor: ld.comercio || ld.empresa_comercio || orderData.comercio,
          created_at: ld.fecha_creacion_lightdata || ld.created_at,
          updated_at: ld.fecha_actualizacion_lightdata || ld.updated_at || ld.created_at,
          raw_data: ld.raw_data || null
        });
      }
    });
  }

  // Función interna para extraer el texto de estado real de un envío y clasificar su global_status
  const evaluateSingleShipment = (s) => {
    if (!s) return { globStatus: 'SIN MOVIMIENTO', statusText: '' };
    let gStatus = String(s.global_status || '').trim().toUpperCase();
    let statusText = String(s.status || '').trim();

    // En LightData (ALPHA), s.status suele venir con latitud GPS (-33.xxxx) o "A retirar" mientras raw_data[23] tiene el estado real ("Entregado", "En Camino", etc.)
    if (s.source_table === 'lightdata_envios') {
      const raw23 = (s.raw_data && s.raw_data[23])
        ? String(s.raw_data[23]).trim()
        : ((orderData.raw_lightdata_data?.raw_data && orderData.raw_lightdata_data.raw_data[23])
            ? String(orderData.raw_lightdata_data.raw_data[23]).trim()
            : '');
      const ldOrderStatus = String(orderData.lightdata_status || orderData.raw_lightdata_data?.status || '').trim();

      if (/^-?\d+\.\d+$/.test(statusText) || !statusText) {
        statusText = (raw23 && !/^-?\d+\.\d+$/.test(raw23))
          ? raw23
          : ((ldOrderStatus && !/^-?\d+\.\d+$/.test(ldOrderStatus)) ? ldOrderStatus : statusText);
      } else if (raw23 && !/^-?\d+\.\d+$/.test(raw23)) {
        const r23Low = raw23.toLowerCase();
        if (r23Low.includes('entregad') || r23Low.includes('delivered') || r23Low.includes('camino') || r23Low.includes('reparto') || r23Low.includes('planta')) {
          statusText = raw23;
        }
      }
    } else if (s.source_table === 'enviame_shipments' && s.raw_data) {
      const nestedSt = s.raw_data.status?.name || s.raw_data.status?.code || s.raw_data.tracking_status || '';
      if (nestedSt && (!statusText || statusText.toLowerCase() === 'despachado')) {
        statusText = String(nestedSt).trim();
      }
    }

    if (s.source_table === 'optiroute_orders' && ['skipped', 'reviewing', 'scheduled'].includes(statusText.toLowerCase())) {
      gStatus = 'SIN MOVIMIENTO';
    }

    const rawLow = statusText.toLowerCase().trim();

    if (rawLow.includes('devolucion') || rawLow.includes('devolución') || rawLow === 'devuelto' || rawLow.includes('returned')) {
      gStatus = 'DEVOLUCIÓN';
    } else if (rawLow.includes('rechazado por courier')) {
      gStatus = 'SIN MOVIMIENTO';
    } else if (
      rawLow.includes('entregad') ||
      rawLow.includes('delivered') ||
      rawLow.includes('entrega exitosa') ||
      rawLow.includes('recibido conforme') ||
      rawLow === 'retirado'
    ) {
      gStatus = 'ENTREGADO';
    } else if (
      rawLow.includes('requiere solucion') ||
      rawLow.includes('requiere solución') ||
      rawLow.includes('pendiente - requiere') ||
      rawLow.includes('retenid') ||
      rawLow.includes('excepcion') ||
      rawLow.includes('excepción') ||
      rawLow.includes('siniestr') ||
      rawLow.includes('fallid') ||
      rawLow.includes('no entregad') ||
      (rawLow.includes('rechazad') && !rawLow.includes('rechazado por courier'))
    ) {
      gStatus = 'ALERTA';
    } else if (!gStatus || gStatus === 'SIN MOVIMIENTO' || gStatus === 'DESPACHADO') {
      if (s.source_table === 'lightdata_envios') {
        if (rawLow.includes('entregad') || rawLow.includes('delivered')) {
          gStatus = 'ENTREGADO';
        } else if (
          rawLow.includes('camino') || rawLow.includes('planta') || rawLow.includes('recepcionado') ||
          rawLow.includes('procesamiento') || rawLow.includes('clasificado') || rawLow.includes('nadie') ||
          rawLow.includes('reparto') || rawLow.includes('tránsito') || rawLow.includes('transito') ||
          rawLow.includes('ruta') || /^-?\d+\.\d+$/.test(rawLow)
        ) {
          gStatus = 'EN TRÁNSITO';
        } else if (rawLow === 'cancelado' || rawLow.includes('no entregad')) {
          gStatus = 'ALERTA';
        } else if (rawLow === 'no retirado' || rawLow === 'a retirar') {
          gStatus = 'SIN MOVIMIENTO';
        }
      } else if (s.source_table === 'bluex_envios') {
        if (rawLow.includes('delivered') || rawLow.includes('entregad')) {
          gStatus = 'ENTREGADO';
        } else if (rawLow.includes('transit') || rawLow.includes('delivery') || rawLow.includes('camino') || rawLow.includes('reparto') || rawLow.includes('ruta') || rawLow.includes('pickup') || rawLow.includes('admitid') || rawLow.includes('disponible para retiro')) {
          gStatus = 'EN TRÁNSITO';
        } else if (rawLow.includes('cancel') || rawLow.includes('fail') || rawLow.includes('fallid') || rawLow.includes('retenid')) {
          gStatus = 'ALERTA';
        } else if (rawLow.includes('preparation') || rawLow.includes('cread') || rawLow.includes('emitid')) {
          gStatus = 'SIN MOVIMIENTO';
        }
      } else if (s.source_table === 'starken_envios') {
        if (rawLow.includes('entregad') || rawLow.includes('delivered')) {
          gStatus = 'ENTREGADO';
        } else if (rawLow.includes('transit') || rawLow.includes('destino') || rawLow.includes('reparto') || rawLow.includes('redestin') || rawLow.includes('ruta') || rawLow.includes('camino') || rawLow.includes('disponible para retiro')) {
          gStatus = 'EN TRÁNSITO';
        } else if (rawLow.includes('excepcion') || rawLow.includes('cancel') || rawLow.includes('fail') || rawLow.includes('siniestro') || rawLow.includes('retenid')) {
          gStatus = 'ALERTA';
        } else if (rawLow.includes('origen') || rawLow.includes('cread') || rawLow.includes('emis')) {
          gStatus = 'SIN MOVIMIENTO';
        }
      } else if (s.source_table === 'optiroute_orders') {
        if (rawLow.includes('deliver') || rawLow.includes('entregad')) {
          gStatus = 'ENTREGADO';
        } else if (['skipped', 'reviewing', 'scheduled'].includes(rawLow)) {
          gStatus = 'SIN MOVIMIENTO';
        } else if (rawLow.includes('route') || rawLow.includes('ruta') || rawLow.includes('camino') || ['onroute', 'ongoing', 'arrived'].includes(rawLow)) {
          gStatus = 'EN TRÁNSITO';
        } else if (rawLow.includes('cancel') || rawLow.includes('elimin') || rawLow.includes('delet')) {
          gStatus = 'ALERTA';
        }
      } else if (s.source_table === 'enviame_shipments') {
        if (rawLow.includes('reparto') || rawLow.includes('tránsito') || rawLow.includes('transito') || rawLow.includes('planta') || rawLow.includes('ruta') || rawLow.includes('camino') || rawLow.includes('admitid') || rawLow.includes('disponible para retiro') || rawLow.includes('cambio de direcci') || rawLow.includes('cambió de direcci')) {
          gStatus = 'EN TRÁNSITO';
        } else if (rawLow.includes('cread') || rawLow.includes('listo para despacho') || rawLow.includes('impres') || rawLow.includes('eliminad')) {
          gStatus = 'SIN MOVIMIENTO';
        }
      }
    }

    if (gStatus === 'DESPACHADO') {
      gStatus = (rawLow.includes('entregad') || rawLow.includes('delivered')) ? 'ENTREGADO' : 'EN TRÁNSITO';
    }
    if (!gStatus) gStatus = 'SIN MOVIMIENTO';

    const cleanDisplayStatus = (statusText && !/^-?\d+\.\d+$/.test(statusText))
      ? statusText
      : (gStatus === 'ENTREGADO' ? 'Entregado' : (gStatus === 'EN TRÁNSITO' ? 'En tránsito' : statusText));

    return { globStatus: gStatus, statusText: cleanDisplayStatus };
  };

  // Filtrar operadores ignorados
  let validShipments = mergedShipments.filter(s => {
    const cUp = String(s.courier || '').toUpperCase().trim();
    if (cUp.includes('RECIBELO') || cUp.includes('RECÍBELO') || cUp.includes('WELIVERY') || cUp.includes('WOODELIVERY') || cUp.includes('WODELY')) {
      return false;
    }
    return true;
  });

  // Fallback si no hay filas en envios_unificados pero el pedido tiene raw_lightdata_data o lightdata_status
  const hasRealLd = Boolean(
    (orderData.raw_lightdata_data && typeof orderData.raw_lightdata_data === 'object' && Object.keys(orderData.raw_lightdata_data).length > 0) ||
    orderData.lightdata_status
  );
  if (validShipments.length === 0 && hasRealLd) {
    const ldRaw = orderData.raw_lightdata_data || {};
    const effDid = String(ldRaw.did || ldRaw.id || orderData.tracking_number || '').trim();
    if (effDid && effDid !== 'null' && effDid !== 'undefined') {
      validShipments.push({
        id: `lightdata_envios:${effDid}`,
        source_table: 'lightdata_envios',
        source_id: effDid,
        tracking: ldRaw.tracking || orderData.tracking_number || effDid,
        pedido_referencia: orderData.external_order_number || effDid,
        tracking_url: (ldRaw.raw_data && ldRaw.raw_data[31]) || ldRaw.tracking_url || orderData.tracking_url || `https://alphagroup.lightdata.com.ar/tracking.php?token=${effDid}d54df4s8a88`,
        courier: 'ALPHA',
        status: (ldRaw.raw_data && ldRaw.raw_data[23]) || orderData.lightdata_status || ldRaw.status || 'En tránsito',
        global_status: null,
        created_at: ldRaw.fecha_creacion_lightdata || orderData.created_at,
        updated_at: ldRaw.fecha_actualizacion_lightdata || ldRaw.updated_at || orderData.stock_descontado_at || orderData.created_at,
        raw_data: ldRaw.raw_data || null
      });
    }
  }

  // Fallback para Marketplaces (Mercado Libre, Falabella, Paris, Ripley, Walmart) o Shopify Fulfillments
  const platStr = String(orderData.origen || orderData.external_platform || '').toLowerCase().replace(/\s+/g, '');
  const isMeli = platStr.includes('mercadolibre') || platStr.includes('meli') || Boolean(orderData.raw_meli_data);
  const isFalabella = platStr.includes('falabella') || Boolean(orderData.raw_falabella_data);
  const isParis = platStr.includes('paris') || Boolean(orderData.raw_paris_data);
  const isRipley = platStr.includes('ripley') || Boolean(orderData.raw_ripley_data);
  const isWalmart = platStr.includes('walmart') || Boolean(orderData.raw_walmart_data);
  const isVirtualMarketplace = isMeli || isFalabella || isParis || isRipley || isWalmart;

  if (validShipments.length === 0 && isVirtualMarketplace) {
    // Reutilizar window.getOrderShipmentGlobalStatus si está en Admin, o evaluar directamente
    if (typeof window.getOrderShipmentGlobalStatus === 'function') {
      delete orderData._wmsShipmentGlobalStatus;
      const adminRes = window.getOrderShipmentGlobalStatus(orderData);
      if (adminRes && adminRes.shipment) {
        validShipments.push(adminRes.shipment);
      }
    }
    if (validShipments.length === 0) {
      const rawMeli = orderData.raw_meli_data || {};
      const meliShipObj = rawMeli.shipping || rawMeli.shipment || (Array.isArray(rawMeli.orders) ? rawMeli.orders[0]?.shipping : null);
      const meliShipSt = String(rawMeli.shipping_status || meliShipObj?.status || '').toLowerCase().trim();
      const meliSubSt = String(meliShipObj?.substatus || '').toLowerCase().trim();
      const rawFal = orderData.raw_falabella_data || {};
      const falSt = String(rawFal.Statuses?.Status || rawFal.Status || rawFal.status || '').toLowerCase().trim();
      const wmsStLow = String(orderData.status || '').toLowerCase().trim();

      const isMktDelivered = meliShipSt === 'delivered' || meliSubSt === 'delivered' || Boolean(meliShipObj?.status_history?.date_delivered) || falSt === 'delivered' || wmsStLow === 'entregado' || wmsStLow === 'delivered';
      const isMktShipped = isMktDelivered || meliShipSt === 'shipped' || meliSubSt === 'in_transit' || meliSubSt === 'out_for_delivery' || falSt === 'shipped' || wmsStLow === 'despachado' || String(orderData.estado_wms || '').toLowerCase() === 'despachado';
      const mktGlob = isMktDelivered ? 'ENTREGADO' : (isMktShipped ? 'EN TRÁNSITO' : 'SIN MOVIMIENTO');
      const mktTrack = String(meliShipObj?.id || orderData.tracking_number || '').trim();
      const mktCourier = orderData.courier || (isFalabella ? 'Falabella' : (isParis ? 'Paris' : (isRipley ? 'Ripley' : (isWalmart ? 'Walmart' : 'Mercado Libre'))));

      validShipments.push({
        id: `virtual:${orderData.id}`,
        source_table: isFalabella ? 'falabella' : (isMeli ? 'mercadolibre' : 'marketplace'),
        source_id: orderData.id,
        tracking: mktTrack,
        tracking_url: orderData.tracking_url || (isMeli && mktTrack ? `https://envios.mercadolibre.cl/seguimiento/${encodeURIComponent(mktTrack)}` : ''),
        courier: mktCourier,
        status: isMktDelivered ? 'Entregado' : (isMktShipped ? 'En tránsito' : (orderData.status || 'Pendiente')),
        global_status: mktGlob,
        created_at: orderData.created_at,
        updated_at: meliShipObj?.status_history?.date_delivered || orderData.stock_descontado_at || orderData.created_at
      });
    }
  }

  // Verificar si Shopify reporta shipment_status = 'delivered' en sus fulfillments
  const shopifyFulfillments = orderData.raw_shopify_data?.fulfillments;
  const shopifyFulfillmentDelivered = Array.isArray(shopifyFulfillments) && shopifyFulfillments.some(f => String(f?.shipment_status || '').toLowerCase() === 'delivered');

  // Ordenar envíos priorizando ENTREGADO (3) > EN TRÁNSITO / ALERTA / DEVOLUCIÓN (2) > SIN MOVIMIENTO (1)
  if (validShipments.length > 1) {
    validShipments.sort((a, b) => {
      const evalA = evaluateSingleShipment(a);
      const evalB = evaluateSingleShipment(b);
      const score = (g) => (g === 'ENTREGADO' ? 3 : (['EN TRÁNSITO', 'ALERTA', 'DEVOLUCIÓN'].includes(g) ? 2 : 1));
      const diff = score(evalB.globStatus) - score(evalA.globStatus);
      if (diff !== 0) return diff;
      const tA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tB - tA;
    });
  }

  const primaryShipment = validShipments[0] || null;
  let { globStatus, statusText } = primaryShipment
    ? evaluateSingleShipment(primaryShipment)
    : { globStatus: null, statusText: '' };

  const wmsStatusLow = String(orderData.status || '').toLowerCase().trim();
  const estadoWmsLow = String(orderData.estado_wms || '').toLowerCase().trim();
  const ldStatusLow = String(orderData.lightdata_status || orderData.raw_lightdata_data?.status || orderData.raw_lightdata_data?.raw_data?.[23] || '').toLowerCase().trim();

  // Si cualquier fuente oficial del pedido confirma entrega, asegurar globStatus = 'ENTREGADO'
  if (
    wmsStatusLow === 'entregado' ||
    wmsStatusLow === 'delivered' ||
    wmsStatusLow === 'retirado' ||
    estadoWmsLow === 'entregado' ||
    ldStatusLow.includes('entregad') ||
    ldStatusLow.includes('delivered') ||
    shopifyFulfillmentDelivered
  ) {
    globStatus = 'ENTREGADO';
    if (!statusText || statusText.toLowerCase() === 'despachado') {
      statusText = 'Entregado';
    }
  } else if (!globStatus && (estadoWmsLow === 'despachado' || wmsStatusLow === 'despachado')) {
    globStatus = 'EN TRÁNSITO';
    statusText = statusText || 'Despachado en tránsito';
  }

  const rawShopify = orderData.raw_shopify_data;
  const isReturnedOrder = (orderData.status === 'cancelado' || Boolean(rawShopify?.cancelled_at)) &&
    ['Despachado', 'Pickeado', 'entregado', 'retirado'].includes(orderData.estado_wms);
  if (isReturnedOrder) {
    globStatus = 'DEVOLUCIÓN';
  }

  // Resolver nombre limpio del Courier (homologado con Torre de Control)
  const orderCourierUpper = String(orderData.courier || '').toUpperCase().trim();
  const orderOperadorUpper = String(orderData.operador || '').toUpperCase().trim();
  const isAlphaOrder = orderCourierUpper === 'LIGHTDATA' ||
    orderCourierUpper === 'PENDIENTE_LIGHTDATA' ||
    primaryShipment?.source_table === 'lightdata_envios' ||
    (orderOperadorUpper === 'ALPHA' && (hasRealLd || !primaryShipment || primaryShipment.source_table === 'lightdata_envios')) ||
    (orderCourierUpper === 'CARRIER EXTERNO' && (primaryShipment?.source_table === 'lightdata_envios' || hasRealLd));

  let effectiveCourier = 'No asignado';
  if (isAlphaOrder) {
    effectiveCourier = 'ALPHA (LightData)';
  } else if (primaryShipment?.source_table === 'optiroute_orders' && (!primaryShipment.courier || primaryShipment.courier === 'CARRIER EXTERNO')) {
    effectiveCourier = 'STOCKA X (Optiroute)';
  } else if (primaryShipment?.courier && primaryShipment.courier !== 'CARRIER EXTERNO') {
    effectiveCourier = primaryShipment.courier;
  } else if (orderData.courier && orderData.courier !== 'CARRIER EXTERNO') {
    effectiveCourier = orderData.courier;
  } else if (orderData.operador) {
    effectiveCourier = orderData.operador;
  } else if (orderData.courier) {
    effectiveCourier = orderData.courier;
  }

  const cleanCourierLow = String(effectiveCourier).toLowerCase().trim();
  if (cleanCourierLow.includes('home delivery')) effectiveCourier = 'Home Delivery';
  else if (cleanCourierLow === 'chilexpress') effectiveCourier = 'Chilexpress';
  else if (cleanCourierLow.includes('blueexpress') || cleanCourierLow.includes('blue express') || cleanCourierLow === 'bluex') effectiveCourier = 'Blue Express';
  else if (cleanCourierLow.includes('starken')) effectiveCourier = 'Starken';

  // Resolver número de seguimiento y URL pública de tracking
  let effectiveTracking = String(
    (isAlphaOrder ? (orderData.raw_lightdata_data?.did || orderData.raw_lightdata_data?.id || primaryShipment?.source_id || orderData.tracking_number) : '') ||
    orderData.tracking_number ||
    primaryShipment?.tracking ||
    (primaryShipment?.source_table === 'optiroute_orders' ? primaryShipment.raw_data?.uuid : '') ||
    ''
  ).trim();
  if (['N/A', '-', 'null', 'undefined', 'No informado', 'NO INFORMADO'].includes(effectiveTracking)) {
    effectiveTracking = '';
  }

  let effectiveTrackingUrl = String(primaryShipment?.tracking_url || orderData.tracking_url || '').trim();
  if (orderData.raw_lightdata_data?.raw_data?.[31] && String(orderData.raw_lightdata_data.raw_data[31]).startsWith('http')) {
    effectiveTrackingUrl = String(orderData.raw_lightdata_data.raw_data[31]).trim();
  } else if (primaryShipment?.source_table === 'lightdata_envios' && primaryShipment?.raw_data?.[31] && String(primaryShipment.raw_data[31]).startsWith('http')) {
    effectiveTrackingUrl = String(primaryShipment.raw_data[31]).trim();
  }
  if (effectiveTrackingUrl.includes('api.enviame.io/s2/') || effectiveTrackingUrl.includes('api.enviame.io/api/')) {
    effectiveTrackingUrl = effectiveTracking ? `https://tracking.enviame.io/?n=${encodeURIComponent(effectiveTracking)}` : '';
  }
  if (effectiveTrackingUrl === 'N/A' || (!effectiveTrackingUrl.startsWith('http://') && !effectiveTrackingUrl.startsWith('https://'))) {
    effectiveTrackingUrl = '';
  }
  if (!effectiveTrackingUrl && effectiveTracking) {
    if (isAlphaOrder) {
      effectiveTrackingUrl = `https://alphagroup.lightdata.com.ar/tracking.php?token=${encodeURIComponent(effectiveTracking)}d54df4s8a88`;
    } else if (primaryShipment?.source_table === 'optiroute_orders') {
      effectiveTrackingUrl = `https://app.optiroute.cl/service_requets/tracking/${encodeURIComponent(effectiveTracking)}/`;
    } else if (effectiveCourier === 'Blue Express' || primaryShipment?.source_table === 'bluex_envios') {
      effectiveTrackingUrl = `https://tracking-unificado.blue.cl/?n_seguimiento=${encodeURIComponent(effectiveTracking)}`;
    } else if (effectiveCourier === 'Starken' || primaryShipment?.source_table === 'starken_envios') {
      effectiveTrackingUrl = `https://www.starken.cl/seguimiento?codigo=${encodeURIComponent(effectiveTracking)}`;
    } else if (effectiveCourier === 'Chilexpress') {
      effectiveTrackingUrl = `https://www.chilexpress.cl/seguimiento-envio?numero=${encodeURIComponent(effectiveTracking)}`;
    } else if (isMeli) {
      effectiveTrackingUrl = `https://envios.mercadolibre.cl/seguimiento/${encodeURIComponent(effectiveTracking)}`;
    }
  }

  const isDelivered = globStatus === 'ENTREGADO';
  const isInTransit = globStatus === 'EN TRÁNSITO';
  const isAlert = globStatus === 'ALERTA' || globStatus === 'DEVOLUCIÓN';

  return {
    isRetiro: false,
    hasTracking: Boolean(primaryShipment || effectiveTracking || globStatus),
    shipment: primaryShipment,
    allShipments: validShipments,
    effectiveCourier,
    effectiveTracking,
    effectiveTrackingUrl,
    globalStatus: globStatus || (estadoWmsLow === 'despachado' ? 'EN TRÁNSITO' : 'SIN MOVIMIENTO'),
    rawStatusText: statusText || globStatus || 'Sin movimiento reportado',
    isDelivered,
    isInTransit,
    isAlert,
    isReturned: globStatus === 'DEVOLUCIÓN',
    sourceTable: primaryShipment?.source_table || (hasRealLd ? 'lightdata_envios' : (orderData.courier ? 'orders' : 'Sin fuente')),
    updatedAt: primaryShipment?.updated_at || orderData.raw_lightdata_data?.fecha_actualizacion_lightdata || orderData.stock_descontado_at || null
  };
}

function buildOrderLifecycleSteps(orderData, pickerData, trackingInfo) {
  const wmsLow = String(orderData.estado_wms || orderData.status || 'En procesamiento').toLowerCase();
  const isCanceled = wmsLow.includes('cancelado');
  const isIncident = wmsLow.includes('incidencia');
  const isDeliveredFinal = Boolean(trackingInfo?.isDelivered) || wmsLow.includes('entregado') || wmsLow.includes('retirado');
  const isDispatched = isDeliveredFinal || wmsLow.includes('despachado') || Boolean(trackingInfo?.isInTransit);
  const isPicked = isDispatched || wmsLow.includes('pickeado') || wmsLow.includes('preparado') || wmsLow.includes('listo') || pickerData.isCompleted;
  const isPreparing = isPicked || wmsLow.includes('preparación') || wmsLow.includes('preparacion') || pickerData.hasActive || Boolean(orderData.agenda || orderData.operador);

  // Si el pedido ya fue despachado y el courier lo tiene EN TRÁNSITO, ALERTA o ENTREGADO, la etapa activa pasa a la 5 (Tránsito y Entrega Final)
  const hasAdvancedToStep5 = isDeliveredFinal || (isDispatched && (trackingInfo?.isInTransit || trackingInfo?.isAlert));

  let currentStep = 1;
  if (hasAdvancedToStep5) currentStep = 5;
  else if (isDispatched) currentStep = 4;
  else if (isPicked) currentStep = 3;
  else if (isPreparing) currentStep = 2;
  else currentStep = 1;

  const createdDateStr = orderData.created_at ? new Date(orderData.created_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : 'Registrado';
  const pickerCompletedLog = (pickerData.historyLogs || []).find(l => ['Completado', 'COMPLETADO', 'Completado-Asistido', 'Listo para retiro', 'LISTO PARA RETIRO'].includes(l.estado)) || pickerData.historyLogs?.[0] || null;
  const pickerTimeStr = pickerCompletedLog
    ? (pickerCompletedLog.fecha ? `${pickerCompletedLog.fecha} ${pickerCompletedLog.hora || ''}`.trim() : new Date(pickerCompletedLog.created_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }))
    : (pickerData.activeItem?.created_at ? new Date(pickerData.activeItem.created_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : 'Pendiente');

  const updatedTimeStr = trackingInfo?.updatedAt
    ? new Date(trackingInfo.updatedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
    : '';

  const steps = [
    {
      num: 1,
      title: '1. Orden Recibida',
      icon: 'ri-shopping-bag-3-line',
      desc: `Canal: ${orderData.origen || orderData.external_platform || 'Manual'} · Pago: ${orderData.payment_status || 'Confirmado'}`,
      meta: createdDateStr,
      state: currentStep > 1 ? 'completed' : 'current'
    },
    {
      num: 2,
      title: '2. Asignación y Cola WMS',
      icon: 'ri-git-branch-line',
      desc: `Sucursal: ${orderData.sucursal_pickeo || 'Por asignar'} · Agenda: ${orderData.agenda || 'Sin agenda'}`,
      meta: orderData.fecha_procesamiento || (isPreparing ? 'En flujo operativo' : 'Por procesar'),
      state: currentStep > 2 ? 'completed' : (currentStep === 2 ? 'current' : 'pending')
    },
    {
      num: 3,
      title: '3. Picking y Verificación',
      icon: 'ri-barcode-box-line',
      desc: pickerData.operator
        ? `Operario: ${pickerData.operator}${pickerData.totu ? ` · Tote #${pickerData.totu}` : ''}`
        : 'En espera de lectura por operario Picker',
      meta: isPicked ? `Pickeado (${pickerTimeStr})` : (pickerData.hasActive ? 'En cola activa de bodega' : 'Pendiente de escaneo'),
      state: currentStep > 3 ? 'completed' : (currentStep === 3 ? 'current' : 'pending')
    },
    {
      num: 4,
      title: '4. Empaque y Despacho',
      icon: 'ri-truck-line',
      desc: `Courier: ${trackingInfo?.effectiveCourier || orderData.courier || 'Por asignar'}${trackingInfo?.effectiveTracking ? ` · Guía: ${trackingInfo.effectiveTracking}` : ''}`,
      meta: orderData.stock_descontado_at
        ? `Despachado (${new Date(orderData.stock_descontado_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })})`
        : (isDispatched ? 'Despachado de bodega' : 'En espera de despacho'),
      state: currentStep > 4 ? 'completed' : (currentStep === 4 ? 'current' : 'pending')
    },
    {
      num: 5,
      title: '5. Tránsito y Entrega Final',
      icon: isDeliveredFinal ? 'ri-checkbox-circle-fill' : 'ri-map-pin-user-line',
      desc: trackingInfo?.hasTracking
        ? `Auto-Track: ${trackingInfo.globalStatus}${trackingInfo.rawStatusText && trackingInfo.rawStatusText.toUpperCase() !== trackingInfo.globalStatus ? ` (${trackingInfo.rawStatusText})` : ''}`
        : `Destino: ${orderData.shipping_city || 'Comuna destino'}`,
      meta: isDeliveredFinal
        ? `✓ Entregado${updatedTimeStr ? ` (${updatedTimeStr})` : ' a destinatario'}`
        : (updatedTimeStr ? `Act: ${updatedTimeStr}` : 'Monitoreo de entrega'),
      state: isDeliveredFinal ? 'delivered_final' : (trackingInfo?.isAlert ? 'alert' : (currentStep === 5 ? 'current' : 'pending'))
    }
  ];

  if (isIncident || isCanceled) {
    steps[currentStep - 1].state = 'alert';
  }

  return steps;
}

// ============================================================================
// 3. RENDERIZADO DE LA PÁGINA DEDICADA 360° DEL PEDIDO
// ============================================================================
window.renderSingleOrderPage = async function(orderIdOrRef, options = {}) {
  injectOrderSearchStyles();
  const isAdmin = options.isAdmin !== undefined
    ? options.isAdmin
    : Boolean(document.getElementById('admin-cmd-container') || window.location.pathname.includes('admin'));
  const silentRefresh = Boolean(options.silentRefresh);

  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  const cleanRef = String(orderIdOrRef || '').trim();
  if (!cleanRef) return;

  window._suppressDashboardForOrderPage = true;
  window._activeSingleOrderPageId = cleanRef;
  window.currentActiveView = 'order_detail';
  if (typeof window.activeViewRequestId === 'number') {
    window.activeViewRequestId++;
  }
  if (window.activeDashboardLoaderInterval) {
    clearInterval(window.activeDashboardLoaderInterval);
    window.activeDashboardLoaderInterval = null;
  }

  if (!silentRefresh) {
    appContent.innerHTML = `
      <div class="card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 380px; padding: 2.5rem; text-align: center; border-radius: 14px;">
        <div style="width: 56px; height: 56px; border: 4px solid rgba(99, 102, 241, 0.15); border-top-color: var(--color-primary, #6366f1); border-radius: 50%; animation: wms-spin 0.9s linear infinite; margin-bottom: 1.25rem;"></div>
        <h3 style="margin: 0 0 0.4rem 0; font-size: 1.12rem; font-weight: 800; color: var(--color-text-main);">Cargando Página 360° del Pedido</h3>
        <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-muted);">Obteniendo trazabilidad de bodega, etapas de picking, stock y courier en tiempo real...</p>
      </div>
    `;
  }

  try {
    const selectStr = `
      id,
      status,
      estado_wms,
      created_at,
      external_order_number,
      external_platform,
      origen,
      item,
      cantidad,
      sku,
      total_value,
      customer_name,
      customer_email,
      customer_phone,
      shipping_address,
      shipping_city,
      shipping_complement,
      shipping_method,
      payment_status,
      tracking_number,
      tracking_url,
      courier,
      label_url,
      label_base64,
      shopify_exported,
      raw_shopify_data,
      raw_woocommerce_data,
      raw_meli_data,
      raw_falabella_data,
      raw_jumpseller_data,
      raw_optiroute_data,
      raw_lightdata_data,
      raw_paris_data,
      raw_ripley_data,
      raw_walmart_data,
      raw_tiendanube_data,
      lightdata_status,
      comercio,
      merchant_id,
      categoria_entrega,
      agenda,
      operador,
      fecha_procesamiento,
      sucursal_pickeo,
      periodo_facturacion,
      stock_descontado,
      stock_descontado_at,
      order_items (
        id,
        quantity,
        product_id,
        warehouse_id,
        tag,
        is_gift,
        campaign_id,
        warehouses (id, name),
        products (id, sku, name, is_virtual, price, image_url, barcode, barcode_wms, alias, options, color, talla, variable_1, variable_2)
      )
    `.replace(/\s+/g, ' ').trim();

    let orderData = null;
    if (isUuid(cleanRef)) {
      const { data, error } = await supabase
        .from('orders')
        .select(selectStr)
        .eq('id', cleanRef)
        .maybeSingle();
      if (error) throw error;
      orderData = data;
    }

    if (!orderData) {
      const codeParts = parseOrderCodeParts(cleanRef);
      const siglaMaps = await getCommercesBySiglaMap();
      const variants = buildOrderReferenceVariants(cleanRef, siglaMaps.allSiglas || []);
      const refOrs = [];
      if (variants.extList.length > 0) {
        const csvExt = variants.extList.slice(0, 260).map(x => `"${x.replace(/"/g, '')}"`).join(',');
        refOrs.push(`external_order_number.in.(${csvExt})`);
      }
      if (variants.trkList.length > 0) {
        const csvTrk = variants.trkList.slice(0, 30).map(x => `"${x.replace(/"/g, '')}"`).join(',');
        refOrs.push(`tracking_number.in.(${csvTrk})`);
      }
      variants.prefixRanges.slice(0, 8).forEach(pr => {
        refOrs.push(`and(${pr.col}.gte."${pr.prefix}",${pr.col}.lte."${pr.prefix}\uffff")`);
      });

      let q = supabase
        .from('orders')
        .select(selectStr)
        .or(Array.from(new Set(refOrs)).join(','))
        .limit(10);
      if (!isAdmin) {
        const allowed = getClientAllowedCommerces();
        if (allowed.length > 0) q = q.in('comercio', allowed);
      }
      const { data: listData, error: listErr } = await q;
      if (listErr) throw listErr;
      if (listData && listData.length > 0) {
        const targetComms = codeParts.hasPrefix ? (siglaMaps.siglaToCommerces.get(codeParts.prefix) || new Set()) : new Set();
        orderData = listData.find(o => {
          const extAlnum = String(o.external_order_number || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const trkAlnum = String(o.tracking_number || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const commUpper = String(o.comercio || '').trim().toUpperCase();
          if (extAlnum === codeParts.alnumLower || trkAlnum === codeParts.alnumLower) return true;
          if (codeParts.hasPrefix && (targetComms.has(commUpper) || commUpper.includes(codeParts.prefix)) && extAlnum.includes(codeParts.numLower)) return true;
          return false;
        }) || listData[0];
      }
    }

    if (!orderData) {
      appContent.innerHTML = `
        <div class="card" style="padding: 2.5rem; text-align: center; max-width: 580px; margin: 2rem auto; border-radius: 14px;">
          <i class="ri-file-search-line" style="font-size: 3rem; color: var(--color-text-muted); display: block; margin-bottom: 0.75rem;"></i>
          <h3 style="margin: 0 0 0.5rem 0; color: var(--color-text-main);">Pedido no encontrado</h3>
          <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1.25rem;">
            No encontramos un pedido con el identificador <strong>${escapeHtmlSafe(cleanRef)}</strong>.
          </p>
          <button type="button" class="sop-btn sop-btn-primary" onclick="document.getElementById('${isAdmin ? 'admin-cmd-btn' : 'client-cmd-btn'}')?.click()">
            <i class="ri-search-2-line"></i> Buscar otro pedido (Ctrl+K)
          </button>
        </div>
      `;
      return;
    }

    if (!isAdmin) {
      const allowedCommerces = getClientAllowedCommerces().map(c => c.toLowerCase());
      const orderComm = String(orderData.comercio || '').trim().toLowerCase();
      const isSameMerchant = window.currentClientUser?.id && orderData.merchant_id === window.currentClientUser.id;
      if (!isSameMerchant && allowedCommerces.length > 0 && !allowedCommerces.includes(orderComm)) {
        appContent.innerHTML = `
          <div class="card" style="padding: 2.5rem; text-align: center; max-width: 560px; margin: 2rem auto; border-color: rgba(239, 68, 68, 0.35);">
            <i class="ri-shield-keyhole-line" style="font-size: 2.8rem; color: #ef4444; display: block; margin-bottom: 0.75rem;"></i>
            <h3 style="margin: 0 0 0.5rem 0; color: var(--color-text-main);">Acceso Restringido</h3>
            <p style="color: var(--color-text-muted); font-size: 0.88rem;">Este pedido no pertenece a tu comercio asignado.</p>
          </div>
        `;
        return;
      }
    }

    window._activeSingleOrderPageId = orderData.id;

    const displayNum = orderData.external_order_number
      ? (String(orderData.external_order_number).startsWith('#') ? orderData.external_order_number : `#${orderData.external_order_number}`)
      : `#${orderData.id.slice(0, 8)}`;
    const viewTitleEl = document.getElementById('view-title');
    if (viewTitleEl) {
      viewTitleEl.textContent = `Pedido ${displayNum} · ${orderData.comercio || 'Stocka'}`;
    }
    document.title = `Pedido ${displayNum} (${orderData.comercio || 'Stocka'}) - WMS Stocka`;

    // Sincronizar pedido en memoria local para compatibilidad total con modales de edición
    if (isAdmin) {
      if (!Array.isArray(window.loadedOrders)) window.loadedOrders = [];
      const existingIdx = window.loadedOrders.findIndex(o => String(o.id) === String(orderData.id));
      if (existingIdx !== -1) window.loadedOrders[existingIdx] = orderData;
      else window.loadedOrders.unshift(orderData);

      if (!window._originalApplyWmsFiltersAndRender && typeof window.applyWmsFiltersAndRender === 'function') {
        window._originalApplyWmsFiltersAndRender = window.applyWmsFiltersAndRender;
      }

      window.applyWmsFiltersAndRender = function(...args) {
        if (window._activeSingleOrderPageId) {
          if (typeof window.hasAnyOpenModal === 'function' && window.hasAnyOpenModal()) {
            window._pendingWmsRenderAfterModal = true;
            return;
          }
          window.renderSingleOrderPage(window._activeSingleOrderPageId, { isAdmin: true, silentRefresh: true });
        } else if (typeof window._originalApplyWmsFiltersAndRender === 'function') {
          return window._originalApplyWmsFiltersAndRender.apply(this, args);
        }
      };
    } else {
      if (!Array.isArray(window.clientLoadedOrders)) window.clientLoadedOrders = [];
      const existingIdx = window.clientLoadedOrders.findIndex(o => String(o.id) === String(orderData.id));
      if (existingIdx !== -1) window.clientLoadedOrders[existingIdx] = orderData;
      else window.clientLoadedOrders.unshift(orderData);
    }

    // Consultas en paralelo para enriquecer la Página del Pedido (Envíos Unificados, LightData Directo, Retiros, Stock, Picker directo, Comercios)
    const extRaw = String(orderData.external_order_number || '').trim();
    const extNoHash = extRaw.replace(/^#/, '').trim();
    const trkRaw = String(orderData.tracking_number || '').trim();
    const ldDidRaw = String(orderData.raw_lightdata_data?.did || orderData.raw_lightdata_data?.id || '').trim();
    const ldTrkRaw = String(orderData.raw_lightdata_data?.tracking || '').trim();
    const refCandidates = [...new Set([
      extRaw,
      extNoHash,
      extNoHash ? `#${extNoHash}` : '',
      extRaw.toUpperCase(),
      extNoHash.toUpperCase(),
      trkRaw,
      ldDidRaw,
      ldTrkRaw,
      String(orderData.id || '').trim()
    ].filter(Boolean))];

    const ldIdCandidates = [...new Set([trkRaw, ldDidRaw].filter(v => v && /^\d+$/.test(v)))];

    let orderShipments = [];
    let directLdRows = [];
    let storePickupRows = [];
    let stockByProductMap = {};
    const pickerData = {
      hasActive: false,
      activeItem: null,
      historyLogs: [],
      status: null,
      operator: null,
      totu: null,
      sucursal: null,
      observation: null,
      isCompleted: false
    };

    await Promise.all([
      // 1. Opciones de configuración en Admin
      (async () => {
        if (isAdmin && typeof window.loadConfigOptions === 'function') {
          try { await window.loadConfigOptions(); } catch (e) {}
        }
      })(),
      // 2. Envíos unificados de este pedido
      (async () => {
        if (refCandidates.length === 0) return;
        try {
          const csv = `(${refCandidates.map(r => `"${r.replace(/["(),]/g, '')}"`).join(',')})`;
          const ldUnifiedIds = ldIdCandidates.map(id => `"lightdata_envios:${id}"`).join(',');
          const orFilter = ldUnifiedIds
            ? `pedido_referencia.in.${csv},tracking.in.${csv},source_id.in.${csv},id.in.(${ldUnifiedIds})`
            : `pedido_referencia.in.${csv},tracking.in.${csv},source_id.in.${csv}`;

          const { data: shData } = await supabase
            .from('envios_unificados')
            .select('id, source_table, source_id, pedido_referencia, tracking, tracking_url, courier, status, global_status, comuna_destino, empresa_comercio_proveedor, created_at, updated_at, raw_data')
            .or(orFilter)
            .order('updated_at', { ascending: false });
          if (shData) {
            orderShipments = shData;
            if (isAdmin) {
              window.loadedShipments = shData;
              if (typeof window.buildWmsShipmentsByRefMap === 'function') {
                window.buildWmsShipmentsByRefMap(shData);
              }
            }
          }
        } catch (e) {}
      })(),
      // 2b. Consulta directa a lightdata_envios y store_pickups para enriquecer estados en tiempo real (ej: raw_data[23] = "Entregado")
      (async () => {
        try {
          const subPromises = [];
          if (ldIdCandidates.length > 0 || refCandidates.length > 0) {
            const refCsv = `(${refCandidates.map(r => `"${r.replace(/["(),]/g, '')}"`).join(',')})`;
            const ldOrParts = [`tracking.in.${refCsv}`];
            if (ldIdCandidates.length > 0) {
              ldOrParts.push(`id.in.(${ldIdCandidates.map(i => `"${i}"`).join(',')})`);
            }
            subPromises.push(
              supabase
                .from('lightdata_envios')
                .select('*')
                .or(ldOrParts.join(','))
                .order('created_at', { ascending: false })
                .limit(5)
                .then(({ data }) => { if (data) directLdRows = data; })
                .catch(() => {})
            );
          }
          if (refCandidates.length > 0) {
            subPromises.push(
              supabase
                .from('store_pickups')
                .select('*')
                .in('pedido', refCandidates)
                .limit(3)
                .then(({ data }) => { if (data) storePickupRows = data; })
                .catch(() => {})
            );
          }
          if (subPromises.length > 0) await Promise.all(subPromises);
        } catch (e) {}
      })(),
      // 3. Stock actual de los productos de este pedido
      (async () => {
        const prodIds = [...new Set((orderData.order_items || []).map(oi => oi.product_id).filter(Boolean))];
        if (prodIds.length === 0) return;
        try {
          if (isAdmin && typeof window.fetchInventoryForOrders === 'function') {
            await window.fetchInventoryForOrders([orderData], true);
          }
          const { data: invRows } = await supabase
            .from('inventory')
            .select('product_id, warehouse_id, quantity, warehouses (id, name)')
            .in('product_id', prodIds);
          if (invRows) {
            invRows.forEach(row => {
              if (!stockByProductMap[row.product_id]) {
                stockByProductMap[row.product_id] = { total: 0, byWarehouse: {} };
              }
              const q = Number(row.quantity) || 0;
              stockByProductMap[row.product_id].total += q;
              if (row.warehouse_id) {
                stockByProductMap[row.product_id].byWarehouse[row.warehouse_id] = {
                  qty: q,
                  name: row.warehouses?.name || 'Bodega'
                };
              }
            });
          }
        } catch (e) {}
      })(),
      // 4. Consulta directa a la Base de Datos del Picker (active_orders + history_logs) sin restricción de antigüedad
      (async () => {
        const pickerClient = getPickerSupabase();
        if (!pickerClient) return;
        const pKeys = buildPickerQueryKeys(orderData);
        if (pKeys.length === 0) return;
        try {
          const [
            { data: activeRows },
            { data: histRows }
          ] = await Promise.all([
            pickerClient.from('active_orders').select('*').in('order_number', pKeys),
            pickerClient.from('history_logs').select('*').in('pedido', pKeys).order('created_at', { ascending: false })
          ]);

          if (activeRows && activeRows.length > 0) {
            const firstAct = activeRows[0];
            pickerData.hasActive = true;
            pickerData.activeItem = firstAct;
            pickerData.status = firstAct.sheet_status || 'EN PREPARACIÓN';
            pickerData.operator = firstAct.operator || null;
            pickerData.totu = firstAct.totu || null;
            pickerData.sucursal = firstAct.sucursal || null;
            pickerData.observation = firstAct.observation || null;
            pickerData.isCompleted = ['Completado', 'COMPLETADO', 'Listo para retiro', 'LISTO PARA RETIRO'].includes(firstAct.sheet_status);
          }

          if (histRows && histRows.length > 0) {
            pickerData.historyLogs = histRows;
            const firstLog = histRows[0];
            const isComp = ['Completado', 'COMPLETADO', 'Completado-Asistido', 'Listo para retiro', 'LISTO PARA RETIRO', 'Retirado'].includes(firstLog.estado);
            if (!pickerData.hasActive || isComp) {
              pickerData.status = firstLog.estado || 'COMPLETADO';
              pickerData.isCompleted = isComp;
            }
            pickerData.operator = pickerData.operator || firstLog.picker || null;
            pickerData.sucursal = pickerData.sucursal || firstLog.sucursal || null;
            pickerData.observation = pickerData.observation || firstLog.comentarios || null;
          }

          if (!window.pickerOperatorsMap) window.pickerOperatorsMap = {};
          if (!window.pickerStatusMap) window.pickerStatusMap = {};
          if (pickerData.operator) {
            pKeys.forEach(k => { window.pickerOperatorsMap[k] = pickerData.operator; });
          }
        } catch (e) {
          console.warn('[SingleOrderPage] Aviso consultando Picker en directo:', e);
        }
      })(),
      // 5. Comercios para selector en Admin
      (async () => {
        if (isAdmin && (!window.wmsAllComercios || window.wmsAllComercios.length === 0)) {
          try {
            const { data: cfg } = await supabase.from('comercios_adicional_config').select('comercio').order('comercio');
            if (cfg) {
              window.wmsAllComercios = [...new Set(cfg.map(c => c.comercio).filter(Boolean))];
            }
          } catch (e) {}
        }
      })()
    ]);

    // Datos de Cliente con fallback a payloads originales
    let displayName = orderData.customer_name || '';
    if (!displayName || displayName === 'No registrado') {
      const rs = orderData.raw_shopify_data;
      const rj = orderData.raw_jumpseller_data;
      if (rs?.shipping_address) displayName = `${rs.shipping_address.first_name || ''} ${rs.shipping_address.last_name || ''}`.trim();
      else if (rs?.customer) displayName = `${rs.customer.first_name || ''} ${rs.customer.last_name || ''}`.trim();
      else if (rj?.customer) displayName = rj.customer.fullname || `${rj.customer.first_name || ''} ${rj.customer.last_name || ''}`.trim();
    }
    displayName = displayName || 'No registrado';

    let displayEmail = orderData.customer_email || '';
    if (!displayEmail || displayEmail === 'No registrado') {
      displayEmail = orderData.raw_shopify_data?.contact_email || orderData.raw_shopify_data?.email || orderData.raw_jumpseller_data?.customer?.email || 'No registrado';
    }

    let displayPhone = orderData.customer_phone || '';
    if (!displayPhone || displayPhone === 'No registrado') {
      displayPhone = orderData.raw_shopify_data?.shipping_address?.phone || orderData.raw_jumpseller_data?.customer?.phone || 'No registrado';
    }

    const cleanDigitsPhone = String(displayPhone || '').replace(/\D/g, '');
    const whatsappHref = cleanDigitsPhone.length >= 8
      ? `https://wa.me/${cleanDigitsPhone.startsWith('56') ? cleanDigitsPhone : '56' + cleanDigitsPhone}`
      : null;

    const stStyle = getWmsStatusStyle(orderData);
    const platMeta = getPlatformMeta(orderData);
    const createdAtStr = orderData.created_at ? new Date(orderData.created_at).toLocaleString('es-CL') : '-';
    const relativeAgeStr = formatRelativeTimeEs(orderData.created_at);
    const orderNote = window.getOrderNoteText ? window.getOrderNoteText(orderData) : '';
    const adminNote = isAdmin && window.getOrderAdminNote ? window.getOrderAdminNote(orderData) : '';
    const categoriaEffective = window.getOrderEffectiveCategoriaEntrega
      ? window.getOrderEffectiveCategoriaEntrega(orderData)
      : (orderData.categoria_entrega || 'DISTRIBUCIÓN');
    const categoriaBadgeHtml = window.getOrderCategoriaBadgeHtml
      ? window.getOrderCategoriaBadgeHtml(orderData)
      : `<span class="badge" style="background: rgba(59, 130, 246, 0.12); color: #2563eb; padding: 0.2rem 0.55rem; border-radius: 999px; font-size: 0.74rem; font-weight: 700;">${escapeHtmlSafe(categoriaEffective)}</span>`;
    const paymentBadgeHtml = window.getOrderPaymentBadgeHtml
      ? window.getOrderPaymentBadgeHtml(orderData)
      : `<span class="badge" style="background: rgba(16, 185, 129, 0.14); color: #059669; padding: 0.2rem 0.55rem; border-radius: 999px; font-size: 0.74rem; font-weight: 700;"><i class="ri-checkbox-circle-line"></i> ${escapeHtmlSafe(orderData.payment_status || 'Pagado')}</span>`;
    const comunaBadgeHtml = window.getComunaCoverageBadge
      ? window.getComunaCoverageBadge(orderData.shipping_city)
      : '';
    const copyBtn = (val, label) => window.renderCopyFieldBtn ? window.renderCopyFieldBtn(val, label) : '';
    const fullAddress = `${orderData.shipping_address || 'No registrada'}${orderData.shipping_complement ? `, ${orderData.shipping_complement}` : ''}`;

    // Resolver Estado Real de Courier y Auto-Track (LightData raw_data[23], Envíame, Blue Express, Starken, Optiroute, Marketplaces y Retiros)
    const trackingInfo = resolveOrderCourierTracking(orderData, orderShipments, directLdRows, storePickupRows, pickerData);
    const latestShipment = trackingInfo.shipment;
    const effectiveCourier = trackingInfo.effectiveCourier;
    const effectiveTracking = trackingInfo.effectiveTracking;
    const effectiveTrackingUrl = trackingInfo.effectiveTrackingUrl;

    // Estilo y badge de Auto-Track / Courier para mostrar en el Hero y Stepper
    let autoTrackBadgeStyle = { bg: 'rgba(100, 116, 139, 0.12)', color: '#475569', border: 'rgba(100, 116, 139, 0.3)', icon: 'ri-radar-line' };
    if (trackingInfo.isDelivered) {
      autoTrackBadgeStyle = { bg: 'rgba(16, 185, 129, 0.16)', color: '#047857', border: 'rgba(16, 185, 129, 0.4)', icon: 'ri-checkbox-circle-fill' };
    } else if (trackingInfo.isInTransit) {
      autoTrackBadgeStyle = { bg: 'rgba(2, 132, 199, 0.14)', color: '#0369a1', border: 'rgba(2, 132, 199, 0.35)', icon: 'ri-truck-line' };
    } else if (trackingInfo.isReturned) {
      autoTrackBadgeStyle = { bg: 'rgba(225, 29, 72, 0.14)', color: '#be123c', border: 'rgba(225, 29, 72, 0.35)', icon: 'ri-arrow-go-back-line' };
    } else if (trackingInfo.isAlert) {
      autoTrackBadgeStyle = { bg: 'rgba(239, 68, 68, 0.14)', color: '#b91c1c', border: 'rgba(239, 68, 68, 0.35)', icon: 'ri-error-warning-fill' };
    }

    const heroCourierBadgeHtml = trackingInfo.hasTracking ? `
      <span style="font-size: 0.76rem; font-weight: 800; padding: 0.22rem 0.65rem; border-radius: 999px; background: ${autoTrackBadgeStyle.bg}; color: ${autoTrackBadgeStyle.color}; border: 1px solid ${autoTrackBadgeStyle.border}; display: inline-flex; align-items: center; gap: 0.3rem;" title="Estado reportado por el Courier / Auto-Track">
        <i class="${autoTrackBadgeStyle.icon}"></i>
        <span>Tracking: ${escapeHtmlSafe(trackingInfo.globalStatus)}${trackingInfo.rawStatusText && trackingInfo.rawStatusText.toUpperCase() !== trackingInfo.globalStatus ? ` (${escapeHtmlSafe(trackingInfo.rawStatusText)})` : ''}</span>
      </span>
    ` : '';

    // Construir Stepper de 5 Etapas Operativas
    const lifecycleSteps = buildOrderLifecycleSteps(orderData, pickerData, trackingInfo);
    const stepperHtml = lifecycleSteps.map(step => {
      const stateClass = step.state === 'delivered_final'
        ? 'is-delivered-final'
        : (step.state === 'completed'
            ? 'is-completed'
            : (step.state === 'current' ? 'is-current' : (step.state === 'alert' ? 'is-alert' : '')));
      const circleContent = (step.state === 'completed' || step.state === 'delivered_final')
        ? '<i class="ri-check-line"></i>'
        : `<i class="${step.icon}"></i>`;
      const statePill = step.state === 'delivered_final'
        ? '<span style="font-size: 0.65rem; font-weight: 800; padding: 0.1rem 0.5rem; border-radius: 999px; background: #059669; color: #ffffff;">✓ ENTREGADO</span>'
        : (step.state === 'completed'
            ? '<span style="font-size: 0.65rem; font-weight: 700; padding: 0.08rem 0.42rem; border-radius: 999px; background: rgba(16, 185, 129, 0.15); color: #059669;">Completado</span>'
            : (step.state === 'current'
                ? '<span style="font-size: 0.65rem; font-weight: 800; padding: 0.08rem 0.48rem; border-radius: 999px; background: var(--color-primary, #6366f1); color: #ffffff;">ETAPA ACTUAL</span>'
                : (step.state === 'alert'
                    ? '<span style="font-size: 0.65rem; font-weight: 800; padding: 0.08rem 0.48rem; border-radius: 999px; background: #ef4444; color: #ffffff;">ATENCIÓN</span>'
                    : '<span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Pendiente</span>')));

      return `
        <div class="sop-step-item ${stateClass}">
          <div class="sop-step-top">
            <div class="sop-step-circle">${circleContent}</div>
            ${statePill}
          </div>
          <div class="sop-step-title">${escapeHtmlSafe(step.title)}</div>
          <div class="sop-step-desc">${escapeHtmlSafe(step.desc)}</div>
          <div class="sop-step-meta">
            <i class="ri-time-line"></i>
            <span>${escapeHtmlSafe(step.meta)}</span>
          </div>
        </div>
      `;
    }).join('');

    // Mapa de unidades escaneadas en Picker por SKU
    const scannedBySkuMap = parseScannedItemsMap(pickerData.historyLogs);

    // Construir Tabla de Ítems amplia y detallada
    const items = Array.isArray(orderData.order_items) ? orderData.order_items : [];
    const totalUnits = items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0) || (Number(orderData.cantidad) || 1);
    let itemsRowsHtml = '';

    if (items.length > 0) {
      itemsRowsHtml = items.map(oi => {
        const prod = oi.products || {};
        const sku = prod.sku || orderData.sku || '-';
        const skuUpper = String(sku).trim().toUpperCase();
        const name = prod.name || orderData.item || 'Producto';
        const qty = Number(oi.quantity) || 1;
        const unitPrice = Number(prod.price) || 0;
        const lineTotal = unitPrice * qty;
        const whName = oi.warehouses?.name || orderData.sucursal_pickeo || 'Matriz Ñuñoa';
        const stockInfo = oi.product_id ? stockByProductMap[oi.product_id] : null;
        const whStock = (stockInfo && oi.warehouse_id && stockInfo.byWarehouse[oi.warehouse_id])
          ? stockInfo.byWarehouse[oi.warehouse_id].qty
          : null;
        const totalStock = stockInfo ? stockInfo.total : null;

        // Estado de verificación en Picker para este SKU
        const scanInfo = scannedBySkuMap[skuUpper] || null;
        let pickerScanCell = '';
        if (scanInfo) {
          const isFull = scanInfo.scanned >= scanInfo.total;
          pickerScanCell = `
            <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.73rem; font-weight: 700; padding: 0.16rem 0.5rem; border-radius: 999px; background: ${isFull ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.15)'}; color: ${isFull ? '#059669' : '#d97706'}; border: 1px solid ${isFull ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.35)'};">
              <i class="${isFull ? 'ri-checkbox-circle-fill' : 'ri-time-line'}"></i> ${scanInfo.scanned}/${scanInfo.total} escaneado
            </span>
          `;
        } else if (pickerData.isCompleted || String(orderData.estado_wms || '').toLowerCase() === 'pickeado' || String(orderData.estado_wms || '').toLowerCase() === 'despachado') {
          pickerScanCell = `
            <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.48rem; border-radius: 999px; background: rgba(59, 130, 246, 0.12); color: #2563eb;">
              <i class="ri-check-double-line"></i> Verificado (${qty}/${qty})
            </span>
          `;
        } else {
          pickerScanCell = `<span style="font-size: 0.72rem; color: var(--color-text-muted);">En espera</span>`;
        }

        let stockBadge = '<span style="color: var(--color-text-muted); font-size: 0.75rem;">-</span>';
        if (prod.is_virtual) {
          stockBadge = '<span style="font-size: 0.72rem; padding: 0.14rem 0.45rem; border-radius: 6px; background: rgba(124, 58, 237, 0.12); color: #7c3aed; font-weight: 700;">Virtual</span>';
        } else if (totalStock !== null) {
          const isLow = totalStock < qty;
          const color = isLow ? '#dc2626' : '#059669';
          const bg = isLow ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
          stockBadge = `
            <div style="display: inline-flex; flex-direction: column; align-items: center; padding: 0.18rem 0.55rem; border-radius: 8px; background: ${bg}; color: ${color}; font-weight: 700; font-size: 0.76rem; line-height: 1.25;">
              <span>${whStock !== null ? `${whStock} en bodega` : `${totalStock} disp.`}</span>
              ${whStock !== null && whStock !== totalStock ? `<small style="font-size: 0.66rem; opacity: 0.85;">(${totalStock} global)</small>` : ''}
            </div>
          `;
        }

        return `
          <tr style="border-bottom: 1px solid var(--color-border);">
            <td style="padding: 0.7rem 0.6rem;">
              <div style="display: flex; align-items: center; gap: 0.7rem;">
                ${prod.image_url
                  ? `<img src="${escapeHtmlSafe(prod.image_url)}" alt="" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover; border: 1px solid var(--color-border); flex-shrink: 0; background: #fff;">`
                  : `<div style="width: 44px; height: 44px; border-radius: 8px; background: var(--color-bg); border: 1px solid var(--color-border); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); flex-shrink: 0;"><i class="ri-box-3-line" style="font-size: 1.2rem;"></i></div>`}
                <div style="min-width: 160px;">
                  <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.87rem; line-height: 1.35;">${escapeHtmlSafe(name)}</div>
                  <div style="font-size: 0.73rem; color: var(--color-text-muted); margin-top: 0.15rem; display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                    <span><i class="ri-map-pin-2-line" style="color: var(--color-primary);"></i> Bodega: <strong>${escapeHtmlSafe(whName)}</strong></span>
                    ${oi.is_gift ? '<span style="color: #db2777; font-weight: 700;">🎁 Regalo</span>' : ''}
                    ${oi.tag ? `<span style="background: var(--color-bg); padding: 0.05rem 0.35rem; border-radius: 4px; border: 1px solid var(--color-border);">Tag: ${escapeHtmlSafe(oi.tag)}</span>` : ''}
                  </div>
                </div>
              </div>
            </td>
            <td style="padding: 0.7rem 0.5rem; white-space: nowrap;">
              <span style="font-family: monospace; font-weight: 800; font-size: 0.84rem; color: var(--color-primary); background: rgba(99, 102, 241, 0.08); padding: 0.15rem 0.45rem; border-radius: 6px;">${escapeHtmlSafe(sku)}</span>
              ${copyBtn(sku, 'SKU')}
              ${(prod.barcode || prod.barcode_wms) ? `<div style="font-size: 0.7rem; color: var(--color-text-muted); font-family: monospace; margin-top: 0.2rem;"><i class="ri-barcode-line"></i> ${escapeHtmlSafe(prod.barcode || prod.barcode_wms)}</div>` : ''}
            </td>
            <td style="padding: 0.7rem 0.5rem; text-align: center;">
              <span style="display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 0.45rem; border-radius: 8px; background: var(--color-bg); border: 1px solid var(--color-border); font-weight: 800; font-size: 0.9rem; color: var(--color-text-main);">${qty}</span>
            </td>
            <td style="padding: 0.7rem 0.5rem; text-align: center; white-space: nowrap;">
              ${pickerScanCell}
            </td>
            <td style="padding: 0.7rem 0.5rem; text-align: center; white-space: nowrap;">
              ${stockBadge}
            </td>
            <td style="padding: 0.7rem 0.5rem; text-align: right; white-space: nowrap; color: var(--color-text-muted); font-weight: 600;">
              ${unitPrice ? formatClpSafe(unitPrice) : '-'}
            </td>
            <td style="padding: 0.7rem 0.6rem; text-align: right; white-space: nowrap; font-weight: 800; font-size: 0.9rem; color: var(--color-text-main);">
              ${unitPrice ? formatClpSafe(lineTotal) : '-'}
            </td>
          </tr>
        `;
      }).join('');
    } else if (orderData.item || orderData.sku) {
      itemsRowsHtml = `
        <tr style="border-bottom: 1px solid var(--color-border);">
          <td style="padding: 0.7rem 0.6rem; font-weight: 700; color: var(--color-text-main);">${escapeHtmlSafe(orderData.item || 'Ítem del pedido')}</td>
          <td style="padding: 0.7rem 0.5rem; font-family: monospace; font-weight: 700; color: var(--color-primary);">${escapeHtmlSafe(orderData.sku || '-')}</td>
          <td style="padding: 0.7rem 0.5rem; text-align: center; font-weight: 800;">${Number(orderData.cantidad) || 1}</td>
          <td style="padding: 0.7rem 0.5rem; text-align: center;">-</td>
          <td style="padding: 0.7rem 0.5rem; text-align: center;">-</td>
          <td style="padding: 0.7rem 0.5rem; text-align: right;">-</td>
          <td style="padding: 0.7rem 0.6rem; text-align: right; font-weight: 800;">${formatClpSafe(orderData.total_value)}</td>
        </tr>
      `;
    } else {
      itemsRowsHtml = `
        <tr>
          <td colspan="7" style="padding: 1.5rem; text-align: center; color: var(--color-text-muted); font-style: italic;">
            Sin ítems desglosados registrados para este pedido.
          </td>
        </tr>
      `;
    }

    // Construir Línea de Tiempo de Eventos del Picker para mostrar directamente en la sección de Picking
    const effectivePickerOperator = pickerData.operator
      || (window.pickerOperatorsMap && (window.pickerOperatorsMap[orderData.external_order_number] || window.pickerOperatorsMap[orderData.id]))
      || 'Sin operario asignado';

    let pickerBadgePill = '';
    if (pickerData.status) {
      const isOk = pickerData.isCompleted;
      pickerBadgePill = `
        <span style="font-size: 0.72rem; font-weight: 800; padding: 0.2rem 0.6rem; border-radius: 999px; background: ${isOk ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.16)'}; color: ${isOk ? '#059669' : '#d97706'}; border: 1px solid ${isOk ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)'}; display: inline-flex; align-items: center; gap: 0.25rem;">
          <i class="${isOk ? 'ri-checkbox-circle-fill' : 'ri-loader-2-line'}"></i> ${escapeHtmlSafe(pickerData.status)}
        </span>
      `;
    } else if (effectivePickerOperator !== 'Sin operario asignado') {
      pickerBadgePill = `
        <span style="font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3);">
          <i class="ri-user-follow-line"></i> Asignado en Picker
        </span>
      `;
    } else {
      pickerBadgePill = `
        <span style="font-size: 0.72rem; font-weight: 600; padding: 0.18rem 0.55rem; border-radius: 999px; background: var(--color-bg); color: var(--color-text-muted); border: 1px solid var(--color-border);">
          Sin actividad registrada en Picker
        </span>
      `;
    }

    let pickerTimelineInlineHtml = '';
    if (pickerData.historyLogs.length > 0) {
      pickerTimelineInlineHtml = `
        <div style="position: relative; padding-left: 1.35rem; display: flex; flex-direction: column; gap: 0.65rem; margin-top: 0.25rem;">
          <div style="position: absolute; left: 5px; top: 6px; bottom: 6px; width: 2px; background: var(--color-border);"></div>
          ${pickerData.historyLogs.slice(0, 5).map(log => {
            const isComp = ['Completado', 'COMPLETADO', 'Completado-Asistido', 'Listo para retiro', 'LISTO PARA RETIRO'].includes(log.estado);
            const dotColor = isComp ? '#10b981' : '#f59e0b';
            const dtStr = log.fecha ? `${log.fecha} ${log.hora || ''}`.trim() : new Date(log.created_at).toLocaleString('es-CL');
            const summaryParts = String(log.items_summary || '').split(',').map(s => s.trim()).filter(s => s && s !== '-');
            return `
              <div style="position: relative; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 8px; padding: 0.6rem 0.75rem;">
                <div style="position: absolute; left: -1.35rem; top: 10px; width: 12px; height: 12px; border-radius: 50%; background: ${dotColor}; border: 2px solid var(--color-surface); box-shadow: 0 0 0 1px ${dotColor};"></div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap;">
                  <span style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.3rem;">
                    <i class="ri-user-star-line" style="color: var(--color-primary);"></i> ${escapeHtmlSafe(log.picker || 'Operario')}
                    ${log.sucursal ? `<small style="color: var(--color-text-muted); font-weight: 500;">(${escapeHtmlSafe(log.sucursal)})</small>` : ''}
                  </span>
                  <span style="font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.45rem; border-radius: 4px; background: ${isComp ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)'}; color: ${isComp ? '#059669' : '#d97706'};">
                    ${escapeHtmlSafe(log.estado || 'Evento')}
                  </span>
                </div>
                <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                  <i class="ri-time-line"></i> ${escapeHtmlSafe(dtStr)}
                </div>
                ${log.comentarios ? `<div style="font-size: 0.76rem; color: var(--color-text-main); margin-top: 0.25rem;">${escapeHtmlSafe(log.comentarios)}</div>` : ''}
                ${summaryParts.length > 0 ? `
                  <div style="display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.35rem;">
                    ${summaryParts.map(p => `<span style="font-family: monospace; font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 4px; background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.28);">${escapeHtmlSafe(p)}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (pickerData.hasActive && pickerData.activeItem) {
      const act = pickerData.activeItem;
      pickerTimelineInlineHtml = `
        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 0.75rem; font-size: 0.8rem;">
          <div style="font-weight: 700; color: #d97706; margin-bottom: 0.25rem;"><i class="ri-loader-2-line"></i> Pedido actualmente en Cola Activa de Bodega</div>
          <div style="color: var(--color-text-muted);">Operario: <strong>${escapeHtmlSafe(act.operator || 'Por asignar')}</strong> · Sucursal: <strong>${escapeHtmlSafe(act.sucursal || 'Central')}</strong>${act.totu ? ` · Tote: <strong>#${escapeHtmlSafe(act.totu)}</strong>` : ''}</div>
        </div>
      `;
    } else {
      pickerTimelineInlineHtml = `
        <div style="background: var(--color-bg); border: 1px dashed var(--color-border); border-radius: 8px; padding: 0.85rem; text-align: center; font-size: 0.78rem; color: var(--color-text-muted);">
          No se registran escaneos históricos detallados en la base del Picker para este pedido.
        </div>
      `;
    }

    // Estado en plataforma original y exportación
    const origPlatStatus = window.getOriginalPlatformStatus ? window.getOriginalPlatformStatus(orderData) : (orderData.status || 'Recibido');
    const isExported = Boolean(orderData.shopify_exported);

    // Renderizar la Página Completa 360° del Pedido
    appContent.innerHTML = `
      <div class="single-order-page-wrap">
        
        <!-- 1. BARRA DE NAVEGACIÓN SUPERIOR -->
        <div class="sop-top-bar">
          <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
            <button type="button" class="sop-btn" onclick="document.querySelector('.nav-item[data-view=\\'${isAdmin ? 'orders_admin' : 'orders'}\\']')?.click()">
              <i class="ri-arrow-left-line"></i> ${isAdmin ? 'Ir a Torre de Control' : 'Ir a Mis Pedidos'}
            </button>
            <button type="button" class="sop-btn sop-btn-indigo" onclick="document.getElementById('${isAdmin ? 'admin-cmd-btn' : 'client-cmd-btn'}')?.click()">
              <i class="ri-search-eye-line"></i> Buscar otro pedido
              <kbd style="font-size: 0.66rem; padding: 0.08rem 0.35rem; background: var(--color-surface); border-radius: 4px; border: 1px solid var(--color-border);">Ctrl K</kbd>
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" class="sop-btn" onclick="window.copyOrderDirectLink('${orderData.id}', ${isAdmin})">
              <i class="ri-link"></i> Copiar Link del Pedido
            </button>
            <button type="button" class="sop-btn" onclick="window.renderSingleOrderPage('${orderData.id}', { isAdmin: ${isAdmin} })">
              <i class="ri-refresh-line"></i> Refrescar Datos
            </button>
            ${isAdmin ? `
              <button type="button" class="sop-btn sop-btn-primary" onclick="window.openWmsOrderModal('${orderData.id}')">
                <i class="ri-edit-box-line"></i> Editar Ficha Completa
              </button>
            ` : ''}
          </div>
        </div>

        <!-- 2. HERO CARD EJECUTIVO DEL PEDIDO -->
        <div class="sop-hero-card">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; border-bottom: 1px solid var(--color-border); padding-bottom: 1rem;">
            
            <!-- Identidad del Pedido y Plataforma -->
            <div style="display: flex; align-items: flex-start; gap: 0.9rem; flex-wrap: wrap;">
              <div style="width: 52px; height: 52px; border-radius: 12px; background: ${platMeta.bg}; color: ${platMeta.color}; border: 1px solid ${platMeta.border}; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; flex-shrink: 0;">
                <i class="${platMeta.icon}"></i>
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <h2 style="margin: 0; font-family: monospace; font-size: 1.65rem; font-weight: 800; color: var(--color-primary); letter-spacing: -0.02em;">
                    ${escapeHtmlSafe(displayNum)}
                  </h2>
                  ${copyBtn(orderData.external_order_number || orderData.id, 'N° Pedido')}
                  <span style="font-size: 0.78rem; font-weight: 800; padding: 0.22rem 0.65rem; border-radius: 999px; background: ${stStyle.bg}; color: ${stStyle.color}; border: 1px solid ${stStyle.border}; display: inline-flex; align-items: center; gap: 0.3rem;">
                    <i class="${stStyle.icon}"></i> ${escapeHtmlSafe(stStyle.label)}
                  </span>
                  ${heroCourierBadgeHtml}
                  ${categoriaBadgeHtml}
                  ${paymentBadgeHtml}
                </div>
                <div style="font-size: 0.81rem; color: var(--color-text-muted); display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                  <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i> Comercio: <strong style="color: var(--color-text-main);">${escapeHtmlSafe(orderData.comercio || 'Stocka')}</strong></span>
                  <span><i class="${platMeta.icon}" style="color: ${platMeta.color};"></i> Plataforma: <strong style="color: var(--color-text-main);">${escapeHtmlSafe(platMeta.name)}</strong></span>
                  <span><i class="ri-calendar-event-line"></i> Creado: <strong style="color: var(--color-text-main);">${escapeHtmlSafe(createdAtStr)}</strong> ${relativeAgeStr ? `<span style="color: var(--color-primary); font-weight: 600;">(${escapeHtmlSafe(relativeAgeStr)})</span>` : ''}</span>
                  <span style="font-family: monospace; font-size: 0.72rem; opacity: 0.8;">UUID: ${escapeHtmlSafe(orderData.id)}</span>
                </div>
              </div>
            </div>

            <!-- Botonera Operativa Principal -->
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              ${isAdmin ? `
                <div style="display: flex; align-items: center; gap: 0.4rem; background: var(--color-bg); padding: 0.32rem 0.65rem; border-radius: 8px; border: 1px solid var(--color-border);">
                  <label style="font-size: 0.73rem; font-weight: 700; color: var(--color-text-muted); margin: 0;">Estado WMS:</label>
                  <select class="status-select wms-status-select" data-order-id="${orderData.id}" style="padding: 0.24rem 0.5rem; font-size: 0.79rem; font-weight: 700; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); cursor: pointer;">
                    ${['En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia', 'Cancelado', 'Archivado'].map(st => `
                      <option value="${st}" ${(orderData.estado_wms || orderData.status) === st ? 'selected' : ''}>${st}</option>
                    `).join('')}
                  </select>
                </div>
              ` : ''}
              <button type="button" onclick="window.showShippingLabelModal('${orderData.id}')" class="sop-btn sop-btn-indigo">
                <i class="ri-printer-line"></i> Etiqueta Stocka
              </button>
              ${(orderData.label_url || orderData.label_base64 || orderData.tracking_number) ? `
                <button type="button" onclick="${orderData.label_url ? `window.open('${escapeHtmlSafe(orderData.label_url)}', '_blank')` : `window.downloadOrderLabel('${orderData.id}', '${escapeHtmlSafe(orderData.external_order_number || orderData.id)}', this)`}" class="sop-btn sop-btn-emerald">
                  <i class="ri-file-download-line"></i> Etiqueta Courier
                </button>
              ` : ''}
              ${(window.canSplitOrder && window.canSplitOrder(orderData)) ? `
                <button type="button" onclick="window.openSplitOrderModal('${orderData.id}')" class="sop-btn sop-btn-purple">
                  <i class="ri-scissors-2-line"></i> Dividir Pedido
                </button>
              ` : ''}
            </div>
          </div>

          <!-- Franja de 5 KPIs Ejecutivos -->
          <div class="sop-kpi-strip">
            <div class="sop-kpi-box">
              <div class="sop-kpi-icon" style="background: rgba(99, 102, 241, 0.12); color: #4f46e5;"><i class="ri-user-3-line"></i></div>
              <div class="sop-kpi-info">
                <span class="sop-kpi-label">Destinatario</span>
                <span class="sop-kpi-val" title="${escapeHtmlSafe(displayName)}">${escapeHtmlSafe(displayName)}</span>
              </div>
            </div>
            <div class="sop-kpi-box">
              <div class="sop-kpi-icon" style="background: rgba(16, 185, 129, 0.12); color: #059669;"><i class="ri-map-pin-2-line"></i></div>
              <div class="sop-kpi-info">
                <span class="sop-kpi-label">Comuna Destino</span>
                <span class="sop-kpi-val" style="display: flex; align-items: center; gap: 0.3rem;">
                  ${escapeHtmlSafe(orderData.shipping_city || 'No registrada')}
                  ${comunaBadgeHtml}
                </span>
              </div>
            </div>
            <div class="sop-kpi-box">
              <div class="sop-kpi-icon" style="background: rgba(37, 99, 235, 0.12); color: #2563eb;"><i class="ri-truck-line"></i></div>
              <div class="sop-kpi-info">
                <span class="sop-kpi-label">Courier / Flota</span>
                <span class="sop-kpi-val">${escapeHtmlSafe(effectiveCourier)}</span>
              </div>
            </div>
            <div class="sop-kpi-box">
              <div class="sop-kpi-icon" style="background: rgba(245, 158, 11, 0.14); color: #d97706;"><i class="ri-barcode-box-line"></i></div>
              <div class="sop-kpi-info">
                <span class="sop-kpi-label">N° Seguimiento</span>
                <span class="sop-kpi-val" style="font-family: monospace;">
                  ${effectiveTracking
                    ? (effectiveTrackingUrl
                        ? `<a href="${escapeHtmlSafe(effectiveTrackingUrl)}" target="_blank" rel="noopener" style="color: var(--color-primary); text-decoration: underline;">${escapeHtmlSafe(effectiveTracking)} <i class="ri-external-link-line"></i></a>`
                        : escapeHtmlSafe(effectiveTracking))
                    : '<span style="color: var(--color-text-muted); font-weight: 500;">Sin guía</span>'}
                </span>
              </div>
            </div>
            <div class="sop-kpi-box">
              <div class="sop-kpi-icon" style="background: rgba(16, 185, 129, 0.14); color: #059669;"><i class="ri-money-dollar-circle-line"></i></div>
              <div class="sop-kpi-info">
                <span class="sop-kpi-label">Valor Total (${totalUnits} unid.)</span>
                <span class="sop-kpi-val" style="color: var(--color-primary); font-size: 1.05rem;">${formatClpSafe(orderData.total_value)}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. SECCIÓN TIMELINE DE ETAPAS DEL PEDIDO (STEPPER HORIZONTAL) -->
        <div class="sop-stepper-card">
          <div class="sop-stepper-header">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="sop-section-icon"><i class="ri-route-line"></i></span>
              <div>
                <h3 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: var(--color-text-main);">Línea de Tiempo y Estado de Avance del Pedido</h3>
                <p style="margin: 0; font-size: 0.75rem; color: var(--color-text-muted);">Trazabilidad etapa por etapa desde la recepción en el canal de venta hasta el despacho y entrega final</p>
              </div>
            </div>
            <span style="font-size: 0.76rem; font-weight: 800; color: ${trackingInfo.isDelivered ? '#047857' : (trackingInfo.isAlert ? '#b91c1c' : stStyle.color)}; background: ${trackingInfo.isDelivered ? 'rgba(16, 185, 129, 0.16)' : (trackingInfo.isAlert ? 'rgba(239, 68, 68, 0.14)' : stStyle.bg)}; border: 1px solid ${trackingInfo.isDelivered ? 'rgba(16, 185, 129, 0.4)' : (trackingInfo.isAlert ? 'rgba(239, 68, 68, 0.35)' : stStyle.border)}; padding: 0.24rem 0.7rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.3rem;">
              <i class="${trackingInfo.isDelivered ? 'ri-checkbox-circle-fill' : (trackingInfo.isInTransit ? 'ri-truck-line' : stStyle.icon)}"></i>
              Etapa Actual: ${escapeHtmlSafe(
                trackingInfo.isDelivered
                  ? `Entregado (${trackingInfo.rawStatusText || 'Confirmado'})`
                  : (trackingInfo.isInTransit && String(orderData.estado_wms || '').toLowerCase() === 'despachado'
                      ? `En Tránsito (${trackingInfo.rawStatusText || 'En ruta'})`
                      : stStyle.label)
              )}
            </span>
          </div>
          <div class="sop-stepper-track">
            ${stepperHtml}
          </div>
        </div>

        <!-- 4. SECCIÓN PRINCIPAL: DESGLOSE DE PRODUCTOS (62%) + DATOS DEL DESTINATARIO Y NOTAS (38%) -->
        <div class="sop-grid-main">
          
          <!-- Columna Izquierda Amplia: Ítems del Pedido, Verificación Picker y Stock -->
          <div class="sop-section-card">
            <div class="sop-section-header">
              <h4 class="sop-section-title">
                <span class="sop-section-icon"><i class="ri-shopping-basket-2-line"></i></span>
                <span>Detalle de Productos, Escaneo Picker y Stock (${items.length} SKU · ${totalUnits} unid.)</span>
              </h4>
              ${(isAdmin || ((orderData.estado_wms || orderData.status || '').trim().toLowerCase() === 'en procesamiento')) ? `
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                  <button type="button" onclick="window.openEditOrderItemsModal('${orderData.id}')" class="sop-btn" style="cursor: pointer;" title="Editar productos y cantidades de este pedido">
                    <i class="ri-edit-line"></i> Editar Ítems
                  </button>
                </div>
              ` : ''}
            </div>

            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem;">
                <thead>
                  <tr style="border-bottom: 2px solid var(--color-border); text-align: left; color: var(--color-text-muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em;">
                    <th style="padding: 0.45rem 0.6rem;">Producto / Bodega</th>
                    <th style="padding: 0.45rem 0.5rem;">SKU / Barcode</th>
                    <th style="padding: 0.45rem 0.5rem; text-align: center;">Cant.</th>
                    <th style="padding: 0.45rem 0.5rem; text-align: center;">Escaneo Picker</th>
                    <th style="padding: 0.45rem 0.5rem; text-align: center;">Stock Bodega</th>
                    <th style="padding: 0.45rem 0.5rem; text-align: right;">P. Unit</th>
                    <th style="padding: 0.45rem 0.6rem; text-align: right;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRowsHtml}
                </tbody>
                <tfoot>
                  <tr style="border-top: 2px solid var(--color-border); background: var(--color-bg);">
                    <td colspan="2" style="padding: 0.75rem 0.6rem; font-size: 0.8rem; color: var(--color-text-muted); font-weight: 600;">
                      Total: <strong>${items.length}</strong> línea(s) · <strong>${totalUnits}</strong> unidad(es)
                    </td>
                    <td colspan="4" style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 800; color: var(--color-text-main); font-size: 0.88rem;">
                      Valor Total Pedido:
                    </td>
                    <td style="padding: 0.75rem 0.6rem; text-align: right; font-weight: 800; color: var(--color-primary); font-size: 1.05rem;">
                      ${formatClpSafe(orderData.total_value)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            ${isAdmin ? `
              <div style="margin-top: 0.25rem; padding-top: 0.75rem; border-top: 1px dashed var(--color-border); display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem;">
                  <span style="color: var(--color-text-muted);"><i class="ri-archive-line" style="color: var(--color-primary);"></i> Estado Descuento Kardex:</span>
                  <span style="font-weight: 800; padding: 0.15rem 0.55rem; border-radius: 6px; background: ${orderData.stock_descontado ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.14)'}; color: ${orderData.stock_descontado ? '#059669' : '#d97706'};">
                    ${orderData.stock_descontado ? '✓ Stock Descontado' : '⏳ Pendiente de Descuento'}
                  </span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <button type="button" onclick="window.openChangeStockWarehouseModal(['${orderData.id}'])" class="sop-btn">
                    <i class="ri-exchange-box-line"></i> Cambiar Bodega de Stock
                  </button>
                  ${(window.wmsAllComercios && window.wmsAllComercios.length > 0) ? `
                    <select onchange="window.reassignOrderCommerce('${orderData.id}', this.value, this)" class="cmd-criteria-select" style="height: 32px; font-size: 0.76rem;" title="Reasignar este pedido a otro comercio">
                      ${window.wmsAllComercios.map(c => `<option value="${escapeHtmlSafe(c)}" ${c === orderData.comercio ? 'selected' : ''}>Comercio: ${escapeHtmlSafe(c)}</option>`).join('')}
                    </select>
                  ` : ''}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Columna Derecha: Ficha del Destinatario, Dirección de Entrega y Notas -->
          <div class="sop-section-card">
            <div class="sop-section-header">
              <h4 class="sop-section-title">
                <span class="sop-section-icon"><i class="ri-user-location-line"></i></span>
                <span>Destinatario y Despacho</span>
              </h4>
              ${isAdmin ? `
                <div style="display: flex; gap: 0.35rem;">
                  <button type="button" onclick="window.editWmsOrderShippingDetails('${orderData.id}')" class="sop-btn" style="padding: 0.3rem 0.6rem; font-size: 0.74rem;">
                    <i class="ri-edit-line"></i> Editar Datos
                  </button>
                  <button type="button" onclick="window.editWmsOrderComuna('${orderData.id}')" class="sop-btn" style="padding: 0.3rem 0.6rem; font-size: 0.74rem;">
                    <i class="ri-map-pin-line"></i> Comuna
                  </button>
                </div>
              ` : ''}
            </div>

            <div class="sop-info-list">
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-user-line" style="color: var(--color-primary);"></i> Destinatario</span>
                <span class="sop-info-val">${escapeHtmlSafe(displayName)} ${copyBtn(displayName, 'Nombre')}</span>
              </div>
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-mail-line" style="color: var(--color-primary);"></i> Email</span>
                <span class="sop-info-val">${escapeHtmlSafe(displayEmail)} ${copyBtn(displayEmail, 'Email')}</span>
              </div>
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-phone-line" style="color: var(--color-primary);"></i> Teléfono</span>
                <span class="sop-info-val">
                  ${escapeHtmlSafe(displayPhone)}
                  ${whatsappHref ? `<a href="${whatsappHref}" target="_blank" rel="noopener" style="color: #16a34a; font-size: 0.75rem; background: rgba(22, 163, 74, 0.12); padding: 0.1rem 0.4rem; border-radius: 6px; text-decoration: none; font-weight: 700;" title="Contactar por WhatsApp"><i class="ri-whatsapp-line"></i> WhatsApp</a>` : ''}
                  ${copyBtn(displayPhone, 'Teléfono')}
                </span>
              </div>
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-map-pin-line" style="color: var(--color-primary);"></i> Dirección</span>
                <span class="sop-info-val">${escapeHtmlSafe(fullAddress)} ${copyBtn(fullAddress, 'Dirección')}</span>
              </div>
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-building-2-line" style="color: var(--color-primary);"></i> Comuna</span>
                <span class="sop-info-val">
                  ${escapeHtmlSafe(orderData.shipping_city || 'No registrada')}
                  ${comunaBadgeHtml}
                  ${copyBtn(orderData.shipping_city, 'Comuna')}
                </span>
              </div>
            </div>

            <!-- Método de Envío en Bloque Destacado -->
            <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 8px; padding: 0.65rem 0.8rem;">
              <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.3rem;">
                <i class="ri-send-plane-line" style="color: var(--color-primary);"></i> Método / Promesa de Envío
              </div>
              <div style="font-size: 0.82rem; font-weight: 600; color: var(--color-text-main); line-height: 1.4;">
                ${escapeHtmlSafe(orderData.shipping_method || 'Envío Estándar')}
              </div>
            </div>

            <!-- Notas del Pedido (Cliente/Tienda) -->
            <div style="background: ${orderNote ? 'rgba(245, 158, 11, 0.08)' : 'var(--color-bg)'}; border: 1px solid ${orderNote ? 'rgba(245, 158, 11, 0.3)' : 'var(--color-border)'}; border-left: 3px solid ${orderNote ? '#f59e0b' : 'var(--color-text-muted)'}; padding: 0.65rem 0.8rem; border-radius: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.2rem;">
                <strong style="color: ${orderNote ? '#d97706' : 'var(--color-text-muted)'}; font-size: 0.78rem; display: flex; align-items: center; gap: 0.3rem;">
                  <i class="ri-chat-3-line"></i> Notas del Pedido (Cliente / Tienda):
                </strong>
                ${copyBtn(orderNote, 'Notas')}
              </div>
              <div style="font-size: 0.82rem; color: var(--color-text-main); white-space: pre-wrap;">
                ${orderNote ? escapeHtmlSafe(orderNote) : '<span style="color: var(--color-text-muted); font-style: italic;">Sin observaciones del comprador</span>'}
              </div>
            </div>

            ${isAdmin ? `
              <!-- Nota Interna Exclusiva Administradores WMS -->
              <div id="wms-admin-notes-card-${orderData.id}" style="background: ${adminNote ? 'rgba(99, 102, 241, 0.07)' : 'var(--color-bg)'}; border: 1px solid ${adminNote ? 'rgba(99, 102, 241, 0.35)' : 'var(--color-border)'}; border-left: 3px solid #6366f1; padding: 0.65rem 0.8rem; border-radius: 8px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem;">
                  <strong style="color: #4f46e5; font-size: 0.78rem; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="ri-lock-2-line"></i> Nota Interna (Solo Admins WMS):
                  </strong>
                  <div style="display: inline-flex; align-items: center; gap: 0.25rem;">
                    ${adminNote ? copyBtn(adminNote, 'Nota Interna Admin') : ''}
                    <button type="button" onclick="window.toggleEditAdminNote('${orderData.id}')" class="sop-btn" style="padding: 0.15rem 0.45rem; font-size: 0.7rem; color: #4338ca;">
                      <i class="ri-edit-line"></i> ${adminNote ? 'Editar' : 'Añadir Nota'}
                    </button>
                  </div>
                </div>
                <div id="wms-admin-note-view-${orderData.id}" style="font-size: 0.82rem; color: var(--color-text-main); white-space: pre-wrap;">
                  ${adminNote ? escapeHtmlSafe(adminNote) : '<span style="color: var(--color-text-muted); font-style: italic;">Sin nota interna registrada.</span>'}
                </div>
                <div id="wms-admin-note-edit-${orderData.id}" style="display: none; margin-top: 0.4rem;">
                  <textarea id="wms-admin-note-input-${orderData.id}" class="wms-input-ctrl" style="width: 100%; min-height: 65px; font-size: 0.8rem; padding: 0.4rem; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.4); margin-bottom: 0.35rem;" placeholder="Escribe anotación interna visible solo para administradores...">${escapeHtmlSafe(adminNote)}</textarea>
                  <div style="display: flex; justify-content: flex-end; gap: 0.35rem;">
                    <button type="button" onclick="window.cancelEditAdminNote('${orderData.id}')" class="sop-btn" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;">Cancelar</button>
                    <button type="button" id="btn-save-admin-note-${orderData.id}" onclick="window.saveOrderAdminNote('${orderData.id}')" class="sop-btn sop-btn-primary" style="padding: 0.2rem 0.6rem; font-size: 0.72rem;">
                      <i class="ri-save-line"></i> Guardar
                    </button>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 5. SECCIÓN INFERIOR (50% / 50%): ETAPAS Y TRAZABILIDAD DEL PICKING vs PLATAFORMA Y TRANSPORTE -->
        <div class="sop-grid-two">
          
          <!-- Izquierda: Etapas y Trazabilidad de Picking en Bodega -->
          <div class="sop-section-card">
            <div class="sop-section-header">
              <h4 class="sop-section-title">
                <span class="sop-section-icon"><i class="ri-barcode-box-line"></i></span>
                <span>Etapas y Trazabilidad de Picking en Bodega</span>
              </h4>
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                ${pickerBadgePill}
                <button type="button" onclick="window.openPickerOrderHistoryModal('${orderData.id}')" class="sop-btn sop-btn-indigo" style="padding: 0.26rem 0.6rem; font-size: 0.73rem;">
                  <i class="ri-history-line"></i> Modal Auditoría
                </button>
                ${isAdmin ? `
                  <button type="button" onclick="window.editWmsOrderPickingInfo('${orderData.id}')" class="sop-btn" style="padding: 0.26rem 0.55rem; font-size: 0.73rem;">
                    <i class="ri-edit-line"></i> Editar Picking
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- 6 Cajas de Parámetros Operativos de Picking -->
            <div class="sop-mini-grid">
              <div class="sop-mini-stat">
                <span class="sop-mini-stat-label">Sucursal Asignada</span>
                <span class="sop-mini-stat-val" style="color: var(--color-primary);">${escapeHtmlSafe(orderData.sucursal_pickeo || pickerData.sucursal || 'No asignada')}</span>
              </div>
              <div class="sop-mini-stat">
                <span class="sop-mini-stat-label">Agenda de Preparación</span>
                <span class="sop-mini-stat-val">${escapeHtmlSafe(orderData.agenda || 'No definida')}</span>
              </div>
              <div class="sop-mini-stat">
                <span class="sop-mini-stat-label">Operario Picker</span>
                <span class="sop-mini-stat-val" style="color: #059669;">${escapeHtmlSafe(effectivePickerOperator)}</span>
              </div>
              <div class="sop-mini-stat">
                <span class="sop-mini-stat-label">Cesta / Tote</span>
                <span class="sop-mini-stat-val">${pickerData.totu ? `#${escapeHtmlSafe(pickerData.totu)}` : 'Sin tote activo'}</span>
              </div>
              <div class="sop-mini-stat">
                <span class="sop-mini-stat-label">Operador / Flota</span>
                <span class="sop-mini-stat-val">${escapeHtmlSafe(orderData.operador || 'No asignado')}</span>
              </div>
              <div class="sop-mini-stat">
                <span class="sop-mini-stat-label">Fecha Procesamiento</span>
                <span class="sop-mini-stat-val">${escapeHtmlSafe(orderData.fecha_procesamiento || 'Automática')}</span>
              </div>
            </div>

            <!-- Línea de Tiempo de Eventos y Escaneos en Picker -->
            <div>
              <div style="font-size: 0.76rem; font-weight: 800; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 0.45rem; display: flex; align-items: center; justify-content: space-between;">
                <span><i class="ri-git-commit-line" style="color: var(--color-primary);"></i> Registro de Escaneos y Actividad en Picker (${pickerData.historyLogs.length})</span>
              </div>
              ${pickerTimelineInlineHtml}
            </div>

            <!-- Solicitud Especial de Picking -->
            ${(window.renderOrderPickingRequestCard ? window.renderOrderPickingRequestCard(orderData) : '')}
          </div>

          <!-- Derecha: Detalles de Plataforma, Integración y Seguimiento Auto-Track -->
          <div class="sop-section-card">
            <div class="sop-section-header">
              <h4 class="sop-section-title">
                <span class="sop-section-icon"><i class="ri-global-line"></i></span>
                <span>Detalles de Plataforma, Courier y Auto-Track</span>
              </h4>
              ${isAdmin ? `
                <button type="button" onclick="window.editWmsOrderCourierAndTracking('${orderData.id}')" class="sop-btn" style="padding: 0.26rem 0.6rem; font-size: 0.73rem;">
                  <i class="ri-edit-line"></i> Editar Envío
                </button>
              ` : ''}
            </div>

            <!-- Sub-sección 1: Información de Plataforma e Integración -->
            <div class="sop-info-list">
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-instance-line" style="color: var(--color-primary);"></i> Canal / Plataforma</span>
                <span class="sop-info-val">
                  <span style="background: ${platMeta.bg}; color: ${platMeta.color}; border: 1px solid ${platMeta.border}; padding: 0.12rem 0.5rem; border-radius: 6px; font-size: 0.76rem;">
                    <i class="${platMeta.icon}"></i> ${escapeHtmlSafe(platMeta.name)}
                  </span>
                </span>
              </div>
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-hashtag" style="color: var(--color-primary);"></i> ID Orden Plataforma</span>
                <span class="sop-info-val" style="font-family: monospace;">${escapeHtmlSafe(orderData.external_order_number || '-')} ${copyBtn(orderData.external_order_number, 'ID Orden')}</span>
              </div>
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-store-3-line" style="color: var(--color-primary);"></i> Estado en Tienda Origen</span>
                <span class="sop-info-val">${escapeHtmlSafe(origPlatStatus)}</span>
              </div>
              <div class="sop-info-row">
                <span class="sop-info-key"><i class="ri-upload-cloud-2-line" style="color: var(--color-primary);"></i> Sincronización Fulfillment</span>
                <span class="sop-info-val">
                  <span style="font-size: 0.74rem; padding: 0.1rem 0.45rem; border-radius: 6px; background: ${isExported ? 'rgba(16, 185, 129, 0.12)' : 'rgba(100, 116, 139, 0.12)'}; color: ${isExported ? '#059669' : '#64748b'};">
                    ${isExported ? '✓ Exportado a tienda' : 'Pendiente / Local'}
                  </span>
                </span>
              </div>
            </div>

            ${window.renderOrderManualCreatorHtml ? window.renderOrderManualCreatorHtml(orderData) : ''}

            <!-- Sub-sección 2: Monitoreo Auto-Track y Courier -->
            <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 10px; padding: 0.9rem; display: flex; flex-direction: column; gap: 0.55rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.4rem;">
                <span style="font-size: 0.78rem; font-weight: 800; text-transform: uppercase; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;">
                  <i class="ri-radar-line" style="color: #10b981; font-size: 1rem;"></i> Monitoreo de Despacho (Auto-Track)
                </span>
                <span style="font-size: 0.72rem; font-weight: 800; padding: 0.16rem 0.6rem; border-radius: 999px; background: ${autoTrackBadgeStyle.bg}; color: ${autoTrackBadgeStyle.color}; border: 1px solid ${autoTrackBadgeStyle.border}; text-transform: uppercase; display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="${autoTrackBadgeStyle.icon}"></i>
                  ${escapeHtmlSafe(trackingInfo.globalStatus)}
                </span>
              </div>

              <div class="sop-mini-grid">
                <div class="sop-mini-stat" style="background: var(--color-surface);">
                  <span class="sop-mini-stat-label">Courier Oficial</span>
                  <span class="sop-mini-stat-val">${escapeHtmlSafe(effectiveCourier)}</span>
                </div>
                <div class="sop-mini-stat" style="background: var(--color-surface);">
                  <span class="sop-mini-stat-label">Estado Detallado Courier</span>
                  <span class="sop-mini-stat-val" style="color: ${autoTrackBadgeStyle.color};">${escapeHtmlSafe(trackingInfo.rawStatusText || '-')}</span>
                </div>
                <div class="sop-mini-stat" style="background: var(--color-surface);">
                  <span class="sop-mini-stat-label">Código de Seguimiento</span>
                  <span class="sop-mini-stat-val" style="font-family: monospace;">
                    ${effectiveTracking
                      ? (effectiveTrackingUrl
                          ? `<a href="${escapeHtmlSafe(effectiveTrackingUrl)}" target="_blank" rel="noopener" style="color: var(--color-primary);">${escapeHtmlSafe(effectiveTracking)} <i class="ri-external-link-line"></i></a>`
                          : escapeHtmlSafe(effectiveTracking))
                      : 'Sin guía'}
                  </span>
                </div>
                <div class="sop-mini-stat" style="background: var(--color-surface);">
                  <span class="sop-mini-stat-label">Fuente / Última Act.</span>
                  <span class="sop-mini-stat-val" style="font-size: 0.74rem;">
                    ${escapeHtmlSafe(trackingInfo.sourceTable)} · ${trackingInfo.updatedAt ? escapeHtmlSafe(new Date(trackingInfo.updatedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })) : '-'}
                  </span>
                </div>
              </div>
            </div>

            ${isAdmin ? `
              <!-- Botonera de Acciones de Integración y Logística (Solo Admin) -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.5rem; margin-top: 0.2rem;">
                <button type="button" onclick="window.wmsCreateManifestFromSingleOrder('${orderData.id}')" class="sop-btn sop-btn-indigo">
                  <i class="ri-file-paper-2-line"></i> Crear Manifiesto
                </button>
                <button type="button" onclick="window.openQuickBranchExchangeReceiptModal('${escapeHtmlSafe(orderData.external_order_number || orderData.id)}')" class="sop-btn sop-btn-purple">
                  <i class="ri-file-list-3-line"></i> Comprobante Cambio
                </button>
                ${(orderData.external_platform === 'Shopify' || orderData.origen === 'Shopify' || orderData.raw_shopify_data) ? `
                  <button type="button" id="btn-resync-shopify-${orderData.id}" onclick="window.resyncShopifyOrder('${orderData.id}')" class="sop-btn sop-btn-emerald">
                    <i class="ri-refresh-line"></i> Sync desde Shopify
                  </button>
                ` : ''}
                <button type="button" id="btn-resync-enviame-${orderData.id}" onclick="window.resyncEnviameOrder('${orderData.id}')" class="sop-btn sop-btn-amber">
                  <i class="ri-refresh-line"></i> Consultar Envíame
                </button>
              </div>
            ` : ''}
          </div>
        </div>

        ${isAdmin ? `
          <!-- 6. SECCIÓN AUDITORÍA WMS Y PAYLOAD JSON (SOLO ADMIN) -->
          <div class="sop-grid-two">
            <div class="sop-section-card">
              <div class="sop-section-header">
                <h4 class="sop-section-title">
                  <span class="sop-section-icon"><i class="ri-history-line"></i></span>
                  <span>Historial de Modificaciones en WMS (Auditoría)</span>
                </h4>
                <button type="button" onclick="window.loadOrderAuditLogs('${orderData.id}')" class="sop-btn" style="padding: 0.25rem 0.55rem; font-size: 0.73rem;">
                  <i class="ri-refresh-line"></i> Actualizar
                </button>
              </div>
              <div id="wms-order-audit-timeline-${orderData.id}" style="font-size: 0.82rem; color: var(--color-text-muted); padding: 0.5rem;">
                <i class="ri-loader-4-line spin"></i> Cargando historial de auditoría...
              </div>
            </div>

            <div class="sop-section-card">
              <div class="sop-section-header">
                <h4 class="sop-section-title">
                  <span class="sop-section-icon"><i class="ri-code-s-slash-line"></i></span>
                  <span>Inspector de Payload / JSON Crudo (${escapeHtmlSafe(platMeta.name)})</span>
                </h4>
                <button type="button" onclick="window.toggleRawOrderJson('${orderData.id}')" class="sop-btn" style="padding: 0.25rem 0.6rem; font-size: 0.73rem;">
                  <i class="ri-eye-line"></i> Mostrar / Ocultar JSON
                </button>
              </div>
              <p style="margin: 0; font-size: 0.78rem; color: var(--color-text-muted);">
                Permite auditar los datos técnicos originales recibidos desde la integración de e-commerce o courier.
              </p>
              <pre id="raw-json-${orderData.id}" style="display: none; max-height: 360px; overflow: auto; background: #0f172a; color: #e2e8f0; padding: 0.85rem; border-radius: 8px; font-size: 0.74rem; line-height: 1.4;"><i class="ri-loader-4-line spin"></i></pre>
            </div>
          </div>
        ` : ''}

      </div>
    `;

    window._lastRenderedOrderPageHtml = appContent.innerHTML;

    if (isAdmin && typeof window.loadOrderAuditLogs === 'function') {
      window.loadOrderAuditLogs(orderData.id);
    }

    if (window._orderPageGuardObserver) {
      window._orderPageGuardObserver.disconnect();
    }
    const guardObs = new MutationObserver(() => {
      if (!window._suppressDashboardForOrderPage || !window._activeSingleOrderPageId) {
        guardObs.disconnect();
        return;
      }
      if (!appContent.querySelector('.single-order-page-wrap') && window._lastRenderedOrderPageHtml) {
        appContent.innerHTML = window._lastRenderedOrderPageHtml;
        if (isAdmin && typeof window.loadOrderAuditLogs === 'function') {
          window.loadOrderAuditLogs(orderData.id);
        }
      }
    });
    guardObs.observe(appContent, { childList: true });
    window._orderPageGuardObserver = guardObs;
    setTimeout(() => {
      if (window._orderPageGuardObserver === guardObs) {
        guardObs.disconnect();
      }
    }, 8000);

  } catch (err) {
    console.error('[SingleOrderPage] Error al renderizar página de pedido:', err);
    appContent.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; max-width: 580px; margin: 2rem auto;">
        <i class="ri-error-warning-line" style="font-size: 2.5rem; color: #ef4444; display: block; margin-bottom: 0.5rem;"></i>
        <h3 style="margin: 0 0 0.4rem 0;">Error al cargar el pedido</h3>
        <p style="color: var(--color-text-muted); font-size: 0.85rem;">${escapeHtmlSafe(err.message || String(err))}</p>
      </div>
    `;
  }
};

// ============================================================================
// 4. INICIALIZACIÓN AUTOMÁTICA EN PANEL ADMIN Y PORTAL CLIENTE
// ============================================================================
function initOrderSearchAndPageModule() {
  injectOrderSearchStyles();

  if (document.getElementById('admin-cmd-dropdown')) {
    attachMultiCriteriaOrderSearch({
      dropdownId: 'admin-cmd-dropdown',
      inputId: 'admin-cmd-input',
      resultsId: 'admin-cmd-results',
      isAdmin: true
    });
  }

  if (document.getElementById('client-cmd-dropdown')) {
    attachMultiCriteriaOrderSearch({
      dropdownId: 'client-cmd-dropdown',
      inputId: 'client-cmd-input',
      resultsId: 'client-cmd-results',
      isAdmin: false
    });
  }

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.nav-item[data-view]');
    if (nav && (window._activeSingleOrderPageId || window._suppressDashboardForOrderPage)) {
      window._suppressDashboardForOrderPage = false;
      window._activeSingleOrderPageId = null;
      window._lastRenderedOrderPageHtml = null;
      if (typeof window._originalApplyWmsFiltersAndRender === 'function') {
        window.applyWmsFiltersAndRender = window._originalApplyWmsFiltersAndRender;
      }
      if (window._orderPageGuardObserver) {
        window._orderPageGuardObserver.disconnect();
        window._orderPageGuardObserver = null;
      }
      const url = new URL(window.location.href);
      const rawHash = (url.hash || '').replace(/^#/, '');
      const hasOrderHash = /^(?:order|pedido)=/i.test(rawHash);
      if (url.searchParams.has('order') || url.searchParams.has('pedido') || hasOrderHash) {
        url.searchParams.delete('order');
        url.searchParams.delete('pedido');
        const nextHash = hasOrderHash ? '' : url.hash;
        window.history.replaceState({}, '', url.pathname + url.search + nextHash);
      }
    }
  }, true);

  const pendingOrderId = window._pendingSingleOrderPage?.orderId || INITIAL_DETECTED_ORDER_ID || consumePendingOrderFromUrlOrStorage();
  if (pendingOrderId) {
    const isAdmin = window._pendingSingleOrderPage?.isAdmin !== undefined
      ? window._pendingSingleOrderPage.isAdmin
      : Boolean(document.getElementById('admin-cmd-container') || window.location.pathname.includes('admin'));
    delete window._pendingSingleOrderPage;
    window.renderSingleOrderPage(pendingOrderId, { isAdmin });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOrderSearchAndPageModule);
} else {
  initOrderSearchAndPageModule();
}
