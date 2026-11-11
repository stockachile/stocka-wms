/**
 * WMS STOCKA - Sistema de Transferencias de Stock entre Bodegas (Trazabilidad 360°)
 * Archivo: js/stock_transfers.js
 *
 * Funcionalidades principales:
 * 1. Creación y solicitud de transferencias entre bodegas (exclusivo Administradores).
 * 2. Trazabilidad completa de responsables: quién solicita, quién despacha y quién recepciona.
 * 3. Máquina de estados con ajuste automático de stock por estado:
 *    - 'Solicitada': Reserva unidades en bodega de origen (descuenta de Stock Disponible).
 *    - 'En Tránsito': Libera reserva, descuenta Stock Físico en origen (+ Kardex OUT) y suma a Stock en Tránsito en destino.
 *    - 'Recepcionada' / 'Con Diferencias': Limpia tránsito, suma Stock Físico en destino (+ Kardex IN) y gestiona diferencias.
 *    - 'Cancelada': Reintegra reserva o stock físico a la bodega de origen según el estado previo.
 * 4. Edición dinámica según estado ('Solicitada' o 'En Tránsito') y "Corregir un Ingreso / Recepción"
 *    post-recepción con cálculo automático de diferenciales (Delta) en inventario y Kardex.
 */

import supabaseInstance from './supabase.js';

const supabase = (supabaseInstance && typeof supabaseInstance.from === 'function')
  ? supabaseInstance
  : (window.supabaseClient && typeof window.supabaseClient.from === 'function' ? window.supabaseClient : supabaseInstance);

const LOCAL_STORAGE_KEY = 'stocka_wms_stock_transfers_v1';

// Estado global del módulo
window.stockTransfersState = {
  transfers: [],
  usingLocalFallback: false,
  tableVerified: false,
  inventoryColsVerified: null, // boolean: si public.inventory tiene transfer_reserved_quantity e in_transit_quantity
  movementsColsVerified: null, // boolean: si public.movements tiene transfer_id y created_by_name
  filterStatus: 'ALL',
  filterCommerce: '',
  filterSourceWh: '',
  filterDestWh: '',
  searchQuery: '',
  loading: false,
  currentAdminName: 'Admin Operaciones',
  currentAdminId: null
};

// Mapas en vivo para hidratar la tabla de Inventario y Tarjetas de Bodega sin doble conteo
window.adminTransferReservedMap = window.adminTransferReservedMap || {}; // key: `${whId}_${prodId}` -> qty
window.adminInTransitMap = window.adminInTransitMap || {};               // key: `${whId}_${prodId}` -> qty
window.adminInTransitBySkuMap = window.adminInTransitBySkuMap || {};     // key: `${commerce}_${sku}` -> qty

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTimeCL(isoStr) {
  if (!isoStr) return '-';
  try {
    return new Date(isoStr).toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return String(isoStr);
  }
}

/**
 * Obtiene el usuario administrador actual autenticado en sesión
 */
export async function resolveCurrentAdminIdentity() {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (user) {
      window.stockTransfersState.currentAdminId = user.id;
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, company_name, email, role')
        .eq('id', user.id)
        .maybeSingle();

      const displayName = (prof?.full_name && prof.full_name !== 'Nuevo Usuario')
        ? prof.full_name
        : (user.user_metadata?.full_name || user.email?.split('@')[0] || 'Administrador');
      window.stockTransfersState.currentAdminName = displayName;
      return { id: user.id, name: displayName, email: user.email, role: prof?.role || 'admin' };
    }
  } catch (e) {
    console.warn('[StockTransfers] No se pudo resolver identidad admin:', e);
  }
  return {
    id: window.stockTransfersState.currentAdminId,
    name: window.stockTransfersState.currentAdminName || 'Administrador WMS',
    role: 'admin'
  };
}

const DEFAULT_STOCKA_WAREHOUSES = [
  { id: 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09', name: 'Bodega Central', comuna: 'Santiago' },
  { id: '414605cb-f926-43d2-8bd2-d9509f7b458a', name: 'CDD La Reina', comuna: 'La Reina' },
  { id: '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a', name: 'CDD Recoleta', comuna: 'Recoleta' },
  { id: '973da888-8a63-4790-a08f-919e1af41a93', name: 'Matriz Ñuñoa', comuna: 'Ñuñoa' }
];

/**
 * Garantiza que window.allWarehousesList esté cargado desde Supabase (con respaldo de bodegas STOCKA)
 */
export async function ensureAllWarehousesLoaded(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(window.allWarehousesList) && window.allWarehousesList.length >= 2) {
    return window.allWarehousesList;
  }

  let dbWarehouses = [];
  try {
    const { data, error } = await supabase
      .from('warehouses')
      .select('id, name, address, comuna')
      .order('name', { ascending: true });
    if (!error && Array.isArray(data)) {
      dbWarehouses = data;
    }
  } catch (err) {
    console.warn('[StockTransfers] Error consultando tabla warehouses:', err);
  }

  if (dbWarehouses.length >= 2) {
    window.allWarehousesList = dbWarehouses;
    return window.allWarehousesList;
  }

  // Si en BD hay menos de 2 bodegas o hubo error de red, combinar con las bodegas operativas de STOCKA
  const merged = [...dbWarehouses];
  const existingIds = new Set(merged.map(w => String(w.id)));
  const existingNames = new Set(merged.map(w => String(w.name || '').trim().toLowerCase()));

  DEFAULT_STOCKA_WAREHOUSES.forEach(defWh => {
    if (!existingIds.has(String(defWh.id)) && !existingNames.has(defWh.name.toLowerCase())) {
      merged.push(defWh);
    }
  });

  window.allWarehousesList = merged;
  return window.allWarehousesList;
}
window.ensureAllWarehousesLoaded = ensureAllWarehousesLoaded;

/**
 * Garantiza la carga del listado completo de comercios activos desde v_comercios_config y products
 */
export async function ensureAllCommercesLoaded(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(window.adminCommercesList) && window.adminCommercesList.length > 0) {
    return window.adminCommercesList;
  }

  const commerceSet = new Set();
  if (window.activeAdminInventoryCommerce) commerceSet.add(window.activeAdminInventoryCommerce.trim());

  try {
    const { data: cfg } = await supabase
      .from('v_comercios_config')
      .select('nombre')
      .order('nombre');
    (cfg || []).forEach(c => {
      if (c && c.nombre && c.nombre.trim()) commerceSet.add(c.nombre.trim());
    });
  } catch (e) {
    console.warn('[StockTransfers] No se pudo consultar v_comercios_config:', e);
  }

  if (commerceSet.size === 0) {
    try {
      const { data: prodComms } = await supabase
        .from('products')
        .select('comercio')
        .not('comercio', 'is', null)
        .limit(1000);
      (prodComms || []).forEach(r => {
        if (r && r.comercio && r.comercio.trim()) commerceSet.add(r.comercio.trim());
      });
    } catch (e2) {
      console.warn('[StockTransfers] No se pudo consultar comercios desde products:', e2);
    }
  }

  window.adminCommercesList = Array.from(commerceSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
  return window.adminCommercesList;
}
window.ensureAllCommercesLoaded = ensureAllCommercesLoaded;

/**
 * Lee/escribe respaldo local cuando la tabla SQL aún no ha sido ejecutada en Supabase
 */
function loadLocalTransfersBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveLocalTransfersBackup(list) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list || []));
  } catch (e) {
    console.warn('[StockTransfers] Error guardando backup local:', e);
  }
}

function generateNextLocalFolio(existingList = []) {
  let maxNum = 1000;
  existingList.forEach(t => {
    const m = String(t.folio || '').match(/TRF-(\d+)/i);
    if (m && Number(m[1]) > maxNum) maxNum = Number(m[1]);
  });
  return `TRF-${maxNum + 1}`;
}

/**
 * Recalcula los mapas en memoria de Reserva de Traslado (Solicitada) y En Tránsito (En Tránsito)
 * y actualiza los badges del menú lateral y pestaña de inventario.
 */
export function rebuildTransferLiveStockMaps(transfersList) {
  const list = Array.isArray(transfersList) ? transfersList : (window.stockTransfersState.transfers || []);
  const resMap = {};
  const transitMap = {};
  const transitSkuMap = {};

  let activePendingOrTransitCount = 0;

  list.forEach(t => {
    if (!t || t.status === 'Cancelada') return;
    const items = Array.isArray(t.items) ? t.items : (Array.isArray(t.stock_transfer_items) ? t.stock_transfer_items : []);

    if (t.status === 'Solicitada') {
      activePendingOrTransitCount++;
      items.forEach(it => {
        const q = Number(it.quantity_requested || 0);
        if (q > 0 && t.source_warehouse_id && it.product_id) {
          const k = `${t.source_warehouse_id}_${it.product_id}`;
          resMap[k] = (resMap[k] || 0) + q;
        }
      });
    } else if (t.status === 'En Tránsito') {
      activePendingOrTransitCount++;
      items.forEach(it => {
        const q = Number(it.quantity_sent || 0);
        if (q > 0 && t.dest_warehouse_id && it.product_id) {
          const k = `${t.dest_warehouse_id}_${it.product_id}`;
          transitMap[k] = (transitMap[k] || 0) + q;
        }
        if (q > 0 && it.sku) {
          const skuKey = `${(t.comercio || '').trim()}_${it.sku.trim()}`;
          transitSkuMap[skuKey] = (transitSkuMap[skuKey] || 0) + q;
        }
      });
    }
  });

  window.adminTransferReservedMap = resMap;
  window.adminInTransitMap = transitMap;
  window.adminInTransitBySkuMap = transitSkuMap;

  // Actualizar badges en UI si existen
  const sidebarBadge = document.getElementById('badge-transfers-admin');
  const tabBadge = document.getElementById('badge-admin-inv-transfers');
  [sidebarBadge, tabBadge].forEach(b => {
    if (!b) return;
    if (activePendingOrTransitCount > 0) {
      b.textContent = String(activePendingOrTransitCount);
      b.style.display = 'inline-block';
    } else {
      b.style.display = 'none';
    }
  });
}
window.rebuildTransferLiveStockMaps = rebuildTransferLiveStockMaps;

/**
 * Helper global para consultar cuánto stock tiene un producto reservado por traslados en una bodega
 */
window.getProductTransferReservedQty = function(warehouseId, productId, invRecord = null) {
  if (!warehouseId || !productId) return 0;
  const k = `${warehouseId}_${productId}`;
  if (window.adminTransferReservedMap && window.adminTransferReservedMap[k] !== undefined) {
    return Number(window.adminTransferReservedMap[k]) || 0;
  }
  if (invRecord && invRecord.transfer_reserved_quantity !== undefined) {
    return Number(invRecord.transfer_reserved_quantity) || 0;
  }
  return 0;
};

/**
 * Helper global para consultar cuánto stock viene en tránsito hacia una bodega destino
 */
window.getProductInTransitQty = function(warehouseId, productId, invRecord = null) {
  if (!warehouseId || !productId) return 0;
  const k = `${warehouseId}_${productId}`;
  if (window.adminInTransitMap && window.adminInTransitMap[k] !== undefined) {
    return Number(window.adminInTransitMap[k]) || 0;
  }
  if (invRecord && invRecord.in_transit_quantity !== undefined) {
    return Number(invRecord.in_transit_quantity) || 0;
  }
  return 0;
};

/**
 * Carga todas las transferencias desde Supabase (o backup local si la tabla aún no existe)
 */
export async function fetchAllStockTransfers(forceRefresh = false) {
  try {
    const { data, error } = await supabase
      .from('stock_transfers')
      .select(`
        *,
        stock_transfer_items (*)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      const code = String(error.code || '');
      const msg = String(error.message || '').toLowerCase();
      if (code === '42P01' || code === 'PGRST205' || msg.includes('does not exist') || msg.includes('schema cache')) {
        window.stockTransfersState.usingLocalFallback = true;
        window.stockTransfersState.tableVerified = false;
        const localList = loadLocalTransfersBackup();
        window.stockTransfersState.transfers = localList;
        rebuildTransferLiveStockMaps(localList);
        return localList;
      }
      throw error;
    }

    window.stockTransfersState.usingLocalFallback = false;
    window.stockTransfersState.tableVerified = true;

    const normalized = (data || []).map(row => ({
      ...row,
      items: Array.isArray(row.stock_transfer_items) ? row.stock_transfer_items : (row.items || []),
      history: Array.isArray(row.history) ? row.history : []
    }));

    // Si había transferencias creadas en fallback local antes de correr el SQL, sincronizarlas
    const localBackup = loadLocalTransfersBackup();
    const localUnsynced = localBackup.filter(lt => lt._isLocalOnly);
    if (localUnsynced.length > 0) {
      for (const lt of localUnsynced) {
        try {
          await syncLocalTransferToSupabase(lt);
        } catch (syncErr) {
          console.warn('[StockTransfers] No se pudo migrar traslado local:', syncErr);
        }
      }
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      return await fetchAllStockTransfers(false);
    }

    window.stockTransfersState.transfers = normalized;
    saveLocalTransfersBackup(normalized);
    rebuildTransferLiveStockMaps(normalized);
    return normalized;
  } catch (err) {
    console.warn('[StockTransfers] Fallback a almacenamiento local:', err.message);
    window.stockTransfersState.usingLocalFallback = true;
    const localList = loadLocalTransfersBackup();
    window.stockTransfersState.transfers = localList;
    rebuildTransferLiveStockMaps(localList);
    return localList;
  }
}
window.fetchAllStockTransfers = fetchAllStockTransfers;

async function syncLocalTransferToSupabase(lt) {
  const headerPayload = {
    folio: lt.folio,
    comercio: lt.comercio,
    source_warehouse_id: lt.source_warehouse_id,
    source_warehouse_name: lt.source_warehouse_name,
    dest_warehouse_id: lt.dest_warehouse_id,
    dest_warehouse_name: lt.dest_warehouse_name,
    status: lt.status,
    priority: lt.priority || 'Normal',
    execution_mode: lt.execution_mode || 'standard',
    title: lt.title || '',
    notes: lt.notes || '',
    reception_notes: lt.reception_notes || '',
    carrier_info: lt.carrier_info || '',
    package_count: lt.package_count || 1,
    discrepancy_policy: lt.discrepancy_policy || 'return_origin',
    total_skus: (lt.items || []).length,
    total_requested: lt.total_requested || 0,
    total_sent: lt.total_sent || 0,
    total_received: lt.total_received || 0,
    requested_by_name: lt.requested_by_name || 'Administrador',
    requested_at: lt.requested_at || new Date().toISOString(),
    dispatched_by_name: lt.dispatched_by_name || null,
    dispatched_at: lt.dispatched_at || null,
    received_by_name: lt.received_by_name || null,
    received_at: lt.received_at || null,
    history: Array.isArray(lt.history) ? lt.history : []
  };

  const { data: inserted, error: hErr } = await supabase
    .from('stock_transfers')
    .insert([headerPayload])
    .select('*')
    .single();

  if (hErr || !inserted) throw hErr;

  const itemsPayload = (lt.items || []).map(it => ({
    transfer_id: inserted.id,
    product_id: it.product_id,
    sku: it.sku,
    product_name: it.product_name,
    quantity_requested: it.quantity_requested || 0,
    quantity_sent: it.quantity_sent || 0,
    quantity_received: it.quantity_received || 0,
    quantity_returned_origin: it.quantity_returned_origin || 0,
    discrepancy_type: it.discrepancy_type || 'none',
    dest_location_hint: it.dest_location_hint || ''
  }));

  if (itemsPayload.length > 0) {
    await supabase.from('stock_transfer_items').insert(itemsPayload);
  }
}

/**
 * Helper atómico para ajustar saldos en public.inventory (Físico, Reserva de Traslado y En Tránsito)
 */
async function adjustWarehouseInventoryBalances(warehouseId, productId, deltas = {}) {
  const deltaPhysical = Number(deltas.physical || 0);
  const deltaTransferRes = Number(deltas.transferReserved || 0);
  const deltaInTransit = Number(deltas.inTransit || 0);

  if (deltaPhysical === 0 && deltaTransferRes === 0 && deltaInTransit === 0) return;

  // Si ya sabemos que la tabla inventory no tiene columnas extendidas y no cambia el stock físico, no tocar la BD
  if (window.stockTransfersState.inventoryColsVerified === false && deltaPhysical === 0) {
    return;
  }

  // Consultar fila actual en public.inventory
  let selectCols = 'id, quantity, transfer_reserved_quantity, in_transit_quantity';
  if (window.stockTransfersState.inventoryColsVerified === false) {
    selectCols = 'id, quantity';
  }

  let { data: invRow, error: selErr } = await supabase
    .from('inventory')
    .select(selectCols)
    .eq('product_id', productId)
    .eq('warehouse_id', warehouseId)
    .limit(1)
    .maybeSingle();

  // Siempre reintentar con columnas básicas si hubo error de esquema (incluso en llamadas concurrentes)
  if (selErr) {
    window.stockTransfersState.inventoryColsVerified = false;
    if (deltaPhysical === 0) {
      return;
    }
    const retry = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .limit(1)
      .maybeSingle();
    invRow = retry.data;
  } else if (window.stockTransfersState.inventoryColsVerified === null) {
    window.stockTransfersState.inventoryColsVerified = true;
  }

  const hasExtendedCols = window.stockTransfersState.inventoryColsVerified === true;

  if (invRow) {
    const newPhys = Math.max(0, (Number(invRow.quantity) || 0) + deltaPhysical);
    const updatePayload = { quantity: newPhys };

    if (hasExtendedCols) {
      updatePayload.transfer_reserved_quantity = Math.max(0, (Number(invRow.transfer_reserved_quantity) || 0) + deltaTransferRes);
      updatePayload.in_transit_quantity = Math.max(0, (Number(invRow.in_transit_quantity) || 0) + deltaInTransit);
    }

    const { error: updErr } = await supabase
      .from('inventory')
      .update(updatePayload)
      .eq('id', invRow.id);

    if (updErr) throw updErr;
  } else {
    const newPhys = Math.max(0, deltaPhysical);
    const insertPayload = {
      product_id: productId,
      warehouse_id: warehouseId,
      quantity: newPhys
    };
    if (hasExtendedCols) {
      insertPayload.transfer_reserved_quantity = Math.max(0, deltaTransferRes);
      insertPayload.in_transit_quantity = Math.max(0, deltaInTransit);
    }

    const { error: insErr } = await supabase
      .from('inventory')
      .insert([insertPayload]);

    if (insErr) {
      const errMsg = String(insErr.message || '').toLowerCase();
      if (String(insErr.code) === '23505' || errMsg.includes('duplicate key') || errMsg.includes('unique constraint')) {
        // Si otra petición concurrente creó o ya existía la fila para (product_id, warehouse_id), actualizarla en su lugar
        const { data: existingRow } = await supabase
          .from('inventory')
          .select(hasExtendedCols ? 'id, quantity, transfer_reserved_quantity, in_transit_quantity' : 'id, quantity')
          .eq('product_id', productId)
          .eq('warehouse_id', warehouseId)
          .limit(1)
          .maybeSingle();

        if (existingRow) {
          const fallbackUpdate = {
            quantity: Math.max(0, (Number(existingRow.quantity) || 0) + deltaPhysical)
          };
          if (hasExtendedCols) {
            fallbackUpdate.transfer_reserved_quantity = Math.max(0, (Number(existingRow.transfer_reserved_quantity) || 0) + deltaTransferRes);
            fallbackUpdate.in_transit_quantity = Math.max(0, (Number(existingRow.in_transit_quantity) || 0) + deltaInTransit);
          }
          const { error: fallbackUpdErr } = await supabase
            .from('inventory')
            .update(fallbackUpdate)
            .eq('id', existingRow.id);
          if (fallbackUpdErr) throw fallbackUpdErr;
          return;
        }
      }
      throw insErr;
    }
  }
}

/**
 * Inserta movimientos en el Kardex oficial (public.movements) con soporte resiliente de columnas
 */
async function insertKardexMovements(movementRows) {
  if (!Array.isArray(movementRows) || movementRows.length === 0) return;

  const validRows = movementRows.filter(r => r && Number(r.quantity) > 0);
  if (validRows.length === 0) return;

  if (window.stockTransfersState.movementsColsVerified !== false) {
    const { error } = await supabase.from('movements').insert(validRows);
    if (!error) {
      window.stockTransfersState.movementsColsVerified = true;
      return;
    }
    window.stockTransfersState.movementsColsVerified = false;
  }

  // Fallback sin transfer_id / created_by_name si la migración SQL aún no se corrió
  const basicRows = validRows.map(r => ({
    product_id: r.product_id,
    warehouse_id: r.warehouse_id,
    type: r.type,
    quantity: r.quantity,
    date: r.date || new Date().toISOString(),
    reference_doc: r.reference_doc
  }));

  const { error: basicErr } = await supabase.from('movements').insert(basicRows);
  if (basicErr) throw basicErr;
}

/**
 * Notifica y refresca los cachés de inventario en WMS tras cualquier cambio de estado de transferencia
 */
async function notifyInventoryChangeAfterTransfer(commerce, affectedProductIds = []) {
  await fetchAllStockTransfers(true);

  if (commerce && window.adminInventoryCommerceCache && window.adminInventoryCommerceCache[commerce]) {
    delete window.adminInventoryCommerceCache[commerce];
  }

  if (typeof window.refreshAdminInventoryAfterChange === 'function' && window.activeAdminInventoryCommerce === commerce) {
    try {
      await window.refreshAdminInventoryAfterChange(commerce, affectedProductIds);
    } catch (e) {
      console.warn('[StockTransfers] Error refrescando inventario tras traslado:', e);
    }
  }
}

/**
 * 1. CREAR NUEVA SOLICITUD O TRASLADO ENTRE BODEGAS
 * Soporta 3 estados iniciales:
 *  - 'Solicitada' (Reserva stock en bodega de origen, descontando de Disponible)
 *  - 'En Tránsito' (Descuenta físico de origen + Kardex OUT, suma a En Tránsito en destino)
 *  - 'Recepcionada' (Traspaso Directo 1-Paso: descuenta físico de origen + Kardex OUT, suma físico en destino + Kardex IN)
 */
export async function createStockTransferOrder({
  comercio,
  sourceWarehouseId,
  sourceWarehouseName,
  destWarehouseId,
  destWarehouseName,
  initialStatus = 'Solicitada',
  priority = 'Normal',
  title = '',
  notes = '',
  carrierInfo = '',
  packageCount = 1,
  requestedByName = '',
  dispatchedByName = '',
  receivedByName = '',
  items = []
}) {
  if (!comercio) throw new Error('Debes especificar el comercio.');
  if (!sourceWarehouseId || !destWarehouseId) throw new Error('Debes seleccionar bodega de origen y bodega de destino.');
  if (String(sourceWarehouseId) === String(destWarehouseId)) throw new Error('La bodega de origen y destino deben ser diferentes.');

  const validItems = (items || []).filter(i => i && i.product_id && Number(i.qty || i.quantity_requested || 0) > 0);
  if (validItems.length === 0) throw new Error('Debes incluir al menos un producto con cantidad mayor a 0.');

  const adminUser = await resolveCurrentAdminIdentity();
  const reqActor = (requestedByName || adminUser.name || 'Administrador').trim();
  const dispActor = initialStatus !== 'Solicitada' ? ((dispatchedByName || reqActor).trim()) : null;
  const recActor = initialStatus === 'Recepcionada' ? ((receivedByName || reqActor).trim()) : null;
  const nowIso = new Date().toISOString();

  const totalSkus = validItems.length;
  const totalUnits = validItems.reduce((acc, i) => acc + Number(i.qty || i.quantity_requested || 0), 0);

  let modeLabel = 'Solicitud con Reserva en Origen';
  if (initialStatus === 'En Tránsito') modeLabel = 'Despacho Inmediato a Ruta (En Tránsito)';
  if (initialStatus === 'Recepcionada') modeLabel = 'Traspaso Directo 1-Paso (Recepción Inmediata)';

  const initialHistory = [
    {
      timestamp: nowIso,
      actor: reqActor,
      action: 'created',
      status: initialStatus,
      detail: `Transferencia creada en modalidad "${modeLabel}" (${totalSkus} SKUs · ${totalUnits} uds) desde ${sourceWarehouseName} hacia ${destWarehouseName}.${notes ? ' Nota: ' + notes : ''}`
    }
  ];

  if (initialStatus === 'En Tránsito') {
    initialHistory.push({
      timestamp: nowIso,
      actor: dispActor,
      action: 'dispatched',
      status: 'En Tránsito',
      detail: `Salida física registrada en ${sourceWarehouseName} (-${totalUnits} uds en Kardex). Unidades en tránsito hacia ${destWarehouseName}.`
    });
  } else if (initialStatus === 'Recepcionada') {
    initialHistory.push({
      timestamp: nowIso,
      actor: recActor,
      action: 'received',
      status: 'Recepcionada',
      detail: `Traspaso directo completado: -${totalUnits} uds en ${sourceWarehouseName} y +${totalUnits} uds recepcionadas en ${destWarehouseName} (Kardex sincronizado).`
    });
  }

  let createdTransfer = null;

  // Intentar insertar en public.stock_transfers
  const headerInsert = {
    comercio,
    source_warehouse_id: sourceWarehouseId,
    source_warehouse_name: sourceWarehouseName,
    dest_warehouse_id: destWarehouseId,
    dest_warehouse_name: destWarehouseName,
    status: initialStatus,
    priority: priority || 'Normal',
    execution_mode: initialStatus === 'Recepcionada' ? 'direct_hub' : 'standard',
    title: title || notes || `Traslado ${sourceWarehouseName} → ${destWarehouseName}`,
    notes: notes || '',
    reception_notes: initialStatus === 'Recepcionada' ? 'Recepción automática (Traspaso Directo 1-Paso)' : '',
    carrier_info: carrierInfo || '',
    package_count: Number(packageCount) || 1,
    discrepancy_policy: 'return_origin',
    total_skus: totalSkus,
    total_requested: totalUnits,
    total_sent: totalUnits,
    total_received: initialStatus === 'Recepcionada' ? totalUnits : 0,
    requested_by_id: adminUser.id || null,
    requested_by_name: reqActor,
    requested_at: nowIso,
    dispatched_by_id: initialStatus !== 'Solicitada' ? (adminUser.id || null) : null,
    dispatched_by_name: dispActor,
    dispatched_at: initialStatus !== 'Solicitada' ? nowIso : null,
    received_by_id: initialStatus === 'Recepcionada' ? (adminUser.id || null) : null,
    received_by_name: recActor,
    received_at: initialStatus === 'Recepcionada' ? nowIso : null,
    history: initialHistory
  };

  const { data: dbHeader, error: dbHeaderErr } = await supabase
    .from('stock_transfers')
    .insert([headerInsert])
    .select('*')
    .maybeSingle();

  if (!dbHeaderErr && dbHeader) {
    const itemsInsert = validItems.map(i => {
      const q = Number(i.qty || i.quantity_requested || 0);
      return {
        transfer_id: dbHeader.id,
        product_id: i.product_id,
        sku: i.sku || 'S/SKU',
        product_name: i.name || i.product_name || 'Producto',
        quantity_requested: q,
        quantity_sent: q,
        quantity_received: initialStatus === 'Recepcionada' ? q : 0,
        quantity_returned_origin: 0,
        discrepancy_type: 'none',
        dest_location_hint: i.dest_location_hint || ''
      };
    });

    const { data: dbItems, error: dbItemsErr } = await supabase
      .from('stock_transfer_items')
      .insert(itemsInsert)
      .select('*');

    if (dbItemsErr) throw dbItemsErr;
    createdTransfer = { ...dbHeader, items: dbItems || itemsInsert };
  } else {
    // Fallback local resiliente si la tabla aún no fue creada en SQL Editor
    const existingLocal = loadLocalTransfersBackup();
    const folio = generateNextLocalFolio(existingLocal);
    const localId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('trf-' + Date.now());
    const localItems = validItems.map((i, idx) => {
      const q = Number(i.qty || i.quantity_requested || 0);
      return {
        id: `${localId}-item-${idx}`,
        transfer_id: localId,
        product_id: i.product_id,
        sku: i.sku || 'S/SKU',
        product_name: i.name || i.product_name || 'Producto',
        quantity_requested: q,
        quantity_sent: q,
        quantity_received: initialStatus === 'Recepcionada' ? q : 0,
        quantity_returned_origin: 0,
        discrepancy_type: 'none',
        dest_location_hint: i.dest_location_hint || ''
      };
    });

    createdTransfer = {
      id: localId,
      folio,
      ...headerInsert,
      items: localItems,
      created_at: nowIso,
      updated_at: nowIso,
      _isLocalOnly: true
    };
    existingLocal.unshift(createdTransfer);
    saveLocalTransfersBackup(existingLocal);
  }

  const folioCode = createdTransfer.folio;
  const affectedProductIds = [];
  const kardexRows = [];

  // Aplicar impacto en niveles de stock por cada ítem en lotes concurrentes
  const concurrency = 8;
  for (let i = 0; i < createdTransfer.items.length; i += concurrency) {
    const batch = createdTransfer.items.slice(i, i + concurrency);
    await Promise.all(batch.map(async (item) => {
      const qty = Number(item.quantity_requested || 0);
      if (qty <= 0) return;
      affectedProductIds.push(item.product_id);

      if (initialStatus === 'Solicitada') {
        // Estado 'Solicitada': Reserva stock en bodega de origen
        await adjustWarehouseInventoryBalances(sourceWarehouseId, item.product_id, {
          physical: 0,
          transferReserved: qty,
          inTransit: 0
        });
      } else if (initialStatus === 'En Tránsito') {
        // Estado 'En Tránsito': Descuenta físico de origen y suma a En Tránsito en destino
        await Promise.all([
          adjustWarehouseInventoryBalances(sourceWarehouseId, item.product_id, {
            physical: -qty,
            transferReserved: 0,
            inTransit: 0
          }),
          adjustWarehouseInventoryBalances(destWarehouseId, item.product_id, {
            physical: 0,
            transferReserved: 0,
            inTransit: qty
          })
        ]);

        kardexRows.push({
          product_id: item.product_id,
          warehouse_id: sourceWarehouseId,
          type: 'out',
          quantity: qty,
          date: nowIso,
          transfer_id: createdTransfer._isLocalOnly ? null : createdTransfer.id,
          created_by_name: dispActor,
          reference_doc: `[#${folioCode}] Traslado en tránsito a ${destWarehouseName} · Solicitó: ${reqActor} · Despachó: ${dispActor}${notes ? ' · Nota: ' + notes : ''}`
        });
      } else if (initialStatus === 'Recepcionada') {
        // Estado 'Recepcionada' (1-Paso): Descuenta físico en origen y suma físico en destino
        await Promise.all([
          adjustWarehouseInventoryBalances(sourceWarehouseId, item.product_id, {
            physical: -qty,
            transferReserved: 0,
            inTransit: 0
          }),
          adjustWarehouseInventoryBalances(destWarehouseId, item.product_id, {
            physical: qty,
            transferReserved: 0,
            inTransit: 0
          })
        ]);

        kardexRows.push(
          {
            product_id: item.product_id,
            warehouse_id: sourceWarehouseId,
            type: 'out',
            quantity: qty,
            date: nowIso,
            transfer_id: createdTransfer._isLocalOnly ? null : createdTransfer.id,
            created_by_name: dispActor,
            reference_doc: `[#${folioCode}] Salida por traslado directo a ${destWarehouseName} · Solicitó: ${reqActor}${notes ? ' · Nota: ' + notes : ''}`
          },
          {
            product_id: item.product_id,
            warehouse_id: destWarehouseId,
            type: 'in',
            quantity: qty,
            date: nowIso,
            transfer_id: createdTransfer._isLocalOnly ? null : createdTransfer.id,
            created_by_name: recActor,
            reference_doc: `[#${folioCode}] Recepción de traslado desde ${sourceWarehouseName} · Recepcionó: ${recActor}${notes ? ' · Nota: ' + notes : ''}`
          }
        );
      }
    }));
  }

  if (kardexRows.length > 0) {
    await insertKardexMovements(kardexRows);
  }

  await notifyInventoryChangeAfterTransfer(comercio, affectedProductIds);
  return createdTransfer;
}
window.createStockTransferOrder = createStockTransferOrder;

