// js/inventory_count.js - Conteo de Inventario Móvil y PC Colaborativo STOCKA WMS (v1.1.0 Optimizado)
import supabaseInstance from './supabase.js';

// Cliente Supabase seguro con fallback
const supabase = (supabaseInstance && typeof supabaseInstance.from === 'function')
  ? supabaseInstance
  : (window.supabaseClient && typeof window.supabaseClient.from === 'function' ? window.supabaseClient : supabaseInstance);

// ==========================================
// ESTADO GLOBAL DEL MÓDULO DE CONTEO
// ==========================================
let activeCountSession = null;
let activeTabName = 'scanner';
let html5QrCodeScanner = null;
let isScannerRunning = false;
let isTorchOn = false;
let currentCameraFacing = 'environment';
let isScanProcessing = false;
let realtimeChannel = null;
let isRealtimeConnected = false;
let fallbackPollingInterval = null;
let unmountObserver = null;
let audioCtx = null;

// Caché de sesión e índices O(1) para rendimiento en PCs lentos
let sessionItemsCache = [];
let sessionItemsById = new Map();
let sessionCatalogCache = [];
let catalogById = new Map();
let catalogByBarcode = new Map();
let catalogByWms = new Map();
let catalogBySku = new Map();
let catalogByAlias = new Map();
let catalogByAltBarcode = new Map();
let isCatalogPreloading = false;
let catalogPreloadedForKey = '';

// Caché de stock teórico por bodega y cuadratura en memoria
let warehouseStockMap = new Map();
let warehouseStockLoadedKey = '';
let cachedReconData = null;
let reconDataDirty = true;

// Metadatos
let sessionWarehouses = [];
let sessionMerchants = [];

// Estado UI / Filtros / Paginación
let currentReconFilter = 'all';
let currentReconSearch = '';
let reconPage = 1;
let reconPageSize = 50;

let logsSearchQuery = '';
let logsOperatorFilter = 'all';
let logsSortMode = 'newest';
let logsPage = 1;
let logsPageSize = 50;
let selectedLogIds = new Set();

let feedSearchQuery = '';
let lastFeedSignature = '';

// Detección automática de equipos con recursos limitados
function detectLowResourceDevice() {
  try {
    const saved = localStorage.getItem('stocka_inv_lite_mode');
    if (saved === 'true') return true;
    if (saved === 'false') return false;
    const cores = navigator.hardwareConcurrency || 8;
    const mem = navigator.deviceMemory || 8;
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return prefersReduced || cores <= 4 || mem <= 4;
  } catch (e) {
    return false;
  }
}

// Configuración del operador en este dispositivo
let isLiteMode = detectLowResourceDevice();
let localOperatorName = localStorage.getItem('stocka_inv_operator_name') || 'Admin Móvil';
let localDeviceId = localStorage.getItem('stocka_inv_device_id') || ('DEV-' + Math.random().toString(36).substring(2, 9).toUpperCase());
let isFastMode = localStorage.getItem('stocka_inv_fast_mode') === 'true';
let currentMatchMode = localStorage.getItem('stocka_inv_match_mode') || 'all';
let keyboardMode = localStorage.getItem('stocka_inv_keyboard_mode') || (typeof window !== 'undefined' && window.innerWidth >= 992 ? 'alpha' : 'numeric');
const savedNumpadPref = localStorage.getItem('stocka_inv_numpad_expanded');
let isNumpadExpanded = savedNumpadPref !== null ? (savedNumpadPref === 'true') : (typeof window !== 'undefined' ? window.innerWidth < 992 : false);
let currentReticleMode = localStorage.getItem('stocka_inv_reticle_mode') || 'standard';
let currentZoomLevel = 1.0;
let currentInputSource = localStorage.getItem('stocka_inv_input_source') || (typeof window !== 'undefined' && window.innerWidth >= 992 ? 'scanner_gun' : 'camera');
let lastScannedItemInfo = null;
let barcodeBuffer = '';
let lastKeyTime = Date.now();
let globalBarcodeListenerAttached = false;
let visibilityListenerAttached = false;

localStorage.setItem('stocka_inv_device_id', localDeviceId);
localStorage.setItem('stocka_inv_operator_name', localOperatorName);

// ==========================================
// HELPERS GENERALES Y AUDIO/HÁPTICO
// ==========================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function debounce(fn, wait = 180) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function isModuleMounted() {
  return !!document.getElementById('inv-count-root-wrapper');
}

function isAnyModalOpen() {
  const sheet = document.getElementById('inv-confirm-sheet');
  if (sheet && sheet.classList.contains('active')) return true;
  if (document.querySelector('.inv-picker-modal-overlay, #modal-inv-close-apply, #modal-inv-share-qr, #modal-inv-sessions-list, #modal-inv-new-session')) {
    return true;
  }
  return false;
}

function playBeepSound(type = 'success') {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.11, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.11);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.11);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.14, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.22);
    } else if (type === 'tap') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(850, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.04);
    } else if (type === 'focus') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(650, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, audioCtx.currentTime + 0.07);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.07);
    }
  } catch (e) {}
}

function triggerHaptic(type = 'success') {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      if (type === 'success') navigator.vibrate([50]);
      else if (type === 'error') navigator.vibrate([90, 45, 90]);
      else if (type === 'tap') navigator.vibrate([10]);
      else if (type === 'focus') navigator.vibrate([15, 20, 18]);
    } catch (e) {}
  }
}

function showInlineToast(msg, type = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(msg, type);
    return;
  }
  let el = document.getElementById('inv-inline-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'inv-inline-toast';
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10090;padding:0.65rem 1rem;border-radius:8px;font-size:0.82rem;font-weight:700;color:#fff;box-shadow:0 8px 20px rgba(0,0,0,0.2);max-width:340px;';
    document.body.appendChild(el);
  }
  el.style.background = type === 'error' ? '#ef4444' : (type === 'warning' ? '#f59e0b' : '#10b981');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 2800);
}

function getQrBoxForReticleMode(mode) {
  if (mode === 'precision') return { width: 170, height: 120 };
  if (mode === 'wide') return { width: 320, height: 95 };
  return { width: 280, height: 180 };
}

function getReticleModeLabel(mode) {
  if (mode === 'precision') return 'Modo Precisión (Códigos pegados)';
  if (mode === 'wide') return 'Barras 1D (Franja ancha)';
  return 'Apunta al código (Toca para enfocar)';
}

// ==========================================
// LIMPIEZA DE RECURSOS AL SALIR DEL MÓDULO
// ==========================================
async function cleanupInventoryCountModule() {
  await stopScannerSafe();
  if (realtimeChannel) {
    try { supabase.removeChannel(realtimeChannel); } catch (e) {}
    realtimeChannel = null;
    isRealtimeConnected = false;
  }
  if (fallbackPollingInterval) {
    clearInterval(fallbackPollingInterval);
    fallbackPollingInterval = null;
  }
  if (unmountObserver) {
    try { unmountObserver.disconnect(); } catch (e) {}
    unmountObserver = null;
  }
}

function watchModuleUnmount() {
  if (unmountObserver) {
    try { unmountObserver.disconnect(); } catch (e) {}
    unmountObserver = null;
  }
  const appContent = document.getElementById('app-content');
  if (!appContent || typeof MutationObserver === 'undefined') return;

  unmountObserver = new MutationObserver(() => {
    if (!isModuleMounted()) {
      cleanupInventoryCountModule();
    }
  });
  unmountObserver.observe(appContent, { childList: true });
}

// ==========================================
// INDEXACIÓN EN MEMORIA DEL CATÁLOGO Y STOCK
// ==========================================
function clearCatalogIndexes() {
  sessionCatalogCache = [];
  catalogById.clear();
  catalogByBarcode.clear();
  catalogByWms.clear();
  catalogBySku.clear();
  catalogByAlias.clear();
  catalogByAltBarcode.clear();
  catalogPreloadedForKey = '';
}

function indexProductInMemory(p) {
  if (!p) return;
  const key = p.id || p.sku;
  if (!key) return;
  if (!catalogById.has(key)) {
    sessionCatalogCache.push(p);
  }
  catalogById.set(key, p);

  const bcOrigin = String(p.barcode || '').trim().toUpperCase();
  const bcWms = String(p.barcode_wms || '').trim().toUpperCase();
  const bcAlt = String(p.codigo_barra || '').trim().toUpperCase();
  const sku = String(p.sku || '').trim().toUpperCase();
  const alias = String(p.alias || '').trim().toUpperCase();

  if (bcOrigin && !catalogByBarcode.has(bcOrigin)) catalogByBarcode.set(bcOrigin, p);
  if (bcAlt && !catalogByBarcode.has(bcAlt)) catalogByBarcode.set(bcAlt, p);
  if (bcWms && !catalogByWms.has(bcWms)) catalogByWms.set(bcWms, p);
  if (sku && !catalogBySku.has(sku)) catalogBySku.set(sku, p);
  if (alias && !catalogByAlias.has(alias)) catalogByAlias.set(alias, p);

  const altList = typeof window.getProductAlternateBarcodes === 'function'
    ? window.getProductAlternateBarcodes(p)
    : (Array.isArray(p.options?.alternate_barcodes) ? p.options.alternate_barcodes : []);

  if (Array.isArray(altList)) {
    for (let i = 0; i < altList.length; i++) {
      const code = String(altList[i] || '').trim().toUpperCase();
      if (code && !catalogByAltBarcode.has(code)) {
        catalogByAltBarcode.set(code, p);
      }
    }
  }
}

function updateCatalogStatusStrip(text) {
  const el = document.getElementById('inv-catalog-status-text');
  if (el) el.innerHTML = text;
}

async function preloadSessionCatalogAndStock(session) {
  if (!session) return;
  const commerce = (session.comercio || '').trim();
  const whId = session.warehouse_id || '';
  const preloadKey = `${commerce}__${whId}`;

  if (catalogPreloadedForKey === preloadKey && sessionCatalogCache.length > 0) {
    updateCatalogStatusStrip(`<i class="ri-flashlight-line" style="color:#10b981;"></i> Catálogo en caché rápida: <strong>${sessionCatalogCache.length}</strong> productos`);
    return;
  }

  clearCatalogIndexes();
  warehouseStockMap.clear();
  warehouseStockLoadedKey = '';
  isCatalogPreloading = true;
  updateCatalogStatusStrip('<i class="ri-loader-4-line ri-spin"></i> Indexando catálogo para escaneo instantáneo...');

  try {
    // 1. Precargar catálogo del comercio (solo columnas ligeras; si es "Todos", cargar los primeros 2000 más recientes)
    const isSpecificCommerce = commerce && commerce.toLowerCase() !== 'todos';
    const maxPages = isSpecificCommerce ? 10 : 2;
    const pageSize = 1000;

    for (let page = 0; page < maxPages; page++) {
      if (!activeCountSession || activeCountSession.id !== session.id) return;
      let q = supabase
        .from('products')
        .select('id, sku, alias, name, barcode, barcode_wms, comercio, options')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (isSpecificCommerce) {
        q = q.ilike('comercio', commerce);
      }

      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      for (let i = 0; i < data.length; i++) {
        indexProductInMemory(data[i]);
      }
      if (data.length < pageSize) break;
    }

    catalogPreloadedForKey = preloadKey;

    // 2. Precargar stock teórico de la bodega en background para consultas instantáneas
    if (whId && sessionCatalogCache.length > 0 && isSpecificCommerce) {
      const ids = sessionCatalogCache.map(p => p.id).filter(Boolean);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 150) {
        chunks.push(ids.slice(i, i + 150));
      }
      for (const chunk of chunks) {
        if (!activeCountSession || activeCountSession.id !== session.id) return;
        const { data: invRows } = await supabase
          .from('inventory')
          .select('product_id, quantity')
          .eq('warehouse_id', whId)
          .in('product_id', chunk);

        if (invRows) {
          for (let i = 0; i < invRows.length; i++) {
            const r = invRows[i];
            warehouseStockMap.set(r.product_id, (warehouseStockMap.get(r.product_id) || 0) + (r.quantity || 0));
          }
        }
      }
      warehouseStockLoadedKey = preloadKey;
    }

    updateCatalogStatusStrip(
      `<i class="ri-flashlight-line" style="color:#10b981;"></i> Índice local listo: <strong>${sessionCatalogCache.length}</strong> productos${warehouseStockLoadedKey ? ' + stock bodega' : ''}`
    );
  } catch (err) {
    console.warn('Error precargando catálogo:', err);
    updateCatalogStatusStrip('<i class="ri-cloud-line"></i> Búsqueda directa en servidor');
  } finally {
    isCatalogPreloading = false;
  }
}

function rebuildItemsMap() {
  sessionItemsById.clear();
  for (let i = 0; i < sessionItemsCache.length; i++) {
    const it = sessionItemsCache[i];
    if (it && it.id) sessionItemsById.set(String(it.id), it);
  }
  reconDataDirty = true;
}

// Cargar TODAS las lecturas de la sesión con paginación (soporta >1000 lecturas sin truncar)
async function fetchAllSessionItems(sessionId) {
  const all = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from('inventory_count_items')
      .select('id, session_id, product_id, sku, barcode, product_name, comercio, warehouse_name, quantity, expiry_date, lot_number, location, operator_name, device_id, notes, created_at, updated_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    for (let i = 0; i < data.length; i++) all.push(data[i]);
    if (data.length < pageSize) break;
  }
  return all;
}

// ==========================================
// BANNER ÚLTIMA LECTURA CON ACCESO A EDICIÓN
// ==========================================
function renderLastScannedBannerHtml() {
  if (!lastScannedItemInfo) return '';
  const timeStr = lastScannedItemInfo.timestamp
    ? new Date(lastScannedItemInfo.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  const itemIdAttr = lastScannedItemInfo.itemId ? `data-edit-id="${escapeHtml(String(lastScannedItemInfo.itemId))}"` : '';
  return `
    <div class="inv-last-scan-card">
      <div style="min-width: 0; flex: 1;">
        <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.7rem; color: #34d399; font-weight: 700;">
          <i class="ri-checkbox-circle-fill"></i> Última lectura • ${timeStr}
        </div>
        <div style="font-weight: 800; font-size: 0.84rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">
          ${escapeHtml(lastScannedItemInfo.name || 'Producto')}
        </div>
        <div style="font-size: 0.7rem; color: rgba(255,255,255,0.75); display: flex; gap: 0.55rem; flex-wrap: wrap; margin-top: 1px;">
          <span><strong>SKU:</strong> <span style="color: #93c5fd;">${escapeHtml(lastScannedItemInfo.sku || 'N/A')}</span></span>
          <span><strong>Cód:</strong> ${escapeHtml(lastScannedItemInfo.barcode || 'N/A')}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
        <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.45); border-radius: 6px; padding: 3px 9px; text-align: center;">
          <strong style="font-size: 0.98rem; color: #34d399;">+${lastScannedItemInfo.quantity || 1}</strong>
        </div>
        ${lastScannedItemInfo.itemId ? `
          <button type="button" class="btn-edit-last-scan" ${itemIdAttr} title="Editar esta última lectura" style="height: 30px; padding: 0 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.1); color: #fff; font-size: 0.72rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">
            <i class="ri-edit-line"></i> Editar
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// ==========================================
// VISTA PRINCIPAL DEL MÓDULO DE CONTEO
// ==========================================
export async function renderInventoryCountAdmin() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  await cleanupInventoryCountModule();
  activeTabName = 'scanner';
  lastFeedSignature = '';
  selectedLogIds.clear();

  appContent.innerHTML = `
    <div id="inv-count-root-wrapper" class="inv-count-wrapper ${isLiteMode ? 'inv-perf-lite' : ''}">

      <!-- ENCABEZADO EJECUTIVO Y ACCIONES DE SESIÓN -->
      <div class="inv-count-header-card">
        <div class="inv-count-session-meta">
          <div style="min-width: 0; flex: 1;">
            <div class="inv-session-title-row">
              <span id="inv-session-live-pill" class="inv-count-live-badge" style="display: none;">
                <span class="inv-count-live-dot"></span> <span id="inv-session-live-text">EN VIVO</span>
              </span>
              <h2 id="inv-current-session-title" class="inv-session-title-text">
                Conteo de Inventario
              </h2>
              <button type="button" id="btn-inv-edit-session" class="inv-row-action-btn" style="display: none;" title="Editar título, notas o estado de la sesión">
                <i class="ri-edit-2-line"></i>
              </button>
            </div>
            <div id="inv-current-session-sub" class="inv-session-sub-meta">
              Cargando sesiones disponibles...
            </div>
          </div>
        </div>

        <div class="inv-header-actions">
          <button id="btn-inv-toggle-lite" class="btn btn-outline btn-sm inv-header-btn inv-perf-btn ${isLiteMode ? 'is-lite' : ''}" title="Desactiva animaciones y efectos visuales para equipos con pocos recursos">
            <i class="ri-speed-up-line"></i>
            <span id="lbl-inv-lite-mode">${isLiteMode ? 'Modo Ligero: ON' : 'Modo Ligero'}</span>
          </button>

          <button id="btn-inv-set-operator" class="btn btn-outline btn-sm inv-header-btn" title="Cambiar nombre de este operador/equipo">
            <i class="ri-user-line" style="color: var(--color-primary);"></i>
            <span id="lbl-inv-operator-name">${escapeHtml(localOperatorName)}</span>
          </button>

          <button id="btn-inv-share-qr" class="btn btn-outline btn-sm inv-header-btn" style="display: none;" title="Compartir QR para unir otros teléfonos">
            <i class="ri-qr-code-line" style="color: #10b981;"></i> Unir Teléfonos
          </button>

          <button id="btn-inv-switch-session" class="btn btn-outline btn-sm inv-header-btn">
            <i class="ri-folder-shared-line"></i> Sesiones
          </button>

          <button id="btn-inv-new-session" class="btn btn-primary btn-sm inv-header-btn" style="background: #6366f1; border-color: #6366f1;">
            <i class="ri-add-line"></i> Nueva Sesión
          </button>
        </div>
      </div>

      <!-- NAVEGACIÓN + MÉTRICAS COMPACTAS -->
      <div class="inv-nav-kpi-bar">
        <div class="inv-count-tabs">
          <button class="inv-count-tab-btn active" data-tab="scanner">
            <i class="ri-barcode-box-line"></i> <span>Estación de Conteo</span>
          </button>
          <button class="inv-count-tab-btn" data-tab="live_recon">
            <i class="ri-scales-3-line"></i> <span>Cuadratura en Vivo</span>
            <span id="badge-inv-total-skus" class="badge" style="font-size: 0.68rem; background: rgba(99, 102, 241, 0.14); color: #4f46e5;">0</span>
          </button>
          <button class="inv-count-tab-btn" data-tab="scan_logs">
            <i class="ri-history-line"></i> <span>Registro de Lecturas</span>
            <span id="badge-inv-total-scans" class="badge" style="font-size: 0.68rem; background: rgba(16, 185, 129, 0.14); color: #059669;">0</span>
          </button>
        </div>

        <div class="inv-count-kpi-grid">
          <div class="inv-count-kpi-card">
            <div class="inv-kpi-icon" style="background: rgba(16, 185, 129, 0.12); color: #059669;">
              <i class="ri-stack-line"></i>
            </div>
            <div class="inv-kpi-body">
              <div id="kpi-inv-units" class="inv-count-kpi-val" style="color: #059669;">0</div>
              <div class="inv-count-kpi-lbl">Unidades Físicas</div>
            </div>
          </div>
          <div class="inv-count-kpi-card">
            <div class="inv-kpi-icon" style="background: rgba(99, 102, 241, 0.12); color: #4f46e5;">
              <i class="ri-price-tag-3-line"></i>
            </div>
            <div class="inv-kpi-body">
              <div id="kpi-inv-skus" class="inv-count-kpi-val" style="color: #4f46e5;">0</div>
              <div class="inv-count-kpi-lbl">SKUs Auditados</div>
            </div>
          </div>
          <div class="inv-count-kpi-card">
            <div class="inv-kpi-icon" style="background: rgba(2, 132, 199, 0.12); color: #0284c7;">
              <i class="ri-qr-scan-2-line"></i>
            </div>
            <div class="inv-kpi-body">
              <div id="kpi-inv-scans" class="inv-count-kpi-val" style="color: #0284c7;">0</div>
              <div class="inv-count-kpi-lbl">Lecturas Totales</div>
            </div>
          </div>
          <div class="inv-count-kpi-card">
            <div class="inv-kpi-icon" style="background: rgba(245, 158, 11, 0.12); color: #d97706;">
              <i class="ri-smartphone-line"></i>
            </div>
            <div class="inv-kpi-body">
              <div id="kpi-inv-devices" class="inv-count-kpi-val" style="color: #d97706;">1</div>
              <div class="inv-count-kpi-lbl">Dispositivos Activos</div>
            </div>
          </div>
        </div>
      </div>

      <!-- CONTENIDO DINÁMICO POR PESTAÑA -->
      <div id="inv-tab-content-area"></div>
    </div>

    <!-- MODAL / BOTTOM SHEET DE CONFIRMACIÓN DE NUEVA LECTURA -->
    <div id="inv-confirm-sheet" class="inv-sheet-overlay">
      <div class="inv-sheet-modal">
        <div class="inv-sheet-drag-handle"></div>

        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
          <div style="display: flex; gap: 0.7rem; align-items: center; min-width: 0;">
            <div id="sheet-prod-thumb" class="inv-prod-thumb">
              <i class="ri-box-3-line"></i>
            </div>
            <div style="min-width: 0;">
              <div id="sheet-prod-sku" style="font-family: monospace; font-size: 0.84rem; font-weight: 800; color: var(--color-primary);">SKU-12345</div>
              <h4 id="sheet-prod-name" style="margin: 0.1rem 0 0 0; font-size: 0.94rem; font-weight: 700; color: var(--color-text-main); line-height: 1.25;">
                Nombre del Producto
              </h4>
              <div id="sheet-prod-meta" style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.18rem;">
                Comercio: <strong>-</strong> • Cód. Barras: <strong>-</strong>
              </div>
            </div>
          </div>
          <button type="button" class="btn-icon" id="btn-sheet-close" style="font-size: 1.35rem; color: var(--color-text-muted);">&times;</button>
        </div>

        <!-- Stock Teórico + Acumulado en esta sesión -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
          <div style="background: var(--color-bg); padding: 0.55rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 0.76rem;">
            <div style="color: var(--color-text-muted); font-weight: 600;">Stock Sistema</div>
            <strong id="sheet-prod-system-stock" style="color: var(--color-primary); font-size: 0.95rem;">-</strong>
          </div>
          <div style="background: var(--color-bg); padding: 0.55rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 0.76rem;">
            <div style="color: var(--color-text-muted); font-weight: 600;">Ya Contado en Sesión</div>
            <strong id="sheet-prod-already-counted" style="color: #059669; font-size: 0.95rem;">0 un.</strong>
          </div>
        </div>

        <!-- STEPPER DE CANTIDAD -->
        <div style="display: flex; flex-direction: column; gap: 0.45rem;">
          <label style="font-size: 0.76rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase;">
            Cantidad a Sumar en Esta Lectura
          </label>
          <div class="inv-qty-stepper-box">
            <button type="button" class="inv-qty-step-btn" id="btn-qty-minus"><i class="ri-subtract-line"></i></button>
            <input type="number" id="input-sheet-qty" class="inv-qty-number-input" value="1" min="1" step="1" inputmode="numeric">
            <button type="button" class="inv-qty-step-btn" id="btn-qty-plus"><i class="ri-add-line"></i></button>
          </div>
          <div class="inv-quick-add-chips">
            <button type="button" class="inv-quick-chip" data-add="1">+1</button>
            <button type="button" class="inv-quick-chip" data-add="5">+5</button>
            <button type="button" class="inv-quick-chip" data-add="10">+10</button>
            <button type="button" class="inv-quick-chip" data-add="25">+25</button>
            <button type="button" class="inv-quick-chip" data-add="50">+50</button>
            <button type="button" class="inv-quick-chip" id="btn-qty-reset" style="color: var(--color-text-muted);">Reset (1)</button>
          </div>
        </div>

        <!-- FECHA DE VENCIMIENTO -->
        <div style="background: var(--color-bg); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.4rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label for="chk-has-expiry" style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); cursor: pointer; display: flex; align-items: center; gap: 0.35rem;">
              <i class="ri-calendar-event-line" style="color: #6366f1;"></i> Registrar Fecha de Vencimiento
            </label>
            <input type="checkbox" id="chk-has-expiry" style="width: 17px; height: 17px; cursor: pointer;">
          </div>
          <div id="expiry-date-container" style="display: none;">
            <input type="date" id="input-sheet-expiry" class="form-input" style="width: 100%; height: 38px; background: var(--color-surface); color: var(--color-text-main); font-weight: 600;">
          </div>
        </div>

        <!-- LOTE Y UBICACIÓN -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
          <div>
            <label style="font-size: 0.72rem; font-weight: 600; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">
              Lote (Opcional)
            </label>
            <input type="text" id="input-sheet-lot" class="form-input" placeholder="Ej: L-2026A" style="width: 100%; height: 35px; font-size: 0.8rem; background: var(--color-bg);">
          </div>
          <div>
            <label style="font-size: 0.72rem; font-weight: 600; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">
              Ubicación / Rack
            </label>
            <input type="text" id="input-sheet-location" class="form-input" placeholder="Ej: Pasillo 3" style="width: 100%; height: 35px; font-size: 0.8rem; background: var(--color-bg);">
          </div>
        </div>

        <div>
          <input type="text" id="input-sheet-notes" class="form-input" placeholder="Observaciones opcionales (ej: caja abierta, dañado...)" style="width: 100%; height: 35px; font-size: 0.8rem; background: var(--color-bg);">
        </div>

        <div style="display: flex; gap: 0.65rem; margin-top: 0.25rem;">
          <button type="button" id="btn-sheet-cancel" class="btn btn-outline" style="flex: 1; height: 44px; font-weight: 600;">
            Cancelar
          </button>
          <button type="button" id="btn-sheet-save" class="btn btn-primary" style="flex: 2; height: 44px; font-weight: 700; background: #10b981; border-color: #10b981; font-size: 0.92rem; display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <i class="ri-check-line" style="font-size: 1.15rem;"></i> Confirmar e Inventariar
          </button>
        </div>
      </div>
    </div>
  `;

  watchModuleUnmount();
  initTabNavigation();
  initGlobalHeaderActions();
  attachGlobalBarcodeScannerListener();
  attachVisibilityListener();

  await loadMetadataAndSessions();
}

// ==========================================
// NAVEGACIÓN POR PESTAÑAS
// ==========================================
function initTabNavigation() {
  const tabBtns = document.querySelectorAll('.inv-count-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      tabBtns.forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      const tabName = target.getAttribute('data-tab');
      activeTabName = tabName;

      if (tabName === 'scanner') {
        renderScannerView();
      } else {
        await stopScannerSafe();
        if (tabName === 'live_recon') {
          renderLiveReconView(false);
        } else if (tabName === 'scan_logs') {
          renderScanLogsView();
        }
      }
    });
  });
}

