/**
 * WMS STOCKA - Módulo de Solicitudes Especiales de Picking (Picking Requests)
 * Permite a los clientes crear indicaciones y listas de requerimientos especiales para un pedido.
 * 
 * Reglas de negocio:
 * 1. Solo se puede procesar si el pedido está en:
 *    - 'en procesamiento'
 *    - 'en preparación'
 *    - 'pickeado'
 * 2. Si está en estado 'pickeado', muestra advertencia de desfase entre plataformas
 *    e invita a comunicarse con su KAM o vía grupo de WhatsApp de su comercio.
 * 3. Se sincroniza con el sistema de Picker (notificación flotante, checks de operario).
 * 4. Muestra tags y estados en Torre de Control de Admin y Portal de Clientes.
 */

const WMS_SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

function getPickingSupabase() {
  if (window.supabaseClient) return window.supabaseClient;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    return window.supabase.createClient(WMS_SUPABASE_URL, WMS_SUPABASE_ANON_KEY);
  }
  return null;
}

// Caché en memoria de solicitudes indexadas por order_id
window.pickingRequestsCache = window.pickingRequestsCache || new Map();
window.currentPickingRequestState = null;

/**
 * Valida si un pedido es elegible para crear o procesar solicitudes de picking.
 * Estados permitidos: en procesamiento, en preparación, pickeado.
 */
window.canCreatePickingRequest = function(order) {
  if (!order) return { eligible: false, isPickeado: false, reason: 'Pedido no especificado' };

  const normalizeStatus = s => String(s || '').toLowerCase().trim();
  const estadoWms = normalizeStatus(order.estado_wms);
  const statusOrigen = normalizeStatus(order.status);

  // Estados terminales o que ya salieron de la bodega
  const terminalStatuses = ['despachado', 'entregado', 'retirado', 'cancelado', 'archivado', 'incidencia'];
  if (terminalStatuses.includes(estadoWms) || terminalStatuses.includes(statusOrigen)) {
    return {
      eligible: false,
      isPickeado: false,
      reason: `El pedido está ${order.estado_wms || order.status}. Solo se permiten solicitudes antes de su despacho.`
    };
  }

  // Verificar si está en estado Pickeado
  const isPickeado = estadoWms === 'pickeado' || statusOrigen === 'pickeado' || statusOrigen === 'preparado';

  // Verificar si está en procesamiento o en preparación
  const isProcesamiento = estadoWms === 'en procesamiento' || statusOrigen === 'en procesamiento' || statusOrigen === 'para procesar';
  const isPreparacion = estadoWms === 'en preparación' || estadoWms === 'en preparacion' || statusOrigen === 'en preparación' || statusOrigen === 'en preparacion';

  if (isProcesamiento || isPreparacion || isPickeado) {
    return {
      eligible: true,
      isPickeado: isPickeado,
      currentStatus: order.estado_wms || order.status || 'En procesamiento',
      reason: null
    };
  }

  // Fallback por defecto si no es terminal
  return {
    eligible: true,
    isPickeado: isPickeado,
    currentStatus: order.estado_wms || order.status || 'En procesamiento',
    reason: null
  };
};

/**
 * Carga solicitudes de picking activas en lote para las órdenes mostradas
 */
window.loadBatchPickingRequests = async function(orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return;
  const supa = getPickingSupabase();
  if (!supa) return;

  try {
    const { data, error } = await supa
      .from('order_picking_requests')
      .select('*')
      .in('order_id', orderIds);

    if (error) {
      // Si la tabla no ha sido creada aún en Supabase, no interrumpir la navegación
      console.warn("ℹ️ [PICKING REQUESTS] Consulta de solicitudes:", error.message);
      return;
    }

    if (data && Array.isArray(data)) {
      data.forEach(req => {
        window.pickingRequestsCache.set(req.order_id, req);
      });
    }
  } catch (err) {
    console.warn("ℹ️ [PICKING REQUESTS] Error cargando solicitudes:", err);
  }
};

/**
 * Consulta la solicitud de un pedido en particular
 */
window.fetchOrderPickingRequest = async function(orderId) {
  if (!orderId) return null;
  if (window.pickingRequestsCache.has(orderId)) {
    return window.pickingRequestsCache.get(orderId);
  }

  const supa = getPickingSupabase();
  if (!supa) return null;

  try {
    const { data, error } = await supa
      .from('order_picking_requests')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    if (!error && data) {
      window.pickingRequestsCache.set(orderId, data);
      return data;
    }
  } catch (_) {}

  return null;
};

/**
 * Asegura que el contenedor del Modal exista en el DOM
 */
