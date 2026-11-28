// js/reverse_rma_manager.js - Gestión Integral de Solicitudes RMA (Aprobación Seller, Pagos, Visor Multimedia, Canales y Recepción QC)
import supabase from './supabase.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCLP(val) {
  return '$' + Math.round(Number(val) || 0).toLocaleString('es-CL');
}

export function getRmaWorkflowBadgeHtml(r) {
  const wf = String(r.workflow_status || '').toLowerCase();
  const payStatus = String(r.payment_status || '').toLowerCase();

  if (wf === 'solicitado') {
    return `<span class="badge" style="background:#f3e8ff;color:#6b21a8;border:1px solid #d8b4fe;font-weight:800;display:inline-flex;align-items:center;gap:4px;"><i class="ri-notification-badge-line"></i> Por Aprobar</span>`;
  }
  if (wf === 'esperando_pago') {
    if (payStatus === 'receipt_uploaded') {
      return `<span class="badge" style="background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;font-weight:800;display:inline-flex;align-items:center;gap:4px;"><i class="ri-file-check-line"></i> Validar Pago</span>`;
    }
    return `<span class="badge" style="background:#ffedd5;color:#c2410c;border:1px solid #fdba74;font-weight:800;display:inline-flex;align-items:center;gap:4px;"><i class="ri-bank-card-line"></i> Esperando Pago</span>`;
  }
  if (wf === 'aprobado_esperando_retorno') {
    return `<span class="badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><i class="ri-box-3-line"></i> Esperando Retorno</span>`;
  }
  if (wf === 'en_transito_retorno') {
    return `<span class="badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><i class="ri-truck-line"></i> En Tránsito a Ñuñoa</span>`;
  }
  if (wf === 'reemplazo_en_preparacion' || wf === 'cambio_en_preparacion') {
    return `<span class="badge" style="background:#dcfce7;color:#15803d;border:1px solid #86efac;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><i class="ri-flashlight-line"></i> Cambio en Picking</span>`;
  }
  if (wf === 'recibido_en_revision') {
    return `<span class="badge" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><i class="ri-search-eye-line"></i> En Revisión QC</span>`;
  }
  if (wf === 'rechazado' || wf === 'cancelado') {
    return `<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><i class="ri-close-circle-line"></i> ${wf === 'cancelado' ? 'Cancelado' : 'Rechazado'}</span>`;
  }
  if (wf === 'completado' || String(r.status || '').toLowerCase() === 'procesado') {
    return `<span class="badge" style="background:#d1fae5;color:#059669;border:1px solid #a7f3d0;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><i class="ri-checkbox-circle-line"></i> Completado</span>`;
  }
  return `<span class="badge" style="background:#fef3c7;color:#d97706;border:1px solid #fde68a;"><i class="ri-time-line"></i> Pendiente</span>`;
}

export function isPortalRmaRecord(r) {
  return Boolean(r && (r.rma_number || r.portal_origin === 'seller_portal' || r.portal_origin === 'stocka_global_portal' || r.portal_origin === 'stocka_global'));
}

function collectMediaStoragePaths(rma) {
  const paths = new Set();

  const scanVal = (val) => {
    if (!val) return;
    if (typeof val === 'string') {
      if (!val.startsWith('http://') && !val.startsWith('https://') && val.includes('/')) {
        paths.add(val);
      }
      return;
    }
    if (Array.isArray(val)) {
      val.forEach(scanVal);
      return;
    }
    if (typeof val === 'object') {
      if (val.storage_path && typeof val.storage_path === 'string') paths.add(val.storage_path);
      if (val.path && typeof val.path === 'string') paths.add(val.path);
      Object.values(val).forEach(scanVal);
    }
  };

  scanVal(rma?.request_form_answers);
  (Array.isArray(rma?.return_items) ? rma.return_items : []).forEach(it => {
    scanVal(it.media_files);
    scanVal(it.custom_fields_answers);
  });
  if (rma?.payment_receipt_url && !String(rma.payment_receipt_url).startsWith('http')) {
    paths.add(rma.payment_receipt_url);
  }
  return Array.from(paths);
}

async function refreshAllReturnsTables() {
  if (typeof window.fetchAndRenderReturnsData === 'function') {
    try { await window.fetchAndRenderReturnsData(); } catch (_) {}
  }
  if (typeof window.fetchAndRenderAdminReturnsData === 'function') {
    try { await window.fetchAndRenderAdminReturnsData(); } catch (_) {}
  }
}

export async function openBranchQrLookupModal() {
  const existing = document.getElementById('rma-qr-lookup-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'rma-qr-lookup-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px);';
  overlay.innerHTML = `
    <div style="background:var(--color-surface,#fff);border-radius:16px;max-width:480px;width:100%;padding:1.5rem;box-shadow:0 20px 50px rgba(0,0,0,0.25);border:1px solid var(--color-border,#e2e8f0);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="margin:0;font-size:1.1rem;font-weight:800;display:flex;align-items:center;gap:0.45rem;">
          <i class="ri-qr-scan-2-line" style="color:#5c24ff;font-size:1.3rem;"></i> Recepción Rápida · Punto Stocka Ñuñoa
        </h3>
        <button type="button" id="rma-qr-close" style="border:none;background:transparent;font-size:1.3rem;cursor:pointer;color:#64748b;">&times;</button>
      </div>
      <p style="font-size:0.83rem;color:var(--color-text-muted,#64748b);margin:0 0 0.9rem;">
        Escanea con pistola lectora el <strong>Pase QR</strong> del comprador o escribe su número de folio (<code>RMA-2026-...</code>) o pedido para abrir la ficha de inspección QC.
      </p>
      <div style="display:flex;gap:0.5rem;">
        <input type="text" id="rma-qr-input" class="form-input" placeholder="Ej: STK-RMA-... o RMA-2026-0001" style="flex:1;font-family:monospace;font-weight:700;">
        <button type="button" id="rma-qr-search-btn" class="btn btn-primary" style="background:#5c24ff;border-color:#5c24ff;font-weight:800;">
          <i class="ri-search-line"></i> Buscar
        </button>
      </div>
      <div id="rma-qr-msg" style="margin-top:0.75rem;font-size:0.8rem;color:#dc2626;display:none;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const inp = overlay.querySelector('#rma-qr-input');
  const msg = overlay.querySelector('#rma-qr-msg');
  const close = () => overlay.remove();
  overlay.querySelector('#rma-qr-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  setTimeout(() => inp?.focus(), 60);

  const runLookup = async () => {
    const code = (inp.value || '').trim();
    if (!code) return;
    msg.style.display = 'none';
    const { data, error } = await supabase
      .from('reverse_logistics')
      .select('id')
      .or(`qr_branch_token.ilike.${code},rma_number.ilike.${code},referencia_pedido.ilike.${code}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      msg.textContent = 'No se encontró ninguna solicitud RMA con ese código QR, folio o referencia.';
      msg.style.display = 'block';
      return;
    }
    close();
    openRmaManagementModal(data.id);
  };

  overlay.querySelector('#rma-qr-search-btn').addEventListener('click', runLookup);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') runLookup(); });
}