function refreshActiveTabView(forceReconRefresh = false) {
  if (!isModuleMounted()) return;
  if (activeTabName === 'scanner') {
    renderLiveFeedList(true);
    const gunContainer = document.getElementById('inv-gun-last-scan-container');
    if (gunContainer) gunContainer.innerHTML = renderLastScannedBannerHtml();
  } else if (activeTabName === 'live_recon') {
    renderLiveReconView(forceReconRefresh);
  } else if (activeTabName === 'scan_logs') {
    renderScanLogsView();
  }
}

// ==========================================
// VISTA 1: ESTACIÓN DE CONTEO (ESCÁNER + FEED)
// ==========================================
function renderScannerView() {
  const container = document.getElementById('inv-tab-content-area');
  if (!container) return;

  if (!activeCountSession) {
    container.innerHTML = `
      <div style="background: var(--color-surface); border: 1.5px dashed var(--color-border); border-radius: var(--radius-lg); padding: 2.5rem 1.5rem; text-align: center; max-width: 500px; margin: 1.5rem auto;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(99, 102, 241, 0.12); color: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.85rem; margin: 0 auto 0.9rem auto;">
          <i class="ri-folder-open-line"></i>
        </div>
        <h3 style="margin: 0 0 0.45rem 0; font-size: 1.1rem; color: var(--color-text-main);">No hay sesión de conteo activa</h3>
        <p style="color: var(--color-text-muted); font-size: 0.84rem; margin-bottom: 1.25rem;">
          Selecciona una sesión existente o crea una nueva auditoría física para comenzar a escanear.
        </p>
        <div style="display: flex; gap: 0.65rem; justify-content: center; flex-wrap: wrap;">
          <button id="btn-empty-select-session" class="btn btn-outline">
            <i class="ri-list-check"></i> Seleccionar Sesión
          </button>
          <button id="btn-empty-new-session" class="btn btn-primary" style="background: #6366f1; border-color: #6366f1;">
            <i class="ri-add-line"></i> Crear Nueva Sesión
          </button>
        </div>
      </div>
    `;
    document.getElementById('btn-empty-select-session')?.addEventListener('click', openSessionsModal);
    document.getElementById('btn-empty-new-session')?.addEventListener('click', openNewSessionModal);
    return;
  }

  const isClosed = activeCountSession.status === 'finalizada';

  container.innerHTML = `
    ${isClosed ? `
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: var(--radius-md); padding: 0.65rem 0.95rem; margin-bottom: 0.85rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; font-size: 0.8rem; color: #92400e;">
        <div>
          <i class="ri-lock-2-line"></i> <strong>Sesión Finalizada:</strong> Esta auditoría está cerrada. Puedes consultar la cuadratura o reabrirla desde el botón de edición de sesión si necesitas agregar/modificar lecturas.
        </div>
        <button type="button" id="btn-banner-reopen-session" class="btn btn-outline btn-sm" style="height: 30px; font-size: 0.75rem; border-color: #d97706; color: #b45309;">
          <i class="ri-lock-unlock-line"></i> Reabrir Sesión
        </button>
      </div>
    ` : ''}

    <div class="inv-scanner-section">

      <!-- COLUMNA IZQUIERDA: CONTROLES DE ESCANEO -->
      <div class="inv-scanner-card">

        <!-- FUENTE DE ESCANEO -->
        <div class="inv-input-source-tabs">
          <button type="button" class="inv-input-source-tab ${currentInputSource === 'camera' ? 'active' : ''}" id="btn-source-camera">
            <i class="ri-camera-lens-line"></i> Cámara Móvil
          </button>
          <button type="button" class="inv-input-source-tab ${currentInputSource === 'scanner_gun' ? 'active' : ''}" id="btn-source-gun">
            <i class="ri-barcode-box-line"></i> Pistola Escáner (USB / BT)
          </button>
        </div>

        <!-- VISOR DE CÁMARA -->
        <div class="inv-camera-container" id="inv-camera-frame" style="${currentInputSource === 'camera' ? 'display: flex;' : 'display: none;'}" title="Toca para enfocar">
          <div id="inv-qr-reader"></div>
          <div id="inv-cam-flash" class="inv-camera-flash-success"></div>

          <div class="inv-zoom-toolbar" id="inv-zoom-toolbar">
            <span style="color: rgba(255,255,255,0.65); font-size: 0.62rem; font-weight: 700; margin-right: 1px;">ZOOM</span>
            <button type="button" class="inv-zoom-pill ${currentZoomLevel === 1.0 ? 'active' : ''}" data-zoom="1.0">1x</button>
            <button type="button" class="inv-zoom-pill ${currentZoomLevel === 1.5 ? 'active' : ''}" data-zoom="1.5">1.5x</button>
            <button type="button" class="inv-zoom-pill ${currentZoomLevel === 2.0 ? 'active' : ''}" data-zoom="2.0">2x</button>
            <button type="button" class="inv-zoom-pill ${currentZoomLevel === 3.0 ? 'active' : ''}" data-zoom="3.0">3x</button>
          </div>

          <div class="inv-scanner-reticle-overlay">
            <div class="inv-reticle-box ${currentReticleMode === 'precision' ? 'mode-precision' : (currentReticleMode === 'wide' ? 'mode-wide' : '')}" id="inv-reticle-box">
              <div class="inv-reticle-corner top-left"></div>
              <div class="inv-reticle-corner top-right"></div>
              <div class="inv-reticle-corner bottom-left"></div>
              <div class="inv-reticle-corner bottom-right"></div>
              <div class="inv-reticle-laser"></div>
            </div>
            <div class="inv-reticle-mode-tag" id="inv-reticle-tag">
              <i class="ri-scan-2-line"></i> <span id="lbl-reticle-mode-text">${getReticleModeLabel(currentReticleMode)}</span>
            </div>
          </div>

          <div class="inv-camera-toolbar">
            <button type="button" class="inv-cam-action-btn" id="btn-toggle-camera-play" title="Pausar / Iniciar Cámara">
              <i class="ri-video-line" id="icon-camera-play"></i>
            </button>
            <button type="button" class="inv-cam-action-btn" id="btn-camera-refocus" title="Enfocar Cámara">
              <i class="ri-focus-3-line"></i>
            </button>
            <button type="button" class="inv-cam-action-btn" id="btn-toggle-reticle-mode" title="Cambiar Mirilla">
              <i class="ri-crosshair-2-line"></i>
            </button>
            <button type="button" class="inv-cam-action-btn" id="btn-toggle-torch" title="Linterna">
              <i class="ri-flashlight-line"></i>
            </button>
            <button type="button" class="inv-cam-action-btn" id="btn-switch-camera" title="Cambiar Cámara">
              <i class="ri-camera-switch-line"></i>
            </button>
          </div>
        </div>

        <!-- ESTACIÓN COMPACTA DE PISTOLA LÁSER (PC) -->
        <div class="inv-gun-station-card" id="inv-gun-station" style="${currentInputSource === 'scanner_gun' ? 'display: flex;' : 'display: none;'}">
          <div class="inv-gun-station-top">
            <div class="inv-gun-target-icon">
              <i class="ri-barcode-box-line"></i>
            </div>
            <div class="inv-gun-station-info">
              <div class="inv-gun-status-row">
                <span class="inv-gun-status-badge">
                  <span class="inv-gun-status-dot"></span> Escáner USB / BT Listo
                </span>
              </div>
              <h4 class="inv-gun-station-title">Estación de Pistola Láser Activa</h4>
              <p class="inv-gun-station-subtitle">
                Captura global activa: presiona el gatillo en cualquier momento sin hacer clic.
              </p>
            </div>
          </div>
          <div id="inv-gun-last-scan-container" style="width: 100%;">
            ${renderLastScannedBannerHtml()}
          </div>
        </div>

        <!-- INGRESO MANUAL / PISTOLA (VISIBLE SIEMPRE ARRIBA) -->
        <div class="inv-manual-block">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;">
            <label for="input-manual-barcode" style="font-size: 0.76rem; font-weight: 700; color: var(--color-text-main); margin: 0; display: flex; align-items: center; gap: 0.3rem;">
              <i class="ri-keyboard-line" style="color: var(--color-primary);"></i> Ingreso Manual / Pistola
            </label>
            <div class="inv-keyboard-mode-pills">
              <button type="button" class="inv-kb-btn ${keyboardMode === 'numeric' ? 'active' : ''}" id="btn-kb-mode-numeric" title="Teclado numérico para códigos de barras">
                <i class="ri-calculator-line"></i> 123
              </button>
              <button type="button" class="inv-kb-btn ${keyboardMode === 'alpha' ? 'active' : ''}" id="btn-kb-mode-alpha" title="Teclado texto para SKU o Nombre">
                <i class="ri-text"></i> ABC
              </button>
            </div>
          </div>

          <div class="inv-manual-input-box">
            <input type="${keyboardMode === 'numeric' ? 'tel' : 'text'}"
                   id="input-manual-barcode"
                   class="inv-manual-input"
                   inputmode="${keyboardMode === 'numeric' ? 'numeric' : 'text'}"
                   ${keyboardMode === 'numeric' ? 'pattern="[0-9]*"' : ''}
                   placeholder="${keyboardMode === 'numeric' ? 'Escanear o digitar código de barras...' : 'Escanear o escribir SKU, código o nombre...'}"
                   autocomplete="off"
                   ${isClosed ? 'disabled' : ''}>
            <button type="button" id="btn-manual-search" class="btn btn-primary" style="height: 42px; padding: 0 1rem; flex-shrink: 0;" title="Buscar en catálogo" ${isClosed ? 'disabled' : ''}>
              <i class="ri-search-2-line"></i>
            </button>
          </div>

          <!-- TECLADO NUMÉRICO RÁPIDO (Colapsado por defecto en PC) -->
          <div id="inv-virtual-numpad" class="inv-numpad-container" style="${keyboardMode === 'numeric' ? 'display: block;' : 'display: none;'}">
            <div style="display: flex; justify-content: space-between; align-items: center; ${isNumpadExpanded ? 'margin-bottom: 0.45rem;' : ''}">
              <span style="font-size: 0.7rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase;">
                <i class="ri-grid-fill" style="color: var(--color-primary);"></i> Teclado Numérico Táctil
              </span>
              <button type="button" id="btn-toggle-numpad-collapse" style="background: none; border: none; font-size: 0.72rem; color: var(--color-primary); cursor: pointer; font-weight: 700; padding: 2px;">
                <span id="lbl-numpad-collapse-text">${isNumpadExpanded ? 'Ocultar' : 'Mostrar'}</span>
              </button>
            </div>
            <div id="inv-numpad-keys-area" style="${isNumpadExpanded ? 'display: block;' : 'display: none;'}">
              <div class="inv-numpad-grid">
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="1">1</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="2">2</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="3">3</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="4">4</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="5">5</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="6">6</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="7">7</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="8">8</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="9">9</button>
                <button type="button" class="inv-num-key key-clear" id="btn-numpad-clear">C</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="0">0</button>
                <button type="button" class="inv-num-key key-backspace" id="btn-numpad-backspace"><i class="ri-delete-back-2-line"></i></button>
                <button type="button" class="inv-num-key-search" id="btn-numpad-search-action">
                  <i class="ri-search-2-line"></i> BUSCAR Y ASOCIAR
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- MODO RÁFAGA -->
        <div class="inv-switch-bar">
          <div style="min-width: 0;">
            <strong style="color: var(--color-text-main); font-size: 0.81rem; display: flex; align-items: center; gap: 0.3rem;">
              <i class="ri-flashlight-fill" style="color: #f59e0b;"></i> Modo Ráfaga (+1 automático)
            </strong>
            <span style="font-size: 0.7rem; color: var(--color-text-muted); display: block;">
              Suma +1 inmediato por lectura sin abrir ventana.
            </span>
          </div>
          <label class="inv-mode-toggle">
            <input type="checkbox" id="chk-fast-mode" ${isFastMode ? 'checked' : ''}>
            <span class="inv-mode-slider"></span>
          </label>
        </div>

        <!-- CRITERIO DE BÚSQUEDA -->
        <div class="inv-match-criteria-card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.3rem;">
            <label for="select-match-mode" style="font-size: 0.74rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.3rem; margin: 0;">
              <i class="ri-search-eye-line" style="color: var(--color-primary);"></i> Criterio de Búsqueda
            </label>
            <span id="lbl-match-mode-desc" style="font-size: 0.68rem; color: var(--color-primary); font-weight: 700; background: rgba(99, 102, 241, 0.1); padding: 1px 6px; border-radius: 4px;">
              ${getMatchModeBadgeText(currentMatchMode)}
            </span>
          </div>
          <select id="select-match-mode" class="form-input" style="width: 100%; height: 34px; font-size: 0.79rem; font-weight: 600; background: var(--color-surface); cursor: pointer;">
            <option value="all" ${currentMatchMode === 'all' ? 'selected' : ''}>Coincidencia Total (Barras, WMS, SKU o Nombre)</option>
            <option value="barcode" ${currentMatchMode === 'barcode' ? 'selected' : ''}>Solo Códigos de Barras (Origen o WMS)</option>
            <option value="barcode_origin" ${currentMatchMode === 'barcode_origin' ? 'selected' : ''}>Solo Código Fabricante / EAN (Origen)</option>
            <option value="barcode_wms" ${currentMatchMode === 'barcode_wms' ? 'selected' : ''}>Solo Código de Barras WMS</option>
            <option value="sku" ${currentMatchMode === 'sku' ? 'selected' : ''}>Solo Código SKU / Alias</option>
            <option value="name" ${currentMatchMode === 'name' ? 'selected' : ''}>Solo por Nombre / Descripción</option>
          </select>
        </div>

        <!-- ESTADO DEL ÍNDICE LOCAL -->
        <div class="inv-catalog-status-strip">
          <span id="inv-catalog-status-text">
            ${sessionCatalogCache.length > 0
              ? `<i class="ri-flashlight-line" style="color:#10b981;"></i> Índice local listo: <strong>${sessionCatalogCache.length}</strong> productos${warehouseStockLoadedKey ? ' + stock bodega' : ''}`
              : '<i class="ri-database-2-line"></i> Catálogo listo'}
          </span>
          <button type="button" id="btn-reload-catalog-cache" style="background:none;border:none;color:var(--color-primary);font-size:0.7rem;font-weight:700;cursor:pointer;padding:0;" title="Recargar catálogo desde servidor">
            <i class="ri-refresh-line"></i> Recargar
          </button>
        </div>

        <!-- ÚLTIMO ESCANEADO (Solo visible cuando se usa cámara) -->
        <div id="inv-last-scanned-container" style="display: none;"></div>
      </div>

      <!-- COLUMNA DERECHA: ACTIVIDAD EN VIVO CON EDICIÓN RÁPIDA -->
      <div class="inv-live-feed-card">
        <div class="inv-live-feed-header">
          <div style="display: flex; align-items: center; gap: 0.45rem;">
            <i class="ri-broadcast-line" style="color: #10b981; font-size: 1.1rem;"></i>
            <h4 style="margin: 0; font-size: 0.92rem; font-weight: 800; color: var(--color-text-main);">
              Actividad en Vivo
            </h4>
            <span id="lbl-active-operators-badge" style="font-size: 0.7rem; background: var(--color-bg); padding: 2px 8px; border-radius: 99px; border: 1px solid var(--color-border); font-weight: 600; color: var(--color-text-muted);">
              1 dispositivo
            </span>
          </div>
          <button type="button" id="btn-inv-manual-sync" class="btn btn-outline btn-sm" style="height: 28px; font-size: 0.72rem; padding: 0 0.6rem; display: inline-flex; align-items: center; gap: 0.3rem;" title="Sincronizar lecturas ahora">
            <i class="ri-refresh-line"></i> Sincronizar
          </button>
        </div>

        <div class="inv-feed-search-bar">
          <input type="text" id="input-inv-feed-search" class="inv-feed-search-input" placeholder="Filtrar lecturas recientes por SKU, nombre u operador..." value="${escapeHtml(feedSearchQuery)}">
        </div>

        <div id="inv-live-feed-list" class="inv-feed-list">
          <div style="text-align: center; padding: 2rem; color: var(--color-text-muted); font-size: 0.82rem;">
            Esperando lecturas de la cuadrilla...
          </div>
        </div>
      </div>

    </div>
  `;

  initScannerControls();
  renderLiveFeedList(true);
  updateSessionStatsFromCache();

  if (currentInputSource === 'camera' && !isClosed) {
    startCameraScanner();
  } else if (!isClosed) {
    setTimeout(() => {
      document.getElementById('input-manual-barcode')?.focus();
    }, 120);
  }
}

function getMatchModeBadgeText(mode) {
  switch (mode) {
    case 'barcode': return 'Barras (Origen/WMS)';
    case 'barcode_origin': return 'Fabricante (EAN)';
    case 'barcode_wms': return 'Etiqueta WMS';
    case 'sku': return 'Estricto SKU';
    case 'name': return 'Por Nombre';
    default: return 'Automático';
  }
}

function initScannerControls() {
  document.getElementById('btn-banner-reopen-session')?.addEventListener('click', openEditSessionModal);

  document.getElementById('chk-fast-mode')?.addEventListener('change', (e) => {
    isFastMode = e.target.checked;
    localStorage.setItem('stocka_inv_fast_mode', isFastMode ? 'true' : 'false');
  });

  document.getElementById('select-match-mode')?.addEventListener('change', (e) => {
    currentMatchMode = e.target.value;
    localStorage.setItem('stocka_inv_match_mode', currentMatchMode);
    const descBadge = document.getElementById('lbl-match-mode-desc');
    if (descBadge) descBadge.textContent = getMatchModeBadgeText(currentMatchMode);
  });

  document.getElementById('btn-reload-catalog-cache')?.addEventListener('click', async () => {
    if (!activeCountSession) return;
    catalogPreloadedForKey = '';
    await preloadSessionCatalogAndStock(activeCountSession);
    showInlineToast('Índice de catálogo actualizado');
  });

  document.getElementById('btn-inv-manual-sync')?.addEventListener('click', async (e) => {
    if (!activeCountSession) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> ...';
    try {
      await reloadSessionItemsQuietly(activeCountSession.id, true);
      showInlineToast('Lecturas sincronizadas');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  // Búsqueda instantánea en el feed en vivo (debounced)
  const feedSearchInput = document.getElementById('input-inv-feed-search');
  if (feedSearchInput) {
    feedSearchInput.addEventListener('input', debounce((e) => {
      feedSearchQuery = e.target.value.trim();
      renderLiveFeedList(true);
    }, 150));
  }

  // Event delegation en el feed en vivo (Editar / Eliminar cualquier lectura)
  const feedList = document.getElementById('inv-live-feed-list');
  if (feedList) {
    feedList.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-feed-edit');
      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        if (id) openEditReadingModal(id);
        return;
      }
      const delBtn = e.target.closest('.btn-feed-del');
      if (delBtn) {
        const id = delBtn.getAttribute('data-id');
        if (id) handleDeleteSingleReading(id);
      }
    });
  }

  // Click en "Editar" dentro del banner de última lectura en la estación de pistola
  const gunStation = document.getElementById('inv-gun-station');
  if (gunStation) {
    gunStation.addEventListener('click', (e) => {
      const editLastBtn = e.target.closest('.btn-edit-last-scan');
      if (editLastBtn) {
        e.stopPropagation();
        const id = editLastBtn.getAttribute('data-edit-id');
        if (id) openEditReadingModal(id);
        return;
      }
      document.getElementById('input-manual-barcode')?.focus();
    });
  }

  const manualInput = document.getElementById('input-manual-barcode');
  const manualBtn = document.getElementById('btn-manual-search');
  const btnKbNumeric = document.getElementById('btn-kb-mode-numeric');
  const btnKbAlpha = document.getElementById('btn-kb-mode-alpha');
  const virtualNumpad = document.getElementById('inv-virtual-numpad');

  const setKeyboardMode = (mode) => {
    keyboardMode = mode;
    localStorage.setItem('stocka_inv_keyboard_mode', mode);
    if (btnKbNumeric && btnKbAlpha) {
      btnKbNumeric.classList.toggle('active', mode === 'numeric');
      btnKbAlpha.classList.toggle('active', mode === 'alpha');
    }
    if (manualInput) {
      if (mode === 'numeric') {
        manualInput.type = 'tel';
        manualInput.setAttribute('inputmode', 'numeric');
        manualInput.setAttribute('pattern', '[0-9]*');
        manualInput.placeholder = 'Escanear o digitar código de barras...';
        if (virtualNumpad) virtualNumpad.style.display = 'block';
      } else {
        manualInput.type = 'text';
        manualInput.setAttribute('inputmode', 'text');
        manualInput.removeAttribute('pattern');
        manualInput.placeholder = 'Escanear o escribir SKU, código o nombre...';
        if (virtualNumpad) virtualNumpad.style.display = 'none';
      }
    }
  };

  btnKbNumeric?.addEventListener('click', () => setKeyboardMode('numeric'));
  btnKbAlpha?.addEventListener('click', () => setKeyboardMode('alpha'));

  document.getElementById('btn-toggle-numpad-collapse')?.addEventListener('click', () => {
    isNumpadExpanded = !isNumpadExpanded;
    localStorage.setItem('stocka_inv_numpad_expanded', isNumpadExpanded ? 'true' : 'false');
    const area = document.getElementById('inv-numpad-keys-area');
    const lbl = document.getElementById('lbl-numpad-collapse-text');
    if (area) area.style.display = isNumpadExpanded ? 'block' : 'none';
    if (lbl) lbl.textContent = isNumpadExpanded ? 'Ocultar' : 'Mostrar';
  });

  // Delegación en teclado numérico
  document.getElementById('inv-numpad-keys-area')?.addEventListener('click', (e) => {
    const digitBtn = e.target.closest('.btn-numpad-digit');
    if (digitBtn && manualInput) {
      e.preventDefault();
      playBeepSound('tap');
      triggerHaptic('tap');
      manualInput.value += digitBtn.getAttribute('data-key') || '';
      return;
    }
    if (e.target.closest('#btn-numpad-clear') && manualInput) {
      e.preventDefault();
      playBeepSound('tap');
      manualInput.value = '';
      return;
    }
    if (e.target.closest('#btn-numpad-backspace') && manualInput) {
      e.preventDefault();
      playBeepSound('tap');
      manualInput.value = manualInput.value.slice(0, -1);
      return;
    }
    if (e.target.closest('#btn-numpad-search-action')) {
      e.preventDefault();
      handleManualSearch();
    }
  });

  const handleManualSearch = () => {
    const val = manualInput?.value.trim();
    if (!val) return;
    manualInput.value = '';
    onBarcodeScanned(val);
  };

  manualBtn?.addEventListener('click', handleManualSearch);
  manualInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualSearch();
    }
  });

  // Controles de cámara
  document.getElementById('btn-toggle-torch')?.addEventListener('click', toggleTorchSafe);
  document.getElementById('btn-switch-camera')?.addEventListener('click', switchCameraFacingSafe);
  document.getElementById('btn-toggle-camera-play')?.addEventListener('click', toggleCameraPlayPause);

  document.getElementById('btn-camera-refocus')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cameraFrame = document.getElementById('inv-camera-frame');
    if (cameraFrame) {
      const rect = cameraFrame.getBoundingClientRect();
      showFocusRing(rect.width / 2, rect.height / 2);
    }
    triggerCameraFocus(0.5, 0.5);
  });

  document.getElementById('btn-toggle-reticle-mode')?.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleReticleMode();
  });

  document.querySelectorAll('.inv-zoom-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyCameraZoom(btn.dataset.zoom);
    });
  });

  const cameraFrame = document.getElementById('inv-camera-frame');
  cameraFrame?.addEventListener('click', (e) => {
    if (e.target.closest('.inv-camera-toolbar') || e.target.closest('.inv-zoom-toolbar')) return;
    const rect = cameraFrame.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    showFocusRing(x, y);
    triggerCameraFocus(Math.max(0.05, Math.min(0.95, x / rect.width)), Math.max(0.05, Math.min(0.95, y / rect.height)));
  });

  // Fuente Cámara vs Pistola
  const btnSourceCamera = document.getElementById('btn-source-camera');
  const btnSourceGun = document.getElementById('btn-source-gun');
  const setInputSource = async (source) => {
    currentInputSource = source;
    localStorage.setItem('stocka_inv_input_source', source);
    btnSourceCamera?.classList.toggle('active', source === 'camera');
    btnSourceGun?.classList.toggle('active', source === 'scanner_gun');

    if (source === 'camera') {
      if (gunStation) gunStation.style.display = 'none';
      if (cameraFrame) cameraFrame.style.display = 'flex';
      await startCameraScanner();
    } else {
      if (cameraFrame) cameraFrame.style.display = 'none';
      if (gunStation) gunStation.style.display = 'flex';
      await stopScannerSafe();
      setTimeout(() => manualInput?.focus(), 100);
    }
  };

  btnSourceCamera?.addEventListener('click', () => setInputSource('camera'));
  btnSourceGun?.addEventListener('click', () => setInputSource('scanner_gun'));
}

