/**
 * WMS STOCKA - Módulo de Separación de Pedidos y Envíos Parciales (Split Orders)
 * Permite dividir un pedido con quiebre de stock o requerimiento logístico en:
 * 1. Orden Principal: Despacha inmediatamente los productos disponibles en bodega.
 * 2. Orden Derivada / Hija: Registra los faltantes con correlativo seguro (ej: #6560-1)
 *    heredando destinatario, dirección y trazabilidad completa.
 */

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

function getSupabaseClient() {
  if (window.supabaseClient) return window.supabaseClient;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return null;
}

// Formateador de moneda en pesos chilenos
function formatCLP(value) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(value || 0);
}

// Estado temporal del modal de división
window.currentSplitState = null;

/**
 * Determina si una orden califica para ser dividida
 */
window.canSplitOrder = function(order) {
  if (!order) return false;
  
  const statusLower = (order.status || '').toLowerCase().trim();
  const estadoWms = order.estado_wms || '';
  
  // No permitir dividir órdenes en estados terminales
  const terminalStatuses = ['despachado', 'entregado', 'retirado', 'cancelado', 'archivado'];
  if (terminalStatuses.includes(statusLower) || ['Despachado', 'Cancelado', 'Archivado'].includes(estadoWms)) {
    return false;
  }
  
  // Si ya tiene todo su stock descontado formalmente, no se divide
  if (order.stock_descontado) return false;
  
  // Debe contener al menos 2 unidades en total o 2 items distintos
  let totalUnits = 0;
  if (order.order_items && order.order_items.length > 0) {
    totalUnits = order.order_items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  } else if (order.cantidad !== null && order.cantidad !== undefined) {
    totalUnits = Number(order.cantidad) || 0;
  }
  
  return totalUnits >= 2;
};

/**
 * Genera el badge HTML para mostrar en la tabla de pedidos
 */
