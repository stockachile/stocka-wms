/**
 * WMS STOCKA — Marcador Flotante Black Friday (Admins + Comercios / Conglomerados)
 * Muestra en tiempo real el total de pedidos desde el jueves 26-11-2026 a las 21:00 hrs (CLT -03:00)
 * y cuántos de esos pedidos ya han sido procesados (salieron de "En procesamiento").
 *
 * - En panel Admin (`role === 'admin'`): muestra el consolidado global de todos los comercios.
 * - En panel Cliente (`role === 'client'`): muestra únicamente los pedidos de los comercios
 *   asociados al usuario (incluyendo todos los comercios del conglomerado/holding asignado).
 * - Oculto para cuentas `observer` o sin comercio asignado.
 */

import supabase from './supabase.js';

const BF_START_ISO = '2026-11-26T21:00:00-03:00';
const BF_START_DATE_FILTER = '2026-11-26';
const BF_START_MS = new Date(BF_START_ISO).getTime();
const BF_LABEL_SINCE = 'Desde Jue 26-11 · 21:00 hrs';

const STORAGE_KEY_POS = 'wms_bf_counter_pos_v1';
const STORAGE_KEY_MIN = 'wms_bf_counter_min_v1';

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const FULL_SYNC_INTERVAL_MS = 60000;

const PROCESSED_WMS_STATES = new Set([
  'En preparación',
  'Pickeado',
  'Listo para retiro',
  'Despachado',
  'Entregado'
]);

const EXCLUDED_WMS_STATES = new Set(['Cancelado', 'Archivado']);

