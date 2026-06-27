import supabase from './supabase.js';

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

      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-body" style="padding: 1rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
          <div style="flex: 1; min-width: 250px; position: relative;">
            <input type="text" id="search-ticket-subject" class="form-input" placeholder="Buscar por asunto..." style="padding-left: 2.25rem;">
            <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
          </div>
          <div style="width: 180px;">
            <select id="filter-ticket-status" class="form-input">
              <option value="todos">Todos los Estados</option>
              <option value="abierto">Abiertos</option>
              <option value="en_proceso">En Proceso</option>
              <option value="resuelto">Resueltos</option>
              <option value="cerrado">Cerrados</option>
            </select>
          </div>
          <div style="width: 180px;">
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
        <div class="card-body" style="padding: 0;">
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
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (statusFilter !== 'todos') {
        query = query.eq('status', statusFilter);
      }
      if (categoryFilter !== 'todos') {
        query = query.eq('category', categoryFilter);
      }

      const { data: tickets, error } = await query;
      if (error) throw error;

      // Filtrar por texto en frontend si es necesario
      const filteredTickets = tickets.filter(t => 
        t.subject.toLowerCase().includes(searchTerm) || 
        t.id.substring(0, 8).toLowerCase().includes(searchTerm)
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

      tableBody.innerHTML = filteredTickets.map(t => {
        const cat = CATEGORIES[t.category] || { label: t.category, color: 'var(--color-text-muted)' };
        return `
          <tr style="border-bottom: 1px solid var(--color-border);">
            <td style="font-weight: 500; color: var(--color-text-main);">
              <span style="font-family: monospace; font-size: 0.8rem; color: var(--color-text-muted); margin-right: 0.25rem;">[#${t.id.substring(0, 6)}]</span>
              ${escapeHtml(t.subject)}
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

    try {
      // 1. Insertar el ticket
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          user_id: userId,
          comercio: userComercio,
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

      alert('¡Caso creado exitosamente! Nuestro equipo de operaciones lo atenderá a la brevedad.');
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
      await loadChatMessages(ticketId);

      // Realtime subscription (opcional para el chat, pero útil)
      subscribeToTicketMessages(ticketId);

    } catch (err) {
      console.error('Error rendering ticket detail:', err);
      appContent.innerHTML = `<div class="alert alert-error">Error al cargar detalle del ticket: ${err.message}</div>`;
    }
  }

  // Cargar lista de mensajes
  async function loadChatMessages(ticketId) {
    const box = document.getElementById('chat-messages-box');
    if (!box) return;

    try {
      const { data: messages, error } = await supabase
        .from('ticket_messages')
        .select('*, sender:profiles!sender_id(full_name, role)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (messages.length === 0) {
        box.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 0.9rem; padding: 2rem;">No hay mensajes en esta conversación.</div>`;
        return;
      }

      box.innerHTML = messages.map(m => {
        const isClient = m.sender?.role !== 'admin';
        const senderName = isClient ? (m.sender?.full_name || 'Tú (Cliente)') : (m.sender?.full_name || 'Operaciones Stocka');
        const bubbleClass = isClient ? 'client' : 'admin';

        return `
          <div class="chat-bubble ${bubbleClass}">
            <div class="chat-bubble-sender" style="font-size: 0.75rem; opacity: 0.85; margin-bottom: 0.25rem;">${escapeHtml(senderName)}</div>
            <div>${escapeHtml(m.message).replace(/\n/g, '<br>')}</div>
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
    if (ticketSubscription) {
      supabase.removeChannel(ticketSubscription);
    }

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

  // Cargar lista de tickets general por defecto
  showAdminTicketList();

  async function showAdminTicketList() {
    appContent.innerHTML = `
      <p style="font-size: 0.9rem; color: var(--color-text-muted); margin-bottom: 1.5rem;">Bandeja de atención de incidencias, facturación y reclamos de todos los clientes</p>
      
      <div class="card" style="margin-bottom: 1.5rem;">
        <div class="card-body" style="padding: 1rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
          <div style="flex: 1; min-width: 250px; position: relative;">
            <input type="text" id="admin-search-ticket" class="form-input" placeholder="Buscar por asunto, cliente o ID..." style="padding-left: 2.25rem;">
            <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
          </div>
          <div style="width: 160px;">
            <select id="admin-filter-status" class="form-input">
              <option value="todos">Todos los Estados</option>
              <option value="abierto" selected>Abiertos</option>
              <option value="en_proceso">En Proceso</option>
              <option value="resuelto">Resueltos</option>
              <option value="cerrado">Cerrados</option>
            </select>
          </div>
          <div style="width: 160px;">
            <select id="admin-filter-category" class="form-input">
              <option value="todos">Categorías: Todas</option>
              <option value="facturacion">Facturación</option>
              <option value="incidencia">Incidencias</option>
              <option value="pedidos">Pedidos</option>
              <option value="otros">Otros</option>
            </select>
          </div>
          <div style="width: 160px;">
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

      <div class="card">
        <div class="card-body" style="padding: 0;">
          <table class="data-table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th>Caso</th>
                <th>Cliente</th>
                <th>Categoría</th>
                <th style="text-align: center;">Prioridad</th>
                <th style="text-align: center;">Estado</th>
                <th>Asignado A</th>
                <th>Última Actividad</th>
                <th style="text-align: right;">Acciones</th>
              </tr>
            </thead>
            <tbody id="admin-tickets-table-body">
              <tr>
                <td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
                  <i class="ri-loader-4-line spin" style="font-size: 2rem;"></i><br>Cargando bandeja de soporte...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Eventos
    document.getElementById('admin-search-ticket').addEventListener('input', fetchAndRenderAdminTickets);
    document.getElementById('admin-filter-status').addEventListener('change', fetchAndRenderAdminTickets);
    document.getElementById('admin-filter-category').addEventListener('change', fetchAndRenderAdminTickets);
    document.getElementById('admin-filter-priority').addEventListener('change', fetchAndRenderAdminTickets);

    // Cargar los datos
    await fetchAndRenderAdminTickets();
    
    // Cargar admins en segundo plano para asignaciones
    loadAdminProfiles();
  }

  // Obtener todos los tickets de todos los clientes
  async function fetchAndRenderAdminTickets() {
    const tableBody = document.getElementById('admin-tickets-table-body');
    if (!tableBody) return;

    const searchTerm = document.getElementById('admin-search-ticket').value.trim().toLowerCase();
    const statusFilter = document.getElementById('admin-filter-status').value;
    const categoryFilter = document.getElementById('admin-filter-category').value;
    const priorityFilter = document.getElementById('admin-filter-priority').value;

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

      const { data: tickets, error } = await query;
      if (error) throw error;

      // Filtrar localmente por términos de búsqueda (asunto, comercio, ID, email del cliente)
      const filteredTickets = tickets.filter(t => {
        const clientName = t.client?.company_name || t.client?.full_name || '';
        const clientEmail = t.client?.email || '';
        const subjectMatch = t.subject.toLowerCase().includes(searchTerm);
        const clientMatch = clientName.toLowerCase().includes(searchTerm);
        const emailMatch = clientEmail.toLowerCase().includes(searchTerm);
        const idMatch = t.id.toLowerCase().includes(searchTerm);
        return subjectMatch || clientMatch || emailMatch || idMatch;
      });

      if (filteredTickets.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="text-center" style="padding: 3rem; color: var(--color-text-muted);">
              <i class="ri-inbox-archive-line" style="font-size: 2.5rem; margin-bottom: 0.5rem; display: inline-block;"></i>
              <p>No hay tickets pendientes con los criterios de búsqueda actuales.</p>
            </td>
          </tr>
        `;
        return;
      }

      tableBody.innerHTML = filteredTickets.map(t => {
        const cat = CATEGORIES[t.category] || { label: t.category, color: 'var(--color-text-muted)' };
        const clientCompany = t.client?.company_name || t.client?.full_name || 'Desconocido';
        const assignedTo = t.assignee?.full_name || '<span style="color: var(--color-warning); font-style: italic;">Sin Asignar</span>';

        return `
          <tr style="border-bottom: 1px solid var(--color-border);">
            <td style="font-weight: 500; color: var(--color-text-main);">
              <span style="font-family: monospace; font-size: 0.8rem; color: var(--color-text-muted); margin-right: 0.25rem;">[#${t.id.substring(0, 6)}]</span>
              ${escapeHtml(t.subject)}
            </td>
            <td style="font-weight: 500;">
              ${escapeHtml(clientCompany)}
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block;">${t.client?.email || ''}</span>
            </td>
            <td>
              <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem;">
                <i class="${cat.icon}" style="color: ${cat.color};"></i> ${cat.label}
              </span>
            </td>
            <td style="text-align: center;">${getPriorityBadge(t.priority)}</td>
            <td style="text-align: center;">${getStatusBadge(t.status)}</td>
            <td style="font-size: 0.85rem;">${assignedTo}</td>
            <td style="font-size: 0.85rem; color: var(--color-text-muted);">${formatDate(t.updated_at)}</td>
            <td style="text-align: right;">
              <button class="btn btn-primary btn-sm attend-ticket-btn" data-id="${t.id}" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">
                Atender <i class="ri-question-answer-line" style="vertical-align: middle; margin-left: 0.25rem;"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Click event
      document.querySelectorAll('.attend-ticket-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const ticketId = e.currentTarget.getAttribute('data-id');
          showAdminTicketDetail(ticketId);
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

  // Ver y atender ticket (Administrador)
  async function showAdminTicketDetail(ticketId) {
    appContent.innerHTML = `
      <div style="padding: 2rem 5rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-loader-4-line spin" style="font-size: 2.5rem;"></i><br>Cargando panel de resolución...
      </div>
    `;

    try {
      // Obtener ticket detallado
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('*, client:profiles!user_id(company_name, full_name, email, phone, comercio)')
        .eq('id', ticketId)
        .single();

      if (ticketError) throw ticketError;

      const cat = CATEGORIES[ticket.category] || { label: ticket.category, icon: 'ri-question-line', color: 'var(--color-text-muted)' };
      const clientName = ticket.client?.full_name || 'Desconocido';
      const clientCompany = ticket.client?.company_name || 'Sin Comercio';

      appContent.innerHTML = `
        <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button id="btn-back-to-admin-list" class="btn btn-outline" style="padding: 0.5rem; border-radius: 50%; min-width: auto; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center;">
              <i class="ri-arrow-left-line" style="font-size: 1.2rem;"></i>
            </button>
            <div>
              <h2 style="font-size: 1.25rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem; color: var(--color-text-main);">
                <span style="font-family: monospace; font-size: 0.95rem; color: var(--color-text-muted);">[#${ticket.id.substring(0, 6)}]</span>
                ${escapeHtml(ticket.subject)}
              </h2>
              <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.25rem;">
                <span style="font-size: 0.8rem; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-building-line"></i> Cliente: ${escapeHtml(clientCompany)} (${escapeHtml(clientName)})
                </span>
                <span style="color: var(--color-border);">|</span>
                <span style="font-size: 0.8rem; color: var(--color-text-muted);">Categoría: ${cat.label}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="ticket-detail-layout">
          <!-- Area del Chat de Soporte -->
          <div>
            <div class="chat-container">
              <div class="chat-header">
                <span style="font-weight: 600; font-size: 0.9rem; color: var(--color-text-main);">Panel de Conversación de Soporte</span>
                <span id="chat-status-indicator">${getStatusBadge(ticket.status)}</span>
              </div>
              <div class="chat-messages" id="admin-chat-messages-box">
                <!-- Mensajes dinámicos -->
              </div>
              <div class="chat-input-area">
                <form id="admin-chat-reply-form">
                  <!-- Checkbox de Nota Interna -->
                  <div style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <input type="checkbox" id="chat-is-internal" style="cursor: pointer; width: 15px; height: 15px;">
                    <label for="chat-is-internal" style="font-size: 0.8rem; font-weight: 600; color: var(--color-warning); cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                      <i class="ri-lock-line"></i> Nota Interna (Visible solo para Admins en este panel)
                    </label>
                  </div>
                  <div class="chat-input-wrapper">
                    <textarea id="admin-chat-reply-input" class="chat-input-textarea" placeholder="Escribe un mensaje al cliente o una nota interna..." rows="1" required></textarea>
                    <button type="submit" id="admin-chat-send-btn" class="btn btn-primary" style="height: 44px; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; width: 44px; padding: 0; border-radius: var(--radius-md);">
                      <i class="ri-send-plane-2-line" style="font-size: 1.2rem;"></i>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <!-- Panel de Control y Modificaciones -->
          <div class="ticket-sidebar-panel">
            <h3 style="font-size: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem; margin-bottom: 1rem;">Control del Ticket</h3>
            
            <!-- Cambiar Estado -->
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label" style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);">Estado del Ticket</label>
              <select id="control-ticket-status" class="form-input" style="font-size: 0.85rem;">
                <option value="abierto" ${ticket.status === 'abierto' ? 'selected' : ''}>Abierto</option>
                <option value="en_proceso" ${ticket.status === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
                <option value="resuelto" ${ticket.status === 'resuelto' ? 'selected' : ''}>Resuelto</option>
                <option value="cerrado" ${ticket.status === 'cerrado' ? 'selected' : ''}>Cerrado</option>
              </select>
            </div>

            <!-- Cambiar Prioridad -->
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label" style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);">Prioridad</label>
              <select id="control-ticket-priority" class="form-input" style="font-size: 0.85rem;">
                <option value="baja" ${ticket.priority === 'baja' ? 'selected' : ''}>Baja</option>
                <option value="media" ${ticket.priority === 'media' ? 'selected' : ''}>Media</option>
                <option value="alta" ${ticket.priority === 'alta' ? 'selected' : ''}>Alta</option>
                <option value="urgente" ${ticket.priority === 'urgente' ? 'selected' : ''}>Urgente</option>
              </select>
            </div>

            <!-- Asignar Agente -->
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label" style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);">Asignar a Administrador</label>
              <select id="control-ticket-assignee" class="form-input" style="font-size: 0.85rem;">
                <option value="">Sin Asignar</option>
                ${adminProfiles.map(adm => `<option value="${adm.id}" ${ticket.assigned_to === adm.id ? 'selected' : ''}>${escapeHtml(adm.full_name)}</option>`).join('')}
              </select>
            </div>

            <div style="border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: 1rem;">
              <h4 style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">Información del Cliente</h4>
              <p style="font-size: 0.8rem; margin-bottom: 0.25rem;"><strong>Comercio:</strong> ${escapeHtml(ticket.client?.comercio || 'no asignado')}</p>
              <p style="font-size: 0.8rem; margin-bottom: 0.25rem;"><strong>Email:</strong> ${escapeHtml(ticket.client?.email || '—')}</p>
              <p style="font-size: 0.8rem; margin-bottom: 0.25rem;"><strong>Fono:</strong> ${escapeHtml(ticket.client?.phone || '—')}</p>
              <p style="font-size: 0.8rem;"><strong>Pedido Ref:</strong> ${ticket.order_id ? `<span style="font-family: monospace;">${escapeHtml(ticket.order_id)}</span>` : 'Ninguno'}</p>
            </div>

            <div style="background-color: rgba(94, 23, 235, 0.05); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid rgba(94, 23, 235, 0.15); margin-top: 1rem; font-size: 0.75rem; color: var(--color-text-muted);">
              <i class="ri-shield-user-line" style="color: var(--color-accent); margin-right: 0.25rem;"></i>
              Los cambios en el panel de control se guardan de forma automática.
            </div>
          </div>
        </div>
      `;

      // Eventos
      document.getElementById('btn-back-to-admin-list').addEventListener('click', showAdminTicketList);

      // Cambios automáticos al seleccionar dropdowns
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
      document.getElementById('admin-chat-reply-form').addEventListener('submit', (e) => sendAdminTicketMessage(e, ticketId));

      // Auto-grow input
      const replyInput = document.getElementById('admin-chat-reply-input');
      if (replyInput) {
        replyInput.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = (this.scrollHeight - 4) + 'px';
        });
      }

      // Cargar los mensajes
      await loadAdminChatMessages(ticketId);

      // Suscribirse en tiempo real
      subscribeToAdminMessages(ticketId);

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
    } catch (err) {
      console.error('Error updating ticket field:', err);
      alert('Error al guardar cambio: ' + err.message);
    }
  }

  // Cargar mensajes (Administrador, incluye notas internas)
  async function loadAdminChatMessages(ticketId) {
    const box = document.getElementById('admin-chat-messages-box');
    if (!box) return;

    try {
      const { data: messages, error } = await supabase
        .from('ticket_messages')
        .select('*, sender:profiles!sender_id(full_name, role)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (messages.length === 0) {
        box.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 0.9rem; padding: 2rem;">No hay mensajes en esta conversación.</div>`;
        return;
      }

      box.innerHTML = messages.map(m => {
        const isInternal = m.is_internal;
        const isClient = m.sender?.role !== 'admin';
        const senderName = isClient 
          ? (m.sender?.full_name || 'Cliente') 
          : (m.sender?.full_name || 'Operaciones Stocka');

        let bubbleClass = 'admin';
        let internalBadge = '';

        if (isClient) {
          bubbleClass = 'client';
        } else if (isInternal) {
          bubbleClass = 'internal';
          internalBadge = `<span style="font-size: 0.65rem; background-color: var(--color-warning); color: white; padding: 1px 4px; border-radius: 3px; font-weight: bold; margin-left: 0.5rem;"><i class="ri-lock-fill"></i> NOTA INTERNA</span>`;
        }

        return `
          <div class="chat-bubble ${bubbleClass}">
            <div class="chat-bubble-sender" style="font-size: 0.75rem; opacity: 0.85; margin-bottom: 0.25rem;">
              ${escapeHtml(senderName)} ${internalBadge}
            </div>
            <div>${escapeHtml(m.message).replace(/\n/g, '<br>')}</div>
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

  // Responder ticket desde el admin
  async function sendAdminTicketMessage(e, ticketId) {
    e.preventDefault();
    const input = document.getElementById('admin-chat-reply-input');
    const isInternalCheck = document.getElementById('chat-is-internal');
    const btn = document.getElementById('admin-chat-send-btn');
    if (!input || !input.value.trim()) return;

    const messageText = input.value.trim();
    const isInternal = isInternalCheck ? isInternalCheck.checked : false;

    input.disabled = true;
    btn.disabled = true;

    try {
      const { error } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: userId,
          message: messageText,
          is_internal: isInternal
        });

      if (error) throw error;

      input.value = '';
      input.style.height = '44px';
      if (isInternalCheck) isInternalCheck.checked = false;

      // Recargar mensajes
      await loadAdminChatMessages(ticketId);

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
  function subscribeToAdminMessages(ticketId) {
    if (adminTicketSubscription) {
      supabase.removeChannel(adminTicketSubscription);
    }

    adminTicketSubscription = supabase
      .channel(`admin_ticket_messages_realtime:${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${ticketId}` },
        () => {
          loadAdminChatMessages(ticketId);
        }
      )
      .subscribe();
  }
}

// ==========================================
// AUXILIARES
// ==========================================

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
