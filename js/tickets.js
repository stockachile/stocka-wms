import supabase from './supabase.js';
import {
  STOCKA_TICKETS_EMAIL,
  getConfiguredSlaHours,
  setConfiguredSlaHours,
  computeTicketSlaStatus,
  sendTicketCreatedEmail,
  sendTicketSlaAlertEmail,
  sendTicketClientUpdateEmail,
  checkAndNotifyOverdueTickets
} from './ticket_notifications.js';

// ==========================================
// HELPERS Y CONSTANTES COMPARTIDAS
// ==========================================

const CATEGORIES = {
  'facturacion': { label: 'Facturación y Cobros', icon: 'ri-bill-line', color: 'var(--color-accent)' },
  'incidencia': { label: 'Incidencias de Bodega', icon: 'ri-error-warning-line', color: 'var(--color-danger)' },
  'pedidos': { label: 'Consultas sobre Pedidos', icon: 'ri-shopping-bag-line', color: 'var(--color-primary)' },
  'otros': { label: 'Otras Consultas', icon: 'ri-question-line', color: 'var(--color-text-muted)' }
};

const PRIORITIES = {
  'baja': { label: 'Baja', class: 'badge-priority-baja' },
  'media': { label: 'Media', class: 'badge-priority-media' },
  'alta': { label: 'Alta', class: 'badge-priority-alta' },
  'urgente': { label: 'Urgente', class: 'badge-priority-urgente' }
};

const STATUSES = {
  'abierto': { label: 'Abierto', class: 'badge-status-abierto' },
  'en_proceso': { label: 'En Proceso', class: 'badge-status-en_proceso' },
  'resuelto': { label: 'Resuelto', class: 'badge-status-resuelto' },
  'cerrado': { label: 'Cerrado', class: 'badge-status-cerrado' }
};

const QUICK_REPLY_TEMPLATES = [
  {
    label: '📦 En revisión con Bodega',
    text: 'Hola, hemos recibido tu caso y lo estamos revisando directamente con el equipo de operaciones en bodega. Te daremos una actualización a la brevedad.',
    internal: false
  },
  {
    label: '🚚 Dirección actualizada y reenvío',
    text: 'Hola, hemos actualizado los datos de despacho del pedido indicado y coordinado su reenvío en la próxima salida programada.',
    internal: false
  },
  {
    label: '💚 Confirmar Saldo a Favor',
    text: 'Hola, tras verificar los antecedentes del caso hemos aplicado un Saldo a Favor (Descuento) en tu cuenta comercial, el cual verás reflejado en tu módulo de Facturación.',
    internal: false
  },
  {
    label: '🧾 Confirmar Cargo Extraordinario',
    text: 'Hola, hemos gestionado tu solicitud. Te informamos que se ha registrado el cargo operativo asociado en la sección de Saldos Adicionales de tu Facturación.',
    internal: false
  },
  {
    label: '🔒 Nota Interna Operaciones',
    text: '[NOTA INTERNA] Caso revisado por soporte. Validar en terreno antes de cerrar.',
    internal: true
  }
];

function formatCLP(val) {
  return '$' + Number(val || 0).toLocaleString('es-CL');
}

// Formatear fechas
function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Obtener badge HTML para Prioridad
function getPriorityBadge(priority) {
  const p = PRIORITIES[priority] || { label: priority, class: 'badge-priority-media' };
  return `<span class="item-status ${p.class}">${p.label}</span>`;
}

// Obtener badge HTML para Estado
function getStatusBadge(status) {
  const s = STATUSES[status] || { label: status, class: 'badge-status-abierto' };
  return `<span class="item-status ${s.class}">${s.label}</span>`;
}

// Obtener badge HTML para Saldo asociado al ticket (extra_billing_charges)
function getTicketBalanceBadgeHtml(charges = []) {
  if (!charges || charges.length === 0) return '';
  return charges.map(c => {
    const isDesc = c.tipo === 'descuento';
    const ivaStr = c.iva_tipo === 'iva_incluido' ? 'IVA Incl.' : '+ IVA';
    const statusStr = c.status === 'cobrado' ? 'Aplicado' : 'Pendiente';
    if (isDesc) {
      return `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: rgba(16, 185, 129, 0.14); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);" title="${escapeHtml(c.detalle)} (${statusStr})">
        <i class="ri-arrow-down-circle-line"></i> Saldo a Favor: -${formatCLP(c.monto)} (${ivaStr})
      </span>`;
    }
    return `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: rgba(239, 68, 68, 0.14); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);" title="${escapeHtml(c.detalle)} (${statusStr})">
      <i class="ri-arrow-up-circle-line"></i> Cargo: ${formatCLP(c.monto)} (${ivaStr})
    </span>`;
  }).join(' ');
}

// Renderizar cuerpo del mensaje enriquecido (con soporte para fotos adjuntas y avisos de resolución financiera)
function formatChatMessageBody(rawText) {
  const clean = stripRedZoneJsonBlock(rawText || '');
  let escaped = escapeHtml(clean);

  // Convertir "[Foto Adjunta...]: https://..." o "[Archivo Adjunto]: https://..." en vista previa clicable
  escaped = escaped.replace(
    /\[(?:Foto|Archivo|Imagen)[^\]]*\]:\s*(https?:\/\/[^\s<]+)/gi,
    (match, url) => {
      const isImg = /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url);
      if (isImg) {
        return `<div style="margin-top: 0.5rem;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="display: inline-block;"><img src="${url}" alt="Adjunto del ticket" style="max-width: 240px; max-height: 180px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25); object-fit: cover;"></a></div>`;
      }
      return `<div style="margin-top: 0.4rem;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; font-weight: 600;"><i class="ri-attachment-2"></i> Ver archivo adjunto</a></div>`;
    }
  );

  return escaped.replace(/\n/g, '<br>');
}

// Consultar saldos de extra_billing_charges vinculados a una lista de tickets por su código corto [#xxxxxx]
async function fetchTicketLinkedChargesMap(tickets = []) {
  const map = {};
  if (!tickets || tickets.length === 0) return map;
  try {
    const { data: charges, error } = await supabase
      .from('extra_billing_charges')
      .select('*')
      .ilike('detalle', '%Ticket #%')
      .order('created_at', { ascending: false });

    if (error || !charges) return map;

    tickets.forEach(t => {
      const shortCode = (t.id || '').substring(0, 6).toLowerCase();
      if (!shortCode) return;
      const matched = charges.filter(c => (c.detalle || '').toLowerCase().includes(`ticket #${shortCode}`));
      if (matched.length > 0) {
        map[t.id] = matched;
      }
    });
  } catch (err) {
    console.warn('Advertencia al consultar saldos asociados a tickets:', err);
  }
  return map;
}

// ==========================================
// VISTA CLIENTE (DASHBOARD)
// ==========================================

