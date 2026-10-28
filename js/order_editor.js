/**
 * WMS STOCKA - Módulo de Edición de Ítems del Pedido (Order Items Editor)
 * 
 * Permite a administradores (en cualquier estado del pedido con control de kardex) 
 * y a clientes comerciales (estrictamente solo cuando el pedido se encuentra en 'En procesamiento')
 * modificar cantidades, añadir nuevos productos desde el catálogo del comercio o eliminar ítems.
 */

import { supabase } from './supabase.js';

window.editOrderCommerceCatalogCache = window.editOrderCommerceCatalogCache || {};
window.activeEditCatalogPromise = null;
window.isEditCatalogLoading = false;

window.mapProductWithInventoryStats = function(p) {
  if (!p) return null;
  const invList = Array.isArray(p.inventory) ? p.inventory : [];
  let physical = 0;
  let committed = 0;
  let reserved = 0;
  const byWarehouse = {};
  invList.forEach(inv => {
    const wid = inv.warehouse_id || 'unknown';
    const q = Number(inv.quantity) || 0;
    const c = Number(inv.committed_quantity) || 0;
    const r = Number(inv.reserved_quantity) || 0;
    physical += q;
    committed += c;
    reserved += r;
    if (!byWarehouse[wid]) {
      byWarehouse[wid] = { physical: 0, committed: 0, reserved: 0, available: 0 };
    }
    byWarehouse[wid].physical += q;
    byWarehouse[wid].committed += c;
    byWarehouse[wid].reserved += r;
    byWarehouse[wid].available = byWarehouse[wid].physical - byWarehouse[wid].committed - byWarehouse[wid].reserved;
  });
  return {
    ...p,
    physicalStock: physical,
    committedStock: committed,
    reservedStock: reserved,
    availableStock: physical - committed - reserved,
    stockByWarehouse: byWarehouse
  };
};

window.loadEditOrderCommerceCatalog = async function(commerce, forceRefresh = false) {
  if (!commerce) return [];
  const cacheEntry = window.editOrderCommerceCatalogCache[commerce];
  const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos
  if (!forceRefresh && cacheEntry && Array.isArray(cacheEntry.products) && (Date.now() - cacheEntry.timestamp < CACHE_TTL_MS)) {
    window.tempCommerceProducts = cacheEntry.products;
    window.isEditCatalogLoading = false;
    return cacheEntry.products;
  }

  window.isEditCatalogLoading = true;
  const selectCols = 'id, sku, name, price, is_virtual, status, image_url, inventory(warehouse_id, quantity, committed_quantity, reserved_quantity)';

  const loadPromise = (async () => {
    try {
      const [page0, page1] = await Promise.all([
        supabase.from('products').select(selectCols).eq('comercio', commerce).neq('status', 'archived').order('name').range(0, 999),
        supabase.from('products').select(selectCols).eq('comercio', commerce).neq('status', 'archived').order('name').range(1000, 1999)
      ]);

      let rawList = [];
      if (!page0.error && !page1.error) {
        rawList = [...(page0.data || []), ...(page1.data || [])];
        if ((page1.data || []).length === 1000) {
          let from = 2000;
          while (true) {
            const { data: extraData, error: extraErr } = await supabase
              .from('products')
              .select(selectCols)
              .eq('comercio', commerce)
              .neq('status', 'archived')
              .order('name')
              .range(from, from + 999);
            if (extraErr || !extraData || extraData.length === 0) break;
            rawList.push(...extraData);
            if (extraData.length < 1000) break;
            from += 1000;
          }
        }
      } else if (typeof window.fetchAllSupabaseRows === 'function') {
        rawList = await window.fetchAllSupabaseRows(
          'products',
          selectCols,
          q => q.eq('comercio', commerce).neq('status', 'archived').order('name')
        );
      }

      const commerceProducts = (rawList || [])
        .filter(p => p.status !== 'archived')
        .map(p => window.mapProductWithInventoryStats(p));

      window.tempCommerceProducts = commerceProducts;
      window.editOrderCommerceCatalogCache[commerce] = {
        products: commerceProducts,
        timestamp: Date.now()
      };
      window.isEditCatalogLoading = false;

      // Actualizar contador y desplegable en vivo si el modal sigue abierto
      const countEl = document.getElementById('swal-edit-catalog-count');
      if (countEl) {
        countEl.textContent = `(${commerceProducts.length} productos en catálogo)`;
      }
      const dropdownList = document.getElementById('swal-add-item-dropdown-list');
      if (dropdownList && dropdownList.style.display === 'block') {
        window.filterEditOrderModalProducts();
      }
      if (typeof window.updateEditOrderProductStockAlert === 'function') {
        window.updateEditOrderProductStockAlert();
      }

      // Enriquecer fotos faltantes desde synced_products
      const missingImgSkus = Array.from(new Set(
        commerceProducts.filter(p => !p.image_url && p.sku).map(p => p.sku.trim()).filter(Boolean)
      ));
      if (missingImgSkus.length > 0) {
        (async () => {
          try {
            const syncedImgMap = {};
            const imgBatches = [];
            for (let i = 0; i < missingImgSkus.length; i += 200) {
              imgBatches.push(
                supabase
                  .from('synced_products')
                  .select('sku, image_url')
                  .eq('comercio', commerce)
                  .not('image_url', 'is', null)
                  .in('sku', missingImgSkus.slice(i, i + 200))
              );
            }
            const imgResList = await Promise.all(imgBatches);
            imgResList.forEach(res => {
              (res.data || []).forEach(sp => {
                if (sp.sku && sp.image_url) {
                  syncedImgMap[sp.sku.trim().toLowerCase()] = sp.image_url;
                }
              });
            });
            commerceProducts.forEach(p => {
              if (!p.image_url && p.sku) {
                const foundImg = syncedImgMap[p.sku.trim().toLowerCase()];
                if (foundImg) p.image_url = foundImg;
              }
            });
            if (dropdownList && dropdownList.style.display === 'block') {
              window.filterEditOrderModalProducts();
            }
          } catch (e) {
            console.warn('[loadEditOrderCommerceCatalog] Error enriqueciendo fotos:', e);
          }
        })();
      }

      return commerceProducts;
    } catch (err) {
      console.warn('[loadEditOrderCommerceCatalog] Error cargando catálogo:', err);
      window.isEditCatalogLoading = false;
      return window.tempCommerceProducts || [];
    }
  })();

  window.activeEditCatalogPromise = loadPromise;
  return loadPromise;
};

