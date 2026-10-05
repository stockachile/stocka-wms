/**
 * WMS STOCKA - MÓDULO DE UBICACIONES FÍSICAS DE INVENTARIO
 * 
 * Gestiona el mapeo de productos a sus ubicaciones físicas en bodegas:
 * - Nivel 1: Bodega (CDD La Reina, Matriz Ñuñoa, CDD Recoleta, Bodega Central, etc.)
 * - Nivel 2: Zona (Salón, Subterráneo, Altillo, etc. Personalizable)
 * - Nivel 3: Espacio (Estante 1, Mesón Principal, Rack A, etc. Personalizable)
 * - Nivel 4: Posición (Bandeja 1, Nivel 4, Suelo, etc. Opcional / Personalizable)
 * 
 * Flujo de Trabajo:
 * 1. Selección de Comercio (Cliente) con dropdown interactivo y buscador
 * 2. Selección de Bodega donde trabajar
 * 3. Visualización del catálogo completo de productos del comercio en la bodega seleccionada
 * 4. Asignación directa e individual con 1-click para productos sin ubicación en dicha bodega
 * 5. Carga masiva por planilla (Excel/CSV/Pegado directo) con validación previa y vista previa interactiva
 * 6. Soporte multi-bodega y multi-ubicación por producto dentro de la misma bodega
 * 7. Sincronización en tiempo real con la pantalla del operario en el sistema Picker
 * 8. Marcado y desmarcado de 0 Stock en ubicaciones
 */

// Configuración Supabase (WMS y Picker)
const WMS_SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

const PICKER_SUPABASE_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

let pickerClientInstance = null;
function getPickerClient() {
  if (!pickerClientInstance && window.supabase && typeof window.supabase.createClient === 'function') {
    pickerClientInstance = window.supabase.createClient(PICKER_SUPABASE_URL, PICKER_SUPABASE_KEY);
  }
  return pickerClientInstance;
}

// Helper para obtener el cliente principal de base de datos de WMS (con fallbacks robustos)
let wmsClientFallback = null;
function getLocationsClient() {
  if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
    return window.supabaseClient;
  }
  if (window.supabaseDb && typeof window.supabaseDb.from === 'function') {
    return window.supabaseDb;
  }
  if (typeof supabase !== 'undefined' && typeof supabase.from === 'function') {
    return supabase;
  }
  if (window.supabase && typeof window.supabase.from === 'function') {
    return window.supabase;
  }
  if (!wmsClientFallback && window.supabase && typeof window.supabase.createClient === 'function') {
    wmsClientFallback = window.supabase.createClient(WMS_SUPABASE_URL, WMS_SUPABASE_ANON_KEY);
    return wmsClientFallback;
  }
  return wmsClientFallback;
}

// Estado global del módulo de ubicaciones
window.locationsState = {
  activeCommerce: '',        // Comercio seleccionado
  activeBodega: '',          // Bodega de trabajo seleccionada
  searchFilter: '',          // Filtro de búsqueda textual
  statusFilter: 'ALL',       // ALL | WITH_LOCATION | WITHOUT_LOCATION | ZERO
  quickEditMode: false,      // Modo de edición rápida tipo planilla
  locations: [],             // Lista de registros de product_locations
  productsCatalog: [],       // Lista de productos del comercio actual
  comerciosList: [],         // Lista de comercios disponibles
  warehouses: [],            // Lista de bodegas disponibles
  loading: false
};

/**
 * Normaliza nombres de bodega para comparaciones flexibles (elimina tildes, mayúsculas y prefijos)
 */
function normalizeBodegaName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^(cdd|bodega|sucursal|matriz)\s+/i, '')
    .trim();
}

/**
 * Busca si un nombre de bodega coincide con alguna de las bodegas del WMS
 */
function findMatchingWarehouse(inputName, warehousesList) {
  if (!inputName) return null;
  const normInput = normalizeBodegaName(inputName);
  
  // 1. Coincidencia exacta o normalizada
  const exact = warehousesList.find(w => normalizeBodegaName(w.name) === normInput || w.name.trim().toLowerCase() === inputName.trim().toLowerCase());
  if (exact) return exact;

  // 2. Coincidencia por palabra clave común
  const keywords = ['nunoa', 'la reina', 'recoleta', 'central', 'pudahuel', 'san bernardo', 'vitacura'];
  for (const kw of keywords) {
    if (normInput.includes(kw)) {
      const match = warehousesList.find(w => normalizeBodegaName(w.name).includes(kw));
      if (match) return match;
    }
  }

  // 3. Coincidencia parcial
  return warehousesList.find(w => {
    const nw = normalizeBodegaName(w.name);
    return nw.includes(normInput) || normInput.includes(nw);
  }) || null;
}

/**
 * Carga la lista de comercios desde v_comercios_config con múltiples capas de respaldo
 */
async function loadComerciosList() {
  if (window.cachedComercios && Array.isArray(window.cachedComercios) && window.cachedComercios.length > 0) {
    window.locationsState.comerciosList = window.cachedComercios;
    return window.cachedComercios;
  }

  const supa = getLocationsClient();
  if (supa && typeof supa.from === 'function') {
    try {
      const { data, error } = await supa.from('v_comercios_config').select('id, nombre, sigla').order('nombre');
      if (!error && data && data.length > 0) {
        window.cachedComercios = data;
        window.locationsState.comerciosList = data;
        return data;
      }
    } catch (err) {
      console.warn('Error cargando v_comercios_config desde WMS:', err);
    }
  }

  // Fallback 1: Si hay comercios en catálogo o memoria
  if (supa && typeof supa.from === 'function') {
    try {
      const { data: pComercios } = await supa.from('products').select('comercio').limit(2000);
      if (pComercios && pComercios.length > 0) {
        const unique = Array.from(new Set(pComercios.map(p => p.comercio).filter(Boolean))).map(nombre => ({
          id: nombre,
          nombre: nombre,
          sigla: nombre.slice(0, 3).toUpperCase()
        }));
        if (unique.length > 0) {
          window.locationsState.comerciosList = unique;
          return unique;
        }
      }
    } catch (_) {}
  }

  // Fallback 2: Lista base de comercios activos de Stocka
  const defaultComercios = [
    { nombre: 'MAGIC MAKEUP', sigla: 'MAG' },
    { nombre: 'BACK IN TIME', sigla: 'BIT' },
    { nombre: 'BE NATIVE', sigla: 'BNA' },
    { nombre: 'ALLTOKE', sigla: 'ALL' },
    { nombre: 'ANLUSTORE', sigla: 'ANL' },
    { nombre: 'AQUALAT', sigla: 'AQU' },
    { nombre: 'ASIA CLICK', sigla: 'ASC' },
    { nombre: 'ASTERFAIRO', sigla: 'AST' },
    { nombre: 'B4LIFE', sigla: 'B4L' },
    { nombre: 'BLESSNUSS', sigla: 'BLE' },
    { nombre: 'RELAJARTE', sigla: 'REL' }
  ];
  window.locationsState.comerciosList = defaultComercios;
  return defaultComercios;
}

/**
 * Carga las bodegas registradas
 */
async function loadWarehouses() {
  if (window.allWarehousesList && Array.isArray(window.allWarehousesList) && window.allWarehousesList.length > 0) {
    window.locationsState.warehouses = window.allWarehousesList;
    return window.allWarehousesList;
  }
  const supa = getLocationsClient();
  if (supa && typeof supa.from === 'function') {
    try {
      const { data, error } = await supa.from('warehouses').select('*').order('name');
      if (!error && data && data.length > 0) {
        window.locationsState.warehouses = data;
        window.allWarehousesList = data;
        return data;
      }
    } catch (err) {
      console.warn('Error cargando warehouses desde WMS:', err);
    }
  }

  // Bodegas oficiales de Stocka WMS como fallback seguro
  const defaultWarehouses = [
    { id: '414605cb-f926-43d2-8bd2-d9509f7b458a', name: 'CDD La Reina', comuna: 'La Reina', address: 'Fernando Castillo Velasco 8146' },
    { id: '973da888-8a63-4790-a08f-919e1af41a93', name: 'Matriz Ñuñoa', comuna: 'Ñuñoa', address: 'Campo de Deportes 405' },
    { id: '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a', name: 'CDD Recoleta', comuna: 'Recoleta', address: 'Avenida Venezuela 0952' },
    { id: 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09', name: 'Bodega Central', comuna: 'Santiago', address: 'Santiago, RM' }
  ];
  window.locationsState.warehouses = defaultWarehouses;
  return defaultWarehouses;
}

/**
 * Carga el catálogo de productos de un comercio
 */
async function loadProductsCatalog(commerce = '') {
  if (!commerce) return [];
  const supa = getLocationsClient();
  const selectFields = 'id, sku, name, comercio, barcode, barcode_wms, image_url, status';

  if (typeof window.fetchAllSupabaseRows === 'function') {
    try {
      const data = await window.fetchAllSupabaseRows('products', selectFields, q => q.eq('comercio', commerce).order('name'));
      if (data && data.length > 0) {
        window.locationsState.productsCatalog = data;
        return data;
      }
    } catch (e) {
      console.warn('fetchAllSupabaseRows error en catalog:', e);
    }
  }

  if (supa && typeof supa.from === 'function') {
    try {
      let query = supa.from('products').select(selectFields).order('name');
      if (commerce) {
        query = query.eq('comercio', commerce);
      }
      const { data, error } = await query.limit(5000);
      if (!error && data) {
        window.locationsState.productsCatalog = data;
        return data;
      }
    } catch (e) {
      console.warn('Error cargando catálogo con supa:', e);
    }
  }

  // Fallback con caché de productos maestros en memoria
  if (window.currentMasterProducts && Array.isArray(window.currentMasterProducts)) {
    const filtered = window.currentMasterProducts.filter(p => (p.comercio || '').trim().toUpperCase() === commerce.trim().toUpperCase());
    if (filtered.length > 0) {
      window.locationsState.productsCatalog = filtered;
      return filtered;
    }
  }

  return window.locationsState.productsCatalog || [];
}

/**
 * Carga las ubicaciones físicas desde la base de datos (con sincronización transparente WMS/Picker)
 */
async function loadProductLocations(filters = {}) {
  const supa = getLocationsClient();
  const pickerClient = getPickerClient();
  let locationsData = null;

  // Intento 1: Consultar WMS si la tabla existe
  if (supa && typeof supa.from === 'function') {
    try {
      let query = supa.from('product_locations').select('*');
      if (filters.comercio) query = query.eq('comercio', filters.comercio);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        locationsData = data;
      }
    } catch (err) {
      console.warn('WMS product_locations no disponible aún:', err);
    }
  }

  // Intento 2: Consultar Picker Supabase solo si WMS falló (error de conexión o tabla no creada)
  if (pickerClient && locationsData === null) {
    try {
      let pQuery = pickerClient.from('product_locations').select('*');
      if (filters.comercio) pQuery = pQuery.eq('comercio', filters.comercio);
      const { data, error } = await pQuery.order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        locationsData = data;
      }
    } catch (pErr) {
      console.warn('Picker product_locations query error:', pErr);
    }
  }

  window.locationsState.locations = locationsData || [];
  return window.locationsState.locations;
}

/**
 * Guarda o actualiza una ubicación física en ambas bases de datos
 */
async function saveProductLocation(payload) {
  const supa = getLocationsClient();
  const pickerClient = getPickerClient();
  const results = { wms: false, picker: false };

  // Guardar en WMS
  if (supa && typeof supa.from === 'function') {
    try {
      const { error: wmsErr } = await supa.from('product_locations').upsert([payload]);
      if (!wmsErr) results.wms = true;
    } catch (e) {
      console.warn('No se pudo guardar en WMS product_locations:', e);
    }
  }

  // Guardar en Picker Supabase
  if (pickerClient) {
    try {
      const { error: pErr } = await pickerClient.from('product_locations').upsert([payload]);
      if (!pErr) results.picker = true;
    } catch (pe) {
      console.warn('No se pudo guardar en Picker product_locations:', pe);
    }
  }

  return results.wms || results.picker;
}

/**
 * Elimina una ubicación física
 */
async function deleteProductLocation(locationId) {
  const supa = getLocationsClient();
  const pickerClient = getPickerClient();

  if (supa && typeof supa.from === 'function') {
    try {
      await supa.from('product_locations').delete().eq('id', locationId);
    } catch (_) {}
  }

  if (pickerClient) {
    try {
      await pickerClient.from('product_locations').delete().eq('id', locationId);
    } catch (_) {}
  }
  return true;
}

/**
 * Actualiza el estado de 0 stock de una ubicación física
 */
async function updateLocationZeroStock(locationId, isZero) {
  const supa = getLocationsClient();
  const pickerClient = getPickerClient();
  const payload = {
    is_zero_stock: isZero,
    stock: isZero ? 0 : 1,
    updated_at: new Date().toISOString()
  };

  if (supa && typeof supa.from === 'function') {
    try {
      await supa.from('product_locations').update(payload).eq('id', locationId);
    } catch (_) {}
  }

  if (pickerClient) {
    try {
      await pickerClient.from('product_locations').update(payload).eq('id', locationId);
    } catch (_) {}
  }
  return true;
}

// =========================================================================
// RENDERIZADO PRINCIPAL DE LA PESTAÑA "UBICACIONES" EN EL MÓDULO DE INVENTARIO
// =========================================================================

