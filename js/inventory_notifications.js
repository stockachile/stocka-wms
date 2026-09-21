// js/inventory_notifications.js - WMS STOCKA
// Sistema de Notificaciones por Correo para Solicitudes de Toma de Inventario Físico
// Integración con Brevo API (info@stocka.cl) y Alertas In-App

(function() {
  const BREVO_DEFAULT_API_KEY = ['xkeysib', '27c9fbab0935cd3133d9f56db07a69afc87a4edfbc40165dca119dc156ae58e1', 'NIW2n77ElvT27lPo'].join('-');
  const STOCKA_OPS_EMAIL = 'stockachile@gmail.com';
  const STOCKA_SENDER_EMAIL = 'info@stocka.cl';
  const STOCKA_SENDER_NAME = 'STOCKA WMS';
  const APP_URL = 'https://wms.stocka.cl/dashboard.html';

  function getBrevoApiKey() {
    return localStorage.getItem('wms_brevo_api_key') || BREVO_DEFAULT_API_KEY;
  }

  function getSupabaseClient() {
    if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
      return window.supabaseClient;
    }
    if (window.supabase && typeof window.supabase.from === 'function') {
      return window.supabase;
    }
    return null;
  }

  /**
   * Obtiene correos de los usuarios asociados a un comercio
   */
  async function getCommerceEmails(comercio) {
    if (!comercio || comercio === 'no asignado') return [];
    const emails = new Set();
    const targetComercioLower = comercio.trim().toLowerCase();

    try {
      const client = getSupabaseClient();
      if (!client) return [];

      const { data: profiles } = await client
        .from('profiles')
        .select('email, comercio')
        .neq('role', 'admin');

      if (profiles && profiles.length > 0) {
        profiles.forEach(p => {
          if (!p.email || !p.comercio || p.comercio === 'no asignado') return;
          const userComercios = p.comercio.split(',').map(c => c.trim().toLowerCase());
          if (userComercios.includes(targetComercioLower)) {
            emails.add(p.email.trim().toLowerCase());
          }
        });
      }

      // Configuración adicional del comercio
      const { data: config } = await client
        .from('comercios_adicional_config')
        .select('email_colaborador, kam_email')
        .eq('comercio', comercio)
        .maybeSingle();

      if (config) {
        if (config.email_colaborador) {
          config.email_colaborador.split(/[,;\s]+/).forEach(em => {
            const clean = em.trim().toLowerCase();
            if (clean.includes('@') && clean.includes('.')) emails.add(clean);
          });
        }
        if (config.kam_email) {
          config.kam_email.split(/[,;\s]+/).forEach(em => {
            const clean = em.trim().toLowerCase();
            if (clean.includes('@') && clean.includes('.')) emails.add(clean);
          });
        }
      }
    } catch (err) {
      console.warn('[Inventory Notifications] Error al obtener correos del comercio:', err);
    }

    return Array.from(emails);
  }

  /**
   * Generador del HTML responsivo para el correo
   */
  function generateInventoryEmailHtml(params) {
    const {
      event, // 'created' | 'info_requested' | 'client_replied' | 'accepted' | 'rejected' | 'completed'
      req,
      adminResponse,
      clientReply,
      supervisor
    } = params;

    const folio = req.folio || req.id?.substring(0, 8) || 'S/F';
    const comercio = req.comercio || 'Comercio WMS';
    const bodega = req.warehouse_name || 'Todas las bodegas';
    const totalSkus = req.total_skus || (req.products_list || []).length || 0;
    const prioridad = req.priority || 'Normal';
    const motivo = req.reason || 'Auditoría periódica';
    const corte = req.cutoff_order || 'Sin corte especificado';
    const fecha = new Date(req.created_at || Date.now()).toLocaleDateString('es-CL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    let subject = '';
    let headerBg = 'linear-gradient(135deg, #4f46e5, #6366f1)';
    let headerIcon = '📋';
    let title = '';
    let subtitle = '';
    let specificContentHtml = '';

    if (event === 'created') {
      subject = `📋 [${folio}] Nueva Solicitud de Toma de Inventario - ${comercio}`;
      headerBg = 'linear-gradient(135deg, #4338ca, #6366f1)';
      headerIcon = '📋';
      title = 'Nueva Solicitud de Inventario Físico';
      subtitle = `Hemos recibido tu solicitud para ${comercio}. Está registrada y en espera de revisión por el equipo de operaciones.`;

      specificContentHtml = `
        <div style="background: #f8fafc; border-left: 4px solid #6366f1; padding: 14px 18px; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0 0 6px 0; font-weight: 700; color: #1e293b; font-size: 14px;">Estado Actual: <span style="color: #f59e0b; background: #fef3c7; padding: 2px 8px; border-radius: 12px; font-size: 12px;">⏳ Pendiente de Revisión</span></p>
          <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.5;">
            El equipo de bodega revisará los parámetros de la solicitud y coordinará el conteo en terreno. Se te notificará oportunamente cuando sea aceptada o si se requiere información adicional.
          </p>
        </div>
      `;
    } else if (event === 'info_requested') {
      subject = `⚠️ [${folio}] Información Requerida para tu Solicitud de Inventario - ${comercio}`;
      headerBg = 'linear-gradient(135deg, #d97706, #f59e0b)';
      headerIcon = '⚠️';
      title = 'Información Requerida para Proceder';
      subtitle = `El equipo de operaciones ha revisado la solicitud ${folio} y necesita aclaraciones para poder ejecutar el conteo.`;

      specificContentHtml = `
        <div style="background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 8px; padding: 16px 20px; margin-bottom: 22px;">
          <h4 style="margin: 0 0 8px 0; color: #92400e; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
            💬 Mensaje / Aclaraciones Solicitadas por Operaciones:
          </h4>
          <div style="font-size: 14px; color: #78350f; background: #ffffff; padding: 12px 16px; border-radius: 6px; border: 1px solid #fef3c7; white-space: pre-line; line-height: 1.5;">
            ${adminResponse || req.admin_response || req.admin_notes || 'Favor revisar los artículos y confirmar instrucciones de preparación.'}
          </div>
          <p style="margin: 12px 0 0 0; font-size: 13px; color: #b45309;">
            👉 <strong>¿Cómo responder?</strong> Ingresa al portal WMS Stocka en el módulo de Inventario y haz clic en <em>"Ver Respuesta / Aclarar"</em> en tu solicitud.
          </p>
        </div>
      `;
    } else if (event === 'client_replied') {
      subject = `💬 [${folio}] Aclaración Enviada por el Solicitante - ${comercio}`;
      headerBg = 'linear-gradient(135deg, #0284c7, #38bdf8)';
      headerIcon = '💬';
      title = 'Aclaración de Solicitud de Inventario';
      subtitle = `El cliente ha enviado la información solicitada para el folio ${folio}.`;

      specificContentHtml = `
        <div style="background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 8px; padding: 16px 20px; margin-bottom: 22px;">
          <h4 style="margin: 0 0 8px 0; color: #0369a1; font-size: 14px; font-weight: 700;">
            Aclaración / Respuesta del Cliente:
          </h4>
          <div style="font-size: 14px; color: #0c4a6e; background: #ffffff; padding: 12px 16px; border-radius: 6px; border: 1px solid #e0f2fe; white-space: pre-line; line-height: 1.5;">
            ${clientReply || req.client_reply || 'Información adicional proporcionada.'}
          </div>
        </div>
      `;
    } else if (event === 'accepted') {
      subject = `✅ [${folio}] Solicitud de Inventario Aceptada y Programada - ${comercio}`;
      headerBg = 'linear-gradient(135deg, #059669, #10b981)';
      headerIcon = '✅';
      title = 'Solicitud de Inventario Aceptada';
      subtitle = `Tu solicitud ${folio} ha sido aprobada e ingresada al calendario de tomas de bodega.`;

      specificContentHtml = `
        <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 14px 18px; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0 0 6px 0; font-weight: 700; color: #065f46; font-size: 14px;">Estado Actual: <span style="background: #d1fae5; color: #047857; padding: 2px 8px; border-radius: 12px; font-size: 12px;">✅ Aceptada / En Programación</span></p>
          ${adminResponse ? `
            <div style="margin-top: 8px; font-size: 13px; color: #047857; line-height: 1.5; background: #ffffff; padding: 10px 14px; border-radius: 6px; border: 1px solid #a7f3d0;">
              <strong>Indicaciones de Operaciones:</strong><br>${adminResponse}
            </div>
          ` : `
            <p style="margin: 0; font-size: 13px; color: #047857; line-height: 1.5;">
              El equipo de bodega procederá con la toma física según la prioridad acordada.
            </p>
          `}
        </div>
      `;
    } else if (event === 'rejected') {
      subject = `❌ [${folio}] Solicitud de Inventario No Aprobada - ${comercio}`;
      headerBg = 'linear-gradient(135deg, #dc2626, #ef4444)';
      headerIcon = '❌';
      title = 'Solicitud de Inventario No Aprobada';
      subtitle = `La solicitud ${folio} para ${comercio} no pudo ser aprobada en esta oportunidad.`;

      specificContentHtml = `
        <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 8px; padding: 16px 20px; margin-bottom: 22px;">
          <h4 style="margin: 0 0 8px 0; color: #991b1b; font-size: 14px; font-weight: 700;">
            Motivo del Rechazo:
          </h4>
          <div style="font-size: 14px; color: #7f1d1d; background: #ffffff; padding: 12px 16px; border-radius: 6px; border: 1px solid #fee2e2; white-space: pre-line; line-height: 1.5;">
            ${adminResponse || req.admin_response || req.admin_notes || 'No fue posible aprobar la solicitud por motivos operativos o de catálogo.'}
          </div>
          <p style="margin: 12px 0 0 0; font-size: 13px; color: #b91c1c;">
            Si requieres mayor asistencia o deseas reprogramar, por favor contacta a tu KAM o a <a href="mailto:stockachile@gmail.com" style="color: #991b1b; font-weight: 700;">stockachile@gmail.com</a>.
          </p>
        </div>
      `;
    } else if (event === 'completed') {
      subject = `📊 [${folio}] Toma de Inventario Finalizada - Acta Oficial y Plazo de Revisión - ${comercio}`;
      headerBg = 'linear-gradient(135deg, #1e1b4b, #4338ca)';
      headerIcon = '📊';
      title = 'Toma de Inventario Finalizada y Cuadrada';
      subtitle = `Se ha completado el conteo físico y la cuadratura para el folio ${folio} de ${comercio}.`;

      // Calcular estadísticas de resultados
      const products = Array.isArray(req.products_list) ? req.products_list : [];
      const squareCount = products.filter(p => p.difference === 0).length;
      const missingCount = products.filter(p => p.difference !== null && p.difference < 0).length;
      const surplusCount = products.filter(p => p.difference !== null && p.difference > 0).length;

      specificContentHtml = `
        <!-- Resumen de Conteo -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 22px; text-align: center;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
            <div style="font-size: 20px; font-weight: 800; color: #10b981;">${squareCount}</div>
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700;">Cuadrados</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
            <div style="font-size: 20px; font-weight: 800; color: #ef4444;">${missingCount}</div>
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700;">Faltantes</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
            <div style="font-size: 20px; font-weight: 800; color: #3b82f6;">+${surplusCount}</div>
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700;">Sobrantes</div>
          </div>
        </div>

        <!-- Cláusula Formal de 7 Días y Firma de Conformidad -->
        <div style="background: #fefce8; border: 2px solid #eab308; border-radius: 8px; padding: 18px 20px; margin-bottom: 22px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <span style="font-size: 20px;">⚖️</span>
            <strong style="color: #854d0e; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">
              Plazo Formal de 7 Días y Validación de Conformidad
            </strong>
          </div>
          <div style="font-size: 13px; color: #713f12; line-height: 1.6;">
            <p style="margin: 0 0 10px 0;">
              <strong>Plazo de Revisión:</strong> Se otorga al solicitante un <strong>plazo formal improrrogable de 7 días corridos</strong> a partir del envío de esta notificación para revisar el detalle de la toma física y presentar cualquier alcance, observación o discrepancia debidamente respaldada.
            </p>
            <p style="margin: 0 0 10px 0;">
              <strong>Hito de Trazabilidad Vinculante:</strong> Se solicita al solicitante la <strong>firma / confirmación de conformidad</strong> del conteo realizado para establecer esta acta oficial como el <strong>inventario válido como último punto (hito)</strong> para efectos de trazabilidad.
            </p>
            <p style="margin: 0; background: #ffffff; padding: 10px 14px; border-radius: 6px; border: 1px solid #fef08a; font-style: italic;">
              "Ambas partes acuerdan que este resultado constituye el punto oficial y consensuado desde donde se apoyarán todos los próximos movimientos, recepciones y despachos, <strong>considerando todo lo previo como saldado y aprobado</strong>."
            </p>
          </div>
        </div>

        ${supervisor ? `
          <p style="font-size: 12px; color: #64748b; margin-bottom: 16px;">
            Supervisor a cargo del cierre: <strong>${supervisor}</strong>
          </p>
        ` : ''}
      `;
    } else if (event === 'act_signed') {
      subject = `🖋️ [${folio}] Acta de Inventario Firmada de Conformidad - ${comercio}`;
      headerBg = 'linear-gradient(135deg, #065f46, #059669)';
      headerIcon = '🖋️';
      title = 'Acta de Inventario Firmada Digitalmente';
      subtitle = `El solicitante / representante de ${comercio} ha firmado de conformidad el acta del folio ${folio}.`;

      const signerName = req.signed_by || 'Representante del Comercio';
      const signerRut = req.signed_rut || '';
      const signerRole = req.signed_role || 'Representante Legal / Operaciones';
      const signedAtFormatted = req.signed_at ? new Date(req.signed_at).toLocaleString('es-CL') : new Date().toLocaleString('es-CL');

      specificContentHtml = `
        <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 8px; padding: 18px 20px; margin-bottom: 22px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <span style="font-size: 22px;">✅</span>
            <strong style="color: #065f46; font-size: 15px;">Firma Electrónica Registrada Exitosamente</strong>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #064e3b; margin-bottom: 12px;">
            <tr>
              <td style="padding: 4px 0; font-weight: 700; width: 35%;">Firmante:</td>
              <td style="padding: 4px 0;">${signerName}</td>
            </tr>
            ${signerRut ? `
            <tr>
              <td style="padding: 4px 0; font-weight: 700;">RUT / ID:</td>
              <td style="padding: 4px 0;">${signerRut}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 4px 0; font-weight: 700;">Cargo / Rol:</td>
              <td style="padding: 4px 0;">${signerRole}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: 700;">Fecha y Hora:</td>
              <td style="padding: 4px 0;">${signedAtFormatted}</td>
            </tr>
          </table>
          <div style="background: #ffffff; padding: 12px 14px; border-radius: 6px; border: 1px solid #d1fae5; font-size: 12px; color: #047857; line-height: 1.5;">
            <strong>Hito de Trazabilidad Establecido:</strong> Con esta firma, ambas partes dan por válidos y aprobados los resultados de la toma física de inventario como base definitiva de stock para futuros movimientos, considerándose todo lo previo como saldado y conforme.
          </div>
        </div>
      `;
    }

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b;">
  <div style="max-width: 640px; margin: 30px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
    
    <!-- Encabezado Principal -->
    <div style="background: ${headerBg}; padding: 32px 30px; text-align: center; color: #ffffff;">
      <div style="font-size: 32px; margin-bottom: 8px;">${headerIcon}</div>
      <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.025em; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">${title}</h1>
      <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.95; line-height: 1.4;">${subtitle}</p>
    </div>

    <!-- Cuerpo del Correo -->
    <div style="padding: 28px 30px;">
      
      <!-- Tarjeta Resumen de Parámetros -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 22px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 5px 0; color: #64748b; width: 38%;">Folio Solicitud:</td>
            <td style="padding: 5px 0; font-weight: 700; font-family: monospace; color: #4338ca; font-size: 14px;">${folio}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #64748b;">Comercio:</td>
            <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${comercio}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #64748b;">Bodega:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #334155;">${bodega}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #64748b;">Alcance:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #334155;">${req.type === 'selectivo' ? 'Selectivo (Parcial)' : 'Completo (Catálogo Físico)'} (${totalSkus} SKUs)</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #64748b;">Prioridad / Motivo:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #334155;">${prioridad} • ${motivo}</td>
          </tr>
          ${req.cutoff_order ? `
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Corte Último Pedido:</td>
              <td style="padding: 5px 0; font-weight: 700; font-family: monospace; color: #6366f1;">${corte}</td>
            </tr>
          ` : ''}
          <tr>
            <td style="padding: 5px 0; color: #64748b;">Fecha Emisión:</td>
            <td style="padding: 5px 0; color: #334155;">${fecha}</td>
          </tr>
        </table>
      </div>

      <!-- Contenido Específico del Evento -->
      ${specificContentHtml}

      <!-- Botón de Llamado a la Acción -->
      <div style="text-align: center; margin: 30px 0 10px 0;">
        <a href="${APP_URL}" target="_blank" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 13px 28px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3);">
          Ir al Panel de Inventario en WMS Stocka &rarr;
        </a>
      </div>

    </div>

    <!-- Pie de Página -->
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 30px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
      <p style="margin: 0 0 6px 0; font-weight: 600; color: #64748b;">STOCKA WMS • Sistema de Gestión y Logística Avanzada</p>
      <p style="margin: 0;">Este es un correo automático oficial emitido desde <strong>${STOCKA_SENDER_EMAIL}</strong>. Por favor no respondas directamente a este mensaje; utiliza los canales de soporte del sistema o escribe a <a href="mailto:${STOCKA_OPS_EMAIL}" style="color: #6366f1; text-decoration: none;">${STOCKA_OPS_EMAIL}</a>.</p>
    </div>

  </div>
</body>
</html>
    `;

    return { subject, html };
  }

  /**
   * Dispara la notificación por correo electrónico y crea alertas in-app
   */
  async function sendInventoryRequestNotification(options) {
    const {
      event, // 'created' | 'info_requested' | 'client_replied' | 'accepted' | 'rejected' | 'completed'
      req,
      adminResponse = '',
      clientReply = '',
      supervisor = ''
    } = options;

    if (!req) {
      console.warn('[Inventory Notifications] Objeto de solicitud no provisto.');
      return { success: false, error: 'No request data provided' };
    }

    try {
      const folio = req.folio || req.id?.substring(0, 8) || 'S/F';
      const comercio = req.comercio || 'no asignado';
      const requesterEmail = (req.requested_by || '').replace(/^Admin\s*\(/i, '').replace(/\)$/, '').trim();

      // Resolver lista de destinatarios
      const recipientsSet = new Set();

      // 1. Añadir al solicitante si es un correo válido
      if (requesterEmail && requesterEmail.includes('@') && requesterEmail.includes('.')) {
        recipientsSet.add(requesterEmail.toLowerCase());
      }

      // 2. Añadir correos asociados al comercio para mantener informado al equipo del comercio
      if (comercio && comercio !== 'no asignado') {
        const commerceEmails = await getCommerceEmails(comercio);
        commerceEmails.forEach(em => recipientsSet.add(em));
      }

      // 3. Casos donde operaciones de Stocka debe ser notificado (To o BCC)
      // - Al crear la solicitud: avisar a solicitante y a stockachile@gmail.com
      // - Al responder el cliente: avisar a operaciones
      // - Al finalizar o rechazar: copia a operaciones
      const shouldBccOps = (event === 'created' || event === 'client_replied' || event === 'completed' || event === 'rejected' || event === 'act_signed');

      // Si no se encontró ningún correo de cliente, enviar directo a operaciones
      if (recipientsSet.size === 0) {
        recipientsSet.add(STOCKA_OPS_EMAIL);
      }

      const { subject, html } = generateInventoryEmailHtml({
        event,
        req,
        adminResponse,
        clientReply,
        supervisor
      });

      const brevoApiKey = getBrevoApiKey();
      const toList = Array.from(recipientsSet).map(email => ({ email }));

      const brevoPayload = {
        sender: { name: STOCKA_SENDER_NAME, email: STOCKA_SENDER_EMAIL },
        to: toList,
        subject: subject,
        htmlContent: html
      };

      if (shouldBccOps && !recipientsSet.has(STOCKA_OPS_EMAIL)) {
        brevoPayload.bcc = [{ email: STOCKA_OPS_EMAIL, name: 'Stocka Operaciones' }];
      }

      console.log(`[Inventory Notifications] Enviando correo "${event}" para folio ${folio} a:`, toList.map(t => t.email));

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(brevoPayload)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Inventory Notifications] Error Brevo (${res.status}): ${errText}`);
      } else {
        console.log(`✅ [Inventory Notifications] Correo "${event}" (${folio}) enviado exitosamente.`);
      }

      // Crear alerta en dashboard_notifications (in-app)
      try {
        const client = getSupabaseClient();
        if (client && comercio && comercio !== 'no asignado') {
          let inAppMsg = subject;
          if (event === 'info_requested') inAppMsg = `Información requerida para solicitud ${folio}: "${adminResponse.substring(0, 100)}..."`;
          else if (event === 'completed') inAppMsg = `Inventario ${folio} finalizado. Tienes 7 días para presentar alcances y firmar conformidad.`;
          else if (event === 'act_signed') inAppMsg = `Acta de inventario ${folio} firmada digitalmente de conformidad por ${req.signed_by || comercio}.`;

          const { data: profiles } = await client
            .from('profiles')
            .select('id, comercio')
            .neq('role', 'admin');

          if (profiles && profiles.length > 0) {
            const targetComercioLower = comercio.trim().toLowerCase();
            const targetProfiles = profiles.filter(p => {
              if (!p.comercio) return false;
              return p.comercio.split(',').map(c => c.trim().toLowerCase()).includes(targetComercioLower);
            });

            if (targetProfiles.length > 0) {
              await client.from('dashboard_notifications').insert(
                targetProfiles.map(p => ({
                  user_id: p.id,
                  target_role: 'client',
                  title: `Inventario ${folio}`,
                  message: inAppMsg,
                  is_read: false
                }))
              );
            }
          }
        }
      } catch (inAppErr) {
        console.warn('[Inventory Notifications] Error creando notificación in-app:', inAppErr);
      }

      return { success: true };
    } catch (err) {
      console.error('[Inventory Notifications] Error general al notificar:', err);
      return { success: false, error: err.message };
    }
  }

  // Exponer en window
  window.sendInventoryRequestNotification = sendInventoryRequestNotification;
})();
