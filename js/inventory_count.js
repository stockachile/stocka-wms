// js/inventory_count.js - Conteo de Inventario Móvil Colaborativo para Administradores de STOCKA WMS
import supabaseInstance from './supabase.js';

// Cliente Supabase seguro con fallback
const supabase = (supabaseInstance && typeof supabaseInstance.from === 'function')
  ? supabaseInstance
  : (window.supabaseClient && typeof window.supabaseClient.from === 'function' ? window.supabaseClient : supabaseInstance);

// ==========================================
// ESTADO GLOBAL DEL MÓDULO DE CONTEO
// ==========================================
let activeCountSession = null;
let html5QrCodeScanner = null;
let isScannerRunning = false;
let isTorchOn = false;
let currentCameraFacing = 'environment'; // 'environment' (trasera) o 'user' (frontal)
let isScanProcessing = false;
let realtimeChannel = null;
let fallbackPollingInterval = null;
let audioCtx = null;

// Caché de catálogo y lecturas
let sessionCatalogCache = [];
let sessionItemsCache = [];
let sessionWarehouses = [];
let sessionMerchants = [];

// Configuración del operador en este dispositivo
let localOperatorName = localStorage.getItem('stocka_inv_operator_name') || 'Admin Móvil';
let localDeviceId = localStorage.getItem('stocka_inv_device_id') || ('DEV-' + Math.random().toString(36).substring(2, 9).toUpperCase());
let isFastMode = localStorage.getItem('stocka_inv_fast_mode') === 'true'; // Modo ráfaga (+1 continuo)
let currentMatchMode = localStorage.getItem('stocka_inv_match_mode') || 'all'; // Criterio de búsqueda: 'all' | 'barcode' | 'barcode_origin' | 'barcode_wms' | 'sku' | 'name'
let keyboardMode = localStorage.getItem('stocka_inv_keyboard_mode') || 'numeric'; // 'numeric' o 'alpha'
let isNumpadExpanded = localStorage.getItem('stocka_inv_numpad_expanded') !== 'false';

localStorage.setItem('stocka_inv_device_id', localDeviceId);
localStorage.setItem('stocka_inv_operator_name', localOperatorName);

// Helper para sonido de escáner (Beep agudo agradable y click de teclado)
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
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } else if (type === 'tap') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(850, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.04);
    }
  } catch (e) {
    console.warn('AudioContext not allowed or not supported:', e);
  }
}

// Helper para vibración háptica
function triggerHaptic(type = 'success') {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      if (type === 'success') {
        navigator.vibrate([60]);
      } else if (type === 'error') {
        navigator.vibrate([100, 50, 100]);
      } else if (type === 'tap') {
        navigator.vibrate([12]);
      }
    } catch (e) {}
  }
}

// Helper de escape HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// VISTA PRINCIPAL DEL MÓDULO DE CONTEO
// ==========================================
export async function renderInventoryCountAdmin() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  // Detener escáner previo si existía
  await stopScannerSafe();

  appContent.innerHTML = `
    <div class="inv-count-wrapper">
      
      <!-- ENCABEZADO Y SELECTOR DE SESIÓN -->
      <div class="inv-count-header-card">
        <div class="inv-count-session-meta">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span id="inv-session-live-pill" class="inv-count-live-badge" style="display: none;">
                <span class="inv-count-live-dot"></span> EN VIVO
              </span>
              <h2 id="inv-current-session-title" style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--color-text-main);">
                Conteo de Inventario Móvil
              </h2>
            </div>
            <p id="inv-current-session-sub" style="margin: 0.2rem 0 0 0; font-size: 0.78rem; color: var(--color-text-muted);">
              Cargando sesiones disponibles...
            </p>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <!-- Selector de Operador -->
          <button id="btn-inv-set-operator" class="btn btn-outline btn-sm" style="height: 36px; display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8rem;" title="Cambiar nombre de este teléfono">
            <i class="ri-user-line" style="color: var(--color-primary);"></i>
            <span id="lbl-inv-operator-name">${escapeHtml(localOperatorName)}</span>
          </button>

          <!-- Compartir QR para unirse otros teléfonos -->
          <button id="btn-inv-share-qr" class="btn btn-outline btn-sm" style="height: 36px; display: none; align-items: center; gap: 0.35rem; font-size: 0.8rem;" title="Compartir código QR para que otros teléfonos se unan">
            <i class="ri-qr-code-line" style="color: #10b981;"></i> Unir Teléfonos
          </button>

          <!-- Cambiar de Sesión -->
          <button id="btn-inv-switch-session" class="btn btn-outline btn-sm" style="height: 36px; display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8rem;">
            <i class="ri-folder-shared-line"></i> Sesiones
          </button>

          <!-- Nueva Sesión -->
          <button id="btn-inv-new-session" class="btn btn-primary btn-sm" style="height: 36px; display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; background: #6366f1; border-color: #6366f1;">
            <i class="ri-add-line"></i> Nueva Sesión
          </button>
        </div>
      </div>

      <!-- PESTAÑAS DE NAVEGACIÓN DEL MÓDULO -->
      <div class="inv-count-tabs">
        <button class="inv-count-tab-btn active" data-tab="scanner">
          <i class="ri-camera-lens-line"></i> <span>Escáner Móvil</span>
        </button>
        <button class="inv-count-tab-btn" data-tab="live_recon">
          <i class="ri-scales-3-line"></i> <span>Cuadratura en Vivo</span>
          <span id="badge-inv-total-skus" class="badge" style="font-size: 0.7rem; background: rgba(99, 102, 241, 0.15); color: #6366f1;">0</span>
        </button>
        <button class="inv-count-tab-btn" data-tab="scan_logs">
          <i class="ri-history-line"></i> <span>Registro de Lecturas</span>
          <span id="badge-inv-total-scans" class="badge" style="font-size: 0.7rem; background: rgba(16, 185, 129, 0.15); color: #10b981;">0</span>
        </button>
      </div>

      <!-- MÉTRICAS RÁPIDAS EN VIVO -->
      <div class="inv-count-kpi-grid">
        <div class="inv-count-kpi-card">
          <div id="kpi-inv-units" class="inv-count-kpi-val" style="color: #10b981;">0</div>
          <div class="inv-count-kpi-lbl">Unidades Físicas</div>
        </div>
        <div class="inv-count-kpi-card">
          <div id="kpi-inv-skus" class="inv-count-kpi-val" style="color: #6366f1;">0</div>
          <div class="inv-count-kpi-lbl">SKUs Auditados</div>
        </div>
        <div class="inv-count-kpi-card">
          <div id="kpi-inv-scans" class="inv-count-kpi-val" style="color: #0284c7;">0</div>
          <div class="inv-count-kpi-lbl">Lecturas Totales</div>
        </div>
        <div class="inv-count-kpi-card">
          <div id="kpi-inv-devices" class="inv-count-kpi-val" style="color: #f59e0b;">1</div>
          <div class="inv-count-kpi-lbl">Teléfonos Activos</div>
        </div>
      </div>

      <!-- CONTENEDOR DE CONTENIDOS DINÁMICOS POR PESTAÑA -->
      <div id="inv-tab-content-area">
        <!-- Se renderiza por función según la pestaña activa -->
      </div>

    </div>

    <!-- MODAL / BOTTOM SHEET DE CONFIRMACIÓN DE LECTURA (MÓVIL FRIENDLY) -->
    <div id="inv-confirm-sheet" class="inv-sheet-overlay">
      <div class="inv-sheet-modal">
        <div class="inv-sheet-drag-handle"></div>

        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
          <div style="display: flex; gap: 0.75rem; align-items: center;">
            <div id="sheet-prod-thumb" class="inv-prod-thumb">
              <i class="ri-box-3-line"></i>
            </div>
            <div>
              <div id="sheet-prod-sku" style="font-family: monospace; font-size: 0.85rem; font-weight: 800; color: var(--color-primary);">SKU-12345</div>
              <h4 id="sheet-prod-name" style="margin: 0.15rem 0 0 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text-main); line-height: 1.25;">
                Nombre del Producto
              </h4>
              <div id="sheet-prod-meta" style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.2rem;">
                Comercio: <strong>-</strong> • Cód. Barras: <strong>-</strong>
              </div>
            </div>
          </div>
          <button type="button" class="btn-icon" id="btn-sheet-close" style="font-size: 1.25rem; color: var(--color-text-muted);">&times;</button>
        </div>

        <!-- Indicador de Stock Actual Teórico en Sistema -->
        <div style="background: var(--color-bg); padding: 0.6rem 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; font-size: 0.825rem;">
          <span style="color: var(--color-text-muted);">Stock Teórico en Sistema:</span>
          <strong id="sheet-prod-system-stock" style="color: var(--color-primary); font-size: 0.95rem;">-</strong>
        </div>

        <!-- STEPPER DE CANTIDAD -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-main); text-transform: uppercase;">
            Cantidad Contada Físicamente
          </label>
          <div class="inv-qty-stepper-box">
            <button type="button" class="inv-qty-step-btn" id="btn-qty-minus"><i class="ri-subtract-line"></i></button>
            <input type="number" id="input-sheet-qty" class="inv-qty-number-input" value="1" min="1" step="1" inputmode="numeric">
            <button type="button" class="inv-qty-step-btn" id="btn-qty-plus"><i class="ri-add-line"></i></button>
          </div>
          <!-- Chips de Suma Rápida -->
          <div class="inv-quick-add-chips">
            <button type="button" class="inv-quick-chip" data-add="1">+1</button>
            <button type="button" class="inv-quick-chip" data-add="5">+5</button>
            <button type="button" class="inv-quick-chip" data-add="10">+10</button>
            <button type="button" class="inv-quick-chip" data-add="25">+25</button>
            <button type="button" class="inv-quick-chip" data-add="50">+50</button>
            <button type="button" class="inv-quick-chip" id="btn-qty-reset" style="color: var(--color-text-muted);">Reset (1)</button>
          </div>
        </div>

        <!-- FECHA DE VENCIMIENTO (OPCIONAL / SOLO SI APLICA) -->
        <div style="background: var(--color-bg); padding: 0.75rem 0.9rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label for="chk-has-expiry" style="font-size: 0.825rem; font-weight: 600; color: var(--color-text-main); cursor: pointer; display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-calendar-event-line" style="color: #6366f1;"></i> Registrar Fecha de Vencimiento
            </label>
            <input type="checkbox" id="chk-has-expiry" style="width: 18px; height: 18px; cursor: pointer;">
          </div>
          <div id="expiry-date-container" style="display: none; margin-top: 0.25rem;">
            <input type="date" id="input-sheet-expiry" class="form-input" style="width: 100%; height: 40px; background: var(--color-surface); color: var(--color-text-main); font-weight: 600;">
            <small style="color: var(--color-text-muted); font-size: 0.725rem; margin-top: 0.25rem; display: block;">
              Indica la fecha de expiración física impresa en la caja o envase.
            </small>
          </div>
        </div>

        <!-- CAMPOS COMPLEMENTARIOS (LOTE & UBICACIÓN OPCIONAL) -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">
              Lote (Opcional)
            </label>
            <input type="text" id="input-sheet-lot" class="form-input" placeholder="Ej: L-2026A" style="width: 100%; height: 36px; font-size: 0.8rem; background: var(--color-bg);">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">
              Ubicación / Rack
            </label>
            <input type="text" id="input-sheet-location" class="form-input" placeholder="Ej: Pasillo 3" style="width: 100%; height: 36px; font-size: 0.8rem; background: var(--color-bg);">
          </div>
        </div>

        <!-- Observaciones / Estado -->
        <div>
          <input type="text" id="input-sheet-notes" class="form-input" placeholder="Observaciones opcionales (ej: caja abierta, dañado...)" style="width: 100%; height: 36px; font-size: 0.8rem; background: var(--color-bg);">
        </div>

        <!-- BOTÓN DE CONFIRMACIÓN -->
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button type="button" id="btn-sheet-cancel" class="btn btn-outline" style="flex: 1; height: 46px; font-weight: 600;">
            Cancelar
          </button>
          <button type="button" id="btn-sheet-save" class="btn btn-primary" style="flex: 2; height: 46px; font-weight: 700; background: #10b981; border-color: #10b981; font-size: 0.95rem; display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <i class="ri-check-line" style="font-size: 1.2rem;"></i> Confirmar e Inventariar
          </button>
        </div>

      </div>
    </div>
  `;

  // Inicializar listeners de tabs y sesiones
  initTabNavigation();
  initGlobalHeaderActions();

  // Cargar metadatos (bodegas, comercios) y sesiones activas
  await loadMetadataAndSessions();
}

