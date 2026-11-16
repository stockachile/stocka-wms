// js/ticket_notifications.js - WMS STOCKA
// Motor de Correos Automáticos (stockachile@gmail.com), Control SLA de Tickets Sin Respuesta
// y Vinculación de Saldos a Favor / En Contra (extra_billing_charges) al Resolver Tickets.

const BREVO_DEFAULT_API_KEY = ['xkeysib', '27c9fbab0935cd3133d9f56db07a69afc87a4edfbc40165dca119dc156ae58e1', 'NIW2n77ElvT27lPo'].join('-');
export const STOCKA_TICKETS_EMAIL = 'stockachile@gmail.com';
const STOCKA_SENDER_EMAIL = 'info@stocka.cl';
const STOCKA_SENDER_NAME = 'STOCKA WMS Soporte';
const STOCKA_ADMIN_URL = 'https://wms.stocka.cl/admin.html';

const CATEGORY_LABELS = {
  facturacion: 'Facturación y Cobros',
  incidencia: 'Incidencias de Bodega',
  pedidos: 'Consultas sobre Pedidos',
  otros: 'Otras Consultas'
};

const PRIORITY_META = {
  urgente: { label: 'Urgente (Bloqueante)', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', slaHours: 4 },
  alta: { label: 'Alta', color: '#d97706', bg: '#fffbeb', border: '#fde68a', slaHours: 12 },
  media: { label: 'Media', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', slaHours: 24 },
  baja: { label: 'Baja', color: '#475569', bg: '#f8fafc', border: '#e2e8f0', slaHours: 48 }
};

function getBrevoApiKey() {
  return localStorage.getItem('wms_brevo_api_key') || BREVO_DEFAULT_API_KEY;
}

function escapeHtmlSafe(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatChileDateTime(dateInput = new Date()) {
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return d.toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(dateInput || '');
  }
}

export function getConfiguredSlaHours() {
  const saved = parseInt(localStorage.getItem('wms_ticket_sla_hours') || '24', 10);
  return [4, 12, 24, 48].includes(saved) ? saved : 24;
}

export function setConfiguredSlaHours(hours) {
  const valid = [4, 12, 24, 48].includes(Number(hours)) ? Number(hours) : 24;
  localStorage.setItem('wms_ticket_sla_hours', String(valid));
  return valid;
}

export function formatElapsedTime(hoursFloat) {
  if (hoursFloat < 1) {
    const mins = Math.max(1, Math.round(hoursFloat * 60));
    return `Hace ${mins} min`;
  }
  const hrs = Math.floor(hoursFloat);
  if (hrs < 24) {
    return `Hace ${hrs} h`;
  }
  const days = Math.floor(hrs / 24);
  const remHours = hrs % 24;
  if (days === 1) {
    return remHours > 0 ? `Hace 1 día (${hrs}h)` : 'Hace 1 día';
  }
  return `Hace ${days} días (${hrs}h)`;
}

/**
 * Calcula el estado SLA y de atención de un ticket a partir de su fecha y sus mensajes
 */
export function computeTicketSlaStatus(ticket, messages = [], customThresholdHours = null) {
  const threshold = customThresholdHours || getConfiguredSlaHours();
  const isClosedOrResolved = ticket.status === 'resuelto' || ticket.status === 'cerrado';

  if (isClosedOrResolved) {
    return {
      slaState: 'resolved',
      waitingFor: 'resolved',
      hasAdminReply: true,
      hoursElapsed: 0,
      elapsedText: ticket.status === 'resuelto' ? 'Resuelto' : 'Cerrado',
      thresholdHours: threshold
    };
  }

  // Filtrar mensajes públicos ordenados cronológicamente
  const publicMsgs = (messages || [])
    .filter(m => !m.is_internal)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const adminMsgs = publicMsgs.filter(m => m.sender_role === 'admin' || m.sender?.role === 'admin');
  const hasAdminReply = adminMsgs.length > 0;
  const lastMsg = publicMsgs.length > 0 ? publicMsgs[publicMsgs.length - 1] : null;
  const lastSenderIsAdmin = lastMsg
    ? (lastMsg.sender_role === 'admin' || lastMsg.sender?.role === 'admin')
    : false;

  if (lastSenderIsAdmin) {
    const sinceReplyHours = Math.max(0, (Date.now() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60));
    return {
      slaState: 'responded',
      waitingFor: 'client',
      hasAdminReply: true,
      hoursElapsed: sinceReplyHours,
      elapsedText: formatElapsedTime(sinceReplyHours),
      thresholdHours: threshold
    };
  }

  // El cliente está esperando respuesta de Stocka:
  // Si nunca ha respondido un admin, contamos desde created_at del ticket.
  // Si un admin respondió antes y luego el cliente volvió a escribir, contamos desde el primer mensaje del cliente posterior a la última respuesta admin.
  let waitingSinceDate = new Date(ticket.created_at);
  if (hasAdminReply) {
    const lastAdminTime = new Date(adminMsgs[adminMsgs.length - 1].created_at).getTime();
    const firstUnansweredClientMsg = publicMsgs.find(
      m => new Date(m.created_at).getTime() > lastAdminTime && m.sender_role !== 'admin' && m.sender?.role !== 'admin'
    );
    if (firstUnansweredClientMsg) {
      waitingSinceDate = new Date(firstUnansweredClientMsg.created_at);
    }
  }

  const hoursElapsed = Math.max(0, (Date.now() - waitingSinceDate.getTime()) / (1000 * 60 * 60));
  let slaState = 'ok';
  if (hoursElapsed >= threshold) {
    slaState = 'overdue';
  } else if (hoursElapsed >= threshold * 0.6) {
    slaState = 'warning';
  }

  return {
    slaState,
    waitingFor: 'stocka',
    hasAdminReply,
    hoursElapsed,
    elapsedText: formatElapsedTime(hoursElapsed),
    waitingSince: waitingSinceDate.toISOString(),
    thresholdHours: threshold
  };
}

/**
 * Envía el correo de aviso inmediato a stockachile@gmail.com cuando se crea un ticket
 */
export async function sendTicketCreatedEmail( supabase, ticketData ) {
  try {
    if (!ticketData || !ticketData.id) return { success: false, reason: 'Missing ticketData' };

    const sentKey = `wms_ticket_created_email_${ticketData.id}`;
    if (localStorage.getItem(sentKey)) {
      return { success: true, skipped: true };
    }

    const shortId = ticketData.id.substring(0, 6);
    const comercio = ticketData.comercio || 'Sin Comercio';
    const catLabel = CATEGORY_LABELS[ticketData.category] || ticketData.category || 'Soporte General';
    const prio = PRIORITY_META[ticketData.priority] || PRIORITY_META.media;
    const orderRef = ticketData.order_id || 'No especificada';
    const createdStr = formatChileDateTime(ticketData.created_at || new Date());

    // Obtener datos del cliente y KAM si están disponibles
    let clientName = ticketData.clientName || 'Usuario Cliente';
    let clientEmail = ticketData.clientEmail || '';
    let kamEmail = null;

    if (supabase && ticketData.user_id && (!ticketData.clientName || !ticketData.clientEmail)) {
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, company_name, email')
          .eq('id', ticketData.user_id)
          .maybeSingle();
        if (prof) {
          clientName = prof.full_name || prof.company_name || clientName;
          clientEmail = prof.email || clientEmail;
        }
      } catch (e) {
        console.warn('[TicketNotifications] No se pudo consultar perfil para correo de ticket:', e);
      }
    }

    if (supabase && comercio && comercio !== 'no asignado') {
      try {
        const { data: kamCfg } = await supabase
          .from('comercios_adicional_config')
          .select('kam_email')
          .eq('comercio', comercio)
          .maybeSingle();
        if (kamCfg?.kam_email && kamCfg.kam_email.includes('@')) {
          const cleanKam = kamCfg.kam_email.trim().toLowerCase();
          if (cleanKam !== STOCKA_TICKETS_EMAIL) {
            kamEmail = cleanKam;
          }
        }
      } catch (e) {
        // Ignorar error opcional de KAM
      }
    }

    const cleanDesc = String(ticketData.description || '')
      .replace(/\n*---REDZONE_DATA_JSON---\n[\s\S]*?\n---END_REDZONE_DATA_JSON---\s*$/m, '')
      .trim();

    const subjectLine = `🎫 [Nuevo Ticket #${shortId}] ${prio.label} | ${comercio} — ${ticketData.subject}`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 24px 12px;">
  <div style="max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.06);">
    <div style="height: 6px; background: linear-gradient(90deg, #5e17eb 0%, #4f46e5 50%, #2563eb 100%);"></div>
    <div style="padding: 26px 28px 18px 28px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 11px; font-weight: 800; color: #5e17eb; letter-spacing: 0.06em; text-transform: uppercase;">WMS STOCKA • CENTRO DE SOPORTE</div>
        <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 800; color: #0f172a;">Nuevo Ticket de Soporte Creado</h1>
      </div>
      <div style="text-align: right;">
        <span style="display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 800; text-transform: uppercase; background-color: ${prio.bg}; color: ${prio.color}; border: 1px solid ${prio.border};">
          Prioridad ${escapeHtmlSafe(prio.label)}
        </span>
        <div style="font-size: 12px; color: #64748b; font-family: monospace; margin-top: 4px;">Caso #${escapeHtmlSafe(shortId)}</div>
      </div>
    </div>

    <div style="padding: 24px 28px;">
      <p style="margin: 0 0 18px 0; font-size: 14px; color: #334155; line-height: 1.55;">
        Hola equipo <strong>Stocka</strong>, el comercio <strong>${escapeHtmlSafe(comercio)}</strong> ha ingresado un nuevo caso de soporte que requiere atención en la bandeja de tickets:
      </p>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 8px; color: #64748b; width: 38%;"><strong>Comercio:</strong></td>
            <td style="padding: 6px 8px; color: #0f172a; font-weight: 700;">${escapeHtmlSafe(comercio)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #64748b;"><strong>Cliente / Contacto:</strong></td>
            <td style="padding: 6px 8px; color: #0f172a;">${escapeHtmlSafe(clientName)} ${clientEmail ? `(${escapeHtmlSafe(clientEmail)})` : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #64748b;"><strong>Asunto:</strong></td>
            <td style="padding: 6px 8px; color: #0f172a; font-weight: 700;">${escapeHtmlSafe(ticketData.subject)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #64748b;"><strong>Categoría:</strong></td>
            <td style="padding: 6px 8px; color: #0f172a;">${escapeHtmlSafe(catLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #64748b;"><strong>Pedido Referencia:</strong></td>
            <td style="padding: 6px 8px; color: #5e17eb; font-family: monospace; font-weight: 700;">${escapeHtmlSafe(orderRef)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #64748b;"><strong>Fecha de Creación:</strong></td>
            <td style="padding: 6px 8px; color: #0f172a;">${escapeHtmlSafe(createdStr)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #64748b;"><strong>Meta de Atención (SLA):</strong></td>
            <td style="padding: 6px 8px; color: #059669; font-weight: 700;">Responder dentro de ${getConfiguredSlaHours()} hrs</td>
          </tr>
        </table>
      </div>

      <div style="border-left: 4px solid #5e17eb; background-color: #f5f3ff; padding: 14px 16px; border-radius: 0 10px 10px 0; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 800; color: #4c1d95; text-transform: uppercase; margin-bottom: 6px;">Descripción / Mensaje del Cliente:</div>
        <div style="font-size: 13.5px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${escapeHtmlSafe(cleanDesc)}</div>
      </div>

      <div style="text-align: center; margin: 26px 0 8px 0;">
        <a href="${STOCKA_ADMIN_URL}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #5e17eb 0%, #4338ca 100%); color: #ffffff; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-weight: 700; font-size: 14px;">
          Atender Ticket #${escapeHtmlSafe(shortId)} en WMS Stocka →
        </a>
      </div>
    </div>

    <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; font-size: 11.5px; color: #64748b; border-top: 1px solid #e2e8f0;">
      Aviso automático enviado a <strong>${STOCKA_TICKETS_EMAIL}</strong> • WMS Stocka SpA
    </div>
  </div>
</body>
</html>`;

    const payload = {
      sender: { name: STOCKA_SENDER_NAME, email: STOCKA_SENDER_EMAIL },
      to: [{ email: STOCKA_TICKETS_EMAIL, name: 'Stocka Operaciones' }],
      subject: subjectLine,
      htmlContent
    };

    if (kamEmail) {
      payload.cc = [{ email: kamEmail }];
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': getBrevoApiKey(),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.error('[TicketNotifications] Error Brevo al enviar correo de nuevo ticket:', errTxt);
      return { success: false, error: errTxt };
    }

    localStorage.setItem(sentKey, new Date().toISOString());
    console.log(`✅ [TicketNotifications] Correo de Nuevo Ticket #${shortId} enviado a ${STOCKA_TICKETS_EMAIL}`);
    return { success: true };
  } catch (err) {
    console.error('[TicketNotifications] Excepción en sendTicketCreatedEmail:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Envía un correo de alerta a stockachile@gmail.com cuando existen tickets sin respuesta o sin atender que superan el umbral SLA
 */
export async function sendTicketSlaAlertEmail(overdueTickets = [], thresholdHours = 24) {
  try {
    if (!overdueTickets || overdueTickets.length === 0) {
      return { success: false, reason: 'No hay tickets vencidos' };
    }

    const count = overdueTickets.length;
    const subjectLine = `🚨 [ALERTA SLA] ${count} Ticket${count === 1 ? '' : 's'} lleva${count === 1 ? '' : 'n'} más de ${thresholdHours}h sin respuesta en WMS Stocka`;

    const rowsHtml = overdueTickets.slice(0, 20).map(t => {
      const shortId = (t.id || '').substring(0, 6);
      const comercio = t.comercio || t.client?.company_name || t.client?.full_name || 'Sin Comercio';
      const prio = PRIORITY_META[t.priority] || PRIORITY_META.media;
      const elapsedText = t.sla?.elapsedText || `${Math.round(t.sla?.hoursElapsed || thresholdHours)}h sin atención`;
      const assignee = t.assignee?.full_name || 'Sin Asignar';

      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 8px; font-weight: 700; color: #0f172a;">
            <span style="font-family: monospace; color: #64748b; font-size: 11.5px;">[#${escapeHtmlSafe(shortId)}]</span>
            ${escapeHtmlSafe(t.subject)}
          </td>
          <td style="padding: 10px 8px; color: #334155;">${escapeHtmlSafe(comercio)}</td>
          <td style="padding: 10px 8px; text-align: center;">
            <span style="padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; background-color: ${prio.bg}; color: ${prio.color};">
              ${escapeHtmlSafe(prio.label)}
            </span>
          </td>
          <td style="padding: 10px 8px; color: #64748b; font-size: 12px;">${escapeHtmlSafe(assignee)}</td>
          <td style="padding: 10px 8px; text-align: right; font-weight: 800; color: #dc2626;">
            ⏰ ${escapeHtmlSafe(elapsedText)}
          </td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 24px 12px;">
  <div style="max-width: 660px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; border: 1px solid #fecaca; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(220, 38, 38, 0.08);">
    <div style="height: 6px; background: linear-gradient(90deg, #dc2626 0%, #ea580c 50%, #f59e0b 100%);"></div>
    <div style="padding: 24px 28px 16px 28px; border-bottom: 1px solid #fef2f2; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 11px; font-weight: 800; color: #dc2626; letter-spacing: 0.06em; text-transform: uppercase;">ALERTA AUTOMÁTICA DE INACTIVIDAD (SLA)</div>
        <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 800; color: #0f172a;">Tickets Pendientes de Atención o Respuesta</h1>
      </div>
      <span style="display: inline-block; padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 800; background-color: #dc2626; color: #ffffff;">
        ${count} Caso${count === 1 ? '' : 's'} Vencido${count === 1 ? '' : 's'}
      </span>
    </div>

    <div style="padding: 22px 28px;">
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.55;">
        Se han detectado <strong>${count} ticket(s) abierto(s)</strong> en WMS Stocka que superan el tiempo máximo configurado (<strong>${thresholdHours} horas</strong>) sin respuesta del equipo de soporte:
      </p>

      <div style="border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 22px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left;">
          <thead>
            <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #475569;">
              <th style="padding: 10px 8px;">Caso / Asunto</th>
              <th style="padding: 10px 8px;">Comercio</th>
              <th style="padding: 10px 8px; text-align: center;">Prioridad</th>
              <th style="padding: 10px 8px;">Asignado</th>
              <th style="padding: 10px 8px; text-align: right;">Tiempo sin Atención</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div style="text-align: center; margin: 24px 0 8px 0;">
        <a href="${STOCKA_ADMIN_URL}" target="_blank" style="display: inline-block; background-color: #dc2626; color: #ffffff; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-weight: 700; font-size: 14px;">
          Ir a Bandeja de Tickets Ahora →
        </a>
      </div>
    </div>

    <div style="background-color: #fef2f2; padding: 14px 24px; text-align: center; font-size: 11.5px; color: #991b1b; border-top: 1px solid #fecaca;">
      Monitor de SLA WMS Stocka • Enviado a <strong>${STOCKA_TICKETS_EMAIL}</strong> (${formatChileDateTime()})
    </div>
  </div>
</body>
</html>`;

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': getBrevoApiKey(),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'STOCKA Monitor SLA', email: STOCKA_SENDER_EMAIL },
        to: [{ email: STOCKA_TICKETS_EMAIL, name: 'Stocka Operaciones' }],
        subject: subjectLine,
        htmlContent
      })
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.error('[TicketNotifications] Error Brevo en alerta SLA:', errTxt);
      return { success: false, error: errTxt };
    }

    console.log(`🚨 [TicketNotifications] Alerta SLA enviada a ${STOCKA_TICKETS_EMAIL} (${count} tickets vencidos)`);
    return { success: true, count };
  } catch (err) {
    console.error('[TicketNotifications] Excepción en sendTicketSlaAlertEmail:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Envía notificación por correo al cliente cuando Stocka responde o resuelve el ticket (incluyendo detalle de saldo si aplica)
 */
export async function sendTicketClientUpdateEmail({ ticket, clientEmail, clientName, replyMessage, statusLabel, balanceRecord }) {
  try {
    if (!clientEmail || !clientEmail.includes('@')) return { success: false, reason: 'No client email' };

    const shortId = (ticket.id || '').substring(0, 6);
    const comercio = ticket.comercio || 'Cliente Stocka';

    let balanceHtml = '';
    if (balanceRecord && balanceRecord.monto > 0) {
      const isDesc = balanceRecord.tipo === 'descuento';
      const montoStr = '$' + Number(balanceRecord.monto).toLocaleString('es-CL');
      const ivaStr = balanceRecord.iva_tipo === 'mas_iva' ? '+ IVA (Neto)' : 'IVA Incluido';
      const badgeBg = isDesc ? '#ecfdf5' : '#fef2f2';
      const badgeBorder = isDesc ? '#a7f3d0' : '#fecaca';
      const badgeColor = isDesc ? '#047857' : '#b91c1c';
      const titleText = isDesc
        ? `🟢 Saldo a Favor Registrado: -${montoStr} CLP (${ivaStr})`
        : `🔴 Cargo Extraordinario Registrado: ${montoStr} CLP (${ivaStr})`;

      balanceHtml = `
        <div style="background-color: ${badgeBg}; border: 1px solid ${badgeBorder}; color: ${badgeColor}; padding: 14px 16px; border-radius: 10px; margin-bottom: 20px; font-size: 13px;">
          <div style="font-weight: 800; margin-bottom: 4px;">${titleText}</div>
          <div>Concepto en Facturación: <strong>${escapeHtmlSafe(balanceRecord.detalle)}</strong></div>
        </div>
      `;
    }

    const subjectLine = `💬 Actualización en tu Caso #${shortId}: ${ticket.subject} | Stocka WMS`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 24px 12px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div style="height: 6px; background: linear-gradient(90deg, #5e17eb 0%, #2563eb 100%);"></div>
    <div style="padding: 24px 28px;">
      <div style="font-size: 11px; font-weight: 800; color: #5e17eb; text-transform: uppercase;">SOPORTE STOCKA WMS • CASO #${escapeHtmlSafe(shortId)}</div>
      <h2 style="margin: 6px 0 14px 0; font-size: 19px; color: #0f172a;">${escapeHtmlSafe(ticket.subject)}</h2>
      <p style="font-size: 14px; color: #334155; line-height: 1.55;">
        Hola <strong>${escapeHtmlSafe(clientName || comercio)}</strong>, nuestro equipo de soporte ha actualizado tu ticket (Estado: <strong>${escapeHtmlSafe(statusLabel || ticket.status)}</strong>):
      </p>
      ${replyMessage ? `
      <div style="border-left: 4px solid #5e17eb; background-color: #f8fafc; padding: 14px 16px; border-radius: 0 10px 10px 0; margin: 16px 0; font-size: 13.5px; color: #1e293b; white-space: pre-wrap;">${escapeHtmlSafe(replyMessage)}</div>
      ` : ''}
      ${balanceHtml}
      <div style="text-align: center; margin-top: 22px;">
        <a href="https://wms.stocka.cl/dashboard.html" target="_blank" style="display: inline-block; background-color: #5e17eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 13.5px;">
          Ver Caso en mi Portal Stocka →
        </a>
      </div>
    </div>
  </div>
</body>
</html>`;

    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': getBrevoApiKey(),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: STOCKA_SENDER_NAME, email: STOCKA_SENDER_EMAIL },
        to: [{ email: clientEmail.trim(), name: clientName || comercio }],
        bcc: [{ email: STOCKA_TICKETS_EMAIL, name: 'Stocka Operaciones' }],
        subject: subjectLine,
        htmlContent
      })
    });

    return { success: true };
  } catch (err) {
    console.warn('[TicketNotifications] Error enviando actualización al cliente:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Revisa en segundo plano si existen tickets vencidos sin respuesta y dispara la alerta automática a stockachile@gmail.com
 * (con control anti-duplicados cada 6 horas salvo envío manual forzado)
 */
export async function checkAndNotifyOverdueTickets(supabase, options = {}) {
  try {
    if (!supabase) return { overdueCount: 0, overdueTickets: [] };
    const forceEmail = !!options.forceEmail;
    const thresholdHours = options.thresholdHours || getConfiguredSlaHours();

    const { data: openTickets, error: tErr } = await supabase
      .from('tickets')
      .select('*, client:profiles!user_id(company_name, full_name, email), assignee:profiles!assigned_to(full_name)')
      .in('status', ['abierto', 'en_proceso'])
      .order('created_at', { ascending: true });

    if (tErr || !openTickets || openTickets.length === 0) {
      return { overdueCount: 0, overdueTickets: [] };
    }

    const ticketIds = openTickets.map(t => t.id);
    const { data: messages } = await supabase
      .from('ticket_messages')
      .select('ticket_id, created_at, is_internal, sender:profiles!sender_id(role)')
      .in('ticket_id', ticketIds);

    const msgsByTicket = {};
    (messages || []).forEach(m => {
      if (!msgsByTicket[m.ticket_id]) msgsByTicket[m.ticket_id] = [];
      msgsByTicket[m.ticket_id].push(m);
    });

    const overdueTickets = [];
    openTickets.forEach(t => {
      const sla = computeTicketSlaStatus(t, msgsByTicket[t.id] || [], thresholdHours);
      t.sla = sla;
      if (sla.slaState === 'overdue') {
        overdueTickets.push(t);
      }
    });

    if (overdueTickets.length > 0) {
      const lastStateRaw = localStorage.getItem('wms_ticket_sla_alert_state');
      let lastState = { lastSentAt: 0, notifiedIds: [] };
      try {
        if (lastStateRaw) lastState = JSON.parse(lastStateRaw);
      } catch {}

      const hoursSinceLastAlert = (Date.now() - (lastState.lastSentAt || 0)) / (1000 * 60 * 60);
      const currentOverdueIds = overdueTickets.map(t => t.id);
      const hasNewOverdueTicket = currentOverdueIds.some(id => !(lastState.notifiedIds || []).includes(id));

      if (forceEmail || hoursSinceLastAlert >= 6 || hasNewOverdueTicket) {
        const emailRes = await sendTicketSlaAlertEmail(overdueTickets, thresholdHours);
        if (emailRes.success) {
          localStorage.setItem('wms_ticket_sla_alert_state', JSON.stringify({
            lastSentAt: Date.now(),
            notifiedIds: currentOverdueIds
          }));
        }
      }
    }

    return {
      overdueCount: overdueTickets.length,
      overdueTickets,
      thresholdHours
    };
  } catch (err) {
    console.warn('[TicketNotifications] Error en checkAndNotifyOverdueTickets:', err);
    return { overdueCount: 0, overdueTickets: [], error: err.message };
  }
}

/**
 * Envía el correo de respaldo / confirmación al Seller (Comercio) cuando presenta una Solicitud de Término de Servicio (Zona Roja)
 */
export async function sendServiceExitSellerConfirmationEmail(exitData = {}) {
  try {
    const rawRecipients = Array.isArray(exitData.toEmails)
      ? exitData.toEmails
      : [exitData.clientEmail, exitData.repEmail].filter(Boolean);

    const uniqueEmails = Array.from(new Set(
      rawRecipients
        .flatMap(e => String(e || '').split(/[,;]/))
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e.includes('@') && !e.includes('['))
    ));

    if (uniqueEmails.length === 0) {
      return { success: false, reason: 'No valid recipient email for seller' };
    }

    const shortId = String(exitData.ticketId || 'BAJA').substring(0, 6).toUpperCase();
    const comercio = exitData.comercio || 'Comercio';
    const companyName = exitData.companyName || comercio;
    const rutText = exitData.rutText || 'No informado';
    const repName = exitData.repName || 'No informado';
    const repRut = exitData.repRut || 'No informado';
    const exitDate = exitData.exitDate || 'Por confirmar (mín. 30 días)';
    const createdStr = formatChileDateTime(exitData.createdAt || new Date());
    const activePeriodName = exitData.activePeriodName || 'Período en Curso';
    const isCurrentPeriodDesglosePending = exitData.isCurrentPeriodDesglosePending !== false;

    const totalSKUs = Number(exitData.totalSKUs) || 0;
    const totalUnits = Number(exitData.totalUnits) || 0;
    const baseFee = Number(exitData.baseFee ?? 1250);
    const skuLimit = Number(exitData.skuLimit ?? 3);
    const skuRate = Number(exitData.skuRate ?? 100);
    const skuSurcharge = Number(exitData.skuSurcharge ?? Math.max(0, totalSKUs - skuLimit) * skuRate);
    const unitsLimit = Number(exitData.unitsLimit ?? 10);
    const unitsRate = Number(exitData.unitsRate ?? 50);
    const unitsSurcharge = Number(exitData.unitsSurcharge ?? Math.max(0, totalUnits - unitsLimit) * unitsRate);
    const netTotal = Number(exitData.netTotal ?? (baseFee + skuSurcharge + unitsSurcharge));
    const iva = Number(exitData.iva ?? Math.round(netTotal * 0.19));
    const brutoTotal = Number(exitData.brutoTotal ?? (netTotal + iva));
    const items = Array.isArray(exitData.items) ? exitData.items : [];

    const itemsRowsHtml = items.slice(0, 30).map(it => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 7px 10px; font-weight: 700; color: #0f172a; font-family: monospace; font-size: 12px;">${escapeHtmlSafe(it.sku)}</td>
        <td style="padding: 7px 10px; color: #334155; font-size: 12px;">${escapeHtmlSafe(it.name)}</td>
        <td style="padding: 7px 10px; color: #64748b; font-size: 11.5px;">${escapeHtmlSafe(it.warehouses || 'Bodega Stocka')}</td>
        <td style="padding: 7px 10px; text-align: center; font-weight: 700; color: #0f172a; font-size: 12px;">${Number(it.quantity || 0).toLocaleString('es-CL')}</td>
      </tr>
    `).join('');

    const subjectLine = `📋 [Respaldo Solicitud de Baja #${shortId}] ${comercio} — Término de Servicio Logístico Stocka`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 24px 12px;">
  <div style="max-width: 660px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.07);">
    <div style="height: 6px; background: linear-gradient(90deg, #ef4444 0%, #dc2626 50%, #991b1b 100%);"></div>

    <!-- Header -->
    <div style="padding: 24px 28px 18px 28px; border-bottom: 1px solid #f1f5f9; background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
        <div>
          <div style="font-size: 11px; font-weight: 800; color: #be123c; letter-spacing: 0.06em; text-transform: uppercase;">WMS STOCKA • ZONA ROJA — TÉRMINO DE SERVICIO</div>
          <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 800; color: #881337;">Respaldo de Solicitud de Baja de Servicio</h1>
        </div>
        <div style="text-align: right;">
          <span style="display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 800; text-transform: uppercase; background-color: #be123c; color: #ffffff;">
            Solicitud Recibida
          </span>
          <div style="font-size: 12px; color: #9f1239; font-family: monospace; font-weight: 700; margin-top: 4px;">Folio #${escapeHtmlSafe(shortId)}</div>
        </div>
      </div>
    </div>

    <div style="padding: 24px 28px;">
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.55;">
        Estimado(a) <strong>${escapeHtmlSafe(repName !== 'No informado' ? repName : comercio)}</strong>, hemos recibido formalmente su solicitud de término de servicio logístico para la cuenta <strong>${escapeHtmlSafe(comercio)}</strong>. A continuación le enviamos el respaldo detallado de los antecedentes registrados en plataforma:
      </p>

      <!-- 1. Antecedentes del Comercio y Fecha Solicitada -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 18px;">
        <div style="font-size: 12px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
          1. Antecedentes del Comercio y Fecha de Salida
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 5px 6px; color: #64748b; width: 42%;"><strong>Comercio / Cuenta WMS:</strong></td>
            <td style="padding: 5px 6px; color: #0f172a; font-weight: 700;">${escapeHtmlSafe(comercio)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 6px; color: #64748b;"><strong>Empresa / Razón Social:</strong></td>
            <td style="padding: 5px 6px; color: #0f172a;">${escapeHtmlSafe(companyName)} (RUT: ${escapeHtmlSafe(rutText)})</td>
          </tr>
          <tr>
            <td style="padding: 5px 6px; color: #64748b;"><strong>Representante Legal:</strong></td>
            <td style="padding: 5px 6px; color: #0f172a;">${escapeHtmlSafe(repName)} ${repRut && repRut !== 'No informado' ? `(RUT: ${escapeHtmlSafe(repRut)})` : ''}</td>
          </tr>
          <tr>
            <td style="padding: 5px 6px; color: #64748b;"><strong>Fecha de Solicitud:</strong></td>
            <td style="padding: 5px 6px; color: #0f172a;">${escapeHtmlSafe(createdStr)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 6px; color: #64748b;"><strong>Fecha Solicitada de Salida (mín. 30 días):</strong></td>
            <td style="padding: 5px 6px; color: #dc2626; font-weight: 800; font-size: 14px;">${escapeHtmlSafe(exitDate)}</td>
          </tr>
        </table>
      </div>

      <!-- 2. Nota sobre Desgloses en Curso y Futuros -->
      <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #d97706; border-radius: 8px; padding: 13px 15px; margin-bottom: 18px; font-size: 12.5px; color: #92400e; line-height: 1.5;">
        <strong style="display: block; margin-bottom: 4px; color: #78350f;">📌 Estado de Facturación y Emisión de Desgloses (${escapeHtmlSafe(activePeriodName)} y posteriores):</strong>
        ${isCurrentPeriodDesglosePending
          ? `Se deja constancia de que al momento de esta solicitud se encuentra <strong>pendiente de emitir el desglose de servicios correspondiente al período en curso (${escapeHtmlSafe(activePeriodName)})</strong>. Tanto el desglose de <strong>${escapeHtmlSafe(activePeriodName)}</strong> como <strong>cualquier otro desglose que corresponda emitir según la fecha de salida que sea confirmada</strong> deberán encontrarse emitidos y pagados en su totalidad como condición previa para el retiro físico del inventario.`
          : `Los períodos emitidos a la fecha se encuentran al día. Cualquier desglose de servicios adicional que corresponda emitir hasta la fecha de salida que sea confirmada deberá encontrarse emitido y pagado previo al retiro físico del inventario.`
        }
      </div>

      <!-- 3. Fotografía de Inventario Registrado -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 18px;">
        <div style="font-size: 12px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
          2. Inventario Registrado al Momento de la Solicitud (Fotografía Actual)
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px;">
          <tr>
            <td style="width: 50%; padding: 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center;">
              <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700;">SKUs con Unidades</div>
              <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 2px;">${totalSKUs}</div>
            </td>
            <td style="width: 50%; padding: 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center;">
              <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700;">Unidades Totales</div>
              <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 2px;">${totalUnits.toLocaleString('es-CL')}</div>
            </td>
          </tr>
        </table>

        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 11px 13px; font-size: 12px; color: #14532d; line-height: 1.5; margin-bottom: ${items.length > 0 ? '12px' : '0'};">
          <strong>Certificación de Inventario para Retiro:</strong> Es condición indispensable para la entrega de la mercadería coordinar y certificar un <strong>conteo físico en bodega</strong>. Los registros exhibidos corresponden a una <strong>fotografía del momento</strong>, la cual podría verse actualizada por pedidos en procesamiento, órdenes en curso, unidades en tránsito o ajustes realizados tras el cuadraje en bodega. Asimismo, el <strong>monto de salida variará</strong> según lo que efectivamente sea preparado para retiro, posterior al procesamiento de cualquier orden pendiente, en proceso y futura.
        </div>

        ${items.length > 0 ? `
          <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background-color: #f1f5f9; border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 11px; color: #475569; text-transform: uppercase;">
                <th style="padding: 8px 10px;">SKU</th>
                <th style="padding: 8px 10px;">Producto</th>
                <th style="padding: 8px 10px;">Bodega</th>
                <th style="padding: 8px 10px; text-align: center;">Unidades</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRowsHtml}
            </tbody>
          </table>
          ${items.length > 30 ? `<div style="font-size: 11px; color: #64748b; margin-top: 6px; text-align: center;">Mostrando los primeros 30 de ${items.length} SKUs registrados.</div>` : ''}
        ` : ''}
      </div>

      <!-- 4. Estimación de Costos de Preparación y Retiro -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 18px;">
        <div style="font-size: 12px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
          3. Estimación de Costos de Preparación y Retiro (Outbound)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr style="border-bottom: 1px dashed #e2e8f0;">
            <td style="padding: 6px 4px; color: #475569;">Costo de Preparación Base:</td>
            <td style="padding: 6px 4px; text-align: right; font-weight: 600; color: #0f172a;">$${baseFee.toLocaleString('es-CL')}</td>
          </tr>
          <tr style="border-bottom: 1px dashed #e2e8f0;">
            <td style="padding: 6px 4px; color: #475569;">Recargo por SKUs Adicionales (+$${skuRate.toLocaleString('es-CL')} sobre ${skuLimit} SKUs):</td>
            <td style="padding: 6px 4px; text-align: right; font-weight: 600; color: #0f172a;">$${skuSurcharge.toLocaleString('es-CL')}</td>
          </tr>
          <tr style="border-bottom: 1px dashed #e2e8f0;">
            <td style="padding: 6px 4px; color: #475569;">Recargo por Unidades Adicionales (+$${unitsRate.toLocaleString('es-CL')} sobre ${unitsLimit} Uds):</td>
            <td style="padding: 6px 4px; text-align: right; font-weight: 600; color: #0f172a;">$${unitsSurcharge.toLocaleString('es-CL')}</td>
          </tr>
          <tr>
            <td style="padding: 6px 4px; color: #0f172a; font-weight: 700;">Total Neto Estimado:</td>
            <td style="padding: 6px 4px; text-align: right; font-weight: 700; color: #0f172a;">$${netTotal.toLocaleString('es-CL')}</td>
          </tr>
          <tr>
            <td style="padding: 4px 4px 8px 4px; color: #64748b; font-size: 12px;">IVA (19%):</td>
            <td style="padding: 4px 4px 8px 4px; text-align: right; color: #64748b; font-size: 12px;">$${iva.toLocaleString('es-CL')}</td>
          </tr>
          <tr style="border-top: 2px solid #ef4444;">
            <td style="padding: 10px 4px 4px 4px; color: #dc2626; font-weight: 800; font-size: 15px;">TOTAL BRUTO ESTIMADO DE SALIDA:</td>
            <td style="padding: 10px 4px 4px 4px; text-align: right; color: #dc2626; font-weight: 800; font-size: 15px;">$${brutoTotal.toLocaleString('es-CL')} CLP</td>
          </tr>
        </table>
        <p style="margin: 10px 0 0 0; font-size: 11.5px; color: #64748b; line-height: 1.45; font-style: italic;">
          *Nota: El monto de salida exhibido corresponde a una estimación referencial según la fotografía actual de inventario y <strong>variará en función de las unidades y SKUs que efectivamente sean preparados para retiro</strong>, posterior al procesamiento de órdenes pendientes, en proceso y futuras.
        </p>
      </div>

      <!-- 5. Declaración Jurada -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; font-size: 11.5px; color: #475569; line-height: 1.5; margin-bottom: 20px;">
        <strong style="color: #0f172a;">✔ Declaración Jurada Aceptada en Sistema:</strong> El Comercio declaró su conformidad con los períodos facturados emitidos a la fecha y su compromiso de liquidar cualquier desglose en curso o futuro previo al retiro definitivo, así como el pago del servicio de preparación de salida (Outbound) y la firma del convenio de término y finiquito el día del retiro.
      </div>

      <div style="text-align: center; margin: 22px 0 6px 0;">
        <a href="https://wms.stocka.cl" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: #ffffff; text-decoration: none; padding: 12px 26px; border-radius: 10px; font-weight: 700; font-size: 13.5px;">
          Ver Solicitud y Descargar Documentos en WMS Stocka →
        </a>
      </div>
    </div>

    <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; font-size: 11.5px; color: #64748b; border-top: 1px solid #e2e8f0;">
      Comprobante automático de respaldo enviado por <strong>Stocka SpA Fulfillment Logístico</strong> • Av. Campo de Deportes 405, Ñuñoa
    </div>
  </div>
</body>
</html>`;

    const payload = {
      sender: { name: STOCKA_SENDER_NAME, email: STOCKA_SENDER_EMAIL },
      to: uniqueEmails.map(email => ({ email, name: companyName || comercio })),
      subject: subjectLine,
      htmlContent
    };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': getBrevoApiKey(),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.error('[TicketNotifications] Error Brevo al enviar respaldo de baja al seller:', errTxt);
      return { success: false, error: errTxt };
    }

    const resJson = await res.json().catch(() => ({}));
    console.log(`✅ [TicketNotifications] Respaldo de Solicitud de Baja #${shortId} enviado a seller:`, uniqueEmails);
    return { success: true, recipients: uniqueEmails, messageId: resJson.messageId };
  } catch (err) {
    console.error('[TicketNotifications] Excepción en sendServiceExitSellerConfirmationEmail:', err);
    return { success: false, error: err.message };
  }
}

// Exponer funciones útiles en window para integraciones transversales (ej. RedZone o Admin Badges)
if (typeof window !== 'undefined') {
  window.sendTicketCreatedEmail = sendTicketCreatedEmail;
  window.sendServiceExitSellerConfirmationEmail = sendServiceExitSellerConfirmationEmail;
  window.sendTicketSlaAlertEmail = sendTicketSlaAlertEmail;
  window.checkAndNotifyOverdueTickets = checkAndNotifyOverdueTickets;
}
