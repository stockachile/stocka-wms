import supabase from './supabase.js';

export const OFFICIAL_COLABORADORES_EMAILS = [
  'felipe.trup@gmail.com',
  'fratruper@gmail.com',
  'kyria.oyarcep@gmail.com',
  'stockachile@gmail.com'
];

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function isUUID(str) {
  return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export async function renderIdentityQRAdmin(targetContainer) {
  const container = targetContainer || document.getElementById('app-content');
  if (!container) return;

  injectStyles();

  // Mostrar loader inicial
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 350px; padding: 2rem;">
      <div style="width: 44px; height: 44px; border: 3px solid rgba(37, 99, 235, 0.15); border-top-color: var(--color-primary); border-radius: 50%; animation: wmsSpin 0.9s linear infinite; margin-bottom: 1rem;"></div>
      <h4 style="margin: 0; color: var(--color-text-main); font-weight: 600;">Cargando Módulo de Identidad & QR...</h4>
    </div>
  `;

  try {
    await loadAndRenderData(container);
  } catch (err) {
    console.error('Error al inicializar el módulo Identidad & QR:', err);
    container.innerHTML = `<div class="alert alert-error" style="margin: 1.5rem;">Error al cargar datos: ${err.message || err}</div>`;
  }
}

async function loadAndRenderData(container) {
  // 1. Cargar perfiles, qr_codes, qr_visit_logs y qr_notifications con tolerancia a fallos
  let profilesRes = { data: [] }, qrsRes = { data: [] }, logsRes = { data: [] }, notifsRes = { data: [] };
  
  try {
    const results = await Promise.all([
      supabase.from('profiles').select('*').order('full_name', { ascending: true }),
      supabase.from('qr_codes').select('*'),
      supabase.from('qr_visit_logs').select('*'),
      supabase.from('qr_notifications').select('*').order('created_at', { ascending: false })
    ]);
    profilesRes = results[0];
    qrsRes = results[1];
    logsRes = results[2];
    notifsRes = results[3];
  } catch(e) {
    console.warn('Advertencia en consulta a Supabase:', e);
  }

  const rawProfiles = profilesRes.data || [];
  let qrCodes = (qrsRes && qrsRes.data) ? qrsRes.data : [];
  let visitLogs = (logsRes && logsRes.data) ? logsRes.data : [];
  let notifications = (notifsRes && notifsRes.data) ? notifsRes.data : [];

  let isMissingTables = false;
  if (!qrsRes.data || qrsRes.error) {
    isMissingTables = true;
    try {
      const stored = localStorage.getItem('stocka_qr_codes_fallback');
      if (stored) qrCodes = JSON.parse(stored);
    } catch(err) {}
  }

  if (!logsRes.data || logsRes.error) {
    try {
      const stored = localStorage.getItem('stocka_qr_visit_logs_fallback');
      if (stored) visitLogs = JSON.parse(stored);
    } catch(err) {}
  }

  if (!notifsRes.data || notifsRes.error) {
    try {
      const stored = localStorage.getItem('stocka_qr_notifications_fallback');
      if (stored) notifications = JSON.parse(stored);
    } catch(err) {}
  }

  // Filtrar exclusivamente a los colaboradores oficiales de Stocka
  let profiles = rawProfiles.filter(p => {
    const emailLower = (p.email || '').toLowerCase().trim();
    return OFFICIAL_COLABORADORES_EMAILS.includes(emailLower) || p.is_colaborador === true;
  });

  // Nombres predeterminados para asegurar la presencia de los 4 colaboradores oficiales en todo momento
  const defaultNames = {
    'felipe.trup@gmail.com': 'Felipe Trup',
    'fratruper@gmail.com': 'Francisco Trup',
    'kyria.oyarcep@gmail.com': 'Kyria Oyarce',
    'stockachile@gmail.com': 'Stocka Chile'
  };

  OFFICIAL_COLABORADORES_EMAILS.forEach((officialEmail) => {
    const exists = profiles.some(p => (p.email || '').toLowerCase().trim() === officialEmail);
    if (!exists) {
      profiles.push({
        id: generateUUID(),
        email: officialEmail,
        full_name: defaultNames[officialEmail] || officialEmail.split('@')[0],
        job_title: 'Equipo Oficial Stocka',
        comercio: 'Stocka WMS Chile',
        is_colaborador: true,
        profile_public_enabled: true
      });
    }
  });

  // Calcular Métricas
  const totalWorkers = profiles.length;
  const activeQRs = qrCodes.filter(q => q.status === 'active').length;
  const totalScans = visitLogs.length;
  const unreadNotifs = notifications.filter(n => !n.read).length;

  // Mapear datos por colaborador
  const workersData = profiles.map(worker => {
    const userQr = qrCodes.find(q => q.user_id === worker.id && q.status === 'active') || qrCodes.find(q => (q.user_id === worker.id || (worker.email && q.title && q.title.toLowerCase().includes((worker.full_name || '').toLowerCase()))));
    const workerLogs = userQr ? visitLogs.filter(l => l.qr_code_id === userQr.id) : [];
    return {
      ...worker,
      qr: userQr || null,
      scanCount: workerLogs.length,
      lastScan: workerLogs.length > 0 ? workerLogs.sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at))[0].scanned_at : null
    };
  });

  // Generar HTML de la vista
  container.innerHTML = `
    <div class="identity-qr-container">
      
      <!-- Top Metrics KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--color-primary);">
            <i class="ri-team-line"></i>
          </div>
          <div class="kpi-content">
            <span class="kpi-label">Colaboradores</span>
            <h3 class="kpi-value">${totalWorkers}</h3>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
            <i class="ri-qr-code-line"></i>
          </div>
          <div class="kpi-content">
            <span class="kpi-label">QRs Activos</span>
            <h3 class="kpi-value">${activeQRs}</h3>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
            <i class="ri-line-chart-line"></i>
          </div>
          <div class="kpi-content">
            <span class="kpi-label">Escaneos Totales</span>
            <h3 class="kpi-value">${totalScans}</h3>
          </div>
        </div>

        <div class="kpi-card" id="btn-open-notifications" style="cursor: pointer; position: relative;">
          <div class="kpi-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
            <i class="ri-notification-3-line"></i>
          </div>
          <div class="kpi-content">
            <span class="kpi-label">Avisos de Escaneo</span>
            <h3 class="kpi-value">${unreadNotifs} <span style="font-size: 0.75rem; font-weight: 500; color: var(--color-text-muted);">sin leer</span></h3>
          </div>
          ${unreadNotifs > 0 ? `<span class="kpi-badge-dot"></span>` : ''}
        </div>
      </div>

      <!-- Header & Action Bar -->
      <div class="table-action-bar">
        <div class="search-filter-group">
          <div class="search-box">
            <i class="ri-search-line"></i>
            <input type="text" id="qr-search-input" placeholder="Buscar colaborador por nombre, email o cargo...">
          </div>

          <select id="qr-status-filter" class="filter-select">
            <option value="all">Todos los colaboradores</option>
            <option value="active">Con QR Activo</option>
            <option value="no_qr">Sin QR Emitido</option>
            <option value="revoked">QR Revocado</option>
          </select>
        </div>

        <div style="display: flex; gap: 0.5rem;">
          <button id="btn-add-colaborador" class="btn btn-outline" style="border-color: var(--color-primary); color: var(--color-primary);">
            <i class="ri-user-add-line"></i> + Añadir Colaborador
          </button>
          <button id="btn-batch-generate" class="btn btn-primary">
            <i class="ri-qr-code-line"></i> Crear Código QR
          </button>
        </div>
      </div>

      <!-- Workers & QRs Table -->
      <div class="table-container-card">
        <table class="wms-data-table" id="workers-qr-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Cargo / Comercio</th>
              <th>Contacto</th>
              <th>Estado QR</th>
              <th>Total Visitas</th>
              <th style="text-align: right;">Acciones</th>
            </tr>
          </thead>
          <tbody id="workers-table-body">
            <!-- Rows rendered dynamically -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Container para Modales -->
    <div id="qr-modal-container"></div>
  `;

  // Renderizar filas de la tabla
  renderTableRows(workersData, notifications, container);

  // Vincular eventos de búsqueda y filtros
  const searchInput = container.querySelector('#qr-search-input');
  const statusFilter = container.querySelector('#qr-status-filter');

  const filterHandler = () => {
    const query = searchInput.value.toLowerCase().trim();
    const filterVal = statusFilter.value;

    const filtered = workersData.filter(w => {
      const matchQuery = (w.full_name || '').toLowerCase().includes(query) ||
                         (w.email || '').toLowerCase().includes(query) ||
                         (w.job_title || '').toLowerCase().includes(query);
      
      let matchStatus = true;
      if (filterVal === 'active') matchStatus = w.qr && w.qr.status === 'active';
      if (filterVal === 'no_qr') matchStatus = !w.qr;
      if (filterVal === 'revoked') matchStatus = w.qr && w.qr.status === 'revoked';

      return matchQuery && matchStatus;
    });

    renderTableRows(filtered, notifications, container);
  };

  searchInput.addEventListener('input', filterHandler);
  statusFilter.addEventListener('change', filterHandler);

  // Modal de Notificaciones de Escaneo
  const notifBtn = container.querySelector('#btn-open-notifications');
  if (notifBtn) {
    notifBtn.addEventListener('click', () => openNotificationsModal(notifications, profiles, container));
  }

  // Modal para Añadir Nuevo Colaborador
  const addColabBtn = container.querySelector('#btn-add-colaborador');
  if (addColabBtn) {
    addColabBtn.addEventListener('click', () => openAddColaboradorModal(rawProfiles, container));
  }

  // Modal para Crear Código QR Nuevo
  const batchBtn = container.querySelector('#btn-batch-generate');
  if (batchBtn) {
    batchBtn.addEventListener('click', () => openCreateQRModal(workersData, container));
  }
}

function renderTableRows(workersList, notifications, container) {
  const tbody = container.querySelector('#workers-table-body');
  if (!tbody) return;

  if (workersList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
          <i class="ri-user-search-line" style="font-size: 2.2rem; display: block; margin-bottom: 0.5rem; color: var(--color-text-muted);"></i>
          No se encontraron colaboradores coincidentes.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = workersList.map(w => {
    const fullName = w.full_name || 'Sin Nombre';
    const email = w.public_email || w.email || 'Sin Correo';
    const jobTitle = w.job_title || 'Equipo Stocka';
    const company = w.custom_company || (w.comercio && w.comercio !== 'no asignado' ? w.comercio : 'Stocka WMS Chile');
    const phone = w.work_phone || w.phone || '-';

    let statusBadge = '<span class="status-pill status-gray"><i class="ri-subtract-line"></i> Sin QR</span>';
    if (w.qr) {
      if (w.qr.status === 'active') {
        statusBadge = '<span class="status-pill status-green"><i class="ri-checkbox-circle-line"></i> Activo</span>';
      } else if (w.qr.status === 'revoked') {
        statusBadge = '<span class="status-pill status-red"><i class="ri-close-circle-line"></i> Revocado</span>';
      }
    }

    const initials = fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'US';

    return `
      <tr>
        <td>
          <div class="user-profile-cell">
            ${w.avatar_url 
              ? `<img src="${w.avatar_url}" class="user-cell-avatar">` 
              : `<div class="user-cell-placeholder">${initials}</div>`}
            <div class="user-cell-info">
              <span class="user-cell-name">${escapeHtml(fullName)}</span>
              <span class="user-cell-email">${escapeHtml(email)}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; color: var(--color-text-main); font-size: 0.88rem;">${escapeHtml(jobTitle)}</div>
          <div style="font-size: 0.78rem; color: var(--color-text-muted);">${escapeHtml(company)}</div>
        </td>
        <td>
          <div style="font-size: 0.85rem; color: var(--color-text-main);"><i class="ri-phone-line" style="color: var(--color-primary); font-size: 0.85rem;"></i> ${escapeHtml(phone)}</div>
        </td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <span class="scan-count-badge">${w.scanCount}</span>
            <span style="font-size: 0.78rem; color: var(--color-text-muted);">escaneos</span>
          </div>
        </td>
        <td style="text-align: right;">
          <div class="table-actions">
            ${w.qr ? `
              <button class="btn-icon btn-view-qr" data-userid="${w.id}" title="Ver Credencial & QR">
                <i class="ri-qr-code-line"></i>
              </button>
            ` : `
              <button class="btn-icon btn-generate-qr" data-userid="${w.id}" title="Emitir Código QR">
                <i class="ri-add-circle-line"></i>
              </button>
            `}
            <button class="btn-icon btn-edit-worker" data-userid="${w.id}" title="Editar Tarjeta Virtual">
              <i class="ri-edit-line"></i>
            </button>
            ${w.qr ? `
              <button class="btn-icon btn-history-qr" data-userid="${w.id}" title="Ver Historial de Escaneos">
                <i class="ri-history-line"></i>
              </button>
              ${w.qr.status === 'active' ? `
                <button class="btn-icon btn-revoke-qr" data-qrid="${w.qr.id}" title="Revocar QR">
                  <i class="ri-indeterminate-circle-line" style="color: #ef4444;"></i>
                </button>
              ` : `
                <button class="btn-icon btn-activate-qr" data-qrid="${w.qr.id}" title="Reactivar QR">
                  <i class="ri-refresh-line" style="color: #10b981;"></i>
                </button>
              `}
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Eventos de botones en la tabla
  tbody.querySelectorAll('.btn-view-qr').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const uid = e.currentTarget.getAttribute('data-userid');
      const w = workersList.find(item => item.id === uid);
      if (w && w.qr) openQRViewerModal(w, w.qr);
    });
  });

  tbody.querySelectorAll('.btn-generate-qr').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const uid = e.currentTarget.getAttribute('data-userid');
      const w = workersList.find(item => item.id === uid);
      if (w) await createQRForWorker(w, container);
    });
  });

  tbody.querySelectorAll('.btn-edit-worker').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const uid = e.currentTarget.getAttribute('data-userid');
      const w = workersList.find(item => item.id === uid);
      if (w) openEditWorkerModal(w, container);
    });
  });

  tbody.querySelectorAll('.btn-history-qr').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const uid = e.currentTarget.getAttribute('data-userid');
      const w = workersList.find(item => item.id === uid);
      if (w && w.qr) openHistoryModal(w, w.qr);
    });
  });

  tbody.querySelectorAll('.btn-revoke-qr').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const qid = e.currentTarget.getAttribute('data-qrid');
      if (confirm('¿Estás seguro de que deseas revocar este código QR? El enlace dejará de responder inmediatamente.')) {
        await supabase.from('qr_codes').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', qid);
        renderIdentityQRAdmin(container);
      }
    });
  });

  tbody.querySelectorAll('.btn-activate-qr').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const qid = e.currentTarget.getAttribute('data-qrid');
      await supabase.from('qr_codes').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', qid);
      renderIdentityQRAdmin(container);
    });
  });
}

// Modal para Ver y Descargar Código QR con Branding Stocka
function openQRViewerModal(worker, qrData) {
  const modalContainer = document.getElementById('qr-modal-container');
  if (!modalContainer) return;

  const publicUrl = `https://wms.stocka.cl/vcard.html?token=${qrData.token}`;
  const fullName = worker.full_name || 'Colaborador Stocka';
  const jobTitle = worker.job_title || 'Equipo Stocka';

  modalContainer.innerHTML = `
    <div class="modal-overlay active">
      <div class="modal-card modal-qr-viewer">
        <div class="modal-header">
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700;">Credencial Virtual Stocka</h3>
            <p style="margin: 2px 0 0 0; font-size: 0.82rem; color: var(--color-text-muted);">${escapeHtml(fullName)}</p>
          </div>
          <button class="modal-close-btn" id="close-qr-modal"><i class="ri-close-line"></i></button>
        </div>

        <div class="modal-body" style="display: flex; flex-direction: column; align-items: center; gap: 1.25rem; text-align: center;">
          <!-- Contenedor donde se genera el Código QR con el Logo incrustado -->
          <div class="qr-canvas-wrapper" style="padding: 1rem; background: #ffffff; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid var(--color-border); display: flex; justify-content: center; align-items: center; width: 260px; height: 260px; min-width: 260px; min-height: 260px; box-sizing: border-box;">
            <div id="qr-canvas-element" style="width: 240px; height: 240px; min-width: 240px; min-height: 240px;"></div>
          </div>

          <div style="width: 100%;">
            <label style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 0.35rem;">Enlace Público de la Tarjeta</label>
            <div style="display: flex; gap: 0.5rem;">
              <input type="text" readonly value="${publicUrl}" class="form-input" id="qr-url-input" style="font-size: 0.85rem; background: var(--color-bg);">
              <button class="btn btn-secondary" id="btn-copy-url" style="padding: 0.5rem 1rem;"><i class="ri-file-copy-line"></i> Copiar</button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; width: 100%;">
            <button class="btn btn-primary" id="btn-download-png">
              <i class="ri-download-2-line"></i> Descargar PNG
            </button>
            <button class="btn btn-outline" id="btn-print-badge">
              <i class="ri-printer-line"></i> Credencial Física
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Renderizar QR Code dinámico ISO en Canvas con el logo de Stocka
  setTimeout(() => {
    generateQRWithLogo('qr-canvas-element', publicUrl);
  }, 50);

  // Eventos de la modal
  document.getElementById('close-qr-modal').addEventListener('click', () => modalContainer.innerHTML = '');

  document.getElementById('btn-copy-url').addEventListener('click', () => {
    const input = document.getElementById('qr-url-input');
    input.select();
    navigator.clipboard.writeText(publicUrl);
    alert('¡Enlace de Tarjeta Virtual copiado al portapapeles!');
  });

  document.getElementById('btn-download-png').addEventListener('click', () => {
    const canvas = document.querySelector('#qr-canvas-element canvas') || document.querySelector('#qr-canvas-element img');
    if (canvas) {
      const image = canvas.tagName === 'CANVAS' ? canvas.toDataURL('image/png') : canvas.src;
      const link = document.createElement('a');
      link.download = `QR_Stocka_${fullName.replace(/\s+/g, '_')}.png`;
      link.href = image;
      link.click();
    }
  });

  document.getElementById('btn-print-badge').addEventListener('click', () => {
    printCredentialBadge(worker, qrData, publicUrl);
  });
}

// Función para generar un Código QR 100% Estándar ISO/IEC 18004 con Corrección de Errores Nivel H y Logo de Stocka
function generateQRWithLogo(containerId, textUrl) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';
  
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 240;
  canvas.style.width = '240px';
  canvas.style.height = '240px';
  canvas.style.borderRadius = '8px';
  canvas.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  const renderCanvasQr = () => {
    try {
      if (typeof window.qrcode === 'function') {
        const qr = window.qrcode(0, 'H');
        qr.addData(textUrl);
        qr.make();

        const moduleCount = qr.getModuleCount();
        const cellSize = 240 / moduleCount;

        // 1. Fondo blanco
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 240, 240);

        // 2. Módulos QR
        ctx.fillStyle = '#0F172A';
        for (let r = 0; r < moduleCount; r++) {
          for (let c = 0; c < moduleCount; c++) {
            if (qr.isDark(r, c)) {
              ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.4, cellSize + 0.4);
            }
          }
        }

        // 3. Logo Badge central (Nivel H permite recuperar 30%)
        const centerRadius = 30;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(120, 120, centerRadius + 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = 3;
        ctx.strokeStyle = '#2563EB';
        ctx.stroke();

        ctx.fillStyle = '#2563EB';
        ctx.font = '900 12px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('STOCKA', 120, 121);
      }
    } catch(e) {
      console.error('Error al generar matriz QR:', e);
    }
  };

  if (typeof window.qrcode === 'function') {
    renderCanvasQr();
  } else {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    script.onload = () => renderCanvasQr();
    document.head.appendChild(script);
  }
}

// Imprimir Credencial de Identificación Física (PVC Badge style con QR ISO Compliant)
function printCredentialBadge(worker, qrData, publicUrl) {
  const fullName = worker.full_name || 'Colaborador Stocka';
  const jobTitle = worker.job_title || 'Equipo Stocka';
  const company = worker.comercio && worker.comercio !== 'no asignado' ? worker.comercio : 'Stocka WMS HQ';

  const printWin = window.open('', '_blank');
  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Credencial ${fullName} - Stocka</title>
      <link href="https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
      <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f1f5f9; margin: 0; }
        .badge-card { width: 320px; height: 490px; background: #ffffff; border-radius: 18px; border: 2px solid #cbd5e1; box-shadow: 0 10px 25px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; text-align: center; overflow: hidden; position: relative; }
        .badge-header { width: 100%; height: 90px; background: linear-gradient(135deg, #1e3a8a, #2563eb); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 800; letter-spacing: -0.5px; }
        .badge-avatar { width: 85px; height: 85px; border-radius: 50%; border: 4px solid white; background: #2563eb; color: white; font-size: 1.8rem; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: -42px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); }
        .badge-name { font-size: 1.2rem; font-weight: 800; color: #0f172a; margin-top: 0.6rem; }
        .badge-title { font-size: 0.85rem; font-weight: 600; color: #2563eb; margin-top: 0.1rem; }
        .badge-company { font-size: 0.75rem; color: #64748b; margin-top: 0.2rem; }
        .badge-qr { margin-top: 0.8rem; padding: 0.5rem; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; display: flex; justify-content: center; align-items: center; }
        .badge-footer { position: absolute; bottom: 0; width: 100%; padding: 0.6rem 0; background: #f1f5f9; font-size: 0.7rem; color: #64748b; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="badge-card">
        <div class="badge-header"><i class="ri-box-3-fill"></i> STOCKA WMS</div>
        <div class="badge-avatar">${fullName.substring(0, 2).toUpperCase()}</div>
        <div class="badge-name">${fullName}</div>
        <div class="badge-title">${jobTitle}</div>
        <div class="badge-company">${company}</div>
        <div class="badge-qr" id="badge-qr-container"></div>
        <div class="badge-footer">CREDENCIAL OFICIAL VERIFICADA</div>
      </div>
      <script>
        window.onload = function() {
          const container = document.getElementById('badge-qr-container');
          const canvas = document.createElement('canvas');
          canvas.width = 160; canvas.height = 160;
          container.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          
          const qr = qrcode(0, 'H');
          qr.addData("${publicUrl}");
          qr.make();
          const count = qr.getModuleCount();
          const cellSize = 160 / count;

          ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 160, 160);
          ctx.fillStyle = '#0F172A';
          for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
              if (qr.isDark(r, c)) ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.4, cellSize + 0.4);
            }
          }

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath(); ctx.arc(80, 80, 22, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 2.5; ctx.strokeStyle = '#2563EB'; ctx.stroke();
          ctx.fillStyle = '#2563EB'; ctx.font = '900 9px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('STOCKA', 80, 81);

          setTimeout(() => { window.print(); }, 300);
        };
      </script>
    </body>
    </html>
  `);
  printWin.document.close();
}