// ==========================================
// LISTENER GLOBAL DE PISTOLA USB / BLUETOOTH (CORREGIDO)
// ==========================================
function attachGlobalBarcodeScannerListener() {
  if (globalBarcodeListenerAttached) return;
  globalBarcodeListenerAttached = true;

  window.addEventListener('keydown', (e) => {
    // Solo capturar si el módulo está montado, en pestaña scanner, sesión activa y sin modales abiertos
    if (!isModuleMounted() || activeTabName !== 'scanner' || !activeCountSession) {
      barcodeBuffer = '';
      return;
    }
    if (activeCountSession.status === 'finalizada' || isAnyModalOpen()) {
      barcodeBuffer = '';
      return;
    }

    const activeEl = document.activeElement;
    const isTypingInOtherField = activeEl &&
      (activeEl.tagName === 'TEXTAREA' ||
       activeEl.tagName === 'SELECT' ||
       (activeEl.tagName === 'INPUT' && activeEl.id !== 'input-manual-barcode'));

    if (isTypingInOtherField) {
      barcodeBuffer = '';
      return;
    }

    // Si el foco ya está en input-manual-barcode, dejar que su propio Enter listener lo maneje
    if (activeEl && activeEl.id === 'input-manual-barcode') {
      barcodeBuffer = '';
      return;
    }

    const currentTime = Date.now();
    const timeDiff = currentTime - lastKeyTime;
    lastKeyTime = currentTime;

    if (timeDiff > 120 && e.key !== 'Enter') {
      barcodeBuffer = '';
    }

    if (e.key === 'Enter') {
      const scannedCode = barcodeBuffer.trim();
      barcodeBuffer = '';
      if (scannedCode.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        const manualInput = document.getElementById('input-manual-barcode');
        if (manualInput) manualInput.value = '';
        onBarcodeScanned(scannedCode);
      }
      return;
    }

    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      barcodeBuffer += e.key;
      const manualInput = document.getElementById('input-manual-barcode');
      if (manualInput && currentInputSource === 'scanner_gun') {
        manualInput.value = barcodeBuffer;
      }
    }
  }, true);
}

function attachVisibilityListener() {
  if (visibilityListenerAttached) return;
  visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isModuleMounted() && activeCountSession && !isRealtimeConnected) {
      reloadSessionItemsQuietly(activeCountSession.id, false);
    }
  });
}

// ==========================================
// CONTROLADOR DE CÁMARA CON HTML5-QRCODE
// ==========================================
async function startCameraScanner() {
  if (currentInputSource !== 'camera') return;
  const qrReaderDiv = document.getElementById('inv-qr-reader');
  if (!qrReaderDiv || typeof Html5Qrcode === 'undefined') return;

  try {
    if (html5QrCodeScanner) await stopScannerSafe();

    html5QrCodeScanner = new Html5Qrcode('inv-qr-reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF
      ],
      verbose: false
    });

    const qrConfig = {
      fps: isLiteMode ? 8 : 12,
      qrbox: getQrBoxForReticleMode(currentReticleMode),
      aspectRatio: 1.333334,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    };

    await html5QrCodeScanner.start(
      { facingMode: currentCameraFacing },
      qrConfig,
      onCameraScanSuccess,
      () => {}
    );

    isScannerRunning = true;
    updateCameraPlayIcon(true);
    updateReticleUI();
    applyCameraZoom(currentZoomLevel);
  } catch (err) {
    console.warn('Error iniciando cámara:', err);
    isScannerRunning = false;
    updateCameraPlayIcon(false);
  }
}

async function stopScannerSafe() {
  if (html5QrCodeScanner && isScannerRunning) {
    try { await html5QrCodeScanner.stop(); } catch (e) {}
    isScannerRunning = false;
    isTorchOn = false;
  }
}

async function toggleTorchSafe() {
  if (!html5QrCodeScanner || !isScannerRunning) return;
  try {
    isTorchOn = !isTorchOn;
    await html5QrCodeScanner.applyVideoConstraints({ advanced: [{ torch: isTorchOn }] });
    document.getElementById('btn-toggle-torch')?.classList.toggle('active-torch', isTorchOn);
  } catch (e) {
    isTorchOn = false;
  }
}

async function switchCameraFacingSafe() {
  currentCameraFacing = currentCameraFacing === 'environment' ? 'user' : 'environment';
  await startCameraScanner();
}

async function toggleCameraPlayPause() {
  if (isScannerRunning) {
    await stopScannerSafe();
    updateCameraPlayIcon(false);
  } else {
    await startCameraScanner();
  }
}

function updateCameraPlayIcon(running) {
  const icon = document.getElementById('icon-camera-play');
  if (icon) icon.className = running ? 'ri-pause-line' : 'ri-play-line';
}

function getActiveVideoTrack() {
  try {
    const video = document.querySelector('#inv-qr-reader video');
    if (video && video.srcObject) {
      const tracks = video.srcObject.getVideoTracks();
      if (tracks && tracks.length > 0) return tracks[0];
    }
  } catch (e) {}
  return null;
}

function showFocusRing(x, y) {
  const cameraFrame = document.getElementById('inv-camera-frame');
  if (!cameraFrame) return;
  cameraFrame.querySelector('.inv-focus-ring-indicator')?.remove();
  const ring = document.createElement('div');
  ring.className = 'inv-focus-ring-indicator';
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  cameraFrame.appendChild(ring);
  playBeepSound('focus');
  triggerHaptic('focus');
  setTimeout(() => {
    ring.style.opacity = '0';
    setTimeout(() => ring.remove(), 320);
  }, 800);
}

async function triggerCameraFocus(xPercent = 0.5, yPercent = 0.5) {
  const refocusBtn = document.getElementById('btn-camera-refocus');
  if (refocusBtn) {
    refocusBtn.classList.add('active-focus');
    setTimeout(() => refocusBtn.classList.remove('active-focus'), 600);
  }
  const track = getActiveVideoTrack();
  if (!track) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const adv = {};
  if (caps.focusMode) {
    if (caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
    else if (caps.focusMode.includes('single-shot')) adv.focusMode = 'single-shot';
  }
  if (caps.pointsOfInterest) adv.pointsOfInterest = [{ x: xPercent, y: yPercent }];
  try {
    await track.applyConstraints({ advanced: [Object.keys(adv).length ? adv : { focusMode: 'continuous' }] });
  } catch (e) {}
}

async function applyCameraZoom(zoomVal) {
  currentZoomLevel = parseFloat(zoomVal) || 1.0;
  document.querySelectorAll('.inv-zoom-pill').forEach(btn => {
    btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.zoom) - currentZoomLevel) < 0.05);
  });
  const track = getActiveVideoTrack();
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  let appliedHardwareZoom = false;
  if (caps.zoom && track) {
    try {
      const targetZoom = Math.max(caps.zoom.min || 1, Math.min(caps.zoom.max || 10, currentZoomLevel));
      await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
      appliedHardwareZoom = true;
    } catch (e) {}
  }
  const videoEl = document.querySelector('#inv-qr-reader video');
  if (videoEl) {
    videoEl.style.transform = (!appliedHardwareZoom && currentZoomLevel > 1.0) ? `scale(${currentZoomLevel})` : 'none';
    videoEl.style.transformOrigin = 'center center';
  }
}

async function cycleReticleMode() {
  const modes = ['standard', 'precision', 'wide'];
  currentReticleMode = modes[(modes.indexOf(currentReticleMode) + 1) % modes.length];
  localStorage.setItem('stocka_inv_reticle_mode', currentReticleMode);
  updateReticleUI();
  playBeepSound('tap');
  if (html5QrCodeScanner && isScannerRunning) await startCameraScanner();
}

function updateReticleUI() {
  const reticleBox = document.getElementById('inv-reticle-box');
  const reticleTag = document.getElementById('lbl-reticle-mode-text');
  if (reticleBox) {
    reticleBox.className = 'inv-reticle-box' + (currentReticleMode === 'precision' ? ' mode-precision' : (currentReticleMode === 'wide' ? ' mode-wide' : ''));
  }
  if (reticleTag) reticleTag.textContent = getReticleModeLabel(currentReticleMode);
}

function onCameraScanSuccess(decodedText) {
  if (isScanProcessing || !decodedText || !decodedText.trim()) return;
  onBarcodeScanned(decodedText.trim());
}

// ==========================================
// BÚSQUEDA O(1) EN CATÁLOGO + FALLBACK SUPABASE
// ==========================================
async function searchProductsByNameList(term) {
  const cleanTerm = String(term || '').trim();
  if (!cleanTerm) return [];
  const termUpper = cleanTerm.toUpperCase();

  const combinedMap = new Map();
  for (let i = 0; i < sessionCatalogCache.length; i++) {
    const p = sessionCatalogCache[i];
    if (
      String(p.name || '').toUpperCase().includes(termUpper) ||
      String(p.sku || '').toUpperCase().includes(termUpper) ||
      String(p.barcode || '').toUpperCase().includes(termUpper)
    ) {
      combinedMap.set(p.id || p.sku, p);
      if (combinedMap.size >= 40) break;
    }
  }

  // Consultar en Supabase si hay pocos resultados locales o el catálogo aún no estaba precargado
  if (combinedMap.size < 10 || !catalogPreloadedForKey) {
    try {
      let query = supabase.from('products').select('id, sku, alias, name, barcode, barcode_wms, comercio, options');
      if (activeCountSession && activeCountSession.comercio && activeCountSession.comercio !== 'Todos') {
        query = query.ilike('comercio', activeCountSession.comercio.trim());
      }
      query = query.or(`name.ilike.%${cleanTerm}%,sku.ilike.%${cleanTerm}%,barcode.ilike.%${cleanTerm}%`).limit(30);
      const { data, error } = await query;
      if (!error && data) {
        data.forEach(p => {
          indexProductInMemory(p);
          combinedMap.set(p.id || p.sku, p);
        });
      }
    } catch (err) {
      console.warn('Error buscando productos por texto:', err);
    }
  }

  return Array.from(combinedMap.values());
}

function lookupProductInLocalIndex(cleanUpper, mode) {
  if (mode === 'sku') {
    if (catalogBySku.has(cleanUpper)) return { ...catalogBySku.get(cleanUpper), _matchedBy: 'SKU' };
    if (catalogByAlias.has(cleanUpper)) return { ...catalogByAlias.get(cleanUpper), _matchedBy: 'Alias SKU' };
    return null;
  }
  if (mode === 'barcode') {
    if (catalogByBarcode.has(cleanUpper)) return { ...catalogByBarcode.get(cleanUpper), _matchedBy: 'Código Barras (Origen)' };
    if (catalogByWms.has(cleanUpper)) return { ...catalogByWms.get(cleanUpper), _matchedBy: 'Código WMS' };
    if (catalogByAltBarcode.has(cleanUpper)) return { ...catalogByAltBarcode.get(cleanUpper), _matchedBy: 'Código Barras (Multi-Código)' };
    return null;
  }
  if (mode === 'barcode_origin') {
    if (catalogByBarcode.has(cleanUpper)) return { ...catalogByBarcode.get(cleanUpper), _matchedBy: 'Código Barras (Origen)' };
    if (catalogByAltBarcode.has(cleanUpper)) return { ...catalogByAltBarcode.get(cleanUpper), _matchedBy: 'Código Barras (Multi-Código)' };
    return null;
  }
  if (mode === 'barcode_wms') {
    if (catalogByWms.has(cleanUpper)) return { ...catalogByWms.get(cleanUpper), _matchedBy: 'Código WMS' };
    return null;
  }
  // Modo 'all'
  if (catalogByBarcode.has(cleanUpper)) return { ...catalogByBarcode.get(cleanUpper), _matchedBy: 'Código Barras (Origen)' };
  if (catalogByWms.has(cleanUpper)) return { ...catalogByWms.get(cleanUpper), _matchedBy: 'Código WMS' };
  if (catalogBySku.has(cleanUpper)) return { ...catalogBySku.get(cleanUpper), _matchedBy: 'SKU' };
  if (catalogByAlias.has(cleanUpper)) return { ...catalogByAlias.get(cleanUpper), _matchedBy: 'Alias SKU' };
  if (catalogByAltBarcode.has(cleanUpper)) return { ...catalogByAltBarcode.get(cleanUpper), _matchedBy: 'Código Barras (Multi-Código)' };
  return null;
}

async function findProductInDatabase(code) {
  const cleanCode = String(code).trim();
  const cleanUpper = cleanCode.toUpperCase();
  const mode = currentMatchMode || 'all';

  if (mode === 'name') {
    const nameMatches = await searchProductsByNameList(cleanCode);
    if (nameMatches.length === 1) return { ...nameMatches[0], _matchedBy: 'Nombre de Producto' };
    if (nameMatches.length > 1) return { is_multiple_matches: true, matches: nameMatches };
    return {
      id: null, sku: cleanCode, barcode: cleanCode,
      name: `"${cleanCode}" (No encontrado por nombre)`,
      comercio: activeCountSession?.comercio || 'no asignado',
      is_unknown: true, _matchedBy: 'Sin coincidencia'
    };
  }

  // 1. Búsqueda instantánea O(1) en memoria local
  const localHit = lookupProductInLocalIndex(cleanUpper, mode);
  if (localHit) return localHit;

  // 2. Fallback en Supabase (solo si no existía en caché)
  try {
    const buildQuery = (withCommerce) => {
      let q = supabase.from('products').select('id, sku, alias, name, barcode, barcode_wms, comercio, options');
      if (withCommerce && activeCountSession?.comercio && activeCountSession.comercio !== 'Todos') {
        q = q.ilike('comercio', activeCountSession.comercio.trim());
      }
      if (mode === 'sku') q = q.or(`sku.ilike.${cleanCode},alias.ilike.${cleanCode}`);
      else if (mode === 'barcode') q = q.or(`barcode.ilike.${cleanCode},barcode_wms.ilike.${cleanCode}`);
      else if (mode === 'barcode_origin') q = q.ilike('barcode', cleanCode);
      else if (mode === 'barcode_wms') q = q.ilike('barcode_wms', cleanCode);
      else q = q.or(`barcode.ilike.${cleanCode},barcode_wms.ilike.${cleanCode},sku.ilike.${cleanCode},alias.ilike.${cleanCode}`);
      return q.limit(5);
    };

    const { data, error } = await buildQuery(true);
    if (!error && data && data.length > 0) {
      data.forEach(indexProductInMemory);
      const hit = lookupProductInLocalIndex(cleanUpper, mode);
      return hit || { ...data[0], _matchedBy: mode === 'sku' ? 'SKU' : 'Código' };
    }

    if (activeCountSession?.comercio && activeCountSession.comercio !== 'Todos') {
      const { data: globalData, error: globalErr } = await buildQuery(false);
      if (!globalErr && globalData && globalData.length > 0) {
        globalData.forEach(indexProductInMemory);
        const prod = globalData[0];
        return { ...prod, _matchedBy: `Catálogo General (${prod.comercio || 'Sin comercio'})` };
      }
    }
  } catch (err) {
    console.warn('Error buscando producto en Supabase:', err);
  }

  // 3. Fallback por nombre en modo 'all'
  if (mode === 'all' && cleanCode.length >= 2) {
    const nameMatches = await searchProductsByNameList(cleanCode);
    if (nameMatches.length === 1) return { ...nameMatches[0], _matchedBy: 'Nombre de Producto' };
    if (nameMatches.length > 1) return { is_multiple_matches: true, matches: nameMatches };
  }

  return {
    id: null, sku: cleanCode, barcode: cleanCode,
    name: 'Producto No Encontrado en Catálogo',
    comercio: activeCountSession?.comercio || 'no asignado',
    is_unknown: true, _matchedBy: 'Sin coincidencia'
  };
}

