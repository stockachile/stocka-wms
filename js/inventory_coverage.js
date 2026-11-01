import supabase from './supabase.js';

/**
 * ============================================================================
 * WMS STOCKA — Centro de Cobertura de Inventario (Runway 30d), Rotación ABC
 * y Salud Volumétrica de Catálogo (m³)
 * Archivo: js/inventory_coverage.js
 * ============================================================================
 */

const IC_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos de caché en memoria

// Definición canónica de Conglomerados / Holdings (sincronizada con Portal Cliente y Facturación)
const IC_CANONICAL_CONGLOMERATES = [
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

const icDataCache = {
  client: new Map(),
  admin: new Map(),
  warehouses: null,
  warehousesTs: 0,
  commercesList: null,
  commercesTs: 0,
  billingMappings: null,
  billingMappingsTs: 0
};

const icState = {
  mode: 'client', // 'client' | 'admin'
  companyList: [], // Lista de comercios operativos asignados al cliente
  parentConglomerateName: null, // Nombre del Holding / Conglomerado si aplica (ej. 'BIG BANG')
  adminHoldingsList: [], // Lista de conglomerados detectados para modo admin [{ name, children }]
  activeHoldingChildren: [], // Hijos cuando admin filtra por un conglomerado o comercio de conglomerado
  allCommerces: [], // Lista completa de comercios (modo admin)
  selectedCommerce: 'ALL', // 'ALL', 'HOLDING::NOMBRE' o nombre del comercio
  selectedWarehouseId: 'ALL', // 'ALL' o UUID de bodega
  targetDays: 30, // 15 | 30 | 45 | 60
  demandMultiplier: 1.0, // 1.0 | 1.5 | 2.5
  includeTransitInRunway: false,
  searchQuery: '',
  statusFilter: 'ALL', // 'ALL' | 'OUT' | 'CRITICAL' | 'ALERT' | 'HEALTHY' | 'OVERSTOCK'
  abcFilter: 'ALL', // 'ALL' | 'A' | 'B' | 'C' | 'DORMANT'
  sortBy: 'runway_asc', // 'runway_asc' | 'runway_desc' | 'sales_desc' | 'stock_desc' | 'volume_desc' | 'replenish_desc'
  page: 1,
  pageSize: 25,
  selectedBurndownProductId: null,
  rawWarehouses: [],
  rawProducts: [],
  rawOrders30d: [],
  rawDeclarations: [],
  computedCatalog: [],
  fullGroupCatalog: [],
  perCommerceSummaries: [],
  groupSummary: null,
  lastLoadedAt: null,
  isLoading: false,
  showGuide: true
};

// Helpers de saneamiento HTML y normalización
function icEscapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icFormatNumber(num, decimals = 0) {
  const n = Number(num) || 0;
  return n.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function icNormalizeSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

function icNormCommerceKey(name) {
  return String(name || '').trim().toUpperCase();
}

function icSameCommerce(a, b) {
  const ka = icNormCommerceKey(a);
  const kb = icNormCommerceKey(b);
  return ka.length > 0 && ka === kb;
}

function icToTitleCase(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

// Genera variantes de capitalización para que consultas .in('comercio', ...) en PostgREST no fallen por diferencias de mayúsculas/minúsculas
function buildCommerceQueryVariants(commerces = []) {
  const set = new Set();
  (commerces || []).forEach(raw => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    set.add(trimmed);
    set.add(trimmed.toUpperCase());
    set.add(trimmed.toLowerCase());
    set.add(icToTitleCase(trimmed));
  });
  return Array.from(set);
}

// Calcula el volumen unitario en m³ a partir de product.volumen o (length * width * height)/1,000,000
function icGetUnitVolumeM3(product) {
  if (!product) return 0;
  const directVol = parseFloat(product.volumen);
  if (!isNaN(directVol) && directVol > 0) {
    return directVol;
  }
  const l = parseFloat(product.length);
  const w = parseFloat(product.width);
  const h = parseFloat(product.height);
  if (!isNaN(l) && !isNaN(w) && !isNaN(h) && l > 0 && w > 0 && h > 0) {
    return (l * w * h) / 1000000;
  }
  return 0;
}

// ============================================================================
// CONSULTAS A SUPABASE CON CACHÉ DE 2 MINUTOS Y SOPORTE DE CONGLOMERADOS
// ============================================================================

async function fetchWarehousesCached(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && icDataCache.warehouses && (now - icDataCache.warehousesTs < IC_CACHE_TTL_MS)) {
    return icDataCache.warehouses;
  }
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, name')
    .order('name');
  if (error) {
    console.warn('[InventoryCoverage] Error cargando bodegas:', error);
    return icDataCache.warehouses || [];
  }
  icDataCache.warehouses = data || [];
  icDataCache.warehousesTs = now;
  return icDataCache.warehouses;
}

async function fetchBillingMappingsCached(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && icDataCache.billingMappings && (now - icDataCache.billingMappingsTs < IC_CACHE_TTL_MS)) {
    return icDataCache.billingMappings;
  }
  try {
    const { data, error } = await supabase
      .from('billing_mappings')
      .select('comercio_nombre, billing_name');
    if (!error && Array.isArray(data)) {
      icDataCache.billingMappings = data;
      icDataCache.billingMappingsTs = now;
      return data;
    }
  } catch (e) {
    console.warn('[InventoryCoverage] Aviso cargando billing_mappings:', e);
  }
  return icDataCache.billingMappings || [];
}

function buildConglomeratesDirectory(mappings = []) {
  // Mapa de Holding Canónico -> Set de comercios hijos (en mayúsculas)
  const holdingsMap = new Map();
  // Mapa de Alias de Holding -> Nombre Canónico del Holding
  const aliasToHolding = new Map();
  // Mapa de Comercio Hijo (UPPER) -> Nombre Canónico del Holding
  const childToHolding = new Map();

  IC_CANONICAL_CONGLOMERATES.forEach(cg => {
    const canon = icNormCommerceKey(cg.canonicalName);
    if (!holdingsMap.has(canon)) holdingsMap.set(canon, new Set());
    aliasToHolding.set(canon, cg.canonicalName);
    (cg.aliases || []).forEach(al => aliasToHolding.set(icNormCommerceKey(al), cg.canonicalName));
    (cg.children || []).forEach(ch => {
      const chKey = icNormCommerceKey(ch);
      holdingsMap.get(canon).add(ch);
      childToHolding.set(chKey, cg.canonicalName);
    });
  });

  // Incorporar agrupaciones dinámicas desde billing_mappings
  const dynamicGroups = new Map(); // billingUpper -> { displayName, children: Set }
  (mappings || []).forEach(m => {
    const childRaw = String(m?.comercio_nombre || '').trim();
    const billingRaw = String(m?.billing_name || '').trim();
    if (!childRaw || !billingRaw) return;

    const childUpper = icNormCommerceKey(childRaw);
    const billingUpper = icNormCommerceKey(billingRaw);

    // Si el billing_name coincide con un alias canónico existente
    if (aliasToHolding.has(billingUpper)) {
      const canonName = aliasToHolding.get(billingUpper);
      const canonKey = icNormCommerceKey(canonName);
      holdingsMap.get(canonKey)?.add(childRaw);
      childToHolding.set(childUpper, canonName);
      return;
    }

    if (!dynamicGroups.has(billingUpper)) {
      dynamicGroups.set(billingUpper, { displayName: billingRaw.toUpperCase(), children: new Set() });
    }
    dynamicGroups.get(billingUpper).children.add(childRaw);
  });

  dynamicGroups.forEach((grp, billingUpper) => {
    const childrenArr = Array.from(grp.children);
    // Es un conglomerado si agrupa >1 comercio o si el nombre de holding es distinto al comercio hijo
    const isHolding = childrenArr.length > 1 || (childrenArr.length === 1 && icNormCommerceKey(childrenArr[0]) !== billingUpper);
    if (!isHolding) return;

    if (!holdingsMap.has(billingUpper)) {
      holdingsMap.set(billingUpper, new Set());
    }
    aliasToHolding.set(billingUpper, grp.displayName);
    childrenArr.forEach(ch => {
      holdingsMap.get(billingUpper).add(ch);
      if (!childToHolding.has(icNormCommerceKey(ch))) {
        childToHolding.set(icNormCommerceKey(ch), grp.displayName);
      }
    });
  });

  return { holdingsMap, aliasToHolding, childToHolding };
}

async function fetchAdminCommercesList(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && icDataCache.commercesList && (now - icDataCache.commercesTs < IC_CACHE_TTL_MS)) {
    return icDataCache.commercesList;
  }

  const commercesMap = new Map(); // UPPER -> Display Name
  const addComm = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'no asignado') return;
    const key = icNormCommerceKey(trimmed);
    if (!commercesMap.has(key)) {
      commercesMap.set(key, trimmed);
    }
  };

  const [cfgRes, mappings] = await Promise.all([
    supabase
      .from('v_comercios_config')
      .select('comercio, nombre')
      .then(r => r, () => ({ data: null })),
    fetchBillingMappingsCached(forceRefresh)
  ]);

  if (Array.isArray(cfgRes?.data)) {
    cfgRes.data.forEach(r => {
      addComm(r?.comercio || r?.nombre);
    });
  }

  if (commercesMap.size === 0) {
    try {
      const { data: prodCommerces } = await supabase
        .from('products')
        .select('comercio')
        .limit(2500);
      if (Array.isArray(prodCommerces)) {
        prodCommerces.forEach(p => addComm(p?.comercio));
      }
    } catch (e2) {
      console.warn('[InventoryCoverage] Error obteniendo comercios desde products:', e2);
    }
  }

  // Asegurar que los comercios hijos de conglomerados estén presentes con el casing correcto
  const { holdingsMap } = buildConglomeratesDirectory(mappings);
  const holdingsList = [];

  holdingsMap.forEach((childrenSet, holdingKey) => {
    const resolvedChildren = [];
    childrenSet.forEach(ch => {
      const chKey = icNormCommerceKey(ch);
      const display = commercesMap.get(chKey) || ch;
      commercesMap.set(chKey, display);
      resolvedChildren.push(display);
    });
    if (resolvedChildren.length > 1) {
      holdingsList.push({
        name: holdingKey,
        children: resolvedChildren.sort((a, b) => a.localeCompare(b, 'es'))
      });
    }
  });

  icState.adminHoldingsList = holdingsList.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const sorted = Array.from(commercesMap.values()).sort((a, b) => a.localeCompare(b, 'es'));
  icDataCache.commercesList = sorted;
  icDataCache.commercesTs = now;
  return sorted;
}

async function detectClientCommerces(forceRefresh = false) {
  const operationalMap = new Map(); // UPPER -> clean name
  let detectedHolding = null;

  const mappings = await fetchBillingMappingsCached(forceRefresh);
  const { holdingsMap, aliasToHolding, childToHolding } = buildConglomeratesDirectory(mappings);

  const addCommerceOrExpandHolding = (rawToken, { isFallbackCompanyField = false } = {}) => {
    const trimmed = String(rawToken || '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'no asignado') return;
    const upper = icNormCommerceKey(trimmed);

    // 1. ¿Es directamente el nombre/alias de un Conglomerado / Holding?
    if (aliasToHolding.has(upper)) {
      const canonHolding = aliasToHolding.get(upper);
      detectedHolding = detectedHolding || canonHolding;
      const childrenSet = holdingsMap.get(icNormCommerceKey(canonHolding));
      if (childrenSet && childrenSet.size > 0) {
        childrenSet.forEach(child => {
          const cKey = icNormCommerceKey(child);
          if (!operationalMap.has(cKey)) {
            operationalMap.set(cKey, String(child).trim());
          }
        });
        return;
      }
    }

    // 2. Si viene del campo secundario company_name (Razón Social) y ya tenemos comercios operativos en profile.comercio, no ensuciar la lista con la razón social
    if (isFallbackCompanyField && operationalMap.size > 0) {
      return;
    }

    // 3. Es un comercio operativo individual; verificar si pertenece a un Conglomerado
    if (!operationalMap.has(upper)) {
      operationalMap.set(upper, trimmed);
    }
    if (childToHolding.has(upper)) {
      detectedHolding = detectedHolding || childToHolding.get(upper);
    }
  };

  const processCommaSeparated = (rawStr, opts = {}) => {
    if (!rawStr) return;
    String(rawStr)
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)
      .forEach(c => addCommerceOrExpandHolding(c, opts));
  };

  // A) Fuentes inmediatas en memoria de la sesión actual (app.js)
  if (window.currentCompany) {
    processCommaSeparated(window.currentCompany);
  }
  if (window.currentUserProfile?.comercio) {
    processCommaSeparated(window.currentUserProfile.comercio);
  }
  if (window.currentUserProfile?.custom_company) {
    processCommaSeparated(window.currentUserProfile.custom_company);
  }
  if (window.currentUserProfile?.company_name) {
    processCommaSeparated(window.currentUserProfile.company_name, { isFallbackCompanyField: true });
  }

  // B) Consulta directa al perfil en Supabase para garantizar completitud (incluyendo columna `comercio` y `company_name`)
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('comercio, company_name')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.comercio) {
        processCommaSeparated(profile.comercio);
      }
      const rawCompanyName = profile?.company_name || user?.user_metadata?.company_name || '';
      if (rawCompanyName) {
        processCommaSeparated(rawCompanyName, { isFallbackCompanyField: true });
      }
    }
  } catch (err) {
    console.warn('[InventoryCoverage] Error detectando perfil del cliente:', err);
  }

  // C) Fallback final si solo existe window.activeIntegrationCommerce
  if (operationalMap.size === 0 && window.activeIntegrationCommerce && String(window.activeIntegrationCommerce).trim()) {
    addCommerceOrExpandHolding(String(window.activeIntegrationCommerce).trim());
  }

  const commercesList = Array.from(operationalMap.values());
  return {
    commerces: commercesList,
    parentConglomerateName: detectedHolding
  };
}