window.getSplitBadgeHtml = function(order) {
  if (!order) return '';
  
  const loadedOrders = window.loadedOrders || [];
  const parentId = order.parent_order_id || order.raw_shopify_data?._parent_order_id;
  const isSplitChild = !!parentId || (order.is_split && (order.split_sequence > 1 || (order.external_order_number && /-\d+$/.test(order.external_order_number))));
  
  if (isSplitChild) {
    let parentFolio = 'Principal';
    if (parentId) {
      const parentOrder = loadedOrders.find(o => o.id === parentId);
      if (parentOrder && parentOrder.external_order_number) {
        parentFolio = parentOrder.external_order_number;
      }
    }
    const safeParentId = (parentId || '').replace(/'/g, "\\'");
    return `<span class="badge" onclick="event.stopPropagation(); window.highlightAndScrollToOrder('${safeParentId}')" style="background-color: rgba(245, 158, 11, 0.12); color: #b45309; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; text-transform: none; letter-spacing: 0.2px;" title="Envío parcial derivado por faltantes. Clic para ver orden original ${parentFolio}"><i class="ri-git-branch-line"></i> Envío Parcial (Faltante de ${parentFolio})</span>`;
  }
  
  const isSplitParent = order.is_split || loadedOrders.some(o => (o.parent_order_id === order.id || o.raw_shopify_data?._parent_order_id === order.id));
  if (isSplitParent) {
    const children = loadedOrders.filter(o => o.parent_order_id === order.id || o.raw_shopify_data?._parent_order_id === order.id);
    const countText = children.length > 0 ? `1/${children.length + 1}` : 'Principal';
    return `<span class="badge" style="background-color: rgba(124, 58, 237, 0.12); color: #7c3aed; border: 1px solid rgba(124, 58, 237, 0.3); font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem; text-transform: none; letter-spacing: 0.2px;" title="Este pedido fue dividido para realizar despachos parciales."><i class="ri-scissors-2-line"></i> Envío Parcial (${countText})</span>`;
  }
  
  return '';
};

/**
 * Resalta y navega visualmente a un pedido
 */
window.highlightAndScrollToOrder = function(orderId) {
  if (!orderId) return;
  const row = document.getElementById(`row-${orderId}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const originalBg = row.style.backgroundColor;
    row.style.backgroundColor = 'rgba(124, 58, 237, 0.18)';
    row.style.transition = 'background-color 0.4s ease';
    setTimeout(() => {
      row.style.backgroundColor = originalBg;
    }, 2200);
  } else {
    // Si no está en la página actual, buscarlo en la lista y alertar
    const loadedOrders = window.loadedOrders || [];
    const matched = loadedOrders.find(o => o.id === orderId);
    if (matched) {
      const searchInput = document.getElementById('search-orders');
      if (searchInput) {
        searchInput.value = matched.external_order_number || matched.id;
        if (typeof window.applyWmsFiltersAndRender === 'function') {
          window.applyWmsFiltersAndRender();
        }
      }
    } else {
      Swal.fire({
        icon: 'info',
        title: 'Pedido no encontrado en vista actual',
        text: 'El pedido de referencia no está cargado en los filtros actuales.',
        confirmButtonColor: '#7117eb'
      });
    }
  }
};

/**
 * Genera el número seguro para la orden hija sin violar unique_orders_comercio_clean_number
 */
window.generateNextSplitOrderNumber = async function(parentOrderNumber, comercio) {
  const rawParent = String(parentOrderNumber || '').trim();
  const match = rawParent.match(/^(.*?)-(\d+)$/);
  const basePrefix = match ? match[1] : rawParent;

  const client = getSupabaseClient();
  let existingOrders = [];
  if (client) {
    try {
      const { data } = await client
        .from('orders')
        .select('external_order_number')
        .eq('comercio', comercio)
        .ilike('external_order_number', basePrefix + '%');
      if (data) existingOrders = data;
    } catch (e) {
      console.warn('Aviso consultando pedidos existentes para split:', e);
    }
  }

  // Complementar con órdenes cargadas en memoria local
  (window.loadedOrders || []).forEach(o => {
    if (o.comercio === comercio && o.external_order_number && o.external_order_number.startsWith(basePrefix)) {
      if (!existingOrders.some(x => x.external_order_number === o.external_order_number)) {
        existingOrders.push({ external_order_number: o.external_order_number });
      }
    }
  });

  const existingCleanNumbers = new Set();
  const existingExactNumbers = new Set();

  existingOrders.forEach(o => {
    const ext = String(o.external_order_number || '').trim();
    if (ext) existingExactNumbers.add(ext.toUpperCase());
    const clean = ext.replace(/[^0-9]/g, '');
    if (clean) existingCleanNumbers.add(clean);
  });

  let seq = 1;
  while (seq <= 99) {
    const candidate = `${basePrefix}-${seq}`;
    const candidateClean = candidate.replace(/[^0-9]/g, '');

    // La clave debe ser única tanto exacta como en números limpios
    if (!existingExactNumbers.has(candidate.toUpperCase()) && (!candidateClean || !existingCleanNumbers.has(candidateClean))) {
      return { candidateNumber: candidate, sequence: seq };
    }
    seq++;
  }

  const fallback = `${basePrefix}-P${Math.floor(10 + Math.random() * 90)}`;
  return { candidateNumber: fallback, sequence: seq };
};

/**
 * Abre el modal interactivo de división de pedidos
 */
window.openSplitOrderModal = async function(orderId) {
  const client = getSupabaseClient();
  if (!client) {
    Swal.fire('Error', 'No hay conexión con la base de datos.', 'error');
    return;
  }

  Swal.fire({
    title: 'Cargando inventario...',
    text: 'Consultando stock disponible para división de pedido',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  try {
    // 1. Obtener la orden completa con sus items y bodegas
    let targetOrder = (window.loadedOrders || []).find(o => o.id === orderId);
    
    const { data: freshOrder, error: orderErr } = await client
      .from('orders')
      .select('*, order_items(*, products(*), warehouses(*))')
      .eq('id', orderId)
      .single();

    if (orderErr) throw orderErr;
    if (freshOrder) targetOrder = freshOrder;

    if (!targetOrder || !targetOrder.order_items || targetOrder.order_items.length === 0) {
      throw new Error('El pedido no tiene artículos asociados.');
    }

    // 2. Consultar inventario real de los productos involucrados
    const productIds = targetOrder.order_items.map(oi => oi.product_id).filter(Boolean);
    const { data: invList, error: invErr } = await client
      .from('inventory')
      .select('product_id, warehouse_id, quantity, committed_quantity')
      .in('product_id', productIds);

    if (invErr) console.warn('Aviso cargando inventario:', invErr);

    const invMap = {};
    (invList || []).forEach(inv => {
      const k = `${inv.product_id}_${inv.warehouse_id || ''}`;
      // El disponible neto más el stock que este mismo pedido ya tenía comprometido
      const netDisp = (inv.quantity || 0) - (inv.committed_quantity || 0);
      invMap[k] = netDisp;
    });

    // 3. Generar número de pedido candidato para la orden hija
    const candidateResult = await window.generateNextSplitOrderNumber(
      targetOrder.external_order_number || targetOrder.id,
      targetOrder.comercio
    );

    // 4. Armar estado de items para la distribución
    const hasAnyDeficit = targetOrder.order_items.some(oi => {
      const pId = oi.product_id;
      const wId = oi.warehouse_id || '';
      const k = `${pId}_${wId}`;
      const netAvailable = invMap[k] !== undefined ? invMap[k] : 0;
      const effectiveAvailable = Math.max(0, netAvailable + (oi.quantity || 0));
      return effectiveAvailable < (oi.quantity || 0);
    });

    const itemsState = targetOrder.order_items.map(oi => {
      const pId = oi.product_id;
      const wId = oi.warehouse_id || '';
      const k = `${pId}_${wId}`;
      const netAvailable = invMap[k] !== undefined ? invMap[k] : 0;
      // Disponible efectivo para esta orden (neto + lo que ya ocupa esta orden)
      const effectiveAvailable = Math.max(0, netAvailable + (oi.quantity || 0));

      const unitPrice = Number(oi.products?.price) || (targetOrder.cantidad > 0 ? (Number(targetOrder.total_value) / Number(targetOrder.cantidad)) : 0) || 0;
      const imageUrl = oi.products?.image_url || oi.image_url || null;

      // Sugerencia inicial inteligente: si hay stock disponible, despachar ahora; de lo contrario mover a faltante
      let initialSendNow = Math.min(oi.quantity, effectiveAvailable);
      if (initialSendNow < 0) initialSendNow = 0;

      return {
        id: oi.id,
        product_id: oi.product_id,
        warehouse_id: oi.warehouse_id,
        warehouse_name: oi.warehouses?.name || 'Bodega Central',
        sku: oi.products?.sku || targetOrder.sku || 'Sin SKU',
        name: oi.products?.name || targetOrder.item || 'Sin Nombre',
        image_url: imageUrl,
        price: unitPrice,
        totalQuantity: oi.quantity,
        availableStock: effectiveAvailable,
        sendNow: initialSendNow,
        tag: oi.tag,
        is_gift: oi.is_gift,
        campaign_id: oi.campaign_id
      };
    });

    // Guardar estado global con copia de respaldo para reiniciar
    window.currentSplitState = {
      parentOrder: targetOrder,
      items: itemsState,
      initialItems: JSON.parse(JSON.stringify(itemsState)),
      hasAnyDeficit,
      nextSequence: candidateResult.sequence
    };

    // 5. Poblar el Resumen del Pedido Origen
    const headerCard = document.getElementById('split-order-header-card');
    if (headerCard) {
      const escape = window.escapeHtml || (s => String(s || ''));
      const totalUnits = targetOrder.order_items.reduce((s, i) => s + (i.quantity || 0), 0);
      headerCard.innerHTML = `
        <div>
          <span style="display:block; font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Pedido Original</span>
          <strong style="font-size: 0.95rem; font-family: monospace; color: var(--color-primary);">${escape(targetOrder.external_order_number || targetOrder.id)}</strong>
        </div>
        <div>
          <span style="display:block; font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Comercio</span>
          <strong style="color: var(--color-text-main);">${escape(targetOrder.comercio)}</strong>
        </div>
        <div>
          <span style="display:block; font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Destinatario</span>
          <strong style="color: var(--color-text-main);">${escape(targetOrder.customer_name || 'No registrado')}</strong>
        </div>
        <div>
          <span style="display:block; font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Destino / Comuna</span>
          <strong style="color: var(--color-text-main);">${escape(targetOrder.shipping_city || 'Sin ciudad')}</strong>
        </div>
        <div>
          <span style="display:block; font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; text-transform: uppercase;">Total Artículos</span>
          <strong style="color: var(--color-text-main);">${targetOrder.order_items.length} productos (${totalUnits} un.)</strong>
        </div>
      `;
    }

    // 6. Configurar campos del hijo
    const childNumInput = document.getElementById('split-child-order-number');
    if (childNumInput) {
      childNumInput.value = candidateResult.candidateNumber;
      childNumInput.oninput = () => window.validateSplitState();
    }

    const childReasonInput = document.getElementById('split-order-reason');
    if (childReasonInput) {
      childReasonInput.value = hasAnyDeficit 
        ? 'Quiebre de stock parcial (envío de unidades disponibles)'
        : 'Separación logística de despacho (envío parcial)';
    }

    // 7. Renderizar tabla de items
    window.renderSplitItemsTable();

    Swal.close();

    // 8. Abrir modal
    const modal = document.getElementById('modal-split-order');
    if (modal) modal.classList.add('active');

  } catch (err) {
    console.error('Error al abrir modal de split:', err);
    Swal.fire('Error', 'No se pudo cargar la información del pedido: ' + err.message, 'error');
  }
};

/**
 * Cierra el modal de división
 */
window.closeSplitOrderModal = function() {
  const modal = document.getElementById('modal-split-order');
  if (modal) modal.classList.remove('active');
  window.currentSplitState = null;
};

/**
 * Renderiza la tabla de productos a distribuir
 */
window.renderSplitItemsTable = function() {
  if (!window.currentSplitState || !window.currentSplitState.items) return;
  const tbody = document.getElementById('split-order-items-tbody');
  if (!tbody) return;

  const escape = window.escapeHtml || (s => String(s || ''));
  let html = '';

  window.currentSplitState.items.forEach(item => {
    const missing = Math.max(0, item.totalQuantity - item.sendNow);
    const hasEnough = item.availableStock >= item.totalQuantity;
    const isOut = item.availableStock <= 0;
    
    let stockBadgeColor = '#10b981';
    let stockBadgeBg = 'rgba(16, 185, 129, 0.1)';
    let stockBadgeText = `${item.availableStock} disp.`;

    if (isOut) {
      stockBadgeColor = '#ef4444';
      stockBadgeBg = 'rgba(239, 68, 68, 0.1)';
      stockBadgeText = 'Sin stock (0)';
    } else if (!hasEnough) {
      stockBadgeColor = '#f59e0b';
      stockBadgeBg = 'rgba(245, 158, 11, 0.1)';
      stockBadgeText = `Parcial (${item.availableStock}/${item.totalQuantity})`;
    }

    const sendValFormatted = item.price > 0 ? formatCLP(item.sendNow * item.price) : '';
    const missingValFormatted = item.price > 0 ? formatCLP(missing * item.price) : '';

    html += `
      <tr style="border-bottom: 1px solid var(--color-border); transition: background-color 0.15s;">
        <!-- 1. Producto con Imagen y Detalles -->
        <td style="padding: 0.75rem 1rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            ${item.image_url 
              ? `<img src="${escape(item.image_url)}" alt="${escape(item.name)}" style="width: 44px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid var(--color-border); flex-shrink: 0;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                 <div style="width: 44px; height: 44px; border-radius: 6px; background: var(--color-bg); display: none; align-items: center; justify-content: center; color: var(--color-text-muted); font-size: 1.2rem; border: 1px solid var(--color-border); flex-shrink: 0;"><i class="ri-image-line"></i></div>` 
              : `<div style="width: 44px; height: 44px; border-radius: 6px; background: var(--color-bg); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); font-size: 1.2rem; border: 1px solid var(--color-border); flex-shrink: 0;"><i class="ri-image-line"></i></div>`}
            <div style="min-width: 0;">
              <div style="font-family: monospace; font-weight: 700; color: var(--color-primary); font-size: 0.85rem;">${escape(item.sku)}</div>
              <div style="font-weight: 600; color: var(--color-text-main); font-size: 0.825rem; line-height: 1.3; margin-top: 0.15rem; word-break: break-word;">${escape(item.name)}</div>
              <div style="display: flex; align-items: center; gap: 0.65rem; margin-top: 0.25rem;">
                <small style="color: var(--color-text-muted); font-size: 0.725rem;"><i class="ri-store-2-line"></i> ${escape(item.warehouse_name)}</small>
                ${item.price > 0 ? `<small style="color: var(--color-text-muted); font-size: 0.725rem;"><i class="ri-price-tag-3-line"></i> ${formatCLP(item.price)}/un.</small>` : ''}
              </div>
            </div>
          </div>
        </td>

        <!-- 2. Stock Disponible en Bodega -->
        <td style="padding: 0.75rem 0.5rem; text-align: center;">
          <span style="background: ${stockBadgeBg}; color: ${stockBadgeColor}; font-weight: 700; font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; white-space: nowrap;">
            ${stockBadgeText}
          </span>
        </td>

        <!-- 3. Total Pedido Original -->
        <td style="padding: 0.75rem 0.5rem; text-align: center; font-weight: 700; font-size: 0.95rem;">
          ${item.totalQuantity} <span style="font-size: 0.75rem; font-weight: normal; color: var(--color-text-muted);">un.</span>
        </td>

        <!-- 4. Cantidad para Envío 1 (Ahora) -->
        <td style="padding: 0.75rem 0.75rem; text-align: center; background: rgba(16, 185, 129, 0.04); border-left: 1px solid rgba(16, 185, 129, 0.15);">
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;">
            <input type="number" 
                   id="split-input-${item.id}"
                   min="0" 
                   max="${item.totalQuantity}" 
                   value="${item.sendNow}"
                   oninput="window.onSplitQtyChange('${item.id}', this.value)"
                   class="form-input" 
                   style="width: 68px; text-align: center; font-weight: 700; font-size: 0.9rem; padding: 0.35rem 0.25rem; border-color: #10b981; border-width: 1.5px; border-radius: 6px;">
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">un.</span>
          </div>
          ${item.price > 0 ? `<div id="split-val-send-${item.id}" style="font-size: 0.72rem; color: #065f46; margin-top: 0.2rem; font-weight: 600;">${sendValFormatted}</div>` : ''}
        </td>

        <!-- 5. Cantidad para Envío 2 (Faltante) -->
        <td style="padding: 0.75rem 0.75rem; text-align: center; background: rgba(245, 158, 11, 0.04); border-left: 1px solid rgba(245, 158, 11, 0.15);">
          <div>
            <span id="split-missing-${item.id}" style="font-weight: 800; font-size: 1.05rem; color: ${missing > 0 ? '#b45309' : 'var(--color-text-muted)'};">
              ${missing}
            </span>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);"> un.</span>
          </div>
          ${item.price > 0 ? `<div id="split-val-missing-${item.id}" style="font-size: 0.72rem; color: ${missing > 0 ? '#b45309' : 'var(--color-text-muted)'}; margin-top: 0.2rem; font-weight: 600;">${missingValFormatted}</div>` : ''}
        </td>

        <!-- 6. Acciones Rápidas por Fila -->
        <td style="padding: 0.75rem 0.5rem; text-align: center;">
          <div style="display: flex; gap: 0.3rem; justify-content: center;">
            <button type="button" 
                    onclick="window.setRowSplitQty('${item.id}', ${item.totalQuantity})" 
                    title="Despachar todas las unidades de este producto ahora (Envío 1)"
                    class="btn btn-xs" 
                    style="font-size: 0.72rem; font-weight: 600; padding: 0.25rem 0.5rem; border-radius: 4px; background: rgba(16, 185, 129, 0.12); color: #065f46; border: 1px solid rgba(16, 185, 129, 0.25); cursor: pointer; transition: all 0.15s;">
              Todo
            </button>
            <button type="button" 
                    onclick="window.setRowSplitQty('${item.id}', 0)" 
                    title="Mover todas las unidades de este producto al nuevo pedido de faltantes (Envío 2)"
                    class="btn btn-xs" 
                    style="font-size: 0.72rem; font-weight: 600; padding: 0.25rem 0.5rem; border-radius: 4px; background: rgba(245, 158, 11, 0.12); color: #b45309; border: 1px solid rgba(245, 158, 11, 0.25); cursor: pointer; transition: all 0.15s;">
              Faltante
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  window.validateSplitState();
};