// ==========================================
// MODAL SELECTOR DE PRODUCTOS (MÚLTIPLES COINCIDENCIAS)
// ==========================================
function openProductPickerModal(query, productsList, onSelectCallback, onCancelCallback = null) {
  document.getElementById('modal-inv-product-picker')?.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-inv-product-picker';
  modal.className = 'inv-picker-modal-overlay';

  const rowsHtml = productsList.map(prod => {
    const sku = escapeHtml(prod.sku || 'SIN-SKU');
    const name = escapeHtml(prod.name || 'Sin descripción');
    const barcode = escapeHtml(prod.barcode || prod.codigo_barra || prod.barcode_wms || 'Sin código');
    const comercio = escapeHtml(prod.comercio || 'Todos');
    const prodId = escapeHtml(String(prod.id || prod.sku));

    return `
      <div class="inv-picker-item" data-prod-id="${prodId}">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; flex-wrap: wrap;">
            <span style="font-family: monospace; font-weight: 700; font-size: 0.78rem; color: var(--color-primary); background: rgba(99, 102, 241, 0.08); padding: 1px 6px; border-radius: 4px;">
              ${sku}
            </span>
            <span style="font-size: 0.71rem; color: var(--color-text-muted);">
              <i class="ri-barcode-line"></i> ${barcode}
            </span>
          </div>
          <div style="font-weight: 600; font-size: 0.84rem; color: var(--color-text-main); line-height: 1.3;">${name}</div>
          <div style="font-size: 0.71rem; color: var(--color-text-muted); margin-top: 2px;">Comercio: <strong>${comercio}</strong></div>
        </div>
        <button type="button" class="btn btn-primary btn-picker-select" data-prod-id="${prodId}" style="height: 34px; padding: 0 0.8rem; font-size: 0.78rem; font-weight: 700; background: #10b981; border-color: #10b981; flex-shrink: 0;">
          <i class="ri-check-line"></i> Elegir
        </button>
      </div>
    `;
  }).join('');

  modal.innerHTML = `
    <div class="inv-picker-modal-content">
      <div class="inv-picker-modal-header">
        <div>
          <h4 style="margin: 0; font-size: 0.94rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-search-line" style="color: var(--color-primary);"></i> Productos encontrados (${productsList.length})
          </h4>
          <span style="font-size: 0.72rem; color: var(--color-text-muted);">Búsqueda: "<strong>${escapeHtml(query)}</strong>"</span>
        </div>
        <button type="button" id="btn-close-product-picker" style="background: transparent; border: none; font-size: 1.35rem; color: var(--color-text-muted); cursor: pointer;">
          <i class="ri-close-line"></i>
        </button>
      </div>
      <div class="inv-picker-modal-body">${rowsHtml}</div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    if (typeof onCancelCallback === 'function') onCancelCallback();
    else isScanProcessing = false;
  };

  document.getElementById('btn-close-product-picker')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) { closeModal(); return; }
    const item = e.target.closest('.inv-picker-item');
    if (item) {
      const prodId = item.getAttribute('data-prod-id');
      const chosen = productsList.find(p => String(p.id || p.sku) === prodId);
      if (chosen) {
        modal.remove();
        if (typeof onSelectCallback === 'function') onSelectCallback(chosen);
      }
    }
  });
}

// ==========================================
// PROCESAMIENTO DE LECTURA ESCANEADA
// ==========================================
async function onBarcodeScanned(rawCode) {
  if (!rawCode || isScanProcessing) return;
  if (!activeCountSession) return;
  if (activeCountSession.status === 'finalizada') {
    showInlineToast('Esta sesión está finalizada. Reábrela para continuar escaneando.', 'warning');
    return;
  }

  isScanProcessing = true;
  triggerScanFeedback();

  try {
    const product = await findProductInDatabase(rawCode);

    if (product && product.is_multiple_matches && product.matches) {
      openProductPickerModal(rawCode, product.matches, async (chosenProd) => {
        const finalProd = { ...chosenProd, _matchedBy: 'Nombre de Producto' };
        if (isFastMode) {
          triggerScanFeedback();
          const saved = await saveCountItemDirectly({ product: finalProd, quantity: 1 });
          showLastScannedCard(finalProd, 1, saved?.id);
          setTimeout(() => { isScanProcessing = false; }, 250);
        } else {
          openConfirmationSheet(finalProd.sku || finalProd.barcode || rawCode, finalProd);
        }
      });
      return;
    }

    if (isFastMode && product && !product.is_unknown) {
      const saved = await saveCountItemDirectly({ product, quantity: 1 });
      showLastScannedCard(product, 1, saved?.id);
      setTimeout(() => { isScanProcessing = false; }, 220);
      return;
    }

    openConfirmationSheet(rawCode, product);
  } catch (err) {
    console.error('Error procesando escaneo:', err);
    playBeepSound('error');
    triggerHaptic('error');
    isScanProcessing = false;
  }
}

function triggerScanFeedback() {
  playBeepSound('success');
  triggerHaptic('success');

  if (!isLiteMode) {
    const flash = document.getElementById('inv-cam-flash');
    if (flash) {
      flash.classList.add('flash-now');
      setTimeout(() => flash.classList.remove('flash-now'), 120);
    }
    const gun = document.getElementById('inv-gun-station');
    if (gun) {
      gun.classList.add('gun-flash-active');
      setTimeout(() => gun.classList.remove('gun-flash-active'), 220);
    }
  }
}

function getAlreadyCountedForSku(sku) {
  const target = String(sku || '').toUpperCase().trim();
  if (!target) return 0;
  let sum = 0;
  for (let i = 0; i < sessionItemsCache.length; i++) {
    if (String(sessionItemsCache[i].sku || '').toUpperCase().trim() === target) {
      sum += (sessionItemsCache[i].quantity || 0);
    }
  }
  return sum;
}

// ==========================================
// BOTTOM SHEET DE CONFIRMACIÓN DE LECTURA
// ==========================================
function openConfirmationSheet(rawCode, product, onSavedCallback = null) {
  const sheet = document.getElementById('inv-confirm-sheet');
  if (!sheet) {
    isScanProcessing = false;
    return;
  }

  const isUnknown = product.is_unknown || !product.id;
  const matchInfo = product._matchedBy && product._matchedBy !== 'Sin coincidencia'
    ? ` • <span style="color: #10b981; font-weight: 700;">${escapeHtml(product._matchedBy)}</span>`
    : '';
  document.getElementById('sheet-prod-sku').textContent = product.sku || rawCode;
  document.getElementById('sheet-prod-name').textContent = isUnknown ? `(No catalogado) ${rawCode}` : (product.name || 'Sin descripción');
  document.getElementById('sheet-prod-meta').innerHTML = `Comercio: <strong>${escapeHtml(product.comercio || 'Todos')}</strong> • Cód: <strong>${escapeHtml(rawCode)}</strong>${matchInfo}`;

  const qtyInput = document.getElementById('input-sheet-qty');
  const expiryCheck = document.getElementById('chk-has-expiry');
  const expiryInput = document.getElementById('input-sheet-expiry');
  const expiryContainer = document.getElementById('expiry-date-container');
  const lotInput = document.getElementById('input-sheet-lot');
  const locInput = document.getElementById('input-sheet-location');
  const notesInput = document.getElementById('input-sheet-notes');

  qtyInput.value = 1;
  expiryCheck.checked = false;
  expiryContainer.style.display = 'none';
  expiryInput.value = '';
  lotInput.value = '';
  notesInput.value = isUnknown ? 'Producto sin código registrado en sistema' : '';

  const alreadyEl = document.getElementById('sheet-prod-already-counted');
  if (alreadyEl) alreadyEl.textContent = `${getAlreadyCountedForSku(product.sku || rawCode)} un.`;

  const sysStockEl = document.getElementById('sheet-prod-system-stock');
  if (product.id && warehouseStockLoadedKey && warehouseStockMap.has(product.id)) {
    sysStockEl.textContent = `${warehouseStockMap.get(product.id)} un.`;
  } else {
    sysStockEl.textContent = 'Consultando...';
    fetchTheoreticalStock(product.id).then(stock => {
      sysStockEl.textContent = stock || '0 un.';
    });
  }

  sheet.classList.add('active');
  setTimeout(() => { qtyInput.focus(); qtyInput.select(); }, 50);

  document.getElementById('btn-qty-plus').onclick = () => { qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 0) + 1); };
  document.getElementById('btn-qty-minus').onclick = () => { qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 2) - 1); };
  document.getElementById('btn-qty-reset').onclick = () => { qtyInput.value = 1; };

  sheet.querySelectorAll('.inv-quick-chip[data-add]').forEach(chip => {
    chip.onclick = () => {
      const add = parseInt(chip.getAttribute('data-add'), 10) || 1;
      qtyInput.value = (parseInt(qtyInput.value, 10) || 0) + add;
    };
  });

  expiryCheck.onchange = () => {
    expiryContainer.style.display = expiryCheck.checked ? 'block' : 'none';
    if (expiryCheck.checked && !expiryInput.value) {
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      expiryInput.value = nextYear.toISOString().split('T')[0];
    }
  };

  const closeSheet = () => {
    sheet.classList.remove('active');
    isScanProcessing = false;
    if (activeTabName === 'scanner' && currentInputSource === 'scanner_gun') {
      document.getElementById('input-manual-barcode')?.focus();
    }
  };

  document.getElementById('btn-sheet-close').onclick = closeSheet;
  document.getElementById('btn-sheet-cancel').onclick = closeSheet;

  const doSave = async () => {
    const finalQty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    const finalExpiry = expiryCheck.checked && expiryInput.value ? expiryInput.value : null;
    const finalLot = lotInput.value.trim();
    const finalLoc = locInput.value.trim();
    const finalNotes = notesInput.value.trim();

    const btnSave = document.getElementById('btn-sheet-save');
    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

    try {
      const saved = await saveCountItemDirectly({
        product,
        quantity: finalQty,
        expiryDate: finalExpiry,
        lotNumber: finalLot,
        location: finalLoc,
        notes: finalNotes
      });
      showLastScannedCard(product, finalQty, saved?.id);
      closeSheet();
      if (typeof onSavedCallback === 'function') onSavedCallback(saved);
    } catch (err) {
      alert('Error al guardar lectura: ' + err.message);
    } finally {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i class="ri-check-line"></i> Confirmar e Inventariar';
    }
  };

  document.getElementById('btn-sheet-save').onclick = doSave;
  qtyInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSave();
    } else if (e.key === 'Escape') {
      closeSheet();
    }
  };
}

async function fetchTheoreticalStock(productId) {
  if (!productId || !activeCountSession) return '0 un.';
  if (warehouseStockLoadedKey && warehouseStockMap.has(productId)) {
    return `${warehouseStockMap.get(productId)} un.`;
  }
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('quantity, warehouse_id')
      .eq('product_id', productId);

    if (!error && data && data.length > 0) {
      const whStock = activeCountSession.warehouse_id
        ? data.filter(r => r.warehouse_id === activeCountSession.warehouse_id).reduce((acc, r) => acc + (r.quantity || 0), 0)
        : data.reduce((acc, r) => acc + (r.quantity || 0), 0);
      const totalStock = data.reduce((acc, r) => acc + (r.quantity || 0), 0);
      if (activeCountSession.warehouse_id) warehouseStockMap.set(productId, whStock);
      if (activeCountSession.warehouse_id && whStock === 0 && totalStock > 0) {
        return `0 un. (${totalStock} en otras bodegas)`;
      }
      return `${whStock} un.`;
    }
  } catch (e) {}
  return '0 un.';
}

async function saveCountItemDirectly({ product, quantity, expiryDate = null, lotNumber = '', location = '', notes = '' }) {
  if (!activeCountSession) throw new Error('No hay sesión activa.');

  const itemPayload = {
    session_id: activeCountSession.id,
    product_id: product.id || null,
    sku: product.sku || 'SIN-SKU',
    barcode: product.barcode || product.barcode_wms || product.sku || '',
    product_name: product.name || 'Sin nombre',
    comercio: product.comercio || activeCountSession.comercio || 'no asignado',
    warehouse_name: activeCountSession.warehouse_name || 'Principal',
    quantity: Math.max(1, parseInt(quantity, 10) || 1),
    expiry_date: expiryDate || null,
    lot_number: lotNumber || null,
    location: location || null,
    operator_name: localOperatorName || 'Admin Móvil',
    device_id: localDeviceId,
    device_info: (navigator.userAgent || '').substring(0, 90),
    notes: notes || null
  };

  const { data, error } = await supabase
    .from('inventory_count_items')
    .insert([itemPayload])
    .select('id, session_id, product_id, sku, barcode, product_name, comercio, warehouse_name, quantity, expiry_date, lot_number, location, operator_name, device_id, notes, created_at, updated_at');

  if (error) throw error;

  const inserted = (data && data[0]) ? data[0] : itemPayload;
  if (!sessionItemsById.has(String(inserted.id))) {
    sessionItemsCache.unshift(inserted);
    rebuildItemsMap();
  }
  updateSessionStatsFromCache();
  renderLiveFeedList(true);
  return inserted;
}

function showLastScannedCard(product, qty, itemId = null) {
  lastScannedItemInfo = {
    itemId: itemId || null,
    barcode: product.barcode || product.barcode_wms || product.codigo_barra || product.sku,
    sku: product.sku,
    name: product.name,
    quantity: qty,
    timestamp: Date.now()
  };

  const gunContainer = document.getElementById('inv-gun-last-scan-container');
  if (gunContainer) gunContainer.innerHTML = renderLastScannedBannerHtml();

  const container = document.getElementById('inv-last-scanned-container');
  if (!container || currentInputSource !== 'camera') return;

  container.style.display = 'block';
  container.innerHTML = `
    <div class="inv-last-scanned-card">
      <div class="inv-prod-thumb" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
        <i class="ri-check-line"></i>
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.4rem;">
          <span style="font-family: monospace; font-weight: 700; font-size: 0.78rem; color: var(--color-primary);">${escapeHtml(product.sku)}</span>
          <span style="font-weight: 800; color: #059669; font-size: 0.92rem;">+${qty} un.</span>
        </div>
        <div style="font-size: 0.82rem; font-weight: 600; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(product.name)}
        </div>
      </div>
      ${itemId ? `
        <button type="button" class="inv-row-action-btn" id="btn-cam-edit-last-scan" title="Editar lectura">
          <i class="ri-edit-line"></i>
        </button>
      ` : ''}
    </div>
  `;
  if (itemId) {
    document.getElementById('btn-cam-edit-last-scan')?.addEventListener('click', () => openEditReadingModal(itemId));
  }
}

// ==========================================
// EDICIÓN Y ELIMINACIÓN DE LECTURAS (NUEVO)
// ==========================================
async function updateCountItemInDb(itemId, updates) {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('inventory_count_items')
    .update(payload)
    .eq('id', itemId)
    .select('id, session_id, product_id, sku, barcode, product_name, comercio, warehouse_name, quantity, expiry_date, lot_number, location, operator_name, device_id, notes, created_at, updated_at')
    .single();

  if (error) throw error;

  const updated = data || { ...sessionItemsById.get(String(itemId)), ...payload };
  const idx = sessionItemsCache.findIndex(x => String(x.id) === String(itemId));
  if (idx >= 0) {
    sessionItemsCache[idx] = updated;
  }
  if (lastScannedItemInfo && String(lastScannedItemInfo.itemId) === String(itemId)) {
    lastScannedItemInfo.quantity = updated.quantity;
    lastScannedItemInfo.sku = updated.sku;
    lastScannedItemInfo.name = updated.product_name;
    lastScannedItemInfo.barcode = updated.barcode;
  }
  rebuildItemsMap();
  updateSessionStatsFromCache();
  refreshActiveTabView(false);
  return updated;
}

async function handleDeleteSingleReading(itemId, skipConfirm = false) {
  const item = sessionItemsById.get(String(itemId));
  if (!item) return false;

  if (activeCountSession?.status === 'finalizada') {
    showInlineToast('Reabre la sesión si deseas eliminar lecturas.', 'warning');
    return false;
  }

  if (!skipConfirm) {
    const ok = confirm(`¿Eliminar la lectura de "${item.product_name || item.sku}" (+${item.quantity} un.)?\nSe descontará del conteo.`);
    if (!ok) return false;
  }

  try {
    const { error } = await supabase.from('inventory_count_items').delete().eq('id', itemId);
    if (error) throw error;
    sessionItemsCache = sessionItemsCache.filter(x => String(x.id) !== String(itemId));
    selectedLogIds.delete(String(itemId));
    if (lastScannedItemInfo && String(lastScannedItemInfo.itemId) === String(itemId)) {
      lastScannedItemInfo = null;
    }
    rebuildItemsMap();
    updateSessionStatsFromCache();
    refreshActiveTabView(false);
    showInlineToast('Lectura eliminada');
    return true;
  } catch (err) {
    alert('Error al eliminar lectura: ' + err.message);
    return false;
  }
}

function openEditReadingModal(itemId, onUpdatedCallback = null) {
  const item = sessionItemsById.get(String(itemId));
  if (!item) return;

  if (activeCountSession?.status === 'finalizada') {
    showInlineToast('Sesión finalizada. Reábrela desde el encabezado para editar lecturas.', 'warning');
    return;
  }

  document.getElementById('modal-inv-edit-reading')?.remove();

  let chosenProduct = {
    id: item.product_id || null,
    sku: item.sku || '',
    barcode: item.barcode || '',
    name: item.product_name || '',
    comercio: item.comercio || activeCountSession?.comercio || 'no asignado'
  };

  const modal = document.createElement('div');
  modal.id = 'modal-inv-edit-reading';
  modal.className = 'inv-picker-modal-overlay';

  const createdStr = item.created_at ? new Date(item.created_at).toLocaleString('es-CL') : '-';

  modal.innerHTML = `
    <div class="inv-picker-modal-content">
      <div class="inv-picker-modal-header">
        <div>
          <h4 style="margin: 0; font-size: 0.96rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-edit-box-line" style="color: var(--color-primary);"></i> Editar Lectura de Conteo
          </h4>
          <span style="font-size: 0.71rem; color: var(--color-text-muted);">Registrada el ${escapeHtml(createdStr)}</span>
        </div>
        <button type="button" id="btn-close-edit-reading" style="background: transparent; border: none; font-size: 1.35rem; color: var(--color-text-muted); cursor: pointer;">
          <i class="ri-close-line"></i>
        </button>
      </div>

      <div class="inv-picker-modal-body">
        <!-- PRODUCTO ASOCIADO CON OPCIÓN DE RE-VINCULAR -->
        <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.7rem 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
            <div style="min-width: 0; flex: 1;">
              <div id="edit-prod-sku-display" style="font-family: monospace; font-weight: 800; font-size: 0.82rem; color: var(--color-primary);">${escapeHtml(chosenProduct.sku)}</div>
              <div id="edit-prod-name-display" style="font-weight: 700; font-size: 0.88rem; color: var(--color-text-main); margin-top: 2px;">${escapeHtml(chosenProduct.name)}</div>
              <div id="edit-prod-meta-display" style="font-size: 0.71rem; color: var(--color-text-muted); margin-top: 2px;">
                CB: ${escapeHtml(chosenProduct.barcode || '-')} • Comercio: ${escapeHtml(chosenProduct.comercio)}
              </div>
            </div>
            <button type="button" id="btn-edit-relink-prod" class="btn btn-outline btn-sm" style="height: 30px; font-size: 0.72rem; flex-shrink: 0;">
              <i class="ri-exchange-line"></i> Cambiar SKU
            </button>
          </div>
          <div id="edit-relink-search-box" style="display: none; margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px dashed var(--color-border);">
            <div style="display: flex; gap: 0.4rem;">
              <input type="text" id="input-edit-relink-query" class="form-input" placeholder="Buscar nuevo SKU, código o nombre..." style="flex: 1; height: 34px; font-size: 0.8rem;">
              <button type="button" id="btn-run-relink-search" class="btn btn-primary btn-sm" style="height: 34px; padding: 0 0.8rem;">Buscar</button>
            </div>
            <div id="edit-relink-results" style="margin-top: 0.45rem; max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem;"></div>
          </div>
        </div>

        <!-- CANTIDAD -->
        <div>
          <label style="font-size: 0.74rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase; display: block; margin-bottom: 0.35rem;">
            Cantidad Contada (Unidades)
          </label>
          <div class="inv-qty-stepper-box">
            <button type="button" class="inv-qty-step-btn" id="btn-edit-qty-minus"><i class="ri-subtract-line"></i></button>
            <input type="number" id="input-edit-qty" class="inv-qty-number-input" value="${item.quantity || 1}" min="1" step="1" inputmode="numeric">
            <button type="button" class="inv-qty-step-btn" id="btn-edit-qty-plus"><i class="ri-add-line"></i></button>
          </div>
          <div class="inv-quick-add-chips" style="margin-top: 0.4rem;">
            <button type="button" class="inv-quick-chip edit-qty-delta" data-delta="-10">-10</button>
            <button type="button" class="inv-quick-chip edit-qty-delta" data-delta="-5">-5</button>
            <button type="button" class="inv-quick-chip edit-qty-delta" data-delta="5">+5</button>
            <button type="button" class="inv-quick-chip edit-qty-delta" data-delta="10">+10</button>
            <button type="button" class="inv-quick-chip edit-qty-delta" data-delta="25">+25</button>
          </div>
        </div>

        <!-- VENCIMIENTO Y OPERADOR -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;">
          <div>
            <label style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">
              Fecha de Vencimiento
            </label>
            <input type="date" id="input-edit-expiry" class="form-input" value="${escapeHtml(item.expiry_date || '')}" style="width: 100%; height: 36px; font-size: 0.82rem;">
          </div>
          <div>
            <label style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">
              Operador Responsable
            </label>
            <input type="text" id="input-edit-operator" class="form-input" value="${escapeHtml(item.operator_name || '')}" style="width: 100%; height: 36px; font-size: 0.82rem;">
          </div>
        </div>

        <!-- LOTE Y UBICACIÓN -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;">
          <div>
            <label style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">
              Lote
            </label>
            <input type="text" id="input-edit-lot" class="form-input" value="${escapeHtml(item.lot_number || '')}" placeholder="Ej: L-2026A" style="width: 100%; height: 36px; font-size: 0.82rem;">
          </div>
          <div>
            <label style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">
              Ubicación / Rack
            </label>
            <input type="text" id="input-edit-location" class="form-input" value="${escapeHtml(item.location || '')}" placeholder="Ej: Pasillo 3" style="width: 100%; height: 36px; font-size: 0.82rem;">
          </div>
        </div>

        <!-- NOTAS -->
        <div>
          <label style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">
            Observaciones
          </label>
          <input type="text" id="input-edit-notes" class="form-input" value="${escapeHtml(item.notes || '')}" placeholder="Ej: Caja abierta, corrección de conteo..." style="width: 100%; height: 36px; font-size: 0.82rem;">
        </div>
      </div>

      <div class="inv-picker-modal-footer">
        <button type="button" id="btn-edit-delete-reading" class="btn btn-outline btn-sm" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.4);">
          <i class="ri-delete-bin-line"></i> Eliminar Lectura
        </button>
        <div style="display: flex; gap: 0.5rem;">
          <button type="button" id="btn-cancel-edit-reading" class="btn btn-outline btn-sm">Cancelar</button>
          <button type="button" id="btn-save-edit-reading" class="btn btn-primary btn-sm" style="background: #10b981; border-color: #10b981; font-weight: 700;">
            <i class="ri-save-line"></i> Guardar Cambios
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const qtyInput = document.getElementById('input-edit-qty');
  const closeModal = () => modal.remove();

  document.getElementById('btn-close-edit-reading')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-edit-reading')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('btn-edit-qty-plus')?.addEventListener('click', () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 0) + 1);
  });
  document.getElementById('btn-edit-qty-minus')?.addEventListener('click', () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 2) - 1);
  });
  modal.querySelectorAll('.edit-qty-delta').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = parseInt(btn.getAttribute('data-delta'), 10) || 0;
      qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) + delta);
    });
  });

  // Re-vincular SKU/Producto del catálogo
  const relinkBox = document.getElementById('edit-relink-search-box');
  document.getElementById('btn-edit-relink-prod')?.addEventListener('click', () => {
    const isVisible = relinkBox.style.display === 'block';
    relinkBox.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) document.getElementById('input-edit-relink-query')?.focus();
  });

  const runRelinkSearch = async () => {
    const q = document.getElementById('input-edit-relink-query')?.value.trim();
    const resDiv = document.getElementById('edit-relink-results');
    if (!q || !resDiv) return;
    resDiv.innerHTML = '<div style="font-size:0.74rem;color:var(--color-text-muted);padding:4px;">Buscando...</div>';
    const matches = await searchProductsByNameList(q);
    if (!matches.length) {
      resDiv.innerHTML = '<div style="font-size:0.74rem;color:#ef4444;padding:4px;">Sin coincidencias en catálogo.</div>';
      return;
    }
    resDiv.innerHTML = matches.slice(0, 12).map(p => `
      <div class="inv-picker-item relink-pick-row" data-pid="${escapeHtml(String(p.id || p.sku))}" style="padding: 0.45rem 0.6rem;">
        <div style="min-width:0;flex:1;">
          <div style="font-family:monospace;font-weight:700;font-size:0.75rem;color:var(--color-primary);">${escapeHtml(p.sku)}</div>
          <div style="font-size:0.77rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.name)}</div>
        </div>
        <span style="font-size:0.7rem;color:#10b981;font-weight:700;">Elegir</span>
      </div>
    `).join('');

    resDiv.querySelectorAll('.relink-pick-row').forEach(row => {
      row.addEventListener('click', () => {
        const pid = row.getAttribute('data-pid');
        const picked = matches.find(m => String(m.id || m.sku) === pid);
        if (picked) {
          chosenProduct = {
            id: picked.id || null,
            sku: picked.sku || 'SIN-SKU',
            barcode: picked.barcode || picked.barcode_wms || picked.sku || '',
            name: picked.name || 'Sin nombre',
            comercio: picked.comercio || activeCountSession?.comercio || 'no asignado'
          };
          document.getElementById('edit-prod-sku-display').textContent = chosenProduct.sku;
          document.getElementById('edit-prod-name-display').textContent = chosenProduct.name;
          document.getElementById('edit-prod-meta-display').textContent = `CB: ${chosenProduct.barcode || '-'} • Comercio: ${chosenProduct.comercio}`;
          relinkBox.style.display = 'none';
        }
      });
    });
  };

  document.getElementById('btn-run-relink-search')?.addEventListener('click', runRelinkSearch);
  document.getElementById('input-edit-relink-query')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runRelinkSearch(); }
  });

  // Eliminar desde el modal
  document.getElementById('btn-edit-delete-reading')?.addEventListener('click', async () => {
    const deleted = await handleDeleteSingleReading(itemId, false);
    if (deleted) {
      closeModal();
      if (typeof onUpdatedCallback === 'function') onUpdatedCallback();
    }
  });

  // Guardar cambios
  document.getElementById('btn-save-edit-reading')?.addEventListener('click', async () => {
    const newQty = parseInt(qtyInput.value, 10);
    if (!newQty || newQty < 1) {
      alert('La cantidad debe ser al menos 1. Si deseas dejarla en 0, utiliza "Eliminar Lectura".');
      return;
    }

    const saveBtn = document.getElementById('btn-save-edit-reading');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

    try {
      await updateCountItemInDb(itemId, {
        product_id: chosenProduct.id,
        sku: chosenProduct.sku,
        barcode: chosenProduct.barcode,
        product_name: chosenProduct.name,
        comercio: chosenProduct.comercio,
        quantity: newQty,
        expiry_date: document.getElementById('input-edit-expiry').value || null,
        lot_number: document.getElementById('input-edit-lot').value.trim() || null,
        location: document.getElementById('input-edit-location').value.trim() || null,
        operator_name: document.getElementById('input-edit-operator').value.trim() || item.operator_name || 'Admin',
        notes: document.getElementById('input-edit-notes').value.trim() || null
      });
      closeModal();
      showInlineToast('Lectura actualizada correctamente');
      if (typeof onUpdatedCallback === 'function') onUpdatedCallback();
    } catch (err) {
      alert('Error actualizando lectura: ' + err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="ri-save-line"></i> Guardar Cambios';
    }
  });
}