// ==========================================
// NAVEGACIÓN POR PESTAÑAS (ESCANER / CUADRATURA / LOGS)
// ==========================================
function initTabNavigation() {
  const tabBtns = document.querySelectorAll('.inv-count-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      tabBtns.forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      const tabName = target.getAttribute('data-tab');

      if (tabName === 'scanner') {
        renderScannerView();
      } else {
        // Pausar o apagar cámara al salir de la pestaña del escáner para ahorrar batería
        await stopScannerSafe();
        if (tabName === 'live_recon') {
          renderLiveReconView();
        } else if (tabName === 'scan_logs') {
          renderScanLogsView();
        }
      }
    });
  });
}

// ==========================================
// VISTA 1: ESCÁNER CON CÁMARA (MOBILE-OPTIMIZED)
// ==========================================
function renderScannerView() {
  const container = document.getElementById('inv-tab-content-area');
  if (!container) return;

  if (!activeCountSession) {
    container.innerHTML = `
      <div style="background: var(--color-surface); border: 1.5px dashed var(--color-border); border-radius: var(--radius-lg); padding: 3rem 1.5rem; text-align: center; max-width: 500px; margin: 2rem auto;">
        <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(99, 102, 241, 0.12); color: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 1rem auto;">
          <i class="ri-folder-open-line"></i>
        </div>
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; color: var(--color-text-main);">No hay sesión de conteo activa</h3>
        <p style="color: var(--color-text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">
          Para comenzar a pistolear con el teléfono, selecciona una sesión existente o crea una nueva auditoría de inventario.
        </p>
        <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
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

  container.innerHTML = `
    <div class="inv-scanner-section">
      
      <!-- COLUMNA IZQUIERDA: CÁMARA Y ESCÁNER -->
      <div class="inv-scanner-card">
        
        <!-- VISOR DE CÁMARA -->
        <div class="inv-camera-container" id="inv-camera-frame">
          <div id="inv-qr-reader"></div>

          <!-- Flash visual de éxito -->
          <div id="inv-cam-flash" class="inv-camera-flash-success"></div>

          <!-- Retícula animada de apuntado -->
          <div class="inv-scanner-reticle-overlay">
            <div class="inv-reticle-box">
              <div class="inv-reticle-corner top-left"></div>
              <div class="inv-reticle-corner top-right"></div>
              <div class="inv-reticle-corner bottom-left"></div>
              <div class="inv-reticle-corner bottom-right"></div>
              <div class="inv-reticle-laser"></div>
            </div>
            <span style="color: rgba(255, 255, 255, 0.85); font-size: 0.75rem; font-weight: 600; margin-top: 10px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); background: rgba(0,0,0,0.5); padding: 2px 8px; border-radius: 4px;">
              Apunta al Código de Barras o QR
            </span>
          </div>

          <!-- Controles de Cámara Flotantes -->
          <div class="inv-camera-toolbar">
            <button type="button" class="inv-cam-action-btn" id="btn-toggle-camera-play" title="Pausar / Iniciar Cámara">
              <i class="ri-video-line" id="icon-camera-play"></i>
            </button>
            <button type="button" class="inv-cam-action-btn" id="btn-toggle-torch" title="Encender / Apagar Linterna">
              <i class="ri-flashlight-line"></i>
            </button>
            <button type="button" class="inv-cam-action-btn" id="btn-switch-camera" title="Cambiar Cámara Trasera / Frontal">
              <i class="ri-camera-switch-line"></i>
            </button>
          </div>
        </div>

        <!-- MODO RÁFAGA / CONTINUO -->
        <div class="inv-switch-bar">
          <div>
            <strong style="color: var(--color-text-main); font-size: 0.85rem; display: flex; align-items: center; gap: 0.35rem;">
              <i class="ri-flashlight-fill" style="color: #f59e0b;"></i> Modo Ráfaga (Conteo Rápido)
            </strong>
            <span style="font-size: 0.72rem; color: var(--color-text-muted); display: block;">
              Suma +1 automáticamente por cada lectura sin abrir confirmación.
            </span>
          </div>
          <label class="inv-mode-toggle">
            <input type="checkbox" id="chk-fast-mode" ${isFastMode ? 'checked' : ''}>
            <span class="inv-mode-slider"></span>
          </label>
        </div>

        <!-- CRITERIO DE ASOCIACIÓN / BÚSQUEDA DEL CATÁLOGO -->
        <div class="inv-match-criteria-card" style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.65rem 0.85rem; margin-bottom: 0.85rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
            <label for="select-match-mode" style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem; margin: 0;">
              <i class="ri-search-eye-line" style="color: var(--color-primary);"></i> Criterio de Búsqueda:
            </label>
            <span id="lbl-match-mode-desc" style="font-size: 0.7rem; color: var(--color-primary); font-weight: 700; background: rgba(99, 102, 241, 0.08); padding: 2px 7px; border-radius: 4px;">
              ${getMatchModeBadgeText(currentMatchMode)}
            </span>
          </div>
          <select id="select-match-mode" class="form-input" style="width: 100%; height: 38px; font-size: 0.825rem; font-weight: 600; background: var(--color-bg); cursor: pointer; border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
            <option value="all" ${currentMatchMode === 'all' ? 'selected' : ''}>🔍 Coincidencia Total (Cualquiera: Barras, WMS o SKU)</option>
            <option value="barcode" ${currentMatchMode === 'barcode' ? 'selected' : ''}>🏷️ Solo Códigos de Barras (Origen o WMS)</option>
            <option value="barcode_origin" ${currentMatchMode === 'barcode_origin' ? 'selected' : ''}>🏭 Solo Código de Fabricante / EAN (Origen)</option>
            <option value="barcode_wms" ${currentMatchMode === 'barcode_wms' ? 'selected' : ''}>📦 Solo Código de Barras WMS</option>
            <option value="sku" ${currentMatchMode === 'sku' ? 'selected' : ''}>🆔 Solo Código SKU / Alias</option>
            <option value="name" ${currentMatchMode === 'name' ? 'selected' : ''}>📝 Solo por Nombre / Descripción del Producto</option>
          </select>
          <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.35rem; line-height: 1.25;" id="lbl-match-mode-hint">
            ${getMatchModeHint(currentMatchMode)}
          </div>
        </div>

        <!-- ENTRADA MANUAL O PISTOLA LÁSER CON SELECTOR DE TECLADO -->
        <div style="margin-top: 0.5rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
            <label style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-muted); margin: 0; display: flex; align-items: center; gap: 0.3rem;">
              <i class="ri-keyboard-line" style="color: var(--color-primary);"></i> Ingreso Manual / Pistola
            </label>
            <div class="inv-keyboard-mode-pills">
              <button type="button" class="inv-kb-btn ${keyboardMode === 'numeric' ? 'active' : ''}" id="btn-kb-mode-numeric" title="Teclado numérico grande para códigos de barra">
                <i class="ri-calculator-line"></i> 123 Numérico
              </button>
              <button type="button" class="inv-kb-btn ${keyboardMode === 'alpha' ? 'active' : ''}" id="btn-kb-mode-alpha" title="Teclado alfanumérico para SKUs o Nombres">
                <i class="ri-text"></i> ABC Texto
              </button>
            </div>
          </div>

          <div class="inv-manual-input-box">
            <input type="${keyboardMode === 'numeric' ? 'tel' : 'text'}" 
                   id="input-manual-barcode" 
                   class="inv-manual-input" 
                   inputmode="${keyboardMode === 'numeric' ? 'numeric' : 'text'}"
                   ${keyboardMode === 'numeric' ? 'pattern="[0-9]*"' : ''}
                   placeholder="${keyboardMode === 'numeric' ? 'Digitar números de código de barras...' : 'Escribir SKU, código o nombre de producto...'}" 
                   autocomplete="off">
            <button type="button" id="btn-manual-search" class="btn btn-primary" style="height: 44px; padding: 0 1.25rem;" title="Buscar en catálogo">
              <i class="ri-search-2-line"></i>
            </button>
          </div>

          <!-- TECLADO NUMÉRICO TÁCTIL GRANDE EN PANTALLA -->
          <div id="inv-virtual-numpad" class="inv-numpad-container" style="${keyboardMode === 'numeric' && isNumpadExpanded ? 'display: block;' : 'display: none;'}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem;">
              <span style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px;">
                <i class="ri-grid-fill" style="color: var(--color-primary);"></i> Teclado Numérico Rápido
              </span>
              <button type="button" id="btn-toggle-numpad-collapse" style="background: none; border: none; font-size: 0.72rem; color: var(--color-primary); cursor: pointer; font-weight: 600; padding: 2px;">
                <span id="lbl-numpad-collapse-text">Ocultar teclado</span>
              </button>
            </div>
            <div id="inv-numpad-keys-area">
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
                <button type="button" class="inv-num-key key-clear" id="btn-numpad-clear" title="Borrar todo">C</button>
                <button type="button" class="inv-num-key btn-numpad-digit" data-key="0">0</button>
                <button type="button" class="inv-num-key key-backspace" id="btn-numpad-backspace" title="Borrar último dígito">
                  <i class="ri-delete-back-2-line"></i>
                </button>
                <button type="button" class="inv-num-key-search" id="btn-numpad-search-action">
                  <i class="ri-search-2-line"></i> BUSCAR Y ASOCIAR
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ÚLTIMO PRODUCTO ESCANEADO EN ESTE DISPOSITIVO -->
        <div id="inv-last-scanned-container" style="display: none;">
          <!-- Inyectado dinámicamente -->
        </div>

      </div>

      <!-- COLUMNA DERECHA: ACTIVIDAD EN VIVO COLABORATIVA -->
      <div class="inv-live-feed-card">
        <div class="inv-live-feed-header">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-broadcast-line" style="color: #10b981; font-size: 1.15rem;"></i>
            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text-main);">
              Actividad en Vivo (Todos los Teléfonos)
            </h4>
          </div>
          <span id="lbl-active-operators-badge" style="font-size: 0.75rem; background: var(--color-bg); padding: 0.2rem 0.55rem; border-radius: 99px; border: 1px solid var(--color-border); font-weight: 600; color: var(--color-text-muted);">
            1 dispositivo conectado
          </span>
        </div>

        <div id="inv-live-feed-list" class="inv-feed-list">
          <div style="text-align: center; padding: 2rem; color: var(--color-text-muted); font-size: 0.825rem;">
            Esperando lecturas de la cuadrilla...
          </div>
        </div>
      </div>

    </div>
  `;

  // Iniciar eventos del escáner
  initScannerControls();
  renderLiveFeedList();

  // Iniciar la cámara si está soportada
  startCameraScanner();
}

function getMatchModeBadgeText(mode) {
  switch (mode) {
    case 'barcode': return 'Barras (Origen o WMS)';
    case 'barcode_origin': return 'Fabricante (EAN)';
    case 'barcode_wms': return 'Etiqueta WMS';
    case 'sku': return 'Estricto SKU';
    case 'name': return 'Por Nombre / Título';
    default: return 'Cualquiera (Automático)';
  }
}

function getMatchModeHint(mode) {
  switch (mode) {
    case 'barcode':
      return 'Busca coincidencias en códigos de barra de fábrica (EAN/UPC) o generados por STOCKA WMS.';
    case 'barcode_origin':
      return 'Filtra únicamente por el código de barras impreso por el fabricante (EAN/UPC original).';
    case 'barcode_wms':
      return 'Filtra únicamente por el código de barras interno asignado en el sistema WMS.';
    case 'sku':
      return 'Filtra estrictamente por el SKU del comercio o sus códigos alternativos (alias).';
    case 'name':
      return 'Busca productos por palabras o texto en su nombre/descripción y permite seleccionarlos de una lista.';
    default:
      return 'Verifica si la lectura coincide con código de barras de origen, WMS, SKU, alias o nombre del producto.';
  }
}

// Iniciar Controles del Escáner y Búsqueda Manual
function initScannerControls() {
  const chkFast = document.getElementById('chk-fast-mode');
  if (chkFast) {
    chkFast.addEventListener('change', (e) => {
      isFastMode = e.target.checked;
      localStorage.setItem('stocka_inv_fast_mode', isFastMode ? 'true' : 'false');
    });
  }

  const selectMatch = document.getElementById('select-match-mode');
  if (selectMatch) {
    selectMatch.addEventListener('change', (e) => {
      currentMatchMode = e.target.value;
      localStorage.setItem('stocka_inv_match_mode', currentMatchMode);

      const descBadge = document.getElementById('lbl-match-mode-desc');
      if (descBadge) descBadge.textContent = getMatchModeBadgeText(currentMatchMode);

      const hintText = document.getElementById('lbl-match-mode-hint');
      if (hintText) hintText.textContent = getMatchModeHint(currentMatchMode);
    });
  }

  const manualInput = document.getElementById('input-manual-barcode');
  const manualBtn = document.getElementById('btn-manual-search');

  // Control de modo de teclado (Numérico vs Alfanumérico)
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
        manualInput.placeholder = 'Digitar números de código de barras...';
        if (virtualNumpad) virtualNumpad.style.display = isNumpadExpanded ? 'block' : 'none';
      } else {
        manualInput.type = 'text';
        manualInput.setAttribute('inputmode', 'text');
        manualInput.removeAttribute('pattern');
        manualInput.placeholder = 'Escribir SKU, código o nombre de producto...';
        if (virtualNumpad) virtualNumpad.style.display = 'none';
      }
    }
  };

  btnKbNumeric?.addEventListener('click', () => setKeyboardMode('numeric'));
  btnKbAlpha?.addEventListener('click', () => setKeyboardMode('alpha'));

  // Toggle colapsar / expandir teclado numérico
  const btnToggleCollapse = document.getElementById('btn-toggle-numpad-collapse');
  const numpadKeysArea = document.getElementById('inv-numpad-keys-area');
  const lblCollapse = document.getElementById('lbl-numpad-collapse-text');

  btnToggleCollapse?.addEventListener('click', () => {
    isNumpadExpanded = !isNumpadExpanded;
    localStorage.setItem('stocka_inv_numpad_expanded', isNumpadExpanded ? 'true' : 'false');
    if (numpadKeysArea) numpadKeysArea.style.display = isNumpadExpanded ? 'block' : 'none';
    if (lblCollapse) lblCollapse.textContent = isNumpadExpanded ? 'Ocultar teclado' : 'Mostrar teclado';
  });

  // Botones de dígitos del teclado numérico
  document.querySelectorAll('.btn-numpad-digit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const digit = e.currentTarget.getAttribute('data-key');
      if (digit !== null && manualInput) {
        playBeepSound('tap');
        triggerHaptic('tap');
        manualInput.value += digit;
      }
    });
  });

  document.getElementById('btn-numpad-clear')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (manualInput) {
      playBeepSound('tap');
      triggerHaptic('tap');
      manualInput.value = '';
    }
  });

  document.getElementById('btn-numpad-backspace')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (manualInput) {
      playBeepSound('tap');
      triggerHaptic('tap');
      manualInput.value = manualInput.value.slice(0, -1);
    }
  });

  const handleManualSearch = () => {
    const val = manualInput?.value.trim();
    if (!val) return;
    onBarcodeScanned(val);
    manualInput.value = '';
  };

  document.getElementById('btn-numpad-search-action')?.addEventListener('click', (e) => {
    e.preventDefault();
    handleManualSearch();
  });

  manualBtn?.addEventListener('click', handleManualSearch);
  manualInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualSearch();
    }
  });

  // Botón linterna
  document.getElementById('btn-toggle-torch')?.addEventListener('click', toggleTorchSafe);

  // Botón cambio de cámara
  document.getElementById('btn-switch-camera')?.addEventListener('click', switchCameraFacingSafe);

  // Botón pausa/play
  document.getElementById('btn-toggle-camera-play')?.addEventListener('click', toggleCameraPlayPause);
}

// ==========================================
// CONTROLADOR DE CÁMARA CON HTML5-QRCODE
// ==========================================
async function startCameraScanner() {
  const qrReaderDiv = document.getElementById('inv-qr-reader');
  if (!qrReaderDiv) return;

  if (typeof Html5Qrcode === 'undefined') {
    console.warn('Librería Html5Qrcode no encontrada.');
    return;
  }

  try {
    if (html5QrCodeScanner) {
      await stopScannerSafe();
    }

    html5QrCodeScanner = new Html5Qrcode("inv-qr-reader", {
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
      fps: 15,
      qrbox: { width: 280, height: 180 },
      aspectRatio: 1.333334,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    };

    await html5QrCodeScanner.start(
      { facingMode: currentCameraFacing },
      qrConfig,
      onCameraScanSuccess,
      onCameraScanFailure
    );

    isScannerRunning = true;
    updateCameraPlayIcon(true);

  } catch (err) {
    console.warn('Error al iniciar cámara con html5-qrcode:', err);
    isScannerRunning = false;
    updateCameraPlayIcon(false);
  }
}

async function stopScannerSafe() {
  if (html5QrCodeScanner && isScannerRunning) {
    try {
      await html5QrCodeScanner.stop();
    } catch (e) {}
    isScannerRunning = false;
    isTorchOn = false;
  }
}

async function toggleTorchSafe() {
  if (!html5QrCodeScanner || !isScannerRunning) return;
  try {
    isTorchOn = !isTorchOn;
    await html5QrCodeScanner.applyVideoConstraints({
      advanced: [{ torch: isTorchOn }]
    });
    const btn = document.getElementById('btn-toggle-torch');
    if (btn) {
      btn.classList.toggle('active-torch', isTorchOn);
    }
  } catch (e) {
    console.warn('Linterna no soportada en este hardware/navegador:', e);
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
  if (icon) {
    icon.className = running ? 'ri-pause-line' : 'ri-play-line';
  }
}

// Callback al detectar un código por cámara
function onCameraScanSuccess(decodedText) {
  if (isScanProcessing) return;
  if (!decodedText || !decodedText.trim()) return;

  onBarcodeScanned(decodedText.trim());
}

function onCameraScanFailure(error) {
  // Ignorar errores de frames continuos sin código
}

// Modal para seleccionar productos cuando hay múltiples coincidencias por nombre
function openProductPickerModal(query, productsList, onSelectCallback) {
  let modal = document.getElementById('modal-inv-product-picker');
  if (modal) modal.remove();

  modal = document.createElement('div');
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
        <div style="flex: 1; overflow: hidden; padding-right: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.25rem; flex-wrap: wrap;">
            <span style="font-family: monospace; font-weight: 700; font-size: 0.8rem; color: var(--color-primary); background: rgba(99, 102, 241, 0.08); padding: 2px 6px; border-radius: 4px;">
              ${sku}
            </span>
            <span style="font-size: 0.72rem; color: var(--color-text-muted);">
              <i class="ri-barcode-line"></i> ${barcode}
            </span>
          </div>
          <div style="font-weight: 600; font-size: 0.85rem; color: var(--color-text-main); line-height: 1.35;">
            ${name}
          </div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.25rem;">
            Comercio: <strong>${comercio}</strong>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-picker-select" data-prod-id="${prodId}" style="height: 38px; padding: 0 0.95rem; font-size: 0.8rem; font-weight: 700; background: #10b981; border-color: #10b981; flex-shrink: 0; display: flex; align-items: center; gap: 0.3rem;">
          <i class="ri-check-line"></i> Elegir
        </button>
      </div>
    `;
  }).join('');

  modal.innerHTML = `
    <div class="inv-picker-modal-content">
      <div class="inv-picker-modal-header">
        <div>
          <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
            <i class="ri-search-line" style="color: var(--color-primary);"></i> Productos encontrados (${productsList.length})
          </h4>
          <span style="font-size: 0.72rem; color: var(--color-text-muted);">
            Resultados para: "<strong>${escapeHtml(query)}</strong>"
          </span>
        </div>
        <button type="button" id="btn-close-product-picker" style="background: transparent; border: none; font-size: 1.4rem; color: var(--color-text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center;">
          <i class="ri-close-line"></i>
        </button>
      </div>
      <div class="inv-picker-modal-body">
        ${rowsHtml}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    isScanProcessing = false;
  };

  document.getElementById('btn-close-product-picker')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  modal.querySelectorAll('.btn-picker-select, .inv-picker-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const prodId = el.getAttribute('data-prod-id');
      const chosen = productsList.find(p => String(p.id || p.sku) === prodId);
      if (chosen) {
        modal.remove();
        if (typeof onSelectCallback === 'function') {
          onSelectCallback(chosen);
        }
      }
    });
  });
}

// Búsqueda de productos por texto en el nombre
async function searchProductsByNameList(term) {
  const cleanTerm = String(term || '').trim();
  if (!cleanTerm) return [];
  const termUpper = cleanTerm.toUpperCase();

  // 1. Filtrar en caché de la sesión
  const localMatches = sessionCatalogCache.filter(p => {
    return String(p.name || '').toUpperCase().includes(termUpper);
  });

  // 2. Consultar en Supabase
  let remoteMatches = [];
  try {
    let query = supabase.from('products').select('*');
    if (activeCountSession && activeCountSession.comercio && activeCountSession.comercio !== 'Todos') {
      query = query.eq('comercio', activeCountSession.comercio);
    }
    query = query.ilike('name', `%${cleanTerm}%`).limit(30);
    const { data, error } = await query;
    if (!error && data) {
      remoteMatches = data;
    }
  } catch (err) {
    console.warn('Error buscando productos por nombre en Supabase:', err);
  }

  // Deduplicar resultados por ID o SKU
  const combinedMap = new Map();
  localMatches.forEach(p => combinedMap.set(p.id || p.sku, p));
  remoteMatches.forEach(p => {
    if (!combinedMap.has(p.id || p.sku)) {
      combinedMap.set(p.id || p.sku, p);
      sessionCatalogCache.push(p);
    }
  });

  return Array.from(combinedMap.values());
}

// ==========================================
// PROCESAMIENTO DEL CÓDIGO ESCANEADO
// ==========================================
async function onBarcodeScanned(rawCode) {
  if (!rawCode || isScanProcessing) return;
  isScanProcessing = true;

  // Efecto visual de flash y sonido
  triggerScanFeedback();

  try {
    // 1. Buscar en catálogo de productos
    const product = await findProductInDatabase(rawCode);

    // Múltiples coincidencias (búsqueda por nombre o ambigua)
    if (product && product.is_multiple_matches && product.matches) {
      openProductPickerModal(rawCode, product.matches, async (chosenProd) => {
        const finalProd = { ...chosenProd, _matchedBy: 'Nombre de Producto' };
        if (isFastMode) {
          triggerScanFeedback();
          await saveCountItemDirectly({
            product: finalProd,
            quantity: 1,
            expiryDate: null,
            lotNumber: '',
            location: '',
            notes: ''
          });
          showLastScannedCard(finalProd, 1);
          setTimeout(() => { isScanProcessing = false; }, 400);
        } else {
          openConfirmationSheet(finalProd.sku || finalProd.barcode || rawCode, finalProd);
        }
      });
      return;
    }

    // 2. Si estamos en modo ráfaga, guardar inmediatamente +1
    if (isFastMode && product) {
      await saveCountItemDirectly({
        product: product,
        quantity: 1,
        expiryDate: null,
        lotNumber: '',
        location: '',
        notes: ''
      });
      showLastScannedCard(product, 1);
      setTimeout(() => { isScanProcessing = false; }, 400);
      return;
    }

    // 3. Abrir Modal / Sheet de confirmación
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

  const flash = document.getElementById('inv-cam-flash');
  if (flash) {
    flash.classList.add('flash-now');
    setTimeout(() => { flash.classList.remove('flash-now'); }, 140);
  }
}

// Buscar producto por código de barra, SKU o alias según el criterio configurado
async function findProductInDatabase(code) {
  const cleanCode = String(code).trim();
  const cleanUpper = cleanCode.toUpperCase();
  const mode = currentMatchMode || 'all';

  // Si el modo es buscar por nombre de producto
  if (mode === 'name') {
    const nameMatches = await searchProductsByNameList(cleanCode);
    if (nameMatches.length === 1) {
      const single = { ...nameMatches[0], _matchedBy: 'Nombre de Producto' };
      sessionCatalogCache.push(single);
      return single;
    } else if (nameMatches.length > 1) {
      return { is_multiple_matches: true, matches: nameMatches };
    }
    return {
      id: null,
      sku: cleanCode,
      barcode: cleanCode,
      name: `"${cleanCode}" (No encontrado por nombre)`,
      comercio: activeCountSession?.comercio || 'no asignado',
      is_unknown: true,
      _matchedBy: 'Sin coincidencia'
    };
  }

  const checkMatch = (p) => {
    const bcOrigin = String(p.barcode || '').trim().toUpperCase();
    const bcAlt = String(p.codigo_barra || '').trim().toUpperCase();
    const bcWms = String(p.barcode_wms || '').trim().toUpperCase();
    const sku = String(p.sku || '').trim().toUpperCase();
    const alias = String(p.alias || '').trim().toUpperCase();

    if (mode === 'sku') {
      if (sku && sku === cleanUpper) return { match: true, by: 'SKU' };
      if (alias && alias === cleanUpper) return { match: true, by: 'Alias SKU' };
      return { match: false };
    }

    if (mode === 'barcode') {
      if (bcOrigin && bcOrigin === cleanUpper) return { match: true, by: 'Código Barras (Origen)' };
      if (bcAlt && bcAlt === cleanUpper) return { match: true, by: 'Código Barras (Alternativo)' };
      if (bcWms && bcWms === cleanUpper) return { match: true, by: 'Código WMS' };
      return { match: false };
    }

    if (mode === 'barcode_origin') {
      if (bcOrigin && bcOrigin === cleanUpper) return { match: true, by: 'Código Barras (Origen)' };
      if (bcAlt && bcAlt === cleanUpper) return { match: true, by: 'Código Barras (Alternativo)' };
      return { match: false };
    }

    if (mode === 'barcode_wms') {
      if (bcWms && bcWms === cleanUpper) return { match: true, by: 'Código WMS' };
      return { match: false };
    }

    // Modo 'all' (Cualquiera de los datos)
    if (bcOrigin && bcOrigin === cleanUpper) return { match: true, by: 'Código Barras (Origen)' };
    if (bcAlt && bcAlt === cleanUpper) return { match: true, by: 'Código Barras (Alternativo)' };
    if (bcWms && bcWms === cleanUpper) return { match: true, by: 'Código WMS' };
    if (sku && sku === cleanUpper) return { match: true, by: 'SKU' };
    if (alias && alias === cleanUpper) return { match: true, by: 'Alias SKU' };
    return { match: false };
  };

  // 1. Buscar en memoria local de la sesión
  for (const p of sessionCatalogCache) {
    const res = checkMatch(p);
    if (res.match) {
      return { ...p, _matchedBy: res.by };
    }
  }

  // 2. Si no está en memoria, consultar a Supabase
  try {
    let query = supabase.from('products').select('*');

    // Si la sesión está restringida a un comercio específico
    if (activeCountSession && activeCountSession.comercio && activeCountSession.comercio !== 'Todos') {
      query = query.eq('comercio', activeCountSession.comercio);
    }

    if (mode === 'sku') {
      query = query.or(`sku.ilike.${cleanCode},alias.ilike.${cleanCode}`);
    } else if (mode === 'barcode') {
      query = query.or(`barcode.eq.${cleanCode},codigo_barra.eq.${cleanCode},barcode_wms.eq.${cleanCode}`);
    } else if (mode === 'barcode_origin') {
      query = query.or(`barcode.eq.${cleanCode},codigo_barra.eq.${cleanCode}`);
    } else if (mode === 'barcode_wms') {
      query = query.eq('barcode_wms', cleanCode);
    } else {
      query = query.or(`barcode.eq.${cleanCode},codigo_barra.eq.${cleanCode},barcode_wms.eq.${cleanCode},sku.ilike.${cleanCode},alias.ilike.${cleanCode}`);
    }

    const { data, error } = await query.limit(5);

    if (!error && data && data.length > 0) {
      for (const prod of data) {
        const res = checkMatch(prod);
        if (res.match) {
          const finalProd = { ...prod, _matchedBy: res.by };
          sessionCatalogCache.push(prod);
          return finalProd;
        }
      }
      const fallbackProd = { ...data[0], _matchedBy: mode === 'sku' ? 'SKU' : 'Código' };
      sessionCatalogCache.push(data[0]);
      return fallbackProd;
    }
  } catch (e) {
    console.warn('Error consultando producto en Supabase:', e);
  }

  // 3. Fallback en modo 'all': si no coincide por código de barras o SKU, buscar por nombre
  if (mode === 'all' && cleanCode.length >= 2) {
    const nameMatches = await searchProductsByNameList(cleanCode);
    if (nameMatches.length === 1) {
      const single = { ...nameMatches[0], _matchedBy: 'Nombre de Producto' };
      sessionCatalogCache.push(single);
      return single;
    } else if (nameMatches.length > 1) {
      return { is_multiple_matches: true, matches: nameMatches };
    }
  }

  // Retornar objeto sintético si no se encontró en el catálogo
  return {
    id: null,
    sku: cleanCode,
    barcode: cleanCode,
    name: 'Producto No Encontrado en Catálogo',
    comercio: activeCountSession?.comercio || 'no asignado',
    is_unknown: true,
    _matchedBy: 'Sin coincidencia'
  };
}

// ==========================================
// MODAL / BOTTOM SHEET DE CONFIRMACIÓN
// ==========================================
function openConfirmationSheet(rawCode, product) {
  const sheet = document.getElementById('inv-confirm-sheet');
  if (!sheet) {
    isScanProcessing = false;
    return;
  }

  // Pre-llenar datos del producto
  const isUnknown = product.is_unknown || !product.id;
  const matchInfo = product._matchedBy && product._matchedBy !== 'Sin coincidencia'
    ? ` • Coincidencia por: <span style="color: #10b981; font-weight: 700;">${product._matchedBy}</span>`
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

  // Calcular stock teórico del producto
  const sysStockEl = document.getElementById('sheet-prod-system-stock');
  sysStockEl.textContent = 'Calculando...';
  fetchTheoreticalStock(product.id).then(stock => {
    sysStockEl.textContent = `${stock} un.`;
  });

  // Mostrar sheet
  sheet.classList.add('active');

  // Controladores de incremento rápido
  const setupSheetEvents = () => {
    document.getElementById('btn-qty-plus').onclick = () => { qtyInput.value = Math.max(1, (parseInt(qtyInput.value) || 0) + 1); };
    document.getElementById('btn-qty-minus').onclick = () => { qtyInput.value = Math.max(1, (parseInt(qtyInput.value) || 2) - 1); };
    document.getElementById('btn-qty-reset').onclick = () => { qtyInput.value = 1; };

    sheet.querySelectorAll('.inv-quick-chip[data-add]').forEach(chip => {
      chip.onclick = () => {
        const add = parseInt(chip.getAttribute('data-add')) || 1;
        qtyInput.value = (parseInt(qtyInput.value) || 0) + add;
      };
    });

    expiryCheck.onchange = () => {
      expiryContainer.style.display = expiryCheck.checked ? 'block' : 'none';
      if (expiryCheck.checked && !expiryInput.value) {
        // Sugerir 1 año en el futuro
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        expiryInput.value = nextYear.toISOString().split('T')[0];
      }
    };

    const closeSheet = () => {
      sheet.classList.remove('active');
      isScanProcessing = false;
    };

    document.getElementById('btn-sheet-close').onclick = closeSheet;
    document.getElementById('btn-sheet-cancel').onclick = closeSheet;

    // Guardar lectura
    document.getElementById('btn-sheet-save').onclick = async () => {
      const finalQty = Math.max(1, parseInt(qtyInput.value) || 1);
      const finalExpiry = expiryCheck.checked && expiryInput.value ? expiryInput.value : null;
      const finalLot = lotInput.value.trim();
      const finalLoc = locInput.value.trim();
      const finalNotes = notesInput.value.trim();

      const btnSave = document.getElementById('btn-sheet-save');
      btnSave.disabled = true;
      btnSave.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

      try {
        await saveCountItemDirectly({
          product,
          quantity: finalQty,
          expiryDate: finalExpiry,
          lotNumber: finalLot,
          location: finalLoc,
          notes: finalNotes
        });

        showLastScannedCard(product, finalQty);
        closeSheet();
      } catch (err) {
        alert('Error al guardar lectura: ' + err.message);
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = '<i class="ri-check-line"></i> Confirmar e Inventariar';
      }
    };
  };

  setupSheetEvents();
}

async function fetchTheoreticalStock(productId) {
  if (!productId || !activeCountSession) return 0;
  try {
    let query = supabase.from('inventory').select('quantity').eq('product_id', productId);
    if (activeCountSession.warehouse_id) {
      query = query.eq('warehouse_id', activeCountSession.warehouse_id);
    }
    const { data, error } = await query;
    if (!error && data) {
      return data.reduce((acc, row) => acc + (row.quantity || 0), 0);
    }
  } catch (e) {}
  return 0;
}

// Guardar lectura en Supabase
async function saveCountItemDirectly({ product, quantity, expiryDate, lotNumber, location, notes }) {
  if (!activeCountSession) throw new Error('No hay sesión activa.');

  const itemPayload = {
    session_id: activeCountSession.id,
    product_id: product.id || null,
    sku: product.sku || 'SIN-SKU',
    barcode: product.barcode || product.codigo_barra || product.sku || '',
    product_name: product.name || 'Sin nombre',
    comercio: product.comercio || activeCountSession.comercio || 'no asignado',
    warehouse_name: activeCountSession.warehouse_name || 'Principal',
    quantity: quantity,
    expiry_date: expiryDate || null,
    lot_number: lotNumber || null,
    location: location || null,
    operator_name: localOperatorName || 'Admin Móvil',
    device_id: localDeviceId,
    device_info: navigator.userAgent.substring(0, 100),
    notes: notes || null
  };

  const { data, error } = await supabase
    .from('inventory_count_items')
    .insert([itemPayload])
    .select();

  if (error) {
    console.error('Error insertando lectura en Supabase:', error);
    throw error;
  }

  const inserted = (data && data[0]) ? data[0] : itemPayload;

  // Actualizar caché local inmediatamente (optimistic UI)
  sessionItemsCache.unshift(inserted);
  updateSessionStatsFromCache();
  renderLiveFeedList();
}

// Mostrar tarjeta con el último ítem escaneado
function showLastScannedCard(product, qty) {
  const container = document.getElementById('inv-last-scanned-container');
  if (!container) return;

  const matchBadge = product._matchedBy && product._matchedBy !== 'Sin coincidencia'
    ? `<span style="font-size: 0.68rem; background: rgba(99, 102, 241, 0.12); color: #6366f1; padding: 1px 6px; border-radius: 4px; font-weight: 600; margin-left: 0.35rem;">Por ${escapeHtml(product._matchedBy)}</span>`
    : '';

  container.style.display = 'block';
  container.innerHTML = `
    <div class="inv-last-scanned-card">
      <div class="inv-prod-thumb" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
        <i class="ri-check-line"></i>
      </div>
      <div style="flex: 1; overflow: hidden;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; overflow: hidden;">
            <span style="font-family: monospace; font-weight: 700; font-size: 0.8rem; color: var(--color-primary);">${escapeHtml(product.sku)}</span>
            ${matchBadge}
          </div>
          <span style="font-weight: 800; color: #10b981; font-size: 0.95rem;">+${qty} un.</span>
        </div>
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(product.name)}
        </div>
        <div style="font-size: 0.72rem; color: var(--color-text-muted);">
          Registrado por <strong>${escapeHtml(localOperatorName)}</strong> hace un momento
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// VISTA 2: CUADRATURA EN VIVO (RESULTADOS)
// ==========================================
function renderLiveReconView() {
  const container = document.getElementById('inv-tab-content-area');
  if (!container) return;

  if (!activeCountSession) {
    container.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--color-text-muted);">No hay sesión activa.</div>`;
    return;
  }

  // Agrupar lecturas por SKU
  const skuMap = new Map();
  sessionItemsCache.forEach(item => {
    const skuKey = String(item.sku).toUpperCase().trim();
    if (!skuMap.has(skuKey)) {
      skuMap.set(skuKey, {
        sku: item.sku,
        name: item.product_name,
        barcode: item.barcode,
        comercio: item.comercio,
        totalCounted: 0,
        systemStock: 0,
        expiryDates: new Set(),
        lots: new Set(),
        operators: new Set(),
        readingsCount: 0
      });
    }
    const record = skuMap.get(skuKey);
    record.totalCounted += (item.quantity || 0);
    record.readingsCount += 1;
    if (item.expiry_date) record.expiryDates.add(item.expiry_date);
    if (item.lot_number) record.lots.add(item.lot_number);
    if (item.operator_name) record.operators.add(item.operator_name);
  });

  const skuList = Array.from(skuMap.values()).sort((a, b) => b.totalCounted - a.totalCounted);

  const rowsHtml = skuList.map((item, idx) => {
    const diff = item.totalCounted - item.systemStock;
    let diffBadge = '';
    if (diff === 0) {
      diffBadge = '<span class="inv-diff-badge matched"><i class="ri-check-line"></i> Cuadrado (0)</span>';
    } else if (diff > 0) {
      diffBadge = `<span class="inv-diff-badge surplus"><i class="ri-arrow-up-line"></i> +${diff} Sobrante</span>`;
    } else {
      diffBadge = `<span class="inv-diff-badge deficit"><i class="ri-arrow-down-line"></i> ${diff} Faltante</span>`;
    }

    const expiryStr = item.expiryDates.size > 0 ? Array.from(item.expiryDates).join(', ') : '<span style="color: var(--color-text-muted); font-style: italic;">Sin vencimiento</span>';
    const opsStr = Array.from(item.operators).join(', ');

    return `
      <tr>
        <td style="text-align: center; color: var(--color-text-muted);">${idx + 1}</td>
        <td>
          <div style="font-family: monospace; font-weight: 700; color: var(--color-text-main);">${escapeHtml(item.sku)}</div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted); font-family: monospace;">CB: ${escapeHtml(item.barcode || '-')}</div>
        </td>
        <td>
          <div style="font-weight: 600; color: var(--color-text-main); font-size: 0.85rem;">${escapeHtml(item.name)}</div>
          <div style="font-size: 0.72rem; color: var(--color-text-muted);">${escapeHtml(item.comercio)}</div>
        </td>
        <td style="text-align: center; font-weight: 800; font-size: 1rem; color: #10b981;">
          ${item.totalCounted}
        </td>
        <td style="text-align: center; font-size: 0.8rem; color: var(--color-text-muted);">
          ${item.readingsCount} lectura${item.readingsCount > 1 ? 's' : ''}
        </td>
        <td style="font-size: 0.78rem;">
          ${expiryStr}
        </td>
        <td style="font-size: 0.75rem; color: var(--color-text-muted);">
          ${escapeHtml(opsStr || '-')}
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="inv-recon-table-card">
      <div class="inv-recon-toolbar">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text-main);">
            Resumen de Cuadratura Físico-Sistémica
          </h3>
          <p style="margin: 0.2rem 0 0 0; font-size: 0.78rem; color: var(--color-text-muted);">
            Consolidado colaborativo de todos los teléfonos conectados a la sesión.
          </p>
        </div>

        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button id="btn-export-inv-excel" class="btn btn-outline btn-sm" style="border-color: #10b981; color: #10b981; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700;">
            <i class="ri-file-excel-2-line"></i> Descargar Excel
          </button>
          <button id="btn-export-inv-pdf" class="btn btn-outline btn-sm" style="border-color: #6366f1; color: #6366f1; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700;">
            <i class="ri-file-pdf-line"></i> Informe PDF
          </button>
          <button id="btn-close-inv-session" class="btn btn-primary btn-sm" style="background: #059669; border-color: #059669; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700;">
            <i class="ri-check-double-line"></i> Finalizar y Aplicar Conteo
          </button>
        </div>
      </div>

      <div class="inv-recon-table-container">
        <table class="inv-recon-table">
          <thead>
            <tr>
              <th style="width: 30px; text-align: center;">#</th>
              <th>SKU / Cód. Barras</th>
              <th>Producto & Comercio</th>
              <th style="text-align: center; color: #059669;">Total Físico</th>
              <th style="text-align: center;">Escaneos</th>
              <th>Vencimiento(s)</th>
              <th>Operadores</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">Sin lecturas registradas aún en esta sesión.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Eventos de exportación
  document.getElementById('btn-export-inv-excel')?.addEventListener('click', exportInventoryCountToExcel);
  document.getElementById('btn-export-inv-pdf')?.addEventListener('click', exportInventoryCountToPdf);
  document.getElementById('btn-close-inv-session')?.addEventListener('click', handleCloseSessionAndApply);
}

// ==========================================
// VISTA 3: REGISTRO DETALLADO (KARDEX LOGS)
// ==========================================
function renderScanLogsView() {
  const container = document.getElementById('inv-tab-content-area');
  if (!container) return;

  const rows = sessionItemsCache.map((item, idx) => {
    const dateFormatted = item.created_at ? new Date(item.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
    return `
      <tr>
        <td style="text-align: center; color: var(--color-text-muted); font-size: 0.75rem;">${idx + 1}</td>
        <td style="font-size: 0.8rem; font-family: monospace; color: var(--color-text-muted);">${dateFormatted}</td>
        <td>
          <div style="font-family: monospace; font-weight: 700; font-size: 0.825rem; color: var(--color-text-main);">${escapeHtml(item.sku)}</div>
          <div style="font-size: 0.7rem; color: var(--color-text-muted);">${escapeHtml(item.barcode || '')}</div>
        </td>
        <td style="font-size: 0.825rem; font-weight: 500;">${escapeHtml(item.product_name)}</td>
        <td style="text-align: center; font-weight: 800; color: #10b981; font-size: 0.95rem;">+${item.quantity}</td>
        <td style="font-size: 0.75rem;">${item.expiry_date || '<span style="color: var(--color-text-muted);">-</span>'}</td>
        <td style="font-size: 0.75rem;">${escapeHtml(item.lot_number || '-')}</td>
        <td style="font-size: 0.75rem; font-weight: 600; color: #6366f1;">${escapeHtml(item.operator_name || 'Admin')}</td>
        <td style="text-align: center;">
          <button type="button" class="btn-icon btn-del-item" data-id="${item.id}" style="color: #ef4444;" title="Eliminar lectura errónea">
            <i class="ri-delete-bin-line"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="inv-recon-table-card">
      <div class="inv-recon-toolbar">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text-main);">
            Kardex Detallado de Lecturas Individuales
          </h3>
          <p style="margin: 0.2rem 0 0 0; font-size: 0.78rem; color: var(--color-text-muted);">
            Historial de cada escaneo registrado en esta sesión con operario y fecha.
          </p>
        </div>
      </div>

      <div class="inv-recon-table-container">
        <table class="inv-recon-table">
          <thead>
            <tr>
              <th style="width: 25px; text-align: center;">#</th>
              <th>Hora</th>
              <th>SKU / Cód. Barras</th>
              <th>Producto</th>
              <th style="text-align: center; color: #059669;">Cant.</th>
              <th>Vencimiento</th>
              <th>Lote</th>
              <th>Operador</th>
              <th style="width: 40px; text-align: center;">Acción</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">Sin lecturas registradas aún.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Listener para eliminar lectura
  container.querySelectorAll('.btn-del-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const itemId = e.currentTarget.getAttribute('data-id');
      if (!confirm('¿Deseas eliminar este registro de lectura? Se descontará del conteo.')) return;
      try {
        await supabase.from('inventory_count_items').delete().eq('id', itemId);
        sessionItemsCache = sessionItemsCache.filter(x => x.id !== itemId);
        updateSessionStatsFromCache();
        renderScanLogsView();
      } catch (err) {
        alert('Error al eliminar registro: ' + err.message);
      }
    });
  });
}