// Modal para Editar Información de la Tarjeta Virtual del Trabajador
function openEditWorkerModal(worker, mainContainer) {
  const modalContainer = document.getElementById('qr-modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="modal-overlay active">
      <div class="modal-card" style="max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700;">Editar Tarjeta Virtual</h3>
          <button class="modal-close-btn" id="close-edit-modal"><i class="ri-close-line"></i></button>
        </div>
        <form id="edit-worker-form" style="display: flex; flex-direction: column; flex: 1; overflow: hidden;">
          <div class="modal-body" style="overflow-y: auto; flex: 1; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
            <div class="form-group">
              <label class="form-label">Nombre Completo</label>
              <input type="text" id="edit-full-name" class="form-input" value="${escapeHtml(worker.full_name || '')}" required>
            </div>

            <div class="form-group">
              <label class="form-label">Cargo / Título Profesional</label>
              <input type="text" id="edit-job-title" class="form-input" value="${escapeHtml(worker.job_title || '')}" placeholder="Ej. Operaciones & Logística">
            </div>

            <div class="form-group">
              <label class="form-label">Correo Comercial / Público</label>
              <input type="email" id="edit-public-email" class="form-input" value="${escapeHtml(worker.public_email || worker.email || '')}" placeholder="Ej. felipe.trup@stocka.cl">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 2px;">Este correo se mostrará en tu tarjeta virtual pública en lugar del correo de acceso.</span>
            </div>

            <div class="form-group">
              <label class="form-label">Empresa / Comercios Visibles</label>
              <input type="text" id="edit-custom-company" class="form-input" value="${escapeHtml(worker.custom_company || '')}" placeholder="Ej. Stocka WMS Chile — Logística & Fulfillment">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 2px;">Reemplaza la lista completa de comercios por este texto personalizado.</span>
            </div>

            <div class="fields-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
              <div class="form-group">
                <label class="form-label">Teléfono Corporativo</label>
                <input type="text" id="edit-work-phone" class="form-input" value="${escapeHtml(worker.work_phone || worker.phone || '')}" placeholder="+56912345678">
              </div>
              <div class="form-group">
                <label class="form-label">WhatsApp Directo</label>
                <input type="text" id="edit-whatsapp" class="form-input" value="${escapeHtml(worker.whatsapp_number || '')}" placeholder="+56912345678">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">URL Perfil LinkedIn</label>
              <input type="url" id="edit-linkedin" class="form-input" value="${escapeHtml(worker.linkedin_url || '')}" placeholder="https://linkedin.com/in/usuario">
            </div>

            <div class="form-group">
              <label class="form-label">Resumen / Bio Profesional</label>
              <textarea id="edit-bio" class="form-input" rows="2" placeholder="Breve presentación del colaborador...">${escapeHtml(worker.bio_summary || '')}</textarea>
            </div>

            <div class="setting-row" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
              <span class="setting-title" style="font-size: 0.88rem; font-weight: 600;">Perfil Público Visible</span>
              <label class="switch">
                <input type="checkbox" id="edit-public-enabled" ${worker.profile_public_enabled !== false ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="setting-row" style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--color-border); padding-top: 0.75rem;">
              <div>
                <span class="setting-title" style="display: block; font-weight: 700; font-size: 0.88rem;">Colaborador Oficial de Stocka</span>
                <span style="font-size: 0.78rem; color: var(--color-text-muted);">Indica si este usuario pertenece al equipo interno de trabajadores de Stocka.</span>
              </div>
              <label class="switch">
                <input type="checkbox" id="edit-is-colaborador" ${worker.is_colaborador !== false ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <div class="modal-footer" style="flex-shrink: 0; padding: 1rem 1.25rem; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 0.5rem; background: var(--color-surface);">
            <button type="button" class="btn btn-secondary" id="cancel-edit-btn">Cancelar</button>
            <button type="submit" class="btn btn-primary"><i class="ri-save-line"></i> Guardar Cambios</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('close-edit-modal').addEventListener('click', () => modalContainer.innerHTML = '');
  document.getElementById('cancel-edit-btn').addEventListener('click', () => modalContainer.innerHTML = '');

  document.getElementById('edit-worker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isColab = document.getElementById('edit-is-colaborador').checked;
    const emailLower = (worker.email || '').toLowerCase().trim();

    if (isColab && emailLower && !OFFICIAL_COLABORADORES_EMAILS.includes(emailLower)) {
      OFFICIAL_COLABORADORES_EMAILS.push(emailLower);
    } else if (!isColab && emailLower) {
      const idx = OFFICIAL_COLABORADORES_EMAILS.indexOf(emailLower);
      if (idx !== -1) OFFICIAL_COLABORADORES_EMAILS.splice(idx, 1);
    }

    const payload = {
      full_name: document.getElementById('edit-full-name').value,
      job_title: document.getElementById('edit-job-title').value,
      public_email: document.getElementById('edit-public-email').value,
      custom_company: document.getElementById('edit-custom-company').value,
      work_phone: document.getElementById('edit-work-phone').value,
      whatsapp_number: document.getElementById('edit-whatsapp').value,
      linkedin_url: document.getElementById('edit-linkedin').value,
      bio_summary: document.getElementById('edit-bio').value,
      profile_public_enabled: document.getElementById('edit-public-enabled').checked,
      is_colaborador: isColab,
      updated_at: new Date().toISOString()
    };

    if (worker.id && isUUID(worker.id)) {
      await supabase.from('profiles').update(payload).eq('id', worker.id);
    }

    modalContainer.innerHTML = '';
    renderIdentityQRAdmin(mainContainer);
  });
}

// Modal para Añadir Nuevo Colaborador Oficial al Módulo
function openAddColaboradorModal(rawProfiles, mainContainer) {
  const modalContainer = document.getElementById('qr-modal-container');
  if (!modalContainer) return;

  const nonColabUsers = (rawProfiles || []).filter(p => {
    const emailLower = (p.email || '').toLowerCase().trim();
    return !OFFICIAL_COLABORADORES_EMAILS.includes(emailLower) && p.is_colaborador !== true;
  });

  modalContainer.innerHTML = `
    <div class="modal-overlay active">
      <div class="modal-card">
        <div class="modal-header">
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700;">Añadir Colaborador al Equipo Stocka</h3>
          <button class="modal-close-btn" id="close-add-colab-modal"><i class="ri-close-line"></i></button>
        </div>
        <form id="add-colab-form" class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">
            Selecciona un usuario registrado o ingresa el correo corporativo del nuevo colaborador para asignarle tarjeta virtual y código QR.
          </p>

          <div class="form-group">
            <label class="form-label">Seleccionar Usuario del Sistema (Opcional)</label>
            <select id="select-existing-user" class="form-select">
              <option value="">-- O seleccionar de usuarios registrados --</option>
              ${nonColabUsers.map(u => `<option value="${u.id}" data-email="${escapeHtml(u.email || '')}" data-name="${escapeHtml(u.full_name || '')}">${escapeHtml(u.full_name || u.email)} (${u.email})</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Correo Electrónico del Colaborador</label>
            <input type="email" id="colab-email-input" class="form-input" placeholder="colaborador@gmail.com o @stocka.cl" required>
          </div>

          <div class="form-group">
            <label class="form-label">Nombre Completo</label>
            <input type="text" id="colab-name-input" class="form-input" placeholder="Ej. Valentina Morales" required>
          </div>

          <div class="form-group">
            <label class="form-label">Cargo / Título Profesional</label>
            <input type="text" id="colab-title-input" class="form-input" placeholder="Ej. Supervisora de Operaciones">
          </div>

          <div class="modal-footer" style="margin-top: 1rem; display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button type="button" class="btn btn-secondary" id="cancel-add-colab-btn">Cancelar</button>
            <button type="submit" class="btn btn-primary"><i class="ri-check-line"></i> Guardar Colaborador</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('close-add-colab-modal').addEventListener('click', () => modalContainer.innerHTML = '');
  document.getElementById('cancel-add-colab-btn').addEventListener('click', () => modalContainer.innerHTML = '');

  const selectUser = document.getElementById('select-existing-user');
  const emailInput = document.getElementById('colab-email-input');
  const nameInput = document.getElementById('colab-name-input');

  selectUser.addEventListener('change', (e) => {
    const selectedOpt = e.target.options[e.target.selectedIndex];
    if (selectedOpt && selectedOpt.value) {
      emailInput.value = selectedOpt.getAttribute('data-email') || '';
      nameInput.value = selectedOpt.getAttribute('data-name') || '';
    }
  });

  document.getElementById('add-colab-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailVal = emailInput.value.toLowerCase().trim();
    const nameVal = nameInput.value.trim();
    const titleVal = document.getElementById('colab-title-input').value.trim() || 'Equipo Stocka';

    if (!emailVal) return;

    if (!OFFICIAL_COLABORADORES_EMAILS.includes(emailVal)) {
      OFFICIAL_COLABORADORES_EMAILS.push(emailVal);
    }

    const selectedUserId = selectUser.value;
    if (selectedUserId) {
      await supabase.from('profiles').update({
        is_colaborador: true,
        job_title: titleVal,
        full_name: nameVal,
        updated_at: new Date().toISOString()
      }).eq('id', selectedUserId);
    } else {
      // Intentar actualizar por email o insertar
      const { data: existing } = await supabase.from('profiles').select('id').eq('email', emailVal).maybeSingle();
      if (existing) {
        await supabase.from('profiles').update({
          is_colaborador: true,
          job_title: titleVal,
          full_name: nameVal,
          updated_at: new Date().toISOString()
        }).eq('id', existing.id);
      }
    }

    modalContainer.innerHTML = '';
    renderIdentityQRAdmin(mainContainer);
  });
}