export async function openRmaManagementModal(rlId) {
  if (!rlId) return;
  const existing = document.getElementById('rma-mgmt-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'rma-mgmt-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px);overflow-y:auto;';
  overlay.innerHTML = `
    <div style="background:var(--color-surface,#fff);border-radius:16px;max-width:960px;width:100%;max-height:92vh;overflow-y:auto;padding:2rem;box-shadow:0 24px 60px rgba(0,0,0,0.28);">
      <div style="text-align:center;padding:2.5rem 1rem;">
        <i class="ri-loader-4-line ri-spin" style="font-size:2.2rem;color:#5c24ff;"></i>
        <div style="margin-top:0.65rem;font-weight:700;color:#475569;">Cargando expediente RMA y evidencia multimedia...</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  try {
    const { data: rma, error } = await supabase
      .from('reverse_logistics')
      .select('*')
      .eq('id', rlId)
      .single();
    if (error || !rma) throw new Error(error?.message || 'Solicitud RMA no encontrada.');

    const [{ data: portalCfg }, signedRes] = await Promise.all([
      supabase
        .from('seller_return_portal_configs')
        .select('channel_sync_mode, shopify_create_return, shopify_create_exchange_order, woocommerce_create_refund, woocommerce_create_replacement_order, woocommerce_add_order_notes, auto_generate_enviame_label')
        .ilike('comercio', rma.comercio || '')
        .maybeSingle(),
      (async () => {
        const paths = collectMediaStoragePaths(rma);
        if (paths.length === 0) return { urls: {} };
        const { data } = await supabase.functions.invoke('reverse-channel-sync', {
          body: { action: 'get_signed_media_urls', rl_id: rma.id, paths }
        });
        return data || { urls: {} };
      })()
    ]);

    const signedUrls = signedRes?.urls || {};
    renderRmaModalBody(overlay, rma, portalCfg || {}, signedUrls);
  } catch (err) {
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:1.5rem;">
        <h3 style="margin:0 0 0.5rem;color:#dc2626;">Error al cargar RMA</h3>
        <p style="font-size:0.85rem;color:#475569;">${escapeHtml(err.message || err)}</p>
        <button type="button" class="btn btn-outline" onclick="document.getElementById('rma-mgmt-modal-overlay')?.remove()">Cerrar</button>
      </div>
    `;
  }
}

function resolveEntryUrl(entry, signedUrls) {
  if (!entry) return '';
  const p = typeof entry === 'string' ? entry : (entry.storage_path || entry.path || entry.url || '');
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return signedUrls[p] || '';
}