// ==========================================
// RENDERIZADO DEL FEED EN VIVO
// ==========================================
function renderLiveFeedList() {
  const feedList = document.getElementById('inv-live-feed-list');
  if (!feedList) return;

  const recent = sessionItemsCache.slice(0, 15);
  if (recent.length === 0) {
    feedList.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--color-text-muted); font-size: 0.825rem;">
        Esperando lecturas de la cuadrilla...
      </div>
    `;
    return;
  }

  feedList.innerHTML = recent.map(item => {
    const timeAgo = formatTimeAgo(new Date(item.created_at || Date.now()));
    return `
      <div class="inv-feed-item">
        <div class="inv-feed-item-left">
          <div class="inv-feed-item-icon">
            <i class="ri-qr-scan-line"></i>
          </div>
          <div class="inv-feed-item-details">
            <span class="inv-feed-item-sku">${escapeHtml(item.product_name || item.sku)}</span>
            <span class="inv-feed-item-operator">${escapeHtml(item.operator_name || 'Operador')} • <strong style="font-family: monospace;">${escapeHtml(item.sku)}</strong> • ${timeAgo}</span>
          </div>
        </div>
        <div class="inv-feed-item-qty">+${item.quantity}</div>
      </div>
    `;
  }).join('');
}

function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'justo ahora';
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

// ==========================================
// SINCRONIZACIÓN REALTIME COLABORATIVA
// ==========================================
function setupRealtimeCollaboration(sessionId) {
  // Limpiar canal anterior
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
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
        if (!newItem) return;

        // Evitar duplicados de mi propio dispositivo si ya se agregaron en optimistic UI
        const exists = sessionItemsCache.some(x => x.id === newItem.id);
        if (!exists) {
          sessionItemsCache.unshift(newItem);
          updateSessionStatsFromCache();
          renderLiveFeedList();

          // Pitido sutil si otro teléfono escaneó
          if (newItem.device_id !== localDeviceId) {
            playBeepSound('success');
          }
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'inventory_count_items',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        const deletedId = payload.old?.id;
        if (deletedId) {
          sessionItemsCache = sessionItemsCache.filter(x => x.id !== deletedId);
          updateSessionStatsFromCache();
          renderLiveFeedList();
        }
      })
      .subscribe((status) => {
        const pill = document.getElementById('inv-session-live-pill');
        if (pill) pill.style.display = (status === 'SUBSCRIBED') ? 'inline-flex' : 'none';
      });

  } catch (e) {
    console.warn('Realtime subscription fallback to polling:', e);
  }

  // Sondeo de contingencia cada 5 segundos para garantizar integridad total
  fallbackPollingInterval = setInterval(() => {
    if (activeCountSession) {
      reloadSessionItemsQuietly(activeCountSession.id);
    }
  }, 5000);
}

async function reloadSessionItemsQuietly(sessionId) {
  try {
    const { data, error } = await supabase
      .from('inventory_count_items')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      sessionItemsCache = data;
      updateSessionStatsFromCache();
      renderLiveFeedList();
    }
  } catch (e) {}
}

function updateSessionStatsFromCache() {
  const totalScans = sessionItemsCache.length;
  const totalUnits = sessionItemsCache.reduce((acc, x) => acc + (x.quantity || 0), 0);
  const uniqueSkus = new Set(sessionItemsCache.map(x => String(x.sku).toUpperCase().trim())).size;

  const devicesSet = new Set(sessionItemsCache.map(x => x.operator_name || x.device_id || 'Móvil'));
  if (localOperatorName) devicesSet.add(localOperatorName);
  const activeDevices = Math.max(1, devicesSet.size);

  const kpiUnits = document.getElementById('kpi-inv-units');
  const kpiSkus = document.getElementById('kpi-inv-skus');
  const kpiScans = document.getElementById('kpi-inv-scans');
  const kpiDevices = document.getElementById('kpi-inv-devices');

  if (kpiUnits) kpiUnits.textContent = totalUnits;
  if (kpiSkus) kpiSkus.textContent = uniqueSkus;
  if (kpiScans) kpiScans.textContent = totalScans;
  if (kpiDevices) kpiDevices.textContent = activeDevices;

  const badgeSkus = document.getElementById('badge-inv-total-skus');
  const badgeScans = document.getElementById('badge-inv-total-scans');
  if (badgeSkus) badgeSkus.textContent = uniqueSkus;
  if (badgeScans) badgeScans.textContent = totalScans;

  const opsBadge = document.getElementById('lbl-active-operators-badge');
  if (opsBadge) {
    opsBadge.textContent = `${activeDevices} dispositivo${activeDevices > 1 ? 's' : ''} conectado${activeDevices > 1 ? 's' : ''}`;
  }
}

// ==========================================
// GESTIÓN DE SESIONES DE CONTEO
// ==========================================
async function loadMetadataAndSessions() {
  try {
    // 1. Cargar bodegas y comercios
    const [whRes, merRes] = await Promise.all([
      supabase.from('warehouses').select('id, name'),
      supabase.from('v_comercios_config').select('sigla, nombre')
    ]);

    sessionWarehouses = whRes.data || [];
    sessionMerchants = merRes.data || [];

    // 2. Revisar si hay sesión solicitada en URL hash o parámetros
    const urlParams = new URLSearchParams(window.location.search);
    const targetSessionId = urlParams.get('session');

    // 3. Cargar sesión activa más reciente
    let query = supabase.from('inventory_count_sessions').select('*');
    if (targetSessionId) {
      query = query.eq('id', targetSessionId);
    } else {
      query = query.eq('status', 'activa').order('created_at', { ascending: false });
    }

    const { data: sessions, error } = await query.limit(1);

    if (!error && sessions && sessions.length > 0) {
      await setActiveSession(sessions[0]);
    } else {
      // Si no hay activa, renderizar estado vacío
      activeCountSession = null;
      document.getElementById('inv-current-session-title').textContent = 'Sin Sesión Activa';
      document.getElementById('inv-current-session-sub').textContent = 'Crea una nueva sesión o selecciona una existente.';
      renderScannerView();
    }

  } catch (err) {
    console.error('Error cargando sesiones:', err);
  }
}

async function setActiveSession(session) {
  activeCountSession = session;

  const titleEl = document.getElementById('inv-current-session-title');
  const subEl = document.getElementById('inv-current-session-sub');
  const livePill = document.getElementById('inv-session-live-pill');
  const shareBtn = document.getElementById('btn-inv-share-qr');

  if (titleEl) titleEl.textContent = `${session.folio}: ${session.title}`;
  if (subEl) {
    subEl.innerHTML = `Comercio: <strong>${escapeHtml(session.comercio)}</strong> • Bodega: <strong>${escapeHtml(session.warehouse_name || 'Todas')}</strong> • Estado: <strong style="color: #10b981;">${session.status.toUpperCase()}</strong>`;
  }
  if (livePill) livePill.style.display = 'inline-flex';
  if (shareBtn) shareBtn.style.display = 'inline-flex';

  // Cargar lecturas de esta sesión
  const { data: items } = await supabase
    .from('inventory_count_items')
    .select('*')
    .eq('session_id', session.id)
    .order('created_at', { ascending: false });

  sessionItemsCache = items || [];
  updateSessionStatsFromCache();

  // Iniciar colaboración Realtime
  setupRealtimeCollaboration(session.id);

  // Renderizar la vista de escáner
  renderScannerView();
}

function initGlobalHeaderActions() {
  // Cambiar nombre del operador
  document.getElementById('btn-inv-set-operator')?.addEventListener('click', () => {
    const newName = prompt('Ingresa el nombre o identificación de este dispositivo/operador:', localOperatorName);
    if (newName && newName.trim()) {
      localOperatorName = newName.trim();
      localStorage.setItem('stocka_inv_operator_name', localOperatorName);
      document.getElementById('lbl-inv-operator-name').textContent = localOperatorName;
    }
  });

  // Compartir QR de sesión
  document.getElementById('btn-inv-share-qr')?.addEventListener('click', openSessionQrModal);

  // Cambiar de sesión
  document.getElementById('btn-inv-switch-session')?.addEventListener('click', openSessionsModal);

  // Nueva sesión
  document.getElementById('btn-inv-new-session')?.addEventListener('click', openNewSessionModal);
}

// Modal para compartir código QR de la sesión
function openSessionQrModal() {
  if (!activeCountSession) return;

  const joinUrl = `${window.location.origin}${window.location.pathname}?view=inventory_count&session=${activeCountSession.id}`;

  let modal = document.getElementById('modal-inv-share-qr');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'modal-inv-share-qr';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10060';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 440px; text-align: center; padding: 1.5rem; background: var(--color-surface); border-radius: var(--radius-lg);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h3 style="margin: 0; font-size: 1.15rem; color: var(--color-text-main); font-weight: 800;">
          <i class="ri-qr-code-line" style="color: #10b981;"></i> Unir Teléfonos a la Sesión
        </h3>
        <button type="button" class="modal-close" onclick="document.getElementById('modal-inv-share-qr').remove()">&times;</button>
      </div>

      <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1.25rem;">
        Apunta la cámara de cualquier teléfono móvil a este código QR para ingresar en tiempo real a la misma sesión de conteo:
      </p>

      <div id="inv-session-qr-canvas" style="display: flex; justify-content: center; margin-bottom: 1.25rem;"></div>

      <div style="background: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); font-family: monospace; font-size: 0.8rem; word-break: break-all; margin-bottom: 1.25rem; color: var(--color-primary);">
        ${joinUrl}
      </div>

      <button type="button" class="btn btn-primary" style="width: 100%;" onclick="document.getElementById('modal-inv-share-qr').remove()">
        Entendido
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  // Renderizar QR con librería qrcode-generator
  if (typeof qrcode !== 'undefined') {
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    document.getElementById('inv-session-qr-canvas').innerHTML = qr.createImgTag(5, 10);
  }
}

// Modal para listar sesiones existentes
async function openSessionsModal() {
  let modal = document.getElementById('modal-inv-sessions-list');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'modal-inv-sessions-list';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10060';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 650px; padding: 1.5rem; background: var(--color-surface); border-radius: var(--radius-lg); max-height: 85vh; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
        <h3 style="margin: 0; font-size: 1.15rem; color: var(--color-text-main); font-weight: 800;">
          <i class="ri-folder-shared-line" style="color: #6366f1;"></i> Sesiones de Conteo de Inventario
        </h3>
        <button type="button" class="modal-close" onclick="document.getElementById('modal-inv-sessions-list').remove()">&times;</button>
      </div>

      <div id="inv-sessions-loading" style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-loader-4-line ri-spin" style="font-size: 1.5rem;"></i> Cargando sesiones...
      </div>

      <div id="inv-sessions-table-wrapper" style="overflow-y: auto; flex: 1; display: none;">
        <!-- Se inyecta tabla -->
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  try {
    const { data: sessions, error } = await supabase
      .from('inventory_count_sessions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const listWrapper = document.getElementById('inv-sessions-table-wrapper');
    const loading = document.getElementById('inv-sessions-loading');
    if (loading) loading.style.display = 'none';
    if (listWrapper) listWrapper.style.display = 'block';

    if (!sessions || sessions.length === 0) {
      listWrapper.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
          No hay sesiones de conteo registradas aún.
        </div>
      `;
      return;
    }

    listWrapper.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.65rem;">
        ${sessions.map(s => {
          const isCurrent = activeCountSession && activeCountSession.id === s.id;
          const isActive = s.status === 'activa';
          return `
            <div style="background: var(--color-bg); border: 1px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border)'}; border-radius: var(--radius-md); padding: 0.85rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;">
              <div>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                  <strong style="color: var(--color-text-main); font-size: 0.95rem;">${escapeHtml(s.folio)}: ${escapeHtml(s.title)}</strong>
                  <span class="badge ${isActive ? 'badge-success' : 'badge-secondary'}" style="font-size: 0.65rem;">${s.status.toUpperCase()}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.2rem;">
                  Comercio: <strong>${escapeHtml(s.comercio)}</strong> • Bodega: <strong>${escapeHtml(s.warehouse_name || 'Todas')}</strong> • Unidades: <strong>${s.total_units || 0}</strong> • SKUs: <strong>${s.unique_skus || 0}</strong>
                </div>
              </div>
              <div>
                <button type="button" class="btn btn-sm ${isCurrent ? 'btn-primary' : 'btn-outline'} btn-select-session" data-id="${s.id}" ${isCurrent ? 'disabled' : ''}>
                  ${isCurrent ? 'Sesión Actual' : 'Ingresar'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    listWrapper.querySelectorAll('.btn-select-session').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const sId = e.currentTarget.getAttribute('data-id');
        const selected = sessions.find(x => x.id === sId);
        if (selected) {
          modal.remove();
          await setActiveSession(selected);
        }
      });
    });

  } catch (err) {
    alert('Error al cargar sesiones: ' + err.message);
  }
}

// Modal para crear nueva sesión
function openNewSessionModal() {
  let modal = document.getElementById('modal-inv-new-session');
  if (modal) modal.remove();

  const autoFolio = `CNT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  modal = document.createElement('div');
  modal.id = 'modal-inv-new-session';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10060';

  const whOptions = sessionWarehouses.map(w => `<option value="${w.id}" data-name="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`).join('');
  const merchOptions = ['<option value="Todos">Todos los Comercios (General)</option>', ...sessionMerchants.map(m => `<option value="${escapeHtml(m.nombre)}">${escapeHtml(m.nombre)}</option>`)].join('');

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 520px; padding: 1.5rem; background: var(--color-surface); border-radius: var(--radius-lg);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem;">
        <h3 style="margin: 0; font-size: 1.15rem; color: var(--color-text-main); font-weight: 800;">
          <i class="ri-add-circle-line" style="color: #6366f1;"></i> Iniciar Nueva Sesión de Conteo
        </h3>
        <button type="button" class="modal-close" onclick="document.getElementById('modal-inv-new-session').remove()">&times;</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div>
          <label style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">
            Folio de la Sesión
          </label>
          <input type="text" id="new-sess-folio" class="form-input" value="${autoFolio}" style="width: 100%; height: 38px; font-family: monospace; font-weight: 700;">
        </div>

        <div>
          <label style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">
            Título / Motivo del Conteo
          </label>
          <input type="text" id="new-sess-title" class="form-input" placeholder="Ej: Conteo Mensual Bodega Central" value="Toma Física de Inventario" style="width: 100%; height: 38px;">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">
              Comercio
            </label>
            <select id="new-sess-commerce" class="form-input" style="width: 100%; height: 38px;">
              ${merchOptions}
            </select>
          </div>
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">
              Bodega Asignada
            </label>
            <select id="new-sess-warehouse" class="form-input" style="width: 100%; height: 38px;">
              <option value="" data-name="Todas las bodegas">Todas las bodegas</option>
              ${whOptions}
            </select>
          </div>
        </div>

        <div>
          <label style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">
            Notas / Instrucciones para la Cuadrilla
          </label>
          <textarea id="new-sess-notes" class="form-input" rows="2" placeholder="Ej: Pasillos 1 al 4, revisar especialmente fechas de vencimiento..." style="width: 100%;"></textarea>
        </div>

        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button type="button" class="btn btn-outline" style="flex: 1;" onclick="document.getElementById('modal-inv-new-session').remove()">
            Cancelar
          </button>
          <button type="button" id="btn-save-new-session" class="btn btn-primary" style="flex: 2; background: #6366f1; border-color: #6366f1; font-weight: 700;">
            Crear y Abrir Conteo
          </button>
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
      const payload = {
        folio,
        title,
        comercio,
        warehouse_id: warehouseId,
        warehouse_name: warehouseName,
        status: 'activa',
        created_by: localOperatorName || 'Admin',
        notes
      };

      const { data, error } = await supabase
        .from('inventory_count_sessions')
        .insert([payload])
        .select();

      if (error) throw error;

      modal.remove();
      if (data && data.length > 0) {
        await setActiveSession(data[0]);
      }
    } catch (err) {
      alert('Error al crear sesión: ' + err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Crear y Abrir Conteo';
    }
  });
}