// Modal para Abrir Creador de Código QR Dinámico
function openCreateQRModal(workersData, mainContainer) {
  const modalContainer = document.getElementById('qr-modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="modal-overlay active">
      <div class="modal-card">
        <div class="modal-header">
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700;">Emitir Código QR Dinámico</h3>
          <button class="modal-close-btn" id="close-create-qr-modal"><i class="ri-close-line"></i></button>
        </div>
        <form id="create-qr-form" class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <div class="form-group">
            <label class="form-label">Seleccionar Colaborador</label>
            <select id="create-qr-worker-select" class="form-select" required>
              <option value="">-- Seleccionar integrante del equipo --</option>
              ${workersData.map(w => `<option value="${w.id}">${escapeHtml(w.full_name || w.email)} (${escapeHtml(w.job_title || 'Equipo Stocka')})</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Tipo de Código QR</label>
            <select id="create-qr-type-select" class="form-select">
              <option value="vcard">Tarjeta de Presentación Virtual (vCard)</option>
              <option value="access_pass">Pase de Acceso a Bodega / Sistema</option>
              <option value="action_authorization">Autorización de Acciones Logísticas</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Título del Código QR</label>
            <input type="text" id="create-qr-title-input" class="form-input" placeholder="Ej. Tarjeta Virtual Felipe Trup" required>
          </div>

          <div class="modal-footer" style="margin-top: 1rem; display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button type="button" class="btn btn-secondary" id="cancel-create-qr-btn">Cancelar</button>
            <button type="submit" class="btn btn-primary"><i class="ri-qr-code-line"></i> Emitir Código QR</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('close-create-qr-modal').addEventListener('click', () => modalContainer.innerHTML = '');
  document.getElementById('cancel-create-qr-btn').addEventListener('click', () => modalContainer.innerHTML = '');

  const workerSelect = document.getElementById('create-qr-worker-select');
  const titleInput = document.getElementById('create-qr-title-input');

  workerSelect.addEventListener('change', (e) => {
    const selectedId = e.target.value;
    const worker = workersData.find(w => w.id === selectedId);
    if (worker) {
      titleInput.value = `Tarjeta Virtual ${worker.full_name || worker.email}`;
    }
  });

  document.getElementById('create-qr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const workerId = workerSelect.value;
    const worker = workersData.find(w => w.id === workerId);
    if (!worker) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Generando QR...';
    }

    await createQRForWorker(worker, mainContainer);
  });
}

// Modal para Emitir Nuevo QR Code
async function createQRForWorker(worker, mainContainer) {
  let realUserId = worker.id;

  // Garantizar que el ID sea un UUID válido exigido por PostgreSQL en Supabase
  if (!realUserId || !isUUID(realUserId)) {
    try {
      const { data: existingProf } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', worker.email)
        .maybeSingle();

      if (existingProf && existingProf.id && isUUID(existingProf.id)) {
        realUserId = existingProf.id;
      } else {
        const newProfId = generateUUID();
        const newProfileData = {
          id: newProfId,
          email: worker.email,
          full_name: worker.full_name || worker.email.split('@')[0],
          job_title: worker.job_title || 'Equipo Stocka',
          comercio: 'Stocka WMS Chile',
          is_colaborador: true,
          profile_public_enabled: true,
          created_at: new Date().toISOString()
        };
        const { data: inserted } = await supabase.from('profiles').insert(newProfileData).select('id').maybeSingle();
        realUserId = (inserted && inserted.id) ? inserted.id : newProfId;
      }
    } catch(e) {
      console.warn('Error al verificar/crear perfil en Supabase:', e);
      realUserId = generateUUID();
    }
  }

  const token = `stk_qr_${Math.random().toString(36).substring(2, 8)}${Date.now().toString(36)}`;
  const qrPayload = {
    id: generateUUID(),
    token: token,
    user_id: realUserId,
    type: 'vcard',
    title: `Tarjeta Virtual ${worker.full_name || worker.email}`,
    status: 'active',
    allowed_actions: ['vcard', 'gate_pass'],
    created_at: new Date().toISOString()
  };

  let activeQr = qrPayload;
  try {
    const { data: newQrData, error: insertErr } = await supabase.from('qr_codes').insert(qrPayload).select().maybeSingle();
    if (insertErr) {
      console.error('Error insertando en qr_codes en Supabase:', insertErr);
      throw insertErr;
    }
    if (newQrData) activeQr = newQrData;
  } catch (err) {
    console.warn('Almacenando QR en respaldo local por error o restricción en Supabase:', err);
    let fallbackList = [];
    try {
      const stored = localStorage.getItem('stocka_qr_codes_fallback');
      if (stored) fallbackList = JSON.parse(stored);
    } catch(e) {}
    fallbackList = fallbackList.filter(q => q.user_id !== realUserId);
    fallbackList.push(qrPayload);
    localStorage.setItem('stocka_qr_codes_fallback', JSON.stringify(fallbackList));
  }

  // Recargar la tabla en segundo plano
  await loadAndRenderData(mainContainer);

  // Abrir inmediatamente el Visor con el QR generado y el Logo de Stocka
  openQRViewerModal({ ...worker, id: realUserId }, activeQr);
}

// Modal de Notificaciones de Escaneo
function openNotificationsModal(notifications, profiles, mainContainer) {
  const modalContainer = document.getElementById('qr-modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="modal-overlay active">
      <div class="modal-card">
        <div class="modal-header">
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700;">Avisos de Escaneo de Tarjetas</h3>
          <button class="modal-close-btn" id="close-notif-modal"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          ${notifications.length === 0 ? `
            <p style="text-align: center; color: var(--color-text-muted); padding: 2rem;">No hay registros de notificaciones recientes.</p>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 0.75rem; max-height: 380px; overflow-y: auto;">
              ${notifications.map(n => `
                <div style="padding: 0.85rem 1rem; background: ${n.read ? 'var(--color-bg)' : 'rgba(37, 99, 235, 0.06)'}; border: 1px solid var(--color-border); border-radius: 12px; display: flex; gap: 0.75rem; align-items: flex-start;">
                  <i class="ri-notification-3-line" style="color: var(--color-primary); font-size: 1.2rem; margin-top: 2px;"></i>
                  <div style="flex: 1;">
                    <div style="font-weight: 700; font-size: 0.9rem; color: var(--color-text-main);">${escapeHtml(n.title)}</div>
                    <div style="font-size: 0.82rem; color: var(--color-text-muted); margin-top: 2px;">${escapeHtml(n.message)}</div>
                    <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 4px;">${new Date(n.created_at).toLocaleString()}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  document.getElementById('close-notif-modal').addEventListener('click', async () => {
    // Marcar como leídas
    await supabase.from('qr_notifications').update({ read: true }).eq('read', false);
    modalContainer.innerHTML = '';
    renderIdentityQRAdmin(mainContainer);
  });
}

// Modal de Historial de Escaneos
async function openHistoryModal(worker, qrData) {
  const modalContainer = document.getElementById('qr-modal-container');
  if (!modalContainer) return;

  const { data: logs } = await supabase.from('qr_visit_logs').select('*').eq('qr_code_id', qrData.id).order('scanned_at', { ascending: false });

  modalContainer.innerHTML = `
    <div class="modal-overlay active">
      <div class="modal-card">
        <div class="modal-header">
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700;">Historial de Visitas QR</h3>
          <button class="modal-close-btn" id="close-history-modal"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem;">Colaborador: <strong>${escapeHtml(worker.full_name || '')}</strong></p>
          ${(!logs || logs.length === 0) ? `
            <p style="text-align: center; color: var(--color-text-muted); padding: 2rem;">No se han registrado visitas aún para este código QR.</p>
          ` : `
            <table class="wms-data-table">
              <thead>
                <tr>
                  <th>Fecha / Hora</th>
                  <th>Dispositivo</th>
                  <th>Navegador / Referer</th>
                </tr>
              </thead>
              <tbody>
                ${logs.map(l => `
                  <tr>
                    <td style="font-size: 0.82rem; font-weight: 600;">${new Date(l.scanned_at).toLocaleString()}</td>
                    <td><span class="status-pill status-blue">${escapeHtml(l.device_type || 'desktop')}</span></td>
                    <td style="font-size: 0.78rem; color: var(--color-text-muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(l.referrer || l.user_agent || '-')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    </div>
  `;

  document.getElementById('close-history-modal').addEventListener('click', () => modalContainer.innerHTML = '');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function injectStyles() {
  const styleId = 'identity-qr-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .identity-qr-container { display: flex; flex-direction: column; gap: 1.5rem; animation: wmsFadeIn 0.3s ease-out; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; }
    .kpi-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; display: flex; align-items: center; gap: 1rem; box-shadow: var(--shadow-sm); }
    .kpi-icon { width: 50px; height: 50px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0; }
    .kpi-label { font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-value { margin: 2px 0 0 0; font-size: 1.5rem; font-weight: 800; color: var(--color-text-main); }
    .kpi-badge-dot { position: absolute; top: 12px; right: 12px; width: 10px; height: 10px; background: #ef4444; border-radius: 50%; }

    .table-action-bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .search-filter-group { display: flex; gap: 0.75rem; flex: 1; min-width: 280px; }
    .search-box { position: relative; flex: 1; }
    .search-box i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); }
    .search-box input { width: 100%; padding: 0.65rem 0.8rem 0.65rem 2.4rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-main); font-size: 0.9rem; outline: none; }
    .filter-select { padding: 0.65rem 0.8rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-main); font-size: 0.9rem; outline: none; }

    .table-container-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
    .wms-data-table { width: 100%; border-collapse: collapse; text-align: left; }
    .wms-data-table th { background: rgba(0,0,0,0.02); padding: 0.85rem 1.25rem; font-size: 0.78rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; border-bottom: 1px solid var(--color-border); }
    .wms-data-table td { padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); font-size: 0.9rem; color: var(--color-text-main); vertical-align: middle; }
    .wms-data-table tbody tr:last-child td { border-bottom: none; }

    .user-profile-cell { display: flex; align-items: center; gap: 0.85rem; }
    .user-cell-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid var(--color-border); }
    .user-cell-placeholder { width: 40px; height: 40px; border-radius: 50%; background: var(--color-primary); color: white; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; }
    .user-cell-info { display: flex; flex-direction: column; }
    .user-cell-name { font-weight: 700; color: var(--color-text-main); }
    .user-cell-email { font-size: 0.78rem; color: var(--color-text-muted); }

    .status-pill { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.65rem; border-radius: 50px; font-size: 0.75rem; font-weight: 600; }
    .status-green { background: rgba(16, 185, 129, 0.12); color: #10b981; }
    .status-red { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
    .status-gray { background: rgba(100, 116, 139, 0.12); color: #64748b; }
    .status-blue { background: rgba(59, 130, 246, 0.12); color: var(--color-primary); }

    .scan-count-badge { padding: 0.2rem 0.5rem; background: rgba(59, 130, 246, 0.1); color: var(--color-primary); border-radius: 6px; font-weight: 800; font-size: 0.85rem; }
    .table-actions { display: flex; justify-content: flex-end; gap: 0.35rem; }
    .btn-icon { width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; font-size: 1rem; }
    .btn-icon:hover { border-color: var(--color-primary); color: var(--color-primary); background: rgba(59, 130, 246, 0.05); }

    /* Modal Styles */
    .modal-overlay.active { position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(15, 23, 42, 0.65) !important; backdrop-filter: blur(4px) !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 99999 !important; opacity: 1 !important; pointer-events: auto !important; padding: 1rem !important; animation: wmsFadeIn 0.2s !important; }
    .modal-card { width: 100%; max-width: 520px; background: var(--color-surface); border-radius: var(--radius-lg); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); overflow: hidden; display: flex; flex-direction: column; }
    .modal-header { padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; }
    .modal-close-btn { background: none; border: none; font-size: 1.3rem; color: var(--color-text-muted); cursor: pointer; }
    .modal-body { padding: 1.5rem; }

    @keyframes wmsSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes wmsFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `;
  document.head.appendChild(style);
}
