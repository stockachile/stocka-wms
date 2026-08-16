// js/vcard.js - Lógica y Gestión de Tarjeta Virtual Stocka

import supabase from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('vcard-loading');
  const contentEl = document.getElementById('vcard-content');
  const errorEl = document.getElementById('vcard-error');
  const errorTitleEl = document.getElementById('error-title');
  const errorDescEl = document.getElementById('error-desc');

  // 1. Obtener parámetro de token o ID de la URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token') || urlParams.get('id') || urlParams.get('code');

  if (!token) {
    showError('Código QR no especificado', 'Por favor, escanea un código QR válido emitido por el sistema Stocka WMS.');
    return;
  }

  try {
    // 2. Buscar el registro del código QR en Supabase o en respaldo local
    let qrData = null;
    try {
      const { data: remoteQr } = await supabase
        .from('qr_codes')
        .select('*, profiles(*)')
        .eq('token', token)
        .maybeSingle();
      if (remoteQr) qrData = remoteQr;
    } catch (e) {
      console.warn('Consulta remota de QR falló, verificando respaldo local:', e);
    }

    if (!qrData) {
      try {
        const stored = JSON.parse(localStorage.getItem('stocka_qr_codes_fallback') || '[]');
        qrData = stored.find(q => q.token === token);
        if (qrData) {
          qrData.profiles = {
            full_name: qrData.title ? qrData.title.replace('Tarjeta Virtual ', '') : 'Colaborador Stocka',
            job_title: 'Equipo Oficial Stocka WMS',
            comercio: 'Stocka WMS Chile',
            profile_public_enabled: true
          };
        }
      } catch(e) {}
    }

    if (!qrData) {
      showError('Credencial QR no encontrada', 'El enlace escaneado no corresponde a ningún código registrado en nuestro sistema.');
      return;
    }

    // 3. Verificar estado de activación y expiración
    if (qrData.status !== 'active') {
      const statusText = qrData.status === 'revoked' ? 'revocado' : 'inactivado';
      showError('Credencial Inactiva', `Este código QR ha sido ${statusText} por administración.`);
      return;
    }

    if (qrData.expires_at && new Date(qrData.expires_at) < new Date()) {
      showError('Credencial Expirada', 'El tiempo de validez de esta credencial ha finalizado.');
      return;
    }

    const worker = qrData.profiles || {};
    if (!worker || worker.profile_public_enabled === false) {
      showError('Perfil Privado', 'Este perfil no se encuentra visible públicamente en este momento.');
      return;
    }

    // 4. Registrar visita/escaneo silenciosamente en la base de datos
    registerVisitLog(qrData.id, worker);

    // 5. Renderizar interfaz de la Tarjeta Virtual
    renderVCardUI(worker, qrData);

  } catch (err) {
    console.error('Error al cargar datos de tarjeta virtual:', err);
    showError('Error de Conexión', 'Ocurrió un inconveniente al cargar los datos. Intenta nuevamente.');
  }

  function showError(title, message) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'none';
    if (errorEl) {
      errorTitleEl.textContent = title;
      errorDescEl.textContent = message;
      errorEl.style.display = 'flex';
    }
  }

  // Detectar tipo de dispositivo
  function getDeviceType() {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
      return 'tablet';
    }
    if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
      return 'mobile';
    }
    return 'desktop';
  }

  // Registrar escaneo en qr_visit_logs y notificaciones
  async function registerVisitLog(qrCodeId, workerProfile) {
    try {
      const deviceType = getDeviceType();
      const userAgent = navigator.userAgent || 'Desconocido';
      const referrer = document.referrer || 'Escaneo directo QR';

      // Insertar log de visita
      await supabase.from('qr_visit_logs').insert({
        qr_code_id: qrCodeId,
        user_agent: userAgent.substring(0, 250),
        device_type: deviceType,
        referrer: referrer.substring(0, 250),
        scanned_at: new Date().toISOString()
      });

      // Crear aviso interno para el perfil Admin
      await supabase.from('qr_notifications').insert({
        qr_code_id: qrCodeId,
        user_id: workerProfile.id,
        title: 'Escaneo de Tarjeta Virtual',
        message: `La tarjeta virtual de ${workerProfile.full_name || 'un colaborador'} fue escaneada desde un dispositivo ${deviceType}.`,
        read: false,
        created_at: new Date().toISOString()
      });

    } catch (e) {
      console.warn('Advertencia al registrar métrica de escaneo:', e);
    }
  }

  // Renderizar la tarjeta virtual con los datos del colaborador
  function renderVCardUI(worker, qrData) {
    const fullName = worker.full_name || 'Colaborador Stocka';
    const jobTitle = worker.job_title || 'Equipo Stocka';
    const company = worker.custom_company || (worker.comercio && worker.comercio !== 'no asignado' ? worker.comercio : 'Stocka WMS Chile');
    const displayEmail = worker.public_email || worker.email || '';
    const phone = worker.work_phone || worker.phone || '';
    const whatsapp = worker.whatsapp_number || (phone ? phone.replace(/\D/g, '') : '');
    const linkedin = worker.linkedin_url || '';
    const bio = worker.bio_summary || '';
    const avatarUrl = worker.avatar_url;
    
    // Obtener iniciales para avatar por defecto
    const initials = fullName
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'ST';

    // Generar bloque HTML de avatar
    const avatarHTML = avatarUrl
      ? `<img src="${avatarUrl}" alt="${fullName}" class="avatar-img">`
      : `<div class="avatar-placeholder">${initials}</div>`;

    // Generar enlaces de contacto si existen
    let contactItemsHTML = '';

    if (phone) {
      contactItemsHTML += `
        <a href="tel:${phone}" class="contact-item">
          <div class="contact-icon"><i class="ri-phone-fill"></i></div>
          <div class="contact-info">
            <span class="contact-label">Teléfono Directo</span>
            <span class="contact-value">${phone}</span>
          </div>
        </a>
      `;
    }

    if (displayEmail) {
      contactItemsHTML += `
        <a href="mailto:${displayEmail}" class="contact-item">
          <div class="contact-icon"><i class="ri-mail-fill"></i></div>
          <div class="contact-info">
            <span class="contact-label">Correo Electrónico</span>
            <span class="contact-value">${displayEmail}</span>
          </div>
        </a>
      `;
    }

    if (whatsapp) {
      const cleanWA = whatsapp.replace(/\D/g, '');
      contactItemsHTML += `
        <a href="https://wa.me/${cleanWA}?text=Hola%20${encodeURIComponent(fullName)},%20te%20contacto%20desde%20tu%20tarjeta%20virtual%20Stocka." target="_blank" class="contact-item">
          <div class="contact-icon" style="color: #25d366;"><i class="ri-whatsapp-fill"></i></div>
          <div class="contact-info">
            <span class="contact-label">WhatsApp</span>
            <span class="contact-value">Mensaje Directo</span>
          </div>
        </a>
      `;
    }

    if (linkedin) {
      contactItemsHTML += `
        <a href="${linkedin}" target="_blank" class="contact-item">
          <div class="contact-icon" style="color: #0a66c2;"><i class="ri-linkedin-box-fill"></i></div>
          <div class="contact-info">
            <span class="contact-label">LinkedIn</span>
            <span class="contact-value">Perfil Profesional</span>
          </div>
        </a>
      `;
    }

    // Dirección de Stocka
    contactItemsHTML += `
      <a href="https://maps.google.com/?q=Stocka+WMS+Santiago+Chile" target="_blank" class="contact-item">
        <div class="contact-icon"><i class="ri-map-pin-fill"></i></div>
        <div class="contact-info">
          <span class="contact-label">Ubicación y Bodegas</span>
          <span class="contact-value">Santiago, Chile</span>
        </div>
      </a>
    `;

    const htmlContent = `
      <div class="card-cover">
        <div class="brand-logo">
          <i class="ri-box-3-fill"></i> STOCKA
        </div>
        <div class="verified-badge">
          <i class="ri-checkbox-circle-fill"></i> Verificado
        </div>
      </div>

      <div class="profile-header">
        <div class="avatar-wrapper">
          ${avatarHTML}
          <div class="status-dot" title="Equipo Oficial Stocka"></div>
        </div>
        <h1 class="profile-name">${escapeHtml(fullName)}</h1>
        <div class="profile-role">${escapeHtml(jobTitle)}</div>
        <div class="profile-company">
          <i class="ri-building-line"></i> ${escapeHtml(company)}
        </div>
        ${bio ? `<p class="bio-text">${escapeHtml(bio)}</p>` : ''}
      </div>

      <div class="cta-container">
        <button id="btn-save-vcard" class="btn-vcard-save">
          <i class="ri-user-add-line" style="font-size: 1.2rem;"></i> Guardar en Contactos
        </button>
      </div>

      <div class="contact-grid">
        ${contactItemsHTML}
      </div>

      <div class="card-footer">
        Powered by <a href="https://wms.stocka.cl" target="_blank">Stocka WMS</a> — Fulfillment & Logística
      </div>
    `;

    contentEl.innerHTML = htmlContent;
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

    // Vincular evento de guardar contacto (.vcf)
    const saveBtn = document.getElementById('btn-save-vcard');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => downloadVCardFile(worker));
    }
  }

  // Generar y descargar archivo .vcf (vCard 3.0 estándar)
  function downloadVCardFile(worker) {
    const fullName = worker.full_name || 'Colaborador Stocka';
    const jobTitle = worker.job_title || 'Equipo Stocka';
    const company = worker.custom_company || (worker.comercio && worker.comercio !== 'no asignado' ? worker.comercio : 'Stocka WMS Chile');
    const email = worker.public_email || worker.email || '';
    const phone = worker.work_phone || worker.phone || '';
    const bio = worker.bio_summary || 'Contacto oficial verificado del equipo de Stocka WMS Chile.';

    // Formatear archivo VCF vCard 3.0
    const vcardString = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN;CHARSET=UTF-8:${fullName}`,
      `N;CHARSET=UTF-8:${fullName.split(' ').reverse().join(';')}`,
      `TITLE;CHARSET=UTF-8:${jobTitle}`,
      `ORG;CHARSET=UTF-8:${company}`,
      email ? `EMAIL;TYPE=WORK,INTERNET:${email}` : '',
      phone ? `TEL;TYPE=CELL,VOICE:${phone}` : '',
      'URL:https://wms.stocka.cl',
      `NOTE;CHARSET=UTF-8:${bio}`,
      'END:VCARD'
    ].filter(Boolean).join('\r\n');

    const blob = new Blob([vcardString], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    // Formatear nombre de archivo
    const safeFileName = fullName.toLowerCase().replace(/[^a-z0-0]/g, '_');
    link.href = url;
    link.setAttribute('download', `${safeFileName}_stocka.vcf`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
});