// Finalizar y aplicar conteo
async function handleCloseSessionAndApply() {
  if (!activeCountSession) return;

  const totalScans = sessionItemsCache.length;
  const totalUnits = sessionItemsCache.reduce((acc, x) => acc + (x.quantity || 0), 0);

  const confirmClose = confirm(
    `¿Deseas dar por FINALIZADA la sesión ${activeCountSession.folio}?\n\n` +
    `• Total Lecturas: ${totalScans}\n` +
    `• Total Unidades Contadas: ${totalUnits}\n\n` +
    `Al finalizar, la sesión quedará cerrada para nuevos escaneos y se consolidará el informe oficial.`
  );

  if (!confirmClose) return;

  try {
    const { error } = await supabase
      .from('inventory_count_sessions')
      .update({
        status: 'finalizada',
        closed_at: new Date().toISOString()
      })
      .eq('id', activeCountSession.id);

    if (error) throw error;

    activeCountSession.status = 'finalizada';
    alert('¡Sesión finalizada con éxito! Puedes descargar el informe en PDF o planilla Excel.');
    renderLiveReconView();

  } catch (err) {
    alert('Error al finalizar sesión: ' + err.message);
  }
}

// ==========================================
// EXPORTACIÓN A EXCEL Y PDF
// ==========================================
function exportInventoryCountToExcel() {
  if (!activeCountSession || sessionItemsCache.length === 0) {
    alert('No hay lecturas registradas para exportar.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Librería SheetJS (XLSX) no disponible.');
    return;
  }

  // 1. Hoja 1: Resumen de Cuadratura por SKU
  const skuMap = new Map();
  sessionItemsCache.forEach(item => {
    const skuKey = String(item.sku).toUpperCase().trim();
    if (!skuMap.has(skuKey)) {
      skuMap.set(skuKey, {
        sku: item.sku,
        name: item.product_name,
        barcode: item.barcode,
        comercio: item.comercio,
        totalCounted: 0,
        expiryDates: new Set(),
        lots: new Set(),
        readingsCount: 0
      });
    }
    const record = skuMap.get(skuKey);
    record.totalCounted += (item.quantity || 0);
    record.readingsCount += 1;
    if (item.expiry_date) record.expiryDates.add(item.expiry_date);
    if (item.lot_number) record.lots.add(item.lot_number);
  });

  const reconRows = [
    ['STOCKA WMS - INFORME OFICIAL DE CONTEO DE INVENTARIO'],
    ['Folio:', activeCountSession.folio, '', 'Título:', activeCountSession.title],
    ['Comercio:', activeCountSession.comercio, '', 'Bodega:', activeCountSession.warehouse_name || 'Todas'],
    ['Fecha Exportación:', new Date().toLocaleString('es-CL'), '', 'Estado:', activeCountSession.status],
    [],
    ['N°', 'SKU', 'Código de Barras', 'Descripción', 'Comercio', 'Físico Contado', 'N° Lecturas', 'Vencimiento(s)', 'Lote(s)']
  ];

  let idx = 1;
  skuMap.forEach(item => {
    reconRows.push([
      idx++,
      item.sku,
      item.barcode || '',
      item.name,
      item.comercio,
      item.totalCounted,
      item.readingsCount,
      Array.from(item.expiryDates).join(', '),
      Array.from(item.lots).join(', ')
    ]);
  });

  // 2. Hoja 2: Kardex Detallado de Cada Escaneo
  const detailRows = [
    ['STOCKA WMS - REGISTRO AUDITABLE DE LECTURAS (KARDEX)'],
    ['Folio:', activeCountSession.folio],
    [],
    ['N°', 'Fecha y Hora', 'Operador', 'Dispositivo', 'SKU', 'Código Barras', 'Producto', 'Cantidad', 'Fecha Vencimiento', 'Lote', 'Ubicación', 'Notas']
  ];

  sessionItemsCache.forEach((item, i) => {
    detailRows.push([
      i + 1,
      item.created_at ? new Date(item.created_at).toLocaleString('es-CL') : '',
      item.operator_name || 'Admin',
      item.device_id || '',
      item.sku,
      item.barcode || '',
      item.product_name,
      item.quantity,
      item.expiry_date || '',
      item.lot_number || '',
      item.location || '',
      item.notes || ''
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(reconRows);
  const ws2 = XLSX.utils.aoa_to_sheet(detailRows);

  XLSX.utils.book_append_sheet(wb, ws1, 'Resumen Cuadratura');
  XLSX.utils.book_append_sheet(wb, ws2, 'Detalle de Lecturas');

  const filename = `Conteo_${activeCountSession.folio}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function exportInventoryCountToPdf() {
  if (!activeCountSession || sessionItemsCache.length === 0) {
    alert('No hay lecturas registradas para generar el informe.');
    return;
  }

  // Agrupar por SKU
  const skuMap = new Map();
  sessionItemsCache.forEach(item => {
    const skuKey = String(item.sku).toUpperCase().trim();
    if (!skuMap.has(skuKey)) {
      skuMap.set(skuKey, {
        sku: item.sku,
        name: item.product_name,
        barcode: item.barcode,
        comercio: item.comercio,
        totalCounted: 0,
        expiryDates: new Set()
      });
    }
    const r = skuMap.get(skuKey);
    r.totalCounted += (item.quantity || 0);
    if (item.expiry_date) r.expiryDates.add(item.expiry_date);
  });

  const totalUnits = sessionItemsCache.reduce((a, b) => a + (b.quantity || 0), 0);
  const totalSkus = skuMap.size;

  let tableRows = '';
  let rowIdx = 1;
  skuMap.forEach(item => {
    const expiryStr = item.expiryDates.size > 0 ? Array.from(item.expiryDates).join(', ') : '-';
    tableRows += `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 8pt;">
        <td style="padding: 5px; text-align: center;">${rowIdx++}</td>
        <td style="padding: 5px; font-family: monospace; font-weight: 700;">${escapeHtml(item.sku)}</td>
        <td style="padding: 5px; font-family: monospace; color: #64748b;">${escapeHtml(item.barcode || '-')}</td>
        <td style="padding: 5px; font-weight: 500;">${escapeHtml(item.name)}</td>
        <td style="padding: 5px; text-align: center; font-weight: 800; color: #047857; font-size: 9pt;">${item.totalCounted}</td>
        <td style="padding: 5px; font-size: 7.5pt; color: #475569;">${expiryStr}</td>
      </tr>
    `;
  });

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '-99999px';
  container.style.width = '210mm';
  container.style.padding = '12mm 15mm';
  container.style.fontFamily = "'Inter', Arial, sans-serif";
  container.style.color = '#0f172a';
  container.style.backgroundColor = '#fff';

  container.innerHTML = `
    <div>
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="img/newlogotransp.png" alt="STOCKA Logo" style="height: 38px; width: auto;" onerror="this.src='https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093';">
          <div>
            <h1 style="margin: 0; font-size: 13pt; font-weight: 800; text-transform: uppercase;">Acta de Conteo Físico de Inventario</h1>
            <p style="margin: 2px 0 0 0; font-size: 7.5pt; color: #64748b;">Control de Existencias con Dispositivo Móvil • STOCKA WMS</p>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="background: #0f172a; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 800; font-size: 9pt; font-family: monospace;">
            ${activeCountSession.folio}
          </div>
          <div style="font-size: 7pt; color: #64748b; margin-top: 3px;">
            ${new Date().toLocaleString('es-CL')}
          </div>
        </div>
      </div>

      <!-- Metadatos -->
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 8pt;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="width: 18%; font-weight: 700; color: #475569;">Título Conteo:</td>
            <td style="width: 32%; font-weight: 700;">${escapeHtml(activeCountSession.title)}</td>
            <td style="width: 18%; font-weight: 700; color: #475569;">Bodega Asignada:</td>
            <td style="width: 32%; font-weight: 600;">${escapeHtml(activeCountSession.warehouse_name || 'Todas')}</td>
          </tr>
          <tr>
            <td style="font-weight: 700; color: #475569;">Comercio:</td>
            <td>${escapeHtml(activeCountSession.comercio)}</td>
            <td style="font-weight: 700; color: #475569;">Total SKUs:</td>
            <td style="font-weight: 800; color: #4338ca;">${totalSkus} SKUs (${totalUnits} unidades totales)</td>
          </tr>
        </table>
      </div>

      <!-- Tabla de Productos -->
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; margin-bottom: 15px; font-size: 8pt;">
        <thead>
          <tr style="background: #0f172a; color: #fff; font-size: 7pt; text-transform: uppercase;">
            <th style="padding: 5px; width: 25px; text-align: center;">#</th>
            <th style="padding: 5px; width: 90px; text-align: left;">SKU</th>
            <th style="padding: 5px; width: 90px; text-align: left;">Cód. Barras</th>
            <th style="padding: 5px; text-align: left;">Producto</th>
            <th style="padding: 5px; width: 60px; text-align: center; background: #047857;">Total Físico</th>
            <th style="padding: 5px; width: 110px; text-align: left;">Vencimiento</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <!-- Firmas -->
      <div style="border-top: 1px solid #cbd5e1; padding-top: 15px; margin-top: 20px;">
        <table style="width: 100%; font-size: 7.5pt;">
          <tr>
            <td style="width: 48%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px; vertical-align: top;">
              <div style="font-weight: 700; text-transform: uppercase; margin-bottom: 25px;">Responsable del Conteo (Bodeguero)</div>
              <div>Nombre: _____________________________________</div>
              <div style="margin-top: 15px;">Firma: ______________________________________</div>
            </td>
            <td style="width: 4%;"></td>
            <td style="width: 48%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px; vertical-align: top;">
              <div style="font-weight: 700; text-transform: uppercase; margin-bottom: 25px;">Supervisor de Operaciones STOCKA</div>
              <div>Nombre: _____________________________________</div>
              <div style="margin-top: 15px;">Firma V°B°: _________________________________</div>
            </td>
          </tr>
        </table>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  if (typeof html2pdf !== 'undefined') {
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `Informe_Conteo_${activeCountSession.folio}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().from(container).set(opt).save().finally(() => {
      container.remove();
    });
  } else {
    window.print();
    container.remove();
  }
}

// Exportar funciones a window para acceso global
window.renderInventoryCountAdmin = renderInventoryCountAdmin;
export default renderInventoryCountAdmin;