/**
 * 2. DESPACHAR SOLICITUD A RUTA ('Solicitada' -> 'En Tránsito')
 */
export async function dispatchStockTransferOrder({
  transferId,
  itemsSentMap = {}, // { product_id: quantity_sent }
  dispatchedByName = '',
  carrierInfo = '',
  packageCount = null,
  notes = ''
}) {
  const list = await fetchAllStockTransfers(false);
  const transfer = list.find(t => String(t.id) === String(transferId) || String(t.folio) === String(transferId));
  if (!transfer) throw new Error('No se encontró la transferencia especificada.');
  if (transfer.status !== 'Solicitada') {
    throw new Error(`Solo se pueden despachar transferencias en estado "Solicitada" (estado actual: ${transfer.status}).`);
  }

  const adminUser = await resolveCurrentAdminIdentity();
  const dispActor = (dispatchedByName || adminUser.name || 'Jefe de Bodega').trim();
  const nowIso = new Date().toISOString();
  const affectedProductIds = [];
  const kardexRows = [];

  let totalSent = 0;
  const updatedItems = [];

  for (const item of (transfer.items || [])) {
    const reqQty = Number(item.quantity_requested || 0);
    const sentQty = itemsSentMap[item.product_id] !== undefined
      ? Math.max(0, Number(itemsSentMap[item.product_id]))
      : reqQty;

    totalSent += sentQty;
    affectedProductIds.push(item.product_id);

    // 1. En Bodega Origen: liberar reserva (reqQty) y descontar físico (sentQty)
    await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
      physical: -sentQty,
      transferReserved: -reqQty,
      inTransit: 0
    });

    // 2. En Bodega Destino: sumar a Stock en Tránsito (sentQty)
    if (sentQty > 0) {
      await adjustWarehouseInventoryBalances(transfer.dest_warehouse_id, item.product_id, {
        physical: 0,
        transferReserved: 0,
        inTransit: sentQty
      });

      kardexRows.push({
        product_id: item.product_id,
        warehouse_id: transfer.source_warehouse_id,
        type: 'out',
        quantity: sentQty,
        date: nowIso,
        transfer_id: transfer._isLocalOnly ? null : transfer.id,
        created_by_name: dispActor,
        reference_doc: `[#${transfer.folio}] Salida en tránsito hacia ${transfer.dest_warehouse_name} · Despachó: ${dispActor}${notes ? ' · Nota: ' + notes : ''}`
      });
    }

    const updatedItem = { ...item, quantity_sent: sentQty };
    updatedItems.push(updatedItem);

    if (!transfer._isLocalOnly && item.id) {
      await supabase
        .from('stock_transfer_items')
        .update({ quantity_sent: sentQty })
        .eq('id', item.id);
    }
  }

  if (kardexRows.length > 0) {
    await insertKardexMovements(kardexRows);
  }

  const newHistory = [
    ...(Array.isArray(transfer.history) ? transfer.history : []),
    {
      timestamp: nowIso,
      actor: dispActor,
      action: 'dispatched',
      status: 'En Tránsito',
      detail: `Despachado a Ruta desde ${transfer.source_warehouse_name} (${totalSent} uds enviadas hacia ${transfer.dest_warehouse_name}). Kardex de salida generado.${notes ? ' Nota: ' + notes : ''}`
    }
  ];

  const headerUpdates = {
    status: 'En Tránsito',
    total_sent: totalSent,
    dispatched_by_id: adminUser.id || null,
    dispatched_by_name: dispActor,
    dispatched_at: nowIso,
    carrier_info: carrierInfo || transfer.carrier_info || '',
    package_count: packageCount !== null ? Number(packageCount) : (transfer.package_count || 1),
    history: newHistory
  };

  if (!transfer._isLocalOnly) {
    const { error: uErr } = await supabase
      .from('stock_transfers')
      .update(headerUpdates)
      .eq('id', transfer.id);
    if (uErr) throw uErr;
  } else {
    const localList = loadLocalTransfersBackup();
    const idx = localList.findIndex(x => String(x.id) === String(transfer.id));
    if (idx >= 0) {
      localList[idx] = { ...localList[idx], ...headerUpdates, items: updatedItems, updated_at: nowIso };
      saveLocalTransfersBackup(localList);
    }
  }

  await notifyInventoryChangeAfterTransfer(transfer.comercio, affectedProductIds);
  return { ...transfer, ...headerUpdates, items: updatedItems };
}
window.dispatchStockTransferOrder = dispatchStockTransferOrder;

/**
 * 3. MARCAR COMO RECEPCIONADO EN BODEGA DESTINO ('En Tránsito' o 'Solicitada' -> 'Recepcionada' / 'Con Diferencias')
 */
export async function receiveStockTransferOrder({
  transferId,
  itemsReceivedMap = {}, // { product_id: quantity_received }
  itemsLocationMap = {}, // { product_id: dest_location_hint }
  receivedByName = '',
  discrepancyPolicy = 'return_origin', // 'return_origin' | 'incident_loss'
  receptionNotes = ''
}) {
  const list = await fetchAllStockTransfers(false);
  const transfer = list.find(t => String(t.id) === String(transferId) || String(t.folio) === String(transferId));
  if (!transfer) throw new Error('No se encontró la transferencia especificada.');
  if (transfer.status !== 'En Tránsito' && transfer.status !== 'Solicitada') {
    throw new Error(`Esta transferencia ya fue recepcionada o cancelada (estado actual: ${transfer.status}). Usa "Corregir Recepción / Ingreso" para modificarla.`);
  }

  const adminUser = await resolveCurrentAdminIdentity();
  const recActor = (receivedByName || adminUser.name || 'Encargado Recepción').trim();
  const nowIso = new Date().toISOString();
  const wasSolicitada = transfer.status === 'Solicitada';

  const affectedProductIds = [];
  const kardexRows = [];
  const updatedItems = [];
  let totalReceived = 0;
  let totalSent = 0;
  let hasDiscrepancy = false;
  const discrepancyDetails = [];

  for (const item of (transfer.items || [])) {
    const reqQty = Number(item.quantity_requested || 0);
    const sentQty = Number(item.quantity_sent || reqQty || 0);
    const recQty = itemsReceivedMap[item.product_id] !== undefined
      ? Math.max(0, Number(itemsReceivedMap[item.product_id]))
      : sentQty;
    const locHint = itemsLocationMap[item.product_id] !== undefined
      ? String(itemsLocationMap[item.product_id]).trim()
      : (item.dest_location_hint || '');

    totalSent += sentQty;
    totalReceived += recQty;
    affectedProductIds.push(item.product_id);

    // Si venía directo desde 'Solicitada' sin haber pasado por 'En Tránsito', primero rebajar de Origen
    if (wasSolicitada) {
      await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
        physical: -sentQty,
        transferReserved: -reqQty,
        inTransit: 0
      });
      if (sentQty > 0) {
        kardexRows.push({
          product_id: item.product_id,
          warehouse_id: transfer.source_warehouse_id,
          type: 'out',
          quantity: sentQty,
          date: nowIso,
          transfer_id: transfer._isLocalOnly ? null : transfer.id,
          created_by_name: recActor,
          reference_doc: `[#${transfer.folio}] Salida por traslado hacia ${transfer.dest_warehouse_name} · Autorizó: ${recActor}`
        });
      }
    }

    // En Bodega Destino: limpiar in_transit_quantity y sumar recQty al Stock Físico
    await adjustWarehouseInventoryBalances(transfer.dest_warehouse_id, item.product_id, {
      physical: recQty,
      transferReserved: 0,
      inTransit: wasSolicitada ? 0 : -sentQty
    });

    if (recQty > 0) {
      kardexRows.push({
        product_id: item.product_id,
        warehouse_id: transfer.dest_warehouse_id,
        type: 'in',
        quantity: recQty,
        date: nowIso,
        transfer_id: transfer._isLocalOnly ? null : transfer.id,
        created_by_name: recActor,
        reference_doc: `[#${transfer.folio}] Recepción de traslado desde ${transfer.source_warehouse_name} · Recepcionó: ${recActor}${receptionNotes ? ' · Nota: ' + receptionNotes : ''}`
      });
    }

    // Evaluar diferencias entre lo enviado y lo recepcionado
    const diff = recQty - sentQty;
    let returnedOriginQty = 0;
    let discType = 'none';

    if (diff !== 0) {
      hasDiscrepancy = true;
      discrepancyDetails.push(`${item.sku}: enviado ${sentQty}, recibido ${recQty} (${diff > 0 ? '+' + diff : diff})`);

      if (diff < 0) {
        const missingQty = Math.abs(diff);
        if (discrepancyPolicy === 'return_origin') {
          returnedOriginQty = missingQty;
          discType = 'return_origin';
          // Reintegrar automáticamente las unidades no enviadas a la Bodega de Origen
          await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
            physical: missingQty,
            transferReserved: 0,
            inTransit: 0
          });
          kardexRows.push({
            product_id: item.product_id,
            warehouse_id: transfer.source_warehouse_id,
            type: 'in',
            quantity: missingQty,
            date: nowIso,
            transfer_id: transfer._isLocalOnly ? null : transfer.id,
            created_by_name: recActor,
            reference_doc: `[#${transfer.folio}] Reintegro automático a ${transfer.source_warehouse_name} por diferencia en recepción (${recQty}/${sentQty} recibidas en ${transfer.dest_warehouse_name})`
          });
        } else {
          discType = 'incident_loss';
        }
      } else if (diff > 0 && discrepancyPolicy === 'return_origin') {
        // Llegaron más unidades de las declaradas: descontar el excedente de la bodega de origen
        const extraQty = diff;
        discType = 'return_origin';
        await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
          physical: -extraQty,
          transferReserved: 0,
          inTransit: 0
        });
        kardexRows.push({
          product_id: item.product_id,
          warehouse_id: transfer.source_warehouse_id,
          type: 'out',
          quantity: extraQty,
          date: nowIso,
          transfer_id: transfer._isLocalOnly ? null : transfer.id,
          created_by_name: recActor,
          reference_doc: `[#${transfer.folio}] Descuento adicional en ${transfer.source_warehouse_name} por sobrecantidad recepcionada (${recQty}/${sentQty}) en ${transfer.dest_warehouse_name}`
        });
      }
    }

    const updatedItem = {
      ...item,
      quantity_sent: sentQty,
      quantity_received: recQty,
      quantity_returned_origin: returnedOriginQty,
      discrepancy_type: discType,
      dest_location_hint: locHint
    };
    updatedItems.push(updatedItem);

    if (!transfer._isLocalOnly && item.id) {
      await supabase
        .from('stock_transfer_items')
        .update({
          quantity_sent: sentQty,
          quantity_received: recQty,
          quantity_returned_origin: returnedOriginQty,
          discrepancy_type: discType,
          dest_location_hint: locHint
        })
        .eq('id', item.id);
    }
  }

  if (kardexRows.length > 0) {
    await insertKardexMovements(kardexRows);
  }

  const finalStatus = hasDiscrepancy ? 'Con Diferencias' : 'Recepcionada';
  const policyText = discrepancyPolicy === 'return_origin'
    ? `Diferencias sincronizadas con el stock de ${transfer.source_warehouse_name}`
    : 'Diferencias registradas como incidencia/merma en tránsito';

  const newHistory = [
    ...(Array.isArray(transfer.history) ? transfer.history : []),
    {
      timestamp: nowIso,
      actor: recActor,
      action: 'received',
      status: finalStatus,
      detail: hasDiscrepancy
        ? `Recepción con Diferencias en ${transfer.dest_warehouse_name} por ${recActor}: +${totalReceived} uds ingresadas de ${totalSent} enviadas [${discrepancyDetails.join(', ')}]. ${policyText}.${receptionNotes ? ' Nota: ' + receptionNotes : ''}`
        : `Recepcionada Conforme en ${transfer.dest_warehouse_name} por ${recActor}: +${totalReceived} uds sumadas al stock físico y registradas en Kardex.${receptionNotes ? ' Nota: ' + receptionNotes : ''}`
    }
  ];

  const headerUpdates = {
    status: finalStatus,
    total_sent: totalSent,
    total_received: totalReceived,
    discrepancy_policy: discrepancyPolicy,
    reception_notes: receptionNotes || transfer.reception_notes || '',
    received_by_id: adminUser.id || null,
    received_by_name: recActor,
    received_at: nowIso,
    dispatched_by_name: transfer.dispatched_by_name || recActor,
    dispatched_at: transfer.dispatched_at || nowIso,
    history: newHistory
  };

  if (!transfer._isLocalOnly) {
    const { error: uErr } = await supabase
      .from('stock_transfers')
      .update(headerUpdates)
      .eq('id', transfer.id);
    if (uErr) throw uErr;
  } else {
    const localList = loadLocalTransfersBackup();
    const idx = localList.findIndex(x => String(x.id) === String(transfer.id));
    if (idx >= 0) {
      localList[idx] = { ...localList[idx], ...headerUpdates, items: updatedItems, updated_at: nowIso };
      saveLocalTransfersBackup(localList);
    }
  }

  await notifyInventoryChangeAfterTransfer(transfer.comercio, affectedProductIds);
  return { ...transfer, ...headerUpdates, items: updatedItems };
}
window.receiveStockTransferOrder = receiveStockTransferOrder;

/**
 * 4. EDITAR SEGÚN SU ESTADO ('Solicitada' / 'En Tránsito') O CORREGIR UN INGRESO ('Recepcionada' / 'Con Diferencias')
 * Calcula automáticamente los diferenciales matemáticos (Delta) y ajusta los saldos en ambas bodegas + Kardex.
 */