const CANONICAL_CONGLOMERATES = [
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

const state = {
  initialized: false,
  mode: null, // 'admin' | 'client'
  assignedComercios: [], // Clean display names for client mode
  companyQueryVariants: [], // Case variants for Supabase .in('comercio', ...)
  companyLowerSet: new Set(), // Fast lowercase lookup for realtime filtering
  conglomerateName: null, // Detected holding/conglomerate name if multi-brand
  selectedScope: 'ALL', // 'ALL' or specific commerce name (client multi-commerce)
  isExpanded: false,
  isMinimized: false,
  isSyncing: false,
  hasError: false,
  realtimeStatus: 'connecting',
  ordersMap: new Map(), // id -> minimal order record
  lastFullSyncAt: 0,
  lastTotal: null,
  lastProcessed: null,
  realtimeChannel: null,
  syncTimerId: null,
  tickerTimerId: null,
  renderDebounceId: null,
  customPos: null,
  rootEl: null
};

function escapeHtml(str) {
  if (typeof window.escapeHtml === 'function') return window.escapeHtml(str);
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('es-CL');
}

function normalizeChannel(row) {
  const raw = String(row.origen || row.external_platform || 'Manual').trim();
  const low = raw.toLowerCase();
  if (low.includes('shopify')) return 'Shopify';
  if (low.includes('mercado') || low.includes('meli')) return 'Mercado Libre';
  if (low.includes('woo')) return 'WooCommerce';
  if (low.includes('falabella')) return 'Falabella';
  if (low.includes('jumpseller')) return 'Jumpseller';
  if (low.includes('paris')) return 'Paris';
  if (low.includes('ripley')) return 'Ripley';
  if (low.includes('walmart')) return 'Walmart';
  if (low.includes('tiendanube')) return 'Tiendanube';
  if (low.includes('punto de venta') || low.includes('pos')) return 'POS';
  if (low.includes('inversa')) return 'Log. Inversa';
  return raw || 'Manual';
}

function isOrderExcluded(row) {
  if (!row) return true;
  const wms = String(row.estado_wms || 'En procesamiento').trim();
  const st = String(row.status || '').trim().toLowerCase();
  if (EXCLUDED_WMS_STATES.has(wms)) return true;
  if (st === 'cancelado' || st === 'anulado' || st === 'archivado' || st === 'cancelled') return true;
  return false;
}

function isOrderWithinWindow(row) {
  if (!row || !row.created_at) return false;
  const ts = new Date(row.created_at).getTime();
  return Number.isFinite(ts) && ts >= BF_START_MS;
}

function isOrderAllowedForUser(row) {
  if (!row) return false;
  if (state.mode === 'admin') return true;
  const commLower = String(row.comercio || '').trim().toLowerCase();
  if (!commLower) return false;
  return state.companyLowerSet.has(commLower);
}

function isOrderInSelectedScope(row) {
  if (state.mode === 'admin' || state.selectedScope === 'ALL') return true;
  return String(row.comercio || '').trim().toLowerCase() === String(state.selectedScope).trim().toLowerCase();
}

/**
 * Resuelve los comercios asociados al usuario cliente (incluyendo conglomerados/holdings)
 * replicando la lógica canónica de js/app.js y billing_mappings.
 */
async function resolveClientCommerces(profile) {
  const rawSources = [
    profile?.comercio,
    window.currentCompany,
    (!profile?.comercio && profile?.company_name) ? profile.company_name : null,
    profile?.custom_company
  ].filter(Boolean);

  const rawTokens = [];
  rawSources.forEach(src => {
    String(src).split(',').forEach(part => {
      const trimmed = part.trim();
      if (trimmed && trimmed.toLowerCase() !== 'no asignado' && trimmed.toLowerCase() !== 'null') {
        rawTokens.push(trimmed);
      }
    });
  });

  if (rawTokens.length === 0) {
    return { assignedComercios: [], companyQueryVariants: [], companyLowerSet: new Set(), conglomerateName: null };
  }

  const assignedMap = new Map(); // UPPER -> displayName
  const variantSet = new Set();
  let detectedConglomerate = null;

  const addVariant = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    variantSet.add(clean);
    variantSet.add(clean.toLowerCase());
    variantSet.add(clean.toUpperCase());
  };

  const addAssigned = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const up = clean.toUpperCase();
    if (!assignedMap.has(up)) {
      assignedMap.set(up, clean);
    }
    addVariant(clean);
  };

  // 1. Expandir conglomerados canónicos si el perfil tiene asignado el nombre del holding
  const unmatchedUpperTokens = [];
  rawTokens.forEach(tok => {
    const up = tok.toUpperCase();
    addVariant(tok);
    let matchedHoldingAlias = false;
    for (const cg of CANONICAL_CONGLOMERATES) {
      if (cg.aliases.includes(up)) {
        matchedHoldingAlias = true;
        detectedConglomerate = cg.canonicalName;
        cg.children.forEach(child => addAssigned(child));
        break;
      }
    }
    if (!matchedHoldingAlias) {
      addAssigned(tok);
      unmatchedUpperTokens.push(up);
    }
  });

  // 2. Consultar billing_mappings solo si algún token podría ser un holding adicional configurado en BD
  try {
    const tokensUpper = Array.from(new Set(rawTokens.map(t => t.toUpperCase())));
    if (tokensUpper.length > 0) {
      const { data: mappings } = await supabase
        .from('billing_mappings')
        .select('comercio_nombre, billing_name');

      if (Array.isArray(mappings) && mappings.length > 0) {
        // Si un token del perfil coincide exactamente con un billing_name de conglomerado, incluir sus hijos
        for (const tokUp of tokensUpper) {
          const childrenFromBilling = mappings
            .filter(m => String(m.billing_name || '').trim().toUpperCase() === tokUp && m.comercio_nombre)
            .map(m => String(m.comercio_nombre).trim())
            .filter(name => name.toUpperCase() !== tokUp);

          if (childrenFromBilling.length > 1) {
            if (!detectedConglomerate) detectedConglomerate = tokUp;
            // Reemplazar el nombre del holding por sus marcas reales si corresponde
            if (assignedMap.has(tokUp)) assignedMap.delete(tokUp);
            childrenFromBilling.forEach(child => addAssigned(child));
          }
        }

        // Detectar nombre de conglomerado si el usuario tiene múltiples marcas ya listadas
        if (!detectedConglomerate && assignedMap.size > 1) {
          const assignedUppers = Array.from(assignedMap.keys());
          for (const cg of CANONICAL_CONGLOMERATES) {
            if (assignedUppers.some(u => cg.children.includes(u))) {
              detectedConglomerate = cg.canonicalName;
              break;
            }
          }
          if (!detectedConglomerate) {
            const firstMatch = mappings.find(m =>
              assignedUppers.includes(String(m.comercio_nombre || '').trim().toUpperCase()) &&
              m.billing_name &&
              !assignedUppers.includes(String(m.billing_name).trim().toUpperCase())
            );
            if (firstMatch?.billing_name) {
              detectedConglomerate = String(firstMatch.billing_name).trim().toUpperCase();
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[BlackFriday Counter] Aviso consultando billing_mappings:', err);
  }

  // Fallback de nombre de conglomerado si tiene múltiples marcas y company_name definido
  if (!detectedConglomerate && assignedMap.size > 1) {
    const assignedUppers = Array.from(assignedMap.keys());
    for (const cg of CANONICAL_CONGLOMERATES) {
      if (assignedUppers.some(u => cg.children.includes(u))) {
        detectedConglomerate = cg.canonicalName;
        break;
      }
    }
    if (!detectedConglomerate && profile?.company_name) {
      detectedConglomerate = String(profile.company_name).trim();
    }
  }

  const assignedComercios = Array.from(assignedMap.values());
  const companyQueryVariants = Array.from(variantSet);
  const companyLowerSet = new Set(companyQueryVariants.map(v => v.toLowerCase()));

  return {
    assignedComercios,
    companyQueryVariants,
    companyLowerSet,
    conglomerateName: detectedConglomerate
  };
}

function computeStats() {
  const now = Date.now();
  const lastHourCutoff = now - 3600000;

  let totalActive = 0;
  let processed = 0;
  let enProcesamiento = 0;
  let enPreparacion = 0;
  let pickeado = 0;
  let listoParaRetiro = 0;
  let despachado = 0;
  let entregado = 0;
  let incidencia = 0;
  let excludedCount = 0;
  let lastHourCount = 0;

  const channelCounts = new Map();
  // En modo cliente multi-comercio, el desglose de comercios siempre muestra todas las marcas del conglomerado
  const merchantStats = new Map(); // UPPER -> { name, total, processed }

  if (state.mode === 'client' && state.assignedComercios.length > 1) {
    state.assignedComercios.forEach(cName => {
      merchantStats.set(cName.toUpperCase(), { name: cName, total: 0, processed: 0 });
    });
  }

  for (const row of state.ordersMap.values()) {
    if (!isOrderWithinWindow(row)) continue;
    if (!isOrderAllowedForUser(row)) continue;

    const excluded = isOrderExcluded(row);
    const wms = String(row.estado_wms || 'En procesamiento').trim();
    const isProc = !excluded && PROCESSED_WMS_STATES.has(wms);

    // Acumular en tabla de comercios (para clientes multi-comercio, siempre sobre todos sus comercios asociados)
    if (!excluded) {
      const merchRaw = String(row.comercio || 'Sin comercio').trim();
      const merchKey = merchRaw.toUpperCase();
      const mEntry = merchantStats.get(merchKey) || { name: merchRaw, total: 0, processed: 0 };
      mEntry.total++;
      if (isProc) mEntry.processed++;
      merchantStats.set(merchKey, mEntry);
    }

    // Filtrar resto de KPIs por scope seleccionado (cuando cliente multi-comercio elige una marca)
    if (!isOrderInSelectedScope(row)) continue;

    if (excluded) {
      excludedCount++;
      continue;
    }

    totalActive++;
    const createdTs = new Date(row.created_at).getTime();
    if (createdTs >= lastHourCutoff) {
      lastHourCount++;
    }

    if (isProc) {
      processed++;
      if (wms === 'En preparación') enPreparacion++;
      else if (wms === 'Pickeado') pickeado++;
      else if (wms === 'Listo para retiro') listoParaRetiro++;
      else if (wms === 'Despachado') despachado++;
      else if (wms === 'Entregado') entregado++;
    } else if (wms === 'Incidencia') {
      incidencia++;
    } else {
      enProcesamiento++;
    }

    const ch = normalizeChannel(row);
    channelCounts.set(ch, (channelCounts.get(ch) || 0) + 1);
  }

  const pctRaw = totalActive > 0 ? (processed / totalActive) * 100 : 0;
  const pctRounded = Math.round(pctRaw);
  const pctDisplay = (pctRaw > 0 && pctRaw < 100)
    ? `${pctRaw.toFixed(1).replace(/\.0$/, '')}%`
    : `${pctRounded}%`;

  const elapsedHours = Math.max(0.25, (now - BF_START_MS) / 3600000);
  const ordersPerHour = totalActive > 0 ? Math.round((totalActive / elapsedHours) * 10) / 10 : 0;

  const channels = Array.from(channelCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  const sortedMerchants = Array.from(merchantStats.values())
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const topMerchants = state.mode === 'admin'
    ? sortedMerchants.slice(0, 5)
    : sortedMerchants;

  const pickedAndReady = pickeado + listoParaRetiro;
  const dispatchedAndDelivered = despachado + entregado;

  return {
    totalActive,
    processed,
    enProcesamiento,
    enPreparacion,
    pickeado,
    listoParaRetiro,
    pickedAndReady,
    despachado,
    entregado,
    dispatchedAndDelivered,
    incidencia,
    excludedCount,
    lastHourCount,
    ordersPerHour,
    pctRaw,
    pctRounded,
    pctDisplay,
    channels,
    topMerchants
  };
}

async function resolveSessionContext() {
  const isClientSidebar = Boolean(document.querySelector('[data-sidebar-role="client"]'));

  // Esperar brevemente a que admin.js o app.js pueblen los perfiles globales
  for (let attempt = 0; attempt < 35; attempt++) {
    if (!isClientSidebar && window.currentAdminProfile && window.currentAdminProfile.role === 'admin') {
      return { role: 'admin', profile: window.currentAdminProfile };
    }
    if (isClientSidebar && window.currentUserProfile && window.currentUserProfile.role) {
      return { role: window.currentUserProfile.role, profile: window.currentUserProfile };
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Fallback directo a Supabase Auth + profiles
  try {
    const { data: sessData } = await supabase.auth.getSession();
    const userId = sessData?.session?.user?.id;
    if (!userId) return null;

    const { data: prof, error } = await supabase
      .from('profiles')
      .select('role, comercio, company_name, full_name')
      .eq('id', userId)
      .single();

    if (error || !prof) return null;
    return { role: prof.role, profile: prof };
  } catch (_) {
    return null;
  }
}

async function fetchAllBlackFridayOrders({ silent = false } = {}) {
  if (state.isSyncing) return;
  if (state.mode === 'client' && state.companyQueryVariants.length === 0) return;

  state.isSyncing = true;
  state.hasError = false;
  if (!silent) updateSyncIndicators();

  try {
    const nextMap = new Map();
    let page = 0;

    while (page < MAX_PAGES) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('orders')
        .select('id, estado_wms, status, created_at, comercio, origen, external_platform, categoria_entrega')
        .gte('created_at', BF_START_ISO);

      if (state.mode === 'client') {
        query = query.in('comercio', state.companyQueryVariants);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (row && row.id && isOrderAllowedForUser(row)) {
          nextMap.set(String(row.id), row);
        }
      }

      if (data.length < PAGE_SIZE) break;
      page++;
    }

    state.ordersMap = nextMap;
    state.lastFullSyncAt = Date.now();
    state.hasError = false;
  } catch (err) {
    console.warn('[BlackFriday Counter] Error al sincronizar pedidos:', err);
    state.hasError = true;
  } finally {
    state.isSyncing = false;
    renderStats();
    updateSyncIndicators();
  }
}

function subscribeRealtime() {
  if (state.realtimeChannel) return;
  try {
    const channelName = state.mode === 'admin'
      ? 'bf-counter-orders-realtime-admin'
      : 'bf-counter-orders-realtime-client';

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const row = payload?.new;
          if (!row || !row.id) return;
          if (!isOrderWithinWindow(row) || !isOrderAllowedForUser(row)) return;
          state.ordersMap.set(String(row.id), {
            id: row.id,
            estado_wms: row.estado_wms,
            status: row.status,
            created_at: row.created_at,
            comercio: row.comercio,
            origen: row.origen,
            external_platform: row.external_platform,
            categoria_entrega: row.categoria_entrega
          });
          scheduleRender();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const row = payload?.new;
          if (!row || !row.id) return;
          const idKey = String(row.id);
          const alreadyTracked = state.ordersMap.has(idKey);
          const allowedNow = isOrderWithinWindow(row) && isOrderAllowedForUser(row);
          if (!alreadyTracked && !allowedNow) return;

          if (allowedNow) {
            const existing = state.ordersMap.get(idKey) || {};
            state.ordersMap.set(idKey, {
              ...existing,
              id: row.id,
              estado_wms: row.estado_wms !== undefined ? row.estado_wms : existing.estado_wms,
              status: row.status !== undefined ? row.status : existing.status,
              created_at: row.created_at || existing.created_at,
              comercio: row.comercio !== undefined ? row.comercio : existing.comercio,
              origen: row.origen !== undefined ? row.origen : existing.origen,
              external_platform: row.external_platform !== undefined ? row.external_platform : existing.external_platform,
              categoria_entrega: row.categoria_entrega !== undefined ? row.categoria_entrega : existing.categoria_entrega
            });
          } else {
            state.ordersMap.delete(idKey);
          }
          scheduleRender();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'orders' },
        (payload) => {
          const oldId = payload?.old?.id;
          if (oldId && state.ordersMap.has(String(oldId))) {
            state.ordersMap.delete(String(oldId));
            scheduleRender();
          }
        }
      )
      .subscribe((status) => {
        state.realtimeStatus = status === 'SUBSCRIBED' ? 'live' : String(status || '').toLowerCase();
        updateSyncIndicators();
      });

    state.realtimeChannel = channel;
  } catch (err) {
    console.warn('[BlackFriday Counter] Realtime no disponible, usando polling:', err);
    state.realtimeStatus = 'polling';
  }
}

function scheduleRender() {
  if (state.renderDebounceId) clearTimeout(state.renderDebounceId);
  state.renderDebounceId = setTimeout(() => {
    state.renderDebounceId = null;
    renderStats();
  }, 150);
}

function triggerBump(el) {
  if (!el) return;
  el.classList.remove('bf-bump');
  void el.offsetWidth;
  el.classList.add('bf-bump');
  setTimeout(() => el.classList.remove('bf-bump'), 350);
}

function updateSyncIndicators() {
  if (!state.rootEl) return;
  const dots = state.rootEl.querySelectorAll('.bf-live-dot');
  dots.forEach(dot => {
    dot.classList.toggle('is-syncing', state.isSyncing);
    dot.classList.toggle('is-error', state.hasError && !state.isSyncing);
  });

  const refreshBtn = state.rootEl.querySelector('#bf-btn-refresh');
  if (refreshBtn) {
    refreshBtn.classList.toggle('is-spinning', state.isSyncing);
    refreshBtn.disabled = state.isSyncing;
  }

  updateLastSyncText();
}

function updateLastSyncText() {
  const el = state.rootEl?.querySelector('#bf-last-sync-text');
  if (!el) return;
  if (state.isSyncing) {
    el.textContent = 'Actualizando...';
    return;
  }
  if (state.hasError) {
    el.textContent = 'Sin conexión · reintentando';
    return;
  }
  if (!state.lastFullSyncAt) {
    el.textContent = 'Conectando...';
    return;
  }
  const diffSec = Math.max(0, Math.floor((Date.now() - state.lastFullSyncAt) / 1000));
  const liveTag = state.realtimeStatus === 'live' ? 'En vivo · ' : '';
  if (diffSec < 5) el.textContent = `${liveTag}ahora`;
  else if (diffSec < 60) el.textContent = `${liveTag}hace ${diffSec}s`;
  else el.textContent = `${liveTag}hace ${Math.floor(diffSec / 60)}m`;
}

function getHeaderTitleText() {
  if (state.mode === 'admin') {
    return 'Marcador Black Friday 2026';
  }
  if (state.selectedScope !== 'ALL') {
    return `Black Friday · ${state.selectedScope}`;
  }
  if (state.assignedComercios.length > 1) {
    return state.conglomerateName
      ? `Black Friday · ${state.conglomerateName}`
      : `Black Friday · ${state.assignedComercios.length} Comercios`;
  }
  return `Black Friday · ${state.assignedComercios[0] || 'Mi Tienda'}`;
}

function getPillBrandFullText() {
  if (state.mode === 'client' && state.selectedScope !== 'ALL') {
    const shortName = state.selectedScope.length > 14
      ? `${state.selectedScope.slice(0, 13)}…`
      : state.selectedScope;
    return `BF · ${shortName}`;
  }
  return 'BLACK FRIDAY';
}

function setClientScope(nextScope) {
  if (state.mode !== 'client') return;
  state.selectedScope = nextScope || 'ALL';
  state.lastTotal = null;
  state.lastProcessed = null;
  renderStats();
}

function renderStats() {
  if (!state.rootEl) return;
  const s = computeStats();

  // 0. Dynamic header / pill badge label when conglomerate switches scope
  const titleEl = state.rootEl.querySelector('#bf-panel-title-text');
  if (titleEl) titleEl.textContent = getHeaderTitleText();

  const brandFullEl = state.rootEl.querySelector('#bf-brand-text-full');
  if (brandFullEl) brandFullEl.textContent = getPillBrandFullText();

  // 1. Compact pill values
  const pillTotal = state.rootEl.querySelector('#bf-pill-total');
  const pillProc = state.rootEl.querySelector('#bf-pill-processed');
  const pillPct = state.rootEl.querySelector('#bf-pill-pct');
  const pillBar = state.rootEl.querySelector('#bf-pill-bar');

  if (pillTotal) {
    pillTotal.textContent = fmtNum(s.totalActive);
    if (state.lastTotal !== null && s.totalActive > state.lastTotal) {
      triggerBump(pillTotal);
    }
  }
  if (pillProc) {
    pillProc.textContent = fmtNum(s.processed);
    if (state.lastProcessed !== null && s.processed > state.lastProcessed) {
      triggerBump(pillProc);
    }
  }
  if (pillPct) pillPct.textContent = s.pctDisplay;
  if (pillBar) pillBar.style.width = `${Math.min(100, Math.max(0, s.pctRaw))}%`;

  // 2. Minimized chip values
  const minText = state.rootEl.querySelector('#bf-min-summary');
  if (minText) {
    const scopePrefix = (state.mode === 'client' && state.selectedScope !== 'ALL')
      ? `BF (${state.selectedScope})`
      : 'BF';
    minText.textContent = `${scopePrefix}: ${fmtNum(s.totalActive)} · ${fmtNum(s.processed)} proc (${s.pctRounded}%)`;
  }

  // 3. Scope selector bar (solo clientes con múltiples comercios / conglomerado)
  const scopeSection = state.rootEl.querySelector('#bf-scope-section');
  const scopeBar = state.rootEl.querySelector('#bf-scope-bar');
  if (scopeSection && scopeBar) {
    if (state.mode === 'client' && state.assignedComercios.length > 1) {
      scopeSection.style.display = 'block';
      const allActive = state.selectedScope === 'ALL';
      const chipsHtml = [
        `<button type="button" class="bf-scope-chip ${allActive ? 'is-active' : ''}" data-bf-scope="ALL">Todos (${state.assignedComercios.length})</button>`,
        ...state.assignedComercios.map(cName => {
          const isAct = state.selectedScope.toLowerCase() === cName.toLowerCase();
          return `<button type="button" class="bf-scope-chip ${isAct ? 'is-active' : ''}" data-bf-scope="${escapeHtml(cName)}">${escapeHtml(cName)}</button>`;
        })
      ].join('');
      scopeBar.innerHTML = chipsHtml;
      scopeBar.querySelectorAll('[data-bf-scope]').forEach(btn => {
        btn.addEventListener('click', () => {
          setClientScope(btn.getAttribute('data-bf-scope') || 'ALL');
        });
      });
    } else {
      scopeSection.style.display = 'none';
    }
  }

  // 4. Expanded panel hero KPIs
  const heroTotal = state.rootEl.querySelector('#bf-hero-total');
  const heroProc = state.rootEl.querySelector('#bf-hero-processed');
  const heroPending = state.rootEl.querySelector('#bf-hero-pending');
  const heroProcSub = state.rootEl.querySelector('#bf-hero-processed-sub');
  const heroTotalSub = state.rootEl.querySelector('#bf-hero-total-sub');
  const heroPendingSub = state.rootEl.querySelector('#bf-hero-pending-sub');

  if (heroTotal) heroTotal.textContent = fmtNum(s.totalActive);
  if (heroProc) heroProc.textContent = fmtNum(s.processed);
  if (heroPending) heroPending.textContent = fmtNum(s.enProcesamiento);

  if (heroTotalSub) {
    heroTotalSub.textContent = s.excludedCount > 0
      ? `+${fmtNum(s.excludedCount)} cancel./arch.`
      : 'Activos en campaña';
  }
  if (heroProcSub) {
    heroProcSub.textContent = `${s.pctDisplay} del total`;
  }
  if (heroPendingSub) {
    heroPendingSub.textContent = s.incidencia > 0
      ? `+${fmtNum(s.incidencia)} incidencia`
      : 'En procesamiento';
  }

  // 5. Segmented progress bar
  const progLabel = state.rootEl.querySelector('#bf-progress-pct-label');
  if (progLabel) {
    progLabel.textContent = `${fmtNum(s.processed)} / ${fmtNum(s.totalActive)} (${s.pctDisplay})`;
  }
  const denom = Math.max(1, s.totalActive);
  const segDisp = state.rootEl.querySelector('#bf-seg-dispatched');
  const segPick = state.rootEl.querySelector('#bf-seg-picked');
  const segPrep = state.rootEl.querySelector('#bf-seg-prep');
  const segInc = state.rootEl.querySelector('#bf-seg-inc');
  if (segDisp) segDisp.style.width = `${(s.dispatchedAndDelivered / denom) * 100}%`;
  if (segPick) segPick.style.width = `${(s.pickedAndReady / denom) * 100}%`;
  if (segPrep) segPrep.style.width = `${(s.enPreparacion / denom) * 100}%`;
  if (segInc) segInc.style.width = `${(s.incidencia / denom) * 100}%`;

  // 6. Stage counts
  const setStage = (id, val) => {
    const el = state.rootEl.querySelector(id);
    if (el) el.textContent = fmtNum(val);
  };
  setStage('#bf-st-procesamiento', s.enProcesamiento);
  setStage('#bf-st-preparacion', s.enPreparacion);
  setStage('#bf-st-pickeado', s.pickedAndReady);
  setStage('#bf-st-despachado', s.dispatchedAndDelivered);

  const incWrap = state.rootEl.querySelector('#bf-st-incidencia-btn');
  if (incWrap) {
    incWrap.style.display = s.incidencia > 0 ? 'flex' : 'none';
    setStage('#bf-st-incidencia', s.incidencia);
  }

  // 7. Velocity strip
  const velRate = state.rootEl.querySelector('#bf-vel-rate');
  const velHour = state.rootEl.querySelector('#bf-vel-last-hour');
  if (velRate) velRate.textContent = `${s.ordersPerHour} ped/hr`;
  if (velHour) velHour.textContent = `+${fmtNum(s.lastHourCount)} última hr`;

  // 8. Channels
  const channelsWrap = state.rootEl.querySelector('#bf-channels-wrap');
  if (channelsWrap) {
    if (s.channels.length === 0) {
      channelsWrap.innerHTML = `<span class="bf-channel-chip">Sin pedidos aún</span>`;
    } else {
      channelsWrap.innerHTML = s.channels
        .map(([name, count]) => `<span class="bf-channel-chip">${escapeHtml(name)} <strong>${fmtNum(count)}</strong></span>`)
        .join('');
    }
  }

  // 9. Merchants section (Admins: Top 5 | Cliente Multi-comercio: Todos sus comercios clicables | Cliente 1 comercio: Oculto)
  const merchantsSection = state.rootEl.querySelector('#bf-merchants-section');
  const merchantsTitle = state.rootEl.querySelector('#bf-merchants-title');
  const merchantsWrap = state.rootEl.querySelector('#bf-merchants-wrap');

  if (merchantsSection && merchantsWrap) {
    const showMerchantsBlock = state.mode === 'admin' || state.assignedComercios.length > 1;
    merchantsSection.style.display = showMerchantsBlock ? 'block' : 'none';

    if (showMerchantsBlock) {
      if (merchantsTitle) {
        merchantsTitle.textContent = state.mode === 'admin'
          ? 'Top comercios Black Friday'
          : (state.conglomerateName ? `Comercios · ${state.conglomerateName}` : 'Tus comercios asociados');
      }

      if (s.topMerchants.length === 0) {
        merchantsWrap.innerHTML = `<div class="bf-merchant-row"><span class="bf-merchant-name" style="color: var(--bf-text-muted);">Sin pedidos registrados desde las 21:00</span></div>`;
      } else {
        const isClientMulti = state.mode === 'client' && state.assignedComercios.length > 1;
        merchantsWrap.innerHTML = s.topMerchants.map(m => {
          const mPct = m.total > 0 ? Math.round((m.processed / m.total) * 100) : 0;
          const isActiveRow = isClientMulti && state.selectedScope.toLowerCase() === m.name.toLowerCase();
          return `
            <div class="bf-merchant-row ${isClientMulti ? 'is-clickable' : ''} ${isActiveRow ? 'is-active' : ''}"
                 ${isClientMulti ? `data-bf-merchant-row="${escapeHtml(m.name)}"` : ''}
                 title="${escapeHtml(m.name)}: ${m.processed} procesados de ${m.total}${isClientMulti ? ' · Clic para filtrar' : ''}">
              <span class="bf-merchant-name">${escapeHtml(m.name)}</span>
              <span class="bf-merchant-stats">
                <span class="bf-merchant-proc">${fmtNum(m.processed)} proc (${mPct}%)</span>
                <span class="bf-merchant-total">${fmtNum(m.total)}</span>
              </span>
            </div>
          `;
        }).join('');

        if (isClientMulti) {
          merchantsWrap.querySelectorAll('[data-bf-merchant-row]').forEach(rowEl => {
            rowEl.addEventListener('click', () => {
              const name = rowEl.getAttribute('data-bf-merchant-row');
              const alreadySelected = state.selectedScope.toLowerCase() === String(name || '').toLowerCase();
              setClientScope(alreadySelected ? 'ALL' : name);
            });
          });
        }
      }
    }
  }

  // 10. Reset position button
  const resetPosBtn = state.rootEl.querySelector('#bf-btn-reset-pos');
  if (resetPosBtn) {
    resetPosBtn.style.display = state.customPos ? 'inline-flex' : 'none';
  }

  state.lastTotal = s.totalActive;
  state.lastProcessed = s.processed;
}

function navigateToOrdersView(targetTab = 'Todos') {
  try {
    if (state.mode === 'admin') {
      const ordersNav = document.querySelector('[data-view="orders_admin"]');
      const isAlreadyInOrders = ordersNav && ordersNav.classList.contains('active');
      if (ordersNav && !isAlreadyInOrders) {
        ordersNav.click();
      }

      setTimeout(() => {
        const fromInput = document.getElementById('filter-date-from');
        let needsReload = false;
        if (fromInput && fromInput.value > BF_START_DATE_FILTER) {
          fromInput.value = BF_START_DATE_FILTER;
          fromInput.dispatchEvent(new Event('change', { bubbles: true }));
          needsReload = true;
        }
        if (typeof window.setWmsTab === 'function') {
          window.setWmsTab(targetTab);
        }
        if (needsReload && typeof window.refreshWmsOrders === 'function') {
          window.refreshWmsOrders(null, 'filtered');
        }
      }, isAlreadyInOrders ? 60 : 450);
    } else {
      // Modo Cliente (dashboard.html)
      const ordersNav = document.querySelector('[data-view="orders"]');
      const isAlreadyInOrders = ordersNav && ordersNav.classList.contains('active');
      if (ordersNav && !isAlreadyInOrders) {
        ordersNav.click();
      }

      setTimeout(() => {
        const fromInput = document.getElementById('filter-client-date-from');
        if (fromInput && (!fromInput.value || fromInput.value > BF_START_DATE_FILTER)) {
          fromInput.value = BF_START_DATE_FILTER;
          fromInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const commerceSel = document.getElementById('filter-client-commerce');
        if (commerceSel) {
          const desired = state.selectedScope === 'ALL' ? '' : state.selectedScope;
          const matchedOpt = Array.from(commerceSel.options || []).find(
            o => String(o.value || '').toLowerCase() === desired.toLowerCase()
          );
          if (matchedOpt) {
            commerceSel.value = matchedOpt.value;
            commerceSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        if (typeof window.setClientWmsTab === 'function') {
          window.setClientWmsTab(targetTab);
        }
      }, isAlreadyInOrders ? 80 : 650);
    }

    setExpanded(false);
  } catch (err) {
    console.warn('[BlackFriday Counter] Error navegando a vista de pedidos:', err);
  }
}

function setExpanded(expanded) {
  state.isExpanded = Boolean(expanded);
  if (!state.rootEl) return;
  state.rootEl.classList.toggle('is-expanded', state.isExpanded);
  if (state.isExpanded) {
    updateLastSyncText();
    clampPositionToViewport();
  }
}

function setMinimized(minimized) {
  state.isMinimized = Boolean(minimized);
  try {
    localStorage.setItem(STORAGE_KEY_MIN, state.isMinimized ? '1' : '0');
  } catch (_) {}
  if (!state.rootEl) return;
  if (state.isMinimized) {
    state.isExpanded = false;
    state.rootEl.classList.remove('is-expanded');
  }
  state.rootEl.classList.toggle('is-minimized', state.isMinimized);
}

function applyCustomPosition(pos) {
  if (!state.rootEl) return;
  if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.bottom)) {
    state.customPos = null;
    state.rootEl.classList.remove('bf-custom-pos');
    state.rootEl.style.left = '';
    state.rootEl.style.bottom = '';
    try { localStorage.removeItem(STORAGE_KEY_POS); } catch (_) {}
    renderStats();
    return;
  }

  state.customPos = { left: pos.left, bottom: pos.bottom };
  state.rootEl.classList.add('bf-custom-pos');
  clampPositionToViewport();
}

function clampPositionToViewport() {
  if (!state.rootEl || !state.customPos) return;
  const rect = state.rootEl.getBoundingClientRect();
  const pad = 10;
  const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
  const maxBottom = Math.max(pad, window.innerHeight - rect.height - pad);
  const clampedLeft = Math.min(Math.max(pad, state.customPos.left), maxLeft);
  const clampedBottom = Math.min(Math.max(pad, state.customPos.bottom), maxBottom);
  state.rootEl.style.left = `${clampedLeft}px`;
  state.rootEl.style.bottom = `${clampedBottom}px`;
}

function setupDragBehavior(pillEl) {
  let pointerDown = false;
  let dragged = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originBottom = 0;

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button')) return;
    pointerDown = true;
    dragged = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = state.rootEl.getBoundingClientRect();
    originLeft = rect.left;
    originBottom = window.innerHeight - rect.bottom;
  };

  const onPointerMove = (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragged && Math.hypot(dx, dy) < 6) return;

    if (!dragged) {
      dragged = true;
      pillEl.classList.add('bf-dragging');
      state.rootEl.classList.add('bf-custom-pos');
    }

    const rect = state.rootEl.getBoundingClientRect();
    const pad = 10;
    const nextLeft = Math.min(Math.max(pad, originLeft + dx), Math.max(pad, window.innerWidth - rect.width - pad));
    const nextBottom = Math.min(Math.max(pad, originBottom - dy), Math.max(pad, window.innerHeight - rect.height - pad));

    state.customPos = { left: nextLeft, bottom: nextBottom };
    state.rootEl.style.left = `${nextLeft}px`;
    state.rootEl.style.bottom = `${nextBottom}px`;
  };

  const onPointerUp = () => {
    if (!pointerDown) return;
    pointerDown = false;
    pillEl.classList.remove('bf-dragging');
    if (dragged) {
      try {
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(state.customPos));
      } catch (_) {}
      renderStats();
      pillEl.dataset.justDragged = '1';
      setTimeout(() => { delete pillEl.dataset.justDragged; }, 80);
    }
  };

  pillEl.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', clampPositionToViewport);
}

function getFooterBadgeHtml() {
  if (state.mode === 'admin') {
    return `<i class="ri-shield-user-line"></i> Solo Admins`;
  }
  if (state.assignedComercios.length > 1) {
    const label = state.conglomerateName
      ? `${escapeHtml(state.conglomerateName)} · ${state.assignedComercios.length} marcas`
      : `Conglomerado · ${state.assignedComercios.length} marcas`;
    return `<i class="ri-building-2-line"></i> ${label}`;
  }
  return `<i class="ri-store-2-line"></i> ${escapeHtml(state.assignedComercios[0] || 'Mi Comercio')}`;
}

function mountScoreboardDom() {
  if (document.getElementById('bf-counter-root')) return;

  const ctaLabel = state.mode === 'admin' ? 'Torre de Control' : 'Ver mis pedidos';

  const root = document.createElement('div');
  root.id = 'bf-counter-root';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Contador en vivo Black Friday');

  root.innerHTML = `
    <!-- Panel Expandido -->
    <div class="bf-panel" id="bf-counter-panel">
      <div class="bf-panel-header">
        <div class="bf-panel-title-wrap">
          <div class="bf-panel-title">
            <i class="ri-fire-fill"></i>
            <span id="bf-panel-title-text">${escapeHtml(getHeaderTitleText())}</span>
          </div>
          <div class="bf-panel-subtitle">
            <span>${BF_LABEL_SINCE}</span>
            <span>•</span>
            <span id="bf-last-sync-text">Conectando...</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.2rem;">
          <button type="button" class="bf-icon-btn" id="bf-btn-refresh" title="Actualizar ahora">
            <i class="ri-refresh-line"></i>
          </button>
          <button type="button" class="bf-icon-btn" id="bf-btn-close-panel" title="Cerrar detalle">
            <i class="ri-close-line"></i>
          </button>
        </div>
      </div>

      <div class="bf-panel-body">
        <!-- Selector de marca para Conglomerados / Multi-Comercio -->
        <div id="bf-scope-section" style="display: none;">
          <div class="bf-scope-bar" id="bf-scope-bar"></div>
        </div>

        <!-- Hero 3 KPIs -->
        <div class="bf-hero-grid">
          <div class="bf-hero-card is-accent">
            <span class="bf-hero-label">Total Pedidos</span>
            <span class="bf-hero-num" id="bf-hero-total">—</span>
            <span class="bf-hero-sub" id="bf-hero-total-sub">Activos en campaña</span>
          </div>
          <div class="bf-hero-card is-success">
            <span class="bf-hero-label">Procesados</span>
            <span class="bf-hero-num" id="bf-hero-processed">—</span>
            <span class="bf-hero-sub" id="bf-hero-processed-sub">0% del total</span>
          </div>
          <div class="bf-hero-card is-warning">
            <span class="bf-hero-label">Por Procesar</span>
            <span class="bf-hero-num" id="bf-hero-pending">—</span>
            <span class="bf-hero-sub" id="bf-hero-pending-sub">En procesamiento</span>
          </div>
        </div>

        <!-- Barra de avance segmentada -->
        <div class="bf-progress-section">
          <div class="bf-progress-head">
            <span style="color: var(--bf-text-muted); font-weight: 600;">Avance de procesamiento</span>
            <strong id="bf-progress-pct-label">0 / 0 (0%)</strong>
          </div>
          <div class="bf-segmented-bar" title="Verde: Despachado/Entregado · Azul: Pickeado/Listo · Violeta: En preparación">
            <div class="bf-seg bf-seg-dispatched" id="bf-seg-dispatched" style="width: 0%;"></div>
            <div class="bf-seg bf-seg-picked" id="bf-seg-picked" style="width: 0%;"></div>
            <div class="bf-seg bf-seg-prep" id="bf-seg-prep" style="width: 0%;"></div>
            <div class="bf-seg bf-seg-inc" id="bf-seg-inc" style="width: 0%;"></div>
          </div>
        </div>

        <!-- Desglose por etapa WMS -->
        <div>
          <div class="bf-section-label">
            <span>Desglose por estado WMS</span>
            <span style="font-weight: 500; opacity: 0.75;">Clic para filtrar</span>
          </div>
          <div class="bf-stages-grid">
            <button type="button" class="bf-stage-btn" data-bf-tab="En procesamiento">
              <span class="bf-stage-left">
                <span class="bf-stage-dot" style="background: #fbbf24;"></span>
                <span class="bf-stage-name">En procesamiento</span>
              </span>
              <span class="bf-stage-count" id="bf-st-procesamiento">0</span>
            </button>
            <button type="button" class="bf-stage-btn" data-bf-tab="En preparación">
              <span class="bf-stage-left">
                <span class="bf-stage-dot" style="background: #a78bfa;"></span>
                <span class="bf-stage-name">En preparación</span>
              </span>
              <span class="bf-stage-count" id="bf-st-preparacion">0</span>
            </button>
            <button type="button" class="bf-stage-btn" data-bf-tab="Pickeado">
              <span class="bf-stage-left">
                <span class="bf-stage-dot" style="background: #38bdf8;"></span>
                <span class="bf-stage-name">Pickeados / Listos</span>
              </span>
              <span class="bf-stage-count" id="bf-st-pickeado">0</span>
            </button>
            <button type="button" class="bf-stage-btn" data-bf-tab="Despachado">
              <span class="bf-stage-left">
                <span class="bf-stage-dot" style="background: #10b981;"></span>
                <span class="bf-stage-name">Desp. / Entregados</span>
              </span>
              <span class="bf-stage-count" id="bf-st-despachado">0</span>
            </button>
            <button type="button" class="bf-stage-btn" id="bf-st-incidencia-btn" data-bf-tab="Incidencia" style="display: none; grid-column: 1 / -1;">
              <span class="bf-stage-left">
                <span class="bf-stage-dot" style="background: #f87171;"></span>
                <span class="bf-stage-name">Incidencias</span>
              </span>
              <span class="bf-stage-count" id="bf-st-incidencia">0</span>
            </button>
          </div>
        </div>

        <!-- Ritmo / Velocidad -->
        <div class="bf-velocity-row">
          <div class="bf-velocity-item">
            <i class="ri-speed-up-line"></i>
            <span>Ritmo: <strong id="bf-vel-rate">0 ped/hr</strong></span>
          </div>
          <div class="bf-velocity-item">
            <i class="ri-time-line"></i>
            <strong id="bf-vel-last-hour">+0 última hr</strong>
          </div>
        </div>

        <!-- Canales -->
        <div>
          <div class="bf-section-label"><span>Por canal de venta</span></div>
          <div class="bf-chips-row" id="bf-channels-wrap"></div>
        </div>

        <!-- Comercios (Admin: Top 5 | Cliente Multi-comercio: Todos sus comercios asociados) -->
        <div id="bf-merchants-section">
          <div class="bf-section-label"><span id="bf-merchants-title">Top comercios Black Friday</span></div>
          <div class="bf-merchants-list" id="bf-merchants-wrap"></div>
        </div>
      </div>

      <div class="bf-panel-footer">
        <span style="display: inline-flex; align-items: center; gap: 0.28rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              title="Se contabilizan como procesados todos los pedidos que ya avanzaron de 'En procesamiento' (En preparación, Pickeado, Listo para retiro, Despachado y Entregado).">
          ${getFooterBadgeHtml()}
        </span>
        <div class="bf-footer-actions">
          <button type="button" class="bf-ghost-btn" id="bf-btn-reset-pos" style="display: none;" title="Restaurar posición centrada">
            Centrar
          </button>
          <button type="button" class="bf-link-btn" id="bf-btn-open-tower">
            <i class="ri-external-link-line"></i> ${ctaLabel}
          </button>
        </div>
      </div>
    </div>

    <!-- Barra Flotante Compacta -->
    <div class="bf-pill" id="bf-counter-pill" title="Marcador Black Friday (Desde Jue 26-11 21:00) · Clic para ver desglose o arrastra para mover">
      <span class="bf-drag-grip" title="Arrastrar marcador"><i class="ri-draggable"></i></span>

      <span class="bf-brand-badge">
        <span class="bf-live-dot"></span>
        <span class="bf-brand-text-full" id="bf-brand-text-full">BLACK FRIDAY</span>
        <span class="bf-brand-text-short">BF</span>
      </span>

      <div class="bf-metric-group" title="Pedidos activos desde el jueves 26-11 a las 21:00 hrs">
        <span class="bf-metric-val is-total" id="bf-pill-total">—</span>
        <span class="bf-metric-lbl">pedidos</span>
      </div>

      <span class="bf-divider"></span>

      <div class="bf-metric-group" title="Pedidos ya procesados (salieron de En procesamiento)">
        <span class="bf-metric-val is-processed" id="bf-pill-processed">—</span>
        <span class="bf-metric-lbl">proc.</span>
      </div>

      <span class="bf-pct-pill" id="bf-pill-pct">0%</span>

      <div class="bf-mini-bar-wrap" aria-hidden="true">
        <div class="bf-mini-bar-fill" id="bf-pill-bar" style="width: 0%;"></div>
      </div>

      <div class="bf-pill-actions">
        <button type="button" class="bf-icon-btn" id="bf-btn-toggle-detail" title="Ver desglose Black Friday">
          <i class="ri-arrow-up-s-line bf-chevron-icon"></i>
        </button>
        <button type="button" class="bf-icon-btn" id="bf-btn-minimize" title="Minimizar marcador">
          <i class="ri-subtract-line"></i>
        </button>
      </div>
    </div>

    <!-- Chip Minimizado -->
    <button type="button" class="bf-chip-minimized" id="bf-chip-minimized" title="Expandir marcador Black Friday">
      <span class="bf-live-dot"></span>
      <i class="ri-fire-fill" style="color: #f59e0b;"></i>
      <span id="bf-min-summary">BF: —</span>
    </button>
  `;

  document.body.appendChild(root);
  state.rootEl = root;

  // Bind interactions
  const pillEl = root.querySelector('#bf-counter-pill');
  const toggleBtn = root.querySelector('#bf-btn-toggle-detail');
  const minBtn = root.querySelector('#bf-btn-minimize');
  const minChip = root.querySelector('#bf-chip-minimized');
  const closePanelBtn = root.querySelector('#bf-btn-close-panel');
  const refreshBtn = root.querySelector('#bf-btn-refresh');
  const openTowerBtn = root.querySelector('#bf-btn-open-tower');
  const resetPosBtn = root.querySelector('#bf-btn-reset-pos');

  pillEl.addEventListener('click', (e) => {
    if (pillEl.dataset.justDragged === '1') return;
    if (e.target.closest('#bf-btn-minimize')) return;
    setExpanded(!state.isExpanded);
  });

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setExpanded(!state.isExpanded);
    });
  }

  if (minBtn) {
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMinimized(true);
    });
  }

  if (minChip) {
    minChip.addEventListener('click', () => {
      setMinimized(false);
    });
  }

  if (closePanelBtn) {
    closePanelBtn.addEventListener('click', () => setExpanded(false));
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => fetchAllBlackFridayOrders());
  }

  if (openTowerBtn) {
    openTowerBtn.addEventListener('click', () => navigateToOrdersView('Todos'));
  }

  if (resetPosBtn) {
    resetPosBtn.addEventListener('click', () => applyCustomPosition(null));
  }

  root.querySelectorAll('[data-bf-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-bf-tab') || 'Todos';
      navigateToOrdersView(tab);
    });
  });

  // Close panel on outside click or Escape
  document.addEventListener('click', (e) => {
    if (state.isExpanded && state.rootEl && !state.rootEl.contains(e.target)) {
      setExpanded(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isExpanded) {
      setExpanded(false);
    }
  });

  setupDragBehavior(pillEl);

  // Restore saved preferences
  try {
    if (localStorage.getItem(STORAGE_KEY_MIN) === '1') {
      setMinimized(true);
    }
    const rawPos = localStorage.getItem(STORAGE_KEY_POS);
    if (rawPos) {
      const parsed = JSON.parse(rawPos);
      if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.bottom)) {
        applyCustomPosition(parsed);
      }
    }
  } catch (_) {}
}