async function fetchCoverageDataset({ mode, companyList, selectedCommerce, forceRefresh = false }) {
  const cacheMap = mode === 'admin' ? icDataCache.admin : icDataCache.client;

  // En modo cliente SIEMPRE cargamos todos los comercios asignados al usuario/conglomerado en un único dataset cacheado.
  // En modo admin, si selecciona un Conglomerado (HOLDING::...) o un comercio hijo de un Conglomerado, cargamos el grupo completo para permitir cambio en 0ms.
  let adminTargetCommerces = [];
  let adminCacheScope = selectedCommerce || 'ALL';
  if (mode === 'admin' && selectedCommerce && selectedCommerce !== 'ALL') {
    if (String(selectedCommerce).startsWith('HOLDING::')) {
      const hName = String(selectedCommerce).replace(/^HOLDING::/, '').trim();
      const foundHolding = (icState.adminHoldingsList || []).find(h => icSameCommerce(h.name, hName));
      adminTargetCommerces = foundHolding ? foundHolding.children : [hName];
      adminCacheScope = `HOLDING::${foundHolding ? foundHolding.name : hName}`;
    } else {
      const parentHolding = (icState.adminHoldingsList || []).find(h =>
        (h.children || []).some(ch => icSameCommerce(ch, selectedCommerce))
      );
      if (parentHolding && parentHolding.children.length > 1) {
        adminTargetCommerces = parentHolding.children;
        adminCacheScope = `HOLDING::${parentHolding.name}`;
      } else {
        adminTargetCommerces = [selectedCommerce];
      }
    }
  }

  const normalizedClientKey = (companyList || []).map(icNormCommerceKey).sort().join('|');
  const cacheKey = mode === 'admin'
    ? `admin::${adminCacheScope}`
    : `client::${normalizedClientKey || 'NONE'}`;

  const now = Date.now();
  if (!forceRefresh && cacheMap.has(cacheKey)) {
    const cached = cacheMap.get(cacheKey);
    if (now - cached.ts < IC_CACHE_TTL_MS) {
      return cached.payload;
    }
  }

  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

  // 1. Cargar Bodegas
  const warehouses = await fetchWarehousesCached(forceRefresh);

  // 2. Cargar Productos + Inventario según modo (Cliente / Conglomerado vs Admin)
  let products = [];
  const scopedCommerces = mode === 'client' ? (companyList || []) : adminTargetCommerces;
  const queryCommerceVariants = buildCommerceQueryVariants(scopedCommerces);

  const fetchScopedProductsPaginated = async (variants) => {
    if (!variants || variants.length === 0) return [];
    const prodSelect = 'id, sku, name, comercio, stock_critico, volumen, length, width, height, is_virtual, inventory(warehouse_id, quantity, committed_quantity)';
    const firstRes = await supabase
      .from('products')
      .select(prodSelect)
      .in('comercio', variants)
      .order('id', { ascending: true })
      .range(0, 999);

    if (firstRes.error) {
      console.warn('[InventoryCoverage] Error consultando productos:', firstRes.error);
      return [];
    }
    let rows = firstRes.data || [];
    if (rows.length === 1000) {
      const [page2Res, page3Res] = await Promise.all([
        supabase.from('products').select(prodSelect).in('comercio', variants).order('id', { ascending: true }).range(1000, 1999),
        supabase.from('products').select(prodSelect).in('comercio', variants).order('id', { ascending: true }).range(2000, 2999)
      ]);
      if (Array.isArray(page2Res?.data)) rows = rows.concat(page2Res.data);
      if (Array.isArray(page3Res?.data)) rows = rows.concat(page3Res.data);
    }
    return rows.filter(p => p && !p.is_virtual);
  };

  if (mode === 'client') {
    if (queryCommerceVariants.length > 0) {
      products = await fetchScopedProductsPaginated(queryCommerceVariants);
    }
  } else {
    // MODO ADMIN
    if (selectedCommerce && selectedCommerce !== 'ALL') {
      products = await fetchScopedProductsPaginated(queryCommerceVariants);
    } else {
      // Admin: "Todos los Comercios" -> Optimizado por inventario activo + productos con stock_critico > 0
      const [invRes, critProdRes] = await Promise.all([
        supabase
          .from('inventory')
          .select('product_id, warehouse_id, quantity, committed_quantity')
          .or('quantity.gt.0,committed_quantity.gt.0')
          .limit(5000),
        supabase
          .from('products')
          .select('id, sku, name, comercio, stock_critico, volumen, length, width, height, is_virtual')
          .gt('stock_critico', 0)
          .limit(1500)
      ]);

      const invRows = invRes?.data || [];
      const critProds = critProdRes?.data || [];

      const invByProductId = new Map();
      invRows.forEach(row => {
        if (!row?.product_id) return;
        if (!invByProductId.has(row.product_id)) {
          invByProductId.set(row.product_id, []);
        }
        invByProductId.get(row.product_id).push({
          warehouse_id: row.warehouse_id,
          quantity: row.quantity || 0,
          committed_quantity: row.committed_quantity || 0
        });
      });

      const productMap = new Map();
      critProds.forEach(p => {
        if (p && !p.is_virtual) {
          productMap.set(p.id, {
            ...p,
            inventory: invByProductId.get(p.id) || []
          });
        }
      });

      const missingIds = Array.from(invByProductId.keys()).filter(id => !productMap.has(id));
      const chunkSize = 500;
      const chunkPromises = [];
      for (let i = 0; i < missingIds.length; i += chunkSize) {
        const chunkIds = missingIds.slice(i, i + chunkSize);
        chunkPromises.push(
          supabase
            .from('products')
            .select('id, sku, name, comercio, stock_critico, volumen, length, width, height, is_virtual')
            .in('id', chunkIds)
        );
      }

      const chunkResults = await Promise.all(chunkPromises);
      chunkResults.forEach(res => {
        (res?.data || []).forEach(p => {
          if (p && !p.is_virtual) {
            productMap.set(p.id, {
              ...p,
              inventory: invByProductId.get(p.id) || []
            });
          }
        });
      });

      products = Array.from(productMap.values());
    }
  }

  // 3. Cargar Pedidos de los últimos 30 días (en 5 tramos paralelos de 6 días con paginación automática si un conglomerado supera 1.000 pedidos por tramo)
  const buildOrdersSliceQuery = (sinceIso, untilIso, rangeStart = 0, rangeEnd = 999) => {
    let q = supabase
      .from('orders')
      .select('id, sku, cantidad, status, estado_wms, comercio, sucursal_pickeo, created_at')
      .gte('created_at', sinceIso);
    if (untilIso) q = q.lt('created_at', untilIso);
    q = q.order('created_at', { ascending: false }).range(rangeStart, rangeEnd);

    if (queryCommerceVariants.length > 0 && (mode === 'client' || (selectedCommerce && selectedCommerce !== 'ALL'))) {
      q = q.in('comercio', queryCommerceVariants);
    }
    return q;
  };

  const runSafeOrdersQuery = async () => {
    const isScopedQuery = mode === 'client' || (selectedCommerce && selectedCommerce !== 'ALL');
    if (mode === 'client' && queryCommerceVariants.length === 0) {
      return { data: [] };
    }
    if (isScopedQuery) {
      const dayMs = 24 * 60 * 60 * 1000;
      const sliceDays = 6;
      const fetchSlice = async (s) => {
        const startIso = new Date(now - ((s + 1) * sliceDays * dayMs)).toISOString();
        const endIso = s === 0 ? new Date(now + dayMs).toISOString() : new Date(now - (s * sliceDays * dayMs)).toISOString();
        const page1Res = await buildOrdersSliceQuery(startIso, endIso, 0, 999).then(r => r, () => ({ data: [] }));
        const page1 = page1Res?.data || [];
        if (page1.length < 1000) return page1;
        const page2Res = await buildOrdersSliceQuery(startIso, endIso, 1000, 1999).then(r => r, () => ({ data: [] }));
        return page1.concat(page2Res?.data || []);
      };

      const slicePromises = [];
      for (let s = 0; s < 5; s++) {
        slicePromises.push(fetchSlice(s));
      }
      const chunks = await Promise.all(slicePromises);
      const dedup = new Map();
      chunks.forEach(rows => {
        (rows || []).forEach(r => {
          if (r && r.id && !dedup.has(r.id)) dedup.set(r.id, r);
        });
      });
      return { data: Array.from(dedup.values()) };
    }

    const res = await buildOrdersSliceQuery(thirtyDaysAgoIso, null, 0, 1499);
    if (!res.error) return res;
    console.warn('[InventoryCoverage] Reintentando orders con ventana ligera (14d)...', res.error.message || res.error);
    const fourteenDaysAgoIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    return await buildOrdersSliceQuery(fourteenDaysAgoIso, null, 0, 799);
  };

  // 4. Cargar Declaraciones de Ingreso en Tránsito (stock_declarations) sin descargar file_base64 pesado
  const runSafeDeclarationsQuery = async () => {
    if (mode === 'client' && queryCommerceVariants.length === 0) {
      return { data: [] };
    }
    let declQuery = supabase
      .from('stock_declarations')
      .select('id, comercio, title, status, warehouse_id, quantity_declared, volume_declared, products_list, created_at')
      .order('created_at', { ascending: false })
      .limit(150);

    if (queryCommerceVariants.length > 0 && (mode === 'client' || (selectedCommerce && selectedCommerce !== 'ALL'))) {
      declQuery = declQuery.in('comercio', queryCommerceVariants);
    }

    const res = await declQuery;
    if (!res.error) return res;
    // Fallback por si alguna columna opcional difiere en el esquema
    let fallbackQ = supabase
      .from('stock_declarations')
      .select('id, comercio, title, status, quantity_declared, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (queryCommerceVariants.length > 0 && (mode === 'client' || (selectedCommerce && selectedCommerce !== 'ALL'))) {
      fallbackQ = fallbackQ.in('comercio', queryCommerceVariants);
    }
    return await fallbackQ.then(r => r, () => ({ data: [] }));
  };

  const [ordersRes, declRes] = await Promise.all([
    runSafeOrdersQuery(),
    runSafeDeclarationsQuery()
  ]);

  const orders30d = ordersRes?.data || [];
  const declarations = declRes?.data || [];

  const payload = {
    warehouses,
    products,
    orders30d,
    declarations
  };

  cacheMap.set(cacheKey, {
    ts: Date.now(),
    payload
  });

  return payload;
}

// ============================================================================
// MOTOR DE CÁLCULO DE COBERTURA (RUNWAY 30D), PARETO ABC Y VOLUMEN (M³)
// ============================================================================