export async function editOrCorrectStockTransferOrder({
  transferId,
  updatedItemsMap = {}, // { product_id: { quantity_requested?, quantity_sent?, quantity_received?, dest_location_hint? } }
  actorName = '',
  reason = '',
  discrepancyPolicy = null,
  metadataUpdates = {} // { priority?, carrier_info?, package_count?, title?, notes? }
}) {
  if (!reason || !String(reason).trim()) {
    throw new Error('Debes ingresar un motivo u observación para respaldar la edición o corrección en la auditoría.');
  }

  const list = await fetchAllStockTransfers(false);
  const transfer = list.find(t => String(t.id) === String(transferId) || String(t.folio) === String(transferId));
  if (!transfer) throw new Error('No se encontró la transferencia.');
  if (transfer.status === 'Cancelada') throw new Error('No se puede editar una transferencia cancelada.');

  const adminUser = await resolveCurrentAdminIdentity();
  const actor = (actorName || adminUser.name || 'Supervisor WMS').trim();
  const nowIso = new Date().toISOString();
  const activePolicy = discrepancyPolicy || transfer.discrepancy_policy || 'return_origin';

  const affectedProductIds = [];
  const kardexRows = [];
  const changeLogs = [];
  const updatedItems = [];

  let totalReq = 0;
  let totalSent = 0;
  let totalRec = 0;
  let hasDiscrepancyAfter = false;

  const currentStatus = transfer.status;

  for (const item of (transfer.items || [])) {
    const patch = updatedItemsMap[item.product_id] || {};
    const locHint = patch.dest_location_hint !== undefined ? String(patch.dest_location_hint).trim() : (item.dest_location_hint || '');
    affectedProductIds.push(item.product_id);

    // CASO A: Edición en estado 'Solicitada'
    if (currentStatus === 'Solicitada') {
      const oldReq = Number(item.quantity_requested || 0);
      const newReq = patch.quantity_requested !== undefined
        ? Math.max(0, Number(patch.quantity_requested))
        : (patch.quantity_sent !== undefined ? Math.max(0, Number(patch.quantity_sent)) : oldReq);
      const deltaReq = newReq - oldReq;

      if (deltaReq !== 0) {
        await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
          physical: 0,
          transferReserved: deltaReq,
          inTransit: 0
        });
        changeLogs.push(`${item.sku}: solicitado ${oldReq} → ${newReq} (${deltaReq > 0 ? '+' + deltaReq : deltaReq} uds en reserva origen)`);
      }

      totalReq += newReq;
      totalSent += newReq;
      const newItem = { ...item, quantity_requested: newReq, quantity_sent: newReq, dest_location_hint: locHint };
      updatedItems.push(newItem);

      if (!transfer._isLocalOnly && item.id) {
        await supabase.from('stock_transfer_items').update({
          quantity_requested: newReq,
          quantity_sent: newReq,
          dest_location_hint: locHint
        }).eq('id', item.id);
      }
    }

    // CASO B: Edición en estado 'En Tránsito' (Antes de recepcionar)
    else if (currentStatus === 'En Tránsito') {
      const oldSent = Number(item.quantity_sent || 0);
      const newSent = patch.quantity_sent !== undefined ? Math.max(0, Number(patch.quantity_sent)) : oldSent;
      const deltaSent = newSent - oldSent;

      if (deltaSent !== 0) {
        // Si deltaSent > 0: descuenta más de origen y suma más a tránsito
        // Si deltaSent < 0: devuelve a origen y resta de tránsito
        await Promise.all([
          adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
            physical: -deltaSent,
            transferReserved: 0,
            inTransit: 0
          }),
          adjustWarehouseInventoryBalances(transfer.dest_warehouse_id, item.product_id, {
            physical: 0,
            transferReserved: 0,
            inTransit: deltaSent
          })
        ]);

        kardexRows.push({
          product_id: item.product_id,
          warehouse_id: transfer.source_warehouse_id,
          type: deltaSent > 0 ? 'out' : 'in',
          quantity: Math.abs(deltaSent),
          date: nowIso,
          transfer_id: transfer._isLocalOnly ? null : transfer.id,
          created_by_name: actor,
          reference_doc: deltaSent > 0
            ? `[#${transfer.folio}] Ajuste de envío en tránsito (+${deltaSent} uds enviadas hacia ${transfer.dest_warehouse_name}) · Editó: ${actor} · Motivo: ${reason}`
            : `[#${transfer.folio}] Reversión parcial de envío en tránsito (+${Math.abs(deltaSent)} uds devueltas a ${transfer.source_warehouse_name}) · Editó: ${actor} · Motivo: ${reason}`
        });

        changeLogs.push(`${item.sku}: enviado en ruta ${oldSent} → ${newSent} (${deltaSent > 0 ? '+' + deltaSent : deltaSent} uds)`);
      }

      totalReq += Number(item.quantity_requested || newSent);
      totalSent += newSent;
      const newItem = { ...item, quantity_sent: newSent, dest_location_hint: locHint };
      updatedItems.push(newItem);

      if (!transfer._isLocalOnly && item.id) {
        await supabase.from('stock_transfer_items').update({
          quantity_sent: newSent,
          dest_location_hint: locHint
        }).eq('id', item.id);
      }
    }

    // CASO C: CORRECCIÓN DE UN INGRESO / RECEPCIÓN ('Recepcionada' o 'Con Diferencias')
    else if (currentStatus === 'Recepcionada' || currentStatus === 'Con Diferencias') {
      const sentQty = patch.quantity_sent !== undefined ? Math.max(0, Number(patch.quantity_sent)) : Number(item.quantity_sent || 0);
      const oldRec = Number(item.quantity_received || 0);
      const newRec = patch.quantity_received !== undefined ? Math.max(0, Number(patch.quantity_received)) : oldRec;
      const deltaRec = newRec - oldRec;

      // 1. Ajustar diferencial en Bodega Destino + Kardex Destino
      if (deltaRec !== 0) {
        await adjustWarehouseInventoryBalances(transfer.dest_warehouse_id, item.product_id, {
          physical: deltaRec,
          transferReserved: 0,
          inTransit: 0
        });

        kardexRows.push({
          product_id: item.product_id,
          warehouse_id: transfer.dest_warehouse_id,
          type: deltaRec > 0 ? 'in' : 'out',
          quantity: Math.abs(deltaRec),
          date: nowIso,
          transfer_id: transfer._isLocalOnly ? null : transfer.id,
          created_by_name: actor,
          reference_doc: deltaRec > 0
            ? `[#${transfer.folio}] Corrección de recepción (+${deltaRec} uds sumadas en ${transfer.dest_warehouse_name}, antes ${oldRec} → ahora ${newRec}) · Corrigió: ${actor} · Motivo: ${reason}`
            : `[#${transfer.folio}] Corrección/Reversión de recepción (-${Math.abs(deltaRec)} uds descontadas en ${transfer.dest_warehouse_name}, antes ${oldRec} → ahora ${newRec}) · Corrigió: ${actor} · Motivo: ${reason}`
        });
      }

      // 2. Calcular impacto en Bodega Origen según la política de diferencias
      const oldReturnedOrigin = Number(item.quantity_returned_origin || 0);
      let newReturnedOrigin = 0;
      let newDiscType = 'none';

      if (newRec !== sentQty) {
        hasDiscrepancyAfter = true;
        if (newRec < sentQty && activePolicy === 'return_origin') {
          newReturnedOrigin = sentQty - newRec;
          newDiscType = 'return_origin';
        } else if (newRec < sentQty) {
          newDiscType = 'incident_loss';
        }
      }

      const deltaOriginReturn = newReturnedOrigin - oldReturnedOrigin;
      if (deltaOriginReturn !== 0) {
        await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
          physical: deltaOriginReturn,
          transferReserved: 0,
          inTransit: 0
        });

        kardexRows.push({
          product_id: item.product_id,
          warehouse_id: transfer.source_warehouse_id,
          type: deltaOriginReturn > 0 ? 'in' : 'out',
          quantity: Math.abs(deltaOriginReturn),
          date: nowIso,
          transfer_id: transfer._isLocalOnly ? null : transfer.id,
          created_by_name: actor,
          reference_doc: deltaOriginReturn > 0
            ? `[#${transfer.folio}] Reintegro a ${transfer.source_warehouse_name} (+${deltaOriginReturn} uds) por corrección de recepción en ${transfer.dest_warehouse_name} · Corrigió: ${actor} · Motivo: ${reason}`
            : `[#${transfer.folio}] Descuento en ${transfer.source_warehouse_name} (-${Math.abs(deltaOriginReturn)} uds) por corrección de recepción en ${transfer.dest_warehouse_name} · Corrigió: ${actor} · Motivo: ${reason}`
        });
      }

      if (deltaRec !== 0 || deltaOriginReturn !== 0) {
        changeLogs.push(`${item.sku}: recepcionado ${oldRec} → ${newRec} (${deltaRec >= 0 ? '+' + deltaRec : deltaRec} uds en ${transfer.dest_warehouse_name})`);
      }

      totalReq += Number(item.quantity_requested || sentQty);
      totalSent += sentQty;
      totalRec += newRec;

      const newItem = {
        ...item,
        quantity_sent: sentQty,
        quantity_received: newRec,
        quantity_returned_origin: newReturnedOrigin,
        discrepancy_type: newDiscType,
        dest_location_hint: locHint
      };
      updatedItems.push(newItem);

      if (!transfer._isLocalOnly && item.id) {
        await supabase.from('stock_transfer_items').update({
          quantity_sent: sentQty,
          quantity_received: newRec,
          quantity_returned_origin: newReturnedOrigin,
          discrepancy_type: newDiscType,
          dest_location_hint: locHint
        }).eq('id', item.id);
      }
    }
  }

  if (kardexRows.length > 0) {
    await insertKardexMovements(kardexRows);
  }

  let newStatus = currentStatus;
  if (currentStatus === 'Recepcionada' || currentStatus === 'Con Diferencias') {
    newStatus = hasDiscrepancyAfter ? 'Con Diferencias' : 'Recepcionada';
  }

  const isCorrection = currentStatus === 'Recepcionada' || currentStatus === 'Con Diferencias';
  const summaryText = changeLogs.length > 0 ? changeLogs.join(' | ') : 'Actualización de metadatos / ubicación';

  const newHistory = [
    ...(Array.isArray(transfer.history) ? transfer.history : []),
    {
      timestamp: nowIso,
      actor,
      action: isCorrection ? 'corrected_reception' : 'edited',
      status: newStatus,
      detail: `${isCorrection ? 'CORRECCIÓN DE INGRESO / RECEPCIÓN' : 'Edición en estado "' + currentStatus + '"'} ejecutada por ${actor}: ${summaryText}. Motivo: ${reason}`
    }
  ];

  const headerUpdates = {
    status: newStatus,
    total_requested: totalReq,
    total_sent: totalSent,
    total_received: isCorrection ? totalRec : transfer.total_received,
    discrepancy_policy: activePolicy,
    last_edited_by_name: actor,
    last_edited_at: nowIso,
    priority: metadataUpdates.priority || transfer.priority || 'Normal',
    carrier_info: metadataUpdates.carrier_info !== undefined ? metadataUpdates.carrier_info : (transfer.carrier_info || ''),
    package_count: metadataUpdates.package_count !== undefined ? Number(metadataUpdates.package_count) : (transfer.package_count || 1),
    title: metadataUpdates.title !== undefined ? metadataUpdates.title : (transfer.title || ''),
    notes: metadataUpdates.notes !== undefined ? metadataUpdates.notes : (transfer.notes || ''),
    history: newHistory
  };

  if (!transfer._isLocalOnly) {
    const { error: uErr } = await supabase
      .from('stock_transfers')
      .update(headerUpdates)
      .eq('id', transfer.id);
    if (uErr) throw uErr;
  } else {
    const localList = loadLocalTransfersBackup();
    const idx = localList.findIndex(x => String(x.id) === String(transfer.id));
    if (idx >= 0) {
      localList[idx] = { ...localList[idx], ...headerUpdates, items: updatedItems, updated_at: nowIso };
      saveLocalTransfersBackup(localList);
    }
  }

  await notifyInventoryChangeAfterTransfer(transfer.comercio, affectedProductIds);
  return { ...transfer, ...headerUpdates, items: updatedItems };
}
window.editOrCorrectStockTransferOrder = editOrCorrectStockTransferOrder;

/**
 * 5. CANCELAR / ANULAR TRANSFERENCIA ('Solicitada' o 'En Tránsito' -> 'Cancelada')
 */
export async function cancelStockTransferOrder(transferId, actorName = '', reason = '') {
  const list = await fetchAllStockTransfers(false);
  const transfer = list.find(t => String(t.id) === String(transferId) || String(t.folio) === String(transferId));
  if (!transfer) throw new Error('No se encontró la transferencia.');
  if (transfer.status === 'Cancelada') throw new Error('La transferencia ya está cancelada.');
  if (transfer.status === 'Recepcionada' || transfer.status === 'Con Diferencias') {
    throw new Error('Una transferencia ya recepcionada no se cancela directamente; utiliza "Corregir Recepción / Ingreso" para revertir unidades.');
  }

  const adminUser = await resolveCurrentAdminIdentity();
  const actor = (actorName || adminUser.name || 'Administrador').trim();
  const nowIso = new Date().toISOString();
  const prevStatus = transfer.status;
  const affectedProductIds = [];
  const kardexRows = [];

  for (const item of (transfer.items || [])) {
    affectedProductIds.push(item.product_id);
    if (prevStatus === 'Solicitada') {
      const reqQty = Number(item.quantity_requested || 0);
      if (reqQty > 0) {
        await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
          physical: 0,
          transferReserved: -reqQty,
          inTransit: 0
        });
      }
    } else if (prevStatus === 'En Tránsito') {
      const sentQty = Number(item.quantity_sent || 0);
      if (sentQty > 0) {
        await Promise.all([
          adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
            physical: sentQty,
            transferReserved: 0,
            inTransit: 0
          }),
          adjustWarehouseInventoryBalances(transfer.dest_warehouse_id, item.product_id, {
            physical: 0,
            transferReserved: 0,
            inTransit: -sentQty
          })
        ]);

        kardexRows.push({
          product_id: item.product_id,
          warehouse_id: transfer.source_warehouse_id,
          type: 'in',
          quantity: sentQty,
          date: nowIso,
          transfer_id: transfer._isLocalOnly ? null : transfer.id,
          created_by_name: actor,
          reference_doc: `[#${transfer.folio}] Reintegro a ${transfer.source_warehouse_name} por anulación de traslado en tránsito · Anuló: ${actor}${reason ? ' · Motivo: ' + reason : ''}`
        });
      }
    }
  }

  if (kardexRows.length > 0) {
    await insertKardexMovements(kardexRows);
  }

  const newHistory = [
    ...(Array.isArray(transfer.history) ? transfer.history : []),
    {
      timestamp: nowIso,
      actor,
      action: 'cancelled',
      status: 'Cancelada',
      detail: prevStatus === 'En Tránsito'
        ? `Transferencia en tránsito anulada por ${actor}. Se reintegraron +${transfer.total_sent} uds al stock físico de ${transfer.source_warehouse_name} (Kardex IN). Motivo: ${reason || 'Cancelación administrativa'}`
        : `Solicitud de transferencia cancelada por ${actor}. Reserva de ${transfer.total_requested} uds liberada en ${transfer.source_warehouse_name}. Motivo: ${reason || 'Cancelación administrativa'}`
    }
  ];

  const headerUpdates = {
    status: 'Cancelada',
    last_edited_by_name: actor,
    last_edited_at: nowIso,
    history: newHistory
  };

  if (!transfer._isLocalOnly) {
    const { error: uErr } = await supabase
      .from('stock_transfers')
      .update(headerUpdates)
      .eq('id', transfer.id);
    if (uErr) throw uErr;
  } else {
    const localList = loadLocalTransfersBackup();
    const idx = localList.findIndex(x => String(x.id) === String(transfer.id));
    if (idx >= 0) {
      localList[idx] = { ...localList[idx], ...headerUpdates, updated_at: nowIso };
      saveLocalTransfersBackup(localList);
    }
  }

  await notifyInventoryChangeAfterTransfer(transfer.comercio, affectedProductIds);
  return { ...transfer, ...headerUpdates };
}
window.cancelStockTransferOrder = cancelStockTransferOrder;

/**
 * 6. REVERTIR Y ELIMINAR UNA TRANSFERENCIA (Ej. Movimientos duplicados o creados por error)
 *    - Si revertStock === true: devuelve las unidades a la bodega de origen, las descuenta de la bodega de destino
 *      y elimina las filas asociadas en public.movements ([ #TRF-XXXX ]).
 *    - Elimina el registro de stock_transfers / respaldo local.
 */
export async function revertAndDeleteStockTransferOrder(transferId, revertStock = true) {
  const list = await fetchAllStockTransfers(false);
  const transfer = list.find(t => String(t.id) === String(transferId) || String(t.folio) === String(transferId));
  if (!transfer) throw new Error('No se encontró la transferencia a eliminar.');

  const items = Array.isArray(transfer.items) ? transfer.items : [];
  const affectedProductIds = items.map(it => it.product_id).filter(Boolean);

  if (revertStock && transfer.status !== 'Cancelada') {
    const concurrency = 8;
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      await Promise.all(batch.map(async (item) => {
        const reqQty = Number(item.quantity_requested || 0);
        const sentQty = Number(item.quantity_sent ?? reqQty);
        const recQty = Number(item.quantity_received ?? sentQty);
        const retOrigin = Number(item.quantity_returned_origin || 0);

        if (transfer.status === 'Solicitada' && reqQty > 0) {
          await adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
            physical: 0,
            transferReserved: -reqQty,
            inTransit: 0
          });
        } else if (transfer.status === 'En Tránsito' && sentQty > 0) {
          await Promise.all([
            adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
              physical: sentQty,
              transferReserved: 0,
              inTransit: 0
            }),
            adjustWarehouseInventoryBalances(transfer.dest_warehouse_id, item.product_id, {
              physical: 0,
              transferReserved: 0,
              inTransit: -sentQty
            })
          ]);
        } else if ((transfer.status === 'Recepcionada' || transfer.status === 'Con Diferencias')) {
          const netDeductedFromOrigin = Math.max(0, sentQty - retOrigin);
          await Promise.all([
            netDeductedFromOrigin > 0
              ? adjustWarehouseInventoryBalances(transfer.source_warehouse_id, item.product_id, {
                  physical: netDeductedFromOrigin,
                  transferReserved: 0,
                  inTransit: 0
                })
              : Promise.resolve(),
            recQty > 0
              ? adjustWarehouseInventoryBalances(transfer.dest_warehouse_id, item.product_id, {
                  physical: -recQty,
                  transferReserved: 0,
                  inTransit: 0
                })
              : Promise.resolve()
          ]);
        }
      }));
    }

    // Limpiar movimientos de Kardex asociados a este folio usando el índice product_id
    if (affectedProductIds.length > 0 && transfer.folio) {
      try {
        const { data: movs } = await supabase
          .from('movements')
          .select('id, reference_doc')
          .in('product_id', affectedProductIds)
          .ilike('reference_doc', `%[#${transfer.folio}]%`);

        const movIds = (movs || []).map(m => m.id).filter(Boolean);
        if (movIds.length > 0) {
          await supabase.from('movements').delete().in('id', movIds);
        }
      } catch (e) {
        console.warn('[StockTransfers] No se pudieron limpiar movimientos Kardex del duplicado:', e);
      }
    }
  }

  // Eliminar de Supabase si existe tabla o de localStorage
  if (!transfer._isLocalOnly) {
    try {
      await supabase.from('stock_transfer_items').delete().eq('transfer_id', transfer.id);
      await supabase.from('stock_transfers').delete().eq('id', transfer.id);
    } catch (e) {
      console.warn('[StockTransfers] Error eliminando fila en Supabase:', e);
    }
  }

  const localList = loadLocalTransfersBackup().filter(
    x => String(x.id) !== String(transfer.id) && String(x.folio) !== String(transfer.folio)
  );
  saveLocalTransfersBackup(localList);

  await notifyInventoryChangeAfterTransfer(transfer.comercio, affectedProductIds);
  return true;
}
window.revertAndDeleteStockTransferOrder = revertAndDeleteStockTransferOrder;

const RESTORED_1004_FLAG_KEY = 'stocka_wms_trf_1004_restored_v1';

const TRF_1004_RECOVERY_ITEMS = [
  { product_id: 'd5b5045a-1f6f-43bb-b1ec-56629ebca9f1', sku: 'lutaiblanca34', product_name: 'Lutai Blanca - 34', qty: 3 },
  { product_id: 'fe89ae1f-0c7c-4d05-83e6-3f348b7ff685', sku: 'lutaiblanca35', product_name: 'Lutai Blanca - 35', qty: 3 },
  { product_id: '50c0acbe-a5a6-4cc9-abe7-f694eb28dff6', sku: 'lutainegra35', product_name: 'Lutai Negra - 35', qty: 3 },
  { product_id: 'eff9a197-88c3-4da1-b7d9-38bda9494517', sku: 'lutainegra36', product_name: 'Lutai Negra - 36', qty: 2 },
  { product_id: 'e4ac712d-67e2-41d6-91f5-a29511b2efe7', sku: 'lutaigris37', product_name: 'Lutai Gris - 37', qty: 1 },
  { product_id: 'cd2782c8-74a4-4786-b558-46cb6f1963af', sku: 'lutaigris38', product_name: 'Lutai Gris - 38', qty: 3 },
  { product_id: '39b13537-5e8e-4ca4-9b23-81b9d000f269', sku: 'lutainegra38', product_name: 'Lutai Negra - 38', qty: 3 },
  { product_id: '374b8dca-1de8-4cf7-a3cd-1fc0d1862fe0', sku: 'lutaiblanca39', product_name: 'Lutai Blanca - 39', qty: 1 },
  { product_id: 'ec1f5617-66c7-4a75-af6d-d5c4ab7a3cf8', sku: 'lutaigris40', product_name: 'Lutai Gris - 40', qty: 2 },
  { product_id: 'b88f9f6a-6f9b-4c5e-971a-95a02077d674', sku: 'lutainegra40', product_name: 'Lutai Negra - 40', qty: 3 },
  { product_id: '84cb4a4f-ad35-4c9b-b322-79bac37935b9', sku: 'lutaigris41', product_name: 'Lutai Gris - 41', qty: 3 },
  { product_id: 'df5c90cf-63f0-4b13-bc62-923897403a7d', sku: 'lutainegra41', product_name: 'Lutai Negra - 41', qty: 3 },
  { product_id: '7fcc68b5-7aa3-4124-9e8f-6345ec2bc5ff', sku: 'lutaiblanca42', product_name: 'Lutai Blanca - 42', qty: 3 },
  { product_id: 'ff10ffa6-7810-45ee-ab87-f2ccd2cbdd36', sku: 'lutaigris42', product_name: 'Lutai Gris - 42', qty: 2 },
  { product_id: '1b6ee8c6-d6c7-4dd4-bd09-f86664fc41f7', sku: 'lutainegra42', product_name: 'Lutai Negra - 42', qty: 3 },
  { product_id: '8f56efd3-f6a4-43e6-8557-f2a3b892382f', sku: 'lutaiblanca43', product_name: 'Lutai Blanca - 43', qty: 3 },
  { product_id: '6da5b107-d66f-408b-8dba-0bdc3d427124', sku: 'lutainegra43', product_name: 'Lutai Negra - 43', qty: 3 },
  { product_id: '085a9d3e-222b-42bd-9e1f-951b6aca1f4b', sku: 'lutaiblanca44', product_name: 'Lutai Blanca - 44', qty: 3 },
  { product_id: 'b8048275-2f66-44f1-8b77-94864cad94b2', sku: 'lutaigris44', product_name: 'Lutai Gris - 44', qty: 1 },
  { product_id: '0339e252-550a-4032-adb7-e726198cb67f', sku: 'lutaiblanca45', product_name: 'Lutai Blanca - 45', qty: 3 },
  { product_id: '7bbacace-6d54-4e10-9732-d90d4e5cf849', sku: 'lutaigris45', product_name: 'Lutai Gris - 45', qty: 3 },
  { product_id: '01a4c691-da85-4b6d-9372-7d7a2c04f6eb', sku: 'lutaiblanca46', product_name: 'Lutai Blanca - 46', qty: 3 },
  { product_id: 'bfa9bb13-d704-4acf-b0c1-21a91bdb19cc', sku: 'lutaigris46', product_name: 'Lutai Gris - 46', qty: 3 },
  { product_id: '626b4d14-154f-4756-94de-2848262c9409', sku: 'lutainegra46', product_name: 'Lutai Negra - 46', qty: 2 },
  { product_id: 'd3c4823e-941e-4fdb-9e63-e07c1247dacc', sku: 'lutaiblanca47', product_name: 'Lutai Blanca - 47', qty: 3 },
  { product_id: '51f8e767-358f-467e-83a5-f430a79344b0', sku: 'lutaigris47', product_name: 'Lutai Gris - 47', qty: 3 },
  { product_id: '404e483b-c828-47f7-a321-71fac0350963', sku: 'lutainegra47', product_name: 'Lutai Negra - 47', qty: 1 },
  { product_id: 'e17f6a26-8d66-4241-9b05-4c8892bca5b7', sku: 'lutaiwipes', product_name: 'Limpia Zapatillas', qty: 3 }
];

/**
 * Restaura por única vez la transferencia #TRF-1004 (LUTAI · CDD La Reina -> Matriz Ñuñoa · 28 SKUs · 72 uds)
 * en caso de que se hayan eliminado tanto #TRF-1004 como #TRF-1005 al limpiar el duplicado.
 */
async function ensureTransfer1004Restored(transfersList) {
  const list = Array.isArray(transfersList) ? transfersList : [];
  const exists1004 = list.some(t => String(t.folio || '').toUpperCase() === 'TRF-1004');
  const exists1005 = list.some(t => String(t.folio || '').toUpperCase() === 'TRF-1005');

  if (exists1004 || exists1005) {
    return list;
  }

  try {
    if (localStorage.getItem(RESTORED_1004_FLAG_KEY) === 'true') {
      return list;
    }
  } catch (e) {}

  try {
    const sourceWarehouseId = '414605cb-f926-43d2-8bd2-d9509f7b458a';
    const sourceWarehouseName = 'CDD La Reina';
    const destWarehouseId = '973da888-8a63-4790-a08f-919e1af41a93';
    const destWarehouseName = 'Matriz Ñuñoa';
    const createdAtIso = '2026-11-11T00:32:00.000Z'; // 10 nov 2026, 09:32 p. m. CL
    const noteText = 'ajuste consolidado para establecer stock base en Matriz Ñuñoa';
    const actor = 'Stocka';

    // 1. Verificar el estado actual de public.inventory en Matriz Ñuñoa para saber si el stock necesita aplicarse
    let shouldApplyInventoryDeltas = true;
    try {
      const pids = TRF_1004_RECOVERY_ITEMS.map(it => it.product_id);
      const { data: destRows } = await supabase
        .from('inventory')
        .select('product_id, quantity')
        .eq('warehouse_id', destWarehouseId)
        .in('product_id', pids);

      if (Array.isArray(destRows) && destRows.length > 0) {
        const currentDestSum = destRows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
        // Antes de #TRF-1004 esos 28 SKUs sumaban ~12-18 uds en Matriz Ñuñoa; con #TRF-1004 aplicado suman ~84-90 uds
        if (currentDestSum >= 60) {
          shouldApplyInventoryDeltas = false;
        }
      }
    } catch (invCheckErr) {
      console.warn('[StockTransfers] No se pudo verificar suma previa en destino:', invCheckErr);
    }

    if (shouldApplyInventoryDeltas) {
      const concurrency = 8;
      for (let i = 0; i < TRF_1004_RECOVERY_ITEMS.length; i += concurrency) {
        const batch = TRF_1004_RECOVERY_ITEMS.slice(i, i + concurrency);
        await Promise.all(batch.map(async (it) => {
          await Promise.all([
            adjustWarehouseInventoryBalances(sourceWarehouseId, it.product_id, {
              physical: -it.qty,
              transferReserved: 0,
              inTransit: 0
            }),
            adjustWarehouseInventoryBalances(destWarehouseId, it.product_id, {
              physical: it.qty,
              transferReserved: 0,
              inTransit: 0
            })
          ]);
        }));
      }
    }

    // 2. Verificar si existen los registros en Kardex (public.movements) para [#TRF-1004]; si no, insertarlos
    const pids = TRF_1004_RECOVERY_ITEMS.map(it => it.product_id);
    const { data: existingMovs } = await supabase
      .from('movements')
      .select('id')
      .in('product_id', pids)
      .ilike('reference_doc', '%[#TRF-1004]%')
      .limit(5);

    if (!existingMovs || existingMovs.length === 0) {
      const kardexRows = [];
      TRF_1004_RECOVERY_ITEMS.forEach(it => {
        kardexRows.push(
          {
            product_id: it.product_id,
            warehouse_id: sourceWarehouseId,
            type: 'out',
            quantity: it.qty,
            date: createdAtIso,
            transfer_id: null,
            created_by_name: actor,
            reference_doc: `[#TRF-1004] Salida por traslado directo a ${destWarehouseName} · Solicitó: ${actor} · Nota: ${noteText}`
          },
          {
            product_id: it.product_id,
            warehouse_id: destWarehouseId,
            type: 'in',
            quantity: it.qty,
            date: createdAtIso,
            transfer_id: null,
            created_by_name: actor,
            reference_doc: `[#TRF-1004] Recepción de traslado desde ${sourceWarehouseName} · Recepcionó: ${actor} · Nota: ${noteText}`
          }
        );
      });
      await insertKardexMovements(kardexRows);
    }

    // 3. Reconstruir el encabezado e ítems de #TRF-1004
    const localId = 'trf-1004-restored';
    const localItems = TRF_1004_RECOVERY_ITEMS.map((it, idx) => ({
      id: `${localId}-item-${idx}`,
      transfer_id: localId,
      product_id: it.product_id,
      sku: it.sku,
      product_name: it.product_name,
      quantity_requested: it.qty,
      quantity_sent: it.qty,
      quantity_received: it.qty,
      quantity_returned_origin: 0,
      discrepancy_type: 'none',
      dest_location_hint: ''
    }));

    const restoredTransfer = {
      id: localId,
      folio: 'TRF-1004',
      comercio: 'LUTAI',
      source_warehouse_id: sourceWarehouseId,
      source_warehouse_name: sourceWarehouseName,
      dest_warehouse_id: destWarehouseId,
      dest_warehouse_name: destWarehouseName,
      status: 'Recepcionada',
      priority: 'Normal',
      execution_mode: 'direct_hub',
      title: noteText,
      notes: noteText,
      reception_notes: 'Recepción automática (Traspaso Directo 1-Paso)',
      carrier_info: '',
      package_count: 1,
      discrepancy_policy: 'return_origin',
      total_skus: 28,
      total_requested: 72,
      total_sent: 72,
      total_received: 72,
      requested_by_id: null,
      requested_by_name: actor,
      requested_at: createdAtIso,
      dispatched_by_id: null,
      dispatched_by_name: actor,
      dispatched_at: createdAtIso,
      received_by_id: null,
      received_by_name: actor,
      received_at: createdAtIso,
      created_at: createdAtIso,
      updated_at: new Date().toISOString(),
      _isLocalOnly: true,
      items: localItems,
      history: [
        {
          timestamp: createdAtIso,
          actor,
          action: 'created',
          status: 'Recepcionada',
          detail: `Transferencia creada en modalidad "Traspaso Directo 1-Paso (Recepción Inmediata)" (28 SKUs · 72 uds) desde ${sourceWarehouseName} hacia ${destWarehouseName}. Nota: ${noteText}`
        },
        {
          timestamp: createdAtIso,
          actor,
          action: 'received',
          status: 'Recepcionada',
          detail: `Traspaso directo completado: -72 uds en ${sourceWarehouseName} y +72 uds recepcionadas en ${destWarehouseName} (Kardex sincronizado).`
        }
      ]
    };

    const existingLocal = loadLocalTransfersBackup().filter(
      x => String(x.folio || '').toUpperCase() !== 'TRF-1004'
    );
    existingLocal.push(restoredTransfer);
    existingLocal.sort((a, b) => new Date(b.created_at || b.requested_at || 0) - new Date(a.created_at || a.requested_at || 0));
    saveLocalTransfersBackup(existingLocal);

    try {
      localStorage.setItem(RESTORED_1004_FLAG_KEY, 'true');
    } catch (e) {}

    await notifyInventoryChangeAfterTransfer('LUTAI', pids);

    if (typeof window.showToast === 'function') {
      window.showToast('✅ Transferencia #TRF-1004 (LUTAI · 28 SKUs · 72 uds) recuperada y sincronizada en inventario y Kardex.', 'success');
    }

    return await fetchAllStockTransfers(true);
  } catch (err) {
    console.warn('[StockTransfers] Error restaurando #TRF-1004:', err);
    return list;
  }
}