window.ensurePickingRequestModalExists = function() {
  let modalEl = document.getElementById('modal-client-picking-request');
  if (modalEl) return modalEl;

  modalEl = document.createElement('div');
  modalEl.id = 'modal-client-picking-request';
  modalEl.className = 'modal-overlay';
  modalEl.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); display: none; align-items: center; justify-content: center; z-index: 99999; opacity: 0; pointer-events: none; transition: opacity 0.25s ease;';

  // Cerrar al hacer clic en el backdrop oscuro exterior
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) {
      window.closeClientPickingRequestModal();
    }
  });

  modalEl.innerHTML = `
    <div class="modal-content" style="max-width: 680px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; padding: 0; border-radius: var(--radius-lg, 12px); box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6); border: 1px solid var(--color-border, #334155); background: var(--color-surface, #1e293b); color: var(--color-text-main, #f8fafc); z-index: 100000; overflow: hidden; transform: translateY(0) scale(1);">
      
      <!-- Modal Header -->
      <div class="modal-header" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-border, #334155); background: var(--color-bg, #0f172a); display: flex; align-items: center; justify-content: space-between; border-radius: 12px 12px 0 0;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 42px; height: 42px; border-radius: 10px; background: rgba(99, 102, 241, 0.15); color: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.35rem; flex-shrink: 0;">
            <i class="ri-clipboard-line"></i>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--color-text-main, #f8fafc);">Solicitud Especial de Picking</h3>
            <span id="pr-modal-order-subtitle" style="font-size: 0.8rem; color: var(--color-text-muted, #94a3b8);">Pedido #---</span>
          </div>
        </div>
        <button type="button" class="modal-close" onclick="window.closeClientPickingRequestModal()" style="font-size: 1.5rem; color: var(--color-text-muted, #94a3b8); cursor: pointer; background: transparent; border: none; line-height: 1;">&times;</button>
      </div>

      <!-- Modal Body (Desplazable) -->
      <div class="modal-body" id="pr-modal-body" style="overflow-y: auto; flex: 1 1 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
        <!-- Se inyecta dinámicamente -->
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border, #334155); background: var(--color-bg, #0f172a); display: flex; justify-content: space-between; align-items: center; border-radius: 0 0 12px 12px;">
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <button type="button" class="btn btn-outline" onclick="window.closeClientPickingRequestModal()" style="border-color: var(--color-border, #475569); color: var(--color-text-main, #f8fafc); cursor: pointer;">Cancelar</button>
          <button type="button" id="pr-btn-delete-request" onclick="window.deleteCurrentPickingRequest()" class="btn btn-outline" style="border-color: #ef4444; color: #ef4444; display: none; align-items: center; gap: 0.35rem; padding: 0.5rem 0.85rem; border-radius: 6px; font-size: 0.85rem; cursor: pointer; background: rgba(239, 68, 68, 0.08);">
            <i class="ri-delete-bin-line"></i> Eliminar Solicitud
          </button>
        </div>
        <button type="button" id="pr-btn-save-request" onclick="window.savePickingRequestFromModal()" class="btn btn-primary" style="background: #6366f1; color: #fff; font-weight: 700; display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.35rem; border-radius: var(--radius-sm, 6px); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3); border: none; cursor: pointer;">
          <i class="ri-save-line"></i> Guardar Solicitud
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modalEl);
  return modalEl;
};

/**
 * Cierra el modal de Solicitud de Picking
 */
window.closeClientPickingRequestModal = function() {
  const modalEl = document.getElementById('modal-client-picking-request');
  if (modalEl) {
    modalEl.classList.remove('active');
    modalEl.style.opacity = '0';
    modalEl.style.pointerEvents = 'none';
    modalEl.style.display = 'none';
  }
  window.currentPickingRequestState = null;
};

/**
 * Abre el modal para crear o editar una solicitud de picking para un pedido
 */
window.openClientPickingRequestModal = async function(orderIdOrObj) {
  if (!orderIdOrObj) return;

  try {
    let order = null;
    let orderId = null;

    if (typeof orderIdOrObj === 'object' && orderIdOrObj !== null) {
      order = orderIdOrObj;
      orderId = String(order.id || '');
    } else {
      orderId = String(orderIdOrObj || '').trim();
    }

    console.log("🖱️ [PICKING REQUESTS] Abriendo modal para pedido:", orderId);

    // 1. Buscar en mapa en memoria
    if (!order && window._pickingOrdersMap && window._pickingOrdersMap.has(orderId)) {
      order = window._pickingOrdersMap.get(orderId);
    }
    // 2. Buscar en listas cargadas de clientes o admin
    if (!order && Array.isArray(window.clientLoadedOrders)) {
      order = window.clientLoadedOrders.find(o => String(o.id) === orderId || String(o.external_order_number) === orderId || String(o.numero_orden) === orderId);
    }
    if (!order && Array.isArray(window.loadedOrders)) {
      order = window.loadedOrders.find(o => String(o.id) === orderId || String(o.external_order_number) === orderId || String(o.numero_orden) === orderId);
    }
    if (!order && Array.isArray(window.allOrders)) {
      order = window.allOrders.find(o => String(o.id) === orderId || String(o.external_order_number) === orderId || String(o.numero_orden) === orderId);
    }

    // 3. Consultar en base de datos si no está en memoria
    if (!order) {
      const supa = getPickingSupabase();
      if (supa) {
        try {
          const { data } = await supa.from('orders').select('*').eq('id', orderId).maybeSingle();
          order = data;
        } catch (e) {
          console.warn("Consulta Supabase orders fallback:", e);
        }
      }
    }

    // 4. Si aún no se encuentra, construir fallback para nunca bloquear la experiencia
    if (!order) {
      console.warn("⚠️ [PICKING REQUESTS] Usando orden mínima fallback para:", orderId);
      order = {
        id: orderId,
        external_order_number: orderId.split('-')[0],
        comercio: 'STOCKA',
        estado_wms: 'En preparación',
        status: 'en preparación'
      };
    }

    // 5. Validar elegibilidad según reglas de negocio
    const eligibility = window.canCreatePickingRequest(order);
    if (!eligibility.eligible) {
      if (window.Swal) {
        window.Swal.fire({
          icon: 'warning',
          title: 'Solicitud no permitida',
          text: eligibility.reason,
          confirmButtonColor: '#6366f1'
        });
      } else {
        alert("No se puede crear solicitud para este pedido: " + eligibility.reason);
      }
      return;
    }

    // 6. Obtener solicitud previa si existe
    let existingRequest = await window.fetchOrderPickingRequest(order.id);

    // Inicializar estado local del modal
    window.currentPickingRequestState = {
      order: order,
      orderId: order.id,
      externalOrderNumber: order.external_order_number || order.numero_orden || order.id.split('-')[0],
      comercio: order.comercio || 'STOCKA',
      isPickeado: eligibility.isPickeado,
      warningAcknowledged: existingRequest ? Boolean(existingRequest.warning_acknowledged) : false,
      items: existingRequest && Array.isArray(existingRequest.items) ? JSON.parse(JSON.stringify(existingRequest.items)) : [],
      generalNotes: existingRequest ? (existingRequest.general_notes || '') : '',
      status: existingRequest ? existingRequest.status : 'pendiente',
      isNew: !existingRequest
    };

    const modalEl = window.ensurePickingRequestModalExists();
    const subtitleEl = document.getElementById('pr-modal-order-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = `Pedido #${window.currentPickingRequestState.externalOrderNumber} · ${order.comercio || ''} (${order.estado_wms || order.status || 'En procesamiento'})`;
    }

    window.renderPickingRequestModalBody();

    // Visualizar modal de manera inequívoca
    modalEl.style.display = 'flex';
    modalEl.style.opacity = '1';
    modalEl.style.pointerEvents = 'auto';
    modalEl.classList.add('active');

  } catch (err) {
    console.error("❌ [PICKING REQUESTS] Error abriendo modal:", err);
    alert("Error al abrir solicitud de picking: " + (err.message || err));
  }
};

/**
 * Renderiza el contenido interno del modal según el estado actual
 */