window.openEditOrderItemsModal = async function(orderId) {
  if (!orderId) return;

  if (window.Swal) {
    Swal.fire({
      title: 'Cargando pedido...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });
  }

  try {
    const cachedOrderInMemory = (window.loadedOrders || window.clientLoadedOrders || []).find(o => o.id === orderId);
    if (cachedOrderInMemory?.comercio) {
      window.loadEditOrderCommerceCatalog(cachedOrderInMemory.comercio);
    }

    const needWarehouses = !Array.isArray(window.tempWarehouses) || window.tempWarehouses.length === 0;
    const [orderRes, itemsRes, whRes] = await Promise.all([
      cachedOrderInMemory
        ? Promise.resolve({ data: cachedOrderInMemory, error: null })
        : supabase
            .from('orders')
            .select('id, external_order_number, comercio, sucursal_pickeo, estado_wms, status, stock_descontado, raw_shopify_data, raw_woocommerce_data, raw_falabella_data, raw_paris_data, raw_ripley_data, raw_jumpseller_data, raw_tiendanube_data, raw_meli_data, raw_walmart_data')
            .eq('id', orderId)
            .single(),
      supabase
        .from('order_items')
        .select('*, products(id, sku, name, price, is_virtual, image_url, barcode, barcode_wms, send_barcode_to_picker, send_barcode_wms_to_picker, picking_match_strict, inventory(warehouse_id, quantity, committed_quantity, reserved_quantity))')
        .eq('order_id', orderId),
      needWarehouses
        ? supabase.from('warehouses').select('id, name').order('name')
        : Promise.resolve({ data: window.tempWarehouses, error: null })
    ]);

    if (orderRes.error) throw orderRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (whRes.error) throw whRes.error;

    const order = orderRes.data;
    const orderItems = itemsRes.data || [];
    window.tempWarehouses = whRes.data || [];

    // Verificación estricta de permisos de edición
    const isAdmin = Boolean(
      document.getElementById('admin-cmd-container') ||
      window.location.pathname.includes('admin') ||
      window.currentUserProfile?.role === 'admin'
    );

    const estadoWmsLower = String(order.estado_wms || order.status || '').toLowerCase().trim();
    const isEnProcesamiento = estadoWmsLower === 'en procesamiento';

    if (!isAdmin && !isEnProcesamiento) {
      if (window.Swal) {
        Swal.fire({
          icon: 'warning',
          title: 'Edición no permitida',
          html: `
            <div style="font-size: 0.88rem; line-height: 1.45; text-align: left;">
              <p>Los pedidos solo pueden editarse desde el WMS mientras se encuentren en estado <strong>"En procesamiento"</strong>.</p>
              <p style="margin: 0; color: var(--color-text-muted);">
                El pedido <strong>#${order.external_order_number || order.id}</strong> se encuentra en estado <strong>"${order.estado_wms || order.status}"</strong> (ya entró a bodega o despacho).
              </p>
            </div>
          `,
          confirmButtonColor: '#6366f1'
        });
      } else {
        alert(`No se puede editar: los pedidos solo pueden modificarse en estado "En procesamiento". Estado actual: ${order.estado_wms || order.status}`);
      }
      return;
    }

    const cachedCatalog = window.editOrderCommerceCatalogCache?.[order.comercio]?.products;
    if (cachedCatalog && cachedCatalog.length > 0) {
      window.tempCommerceProducts = cachedCatalog;
    } else {
      window.tempCommerceProducts = orderItems
        .filter(item => item.products)
        .map(item => window.mapProductWithInventoryStats(item.products));
      if (!cachedOrderInMemory?.comercio) {
        window.loadEditOrderCommerceCatalog(order.comercio);
      }
    }

    const isDispatched = (order.estado_wms === 'Despachado') || (order.stock_descontado === true);
    window.tempEditOrderData = {
      ...order,
      isDispatched,
      isAdmin
    };
    window.tempEditAdjustDispatchedStock = false;

    const prodByIdMap = new Map((window.tempCommerceProducts || []).map(p => [p.id, p]));
    window.tempEditOrderItems = orderItems.map(item => {
      const catProd = prodByIdMap.get(item.product_id);
      return {
        id: item.id,
        product_id: item.product_id,
        sku: item.products?.sku || catProd?.sku || 'S/SKU',
        name: item.products?.name || catProd?.name || 'Desconocido',
        price: item.products?.price ?? catProd?.price ?? 0,
        image_url: item.products?.image_url || catProd?.image_url || '',
        is_virtual: !!(item.products?.is_virtual ?? catProd?.is_virtual),
        quantity: item.quantity,
        warehouse_id: item.warehouse_id
      };
    });

    window.originalEditOrderItems = JSON.parse(JSON.stringify(window.tempEditOrderItems));

    window.renderEditOrderItemsModal(orderId, order.comercio);

  } catch (err) {
    console.error('[openEditOrderItemsModal] Error:', err);
    if (window.Swal) {
      Swal.fire('Error', 'No se pudieron cargar los datos del pedido: ' + err.message, 'error');
    } else {
      alert('Error cargando pedido: ' + err.message);
    }
  }
};

window.findProductInCommerce = function(rawQuery) {
  if (!rawQuery) return null;
  const q = rawQuery.trim().toLowerCase();
  const commerceProducts = window.tempCommerceProducts || [];

  let prod = commerceProducts.find(p => (p.sku || '').trim().toLowerCase() === q);
  if (prod) return prod;

  prod = commerceProducts.find(p => {
    const s = (p.sku || '').trim().toLowerCase();
    if (!s) return false;
    const full = `${s} - ${(p.name || '').trim().toLowerCase()}`;
    return full === q || q.startsWith(s + ' -') || q.startsWith(s + ' ');
  });
  if (prod) return prod;

  prod = commerceProducts.find(p => (p.name || '').trim().toLowerCase() === q);
  if (prod) return prod;

  const tokens = q.split(/\s+/).filter(Boolean);
  const partials = commerceProducts.filter(p => {
    const s = (p.sku || '').trim().toLowerCase();
    const n = (p.name || '').trim().toLowerCase();
    return tokens.every(t => s.includes(t) || n.includes(t));
  });
  if (partials.length === 1) return partials[0];

  return null;
};

window.tryAddTempEditItem = function(orderId, commerce, rawSku, rawQty, explicitProductId = null) {
  const qty = parseInt(rawQty, 10);
  if (isNaN(qty) || qty < 1) return false;

  const commerceProducts = window.tempCommerceProducts || [];
  let product = null;
  if (explicitProductId) {
    product = commerceProducts.find(p => p.id === explicitProductId) || null;
  }
  if (!product) {
    product = window.findProductInCommerce(rawSku);
  }
  if (!product) return false;

  const existingIdx = window.tempEditOrderItems.findIndex(item => item.product_id === product.id);
  if (existingIdx !== -1) {
    window.tempEditOrderItems[existingIdx].quantity += qty;
  } else {
    const firstItemWh = window.tempEditOrderItems.length > 0 ? window.tempEditOrderItems[0].warehouse_id : null;
    const origItemWh = (window.originalEditOrderItems && window.originalEditOrderItems.length > 0) ? window.originalEditOrderItems[0].warehouse_id : null;
    const centralWh = (window.tempWarehouses || []).find(w => w.name.toLowerCase().includes('central') || w.name.toLowerCase().includes('ñuñoa'));
    const defaultWarehouseId = firstItemWh || origItemWh || (centralWh ? centralWh.id : (window.tempWarehouses && window.tempWarehouses.length > 0 ? window.tempWarehouses[0].id : null));

    const origMatch = (window.originalEditOrderItems || []).find(o => o.product_id === product.id && !window.tempEditOrderItems.some(t => t.id === o.id));

    window.tempEditOrderItems.push({
      id: origMatch ? origMatch.id : null,
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price || 0,
      image_url: product.image_url || '',
      is_virtual: !!product.is_virtual,
      quantity: qty,
      warehouse_id: origMatch?.warehouse_id || defaultWarehouseId
    });
  }
  return true;
};

window.computeDispatchedOrderStockDiffs = function(defaultWarehouseIdFallback = null) {
  const origItems = window.originalEditOrderItems || [];
  const currItems = window.tempEditOrderItems || [];
  const whList = window.tempWarehouses || [];
  const orderData = window.tempEditOrderData || {};
  const orderRefLabel = `Pedido ${orderData.external_order_number || orderData.id || ''}`.trim();

  const centralWh = whList.find(w => w.name.toLowerCase().includes('central') || w.name.toLowerCase().includes('ñuñoa'));
  const fallbackWhId = defaultWarehouseIdFallback || (centralWh ? centralWh.id : (whList[0]?.id || null));

  const getWhName = (whId) => whList.find(w => w.id === whId)?.name || 'Bodega Central';

  const origByProd = new Map();
  origItems.forEach(it => {
    if (!it.product_id) return;
    const effWh = it.warehouse_id || fallbackWhId;
    if (!origByProd.has(it.product_id)) {
      origByProd.set(it.product_id, {
        product_id: it.product_id,
        sku: it.sku || 'S/SKU',
        name: it.name || 'Producto',
        is_virtual: !!it.is_virtual,
        quantity: Number(it.quantity) || 0,
        warehouse_id: effWh
      });
    } else {
      origByProd.get(it.product_id).quantity += (Number(it.quantity) || 0);
    }
  });

  const currByProd = new Map();
  currItems.forEach(it => {
    if (!it.product_id) return;
    const effWh = it.warehouse_id || fallbackWhId;
    if (!currByProd.has(it.product_id)) {
      currByProd.set(it.product_id, {
        product_id: it.product_id,
        sku: it.sku || 'S/SKU',
        name: it.name || 'Producto',
        is_virtual: !!it.is_virtual,
        quantity: Number(it.quantity) || 0,
        warehouse_id: effWh
      });
    } else {
      const existing = currByProd.get(it.product_id);
      existing.quantity += (Number(it.quantity) || 0);
      if (it.warehouse_id) existing.warehouse_id = it.warehouse_id;
    }
  });

  const allProductIds = new Set([...origByProd.keys(), ...currByProd.keys()]);
  const operations = [];
  const virtualNotes = [];

  for (const prodId of allProductIds) {
    const orig = origByProd.get(prodId) || null;
    const curr = currByProd.get(prodId) || null;
    const isVirtual = (curr ? curr.is_virtual : orig?.is_virtual) === true;
    const sku = curr ? curr.sku : orig.sku;
    const name = curr ? curr.name : orig.name;

    if (orig && !curr) {
      if (isVirtual) {
        virtualNotes.push(`SKU ${sku} es virtual (sin efecto en stock físico ni Kardex).`);
        continue;
      }
      const origWhName = getWhName(orig.warehouse_id);
      operations.push({
        type: 'removed',
        product_id: prodId,
        sku,
        name,
        old_qty: orig.quantity,
        new_qty: 0,
        old_warehouse_id: orig.warehouse_id,
        new_warehouse_id: null,
        old_warehouse_name: origWhName,
        new_warehouse_name: null,
        stock_summary_html: `<span style="color:#059669; font-weight:700;">+ Reponer ${orig.quantity} un.</span> de <strong>${sku}</strong> en <strong>${origWhName}</strong> y <span style="color:#059669; font-weight:600;">eliminar salida en Kardex</span> (${orderRefLabel}).`,
        audit_text: `[Inventario/Kardex] Repuesto +${orig.quantity} un. de SKU ${sku} en bodega "${origWhName}" y anulada su salida en Kardex (${orderRefLabel})`
      });
    } else if (!orig && curr) {
      if (isVirtual) {
        virtualNotes.push(`SKU ${sku} es virtual (sin efecto en stock físico ni Kardex).`);
        continue;
      }
      const newWhName = getWhName(curr.warehouse_id);
      operations.push({
        type: 'added',
        product_id: prodId,
        sku,
        name,
        old_qty: 0,
        new_qty: curr.quantity,
        old_warehouse_id: null,
        new_warehouse_id: curr.warehouse_id,
        old_warehouse_name: null,
        new_warehouse_name: newWhName,
        stock_summary_html: `<span style="color:#dc2626; font-weight:700;">- Descontar ${curr.quantity} un.</span> de <strong>${sku}</strong> en <strong>${newWhName}</strong> y <span style="color:#dc2626; font-weight:600;">registrar salida en Kardex</span> (${orderRefLabel}).`,
        audit_text: `[Inventario/Kardex] Descontado -${curr.quantity} un. de SKU ${sku} en bodega "${newWhName}" y registrada salida en Kardex (${orderRefLabel})`
      });
    } else if (orig && curr) {
      if (orig.warehouse_id !== curr.warehouse_id) {
        if (isVirtual) {
          virtualNotes.push(`SKU ${sku} es virtual (sin efecto en stock físico ni Kardex).`);
          continue;
        }
        const origWhName = getWhName(orig.warehouse_id);
        const newWhName = getWhName(curr.warehouse_id);
        operations.push({
          type: 'warehouse_changed',
          product_id: prodId,
          sku,
          name,
          old_qty: orig.quantity,
          new_qty: curr.quantity,
          old_warehouse_id: orig.warehouse_id,
          new_warehouse_id: curr.warehouse_id,
          old_warehouse_name: origWhName,
          new_warehouse_name: newWhName,
          stock_summary_html: `<span style="color:#d97706; font-weight:700;">⇄ Cambio de bodega (${sku}):</span> Reponer <strong>+${orig.quantity} un.</strong> en <strong>${origWhName}</strong>, descontar <strong>-${curr.quantity} un.</strong> en <strong>${newWhName}</strong> y actualizar salida en Kardex (${orderRefLabel}).`,
          audit_text: `[Inventario/Kardex] SKU ${sku}: repuesto +${orig.quantity} un. en "${origWhName}", descontado -${curr.quantity} un. en "${newWhName}" y actualizado Kardex (${orderRefLabel})`
        });
      } else if (orig.quantity !== curr.quantity) {
        if (isVirtual) {
          virtualNotes.push(`SKU ${sku} es virtual (sin efecto en stock físico ni Kardex).`);
          continue;
        }
        const whName = getWhName(curr.warehouse_id);
        const diff = curr.quantity - orig.quantity;
        if (diff > 0) {
          operations.push({
            type: 'qty_increased',
            product_id: prodId,
            sku,
            name,
            old_qty: orig.quantity,
            new_qty: curr.quantity,
            diff_qty: diff,
            old_warehouse_id: orig.warehouse_id,
            new_warehouse_id: curr.warehouse_id,
            old_warehouse_name: whName,
            new_warehouse_name: whName,
            stock_summary_html: `<span style="color:#dc2626; font-weight:700;">- Descontar ${diff} un. adicional(es)</span> de <strong>${sku}</strong> en <strong>${whName}</strong> y actualizar salida en Kardex de ${orig.quantity} a <strong>${curr.quantity} un.</strong> (${orderRefLabel}).`,
            audit_text: `[Inventario/Kardex] Descontado -${diff} un. adicional(es) de SKU ${sku} en "${whName}" y actualizada salida en Kardex de ${orig.quantity} a ${curr.quantity} un. (${orderRefLabel})`
          });
        } else {
          const returnedQty = Math.abs(diff);
          operations.push({
            type: 'qty_decreased',
            product_id: prodId,
            sku,
            name,
            old_qty: orig.quantity,
            new_qty: curr.quantity,
            diff_qty: diff,
            returned_qty: returnedQty,
            old_warehouse_id: orig.warehouse_id,
            new_warehouse_id: curr.warehouse_id,
            old_warehouse_name: whName,
            new_warehouse_name: whName,
            stock_summary_html: `<span style="color:#059669; font-weight:700;">+ Reponer ${returnedQty} un.</span> de <strong>${sku}</strong> en <strong>${whName}</strong> y reducir salida en Kardex de ${orig.quantity} a <strong>${curr.quantity} un.</strong> (${orderRefLabel}).`,
            audit_text: `[Inventario/Kardex] Repuesto +${returnedQty} un. de SKU ${sku} en "${whName}" y reducida salida en Kardex de ${orig.quantity} a ${curr.quantity} un. (${orderRefLabel})`
          });
        }
      }
    }
  }

  return { operations, virtualNotes };
};

window.renderDispatchedEditImpactPreviewHtml = function() {
  const isChecked = !!window.tempEditAdjustDispatchedStock;
  const { operations, virtualNotes } = window.computeDispatchedOrderStockDiffs();

  if (!isChecked) {
    return `
      <div style="margin-top: 0.5rem; padding: 0.55rem 0.7rem; background: rgba(100, 116, 139, 0.08); border-left: 3px solid #64748b; border-radius: 4px; font-size: 0.77rem; color: var(--color-text-muted); line-height: 1.4;">
        <strong style="color: var(--color-text-main); display: block; margin-bottom: 0.15rem;">
          <i class="ri-information-line"></i> Modo Solo Pedido (Opción desactivada):
        </strong>
        Se actualizarán únicamente los ítems y montos del pedido. <strong>No se descontará ni devolverá stock físico en bodega, ni se modificará el Kardex.</strong>
      </div>
    `;
  }

  let opsListHtml = '';
  if (operations.length === 0) {
    opsListHtml = `
      <div style="font-size: 0.77rem; color: #991b1b; font-style: italic; margin-top: 0.35rem;">
        Aún no hay diferencias de unidades o productos físicos respecto al pedido original. Agrega, elimina o modifica la cantidad de un producto arriba para ver el impacto exacto.
      </div>
    `;
  } else {
    opsListHtml = `
      <ul style="margin: 0.4rem 0 0 1.1rem; padding: 0; font-size: 0.78rem; color: var(--color-text-main); line-height: 1.45; display: flex; flex-direction: column; gap: 0.25rem;">
        ${operations.map(op => `<li>${op.stock_summary_html}</li>`).join('')}
      </ul>
    `;
  }

  const virtualHtml = virtualNotes.length > 0
    ? `<div style="margin-top: 0.35rem; font-size: 0.73rem; color: var(--color-text-muted); font-style: italic;">ℹ️ ${virtualNotes.join(' ')}</div>`
    : '';

  return `
    <div style="margin-top: 0.55rem; padding: 0.65rem 0.75rem; background: rgba(220, 38, 38, 0.08); border: 1px solid rgba(220, 38, 38, 0.35); border-left: 4px solid #dc2626; border-radius: 6px; font-size: 0.78rem; line-height: 1.4;">
      <div style="color: #b91c1c; font-weight: 800; display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem;">
        <i class="ri-error-warning-fill" style="font-size: 1rem; color: #dc2626;"></i>
        ADVERTENCIA: SE MODIFICARÁ EL INVENTARIO FÍSICO Y EL KARDEX
      </div>
      <div style="color: #7f1d1d; font-size: 0.75rem; margin-top: 0.2rem;">
        Este pedido ya fue despachado. Al guardar con esta opción activa, se ejecutarán de inmediato los siguientes movimientos reales en bodega y en el Kardex:
      </div>
      ${opsListHtml}
      ${virtualHtml}
    </div>
  `;
};

window.toggleDispatchedEditStockAdjust = function(checked) {
  window.tempEditAdjustDispatchedStock = !!checked;
  window.refreshDispatchedEditImpactPreview();
};

window.refreshDispatchedEditImpactPreview = function() {
  const previewContainer = document.getElementById('swal-dispatched-stock-impact-preview');
  const cardContainer = document.getElementById('swal-dispatched-stock-card');
  if (previewContainer) {
    previewContainer.innerHTML = window.renderDispatchedEditImpactPreviewHtml();
  }
  if (cardContainer) {
    const isChecked = !!window.tempEditAdjustDispatchedStock;
    cardContainer.style.borderColor = isChecked ? '#dc2626' : '#f59e0b';
    cardContainer.style.background = isChecked ? 'rgba(254, 242, 242, 0.55)' : 'rgba(255, 251, 235, 0.6)';
  }
};

window.renderEditItemStockBadgeHtml = function(productId, warehouseId, isVirtual) {
  if (isVirtual) {
    return `<span style="background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 0.7rem;">Virtual</span>`;
  }
  const prod = (window.tempCommerceProducts || []).find(p => p.id === productId);
  if (!prod) return '';

  const whStock = (warehouseId && prod.stockByWarehouse && prod.stockByWarehouse[warehouseId])
    ? prod.stockByWarehouse[warehouseId]
    : null;

  const phys = whStock ? whStock.physical : (prod.physicalStock || 0);
  const res = whStock ? whStock.reserved : (prod.reservedStock || 0);
  const comm = whStock ? whStock.committed : (prod.committedStock || 0);
  const avail = whStock ? whStock.available : (prod.availableStock || 0);
  const isOut = avail <= 0;

  return `
    <span style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; background: ${isOut ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)'}; border: 1px solid ${isOut ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}; color: ${isOut ? '#dc2626' : '#059669'}; font-weight: 600;" title="Stock en bodega seleccionada: Físico ${phys} | Mesa ${res} | Comprometido ${comm} | Disponible ${avail}">
      <i class="${isOut ? 'ri-alert-line' : 'ri-checkbox-circle-line'}"></i> Disp: ${avail} <span style="opacity: 0.75; font-weight: 500;">(Fís:${phys} · Mesa:${res} · Comp:${comm})</span>
    </span>
  `;
};

window.refreshEditOrderModalTotals = function() {
  const items = window.tempEditOrderItems || [];
  const totalQty = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const totalVal = items.reduce((sum, i) => sum + ((Number(i.quantity) || 0) * (Number(i.price) || 0)), 0);
  const qtyEl = document.getElementById('swal-edit-total-qty');
  const valEl = document.getElementById('swal-edit-total-val');
  const formatCLP = window.formatCLP || (v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL'));
  if (qtyEl) qtyEl.textContent = totalQty;
  if (valEl) valEl.textContent = formatCLP(totalVal);
};

window.filterEditOrderModalProducts = function() {
  const searchInput = document.getElementById('swal-add-item-sku');
  const dropdownList = document.getElementById('swal-add-item-dropdown-list');
  const clearBtn = document.getElementById('swal-clear-item-sku-btn');
  if (!dropdownList) return;

  const rawSearch = searchInput ? searchInput.value : '';
  const searchTerm = rawSearch.toLowerCase().trim();
  if (clearBtn) {
    clearBtn.style.display = rawSearch.length > 0 ? 'inline-flex' : 'none';
  }

  const products = window.tempCommerceProducts || [];
  const escapeFn = window.escapeHtml || (s => String(s || '').replace(/"/g, '&quot;'));
  const formatCLP = window.formatCLP || (v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL'));

  if (window.isEditCatalogLoading && products.length <= (window.tempEditOrderItems?.length || 0)) {
    dropdownList.innerHTML = `
      <div style="padding: 0.85rem; text-align: center; color: var(--color-text-muted); font-size: 0.82rem; font-style: italic;">
        <i class="ri-loader-4-line ri-spin" style="display: inline-block; margin-right: 0.35rem;"></i> Cargando catálogo del comercio...
      </div>
    `;
    return;
  }

  const prodIdInput = document.getElementById('swal-add-item-product-id');
  const selectedProd = prodIdInput?.value ? products.find(p => p.id === prodIdInput.value) : null;
  let effectiveTerm = searchTerm;
  if (selectedProd) {
    const selectedDisplay = `${selectedProd.sku} - ${selectedProd.name}`.toLowerCase().trim();
    if (searchTerm === selectedDisplay || searchTerm.startsWith(selectedDisplay + ' (')) {
      effectiveTerm = (selectedProd.sku || '').toLowerCase().trim();
    }
  }

  const tokens = effectiveTerm.split(/\s+/).filter(Boolean);
  let filtered = products;
  if (tokens.length > 0) {
    filtered = products.filter(p => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      return tokens.every(t => sku.includes(t) || name.includes(t));
    });

    filtered = filtered.slice().sort((a, b) => {
      const aSku = (a.sku || '').toLowerCase().trim();
      const bSku = (b.sku || '').toLowerCase().trim();
      const aExact = aSku === effectiveTerm ? 0 : (aSku.startsWith(effectiveTerm) ? 1 : (aSku.includes(effectiveTerm) ? 2 : 3));
      const bExact = bSku === effectiveTerm ? 0 : (bSku.startsWith(effectiveTerm) ? 1 : (bSku.includes(effectiveTerm) ? 2 : 3));
      if (aExact !== bExact) return aExact - bExact;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  if (filtered.length === 0) {
    if (window.isEditCatalogLoading) {
      dropdownList.innerHTML = `
        <div style="padding: 0.85rem; text-align: center; color: var(--color-text-muted); font-size: 0.82rem; font-style: italic;">
          <i class="ri-loader-4-line ri-spin" style="display: inline-block; margin-right: 0.35rem;"></i> Buscando "${escapeFn(rawSearch.trim())}" en catálogo...
        </div>
      `;
      return;
    }
    dropdownList.innerHTML = `
      <div style="padding: 0.85rem; text-align: center; color: var(--color-text-muted); font-size: 0.82rem; font-style: italic;">
        No se encontraron productos para "${escapeFn(rawSearch.trim())}" en este comercio (${products.length} en catálogo).
      </div>
    `;
    return;
  }

  const maxRender = 60;
  const visibleItems = filtered.slice(0, maxRender);
  let html = '';

  visibleItems.forEach(p => {
    const displayVal = `${p.sku} - ${p.name} (${formatCLP(p.price || 0)})`;
    const phys = p.physicalStock !== undefined ? p.physicalStock : 0;
    const comm = p.committedStock !== undefined ? p.committedStock : 0;
    const res = p.reservedStock !== undefined ? p.reservedStock : 0;
    const avail = p.availableStock !== undefined ? p.availableStock : 0;
    const isOutOfStock = avail <= 0;

    let availBadge = '';
    if (p.is_virtual) {
      availBadge = `<span style="background: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">Virtual</span>`;
    } else if (isOutOfStock) {
      availBadge = `<span style="background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.25); padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;"><i class="ri-alert-line"></i> Disp: ${avail} und.</span>`;
    } else {
      availBadge = `<span style="background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25); padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;"><i class="ri-checkbox-circle-line"></i> Disp: ${avail} und.</span>`;
    }

    html += `
      <div class="swal-edit-product-option" data-id="${escapeFn(p.id)}" data-display="${escapeFn(displayVal)}" onclick="window.selectEditOrderModalProduct('${escapeFn(p.id)}')" style="padding: 0.55rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--color-border); color: var(--color-text-main); transition: background-color 0.15s; display: flex; flex-direction: column; gap: 0.25rem;" onmouseover="this.style.backgroundColor='var(--color-bg)'" onmouseout="this.style.backgroundColor='transparent'">
        <div style="display: flex; gap: 0.65rem; align-items: center;">
          <div style="width: 36px; height: 36px; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); flex-shrink: 0; overflow: hidden;">
            ${p.image_url ? `
              <img src="${escapeFn(p.image_url)}" loading="lazy" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.outerHTML='<i class=\\'ri-image-line\\' style=\\'font-size:1.1rem;\\'></i>'">
            ` : `<i class="ri-image-line" style="font-size: 1.1rem;"></i>`}
          </div>
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem;">
              <span style="font-weight: 700; color: var(--color-primary); font-size: 0.85rem;">
                ${escapeFn(p.sku)}
                ${p.is_virtual ? '<span style="font-size:0.65rem; background:#e0e7ff; color:#4338ca; padding:1px 5px; border-radius:4px; font-weight:700; margin-left:4px;">Virtual</span>' : ''}
              </span>
              <span style="color: var(--color-text-muted); font-weight: 600; font-size: 0.8rem;">${formatCLP(p.price || 0)}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeFn(p.name)}">
              ${escapeFn(p.name)}
            </div>
          </div>
        </div>
        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.35rem; font-size: 0.72rem; margin-top: 0.15rem; background: var(--color-surface-hover, rgba(0,0,0,0.02)); padding: 0.25rem 0.4rem; border-radius: 4px; border: 1px dashed var(--color-border);">
          <div style="display: flex; gap: 0.6rem; color: var(--color-text-muted); align-items: center; font-size: 0.72rem;">
            <span title="Stock físico total en bodega" style="display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-box-3-line" style="color: var(--color-primary); font-size: 0.85rem;"></i> Fís: <strong style="color: var(--color-text-main);">${phys}</strong></span>
            <span style="opacity: 0.35;">|</span>
            <span title="Stock en mesa de empaque o preparación" style="display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-archive-drawer-line" style="color: #f59e0b; font-size: 0.85rem;"></i> Mesa: <strong style="color: #d97706;">${res}</strong></span>
            <span style="opacity: 0.35;">|</span>
            <span title="Stock asignado a pedidos en procesamiento" style="display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-time-line" style="color: var(--color-accent, #3b82f6); font-size: 0.85rem;"></i> Comp: <strong style="color: var(--color-accent, #3b82f6);">${comm}</strong></span>
          </div>
          <div>
            ${availBadge}
          </div>
        </div>
      </div>
    `;
  });

  if (filtered.length > maxRender) {
    html += `
      <div style="padding: 0.45rem 0.75rem; text-align: center; font-size: 0.73rem; color: var(--color-text-muted); background: var(--color-bg); font-style: italic;">
        Mostrando ${maxRender} de ${filtered.length} productos coincidentes — escribe más letras del SKU o nombre para acotar...
      </div>
    `;
  }

  dropdownList.innerHTML = html;
};

window.selectEditOrderModalProduct = function(productId) {
  const products = window.tempCommerceProducts || [];
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const prodIdInput = document.getElementById('swal-add-item-product-id');
  const skuInput = document.getElementById('swal-add-item-sku');
  const dropdownList = document.getElementById('swal-add-item-dropdown-list');
  const clearBtn = document.getElementById('swal-clear-item-sku-btn');

  if (prodIdInput) prodIdInput.value = product.id;
  if (skuInput) skuInput.value = `${product.sku} - ${product.name}`;
  if (dropdownList) dropdownList.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'inline-flex';

  window.updateEditOrderProductStockAlert();
};

window.clearEditOrderModalProductSearch = function() {
  const prodIdInput = document.getElementById('swal-add-item-product-id');
  const skuInput = document.getElementById('swal-add-item-sku');
  const dropdownList = document.getElementById('swal-add-item-dropdown-list');
  const alertBox = document.getElementById('swal-selected-product-stock-alert');
  const clearBtn = document.getElementById('swal-clear-item-sku-btn');

  if (prodIdInput) prodIdInput.value = '';
  if (skuInput) {
    skuInput.value = '';
    skuInput.focus();
  }
  if (clearBtn) clearBtn.style.display = 'none';
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.innerHTML = '';
  }
  if (dropdownList) {
    window.filterEditOrderModalProducts();
    dropdownList.style.display = 'block';
  }
};

window.updateEditOrderProductStockAlert = function() {
  const container = document.getElementById('swal-selected-product-stock-alert');
  if (!container) return;

  const prodIdInput = document.getElementById('swal-add-item-product-id');
  const skuInput = document.getElementById('swal-add-item-sku');
  const qtyInput = document.getElementById('swal-add-item-qty');
  const requestedQty = Math.max(1, parseInt(qtyInput?.value, 10) || 1);

  const products = window.tempCommerceProducts || [];
  let product = null;
  if (prodIdInput && prodIdInput.value) {
    product = products.find(p => p.id === prodIdInput.value) || null;
  }
  if (!product && skuInput && skuInput.value.trim()) {
    product = window.findProductInCommerce(skuInput.value.trim());
  }

  if (!product) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const escapeFn = window.escapeHtml || (s => String(s || '').replace(/"/g, '&quot;'));
  const formatCLP = window.formatCLP || (v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL'));
  const existingItem = (window.tempEditOrderItems || []).find(i => i.product_id === product.id);
  const currentInOrder = existingItem ? (Number(existingItem.quantity) || 0) : 0;
  const totalRequested = requestedQty + currentInOrder;

  const phys = product.physicalStock !== undefined ? product.physicalStock : 0;
  const comm = product.committedStock !== undefined ? product.committedStock : 0;
  const res = product.reservedStock !== undefined ? product.reservedStock : 0;
  const avail = product.availableStock !== undefined ? product.availableStock : 0;

  const imgHtml = product.image_url
    ? `<img src="${escapeFn(product.image_url)}" alt="" style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px; border: 1px solid var(--color-border); flex-shrink: 0;" onerror="this.style.display='none'">`
    : `<div style="width: 40px; height: 40px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-surface); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); flex-shrink: 0;"><i class="ri-image-line" style="font-size: 1.1rem;"></i></div>`;

  if (product.is_virtual) {
    container.style.display = 'block';
    container.innerHTML = `
      <div style="margin-top: 0.6rem; background: rgba(79, 70, 229, 0.08); border: 1px solid rgba(79, 70, 229, 0.3); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.78rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          ${imgHtml}
          <div>
            <div style="font-weight: 700; color: #4338ca;">${escapeFn(product.sku)} — Producto Virtual</div>
            <div style="font-size: 0.74rem; color: var(--color-text-muted);">${escapeFn(product.name)} (${formatCLP(product.price || 0)})</div>
          </div>
        </div>
        <span style="background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 10px; font-weight: 700; font-size: 0.72rem;">Virtual</span>
      </div>
    `;
    return;
  }

  const isDeficit = totalRequested > avail;
  const deficitQty = Math.max(0, totalRequested - avail);

  if (isDeficit) {
    container.style.display = 'block';
    container.innerHTML = `
      <div style="margin-top: 0.6rem; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: var(--radius-sm); padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${imgHtml}
            <div>
              <span style="font-weight: 700; color: #ef4444; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem;">
                <i class="ri-error-warning-line"></i> Stock disponible insuficiente para ${escapeFn(product.sku)}
              </span>
              <span style="font-size: 0.74rem; color: var(--color-text-muted); display: block;">${escapeFn(product.name)} · ${formatCLP(product.price || 0)}</span>
            </div>
          </div>
          <span style="font-size: 0.73rem; font-weight: 700; background: #ef4444; color: white; padding: 2px 8px; border-radius: 12px;">
            Faltante: ${deficitQty} und.
          </span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.6rem; font-size: 0.75rem; color: var(--color-text-main); background: var(--color-surface); padding: 0.4rem 0.6rem; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2);">
          <span><i class="ri-box-3-line" style="color: var(--color-primary);"></i> <strong>Físico:</strong> ${phys}</span>
          <span style="color: var(--color-border);">|</span>
          <span><i class="ri-archive-drawer-line" style="color: #f59e0b;"></i> <strong>En Mesa:</strong> ${res}</span>
          <span style="color: var(--color-border);">|</span>
          <span><i class="ri-time-line" style="color: var(--color-accent, #3b82f6);"></i> <strong>Comprometido:</strong> ${comm}</span>
          <span style="color: var(--color-border);">|</span>
          <span style="color: #ef4444; font-weight: 700;"><i class="ri-alert-line"></i> <strong>Disponible:</strong> ${avail} und.</span>
        </div>
      </div>
    `;
  } else {
    container.style.display = 'block';
    container.innerHTML = `
      <div style="margin-top: 0.6rem; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; font-size: 0.76rem;">
        <div style="display: flex; align-items: center; gap: 0.55rem; color: var(--color-text-main);">
          ${imgHtml}
          <div>
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <span style="color: #10b981; font-weight: 700; display: inline-flex; align-items: center; gap: 0.2rem;"><i class="ri-checkbox-circle-line"></i> Stock OK (${escapeFn(product.sku)}):</span>
              <span><i class="ri-box-3-line" style="color: var(--color-primary);"></i> Fís: <strong>${phys}</strong></span>
              <span style="color: var(--color-border);">|</span>
              <span><i class="ri-archive-drawer-line" style="color: #f59e0b;"></i> Mesa: <strong>${res}</strong></span>
              <span style="color: var(--color-border);">|</span>
              <span><i class="ri-time-line" style="color: var(--color-accent, #3b82f6);"></i> Comp: <strong>${comm}</strong></span>
            </div>
            <div style="font-size: 0.73rem; color: var(--color-text-muted); margin-top: 0.1rem;">${escapeFn(product.name)} · ${formatCLP(product.price || 0)}</div>
          </div>
        </div>
        <div>
          <span style="color: #10b981; font-weight: 700; display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-checkbox-circle-line"></i> Disp: ${avail} und.</span>
        </div>
      </div>
    `;
  }
};

window.renderEditOrderItemsModal = function(orderId, commerce, existingComment = '') {
  const escapeFn = window.escapeHtml || (s => String(s || '').replace(/"/g, '&quot;'));
  const formatCLP = window.formatCLP || (v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL'));
  let rowsHtml = '';
  let totalQty = 0;
  let totalVal = 0;

  const isAdmin = !!(window.tempEditOrderData && window.tempEditOrderData.isAdmin);

  if (window.tempEditOrderItems.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--color-text-muted); padding: 1rem; font-style: italic;">
          No hay productos en este pedido. Agrega uno abajo.
        </td>
      </tr>
    `;
  } else {
    window.tempEditOrderItems.forEach((item, index) => {
      totalQty += Number(item.quantity) || 0;
      totalVal += (Number(item.quantity) || 0) * (Number(item.price) || 0);

      const warehouseOptions = (window.tempWarehouses || []).map(w => `
        <option value="${w.id}" ${item.warehouse_id === w.id ? 'selected' : ''}>${w.name}</option>
      `).join('');

      const itemThumbHtml = `
        <div style="width: 38px; height: 38px; border-radius: 5px; border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); flex-shrink: 0; overflow: hidden;">
          ${item.image_url ? `
            <img src="${escapeFn(item.image_url)}" loading="lazy" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.outerHTML='<i class=\\'ri-image-line\\' style=\\'font-size:1.05rem;\\'></i>'">
          ` : `<i class="ri-image-line" style="font-size: 1.05rem;"></i>`}
        </div>
      `;

      rowsHtml += `
        <tr style="border-bottom: 1px solid var(--color-border);">
          <td style="padding: 0.55rem 0.5rem; text-align: left;">
            <div style="display: flex; align-items: flex-start; gap: 0.6rem;">
              ${itemThumbHtml}
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                  <strong style="color: var(--color-text-main);">${escapeFn(item.sku)}</strong>
                  ${item.is_virtual ? '<span style="font-size:0.65rem; background:#e0e7ff; color:#4338ca; padding:1px 5px; border-radius:4px; font-weight:700;">Virtual</span>' : ''}
                  <span style="font-size: 0.73rem; color: var(--color-text-muted);">(${formatCLP(item.price || 0)} c/u)</span>
                </div>
                <span style="font-size: 0.76rem; color: var(--color-text-muted); display: block; margin-bottom: 0.3rem;">${escapeFn(item.name)}</span>
                <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; font-size: 0.75rem;">
                  ${isAdmin ? `
                    <div style="display: inline-flex; align-items: center; gap: 0.25rem;">
                      <span style="color: var(--color-text-muted);">Bodega:</span>
                      <select onchange="window.updateTempEditItemWarehouse(${index}, this.value)" style="padding: 0.15rem 0.35rem; font-size: 0.74rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); font-weight: 500;">
                        ${warehouseOptions}
                      </select>
                    </div>
                  ` : ''}
                  <span id="swal-edit-item-stock-badge-${index}">
                    ${window.renderEditItemStockBadgeHtml(item.product_id, item.warehouse_id, item.is_virtual)}
                  </span>
                </div>
              </div>
            </div>
          </td>
          <td style="padding: 0.5rem; text-align: center;">
            <input type="number" value="${item.quantity}" min="1" oninput="window.updateTempEditItemQuantity(${index}, this.value)" onchange="window.updateTempEditItemQuantity(${index}, this.value)" style="width: 64px; padding: 0.25rem; font-size: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); text-align: center; background: var(--color-surface); color: var(--color-text-main); font-weight: 600;" />
          </td>
          <td style="padding: 0.5rem; text-align: right; font-weight: 600;" id="swal-edit-item-subtotal-${index}">
            ${formatCLP(item.price * item.quantity)}
          </td>
          <td style="padding: 0.5rem; text-align: center;">
            <button onclick="window.removeTempEditItem(${index}, '${orderId}', '${escapeFn(commerce)}')" class="btn btn-outline" style="padding: 0.25rem 0.4rem; border-color: var(--color-danger); color: var(--color-danger); cursor: pointer;" title="Eliminar producto del pedido"><i class="ri-delete-bin-line"></i></button>
          </td>
        </tr>
      `;
    });
  }

  const commerceProducts = window.tempCommerceProducts || [];
  const catalogCountLabel = window.isEditCatalogLoading
    ? '(cargando catálogo...)'
    : `(${commerceProducts.length} productos en catálogo)`;
  const isDispatched = !!(window.tempEditOrderData && window.tempEditOrderData.isDispatched);
  const isChecked = !!window.tempEditAdjustDispatchedStock;
  const orderNumberDisplay = window.tempEditOrderData?.external_order_number || orderId;

  const dispatchedTopBannerHtml = (isDispatched && isAdmin) ? `
    <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; border-radius: var(--radius-sm); background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.35); color: #065f46; font-size: 0.8rem; font-weight: 600;">
      <i class="ri-truck-line" style="font-size: 1.05rem; color: #059669;"></i>
      <span>Pedido <strong>#${escapeFn(orderNumberDisplay)}</strong> en estado WMS <strong>Despachado</strong> (stock físico ya rebajado).</span>
    </div>
  ` : '';

  const dispatchedStockControlHtml = (isDispatched && isAdmin) ? `
    <div id="swal-dispatched-stock-card" style="padding: 0.8rem 0.9rem; border-radius: var(--radius-md); border: 2px solid ${isChecked ? '#dc2626' : '#f59e0b'}; background: ${isChecked ? 'rgba(254, 242, 242, 0.55)' : 'rgba(255, 251, 235, 0.6)'}; margin-bottom: 1.1rem; transition: all 0.2s;">
      <label style="display: flex; align-items: flex-start; gap: 0.6rem; cursor: pointer; margin: 0; user-select: none;">
        <input type="checkbox" id="swal-edit-items-adjust-stock" ${isChecked ? 'checked' : ''} onchange="window.toggleDispatchedEditStockAdjust(this.checked)" style="margin-top: 0.15rem; width: 18px; height: 18px; accent-color: #dc2626; cursor: pointer; flex-shrink: 0;">
        <div style="flex: 1;">
          <span style="font-weight: 800; font-size: 0.86rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;">
            <i class="ri-exchange-box-line" style="color: #d97706; font-size: 1rem;"></i>
            Impactar Inventario Físico y Kardex con esta edición
          </span>
          <span style="font-size: 0.76rem; color: var(--color-text-muted); display: block; margin-top: 0.15rem; line-height: 1.35;">
            Activa esta opción si deseas que al añadir o quitar productos en este pedido <strong>Despachado</strong> se descuente o reponga el stock físico real en bodega y se actualice su salida en el Kardex.
          </span>
        </div>
      </label>
      <div id="swal-dispatched-stock-impact-preview">
        ${window.renderDispatchedEditImpactPreviewHtml()}
      </div>
    </div>
  ` : '';

  const htmlContent = `
    <div id="swal-edit-order-modal-wrapper" style="text-align: left; max-height: 75vh; overflow-y: auto; padding-right: 4px;">
      ${dispatchedTopBannerHtml}
      <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.85rem;">
        Modifica las cantidades o elimina ítems. Utiliza el buscador de abajo para agregar nuevos productos de la tienda <strong>${escapeFn(commerce)}</strong> <span id="swal-edit-catalog-count" style="font-size: 0.75rem; opacity: 0.85;">${catalogCountLabel}</span>.
      </p>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 0.5rem;">
        <thead>
          <tr style="border-bottom: 2px solid var(--color-border); color: var(--color-text-muted); text-align: left;">
            <th style="padding: 0.5rem;">Producto</th>
            <th style="padding: 0.5rem; width: 80px; text-align: center;">Cant</th>
            <th style="padding: 0.5rem; text-align: right; width: 105px;">Subtotal</th>
            <th style="padding: 0.5rem; text-align: center; width: 50px;">Acción</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div style="display: flex; justify-content: flex-end; gap: 1.5rem; font-size: 0.83rem; font-weight: 700; color: var(--color-text-main); padding: 0.35rem 0.5rem 0.75rem 0.5rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--color-border);">
        <span>Total Unidades: <span id="swal-edit-total-qty" style="color: var(--color-primary);">${totalQty}</span></span>
        <span>Total Pedido: <span id="swal-edit-total-val" style="color: var(--color-primary);">${formatCLP(totalVal)}</span></span>
      </div>

      <div id="swal-edit-add-product-box" style="background: var(--color-bg); padding: 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 1.1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; gap: 0.5rem;">
          <h5 style="margin: 0; font-size: 0.85rem; color: var(--color-primary); font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
            <i class="ri-search-eye-line"></i> Agregar Producto
          </h5>
          <span style="font-size: 0.72rem; color: var(--color-text-muted);">Busca por SKU o nombre con fotos y stock en vivo</span>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <div style="flex-grow: 1; min-width: 220px; position: relative;">
            <input type="hidden" id="swal-add-item-product-id" value="">
            <input type="text" id="swal-add-item-sku" placeholder="🔍 Escribe SKU o nombre para buscar..." autocomplete="off" style="width: 100%; padding: 0.45rem 2rem 0.45rem 0.65rem; font-size: 0.83rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); box-sizing: border-box;">
            <button type="button" id="swal-clear-item-sku-btn" onclick="window.clearEditOrderModalProductSearch()" title="Limpiar búsqueda" style="display: none; position: absolute; right: 0.4rem; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--color-text-muted); cursor: pointer; padding: 0.15rem; font-size: 1rem; align-items: center; justify-content: center;">
              <i class="ri-close-circle-fill"></i>
            </button>
          </div>
          <div style="width: 76px;">
            <input type="number" id="swal-add-item-qty" value="1" min="1" title="Cantidad a agregar" style="width: 100%; padding: 0.45rem 0.35rem; font-size: 0.83rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); text-align: center; background: var(--color-surface); color: var(--color-text-main); font-weight: 600; box-sizing: border-box;">
          </div>
          <button onclick="window.addTempEditItem('${orderId}', '${escapeFn(commerce)}')" type="button" class="btn btn-primary" style="padding: 0.45rem 0.85rem; font-size: 0.83rem; cursor: pointer; color: white; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; height: 35px;"><i class="ri-add-line"></i> Agregar</button>
        </div>

        <div id="swal-add-item-dropdown-list" style="display: none; max-height: 240px; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); box-shadow: var(--shadow-md); margin-top: 0.45rem;"></div>

        <div id="swal-selected-product-stock-alert" style="display: none;"></div>
      </div>

      ${dispatchedStockControlHtml}

      <div class="form-group" style="margin-bottom: 0.5rem;">
        <label class="form-label" style="font-weight: 700; font-size: 0.85rem; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">Motivo / Comentario de la Modificación <span style="color: var(--color-danger);">*</span></label>
        <textarea id="swal-edit-items-comment" oninput="window.syncEditOrderQuickCommentPills && window.syncEditOrderQuickCommentPills()" placeholder="Ej: Reemplazo de SKU o ajuste solicitado por el cliente..." style="width: 100%; height: 60px; font-size: 0.8rem; padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); box-sizing: border-box;" required>${escapeFn(existingComment)}</textarea>
        <div style="margin-top: 0.45rem;">
          <div style="font-size: 0.72rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.25rem;">
            <i class="ri-flashlight-line" style="color: var(--color-primary);"></i> Comentarios frecuentes:
          </div>
          <div id="swal-edit-quick-comments" style="display: flex; flex-wrap: wrap; gap: 0.35rem;">
            ${(window.EDIT_ORDER_QUICK_COMMENTS || [
              { label: 'SKU equivalente', icon: 'ri-exchange-line' },
              { label: 'Mismo producto / actualización de código', icon: 'ri-barcode-line' },
              { label: 'Reemplazo por SKU agotado', icon: 'ri-find-replace-line' },
              { label: 'Se elimina ítem agotado', icon: 'ri-delete-bin-line' },
              { label: 'Cambio solicitado por comercio / cliente', icon: 'ri-chat-check-line' },
              { label: 'Desglose de pack en SKUs individuales', icon: 'ri-stack-line' },
              { label: 'Ítem agregado por solicitud del comercio', icon: 'ri-add-circle-line' }
            ]).map(chip => `
              <button type="button" class="swal-edit-quick-comment-pill" data-comment="${escapeFn(chip.label)}" onclick="window.applyEditOrderQuickComment('${escapeFn(chip.label)}')" style="border-radius: 999px; font-size: 0.72rem; font-weight: 600; padding: 0.24rem 0.62rem; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-main); display: inline-flex; align-items: center; gap: 0.28rem; cursor: pointer; transition: all 0.15s ease;">
                <i class="${chip.icon}" style="font-size: 0.82rem; color: var(--color-primary);"></i> ${escapeFn(chip.label)}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  Swal.fire({
    title: 'Editar Ítems del Pedido',
    html: htmlContent,
    width: '720px',
    showCancelButton: true,
    confirmButtonText: '<i class="ri-save-line"></i> Guardar Cambios',
    cancelButtonText: 'Cancelar',
    allowOutsideClick: false,
    didOpen: () => {
      const skuInput = document.getElementById('swal-add-item-sku');
      const prodIdInput = document.getElementById('swal-add-item-product-id');
      const qtyInput = document.getElementById('swal-add-item-qty');
      const dropdownList = document.getElementById('swal-add-item-dropdown-list');
      const addBox = document.getElementById('swal-edit-add-product-box');
      const wrapper = document.getElementById('swal-edit-order-modal-wrapper');

      if (skuInput && dropdownList) {
        skuInput.addEventListener('focus', () => {
          window.filterEditOrderModalProducts();
          dropdownList.style.display = 'block';
        });
        skuInput.addEventListener('input', () => {
          if (prodIdInput) prodIdInput.value = '';
          window.filterEditOrderModalProducts();
          dropdownList.style.display = 'block';
          window.updateEditOrderProductStockAlert();
        });
        skuInput.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            window.addTempEditItem(orderId, commerce);
          } else if (ev.key === 'Escape') {
            dropdownList.style.display = 'none';
          }
        });
      }

      if (qtyInput) {
        qtyInput.addEventListener('input', () => window.updateEditOrderProductStockAlert());
        qtyInput.addEventListener('change', () => window.updateEditOrderProductStockAlert());
        qtyInput.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            window.addTempEditItem(orderId, commerce);
          }
        });
      }

      if (wrapper && dropdownList && addBox) {
        wrapper.addEventListener('click', (ev) => {
          if (!addBox.contains(ev.target)) {
            dropdownList.style.display = 'none';
          }
        });
      }

      if (typeof window.syncEditOrderQuickCommentPills === 'function') {
        window.syncEditOrderQuickCommentPills();
      }
    },
    preConfirm: async () => {
      const skuInput = document.getElementById('swal-add-item-sku');
      const prodIdInput = document.getElementById('swal-add-item-product-id');
      const qtyInput = document.getElementById('swal-add-item-qty');
      if (skuInput && skuInput.value.trim()) {
        if (window.isEditCatalogLoading && window.activeEditCatalogPromise) {
          await window.activeEditCatalogPromise;
        }
        const rawSku = skuInput.value.trim();
        const rawQty = qtyInput ? qtyInput.value : 1;
        const explicitProdId = prodIdInput?.value || null;
        const success = window.tryAddTempEditItem(orderId, commerce, rawSku, rawQty, explicitProdId);
        if (!success) {
          Swal.showValidationMessage(`El producto "${rawSku}" no fue encontrado en ${commerce}. Selecciona un SKU válido del listado desplegable.`);
          return false;
        }
      }

      const comment = document.getElementById('swal-edit-items-comment').value.trim();
      if (!comment) {
        Swal.showValidationMessage('El motivo de la modificación es obligatorio.');
        return false;
      }

      const adjustStockCb = document.getElementById('swal-edit-items-adjust-stock');
      const adjustDispatchedStock = adjustStockCb ? !!adjustStockCb.checked : !!window.tempEditAdjustDispatchedStock;
      window.tempEditAdjustDispatchedStock = adjustDispatchedStock;

      return { comment, adjustDispatchedStock };
    }
  }).then(result => {
    if (result.isConfirmed) {
      window.saveEditOrderItems(orderId, result.value.comment, result.value.adjustDispatchedStock);
    }
  });
};

window.EDIT_ORDER_QUICK_COMMENTS = [
  { label: 'SKU equivalente', icon: 'ri-exchange-line' },
  { label: 'Mismo producto / actualización de código', icon: 'ri-barcode-line' },
  { label: 'Reemplazo por SKU agotado', icon: 'ri-find-replace-line' },
  { label: 'Se elimina ítem agotado', icon: 'ri-delete-bin-line' },
  { label: 'Cambio solicitado por comercio / cliente', icon: 'ri-chat-check-line' },
  { label: 'Desglose de pack en SKUs individuales', icon: 'ri-stack-line' },
  { label: 'Ítem agregado por solicitud del comercio', icon: 'ri-add-circle-line' }
];

window.syncEditOrderQuickCommentPills = function() {
  const textarea = document.getElementById('swal-edit-items-comment');
  const container = document.getElementById('swal-edit-quick-comments');
  if (!textarea || !container) return;
  const currentVal = (textarea.value || '').trim().toLowerCase();
  const pills = container.querySelectorAll('.swal-edit-quick-comment-pill');
  pills.forEach(btn => {
    const label = (btn.getAttribute('data-comment') || '').trim().toLowerCase();
    const isActive = currentVal === label || (currentVal.length > 0 && label.length > 0 && currentVal.includes(label));
    if (isActive) {
      btn.style.borderColor = 'var(--color-primary)';
      btn.style.background = 'rgba(37, 99, 235, 0.12)';
      btn.style.color = 'var(--color-primary)';
    } else {
      btn.style.borderColor = 'var(--color-border)';
      btn.style.background = 'var(--color-bg)';
      btn.style.color = 'var(--color-text-main)';
    }
  });
};

window.applyEditOrderQuickComment = function(text) {
  const textarea = document.getElementById('swal-edit-items-comment');
  if (!textarea || !text) return;
  const currentVal = (textarea.value || '').trim();
  const presetsLower = (window.EDIT_ORDER_QUICK_COMMENTS || []).map(c => c.label.toLowerCase());
  if (!currentVal || presetsLower.includes(currentVal.toLowerCase())) {
    textarea.value = text;
  } else if (!currentVal.toLowerCase().includes(text.toLowerCase())) {
    textarea.value = `${currentVal}, ${text}`;
  }
  if (typeof Swal !== 'undefined' && typeof Swal.resetValidationMessage === 'function') {
    Swal.resetValidationMessage();
  }
  window.syncEditOrderQuickCommentPills();
  textarea.focus();
  const len = textarea.value.length;
  try { textarea.setSelectionRange(len, len); } catch (e) {}
};

window.updateTempEditItemQuantity = function(index, val) {
  const qty = parseInt(val, 10);
  if (isNaN(qty) || qty < 1) return;
  if (!window.tempEditOrderItems[index]) return;
  window.tempEditOrderItems[index].quantity = qty;
  const subtotalCell = document.getElementById(`swal-edit-item-subtotal-${index}`);
  const formatCLP = window.formatCLP || (v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL'));
  if (subtotalCell) {
    subtotalCell.textContent = formatCLP((window.tempEditOrderItems[index].price || 0) * qty);
  }
  window.refreshEditOrderModalTotals();
  window.updateEditOrderProductStockAlert();
  window.refreshDispatchedEditImpactPreview();
};

window.updateTempEditItemWarehouse = function(index, val) {
  if (!window.tempEditOrderItems[index]) return;
  window.tempEditOrderItems[index].warehouse_id = val || null;
  const item = window.tempEditOrderItems[index];
  const badgeEl = document.getElementById(`swal-edit-item-stock-badge-${index}`);
  if (badgeEl && typeof window.renderEditItemStockBadgeHtml === 'function') {
    badgeEl.innerHTML = window.renderEditItemStockBadgeHtml(item.product_id, item.warehouse_id, item.is_virtual);
  }
  window.refreshDispatchedEditImpactPreview();
};

window.removeTempEditItem = function(index, orderId, commerce) {
  const commentVal = document.getElementById('swal-edit-items-comment')?.value || '';
  const adjustStockCb = document.getElementById('swal-edit-items-adjust-stock');
  if (adjustStockCb) window.tempEditAdjustDispatchedStock = !!adjustStockCb.checked;
  window.tempEditOrderItems.splice(index, 1);
  window.renderEditOrderItemsModal(orderId, commerce, commentVal);
};

window.addTempEditItem = async function(orderId, commerce) {
  const skuInput = document.getElementById('swal-add-item-sku');
  const prodIdInput = document.getElementById('swal-add-item-product-id');
  const qtyInput = document.getElementById('swal-add-item-qty');
  if (!skuInput || !qtyInput) return;

  const rawSku = skuInput.value.trim();
  const explicitProdId = prodIdInput?.value || null;
  const rawQty = qtyInput.value.trim();

  if (!rawSku && !explicitProdId) {
    alert('Por favor escribe o selecciona un producto de la lista.');
    return;
  }

  if (window.isEditCatalogLoading && window.activeEditCatalogPromise) {
    await window.activeEditCatalogPromise;
  }

  const adjustStockCb = document.getElementById('swal-edit-items-adjust-stock');
  if (adjustStockCb) window.tempEditAdjustDispatchedStock = !!adjustStockCb.checked;

  const success = window.tryAddTempEditItem(orderId, commerce, rawSku, rawQty, explicitProdId);
  if (!success) {
    alert(`Producto "${rawSku}" no encontrado en ${commerce}. Por favor selecciona un producto válido del listado desplegable.`);
    return;
  }

  const commentVal = document.getElementById('swal-edit-items-comment')?.value || '';
  window.renderEditOrderItemsModal(orderId, commerce, commentVal);
};

window.saveEditOrderItems = async function(orderId, comment, adjustDispatchedStock = false) {
  try {
    const originalMap = new Map(window.originalEditOrderItems.map(i => [i.id, i]));
    const currentMap = new Map(window.tempEditOrderItems.filter(i => i.id).map(i => [i.id, i]));

    const changesList = [];

    for (const orig of window.originalEditOrderItems) {
      if (!currentMap.has(orig.id)) {
        changesList.push(`Eliminado SKU ${orig.sku}: ${orig.name} (Cant: ${orig.quantity})`);
      } else {
        const curr = currentMap.get(orig.id);
        if (curr.quantity !== orig.quantity || curr.warehouse_id !== orig.warehouse_id) {
          const origWhName = (window.tempWarehouses || []).find(w => w.id === orig.warehouse_id)?.name || 'Bodega Central';
          const currWhName = (window.tempWarehouses || []).find(w => w.id === curr.warehouse_id)?.name || 'Bodega Central';
          let changeMsg = `Modificado SKU ${orig.sku}: ${orig.name}`;
          if (curr.quantity !== orig.quantity) changeMsg += ` de cantidad ${orig.quantity} a ${curr.quantity}`;
          if (curr.warehouse_id !== orig.warehouse_id) changeMsg += ` de bodega "${origWhName}" a "${currWhName}"`;
          changesList.push(changeMsg);
        }
      }
    }

    for (const curr of window.tempEditOrderItems) {
      if (!curr.id) {
        changesList.push(`Agregado SKU ${curr.sku}: ${curr.name} (Cant: ${curr.quantity})`);
      }
    }

    if (changesList.length === 0) {
      Swal.fire('Sin Cambios', 'No se realizaron modificaciones al pedido.', 'info');
      return;
    }

    const orderData = window.tempEditOrderData || {};
    const isAdmin = !!orderData.isAdmin;
    const isDispatched = !!orderData.isDispatched;
    const commerceName = orderData.comercio || '';
    const orderNumDisplay = orderData.external_order_number || orderId;

    // Validación de seguridad para clientes
    const estadoWmsLower = String(orderData.estado_wms || orderData.status || '').toLowerCase().trim();
    if (!isAdmin && estadoWmsLower !== 'en procesamiento') {
      Swal.fire('Error', 'Los pedidos solo pueden editarse mientras se encuentran en estado "En procesamiento".', 'error');
      return;
    }

    const dispatchedDiffs = (isDispatched && isAdmin) ? window.computeDispatchedOrderStockDiffs() : { operations: [], virtualNotes: [] };

    // Confirmación de seguridad si se impacta kardex en despacho (solo admin)
    if (isAdmin && isDispatched && adjustDispatchedStock && dispatchedDiffs.operations.length > 0) {
      const confirmResult = await Swal.fire({
        icon: 'warning',
        title: '⚠️ Confirmar Impacto en Inventario y Kardex',
        width: '620px',
        html: `
          <div style="text-align: left; font-size: 0.88rem; line-height: 1.45;">
            <p style="margin-bottom: 0.65rem; color: var(--color-text-main);">
              Estás editando el pedido <strong>#${ (window.escapeHtml || (s => s))(orderNumDisplay) }</strong> que ya se encuentra <strong>Despachado</strong>, con la opción de <strong>ajuste de inventario y Kardex activada</strong>.
            </p>
            <div style="padding: 0.75rem 0.85rem; background: rgba(220, 38, 38, 0.08); border: 1.5px solid rgba(220, 38, 38, 0.4); border-radius: 6px; margin-bottom: 0.75rem;">
              <strong style="color: #b91c1c; display: block; margin-bottom: 0.35rem; font-size: 0.84rem;">
                Efectos inmediatos que se aplicarán al confirmar:
              </strong>
              <ul style="margin: 0 0 0 1.15rem; padding: 0; font-size: 0.82rem; display: flex; flex-direction: column; gap: 0.3rem;">
                ${dispatchedDiffs.operations.map(op => `<li>${op.stock_summary_html}</li>`).join('')}
              </ul>
            </div>
            <p style="margin: 0; font-size: 0.8rem; color: var(--color-text-muted);">
              <strong>Motivo registrado:</strong> "${ (window.escapeHtml || (s => s))(comment) }"
            </p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: '<i class="ri-check-double-line"></i> Sí, aplicar en Inventario y Kardex',
        cancelButtonText: 'Volver a edición',
        allowOutsideClick: false
      });

      if (!confirmResult.isConfirmed) {
        window.renderEditOrderItemsModal(orderId, commerceName, comment);
        return;
      }
    }

    Swal.fire({
      title: 'Guardando cambios...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const { data: { session } } = await supabase.auth.getSession();
    const userEmail = session?.user?.email || (isAdmin ? 'admin@stocka.cl' : 'cliente@stocka.cl');
    const userId = session?.user?.id || null;

    let defaultWarehouseId = null;
    if (window.tempEditOrderItems.some(i => !i.warehouse_id)) {
      const { data: central } = await supabase
        .from('warehouses')
        .select('id')
        .ilike('name', '%Central%')
        .limit(1)
        .single();
      if (central) defaultWarehouseId = central.id;
    }

    // 1. Procesar eliminaciones y actualizaciones usando ID
    for (const orig of window.originalEditOrderItems) {
      if (!currentMap.has(orig.id)) {
        const { error } = await supabase
          .from('order_items')
          .delete()
          .eq('id', orig.id);
        if (error) throw error;
      } else {
        const curr = currentMap.get(orig.id);
        if (curr.quantity !== orig.quantity || curr.warehouse_id !== orig.warehouse_id) {
          const { error } = await supabase
            .from('order_items')
            .update({ 
              quantity: curr.quantity,
              warehouse_id: curr.warehouse_id || defaultWarehouseId
            })
            .eq('id', orig.id);
          if (error) throw error;
        }
      }
    }

    // 2. Procesar inserciones de nuevos ítems
    for (const curr of window.tempEditOrderItems) {
      if (!curr.id) {
        const { error } = await supabase
          .from('order_items')
          .insert({
            order_id: orderId,
            product_id: curr.product_id,
            warehouse_id: curr.warehouse_id || defaultWarehouseId,
            quantity: curr.quantity
          });
        if (error) throw error;
      }
    }

    // 3. Ajuste de stock para pedidos despachados (solo admin)
    let appliedStockOpsCount = 0;
    if (isAdmin && isDispatched && adjustDispatchedStock && dispatchedDiffs.operations.length > 0) {
      const extNum = String(orderData.external_order_number || '').trim();
      const refDocOfficial = `Pedido ${extNum || orderId}`;

      const adjustPhysicalStockDelta = async (productId, warehouseId, deltaQty) => {
        if (!productId || !warehouseId || !deltaQty) return;
        const { data: invRec } = await supabase
          .from('inventory')
          .select('id, quantity')
          .eq('product_id', productId)
          .eq('warehouse_id', warehouseId)
          .maybeSingle();

        if (invRec) {
          const updatedQty = Math.max(0, (Number(invRec.quantity) || 0) + deltaQty);
          const { error: updInvErr } = await supabase
            .from('inventory')
            .update({ quantity: updatedQty })
            .eq('id', invRec.id);
          if (updInvErr) throw updInvErr;
        } else {
          const initialQty = Math.max(0, deltaQty);
          const { error: insInvErr } = await supabase
            .from('inventory')
            .insert([{
              product_id: productId,
              warehouse_id: warehouseId,
              quantity: initialQty,
              committed_quantity: 0,
              reserved_quantity: 0
            }]);
          if (insInvErr) throw insInvErr;
        }
      };

      const findOrderOutMovement = async (productId) => {
        const { data: byOrderId } = await supabase
          .from('movements')
          .select('id, quantity, warehouse_id, reference_doc, order_id')
          .eq('order_id', orderId)
          .eq('product_id', productId)
          .eq('type', 'out')
          .limit(1)
          .maybeSingle();

        if (byOrderId) return byOrderId;

        if (extNum) {
          const { data: byRef } = await supabase
            .from('movements')
            .select('id, quantity, warehouse_id, reference_doc, order_id')
            .is('order_id', null)
            .eq('product_id', productId)
            .eq('type', 'out')
            .or(`reference_doc.eq.Pedido ${extNum},reference_doc.eq.Pedido #${extNum},reference_doc.eq.Pedido ${orderId}`)
            .limit(1)
            .maybeSingle();

          if (byRef) return byRef;
        }
        return null;
      };

      const upsertOrderOutMovement = async (productId, warehouseId, newQuantity) => {
        const existingMov = await findOrderOutMovement(productId);
        if (existingMov) {
          const { error: updMovErr } = await supabase
            .from('movements')
            .update({
              quantity: newQuantity,
              warehouse_id: warehouseId,
              order_id: orderId
            })
            .eq('id', existingMov.id);
          if (updMovErr) throw updMovErr;
        } else {
          const { error: insMovErr } = await supabase
            .from('movements')
            .insert([{
              product_id: productId,
              warehouse_id: warehouseId,
              type: 'out',
              quantity: newQuantity,
              date: new Date().toISOString(),
              reference_doc: refDocOfficial,
              order_id: orderId
            }]);
          if (insMovErr) throw insMovErr;
        }
      };

      const deleteOrderOutMovement = async (productId) => {
        const existingMov = await findOrderOutMovement(productId);
        if (existingMov) {
          const { error: delMovErr } = await supabase
            .from('movements')
            .delete()
            .eq('id', existingMov.id);
          if (delMovErr) throw delMovErr;
        }
      };

      for (const op of dispatchedDiffs.operations) {
        if (op.type === 'removed') {
          await adjustPhysicalStockDelta(op.product_id, op.old_warehouse_id || defaultWarehouseId, +op.old_qty);
          await deleteOrderOutMovement(op.product_id);
          changesList.push(op.audit_text);
          appliedStockOpsCount++;
        } else if (op.type === 'added') {
          const effWh = op.new_warehouse_id || defaultWarehouseId;
          await adjustPhysicalStockDelta(op.product_id, effWh, -op.new_qty);
          await upsertOrderOutMovement(op.product_id, effWh, op.new_qty);
          changesList.push(op.audit_text);
          appliedStockOpsCount++;
        } else if (op.type === 'warehouse_changed') {
          const oldWh = op.old_warehouse_id || defaultWarehouseId;
          const newWh = op.new_warehouse_id || defaultWarehouseId;
          await adjustPhysicalStockDelta(op.product_id, oldWh, +op.old_qty);
          await adjustPhysicalStockDelta(op.product_id, newWh, -op.new_qty);
          await upsertOrderOutMovement(op.product_id, newWh, op.new_qty);
          changesList.push(op.audit_text);
          appliedStockOpsCount++;
        } else if (op.type === 'qty_increased') {
          const effWh = op.new_warehouse_id || defaultWarehouseId;
          await adjustPhysicalStockDelta(op.product_id, effWh, -op.diff_qty);
          await upsertOrderOutMovement(op.product_id, effWh, op.new_qty);
          changesList.push(op.audit_text);
          appliedStockOpsCount++;
        } else if (op.type === 'qty_decreased') {
          const effWh = op.new_warehouse_id || defaultWarehouseId;
          await adjustPhysicalStockDelta(op.product_id, effWh, +op.returned_qty);
          await upsertOrderOutMovement(op.product_id, effWh, op.new_qty);
          changesList.push(op.audit_text);
          appliedStockOpsCount++;
        }
      }
    } else if (isAdmin && isDispatched && !adjustDispatchedStock) {
      changesList.push('[Inventario/Kardex] Edición realizada en modo solo pedido (sin afectar stock físico ni Kardex)');
    }

    const totalCantidad = window.tempEditOrderItems.reduce((sum, item) => sum + item.quantity, 0);
    const orderSkus = window.tempEditOrderItems.map(item => item.sku).join(', ');
    const orderItemsNames = window.tempEditOrderItems.map(item => item.name).join(', ');
    const totalValue = window.tempEditOrderItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);

    const targetOrder = (window.loadedOrders || window.clientLoadedOrders || []).find(o => o.id === orderId);

    const rawKeys = [
      'raw_shopify_data', 'raw_woocommerce_data', 'raw_falabella_data',
      'raw_paris_data', 'raw_ripley_data', 'raw_jumpseller_data',
      'raw_tiendanube_data', 'raw_meli_data', 'raw_walmart_data'
    ];

    const updatePayload = {
      cantidad: totalCantidad,
      sku: orderSkus,
      item: orderItemsNames,
      total_value: totalValue
    };

    let updatedRawDataObj = null;
    let foundRawKey = null;

    const newRawLineItems = window.tempEditOrderItems.map((item, idx) => ({
      id: item.shopify_line_item_id || (16800000000000 + idx),
      sku: item.sku,
      title: item.name,
      name: item.name,
      quantity: item.quantity,
      current_quantity: item.quantity,
      price: String(item.price || 0)
    }));

    const deletedSkusList = [];
    for (const orig of window.originalEditOrderItems) {
      if (!currentMap.has(orig.id)) {
        if (orig.sku) deletedSkusList.push(orig.sku.trim());
      }
    }

    const addedSkusList = [];
    for (const curr of window.tempEditOrderItems) {
      if (!curr.id && curr.sku) {
        addedSkusList.push(curr.sku.trim());
      }
    }

    const modifiedQuantitiesMap = {};
    for (const curr of window.tempEditOrderItems) {
      if (curr.sku) {
        modifiedQuantitiesMap[curr.sku.trim()] = curr.quantity;
      }
    }

    const prevManualEdits = (targetOrder?.raw_shopify_data?.wms_manual_edits) || {};
    const mergedDeleted = Array.from(new Set([...(prevManualEdits.deleted_skus || []), ...deletedSkusList]))
      .filter(s => !addedSkusList.includes(s));
    const mergedAdded = Array.from(new Set([...(prevManualEdits.added_skus || []), ...addedSkusList]))
      .filter(s => !deletedSkusList.includes(s));
    const mergedModMap = { ...(prevManualEdits.modified_quantities || {}), ...modifiedQuantitiesMap };
    deletedSkusList.forEach(s => delete mergedModMap[s]);

    const manualEditsPayload = {
      deleted_skus: mergedDeleted,
      added_skus: mergedAdded,
      modified_quantities: mergedModMap,
      last_edited_at: new Date().toISOString(),
      last_comment: comment || ''
    };

    rawKeys.forEach(key => {
      if (targetOrder && targetOrder[key]) {
        foundRawKey = key;
        updatedRawDataObj = {
          ...targetOrder[key],
          line_items: newRawLineItems,
          wms_items_edited: true,
          wms_custom_edited: true,
          wms_manual_edits: manualEditsPayload
        };
        updatePayload[key] = updatedRawDataObj;
      }
    });

    if (!foundRawKey) {
      updatePayload.raw_shopify_data = {
        line_items: newRawLineItems,
        wms_items_edited: true,
        wms_custom_edited: true,
        wms_manual_edits: manualEditsPayload
      };
    }

    const { error: orderUpdErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId);

    if (orderUpdErr) throw orderUpdErr;

    const { error: auditErr } = await supabase
      .from('order_audit_logs')
      .insert({
        order_id: orderId,
        user_id: userId,
        user_email: userEmail,
        action: isDispatched && appliedStockOpsCount > 0 ? 'Modificación de Ítems (Con Ajuste de Stock y Kardex)' : 'Modificación de Ítems',
        details: {
          comment: comment,
          adjust_dispatched_stock: !!(isDispatched && adjustDispatchedStock),
          changes: changesList
        }
      });

    if (auditErr) {
      console.warn('[saveEditOrderItems] Auditoría con aviso:', auditErr.message);
    }

    const order = targetOrder || (window.loadedOrders && window.loadedOrders.find(o => o.id === orderId)) || (window.clientLoadedOrders && window.clientLoadedOrders.find(o => o.id === orderId));
    if (order) {
      order.cantidad = totalCantidad;
      order.sku = orderSkus;
      order.item = orderItemsNames;
      order.total_value = totalValue;
      if (foundRawKey && updatedRawDataObj) {
        order[foundRawKey] = updatedRawDataObj;
      } else {
        order.raw_shopify_data = updatePayload.raw_shopify_data;
      }

      const { data: reloadedItems } = await supabase
        .from('order_items')
        .select('*, warehouses (name), products(id, sku, name, price, is_virtual, image_url, options, barcode, barcode_wms, send_barcode_to_picker, send_barcode_wms_to_picker, picking_match_strict, alias, send_alias_to_picker, color, talla, variable_1, variable_2)')
        .eq('order_id', orderId);
      
      if (reloadedItems) {
        order.order_items = reloadedItems;
      }

      if (window.editOrderCommerceCatalogCache && order.comercio) {
        delete window.editOrderCommerceCatalogCache[order.comercio];
      }

      if (appliedStockOpsCount > 0) {
        if (typeof window.resetWmsInventoryMap === 'function') {
          window.resetWmsInventoryMap();
        } else {
          window.loadedOrdersInventoryMap = {};
        }
        if (typeof window.fetchInventoryForOrders === 'function' && window.loadedOrders) {
          await window.fetchInventoryForOrders(window.loadedOrders, true);
        }
      }

      if (order.estado_wms === 'En preparación' && typeof window.propagateOrderUpdateToPicker === 'function') {
        await window.propagateOrderUpdateToPicker(order);
      }
    }

    if (isDispatched && appliedStockOpsCount > 0) {
      Swal.fire({
        icon: 'success',
        title: '¡Pedido, Inventario y Kardex Actualizados!',
        html: `
          <div style="text-align: left; font-size: 0.88rem; line-height: 1.45;">
            <p style="margin-bottom: 0.5rem;">Se actualizaron los ítems del pedido <strong>#${(window.escapeHtml || (s => s))(orderNumDisplay)}</strong> y se aplicaron <strong>${appliedStockOpsCount} ajuste(s)</strong> en el Inventario Físico y en el Kardex:</p>
            <ul style="margin: 0 0 0 1.15rem; padding: 0; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.25rem;">
              ${dispatchedDiffs.operations.map(op => `<li>${op.stock_summary_html}</li>`).join('')}
            </ul>
          </div>
        `,
        confirmButtonColor: '#059669'
      });
    } else {
      Swal.fire('¡Guardado!', 'Los ítems del pedido han sido actualizados con éxito.', 'success');
    }
    
    // Refresco de vistas en admin y clientes
    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
    }
    if (typeof window.renderOrders === 'function') {
      window.renderOrders();
    }
    if (typeof window.loadOrdersData === 'function') {
      window.loadOrdersData();
    }
    if (typeof window.loadOrderAuditLogs === 'function') {
      window.loadOrderAuditLogs(orderId);
    }
    if (typeof window.renderSingleOrderPage === 'function' && window._activeSingleOrderPageId === orderId) {
      window.renderSingleOrderPage(orderId);
    }

  } catch (err) {
    console.error("Error saving edited order items:", err);
    Swal.fire('Error', 'No se pudieron guardar los cambios: ' + err.message, 'error');
  }
};