async function initBlackFridayCounter() {
  if (state.initialized) return;
  state.initialized = true;

  const ctx = await resolveSessionContext();
  if (!ctx || !ctx.role) return;

  if (ctx.role === 'admin') {
    state.mode = 'admin';
  } else if (ctx.role === 'client') {
    const resolved = await resolveClientCommerces(ctx.profile);
    if (resolved.assignedComercios.length === 0) {
      // Cuenta cliente sin comercio asignado: no mostrar contador
      return;
    }
    state.mode = 'client';
    state.assignedComercios = resolved.assignedComercios;
    state.companyQueryVariants = resolved.companyQueryVariants;
    state.companyLowerSet = resolved.companyLowerSet;
    state.conglomerateName = resolved.conglomerateName;
  } else {
    // Cuentas observer / solo lectura: no mostrar contador
    return;
  }

  mountScoreboardDom();

  await fetchAllBlackFridayOrders();
  subscribeRealtime();

  // Periodic background reconciliation (only when tab is visible)
  state.syncTimerId = setInterval(() => {
    if (!document.hidden) {
      fetchAllBlackFridayOrders({ silent: true });
    }
  }, FULL_SYNC_INTERVAL_MS);

  // Update "hace Xs" label when expanded
  state.tickerTimerId = setInterval(() => {
    if (state.isExpanded) {
      updateLastSyncText();
    }
  }, 10000);

  // Immediate refresh when returning to tab after >= 15s
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastFullSyncAt > 15000) {
      fetchAllBlackFridayOrders({ silent: true });
    }
  });

  // Expose helper for debugging / manual refresh
  window.refreshBlackFridayCounter = () => fetchAllBlackFridayOrders();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBlackFridayCounter);
} else {
  initBlackFridayCounter();
}
