/**
 * WMS STOCKA - Módulo "Radar de Comercios" en Tiempo Real (v1.2 - Filtrado Interactivo In-Card)
 * Resumen ejecutivo y operativo en vivo por comercio dentro del Gestor de Pedidos:
 * - Volumen de pedidos por periodos de tiempo seleccionables (sincronizado con Torre de Control e IndexedDB SWR)
 * - Plataformas activas (merchant_integrations) + salud de sincronización + pedidos por plataforma
 * - Al hacer clic en una plataforma dentro de la tarjeta de un comercio, la tarjeta se actualiza in-situ
 *   mostrando el desglose de estados, avance e incidencias exclusivos de esa plataforma.
 * - El botón "Ver pedidos ›" lleva a Torre de Control aplicando la selección activa de la tarjeta.
 */

import { supabase } from './supabase.js';

const PLATFORM_DEFINITIONS = {
  Shopify: {
    key: 'Shopify',
    filterValue: 'Shopify',
    label: 'Shopify',
    short: 'Shopify',
    icon: 'ri-shopping-bag-3-line',
    accentColor: '#65a30d'
  },
  MercadoLibre: {
    key: 'MercadoLibre',
    filterValue: 'MercadoLibre',
    label: 'Mercado Libre',
    short: 'MeLi',
    icon: 'ri-hand-coin-line',
    accentColor: '#ca8a04'
  },
  Falabella: {
    key: 'Falabella',
    filterValue: 'Falabella',
    label: 'Falabella',
    short: 'Falabella',
    icon: 'ri-store-3-line',
    accentColor: '#16a34a'
  },
  WooCommerce: {
    key: 'WooCommerce',
    filterValue: 'WooCommerce',
    label: 'WooCommerce',
    short: 'Woo',
    icon: 'ri-shopping-cart-line',
    accentColor: '#9333ea'
  },
  Jumpseller: {
    key: 'Jumpseller',
    filterValue: 'Jumpseller',
    label: 'Jumpseller',
    short: 'Jumpseller',
    icon: 'ri-global-line',
    accentColor: '#0284c7'
  },
  Paris: {
    key: 'Paris',
    filterValue: 'Paris',
    label: 'Paris',
    short: 'Paris',
    icon: 'ri-building-4-line',
    accentColor: '#0ea5e9'
  },
  Ripley: {
    key: 'Ripley',
    filterValue: 'Ripley',
    label: 'Ripley',
    short: 'Ripley',
    icon: 'ri-vip-crown-line',
    accentColor: '#7c3aed'
  },
  Walmart: {
    key: 'Walmart',
    filterValue: 'Walmart',
    label: 'Walmart',
    short: 'Walmart',
    icon: 'ri-sun-line',
    accentColor: '#2563eb'
  },
  Tiendanube: {
    key: 'Tiendanube',
    filterValue: 'Tiendanube',
    label: 'Tiendanube',
    short: 'Tiendanube',
    icon: 'ri-cloud-line',
    accentColor: '#0369a1'
  },
  Manual: {
    key: 'Manual',
    filterValue: 'Manual',
    label: 'Manual / POS',
    short: 'Manual',
    icon: 'ri-file-list-3-line',
    accentColor: '#64748b'
  }
};

window.merchantsRadarState = {
  searchQuery: '',
  platformFilter: null,
  healthFilter: 'all', // 'all' | 'critical' | 'warning' | 'healthy'
  sortBy: 'orders_desc',
  displayMode: localStorage.getItem('wms_radar_display_mode') || 'cards', // 'cards' | 'table'
  showZeroOrderMerchants: localStorage.getItem('wms_radar_show_zero') === 'true',
  cardFiltersByMerchant: new Map(), // UPPER_NAME -> { platformKey: null|string, wmsStatus: null|string, incident: null|{actionType, actionValue, label} }
  metadataLoaded: false,
  isLoadingMetadata: false,
  lastMetadataLoadTs: 0,
  comerciosConfigMap: new Map(),
  integrationsByMerchant: new Map(),
  openIncidenciasByMerchant: new Map(),
  lastFlashedMerchantKey: null,
  lastRealtimeEventText: 'En vivo',
  isLoadingOrders: false,
  isBackgroundSyncing: false,
  loadingPresetKey: null,
  loadingPhaseText: '',
  loadingOrdersCount: 0,
  loadingRangeText: ''
};

window.notifyWmsOrdersFetchProgress = function(info = {}) {
  const st = window.merchantsRadarState;
  if (!st) return;

  const isFetching = Boolean(info.isFetching);
  const isBg = Boolean(info.isBackground);
  const count = Number(info.count || 0);
  const phase = info.phase || 'orders';

  if (!isFetching) {
    const wasLoading = st.isLoadingOrders || st.isBackgroundSyncing;
    st.isLoadingOrders = false;
    st.isBackgroundSyncing = false;
    st.loadingPresetKey = null;
    st.loadingPhaseText = '';
    st.loadingOrdersCount = count;
    if (wasLoading && window.wmsOrdersActiveSubView === 'merchants_radar') {
      window.renderMerchantsRadar();
    }
    return;
  }

  st.loadingOrdersCount = count;
  if (isBg) {
    st.isBackgroundSyncing = true;
    st.isLoadingOrders = false;
  } else {
    st.isLoadingOrders = true;
  }

  if (phase === 'init') {
    st.loadingPhaseText = 'Conectando y consultando pedidos del rango seleccionado...';
  } else if (phase === 'orders') {
    st.loadingPhaseText = count > 0
      ? `Descargando lotes de pedidos desde el servidor... ${count.toLocaleString('es-CL')} recibidos`
      : 'Consultando pedidos del periodo...';
  } else if (phase === 'hydrating') {
    st.loadingPhaseText = `Sincronizando stock, estados de picking y couriers para ${count.toLocaleString('es-CL')} pedidos...`;
  }

  // Si estamos en Radar de Comercios y aún no existe el banner en el DOM, renderizar de inmediato
  if (window.wmsOrdersActiveSubView === 'merchants_radar') {
    const phaseEl = document.getElementById('radar-loading-phase-text');
    const countEl = document.getElementById('radar-loading-count-badge');
    const pillEl = document.getElementById('radar-summary-loading-pill');

    if (st.isLoadingOrders && !phaseEl) {
      window.renderMerchantsRadar();
      return;
    }

    if (phaseEl) {
      phaseEl.textContent = st.loadingPhaseText;
    }
    if (countEl) {
      countEl.textContent = count > 0
        ? `${count.toLocaleString('es-CL')} pedidos descargados`
        : 'Consultando...';
    }
    if (pillEl) {
      pillEl.innerHTML = `<i class="ri-loader-4-line radar-spin-icon"></i> <span>${st.isBackgroundSyncing ? 'Sincronizando' : 'Cargando'}${count > 0 ? ` (${count.toLocaleString('es-CL')})` : '...'}</span>`;
    } else if (st.isBackgroundSyncing) {
      window.renderMerchantsRadar();
    }
  }
};

function escapeHtml(str) {
  if (window.escapeHtml) return window.escapeHtml(str);
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRelativeSync(dateStr) {
  if (!dateStr) return 'Canal activo';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Canal activo';
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMins < 1) return 'Sync hace instantes';
  if (diffMins < 60) return `Sync hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Sync hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Sync hace ${diffDays} d`;
}

export function normalizePlatformKey(rawPlatform, order = null) {
  const str = String(rawPlatform || order?.origen || order?.external_platform || 'Manual').trim();
  const low = str.toLowerCase();
  if (low.includes('shopify')) return 'Shopify';
  if (low.includes('meli') || low.includes('mercado')) return 'MercadoLibre';
  if (low.includes('falabella')) return 'Falabella';
  if (low.includes('woo')) return 'WooCommerce';
  if (low.includes('jumpseller')) return 'Jumpseller';
  if (low.includes('paris')) return 'Paris';
  if (low.includes('ripley')) return 'Ripley';
  if (low.includes('walmart')) return 'Walmart';
  if (low.includes('tiendanube')) return 'Tiendanube';
  return 'Manual';
}

function deriveSigla(merchantName, configuredSigla) {
  if (configuredSigla && configuredSigla !== 'SIN SIGLA') {
    return String(configuredSigla).trim().toUpperCase();
  }
  const map = window.wmsComerciosSiglasMap || {};
  const upper = String(merchantName || '').trim().toUpperCase();
  if (map[upper]) return map[upper];
  const words = upper.replace(/[^A-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0] + (words[2]?.[0] || words[1][1] || '')).slice(0, 3);
  }
  return upper.slice(0, 3) || 'COM';
}

// ============================================================================
// 1. CARGA Y SINCRONIZACIÓN DE METADATOS (COMERCIOS, INTEGRACIONES, INCIDENCIAS)
// ============================================================================
export async function loadRadarMetadata(force = false) {
  const st = window.merchantsRadarState;
  const now = Date.now();
  if (!force && st.metadataLoaded && (now - st.lastMetadataLoadTs < 60000)) {
    return;
  }
  if (st.isLoadingMetadata) return;
  st.isLoadingMetadata = true;

  try {
    const [comRes, intRes, incRes] = await Promise.all([
      supabase.from('v_comercios_config').select('nombre, sigla').order('nombre', { ascending: true }),
      supabase.from('merchant_integrations').select('id, platform, comercio, is_active, last_sync_at, last_sync_error, username'),
      supabase.from('incidencias').select('id, comercio, title, type, severity, status, created_at').eq('status', 'pendiente')
    ]);

    const comMap = new Map();
    if (comRes && Array.isArray(comRes.data)) {
      comRes.data.forEach(c => {
        if (!c.nombre) return;
        const cleanName = c.nombre.trim();
        const upper = cleanName.toUpperCase();
        comMap.set(upper, {
          nombre: cleanName,
          sigla: deriveSigla(cleanName, c.sigla)
        });
      });
    }

    if (Array.isArray(window.wmsAllComercios)) {
      window.wmsAllComercios.forEach(name => {
        if (!name) return;
        const cleanName = String(name).trim();
        const upper = cleanName.toUpperCase();
        if (!comMap.has(upper)) {
          comMap.set(upper, {
            nombre: cleanName,
            sigla: deriveSigla(cleanName, null)
          });
        }
      });
    }

    const intByMerchant = new Map();
    if (intRes && Array.isArray(intRes.data)) {
      intRes.data.forEach(row => {
        if (!row.comercio || row.comercio.toLowerCase() === 'no asignado') return;
        const upper = row.comercio.trim().toUpperCase();
        if (!intByMerchant.has(upper)) intByMerchant.set(upper, []);
        intByMerchant.get(upper).push({
          id: row.id,
          platformKey: normalizePlatformKey(row.platform),
          rawPlatform: row.platform,
          isActive: row.is_active !== false,
          lastSyncAt: row.last_sync_at || null,
          lastSyncError: row.last_sync_error || null
        });
      });
    }

    const incByMerchant = new Map();
    if (incRes && Array.isArray(incRes.data)) {
      incRes.data.forEach(inc => {
        if (!inc.comercio || inc.comercio.toLowerCase() === 'no asignado') return;
        const upper = inc.comercio.trim().toUpperCase();
        if (!incByMerchant.has(upper)) incByMerchant.set(upper, []);
        incByMerchant.get(upper).push(inc);
      });
    }

    st.comerciosConfigMap = comMap;
    st.integrationsByMerchant = intByMerchant;
    st.openIncidenciasByMerchant = incByMerchant;
    st.metadataLoaded = true;
    st.lastMetadataLoadTs = Date.now();

    initRadarRealtimeSubscriptions();
  } catch (err) {
    console.warn('[MerchantsRadar] Error cargando metadatos:', err);
  } finally {
    st.isLoadingMetadata = false;
  }
}