/**
 * Permite cambiar con 1 clic la cantidad de una fila (ej: Todo o Faltante)
 */
window.setRowSplitQty = function(itemId, targetQty) {
  if (!window.currentSplitState) return;
  const item = window.currentSplitState.items.find(i => String(i.id) === String(itemId));
  if (!item) return;

  let val = parseInt(targetQty, 10);
  if (isNaN(val) || val < 0) val = 0;
  if (val > item.totalQuantity) val = item.totalQuantity;

  item.sendNow = val;

  const input = document.getElementById(`split-input-${itemId}`);
  if (input) input.value = val;

  const missingLabel = document.getElementById(`split-missing-${itemId}`);
  const missing = item.totalQuantity - val;
  if (missingLabel) {
    missingLabel.innerText = missing;
    missingLabel.style.color = missing > 0 ? '#b45309' : 'var(--color-text-muted)';
  }

  const valSend = document.getElementById(`split-val-send-${itemId}`);
  if (valSend && item.price > 0) valSend.innerText = formatCLP(val * item.price);

  const valMissing = document.getElementById(`split-val-missing-${itemId}`);
  if (valMissing && item.price > 0) {
    valMissing.innerText = formatCLP(missing * item.price);
    valMissing.style.color = missing > 0 ? '#b45309' : 'var(--color-text-muted)';
  }

  window.validateSplitState();
};

