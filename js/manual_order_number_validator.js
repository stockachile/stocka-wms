/**
 * WMS STOCKA - Validador de Unicidad y Sugeridor de Alternativas para Pedidos Manuales
 *
 * Verifica en tiempo real, al avanzar en el Wizard y antes de confirmar la inserción
 * si el número de pedido indicado ya existe para el mismo comercio (tanto coincidencia
 * exacta/normalizada como por dígitos limpios según `unique_orders_comercio_clean_number`),
 * alertando al usuario y ofreciendo alternativas verificadas de reemplazo en 1 clic.
 */

import supabase from './supabase.js';

const COMMERCE_META_CACHE_TTL_MS = 5 * 60 * 1000;
const commerceMetaCache = new Map();

function escapeHtmlSafe(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSantiagoDateParts() {
  try {
    const fmt = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return {
      yy: map.year || String(new Date().getFullYear()).slice(-2),
      mm: (map.month || String(new Date().getMonth() + 1)).padStart(2, '0'),
      dd: (map.day || String(new Date().getDate())).padStart(2, '0'),
      hh: (map.hour || String(new Date().getHours())).padStart(2, '0'),
      min: (map.minute || String(new Date().getMinutes())).padStart(2, '0')
    };
  } catch (_) {
    const now = new Date();
    return {
      yy: String(now.getFullYear()).slice(-2),
      mm: String(now.getMonth() + 1).padStart(2, '0'),
      dd: String(now.getDate()).padStart(2, '0'),
      hh: String(now.getHours()).padStart(2, '0'),
      min: String(now.getMinutes()).padStart(2, '0')
    };
  }
}

function formatConflictDate(isoDate) {
  if (!isoDate) return '';
  try {
    return new Date(isoDate).toLocaleDateString('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (_) {
    return String(isoDate).slice(0, 10);
  }
}

/**
 * Obtiene la configuración de sigla y reglas de prefijo del comercio (con caché en memoria).
 */
export async function getManualOrderCommerceMeta(commerce) {
  const cleanCommerce = String(commerce || '').trim();
  if (!cleanCommerce) {
    return { sigla: '', agregarPrefijo: true, prefijoOrigen: '' };
  }

  const cached = commerceMetaCache.get(cleanCommerce.toUpperCase());
  if (cached && (Date.now() - cached.timestamp < COMMERCE_META_CACHE_TTL_MS)) {
    return cached.data;
  }

  // Fallback inmediato desde el <select id="order-select-commerce"> si tiene data-sigla
  let domSigla = '';
  try {
    const selectEl = document.getElementById('order-select-commerce');
    if (selectEl && selectEl.selectedOptions && selectEl.selectedOptions[0]) {
      const opt = selectEl.selectedOptions[0];
      if (opt.value === cleanCommerce && opt.dataset?.sigla) {
        domSigla = opt.dataset.sigla.trim().toUpperCase();
      }
    }
  } catch (_) {}

  let sigla = domSigla;
  let agregarPrefijo = true;
  let prefijoOrigen = '';

  try {
    const [cfgRes, addRes] = await Promise.all([
      supabase
        .from('v_comercios_config')
        .select('sigla')
        .eq('nombre', cleanCommerce)
        .maybeSingle(),
      supabase
        .from('comercios_adicional_config')
        .select('pedido_trae_sigla, plat_siglas_config')
        .eq('comercio', cleanCommerce)
        .maybeSingle()
    ]);

    if (cfgRes?.data?.sigla) {
      sigla = String(cfgRes.data.sigla).trim().toUpperCase();
      if (sigla === 'SIN SIGLA') sigla = '';
    }

    if (addRes?.data) {
      const platConfig = (addRes.data.plat_siglas_config || {})['Manual'];
      if (platConfig) {
        agregarPrefijo = platConfig.agregar_prefijo !== false;
        prefijoOrigen = String(platConfig.prefijo_origen || '').trim().toUpperCase();
      } else {
        agregarPrefijo = !addRes.data.pedido_trae_sigla;
      }
    }
  } catch (err) {
    console.warn('[ManualOrderValidator] Aviso consultando config del comercio:', err?.message || err);
  }

  const meta = { sigla, agregarPrefijo, prefijoOrigen };
  commerceMetaCache.set(cleanCommerce.toUpperCase(), { data: meta, timestamp: Date.now() });
  return meta;
}

/**
 * Aplica las reglas de prefijo de Portal Cliente sobre un número de pedido manual,
 * preservando guiones internos para sufijos derivados (ej. JG9401-1).
 */
export function resolveClientManualOrderNumber(rawInput, commerceMeta = {}) {
  let orderNumber = String(rawInput || '').trim();
  if (!orderNumber) return '';

  const sigla = String(commerceMeta.sigla || '').trim().toUpperCase();
  const prefijoOrigen = String(commerceMeta.prefijoOrigen || '').trim().toUpperCase();
  const agregarPrefijo = commerceMeta.agregarPrefijo !== false;

  // Quitar '#' iniciales para evaluar prefijo origen y sigla sin duplicarlos
  let core = orderNumber.replace(/^[#\s]+/, '').trim();
  if (prefijoOrigen && core.toUpperCase().startsWith(prefijoOrigen)) {
    core = core.substring(prefijoOrigen.length).replace(/^[#\s-]+/, '').trim();
  }

  let resolved = core;
  if (agregarPrefijo && sigla) {
    if (!core.toUpperCase().startsWith(sigla)) {
      resolved = `${sigla}${core}`;
    } else {
      resolved = core;
    }
  }

  // Limpiar caracteres especiales manteniendo guiones internos simples para variantes (-1, -1311, etc.)
  resolved = resolved
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return resolved || orderNumber.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Extrae tokens comparables de un número de pedido.
 */
function extractOrderTokens(value, sigla = '') {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  const noHashUpper = upper.replace(/^[#\s]+/, '');
  const cleanDigits = raw.replace(/[^0-9]/g, '');
  const alnumUpper = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const cleanSigla = String(sigla || '').trim().toUpperCase();
  const coreWithoutSigla = (cleanSigla && alnumUpper.startsWith(cleanSigla) && alnumUpper.length > cleanSigla.length)
    ? alnumUpper.slice(cleanSigla.length)
    : alnumUpper;

  return { raw, upper, noHashUpper, cleanDigits, alnumUpper, coreWithoutSigla };
}

/**
 * Determina si un candidato colisiona con alguno de los pedidos existentes del comercio.
 * Cubre tanto coincidencia exacta/normalizada como la restricción de PostgreSQL
 * `unique_orders_comercio_clean_number` (mismos dígitos numéricos limpios en el mismo comercio).
 */
function findConflictingOrderInList(candidateValues, existingOrders, sigla = '') {
  const candidates = (Array.isArray(candidateValues) ? candidateValues : [candidateValues])
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .map(v => extractOrderTokens(v, sigla));

  if (candidates.length === 0 || !Array.isArray(existingOrders) || existingOrders.length === 0) {
    return null;
  }

  // Priorizar pedidos activos (no cancelados) al reportar el conflicto visual
  const sortedOrders = [...existingOrders].sort((a, b) => {
    const aCanc = String(a?.estado_wms || a?.status || '').toLowerCase().includes('cancel') ? 1 : 0;
    const bCanc = String(b?.estado_wms || b?.status || '').toLowerCase().includes('cancel') ? 1 : 0;
    if (aCanc !== bCanc) return aCanc - bCanc;
    return String(b?.created_at || '').localeCompare(String(a?.created_at || ''));
  });

  for (const ord of sortedOrders) {
    const extRaw = String(ord?.external_order_number || '').trim();
    if (!extRaw) continue;
    const ext = extractOrderTokens(extRaw, sigla);

    for (const cand of candidates) {
      if (ext.upper === cand.upper) return ord;
      if (ext.noHashUpper && ext.noHashUpper === cand.noHashUpper) return ord;

      // Regla BD `unique_orders_comercio_clean_number`: dígitos limpios idénticos dentro del mismo comercio
      if (cand.cleanDigits.length > 0 && ext.cleanDigits.length > 0 && cand.cleanDigits === ext.cleanDigits) {
        return ord;
      }

      // Folios puramente alfabéticos (sin dígitos): comparar con y sin sigla del comercio
      if (cand.cleanDigits.length === 0 && cand.alnumUpper.length > 0) {
        if (ext.alnumUpper === cand.alnumUpper) return ord;
        if (cand.coreWithoutSigla && ext.coreWithoutSigla === cand.coreWithoutSigla) return ord;
      }
    }
  }

  return null;
}

/**
 * Consulta en Supabase (y memoria local) los pedidos del comercio que podrían colisionar
 * con uno o varios números candidatos, además de correlativos vecinos para sugerencias.
 */
async function fetchRelevantOrdersForCandidates(commerce, candidateStrings, sigla = '', includeNeighbors = false) {
  const cleanCommerce = String(commerce || '').trim();
  if (!cleanCommerce) return [];

  const list = (Array.isArray(candidateStrings) ? candidateStrings : [candidateStrings])
    .map(s => String(s || '').trim())
    .filter(Boolean);

  if (list.length === 0) return [];

  const exactVariants = new Set();
  const safeLikeTokens = new Set();
  const cleanSigla = String(sigla || '').trim().toUpperCase();

  list.forEach(item => {
    const tok = extractOrderTokens(item, cleanSigla);
    const noHash = item.replace(/^[#\s]+/, '').trim();

    [
      item,
      item.toUpperCase(),
      noHash,
      noHash.toUpperCase(),
      `#${noHash}`,
      `#${noHash.toUpperCase()}`
    ].forEach(v => { if (v) exactVariants.add(v); });

    if (cleanSigla) {
      [
        `${cleanSigla}${noHash}`,
        `${cleanSigla}${noHash.toUpperCase()}`,
        `${cleanSigla}#${noHash}`,
        `${cleanSigla}#${noHash.toUpperCase()}`
      ].forEach(v => { if (v) exactVariants.add(v); });
    }

    if (tok.cleanDigits) {
      exactVariants.add(tok.cleanDigits);
      exactVariants.add(`#${tok.cleanDigits}`);
      if (cleanSigla) {
        exactVariants.add(`${cleanSigla}${tok.cleanDigits}`);
        exactVariants.add(`${cleanSigla}#${tok.cleanDigits}`);
      }
      if (tok.cleanDigits.length <= 4) {
        exactVariants.add(`MANUAL-${tok.cleanDigits}`);
        exactVariants.add(`#MANUAL-${tok.cleanDigits}`);
        if (cleanSigla) {
          exactVariants.add(`${cleanSigla}#MANUAL-${tok.cleanDigits}`);
          exactVariants.add(`${cleanSigla}MANUAL${tok.cleanDigits}`);
        }
      }

      safeLikeTokens.add(tok.cleanDigits);

      if (includeNeighbors) {
        try {
          const baseBig = BigInt(tok.cleanDigits);
          for (let step = 1n; step <= 8n; step++) {
            safeLikeTokens.add(String(baseBig + step));
          }
        } catch (_) {}
      }
    } else {
      const safeAlpha = noHash.replace(/[^a-zA-Z0-9_-]/g, '');
      if (safeAlpha) safeLikeTokens.add(safeAlpha);
    }
  });

  const selectCols = 'id, external_order_number, customer_name, created_at, estado_wms, status, origen';
  const queries = [];

  const exactArr = Array.from(exactVariants).filter(Boolean).slice(0, 70);
  if (exactArr.length > 0) {
    queries.push(
      supabase
        .from('orders')
        .select(selectCols)
        .eq('comercio', cleanCommerce)
        .in('external_order_number', exactArr)
    );
  }

  const orClauses = Array.from(safeLikeTokens)
    .filter(t => /^[a-zA-Z0-9_-]+$/.test(t))
    .slice(0, 18)
    .map(t => `external_order_number.ilike.%${t}%`);

  if (orClauses.length > 0) {
    queries.push(
      supabase
        .from('orders')
        .select(selectCols)
        .eq('comercio', cleanCommerce)
        .or(orClauses.join(','))
        .order('created_at', { ascending: false })
        .limit(400)
    );
  }

  const mergedMap = new Map();
  const addOrder = (o) => {
    if (!o || !o.external_order_number) return;
    const key = o.id ? String(o.id) : `ext_${String(o.external_order_number).toUpperCase()}`;
    if (!mergedMap.has(key)) mergedMap.set(key, o);
  };

  try {
    const results = await Promise.all(queries);
    results.forEach(res => {
      if (Array.isArray(res?.data)) {
        res.data.forEach(addOrder);
      }
    });
  } catch (err) {
    console.warn('[ManualOrderValidator] Error consultando pedidos del comercio:', err?.message || err);
  }

  // Complementar con órdenes cargadas en memoria local (Admin / Cliente)
  [window.loadedOrders, window.clientLoadedOrders].forEach(arr => {
    if (Array.isArray(arr)) {
      arr.forEach(o => {
        if (o && String(o.comercio || '').trim() === cleanCommerce) {
          addOrder(o);
        }
      });
    }
  });

  return Array.from(mergedMap.values());
}

/**
 * Construye candidatos alternativos legibles y verifica contra Supabase que estén 100% disponibles.
 */
async function generateVerifiedAlternatives(rawInput, commerce, mode, commerceMeta, initialOrders = []) {
  const trimmed = String(rawInput || '').trim();
  const sigla = String(commerceMeta?.sigla || '').trim().toUpperCase();
  const { yy, mm, dd } = getSantiagoDateParts();

  let knownOrders = [...initialOrders];

  const isTakenLocally = (candInput, usedCleanSet, usedUpperSet) => {
    const cTrim = String(candInput || '').trim();
    if (!cTrim) return true;
    const checkVals = [cTrim];
    if (mode === 'client') {
      const resolved = resolveClientManualOrderNumber(cTrim, commerceMeta);
      if (resolved) checkVals.push(resolved);
    }
    for (const v of checkVals) {
      const t = extractOrderTokens(v, sigla);
      if (usedUpperSet.has(t.upper)) return true;
      if (t.cleanDigits && usedCleanSet.has(t.cleanDigits)) return true;
    }
    return Boolean(findConflictingOrderInList(checkVals, knownOrders, sigla));
  };

  // Si el usuario ya ingresó un derivado como "#9401-1", tomar "#9401" como base para sugerir "#9401-2"
  const existingSplitMatch = trimmed.match(/^(.+\d)-(\d{1,2})$/);
  const derivativeBase = existingSplitMatch ? existingSplitMatch[1] : trimmed;
  const startSeq = existingSplitMatch ? (parseInt(existingSplitMatch[2], 10) + 1) : 1;

  const pickPassCandidates = () => {
    const picked = [];
    const usedClean = new Set();
    const usedUpper = new Set();

    const registerPick = (obj) => {
      if (!obj || !obj.value) return;
      picked.push(obj);
      const vals = [obj.value];
      if (mode === 'client') vals.push(resolveClientManualOrderNumber(obj.value, commerceMeta));
      vals.forEach(v => {
        const t = extractOrderTokens(v, sigla);
        if (t.upper) usedUpper.add(t.upper);
        if (t.cleanDigits) usedClean.add(t.cleanDigits);
      });
    };

    // 1. Variante derivada / sufijo (ej. #9401-1, #9401-2, o #9401-01 si hay choque de 5 dígitos)
    let foundDerivative = null;
    for (let seq = startSeq; seq <= startSeq + 40; seq++) {
      const cand = `${derivativeBase}-${seq}`;
      if (!isTakenLocally(cand, usedClean, usedUpper)) {
        foundDerivative = cand;
        break;
      }
    }
    if (!foundDerivative) {
      for (let seq = 1; seq <= 30; seq++) {
        const cand = `${derivativeBase}-0${seq}`;
        if (!isTakenLocally(cand, usedClean, usedUpper)) {
          foundDerivative = cand;
          break;
        }
      }
    }
    if (foundDerivative) {
      registerPick({
        type: 'derivado',
        value: foundDerivative,
        badge: 'Variante derivada',
        description: 'Ideal para reenvío, reposición o segundo bulto asociado'
      });
    }

    // 2. Siguiente correlativo disponible (ej. #9402, PED-0051)
    let foundCorrelative = null;
    const lastNumMatch = derivativeBase.match(/^(.*?)(\d+)([^0-9]*)$/);
    if (lastNumMatch) {
      const [, prefixPart, digitsPart, suffixPart] = lastNumMatch;
      try {
        const baseNum = BigInt(digitsPart);
        const padLen = digitsPart.length;
        for (let add = 1n; add <= 80n; add++) {
          const nextNumStr = String(baseNum + add).padStart(padLen, '0');
          const cand = `${prefixPart}${nextNumStr}${suffixPart}`;
          if (!isTakenLocally(cand, usedClean, usedUpper)) {
            foundCorrelative = cand;
            break;
          }
        }
      } catch (_) {}
    } else {
      for (let n = 2; n <= 50; n++) {
        const cand = `${derivativeBase}-${n}`;
        if (!isTakenLocally(cand, usedClean, usedUpper)) {
          foundCorrelative = cand;
          break;
        }
      }
    }
    if (foundCorrelative) {
      registerPick({
        type: 'correlativo',
        value: foundCorrelative,
        badge: 'Siguiente correlativo',
        description: 'Continúa la numeración correlativa disponible del comercio'
      });
    }

    // 3. Con sufijo de fecha corta (ej. #9401-1311)
    let foundDated = null;
    const dateBaseTag = `${dd}${mm}`;
    const primaryDated = `${derivativeBase}-${dateBaseTag}`;
    if (!isTakenLocally(primaryDated, usedClean, usedUpper)) {
      foundDated = primaryDated;
    } else {
      for (let i = 1; i <= 15; i++) {
        const cand = `${derivativeBase}-${dateBaseTag}${i}`;
        if (!isTakenLocally(cand, usedClean, usedUpper)) {
          foundDated = cand;
          break;
        }
      }
    }
    if (foundDated) {
      registerPick({
        type: 'fecha',
        value: foundDated,
        badge: `Con fecha (${dd}/${mm})`,
        description: 'Mantiene la referencia original agregando día y mes'
      });
    }

    // 4. Folio Manual Único estándar Stocka
    let foundManualUnique = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      let cand = '';
      if (mode === 'client') {
        const rand4 = Math.floor(1000 + Math.random() * 9000);
        cand = `MAN${yy}${mm}${dd}${rand4}`;
      } else {
        // Siempre prefijar YYMMDD + 4 dígitos aleatorios (10 dígitos) para evitar colisiones
        // con correlativos de Shopify/WooCommerce bajo unique_orders_comercio_clean_number
        const rand4 = Math.floor(1000 + Math.random() * 9000);
        const suffixNum = `${yy}${mm}${dd}${rand4}`;
        cand = sigla ? `${sigla}#MANUAL-${suffixNum}` : `#MANUAL-${suffixNum}`;
      }
      if (!isTakenLocally(cand, usedClean, usedUpper)) {
        foundManualUnique = cand;
        break;
      }
    }
    if (foundManualUnique) {
      registerPick({
        type: 'manual',
        value: foundManualUnique,
        badge: 'Folio manual único',
        description: 'Código manual nuevo sin conflicto con pedidos previos'
      });
    }

    return picked;
  };

  let candidates = pickPassCandidates();

  // Verificar en lote contra Supabase todos los candidatos sugeridos para garantizar disponibilidad real
  for (let pass = 0; pass < 2; pass++) {
    if (candidates.length === 0) break;
    const stringsToVerify = [];
    candidates.forEach(c => {
      stringsToVerify.push(c.value);
      if (mode === 'client') {
        stringsToVerify.push(resolveClientManualOrderNumber(c.value, commerceMeta));
      }
    });

    const dbRows = await fetchRelevantOrdersForCandidates(commerce, stringsToVerify, sigla, false);
    const prevCount = knownOrders.length;
    const existingKeys = new Set(knownOrders.map(o => o.id ? String(o.id) : `ext_${String(o.external_order_number).toUpperCase()}`));
    dbRows.forEach(r => {
      const k = r.id ? String(r.id) : `ext_${String(r.external_order_number).toUpperCase()}`;
      if (!existingKeys.has(k)) {
        existingKeys.add(k);
        knownOrders.push(r);
      }
    });

    const anyCollisionAfterDb = candidates.some(c => {
      const checkVals = mode === 'client'
        ? [c.value, resolveClientManualOrderNumber(c.value, commerceMeta)]
        : [c.value];
      return Boolean(findConflictingOrderInList(checkVals, knownOrders, sigla));
    });

    if (!anyCollisionAfterDb) break;
    if (knownOrders.length === prevCount && pass > 0) break;
    candidates = pickPassCandidates();
  }

  return candidates.map(c => ({
    ...c,
    resolvedPreview: mode === 'client' ? resolveClientManualOrderNumber(c.value, commerceMeta) : c.value
  }));
}

/**
 * Verifica si un número de pedido manual está disponible para el comercio indicado.
 * Si está repetido, retorna el pedido en conflicto y alternativas verificadas listas para usar.
 */
export async function checkManualOrderNumberAvailability(rawOrderNumber, commerce, options = {}) {
  const mode = options.mode === 'client' ? 'client' : 'admin';
  const includeSuggestions = options.includeSuggestions !== false;
  const trimmed = String(rawOrderNumber || '').trim();
  const cleanCommerce = String(commerce || '').trim() || 'STOCKA';

  if (!trimmed) {
    return {
      isEmpty: true,
      isDuplicate: false,
      commerce: cleanCommerce,
      rawInput: '',
      resolvedNumber: '',
      conflictingOrder: null,
      suggestions: []
    };
  }

  const commerceMeta = await getManualOrderCommerceMeta(cleanCommerce);
  const resolvedNumber = mode === 'client'
    ? resolveClientManualOrderNumber(trimmed, commerceMeta)
    : trimmed;

  const checkTargets = mode === 'client' && resolvedNumber && resolvedNumber !== trimmed
    ? [trimmed, resolvedNumber]
    : [trimmed];

  const existingOrders = await fetchRelevantOrdersForCandidates(
    cleanCommerce,
    checkTargets,
    commerceMeta.sigla,
    true
  );

  const conflictingOrder = findConflictingOrderInList(checkTargets, existingOrders, commerceMeta.sigla);

  if (!conflictingOrder) {
    return {
      isEmpty: false,
      isDuplicate: false,
      commerce: cleanCommerce,
      rawInput: trimmed,
      resolvedNumber,
      commerceMeta,
      conflictingOrder: null,
      suggestions: []
    };
  }

  const suggestions = includeSuggestions
    ? await generateVerifiedAlternatives(trimmed, cleanCommerce, mode, commerceMeta, existingOrders)
    : [];

  return {
    isEmpty: false,
    isDuplicate: true,
    commerce: cleanCommerce,
    rawInput: trimmed,
    resolvedNumber,
    commerceMeta,
    conflictingOrder,
    suggestions
  };
}

/**
 * Genera un número automático de pedido manual garantizando que no colisione con ningún pedido del comercio.
 */
export async function generateUniqueAutoManualOrderNumber(commerce, options = {}) {
  const mode = options.mode === 'client' ? 'client' : 'admin';
  const cleanCommerce = String(commerce || '').trim() || 'STOCKA';
  const commerceMeta = await getManualOrderCommerceMeta(cleanCommerce);
  const sigla = commerceMeta.sigla;
  const { yy, mm, dd, hh, min } = getSantiagoDateParts();

  for (let attempt = 0; attempt < 8; attempt++) {
    let rawCandidate = '';
    if (mode === 'client') {
      const rand4 = Math.floor(1000 + Math.random() * 9000);
      rawCandidate = `MAN${yy}${mm}${dd}${hh}${min}${rand4}`;
    } else {
      // Siempre prefijar YYMMDD + 4 dígitos aleatorios (10 dígitos) para evitar colisiones
      // futuras con correlativos de tiendas (Shopify/WooCommerce/Jumpseller)
      const rand4 = Math.floor(1000 + Math.random() * 9000);
      const suffix = attempt < 4
        ? `${yy}${mm}${dd}${rand4}`
        : `${yy}${mm}${dd}${hh}${min}${Math.floor(100 + Math.random() * 900)}`;
      rawCandidate = sigla ? `${sigla}#MANUAL-${suffix}` : `#MANUAL-${suffix}`;
    }

    const check = await checkManualOrderNumberAvailability(rawCandidate, cleanCommerce, {
      mode,
      includeSuggestions: false
    });

    if (!check.isDuplicate) {
      return mode === 'client' ? check.resolvedNumber : check.rawInput;
    }
  }

  // Fallback determinístico con fecha + timestamp milisegundos (evita colisiones numéricas cortas)
  const tsTail = String(Date.now()).slice(-6);
  if (mode === 'client') {
    return resolveClientManualOrderNumber(`MAN${yy}${mm}${dd}${tsTail}`, commerceMeta);
  }
  return sigla ? `${sigla}#MANUAL-${yy}${mm}${dd}${tsTail}` : `#MANUAL-${yy}${mm}${dd}${tsTail}`;
}

/**
 * Limpia el estado visual del validador inline en el Paso 3 del Wizard.
 */
export function resetManualOrderNumberFeedback() {
  const feedbackEl = document.getElementById('order-external-id-feedback');
  const inputEl = document.getElementById('order-cust-external-id');
  if (feedbackEl) {
    feedbackEl.style.display = 'none';
    feedbackEl.innerHTML = '';
  }
  if (inputEl) {
    inputEl.style.borderColor = '';
    inputEl.style.boxShadow = '';
  }
  window._lastManualOrderNumberCheck = null;
}

/**
 * Aplica un reemplazo elegido (número alternativo o cambio a modo automático) en el formulario activo.
 */
export function applyManualOrderNumberReplacement(replacement, mode = 'admin') {
  const autoCheckbox = document.getElementById('order-number-auto');
  const inputEl = document.getElementById('order-cust-external-id');
  const summaryEl = document.getElementById('summary-external-id');

  if (!replacement) return;

  if (replacement.useAuto) {
    if (autoCheckbox) {
      autoCheckbox.checked = true;
    }
    if (inputEl) {
      inputEl.value = '';
      inputEl.style.display = 'none';
    }
    resetManualOrderNumberFeedback();
    if (summaryEl) {
      summaryEl.textContent = 'Autogenerado por el sistema';
    }
    return;
  }

  const newValue = String(replacement.value || '').trim();
  if (!newValue) return;

  if (autoCheckbox) {
    autoCheckbox.checked = false;
  }
  if (inputEl) {
    inputEl.style.display = 'block';
    inputEl.value = newValue;
  }
  if (summaryEl) {
    summaryEl.textContent = newValue;
  }

  if (typeof window.triggerManualOrderNumberLiveCheck === 'function') {
    window.triggerManualOrderNumberLiveCheck(mode, true);
  }
}

/**
 * Renderiza el estado de verificación inline debajo de `#order-cust-external-id` en el Paso 3.
 */
function renderInlineOrderNumberFeedback(result, mode) {
  const feedbackEl = document.getElementById('order-external-id-feedback');
  const inputEl = document.getElementById('order-cust-external-id');
  const autoCheckbox = document.getElementById('order-number-auto');

  if (!feedbackEl || !inputEl) return;
  if (autoCheckbox?.checked || !result || result.isEmpty) {
    resetManualOrderNumberFeedback();
    return;
  }

  if (!result.isDuplicate) {
    inputEl.style.borderColor = '#22c55e';
    inputEl.style.boxShadow = '0 0 0 2px rgba(34, 197, 94, 0.14)';
    const resolvedNote = (mode === 'client' && result.resolvedNumber && result.resolvedNumber.toUpperCase() !== result.rawInput.replace(/^#+/, '').toUpperCase())
      ? ` <span style="font-weight: 500; color: var(--color-text-muted);">(se guardará como <strong>${escapeHtmlSafe(result.resolvedNumber)}</strong>)</span>`
      : '';

    feedbackEl.style.display = 'block';
    feedbackEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.6rem; margin-top: 0.15rem; background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: var(--radius-sm); font-size: 0.76rem; color: #15803d; font-weight: 600;">
        <i class="ri-checkbox-circle-fill" style="font-size: 0.95rem; color: #16a34a; flex-shrink: 0;"></i>
        <span>Número <strong>${escapeHtmlSafe(result.rawInput)}</strong> disponible en <strong>${escapeHtmlSafe(result.commerce)}</strong>${resolvedNote}</span>
      </div>
    `;
    return;
  }

  // Estado repetido: alerta clara + alternativas de reemplazo en 1 clic
  inputEl.style.borderColor = '#ef4444';
  inputEl.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.15)';

  const conflict = result.conflictingOrder || {};
  const existingFolio = conflict.external_order_number || result.rawInput;
  const conflictCustomer = conflict.customer_name ? ` · Cliente: <strong>${escapeHtmlSafe(conflict.customer_name)}</strong>` : '';
  const conflictStatus = conflict.estado_wms || conflict.status || '';
  const conflictStatusHtml = conflictStatus ? ` · Estado: <strong>${escapeHtmlSafe(conflictStatus)}</strong>` : '';
  const conflictDate = formatConflictDate(conflict.created_at);
  const conflictDateHtml = conflictDate ? ` (${escapeHtmlSafe(conflictDate)})` : '';

  const chipsHtml = (result.suggestions || []).map((sug, idx) => `
    <button
      type="button"
      class="manual-order-alt-chip"
      data-alt-idx="${idx}"
      title="${escapeHtmlSafe(sug.description || '')}"
      style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.28rem 0.6rem; background: var(--color-surface); color: var(--color-primary); border: 1px solid rgba(37, 99, 235, 0.38); border-radius: 999px; font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.15s; font-family: monospace;"
      onmouseover="this.style.background='var(--color-primary)'; this.style.color='#ffffff';"
      onmouseout="this.style.background='var(--color-surface)'; this.style.color='var(--color-primary)';"
    >
      <i class="ri-loop-left-line" style="font-family: inherit;"></i>
      <span>${escapeHtmlSafe(sug.value)}</span>
      <span style="font-family: var(--font-family, sans-serif); font-size: 0.67rem; font-weight: 600; opacity: 0.82;">· ${escapeHtmlSafe(sug.badge)}</span>
    </button>
  `).join('');

  feedbackEl.style.display = 'block';
  feedbackEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.55rem; padding: 0.7rem 0.8rem; margin-top: 0.2rem; background: rgba(239, 68, 68, 0.07); border: 1px solid rgba(239, 68, 68, 0.42); border-radius: var(--radius-sm); font-size: 0.78rem; color: var(--color-text-main);">
      <div style="display: flex; align-items: flex-start; gap: 0.45rem;">
        <i class="ri-error-warning-fill" style="color: #dc2626; font-size: 1.08rem; margin-top: 1px; flex-shrink: 0;"></i>
        <div style="display: flex; flex-direction: column; gap: 0.15rem; line-height: 1.35;">
          <span style="font-weight: 700; color: #dc2626;">Número de pedido repetido en ${escapeHtmlSafe(result.commerce)}</span>
          <span style="color: var(--color-text-muted); font-size: 0.74rem;">
            Ya está asignado al pedido <strong>${escapeHtmlSafe(existingFolio)}</strong>${conflictCustomer}${conflictStatusHtml}${conflictDateHtml}.
          </span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.38rem; border-top: 1px dashed rgba(239, 68, 68, 0.28); padding-top: 0.48rem;">
        <span style="font-size: 0.73rem; font-weight: 600; color: var(--color-text-muted); display: flex; align-items: center; gap: 0.25rem;">
          <i class="ri-magic-line" style="color: var(--color-primary); font-size: 0.9rem;"></i>
          Reemplazar fácilmente con una opción disponible:
        </span>
        <div style="display: flex; flex-wrap: wrap; gap: 0.38rem;">
          ${chipsHtml}
          <button
            type="button"
            class="manual-order-alt-auto-btn"
            title="Activar generación automática de número único por el sistema"
            style="display: inline-flex; align-items: center; gap: 0.28rem; padding: 0.28rem 0.6rem; background: rgba(124, 58, 237, 0.1); color: #7c3aed; border: 1px solid rgba(124, 58, 237, 0.35); border-radius: 999px; font-size: 0.73rem; font-weight: 700; cursor: pointer; transition: all 0.15s;"
            onmouseover="this.style.background='#7c3aed'; this.style.color='#ffffff';"
            onmouseout="this.style.background='rgba(124, 58, 237, 0.1)'; this.style.color='#7c3aed';"
          >
            <i class="ri-sparkling-2-line"></i> Automático
          </button>
        </div>
      </div>
    </div>
  `;

  feedbackEl.querySelectorAll('.manual-order-alt-chip').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.getAttribute('data-alt-idx'), 10);
      const chosen = result.suggestions?.[idx];
      if (chosen) {
        applyManualOrderNumberReplacement({ value: chosen.value }, mode);
      }
    };
  });

  const autoBtn = feedbackEl.querySelector('.manual-order-alt-auto-btn');
  if (autoBtn) {
    autoBtn.onclick = () => {
      applyManualOrderNumberReplacement({ useAuto: true }, mode);
    };
  }
}

/**
 * Configura los listeners en vivo sobre `#order-cust-external-id`, `#order-number-auto` y `#order-select-commerce`.
 */
export function setupManualOrderNumberLiveValidation(mode = 'admin', getCommerceFn = null) {
  const inputEl = document.getElementById('order-cust-external-id');
  const autoCheckbox = document.getElementById('order-number-auto');
  const feedbackEl = document.getElementById('order-external-id-feedback');

  if (!inputEl || !autoCheckbox) return;

  const resolveCurrentCommerce = () => {
    if (typeof getCommerceFn === 'function') {
      const c = getCommerceFn();
      if (c) return String(c).trim();
    }
    const sel = document.getElementById('order-select-commerce');
    return (sel && sel.value ? sel.value.trim() : '') || 'STOCKA';
  };

  let debounceTimer = null;
  let activeSeq = 0;

  const runLiveCheck = async (currentMode = mode, immediate = false) => {
    clearTimeout(debounceTimer);

    if (autoCheckbox.checked) {
      resetManualOrderNumberFeedback();
      return;
    }

    const rawVal = inputEl.value.trim();
    if (!rawVal) {
      resetManualOrderNumberFeedback();
      return;
    }

    const execute = async () => {
      const seq = ++activeSeq;
      const commerce = resolveCurrentCommerce();

      if (feedbackEl) {
        feedbackEl.style.display = 'block';
        feedbackEl.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.2rem; font-size: 0.75rem; color: var(--color-text-muted);">
            <i class="ri-loader-4-line spin" style="color: var(--color-primary);"></i>
            <span>Verificando disponibilidad en <strong>${escapeHtmlSafe(commerce)}</strong>...</span>
          </div>
        `;
      }

      const checkResult = await checkManualOrderNumberAvailability(rawVal, commerce, {
        mode: currentMode,
        includeSuggestions: true
      });

      if (seq !== activeSeq) return;
      if (autoCheckbox.checked || inputEl.value.trim() !== rawVal) return;

      window._lastManualOrderNumberCheck = {
        ...checkResult,
        timestamp: Date.now()
      };
      renderInlineOrderNumberFeedback(checkResult, currentMode);
    };

    if (immediate) {
      await execute();
    } else {
      debounceTimer = setTimeout(execute, 360);
    }
  };

  window.triggerManualOrderNumberLiveCheck = runLiveCheck;

  if (!inputEl._hasManualOrderValidatorBound) {
    inputEl._hasManualOrderValidatorBound = true;

    inputEl.addEventListener('input', () => {
      inputEl.style.borderColor = '';
      inputEl.style.boxShadow = '';
      runLiveCheck(mode, false);
    });

    inputEl.addEventListener('blur', () => {
      if (!autoCheckbox.checked && inputEl.value.trim()) {
        const last = window._lastManualOrderNumberCheck;
        const currComm = resolveCurrentCommerce();
        if (!last || last.rawInput !== inputEl.value.trim() || last.commerce !== currComm) {
          runLiveCheck(mode, true);
        }
      }
    });
  }

  // Asegurar que al alternar el checkbox automático se limpie/ejecute la validación
  if (!autoCheckbox._hasManualOrderValidatorBound) {
    autoCheckbox._hasManualOrderValidatorBound = true;
    autoCheckbox.addEventListener('change', () => {
      if (autoCheckbox.checked) {
        resetManualOrderNumberFeedback();
      } else if (inputEl.value.trim()) {
        runLiveCheck(mode, true);
      }
    });
  }
}

/**
 * Muestra un modal interactivo (SweetAlert2) cuando el usuario intenta avanzar o confirmar
 * con un número de pedido repetido, permitiendo reemplazarlo con 1 clic o ingresar otro validado.
 *
 * @returns {Promise<{ action: 'replace'|'auto'|'cancel', value?: string, resolvedNumber?: string }>}
 */
export async function promptDuplicateOrderNumberResolution(duplicateResult, options = {}) {
  const mode = options.mode === 'client' ? 'client' : 'admin';
  const contextStage = options.stage === 'submit' ? 'submit' : 'wizard';
  const commerce = duplicateResult?.commerce || 'STOCKA';
  const rawInput = duplicateResult?.rawInput || '';
  const conflict = duplicateResult?.conflictingOrder || {};
  const suggestions = Array.isArray(duplicateResult?.suggestions) && duplicateResult.suggestions.length > 0
    ? duplicateResult.suggestions
    : (await checkManualOrderNumberAvailability(rawInput, commerce, { mode, includeSuggestions: true })).suggestions || [];

  // Actualizar también el panel inline del Paso 3 para que quede sincronizado
  renderInlineOrderNumberFeedback({ ...duplicateResult, suggestions }, mode);

  if (typeof window.Swal === 'undefined') {
    const firstAlt = suggestions[0]?.value || '';
    const msg = `El número de pedido "${rawInput}" ya existe para el comercio ${commerce}` +
      (conflict.external_order_number ? ` (Pedido ${conflict.external_order_number}).` : '.') +
      (firstAlt ? `\n\n¿Deseas reemplazarlo por "${firstAlt}"?` : '');
    if (firstAlt && window.confirm(msg)) {
      applyManualOrderNumberReplacement({ value: firstAlt }, mode);
      const commerceMeta = duplicateResult?.commerceMeta || await getManualOrderCommerceMeta(commerce);
      return {
        action: 'replace',
        value: firstAlt,
        resolvedNumber: mode === 'client' ? resolveClientManualOrderNumber(firstAlt, commerceMeta) : firstAlt
      };
    }
    return { action: 'cancel' };
  }

  const existingFolio = conflict.external_order_number || rawInput;
  const conflictCustomer = conflict.customer_name || 'Sin nombre';
  const conflictStatus = conflict.estado_wms || conflict.status || 'Registrado';
  const conflictDate = formatConflictDate(conflict.created_at);

  const actionLabel = contextStage === 'submit' ? 'Usar y crear pedido' : 'Usar y continuar';

  const suggestionsCardsHtml = suggestions.map((sug, idx) => {
    const clientPreview = (mode === 'client' && sug.resolvedPreview && sug.resolvedPreview.toUpperCase() !== sug.value.replace(/^#+/, '').toUpperCase())
      ? `<span style="font-size: 0.7rem; color: var(--color-text-muted);">→ ${escapeHtmlSafe(sug.resolvedPreview)}</span>`
      : '';
    return `
      <button
        type="button"
        class="swal-dup-order-option"
        data-sug-idx="${idx}"
        style="width: 100%; text-align: left; padding: 0.65rem 0.85rem; background: var(--color-surface, #ffffff); border: 1.5px solid var(--color-border, #cbd5e1); border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; transition: all 0.15s;"
        onmouseover="this.style.borderColor='#2563eb'; this.style.background='rgba(37, 99, 235, 0.05)';"
        onmouseout="this.style.borderColor='var(--color-border, #cbd5e1)'; this.style.background='var(--color-surface, #ffffff)';"
      >
        <div style="display: flex; flex-direction: column; gap: 0.15rem; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <span style="font-family: monospace; font-size: 0.92rem; font-weight: 800; color: var(--color-primary, #2563eb);">${escapeHtmlSafe(sug.value)}</span>
            <span style="font-size: 0.68rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: rgba(37, 99, 235, 0.12); color: #2563eb;">${escapeHtmlSafe(sug.badge)}</span>
            ${clientPreview}
          </div>
          <span style="font-size: 0.74rem; color: var(--color-text-muted, #64748b);">${escapeHtmlSafe(sug.description || '')}</span>
        </div>
        <span style="flex-shrink: 0; font-size: 0.75rem; font-weight: 700; color: #2563eb; display: inline-flex; align-items: center; gap: 0.2rem; white-space: nowrap;">
          ${actionLabel} <i class="ri-arrow-right-line"></i>
        </span>
      </button>
    `;
  }).join('');

  let quickSelectedResolution = null;

  const swalResult = await window.Swal.fire({
    icon: 'warning',
    title: 'Número de Pedido Repetido',
    width: 580,
    html: `
      <div style="text-align: left; font-size: 0.86rem; display: flex; flex-direction: column; gap: 0.85rem; color: var(--color-text-main, #0f172a);">
        <p style="margin: 0; line-height: 1.45; color: var(--color-text-muted, #475569);">
          El número <strong style="color: #dc2626; font-family: monospace; font-size: 0.92rem;">${escapeHtmlSafe(rawInput)}</strong> ya se encuentra registrado en el comercio <strong>${escapeHtmlSafe(commerce)}</strong> y no puede repetirse.
        </p>

        <div style="background: rgba(239, 68, 68, 0.07); border: 1px solid rgba(239, 68, 68, 0.32); border-radius: 8px; padding: 0.65rem 0.85rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.22rem;">
          <div style="font-weight: 700; color: #dc2626; display: flex; align-items: center; gap: 0.35rem;">
            <i class="ri-file-warning-line"></i> Pedido existente detectado: <span style="font-family: monospace;">${escapeHtmlSafe(existingFolio)}</span>
          </div>
          <div style="color: var(--color-text-muted, #475569); font-size: 0.76rem;">
            Destinatario: <strong>${escapeHtmlSafe(conflictCustomer)}</strong> · Estado: <strong>${escapeHtmlSafe(conflictStatus)}</strong>${conflictDate ? ` · Fecha: <strong>${escapeHtmlSafe(conflictDate)}</strong>` : ''}
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.45rem;">
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-main, #0f172a); display: flex; align-items: center; gap: 0.35rem;">
            <i class="ri-magic-line" style="color: #2563eb;"></i> Elige una alternativa disponible con un clic:
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.45rem;">
            ${suggestionsCardsHtml}
            <button
              type="button"
              id="swal-dup-order-auto-btn"
              style="width: 100%; text-align: left; padding: 0.6rem 0.85rem; background: rgba(124, 58, 237, 0.07); border: 1.5px dashed rgba(124, 58, 237, 0.42); border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; transition: all 0.15s;"
              onmouseover="this.style.background='rgba(124, 58, 237, 0.14)';"
              onmouseout="this.style.background='rgba(124, 58, 237, 0.07)';"
            >
              <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                <span style="font-size: 0.83rem; font-weight: 700; color: #7c3aed; display: flex; align-items: center; gap: 0.35rem;">
                  <i class="ri-sparkling-2-line"></i> Generar automáticamente por el sistema
                </span>
                <span style="font-size: 0.73rem; color: var(--color-text-muted, #64748b);">Asigna un código único automático sin colisiones</span>
              </div>
              <span style="flex-shrink: 0; font-size: 0.75rem; font-weight: 700; color: #7c3aed; white-space: nowrap;">
                Activar <i class="ri-arrow-right-line"></i>
              </span>
            </button>
          </div>
        </div>

        <div style="border-top: 1px solid var(--color-border, #e2e8f0); padding-top: 0.7rem; display: flex; flex-direction: column; gap: 0.35rem;">
          <label for="swal-custom-order-num-input" style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted, #475569);">
            O escribe otro número de pedido personalizado:
          </label>
          <input
            type="text"
            id="swal-custom-order-num-input"
            class="form-input"
            placeholder="Ej: ${escapeHtmlSafe(suggestions[0]?.value || '#9401-1')}"
            value=""
            style="width: 100%; box-sizing: border-box; font-size: 0.86rem; padding: 0.5rem 0.7rem; font-family: monospace;"
          >
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: contextStage === 'submit' ? 'Validar y Crear Pedido' : 'Validar y Continuar',
    cancelButtonText: 'Volver a revisar',
    confirmButtonColor: '#2563eb',
    didOpen: (popup) => {
      const container = window.Swal.getContainer();
      if (container) container.style.zIndex = '20000';

      popup.querySelectorAll('.swal-dup-order-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-sug-idx'), 10);
          const chosen = suggestions[idx];
          if (chosen) {
            quickSelectedResolution = {
              action: 'replace',
              value: chosen.value,
              resolvedNumber: chosen.resolvedPreview || chosen.value
            };
            window.Swal.close();
          }
        });
      });

      const autoBtn = popup.querySelector('#swal-dup-order-auto-btn');
      if (autoBtn) {
        autoBtn.addEventListener('click', () => {
          quickSelectedResolution = { action: 'auto' };
          window.Swal.close();
        });
      }

      const customInp = popup.querySelector('#swal-custom-order-num-input');
      if (customInp) {
        customInp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            window.Swal.clickConfirm();
          }
        });
      }
    },
    preConfirm: async () => {
      const customInp = document.getElementById('swal-custom-order-num-input');
      const typed = customInp ? customInp.value.trim() : '';
      if (!typed) {
        window.Swal.showValidationMessage('Selecciona una de las alternativas de arriba o escribe un número de pedido distinto.');
        return false;
      }

      const recheck = await checkManualOrderNumberAvailability(typed, commerce, {
        mode,
        includeSuggestions: false
      });

      if (recheck.isDuplicate) {
        const conflictNo = recheck.conflictingOrder?.external_order_number || typed;
        window.Swal.showValidationMessage(`El número "${typed}" también existe en ${commerce} (Pedido ${conflictNo}). Prueba otra opción.`);
        return false;
      }

      return {
        action: 'replace',
        value: recheck.rawInput,
        resolvedNumber: recheck.resolvedNumber
      };
    }
  });

  const finalResolution = quickSelectedResolution || (swalResult.isConfirmed ? swalResult.value : null);

  if (!finalResolution) {
    setTimeout(() => {
      const inputEl = document.getElementById('order-cust-external-id');
      if (inputEl && inputEl.offsetParent !== null) {
        inputEl.focus();
        inputEl.select();
      }
    }, 120);
    return { action: 'cancel' };
  }

  if (finalResolution.action === 'auto') {
    applyManualOrderNumberReplacement({ useAuto: true }, mode);
    return { action: 'auto' };
  }

  applyManualOrderNumberReplacement({ value: finalResolution.value }, mode);
  return finalResolution;
}

// Exponer utilidades globalmente en `window` para uso directo en Admin y Portal Cliente
window.getManualOrderCommerceMeta = getManualOrderCommerceMeta;
window.resolveClientManualOrderNumber = resolveClientManualOrderNumber;
window.checkManualOrderNumberAvailability = checkManualOrderNumberAvailability;
window.generateUniqueAutoManualOrderNumber = generateUniqueAutoManualOrderNumber;
window.resetManualOrderNumberFeedback = resetManualOrderNumberFeedback;
window.applyManualOrderNumberReplacement = applyManualOrderNumberReplacement;
window.setupManualOrderNumberLiveValidation = setupManualOrderNumberLiveValidation;
window.promptDuplicateOrderNumberResolution = promptDuplicateOrderNumberResolution;