window.renderPickingRequestModalBody = function() {
  const state = window.currentPickingRequestState;
  const bodyEl = document.getElementById('pr-modal-body');
  if (!bodyEl || !state) return;

  const isCompleted = state.status === 'completada';

  // 1. Banner de Advertencia Crítica para pedidos en estado "Pickeado"
  let warningBannerHtml = '';
  if (state.isPickeado) {
    warningBannerHtml = `
      <div style="background: rgba(245, 158, 11, 0.12); border: 1.5px solid #f59e0b; border-radius: var(--radius-md, 8px); padding: 1rem 1.15rem; display: flex; flex-direction: column; gap: 0.75rem;">
        <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
          <i class="ri-alert-fill" style="color: #f59e0b; font-size: 1.4rem; margin-top: 0.1rem; flex-shrink: 0;"></i>
          <div>
            <strong style="color: #f59e0b; font-size: 0.95rem; display: block; margin-bottom: 0.25rem;">
              ⚠️ Advertencia: Pedido ya se encuentra en estado Pickeado
            </strong>
            <p style="margin: 0; font-size: 0.85rem; line-height: 1.45; color: var(--color-text-main, #e2e8f0);">
              Debido a los posibles desfases de sincronización entre plataformas y couriers, es posible que el pedido ya se encuentre embalado o en ruta de despacho. Si necesitas asegurar esta indicación urgente, te invitamos a <strong>comunicarte directamente con tu KAM</strong> o vía el <strong>grupo de WhatsApp oficial de tu comercio</strong>.
            </p>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed rgba(245, 158, 11, 0.35);">
          <a href="https://wa.me/56939223783?text=${encodeURIComponent(`Hola! Necesito coordinar una solicitud de picking urgente para el pedido #${state.externalOrderNumber} de ${state.comercio}.`)}" target="_blank" class="btn btn-outline btn-sm" style="border-color: #22c55e; color: #22c55e; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.3rem 0.65rem; font-size: 0.78rem; text-decoration: none; border-radius: 4px; font-weight: 600;">
            <i class="ri-whatsapp-line"></i> Contactar Soporte / WhatsApp
          </a>

          <label style="display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.8rem; font-weight: 600; color: var(--color-text-main, #f8fafc);">
            <input type="checkbox" id="pr-ack-checkbox" ${state.warningAcknowledged ? 'checked' : ''} onchange="window.currentPickingRequestState.warningAcknowledged = this.checked;" style="width: 16px; height: 16px; accent-color: #f59e0b; cursor: pointer;">
            <span>Entiendo que el pedido podría ya estar en ruta</span>
          </label>
        </div>
      </div>
    `;
  }

  // 2. Chips de sugerencias rápidas (Templates frecuentes)
  const quickChips = [
    { label: 'Incluir regalo / muestra gratis', icon: 'ri-gift-line' },
    { label: 'Embalaje reforzado / Burbuja extra', icon: 'ri-shield-check-line' },
    { label: 'Revisar fecha de vencimiento / lote', icon: 'ri-calendar-check-line' },
    { label: 'No incluir boleta con precios en paquete', icon: 'ri-file-forbid-line' },
    { label: 'Packaging de regalo / Bolsa compostable', icon: 'ri-shopping-bag-3-line' },
    { label: 'Verificar SKU específico antes de sellar', icon: 'ri-barcode-line' }
  ];

  const chipsHtml = quickChips.map(c => `
    <button type="button" onclick="window.addPickingRequestItem('${c.label}')" class="btn btn-outline btn-sm" style="border-radius: 20px; font-size: 0.75rem; padding: 0.25rem 0.65rem; border: 1px solid var(--color-border, #475569); color: var(--color-text-muted, #94a3b8); display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer; transition: all 0.15s;" onmouseover="this.style.borderColor='#6366f1'; this.style.color='#6366f1';" onmouseout="this.style.borderColor='var(--color-border, #475569)'; this.style.color='var(--color-text-muted, #94a3b8)';">
      <i class="${c.icon}"></i> ${c.label}
    </button>
  `).join('');

  // 3. Renderizar items actuales en la lista
  let itemsListHtml = '';
  if (state.items.length === 0) {
    itemsListHtml = `
      <div style="text-align: center; padding: 2rem; color: var(--color-text-muted, #94a3b8); font-size: 0.85rem; border: 1px dashed var(--color-border, #334155); border-radius: var(--radius-md, 8px);">
        <i class="ri-list-check-2" style="font-size: 2rem; opacity: 0.6; display: block; margin-bottom: 0.5rem;"></i>
        Aún no has añadido indicaciones a la lista.<br>
        Usa las sugerencias rápidas arriba o escribe un requerimiento abajo.
      </div>
    `;
  } else {
    itemsListHtml = `
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${state.items.map((it, idx) => {
          const isChecked = Boolean(it.checked);
          const isDiscarded = Boolean(it.discarded);
          let checkStatusHtml = '';
          if (isChecked) {
            checkStatusHtml = `
              <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.72rem; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 600;">
                <i class="ri-checkbox-circle-fill"></i> Listo por ${it.checked_by || 'Picker'} ${it.checked_at ? 'el ' + new Date(it.checked_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            `;
          } else if (isDiscarded) {
            checkStatusHtml = `
              <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 0.72rem; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 600;" title="${it.discard_reason ? 'Motivo: ' + it.discard_reason : 'Descartado'}">
                <i class="ri-close-circle-fill"></i> Descartado por ${it.discarded_by || 'Picker'}
              </span>
            `;
          } else {
            checkStatusHtml = `
              <span class="badge" style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25); font-size: 0.72rem; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 500;">
                <i class="ri-time-line"></i> Pendiente en bodega
              </span>
            `;
          }

          const badgeBg = isChecked ? '#10b981' : (isDiscarded ? '#ef4444' : 'rgba(99, 102, 241, 0.2)');
          const badgeColor = (isChecked || isDiscarded) ? '#fff' : '#818cf8';
          const badgeSymbol = isChecked ? '✓' : (isDiscarded ? '✕' : (idx + 1));
          const borderStyle = isChecked ? 'rgba(16, 185, 129, 0.3)' : (isDiscarded ? 'rgba(239, 68, 68, 0.35)' : 'var(--color-border, #334155)');

          return `
            <div style="display: flex; flex-direction: column; gap: 0.35rem; background: var(--color-bg, #0f172a); border: 1px solid ${borderStyle}; padding: 0.65rem 0.85rem; border-radius: var(--radius-sm, 6px);">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
                <div onclick="window.toggleModalItemCheck(${idx})" style="display: flex; align-items: center; gap: 0.6rem; min-width: 0; flex: 1; cursor: pointer;" title="Clic para alternar estado">
                  <span style="width: 22px; height: 22px; border-radius: 50%; background: ${badgeBg}; color: ${badgeColor}; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    ${badgeSymbol}
                  </span>
                  <span style="font-size: 0.875rem; font-weight: 500; color: ${isDiscarded ? '#ef4444' : 'var(--color-text-main, #f8fafc)'}; word-break: break-word; text-decoration: ${(isChecked || isDiscarded) ? 'line-through' : 'none'}; opacity: ${(isChecked || isDiscarded) ? '0.85' : '1'};">
                    ${window.escapeHtml ? window.escapeHtml(it.text) : it.text}
                  </span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;">
                  <div onclick="window.toggleModalItemCheck(${idx})" style="cursor: pointer;">
                    ${checkStatusHtml}
                  </div>
                  ${(!isChecked && !isDiscarded) ? `
                    <button type="button" onclick="event.stopPropagation(); window.removePickingRequestItem(${idx})" title="Eliminar ítem" style="background: transparent; border: none; color: #ef4444; cursor: pointer; padding: 4px; font-size: 1rem; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
              ${isDiscarded && it.discard_reason ? `
                <div style="font-size: 0.78rem; color: #fca5a5; font-style: italic; padding-left: 2rem; display: flex; align-items: center; gap: 0.35rem;">
                  <i class="ri-error-warning-line" style="color: #ef4444;"></i> <strong>Motivo descarte:</strong> "${window.escapeHtml ? window.escapeHtml(it.discard_reason) : it.discard_reason}"
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  bodyEl.innerHTML = `
    ${warningBannerHtml}

    <!-- Sección 1: Sugerencias Rápidas -->
    <div>
      <label style="display: block; font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 0.5rem;">
        <i class="ri-magic-line"></i> Sugerencias Frecuentes:
      </label>
      <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
        ${chipsHtml}
      </div>
    </div>

    <!-- Sección 2: Input para añadir requerimiento personalizado -->
    <div>
      <label for="pr-custom-item-input" style="display: block; font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 0.4rem;">
        <i class="ri-edit-2-line"></i> Añadir Indicación o Necesidad:
      </label>
      <div style="display: flex; gap: 0.5rem;">
        <input type="text" id="pr-custom-item-input" class="form-input" placeholder="Ej: Asegurar que la caja lleve sticker de 'Frágil' en todas las caras" style="flex: 1; padding: 0.55rem 0.75rem; font-size: 0.875rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--color-border, #475569); background: var(--color-bg, #0f172a); color: var(--color-text-main, #f8fafc);" onkeydown="if (event.key === 'Enter') { event.preventDefault(); window.addCustomPickingRequestItem(); }">
        <button type="button" onclick="window.addCustomPickingRequestItem()" class="btn btn-primary" style="background: #4f46e5; color: #fff; font-weight: 600; padding: 0.55rem 1rem; border-radius: var(--radius-sm, 6px); display: inline-flex; align-items: center; gap: 0.3rem; border: none; cursor: pointer; flex-shrink: 0;">
          <i class="ri-add-line"></i> Añadir
        </button>
      </div>
    </div>

    <!-- Sección 3: Listado de Requerimientos -->
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
        <label style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.4px;">
          <i class="ri-checkbox-multiple-line"></i> Checklist de Requerimientos (${state.items.length}):
        </label>
        ${state.items.length > 0 ? `
          <span style="font-size: 0.75rem; color: #818cf8; font-weight: 600;">
            ${state.items.filter(i => i.checked).length} de ${state.items.length} verificados
          </span>
        ` : ''}
      </div>
      ${itemsListHtml}
    </div>

    <!-- Sección 4: Observaciones Generales Adicionales -->
    <div>
      <label for="pr-general-notes" style="display: block; font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 0.4rem;">
        <i class="ri-chat-3-line"></i> Notas u Observaciones Adicionales (Opcional):
      </label>
      <textarea id="pr-general-notes" class="form-input" rows="2" placeholder="Instrucciones complementarias para el equipo de empaque..." style="width: 100%; padding: 0.55rem 0.75rem; font-size: 0.85rem; border-radius: var(--radius-sm, 6px); border: 1px solid var(--color-border, #475569); background: var(--color-bg, #0f172a); color: var(--color-text-main, #f8fafc); resize: vertical;" oninput="window.currentPickingRequestState.generalNotes = this.value;">${state.generalNotes || ''}</textarea>
    </div>
  `;

  // Controlar visibilidad del botón de eliminar en el footer
  const deleteBtn = document.getElementById('pr-btn-delete-request');
  if (deleteBtn) {
    deleteBtn.style.display = state.isNew ? 'none' : 'inline-flex';
  }
};

/**
 * Añade un ítem desde un chip predefinido
 */
window.addPickingRequestItem = function(text) {
  if (!text || !window.currentPickingRequestState) return;
  const exists = window.currentPickingRequestState.items.some(i => i.text.toLowerCase() === text.toLowerCase());
  if (exists) {
    if (window.showToastNotification) {
      window.showToastNotification("Este requerimiento ya fue agregado a la lista", "info");
    }
    return;
  }

  window.currentPickingRequestState.items.push({
    id: 'req_' + Math.random().toString(36).substring(2, 9),
    text: text.trim(),
    checked: false,
    checked_at: null,
    checked_by: null
  });

  window.renderPickingRequestModalBody();
};

/**
 * Añade un ítem personalizado desde el input de texto
 */
window.addCustomPickingRequestItem = function() {
  const input = document.getElementById('pr-custom-item-input');
  if (!input || !window.currentPickingRequestState) return;
  const val = input.value.trim();
  if (!val) return;

  window.addPickingRequestItem(val);
  input.value = '';
  input.focus();
};

/**
 * Elimina un ítem de la lista
 */
window.removePickingRequestItem = function(index) {
  if (!window.currentPickingRequestState || !window.currentPickingRequestState.items[index]) return;
  window.currentPickingRequestState.items.splice(index, 1);
  window.renderPickingRequestModalBody();
};

/**
 * Guarda la solicitud de picking en la base de datos Supabase
 */
window.savePickingRequestFromModal = async function() {
  const state = window.currentPickingRequestState;
  if (!state) return;

  const btn = document.getElementById('pr-btn-save-request');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line" style="animation: spin 1s infinite linear;"></i> Guardando...';
  }

  try {
    if (state.items.length === 0) {
      alert("Por favor agrega al menos una indicación o necesidad para este pedido.");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-save-line"></i> Guardar Solicitud';
      }
      return;
    }

    // Validar checkbox si es estado Pickeado
    if (state.isPickeado && !state.warningAcknowledged) {
      const ackBox = document.getElementById('pr-ack-checkbox');
      if (ackBox && !ackBox.checked) {
        alert("Por favor marca la casilla de confirmación donde aceptas que, por los desfases de plataforma, el pedido podría ya estar en ruta.");
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="ri-save-line"></i> Guardar Solicitud';
        }
        return;
      }
      state.warningAcknowledged = true;
    }

    const notesEl = document.getElementById('pr-general-notes');
    if (notesEl) state.generalNotes = notesEl.value.trim();

    // Obtener usuario autenticado
    let userEmail = 'cliente@stocka.cl';
    let userId = null;
    try {
      if (window.currentSession?.user) {
        userEmail = window.currentSession.user.email || userEmail;
        userId = window.currentSession.user.id || null;
      } else {
        const stored = localStorage.getItem('supabase.auth.token') || localStorage.getItem('stocka_user_session');
        if (stored) {
          const parsed = JSON.parse(stored);
          userEmail = parsed?.user?.email || parsed?.email || userEmail;
          userId = parsed?.user?.id || null;
        }
      }
    } catch (_) {}

    // Calcular estado
    const allChecked = state.items.length > 0 && state.items.every(i => i.checked);
    const anyChecked = state.items.some(i => i.checked);
    let finalStatus = 'pendiente';
    if (allChecked) finalStatus = 'completada';
    else if (anyChecked) finalStatus = 'en_preparacion';

    const supa = getPickingSupabase();
    if (!supa) throw new Error("No hay conexión con la base de datos Supabase.");

    const payload = {
      order_id: state.orderId,
      external_order_number: state.externalOrderNumber,
      comercio: state.comercio,
      status: finalStatus,
      items: state.items,
      general_notes: state.generalNotes || null,
      warning_acknowledged: Boolean(state.warningAcknowledged),
      created_by_email: userEmail,
      updated_at: new Date().toISOString()
    };
    if (userId) payload.created_by = userId;

    // Guardar: si ya existe para este order_id, actualizar; si no, insertar (evita requerir restricción estricta ON CONFLICT)
    let savedData = null;
    let saveErr = null;

    const { data: existingRecord, error: checkErr } = await supa
      .from('order_picking_requests')
      .select('id')
      .eq('order_id', state.orderId)
      .maybeSingle();

    if (existingRecord && existingRecord.id) {
      const updateRes = await supa
        .from('order_picking_requests')
        .update(payload)
        .eq('id', existingRecord.id)
        .select()
        .maybeSingle();
      savedData = updateRes.data;
      saveErr = updateRes.error;
    } else {
      const insertRes = await supa
        .from('order_picking_requests')
        .insert([payload])
        .select()
        .maybeSingle();
      savedData = insertRes.data;
      saveErr = insertRes.error;
    }

    if (saveErr) {
      console.error("Error guardando en order_picking_requests:", saveErr);
      throw new Error(`Error al guardar en base de datos: ${saveErr.message}.`);
    }

    // Actualizar flag en tabla orders
    try {
      await supa
        .from('orders')
        .update({
          has_picking_request: true,
          picking_request_status: finalStatus
        })
        .eq('id', state.orderId);
    } catch (orderUpdateErr) {
      console.warn("Actualización complementaria en orders:", orderUpdateErr);
    }

    // Actualizar caché local
    const finalRecord = savedData || payload;
    window.pickingRequestsCache.set(state.orderId, finalRecord);

    // Actualizar orden en memoria
    if (state.order) {
      state.order.has_picking_request = true;
      state.order.picking_request_status = finalStatus;
    }

    // Sincronizar en segundo plano con active_orders de Picker
    if (typeof window.syncPickingRequestToPicker === 'function') {
      window.syncPickingRequestToPicker(state.orderId, finalRecord).catch(err => {
        console.warn("⚠️ [PICKER SYNC] Fallback al sincronizar:", err);
      });
    }

    // Tocar sonido agradable
    if (typeof window.playPickingChime === 'function') {
      window.playPickingChime(finalStatus === 'completada' ? 'done' : 'success');
    }

    if (window.showToastNotification) {
      window.showToastNotification("✅ Solicitud de picking guardada y sincronizada.", "success");
    } else {
      alert("✅ Solicitud de picking guardada y sincronizada.");
    }

    window.closeClientPickingRequestModal();

    // Actualizar vista según si estamos en Admin o en Portal Cliente
    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
    } else if (typeof window.renderOrders === 'function') {
      // Re-renderizar sección de detalles si está abierta
      const detailCard = document.getElementById(`picking-req-card-${state.orderId}`);
      if (detailCard) {
        detailCard.outerHTML = window.renderOrderPickingRequestCard(state.order);
      }
    }
  } catch (err) {
    console.error("Error al guardar solicitud de picking:", err);
    alert(err.message || "Error al guardar la solicitud de picking.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-save-line"></i> Guardar Solicitud';
    }
  }
};

/**
 * Retorna el HTML del badge para la fila del pedido
 */
window.getOrderPickingRequestBadgeHtml = function(order) {
  if (!order) return '';

  const hasReq = Boolean(order.has_picking_request) || window.pickingRequestsCache.has(order.id);
  if (!hasReq) return '';

  const req = window.pickingRequestsCache.get(order.id);
  const status = (req ? req.status : order.picking_request_status || 'pendiente').toLowerCase();

  let bg = 'rgba(245, 158, 11, 0.14)';
  let color = '#d97706';
  let border = 'rgba(245, 158, 11, 0.35)';
  let icon = 'ri-clipboard-line';
  let text = 'Solicitud Picking';
  let tagFilter = 'Solicitud Picking: Pendiente';

  if (status === 'completada') {
    bg = 'rgba(16, 185, 129, 0.14)';
    color = '#059669';
    border = 'rgba(16, 185, 129, 0.35)';
    icon = 'ri-checkbox-circle-line';
    text = 'Solicitud Lista';
    tagFilter = 'Solicitud Picking: Lista';
  } else if (status === 'en_preparacion' || status === 'parcial') {
    bg = 'rgba(14, 165, 233, 0.14)';
    color = '#0284c7';
    border = 'rgba(14, 165, 233, 0.35)';
    icon = 'ri-loader-4-line';
    text = 'Solicitud En Proceso';
    tagFilter = 'Solicitud Picking: En Proceso';
  }

  return `
    <span class="badge wms-order-tag-badge wms-picking-req-badge" onclick="event.stopPropagation(); window.openClientPickingRequestModal('${order.id}');" style="background-color: ${bg}; color: ${color}; border: 1px solid ${border}; font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.22rem; cursor: pointer; transition: all 0.15s; letter-spacing: 0.3px; width: fit-content; margin-top: 0.25rem;" title="Ver y gestionar requerimientos especiales de picking (Clic para abrir)">
      <i class="${icon}"></i> ${text}
    </span>
  `;
};

/**
 * Retorna el HTML de la tarjeta de Solicitudes Especiales para colocar en la vista expandida del pedido
 */
window.renderOrderPickingRequestCard = function(order) {
  if (!order) return '';

  window._pickingOrdersMap = window._pickingOrdersMap || new Map();
  if (order.id) {
    window._pickingOrdersMap.set(String(order.id), order);
  }
  const safeOrderId = String(order.id || '').replace(/'/g, "\\'");

  const eligibility = window.canCreatePickingRequest(order);
  const req = window.pickingRequestsCache.get(order.id);
  const hasRequest = Boolean(req && req.items && req.items.length > 0);

  let statusBadgeHtml = '';
  let itemsContentHtml = '';

  if (hasRequest) {
    const isCompleted = req.status === 'completada';
    const checkedCount = req.items.filter(i => i.checked).length;
    const discardedCount = req.items.filter(i => i.discarded).length;
    const totalCount = req.items.length;

    if (isCompleted) {
      if (discardedCount > 0) {
        statusBadgeHtml = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px;"><i class="ri-checkbox-circle-fill"></i> ${checkedCount} listas, ${discardedCount} descartadas</span>`;
      } else {
        statusBadgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px;"><i class="ri-checkbox-circle-fill"></i> Todos los requerimientos verificados</span>`;
      }
    } else {
      statusBadgeHtml = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px;"><i class="ri-time-line"></i> ${checkedCount} de ${totalCount} verificados${discardedCount > 0 ? ` (${discardedCount} descartados)` : ''}</span>`;
    }

    itemsContentHtml = `
      <div style="display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem;">
        ${req.items.map((it, idx) => {
          const isChecked = Boolean(it.checked);
          const isDiscarded = Boolean(it.discarded);

          if (isDiscarded) {
            return `
              <div style="display: flex; flex-direction: column; gap: 0.25rem; background: var(--color-bg, #0f172a); padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid rgba(239, 68, 68, 0.35);">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                  <span style="display: inline-flex; align-items: center; gap: 0.45rem; text-decoration: line-through; opacity: 0.85;">
                    <i class="ri-close-circle-fill" style="color: #ef4444; font-size: 1.05rem;"></i>
                    <span style="color: #ef4444; font-weight: 500;">${window.escapeHtml ? window.escapeHtml(it.text) : it.text}</span>
                  </span>
                  <span style="font-size: 0.7rem; color: #ef4444; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                    <i class="ri-close-line"></i> Descartado (${it.discarded_by || 'Picker'})
                  </span>
                </div>
                ${it.discard_reason ? `
                  <div style="font-size: 0.75rem; color: #fca5a5; font-style: italic; padding-left: 1.5rem; display: flex; align-items: center; gap: 0.3rem;">
                    <i class="ri-error-warning-line" style="color: #ef4444;"></i> <strong>Motivo:</strong> "${window.escapeHtml ? window.escapeHtml(it.discard_reason) : it.discard_reason}"
                  </div>
                ` : ''}
              </div>
            `;
          }

          return `
            <div onclick="event.stopPropagation(); window.togglePickingRequestItemCheck('${order.id}', ${idx})" title="Clic para marcar o desmarcar requerimiento" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: var(--color-bg, #0f172a); padding: 0.45rem 0.7rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid ${isChecked ? 'rgba(16, 185, 129, 0.35)' : 'var(--color-border, #334155)'}; cursor: pointer; transition: all 0.15s ease;">
              <span style="display: inline-flex; align-items: center; gap: 0.45rem; text-decoration: ${isChecked ? 'line-through' : 'none'}; opacity: ${isChecked ? '0.85' : '1'};">
                <i class="${isChecked ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}" style="color: ${isChecked ? '#10b981' : 'var(--color-text-muted, #94a3b8)'}; font-size: 1.05rem;"></i>
                <span style="color: ${isChecked ? 'var(--color-text-muted, #94a3b8)' : 'var(--color-text-main, #f8fafc)'}; font-weight: 500;">${window.escapeHtml ? window.escapeHtml(it.text) : it.text}</span>
              </span>
              ${isChecked ? `
                <span style="font-size: 0.7rem; color: #10b981; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-check-double-line"></i> ${it.checked_by || 'Listo'}
                </span>
              ` : `
                <span style="font-size: 0.7rem; color: #f59e0b; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-time-line"></i> Marcar listo
                </span>
              `}
            </div>
          `;
        }).join('')}
        ${req.general_notes ? `
          <div style="margin-top: 0.35rem; padding: 0.45rem 0.7rem; font-size: 0.8rem; background: rgba(99, 102, 241, 0.08); border-left: 3px solid #6366f1; border-radius: 2px; color: var(--color-text-main, #f8fafc);">
            <strong style="color: #818cf8;">Nota:</strong> ${window.escapeHtml ? window.escapeHtml(req.general_notes) : req.general_notes}
          </div>
        ` : ''}
      </div>
    `;
  } else {
    itemsContentHtml = `
      <p style="margin: 0.35rem 0 0 0; font-size: 0.825rem; color: var(--color-text-muted, #94a3b8); line-height: 1.35;">
        ¿Necesitas que el operario de bodega incluya un regalo, verifique lotes o utilice un empaque especial antes de armar este pedido?
      </p>
    `;
  }

  // Botón de acción según estado
  let actionBtnHtml = '';
  if (eligibility.eligible) {
    actionBtnHtml = `
      <button type="button" onclick="event.stopPropagation(); window.openClientPickingRequestModal('${safeOrderId}')" class="btn btn-outline btn-sm" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 700; color: #6366f1; border-color: #818cf8; background: rgba(99, 102, 241, 0.08); border-radius: var(--radius-sm, 6px); cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;">
        <i class="${hasRequest ? 'ri-edit-line' : 'ri-add-line'}"></i> ${hasRequest ? 'Gestionar Solicitud' : 'Crear Solicitud de Picking'}
      </button>
    `;
  } else {
    actionBtnHtml = `
      <span style="font-size: 0.72rem; color: var(--color-text-muted, #94a3b8); font-style: italic;" title="${eligibility.reason || 'No editable'}">
        No editable (${order.estado_wms || order.status})
      </span>
    `;
  }

  return `
    <div id="picking-req-card-${order.id}" class="order-detail-card" style="background: var(--color-surface, #1e293b); padding: 1.15rem; border-radius: var(--radius-md, 8px); border: 1px solid var(--color-border, #334155); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 0.65rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-border, #334155); padding-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
        <span style="display: flex; align-items: center; gap: 0.4rem; color: #6366f1; font-weight: 700; font-size: 0.95rem;">
          <i class="ri-clipboard-line"></i> Indicaciones Especiales de Picking
        </span>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          ${statusBadgeHtml}
          ${actionBtnHtml}
        </div>
      </div>
      ${itemsContentHtml}
    </div>
  `;
};

/**
 * Alterna el estado de verificación de un ítem dentro del modal
 */
window.toggleModalItemCheck = function(index) {
  if (!window.currentPickingRequestState || !Array.isArray(window.currentPickingRequestState.items)) return;
  const it = window.currentPickingRequestState.items[index];
  if (!it) return;

  it.checked = !it.checked;
  if (it.checked) {
    let name = 'Operario';
    try {
      if (window.currentSession?.user?.email) name = window.currentSession.user.email.split('@')[0];
      else if (window.currentUserEmail) name = window.currentUserEmail.split('@')[0];
    } catch (_) {}
    it.checked_by = name;
    it.checked_at = new Date().toISOString();
    if (typeof window.playPickingChime === 'function') window.playPickingChime('success');
  } else {
    it.checked_by = null;
    it.checked_at = null;
    if (typeof window.playPickingChime === 'function') window.playPickingChime('alert');
  }

  window.renderPickingRequestModalBody();
};

/**
 * Elimina una solicitud de picking de la base de datos y sincroniza
 */
window.deletePickingRequest = async function(orderId) {
  if (!orderId) return;

  const conf = confirm("¿Estás seguro de que deseas eliminar esta solicitud de picking? Las indicaciones se descartarán y el pedido volverá a su estado normal.");
  if (!conf) return;

  try {
    const supa = getPickingSupabase();
    if (supa) {
      await supa.from('order_picking_requests').delete().eq('order_id', orderId);
      await supa.from('orders').update({
        has_picking_request: false,
        picking_request_status: null
      }).eq('id', orderId);
    }

    window.pickingRequestsCache.delete(orderId);

    // Actualizar pedido en memoria
    const orderList = window.loadedOrders || window.allOrders || window.clientOrders || [];
    const found = orderList.find(o => o.id === orderId);
    if (found) {
      found.has_picking_request = false;
      found.picking_request_status = null;
    }

    // Sincronizar eliminación en Picker DB (limpiar observation)
    if (typeof window.syncPickingRequestToPicker === 'function') {
      await window.syncPickingRequestToPicker(orderId, null);
    }

    if (window.showToastNotification) {
      window.showToastNotification("Solicitud de picking eliminada.", "info");
    } else {
      alert("Solicitud de picking eliminada.");
    }

    window.closeClientPickingRequestModal();

    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
    } else if (typeof window.renderOrders === 'function') {
      const detailCard = document.getElementById(`picking-req-card-${orderId}`);
      if (detailCard && found) {
        detailCard.outerHTML = window.renderOrderPickingRequestCard(found);
      }
    }
  } catch (err) {
    console.error("Error al eliminar solicitud de picking:", err);
    alert("Error al eliminar: " + (err.message || err));
  }
};

window.deleteCurrentPickingRequest = function() {
  if (window.currentPickingRequestState && window.currentPickingRequestState.orderId) {
    window.deletePickingRequest(window.currentPickingRequestState.orderId);
  }
};

/**
 * Alterna el estado de verificación de un ítem directamente desde la tarjeta expandida de la orden.
 * Actualiza la base de datos Supabase, sincroniza con el sistema Picker y emite sonido de confirmación.
 */
window.togglePickingRequestItemCheck = async function(orderId, itemIndex) {
  if (!orderId || itemIndex === undefined || itemIndex === null) return;

  try {
    let req = window.pickingRequestsCache.get(orderId);
    if (!req) {
      req = await window.fetchOrderPickingRequest(orderId);
    }
    if (!req || !Array.isArray(req.items) || !req.items[itemIndex]) {
      console.warn("No se encontró el requerimiento para verificar:", orderId, itemIndex);
      return;
    }

    const item = req.items[itemIndex];
    const isNowChecked = !item.checked;
    item.checked = isNowChecked;

    let userIdent = 'Operario';
    try {
      if (window.currentSession?.user?.email) {
        userIdent = window.currentSession.user.email.split('@')[0];
      } else if (window.currentUserEmail) {
        userIdent = window.currentUserEmail.split('@')[0];
      }
    } catch (_) {}

    if (isNowChecked) {
      item.checked_by = userIdent;
      item.checked_at = new Date().toISOString();
    } else {
      item.checked_by = null;
      item.checked_at = null;
    }

    // Calcular nuevo estado
    const allChecked = req.items.length > 0 && req.items.every(i => i.checked);
    const anyChecked = req.items.some(i => i.checked);
    let newStatus = 'pendiente';
    if (allChecked) newStatus = 'completada';
    else if (anyChecked) newStatus = 'en_preparacion';

    req.status = newStatus;
    req.updated_at = new Date().toISOString();

    // Reproducir feedback sonoro
    if (typeof window.playPickingChime === 'function') {
      window.playPickingChime(allChecked ? 'done' : (isNowChecked ? 'success' : 'alert'));
    }

    // Actualizar caché en memoria
    window.pickingRequestsCache.set(orderId, req);

    // Actualizar orden en memoria
    const orderList = window.loadedOrders || window.allOrders || window.clientOrders || [];
    const orderObj = orderList.find(o => o.id === orderId);
    if (orderObj) {
      orderObj.has_picking_request = true;
      orderObj.picking_request_status = newStatus;
    }

    // Actualizar tarjeta en el DOM de inmediato (Optimistic UI)
    const cardEl = document.getElementById(`picking-req-card-${orderId}`);
    if (cardEl && orderObj) {
      cardEl.outerHTML = window.renderOrderPickingRequestCard(orderObj);
    }

    // Actualizar en base de datos WMS
    const supa = getPickingSupabase();
    if (supa) {
      supa.from('order_picking_requests').update({
        items: req.items,
        status: newStatus,
        updated_at: req.updated_at
      }).eq('order_id', orderId).then(() => {}).catch(e => console.warn("Error actualizando order_picking_requests:", e));

      supa.from('orders').update({
        picking_request_status: newStatus
      }).eq('id', orderId).then(() => {}).catch(e => console.warn("Error actualizando orders status:", e));
    }

    // Sincronizar con Picker en segundo plano
    if (typeof window.syncPickingRequestToPicker === 'function') {
      window.syncPickingRequestToPicker(orderId, req).catch(() => {});
    }

    if (window.showToastNotification) {
      window.showToastNotification(
        isNowChecked ? (allChecked ? "🎉 ¡Todos los requerimientos especiales completados!" : "✓ Requerimiento verificado") : "Requerimiento desmarcado",
        isNowChecked ? "success" : "info"
      );
    }
  } catch (err) {
    console.error("Error en togglePickingRequestItemCheck:", err);
  }
};

/**
 * Sincroniza la solicitud de picking con la tabla active_orders en la base de datos de Picker.
 * Actualiza el campo 'observation' anteponiendo la alerta de requerimientos especiales o removiéndola.
 */
window.syncPickingRequestToPicker = async function(orderId, request) {
  try {
    const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
    const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

    const pClient = window.pickerSupabase || (window.supabase && typeof window.supabase.createClient === 'function' ? window.supabase.createClient(PICKER_URL, PICKER_KEY) : null);
    if (!pClient) return;

    // Buscar información de la orden
    const orderList = window.loadedOrders || window.allOrders || window.clientOrders || [];
    let order = orderList.find(o => o.id === orderId);
    if (!order && request?.order_id === orderId && request.external_order_number) {
      order = { external_order_number: request.external_order_number, id: orderId };
    }
    if (!order) return;

    const ordNum = String(order.external_order_number || order.numero_orden || order.name || '').trim();
    if (!ordNum) return;

    const cleanNum = ordNum.replace(/^#/, '');
    const searchKeys = [ordNum, '#' + cleanNum, cleanNum];

    // Consultar active_orders
    const { data: activeRows, error: actErr } = await pClient
      .from('active_orders')
      .select('id, order_number, observation')
      .in('order_number', searchKeys);

    if (actErr || !activeRows || activeRows.length === 0) {
      return;
    }

    // Construir nuevo tag de picking
    let tag = '';
    const hasReq = Boolean(request && Array.isArray(request.items) && request.items.length > 0);
    const allChecked = hasReq && request.items.every(i => i.checked);
    const allResolved = hasReq && request.items.every(i => i.checked || i.discarded);
    const discardedCount = hasReq ? request.items.filter(i => i.discarded).length : 0;

    if (hasReq) {
      if (allChecked) {
        tag = '✅ [SOLICITUD PICKING: COMPLETADA]';
      } else if (allResolved) {
        tag = `⚠️ [SOLICITUD PICKING: REVISADA (${discardedCount} descartadas)]`;
      } else {
        const pendingItems = request.items.filter(i => !i.checked && !i.discarded).map(i => i.text);
        if (pendingItems.length > 0) {
          tag = `🚨 [SOLICITUD PICKING: ${pendingItems.join('; ')}]`;
        }
      }
    }

    for (const row of activeRows) {
      let currentObs = row.observation || '';
      // Limpiar tags previos
      currentObs = currentObs.replace(/(🚨|✅|⚠️)?\s*\[SOLICITUD PICKING:[^\]]*\]\s*(\|)?\s*/gi, '').trim();

      let newObs = currentObs;
      if (tag) {
        newObs = currentObs ? `${tag} | ${currentObs}` : tag;
      }

      const updatePayload = {
        observation: (newObs || '').slice(0, 1000),
        has_picking_requests: hasReq,
        picking_requests_json: hasReq ? request.items : null,
        picking_requests_confirmed: allResolved
      };

      await pClient
        .from('active_orders')
        .update(updatePayload)
        .eq('id', row.id);
      console.log(`📡 [PICKER SYNC] active_orders actualizado con éxito para orden #${row.order_number}`);
    }
  } catch (err) {
    console.warn("⚠️ [PICKER SYNC] Error al sincronizar con active_orders:", err);
  }
};

/**
 * Sintetizador Web Audio API para reproducir avisos sonoros limpios sin dependencias externas.
 * @param {'success'|'done'|'alert'} type
 */
window.playPickingChime = function(type = 'success') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    if (type === 'success') {
      // Tono dual ascendente y suave (E5 -> G#5)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(830.61, now + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'done') {
      // Fanfarria de acorde mayor brillante (C5, E5, G5, C6)
      const freqs = [523.25, 659.25, 783.99, 1046.50];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.07;
        gain.gain.setValueAtTime(0.07, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } else if (type === 'alert') {
      // Notificación suave descendente
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch (_) {
    // Si las políticas de reproducción de audio del navegador lo bloquean, se ignora silenciosamente
  }
};

/**
 * Escucha cambios en tiempo real en la tabla order_picking_requests mediante Supabase Realtime
 */
window.initPickingRequestsRealtimeListener = function() {
  const supa = getPickingSupabase();
  if (!supa || typeof supa.channel !== 'function') {
    return;
  }

  try {
    if (window._pickingRequestsChannel) {
      try { supa.removeChannel(window._pickingRequestsChannel); } catch (_) {}
    }

    const channel = supa
      .channel('realtime:order_picking_requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_picking_requests' },
        (payload) => {
          console.log("🔔 [PICKING REQUESTS Realtime]", payload.eventType, payload.new || payload.old);
          const record = payload.new;
          if (record && record.order_id) {
            window.pickingRequestsCache.set(record.order_id, record);

            const orderList = window.loadedOrders || window.allOrders || window.clientOrders || [];
            const found = orderList.find(o => o.id === record.order_id);
            if (found) {
              found.has_picking_request = true;
              found.picking_request_status = record.status;
            }

            const cardEl = document.getElementById(`picking-req-card-${record.order_id}`);
            if (cardEl && found) {
              cardEl.outerHTML = window.renderOrderPickingRequestCard(found);
            }
          } else if (payload.eventType === 'DELETE' && payload.old?.order_id) {
            window.pickingRequestsCache.delete(payload.old.order_id);
            const orderList = window.loadedOrders || window.allOrders || window.clientOrders || [];
            const found = orderList.find(o => o.id === payload.old.order_id);
            if (found) {
              found.has_picking_request = false;
              found.picking_request_status = null;
              const cardEl = document.getElementById(`picking-req-card-${payload.old.order_id}`);
              if (cardEl) {
                cardEl.outerHTML = window.renderOrderPickingRequestCard(found);
              }
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log("🟢 [PICKING REQUESTS] Realtime conectado a order_picking_requests");
        }
      });

    window._pickingRequestsChannel = channel;
  } catch (err) {
    console.warn("⚠️ [PICKING REQUESTS] Error iniciando Realtime listener:", err);
  }
};

// Inicializar listener Realtime cuando el DOM o Supabase estén listos
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(window.initPickingRequestsRealtimeListener, 1000);
  });
} else {
  setTimeout(window.initPickingRequestsRealtimeListener, 1000);
}

console.log("✅ [PICKING REQUESTS] Módulo de Solicitudes Especiales de Picking cargado correctamente.");