function renderMediaGalleryHtml(mediaList, signedUrls) {
  if (!Array.isArray(mediaList) || mediaList.length === 0) return '';
  return `
    <div style="display:flex;gap:0.55rem;flex-wrap:wrap;margin-top:0.4rem;">
      ${mediaList.map(m => {
        const url = resolveEntryUrl(m, signedUrls);
        if (!url) return '';
        const mime = String(m.mime_type || m.mime || '').toLowerCase();
        const pathStr = String(m.storage_path || m.path || m.name || url).toLowerCase();
        if (mime.startsWith('video') || /\.(mp4|mov|webm)$/i.test(pathStr)) {
          return `<video src="${escapeHtml(url)}" controls preload="metadata" style="max-width:290px;max-height:190px;border-radius:10px;border:1px solid #cbd5e1;background:#000;"></video>`;
        }
        if (mime.includes('pdf') || /\.pdf$/i.test(pathStr)) {
          return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:0.35rem;padding:0.45rem 0.75rem;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;font-size:0.78rem;font-weight:700;color:#2563eb;"><i class="ri-file-pdf-2-line"></i> ${escapeHtml(m.name || 'Ver PDF')}</a>`;
        }
        return `
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Clic para ampliar foto" style="display:block;width:84px;height:84px;border-radius:9px;overflow:hidden;border:1px solid #cbd5e1;background:#f8fafc;">
            <img src="${escapeHtml(url)}" alt="Evidencia" style="width:100%;height:100%;object-fit:cover;">
          </a>
        `;
      }).join('')}
    </div>
  `;
}

function renderAnswerValueHtml(fieldDef, rawVal, signedUrls) {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    return `<span style="color:#94a3b8;font-style:italic;font-size:0.78rem;">Sin respuesta</span>`;
  }

  if (Array.isArray(rawVal) && rawVal[0] && (rawVal[0].storage_path || rawVal[0].path)) {
    return renderMediaGalleryHtml(rawVal, signedUrls);
  }
  if (typeof rawVal === 'object' && !Array.isArray(rawVal) && (rawVal.storage_path || rawVal.path)) {
    return renderMediaGalleryHtml([rawVal], signedUrls);
  }

  const type = fieldDef?.type || '';
  if (type === 'bank_details_cl' || (typeof rawVal === 'object' && !Array.isArray(rawVal) && (rawVal.bank || rawVal.account_number || rawVal.rut))) {
    const bankSummary = `${rawVal.bank || '-'} | ${rawVal.account_type || '-'} | N° ${rawVal.account_number || '-'} | RUT ${rawVal.rut || '-'} | ${rawVal.holder_name || rawVal.holder || '-'} | ${rawVal.email || ''}`;
    return `
      <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:0.6rem 0.8rem;margin-top:0.3rem;font-size:0.78rem;line-height:1.45;">
        <div><strong>Banco:</strong> ${escapeHtml(rawVal.bank || '-')} · <strong>Tipo:</strong> ${escapeHtml(rawVal.account_type || '-')}</div>
        <div><strong>N° Cuenta:</strong> <code>${escapeHtml(rawVal.account_number || '-')}</code> · <strong>RUT:</strong> <code>${escapeHtml(rawVal.rut || '-')}</code></div>
        <div><strong>Titular:</strong> ${escapeHtml(rawVal.holder_name || rawVal.holder || '-')} ${rawVal.email ? `(${escapeHtml(rawVal.email)})` : ''}</div>
        <button type="button" class="btn btn-outline rma-copy-bank" data-bank="${escapeHtml(bankSummary)}" style="margin-top:0.4rem;padding:2px 8px;font-size:0.72rem;">
          <i class="ri-file-copy-line"></i> Copiar Datos Bancarios
        </button>
      </div>
    `;
  }

  if (typeof rawVal === 'boolean') {
    return rawVal
      ? `<span style="color:#059669;font-weight:700;"><i class="ri-checkbox-circle-fill"></i> Confirmado por el comprador</span>`
      : `<span style="color:#dc2626;">No confirmado</span>`;
  }

  return `<span style="font-size:0.82rem;color:#0f172a;font-weight:600;">${escapeHtml(typeof rawVal === 'object' ? JSON.stringify(rawVal) : String(rawVal))}</span>`;
}

function renderRmaModalBody(overlay, rma, portalCfg, signedUrls) {
  const wf = String(rma.workflow_status || 'solicitado').toLowerCase();
  const resType = rma.resolution_type || (rma.tipo_movimiento === 'CAMBIO' ? 'exchange' : 'return');
  const resLabel = resType === 'exchange' ? 'Cambio de Producto' : (resType === 'store_credit' ? 'Crédito / Cupón en Tienda' : 'Devolución de Dinero');

  let editableExchangeItems = JSON.parse(JSON.stringify(Array.isArray(rma.exchange_items) ? rma.exchange_items : [])).map(ex => ({
    ...ex,
    qty: Number(ex.qty ?? ex.quantity ?? 1),
    effective_unit_price: Number(ex.effective_unit_price ?? ex.catalog_unit_price ?? ex.unit_price ?? 0),
    catalog_unit_price: Number(ex.catalog_unit_price ?? ex.effective_unit_price ?? ex.unit_price ?? 0)
  }));

  const returnItems = Array.isArray(rma.return_items) && rma.return_items.length > 0
    ? rma.return_items
    : (Array.isArray(rma.productos) ? rma.productos.map(p => ({
        product_id: p.id_devuelto || p.product_id || null,
        sku: p.sku || p.sku_devuelto || '',
        name: p.producto_devuelto || p.name || 'Producto',
        qty: Number(p.qty_devuelto || p.cantidad || 1),
        paid_unit_price: 0,
        reason_label: p.comentario || p.motivo || '',
        return_to_stock: p.regresar_a_inventario !== false
      })) : []);

  const schemaSnapshot = Array.isArray(rma.form_schema_snapshot) ? rma.form_schema_snapshot : [];
  const schemaMap = {};
  schemaSnapshot.forEach(f => { if (f && f.id) schemaMap[f.id] = f; });

  const rawFormAnswers = rma.request_form_answers || {};
  const perRequestAnswers = rawFormAnswers.per_request || rawFormAnswers;

  const fin = rma.financial_summary || {};
  const logOptStr = typeof rma.logistics_option === 'string' ? rma.logistics_option : (rma.logistics_option?.id || rma.modo_entrega || 'sucursal_nunoa');
  const receiptUrl = resolveEntryUrl(rma.payment_receipt_url, signedUrls);

  const canApproveOrReject = wf === 'solicitado';
  const canMarkPaid = (wf === 'esperando_pago' || rma.payment_status === 'pending' || rma.payment_status === 'receipt_uploaded') && rma.payment_status !== 'paid' && rma.payment_status !== 'waived';
  const canInspectQc = !rma.inventory_restocked && String(rma.status || '').toLowerCase() !== 'procesado' && (
    ['aprobado_esperando_retorno', 'en_transito_retorno', 'recibido_en_revision', 'reemplazo_en_preparacion', 'cambio_en_preparacion'].includes(wf)
    || (!isPortalRmaRecord(rma) && wf === 'pendiente')
  );

  const renderModalContent = () => {
    const recalcExchangeSubtotal = editableExchangeItems.reduce((acc, it) => acc + (Number(it.effective_unit_price || 0) * Number(it.qty || 1)), 0);
    const creditTotal = Number(fin.credit_total || 0);
    const shipFee = Number(fin.shipping_fee_buyer ?? rma.costo_envio ?? 0);
    const rawDiff = (resType === 'exchange' ? (recalcExchangeSubtotal - creditTotal) : 0) + shipFee;
    const computedOwes = !canApproveOrReject && fin.buyer_owes_amount !== undefined
      ? Number(fin.buyer_owes_amount || 0)
      : Math.max(0, Math.round(rawDiff));

    const returnItemsHtml = returnItems.map((it) => {
      const qtyVal = Number(it.qty ?? it.quantity ?? 1);
      const customAns = it.custom_fields_answers || {};
      const mediaFiles = Array.isArray(it.media_files) ? it.media_files : [];

      // Agrupar media_files por field_id
      const mediaByField = {};
      mediaFiles.forEach(m => {
        const fid = m.field_id || 'evidencia';
        if (!mediaByField[fid]) mediaByField[fid] = [];
        mediaByField[fid].push(m);
      });

      const customAnsHtml = Object.entries(customAns).map(([fid, val]) => {
        const fDef = schemaMap[fid] || { id: fid, label: fid };
        return `
          <div style="margin-top:0.45rem;padding-top:0.45rem;border-top:1px dashed #e2e8f0;">
            <div style="font-size:0.74rem;font-weight:700;color:#475569;">${escapeHtml(fDef.label || fid)}</div>
            ${renderAnswerValueHtml(fDef, val, signedUrls)}
          </div>
        `;
      }).join('');

      const mediaByFieldHtml = Object.entries(mediaByField).map(([fid, list]) => {
        const fDef = schemaMap[fid] || { id: fid, label: 'Evidencia multimedia adjunta' };
        return `
          <div style="margin-top:0.45rem;padding-top:0.45rem;border-top:1px dashed #e2e8f0;">
            <div style="font-size:0.74rem;font-weight:700;color:#475569;">${escapeHtml(fDef.label || fid)}</div>
            ${renderMediaGalleryHtml(list, signedUrls)}
          </div>
        `;
      }).join('');

      return `
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:0.85rem;background:#fff;margin-bottom:0.65rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
            <div style="display:flex;gap:0.7rem;align-items:center;">
              ${it.image_url ? `<img src="${escapeHtml(it.image_url)}" alt="" style="width:46px;height:46px;border-radius:8px;object-fit:cover;border:1px solid #e2e8f0;">` : ''}
              <div>
                <div style="font-weight:800;font-size:0.88rem;color:#0f172a;">${qtyVal}x ${escapeHtml(it.name || 'Producto')}</div>
                <div style="font-size:0.75rem;color:#64748b;font-family:monospace;">SKU: ${escapeHtml(it.sku || 'S/SKU')} ${it.paid_unit_price ? `· Pagado c/u: ${formatCLP(it.paid_unit_price)}` : ''}</div>
              </div>
            </div>
            ${it.reason_label ? `
              <span style="font-size:0.73rem;font-weight:700;padding:3px 9px;border-radius:99px;background:${it.is_fault ? '#fee2e2' : '#f1f5f9'};color:${it.is_fault ? '#b91c1c' : '#334155'};">
                ${it.is_fault ? '<i class="ri-alert-line"></i> ' : ''}${escapeHtml(it.reason_label)}
              </span>
            ` : ''}
          </div>
          ${customAnsHtml}
          ${mediaByFieldHtml}
        </div>
      `;
    }).join('');

    const perRequestAnswersHtml = Object.entries(perRequestAnswers)
      .filter(([k]) => k !== 'per_item' && k !== 'per_request')
      .map(([fid, val]) => {
        const fDef = schemaMap[fid] || { id: fid, label: fid };
        return `
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:0.75rem 0.9rem;background:#fff;margin-bottom:0.5rem;">
            <div style="font-size:0.76rem;font-weight:800;color:#334155;">${escapeHtml(fDef.label || fid)}</div>
            ${renderAnswerValueHtml(fDef, val, signedUrls)}
          </div>
        `;
      }).join('');

    const exchangeRowsHtml = editableExchangeItems.map((ex, idx) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.65rem;padding:0.6rem 0.8rem;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:9px;margin-bottom:0.45rem;">
        <div>
          <div style="font-weight:800;font-size:0.84rem;color:#065f46;">➡️ ${escapeHtml(ex.name || ex.sku)}</div>
          <div style="font-size:0.73rem;color:#047857;font-family:monospace;">SKU: ${escapeHtml(ex.sku || '-')} · Valor: ${formatCLP(ex.effective_unit_price || 0)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.4rem;">
          ${canApproveOrReject ? `
            <input type="number" class="form-input rma-ex-qty" data-exidx="${idx}" min="1" max="20" value="${Number(ex.qty || 1)}" style="width:66px;padding:4px 8px;font-weight:800;">
            <button type="button" class="btn btn-outline rma-ex-remove" data-exidx="${idx}" style="padding:4px 8px;color:#dc2626;border-color:#fca5a5;"><i class="ri-delete-bin-line"></i></button>
          ` : `<strong style="font-size:0.88rem;color:#065f46;">x${Number(ex.qty || 1)}</strong>`}
        </div>
      </div>
    `).join('');

    const autoSyncDefault = portalCfg.channel_sync_mode === 'auto_on_approve';

    overlay.innerHTML = `
      <div style="background:var(--color-surface,#fff);border-radius:16px;max-width:960px;width:100%;max-height:92vh;overflow-y:auto;padding:1.6rem;box-shadow:0 24px 60px rgba(0,0,0,0.28);border:1px solid var(--color-border,#e2e8f0);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;padding-bottom:1rem;border-bottom:1px solid #e2e8f0;">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.35rem;">
              <span style="font-family:monospace;font-weight:800;font-size:0.9rem;background:#0f172a;color:#fff;padding:3px 10px;border-radius:7px;">
                ${escapeHtml(rma.rma_number || rma.id.slice(0, 8))}
              </span>
              ${getRmaWorkflowBadgeHtml(rma)}
              <span style="font-size:0.75rem;font-weight:800;background:#ede9fe;color:#5b21b6;padding:3px 9px;border-radius:99px;">
                ${escapeHtml(resLabel)}
              </span>
              <span style="font-size:0.75rem;font-weight:700;color:#475569;">
                <i class="ri-store-2-line"></i> ${escapeHtml(rma.comercio || '-')}
              </span>
            </div>
            <h3 style="margin:0;font-size:1.18rem;font-weight:800;color:#0f172a;">
              Pedido Ref. #${escapeHtml(rma.referencia_pedido || 'S/R')} · ${escapeHtml(rma.customer_name || 'Comprador')}
            </h3>
            <div style="font-size:0.78rem;color:#64748b;margin-top:3px;display:flex;gap:0.85rem;flex-wrap:wrap;">
              ${rma.customer_email ? `<span><i class="ri-mail-line"></i> ${escapeHtml(rma.customer_email)}</span>` : ''}
              ${rma.customer_phone ? `<span><i class="ri-phone-line"></i> ${escapeHtml(rma.customer_phone)}</span>` : ''}
              ${rma.shipping_city ? `<span><i class="ri-map-pin-line"></i> ${escapeHtml(rma.shipping_address || '')}, ${escapeHtml(rma.shipping_city)}</span>` : ''}
            </div>
          </div>
          <button type="button" id="rma-mgmt-close" style="border:none;background:#f1f5f9;width:34px;height:34px;border-radius:50%;font-size:1.2rem;cursor:pointer;color:#334155;">&times;</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(390px,1fr));gap:1.15rem;margin-top:1.15rem;">
          <div>
            <h4 style="font-size:0.88rem;font-weight:800;color:#0f172a;margin:0 0 0.6rem;display:flex;align-items:center;gap:0.4rem;">
              <i class="ri-camera-lens-line" style="color:#5c24ff;"></i> 1. Productos a Devolver y Evidencia Multimedia
            </h4>
            ${returnItemsHtml || '<div style="font-size:0.8rem;color:#64748b;">Sin ítems detallados.</div>'}

            ${perRequestAnswersHtml ? `
              <h4 style="font-size:0.85rem;font-weight:800;color:#0f172a;margin:0.95rem 0 0.5rem;">
                Respuestas Generales del Formulario
              </h4>
              ${perRequestAnswersHtml}
            ` : ''}

            ${rma.comentarios ? `
              <div style="margin-top:0.65rem;padding:0.65rem 0.8rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;font-size:0.78rem;color:#334155;">
                <strong>Comentarios / Resumen:</strong> ${escapeHtml(rma.comentarios)}
              </div>
            ` : ''}

            ${resType === 'exchange' ? `
              <div style="margin-top:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                  <h4 style="font-size:0.88rem;font-weight:800;color:#065f46;margin:0;">
                    <i class="ri-repeat-2-line"></i> 2. Productos de Reemplazo Solicitados
                  </h4>
                  ${canApproveOrReject ? `
                    <button type="button" id="rma-btn-add-sku" class="btn btn-outline" style="padding:3px 9px;font-size:0.74rem;font-weight:700;color:#059669;border-color:#6ee7b7;">
                      <i class="ri-add-line"></i> Agregar / Cambiar SKU
                    </button>
                  ` : ''}
                </div>
                <div id="rma-sku-picker-box" style="display:none;margin-bottom:0.6rem;padding:0.65rem;background:#f8fafc;border:1px solid #cbd5e1;border-radius:9px;"></div>
                ${exchangeRowsHtml || '<div style="font-size:0.8rem;color:#64748b;">Sin ítems de reemplazo seleccionados.</div>'}
              </div>
            ` : ''}
          </div>

          <div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:1rem;margin-bottom:0.9rem;">
              <h4 style="font-size:0.88rem;font-weight:800;color:#0f172a;margin:0 0 0.65rem;display:flex;align-items:center;gap:0.4rem;">
                <i class="ri-calculator-line" style="color:#2563eb;"></i> Resumen Financiero y Logístico
              </h4>
              <div style="font-size:0.8rem;display:flex;flex-direction:column;gap:0.32rem;">
                <div style="display:flex;justify-content:space-between;"><span>Valor reconocido ítems devueltos:</span><strong>${formatCLP(creditTotal)}</strong></div>
                ${resType === 'exchange' ? `<div style="display:flex;justify-content:space-between;"><span>Subtotal ítems reemplazo:</span><strong>${formatCLP(recalcExchangeSubtotal)}</strong></div>` : ''}
                <div style="display:flex;justify-content:space-between;"><span>Cargo logístico (${escapeHtml(rma.transporte || logOptStr)}):</span><strong>${formatCLP(shipFee)}</strong></div>
                <div style="display:flex;justify-content:space-between;padding-top:0.45rem;margin-top:0.25rem;border-top:1px solid #cbd5e1;font-size:0.88rem;">
                  <span><strong>Diferencia a pagar por comprador:</strong></span>
                  <strong style="color:${computedOwes > 0 ? '#c2410c' : '#059669'};">${formatCLP(computedOwes)}</strong>
                </div>
                ${Number(fin.refund_final || 0) > 0 && resType === 'return' ? `
                  <div style="display:flex;justify-content:space-between;color:#0f172a;font-weight:800;">
                    <span>Monto neto a reembolsar al cliente:</span>
                    <span>${formatCLP(fin.refund_final)}</span>
                  </div>
                ` : ''}
                ${Number(fin.store_credit_final || 0) > 0 ? `
                  <div style="display:flex;justify-content:space-between;color:#065f46;font-weight:800;">
                    <span>Cupón Crédito en Tienda (+bono):</span>
                    <span>${formatCLP(fin.store_credit_final)}</span>
                  </div>
                ` : ''}
              </div>

              ${receiptUrl ? `
                <div style="margin-top:0.7rem;padding:0.6rem 0.8rem;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:0.78rem;font-weight:700;color:#1e40af;"><i class="ri-attachment-2"></i> Comprobante subido por el cliente</span>
                  <a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener" style="font-size:0.78rem;font-weight:800;color:#2563eb;">Ver Comprobante &rarr;</a>
                </div>
              ` : ''}

              ${canMarkPaid && !canApproveOrReject ? `
                <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px dashed #cbd5e1;">
                  <input type="text" id="rma-pay-notes" class="form-input" placeholder="Nota de pago opcional (ej. Transferencia verificada)" style="font-size:0.78rem;margin-bottom:0.5rem;">
                  <button type="button" id="rma-btn-mark-paid" class="btn btn-primary" style="width:100%;background:#2563eb;border-color:#2563eb;font-weight:800;">
                    <i class="ri-check-double-line"></i> Confirmar y Marcar como Pagado en Stocka
                  </button>
                </div>
              ` : ''}
            </div>

            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:0.9rem 1rem;margin-bottom:0.9rem;font-size:0.8rem;">
              <div><strong>Modalidad:</strong> ${escapeHtml(rma.transporte || logOptStr)}</div>
              ${rma.qr_branch_token ? `<div style="margin-top:4px;"><strong>Pase QR Punto Stocka Ñuñoa:</strong> <code>${escapeHtml(rma.qr_branch_token)}</code></div>` : ''}
              ${rma.inbound_tracking_number ? `<div style="margin-top:4px;"><strong>Tracking Retorno (${escapeHtml(rma.inbound_courier || 'Courier')}):</strong> <code>${escapeHtml(rma.inbound_tracking_number)}</code></div>` : ''}
              ${rma.inbound_label_url ? `<div style="margin-top:6px;"><a href="${escapeHtml(rma.inbound_label_url)}" target="_blank" rel="noopener" style="font-weight:800;color:#5c24ff;"><i class="ri-printer-line"></i> Descargar Etiqueta Reversa PDF</a></div>` : ''}
              ${rma.channel_sync_result && Object.keys(rma.channel_sync_result).length > 0 ? `
                <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0;font-size:0.74rem;color:#059669;">
                  <i class="ri-plug-line"></i> <strong>Canal sincronizado:</strong> ${escapeHtml(Object.keys(rma.channel_sync_result).join(', '))}
                </div>
              ` : ''}
            </div>

            ${canApproveOrReject ? `
              <div style="background:#faf5ff;border:1.5px solid #d8b4fe;border-radius:12px;padding:1rem;margin-bottom:0.9rem;">
                <h4 style="font-size:0.9rem;font-weight:800;color:#581c87;margin:0 0 0.65rem;">
                  <i class="ri-shield-check-line"></i> Decisión del Comercio (Reserva Stock al Aprobar)
                </h4>

                <div style="margin-bottom:0.65rem;">
                  <label style="font-size:0.75rem;font-weight:700;color:#475569;display:block;margin-bottom:3px;">Monto a cobrar al comprador (CLP — editable):</label>
                  <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
                    <input type="number" id="rma-owes-override" class="form-input" min="0" step="100" value="${computedOwes}" style="width:135px;padding:4px 8px;font-weight:800;">
                    <label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.76rem;font-weight:700;color:#9a3412;cursor:pointer;">
                      <input type="checkbox" id="rma-chk-waive-owes" style="accent-color:#ea580c;">
                      Eximir cobro ($0)
                    </label>
                  </div>
                </div>

                ${portalCfg.channel_sync_mode !== 'none' ? `
                  <div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.7rem;padding:0.6rem;background:#fff;border-radius:8px;border:1px solid #e9d5ff;">
                    <label style="display:flex;align-items:center;gap:0.45rem;font-size:0.78rem;font-weight:700;cursor:pointer;">
                      <input type="checkbox" id="rma-chk-shopify" ${(portalCfg.shopify_create_return && autoSyncDefault) ? 'checked' : ''} style="accent-color:#16a34a;">
                      Sincronizar con Shopify (Return oficial / Tag / Cupón)
                    </label>
                    <label style="display:flex;align-items:center;gap:0.45rem;font-size:0.78rem;font-weight:700;cursor:pointer;">
                      <input type="checkbox" id="rma-chk-woo" ${(portalCfg.woocommerce_add_order_notes && autoSyncDefault) ? 'checked' : ''} style="accent-color:#7c3aed;">
                      Sincronizar con WooCommerce (Nota / Cupón / Orden $0)
                    </label>
                    ${logOptStr === 'regiones_courier' ? `
                      <label style="display:flex;align-items:center;gap:0.45rem;font-size:0.78rem;font-weight:700;color:#1e40af;cursor:pointer;">
                        <input type="checkbox" id="rma-chk-enviame" ${portalCfg.auto_generate_enviame_label !== false ? 'checked' : ''} style="accent-color:#2563eb;">
                        Emitir etiqueta reversa courier vía Envíame API
                      </label>
                    ` : ''}
                  </div>
                ` : ''}

                <textarea id="rma-seller-notes" class="form-input" rows="2" placeholder="Mensaje opcional para el comprador (visible en su correo y portal)..." style="font-size:0.8rem;margin-bottom:0.7rem;">${escapeHtml(rma.seller_notes || '')}</textarea>

                <div style="display:flex;gap:0.5rem;">
                  <button type="button" id="rma-btn-approve" class="btn btn-primary" style="flex:1.4;background:#059669;border-color:#059669;font-weight:800;">
                    <i class="ri-check-line"></i> Aprobar Solicitud
                  </button>
                  <button type="button" id="rma-btn-reject" class="btn btn-outline" style="flex:1;color:#dc2626;border-color:#fca5a5;font-weight:700;">
                    <i class="ri-close-line"></i> Rechazar
                  </button>
                </div>
              </div>
            ` : ''}

            ${canInspectQc ? `
              <div style="background:#ecfdf5;border:1.5px solid #6ee7b7;border-radius:12px;padding:1rem;">
                <h4 style="font-size:0.9rem;font-weight:800;color:#065f46;margin:0 0 0.6rem;">
                  <i class="ri-checkbox-multiple-line"></i> Recepción Física y Control de Calidad (Matriz Ñuñoa)
                </h4>
                <p style="font-size:0.75rem;color:#047857;margin:0 0 0.65rem;">
                  Clasifica el estado físico de cada ítem recibido. Si hay una orden de reemplazo retenida esperando este retorno, se liberará automáticamente a Picking.
                </p>

                ${returnItems.map((it, i) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.5rem 0.65rem;background:#fff;border:1px solid #a7f3d0;border-radius:8px;margin-bottom:0.4rem;">
                    <span style="font-size:0.78rem;font-weight:700;">${Number(it.qty ?? it.quantity ?? 1)}x ${escapeHtml(it.sku || it.name)}</span>
                    <select class="form-input rma-qc-disp" data-qcidx="${i}" data-pid="${escapeHtml(it.product_id || '')}" data-sku="${escapeHtml(it.sku || '')}" style="width:auto;padding:3px 8px;font-size:0.76rem;font-weight:700;">
                      <option value="restock" ${it.return_to_stock !== false ? 'selected' : ''}>✅ Apto · Sumar a Stock Vendible</option>
                      <option value="quarantine" ${it.return_to_stock === false ? 'selected' : ''}>⚠️ Merma / Dañado · Enviar a Cuarentena</option>
                    </select>
                  </div>
                `).join('')}

                ${resType === 'return' ? `
                  <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.76rem;font-weight:700;color:#065f46;margin:0.5rem 0;cursor:pointer;">
                    <input type="checkbox" id="rma-qc-woo-refund" ${portalCfg.woocommerce_create_refund ? 'checked' : ''}> Registrar reembolso contable en WooCommerce (si aplica)
                  </label>
                ` : ''}

                <textarea id="rma-qc-notes" class="form-input" rows="2" placeholder="Observaciones de recepción / control de calidad..." style="font-size:0.78rem;margin-top:0.45rem;margin-bottom:0.65rem;"></textarea>

                <button type="button" id="rma-btn-complete-qc" class="btn btn-primary" style="width:100%;background:#059669;border-color:#059669;font-weight:800;">
                  <i class="ri-inbox-archive-line"></i> Confirmar Recepción QC y Actualizar Inventario WMS
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    overlay.querySelector('#rma-mgmt-close')?.addEventListener('click', () => overlay.remove());

    overlay.querySelectorAll('.rma-copy-bank').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute('data-bank') || '');
          btn.innerHTML = '<i class="ri-check-line"></i> Copiado';
        } catch (_) {}
      });
    });

    overlay.querySelectorAll('.rma-ex-qty').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.getAttribute('data-exidx'));
        if (editableExchangeItems[idx]) {
          editableExchangeItems[idx].qty = Math.max(1, parseInt(inp.value, 10) || 1);
          editableExchangeItems[idx].line_total = editableExchangeItems[idx].qty * Number(editableExchangeItems[idx].effective_unit_price || 0);
          renderModalContent();
        }
      });
    });

    overlay.querySelectorAll('.rma-ex-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-exidx'));
        editableExchangeItems.splice(idx, 1);
        renderModalContent();
      });
    });

    const addSkuBtn = overlay.querySelector('#rma-btn-add-sku');
    if (addSkuBtn) {
      addSkuBtn.addEventListener('click', async () => {
        const box = overlay.querySelector('#rma-sku-picker-box');
        if (!box) return;
        box.style.display = 'block';
        box.innerHTML = `<div style="font-size:0.76rem;color:#64748b;">Cargando catálogo de ${escapeHtml(rma.comercio)}...</div>`;
        const { data: prods } = await supabase
          .from('products')
          .select('id, sku, name, price, client_name')
          .ilike('client_name', rma.comercio || '')
          .limit(250);

        if (!prods || prods.length === 0) {
          box.innerHTML = `<div style="font-size:0.76rem;color:#dc2626;">No se encontraron productos para este comercio.</div>`;
          return;
        }
        box.innerHTML = `
          <div style="display:flex;gap:0.4rem;">
            <select id="rma-pick-prod-sel" class="form-input" style="flex:1;font-size:0.78rem;padding:4px 8px;">
              ${prods.map(p => `<option value="${p.id}" data-sku="${escapeHtml(p.sku || '')}" data-name="${escapeHtml(p.name || '')}" data-price="${Number(p.price || 0)}">${escapeHtml(p.sku || 'S/SKU')} - ${escapeHtml(p.name)} (${formatCLP(p.price || 0)})</option>`).join('')}
            </select>
            <button type="button" id="rma-pick-prod-confirm" class="btn btn-primary" style="padding:4px 10px;font-size:0.78rem;background:#059669;border-color:#059669;">Agregar</button>
          </div>
        `;
        box.querySelector('#rma-pick-prod-confirm')?.addEventListener('click', () => {
          const sel = box.querySelector('#rma-pick-prod-sel');
          const opt = sel?.options[sel.selectedIndex];
          if (!opt) return;
          const unitP = Number(opt.getAttribute('data-price') || 0);
          editableExchangeItems.push({
            product_id: opt.value,
            sku: opt.getAttribute('data-sku') || '',
            name: opt.getAttribute('data-name') || '',
            catalog_unit_price: unitP,
            effective_unit_price: unitP,
            line_total: unitP,
            qty: 1
          });
          renderModalContent();
        });
      });
    }

    const approveBtn = overlay.querySelector('#rma-btn-approve');
    if (approveBtn) {
      approveBtn.addEventListener('click', async () => {
        approveBtn.disabled = true;
        approveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Aprobando y reservando...';
        try {
          const waive = Boolean(overlay.querySelector('#rma-chk-waive-owes')?.checked);
          const owesOverrideVal = overlay.querySelector('#rma-owes-override')?.value;
          const syncShopify = Boolean(overlay.querySelector('#rma-chk-shopify')?.checked);
          const syncWoo = Boolean(overlay.querySelector('#rma-chk-woo')?.checked);
          const genEnviame = overlay.querySelector('#rma-chk-enviame') ? Boolean(overlay.querySelector('#rma-chk-enviame').checked) : true;
          const sellerNotes = overlay.querySelector('#rma-seller-notes')?.value || '';

          const { data, error } = await supabase.functions.invoke('reverse-channel-sync', {
            body: {
              action: 'approve_rma',
              rl_id: rma.id,
              exchange_items: resType === 'exchange' ? editableExchangeItems : undefined,
              waive_payment: waive,
              buyer_owes_override: owesOverrideVal !== undefined ? Number(owesOverrideVal) : undefined,
              seller_notes: sellerNotes,
              generate_enviame_label: genEnviame,
              channel_sync: {
                sync_shopify: syncShopify,
                sync_woocommerce: syncWoo,
                create_return: portalCfg.shopify_create_return !== false,
                create_exchange_items: Boolean(portalCfg.shopify_create_exchange_order),
                add_notes: true,
                create_replacement_order: Boolean(portalCfg.woocommerce_create_replacement_order)
              }
            }
          });
          if (error || data?.error) throw new Error(data?.error || error?.message || 'Error al aprobar RMA');

          overlay.remove();
          await refreshAllReturnsTables();
          alert(data?.workflow_status === 'esperando_pago'
            ? 'Solicitud pre-aprobada y stock reservado en WMS. Se enviaron las instrucciones de pago al comprador.'
            : '¡Solicitud RMA aprobada exitosamente! El stock y las instrucciones logísticas ya están activas.');
        } catch (err) {
          alert('No se pudo aprobar la solicitud: ' + (err.message || err));
          approveBtn.disabled = false;
          approveBtn.innerHTML = '<i class="ri-check-line"></i> Aprobar Solicitud';
        }
      });
    }

    const rejectBtn = overlay.querySelector('#rma-btn-reject');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', async () => {
        const reason = window.prompt('Indica el motivo de rechazo que recibirá el comprador:', 'El producto no cumple las condiciones de nuestra política de cambios.');
        if (!reason) return;
        rejectBtn.disabled = true;
        try {
          const { data, error } = await supabase.functions.invoke('reverse-channel-sync', {
            body: { action: 'reject_rma', rl_id: rma.id, rejection_reason: reason }
          });
          if (error || data?.error) throw new Error(data?.error || error?.message);
          overlay.remove();
          await refreshAllReturnsTables();
          alert('Solicitud RMA rechazada y notificada al comprador.');
        } catch (err) {
          alert('Error al rechazar: ' + (err.message || err));
          rejectBtn.disabled = false;
        }
      });
    }

    const markPaidBtn = overlay.querySelector('#rma-btn-mark-paid');
    if (markPaidBtn) {
      markPaidBtn.addEventListener('click', async () => {
        markPaidBtn.disabled = true;
        markPaidBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Confirmando pago...';
        try {
          const notes = overlay.querySelector('#rma-pay-notes')?.value || '';
          const { data, error } = await supabase.functions.invoke('reverse-channel-sync', {
            body: { action: 'mark_rma_paid', rl_id: rma.id, payment_notes: notes }
          });
          if (error || data?.error) throw new Error(data?.error || error?.message);
          overlay.remove();
          await refreshAllReturnsTables();
          alert('Pago confirmado exitosamente en Stocka. El flujo logístico de la solicitud ha sido liberado.');
        } catch (err) {
          alert('Error al confirmar pago: ' + (err.message || err));
          markPaidBtn.disabled = false;
          markPaidBtn.innerHTML = '<i class="ri-check-double-line"></i> Confirmar y Marcar como Pagado en Stocka';
        }
      });
    }

    const qcBtn = overlay.querySelector('#rma-btn-complete-qc');
    if (qcBtn) {
      qcBtn.addEventListener('click', async () => {
        qcBtn.disabled = true;
        qcBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Procesando ingreso WMS...';
        try {
          const itemsQc = [];
          overlay.querySelectorAll('.rma-qc-disp').forEach(sel => {
            itemsQc.push({
              product_id: sel.getAttribute('data-pid') || null,
              sku: sel.getAttribute('data-sku') || '',
              return_to_stock: sel.value === 'restock'
            });
          });
          const qcNotes = overlay.querySelector('#rma-qc-notes')?.value || '';
          const executeWooRefund = Boolean(overlay.querySelector('#rma-qc-woo-refund')?.checked);

          const { data, error } = await supabase.functions.invoke('reverse-channel-sync', {
            body: {
              action: 'complete_qc_inspection',
              rl_id: rma.id,
              items_qc: itemsQc,
              qc_notes: qcNotes,
              execute_woo_refund: executeWooRefund,
              mark_counter_delivered: logOptStr === 'sucursal_nunoa' || logOptStr === 'sucursal'
            }
          });
          if (error || data?.error) throw new Error(data?.error || error?.message);
          overlay.remove();
          await refreshAllReturnsTables();
          alert('Recepción QC completada exitosamente. El inventario WMS fue actualizado y cualquier orden de cambio retenida pasó a Picking.');
        } catch (err) {
          alert('Error en recepción QC: ' + (err.message || err));
          qcBtn.disabled = false;
          qcBtn.innerHTML = '<i class="ri-inbox-archive-line"></i> Confirmar Recepción QC y Actualizar Inventario WMS';
        }
      });
    }
  };

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  renderModalContent();
}

window.openRmaManagementModal = openRmaManagementModal;
window.openBranchQrLookupModal = openBranchQrLookupModal;
window.getRmaWorkflowBadgeHtml = getRmaWorkflowBadgeHtml;
window.isPortalRmaRecord = isPortalRmaRecord;