/**
 * Evento al cambiar manualmente la cantidad numérica de un producto
 */
window.onSplitQtyChange = function(itemId, valStr) {
  if (!window.currentSplitState) return;
  const item = window.currentSplitState.items.find(i => String(i.id) === String(itemId));
  if (!item) return;

  let val = parseInt(valStr, 10);
  if (isNaN(val) || val < 0) val = 0;
  if (val > item.totalQuantity) val = item.totalQuantity;

  item.sendNow = val;

  const missingLabel = document.getElementById(`split-missing-${itemId}`);
  const missing = item.totalQuantity - val;
  if (missingLabel) {
    missingLabel.innerText = missing;
    missingLabel.style.color = missing > 0 ? '#b45309' : 'var(--color-text-muted)';
  }

  const valSend = document.getElementById(`split-val-send-${itemId}`);
  if (valSend && item.price > 0) valSend.innerText = formatCLP(val * item.price);

  const valMissing = document.getElementById(`split-val-missing-${itemId}`);
  if (valMissing && item.price > 0) {
    valMissing.innerText = formatCLP(missing * item.price);
    valMissing.style.color = missing > 0 ? '#b45309' : 'var(--color-text-muted)';
  }

  window.validateSplitState();
};

/**
 * Reinicia la distribución a su estado inicial
 */