// ==========================================
// MODAL DE LECTURAS POR SKU (DESDE CUADRATURA)
// ==========================================
function openSkuReadingsModal(skuKey) {
  if (!activeCountSession || !cachedReconData) return;
  const normalized = String(skuKey || '').toUpperCase().trim();
  const reconItem = cachedReconData.allItems.find(x => String(x.sku || '').toUpperCase().trim() === normalized);
  if (!reconItem) return;

  const isClosed = activeCountSession.status === 'finalizada';

  document.getElementById('modal-inv-sku-readings')?.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-inv-sku-readings';
  modal.className = 'inv-picker-modal-overlay';

  const renderModalBody = () => {
    const skuItems = sessionItemsCache.filter(x => String(x.sku || '').toUpperCase().trim() === normalized);
    const totalCounted = skuItems.reduce((acc, x) => acc + (x.quantity || 0), 0);
    const sysStock = reconItem.systemStock || 0;
    const diff = totalCounted - sysStock;

    const listHtml = skuItems.length > 0 ? skuItems.map((it, idx) => {
      const timeStr = it.created_at ? new Date(it.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
      const tags = [
        it.expiry_date ? `<span class="inv-mini-tag is-expiry">Venc: ${escapeHtml(it.expiry_date)}</span>` : '',
        it.lot_number ? `<span class="inv-mini-tag">Lote: ${escapeHtml(it.lot_number)}</span>` : '',
        it.location ? `<span class="inv-mini-tag">Ubic: ${escapeHtml(it.location)}</span>` : '',
        it.notes ? `<span class="inv-mini-tag is-note" title="${escapeHtml(it.notes)}">${escapeHtml(it.notes)}</span>` : ''
      ].filter(Boolean).join('');

      return `
        <div class="inv-sku-reading-row" data-item-id="${escapeHtml(String(it.id))}">
          <div style="min-width: 0; flex: 1;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-main);">
              #${idx + 1} • ${escapeHtml(it.operator_name || 'Operador')}
              <span style="font-weight: 500; color: var(--color-text-muted); margin-left: 0.35rem;">${timeStr}</span>
            </div>
            ${tags ? `<div class="inv-feed-tags-row" style="margin-top: 3px;">${tags}</div>` : ''}
          </div>

          <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
            <div class="inv-inline-qty-group">
              <button type="button" class="inv-inline-qty-btn btn-inline-minus" data-id="${escapeHtml(String(it.id))}" ${isClosed ? 'disabled' : ''}>-</button>
              <input type="number" class="inv-inline-qty-input" data-id="${escapeHtml(String(it.id))}" value="${it.quantity}" min="1" ${isClosed ? 'disabled' : ''}>
              <button type="button" class="inv-inline-qty-btn btn-inline-plus" data-id="${escapeHtml(String(it.id))}" ${isClosed ? 'disabled' : ''}>+</button>
            </div>
            <button type="button" class="inv-row-action-btn is-add btn-inline-save-qty" data-id="${escapeHtml(String(it.id))}" title="Guardar cantidad" ${isClosed ? 'disabled' : ''}>
              <i class="ri-check-line"></i>
            </button>
            <button type="button" class="inv-row-action-btn btn-sku-full-edit" data-id="${escapeHtml(String(it.id))}" title="Editar detalle completo (lote, vencimiento, notas)" ${isClosed ? 'disabled' : ''}>
              <i class="ri-edit-line"></i>
            </button>
            <button type="button" class="inv-row-action-btn is-danger btn-sku-del-item" data-id="${escapeHtml(String(it.id))}" title="Eliminar lectura" ${isClosed ? 'disabled' : ''}>
              <i class="ri-delete-bin-line"></i>
            </button>
          </div>
        </div>
      `;
    }).join('') : `
      <div style="text-align: center; padding: 1.5rem; color: var(--color-text-muted); font-size: 0.84rem;">
        No hay lecturas registradas para este SKU aún.
      </div>
    `;

    modal.innerHTML = `
      <div class="inv-picker-modal-content is-wide">
        <div class="inv-picker-modal-header">
          <div style="min-width: 0;">
            <div style="font-family: monospace; font-size: 0.78rem; font-weight: 800; color: var(--color-primary);">${escapeHtml(reconItem.sku)}</div>
            <h4 style="margin: 2px 0 0 0; font-size: 0.96rem; font-weight: 800; color: var(--color-text-main);">${escapeHtml(reconItem.name)}</h4>
          </div>
          <button type="button" id="btn-close-sku-modal" style="background: transparent; border: none; font-size: 1.35rem; color: var(--color-text-muted); cursor: pointer;">
            <i class="ri-close-line"></i>
          </button>
        </div>

        <div class="inv-picker-modal-body">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.55rem; background: var(--color-bg); padding: 0.7rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); text-align: center;">
            <div>
              <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Stock Sistema</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #4f46e5;">${sysStock} un.</div>
            </div>
            <div>
              <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Físico Contado</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #059669;">${totalCounted} un.</div>
            </div>
            <div>
              <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Diferencia</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: ${diff === 0 ? '#059669' : (diff > 0 ? '#4f46e5' : '#dc2626')};">
                ${diff > 0 ? '+' : ''}${diff} un.
              </div>
            </div>
          </div>

          <div style="font-size: 0.75rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; margin-top: 0.25rem;">
            Lecturas individuales (${skuItems.length})
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.45rem;">
            ${listHtml}
          </div>
        </div>

        <div class="inv-picker-modal-footer">
          ${!isClosed ? `
            <button type="button" id="btn-sku-add-reading" class="btn btn-primary btn-sm" style="background: #10b981; border-color: #10b981; font-weight: 700;">
              <i class="ri-add-line"></i> Agregar Nueva Lectura
            </button>
          ` : '<span></span>'}
          <button type="button" id="btn-sku-modal-done" class="btn btn-outline btn-sm">Cerrar</button>
        </div>
      </div>
    `;

    document.getElementById('btn-close-sku-modal')?.addEventListener('click', () => modal.remove());
    document.getElementById('btn-sku-modal-done')?.addEventListener('click', () => modal.remove());

    document.getElementById('btn-sku-add-reading')?.addEventListener('click', () => {
      const prodObj = {
        id: reconItem.productId || null,
        sku: reconItem.sku,
        barcode: reconItem.barcode || reconItem.sku,
        name: reconItem.name,
        comercio: reconItem.comercio || activeCountSession.comercio
      };
      modal.remove();
      openConfirmationSheet(prodObj.sku, prodObj, () => {
        if (activeTabName === 'live_recon') renderLiveReconView(false);
      });
    });

    modal.querySelectorAll('.btn-inline-minus').forEach(b => {
      b.addEventListener('click', () => {
        const inp = modal.querySelector(`.inv-inline-qty-input[data-id="${b.dataset.id}"]`);
        if (inp) inp.value = Math.max(1, (parseInt(inp.value, 10) || 2) - 1);
      });
    });
    modal.querySelectorAll('.btn-inline-plus').forEach(b => {
      b.addEventListener('click', () => {
        const inp = modal.querySelector(`.inv-inline-qty-input[data-id="${b.dataset.id}"]`);
        if (inp) inp.value = Math.max(1, (parseInt(inp.value, 10) || 0) + 1);
      });
    });
    modal.querySelectorAll('.btn-inline-save-qty').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const inp = modal.querySelector(`.inv-inline-qty-input[data-id="${id}"]`);
        const val = parseInt(inp?.value, 10);
        if (!val || val < 1) {
          alert('La cantidad debe ser >= 1. Para dejar en 0 elimina la lectura.');
          return;
        }
        b.disabled = true;
        try {
          await updateCountItemInDb(id, { quantity: val });
          showInlineToast(`Cantidad actualizada a ${val} un.`);
          renderModalBody();
        } catch (err) {
          alert('Error: ' + err.message);
          b.disabled = false;
        }
      });
    });
    modal.querySelectorAll('.btn-sku-full-edit').forEach(b => {
      b.addEventListener('click', () => {
        openEditReadingModal(b.dataset.id, () => renderModalBody());
      });
    });
    modal.querySelectorAll('.btn-sku-del-item').forEach(b => {
      b.addEventListener('click', async () => {
        const ok = await handleDeleteSingleReading(b.dataset.id, false);
        if (ok) renderModalBody();
      });
    });
  };

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  renderModalBody();
}

// ==========================================
// CÁLCULO DE CUADRATURA OPTIMIZADO O(N) + CACHÉ
// ==========================================
async function computeSessionReconciliation(forceRefreshStock = false) {
  if (!activeCountSession) return null;

  // 1. Agrupar lecturas físicas por SKU (O(N))
  const skuMap = new Map();
  for (let i = 0; i < sessionItemsCache.length; i++) {
    const item = sessionItemsCache[i];
    const skuKey = String(item.sku || 'SIN-SKU').toUpperCase().trim();
    let r = skuMap.get(skuKey);
    if (!r) {
      r = {
        skuKey,
        productId: item.product_id || null,
        sku: item.sku,
        name: item.product_name,
        barcode: item.barcode,
        comercio: item.comercio,
        totalCounted: 0,
        systemStock: 0,
        diff: 0,
        expiryDates: new Set(),
        lots: new Set(),
        operators: new Set(),
        locations: new Set(),
        readingsCount: 0,
        wasScanned: true
      };
      skuMap.set(skuKey, r);
    }
    r.totalCounted += (item.quantity || 0);
    r.readingsCount += 1;
    if (item.product_id && !r.productId) r.productId = item.product_id;
    if (item.expiry_date) r.expiryDates.add(item.expiry_date);
    if (item.lot_number) r.lots.add(item.lot_number);
    if (item.operator_name) r.operators.add(item.operator_name);
    if (item.location) r.locations.add(item.location);
  }

  const warehouseId = activeCountSession.warehouse_id || null;
  const commerce = (activeCountSession.comercio || '').trim();
  const isSpecificCommerce = commerce && commerce.toLowerCase() !== 'todos';

  // 2. Consultar stock teórico en lotes seguros (si es refresh forzado o no está en mapa local)
  const scannedProductIds = [];
  skuMap.forEach(x => { if (x.productId) scannedProductIds.push(x.productId); });

  const needStockFetch = forceRefreshStock || !warehouseStockLoadedKey || scannedProductIds.some(id => !warehouseStockMap.has(id));
  const freshStockMap = new Map(forceRefreshStock ? [] : warehouseStockMap);

  if (needStockFetch && scannedProductIds.length > 0) {
    try {
      const idsToQuery = forceRefreshStock ? scannedProductIds : scannedProductIds.filter(id => !freshStockMap.has(id));
      for (let i = 0; i < idsToQuery.length; i += 150) {
        const chunk = idsToQuery.slice(i, i + 150);
        let q = supabase.from('inventory').select('product_id, warehouse_id, quantity').in('product_id', chunk);
        if (warehouseId) q = q.eq('warehouse_id', warehouseId);
        const { data, error } = await q;
        if (!error && data) {
          const chunkSums = new Map();
          for (let j = 0; j < data.length; j++) {
            const row = data[j];
            chunkSums.set(row.product_id, (chunkSums.get(row.product_id) || 0) + (row.quantity || 0));
          }
          chunk.forEach(pid => freshStockMap.set(pid, chunkSums.get(pid) || 0));
        }
      }
      if (warehouseId) {
        freshStockMap.forEach((v, k) => warehouseStockMap.set(k, v));
      }
    } catch (e) {
      console.warn('Error obteniendo stock teórico:', e);
    }
  }

  skuMap.forEach(item => {
    item.systemStock = item.productId ? (freshStockMap.get(item.productId) || 0) : 0;
    item.diff = item.totalCounted - item.systemStock;
  });

  // 3. Productos no escaneados con stock en esta bodega (O(N) con Map)
  const unscannedItems = [];
  if (isSpecificCommerce && warehouseId) {
    try {
      // Usar catálogo precargado si está listo; si no, consultar
      let comProds = sessionCatalogCache;
      if (!comProds.length || forceRefreshStock) {
        const loaded = [];
        for (let page = 0; page < 10; page++) {
          const { data } = await supabase
            .from('products')
            .select('id, sku, name, barcode, barcode_wms, comercio')
            .ilike('comercio', commerce)
            .range(page * 1000, (page + 1) * 1000 - 1);
          if (!data || !data.length) break;
          data.forEach(p => { loaded.push(p); indexProductInMemory(p); });
          if (data.length < 1000) break;
        }
        comProds = loaded;
      }

      if (comProds.length > 0) {
        const prodById = new Map();
        const comProdIds = [];
        for (let i = 0; i < comProds.length; i++) {
          const p = comProds[i];
          if (p && p.id) {
            prodById.set(p.id, p);
            comProdIds.push(p.id);
          }
        }

        const whStockRows = [];
        if (warehouseStockLoadedKey && !forceRefreshStock && warehouseStockMap.size > 0) {
          warehouseStockMap.forEach((qty, pid) => {
            if (qty > 0 && prodById.has(pid)) whStockRows.push({ product_id: pid, quantity: qty });
          });
        } else {
          for (let i = 0; i < comProdIds.length; i += 150) {
            const chunk = comProdIds.slice(i, i + 150);
            const { data: whInv } = await supabase
              .from('inventory')
              .select('product_id, quantity')
              .eq('warehouse_id', warehouseId)
              .gt('quantity', 0)
              .in('product_id', chunk);
            if (whInv) {
              for (let j = 0; j < whInv.length; j++) {
                whStockRows.push(whInv[j]);
                warehouseStockMap.set(whInv[j].product_id, whInv[j].quantity || 0);
              }
            }
          }
          warehouseStockLoadedKey = `${commerce}__${warehouseId}`;
        }

        for (let i = 0; i < whStockRows.length; i++) {
          const inv = whStockRows[i];
          const p = prodById.get(inv.product_id);
          if (!p) continue;
          const skuKey = String(p.sku || '').toUpperCase().trim();
          if (!skuMap.has(skuKey)) {
            unscannedItems.push({
              skuKey,
              productId: p.id,
              sku: p.sku,
              name: p.name,
              barcode: p.barcode || p.barcode_wms || '',
              comercio: p.comercio || commerce,
              totalCounted: 0,
              systemStock: inv.quantity || 0,
              diff: -(inv.quantity || 0),
              expiryDates: new Set(),
              lots: new Set(),
              operators: new Set(),
              locations: new Set(),
              readingsCount: 0,
              wasScanned: false
            });
          }
        }
      }
    } catch (err) {
      console.warn('Error buscando no escaneados:', err);
    }
  }

  const allReconItems = [...Array.from(skuMap.values()), ...unscannedItems].sort((a, b) => {
    if (a.wasScanned !== b.wasScanned) return a.wasScanned ? -1 : 1;
    return b.totalCounted - a.totalCounted;
  });

  let totalCountedUnits = 0;
  let totalSystemUnits = 0;
  let matchedCount = 0;
  let surplusCount = 0;
  let deficitCount = 0;
  let withExpiryCount = 0;

  for (let i = 0; i < allReconItems.length; i++) {
    const x = allReconItems[i];
    totalCountedUnits += x.totalCounted || 0;
    totalSystemUnits += x.systemStock || 0;
    if (x.diff === 0) matchedCount++;
    else if (x.diff > 0) surplusCount++;
    else deficitCount++;
    if (x.expiryDates && x.expiryDates.size > 0) withExpiryCount++;
  }

  cachedReconData = {
    scannedItems: Array.from(skuMap.values()),
    unscannedItems,
    allItems: allReconItems,
    totals: {
      totalCountedUnits,
      totalSystemUnits,
      netDiffUnits: totalCountedUnits - totalSystemUnits,
      totalSkus: allReconItems.length,
      scannedSkus: skuMap.size,
      unscannedSkus: unscannedItems.length,
      matchedCount,
      surplusCount,
      deficitCount,
      withExpiryCount
    }
  };
  reconDataDirty = false;
  return cachedReconData;
}

// ==========================================
// VISTA 2: CUADRATURA EN VIVO (PAGINADA + EDITABLE)
// ==========================================
async function renderLiveReconView(forceRefreshStock = false) {
  const container = document.getElementById('inv-tab-content-area');
  if (!container) return;

  if (!activeCountSession) {
    container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">No hay sesión activa.</div>';
    return;
  }

  if (forceRefreshStock || reconDataDirty || !cachedReconData) {
    container.innerHTML = `
      <div style="padding: 2.5rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-loader-4-line ri-spin" style="font-size: 1.8rem; color: var(--color-primary); display: block; margin-bottom: 0.6rem;"></i>
        <div style="font-weight: 700; font-size: 0.92rem; color: var(--color-text-main);">Calculando cuadratura en vivo...</div>
      </div>
    `;
    await computeSessionReconciliation(forceRefreshStock);
  }

  const recon = cachedReconData;
  if (!recon) return;

  const totals = recon.totals;
  const isFinished = activeCountSession.status === 'finalizada';
  const pctOk = totals.totalSkus > 0 ? Math.round((totals.matchedCount / totals.totalSkus) * 100) : 0;
  const pctSurplus = totals.totalSkus > 0 ? Math.round((totals.surplusCount / totals.totalSkus) * 100) : 0;
  const pctDeficit = totals.totalSkus > 0 ? Math.max(0, 100 - pctOk - pctSurplus) : 0;

  container.innerHTML = `
    <div class="inv-recon-table-card">
      <div class="inv-recon-toolbar">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-scales-3-line" style="color: var(--color-primary);"></i> Cuadratura Físico-Sistémica en Vivo
          </h3>
          <p style="margin: 0.15rem 0 0 0; font-size: 0.76rem; color: var(--color-text-muted);">
            Filtra al instante, edita lecturas directamente por SKU o exporta el acta oficial.
          </p>
        </div>

        <div style="display: flex; gap: 0.45rem; flex-wrap: wrap; align-items: center;">
          <button id="btn-refresh-recon-stock" class="btn btn-outline btn-sm" title="Recargar stock teórico desde el servidor">
            <i class="ri-refresh-line"></i> Actualizar Stock
          </button>
          <button id="btn-export-inv-excel" class="btn btn-outline btn-sm" style="border-color: #10b981; color: #059669; font-weight: 700;">
            <i class="ri-file-excel-2-line"></i> Excel
          </button>
          <button id="btn-export-inv-pdf" class="btn btn-outline btn-sm" style="border-color: #6366f1; color: #4f46e5; font-weight: 700;">
            <i class="ri-file-pdf-line"></i> PDF
          </button>
          ${isFinished ? `
            <span style="background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.3rem 0.7rem; border-radius: var(--radius-sm); font-size: 0.78rem; font-weight: 700;">
              <i class="ri-check-double-line"></i> Finalizado
            </span>
          ` : `
            <button id="btn-close-inv-session" class="btn btn-primary btn-sm" style="background: #059669; border-color: #059669; font-weight: 700;">
              <i class="ri-check-double-line"></i> Finalizar y Aplicar
            </button>
          `}
        </div>
      </div>

      <!-- KPIS DE CUADRATURA + BARRA DE PRECISIÓN -->
      <div class="inv-recon-kpi-strip">
        <div class="inv-recon-kpi-box" style="border-left: 3.5px solid #10b981;">
          <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Físico Contado</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: #059669; font-variant-numeric: tabular-nums;">${totals.totalCountedUnits} un.</div>
          <div style="font-size: 0.71rem; color: var(--color-text-muted);">${totals.scannedSkus} SKUs escaneados</div>
        </div>
        <div class="inv-recon-kpi-box" style="border-left: 3.5px solid #6366f1;">
          <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Stock Sistema</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: #4f46e5; font-variant-numeric: tabular-nums;">${totals.totalSystemUnits} un.</div>
          <div style="font-size: 0.71rem; color: var(--color-text-muted);">Teórico en bodega</div>
        </div>
        <div class="inv-recon-kpi-box" style="border-left: 3.5px solid ${totals.netDiffUnits === 0 ? '#10b981' : (totals.netDiffUnits > 0 ? '#6366f1' : '#ef4444')};">
          <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Diferencia Neta</div>
          <div style="font-size: 1.3rem; font-weight: 800; color: ${totals.netDiffUnits === 0 ? '#059669' : (totals.netDiffUnits > 0 ? '#4f46e5' : '#dc2626')}; font-variant-numeric: tabular-nums;">
            ${totals.netDiffUnits > 0 ? '+' : ''}${totals.netDiffUnits} un.
          </div>
          <div style="font-size: 0.71rem; color: var(--color-text-muted);">${pctOk}% SKUs cuadrados exactos</div>
        </div>
        <div class="inv-recon-kpi-box" style="border-left: 3.5px solid #f59e0b;">
          <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; margin-bottom: 0.35rem;">Distribución (${totals.totalSkus} SKUs)</div>
          <div class="inv-progress-track">
            <div class="inv-progress-seg-ok" style="width:${pctOk}%;"></div>
            <div class="inv-progress-seg-surplus" style="width:${pctSurplus}%;"></div>
            <div class="inv-progress-seg-deficit" style="width:${pctDeficit}%;"></div>
          </div>
          <div style="font-size: 0.72rem; font-weight: 700; margin-top: 0.35rem; display: flex; gap: 0.55rem; flex-wrap: wrap;">
            <span style="color:#059669;">✓ ${totals.matchedCount}</span>
            <span style="color:#4f46e5;">▲ +${totals.surplusCount}</span>
            <span style="color:#dc2626;">▼ -${totals.deficitCount}</span>
          </div>
        </div>
      </div>

      <!-- BARRA DE FILTROS + BUSCADOR INSTANTÁNEO (0 QUERIES) -->
      <div class="inv-filter-search-bar">
        <div class="inv-filter-pills-group" id="inv-recon-filters">
          <button type="button" class="inv-filter-pill ${currentReconFilter === 'all' ? 'active' : ''}" data-filter="all">Todos (${recon.allItems.length})</button>
          <button type="button" class="inv-filter-pill is-green ${currentReconFilter === 'matched' ? 'active' : ''}" data-filter="matched">Cuadrados (${totals.matchedCount})</button>
          <button type="button" class="inv-filter-pill is-indigo ${currentReconFilter === 'surplus' ? 'active' : ''}" data-filter="surplus">Sobrantes (+${totals.surplusCount})</button>
          <button type="button" class="inv-filter-pill is-red ${currentReconFilter === 'deficit' ? 'active' : ''}" data-filter="deficit">Faltantes (-${totals.deficitCount})</button>
          ${totals.unscannedSkus > 0 ? `<button type="button" class="inv-filter-pill is-red ${currentReconFilter === 'unscanned' ? 'active' : ''}" data-filter="unscanned">No Encontrados (${totals.unscannedSkus})</button>` : ''}
          ${totals.withExpiryCount > 0 ? `<button type="button" class="inv-filter-pill is-amber ${currentReconFilter === 'expiry' ? 'active' : ''}" data-filter="expiry">Con Vencimiento (${totals.withExpiryCount})</button>` : ''}
        </div>

        <div class="inv-table-search-box">
          <input type="text" id="input-recon-search" class="inv-table-search-input" placeholder="Buscar SKU, barras o producto..." value="${escapeHtml(currentReconSearch)}">
          <select id="select-recon-pagesize" class="form-input" style="height: 34px; font-size: 0.78rem; width: auto;">
            <option value="50" ${reconPageSize === 50 ? 'selected' : ''}>50 / pág</option>
            <option value="100" ${reconPageSize === 100 ? 'selected' : ''}>100 / pág</option>
            <option value="250" ${reconPageSize === 250 ? 'selected' : ''}>250 / pág</option>
          </select>
        </div>
      </div>

      <!-- TABLA PAGINADA -->
      <div class="inv-recon-table-container">
        <table class="inv-recon-table">
          <thead>
            <tr>
              <th style="width: 34px; text-align: center;">#</th>
              <th>SKU / Barras</th>
              <th>Producto</th>
              <th style="text-align: center;">Sistema</th>
              <th style="text-align: center; color: #059669;">Físico</th>
              <th style="text-align: center;">Dif.</th>
              <th style="text-align: center;">Estado</th>
              <th>Vencimiento</th>
              <th>Operadores</th>
              <th style="text-align: center; width: 96px;">Acciones</th>
            </tr>
          </thead>
          <tbody id="inv-recon-tbody"></tbody>
        </table>
      </div>

      <div id="inv-recon-pagination" class="inv-pagination-bar"></div>
    </div>
  `;

  // Listeners (sin re-consultar Supabase al filtrar)
  document.getElementById('inv-recon-filters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.inv-filter-pill');
    if (!btn) return;
    currentReconFilter = btn.getAttribute('data-filter') || 'all';
    reconPage = 1;
    document.querySelectorAll('#inv-recon-filters .inv-filter-pill').forEach(b => b.classList.toggle('active', b === btn));
    renderReconTableBodyOnly();
  });

  document.getElementById('input-recon-search')?.addEventListener('input', debounce((e) => {
    currentReconSearch = e.target.value.trim();
    reconPage = 1;
    renderReconTableBodyOnly();
  }, 140));

  document.getElementById('select-recon-pagesize')?.addEventListener('change', (e) => {
    reconPageSize = parseInt(e.target.value, 10) || 50;
    reconPage = 1;
    renderReconTableBodyOnly();
  });

  // Delegación de eventos en filas de Cuadratura
  document.getElementById('inv-recon-tbody')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-recon-edit-sku');
    if (editBtn) {
      openSkuReadingsModal(editBtn.getAttribute('data-sku-key'));
      return;
    }
    const countBtn = e.target.closest('.btn-recon-count-sku');
    if (countBtn) {
      if (activeCountSession?.status === 'finalizada') {
        showInlineToast('Reabre la sesión para registrar lecturas.', 'warning');
        return;
      }
      const key = countBtn.getAttribute('data-sku-key');
      const item = cachedReconData?.allItems.find(x => x.skuKey === key);
      if (item) {
        openConfirmationSheet(item.sku, {
          id: item.productId || null,
          sku: item.sku,
          barcode: item.barcode || item.sku,
          name: item.name,
          comercio: item.comercio
        }, () => renderLiveReconView(false));
      }
    }
  });

  document.getElementById('btn-refresh-recon-stock')?.addEventListener('click', () => renderLiveReconView(true));
  document.getElementById('btn-export-inv-excel')?.addEventListener('click', exportInventoryCountToExcel);
  document.getElementById('btn-export-inv-pdf')?.addEventListener('click', exportInventoryCountToPdf);
  document.getElementById('btn-close-inv-session')?.addEventListener('click', handleCloseSessionAndApply);

  renderReconTableBodyOnly();
}