window.renderAdminLocationsTab = async function(container) {
  if (!container) container = document.getElementById('admin-inv-tab-content');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 3rem; color: var(--color-text-muted);">
      <i class="ri-loader-4-line ri-spin" style="font-size: 2.2rem; color: var(--color-primary); display: block; margin-bottom: 0.75rem;"></i>
      <div style="font-weight: 700; font-size: 1.05rem; color: var(--color-text-main);">Cargando Sistema de Ubicaciones Físicas...</div>
      <div style="font-size: 0.85rem; margin-top: 0.35rem;">Sincronizando catálogo por comercio, bodegas y posiciones activas</div>
    </div>
  `;

  // 1. Cargar Comercios y Bodegas
  const [comercios, warehouses] = await Promise.all([
    loadComerciosList(),
    loadWarehouses()
  ]);

  // 2. Determinar Comercio Activo Inicial
  let activeCommerce = window.locationsState.activeCommerce || window.activeAdminInventoryCommerce || '';
  if (!activeCommerce && comercios && comercios.length > 0) {
    const magic = comercios.find(c => c.nombre && c.nombre.trim().toUpperCase() === 'MAGIC MAKEUP');
    activeCommerce = magic ? magic.nombre : comercios[0].nombre;
  }
  window.locationsState.activeCommerce = activeCommerce;
  window.activeAdminInventoryCommerce = activeCommerce;

  // 3. Determinar Bodega Activa Inicial
  let activeBodega = window.locationsState.activeBodega;
  if (!activeBodega && warehouses && warehouses.length > 0) {
    activeBodega = warehouses[0].name;
  }
  window.locationsState.activeBodega = activeBodega;

  // 4. Cargar Catálogo del Comercio y sus Ubicaciones
  await Promise.all([
    loadProductsCatalog(activeCommerce),
    loadProductLocations({ comercio: activeCommerce })
  ]);

  renderLocationsWorkspace(container);
};

/**
 * Obtiene y valida todos los cambios realizados en el modo de Edición Rápida (planilla)
 */
function getQuickEditChanges() {
  const container = document.getElementById('admin-inv-tab-content');
  if (!container) return { changes: [], errors: [] };

  const rows = container.querySelectorAll('tr[data-quick-row="true"]');
  const changes = [];
  const errors = [];

  const { activeBodega, activeCommerce, warehouses, productsCatalog } = window.locationsState;
  const wh = warehouses.find(w => normalizeBodegaName(w.name) === normalizeBodegaName(activeBodega));

  rows.forEach(row => {
    const sku = row.getAttribute('data-sku');
    const zonaInput = row.querySelector('.quick-loc-zona');
    const espacioInput = row.querySelector('.quick-loc-espacio');
    const posicionInput = row.querySelector('.quick-loc-posicion');
    const zeroInput = row.querySelector('.quick-loc-zero');

    if (!zonaInput || !espacioInput) return;

    const locId = zonaInput.getAttribute('data-loc-id') || null;
    const oldZona = (zonaInput.getAttribute('data-old') || '').trim();
    const oldEspacio = (espacioInput.getAttribute('data-old') || '').trim();
    const oldPosicion = (posicionInput ? posicionInput.getAttribute('data-old') || '' : '').trim();
    const oldZero = zeroInput ? zeroInput.getAttribute('data-old') === 'true' : false;

    const newZona = zonaInput.value.trim();
    const newEspacio = espacioInput.value.trim();
    const newPosicion = posicionInput ? posicionInput.value.trim() : '';
    const newZero = zeroInput ? zeroInput.checked : false;

    const isChanged = (
      newZona !== oldZona ||
      newEspacio !== oldEspacio ||
      newPosicion !== oldPosicion ||
      newZero !== oldZero
    );

    if (isChanged) {
      // Caso 1: Existía y se borraron tanto Zona como Espacio -> Eliminar ubicación física
      if (locId && !newZona && !newEspacio) {
        changes.push({
          type: 'DELETE',
          locId,
          sku
        });
        return;
      }

      // Caso 2: Uno de los dos campos obligatorios quedó vacío -> Error de validación
      if ((newZona && !newEspacio) || (!newZona && newEspacio)) {
        errors.push({
          sku,
          element: !newZona ? zonaInput : espacioInput,
          msg: `El producto ${sku} debe tener tanto Zona como Espacio definidos para poder guardar.`
        });
        return;
      }

      // Caso 3: Ambos vacíos y no existía locId previo -> Omitir
      if (!locId && !newZona && !newEspacio) {
        return;
      }

      // Caso 4: Se asigna o actualiza la ubicación física
      const prod = productsCatalog.find(p => p.sku?.trim().toUpperCase() === sku.trim().toUpperCase());
      changes.push({
        type: locId ? 'UPDATE' : 'INSERT',
        locId,
        sku,
        payload: {
          ...(locId ? { id: locId } : {}),
          product_id: prod?.id || null,
          sku: sku,
          comercio: prod?.comercio || activeCommerce || null,
          warehouse_id: wh?.id || null,
          bodega_nombre: activeBodega,
          zona: newZona,
          espacio: newEspacio,
          posicion: newPosicion,
          stock: newZero ? 0 : 1,
          is_zero_stock: newZero,
          updated_at: new Date().toISOString()
        }
      });
    }
  });

  return { changes, errors };
}

/**
 * Resalta en vivo las celdas y filas modificadas en el modo planilla y actualiza el contador
 */
function updateRowHighlight(row) {
  const zonaInput = row.querySelector('.quick-loc-zona');
  const espacioInput = row.querySelector('.quick-loc-espacio');
  const posicionInput = row.querySelector('.quick-loc-posicion');
  const zeroInput = row.querySelector('.quick-loc-zero');
  const statusCol = row.querySelector('.quick-loc-status-col');

  if (!zonaInput || !espacioInput) return;

  const oldZona = (zonaInput.getAttribute('data-old') || '').trim();
  const oldEspacio = (espacioInput.getAttribute('data-old') || '').trim();
  const oldPosicion = (posicionInput ? posicionInput.getAttribute('data-old') || '' : '').trim();
  const oldZero = zeroInput ? zeroInput.getAttribute('data-old') === 'true' : false;

  const isChanged = (
    zonaInput.value.trim() !== oldZona ||
    espacioInput.value.trim() !== oldEspacio ||
    (posicionInput ? posicionInput.value.trim() !== oldPosicion : false) ||
    (zeroInput ? zeroInput.checked !== oldZero : false)
  );

  if (isChanged) {
    row.style.background = 'rgba(99, 102, 241, 0.05)';
    [zonaInput, espacioInput, posicionInput].filter(Boolean).forEach(inp => {
      const isFieldChanged = inp.value.trim() !== (inp.getAttribute('data-old') || '').trim();
      inp.style.borderColor = isFieldChanged ? '#6366f1' : 'var(--color-border)';
      inp.style.background = isFieldChanged ? '#f5f3ff' : 'var(--color-surface)';
    });
    if (statusCol) {
      statusCol.innerHTML = `
        <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #4338ca; border: 1px solid rgba(99, 102, 241, 0.3); font-size: 0.72rem; padding: 0.2rem 0.45rem; border-radius: 4px; font-weight: 700;">
          <i class="ri-edit-line"></i> Modificado
        </span>
      `;
    }
  } else {
    row.style.background = '';
    [zonaInput, espacioInput, posicionInput].filter(Boolean).forEach(inp => {
      inp.style.borderColor = 'var(--color-border)';
      inp.style.background = 'var(--color-surface)';
    });
    if (statusCol) {
      const hasOldLoc = Boolean(zonaInput.getAttribute('data-loc-id'));
      statusCol.innerHTML = hasOldLoc ? `
        <span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 0.72rem; padding: 0.2rem 0.45rem; border-radius: 4px;">
          Asignada
        </span>
      ` : `
        <span class="badge" style="background: rgba(245, 158, 11, 0.1); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.25); font-size: 0.72rem; padding: 0.2rem 0.45rem; border-radius: 4px;">
          Sin asignar
        </span>
      `;
    }
  }

  // Actualizar contador visual en el banner
  const { changes } = getQuickEditChanges();
  const counterEl = document.getElementById('quick-edit-counter-badge');
  if (counterEl) {
    const count = changes.length;
    counterEl.innerText = `${count} cambio${count === 1 ? '' : 's'} detectado${count === 1 ? '' : 's'}`;
    counterEl.style.background = count > 0 ? '#6366f1' : 'rgba(99, 102, 241, 0.15)';
    counterEl.style.color = count > 0 ? '#fff' : '#4338ca';
  }
}

function renderLocationsWorkspace(container) {
  if (!container) container = document.getElementById('admin-inv-tab-content');
  if (!container) return;

  const { warehouses, locations, productsCatalog, comerciosList, activeCommerce, activeBodega, searchFilter, statusFilter, quickEditMode } = window.locationsState;

  // Construir lista unificada del catálogo con sus ubicaciones en la bodega activa y en otras bodegas
  const catalogSkus = new Set();
  const allItems = [];

  // 1. Mapear productos del catálogo del comercio
  productsCatalog.forEach(prod => {
    const sku = (prod.sku || '').trim().toUpperCase();
    if (sku) catalogSkus.add(sku);

    // Ubicaciones de este SKU
    const allProdLocs = locations.filter(l => l.sku && l.sku.trim().toUpperCase() === sku);
    
    // Ubicaciones en la bodega seleccionada para trabajar
    const bodegaLocs = allProdLocs.filter(l => {
      if (!activeBodega || activeBodega === 'ALL') return true;
      return normalizeBodegaName(l.bodega_nombre) === normalizeBodegaName(activeBodega);
    });

    // Ubicaciones en otras bodegas
    const otherLocs = allProdLocs.filter(l => {
      if (!activeBodega || activeBodega === 'ALL') return false;
      return normalizeBodegaName(l.bodega_nombre) !== normalizeBodegaName(activeBodega);
    });

    allItems.push({
      id: prod.id,
      sku: prod.sku,
      name: prod.name || 'Producto WMS',
      comercio: prod.comercio || activeCommerce,
      barcode: prod.barcode,
      barcode_wms: prod.barcode_wms,
      image_url: prod.image_url,
      status: prod.status,
      allLocations: allProdLocs,
      bodegaLocations: bodegaLocs,
      otherLocations: otherLocs,
      hasBodegaLocation: bodegaLocs.length > 0,
      isCatalog: true
    });
  });

  // 2. Incluir ubicaciones huérfanas (SKUs que tienen ubicación pero no están en el catálogo descargado)
  const orphanLocs = locations.filter(l => {
    if (!l.sku) return false;
    const s = l.sku.trim().toUpperCase();
    if (catalogSkus.has(s)) return false;
    // Si este SKU pertenece comprobadamente a otro comercio, no mostrarlo en este comercio
    if (window.currentMasterProducts && Array.isArray(window.currentMasterProducts)) {
      const known = window.currentMasterProducts.find(p => (p.sku || '').trim().toUpperCase() === s);
      if (known && known.comercio && normalizeCommerceName(known.comercio) !== normalizeCommerceName(activeCommerce)) {
        return false;
      }
    }
    return true;
  });
  const orphanBySku = {};
  orphanLocs.forEach(ol => {
    const s = ol.sku.trim().toUpperCase();
    if (!orphanBySku[s]) orphanBySku[s] = [];
    orphanBySku[s].push(ol);
  });

  Object.keys(orphanBySku).forEach(skuKey => {
    const allOrphanLocs = orphanBySku[skuKey];
    const bodegaLocs = allOrphanLocs.filter(l => {
      if (!activeBodega || activeBodega === 'ALL') return true;
      return normalizeBodegaName(l.bodega_nombre) === normalizeBodegaName(activeBodega);
    });
    const otherLocs = allOrphanLocs.filter(l => {
      if (!activeBodega || activeBodega === 'ALL') return false;
      return normalizeBodegaName(l.bodega_nombre) !== normalizeBodegaName(activeBodega);
    });

    allItems.push({
      id: allOrphanLocs[0].product_id || null,
      sku: skuKey,
      name: 'Producto sin catalogar en WMS',
      comercio: allOrphanLocs[0].comercio || activeCommerce,
      barcode: null,
      barcode_wms: null,
      image_url: null,
      status: 'active',
      allLocations: allOrphanLocs,
      bodegaLocations: bodegaLocs,
      otherLocations: otherLocs,
      hasBodegaLocation: bodegaLocs.length > 0,
      isCatalog: false
    });
  });

  // Métricas sobre el catálogo en la bodega seleccionada
  const totalCatalogCount = allItems.length;
  const withLocationCount = allItems.filter(i => i.hasBodegaLocation).length;
  const withoutLocationCount = allItems.filter(i => !i.hasBodegaLocation).length;
  const zeroStockCount = allItems.filter(i => i.bodegaLocations.some(l => l.is_zero_stock)).length;

  // Filtrado reactivo de items a mostrar
  const filteredItems = allItems.filter(item => {
    // Filtro por Estado (Tabs / Chips)
    if (statusFilter === 'WITH_LOCATION' && !item.hasBodegaLocation) return false;
    if (statusFilter === 'WITHOUT_LOCATION' && item.hasBodegaLocation) return false;
    if (statusFilter === 'ZERO' && (!item.hasBodegaLocation || !item.bodegaLocations.some(l => l.is_zero_stock))) return false;

    // Filtro por Búsqueda de texto
    if (searchFilter) {
      const q = searchFilter.toLowerCase().trim();
      const sku = (item.sku || '').toLowerCase();
      const name = (item.name || '').toLowerCase();
      const bc = (item.barcode || '').toLowerCase();
      const bcwms = (item.barcode_wms || '').toLowerCase();
      const matchInLocations = item.allLocations.some(loc => {
        const zona = (loc.zona || '').toLowerCase();
        const espacio = (loc.espacio || '').toLowerCase();
        const pos = (loc.posicion || '').toLowerCase();
        const bname = (loc.bodega_nombre || '').toLowerCase();
        return zona.includes(q) || espacio.includes(q) || pos.includes(q) || bname.includes(q);
      });

      if (!sku.includes(q) && !name.includes(q) && !bc.includes(q) && !bcwms.includes(q) && !matchInLocations) {
        return false;
      }
    }

    return true;
  });

  // Extraer listas únicas de zonas, espacios y posiciones existentes en el sistema para autocompletado en Quick Edit
  const existingZonas = [...new Set(locations.map(l => (l.zona || '').trim()).filter(Boolean))];
  const existingEspacios = [...new Set(locations.map(l => (l.espacio || '').trim()).filter(Boolean))];
  const existingPosiciones = [...new Set(locations.map(l => (l.posicion || '').trim()).filter(Boolean))];

  const defaultZonas = ['Salón', 'Subterráneo', 'Altillo', 'Bodega Alta', 'Zona Recepción', 'Zona Despacho'];
  const defaultEspacios = ['Estante 1', 'Estante 2', 'Estante 3', 'Estante 4', 'Mesón 1', 'Mesón 2', 'Rack A', 'Rack B', 'Rack C', 'Mueble Principal'];
  const defaultPosiciones = ['Nivel 1', 'Nivel 2', 'Nivel 3', 'Nivel 4', 'Bandeja 1', 'Bandeja 2', 'Suelo', 'Casilla 1', 'Casilla 2'];

  const allZonas = [...new Set([...defaultZonas, ...existingZonas])];
  const allEspacios = [...new Set([...defaultEspacios, ...existingEspacios])];
  const allPosiciones = [...new Set([...defaultPosiciones, ...existingPosiciones])];

  container.innerHTML = `
    <div class="locations-module-container" style="display: flex; flex-direction: column; gap: 1.25rem;">
      
      <!-- BARRA SUPERIOR DE ACCIONES Y SELECTORES DE TRABAJO -->
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; box-shadow: var(--shadow-sm);">
        
        <!-- CABECERA: TÍTULO Y BOTONES GLOBALES -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-map-pin-2-fill" style="color: #6366f1;"></i>
              Ubicaciones Físicas de Productos
              <span class="badge" style="background: rgba(99, 102, 241, 0.1); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.25); font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 9999px;">
                WMS ➔ Picker
              </span>
            </h3>
            <p style="margin: 0.35rem 0 0 0; font-size: 0.82rem; color: var(--color-text-muted);">
              Asigna y gestiona la posición física de cada producto (Bodega ➔ Zona ➔ Espacio ➔ Posición). La información se transmite en tiempo real a los operarios en el Picker.
            </p>
          </div>

          <!-- BOTONES DE ACCIÓN PRINCIPALES -->
          <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
            ${!quickEditMode ? `
              <button id="btn-loc-toggle-quick-edit" class="btn btn-outline" style="height: 38px; font-size: 0.85rem; font-weight: 600; border-color: #6366f1; color: #6366f1; background: rgba(99, 102, 241, 0.08); display: inline-flex; align-items: center; gap: 0.35rem;" title="Activar modo planilla para editar ubicaciones directamente en la tabla">
                <i class="ri-edit-box-line"></i> Edición Rápida
              </button>
              <button id="btn-loc-download-template" class="btn btn-outline" style="height: 38px; font-size: 0.85rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.35rem; border-color: var(--color-border); color: var(--color-text-main);" title="Descargar plantilla Excel para rellenar">
                <i class="ri-file-excel-2-line" style="color: #10b981;"></i> Descargar Plantilla
              </button>
              <button id="btn-loc-bulk-upload" class="btn btn-primary" style="height: 38px; font-size: 0.85rem; font-weight: 600; background: #6366f1; border-color: #6366f1; display: inline-flex; align-items: center; gap: 0.4rem; box-shadow: 0 2px 4px rgba(99, 102, 241, 0.25);" title="Cargar masivamente ubicaciones vía Excel o CSV">
                <i class="ri-file-upload-line"></i> Carga Masiva (Planilla)
              </button>
              <button id="btn-loc-add-single" class="btn btn-outline" style="height: 38px; font-size: 0.85rem; font-weight: 600; border-color: #6366f1; color: #6366f1; background: rgba(99, 102, 241, 0.06); display: inline-flex; align-items: center; gap: 0.35rem;" title="Asignar una ubicación física a un producto de forma individual">
                <i class="ri-add-line"></i> Asignar Manual
              </button>
            ` : `
              <button id="btn-loc-save-quick-edit" class="btn btn-success" style="height: 38px; font-size: 0.85rem; font-weight: 700; background: #10b981; border-color: #10b981; color: white; display: inline-flex; align-items: center; gap: 0.4rem; box-shadow: 0 2px 5px rgba(16, 185, 129, 0.35);" title="Guardar todos los cambios realizados en la planilla">
                <i class="ri-save-line"></i> Guardar Cambios Rápidos
              </button>
              <button id="btn-loc-cancel-quick-edit" class="btn btn-outline" style="height: 38px; font-size: 0.85rem; font-weight: 600; border-color: var(--color-border); color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.35rem;" title="Salir del modo edición sin guardar">
                <i class="ri-close-line"></i> Cancelar
              </button>
            `}
            <button id="btn-loc-refresh" class="btn btn-outline" style="height: 38px; font-size: 0.85rem; border-color: var(--color-border); color: var(--color-text-main); display: inline-flex; align-items: center; gap: 0.3rem;" title="Actualizar datos">
              <i class="ri-refresh-line" id="icon-loc-refresh"></i>
            </button>
          </div>
        </div>

        <!-- SELECTORES DE ENTORNO DE TRABAJO (COMERCIO Y BODEGA DE TRABAJO) -->
        <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.1rem 1.25rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 1.25rem; align-items: start;">
          
          <!-- SELECTOR 1: COMERCIO (CLIENTE) -->
          <div>
            <label style="font-size: 0.82rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.45rem;">
              <i class="ri-store-2-line" style="color: #6366f1; font-size: 1.05rem;"></i>
              1. Comercio (Cliente):
            </label>
            <div id="loc-commerce-dropdown-container" style="width: 100%;"></div>
          </div>

          <!-- SELECTOR 2: BODEGA DONDE TRABAJAR -->
          <div>
            <label style="font-size: 0.82rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.45rem;">
              <i class="ri-building-line" style="color: #2563eb; font-size: 1.05rem;"></i>
              2. Bodega donde trabajar:
              <span class="badge" style="background: rgba(37, 99, 235, 0.1); color: #2563eb; font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 700;">Área Activa</span>
            </label>
            <select id="loc-select-bodega" style="width: 100%; height: 42px; padding: 0 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); font-size: 0.9rem; font-weight: 600; box-shadow: var(--shadow-sm); cursor: pointer;">
              ${warehouses.map(w => `
                <option value="${escapeHtml(w.name)}" ${normalizeBodegaName(w.name) === normalizeBodegaName(activeBodega) ? 'selected' : ''}>
                  🏢 ${escapeHtml(w.name)} ${w.comuna ? `(${escapeHtml(w.comuna)})` : ''}
                </option>
              `).join('')}
              <option value="ALL" ${activeBodega === 'ALL' ? 'selected' : ''}>🌐 Todas las Bodegas (Vista Consolidada)</option>
            </select>
          </div>

        </div>

      </div>

      <!-- CHIPS DE MÉTRICAS -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem;">
        
        <!-- Total Catálogo -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 1rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(99, 102, 241, 0.12); color: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
            <i class="ri-box-3-line"></i>
          </div>
          <div>
            <div style="font-size: 1.3rem; font-weight: 700; color: var(--color-text-main);">${totalCatalogCount}</div>
            <div style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 500;">Productos en Catálogo</div>
          </div>
        </div>

        <!-- Con Ubicación en esta Bodega -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 1rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(16, 185, 129, 0.12); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
            <i class="ri-checkbox-circle-line"></i>
          </div>
          <div>
            <div style="font-size: 1.3rem; font-weight: 700; color: #10b981;">${withLocationCount}</div>
            <div style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 500;">Con Ubicación en ${escapeHtml(activeBodega === 'ALL' ? 'WMS' : activeBodega)}</div>
          </div>
        </div>

        <!-- Sin Ubicación en esta Bodega -->
        <div style="background: var(--color-surface); border: 1px solid ${withoutLocationCount > 0 ? '#fde68a' : 'var(--color-border)'}; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 1rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: ${withoutLocationCount > 0 ? 'rgba(245, 158, 11, 0.14)' : 'rgba(156, 163, 175, 0.1)'}; color: ${withoutLocationCount > 0 ? '#d97706' : 'var(--color-text-muted)'}; display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
            <i class="ri-alert-line"></i>
          </div>
          <div>
            <div style="font-size: 1.3rem; font-weight: 700; color: ${withoutLocationCount > 0 ? '#d97706' : 'var(--color-text-main)'};">${withoutLocationCount}</div>
            <div style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 500;">Sin Ubicación en esta Bodega</div>
          </div>
        </div>

        <!-- Marcadas 0 Stock -->
        <div style="background: var(--color-surface); border: 1px solid ${zeroStockCount > 0 ? '#fca5a5' : 'var(--color-border)'}; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 1rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: ${zeroStockCount > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(156, 163, 175, 0.1)'}; color: ${zeroStockCount > 0 ? '#ef4444' : 'var(--color-text-muted)'}; display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
            <i class="ri-forbid-line"></i>
          </div>
          <div>
            <div style="font-size: 1.3rem; font-weight: 700; color: ${zeroStockCount > 0 ? '#ef4444' : 'var(--color-text-main)'};">${zeroStockCount}</div>
            <div style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 500;">Marcadas con 0 Stock</div>
          </div>
        </div>

      </div>

      <!-- BARRA DE FILTROS RÁPIDOS Y BÚSQUEDA -->
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1rem 1.25rem; display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
        
        <!-- PESTAÑAS / BOTONES DE FILTRADO RÁPIDO -->
        <div style="display: flex; gap: 0.45rem; flex-wrap: wrap; align-items: center;">
          <button class="loc-filter-chip btn ${statusFilter === 'ALL' ? 'btn-primary' : 'btn-outline'}" data-status="ALL" style="height: 36px; font-size: 0.82rem; font-weight: 600; padding: 0 0.85rem; border-radius: var(--radius-md);">
            Todos (${totalCatalogCount})
          </button>
          
          <button class="loc-filter-chip btn ${statusFilter === 'WITH_LOCATION' ? 'btn-primary' : 'btn-outline'}" data-status="WITH_LOCATION" style="height: 36px; font-size: 0.82rem; font-weight: 600; padding: 0 0.85rem; border-radius: var(--radius-md); ${statusFilter !== 'WITH_LOCATION' ? 'color: #059669; border-color: rgba(16, 185, 129, 0.3);' : 'background: #10b981; border-color: #10b981;'}">
            <i class="ri-checkbox-circle-line"></i> Con Ubicación (${withLocationCount})
          </button>

          <button class="loc-filter-chip btn ${statusFilter === 'WITHOUT_LOCATION' ? 'btn-primary' : 'btn-outline'}" data-status="WITHOUT_LOCATION" style="height: 36px; font-size: 0.82rem; font-weight: 600; padding: 0 0.85rem; border-radius: var(--radius-md); ${statusFilter !== 'WITHOUT_LOCATION' ? 'color: #d97706; border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.05);' : 'background: #f59e0b; border-color: #f59e0b;'}">
            <i class="ri-alert-line"></i> Sin Ubicación en Bodega (${withoutLocationCount})
          </button>

          <button class="loc-filter-chip btn ${statusFilter === 'ZERO' ? 'btn-primary' : 'btn-outline'}" data-status="ZERO" style="height: 36px; font-size: 0.82rem; font-weight: 600; padding: 0 0.85rem; border-radius: var(--radius-md); ${statusFilter !== 'ZERO' ? 'color: #ef4444; border-color: rgba(239, 68, 68, 0.3);' : 'background: #ef4444; border-color: #ef4444;'}">
            <i class="ri-forbid-line"></i> 0 Stock (${zeroStockCount})
          </button>
        </div>

        <!-- BUSCADOR EN TIEMPO REAL -->
        <div style="flex: 1; min-width: 260px; max-width: 480px; position: relative;">
          <i class="ri-search-line" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
          <input type="text" id="loc-filter-search" value="${escapeHtml(searchFilter)}" placeholder="Buscar por SKU, producto, zona, estante o código..." style="width: 100%; height: 36px; padding-left: 36px; padding-right: 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); font-size: 0.85rem;">
          ${searchFilter ? `
            <button id="loc-clear-search-btn" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 2px;"><i class="ri-close-line"></i></button>
          ` : ''}
        </div>

      </div>

      ${quickEditMode ? `
        <!-- BANNER INFORMATIVO DE MODO EDICIÓN RÁPIDA -->
        <div style="background: linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(16, 185, 129, 0.08) 100%); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: var(--radius-md); padding: 0.75rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 0.6rem; color: #3730a3; font-size: 0.85rem;">
            <i class="ri-edit-box-line" style="font-size: 1.25rem; color: #6366f1;"></i>
            <div>
              <strong>Modo Edición Rápida (Planilla) Activo en: </strong>
              <span class="badge" style="background: rgba(37, 99, 235, 0.1); color: #1d4ed8; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px;">🏢 ${escapeHtml(activeBodega)}</span>
              <span style="color: var(--color-text-muted); margin-left: 0.35rem;">Escribe o modifica directamente los campos. Usa <kbd style="background: var(--color-surface); padding: 2px 5px; border-radius: 4px; border: 1px solid var(--color-border); font-family: monospace;">Tab</kbd> o <kbd style="background: var(--color-surface); padding: 2px 5px; border-radius: 4px; border: 1px solid var(--color-border); font-family: monospace;">Enter</kbd> para navegar como en Excel.</span>
            </div>
          </div>
          <div id="quick-edit-counter-badge" class="badge" style="background: rgba(99, 102, 241, 0.15); color: #4338ca; font-size: 0.8rem; font-weight: 700; padding: 0.3rem 0.65rem; border-radius: 9999px;">
            0 cambios detectados
          </div>
        </div>
      ` : ''}

      <!-- TABLA DEL CATÁLOGO Y UBICACIONES EN LA BODEGA ACTIVA -->
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm);">
        <table id="locations-table-main" class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
          <thead>
            ${!quickEditMode ? `
              <tr style="background: var(--color-bg); border-bottom: 2px solid var(--color-border); text-align: left; color: var(--color-text-muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.05em;">
                <th style="padding: 0.85rem 1rem;">SKU</th>
                <th style="padding: 0.85rem 1rem;">Producto</th>
                <th style="padding: 0.85rem 1rem;">Bodega de Trabajo</th>
                <th style="padding: 0.85rem 1rem;">Ubicación Física en esta Bodega</th>
                <th style="padding: 0.85rem 1rem; text-align: center;">Estado Picker</th>
                <th style="padding: 0.85rem 1rem; text-align: right;">Acciones</th>
              </tr>
            ` : `
              <tr style="background: var(--color-bg); border-bottom: 2px solid var(--color-border); text-align: left; color: var(--color-text-muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.05em;">
                <th style="padding: 0.75rem 0.85rem; width: 130px;">SKU</th>
                <th style="padding: 0.75rem 0.85rem; min-width: 190px;">Producto</th>
                <th style="padding: 0.75rem 0.85rem; width: 110px;">Bodega</th>
                <th style="padding: 0.75rem 0.85rem; width: 160px;">2. Zona <span style="color:#ef4444;">*</span></th>
                <th style="padding: 0.75rem 0.85rem; width: 160px;">3. Espacio <span style="color:#ef4444;">*</span></th>
                <th style="padding: 0.75rem 0.85rem; width: 150px;">4. Posición <small style="font-weight:normal; text-transform:none;">(opcional)</small></th>
                <th style="padding: 0.75rem 0.85rem; text-align: center; width: 85px;">0 Stock</th>
                <th style="padding: 0.75rem 0.85rem; text-align: center; width: 110px;">Estado</th>
              </tr>
            `}
          </thead>
          <tbody>
            ${filteredItems.length === 0 ? `
              <tr>
                <td colspan="${quickEditMode ? 8 : 6}" style="padding: 3.5rem 1.5rem; text-align: center; color: var(--color-text-muted);">
                  <div style="font-size: 2.6rem; color: var(--color-gray); margin-bottom: 0.75rem;"><i class="ri-inbox-line"></i></div>
                  <div style="font-weight: 700; font-size: 1.05rem; color: var(--color-text-main);">No se encontraron productos coincidentes</div>
                  <div style="font-size: 0.85rem; margin-top: 0.35rem; max-width: 450px; margin-left: auto; margin-right: auto;">
                    ${searchFilter || statusFilter !== 'ALL' 
                      ? 'Intenta modificar tus filtros de búsqueda o cambiar de pestaña.' 
                      : `El comercio <strong>${escapeHtml(activeCommerce)}</strong> no tiene productos cargados en catálogo aún.`}
                  </div>
                  <div style="margin-top: 1.25rem; display: flex; gap: 0.6rem; justify-content: center;">
                    <button onclick="window.openBulkLocationsUploadModal()" class="btn btn-primary" style="font-size: 0.85rem; background: #6366f1; border-color: #6366f1;">
                      <i class="ri-file-upload-line"></i> Cargar Planilla de Ubicaciones
                    </button>
                    <button onclick="window.openSingleLocationModal(null, '', '${escapeHtml(activeBodega)}', '${escapeHtml(activeCommerce)}')" class="btn btn-outline" style="font-size: 0.85rem;">
                      <i class="ri-add-line"></i> Asignar Manual
                    </button>
                  </div>
                </td>
              </tr>
            ` : filteredItems.map(item => {
              const hasLoc = item.hasBodegaLocation;
              const bLocs = item.bodegaLocations;
              const oLocs = item.otherLocations;
              const isAllZero = hasLoc && bLocs.every(l => l.is_zero_stock);

              if (quickEditMode) {
                const primaryLoc = bLocs[0] || null;
                const extraLocCount = bLocs.length > 1 ? bLocs.length - 1 : 0;
                return `
                  <tr data-quick-row="true" data-sku="${escapeHtml(item.sku)}" style="border-bottom: 1px solid var(--color-border); ${!primaryLoc ? 'background: rgba(245, 158, 11, 0.02);' : ''}">
                    <!-- SKU -->
                    <td style="padding: 0.65rem 0.75rem; vertical-align: middle;">
                      <div style="font-weight: 700; color: var(--color-text-main); font-family: monospace; font-size: 0.88rem;">
                        ${escapeHtml(item.sku)}
                      </div>
                      ${item.comercio ? `
                        <span class="badge" style="font-size: 0.65rem; background: rgba(99, 102, 241, 0.08); color: #6366f1; padding: 0.1rem 0.3rem; border-radius: 4px; margin-top: 0.2rem; display: inline-block;">
                          ${escapeHtml(item.comercio)}
                        </span>
                      ` : ''}
                    </td>

                    <!-- Producto -->
                    <td style="padding: 0.65rem 0.75rem; vertical-align: middle;">
                      <div style="display: flex; align-items: center; gap: 0.6rem;">
                        ${item.image_url ? `
                          <img src="${escapeHtml(item.image_url)}" alt="" style="width: 32px; height: 32px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); flex-shrink: 0;" onerror="this.onerror=null; this.src='img/no-image.png';">
                        ` : `
                          <div style="width: 32px; height: 32px; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); font-size: 1rem; flex-shrink: 0;"><i class="ri-image-line"></i></div>
                        `}
                        <div style="overflow: hidden;">
                          <div style="font-weight: 600; color: var(--color-text-main); font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px;" title="${escapeHtml(item.name || item.sku)}">
                            ${escapeHtml(item.name)}
                          </div>
                          ${item.barcode_wms ? `<div style="font-size: 0.7rem; color: var(--color-text-muted); font-family: monospace;">WMS: ${escapeHtml(item.barcode_wms)}</div>` : ''}
                        </div>
                      </div>
                    </td>

                    <!-- Bodega -->
                    <td style="padding: 0.65rem 0.75rem; vertical-align: middle;">
                      <span class="badge" style="background: rgba(37, 99, 235, 0.08); color: #1d4ed8; border: 1px solid rgba(37, 99, 235, 0.25); font-weight: 600; padding: 0.2rem 0.45rem; border-radius: 4px; font-size: 0.74rem;">
                        🏢 ${escapeHtml(activeBodega)}
                      </span>
                    </td>

                    <!-- 2. Zona -->
                    <td style="padding: 0.55rem 0.75rem; vertical-align: middle;">
                      <input type="text" class="quick-loc-zona" 
                        data-sku="${escapeHtml(item.sku)}" 
                        data-loc-id="${primaryLoc?.id || ''}" 
                        data-old="${escapeHtml(primaryLoc?.zona || '')}" 
                        value="${escapeHtml(primaryLoc?.zona || '')}" 
                        placeholder="Ej: Salón" 
                        list="quick-zonas-datalist" 
                        style="width: 100%; height: 32px; padding: 0 8px; font-size: 0.83rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); transition: border-color 0.2s, background 0.2s;">
                    </td>

                    <!-- 3. Espacio -->
                    <td style="padding: 0.55rem 0.75rem; vertical-align: middle;">
                      <input type="text" class="quick-loc-espacio" 
                        data-sku="${escapeHtml(item.sku)}" 
                        data-loc-id="${primaryLoc?.id || ''}" 
                        data-old="${escapeHtml(primaryLoc?.espacio || '')}" 
                        value="${escapeHtml(primaryLoc?.espacio || '')}" 
                        placeholder="Ej: Estante 1" 
                        list="quick-espacios-datalist" 
                        style="width: 100%; height: 32px; padding: 0 8px; font-size: 0.83rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); transition: border-color 0.2s, background 0.2s;">
                    </td>

                    <!-- 4. Posición -->
                    <td style="padding: 0.55rem 0.75rem; vertical-align: middle;">
                      <input type="text" class="quick-loc-posicion" 
                        data-sku="${escapeHtml(item.sku)}" 
                        data-loc-id="${primaryLoc?.id || ''}" 
                        data-old="${escapeHtml(primaryLoc?.posicion || '')}" 
                        value="${escapeHtml(primaryLoc?.posicion || '')}" 
                        placeholder="Ej: Nivel 2" 
                        list="quick-posiciones-datalist" 
                        style="width: 100%; height: 32px; padding: 0 8px; font-size: 0.83rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); transition: border-color 0.2s, background 0.2s;">
                    </td>

                    <!-- 0 Stock -->
                    <td style="padding: 0.55rem 0.75rem; vertical-align: middle; text-align: center;">
                      <input type="checkbox" class="quick-loc-zero" 
                        data-sku="${escapeHtml(item.sku)}" 
                        data-loc-id="${primaryLoc?.id || ''}" 
                        data-old="${Boolean(primaryLoc?.is_zero_stock)}" 
                        ${primaryLoc?.is_zero_stock ? 'checked' : ''} 
                        title="Marcar con 0 stock (evita recomendación en Picker)" 
                        style="width: 17px; height: 17px; accent-color: #ef4444; cursor: pointer;">
                    </td>

                    <!-- Estado -->
                    <td style="padding: 0.55rem 0.75rem; vertical-align: middle; text-align: center;" class="quick-loc-status-col">
                      ${primaryLoc ? `
                        <span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 0.72rem; padding: 0.2rem 0.45rem; border-radius: 4px;">
                          Asignada
                        </span>
                        ${extraLocCount > 0 ? `<div style="font-size: 0.68rem; color: #6366f1; margin-top: 0.2rem;" title="Tiene ${extraLocCount} ubicación adicional en ${escapeHtml(activeBodega)}">+${extraLocCount} otra</div>` : ''}
                      ` : `
                        <span class="badge" style="background: rgba(245, 158, 11, 0.1); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.25); font-size: 0.72rem; padding: 0.2rem 0.45rem; border-radius: 4px;">
                          Sin asignar
                        </span>
                      `}
                    </td>
                  </tr>
                `;
              }

              return `
                <tr style="border-bottom: 1px solid var(--color-border); ${!hasLoc ? 'background: rgba(245, 158, 11, 0.02);' : (isAllZero ? 'background: rgba(239, 68, 68, 0.03);' : '')}">
                  
                  <!-- SKU & Identificadores -->
                  <td style="padding: 0.85rem 1rem; vertical-align: middle;">
                    <div style="font-weight: 700; color: var(--color-text-main); font-family: monospace; font-size: 0.92rem;">
                      ${escapeHtml(item.sku)}
                    </div>
                    ${item.comercio ? `
                      <span class="badge" style="font-size: 0.68rem; background: rgba(99, 102, 241, 0.08); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.2); padding: 0.1rem 0.35rem; border-radius: 4px; margin-top: 0.25rem; display: inline-block;">
                        ${escapeHtml(item.comercio)}
                      </span>
                    ` : ''}
                    ${!item.isCatalog ? `
                      <span class="badge" style="font-size: 0.65rem; background: rgba(107, 114, 128, 0.1); color: #4b5563; padding: 0.1rem 0.3rem; border-radius: 4px; display: block; margin-top: 0.2rem;">
                        No catalogado
                      </span>
                    ` : ''}
                  </td>

                  <!-- Producto (Imagen + Nombre + Código de Barras) -->
                  <td style="padding: 0.85rem 1rem; vertical-align: middle;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                      ${item.image_url ? `
                        <img src="${escapeHtml(item.image_url)}" alt="" style="width: 38px; height: 38px; object-fit: cover; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg); flex-shrink: 0;" onerror="this.onerror=null; this.src='img/no-image.png';">
                      ` : `
                        <div style="width: 38px; height: 38px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); font-size: 1.2rem; flex-shrink: 0;"><i class="ri-image-line"></i></div>
                      `}
                      <div>
                        <div style="font-weight: 600; color: var(--color-text-main); max-width: 270px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.name || item.sku)}">
                          ${escapeHtml(item.name)}
                        </div>
                        <div style="font-size: 0.74rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                          ${item.barcode_wms ? `<span style="font-family: monospace;"><i class="ri-barcode-line"></i> ${escapeHtml(item.barcode_wms)}</span>` : (item.barcode ? `<span style="font-family: monospace;"><i class="ri-barcode-line"></i> ${escapeHtml(item.barcode)}</span>` : '')}
                        </div>
                      </div>
                    </div>
                  </td>

                  <!-- Bodega de Trabajo -->
                  <td style="padding: 0.85rem 1rem; vertical-align: middle;">
                    <span class="badge" style="background: rgba(37, 99, 235, 0.08); color: #1d4ed8; border: 1px solid rgba(37, 99, 235, 0.25); font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.3rem;">
                      <i class="ri-building-line"></i> ${escapeHtml(activeBodega === 'ALL' ? 'Todas las Bodegas' : activeBodega)}
                    </span>
                  </td>

                  <!-- Ubicación Física en esta Bodega -->
                  <td style="padding: 0.85rem 1rem; vertical-align: middle;">
                    ${hasLoc ? `
                      <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                        ${bLocs.map(loc => {
                          const isZero = Boolean(loc.is_zero_stock);
                          return `
                            <div style="display: inline-flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                              <!-- Zona -->
                              <span class="badge" style="background: rgba(147, 51, 234, 0.08); color: #7e22ce; border: 1px solid rgba(147, 51, 234, 0.2); font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px;" title="Zona">
                                <i class="ri-treasure-map-line" style="font-size: 0.75rem;"></i> ${escapeHtml(loc.zona)}
                              </span>
                              <i class="ri-arrow-right-s-line" style="color: var(--color-text-muted); font-size: 0.8rem;"></i>
                              <!-- Espacio -->
                              <span class="badge" style="background: rgba(14, 165, 233, 0.08); color: #0284c7; border: 1px solid rgba(14, 165, 233, 0.25); font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px;" title="Espacio / Estante">
                                <i class="ri-inbox-line" style="font-size: 0.75rem;"></i> ${escapeHtml(loc.espacio)}
                              </span>
                              ${loc.posicion ? `
                                <i class="ri-arrow-right-s-line" style="color: var(--color-text-muted); font-size: 0.8rem;"></i>
                                <!-- Posición -->
                                <span class="badge" style="background: rgba(245, 158, 11, 0.08); color: #b45309; border: 1px solid rgba(245, 158, 11, 0.25); font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px;" title="Posición específica">
                                  <i class="ri-align-item-bottom-line" style="font-size: 0.75rem;"></i> ${escapeHtml(loc.posicion)}
                                </span>
                              ` : ''}

                              ${isZero ? `
                                <span class="badge" style="background:#fee2e2; color:#ef4444; border:1px solid #fca5a5; font-size:0.7rem; font-weight:700; padding: 0.15rem 0.4rem; border-radius: 4px;">
                                  <i class="ri-forbid-line"></i> 0 Stock
                                </span>
                              ` : ''}
                            </div>
                          `;
                        }).join('')}

                        ${oLocs.length > 0 ? `
                          <div style="font-size: 0.73rem; color: var(--color-text-muted); margin-top: 0.15rem; display: flex; align-items: center; gap: 0.3rem;">
                            <i class="ri-global-line" style="color: #6366f1;"></i> Presente también en: <strong>${escapeHtml(Array.from(new Set(oLocs.map(l => l.bodega_nombre))).join(', '))}</strong>
                          </div>
                        ` : ''}
                      </div>
                    ` : `
                      <div>
                        <span class="badge" style="background: rgba(245, 158, 11, 0.08); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.25); font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.35rem;">
                          <i class="ri-alert-line"></i> Sin ubicación en ${escapeHtml(activeBodega === 'ALL' ? 'WMS' : activeBodega)}
                        </span>
                        ${oLocs.length > 0 ? `
                          <div style="font-size: 0.73rem; color: #4b5563; margin-top: 0.25rem; display: flex; align-items: center; gap: 0.3rem;">
                            <i class="ri-information-line" style="color: #6366f1;"></i> Ubicado en: <strong>${escapeHtml(Array.from(new Set(oLocs.map(l => l.bodega_nombre))).join(', '))}</strong>
                          </div>
                        ` : ''}
                      </div>
                    `}
                  </td>

                  <!-- Estado en Picker -->
                  <td style="padding: 0.85rem 1rem; vertical-align: middle; text-align: center;">
                    ${hasLoc ? (
                      isAllZero ? `
                        <span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;" title="Ubicación marcada como agotada">
                          <i class="ri-error-warning-fill"></i> 0 Stock (Agotada)
                        </span>
                      ` : `
                        <span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25); font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;">
                          <i class="ri-checkbox-circle-fill"></i> Disponible
                        </span>
                      `
                    ) : `
                      <span class="badge" style="background: rgba(156, 163, 175, 0.1); color: var(--color-text-muted); border: 1px solid var(--color-border); font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 9999px;">
                        Sin asignación
                      </span>
                    `}
                  </td>

                  <!-- Acciones -->
                  <td style="padding: 0.85rem 1rem; vertical-align: middle; text-align: right;">
                    ${!hasLoc ? `
                      <button type="button" class="btn btn-primary btn-assign-loc" data-sku="${escapeHtml(item.sku)}" data-bodega="${escapeHtml(activeBodega)}" data-commerce="${escapeHtml(item.comercio)}" onclick="window.openSingleLocationModal(null, this.dataset.sku, this.dataset.bodega, this.dataset.commerce); event.stopPropagation();" style="height: 32px; padding: 0 0.85rem; font-size: 0.8rem; font-weight: 600; background: #6366f1; border-color: #6366f1; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 1px 3px rgba(99, 102, 241, 0.25); cursor: pointer;" title="Asignar ubicación física a este producto en ${escapeHtml(activeBodega)}">
                        <i class="ri-add-line"></i> Asignar Ubicación
                      </button>
                    ` : `
                      <div style="display: inline-flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
                        ${bLocs.map(loc => {
                          const isZero = Boolean(loc.is_zero_stock);
                          return `
                            ${isZero ? `
                              <button type="button" class="btn btn-outline btn-toggle-zero-loc" data-loc-id="${loc.id}" data-zero="false" onclick="window.toggleLocationZeroStock('${loc.id}', false); event.stopPropagation();" style="height: 30px; padding: 0 0.5rem; font-size: 0.74rem; color: #10b981; border-color: rgba(16, 185, 129, 0.3); cursor: pointer;" title="Restablecer stock disponible">
                                <i class="ri-restart-line"></i>
                              </button>
                            ` : `
                              <button type="button" class="btn btn-outline btn-toggle-zero-loc" data-loc-id="${loc.id}" data-zero="true" onclick="window.toggleLocationZeroStock('${loc.id}', true); event.stopPropagation();" style="height: 30px; padding: 0 0.5rem; font-size: 0.74rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); cursor: pointer;" title="Marcar con 0 stock (evita que el Picker recomiende esta ubicación)">
                                <i class="ri-forbid-line"></i>
                              </button>
                            `}
                            <button type="button" class="btn btn-outline btn-edit-loc" data-loc-id="${loc.id}" onclick="window.openLocationByIdForEdit('${loc.id}'); event.stopPropagation();" style="height: 30px; padding: 0 0.5rem; font-size: 0.74rem; border-color: var(--color-border); color: var(--color-text-main); cursor: pointer;" title="Editar esta ubicación">
                              <i class="ri-pencil-line"></i>
                            </button>
                            <button type="button" class="btn btn-outline btn-delete-loc" data-loc-id="${loc.id}" onclick="window.confirmDeleteLocation('${loc.id}'); event.stopPropagation();" style="height: 30px; padding: 0 0.5rem; font-size: 0.74rem; color: #9ca3af; border-color: var(--color-border); cursor: pointer;" title="Eliminar ubicación">
                              <i class="ri-delete-bin-line"></i>
                            </button>
                          `;
                        }).join('')}
                        <button type="button" class="btn btn-outline btn-assign-loc" data-sku="${escapeHtml(item.sku)}" data-bodega="${escapeHtml(activeBodega)}" data-commerce="${escapeHtml(item.comercio)}" onclick="window.openSingleLocationModal(null, this.dataset.sku, this.dataset.bodega, this.dataset.commerce); event.stopPropagation();" style="height: 30px; padding: 0 0.55rem; font-size: 0.74rem; color: #6366f1; border-color: rgba(99, 102, 241, 0.3); background: rgba(99, 102, 241, 0.05); cursor: pointer;" title="Agregar otra ubicación física para este producto (multi-ubicación en ${escapeHtml(activeBodega)})">
                          <i class="ri-add-line"></i> Otra
                        </button>
                      </div>
                    `}
                  </td>

                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <!-- DATALISTS PARA AUTOCOMPLETADO RÁPIDO EN QUICK EDIT -->
        <datalist id="quick-zonas-datalist">
          ${allZonas.map(z => `<option value="${escapeHtml(z)}">`).join('')}
        </datalist>
        <datalist id="quick-espacios-datalist">
          ${allEspacios.map(e => `<option value="${escapeHtml(e)}">`).join('')}
        </datalist>
        <datalist id="quick-posiciones-datalist">
          ${allPosiciones.map(p => `<option value="${escapeHtml(p)}">`).join('')}
        </datalist>
      </div>

      <!-- FOOTER INFORMATIVO -->
      <div style="font-size: 0.8rem; color: var(--color-text-muted); display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.25rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>Mostrando ${filteredItems.length} de ${totalCatalogCount} productos en catálogo de <strong>${escapeHtml(activeCommerce)}</strong></div>
        <div style="display: flex; gap: 1rem; align-items: center;">
          <span><i class="ri-building-line" style="color: #2563eb;"></i> Bodega de Trabajo: <strong>${escapeHtml(activeBodega)}</strong></span>
          <span><i class="ri-check-line" style="color: #10b981;"></i> Sincronización en vivo con Picker</span>
        </div>
      </div>

    </div>
  `;

  // =========================================================================
  // LISTENERS DE INTERACCIÓN REACTIVA
  // =========================================================================

  // 1. Selector de Comercio (con buscador interactivo o select robusto)
  const commerceContainer = document.getElementById('loc-commerce-dropdown-container');
  if (commerceContainer) {
    const commerceOptions = comerciosList.map(c => ({
      value: c.nombre,
      label: `${c.nombre} ${c.sigla ? `(${c.sigla})` : ''}`
    }));

    if (typeof window.initSearchableDropdown === 'function') {
      window.initSearchableDropdown(
        'loc-commerce-dropdown-container',
        commerceOptions,
        activeCommerce,
        async (newCommerce) => {
          if (!newCommerce || newCommerce === window.locationsState.activeCommerce) return;
          window.locationsState.activeCommerce = newCommerce;
          window.activeAdminInventoryCommerce = newCommerce;

          container.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--color-text-muted);">
              <i class="ri-loader-4-line ri-spin" style="font-size: 2.2rem; color: var(--color-primary); display: block; margin-bottom: 0.75rem;"></i>
              <div style="font-weight: 700; font-size: 1.05rem; color: var(--color-text-main);">Cargando catálogo de ${escapeHtml(newCommerce)}...</div>
            </div>
          `;

          await Promise.all([
            loadProductsCatalog(newCommerce),
            loadProductLocations({ comercio: newCommerce })
          ]);

          renderLocationsWorkspace(container);
        }
      );
      commerceContainer.style.maxWidth = '100%';
    } else {
      // Fallback a select HTML estilizado
      commerceContainer.innerHTML = `
        <select id="loc-select-commerce" style="width: 100%; height: 42px; padding: 0 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); font-size: 0.9rem; font-weight: 600; box-shadow: var(--shadow-sm); cursor: pointer;">
          <option value="">-- Seleccione un Comercio --</option>
          ${commerceOptions.map(o => `
            <option value="${escapeHtml(o.value)}" ${o.value === activeCommerce ? 'selected' : ''}>
              ${escapeHtml(o.label)}
            </option>
          `).join('')}
        </select>
      `;
      const sel = document.getElementById('loc-select-commerce');
      if (sel) {
        sel.addEventListener('change', async (e) => {
          const newCommerce = e.target.value;
          if (!newCommerce) return;
          window.locationsState.activeCommerce = newCommerce;
          window.activeAdminInventoryCommerce = newCommerce;

          container.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--color-text-muted);">
              <i class="ri-loader-4-line ri-spin" style="font-size: 2.2rem; color: var(--color-primary); display: block; margin-bottom: 0.75rem;"></i>
              <div style="font-weight: 700; font-size: 1.05rem; color: var(--color-text-main);">Cargando catálogo de ${escapeHtml(newCommerce)}...</div>
            </div>
          `;

          await Promise.all([
            loadProductsCatalog(newCommerce),
            loadProductLocations({ comercio: newCommerce })
          ]);

          renderLocationsWorkspace(container);
        });
      }
    }
  }

  // 2. Selector de Bodega de Trabajo
  const bodegaSelect = document.getElementById('loc-select-bodega');
  if (bodegaSelect) {
    bodegaSelect.addEventListener('change', (e) => {
      if (window.locationsState.quickEditMode) {
        const { changes } = getQuickEditChanges();
        if (changes.length > 0 && !confirm(`Tienes ${changes.length} cambios en planilla sin guardar. ¿Deseas descartarlos y cambiar de bodega?`)) {
          bodegaSelect.value = window.locationsState.activeBodega;
          return;
        }
        window.locationsState.quickEditMode = false;
      }
      window.locationsState.activeBodega = e.target.value;
      renderLocationsWorkspace(container);
    });
  }

  // 3. Chips de Filtrado Rápido
  const filterChips = container.querySelectorAll('.loc-filter-chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const targetStatus = chip.getAttribute('data-status');
      window.locationsState.statusFilter = targetStatus;
      renderLocationsWorkspace(container);
    });
  });

  // 4. Buscador textual
  const searchInput = document.getElementById('loc-filter-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      window.locationsState.searchFilter = e.target.value;
      renderLocationsWorkspace(container);
    });
  }

  const clearSearchBtn = document.getElementById('loc-clear-search-btn');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      window.locationsState.searchFilter = '';
      renderLocationsWorkspace(container);
    });
  }

  // 5. Botón de Actualizar Datos
  const refreshBtn = document.getElementById('btn-loc-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const icon = document.getElementById('icon-loc-refresh');
      if (icon) icon.className = 'ri-loader-4-line ri-spin';
      await Promise.all([
        loadProductsCatalog(window.locationsState.activeCommerce),
        loadProductLocations({ comercio: window.locationsState.activeCommerce })
      ]);
      renderLocationsWorkspace(container);
    });
  }

  // 6. Botones de Modo Edición Rápida (Planilla)
  const toggleQuickBtn = document.getElementById('btn-loc-toggle-quick-edit');
  if (toggleQuickBtn) {
    toggleQuickBtn.addEventListener('click', () => {
      if (window.locationsState.activeBodega === 'ALL') {
        alert('Por favor selecciona una bodega específica (ej: Matriz Ñuñoa) para usar la Edición Rápida.');
        return;
      }
      window.locationsState.quickEditMode = true;
      renderLocationsWorkspace(container);
    });
  }

  const cancelQuickBtn = document.getElementById('btn-loc-cancel-quick-edit');
  if (cancelQuickBtn) {
    cancelQuickBtn.addEventListener('click', () => {
      const { changes } = getQuickEditChanges();
      if (changes.length > 0 && !confirm(`Tienes ${changes.length} cambios sin guardar. ¿Deseas descartarlos y salir de la edición rápida?`)) {
        return;
      }
      window.locationsState.quickEditMode = false;
      renderLocationsWorkspace(container);
    });
  }

  const saveQuickBtn = document.getElementById('btn-loc-save-quick-edit');
  if (saveQuickBtn) {
    saveQuickBtn.addEventListener('click', async () => {
      const { changes, errors } = getQuickEditChanges();

      if (errors.length > 0) {
        alert(errors[0].msg);
        errors[0].element.focus();
        return;
      }

      if (changes.length === 0) {
        if (typeof Swal !== 'undefined') {
          Swal.fire({
            icon: 'info',
            title: 'Sin cambios',
            text: 'No se detectaron modificaciones en las ubicaciones.',
            timer: 1500,
            showConfirmButton: false
          });
        }
        window.locationsState.quickEditMode = false;
        renderLocationsWorkspace(container);
        return;
      }

      if (!confirm(`¿Confirmas aplicar y guardar las ubicaciones de ${changes.length} producto${changes.length === 1 ? '' : 's'} en ${window.locationsState.activeBodega}?`)) {
        return;
      }

      saveQuickBtn.disabled = true;
      saveQuickBtn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Guardando (${changes.length})...`;

      try {
        const supa = getLocationsClient();
        const pickerClient = getPickerClient();

        const toUpsert = changes.filter(c => c.type === 'INSERT' || c.type === 'UPDATE').map(c => c.payload);
        const toDeleteIds = changes.filter(c => c.type === 'DELETE').map(c => c.locId);

        // Guardar en WMS
        if (toUpsert.length > 0) {
          if (supa && typeof supa.from === 'function') {
            try {
              const { error: wmsErr } = await supa.from('product_locations').upsert(toUpsert);
              if (wmsErr) console.warn('Error WMS upsert masivo:', wmsErr);
            } catch (e) {
              console.warn('WMS upsert error:', e);
            }
          }
          if (pickerClient) {
            try {
              const { error: pickErr } = await pickerClient.from('product_locations').upsert(toUpsert);
              if (pickErr) console.warn('Error Picker upsert masivo:', pickErr);
            } catch (pe) {
              console.warn('Picker upsert error:', pe);
            }
          }
        }

        // Eliminar si correspondiese
        if (toDeleteIds.length > 0) {
          if (supa && typeof supa.from === 'function') {
            try {
              await supa.from('product_locations').delete().in('id', toDeleteIds);
            } catch (_) {}
          }
          if (pickerClient) {
            try {
              await pickerClient.from('product_locations').delete().in('id', toDeleteIds);
            } catch (_) {}
          }
        }

        if (typeof Swal !== 'undefined') {
          Swal.fire({
            icon: 'success',
            title: '¡Ubicaciones Guardadas!',
            text: `Se actualizaron correctamente ${changes.length} productos en ${window.locationsState.activeBodega}.`,
            timer: 2000,
            showConfirmButton: false
          });
        }

        window.locationsState.quickEditMode = false;
        await loadProductLocations({ comercio: window.locationsState.activeCommerce });
        renderLocationsWorkspace(container);

      } catch (err) {
        alert('Error al guardar cambios rápidos: ' + err.message);
        saveQuickBtn.disabled = false;
        saveQuickBtn.innerHTML = `<i class="ri-save-line"></i> Guardar Cambios Rápidos`;
      }
    });
  }

  // Interacción en tiempo real de inputs en modo Quick Edit
  if (window.locationsState.quickEditMode) {
    const tableEl = document.getElementById('locations-table-main');
    if (tableEl) {
      // Evento input para highlighting y contador
      tableEl.addEventListener('input', (e) => {
        const row = e.target.closest('tr[data-quick-row="true"]');
        if (row) updateRowHighlight(row);
      });

      tableEl.addEventListener('change', (e) => {
        const row = e.target.closest('tr[data-quick-row="true"]');
        if (row) updateRowHighlight(row);
      });

      // Navegación estilo Excel con tecla Enter (avanza a la fila de abajo en la misma columna)
      tableEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const target = e.target;
          if (target.classList.contains('quick-loc-zona') || target.classList.contains('quick-loc-espacio') || target.classList.contains('quick-loc-posicion')) {
            e.preventDefault();
            const colClass = target.classList[0];
            const currentTr = target.closest('tr');
            const nextTr = currentTr?.nextElementSibling;
            if (nextTr) {
              const nextInput = nextTr.querySelector('.' + colClass);
              if (nextInput) {
                nextInput.focus();
                nextInput.select();
              }
            }
          }
        }
      });
    }
  }

  // 7. Botones de Carga Masiva y Asignación Manual Superior
  const bulkUploadBtn = document.getElementById('btn-loc-bulk-upload');
  if (bulkUploadBtn) {
    bulkUploadBtn.addEventListener('click', () => {
      window.openBulkLocationsUploadModal();
    });
  }

  const addSingleBtn = document.getElementById('btn-loc-add-single');
  if (addSingleBtn) {
    addSingleBtn.addEventListener('click', () => {
      window.openSingleLocationModal(null, '', window.locationsState.activeBodega, window.locationsState.activeCommerce);
    });
  }

  const downloadTplBtn = document.getElementById('btn-loc-download-template');
  if (downloadTplBtn) {
    downloadTplBtn.addEventListener('click', () => {
      window.downloadLocationsTemplate();
    });
  }

  // 7. Delegación de eventos para todos los botones de acción de las filas de la tabla
  container.addEventListener('click', async (e) => {
    // 7.1 Asignar Ubicación
    const assignBtn = e.target.closest('.btn-assign-loc');
    if (assignBtn) {
      e.preventDefault();
      const sku = assignBtn.getAttribute('data-sku') || '';
      const bodega = assignBtn.getAttribute('data-bodega') || window.locationsState.activeBodega;
      const commerce = assignBtn.getAttribute('data-commerce') || window.locationsState.activeCommerce;
      window.openSingleLocationModal(null, sku, bodega, commerce);
      return;
    }

    // 7.2 Editar Ubicación
    const editBtn = e.target.closest('.btn-edit-loc');
    if (editBtn) {
      e.preventDefault();
      const locId = editBtn.getAttribute('data-loc-id');
      const loc = window.locationsState.locations.find(l => String(l.id) === String(locId));
      if (loc) {
        window.openSingleLocationModal(loc);
      }
      return;
    }

    // 7.3 Toggle 0 Stock
    const zeroBtn = e.target.closest('.btn-toggle-zero-loc');
    if (zeroBtn) {
      e.preventDefault();
      const locId = zeroBtn.getAttribute('data-loc-id');
      const isZero = zeroBtn.getAttribute('data-zero') === 'true';
      await window.toggleLocationZeroStock(locId, isZero);
      return;
    }

    // 7.4 Eliminar Ubicación
    const deleteBtn = e.target.closest('.btn-delete-loc');
    if (deleteBtn) {
      e.preventDefault();
      const locId = deleteBtn.getAttribute('data-loc-id');
      await window.confirmDeleteLocation(locId);
      return;
    }
  });
}

// =========================================================================
// MODAL DE CARGA MASIVA CON VALIDACIÓN Y VISTA PREVIA INTERACTIVA
// =========================================================================

window.openBulkLocationsUploadModal = function() {
  const existingModal = document.getElementById('modal-locations-bulk-upload');
  if (existingModal) existingModal.remove();

  const { activeCommerce, activeBodega, warehouses } = window.locationsState;

  const modal = document.createElement('div');
  modal.id = 'modal-locations-bulk-upload';
  modal.className = 'modal-overlay active';
  modal.style.display = 'flex';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(0, 0, 0, 0.7)';
  modal.style.backdropFilter = 'blur(4px)';
  modal.style.zIndex = '99999';
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'auto';
  modal.style.visibility = 'visible';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.padding = '1rem';

  modal.innerHTML = `
    <div style="background: var(--color-surface); width: 100%; max-width: 1050px; max-height: 92vh; border-radius: var(--radius-lg); border: 1px solid var(--color-border); box-shadow: var(--shadow-xl); display: flex; flex-direction: column; overflow: hidden;">
      
      <!-- HEADER -->
      <div style="padding: 1.15rem 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-surface);">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 42px; height: 42px; border-radius: 10px; background: rgba(99, 102, 241, 0.12); color: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.4rem;">
            <i class="ri-file-upload-line"></i>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
              Carga Masiva de Ubicaciones Físicas
              <span class="badge" style="font-size: 0.7rem; font-weight: 700; background: rgba(99, 102, 241, 0.1); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.25); padding: 0.15rem 0.5rem; border-radius: 4px;">
                Excel / CSV
              </span>
            </h3>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
              Comercio: <strong>${escapeHtml(activeCommerce)}</strong> | Bodega de Trabajo: <strong>${escapeHtml(activeBodega)}</strong>
            </p>
          </div>
        </div>
        <button id="modal-loc-close-btn" style="background: none; border: none; font-size: 1.4rem; color: var(--color-text-muted); cursor: pointer; padding: 4px;"><i class="ri-close-line"></i></button>
      </div>

      <!-- BODY CON PESTAÑAS (1: Subida/Entrada, 2: Vista Previa y Validación) -->
      <div id="modal-loc-body" style="padding: 1.5rem; overflow-y: auto; flex: 1;">
        
        <!-- SECCIÓN 1: INSTRUCCIONES Y FORMATO -->
        <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: var(--radius-md); padding: 1rem 1.25rem; margin-bottom: 1.25rem; font-size: 0.82rem; color: var(--color-text-main);">
          <div style="font-weight: 700; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; color: #6366f1;">
            <i class="ri-information-line"></i> Columnas de la planilla:
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.6rem; margin-top: 0.5rem;">
            <div><strong>1. SKU</strong> <span style="color:#ef4444;">*</span> (Código del producto)</div>
            <div><strong>2. BODEGA</strong> (Opcional, por defecto usa <em>"${escapeHtml(activeBodega)}"</em>)</div>
            <div><strong>3. ZONA</strong> <span style="color:#ef4444;">*</span> (Salón, Subterráneo, etc.)</div>
            <div><strong>4. ESPACIO</strong> <span style="color:#ef4444;">*</span> (Estante 1, Mesón, etc.)</div>
            <div><strong>5. POSICION</strong> (Bandeja 1, Nivel 4 - Opcional)</div>
            <div><strong>6. STOCK</strong> (Cantidad estimada - Opcional)</div>
          </div>
          <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem; align-items: center;">
            <button onclick="window.downloadLocationsTemplate()" class="btn btn-outline" style="height: 30px; font-size: 0.75rem; border-color: #10b981; color: #10b981; background: rgba(16, 185, 129, 0.05); font-weight: 600;">
              <i class="ri-download-2-line"></i> Descargar Plantilla Excel de Ejemplo
            </button>
          </div>
        </div>

        <!-- SECCIÓN 2: ENTRADA DE ARCHIVO O TEXTO -->
        <div id="bulk-loc-step-input">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
            
            <!-- DROPZONE DE ARCHIVO EXCEL/CSV -->
            <div id="loc-file-dropzone" style="border: 2px dashed var(--color-border); border-radius: var(--radius-lg); padding: 2rem 1.5rem; text-align: center; cursor: pointer; background: var(--color-bg); transition: all 0.2s ease;">
              <input type="file" id="loc-file-input" accept=".xlsx,.xls,.csv" style="display: none;">
              <i class="ri-file-excel-2-line" style="font-size: 3rem; color: #10b981; display: block; margin-bottom: 0.5rem;"></i>
              <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.95rem;">Selecciona o arrastra tu archivo Excel / CSV</div>
              <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 0.35rem;">Formatos compatibles: .xlsx, .xls, .csv</div>
              <button type="button" class="btn btn-outline" style="margin-top: 1rem; font-size: 0.82rem; height: 34px;">
                Examinar Archivo
              </button>
            </div>

            <!-- ENTRADA POR COPIAR Y PEGAR -->
            <div style="display: flex; flex-direction: column;">
              <label class="form-label" style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.4rem; color: var(--color-text-main);">
                O pega directamente desde Excel / Google Sheets:
              </label>
              <textarea id="loc-paste-input" placeholder="Copia y pega aquí las celdas directamente desde Excel...&#10;SKU	BODEGA	ZONA	ESPACIO	POSICION&#10;C0060	${escapeHtml(activeBodega)}	Salón	Estante 1	Nivel 4&#10;C0061	${escapeHtml(activeBodega)}	Subterráneo	Mesón A	Bandeja 2" style="flex: 1; min-height: 160px; font-family: monospace; font-size: 0.8rem; padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); resize: none;"></textarea>
            </div>

          </div>

          <div style="margin-top: 1.25rem; display: flex; justify-content: flex-end;">
            <button id="btn-loc-process-preview" class="btn btn-primary" style="height: 40px; padding: 0 1.5rem; font-size: 0.88rem; font-weight: 700; background: #6366f1; border-color: #6366f1;">
              <i class="ri-scan-2-line"></i> Procesar y Ver Vista Previa
            </button>
          </div>
        </div>

        <!-- SECCIÓN 3: VISTA PREVIA Y VALIDACIÓN (OCULTA INICIALMENTE) -->
        <div id="bulk-loc-step-preview" style="display: none; flex-direction: column; gap: 1rem;">
          
          <!-- RESUMEN DE VALIDACIÓN -->
          <div style="display: flex; justify-content: space-between; align-items: center; background: var(--color-bg); padding: 0.85rem 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); flex-wrap: wrap; gap: 0.75rem;">
            <div id="preview-loc-counters" style="display: flex; gap: 0.85rem; align-items: center; font-size: 0.85rem; font-weight: 600;">
              <!-- Inyectado dinámicamente -->
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <label style="font-size: 0.82rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                <input type="checkbox" id="preview-loc-replace-mode" checked style="accent-color: #6366f1;">
                Reemplazar ubicaciones existentes de los productos cargados en esta bodega
              </label>
            </div>
          </div>

          <!-- TABLA DE VISTA PREVIA -->
          <div style="max-height: 380px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
              <thead style="position: sticky; top: 0; background: var(--color-surface); z-index: 10; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                <tr style="border-bottom: 2px solid var(--color-border); text-align: left; color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase;">
                  <th style="padding: 0.65rem 0.85rem; width: 40px;">#</th>
                  <th style="padding: 0.65rem 0.85rem;">SKU</th>
                  <th style="padding: 0.65rem 0.85rem;">Producto</th>
                  <th style="padding: 0.65rem 0.85rem;">Bodega Asignada</th>
                  <th style="padding: 0.65rem 0.85rem;">Zona</th>
                  <th style="padding: 0.65rem 0.85rem;">Espacio</th>
                  <th style="padding: 0.65rem 0.85rem;">Posición</th>
                  <th style="padding: 0.65rem 0.85rem;">Validación</th>
                </tr>
              </thead>
              <tbody id="preview-loc-table-body">
                <!-- Filas de vista previa inyectadas dinámicamente -->
              </tbody>
            </table>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
            <button id="btn-loc-back-to-input" class="btn btn-outline" style="font-size: 0.82rem; height: 38px;">
              <i class="ri-arrow-left-line"></i> Modificar datos / Cambiar archivo
            </button>
            <button id="btn-loc-confirm-save" class="btn btn-primary" style="height: 38px; padding: 0 1.5rem; font-size: 0.88rem; font-weight: 700; background: #10b981; border-color: #10b981;">
              <i class="ri-check-line"></i> Confirmar y Guardar Ubicaciones
            </button>
          </div>

        </div>

      </div>

    </div>
  `;

  document.body.appendChild(modal);

  // Manejo de eventos del modal
  const closeBtn = document.getElementById('modal-loc-close-btn');
  closeBtn.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  const dropzone = document.getElementById('loc-file-dropzone');
  const fileInput = document.getElementById('loc-file-input');
  const pasteInput = document.getElementById('loc-paste-input');
  const processBtn = document.getElementById('btn-loc-process-preview');
  const backBtn = document.getElementById('btn-loc-back-to-input');
  const confirmBtn = document.getElementById('btn-loc-confirm-save');

  let parsedRawRows = [];
  let validatedRows = [];

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#6366f1';
    dropzone.style.background = 'rgba(99, 102, 241, 0.04)';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--color-border)';
    dropzone.style.background = 'var(--color-bg)';
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--color-border)';
    dropzone.style.background = 'var(--color-bg)';
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected(fileInput.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  function handleFileSelected(file) {
    const reader = new FileReader();
    const isCsv = file.name.endsWith('.csv');

    if (isCsv) {
      reader.onload = (e) => {
        parsedRawRows = parseCsvData(e.target.result);
        processParsedData(parsedRawRows);
      };
      reader.readAsText(file, 'utf-8');
    } else {
      reader.onload = (e) => {
        try {
          if (typeof XLSX === 'undefined') {
            alert('Librería de lectura de Excel no cargada. Por favor copia y pega el contenido.');
            return;
          }
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          parsedRawRows = jsonRows;
          processParsedData(parsedRawRows);
        } catch (err) {
          alert('Error leyendo el archivo Excel: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  processBtn.addEventListener('click', () => {
    const text = pasteInput.value.trim();
    if (text) {
      parsedRawRows = parseTabularText(text);
      processParsedData(parsedRawRows);
    } else if (parsedRawRows.length > 0) {
      processParsedData(parsedRawRows);
    } else {
      alert('Por favor selecciona un archivo Excel/CSV o pega los datos en el recuadro.');
    }
  });

  backBtn.addEventListener('click', () => {
    document.getElementById('bulk-loc-step-preview').style.display = 'none';
    document.getElementById('bulk-loc-step-input').style.display = 'block';
  });

  function processParsedData(rawRows) {
    if (!rawRows || rawRows.length < 2) {
      alert('La planilla no contiene suficientes filas con encabezados y datos.');
      return;
    }

    validatedRows = validateLocationsData(rawRows);
    renderPreviewTable(validatedRows);

    document.getElementById('bulk-loc-step-input').style.display = 'none';
    document.getElementById('bulk-loc-step-preview').style.display = 'flex';
  }

  confirmBtn.addEventListener('click', async () => {
    const validRowsToSave = validatedRows.filter(r => r.status === 'VALID' || r.status === 'WARNING');
    if (validRowsToSave.length === 0) {
      alert('No hay registros válidos para guardar.');
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando ubicaciones...';

    const replaceMode = document.getElementById('preview-loc-replace-mode')?.checked ?? true;

    try {
      await saveValidatedLocationsBatch(validRowsToSave, replaceMode);
      modal.remove();
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          icon: 'success',
          title: '¡Ubicaciones Guardadas!',
          text: `Se registraron exitosamente ${validRowsToSave.length} ubicaciones físicas y se transmitieron en vivo al sistema Picker.`,
          timer: 3000,
          showConfirmButton: false
        });
      } else {
        alert(`¡Éxito! Se registraron ${validRowsToSave.length} ubicaciones físicas.`);
      }
      // Refrescar vista
      const container = document.getElementById('admin-inv-tab-content');
      await window.renderAdminLocationsTab(container);
    } catch (err) {
      alert('Error guardando ubicaciones: ' + err.message);
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="ri-check-line"></i> Confirmar y Guardar Ubicaciones';
    }
  });
};

/**
 * Parsea texto pegado desde portapapeles (tab-separated o coma)
 */
function parseTabularText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    if (line.includes('\t')) return line.split('\t').map(c => c.trim());
    if (line.includes(';')) return line.split(';').map(c => c.trim());
    return line.split(',').map(c => c.trim());
  });
}

function parseCsvData(csvText) {
  return parseTabularText(csvText);
}

/**
 * Valida las filas parseadas contra el catálogo y bodegas
 */
function validateLocationsData(rows) {
  const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
  
  // Buscar índices de columnas
  const findCol = (names) => headers.findIndex(h => names.some(n => h.includes(n)));
  
  const skuIdx = findCol(['SKU', 'CODIGO', 'CÓDIGO']);
  const bodegaIdx = findCol(['BODEGA', 'SUCURSAL', 'SEDE']);
  const zonaIdx = findCol(['ZONA', 'SECTOR', 'AREA', 'ÁREA']);
  const espacioIdx = findCol(['ESPACIO', 'ESTANTE', 'MESON', 'MESÓN', 'RACK', 'MUEBLE']);
  const posicionIdx = findCol(['POSICION', 'POSICIÓN', 'BANDEJA', 'NIVEL', 'CASILLERO']);
  const stockIdx = findCol(['STOCK', 'CANTIDAD', 'CANT']);

  const { productsCatalog, warehouses, activeBodega } = window.locationsState;
  const validated = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0 || row.every(c => !c)) continue;

    const rawSku = skuIdx !== -1 ? String(row[skuIdx] || '').trim() : String(row[0] || '').trim();
    let rawBodega = bodegaIdx !== -1 ? String(row[bodegaIdx] || '').trim() : '';
    
    // Si la planilla no incluye columna de bodega, o viene vacía, hereda la bodega de trabajo seleccionada
    if (!rawBodega && activeBodega && activeBodega !== 'ALL') {
      rawBodega = activeBodega;
    }

    const rawZona = zonaIdx !== -1 ? String(row[zonaIdx] || '').trim() : String(row[2] || '').trim();
    const rawEspacio = espacioIdx !== -1 ? String(row[espacioIdx] || '').trim() : String(row[3] || '').trim();
    const rawPosicion = posicionIdx !== -1 ? String(row[posicionIdx] || '').trim() : (row[4] ? String(row[4]).trim() : '');
    const rawStock = stockIdx !== -1 ? parseInt(row[stockIdx], 10) || 1 : 1;

    const rowVal = {
      rowIndex: i + 1,
      sku: rawSku,
      rawBodega,
      zona: rawZona,
      espacio: rawEspacio,
      posicion: rawPosicion,
      stock: rawStock,
      status: 'VALID',
      reasons: [],
      product: null,
      warehouse: null
    };

    // Validación 1: SKU presente
    if (!rawSku) {
      rowVal.status = 'ERROR';
      rowVal.reasons.push('Falta el SKU');
    } else {
      // Buscar producto en catálogo
      const prod = productsCatalog.find(p => p.sku?.trim().toUpperCase() === rawSku.toUpperCase());
      if (prod) {
        rowVal.product = prod;
      } else {
        rowVal.status = 'WARNING';
        rowVal.reasons.push('SKU no encontrado en catálogo (se guardará referencial)');
      }
    }

    // Validación 2: Bodega reconocida
    if (!rawBodega) {
      rowVal.status = 'ERROR';
      rowVal.reasons.push('Falta especificar Bodega');
    } else {
      const matchWh = findMatchingWarehouse(rawBodega, warehouses);
      if (matchWh) {
        rowVal.warehouse = matchWh;
      } else {
        rowVal.status = 'ERROR';
        rowVal.reasons.push(`Bodega "${rawBodega}" no coincide con las del sistema`);
      }
    }

    // Validación 3: Zona requerida
    if (!rawZona) {
      rowVal.status = 'ERROR';
      rowVal.reasons.push('Falta la Zona (ej: Salón)');
    }

    // Validación 4: Espacio requerido
    if (!rawEspacio) {
      rowVal.status = 'ERROR';
      rowVal.reasons.push('Falta el Espacio (ej: Estante 1)');
    }

    validated.push(rowVal);
  }

  return validated;
}

/**
 * Renderiza la tabla de vista previa con sus contadores
 */
function renderPreviewTable(validatedRows) {
  const tbody = document.getElementById('preview-loc-table-body');
  const countersContainer = document.getElementById('preview-loc-counters');
  const confirmBtn = document.getElementById('btn-loc-confirm-save');

  const total = validatedRows.length;
  const valids = validatedRows.filter(r => r.status === 'VALID').length;
  const warnings = validatedRows.filter(r => r.status === 'WARNING').length;
  const errors = validatedRows.filter(r => r.status === 'ERROR').length;

  countersContainer.innerHTML = `
    <span style="color: var(--color-text-main);">Total: ${total} filas</span>
    <span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3);">
      <i class="ri-checkbox-circle-line"></i> ${valids} Válidos
    </span>
    ${warnings > 0 ? `
      <span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3);">
        <i class="ri-alert-line"></i> ${warnings} Advertencias
      </span>
    ` : ''}
    ${errors > 0 ? `
      <span class="badge" style="background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">
        <i class="ri-close-circle-line"></i> ${errors} Errores
      </span>
    ` : ''}
  `;

  confirmBtn.disabled = (valids + warnings) === 0;
  confirmBtn.innerHTML = `<i class="ri-check-line"></i> Confirmar y Guardar Ubicaciones (${valids + warnings})`;

  tbody.innerHTML = validatedRows.map(r => {
    let statusBadge = '';
    if (r.status === 'VALID') {
      statusBadge = '<span class="badge" style="background:#dcfce7; color:#15803d; border:1px solid #86efac;">✅ Válido</span>';
    } else if (r.status === 'WARNING') {
      statusBadge = `<span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fcd34d;">⚠️ ${escapeHtml(r.reasons.join(', '))}</span>`;
    } else {
      statusBadge = `<span class="badge" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;">❌ ${escapeHtml(r.reasons.join(', '))}</span>`;
    }

    return `
      <tr style="${r.status === 'ERROR' ? 'background: rgba(239, 68, 68, 0.05);' : ''} border-bottom: 1px solid var(--color-border);">
        <td style="padding: 0.65rem 0.85rem; color: var(--color-text-muted);">${r.rowIndex}</td>
        <td style="padding: 0.65rem 0.85rem; font-weight: 700; font-family: monospace;">${escapeHtml(r.sku || '-')}</td>
        <td style="padding: 0.65rem 0.85rem;">
          <div style="font-weight: 500; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(r.product?.name || 'No catalogado')}
          </div>
        </td>
        <td style="padding: 0.65rem 0.85rem;">
          ${r.warehouse ? `<span style="font-weight: 600; color: #1d4ed8;">${escapeHtml(r.warehouse.name)}</span>` : `<span style="color:#ef4444;">${escapeHtml(r.rawBodega || 'Sin bodega')}</span>`}
        </td>
        <td style="padding: 0.65rem 0.85rem;">${escapeHtml(r.zona || '-')}</td>
        <td style="padding: 0.65rem 0.85rem;">${escapeHtml(r.espacio || '-')}</td>
        <td style="padding: 0.65rem 0.85rem;">${escapeHtml(r.posicion || '-')}</td>
        <td style="padding: 0.65rem 0.85rem;">${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Guarda en lotes las ubicaciones validadas
 */
async function saveValidatedLocationsBatch(validRows, replaceExisting = true) {
  const supa = getLocationsClient();
  const pickerClient = getPickerClient();

  const skusToProcess = Array.from(new Set(validRows.map(r => r.sku.trim().toUpperCase())));

  // Si está marcado el modo reemplazo, limpiamos las ubicaciones previas de estos SKUs en estas bodegas
  if (replaceExisting && skusToProcess.length > 0) {
    if (supa && typeof supa.from === 'function') {
      try {
        await supa.from('product_locations').delete().in('sku', skusToProcess);
      } catch (_) {}
    }
    if (pickerClient) {
      try {
        await pickerClient.from('product_locations').delete().in('sku', skusToProcess);
      } catch (_) {}
    }
  }

  // Preparar payloads
  const payloads = validRows.map(r => {
    return {
      product_id: r.product?.id || null,
      sku: r.sku.trim().toUpperCase(),
      comercio: r.product?.comercio || window.locationsState.activeCommerce || null,
      warehouse_id: r.warehouse?.id || null,
      bodega_nombre: r.warehouse ? r.warehouse.name : r.rawBodega,
      zona: r.zona.trim(),
      espacio: r.espacio.trim(),
      posicion: (r.posicion || '').trim(),
      stock: r.stock || 1,
      is_zero_stock: false,
      updated_at: new Date().toISOString()
    };
  });

  // Insertar en WMS
  if (supa && typeof supa.from === 'function') {
    try {
      const { error: wmsErr } = await supa.from('product_locations').insert(payloads);
      if (wmsErr) console.warn('Error insertando en WMS product_locations:', wmsErr);
    } catch (we) {
      console.warn('WMS insert error:', we);
    }
  }

  // Insertar en Picker Supabase
  if (pickerClient) {
    try {
      const { error: pErr } = await pickerClient.from('product_locations').insert(payloads);
      if (pErr) console.warn('Error insertando en Picker product_locations:', pErr);
    } catch (pe) {
      console.warn('Picker insert error:', pe);
    }
  }

  return true;
}

window.openLocationByIdForEdit = function(locId) {
  const loc = window.locationsState.locations.find(l => String(l.id) === String(locId));
  if (loc) {
    window.openSingleLocationModal(loc);
  } else {
    console.warn('Ubicación no encontrada en estado local con ID:', locId);
  }
};

window.openSingleLocationModal = function(existingLoc = null, defaultSku = '', defaultBodega = '', defaultCommerce = '') {
  try {
    const existingModal = document.getElementById('modal-single-location');
    if (existingModal) existingModal.remove();

    const isEdit = Boolean(existingLoc && existingLoc.id);
    const { warehouses, productsCatalog, activeCommerce, activeBodega } = window.locationsState;

    const targetCommerce = defaultCommerce || existingLoc?.comercio || activeCommerce || '';
    const initialSku = existingLoc?.sku || defaultSku || '';
    const initialBodega = existingLoc?.bodega_nombre || defaultBodega || (activeBodega !== 'ALL' ? activeBodega : (warehouses[0]?.name || ''));
    const initialZona = existingLoc?.zona || '';
    const initialEspacio = existingLoc?.espacio || '';
    const initialPosicion = existingLoc?.posicion || '';
    const initialZero = Boolean(existingLoc?.is_zero_stock);

    // Buscar datos del producto en el catálogo
    const matchedProd = productsCatalog.find(p => p.sku?.trim().toUpperCase() === initialSku.trim().toUpperCase()) || null;

    const modal = document.createElement('div');
    modal.id = 'modal-single-location';
    modal.className = 'modal-overlay active';
    modal.style.display = 'flex';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(0, 0, 0, 0.7)';
    modal.style.backdropFilter = 'blur(4px)';
    modal.style.zIndex = '99999';
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
    modal.style.visibility = 'visible';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '1rem';

    modal.innerHTML = `
      <div style="background: var(--color-surface); width: 100%; max-width: 580px; border-radius: var(--radius-lg); border: 1px solid var(--color-border); box-shadow: var(--shadow-xl); overflow: hidden; display: flex; flex-direction: column;">
        
        <!-- HEADER -->
        <div style="padding: 1.15rem 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-surface);">
          <div>
            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-map-pin-add-line" style="color: #6366f1;"></i>
              ${isEdit ? 'Editar Ubicación Física' : 'Asignar Ubicación Física a Producto'}
            </h3>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.78rem; color: var(--color-text-muted);">
              Comercio: <strong>${escapeHtml(targetCommerce)}</strong>
            </p>
          </div>
          <button id="modal-single-loc-close" style="background: none; border: none; font-size: 1.3rem; color: var(--color-text-muted); cursor: pointer;"><i class="ri-close-line"></i></button>
        </div>

        <!-- FORMULARIO -->
        <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.1rem; max-height: 80vh; overflow-y: auto;">
          
          <!-- SKU o Selector de Producto -->
          <div>
            <label class="form-label" style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem; display: block; color: var(--color-text-main);">
              SKU del Producto <span style="color:#ef4444;">*</span>
            </label>
            <input type="text" id="single-loc-sku" list="products-sku-datalist" value="${escapeHtml(initialSku)}" placeholder="Selecciona o escribe el SKU..." style="width: 100%; height: 38px; padding: 0 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); font-family: monospace; font-size: 0.9rem; ${isEdit ? 'opacity: 0.85;' : ''}" ${isEdit ? 'readonly' : ''}>
            <datalist id="products-sku-datalist">
              ${productsCatalog.map(p => `<option value="${escapeHtml(p.sku)}">${escapeHtml(p.sku)} — ${escapeHtml(p.name)}</option>`).join('')}
            </datalist>
            
            <!-- Card de Previsualización del Producto -->
            <div id="single-loc-product-card" style="margin-top: 0.5rem; padding: 0.65rem 0.85rem; border-radius: var(--radius-md); background: var(--color-bg); border: 1px solid var(--color-border); display: flex; align-items: center; gap: 0.75rem;">
              <div id="single-loc-img-wrap" style="width: 38px; height: 38px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-surface, #fff); overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                ${matchedProd?.image_url ? `
                  <img id="single-loc-img" src="${escapeHtml(matchedProd.image_url)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.src='img/no-image.png';">
                ` : `
                  <i class="ri-image-line" style="font-size: 1.2rem; color: var(--color-text-muted);"></i>
                `}
              </div>
              <div style="overflow: hidden; flex: 1;">
                <div id="single-loc-prod-title" style="font-weight: 600; font-size: 0.84rem; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(matchedProd?.name || (initialSku ? 'Cargando producto...' : 'Selecciona un SKU arriba'))}
                </div>
                <div id="single-loc-prod-meta" style="font-size: 0.72rem; color: var(--color-text-muted);">
                  ${matchedProd?.barcode_wms ? `Código WMS: ${escapeHtml(matchedProd.barcode_wms)}` : (matchedProd?.barcode ? `Código: ${escapeHtml(matchedProd.barcode)}` : `Comercio: ${escapeHtml(matchedProd?.comercio || targetCommerce)}`)}
                </div>
              </div>
            </div>
          </div>

          <!-- 1. Bodega de Trabajo -->
          <div>
            <label class="form-label" style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem; display: block; color: var(--color-text-main);">
              1. Bodega donde asignar <span style="color:#ef4444;">*</span>
            </label>
            <select id="single-loc-bodega" style="width: 100%; height: 38px; padding: 0 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); font-size: 0.88rem; font-weight: 600; cursor: pointer;">
              ${warehouses.map(w => `
                <option value="${escapeHtml(w.name)}" ${normalizeBodegaName(w.name) === normalizeBodegaName(initialBodega) ? 'selected' : ''}>
                  🏢 ${escapeHtml(w.name)} (${escapeHtml(w.comuna || 'RM')})
                </option>
              `).join('')}
            </select>
          </div>

          <!-- 2. Zona -->
          <div>
            <label class="form-label" style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem; display: block; color: var(--color-text-main);">
              2. Zona de la Bodega <span style="color:#ef4444;">*</span>
              <small style="color: var(--color-text-muted); font-weight: normal;">(Elige de la lista o escribe una)</small>
            </label>
            <input type="text" id="single-loc-zona" list="zonas-suggest-datalist" value="${escapeHtml(initialZona)}" placeholder="Ej: Salón, Subterráneo, Altillo, Patio..." style="width: 100%; height: 38px; padding: 0 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); font-size: 0.88rem;">
            <datalist id="zonas-suggest-datalist">
              <option value="Salón">
              <option value="Subterráneo">
              <option value="Altillo">
              <option value="Bodega Alta">
              <option value="Zona de Recepción">
              <option value="Zona Despacho">
            </datalist>
          </div>

          <!-- 3. Espacio -->
          <div>
            <label class="form-label" style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem; display: block; color: var(--color-text-main);">
              3. Espacio dentro de la Zona <span style="color:#ef4444;">*</span>
              <small style="color: var(--color-text-muted); font-weight: normal;">(Elige de la lista o escribe uno)</small>
            </label>
            <input type="text" id="single-loc-espacio" list="espacios-suggest-datalist" value="${escapeHtml(initialEspacio)}" placeholder="Ej: Estante 1, Mesón Principal, Rack A, Pasillo 3..." style="width: 100%; height: 38px; padding: 0 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); font-size: 0.88rem;">
            <datalist id="espacios-suggest-datalist">
              <option value="Estante 1">
              <option value="Estante 2">
              <option value="Estante 3">
              <option value="Estante 4">
              <option value="Mesón Principal">
              <option value="Rack A">
              <option value="Rack B">
              <option value="Rack C">
              <option value="Pared Lateral">
            </datalist>
          </div>

          <!-- 4. Posición (Opcional) -->
          <div>
            <label class="form-label" style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem; display: block; color: var(--color-text-main);">
              4. Posición dentro del Espacio <small style="color: var(--color-text-muted); font-weight: normal;">(Opcional, personalizable)</small>
            </label>
            <input type="text" id="single-loc-posicion" list="posicion-suggest-datalist" value="${escapeHtml(initialPosicion)}" placeholder="Ej: Bandeja 1, Nivel 4, Suelo, Casilla B..." style="width: 100%; height: 38px; padding: 0 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); font-size: 0.88rem;">
            <datalist id="posicion-suggest-datalist">
              <option value="Nivel 1 (Superior)">
              <option value="Nivel 2">
              <option value="Nivel 3">
              <option value="Nivel 4 (Inferior)">
              <option value="Bandeja 1">
              <option value="Bandeja 2">
              <option value="Suelo">
              <option value="Caja 1">
            </datalist>
          </div>

          <!-- Estado / 0 Stock -->
          <div style="padding: 0.75rem 1rem; background: var(--color-bg); border-radius: var(--radius-md); border: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 600; font-size: 0.85rem; color: var(--color-text-main);">Estado de Disponibilidad</div>
              <div style="font-size: 0.74rem; color: var(--color-text-muted);">Si marcas "0 Stock", el Picker no recomendará esta posición</div>
            </div>
            <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; cursor: pointer; color: ${initialZero ? '#ef4444' : 'var(--color-text-main)'}; font-weight: 600;">
              <input type="checkbox" id="single-loc-zero" ${initialZero ? 'checked' : ''} style="accent-color: #ef4444;">
              Marcar con 0 Stock
            </label>
          </div>

        </div>

        <!-- FOOTER ACCIONES -->
        <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 0.6rem; background: var(--color-surface);">
          <button id="modal-single-loc-cancel" class="btn btn-outline" style="height: 38px; font-size: 0.85rem;">Cancelar</button>
          <button id="modal-single-loc-save" class="btn btn-primary" style="height: 38px; font-size: 0.88rem; font-weight: 700; background: #6366f1; border-color: #6366f1;">
            <i class="ri-save-line"></i> Guardar Ubicación
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = document.getElementById('modal-single-loc-close');
    const cancelBtn = document.getElementById('modal-single-loc-cancel');
    const saveBtn = document.getElementById('modal-single-loc-save');
    const skuInput = document.getElementById('single-loc-sku');
    const imgWrap = document.getElementById('single-loc-img-wrap');
    const titleEl = document.getElementById('single-loc-prod-title');
    const metaEl = document.getElementById('single-loc-prod-meta');

    const closeModal = () => modal.remove();
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    const updateCard = (sku) => {
      const pFound = productsCatalog.find(p => p.sku?.trim().toUpperCase() === sku.trim().toUpperCase());
      if (pFound) {
        if (imgWrap) {
          imgWrap.innerHTML = pFound.image_url 
            ? `<img id="single-loc-img" src="${escapeHtml(pFound.image_url)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.src='img/no-image.png';">`
            : `<i class="ri-image-line" style="font-size: 1.2rem; color: var(--color-text-muted);"></i>`;
        }
        titleEl.innerText = pFound.name || pFound.sku;
        metaEl.innerText = pFound.barcode_wms ? `Código WMS: ${pFound.barcode_wms}` : (pFound.barcode ? `Código: ${pFound.barcode}` : `Comercio: ${pFound.comercio || targetCommerce}`);
      } else if (sku) {
        if (imgWrap) imgWrap.innerHTML = `<i class="ri-image-line" style="font-size: 1.2rem; color: var(--color-text-muted);"></i>`;
        titleEl.innerText = 'SKU no catalogado en WMS (se guardará referencial)';
        metaEl.innerText = '';
      } else {
        if (imgWrap) imgWrap.innerHTML = `<i class="ri-image-line" style="font-size: 1.2rem; color: var(--color-text-muted);"></i>`;
        titleEl.innerText = 'Selecciona o escribe un SKU arriba';
        metaEl.innerText = '';
      }
    };

    skuInput.addEventListener('input', (e) => updateCard(e.target.value));

    // Si ya viene con SKU, enfocar directamente la Zona para velocidad del operario
    setTimeout(() => {
      const zonaInput = document.getElementById('single-loc-zona');
      if (zonaInput && initialSku) {
        zonaInput.focus();
      }
    }, 80);

    saveBtn.addEventListener('click', async () => {
      const sku = skuInput.value.trim().toUpperCase();
      const bodegaNombre = document.getElementById('single-loc-bodega').value;
      const zona = document.getElementById('single-loc-zona').value.trim();
      const espacio = document.getElementById('single-loc-espacio').value.trim();
      const posicion = document.getElementById('single-loc-posicion').value.trim();
      const isZero = document.getElementById('single-loc-zero').checked;

      if (!sku) {
        alert('Por favor ingresa un SKU.');
        skuInput.focus();
        return;
      }
      if (!zona) {
        alert('Por favor ingresa la Zona (ej: Salón).');
        document.getElementById('single-loc-zona').focus();
        return;
      }
      if (!espacio) {
        alert('Por favor ingresa el Espacio (ej: Estante 1).');
        document.getElementById('single-loc-espacio').focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

      const pFound = productsCatalog.find(p => p.sku?.trim().toUpperCase() === sku);
      const wh = warehouses.find(w => normalizeBodegaName(w.name) === normalizeBodegaName(bodegaNombre));

      const payload = {
        ...(existingLoc?.id ? { id: existingLoc.id } : {}),
        product_id: pFound?.id || existingLoc?.product_id || null,
        sku: sku,
        comercio: pFound?.comercio || existingLoc?.comercio || targetCommerce || null,
        warehouse_id: wh?.id || existingLoc?.warehouse_id || null,
        bodega_nombre: bodegaNombre,
        zona: zona,
        espacio: espacio,
        posicion: posicion,
        stock: isZero ? 0 : 1,
        is_zero_stock: isZero,
        updated_at: new Date().toISOString()
      };

      try {
        await saveProductLocation(payload);
        modal.remove();

        if (typeof Swal !== 'undefined') {
          Swal.fire({
            icon: 'success',
            title: '¡Ubicación Asignada!',
            text: `Se guardó la ubicación física de ${sku} en ${bodegaNombre} (${zona} ➔ ${espacio}).`,
            timer: 2000,
            showConfirmButton: false
          });
        }

        // Recargar ubicaciones y refrescar vista
        await loadProductLocations({ comercio: targetCommerce });
        const container = document.getElementById('admin-inv-tab-content');
        renderLocationsWorkspace(container);
      } catch (err) {
        alert('Error al guardar: ' + err.message);
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="ri-save-line"></i> Guardar Ubicación';
      }
    });

  } catch (modalErr) {
    console.error('Error abriendo modal de ubicación:', modalErr);
    alert('No se pudo abrir el formulario de asignación: ' + modalErr.message);
  }
};

/**
 * Confirmación para eliminar una ubicación
 */
window.confirmDeleteLocation = async function(locationId) {
  if (!confirm('¿Estás seguro de que deseas eliminar esta ubicación física?')) return;
  try {
    await deleteProductLocation(locationId);
    await loadProductLocations({ comercio: window.locationsState.activeCommerce });
    const container = document.getElementById('admin-inv-tab-content');
    renderLocationsWorkspace(container);
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
};

/**
 * Cambia el estado de 0 stock de una ubicación
 */
window.toggleLocationZeroStock = async function(locationId, isZero) {
  try {
    await updateLocationZeroStock(locationId, isZero);
    await loadProductLocations({ comercio: window.locationsState.activeCommerce });
    const container = document.getElementById('admin-inv-tab-content');
    renderLocationsWorkspace(container);
  } catch (err) {
    alert('Error al actualizar stock: ' + err.message);
  }
};

/**
 * Descarga una planilla Excel de ejemplo contextualizada al comercio y bodega seleccionada
 */
window.downloadLocationsTemplate = function() {
  const { activeBodega, productsCatalog } = window.locationsState;
  const bodegaName = (activeBodega && activeBodega !== 'ALL') ? activeBodega : 'CDD La Reina';

  const headers = ['SKU', 'BODEGA', 'ZONA', 'ESPACIO', 'POSICION', 'STOCK'];
  
  // Usar SKUs reales del catálogo si existen
  const sampleSkus = productsCatalog.slice(0, 3).map(p => p.sku);
  if (sampleSkus.length < 3) sampleSkus.push('C0060', 'C0061', 'C0062');

  const sampleData = [
    headers,
    [sampleSkus[0], bodegaName, 'Salón', 'Estante 1', 'Nivel 4', 5],
    [sampleSkus[0], bodegaName, 'Subterráneo', 'Mesón Principal', 'Bandeja 1', 10],
    [sampleSkus[1], bodegaName, 'Salón', 'Estante 2', 'Nivel 2', 4],
    [sampleSkus[2] || 'C0062', bodegaName, 'Bodega Alta', 'Rack A', 'Nivel 1', 8]
  ];

  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ubicaciones');
    XLSX.writeFile(wb, `plantilla_ubicaciones_${bodegaName.replace(/\s+/g, '_').toLowerCase()}.xlsx`);
  } else {
    // Fallback a CSV
    const csvContent = sampleData.map(e => e.join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plantilla_ubicaciones_${bodegaName.replace(/\s+/g, '_').toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