// ============================================================================
// PARTE 3A: SISTEMA DE DISEÑO (MODO CLARO & OSCURO) Y DASHBOARD PRINCIPAL
// ============================================================================

function injectStockTransfersStyles() {
  const prevStyle = document.getElementById('stock-transfers-theme-styles');
  if (prevStyle) prevStyle.remove();
  const style = document.createElement('style');
  style.id = 'stock-transfers-theme-styles';
  style.textContent = `
    .trf-module-wrap,
    .trf-modal-shell {
      --trf-surface: #ffffff;
      --trf-surface-alt: #f8fafc;
      --trf-surface-hover: #f1f5f9;
      --trf-border: #e2e8f0;
      --trf-text: #0f172a;
      --trf-muted: #475569;
      --trf-input-bg: #ffffff;
      --trf-input-border: #cbd5e1;
      --trf-card-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.06);
      --trf-hero-gradient: linear-gradient(135deg, #ffffff 0%, #f8fafc 60%, #eef2ff 100%);
      color: var(--trf-text);
    }

    .trf-module-wrap {
      display: flex;
      flex-direction: column;
      gap: 1.15rem;
    }

    [data-theme="dark"] .trf-module-wrap,
    [data-theme="dark"] .trf-modal-shell {
      --trf-surface: #131b2e;
      --trf-surface-alt: #0b1120;
      --trf-surface-hover: #1e293b;
      --trf-border: #1e293b;
      --trf-text: #f8fafc;
      --trf-muted: #94a3b8;
      --trf-input-bg: #0b1120;
      --trf-input-border: #334155;
      --trf-card-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.45);
      --trf-hero-gradient: linear-gradient(135deg, #131b2e 0%, #0f172a 65%, rgba(79, 70, 229, 0.16) 100%);
    }

    .trf-hero-card {
      background: var(--trf-hero-gradient);
      border: 1px solid var(--trf-border);
      border-radius: 16px;
      padding: 1.35rem 1.5rem;
      box-shadow: var(--trf-card-shadow);
      display: flex;
      flex-direction: column;
      gap: 1.1rem;
    }

    .trf-hero-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .trf-pill-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.45rem;
    }

    .trf-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.38rem;
      padding: 0.25rem 0.7rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.02em;
      border: 1px solid transparent;
    }

    .trf-pill-indigo {
      background: rgba(79, 70, 229, 0.12);
      color: #4f46e5;
      border-color: rgba(79, 70, 229, 0.28);
    }
    [data-theme="dark"] .trf-pill-indigo {
      background: rgba(99, 102, 241, 0.18);
      color: #a5b4fc;
      border-color: rgba(99, 102, 241, 0.35);
    }

    .trf-pill-amber {
      background: rgba(245, 158, 11, 0.14);
      color: #b45309;
      border-color: rgba(245, 158, 11, 0.35);
    }
    [data-theme="dark"] .trf-pill-amber {
      background: rgba(245, 158, 11, 0.18);
      color: #fcd34d;
      border-color: rgba(245, 158, 11, 0.4);
    }

    .trf-pill-emerald {
      background: rgba(16, 185, 129, 0.14);
      color: #047857;
      border-color: rgba(16, 185, 129, 0.32);
    }
    [data-theme="dark"] .trf-pill-emerald {
      background: rgba(16, 185, 129, 0.18);
      color: #6ee7b7;
      border-color: rgba(16, 185, 129, 0.38);
    }

    .trf-pill-sky {
      background: rgba(2, 132, 199, 0.13);
      color: #0369a1;
      border-color: rgba(2, 132, 199, 0.3);
    }
    [data-theme="dark"] .trf-pill-sky {
      background: rgba(56, 189, 248, 0.16);
      color: #7dd3fc;
      border-color: rgba(56, 189, 248, 0.35);
    }

    .trf-pill-rose {
      background: rgba(239, 68, 68, 0.13);
      color: #b91c1c;
      border-color: rgba(239, 68, 68, 0.3);
    }
    [data-theme="dark"] .trf-pill-rose {
      background: rgba(248, 113, 113, 0.18);
      color: #fca5a5;
      border-color: rgba(248, 113, 113, 0.38);
    }

    .trf-pill-purple {
      background: rgba(124, 58, 237, 0.12);
      color: #6d28d9;
      border-color: rgba(124, 58, 237, 0.28);
    }
    [data-theme="dark"] .trf-pill-purple {
      background: rgba(167, 139, 250, 0.18);
      color: #c4b5fd;
      border-color: rgba(167, 139, 250, 0.35);
    }

    .trf-pill-neutral {
      background: rgba(100, 116, 139, 0.12);
      color: var(--trf-muted);
      border-color: rgba(100, 116, 139, 0.25);
    }

    .trf-hero-title {
      margin: 0;
      font-size: 1.3rem;
      font-weight: 800;
      color: var(--trf-text);
      display: flex;
      align-items: center;
      gap: 0.55rem;
      letter-spacing: -0.01em;
    }

    .trf-hero-subtitle {
      margin: 0.35rem 0 0 0;
      font-size: 0.85rem;
      color: var(--trf-muted);
      max-width: 780px;
      line-height: 1.5;
    }

    .trf-btn-row {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      flex-wrap: wrap;
    }

    .trf-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.42rem;
      height: 38px;
      padding: 0 0.95rem;
      border-radius: 10px;
      font-size: 0.81rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.18s ease;
      border: 1px solid var(--trf-border);
      background: var(--trf-surface);
      color: var(--trf-text);
      white-space: nowrap;
    }

    .trf-btn:hover {
      background: var(--trf-surface-hover);
      border-color: #6366f1;
      transform: translateY(-1px);
    }

    .trf-btn-primary {
      background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
      color: #ffffff !important;
      border: 1px solid rgba(99, 102, 241, 0.5);
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.32);
      height: 40px;
      padding: 0 1.15rem;
      font-weight: 800;
    }

    .trf-btn-primary:hover {
      background: linear-gradient(135deg, #4338ca 0%, #3730a3 100%);
      box-shadow: 0 6px 18px rgba(79, 70, 229, 0.45);
    }

    /* Workflow Steps Guide inside Hero */
    .trf-workflow-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 0.75rem;
      padding-top: 0.85rem;
      border-top: 1px dashed var(--trf-border);
    }

    .trf-workflow-step {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      padding: 0.65rem 0.85rem;
      border-radius: 11px;
      background: var(--trf-surface);
      border: 1px solid var(--trf-border);
    }

    .trf-workflow-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
    }

    /* KPI Grid */
    .trf-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(235px, 1fr));
      gap: 0.9rem;
    }

    .trf-kpi-card {
      background: var(--trf-surface);
      border: 1px solid var(--trf-border);
      border-radius: 14px;
      padding: 1.05rem 1.2rem;
      box-shadow: var(--trf-card-shadow);
      cursor: pointer;
      transition: all 0.18s ease;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 0.55rem;
    }

    .trf-kpi-card:hover {
      transform: translateY(-2px);
      border-color: rgba(99, 102, 241, 0.45);
    }

    .trf-kpi-card.active-filter {
      box-shadow: 0 0 0 2px #6366f1, var(--trf-card-shadow);
    }

    .trf-kpi-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .trf-kpi-label {
      font-size: 0.73rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .trf-kpi-icon-box {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.15rem;
      flex-shrink: 0;
    }

    .trf-kpi-value-row {
      display: flex;
      align-items: baseline;
      gap: 0.55rem;
    }

    .trf-kpi-number {
      font-size: 1.8rem;
      font-weight: 900;
      color: var(--trf-text);
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }

    .trf-kpi-desc {
      font-size: 0.75rem;
      color: var(--trf-muted);
      display: flex;
      align-items: center;
      gap: 0.35rem;
      line-height: 1.35;
    }

    /* Filter Bar Card */
    .trf-filter-card {
      background: var(--trf-surface);
      border: 1px solid var(--trf-border);
      border-radius: 14px;
      padding: 1.1rem 1.25rem;
      box-shadow: var(--trf-card-shadow);
      display: flex;
      flex-direction: column;
      gap: 0.95rem;
    }

    .trf-status-pills-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--trf-border);
    }

    .trf-status-pill-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.42rem 0.9rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid var(--trf-border);
      background: var(--trf-surface-alt);
      color: var(--trf-muted);
      transition: all 0.15s ease;
    }

    .trf-status-pill-btn:hover {
      border-color: #6366f1;
      color: var(--trf-text);
    }

    .trf-status-pill-btn.active {
      background: linear-gradient(135deg, #4f46e5, #4338ca);
      color: #ffffff;
      border-color: #4f46e5;
      box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
    }

    .trf-controls-grid {
      display: grid;
      grid-template-columns: 1.35fr 1fr 1fr 1fr;
      gap: 0.85rem;
    }

    @media (max-width: 1100px) {
      .trf-controls-grid {
        grid-template-columns: 1fr 1fr;
      }
    }
    @media (max-width: 640px) {
      .trf-controls-grid {
        grid-template-columns: 1fr;
      }
    }

    .trf-field-label {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.71rem;
      font-weight: 800;
      color: var(--trf-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.38rem;
    }

    .trf-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .trf-input-wrap i.trf-input-icon {
      position: absolute;
      left: 0.8rem;
      color: var(--trf-muted);
      font-size: 0.95rem;
      pointer-events: none;
    }

    .trf-input,
    .trf-select {
      width: 100%;
      height: 40px;
      padding: 0 0.85rem;
      border-radius: 10px;
      border: 1px solid var(--trf-input-border);
      background-color: var(--trf-input-bg);
      color: var(--trf-text);
      font-size: 0.84rem;
      font-weight: 600;
      font-family: inherit;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
      box-sizing: border-box;
    }

    .trf-input.has-left-icon {
      padding-left: 2.3rem;
    }

    .trf-input::placeholder {
      color: var(--trf-muted);
      opacity: 0.75;
      font-weight: 400;
    }

    .trf-input:focus,
    .trf-select:focus {
      outline: none;
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
      background-color: var(--trf-surface);
    }

    .trf-select option {
      background-color: var(--trf-surface);
      color: var(--trf-text);
    }

    /* Table Card */
    .trf-table-card {
      background: var(--trf-surface);
      border: 1px solid var(--trf-border);
      border-radius: 14px;
      box-shadow: var(--trf-card-shadow);
      overflow: hidden;
    }

    .trf-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.83rem;
    }

    .trf-table thead tr {
      background: var(--trf-surface-alt);
      border-bottom: 1px solid var(--trf-border);
      text-align: left;
      font-size: 0.71rem;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--trf-muted);
      letter-spacing: 0.04em;
    }

    .trf-table th {
      padding: 0.85rem 1rem;
      white-space: nowrap;
      background: var(--trf-surface-alt);
      border-bottom: 1px solid var(--trf-border);
    }

    .trf-table tbody tr {
      border-bottom: 1px solid var(--trf-border);
      transition: background-color 0.14s ease;
    }

    .trf-table tbody tr:last-child {
      border-bottom: none;
    }

    .trf-table tbody tr:hover {
      background-color: var(--trf-surface-hover);
    }

    .trf-table td {
      padding: 0.9rem 1rem;
      vertical-align: middle;
      color: var(--trf-text);
    }

    .trf-modal-shell .trf-table th {
      padding: 0.55rem 0.6rem;
      font-size: 0.68rem;
    }

    .trf-modal-shell .trf-table td {
      padding: 0.55rem 0.6rem;
      font-size: 0.8rem;
    }

    /* Empty State */
    .trf-empty-box {
      padding: 3.2rem 1.5rem;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.85rem;
    }

    .trf-empty-icon-ring {
      width: 64px;
      height: 64px;
      border-radius: 18px;
      background: rgba(79, 70, 229, 0.12);
      border: 1px solid rgba(99, 102, 241, 0.28);
      color: #6366f1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.75rem;
    }

    /* Modals */
    .trf-modal-shell {
      background: var(--trf-surface);
      color: var(--trf-text);
      border: 1px solid var(--trf-border);
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      width: 100%;
    }

    .trf-modal-subbar {
      padding: 0.75rem 1.5rem;
      background: var(--trf-surface-alt);
      border-bottom: 1px solid var(--trf-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .trf-modal-footer {
      padding: 0.95rem 1.5rem;
      background: var(--trf-surface-alt);
      border-top: 1px solid var(--trf-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .trf-step-card {
      border: 1px solid var(--trf-border);
      background: var(--trf-surface-alt);
      border-radius: 12px;
      padding: 0.9rem 1rem;
      position: relative;
    }
  `;
  document.head.appendChild(style);
}

function getStatusBadgeHtml(status) {
  const st = String(status || 'Solicitada');
  if (st === 'Solicitada') {
    return `<span class="trf-pill trf-pill-amber"><i class="ri-time-line"></i> Solicitada (Reservado)</span>`;
  }
  if (st === 'En Tránsito') {
    return `<span class="trf-pill trf-pill-sky"><i class="ri-truck-line"></i> En Tránsito</span>`;
  }
  if (st === 'Recepcionada') {
    return `<span class="trf-pill trf-pill-emerald"><i class="ri-checkbox-circle-line"></i> Recepcionada</span>`;
  }
  if (st === 'Con Diferencias') {
    return `<span class="trf-pill trf-pill-rose"><i class="ri-error-warning-line"></i> Con Diferencias</span>`;
  }
  if (st === 'Cancelada') {
    return `<span class="trf-pill trf-pill-neutral"><i class="ri-close-circle-line"></i> Cancelada</span>`;
  }
  return `<span class="trf-pill trf-pill-neutral">${escHtml(st)}</span>`;
}

function getWarehousePillHtml(whName, role = 'origin') {
  const n = String(whName || 'Bodega');
  const lower = n.toLowerCase();
  let cls = 'trf-pill-indigo';
  if (lower.includes('reina')) cls = 'trf-pill-emerald';
  else if (lower.includes('recoleta')) cls = 'trf-pill-amber';
  else if (lower.includes('central') || lower.includes('hub')) cls = 'trf-pill-purple';
  const icon = role === 'dest' ? 'ri-download-2-line' : 'ri-upload-2-line';
  return `<span class="trf-pill ${cls}" style="border-radius:8px; padding:0.2rem 0.6rem;"><i class="${icon}"></i> ${escHtml(n)}</span>`;
}

/**
 * Abre modal con el script SQL de migración para copiar y ejecutar en Supabase SQL Editor
 */
export async function openStockTransfersSqlModal() {
  injectStockTransfersStyles();
  let sqlContent = '';
  try {
    const resp = await fetch('./supabase_schema_stock_transfers.sql?t=' + Date.now());
    if (resp.ok) sqlContent = await resp.text();
  } catch (e) {
    console.warn('[StockTransfers] No se pudo cargar archivo SQL vía fetch:', e);
  }
  if (!sqlContent) {
    sqlContent = `-- Ejecuta el archivo supabase_schema_stock_transfers.sql incluido en la raíz del proyecto WMS STOCKA en el SQL Editor de Supabase.`;
  }

  const existing = document.getElementById('modal-stock-transfers-sql');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-stock-transfers-sql';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(7,10,19,0.78); backdrop-filter:blur(5px); z-index:10050; display:flex; align-items:center; justify-content:center; padding:1.25rem;';
  overlay.innerHTML = `
    <div class="trf-modal-shell" style="max-width:860px; max-height:88vh;">
      <div style="padding:1.15rem 1.5rem; background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color:#fff; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:0.5rem;">
            <i class="ri-database-2-line" style="color:#818cf8;"></i> Migración SQL · Sistema de Transferencias entre Bodegas
          </h3>
          <p style="margin:3px 0 0 0; font-size:0.78rem; color:#94a3b8;">Copia y ejecuta este script idempotente en el SQL Editor de Supabase para habilitar las tablas nativas.</p>
        </div>
        <button id="btn-close-trf-sql" style="background:rgba(255,255,255,0.1); border:none; color:#fff; width:34px; height:34px; border-radius:8px; cursor:pointer; font-weight:700;">✕</button>
      </div>
      <div style="padding:1.25rem 1.5rem; overflow-y:auto; flex:1; background:var(--trf-surface);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
          <span style="font-size:0.82rem; font-weight:700; color:var(--trf-text);">Archivo: <code style="color:#6366f1;">supabase_schema_stock_transfers.sql</code></span>
          <button id="btn-copy-trf-sql" class="trf-btn trf-btn-primary" style="height:34px; padding:0 0.9rem; font-size:0.78rem;">
            <i class="ri-file-copy-line"></i> Copiar Script SQL
          </button>
        </div>
        <pre id="pre-trf-sql-code" style="background:#090d16; color:#e2e8f0; border:1px solid #1e293b; padding:1rem; border-radius:10px; font-size:0.76rem; line-height:1.45; overflow-x:auto; max-height:54vh; margin:0; font-family:monospace;">${escHtml(sqlContent)}</pre>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-close-trf-sql').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#btn-copy-trf-sql').onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(sqlContent);
      e.currentTarget.innerHTML = '<i class="ri-check-double-line"></i> ¡SQL Copiado al Portapapeles!';
      e.currentTarget.style.background = '#10b981';
    } catch (err) {
      alert('No se pudo copiar automáticamente. Selecciona el texto manualmente.');
    }
  };
}
window.openStockTransfersSqlModal = openStockTransfersSqlModal;

/**
 * Imprime Guía de Traslado entre Bodegas con firmas de Solicitante, Despachador y Receptor
 */
export async function printStockTransferGuide(transferId) {
  const list = await fetchAllStockTransfers(false);
  const t = list.find(x => String(x.id) === String(transferId) || String(x.folio) === String(transferId));
  if (!t) return;

  const itemsRows = (t.items || []).map((it, idx) => `
    <tr>
      <td style="padding:8px; border:1px solid #cbd5e1; text-align:center;">${idx + 1}</td>
      <td style="padding:8px; border:1px solid #cbd5e1; font-family:monospace; font-weight:700;">${escHtml(it.sku)}</td>
      <td style="padding:8px; border:1px solid #cbd5e1;">${escHtml(it.product_name)}</td>
      <td style="padding:8px; border:1px solid #cbd5e1; text-align:center; font-weight:700;">${Number(it.quantity_requested || 0)}</td>
      <td style="padding:8px; border:1px solid #cbd5e1; text-align:center; font-weight:700;">${Number(it.quantity_sent || 0)}</td>
      <td style="padding:8px; border:1px solid #cbd5e1; text-align:center; font-weight:700;">${t.status === 'Recepcionada' || t.status === 'Con Diferencias' ? Number(it.quantity_received || 0) : '____'}</td>
      <td style="padding:8px; border:1px solid #cbd5e1; font-size:12px;">${escHtml(it.dest_location_hint || '')}</td>
    </tr>
  `).join('');

  const w = window.open('', '_blank', 'width=900,height=720');
  if (!w) {
    alert('Permite las ventanas emergentes para imprimir la Guía de Traslado.');
    return;
  }
  w.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Guía de Traslado ${escHtml(t.folio)} - WMS STOCKA</title>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; color: #0f172a; margin: 28px; font-size: 13px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 18px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 18px; }
        .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
        .card-title { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background: #f1f5f9; padding: 8px; border: 1px solid #cbd5e1; text-align: left; font-size: 11px; text-transform: uppercase; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 56px; text-align: center; }
        .sig-box { border-top: 1px solid #334155; padding-top: 8px; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div style="font-size:18px; font-weight:900;">WMS STOCKA · GUÍA DE TRANSFERENCIA ENTRE BODEGAS</div>
          <div style="color:#475569; margin-top:4px;">Comercio / Cliente: <strong>${escHtml(t.comercio)}</strong> · Prioridad: <strong>${escHtml(t.priority || 'Normal')}</strong></div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:20px; font-weight:900; font-family:monospace; color:#4f46e5;">${escHtml(t.folio)}</div>
          <div style="font-size:12px; font-weight:700; margin-top:2px;">Estado: ${escHtml(t.status)}</div>
        </div>
      </div>
      <div class="grid">
        <div class="card">
          <div class="card-title">1. Bodega de Origen (Salida)</div>
          <div style="font-size:15px; font-weight:800;">${escHtml(t.source_warehouse_name)}</div>
          <div style="margin-top:4px; font-size:12px;">Solicitado por: <strong>${escHtml(t.requested_by_name || '-')}</strong></div>
          <div style="font-size:11px; color:#64748b;">Fecha: ${formatDateTimeCL(t.requested_at)}</div>
        </div>
        <div class="card">
          <div class="card-title">2. Despacho y Transporte</div>
          <div style="font-size:14px; font-weight:800;">Despachó: ${escHtml(t.dispatched_by_name || 'Pendiente')}</div>
          <div style="margin-top:4px; font-size:12px;">Transporte: ${escHtml(t.carrier_info || 'Interno')} · Bultos: ${Number(t.package_count || 1)}</div>
          <div style="font-size:11px; color:#64748b;">Fecha Salida: ${formatDateTimeCL(t.dispatched_at)}</div>
        </div>
        <div class="card">
          <div class="card-title">3. Bodega de Destino (Recepción)</div>
          <div style="font-size:15px; font-weight:800;">${escHtml(t.dest_warehouse_name)}</div>
          <div style="margin-top:4px; font-size:12px;">Recepcionado por: <strong>${escHtml(t.received_by_name || 'Pendiente de firma')}</strong></div>
          <div style="font-size:11px; color:#64748b;">Fecha Recepción: ${formatDateTimeCL(t.received_at)}</div>
        </div>
      </div>
      ${t.notes ? `<div style="margin-bottom:14px; padding:8px 12px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px;"><strong>Observaciones / Motivo:</strong> ${escHtml(t.notes)}</div>` : ''}
      <table>
        <thead>
          <tr>
            <th style="width:36px; text-align:center;">#</th>
            <th>SKU</th>
            <th>Producto</th>
            <th style="text-align:center;">Solicitado</th>
            <th style="text-align:center;">Enviado</th>
            <th style="text-align:center;">Recepcionado</th>
            <th>Ubicación Destino</th>
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <div class="signatures">
        <div class="sig-box">
          <strong>${escHtml(t.requested_by_name || '________________')}</strong><br>Solicitado por (Admin)
        </div>
        <div class="sig-box">
          <strong>${escHtml(t.dispatched_by_name || '________________')}</strong><br>Despachado en ${escHtml(t.source_warehouse_name)}
        </div>
        <div class="sig-box">
          <strong>${escHtml(t.received_by_name || '________________')}</strong><br>Recepcionado Conforme en ${escHtml(t.dest_warehouse_name)}
        </div>
      </div>
      <script>window.onload = () => { window.print(); };</script>
    </body>
    </html>
  `);
  w.document.close();
}
window.printStockTransferGuide = printStockTransferGuide;

/**
 * RENDERIZADOR PRINCIPAL DEL MÓDULO DE TRANSFERENCIAS ENTRE BODEGAS
 * Compatible al 100% con Modo Claro y Modo Oscuro ([data-theme="dark"]).
 */