export async function renderTicketsClient(appContent) {
  if (!appContent) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    appContent.innerHTML = '<div class="alert alert-error">Sesión no activa. Por favor inicia sesión nuevamente.</div>';
    return;
  }

  const userId = session.user.id;
  
  // Obtener perfil para saber el comercio del usuario
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
  const userComercio = profile?.comercio || 'no asignado';
  const commerceList = (userComercio && userComercio !== 'no asignado' && userComercio !== 'all')
    ? userComercio.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // Obtener datos del KAM asignado al comercio desde comercios_adicional_config
  let kamData = {
    hasKam: false,
    nombre: 'Sin KAM Asignado',
    email: 'gestion@stocka.cl',
    telefono: '+56 9 8135 4550',
    notas: '',
    roleLabel: 'Soporte General'
  };

  let targetCommerce = window.activeAdminComercio || localStorage.getItem('selectedComercio') || null;
  if (!targetCommerce && commerceList.length > 0) {
    targetCommerce = commerceList[0];
  } else if (!targetCommerce && userComercio && userComercio !== 'no asignado' && userComercio !== 'all') {
    targetCommerce = userComercio.split(',')[0].trim();
  }

  if (targetCommerce) {
    try {
      const { data: config } = await supabase
        .from('comercios_adicional_config')
        .select('kam_nombre, kam_email, kam_telefono, kam_notas')
        .eq('comercio', targetCommerce)
        .maybeSingle();

      if (config && config.kam_nombre && config.kam_nombre.trim()) {
        kamData.hasKam = true;
        kamData.nombre = config.kam_nombre.trim();
        kamData.email = (config.kam_email && config.kam_email.trim()) ? config.kam_email.trim() : 'gestion@stocka.cl';
        kamData.telefono = (config.kam_telefono && config.kam_telefono.trim()) ? config.kam_telefono.trim() : '+56 9 8135 4550';
        kamData.notas = (config.kam_notas && config.kam_notas.trim()) ? config.kam_notas.trim() : '';
        kamData.roleLabel = 'Ejecutivo KAM';
      }
    } catch (err) {
      console.error('Error al consultar datos de KAM para soporte:', err);
    }
  }

  const initials = kamData.hasKam 
    ? (kamData.nombre.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'KAM')
    : '<i class="ri-user-unfollow-line" style="font-size: 1.5rem;"></i>';

  const avatarBg = kamData.hasKam
    ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
    : 'linear-gradient(135deg, var(--color-warning), #d97706)';

  const cleanPhone = kamData.telefono.replace(/[^0-9]/g, '');
  const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : '#';
  const telUrl = cleanPhone ? `tel:+${cleanPhone}` : '#';

  // Cargar vista de listado por defecto
  showTicketList();

  // Función interna para mostrar el listado de tickets
  async function showTicketList() {
    appContent.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
        <div>
          <p style="font-size: 0.9rem; color: var(--color-text-muted);">Gestiona tus consultas, incidencias y requerimientos de soporte</p>
        </div>
        <button id="btn-new-ticket" class="btn btn-primary">
          <i class="ri-add-line" style="margin-right: 0.25rem; font-size: 1.1rem; vertical-align: middle;"></i> Nuevo Caso
        </button>
      </div>

      <div class="ticket-layout-split">
        <!-- Lado izquierdo: Tarjeta KAM -->
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <div class="card" style="height: fit-content; text-align: center; padding: 1.5rem 1.25rem;">
            <div class="card-body" style="padding: 0;">
              <div style="width: 60px; height: 60px; border-radius: 50%; background: ${avatarBg}; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; font-weight: 700; margin: 0 auto 0.75rem; box-shadow: var(--shadow-glow);">
                ${initials}
              </div>
              <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 0.15rem; color: var(--color-text-main);">${kamData.nombre}</h3>
              <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">${kamData.roleLabel}</p>
              
              <hr style="border: 0; border-top: 1px solid var(--color-border); margin-bottom: 1rem;">
              
              <div style="text-align: left; display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.25rem;">
                <a href="mailto:${kamData.email}" class="kam-link" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--color-text-main); text-decoration: none; padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background-color: var(--color-bg); transition: var(--transition-theme);">
                  <i class="ri-mail-line" style="font-size: 1.1rem; color: var(--color-primary);"></i>
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${kamData.email}</span>
                </a>
                <a href="${whatsappUrl}" target="_blank" class="kam-link" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--color-text-main); text-decoration: none; padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background-color: var(--color-bg); transition: var(--transition-theme);">
                  <i class="ri-whatsapp-line" style="font-size: 1.1rem; color: var(--color-success);"></i>
                  <span style="flex: 1;">${kamData.telefono}</span>
                </a>
              </div>
              
              <div style="display: flex; gap: 0.5rem;">
                <a href="${whatsappUrl}" target="_blank" class="btn btn-primary btn-sm" style="flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem; font-size: 0.75rem; padding: 0.5rem;">
                  <i class="ri-message-3-line"></i> WhatsApp
                </a>
                <a href="${telUrl}" class="btn btn-outline btn-sm" style="padding: 0.5rem; min-width: auto; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;" title="Llamar">
                  <i class="ri-phone-line"></i>
                </a>
              </div>
              
              ${kamData.notas ? `
              <p style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.75rem; line-height: 1.35; text-align: left; background: var(--color-bg); padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
                <i class="ri-sticky-note-line" style="color: var(--color-primary);"></i> ${kamData.notas}
              </p>` : ''}

              <p style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 1rem; line-height: 1.35; text-align: left;">
                <i class="ri-information-line" style="color: ${kamData.hasKam ? 'var(--color-primary)' : 'var(--color-warning)'};"></i> ${kamData.hasKam ? 'Contacta a tu KAM para consultas comerciales, tarifas y negociaciones especiales.' : 'Tu comercio aún no tiene un KAM asignado. Puedes contactar al equipo de Soporte General para cualquier consulta.'}
              </p>
            </div>
          </div>
        </div>

        <!-- Lado derecho: Filtros y Tabla -->
        <div>
          <div class="card" style="margin-bottom: 1.5rem;">
            <div class="card-body" style="padding: 1rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
              <div style="flex: 1; min-width: 200px; position: relative;">
                <input type="text" id="search-ticket-subject" class="form-input" placeholder="Buscar por asunto..." style="padding-left: 2.25rem;">
                <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
              </div>
              <div style="width: 160px;">
                <select id="filter-ticket-status" class="form-input">
                  <option value="todos">Todos los Estados</option>
                  <option value="abierto">Abiertos</option>
                  <option value="en_proceso">En Proceso</option>
                  <option value="resuelto">Resueltos</option>
                  <option value="cerrado">Cerrados</option>
                </select>
              </div>
              <div style="width: 160px;">
                <select id="filter-ticket-category" class="form-input">
                  <option value="todos">Todas las Categorías</option>
                  <option value="facturacion">Facturación y Cobros</option>
                  <option value="incidencia">Incidencias de Bodega</option>
                  <option value="pedidos">Consultas sobre Pedidos</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-body" style="padding: 0; overflow-x: auto;">
              <table class="data-table" style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr>
                    <th>Asunto</th>
                    <th>Categoría</th>
                    <th style="text-align: center;">Prioridad</th>
                    <th style="text-align: center;">Estado</th>
                    <th>Fecha de Creación</th>
                    <th>Última Actividad</th>
                    <th style="text-align: right;">Acciones</th>
                  </tr>
                </thead>
                <tbody id="tickets-table-body">
                  <tr>
                    <td colspan="7" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
                      <i class="ri-loader-4-line spin" style="font-size: 2rem;"></i><br>Cargando casos de soporte...
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    // Eventos
    document.getElementById('btn-new-ticket').addEventListener('click', showCreateForm);
    document.getElementById('search-ticket-subject').addEventListener('input', fetchAndRenderTickets);
    document.getElementById('filter-ticket-status').addEventListener('change', fetchAndRenderTickets);
    document.getElementById('filter-ticket-category').addEventListener('change', fetchAndRenderTickets);

    // Cargar los datos
    await fetchAndRenderTickets();
  }

  // Obtener tickets de la base de datos y pintarlos en la tabla
  async function fetchAndRenderTickets() {
    const tableBody = document.getElementById('tickets-table-body');
    if (!tableBody) return;

    const searchTerm = document.getElementById('search-ticket-subject').value.trim().toLowerCase();
    const statusFilter = document.getElementById('filter-ticket-status').value;
    const categoryFilter = document.getElementById('filter-ticket-category').value;

    try {
      let query = supabase
        .from('tickets')
        .select('*')
        .order('updated_at', { ascending: false });

      if (statusFilter !== 'todos') {
        query = query.eq('status', statusFilter);
      }
      if (categoryFilter !== 'todos') {
        query = query.eq('category', categoryFilter);
      }

      // Filtrar a nivel de base de datos según los comercios asignados al usuario
      if (userComercio !== 'all') {
        if (commerceList.length === 1) {
          query = query.or(`comercio.eq.${commerceList[0]},comercio.ilike.%${commerceList[0]}%`);
        } else if (commerceList.length > 1) {
          const orFilter = commerceList.map(c => `comercio.eq.${c},comercio.ilike.%${c}%`).join(',');
          query = query.or(orFilter);
        } else {
          // Usuario sin comercio asignado: solo sus tickets personales sin comercio
          query = query.eq('user_id', userId).eq('comercio', 'no asignado');
        }
      }

      const { data: rawTickets, error } = await query;
      if (error) throw error;

      let tickets = rawTickets || [];

      // Filtro estricto de seguridad en memoria para garantizar aislamiento total
      if (userComercio !== 'all') {
        const allowedLower = commerceList.map(c => c.toLowerCase());
        tickets = tickets.filter(t => {
          if (!t.comercio || t.comercio === 'no asignado') {
            return t.user_id === userId && commerceList.length === 0;
          }
          const tCommerces = t.comercio.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
          return tCommerces.some(tc => allowedLower.includes(tc));
        });
      }

      // Filtrar por texto en frontend si es necesario
      const filteredTickets = tickets.filter(t => 
        (t.subject && t.subject.toLowerCase().includes(searchTerm)) || 
        (t.id && t.id.substring(0, 8).toLowerCase().includes(searchTerm)) ||
        (t.comercio && t.comercio.toLowerCase().includes(searchTerm))
      );

      if (filteredTickets.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
              <i class="ri-questionnaire-line" style="font-size: 2.5rem; margin-bottom: 0.5rem; display: inline-block;"></i>
              <p>No se encontraron tickets de soporte con los filtros aplicados.</p>
            </td>
          </tr>
        `;
        return;
      }

      const linkedChargesMap = await fetchTicketLinkedChargesMap(filteredTickets);

      tableBody.innerHTML = filteredTickets.map(t => {
        const cat = CATEGORIES[t.category] || { label: t.category, color: 'var(--color-text-muted)' };
        const balanceBadge = getTicketBalanceBadgeHtml(linkedChargesMap[t.id] || []);
        return `
          <tr style="border-bottom: 1px solid var(--color-border);">
            <td style="font-weight: 500; color: var(--color-text-main);">
              <div>
                <span style="font-family: monospace; font-size: 0.8rem; color: var(--color-text-muted); margin-right: 0.25rem;">[#${t.id.substring(0, 6)}]</span>
                ${escapeHtml(t.subject)}
              </div>
              ${balanceBadge ? `<div style="margin-top: 0.25rem;">${balanceBadge}</div>` : ''}
            </td>
            <td>
              <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem;">
                <i class="${cat.icon}" style="color: ${cat.color};"></i> ${cat.label}
              </span>
            </td>
            <td style="text-align: center;">${getPriorityBadge(t.priority)}</td>
            <td style="text-align: center;">${getStatusBadge(t.status)}</td>
            <td style="font-size: 0.85rem; color: var(--color-text-muted);">${formatDate(t.created_at)}</td>
            <td style="font-size: 0.85rem; color: var(--color-text-muted);">${formatDate(t.updated_at)}</td>
            <td style="text-align: right;">
              <button class="btn btn-outline btn-sm view-ticket-btn" data-id="${t.id}" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">
                Ver Caso <i class="ri-arrow-right-s-line" style="vertical-align: middle;"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Registrar eventos para botones "Ver Caso"
      document.querySelectorAll('.view-ticket-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const ticketId = e.currentTarget.getAttribute('data-id');
          showTicketDetail(ticketId);
        });
      });

    } catch (err) {
      console.error('Error fetching tickets:', err);
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center" style="padding: 3rem; color: var(--color-danger);">
            <i class="ri-error-warning-line" style="font-size: 2rem;"></i><br>Error al cargar tickets: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  // Mostrar formulario de creación
  function showCreateForm() {
    appContent.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
        <div>
          <h2>Crear Nuevo Caso de Soporte</h2>
          <p style="font-size: 0.9rem; color: var(--color-text-muted);">Completa el formulario a continuación para levantar un caso a soporte técnico y operaciones</p>
        </div>
        <button id="btn-back-list" class="btn btn-outline">
          <i class="ri-arrow-left-line" style="margin-right: 0.25rem;"></i> Volver
        </button>
      </div>

      <div class="card" style="max-width: 700px; margin: 0 auto;">
        <div class="card-body" style="padding: 2rem;">
          <form id="form-create-ticket-submit">
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 500;">Asunto / Título del Caso</label>
              <input type="text" id="ticket-subject" class="form-input" placeholder="Ej. Retraso en despacho pedido #3384 o Dudas en facturación mayo" required>
            </div>

            ${commerceList.length > 1 ? `
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 500;">Comercio Asociado</label>
              <select id="ticket-commerce" class="form-input" required>
                ${commerceList.map(c => `<option value="${escapeHtmlAttr(c)}" ${c === targetCommerce ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            ` : ''}

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
              <div class="form-group">
                <label class="form-label" style="font-weight: 500;">Categoría</label>
                <select id="ticket-category" class="form-input" required>
                  <option value="pedidos">Consultas sobre Pedidos</option>
                  <option value="facturacion">Facturación y Cobros</option>
                  <option value="incidencia">Incidencias de Bodega</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" style="font-weight: 500;">Prioridad</label>
                <select id="ticket-priority" class="form-input" required>
                  <option value="baja">Baja</option>
                  <option value="media" selected>Media</option>
                  <option value="alta">Alta</option>
                  <option value="urgente">Urgente (Bloqueante)</option>
                </select>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 500;">Referencia de Pedido (Opcional)</label>
              <input type="text" id="ticket-order-ref" class="form-input" placeholder="Ej. PEDIDO-48201 o Meli #193850239">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">Facilita la búsqueda a nuestros analistas si es una consulta sobre un pedido existente</span>
            </div>

            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label class="form-label" style="font-weight: 500;">Detalle del Caso / Descripción</label>
              <textarea id="ticket-desc" class="form-input" rows="6" placeholder="Describe a detalle tu caso. Por ejemplo, qué incidencias has notado, qué datos necesitas corregir o cuál es la consulta exacta." required style="resize: vertical;"></textarea>
            </div>

            <div style="display: flex; gap: 1rem; justify-content: flex-end;">
              <button type="button" id="btn-cancel-create" class="btn btn-outline">Cancelar</button>
              <button type="submit" id="btn-submit-ticket" class="btn btn-primary">
                Crear Caso <i class="ri-send-plane-line" style="margin-left: 0.25rem;"></i>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-back-list').addEventListener('click', showTicketList);
    document.getElementById('btn-cancel-create').addEventListener('click', showTicketList);
    document.getElementById('form-create-ticket-submit').addEventListener('submit', createTicketSubmit);
  }

  // Enviar el formulario a la base de datos
  async function createTicketSubmit(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-ticket');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = 'Creando... <i class="ri-loader-4-line spin" style="margin-left: 0.25rem;"></i>';

    const subject = document.getElementById('ticket-subject').value.trim();
    const category = document.getElementById('ticket-category').value;
    const priority = document.getElementById('ticket-priority').value;
    const orderId = document.getElementById('ticket-order-ref').value.trim();
    const description = document.getElementById('ticket-desc').value.trim();

    let selectedCommerce = targetCommerce;
    const selectEl = document.getElementById('ticket-commerce');
    if (selectEl && selectEl.value) {
      selectedCommerce = selectEl.value;
    } else if (commerceList.length > 0) {
      selectedCommerce = commerceList[0];
    } else {
      selectedCommerce = userComercio || 'no asignado';
    }

    try {
      // 1. Insertar el ticket
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          user_id: userId,
          comercio: selectedCommerce,
          subject: subject,
          category: category,
          priority: priority,
          description: description,
          order_id: orderId || null,
          status: 'abierto'
        })
        .select()
        .single();

      if (ticketError) throw ticketError;

      // 2. Insertar el mensaje inicial en ticket_messages
      const { error: msgError } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticket.id,
          sender_id: userId,
          message: description,
          is_internal: false
        });

      if (msgError) throw msgError;

      // 3. Enviar aviso automático por correo a stockachile@gmail.com
      sendTicketCreatedEmail(supabase, {
        ...ticket,
        clientName: profile?.full_name || profile?.company_name || session.user.email,
        clientEmail: profile?.email || session.user.email
      }).catch(e => console.warn('Advertencia enviando correo de nuevo ticket:', e));

      alert('¡Caso creado exitosamente! Nuestro equipo de operaciones ha sido notificado y lo atenderá a la brevedad.');
      showTicketList();

    } catch (err) {
      console.error('Error creating ticket:', err);
      alert('Error al crear el caso: ' + err.message);
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = 'Crear Caso <i class="ri-send-plane-line" style="margin-left: 0.25rem;"></i>';
    }
  }

  // Mostrar detalle del ticket (chat)
  async function showTicketDetail(ticketId) {
    appContent.innerHTML = `
      <div style="padding: 2rem 5rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-loader-4-line spin" style="font-size: 2.5rem;"></i><br>Cargando detalle del caso...
      </div>
    `;

    try {
      // 1. Obtener ticket con el nombre de perfil asignado
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('*, assigned:profiles!assigned_to(full_name)')
        .eq('id', ticketId)
        .single();

      if (ticketError) throw ticketError;

      // Validación de aislamiento multitenant: asegurar que el ticket pertenezca al comercio del usuario
      if (userComercio !== 'all') {
        const allowedLower = commerceList.map(c => c.toLowerCase());
        const tCommerces = (ticket.comercio || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
        const hasAccess = tCommerces.some(tc => allowedLower.includes(tc)) || 
                          (ticket.user_id === userId && commerceList.length === 0);

        if (!hasAccess) {
          appContent.innerHTML = `
            <div class="card" style="max-width: 600px; margin: 3rem auto; padding: 2.5rem; text-align: center;">
              <div style="width: 64px; height: 64px; background: rgba(239, 68, 68, 0.1); color: var(--color-danger); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto; font-size: 2rem;">
                <i class="ri-lock-2-line"></i>
              </div>
              <h3 style="font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--color-text-main);">Acceso no autorizado</h3>
              <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1.5rem;">
                Este caso de soporte pertenece a otro comercio (${escapeHtml(ticket.comercio || 'otro')}) y no corresponde a tu cuenta actual.
              </p>
              <button id="btn-back-unauthorized" class="btn btn-primary">
                <i class="ri-arrow-left-line" style="margin-right: 0.25rem;"></i> Volver a Mis Tickets
              </button>
            </div>
          `;
          document.getElementById('btn-back-unauthorized')?.addEventListener('click', showTicketList);
          return;
        }
      }

      const cat = CATEGORIES[ticket.category] || { label: ticket.category, icon: 'ri-question-line', color: 'var(--color-text-muted)' };
      const assignedName = ticket.assigned?.full_name || 'Sin Asignar (Equipo de Operaciones)';

      appContent.innerHTML = `
        <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button id="btn-back-to-list" class="btn btn-outline" style="padding: 0.5rem; border-radius: 50%; min-width: auto; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center;">
              <i class="ri-arrow-left-line" style="font-size: 1.2rem;"></i>
            </button>
            <div>
              <h2 style="font-size: 1.25rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem; color: var(--color-text-main);">
                <span style="font-family: monospace; font-size: 0.95rem; color: var(--color-text-muted);">[#${ticket.id.substring(0, 6)}]</span>
                ${escapeHtml(ticket.subject)}
              </h2>
              <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.25rem;">
                <span style="font-size: 0.8rem; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="${cat.icon}" style="color: ${cat.color};"></i> ${cat.label}
                </span>
                <span style="color: var(--color-border);">|</span>
                <span style="font-size: 0.8rem; color: var(--color-text-muted);">Última actividad: ${formatDate(ticket.updated_at)}</span>
              </div>
            </div>
          </div>
          <div class="ticket-card-header-actions">
            ${ticket.status !== 'cerrado' ? `<button id="btn-close-ticket" class="btn btn-outline" style="border-color: var(--color-danger); color: var(--color-danger);"><i class="ri-close-circle-line" style="margin-right: 0.25rem; vertical-align: middle;"></i> Cerrar Ticket</button>` : ''}
          </div>
        </div>

        <div class="ticket-detail-layout">
          <!-- Area de Conversación -->
          <div>
            <div class="chat-container">
              <div class="chat-header">
                <span style="font-weight: 600; font-size: 0.9rem; color: var(--color-text-main);">Canal de Conversación Directa</span>
                <span id="chat-ticket-status-badge">${getStatusBadge(ticket.status)}</span>
              </div>
              <div class="chat-messages" id="chat-messages-box">
                <!-- Mensajes dinámicos -->
              </div>
              <div class="chat-input-area">
                ${ticket.status === 'cerrado' ? `
                  <div style="text-align: center; padding: 0.5rem; color: var(--color-text-muted); font-size: 0.85rem; font-weight: 500;">
                    Este ticket está cerrado. Si necesitas más ayuda, puedes abrir un nuevo caso.
                  </div>
                ` : `
                  <form id="chat-reply-form">
                    <div class="chat-input-wrapper">
                      <textarea id="chat-reply-input" class="chat-input-textarea" placeholder="Escribe tu mensaje para el equipo de soporte..." rows="1" required></textarea>
                      <button type="submit" id="chat-send-btn" class="btn btn-primary" style="height: 44px; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; width: 44px; padding: 0; border-radius: var(--radius-md);">
                        <i class="ri-send-plane-2-line" style="font-size: 1.2rem;"></i>
                      </button>
                    </div>
                  </form>
                `}
              </div>
            </div>
          </div>

          <!-- Panel de Información en Sidebar -->
          <div class="ticket-sidebar-panel">
            <h3 style="font-size: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem; margin-bottom: 0.75rem;">Detalle del Caso</h3>
            
            <div class="ticket-info-row">
              <span class="ticket-sidebar-info-label" style="color: var(--color-text-muted); font-size: 0.85rem;">Prioridad</span>
              <span class="ticket-sidebar-info-value">${getPriorityBadge(ticket.priority)}</span>
            </div>
            
            <div class="ticket-info-row">
              <span class="ticket-sidebar-info-label" style="color: var(--color-text-muted); font-size: 0.85rem;">Pedido Ref.</span>
              <span class="ticket-sidebar-info-value" style="font-weight: 500;">${ticket.order_id ? escapeHtml(ticket.order_id) : 'Ninguno'}</span>
            </div>

            <div class="ticket-info-row" style="flex-direction: column; gap: 0.25rem;">
              <span class="ticket-sidebar-info-label" style="color: var(--color-text-muted); font-size: 0.85rem;">Agente Asignado</span>
              <span class="ticket-sidebar-info-value" style="font-weight: 600; color: var(--color-primary); display: flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; margin-top: 0.25rem;">
                <i class="ri-user-follow-line"></i> ${escapeHtml(assignedName)}
              </span>
            </div>

            <div class="ticket-info-row" style="flex-direction: column; gap: 0.25rem; border-bottom: none;">
              <span class="ticket-sidebar-info-label" style="color: var(--color-text-muted); font-size: 0.85rem;">Fecha de Creación</span>
              <span class="ticket-sidebar-info-value" style="font-size: 0.85rem; margin-top: 0.15rem;">${formatDate(ticket.created_at)}</span>
            </div>

            <div style="background-color: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-top: 1.5rem; font-size: 0.8rem; color: var(--color-text-muted);">
              <i class="ri-information-line" style="color: var(--color-primary); margin-right: 0.25rem;"></i>
              Los cambios en el estado del caso gatillan notificaciones inmediatas.
            </div>
          </div>
        </div>
      `;

      // Registrar Eventos
      document.getElementById('btn-back-to-list').addEventListener('click', showTicketList);

      const btnClose = document.getElementById('btn-close-ticket');
      if (btnClose) {
        btnClose.addEventListener('click', () => closeTicket(ticketId));
      }

      const replyForm = document.getElementById('chat-reply-form');
      if (replyForm) {
        replyForm.addEventListener('submit', (e) => sendTicketMessage(e, ticketId));
      }

      // Auto-redimensionar textarea de chat
      const replyInput = document.getElementById('chat-reply-input');
      if (replyInput) {
        replyInput.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = (this.scrollHeight - 4) + 'px';
        });
      }

      // Cargar mensajes en el chat
      await loadChatMessages(ticketId, ticket);

      // Realtime subscription (opcional para el chat, pero útil)
      subscribeToTicketMessages(ticketId);

    } catch (err) {
      console.error('Error rendering ticket detail:', err);
      appContent.innerHTML = `<div class="alert alert-error">Error al cargar detalle del ticket: ${err.message}</div>`;
    }
  }

  // Cargar lista de mensajes
  async function loadChatMessages(ticketId, ticketObj = null) {
    const box = document.getElementById('chat-messages-box');
    if (!box) return;

    try {
      const { data: messages, error } = await supabase
        .from('ticket_messages')
        .select('*, sender:profiles!sender_id(full_name, role)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const cleanDesc = ticketObj?.description
        ? stripRedZoneJsonBlock(ticketObj.description)
        : '';

      if (messages.length === 0 && !cleanDesc) {
        box.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 0.9rem; padding: 2rem;">No hay mensajes en esta conversación.</div>`;
        return;
      }

      const initialBubbleHtml = (messages.length === 0 && cleanDesc) ? `
        <div class="chat-bubble own-party">
          <div class="chat-bubble-sender" style="font-size: 0.75rem; opacity: 0.85; margin-bottom: 0.25rem;">Detalle de la Solicitud</div>
          <div>${formatChatMessageBody(cleanDesc)}</div>
          <div class="chat-meta">
            <span>${formatDate(ticketObj?.created_at)}</span>
          </div>
        </div>
      ` : '';

      box.innerHTML = initialBubbleHtml + messages.map(m => {
        const isClient = m.sender?.role !== 'admin';
        const senderName = isClient ? (m.sender?.full_name || 'Tú (Cliente)') : (m.sender?.full_name || 'Operaciones Stocka');
        const bubbleClass = isClient ? 'own-party' : 'other-party';

        return `
          <div class="chat-bubble ${bubbleClass}">
            <div class="chat-bubble-sender" style="font-size: 0.75rem; opacity: 0.85; margin-bottom: 0.25rem;">${escapeHtml(senderName)}</div>
            <div>${formatChatMessageBody(m.message)}</div>
            <div class="chat-meta">
              <span>${formatDate(m.created_at)}</span>
            </div>
          </div>
        `;
      }).join('');

      // Auto scroll al fondo
      box.scrollTop = box.scrollHeight;

    } catch (err) {
      console.error('Error loading chat messages:', err);
      box.innerHTML = `<div style="text-align: center; color: var(--color-danger); padding: 1rem;">Error al cargar mensajes: ${err.message}</div>`;
    }
  }

  // Enviar mensaje en el chat
  async function sendTicketMessage(e, ticketId) {
    e.preventDefault();
    const input = document.getElementById('chat-reply-input');
    const btn = document.getElementById('chat-send-btn');
    if (!input || !input.value.trim()) return;

    const messageText = input.value.trim();
    input.disabled = true;
    btn.disabled = true;

    try {
      const { error } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: userId,
          message: messageText,
          is_internal: false
        });

      if (error) throw error;

      input.value = '';
      input.style.height = '44px';
      
      // Recargar mensajes
      await loadChatMessages(ticketId);

    } catch (err) {
      console.error('Error sending message:', err);
      alert('No se pudo enviar el mensaje: ' + err.message);
    } finally {
      input.disabled = false;
      btn.disabled = false;
      input.focus();
    }
  }

  // Cerrar el ticket desde el cliente
  async function closeTicket(ticketId) {
    if (!confirm('¿Estás seguro de que deseas marcar este caso como Resuelto/Cerrado?')) return;

    try {
      const { error } = await supabase
        .from('tickets')
        .update({ status: 'cerrado' })
        .eq('id', ticketId);

      if (error) throw error;

      // Opcional: Agregar mensaje automático de sistema
      await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: userId,
          message: 'El cliente ha cerrado este ticket.',
          is_internal: false
        });

      alert('El caso ha sido cerrado.');
      showTicketDetail(ticketId);

    } catch (err) {
      console.error('Error closing ticket:', err);
      alert('Error al cerrar el ticket: ' + err.message);
    }
  }

  // Realtime subscription helper
  let ticketSubscription = null;
  function subscribeToTicketMessages(ticketId) {
    try {
      if (ticketSubscription && typeof supabase.removeChannel === 'function') {
        supabase.removeChannel(ticketSubscription);
        ticketSubscription = null;
      }

      if (typeof supabase.channel === 'function') {
        ticketSubscription = supabase
          .channel(`ticket_messages_realtime:${ticketId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${ticketId}` },
            () => {
              loadChatMessages(ticketId);
            }
          )
          .subscribe();
      }
    } catch (err) {
      console.warn('Advertencia en suscripción de tickets realtime:', err);
    }
  }
}