window.resetSplitDistribution = function() {
  if (!window.currentSplitState || !window.currentSplitState.initialItems) return;
  window.currentSplitState.items = JSON.parse(JSON.stringify(window.currentSplitState.initialItems));
  window.renderSplitItemsTable();
};

/**
 * Botón de asignación automática según stock disponible
 */
window.autoAssignSplitByStock = function() {
  if (!window.currentSplitState || !window.currentSplitState.items) return;

  window.currentSplitState.items.forEach(item => {
    // Si hay stock, enviar ahora lo que alcance; el resto a faltantes
    let sendNow = Math.max(0, Math.min(item.totalQuantity, item.availableStock));
    item.sendNow = sendNow;

    const input = document.getElementById(`split-input-${item.id}`);
    if (input) input.value = sendNow;

    const missingLabel = document.getElementById(`split-missing-${item.id}`);
    const missing = item.totalQuantity - sendNow;
    if (missingLabel) {
      missingLabel.innerText = missing;
      missingLabel.style.color = missing > 0 ? '#b45309' : 'var(--color-text-muted)';
    }

    const valSend = document.getElementById(`split-val-send-${item.id}`);
    if (valSend && item.price > 0) valSend.innerText = formatCLP(sendNow * item.price);

    const valMissing = document.getElementById(`split-val-missing-${item.id}`);
    if (valMissing && item.price > 0) {
      valMissing.innerText = formatCLP(missing * item.price);
      valMissing.style.color = missing > 0 ? '#b45309' : 'var(--color-text-muted)';
    }
  });

  window.validateSplitState();
};

/**
 * Valida la distribución actual y habilita/deshabilita el botón de confirmación
 */