function computeCatalogIntelligence() {
  const {
    rawWarehouses,
    rawProducts,
    rawOrders30d,
    rawDeclarations,
    selectedWarehouseId,
    selectedCommerce,
    companyList,
    mode,
    targetDays,
    demandMultiplier,
    includeTransitInRunway
  } = icState;

  const warehouseMap = new Map();
  rawWarehouses.forEach(w => warehouseMap.set(String(w.id), w.name));

  const selectedWhName = selectedWarehouseId !== 'ALL'
    ? (warehouseMap.get(String(selectedWarehouseId)) || '')
    : '';

  // Reconciliar capitalización canónica de los comercios con los datos reales de productos/pedidos
  const canonicalDisplayByUpper = new Map();
  if (mode === 'client') {
    companyList.forEach(c => {
      const k = icNormCommerceKey(c);
      if (k) canonicalDisplayByUpper.set(k, c);
    });
  }
  rawProducts.forEach(p => {
    const rawComm = String(p?.comercio || '').trim();
    if (rawComm) {
      canonicalDisplayByUpper.set(icNormCommerceKey(rawComm), rawComm);
    }
  });
  rawOrders30d.forEach(o => {
    const rawComm = String(o?.comercio || '').trim();
    const k = icNormCommerceKey(rawComm);
    if (rawComm && !canonicalDisplayByUpper.has(k)) {
      canonicalDisplayByUpper.set(k, rawComm);
    }
  });

  if (mode === 'client' && companyList.length > 0) {
    const updatedList = [];
    const seenKeys = new Set();
    companyList.forEach(c => {
      const k = icNormCommerceKey(c);
      if (!k || seenKeys.has(k)) return;
      seenKeys.add(k);
      updatedList.push(canonicalDisplayByUpper.get(k) || c);
    });
    // Si aparecieron productos de algún comercio adicional autorizado por RLS del mismo grupo, incluirlo
    rawProducts.forEach(p => {
      const rawComm = String(p?.comercio || '').trim();
      const k = icNormCommerceKey(rawComm);
      if (k && !seenKeys.has(k)) {
        seenKeys.add(k);
        updatedList.push(rawComm);
      }
    });
    icState.companyList = updatedList;
  }

  // Determinar si en modo Admin estamos posicionados sobre un Conglomerado o un comercio hijo de Conglomerado
  let activeAdminHolding = null;
  if (mode === 'admin' && selectedCommerce && selectedCommerce !== 'ALL') {
    if (String(selectedCommerce).startsWith('HOLDING::')) {
      const hName = String(selectedCommerce).replace(/^HOLDING::/, '').trim();
      activeAdminHolding = (icState.adminHoldingsList || []).find(h => icSameCommerce(h.name, hName))
        || { name: hName, children: [] };
    } else {
      activeAdminHolding = (icState.adminHoldingsList || []).find(h =>
        (h.children || []).some(ch => icSameCommerce(ch, selectedCommerce))
      ) || null;
    }
  }
  icState.activeHoldingChildren = activeAdminHolding ? (activeAdminHolding.children || []) : [];

  // Mapear productos por ID y por Comercio+SKU
  const productById = new Map();
  const productByCommerceSku = new Map();
  const productBySkuFallback = new Map();

  rawProducts.forEach(p => {
    productById.set(String(p.id), p);
    const normSku = icNormalizeSku(p.sku);
    const commKey = `${icNormCommerceKey(p.comercio)}::${normSku}`;
    if (normSku) {
      productByCommerceSku.set(commKey, p);
      if (!productBySkuFallback.has(normSku)) {
        productBySkuFallback.set(normSku, p);
      }
    }
  });

  // Acumuladores de ventas por producto
  const salesMap = new Map(); // productId -> { units30d, unitsLast7d, unitsPrev7d, retainedOrders, retainedUnits }
  const ensureSalesEntry = (prodId) => {
    const key = String(prodId);
    if (!salesMap.has(key)) {
      salesMap.set(key, {
        units30d: 0,
        unitsLast7d: 0,
        unitsPrev7d: 0,
        retainedOrders: 0,
        retainedUnits: 0
      });
    }
    return salesMap.get(key);
  };

  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

  const cancelledStatuses = new Set(['cancelado', 'anulado', 'cancelled', 'devuelto', 'rechazado']);
  const retainedStatuses = new Set(['para procesar', 'en preparación', 'en preparacion', 'en espera', 'pendiente', 'retenido']);

  rawOrders30d.forEach(order => {
    if (!order) return;
    const statusNorm = String(order.status || '').trim().toLowerCase();
    const wmsStatusNorm = String(order.estado_wms || '').trim().toLowerCase();
    if (cancelledStatuses.has(statusNorm) || cancelledStatuses.has(wmsStatusNorm)) {
      return;
    }

    const orderCreatedMs = order.created_at ? new Date(order.created_at).getTime() : nowMs;
    const ageMs = Math.max(0, nowMs - orderCreatedMs);
    const isLast7d = ageMs <= sevenDaysMs;
    const isPrev7d = ageMs > sevenDaysMs && ageMs <= fourteenDaysMs;
    const isRetained = retainedStatuses.has(statusNorm) || retainedStatuses.has(wmsStatusNorm);

    const items = Array.isArray(order.order_items) ? order.order_items : [];
    if (items.length > 0) {
      items.forEach(oi => {
        if (!oi?.product_id) return;
        if (selectedWarehouseId !== 'ALL') {
          if (oi.warehouse_id && String(oi.warehouse_id) !== String(selectedWarehouseId)) {
            return;
          }
          if (!oi.warehouse_id && selectedWhName && order.sucursal_pickeo) {
            if (!String(order.sucursal_pickeo).toLowerCase().includes(selectedWhName.toLowerCase())) {
              return;
            }
          }
        }
        const qty = Math.max(0, parseInt(oi.quantity, 10) || 0);
        if (qty <= 0) return;

        const entry = ensureSalesEntry(oi.product_id);
        entry.units30d += qty;
        if (isLast7d) entry.unitsLast7d += qty;
        if (isPrev7d) entry.unitsPrev7d += qty;
        if (isRetained) {
          entry.retainedOrders += 1;
          entry.retainedUnits += qty;
        }
      });
    } else if (order.sku) {
      if (selectedWarehouseId !== 'ALL' && selectedWhName && order.sucursal_pickeo) {
        if (!String(order.sucursal_pickeo).toLowerCase().includes(selectedWhName.toLowerCase())) {
          return;
        }
      }
      const skuParts = String(order.sku).split(',').map(s => s.trim()).filter(Boolean);
      const totalOrderQty = Math.max(1, parseInt(order.cantidad, 10) || 1);
      const perPartQty = skuParts.length === 1 ? totalOrderQty : 1;
      const commUpper = icNormCommerceKey(order.comercio);

      skuParts.forEach(rawSkuStr => {
        const normSku = icNormalizeSku(rawSkuStr);
        // Priorizar coincidencia exacta de Comercio + SKU para evitar colisiones entre tiendas de un mismo conglomerado
        const matchedProd = productByCommerceSku.get(`${commUpper}::${normSku}`)
          || (!commUpper ? productBySkuFallback.get(normSku) : null);
        if (matchedProd) {
          const entry = ensureSalesEntry(matchedProd.id);
          entry.units30d += perPartQty;
          if (isLast7d) entry.unitsLast7d += perPartQty;
          if (isPrev7d) entry.unitsPrev7d += perPartQty;
          if (isRetained) {
            entry.retainedOrders += 1;
            entry.retainedUnits += perPartQty;
          }
        }
      });
    }
  });

  // Procesar Declaraciones de Ingreso en Tránsito (stock_declarations)
  const closedDeclStatuses = new Set([
    'recibido conforme',
    'recibido con incidencias',
    'cancelada',
    'cancelado',
    'completada',
    'finalizada',
    'rechazada'
  ]);

  const isSelectingSpecificSingleCommerce = selectedCommerce !== 'ALL' && !String(selectedCommerce).startsWith('HOLDING::');

  const transitByProductId = new Map(); // productId -> { units, docCode }
  let activeDeclarationsCount = 0;
  let totalDeclaredUnitsGlobal = 0;

  rawDeclarations.forEach(decl => {
    if (!decl) return;
    const st = String(decl.status || decl.estado || '').trim().toLowerCase();
    if (closedDeclStatuses.has(st)) return;

    if (selectedWarehouseId !== 'ALL' && decl.warehouse_id && String(decl.warehouse_id) !== String(selectedWarehouseId)) {
      return;
    }

    const declCommerce = String(decl.comercio || decl.company_name || '').trim();
    const declCommUpper = icNormCommerceKey(declCommerce);
    if (mode === 'client' && icState.companyList.length > 0 && declCommerce) {
      if (!icState.companyList.some(c => icSameCommerce(c, declCommerce))) return;
    }

    const matchesActiveCommerceFilter = !isSelectingSpecificSingleCommerce
      || !declCommerce
      || icSameCommerce(declCommerce, selectedCommerce);

    if (matchesActiveCommerceFilter) {
      activeDeclarationsCount += 1;
    }

    const docCode = decl.codigo || decl.declaration_number || `#ING-${String(decl.id || '').slice(0, 5).toUpperCase()}`;

    const declItems = Array.isArray(decl.products_list)
      ? decl.products_list
      : (Array.isArray(decl.items)
          ? decl.items
          : (Array.isArray(decl.productos) ? decl.productos : (Array.isArray(decl.declared_items) ? decl.declared_items : [])));

    if (declItems.length > 0) {
      declItems.forEach(di => {
        const qty = Math.max(0, parseInt(di.qty || di.quantity || di.cantidad || di.expected_quantity || 0, 10) || 0);
        if (qty <= 0) return;
        if (matchesActiveCommerceFilter) {
          totalDeclaredUnitsGlobal += qty;
        }

        let targetProd = null;
        if (di.product_id && productById.has(String(di.product_id))) {
          targetProd = productById.get(String(di.product_id));
        } else if (di.sku) {
          const norm = icNormalizeSku(di.sku);
          targetProd = (declCommUpper ? productByCommerceSku.get(`${declCommUpper}::${norm}`) : null)
            || productBySkuFallback.get(norm);
        }

        if (targetProd) {
          const prev = transitByProductId.get(String(targetProd.id)) || { units: 0, docCode };
          prev.units += qty;
          transitByProductId.set(String(targetProd.id), prev);
        }
      });
    } else if (matchesActiveCommerceFilter) {
      const summaryQty = Math.max(
        0,
        parseInt(decl.quantity_declared || decl.total_units || decl.total_quantity || decl.cantidad_total || 0, 10) || 0
      );
      totalDeclaredUnitsGlobal += summaryQty;
    }
  });

  // Construir filas preliminares para todos los productos cargados
  const preliminaryRows = rawProducts.map(prod => {
    const invList = Array.isArray(prod.inventory) ? prod.inventory : [];
    const filteredInv = selectedWarehouseId === 'ALL'
      ? invList
      : invList.filter(i => String(i.warehouse_id) === String(selectedWarehouseId));

    let physicalStock = 0;
    let committedStock = 0;
    const branchBreakdown = [];

    filteredInv.forEach(inv => {
      const q = parseInt(inv.quantity, 10) || 0;
      const c = parseInt(inv.committed_quantity, 10) || 0;
      physicalStock += q;
      committedStock += c;
      if (q > 0 || c > 0) {
        const wName = warehouseMap.get(String(inv.warehouse_id)) || 'Bodega';
        branchBreakdown.push({
          warehouseId: inv.warehouse_id,
          name: wName,
          quantity: q,
          committed: c,
          available: q - c
        });
      }
    });

    const netAvailable = physicalStock - committedStock;
    const availablePositive = Math.max(0, netAvailable);

    const salesInfo = salesMap.get(String(prod.id)) || {
      units30d: 0,
      unitsLast7d: 0,
      unitsPrev7d: 0,
      retainedOrders: 0,
      retainedUnits: 0
    };

    const transitInfo = transitByProductId.get(String(prod.id)) || { units: 0, docCode: null };
    const unitVolumeM3 = icGetUnitVolumeM3(prod);
    const totalVolumeM3 = Math.max(0, physicalStock) * unitVolumeM3;
    const cleanComm = canonicalDisplayByUpper.get(icNormCommerceKey(prod.comercio)) || prod.comercio || 'Sin Comercio';

    return {
      id: String(prod.id),
      sku: prod.sku || 'SIN-SKU',
      name: prod.name || 'Producto sin nombre',
      comercio: cleanComm,
      stockCritico: parseInt(prod.stock_critico, 10) || 0,
      unitVolumeM3,
      totalVolumeM3,
      physicalStock,
      committedStock,
      netAvailable,
      availablePositive,
      branchBreakdown,
      sales30d: salesInfo.units30d,
      sales7d: salesInfo.unitsLast7d,
      salesPrev7d: salesInfo.unitsPrev7d,
      retainedOrders: salesInfo.retainedOrders,
      retainedUnits: salesInfo.retainedUnits,
      transitUnits: transitInfo.units,
      transitDoc: transitInfo.docCode
    };
  });

  // Si estamos en filtro por sucursal específica, mostrar productos que tengan stock o ventas en esa sucursal
  const warehouseScopedRows = selectedWarehouseId === 'ALL'
    ? preliminaryRows
    : preliminaryRows.filter(r => r.physicalStock > 0 || r.committedStock > 0 || r.sales30d > 0 || r.transitUnits > 0);

  // Función auxiliar que calcula Pareto ABC y métricas de Runway para cualquier conjunto de filas
  const today = new Date();
  const monthsShort = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  const enrichRowsWithAbcAndRunway = (rowsSubset) => {
    const totalSalesSubset = rowsSubset.reduce((sum, r) => sum + r.sales30d, 0);
    const sortedSubset = [...rowsSubset].sort((a, b) => b.sales30d - a.sales30d);

    const abcMap = new Map();
    let cumSales = 0;

    sortedSubset.forEach(row => {
      if (row.sales30d <= 0) {
        abcMap.set(row.id, 'DORMANT');
        return;
      }
      if (totalSalesSubset <= 0) {
        abcMap.set(row.id, 'C');
        return;
      }
      const prevShare = cumSales / totalSalesSubset;
      cumSales += row.sales30d;

      if (prevShare < 0.80) {
        abcMap.set(row.id, 'A');
      } else if (prevShare < 0.95) {
        abcMap.set(row.id, 'B');
      } else {
        abcMap.set(row.id, 'C');
      }
    });

    return rowsSubset.map(row => {
      const abc = abcMap.get(row.id) || 'DORMANT';
      const baseDailyVelocity = row.sales30d / 30;
      const effectiveDailyVelocity = baseDailyVelocity * demandMultiplier;

      const effectiveStockForRunway = includeTransitInRunway
        ? (row.availablePositive + row.transitUnits)
        : row.availablePositive;

      let runwayDays = 0;
      let runwayWithTransitDays = 0;

      if (effectiveDailyVelocity <= 0) {
        runwayDays = row.availablePositive > 0 ? 999 : 0;
        runwayWithTransitDays = (row.availablePositive + row.transitUnits) > 0 ? 999 : 0;
      } else {
        runwayDays = effectiveStockForRunway / effectiveDailyVelocity;
        runwayWithTransitDays = (row.availablePositive + row.transitUnits) / effectiveDailyVelocity;
      }

      // Determinar tramo de salud (6 tramos)
      let healthBand = 'HEALTHY';
      if (row.netAvailable <= 0) {
        if (row.sales30d > 0 || row.committedStock > 0 || row.stockCritico > 0 || row.physicalStock === 0) {
          healthBand = 'OUT';
        } else {
          healthBand = 'DORMANT';
        }
      } else if (row.sales30d === 0) {
        healthBand = 'DORMANT';
      } else if (runwayDays <= 7) {
        healthBand = 'CRITICAL';
      } else if (runwayDays <= 14) {
        healthBand = 'ALERT';
      } else if (runwayDays <= 45) {
        healthBand = 'HEALTHY';
      } else if (runwayDays <= 90) {
        healthBand = 'OVERSTOCK';
      } else {
        healthBand = 'DORMANT';
      }

      // Fecha estimada de quiebre
      let breakDateFormatted = '—';
      let breakDateSub = '';

      if (healthBand === 'OUT') {
        breakDateFormatted = '¡Quiebre Activo!';
        breakDateSub = row.committedStock > 0
          ? `${row.committedStock} uds comprometidas`
          : (row.sales30d > 0 ? 'Sin stock disponible' : '0 uds en bodega');
      } else if (row.sales30d === 0) {
        breakDateFormatted = 'Sin salidas (30d)';
        breakDateSub = `${row.physicalStock} uds inmovilizadas`;
      } else if (runwayDays > 180) {
        breakDateFormatted = '+180 días';
        breakDateSub = 'Baja rotación';
      } else {
        const daysToAdd = Math.max(1, Math.floor(runwayDays));
        const breakDate = new Date(today.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        breakDateFormatted = `${String(breakDate.getDate()).padStart(2, '0')} ${monthsShort[breakDate.getMonth()]}`;
        breakDateSub = `en ~${runwayDays.toFixed(1)} días`;
      }

      // Tendencia 7d vs semana previa
      let trendPct = 0;
      if (row.salesPrev7d > 0) {
        trendPct = Math.round(((row.sales7d - row.salesPrev7d) / row.salesPrev7d) * 100);
      } else if (row.sales7d > 0) {
        trendPct = 100;
      }

      // Reposición sugerida según Meta de Cobertura del Simulador
      const targetNeededUnits = Math.ceil(effectiveDailyVelocity * targetDays);
      const deficitFromNegativeAvail = row.netAvailable < 0 ? Math.abs(row.netAvailable) : 0;
      const minSafetyFloor = row.stockCritico > 0 ? row.stockCritico : 0;
      const desiredTotal = Math.max(targetNeededUnits, minSafetyFloor);

      const suggestedReplenishUnits = (effectiveDailyVelocity > 0 || row.stockCritico > 0)
        ? Math.max(0, desiredTotal - (row.availablePositive + row.transitUnits) + deficitFromNegativeAvail)
        : 0;

      const replenishVolumeM3 = suggestedReplenishUnits * row.unitVolumeM3;

      return {
        ...row,
        abc,
        baseDailyVelocity,
        effectiveDailyVelocity,
        runwayDays,
        runwayWithTransitDays,
        healthBand,
        breakDateFormatted,
        breakDateSub,
        trendPct,
        suggestedReplenishUnits,
        replenishVolumeM3
      };
    });
  };

  // 1. Enriquecer catálogo completo del grupo/conglomerado para resúmenes comparativos y exportación multi-hoja
  const fullGroupEnriched = enrichRowsWithAbcAndRunway(warehouseScopedRows);
  icState.fullGroupCatalog = fullGroupEnriched;

  // Función que resume las métricas clave de cualquier conjunto de filas enriquecidas
  const buildCommerceSummary = (commName, items, scopeValue) => {
    const activeMovers = items.filter(r => r.effectiveDailyVelocity > 0);
    // Tope de 90 días por SKU al ponderar para que un solo SKU con sobrestock extremo no distorsione la cobertura operativa de la tienda
    const totalAvailActiveCapped = activeMovers.reduce((s, r) => {
      const rawSkuAvail = includeTransitInRunway ? (r.availablePositive + r.transitUnits) : r.availablePositive;
      const cappedSkuAvail = Math.min(rawSkuAvail, r.effectiveDailyVelocity * 90);
      return s + cappedSkuAvail;
    }, 0);
    const totalDailyVel = activeMovers.reduce((s, r) => s + r.effectiveDailyVelocity, 0);
    const weightedRunway = totalDailyVel > 0 ? (totalAvailActiveCapped / totalDailyVel) : 0;

    return {
      name: commName,
      scopeValue: scopeValue || commName,
      skusCount: items.length,
      activeMoversCount: activeMovers.length,
      physicalStock: items.reduce((s, r) => s + r.physicalStock, 0),
      committedStock: items.reduce((s, r) => s + r.committedStock, 0),
      netAvailable: items.reduce((s, r) => s + r.availablePositive, 0),
      sales30d: items.reduce((s, r) => s + r.sales30d, 0),
      sales7d: items.reduce((s, r) => s + r.sales7d, 0),
      dailyVelocity: totalDailyVel,
      weightedRunway,
      outCount: items.filter(r => r.healthBand === 'OUT').length,
      criticalCount: items.filter(r => r.healthBand === 'CRITICAL').length,
      alertCount: items.filter(r => r.healthBand === 'ALERT').length,
      healthyCount: items.filter(r => r.healthBand === 'HEALTHY').length,
      overstockCount: items.filter(r => r.healthBand === 'OVERSTOCK' || r.healthBand === 'DORMANT').length,
      totalVolumeM3: items.reduce((s, r) => s + r.totalVolumeM3, 0),
      suggestedReplenishUnits: items.reduce((s, r) => s + r.suggestedReplenishUnits, 0),
      transitUnits: items.reduce((s, r) => s + r.transitUnits, 0)
    };
  };

  // Construir desglose comparativo por Comercio para cuentas Multi-Comercio / Conglomerado
  const multiCommerceList = mode === 'client'
    ? icState.companyList
    : (activeAdminHolding ? activeAdminHolding.children : []);

  if (multiCommerceList.length > 1) {
    const groupScopeValue = mode === 'client'
      ? 'ALL'
      : `HOLDING::${activeAdminHolding.name}`;
    const groupLabel = mode === 'client'
      ? (icState.parentConglomerateName ? `Consolidado ${icState.parentConglomerateName}` : 'Consolidado Mis Comercios')
      : `Consolidado ${activeAdminHolding.name}`;

    icState.groupSummary = buildCommerceSummary(groupLabel, fullGroupEnriched, groupScopeValue);
    icState.perCommerceSummaries = multiCommerceList.map(cName => {
      const cItems = fullGroupEnriched.filter(r => icSameCommerce(r.comercio, cName));
      return buildCommerceSummary(cName, cItems, cName);
    });
  } else {
    icState.groupSummary = null;
    icState.perCommerceSummaries = [];
  }

  // 2. Determinar el catálogo activo según el comercio seleccionado (recalculando Pareto ABC propio cuando se filtra 1 comercio)
  let enrichedCatalog = fullGroupEnriched;
  if (isSelectingSpecificSingleCommerce) {
    const singleCommerceRows = warehouseScopedRows.filter(r => icSameCommerce(r.comercio, selectedCommerce));
    enrichedCatalog = enrichRowsWithAbcAndRunway(singleCommerceRows);
  }

  icState.computedCatalog = enrichedCatalog;
  icState.activeDeclarationsCount = activeDeclarationsCount;
  icState.totalDeclaredUnitsGlobal = totalDeclaredUnitsGlobal;

  // Seleccionar por defecto un Top SKU con movimiento para la curva Burn-down
  if (!icState.selectedBurndownProductId || !enrichedCatalog.some(r => r.id === icState.selectedBurndownProductId)) {
    const topMover = [...enrichedCatalog]
      .sort((a, b) => b.sales30d - a.sales30d)
      .find(r => r.sales30d > 0 || r.physicalStock > 0);
    icState.selectedBurndownProductId = topMover ? topMover.id : (enrichedCatalog[0]?.id || null);
  }
}

// ============================================================================
// RENDERIZADO DEL MÓDULO COMPLETO EN #app-content
// ============================================================================

function renderFullModuleScaffold() {
  const container = document.getElementById('app-content');
  if (!container) return;

  const isClient = icState.mode === 'client';
  const showCommerceSelect = !isClient || icState.companyList.length > 1;
  const holdingName = isClient
    ? icState.parentConglomerateName
    : (
        String(icState.selectedCommerce).startsWith('HOLDING::')
          ? String(icState.selectedCommerce).replace(/^HOLDING::/, '').trim()
          : ((icState.adminHoldingsList || []).find(h => (h.children || []).some(ch => icSameCommerce(ch, icState.selectedCommerce)))?.name || null)
      );

  const consolidatedClientLabel = icState.parentConglomerateName
    ? `🏢 Consolidado ${icState.parentConglomerateName} (${icState.companyList.length} comercios)`
    : `🏢 Consolidado Mis Comercios (${icState.companyList.length})`;

  const adminHoldingsOptgroupHtml = (!isClient && Array.isArray(icState.adminHoldingsList) && icState.adminHoldingsList.length > 0)
    ? `<optgroup label="🏢 Conglomerados / Holdings (Consolidado)">
        ${icState.adminHoldingsList.map(h => {
          const val = `HOLDING::${h.name}`;
          return `<option value="${icEscapeHtml(val)}" ${icSameCommerce(icState.selectedCommerce, val) ? 'selected' : ''}>🏢 Holding ${icEscapeHtml(h.name)} (${h.children.length} comercios)</option>`;
        }).join('')}
      </optgroup>`
    : '';

  const commerceOptionsHtml = isClient
    ? [
        ...(icState.companyList.length > 1 ? [`<option value="ALL" ${icState.selectedCommerce === 'ALL' ? 'selected' : ''}>${icEscapeHtml(consolidatedClientLabel)}</option>`] : []),
        ...icState.companyList.map(c => `<option value="${icEscapeHtml(c)}" ${icSameCommerce(icState.selectedCommerce, c) ? 'selected' : ''}>🏪 ${icEscapeHtml(c)}</option>`)
      ].join('')
    : [
        `<option value="ALL" ${icState.selectedCommerce === 'ALL' ? 'selected' : ''}>🌐 Todos los Comercios (${icState.allCommerces.length})</option>`,
        adminHoldingsOptgroupHtml,
        `<optgroup label="🏪 Comercios Individuales">
          ${icState.allCommerces.map(c => `<option value="${icEscapeHtml(c)}" ${icSameCommerce(icState.selectedCommerce, c) ? 'selected' : ''}>🏪 ${icEscapeHtml(c)}</option>`).join('')}
        </optgroup>`
      ].join('');

  const warehouseOptionsHtml = [
    `<option value="ALL" ${icState.selectedWarehouseId === 'ALL' ? 'selected' : ''}>Todas las Sucursales (Consolidado)</option>`,
    ...icState.rawWarehouses.map(w => `<option value="${icEscapeHtml(w.id)}" ${String(icState.selectedWarehouseId) === String(w.id) ? 'selected' : ''}>${icEscapeHtml(w.name)}</option>`)
  ].join('');

  let activeCommerceBadge = '';
  if (isClient) {
    if (icState.selectedCommerce !== 'ALL') {
      activeCommerceBadge = `Comercio: ${icState.selectedCommerce}`;
    } else if (icState.companyList.length > 1) {
      activeCommerceBadge = `Consolidado (${icState.companyList.length} comercios)`;
    } else {
      activeCommerceBadge = icState.companyList[0] || 'Mi Comercio';
    }
  } else {
    if (String(icState.selectedCommerce).startsWith('HOLDING::')) {
      const hName = String(icState.selectedCommerce).replace(/^HOLDING::/, '').trim();
      activeCommerceBadge = `Consolidado Holding ${hName} (${icState.activeHoldingChildren.length} comercios)`;
    } else if (icState.selectedCommerce !== 'ALL') {
      activeCommerceBadge = `Comercio: ${icState.selectedCommerce}`;
    } else {
      activeCommerceBadge = 'Vista Global Multi-Comercio';
    }
  }

  const timeStr = icState.lastLoadedAt
    ? icState.lastLoadedAt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : 'Ahora';

  container.innerHTML = `
    <div class="ic-module-wrapper">
      <!-- 1. CABECERA Y SIMULADOR EN VIVO -->
      <section class="ic-header-card">
        <div class="ic-header-top">
          <div class="ic-header-title-block">
            <div class="ic-badge-row">
              <span class="ic-pill-badge ic-pill-primary">
                <i class="ri-line-chart-line"></i> INTELIGENCIA DE INVENTARIO · RUNWAY 30D
              </span>
              <span class="ic-pill-badge ic-pill-emerald">
                <span class="ic-live-dot"></span> Sincronizado (${icEscapeHtml(timeStr)})
              </span>
              <span class="ic-pill-badge ic-pill-indigo">
                <i class="ri-store-2-line"></i> ${icEscapeHtml(activeCommerceBadge)}
              </span>
              ${holdingName ? `
                <span class="ic-pill-badge ic-pill-purple" title="Cuenta perteneciente al Conglomerado / Holding ${icEscapeHtml(holdingName)}">
                  <i class="ri-hotel-line"></i> Holding: ${icEscapeHtml(holdingName)}
                </span>
              ` : ''}
            </div>
            <h1 class="ic-main-title">
              Centro de Cobertura de Inventario (Runway 30d), Rotación ABC y Salud de Catálogo
            </h1>
            <p class="ic-main-subtitle">
              Proyección de días de cobertura basada en la velocidad real de salidas de los últimos 30 días, cruzada con ocupación volumétrica (<strong>m³</strong>), clasificación Pareto ABC y órdenes en proceso.
            </p>
          </div>

          <div class="ic-header-actions">
            <button type="button" class="ic-btn ic-btn-outline" onclick="window.icToggleGuide()" title="Mostrar u ocultar la guía de uso e instrucciones del módulo">
              <i class="ri-question-line" style="color: var(--color-primary);"></i> ${icState.showGuide ? 'Ocultar Guía' : '¿Cómo funciona?'}
            </button>
            <button type="button" class="ic-btn ic-btn-outline" onclick="window.icRefreshData()" title="Actualizar datos en vivo desde Supabase">
              <i class="ri-refresh-line"></i> Actualizar
            </button>
            <button type="button" class="ic-btn ic-btn-outline" onclick="window.icExportExcel()" title="Exportar reporte completo de cobertura y reposición a Excel">
              <i class="ri-file-excel-2-line" style="color: #10b981;"></i> Exportar Excel
            </button>
            <button type="button" class="ic-btn ic-btn-emerald" onclick="window.icGoToDeclarations()">
              <i class="ri-inbox-archive-line"></i> Declarar Ingreso (#ING)
            </button>
          </div>
        </div>

        <!-- GUÍA EXPLICATIVA DEL MÓDULO (AL INICIO): QUÉ SE PUEDE HACER, QUÉ INFORMACIÓN ENTREGA E INSTRUCCIONES -->
        <div class="ic-guide-banner" id="ic-guide-banner">
          <div class="ic-guide-header">
            <div class="ic-guide-title-wrap">
              <span class="ic-guide-icon"><i class="ri-compass-3-line"></i></span>
              <div>
                <h2 class="ic-guide-title">Guía del Módulo: ¿Para qué sirve, qué información entrega y cómo usarlo?</h2>
                <p class="ic-guide-subtitle">
                  Este centro cruza automáticamente tu <strong>stock físico y comprometido en tiempo real</strong> con las <strong>salidas de los últimos 30 días</strong>, las <strong>Declaraciones de Ingreso (#ING)</strong> y el <strong>cubicaje en bodega (m³)</strong> para ayudarte a reponer a tiempo y optimizar tu espacio.
                </p>
              </div>
            </div>
            <button type="button" class="ic-guide-toggle-btn" onclick="window.icToggleGuide()">
              <i class="${icState.showGuide ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}"></i>
              <span>${icState.showGuide ? 'Contraer explicación' : 'Ver explicación e instrucciones'}</span>
            </button>
          </div>

          ${icState.showGuide ? `
            <div class="ic-guide-body">
              <!-- 3 Bloques: Qué se puede hacer / Qué información consigues / Cómo interpreta tus datos -->
              <div class="ic-guide-pillars-grid">
                <div class="ic-guide-card">
                  <h3 class="ic-guide-card-title">
                    <i class="ri-magic-line" style="color: #2563eb; font-size: 1rem;"></i>
                    1. ¿Qué puedes hacer en este módulo?
                  </h3>
                  <ul class="ic-guide-list">
                    <li><strong>Gestionar Conglomerados o Tiendas Individuales:</strong> Analiza todas tus marcas unificadas o aísla un comercio y sucursal específica en 1 clic sin tiempos de carga.</li>
                    <li><strong>Simular Metas y Eventos (Cyber / Campañas):</strong> Cambia tu meta de cobertura (<strong>15, 30, 45 o 60 días</strong>) y multiplica la velocidad de salida (<strong>1.0x, 1.5x o 2.5x</strong>) para anticipar quiebres.</li>
                    <li><strong>Incluir Mercadería en Tránsito (#ING):</strong> Simula cómo mejora tu cobertura sumando las unidades declaradas que ya vienen en camino a bodega.</li>
                    <li><strong>Actuar sobre Quiebres y Sobrestock:</strong> Genera órdenes de reposición sugeridas hacia <strong>Declaraciones (#ING)</strong> o detecta SKUs inmovilizados para liquidación o retiro.</li>
                  </ul>
                </div>

                <div class="ic-guide-card">
                  <h3 class="ic-guide-card-title">
                    <i class="ri-bar-chart-box-line" style="color: #10b981; font-size: 1rem;"></i>
                    2. ¿Qué información puedes conseguir?
                  </h3>
                  <ul class="ic-guide-list">
                    <li><strong>Días de Cobertura (Runway) y Fecha Exacta de Quiebre:</strong> Cuántos días durará el stock disponible neto de cada SKU al ritmo actual de ventas y en qué fecha calendario se agotará.</li>
                    <li><strong>Clasificación Pareto ABC Dinámica:</strong> Identifica tus productos <strong>Clase A 🔥</strong> (generan el 80% de tus salidas), <strong>Clase B ⚡</strong> (15%), <strong>Clase C 📦</strong> (5%) y <strong>Dormidos 💤</strong> (0 ventas en 30d).</li>
                    <li><strong>Semáforo de Salud (6 Tramos) y Volumen (m³):</strong> Cuántos SKUs y cuántos metros cúbicos están en estado <em>Agotado, Crítico (1–7d), Alerta (8–14d), Saludable (15–45d), Sobrestock o Dormido</em>.</li>
                    <li><strong>Cálculo Exacto de Reposición y Excel Multi-Hoja:</strong> Unidades exactas a enviar (y su volumen en m³) para alcanzar tu meta, descargable en Excel con pestañas separadas por comercio.</li>
                  </ul>
                </div>

                <div class="ic-guide-card">
                  <h3 class="ic-guide-card-title">
                    <i class="ri-calculator-line" style="color: #8b5cf6; font-size: 1rem;"></i>
                    3. ¿Cómo se calculan las métricas clave?
                  </h3>
                  <ul class="ic-guide-list">
                    <li><strong>Stock Disponible Neto:</strong> <code>Stock Físico − Stock Comprometido</code> en pedidos pendientes de preparación.</li>
                    <li><strong>Velocidad Diaria de Salida:</strong> <code>(Unidades vendidas últ. 30 días ÷ 30) × Multiplicador de Demanda</code>.</li>
                    <li><strong>Días de Cobertura (Runway):</strong> <code>Stock Disponible Neto ÷ Velocidad Diaria</code> (con opción de sumar tránsito <code>#ING</code>).</li>
                    <li><strong>Reposición Sugerida:</strong> <code>(Velocidad Diaria × Días Meta) − (Stock Disponible + Tránsito #ING)</code>, respetando siempre tu umbral de stock crítico.</li>
                  </ul>
                </div>
              </div>

              <!-- 5 Pasos de Instrucciones Prácticas -->
              <div>
                <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-text-main); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                  <i class="ri-list-check-2" style="color: var(--color-primary);"></i>
                  <span>Instrucciones paso a paso para aprovechar el módulo:</span>
                </div>
                <div class="ic-guide-steps-grid">
                  <div class="ic-guide-step">
                    <div class="ic-guide-step-top">
                      <span class="ic-guide-step-num">1</span>
                      <span class="ic-guide-step-title">Elige Comercio y Bodega</span>
                    </div>
                    <p class="ic-guide-step-desc">
                      Selecciona en el filtro superior (o en las tarjetas de <strong>Radiografía del Conglomerado</strong>) si deseas analizar el grupo consolidado, una tienda específica o una sucursal física.
                    </p>
                  </div>

                  <div class="ic-guide-step">
                    <div class="ic-guide-step-top">
                      <span class="ic-guide-step-num">2</span>
                      <span class="ic-guide-step-title">Ajusta el Simulador</span>
                    </div>
                    <p class="ic-guide-step-desc">
                      Elige cuántos días de stock quieres asegurar (<strong>15 a 60d</strong>) y el escenario (<strong>Actual, Campaña o Cyber</strong>). Activa el check <code>#ING</code> si quieres contar mercadería en tránsito.
                    </p>
                  </div>

                  <div class="ic-guide-step">
                    <div class="ic-guide-step-top">
                      <span class="ic-guide-step-num">3</span>
                      <span class="ic-guide-step-title">Filtra en 1 Clic</span>
                    </div>
                    <p class="ic-guide-step-desc">
                      Haz clic sobre cualquier <strong>tarjeta KPI</strong> (ej. <em>Quiebre Activo</em> o <em>Riesgo Crítico</em>), barra de <strong>Salud</strong> o bloque <strong>ABC</strong> para filtrar inmediatamente la tabla inferior.
                    </p>
                  </div>

                  <div class="ic-guide-step">
                    <div class="ic-guide-step-top">
                      <span class="ic-guide-step-num">4</span>
                      <span class="ic-guide-step-title">Proyecta la Curva 30d</span>
                    </div>
                    <p class="ic-guide-step-desc">
                      Haz clic en <strong>cualquier fila de la tabla</strong> para graficar su curva <em>Burn-down</em>: compara la caída sin reposición (rojo) vs. el efecto de inyectar un ingreso (verde).
                    </p>
                  </div>

                  <div class="ic-guide-step">
                    <div class="ic-guide-step-top">
                      <span class="ic-guide-step-num">5</span>
                      <span class="ic-guide-step-title">Repón o Exporta a Excel</span>
                    </div>
                    <p class="ic-guide-step-desc">
                      Usa la columna <strong>Reposición Sugerida</strong> y pulsa <strong>"+ Declarar #ING"</strong> para notificar tu envío a bodega, o descarga el <strong>Excel Multi-Hoja</strong> con todo el plan de compra.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Barra de Control: Comercio, Sucursal, Meta de Cobertura y Multiplicador de Demanda -->
        <div class="ic-controls-grid">
          <div class="ic-control-group">
            <div class="ic-control-label">
              <span><i class="ri-store-3-line"></i> ${holdingName ? `Conglomerado ${icEscapeHtml(holdingName)} / Comercio` : 'Comercio / Seller'}</span>
              <span class="ic-control-label-accent">${isClient ? (icState.companyList.length > 1 ? `${icState.companyList.length} Comercios` : 'Portal Cliente') : 'Multi-Comercio'}</span>
            </div>
            <select id="ic-select-commerce" class="ic-select" ${!showCommerceSelect ? 'disabled' : ''} onchange="window.icHandleCommerceChange(this.value)">
              ${commerceOptionsHtml}
            </select>
          </div>

          <div class="ic-control-group">
            <div class="ic-control-label">
              <span><i class="ri-building-2-line"></i> Sucursal Física (Bodega)</span>
            </div>
            <select id="ic-select-warehouse" class="ic-select" onchange="window.icHandleWarehouseChange(this.value)">
              ${warehouseOptionsHtml}
            </select>
          </div>

          <div class="ic-control-group">
            <div class="ic-control-label">
              <span><i class="ri-calendar-check-line"></i> Simulador: Meta Cobertura</span>
              <span class="ic-control-label-accent" id="ic-label-target-days">Meta: ${icState.targetDays} días</span>
            </div>
            <div class="ic-segmented-group ic-segmented-4">
              ${[15, 30, 45, 60].map(d => `
                <button type="button" class="ic-seg-btn ${icState.targetDays === d ? 'active-primary' : ''}" onclick="window.icSetTargetDays(${d})">
                  ${d} días
                </button>
              `).join('')}
            </div>
          </div>

          <div class="ic-control-group">
            <div class="ic-control-label">
              <span><i class="ri-flashlight-line"></i> Escenario de Demanda</span>
              <span class="ic-control-label-accent" style="color: #6366f1;" id="ic-label-multiplier">${icState.demandMultiplier.toFixed(1)}x</span>
            </div>
            <div class="ic-segmented-group ic-segmented-3">
              <button type="button" class="ic-seg-btn ${icState.demandMultiplier === 1.0 ? 'active-indigo' : ''}" onclick="window.icSetMultiplier(1.0)" title="Ritmo actual de los últimos 30 días">
                Actual (1.0x)
              </button>
              <button type="button" class="ic-seg-btn ${icState.demandMultiplier === 1.5 ? 'active-indigo' : ''}" onclick="window.icSetMultiplier(1.5)" title="Campaña / Fin de Mes (+50% salidas)">
                Campaña (1.5x)
              </button>
              <button type="button" class="ic-seg-btn ${icState.demandMultiplier === 2.5 ? 'active-indigo' : ''}" onclick="window.icSetMultiplier(2.5)" title="Evento Cyber / Black Friday (2.5x salidas)">
                Cyber (2.5x)
              </button>
            </div>
          </div>
        </div>

        <!-- Banner de Fórmula Activa -->
        <div class="ic-formula-banner">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <i class="ri-cpu-line" style="color: var(--color-primary); font-size: 1rem;"></i>
            <span id="ic-formula-summary-text">
              <strong>Fórmula activa:</strong>
              <code class="ic-formula-code">Días Cobertura = ${icState.includeTransitInRunway ? '(Stock Disp. + Tránsito #ING)' : 'Stock Disponible Neto'} ÷ (Ventas 30d ÷ 30 × ${icState.demandMultiplier.toFixed(1)}x)</code>
              · Calculando reposición sugerida para cubrir <strong>${icState.targetDays} días</strong>.
            </span>
          </div>
          <label class="ic-transit-toggle-label">
            <input type="checkbox" ${icState.includeTransitInRunway ? 'checked' : ''} onchange="window.icToggleIncludeTransit(this.checked)" />
            <span>Incluir unidades en Declaraciones de Ingreso (<code class="ic-formula-code">#ING</code>) en el cálculo de cobertura</span>
          </label>
        </div>
      </section>

      <!-- 1.B. RADAR COMPARATIVO MULTI-COMERCIO / CONGLOMERADO (Visible cuando el usuario tiene >1 comercio o pertenece a un Holding) -->
      <section id="ic-conglomerate-section" style="display: none;"></section>

      <!-- 2. 6 KPIs EJECUTIVOS DE INTELIGENCIA DE INVENTARIO -->
      <section id="ic-kpi-section" class="ic-kpi-grid"></section>

      <!-- 3. 3 PANELES VISUALES ANALÍTICOS -->
      <section class="ic-charts-grid">
        <!-- Panel 1: Distribución de Salud & Cubicaje m³ -->
        <div class="ic-panel-card">
          <div>
            <div class="ic-panel-header">
              <div>
                <h3 class="ic-panel-title">1. Salud del Catálogo &amp; Cubicaje (m³)</h3>
                <p class="ic-panel-subtitle">Haz clic en cualquier tramo para filtrar la tabla inferior</p>
              </div>
              <span id="ic-total-vol-badge" class="ic-vol-pill">0.00 m³</span>
            </div>
            <div id="ic-health-distribution-bars" class="ic-health-list" style="margin-top: 0.75rem;"></div>
          </div>
          <div class="ic-kpi-footer">
            <span>Escenario activo: <strong id="ic-panel1-mult-label">${icState.demandMultiplier.toFixed(1)}x</strong></span>
            <button type="button" onclick="window.icSetStatusFilter('ALL')" style="background:none;border:none;color:var(--color-primary);font-weight:700;cursor:pointer;font-size:0.75rem;">
              Ver todos los tramos
            </button>
          </div>
        </div>

        <!-- Panel 2: Curva Burn-down 30 días (SVG) -->
        <div class="ic-panel-card">
          <div>
            <div class="ic-panel-header">
              <div>
                <h3 class="ic-panel-title">2. Curva Burn-down (Proyección 30d)</h3>
                <p class="ic-panel-subtitle">Agotamiento diario proyectado vs. stock crítico (7d) y reposición</p>
              </div>
              <select id="ic-burndown-sku-select" class="ic-select" style="max-width: 245px; padding: 0.35rem 0.6rem; font-size: 0.76rem;" onchange="window.icSelectBurndownSku(this.value)"></select>
            </div>

            <div id="ic-burndown-meta" class="ic-burndown-meta-grid" style="margin-top: 0.65rem;"></div>

            <div class="ic-svg-box" style="margin-top: 0.65rem;">
              <svg id="ic-burndown-svg" viewBox="0 0 520 190" style="width: 100%; height: 175px; overflow: visible;"></svg>
            </div>
          </div>

          <div class="ic-kpi-footer" style="flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.85rem; flex-wrap: wrap;">
              <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                <span style="width: 12px; height: 2.5px; background: #ef4444; display: inline-block;"></span> Sin nuevo ingreso
              </span>
              <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                <span style="width: 12px; height: 3px; background: #10b981; display: inline-block; border-radius: 2px;"></span> Con reposición / #ING
              </span>
              <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                <span style="width: 12px; height: 0; border-bottom: 2px dashed #f59e0b; display: inline-block;"></span> Umbral 7 días
              </span>
            </div>
            <span id="ic-burndown-break-label" style="font-weight: 700; color: var(--color-danger);"></span>
          </div>
        </div>

        <!-- Panel 3: Matriz Pareto ABC vs. Ocupación de Bodega (m³) -->
        <div class="ic-panel-card">
          <div>
            <div class="ic-panel-header">
              <div>
                <h3 class="ic-panel-title">3. Matriz Pareto ABC vs. Bodega (m³)</h3>
                <p class="ic-panel-subtitle">Aporte a las salidas (30d) vs. volumen físico ocupado</p>
              </div>
            </div>
            <div id="ic-abc-matrix-list" class="ic-abc-list" style="margin-top: 0.7rem;"></div>
          </div>
          <div id="ic-abc-alert-container" class="ic-abc-alert-box"></div>
        </div>
      </section>

      <!-- 4. CATÁLOGO MAESTRO INTERACTIVO -->
      <section class="ic-catalog-card">
        <div class="ic-catalog-header">
          <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.55rem;">
                <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text-main);">
                  Catálogo Maestro de Cobertura, Velocidad 30d y Reposición Sugerida
                </h3>
                <span id="ic-table-count-badge" class="ic-pill-badge ic-pill-primary">0 SKUs</span>
              </div>
              <p style="margin: 0.2rem 0 0 0; font-size: 0.77rem; color: var(--color-text-muted);">
                Haz clic en cualquier fila o en el botón de curva para proyectar el agotamiento diario del SKU en el gráfico superior.
              </p>
            </div>

            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <button type="button" class="ic-btn ic-btn-outline" style="padding: 0.42rem 0.75rem; font-size: 0.76rem;" onclick="window.icResetFilters()">
                <i class="ri-filter-off-line"></i> Limpiar filtros
              </button>
            </div>
          </div>

          <div class="ic-catalog-toolbar">
            <!-- Buscador -->
            <div class="ic-search-wrap">
              <i class="ri-search-line"></i>
              <input
                type="text"
                id="ic-search-input"
                class="ic-search-input"
                placeholder="Buscar por SKU, nombre de producto o comercio..."
                value="${icEscapeHtml(icState.searchQuery)}"
                oninput="window.icHandleSearch(this.value)"
              />
            </div>

            <!-- Pills de Tramo de Salud -->
            <div class="ic-status-pills" id="ic-status-pills-container">
              <button type="button" class="ic-filter-pill ${icState.statusFilter === 'ALL' ? 'active' : ''}" onclick="window.icSetStatusFilter('ALL')">Todos</button>
              <button type="button" class="ic-filter-pill ${icState.statusFilter === 'OUT' ? 'active' : ''}" onclick="window.icSetStatusFilter('OUT')">Agotados (0d)</button>
              <button type="button" class="ic-filter-pill ${icState.statusFilter === 'CRITICAL' ? 'active' : ''}" onclick="window.icSetStatusFilter('CRITICAL')">Críticos (1-7d)</button>
              <button type="button" class="ic-filter-pill ${icState.statusFilter === 'ALERT' ? 'active' : ''}" onclick="window.icSetStatusFilter('ALERT')">Alerta (8-14d)</button>
              <button type="button" class="ic-filter-pill ${icState.statusFilter === 'HEALTHY' ? 'active' : ''}" onclick="window.icSetStatusFilter('HEALTHY')">Óptimos (15-45d)</button>
              <button type="button" class="ic-filter-pill ${icState.statusFilter === 'OVERSTOCK' ? 'active' : ''}" onclick="window.icSetStatusFilter('OVERSTOCK')">Sobrestock / Dormidos</button>
            </div>

            <!-- Filtro ABC + Ordenamiento -->
            <div style="display: grid; grid-template-columns: 1fr 1.25fr; gap: 0.5rem;">
              <select id="ic-abc-select" class="ic-select" style="padding: 0.44rem 0.6rem; font-size: 0.77rem;" onchange="window.icSetAbcFilter(this.value)">
                <option value="ALL" ${icState.abcFilter === 'ALL' ? 'selected' : ''}>Clase ABC: Todas</option>
                <option value="A" ${icState.abcFilter === 'A' ? 'selected' : ''}>Clase A 🔥 (80% vtas)</option>
                <option value="B" ${icState.abcFilter === 'B' ? 'selected' : ''}>Clase B ⚡ (15% vtas)</option>
                <option value="C" ${icState.abcFilter === 'C' ? 'selected' : ''}>Clase C 📦 (5% vtas)</option>
                <option value="DORMANT" ${icState.abcFilter === 'DORMANT' ? 'selected' : ''}>Dormido 💤 (0 vtas)</option>
              </select>

              <select id="ic-sort-select" class="ic-select" style="padding: 0.44rem 0.6rem; font-size: 0.77rem;" onchange="window.icSetSortBy(this.value)">
                <option value="runway_asc" ${icState.sortBy === 'runway_asc' ? 'selected' : ''}>Orden: Menor cobertura</option>
                <option value="runway_desc" ${icState.sortBy === 'runway_desc' ? 'selected' : ''}>Orden: Mayor cobertura</option>
                <option value="sales_desc" ${icState.sortBy === 'sales_desc' ? 'selected' : ''}>Orden: Mayor salida 30d</option>
                <option value="replenish_desc" ${icState.sortBy === 'replenish_desc' ? 'selected' : ''}>Orden: Mayor reposición</option>
                <option value="stock_desc" ${icState.sortBy === 'stock_desc' ? 'selected' : ''}>Orden: Mayor stock disp.</option>
                <option value="volume_desc" ${icState.sortBy === 'volume_desc' ? 'selected' : ''}>Orden: Mayor m³ ocupado</option>
              </select>
            </div>
          </div>
        </div>

        <div class="ic-table-scroll">
          <table class="ic-table">
            <thead>
              <tr>
                <th>SKU / Producto &amp; Clasificación ABC</th>
                <th>Sucursal(es)</th>
                <th>Stock Físico · Comprometido · Disp.</th>
                <th>Salidas 30d &amp; Velocidad</th>
                <th style="min-width: 205px;">Días Cobertura &amp; Fecha Quiebre</th>
                <th>Cubicaje (m³)</th>
                <th style="text-align: right;">Reposición Sugerida (${icState.targetDays}d)</th>
              </tr>
            </thead>
            <tbody id="ic-catalog-tbody"></tbody>
          </table>
        </div>

        <div id="ic-pagination-container" class="ic-pagination-bar"></div>
      </section>
    </div>
  `;
}

// ============================================================================
// ACTUALIZACIÓN DE SUB-COMPONENTES (CONGLOMERADO, KPIs, GRÁFICOS Y TABLA)
// ============================================================================

function renderConglomerateBreakdownPanel() {
  const sectionEl = document.getElementById('ic-conglomerate-section');
  if (!sectionEl) return;

  const isClientMulti = icState.mode === 'client' && icState.companyList.length > 1;
  const isAdminHoldingActive = icState.mode === 'admin' && Array.isArray(icState.perCommerceSummaries) && icState.perCommerceSummaries.length > 1;

  if ((!isClientMulti && !isAdminHoldingActive) || !icState.groupSummary || icState.perCommerceSummaries.length <= 1) {
    sectionEl.style.display = 'none';
    sectionEl.innerHTML = '';
    return;
  }

  sectionEl.style.display = 'block';

  const groupSum = icState.groupSummary;
  const isGroupSelected = icState.mode === 'client'
    ? icState.selectedCommerce === 'ALL'
    : String(icState.selectedCommerce).startsWith('HOLDING::');

  const holdingTitle = icState.mode === 'client'
    ? (icState.parentConglomerateName
        ? `Radiografía del Conglomerado · ${icState.parentConglomerateName}`
        : `Panorama Multi-Comercio (${icState.companyList.length} Comercios Asignados)`)
    : `Radiografía Holding · ${String(groupSum.scopeValue).replace(/^HOLDING::/, '')}`;

  const renderCardBadges = (sum, isConsolidatedCard = false) => {
    const badges = [];
    if (sum.outCount > 0) {
      badges.push(`<span class="ic-mini-badge ic-mini-badge-danger"><i class="ri-error-warning-fill"></i> ${sum.outCount} quiebre${sum.outCount === 1 ? '' : 's'}</span>`);
    }
    if (sum.criticalCount > 0) {
      badges.push(`<span class="ic-mini-badge ic-mini-badge-warn"><i class="ri-alarm-warning-fill"></i> ${sum.criticalCount} crítico${sum.criticalCount === 1 ? '' : 's'}</span>`);
    }
    if (sum.outCount === 0 && sum.criticalCount === 0 && sum.skusCount > 0) {
      badges.push(`<span class="ic-mini-badge ic-mini-badge-ok"><i class="ri-checkbox-circle-fill"></i> Sin urgencias</span>`);
    }
    if (sum.suggestedReplenishUnits > 0) {
      badges.push(`<span class="ic-mini-badge ic-mini-badge-info">+${icFormatNumber(sum.suggestedReplenishUnits)} uds a reponer</span>`);
    } else if (isConsolidatedCard && sum.transitUnits > 0) {
      badges.push(`<span class="ic-mini-badge ic-mini-badge-ok">+${icFormatNumber(sum.transitUnits)} en #ING</span>`);
    }
    return badges.join('');
  };

  const groupRunwayColor = groupSum.weightedRunway >= icState.targetDays
    ? '#10b981'
    : (groupSum.weightedRunway >= icState.targetDays * 0.5 ? '#2563eb' : '#ef4444');

  const groupCardHtml = `
    <div class="ic-commerce-card ${isGroupSelected ? 'is-active-group' : ''}" onclick="window.icHandleCommerceChange('${icEscapeHtml(groupSum.scopeValue)}')">
      <div class="ic-commerce-card-top">
        <div>
          <div class="ic-commerce-card-name">
            <i class="ri-building-2-fill" style="color: #8b5cf6;"></i>
            <span>${icEscapeHtml(groupSum.name)}</span>
          </div>
          <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">
            Vista unificada (${icState.perCommerceSummaries.length} tiendas · ${icFormatNumber(groupSum.skusCount)} SKUs)
          </span>
        </div>
        <span class="ic-pill-badge ic-pill-purple" style="padding: 0.14rem 0.5rem; font-size: 0.69rem;">
          ${isGroupSelected ? '● Activo' : 'Ver todo'}
        </span>
      </div>

      <div class="ic-commerce-metrics-row">
        <div>
          <span style="color: var(--color-text-muted); display: block;">Cobertura</span>
          <strong style="color: ${groupRunwayColor}; font-size: 0.84rem;">${groupSum.weightedRunway.toFixed(1)}d</strong>
        </div>
        <div>
          <span style="color: var(--color-text-muted); display: block;">Salidas 30d</span>
          <strong style="color: var(--color-text-main); font-size: 0.84rem;">${icFormatNumber(groupSum.sales30d)} u.</strong>
        </div>
        <div>
          <span style="color: var(--color-text-muted); display: block;">Disp. / m³</span>
          <strong style="color: var(--color-text-main); font-size: 0.84rem;">${icFormatNumber(groupSum.netAvailable)} · ${groupSum.totalVolumeM3.toFixed(1)}m³</strong>
        </div>
      </div>

      <div class="ic-commerce-health-badges">
        ${renderCardBadges(groupSum, true)}
      </div>
    </div>
  `;

  const commerceCardsHtml = icState.perCommerceSummaries.map(sum => {
    const isSelected = !isGroupSelected && icSameCommerce(icState.selectedCommerce, sum.scopeValue);
    const rwColor = sum.skusCount === 0
      ? 'var(--color-text-muted)'
      : (sum.weightedRunway >= icState.targetDays
          ? '#10b981'
          : (sum.weightedRunway >= icState.targetDays * 0.5 ? '#2563eb' : '#ef4444'));
    const rwText = sum.activeMoversCount > 0 ? `${sum.weightedRunway.toFixed(1)}d` : (sum.netAvailable > 0 ? 'Sin rot.' : '0d');

    return `
      <div class="ic-commerce-card ${isSelected ? 'is-active' : ''}" onclick="window.icHandleCommerceChange('${icEscapeHtml(sum.scopeValue)}')">
        <div class="ic-commerce-card-top">
          <div>
            <div class="ic-commerce-card-name">
              <i class="ri-store-2-line" style="color: ${isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)'};"></i>
              <span>${icEscapeHtml(sum.name)}</span>
            </div>
            <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">
              ${icFormatNumber(sum.skusCount)} SKUs · ${sum.dailyVelocity.toFixed(1)} uds/día
            </span>
          </div>
          <span class="ic-pill-badge ${isSelected ? 'ic-pill-blue' : 'ic-pill-indigo'}" style="padding: 0.12rem 0.45rem; font-size: 0.68rem;">
            ${isSelected ? '● Viendo' : 'Filtrar →'}
          </span>
        </div>

        <div class="ic-commerce-metrics-row">
          <div>
            <span style="color: var(--color-text-muted); display: block;">Cobertura</span>
            <strong style="color: ${rwColor}; font-size: 0.84rem;">${rwText}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block;">Salidas 30d</span>
            <strong style="color: var(--color-text-main); font-size: 0.84rem;">${icFormatNumber(sum.sales30d)} u.</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block;">Disp. / m³</span>
            <strong style="color: var(--color-text-main); font-size: 0.84rem;">${icFormatNumber(sum.netAvailable)} · ${sum.totalVolumeM3.toFixed(1)}m³</strong>
          </div>
        </div>

        <div class="ic-commerce-health-badges">
          ${renderCardBadges(sum, false)}
        </div>
      </div>
    `;
  }).join('');

  sectionEl.innerHTML = `
    <div class="ic-conglomerate-panel">
      <div class="ic-conglomerate-header">
        <div>
          <h4 class="ic-conglomerate-title">
            <i class="ri-node-tree" style="color: #8b5cf6; font-size: 1.05rem;"></i>
            ${icEscapeHtml(holdingTitle)}
          </h4>
          <p class="ic-conglomerate-subtitle">
            Haz clic en cualquier comercio para aislar sus KPIs, su propia clasificación ABC y su tabla de reposición (cambio instantáneo sin recargar), o vuelve al Consolidado para analizar el grupo completo.
          </p>
        </div>
        ${!isGroupSelected ? `
          <button type="button" class="ic-btn ic-btn-outline" style="padding: 0.35rem 0.7rem; font-size: 0.75rem;" onclick="window.icHandleCommerceChange('${icEscapeHtml(groupSum.scopeValue)}')">
            <i class="ri-Focus-2-line"></i> Volver al Consolidado (${icState.perCommerceSummaries.length} comercios)
          </button>
        ` : ''}
      </div>
      <div class="ic-conglomerate-grid">
        ${groupCardHtml}
        ${commerceCardsHtml}
      </div>
    </div>
  `;
}

function renderKpiCards() {
  const kpiContainer = document.getElementById('ic-kpi-section');
  if (!kpiContainer) return;

  const catalog = icState.computedCatalog;
  const activeMovers = catalog.filter(r => r.effectiveDailyVelocity > 0);

  // Tope operativo de 90 días por SKU en el promedio ponderado para evitar que un SKU con sobrestock extremo distorsione la cobertura media
  const totalAvailActiveCapped = activeMovers.reduce((s, r) => {
    const rawSkuAvail = icState.includeTransitInRunway ? (r.availablePositive + r.transitUnits) : r.availablePositive;
    return s + Math.min(rawSkuAvail, r.effectiveDailyVelocity * 90);
  }, 0);
  const totalDailyVel = activeMovers.reduce((s, r) => s + r.effectiveDailyVelocity, 0);
  const weightedRunway = totalDailyVel > 0 ? (totalAvailActiveCapped / totalDailyVel) : 0;

  const totalSales30d = catalog.reduce((s, r) => s + r.sales30d, 0);
  const totalSales7d = catalog.reduce((s, r) => s + r.sales7d, 0);

  const outSkus = catalog.filter(r => r.healthBand === 'OUT');
  const criticalSkus = catalog.filter(r => r.healthBand === 'CRITICAL');
  const alertSkus = catalog.filter(r => r.healthBand === 'ALERT');

  const totalCommitted = catalog.reduce((s, r) => s + r.committedStock, 0);
  const totalTransit = catalog.reduce((s, r) => s + r.transitUnits, 0) || icState.totalDeclaredUnitsGlobal || 0;

  const dormantOrOverSkus = catalog.filter(r => r.healthBand === 'DORMANT' || r.healthBand === 'OVERSTOCK');
  const totalVolM3 = catalog.reduce((s, r) => s + r.totalVolumeM3, 0);
  const dormantVolM3 = dormantOrOverSkus.reduce((s, r) => s + r.totalVolumeM3, 0);
  const dormantVolPct = totalVolM3 > 0 ? Math.round((dormantVolM3 / totalVolM3) * 100) : 0;

  const runwayPct = Math.min(100, Math.round((weightedRunway / icState.targetDays) * 100));
  const runwayStatusColor = weightedRunway >= icState.targetDays
    ? '#10b981'
    : (weightedRunway >= icState.targetDays * 0.5 ? '#2563eb' : '#ef4444');

  kpiContainer.innerHTML = `
    <!-- KPI 1: Cobertura Media Ponderada -->
    <div class="ic-kpi-card ${icState.statusFilter === 'ALL' ? 'active-filter' : ''}" onclick="window.icSetStatusFilter('ALL')">
      <div>
        <div class="ic-kpi-top">
          <span class="ic-kpi-label">Cobertura Media</span>
          <span class="ic-kpi-icon" style="background: rgba(37, 99, 235, 0.14); color: #2563eb;">
            <i class="ri-calendar-todo-line"></i>
          </span>
        </div>
        <div class="ic-kpi-value-row">
          <span class="ic-kpi-value">${weightedRunway.toFixed(1)} días</span>
          <span class="ic-kpi-tag" style="background: rgba(37, 99, 235, 0.12); color: #2563eb;">Meta ${icState.targetDays}d</span>
        </div>
      </div>
      <div>
        <div class="ic-progress-track">
          <div class="ic-progress-fill" style="width: ${runwayPct}%; background: ${runwayStatusColor};"></div>
        </div>
        <div class="ic-kpi-footer" style="border-top: none; padding-top: 0;">
          <span>Sobre ${activeMovers.length} SKUs con rotación</span>
          <strong>${runwayPct}%</strong>
        </div>
      </div>
    </div>

    <!-- KPI 2: Velocidad de Salida (Últ. 30d) -->
    <div class="ic-kpi-card" onclick="window.icSetSortBy('sales_desc')">
      <div>
        <div class="ic-kpi-top">
          <span class="ic-kpi-label">Velocidad Salida</span>
          <span class="ic-kpi-icon" style="background: rgba(99, 102, 241, 0.14); color: #6366f1;">
            <i class="ri-speed-up-line"></i>
          </span>
        </div>
        <div class="ic-kpi-value-row">
          <span class="ic-kpi-value">${totalDailyVel.toFixed(1)} uds/día</span>
        </div>
      </div>
      <div class="ic-kpi-footer">
        <span>${icFormatNumber(totalSales30d)} uds / 30d</span>
        <span style="color: var(--color-success); font-weight: 700;">${icFormatNumber(totalSales7d)} últ. 7d</span>
      </div>
    </div>

    <!-- KPI 3: SKUs en Quiebre Activo (<=0 disp.) -->
    <div class="ic-kpi-card ${icState.statusFilter === 'OUT' ? 'active-filter' : ''}" onclick="window.icSetStatusFilter('OUT')">
      <div>
        <div class="ic-kpi-top">
          <span class="ic-kpi-label">Quiebre Activo</span>
          <span class="ic-kpi-icon" style="background: rgba(239, 68, 68, 0.14); color: #ef4444;">
            <i class="ri-error-warning-line"></i>
          </span>
        </div>
        <div class="ic-kpi-value-row">
          <span class="ic-kpi-value" style="color: #ef4444;">${icFormatNumber(outSkus.length)} SKUs</span>
          <span class="ic-kpi-tag" style="background: rgba(239, 68, 68, 0.14); color: #ef4444;">&le; 0 disp.</span>
        </div>
      </div>
      <div class="ic-kpi-footer">
        <span>Sin stock disponible neto</span>
        <span style="text-decoration: underline;">Filtrar</span>
      </div>
    </div>

    <!-- KPI 4: SKUs en Riesgo Crítico (1-7 días) -->
    <div class="ic-kpi-card ${icState.statusFilter === 'CRITICAL' ? 'active-filter' : ''}" onclick="window.icSetStatusFilter('CRITICAL')">
      <div>
        <div class="ic-kpi-top">
          <span class="ic-kpi-label">Riesgo Crítico (1-7d)</span>
          <span class="ic-kpi-icon" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">
            <i class="ri-alarm-warning-line"></i>
          </span>
        </div>
        <div class="ic-kpi-value-row">
          <span class="ic-kpi-value" style="color: #f59e0b;">${icFormatNumber(criticalSkus.length)} SKUs</span>
          <span class="ic-kpi-tag" style="background: rgba(245, 158, 11, 0.14); color: #d97706;">+${alertSkus.length} alerta</span>
        </div>
      </div>
      <div class="ic-kpi-footer">
        <span>Quiebran en menos de 7 días</span>
        <span style="text-decoration: underline;">Filtrar</span>
      </div>
    </div>

    <!-- KPI 5: Comprometido & Stock en Tránsito (#ING) -->
    <div class="ic-kpi-card" onclick="window.icGoToDeclarations()">
      <div>
        <div class="ic-kpi-top">
          <span class="ic-kpi-label">Comprometido / #ING</span>
          <span class="ic-kpi-icon" style="background: rgba(16, 185, 129, 0.14); color: #10b981;">
            <i class="ri-truck-line"></i>
          </span>
        </div>
        <div class="ic-kpi-value-row">
          <span class="ic-kpi-value" style="color: #10b981;">${icFormatNumber(totalCommitted)} comp.</span>
          <span class="ic-kpi-tag" style="background: rgba(16, 185, 129, 0.14); color: #10b981;">${icState.activeDeclarationsCount || 0} #ING</span>
        </div>
      </div>
      <div class="ic-kpi-footer">
        <span>En tránsito: +${icFormatNumber(totalTransit)} uds</span>
        <span style="color: #10b981; font-weight: 700;">Ingresos →</span>
      </div>
    </div>

    <!-- KPI 6: Stock Dormido / Sobrestock (>90d / 0 ventas) y m³ -->
    <div class="ic-kpi-card ${icState.statusFilter === 'OVERSTOCK' ? 'active-filter' : ''}" onclick="window.icSetStatusFilter('OVERSTOCK')">
      <div>
        <div class="ic-kpi-top">
          <span class="ic-kpi-label">Dormido / Sobrestock</span>
          <span class="ic-kpi-icon" style="background: rgba(139, 92, 246, 0.14); color: #8b5cf6;">
            <i class="ri-archive-drawer-line"></i>
          </span>
        </div>
        <div class="ic-kpi-value-row">
          <span class="ic-kpi-value">${dormantVolM3.toFixed(2)} m³</span>
          <span class="ic-kpi-tag" style="background: rgba(139, 92, 246, 0.14); color: #8b5cf6;">${dormantOrOverSkus.length} SKUs</span>
        </div>
      </div>
      <div class="ic-kpi-footer">
        <span>${dormantVolPct}% del volumen ocupado</span>
        <span style="color: #8b5cf6; font-weight: 700; text-decoration: underline;">Ver SKUs</span>
      </div>
    </div>
  `;
}

function renderAnalyticalPanels() {
  const catalog = icState.computedCatalog;
  const totalVol = catalog.reduce((s, r) => s + r.totalVolumeM3, 0);
  const totalSkus = Math.max(1, catalog.length);

  // --- PANEL 1: Distribución de Salud & Cubicaje (m³) ---
  const totalVolBadge = document.getElementById('ic-total-vol-badge');
  if (totalVolBadge) totalVolBadge.textContent = `Total: ${totalVol.toFixed(2)} m³`;

  const bands = [
    { key: 'OUT', filter: 'OUT', label: 'Agotado (≤ 0 disp.)', color: '#ef4444' },
    { key: 'CRITICAL', filter: 'CRITICAL', label: 'Crítico (1–7 días)', color: '#f97316' },
    { key: 'ALERT', filter: 'ALERT', label: 'Alerta (8–14 días)', color: '#f59e0b' },
    { key: 'HEALTHY', filter: 'HEALTHY', label: 'Saludable (15–45 días)', color: '#10b981' },
    { key: 'OVERSTOCK', filter: 'OVERSTOCK', label: 'Sobrestock (46–90 días)', color: '#6366f1' },
    { key: 'DORMANT', filter: 'OVERSTOCK', label: 'Dormido (>90d / 0 vtas)', color: '#8b5cf6' }
  ];

  const healthListEl = document.getElementById('ic-health-distribution-bars');
  if (healthListEl) {
    healthListEl.innerHTML = bands.map(b => {
      const items = catalog.filter(r => r.healthBand === b.key);
      const count = items.length;
      const vol = items.reduce((s, r) => s + r.totalVolumeM3, 0);
      const skuPct = Math.round((count / totalSkus) * 100);
      const barWidth = Math.max(count > 0 ? 6 : 2, skuPct);

      return `
        <div class="ic-health-row ${icState.statusFilter === b.filter ? 'active-band' : ''}" onclick="window.icSetStatusFilter('${b.filter}')">
          <div class="ic-health-row-top">
            <span style="display: inline-flex; align-items: center; gap: 0.45rem; font-weight: 600;">
              <span class="ic-health-dot" style="background: ${b.color};"></span>
              ${b.label}
            </span>
            <span style="display: inline-flex; align-items: center; gap: 0.4rem;">
              <strong>${count} SKUs</strong>
              <span class="ic-vol-pill">${vol.toFixed(2)} m³</span>
            </span>
          </div>
          <div class="ic-progress-track" style="margin-bottom: 0;">
            <div class="ic-progress-fill" style="width: ${barWidth}%; background: ${b.color};"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- PANEL 2: Curva Burn-down 30 días ---
  renderBurndownPanel();

  // --- PANEL 3: Matriz Pareto ABC vs. Ocupación de Bodega (m³) ---
  const totalSales = Math.max(1, catalog.reduce((s, r) => s + r.sales30d, 0));
  const safeTotalVol = Math.max(0.001, totalVol);

  const abcGroups = [
    { key: 'A', label: 'Clase A 🔥 (Alta Rotación)', items: catalog.filter(r => r.abc === 'A'), salesColor: '#2563eb', volColor: '#10b981' },
    { key: 'B', label: 'Clase B ⚡ (Rotación Media)', items: catalog.filter(r => r.abc === 'B'), salesColor: '#6366f1', volColor: '#f59e0b' },
    { key: 'DORMANT', label: 'Clase C & Dormidos 💤', items: catalog.filter(r => r.abc === 'C' || r.abc === 'DORMANT'), salesColor: '#94a3b8', volColor: '#8b5cf6' }
  ];

  const abcListEl = document.getElementById('ic-abc-matrix-list');
  if (abcListEl) {
    abcListEl.innerHTML = abcGroups.map(g => {
      const sales = g.items.reduce((s, r) => s + r.sales30d, 0);
      const vol = g.items.reduce((s, r) => s + r.totalVolumeM3, 0);
      const salesPct = Math.round((sales / totalSales) * 100);
      const volPct = totalVol > 0 ? Math.round((vol / safeTotalVol) * 100) : 0;

      return `
        <div class="ic-abc-item" onclick="window.icSetAbcFilter('${g.key}')">
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.77rem;">
            <strong>${g.label}</strong>
            <span style="color: var(--color-text-muted); font-weight: 600;">${g.items.length} SKUs · ${vol.toFixed(2)} m³</span>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.73rem; margin-bottom: 0.18rem;">
              <span style="color: var(--color-text-muted);">Aporte a Salidas (30d)</span>
              <strong>${salesPct}% (${icFormatNumber(sales)} uds)</strong>
            </div>
            <div class="ic-progress-track" style="margin-bottom: 0.25rem;">
              <div class="ic-progress-fill" style="width: ${Math.max(3, salesPct)}%; background: ${g.salesColor};"></div>
            </div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.73rem; margin-bottom: 0.18rem;">
              <span style="color: var(--color-text-muted);">Cubicaje Ocupado (m³)</span>
              <strong style="color: ${g.volColor};">${volPct}% (${vol.toFixed(2)} m³)</strong>
            </div>
            <div class="ic-progress-track" style="margin-bottom: 0;">
              <div class="ic-progress-fill" style="width: ${Math.max(3, volPct)}%; background: ${g.volColor};"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const cDormGroup = abcGroups[2];
  const cDormVol = cDormGroup.items.reduce((s, r) => s + r.totalVolumeM3, 0);
  const cDormVolPct = totalVol > 0 ? Math.round((cDormVol / safeTotalVol) * 100) : 0;

  const abcAlertEl = document.getElementById('ic-abc-alert-container');
  if (abcAlertEl) {
    abcAlertEl.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
        <i class="ri-lightbulb-flash-line" style="color: #8b5cf6; font-size: 1.05rem; margin-top: 0.1rem;"></i>
        <div>
          <strong style="color: var(--color-text-main); display: block;">Optimización de Espacio en Bodega</strong>
          <span style="color: var(--color-text-muted);">
            <strong>${cDormGroup.items.length} SKUs</strong> de baja o nula rotación consumen <strong>${cDormVol.toFixed(2)} m³ (${cDormVolPct}%)</strong> del espacio físico.
          </span>
          <div style="margin-top: 0.35rem;">
            <button type="button" onclick="window.icSetAbcFilter('DORMANT')" style="background:none;border:none;color:#8b5cf6;font-weight:700;cursor:pointer;font-size:0.75rem;padding:0;">
              Filtrar SKUs Dormidos para liquidación o retiro →
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

function renderBurndownPanel() {
  const catalog = icState.computedCatalog;
  const selectEl = document.getElementById('ic-burndown-sku-select');
  const metaEl = document.getElementById('ic-burndown-meta');
  const svgEl = document.getElementById('ic-burndown-svg');
  const breakLabelEl = document.getElementById('ic-burndown-break-label');

  if (!selectEl || !metaEl || !svgEl) return;

  const topCandidates = [...catalog]
    .sort((a, b) => (b.sales30d - a.sales30d) || (b.physicalStock - a.physicalStock))
    .slice(0, 40);

  if (topCandidates.length === 0) {
    selectEl.innerHTML = `<option value="">Sin SKUs disponibles</option>`;
    metaEl.innerHTML = `<div style="grid-column: span 3; text-align: center; color: var(--color-text-muted);">Sin datos de SKU para proyectar</div>`;
    svgEl.innerHTML = '';
    return;
  }

  let selectedItem = catalog.find(r => r.id === icState.selectedBurndownProductId) || topCandidates[0];
  icState.selectedBurndownProductId = selectedItem.id;

  // Asegurar que el SKU seleccionado esté en el selector
  const optionsList = topCandidates.some(r => r.id === selectedItem.id)
    ? topCandidates
    : [selectedItem, ...topCandidates];

  const isMultiCommerceView = (icState.mode === 'client' && icState.companyList.length > 1 && icState.selectedCommerce === 'ALL')
    || (icState.mode === 'admin' && (icState.selectedCommerce === 'ALL' || String(icState.selectedCommerce).startsWith('HOLDING::')));

  selectEl.innerHTML = optionsList.map(r => {
    const commPrefix = isMultiCommerceView ? `[${r.comercio}] ` : '';
    return `
      <option value="${icEscapeHtml(r.id)}" ${r.id === selectedItem.id ? 'selected' : ''}>
        ${icEscapeHtml(commPrefix)}${icEscapeHtml(r.sku)} · ${icEscapeHtml(r.name.slice(0, 32))}
      </option>
    `;
  }).join('');

  const injectUnits = selectedItem.transitUnits > 0
    ? selectedItem.transitUnits
    : Math.max(selectedItem.suggestedReplenishUnits, Math.ceil(selectedItem.effectiveDailyVelocity * 15) || 20);
  const injectLabel = selectedItem.transitUnits > 0
    ? `+${selectedItem.transitUnits} uds (${selectedItem.transitDoc || '#ING'})`
    : `+${injectUnits} uds sugeridas`;

  metaEl.innerHTML = `
    <div>
      <span style="color: var(--color-text-muted); display: block;">Stock Disp. Hoy</span>
      <strong style="font-size: 0.9rem; color: var(--color-text-main);">${icFormatNumber(selectedItem.netAvailable)} uds</strong>
      <span style="color: var(--color-text-muted); display: block;">Salida: ${selectedItem.effectiveDailyVelocity.toFixed(1)}/día</span>
    </div>
    <div>
      <span style="color: var(--color-text-muted); display: block;">Quiebre Proyectado</span>
      <strong style="font-size: 0.9rem; color: #ef4444;">${icEscapeHtml(selectedItem.breakDateFormatted)}</strong>
      <span style="color: var(--color-text-muted); display: block;">${icEscapeHtml(selectedItem.breakDateSub)}</span>
    </div>
    <div>
      <span style="color: var(--color-text-muted); display: block;">Simulación Ingreso</span>
      <strong style="font-size: 0.9rem; color: #10b981;">${icEscapeHtml(injectLabel)}</strong>
      <span style="color: var(--color-text-muted); display: block;">Meta: ${icState.targetDays} días</span>
    </div>
  `;

  if (breakLabelEl) {
    breakLabelEl.textContent = `Quiebre: ${selectedItem.breakDateFormatted}`;
  }

  // Generar puntos SVG (30 días)
  const days = 30;
  const dailyVel = Math.max(0.15, selectedItem.effectiveDailyVelocity);
  const startStock = Math.max(0, selectedItem.netAvailable);
  const injectDay = 4;
  const safetyStock = Math.max(selectedItem.stockCritico || 0, Math.round(dailyVel * 7));
  const maxY = Math.max(startStock + injectUnits, safetyStock * 1.8, 25);

  const ptsNoIng = [];
  const ptsWithIng = [];

  for (let d = 0; d <= days; d++) {
    const vNo = Math.max(0, startStock - dailyVel * d);
    let vWith = startStock - dailyVel * d;
    if (d >= injectDay) vWith += injectUnits;
    vWith = Math.max(0, vWith);
    ptsNoIng.push({ d, v: vNo });
    ptsWithIng.push({ d, v: vWith });
  }

  const svgW = 520;
  const svgH = 190;
  const padL = 38;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const xPos = d => +(padL + (d / days) * plotW).toFixed(1);
  const yPos = v => +(padT + plotH - (Math.min(v, maxY) / maxY) * plotH).toFixed(1);

  const pathNo = ptsNoIng.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${xPos(p.d)},${yPos(p.v)}`).join(' ');
  const pathWith = ptsWithIng.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${xPos(p.d)},${yPos(p.v)}`).join(' ');
  const areaWith = `${pathWith} L${xPos(days)},${yPos(0)} L${xPos(0)},${yPos(0)} Z`;

  const safetyY = yPos(safetyStock);
  const injectX = xPos(injectDay);
  const injectY = yPos(ptsWithIng[injectDay].v);

  svgEl.innerHTML = `
    <defs>
      <linearGradient id="icGradIng" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#10b981" stop-opacity="0.26" />
        <stop offset="100%" stop-color="#10b981" stop-opacity="0.02" />
      </linearGradient>
    </defs>

    <line x1="${padL}" y1="${padT}" x2="${svgW - padR}" y2="${padT}" stroke="var(--color-border)" stroke-width="1" />
    <line x1="${padL}" y1="${padT + plotH / 2}" x2="${svgW - padR}" y2="${padT + plotH / 2}" stroke="var(--color-border)" stroke-width="1" stroke-dasharray="3,3" />
    <line x1="${padL}" y1="${padT + plotH}" x2="${svgW - padR}" y2="${padT + plotH}" stroke="var(--color-border)" stroke-width="1" />

    <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" font-size="11" fill="var(--color-text-muted)">${Math.round(maxY)}</text>
    <text x="${padL - 6}" y="${padT + plotH / 2 + 4}" text-anchor="end" font-size="11" fill="var(--color-text-muted)">${Math.round(maxY / 2)}</text>
    <text x="${padL - 6}" y="${padT + plotH + 4}" text-anchor="end" font-size="11" fill="var(--color-text-muted)">0</text>

    <text x="${xPos(0)}" y="${svgH - 6}" text-anchor="start" font-size="11" fill="var(--color-text-muted)">Hoy</text>
    <text x="${xPos(7)}" y="${svgH - 6}" text-anchor="middle" font-size="11" fill="var(--color-text-muted)">+7d</text>
    <text x="${xPos(15)}" y="${svgH - 6}" text-anchor="middle" font-size="11" fill="var(--color-text-muted)">+15d</text>
    <text x="${xPos(22)}" y="${svgH - 6}" text-anchor="middle" font-size="11" fill="var(--color-text-muted)">+22d</text>
    <text x="${xPos(30)}" y="${svgH - 6}" text-anchor="end" font-size="11" fill="var(--color-text-muted)">+30d</text>

    <line x1="${padL}" y1="${safetyY}" x2="${svgW - padR}" y2="${safetyY}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,4" />
    <text x="${svgW - padR - 4}" y="${Math.max(12, safetyY - 4)}" text-anchor="end" font-size="11" font-weight="600" fill="#f59e0b">
      Umbral (${safetyStock}u)
    </text>

    <path d="${areaWith}" fill="url(#icGradIng)" />
    <path d="${pathWith}" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    <path d="${pathNo}" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="4,4" stroke-linecap="round" />

    <circle cx="${injectX}" cy="${injectY}" r="4.5" fill="#10b981" stroke="var(--color-surface)" stroke-width="1.5" />
  `;
}

// ============================================================================
// TABLA MAESTRA FILTRADA, ORDENADA Y PAGINADA
// ============================================================================

function getFilteredAndSortedCatalog() {
  let rows = [...icState.computedCatalog];

  if (icState.searchQuery) {
    const q = icState.searchQuery.toLowerCase();
    rows = rows.filter(r =>
      r.sku.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.comercio.toLowerCase().includes(q)
    );
  }

  if (icState.statusFilter !== 'ALL') {
    if (icState.statusFilter === 'OVERSTOCK') {
      rows = rows.filter(r => r.healthBand === 'OVERSTOCK' || r.healthBand === 'DORMANT');
    } else {
      rows = rows.filter(r => r.healthBand === icState.statusFilter);
    }
  }

  if (icState.abcFilter !== 'ALL') {
    rows = rows.filter(r => r.abc === icState.abcFilter);
  }

  rows.sort((a, b) => {
    if (icState.sortBy === 'runway_asc') return a.runwayDays - b.runwayDays;
    if (icState.sortBy === 'runway_desc') return b.runwayDays - a.runwayDays;
    if (icState.sortBy === 'sales_desc') return b.sales30d - a.sales30d;
    if (icState.sortBy === 'replenish_desc') return b.suggestedReplenishUnits - a.suggestedReplenishUnits;
    if (icState.sortBy === 'stock_desc') return b.netAvailable - a.netAvailable;
    if (icState.sortBy === 'volume_desc') return b.totalVolumeM3 - a.totalVolumeM3;
    return 0;
  });

  return rows;
}

function renderAbcBadgeHtml(abc) {
  if (abc === 'A') return `<span class="ic-abc-badge ic-abc-a">Clase A 🔥</span>`;
  if (abc === 'B') return `<span class="ic-abc-badge ic-abc-b">Clase B ⚡</span>`;
  if (abc === 'C') return `<span class="ic-abc-badge ic-abc-c">Clase C 📦</span>`;
  return `<span class="ic-abc-badge ic-abc-dormant">Dormido 💤</span>`;
}

function renderCatalogTable() {
  const tbody = document.getElementById('ic-catalog-tbody');
  const countBadge = document.getElementById('ic-table-count-badge');
  const paginationEl = document.getElementById('ic-pagination-container');
  if (!tbody) return;

  const filtered = getFilteredAndSortedCatalog();
  if (countBadge) {
    countBadge.textContent = `${icFormatNumber(filtered.length)} SKUs`;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / icState.pageSize));
  if (icState.page > totalPages) icState.page = totalPages;

  const startIdx = (icState.page - 1) * icState.pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + icState.pageSize);

  const showCommerceBadgeInRow = icState.mode === 'admin' || icState.companyList.length > 1;

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 2.5rem 1rem; color: var(--color-text-muted);">
          No se encontraron SKUs para los filtros activos.
          <button type="button" onclick="window.icResetFilters()" style="margin-left:0.5rem;background:none;border:none;color:var(--color-primary);font-weight:700;cursor:pointer;text-decoration:underline;">
            Restablecer filtros
          </button>
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pageItems.map(item => {
      const isSelectedBurndown = item.id === icState.selectedBurndownProductId;
      const commerceChip = showCommerceBadgeInRow
        ? `<button type="button" class="ic-commerce-chip-btn" title="Filtrar vista por ${icEscapeHtml(item.comercio)}" onclick="event.stopPropagation(); window.icHandleCommerceChange('${icEscapeHtml(item.comercio)}')">
             <i class="ri-store-2-line"></i> ${icEscapeHtml(item.comercio)}
           </button>`
        : '';

      const branchesHtml = item.branchBreakdown.length > 0
        ? item.branchBreakdown.map(b => `
            <span class="ic-branch-chip" title="Físico: ${b.quantity} | Comprometido: ${b.committed}">
              ${icEscapeHtml(b.name)}: <strong>${b.available}</strong>
            </span>
          `).join('')
        : `<span style="color: var(--color-text-muted); font-size: 0.75rem;">Sin stock en bodega</span>`;

      let bandColor = '#10b981';
      let runwayText = `${item.runwayDays.toFixed(1)} días`;
      if (item.healthBand === 'OUT') {
        bandColor = '#ef4444';
        runwayText = '0 días (Quiebre)';
      } else if (item.healthBand === 'CRITICAL') {
        bandColor = '#f97316';
      } else if (item.healthBand === 'ALERT') {
        bandColor = '#f59e0b';
      } else if (item.healthBand === 'OVERSTOCK') {
        bandColor = '#6366f1';
        runwayText = `${Math.round(item.runwayDays)} días (Alto)`;
      } else if (item.healthBand === 'DORMANT') {
        bandColor = '#8b5cf6';
        runwayText = item.sales30d === 0 ? 'Sin salidas (30d)' : '+90 días';
      }

      const barPct = item.healthBand === 'OUT'
        ? 5
        : Math.min(100, Math.max(8, Math.round((item.runwayDays / icState.targetDays) * 100)));

      const unitCm3 = Math.round(item.unitVolumeM3 * 1000000);

      let actionCellHtml = '';
      if (item.suggestedReplenishUnits > 0) {
        actionCellHtml = `
          <div style="text-align: right;">
            <div style="font-weight: 800; color: var(--color-text-main); font-size: 0.82rem;">
              Enviar +${icFormatNumber(item.suggestedReplenishUnits)} uds
            </div>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-bottom: 0.35rem;">
              Vol. envío: ${item.replenishVolumeM3.toFixed(3)} m³
            </div>
            <button type="button" class="ic-btn ic-btn-primary" style="padding: 0.32rem 0.65rem; font-size: 0.74rem;" onclick="event.stopPropagation(); window.icGoToDeclarations('${icEscapeHtml(item.comercio)}')">
              <i class="ri-add-circle-line"></i> Declarar #ING
            </button>
          </div>
        `;
      } else if (item.healthBand === 'DORMANT' && item.physicalStock > 0) {
        actionCellHtml = `
          <div style="text-align: right;">
            <span class="ic-abc-badge ic-abc-dormant">Inmovilizado (${item.totalVolumeM3.toFixed(2)} m³)</span>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.25rem;">
              Evaluar retiro o promoción
            </div>
          </div>
        `;
      } else {
        actionCellHtml = `
          <div style="text-align: right;">
            <span class="ic-pill-badge ic-pill-emerald">✓ Cobertura OK</span>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.2rem;">
              Meta ${icState.targetDays}d cubierta
            </div>
          </div>
        `;
      }

      return `
        <tr class="${isSelectedBurndown ? 'ic-row-selected' : ''}" onclick="window.icSelectBurndownSku('${icEscapeHtml(item.id)}')" style="cursor: pointer;">
          <!-- SKU / Producto / ABC -->
          <td style="max-width: 290px;">
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin-bottom: 0.25rem;">
              <strong style="font-family: monospace; font-size: 0.82rem; color: var(--color-text-main);">${icEscapeHtml(item.sku)}</strong>
              ${renderAbcBadgeHtml(item.abc)}
              ${commerceChip}
            </div>
            <div style="font-weight: 600; color: var(--color-text-main); line-height: 1.3;">
              ${icEscapeHtml(item.name)}
            </div>
            <div style="margin-top: 0.25rem; font-size: 0.72rem; color: var(--color-primary); font-weight: 600;">
              <i class="ri-line-chart-line"></i> ${isSelectedBurndown ? 'Viendo en curva Burn-down' : 'Clic para proyectar curva 30d'}
            </div>
          </td>

          <!-- Sucursal(es) -->
          <td>
            <div style="display: flex; flex-wrap: wrap;">
              ${branchesHtml}
            </div>
          </td>

          <!-- Stock Físico / Comprometido / Disponible -->
          <td>
            <div style="font-size: 0.88rem; font-weight: 800; color: ${item.netAvailable <= 0 ? '#ef4444' : 'var(--color-text-main)'};">
              ${icFormatNumber(item.netAvailable)} disp.
            </div>
            <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.15rem;">
              ${icFormatNumber(item.physicalStock)} fís. · ${icFormatNumber(item.committedStock)} comp.
            </div>
            ${item.transitUnits > 0 ? `
              <div style="margin-top: 0.25rem;">
                <span class="ic-pill-badge ic-pill-emerald" style="font-size: 0.7rem; padding: 0.1rem 0.4rem;">
                  +${icFormatNumber(item.transitUnits)} en ${icEscapeHtml(item.transitDoc || '#ING')}
                </span>
              </div>
            ` : ''}
          </td>

          <!-- Salidas 30d & Velocidad -->
          <td>
            <div style="font-weight: 800; color: var(--color-text-main); font-size: 0.82rem;">
              ${item.effectiveDailyVelocity.toFixed(2)} uds/día
              ${icState.demandMultiplier > 1 ? `<span style="color:#6366f1;">(${icState.demandMultiplier}x)</span>` : ''}
            </div>
            <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.15rem;">
              <strong>${icFormatNumber(item.sales30d)} uds</strong> en últ. 30d (${icFormatNumber(item.sales7d)} en 7d)
            </div>
          </td>

          <!-- Días Cobertura & Quiebre -->
          <td>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; margin-bottom: 0.25rem;">
              <strong style="color: ${bandColor}; font-size: 0.8rem;">${runwayText}</strong>
              <span style="font-weight: 700; font-size: 0.76rem; color: var(--color-text-main);">${icEscapeHtml(item.breakDateFormatted)}</span>
            </div>
            <div class="ic-progress-track">
              <div class="ic-progress-fill" style="width: ${barPct}%; background: ${bandColor};"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--color-text-muted);">
              <span>Meta: ${icState.targetDays}d</span>
              <span>${icEscapeHtml(item.breakDateSub)}</span>
            </div>
          </td>

          <!-- Cubicaje (m³) -->
          <td>
            <div style="font-family: monospace; font-weight: 700; font-size: 0.82rem; color: var(--color-text-main);">
              ${item.totalVolumeM3.toFixed(3)} m³
            </div>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.15rem;">
              ${unitCm3 > 0 ? `${icFormatNumber(unitCm3)} cm³/ud` : 'Sin dim.'}
            </div>
          </td>

          <!-- Reposición Sugerida -->
          <td>
            ${actionCellHtml}
          </td>
        </tr>
      `;
    }).join('');
  }

  if (paginationEl) {
    const fromNum = filtered.length === 0 ? 0 : startIdx + 1;
    const toNum = Math.min(filtered.length, startIdx + icState.pageSize);
    paginationEl.innerHTML = `
      <div>
        Mostrando <strong>${fromNum}–${toNum}</strong> de <strong>${icFormatNumber(filtered.length)}</strong> SKUs
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <button type="button" class="ic-btn ic-btn-outline" style="padding: 0.32rem 0.65rem; font-size: 0.75rem;" ${icState.page <= 1 ? 'disabled' : ''} onclick="window.icChangePage(${icState.page - 1})">
          ← Anterior
        </button>
        <span style="font-weight: 700; color: var(--color-text-main);">
          Página ${icState.page} de ${totalPages}
        </span>
        <button type="button" class="ic-btn ic-btn-outline" style="padding: 0.32rem 0.65rem; font-size: 0.75rem;" ${icState.page >= totalPages ? 'disabled' : ''} onclick="window.icChangePage(${icState.page + 1})">
          Siguiente →
        </button>
      </div>
    `;
  }
}

function refreshAllWidgets() {
  computeCatalogIntelligence();
  renderConglomerateBreakdownPanel();
  renderKpiCards();
  renderAnalyticalPanels();
  renderCatalogTable();
}

// ============================================================================
// HANDLERS INTERACTIVOS EXPUESTOS EN WINDOW
// ============================================================================

window.icHandleCommerceChange = async function(newCommerce) {
  const prevCommerce = icState.selectedCommerce;
  icState.selectedCommerce = newCommerce || 'ALL';
  icState.page = 1;

  // Sincronizar scope global del Portal Cliente para experiencia consistente entre módulos
  if (icState.mode === 'client') {
    window.clientDashboardCommerceScope = icState.selectedCommerce === 'ALL' ? '__ALL__' : icState.selectedCommerce;
    if (icState.selectedCommerce !== 'ALL') {
      window.activeIntegrationCommerce = icState.selectedCommerce;
    }
    // En modo cliente ya cargamos todos los comercios asignados en memoria: cambio instantáneo (0ms)
    if (icState.lastLoadedAt) {
      renderFullModuleScaffold();
      refreshAllWidgets();
      return;
    }
  } else {
    // En modo Admin, si alternamos entre un Holding ya cargado y cualquiera de sus comercios hijos, también es instantáneo
    const isPrevInLoadedHolding = icState.activeHoldingChildren.length > 1 && (
      String(prevCommerce).startsWith('HOLDING::') ||
      icState.activeHoldingChildren.some(ch => icSameCommerce(ch, prevCommerce))
    );
    const isNextInSameHolding = icState.activeHoldingChildren.length > 1 && (
      (String(icState.selectedCommerce).startsWith('HOLDING::') &&
        icState.adminHoldingsList.some(h =>
          icSameCommerce(`HOLDING::${h.name}`, icState.selectedCommerce) &&
          h.children.some(ch => icState.activeHoldingChildren.includes(ch))
        )) ||
      icState.activeHoldingChildren.some(ch => icSameCommerce(ch, icState.selectedCommerce))
    );
    if (icState.lastLoadedAt && isPrevInLoadedHolding && isNextInSameHolding) {
      renderFullModuleScaffold();
      refreshAllWidgets();
      return;
    }
  }

  await loadAndRenderModule({ forceRefresh: false });
};

window.icHandleWarehouseChange = function(warehouseId) {
  icState.selectedWarehouseId = warehouseId || 'ALL';
  icState.page = 1;
  refreshAllWidgets();
};

window.icSetTargetDays = function(days) {
  icState.targetDays = Number(days) || 30;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icSetMultiplier = function(mult) {
  icState.demandMultiplier = Number(mult) || 1.0;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icToggleIncludeTransit = function(checked) {
  icState.includeTransitInRunway = !!checked;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icToggleGuide = function() {
  icState.showGuide = !icState.showGuide;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icHandleSearch = function(query) {
  icState.searchQuery = String(query || '').trim();
  icState.page = 1;
  renderCatalogTable();
};

window.icSetStatusFilter = function(status) {
  icState.statusFilter = status || 'ALL';
  icState.page = 1;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icSetAbcFilter = function(abc) {
  icState.abcFilter = abc || 'ALL';
  icState.page = 1;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icSetSortBy = function(sortBy) {
  icState.sortBy = sortBy || 'runway_asc';
  icState.page = 1;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icResetFilters = function() {
  icState.searchQuery = '';
  icState.statusFilter = 'ALL';
  icState.abcFilter = 'ALL';
  icState.sortBy = 'runway_asc';
  icState.page = 1;
  renderFullModuleScaffold();
  refreshAllWidgets();
};

window.icChangePage = function(newPage) {
  icState.page = Math.max(1, parseInt(newPage, 10) || 1);
  renderCatalogTable();
};

window.icSelectBurndownSku = function(productId) {
  icState.selectedBurndownProductId = String(productId);
  renderBurndownPanel();
  renderCatalogTable();
};

window.icRefreshData = async function() {
  await loadAndRenderModule({ forceRefresh: true });
};

window.icGoToDeclarations = function(commerceName) {
  const targetComm = commerceName
    || (icState.selectedCommerce && icState.selectedCommerce !== 'ALL' && !String(icState.selectedCommerce).startsWith('HOLDING::')
        ? icState.selectedCommerce
        : null);
  if (targetComm) {
    window.activeIntegrationCommerce = targetComm;
    window.clientDashboardCommerceScope = targetComm;
  }
  const targetView = icState.mode === 'admin' ? 'declarations_admin' : 'declarations';
  const navLink = document.querySelector(`.nav-item[data-view="${targetView}"]`)
    || document.querySelector(`.nav-item[data-view="declarations"]`);
  if (navLink) {
    navLink.click();
  }
};

window.icExportExcel = function() {
  const rows = getFilteredAndSortedCatalog();
  const formatRowForSheet = r => ({
    Comercio: r.comercio,
    SKU: r.sku,
    Producto: r.name,
    'Clase ABC': r.abc,
    'Stock Físico': r.physicalStock,
    'Stock Comprometido': r.committedStock,
    'Stock Disponible Neto': r.netAvailable,
    'Unidades en Tránsito (#ING)': r.transitUnits,
    'Salidas 30d (uds)': r.sales30d,
    'Salidas 7d (uds)': r.sales7d,
    'Velocidad Diaria (uds/día)': Number(r.effectiveDailyVelocity.toFixed(2)),
    'Días de Cobertura': r.sales30d === 0 ? 'Sin salidas' : Number(r.runwayDays.toFixed(1)),
    'Fecha Estimada Quiebre': r.breakDateFormatted,
    'Tramo Salud': r.healthBand,
    'Cubicaje Total (m3)': Number(r.totalVolumeM3.toFixed(4)),
    [`Reposición Sugerida (${icState.targetDays}d)`]: r.suggestedReplenishUnits
  });

  const exportData = rows.map(formatRowForSheet);

  if (window.XLSX && window.XLSX.utils) {
    const wb = window.XLSX.utils.book_new();

    // Si el usuario pertenece a un Conglomerado o tiene varios comercios, incluir hoja ejecutiva Resumen_Comercios y hojas por tienda
    const hasMultiCommerceBreakdown = Array.isArray(icState.perCommerceSummaries) && icState.perCommerceSummaries.length > 1 && icState.groupSummary;
    if (hasMultiCommerceBreakdown) {
      const summarySheetRows = [icState.groupSummary, ...icState.perCommerceSummaries].map(s => ({
        'Comercio / Nivel': s.name,
        'Total SKUs': s.skusCount,
        'SKUs con Rotación (30d)': s.activeMoversCount,
        'Cobertura Ponderada (días)': Number(s.weightedRunway.toFixed(1)),
        'Velocidad Salida (uds/día)': Number(s.dailyVelocity.toFixed(2)),
        'Salidas 30d (uds)': s.sales30d,
        'Salidas 7d (uds)': s.sales7d,
        'Stock Físico (uds)': s.physicalStock,
        'Stock Comprometido (uds)': s.committedStock,
        'Stock Disponible (uds)': s.netAvailable,
        'SKUs en Quiebre (<=0)': s.outCount,
        'SKUs en Riesgo Crítico (1-7d)': s.criticalCount,
        'SKUs en Alerta (8-14d)': s.alertCount,
        'SKUs Saludables (15-45d)': s.healthyCount,
        'SKUs Sobrestock/Dormidos': s.overstockCount,
        'Volumen Ocupado (m3)': Number(s.totalVolumeM3.toFixed(3)),
        [`Unidades a Reponer (${icState.targetDays}d)`]: s.suggestedReplenishUnits
      }));
      const wsSummary = window.XLSX.utils.json_to_sheet(summarySheetRows);
      window.XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen_Comercios');
    }

    const mainSheetName = icState.selectedCommerce === 'ALL' || String(icState.selectedCommerce).startsWith('HOLDING::')
      ? 'Consolidado_30d'
      : String(icState.selectedCommerce).replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Cobertura_30d';

    const wsMain = window.XLSX.utils.json_to_sheet(exportData);
    window.XLSX.utils.book_append_sheet(wb, wsMain, mainSheetName);

    // Si estamos exportando la vista consolidada de un conglomerado, agregar pestaña individual por cada comercio
    if (hasMultiCommerceBreakdown && (icState.selectedCommerce === 'ALL' || String(icState.selectedCommerce).startsWith('HOLDING::'))) {
      const usedSheetNames = new Set(['Resumen_Comercios', mainSheetName]);
      icState.perCommerceSummaries.forEach(sum => {
        const commRows = (icState.fullGroupCatalog || [])
          .filter(r => icSameCommerce(r.comercio, sum.scopeValue))
          .sort((a, b) => a.runwayDays - b.runwayDays)
          .map(formatRowForSheet);
        if (commRows.length === 0) return;
        let cleanSheetName = String(sum.name).replace(/[\\/?*[\]:]/g, '').trim().slice(0, 28) || 'Comercio';
        if (usedSheetNames.has(cleanSheetName)) {
          cleanSheetName = `${cleanSheetName.slice(0, 24)}_${usedSheetNames.size}`;
        }
        usedSheetNames.add(cleanSheetName);
        const wsComm = window.XLSX.utils.json_to_sheet(commRows);
        window.XLSX.utils.book_append_sheet(wb, wsComm, cleanSheetName);
      });
    }

    const scopeSlug = icState.parentConglomerateName
      ? icState.parentConglomerateName.replace(/\s+/g, '_')
      : (icState.selectedCommerce !== 'ALL' ? String(icState.selectedCommerce).replace(/^HOLDING::/, '').replace(/\s+/g, '_') : 'Consolidado');
    const fileName = `Stocka_Cobertura_${scopeSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
  } else if (exportData.length > 0) {
    const headers = Object.keys(exportData[0]);
    const csvRows = [
      headers.join(';'),
      ...exportData.map(row => headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(';'))
    ];
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Stocka_Cobertura_Runway30d_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
};

// ============================================================================
// CARGA PRINCIPAL Y FUNCIONES PÚBLICAS DE ENTRADA
// ============================================================================

async function loadAndRenderModule({ forceRefresh = false } = {}) {
  const container = document.getElementById('app-content');
  if (!container) return;

  container.innerHTML = `
    <div class="card" style="padding: 3rem 1.5rem; text-align: center;">
      <i class="ri-loader-4-line ri-spin" style="font-size: 2.2rem; color: var(--color-primary); display: inline-block; margin-bottom: 0.75rem;"></i>
      <h3 style="margin: 0; font-size: 1.05rem; color: var(--color-text-main);">
        Calculando Cobertura de Inventario (Runway 30d), Velocidad de Salidas y Matriz ABC...
      </h3>
      <p style="margin: 0.35rem 0 0 0; font-size: 0.82rem; color: var(--color-text-muted);">
        Cruzando inventario multi-bodega, pedidos de los últimos 30 días y cubicaje volumétrico (m³).
      </p>
    </div>
  `;

  try {
    const payload = await fetchCoverageDataset({
      mode: icState.mode,
      companyList: icState.companyList,
      selectedCommerce: icState.selectedCommerce,
      forceRefresh
    });

    icState.rawWarehouses = payload.warehouses || [];
    icState.rawProducts = payload.products || [];
    icState.rawOrders30d = payload.orders30d || [];
    icState.rawDeclarations = payload.declarations || [];
    icState.lastLoadedAt = new Date();

    // Calcular inteligencia antes de dibujar el scaffold por si se reconciliaron nombres de comercios
    computeCatalogIntelligence();
    renderFullModuleScaffold();
    refreshAllWidgets();
  } catch (err) {
    console.error('[InventoryCoverage] Error cargando módulo:', err);
    container.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center;">
        <p style="color: var(--color-danger); font-weight: 600;">No se pudo cargar el Centro de Cobertura de Inventario.</p>
        <p style="color: var(--color-text-muted); font-size: 0.82rem; margin-top: 0.35rem;">${icEscapeHtml(err?.message || 'Error de conexión')}</p>
        <button type="button" class="btn btn-primary" style="margin-top: 1rem;" onclick="window.icRefreshData()">Reintentar</button>
      </div>
    `;
  }
}

window.renderInventoryCoverageClient = async function(options = {}) {
  icState.mode = 'client';
  const viewTitle = document.getElementById('view-title');
  if (viewTitle) {
    viewTitle.textContent = 'Cobertura de Inventario (30d) & Rotación ABC';
  }

  const detected = await detectClientCommerces();
  const companies = detected.commerces || [];
  icState.companyList = companies;
  icState.parentConglomerateName = detected.parentConglomerateName || null;

  const matchedOptionCommerce = options.commerce
    ? companies.find(c => icSameCommerce(c, options.commerce))
    : null;
  const matchedDashboardScope = (window.clientDashboardCommerceScope && window.clientDashboardCommerceScope !== '__ALL__')
    ? companies.find(c => icSameCommerce(c, window.clientDashboardCommerceScope))
    : null;

  if (matchedOptionCommerce) {
    icState.selectedCommerce = matchedOptionCommerce;
  } else if (companies.length === 1) {
    icState.selectedCommerce = companies[0];
  } else if (matchedDashboardScope) {
    icState.selectedCommerce = matchedDashboardScope;
  } else {
    icState.selectedCommerce = 'ALL';
  }

  await loadAndRenderModule({ forceRefresh: !!options.forceRefresh });
};

window.renderInventoryCoverageAdmin = async function(options = {}) {
  icState.mode = 'admin';
  const viewTitle = document.getElementById('view-title');
  if (viewTitle) {
    viewTitle.textContent = 'Cobertura de Inventario (Runway 30d) & Salud ABC';
  }

  const [allCommerces, holdingsDir] = await Promise.all([
    fetchAdminCommercesList(!!options.forceRefresh),
    buildConglomeratesDirectory(!!options.forceRefresh)
  ]);
  icState.allCommerces = allCommerces;

  // Construir lista de Conglomerados/Holdings disponibles en Admin que tengan comercios activos
  const holdingsList = [];
  holdingsDir.forEach((children, hKey) => {
    const matchedChildren = children
      .map(ch => allCommerces.find(ac => icSameCommerce(ac, ch)) || ch)
      .filter((v, idx, arr) => arr.findIndex(x => icSameCommerce(x, v)) === idx);
    if (matchedChildren.length > 1) {
      holdingsList.push({
        name: hKey,
        children: matchedChildren
      });
    }
  });
  icState.adminHoldingsList = holdingsList.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (options.commerce) {
    icState.selectedCommerce = options.commerce;
  } else if (!icState.selectedCommerce) {
    icState.selectedCommerce = 'ALL';
  }

  await loadAndRenderModule({ forceRefresh: !!options.forceRefresh });
};

window.openInventoryCoverageModule = function(commerce) {
  const isAdminPage = window.location.pathname.toLowerCase().includes('admin.html')
    || !!document.querySelector('[data-sidebar-role="admin"]');

  if (commerce) {
    icState.selectedCommerce = commerce;
  }

  const targetView = isAdminPage ? 'inventory_coverage_admin' : 'inventory_coverage';
  const navLink = document.querySelector(`.nav-item[data-view="${targetView}"]`);

  if (navLink) {
    navLink.click();
    if (commerce) {
      setTimeout(() => {
        if (isAdminPage) {
          window.renderInventoryCoverageAdmin({ commerce });
        } else {
          window.renderInventoryCoverageClient({ commerce });
        }
      }, 50);
    }
  } else if (isAdminPage) {
    window.renderInventoryCoverageAdmin({ commerce });
  } else {
    window.renderInventoryCoverageClient({ commerce });
  }
};