export async function renderStockTransfersAdmin(containerOverride = null) {
  injectStockTransfersStyles();
  const container = containerOverride || document.getElementById('admin-inv-transfers-container') || document.getElementById('app-content') || document.getElementById('view-content');
  if (!container) return;

  if (!containerOverride) {
    const viewTitle = document.getElementById('view-title') || document.getElementById('page-title');
    if (viewTitle) viewTitle.textContent = 'Transferencias de Stock entre Bodegas';
  }

  container.innerHTML = `
    <div class="trf-module-wrap">
      <div class="trf-hero-card" style="align-items:center; justify-content:center; padding:2.5rem; text-align:center;">
        <i class="ri-loader-4-line ri-spin" style="font-size:2rem; color:#6366f1;"></i>
        <div style="font-weight:700; font-size:0.95rem; margin-top:0.35rem;">Cargando trazabilidad de transferencias entre bodegas...</div>
      </div>
    </div>
  `;

  await resolveCurrentAdminIdentity();
  let [, transfers] = await Promise.all([
    ensureAllWarehousesLoaded(),
    fetchAllStockTransfers(true),
    ensureAllCommercesLoaded()
  ]);

  // Restaurar automáticamente #TRF-1004 si se borraron tanto #TRF-1004 como #TRF-1005 al limpiar el duplicado
  transfers = await ensureTransfer1004Restored(transfers);

  const warehouses = Array.isArray(window.allWarehousesList) ? window.allWarehousesList : [];
  const state = window.stockTransfersState;
  if (state.showWorkflowGuide === undefined) state.showWorkflowGuide = true;

  // Extraer lista de comercios únicos (de transferencias + caché global + catálogo)
  const commerceSet = new Set();
  transfers.forEach(t => { if (t.comercio) commerceSet.add(t.comercio); });
  if (window.activeAdminInventoryCommerce) commerceSet.add(window.activeAdminInventoryCommerce);
  if (Array.isArray(window.adminCommercesList)) {
    window.adminCommercesList.forEach(c => { if (c) commerceSet.add(typeof c === 'string' ? c : c.name); });
  }
  if (window.adminInventoryCommerceCache) {
    Object.keys(window.adminInventoryCommerceCache).forEach(k => { if (k) commerceSet.add(k); });
  }
  const commercesList = Array.from(commerceSet).filter(Boolean).sort((a, b) => a.localeCompare(b));

  // Calcular KPIs globales
  const kpiSolicitadas = transfers.filter(t => t.status === 'Solicitada');
  const kpiTransito = transfers.filter(t => t.status === 'En Tránsito');
  const kpiRecepcionadas = transfers.filter(t => t.status === 'Recepcionada');
  const kpiDiferencias = transfers.filter(t => t.status === 'Con Diferencias');

  const unitsReservedOrigin = kpiSolicitadas.reduce((acc, t) => acc + Number(t.total_requested || 0), 0);
  const unitsInTransit = kpiTransito.reduce((acc, t) => acc + Number(t.total_sent || 0), 0);
  const unitsReceivedTotal = [...kpiRecepcionadas, ...kpiDiferencias].reduce((acc, t) => acc + Number(t.total_received || 0), 0);

  // Filtrar listado según controles activos
  const filtered = transfers.filter(t => {
    if (state.filterStatus && state.filterStatus !== 'ALL' && t.status !== state.filterStatus) return false;
    if (state.filterCommerce && t.comercio !== state.filterCommerce) return false;
    if (state.filterSourceWh && String(t.source_warehouse_id) !== String(state.filterSourceWh)) return false;
    if (state.filterDestWh && String(t.dest_warehouse_id) !== String(state.filterDestWh)) return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase().trim();
      const matchHeader = [
        t.folio, t.comercio, t.source_warehouse_name, t.dest_warehouse_name,
        t.requested_by_name, t.dispatched_by_name, t.received_by_name, t.notes, t.title
      ].some(val => String(val || '').toLowerCase().includes(q));
      const matchItem = (t.items || []).some(it =>
        String(it.sku || '').toLowerCase().includes(q) ||
        String(it.product_name || '').toLowerCase().includes(q)
      );
      if (!matchHeader && !matchItem) return false;
    }
    return true;
  });

  const hasActiveFilters = (state.filterStatus && state.filterStatus !== 'ALL') ||
    !!state.filterCommerce || !!state.filterSourceWh || !!state.filterDestWh || !!state.searchQuery;

  container.innerHTML = `
    <div class="trf-module-wrap">
      <!-- 1. HERO HEADER OPERATIVO -->
      <section class="trf-hero-card">
        <div class="trf-hero-top">
          <div>
            <div class="trf-pill-row">
              <span class="trf-pill trf-pill-indigo">
                <i class="ri-route-line"></i> LOGÍSTICA INTER-BODEGAS · TRAZABILIDAD 360°
              </span>
              <span class="trf-pill trf-pill-purple">
                <i class="ri-shield-user-line"></i> Exclusivo Administradores
              </span>
              ${state.usingLocalFallback ? `
                <button type="button" id="btn-trf-open-sql-banner" class="trf-pill trf-pill-amber" style="cursor:pointer;" title="Haz clic para copiar el script SQL de Supabase">
                  <i class="ri-Sim-card-line"></i> Respaldo Local Activo · Activar SQL Supabase
                </button>
              ` : `
                <span class="trf-pill trf-pill-emerald">
                  <i class="ri-checkbox-circle-fill"></i> Sincronizado con Supabase
                </span>
              `}
            </div>
            <h2 class="trf-hero-title">
              <i class="ri-truck-line" style="color:#6366f1;"></i>
              Sistema de Transferencias de Stock entre Bodegas
            </h2>
            <p class="trf-hero-subtitle">
              Control de cadena de custodia (<strong>quién solicita</strong>, <strong>quién despacha</strong> y <strong>quién recepciona</strong>) con ajuste automático de stock reservado en origen, unidades en tránsito y corrección diferencial (Δ) post-recepción.
            </p>
          </div>

          <div class="trf-btn-row">
            <button type="button" id="btn-trf-toggle-guide" class="trf-btn" title="Mostrar u ocultar el esquema de estados de stock">
              <i class="ri-compass-3-line" style="color:#6366f1;"></i>
              <span>${state.showWorkflowGuide ? 'Ocultar Flujo' : 'Ver Flujo de Stock'}</span>
            </button>
            <button type="button" id="btn-trf-sql-helper" class="trf-btn" title="Ver script SQL de tablas y políticas RLS">
              <i class="ri-code-s-slash-line" style="color:#f59e0b;"></i>
              <span>Script SQL</span>
            </button>
            <button type="button" id="btn-trf-refresh" class="trf-btn" title="Refrescar movimientos y saldos">
              <i class="ri-refresh-line"></i>
              <span>Actualizar</span>
            </button>
            <button type="button" id="btn-trf-new-request" class="trf-btn trf-btn-primary">
              <i class="ri-add-circle-line" style="font-size:1rem;"></i>
              <span>Solicitar / Crear Transferencia</span>
            </button>
          </div>
        </div>

        ${state.showWorkflowGuide ? `
          <div class="trf-workflow-strip">
            <div class="trf-workflow-step">
              <div class="trf-workflow-icon" style="background:rgba(245,158,11,0.15); color:#f59e0b;">
                <i class="ri-lock-2-line"></i>
              </div>
              <div>
                <div style="font-size:0.78rem; font-weight:800; color:var(--trf-text);">1. Estado «Solicitada» (Reserva en Origen)</div>
                <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:2px;">
                  Registra quién solicita y <strong>reserva las unidades en la Bodega de Origen</strong>, descontándolas del Stock Disponible para evitar sobreventa.
                </div>
              </div>
            </div>

            <div class="trf-workflow-step">
              <div class="trf-workflow-icon" style="background:rgba(2,132,199,0.15); color:#38bdf8;">
                <i class="ri-truck-line"></i>
              </div>
              <div>
                <div style="font-size:0.78rem; font-weight:800; color:var(--trf-text);">2. Estado «En Tránsito» (Salida Física)</div>
                <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:2px;">
                  Registra quién despacha, rebaja el <strong>Stock Físico en Origen</strong> (Kardex <code>OUT</code>) y suma las unidades a <strong>En Tránsito</strong> hacia Destino.
                </div>
              </div>
            </div>

            <div class="trf-workflow-step">
              <div class="trf-workflow-icon" style="background:rgba(16,185,129,0.15); color:#10b981;">
                <i class="ri-inbox-archive-line"></i>
              </div>
              <div>
                <div style="font-size:0.78rem; font-weight:800; color:var(--trf-text);">3. «Recepcionada» o «Corregir Ingreso (Δ)»</div>
                <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:2px;">
                  Suma el <strong>Stock Físico en Destino</strong> (Kardex <code>IN</code>). Si hubo error al contar, permite <strong>Corregir el Ingreso</strong> recalculando diferencias automáticamente.
                </div>
              </div>
            </div>
          </div>
        ` : ''}
      </section>

      <!-- 2. TARJETAS KPI DE ESTADOS E IMPACTO EN INVENTARIO -->
      <section class="trf-kpi-grid">
        <div class="trf-kpi-card ${state.filterStatus === 'Solicitada' ? 'active-filter' : ''}" data-status-click="Solicitada" style="border-left:4px solid #f59e0b;">
          <div class="trf-kpi-top">
            <span class="trf-kpi-label" style="color:#f59e0b;">1. Solicitudes Pendientes</span>
            <div class="trf-kpi-icon-box" style="background:rgba(245,158,11,0.14); color:#f59e0b;">
              <i class="ri-time-line"></i>
            </div>
          </div>
          <div class="trf-kpi-value-row">
            <span class="trf-kpi-number">${kpiSolicitadas.length}</span>
            <span class="trf-pill trf-pill-amber">${unitsReservedOrigin} uds reservadas</span>
          </div>
          <div class="trf-kpi-desc">
            <i class="ri-lock-password-line" style="color:#f59e0b;"></i>
            <span>Reservadas en Bodega Origen (descontadas de Disponible)</span>
          </div>
        </div>

        <div class="trf-kpi-card ${state.filterStatus === 'En Tránsito' ? 'active-filter' : ''}" data-status-click="En Tránsito" style="border-left:4px solid #0284c7;">
          <div class="trf-kpi-top">
            <span class="trf-kpi-label" style="color:#38bdf8;">2. En Tránsito entre Bodegas</span>
            <div class="trf-kpi-icon-box" style="background:rgba(2,132,199,0.14); color:#38bdf8;">
              <i class="ri-truck-line"></i>
            </div>
          </div>
          <div class="trf-kpi-value-row">
            <span class="trf-kpi-number">${kpiTransito.length}</span>
            <span class="trf-pill trf-pill-sky">${unitsInTransit} uds en ruta</span>
          </div>
          <div class="trf-kpi-desc">
            <i class="ri-arrow-right-circle-line" style="color:#38bdf8;"></i>
            <span>Rebajadas de Físico Origen · Pendientes de Recepción</span>
          </div>
        </div>

        <div class="trf-kpi-card ${state.filterStatus === 'Recepcionada' ? 'active-filter' : ''}" data-status-click="Recepcionada" style="border-left:4px solid #10b981;">
          <div class="trf-kpi-top">
            <span class="trf-kpi-label" style="color:#10b981;">3. Recepcionadas Conforme</span>
            <div class="trf-kpi-icon-box" style="background:rgba(16,185,129,0.14); color:#10b981;">
              <i class="ri-checkbox-circle-line"></i>
            </div>
          </div>
          <div class="trf-kpi-value-row">
            <span class="trf-kpi-number">${kpiRecepcionadas.length}</span>
            <span class="trf-pill trf-pill-emerald">${unitsReceivedTotal} uds ingresadas</span>
          </div>
          <div class="trf-kpi-desc">
            <i class="ri-Database-2-line" style="color:#10b981;"></i>
            <span>Sumadas al Físico y Disponible en Bodega Destino</span>
          </div>
        </div>

        <div class="trf-kpi-card ${state.filterStatus === 'Con Diferencias' ? 'active-filter' : ''}" data-status-click="Con Diferencias" style="border-left:4px solid #ef4444;">
          <div class="trf-kpi-top">
            <span class="trf-kpi-label" style="color:#f87171;">4. Con Diferencias / Ajustadas</span>
            <div class="trf-kpi-icon-box" style="background:rgba(239,68,68,0.14); color:#f87171;">
              <i class="ri-tools-line"></i>
            </div>
          </div>
          <div class="trf-kpi-value-row">
            <span class="trf-kpi-number">${kpiDiferencias.length}</span>
            <span class="trf-pill trf-pill-rose">Auditoría Δ</span>
          </div>
          <div class="trf-kpi-desc">
            <i class="ri-edit-circle-line" style="color:#f87171;"></i>
            <span>Soportan «Corregir un Ingreso» con ajuste automático</span>
          </div>
        </div>
      </section>

      <!-- 3. BARRA DE FILTROS Y BÚSQUEDA -->
      <section class="trf-filter-card">
        <div class="trf-status-pills-bar">
          <div style="display:flex; gap:0.45rem; flex-wrap:wrap; align-items:center;">
            ${[
              { id: 'ALL', icon: 'ri-apps-2-line', label: `Todas (${transfers.length})` },
              { id: 'Solicitada', icon: 'ri-time-line', label: `Solicitadas (${kpiSolicitadas.length})` },
              { id: 'En Tránsito', icon: 'ri-truck-line', label: `En Tránsito (${kpiTransito.length})` },
              { id: 'Recepcionada', icon: 'ri-checkbox-circle-line', label: `Recepcionadas (${kpiRecepcionadas.length})` },
              { id: 'Con Diferencias', icon: 'ri-error-warning-line', label: `Con Diferencias (${kpiDiferencias.length})` },
              { id: 'Cancelada', icon: 'ri-close-circle-line', label: `Canceladas` }
            ].map(tab => {
              const active = state.filterStatus === tab.id;
              return `
                <button type="button" class="trf-status-pill-btn ${active ? 'active' : ''}" data-status="${escHtml(tab.id)}">
                  <i class="${tab.icon}"></i>
                  <span>${tab.label}</span>
                </button>
              `;
            }).join('')}
          </div>

          ${hasActiveFilters ? `
            <button type="button" id="btn-trf-clear-filters" class="trf-btn" style="height:32px; padding:0 0.75rem; font-size:0.75rem; color:#f87171; border-color:rgba(239,68,68,0.3);">
              <i class="ri-filter-off-line"></i> Limpiar filtros
            </button>
          ` : ''}
        </div>

        <div class="trf-controls-grid">
          <div>
            <label class="trf-field-label"><i class="ri-search-2-line"></i> Buscar Folio / SKU / Responsable</label>
            <div class="trf-input-wrap">
              <i class="ri-search-line trf-input-icon"></i>
              <input type="text" id="trf-search-input" class="trf-input has-left-icon" placeholder="Ej: TRF-1001, SKU, quién solicitó o recepcionó..." value="${escHtml(state.searchQuery)}">
            </div>
          </div>

          <div>
            <label class="trf-field-label"><i class="ri-store-2-line"></i> Comercio / Cliente</label>
            <select id="trf-filter-commerce" class="trf-select">
              <option value="">Todos los Comercios (${commercesList.length})</option>
              ${commercesList.map(c => `<option value="${escHtml(c)}" ${state.filterCommerce === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="trf-field-label"><i class="ri-upload-2-line" style="color:#f59e0b;"></i> Bodega de Origen (Salida)</label>
            <select id="trf-filter-source-wh" class="trf-select">
              <option value="">Todas las Bodegas Origen</option>
              ${warehouses.map(w => `<option value="${w.id}" ${String(state.filterSourceWh) === String(w.id) ? 'selected' : ''}>${escHtml(w.name)}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="trf-field-label"><i class="ri-download-2-line" style="color:#10b981;"></i> Bodega de Destino (Entrada)</label>
            <select id="trf-filter-dest-wh" class="trf-select">
              <option value="">Todas las Bodegas Destino</option>
              ${warehouses.map(w => `<option value="${w.id}" ${String(state.filterDestWh) === String(w.id) ? 'selected' : ''}>${escHtml(w.name)}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>

      <!-- 4. TABLA DE TRANSFERENCIAS Y TRAZABILIDAD -->
      <section class="trf-table-card">
        <div style="overflow-x:auto;">
          <table class="trf-table">
            <thead>
              <tr>
                <th>Folio / Fecha</th>
                <th>Comercio</th>
                <th>Ruta (Origen → Destino)</th>
                <th style="text-align:center;">SKUs y Unidades</th>
                <th>Cadena de Responsables</th>
                <th>Estado e Impacto en Stock</th>
                <th style="text-align:right;">Acciones Operativas</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length === 0 ? `
                <tr>
                  <td colspan="7">
                    <div class="trf-empty-box">
                      <div class="trf-empty-icon-ring">
                        <i class="ri-arrow-left-right-line"></i>
                      </div>
                      <div style="font-weight:800; color:var(--trf-text); font-size:1.02rem;">
                        ${hasActiveFilters ? 'No hay transferencias que coincidan con los filtros seleccionados' : 'Aún no se han registrado transferencias entre bodegas'}
                      </div>
                      <p style="margin:0; font-size:0.84rem; color:var(--trf-muted); max-width:520px;">
                        Crea una solicitud de traslado para reservar stock en la bodega de origen, registrar quién despacha a ruta y controlar quién recepciona en la bodega destino.
                      </p>
                      <div style="display:flex; gap:0.6rem; margin-top:0.4rem;">
                        ${hasActiveFilters ? `
                          <button type="button" id="btn-trf-empty-clear" class="trf-btn">
                            <i class="ri-filter-off-line"></i> Ver Todas
                          </button>
                        ` : ''}
                        <button type="button" id="btn-trf-empty-create" class="trf-btn trf-btn-primary">
                          <i class="ri-add-circle-line"></i> Crear Primera Transferencia
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ` : filtered.map(t => {
                const items = Array.isArray(t.items) ? t.items : [];
                const previewSkus = items.slice(0, 2).map(i => `${i.sku} (${i.quantity_sent || i.quantity_requested}u)`).join(', ');
                const extraSkus = items.length > 2 ? ` +${items.length - 2} más` : '';
                const isRec = t.status === 'Recepcionada' || t.status === 'Con Diferencias';

                let stockImpactSub = '';
                if (t.status === 'Solicitada') stockImpactSub = `Reserva activa: ${t.total_requested} uds en ${t.source_warehouse_name}`;
                else if (t.status === 'En Tránsito') stockImpactSub = `${t.total_sent} uds en tránsito hacia ${t.dest_warehouse_name}`;
                else if (isRec) stockImpactSub = `+${t.total_received}/${t.total_sent} uds ingresadas en ${t.dest_warehouse_name}`;
                else stockImpactSub = `Stock reintegrado / sin efecto`;

                return `
                  <tr>
                    <td>
                      <div style="display:flex; align-items:center; gap:0.45rem;">
                        <a href="#" class="trf-link-detail" data-id="${escHtml(t.id)}" style="font-family:monospace; font-weight:900; font-size:0.92rem; color:#6366f1; text-decoration:none;">
                          #${escHtml(t.folio)}
                        </a>
                        ${t.priority === 'Urgente' ? `<span class="trf-pill trf-pill-rose" style="padding:1px 6px; font-size:0.65rem;"><i class="ri-fire-fill"></i> URGENTE</span>` : ''}
                      </div>
                      <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:3px;">${formatDateTimeCL(t.requested_at || t.created_at)}</div>
                      ${t.title ? `<div style="font-size:0.74rem; color:var(--trf-text); opacity:0.85; font-weight:600; margin-top:2px; max-width:210px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escHtml(t.title)}">${escHtml(t.title)}</div>` : ''}
                    </td>

                    <td>
                      <div style="font-weight:800; color:var(--trf-text);">${escHtml(t.comercio)}</div>
                      <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:2px; font-family:monospace;">${escHtml(previewSkus)}${escHtml(extraSkus)}</div>
                    </td>

                    <td>
                      <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
                        ${getWarehousePillHtml(t.source_warehouse_name, 'origin')}
                        <span style="font-size:0.68rem; color:var(--trf-muted); padding-left:8px; display:flex; align-items:center; gap:3px;">
                          <i class="ri-arrow-down-line"></i> hacia destino
                        </span>
                        ${getWarehousePillHtml(t.dest_warehouse_name, 'dest')}
                      </div>
                    </td>

                    <td style="text-align:center;">
                      <div style="font-weight:800; color:var(--trf-text);">${items.length} SKU${items.length === 1 ? '' : 's'}</div>
                      <div style="font-size:0.79rem; color:var(--trf-muted); margin-top:2px;">
                        ${isRec
                          ? `<strong style="color:${t.total_received !== t.total_sent ? '#f87171' : '#10b981'};">${t.total_received}</strong> / ${t.total_sent} uds`
                          : `<strong style="color:var(--trf-text);">${t.total_sent || t.total_requested}</strong> uds`
                        }
                      </div>
                    </td>

                    <td style="font-size:0.76rem; line-height:1.5;">
                      <div><span style="color:var(--trf-muted);">Solicitó:</span> <strong style="color:var(--trf-text);">${escHtml(t.requested_by_name || '-')}</strong></div>
                      <div><span style="color:var(--trf-muted);">Despachó:</span> <strong style="color:${t.dispatched_by_name ? '#38bdf8' : 'var(--trf-muted)'};">${escHtml(t.dispatched_by_name || 'Pendiente')}</strong></div>
                      <div><span style="color:var(--trf-muted);">Recepcionó:</span> <strong style="color:${t.received_by_name ? '#10b981' : 'var(--trf-muted)'};">${escHtml(t.received_by_name || 'Pendiente')}</strong></div>
                      ${t.last_edited_by_name ? `<div style="color:#a78bfa; font-size:0.71rem; margin-top:2px;"><i class="ri-edit-2-line"></i> Ajustado por: <strong>${escHtml(t.last_edited_by_name)}</strong></div>` : ''}
                    </td>

                    <td>
                      ${getStatusBadgeHtml(t.status)}
                      <div style="font-size:0.72rem; color:var(--trf-muted); margin-top:5px; font-weight:600;">${escHtml(stockImpactSub)}</div>
                    </td>

                    <td style="text-align:right;">
                      <div style="display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap;">
                        ${t.status === 'Solicitada' ? `
                          <button type="button" class="trf-btn trf-btn-action" data-id="${escHtml(t.id)}" data-mode="dispatch" style="height:32px; padding:0 0.7rem; font-size:0.74rem; background:#0284c7; color:#fff; border-color:#0284c7;" title="Despachar a ruta y rebajar stock físico en origen">
                            <i class="ri-truck-line"></i> Despachar
                          </button>
                          <button type="button" class="trf-btn trf-btn-action" data-id="${escHtml(t.id)}" data-mode="receive" style="height:32px; padding:0 0.7rem; font-size:0.74rem; background:#10b981; color:#fff; border-color:#10b981;" title="Marcar como Recepcionado directamente">
                            <i class="ri-checkbox-circle-line"></i> Recepcionar
                          </button>
                          <button type="button" class="trf-btn trf-btn-action" data-id="${escHtml(t.id)}" data-mode="edit" style="height:32px; padding:0 0.65rem; font-size:0.74rem;" title="Editar cantidades solicitadas">
                            <i class="ri-edit-line"></i> Editar
                          </button>
                        ` : ''}

                        ${t.status === 'En Tránsito' ? `
                          <button type="button" class="trf-btn trf-btn-action" data-id="${escHtml(t.id)}" data-mode="receive" style="height:32px; padding:0 0.8rem; font-size:0.75rem; background:#10b981; color:#fff; border-color:#10b981; box-shadow:0 2px 8px rgba(16,185,129,0.28);">
                            <i class="ri-checkbox-circle-line"></i> Marcar Recepcionado
                          </button>
                          <button type="button" class="trf-btn trf-btn-action" data-id="${escHtml(t.id)}" data-mode="edit" style="height:32px; padding:0 0.65rem; font-size:0.74rem;" title="Editar unidades enviadas en tránsito">
                            <i class="ri-edit-line"></i> Editar Envío
                          </button>
                        ` : ''}

                        ${isRec ? `
                          <button type="button" class="trf-btn trf-btn-action" data-id="${escHtml(t.id)}" data-mode="correct" style="height:32px; padding:0 0.75rem; font-size:0.74rem; border-color:rgba(139,92,246,0.45); color:#a78bfa; background:rgba(139,92,246,0.12);" title="Corregir un ingreso ya recepcionado y ajustar niveles de stock automáticamente">
                            <i class="ri-tools-line"></i> Corregir Ingreso
                          </button>
                        ` : ''}

                        <button type="button" class="trf-btn trf-btn-action" data-id="${escHtml(t.id)}" data-mode="view" style="height:32px; padding:0 0.65rem; font-size:0.74rem;" title="Ver detalle completo, historial y guía">
                          <i class="ri-eye-line"></i> Detalle
                        </button>

                        <button type="button" class="trf-btn trf-btn-revert-delete" data-id="${escHtml(t.id)}" data-folio="${escHtml(t.folio)}" style="height:32px; padding:0 0.6rem; font-size:0.74rem; color:#f87171; border-color:rgba(239,68,68,0.35); background:rgba(239,68,68,0.08);" title="Revertir stock y eliminar esta transferencia">
                          <i class="ri-delete-bin-line"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  // Eventos del Dashboard
  const bindClick = (sel, fn) => {
    const el = container.querySelector(sel);
    if (el) el.onclick = fn;
  };

  bindClick('#btn-trf-toggle-guide', () => {
    state.showWorkflowGuide = !state.showWorkflowGuide;
    renderStockTransfersAdmin(containerOverride);
  });
  bindClick('#btn-trf-sql-helper', () => openStockTransfersSqlModal());
  bindClick('#btn-trf-open-sql-banner', () => openStockTransfersSqlModal());
  bindClick('#btn-trf-refresh', () => renderStockTransfersAdmin(containerOverride));
  bindClick('#btn-trf-new-request', () => window.openEnhancedStockTransferModal(state.filterCommerce || window.activeAdminInventoryCommerce || '', [], () => renderStockTransfersAdmin(containerOverride)));
  bindClick('#btn-trf-empty-create', () => window.openEnhancedStockTransferModal(state.filterCommerce || window.activeAdminInventoryCommerce || '', [], () => renderStockTransfersAdmin(containerOverride)));

  const resetAllFilters = () => {
    state.filterStatus = 'ALL';
    state.filterCommerce = '';
    state.filterSourceWh = '';
    state.filterDestWh = '';
    state.searchQuery = '';
    renderStockTransfersAdmin(containerOverride);
  };
  bindClick('#btn-trf-clear-filters', resetAllFilters);
  bindClick('#btn-trf-empty-clear', resetAllFilters);

  container.querySelectorAll('.trf-kpi-card').forEach(card => {
    card.onclick = () => {
      const targetSt = card.getAttribute('data-status-click');
      state.filterStatus = state.filterStatus === targetSt ? 'ALL' : targetSt;
      renderStockTransfersAdmin(containerOverride);
    };
  });

  container.querySelectorAll('.trf-status-pill-btn').forEach(btn => {
    btn.onclick = () => {
      state.filterStatus = btn.getAttribute('data-status') || 'ALL';
      renderStockTransfersAdmin(containerOverride);
    };
  });

  const searchInp = container.querySelector('#trf-search-input');
  if (searchInp) {
    searchInp.oninput = (e) => {
      state.searchQuery = e.target.value;
      clearTimeout(window._trfSearchDebounce);
      window._trfSearchDebounce = setTimeout(() => {
        renderStockTransfersAdmin(containerOverride);
      }, 260);
    };
  }

  const commSel = container.querySelector('#trf-filter-commerce');
  if (commSel) {
    commSel.onchange = (e) => {
      state.filterCommerce = e.target.value;
      renderStockTransfersAdmin(containerOverride);
    };
  }

  const srcSel = container.querySelector('#trf-filter-source-wh');
  if (srcSel) {
    srcSel.onchange = (e) => {
      state.filterSourceWh = e.target.value;
      renderStockTransfersAdmin(containerOverride);
    };
  }

  const dstSel = container.querySelector('#trf-filter-dest-wh');
  if (dstSel) {
    dstSel.onchange = (e) => {
      state.filterDestWh = e.target.value;
      renderStockTransfersAdmin(containerOverride);
    };
  }

  container.querySelectorAll('.trf-link-detail').forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      window.openTransferDetailModal(link.getAttribute('data-id'), 'view', () => renderStockTransfersAdmin(containerOverride));
    };
  });

  container.querySelectorAll('.trf-btn-action').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const mode = btn.getAttribute('data-mode') || 'view';
      window.openTransferDetailModal(id, mode, () => renderStockTransfersAdmin(containerOverride));
    };
  });

  container.querySelectorAll('.trf-btn-revert-delete').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const folio = btn.getAttribute('data-folio') || id;
      const ok = confirm(`¿Deseas eliminar la transferencia #${folio} y revertir su impacto en el inventario de origen y destino?`);
      if (!ok) return;
      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
        await revertAndDeleteStockTransferOrder(id, true);
        if (typeof window.showToast === 'function') {
          window.showToast(`🗑️ Transferencia #${folio} eliminada y niveles de stock revertidos.`, 'info');
        }
        renderStockTransfersAdmin(containerOverride);
      } catch (err) {
        alert('Error al eliminar transferencia: ' + (err.message || err));
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-delete-bin-line"></i>';
      }
    };
  });
}
window.renderStockTransfersAdmin = renderStockTransfersAdmin;