window.validateSplitState = function() {
  if (!window.currentSplitState) return;

  const escape = window.escapeHtml || (s => String(s || ''));
  const totalSendNow = window.currentSplitState.items.reduce((s, i) => s + (i.sendNow || 0), 0);
  const totalMissing = window.currentSplitState.items.reduce((s, i) => s + (i.totalQuantity - (i.sendNow || 0)), 0);
  const totalUnits = window.currentSplitState.items.reduce((s, i) => s + (i.totalQuantity || 0), 0);

  const sumSendNowVal = window.currentSplitState.items.reduce((s, i) => s + ((i.sendNow || 0) * (i.price || 0)), 0);
  const sumMissingVal = window.currentSplitState.items.reduce((s, i) => s + ((i.totalQuantity - (i.sendNow || 0)) * (i.price || 0)), 0);
  const sumTotalVal = sumSendNowVal + sumMissingVal;

  // Actualizar tfoot con el balance
  const tfoot = document.getElementById('split-order-items-tfoot');
  if (tfoot) {
    tfoot.innerHTML = `
      <tr>
        <td colspan="3" style="padding: 0.85rem 1rem; text-align: right; color: var(--color-text-muted); font-size: 0.8rem; text-transform: uppercase;">
          Totales a despachar (${totalUnits} un. • ${formatCLP(sumTotalVal)}):
        </td>
        <td style="padding: 0.85rem 0.75rem; text-align: center; background: rgba(16, 185, 129, 0.08); border-left: 1px solid rgba(16, 185, 129, 0.2);">
          <div style="font-weight: 800; font-size: 0.95rem; color: #065f46;">${totalSendNow} un.</div>
          ${sumTotalVal > 0 ? `<div style="font-size: 0.75rem; color: #065f46; font-weight: 600;">${formatCLP(sumSendNowVal)}</div>` : ''}
        </td>
        <td style="padding: 0.85rem 0.75rem; text-align: center; background: rgba(245, 158, 11, 0.08); border-left: 1px solid rgba(245, 158, 11, 0.2);">
          <div style="font-weight: 800; font-size: 0.95rem; color: ${totalMissing > 0 ? '#b45309' : 'var(--color-text-muted)'};">${totalMissing} un.</div>
          ${sumTotalVal > 0 ? `<div style="font-size: 0.75rem; color: ${totalMissing > 0 ? '#b45309' : 'var(--color-text-muted)'}; font-weight: 600;">${formatCLP(sumMissingVal)}</div>` : ''}
        </td>
        <td style="padding: 0.85rem 0.5rem;"></td>
      </tr>
    `;
  }

  const alertBox = document.getElementById('split-order-validation-alert');
  const btnConfirm = document.getElementById('btn-confirm-split-order');
  if (!alertBox || !btnConfirm) return;

  alertBox.style.display = 'block';

  if (totalSendNow === 0) {
    alertBox.style.background = '#fee2e2';
    alertBox.style.color = '#991b1b';
    alertBox.style.border = '1px solid #f87171';
    alertBox.innerHTML = '<i class="ri-error-warning-line"></i> Debes despachar al menos 1 unidad en la orden principal. Si no deseas enviar nada ahora, mantén la orden en espera sin dividir.';
    btnConfirm.disabled = true;
    btnConfirm.style.opacity = '0.5';
    btnConfirm.style.cursor = 'not-allowed';
    return;
  }

  if (totalMissing === 0) {
    const allStockAvailable = !window.currentSplitState.hasAnyDeficit;
    alertBox.style.background = '#fef3c7';
    alertBox.style.color = '#92400e';
    alertBox.style.border = '1px solid #fde68a';
    if (allStockAvailable) {
      alertBox.innerHTML = '<i class="ri-information-line"></i> Todos los productos están asignados al Envío 1. Haz clic en el botón <strong>[Faltante]</strong> en la columna "Acción Rápida" o ajusta manualmente las unidades del producto que deseas transferir al nuevo envío derivado.';
    } else {
      alertBox.innerHTML = '<i class="ri-alert-line"></i> No has seleccionado ninguna unidad para mover a faltantes. Para dividir la orden, al menos 1 unidad debe trasladarse al nuevo envío derivado.';
    }
    btnConfirm.disabled = true;
    btnConfirm.style.opacity = '0.5';
    btnConfirm.style.cursor = 'not-allowed';
    return;
  }

  // Todo correcto
  const childOrderNumberInput = document.getElementById('split-child-order-number');
  const childFolio = (childOrderNumberInput?.value || '').trim() || 'Orden Faltante';

  alertBox.style.background = '#ecfdf5';
  alertBox.style.color = '#065f46';
  alertBox.style.border = '1px solid #a7f3d0';
  alertBox.innerHTML = `<i class="ri-checkbox-circle-line"></i> <strong>Distribución válida:</strong> Se despacharán <strong>${totalSendNow} un.</strong> (${formatCLP(sumSendNowVal)}) en el envío principal y se generará la orden <strong>${escape(childFolio)}</strong> con <strong>${totalMissing} un.</strong> (${formatCLP(sumMissingVal)}) de faltantes.`;
  btnConfirm.disabled = false;
  btnConfirm.style.opacity = '1';
  btnConfirm.style.cursor = 'pointer';
};

/**
 * Ejecuta la transacción de división de pedido en Supabase
 */