// ==========================================
// VISTA ADMINISTRADOR (ADMIN PANEL)
// ==========================================

export async function renderTicketsAdmin(appContent) {
  if (!appContent) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    appContent.innerHTML = '<div class="alert alert-error">Sesión no activa. Por favor inicia sesión nuevamente.</div>';
    return;
  }

  const userId = session.user.id;
  let adminProfiles = []; // Lista de administradores para el selector
  let currentQuickFilter = 'all'; // 'all' | 'overdue' | 'unassigned' | 'alta'
  let latestOverdueTickets = [];

  // Cargar lista de tickets general por defecto
  showAdminTicketList();

  async function showAdminTicketList() {
    const currentSlaHrs = getConfiguredSlaHours();

    appContent.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
        <div>
          <p style="font-size: 0.9rem; color: var(--color-text-muted); margin: 0;">Bandeja de atención de incidencias, facturación, control de SLA y saldos comerciales de todos los clientes</p>
        </div>
        <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: var(--color-surface); border: 1px solid var(--color-border); padding: 0.45rem 0.75rem; border-radius: var(--radius-md);">
          <span style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted);"><i class="ri-timer-flash-line" style="color: var(--color-primary);"></i> Umbral Alerta Sin Respuesta:</span>
          <div style="display: inline-flex; gap: 0.25rem;">
            ${[4, 12, 24, 48].map(h => `
              <button type="button" class="sla-threshold-btn" data-hours="${h}" style="padding: 0.2rem 0.55rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer; border: 1px solid ${currentSlaHrs === h ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${currentSlaHrs === h ? 'rgba(94, 23, 235, 0.14)' : 'var(--color-bg)'}; color: ${currentSlaHrs === h ? 'var(--color-primary)' : 'var(--color-text-muted)'};">
                ${h}h
              </button>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Banner de Alerta de Tickets Desatendidos (SLA Vencido) -->
      <div id="admin-sla-overdue-banner" style="display: none; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: var(--radius-lg); padding: 1rem 1.25rem; margin-bottom: 1.25rem; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div style="display: flex; align-items: center; gap: 0.85rem;">
          <div class="ticket-sla-pulse" style="width: 42px; height: 42px; border-radius: 10px; background: rgba(239, 68, 68, 0.18); color: #ef4444; display: flex; align-items: center; justify-content: center; font-size: 1.35rem; flex-shrink: 0;">
            <i class="ri-alarm-warning-fill"></i>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <strong style="font-size: 0.92rem; color: #ef4444;">ALERTA DE TICKETS SIN ATENDER (SLA VENCIDO)</strong>
              <span id="admin-sla-banner-count" style="background: #ef4444; color: #fff; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 99px;">0 casos</span>
            </div>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
              Existen casos abiertos que superan el tiempo máximo sin respuesta (<strong id="admin-sla-banner-hours">${currentSlaHrs}h</strong>). Avisos configurados hacia <strong>${STOCKA_TICKETS_EMAIL}</strong>.
            </p>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <button type="button" id="btn-banner-filter-overdue" class="btn btn-sm" style="background: #ef4444; color: #fff; border: none; font-size: 0.78rem; font-weight: 700; padding: 0.45rem 0.85rem;">
            <i class="ri-filter-3-line"></i> Ver solo desatendidos
          </button>
          <button type="button" id="btn-banner-send-sla-email" class="btn btn-outline btn-sm" style="border-color: rgba(239, 68, 68, 0.5); color: #ef4444; font-size: 0.78rem; font-weight: 600; padding: 0.45rem 0.85rem;">
            <i class="ri-mail-send-line"></i> Enviar Alerta a ${STOCKA_TICKETS_EMAIL}
          </button>
        </div>
      </div>

      <!-- Tarjetas KPI Superiores -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.85rem; margin-bottom: 1.25rem;">
        <div class="card" style="padding: 1rem 1.15rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 600;">Tickets Activos</span>
            <span style="font-size: 0.7rem; background: rgba(37, 99, 235, 0.12); color: var(--color-primary); padding: 2px 7px; border-radius: 6px; font-weight: 700;">Bandeja</span>
          </div>
          <div id="kpi-tickets-open" style="font-size: 1.65rem; font-weight: 800; color: var(--color-text-main); margin-top: 0.35rem;">—</div>
          <div id="kpi-tickets-open-sub" style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">Abiertos y en proceso</div>
        </div>

        <div class="card" style="padding: 1rem 1.15rem; border-color: rgba(239, 68, 68, 0.35);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.78rem; color: #ef4444; font-weight: 700;">Sin Respuesta (SLA Vencido)</span>
            <i class="ri-time-line" style="color: #ef4444; font-size: 1rem;"></i>
          </div>
          <div id="kpi-tickets-overdue" style="font-size: 1.65rem; font-weight: 800; color: #ef4444; margin-top: 0.35rem;">—</div>
          <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">Superan umbral de <span id="kpi-sla-hours-label">${currentSlaHrs}h</span></div>
        </div>

        <div class="card" style="padding: 1rem 1.15rem; border-color: rgba(245, 158, 11, 0.35);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.78rem; color: #f59e0b; font-weight: 700;">Sin Asignar</span>
            <i class="ri-user-unfollow-line" style="color: #f59e0b; font-size: 1rem;"></i>
          </div>
          <div id="kpi-tickets-unassigned" style="font-size: 1.65rem; font-weight: 800; color: #f59e0b; margin-top: 0.35rem;">—</div>
          <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">Usa "+ Tomar" para asignarte</div>
        </div>

        <div class="card" style="padding: 1rem 1.15rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 600;">Avisos y Saldos</span>
            <span style="font-size: 0.7rem; background: rgba(16, 185, 129, 0.14); color: #10b981; padding: 2px 7px; border-radius: 6px; font-weight: 700;">Activo</span>
          </div>
          <div style="font-size: 0.88rem; font-weight: 700; color: var(--color-text-main); margin-top: 0.55rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${STOCKA_TICKETS_EMAIL}</div>
          <div id="kpi-tickets-balances" style="font-size: 0.75rem; color: #10b981; margin-top: 0.25rem;">✓ Creación + SLA + Facturación</div>
        </div>
      </div>

      <!-- Barra de Filtros y Píldoras Rápidas -->
      <div class="card" style="margin-bottom: 1.25rem;">
        <div class="card-body" style="padding: 1rem; display: flex; flex-direction: column; gap: 0.85rem;">
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; justify-content: space-between;">
            <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
              <button type="button" class="admin-quick-pill" data-qfilter="all" style="padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer; border: 1px solid var(--color-primary); background: var(--color-primary); color: #fff;">
                Todos
              </button>
              <button type="button" class="admin-quick-pill" data-qfilter="overdue" style="padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.78rem; font-weight: 600; cursor: pointer; border: 1px solid rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.08); color: #ef4444;">
                🚨 SLA Vencido / Sin Respuesta
              </button>
              <button type="button" class="admin-quick-pill" data-qfilter="unassigned" style="padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.78rem; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-muted);">
                👤 Sin Asignar
              </button>
              <button type="button" class="admin-quick-pill" data-qfilter="alta" style="padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.78rem; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-muted);">
                🔥 Prioridad Alta / Urgente
              </button>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
            <div style="flex: 1; min-width: 240px; position: relative;">
              <input type="text" id="admin-search-ticket" class="form-input" placeholder="Buscar por asunto, cliente, comercio o ID..." style="padding-left: 2.25rem;">
              <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
            </div>
            <div style="width: 165px;">
              <select id="admin-filter-status" class="form-input">
                <option value="todos">Todos los Estados</option>
                <option value="abierto" selected>Abiertos</option>
                <option value="en_proceso">En Proceso</option>
                <option value="resuelto">Resueltos</option>
                <option value="cerrado">Cerrados</option>
              </select>
            </div>
            <div style="width: 165px;">
              <select id="admin-filter-category" class="form-input">
                <option value="todos">Categorías: Todas</option>
                <option value="facturacion">Facturación</option>
                <option value="incidencia">Incidencias</option>
                <option value="pedidos">Pedidos</option>
                <option value="otros">Otros</option>
              </select>
            </div>
            <div style="width: 165px;">
              <select id="admin-filter-priority" class="form-input">
                <option value="todos">Prioridad: Todas</option>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-body" style="padding: 0; overflow-x: auto;">
          <table class="data-table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th>Caso / Estado Respuesta</th>
                <th>Cliente</th>
                <th>Categoría</th>
                <th style="text-align: center;">Prioridad</th>
                <th style="text-align: center;">Estado</th>
                <th>Tiempo Sin Atención (SLA)</th>
                <th>Asignado A</th>
                <th style="text-align: right;">Acciones</th>
              </tr>
            </thead>
            <tbody id="admin-tickets-table-body">
              <tr>
                <td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
                  <i class="ri-loader-4-line spin" style="font-size: 2rem;"></i><br>Cargando bandeja de soporte y métricas SLA...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Eventos de filtros
    document.getElementById('admin-search-ticket').addEventListener('input', fetchAndRenderAdminTickets);
    document.getElementById('admin-filter-status').addEventListener('change', fetchAndRenderAdminTickets);
    document.getElementById('admin-filter-category').addEventListener('change', fetchAndRenderAdminTickets);
    document.getElementById('admin-filter-priority').addEventListener('change', fetchAndRenderAdminTickets);

    // Eventos de umbral SLA
    document.querySelectorAll('.sla-threshold-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const hrs = setConfiguredSlaHours(parseInt(btn.getAttribute('data-hours'), 10));
        document.querySelectorAll('.sla-threshold-btn').forEach(b => {
          const isSel = parseInt(b.getAttribute('data-hours'), 10) === hrs;
          b.style.borderColor = isSel ? 'var(--color-primary)' : 'var(--color-border)';
          b.style.background = isSel ? 'rgba(94, 23, 235, 0.14)' : 'var(--color-bg)';
          b.style.color = isSel ? 'var(--color-primary)' : 'var(--color-text-muted)';
        });
        const bannerHrs = document.getElementById('admin-sla-banner-hours');
        const kpiHrs = document.getElementById('kpi-sla-hours-label');
        if (bannerHrs) bannerHrs.textContent = `${hrs}h`;
        if (kpiHrs) kpiHrs.textContent = `${hrs}h`;
        fetchAndRenderAdminTickets();
      });
    });

    // Eventos de píldoras rápidas
    function updateQuickPillsUI() {
      document.querySelectorAll('.admin-quick-pill').forEach(p => {
        const qf = p.getAttribute('data-qfilter');
        if (qf === currentQuickFilter) {
          p.style.background = 'var(--color-primary)';
          p.style.borderColor = 'var(--color-primary)';
          p.style.color = '#fff';
        } else if (qf === 'overdue') {
          p.style.background = 'rgba(239, 68, 68, 0.08)';
          p.style.borderColor = 'rgba(239, 68, 68, 0.35)';
          p.style.color = '#ef4444';
        } else {
          p.style.background = 'var(--color-bg)';
          p.style.borderColor = 'var(--color-border)';
          p.style.color = 'var(--color-text-muted)';
        }
      });
    }

    document.querySelectorAll('.admin-quick-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        currentQuickFilter = pill.getAttribute('data-qfilter') || 'all';
        updateQuickPillsUI();
        fetchAndRenderAdminTickets();
      });
    });

    document.getElementById('btn-banner-filter-overdue')?.addEventListener('click', () => {
      currentQuickFilter = 'overdue';
      updateQuickPillsUI();
      fetchAndRenderAdminTickets();
    });

    document.getElementById('btn-banner-send-sla-email')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!latestOverdueTickets || latestOverdueTickets.length === 0) return;
      btn.disabled = true;
      const origHtml = btn.innerHTML;
      btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Enviando...';
      const res = await sendTicketSlaAlertEmail(latestOverdueTickets, getConfiguredSlaHours());
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (res.success) {
        alert(`✅ Correo de Alerta SLA enviado a ${STOCKA_TICKETS_EMAIL} con ${latestOverdueTickets.length} caso(s) desatendido(s).`);
      } else {
        alert('No se pudo enviar el correo de alerta: ' + (res.error || res.reason));
      }
    });

    // Cargar admins primero y luego tickets
    await loadAdminProfiles();
    await fetchAndRenderAdminTickets();
  }

  // Obtener todos los tickets de todos los clientes + cálculo SLA y Saldos
  async function fetchAndRenderAdminTickets() {
    const tableBody = document.getElementById('admin-tickets-table-body');
    if (!tableBody) return;

    const searchTerm = (document.getElementById('admin-search-ticket')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('admin-filter-status')?.value || 'abierto';
    const categoryFilter = document.getElementById('admin-filter-category')?.value || 'todos';
    const priorityFilter = document.getElementById('admin-filter-priority')?.value || 'todos';
    const thresholdHours = getConfiguredSlaHours();

    try {
      let query = supabase
        .from('tickets')
        .select('*, client:profiles!user_id(company_name, full_name, email), assignee:profiles!assigned_to(full_name)')
        .order('updated_at', { ascending: false });

      if (statusFilter !== 'todos') {
        query = query.eq('status', statusFilter);
      }
      if (categoryFilter !== 'todos') {
        query = query.eq('category', categoryFilter);
      }
      if (priorityFilter !== 'todos') {
        query = query.eq('priority', priorityFilter);
      }

      const { data: rawTickets, error } = await query;
      if (error) throw error;
      const tickets = rawTickets || [];

      if (typeof window.updateAdminBadges === 'function') {
        window.updateAdminBadges();
      }

      // Obtener mensajes de los tickets cargados para evaluar quién respondió último y tiempo SLA
      const ticketIds = tickets.map(t => t.id);
      let msgsByTicket = {};
      if (ticketIds.length > 0) {
        const { data: allMsgs } = await supabase
          .from('ticket_messages')
          .select('ticket_id, created_at, is_internal, sender:profiles!sender_id(role)')
          .in('ticket_id', ticketIds);

        (allMsgs || []).forEach(m => {
          if (!msgsByTicket[m.ticket_id]) msgsByTicket[m.ticket_id] = [];
          msgsByTicket[m.ticket_id].push(m);
        });
      }

      // Calcular SLA por ticket y consultar saldos asociados en extra_billing_charges
      const linkedChargesMap = await fetchTicketLinkedChargesMap(tickets);

      tickets.forEach(t => {
        t.sla = computeTicketSlaStatus(t, msgsByTicket[t.id] || [], thresholdHours);
        t.linkedCharges = linkedChargesMap[t.id] || [];
      });

      // Actualizar KPIs y Banner de Alerta SLA
      const activeList = tickets.filter(t => t.status === 'abierto' || t.status === 'en_proceso');
      const overdueList = tickets.filter(t => t.sla?.slaState === 'overdue');
      const unassignedList = tickets.filter(t => !t.assigned_to && (t.status === 'abierto' || t.status === 'en_proceso'));
      const highPrioCount = activeList.filter(t => t.priority === 'alta' || t.priority === 'urgente').length;
      latestOverdueTickets = overdueList;

      const kpiOpenEl = document.getElementById('kpi-tickets-open');
      const kpiOpenSubEl = document.getElementById('kpi-tickets-open-sub');
      const kpiOverdueEl = document.getElementById('kpi-tickets-overdue');
      const kpiUnassignedEl = document.getElementById('kpi-tickets-unassigned');
      if (kpiOpenEl) kpiOpenEl.textContent = tickets.length;
      if (kpiOpenSubEl) kpiOpenSubEl.textContent = `${highPrioCount} de prioridad Alta / Urgente`;
      if (kpiOverdueEl) kpiOverdueEl.textContent = overdueList.length;
      if (kpiUnassignedEl) kpiUnassignedEl.textContent = unassignedList.length;

      const bannerEl = document.getElementById('admin-sla-overdue-banner');
      const bannerCountEl = document.getElementById('admin-sla-banner-count');
      if (bannerEl) {
        if (overdueList.length > 0) {
          bannerEl.style.display = 'flex';
          if (bannerCountEl) bannerCountEl.textContent = `${overdueList.length} caso${overdueList.length === 1 ? '' : 's'} vencido${overdueList.length === 1 ? '' : 's'}`;
        } else {
          bannerEl.style.display = 'none';
        }
      }

      // Disparar verificación automática de correo SLA en segundo plano si hay vencidos
      if (overdueList.length > 0) {
        checkAndNotifyOverdueTickets(supabase, { thresholdHours }).catch(() => {});
      }

      // Filtrar localmente por búsqueda y píldora rápida
      const filteredTickets = tickets.filter(t => {
        if (currentQuickFilter === 'overdue' && t.sla?.slaState !== 'overdue') return false;
        if (currentQuickFilter === 'unassigned' && t.assigned_to) return false;
        if (currentQuickFilter === 'alta' && t.priority !== 'alta' && t.priority !== 'urgente') return false;

        if (!searchTerm) return true;
        const clientName = t.client?.company_name || t.client?.full_name || '';
        const clientEmail = t.client?.email || '';
        const comercioName = t.comercio || '';
        return (
          (t.subject || '').toLowerCase().includes(searchTerm) ||
          clientName.toLowerCase().includes(searchTerm) ||
          clientEmail.toLowerCase().includes(searchTerm) ||
          comercioName.toLowerCase().includes(searchTerm) ||
          (t.id || '').toLowerCase().includes(searchTerm)
        );
      });

      if (filteredTickets.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
              <i class="ri-inbox-archive-line" style="font-size: 2.5rem; margin-bottom: 0.5rem; display: inline-block;"></i>
              <p>No hay tickets que coincidan con los filtros seleccionados.</p>
            </td>
          </tr>
        `;
        return;
      }

      tableBody.innerHTML = filteredTickets.map(t => {
        const cat = CATEGORIES[t.category] || { label: t.category, icon: 'ri-question-line', color: 'var(--color-text-muted)' };
        const clientCompany = t.client?.company_name || t.comercio || t.client?.full_name || 'Desconocido';
        const sla = t.sla || {};
        const isOverdue = sla.slaState === 'overdue';
        const isWarning = sla.slaState === 'warning';

        // Pill de estado de respuesta
        let responseStatePill = '';
        if (sla.waitingFor === 'stocka') {
          responseStatePill = `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: rgba(245, 158, 11, 0.14); color: #f59e0b;">
            <i class="ri-hourglass-fill"></i> ${sla.hasAdminReply ? 'Cliente respondió • Esperando a Stocka' : 'Sin primera respuesta de Stocka'}
          </span>`;
        } else if (sla.waitingFor === 'client') {
          responseStatePill = `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: rgba(16, 185, 129, 0.14); color: #10b981;">
            <i class="ri-check-double-line"></i> Respondido por Soporte
          </span>`;
        }

        const balanceBadges = getTicketBalanceBadgeHtml(t.linkedCharges);

        // Columna Semáforo SLA
        let slaHtml = '';
        if (sla.slaState === 'overdue') {
          slaHtml = `
            <div style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.55rem; border-radius: 8px; background: rgba(239, 68, 68, 0.14); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; font-size: 0.76rem; font-weight: 700;">
              <i class="ri-alarm-warning-fill"></i> Sin atención: ${escapeHtml(sla.elapsedText)}
            </div>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.2rem;">Últ. act: ${formatDate(t.updated_at)}</div>
          `;
        } else if (sla.slaState === 'warning') {
          slaHtml = `
            <div style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.55rem; border-radius: 8px; background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.35); color: #f59e0b; font-size: 0.76rem; font-weight: 700;">
              <i class="ri-time-line"></i> Por vencer: ${escapeHtml(sla.elapsedText)}
            </div>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.2rem;">Últ. act: ${formatDate(t.updated_at)}</div>
          `;
        } else if (sla.slaState === 'responded') {
          slaHtml = `
            <div style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.55rem; border-radius: 8px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.28); color: #10b981; font-size: 0.76rem; font-weight: 700;">
              <i class="ri-checkbox-circle-line"></i> Atendido (${escapeHtml(sla.elapsedText)})
            </div>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.2rem;">Últ. act: ${formatDate(t.updated_at)}</div>
          `;
        } else {
          slaHtml = `
            <div style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.55rem; border-radius: 8px; background: rgba(16, 185, 129, 0.12); color: #10b981; font-size: 0.76rem; font-weight: 700;">
              <i class="ri-check-line"></i> En tiempo (${escapeHtml(sla.elapsedText || '—')})
            </div>
            <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.2rem;">${formatDate(t.updated_at)}</div>
          `;
        }

        // Columna Asignado A con botón "+ Tomar" en 1 clic
        const assignedToHtml = t.assignee?.full_name
          ? `<span style="font-weight: 600; color: var(--color-text-main); display: inline-flex; align-items: center; gap: 0.25rem;"><i class="ri-user-follow-line" style="color: var(--color-success);"></i> ${escapeHtml(t.assignee.full_name)}</span>`
          : `<div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
               <span style="color: var(--color-warning); font-style: italic; font-size: 0.8rem;">Sin Asignar</span>
               <button type="button" class="quick-take-ticket-btn" data-id="${t.id}" style="padding: 2px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer; border: 1px solid rgba(94, 23, 235, 0.35); background: rgba(94, 23, 235, 0.1); color: var(--color-primary);" title="Asignarme este ticket y pasarlo a En Proceso">
                 + Tomar
               </button>
             </div>`;

        return `
          <tr style="border-bottom: 1px solid var(--color-border); ${isOverdue ? 'background: rgba(239, 68, 68, 0.03);' : (isWarning ? 'background: rgba(245, 158, 11, 0.02);' : '')}">
            <td style="font-weight: 500; color: var(--color-text-main);">
              <div>
                <span style="font-family: monospace; font-size: 0.8rem; color: var(--color-text-muted); margin-right: 0.25rem;">[#${t.id.substring(0, 6)}]</span>
                ${escapeHtml(t.subject)}
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.3rem;">
                ${responseStatePill}
                ${balanceBadges}
              </div>
            </td>
            <td style="font-weight: 500;">
              ${escapeHtml(clientCompany)}
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block;">${escapeHtml(t.client?.email || '')}</span>
            </td>
            <td>
              <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem;">
                <i class="${cat.icon}" style="color: ${cat.color};"></i> ${cat.label}
              </span>
            </td>
            <td style="text-align: center;">${getPriorityBadge(t.priority)}</td>
            <td style="text-align: center;">${getStatusBadge(t.status)}</td>
            <td>${slaHtml}</td>
            <td style="font-size: 0.85rem;">${assignedToHtml}</td>
            <td style="text-align: right;">
              <button class="btn btn-primary btn-sm attend-ticket-btn" data-id="${t.id}" style="padding: 0.3rem 0.65rem; font-size: 0.8rem;">
                Atender <i class="ri-question-answer-line" style="vertical-align: middle; margin-left: 0.25rem;"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Evento botón "Atender"
      document.querySelectorAll('.attend-ticket-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const ticketId = e.currentTarget.getAttribute('data-id');
          showAdminTicketDetail(ticketId);
        });
      });

      // Evento botón "+ Tomar" en 1 clic
      document.querySelectorAll('.quick-take-ticket-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ticketId = e.currentTarget.getAttribute('data-id');
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = '...';
          await updateTicketField(ticketId, { assigned_to: userId, status: 'en_proceso' });
          await fetchAndRenderAdminTickets();
        });
      });

    } catch (err) {
      console.error('Error fetching admin tickets:', err);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-danger);">
            <i class="ri-error-warning-line" style="font-size: 2rem;"></i><br>Error al cargar bandeja: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  // Cargar perfiles de admin
  async function loadAdminProfiles() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'admin');
      
      if (error) throw error;
      adminProfiles = data || [];
    } catch (err) {
      console.error('Error loading admin profiles:', err);
    }
  }

  // Ver y atender ticket (Administrador) + Módulo de Saldo a Favor / En Contra y Pedido Vinculado
  async function showAdminTicketDetail(ticketId) {
    appContent.innerHTML = `
      <div style="padding: 2rem 5rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-loader-4-line spin" style="font-size: 2.5rem;"></i><br>Cargando panel de resolución y contexto comercial...
      </div>
    `;

    try {
      // 1. Obtener ticket detallado
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('*, client:profiles!user_id(company_name, full_name, email, phone, comercio)')
        .eq('id', ticketId)
        .single();

      if (ticketError) throw ticketError;

      const shortId = ticket.id.substring(0, 6);
      const cat = CATEGORIES[ticket.category] || { label: ticket.category, icon: 'ri-question-line', color: 'var(--color-text-muted)' };
      const clientName = ticket.client?.full_name || 'Desconocido';
      const clientCompany = ticket.client?.company_name || ticket.comercio || 'Sin Comercio';
      const rawComercio = (ticket.comercio && ticket.comercio !== 'no asignado')
        ? ticket.comercio.split(',')[0].trim()
        : (ticket.client?.comercio ? ticket.client.comercio.split(',')[0].trim() : clientCompany);

      // 2. Consultar saldos ya vinculados a este ticket en extra_billing_charges
      const linkedChargesMap = await fetchTicketLinkedChargesMap([ticket]);
      const ticketCharges = linkedChargesMap[ticket.id] || [];

      // 3. Consultar períodos de facturación para el selector opcional
      let billingPeriods = [];
      try {
        const { data: pData } = await supabase
          .from('billing_periods')
          .select('id, name')
          .order('created_at', { ascending: false })
          .limit(12);
        billingPeriods = pData || [];
      } catch (e) {}

      // 4. Consultar opciones de comercio de facturación si está disponible window.getBillingCommerceOptions
      let commerceSelectHtml = `<option value="${escapeHtmlAttr(rawComercio)}" selected>${escapeHtml(rawComercio)}</option>`;
      if (typeof window.getBillingCommerceOptions === 'function') {
        try {
          const opts = await window.getBillingCommerceOptions(rawComercio);
          if (opts) {
            commerceSelectHtml = `<option value="${escapeHtmlAttr(rawComercio)}">${escapeHtml(rawComercio)} (Comercio del Ticket)</option>` + opts;
          }
        } catch (e) {}
      }

      // 5. Consultar Pedido Referenciado en tabla orders si existe order_id
      let linkedOrder = null;
      if (ticket.order_id && ticket.order_id.trim()) {
        const cleanOrderRef = ticket.order_id.trim().replace(/^#/, '');
        try {
          const { data: ordData } = await supabase
            .from('orders')
            .select('id, external_order_number, comercio, customer_name, shipping_address, comuna, status, estado_wms, shipping_method, operador, created_at')
            .or(`external_order_number.ilike.%${cleanOrderRef}%,id.eq.${cleanOrderRef.length === 36 ? cleanOrderRef : '00000000-0000-0000-0000-000000000000'}`)
            .limit(1)
            .maybeSingle();
          if (ordData) linkedOrder = ordData;
        } catch (e) {
          console.warn('No se pudo vincular orden referenciada:', e);
        }
      }

      const defaultConcept = `[Ticket #${shortId}] ${ticket.subject}${ticket.order_id ? ` (Ref: ${ticket.order_id})` : ''}`;

      appContent.innerHTML = `
        <div class="flex justify-between items-center" style="margin-bottom: 1.25rem; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button id="btn-back-to-admin-list" class="btn btn-outline" style="padding: 0.5rem; border-radius: 50%; min-width: auto; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center;">
              <i class="ri-arrow-left-line" style="font-size: 1.2rem;"></i>
            </button>
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <h2 style="font-size: 1.2rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.45rem; color: var(--color-text-main); margin: 0;">
                  <span style="font-family: monospace; font-size: 0.95rem; color: var(--color-text-muted);">[#${shortId}]</span>
                  ${escapeHtml(ticket.subject)}
                </h2>
                <span id="detail-header-sla-badge"></span>
                <span id="detail-header-balance-badges">${getTicketBalanceBadgeHtml(ticketCharges)}</span>
              </div>
              <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.25rem; flex-wrap: wrap;">
                <span style="font-size: 0.8rem; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-building-line"></i> Cliente: <strong>${escapeHtml(clientCompany)}</strong> (${escapeHtml(clientName)})
                </span>
                <span style="color: var(--color-border);">|</span>
                <span style="font-size: 0.8rem; color: var(--color-text-muted);"><i class="${cat.icon}" style="color: ${cat.color};"></i> ${cat.label}</span>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <button type="button" id="btn-scroll-to-resolution" class="btn btn-primary btn-sm" style="background: #059669; border-color: #059669; font-size: 0.8rem; font-weight: 700; padding: 0.45rem 0.9rem;">
              <i class="ri-scales-3-line" style="margin-right: 0.25rem;"></i> Resolver / Aplicar Saldo
            </button>
          </div>
        </div>

        <div class="ticket-detail-layout">
          <!-- Area del Chat de Soporte -->
          <div>
            <div class="chat-container" style="height: 660px;">
              <div class="chat-header" style="background: linear-gradient(135deg, rgba(94, 23, 235, 0.95), rgba(67, 56, 202, 0.95)); color: #fff;">
                <div>
                  <span style="font-weight: 700; font-size: 0.92rem; display: block;">Panel de Conversación de Soporte</span>
                  <span style="font-size: 0.74rem; opacity: 0.85;">Cliente a la izquierda • Respuestas de Soporte Stocka a la derecha</span>
                </div>
                <span id="chat-status-indicator">${getStatusBadge(ticket.status)}</span>
              </div>
              <div class="chat-messages" id="admin-chat-messages-box">
                <!-- Mensajes dinámicos -->
              </div>

              <!-- Plantillas de Respuesta Rápida (1 Clic) -->
              <div style="padding: 0.55rem 1.25rem; background: var(--color-bg); border-top: 1px solid var(--color-border); display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <span style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); margin-right: 0.2rem;"><i class="ri-flashlight-fill" style="color: var(--color-primary);"></i> Respuestas Rápidas:</span>
                ${QUICK_REPLY_TEMPLATES.map((tpl, idx) => `
                  <button type="button" class="quick-reply-tpl-btn" data-idx="${idx}" style="padding: 0.2rem 0.55rem; border-radius: 6px; font-size: 0.72rem; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); transition: all 0.15s;">
                    ${tpl.label}
                  </button>
                `).join('')}
              </div>

              <div class="chat-input-area">
                <form id="admin-chat-reply-form">
                  <div style="margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                      <input type="checkbox" id="chat-is-internal" style="cursor: pointer; width: 15px; height: 15px;">
                      <label for="chat-is-internal" style="font-size: 0.78rem; font-weight: 600; color: var(--color-warning); cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="ri-lock-line"></i> Nota Interna (Visible solo para Admins)
                      </label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                      <label style="font-size: 0.76rem; color: var(--color-primary); font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
                        <i class="ri-attachment-2"></i> <span id="admin-chat-file-label">Adjuntar foto/archivo</span>
                        <input type="file" id="admin-chat-file-input" accept="image/*,.pdf" style="display: none;">
                      </label>
                      <label style="font-size: 0.75rem; color: var(--color-text-muted); cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" id="chat-notify-client-email" checked style="cursor: pointer;">
                        <span>Notificar por correo al cliente</span>
                      </label>
                    </div>
                  </div>
                  <div class="chat-input-wrapper">
                    <textarea id="admin-chat-reply-input" class="chat-input-textarea" placeholder="Escribe un mensaje al cliente o selecciona una respuesta rápida arriba..." rows="1" required></textarea>
                    <button type="submit" id="admin-chat-send-btn" class="btn btn-primary" style="height: 44px; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; width: 44px; padding: 0; border-radius: var(--radius-md);">
                      <i class="ri-send-plane-2-line" style="font-size: 1.2rem;"></i>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <!-- Panel Lateral Derecho: Resolución Financiera + Pedido + Control -->
          <div style="display: flex; flex-direction: column; gap: 1rem;">

            <!-- ★ MÓDULO: RESOLUCIÓN Y SALDO A FAVOR / EN CONTRA (extra_billing_charges) ★ -->
            <div id="admin-resolution-balance-card" class="ticket-sidebar-panel" style="border: 2px solid rgba(94, 23, 235, 0.45); padding: 1.15rem;">
              <div style="border-bottom: 1px solid var(--color-border); padding-bottom: 0.65rem; margin-bottom: 0.85rem;">
                <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--color-text-main); margin: 0; display: flex; align-items: center; gap: 0.35rem;">
                  <i class="ri-scales-3-line" style="color: var(--color-primary);"></i> Resolución y Saldo Comercial
                </h3>
                <span style="font-size: 0.73rem; color: var(--color-text-muted); display: block; margin-top: 0.15rem;">
                  Agrega saldo a favor o en contra del comercio al resolver el ticket (Sincronizado con Facturación)
                </span>
              </div>

              ${ticketCharges.length > 0 ? `
                <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.6rem 0.75rem; margin-bottom: 0.85rem;">
                  <div style="font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.35rem;">Saldos ya registrados en este ticket:</div>
                  <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                    ${ticketCharges.map(c => `
                      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem;">
                        <span style="font-weight: 700; color: ${c.tipo === 'descuento' ? '#10b981' : '#ef4444'};">
                          ${c.tipo === 'descuento' ? `🟢 A Favor: -${formatCLP(c.monto)}` : `🔴 Cargo: ${formatCLP(c.monto)}`}
                        </span>
                        <span style="font-size: 0.7rem; color: var(--color-text-muted);">${c.status === 'cobrado' ? 'Aplicado' : 'Pendiente'}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <div style="margin-bottom: 0.85rem;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.4rem; display: block;">
                  ¿Agregar saldo al comercio al resolver?
                </label>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.35rem;">
                  <button type="button" class="res-bal-type-btn" data-btype="none" style="padding: 0.45rem 0.25rem; border-radius: 8px; font-size: 0.74rem; font-weight: 700; cursor: pointer; border: 2px solid var(--color-primary); background: rgba(94, 23, 235, 0.12); color: var(--color-primary); text-align: center;">
                    Sin Saldo<br><span style="font-weight: 400; font-size: 0.68rem;">Solo resolver</span>
                  </button>
                  <button type="button" class="res-bal-type-btn" data-btype="descuento" style="padding: 0.45rem 0.25rem; border-radius: 8px; font-size: 0.74rem; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-muted); text-align: center;">
                    🟢 A Favor<br><span style="font-weight: 400; font-size: 0.68rem;">Descuento</span>
                  </button>
                  <button type="button" class="res-bal-type-btn" data-btype="cargo" style="padding: 0.45rem 0.25rem; border-radius: 8px; font-size: 0.74rem; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text-muted); text-align: center;">
                    🔴 En Contra<br><span style="font-weight: 400; font-size: 0.68rem;">Cargo Extra</span>
                  </button>
                </div>
              </div>

              <!-- Campos condicionales de Saldo Adicional -->
              <div id="res-balance-fields-box" style="display: none; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.75rem; margin-bottom: 0.85rem; flex-direction: column; gap: 0.65rem;">
                <div>
                  <label class="form-label" style="font-size: 0.74rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.2rem;">Comercio en Facturación</label>
                  <select id="res-balance-comercio" class="form-input" style="font-size: 0.8rem; height: 34px; padding: 0 0.5rem;">
                    ${commerceSelectHtml}
                  </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                  <div>
                    <label class="form-label" style="font-size: 0.74rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.2rem;">Monto ($ CLP)</label>
                    <input type="number" id="res-balance-monto" class="form-input" placeholder="Ej. 10000" min="1" style="font-size: 0.82rem; font-weight: 700; height: 34px; padding: 0 0.5rem;">
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.74rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.2rem;">Tipo de IVA</label>
                    <select id="res-balance-iva" class="form-input" style="font-size: 0.8rem; height: 34px; padding: 0 0.5rem;">
                      <option value="mas_iva" selected>Más IVA (Neto)</option>
                      <option value="iva_incluido">IVA Incluido</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="form-label" style="font-size: 0.74rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.2rem;">Concepto / Detalle en Facturación</label>
                  <input type="text" id="res-balance-detalle" class="form-input" value="${escapeHtmlAttr(defaultConcept)}" style="font-size: 0.78rem; height: 34px; padding: 0 0.5rem;">
                </div>

                <div>
                  <label class="form-label" style="font-size: 0.74rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.2rem;">Aplicación en Período</label>
                  <select id="res-balance-period" class="form-input" style="font-size: 0.78rem; height: 34px; padding: 0 0.5rem;">
                    <option value="">Dejar Pendiente (Aplicar en próximo cierre)</option>
                    ${billingPeriods.map(p => `<option value="${p.id}">Aplicar directo a: ${escapeHtml(p.name)}</option>`).join('')}
                  </select>
                </div>

                <div id="res-balance-live-summary" style="font-size: 0.74rem; padding: 0.45rem 0.6rem; border-radius: 6px; font-weight: 600;"></div>
              </div>

              <button type="button" id="btn-resolve-with-balance" class="btn btn-primary" style="width: 100%; font-size: 0.82rem; font-weight: 700; padding: 0.6rem;">
                <i class="ri-check-double-line" style="margin-right: 0.25rem;"></i> <span id="btn-resolve-label-text">Resolver Ticket (Sin Saldo)</span>
              </button>
            </div>

            <!-- Tarjeta de Pedido Referenciado (si existe) -->
            ${ticket.order_id ? `
            <div class="ticket-sidebar-panel" style="padding: 1.15rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.55rem; margin-bottom: 0.65rem;">
                <span style="font-size: 0.78rem; font-weight: 700; text-transform: uppercase; color: var(--color-primary);">
                  <i class="ri-shopping-bag-3-line"></i> Pedido Referenciado
                </span>
                <span style="font-family: monospace; font-size: 0.78rem; font-weight: 700; background: var(--color-bg); padding: 2px 7px; border-radius: 6px; border: 1px solid var(--color-border);">
                  ${escapeHtml(ticket.order_id)}
                </span>
              </div>
              ${linkedOrder ? `
                <div style="font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.35rem; color: var(--color-text-muted);">
                  <div style="display: flex; justify-content: space-between;"><span>Estado WMS:</span><strong style="color: var(--color-text-main);">${escapeHtml(linkedOrder.estado_wms || linkedOrder.status || '—')}</strong></div>
                  <div style="display: flex; justify-content: space-between;"><span>Destinatario:</span><strong style="color: var(--color-text-main);">${escapeHtml(linkedOrder.customer_name || '—')}</strong></div>
                  <div style="display: flex; justify-content: space-between;"><span>Comuna:</span><span style="color: var(--color-text-main);">${escapeHtml(linkedOrder.comuna || '—')}</span></div>
                  <div style="display: flex; justify-content: space-between;"><span>Operador:</span><span style="color: var(--color-text-main);">${escapeHtml(linkedOrder.shipping_method || linkedOrder.operador || '—')}</span></div>
                </div>
              ` : `
                <div style="font-size: 0.76rem; color: var(--color-text-muted);">
                  Referencia indicada por el cliente: <strong>${escapeHtml(ticket.order_id)}</strong>
                </div>
              `}
            </div>
            ` : ''}

            <!-- Panel de Control del Ticket -->
            <div class="ticket-sidebar-panel" style="padding: 1.15rem;">
              <h3 style="font-size: 0.95rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.65rem; margin-bottom: 0.85rem;">Control del Ticket</h3>
              
              <div class="form-group" style="margin-bottom: 0.85rem;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted);">Estado del Ticket</label>
                <select id="control-ticket-status" class="form-input" style="font-size: 0.82rem;">
                  <option value="abierto" ${ticket.status === 'abierto' ? 'selected' : ''}>Abierto</option>
                  <option value="en_proceso" ${ticket.status === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
                  <option value="resuelto" ${ticket.status === 'resuelto' ? 'selected' : ''}>Resuelto</option>
                  <option value="cerrado" ${ticket.status === 'cerrado' ? 'selected' : ''}>Cerrado</option>
                </select>
              </div>

              <div class="form-group" style="margin-bottom: 0.85rem;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted);">Prioridad</label>
                <select id="control-ticket-priority" class="form-input" style="font-size: 0.82rem;">
                  <option value="baja" ${ticket.priority === 'baja' ? 'selected' : ''}>Baja</option>
                  <option value="media" ${ticket.priority === 'media' ? 'selected' : ''}>Media</option>
                  <option value="alta" ${ticket.priority === 'alta' ? 'selected' : ''}>Alta</option>
                  <option value="urgente" ${ticket.priority === 'urgente' ? 'selected' : ''}>Urgente</option>
                </select>
              </div>

              <div class="form-group" style="margin-bottom: 0.85rem;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted);">Asignar a Administrador</label>
                <select id="control-ticket-assignee" class="form-input" style="font-size: 0.82rem;">
                  <option value="">Sin Asignar</option>
                  ${adminProfiles.map(adm => `<option value="${adm.id}" ${ticket.assigned_to === adm.id ? 'selected' : ''}>${escapeHtml(adm.full_name)}</option>`).join('')}
                </select>
              </div>

              <div style="border-top: 1px solid var(--color-border); padding-top: 0.85rem; margin-top: 0.85rem;">
                <h4 style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.4rem;">Información del Cliente</h4>
                <p style="font-size: 0.78rem; margin-bottom: 0.2rem;"><strong>Comercio:</strong> ${escapeHtml(rawComercio)}</p>
                <p style="font-size: 0.78rem; margin-bottom: 0.2rem;"><strong>Email:</strong> ${escapeHtml(ticket.client?.email || '—')}</p>
                <p style="font-size: 0.78rem; margin-bottom: 0.2rem;"><strong>Fono:</strong> ${escapeHtml(ticket.client?.phone || '—')}</p>
                <p style="font-size: 0.78rem; margin-bottom: 0;"><strong>Creado:</strong> ${formatDate(ticket.created_at)}</p>
              </div>
            </div>
          </div>
        </div>
      `;

      // Eventos de navegación y scroll
      document.getElementById('btn-back-to-admin-list').addEventListener('click', showAdminTicketList);
      document.getElementById('btn-scroll-to-resolution')?.addEventListener('click', () => {
        document.getElementById('admin-resolution-balance-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      // Plantillas de Respuesta Rápida
      document.querySelectorAll('.quick-reply-tpl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const tpl = QUICK_REPLY_TEMPLATES[idx];
          if (!tpl) return;
          const replyInput = document.getElementById('admin-chat-reply-input');
          const internalCheck = document.getElementById('chat-is-internal');
          if (replyInput) {
            replyInput.value = tpl.text;
            replyInput.style.height = 'auto';
            replyInput.style.height = (replyInput.scrollHeight - 4) + 'px';
            replyInput.focus();
          }
          if (internalCheck) internalCheck.checked = !!tpl.internal;
        });
      });

      // Adjunto de archivo en chat admin
      const fileInput = document.getElementById('admin-chat-file-input');
      const fileLabel = document.getElementById('admin-chat-file-label');
      if (fileInput && fileLabel) {
        fileInput.addEventListener('change', () => {
          if (fileInput.files && fileInput.files[0]) {
            fileLabel.textContent = fileInput.files[0].name.substring(0, 22);
          } else {
            fileLabel.textContent = 'Adjuntar foto/archivo';
          }
        });
      }

      // Lógica del selector de Saldo a Favor / En Contra
      let selectedBalanceType = 'none'; // 'none' | 'descuento' | 'cargo'
      const fieldsBox = document.getElementById('res-balance-fields-box');
      const resolveBtnLabel = document.getElementById('btn-resolve-label-text');
      const liveSummary = document.getElementById('res-balance-live-summary');
      const montoInput = document.getElementById('res-balance-monto');
      const ivaSelect = document.getElementById('res-balance-iva');
      const comercioSelect = document.getElementById('res-balance-comercio');

      function updateResolutionBalanceUI() {
        document.querySelectorAll('.res-bal-type-btn').forEach(b => {
          const bt = b.getAttribute('data-btype');
          if (bt === selectedBalanceType) {
            if (bt === 'descuento') {
              b.style.border = '2px solid #10b981';
              b.style.background = 'rgba(16, 185, 129, 0.14)';
              b.style.color = '#10b981';
            } else if (bt === 'cargo') {
              b.style.border = '2px solid #ef4444';
              b.style.background = 'rgba(239, 68, 68, 0.14)';
              b.style.color = '#ef4444';
            } else {
              b.style.border = '2px solid var(--color-primary)';
              b.style.background = 'rgba(94, 23, 235, 0.12)';
              b.style.color = 'var(--color-primary)';
            }
          } else {
            b.style.border = '1px solid var(--color-border)';
            b.style.background = 'var(--color-bg)';
            b.style.color = 'var(--color-text-muted)';
          }
        });

        if (selectedBalanceType === 'none') {
          fieldsBox.style.display = 'none';
          resolveBtnLabel.textContent = 'Resolver Ticket (Sin Saldo)';
        } else {
          fieldsBox.style.display = 'flex';
          const amt = parseInt(montoInput.value || '0', 10);
          const ivaTxt = ivaSelect.value === 'iva_incluido' ? 'IVA Incluido' : '+ IVA (Neto)';
          const commTxt = comercioSelect.value || rawComercio;
          if (selectedBalanceType === 'descuento') {
            resolveBtnLabel.textContent = 'Resolver y Agregar Saldo a Favor';
            liveSummary.style.background = 'rgba(16, 185, 129, 0.12)';
            liveSummary.style.color = '#10b981';
            liveSummary.innerHTML = `✓ Se registrará un <strong>Descuento (Saldo a Favor)</strong> por <strong>-${formatCLP(amt)} (${ivaTxt})</strong> a <strong>${escapeHtml(commTxt)}</strong>.`;
          } else {
            resolveBtnLabel.textContent = 'Resolver y Agregar Cargo Extra';
            liveSummary.style.background = 'rgba(239, 68, 68, 0.12)';
            liveSummary.style.color = '#ef4444';
            liveSummary.innerHTML = `✓ Se registrará un <strong>Cargo Extra (Saldo en Contra)</strong> por <strong>${formatCLP(amt)} (${ivaTxt})</strong> a <strong>${escapeHtml(commTxt)}</strong>.`;
          }
        }
      }

      document.querySelectorAll('.res-bal-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedBalanceType = btn.getAttribute('data-btype') || 'none';
          updateResolutionBalanceUI();
        });
      });

      montoInput?.addEventListener('input', updateResolutionBalanceUI);
      ivaSelect?.addEventListener('change', updateResolutionBalanceUI);
      comercioSelect?.addEventListener('change', updateResolutionBalanceUI);

      // Botón "Resolver Ticket y Guardar Saldo"
      document.getElementById('btn-resolve-with-balance').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const targetComm = (comercioSelect?.value || rawComercio).trim();
        const monto = parseInt(montoInput?.value || '0', 10);
        const iva_tipo = ivaSelect?.value || 'mas_iva';
        const detalle = (document.getElementById('res-balance-detalle')?.value || defaultConcept).trim();
        const periodoId = document.getElementById('res-balance-period')?.value || null;

        if (selectedBalanceType !== 'none') {
          if (!targetComm || targetComm === 'no asignado') {
            alert('Por favor selecciona un comercio válido para asociar el saldo.');
            return;
          }
          if (!monto || monto <= 0) {
            alert('Por favor ingresa un monto válido mayor a $0 CLP.');
            montoInput?.focus();
            return;
          }
        }

        btn.disabled = true;
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Procesando resolución...';

        try {
          let insertedCharge = null;
          if (selectedBalanceType !== 'none') {
            const todayStr = new Date().toISOString().slice(0, 10);
            const chargePayload = {
              comercio: targetComm,
              fecha: todayStr,
              tipo: selectedBalanceType, // 'descuento' | 'cargo'
              detalle: detalle.includes(`Ticket #${shortId}`) ? detalle : `[Ticket #${shortId}] ${detalle}`,
              monto: monto,
              iva_tipo: iva_tipo,
              status: periodoId ? 'cobrado' : 'pendiente',
              periodo_id: periodoId || null
            };

            const { data: cData, error: cErr } = await supabase
              .from('extra_billing_charges')
              .insert(chargePayload)
              .select()
              .single();

            if (cErr) throw cErr;
            insertedCharge = cData || chargePayload;
          }

          // Actualizar estado del ticket a resuelto y asignar al admin actual si no tenía
          const updateFields = { status: 'resuelto' };
          if (!ticket.assigned_to) updateFields.assigned_to = userId;
          await updateTicketField(ticketId, updateFields);

          // Registrar mensaje de resolución en el chat del ticket
          const ivaLabel = iva_tipo === 'iva_incluido' ? 'IVA Incluido' : '+ IVA';
          let resolutionMsg = `✅ El caso ha sido marcado como Resuelto por el equipo de soporte.`;
          if (selectedBalanceType === 'descuento') {
            resolutionMsg = `✅ Caso Resuelto con Saldo a Favor del Comercio: Se ha registrado un Descuento por -${formatCLP(monto)} CLP (${ivaLabel}) en Facturación para ${targetComm}. Concepto: "${detalle}".`;
          } else if (selectedBalanceType === 'cargo') {
            resolutionMsg = `✅ Caso Resuelto con Cargo Extraordinario: Se ha registrado un Cargo por ${formatCLP(monto)} CLP (${ivaLabel}) en Facturación para ${targetComm}. Concepto: "${detalle}".`;
          }

          await supabase
            .from('ticket_messages')
            .insert({
              ticket_id: ticketId,
              sender_id: userId,
              message: resolutionMsg,
              is_internal: false
            });

          // Enviar correo de actualización al cliente (con copia a stockachile@gmail.com)
          if (ticket.client?.email) {
            sendTicketClientUpdateEmail({
              ticket,
              clientEmail: ticket.client.email,
              clientName: clientName,
              replyMessage: resolutionMsg,
              statusLabel: 'Resuelto',
              balanceRecord: insertedCharge
            }).catch(() => {});
          }

          alert(
            selectedBalanceType === 'none'
              ? '¡Ticket marcado como Resuelto exitosamente!'
              : `¡Ticket resuelto y ${selectedBalanceType === 'descuento' ? 'Saldo a Favor (Descuento)' : 'Cargo Extraordinario'} registrado en Facturación para ${targetComm}!`
          );

          await showAdminTicketDetail(ticketId);
        } catch (err) {
          console.error('Error al resolver ticket con saldo:', err);
          alert('Error al guardar la resolución: ' + err.message);
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      });

      // Cambios automáticos al seleccionar dropdowns de Control
      document.getElementById('control-ticket-status').addEventListener('change', async (e) => {
        const val = e.target.value;
        await updateTicketField(ticketId, { status: val });
        document.getElementById('chat-status-indicator').innerHTML = getStatusBadge(val);
      });

      document.getElementById('control-ticket-priority').addEventListener('change', async (e) => {
        await updateTicketField(ticketId, { priority: e.target.value });
      });

      document.getElementById('control-ticket-assignee').addEventListener('change', async (e) => {
        const val = e.target.value;
        await updateTicketField(ticketId, { assigned_to: val || null });
      });

      // Responder chat
      document.getElementById('admin-chat-reply-form').addEventListener('submit', (e) => sendAdminTicketMessage(e, ticketId, ticket));

      // Auto-grow input
      const replyInput = document.getElementById('admin-chat-reply-input');
      if (replyInput) {
        replyInput.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = (this.scrollHeight - 4) + 'px';
        });
      }

      // Cargar los mensajes y calcular SLA del encabezado
      await loadAdminChatMessages(ticketId, ticket);

      // Suscribirse en tiempo real
      subscribeToAdminMessages(ticketId, ticket);

    } catch (err) {
      console.error('Error rendering admin ticket detail:', err);
      appContent.innerHTML = `<div class="alert alert-error">Error al cargar el panel de atención: ${err.message}</div>`;
    }
  }

  // Guardar modificaciones automáticas
  async function updateTicketField(ticketId, fields) {
    try {
      const { error } = await supabase
        .from('tickets')
        .update(fields)
        .eq('id', ticketId);

      if (error) throw error;
      if (window.updateAdminBadges) {
        window.updateAdminBadges();
      }
    } catch (err) {
      console.error('Error updating ticket field:', err);
      alert('Error al guardar cambio: ' + err.message);
    }
  }

  // Cargar mensajes (Administrador: Cliente a la izquierda, Admin a la derecha, Notas internas en ámbar)
  async function loadAdminChatMessages(ticketId, ticketObj = null) {
    const box = document.getElementById('admin-chat-messages-box');
    if (!box) return;

    try {
      const { data: messages, error } = await supabase
        .from('ticket_messages')
        .select('*, sender:profiles!sender_id(full_name, role)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Actualizar badge de SLA en cabecera del detalle si tenemos el ticket
      if (ticketObj) {
        const sla = computeTicketSlaStatus(ticketObj, messages || []);
        const headerSlaEl = document.getElementById('detail-header-sla-badge');
        if (headerSlaEl) {
          if (sla.slaState === 'overdue') {
            headerSlaEl.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.74rem; font-weight: 700; padding: 2px 9px; border-radius: 99px; background: rgba(239, 68, 68, 0.14); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);"><i class="ri-alarm-warning-fill"></i> ${escapeHtml(sla.elapsedText)} sin respuesta (SLA Vencido)</span>`;
          } else if (sla.slaState === 'warning') {
            headerSlaEl.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.74rem; font-weight: 700; padding: 2px 9px; border-radius: 99px; background: rgba(245, 158, 11, 0.14); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35);"><i class="ri-time-line"></i> Espera: ${escapeHtml(sla.elapsedText)}</span>`;
          } else if (sla.waitingFor === 'client') {
            headerSlaEl.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.74rem; font-weight: 700; padding: 2px 9px; border-radius: 99px; background: rgba(16, 185, 129, 0.14); color: #10b981;"><i class="ri-check-double-line"></i> Respondido por Soporte</span>`;
          } else {
            headerSlaEl.innerHTML = '';
          }
        }
      }

      const cleanDesc = ticketObj?.description ? stripRedZoneJsonBlock(ticketObj.description) : '';

      if ((!messages || messages.length === 0) && !cleanDesc) {
        box.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 0.9rem; padding: 2rem;">No hay mensajes en esta conversación.</div>`;
        return;
      }

      const initialBubbleHtml = ((!messages || messages.length === 0) && cleanDesc) ? `
        <div class="chat-bubble other-party">
          <div class="chat-bubble-sender" style="font-size: 0.75rem; color: var(--color-primary); margin-bottom: 0.25rem;">
            <i class="ri-user-3-line"></i> ${escapeHtml(ticketObj?.client?.full_name || 'Cliente')} (Solicitud Inicial)
          </div>
          <div>${formatChatMessageBody(cleanDesc)}</div>
          <div class="chat-meta">
            <span>${formatDate(ticketObj?.created_at)}</span>
          </div>
        </div>
      ` : '';

      box.innerHTML = initialBubbleHtml + (messages || []).map(m => {
        const isInternal = m.is_internal;
        const isClient = m.sender?.role !== 'admin';
        const senderName = isClient 
          ? (m.sender?.full_name || 'Cliente') 
          : (m.sender?.full_name || 'Operaciones Stocka');

        let bubbleClass = 'own-party';
        let senderHeaderStyle = 'font-size: 0.75rem; opacity: 0.9; margin-bottom: 0.25rem;';
        let internalBadge = '';

        if (isClient) {
          bubbleClass = 'other-party';
          senderHeaderStyle = 'font-size: 0.75rem; color: var(--color-primary); font-weight: 700; margin-bottom: 0.25rem;';
        } else if (isInternal) {
          bubbleClass = 'internal';
          senderHeaderStyle = 'font-size: 0.75rem; color: #d97706; font-weight: 700; margin-bottom: 0.25rem;';
          internalBadge = `<span style="font-size: 0.65rem; background-color: var(--color-warning); color: white; padding: 1px 5px; border-radius: 4px; font-weight: bold; margin-left: 0.4rem;"><i class="ri-lock-fill"></i> NOTA INTERNA</span>`;
        }

        return `
          <div class="chat-bubble ${bubbleClass}">
            <div class="chat-bubble-sender" style="${senderHeaderStyle}">
              ${isClient ? '<i class="ri-user-line"></i> ' : '<i class="ri-shield-user-line"></i> '}${escapeHtml(senderName)} ${internalBadge}
            </div>
            <div>${formatChatMessageBody(m.message)}</div>
            <div class="chat-meta">
              <span>${formatDate(m.created_at)}</span>
            </div>
          </div>
        `;
      }).join('');

      box.scrollTop = box.scrollHeight;

    } catch (err) {
      console.error('Error loading admin messages:', err);
      box.innerHTML = `<div style="text-align: center; color: var(--color-danger); padding: 1rem;">Error al cargar mensajes: ${err.message}</div>`;
    }
  }

  // Responder ticket desde el admin (con soporte de archivo adjunto y notificación por correo al cliente)
  async function sendAdminTicketMessage(e, ticketId, ticketObj = null) {
    e.preventDefault();
    const input = document.getElementById('admin-chat-reply-input');
    const isInternalCheck = document.getElementById('chat-is-internal');
    const notifyEmailCheck = document.getElementById('chat-notify-client-email');
    const fileInput = document.getElementById('admin-chat-file-input');
    const fileLabel = document.getElementById('admin-chat-file-label');
    const btn = document.getElementById('admin-chat-send-btn');
    if (!input || (!input.value.trim() && (!fileInput || !fileInput.files.length))) return;

    let messageText = input.value.trim();
    const isInternal = isInternalCheck ? isInternalCheck.checked : false;
    const shouldNotifyEmail = notifyEmailCheck ? notifyEmailCheck.checked : true;

    input.disabled = true;
    btn.disabled = true;

    try {
      // Subir archivo adjunto si fue seleccionado
      if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const filePath = `tickets/admin_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('public-docs')
          .upload(filePath, file, { upsert: true });

        if (!upErr) {
          const { data: pubUrl } = supabase.storage.from('public-docs').getPublicUrl(filePath);
          if (pubUrl?.publicUrl) {
            messageText += (messageText ? '\n\n' : '') + `[Archivo Adjunto]: ${pubUrl.publicUrl}`;
          }
        }
      }

      const { error } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: userId,
          message: messageText,
          is_internal: isInternal
        });

      if (error) throw error;

      // Si es respuesta pública al cliente y el ticket estaba abierto/sin asignar, pasarlo a 'en_proceso' y asignarlo
      if (!isInternal && ticketObj) {
        const autoUpdates = {};
        if (ticketObj.status === 'abierto') autoUpdates.status = 'en_proceso';
        if (!ticketObj.assigned_to) autoUpdates.assigned_to = userId;
        if (Object.keys(autoUpdates).length > 0) {
          await updateTicketField(ticketId, autoUpdates);
          Object.assign(ticketObj, autoUpdates);
          const statusSel = document.getElementById('control-ticket-status');
          if (statusSel && autoUpdates.status) statusSel.value = autoUpdates.status;
          const chatStatusInd = document.getElementById('chat-status-indicator');
          if (chatStatusInd && autoUpdates.status) chatStatusInd.innerHTML = getStatusBadge(autoUpdates.status);
        }

        if (shouldNotifyEmail && ticketObj.client?.email) {
          sendTicketClientUpdateEmail({
            ticket: ticketObj,
            clientEmail: ticketObj.client.email,
            clientName: ticketObj.client.full_name || ticketObj.client.company_name,
            replyMessage: messageText,
            statusLabel: STATUSES[ticketObj.status]?.label || ticketObj.status
          }).catch(() => {});
        }
      }

      input.value = '';
      input.style.height = '44px';
      if (isInternalCheck) isInternalCheck.checked = false;
      if (fileInput) fileInput.value = '';
      if (fileLabel) fileLabel.textContent = 'Adjuntar foto/archivo';

      await loadAdminChatMessages(ticketId, ticketObj);

    } catch (err) {
      console.error('Error sending admin message:', err);
      alert('Error al enviar respuesta: ' + err.message);
    } finally {
      input.disabled = false;
      btn.disabled = false;
      input.focus();
    }
  }

  // Realtime subscription helper para Admin
  let adminTicketSubscription = null;
  function subscribeToAdminMessages(ticketId, ticketObj = null) {
    try {
      if (adminTicketSubscription && typeof supabase.removeChannel === 'function') {
        supabase.removeChannel(adminTicketSubscription);
        adminTicketSubscription = null;
      }

      if (typeof supabase.channel === 'function') {
        adminTicketSubscription = supabase
          .channel(`admin_ticket_messages_realtime:${ticketId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${ticketId}` },
            () => {
              loadAdminChatMessages(ticketId, ticketObj);
            }
          )
          .subscribe();
      }
    } catch (err) {
      console.warn('Advertencia en suscripción de admin tickets realtime:', err);
    }
  }
}

// ==========================================
// AUXILIARES
// ==========================================

function stripRedZoneJsonBlock(str) {
  if (!str) return '';
  return String(str).replace(/\n*---REDZONE_DATA_JSON---\n[\s\S]*?\n---END_REDZONE_DATA_JSON---\s*$/m, '').trim();
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeHtmlAttr(str) {
  return escapeHtml(str);
}