// ============================================================================
// PARTE 3B: MODAL INSPECTOR (RECEPCIONAR / EDITAR / CORREGIR INGRESO) Y MODAL DE SOLICITUD
// ============================================================================

/**
 * MODAL INSPECTOR 360° DE TRANSFERENCIA:
 * Soporta modos:
 *  - 'view'     : Vista detallada, cadena de custodia y bitácora de auditoría
 *  - 'dispatch' : Confirmar salida de bodega de origen ('Solicitada' -> 'En Tránsito')
 *  - 'receive'  : Marcar como Recepcionado en destino ('En Tránsito'/'Solicitada' -> 'Recepcionada'/'Con Diferencias')
 *  - 'edit'     : Editar cantidades según su estado ('Solicitada' o 'En Tránsito')
 *  - 'correct'  : Corregir un Ingreso / Recepción ya cerrada ('Recepcionada'/'Con Diferencias') con ajuste Delta
 */
export async function openTransferDetailModal(transferIdOrFolio, initialMode = 'view', onUpdatedCallback = null) {
  injectStockTransfersStyles();
  const list = await fetchAllStockTransfers(false);
  const transfer = list.find(t =>
    String(t.id) === String(transferIdOrFolio) ||
    String(t.folio).toUpperCase() === String(transferIdOrFolio).replace(/^#/, '').toUpperCase()
  );

  if (!transfer) {
    if (typeof window.showToast === 'function') {
      window.showToast(`No se encontró la transferencia ${transferIdOrFolio}`, 'warning');
    } else {
      alert(`No se encontró la transferencia ${transferIdOrFolio}`);
    }
    return;
  }

  const adminUser = await resolveCurrentAdminIdentity();
  const isReceivedState = transfer.status === 'Recepcionada' || transfer.status === 'Con Diferencias';

  // Determinar modo activo válido según el estado
  let activeMode = initialMode || 'view';
  if (activeMode === 'dispatch' && transfer.status !== 'Solicitada') activeMode = 'view';
  if (activeMode === 'receive' && isReceivedState) activeMode = 'correct';
  if (activeMode === 'edit' && isReceivedState) activeMode = 'correct';
  if (transfer.status === 'Cancelada') activeMode = 'view';

  const existing = document.getElementById('modal-transfer-detail-360');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-transfer-detail-360';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(7,10,19,0.78); backdrop-filter:blur(5px); z-index:10020; display:flex; align-items:center; justify-content:center; padding:1rem;';
  document.body.appendChild(overlay);

  const renderModalContent = () => {
    const items = Array.isArray(transfer.items) ? transfer.items : [];
    const history = Array.isArray(transfer.history) ? [...transfer.history].reverse() : [];

    const step1Done = true;
    const step2Done = transfer.status === 'En Tránsito' || isReceivedState;
    const step3Done = isReceivedState;

    overlay.innerHTML = `
      <div class="trf-modal-shell" style="max-width:980px; max-height:92vh;">
        <!-- Cabecera -->
        <div style="padding:1.15rem 1.5rem; background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color:#fff; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
          <div>
            <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
              <span style="font-family:monospace; font-size:1.22rem; font-weight:900; color:#818cf8;">#${escHtml(transfer.folio)}</span>
              ${getStatusBadgeHtml(transfer.status)}
              <span class="trf-pill trf-pill-indigo" style="background:rgba(255,255,255,0.12); color:#fff; border-color:rgba(255,255,255,0.2);">
                <i class="ri-store-2-line"></i> ${escHtml(transfer.comercio)}
              </span>
            </div>
            <div style="font-size:0.81rem; color:#94a3b8; margin-top:5px; display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
              <span>Ruta:</span>
              <strong style="color:#fff;">${escHtml(transfer.source_warehouse_name)}</strong>
              <i class="ri-arrow-right-line" style="color:#818cf8;"></i>
              <strong style="color:#38bdf8;">${escHtml(transfer.dest_warehouse_name)}</strong>
              ${transfer.title ? `<span>· ${escHtml(transfer.title)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <button type="button" id="btn-trf-modal-print" style="background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
              <i class="ri-printer-line"></i> Imprimir Guía
            </button>
            <button type="button" id="btn-trf-modal-close" style="background:rgba(255,255,255,0.1); border:none; color:#fff; width:34px; height:34px; border-radius:8px; cursor:pointer; font-size:1rem; font-weight:700;">✕</button>
          </div>
        </div>

        <!-- Barra de Modos Operativos -->
        <div class="trf-modal-subbar">
          <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
            <button type="button" class="trf-btn trf-mode-tab" data-mode="view" style="height:34px; font-size:0.78rem; ${activeMode === 'view' ? 'background:#4f46e5; color:#fff; border-color:#4f46e5;' : ''}">
              <i class="ri-eye-line"></i> Resumen y Auditoría
            </button>

            ${transfer.status === 'Solicitada' ? `
              <button type="button" class="trf-btn trf-mode-tab" data-mode="dispatch" style="height:34px; font-size:0.78rem; ${activeMode === 'dispatch' ? 'background:#0284c7; color:#fff; border-color:#0284c7;' : 'color:#38bdf8; border-color:rgba(56,189,248,0.4);'}">
                <i class="ri-truck-line"></i> 1. Despachar a Ruta
              </button>
            ` : ''}

            ${(transfer.status === 'Solicitada' || transfer.status === 'En Tránsito') ? `
              <button type="button" class="trf-btn trf-mode-tab" data-mode="receive" style="height:34px; font-size:0.78rem; ${activeMode === 'receive' ? 'background:#10b981; color:#fff; border-color:#10b981;' : 'color:#10b981; border-color:rgba(16,185,129,0.4);'}">
                <i class="ri-checkbox-circle-line"></i> Marcar como Recepcionado
              </button>
              <button type="button" class="trf-btn trf-mode-tab" data-mode="edit" style="height:34px; font-size:0.78rem; ${activeMode === 'edit' ? 'background:#6366f1; color:#fff; border-color:#6366f1;' : ''}">
                <i class="ri-edit-line"></i> Editar (${escHtml(transfer.status)})
              </button>
            ` : ''}

            ${isReceivedState ? `
              <button type="button" class="trf-btn trf-mode-tab" data-mode="correct" style="height:34px; font-size:0.78rem; ${activeMode === 'correct' ? 'background:#7c3aed; color:#fff; border-color:#7c3aed;' : 'color:#a78bfa; border-color:rgba(167,139,250,0.4);'}">
                <i class="ri-tools-line"></i> Corregir un Ingreso / Recepción
              </button>
            ` : ''}
          </div>

          ${(transfer.status === 'Solicitada' || transfer.status === 'En Tránsito') ? `
            <button type="button" id="btn-trf-cancel-order" class="trf-btn" style="height:32px; padding:0 0.75rem; font-size:0.74rem; border-color:rgba(239,68,68,0.4); color:#f87171; background:rgba(239,68,68,0.1);">
              <i class="ri-close-circle-line"></i> Anular Transferencia
            </button>
          ` : ''}
        </div>

        <!-- Cuerpo desplazable -->
        <div style="padding:1.25rem 1.5rem; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:1.15rem; background:var(--trf-surface);">
          <!-- Stepper de 3 Etapas y Cadena de Responsables -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:0.85rem;">
            <div class="trf-step-card" style="border-left:4px solid #f59e0b;">
              <div style="font-size:0.69rem; font-weight:800; text-transform:uppercase; color:#f59e0b;">1. Quién Solicitó (Origen: ${escHtml(transfer.source_warehouse_name)})</div>
              <div style="font-size:0.92rem; font-weight:800; color:var(--trf-text); margin-top:4px; display:flex; align-items:center; gap:0.35rem;">
                <i class="ri-user-star-line" style="color:#f59e0b;"></i> ${escHtml(transfer.requested_by_name || '-')}
              </div>
              <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:2px;">${formatDateTimeCL(transfer.requested_at)}</div>
              <div style="font-size:0.72rem; color:#f59e0b; margin-top:5px; font-weight:700;">
                ${transfer.status === 'Solicitada' ? `Reserva activa: ${transfer.total_requested} uds en ${escHtml(transfer.source_warehouse_name)}` : `Reserva procesada (${transfer.total_requested} uds solicitadas)`}
              </div>
            </div>

            <div class="trf-step-card" style="border-left:4px solid ${step2Done ? '#38bdf8' : 'var(--trf-border)'};">
              <div style="font-size:0.69rem; font-weight:800; text-transform:uppercase; color:#38bdf8;">2. Quién Despachó (Salida Física + Kardex OUT)</div>
              <div style="font-size:0.92rem; font-weight:800; color:var(--trf-text); margin-top:4px; display:flex; align-items:center; gap:0.35rem;">
                <i class="ri-truck-line" style="color:#38bdf8;"></i> ${escHtml(transfer.dispatched_by_name || 'Pendiente de Despacho')}
              </div>
              <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:2px;">${formatDateTimeCL(transfer.dispatched_at)}</div>
              <div style="font-size:0.72rem; color:#38bdf8; margin-top:5px; font-weight:700;">
                ${transfer.status === 'En Tránsito' ? `${transfer.total_sent} uds actualmente en tránsito` : (step2Done ? `${transfer.total_sent} uds despachadas de origen` : 'Esperando salida de origen')}
              </div>
            </div>

            <div class="trf-step-card" style="border-left:4px solid ${step3Done ? '#10b981' : 'var(--trf-border)'};">
              <div style="font-size:0.69rem; font-weight:800; text-transform:uppercase; color:#10b981;">3. Quién Recepcionó (Destino: ${escHtml(transfer.dest_warehouse_name)})</div>
              <div style="font-size:0.92rem; font-weight:800; color:var(--trf-text); margin-top:4px; display:flex; align-items:center; gap:0.35rem;">
                <i class="ri-user-follow-line" style="color:#10b981;"></i> ${escHtml(transfer.received_by_name || 'Pendiente de Recepción')}
              </div>
              <div style="font-size:0.73rem; color:var(--trf-muted); margin-top:2px;">${formatDateTimeCL(transfer.received_at)}</div>
              <div style="font-size:0.72rem; color:#10b981; margin-top:5px; font-weight:700;">
                ${step3Done ? `+${transfer.total_received} uds ingresadas al físico de ${escHtml(transfer.dest_warehouse_name)}` : 'Pendiente de marcar como recepcionado'}
              </div>
            </div>
          </div>

          <!-- Banner contextual según el Modo Activo -->
          ${activeMode === 'dispatch' ? `
            <div style="background:rgba(2,132,199,0.12); border:1px solid rgba(56,189,248,0.35); border-radius:11px; padding:0.9rem 1.1rem; color:var(--trf-text); font-size:0.82rem;">
              <strong style="color:#38bdf8;"><i class="ri-truck-line"></i> Modo Despacho a Ruta:</strong> Al confirmar, se liberará la reserva en <strong>${escHtml(transfer.source_warehouse_name)}</strong>, se descontará el Stock Físico enviado (generando movimiento <code>SALIDA</code> en Kardex) y las unidades quedarán como <strong>Stock en Tránsito</strong> hacia <strong>${escHtml(transfer.dest_warehouse_name)}</strong>.
            </div>
          ` : ''}

          ${activeMode === 'receive' ? `
            <div style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); border-radius:11px; padding:0.9rem 1.1rem; color:var(--trf-text); font-size:0.82rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
              <div>
                <strong style="color:#10b981;"><i class="ri-inbox-archive-line"></i> Modo Recepción en Bodega Destino (${escHtml(transfer.dest_warehouse_name)}):</strong> Ingresa las unidades efectivamente recibidas por SKU. El sistema sumará el stock físico en <strong>${escHtml(transfer.dest_warehouse_name)}</strong> y registrará la <code>ENTRADA</code> en Kardex.
              </div>
              <button type="button" id="btn-trf-fill-100" class="trf-btn" style="background:#10b981; color:#fff; border-color:#10b981; height:32px; font-size:0.76rem;">
                <i class="ri-check-double-line"></i> Cuadrar Todo al 100%
              </button>
            </div>
          ` : ''}

          ${activeMode === 'edit' ? `
            <div style="background:rgba(99,102,241,0.12); border:1px solid rgba(99,102,241,0.35); border-radius:11px; padding:0.9rem 1.1rem; color:var(--trf-text); font-size:0.82rem;">
              <strong style="color:#818cf8;"><i class="ri-edit-line"></i> Editar Transferencia en estado «${escHtml(transfer.status)}»:</strong> Cualquier cambio en las cantidades ajustará automáticamente ${transfer.status === 'Solicitada' ? `la reserva de unidades en <strong>${escHtml(transfer.source_warehouse_name)}</strong>` : `el stock físico descontado en <strong>${escHtml(transfer.source_warehouse_name)}</strong> y las unidades en tránsito hacia <strong>${escHtml(transfer.dest_warehouse_name)}</strong>`}.
            </div>
          ` : ''}

          ${activeMode === 'correct' ? `
            <div style="background:rgba(139,92,246,0.12); border:1px solid rgba(167,139,250,0.35); border-radius:11px; padding:0.9rem 1.1rem; color:var(--trf-text); font-size:0.82rem;">
              <strong style="color:#a78bfa;"><i class="ri-tools-line"></i> Corregir un Ingreso / Recepción Post-Cierre:</strong> Modifica la columna <strong>«Nuevo Recepcionado»</strong> si hubo un error de conteo o digitación al recepcionar. El sistema calculará la diferencia matemática (Δ) y ajustará automáticamente el stock físico en <strong>${escHtml(transfer.dest_warehouse_name)}</strong> (y el reintegro en <strong>${escHtml(transfer.source_warehouse_name)}</strong>) dejando constancia en el Kardex.
            </div>
          ` : ''}

          <!-- Tabla de SKUs del Traslado -->
          <div class="trf-table-card">
            <table class="trf-table">
              <thead>
                <tr>
                  <th>SKU / Producto</th>
                  <th style="text-align:center;">Solicitado</th>
                  <th style="text-align:center;">
                    ${activeMode === 'dispatch' || (activeMode === 'edit' && transfer.status === 'En Tránsito') ? 'A Enviar (Editable)' : 'Enviado'}
                  </th>
                  <th style="text-align:center;">
                    ${activeMode === 'receive' ? 'Cant. Recepcionada' : (activeMode === 'correct' ? 'Nuevo Recepcionado' : 'Recepcionado')}
                  </th>
                  ${activeMode === 'correct' ? `<th style="text-align:center;">Ajuste Stock (Δ)</th>` : ''}
                  <th>Ubicación en Destino</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(it => {
                  const reqQ = Number(it.quantity_requested || 0);
                  const sentQ = Number(it.quantity_sent || reqQ || 0);
                  const recQ = Number(it.quantity_received || 0);

                  return `
                    <tr class="trf-item-row" data-product-id="${escHtml(it.product_id)}" data-old-req="${reqQ}" data-old-sent="${sentQ}" data-old-rec="${recQ}">
                      <td>
                        <div style="font-family:monospace; font-weight:800; color:var(--trf-text);">${escHtml(it.sku)}</div>
                        <div style="font-size:0.76rem; color:var(--trf-muted);">${escHtml(it.product_name)}</div>
                      </td>

                      <!-- Columna Solicitado -->
                      <td style="text-align:center; font-weight:700;">
                        ${activeMode === 'edit' && transfer.status === 'Solicitada' ? `
                          <input type="number" min="0" class="trf-input trf-inp-req" value="${reqQ}" style="width:92px; height:34px; margin:0 auto; text-align:center; font-weight:800;">
                        ` : reqQ}
                      </td>

                      <!-- Columna Enviado -->
                      <td style="text-align:center; font-weight:700;">
                        ${(activeMode === 'dispatch' || (activeMode === 'edit' && transfer.status === 'En Tránsito')) ? `
                          <input type="number" min="0" class="trf-input trf-inp-sent" value="${sentQ}" style="width:92px; height:34px; margin:0 auto; text-align:center; font-weight:800; border-color:#38bdf8;">
                        ` : sentQ}
                      </td>

                      <!-- Columna Recepcionado -->
                      <td style="text-align:center; font-weight:700;">
                        ${activeMode === 'receive' ? `
                          <input type="number" min="0" class="trf-input trf-inp-rec" value="${sentQ}" style="width:96px; height:34px; margin:0 auto; text-align:center; font-weight:800; border:2px solid #10b981;">
                        ` : (activeMode === 'correct' ? `
                          <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                            <span style="font-size:0.74rem; color:var(--trf-muted); text-decoration:line-through;" title="Cantidad recepcionada anterior">${recQ}</span>
                            <i class="ri-arrow-right-line" style="color:var(--trf-muted);"></i>
                            <input type="number" min="0" class="trf-input trf-inp-rec-correct" value="${recQ}" style="width:92px; height:34px; text-align:center; font-weight:800; border:2px solid #8b5cf6;">
                          </div>
                        ` : (isReceivedState ? `<span style="color:${recQ !== sentQ ? '#f87171' : '#10b981'}; font-weight:900;">${recQ}</span>` : '<span style="color:var(--trf-muted);">Pendiente</span>'))}
                      </td>

                      ${activeMode === 'correct' ? `
                        <td class="trf-cell-delta" style="text-align:center; font-weight:800; font-size:0.78rem; color:var(--trf-muted);">
                          0 uds (Sin cambio)
                        </td>
                      ` : ''}

                      <td>
                        ${activeMode !== 'view' ? `
                          <input type="text" class="trf-input trf-inp-loc" placeholder="Ej: Pasillo B - Rack 2" value="${escHtml(it.dest_location_hint || '')}" style="height:34px; font-size:0.78rem;">
                        ` : `<span style="font-size:0.78rem; color:var(--trf-muted);">${escHtml(it.dest_location_hint || '-')}</span>`}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          <!-- Formulario de Responsable y Auditoría según Modo -->
          ${activeMode !== 'view' ? `
            <div class="trf-step-card" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:0.9rem;">
              <div>
                <label class="trf-field-label">
                  <i class="ri-user-line"></i>
                  ${activeMode === 'dispatch' ? 'Despachado por (Bodega Origen)' : (activeMode === 'receive' ? 'Recepcionado por (Bodega Destino)' : 'Responsable de Edición / Corrección')}
                </label>
                <input type="text" id="trf-form-actor" class="trf-input" value="${escHtml(adminUser.name || 'Administrador')}">
              </div>

              ${activeMode === 'dispatch' ? `
                <div>
                  <label class="trf-field-label"><i class="ri-steering-2-line"></i> Transporte / Patente / Chofer</label>
                  <input type="text" id="trf-form-carrier" class="trf-input" placeholder="Ej: Furgón Interno / Starken" value="${escHtml(transfer.carrier_info || '')}">
                </div>
                <div>
                  <label class="trf-field-label"><i class="ri-archive-line"></i> N° de Bultos / Pallets</label>
                  <input type="number" min="1" id="trf-form-packages" class="trf-input" value="${Number(transfer.package_count || 1)}">
                </div>
              ` : ''}

              ${(activeMode === 'receive' || activeMode === 'correct') ? `
                <div>
                  <label class="trf-field-label"><i class="ri-scales-3-line"></i> Política ante Diferencias (Recibido ≠ Enviado)</label>
                  <select id="trf-form-policy" class="trf-select">
                    <option value="return_origin" ${(transfer.discrepancy_policy || 'return_origin') === 'return_origin' ? 'selected' : ''}>
                      Reintegrar/Sincronizar diferencia con Bodega Origen (${escHtml(transfer.source_warehouse_name)})
                    </option>
                    <option value="incident_loss" ${transfer.discrepancy_policy === 'incident_loss' ? 'selected' : ''}>
                      Registrar faltante como Merma / Extravío en Tránsito (No devolver a origen)
                    </option>
                  </select>
                </div>
              ` : ''}

              <div style="grid-column:1 / -1;">
                <label class="trf-field-label">
                  <i class="ri-file-list-3-line"></i>
                  ${activeMode === 'edit' || activeMode === 'correct' ? 'Motivo Obligatorio de Edición / Corrección (Auditoría Kardex) *' : 'Observaciones / Notas de Recepción o Despacho'}
                </label>
                <input type="text" id="trf-form-notes" class="trf-input" placeholder="${activeMode === 'correct' ? 'Ej: Se recontó pallet en CDD La Reina, llegaron 48 uds en vez de 45...' : 'Opcional: comentarios del movimiento...'}" value="">
              </div>
            </div>
          ` : ''}

          <!-- Bitácora de Trazabilidad e Historial de Cambios -->
          <div class="trf-step-card">
            <h4 style="margin:0 0 0.75rem 0; font-size:0.79rem; font-weight:800; text-transform:uppercase; color:var(--trf-muted); display:flex; align-items:center; gap:0.4rem;">
              <i class="ri-history-line" style="color:#6366f1;"></i> Bitácora de Auditoría y Ajustes de Stock (${history.length} eventos)
            </h4>
            <div style="display:flex; flex-direction:column; gap:0.55rem; max-height:190px; overflow-y:auto;">
              ${history.map(h => `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.75rem; padding:0.6rem 0.8rem; background:var(--trf-surface); border:1px solid var(--trf-border); border-left:3px solid ${h.action === 'corrected_reception' ? '#8b5cf6' : (h.action === 'received' ? '#10b981' : (h.action === 'dispatched' ? '#38bdf8' : '#f59e0b'))}; border-radius:8px; font-size:0.78rem;">
                  <div>
                    <strong style="color:var(--trf-text);">${escHtml(h.actor || 'Admin')}</strong>
                    <span style="color:var(--trf-muted);"> · ${escHtml(h.status || '')}:</span>
                    <div style="color:var(--trf-text); opacity:0.9; margin-top:2px;">${escHtml(h.detail || '')}</div>
                  </div>
                  <div style="font-size:0.71rem; color:var(--trf-muted); white-space:nowrap;">${formatDateTimeCL(h.timestamp)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Pie de Modal -->
        <div class="trf-modal-footer">
          <div style="font-size:0.76rem; color:var(--trf-muted);">
            Folio Kardex: <code style="color:#6366f1; font-weight:800;">[#${escHtml(transfer.folio)}]</code>
          </div>
          <div style="display:flex; gap:0.6rem;">
            <button type="button" id="btn-trf-footer-close" class="trf-btn">Cerrar</button>
            ${activeMode === 'dispatch' ? `
              <button type="button" id="btn-trf-submit-action" class="trf-btn trf-btn-primary" style="background:#0284c7; border-color:#0284c7;">
                <i class="ri-truck-line"></i> Confirmar Salida y Poner En Tránsito
              </button>
            ` : ''}
            ${activeMode === 'receive' ? `
              <button type="button" id="btn-trf-submit-action" class="trf-btn trf-btn-primary" style="background:#10b981; border-color:#10b981;">
                <i class="ri-checkbox-circle-line"></i> Confirmar Recepción y Sumar Stock en ${escHtml(transfer.dest_warehouse_name)}
              </button>
            ` : ''}
            ${activeMode === 'edit' ? `
              <button type="button" id="btn-trf-submit-action" class="trf-btn trf-btn-primary">
                <i class="ri-save-3-line"></i> Guardar Edición y Ajustar Reserva/Tránsito
              </button>
            ` : ''}
            ${activeMode === 'correct' ? `
              <button type="button" id="btn-trf-submit-action" class="trf-btn trf-btn-primary" style="background:#7c3aed; border-color:#7c3aed;">
                <i class="ri-tools-line"></i> Aplicar Corrección de Ingreso y Ajustar Stock (Δ)
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    // Bindings internos del modal con protección de cambios sin guardar
    const confirmAndCloseDetailModal = () => {
      if (activeMode !== 'view') {
        const ok = confirm('¿Estás seguro de que deseas cerrar esta ventana? Se descartarán las cantidades o cambios no guardados.');
        if (!ok) return;
      }
      overlay.remove();
    };

    overlay.querySelector('#btn-trf-modal-close').onclick = confirmAndCloseDetailModal;
    overlay.querySelector('#btn-trf-footer-close').onclick = confirmAndCloseDetailModal;
    overlay.querySelector('#btn-trf-modal-print').onclick = () => printStockTransferGuide(transfer.id);

    overlay.querySelectorAll('.trf-mode-tab').forEach(tab => {
      tab.onclick = () => {
        activeMode = tab.getAttribute('data-mode') || 'view';
        renderModalContent();
      };
    });

    const btnFill100 = overlay.querySelector('#btn-trf-fill-100');
    if (btnFill100) {
      btnFill100.onclick = () => {
        overlay.querySelectorAll('.trf-item-row').forEach(row => {
          const sent = Number(row.getAttribute('data-old-sent') || 0);
          const inp = row.querySelector('.trf-inp-rec');
          if (inp) inp.value = String(sent);
        });
      };
    }

    // Cálculo en vivo de Delta en modo 'correct'
    if (activeMode === 'correct') {
      overlay.querySelectorAll('.trf-item-row').forEach(row => {
        const oldRec = Number(row.getAttribute('data-old-rec') || 0);
        const inp = row.querySelector('.trf-inp-rec-correct');
        const cellDelta = row.querySelector('.trf-cell-delta');
        if (inp && cellDelta) {
          inp.oninput = () => {
            const newRec = Math.max(0, Number(inp.value || 0));
            const delta = newRec - oldRec;
            if (delta === 0) {
              cellDelta.textContent = '0 uds (Sin cambio)';
              cellDelta.style.color = 'var(--trf-muted)';
            } else if (delta > 0) {
              cellDelta.textContent = `+${delta} uds en ${transfer.dest_warehouse_name}`;
              cellDelta.style.color = '#10b981';
            } else {
              cellDelta.textContent = `${delta} uds en ${transfer.dest_warehouse_name}`;
              cellDelta.style.color = '#f87171';
            }
          };
        }
      });
    }

    // Botón Anular Transferencia
    const btnCancel = overlay.querySelector('#btn-trf-cancel-order');
    if (btnCancel) {
      btnCancel.onclick = async () => {
        const reason = prompt(`¿Por qué deseas anular la transferencia #${transfer.folio}?\n(El stock reservado o en tránsito será devuelto automáticamente a ${transfer.source_warehouse_name}):`, 'Cancelación operativa');
        if (reason === null) return;
        try {
          btnCancel.disabled = true;
          btnCancel.textContent = 'Anulando...';
          await cancelStockTransferOrder(transfer.id, adminUser.name, reason);
          if (typeof window.showToast === 'function') window.showToast(`Transferencia #${transfer.folio} anulada y stock restaurado.`, 'success');
          overlay.remove();
          if (typeof onUpdatedCallback === 'function') onUpdatedCallback();
          else if (document.getElementById('admin-inv-transfers-container')) renderStockTransfersAdmin();
        } catch (err) {
          alert('Error al cancelar transferencia: ' + err.message);
          btnCancel.disabled = false;
        }
      };
    }

    // Botón de acción principal según modo
    const btnSubmit = overlay.querySelector('#btn-trf-submit-action');
    if (btnSubmit) {
      btnSubmit.onclick = async () => {
        const actor = (overlay.querySelector('#trf-form-actor')?.value || adminUser.name || 'Administrador').trim();
        const notes = (overlay.querySelector('#trf-form-notes')?.value || '').trim();
        const policy = overlay.querySelector('#trf-form-policy')?.value || 'return_origin';

        try {
          btnSubmit.disabled = true;
          const origText = btnSubmit.innerHTML;
          btnSubmit.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Procesando ajuste de stock y Kardex...';

          if (activeMode === 'dispatch') {
            const sentMap = {};
            overlay.querySelectorAll('.trf-item-row').forEach(row => {
              const pid = row.getAttribute('data-product-id');
              const val = Number(row.querySelector('.trf-inp-sent')?.value ?? row.getAttribute('data-old-sent'));
              sentMap[pid] = Math.max(0, val);
            });
            const carrier = overlay.querySelector('#trf-form-carrier')?.value || '';
            const pkgs = overlay.querySelector('#trf-form-packages')?.value || 1;

            await dispatchStockTransferOrder({
              transferId: transfer.id,
              itemsSentMap: sentMap,
              dispatchedByName: actor,
              carrierInfo: carrier,
              packageCount: pkgs,
              notes
            });
            if (typeof window.showToast === 'function') window.showToast(`🚚 #${transfer.folio} despachada En Tránsito. Stock físico descontado en ${transfer.source_warehouse_name}.`, 'success');
          } else if (activeMode === 'receive') {
            const recMap = {};
            const locMap = {};
            overlay.querySelectorAll('.trf-item-row').forEach(row => {
              const pid = row.getAttribute('data-product-id');
              const val = Number(row.querySelector('.trf-inp-rec')?.value ?? row.getAttribute('data-old-sent'));
              const loc = row.querySelector('.trf-inp-loc')?.value || '';
              recMap[pid] = Math.max(0, val);
              locMap[pid] = loc;
            });

            await receiveStockTransferOrder({
              transferId: transfer.id,
              itemsReceivedMap: recMap,
              itemsLocationMap: locMap,
              receivedByName: actor,
              discrepancyPolicy: policy,
              receptionNotes: notes
            });
            if (typeof window.showToast === 'function') window.showToast(`✅ #${transfer.folio} recepcionada en ${transfer.dest_warehouse_name}. Niveles de stock actualizados.`, 'success');
          } else if (activeMode === 'edit' || activeMode === 'correct') {
            if (!notes) {
              alert('Por favor ingresa el motivo de la edición o corrección para el registro de auditoría en Kardex.');
              btnSubmit.disabled = false;
              btnSubmit.innerHTML = origText;
              return;
            }
            const patchMap = {};
            overlay.querySelectorAll('.trf-item-row').forEach(row => {
              const pid = row.getAttribute('data-product-id');
              const loc = row.querySelector('.trf-inp-loc')?.value;
              const entry = { dest_location_hint: loc };
              if (activeMode === 'edit' && transfer.status === 'Solicitada') {
                entry.quantity_requested = Math.max(0, Number(row.querySelector('.trf-inp-req')?.value ?? row.getAttribute('data-old-req')));
              } else if (activeMode === 'edit' && transfer.status === 'En Tránsito') {
                entry.quantity_sent = Math.max(0, Number(row.querySelector('.trf-inp-sent')?.value ?? row.getAttribute('data-old-sent')));
              } else if (activeMode === 'correct') {
                entry.quantity_received = Math.max(0, Number(row.querySelector('.trf-inp-rec-correct')?.value ?? row.getAttribute('data-old-rec')));
              }
              patchMap[pid] = entry;
            });

            await editOrCorrectStockTransferOrder({
              transferId: transfer.id,
              updatedItemsMap: patchMap,
              actorName: actor,
              reason: notes,
              discrepancyPolicy: policy
            });
            if (typeof window.showToast === 'function') window.showToast(`🛠️ #${transfer.folio} actualizada y diferencias de stock sincronizadas en Kardex.`, 'success');
          }

          overlay.remove();
          if (typeof onUpdatedCallback === 'function') onUpdatedCallback();
          else if (document.getElementById('admin-inv-transfers-container')) renderStockTransfersAdmin();
        } catch (err) {
          alert('Error al procesar la operación: ' + (err.message || err));
          btnSubmit.disabled = false;
        }
      };
    }
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (activeMode !== 'view') {
        const ok = confirm('¿Estás seguro de que deseas cerrar esta ventana? Se descartarán las cantidades o cambios no guardados.');
        if (!ok) return;
      }
      overlay.remove();
    }
  });
  renderModalContent();
}
window.openTransferDetailModal = openTransferDetailModal;

/**
 * MODAL PARA SOLICITAR / CREAR TRANSFERENCIAS ENTRE BODEGAS
 * Compatible 100% con Modo Claro y Modo Oscuro ([data-theme="dark"]).
 */
export async function openEnhancedStockTransferModal(
  initialCommerce = '',
  preselectedProducts = [],
  onComplete = null,
  defaultSourceWarehouseId = null,
  defaultDestWarehouseId = null
) {
  injectStockTransfersStyles();
  const [adminUser, loadedWarehouses, loadedCommerces] = await Promise.all([
    resolveCurrentAdminIdentity(),
    ensureAllWarehousesLoaded(),
    ensureAllCommercesLoaded(),
    fetchAllStockTransfers(false)
  ]);

  const warehouses = Array.isArray(loadedWarehouses) && loadedWarehouses.length >= 2
    ? loadedWarehouses
    : DEFAULT_STOCKA_WAREHOUSES;

  // Combinar comercios disponibles
  const setC = new Set();
  if (initialCommerce && initialCommerce.trim()) setC.add(initialCommerce.trim());
  (loadedCommerces || []).forEach(c => { if (c && String(c).trim()) setC.add(String(c).trim()); });
  let availableCommerces = Array.from(setC).sort((a, b) => a.localeCompare(b));

  let activeCommerce = initialCommerce || availableCommerces[0] || '';
  let sourceWhId = defaultSourceWarehouseId || warehouses[0]?.id || '';
  let destWhId = defaultDestWarehouseId || (warehouses.find(w => String(w.id) !== String(sourceWhId))?.id || warehouses[1]?.id || '');

  // Mapa de productos seleccionados: product_id -> { product, qty }
  let selectedMap = new Map();
  let commerceProducts = [];
  let searchFilter = '';

  const getWarehouseStockInfo = (prod, whId) => {
    const invArr = Array.isArray(prod?.inventory) ? prod.inventory : [];
    const inv = invArr.find(i => String(i.warehouse_id) === String(whId));
    const physical = Math.max(0, Number(inv?.quantity) || 0);
    const committed = Math.max(0, (Number(inv?.committed_quantity) || 0) + (Number(inv?.reserved_quantity) || 0));
    const trfReserved = window.getProductTransferReservedQty ? window.getProductTransferReservedQty(whId, prod.id, inv) : 0;
    const available = Math.max(0, physical - committed - trfReserved);
    return { physical, committed, trfReserved, available };
  };

  const getWarehouseTotalAvailable = (whId) => {
    return (commerceProducts || []).reduce((acc, p) => acc + getWarehouseStockInfo(p, whId).available, 0);
  };

  const loadCommerceProducts = async (commName) => {
    if (!commName) {
      commerceProducts = [];
      return;
    }
    if (window.adminInventoryCommerceCache && window.adminInventoryCommerceCache[commName]?.products?.length) {
      commerceProducts = window.adminInventoryCommerceCache[commName].products;
    } else {
      let prods = null;
      const res1 = await supabase
        .from('products')
        .select('id, sku, name, comercio, inventory(id, warehouse_id, quantity, committed_quantity, reserved_quantity)')
        .eq('comercio', commName)
        .order('sku', { ascending: true });

      if (!res1.error && Array.isArray(res1.data)) {
        prods = res1.data;
      } else {
        const res2 = await supabase
          .from('products')
          .select('id, sku, name, comercio, inventory(id, warehouse_id, quantity, committed_quantity)')
          .eq('comercio', commName)
          .order('sku', { ascending: true });
        if (!res2.error && Array.isArray(res2.data)) {
          prods = res2.data;
        } else {
          const res3 = await supabase
            .from('products')
            .select('id, sku, name, comercio, inventory(id, warehouse_id, quantity)')
            .eq('comercio', commName)
            .order('sku', { ascending: true });
          prods = res3.data || [];
        }
      }
      commerceProducts = prods || [];
    }

    // Si no se fijó una bodega origen explícita, preseleccionar automáticamente la bodega con mayor stock disponible de este comercio
    if (!defaultSourceWarehouseId && commerceProducts.length > 0) {
      let bestWhId = sourceWhId;
      let maxAv = -1;
      warehouses.forEach(w => {
        const tot = getWarehouseTotalAvailable(w.id);
        if (tot > maxAv) {
          maxAv = tot;
          bestWhId = w.id;
        }
      });
      if (maxAv > 0 && bestWhId) {
        sourceWhId = bestWhId;
        if (String(destWhId) === String(sourceWhId)) {
          const alt = warehouses.find(w => String(w.id) !== String(sourceWhId));
          if (alt) destWhId = alt.id;
        }
      }
    }

    selectedMap.clear();
    const initialList = Array.isArray(preselectedProducts) && preselectedProducts.length > 0 && commName === initialCommerce
      ? preselectedProducts
      : [];

    initialList.forEach(p => {
      if (p && p.id) selectedMap.set(String(p.id), { product: p, qty: 1 });
    });
  };

  await loadCommerceProducts(activeCommerce);

  const existing = document.getElementById('modal-create-stock-transfer');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-create-stock-transfer';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(7,10,19,0.78); backdrop-filter:blur(5px); z-index:10030; display:flex; align-items:center; justify-content:center; padding:1rem;';
  document.body.appendChild(overlay);

  let isTransferCompletedView = false;

  const confirmAndCloseCreateModal = () => {
    if (isTransferCompletedView) {
      overlay.remove();
      return;
    }
    let skusCount = 0;
    let unitsCount = 0;
    selectedMap.forEach(v => {
      if (Number(v.qty) > 0) {
        skusCount++;
        unitsCount += Number(v.qty);
      }
    });
    const notesVal = (overlay.querySelector('#trf-new-notes')?.value || '').trim();
    const msg = skusCount > 0 || notesVal
      ? `¿Estás seguro de que deseas cancelar y cerrar? Se borrará tu trabajo actual (${skusCount} SKU${skusCount === 1 ? '' : 's'} · ${unitsCount} unidades seleccionadas).`
      : '¿Estás seguro de que deseas cancelar y cerrar el formulario de transferencia?';
    if (confirm(msg)) {
      overlay.remove();
    }
  };

  const getWarehouseTotalPhysical = (whId) => {
    return (commerceProducts || []).reduce((acc, p) => acc + getWarehouseStockInfo(p, whId).physical, 0);
  };

  const updateWarehouseDropdownLabels = () => {
    const srcSel = overlay.querySelector('#trf-new-source-wh');
    const dstSel = overlay.querySelector('#trf-new-dest-wh');
    if (srcSel) {
      srcSel.innerHTML = warehouses.map(w => {
        const totAv = getWarehouseTotalAvailable(w.id);
        return `<option value="${w.id}" ${String(w.id) === String(sourceWhId) ? 'selected' : ''}>${escHtml(w.name)} (${totAv} uds disp.)</option>`;
      }).join('');
    }
    if (dstSel) {
      dstSel.innerHTML = warehouses.map(w => {
        const totPhys = getWarehouseTotalPhysical(w.id);
        return `<option value="${w.id}" ${String(w.id) === String(destWhId) ? 'selected' : ''}>${escHtml(w.name)} (${totPhys} uds actual)</option>`;
      }).join('');
    }
  };

  const renderCompletionResult = (createdTransfer, snapshotItems, whTotalsSnapshot) => {
    isTransferCompletedView = true;
    const isRec = createdTransfer.status === 'Recepcionada';
    const isTransit = createdTransfer.status === 'En Tránsito';

    overlay.innerHTML = `
      <div class="trf-modal-shell" style="max-width:940px; max-height:92vh;">
        <!-- Header de Éxito -->
        <div style="padding:1.25rem 1.5rem; background:linear-gradient(135deg, #065f46 0%, #047857 55%, #0f172a 100%); color:#fff; display:flex; justify-content:space-between; align-items:center; gap:1rem;">
          <div style="display:flex; align-items:center; gap:0.85rem;">
            <div style="width:46px; height:46px; border-radius:12px; background:rgba(255,255,255,0.16); display:flex; align-items:center; justify-content:center; font-size:1.55rem; color:#6ee7b7; flex-shrink:0;">
              <i class="ri-checkbox-circle-fill"></i>
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:0.55rem; flex-wrap:wrap;">
                <span style="font-family:monospace; font-size:1.15rem; font-weight:900; color:#a7f3d0;">#${escHtml(createdTransfer.folio)}</span>
                ${getStatusBadgeHtml(createdTransfer.status)}
                <span class="trf-pill" style="background:rgba(255,255,255,0.15); color:#fff;">
                  <i class="ri-store-2-line"></i> ${escHtml(createdTransfer.comercio)}
                </span>
              </div>
              <h3 style="margin:4px 0 0 0; font-size:1.08rem; font-weight:800; color:#fff;">
                Resultado del Movimiento Completado · Niveles de Stock Actualizados
              </h3>
            </div>
          </div>
          <button type="button" id="btn-trf-done-close-top" style="background:rgba(255,255,255,0.14); border:none; color:#fff; width:34px; height:34px; border-radius:8px; cursor:pointer; font-weight:700;">✕</button>
        </div>

        <!-- Body -->
        <div style="padding:1.25rem 1.5rem; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:1.1rem; background:var(--trf-surface);">
          <!-- Tarjetas de Resumen Total de Unidades en Origen y Destino Luego del Movimiento -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:0.9rem;">
            <!-- Bodega Origen -->
            <div class="trf-step-card" style="border-left:4px solid #f59e0b;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.71rem; font-weight:800; text-transform:uppercase; color:#f59e0b;">
                  <i class="ri-upload-2-line"></i> Bodega de Origen (Salida)
                </span>
                <span class="trf-pill trf-pill-amber">-${whTotalsSnapshot.transferUnits} uds</span>
              </div>
              <div style="font-size:1rem; font-weight:800; color:var(--trf-text); margin-top:4px;">
                ${escHtml(createdTransfer.source_warehouse_name)}
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-top:0.65rem; padding-top:0.6rem; border-top:1px dashed var(--trf-border);">
                <div>
                  <div style="font-size:0.7rem; color:var(--trf-muted);">Disponible en Origen</div>
                  <div style="font-size:0.95rem; font-weight:900; color:var(--trf-text); margin-top:2px;">
                    <span style="color:var(--trf-muted); font-weight:600; text-decoration:line-through;">${whTotalsSnapshot.srcAvailBefore}</span>
                    <i class="ri-arrow-right-line" style="font-size:0.8rem; color:#f59e0b; vertical-align:middle;"></i>
                    <span style="color:#f59e0b;">${whTotalsSnapshot.srcAvailAfter} uds</span>
                  </div>
                </div>
                <div>
                  <div style="font-size:0.7rem; color:var(--trf-muted);">Físico Total en Origen</div>
                  <div style="font-size:0.95rem; font-weight:900; color:var(--trf-text); margin-top:2px;">
                    ${createdTransfer.status === 'Solicitada'
                      ? `${whTotalsSnapshot.srcPhysBefore} uds <span style="font-size:0.7rem; color:#f59e0b;">(${whTotalsSnapshot.transferUnits} reserv.)</span>`
                      : `<span style="color:var(--trf-muted); font-weight:600; text-decoration:line-through;">${whTotalsSnapshot.srcPhysBefore}</span> <i class="ri-arrow-right-line" style="font-size:0.8rem; color:#f59e0b;"></i> <span>${whTotalsSnapshot.srcPhysAfter} uds</span>`
                    }
                  </div>
                </div>
              </div>
            </div>

            <!-- Bodega Destino -->
            <div class="trf-step-card" style="border-left:4px solid #10b981;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.71rem; font-weight:800; text-transform:uppercase; color:#10b981;">
                  <i class="ri-download-2-line"></i> Bodega de Destino (Entrada)
                </span>
                <span class="trf-pill trf-pill-emerald">+${whTotalsSnapshot.transferUnits} uds</span>
              </div>
              <div style="font-size:1rem; font-weight:800; color:var(--trf-text); margin-top:4px;">
                ${escHtml(createdTransfer.dest_warehouse_name)}
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; margin-top:0.65rem; padding-top:0.6rem; border-top:1px dashed var(--trf-border);">
                <div>
                  <div style="font-size:0.7rem; color:var(--trf-muted);">
                    ${isRec ? 'Stock Físico en Destino' : 'Proyección en Destino'}
                  </div>
                  <div style="font-size:0.95rem; font-weight:900; color:var(--trf-text); margin-top:2px;">
                    <span style="color:var(--trf-muted); font-weight:600; text-decoration:line-through;">${whTotalsSnapshot.dstPhysBefore}</span>
                    <i class="ri-arrow-right-line" style="font-size:0.8rem; color:#10b981; vertical-align:middle;"></i>
                    <span style="color:#10b981;">${whTotalsSnapshot.dstPhysProjected} uds</span>
                  </div>
                </div>
                <div>
                  <div style="font-size:0.7rem; color:var(--trf-muted);">Estado de Recepción</div>
                  <div style="font-size:0.8rem; font-weight:800; color:${isRec ? '#10b981' : (isTransit ? '#38bdf8' : '#f59e0b')}; margin-top:4px;">
                    ${isRec
                      ? 'Sumado al Físico + Disponible'
                      : (isTransit ? `${whTotalsSnapshot.transferUnits} uds En Tránsito a Destino` : `${whTotalsSnapshot.transferUnits} uds Pendientes de Envío`)
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Detalle por SKU con saldos antes y después en Origen y Destino -->
          <div class="trf-table-card" style="max-height:320px; overflow-y:auto;">
            <table class="trf-table">
              <thead style="position:sticky; top:0; z-index:2;">
                <tr>
                  <th>SKU / Producto</th>
                  <th style="text-align:center;">Unidades Movidas</th>
                  <th style="text-align:center;">Origen: ${escHtml(createdTransfer.source_warehouse_name)} (Antes → Después)</th>
                  <th style="text-align:center;">Destino: ${escHtml(createdTransfer.dest_warehouse_name)} (Antes → Después)</th>
                </tr>
              </thead>
              <tbody>
                ${snapshotItems.map(it => `
                  <tr>
                    <td>
                      <div style="font-family:monospace; font-weight:800; color:var(--trf-text);">${escHtml(it.sku)}</div>
                      <div style="font-size:0.75rem; color:var(--trf-muted);">${escHtml(it.name)}</div>
                    </td>
                    <td style="text-align:center;">
                      <span class="trf-pill trf-pill-indigo" style="font-size:0.8rem;">${it.qty} uds</span>
                    </td>
                    <td style="text-align:center; font-weight:700;">
                      <span style="color:var(--trf-muted);">${it.srcAvailBefore} disp.</span>
                      <i class="ri-arrow-right-line" style="color:#f59e0b; margin:0 4px;"></i>
                      <strong style="color:#f59e0b;">${it.srcAvailAfter} disp.</strong>
                      <div style="font-size:0.7rem; color:var(--trf-muted);">
                        Físico: ${it.srcPhysBefore} → ${createdTransfer.status === 'Solicitada' ? `${it.srcPhysBefore} (${it.qty} reserv.)` : it.srcPhysAfter}
                      </div>
                    </td>
                    <td style="text-align:center; font-weight:700;">
                      <span style="color:var(--trf-muted);">${it.dstPhysBefore} uds</span>
                      <i class="ri-arrow-right-line" style="color:#10b981; margin:0 4px;"></i>
                      <strong style="color:#10b981;">${it.dstPhysAfter} uds</strong>
                      <div style="font-size:0.7rem; color:var(--trf-muted);">
                        ${isRec ? 'Ingresado en físico destino' : (isTransit ? `+${it.qty} uds en tránsito` : `+${it.qty} uds al recepcionar`)}
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Footer -->
        <div class="trf-modal-footer">
          <div style="display:flex; gap:0.55rem; flex-wrap:wrap;">
            <button type="button" id="btn-trf-done-open-detail" class="trf-btn">
              <i class="ri-eye-line" style="color:#6366f1;"></i> Ver Ficha / Imprimir Guía (#${escHtml(createdTransfer.folio)})
            </button>
            <button type="button" id="btn-trf-done-new-another" class="trf-btn">
              <i class="ri-add-circle-line" style="color:#10b981;"></i> Crear Otra Transferencia
            </button>
          </div>
          <button type="button" id="btn-trf-done-finish" class="trf-btn trf-btn-primary">
            <i class="ri-check-line"></i> Finalizar y Cerrar
          </button>
        </div>
      </div>
    `;

    const closeAndRefresh = () => {
      overlay.remove();
      if (typeof onComplete === 'function') onComplete(createdTransfer);
      else if (document.getElementById('admin-inv-transfers-container')) renderStockTransfersAdmin();
    };

    overlay.querySelector('#btn-trf-done-close-top').onclick = closeAndRefresh;
    overlay.querySelector('#btn-trf-done-finish').onclick = closeAndRefresh;
    overlay.querySelector('#btn-trf-done-open-detail').onclick = () => {
      overlay.remove();
      if (typeof onComplete === 'function') onComplete(createdTransfer);
      openTransferDetailModal(createdTransfer.id, 'view', () => {
        if (document.getElementById('admin-inv-transfers-container')) renderStockTransfersAdmin();
      });
    };
    overlay.querySelector('#btn-trf-done-new-another').onclick = () => {
      overlay.remove();
      openEnhancedStockTransferModal(activeCommerce, [], onComplete, sourceWhId, destWhId);
    };
  };

  const renderModal = () => {
    overlay.innerHTML = `
      <div class="trf-modal-shell" style="max-width:1180px; width:96vw; max-height:95vh;">
        <!-- Header -->
        <div style="padding:0.9rem 1.35rem; background:linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); color:#fff; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 style="margin:0; font-size:1.06rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:0.5rem;">
              <i class="ri-truck-line" style="color:#a5b4fc;"></i> Solicitar / Ejecutar Transferencia de Stock entre Bodegas
            </h3>
            <p style="margin:2px 0 0 0; font-size:0.75rem; color:#c7d2fe;">
              El sistema limita automáticamente las cantidades al stock disponible en origen y proyecta el saldo resultante en ambas bodegas.
            </p>
          </div>
          <button type="button" id="btn-create-trf-close" style="background:rgba(255,255,255,0.12); border:none; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer; font-weight:700;">✕</button>
        </div>

        <!-- Body -->
        <div style="padding:0.95rem 1.35rem; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:0.7rem; background:var(--trf-surface);">
          <!-- Fila 1: Comercio, Bodega Origen y Bodega Destino -->
          <div class="trf-step-card" style="padding:0.7rem 0.9rem; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.75rem;">
            <div>
              <label class="trf-field-label"><i class="ri-store-2-line"></i> Comercio / Cliente *</label>
              <select id="trf-new-commerce" class="trf-select" style="height:36px;">
                ${availableCommerces.map(c => `<option value="${escHtml(c)}" ${c === activeCommerce ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="trf-field-label" style="color:#f59e0b;"><i class="ri-upload-2-line"></i> Bodega de Origen (Salida) *</label>
              <select id="trf-new-source-wh" class="trf-select" style="height:36px; border-color:rgba(245,158,11,0.45);"></select>
            </div>
            <div>
              <label class="trf-field-label" style="color:#10b981;"><i class="ri-download-2-line"></i> Bodega de Destino (Entrada) *</label>
              <select id="trf-new-dest-wh" class="trf-select" style="height:36px; border-color:rgba(16,185,129,0.45);"></select>
            </div>
          </div>

          <!-- Fila 2: Modalidad de Estado Inicial, Quién Solicita, Prioridad y Motivo -->
          <div style="display:grid; grid-template-columns:1.8fr 1fr 0.75fr 1.25fr; gap:0.75rem; align-items:end;">
            <div>
              <label class="trf-field-label"><i class="ri-settings-4-line" style="color:#6366f1;"></i> Estado Inicial y Efecto en Niveles de Stock *</label>
              <select id="trf-new-initial-status" class="trf-select" style="height:36px; border-color:rgba(99,102,241,0.5);">
                <option value="Solicitada" selected>1. Solicitar Transferencia (Reserva unidades en Bodega Origen · Descuenta de Disponible)</option>
                <option value="En Tránsito">2. Despachar En Tránsito Ahora (Rebaja Stock Físico en Origen + Kardex OUT · Pendiente Recepción)</option>
                <option value="Recepcionada">3. Traspaso Directo 1-Paso (Rebaja Origen y Suma Físico en Destino inmediatamente + Kardex OUT/IN)</option>
              </select>
            </div>
            <div>
              <label class="trf-field-label"><i class="ri-user-star-line"></i> Solicitado por (Admin) *</label>
              <input type="text" id="trf-new-req-by" class="trf-input" style="height:36px;" value="${escHtml(adminUser.name || 'Administrador')}">
            </div>
            <div>
              <label class="trf-field-label"><i class="ri-flag-2-line"></i> Prioridad</label>
              <select id="trf-new-priority" class="trf-select" style="height:36px;">
                <option value="Normal">Normal</option>
                <option value="Urgente">🔥 Urgente</option>
              </select>
            </div>
            <div>
              <label class="trf-field-label"><i class="ri-file-list-3-line"></i> Motivo / Nota Operativa</label>
              <input type="text" id="trf-new-notes" class="trf-input" style="height:36px;" placeholder="Ej: Reposición de stock CDD...">
            </div>
          </div>

          <!-- Acción Rápida: Trasladar todo el stock disponible de la bodega origen -->
          <div style="padding:0.55rem 0.9rem; background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.3); border-radius:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
            <label style="display:flex; align-items:center; gap:0.55rem; cursor:pointer; margin:0; font-size:0.8rem; font-weight:700; color:var(--trf-text);">
              <input type="checkbox" id="chk-trf-all-available" style="width:16px; height:16px; accent-color:#6366f1;">
              <span>Cargar automáticamente todos los SKUs con stock disponible en la bodega de origen</span>
            </label>
            <div class="trf-input-wrap" style="width:260px;">
              <i class="ri-search-line trf-input-icon"></i>
              <input type="text" id="trf-sku-search" class="trf-input has-left-icon" placeholder="Filtrar SKU o producto..." value="${escHtml(searchFilter)}" style="height:32px; font-size:0.79rem;">
            </div>
          </div>

          <!-- Tabla de Selección de Productos y Cantidades -->
          <div class="trf-table-card" style="max-height:390px; min-height:240px; flex:1; overflow-y:auto; overflow-x:auto;">
            <table class="trf-table" style="min-width:860px;">
              <thead style="position:sticky; top:0; z-index:2;">
                <tr>
                  <th style="width:42px; text-align:center;">Incluir</th>
                  <th style="min-width:210px;">SKU / Producto</th>
                  <th style="width:82px; text-align:center;">Físico Orig.</th>
                  <th style="width:86px; text-align:center;">Comprom.</th>
                  <th style="width:92px; text-align:center;">Disp. Origen</th>
                  <th style="width:82px; text-align:center;">Físico Dest.</th>
                  <th style="width:110px; text-align:center;">Cant. a Mover</th>
                  <th style="width:185px; text-align:center;">Saldo Final (Orig. → Dest.)</th>
                </tr>
              </thead>
              <tbody id="trf-new-products-tbody"></tbody>
            </table>
          </div>

          <!-- Barra de Proyección Global de Saldos en Origen y Destino Luego del Movimiento -->
          <div id="trf-live-projection-banner" style="padding:0.6rem 0.9rem; border-radius:11px; border:1px solid var(--trf-border); background:var(--trf-surface-alt); display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:0.65rem; align-items:center;"></div>
        </div>

        <!-- Footer -->
        <div class="trf-modal-footer">
          <div id="trf-new-summary-counter" style="font-size:0.84rem; font-weight:800; color:var(--trf-text);">
            0 SKUs seleccionados · 0 unidades totales
          </div>
          <div style="display:flex; gap:0.6rem;">
            <button type="button" id="btn-create-trf-cancel" class="trf-btn">Cancelar</button>
            <button type="button" id="btn-create-trf-submit" class="trf-btn trf-btn-primary">
              <i class="ri-send-plane-fill"></i> Confirmar y Registrar Transferencia
            </button>
          </div>
        </div>
      </div>
    `;

    updateWarehouseDropdownLabels();

    const renderProductsRows = () => {
      const tbody = overlay.querySelector('#trf-new-products-tbody');
      const summaryEl = overlay.querySelector('#trf-new-summary-counter');
      const projBanner = overlay.querySelector('#trf-live-projection-banner');
      if (!tbody) return;

      const q = searchFilter.toLowerCase().trim();
      const rowsList = commerceProducts.filter(p => {
        if (!q) return true;
        return String(p.sku || '').toLowerCase().includes(q) || String(p.name || '').toLowerCase().includes(q);
      });

      rowsList.sort((a, b) => {
        const aSel = selectedMap.has(String(a.id)) ? 1 : 0;
        const bSel = selectedMap.has(String(b.id)) ? 1 : 0;
        if (aSel !== bSel) return bSel - aSel;
        const aAv = getWarehouseStockInfo(a, sourceWhId).available;
        const bAv = getWarehouseStockInfo(b, sourceWhId).available;
        return bAv - aAv;
      });

      if (rowsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:2rem; text-align:center; color:var(--trf-muted);">No se encontraron productos para este comercio.</td></tr>`;
      } else {
        tbody.innerHTML = rowsList.map(p => {
          const pid = String(p.id);
          const srcInfo = getWarehouseStockInfo(p, sourceWhId);
          const dstInfo = getWarehouseStockInfo(p, destWhId);
          const canTransfer = srcInfo.available > 0;
          const isChecked = canTransfer && selectedMap.has(pid);
          const entry = selectedMap.get(pid);
          const currentQty = isChecked ? Math.min(Math.max(1, Number(entry?.qty || 1)), srcInfo.available) : (canTransfer ? 1 : 0);

          const srcAfterAvail = Math.max(0, srcInfo.available - (isChecked ? currentQty : 0));
          const dstAfterPhys = dstInfo.physical + (isChecked ? currentQty : 0);

          return `
            <tr data-pid="${escHtml(pid)}" style="background:${isChecked ? 'rgba(99,102,241,0.12)' : 'transparent'}; ${!canTransfer ? 'opacity:0.58;' : ''}">
              <td style="text-align:center;">
                <input type="checkbox" class="trf-row-chk" data-pid="${escHtml(pid)}" ${isChecked ? 'checked' : ''} ${!canTransfer ? 'disabled title="Sin stock disponible en la bodega de origen"' : ''} style="width:16px; height:16px; accent-color:#6366f1; cursor:${canTransfer ? 'pointer' : 'not-allowed'};">
              </td>
              <td>
                <div style="font-family:monospace; font-weight:800; color:var(--trf-text);">${escHtml(p.sku || 'S/SKU')}</div>
                <div style="font-size:0.75rem; color:var(--trf-muted);">${escHtml(p.name || 'Producto')}</div>
              </td>
              <td style="text-align:center; font-weight:700;">${srcInfo.physical}</td>
              <td style="text-align:center; font-size:0.76rem; color:#f59e0b;">
                ${srcInfo.committed + srcInfo.trfReserved > 0 ? `${srcInfo.committed + srcInfo.trfReserved} (${srcInfo.trfReserved} trasl.)` : '0'}
              </td>
              <td style="text-align:center;">
                <span class="trf-pill ${srcInfo.available > 0 ? 'trf-pill-emerald' : 'trf-pill-neutral'}">
                  ${srcInfo.available}
                </span>
              </td>
              <td style="text-align:center; font-weight:700; color:var(--trf-muted);">${dstInfo.physical}</td>
              <td style="text-align:center;">
                <input type="number" class="trf-input trf-row-qty" data-pid="${escHtml(pid)}" min="${canTransfer ? 1 : 0}" max="${srcInfo.available}" value="${currentQty}" ${!isChecked ? 'disabled' : ''} style="width:92px; height:34px; margin:0 auto; text-align:center; font-weight:800;">
                ${isChecked ? `<div style="font-size:0.66rem; color:var(--trf-muted); margin-top:2px;">Máx: ${srcInfo.available} uds</div>` : ''}
              </td>
              <td class="trf-row-post-cell" data-pid="${escHtml(pid)}" style="text-align:center; font-size:0.77rem; white-space:nowrap;">
                ${isChecked ? `
                  <div style="display:inline-flex; align-items:center; gap:0.45rem; padding:3px 8px; border-radius:8px; background:var(--trf-surface-alt); border:1px solid var(--trf-border);">
                    <span title="Disponible en Origen luego del movimiento">Orig: <strong>${srcInfo.available}</strong> → <strong style="color:#f59e0b;">${srcAfterAvail}</strong></span>
                    <span style="color:var(--trf-muted);">|</span>
                    <span title="Stock en Destino luego del movimiento">Dest: <strong>${dstInfo.physical}</strong> → <strong style="color:#10b981;">${dstAfterPhys}</strong></span>
                  </div>
                ` : `<span style="color:var(--trf-muted); font-size:0.73rem;">Sin cambio (${srcInfo.available} / ${dstInfo.physical})</span>`}
              </td>
            </tr>
          `;
        }).join('');
      }

      const updateSummary = () => {
        let skus = 0, units = 0;
        selectedMap.forEach((v, pid) => {
          const av = getWarehouseStockInfo(v.product, sourceWhId).available;
          if (av <= 0) {
            selectedMap.delete(pid);
            return;
          }
          if (v.qty > av) v.qty = av;
          if (v.qty > 0) {
            skus++;
            units += Number(v.qty);
          }
        });

        const srcWhObj = warehouses.find(w => String(w.id) === String(sourceWhId));
        const dstWhObj = warehouses.find(w => String(w.id) === String(destWhId));
        const srcName = srcWhObj?.name || 'Bodega Origen';
        const dstName = dstWhObj?.name || 'Bodega Destino';

        const totalSrcAvailBefore = getWarehouseTotalAvailable(sourceWhId);
        const totalSrcAvailAfter = Math.max(0, totalSrcAvailBefore - units);
        const totalDstPhysBefore = getWarehouseTotalPhysical(destWhId);
        const totalDstPhysAfter = totalDstPhysBefore + units;

        if (summaryEl) {
          summaryEl.innerHTML = `<span style="color:#6366f1;">${skus} SKU${skus === 1 ? '' : 's'} seleccionados</span> · <strong>${units} unidades totales</strong> a transferir`;
        }

        if (projBanner) {
          projBanner.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.6rem;">
              <div style="width:32px; height:32px; border-radius:8px; background:rgba(245,158,11,0.15); color:#f59e0b; display:flex; align-items:center; justify-content:center; font-size:1rem; flex-shrink:0;">
                <i class="ri-upload-2-line"></i>
              </div>
              <div>
                <div style="font-size:0.69rem; font-weight:800; text-transform:uppercase; color:var(--trf-muted);">Total Origen · ${escHtml(srcName)} (Luego del Movimiento)</div>
                <div style="font-size:0.85rem; font-weight:800; color:var(--trf-text);">
                  <span>${totalSrcAvailBefore} uds disp.</span>
                  <i class="ri-arrow-right-line" style="color:#f59e0b; margin:0 4px;"></i>
                  <strong style="color:#f59e0b;">${totalSrcAvailAfter} uds disp.</strong>
                  ${units > 0 ? `<span style="font-size:0.74rem; color:#f59e0b; margin-left:4px;">(-${units} uds)</span>` : ''}
                </div>
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:0.6rem;">
              <div style="width:32px; height:32px; border-radius:8px; background:rgba(16,185,129,0.15); color:#10b981; display:flex; align-items:center; justify-content:center; font-size:1rem; flex-shrink:0;">
                <i class="ri-download-2-line"></i>
              </div>
              <div>
                <div style="font-size:0.69rem; font-weight:800; text-transform:uppercase; color:var(--trf-muted);">Total Destino · ${escHtml(dstName)} (Luego del Movimiento)</div>
                <div style="font-size:0.85rem; font-weight:800; color:var(--trf-text);">
                  <span>${totalDstPhysBefore} uds actual</span>
                  <i class="ri-arrow-right-line" style="color:#10b981; margin:0 4px;"></i>
                  <strong style="color:#10b981;">${totalDstPhysAfter} uds finales</strong>
                  ${units > 0 ? `<span style="font-size:0.74rem; color:#10b981; margin-left:4px;">(+${units} uds)</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }
      };
      updateSummary();

      tbody.querySelectorAll('.trf-row-chk').forEach(chk => {
        chk.onchange = () => {
          const pid = chk.getAttribute('data-pid');
          const prod = commerceProducts.find(x => String(x.id) === String(pid));
          if (!prod) return;
          const av = getWarehouseStockInfo(prod, sourceWhId).available;
          if (chk.checked && av > 0) {
            selectedMap.set(pid, { product: prod, qty: 1 });
          } else {
            chk.checked = false;
            selectedMap.delete(pid);
          }
          renderProductsRows();
        };
      });

      tbody.querySelectorAll('.trf-row-qty').forEach(inp => {
        inp.oninput = () => {
          const pid = inp.getAttribute('data-pid');
          const entry = selectedMap.get(pid);
          if (!entry) return;
          const srcInfo = getWarehouseStockInfo(entry.product, sourceWhId);
          const dstInfo = getWarehouseStockInfo(entry.product, destWhId);
          const av = srcInfo.available;
          let val = Math.max(0, Number(inp.value || 0));
          if (val > av) {
            val = av;
            inp.value = String(av);
            if (typeof window.showToast === 'function') {
              window.showToast(`Máximo disponible en bodega de origen para ${entry.product.sku}: ${av} uds.`, 'warning');
            }
          }
          entry.qty = val;

          // Actualizar celda de proyección de esta fila en tiempo real
          const postCell = tbody.querySelector(`.trf-row-post-cell[data-pid="${CSS.escape(pid)}"]`);
          if (postCell) {
            const srcAfterAvail = Math.max(0, srcInfo.available - val);
            const dstAfterPhys = dstInfo.physical + val;
            postCell.innerHTML = `
              <div style="display:inline-flex; align-items:center; gap:0.45rem; padding:3px 8px; border-radius:8px; background:var(--trf-surface-alt); border:1px solid var(--trf-border);">
                <span>Orig: <strong>${srcInfo.available}</strong> → <strong style="color:#f59e0b;">${srcAfterAvail}</strong></span>
                <span style="color:var(--trf-muted);">|</span>
                <span>Dest: <strong>${dstInfo.physical}</strong> → <strong style="color:#10b981;">${dstAfterPhys}</strong></span>
              </div>
            `;
          }
          updateSummary();
        };
      });
    };

    renderProductsRows();

    overlay.querySelector('#btn-create-trf-close').onclick = confirmAndCloseCreateModal;
    overlay.querySelector('#btn-create-trf-cancel').onclick = confirmAndCloseCreateModal;

    overlay.querySelector('#trf-new-commerce').onchange = async (e) => {
      activeCommerce = e.target.value;
      await loadCommerceProducts(activeCommerce);
      updateWarehouseDropdownLabels();
      renderProductsRows();
    };

    overlay.querySelector('#trf-new-source-wh').onchange = (e) => {
      sourceWhId = e.target.value;
      if (String(sourceWhId) === String(destWhId)) {
        const alt = warehouses.find(w => String(w.id) !== String(sourceWhId));
        if (alt) {
          destWhId = alt.id;
          overlay.querySelector('#trf-new-dest-wh').value = destWhId;
        }
      }
      // Limitar o desmarcar SKUs que superen el disponible en la nueva bodega de origen
      selectedMap.forEach((v, k) => {
        const av = getWarehouseStockInfo(v.product, sourceWhId).available;
        if (av <= 0) selectedMap.delete(k);
        else if (v.qty > av) v.qty = av;
      });
      renderProductsRows();
    };

    overlay.querySelector('#trf-new-dest-wh').onchange = (e) => {
      destWhId = e.target.value;
      renderProductsRows();
    };

    overlay.querySelector('#chk-trf-all-available').onchange = (e) => {
      selectedMap.clear();
      if (e.target.checked) {
        commerceProducts.forEach(p => {
          const av = getWarehouseStockInfo(p, sourceWhId).available;
          if (av > 0) {
            selectedMap.set(String(p.id), { product: p, qty: av });
          }
        });
      }
      renderProductsRows();
    };

    overlay.querySelector('#trf-sku-search').oninput = (e) => {
      searchFilter = e.target.value;
      renderProductsRows();
    };

    overlay.querySelector('#btn-create-trf-submit').onclick = async (e) => {
      const btn = e.currentTarget;
      const srcWhObj = warehouses.find(w => String(w.id) === String(sourceWhId));
      const dstWhObj = warehouses.find(w => String(w.id) === String(destWhId));
      const initialSt = overlay.querySelector('#trf-new-initial-status')?.value || 'Solicitada';
      const reqBy = (overlay.querySelector('#trf-new-req-by')?.value || adminUser.name || 'Administrador').trim();
      const prio = overlay.querySelector('#trf-new-priority')?.value || 'Normal';
      const notes = (overlay.querySelector('#trf-new-notes')?.value || '').trim();

      if (String(sourceWhId) === String(destWhId)) {
        alert('La bodega de origen y la bodega de destino deben ser distintas.');
        return;
      }

      const itemsArray = [];
      const snapshotItems = [];
      for (const [, v] of selectedMap.entries()) {
        const qty = Number(v.qty || 0);
        if (qty <= 0) continue;
        const srcInfo = getWarehouseStockInfo(v.product, sourceWhId);
        const dstInfo = getWarehouseStockInfo(v.product, destWhId);
        if (qty > srcInfo.available) {
          alert(`El SKU ${v.product.sku} solicita transferir ${qty} uds, pero solo hay ${srcInfo.available} uds disponibles en ${srcWhObj?.name || 'Bodega Origen'}.`);
          return;
        }
        itemsArray.push({
          product_id: v.product.id,
          sku: v.product.sku || 'S/SKU',
          name: v.product.name || 'Producto',
          qty
        });
        snapshotItems.push({
          sku: v.product.sku || 'S/SKU',
          name: v.product.name || 'Producto',
          qty,
          srcPhysBefore: srcInfo.physical,
          srcPhysAfter: Math.max(0, srcInfo.physical - qty),
          srcAvailBefore: srcInfo.available,
          srcAvailAfter: Math.max(0, srcInfo.available - qty),
          dstPhysBefore: dstInfo.physical,
          dstPhysAfter: dstInfo.physical + qty
        });
      }

      if (itemsArray.length === 0) {
        alert('Selecciona al menos 1 producto con stock disponible y cantidad mayor a 0 para transferir.');
        return;
      }

      const totalTransferUnits = itemsArray.reduce((acc, it) => acc + it.qty, 0);
      const srcAvailBeforeTotal = getWarehouseTotalAvailable(sourceWhId);
      const srcPhysBeforeTotal = getWarehouseTotalPhysical(sourceWhId);
      const dstPhysBeforeTotal = getWarehouseTotalPhysical(destWhId);

      const whTotalsSnapshot = {
        transferUnits: totalTransferUnits,
        srcAvailBefore: srcAvailBeforeTotal,
        srcAvailAfter: Math.max(0, srcAvailBeforeTotal - totalTransferUnits),
        srcPhysBefore: srcPhysBeforeTotal,
        srcPhysAfter: Math.max(0, srcPhysBeforeTotal - totalTransferUnits),
        dstPhysBefore: dstPhysBeforeTotal,
        dstPhysProjected: dstPhysBeforeTotal + totalTransferUnits
      };

      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Procesando transferencia y ajustando stock...';

        const created = await createStockTransferOrder({
          comercio: activeCommerce,
          sourceWarehouseId: sourceWhId,
          sourceWarehouseName: srcWhObj?.name || 'Bodega Origen',
          destWarehouseId: destWhId,
          destWarehouseName: dstWhObj?.name || 'Bodega Destino',
          initialStatus: initialSt,
          priority: prio,
          notes,
          requestedByName: reqBy,
          dispatchedByName: initialSt !== 'Solicitada' ? reqBy : '',
          receivedByName: initialSt === 'Recepcionada' ? reqBy : '',
          items: itemsArray
        });

        if (typeof window.showToast === 'function') {
          window.showToast(`✅ Transferencia #${created.folio} registrada (${initialSt}).`, 'success');
        }
        renderCompletionResult(created, snapshotItems, whTotalsSnapshot);
      } catch (err) {
        alert('Error al crear la transferencia: ' + (err.message || err));
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-send-plane-fill"></i> Confirmar y Registrar Transferencia';
      }
    };
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (isTransferCompletedView) {
        const btnFinish = overlay.querySelector('#btn-trf-done-finish');
        if (btnFinish) btnFinish.click();
        else overlay.remove();
      } else {
        confirmAndCloseCreateModal();
      }
    }
  });
  renderModal();
}
window.openEnhancedStockTransferModal = openEnhancedStockTransferModal;
window.openBulkStockTransferModal = openEnhancedStockTransferModal;