window.confirmExecuteOrderSplit = async function() {
  if (!window.currentSplitState) return;
  const { parentOrder, items, nextSequence } = window.currentSplitState;

  const childOrderNumberInput = document.getElementById('split-child-order-number');
  const childFolio = (childOrderNumberInput?.value || '').trim();
  if (!childFolio) {
    Swal.fire('Atención', 'Debes ingresar un número de pedido para la orden derivada.', 'warning');
    return;
  }

  const childStatusSelect = document.getElementById('split-child-initial-status');
  const childInitialStatus = childStatusSelect?.value || 'en espera';

  const reasonInput = document.getElementById('split-order-reason');
  const splitReason = (reasonInput?.value || '').trim() || 'Quiebre de stock parcial';

  const totalSendNow = items.reduce((s, i) => s + (i.sendNow || 0), 0);
  const totalMissing = items.reduce((s, i) => s + (i.totalQuantity - (i.sendNow || 0)), 0);

  if (totalSendNow === 0 || totalMissing === 0) {
    window.validateSplitState();
    return;
  }

  const parentFolio = parentOrder.external_order_number || parentOrder.id;

  const confirmRes = await Swal.fire({
    title: '¿Confirmar División de Pedido?',
    html: `
      <div style="text-align: left; font-size: 0.9rem; line-height: 1.5; color: var(--color-text-main);">
        <p style="margin-bottom: 0.75rem;">Se creará una nueva orden y se actualizará la orden original:</p>
        <div style="background: rgba(16, 185, 129, 0.08); border-left: 4px solid #10b981; padding: 0.65rem 0.85rem; border-radius: 4px; margin-bottom: 0.5rem;">
          <strong>1. Orden Principal (${parentFolio}):</strong><br>
          Conservará <strong>${totalSendNow} unidades</strong> listas para procesar y despachar ahora.
        </div>
        <div style="background: rgba(245, 158, 11, 0.08); border-left: 4px solid #f59e0b; padding: 0.65rem 0.85rem; border-radius: 4px;">
          <strong>2. Nueva Orden Derivada (${childFolio}):</strong><br>
          Contendrá <strong>${totalMissing} unidades</strong> faltantes en estado <em>${childInitialStatus}</em> con los mismos datos del cliente.
        </div>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#7c3aed',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'Sí, Dividir Pedido',
    cancelButtonText: 'Cancelar'
  });

  if (!confirmRes.isConfirmed) return;

  const btnConfirm = document.getElementById('btn-confirm-split-order');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Dividiendo pedido...';
  }

  const client = getSupabaseClient();
  if (!client) {
    Swal.fire('Error', 'No hay cliente de base de datos inicializado.', 'error');
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = '<i class="ri-check-double-line"></i> Confirmar y Dividir Pedido';
    }
    return;
  }

  try {
    const { data: { session } } = await client.auth.getSession();
    const userEmail = session?.user?.email || 'admin@stocka.cl';
    const userId = session?.user?.id || null;

    // A. Actualizar o eliminar items de la orden padre
    const parentChangesList = [];
    const childLineItemsRaw = [];
    const parentRemainingItems = [];
    const movedItemsForChild = [];

    for (const item of items) {
      const remainingQty = item.sendNow;
      const movedQty = item.totalQuantity - remainingQty;

      if (remainingQty === 0) {
        // Se transfirió completamente al hijo: eliminar de la orden padre
        const { error: delErr } = await client
          .from('order_items')
          .delete()
          .eq('id', item.id);
        if (delErr) throw delErr;
        parentChangesList.push(`Transferido SKU ${item.sku} (${item.totalQuantity} un.) al pedido derivado ${childFolio}`);
      } else if (remainingQty < item.totalQuantity) {
        // Se reduce la cantidad en el padre
        const { error: updErr } = await client
          .from('order_items')
          .update({ quantity: remainingQty })
          .eq('id', item.id);
        if (updErr) throw updErr;
        parentChangesList.push(`Reducido SKU ${item.sku} de ${item.totalQuantity} a ${remainingQty} un. (se transfirieron ${movedQty} un. a ${childFolio})`);
        parentRemainingItems.push({ ...item, quantity: remainingQty });
      } else {
        parentRemainingItems.push({ ...item, quantity: item.totalQuantity });
      }

      if (movedQty > 0) {
        movedItemsForChild.push({
          product_id: item.product_id,
          warehouse_id: item.warehouse_id,
          quantity: movedQty,
          tag: item.tag,
          is_gift: item.is_gift,
          campaign_id: item.campaign_id,
          price: item.price,
          sku: item.sku,
          name: item.name
        });

        childLineItemsRaw.push({
          sku: item.sku,
          title: item.name,
          name: item.name,
          quantity: movedQty,
          current_quantity: movedQty,
          price: String(item.price || 0)
        });
      }
    }

    // B. Recalcular y actualizar totales en la orden padre
    const newParentTotalValue = parentRemainingItems.reduce((s, i) => s + (i.quantity * i.price), 0);
    const newParentSkus = parentRemainingItems.map(i => i.sku).join(', ');
    const newParentItemsName = parentRemainingItems.map(i => i.name).join(', ');

    const parentUpdatePayload = {
      cantidad: totalSendNow,
      total_value: newParentTotalValue,
      sku: newParentSkus,
      item: newParentItemsName,
      is_split: true
    };

    // Intentar actualizar con parent_order_id / is_split
    const { error: parentUpdErr } = await client
      .from('orders')
      .update(parentUpdatePayload)
      .eq('id', parentOrder.id);

    if (parentUpdErr) {
      // Fallback si la columna is_split no existe aún
      if (parentUpdErr.message && parentUpdErr.message.includes('is_split')) {
        delete parentUpdatePayload.is_split;
        await client.from('orders').update(parentUpdatePayload).eq('id', parentOrder.id);
      } else {
        throw parentUpdErr;
      }
    }

    // C. Crear la orden hija / derivada
    const childTotalValue = movedItemsForChild.reduce((s, i) => s + (i.quantity * i.price), 0);
    const childSkus = movedItemsForChild.map(i => i.sku).join(', ');
    const childItemsName = movedItemsForChild.map(i => i.name).join(', ');

    // Clonar metadatos preservando raw data para trazabilidad
    const clonedRawShopify = parentOrder.raw_shopify_data ? {
      ...parentOrder.raw_shopify_data,
      _is_split_child: true,
      _parent_order_id: parentOrder.id,
      _parent_order_number: parentFolio,
      line_items: childLineItemsRaw
    } : {
      _is_split_child: true,
      _parent_order_id: parentOrder.id,
      _parent_order_number: parentFolio,
      line_items: childLineItemsRaw
    };

    const childOrderPayload = {
      merchant_id: parentOrder.merchant_id,
      comercio: parentOrder.comercio,
      external_order_number: childFolio,
      origen: parentOrder.origen || parentOrder.external_platform || 'Manual',
      external_platform: parentOrder.external_platform || parentOrder.origen || 'Manual',
      payment_status: parentOrder.payment_status || 'pagado',
      total_value: childTotalValue,
      customer_name: parentOrder.customer_name,
      customer_email: parentOrder.customer_email,
      customer_phone: parentOrder.customer_phone,
      shipping_address: parentOrder.shipping_address,
      shipping_city: parentOrder.shipping_city,
      shipping_complement: parentOrder.shipping_complement,
      shipping_method: parentOrder.shipping_method || 'Envío a Domicilio',
      operador: parentOrder.operador || 'Manual',
      agenda: parentOrder.agenda || null,
      sucursal_pickeo: parentOrder.sucursal_pickeo || null,
      categoria_entrega: parentOrder.categoria_entrega || 'DISTRIBUCIÓN',
      status: childInitialStatus,
      estado_wms: (childInitialStatus === 'en espera' || childInitialStatus === 'sin stock') ? 'En procesamiento' : 'En procesamiento',
      cantidad: totalMissing,
      sku: childSkus,
      item: childItemsName,
      created_at: new Date().toISOString(),
      raw_shopify_data: clonedRawShopify,
      parent_order_id: parentOrder.id,
      is_split: true,
      split_sequence: nextSequence || 2,
      split_reason: splitReason
    };

    let insertedChildOrder = null;
    const { data: childData, error: childInsertErr } = await client
      .from('orders')
      .insert([childOrderPayload])
      .select()
      .single();

    if (childInsertErr) {
      // Fallback si las nuevas columnas no han sido creadas en SQL
      if (childInsertErr.message && (
        childInsertErr.message.includes('parent_order_id') ||
        childInsertErr.message.includes('is_split') ||
        childInsertErr.message.includes('split_sequence') ||
        childInsertErr.message.includes('split_reason')
      )) {
        console.warn('Columnas split no disponibles en tabla orders, usando fallback en raw_shopify_data.');
        const fallbackChild = { ...childOrderPayload };
        delete fallbackChild.parent_order_id;
        delete fallbackChild.is_split;
        delete fallbackChild.split_sequence;
        delete fallbackChild.split_reason;

        const { data: fbData, error: fbErr } = await client
          .from('orders')
          .insert([fallbackChild])
          .select()
          .single();

        if (fbErr) throw fbErr;
        insertedChildOrder = fbData;
      } else {
        throw childInsertErr;
      }
    } else {
      insertedChildOrder = childData;
    }

    // D. Insertar los items de la orden hija
    const childItemsPayload = movedItemsForChild.map(item => ({
      order_id: insertedChildOrder.id,
      product_id: item.product_id,
      warehouse_id: item.warehouse_id,
      quantity: item.quantity,
      tag: item.tag || null,
      is_gift: !!item.is_gift,
      campaign_id: item.campaign_id || null
    }));

    const { error: childItemsErr } = await client
      .from('order_items')
      .insert(childItemsPayload);

    if (childItemsErr) throw childItemsErr;

    // E. Registrar auditoría en ambas órdenes
    try {
      await client.from('order_audit_logs').insert([
        {
          order_id: parentOrder.id,
          user_id: userId,
          user_email: userEmail,
          action: 'División de Pedido (Envío Parcial)',
          details: {
            changes: parentChangesList,
            comment: `Pedido dividido por: ${splitReason}. Se generó la orden de faltantes ${childFolio}.`
          }
        },
        {
          order_id: insertedChildOrder.id,
          user_id: userId,
          user_email: userEmail,
          action: 'Creación de Orden Derivada',
          details: {
            changes: [`Orden derivada generada a partir de ${parentFolio} para despachar productos faltantes.`],
            comment: splitReason
          }
        }
      ]);
    } catch (audErr) {
      console.warn('Aviso guardando auditoría de split:', audErr);
    }

    // F. Actualizar estado local en memoria
    if (window.loadedOrders) {
      // Actualizar padre
      const idx = window.loadedOrders.findIndex(o => o.id === parentOrder.id);
      if (idx !== -1) {
        window.loadedOrders[idx].cantidad = totalSendNow;
        window.loadedOrders[idx].total_value = newParentTotalValue;
        window.loadedOrders[idx].sku = newParentSkus;
        window.loadedOrders[idx].item = newParentItemsName;
        window.loadedOrders[idx].is_split = true;
        // Filtrar y actualizar sus order_items en memoria
        if (window.loadedOrders[idx].order_items) {
          window.loadedOrders[idx].order_items = window.loadedOrders[idx].order_items
            .filter(oi => {
              const r = parentRemainingItems.find(p => p.id === oi.id);
              if (!r) return false;
              oi.quantity = r.quantity;
              return true;
            });
        }
      }

      // Preparar child para memoria
      insertedChildOrder.order_items = movedItemsForChild.map(i => ({
        product_id: i.product_id,
        warehouse_id: i.warehouse_id,
        quantity: i.quantity,
        products: { sku: i.sku, name: i.name, price: i.price },
        warehouses: { name: (window.tempWarehouses || []).find(w => w.id === i.warehouse_id)?.name || 'Bodega Central' }
      }));
      window.loadedOrders.unshift(insertedChildOrder);
    }

    // Cerrar modal
    window.closeSplitOrderModal();

    // Refrescar tabla del WMS
    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
    }

    Swal.fire({
      icon: 'success',
      title: '¡Pedido Dividido con Éxito!',
      html: `
        El pedido original <strong>${parentFolio}</strong> fue ajustado a <strong>${totalSendNow} unidades</strong> y ya está listo para procesar.<br><br>
        Se ha creado exitosamente el pedido derivado <strong>${childFolio}</strong> con las <strong>${totalMissing} unidades</strong> faltantes.
      `,
      confirmButtonColor: '#7c3aed'
    });

  } catch (error) {
    console.error('Error al dividir pedido:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error al Dividir Pedido',
      text: error.message || 'Ocurrió un problema al procesar la división.',
      confirmButtonColor: '#7c3aed'
    });
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = '<i class="ri-check-double-line"></i> Confirmar y Dividir Pedido';
    }
  }
};