function renderReconTableBodyOnly() {
  const tbody = document.getElementById('inv-recon-tbody');
  const pagDiv = document.getElementById('inv-recon-pagination');
  if (!tbody || !cachedReconData) return;

  let filtered = cachedReconData.allItems;
  if (currentReconFilter === 'matched') filtered = filtered.filter(x => x.diff === 0);
  else if (currentReconFilter === 'surplus') filtered = filtered.filter(x => x.diff > 0);
  else if (currentReconFilter === 'deficit') filtered = filtered.filter(x => x.diff < 0);
  else if (currentReconFilter === 'unscanned') filtered = filtered.filter(x => !x.wasScanned);
  else if (currentReconFilter === 'expiry') filtered = filtered.filter(x => x.expiryDates && x.expiryDates.size > 0);

  if (currentReconSearch) {
    const q = currentReconSearch.toUpperCase();
    filtered = filtered.filter(x =>
      String(x.sku || '').toUpperCase().includes(q) ||
      String(x.barcode || '').toUpperCase().includes(q) ||
      String(x.name || '').toUpperCase().includes(q)
    );
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / reconPageSize));
  if (reconPage > totalPages) reconPage = totalPages;
  const start = (reconPage - 1) * reconPageSize;
  const pageItems = filtered.slice(start, start + reconPageSize);
  const isFinished = activeCountSession?.status === 'finalizada';

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No hay productos que coincidan con el filtro actual.</td></tr>';
  } else {
    tbody.innerHTML = pageItems.map((item, idx) => {
      const diff = item.diff;
      let badge = '';
      let diffColor = '#059669';
      if (!item.wasScanned) {
        badge = `<span class="inv-diff-badge deficit"><i class="ri-close-circle-line"></i> No encontrado</span>`;
        diffColor = '#dc2626';
      } else if (diff === 0) {
        badge = `<span class="inv-diff-badge matched"><i class="ri-check-line"></i> Cuadrado</span>`;
      } else if (diff > 0) {
        badge = `<span class="inv-diff-badge surplus"><i class="ri-arrow-up-line"></i> Sobrante</span>`;
        diffColor = '#4f46e5';
      } else {
        badge = `<span class="inv-diff-badge deficit"><i class="ri-arrow-down-line"></i> Faltante</span>`;
        diffColor = '#dc2626';
      }

      const expiryStr = item.expiryDates?.size ? escapeHtml(Array.from(item.expiryDates).join(', ')) : '<span style="color: var(--color-text-muted);">-</span>';
      const opsStr = item.operators?.size ? escapeHtml(Array.from(item.operators).join(', ')) : '-';

      return `
        <tr class="${!item.wasScanned ? 'is-unscanned' : ''}">
          <td style="text-align: center; color: var(--color-text-muted); font-size: 0.74rem;">${start + idx + 1}</td>
          <td>
            <div style="font-family: monospace; font-weight: 700; color: var(--color-text-main);">${escapeHtml(item.sku)}</div>
            <div style="font-size: 0.7rem; color: var(--color-text-muted); font-family: monospace;">${escapeHtml(item.barcode || '-')}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: var(--color-text-main); font-size: 0.83rem;">${escapeHtml(item.name)}</div>
            <div style="font-size: 0.7rem; color: var(--color-text-muted);">${escapeHtml(item.comercio)}</div>
          </td>
          <td style="text-align: center; font-weight: 700; color: var(--color-text-muted); font-variant-numeric: tabular-nums;">${item.systemStock}</td>
          <td style="text-align: center; font-weight: 800; color: #059669; background: rgba(16, 185, 129, 0.04); font-variant-numeric: tabular-nums;">${item.totalCounted}</td>
          <td style="text-align: center; font-weight: 800; color: ${diffColor}; font-variant-numeric: tabular-nums;">${diff > 0 ? '+' : ''}${diff}</td>
          <td style="text-align: center;">${badge}</td>
          <td style="font-size: 0.76rem;">${expiryStr}</td>
          <td style="font-size: 0.74rem; color: var(--color-text-muted);">${opsStr}</td>
          <td style="text-align: center;">
            ${item.wasScanned ? `
              <button type="button" class="btn btn-outline btn-sm btn-recon-edit-sku" data-sku-key="${escapeHtml(item.skuKey)}" style="height: 28px; padding: 0 0.55rem; font-size: 0.72rem; font-weight: 700;" title="Ver y editar las ${item.readingsCount} lectura(s) de este SKU">
                <i class="ri-edit-line"></i> ${item.readingsCount}
              </button>
            ` : `
              <button type="button" class="btn btn-outline btn-sm btn-recon-count-sku" data-sku-key="${escapeHtml(item.skuKey)}" style="height: 28px; padding: 0 0.55rem; font-size: 0.72rem; font-weight: 700; color: #059669; border-color: rgba(16,185,129,0.4);" ${isFinished ? 'disabled' : ''}>
                <i class="ri-add-line"></i> Contar
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');
  }

  if (pagDiv) {
    pagDiv.innerHTML = `
      <span>Mostrando <strong>${total ? start + 1 : 0}-${Math.min(start + reconPageSize, total)}</strong> de <strong>${total}</strong> SKUs</span>
      <div class="inv-pagination-controls">
        <button type="button" class="btn btn-outline btn-sm" id="btn-recon-prev" ${reconPage <= 1 ? 'disabled' : ''}>Anterior</button>
        <span style="font-weight: 700; padding: 0 0.35rem;">Pág. ${reconPage} / ${totalPages}</span>
        <button type="button" class="btn btn-outline btn-sm" id="btn-recon-next" ${reconPage >= totalPages ? 'disabled' : ''}>Siguiente</button>
      </div>
    `;
    document.getElementById('btn-recon-prev')?.addEventListener('click', () => { if (reconPage > 1) { reconPage--; renderReconTableBodyOnly(); } });
    document.getElementById('btn-recon-next')?.addEventListener('click', () => { if (reconPage < totalPages) { reconPage++; renderReconTableBodyOnly(); } });
  }
}

// ==========================================
// VISTA 3: REGISTRO DE LECTURAS (BUSCABLE, PAGINADO, EDITABLE Y BORRADO MÚLTIPLE)
// ==========================================
function renderScanLogsView() {
  const container = document.getElementById('inv-tab-content-area');
  if (!container) return;

  if (!activeCountSession) {
    container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">No hay sesión activa.</div>';
    return;
  }

  const operators = Array.from(new Set(sessionItemsCache.map(x => x.operator_name || 'Admin'))).sort();
  const opOptions = ['<option value="all">Todos los operadores</option>', ...operators.map(op => `<option value="${escapeHtml(op)}" ${logsOperatorFilter === op ? 'selected' : ''}>${escapeHtml(op)}</option>`)].join('');

  container.innerHTML = `
    <div class="inv-recon-table-card">
      <div class="inv-recon-toolbar">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-history-line" style="color: #10b981;"></i> Registro de Lecturas (Kardex de Conteo)
          </h3>
          <p style="margin: 0.15rem 0 0 0; font-size: 0.76rem; color: var(--color-text-muted);">
            Busca, edita cantidad/lote/vencimiento o elimina lecturas erróneas de forma individual o masiva.
          </p>
        </div>
        <button type="button" id="btn-logs-export-excel" class="btn btn-outline btn-sm" style="border-color: #10b981; color: #059669; font-weight: 700;">
          <i class="ri-file-excel-2-line"></i> Exportar Excel
        </button>
      </div>

      <!-- FILTROS Y BÚSQUEDA -->
      <div class="inv-filter-search-bar">
        <div class="inv-table-search-box" style="flex: 1;">
          <input type="text" id="input-logs-search" class="inv-table-search-input" style="flex: 1; max-width: 340px;" placeholder="Buscar por SKU, código, producto, lote o ubicación..." value="${escapeHtml(logsSearchQuery)}">
          <select id="select-logs-operator" class="form-input" style="height: 34px; font-size: 0.78rem; width: auto;">
            ${opOptions}
          </select>
          <select id="select-logs-sort" class="form-input" style="height: 34px; font-size: 0.78rem; width: auto;">
            <option value="newest" ${logsSortMode === 'newest' ? 'selected' : ''}>Más recientes</option>
            <option value="oldest" ${logsSortMode === 'oldest' ? 'selected' : ''}>Más antiguos</option>
            <option value="qty_desc" ${logsSortMode === 'qty_desc' ? 'selected' : ''}>Mayor cantidad</option>
            <option value="sku_asc" ${logsSortMode === 'sku_asc' ? 'selected' : ''}>SKU (A-Z)</option>
          </select>
          <select id="select-logs-pagesize" class="form-input" style="height: 34px; font-size: 0.78rem; width: auto;">
            <option value="50" ${logsPageSize === 50 ? 'selected' : ''}>50 / pág</option>
            <option value="100" ${logsPageSize === 100 ? 'selected' : ''}>100 / pág</option>
            <option value="250" ${logsPageSize === 250 ? 'selected' : ''}>250 / pág</option>
          </select>
        </div>
      </div>

      <!-- BARRA DE SELECCIÓN MASIVA -->
      <div id="inv-logs-bulk-bar" class="inv-bulk-bar" style="display: none;">
        <span id="inv-logs-bulk-count" style="font-weight: 700; color: var(--color-primary);">0 seleccionadas</span>
        <div style="display: flex; gap: 0.45rem;">
          <button type="button" id="btn-logs-clear-sel" class="btn btn-outline btn-sm" style="height: 28px; font-size: 0.74rem;">Limpiar selección</button>
          <button type="button" id="btn-logs-bulk-delete" class="btn btn-sm" style="height: 28px; font-size: 0.74rem; background: #ef4444; border-color: #ef4444; color: #fff; font-weight: 700;">
            <i class="ri-delete-bin-line"></i> Eliminar seleccionadas
          </button>
        </div>
      </div>

      <div class="inv-recon-table-container">
        <table class="inv-recon-table">
          <thead>
            <tr>
              <th style="width: 30px; text-align: center;">
                <input type="checkbox" id="chk-logs-select-all" title="Seleccionar página actual">
              </th>
              <th style="width: 32px; text-align: center;">#</th>
              <th>Hora</th>
              <th>SKU / Cód. Barras</th>
              <th>Producto & Notas</th>
              <th style="text-align: center; color: #059669;">Cant.</th>
              <th>Venc. / Lote / Ubic.</th>
              <th>Operador</th>
              <th style="width: 78px; text-align: center;">Acciones</th>
            </tr>
          </thead>
          <tbody id="inv-logs-tbody"></tbody>
        </table>
      </div>

      <div id="inv-logs-pagination" class="inv-pagination-bar"></div>
    </div>
  `;

  document.getElementById('btn-logs-export-excel')?.addEventListener('click', exportInventoryCountToExcel);

  document.getElementById('input-logs-search')?.addEventListener('input', debounce((e) => {
    logsSearchQuery = e.target.value.trim();
    logsPage = 1;
    renderScanLogsBodyOnly();
  }, 140));

  document.getElementById('select-logs-operator')?.addEventListener('change', (e) => {
    logsOperatorFilter = e.target.value;
    logsPage = 1;
    renderScanLogsBodyOnly();
  });

  document.getElementById('select-logs-sort')?.addEventListener('change', (e) => {
    logsSortMode = e.target.value;
    logsPage = 1;
    renderScanLogsBodyOnly();
  });

  document.getElementById('select-logs-pagesize')?.addEventListener('change', (e) => {
    logsPageSize = parseInt(e.target.value, 10) || 50;
    logsPage = 1;
    renderScanLogsBodyOnly();
  });

  document.getElementById('chk-logs-select-all')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('#inv-logs-tbody .chk-log-row').forEach(chk => {
      chk.checked = checked;
      const id = chk.getAttribute('data-id');
      if (checked) selectedLogIds.add(id);
      else selectedLogIds.delete(id);
      chk.closest('tr')?.classList.toggle('is-selected', checked);
    });
    updateBulkBarUI();
  });

  document.getElementById('btn-logs-clear-sel')?.addEventListener('click', () => {
    selectedLogIds.clear();
    renderScanLogsBodyOnly();
  });

  document.getElementById('btn-logs-bulk-delete')?.addEventListener('click', handleBulkDeleteLogs);

  // Event delegation en tbody (1 solo listener para miles de filas)
  document.getElementById('inv-logs-tbody')?.addEventListener('click', (e) => {
    const chk = e.target.closest('.chk-log-row');
    if (chk) {
      const id = chk.getAttribute('data-id');
      if (chk.checked) selectedLogIds.add(id);
      else selectedLogIds.delete(id);
      chk.closest('tr')?.classList.toggle('is-selected', chk.checked);
      updateBulkBarUI();
      return;
    }
    const editBtn = e.target.closest('.btn-edit-log-item');
    if (editBtn) {
      openEditReadingModal(editBtn.getAttribute('data-id'));
      return;
    }
    const delBtn = e.target.closest('.btn-del-log-item');
    if (delBtn) {
      handleDeleteSingleReading(delBtn.getAttribute('data-id'));
    }
  });

  renderScanLogsBodyOnly();
}

function updateBulkBarUI() {
  const bar = document.getElementById('inv-logs-bulk-bar');
  const lbl = document.getElementById('inv-logs-bulk-count');
  if (!bar || !lbl) return;
  const count = selectedLogIds.size;
  bar.style.display = count > 0 ? 'flex' : 'none';
  lbl.textContent = `${count} lectura${count === 1 ? '' : 's'} seleccionada${count === 1 ? '' : 's'}`;
}

async function handleBulkDeleteLogs() {
  if (selectedLogIds.size === 0) return;
  if (activeCountSession?.status === 'finalizada') {
    showInlineToast('Reabre la sesión para eliminar lecturas.', 'warning');
    return;
  }
  const ids = Array.from(selectedLogIds);
  if (!confirm(`¿Eliminar definitivamente ${ids.length} lectura(s) seleccionada(s)? Se descontarán del conteo.`)) return;

  const btn = document.getElementById('btn-logs-bulk-delete');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Eliminando...'; }

  try {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase.from('inventory_count_items').delete().in('id', chunk);
      if (error) throw error;
    }
    const removedSet = new Set(ids);
    sessionItemsCache = sessionItemsCache.filter(x => !removedSet.has(String(x.id)));
    selectedLogIds.clear();
    rebuildItemsMap();
    updateSessionStatsFromCache();
    renderScanLogsBodyOnly();
    showInlineToast(`${ids.length} lectura(s) eliminada(s)`);
  } catch (err) {
    alert('Error en eliminación masiva: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ri-delete-bin-line"></i> Eliminar seleccionadas'; }
  }
}