function initRadarRealtimeSubscriptions() {
  if (window._wmsRadarRealtimeChannel) return;
  try {
    const channel = supabase
      .channel('wms-radar-metadata-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_integrations' }, () => {
        loadRadarMetadata(true).then(() => {
          if (window.wmsOrdersActiveSubView === 'merchants_radar') {
            window.renderMerchantsRadar();
          }
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidencias' }, () => {
        loadRadarMetadata(true).then(() => {
          if (window.wmsOrdersActiveSubView === 'merchants_radar') {
            window.renderMerchantsRadar();
          }
        });
      })
      .subscribe();
    window._wmsRadarRealtimeChannel = channel;
  } catch (e) {
    console.warn('[MerchantsRadar] No se pudo suscribir canal realtime secundario:', e);
  }
}

// Helper que calcula métricas de estados e incidencias sobre un subconjunto de pedidos de un comercio
function aggregateOrdersSubset(ordersSubset, configuredPlatformsMap, openTickets, filterPlatformKey = null) {
  const states = {
    'En procesamiento': 0,
    'En preparación': 0,
    'Pickeado': 0,
    'Despachado': 0,
    'Incidencia': 0,
    'Cancelado': 0,
    'Archivado': 0
  };
  const b = {
    wmsIncidencia: 0,
    sinStock: 0,
    sobredemandaStock: 0,
    descuadreUds: 0,
    slaVencido: 0,
    slaHoy: 0,
    pickerObs: 0,
    pickingReqPendiente: 0,
    sinCobertura: 0,
    courierAlerta: 0
  };

  let totalOrders = 0;
  let eligibleAgendasCount = 0;

  for (let i = 0; i < ordersSubset.length; i++) {
    const order = ordersSubset[i];
    if (filterPlatformKey) {
      const pk = normalizePlatformKey(order.origen || order.external_platform, order);
      if (pk !== filterPlatformKey) continue;
    }

    totalOrders++;

    const wmsState = order.estado_wms || 'En procesamiento';
    if (Object.prototype.hasOwnProperty.call(states, wmsState)) {
      states[wmsState]++;
    } else {
      states['En procesamiento']++;
    }

    const stLower = String(order.status || '').toLowerCase();
    if (!['despachado', 'cancelado', 'entregado', 'retirado', 'archivado'].includes(stLower) &&
        !['Despachado', 'Cancelado', 'Archivado'].includes(wmsState)) {
      eligibleAgendasCount++;
    }

    if (wmsState !== 'Cancelado' && wmsState !== 'Archivado') {
      if (wmsState === 'Incidencia' || stLower === 'incidencia') {
        b.wmsIncidencia++;
      }

      const tags = typeof window.getOrderTags === 'function' ? window.getOrderTags(order) : [];
      const isDispatched = wmsState === 'Despachado';

      for (let t = 0; t < tags.length; t++) {
        const tag = tags[t];
        if (!isDispatched) {
          if (tag === 'SIN STOCK') b.sinStock++;
          else if (tag === 'SOBREDEMANDA STOCK') b.sobredemandaStock++;
          else if (tag === 'DESCUADRE UDS.') b.descuadreUds++;
          else if (tag === 'Picker: Con Obs' || tag === 'Picker: Parcial') b.pickerObs++;
          else if (tag === 'Solicitud Picking: Pendiente') b.pickingReqPendiente++;
          else if (tag === 'COBERTURA: Sin Asignar') b.sinCobertura++;
          else if (tag.startsWith('SLA:')) {
            const slaLow = tag.toLowerCase();
            if (slaLow.includes('vencido') || slaLow.includes('atrasado')) {
              b.slaVencido++;
            } else if (slaLow.includes('hoy')) {
              b.slaHoy++;
            }
          }
        }
        if (tag === 'ALERTA' || tag === 'DEVOLUCIÓN') {
          b.courierAlerta++;
        }
      }
    }
  }

  const activeOrdersCount = Math.max(0, totalOrders - states['Cancelado'] - states['Archivado']);
  const pendingOrders = states['En procesamiento'] + states['En preparación'];
  const fulfilledOrders = states['Pickeado'] + states['Despachado'];
  const fulfillmentPct = activeOrdersCount > 0 ? Math.round((fulfilledOrders / activeOrdersCount) * 100) : (totalOrders > 0 ? 100 : 0);

  const incidentsList = [];
  if (b.wmsIncidencia > 0) {
    incidentsList.push({ label: `${b.wmsIncidencia} Incidencia WMS`, count: b.wmsIncidencia, severity: 'critical', actionType: 'status', actionValue: 'Incidencia' });
  }
  if (b.sinStock > 0) {
    incidentsList.push({ label: `${b.sinStock} Sin stock`, count: b.sinStock, severity: 'critical', actionType: 'tag', actionValue: 'SIN STOCK' });
  }
  if (b.sobredemandaStock > 0) {
    incidentsList.push({ label: `${b.sobredemandaStock} Sobredemanda`, count: b.sobredemandaStock, severity: 'critical', actionType: 'tag', actionValue: 'SOBREDEMANDA STOCK' });
  }
  if (b.descuadreUds > 0) {
    incidentsList.push({ label: `${b.descuadreUds} Descuadre UDS`, count: b.descuadreUds, severity: 'critical', actionType: 'tag', actionValue: 'DESCUADRE UDS.' });
  }
  if (b.slaVencido > 0) {
    incidentsList.push({ label: `${b.slaVencido} SLA vencido`, count: b.slaVencido, severity: 'critical', actionType: 'sla_any', actionValue: 'SLA' });
  }

  configuredPlatformsMap.forEach(cp => {
    if (filterPlatformKey && cp.key !== filterPlatformKey) return;
    if (cp.hasError) {
      const pDef = PLATFORM_DEFINITIONS[cp.key] || PLATFORM_DEFINITIONS.Manual;
      incidentsList.push({ label: `API ${pDef.short}`, count: 1, severity: 'critical', actionType: 'platform', actionValue: cp.key, tooltip: cp.lastSyncError });
    }
  });

  if (b.slaHoy > 0) {
    incidentsList.push({ label: `${b.slaHoy} SLA hoy`, count: b.slaHoy, severity: 'warning', actionType: 'sla_any', actionValue: 'SLA' });
  }
  if (b.pickerObs > 0) {
    incidentsList.push({ label: `${b.pickerObs} Obs. Picker`, count: b.pickerObs, severity: 'warning', actionType: 'tag', actionValue: 'Picker: Con Obs' });
  }
  if (b.pickingReqPendiente > 0) {
    incidentsList.push({ label: `${b.pickingReqPendiente} Solic. Picking`, count: b.pickingReqPendiente, severity: 'warning', actionType: 'tag', actionValue: 'Solicitud Picking: Pendiente' });
  }
  if (b.sinCobertura > 0) {
    incidentsList.push({ label: `${b.sinCobertura} Sin cobertura`, count: b.sinCobertura, severity: 'warning', actionType: 'tag', actionValue: 'COBERTURA: Sin Asignar' });
  }
  if (b.courierAlerta > 0) {
    incidentsList.push({ label: `${b.courierAlerta} Alerta courier`, count: b.courierAlerta, severity: 'warning', actionType: 'tag', actionValue: 'ALERTA' });
  }
  if (!filterPlatformKey && openTickets.length > 0) {
    incidentsList.push({ label: `${openTickets.length} Ticket${openTickets.length === 1 ? '' : 's'}`, count: openTickets.length, severity: 'warning', actionType: 'incidencias_module', actionValue: '' });
  }

  const criticalCount = incidentsList.filter(i => i.severity === 'critical').reduce((acc, it) => acc + it.count, 0);
  const warningCount = incidentsList.filter(i => i.severity === 'warning').reduce((acc, it) => acc + it.count, 0);
  const totalIncidentsCount = criticalCount + warningCount;

  return {
    totalOrders,
    activeOrdersCount,
    pendingOrders,
    fulfilledOrders,
    fulfillmentPct,
    eligibleAgendasCount,
    states,
    incidentsList,
    criticalCount,
    warningCount,
    totalIncidentsCount
  };
}

// ============================================================================
// 2. MOTOR DE CÁLCULO Y AGREGACIÓN EN TIEMPO REAL POR COMERCIO
// ============================================================================
export function computeMerchantsRadarSummary() {
  const st = window.merchantsRadarState;
  const allLoadedOrders = Array.isArray(window.loadedOrders) ? window.loadedOrders : [];

  const dateFromInput = document.getElementById('filter-date-from');
  const dateToInput = document.getElementById('filter-date-to');
  const dateFrom = dateFromInput?.value || window.lastFetchedDateFrom || '';
  const dateTo = dateToInput?.value || window.lastFetchedDateTo || '';

  const ordersInPeriod = allLoadedOrders.filter(order => {
    if (!dateFrom && !dateTo) return true;
    if (!order.created_at) return false;
    let orderDateStr = order._wmsDateStr;
    if (!orderDateStr) {
      const d = new Date(order.created_at);
      if (isNaN(d.getTime())) return false;
      orderDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      order._wmsDateStr = orderDateStr;
    }
    if (dateFrom && orderDateStr < dateFrom) return false;
    if (dateTo && orderDateStr > dateTo) return false;
    return true;
  });

  const merchantsMap = new Map();

  const ensureMerchantEntry = (rawName) => {
    const clean = String(rawName || '').trim();
    if (!clean || clean.toLowerCase() === 'no asignado') return null;
    const upper = clean.toUpperCase();
    if (!merchantsMap.has(upper)) {
      const cfg = st.comerciosConfigMap.get(upper);
      merchantsMap.set(upper, {
        key: upper,
        nombre: cfg ? cfg.nombre : clean,
        sigla: cfg ? cfg.sigla : deriveSigla(clean, null),
        orders: [],
        platformCounts: {},
        configuredPlatforms: new Map(),
        openTickets: st.openIncidenciasByMerchant.get(upper) || []
      });
    }
    return merchantsMap.get(upper);
  };

  st.comerciosConfigMap.forEach((cfg) => {
    ensureMerchantEntry(cfg.nombre);
  });

  st.integrationsByMerchant.forEach((intList, upperKey) => {
    const entry = ensureMerchantEntry(upperKey);
    if (!entry) return;
    intList.forEach(intItem => {
      const pk = intItem.platformKey;
      const existing = entry.configuredPlatforms.get(pk);
      const hasErr = Boolean(intItem.lastSyncError && String(intItem.lastSyncError).trim());
      if (!existing) {
        entry.configuredPlatforms.set(pk, {
          key: pk,
          isActive: intItem.isActive,
          hasError: hasErr,
          lastSyncAt: intItem.lastSyncAt,
          lastSyncError: intItem.lastSyncError
        });
      } else {
        existing.isActive = existing.isActive || intItem.isActive;
        existing.hasError = existing.hasError || hasErr;
        if (intItem.lastSyncAt && (!existing.lastSyncAt || intItem.lastSyncAt > existing.lastSyncAt)) {
          existing.lastSyncAt = intItem.lastSyncAt;
        }
        if (hasErr && !existing.lastSyncError) {
          existing.lastSyncError = intItem.lastSyncError;
        }
      }
    });
  });

  const globalPlatformCounts = {};

  for (let i = 0; i < ordersInPeriod.length; i++) {
    const order = ordersInPeriod[i];
    const entry = ensureMerchantEntry(order.comercio || 'SIN COMERCIO');
    if (!entry) continue;

    entry.orders.push(order);

    const platKey = normalizePlatformKey(order.origen || order.external_platform, order);
    entry.platformCounts[platKey] = (entry.platformCounts[platKey] || 0) + 1;
    globalPlatformCounts[platKey] = (globalPlatformCounts[platKey] || 0) + 1;

    if (!entry.configuredPlatforms.has(platKey)) {
      entry.configuredPlatforms.set(platKey, {
        key: platKey,
        isActive: true,
        hasError: false,
        lastSyncAt: order.created_at,
        lastSyncError: null,
        inferredFromOrders: true
      });
    }
  }

  let allMerchantsList = [];
  let zeroOrderMerchantsCount = 0;

  merchantsMap.forEach((m) => {
    // Métricas globales del comercio (todos sus canales en el periodo)
    const overall = aggregateOrdersSubset(m.orders, m.configuredPlatforms, m.openTickets, null);

    // Verificar si la tarjeta tiene un canal seleccionado localmente (o si hay un filtro global de plataforma activo)
    const cardFilter = st.cardFiltersByMerchant.get(m.key) || { platformKey: null, wmsStatus: null, incident: null };
    const effectiveCardPlatform = cardFilter.platformKey || st.platformFilter || null;
    const displayed = effectiveCardPlatform
      ? aggregateOrdersSubset(m.orders, m.configuredPlatforms, m.openTickets, effectiveCardPlatform)
      : overall;

    let health = 'healthy';
    if (overall.totalOrders === 0 && overall.totalIncidentsCount === 0) {
      health = 'idle';
    } else if (overall.criticalCount > 0) {
      health = 'critical';
    } else if (overall.warningCount > 0 || (overall.activeOrdersCount >= 5 && (overall.pendingOrders / overall.activeOrdersCount) > 0.45)) {
      health = 'warning';
    }

    const channelsList = Array.from(m.configuredPlatforms.values()).map(cp => {
      const def = PLATFORM_DEFINITIONS[cp.key] || PLATFORM_DEFINITIONS.Manual;
      const count = m.platformCounts[cp.key] || 0;
      const sharePct = overall.totalOrders > 0 ? Math.round((count / overall.totalOrders) * 100) : 0;
      return {
        ...cp,
        def,
        count,
        sharePct
      };
    }).sort((a, b) => (b.count - a.count) || a.def.label.localeCompare(b.def.label));

    if (overall.totalOrders === 0) {
      zeroOrderMerchantsCount++;
    }

    allMerchantsList.push({
      key: m.key,
      nombre: m.nombre,
      sigla: m.sigla,
      orders: m.orders,
      health,
      channelsList,
      cardFilter,
      effectiveCardPlatform,
      // Datos totales del comercio
      totalOrders: overall.totalOrders,
      activeOrdersCount: overall.activeOrdersCount,
      pendingOrders: overall.pendingOrders,
      fulfilledOrders: overall.fulfilledOrders,
      fulfillmentPct: overall.fulfillmentPct,
      eligibleAgendasCount: overall.eligibleAgendasCount,
      states: overall.states,
      incidentsList: overall.incidentsList,
      criticalCount: overall.criticalCount,
      warningCount: overall.warningCount,
      totalIncidentsCount: overall.totalIncidentsCount,
      // Datos mostrados actualmente en la tarjeta (según canal seleccionado en la tarjeta)
      displayed
    });
  });

  const merchantsWithOrdersCount = allMerchantsList.filter(m => m.totalOrders > 0).length;
  let globalTotalOrders = 0;
  let globalPendingOrders = 0;
  let globalFulfilledOrders = 0;
  let globalIncidentsTotal = 0;
  let globalIncidentsMerchants = 0;

  allMerchantsList.forEach(m => {
    globalTotalOrders += m.totalOrders;
    globalPendingOrders += m.pendingOrders;
    globalFulfilledOrders += m.fulfilledOrders;
    if (m.totalIncidentsCount > 0) {
      globalIncidentsTotal += m.totalIncidentsCount;
      globalIncidentsMerchants++;
    }
  });

  const radarTabBadge = document.getElementById('radar-tab-count');
  if (radarTabBadge) {
    radarTabBadge.textContent = `${merchantsWithOrdersCount} activos`;
  }

  let visibleMerchants = allMerchantsList.filter(m => {
    if (!st.showZeroOrderMerchants && m.totalOrders === 0 && m.totalIncidentsCount === 0) {
      return false;
    }
    if (st.searchQuery) {
      const q = st.searchQuery.toLowerCase();
      const matchName = m.nombre.toLowerCase().includes(q) || m.sigla.toLowerCase().includes(q);
      if (!matchName) return false;
    }
    if (st.platformFilter) {
      const hasPlat = m.channelsList.some(ch => ch.key === st.platformFilter && (ch.count > 0 || st.showZeroOrderMerchants));
      if (!hasPlat) return false;
    }
    if (st.healthFilter !== 'all') {
      if (st.healthFilter === 'critical' && m.health !== 'critical') return false;
      if (st.healthFilter === 'warning' && m.health !== 'warning') return false;
      if (st.healthFilter === 'healthy' && m.health !== 'healthy') return false;
    }
    return true;
  });

  visibleMerchants.sort((a, b) => {
    if (st.sortBy === 'orders_desc') {
      return (b.totalOrders - a.totalOrders) || a.nombre.localeCompare(b.nombre);
    }
    if (st.sortBy === 'incidents_desc') {
      return (b.criticalCount - a.criticalCount) || (b.totalIncidentsCount - a.totalIncidentsCount) || (b.totalOrders - a.totalOrders);
    }
    if (st.sortBy === 'pending_desc') {
      return (b.pendingOrders - a.pendingOrders) || (b.totalOrders - a.totalOrders);
    }
    if (st.sortBy === 'sla_asc') {
      if (a.totalOrders === 0 && b.totalOrders > 0) return 1;
      if (b.totalOrders === 0 && a.totalOrders > 0) return -1;
      return (a.fulfillmentPct - b.fulfillmentPct) || (b.pendingOrders - a.pendingOrders);
    }
    return a.nombre.localeCompare(b.nombre);
  });

  return {
    dateFrom,
    dateTo,
    allMerchantsList,
    visibleMerchants,
    zeroOrderMerchantsCount,
    merchantsWithOrdersCount,
    totalConfiguredMerchants: allMerchantsList.length,
    globalTotalOrders,
    globalPendingOrders,
    globalFulfilledOrders,
    globalIncidentsTotal,
    globalIncidentsMerchants,
    globalPlatformCounts
  };
}

// ============================================================================
// 3. RENDERIZADO PRINCIPAL DEL RADAR DE COMERCIOS (MINIMALISTA Y SOBRIO)
// ============================================================================
window.renderMerchantsRadar = async function() {
  const container = document.getElementById('subview-merchants-radar');
  if (!container) return;

  const st = window.merchantsRadarState;
  if (!st.metadataLoaded && !st.isLoadingMetadata) {
    loadRadarMetadata(false).then(() => {
      if (window.wmsOrdersActiveSubView === 'merchants_radar') {
        window.renderMerchantsRadar();
      }
    });
  }

  const summary = computeMerchantsRadarSummary();
  const activePreset = window.wmsActiveDatePreset || '7days';
  const rangeLabel = window.formatWmsDateRangeSummary
    ? window.formatWmsDateRangeSummary(summary.dateFrom, summary.dateTo)
    : `${summary.dateFrom || 'Inicio'} - ${summary.dateTo || 'Hoy'}`;

  const pendingPct = summary.globalTotalOrders > 0
    ? Math.round((summary.globalPendingOrders / summary.globalTotalOrders) * 100)
    : 0;
  const fulfilledPct = summary.globalTotalOrders > 0
    ? Math.round((summary.globalFulfilledOrders / summary.globalTotalOrders) * 100)
    : 0;

  const hadSearchFocus = document.activeElement && document.activeElement.id === 'radar-search-merchant-input';
  const selectionStart = hadSearchFocus ? document.activeElement.selectionStart : null;

  container.innerHTML = `
    <!-- Franja Ejecutiva de Resumen -->
    <div class="radar-summary-strip">
      <div class="radar-summary-item clickable" onclick="window.setRadarHealthFilter('all')">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;">
          <span class="radar-summary-label">Total Pedidos</span>
          ${(st.isLoadingOrders || st.isBackgroundSyncing) ? `
            <span id="radar-summary-loading-pill" class="radar-summary-loading-pill">
              <i class="ri-loader-4-line radar-spin-icon"></i>
              <span>${st.isBackgroundSyncing ? 'Sincronizando' : 'Cargando'}${st.loadingOrdersCount > 0 ? ` (${st.loadingOrdersCount.toLocaleString('es-CL')})` : '...'}</span>
            </span>
          ` : ''}
        </div>
        <div class="radar-summary-value-row">
          <span class="radar-summary-value" style="${st.isLoadingOrders ? 'opacity: 0.55;' : ''}">${summary.globalTotalOrders.toLocaleString('es-CL')}</span>
          <span class="radar-summary-sub">${escapeHtml(st.loadingRangeText && st.isLoadingOrders ? st.loadingRangeText : rangeLabel)}</span>
        </div>
      </div>

      <div class="radar-summary-item clickable" onclick="window.toggleRadarZeroOrders()">
        <span class="radar-summary-label">Comercios Activos</span>
        <div class="radar-summary-value-row">
          <span class="radar-summary-value">${summary.merchantsWithOrdersCount}</span>
          <span class="radar-summary-sub">de ${summary.totalConfiguredMerchants} tiendas</span>
        </div>
      </div>

      <div class="radar-summary-item clickable" onclick="window.setRadarSortBy('pending_desc')">
        <span class="radar-summary-label">Por Procesar / Prep.</span>
        <div class="radar-summary-value-row">
          <span class="radar-summary-value">${summary.globalPendingOrders.toLocaleString('es-CL')}</span>
          <span class="radar-summary-sub">${pendingPct}% del total</span>
        </div>
      </div>

      <div class="radar-summary-item clickable" onclick="window.setRadarSortBy('orders_desc')">
        <span class="radar-summary-label">Pickeado + Despachado</span>
        <div class="radar-summary-value-row">
          <span class="radar-summary-value">${summary.globalFulfilledOrders.toLocaleString('es-CL')}</span>
          <span class="radar-summary-sub" style="color: #059669; font-weight: 600;">${fulfilledPct}% avance</span>
        </div>
      </div>

      <div class="radar-summary-item clickable" onclick="window.setRadarHealthFilter('critical')">
        <span class="radar-summary-label">Alertas por Revisar</span>
        <div class="radar-summary-value-row">
          <span class="radar-summary-value" style="${summary.globalIncidentsTotal > 0 ? 'color: #dc2626;' : ''}">${summary.globalIncidentsTotal}</span>
          <span class="radar-summary-sub">en ${summary.globalIncidentsMerchants} tiendas</span>
        </div>
      </div>
    </div>

    <!-- Barra de Herramientas Unificada y Sobria -->
    <div class="radar-toolbar">
      <div class="radar-toolbar-row">
        <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
          <div class="radar-segmented">
            <button type="button" class="radar-seg-btn ${activePreset === 'today' ? 'active' : ''}" onclick="window.setRadarPeriodPreset('today')">
              ${st.isLoadingOrders && st.loadingPresetKey === 'today' ? '<i class="ri-loader-4-line radar-spin-icon"></i> ' : ''}Hoy
            </button>
            <button type="button" class="radar-seg-btn ${activePreset === 'yesterday' ? 'active' : ''}" onclick="window.setRadarPeriodPreset('yesterday')">
              ${st.isLoadingOrders && st.loadingPresetKey === 'yesterday' ? '<i class="ri-loader-4-line radar-spin-icon"></i> ' : ''}Ayer
            </button>
            <button type="button" class="radar-seg-btn ${activePreset === '7days' ? 'active' : ''}" onclick="window.setRadarPeriodPreset('7days')">
              ${st.isLoadingOrders && st.loadingPresetKey === '7days' ? '<i class="ri-loader-4-line radar-spin-icon"></i> ' : ''}7 días
            </button>
            <button type="button" class="radar-seg-btn ${activePreset === '14days' ? 'active' : ''}" onclick="window.setRadarPeriodPreset('14days')">
              ${st.isLoadingOrders && st.loadingPresetKey === '14days' ? '<i class="ri-loader-4-line radar-spin-icon"></i> ' : ''}14 días
            </button>
            <button type="button" class="radar-seg-btn ${activePreset === '30days' ? 'active' : ''}" onclick="window.setRadarPeriodPreset('30days')">
              ${st.isLoadingOrders && st.loadingPresetKey === '30days' ? '<i class="ri-loader-4-line radar-spin-icon"></i> ' : ''}30 días
            </button>
            <button type="button" class="radar-seg-btn ${activePreset === 'month' ? 'active' : ''}" onclick="window.setRadarPeriodPreset('month')">
              ${st.isLoadingOrders && st.loadingPresetKey === 'month' ? '<i class="ri-loader-4-line radar-spin-icon"></i> ' : ''}Este mes
            </button>
          </div>

          <div style="display: inline-flex; align-items: center; gap: 0.25rem; background: var(--color-bg); padding: 0.16rem 0.45rem; border-radius: 7px; border: 1px solid var(--color-border);">
            <input type="date" id="radar-custom-date-from" value="${escapeHtml(summary.dateFrom)}" style="border: none; background: transparent; color: var(--color-text-main); font-size: 0.73rem; font-weight: 500; outline: none;" />
            <span style="color: var(--color-text-muted); font-size: 0.7rem;">—</span>
            <input type="date" id="radar-custom-date-to" value="${escapeHtml(summary.dateTo)}" style="border: none; background: transparent; color: var(--color-text-main); font-size: 0.73rem; font-weight: 500; outline: none;" />
            <button type="button" onclick="window.applyRadarCustomDates()" style="padding: 0.14rem 0.45rem; font-size: 0.71rem; font-weight: 600; background: var(--color-surface); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: 5px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
              ${st.isLoadingOrders && st.loadingPresetKey === 'custom' ? '<i class="ri-loader-4-line radar-spin-icon" style="color: var(--color-primary);"></i>' : ''}
              <span>Aplicar</span>
            </button>
          </div>
        </div>

        <!-- Filtros Globales por Canal -->
        <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
          <button type="button" class="radar-channel-filter-chip ${!st.platformFilter ? 'active' : ''}" onclick="window.toggleRadarPlatformFilter(null)">
            <span>Todos los canales</span>
          </button>
          ${Object.values(PLATFORM_DEFINITIONS).map(def => {
            const count = summary.globalPlatformCounts[def.key] || 0;
            const hasAnyConfigured = summary.allMerchantsList.some(m => m.channelsList.some(c => c.key === def.key));
            if (count === 0 && !hasAnyConfigured) return '';
            const isSelected = st.platformFilter === def.key;
            return `
              <button type="button" class="radar-channel-filter-chip ${isSelected ? 'active' : ''}" onclick="window.toggleRadarPlatformFilter('${def.key}')">
                <i class="${def.icon}" style="color: ${isSelected ? 'inherit' : def.accentColor};"></i>
                <span>${escapeHtml(def.short)}</span>
                <span style="opacity: 0.7;">${count}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <div class="radar-toolbar-row divider">
        <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; flex: 1;">
          <div style="position: relative; min-width: 210px; max-width: 260px; flex: 1;">
            <i class="ri-search-line" style="position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); font-size: 0.85rem;"></i>
            <input type="text" id="radar-search-merchant-input" value="${escapeHtml(st.searchQuery)}" oninput="window.handleRadarSearchInput(this.value)" placeholder="Buscar comercio o sigla..." style="width: 100%; padding: 0.32rem 1.6rem 0.32rem 1.85rem; font-size: 0.78rem; border-radius: 7px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); outline: none;" />
            ${st.searchQuery ? `
              <button type="button" onclick="window.handleRadarSearchInput('')" style="position: absolute; right: 0.4rem; top: 50%; transform: translateY(-50%); border: none; background: transparent; color: var(--color-text-muted); cursor: pointer; font-size: 0.9rem;">
                <i class="ri-close-line"></i>
              </button>
            ` : ''}
          </div>

          <div class="radar-segmented">
            <button type="button" class="radar-seg-btn ${st.healthFilter === 'all' ? 'active' : ''}" onclick="window.setRadarHealthFilter('all')">Todos</button>
            <button type="button" class="radar-seg-btn ${st.healthFilter === 'critical' ? 'active' : ''}" onclick="window.setRadarHealthFilter('critical')">
              <span class="radar-inc-dot critical"></span> Con alertas
            </button>
            <button type="button" class="radar-seg-btn ${st.healthFilter === 'warning' ? 'active' : ''}" onclick="window.setRadarHealthFilter('warning')">
              <span class="radar-inc-dot warning"></span> En seguimiento
            </button>
            <button type="button" class="radar-seg-btn ${st.healthFilter === 'healthy' ? 'active' : ''}" onclick="window.setRadarHealthFilter('healthy')">
              Al día
            </button>
          </div>

          <label style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.74rem; font-weight: 500; color: var(--color-text-muted); cursor: pointer; user-select: none; padding: 0.2rem 0.4rem;">
            <input type="checkbox" ${st.showZeroOrderMerchants ? 'checked' : ''} onchange="window.toggleRadarZeroOrders(this.checked)" style="accent-color: var(--color-primary); width: 13px; height: 13px; cursor: pointer;" />
            <span>Incluir sin pedidos (${summary.zeroOrderMerchantsCount})</span>
          </label>
        </div>

        <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
          <select onchange="window.setRadarSortBy(this.value)" style="padding: 0.3rem 0.55rem; font-size: 0.75rem; font-weight: 500; border-radius: 7px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); outline: none; cursor: pointer;">
            <option value="orders_desc" ${st.sortBy === 'orders_desc' ? 'selected' : ''}>Orden: Mayor volumen</option>
            <option value="pending_desc" ${st.sortBy === 'pending_desc' ? 'selected' : ''}>Orden: Más pendientes</option>
            <option value="incidents_desc" ${st.sortBy === 'incidents_desc' ? 'selected' : ''}>Orden: Más alertas</option>
            <option value="sla_asc" ${st.sortBy === 'sla_asc' ? 'selected' : ''}>Orden: Menor % avance</option>
            <option value="name_asc" ${st.sortBy === 'name_asc' ? 'selected' : ''}>Orden: Alfabético (A-Z)</option>
          </select>

          <div class="radar-segmented">
            <button type="button" class="radar-seg-btn ${st.displayMode === 'cards' ? 'active' : ''}" onclick="window.setRadarDisplayMode('cards')" title="Vista de Tarjetas">
              <i class="ri-layout-grid-line"></i> Tarjetas
            </button>
            <button type="button" class="radar-seg-btn ${st.displayMode === 'table' ? 'active' : ''}" onclick="window.setRadarDisplayMode('table')" title="Vista de Tabla">
              <i class="ri-table-line"></i> Tabla
            </button>
          </div>

          <button type="button" onclick="window.exportMerchantsRadarCsv()" class="radar-seg-btn" style="border: 1px solid var(--color-border); background: var(--color-bg); padding: 0.28rem 0.6rem;" title="Descargar CSV / Excel">
            <i class="ri-download-2-line"></i> Exportar
          </button>

          <button type="button" onclick="window.refreshMerchantsRadarManual(this)" class="radar-seg-btn" style="border: 1px solid var(--color-border); background: var(--color-bg); padding: 0.28rem 0.6rem;" title="Refrescar datos">
            <i class="ri-refresh-line ${(st.isLoadingOrders || st.isBackgroundSyncing) ? 'radar-spin-icon' : ''}" id="radar-refresh-icon"></i>
          </button>
        </div>
      </div>
    </div>

    ${st.isLoadingOrders ? `
      <div class="radar-loading-banner" id="radar-loading-banner">
        <div class="radar-loading-banner-top">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <div class="radar-loading-spinner-ring"></div>
            <div>
              <div style="font-size: 0.82rem; font-weight: 700; color: var(--color-text-main);">
                Cargando pedidos del periodo (${escapeHtml(st.loadingRangeText || rangeLabel)})...
              </div>
              <div id="radar-loading-phase-text" style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.1rem;">
                ${escapeHtml(st.loadingPhaseText || 'Consultando pedidos en el servidor...')}
              </div>
            </div>
          </div>
          <span id="radar-loading-count-badge" class="radar-summary-loading-pill" style="font-size: 0.73rem; padding: 0.2rem 0.6rem;">
            ${st.loadingOrdersCount > 0 ? `${st.loadingOrdersCount.toLocaleString('es-CL')} pedidos descargados` : 'Consultando...'}
          </span>
        </div>
        <div class="radar-loading-bar-track">
          <div class="radar-loading-bar-fill"></div>
        </div>
      </div>
    ` : ''}

    <!-- Resultados -->
    <div id="radar-merchants-results" class="${st.isLoadingOrders ? 'radar-results-dimmed' : ''}">
      ${renderRadarMerchantsContent(summary)}
    </div>
  `;

  if (hadSearchFocus) {
    const input = document.getElementById('radar-search-merchant-input');
    if (input) {
      input.focus();
      if (typeof selectionStart === 'number') {
        input.setSelectionRange(selectionStart, selectionStart);
      }
    }
  }
};

function renderRadarMerchantsContent(summary) {
  const st = window.merchantsRadarState;
  const list = summary.visibleMerchants;

  if (list.length === 0) {
    return `
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 2.5rem 1.5rem; text-align: center; box-shadow: var(--shadow-sm);">
        <p style="margin: 0 0 0.75rem 0; font-size: 0.88rem; font-weight: 600; color: var(--color-text-main);">No hay comercios que coincidan con el filtro actual</p>
        <div style="display: inline-flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center;">
          <button type="button" onclick="window.resetRadarFilters()" class="btn btn-outline" style="padding: 0.35rem 0.8rem; font-size: 0.78rem; cursor: pointer;">
            Restablecer filtros
          </button>
          ${!st.showZeroOrderMerchants && summary.zeroOrderMerchantsCount > 0 ? `
            <button type="button" onclick="window.toggleRadarZeroOrders(true)" class="btn btn-outline" style="padding: 0.35rem 0.8rem; font-size: 0.78rem; cursor: pointer;">
              Mostrar comercios con 0 pedidos (${summary.zeroOrderMerchantsCount})
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  if (st.displayMode === 'table') {
    return renderRadarMatrixTable(list);
  }
  return renderRadarCardsGrid(list);
}

function renderRadarCardsGrid(merchants) {
  const st = window.merchantsRadarState;
  return `
    <div class="radar-cards-grid">
      ${merchants.map(m => {
        // Usar las métricas de `m.displayed` (que reflejan el canal seleccionado en la tarjeta, o el total si no hay canal seleccionado)
        const d = m.displayed;
        const total = d.totalOrders;
        const pending = d.states['En procesamiento'] + d.states['En preparación'];
        const picked = d.states['Pickeado'];
        const dispatched = d.states['Despachado'];

        const pPend = total > 0 ? (pending / total) * 100 : 0;
        const pPick = total > 0 ? (picked / total) * 100 : 0;
        const pDesp = total > 0 ? (dispatched / total) * 100 : 0;

        const isFlashed = st.lastFlashedMerchantKey === m.key;
        const jsMerchantKey = escapeHtml(m.key).replace(/'/g, "\\'");
        const jsMerchantName = escapeHtml(m.nombre).replace(/'/g, "\\'");

        const procCount = d.states['En procesamiento'];
        const prepCount = d.states['En preparación'];
        const pickCount = d.states['Pickeado'];
        const despCount = d.states['Despachado'];
        const incCount  = d.states['Incidencia'];

        const activePlatKey = m.effectiveCardPlatform;
        const activePlatDef = activePlatKey ? (PLATFORM_DEFINITIONS[activePlatKey] || PLATFORM_DEFINITIONS.Manual) : null;
        const activeStatus = m.cardFilter?.wmsStatus || null;
        const activeIncident = m.cardFilter?.incident || null;
        const hasAnyCardSelection = Boolean(activePlatKey || activeStatus || activeIncident);

        // Construir etiqueta contextual para el botón "Ver pedidos ›"
        const filterSummaryParts = [];
        if (activePlatDef) filterSummaryParts.push(activePlatDef.short);
        if (activeStatus) filterSummaryParts.push(activeStatus);
        if (activeIncident) filterSummaryParts.push(activeIncident.label);
        const verPedidosLabel = filterSummaryParts.length > 0
          ? `Ver pedidos (${filterSummaryParts.join(' · ')})`
          : 'Ver pedidos';

        return `
          <div class="radar-merchant-card ${m.health === 'idle' ? 'is-idle' : ''} ${isFlashed ? 'radar-flash-highlight' : ''}" data-merchant-key="${escapeHtml(m.key)}">
            
            <!-- Zona 1: Cabecera Limpia (Comercio a la izquierda | Total Pedidos a la derecha) + Canales a todo el ancho -->
            <div style="display: flex; flex-direction: column; gap: 0.45rem;">
              <div class="radar-card-header">
                <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; min-width: 0; flex: 1;">
                  <span class="radar-sigla-badge">${escapeHtml(m.sigla)}</span>
                  <h4 class="radar-merchant-title" onclick="window.clearRadarCardFilters('${jsMerchantKey}')" title="${hasAnyCardSelection ? 'Clic para restablecer filtros de esta tarjeta' : escapeHtml(m.nombre)}">${escapeHtml(m.nombre)}</h4>
                  ${hasAnyCardSelection ? `
                    <button type="button" onclick="window.clearRadarCardFilters('${jsMerchantKey}')" style="font-size: 0.68rem; font-weight: 600; color: var(--color-primary); background: rgba(79, 70, 229, 0.08); border: none; border-radius: 4px; padding: 0.1rem 0.4rem; cursor: pointer;" title="Volver a ver todos los canales y estados en esta tarjeta">
                      Todos (${m.totalOrders}) ✕
                    </button>
                  ` : ''}
                </div>

                <div style="text-align: right; flex-shrink: 0;">
                  <div style="font-size: 1.35rem; font-weight: 700; color: var(--color-text-main); line-height: 1.05;">
                    ${d.totalOrders.toLocaleString('es-CL')}
                  </div>
                  <div style="font-size: 0.69rem; color: var(--color-text-muted); margin-top: 0.1rem;">
                    ${activePlatDef ? `${escapeHtml(activePlatDef.short)} · ` : ''}${d.totalOrders > 0 ? `${d.fulfillmentPct}% despachado` : '0 pedidos'}
                  </div>
                </div>
              </div>

              <!-- Canales activos: distribuidos en fila horizontal a todo el ancho -->
              <div class="radar-card-channels">
                ${m.channelsList.length > 0 ? m.channelsList.map(ch => {
                  const isChanActive = activePlatKey === ch.key;
                  const syncTip = ch.hasError
                    ? `Error de sincronización: ${ch.lastSyncError}`
                    : `Clic para ver en esta tarjeta solo el estado de los ${ch.count} pedidos de ${ch.def.label}`;
                  return `
                    <button type="button" class="radar-plat-tag ${isChanActive ? 'active' : ''}" onclick="window.toggleRadarCardPlatform('${jsMerchantKey}', '${ch.key}')" title="${escapeHtml(syncTip)}">
                      <i class="${ch.def.icon}" style="color: ${isChanActive ? 'var(--color-primary)' : ch.def.accentColor}; font-size: 0.82rem;"></i>
                      <span>${escapeHtml(ch.def.short)}</span>
                      <span class="plat-count">${ch.count}</span>
                      ${ch.hasError
                        ? `<span class="radar-inc-dot critical" title="Error API"></span>`
                        : ''
                      }
                    </button>
                  `;
                }).join('') : `
                  <span style="font-size: 0.71rem; color: var(--color-text-muted);">Sin integraciones activas</span>
                `}
              </div>
            </div>

            <!-- Zona 2: Barra minimalista de 4px + Tira Unificada de Estados WMS (se actualiza al elegir plataforma) -->
            <div style="display: flex; flex-direction: column; gap: 0.38rem;">
              <div class="radar-thin-progress" title="${d.fulfilledOrders} de ${d.activeOrdersCount} listos/enviados (${d.fulfillmentPct}%)">
                <div style="width: ${pDesp}%; background: #10b981;"></div>
                <div style="width: ${pPick}%; background: #60a5fa;"></div>
                <div style="width: ${pPend}%; background: #94a3b8;"></div>
              </div>

              <div class="radar-states-strip">
                <button type="button" class="radar-state-cell ${activeStatus === 'En procesamiento' ? 'active' : ''}" onclick="window.toggleRadarCardStatus('${jsMerchantKey}', 'En procesamiento')" title="Seleccionar estado: En procesamiento (${procCount})">
                  <span class="radar-state-label">Procesar</span>
                  <span class="radar-state-num ${procCount === 0 ? 'is-zero' : ''}">${procCount}</span>
                </button>
                <button type="button" class="radar-state-cell ${activeStatus === 'En preparación' ? 'active' : ''}" onclick="window.toggleRadarCardStatus('${jsMerchantKey}', 'En preparación')" title="Seleccionar estado: En preparación (${prepCount})">
                  <span class="radar-state-label">Preparación</span>
                  <span class="radar-state-num ${prepCount === 0 ? 'is-zero' : ''}">${prepCount}</span>
                </button>
                <button type="button" class="radar-state-cell ${activeStatus === 'Pickeado' ? 'active' : ''}" onclick="window.toggleRadarCardStatus('${jsMerchantKey}', 'Pickeado')" title="Seleccionar estado: Pickeado (${pickCount})">
                  <span class="radar-state-label">Pickeado</span>
                  <span class="radar-state-num ${pickCount === 0 ? 'is-zero' : ''}">${pickCount}</span>
                </button>
                <button type="button" class="radar-state-cell ${activeStatus === 'Despachado' ? 'active' : ''}" onclick="window.toggleRadarCardStatus('${jsMerchantKey}', 'Despachado')" title="Seleccionar estado: Despachado (${despCount})">
                  <span class="radar-state-label">Despachado</span>
                  <span class="radar-state-num ${despCount === 0 ? 'is-zero' : ''}">${despCount}</span>
                </button>
                <button type="button" class="radar-state-cell ${activeStatus === 'Incidencia' ? 'active' : ''}" onclick="window.toggleRadarCardStatus('${jsMerchantKey}', 'Incidencia')" title="Seleccionar estado: Incidencia WMS (${incCount})">
                  <span class="radar-state-label">Incidencia</span>
                  <span class="radar-state-num ${incCount === 0 ? 'is-zero' : 'is-alert'}">${incCount}</span>
                </button>
              </div>
            </div>

            <!-- Zona 3: Cápsulas de Alertas distribuidas horizontalmente a todo el ancho -->
            <div class="radar-card-alerts-row">
              ${d.incidentsList.length > 0 ? d.incidentsList.map(inc => {
                const isIncActive = activeIncident && activeIncident.actionType === inc.actionType && activeIncident.actionValue === inc.actionValue;
                const jsVal = escapeHtml(inc.actionValue || '').replace(/'/g, "\\'");
                const jsLbl = escapeHtml(inc.label || '').replace(/'/g, "\\'");
                return `
                  <button type="button" class="radar-inc-chip ${isIncActive ? 'active' : ''}" onclick="window.toggleRadarCardIncident('${jsMerchantKey}', '${inc.actionType}', '${jsVal}', '${jsLbl}')" title="${escapeHtml(inc.tooltip || 'Clic para seleccionar esta alerta y luego ir con Ver pedidos')}">
                    <span class="radar-inc-dot ${inc.severity}"></span>
                    <span>${escapeHtml(inc.label)}</span>
                  </button>
                `;
              }).join('') : `
                <span style="font-size: 0.72rem; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-check-line" style="color: #10b981;"></i> Sin alertas pendientes
                </span>
              `}
            </div>

            <!-- Zona 4: Borde Inferior de Acciones a todo el ancho de la tarjeta -->
            <div class="radar-card-actions-bar">
              <button type="button" class="radar-action-link" onclick="window.openRadarQuickSummaryModal('${jsMerchantKey}')" title="Abrir modal con resumen de estos pedidos (# pedido, fecha, SLA, cobertura y plataforma)">
                <i class="ri-file-list-3-line"></i>
                <span>Vista resumida</span>
              </button>
              ${d.eligibleAgendasCount > 0 ? `
                <button type="button" class="radar-action-link" onclick="window.radarDrillDownToAgendas('${jsMerchantName}')" title="Abrir en Gestión de Agendas">
                  <i class="ri-calendar-check-line"></i>
                  <span>Agendas (${d.eligibleAgendasCount})</span>
                </button>
              ` : ''}
              <button type="button" class="radar-action-link primary-action ${hasAnyCardSelection ? 'has-filter' : ''}" onclick="window.openMerchantFromRadarCard('${jsMerchantKey}', '${jsMerchantName}')">
                <span>${escapeHtml(verPedidosLabel)}</span>
                <i class="ri-arrow-right-s-line"></i>
              </button>
            </div>

          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderRadarMatrixTable(merchants) {
  return `
    <div class="radar-table-card">
      <div style="overflow-x: auto;">
        <table class="radar-matrix-table">
          <thead>
            <tr>
              <th>Comercio</th>
              <th>Canales Activos</th>
              <th style="text-align: right;">Total</th>
              <th style="text-align: right;">Procesar</th>
              <th style="text-align: right;">Preparación</th>
              <th style="text-align: right;">Pickeado</th>
              <th style="text-align: right;">Despachado</th>
              <th style="text-align: right;">Incidencia</th>
              <th style="text-align: right;">Avance</th>
              <th>Alertas por Revisar</th>
              <th style="text-align: right;"></th>
            </tr>
          </thead>
          <tbody>
            ${merchants.map(m => {
              const d = m.displayed;
              const jsMerchantKey = escapeHtml(m.key).replace(/'/g, "\\'");
              const jsMerchantName = escapeHtml(m.nombre).replace(/'/g, "\\'");
              const activePlatKey = m.effectiveCardPlatform;
              const proc = d.states['En procesamiento'];
              const prep = d.states['En preparación'];
              const pick = d.states['Pickeado'];
              const desp = d.states['Despachado'];
              const inc  = d.states['Incidencia'];

              return `
                <tr>
                  <td style="white-space: nowrap; font-weight: 600;">
                    <span class="radar-sigla-badge" style="margin-right: 0.35rem;">${escapeHtml(m.sigla)}</span>
                    <span>${escapeHtml(m.nombre)}</span>
                  </td>
                  <td>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.28rem;">
                      ${m.channelsList.map(ch => {
                        const isChanActive = activePlatKey === ch.key;
                        return `
                          <button type="button" class="radar-plat-tag ${isChanActive ? 'active' : ''}" onclick="window.toggleRadarCardPlatform('${jsMerchantKey}', '${ch.key}')">
                            <i class="${ch.def.icon}" style="color: ${isChanActive ? 'var(--color-primary)' : ch.def.accentColor};"></i>
                            <span>${escapeHtml(ch.def.short)}</span>
                            <span class="plat-count">${ch.count}</span>
                          </button>
                        `;
                      }).join('')}
                    </div>
                  </td>
                  <td style="text-align: right; font-weight: 700;">${d.totalOrders}</td>
                  <td style="text-align: right; ${proc === 0 ? 'color: var(--color-text-muted); opacity: 0.4;' : 'font-weight: 600;'}">${proc}</td>
                  <td style="text-align: right; ${prep === 0 ? 'color: var(--color-text-muted); opacity: 0.4;' : 'font-weight: 600;'}">${prep}</td>
                  <td style="text-align: right; ${pick === 0 ? 'color: var(--color-text-muted); opacity: 0.4;' : 'font-weight: 600;'}">${pick}</td>
                  <td style="text-align: right; ${desp === 0 ? 'color: var(--color-text-muted); opacity: 0.4;' : 'font-weight: 600;'}">${desp}</td>
                  <td style="text-align: right; ${inc === 0 ? 'color: var(--color-text-muted); opacity: 0.4;' : 'color: #dc2626; font-weight: 700;'}">${inc}</td>
                  <td style="text-align: right; font-weight: 600; color: var(--color-text-muted);">${d.fulfillmentPct}%</td>
                  <td>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
                      ${d.incidentsList.length > 0 ? d.incidentsList.map(incItem => {
                        const jsVal = escapeHtml(incItem.actionValue || '').replace(/'/g, "\\'");
                        const jsLbl = escapeHtml(incItem.label || '').replace(/'/g, "\\'");
                        return `
                          <button type="button" class="radar-inc-chip" onclick="window.toggleRadarCardIncident('${jsMerchantKey}', '${incItem.actionType}', '${jsVal}', '${jsLbl}')">
                            <span class="radar-inc-dot ${incItem.severity}"></span>
                            <span>${escapeHtml(incItem.label)}</span>
                          </button>
                        `;
                      }).join('') : `<span style="color: var(--color-text-muted); font-size: 0.72rem;">—</span>`}
                    </div>
                  </td>
                  <td style="text-align: right; white-space: nowrap;">
                    <div style="display: inline-flex; align-items: center; gap: 0.25rem;">
                      <button type="button" class="radar-action-link" onclick="window.openRadarQuickSummaryModal('${jsMerchantKey}')" title="Vista resumida en modal">
                        <i class="ri-file-list-3-line"></i>
                        <span>Resumen</span>
                      </button>
                      <span style="color: var(--color-border);">·</span>
                      <button type="button" class="radar-action-link" onclick="window.openMerchantFromRadarCard('${jsMerchantKey}', '${jsMerchantName}')">
                        <span>Ver pedidos</span>
                        <i class="ri-arrow-right-s-line"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================================
// 4. INTERACCIONES IN-CARD Y PUENTE DRILL-DOWN CON "VER PEDIDOS"
// ============================================================================
function ensureCardFilterObj(merchantKey) {
  const st = window.merchantsRadarState;
  if (!st.cardFiltersByMerchant.has(merchantKey)) {
    st.cardFiltersByMerchant.set(merchantKey, {
      platformKey: null,
      wmsStatus: null,
      incident: null
    });
  }
  return st.cardFiltersByMerchant.get(merchantKey);
}

window.toggleRadarCardPlatform = function(merchantKey, platformKey) {
  const cf = ensureCardFilterObj(merchantKey);
  cf.platformKey = cf.platformKey === platformKey ? null : platformKey;
  window.renderMerchantsRadar();
};

window.toggleRadarCardStatus = function(merchantKey, wmsStatus) {
  const cf = ensureCardFilterObj(merchantKey);
  cf.wmsStatus = cf.wmsStatus === wmsStatus ? null : wmsStatus;
  if (cf.wmsStatus) {
    cf.incident = null; // Desactivar alerta si elige un estado específico
  }
  window.renderMerchantsRadar();
};

window.toggleRadarCardIncident = function(merchantKey, actionType, actionValue, label) {
  const cf = ensureCardFilterObj(merchantKey);
  const isSame = cf.incident && cf.incident.actionType === actionType && cf.incident.actionValue === actionValue;
  if (isSame) {
    cf.incident = null;
  } else {
    cf.incident = { actionType, actionValue, label };
    if (actionType === 'status') {
      cf.wmsStatus = actionValue;
    } else {
      cf.wmsStatus = null;
    }
  }
  window.renderMerchantsRadar();
};

window.clearRadarCardFilters = function(merchantKey) {
  window.merchantsRadarState.cardFiltersByMerchant.delete(merchantKey);
  window.renderMerchantsRadar();
};

window.openMerchantFromRadarCard = function(merchantKey, merchantName) {
  const st = window.merchantsRadarState;
  const cf = st.cardFiltersByMerchant.get(merchantKey) || { platformKey: null, wmsStatus: null, incident: null };
  const effectivePlatKey = cf.platformKey || st.platformFilter || null;
  const origenFilter = effectivePlatKey && PLATFORM_DEFINITIONS[effectivePlatKey]
    ? PLATFORM_DEFINITIONS[effectivePlatKey].filterValue
    : null;

  // Si seleccionó un ticket del módulo de incidencias
  if (cf.incident && cf.incident.actionType === 'incidencias_module') {
    const navLink = document.querySelector('[data-view="incidencias_admin"]');
    if (navLink) navLink.click();
    return;
  }

  let wmsTab = cf.wmsStatus || 'Todos';
  let tagFilter = null;

  if (cf.incident) {
    if (cf.incident.actionType === 'status') {
      wmsTab = cf.incident.actionValue || 'Incidencia';
    } else if (cf.incident.actionType === 'tag') {
      tagFilter = cf.incident.actionValue;
    } else if (cf.incident.actionType === 'sla_any') {
      const orders = (window.loadedOrders || []).filter(o => o.comercio === merchantName);
      for (let i = 0; i < orders.length; i++) {
        const tags = typeof window.getOrderTags === 'function' ? window.getOrderTags(orders[i]) : [];
        const found = tags.find(t => t.startsWith('SLA:'));
        if (found) {
          tagFilter = found;
          break;
        }
      }
    }
  }

  window.radarDrillDownToTower(merchantName, origenFilter, wmsTab, tagFilter);
};

function computePresetDateStrings(presetKey) {
  const now = new Date();
  const formatYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let fromStr = '';
  let toStr = formatYMD(now);

  if (presetKey === 'today') {
    fromStr = toStr;
  } else if (presetKey === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    fromStr = formatYMD(d);
    toStr = fromStr;
  } else if (presetKey === '7days') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    fromStr = formatYMD(d);
  } else if (presetKey === '14days') {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    fromStr = formatYMD(d);
  } else if (presetKey === '30days') {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    fromStr = formatYMD(d);
  } else if (presetKey === 'month') {
    fromStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }
  return { fromStr, toStr };
}

window.setRadarPeriodPreset = async function(presetKey) {
  const st = window.merchantsRadarState;
  const { fromStr, toStr } = computePresetDateStrings(presetKey);
  const hasRangeInMemory = window.loadedOrders && window.loadedOrders.length > 0 &&
    window.lastFetchedDateFrom && window.lastFetchedDateTo &&
    fromStr >= window.lastFetchedDateFrom && toStr <= window.lastFetchedDateTo;

  window.wmsActiveDatePreset = presetKey;

  if (!hasRangeInMemory) {
    st.isLoadingOrders = true;
    st.loadingPresetKey = presetKey;
    st.loadingOrdersCount = 0;
    st.loadingRangeText = window.formatWmsDateRangeSummary
      ? window.formatWmsDateRangeSummary(fromStr, toStr)
      : `${fromStr} - ${toStr}`;
    st.loadingPhaseText = 'Consultando pedidos del periodo seleccionado...';
    window.renderMerchantsRadar();
    // Ceder un frame al navegador para pintar el estado de carga antes de iniciar la consulta
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  try {
    if (typeof window.setWmsDatePreset === 'function') {
      await window.setWmsDatePreset(presetKey);
    }
  } finally {
    st.isLoadingOrders = false;
    st.loadingPresetKey = null;
    st.loadingRangeText = '';
    window.renderMerchantsRadar();
  }
};

window.applyRadarCustomDates = async function() {
  const st = window.merchantsRadarState;
  const fromEl = document.getElementById('radar-custom-date-from');
  const toEl = document.getElementById('radar-custom-date-to');
  const fromVal = fromEl?.value || '';
  const toVal = toEl?.value || '';

  const towerFrom = document.getElementById('filter-date-from');
  const towerTo = document.getElementById('filter-date-to');
  if (towerFrom) towerFrom.value = fromVal;
  if (towerTo) towerTo.value = toVal;

  const hasRangeInMemory = fromVal && toVal && window.loadedOrders && window.loadedOrders.length > 0 &&
    window.lastFetchedDateFrom && window.lastFetchedDateTo &&
    fromVal >= window.lastFetchedDateFrom && toVal <= window.lastFetchedDateTo;

  window.wmsActiveDatePreset = null;

  if (!hasRangeInMemory) {
    st.isLoadingOrders = true;
    st.loadingPresetKey = 'custom';
    st.loadingOrdersCount = 0;
    st.loadingRangeText = window.formatWmsDateRangeSummary
      ? window.formatWmsDateRangeSummary(fromVal, toVal)
      : `${fromVal} - ${toVal}`;
    st.loadingPhaseText = 'Consultando pedidos del rango personalizado...';
    window.renderMerchantsRadar();
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  try {
    const summaryText = document.getElementById('wms-date-range-summary-text');
    if (summaryText && window.formatWmsDateRangeSummary) {
      summaryText.textContent = window.formatWmsDateRangeSummary(fromVal, toVal);
    }
    document.querySelectorAll('.wms-date-preset-btn').forEach(btn => btn.classList.remove('active'));

    if (!hasRangeInMemory && typeof window.fetchWmsOrdersData === 'function' && (fromVal || toVal)) {
      window.lastFetchedDateFrom = fromVal || null;
      window.lastFetchedDateTo = toVal || null;
      await window.fetchWmsOrdersData(fromVal, toVal);
      if (window.updateMerchantFilterOptions) window.updateMerchantFilterOptions();
      if (window.updateOrderTagFilterOptions) window.updateOrderTagFilterOptions();
    }
    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
    }
  } finally {
    st.isLoadingOrders = false;
    st.loadingPresetKey = null;
    st.loadingRangeText = '';
    window.renderMerchantsRadar();
  }
};

window.toggleRadarPlatformFilter = function(platformKey) {
  const st = window.merchantsRadarState;
  st.platformFilter = st.platformFilter === platformKey ? null : platformKey;
  window.renderMerchantsRadar();
};

window.setRadarHealthFilter = function(healthKey) {
  window.merchantsRadarState.healthFilter = healthKey;
  window.renderMerchantsRadar();
};

window.toggleRadarZeroOrders = function(explicitVal) {
  const st = window.merchantsRadarState;
  st.showZeroOrderMerchants = typeof explicitVal === 'boolean' ? explicitVal : !st.showZeroOrderMerchants;
  localStorage.setItem('wms_radar_show_zero', String(st.showZeroOrderMerchants));
  window.renderMerchantsRadar();
};

window.setRadarSortBy = function(sortKey) {
  window.merchantsRadarState.sortBy = sortKey;
  window.renderMerchantsRadar();
};

window.setRadarDisplayMode = function(mode) {
  window.merchantsRadarState.displayMode = mode;
  localStorage.setItem('wms_radar_display_mode', mode);
  window.renderMerchantsRadar();
};

window.handleRadarSearchInput = function(val) {
  window.merchantsRadarState.searchQuery = val || '';
  window.renderMerchantsRadar();
};

window.resetRadarFilters = function() {
  const st = window.merchantsRadarState;
  st.searchQuery = '';
  st.platformFilter = null;
  st.healthFilter = 'all';
  st.cardFiltersByMerchant.clear();
  window.renderMerchantsRadar();
};

window.refreshMerchantsRadarManual = async function(btn) {
  const icon = document.getElementById('radar-refresh-icon');
  if (icon) icon.classList.add('spin');
  if (btn) btn.disabled = true;
  try {
    const dateFrom = document.getElementById('filter-date-from')?.value || window.lastFetchedDateFrom;
    const dateTo = document.getElementById('filter-date-to')?.value || window.lastFetchedDateTo;
    await Promise.all([
      loadRadarMetadata(true),
      typeof window.fetchWmsOrdersData === 'function' ? window.fetchWmsOrdersData(dateFrom, dateTo) : Promise.resolve()
    ]);
    window.renderMerchantsRadar();
  } finally {
    if (icon) icon.classList.remove('spin');
    if (btn) btn.disabled = false;
  }
};

window.radarDrillDownToTower = function(merchantName, origenFilter, wmsTab, tagFilter) {
  const searchInput = document.getElementById('search-orders');
  if (searchInput) searchInput.value = '';
  window.wmsMultiselectText = '';
  window.wmsColumnFilters = {};
  window.wmsActiveSlaFilter = null;
  window.wmsActiveDeliveryTypeFilter = null;
  window.wmsActiveCoverageFilter = null;

  const merchantSelect = document.getElementById('filter-merchant');
  if (merchantSelect) {
    if (merchantName) {
      let exists = false;
      for (let i = 0; i < merchantSelect.options.length; i++) {
        if (merchantSelect.options[i].value === merchantName) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = merchantName;
        opt.textContent = merchantName;
        merchantSelect.appendChild(opt);
      }
      merchantSelect.value = merchantName;
    } else {
      merchantSelect.value = '';
    }
  }

  const origenSelect = document.getElementById('filter-origen');
  if (origenSelect) {
    origenSelect.value = origenFilter || '';
  }

  const tagSelect = document.getElementById('filter-order-tag');
  if (tagSelect) {
    if (tagFilter) {
      let exists = false;
      for (let i = 0; i < tagSelect.options.length; i++) {
        if (tagSelect.options[i].value === tagFilter) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = tagFilter;
        opt.textContent = `🏷️ ${tagFilter}`;
        tagSelect.appendChild(opt);
      }
      tagSelect.value = tagFilter;
      if (tagFilter.startsWith('SLA:')) {
        window.wmsActiveSlaFilter = tagFilter.replace(/^SLA:\s*/, '').trim();
      } else if (tagFilter === 'COBERTURA: Sin Asignar') {
        window.wmsActiveCoverageFilter = 'SIN_ASIGNAR';
      }
    } else {
      tagSelect.value = '';
    }
  }

  window.wmsActiveTab = wmsTab || 'Todos';
  window.wmsCurrentPage = 1;

  if (typeof window.switchOrdersSubView === 'function') {
    window.switchOrdersSubView('control_tower');
  }
};

window.radarDrillDownToAgendas = function(merchantName) {
  if (window.agendasGridState) {
    window.agendasGridState.searchQuery = '';
    window.agendasGridState.columnFilters = merchantName
      ? { comercio: new Set([merchantName]) }
      : {};
  }
  if (typeof window.switchOrdersSubView === 'function') {
    window.switchOrdersSubView('agendas_grid');
  }
};

window.exportMerchantsRadarCsv = function() {
  const summary = computeMerchantsRadarSummary();
  const rows = [
    ['Sigla', 'Comercio', 'Total Pedidos', 'En Procesamiento', 'En Preparacion', 'Pickeado', 'Despachado', 'Incidencia', 'Cancelado', '% Avance Despacho', 'Alertas por Revisar', 'Canales Activos']
  ];

  summary.visibleMerchants.forEach(m => {
    const platsStr = m.channelsList.map(c => `${c.def.label}: ${c.count}`).join(' | ');
    const incsStr = m.incidentsList.map(i => i.label).join(' | ') || 'Al dia';
    rows.push([
      m.sigla,
      m.nombre,
      m.totalOrders,
      m.states['En procesamiento'],
      m.states['En preparación'],
      m.states['Pickeado'],
      m.states['Despachado'],
      m.states['Incidencia'],
      m.states['Cancelado'],
      `${m.fulfillmentPct}%`,
      incsStr,
      platsStr
    ]);
  });

  const csvContent = '\uFEFF' + rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `radar_comercios_${summary.dateFrom || 'hoy'}_al_${summary.dateTo || 'hoy'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ============================================================================
// 5. MODAL DE VISTA RESUMIDA DE PEDIDOS POR COMERCIO
// ============================================================================
window.radarQuickModalState = {
  merchantKey: null,
  platformKey: null,
  wmsStatus: null,
  incident: null,
  searchQuery: ''
};

function formatShortOrderDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getRadarOrderPaymentInfo(order) {
  if (!order) {
    return { label: 'Pendiente', badgeClass: 'pay-pending', icon: 'ri-time-line' };
  }
  let rawFin = String(order.raw_shopify_data?.financial_status || order.payment_status || '').toLowerCase().trim();
  const platKey = normalizePlatformKey(order.origen || order.external_platform, order);
  const isMarketplace = ['Falabella', 'MercadoLibre', 'Paris', 'Ripley', 'Walmart'].includes(platKey);
  if (isMarketplace && order.status !== 'cancelado') {
    if (!['refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado'].includes(rawFin)) {
      rawFin = 'paid';
    }
  }

  if (['paid', 'pagado', 'completed', 'approved', 'confirmed', 'cobrado'].includes(rawFin)) {
    return { label: 'Pagado', badgeClass: 'pay-paid', icon: 'ri-checkbox-circle-line' };
  }
  if (['authorized', 'autorizado'].includes(rawFin)) {
    return { label: 'Autorizado', badgeClass: 'pay-auth', icon: 'ri-check-line' };
  }
  if (['partially_refunded', 'parcialmente_reembolsado'].includes(rawFin)) {
    return { label: 'Reemb. Parcial', badgeClass: 'pay-refund', icon: 'ri-refund-line' };
  }
  if (['refunded', 'reembolsado'].includes(rawFin)) {
    return { label: 'Reembolsado', badgeClass: 'pay-refund', icon: 'ri-refund-line' };
  }
  if (['voided', 'anulado', 'cancelado', 'cancelled', 'failed', 'fallido'].includes(rawFin)) {
    return { label: 'Anulado', badgeClass: 'pay-refund', icon: 'ri-close-circle-line' };
  }
  if (['partially_paid', 'parcialmente_pagado'].includes(rawFin)) {
    return { label: 'Pago Parcial', badgeClass: 'pay-pending', icon: 'ri-time-line' };
  }
  if (['pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar', 'on-hold', 'on_hold', ''].includes(rawFin)) {
    return { label: 'Pendiente', badgeClass: 'pay-pending', icon: 'ri-time-line' };
  }
  return { label: String(order.payment_status || 'Pendiente'), badgeClass: 'pay-pending', icon: 'ri-time-line' };
}

function getRadarMeliDeliverySubType(order) {
  if (!order) return null;
  const platKey = normalizePlatformKey(order.origen || order.external_platform, order);
  if (platKey !== 'MercadoLibre') return null;

  const delivInfo = typeof window.getOrderDeliveryTypeInfo === 'function' ? window.getOrderDeliveryTypeInfo(order) : null;
  const methodUpper = String(order.shipping_method || '').toUpperCase();
  const agendaUpper = String(order.agenda || '').toUpperCase();
  const courierUpper = String(order.courier || '').toUpperCase();
  const rawMeliObj = Array.isArray(order.raw_meli_data) ? order.raw_meli_data[0] : order.raw_meli_data;
  const rawMeliLogistic = String(
    rawMeliObj?.shipping?.logistic_type ||
    rawMeliObj?.orders?.[0]?.shipping?.logistic_type ||
    order.shipping_type ||
    ''
  ).toLowerCase();

  if (
    delivInfo?.key === 'FLEX' ||
    methodUpper.includes('FLEX') ||
    agendaUpper.includes('FLEX') ||
    courierUpper.includes('FLEX') ||
    rawMeliLogistic === 'self_service' ||
    rawMeliLogistic === 'flex'
  ) {
    return {
      key: 'FLEX',
      label: 'FLEX',
      badgeClass: 'meli-flex',
      icon: 'ri-flashlight-fill'
    };
  }

  if (delivInfo?.key === 'MELI_FULL' || rawMeliLogistic === 'fulfillment' || methodUpper.includes('FULL')) {
    return {
      key: 'FULL',
      label: 'FULL',
      badgeClass: 'meli-full',
      icon: 'ri-flashlight-line'
    };
  }

  if (delivInfo?.key === 'MELI_RETIRO' || methodUpper.includes('RETIRO') || agendaUpper.includes('RETIRO') || methodUpper.includes('ACORDAR')) {
    return {
      key: 'RETIRO',
      label: 'RETIRO',
      badgeClass: 'meli-retiro',
      icon: 'ri-store-2-line'
    };
  }

  return {
    key: 'CENTRO_ENVIOS',
    label: 'CENTRO DE ENVÍOS',
    badgeClass: 'meli-ce',
    icon: 'ri-community-line'
  };
}

window.openRadarQuickSummaryModal = function(merchantKey) {
  const st = window.merchantsRadarState;
  const cf = st.cardFiltersByMerchant.get(merchantKey) || { platformKey: null, wmsStatus: null, incident: null };
  window.radarQuickModalState = {
    merchantKey,
    platformKey: cf.platformKey || st.platformFilter || null,
    wmsStatus: cf.wmsStatus || null,
    incident: cf.incident || null,
    searchQuery: ''
  };
  window.renderRadarQuickSummaryModal();
};

window.closeRadarQuickSummaryModal = function() {
  const existing = document.getElementById('radar-quick-summary-modal');
  if (existing) existing.remove();
};

window.setRadarModalPlatform = function(platKey) {
  const ms = window.radarQuickModalState;
  ms.platformKey = ms.platformKey === platKey ? null : platKey;
  window.renderRadarQuickSummaryModal(true);
};

window.setRadarModalStatus = function(statusVal) {
  const ms = window.radarQuickModalState;
  ms.wmsStatus = ms.wmsStatus === statusVal ? null : statusVal;
  if (ms.wmsStatus) ms.incident = null;
  window.renderRadarQuickSummaryModal(true);
};

window.handleRadarModalSearch = function(val) {
  window.radarQuickModalState.searchQuery = val || '';
  window.renderRadarQuickSummaryModal(true);
};

function getFilteredModalOrders(merchantEntry) {
  const ms = window.radarQuickModalState;
  const rawOrders = merchantEntry?.orders || [];
  const q = (ms.searchQuery || '').trim().toLowerCase();

  return rawOrders.filter(order => {
    if (ms.platformKey) {
      const pk = normalizePlatformKey(order.origen || order.external_platform, order);
      if (pk !== ms.platformKey) return false;
    }
    if (ms.wmsStatus) {
      const stWms = order.estado_wms || 'En procesamiento';
      if (stWms !== ms.wmsStatus) return false;
    }
    if (ms.incident) {
      const tags = typeof window.getOrderTags === 'function' ? window.getOrderTags(order) : [];
      if (ms.incident.actionType === 'tag' && !tags.includes(ms.incident.actionValue)) return false;
      if (ms.incident.actionType === 'status' && (order.estado_wms || '') !== ms.incident.actionValue) return false;
      if (ms.incident.actionType === 'sla_any' && !tags.some(t => t.startsWith('SLA:'))) return false;
    }
    if (q) {
      const extNo = String(order.external_order_number || order.id || '').toLowerCase();
      const city = String(order.shipping_city || '').toLowerCase();
      const cust = String(order.customer_name || '').toLowerCase();
      const payLbl = getRadarOrderPaymentInfo(order).label.toLowerCase();
      const meliSub = getRadarMeliDeliverySubType(order);
      const meliLbl = meliSub ? meliSub.label.toLowerCase() : '';
      if (!extNo.includes(q) && !city.includes(q) && !cust.includes(q) && !payLbl.includes(q) && !meliLbl.includes(q)) return false;
    }
    return true;
  });
}

window.copyRadarModalOrderNumbers = function(btn) {
  const summary = computeMerchantsRadarSummary();
  const ms = window.radarQuickModalState;
  const m = summary.allMerchantsList.find(x => x.key === ms.merchantKey);
  if (!m) return;
  const filtered = getFilteredModalOrders(m);
  const nums = filtered.map(o => o.external_order_number || o.id).filter(Boolean);
  if (nums.length === 0) return;

  navigator.clipboard.writeText(nums.join('\n')).then(() => {
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `<i class="ri-check-line" style="color: #10b981;"></i> Copiados (${nums.length})`;
      setTimeout(() => { btn.innerHTML = orig; }, 1800);
    }
  });
};

window.openTowerFromRadarModal = function() {
  const summary = computeMerchantsRadarSummary();
  const ms = window.radarQuickModalState;
  const m = summary.allMerchantsList.find(x => x.key === ms.merchantKey);
  if (!m) return;

  // Sincronizar la selección del modal con la tarjeta y abrir Torre de Control
  window.merchantsRadarState.cardFiltersByMerchant.set(ms.merchantKey, {
    platformKey: ms.platformKey,
    wmsStatus: ms.wmsStatus,
    incident: ms.incident
  });
  window.closeRadarQuickSummaryModal();
  window.openMerchantFromRadarCard(ms.merchantKey, m.nombre);
};

window.renderRadarQuickSummaryModal = function(preserveSearchFocus = false) {
  const summary = computeMerchantsRadarSummary();
  const ms = window.radarQuickModalState;
  const m = summary.allMerchantsList.find(x => x.key === ms.merchantKey);
  if (!m) return;

  const filteredOrders = getFilteredModalOrders(m);

  let backdrop = document.getElementById('radar-quick-summary-modal');
  const hadFocus = preserveSearchFocus && document.activeElement && document.activeElement.id === 'radar-modal-search-input';
  const selPos = hadFocus ? document.activeElement.selectionStart : null;

  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'radar-quick-summary-modal';
    backdrop.className = 'radar-modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) window.closeRadarQuickSummaryModal();
    });
    document.body.appendChild(backdrop);
  }

  const statesList = ['En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia'];

  backdrop.innerHTML = `
    <div class="radar-modal-dialog">
      <!-- Cabecera del Modal -->
      <div class="radar-modal-header">
        <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
          <span class="radar-sigla-badge">${escapeHtml(m.sigla)}</span>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text-main);">${escapeHtml(m.nombre)}</h3>
          <span style="font-size: 0.78rem; color: var(--color-text-muted);">· Vista resumida (${filteredOrders.length} de ${m.totalOrders} pedidos)</span>
        </div>
        <button type="button" onclick="window.closeRadarQuickSummaryModal()" style="border: none; background: transparent; color: var(--color-text-muted); font-size: 1.25rem; cursor: pointer; line-height: 1; padding: 0.2rem;" title="Cerrar">
          <i class="ri-close-line"></i>
        </button>
      </div>

      <!-- Barra de Filtros Rápidos del Modal -->
      <div class="radar-modal-filterbar">
        <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
          <button type="button" class="radar-plat-tag ${!ms.platformKey ? 'active' : ''}" onclick="window.setRadarModalPlatform(null)">
            <span>Todos</span>
            <span class="plat-count">${m.totalOrders}</span>
          </button>
          ${m.channelsList.map(ch => {
            const isAct = ms.platformKey === ch.key;
            return `
              <button type="button" class="radar-plat-tag ${isAct ? 'active' : ''}" onclick="window.setRadarModalPlatform('${ch.key}')">
                <i class="${ch.def.icon}" style="color: ${isAct ? 'var(--color-primary)' : ch.def.accentColor};"></i>
                <span>${escapeHtml(ch.def.short)}</span>
                <span class="plat-count">${ch.count}</span>
              </button>
            `;
          }).join('')}
        </div>

        <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
          <div class="radar-segmented">
            <button type="button" class="radar-seg-btn ${!ms.wmsStatus ? 'active' : ''}" onclick="window.setRadarModalStatus(null)">Todos</button>
            ${statesList.map(stName => {
              const shortLbl = stName === 'En procesamiento' ? 'Procesar' : stName === 'En preparación' ? 'Prep.' : stName;
              return `
                <button type="button" class="radar-seg-btn ${ms.wmsStatus === stName ? 'active' : ''}" onclick="window.setRadarModalStatus('${stName}')">${shortLbl}</button>
              `;
            }).join('')}
          </div>

          <input type="text" id="radar-modal-search-input" value="${escapeHtml(ms.searchQuery)}" oninput="window.handleRadarModalSearch(this.value)" placeholder="Buscar # pedido o comuna..." style="padding: 0.26rem 0.6rem; font-size: 0.75rem; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); outline: none; width: 175px;" />
        </div>
      </div>

      <!-- Tabla Resumida de Pedidos -->
      <div class="radar-modal-body">
        ${filteredOrders.length === 0 ? `
          <div style="padding: 3rem 1.5rem; text-align: center; color: var(--color-text-muted); font-size: 0.84rem;">
            No hay pedidos que coincidan con este criterio en el rango seleccionado.
          </div>
        ` : `
          <table class="radar-matrix-table">
            <thead style="position: sticky; top: 0; z-index: 2;">
              <tr>
                <th># Pedido</th>
                <th>Plataforma</th>
                <th>Fecha Pedido</th>
                <th>Fecha SLA</th>
                <th>Cobertura / Comuna</th>
                <th>Estado Pago</th>
                <th>Estado WMS</th>
              </tr>
            </thead>
            <tbody>
              ${filteredOrders.map(order => {
                const orderNum = order.external_order_number || order.id || '—';
                const platKey = normalizePlatformKey(order.origen || order.external_platform, order);
                const pDef = PLATFORM_DEFINITIONS[platKey] || PLATFORM_DEFINITIONS.Manual;
                const meliSubType = getRadarMeliDeliverySubType(order);

                // SLA Info
                const slaInfo = typeof window.getOrderSlaInfo === 'function' ? window.getOrderSlaInfo(order) : null;
                const slaText = slaInfo && slaInfo.hasSla
                  ? `${slaInfo.date}${slaInfo.time ? ' ' + slaInfo.time : ''}`
                  : null;

                // Cobertura Info
                const covInfo = typeof window.getOrderCoverageInfo === 'function' ? window.getOrderCoverageInfo(order) : null;
                const comunaStr = (order.shipping_city || '').trim() || 'Sin comuna';
                let covClass = 'cov-none';
                let covShort = 'Sin Asignar';
                if (covInfo) {
                  if (covInfo.key === 'RM') {
                    covClass = 'cov-rm';
                    covShort = 'RM';
                  } else if (covInfo.key === 'REGIONES') {
                    covClass = 'cov-reg';
                    covShort = 'Regiones';
                  }
                }

                // Pago Info
                const payInfo = getRadarOrderPaymentInfo(order);

                const wmsState = order.estado_wms || 'En procesamiento';
                const isInc = wmsState === 'Incidencia';

                return `
                  <tr>
                    <td style="font-weight: 700; white-space: nowrap;">
                      <a href="#" onclick="event.preventDefault(); if (typeof window.openOrderInNewTab === 'function') { window.openOrderInNewTab('${escapeHtml(order.id)}', true); }" style="color: var(--color-text-main); text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;" title="Abrir ficha 360° del pedido en nueva pestaña">
                        <span>#${escapeHtml(String(orderNum).replace(/^#/, ''))}</span>
                        <i class="ri-external-link-line" style="font-size: 0.75rem; color: var(--color-text-muted);"></i>
                      </a>
                    </td>
                    <td style="white-space: nowrap;">
                      <div style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        <span style="display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.76rem; font-weight: 500;">
                          <i class="${pDef.icon}" style="color: ${pDef.accentColor};"></i>
                          <span>${escapeHtml(pDef.short)}</span>
                        </span>
                        ${meliSubType ? `
                          <span class="radar-meli-type-badge ${meliSubType.badgeClass}">
                            <i class="${meliSubType.icon}"></i>
                            <span>${escapeHtml(meliSubType.label)}</span>
                          </span>
                        ` : ''}
                      </div>
                    </td>
                    <td style="white-space: nowrap; color: var(--color-text-muted); font-size: 0.75rem;">
                      ${escapeHtml(formatShortOrderDate(order.created_at))}
                    </td>
                    <td style="white-space: nowrap; font-size: 0.75rem;">
                      ${slaText ? `
                        <span style="font-weight: 600; color: var(--color-text-main); display: inline-flex; align-items: center; gap: 0.25rem;">
                          <i class="ri-time-line" style="color: #d97706;"></i>
                          <span>${escapeHtml(slaText)}</span>
                        </span>
                      ` : `<span style="color: var(--color-text-muted); opacity: 0.45;">—</span>`}
                    </td>
                    <td style="white-space: nowrap;">
                      <div style="display: inline-flex; align-items: center; gap: 0.4rem;">
                        <span class="radar-cov-badge ${covClass}">${covShort}</span>
                        <span style="font-size: 0.76rem; color: var(--color-text-main);">${escapeHtml(comunaStr)}</span>
                      </div>
                    </td>
                    <td style="white-space: nowrap;">
                      <span class="radar-pay-badge ${payInfo.badgeClass}">
                        <i class="${payInfo.icon}"></i>
                        <span>${escapeHtml(payInfo.label)}</span>
                      </span>
                    </td>
                    <td style="white-space: nowrap;">
                      <span style="font-size: 0.74rem; font-weight: 600; color: ${isInc ? '#dc2626' : 'var(--color-text-main)'};">
                        ${escapeHtml(wmsState)}
                      </span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `}
      </div>

      <!-- Pie del Modal -->
      <div class="radar-modal-footer">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button type="button" onclick="window.copyRadarModalOrderNumbers(this)" class="radar-seg-btn" style="border: 1px solid var(--color-border); background: var(--color-bg); padding: 0.32rem 0.7rem; font-weight: 600;">
            <i class="ri-file-copy-line"></i> Copiar N° de pedidos (${filteredOrders.length})
          </button>
        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button type="button" onclick="window.closeRadarQuickSummaryModal()" class="radar-seg-btn" style="border: 1px solid var(--color-border); padding: 0.32rem 0.75rem;">
            Cerrar
          </button>
          <button type="button" onclick="window.openTowerFromRadarModal()" class="btn btn-primary" style="padding: 0.35rem 0.85rem; font-size: 0.76rem; font-weight: 600; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
            <span>Abrir en Torre de Control</span>
            <i class="ri-arrow-right-line"></i>
          </button>
        </div>
      </div>
    </div>
  `;

  if (hadFocus) {
    const inp = document.getElementById('radar-modal-search-input');
    if (inp) {
      inp.focus();
      if (typeof selPos === 'number') inp.setSelectionRange(selPos, selPos);
    }
  }
};

window.notifyMerchantsRadarRealtimeEvent = function(orderRecord) {
  const st = window.merchantsRadarState;
  const merchantName = String(orderRecord?.comercio || '').trim();
  if (merchantName) {
    st.lastFlashedMerchantKey = merchantName.toUpperCase();
  }
  if (window.wmsOrdersActiveSubView === 'merchants_radar') {
    if (window._radarRealtimeRenderTimer) clearTimeout(window._radarRealtimeRenderTimer);
    window._radarRealtimeRenderTimer = setTimeout(() => {
      window.renderMerchantsRadar();
    }, 180);
  } else {
    const summary = computeMerchantsRadarSummary();
    const radarTabBadge = document.getElementById('radar-tab-count');
    if (radarTabBadge) {
      radarTabBadge.textContent = `${summary.merchantsWithOrdersCount} activos`;
    }
  }
};
