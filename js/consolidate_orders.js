/**
 * js/consolidate_orders.js
 * Motor de Detección y Gestión de Consolidado de Pedidos (< 24 Horas, Mismo Correo + Dirección)
 *
 * Reglas de Negocio Oficiales:
 * 1. La decisión de consolidar la toma exclusivamente el Administrador.
 * 2. El Picker ve cada pedido por separado, pero ambos pedidos reciben automáticamente una
 *    alerta tipo Solicitud Especial de Picking (`order_picking_requests` sincronizada en tiempo real
 *    con `active_orders` en Picker) indicando que deben consolidarse en un único paquete físico.
 * 3. A nivel de Facturación (`billing_generator.js`), se cobra 1 solo envío (en el Pedido Principal)
 *    y las N preparaciones individuales (Pick & Pack completo en cada pedido consolidado).
 */

import { supabase } from './supabase.js';

const CONSOLIDATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 horas

// Estado en memoria de grupos detectados y caché rápida por ID de pedido
window._consolidatedCandidateGroups = [];
window._consolidatedCandidateByOrderId = new Map();
window._consolidateModalState = null;

function escapeHtmlSafe(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Obtiene el folio legible del pedido (ej: #1042)
 */
export function getOrderDisplayFolio(order) {
  if (!order) return 'S/N';
  const raw = String(order.external_order_number || order.numero_orden || order.orderNumber || order.id || '').trim();
  if (!raw) return 'S/N';
  return raw.startsWith('#') ? raw : `#${raw}`;
}
window.getOrderDisplayFolio = getOrderDisplayFolio;

/**
 * Extrae y normaliza el correo electrónico del cliente desde múltiples fuentes posibles del pedido
 */
export function getNormalizedOrderEmail(order) {
  if (!order) return '';
  const shopifyData = order.raw_shopify_data || {};
  const jumpsellerData = order.raw_jumpseller_data || {};
  const wooData = order.raw_woocommerce_data || {};

  const candidates = [
    order.customer_email,
    shopifyData.email,
    shopifyData.contact_email,
    shopifyData.customer?.email,
    jumpsellerData.customer?.email,
    wooData.billing?.email
  ];

  for (const c of candidates) {
    if (!c) continue;
    const clean = String(c).trim().toLowerCase();
    if (
      clean &&
      clean.includes('@') &&
      clean !== '-' &&
      clean !== 'null' &&
      clean !== 'undefined' &&
      !clean.includes('sincorreo') &&
      !clean.includes('no-reply') &&
      !clean.includes('noreply')
    ) {
      return clean;
    }
  }
  return '';
}
window.getNormalizedOrderEmail = getNormalizedOrderEmail;

/**
 * Extrae la dirección de envío legible para mostrar en la UI
 */
export function getOrderDisplayAddress(order) {
  if (!order) return 'Sin dirección';
  const shopifyShip = order.raw_shopify_data?.shipping_address || {};
  const addr = String(
    order.shipping_address ||
    [shopifyShip.address1, shopifyShip.address2].filter(Boolean).join(' ') ||
    ''
  ).trim();
  const city = String(order.shipping_city || shopifyShip.city || '').trim();
  if (!addr && !city) return 'Sin dirección';
  if (addr && city && !addr.toLowerCase().includes(city.toLowerCase())) {
    return `${addr}, ${city}`;
  }
  return addr || city;
}
window.getOrderDisplayAddress = getOrderDisplayAddress;

/**
 * Normaliza la dirección física + comuna para comparación difusa pero precisa
 * (ej. "Av. Providencia 1234, Depto 502" == "Avenida Providencia #1234 dpto 502")
 */
export function getNormalizedOrderAddressKey(order) {
  if (!order) return '';
  const shopifyShip = order.raw_shopify_data?.shipping_address || {};
  const rawAddr = String(
    order.shipping_address ||
    [shopifyShip.address1, shopifyShip.address2].filter(Boolean).join(' ') ||
    ''
  ).trim();

  if (!rawAddr || rawAddr.length < 4) return '';

  const lowerRaw = rawAddr.toLowerCase();
  if (
    lowerRaw === '-' ||
    lowerRaw === 'por definir' ||
    lowerRaw === 'sin direccion' ||
    lowerRaw === 'sin dirección' ||
    lowerRaw === 'retiro en tienda' ||
    lowerRaw === 'retiro en bodega' ||
    lowerRaw === 'venta presencial'
  ) {
    return '';
  }

  let normAddr = rawAddr
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    // Estandarizar abreviaturas frecuentes en direcciones de Chile
    .replace(/\b(avenida|avda|av\.?)\b/g, 'av')
    .replace(/\b(pasaje|psje|pje\.?)\b/g, 'pje')
    .replace(/\b(departamento|depto\.?|dpto\.?|dp\.?)\b/g, 'dpto')
    .replace(/\b(numero|nro\.?|num\.?|n°|º|#)\b/g, ' ')
    .replace(/\b(oficina|ofic\.?|of\.?)\b/g, 'of')
    .replace(/\b(block|blq\.?)\b/g, 'block')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalizar comuna / ciudad
  const rawCity = String(order.shipping_city || shopifyShip.city || '').trim();
  const normCity = rawCity
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Si la dirección ya termina con el nombre de la comuna, remover sufijo redundante antes de concatenar
  if (normCity && normAddr.endsWith(' ' + normCity)) {
    normAddr = normAddr.slice(0, normAddr.length - normCity.length).trim();
  }

  if (normAddr.length < 4) return '';
  return `${normAddr}|${normCity}`;
}
window.getNormalizedOrderAddressKey = getNormalizedOrderAddressKey;

/**
 * Obtiene toda la información de consolidación de un pedido (tanto desde columnas SQL como desde raw_shopify_data)
 */
export function getOrderConsolidationInfo(order) {
  if (!order) {
    return {
      isConsolidated: false,
      role: null,
      primaryOrderId: null,
      primaryFolio: null,
      childrenIds: [],
      childrenFolios: [],
      consolidatedAt: null,
      consolidatedBy: null
    };
  }

  const raw = (order.raw_shopify_data && typeof order.raw_shopify_data === 'object')
    ? order.raw_shopify_data
    : {};

  // Soporte también para campos planos proyectados en billing_generator.js (fastOrderSelectFields)
  const roleFromRaw = raw._consolidation_role || order.consolidation_role || null;
  const primaryIdFromRaw = order.consolidated_into_order_id || raw._consolidated_into_order_id || order.consolidated_into_id || null;
  const primaryFolioFromRaw = raw._consolidated_into_folio || order.consolidated_into_folio || null;
  const childrenIds = Array.isArray(raw._consolidated_children_ids) ? raw._consolidated_children_ids : [];
  const childrenFolios = Array.isArray(raw._consolidated_children_folios) ? raw._consolidated_children_folios : [];

  let role = roleFromRaw;
  if (!role) {
    if (primaryIdFromRaw && String(primaryIdFromRaw) !== String(order.id)) {
      role = 'secondary';
    } else if (childrenIds.length > 0) {
      role = 'primary';
    }
  }

  const isConsolidated = Boolean(
    order.is_consolidated === true ||
    raw._is_consolidated === true ||
    role === 'primary' ||
    role === 'secondary'
  );

  return {
    isConsolidated,
    role,
    primaryOrderId: primaryIdFromRaw,
    primaryFolio: primaryFolioFromRaw,
    childrenIds,
    childrenFolios,
    consolidatedAt: raw._consolidated_at || null,
    consolidatedBy: raw._consolidated_by || null
  };
}
window.getOrderConsolidationInfo = getOrderConsolidationInfo;

export function isConsolidatedPrimaryOrder(order) {
  const info = getOrderConsolidationInfo(order);
  return info.isConsolidated && info.role === 'primary';
}
window.isConsolidatedPrimaryOrder = isConsolidatedPrimaryOrder;

export function isConsolidatedSecondaryOrder(order) {
  const info = getOrderConsolidationInfo(order);
  return info.isConsolidated && info.role === 'secondary';
}
window.isConsolidatedSecondaryOrder = isConsolidatedSecondaryOrder;

/**
 * Determina si un pedido es elegible para ser evaluado en el motor de consolidación (<24h)
 */
export function isOrderEligibleForConsolidationDetection(order) {
  if (!order || !order.id) return false;

  // Excluir hijos de pedidos divididos (Split Orders) porque fueron separados por quiebre parcial de stock
  if (typeof window.isSplitChildOrder === 'function' && window.isSplitChildOrder(order)) {
    return false;
  }

  // Estados WMS activos en bodega antes del despacho final
  const estadoWms = String(order.estado_wms || 'En procesamiento').trim();
  const allowedWmsStates = ['En procesamiento', 'En preparación', 'Pickeado'];
  if (!allowedWmsStates.includes(estadoWms)) return false;

  // Excluir cancelados o reembolsados en origen
  const statusLower = String(order.status || '').toLowerCase();
  if (
    statusLower.includes('cancel') ||
    statusLower.includes('void') ||
    statusLower.includes('refund') ||
    statusLower.includes('reembolsado') ||
    statusLower.includes('anulado')
  ) {
    return false;
  }

  // Excluir Retiro, POS y Logística Inversa
  const cat = typeof window.getOrderCategoriaEntrega === 'function'
    ? window.getOrderCategoriaEntrega(order)
    : String(order.categoria_entrega || '').toUpperCase();
  if (cat === 'RETIRO' || cat === 'LOGÍSTICA INVERSA' || cat === 'LOGISTICA INVERSA' || cat.includes('POS') || cat.includes('SHOP POINT')) {
    return false;
  }

  const agendaUpper = String(order.agenda || '').toUpperCase().trim();
  if (agendaUpper === 'RETIRO' || agendaUpper === 'CANCELA' || agendaUpper === 'COMPRA EN BODEGA') {
    return false;
  }

  // Excluir Marketplaces con etiqueta cerrada por orden
  const plat = String(order.external_platform || order.platform || '').toLowerCase();
  const lockedMarketplaces = ['mercadolibre', 'meli', 'falabella', 'paris', 'ripley', 'walmart'];
  if (lockedMarketplaces.some(m => plat.includes(m))) {
    return false;
  }

  return true;
}

/**
 * Formatea una diferencia en milisegundos como texto breve (ej: "2h 15m", "45 min")
 */
function formatTimeDiffShort(diffMs) {
  const totalMin = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Clasifica la etapa operativa de un grupo de pedidos candidatos a consolidar
 */
function classifyConsolidationGroupStage(orders) {
  const states = orders.map(o => String(o.estado_wms || 'En procesamiento').trim());
  if (states.includes('Pickeado')) {
    return {
      key: 'pickeado_critico',
      label: 'Crítico · Pedido ya Pickeado',
      shortLabel: 'Pickeado (Retener paquete)',
      color: '#dc2626',
      bg: '#fef2f2',
      border: '#fca5a5',
      icon: 'ri-alarm-warning-fill',
      description: 'Al menos uno de los pedidos ya fue cerrado en mesa de empaque (Pickeado). Requiere retener el paquete físico en bodega y re-empacar junto al pedido hermano.'
    };
  }
  if (states.includes('En preparación')) {
    return {
      key: 'en_preparacion',
      label: 'Atención · En Preparación (Picker)',
      shortLabel: 'En Picker',
      color: '#d97706',
      bg: '#fffbeb',
      border: '#fde68a',
      icon: 'ri-Error-warning-line',
      description: 'Uno o más pedidos ya están en el sistema Picker. Al consolidar, se inyectará de inmediato una Solicitud Especial de Picking en pantalla del operador.'
    };
  }
  return {
    key: 'optimo',
    label: 'Óptimo · En Procesamiento',
    shortLabel: 'En Procesamiento',
    color: '#0d9488',
    bg: '#f0fdfa',
    border: '#99f6e4',
    icon: 'ri-links-line',
    description: 'Todos los pedidos están en Torre de Control antes de generar guía o pasar a preparación. Momento ideal para consolidar en 1 solo envío.'
  };
}

/**
 * Motor principal: Detecta grupos de pedidos realizados en un plazo <= 24h
 * para el mismo comercio + correo + dirección física de envío.
 */
export function detectConsolidatableOrders(ordersList = null) {
  const sourceOrders = Array.isArray(ordersList) ? ordersList : (window.loadedOrders || []);
  const buckets = new Map();

  for (const order of sourceOrders) {
    if (!isOrderEligibleForConsolidationDetection(order)) continue;

    const email = getNormalizedOrderEmail(order);
    if (!email) continue;

    const addrKey = getNormalizedOrderAddressKey(order);
    if (!addrKey) continue;

    const comercioKey = String(order.comercio || '').trim().toUpperCase();
    if (!comercioKey) continue;

    const groupKey = `${comercioKey}||${email}||${addrKey}`;
    if (!buckets.has(groupKey)) {
      buckets.set(groupKey, []);
    }
    buckets.get(groupKey).push(order);
  }

  const candidateGroups = [];
  const byOrderId = new Map();

  for (const [groupKey, list] of buckets.entries()) {
    if (list.length < 2) continue;

    // Ordenar cronológicamente del más antiguo al más reciente
    const sorted = [...list].sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tA - tB;
    });

    // Agrupar pedidos que estén dentro de una ventana de 24 horas entre sí
    let currentCluster = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = currentCluster[currentCluster.length - 1];
      const first = currentCluster[0];
      const curr = sorted[i];

      const tFirst = first.created_at ? new Date(first.created_at).getTime() : 0;
      const tPrev = prev.created_at ? new Date(prev.created_at).getTime() : 0;
      const tCurr = curr.created_at ? new Date(curr.created_at).getTime() : 0;

      // Si está a <= 24h del primer pedido del cluster o del pedido inmediatamente anterior
      if (tCurr > 0 && tPrev > 0 && ((tCurr - tFirst) <= CONSOLIDATION_WINDOW_MS || (tCurr - tPrev) <= CONSOLIDATION_WINDOW_MS)) {
        currentCluster.push(curr);
      } else {
        if (currentCluster.length >= 2) {
          finalizeCluster(groupKey, currentCluster, candidateGroups, byOrderId);
        }
        currentCluster = [curr];
      }
    }

    if (currentCluster.length >= 2) {
      finalizeCluster(groupKey, currentCluster, candidateGroups, byOrderId);
    }
  }

  // Ordenar grupos: primero los que tienen algún pedido Pickeado/En preparación, luego por fecha más reciente
  candidateGroups.sort((a, b) => {
    const priority = { pickeado_critico: 3, en_preparacion: 2, optimo: 1 };
    const pDiff = (priority[b.stage.key] || 0) - (priority[a.stage.key] || 0);
    if (pDiff !== 0) return pDiff;
    return b.newestTimestamp - a.newestTimestamp;
  });

  if (!ordersList || ordersList === window.loadedOrders) {
    window._consolidatedCandidateGroups = candidateGroups;
    window._consolidatedCandidateByOrderId = byOrderId;
    autoHealConsolidatedOrdersPickingRequests(sourceOrders);
  }

  return { groups: candidateGroups, byOrderId };
}
window.detectConsolidatableOrders = detectConsolidatableOrders;

const _healedConsolidationOrderIds = new Set();

/**
 * Auto-repara y sincroniza hacia Picker cualquier pedido que ya haya sido marcado como consolidado
 * pero que aún no tenga su Solicitud Especial de Picking creada en `order_picking_requests` / `active_orders`.
 */
function autoHealConsolidatedOrdersPickingRequests(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;

  for (const order of orders) {
    if (!order || !order.id) continue;
    const info = getOrderConsolidationInfo(order);
    if (!info.isConsolidated) continue;
    if (_healedConsolidationOrderIds.has(String(order.id))) continue;

    const cachedReq = window.pickingRequestsCache && typeof window.pickingRequestsCache.get === 'function'
      ? window.pickingRequestsCache.get(order.id)
      : null;
    const hasConsItemInCache = cachedReq && Array.isArray(cachedReq.items) && cachedReq.items.some(it => it && (it.id === 'consolidate_shipping_alert' || String(it.text || '').includes('CONSOLIDAR ENVÍO')));

    if (!order.has_picking_request || !hasConsItemInCache) {
      _healedConsolidationOrderIds.add(String(order.id));
      const folio = getOrderDisplayFolio(order);
      const custLabel = `${order.customer_name || 'Cliente'} (${getOrderDisplayAddress(order)})`;
      let checklistText = '';
      let noteText = '';

      if (info.role === 'primary') {
        const siblings = (info.childrenFolios && info.childrenFolios.length > 0) ? info.childrenFolios.join(', ') : 'pedido hermano';
        checklistText = `📦 CONSOLIDAR ENVÍO: Empacar junto con pedido(s) hermano(s) ${siblings} [${custLabel}] en UN SOLO PAQUETE FÍSICO usando la etiqueta de este pedido (${folio}).`;
        noteText = `CONSOLIDADO PRINCIPAL: Unificar paquete físico con ${siblings}`;
      } else {
        const targetFolio = info.primaryFolio || 'Pedido Principal';
        checklistText = `📦 CONSOLIDAR ENVÍO: Incluir todos los productos de este pedido (${folio}) dentro de la bolsa/caja del Pedido Principal ${targetFolio} [${custLabel}]. NO despachar en paquete separado; usar etiqueta de ${targetFolio}.`;
        noteText = `CONSOLIDADO SECUNDARIO: Empacar dentro del Pedido Principal ${targetFolio}`;
      }

      upsertConsolidationPickingRequest(order, checklistText, noteText).catch(() => {});
    }
  }
}

function finalizeCluster(groupKey, clusterOrders, candidateGroups, byOrderId) {
  // Verificar si TODOS los pedidos del cluster ya están consolidados entre sí
  const unConsolidatedOrders = clusterOrders.filter(o => !getOrderConsolidationInfo(o).isConsolidated);
  const allAlreadyConsolidated = unConsolidatedOrders.length === 0;

  // Si todos ya fueron consolidados por el Admin, no los levantamos como alerta pendiente
  if (allAlreadyConsolidated) return;

  const firstOrder = clusterOrders[0];
  const lastOrder = clusterOrders[clusterOrders.length - 1];
  const tFirst = firstOrder.created_at ? new Date(firstOrder.created_at).getTime() : Date.now();
  const tLast = lastOrder.created_at ? new Date(lastOrder.created_at).getTime() : Date.now();
  const diffMs = Math.max(0, tLast - tFirst);

  // Sugerir como Pedido Principal (Ancla) aquel que ya sea primary, o que tenga guía/tracking, o el más antiguo
  const suggestedPrimary =
    clusterOrders.find(o => isConsolidatedPrimaryOrder(o)) ||
    clusterOrders.find(o => Boolean(o.tracking_number && String(o.tracking_number).trim())) ||
    clusterOrders.find(o => o.estado_wms === 'Pickeado' || o.estado_wms === 'En preparación') ||
    firstOrder;

  const stage = classifyConsolidationGroupStage(clusterOrders);
  const folios = clusterOrders.map(o => getOrderDisplayFolio(o));

  const groupObj = {
    groupKey,
    comercio: firstOrder.comercio || 'Comercio',
    customerName: firstOrder.customer_name || lastOrder.customer_name || 'Cliente',
    customerEmail: getNormalizedOrderEmail(firstOrder),
    displayAddress: getOrderDisplayAddress(firstOrder),
    comuna: firstOrder.shipping_city || lastOrder.shipping_city || '',
    orders: clusterOrders,
    orderIds: clusterOrders.map(o => o.id),
    folios,
    suggestedPrimaryId: suggestedPrimary.id,
    suggestedPrimaryFolio: getOrderDisplayFolio(suggestedPrimary),
    oldestTimestamp: tFirst,
    newestTimestamp: tLast,
    diffMs,
    diffLabel: formatTimeDiffShort(diffMs),
    stage,
    hasPartiallyConsolidated: clusterOrders.some(o => getOrderConsolidationInfo(o).isConsolidated)
  };

  candidateGroups.push(groupObj);
  clusterOrders.forEach(o => {
    byOrderId.set(String(o.id), groupObj);
  });
}

/**
 * Obtiene el grupo candidato (<24h) al que pertenece un pedido (si aún no está consolidado)
 */
export function getConsolidationCandidateGroup(orderOrId) {
  const orderId = typeof orderOrId === 'object' ? orderOrId?.id : orderOrId;
  if (!orderId) return null;
  if (!window._consolidatedCandidateByOrderId || window._consolidatedCandidateByOrderId.size === 0) {
    detectConsolidatableOrders(window.loadedOrders || []);
  }
  return window._consolidatedCandidateByOrderId.get(String(orderId)) || null;
}
window.getConsolidationCandidateGroup = getConsolidationCandidateGroup;

/**
 * Genera el badge HTML para la fila del pedido en Torre de Control (`badges-row-${order.id}`) y Ficha 360°
 */
export function getConsolidationBadgeHtml(order) {
  if (!order) return '';

  const info = getOrderConsolidationInfo(order);

  // Caso 1: Pedido YA CONSOLIDADO (Principal o Secundario)
  if (info.isConsolidated) {
    if (info.role === 'primary') {
      const childFoliosText = (info.childrenFolios && info.childrenFolios.length > 0)
        ? info.childrenFolios.join(', ')
        : `${(info.childrenIds || []).length} pedido(s)`;
      const firstChildId = (info.childrenIds && info.childrenIds[0]) ? info.childrenIds[0] : '';

      return `
        <span class="badge consolidation-badge-primary"
              onclick="event.stopPropagation(); window.openConsolidateOrdersModal('${order.id}');"
              style="background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #ffffff; border: 1px solid #4338ca; font-size: 0.7rem; padding: 0.12rem 0.5rem; border-radius: 9999px; font-weight: 700; display: inline-flex; align-items: center; gap: 0.28rem; cursor: pointer; box-shadow: 0 1px 3px rgba(79, 70, 229, 0.3);"
              title="Pedido Principal Consolidado: Incluye los productos de ${escapeHtmlSafe(childFoliosText)} en un solo paquete físico (Se cobra 1 envío + ${(info.childrenIds?.length || 1) + 1} preparaciones). Clic para ver detalle.">
          <i class="ri-links-fill" style="font-size: 0.8rem;"></i>
          <span>📦 CONSOLIDADO PRINCIPAL (+${escapeHtmlSafe(childFoliosText)})</span>
        </span>
        ${firstChildId ? `
          <button type="button"
                  onclick="event.stopPropagation(); if(window.highlightAndScrollToOrder){window.highlightAndScrollToOrder('${firstChildId}');}"
                  style="background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; font-size: 0.66rem; padding: 0.08rem 0.38rem; border-radius: 6px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;"
                  title="Ir al pedido hermano consolidado">
            <i class="ri-arrow-Down-circle-line"></i> Ver hermano
          </button>
        ` : ''}
      `;
    }

    if (info.role === 'secondary') {
      const targetFolio = info.primaryFolio || 'Principal';
      const targetId = info.primaryOrderId || '';
      return `
        <span class="badge consolidation-badge-secondary"
              onclick="event.stopPropagation(); window.openConsolidateOrdersModal('${order.id}');"
              style="background: #f0fdfa; color: #0f766e; border: 1.5px solid #5eead4; font-size: 0.7rem; padding: 0.12rem 0.5rem; border-radius: 9999px; font-weight: 700; display: inline-flex; align-items: center; gap: 0.28rem; cursor: pointer;"
              title="Pedido Secundario Consolidado: Se empaca dentro del pedido ${escapeHtmlSafe(targetFolio)}. En facturación paga preparación completa y $0 flete de envío. Clic para gestionar.">
          <i class="ri-git-merge-line" style="font-size: 0.8rem; color: #0d9488;"></i>
          <span>🔗 CONSOLIDADO EN ${escapeHtmlSafe(targetFolio)} (Flete $0)</span>
        </span>
        ${targetId ? `
          <button type="button"
                  onclick="event.stopPropagation(); if(window.highlightAndScrollToOrder){window.highlightAndScrollToOrder('${targetId}');}"
                  style="background: #ccfbf1; color: #115e59; border: 1px solid #99f6e4; font-size: 0.66rem; padding: 0.08rem 0.38rem; border-radius: 6px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;"
                  title="Resaltar Pedido Principal ${escapeHtmlSafe(targetFolio)}">
            <i class="ri-focus-2-line"></i> Ir a ${escapeHtmlSafe(targetFolio)}
          </button>
        ` : ''}
      `;
    }
  }

  // Caso 2: Pedido CANDIDATO A CONSOLIDAR (<24H mismo correo + dirección)
  const group = getConsolidationCandidateGroup(order.id);
  if (!group) return '';

  const siblingFolios = group.orders
    .filter(o => String(o.id) !== String(order.id))
    .map(o => getOrderDisplayFolio(o))
    .join(', ');

  const isCritical = group.stage.key === 'pickeado_critico';
  const isPrep = group.stage.key === 'en_preparacion';

  const bg = isCritical ? '#fef2f2' : (isPrep ? '#fffbeb' : '#f0fdfa');
  const color = isCritical ? '#dc2626' : (isPrep ? '#b45309' : '#0f766e');
  const border = isCritical ? '#f87171' : (isPrep ? '#fbbf24' : '#2dd4bf');
  const icon = isCritical ? 'ri-alarm-warning-fill' : 'ri-links-line';

  // Mostrar botón de acción sólo al Administrador (la decisión la toma el Admin)
  const isAdminView = !window.location.pathname.toLowerCase().includes('dashboard.html');

  return `
    <span class="badge consolidation-badge-candidate"
          ${isAdminView ? `onclick="event.stopPropagation(); window.openConsolidateOrdersModal('${order.id}');"` : ''}
          style="background: ${bg}; color: ${color}; border: 1.5px solid ${border}; font-size: 0.7rem; padding: 0.12rem 0.5rem; border-radius: 9999px; font-weight: 800; display: inline-flex; align-items: center; gap: 0.28rem; ${isAdminView ? 'cursor: pointer;' : ''} box-shadow: 0 1px 2px rgba(0,0,0,0.06);"
          title="Detectado pedido del mismo cliente (${escapeHtmlSafe(group.customerEmail)}) y misma dirección (${escapeHtmlSafe(group.displayAddress)}) con ${escapeHtmlSafe(group.diffLabel)} de diferencia. ${isAdminView ? 'Clic para revisar y consolidar envío.' : 'Elegible para consolidación de envío.'}">
      <i class="${icon}" style="font-size: 0.82rem;"></i>
      <span>🔗 CONSOLIDABLE &lt;24H con ${escapeHtmlSafe(siblingFolios)} (${escapeHtmlSafe(group.diffLabel)})</span>
      ${isAdminView ? `<span style="background: ${color}; color: #ffffff; padding: 0px 5px; border-radius: 999px; font-size: 0.62rem; margin-left: 2px;">Consolidar</span>` : ''}
    </span>
  `;
}
window.getConsolidationBadgeHtml = getConsolidationBadgeHtml;

/**
 * Renderiza el Banner Superior de Alertas de Consolidación (<24h) en Torre de Control
 */
export function renderConsolidationBannerHtml(filteredOrders = null) {
  // Detectar sobre el universo cargado para no perder el par hermano aunque esté en otra pestaña
  const { groups } = detectConsolidatableOrders(window.loadedOrders || []);
  if (!groups || groups.length === 0) return '';

  // Filtrar grupos que tengan al menos un pedido dentro de los pedidos filtrados actuales (o mostrar todos si está en En procesamiento / Todos)
  const visibleIds = Array.isArray(filteredOrders)
    ? new Set(filteredOrders.map(o => String(o.id)))
    : null;

  const relevantGroups = visibleIds
    ? groups.filter(g => g.orders.some(o => visibleIds.has(String(o.id))))
    : groups;

  if (relevantGroups.length === 0) return '';

  const totalOrdersInGroups = relevantGroups.reduce((acc, g) => acc + g.orders.length, 0);
  const criticalCount = relevantGroups.filter(g => g.stage.key === 'pickeado_critico').length;
  const prepCount = relevantGroups.filter(g => g.stage.key === 'en_preparacion').length;

  const isCollapsed = sessionStorage.getItem('wms_consolidation_banner_collapsed') === '1';
  const activeTagFilter = document.getElementById('filter-order-tag')?.value || '';
  const isFilteredByConsolidable = activeTagFilter === 'CONSOLIDABLE (<24H)';

  const pillsHtml = relevantGroups.slice(0, 8).map(g => {
    const st = g.stage;
    const foliosStr = g.folios.join(' + ');
    return `
      <button type="button"
              onclick="window.openConsolidateOrdersModal('${g.suggestedPrimaryId}')"
              style="background: #ffffff; border: 1.5px solid ${st.border}; border-radius: 8px; padding: 0.32rem 0.65rem; display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.75rem; color: #1e293b; box-shadow: 0 1px 2px rgba(0,0,0,0.04); transition: transform 0.15s ease, box-shadow 0.15s ease;"
              onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 3px 6px rgba(0,0,0,0.08)';"
              onmouseout="this.style.transform='none'; this.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)';"
              title="Cliente: ${escapeHtmlSafe(g.customerName)} (${escapeHtmlSafe(g.customerEmail)})&#10;Dirección: ${escapeHtmlSafe(g.displayAddress)}&#10;Diferencia: ${escapeHtmlSafe(g.diffLabel)} · Etapa: ${escapeHtmlSafe(st.label)}">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${st.color}; display: inline-block; flex-shrink: 0;"></span>
        <strong style="color: #0f172a; font-family: monospace; font-size: 0.78rem;">${escapeHtmlSafe(foliosStr)}</strong>
        <span style="color: #475569; font-weight: 600; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtmlSafe(g.customerName)}</span>
        <span style="background: ${st.bg}; color: ${st.color}; border: 1px solid ${st.border}; font-size: 0.66rem; font-weight: 700; padding: 0.05rem 0.35rem; border-radius: 999px;">
          ${escapeHtmlSafe(g.diffLabel)} · ${escapeHtmlSafe(st.shortLabel)}
        </span>
      </button>
    `;
  }).join('');

  return `
    <div style="background: linear-gradient(135deg, #f0fdfa 0%, #eff6ff 100%); border: 1.5px solid #5eead4; border-radius: var(--radius-md, 10px); padding: 0.65rem 1rem; margin-bottom: 0.85rem; box-shadow: 0 2px 6px rgba(13, 148, 136, 0.08);">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #0d9488; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;">
            <i class="ri-links-fill"></i>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
              <strong style="color: #0f766e; font-size: 0.86rem;">
                Oportunidad de Consolidado (&lt;24 hrs): ${relevantGroups.length} ${relevantGroups.length === 1 ? 'grupo detectado' : 'grupos detectados'} (${totalOrdersInGroups} pedidos)
              </strong>
              <span style="font-size: 0.72rem; background: #ccfbf1; color: #115e59; padding: 0.1rem 0.45rem; border-radius: 999px; font-weight: 700;">
                Criterio: Correo + Dirección
              </span>
              ${criticalCount > 0 ? `
                <span style="font-size: 0.7rem; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; padding: 0.1rem 0.45rem; border-radius: 999px; font-weight: 800; display: inline-flex; align-items: center; gap: 3px;">
                  <i class="ri-alarm-warning-fill"></i> ${criticalCount} con paquete ya Pickeado
                </span>
              ` : ''}
              ${prepCount > 0 ? `
                <span style="font-size: 0.7rem; background: #fef3c7; color: #b45309; border: 1px solid #fde68a; padding: 0.1rem 0.45rem; border-radius: 999px; font-weight: 700;">
                  ${prepCount} en Picker
                </span>
              ` : ''}
            </div>
            <div style="font-size: 0.74rem; color: #475569; margin-top: 1px;">
              Mismo cliente y dirección en menos de 24h. Al consolidar: <strong>Picker recibe alerta de Solicitud Especial en cada pedido</strong> y <strong>Facturación cobra 1 envío + las preparaciones individuales</strong>.
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
          <button type="button"
                  onclick="window.filterByOrderTag('${isFilteredByConsolidable ? '' : 'CONSOLIDABLE (<24H)'}', event)"
                  style="background: ${isFilteredByConsolidable ? '#0f766e' : '#ffffff'}; color: ${isFilteredByConsolidable ? '#ffffff' : '#0f766e'}; border: 1px solid #0d9488; padding: 0.28rem 0.65rem; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;">
            <i class="${isFilteredByConsolidable ? 'ri-close-circle-line' : 'ri-filter-3-line'}"></i>
            ${isFilteredByConsolidable ? 'Quitar filtro Consolidables' : 'Filtrar en tabla'}
          </button>
          <button type="button"
                  onclick="window.toggleConsolidationBannerCollapse()"
                  style="background: transparent; color: #0f766e; border: 1px solid #99f6e4; padding: 0.28rem 0.55rem; border-radius: 6px; font-size: 0.73rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
            <span>${isCollapsed ? 'Ver grupos' : 'Ocultar'}</span>
            <i class="ri-arrow-${isCollapsed ? 'down' : 'up'}-s-line"></i>
          </button>
        </div>
      </div>

      ${!isCollapsed ? `
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.6rem; padding-top: 0.55rem; border-top: 1px dashed #99f6e4;">
          <span style="font-size: 0.72rem; font-weight: 700; color: #0f766e; text-transform: uppercase; letter-spacing: 0.03em;">
            <i class="ri-hand-coin-line"></i> Clic para revisar y consolidar:
          </span>
          ${pillsHtml}
          ${relevantGroups.length > 8 ? `<span style="font-size: 0.72rem; color: #0f766e; font-weight: 600;">+${relevantGroups.length - 8} grupo(s) más...</span>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}
window.renderConsolidationBannerHtml = renderConsolidationBannerHtml;

window.toggleConsolidationBannerCollapse = function() {
  const curr = sessionStorage.getItem('wms_consolidation_banner_collapsed') === '1';
  sessionStorage.setItem('wms_consolidation_banner_collapsed', curr ? '0' : '1');
  if (typeof window.applyWmsFiltersAndRender === 'function') {
    window.applyWmsFiltersAndRender();
  }
};

/**
 * Renderiza la tarjeta de consolidación dentro del detalle expandible del pedido (`details-${order.id}`)
 */
export function renderOrderDetailConsolidationCardHtml(order) {
  if (!order) return '';
  const info = getOrderConsolidationInfo(order);
  const group = getConsolidationCandidateGroup(order.id);

  if (!info.isConsolidated && !group) return '';

  const isAdminView = !window.location.pathname.toLowerCase().includes('dashboard.html');

  if (info.isConsolidated) {
    const isPrimary = info.role === 'primary';
    const siblingDesc = isPrimary
      ? `Empacar junto con pedido(s) hermano(s) <strong>${escapeHtmlSafe((info.childrenFolios || []).join(', '))}</strong> usando la guía de este pedido (${escapeHtmlSafe(getOrderDisplayFolio(order))}).`
      : `Los productos de este pedido se despachan dentro del paquete del <strong>Pedido Principal ${escapeHtmlSafe(info.primaryFolio || '')}</strong> (sin costo de flete adicional).`;

    return `
      <div style="margin-bottom: 0.85rem; padding: 0.7rem 0.95rem; border-radius: 8px; background: ${isPrimary ? '#eef2ff' : '#f0fdfa'}; border: 1.5px solid ${isPrimary ? '#a5b4fc' : '#5eead4'}; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <div style="width: 32px; height: 32px; border-radius: 8px; background: ${isPrimary ? '#4f46e5' : '#0d9488'}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.05rem; flex-shrink: 0;">
            <i class="ri-links-fill"></i>
          </div>
          <div>
            <div style="font-size: 0.82rem; font-weight: 800; color: ${isPrimary ? '#312e81' : '#134e4a'};">
              ${isPrimary ? '📦 Pedido Principal Consolidado (1 Envío + Preparaciones Individuales)' : `🔗 Pedido Secundario Consolidado en ${escapeHtmlSafe(info.primaryFolio || 'Principal')} (Flete $0)`}
            </div>
            <div style="font-size: 0.75rem; color: #334155; margin-top: 2px;">
              ${siblingDesc}
            </div>
          </div>
        </div>
        ${isAdminView ? `
          <div style="display: flex; align-items: center; gap: 0.45rem;">
            <button type="button"
                    onclick="window.openConsolidateOrdersModal('${order.id}')"
                    class="btn btn-sm"
                    style="background: #ffffff; color: #334155; border: 1px solid #cbd5e1; font-size: 0.75rem; font-weight: 700; padding: 0.3rem 0.65rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="ri-settings-3-line"></i> Ver / Gestionar Consolidación
            </button>
            <button type="button"
                    onclick="window.undoOrderConsolidation('${order.id}')"
                    class="btn btn-sm"
                    style="background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; font-size: 0.75rem; font-weight: 700; padding: 0.3rem 0.65rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="ri-link-unlink-m"></i> Deshacer Consolidación
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Si es candidato (<24h) aún no consolidado
  const st = group.stage;
  const otherOrders = group.orders.filter(o => String(o.id) !== String(order.id));
  const otherFolios = otherOrders.map(o => `${getOrderDisplayFolio(o)} (${o.estado_wms || 'En procesamiento'})`).join(', ');

  return `
    <div style="margin-bottom: 0.85rem; padding: 0.7rem 0.95rem; border-radius: 8px; background: ${st.bg}; border: 1.5px solid ${st.border}; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 0.6rem;">
        <div style="width: 32px; height: 32px; border-radius: 8px; background: ${st.color}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.05rem; flex-shrink: 0;">
          <i class="${st.icon}"></i>
        </div>
        <div>
          <div style="font-size: 0.82rem; font-weight: 800; color: ${st.color};">
            🔗 Pedido Consolidable (&lt;24h) detectado con ${escapeHtmlSafe(otherFolios)} · Diferencia: ${escapeHtmlSafe(group.diffLabel)}
          </div>
          <div style="font-size: 0.74rem; color: #334155; margin-top: 2px;">
            Mismo correo (<strong>${escapeHtmlSafe(group.customerEmail)}</strong>) y dirección (<strong>${escapeHtmlSafe(group.displayAddress)}</strong>). ${escapeHtmlSafe(st.description)}
          </div>
        </div>
      </div>
      ${isAdminView ? `
        <button type="button"
                onclick="window.openConsolidateOrdersModal('${order.id}')"
                class="btn btn-sm"
                style="background: #0d9488; color: #ffffff; border: none; font-size: 0.76rem; font-weight: 700; padding: 0.38rem 0.8rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(13, 148, 136, 0.25);">
          <i class="ri-links-fill"></i> Consolidar Envío Ahora
        </button>
      ` : ''}
    </div>
  `;
}
window.renderOrderDetailConsolidationCardHtml = renderOrderDetailConsolidationCardHtml;

/**
 * Busca todos los pedidos que forman parte de una consolidación ya realizada o candidata
 */
function resolveModalGroupOrders(orderId) {
  const allOrders = window.loadedOrders || [];
  const targetOrder = allOrders.find(o => String(o.id) === String(orderId));
  if (!targetOrder) return null;

  const info = getOrderConsolidationInfo(targetOrder);
  if (info.isConsolidated) {
    const primaryId = info.role === 'primary' ? targetOrder.id : info.primaryOrderId;
    const primaryOrder = allOrders.find(o => String(o.id) === String(primaryId)) || targetOrder;
    const pInfo = getOrderConsolidationInfo(primaryOrder);
    const childIdsSet = new Set((pInfo.childrenIds || []).map(id => String(id)));

    const groupOrders = allOrders.filter(o => {
      if (String(o.id) === String(primaryOrder.id)) return true;
      if (childIdsSet.has(String(o.id))) return true;
      const oInfo = getOrderConsolidationInfo(o);
      return oInfo.isConsolidated && String(oInfo.primaryOrderId) === String(primaryOrder.id);
    });

    // Asegurar al menos targetOrder y primaryOrder
    if (!groupOrders.some(o => String(o.id) === String(targetOrder.id))) {
      groupOrders.push(targetOrder);
    }

    // Incluir también cualquier nuevo pedido <24h que haya llegado después para el mismo cliente+dirección
    const candGroup = getConsolidationCandidateGroup(targetOrder.id) || getConsolidationCandidateGroup(primaryOrder.id);
    if (candGroup && Array.isArray(candGroup.orders)) {
      candGroup.orders.forEach(co => {
        if (!groupOrders.some(go => String(go.id) === String(co.id))) {
          groupOrders.push(co);
        }
      });
    }

    groupOrders.sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tA - tB;
    });

    const first = groupOrders[0];
    const last = groupOrders[groupOrders.length - 1];
    const diffMs = Math.max(0, (last?.created_at ? new Date(last.created_at).getTime() : 0) - (first?.created_at ? new Date(first.created_at).getTime() : 0));

    return {
      isAlreadyConsolidated: true,
      comercio: primaryOrder.comercio || targetOrder.comercio || 'Comercio',
      customerName: primaryOrder.customer_name || targetOrder.customer_name || 'Cliente',
      customerEmail: getNormalizedOrderEmail(primaryOrder) || getNormalizedOrderEmail(targetOrder),
      displayAddress: getOrderDisplayAddress(primaryOrder) || getOrderDisplayAddress(targetOrder),
      orders: groupOrders,
      suggestedPrimaryId: primaryOrder.id,
      diffLabel: formatTimeDiffShort(diffMs),
      stage: classifyConsolidationGroupStage(groupOrders)
    };
  }

  const candGroup = getConsolidationCandidateGroup(orderId);
  if (candGroup) {
    return {
      isAlreadyConsolidated: false,
      ...candGroup
    };
  }

  return null;
}

/**
 * Abre el Modal de Consolidación de Pedidos para el Administrador
 */
export async function openConsolidateOrdersModal(orderId) {
  const group = resolveModalGroupOrders(orderId);
  if (!group || !group.orders || group.orders.length < 2) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'info',
        title: 'Sin pedidos hermanos para consolidar',
        text: 'No se encontraron otros pedidos activos (< 24h) con el mismo correo y dirección de envío.',
        confirmButtonColor: '#0d9488'
      });
    }
    return;
  }

  window._consolidateModalState = {
    group,
    selectedPrimaryId: String(group.suggestedPrimaryId || group.orders[0].id)
  };

  const st = group.stage;
  const hasPickeado = st.key === 'pickeado_critico';

  const renderOrderRowsHtml = () => {
    const selPrimaryId = String(window._consolidateModalState.selectedPrimaryId);
    return group.orders.map((o) => {
      const isPrimary = String(o.id) === selPrimaryId;
      const folio = getOrderDisplayFolio(o);
      const createdDate = o.created_at
        ? new Date(o.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '-';
      const itemsList = Array.isArray(o.order_items) && o.order_items.length > 0
        ? o.order_items.map(it => `${it.quantity || 1}x ${it.products?.sku || it.sku || it.products?.name || 'SKU'}`).join(', ')
        : (o.sku || o.item || 'Productos del pedido');
      const tracking = o.tracking_number ? `Guía: ${o.tracking_number} (${o.courier || o.operador || 'Courier'})` : 'Sin guía emitida';
      const wmsState = o.estado_wms || 'En procesamiento';

      let stateBadgeBg = '#e0f2fe';
      let stateBadgeColor = '#0369a1';
      if (wmsState === 'Pickeado') {
        stateBadgeBg = '#dcfce7';
        stateBadgeColor = '#15803d';
      } else if (wmsState === 'En preparación') {
        stateBadgeBg = '#fef3c7';
        stateBadgeColor = '#b45309';
      }

      return `
        <label for="consolidate-radio-${o.id}"
               style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; padding: 0.75rem 0.9rem; border-radius: 10px; border: 2px solid ${isPrimary ? '#4f46e5' : '#e2e8f0'}; background: ${isPrimary ? '#f5f3ff' : '#ffffff'}; cursor: pointer; transition: all 0.15s ease;">
          <div style="display: flex; align-items: flex-start; gap: 0.65rem; flex: 1; min-width: 0;">
            <input type="radio"
                   id="consolidate-radio-${o.id}"
                   name="consolidate-primary-order"
                   value="${o.id}"
                   ${isPrimary ? 'checked' : ''}
                   onchange="window.onChangeConsolidatePrimaryOrder('${o.id}')"
                   style="margin-top: 4px; width: 17px; height: 17px; accent-color: #4f46e5; cursor: pointer; flex-shrink: 0;">
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                <strong style="font-size: 0.92rem; color: #0f172a; font-family: monospace;">${escapeHtmlSafe(folio)}</strong>
                <span style="background: ${stateBadgeBg}; color: ${stateBadgeColor}; font-size: 0.68rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;">
                  ${escapeHtmlSafe(wmsState)}
                </span>
                ${o.agenda ? `<span style="background: #f1f5f9; color: #334155; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px;">Agenda: ${escapeHtmlSafe(o.agenda)}</span>` : ''}
                ${o.operador ? `<span style="background: #f1f5f9; color: #475569; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px;">Op: ${escapeHtmlSafe(o.operador)}</span>` : ''}
                <span style="font-size: 0.72rem; color: #64748b;">
                  <i class="ri-time-line"></i> ${escapeHtmlSafe(createdDate)}
                </span>
              </div>
              <div style="font-size: 0.76rem; color: #334155; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtmlSafe(itemsList)}">
                <strong>Productos:</strong> ${escapeHtmlSafe(itemsList)}
              </div>
              <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">
                <i class="ri-barcode-box-line"></i> ${escapeHtmlSafe(tracking)} · Sucursal: <strong>${escapeHtmlSafe(o.sucursal_pickeo || 'Por asignar')}</strong>
              </div>
            </div>
          </div>

          <div style="text-align: right; flex-shrink: 0;">
            ${isPrimary ? `
              <span style="background: #4f46e5; color: #ffffff; font-size: 0.7rem; font-weight: 800; padding: 3px 9px; border-radius: 6px; display: inline-block;">
                📦 PEDIDO PRINCIPAL (ANCLA)
              </span>
              <div style="font-size: 0.68rem; color: #4338ca; font-weight: 700; margin-top: 4px;">
                1 Envío + 1 Preparación
              </div>
            ` : `
              <span style="background: #ccfbf1; color: #0f766e; border: 1px solid #5eead4; font-size: 0.7rem; font-weight: 800; padding: 3px 9px; border-radius: 6px; display: inline-block;">
                🔗 PEDIDO SECUNDARIO
              </span>
              <div style="font-size: 0.68rem; color: #0f766e; font-weight: 700; margin-top: 4px;">
                Flete $0 + 1 Preparación
              </div>
            `}
          </div>
        </label>
      `;
    }).join('');
  };

  window.onChangeConsolidatePrimaryOrder = function(newPrimaryId) {
    if (!window._consolidateModalState) return;
    window._consolidateModalState.selectedPrimaryId = String(newPrimaryId);
    const listContainer = document.getElementById('consolidate-modal-orders-list');
    if (listContainer) {
      listContainer.innerHTML = renderOrderRowsHtml();
    }
  };

  const modalHtml = `
    <div style="text-align: left; font-size: 0.85rem; color: #1e293b; line-height: 1.45;">
      <!-- Resumen de Coincidencia (<24h) -->
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.9rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.35rem;">
          <span style="font-weight: 800; color: #0f172a; font-size: 0.88rem;">
            <i class="ri-store-2-line" style="color: #4f46e5;"></i> ${escapeHtmlSafe(group.comercio)} · ${escapeHtmlSafe(group.customerName)}
          </span>
          <span style="background: ${st.bg}; color: ${st.color}; border: 1px solid ${st.border}; font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 999px;">
            <i class="${st.icon}"></i> Diferencia: ${escapeHtmlSafe(group.diffLabel)} · ${escapeHtmlSafe(st.label)}
          </span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.78rem; color: #334155;">
          <div><i class="ri-mail-check-line" style="color: #0d9488;"></i> <strong>Correo:</strong> ${escapeHtmlSafe(group.customerEmail)}</div>
          <div><i class="ri-map-pin-2-line" style="color: #0d9488;"></i> <strong>Dirección:</strong> ${escapeHtmlSafe(group.displayAddress)}</div>
        </div>
      </div>

      <!-- Alerta según Etapa Operativa -->
      <div style="background: ${st.bg}; border: 1.5px solid ${st.border}; border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 0.9rem; color: ${st.color}; font-size: 0.78rem;">
        <div style="font-weight: 800; display: flex; align-items: center; gap: 0.35rem; margin-bottom: 2px;">
          <i class="${st.icon}" style="font-size: 0.95rem;"></i>
          <span>Estado Operativo del Grupo: ${escapeHtmlSafe(st.label)}</span>
        </div>
        <div style="color: #334155;">${escapeHtmlSafe(st.description)}</div>
        ${hasPickeado ? `
          <label style="display: flex; align-items: center; gap: 0.45rem; margin-top: 0.55rem; padding-top: 0.45rem; border-top: 1px dashed ${st.border}; font-weight: 800; color: #dc2626; cursor: pointer;">
            <input type="checkbox" id="swal-consolidate-confirm-pickeado" style="width: 16px; height: 16px; accent-color: #dc2626;">
            <span>Confirmo retener físicamente el paquete ya Pickeado en bodega para unificar ambos pedidos en una sola caja/bolsa.</span>
          </label>
        ` : ''}
      </div>

      <!-- Selector de Pedido Principal (Ancla del Envío) -->
      <div style="margin-bottom: 0.9rem;">
        <div style="font-weight: 800; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; margin-bottom: 0.45rem;">
          1. Selecciona el Pedido Principal (Ancla que llevará la etiqueta de envío):
        </div>
        <div id="consolidate-modal-orders-list" style="display: flex; flex-direction: column; gap: 0.55rem;">
          ${renderOrderRowsHtml()}
        </div>
      </div>

      <!-- Resumen de Efectos Automáticos (Reglas de Negocio) -->
      <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 10px; padding: 0.75rem 0.95rem;">
        <div style="font-weight: 800; color: #0f766e; font-size: 0.79rem; margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.35rem;">
          <i class="ri-shield-check-line" style="font-size: 0.95rem;"></i>
          <span>¿Qué hará el sistema al confirmar la consolidación?</span>
        </div>
        <ul style="margin: 0; padding-left: 1.15rem; font-size: 0.76rem; color: #1e293b; display: flex; flex-direction: column; gap: 0.28rem;">
          <li><strong>Picker (Pedidos separados con Solicitud Especial):</strong> Cada pedido se mantiene independiente en Picker, pero ambos recibirán una <strong>Solicitud Especial de Picking obligatoria</strong> indicando empacarlos juntos en un único bulto con la etiqueta del Pedido Principal.</li>
          <li><strong>Sincronización de Guía y Courier:</strong> El pedido secundario heredará automáticamente la sucursal, agenda, operador y número de seguimiento del Pedido Principal.</li>
          <li><strong>Facturación Automática (1 Envío + ${group.orders.length} Preparaciones):</strong> En el Gestor de Facturación se cobrarán las <strong>${group.orders.length} preparaciones (Pick & Pack)</strong> y <strong>1 solo flete de envío</strong> (el pedido secundario queda con Flete = <strong>$0</strong>).</li>
        </ul>
      </div>
    </div>
  `;

  const result = await Swal.fire({
    title: `<div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 1.15rem; font-weight: 800; color: #0f172a;"><i class="ri-links-fill" style="color: #0d9488;"></i><span>${group.isAlreadyConsolidated ? 'Gestionar Consolidado de Pedidos' : 'Consolidar Pedidos (< 24 Horas)'}</span></div>`,
    html: modalHtml,
    width: '680px',
    showCancelButton: true,
    showDenyButton: Boolean(group.isAlreadyConsolidated),
    confirmButtonText: `<i class="ri-links-fill"></i> ${group.isAlreadyConsolidated ? 'Actualizar Consolidación' : 'Confirmar y Consolidar Envío'}`,
    denyButtonText: '<i class="ri-link-unlink-m"></i> Deshacer Consolidación',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#0d9488',
    denyButtonColor: '#dc2626',
    focusConfirm: false,
    preConfirm: () => {
      if (hasPickeado) {
        const chk = document.getElementById('swal-consolidate-confirm-pickeado');
        if (!chk || !chk.checked) {
          Swal.showValidationMessage('Debes confirmar la retención física del paquete ya Pickeado en bodega.');
          return false;
        }
      }
      const selectedPrimaryId = window._consolidateModalState?.selectedPrimaryId || group.suggestedPrimaryId;
      return { selectedPrimaryId };
    }
  });

  if (result.isDenied) {
    await undoOrderConsolidation(orderId);
    return;
  }

  if (result.isConfirmed && result.value) {
    await executeOrderConsolidation(group, result.value.selectedPrimaryId);
  }
}
window.openConsolidateOrdersModal = openConsolidateOrdersModal;

/**
 * Crea o actualiza una Solicitud Especial de Picking (`order_picking_requests`)
 * para un pedido consolidado y la sincroniza en tiempo real con Picker (`active_orders`).
 */
async function upsertConsolidationPickingRequest(order, checklistText, generalNoteText) {
  if (!order || !order.id) return;

  const orderId = order.id;
  const itemId = 'consolidate_shipping_alert';
  const extNum = String(order.external_order_number || order.numero_orden || order.id);
  const comercioName = order.comercio || 'Sin Comercio';
  const adminEmail = window.currentAdminUser?.email || window.currentSession?.user?.email || 'admin@stocka.cl';

  const baseNewItem = {
    id: itemId,
    text: checklistText,
    checked: false,
    checked_by: null,
    checked_at: null,
    discarded: false,
    discard_reason: null
  };

  let finalReqObj = {
    order_id: orderId,
    external_order_number: extNum,
    comercio: comercioName,
    status: 'pendiente',
    items: [baseNewItem],
    general_notes: generalNoteText || null,
    warning_acknowledged: true,
    created_by_email: adminEmail,
    updated_at: new Date().toISOString()
  };

  try {
    const { data: existingList } = await supabase
      .from('order_picking_requests')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1);

    const existingReq = Array.isArray(existingList) && existingList.length > 0 ? existingList[0] : null;
    let savedReq = null;

    if (existingReq) {
      const currentItems = Array.isArray(existingReq.items) ? [...existingReq.items] : [];
      const existingIdx = currentItems.findIndex(it => it && (it.id === itemId || String(it.text || '').includes('CONSOLIDAR ENVÍO')));

      if (existingIdx >= 0) {
        currentItems[existingIdx] = {
          ...currentItems[existingIdx],
          id: itemId,
          text: checklistText
        };
      } else {
        currentItems.unshift(baseNewItem);
      }

      const prevNotes = String(existingReq.general_notes || '').trim();
      const updatedNotes = prevNotes.includes('CONSOLIDADO')
        ? prevNotes
        : [generalNoteText, prevNotes].filter(Boolean).join(' | ');

      const allChecked = currentItems.length > 0 && currentItems.every(i => i && i.checked);
      const nextStatus = allChecked ? 'completada' : 'pendiente';

      finalReqObj = {
        ...existingReq,
        items: currentItems,
        general_notes: updatedNotes,
        status: nextStatus,
        updated_at: new Date().toISOString()
      };

      const { data: updated, error: updErr } = await supabase
        .from('order_picking_requests')
        .update({
          items: currentItems,
          general_notes: updatedNotes,
          status: nextStatus,
          updated_at: finalReqObj.updated_at
        })
        .eq('id', existingReq.id)
        .select('*')
        .maybeSingle();

      if (!updErr && updated) {
        savedReq = updated;
      } else if (updErr) {
        console.warn('[ConsolidateOrders] Aviso actualizando order_picking_requests:', updErr);
      }
    } else {
      const insertPayload = {
        order_id: orderId,
        external_order_number: extNum,
        comercio: comercioName,
        status: 'pendiente',
        items: [baseNewItem],
        general_notes: generalNoteText || null,
        warning_acknowledged: true,
        created_by_email: adminEmail,
        updated_at: new Date().toISOString()
      };

      const { data: inserted, error: insErr } = await supabase
        .from('order_picking_requests')
        .insert([insertPayload])
        .select('*')
        .maybeSingle();

      if (!insErr && inserted) {
        savedReq = inserted;
      } else if (insErr) {
        console.warn('[ConsolidateOrders] Aviso insertando en order_picking_requests:', insErr);
      }
    }

    const effectiveReq = savedReq || finalReqObj;

    if (window.pickingRequestsCache && typeof window.pickingRequestsCache.set === 'function') {
      window.pickingRequestsCache.set(orderId, effectiveReq);
    }
    order.has_picking_request = true;
    order.picking_request_status = effectiveReq.status || 'pendiente';
    supabase.from('orders').update({
      has_picking_request: true,
      picking_request_status: effectiveReq.status || 'pendiente'
    }).eq('id', orderId).then(() => {}).catch(() => {});

    if (typeof window.syncPickingRequestToPicker === 'function') {
      await window.syncPickingRequestToPicker(orderId, effectiveReq);
    } else {
      await syncConsolidationDirectlyToPicker(order, effectiveReq);
    }

    if (typeof window.refreshOrderRowPickingBadge === 'function') {
      window.refreshOrderRowPickingBadge(orderId);
    }
  } catch (err) {
    console.warn('[ConsolidateOrders] Aviso sincronizando Solicitud Especial de Picking:', err);
    try {
      await syncConsolidationDirectlyToPicker(order, finalReqObj);
    } catch (_) {}
  }
}

/**
 * Sincronización directa de respaldo hacia `active_orders` de Picker cuando un pedido ya está en preparación
 */
async function syncConsolidationDirectlyToPicker(order, request) {
  const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
  const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';
  const pClient = window.pickerSupabase || (window.supabase && typeof window.supabase.createClient === 'function' ? window.supabase.createClient(PICKER_URL, PICKER_KEY) : null);
  if (!pClient || !order) return;

  const ordNum = String(order.external_order_number || order.numero_orden || '').trim();
  if (!ordNum) return;

  const cleanNum = ordNum.replace(/^#/, '');
  const digitsOnly = cleanNum.replace(/^[^0-9]+/, '');
  const searchKeys = Array.from(new Set([ordNum, '#' + cleanNum, cleanNum, ordNum.toUpperCase(), cleanNum.toUpperCase()]));

  let { data: activeRows } = await pClient
    .from('active_orders')
    .select('id, order_number, observation, sheet_status')
    .in('order_number', searchKeys);

  if ((!activeRows || activeRows.length === 0) && digitsOnly.length >= 4) {
    let q = pClient.from('active_orders').select('id, order_number, observation, sheet_status').ilike('order_number', `%${digitsOnly}`);
    if (order.comercio) q = q.eq('comercio', order.comercio);
    const { data: fallbackRows } = await q;
    activeRows = fallbackRows;
  }

  if (!activeRows || activeRows.length === 0) return;

  const items = Array.isArray(request?.items) ? request.items : [];
  const hasReq = items.length > 0;
  const pendingItems = items.filter(i => !i.checked && !i.discarded).map(i => i.text);
  const tag = pendingItems.length > 0 ? `🚨 [SOLICITUD PICKING: ${pendingItems.join('; ')}]` : '';

  for (const row of activeRows) {
    let currentObs = String(row.observation || '').replace(/(🚨|✅|⚠️)?\s*\[SOLICITUD PICKING:[^\]]*\]\s*(\|)?\s*/gi, '').trim();
    const newObs = tag ? (currentObs ? `${tag} | ${currentObs}` : tag) : currentObs;
    const upd = {
      observation: (newObs || '').slice(0, 1000),
      has_picking_requests: hasReq,
      picking_requests_json: hasReq ? items : null,
      picking_requests_confirmed: false
    };
    if (hasReq && (row.sheet_status === 'EN PREPARACIÓN' || !row.sheet_status)) {
      upd.sheet_status = 'Pendiente (Obs)';
    }
    await pClient.from('active_orders').update(upd).eq('id', row.id);
  }
}

/**
 * Ejecuta la consolidación en Supabase, actualiza `window.loadedOrders`,
 * inyecta la Solicitud Especial de Picking en cada pedido por separado y registra auditoría.
 */
async function executeOrderConsolidation(group, selectedPrimaryId) {
  const orders = group.orders || [];
  const primaryOrder = orders.find(o => String(o.id) === String(selectedPrimaryId)) || orders[0];
  const secondaryOrders = orders.filter(o => String(o.id) !== String(primaryOrder.id));

  if (!primaryOrder || secondaryOrders.length === 0) return;

  const primaryFolio = getOrderDisplayFolio(primaryOrder);
  const secondaryIds = secondaryOrders.map(o => o.id);
  const secondaryFolios = secondaryOrders.map(o => getOrderDisplayFolio(o));
  const nowIso = new Date().toISOString();
  const adminEmail = window.currentAdminUser?.email || 'Administrador';

  Swal.fire({
    title: 'Consolidando Pedidos...',
    html: 'Vinculando órdenes y enviando Solicitud Especial de Picking a cada pedido...',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  try {
    // 1. Actualizar Pedido Principal (Ancla)
    const primaryRaw = {
      ...(primaryOrder.raw_shopify_data && typeof primaryOrder.raw_shopify_data === 'object' ? primaryOrder.raw_shopify_data : {}),
      _is_consolidated: true,
      _consolidation_role: 'primary',
      _consolidated_into_order_id: null,
      _consolidated_into_folio: null,
      _consolidated_children_ids: secondaryIds,
      _consolidated_children_folios: secondaryFolios,
      _consolidated_at: nowIso,
      _consolidated_by: adminEmail
    };

    await updateOrderConsolidationDbRow(primaryOrder.id, {
      raw_shopify_data: primaryRaw,
      is_consolidated: true,
      consolidated_into_order_id: null
    });

    primaryOrder.raw_shopify_data = primaryRaw;
    primaryOrder.is_consolidated = true;
    primaryOrder.consolidated_into_order_id = null;

    // 2. Actualizar cada Pedido Secundario y propagar datos logísticos del Principal si existen
    for (const secOrder of secondaryOrders) {
      const secRaw = {
        ...(secOrder.raw_shopify_data && typeof secOrder.raw_shopify_data === 'object' ? secOrder.raw_shopify_data : {}),
        _is_consolidated: true,
        _consolidation_role: 'secondary',
        _consolidated_into_order_id: primaryOrder.id,
        _consolidated_into_folio: primaryFolio,
        _consolidated_children_ids: [],
        _consolidated_children_folios: [],
        _consolidated_at: nowIso,
        _consolidated_by: adminEmail
      };

      const secUpdatePayload = {
        raw_shopify_data: secRaw,
        is_consolidated: true,
        consolidated_into_order_id: primaryOrder.id
      };

      // Propagar sucursal, agenda, operador y tracking del Pedido Principal para mantener coherencia en Picker y cierre Shopify
      if (primaryOrder.sucursal_pickeo) secUpdatePayload.sucursal_pickeo = primaryOrder.sucursal_pickeo;
      if (primaryOrder.agenda) secUpdatePayload.agenda = primaryOrder.agenda;
      if (primaryOrder.operador) secUpdatePayload.operador = primaryOrder.operador;
      if (primaryOrder.courier) secUpdatePayload.courier = primaryOrder.courier;
      if (primaryOrder.tracking_number) secUpdatePayload.tracking_number = primaryOrder.tracking_number;
      if (primaryOrder.tracking_url) secUpdatePayload.tracking_url = primaryOrder.tracking_url;

      await updateOrderConsolidationDbRow(secOrder.id, secUpdatePayload);

      Object.assign(secOrder, secUpdatePayload);
    }

    // 3. Crear Solicitud Especial de Picking en CADA pedido por separado (para que el Picker vea ambos con alerta obligatoria)
    const customerLabel = `${group.customerName} (${group.displayAddress})`;
    const primaryChecklistText = `📦 CONSOLIDAR ENVÍO: Empacar junto con pedido(s) hermano(s) ${secondaryFolios.join(', ')} [${customerLabel}] en UN SOLO PAQUETE FÍSICO usando la etiqueta de este pedido (${primaryFolio}).`;
    const primaryNoteText = `CONSOLIDADO PRINCIPAL: Unificar paquete físico con ${secondaryFolios.join(', ')}`;

    await upsertConsolidationPickingRequest(primaryOrder, primaryChecklistText, primaryNoteText);

    for (const secOrder of secondaryOrders) {
      const secFolio = getOrderDisplayFolio(secOrder);
      const secChecklistText = `📦 CONSOLIDAR ENVÍO: Incluir todos los productos de este pedido (${secFolio}) dentro de la bolsa/caja del Pedido Principal ${primaryFolio} [${customerLabel}]. NO despachar en paquete separado; usar etiqueta de ${primaryFolio}.`;
      const secNoteText = `CONSOLIDADO SECUNDARIO: Empacar dentro del Pedido Principal ${primaryFolio}`;
      await upsertConsolidationPickingRequest(secOrder, secChecklistText, secNoteText);
    }

    // 4. Registrar en historial de auditoría (`order_audit_logs`)
    if (typeof window.logOrderAudit === 'function') {
      await window.logOrderAudit(
        primaryOrder.id,
        'CONSOLIDACIÓN DE PEDIDO (PRINCIPAL)',
        `Pedido designado como Principal (Ancla de Envío). Consolidado junto a ${secondaryFolios.join(', ')}. Facturación: 1 envío + ${orders.length} preparaciones.`
      );
      for (const secOrder of secondaryOrders) {
        await window.logOrderAudit(
          secOrder.id,
          'CONSOLIDACIÓN DE PEDIDO (SECUNDARIO)',
          `Pedido consolidado dentro del Pedido Principal ${primaryFolio}. Se genera Solicitud Especial de Picking y flete $0 en facturación.`
        );
      }
    }

    // 5. Re-detectar y refrescar vistas activas
    detectConsolidatableOrders(window.loadedOrders || []);
    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
    }
    if (typeof window.renderAgendasGrid === 'function' && document.getElementById('agendas-grid-tbody')) {
      window.renderAgendasGrid();
    }
    if (window._currentFullPageOrderId && typeof window.openOrderFullPage === 'function') {
      window.openOrderFullPage(window._currentFullPageOrderId);
    }

    Swal.fire({
      icon: 'success',
      title: '¡Pedidos Consolidados!',
      html: `
        <div style="text-align: left; font-size: 0.85rem; color: #334155; line-height: 1.5;">
          <p style="margin-bottom: 0.5rem;">Se consolidaron exitosamente los pedidos en torno al <strong>Pedido Principal ${escapeHtmlSafe(primaryFolio)}</strong>:</p>
          <ul style="margin: 0; padding-left: 1.15rem;">
            <li><strong>Pedido Principal (1 Envío + 1 Prep.):</strong> ${escapeHtmlSafe(primaryFolio)}</li>
            <li><strong>Pedido(s) Secundario(s) ($0 Envío + 1 Prep.):</strong> ${escapeHtmlSafe(secondaryFolios.join(', '))}</li>
            <li><strong>Alerta enviada al Picker:</strong> Se activó una <em>Solicitud Especial de Picking</em> en cada pedido para que el operador los empaque juntos.</li>
          </ul>
        </div>
      `,
      confirmButtonColor: '#0d9488'
    });
  } catch (err) {
    console.error('[ConsolidateOrders] Error consolidando pedidos:', err);
    Swal.fire('Error', 'No se pudo completar la consolidación: ' + (err.message || err), 'error');
  }
}

/**
 * Actualiza un registro en `orders` con fallback automático si las columnas SQL opcionales
 * (`is_consolidated`, `consolidated_into_order_id`) aún no han sido creadas en Supabase.
 */
async function updateOrderConsolidationDbRow(orderId, payload) {
  const { error } = await supabase
    .from('orders')
    .update(payload)
    .eq('id', orderId);

  if (error) {
    // Fallback sin las columnas SQL nuevas (guardando en raw_shopify_data + campos logísticos estándar)
    const fallbackPayload = { ...payload };
    delete fallbackPayload.is_consolidated;
    delete fallbackPayload.consolidated_into_order_id;
    const { error: err2 } = await supabase
      .from('orders')
      .update(fallbackPayload)
      .eq('id', orderId);
    if (err2) throw err2;
  }
}

/**
 * Deshace la consolidación de un grupo de pedidos y limpia el ítem automático de Solicitud de Picking
 */
export async function undoOrderConsolidation(orderId) {
  const group = resolveModalGroupOrders(orderId);
  const allOrders = window.loadedOrders || [];
  const targetOrder = allOrders.find(o => String(o.id) === String(orderId));
  const ordersToReset = group?.orders || (targetOrder ? [targetOrder] : []);

  if (ordersToReset.length === 0) return;

  const confirmRes = await Swal.fire({
    icon: 'warning',
    title: '¿Deshacer consolidación de envío?',
    html: `Los pedidos <strong>${ordersToReset.map(o => escapeHtmlSafe(getOrderDisplayFolio(o))).join(', ')}</strong> volverán a ser independientes en despacho y facturación, y se retirará la instrucción automática de consolidado en Picker.`,
    showCancelButton: true,
    confirmButtonText: 'Sí, deshacer consolidación',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626'
  });

  if (!confirmRes.isConfirmed) return;

  Swal.fire({
    title: 'Desvinculando pedidos...',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  try {
    for (const ord of ordersToReset) {
      const cleanRaw = {
        ...(ord.raw_shopify_data && typeof ord.raw_shopify_data === 'object' ? ord.raw_shopify_data : {})
      };
      delete cleanRaw._is_consolidated;
      delete cleanRaw._consolidation_role;
      delete cleanRaw._consolidated_into_order_id;
      delete cleanRaw._consolidated_into_folio;
      delete cleanRaw._consolidated_children_ids;
      delete cleanRaw._consolidated_children_folios;
      delete cleanRaw._consolidated_at;
      delete cleanRaw._consolidated_by;

      await updateOrderConsolidationDbRow(ord.id, {
        raw_shopify_data: cleanRaw,
        is_consolidated: false,
        consolidated_into_order_id: null
      });

      ord.raw_shopify_data = cleanRaw;
      ord.is_consolidated = false;
      ord.consolidated_into_order_id = null;

      // Limpiar el ítem automático de consolidación en order_picking_requests
      await removeConsolidationPickingRequestItem(ord.id);
    }

    detectConsolidatableOrders(window.loadedOrders || []);
    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
    }
    if (typeof window.renderAgendasGrid === 'function' && document.getElementById('agendas-grid-tbody')) {
      window.renderAgendasGrid();
    }
    if (window._currentFullPageOrderId && typeof window.openOrderFullPage === 'function') {
      window.openOrderFullPage(window._currentFullPageOrderId);
    }

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Consolidación revertida correctamente',
      showConfirmButton: false,
      timer: 3000
    });
  } catch (err) {
    console.error('[ConsolidateOrders] Error revirtiendo consolidación:', err);
    Swal.fire('Error', 'No se pudo revertir la consolidación: ' + (err.message || err), 'error');
  }
}
window.undoOrderConsolidation = undoOrderConsolidation;

async function removeConsolidationPickingRequestItem(orderId) {
  try {
    const { data: existingList } = await supabase
      .from('order_picking_requests')
      .select('*')
      .eq('order_id', orderId);

    if (!Array.isArray(existingList) || existingList.length === 0) return;

    const allOrders = window.loadedOrders || [];
    const ordObj = allOrders.find(o => String(o.id) === String(orderId));

    for (const req of existingList) {
      const items = Array.isArray(req.items) ? req.items : [];
      const remaining = items.filter(it => it && it.id !== 'consolidate_shipping_alert' && !String(it.text || '').includes('CONSOLIDAR ENVÍO'));
      if (remaining.length === items.length) continue;

      if (remaining.length === 0) {
        await supabase.from('order_picking_requests').delete().eq('id', req.id);
        await supabase.from('orders').update({ has_picking_request: false, picking_request_status: null }).eq('id', orderId);
        if (window.pickingRequestsCache && typeof window.pickingRequestsCache.delete === 'function') {
          window.pickingRequestsCache.delete(orderId);
        }
        if (ordObj) {
          ordObj.has_picking_request = false;
          ordObj.picking_request_status = null;
        }
        if (typeof window.syncPickingRequestToPicker === 'function') {
          await window.syncPickingRequestToPicker(orderId, null);
        }
      } else {
        const allChecked = remaining.every(i => i.checked);
        const newSt = allChecked ? 'completada' : 'pendiente';
        const { data: updated } = await supabase
          .from('order_picking_requests')
          .update({ items: remaining, status: newSt, updated_at: new Date().toISOString() })
          .eq('id', req.id)
          .select('*')
          .single();
        if (updated) {
          if (window.pickingRequestsCache && typeof window.pickingRequestsCache.set === 'function') {
            window.pickingRequestsCache.set(orderId, updated);
          }
          if (ordObj) {
            ordObj.has_picking_request = true;
            ordObj.picking_request_status = newSt;
          }
          if (typeof window.syncPickingRequestToPicker === 'function') {
            await window.syncPickingRequestToPicker(orderId, updated);
          }
        }
      }
      if (typeof window.refreshOrderRowPickingBadge === 'function') {
        window.refreshOrderRowPickingBadge(orderId);
      }
    }
  } catch (err) {
    console.warn('[ConsolidateOrders] Aviso limpiando solicitud de picking al deshacer consolidado:', err);
  }
}

/**
 * Propaga automáticamente tracking, courier, agenda, operador o sucursal desde un Pedido Principal
 * hacia sus Pedidos Secundarios consolidados cuando el Principal se actualiza en WMS.
 */
export async function syncConsolidatedChildrenFromPrimary(primaryOrderId, fieldsToSync = {}) {
  if (!primaryOrderId || !fieldsToSync || typeof fieldsToSync !== 'object') return;
  const allOrders = window.loadedOrders || [];
  const primaryOrder = allOrders.find(o => String(o.id) === String(primaryOrderId));
  if (!primaryOrder || !isConsolidatedPrimaryOrder(primaryOrder)) return;

  const info = getOrderConsolidationInfo(primaryOrder);
  const childIds = info.childrenIds || [];
  if (childIds.length === 0) return;

  const allowedKeys = ['tracking_number', 'tracking_url', 'courier', 'agenda', 'operador', 'sucursal_pickeo', 'estado_wms'];
  const cleanPayload = {};
  for (const k of allowedKeys) {
    if (fieldsToSync[k] !== undefined && fieldsToSync[k] !== null && fieldsToSync[k] !== '') {
      cleanPayload[k] = fieldsToSync[k];
    }
  }

  if (Object.keys(cleanPayload).length === 0) return;

  try {
    await supabase
      .from('orders')
      .update(cleanPayload)
      .in('id', childIds);

    childIds.forEach(cId => {
      const childOrd = allOrders.find(o => String(o.id) === String(cId));
      if (childOrd) {
        Object.assign(childOrd, cleanPayload);
      }
    });
  } catch (err) {
    console.warn('[ConsolidateOrders] Aviso sincronizando campos logísticos a pedidos secundarios:', err);
  }
}
window.syncConsolidatedChildrenFromPrimary = syncConsolidatedChildrenFromPrimary;