function renderScanLogsBodyOnly() {
  const tbody = document.getElementById('inv-logs-tbody');
  const pagDiv = document.getElementById('inv-logs-pagination');
  if (!tbody) return;

  let items = sessionItemsCache;
  if (logsOperatorFilter !== 'all') {
    items = items.filter(x => (x.operator_name || 'Admin') === logsOperatorFilter);
  }
  if (logsSearchQuery) {
    const q = logsSearchQuery.toUpperCase();
    items = items.filter(x =>
      String(x.sku || '').toUpperCase().includes(q) ||
      String(x.barcode || '').toUpperCase().includes(q) ||
      String(x.product_name || '').toUpperCase().includes(q) ||
      String(x.lot_number || '').toUpperCase().includes(q) ||
      String(x.location || '').toUpperCase().includes(q) ||
      String(x.notes || '').toUpperCase().includes(q)
    );
  }

  // Ordenar sobre copia ligera si es distinto al default (newest)
  if (logsSortMode !== 'newest') {
    items = [...items];
    if (logsSortMode === 'oldest') items.reverse();
    else if (logsSortMode === 'qty_desc') items.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
    else if (logsSortMode === 'sku_asc') items.sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || '')));
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / logsPageSize));
  if (logsPage > totalPages) logsPage = totalPages;
  const start = (logsPage - 1) * logsPageSize;
  const pageItems = items.slice(start, start + logsPageSize);
  const isFinished = activeCountSession?.status === 'finalizada';

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">Sin lecturas que coincidan con el filtro.</td></tr>';
  } else {
    tbody.innerHTML = pageItems.map((item, idx) => {
      const idStr = String(item.id);
      const isSel = selectedLogIds.has(idStr);
      const dateFormatted = item.created_at
        ? new Date(item.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '-';
      const metaTags = [
        item.expiry_date ? `<span class="inv-mini-tag is-expiry">Venc: ${escapeHtml(item.expiry_date)}</span>` : '',
        item.lot_number ? `<span class="inv-mini-tag">Lote: ${escapeHtml(item.lot_number)}</span>` : '',
        item.location ? `<span class="inv-mini-tag">Ubic: ${escapeHtml(item.location)}</span>` : ''
      ].filter(Boolean).join(' ');

      return `
        <tr class="${isSel ? 'is-selected' : ''}">
          <td style="text-align: center;">
            <input type="checkbox" class="chk-log-row" data-id="${escapeHtml(idStr)}" ${isSel ? 'checked' : ''} ${isFinished ? 'disabled' : ''}>
          </td>
          <td style="text-align: center; color: var(--color-text-muted); font-size: 0.74rem;">${start + idx + 1}</td>
          <td style="font-size: 0.76rem; font-family: monospace; color: var(--color-text-muted); white-space: nowrap;">${dateFormatted}</td>
          <td>
            <div style="font-family: monospace; font-weight: 700; font-size: 0.8rem; color: var(--color-text-main);">${escapeHtml(item.sku)}</div>
            <div style="font-size: 0.69rem; color: var(--color-text-muted); font-family: monospace;">${escapeHtml(item.barcode || '')}</div>
          </td>
          <td>
            <div style="font-size: 0.82rem; font-weight: 600; color: var(--color-text-main);">${escapeHtml(item.product_name)}</div>
            ${item.notes ? `<div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 2px;"><i class="ri-sticky-note-line"></i> ${escapeHtml(item.notes)}</div>` : ''}
          </td>
          <td style="text-align: center; font-weight: 800; color: #059669; font-size: 0.92rem; font-variant-numeric: tabular-nums;">+${item.quantity}</td>
          <td>
            ${metaTags || '<span style="color: var(--color-text-muted); font-size: 0.75rem;">-</span>'}
          </td>
          <td style="font-size: 0.74rem; font-weight: 600; color: #4f46e5;">${escapeHtml(item.operator_name || 'Admin')}</td>
          <td style="text-align: center; white-space: nowrap;">
            <button type="button" class="inv-row-action-btn btn-edit-log-item" data-id="${escapeHtml(idStr)}" title="Editar lectura" ${isFinished ? 'disabled' : ''}>
              <i class="ri-edit-line"></i>
            </button>
            <button type="button" class="inv-row-action-btn is-danger btn-del-log-item" data-id="${escapeHtml(idStr)}" title="Eliminar lectura" style="margin-left: 3px;" ${isFinished ? 'disabled' : ''}>
              <i class="ri-delete-bin-line"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  const selAllChk = document.getElementById('chk-logs-select-all');
  if (selAllChk) selAllChk.checked = false;
  updateBulkBarUI();

  if (pagDiv) {
    pagDiv.innerHTML = `
      <span>Mostrando <strong>${total ? start + 1 : 0}-${Math.min(start + logsPageSize, total)}</strong> de <strong>${total}</strong> lecturas</span>
      <div class="inv-pagination-controls">
        <button type="button" class="btn btn-outline btn-sm" id="btn-logs-prev" ${logsPage <= 1 ? 'disabled' : ''}>Anterior</button>
        <span style="font-weight: 700; padding: 0 0.35rem;">Pág. ${logsPage} / ${totalPages}</span>
        <button type="button" class="btn btn-outline btn-sm" id="btn-logs-next" ${logsPage >= totalPages ? 'disabled' : ''}>Siguiente</button>
      </div>
    `;
    document.getElementById('btn-logs-prev')?.addEventListener('click', () => { if (logsPage > 1) { logsPage--; renderScanLogsBodyOnly(); } });
    document.getElementById('btn-logs-next')?.addEventListener('click', () => { if (logsPage < totalPages) { logsPage++; renderScanLogsBodyOnly(); } });
  }
}

// ==========================================
// FEED EN VIVO OPTIMIZADO (SOLO RE-RENDER SI CAMBIA)
// ==========================================
function renderLiveFeedList(force = false) {
  const feedList = document.getElementById('inv-live-feed-list');
  if (!feedList) return;

  let source = sessionItemsCache;
  if (feedSearchQuery) {
    const q = feedSearchQuery.toUpperCase();
    source = source.filter(x =>
      String(x.sku || '').toUpperCase().includes(q) ||
      String(x.product_name || '').toUpperCase().includes(q) ||
      String(x.operator_name || '').toUpperCase().includes(q)
    );
  }

  const recent = source.slice(0, 25);
  const sig = `${feedSearchQuery}|${activeCountSession?.status}|${recent.map(x => `${x.id}:${x.quantity}:${x.sku}:${x.expiry_date || ''}:${x.lot_number || ''}`).join(',')}`;
  if (!force && sig === lastFeedSignature) return;
  lastFeedSignature = sig;

  if (recent.length === 0) {
    feedList.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--color-text-muted); font-size: 0.82rem;">
        ${feedSearchQuery ? 'Sin lecturas que coincidan con el filtro.' : 'Esperando lecturas de la cuadrilla...'}
      </div>
    `;
    return;
  }

  const isClosed = activeCountSession?.status === 'finalizada';

  feedList.innerHTML = recent.map(item => {
    const idStr = escapeHtml(String(item.id || ''));
    const timeStr = formatTimeAgo(new Date(item.created_at || Date.now()));
    const tags = [
      item.expiry_date ? `<span class="inv-mini-tag is-expiry">Venc: ${escapeHtml(item.expiry_date)}</span>` : '',
      item.lot_number ? `<span class="inv-mini-tag">Lote: ${escapeHtml(item.lot_number)}</span>` : '',
      item.location ? `<span class="inv-mini-tag">${escapeHtml(item.location)}</span>` : ''
    ].filter(Boolean).join('');

    return `
      <div class="inv-feed-item">
        <div class="inv-feed-item-left">
          <div class="inv-feed-item-icon"><i class="ri-qr-scan-line"></i></div>
          <div class="inv-feed-item-details">
            <span class="inv-feed-item-sku" title="${escapeHtml(item.product_name || item.sku)}">${escapeHtml(item.product_name || item.sku)}</span>
            <span class="inv-feed-item-operator">
              <span>${escapeHtml(item.operator_name || 'Operador')}</span>
              <span>•</span>
              <strong style="font-family: monospace; color: var(--color-text-main);">${escapeHtml(item.sku)}</strong>
              <span>•</span>
              <span>${timeStr}</span>
            </span>
            ${tags ? `<div class="inv-feed-tags-row">${tags}</div>` : ''}
          </div>
        </div>
        <div class="inv-feed-item-right">
          <div class="inv-feed-item-qty">+${item.quantity}</div>
          ${!isClosed && item.id ? `
            <button type="button" class="inv-row-action-btn btn-feed-edit" data-id="${idStr}" title="Editar lectura">
              <i class="ri-edit-line"></i>
            </button>
            <button type="button" class="inv-row-action-btn is-danger btn-feed-del" data-id="${idStr}" title="Eliminar lectura">
              <i class="ri-delete-bin-line"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'ahora';
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

// ==========================================
// REALTIME COLABORATIVO (INSERT + UPDATE + DELETE) SIN POLLING AGRESIVO
// ==========================================
function updateLiveConnectionBadge(state) {
  const pill = document.getElementById('inv-session-live-pill');
  const txt = document.getElementById('inv-session-live-text');
  if (!pill || !txt) return;

  if (activeCountSession?.status === 'finalizada') {
    pill.style.display = 'inline-flex';
    pill.className = 'inv-count-live-badge is-closed';
    txt.textContent = 'FINALIZADA';
    return;
  }

  pill.style.display = 'inline-flex';
  if (state === 'SUBSCRIBED') {
    pill.className = 'inv-count-live-badge';
    txt.textContent = 'EN VIVO';
  } else {
    pill.className = 'inv-count-live-badge is-polling';
    txt.textContent = 'RESPALDO';
  }
}

function setupRealtimeCollaboration(sessionId) {
  if (realtimeChannel) {
    try { supabase.removeChannel(realtimeChannel); } catch (e) {}
    realtimeChannel = null;
    isRealtimeConnected = false;
  }
  if (fallbackPollingInterval) {
    clearInterval(fallbackPollingInterval);
    fallbackPollingInterval = null;
  }

  try {
    realtimeChannel = supabase.channel(`inv-session-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'inventory_count_items',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        const newItem = payload.new;
        if (!newItem || sessionItemsById.has(String(newItem.id))) return;
        sessionItemsCache.unshift(newItem);
        rebuildItemsMap();
        updateSessionStatsFromCache();
        refreshActiveTabView(false);
        if (newItem.device_id !== localDeviceId) playBeepSound('success');
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'inventory_count_items',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        const updatedItem = payload.new;
        if (!updatedItem) return;
        const idx = sessionItemsCache.findIndex(x => String(x.id) === String(updatedItem.id));
        if (idx >= 0) {
          sessionItemsCache[idx] = updatedItem;
        } else {
          sessionItemsCache.unshift(updatedItem);
        }
        rebuildItemsMap();
        updateSessionStatsFromCache();
        refreshActiveTabView(false);
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'inventory_count_items',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        const deletedId = payload.old?.id;
        if (!deletedId || !sessionItemsById.has(String(deletedId))) return;
        sessionItemsCache = sessionItemsCache.filter(x => String(x.id) !== String(deletedId));
        selectedLogIds.delete(String(deletedId));
        rebuildItemsMap();
        updateSessionStatsFromCache();
        refreshActiveTabView(false);
      })
      .subscribe((status) => {
        isRealtimeConnected = (status === 'SUBSCRIBED');
        updateLiveConnectionBadge(status);
      });
  } catch (e) {
    console.warn('Realtime fallback activo:', e);
    isRealtimeConnected = false;
    updateLiveConnectionBadge('FALLBACK');
  }

  // Sondeo de respaldo ligero cada 25s SOLO si Realtime cayó, la pestaña está visible y el módulo montado
  fallbackPollingInterval = setInterval(() => {
    if (!isModuleMounted()) {
      cleanupInventoryCountModule();
      return;
    }
    if (document.hidden || isRealtimeConnected || !activeCountSession) return;
    reloadSessionItemsQuietly(activeCountSession.id, false);
  }, 25000);
}

async function reloadSessionItemsQuietly(sessionId, forceRender = false) {
  try {
    const data = await fetchAllSessionItems(sessionId);
    if (!activeCountSession || activeCountSession.id !== sessionId) return;
    sessionItemsCache = data;
    rebuildItemsMap();
    updateSessionStatsFromCache();
    if (forceRender) {
      refreshActiveTabView(false);
    } else if (activeTabName === 'scanner') {
      renderLiveFeedList(false);
    }
  } catch (e) {
    console.warn('Error recargando lecturas:', e);
  }
}

function updateSessionStatsFromCache() {
  const totalScans = sessionItemsCache.length;
  let totalUnits = 0;
  const skuSet = new Set();
  const devicesSet = new Set();

  for (let i = 0; i < sessionItemsCache.length; i++) {
    const x = sessionItemsCache[i];
    totalUnits += (x.quantity || 0);
    skuSet.add(String(x.sku || '').toUpperCase().trim());
    devicesSet.add(x.operator_name || x.device_id || 'Móvil');
  }

  if (localOperatorName) devicesSet.add(localOperatorName);
  const uniqueSkus = skuSet.size;
  const activeDevices = Math.max(1, devicesSet.size);

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('kpi-inv-units', totalUnits.toLocaleString('es-CL'));
  setTxt('kpi-inv-skus', uniqueSkus.toLocaleString('es-CL'));
  setTxt('kpi-inv-scans', totalScans.toLocaleString('es-CL'));
  setTxt('kpi-inv-devices', activeDevices);
  setTxt('badge-inv-total-skus', uniqueSkus);
  setTxt('badge-inv-total-scans', totalScans);
  setTxt('lbl-active-operators-badge', `${activeDevices} dispositivo${activeDevices > 1 ? 's' : ''}`);
}

// ==========================================
// GESTIÓN Y EDICIÓN DE SESIONES
// ==========================================
function renderSessionHeaderMeta(session) {
  const titleEl = document.getElementById('inv-current-session-title');
  const subEl = document.getElementById('inv-current-session-sub');
  const shareBtn = document.getElementById('btn-inv-share-qr');
  const editSessBtn = document.getElementById('btn-inv-edit-session');

  if (!session) {
    if (titleEl) titleEl.textContent = 'Sin Sesión Activa';
    if (subEl) subEl.textContent = 'Crea una nueva sesión o selecciona una existente.';
    if (shareBtn) shareBtn.style.display = 'none';
    if (editSessBtn) editSessBtn.style.display = 'none';
    return;
  }

  const statusColor = session.status === 'activa' ? '#059669' : (session.status === 'pausada' ? '#d97706' : '#475569');
  if (titleEl) titleEl.textContent = `${session.folio}: ${session.title}`;
  if (subEl) {
    subEl.innerHTML = `
      <span class="inv-meta-chip"><i class="ri-store-2-line"></i> ${escapeHtml(session.comercio)}</span>
      <span class="inv-meta-chip"><i class="ri-building-2-line"></i> ${escapeHtml(session.warehouse_name || 'Todas')}</span>
      <span class="inv-meta-chip" style="color: ${statusColor}; border-color: ${statusColor}44;"><i class="ri-flag-line" style="color:${statusColor};"></i> ${(session.status || 'activa').toUpperCase()}</span>
    `;
  }
  if (shareBtn) shareBtn.style.display = 'inline-flex';
  if (editSessBtn) editSessBtn.style.display = 'inline-flex';
  updateLiveConnectionBadge(isRealtimeConnected ? 'SUBSCRIBED' : 'FALLBACK');
}

async function loadMetadataAndSessions() {
  try {
    const [whRes, merRes] = await Promise.all([
      supabase.from('warehouses').select('id, name'),
      supabase.from('v_comercios_config').select('sigla, nombre')
    ]);

    sessionWarehouses = whRes.data || [];
    sessionMerchants = merRes.data || [];

    const urlParams = new URLSearchParams(window.location.search);
    const targetSessionId = urlParams.get('session');

    let query = supabase.from('inventory_count_sessions').select('*');
    if (targetSessionId) query = query.eq('id', targetSessionId);
    else query = query.eq('status', 'activa').order('created_at', { ascending: false });

    const { data: sessions, error } = await query.limit(1);
    if (!error && sessions && sessions.length > 0) {
      await setActiveSession(sessions[0]);
    } else {
      activeCountSession = null;
      renderSessionHeaderMeta(null);
      renderScannerView();
    }
  } catch (err) {
    console.error('Error cargando sesiones:', err);
  }
}

async function setActiveSession(session) {
  activeCountSession = session;
  lastScannedItemInfo = null;
  lastFeedSignature = '';
  selectedLogIds.clear();
  cachedReconData = null;
  reconDataDirty = true;
  reconPage = 1;
  logsPage = 1;

  renderSessionHeaderMeta(session);

  try {
    sessionItemsCache = await fetchAllSessionItems(session.id);
  } catch (e) {
    console.error('Error cargando lecturas de sesión:', e);
    sessionItemsCache = [];
  }
  rebuildItemsMap();
  updateSessionStatsFromCache();

  setupRealtimeCollaboration(session.id);

  // Precargar catálogo y stock de bodega en segundo plano sin bloquear el primer render
  preloadSessionCatalogAndStock(session);

  if (activeTabName === 'scanner') renderScannerView();
  else if (activeTabName === 'live_recon') renderLiveReconView(false);
  else if (activeTabName === 'scan_logs') renderScanLogsView();
}

function initGlobalHeaderActions() {
  // Toggle Modo Ligero / Rendimiento
  document.getElementById('btn-inv-toggle-lite')?.addEventListener('click', () => {
    isLiteMode = !isLiteMode;
    localStorage.setItem('stocka_inv_lite_mode', isLiteMode ? 'true' : 'false');
    const root = document.getElementById('inv-count-root-wrapper');
    const btn = document.getElementById('btn-inv-toggle-lite');
    const lbl = document.getElementById('lbl-inv-lite-mode');
    root?.classList.toggle('inv-perf-lite', isLiteMode);
    btn?.classList.toggle('is-lite', isLiteMode);
    if (lbl) lbl.textContent = isLiteMode ? 'Modo Ligero: ON' : 'Modo Ligero';
    showInlineToast(isLiteMode ? 'Modo Ligero activado (menor uso de CPU/GPU)' : 'Modo visual estándar activado');
  });

  document.getElementById('btn-inv-edit-session')?.addEventListener('click', openEditSessionModal);

  document.getElementById('btn-inv-set-operator')?.addEventListener('click', () => {
    const newName = prompt('Nombre o identificación de este operador/dispositivo:', localOperatorName);
    if (newName && newName.trim()) {
      localOperatorName = newName.trim();
      localStorage.setItem('stocka_inv_operator_name', localOperatorName);
      const lbl = document.getElementById('lbl-inv-operator-name');
      if (lbl) lbl.textContent = localOperatorName;
      updateSessionStatsFromCache();
    }
  });

  document.getElementById('btn-inv-share-qr')?.addEventListener('click', openSessionQrModal);
  document.getElementById('btn-inv-switch-session')?.addEventListener('click', openSessionsModal);
  document.getElementById('btn-inv-new-session')?.addEventListener('click', openNewSessionModal);
}

// Modal Editar Sesión (Título, Notas, Estado)
function openEditSessionModal() {
  if (!activeCountSession) return;
  document.getElementById('modal-inv-edit-session')?.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-inv-edit-session';
  modal.className = 'inv-picker-modal-overlay';

  modal.innerHTML = `
    <div class="inv-picker-modal-content">
      <div class="inv-picker-modal-header">
        <h4 style="margin: 0; font-size: 0.96rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
          <i class="ri-settings-3-line" style="color: #6366f1;"></i> Editar Sesión (${escapeHtml(activeCountSession.folio)})
        </h4>
        <button type="button" id="btn-close-edit-session" style="background: transparent; border: none; font-size: 1.35rem; color: var(--color-text-muted); cursor: pointer;">
          <i class="ri-close-line"></i>
        </button>
      </div>

      <div class="inv-picker-modal-body">
        <div>
          <label style="font-size: 0.76rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">Título del Conteo</label>
          <input type="text" id="edit-sess-title" class="form-input" value="${escapeHtml(activeCountSession.title || '')}" style="width: 100%; height: 38px;">
        </div>
        <div>
          <label style="font-size: 0.76rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">Estado de la Sesión</label>
          <select id="edit-sess-status" class="form-input" style="width: 100%; height: 38px;">
            <option value="activa" ${activeCountSession.status === 'activa' ? 'selected' : ''}>Activa (Permite escanear y editar lecturas)</option>
            <option value="pausada" ${activeCountSession.status === 'pausada' ? 'selected' : ''}>Pausada</option>
            <option value="finalizada" ${activeCountSession.status === 'finalizada' ? 'selected' : ''}>Finalizada (Solo lectura)</option>
          </select>
        </div>
        <div>
          <label style="font-size: 0.76rem; font-weight: 700; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">Notas / Observaciones</label>
          <textarea id="edit-sess-notes" class="form-input" rows="3" style="width: 100%;">${escapeHtml(activeCountSession.notes || '')}</textarea>
        </div>
      </div>

      <div class="inv-picker-modal-footer">
        <span></span>
        <div style="display: flex; gap: 0.5rem;">
          <button type="button" id="btn-cancel-edit-session" class="btn btn-outline btn-sm">Cancelar</button>
          <button type="button" id="btn-save-edit-session" class="btn btn-primary btn-sm" style="background: #6366f1; border-color: #6366f1; font-weight: 700;">
            <i class="ri-save-line"></i> Guardar Sesión
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('btn-close-edit-session')?.addEventListener('click', close);
  document.getElementById('btn-cancel-edit-session')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.getElementById('btn-save-edit-session')?.addEventListener('click', async () => {
    const newTitle = document.getElementById('edit-sess-title').value.trim() || activeCountSession.title;
    const newStatus = document.getElementById('edit-sess-status').value;
    const newNotes = document.getElementById('edit-sess-notes').value.trim();

    const btn = document.getElementById('btn-save-edit-session');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

    try {
      const { error } = await supabase
        .from('inventory_count_sessions')
        .update({ title: newTitle, status: newStatus, notes: newNotes, updated_at: new Date().toISOString() })
        .eq('id', activeCountSession.id);
      if (error) throw error;

      activeCountSession.title = newTitle;
      activeCountSession.status = newStatus;
      activeCountSession.notes = newNotes;
      renderSessionHeaderMeta(activeCountSession);
      close();
      if (activeTabName === 'scanner') renderScannerView();
      else if (activeTabName === 'live_recon') renderLiveReconView(false);
      else renderScanLogsView();
      showInlineToast('Sesión actualizada');
    } catch (err) {
      alert('Error actualizando sesión: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-save-line"></i> Guardar Sesión';
    }
  });
}

function openSessionQrModal() {
  if (!activeCountSession) return;
  const joinUrl = window.StockaRouter
    ? `${window.location.origin}${window.StockaRouter.getViewUrl('inventory_count', 'admin', { session: activeCountSession.id })}`
    : `${window.location.origin}${window.location.pathname}?view=inventory_count&session=${activeCountSession.id}`;

  document.getElementById('modal-inv-share-qr')?.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-inv-share-qr';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10060';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 440px; text-align: center; padding: 1.4rem; background: var(--color-surface); border-radius: var(--radius-lg);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.9rem;">
        <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); font-weight: 800;">
          <i class="ri-qr-code-line" style="color: #10b981;"></i> Unir Teléfonos a la Sesión
        </h3>
        <button type="button" class="modal-close" onclick="document.getElementById('modal-inv-share-qr').remove()">&times;</button>
      </div>
      <p style="font-size: 0.82rem; color: var(--color-text-muted); margin-bottom: 1rem;">
        Escanea este QR desde otro teléfono para contar en paralelo en tiempo real:
      </p>
      <div id="inv-session-qr-canvas" style="display: flex; justify-content: center; margin-bottom: 1rem;"></div>
      <div style="background: var(--color-bg); padding: 0.65rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); font-family: monospace; font-size: 0.76rem; word-break: break-all; margin-bottom: 1rem; color: var(--color-primary);">
        ${escapeHtml(joinUrl)}
      </div>
      <button type="button" class="btn btn-primary" style="width: 100%;" onclick="document.getElementById('modal-inv-share-qr').remove()">Entendido</button>
    </div>
  `;

  document.body.appendChild(modal);
  if (typeof qrcode !== 'undefined') {
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    document.getElementById('inv-session-qr-canvas').innerHTML = qr.createImgTag(5, 10);
  }
}

async function openSessionsModal() {
  document.getElementById('modal-inv-sessions-list')?.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-inv-sessions-list';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10060';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 660px; padding: 1.35rem; background: var(--color-surface); border-radius: var(--radius-lg); max-height: 85vh; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.9rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.7rem;">
        <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); font-weight: 800;">
          <i class="ri-folder-shared-line" style="color: #6366f1;"></i> Sesiones de Conteo de Inventario
        </h3>
        <button type="button" class="modal-close" onclick="document.getElementById('modal-inv-sessions-list').remove()">&times;</button>
      </div>
      <div id="inv-sessions-loading" style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-loader-4-line ri-spin" style="font-size: 1.5rem;"></i> Cargando sesiones...
      </div>
      <div id="inv-sessions-table-wrapper" style="overflow-y: auto; flex: 1; display: none;"></div>
    </div>
  `;

  document.body.appendChild(modal);

  try {
    const { data: sessions, error } = await supabase
      .from('inventory_count_sessions')
      .select('id, folio, title, comercio, warehouse_id, warehouse_name, status, total_units, unique_skus, total_scans, notes, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) throw error;

    const listWrapper = document.getElementById('inv-sessions-table-wrapper');
    document.getElementById('inv-sessions-loading').style.display = 'none';
    listWrapper.style.display = 'block';

    if (!sessions || sessions.length === 0) {
      listWrapper.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No hay sesiones registradas aún.</div>';
      return;
    }

    listWrapper.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.55rem;">
        ${sessions.map(s => {
          const isCurrent = activeCountSession && activeCountSession.id === s.id;
          const isActive = s.status === 'activa';
          return `
            <div style="background: var(--color-bg); border: 1px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border)'}; border-radius: var(--radius-md); padding: 0.75rem 0.85rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;">
              <div style="min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                  <strong style="color: var(--color-text-main); font-size: 0.9rem;">${escapeHtml(s.folio)}: ${escapeHtml(s.title)}</strong>
                  <span class="badge ${isActive ? 'badge-success' : 'badge-secondary'}" style="font-size: 0.64rem;">${(s.status || 'activa').toUpperCase()}</span>
                </div>
                <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.2rem;">
                  Comercio: <strong>${escapeHtml(s.comercio)}</strong> • Bodega: <strong>${escapeHtml(s.warehouse_name || 'Todas')}</strong> • <strong>${s.total_units || 0}</strong> un. (${s.unique_skus || 0} SKUs)
                </div>
              </div>
              <button type="button" class="btn btn-sm ${isCurrent ? 'btn-primary' : 'btn-outline'} btn-select-session" data-id="${s.id}" ${isCurrent ? 'disabled' : ''} style="flex-shrink: 0;">
                ${isCurrent ? 'Actual' : 'Ingresar'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;

    listWrapper.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-select-session');
      if (!btn || btn.disabled) return;
      const selected = sessions.find(x => x.id === btn.getAttribute('data-id'));
      if (selected) {
        modal.remove();
        await setActiveSession(selected);
      }
    });
  } catch (err) {
    alert('Error al cargar sesiones: ' + err.message);
  }
}

function openNewSessionModal() {
  document.getElementById('modal-inv-new-session')?.remove();
  const autoFolio = `CNT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const modal = document.createElement('div');
  modal.id = 'modal-inv-new-session';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10060';

  const whOptions = sessionWarehouses.map(w => `<option value="${w.id}" data-name="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`).join('');
  const merchOptions = ['<option value="Todos">Todos los Comercios (General)</option>', ...sessionMerchants.map(m => `<option value="${escapeHtml(m.nombre)}">${escapeHtml(m.nombre)}</option>`)].join('');

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 520px; padding: 1.4rem; background: var(--color-surface); border-radius: var(--radius-lg);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.7rem;">
        <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); font-weight: 800;">
          <i class="ri-add-circle-line" style="color: #6366f1;"></i> Iniciar Nueva Sesión de Conteo
        </h3>
        <button type="button" class="modal-close" onclick="document.getElementById('modal-inv-new-session').remove()">&times;</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.9rem;">
        <div>
          <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 0.2rem;">Folio de la Sesión</label>
          <input type="text" id="new-sess-folio" class="form-input" value="${autoFolio}" style="width: 100%; height: 38px; font-family: monospace; font-weight: 700;">
        </div>
        <div>
          <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 0.2rem;">Título / Motivo</label>
          <input type="text" id="new-sess-title" class="form-input" value="Toma Física de Inventario" style="width: 100%; height: 38px;">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem;">
          <div>
            <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 0.2rem;">Comercio</label>
            <select id="new-sess-commerce" class="form-input" style="width: 100%; height: 38px;">${merchOptions}</select>
          </div>
          <div>
            <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 0.2rem;">Bodega Asignada</label>
            <select id="new-sess-warehouse" class="form-input" style="width: 100%; height: 38px;">
              <option value="" data-name="Todas las bodegas">Todas las bodegas</option>
              ${whOptions}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size: 0.78rem; font-weight: 600; display: block; margin-bottom: 0.2rem;">Notas / Instrucciones</label>
          <textarea id="new-sess-notes" class="form-input" rows="2" placeholder="Ej: Pasillos 1 al 4..." style="width: 100%;"></textarea>
        </div>
        <div style="display: flex; gap: 0.65rem; margin-top: 0.35rem;">
          <button type="button" class="btn btn-outline" style="flex: 1;" onclick="document.getElementById('modal-inv-new-session').remove()">Cancelar</button>
          <button type="button" id="btn-save-new-session" class="btn btn-primary" style="flex: 2; background: #6366f1; border-color: #6366f1; font-weight: 700;">Crear y Abrir Conteo</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('btn-save-new-session')?.addEventListener('click', async () => {
    const folio = document.getElementById('new-sess-folio').value.trim() || autoFolio;
    const title = document.getElementById('new-sess-title').value.trim() || 'Conteo Físico';
    const comercio = document.getElementById('new-sess-commerce').value;
    const whSelect = document.getElementById('new-sess-warehouse');
    const warehouseId = whSelect.value || null;
    const warehouseName = whSelect.options[whSelect.selectedIndex]?.getAttribute('data-name') || 'Todas las bodegas';
    const notes = document.getElementById('new-sess-notes').value.trim();

    const saveBtn = document.getElementById('btn-save-new-session');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Creando...';

    try {
      const { data, error } = await supabase
        .from('inventory_count_sessions')
        .insert([{
          folio, title, comercio, warehouse_id: warehouseId, warehouse_name: warehouseName,
          status: 'activa', created_by: localOperatorName || 'Admin', notes
        }])
        .select();
      if (error) throw error;
      modal.remove();
      if (data && data.length > 0) await setActiveSession(data[0]);
    } catch (err) {
      alert('Error al crear sesión: ' + err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Crear y Abrir Conteo';
    }
  });
}

// ==========================================
// FINALIZAR Y APLICAR CONTEO (PROCESAMIENTO POR LOTES CON PROGRESO)
// ==========================================
async function handleCloseSessionAndApply() {
  if (!activeCountSession) { alert('No hay una sesión activa seleccionada.'); return; }

  const btn = document.getElementById('btn-close-inv-session');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Analizando...'; }

  let recon;
  try {
    recon = await computeSessionReconciliation(true);
  } catch (err) {
    alert('Error analizando cuadratura: ' + err.message);
    return;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }

  if (!recon || recon.allItems.length === 0) {
    alert('No se encontraron registros ni productos para procesar.');
    return;
  }

  const totals = recon.totals;
  const warehouseName = activeCountSession.warehouse_name || 'Bodega General';
  const warehouseId = activeCountSession.warehouse_id;

  document.getElementById('modal-inv-close-apply')?.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-inv-close-apply';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';

  modal.innerHTML = `
    <div style="background: var(--color-surface, #ffffff); border-radius: 12px; width: 100%; max-width: 660px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 45px rgba(0,0,0,0.25); border: 1px solid var(--color-border); display: flex; flex-direction: column;">
      <div style="padding: 1.1rem 1.35rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-bg);">
        <div>
          <div style="font-size: 0.7rem; font-weight: 700; color: var(--color-primary); text-transform: uppercase;">Auditoría & Ajuste de Existencias</div>
          <h3 style="margin: 0.1rem 0 0; font-size: 1.12rem; font-weight: 800; color: var(--color-text-main);">Finalizar y Aplicar (${escapeHtml(activeCountSession.folio)})</h3>
          <div style="font-size: 0.76rem; color: var(--color-text-muted); margin-top: 2px;">
            Comercio: <strong>${escapeHtml(activeCountSession.comercio)}</strong> • Bodega: <strong>${escapeHtml(warehouseName)}</strong>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('modal-inv-close-apply').remove()" style="background: none; border: none; font-size: 1.35rem; color: var(--color-text-muted); cursor: pointer;">
          <i class="ri-close-line"></i>
        </button>
      </div>

      <div style="padding: 1.15rem 1.35rem; display: flex; flex-direction: column; gap: 0.95rem;">
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.65rem; background: var(--color-bg); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--color-border); text-align: center;">
          <div>
            <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Físico Contado</div>
            <div style="font-size: 1.2rem; font-weight: 800; color: #059669;">${totals.totalCountedUnits} un.</div>
            <div style="font-size: 0.68rem; color: var(--color-text-muted);">${totals.scannedSkus} SKUs escaneados</div>
          </div>
          <div style="border-left: 1px solid var(--color-border); border-right: 1px solid var(--color-border);">
            <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Stock Sistema</div>
            <div style="font-size: 1.2rem; font-weight: 800; color: #4f46e5;">${totals.totalSystemUnits} un.</div>
            <div style="font-size: 0.68rem; color: var(--color-text-muted);">${totals.totalSkus} SKUs totales</div>
          </div>
          <div>
            <div style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase;">Diferencia Neta</div>
            <div style="font-size: 1.2rem; font-weight: 800; color: ${totals.netDiffUnits === 0 ? '#059669' : (totals.netDiffUnits > 0 ? '#4f46e5' : '#dc2626')};">
              ${totals.netDiffUnits > 0 ? '+' : ''}${totals.netDiffUnits} un.
            </div>
            <div style="font-size: 0.68rem; color: var(--color-text-muted);">${totals.matchedCount} exactas</div>
          </div>
        </div>

        ${totals.unscannedSkus > 0 ? `
          <div style="background: rgba(239, 68, 68, 0.08); border-left: 4px solid #ef4444; border-radius: 6px; padding: 0.65rem 0.9rem; font-size: 0.78rem; color: #991b1b;">
            <strong>Atención:</strong> Existen ${totals.unscannedSkus} SKUs con stock en sistema que NO fueron escaneados. Elige abajo si deseas ajustarlos a cero o mantenerlos.
          </div>
        ` : ''}

        <div style="display: flex; flex-direction: column; gap: 0.55rem;">
          <label style="display: flex; gap: 0.7rem; padding: 0.75rem; border: 1.5px solid var(--color-border); border-radius: 8px; cursor: pointer;">
            <input type="radio" name="apply_inventory_mode" value="all_warehouse" checked style="margin-top: 0.2rem;">
            <div>
              <div style="font-weight: 700; font-size: 0.86rem;">Conteo General de Bodega (100% - Recomendado)</div>
              <div style="font-size: 0.74rem; color: var(--color-text-muted);">Aplica stock físico a los ${totals.scannedSkus} SKUs escaneados${totals.unscannedSkus > 0 ? ` y ajusta a 0 los ${totals.unscannedSkus} no encontrados` : ''}.</div>
            </div>
          </label>
          <label style="display: flex; gap: 0.7rem; padding: 0.75rem; border: 1.5px solid var(--color-border); border-radius: 8px; cursor: pointer;">
            <input type="radio" name="apply_inventory_mode" value="counted_only" style="margin-top: 0.2rem;">
            <div>
              <div style="font-weight: 700; font-size: 0.86rem;">Solo SKUs Contados (Conteo Cíclico / Parcial)</div>
              <div style="font-size: 0.74rem; color: var(--color-text-muted);">Ajusta únicamente los ${totals.scannedSkus} SKUs escaneados sin tocar el resto.</div>
            </div>
          </label>
          <label style="display: flex; gap: 0.7rem; padding: 0.75rem; border: 1.5px solid var(--color-border); border-radius: 8px; cursor: pointer;">
            <input type="radio" name="apply_inventory_mode" value="close_only" style="margin-top: 0.2rem;">
            <div>
              <div style="font-weight: 700; font-size: 0.86rem;">Solo Finalizar Sesión (Sin modificar stock)</div>
              <div style="font-size: 0.74rem; color: var(--color-text-muted);">Cierra la sesión para auditoría sin alterar la tabla de inventario.</div>
            </div>
          </label>
        </div>

        <div id="inv-apply-progress-bar" style="display: none; font-size: 0.78rem; font-weight: 700; color: var(--color-primary); background: var(--color-bg); padding: 0.6rem 0.85rem; border-radius: 6px; border: 1px solid var(--color-border);"></div>
      </div>

      <div style="padding: 0.9rem 1.35rem; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 0.65rem; background: var(--color-bg);">
        <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-inv-close-apply').remove()">Cancelar</button>
        <button type="button" id="btn-confirm-apply-inventory" class="btn btn-primary" style="background: #10b981; border-color: #10b981; font-weight: 700;">
          <i class="ri-check-double-line"></i> Confirmar y Aplicar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('btn-confirm-apply-inventory')?.addEventListener('click', async () => {
    const selectedMode = modal.querySelector('input[name="apply_inventory_mode"]:checked')?.value || 'all_warehouse';
    const confirmBtn = document.getElementById('btn-confirm-apply-inventory');
    const progEl = document.getElementById('inv-apply-progress-bar');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Aplicando...';

    try {
      let appliedCount = 0;
      let totalUnitsAdjusted = 0;

      if (selectedMode !== 'close_only') {
        if (!warehouseId) throw new Error('La sesión no tiene una bodega asignada.');

        const itemsToAdjust = selectedMode === 'all_warehouse'
          ? recon.allItems.filter(x => x.diff !== 0 && x.productId)
          : recon.allItems.filter(x => x.wasScanned && x.diff !== 0 && x.productId);

        if (progEl) {
          progEl.style.display = 'block';
          progEl.textContent = `Procesando 0 / ${itemsToAdjust.length} SKUs...`;
        }

        const processOne = async (item) => {
          const targetQty = item.totalCounted;
          const diff = item.diff;
          const moveType = diff > 0 ? 'in' : 'out';
          const absDiff = Math.abs(diff);

          const { data: existingInv } = await supabase
            .from('inventory')
            .select('id')
            .eq('product_id', item.productId)
            .eq('warehouse_id', warehouseId)
            .maybeSingle();

          if (existingInv) {
            const { error: updErr } = await supabase
              .from('inventory')
              .update({ quantity: targetQty, updated_at: new Date().toISOString() })
              .eq('id', existingInv.id);
            if (updErr) throw updErr;
          } else {
            const { error: insErr } = await supabase
              .from('inventory')
              .insert([{ product_id: item.productId, warehouse_id: warehouseId, quantity: targetQty, committed_quantity: 0 }]);
            if (insErr) throw insErr;
          }

          const refDoc = !item.wasScanned
            ? `Ajuste Conteo Físico (Faltante 0 un. en bodega): ${activeCountSession.folio}`
            : `Ajuste Conteo Físico (${diff > 0 ? 'Sobrante +' : 'Faltante -'}${absDiff} un.): ${activeCountSession.folio}`;

          await supabase.from('movements').insert([{
            product_id: item.productId,
            warehouse_id: warehouseId,
            type: moveType,
            quantity: absDiff,
            reference_doc: refDoc
          }]);

          appliedCount++;
          totalUnitsAdjusted += absDiff;
        };

        // Procesar en lotes paralelos de 6 para ser rápido sin saturar PC ni DB
        const batchSize = 6;
        for (let i = 0; i < itemsToAdjust.length; i += batchSize) {
          const batch = itemsToAdjust.slice(i, i + batchSize);
          await Promise.all(batch.map(processOne));
          if (progEl) {
            progEl.textContent = `Procesando ${Math.min(i + batchSize, itemsToAdjust.length)} / ${itemsToAdjust.length} SKUs...`;
          }
        }
      }

      const { error: sessErr } = await supabase
        .from('inventory_count_sessions')
        .update({
          status: 'finalizada',
          closed_at: new Date().toISOString(),
          notes: (activeCountSession.notes ? activeCountSession.notes + '\n' : '') +
            `[Finalizado el ${new Date().toLocaleString('es-CL')}]: Modo ${selectedMode}. Ajustados ${appliedCount} SKUs (${totalUnitsAdjusted} un.).`
        })
        .eq('id', activeCountSession.id);
      if (sessErr) throw sessErr;

      activeCountSession.status = 'finalizada';
      renderSessionHeaderMeta(activeCountSession);
      modal.remove();

      alert(
        selectedMode !== 'close_only'
          ? `¡Sesión ${activeCountSession.folio} finalizada!\n\nSe aplicaron ajustes en ${appliedCount} SKUs (${totalUnitsAdjusted} un.) en ${warehouseName}.`
          : `¡Sesión ${activeCountSession.folio} finalizada en modo auditoría!`
      );
      renderLiveReconView(true);
    } catch (err) {
      alert('Error al aplicar ajustes: ' + err.message);
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="ri-check-double-line"></i> Confirmar y Aplicar';
    }
  });
}

// ==========================================
// EXPORTACIÓN A EXCEL Y PDF
// ==========================================
async function exportInventoryCountToExcel() {
  if (!activeCountSession) { alert('No hay una sesión activa.'); return; }
  if (typeof XLSX === 'undefined') { alert('Librería SheetJS (XLSX) no disponible.'); return; }

  const recon = (cachedReconData && !reconDataDirty) ? cachedReconData : await computeSessionReconciliation(false);
  if (!recon || recon.allItems.length === 0) { alert('No hay datos para exportar.'); return; }

  const totals = recon.totals;
  const safeCommerce = activeCountSession.comercio || 'Comercio';

  const reconRows = [
    ['STOCKA WMS - ACTA OFICIAL DE AUDITORÍA Y CUADRATURA DE INVENTARIO'],
    ['Folio Sesión:', activeCountSession.folio, '', 'Título:', activeCountSession.title || 'Conteo Físico'],
    ['Comercio:', safeCommerce, '', 'Bodega:', activeCountSession.warehouse_name || 'Todas'],
    ['Fecha Emisión:', new Date().toLocaleString('es-CL'), '', 'Estado Sesión:', (activeCountSession.status || 'activa').toUpperCase()],
    ['Total Físico Contado:', `${totals.totalCountedUnits} unidades`, '', 'Stock en Sistema:', `${totals.totalSystemUnits} unidades`],
    ['Diferencia Neta:', `${totals.netDiffUnits > 0 ? '+' : ''}${totals.netDiffUnits} unidades`, '', 'Cuadradas Exactas:', `${totals.matchedCount} de ${totals.totalSkus} SKUs`],
    [],
    ['N°', 'SKU', 'Código de Barras', 'Descripción del Producto', 'Comercio', 'Stock Sistema', 'Físico Contado', 'Diferencia (±)', 'Resultado Cuadratura', 'Estado en Bodega', 'N° Lecturas', 'Vencimiento(s)', 'Lote(s)', 'Operadores', 'Ubicaciones']
  ];

  recon.allItems.forEach((item, idx) => {
    let resultLabel = 'CUADRADO';
    if (item.diff > 0) resultLabel = `SOBRANTE (+${item.diff})`;
    else if (item.diff < 0) resultLabel = !item.wasScanned ? 'NO ENCONTRADO (0 un.)' : `FALTANTE (${item.diff})`;

    reconRows.push([
      idx + 1, item.sku || '', item.barcode || '', item.name || '', item.comercio || safeCommerce,
      item.systemStock || 0, item.totalCounted || 0, item.diff, resultLabel,
      item.wasScanned ? 'Escaneado en Bodega' : 'No Encontrado (0 físico)',
      item.readingsCount || 0,
      Array.from(item.expiryDates || []).join(', ') || '-',
      Array.from(item.lots || []).join(', ') || '-',
      Array.from(item.operators || []).join(', ') || '-',
      Array.from(item.locations || []).join(', ') || '-'
    ]);
  });

  const detailRows = [
    ['STOCKA WMS - REGISTRO AUDITABLE DE LECTURAS (KARDEX)'],
    ['Folio Sesión:', activeCountSession.folio, '', 'Comercio:', safeCommerce],
    [],
    ['N°', 'Fecha y Hora', 'Operador', 'Dispositivo', 'SKU', 'Código Barras', 'Producto', 'Cantidad', 'Fecha Vencimiento', 'Lote', 'Ubicación', 'Notas']
  ];

  sessionItemsCache.forEach((item, i) => {
    detailRows.push([
      i + 1, item.created_at ? new Date(item.created_at).toLocaleString('es-CL') : '',
      item.operator_name || 'Admin', item.device_id || '', item.sku, item.barcode || '',
      item.product_name, item.quantity, item.expiry_date || '', item.lot_number || '',
      item.location || '', item.notes || ''
    ]);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(reconRows), 'Cuadratura General');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), 'Detalle de Escaneos');

  const cleanCommerce = safeCommerce.replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `Cuadratura_${activeCountSession.folio}_${cleanCommerce}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

async function exportInventoryCountToPdf() {
  if (!activeCountSession) { alert('No hay una sesión activa.'); return; }
  const recon = (cachedReconData && !reconDataDirty) ? cachedReconData : await computeSessionReconciliation(false);
  if (!recon || recon.allItems.length === 0) { alert('No hay datos para generar el PDF.'); return; }

  const totals = recon.totals;
  const safeCommerce = activeCountSession.comercio || 'Comercio';
  const warehouseName = activeCountSession.warehouse_name || 'Todas las bodegas';

  const tableRowsHtml = recon.allItems.map((item, idx) => {
    const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    const expiryStr = item.expiryDates?.size ? Array.from(item.expiryDates).join(', ') : '-';
    const operatorsStr = item.operators?.size ? Array.from(item.operators).join(', ') : 'Operador';
    let diffBadge = '<span style="background:#dcfce7;color:#15803d;font-weight:700;padding:2px 6px;border-radius:4px;font-size:6.8pt;">✓ CUADRADO</span>';
    if (item.diff > 0) diffBadge = `<span style="background:#ede9fe;color:#6d28d9;font-weight:700;padding:2px 6px;border-radius:4px;font-size:6.8pt;">▲ +${item.diff} SOBRANTE</span>`;
    else if (!item.wasScanned) diffBadge = '<span style="background:#fef2f2;color:#991b1b;font-weight:800;padding:2px 6px;border-radius:4px;font-size:6.8pt;border:1px dashed #ef4444;">✕ NO ENCONTRADO</span>';
    else if (item.diff < 0) diffBadge = `<span style="background:#fee2e2;color:#b91c1c;font-weight:700;padding:2px 6px;border-radius:4px;font-size:6.8pt;">▼ ${item.diff} FALTANTE</span>`;

    return `
      <tr style="background:${bg};border-bottom:1px solid #cbd5e1;page-break-inside:avoid;font-size:7.2pt;">
        <td style="padding:4px 3px;text-align:center;color:#64748b;border-right:1px solid #e2e8f0;">${idx + 1}</td>
        <td style="padding:4px 6px;font-family:monospace;font-weight:700;border-right:1px solid #e2e8f0;white-space:nowrap;">${escapeHtml(item.sku || '-')}</td>
        <td style="padding:4px 6px;font-family:monospace;color:#475569;border-right:1px solid #e2e8f0;">${escapeHtml(item.barcode || '-')}</td>
        <td style="padding:4px 6px;border-right:1px solid #e2e8f0;">${escapeHtml(item.name || 'Sin descripción')}</td>
        <td style="padding:4px 6px;text-align:center;font-weight:700;color:#6366f1;border-right:1px solid #e2e8f0;">${item.systemStock} un.</td>
        <td style="padding:4px 6px;text-align:center;font-weight:800;color:${item.wasScanned ? '#047857' : '#ef4444'};border-right:1px solid #e2e8f0;">${item.totalCounted} un.</td>
        <td style="padding:4px 6px;text-align:center;font-weight:800;color:${item.diff === 0 ? '#10b981' : (item.diff > 0 ? '#6366f1' : '#ef4444')};border-right:1px solid #e2e8f0;">${item.diff > 0 ? '+' : ''}${item.diff} un.</td>
        <td style="padding:4px 6px;text-align:center;border-right:1px solid #e2e8f0;">${diffBadge}</td>
        <td style="padding:4px 6px;color:#475569;border-right:1px solid #e2e8f0;font-size:6.8pt;">${escapeHtml(expiryStr)}</td>
        <td style="padding:4px 6px;color:#64748b;font-size:6.8pt;">${escapeHtml(operatorsStr)}</td>
      </tr>
    `;
  }).join('');

  const container = document.createElement('div');
  container.id = 'inv-audit-pdf-container';
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:1120px;background:#fff;color:#0f172a;font-family:Inter,Arial,sans-serif;padding:12px 18px;box-sizing:border-box;';
  container.innerHTML = `
    <div id="pdf-audit-printable-area" style="width:100%;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #0f172a;padding-bottom:8px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="img/newlogotransp.png" alt="STOCKA Logo" style="height:38px;width:auto;object-fit:contain;" onerror="this.onerror=null;this.src='https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093';">
          <div>
            <div style="display:inline-block;background:#0f172a;color:#fff;padding:2px 7px;border-radius:3px;font-size:6.8pt;font-weight:800;text-transform:uppercase;">Auditoría & Control Físico</div>
            <h1 style="margin:2px 0 0;font-size:13pt;font-weight:800;text-transform:uppercase;">Acta Oficial de Cuadratura de Inventario</h1>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="display:inline-block;background:#0f172a;color:#fff;padding:4px 10px;border-radius:4px;font-weight:800;font-size:9.5pt;font-family:monospace;">${escapeHtml(activeCountSession.folio)}</div>
          <div style="font-size:7pt;color:#64748b;margin-top:3px;">Emisión: <strong>${new Date().toLocaleString('es-CL')}</strong></div>
        </div>
      </div>

      <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:7.5pt;">
        <strong>Cliente / Comercio:</strong> ${escapeHtml(safeCommerce)} &nbsp;•&nbsp;
        <strong>Bodega:</strong> ${escapeHtml(warehouseName)} &nbsp;•&nbsp;
        <strong>Título:</strong> ${escapeHtml(activeCountSession.title || 'Conteo Físico')} &nbsp;•&nbsp;
        <strong>Físico:</strong> ${totals.totalCountedUnits} un. &nbsp;•&nbsp;
        <strong>Sistema:</strong> ${totals.totalSystemUnits} un. &nbsp;•&nbsp;
        <strong>Dif. Neta:</strong> ${totals.netDiffUnits > 0 ? '+' : ''}${totals.netDiffUnits} un.
      </div>

      <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;margin-bottom:12px;font-size:7.2pt;">
        <thead>
          <tr style="background:#0f172a;color:#fff;font-size:6.8pt;text-transform:uppercase;">
            <th style="padding:4px 3px;width:25px;text-align:center;">#</th>
            <th style="padding:4px 6px;width:100px;text-align:left;">SKU</th>
            <th style="padding:4px 6px;width:95px;text-align:left;">Cód. Barras</th>
            <th style="padding:4px 6px;text-align:left;">Producto</th>
            <th style="padding:4px 6px;width:75px;text-align:center;">Sistema</th>
            <th style="padding:4px 6px;width:75px;text-align:center;background:#047857;">Físico</th>
            <th style="padding:4px 6px;width:75px;text-align:center;">Dif.</th>
            <th style="padding:4px 6px;width:100px;text-align:center;">Resultado</th>
            <th style="padding:4px 6px;width:85px;text-align:left;">Vencimiento</th>
            <th style="padding:4px 6px;width:85px;text-align:left;">Operadores</th>
          </tr>
        </thead>
        <tbody>${tableRowsHtml}</tbody>
      </table>

      <!-- FIRMAS DE RESPONSABILIDAD -->
      <div style="page-break-inside:avoid;border-top:1px solid #cbd5e1;padding-top:8px;margin-top:10px;">
        <table style="width:100%;border-collapse:collapse;font-size:7.2pt;">
          <tr>
            <td style="width:32%;padding:6px 10px;border:1px solid #cbd5e1;vertical-align:top;background:#fff;">
              <div style="font-weight:700;color:#0f172a;margin-bottom:18px;text-transform:uppercase;font-size:6.8pt;border-bottom:1px solid #e2e8f0;padding-bottom:2px;">Responsable del Conteo (Bodeguero)</div>
              <div style="color:#475569;font-size:6.8pt;line-height:1.6;">
                <div>Nombre: ___________________________________</div>
                <div>RUT: ________________ Fecha: ___/___/______</div>
                <div style="margin-top:6px;">Firma: ____________________________________</div>
              </div>
            </td>
            <td style="width:2%;"></td>
            <td style="width:32%;padding:6px 10px;border:1px solid #cbd5e1;vertical-align:top;background:#fff;">
              <div style="font-weight:700;color:#0f172a;margin-bottom:18px;text-transform:uppercase;font-size:6.8pt;border-bottom:1px solid #e2e8f0;padding-bottom:2px;">Supervisor de Operaciones STOCKA WMS</div>
              <div style="color:#475569;font-size:6.8pt;line-height:1.6;">
                <div>Nombre: ___________________________________</div>
                <div>Hora Inicio: ____:____ &nbsp; Hora Fin: ____:____</div>
                <div style="margin-top:6px;">Firma V°B°: _______________________________</div>
              </div>
            </td>
            <td style="width:2%;"></td>
            <td style="width:32%;padding:6px 10px;border:1px solid #cbd5e1;vertical-align:top;background:#fff;">
              <div style="font-weight:700;color:#0f172a;margin-bottom:18px;text-transform:uppercase;font-size:6.8pt;border-bottom:1px solid #e2e8f0;padding-bottom:2px;">Conformidad del Cliente / Comercio</div>
              <div style="color:#475569;font-size:6.8pt;line-height:1.6;">
                <div>Nombre: ___________________________________</div>
                <div>Cargo: ________________ Fecha: ___/___/______</div>
                <div style="margin-top:6px;">Firma / Timbre: ___________________________</div>
              </div>
            </td>
          </tr>
        </table>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  try {
    const cleanCommerce = safeCommerce.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanFolio = String(activeCountSession.folio).replace(/[^a-zA-Z0-9_-]/g, '_');
    const opt = {
      margin: [6, 8, 6, 8],
      filename: `Acta_Cuadratura_${cleanFolio}_${cleanCommerce}.pdf`,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: isLiteMode ? 1.5 : 2, useCORS: true, scrollY: 0, scrollX: 0, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'] }
    };
    if (typeof html2pdf !== 'undefined') await html2pdf().from(container.querySelector('#pdf-audit-printable-area')).set(opt).save();
    else window.print();
  } catch (err) {
    alert('Error al generar PDF: ' + err.message);
  } finally {
    container.remove();
  }
}

window.renderInventoryCountAdmin = renderInventoryCountAdmin;
export default renderInventoryCountAdmin;
